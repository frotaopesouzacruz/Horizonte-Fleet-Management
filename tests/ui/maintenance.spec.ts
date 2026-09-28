import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Gestão de Frota → Manutenção (Etapa 16).
 *
 * Roda contra `/dev/preview-manutencao`, que renderiza a mesma tela com dados
 * fixos. O que se prova aqui é a APRESENTAÇÃO: as regras (máquina de estados,
 * TMM, KM, bandas preventivas e preditivas, duplicidade, importação e
 * segurança) estão no banco e são cobertas por
 * `supabase/tests/remote/20_maintenance.sql`.
 *
 *  - as sete abas existem e só aparecem com a permissão correspondente;
 *  - os indicadores levam à fila certa (o cartão e a lista contam igual);
 *  - situação técnica e execução aparecem separadas na preditiva;
 *  - a matriz preventiva mostra ciclos MP com marco e saldo;
 *  - o assistente de abertura tem os cinco passos oficiais;
 *  - light e dark sem violação de acessibilidade; celular sem rolagem lateral.
 */
const PREVIEW = "/dev/preview-manutencao";
const TABS = [
  ["visao-geral", "Visão geral"],
  ["programacao", "Programação & execução"],
  ["preventiva", "Preventiva"],
  ["preditiva", "Preditiva"],
  ["base", "Base geral"],
  ["cadastros", "Cadastros"],
  ["importacoes", "Importações"],
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

test.describe("manutenção", () => {
  test("as sete abas oficiais, na ordem, e a entrada no menu Gestão de frota", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(PREVIEW);
    await expect(page.getByRole("heading", { name: "Manutenção", level: 1 })).toBeVisible();
    await expect(page.getByRole("tab")).toHaveText(TABS.map(([, label]) => label));
    const nav = page.getByRole("navigation", { name: "Navegação principal" });
    await expect(nav.getByRole("link", { name: "Manutenção" })).toHaveAttribute("href", "/frota/manutencao");
    expect(crashes).toEqual([]);
  });

  test("visão geral: TMM pela entrada e saída reais, frota imobilizada e o cartão leva à fila", async ({ page }) => {
    const crashes = crashesOf(page);
    await page.goto(`${PREVIEW}?aba=visao-geral`);
    await expect(page.getByText(/data\s+de solicitação nunca entra no cálculo/i).first()).toBeVisible();
    await expect(page.getByTestId("maintenance-overview").getByText("1,7").first()).toBeVisible();
    await expect(page.getByText("Frota imobilizada").first()).toBeVisible();
    await expect(page.getByText("Possível reincidência").first()).toBeVisible();

    await page.getByRole("link", { name: /Atrasadas para entrada/ }).first().click();
    await expect(page).toHaveURL(/aba=programacao/);
    await expect(page).toHaveURL(/fila=late_entry/);
    expect(crashes).toEqual([]);
  });

  test("programação: nove indicadores, a fila filtra a lista e os alertas aparecem na linha", async ({ page }) => {
    await page.goto(`${PREVIEW}?aba=programacao`);
    for (const label of [
      "Há agendar", "Agendadas", "Em execução", "Agendadas hoje", "Previsão de saída vencida",
      "Vencidas sem agendamento", "Atrasadas para entrada", "Acima do SLA", "Concluídas hoje",
    ]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText("Entrada atrasada").first()).toBeVisible();
    await expect(page.getByText("Saída vencida").first()).toBeVisible();
    await expect(page.getByText("MAN-2026-000097").first()).toBeVisible();

    const card = page.getByRole("button", { name: /Previsão de saída vencida/ }).first();
    await expect(card).toHaveAttribute("aria-pressed", "false");
    await card.click();
    await expect(page).toHaveURL(/fila=exit_overdue/);
    await expect(page.getByRole("button", { name: /Previsão de saída vencida/ }).first()).toHaveAttribute("aria-pressed", "true");
  });

  test("preventiva: ciclos MP com marco, situação e gerar manutenção", async ({ page }) => {
    await page.goto(`${PREVIEW}?aba=preventiva`);
    const matrix = page.getByTestId("maintenance-preventive-matrix");
    await expect(matrix).toBeVisible();
    for (const status of ["Realizada", "Vencida", "Crítica", "A programar", "Não atingida"]) {
      await expect(matrix.getByText(status, { exact: true }).first()).toBeVisible();
    }
    await expect(matrix.getByText("10.000 km").first()).toBeVisible();
    // Veículo sem parâmetro: diagnóstico explícito, nunca uma linha em branco.
    await expect(matrix.getByText(/Sem parâmetro preventivo/).first()).toBeVisible();
    // Manutenção aberta do ciclo aparece no lugar do botão.
    await expect(matrix.getByText("MAN-2026-000121").first()).toBeVisible();

    await matrix.getByTestId("maintenance-preventive-generate").first().click();
    await expect(page.getByRole("dialog", { name: /Gerar manutenção preventiva/ })).toBeVisible();
  });

  test("preditiva: situação técnica separada da execução, alertas e matriz veículo × item", async ({ page }) => {
    await page.goto(`${PREVIEW}?aba=preditiva`);
    await expect(page.getByText("Situação técnica e execução são coisas diferentes")).toBeVisible();
    const alerts = page.locator("table").first();
    await expect(alerts.getByText("Crítico", { exact: true }).first()).toBeVisible();
    await expect(alerts.getByText("Não programada").first()).toBeVisible();
    await expect(alerts.getByText("Correia dentada").first()).toBeVisible();

    await page.goto(`${PREVIEW}?aba=preditiva&visao=matriz`);
    await expect(page.locator("table").first().getByText("Sistema de freios").first()).toBeVisible();
  });

  test("base geral: tabela e hierarquia Operação → Cidade → BR → Veículo", async ({ page }) => {
    await page.goto(`${PREVIEW}?aba=base`);
    await expect(page.getByText("MAN-2026-000069").first()).toBeVisible();
    await expect(page.getByText("Reaberta").first()).toBeVisible();

    await page.getByRole("button", { name: "Hierarquia" }).click();
    await expect(page).toHaveURL(/visao=hierarquia/);
    const tree = page.getByTestId("maintenance-hierarchy");
    await expect(tree.getByText("Last Mille MG").first()).toBeVisible();
    await expect(tree.getByText("Redespacho - Belém/Pa").first()).toBeVisible();
  });

  test("cadastros: seções, mapeamento Serviços × Check List e prévia dos marcos preventivos", async ({ page }) => {
    await page.goto(`${PREVIEW}?aba=cadastros&secao=servicos`);
    await expect(page.getByText("Troca de pastilhas").first()).toBeVisible();
    await page.goto(`${PREVIEW}?aba=cadastros&secao=preventiva`);
    await expect(page.getByText("Revisão preventiva").first()).toBeVisible();
    await expect(page.getByText("10.000 km").first()).toBeVisible();
    await page.goto(`${PREVIEW}?aba=cadastros&secao=preditiva`);
    await expect(page.getByText("Plano Van Master").first()).toBeVisible();
    await expect(page.getByText("Aprovado").first()).toBeVisible();
  });

  test("importações: cinco bases, layout e modelo; nunca cria veículo nem mexe em perfis", async ({ page }) => {
    await page.goto(`${PREVIEW}?aba=importacoes`);
    for (const base of ["Clusters técnicos", "Serviços", "Fornecedores", "Parâmetros preventivos", "Base de manutenções"]) {
      await expect(page.getByText(base, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByRole("button", { name: /Baixar modelo/ })).toBeVisible();
    await expect(page.getByText("base_manutencao_2026.xlsx")).toBeVisible();
  });

  test("assistente de abertura: FROTA → SERVIÇO → PROGRAMAÇÃO → KM → REVISÃO", async ({ page }) => {
    await page.goto(`${PREVIEW}?aba=programacao`);
    await page.getByTestId("maintenance-new").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    for (const step of ["Frota", "Serviço", "Programação", "KM", "Revisão"]) {
      await expect(dialog.getByText(step, { exact: true }).first()).toBeVisible();
    }
  });

  test("perfil Liderança: sem Importações, sem Exportar e sem gestão de cadastros", async ({ page }) => {
    await page.goto(`${PREVIEW}?perfil=lideranca`);
    await expect(page.getByRole("tab", { name: "Importações" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Exportar" })).toHaveCount(0);
    await expect(page.getByTestId("maintenance-new")).toBeVisible();
  });

  for (const [tab] of TABS) {
    test(`celular: ${tab} sem rolagem horizontal da página`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const crashes = crashesOf(page);
      await page.goto(`${PREVIEW}?aba=${tab}`);
      await expect(page.getByRole("heading", { name: "Manutenção", level: 1 })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      expect(crashes).toEqual([]);
    });
  }

  for (const [tab] of TABS) {
    for (const theme of ["light", "dark"] as const) {
      test(`${tab} sem violações de acessibilidade (${theme})`, async ({ page }) => {
        await setTheme(page, `${PREVIEW}?aba=${tab}`, theme);
        await expect(page.getByRole("heading", { name: "Manutenção", level: 1 })).toBeVisible();
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
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
});
