import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Etapa 17 — refinamento visual. O piloto (Gestão de Checklist › Aderência)
 * e a Manutenção sobre o kit de gráficos: acessibilidade nos dois temas,
 * semântica das variações, gráfico navegável por teclado e chips de filtro.
 */

const ADERENCIA = "/dev/preview-aderencia";

async function withTheme(page: import("@playwright/test").Page, url: string, theme: "light" | "dark") {
  await page.goto(url);
  await page.evaluate((t) => window.localStorage.setItem("hfm.theme", t), theme);
  await page.reload();
  await page.waitForFunction((t) => document.documentElement.classList.contains("dark") === (t === "dark"), theme);
}

for (const theme of ["light", "dark"] as const) {
  for (const url of [`${ADERENCIA}?aba=consolidada`, `${ADERENCIA}?aba=heatmap`, `${ADERENCIA}?aba=matriz`, "/dev/preview-manutencao"]) {
    test(`sem violações de acessibilidade (${theme}) em ${url}`, async ({ page }) => {
      await withTheme(page, url, theme);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const violations = results.violations.map((v) => ({ id: v.id, nodes: v.nodes.length, target: v.nodes[0]?.target?.join(" ") }));
      expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
    });
  }
}

test("KPIs do topo: variação com semântica de negócio", async ({ page }) => {
  await page.goto(ADERENCIA);
  const adherence = page.getByTestId("adherence-kpi-adherence");
  await expect(adherence).toContainText("88,89%");
  // +2,30 p.p. na aderência é bom (goodWhen = up).
  await expect(adherence.locator("[data-tone]")).toHaveAttribute("data-tone", "positive");
  // Desvio negativo contra a meta é ruim.
  const target = page.getByTestId("adherence-kpi-target");
  await expect(target).toContainText("-1,11 p.p.");
  await expect(target.locator("[data-tone]")).toHaveAttribute("data-tone", "negative");
  // Menos não realizados que no mês anterior é bom (goodWhen = down).
  const notDone = page.getByTestId("adherence-kpi-not-done");
  await expect(notDone.locator("[data-tone]")).toHaveAttribute("data-direction", "down");
  await expect(notDone.locator("[data-tone]")).toHaveAttribute("data-tone", "positive");
  // O tom do KPI aparece no acento, nunca no número.
  await expect(adherence).toHaveAttribute("data-status", "warning");
});

test("tendência mensal: meta tracejada e navegação por teclado com tooltip", async ({ page }) => {
  await page.goto(ADERENCIA);
  const chart = page.getByRole("group", { name: /Aderência mensal de 2026/ });
  await expect(page.getByRole("img", { name: /Aderência mensal de 2026/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /Aderência mensal de 2026/ }).getByText("Meta 90%")).toBeVisible();
  await chart.focus();
  await page.keyboard.press("Home");
  await expect(page.getByText("Janeiro/2026", { exact: true })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("Março/2026", { exact: true })).toBeVisible();
  await page.keyboard.press("End");
  await expect(page.getByText("Mês futuro")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Mês futuro")).toHaveCount(0);
});

test("filtros ativos viram chips removíveis", async ({ page }) => {
  await page.goto(`${ADERENCIA}?operacao=op2`);
  const chips = page.getByLabel("Filtros ativos");
  await expect(chips.getByText("Merchandising")).toBeVisible();
  await chips.getByRole("button", { name: "Remover filtro Operação: Merchandising" }).click();
  await expect(page).not.toHaveURL(/operacao=/);
});

test("heatmap: tooltip rico no foco da célula", async ({ page }) => {
  await page.goto(`${ADERENCIA}?aba=heatmap`);
  const dia22 = page.getByRole("grid", { name: "Dias de Setembro/2026" }).getByRole("gridcell", { name: /^2026-09-22/ });
  await dia22.focus();
  await expect(page.getByText("22/09/2026 · terça")).toBeVisible();
  await expect(page.getByText("Dia vigente · resultado provisório")).toBeVisible();
});
