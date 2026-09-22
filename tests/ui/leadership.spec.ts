import { test, expect } from "@playwright/test";

/**
 * Lideranças — cartões de cobertura (§12) e "o que esta liderança responde" (§35).
 *
 * Roda contra `/dev/preview-liderancas`, que renderiza a mesma tela com dados
 * fixos — o mesmo portão do design system. O que se verifica é o que a tela
 * diz, não o que o banco calcula: um local sem liderança vira aviso, a
 * cobertura é uma razão em pt-BR, e a gaveta lista as BRs com a regra que
 * respondeu por cada uma (exceção do BR → cidade → operação, §43).
 */
const WIDTHS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "celular", width: 390, height: 844 },
];

test.describe("lideranças", () => {
  test("os cartões dizem locais sem liderança, cobertura e o que está sob responsabilidade", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (error) => crashes.push(error.message));

    await page.goto("/dev/preview-liderancas");

    // Cada cartão é a `section` mais próxima do seu rótulo em `h3`. Subir pelo
    // ancestral imediato evita casar também com uma `section` da casca da
    // página que contenha o mesmo título.
    const cartao = (nome: string) =>
      page.getByRole("heading", { name: nome, exact: true }).locator("xpath=ancestor::section[1]");

    // §12: 3 de 4 locais com liderança principal — um fica de fora e é dito.
    const semLideranca = cartao("Locais sem liderança");
    await expect(semLideranca).toContainText("1");
    await expect(semLideranca).toContainText("3 de 4 com liderança");

    await expect(cartao("Cobertura")).toContainText("75%");

    const sob = cartao("Sob responsabilidade");
    await expect(sob).toContainText("62");
    await expect(sob).toContainText("BRs");
    await expect(sob).toContainText("60 veículos · 12 motoristas");

    expect(crashes, crashes.join("\n")).toEqual([]);
  });

  test("a gaveta lista as BRs de uma liderança com a regra que respondeu por cada uma", async ({ page }) => {
    await page.goto("/dev/preview-liderancas");

    await page
      .getByRole("button", { name: "O que esta liderança responde: Daniela Ferreira Lima" })
      .first()
      .click();

    const gaveta = page.getByRole("dialog", { name: "Daniela Ferreira Lima" });
    await expect(gaveta).toBeVisible();

    // Totais reais, contados no servidor — aqui, na fixture.
    const totais = gaveta.locator("dl[aria-label='Totais sob responsabilidade']");
    await expect(totais.locator("div").filter({ hasText: "BRs" })).toContainText("2");
    await expect(totais.locator("div").filter({ hasText: "Veículos" })).toContainText("1");
    await expect(totais.locator("div").filter({ hasText: "Motoristas" })).toContainText("1");

    // §43: a BR0024901 tem exceção própria e por isso não está sob a liderança
    // da cidade; as duas que estão dizem "cidade" como origem da regra.
    const tabela = gaveta.getByRole("table");
    await expect(tabela.getByRole("row").filter({ hasText: "BR0024706" })).toContainText("cidade");
    await expect(tabela.getByRole("row").filter({ hasText: "BR0024706" })).toContainText("Rafael Souza Campos");
    await expect(tabela.getByRole("row").filter({ hasText: "BR0024052" })).toContainText("Sem veículo");
    await expect(tabela.getByRole("row").filter({ hasText: "BR0024901" })).toHaveCount(0);

    // A data e a precedência ficam ditas, não subentendidas.
    await expect(gaveta.getByText(/Resolvido em 21\/09\/2026 pela precedência exceção do BR → cidade → operação/)).toBeVisible();
  });

  test("a exceção do BR aparece como tal na gaveta de quem a tem", async ({ page }) => {
    await page.goto("/dev/preview-liderancas");

    await page
      .getByRole("button", { name: "O que esta liderança responde: Walace Rodrigues Santos" })
      .first()
      .click();

    const gaveta = page.getByRole("dialog", { name: "Walace Rodrigues Santos" });
    await expect(gaveta.getByRole("row").filter({ hasText: "BR0024901" })).toContainText("exceção do BR");
    // Sem cidade designada, a seção diz "—" em vez de sumir.
    await expect(gaveta.getByRole("heading", { name: "Cidades" })).toBeVisible();
  });

  for (const size of WIDTHS) {
    test(`não há rolagem horizontal (${size.name})`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto("/dev/preview-liderancas");
      await expect(page.getByRole("heading", { name: "Cobertura", exact: true })).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `sobra de ${overflow}px na largura`).toBeLessThanOrEqual(0);
    });
  }
});
