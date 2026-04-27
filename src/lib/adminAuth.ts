import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { getCorsHeaders } from './utils/cors';

/**
 * Verify the `Authorization: Bearer <token>` header against a JWT issued by
 * `POST /api/admin/auth/verify`.
 *
 * Performs JWT signature/expiry verification (HS256, JWT_SECRET) and a
 * defensive re-check of the embedded address against `ADMIN_WALLETS`.
 *
 * Status mapping:
 * - 401: missing/invalid header, JWT_SECRET unset, JWT verification failure
 * - 403: address valid but no longer present in ADMIN_WALLETS
 *
 * @param request - The incoming Next.js request
 * @returns A NextResponse on auth failure, or `null` on success.
 *          Callers should check for `null` and proceed with their handler logic.
 */
export async function verifyAdminJwt(request: NextRequest): Promise<NextResponse | null> {
  const corsHeaders = getCorsHeaders(request);

  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: corsHeaders }
    );
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: corsHeaders }
    );
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    console.warn('⚠️  [admin] JWT_SECRET is not configured');
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: corsHeaders }
    );
  }

  let address: string;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(jwtSecret));
    if (typeof payload.address !== 'string') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: corsHeaders }
      );
    }
    address = payload.address.toLowerCase();
  } catch {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: corsHeaders }
    );
  }

  // Defensive re-check: ensure address is still allowlisted
  const adminWallets = (process.env.ADMIN_WALLETS || '')
    .split(',')
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length > 0);

  if (!adminWallets.includes(address)) {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403, headers: corsHeaders }
    );
  }

  return null;
}

/**
 * Count facts in a memory text. Memory texts are newline-separated facts.
 * Empty or `(empty)` placeholder returns 0.
 */
export function countFacts(text: string): number {
  if (!text || text === '(empty)') return 0;
  return text.split('\n').filter((f) => f.trim()).length;
}
