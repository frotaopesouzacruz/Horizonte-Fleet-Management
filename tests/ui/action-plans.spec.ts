import { test, expect, type Page } from "@playwright/test";

/**
 * Gestão de Checklist → Planos de Ação (Plano de Ação de Manutenção).
 *
 * Roda contra `/dev/preview-planos-acao`, que renderiza a mesma tela com dados
 * fixos (placas TST…, nomes de exemplo). O que se prova aqui é a
 * APRESENTAÇÃO: a máquina de estados, a conciliação, os indicadores, a
 * importação e a segurança estão nas rotinas do banco.
 *
 *  - as sete abas existem, na ordem, e o menu leva ao módulo;
 *  - a visão geral mostra a Aderência de Tratativa e o indicador leva à lista;
 *  - os planos trocam de agrupamento pela URL;
 *  - a gaveta do plano tem as seis abas;
 *  - a pergunta de avaria aparece como Avaria nos Parâmetros;
 *  - qualidade, saúde da integração, importação e histórico funcionam sem servidor;
 *  - light e dark (capturas), 360 px sem rolagem lateral;
 *  - o perfil Liderança não vê nenhuma tratativa.
 */
const PREVIEW = "/dev/preview-planos-acao";
const SCREENSHOTS = process.env.SCREENSHOT_DIR ?? "tests/ui/.screenshots";

const TABS = [
  ["visao-geral", "Visão geral"],
  ["planos", "Planos de manutenção"],
  ["conciliacao", "Conciliação × Manutenções"],
  ["parametros", "Parâmetros & Mapeamento"],
  ["qualidade", "Qualidade & Auditoria"],
  ["minha-visao", "Minha visão"],
  ["historico", "Histórico de checklists"],
] as const;

const PANEL: Record<(typeof TABS)[number][0], string> = {
  "visao-geral": "action-plans-overview",
  planos: "action-plans-plans",
  conciliacao: "action-plans-reconciliation",
  parametros: "action-plans-parameters",
  qualidade: "action-plans-quality",
  "minha-visao": "action-plans-my-view",
  historico: "action-plans-history",
};

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
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

const heading = (page: Page) => page.getByRole("heading", { name: "Planos de Ação", level: 1 });

test.describe("planos de ação", () => {
  test("as sete abas oficiais, na ordem, e a entrada no menu Gestão de checklist", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(PREVIEW);
    await expect(heading(page)).toBeVisible();
    await expect(page.locator('[role="tab"][data-testid^="action-plans-tab-"]')).toHaveText(TABS.map(([, label]) => label));
    const nav = page.getByRole("navigation", { name: "Navegação principal" });
    await expect(nav.getByRole("link", { name: "Planos de ação" })).toHaveAttribute("href", "/checklist/planos-acao");
    // Fora do ramo (a prévia não é /checklist/planos-acao) o subitem fica atrás
    // do controle de expandir; dentro dele a Sidebar o abre sozinha.
    await nav.getByRole("button", { name: "Expandir Planos de ação" }).click();
    await expect(nav.getByRole("link", { name: "Meus apontamentos" })).toHaveAttribute(
      "href",
      "/checklist/planos-acao/meus-apontamentos",
    );
    expect(crashes).toEqual([]);
  });

  for (const [tab, label] of TABS) {
    test(`aba ${label} renderiza sem erro`, async ({ page }) => {
      const crashes = crashesOf(page);
      await page.goto(`${PREVIEW}?aba=${tab}`);
      await expect(page.getByTestId(`action-plans-tab-${tab}`)).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId(PANEL[tab]).first()).toBeVisible();
      expect(crashes).toEqual([]);
    });
  }

  test("visão geral: Aderência de Tratativa e o indicador leva aos planos filtrados", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=visao-geral`);
    const overview = page.getByTestId("action-plans-overview").first();
    await expect(overview.getByText("Aderência de Tratativa").first()).toBeVisible();

    await page.getByTestId("kpi-plans-overdue").getByRole("link").click();
    await expect(page).toHaveURL(/aba=planos/);
    await expect(page).toHaveURL(/prazo=overdue/);
    await expect(page.getByTestId("action-plans-tab-planos")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("action-plans-plans")).toBeVisible();
    expect(crashes).toEqual([]);
  });

  test("planos: o agrupamento troca pela URL e a lista mostra os planos", async ({ page }) => {
    await page.goto(`${PREVIEW}?aba=planos`);
    const grouping = page.getByTestId("action-plans-grouping");
    await expect(grouping).toBeVisible();
    await expect(page.getByTestId("action-plans-grouping-operation")).toHaveAttribute("aria-pressed", "true");

    await page.getByTestId("action-plans-grouping-vehicle").click();
    await expect(page).toHaveURL(/agrupar=vehicle/);
    await expect(page.getByTestId("action-plans-grouping-vehicle")).toHaveAttribute("aria-pressed", "true");

    await page.getByTestId("action-plans-grouping-list").click();
    await expect(page).toHaveURL(/agrupar=list/);
    await expect(page.getByText("PA-2026-000101").first()).toBeVisible();
    // Reincidência sinalizada na lista.
    await expect(page.getByText("PA-2026-000106").first()).toBeVisible();
  });

  test("gaveta do plano: seis abas", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=planos&agrupar=list`);
    await page.getByTestId("action-plans-row-open").filter({ hasText: "PA-2026-000101" }).first().click();
    const drawer = page.getByTestId("plan-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId("plan-drawer-code")).toContainText("PA-2026-000101");
    await expect(drawer.locator('[data-testid^="plan-drawer-tab-"]')).toHaveCount(6);
    expect(crashes).toEqual([]);
  });

  test("parâmetros: a pergunta de avaria aparece como Avaria, sem gerar plano", async ({ page }) => {
    await page.goto(`${PREVIEW}?aba=parametros`);
    const panel = page.getByTestId("action-plans-parameters");
    await expect(panel.getByText("Possui alguma avaria?").first()).toBeVisible();
    const row = page.getByTestId("parameters-row-q:possui_avaria").first();
    await expect(row).toBeVisible();
    await expect(row.getByText(/^Avaria/).first()).toBeVisible();
    await expect(panel.getByText("Descreva a avaria").first()).toBeVisible();
  });

  test("qualidade: verificações com classe, amostra que abre o plano e eventos recentes", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=qualidade`);
    const quality = page.getByTestId("action-plans-quality");
    await expect(quality.getByText("Correção automática segura").first()).toBeVisible();
    await expect(quality.getByText("Revisão necessária").first()).toBeVisible();
    await expect(quality.getByText("Bloqueada").first()).toBeVisible();
    await expect(page.getByTestId("action-plans-quality-fix")).toBeVisible();

    const card = quality.getByTestId("action-plans-quality-check").filter({ hasText: "Aberto há mais de 30 dias sem manutenção" });
    await card.getByRole("button", { name: /Ver amostra/ }).click();
    await card.getByRole("button", { name: /PA-2026-000106/ }).click();
    await expect(page.getByTestId("plan-drawer-code")).toContainText("PA-2026-000106");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("plan-drawer")).toBeHidden();

    await expect(page.getByTestId("action-plans-quality-events").getByText("Manutenção aberta pelo plano").first()).toBeVisible();

    // A confirmação explica o que a correção nunca faz.
    await page.getByTestId("action-plans-quality-fix").click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Nunca altera respostas do motorista");
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    expect(crashes).toEqual([]);
  });

  test("saúde da integração: indicadores, período na URL e reprocessamento", async ({ page }) => {
    await page.goto(`${PREVIEW}?aba=qualidade&secao=saude`);
    const health = page.getByTestId("action-plans-health");
    for (const label of ["Checklists enviados", "Processados", "Falhas", "De avaria", "Eventos de avaria pendentes", "Planos atualizados"]) {
      await expect(health.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await health.getByRole("button", { name: "7 dias" }).click();
    await expect(page).toHaveURL(/dias=7/);
    await expect(health.getByRole("button", { name: "7 dias" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("action-plans-reprocess")).toBeVisible();
  });

  test("importação: modelo CSV com as colunas do follow-up e o que nunca muda", async ({ page }) => {
    await page.goto(`${PREVIEW}?aba=qualidade&secao=importacao`);
    const section = page.getByTestId("action-plans-import");
    await expect(section.getByText(/Nunca cria veículos ou operações/).first()).toBeVisible();
    for (const action of ["SEM_MANUTENCAO", "IMPROCEDENTE", "CANCELAR", "MANTER"]) {
      await expect(section.getByText(action, { exact: true }).first()).toBeVisible();
    }
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("action-plans-import-template").click()]);
    expect(download.suggestedFilename()).toBe("modelo-follow-up-planos-de-acao.csv");
    const { readFile } = await import("node:fs/promises");
    const content = (await readFile((await download.path())!, "utf8")).replace(/^﻿/, "");
    expect(content.split(/\r?\n/)[0]).toBe("Código do plano;Placa;Item;Ação;Motivo;Justificativa;Data da resolução");
  });

  test("histórico: a linha abre o rastro do checklist", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=historico`);
    const history = page.getByTestId("action-plans-history");
    await expect(history.getByText("TST1A23").first()).toBeVisible();
    await history.getByRole("button", { name: /Abrir checklist de 30\/09\/2026 · TST1A23/ }).first().click();
    await expect(page.getByTestId("trace-drawer")).toBeVisible();
    expect(crashes).toEqual([]);
  });

  test("perfil Liderança: indicadores e exportação, nenhuma tratativa", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?perfil=lideranca`);
    await expect(heading(page)).toBeVisible();
    await expect(page.getByTestId("action-plans-tab-qualidade")).toHaveCount(0);
    await expect(page.getByTestId("action-plans-export")).toBeVisible();

    await page.goto(`${PREVIEW}?perfil=lideranca&aba=planos&agrupar=list`);
    await page.getByTestId("action-plans-row-open").filter({ hasText: "PA-2026-000101" }).first().click();
    const drawer = page.getByTestId("plan-drawer");
    await expect(drawer.locator('[data-testid^="plan-drawer-tab-"]')).toHaveCount(6);
    await expect(drawer.getByTestId("plan-drawer-actions")).toBeVisible();
    await expect(drawer.locator('[data-testid^="plan-action-"]')).toHaveCount(0);
    expect(crashes).toEqual([]);
  });

  for (const tab of ["visao-geral", "planos"] as const) {
    test(`360 px: ${tab} sem rolagem horizontal da página`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      const crashes = crashesOf(page);
      await page.goto(`${PREVIEW}?aba=${tab}`);
      await expect(heading(page)).toBeVisible();
      await expect(page.getByTestId(PANEL[tab]).first()).toBeVisible();
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      expect(crashes).toEqual([]);
    });
  }

  for (const theme of ["light", "dark"] as const) {
    test(`capturas em ${theme === "light" ? "claro" : "escuro"}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      for (const tab of ["visao-geral", "planos", "qualidade"] as const) {
        await setTheme(page, `${PREVIEW}?aba=${tab}`, theme);
        await expect(page.getByTestId(PANEL[tab]).first()).toBeVisible();
        await page.waitForLoadState("load");
        await page.screenshot({ path: `${SCREENSHOTS}/planos-acao-${tab}-${theme}-desktop.png`, fullPage: true });
      }
    });
  }
});
