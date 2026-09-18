import { test, expect, type Page } from "@playwright/test";
import { canAuthenticate, signIn, SKIP_REASON } from "./auth";

/**
 * UI validation for the Horizonte design system: themes, persistence,
 * responsive app shell and the main surfaces. Runs against a production build.
 */

const THEME_KEY = "hfm.theme";

async function setTheme(page: Page, theme: "light" | "dark" | "system") {
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key, value),
    [THEME_KEY, theme] as const,
  );
  await page.reload();
}

async function htmlClass(page: Page) {
  return page.evaluate(() => document.documentElement.className);
}

test.describe("theme", () => {
  test("light, dark and system resolve and persist across reloads", async ({ page }) => {
    await page.goto("/login");

    await setTheme(page, "light");
    expect(await htmlClass(page)).not.toContain("dark");
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    await setTheme(page, "dark");
    expect(await htmlClass(page)).toContain("dark");
    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(darkBg).not.toBe(lightBg);

    // survives a reload without touching storage again
    await page.reload();
    expect(await htmlClass(page)).toContain("dark");

    await setTheme(page, "system");
    const stored = await page.evaluate((key) => window.localStorage.getItem(key), THEME_KEY);
    expect(stored).toBe("system");
  });

  test("system preference follows the OS setting", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();
    await page.goto("/login");
    await page.evaluate((key) => window.localStorage.setItem(key, "system"), THEME_KEY);
    await page.reload();
    expect(await htmlClass(page)).toContain("dark");
    await context.close();
  });

  test("no flash of the wrong theme on first paint", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/login");
    await page.evaluate((key) => window.localStorage.setItem(key, "dark"), THEME_KEY);

    // The theme class must already be present when the document is parsed,
    // before React hydrates.
    await page.goto("/login", { waitUntil: "commit" });
    const classAtCommit = await page
      .waitForFunction(() => document.documentElement.className)
      .then((handle) => handle.jsonValue());
    expect(String(classAtCommit)).toContain("dark");
    await context.close();
  });

  test("one click switches the theme on the login screen", async ({ page }) => {
    await page.goto("/login");
    await setTheme(page, "light");

    // The institutional surfaces carry a switch, not a menu: one click, one
    // outcome, and the icon names the destination rather than the current state.
    await page.getByRole("button", { name: "Ativar tema escuro" }).click();
    await expect.poll(() => htmlClass(page)).toContain("dark");

    await page.getByRole("button", { name: "Ativar tema claro" }).click();
    await expect.poll(() => htmlClass(page)).not.toContain("dark");

    // and the choice survives a reload
    await page.reload();
    expect(await htmlClass(page)).not.toContain("dark");
  });
});

test.describe("app shell", () => {
  // The shell lives behind authentication now, so these need a real session.
  test.beforeEach(async ({ page }) => {
    test.skip(!canAuthenticate, SKIP_REASON);
    await signIn(page);
  });

  test("sidebar expands, collapses and persists", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");

    const sidebarNav = page.getByRole("navigation", { name: "Navegação principal" });
    await expect(sidebarNav).toBeVisible();
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();

    await page.getByRole("button", { name: "Recolher menu" }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.sidebar)).toBe("collapsed");

    await page.reload();
    expect(await page.evaluate(() => document.documentElement.dataset.sidebar)).toBe("collapsed");

    await page.getByRole("button", { name: "Expandir menu" }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.sidebar)).toBe("expanded");
  });

  test("mobile uses a drawer instead of the fixed sidebar", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard");

    await expect(page.getByRole("navigation", { name: "Navegação principal" })).toBeHidden();
    await page.getByRole("button", { name: "Abrir menu" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Navegação principal" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("no horizontal overflow at any supported width", async ({ page }) => {
    for (const width of [390, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/dashboard");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `viewport ${width}px`).toBeLessThanOrEqual(1);
    }
  });
});

test.describe("login", () => {
  // Password inputs expose no ARIA role, so they are addressed by name attribute.
  const passwordField = (page: Page) => page.locator('input[name="password"]');

  test("renders the brand surfaces and validates the form", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");

    await expect(page.getByRole("heading", { name: "Horizonte Fleet Management" })).toBeVisible();

    // The official files must decode: when one is missing the logo degrades to a
    // plain wordmark, which is precisely what must never reach a screen.
    const logo = page.getByRole("img", { name: "Horizonte Fleet Management" });
    await expect(logo).toHaveAttribute("src", /logo-light/);
    await expect
      .poll(() => logo.evaluate((el) => (el as HTMLImageElement).naturalWidth ?? 0), { timeout: 20_000 })
      .toBeGreaterThan(0);

    const artwork = page.locator('img[src*="background-light"]');
    await expect
      .poll(() => artwork.evaluate((el) => (el as HTMLImageElement).naturalWidth ?? 0), { timeout: 20_000 })
      .toBeGreaterThan(0);

    await page.getByRole("button", { name: "Acessar Sistema" }).click();
    await expect(page.getByText("Informe sua matrícula ou e-mail.")).toBeVisible();

    // One field takes both, so a matrícula must clear the error just as an e-mail does.
    await page.getByRole("textbox", { name: "Matrícula ou e-mail" }).fill("140349");
    await passwordField(page).fill("senha-de-teste");
    await expect(page.getByText("Informe sua matrícula ou e-mail.")).toBeHidden();

    await page.getByRole("button", { name: "Mostrar senha" }).click();
    await expect(passwordField(page)).toHaveAttribute("type", "text");
  });

  test("every control on the form is keyboard reachable in order", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("textbox", { name: "Matrícula ou e-mail" }).focus();

    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Esqueci minha senha" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(passwordField(page)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Mostrar senha" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Acessar Sistema" })).toBeFocused();
  });

  test("no horizontal overflow, and the form survives, at every supported width", async ({ page }) => {
    // The login screen is the one surface every person meets before there is a
    // session, so its responsiveness cannot ride on the authenticated tests.
    for (const width of [1920, 1600, 1440, 1366, 1280, 1024, 768, 430, 390]) {
      await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
      await page.goto("/login");

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `viewport ${width}px`).toBeLessThanOrEqual(1);

      // Below lg the institutional column is dropped; authentication is not.
      await expect(page.getByRole("textbox", { name: "Matrícula ou e-mail" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Acessar Sistema" })).toBeVisible();
      await expect(page.locator('input[name="password"]')).toBeVisible();
    }
  });

  test("the institutional carousel is operable and stops for a pointer", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");

    const panel = page.getByRole("region", { name: "Horizonte Fleet Management" });
    await expect(panel).toBeVisible();

    // Auto-advancing content has to be reachable by hand, or WCAG 2.2.2 is a
    // promise the screen does not keep.
    const second = panel.getByRole("button", { name: "Gestão Inteligente de Frotas" });
    await second.click();
    await expect(second).toHaveAttribute("aria-current", "true");
    await expect(panel.getByRole("heading", { level: 2 })).toContainText("Gestão Inteligente de");
  });
});

test.describe("design system page", () => {
  test("is reachable in this build and renders every section", async ({ page }) => {
    await page.goto("/dev/design-system");
    await expect(page.getByRole("heading", { name: "Design System" })).toBeVisible();

    for (const tab of ["Fundamentos", "Controles", "Exibição de dados", "Feedback"]) {
      await page.getByRole("tab", { name: tab }).click();
      await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("data-state", "active");
    }
  });
});
