import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Gestão de Frota → Gestão de KM Rodado.
 *
 * Roda contra `/dev/preview-km`, que executa os carregadores reais com as
 * saídas das rotinas gravadas do banco local (planilha oficial importada). O
 * que se prova aqui é a APRESENTAÇÃO; as regras (pipeline de importação,
 * classificação, coortes, rodízio, RLS e auditoria) estão no banco e são
 * cobertas por `supabase/tests/remote/29_km.sql`.
 */
const PREVIEW = "/dev/preview-km";
const TABS = [
  ["visao-geral", "Visão geral"],
  ["analise", "Análise gerencial"],
  ["planner", "Planner mês/dia"],
  ["diaria", "Visão diária"],
  ["historico", "Histórico por frota"],
  ["rodizio", "Plano de rodízio"],
  ["qualidade", "Qualidade de dados"],
  ["importacao", "Importação"],
  ["lotes", "Lotes"],
  ["relatorios", "Relatórios"],
] as const;

function crashesOf(page: Page) {
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));
  return crashes;
}

async function setTheme(page: Page, url: string, theme: "light" | "dark") {
  const response = await page.goto(url);
  expect(response?.status(), `${url} must be reachable in this build`).toBe(200);
  await page.evaluate((t) => window.localStorage.setItem("hfm.theme", t), theme);
  await page.reload();
  await page.waitForFunction((t) => document.documentElement.classList.contains("dark") === (t === "dark"), theme);
}

test.describe("gestão de KM rodado", () => {
  test("as dez abas oficiais, na ordem, e a entrada no menu Gestão de frota", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(PREVIEW);
    await expect(page.getByRole("heading", { name: "Gestão de KM Rodado", level: 1 })).toBeVisible();
    await expect(page.getByRole("tab")).toHaveText(TABS.map(([, label]) => label));
    const nav = page.getByRole("navigation", { name: "Navegação principal" });
    await expect(nav.getByRole("link", { name: "Gestão de KM Rodado" })).toHaveAttribute("href", "/frota/km");
    expect(crashes).toEqual([]);
  });

  test("a aba ativa fica visível mesmo quando as abas não cabem", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`${PREVIEW}?aba=relatorios`);
    await expect(page.getByTestId("km-tab-relatorios")).toHaveAttribute("data-state", "active");
    await expect(page.getByTestId("km-tab-relatorios")).toBeInViewport();
  });

  test("visão geral: KM do período, sem leitura não é 0 km e leituras calculadas", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(PREVIEW);
    const overview = page.getByTestId("km-visao-geral");
    await expect(overview.getByText("KM total do período", { exact: false }).first()).toBeVisible();
    await expect(overview.getByText("216.814").first()).toBeVisible();
    await expect(overview.getByText(/Sem leitura e Inconsistente não somam e nunca viram 0 km/)).toBeVisible();
    const insights = page.getByTestId("km-visao-geral-insights");
    await expect(insights.getByTestId("km-visao-geral-insight").first()).toBeVisible();
    await expect(insights.getByText(/75 de 88 frotas ativas têm leitura válida/)).toBeVisible();
    await expect(page.getByTestId("km-visao-geral-bottom")).toContainText("cobertura mínima");
    expect(crashes).toEqual([]);
  });

  test("planner: modo compacto/detalhado na URL e exportação do Controle Mensal", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=planner`);
    await expect(page.getByTestId("km-planner-grid")).toBeVisible();
    await expect(page.getByTestId("km-planner-legend")).toContainText("Sem leitura (não é 0 km)");
    const detailed = page.getByTestId("km-planner-mode-detalhado");
    await expect(detailed).toHaveAttribute("aria-checked", "false");
    await detailed.click();
    await expect(detailed).toHaveAttribute("aria-checked", "true");
    await expect(page).toHaveURL(/modo=detalhado/);
    await expect(page.getByTestId("km-planner-export")).toBeVisible();
    expect(crashes).toEqual([]);
  });

  test("visão diária: ranking só com KM validado e frotas sem leitura à parte", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=diaria`);
    await expect(page.getByTestId("km-diaria-ranking-row")).toHaveCount(10);
    const missing = page.getByTestId("km-diaria-without-reading");
    await expect(missing).toContainText("não é 0 km");
    await expect(missing.getByTestId("km-diaria-without-reading-row").first()).toBeVisible();
    expect(crashes).toEqual([]);
  });

  test("histórico: hodômetro e KM por dia do veículo, com troca de mês", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=historico`);
    await expect(page.getByTestId("km-historico-chart-odometer")).toBeVisible();
    await expect(page.getByTestId("km-historico-chart-km")).toBeVisible();
    const months = page.getByTestId("km-historico-month").getByRole("radio");
    expect(await months.count()).toBeGreaterThan(1);
    await months.first().click();
    await expect(months.first()).toHaveAttribute("aria-checked", "true");
    expect(crashes).toEqual([]);
  });

  test("rodízio: só sugere — nada é movimentado sem aprovação", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=rodizio`);
    await expect(page.getByTestId("km-rodizio-notice")).toContainText("O rodízio só sugere");
    await expect(page.getByTestId("km-rodizio-suggestion").first()).toBeVisible();
    expect(crashes).toEqual([]);
  });

  test("qualidade: score DQ no medidor e componentes com peso", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=qualidade`);
    await expect(page.getByTestId("km-qualidade-score-valor")).toContainText("92,8");
    await expect(page.getByTestId("km-qualidade-score")).toContainText("peso 50%");
    expect(crashes).toEqual([]);
  });

  test("importação: fonte oficial única (Base Geral KM Rodado.xlsx → Controle KM Rodado)", async ({ page }) => {
    await page.goto(`${PREVIEW}?aba=importacao`);
    await expect(page.getByText("Base Geral KM Rodado.xlsx → aba Controle KM Rodado").first()).toBeVisible();
  });

  test("perfil Liderança: sem Importação e Lotes", async ({ page }) => {
    await page.goto(`${PREVIEW}?perfil=lideranca`);
    await expect(page.getByTestId("km-tab-visao-geral")).toBeVisible();
    await expect(page.getByTestId("km-tab-importacao")).toHaveCount(0);
    await expect(page.getByTestId("km-tab-lotes")).toHaveCount(0);
  });

  test("celular: sem rolagem lateral da página", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const aba of ["visao-geral", "planner", "diaria"]) {
      await page.goto(`${PREVIEW}?aba=${aba}`);
      await expect(page.getByRole("heading", { name: "Gestão de KM Rodado", level: 1 })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `aba ${aba}`).toBeLessThanOrEqual(1);
    }
  });

  for (const theme of ["light", "dark"] as const) {
    test(`acessibilidade (${theme}): visão geral, planner e qualidade sem violações`, async ({ page }) => {
      for (const aba of ["visao-geral", "planner", "qualidade"]) {
        await setTheme(page, `${PREVIEW}?aba=${aba}`, theme);
        await expect(page.getByRole("heading", { name: "Gestão de KM Rodado", level: 1 })).toBeVisible();
        // Abas hidratadas: a lista vira parada de tabulação (antes disso a lista rolável não tem foco).
        await page.waitForFunction(() => Boolean(document.querySelector('[role="tablist"][tabindex="0"]')));
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        expect(results.violations.map((v) => `${aba}: ${v.id} (${v.nodes.length})`)).toEqual([]);
      }
    });
  }
});
