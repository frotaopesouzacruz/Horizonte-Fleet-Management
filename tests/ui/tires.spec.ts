import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Gestão de Frota → Gestão de Pneus (v2).
 *
 * Roda contra `/dev/preview-pneus` (e `/dev/preview-pneus/ficha`), que executa
 * os carregadores reais com as saídas das rotinas `tires_*` / `tire_*`
 * gravadas em fixtures (dados gerados numa base local a partir do Rodopar 10
 * real, capturas semanais de KPI, varredura da auditoria e execuções de
 * sincronização pelas próprias rotinas). O que se prova aqui é a
 * APRESENTAÇÃO: abas por permissão, filtros em cascata,
 * seções recolhíveis, agrupamentos, croqui, evolução, auditoria e
 * sincronização, sem zero de fachada e sem o termo antigo "fotografia". As
 * regras (conformidade, prazos, PSI por regra, capturas imutáveis,
 * sincronização, RLS) estão no banco e são cobertas por
 * `supabase/tests/remote/32_tires.sql`, `33_tires_evolution.sql` e
 * `tests/integration/tires-sync.spec.ts`.
 */
const PREVIEW = "/dev/preview-pneus";
const FICHA = "/dev/preview-pneus/ficha";
const OP_SUDESTE = "0f000000-0000-4000-8000-000000000001";
const TABS = [
  ["visao-geral", "Visão geral"],
  ["base", "Base geral"],
  ["medicao", "Aderência MM"],
  ["calibragem", "Aderência calibragem"],
  ["evolucao", "Evolução dos indicadores"],
  ["cronograma", "Cronograma"],
  ["vistorias", "Vistorias recebidas"],
  ["servicos", "Serviços"],
  ["qualidade", "Auditoria dos dados"],
  ["historico", "Histórico"],
  ["sincronizacao", "Sincronização Rodopar"],
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

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Paradas da varredura de acessibilidade: [query, data-testid pronto, rótulo]. */
const A11Y_STOPS: [string, string, string][] = [
  ["?aba=base&visao=fogo", "tires-base-table", "base"],
  ["?aba=base", "tires-base-group", "base-agrupada"],
  ["?aba=medicao", "tires-indicator", "medicao"],
  ["?aba=calibragem", "tires-indicator-matrix", "calibragem"],
  ["?aba=evolucao", "tires-evolution-summary", "evolucao"],
  ["?aba=vistorias&fase=todas", "tires-inspections-table", "vistorias"],
  ["?aba=qualidade", "tires-audit-kpis", "auditoria"],
  ["?aba=sincronizacao", "tires-sync-source", "sincronizacao"],
  ["?aba=parametros&sub=fonte", "tires-param-source", "parametros-fonte"],
];

test.describe("gestão de pneus", () => {
  test("as doze abas oficiais, na ordem, e as entradas no menu (Gestão de frota e Aplicativos)", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(PREVIEW);
    await expect(page.getByRole("heading", { name: "Gestão de Pneus", level: 1 })).toBeVisible();
    await expect(page.getByTestId("tires-view").getByRole("tab")).toHaveText(TABS.map(([, label]) => label));
    const nav = page.getByRole("navigation", { name: "Navegação principal" });
    await expect(nav.getByRole("link", { name: "Gestão de Pneus" })).toHaveAttribute("href", "/frota/pneus");
    await expect(nav.getByRole("link", { name: "Vistoria de Pneus" })).toHaveAttribute("href", "/aplicativos/vistoria-pneus");
    expect(await nav.locator('a[href="/pneus"]').count()).toBe(0);
    expect(crashes).toEqual([]);
  });

  test("links antigos continuam abrindo: aba importacao → Sincronização Rodopar e ?foto= → data dos dados", async ({ page }) => {
    await page.goto(`${PREVIEW}?aba=importacao`);
    await expect(page.getByTestId("tires-tab-sincronizacao")).toHaveAttribute("data-state", "active");
    await page.goto(`${PREVIEW}?aba=base&visao=fogo&foto=2026-10-05`);
    await expect(page.getByTestId("tires-filter-reference")).toHaveValue("2026-10-05");
  });

  test("o termo \"fotografia\" não aparece em nenhuma aba nem na ficha", async ({ page }) => {
    for (const [tab] of TABS) {
      await page.goto(`${PREVIEW}?aba=${tab}`);
      await expect(page.getByTestId(`tires-tab-${tab}`)).toHaveAttribute("data-state", "active");
      await expect(page.locator("main"), `aba ${tab}`).not.toContainText(/fotografia/i);
    }
    await page.goto(FICHA);
    await expect(page.getByTestId("tires-sheet")).toBeVisible();
    await expect(page.locator("main")).not.toContainText(/fotografia/i);
    expect(await page.title()).not.toMatch(/fotografia/i);
  });

  test("a Liderança vê só o que as permissões liberam: sem sincronização, auditoria nem exportação", async ({ page }) => {
    await page.goto(`${PREVIEW}?perfil=lideranca&aba=sincronizacao`);
    const tabs = page.getByTestId("tires-view").getByRole("tab");
    await expect(tabs.first()).toBeVisible();
    const labels = await tabs.allTextContents();
    expect(labels).not.toContain("Sincronização Rodopar");
    expect(labels).not.toContain("Auditoria dos dados");
    expect(labels).toContain("Evolução dos indicadores");
    await expect(page.getByTestId("tires-tab-visao-geral")).toHaveAttribute("data-state", "active");
    await page.goto(`${PREVIEW}?perfil=lideranca&aba=base&visao=fogo`);
    await expect(page.getByTestId("tires-base-table")).toBeVisible();
    expect(await page.getByTestId("tires-base-export").count()).toBe(0);
    await page.goto(`${PREVIEW}?perfil=lideranca&aba=parametros`);
    await expect(page.getByTestId("tires-param-readonly")).toBeVisible();
    expect(await page.getByTestId("tires-param-save").count()).toBe(0);
  });

  test("o cabeçalho segue o padrão do sistema: rola com a página, sem ficar preso", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 800 });
    await page.goto(`${PREVIEW}?aba=visao-geral`);
    const title = page.getByRole("heading", { name: "Gestão de Pneus", level: 1 });
    await expect(title).toBeInViewport();
    expect(
      await title.evaluate((el) => {
        for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
          if (["sticky", "fixed"].includes(getComputedStyle(n).position)) return n.getAttribute("data-slot") ?? n.tagName;
        }
        return null;
      }),
      "nenhum contêiner do título fica preso",
    ).toBeNull();
    await page.mouse.wheel(0, 1600);
    await expect(title).not.toBeInViewport();
    await expect(page.getByTestId("tires-filter-operation")).not.toBeInViewport();
  });

  test("filtros em cascata: Operação → Local → Liderança, chips e limpar", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=visao-geral`);
    const city = page.getByTestId("tires-filter-city");
    expect(await city.locator("option").count()).toBe(5); // Todos + 4 locais
    await page.getByTestId("tires-filter-operation").selectOption(OP_SUDESTE);
    await expect(page).toHaveURL(new RegExp(`operacao=${OP_SUDESTE}`));
    // só os locais que têm pneus/frotas da operação escolhida
    await expect(city.locator("option")).toHaveText(["Todos", "Campinas · SP", "São Paulo · SP"]);
    await city.selectOption("3509502");
    await expect(page).toHaveURL(/local=3509502/);
    const chips = page.getByTestId("tires-filter-chips");
    await expect(chips).toContainText("Operação Sudeste");
    await expect(chips).toContainText("Campinas");
    // trocar a operação limpa os filhos (local, liderança, frota)
    await page.getByTestId("tires-filter-operation").selectOption("");
    await expect(page).not.toHaveURL(/local=/);
    await page.getByTestId("tires-filter-operation").selectOption(OP_SUDESTE);
    await page.getByTestId("tires-clear-filters").click();
    await expect(page).not.toHaveURL(/operacao=/);
    expect(crashes).toEqual([]);
  });

  test("visão geral: sem caixa de referência antiga; Dados Gerais com KPIs do banco, recolhível e lembrado na sessão", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=visao-geral`);
    const overview = page.getByTestId("tires-overview");
    await expect(overview).toBeVisible();
    await expect(overview).not.toContainText(/Fotografia oficial/i);
    await expect(page.getByTestId("tires-kpi-total")).toContainText("617");
    await expect(page.getByTestId("tires-kpi-em-uso")).toContainText("409");
    await expect(page.getByTestId("tires-kpi-estoque")).toContainText("99");
    const toggle = page.getByTestId("tires-general-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("tires-profile-chart")).toBeVisible();
    await expect(page.getByTestId("tires-where-chart")).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("tires-general-body")).toBeHidden();
    await page.reload();
    await expect(page.getByTestId("tires-general-toggle")).toHaveAttribute("aria-expanded", "false");
    await page.getByTestId("tires-general-toggle").click();
    await expect(page.getByTestId("tires-general-body")).toBeVisible();
    await expect(overview).not.toContainText(/CPK|custo por km|custo por vida/i);
    expect(crashes).toEqual([]);
  });

  test("visão geral: gráficos interativos — trocar a dimensão e filtrar a tela clicando numa barra", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=visao-geral`);
    const profile = page.getByTestId("tires-profile-chart");
    await expect(profile.getByTestId("tires-profile-bars")).toContainText("CONTINENTAL");
    await page.getByTestId("tires-profile-dim-life").click();
    await expect(page).toHaveURL(/perfil_por=/);
    await expect(profile.getByTestId("tires-profile-bars")).toContainText("1ª vida");
    const where = page.getByTestId("tires-where-chart");
    await expect(where.getByTestId("tires-where-bars")).toContainText("Operação Sudeste");
    await where.getByTestId("tires-where-bars").getByRole("button", { name: /Operação Sudeste/ }).click();
    await expect(page).toHaveURL(new RegExp(`operacao=${OP_SUDESTE}`));
    await expect(page.getByTestId("tires-filter-chips")).toContainText("Operação Sudeste");
    // trocar de aba limpa o estado de visão da aba anterior, mas mantém os filtros globais
    await page.getByTestId("tires-tab-base").click();
    await expect(page).not.toHaveURL(/perfil_por=/);
    await expect(page).toHaveURL(new RegExp(`operacao=${OP_SUDESTE}`));
    expect(crashes).toEqual([]);
  });

  test("visão geral: Saúde e Prazos e conformidade geral (calibragem no prazo com PSI ruim não é saudável)", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=visao-geral`);
    await expect(page.getByTestId("tires-health-section")).toBeVisible();
    await expect(page.getByTestId("tires-kpi-medicao-vencida")).toContainText("51");
    await expect(page.getByTestId("tires-kpi-calibragem-vencida")).toContainText("51");
    await expect(page.getByTestId("tires-kpi-psi-fora")).toContainText("30");
    const conformity = page.getByTestId("tires-conformity-section");
    await expect(conformity.getByTestId("tires-conformity-overall")).toContainText("71,4");
    await expect(conformity.getByTestId("tires-conformity-calibration")).toContainText("80,2");
    await expect(conformity.getByTestId("tires-conformity-on-time-bad-psi")).toContainText("30");
    await expect(conformity.getByTestId("tires-conformity-criteria")).toContainText(/PSI/);
    expect(crashes).toEqual([]);
  });

  test("prioridades: agrupar por operação, local ou liderança, do mais crítico ao menos crítico, com drill", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=visao-geral`);
    const priorities = page.getByTestId("tires-priorities");
    const groups = priorities.getByTestId("tires-priority-group");
    await expect(groups.first()).toContainText("Operação Sudeste");
    await page.getByTestId("tires-priorities-groupby-city").click();
    await expect(page).toHaveURL(/prioridade=/);
    await expect(groups.first()).toContainText(/·\s*[A-Z]{2}/);
    await page.getByTestId("tires-priorities-groupby-leader").click();
    await expect(groups.first()).toBeVisible();
    await page.getByTestId("tires-priorities-groupby-operation").click();
    await priorities.getByTestId("tires-priority-group-open").first().click();
    await expect(page).toHaveURL(/grupo=/);
    const drill = page.getByTestId("tires-priority-drill");
    await expect(drill).toBeVisible();
    await expect(drill.getByTestId("tires-priority-tire").first()).toBeVisible();
    await expect(page.getByTestId("tires-priorities-rule")).toBeVisible();
    expect(crashes).toEqual([]);
  });

  test("aderência MM: sulco e prazo de medição com definição, distribuição, desvios, evolução e pendências", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=medicao`);
    const panel = page.getByTestId("tires-indicator");
    await expect(panel).toHaveAttribute("data-sub", "sulco");
    await expect(panel.getByTestId("tires-indicator-kpi-pct")).toContainText("90,2");
    await expect(panel.getByTestId("tires-indicator-definition")).toBeVisible();
    await expect(panel.getByTestId("tires-indicator-histogram")).toBeVisible();
    await expect(panel.getByTestId("tires-indicator-breakdown")).toBeVisible();
    await panel.getByTestId("tires-indicator-dim").selectOption({ index: 1 });
    await expect(page).toHaveURL(/agrupar=/);
    await expect(panel.getByTestId("tires-indicator-trend")).toBeVisible();
    await expect(panel.getByTestId("tires-indicator-pending-row").first()).toBeVisible();
    await page.getByTestId("tires-indicator-sub-prazo").click();
    await expect(page).toHaveURL(/sub=prazo/);
    await expect(page.getByTestId("tires-indicator")).toHaveAttribute("data-sub", "prazo");
    await expect(page.getByTestId("tires-indicator-late")).toBeVisible();
    await expect(page.getByTestId("tires-indicator-export")).toHaveAttribute("href", /exportar\/medicao\?.*sub=prazo/);
    expect(crashes).toEqual([]);
  });

  test("aderência calibragem: conformidade (prazo × PSI), prazo e PSI por regra; sem parâmetro nunca é adequado", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=calibragem`);
    const panel = page.getByTestId("tires-indicator");
    await expect(panel).toHaveAttribute("data-sub", "conformidade");
    await expect(panel.getByTestId("tires-indicator-kpi-pct")).toContainText("80,2");
    await expect(panel.getByTestId("tires-indicator-matrix")).toBeVisible();
    await expect(panel.getByTestId("tires-oncall-bad-psi")).toContainText(/não é saudável/i);
    await panel.getByTestId("tires-indicator-status-link").first().click();
    await expect(page).toHaveURL(/pendencia=/);
    await expect(page.getByTestId("tires-indicator-pending-row").first()).toBeVisible();
    await page.getByTestId("tires-indicator-sub-psi").click();
    await expect(page).toHaveURL(/sub=psi/);
    await expect(page).not.toHaveURL(/pendencia=/);
    await expect(page.getByTestId("tires-indicator-deviation")).toBeVisible();
    await expect(page.getByTestId("tires-indicator-definition")).toContainText(/regra/i);
    await page.getByTestId("tires-indicator-sub-prazo").click();
    await expect(page.getByTestId("tires-indicator")).toHaveAttribute("data-sub", "prazo");
    expect(crashes).toEqual([]);
  });

  test("evolução dos indicadores: semana × semana, mês × mês, ranking por operação e série do membro", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=evolucao`);
    const panel = page.getByTestId("tires-evolution");
    await expect(panel.getByTestId("tires-evolution-summary")).toBeVisible();
    expect(await panel.getByTestId("tires-evolution-summary-item").count()).toBeGreaterThanOrEqual(6);
    await expect(panel.getByTestId("tires-evolution-summary-item").first()).toHaveAttribute("data-trend", /melhorando|piorando|estavel|neutro/);
    await expect(panel.getByTestId("tires-evolution-chart")).toBeVisible();
    await expect(panel.getByTestId("tires-evolution-table")).toBeVisible();
    await expect(panel.getByTestId("tires-evolution-runs")).toBeVisible();
    await expect(panel.getByTestId("tires-evolution-schedule")).toContainText(/sexta/i);
    await page.getByTestId("tires-evolution-period-mes").click();
    await expect(page).toHaveURL(/periodo=mes/);
    await expect(page.getByTestId("tires-evolution-summary")).toBeVisible();
    await page.getByTestId("tires-evolution-period-semana").click();
    await page.getByTestId("tires-evolution-dimension").selectOption("operation");
    await expect(page).toHaveURL(/dimensao=operation/);
    const ranking = page.getByTestId("tires-evolution-ranking");
    await expect(ranking).toBeVisible();
    await ranking.getByTestId("tires-evolution-ranking-member").first().click();
    await expect(page).toHaveURL(/membro=/);
    await expect(page.getByTestId("tires-evolution-chart")).toBeVisible();
    await expect(page.getByTestId("tires-evolution-back")).toBeVisible();
    expect(crashes).toEqual([]);
  });

  test("parâmetros: fonte oficial (SharePoint) e agenda dos indicadores por formulário", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=parametros`);
    await expect(page.getByTestId("tires-param-form")).toBeVisible();
    expect(await page.locator("textarea").filter({ hasText: "{" }).count()).toBe(0);
    await page.goto(`${PREVIEW}?aba=parametros&sub=fonte`);
    const source = page.getByTestId("tires-param-source");
    await expect(source).toBeVisible();
    await expect(source.getByTestId("tires-param-source-credentials")).toBeVisible();
    await expect(source.getByTestId("tires-param-source-filePath")).toHaveValue(/Base Geral Pneus Rodorpar\.xlsx/);
    await page.goto(`${PREVIEW}?aba=parametros&sub=indicadores`);
    const kpi = page.getByTestId("tires-param-kpi");
    await expect(kpi).toBeVisible();
    await expect(kpi.getByTestId("tires-param-kpi-rules")).toContainText(/imut|não (é|são) recalculad/i);
    await expect(kpi.getByTestId("tires-param-kpi-time")).toHaveValue("22:00");
    await page.goto(`${PREVIEW}?aba=parametros&sub=psi`);
    await expect(page.getByTestId("tires-psi-row").first()).toBeVisible();
    expect(crashes).toEqual([]);
  });

  test("base geral por frota: agrupar por operação / local / liderança, grupos expansíveis e lembrados na URL", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=base`);
    const base = page.getByTestId("tires-base");
    await expect(base).toHaveAttribute("data-group-by", "operation");
    const groups = page.getByTestId("tires-base-group");
    await expect(groups.first()).toContainText("Operação Sudeste");
    await expect(groups.first()).not.toHaveAttribute("data-open", /.*/);
    await groups.first().getByTestId("tires-base-group-toggle").click();
    await expect(page).toHaveURL(/abertos=/);
    await expect(groups.first()).toHaveAttribute("data-open", "true");
    await expect(groups.first().getByTestId("tires-base-group-fleets")).toBeVisible();
    await expect(groups.first().getByTestId("tires-base-fleet").first()).toContainText("SNT8I66");
    await expect(groups.first().getByTestId("tires-base-fleet-conformity").first()).toBeVisible();
    // link copiado abre a mesma visão
    await page.reload();
    await expect(page.getByTestId("tires-base-group").first()).toHaveAttribute("data-open", "true");
    await page.getByTestId("tires-base-groupby").selectOption("city");
    await expect(page).toHaveURL(/agrupar=/);
    await expect(page).not.toHaveURL(/abertos=/);
    await expect(page.getByTestId("tires-base-group").first()).toContainText(/·\s*[A-Z]{2}/);
    await page.getByTestId("tires-base-groupby").selectOption("nenhum");
    await expect(page).toHaveURL(/agrupar=nenhum/);
    await expect(page.getByTestId("tires-base-fleet").first()).toBeVisible();
    expect(await page.getByTestId("tires-base-fleets-missing").count()).toBe(0);
    expect(crashes).toEqual([]);
  });

  test("croqui interativo: desenho pelo dicionário de posições, clique e teclado mostram o pneu da posição", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=base&agrupar=nenhum`);
    await page.getByTestId("tires-base-fleet-toggle").first().click();
    await expect(page).toHaveURL(/grupo=/);
    const croqui = page.getByTestId("tires-croqui").first();
    await expect(croqui).toBeVisible();
    await expect(croqui).toHaveAttribute("data-mode", "official");
    await expect(croqui).toHaveAttribute("data-layout-source", /.+/);
    await expect(croqui.getByTestId("axle-diagram")).toBeVisible();
    await expect(croqui.getByTestId("tires-croqui-legend")).toBeVisible();
    // posições derivadas do layout (2 eixos + estepe)
    for (const code of ["EDE", "EDD", "ETE", "ETD", "ESTEP1"]) {
      await expect(croqui.getByTestId(`tires-croqui-pos-${code}`)).toBeVisible();
    }
    await croqui.getByTestId("tires-croqui-pos-EDE").click();
    const detail = croqui.getByTestId("tires-croqui-detail");
    await expect(detail).toBeVisible();
    await expect(detail).toContainText("66989");
    await expect(detail.getByTestId("tires-croqui-detail-tread")).toBeVisible();
    await expect(detail.getByTestId("tires-croqui-detail-psi")).toBeVisible();
    await expect(detail.getByTestId("tires-croqui-fire-link")).toHaveAttribute("href", /\/frota\/pneus\/[0-9a-f-]{36}/);
    // cor nunca é a única informação: cada posição tem rótulo acessível
    await expect(croqui.getByTestId("tires-croqui-pos-EDE")).toHaveAttribute("aria-label", /.+/);
    await croqui.getByTestId("tires-croqui-pos-EDE").focus();
    await page.keyboard.press("ArrowRight");
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-position"));
    expect(focused).not.toBe("EDE");
    expect(focused).toBeTruthy();
    await page.keyboard.press("Enter");
    await expect(croqui.getByTestId("tires-croqui-detail")).not.toContainText("66989");
    expect(crashes).toEqual([]);
  });

  test("base geral por Nº Fogo e fora da frota: tabela no servidor, Nº Fogo como texto e link para a ficha", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=base&visao=fogo`);
    await expect(page.getByTestId("tires-base-row")).toHaveCount(25);
    const fire = page.getByTestId("tires-base-table").locator('a[href^="/frota/pneus/"]').first();
    await expect(fire).toHaveAttribute("href", /\/frota\/pneus\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("tires-base-table").getByTestId("tires-criticality").first()).toBeVisible();
    await expect(page.getByTestId("tires-base-export")).toHaveAttribute("href", /\/frota\/pneus\/exportar\/base\?.*visao=fogo/);
    await page.goto(`${PREVIEW}?aba=base&visao=fora`);
    await expect(page.getByTestId("tires-base-status-counts")).toBeVisible();
    expect(crashes).toEqual([]);
  });

  test("ficha do pneu: croqui do veículo sob demanda com o pneu da ficha selecionado", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(FICHA);
    await expect(page.getByTestId("tires-sheet-vehicle")).toBeVisible();
    await expect(page.getByTestId("tires-sheet-croqui-toggle")).toBeVisible();
    expect(crashes).toEqual([]);
  });

  test("central de auditoria dos dados: indicadores, regras, agrupamento e achados com drill-down", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=qualidade`);
    const kpis = page.getByTestId("tires-audit-kpis");
    await expect(kpis).toBeVisible();
    await expect(page.getByTestId("tires-audit-kpi-open")).toContainText("158");
    await expect(page.getByTestId("tires-audit-kpi-pct")).toContainText("17,7");
    await expect(page.getByTestId("tires-audit-scan")).toBeVisible();
    // catálogo de regras numa gaveta
    await page.getByTestId("tires-audit-rules").click();
    const drawer = page.getByTestId("tires-audit-rules-drawer");
    await expect(drawer).toBeVisible();
    expect(await drawer.getByTestId("tires-audit-rule").count()).toBeGreaterThan(5);
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    // agrupar por categoria e filtrar a lista pelo grupo
    await page.getByTestId("tires-audit-groupby").selectOption("category");
    await expect(page).toHaveURL(/agrupar=category/);
    await page.getByTestId("tires-audit-group").first().click();
    await expect(page).toHaveURL(/categoria=/);
    await expect(page.getByTestId("tires-audit-row").first()).toBeVisible();
    await page.getByTestId("tires-audit-status-todas").click();
    await expect(page).toHaveURL(/achado=todas/);
    await expect(page.getByTestId("tires-audit-export")).toHaveAttribute("href", /exportar\/qualidade/);
    expect(crashes).toEqual([]);
  });

  test("sincronização Rodopar: fonte oficial, sincronizar agora, histórico com log por etapa e reprocessamento", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=sincronizacao`);
    const source = page.getByTestId("tires-sync-source");
    await expect(source).toBeVisible();
    await expect(source).toContainText("Base Geral Pneus Rodorpar.xlsx");
    await expect(page.getByTestId("tires-sync-now")).toBeVisible();
    const runs = page.getByTestId("tires-sync-run");
    await expect(runs).toHaveCount(4);
    await expect(runs.first()).toHaveAttribute("data-status", "concluida_com_avisos");
    await runs.first().click();
    await expect(page).toHaveURL(/execucao=/);
    const detail = page.getByTestId("tires-sync-run-detail");
    await expect(detail).toBeVisible();
    await expect(detail.getByTestId("tires-sync-run-log")).toContainText("Arquivo encontrado");
    await expect(detail.getByTestId("tires-sync-run-structure")).toContainText("Observação Interna");
    await page.keyboard.press("Escape");
    await expect(page).not.toHaveURL(/execucao=/);
    // execução que falhou pode ser reprocessada (com registro), a concluída não
    await page.locator('[data-testid="tires-sync-run"][data-status="falhou"]').click();
    await expect(page.getByTestId("tires-sync-run-detail")).toHaveAttribute("data-status", "falhou");
    await expect(page.getByTestId("tires-sync-reprocess")).toBeVisible();
    await page.keyboard.press("Escape");
    // o envio manual do XLSX ficou como contingência recolhida
    await expect(page.getByTestId("tires-sync-manual")).toBeVisible();
    expect(crashes).toEqual([]);
  });

  test("contingência (envio manual): lote validado com prévia por seção, ausentes mantidos e confirmação explicada", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=sincronizacao&lote=e9cd4153-9f9a-41ac-a285-acdab7158715&secao=changes`);
    await expect(page.getByTestId("tires-import-preview")).toBeVisible();
    await expect(page.getByTestId("tires-kpi-import-rows")).toBeVisible();
    await page.goto(`${PREVIEW}?aba=sincronizacao&lote=e9cd4153-9f9a-41ac-a285-acdab7158715&secao=absent`);
    await expect(page.getByTestId("tires-import-absent-table")).toBeVisible();
    await expect(page.getByTestId("tires-import-preview")).toContainText(/não (é )?excluíd/i);
    await page.getByTestId("tires-import-confirm").click();
    await expect(page.getByTestId("tires-import-confirm-summary")).toBeVisible();
    await expect(page.getByTestId("tires-import-confirm-summary")).not.toContainText(/fotografia/i);
    expect(crashes).toEqual([]);
  });

  test("histórico: eventos entre datas dos dados e trilha de auditoria", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=historico`);
    await expect(page.getByTestId("tires-history-event-row").first()).toBeVisible();
    await expect(page.getByTestId("tires-history-types")).toContainText("Medição de sulco");
    await page.goto(`${PREVIEW}?aba=historico&sub=auditoria`);
    await expect(page.getByTestId("tires-audit-row").first()).toBeVisible();
    await expect(page.locator("main")).not.toContainText(/fotografia/i);
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
    await expect(drawer.getByTestId("tires-inspection-blind-note")).toContainText("não altera a base oficial");
    await expect(drawer.getByTestId("tires-inspection-item").first()).toBeVisible();
    await expect(drawer.getByTestId("tires-inspection-history")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page).not.toHaveURL(/vistoria=/);
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

  test("ficha 360° do pneu: estado atual, Rodopar, linha do tempo e datas dos dados", async ({ page }) => {
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

  for (const viewport of [
    { name: "celular", width: 390, height: 844 },
    { name: "tablet", width: 820, height: 1180 },
    { name: "notebook", width: 1280, height: 720 },
  ]) {
    test(`${viewport.name}: todas as abas sem rolagem horizontal da página`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const [tab] of TABS) {
        await page.goto(`${PREVIEW}?aba=${tab}`);
        await expect(page.getByTestId(`tires-tab-${tab}`)).toHaveAttribute("data-state", "active");
        const overflow = await horizontalOverflow(page);
        expect(overflow, `${tab}: sobra de ${overflow}px`).toBeLessThanOrEqual(1);
      }
    });
  }

  for (const theme of ["light", "dark"] as const) {
    test(`acessibilidade (${theme}): visão geral, base, croqui, aderências, evolução, auditoria, sincronização e ficha`, async ({ page }) => {
      test.setTimeout(120_000);
      const check = async (label: string) => {
        await page.mouse.move(0, 0);
        // deixa terminar a transição de tema (250 ms) antes de medir contraste
        await page.waitForTimeout(400);
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        expect(results.violations.map((v) => `${label}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
      };
      await setTheme(page, `${PREVIEW}?aba=visao-geral`, theme);
      await expect(page.getByTestId("tires-overview")).toBeVisible();
      await check("visao-geral");
      for (const [url, ready, label] of A11Y_STOPS) {
        await page.goto(`${PREVIEW}${url}`);
        await expect(page.getByTestId(ready).first()).toBeVisible();
        await check(label);
      }
      await page.goto(FICHA);
      await expect(page.getByTestId("tires-sheet-status")).toBeVisible();
      await check("ficha");
    });
  }
});
