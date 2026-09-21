import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { canAuthenticate, signIn, SKIP_REASON } from "./auth";

/**
 * Accessibility checks (WCAG 2.1 A/AA) on every surface, in both themes.
 * Colour contrast is included: the token palette has to hold up in light and dark.
 */

const THEME_KEY = "hfm.theme";

async function withTheme(page: Page, url: string, theme: "light" | "dark") {
  const response = await page.goto(url);
  // A 404 page has no violations either: without this the whole surface would
  // pass vacuously whenever a route is missing from the build under test.
  expect(response?.status(), `${url} must be reachable in this build`).toBe(200);
  await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [THEME_KEY, theme] as const);
  await page.reload();

  // Not `networkidle`: Chromium does not always report a request served from its
  // memory cache as finished, so the in-flight count can stay stuck for a page
  // that is fully painted. Wait for what the check actually depends on — the
  // theme applied, and every image decoded, so contrast is measured on the real
  // brand assets rather than on empty boxes.
  await page.waitForFunction((t) => document.documentElement.classList.contains("dark") === (t === "dark"), theme);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          // Only the images that actually have a box: the institutional artwork
          // is `display:none` below `lg`, so it is never fetched there.
          const images = Array.from(document.images).filter((image) => image.getBoundingClientRect().width > 0);
          return images.length > 0 && images.every((image) => image.complete && image.naturalWidth > 0);
        }),
      { timeout: 20_000 },
    )
    .toBe(true);
}

/** Reachable without a session. */
const publicSurfaces = [
  { name: "login", url: "/login" },
  { name: "recuperar-acesso", url: "/recuperar-acesso" },
  { name: "design-system", url: "/dev/design-system" },
  // Organização → Operações and Estados e cidades, rendered against fixed
  // data. The real routes need a session; this is the same markup.
  { name: "organizacao (preview)", url: "/dev/preview-organizacao" },
  // The densest screen in the product: twelve columns, eight filters and
  // four indicators, all of which have to clear contrast in both themes.
  { name: "usuarios (preview)", url: "/dev/preview-usuarios" },
  // The permission matrix is a grid of dozens of ✓/— cells carrying meaning by
  // colour; it is exactly the kind of thing that fails contrast in one theme
  // only and is never noticed.
  { name: "perfis (preview)", url: "/dev/preview-perfis" },
  // Cadastro de frotas: dezesseis colunas, nove filtros, seis indicadores e
  // três escalas de badge. Mais superfície colorida do que qualquer outra tela.
  { name: "frota (preview)", url: "/dev/preview-frota" },
  // Três escalas de badge na mesma tabela — situação, origem e avisos de
  // configuração —, que é a forma que falha contraste em um tema só.
  { name: "tipos de equipamento (preview)", url: "/dev/preview-tipos-equipamento" },
];

/** Behind the app shell: need a real session against a reachable Supabase. */
const authenticatedSurfaces = [
  { name: "dashboard", url: "/dashboard" },
  { name: "administracao/usuarios", url: "/administracao/usuarios" },
];

for (const surface of [...publicSurfaces, ...authenticatedSurfaces]) {
  const needsSession = authenticatedSurfaces.includes(surface);

  for (const theme of ["light", "dark"] as const) {
    test(`${surface.name} has no accessibility violations (${theme})`, async ({ page }) => {
      test.skip(needsSession && !canAuthenticate, SKIP_REASON);
      if (needsSession) await signIn(page);
      await withTheme(page, surface.url, theme);

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        // Token documentation shows colours (including the disabled one) as text
        // on purpose; contrast rules do not apply to a colour specimen.
        .exclude("[data-token-specimen]")
        .analyze();

      const violations = results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.length,
        help: v.help,
        target: v.nodes[0]?.target?.join(" "),
      }));

      expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
    });
  }
}

test("interactive elements expose an accessible name", async ({ page }) => {
  test.skip(!canAuthenticate, SKIP_REASON);
  await signIn(page);
  await page.goto("/dashboard");
  const unnamed = await page.evaluate(() => {
    const isNamed = (el: Element) => {
      const aria = el.getAttribute("aria-label") ?? el.getAttribute("aria-labelledby") ?? el.getAttribute("title");
      return Boolean(aria?.trim()) || Boolean(el.textContent?.trim());
    };
    return Array.from(document.querySelectorAll("button, a[href]"))
      .filter((el) => !isNamed(el))
      .map((el) => el.outerHTML.slice(0, 120));
  });
  expect(unnamed).toEqual([]);
});
