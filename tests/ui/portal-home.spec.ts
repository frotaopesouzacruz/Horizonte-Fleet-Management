import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { portalAllowsPath } from "../../src/lib/auth/portal";
import { homeCapabilities, resolveHome } from "../../src/lib/home/resolver";
import { buildDayActions, openActions, visibleApps } from "../../src/lib/portal/home-status";
import { buildInsights, buildPriorities, pendingByCategory } from "../../src/lib/portal/leadership";
import { buildCalendar } from "../../src/lib/portal/calendar";
import {
  APPS, COMPETENCE, LEADERSHIP_PERMISSIONS, OPERATIONAL_PERMISSIONS, PENDING, PREVIEW_NOW, TODAY, TODAY_ACTIONS,
  leadershipFixture, monthExecutions, obligationDays,
} from "../../src/app/dev/preview-inicio/fixture";

/**
 * Pós-login: a Home de cada perfil e a alçada das telas.
 *
 * Três camadas, testadas separadamente:
 *
 *   * as REGRAS puras — que telas cada portal abre (`portalAllowsPath`), que
 *     Home e que capabilities a conta recebe (`resolveHome`), os estados das
 *     ações do dia e os aplicativos visíveis (`home-status`), as prioridades,
 *     categorias e insights da Liderança (`leadership`) e o calendário
 *     (`buildCalendar`) —, sem navegador;
 *   * as TELAS, contra `/dev/preview-inicio` (dados fixos de outubro/2026,
 *     hoje dia 13): menu de cada perfil, Home do Operacional (ações do dia,
 *     pendências, aplicativos, veículo, histórico, calendário), Home da
 *     Liderança (escopo, prioridades, aderência com comparativos, pendências
 *     por categoria, insights, blocos secundários, modo compacto, recortes e
 *     estados de erro);
 *   * RESPONSIVIDADE e ACESSIBILIDADE: 375/390/430 sem rolagem lateral e com
 *     a navegação inferior, 1366×768 e 1440×900 na Liderança, axe nos dois
 *     temas.
 *
 * Quem é a pessoa, que perfis ela tem e o que é dela vem do banco e é coberto
 * por `supabase/tests/remote/35_portals_post_login.sql` e
 * `38_role_based_home.sql`.
 */
const PREVIEW = "/dev/preview-inicio";
const THEME_KEY = "hfm.theme";
const LEADER_QUERY = "?lideranca=emp-120788";

function collectCrashes(page: Page): string[] {
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));
  return crashes;
}

/** Abre um grupo do menu (acordeão) e devolve o nav; sem rótulo, o grupo já está aberto. */
async function openGroup(nav: Locator, label: string) {
  const button = nav.getByRole("button", { name: label, exact: true });
  if ((await button.getAttribute("aria-expanded")) === "false") await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

/* -------------------------------------------------------------------------- */
/* Regras                                                                     */
/* -------------------------------------------------------------------------- */

test.describe("portal: telas de cada perfil (regra)", () => {
  test("Operacional abre o início, os apps, o perfil e só o que é dele", () => {
    for (const path of [
      "/inicio",
      "/aplicativos",
      "/aplicativos/check-list-frota",
      "/aplicativos/check-list-frota/meus-checklists",
      "/aplicativos/vistoria-mtsr",
      "/aplicativos/vistoria-pneus",
      "/checklist/aderencia/minha-situacao",
      "/checklist/planos-acao/meus-apontamentos",
      "/perfil",
      "/sem-permissao",
    ]) {
      expect(portalAllowsPath("operational", path), path).toBe(true);
    }
    for (const path of [
      "/dashboard",
      "/organizacao/operacoes",
      "/frota/cadastro",
      "/checklist/aderencia",
      "/checklist/planos-acao",
      "/administracao/usuarios",
      "/administracao/fornecedores",
      "/frota/pneus",
      "/governanca/fidelizacao",
      "/governanca/liderancas",
      // prefixo não é pertencimento (já /aplicativos/* é a área dos apps, inteira)
      "/inicio-falso",
      "/aplicativos-x",
      "/perfil-outro",
    ]) {
      expect(portalAllowsPath("operational", path), path).toBe(false);
    }
  });

  test("Liderança abre a operação que lidera, as lideranças e a frota, não a administração", () => {
    for (const path of [
      "/inicio",
      "/perfil",
      "/checklist/aderencia",
      "/checklist/aderencia/export",
      "/checklist/planos-acao",
      "/governanca/fidelizacao",
      "/governanca/brs",
      "/governanca/liderancas",
      "/frota/cadastro",
      "/frota/km/relatorio",
      "/frota/pneus/abc",
      "/frota/manutencao",
      "/seguranca/mtsr/veiculos/x",
      "/aplicativos",
      "/aplicativos/vistoria-pneus",
    ]) {
      expect(portalAllowsPath("leadership", path), path).toBe(true);
    }
    for (const path of [
      "/dashboard",
      "/administracao/usuarios",
      "/administracao/usuarios/export",
      "/administracao/fornecedores",
      "/administracao/perfis",
      "/organizacao/operacoes",
      "/estrutura/filiais",
      "/frota/tipos-equipamento",
    ]) {
      expect(portalAllowsPath("leadership", path), path).toBe(false);
    }
  });

  test("sem portal (gestão): nenhuma trava além das permissões", () => {
    for (const path of ["/dashboard", "/administracao/usuarios", "/frota/cadastro", "/inicio", "/perfil"]) {
      expect(portalAllowsPath("management", path), path).toBe(true);
    }
  });
});

test.describe("home resolver e capabilities (regra)", () => {
  const operational = resolveHome({ portal: "operational", permissions: OPERATIONAL_PERMISSIONS });
  const leadership = resolveHome({ portal: "leadership", permissions: LEADERSHIP_PERMISSIONS });

  test("Operacional → Operational Home: apps e visões pessoais, nenhum módulo da operação", () => {
    expect(operational.kind).toBe("operational");
    expect(operational.can).toMatchObject({
      apps: true, checklistExecute: true, mtsrExecute: true, tiresExecute: true,
      ownChecklists: true, ownReports: true, ownSituation: true,
      adherence: false, actionPlans: false, fidelization: false, leadership: false, km: false, tires: false, maintenance: false, mtsr: false,
    });
    // vehicles.view é do Check List (listar placas), não um painel de frota para ele — a trava de telas é que decide.
    expect(portalAllowsPath("operational", "/frota/cadastro")).toBe(false);
  });

  test("Liderança → Leadership Home com todos os módulos do portal", () => {
    expect(leadership.kind).toBe("leadership");
    expect(leadership.can).toMatchObject({
      adherence: true, actionPlans: true, fidelization: true, leadership: true, fleet: true, km: true, tires: true, maintenance: true, mtsr: true,
      apps: true, checklistExecute: true,
    });
  });

  test("Administrador não cai em nenhuma das duas homes; sem permissão não há capability", () => {
    const admin = resolveHome({ portal: "management", permissions: [], isPlatformAdmin: true });
    expect(admin.kind).toBe("management");
    expect(admin.can.adherence).toBe(true);
    const nothing = homeCapabilities({ portal: "operational", permissions: [] });
    expect(Object.values(nothing).every((v) => v === false)).toBe(true);
    // Permissão de ver sem a do painel não libera o bloco do módulo.
    expect(homeCapabilities({ portal: "leadership", permissions: ["tires.view"] }).tires).toBe(false);
    expect(homeCapabilities({ portal: "leadership", permissions: ["tires.view", "tires.dashboard.view"] }).tires).toBe(true);
  });

  test("aplicativos: só o autorizado E habilitado na operação; sem catálogo, só a permissão", () => {
    const can = operational.can;
    expect(visibleApps(APPS, can).map((a) => a.code)).toEqual(["checklist_frota", "vistoria_mtsr", "vistoria_pneus"]);
    // Equipamento/app não habilitado na operação: escondido mesmo com permissão.
    const disabled = APPS.map((a) => (a.code === "vistoria_pneus" ? { ...a, enabled: false } : a));
    expect(visibleApps(disabled, can).map((a) => a.code)).toEqual(["checklist_frota", "vistoria_mtsr"]);
    // Sem a permissão de executar: escondido mesmo habilitado.
    expect(visibleApps(APPS, { ...can, mtsrExecute: false }).map((a) => a.code)).toEqual(["checklist_frota", "vistoria_pneus"]);
    // Catálogo indisponível: vale a permissão sozinha (nunca um app a mais).
    expect(visibleApps(null, { ...can, tiresExecute: false }).map((a) => a.code)).toEqual(["checklist_frota", "vistoria_mtsr"]);
    expect(visibleApps(APPS, { ...can, apps: false })).toEqual([]);
    // Código fora do catálogo oficial nunca vira azulejo.
    expect(visibleApps([{ code: "outro", slug: "outro", name: "Outro", enabled: true }], can)).toEqual([]);
  });

  test("ações do dia: estados oficiais, ordem do que exige a pessoa e CTA por permissão", () => {
    const actions = buildDayActions(TODAY_ACTIONS, PENDING, operational.can, PREVIEW_NOW);
    expect(actions.map((a) => [a.state, a.title, a.cta])).toEqual([
      ["retornado", "Vistoria MTSR devolvida", "Refazer"],
      ["em_andamento", "Checklist de retorno", "Fazer retorno"],
      ["concluido", "Checklist de saída", null],
    ]);
    expect(openActions(actions).map((a) => a.state)).toEqual(["retornado", "em_andamento"]);

    // Obrigação de saída sem checklist: pendente dentro do prazo, vencida depois dele.
    const notDone = [{ ...TODAY_ACTIONS[0], status: "NAO_FEZ_CHECKLIST", done: false, deadlineAt: `${TODAY}T15:59:00-03:00` }];
    expect(buildDayActions(notDone, [], operational.can, `${TODAY}T15:00:00-03:00`)[0]).toMatchObject({ state: "pendente", cta: "Iniciar", detail: "RJX4A21 · BR BR-RJ-012 · até 15:59" });
    expect(buildDayActions(notDone, [], operational.can, `${TODAY}T16:30:00-03:00`)[0]).toMatchObject({ state: "vencido", cta: "Iniciar" });
    // Expurgo: dispensado, com o motivo, sem botão.
    const excused = [{ ...TODAY_ACTIONS[0], status: "MANUTENCAO", done: false, excluded: true }];
    expect(buildDayActions(excused, [], operational.can, PREVIEW_NOW)[0]).toMatchObject({ state: "dispensado", detail: "Veículo em manutenção · RJX4A21 · BR BR-RJ-012", href: null, cta: null });
    // Sem permissão de executar, a ação existe mas não leva a lugar nenhum.
    expect(buildDayActions(TODAY_ACTIONS, PENDING, { ...operational.can, checklistExecute: false, mtsrExecute: false }, PREVIEW_NOW).every((a) => a.href === null)).toBe(true);
  });
});

test.describe("Liderança: prioridades, categorias e insights (regra)", () => {
  const { home, blocks } = leadershipFixture("completo");
  const team = home.ok ? home.data.team : null;

  test("prioridades saem das regras oficiais, críticas primeiro, cada uma com drill-down filtrado", () => {
    const { items, incomplete } = buildPriorities(blocks, team, LEADER_QUERY);
    expect(incomplete).toBe(false);
    expect(items.length).toBeGreaterThanOrEqual(6);
    const order = { critical: 0, high: 1, medium: 2 };
    for (let i = 1; i < items.length; i += 1) expect(order[items[i].severity]).toBeGreaterThanOrEqual(order[items[i - 1].severity]);
    expect(items[0]).toMatchObject({ severity: "critical", title: "3 frotas com pneu crítico", href: `/frota/pneus${LEADER_QUERY}` });
    // Drill-down: o módulo filtrado ou, para a equipe, a própria seção do time na Home.
    for (const item of items) expect(item.href, item.key).toMatch(/^(\/[a-z]|#equipe$)/);
  });

  test("pendências por categoria: Checklist, Pneus, MTSR e Planos, com total e críticas", () => {
    const categories = pendingByCategory(blocks, LEADER_QUERY);
    expect(categories.map((c) => [c.key, c.total, c.critical])).toEqual([
      ["checklist", 7, 4],
      ["tires", 28, 5],
      ["mtsr", 10, 2],
      ["plans", 11, 2],
    ]);
    expect(categories[1].href).toBe(`/frota/pneus${LEADER_QUERY}`);
    // Fonte que falhou: total nulo (a tela diz "não carregou"), nunca zero.
    const failed = pendingByCategory({ ...blocks, tires: { ok: false, error: "x" } }, "");
    expect(failed.find((c) => c.key === "tires")).toMatchObject({ total: null, critical: 0, href: "/frota/pneus" });
  });

  test("insights: no máximo 3, só do que os números dizem", () => {
    const categories = pendingByCategory(blocks, LEADER_QUERY);
    const insights = buildInsights(blocks, team, categories, LEADER_QUERY);
    expect(insights).toHaveLength(3);
    expect(insights[0]).toMatchObject({ tone: "warning", title: "Saída hoje em 81,3%", text: "Abaixo de ontem em 13,2 p.p. (ontem 94,4%); meta 95%." });
    expect(insights[1]).toMatchObject({ tone: "critical", title: "Pneus concentra as pendências", text: "28 pendências, 5 críticas." });
    expect(insights[2]).toMatchObject({ tone: "warning", title: "2 de 6 sem checklist na semana" });
    // Sem base, sem insight inventado.
    const empty = leadershipFixture("sem-escopo");
    const none = buildInsights(empty.blocks, empty.home.ok ? empty.home.data.team : null, pendingByCategory(empty.blocks, ""), "");
    expect(none).toEqual([]);
  });
});

test.describe("calendário de checklists (regra)", () => {
  const days = obligationDays(COMPETENCE);
  const calendar = buildCalendar({
    year: COMPETENCE.year,
    month: COMPETENCE.month,
    today: TODAY,
    obligations: days,
    executions: monthExecutions(COMPETENCE, days),
  });
  const day = (d: number) => calendar.days[d - 1];

  test("começa no domingo: 01/10/2026 é quinta-feira", () => {
    expect(calendar.leading).toBe(4);
    expect(calendar.days).toHaveLength(31);
  });

  test("só é falta o que era obrigação; dia sem obrigação fica neutro", () => {
    expect(day(5).saida?.tone).toBe("missed");
    expect(day(5).retorno?.tone).toBe("done");
    expect(day(8).retorno?.tone).toBe("missed");
    // sábado sem obrigação e sem checklist: neutro, nunca "não realizado"
    expect(day(10).saida).toBeNull();
    expect(day(10).retorno).toBeNull();
    // expurgo: dispensado, com o status oficial
    expect(day(9).saida?.tone).toBe("excused");
    expect(day(9).saida?.statusCode).toBe("MANUTENCAO");
  });

  test("checklist enviado sem obrigação conta como realizado", () => {
    expect(day(11).saida).toMatchObject({ tone: "done", byObligation: false, plate: "KXT9B07" });
    expect(day(11).retorno).toBeNull();
  });

  test("hoje: saída feita, retorno ainda no prazo; dias futuros previstos", () => {
    expect(day(13).isToday).toBe(true);
    expect(day(13).saida?.tone).toBe("done");
    expect(day(13).retorno).toMatchObject({ tone: "pending", label: "Aguardando retorno" });
    expect(day(14).isFuture).toBe(true);
    expect(day(14).saida).toMatchObject({ tone: "planned", label: "Previsto" });
  });

  test("dia vigente sem checklist é pendente; duas BRs no mesmo dia somam", () => {
    const base = days.find((d) => d.date === "2026-10-13")!;
    const provisional = {
      ...base,
      saida: { ...base.saida!, status: "NAO_FEZ_CHECKLIST", done: false, provisional: true },
    };
    const other = {
      ...base,
      brCode: "BR-RJ-099",
      licensePlate: "QWE1A23",
      saida: { ...base.saida!, status: "NAO_FEZ_CHECKLIST", done: false, provisional: false },
    };
    const onlyToday = buildCalendar({ year: 2026, month: 10, today: TODAY, obligations: [provisional], executions: [] });
    expect(onlyToday.days[12].saida).toMatchObject({ tone: "pending", label: "Pendente hoje" });

    const twoBrs = buildCalendar({ year: 2026, month: 10, today: TODAY, obligations: [base, other], executions: [] });
    expect(twoBrs.days[12].saida).toMatchObject({ tone: "missed", label: "1 de 2 realizados", due: 2, done: 1, extra: 1 });
  });
});

/* -------------------------------------------------------------------------- */
/* Home do Operacional                                                        */
/* -------------------------------------------------------------------------- */

test.describe("Home do Operacional (prévia)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("menu do Operacional: Início, Aplicativos, Histórico e Perfil — nada da operação", async ({ page }) => {
    await page.goto(`${PREVIEW}?perfil=operacional`);
    const nav = page.getByRole("navigation", { name: "Navegação principal" });
    for (const [name, href] of [
      ["Início", "/inicio"],
      ["Todos os aplicativos", "/aplicativos"],
      ["Check List de Frota", "/aplicativos/check-list-frota"],
      ["Vistoria MTSR", "/aplicativos/vistoria-mtsr"],
      ["Vistoria de Pneus", "/aplicativos/vistoria-pneus"],
      ["Meus checklists", "/aplicativos/check-list-frota/meus-checklists"],
      ["Meus apontamentos", "/checklist/planos-acao/meus-apontamentos"],
      ["Minha situação", "/checklist/aderencia/minha-situacao"],
      ["Perfil", "/perfil"],
    ] as const) {
      await expect(nav.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
    }
    // Tem operations.view e vehicles.view (o Check List precisa), e mesmo assim
    // Operações e Cadastro de frotas não são telas dele.
    for (const name of ["Dashboard", "Operações", "Cadastro de frotas", "Aderência", "Planos de ação", "Gestão de Pneus"]) {
      await expect(nav.getByRole("link", { name, exact: true })).toHaveCount(0);
    }
    await expect(page.getByText("Menu operacional", { exact: true }).first()).toBeVisible();
    // No desktop a navegação inferior não aparece.
    await expect(page.getByRole("navigation", { name: "Navegação do celular" })).toBeHidden();
  });

  test("saudação compacta e ações do dia: o que exige a pessoa primeiro, com estado e botão", async ({ page }) => {
    const crashes = collectCrashes(page);
    await page.goto(`${PREVIEW}?perfil=operacional`);
    await expect(page.getByRole("heading", { name: "Olá, Carlos", level: 1 })).toBeVisible();
    await expect(page.getByText("Terça-feira, 13 de outubro · Distribuição Rio · Filial Rio de Janeiro · Matrícula 140349")).toBeVisible();

    const section = page.getByTestId("acoes-do-dia");
    await expect(section.getByRole("heading", { name: "Ações do dia" })).toBeVisible();
    await expect(section.getByText("1 de 3 concluídas")).toBeVisible();
    const rows = section.getByTestId("acao");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toHaveAttribute("data-state", "retornado");
    await expect(rows.nth(0)).toContainText("Vistoria MTSR devolvida");
    await expect(rows.nth(0)).toContainText("Retornado");
    await expect(rows.nth(0)).toContainText("Refazer a verificação do extintor com foto do lacre");
    await expect(rows.nth(0).getByRole("link", { name: "Refazer" })).toHaveAttribute("href", "/aplicativos/vistoria-mtsr");
    await expect(rows.nth(1)).toHaveAttribute("data-state", "em_andamento");
    await expect(rows.nth(1)).toContainText("Checklist de retorno");
    await expect(rows.nth(1)).toContainText("Em andamento");
    await expect(rows.nth(1)).toContainText("RJX4A21 · BR BR-RJ-012 · até 23:59");
    await expect(rows.nth(1).getByRole("link", { name: "Fazer retorno" })).toHaveAttribute("href", "/aplicativos/check-list-frota");
    await expect(rows.nth(2)).toHaveAttribute("data-state", "concluido");
    await expect(rows.nth(2)).toContainText("Concluído");
    await expect(rows.nth(2).getByRole("link")).toHaveCount(0);

    // Pendências: só o que depende da pessoa (a vistoria devolvida), não o que já foi feito.
    const pending = page.getByTestId("pendencias");
    await expect(pending.getByTestId("acao")).toHaveCount(1);
    await expect(pending.getByTestId("acao")).toContainText("Vistoria MTSR devolvida");
    expect(crashes).toEqual([]);
  });

  test("meus aplicativos, meu veículo e histórico recente", async ({ page }) => {
    await page.goto(`${PREVIEW}?perfil=operacional`);
    const apps = page.getByTestId("meus-aplicativos");
    await expect(apps.getByRole("link", { name: "Ver todos" })).toHaveAttribute("href", "/aplicativos");
    await expect(apps.getByTestId("app-checklist_frota")).toHaveAttribute("href", "/aplicativos/check-list-frota");
    await expect(apps.getByTestId("app-vistoria_mtsr")).toHaveAttribute("href", "/aplicativos/vistoria-mtsr");
    await expect(apps.getByTestId("app-vistoria_pneus")).toHaveAttribute("href", "/aplicativos/vistoria-pneus");

    const vehicle = page.getByTestId("meu-veiculo-cartao");
    await expect(vehicle).toContainText("RJX4A21");
    await expect(vehicle).toContainText("Frota F-1203 · Van · Sprinter 415");
    await expect(vehicle).toContainText("Ativo");
    await expect(vehicle).toContainText("BR-RJ-012");
    await expect(vehicle).toContainText("Distribuição Rio · Rio de Janeiro/RJ");
    await expect(vehicle.getByTestId("veiculo-ultimo-checklist")).toHaveText("13/10, 09:12 · saída");
    await expect(vehicle.getByTestId("veiculo-km")).toContainText("184.230 km");
    await expect(vehicle.getByTestId("veiculo-km")).toContainText("12/10/2026");
    await expect(vehicle.getByTestId("veiculo-apontamentos").getByRole("link")).toHaveAttribute("href", "/checklist/planos-acao/meus-apontamentos");
    await expect(vehicle.getByTestId("veiculo-apontamentos")).toContainText("3");
    await expect(vehicle.getByTestId("veiculo-manutencao")).toContainText("Manutenção agendada");
    await expect(vehicle.getByTestId("veiculo-manutencao")).toContainText("MNT-2026-0412 · agendada para 16/10/2026");

    const history = page.getByTestId("historico-recente");
    await expect(history.getByRole("link", { name: "Ver histórico" })).toHaveAttribute("href", "/aplicativos/check-list-frota/meus-checklists");
    const rows = history.getByTestId("atividade");
    await expect(rows).toHaveCount(5);
    await expect(rows.nth(0)).toContainText("Checklist de saída · RJX4A21");
    await expect(rows.nth(0)).toContainText("Enviado");
    await expect(rows.nth(1)).toContainText("1 apontamento");
    await expect(rows.nth(2)).toContainText("Vistoria MTSR");
    await expect(rows.nth(2)).toContainText("MTSR-2026-000077");
    await expect(rows.nth(2)).toContainText("Retornada");
    await expect(rows.nth(3)).toContainText("Vistoria de pneus");
    await expect(rows.nth(3)).toContainText("Sincronizada");
  });

  test("meus números e resolução continuam da rotina oficial", async ({ page }) => {
    await page.goto(`${PREVIEW}?perfil=operacional`);
    await expect(page.getByTestId("kpi-checklists")).toContainText("51");
    await expect(page.getByTestId("kpi-checklists")).toContainText("Último em 13/10/2026 · 14 neste mês");
    await expect(page.getByTestId("kpi-aguardando")).toContainText("3");
    await expect(page.getByTestId("kpi-resolvidos")).toContainText("62,5% dos seus apontamentos");
    await expect(page.getByTestId("resolucao")).toContainText("5 de 8 apontamentos com reparo concluído");
  });

  test("calendário: obrigação, expurgo, neutro, checklist avulso e hoje", async ({ page }) => {
    await page.goto(`${PREVIEW}?perfil=operacional`);
    const cal = page.getByTestId("calendario");
    await expect(cal.getByTestId("calendario-mes")).toHaveText("Outubro 2026");

    await expect(cal.getByTestId("dia-2026-10-05")).toHaveAttribute("aria-label", "Dia 5. Saída: não realizado. Retorno: realizado (RJX4A21).");
    await expect(cal.getByTestId("dia-2026-10-09")).toHaveAttribute("aria-label", "Dia 9. Saída: manutenção. Retorno: manutenção.");
    await expect(cal.getByTestId("dia-2026-10-10")).toHaveAttribute("aria-label", "Dia 10: sem checklist previsto.");
    await expect(cal.getByTestId("dia-2026-10-10")).toBeDisabled();
    await expect(cal.getByTestId("dia-2026-10-11")).toHaveAttribute("aria-label", "Dia 11. Saída: realizado (KXT9B07).");
    await expect(cal.getByTestId("dia-2026-10-13")).toHaveAttribute("data-today", "true");
    await expect(cal.getByTestId("calendario-totais")).toHaveText(
      "14 checklists enviados no mês · aderência 86,67% (13 de 15) · 2 não realizados",
    );

    await cal.getByTestId("dia-2026-10-13").click();
    const detail = page.getByTestId("dia-detalhe");
    await expect(detail.getByRole("heading", { name: /Checklists de 13\/10\/2026/ })).toBeVisible();
    await expect(detail.getByTestId("dia-saida")).toContainText("Realizado");
    await expect(detail.getByTestId("dia-retorno")).toContainText("Retorno pendente");

    await detail.getByTestId("dia-saida").getByRole("button", { name: "Ver checklist" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("calendário: trocar de mês vai para a URL e volta ao mês atual", async ({ page }) => {
    await page.goto(`${PREVIEW}?perfil=operacional`);
    await page.getByRole("button", { name: "Próximo mês" }).click();
    await expect(page).toHaveURL(/mes=11/);
    await expect(page.getByTestId("calendario-mes")).toHaveText("Novembro 2026");
    await page.getByRole("button", { name: "Mês atual" }).click();
    await expect(page.getByTestId("calendario-mes")).toHaveText("Outubro 2026");
  });

  test("sem fidelização: 'Tudo em dia', sem veículo, e o app não habilitado na operação some", async ({ page }) => {
    await page.goto(`${PREVIEW}?perfil=operacional&cenario=sem-fidelizacao`);
    const actions = page.getByTestId("acoes-do-dia");
    await expect(actions.getByRole("heading", { name: "Tudo em dia" })).toBeVisible();
    await expect(actions.getByText(/Você não é motorista titular de nenhuma BR hoje/)).toBeVisible();
    await expect(actions.getByRole("link", { name: "Abrir o Check List de Frota" })).toHaveAttribute("href", "/aplicativos/check-list-frota");
    await expect(page.getByTestId("pendencias-vazio")).toHaveText("Nenhuma pendência. Tudo em dia.");
    await expect(page.getByTestId("meu-veiculo").getByRole("heading", { name: "Sem veículo fidelizado hoje" })).toBeVisible();
    // Vistoria de Pneus não está habilitada na operação do vínculo: nenhum azulejo para onde a pessoa não pode ir.
    const apps = page.getByTestId("meus-aplicativos");
    await expect(apps.getByTestId("app-checklist_frota")).toBeVisible();
    await expect(apps.getByTestId("app-vistoria_mtsr")).toBeVisible();
    await expect(apps.getByTestId("app-vistoria_pneus")).toHaveCount(0);

    // Sem obrigações carregadas, nenhum dia vira falta.
    for (const [cenario, alerta] of [
      ["sem-fidelizacao", /não é motorista titular de nenhuma BR/],
      ["erro-obrigacoes", /As obrigações do mês não carregaram/],
    ] as const) {
      await page.goto(`${PREVIEW}?perfil=operacional&cenario=${cenario}`);
      await expect(page.getByTestId("calendario").getByText(alerta)).toBeVisible();
      const labels = await page.getByTestId("calendario").locator("[data-testid^='dia-2026']").evaluateAll((els) =>
        els.map((el) => el.getAttribute("aria-label") ?? ""),
      );
      expect(labels.some((l) => l.includes("não realizado")), cenario).toBe(false);
      expect(labels.some((l) => l.includes("realizado (RJX4A21)")), cenario).toBe(true);
    }
  });

  test("falha ao carregar: o erro no lugar dos números, nunca zero; conta nova sem histórico", async ({ page }) => {
    await page.goto(`${PREVIEW}?perfil=operacional&cenario=erro`);
    await expect(page.getByText("Não foi possível carregar as suas ações de hoje.")).toBeVisible();
    await expect(page.getByText("Não foi possível carregar seus números.")).toBeVisible();
    await expect(page.getByText("Não foi possível carregar o seu calendário.")).toBeVisible();
    await expect(page.getByTestId("kpi-checklists")).toHaveCount(0);
    await expect(page.getByTestId("acao")).toHaveCount(0);
    // Os aplicativos continuam disponíveis pela permissão, mesmo sem o catálogo.
    await expect(page.getByTestId("meus-aplicativos").getByTestId("app-checklist_frota")).toBeVisible();

    await page.goto(`${PREVIEW}?perfil=operacional&cenario=novo`);
    await expect(page.getByTestId("acoes-do-dia").getByRole("heading", { name: "Tudo em dia" })).toBeVisible();
    await expect(page.getByTestId("acoes-do-dia").getByText("Nenhuma obrigação de checklist para hoje.")).toBeVisible();
    await expect(page.getByTestId("historico-recente")).toContainText("Nenhuma atividade registrada ainda.");
    await expect(page.getByTestId("veiculo-ultimo-checklist")).toHaveText("Nenhum");
    await expect(page.getByTestId("veiculo-manutencao")).toHaveText("Sem manutenção aberta");
    await expect(page.getByTestId("kpi-checklists")).toContainText("Nenhum enviado ainda");
    await expect(page.getByTestId("resolucao")).toContainText("Você ainda não tem apontamentos de manutenção nos últimos 90 dias");
  });

  test("sino: a central de notificações abre e, sem fonte, diz que não há nada", async ({ page }) => {
    await page.goto(`${PREVIEW}?perfil=operacional`);
    await page.getByRole("button", { name: "Notificações" }).click();
    await expect(page.getByTestId("notificacoes")).toContainText("Nenhuma notificação no momento.");
  });
});

/* -------------------------------------------------------------------------- */
/* Home da Liderança                                                          */
/* -------------------------------------------------------------------------- */

test.describe("Home da Liderança (prévia)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("menu da Liderança em acordeão: Início, Gestão da operação, Frota, Segurança e Aplicativos", async ({ page }) => {
    await page.goto(`${PREVIEW}?perfil=lideranca`);
    const nav = page.getByRole("navigation", { name: "Navegação principal" });
    await expect(nav.getByRole("link", { name: "Início", exact: true })).toHaveAttribute("href", "/inicio");
    const groups: Record<string, [string, string][]> = {
      "Gestão da operação": [
        ["Aderência", "/checklist/aderencia"], ["Planos de ação", "/checklist/planos-acao"], ["Fidelização", "/governanca/fidelizacao"],
        ["BRs", "/governanca/brs"], ["Lideranças", "/governanca/liderancas"],
      ],
      Frota: [
        ["Cadastro de frotas", "/frota/cadastro"], ["Gestão de KM Rodado", "/frota/km"], ["Gestão de Pneus", "/frota/pneus"], ["Manutenção", "/frota/manutencao"],
      ],
      Segurança: [["Gestão de MTSR", "/seguranca/mtsr"]],
      Aplicativos: [
        ["Check List de Frota", "/aplicativos/check-list-frota"], ["Vistoria MTSR", "/aplicativos/vistoria-mtsr"], ["Vistoria de Pneus", "/aplicativos/vistoria-pneus"],
      ],
    };
    // Na Home nenhum grupo está aberto; abrir um fecha o anterior (acordeão).
    for (const label of Object.keys(groups)) {
      await expect(nav.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-expanded", "false");
    }
    let previous: string | null = null;
    for (const [label, items] of Object.entries(groups)) {
      await openGroup(nav, label);
      if (previous) await expect(nav.getByRole("button", { name: previous, exact: true })).toHaveAttribute("aria-expanded", "false");
      for (const [name, href] of items) {
        await expect(nav.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
      }
      previous = label;
    }
    // O perfil tem users.view, operations.view… e nenhuma dessas telas é da liderança.
    for (const name of ["Dashboard", "Colaboradores e usuários", "Fornecedores", "Perfis e permissões", "Operações", "Filiais", "Tipos de equipamento"]) {
      await expect(nav.getByText(name, { exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole("navigation", { name: "Navegação do celular" })).toHaveCount(0);
  });

  test("nível 1: cabeçalho com escopo e contagens, prioridades críticas primeiro com drill-down", async ({ page }) => {
    const crashes = collectCrashes(page);
    await page.goto(`${PREVIEW}?perfil=lideranca`);
    await expect(page.getByRole("heading", { name: "Portal da Liderança", level: 1 })).toBeVisible();
    await expect(page.getByText("Olá, Juliana Ferreira Costa. O que exige a sua atenção agora.")).toBeVisible();
    await expect(page.getByTestId("kpi-operacoes")).toContainText("2");
    await expect(page.getByTestId("kpi-operacoes")).toContainText("Distribuição Rio, Transferência Sul Fluminense");
    await expect(page.getByTestId("kpi-veiculos")).toContainText("41");
    await expect(page.getByTestId("kpi-veiculos")).toContainText("46 cadastrados · 7 sem operação");
    await expect(page.getByTestId("kpi-equipe")).toContainText("6");
    await expect(page.getByTestId("kpi-criticas")).toContainText("prioridades no total");

    const { home, blocks } = leadershipFixture("completo");
    const expected = buildPriorities(blocks, home.ok ? home.data.team : null, LEADER_QUERY);
    const cards = page.getByTestId("prioridades").getByTestId("prioridade");
    await expect(cards).toHaveCount(expected.items.length);
    await expect(page.getByTestId("kpi-criticas")).toContainText(String(expected.items.filter((p) => p.severity === "critical").length));
    await expect(cards.first()).toHaveAttribute("data-severity", "critical");
    await expect(cards.first()).toContainText("Crítico");
    await expect(cards.first()).toContainText("3 frotas com pneu crítico");
    await expect(cards.first()).toHaveAttribute("href", `/frota/pneus${LEADER_QUERY}`);
    const severities = await cards.evaluateAll((els) => els.map((el) => el.getAttribute("data-severity")));
    const rank = { critical: 0, high: 1, medium: 2 } as Record<string, number>;
    for (let i = 1; i < severities.length; i += 1) expect(rank[severities[i] ?? ""]).toBeGreaterThanOrEqual(rank[severities[i - 1] ?? ""]);
    expect(crashes).toEqual([]);
  });

  test("nível 2: aderência do dia com ontem, semana e meta; resumo; pendências por categoria; insights", async ({ page }) => {
    await page.goto(`${PREVIEW}?perfil=lideranca`);
    const adherence = page.getByTestId("aderencia-dia");
    await expect(adherence.getByRole("link", { name: "Abrir a Aderência" })).toHaveAttribute("href", `/checklist/aderencia${LEADER_QUERY}`);
    const saida = page.getByTestId("kpi-saida-hoje");
    await expect(saida).toContainText("81,3%");
    await expect(saida).toContainText("13 de 16 obrigações");
    await expect(saida).toContainText("Meta 95%");
    await expect(saida).toContainText("−13,2 p.p.");
    await expect(saida).toContainText("vs. ontem");
    await expect(page.getByTestId("kpi-retorno-hoje")).toContainText("9 ainda no prazo");
    await expect(page.getByTestId("kpi-sem-checklist")).toContainText("4");
    await expect(page.getByTestId("kpi-sem-checklist")).toContainText("19 realizados · 4 dispensados");
    await expect(page.getByTestId("kpi-semana")).toContainText("88,2%");
    await expect(page.getByTestId("kpi-semana")).toContainText("Saída 30/34 · Retorno 88,9%");
    await expect(page.getByTestId("sem-checklist-semana")).toContainText("Diego Martins Carvalho");

    await expect(page.getByTestId("resumo-frotas")).toHaveText("41");
    await expect(page.getByTestId("resumo-checklist")).toHaveText("81,3%");
    await expect(page.getByTestId("resumo-pneus")).toHaveText("3");
    await expect(page.getByTestId("resumo-mtsr")).toHaveText("2");

    const categories = page.getByTestId("pendencias-equipe");
    await expect(categories.getByTestId("categoria-checklist")).toContainText("7");
    await expect(categories.getByTestId("categoria-checklist")).toContainText("4 críticas");
    await expect(categories.getByTestId("categoria-checklist")).toContainText("4 sem envio hoje · 3 não realizados na semana");
    await expect(categories.getByTestId("categoria-tires")).toContainText("28");
    await expect(categories.getByTestId("categoria-tires")).toHaveAttribute("href", `/frota/pneus${LEADER_QUERY}`);
    await expect(categories.getByTestId("categoria-mtsr")).toContainText("10");
    await expect(categories.getByTestId("categoria-plans")).toContainText("11");

    const insights = page.getByTestId("insights");
    await expect(insights.getByText("Saída hoje em 81,3%")).toBeVisible();
    await expect(insights.getByText("Abaixo de ontem em 13,2 p.p. (ontem 94,4%); meta 95%.")).toBeVisible();
    await expect(insights.getByText("Pneus concentra as pendências")).toBeVisible();
    await expect(insights.getByText("2 de 6 sem checklist na semana")).toBeVisible();
  });

  test("níveis 3 e 4: manutenção, preditiva, KM, tendência, pneus, MTSR, planos, time e atalhos", async ({ page }) => {
    await page.goto(`${PREVIEW}?perfil=lideranca`);
    const secondary = page.getByTestId("secundarios");
    await expect(secondary.getByTestId("kpi-em-manutencao")).toContainText("3");
    await expect(secondary.getByTestId("kpi-em-manutencao")).toContainText("3 frotas imobilizadas");
    await expect(secondary.getByTestId("manutencao").getByRole("link", { name: "Abrir Manutenção" })).toHaveAttribute(
      "href",
      "/frota/manutencao?aba=programacao&lideranca=emp-120788",
    );
    await expect(secondary.getByTestId("kpi-preditiva-critica")).toContainText("3");
    await expect(secondary.getByTestId("preditiva")).toContainText("Freios · 2");
    await expect(secondary.getByTestId("kpi-km-mes")).toContainText("128.430");
    await expect(secondary.getByTestId("tendencia").getByRole("img", { name: "Aderência de saída por mês" })).toBeVisible();

    await expect(page.getByTestId("pneus")).toContainText("Frotas com pneu crítico");
    await expect(page.getByTestId("mtsr").getByRole("link", { name: "Abrir MTSR" })).toHaveAttribute("href", `/seguranca/mtsr${LEADER_QUERY}`);
    await expect(page.getByTestId("planos")).toContainText("11");
    const members = page.getByTestId("membro");
    await expect(members).toHaveCount(6);
    await expect(members.first()).toContainText("Sem checklist na semana");
    await expect(page.getByTestId("navegacao").getByRole("link", { name: /Gestão de Pneus/ })).toHaveAttribute("href", `/frota/pneus${LEADER_QUERY}`);
    await expect(page.getByTestId("aplicativos").getByRole("link")).toHaveCount(3);
  });

  test("modo compacto: só ação e resumo, sem os blocos secundários nem a lista do time", async ({ page }) => {
    await page.goto(`${PREVIEW}?perfil=lideranca`);
    await page.getByRole("radio", { name: "Compacto" }).click();
    await expect(page).toHaveURL(/modo=compacto/);
    await expect(page.getByTestId("inicio-lideranca")).toHaveAttribute("data-mode", "compacto");
    await expect(page.getByTestId("prioridades").getByTestId("prioridade").first()).toBeVisible();
    await expect(page.getByTestId("aderencia-dia")).toBeVisible();
    await expect(page.getByTestId("pendencias-equipe")).toBeVisible();
    await expect(page.getByTestId("secundarios")).toHaveCount(0);
    await expect(page.getByTestId("pneus")).toHaveCount(0);
    await expect(page.getByTestId("equipe")).toHaveCount(0);
    await expect(page.getByTestId("equipe-compacta")).toHaveText("2 de 6 da equipe sem checklist na semana.");
    await page.getByRole("radio", { name: "Padrão" }).click();
    await expect(page).not.toHaveURL(/modo=compacto/);
    await expect(page.getByTestId("secundarios")).toBeVisible();
  });

  test("recorte: minha liderança leva o filtro aos módulos; operações liberadas não", async ({ page }) => {
    await page.goto(`${PREVIEW}?perfil=lideranca`);
    await expect(page.getByRole("link", { name: "Abrir Gestão de Pneus" })).toHaveAttribute("href", `/frota/pneus${LEADER_QUERY}`);
    await page.getByRole("radio", { name: "Operações liberadas" }).click();
    await expect(page).toHaveURL(/escopo=operacoes/);
    await expect(page.getByRole("link", { name: "Abrir Gestão de Pneus" })).toHaveAttribute("href", "/frota/pneus");
    await expect(page.getByTestId("categoria-tires")).toHaveAttribute("href", "/frota/pneus");
    await expect(page.getByText("Números de tudo o que a sua conta enxerga nas operações liberadas.")).toBeVisible();
    // O modo e o recorte convivem na URL.
    await page.getByRole("radio", { name: "Compacto" }).click();
    await expect(page).toHaveURL(/escopo=operacoes/);
    await expect(page).toHaveURL(/modo=compacto/);
  });

  test("sem operações liberadas: avisa e não declara a operação sob controle", async ({ page }) => {
    await page.goto(`${PREVIEW}?perfil=lideranca&cenario=sem-escopo`);
    await expect(page.getByTestId("escopo-vazio")).toBeVisible();
    await expect(page.getByTestId("prioridades-sem-escopo")).toBeVisible();
    await expect(page.getByText("Tudo em dia")).toHaveCount(0);
    await expect(page.getByTestId("insights")).toHaveCount(0);
  });

  test("fonte que falha mostra o erro no lugar do número, nunca zero", async ({ page }) => {
    await page.goto(`${PREVIEW}?perfil=lideranca&cenario=erros`);
    await expect(page.getByText("Não foi possível carregar os pneus.")).toBeVisible();
    await expect(page.getByText("Não foi possível carregar o MTSR.")).toBeVisible();
    await expect(page.getByText("Não foi possível carregar a Manutenção.")).toBeVisible();
    await expect(page.getByText("Não foi possível carregar o KM.")).toBeVisible();
    await expect(page.getByText("Algumas fontes não carregaram; a lista pode estar incompleta.")).toBeVisible();
    await expect(page.getByTestId("kpi-veiculos")).toContainText("—");
    await expect(page.getByTestId("kpi-veiculos")).toContainText("Não foi possível carregar a frota");
    await expect(page.getByTestId("categoria-tires")).toContainText("Não carregou");
    await expect(page.getByTestId("categoria-tires")).toContainText("—");
    await expect(page.getByTestId("resumo-pneus")).toHaveText("—");
    await expect(page.getByRole("button", { name: "Tentar novamente" }).first()).toBeVisible();

    await page.goto(`${PREVIEW}?perfil=lideranca&cenario=sem-colaborador`);
    await expect(page.getByText("Sem colaborador vinculado à sua conta")).toBeVisible();
    await expect(page.getByRole("radio", { name: "Minha liderança" })).toHaveCount(0);
    await expect(page.getByTestId("kpi-equipe")).toContainText("Sem colaborador vinculado");
  });
});

test.describe("trava do portal: o caminho que chega ao servidor", () => {
  test("o middleware encaminha o caminho real e sobrescreve o que o cliente mandar", async ({ browser }) => {
    // Um cliente que tenta se passar por /inicio para abrir outra tela.
    const context = await browser.newContext({ extraHTTPHeaders: { "x-hfm-pathname": "/inicio" } });
    const page = await context.newPage();
    await page.goto(`${PREVIEW}/cabecalho`);
    await expect(page.getByTestId("pathname")).toHaveText(`${PREVIEW}/cabecalho`);
    await context.close();
  });
});

/* -------------------------------------------------------------------------- */
/* Responsividade e acessibilidade                                            */
/* -------------------------------------------------------------------------- */

test.describe("pós-login: celular, desktop e acessibilidade", () => {
  for (const width of [375, 390, 430]) {
    test(`celular ${width}px: sem rolagem horizontal; Operacional com a navegação inferior`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      for (const query of [
        "?perfil=operacional",
        "?perfil=operacional&cenario=sem-fidelizacao",
        "?perfil=operacional&cenario=erro",
        "?perfil=lideranca",
        "?perfil=lideranca&modo=compacto",
        "?perfil=lideranca&cenario=sem-escopo",
      ]) {
        await page.goto(`${PREVIEW}${query}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        expect(await horizontalOverflow(page), `${query}: a página não pode rolar horizontalmente no celular`).toBeLessThanOrEqual(0);

        const bottom = page.getByRole("navigation", { name: "Navegação do celular" });
        if (query.includes("operacional")) {
          await expect(bottom).toBeVisible();
          for (const [name, href] of [["Início", "/inicio"], ["Aplicativos", "/aplicativos"], ["Histórico", "/aplicativos/check-list-frota/meus-checklists"], ["Perfil", "/perfil"]] as const) {
            await expect(bottom.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
          }
          // Os azulejos dos aplicativos: 2 por linha no celular.
          const tiles = page.getByTestId("meus-aplicativos").locator("ul > li");
          if ((await tiles.count()) >= 2) {
            const [a, b] = await Promise.all([tiles.nth(0).boundingBox(), tiles.nth(1).boundingBox()]);
            expect(a && b && Math.abs(a.y - b.y) < 2, "dois azulejos na mesma linha").toBe(true);
          }
        } else {
          await expect(bottom).toHaveCount(0);
        }
      }
    });
  }

  for (const [width, height] of [[1366, 768], [1440, 900], [1920, 1080]] as const) {
    test(`desktop ${width}×${height}: Liderança sem rolagem horizontal, prioridades acima da dobra`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      for (const query of ["?perfil=lideranca", "?perfil=lideranca&modo=compacto", "?perfil=operacional"]) {
        await page.goto(`${PREVIEW}${query}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        expect(await horizontalOverflow(page), `${query} em ${width}px`).toBeLessThanOrEqual(0);
      }
      await page.goto(`${PREVIEW}?perfil=lideranca`);
      const box = await page.getByTestId("prioridades").boundingBox();
      expect(box, "a seção de prioridades existe").not.toBeNull();
      expect(box!.y, "as prioridades começam na primeira tela").toBeLessThan(height);
    });
  }

  for (const theme of ["light", "dark"] as const) {
    test(`acessibilidade sem violações (${theme})`, async ({ page }) => {
      for (const query of ["?perfil=operacional", "?perfil=lideranca", "?perfil=lideranca&modo=compacto"]) {
        await page.goto(`${PREVIEW}${query}`);
        await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [THEME_KEY, theme] as const);
        await page.reload();
        await page.waitForFunction((t) => document.documentElement.classList.contains("dark") === (t === "dark"), theme);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        const violations = results.violations.map((v) => ({
          id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, target: v.nodes[0]?.target?.join(" "),
        }));
        expect(violations, `${query} (${theme}): ${JSON.stringify(violations, null, 2)}`).toEqual([]);
      }
    });
  }
});
