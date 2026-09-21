import { test, expect } from "@playwright/test";

/**
 * A abrangência de uma operação: escolher o estado e, dentro dele, os
 * municípios.
 *
 * O seletor de estados já esteve atrás de um popover e foi relatado como "não
 * abre". Hoje é uma lista suspensa nativa — o único controle cuja abertura o
 * navegador garante, e que no celular vira o seletor do sistema. Estes testes
 * seguram o que importa em três larguras: o campo presente e habilitado sem
 * nenhum clique prévio, com os estados que faltam dentro dele; escolher um
 * entrando de fato na abrangência; e nada de navegar para outro lugar no
 * caminho.
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

    // Sem nenhum clique intermediário: o campo está na tela, habilitado, e já
    // traz os estados que faltam.
    const chooser = page.getByLabel("Adicionar estado");
    await expect(chooser).toBeVisible();
    await expect(chooser).toBeEnabled();
    expect(await chooser.locator("option").count()).toBeGreaterThan(1);

    const summary = page.locator("p").filter({ hasText: /estados? ·/ }).first();
    const before = await summary.textContent();

    await chooser.selectOption({ label: "SP · São Paulo" });
    await expect(summary).not.toHaveText(before ?? "");

    // Escolher um estado não navega para lugar nenhum.
    expect(new URL(page.url()).pathname).toBe("/dev/preview-organizacao");
    expect(crashes, crashes.join("\n")).toEqual([]);
  });
}
