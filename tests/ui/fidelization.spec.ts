import { test, expect } from "@playwright/test";

/**
 * `/dev/preview-fidelizacao`: o Dashboard de Estabilidade e as gavetas de
 * importação e de vínculo da Central, com dados fixos. O Planner de Locais e
 * BRs saiu da Central — a posição é do módulo BRs (`brs.spec.ts`).
 */
const WIDTHS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "celular", width: 390, height: 844 },
];

test.describe("prévia da fidelização", () => {
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
 * Dashboard de Estabilidade (§39–§43).
 *
 * O que se verifica aqui é a distinção da §42 na tela: mobilizações são os
 * eventos explícitos (substituição e inversão), a troca inferida fica em número
 * separado, e as fórmulas estão escritas para quem quiser conferir a conta.
 */
test.describe("dashboard de estabilidade", () => {
  test("mostra a estabilidade da frota e as trocas inferidas à parte", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (error) => crashes.push(error.message));

    await page.goto("/dev/preview-fidelizacao");
    const painel = page.getByRole("region", { name: "Dashboard de estabilidade" });
    await expect(painel).toBeVisible();

    // Cada cartão é uma `section` com o rótulo em `h3`. Selecionar pelo título
    // exato evita que "Mobilizações" também case com "Não somadas às
    // mobilizações" no cartão vizinho.
    const cartao = (nome: string) =>
      painel.locator("section").filter({ has: page.getByRole("heading", { name: nome, exact: true }) });

    // 1 − 3/88 = 96,6%, em pt-BR e com uma casa.
    const frota = cartao("Estabilidade da frota");
    await expect(frota).toContainText("96,6%");
    await expect(frota).toContainText("3 de 88 BRs com troca de veículo");

    // Sem motorista planejado não há razão — o cartão diz "—", não "100%".
    await expect(cartao("Estabilidade de motoristas")).toContainText("—");

    // 2 substituições + 1 inversão (um par) = 3 mobilizações.
    const mobilizacoes = cartao("Mobilizações");
    await expect(mobilizacoes).toContainText("3");
    await expect(mobilizacoes).toContainText("2 substituições · 1 inversões");

    // §42: as 16 trocas inferidas aparecem, e aparecem fora da soma.
    const inferidas = cartao("Trocas inferidas");
    await expect(inferidas).toContainText("16");
    await expect(inferidas).toContainText("Não somadas às mobilizações");

    expect(crashes, crashes.join("\n")).toEqual([]);
  });

  test("substituições e inversões ficam junto das trocas do mês, sem a tabela de fórmulas", async ({ page }) => {
    await page.goto("/dev/preview-fidelizacao");
    const painel = page.getByRole("region", { name: "Dashboard de estabilidade" });
    const cartao = (nome: string) =>
      painel.locator("section").filter({ has: page.getByRole("heading", { name: nome, exact: true }) });

    // O cartão saiu do topo da Central e entrou na linha das trocas do mês.
    await expect(cartao("Substituições e inversões")).toContainText("3");
    await expect(cartao("Substituições e inversões")).toContainText("Setembro/2026");

    // A tabela "Como os indicadores são calculados" foi retirada; a explicação
    // das trocas inferidas, que fica ao lado dos cartões, continua.
    await expect(painel.getByText("Como os indicadores são calculados")).toHaveCount(0);
    await expect(painel.getByText(/Ficam fora da soma das mobilizações/)).toBeVisible();
  });

  test("os recortes por operação, local e liderança trazem as mesmas colunas", async ({ page }) => {
    await page.goto("/dev/preview-fidelizacao");
    const painel = page.getByRole("region", { name: "Dashboard de estabilidade" });

    const porOperacao = painel.getByRole("table").first();
    await expect(porOperacao.getByRole("row").filter({ hasText: "Last Mille MG" })).toContainText("95,2%");
    await expect(porOperacao.getByRole("row").filter({ hasText: "Redespacho - Belém" })).toContainText("100%");

    await painel.getByRole("tab", { name: "Por local" }).click();
    await expect(painel.getByRole("cell", { name: /Contagem\/MG/ })).toBeVisible();

    await painel.getByRole("tab", { name: "Por liderança" }).click();
    await expect(painel.getByRole("cell", { name: /Marcos Vinícius Andrade/ })).toBeVisible();
  });
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
