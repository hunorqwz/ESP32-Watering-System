import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

export default function middleware(req, event) {
  const authHeader = req.headers.get('authorization');
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  const secretToken = process.env.API_ACCESS_TOKEN;

  // Bypass session authentication if a valid Bearer Token is supplied in the headers
  if (secretToken && token === secretToken) {
    return NextResponse.next();
  }

  // Fallback to NextAuth session verification
  return withAuth(
    function middleware(req) {
      return NextResponse.next();
    },
    {
      callbacks: {
        authorized: ({ token }) => !!token
      }
    }
  )(req, event);
}

export const config = {
  matcher: [
    '/',
    '/api/command/:path*',
    '/api/config/:path*',
    '/api/dashboard/:path*',
    '/api/notes/:path*',
    '/api/pump/:path*',
    '/api/sensor/:path*',
    '/api/schedule/:path*',
    '/api/refresh/:path*'
  ]
};
