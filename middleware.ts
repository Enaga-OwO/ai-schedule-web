import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === '/records') {
    return NextResponse.rewrite(new URL('/records.html', request.url));
  }
}

export const config = {
  matcher: '/records',
};
