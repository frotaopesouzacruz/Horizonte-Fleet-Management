import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Segurança → Gestão de MTSR.
 *
 * Roda contra `/dev/preview-mtsr` (e `/dev/preview-mtsr/ficha`), que executa
 * os carregadores reais com as saídas das rotinas `mtsr_*` gravadas em
 * fixtures. O que se prova aqui é a APRESENTAÇÃO: abas por permissão, KPIs sem
 * zero de fachada, gráficos próprios, matriz com link para a ficha, filas de
 * vistoria, cadastros com formulários e a ficha 360°. As regras (prazo,
 * conformidade, criticidade, validação, ingestão, RLS) estão no banco e são
 * cobertas por `supabase/tests/remote/31_mtsr.sql`.
 */
const PREVIEW = "/dev/preview-mtsr";
const FICHA = "/dev/preview-mtsr/ficha";
const TABS = [
  ["visao-geral", "Visão geral"],
  ["conformidade", "Conformidade"],
  ["vistorias", "Vistorias recebidas"],
  ["manutencoes", "Manutenções"],
  ["ingestao", "Ingestão"],
  ["cadastros", "Cadastros"],
  ["auditoria", "Auditoria"],
  ["saude", "Saúde e cobertura"],
] as const;
const COMPONENTS = ["mdvr", "cameras", "teclado_macro", "travas_bau_lateral", "travas_bau_traseiro", "sirene_sistema", "geotab"];

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

test.describe("gestão de MTSR", () => {
  test("as oito abas oficiais, na ordem, e a entrada no menu Segurança", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(PREVIEW);
    await expect(page.getByRole("heading", { name: "Gestão de MTSR", level: 1 })).toBeVisible();
    await expect(page.getByTestId("mtsr-view").getByRole("tab")).toHaveText(TABS.map(([, label]) => label));
    const nav = page.getByRole("navigation", { name: "Navegação principal" });
    await expect(nav.getByRole("link", { name: "Gestão de MTSR" })).toHaveAttribute("href", "/seguranca/mtsr");
    expect(crashes).toEqual([]);
  });

  test("a Liderança vê só as abas que suas permissões liberam — nada decidido por nome de perfil", async ({ page }) => {
    await page.goto(`${PREVIEW}?perfil=lideranca&aba=cadastros`);
    await expect(page.getByTestId("mtsr-view").getByRole("tab")).toHaveText(["Visão geral", "Conformidade", "Vistorias recebidas", "Manutenções", "Saúde e cobertura"]);
    // Aba não liberada cai para a primeira visível, sem erro.
    await expect(page.getByTestId("mtsr-tab-visao-geral")).toHaveAttribute("data-state", "active");
    await expect(page.getByTestId("mtsr-visao-geral")).toBeVisible();
  });

  test("visão geral: regra vigente, KPIs com os números do banco e gráficos próprios (SVG)", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=visao-geral`);
    const panel = page.getByTestId("mtsr-visao-geral");
    await expect(panel.getByTestId("mtsr-visao-geral-rule")).toContainText("29");
    await expect(panel.getByTestId("mtsr-visao-geral-rule")).toContainText("45");

    const kpis = page.getByTestId("mtsr-visao-geral-kpis");
    await expect(kpis).toContainText("Frota monitorada");
    await expect(kpis).toContainText("24");
    await expect(kpis).toContainText("62,5%");
    await expect(page.getByTestId("mtsr-visao-geral-kpis-criticality")).toContainText("Críticas");

    for (const chart of ["by-component", "by-criticality", "by-deadline", "by-conformity", "by-operation", "ranking-nok", "maintenance-status", "maintenance-aging"]) {
      const card = panel.getByTestId(`mtsr-visao-geral-${chart}`);
      await expect(card, chart).toBeVisible();
      expect(await card.locator("svg").count(), `${chart} desenha o próprio gráfico`).toBeGreaterThan(0);
    }
    // Sem biblioteca de gráficos de prateleira.
    expect(await page.locator(".recharts-wrapper").count()).toBe(0);
    expect(crashes).toEqual([]);
  });

  test("conformidade: matriz paginada no servidor, resumo, link para a ficha e agrupamento por operação", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=conformidade`);
    const table = page.getByTestId("mtsr-conformity-table");
    await expect(table).toBeVisible();
    await expect(page.getByTestId("mtsr-conformity-row")).toHaveCount(24);
    await expect(page.getByTestId("mtsr-conformity-summary")).toContainText("Não conformes");
    await expect(page.getByTestId("mtsr-conformity-summary-nao-conforme")).toContainText("9");

    // Uma célula por componente do catálogo, na ordem de prioridade.
    const header = table.getByRole("columnheader");
    await expect(header.filter({ hasText: "MDVR" })).toHaveCount(1);
    await expect(header.filter({ hasText: "Geotab" })).toHaveCount(1);

    const plate = page.getByTestId("mtsr-conformity-plate").first();
    await expect(plate).toHaveAttribute("href", /\/seguranca\/mtsr\/veiculos\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("mtsr-conformity-export")).toBeVisible();

    await page.goto(`${PREVIEW}?aba=conformidade&agrupar=operacao`);
    await expect(page.getByTestId("mtsr-conformity-group")).toHaveCount(4);
    await expect(page.getByTestId("mtsr-conformity-row")).toHaveCount(24);
    await page.getByTestId("mtsr-conformity-group-toggle").first().click();
    expect(await page.getByTestId("mtsr-conformity-row").count()).toBeLessThan(24);
    expect(crashes).toEqual([]);
  });

  test("vistorias recebidas: KPIs, fila com situação e a gaveta não quebra sem sessão", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=vistorias`);
    await expect(page.getByTestId("mtsr-kpi-vistorias-pendentes")).toContainText("5");
    await expect(page.getByTestId("mtsr-kpi-vistorias-com-nok")).toContainText("3");
    await expect(page.getByTestId("mtsr-kpi-vistorias-acima-sla")).toContainText("2");
    await expect(page.getByTestId("mtsr-inspection-row")).toHaveCount(12);
    await expect(page.getByTestId("mtsr-inspections-table")).toContainText("MTSR-2026-000100");
    await expect(page.getByTestId("mtsr-inspections-table")).toContainText("Maria Clara Souza");
    await expect(page.getByTestId("mtsr-inspections-status-pendente_validacao")).toBeVisible();

    await page.getByTestId("mtsr-inspection-open").first().click();
    const drawer = page.getByTestId("mtsr-inspection-drawer");
    await expect(drawer).toBeVisible();
    await expect(page).toHaveURL(/vistoria=/);
    // Na prévia não há sessão: a gaveta mostra o erro tratado, nunca uma tela em branco.
    await expect(drawer.getByRole("heading", { name: "Vistoria" })).toBeVisible();
    expect(crashes).toEqual([]);
  });

  test("manutenções: vínculos com situação da revalidação", async ({ page }) => {
    await page.goto(`${PREVIEW}?aba=manutencoes`);
    await expect(page.getByTestId("mtsr-kpi-vinculos-ativos")).toContainText("9");
    await expect(page.getByTestId("mtsr-kpi-aguardando-revalidacao")).toContainText("2");
    await expect(page.getByTestId("mtsr-maintenance-row")).toHaveCount(9);
    await expect(page.getByTestId("mtsr-maintenance-revalidation").first()).toBeVisible();
  });

  test("ingestão: fontes disponíveis/indisponíveis, eventos com resultado e importação histórica", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=ingestao`);
    await expect(page.getByTestId("mtsr-ingestao")).toBeVisible();
    await expect(page.getByTestId("mtsr-source-card")).toHaveCount(6);
    // Fonte sem conector real não pode ser ligada: o interruptor fica desabilitado.
    const geotab = page.getByTestId("mtsr-source-card").filter({ hasText: "Geotab (API)" });
    await expect(geotab).toContainText(/não disponível/i);
    await expect(geotab.getByTestId("mtsr-source-toggle")).toHaveCount(0);
    await expect(page.getByTestId("mtsr-source-card").filter({ hasText: "Backoffice manual" }).getByTestId("mtsr-source-toggle")).toBeEnabled();

    await page.goto(`${PREVIEW}?aba=ingestao&sub=eventos`);
    await expect(page.getByTestId("mtsr-event-row")).toHaveCount(14);
    await expect(page.getByTestId("mtsr-events-outcome").first()).toBeVisible();

    await page.goto(`${PREVIEW}?aba=ingestao&sub=backoffice`);
    await expect(page.getByTestId("mtsr-backoffice")).toBeVisible();
    // Só componentes de BACKOFFICE podem ser atualizados aqui; o veículo vem do Cadastro de Frotas.
    await page.getByTestId("mtsr-backoffice-search").fill("SNM");
    await page.getByTestId("mtsr-backoffice-vehicle-option").first().click();
    await expect(page.getByTestId("mtsr-backoffice-vehicle")).toContainText("SNM9H96");
    await expect(page.getByTestId("mtsr-backoffice-item")).toHaveCount(3);
    await expect(page.getByTestId("mtsr-backoffice")).toContainText("MDVR");
    await expect(page.getByTestId("mtsr-backoffice")).not.toContainText("Teclado Macro");

    await page.goto(`${PREVIEW}?aba=ingestao&sub=importacao`);
    await expect(page.getByText("conformidade-mtsr-setembro.xlsx")).toBeVisible();
    expect(crashes).toEqual([]);
  });

  test("cadastros: catálogo com formulários (sem JSON cru), serviços, parâmetros com vigência, fontes e retenção", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=cadastros`);
    await expect(page.getByTestId("mtsr-component-row")).toHaveCount(7);
    await expect(page.getByTestId("mtsr-catalog-components")).toContainText("Travas do Baú Lateral");
    await expect(page.getByTestId("mtsr-catalog-components")).toContainText("Backoffice");
    await expect(page.getByTestId("mtsr-catalog-components")).toContainText("Campo");

    await page.getByTestId("mtsr-component-edit").first().click();
    const dialog = page.getByTestId("mtsr-component-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("mtsr-component-name")).toHaveValue("MDVR");
    expect(await dialog.locator("textarea, pre").filter({ hasText: /[{]/ }).count(), "sem JSON cru").toBe(0);
    await page.keyboard.press("Escape");

    await page.goto(`${PREVIEW}?aba=cadastros&sub=parametros`);
    await expect(page.getByTestId("mtsr-param-conforme")).toHaveValue("29");
    await expect(page.getByTestId("mtsr-param-atencao-min")).toHaveValue("30");
    await expect(page.getByTestId("mtsr-param-atencao-max")).toHaveValue("45");
    await expect(page.getByTestId("mtsr-param-effective")).toBeVisible();

    await page.goto(`${PREVIEW}?aba=cadastros&sub=fontes`);
    await expect(page.getByTestId("mtsr-sources-row")).toHaveCount(7);

    await page.goto(`${PREVIEW}?aba=cadastros&sub=evidencias`);
    await expect(page.getByTestId("mtsr-catalog-evidence")).toContainText("2");
    expect(crashes).toEqual([]);
  });

  test("saúde e cobertura: fontes e recomendações deduzidas dos números", async ({ page }) => {
    await page.goto(`${PREVIEW}?aba=saude`);
    await expect(page.getByTestId("mtsr-health")).toBeVisible();
    await expect(page.getByTestId("mtsr-health-source")).toHaveCount(6);
    await expect(page.getByTestId("mtsr-health-source").filter({ hasText: "Geotab (API)" })).toContainText(/Indisponível|indisponível/);
    await expect(page.getByTestId("mtsr-health-insight").first()).toBeVisible();
    await expect(page.getByTestId("mtsr-health-insights")).toContainText("32 componentes NOK sem manutenção");
  });

  test("auditoria: eventos com ator nomeado", async ({ page }) => {
    await page.goto(`${PREVIEW}?aba=auditoria`);
    await expect(page.getByTestId("mtsr-audit-row")).toHaveCount(24);
    await expect(page.getByTestId("mtsr-audit-table")).toContainText("João Pedro Alves");
    await expect(page.getByTestId("mtsr-audit-table")).not.toContainText(/\bSistema\b.*João/);
    await expect(page.getByTestId("mtsr-audit-export")).toBeVisible();
  });

  test("ficha 360°: cabeçalho, componentes com estado oficial, vistorias, manutenções e linha do tempo", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(FICHA);
    await expect(page.getByRole("heading", { name: /SNM9H96/, level: 1 })).toBeVisible();
    await expect(page.getByTestId("mtsr-sheet-status")).toBeVisible();
    await expect(page.getByTestId("mtsr-sheet-vehicle")).toContainText("Van");
    for (const code of COMPONENTS) await expect(page.getByTestId(`mtsr-sheet-component-${code}`), code).toBeVisible();
    await expect(page.getByTestId("mtsr-sheet-component-mdvr")).toContainText("MAN-2026-000700");
    await expect(page.getByTestId("mtsr-sheet-component-travas_bau_traseiro")).toContainText("OK");

    await page.getByTestId("mtsr-sheet-component-history-toggle").first().click();
    await expect(page.getByTestId("mtsr-sheet-component-mdvr")).toContainText("Gabriel Souza");

    await expect(page.getByTestId("mtsr-sheet-tab-timeline")).toBeVisible();
    await page.getByTestId("mtsr-sheet-tab-inspections").click();
    await expect(page.getByTestId("mtsr-sheet-inspection-MTSR-2026-000100")).toBeVisible();
    await page.getByTestId("mtsr-sheet-tab-maintenances").click();
    await expect(page.getByTestId("mtsr-sheet-maintenance-MAN-2026-000701")).toBeVisible();
    await page.getByTestId("mtsr-sheet-tab-timeline").click();
    await expect(page.getByTestId("mtsr-sheet-timeline")).toContainText("João Pedro Alves");
    expect(crashes).toEqual([]);
  });

  test("celular: visão geral e matriz sem rolagem horizontal da página", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const aba of ["visao-geral", "conformidade"]) {
      await page.goto(`${PREVIEW}?aba=${aba}`);
      await expect(page.getByTestId("mtsr-view")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${aba}: sobra de ${overflow}px`).toBeLessThanOrEqual(1);
    }
  });

  for (const theme of ["light", "dark"] as const) {
    test(`acessibilidade (${theme}): visão geral, conformidade, vistorias e ficha sem violações`, async ({ page }) => {
      const check = async (label: string) => {
        await page.mouse.move(0, 0);
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        expect(results.violations.map((v) => `${label}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
      };
      await setTheme(page, `${PREVIEW}?aba=visao-geral`, theme);
      await expect(page.getByTestId("mtsr-visao-geral")).toBeVisible();
      await check("visao-geral");
      await page.goto(`${PREVIEW}?aba=conformidade`);
      await expect(page.getByTestId("mtsr-conformity-table")).toBeVisible();
      await check("conformidade");
      await page.goto(`${PREVIEW}?aba=vistorias`);
      await expect(page.getByTestId("mtsr-inspections-table")).toBeVisible();
      await check("vistorias");
      await page.goto(FICHA);
      await expect(page.getByTestId("mtsr-sheet-status")).toBeVisible();
      await check("ficha");
    });
  }
});
