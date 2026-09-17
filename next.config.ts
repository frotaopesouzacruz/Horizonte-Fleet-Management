import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The project documents its own conventions in docs/; no generated agent files.
  agentRules: false,
  images: {
    // The official brand photographs are large PNGs; serve modern formats
    // derived from them instead of shipping the originals.
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
