/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return {
      beforeFiles: [
        // Proxy all /api requests to Fastify backend
        {
          source: '/api/:path*',
          destination: 'http://localhost:3001/api/:path*',
        },
      ],
    };
  },
};

export default nextConfig;
