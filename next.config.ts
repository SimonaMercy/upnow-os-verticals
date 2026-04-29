import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
};

export default nextConfig;
