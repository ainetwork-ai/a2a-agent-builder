import { NextRequest, NextResponse } from 'next/server';
import { getCorsHeaders } from './utils/cors';

/**
 * Verify the X-Admin-Secret header against the ADMIN_API_KEY environment variable.
 *
 * @param request - The incoming Next.js request
 * @returns A 401 NextResponse on auth failure, or `null` on success.
 *          Callers should check for `null` and proceed with their handler logic.
 */
export function verifyAdminSecret(request: NextRequest): NextResponse | null {
  const adminSecret = request.headers.get('X-Admin-Secret');
  const adminApiKey = process.env.ADMIN_API_KEY;

  if (!adminSecret || !adminApiKey || adminSecret !== adminApiKey) {
    const corsHeaders = getCorsHeaders(request);
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: corsHeaders }
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
