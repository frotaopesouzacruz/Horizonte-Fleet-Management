import { test, expect, type Page } from "@playwright/test";

/**
 * Camadas: uma lista suspensa aberta de dentro de um formulário em painel tem
 * de ficar ACIMA do painel.
 *
 * Select, popover e menu são portados para o fim do `body`, fora da árvore do
 * drawer que os abriu. Enquanto a camada de menu ficou abaixo da camada de
 * overlay, toda lista suspensa de formulário abria atrás do painel: existia no
 * DOM, era "visible" no CSS, e mesmo assim ninguém conseguia usá-la — o clique
 * caía no overlay, que fechava o formulário. Foi o que impediu escolher cargo,
 * área, operação, tipo de equipamento, marca e modelo.
 *
 * Por isso estes testes não perguntam se a opção existe nem se ela está
 * visível: as duas coisas eram verdade com o defeito no ar. Eles perguntam
 * quem o navegador entrega em `elementFromPoint` no centro da opção — a única
 * pergunta cuja resposta muda quando a camada está errada.
 */

/*
 * Os locators abaixo usam seletor de atributo, não `getByRole`: ao abrir um
 * Select, o Radix marca todo o resto da página com `aria-hidden`, e aí o
 * drawer some da árvore de acessibilidade — `getByRole("dialog")` deixaria de
 * encontrá-lo no meio do próprio teste.
 */

/** Quem está por cima no centro da primeira opção do menu aberto. */
async function opcaoRecebeOClique(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const option = document.querySelector('[role="option"]');
    if (!option) return false;
    const box = option.getBoundingClientRect();
    const topo = document.elementFromPoint(
      Math.round(box.left + box.width / 2),
      Math.round(box.top + box.height / 2),
    );
    return Boolean(topo) && (topo === option || option.contains(topo as Node));
  });
}

test.describe("listas suspensas dentro de formulários em painel", () => {
  test("usuários: os campos do vínculo abrem e recebem o clique", async ({ page }) => {
    await page.goto("/dev/preview-usuarios");
    await page.getByRole("button", { name: "Novo usuário", exact: true }).first().click();

    const drawer = page.locator('[role="dialog"]').first();
    await drawer.getByRole("button", { name: /Vínculo/i }).first().click();

    const gatilhos = drawer.locator('[role="combobox"]');
    const total = await gatilhos.count();
    // Cargo, Área, Operação, Localidade, Filial, Líder imediato e Perfil.
    expect(total, "o passo Vínculo traz os sete campos de lista").toBe(7);

    for (let i = 0; i < total; i++) {
      const gatilho = gatilhos.nth(i);
      await gatilho.click();
      await expect(gatilho).toHaveAttribute("aria-expanded", "true");

      const opcoes = await page.locator('[role="option"]').count();
      expect(opcoes, `campo ${i + 1} sem nenhuma opção`).toBeGreaterThan(0);
      expect(await opcaoRecebeOClique(page), `campo ${i + 1} abriu atrás do painel`).toBe(true);

      await page.keyboard.press("Escape");
    }
  });

  test("frota: tipo de equipamento, marca e modelo abrem por cima do painel", async ({ page }) => {
    await page.goto("/dev/preview-frota");
    await page.getByRole("button", { name: "Nova frota", exact: true }).first().click();

    const drawer = page.locator('[role="dialog"]').first();

    // A ordem dos campos no passo de identificação: situação, titularidade,
    // tipo, subcategoria, marca, modelo.
    const CAMPOS = [
      { nome: "Tipo de equipamento", indice: 2 },
      { nome: "Marca", indice: 4 },
      { nome: "Modelo", indice: 5 },
    ];

    for (const { nome: campo, indice } of CAMPOS) {
      const gatilho = drawer.locator('[role="combobox"]').nth(indice);
      await gatilho.click();
      await expect(gatilho).toHaveAttribute("aria-expanded", "true");
      expect(await page.locator('[role="option"]').count(), `${campo} sem opções`).toBeGreaterThan(0);
      expect(await opcaoRecebeOClique(page), `${campo} abriu atrás do painel`).toBe(true);
      await page.keyboard.press("Escape");
    }
  });

  test("frota: escolher o tipo destrava a subcategoria", async ({ page }) => {
    await page.goto("/dev/preview-frota");
    await page.getByRole("button", { name: "Nova frota", exact: true }).first().click();

    const drawer = page.locator('[role="dialog"]').first();
    const tipo = drawer.locator('[role="combobox"]').nth(2);
    const subcategoria = drawer.locator('[role="combobox"]').nth(3);

    // A subcategoria pertence a um tipo: oferecê-la antes seria oferecer uma
    // lista que não se sabe de quem é.
    await expect(subcategoria).toBeDisabled();

    await tipo.click();
    await page.locator('[role="option"]').nth(1).click();

    await expect(subcategoria).toBeEnabled();
  });

  test("a escala de camadas mantém o menu acima do modal", async ({ page }) => {
    await page.goto("/dev/preview-usuarios");

    const camadas = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const n = (name: string) => Number(cs.getPropertyValue(name).trim());
      return {
        topbar: n("--z-topbar"),
        sidebar: n("--z-sidebar"),
        overlay: n("--z-overlay"),
        dropdown: n("--z-dropdown"),
        toast: n("--z-toast"),
      };
    });

    expect(camadas.sidebar).toBeGreaterThan(camadas.topbar);
    expect(camadas.overlay).toBeGreaterThan(camadas.sidebar);
    // A inversão que causou o defeito: menu por baixo do painel.
    expect(camadas.dropdown).toBeGreaterThan(camadas.overlay);
    expect(camadas.toast).toBeGreaterThan(camadas.dropdown);
  });
});
