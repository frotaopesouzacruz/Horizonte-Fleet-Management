/**
 * Captures the reference screenshots used to review the design in both themes
 * and at every breakpoint. Not part of the test suite.
 *
 *   node --experimental-strip-types tests/ui/screenshots.ts   (or: npx tsx …)
 *
 * Requires the app to be running at PLAYWRIGHT_BASE_URL (default :3000).
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const OUT = process.env.SCREENSHOT_DIR ?? "tests/ui/.screenshots";

const surfaces = [
  { name: "login", url: "/login", full: false },
  { name: "dashboard", url: "/dashboard", full: true },
  { name: "design-system", url: "/dev/design-system", full: true },
];

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });

  for (const theme of ["light", "dark"] as const) {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();

      for (const surface of surfaces) {
        await page.goto(`${BASE}${surface.url}`);
        await page.evaluate((t) => window.localStorage.setItem("hfm.theme", t), theme);
        await page.reload();
        // Wait for the brand assets themselves: `networkidle` can stay stuck on
        // requests Chromium served from its memory cache.
        await page.waitForFunction(
          (t) => document.documentElement.classList.contains("dark") === (t === "dark"),
          theme,
        );
        // Only the images that actually have a box: below `lg` the institutional
        // artwork and the sidebar are `display:none`, so they are never fetched
        // there — by design, and a mobile surface may legitimately show none.
        await page.waitForFunction(() =>
          Array.from(document.images)
            .filter((image) => image.getBoundingClientRect().width > 0)
            .every((image) => image.complete && image.naturalWidth > 0),
        );
        await page.waitForLoadState("load");
        await page.screenshot({
          path: `${OUT}/${surface.name}-${theme}-${viewport.name}.png`,
          fullPage: surface.full,
        });
        process.stdout.write(`captured ${surface.name}-${theme}-${viewport.name}\n`);
      }
      await context.close();
    }
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
