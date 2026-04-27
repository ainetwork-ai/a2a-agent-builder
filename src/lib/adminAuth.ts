import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { corsErrorResponse } from './utils/cors';

const ADMIN_WALLETS_SET = new Set(
  (process.env.ADMIN_WALLETS || '')
    .split(',')
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length > 0)
);

export function isAdminWallet(address: string): boolean {
  return ADMIN_WALLETS_SET.has(address.toLowerCase());
}

/**
 * Verify the `Authorization: Bearer <token>` header against a JWT issued by
 * `POST /api/admin/auth/verify`.
 *
 * Status mapping:
 * - 401: missing/invalid header, JWT_SECRET unset, JWT verification failure
 * - 403: address valid but no longer present in ADMIN_WALLETS
 */
export async function verifyAdminJwt(request: NextRequest): Promise<NextResponse | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return corsErrorResponse(request, 401, 'Unauthorized');
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) return corsErrorResponse(request, 401, 'Unauthorized');

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    console.warn('⚠️  [admin] JWT_SECRET is not configured');
    return corsErrorResponse(request, 401, 'Unauthorized');
  }

  let address: string;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(jwtSecret));
    if (typeof payload.address !== 'string') {
      return corsErrorResponse(request, 401, 'Unauthorized');
    }
    address = payload.address.toLowerCase();
  } catch {
    return corsErrorResponse(request, 401, 'Unauthorized');
  }

  if (!isAdminWallet(address)) {
    return corsErrorResponse(request, 403, 'Forbidden');
  }

  return null;
}
