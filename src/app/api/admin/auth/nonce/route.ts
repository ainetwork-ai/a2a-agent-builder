import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { redis, REDIS_KEYS } from '@/lib/redis';
import { getCorsHeaders, corsOptions } from '@/lib/utils/cors';

const NONCE_TTL_SECONDS = 300; // 5 minutes

export async function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

export async function GET(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);

  const { searchParams } = new URL(request.url);
  const address = searchParams.get('address');

  if (!address) {
    return NextResponse.json(
      { error: 'Missing required parameter: address' },
      { status: 400, headers: corsHeaders }
    );
  }

  const normalizedAddress = address.toLowerCase();
  const nonce = crypto.randomUUID();

  await redis.setex(REDIS_KEYS.ADMIN_NONCE(normalizedAddress), NONCE_TTL_SECONDS, nonce);

  const expiresAt = new Date(Date.now() + NONCE_TTL_SECONDS * 1000).toISOString();

  console.log(`🔑 [admin] Issued nonce for ${normalizedAddress}`);

  return NextResponse.json({ nonce, expiresAt }, { headers: corsHeaders });
}
