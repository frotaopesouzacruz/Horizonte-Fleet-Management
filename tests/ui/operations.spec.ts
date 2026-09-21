import { test, expect } from "@playwright/test";

/**
 * A abrangência de uma operação: escolher o estado e, dentro dele, os
 * municípios.
 *
 * O seletor de estados já esteve atrás de um popover e foi relatado como "não
 * abre". Um controle que só existe depois de um clique é um controle que pode
 * não aparecer, então ele passou a ficar sempre à vista — e é isso que estes
 * testes protegem, em três larguras, junto com o fato de que escolher um estado
 * não tira ninguém da tela.
 */
const WIDTHS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "celular", width: 390, height: 844 },
];

for (const size of WIDTHS) {
  test(`abrangência: escolher estado sem abrir nada (${size.name})`, async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (error) => crashes.push(error.message));

    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/dev/preview-organizacao");
    await page.getByRole("button", { name: /Editar abrangência/i }).click();

    // Sem nenhum clique intermediário: o rótulo e as opções estão na tela.
    await expect(page.getByText("Adicionar estado", { exact: true })).toBeVisible();
    const option = page.getByRole("button", { name: /SP São Paulo/ });
    await expect(option).toBeVisible();

    const summary = page.locator("p").filter({ hasText: /estados? ·/ }).first();
    const before = await summary.textContent();

    await option.click();
    await expect(summary).not.toHaveText(before ?? "");

    // Escolher um estado não navega para lugar nenhum.
    expect(new URL(page.url()).pathname).toBe("/dev/preview-organizacao");
    expect(crashes, crashes.join("\n")).toEqual([]);
  });
}
