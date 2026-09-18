import type { Page, BrowserContext } from "@playwright/test";

/**
 * Signing in needs a reachable Supabase project and a real account, so the
 * authenticated surfaces are only exercised when both are configured:
 *
 *   HFM_E2E_EMAIL=... HFM_E2E_PASSWORD=... npm run test:ui
 *
 * Without them the suite still covers everything that does not require a
 * session, and the skipped tests say why instead of silently passing.
 */
export const E2E_EMAIL = process.env.HFM_E2E_EMAIL;
export const E2E_PASSWORD = process.env.HFM_E2E_PASSWORD;
export const canAuthenticate = Boolean(E2E_EMAIL && E2E_PASSWORD);

export const SKIP_REASON =
  "Set HFM_E2E_EMAIL and HFM_E2E_PASSWORD (and make the Supabase project reachable) to run the authenticated surfaces.";

/** Signs in through the real login form and waits for the shell. */
export async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "E-mail corporativo" }).fill(E2E_EMAIL!);
  await page.locator('input[name="password"]').fill(E2E_PASSWORD!);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
}

export async function signedInContext(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await signIn(page);
  return page;
}
