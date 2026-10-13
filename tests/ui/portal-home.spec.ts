import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { portalAllowsPath } from "../../src/lib/auth/portal";
import { buildCalendar } from "../../src/lib/portal/calendar";
import { COMPETENCE, TODAY, monthExecutions, obligationDays } from "../../src/app/dev/preview-inicio/fixture";

/**
 * Pós-login: o Início de cada perfil e a alçada das telas.
 *
 * Duas camadas, testadas separadamente:
 *
 *   * as REGRAS puras — que telas cada portal abre (`portalAllowsPath`) e como
 *     o calendário decide cada quadrante (`buildCalendar`) —, sem navegador;
 *   * as TELAS, contra `/dev/preview-inicio` (dados fixos de outubro/2026,
 *     hoje dia 13): menu de cada perfil, "Meu resumo" com o calendário,
 *     Portal da Liderança com prioridades, recortes e estados de erro,
 *     celular sem rolagem lateral e acessibilidade nos dois temas.
 *
 * Quem é a pessoa, que perfis ela tem e o que é dela vem do banco e é coberto
 * por `supabase/tests/remote/35_portals_post_login.sql`.
 */
const PREVIEW = "/dev/preview-inicio";
const THEME_KEY = "hfm.theme";

function collectCrashes(page: Page): string[] {
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));
  return crashes;
}

test.describe("portal: telas de cada perfil (regra)", () => {
  test("Operacional abre o início, os apps e só o que é dele", () => {
    for (const path of [
      "/inicio",
      "/aplicativos/check-list-frota",
      "/aplicativos/check-list-frota/meus-checklists",
      "/aplicativos/vistoria-mtsr",
      "/aplicativos/vistoria-pneus",
      "/checklist/aderencia/minha-situacao",
      "/checklist/planos-acao/meus-apontamentos",
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
      "/frota/pneus",
      "/governanca/fidelizacao",
      // prefixo não é pertencimento
      "/inicio-falso",
      "/aplicativos/check-list-frota-x",
    ]) {
      expect(portalAllowsPath("operational", path), path).toBe(false);
    }
  });

  test("Liderança abre a operação que lidera, não a administração nem a estrutura", () => {
    for (const path of [
      "/inicio",
      "/checklist/aderencia",
      "/checklist/aderencia/export",
      "/checklist/planos-acao",
      "/governanca/fidelizacao",
      "/governanca/brs",
      "/frota/km/relatorio",
      "/frota/pneus/abc",
      "/frota/manutencao",
      "/seguranca/mtsr/veiculos/x",
      "/aplicativos/vistoria-pneus",
    ]) {
      expect(portalAllowsPath("leadership", path), path).toBe(true);
    }
    for (const path of [
      "/dashboard",
      "/administracao/usuarios",
      "/administracao/usuarios/export",
      "/administracao/perfis",
      "/governanca/liderancas",
      "/governanca/liderancas/export",
      "/organizacao/operacoes",
      "/estrutura/filiais",
      "/frota/cadastro",
      "/frota/tipos-equipamento",
    ]) {
      expect(portalAllowsPath("leadership", path), path).toBe(false);
    }
  });

  test("sem portal (gestão): nenhuma trava além das permissões", () => {
    for (const path of ["/dashboard", "/administracao/usuarios", "/frota/cadastro", "/inicio"]) {
      expect(portalAllowsPath("management", path), path).toBe(true);
    }
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

test.describe("Início do Operacional (prévia)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("menu do Operacional: Meu resumo, Minha rotina e Aplicativos — nada da operação", async ({ page }) => {
    await page.goto(`${PREVIEW}?perfil=operacional`);
    const nav = page.getByRole("navigation", { name: "Navegação principal" });
    for (const [name, href] of [
      ["Meu resumo", "/inicio"],
      ["Meus checklists", "/aplicativos/check-list-frota/meus-checklists"],
      ["Meus apontamentos", "/checklist/planos-acao/meus-apontamentos"],
      ["Minha situação", "/checklist/aderencia/minha-situacao"],
      ["Check List de Frota", "/aplicativos/check-list-frota"],
      ["Vistoria MTSR", "/aplicativos/vistoria-mtsr"],
      ["Vistoria de Pneus", "/aplicativos/vistoria-pneus"],
    ] as const) {
      await expect(nav.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
    }
    // Tem operations.view e vehicles.view (o Check List precisa), e mesmo assim
    // Operações e Cadastro de frotas não são telas dele.
    for (const name of ["Dashboard", "Operações", "Cadastro de frotas", "Aderência", "Planos de ação"]) {
      await expect(nav.getByRole("link", { name, exact: true })).toHaveCount(0);
    }
    await expect(page.getByText("Menu operacional", { exact: true }).first()).toBeVisible();
  });

  test("Meu resumo: saudação, app de checklist, atalhos e meus números", async ({ page }) => {
    const crashes = collectCrashes(page);
    await page.goto(`${PREVIEW}?perfil=operacional`);
    await expect(page.getByRole("heading", { name: "Olá, Carlos", level: 1 })).toBeVisible();
    await expect(page.getByText(/Carlos Eduardo Nogueira Silva · Matrícula 140349 · Motorista/)).toBeVisible();

    await expect(page.getByTestId("atalho-checklist")).toHaveAttribute("href", "/aplicativos/check-list-frota");
    await expect(page.getByRole("link", { name: /Meus checklists realizados/ })).toHaveAttribute(
      "href",
      "/aplicativos/check-list-frota/meus-checklists",
    );

    await expect(page.getByTestId("kpi-checklists")).toContainText("51");
    await expect(page.getByTestId("kpi-checklists")).toContainText("Último em 13/10/2026 · 14 neste mês");
    await expect(page.getByTestId("kpi-aguardando")).toContainText("3");
    await expect(page.getByTestId("kpi-resolvidos")).toContainText("62,5% dos seus apontamentos");
    await expect(page.getByTestId("resolucao")).toContainText("5 de 8 apontamentos com reparo concluído");
    expect(crashes).toEqual([]);
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

  test("sem fidelização ou sem obrigações carregadas, nenhum dia vira falta", async ({ page }) => {
    for (const [cenario, alerta] of [
      ["sem-fidelizacao", /não é motorista titular de nenhuma BR/],
      ["erro-obrigacoes", /As obrigações do mês não carregaram/],
    ] as const) {
      await page.goto(`${PREVIEW}?perfil=operacional&cenario=${cenario}`);
      await expect(page.getByText(alerta)).toBeVisible();
      const labels = await page.getByTestId("calendario").locator("[data-testid^='dia-2026']").evaluateAll((els) =>
        els.map((el) => el.getAttribute("aria-label") ?? ""),
      );
      expect(labels.some((l) => l.includes("não realizado")), cenario).toBe(false);
      expect(labels.some((l) => l.includes("realizado (RJX4A21)")), cenario).toBe(true);
    }
  });

  test("falha ao carregar: o erro no lugar dos números, nunca zero", async ({ page }) => {
    await page.goto(`${PREVIEW}?perfil=operacional&cenario=erro`);
    await expect(page.getByText("Não foi possível carregar seus números.")).toBeVisible();
    await expect(page.getByText("Não foi possível carregar o seu calendário.")).toBeVisible();
    await expect(page.getByTestId("kpi-checklists")).toHaveCount(0);

    await page.goto(`${PREVIEW}?perfil=operacional&cenario=novo`);
    await expect(page.getByTestId("kpi-checklists")).toContainText("Nenhum enviado ainda");
    await expect(page.getByTestId("resolucao")).toContainText("Você ainda não tem apontamentos de manutenção nos últimos 90 dias");
  });
});

test.describe("Portal da Liderança (prévia)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("menu da Liderança: a operação que ela lidera, sem administração nem estrutura", async ({ page }) => {
    await page.goto(`${PREVIEW}?perfil=lideranca`);
    const nav = page.getByRole("navigation", { name: "Navegação principal" });
    for (const name of [
      "Portal da Liderança", "Aderência", "Planos de ação", "Fidelização", "BRs", "Gestão de KM Rodado",
      "Gestão de Pneus", "Manutenção", "Gestão de MTSR", "Check List de Frota", "Vistoria MTSR", "Vistoria de Pneus",
    ]) {
      await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
    }
    // O perfil tem users.view, leadership.manage, operations.view, vehicles.view…
    // e nenhuma dessas telas é da liderança (no HFC também não).
    for (const name of [
      "Dashboard", "Colaboradores e usuários", "Perfis e permissões", "Operações", "Filiais",
      "Tipos de equipamento", "Lideranças", "Cadastro de frotas",
    ]) {
      await expect(nav.getByRole("link", { name, exact: true })).toHaveCount(0);
    }
  });

  test("portal: escopo, hoje, semana, prioridades e equipe", async ({ page }) => {
    const crashes = collectCrashes(page);
    await page.goto(`${PREVIEW}?perfil=lideranca`);
    await expect(page.getByRole("heading", { name: "Portal da Liderança", level: 1 })).toBeVisible();
    await expect(page.getByTestId("kpi-operacoes")).toContainText("Distribuição Rio, Transferência Sul Fluminense");
    await expect(page.getByTestId("kpi-responsabilidades")).toContainText("3");
    await expect(page.getByTestId("kpi-saida-hoje")).toContainText("81,3%");
    await expect(page.getByTestId("kpi-saida-hoje")).toContainText("13 de 16 obrigações");

    const priorities = page.getByTestId("prioridades").getByRole("listitem");
    await expect(priorities).toHaveCount(11);
    await expect(priorities.first()).toContainText("Crítico");
    await expect(priorities.first()).toContainText("3 frotas com pneu crítico");

    await expect(page.getByTestId("sem-checklist-semana")).toContainText("Diego Martins Carvalho");
    const members = page.getByTestId("membro");
    await expect(members).toHaveCount(6);
    await expect(members.first()).toContainText("Sem checklist na semana");
    expect(crashes).toEqual([]);
  });

  test("recorte: minha liderança leva o filtro aos módulos; operações liberadas não", async ({ page }) => {
    await page.goto(`${PREVIEW}?perfil=lideranca`);
    await expect(page.getByRole("link", { name: "Abrir Gestão de Pneus" })).toHaveAttribute(
      "href",
      "/frota/pneus?lideranca=emp-120788",
    );
    await page.getByRole("radio", { name: "Operações liberadas" }).click();
    await expect(page).toHaveURL(/escopo=operacoes/);
    await expect(page.getByRole("link", { name: "Abrir Gestão de Pneus" })).toHaveAttribute("href", "/frota/pneus");
  });

  test("sem operações liberadas: avisa e não declara a operação sob controle", async ({ page }) => {
    await page.goto(`${PREVIEW}?perfil=lideranca&cenario=sem-escopo`);
    await expect(page.getByTestId("escopo-vazio")).toBeVisible();
    await expect(page.getByTestId("prioridades-sem-escopo")).toBeVisible();
    await expect(page.getByText("Operação sob controle pelas regras oficiais de hoje.")).toHaveCount(0);
  });

  test("fonte que falha mostra o erro e a lista avisa que está incompleta", async ({ page }) => {
    await page.goto(`${PREVIEW}?perfil=lideranca&cenario=erros`);
    await expect(page.getByText("Não foi possível carregar os pneus.")).toBeVisible();
    await expect(page.getByText("Não foi possível carregar o MTSR.")).toBeVisible();
    await expect(page.getByText("Algumas fontes não carregaram; a lista pode estar incompleta.")).toBeVisible();

    await page.goto(`${PREVIEW}?perfil=lideranca&cenario=sem-colaborador`);
    await expect(page.getByText("Sem colaborador vinculado à sua conta")).toBeVisible();
    await expect(page.getByRole("radio", { name: "Minha liderança" })).toHaveCount(0);
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

test.describe("pós-login: celular e acessibilidade", () => {
  test("celular 390px: sem rolagem horizontal nos dois portais", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const query of [
      "?perfil=operacional",
      "?perfil=operacional&cenario=sem-fidelizacao",
      "?perfil=lideranca",
      "?perfil=lideranca&cenario=sem-escopo",
    ]) {
      await page.goto(`${PREVIEW}${query}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${query}: a página não pode rolar horizontalmente no celular`).toBeLessThanOrEqual(0);
    }
  });

  for (const theme of ["light", "dark"] as const) {
    test(`acessibilidade sem violações (${theme})`, async ({ page }) => {
      for (const query of ["?perfil=operacional", "?perfil=lideranca"]) {
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
