import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow 127.0.0.1 in addition to localhost for dev (Turbopack HMR / hydration)
  allowedDevOrigins: ["127.0.0.1"],

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
