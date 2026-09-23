import { test, expect, type Page } from "@playwright/test";

/**
 * Central de Fidelização (Etapa 15): as quatro áreas que não são o Planner de
 * Frotas — histórico de movimentações, planner de motoristas, importação e os
 * indicadores novos do Dashboard de Estabilidade.
 *
 * Roda contra `/dev/preview-central-fidelizacao/areas`, que renderiza os
 * mesmos componentes da tela real com dados fixos de Setembro/2026. O que se
 * verifica é o contrato de cada área na tela: o tipo do evento dito por
 * extenso, a inversão ligada ao seu par, o filtro que vai para a URL, a BR sem
 * motorista dita como tal, o encerramento que exige motivo, os erros de cada
 * importação e os recortes novos da estabilidade.
 */
const URL = "/dev/preview-central-fidelizacao/areas";

const abrir = async (page: Page) => {
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));
  await page.goto(URL);
  return crashes;
};

test.describe("histórico de movimentações", () => {
  test("cada tipo aparece por extenso, com selo, e a inversão fica ligada ao seu par", async ({ page }) => {
    const crashes = await abrir(page);
    const historico = page.getByRole("region", { name: "Histórico de mobilizações" });
    const tabela = historico.getByRole("table", { name: "Movimentações" });
    await expect(tabela).toBeVisible();

    for (const tipo of [
      "Primeira alocação", "Alocação de veículo", "Substituição de veículo", "Inversão de placas",
      "Remoção de veículo", "Retorno de veículo", "Encerramento de vínculo", "Vinculação de motorista",
      "Substituição de motorista", "Encerramento do motorista", "Correção administrativa",
      "Cancelamento de planejamento",
    ]) {
      await expect(tabela.locator("[data-movement-type]").filter({ hasText: tipo }).first(), tipo).toBeVisible();
    }

    // As duas linhas da inversão: mesma chave, e a marca diz que são uma operação só.
    const inversao = tabela.getByRole("row").filter({ hasText: "Inversão de placas" });
    await expect(inversao).toHaveCount(2);
    for (const linha of [inversao.nth(0), inversao.nth(1)]) {
      await expect(linha).toHaveAttribute("data-correlation", "tx:81234");
      await expect(linha).toContainText("Mesma operação");
    }
    // Uma no BR0024901, a outra no BR0025110: placa que sai de uma entra na outra.
    await expect(inversao.filter({ hasText: "BR0024901" })).toContainText(/FR-0143.*FR-0201/);
    await expect(inversao.filter({ hasText: "BR0025110" })).toContainText(/FR-0201.*FR-0143/);

    // Liderança na data, origem com nome e responsável.
    const cancelamento = tabela.getByRole("row").filter({ hasText: "Cancelamento de planejamento" });
    await expect(cancelamento).toContainText("Marcos Vinícius Andrade");
    await expect(cancelamento).toContainText("Importação");
    await expect(cancelamento).toContainText("Ana Paula de Almeida Rodrigues");
    await expect(tabela.getByRole("row").filter({ hasText: "Encerramento do motorista" })).toContainText("Rotina");
    await expect(tabela.getByRole("row").filter({ hasText: "Alocação de veículo" })).toContainText("Replicação");

    // A correção administrativa traz as observações junto do motivo.
    await expect(tabela.getByRole("row").filter({ hasText: "Correção administrativa" })).toContainText(
      "Obs.: Corrigido após conferência com o CRLV.",
    );

    // Reconstruídos e inferidos têm selo e explicação.
    await expect(historico.getByText("4 eventos reconstruídos a partir dos vínculos")).toBeVisible();
    await expect(tabela.getByText("Reconstruído", { exact: true }).first()).toBeVisible();
    await expect(tabela.getByText("inferida", { exact: true }).first()).toBeVisible();
    await expect(historico.getByText(/“Inferida” marca uma troca de titular/)).toBeVisible();

    // Os filtros do topo da página estão ditos como já aplicados.
    await expect(historico.getByText(/Operação, estado e cidade seguem os filtros do topo/)).toBeVisible();
    expect(crashes, crashes.join("\n")).toEqual([]);
  });

  test("clicar num tipo filtra e leva o filtro para a URL", async ({ page }) => {
    await abrir(page);
    const historico = page.getByRole("region", { name: "Histórico de mobilizações" });
    const chips = historico.getByRole("group", { name: "Movimentações por tipo" });
    const inversao = chips.getByRole("button", { name: /Inversão de placas/ });
    await expect(inversao).toContainText("2");

    await inversao.click();
    await expect(page).toHaveURL(/mov_tipo=vehicle_inversion/);
    await expect(inversao).toHaveAttribute("aria-pressed", "true");
    await expect(historico.getByRole("table", { name: "Movimentações" }).locator("tbody tr")).toHaveCount(2);
    // O select de tipo acompanha a URL.
    await expect(historico.getByLabel("Tipo de movimentação")).toHaveValue("vehicle_inversion");

    await chips.getByRole("button", { name: /Todos os tipos/ }).click();
    await expect(page).not.toHaveURL(/mov_tipo=/);
    await expect(historico.getByRole("table", { name: "Movimentações" }).locator("tbody tr")).toHaveCount(16);
  });

  test("placa ou frota filtra ao pressionar Enter", async ({ page }) => {
    await abrir(page);
    const historico = page.getByRole("region", { name: "Histórico de mobilizações" });
    await historico.getByLabel("Placa ou frota").fill("RQK2F18");
    await historico.getByLabel("Placa ou frota").press("Enter");
    await expect(page).toHaveURL(/mov_veiculo=RQK2F18/);
    const linhas = historico.getByRole("table", { name: "Movimentações" }).locator("tbody tr");
    await expect(linhas).toHaveCount(3);

    await historico.getByRole("button", { name: "Limpar filtros" }).first().click();
    await expect(page).not.toHaveURL(/mov_veiculo=/);
    await expect(linhas).toHaveCount(16);
  });
});

test.describe("planner de motoristas", () => {
  test("agrupa por BR, diz qual BR está sem motorista e oferece as ações", async ({ page }) => {
    const crashes = await abrir(page);
    const planner = page.getByRole("region", { name: "Planner de motoristas" });

    const resumo = planner.getByRole("definition");
    await expect(resumo).toHaveText(["3", "1", "5"]);

    // A BR sem nenhum vínculo de motorista é dita, não é uma linha vazia.
    const vazia = planner.getByRole("listitem", { name: "BR BR0031009" });
    await expect(vazia).toContainText("Sem motorista");
    await expect(vazia).toContainText("VA131");
    await expect(vazia.getByRole("button", { name: "Motorista na BR0031009" })).toBeVisible();

    // Principal e secundário na mesma BR: turnos, não conflito.
    const turnos = planner.getByRole("listitem", { name: "BR BR0024706" });
    await expect(turnos).toContainText("2 ativos");
    await expect(turnos).toContainText("principal + secundário");
    // Os veículos do mês em ordem, com a troca do dia 11.
    await expect(turnos).toContainText(/FR-0142.*FR-0150/);

    const abrirBr = turnos.getByRole("button", { name: /^BR0024706/ });
    await expect(abrirBr).toHaveAttribute("aria-expanded", "false");
    await abrirBr.click();
    await expect(abrirBr).toHaveAttribute("aria-expanded", "true");

    const motoristas = turnos.getByRole("table", { name: "Motoristas da BR0024706" });
    await expect(motoristas.getByRole("row").filter({ hasText: "Leandro Carvalho Silva" })).toContainText("Secundário");
    const vigente = motoristas.getByRole("row").filter({ hasText: "Rafael Souza Campos" }).filter({ hasText: "Vigente" });
    await expect(vigente).toContainText("Principal");
    await expect(vigente).toContainText("11/09 – em aberto");
    await expect(vigente.getByRole("button", { name: /^Substituir/ })).toBeEnabled();
    await expect(vigente.getByRole("button", { name: /^Encerrar/ })).toBeEnabled();

    // O vínculo que já terminou não tem véspera para fechar: ações desabilitadas, não escondidas.
    const encerrado = motoristas.getByRole("row").filter({ hasText: "Encerrado" });
    await expect(encerrado.getByRole("button", { name: /^Substituir/ })).toBeDisabled();
    await expect(encerrado.getByRole("button", { name: /^Encerrar/ })).toBeDisabled();

    // Substituir abre o diálogo de substituição existente, com a linha certa.
    await vigente.getByRole("button", { name: /^Substituir/ }).click();
    const substituir = page.getByRole("dialog", { name: "Substituir motorista" });
    await expect(substituir).toContainText("Rafael Souza Campos");
    await substituir.getByRole("button", { name: "Cancelar" }).click();
    await expect(substituir).toBeHidden();

    // A legenda diz que vincular não mexe em conta nem perfil.
    await expect(planner.getByText(/não cria conta de acesso e não altera o Perfil de\s+Acesso/)).toBeVisible();
    expect(crashes, crashes.join("\n")).toEqual([]);
  });

  test("a busca encontra o motorista e abre a BR dele", async ({ page }) => {
    await abrir(page);
    const planner = page.getByRole("region", { name: "Planner de motoristas" });
    await planner.getByRole("searchbox", { name: "Buscar BR ou motorista" }).fill("thiago");
    await expect(planner.getByRole("listitem", { name: /^BR / })).toHaveCount(1);
    const br = planner.getByRole("listitem", { name: "BR BR0031002" });
    await expect(br.getByRole("button", { name: /^BR0031002/ })).toHaveAttribute("aria-expanded", "true");
    await expect(br.getByRole("table", { name: "Motoristas da BR0031002" })).toContainText("Thiago Henrique Moreira Castro");
  });

  test("encerrar o motorista exige o motivo", async ({ page }) => {
    await abrir(page);
    const planner = page.getByRole("region", { name: "Planner de motoristas" });
    const br = planner.getByRole("listitem", { name: "BR BR0024901" });
    await br.getByRole("button", { name: /^BR0024901/ }).click();
    const vigente = br.getByRole("table", { name: "Motoristas da BR0024901" }).getByRole("row").filter({ hasText: "Vigente" });
    await vigente.getByRole("button", { name: /^Encerrar/ }).click();

    const dialogo = page.getByRole("dialog", { name: "Encerrar motorista" });
    await expect(dialogo).toContainText("Flaviano Lucio Dos Santos");
    await expect(dialogo.getByLabel("Data de encerramento")).not.toHaveValue("");

    await dialogo.getByRole("button", { name: "Encerrar vínculo" }).click();
    await expect(dialogo.getByText("Informe o motivo do encerramento.")).toBeVisible();
    await expect(dialogo).toBeVisible();

    await dialogo.getByLabel("Motivo").fill("Remanejado para outra rota");
    await dialogo.getByRole("button", { name: "Encerrar vínculo" }).click();
    await expect(dialogo).toBeHidden();
    await expect(page.getByText("Vínculo do motorista encerrado.", { exact: true })).toBeVisible();
  });
});

test.describe("importação", () => {
  test("explica o fluxo controlado e o histórico abre os erros de cada arquivo", async ({ page }) => {
    const crashes = await abrir(page);
    const importacao = page.getByRole("region", { name: "Importação" });

    for (const passo of ["Envio do arquivo", "Mapeamento de colunas", "Prévia com erros por linha", "Gravação"]) {
      await expect(importacao.getByText(passo, { exact: true })).toBeVisible();
    }
    await expect(importacao.getByText(/BRs e placas desconhecidas não são criadas/)).toBeVisible();
    await expect(importacao.getByText(/Reimportar o mesmo arquivo é reconhecido/)).toBeVisible();
    await expect(importacao.getByRole("link", { name: "Cadastro de BRs no módulo BRs" })).toHaveAttribute(
      "href",
      "/governanca/brs",
    );

    const tabela = importacao.getByRole("table", { name: "Histórico de importações" });
    const alocacoes = tabela.getByRole("row").filter({ hasText: "alocacoes-setembro-2026.xlsx" });
    await expect(alocacoes).toContainText("Alocações");
    await expect(alocacoes).toContainText("Concluída");
    await expect(tabela.getByRole("row").filter({ hasText: "brs-redespacho-belem.csv" })).toContainText("Cadastro de BRs");
    await expect(tabela.getByRole("row").filter({ hasText: "planejamento-agosto.csv" })).toContainText("Falhou");

    const erro = tabela.getByText("BR não encontrada: BR0099999. A importação não cria BRs.", { exact: false });
    await expect(erro).toBeHidden();
    await tabela.getByText("3 erros por linha").click();
    await expect(erro).toBeVisible();
    await expect(tabela.getByText(/Veículo não encontrado: FROTA-999/)).toBeVisible();

    // A falha sem erro por linha mostra o motivo do lote.
    await tabela.getByText("Detalhe da falha").click();
    await expect(tabela.getByText("O arquivo não tem a coluna obrigatória “Código BR”.")).toBeVisible();

    // O botão abre a gaveta de importação existente.
    await importacao.getByRole("button", { name: "Importar alocações" }).click();
    await expect(page.getByRole("dialog", { name: "Importar fidelização" })).toBeVisible();
    expect(crashes, crashes.join("\n")).toEqual([]);
  });
});

test.describe("dashboard de estabilidade (Etapa 15)", () => {
  test("mostra veículos e motoristas fidelizados e os recortes por estado e tipo de equipamento", async ({ page }) => {
    await abrir(page);
    const painel = page.getByRole("region", { name: "Dashboard de estabilidade" });
    const cartao = (nome: string) =>
      painel.locator("section").filter({ has: page.getByRole("heading", { name: nome, exact: true }) });

    await expect(cartao("BRs cadastradas")).toContainText("91");
    await expect(cartao("BRs cadastradas")).toContainText("88 ativas");
    await expect(cartao("Veículos fidelizados")).toContainText("92");
    await expect(cartao("Motoristas fidelizados")).toContainText("64");
    await expect(cartao("BRs sem motorista")).toContainText("27");
    // Os cartões que já existiam continuam lá.
    await expect(cartao("Estabilidade da frota")).toContainText("95,3%");
    await expect(cartao("Trocas inferidas")).toContainText("Não somadas às mobilizações");

    await painel.getByRole("tab", { name: "Por estado" }).click();
    await expect(painel.getByRole("row").filter({ hasText: /^PA/ })).toContainText("100%");
    await painel.getByRole("tab", { name: "Por tipo de equipamento" }).click();
    await expect(painel.getByRole("cell", { name: "Caminhão 3/4" })).toBeVisible();
    await expect(painel.getByRole("row").filter({ hasText: /^Van/ })).toContainText("94,6%");

    await painel.getByText("Como os indicadores são calculados").click();
    await expect(painel.getByText(/veículos distintos com vínculo titular não\s+cancelado/)).toBeVisible();
  });
});

test.describe("celular", () => {
  test("390px: cartões no lugar das tabelas largas e nenhuma rolagem horizontal", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await abrir(page);

    const historico = page.getByRole("region", { name: "Histórico de mobilizações" });
    await expect(historico.getByRole("list", { name: "Movimentações" })).toBeVisible();
    await expect(historico.getByRole("table", { name: "Movimentações" })).toBeHidden();

    const planner = page.getByRole("region", { name: "Planner de motoristas" });
    await planner.getByRole("button", { name: /^BR0024706/ }).click();
    await expect(planner.getByRole("list", { name: "Motoristas da BR0024706" })).toBeVisible();

    const importacao = page.getByRole("region", { name: "Importação" });
    await expect(importacao.getByRole("list", { name: "Histórico de importações" })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `sobra de ${overflow}px na largura`).toBeLessThanOrEqual(0);
  });

  for (const size of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "tablet", width: 768, height: 1024 },
  ]) {
    test(`não há rolagem horizontal (${size.name})`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await abrir(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `sobra de ${overflow}px na largura`).toBeLessThanOrEqual(0);
    });
  }
});
