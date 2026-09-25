import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The project documents its own conventions in docs/; no generated agent files.
  agentRules: false,
  experimental: {
    serverActions: {
      // Imports have no row ceiling: the browser reads the spreadsheet and sends
      // the rows in parts of about 1.2 MB each. The default 1 MB would reject a
      // part; 4 MB keeps a margin and stays under the host's 4.5 MB request cap.
      bodySizeLimit: "4mb",
    },
  },
  images: {
    // The official brand artwork is heavy (140 KB logos, 210 KB photographs);
    // serve right-sized modern formats instead of shipping the originals.
    // WebP only: AVIF saves a few kB but costs seconds of CPU per cold variant
    // on a self-hosted server, which the first visitor of every size pays for.
    formats: ["image/webp"],
    // 75 for ordinary imagery, 90 for the login artwork, 100 for the logo.
    // The hero is the first thing anyone sees of this product and the source is
    // only 1672 x 941 — there is no headroom to spend on saving 40 kB, so it is
    // served at 90. Flat colour and hard edges in the mark show ringing at
    // anything below 100.
    qualities: [75, 90, 100],
  },
};

export default nextConfig;
