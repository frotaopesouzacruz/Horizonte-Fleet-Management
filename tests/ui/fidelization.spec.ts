import { test, expect } from "@playwright/test";

/**
 * Planner de Locais e BRs (Etapa 13).
 *
 * A tela tem uma regra central e quatro estados que ela precisa distinguir:
 * a posição existe independentemente do veículo; a liderança pode vir da
 * cidade ou de uma exceção do próprio BR; a posição pode estar sem veículo; e
 * o agrupamento é por local, não uma lista plana de códigos.
 *
 * Roda contra `/dev/preview-fidelizacao`, que renderiza o mesmo componente com
 * dados fixos — o mesmo portão do design system. Sem isso, nenhum destes
 * comportamentos seria verificável num ambiente que não alcança o Supabase.
 */
const WIDTHS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "celular", width: 390, height: 844 },
];

test.describe("planner de locais e BRs", () => {
  test("agrupa por local e diz de onde vem cada liderança", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (error) => crashes.push(error.message));

    await page.goto("/dev/preview-fidelizacao");

    // §24: o cabeçalho de cada grupo é operação + cidade/UF, não um código solto.
    const contagem = page.getByRole("button", { name: /Last Mille MG.*Contagem\/MG/ });
    const belem = page.getByRole("button", { name: /Redespacho - Bel.m.*Bel.m\/PA/ });
    await expect(contagem).toBeVisible();
    await expect(belem).toBeVisible();

    // §43: o nível que respondeu fica dito, não só o nome. A busca é feita
    // dentro da tabela porque o mesmo nome também é uma opção do filtro de
    // liderança — encontrá-lo lá não provaria nada sobre a linha.
    const linhas = page.getByRole("table").first();
    await expect(linhas.getByText("Daniela Ferreira Lima")).toBeVisible();
    await expect(linhas.getByText("por cidade")).toBeVisible();
    await expect(linhas.getByText("por exceção do BR")).toBeVisible();

    // A posição sem liderança não vira um traço mudo.
    await expect(page.getByText("Sem liderança definida")).toBeVisible();

    expect(crashes, crashes.join("\n")).toEqual([]);
  });

  test("uma posição sem veículo aparece como tal, no grupo e na linha", async ({ page }) => {
    await page.goto("/dev/preview-fidelizacao");

    // No cabeçalho do local, em destaque.
    await expect(page.getByText("1 sem veículo")).toBeVisible();
    // E na própria linha, onde estaria a placa.
    await expect(page.getByRole("cell", { name: "Sem veículo" })).toBeVisible();
  });

  test("recolher um local esconde as suas posições sem apagá-lo", async ({ page }) => {
    await page.goto("/dev/preview-fidelizacao");

    const contagem = page.getByRole("button", { name: /Last Mille MG.*Contagem\/MG/ });
    await expect(page.getByText("BR0024706")).toBeVisible();

    await contagem.click();
    await expect(contagem).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByText("BR0024706")).toBeHidden();
    // O local continua lá, com a sua contagem.
    await expect(contagem).toBeVisible();

    await contagem.click();
    await expect(page.getByText("BR0024706")).toBeVisible();
  });

  test("o histórico de uma posição abre sob o código dela", async ({ page }) => {
    await page.goto("/dev/preview-fidelizacao");

    await page.getByRole("button", { name: "Histórico de veículos da BR0024706" }).click();
    await expect(page.getByRole("dialog")).toContainText("Histórico da BR0024706");
    // §24: o cabeçalho do painel diz onde a posição fica.
    await expect(page.getByRole("dialog")).toContainText("Contagem/MG");
  });

  test("a competência fica dita, não subentendida", async ({ page }) => {
    await page.goto("/dev/preview-fidelizacao");

    // §22: "veículo atual" num mês passado pareceria o veículo de hoje sem isto.
    await expect(page.getByText(/Recursos resolvidos em 21\/09\/2026/)).toBeVisible();
  });

  for (const size of WIDTHS) {
    test(`não há rolagem horizontal (${size.name})`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto("/dev/preview-fidelizacao");

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `sobra de ${overflow}px na largura`).toBeLessThanOrEqual(0);
    });
  }
});
