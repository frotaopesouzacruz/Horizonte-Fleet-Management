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

/**
 * A mesma lógica de "Aplicativos habilitados" de Tipos de Equipamento, agora no
 * formulário da operação: uma aba "Aplicativos" ao lado de "Dados gerais".
 *
 * A prévia não tem sessão, então o painel pode avisar que não conseguiu
 * carregar os vínculos — o que se segura aqui é a aba existir, abrir e trazer o
 * painel certo. O título é procurado dentro do drawer porque a página de
 * detalhe, logo abaixo, mostra o mesmo cartão: as duas portas leem a mesma
 * fonte, e encontrá-lo lá fora não provaria nada sobre o formulário.
 */
test("editar operação: abas Dados gerais e Aplicativos, com o painel de aplicativos", async ({ page }) => {
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));

  await page.goto("/dev/preview-organizacao");
  await page.getByRole("button", { name: "Editar operação" }).click();

  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("tab", { name: "Dados gerais" })).toBeVisible();
  await expect(drawer.getByRole("tab", { name: "Aplicativos" })).toBeVisible();

  // "Dados gerais" abre primeiro: o formulário continua sendo o formulário.
  await expect(drawer.getByLabel("Nome da operação")).toHaveValue("Last Mille MG");

  await drawer.getByRole("tab", { name: "Aplicativos" }).click();
  await expect(drawer.getByRole("heading", { name: "Aplicativos habilitados" })).toBeVisible();

  expect(new URL(page.url()).pathname).toBe("/dev/preview-organizacao");
  expect(crashes, crashes.join("\n")).toEqual([]);
});

/**
 * Da operação para as suas BRs em um clique: o atalho aponta para o módulo BRs
 * já filtrado por esta operação, e só aparece para quem pode ver a fidelização.
 */
test("detalhe da operação: atalho para as BRs desta operação", async ({ page }) => {
  await page.goto("/dev/preview-organizacao");

  const link = page.getByRole("link", { name: "Consultar BRs desta operação" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "/governanca/brs?operacao=1");
});
