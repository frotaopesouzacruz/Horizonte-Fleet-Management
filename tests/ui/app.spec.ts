import { test, expect, type Page } from "@playwright/test";

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

  test("theme menu switches the applied theme", async ({ page }) => {
    await page.goto("/login");
    await setTheme(page, "light");
    await page.getByRole("button", { name: "Alterar tema" }).click();
    await page.getByRole("menuitemradio", { name: "Escuro" }).click();
    await expect.poll(() => htmlClass(page)).toContain("dark");
  });
});

test.describe("app shell", () => {
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

    await expect(page.getByRole("heading", { name: "Acessar o sistema" })).toBeVisible();

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

    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByText("Informe um e-mail válido.")).toBeVisible();

    await page.getByRole("textbox", { name: "E-mail corporativo" }).fill("operacao@horizonte.com.br");
    await passwordField(page).fill("senha-de-teste");
    await expect(page.getByText("Informe um e-mail válido.")).toBeHidden();

    await page.getByRole("button", { name: "Mostrar senha" }).click();
    await expect(passwordField(page)).toHaveAttribute("type", "text");
  });

  test("every control on the form is keyboard reachable in order", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("textbox", { name: "E-mail corporativo" }).focus();

    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Esqueci minha senha" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(passwordField(page)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Mostrar senha" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("checkbox", { name: /Manter conectado/ })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Entrar" })).toBeFocused();
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
