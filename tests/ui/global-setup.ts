/**
 * Warms the optimized brand variants before the suite starts.
 *
 * The very first request for a variant that `next/image` has not produced yet is
 * the only slow one. When two Playwright workers open their first page at the
 * same instant they race for exactly the same variant, and one of the two
 * browsers can sit on that request far longer than any sane assertion timeout.
 * The server is not the bottleneck — the same pair of requests issued with curl
 * answers in under 100 ms — so this is a runner artifact, not a product defect,
 * and the suite still asserts that every brand asset decodes.
 */
const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

// Only widths Next actually serves (its imageSizes / deviceSizes); anything else is a 400.
const LOGO_WIDTHS = [96, 128, 256];
const BACKGROUND_WIDTHS = [640, 750, 828, 1080, 1200];

const variants = [
  ...["/brand/logo-light.png", "/brand/logo-dark.png"].flatMap((file) =>
    LOGO_WIDTHS.map((w) => `${BASE}/_next/image?url=${encodeURIComponent(file)}&w=${w}&q=100`),
  ),
  ...["/brand/background-light.webp", "/brand/background-dark.webp"].flatMap((file) =>
    BACKGROUND_WIDTHS.map((w) => `${BASE}/_next/image?url=${encodeURIComponent(file)}&w=${w}&q=75`),
  ),
];

async function waitForServer(deadline: number) {
  for (;;) {
    try {
      const response = await fetch(`${BASE}/login`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`${BASE} never became reachable`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export default async function globalSetup() {
  await waitForServer(Date.now() + 120_000);
  for (const url of variants) {
    const response = await fetch(url, { headers: { accept: "image/webp,*/*" } });
    if (!response.ok) throw new Error(`brand asset failed to optimize: ${url} -> ${response.status}`);
    await response.arrayBuffer();
  }
}
