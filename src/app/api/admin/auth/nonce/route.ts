import { NextRequest, NextResponse } from 'next/server';
import { generateNonce } from 'siwe';
import { redis, REDIS_KEYS } from '@/lib/redis';
import { getCorsHeaders, corsOptions, corsErrorResponse } from '@/lib/utils/cors';

const NONCE_TTL_SECONDS = 300;
const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;

export async function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get('address');

  if (!address) {
    return corsErrorResponse(request, 400, 'Missing required parameter: address');
  }
  if (!ADDRESS_REGEX.test(address)) {
    return corsErrorResponse(request, 400, 'Invalid address format');
  }

  const normalizedAddress = address.toLowerCase();
  const nonce = generateNonce();

  await redis.setex(REDIS_KEYS.ADMIN_NONCE(normalizedAddress), NONCE_TTL_SECONDS, nonce);

  const expiresAt = new Date(Date.now() + NONCE_TTL_SECONDS * 1000).toISOString();

  console.log(`🔑 [admin] Issued nonce for ${normalizedAddress}`);

  return NextResponse.json({ nonce, expiresAt }, { headers: getCorsHeaders(request) });
}
