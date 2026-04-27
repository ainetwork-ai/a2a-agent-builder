import { NextRequest, NextResponse } from 'next/server';
import { SiweMessage } from 'siwe';
import { SignJWT } from 'jose';
import { redis, REDIS_KEYS } from '@/lib/redis';
import { getCorsHeaders, corsOptions, corsErrorResponse } from '@/lib/utils/cors';
import { getAdminViemClient, EXPECTED_CHAIN_ID } from '@/lib/adminViemClient';
import { isAdminWallet } from '@/lib/adminAuth';

const JWT_TTL_SECONDS = 8 * 60 * 60;

function getExpectedHost(): string | null {
  const url = process.env.ADMIN_DASHBOARD_URL;
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export async function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const message = body?.message;
    const signature = body?.signature;

    if (typeof message !== 'string' || typeof signature !== 'string') {
      return corsErrorResponse(request, 400, 'Missing required fields: message, signature');
    }

    let siweMessage: SiweMessage;
    try {
      siweMessage = new SiweMessage(message);
    } catch {
      return corsErrorResponse(request, 400, 'Invalid SIWE message');
    }

    if (siweMessage.chainId !== EXPECTED_CHAIN_ID) {
      return corsErrorResponse(request, 400, 'Unsupported chain');
    }

    if (siweMessage.expirationTime) {
      const expiresAt = new Date(siweMessage.expirationTime).getTime();
      if (Number.isFinite(expiresAt) && expiresAt < Date.now()) {
        return corsErrorResponse(request, 401, 'Message expired');
      }
    }

    const expectedHost = getExpectedHost();
    if (!expectedHost || siweMessage.domain !== expectedHost) {
      return corsErrorResponse(request, 401, 'Domain mismatch');
    }

    const address = siweMessage.address.toLowerCase() as `0x${string}`;

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.warn('⚠️  [admin] JWT_SECRET is not configured');
      return corsErrorResponse(request, 500, 'Server misconfiguration');
    }

    const storedNonce = await redis.get<string>(REDIS_KEYS.ADMIN_NONCE(address));
    if (!storedNonce || storedNonce !== siweMessage.nonce) {
      return corsErrorResponse(request, 401, 'Invalid or expired nonce');
    }
    // Consume the nonce on match (one verify attempt per nonce, regardless of
    // downstream success). Re-trying requires a fresh nonce.
    await redis.del(REDIS_KEYS.ADMIN_NONCE(address));

    if (!isAdminWallet(address)) {
      return corsErrorResponse(request, 403, 'Address not authorized as admin');
    }

    // RPC call (eth_call to universalSignatureValidator) — runs last so cheap
    // checks gate it; handles EOA + EIP-1271 + ERC-6492 transparently.
    const client = getAdminViemClient();
    const valid = await client.verifyMessage({
      address,
      message,
      signature: signature as `0x${string}`,
    });

    if (!valid) {
      return corsErrorResponse(request, 401, 'Invalid signature');
    }

    const token = await new SignJWT({ address })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('8h')
      .sign(new TextEncoder().encode(jwtSecret));

    const expiresAt = new Date(Date.now() + JWT_TTL_SECONDS * 1000).toISOString();

    console.log(`🔓 [admin] Issued JWT for ${address}`);

    return NextResponse.json({ token, expiresAt }, { headers: getCorsHeaders(request) });
  } catch (error) {
    console.error('Error verifying admin SIWE:', error);
    return corsErrorResponse(request, 500, 'Verification failed');
  }
}
