import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The project documents its own conventions in docs/; no generated agent files.
  agentRules: false,
  images: {
    // The official brand artwork is heavy (140 KB logos, 210 KB photographs);
    // serve right-sized modern formats instead of shipping the originals.
    // WebP only: AVIF saves a few kB but costs seconds of CPU per cold variant
    // on a self-hosted server, which the first visitor of every size pays for.
    formats: ["image/webp"],
    // 100 is reserved for the logo: flat colour and hard edges show ringing at
    // the default quality, and the mark must not degrade.
    qualities: [75, 100],
  },
};

export default nextConfig;
