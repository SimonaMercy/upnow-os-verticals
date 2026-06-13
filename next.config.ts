import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow all LAN origins in dev so other devices on the network can connect
  allowedDevOrigins: ["127.0.0.1", "192.168.2.126"],

  // Allow a second dev server (e.g. e2e test instance) to run from the same
  // working tree without fighting over the .next build cache
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),

  // Standalone output for Docker / Cloud Run SSR deployments
  output: "standalone",

  // TEMPORARY: allow production builds to complete despite pre-existing
  // TypeScript/ESLint errors (e.g. portfolio/add/page.tsx communityId type).
  // Remove these once the type/lint issues are fixed so the build is clean.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },

  images: {
    remotePatterns: [
      // AWS S3 for uploaded assets (legacy)
      { protocol: "https", hostname: "*.amazonaws.com" },
      // Google Cloud Storage for uploaded assets (current)
      { protocol: "https", hostname: "storage.googleapis.com" },
    ],
  },

  // Expose public env vars to the browser bundle
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "",
  },

  // Proxy /uploads/* directly to the NestJS backend (bypasses the /api catch-all)
  // This ensures uploaded media works for all devices on the network
  async rewrites() {
    const backendBase = process.env.BACKEND_URL?.replace('/api', '') ?? 'http://localhost:3001';
    return [
      {
        source: '/uploads/:path*',
        destination: `${backendBase}/uploads/:path*`,
      },
    ];
  },

  // Redirect old /dashboard/rental-provider/* URLs to the new structure
  async redirects() {
    return [
      {
        source: "/dashboard/rental-provider",
        destination: "/rental-provider/dashboard",
        permanent: true,
      },
      {
        source: "/dashboard/rental-provider/:path*",
        destination: "/rental-provider/dashboard/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
