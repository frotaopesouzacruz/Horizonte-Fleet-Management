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

/**
 * Importação e situação do vínculo (Etapa 13, continuação).
 *
 * A gaveta de importação recebe uma prévia fixa no formato exato que o banco
 * devolve, então o que se verifica aqui é o contrato da §58 na tela: as sete
 * contagens nomeadas, a ação por linha, os achados, e a confirmação que só
 * conta o que será gravado. A gaveta de planejamento verifica quais ações de
 * situação a tela oferece e o que exige antes de chamar o servidor.
 */
test.describe("importação da fidelização", () => {
  const abrir = async (page: import("@playwright/test").Page) => {
    await page.goto("/dev/preview-fidelizacao");
    await page.getByRole("button", { name: "Importar (prévia)" }).click();
    return page.getByRole("dialog", { name: "Importar fidelização" });
  };

  const validar = async (drawer: import("@playwright/test").Locator, name: string) => {
    await drawer.getByLabel(name).setInputFiles({
      name: "arquivo.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("BR;Frota;Início;Fim\nBR0024054;VA125;01/10/2026;31/10/2026\n"),
    });
    await drawer.getByRole("button", { name: "Validar arquivo" }).click();
  };

  test("a prévia de alocações mostra as sete contagens da §58 e a ação de cada linha", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (error) => crashes.push(error.message));

    const drawer = await abrir(page);
    await expect(drawer.getByRole("tab", { name: "Alocações de veículos" })).toHaveAttribute("aria-selected", "true");
    // Antes de validar, nada a gravar.
    await expect(drawer.getByRole("button", { name: "Importar", exact: true })).toBeDisabled();

    await validar(drawer, "Arquivo de alocações");
    const resumo = drawer.getByRole("list", { name: "Resumo da prévia" }).or(drawer.locator("dl[aria-label='Resumo da prévia']"));
    await expect(resumo).toBeVisible();
    for (const [label, value] of [
      ["Registros existentes", "1"], ["Novos vínculos", "2"], ["Substituições", "1"], ["Sobreposições", "1"],
      ["BRs desconhecidas", "1"], ["Veículos não encontrados", "1"], ["Erros de competência", "1"],
    ] as const) {
      const tile = resumo.locator("div").filter({ hasText: label }).first();
      await expect(tile, label).toContainText(value);
    }
    // O que fica de fora fica dito, não só contado.
    await expect(resumo.getByText("fica de fora")).toHaveCount(4);
    await expect(resumo.getByText("será gravado")).toHaveCount(2);

    // A substituição diz quem sai; a linha existente é ignorada; o erro é erro.
    const linhas = drawer.getByRole("table").first();
    await expect(linhas.getByRole("row").filter({ hasText: "VA155" }).filter({ hasText: "Substituir" })).toContainText("sai VA125");
    await expect(linhas.getByRole("row").filter({ hasText: "BRNAOEXISTE" })).toContainText("Erro");
    await expect(drawer.getByText("Veículo não encontrado: FROTA-999. A importação não cria veículos.")).toBeVisible();
    await expect(drawer.getByText("A data final (05/11/2026) é anterior à inicial (10/11/2026).")).toBeVisible();

    // Só o que será gravado entra na conta: 2 novos + 1 substituição.
    await drawer.getByRole("button", { name: "Importar 3 linha(s)" }).click();
    const confirmar = page.getByRole("alertdialog");
    await expect(confirmar).toContainText("2 vínculo(s) novo(s) e 1 substituição(ões)");
    await expect(confirmar).toContainText("nenhum veículo é criado");
    await confirmar.getByRole("button", { name: "Importar" }).click();
    await expect(
      page.getByText("Importação concluída: 2 vínculo(s) novo(s), 1 substituição(ões), 5 ignorada(s).", { exact: true }),
    ).toBeVisible();
    await expect(drawer).toBeHidden();
    expect(crashes).toEqual([]);
  });

  test("a prévia de BRs separa criar, atualizar e já cadastrada, e avisa arquivo repetido", async ({ page }) => {
    const drawer = await abrir(page);
    await drawer.getByRole("tab", { name: "Cadastro de BRs" }).click();
    await expect(drawer.getByText("Baixar modelo de BRs")).toBeVisible();

    await validar(drawer, "Arquivo de BRs");
    await expect(drawer.getByText("Este mesmo arquivo já foi importado antes.")).toBeVisible();
    await expect(drawer.getByText("1 a criar")).toBeVisible();
    await expect(drawer.getByText("1 a atualizar")).toBeVisible();
    await expect(drawer.getByText("1 já cadastradas sem alteração")).toBeVisible();
    const linhas = drawer.getByRole("table").first();
    await expect(linhas.getByRole("row").filter({ hasText: "BR0031009" })).toContainText("Criar");
    await expect(linhas.getByRole("row").filter({ hasText: "BR0031002" })).toContainText("Atualizar");
    await expect(linhas.getByRole("row").filter({ hasText: "BR0031001" })).toContainText("Ignorar");
    await expect(drawer.getByText(/A cidade Ananindeua não faz parte da cobertura/)).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Importar 2 linha(s)" })).toBeEnabled();
  });

  test("a situação do vínculo oferece confirmar, executar e cancelar, e cancelar exige motivo", async ({ page }) => {
    await page.goto("/dev/preview-fidelizacao");
    await page.getByRole("button", { name: "Planejamento (prévia)" }).click();
    const drawer = page.getByRole("dialog", { name: "BR BR0024706" });
    await expect(drawer.getByText("Planejado", { exact: true })).toBeVisible();

    const acoes = drawer.locator("[aria-label='Situação do planejamento']");
    await expect(acoes.getByRole("button", { name: "Confirmar planejamento" })).toBeVisible();
    // O período já começou (01/09/2026): registrar a execução é oferecido.
    await expect(acoes.getByRole("button", { name: "Registrar execução" })).toBeVisible();
    await acoes.getByRole("button", { name: "Cancelar planejamento" }).click();

    await expect(drawer.getByLabel("Motivo do cancelamento")).toBeVisible();
    await drawer.getByRole("button", { name: "Cancelar planejamento" }).click();
    await expect(drawer.getByText("Informe o motivo do cancelamento.")).toBeVisible();
    await drawer.getByRole("button", { name: "Voltar" }).click();
    await expect(acoes.getByRole("button", { name: "Confirmar planejamento" })).toBeVisible();
  });

  test("celular: a gaveta de importação não rola horizontalmente", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const drawer = await abrir(page);
    await validar(drawer, "Arquivo de alocações");
    await expect(drawer.getByText("Registros existentes")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `sobra de ${overflow}px na largura`).toBeLessThanOrEqual(0);
  });
});
