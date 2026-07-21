// Backend base (server-side only — never exposed to the browser). The lead
// form posts to a same-origin /api/onboarding/* path which is proxied here to
// the unchanged backend_controller endpoint, so there is no cross-origin/CORS
// dependency and the backend host stays private.
const BACKEND = (process.env.BEO_API_BASE || 'http://127.0.0.1:47502').replace(/\/$/, '');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Produce a self-contained server bundle (.next/standalone/server.js) for the
  // production Docker image. Pairs with outputFileTracingRoot below so workspace
  // hoisting does not break the trace.
  output: 'standalone',
  // This app lives inside an npm workspace but is a standalone Next.js build.
  // Keep its file-tracing root at the package so workspace hoisting does not
  // confuse the build. (Top-level in Next 15+; under experimental in Next 14.)
  experimental: {
    outputFileTracingRoot: import.meta.dirname,
  },
  async rewrites() {
    // Onboarding is handled by the /api/onboarding/applications route handler
    // (maps to the canonical POST /v1/applications). Other same-origin /v1/*
    // calls are proxied to the backend server-side.
    return [
      {
        source: '/v1/:path*',
        destination: `${BACKEND}/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
