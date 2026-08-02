import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // firebase-admin is server-only. Keep it out of any client bundle and let
  // Cloud Run resolve it natively rather than tracing it into the RSC build.
  serverExternalPackages: ['firebase-admin'],
  experimental: {
    // Availability payloads and the quick-book proposal are small; the default
    // 1 MB body limit is plenty. Stated explicitly so it is a decision.
    serverActions: { bodySizeLimit: '1mb' },
  },
};

export default nextConfig;
