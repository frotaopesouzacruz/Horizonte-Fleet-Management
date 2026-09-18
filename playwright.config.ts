import { defineConfig, devices } from "@playwright/test";

/**
 * UI validation: light/dark/system themes, responsive shell, accessibility.
 * Runs against the production build (`next build && next start`).
 */
export default defineConfig({
  testDir: "./tests/ui",
  globalSetup: "./tests/ui/global-setup.ts",
  timeout: 60_000,
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  outputDir: "./tests/ui/.results",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "off",
    screenshot: "off",
    ...devices["Desktop Chrome"],
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
    },
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run start -- --port 3000",
        url: "http://127.0.0.1:3000/login",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
