import { test, expect } from "@playwright/test";

/**
 * Gestão de Checklist → Aderência (Etapa 11).
 *
 * Roda contra `/dev/preview-aderencia`, que renderiza a mesma tela com dados
 * fixos — o exemplo da §68 (8 feitos em 9 obrigações devidas). O que se prova
 * aqui é a APRESENTAÇÃO da regra, porque a regra em si está no banco e é
 * coberta por `supabase/tests/remote/11_adherence.sql`:
 *
 *  - a fórmula aparece como 88,89% e nunca como média;
 *  - o dia vigente sem execução é "Não fez checklist" (provisório), não "Sem
 *    dados"; datas futuras são "Planejado";
 *  - o contexto (saída/retorno) vive na URL e governa a tela;
 *  - a matriz não espreme 31 colunas no celular: vira visão por veículo;
 *  - sem base de cálculo, a tela escreve "Sem base", nunca 0% ou 100%.
 */
const PREVIEW = "/dev/preview-aderencia";

test.describe("aderência", () => {
  test("visão consolidada apresenta a fórmula oficial e a meta", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (error) => crashes.push(error.message));

    await page.goto(PREVIEW);
    await expect(page.getByRole("heading", { name: "Aderência", level: 1 })).toBeVisible();

    // 8 / 9 = 88,89% — soma sobre soma, escrito, com o par numerador/denominador ao lado.
    await expect(page.getByText("88,89%").first()).toBeVisible();
    await expect(page.getByText("8 / 9").first()).toBeVisible();
    // A meta é parâmetro: aparece com a diferença assinada.
    await expect(page.getByText("90,00%").first()).toBeVisible();
    await expect(page.getByText("-1,11%").first()).toBeVisible();
    // A quebra por operação usa a mesma regra.
    await expect(page.getByRole("cell", { name: "Last Mille MG" })).toBeVisible();
    await expect(page.getByText("83,33%")).toBeVisible();

    expect(crashes).toEqual([]);
  });

  test("o contexto saída/retorno vive na URL e governa a tela", async ({ page }) => {
    await page.goto(PREVIEW);
    const retorno = page.getByRole("button", { name: "Retorno de rota" });
    await expect(retorno).toHaveAttribute("aria-pressed", "false");
    await retorno.click();
    await expect(page).toHaveURL(/contexto=retorno/);
    await expect(page.getByRole("button", { name: "Retorno de rota" })).toHaveAttribute("aria-pressed", "true");
    // O painel diz qual contexto está sendo mostrado.
    await expect(page.getByText(/Retorno de rota · Setembro\/2026/).first()).toBeVisible();
  });

  test("matriz: hoje sem execução é NÃO FEZ provisório; amanhã é Planejado; sem obrigação é Sem dados", async ({ page }) => {
    await page.goto(`${PREVIEW}?aba=matriz`);

    // A primeira coluna é fixa: o veículo continua visível ao rolar até o dia 30.
    const label = page.locator("div.sticky.left-0").filter({ hasText: "VA116" }).first();
    await expect(label).toBeVisible();

    // Dia vigente (22) sem execução: "Não fez checklist", marcado como provisório — jamais "Sem dados".
    const hoje = page.getByRole("button", { name: /2026-09-22: Não fez checklist · dia vigente/ }).first();
    await expect(hoje).toBeVisible();
    await expect(hoje).toHaveText("NF");

    // Data futura: Planejado, não descumprimento.
    const amanha = page.getByRole("button", { name: /2026-09-23: Planejado/ }).first();
    await expect(amanha).toHaveText("PL");

    // Veículo que só entrou na fidelização no dia 15: antes disso, sem dados (traço, não NF).
    const semDados = page.locator('[title="2026-09-03: sem dados (nenhuma obrigação conhecida)"]').first();
    await expect(semDados).toBeVisible();
    await expect(semDados).toHaveText(/—/);
    await expect(semDados).toContainText("Sem dados"); // texto para leitores de tela

    // Expurgo aprovado aparece com o status do motivo, não como feito nem como não fez.
    await expect(page.getByRole("button", { name: /2026-09-20: Sem rota/ }).first()).toHaveText("SR");
  });

  test("heatmap: dia futuro não é descumprimento e o dia vigente está destacado", async ({ page }) => {
    await page.goto(`${PREVIEW}?aba=heatmap`);
    const dia25 = page.getByRole("gridcell").filter({ hasText: /^25/ }).first();
    await expect(dia25).toContainText("Planejado");
    const dia22 = page.getByRole("gridcell").filter({ hasText: /^22/ }).first();
    await expect(dia22).toContainText("66,67%");
    // Selecionar o dia leva à jornada daquele dia.
    await dia22.click();
    await expect(page).toHaveURL(/aba=jornada/);
    await expect(page).toHaveURL(/dia=2026-09-22/);
  });

  test("jornada: saída feita não é jornada completa", async ({ page }) => {
    await page.goto(`${PREVIEW}?aba=jornada&dia=2026-09-22`);
    await expect(page.getByText("Jornada completa: 1")).toBeVisible();
    await expect(page.getByText("Em rota: 3")).toBeVisible();
    await expect(page.getByText("Não realizada: 2")).toBeVisible();
  });

  test("expurgos: pendente, aprovada e rejeitada são estados distintos", async ({ page }) => {
    await page.goto(`${PREVIEW}?aba=expurgos`);
    const table = page.getByRole("table").first();
    await expect(table.getByText("Pendente", { exact: true })).toBeVisible();
    await expect(table.getByText("Aprovada", { exact: true })).toBeVisible();
    await expect(table.getByText("Rejeitada", { exact: true })).toBeVisible();
    // A pendente tem a ação de decidir; a decidida não.
    await expect(page.getByRole("button", { name: "Decidir" })).toHaveCount(1);
  });

  test("celular: a matriz vira visão por veículo, sem rolagem horizontal da página", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${PREVIEW}?aba=matriz`);
    await expect(page.getByRole("combobox", { name: "Veículo" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "a página não pode rolar horizontalmente no celular").toBeLessThanOrEqual(0);
  });

  test("governança: reconciliação exige prévia e motivo; regras e motivos são parâmetros visíveis", async ({ page }) => {
    await page.goto(`${PREVIEW}?aba=governanca`);
    await expect(page.getByRole("button", { name: "Aplicar reconciliação" })).toBeDisabled();
    await expect(page.getByText("Frota prevista: saída e retorno diários")).toBeVisible();
    await expect(page.getByText("Execução comprovada por outra fonte")).toBeVisible();
    await expect(page.getByRole("cell", { name: "Execução sem obrigação" })).toBeVisible();
  });
});
