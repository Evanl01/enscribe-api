import { NextResponse } from 'next/server'

export function middleware(request) {
  // Handle CORS for API routes only
  if (request.nextUrl.pathname.startsWith('/api/')) {
    // Production-ready allowed origins
    const allowedOrigins = [
      // Production origins
      'https://d2okt95q961mml.cloudfront.net',
      'https://enscribe-web-prod-static.s3.amazonaws.com',
      'https://enscribe.sjpedgi.doctor',
      'https://enscribe-web.vercel.app',
      'https://emscribe.vercel.app',
      
      // Development origins
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
    ]

    const origin = request.headers.get('origin')
    
    // Handle preflight requests FIRST
    if (request.method === 'OPTIONS') {
      const headers = new Headers()
      
      // Set CORS headers for preflight
      if (origin && allowedOrigins.includes(origin)) {
        headers.set('Access-Control-Allow-Origin', origin)
      }
      headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
      headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With')
      headers.set('Access-Control-Allow-Credentials', 'true')
      headers.set('Access-Control-Max-Age', '86400')
      
      return new Response(null, {
        status: 200,
        headers: headers
      })
    }

    // For non-preflight requests
    const response = NextResponse.next()

    // Check if the request origin is in our allowed list
    if (origin && allowedOrigins.includes(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin)
    }

    // Set other CORS headers
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With')
    response.headers.set('Access-Control-Allow-Credentials', 'true')
    response.headers.set('Access-Control-Max-Age', '86400')

    return response
  }

  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*'
}