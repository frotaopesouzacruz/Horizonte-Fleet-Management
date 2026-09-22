import { test, expect, type Page } from "@playwright/test";

/**
 * Check List de Frota — o fluxo de seleção (Refinamento da Etapa 12, §28–§36).
 *
 * O que só o navegador prova:
 *  · a ordem tipo → operação → tipo de equipamento → frota/placa → execução;
 *  · trocar a operação descarta o tipo e a placa (CA15); trocar o tipo
 *    descarta a placa (CA16);
 *  · a lista vazia diz exatamente o que a §36 pede, sem preencher com outra
 *    operação;
 *  · o alvo de toque serve a quem está em pé, de luva.
 */
const APP = "/dev/preview-checklist-fluxo";

const opcao = (page: Page, nome: string | RegExp) =>
  page.getByRole("button", { name: nome });

async function iniciar(page: Page) {
  await page.goto(APP);
  await page.getByRole("button", { name: "Iniciar Check List" }).click();
}

test.describe("fluxo do Check List de Frota", () => {
  test("segue a sequência tipo → operação → equipamento → placa → execução", async ({ page }) => {
    await iniciar(page);

    await expect(page.getByRole("heading", { name: "Tipo de Check List" })).toBeVisible();
    await opcao(page, "Saída para rota").click();

    await expect(page.getByRole("heading", { name: "Tipo de Operação" })).toBeVisible();
    // As quatro habilitadas — e nenhuma das desabilitadas (Frota, Gente, Gestão, Segurança).
    for (const nome of ["Last Mille MG", "Merchandising", "Redespacho - MG", "Redespacho - Belém/Pa"]) {
      await expect(opcao(page, nome)).toBeVisible();
    }
    await expect(opcao(page, /^Frota$|^Gente$|^Gestão$|^Segurança$/)).toHaveCount(0);
    await opcao(page, "Last Mille MG").click();

    await expect(page.getByRole("heading", { name: "Tipo de Equipamento" })).toBeVisible();
    await expect(opcao(page, /^Van/)).toBeVisible();
    await expect(opcao(page, /Frota Leve OPE/)).toBeVisible();
    // Frota Leve ADM está desabilitada para o aplicativo (§17, CA09).
    await expect(opcao(page, /Frota Leve ADM/)).toHaveCount(0);
    await opcao(page, /^Van/).click();

    await expect(page.getByRole("heading", { name: "Frota / Placa" })).toBeVisible();
    await expect(opcao(page, /ABC1D23/)).toBeVisible();
    await expect(opcao(page, /DEF4G56/)).toBeVisible();
    await opcao(page, /ABC1D23/).click();

    await expect(page.getByRole("heading", { name: "Clusters do checklist" })).toBeVisible();
    await expect(page.getByText("ABC1D23 · Saída para rota · Last Mille MG")).toBeVisible();
  });

  test("trocar a operação descarta o tipo de equipamento (CA15)", async ({ page }) => {
    await iniciar(page);
    await opcao(page, "Retorno de rota").click();
    await opcao(page, "Last Mille MG").click();
    await expect(opcao(page, /^Van/)).toBeVisible();
    await opcao(page, /^Van/).click();
    await expect(page.getByRole("heading", { name: "Frota / Placa" })).toBeVisible();

    // Volta duas etapas e escolhe outra operação.
    await page.getByRole("button", { name: "Voltar" }).click();
    await expect(page.getByRole("heading", { name: "Tipo de Equipamento" })).toBeVisible();
    await page.getByRole("button", { name: "Voltar" }).click();
    await opcao(page, "Merchandising").click();

    // Só o que Merchandising tem; a Van de Last Mille MG não sobrevive à troca.
    await expect(page.getByRole("heading", { name: "Tipo de Equipamento" })).toBeVisible();
    await expect(opcao(page, /Frota Leve OPE/)).toBeVisible();
    await expect(opcao(page, /^Van/)).toHaveCount(0);
    await expect(opcao(page, /Frota Leve OPE/)).toHaveAttribute("aria-pressed", "false");
  });

  test("trocar o tipo de equipamento descarta a placa (CA16)", async ({ page }) => {
    await iniciar(page);
    await opcao(page, "Saída para rota").click();
    await opcao(page, "Last Mille MG").click();
    await opcao(page, /^Van/).click();
    await expect(opcao(page, /ABC1D23/)).toBeVisible();

    await page.getByRole("button", { name: "Voltar" }).click();
    await opcao(page, /Frota Leve OPE/).click();

    await expect(page.getByRole("heading", { name: "Frota / Placa" })).toBeVisible();
    await expect(opcao(page, /HIJ7K89/)).toBeVisible();
    await expect(opcao(page, /ABC1D23/)).toHaveCount(0);
  });

  test("sem frota elegível, a mensagem da §36 aparece e nada é preenchido", async ({ page }) => {
    await iniciar(page);
    await opcao(page, "Saída para rota").click();
    await opcao(page, "Redespacho - MG").click();
    await opcao(page, /Caminhão/).click();

    await expect(
      page.getByText("Nenhuma frota disponível para a operação e o tipo de equipamento selecionados."),
    ).toBeVisible();
    await expect(opcao(page, /ABC1D23|DEF4G56|HIJ7K89|LMN0P12/)).toHaveCount(0);
  });

  test("operação sem tipo habilitado mostra o vazio, não a lista completa", async ({ page }) => {
    await iniciar(page);
    await opcao(page, "Saída para rota").click();
    await opcao(page, "Redespacho - Belém/Pa").click();
    await expect(page.getByText("Nenhum tipo de equipamento disponível")).toBeVisible();
  });

  test("o histórico abre e cada execução tem o detalhe", async ({ page }) => {
    await page.goto(APP);
    await page.getByRole("button", { name: /Meus checklists/ }).click();
    await expect(page.getByRole("heading", { name: "Meus checklists" })).toBeVisible();
    await expect(page.getByText("ABC1D23")).toBeVisible();
    await expect(page.getByRole("button", { name: "Ver" })).toBeVisible();
  });

  test("alvos de toque e ausência de rolagem horizontal no telefone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await iniciar(page);
    const saida = opcao(page, "Saída para rota");
    const box = await saida.boundingBox();
    expect(box, "cartão sem caixa").not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(56);

    await saida.click();
    await opcao(page, "Last Mille MG").click();
    await opcao(page, /^Van/).click();
    await expect(page.getByRole("heading", { name: "Frota / Placa" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `sobra de ${overflow}px`).toBeLessThanOrEqual(1);
  });
});
