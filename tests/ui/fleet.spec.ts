import { test, expect } from "@playwright/test";

/**
 * Cadastro de frotas: abrir a ficha de um veículo e abrir "Nova frota".
 *
 * As leituras disparadas por clique já redirecionaram para /login quando a
 * sessão não respondia — o que, de dentro de uma tela aberta, não vira erro,
 * vira navegação: a pessoa perde o que preencheu e a tela "para de funcionar"
 * sem mensagem. Estes testes seguram as duas pontas: clicar numa linha não tira
 * ninguém da página, e o formulário de cadastro novo aceita digitação.
 */
test("clicar numa linha não tira ninguém da tela", async ({ page }) => {
  await page.goto("/dev/preview-frota");
  await page.locator("table tbody tr").first().click();
  await page.waitForTimeout(1200);

  // Continua na tela, e o que abriu foi a ficha do veículo — não o login.
  expect(new URL(page.url()).pathname).toBe("/dev/preview-frota");
  await expect(page.locator("[role=dialog]").first()).toBeVisible();
});

test("nova frota: os campos de identificação aceitam digitação", async ({ page }) => {
  await page.goto("/dev/preview-frota");
  await page.getByRole("button", { name: /Nova frota/i }).first().click();

  const placa = page.getByLabel(/Placa/).first();
  await expect(placa).toBeEnabled();
  await placa.fill("ABC1D23");
  await expect(placa).toHaveValue("ABC1D23");

  expect(new URL(page.url()).pathname).toBe("/dev/preview-frota");
});
