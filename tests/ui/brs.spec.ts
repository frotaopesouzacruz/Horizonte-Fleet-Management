import { test, expect } from "@playwright/test";

/**
 * Módulo BRs (Etapa 13.1).
 *
 * A BR é a posição operacional permanente e este módulo é a sua única casa
 * administrativa. A tela precisa dizer, para cada posição, o que a ocupa na
 * data-âncora da competência — e dizer por extenso quando nada a ocupa —,
 * ordenar no servidor pela URL, e virar cartões no celular em vez de espremer
 * dez colunas.
 *
 * Roda contra `/dev/preview-brs`, que renderiza o mesmo componente com dados
 * fixos — o mesmo portão do design system. Sem isso, nenhum destes
 * comportamentos seria verificável num ambiente que não alcança o Supabase.
 */
test.describe("módulo BRs", () => {
  test("lista as posições com o que as ocupa, e diz por extenso o que falta", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (error) => crashes.push(error.message));

    await page.goto("/dev/preview-brs");

    await expect(page.getByRole("heading", { level: 1, name: "BRs" })).toBeVisible();

    // §26: cadastrais e da competência, lado a lado mas separados.
    await expect(page.getByText("Posições cadastradas")).toBeVisible();
    await expect(page.getByText("2 ativas · 1 inativas")).toBeVisible();
    await expect(page.getByText("Com substituição no período")).toBeVisible();

    // §24: uma linha por posição, as três do cenário.
    const tabela = page.getByRole("table").first();
    await expect(tabela.getByText("BR0024706")).toBeVisible();
    await expect(tabela.getByText("BR0024901")).toBeVisible();
    await expect(tabela.getByText("Redespacho Belem/Pa_1")).toBeVisible();

    // A ausência é dita por extenso, nunca um traço mudo: a posição vaga diz
    // "Sem veículo" onde estaria a placa, e a sem responsável diz que não tem.
    await expect(tabela.getByRole("cell", { name: "Sem veículo" }).first()).toBeVisible();
    await expect(tabela.getByText("Sem liderança definida")).toBeVisible();

    // §43: o nível que respondeu fica dito, não só o nome.
    await expect(tabela.getByText("por cidade")).toBeVisible();
    await expect(tabela.getByText("por exceção do BR")).toBeVisible();

    // §22: a substituição iniciada no mês ganha um selo na última movimentação.
    await expect(tabela.getByText("substituição", { exact: true })).toBeVisible();

    // §22: a data que a competência representa fica dita, não subentendida.
    await expect(page.getByText(/Recursos resolvidos em 21\/09\/2026/)).toBeVisible();

    expect(crashes, crashes.join("\n")).toEqual([]);
  });

  test("ordenar por um cabeçalho escreve a ordem na URL, e o servidor faz o resto", async ({ page }) => {
    await page.goto("/dev/preview-brs");

    const tabela = page.getByRole("table").first();
    await tabela.getByRole("button", { name: "Operação", exact: true }).click();
    // §24: a ordenação vive na URL — não há uma segunda ordenação no cliente.
    await expect(page).toHaveURL(/ordem=operation/);
    await expect(page).toHaveURL(/dir=asc/);

    // Trocar a ordenação nunca carrega a página anterior consigo.
    await expect(page).not.toHaveURL(/page=/);
  });

  test("celular: as posições viram cartões, não uma tabela espremida", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (error) => crashes.push(error.message));

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dev/preview-brs");

    await expect(page.getByRole("table")).toBeHidden();
    const cartoes = page.getByRole("list", { name: "Posições operacionais" });
    await expect(cartoes).toBeVisible();
    await expect(cartoes.getByRole("listitem")).toHaveCount(3);
    await expect(cartoes.getByText("Sem liderança definida")).toBeVisible();
    // As mesmas ações da tabela, no cartão.
    await expect(cartoes.getByRole("button", { name: "Detalhar a BR0024706" })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `sobra de ${overflow}px na largura`).toBeLessThanOrEqual(0);
    expect(crashes, crashes.join("\n")).toEqual([]);
  });

  test("o detalhe abre sob o código da posição e falha em pé quando não há sessão", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (error) => crashes.push(error.message));

    await page.goto("/dev/preview-brs");
    await page.getByRole("button", { name: "Detalhar a BR0024706" }).click();

    const gaveta = page.getByRole("dialog");
    await expect(gaveta).toBeVisible();
    // Sem Supabase a leitura não tem como responder: o painel diz isso e
    // continua de pé, em vez de derrubar a tela.
    await expect(gaveta.getByText(/Não foi possível|sessão expirou/)).toBeVisible({ timeout: 15_000 });
    expect(crashes, crashes.join("\n")).toEqual([]);
  });
});
