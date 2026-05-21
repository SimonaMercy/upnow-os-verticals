import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow all LAN origins in dev so other devices on the network can connect
  allowedDevOrigins: ["127.0.0.1", "192.168.2.126"],

  // Standalone output for Docker / AWS Amplify SSR deployments
  output: "standalone",

  images: {
    remotePatterns: [
      // AWS S3 for uploaded assets
      { protocol: "https", hostname: "*.amazonaws.com" },
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
