import { NextResponse } from 'next/server';

const ALLOWED_ORIGIN = process.env.ADMIN_DASHBOARD_URL;

export function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin');

  if (!ALLOWED_ORIGIN || !origin || origin !== ALLOWED_ORIGIN) {
    return {};
  }

  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export function corsOptions(request: Request): NextResponse {
  const headers = getCorsHeaders(request);

  return new NextResponse(null, {
    status: 204,
    headers,
  });
}

export function corsErrorResponse(
  request: Request,
  status: number,
  error: string
): NextResponse {
  return NextResponse.json(
    { error },
    { status, headers: getCorsHeaders(request) }
  );
}
