import { NextRequest, NextResponse } from 'next/server';
import { SiweMessage } from 'siwe';
import { SignJWT } from 'jose';
import { redis, REDIS_KEYS } from '@/lib/redis';
import { getCorsHeaders, corsOptions } from '@/lib/utils/cors';
import { getAdminViemClient, EXPECTED_CHAIN_ID } from '@/lib/adminViemClient';

const JWT_TTL_SECONDS = 8 * 60 * 60; // 8 hours

export async function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

export async function POST(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);

  try {
    const body = await request.json().catch(() => null);
    const message = body?.message;
    const signature = body?.signature;

    if (typeof message !== 'string' || typeof signature !== 'string') {
      return NextResponse.json(
        { error: 'Missing required fields: message, signature' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Parse SIWE message (parsing only — never call siweMessage.verify())
    let siweMessage: SiweMessage;
    try {
      siweMessage = new SiweMessage(message);
    } catch {
      return NextResponse.json(
        { error: 'Invalid SIWE message' },
        { status: 400, headers: corsHeaders }
      );
    }

    // chainId enforcement: must be Base mainnet (8453)
    if (siweMessage.chainId !== EXPECTED_CHAIN_ID) {
      return NextResponse.json(
        { error: 'Unsupported chain' },
        { status: 400, headers: corsHeaders }
      );
    }

    // expirationTime enforcement
    if (siweMessage.expirationTime) {
      const expiresAt = new Date(siweMessage.expirationTime).getTime();
      if (Number.isFinite(expiresAt) && expiresAt < Date.now()) {
        return NextResponse.json(
          { error: 'Message expired' },
          { status: 401, headers: corsHeaders }
        );
      }
    }

    // domain enforcement: must match ADMIN_DASHBOARD_URL host
    const adminDashboardUrl = process.env.ADMIN_DASHBOARD_URL;
    if (adminDashboardUrl) {
      let expectedHost: string;
      try {
        expectedHost = new URL(adminDashboardUrl).host;
      } catch {
        expectedHost = '';
      }
      if (!expectedHost || siweMessage.domain !== expectedHost) {
        return NextResponse.json(
          { error: 'Domain mismatch' },
          { status: 401, headers: corsHeaders }
        );
      }
    } else {
      // ADMIN_DASHBOARD_URL not configured — reject for safety
      return NextResponse.json(
        { error: 'Domain mismatch' },
        { status: 401, headers: corsHeaders }
      );
    }

    const address = siweMessage.address.toLowerCase() as `0x${string}`;

    // Signature verification via viem (handles EOA + EIP-1271 + ERC-6492)
    const client = getAdminViemClient();
    const valid = await client.verifyMessage({
      address,
      message,
      signature: signature as `0x${string}`,
    });

    if (!valid) {
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401, headers: corsHeaders }
      );
    }

    // Nonce verification
    const storedNonce = await redis.get<string>(REDIS_KEYS.ADMIN_NONCE(address));
    if (!storedNonce || storedNonce !== siweMessage.nonce) {
      return NextResponse.json(
        { error: 'Invalid or expired nonce' },
        { status: 401, headers: corsHeaders }
      );
    }

    // Admin allowlist check
    const adminWalletsRaw = process.env.ADMIN_WALLETS || '';
    const adminWallets = adminWalletsRaw
      .split(',')
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w.length > 0);

    if (!adminWallets.includes(address)) {
      return NextResponse.json(
        { error: 'Address not authorized as admin' },
        { status: 403, headers: corsHeaders }
      );
    }

    // Consume nonce (one-time use)
    await redis.del(REDIS_KEYS.ADMIN_NONCE(address));

    // Issue JWT
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.warn('⚠️  [admin] JWT_SECRET is not configured');
      return NextResponse.json(
        { error: 'Server misconfiguration' },
        { status: 500, headers: corsHeaders }
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ address })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(now)
      .setExpirationTime('8h')
      .sign(new TextEncoder().encode(jwtSecret));

    const expiresAt = new Date(Date.now() + JWT_TTL_SECONDS * 1000).toISOString();

    console.log(`🔓 [admin] Issued JWT for ${address}`);

    return NextResponse.json({ token, expiresAt }, { headers: corsHeaders });
  } catch (error) {
    console.error('Error verifying admin SIWE:', error);
    return NextResponse.json(
      { error: 'Verification failed' },
      { status: 500, headers: corsHeaders }
    );
  }
}
