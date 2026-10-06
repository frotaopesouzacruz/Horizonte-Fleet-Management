import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Gestão de Frota → Gestão de Pneus.
 *
 * Roda contra `/dev/preview-pneus` (e `/dev/preview-pneus/ficha`), que executa
 * os carregadores reais com as saídas das rotinas `tires_*` / `tire_*`
 * gravadas em fixtures (duas fotografias geradas numa base local a partir do
 * Rodopar 10 real, vistorias pelo próprio RPC e um lote validado aguardando
 * confirmação). O que se prova aqui é a APRESENTAÇÃO: abas por permissão,
 * números do banco sem zero de fachada, diagrama de eixos derivado das
 * posições, vistorias com leitura × referência, importação com prévia e
 * parâmetros por formulário. As regras (prazos, PSI por regra, comparação,
 * conciliação, RLS) estão no banco e são cobertas por
 * `supabase/tests/remote/32_tires.sql`.
 */
const PREVIEW = "/dev/preview-pneus";
const FICHA = "/dev/preview-pneus/ficha";
const TABS = [
  ["visao-geral", "Visão geral"],
  ["base", "Base geral"],
  ["medicao", "Aderência MM"],
  ["calibragem", "Aderência calibragem"],
  ["cronograma", "Cronograma"],
  ["vistorias", "Vistorias recebidas"],
  ["servicos", "Serviços"],
  ["qualidade", "Qualidade de dados"],
  ["historico", "Histórico"],
  ["importacao", "Importação Rodopar"],
  ["parametros", "Parâmetros"],
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

test.describe("gestão de pneus", () => {
  test("as onze abas oficiais, na ordem, e as entradas no menu (Gestão de frota e Aplicativos)", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(PREVIEW);
    await expect(page.getByRole("heading", { name: "Gestão de Pneus", level: 1 })).toBeVisible();
    await expect(page.getByTestId("tires-view").getByRole("tab")).toHaveText(TABS.map(([, label]) => label));
    const nav = page.getByRole("navigation", { name: "Navegação principal" });
    await expect(nav.getByRole("link", { name: "Gestão de Pneus" })).toHaveAttribute("href", "/frota/pneus");
    await expect(nav.getByRole("link", { name: "Vistoria de Pneus" })).toHaveAttribute("href", "/aplicativos/vistoria-pneus");
    // Saiu de "Módulos futuros": não existe mais a entrada planejada /pneus.
    expect(await nav.locator('a[href="/pneus"]').count()).toBe(0);
    expect(crashes).toEqual([]);
  });

  test("a Liderança vê só o que as permissões da matriz liberam: sem importação, qualidade nem exportação", async ({ page }) => {
    await page.goto(`${PREVIEW}?perfil=lideranca&aba=importacao`);
    const tabs = page.getByTestId("tires-view").getByRole("tab");
    await expect(tabs.first()).toBeVisible();
    expect(await tabs.allTextContents()).not.toContain("Importação Rodopar");
    expect(await tabs.allTextContents()).not.toContain("Qualidade de dados");
    // Aba não liberada cai para a primeira visível, sem erro.
    await expect(page.getByTestId("tires-tab-visao-geral")).toHaveAttribute("data-state", "active");
    await page.goto(`${PREVIEW}?perfil=lideranca&aba=base&visao=fogo`);
    await expect(page.getByTestId("tires-base-table")).toBeVisible();
    expect(await page.getByTestId("tires-base-export").count()).toBe(0);
    // Parâmetros em leitura: nenhum botão de salvar.
    await page.goto(`${PREVIEW}?perfil=lideranca&aba=parametros`);
    await expect(page.getByTestId("tires-param-readonly")).toBeVisible();
    expect(await page.getByTestId("tires-param-save").count()).toBe(0);
  });

  test("visão geral: fotografia de referência, KPIs com os números do banco e gráficos próprios", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=visao-geral`);
    const panel = page.getByTestId("tires-visao-geral");
    await expect(panel.getByTestId("tires-visao-geral-photo")).toContainText("05/10/2026");
    await expect(page.getByTestId("tires-kpi-em-uso")).toContainText("409");
    await expect(page.getByTestId("tires-kpi-estoque")).toContainText("99");
    await expect(page.getByTestId("tires-kpi-critico")).toContainText("40");
    // KPI leva à aba que explica o número.
    await expect(page.getByTestId("tires-kpi-abaixo-legal")).toHaveAttribute("href", /aba=base/);
    expect(await panel.getByTestId("tires-visao-geral-dist-status").locator("svg").count()).toBeGreaterThan(0);
    await expect(page.getByTestId("tires-priority-row").first()).toBeVisible();
    // Nenhum dado financeiro de pneus nesta etapa.
    await expect(panel).not.toContainText(/CPK|custo por km|custo por vida/i);
    expect(crashes).toEqual([]);
  });

  test("base geral por frota: diagrama de eixos montado do dicionário de posições", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=base`);
    await expect(page.getByTestId("tires-base-fleet").first()).toBeVisible();
    await page.getByTestId("tires-base-fleet-toggle").first().click();
    await expect(page).toHaveURL(/grupo=/);
    const diagram = page.getByTestId("axle-diagram").first();
    await expect(diagram).toBeVisible();
    expect(await diagram.locator("[data-testid]").count()).toBeGreaterThan(3);
    await expect(page.getByTestId("tires-base-fleet-tire").first()).toBeVisible();
    expect(crashes).toEqual([]);
  });

  test("base geral por Nº Fogo e fora da frota: tabela no servidor, Nº Fogo como texto e link para a ficha", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=base&visao=fogo`);
    await expect(page.getByTestId("tires-base-row")).toHaveCount(25);
    const fire = page.getByTestId("tires-base-table").locator('a[href^="/frota/pneus/"]').first();
    await expect(fire).toHaveAttribute("href", /\/frota\/pneus\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("tires-base-export")).toHaveAttribute("href", /\/frota\/pneus\/exportar\/base\?.*visao=fogo/);
    await page.goto(`${PREVIEW}?aba=base&visao=fora`);
    await expect(page.getByTestId("tires-base-status-counts")).toBeVisible();
    expect(crashes).toEqual([]);
  });

  test("aderências: medição e calibragem com pendências paginadas; sem parâmetro nunca é adequado", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=medicao`);
    await expect(page.getByTestId("tires-medicao-pending-table")).toBeVisible();
    await expect(page.getByTestId("tires-medicao-pending-row").first()).toBeVisible();
    await page.goto(`${PREVIEW}?aba=calibragem`);
    await expect(page.getByTestId("tires-kpi-calibragem-psi-sem-parametro")).toBeVisible();
    await expect(page.getByTestId("tires-calibragem-pending-table")).toBeVisible();
    await expect(page.getByTestId("tires-export-calibragem")).toBeVisible();
    expect(crashes).toEqual([]);
  });

  test("cronograma: agenda por janela e frota expansível com os pneus", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=cronograma`);
    await expect(page.getByTestId("tires-cronograma-windows")).toBeVisible();
    await expect(page.getByTestId("tires-cronograma-row").first()).toBeVisible();
    await page.getByTestId("tires-cronograma-row-toggle").first().click();
    await expect(page.getByTestId("tires-cronograma-tire").first()).toBeVisible();
    expect(crashes).toEqual([]);
  });

  test("vistorias recebidas: fila padrão pendente de revisão e gaveta com leitura × referência", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=vistorias`);
    await expect(page.getByTestId("tires-inspection-row")).toHaveCount(3);
    await page.goto(`${PREVIEW}?aba=vistorias&fase=todas`);
    await expect(page.getByTestId("tires-inspection-row")).toHaveCount(6);
    await page.getByTestId("tires-inspection-row").first().click();
    await expect(page).toHaveURL(/vistoria=[0-9a-f-]{36}/);
    const drawer = page.getByTestId("tires-inspection-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId("tires-inspection-blind-note")).toContainText("não altera a fotografia oficial");
    await expect(drawer.getByTestId("tires-inspection-item").first()).toBeVisible();
    await expect(drawer.getByTestId("tires-inspection-history")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page).not.toHaveURL(/vistoria=/);
    expect(crashes).toEqual([]);
  });

  test("histórico: eventos entre fotografias e trilha de auditoria", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=historico`);
    await expect(page.getByTestId("tires-history-event-row").first()).toBeVisible();
    await expect(page.getByTestId("tires-history-types")).toContainText("Medição de sulco");
    await page.goto(`${PREVIEW}?aba=historico&sub=auditoria`);
    await expect(page.getByTestId("tires-audit-row").first()).toBeVisible();
    expect(crashes).toEqual([]);
  });

  test("importação: pipeline, lote validado com prévia por seção, ausentes mantidos e confirmação explicada", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=importacao`);
    await expect(page.getByTestId("tires-import-history-table")).toBeVisible();
    await expect(page.getByTestId("tires-import-file-input")).toBeAttached();
    await page.goto(`${PREVIEW}?aba=importacao&lote=e9cd4153-9f9a-41ac-a285-acdab7158715&secao=changes`);
    await expect(page.getByTestId("tires-import-preview")).toBeVisible();
    await expect(page.getByTestId("tires-kpi-import-rows")).toBeVisible();
    await page.goto(`${PREVIEW}?aba=importacao&lote=e9cd4153-9f9a-41ac-a285-acdab7158715&secao=absent`);
    await expect(page.getByTestId("tires-import-absent-table")).toBeVisible();
    await expect(page.getByTestId("tires-import-preview")).toContainText(/não (é )?excluíd/i);
    await page.getByTestId("tires-import-confirm").click();
    await expect(page.getByTestId("tires-import-confirm-summary")).toBeVisible();
    expect(crashes).toEqual([]);
  });

  test("serviços: consertos por Nº Fogo e alinhamento lido da Manutenção (sem base paralela)", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=servicos`);
    await expect(page.getByTestId("tires-services-repairs-table")).toBeVisible();
    await expect(page.getByTestId("tires-services-repair-row").first()).toBeVisible();
    await page.goto(`${PREVIEW}?aba=servicos&sub=alinhamento`);
    await expect(page.getByTestId("tires-services-maintenance-source")).toContainText("Gestão de Manutenção");
    await expect(page.getByTestId("tires-services-maintenance-row").first()).toBeVisible();
    expect(crashes).toEqual([]);
  });

  test("parâmetros: formulários (nunca JSON), regras de PSI, posições e layouts com diagrama", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=parametros`);
    await expect(page.getByTestId("tires-param-form")).toBeVisible();
    expect(await page.locator("textarea").filter({ hasText: "{" }).count()).toBe(0);
    await page.goto(`${PREVIEW}?aba=parametros&sub=psi`);
    await expect(page.getByTestId("tires-psi-row").first()).toBeVisible();
    await page.goto(`${PREVIEW}?aba=parametros&sub=layouts`);
    await expect(page.getByTestId("tires-layout-card").first()).toBeVisible();
    expect(await page.getByTestId("axle-diagram").count()).toBeGreaterThan(0);
    expect(crashes).toEqual([]);
  });

  test("ficha 360° do pneu: estado atual, Rodopar, linha do tempo e fotografias", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(FICHA);
    await expect(page.getByTestId("tires-sheet")).toBeVisible();
    await expect(page.getByTestId("tires-sheet-status")).toBeVisible();
    await expect(page.getByTestId("tires-sheet-rodopar")).toBeVisible();
    await page.getByTestId("tires-sheet-tab-timeline").click();
    await expect(page.getByTestId("tires-sheet-event").first()).toBeVisible();
    await page.getByTestId("tires-sheet-tab-snapshots").click();
    await expect(page.getByTestId("tires-sheet-snapshot").first()).toBeVisible();
    await expect(page.getByTestId("tires-sheet")).not.toContainText(/CPK|custo por km/i);
    expect(crashes).toEqual([]);
  });

  test("celular: visão geral, base e vistorias sem rolagem horizontal da página", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const aba of ["visao-geral", "base", "vistorias", "importacao"]) {
      await page.goto(`${PREVIEW}?aba=${aba}`);
      await expect(page.getByTestId("tires-view")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${aba}: sobra de ${overflow}px`).toBeLessThanOrEqual(1);
    }
  });

  for (const theme of ["light", "dark"] as const) {
    test(`acessibilidade (${theme}): visão geral, base, vistorias e ficha sem violações`, async ({ page }) => {
      const check = async (label: string) => {
        await page.mouse.move(0, 0);
        // deixa terminar a transição de tema (250 ms) antes de medir contraste
        await page.waitForTimeout(400);
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        expect(results.violations.map((v) => `${label}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
      };
      await setTheme(page, `${PREVIEW}?aba=visao-geral`, theme);
      await expect(page.getByTestId("tires-visao-geral")).toBeVisible();
      await check("visao-geral");
      await page.goto(`${PREVIEW}?aba=base&visao=fogo`);
      await expect(page.getByTestId("tires-base-table")).toBeVisible();
      await check("base");
      await page.goto(`${PREVIEW}?aba=vistorias&fase=todas`);
      await expect(page.getByTestId("tires-inspections-table")).toBeVisible();
      await check("vistorias");
      await page.goto(FICHA);
      await expect(page.getByTestId("tires-sheet-status")).toBeVisible();
      await check("ficha");
    });
  }
});
