import { test, expect } from "@playwright/test";

/**
 * Gestão de Checklist → Aderência (Etapa 11).
 *
 * Roda contra `/dev/preview-aderencia`, que renderiza a mesma tela com dados
 * fixos — o exemplo da §68 (8 feitos em 9 obrigações devidas). O que se prova
 * aqui é a APRESENTAÇÃO da regra, porque a regra em si está no banco e é
 * coberta por `supabase/tests/remote/11_adherence.sql`:
 *
 *  - a fórmula aparece como 88,89% e nunca como média;
 *  - o dia vigente sem execução é "Não fez checklist" (provisório), não "Sem
 *    dados"; datas futuras são "Planejado";
 *  - o contexto (saída/retorno) vive na URL e governa a tela;
 *  - a matriz não espreme 31 colunas no celular: vira visão por veículo;
 *  - sem base de cálculo, a tela escreve "Sem base", nunca 0% ou 100%.
 */
const PREVIEW = "/dev/preview-aderencia";

test.describe("aderência", () => {
  test("visão consolidada apresenta a fórmula oficial e a meta", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (error) => crashes.push(error.message));

    await page.goto(PREVIEW);
    await expect(page.getByRole("heading", { name: "Aderência", level: 1 })).toBeVisible();

    // 8 / 9 = 88,89% — soma sobre soma, escrito, com o par numerador/denominador ao lado.
    await expect(page.getByText("88,89%").first()).toBeVisible();
    await expect(page.getByText("8 / 9").first()).toBeVisible();
    // A meta é parâmetro: aparece com a diferença assinada.
    await expect(page.getByText("90,00%").first()).toBeVisible();
    await expect(page.getByText("-1,11%").first()).toBeVisible();
    // A quebra por operação usa a mesma regra.
    await expect(page.getByRole("cell", { name: "Last Mille MG" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "83,33%" }).first()).toBeVisible();

    expect(crashes).toEqual([]);
  });

  test("o contexto saída/retorno vive na URL e governa a tela", async ({ page }) => {
    await page.goto(PREVIEW);
    const retorno = page.getByRole("button", { name: "Retorno de rota" });
    await expect(retorno).toHaveAttribute("aria-pressed", "false");
    await retorno.click();
    await expect(page).toHaveURL(/contexto=retorno/);
    await expect(page.getByRole("button", { name: "Retorno de rota" })).toHaveAttribute("aria-pressed", "true");
    // O painel diz qual contexto está sendo mostrado.
    await expect(page.getByText(/Retorno de rota · Setembro\/2026/).first()).toBeVisible();
  });

  test("matriz: hoje sem execução é NÃO FEZ provisório; amanhã é Planejado; sem obrigação é Sem dados", async ({ page }) => {
    await page.goto(`${PREVIEW}?aba=matriz`);

    // A primeira coluna é fixa: o veículo continua visível ao rolar até o dia 30.
    const label = page.locator("div.sticky.left-0").filter({ hasText: "VA116" }).first();
    await expect(label).toBeVisible();

    // Dia vigente (22) sem execução: "Não fez checklist", marcado como provisório — jamais "Sem dados".
    const hoje = page.getByRole("button", { name: /2026-09-22: Não fez checklist · dia vigente/ }).first();
    await expect(hoje).toBeVisible();
    await expect(hoje).toHaveText("NF");

    // Data futura: Planejado, não descumprimento.
    const amanha = page.getByRole("button", { name: /2026-09-23: Planejado/ }).first();
    await expect(amanha).toHaveText("PL");

    // Veículo que só entrou na fidelização no dia 15: antes disso, sem dados (traço, não NF).
    const semDados = page.locator('[title="2026-09-03: sem dados (nenhuma obrigação conhecida)"]').first();
    await expect(semDados).toBeVisible();
    await expect(semDados).toHaveText(/—/);
    await expect(semDados).toContainText("Sem dados"); // texto para leitores de tela

    // Expurgo aprovado aparece com o status do motivo, não como feito nem como não fez.
    await expect(page.getByRole("button", { name: /2026-09-20: Sem rota/ }).first()).toHaveText("SR");
  });

  test("heatmap: dia futuro não é descumprimento e o dia vigente está destacado", async ({ page }) => {
    await page.goto(`${PREVIEW}?aba=heatmap`);
    // Três meses lado a lado: o dia 25 existe em todos, então o teste olha o mês corrente.
    const setembro = page.getByRole("grid", { name: "Dias de Setembro/2026" });
    const dia25 = setembro.getByRole("gridcell").filter({ hasText: /^25/ }).first();
    await expect(dia25).toContainText("Futuro");
    await expect(dia25).toHaveAttribute("title", /planejado/);
    const dia22 = setembro.getByRole("gridcell").filter({ hasText: /^22/ }).first();
    await expect(dia22).toContainText("66,7%");
    await expect(dia22).toHaveAttribute("title", /66,67%/);
    // Selecionar o dia abre o detalhe; dali, "Ver jornada do dia" leva à jornada daquele dia.
    await dia22.click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await drawer.getByRole("link", { name: "Ver jornada do dia" }).click();
    await expect(page).toHaveURL(/aba=jornada/);
    await expect(page).toHaveURL(/dia=2026-09-22/);
  });

  test("heatmap: três meses, e o dia abre o detalhe com o contexto preservado", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (error) => crashes.push(error.message));

    await page.goto(`${PREVIEW}?aba=heatmap&contexto=retorno`);
    await expect(page.getByRole("heading", { name: "Agosto/2026", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Setembro/2026", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Outubro/2026", exact: true })).toBeVisible();
    // A legenda é escrita, nunca só cor.
    await expect(page.getByText("Até 10 pontos abaixo")).toBeVisible();
    await expect(page.getByText("Futuro (planejado)")).toBeVisible();
    // O mês seguinte é todo futuro: planejamento, não descumprimento.
    const outubro = page.getByRole("grid", { name: "Dias de Outubro/2026" });
    // Mês vizinho: a célula é estreita, o futuro fica na borda tracejada e é dito ao leitor de tela.
    await expect(outubro.getByTitle(/^2026-10-01: planejado/)).toContainText("Futuro");

    // Clicar no dia abre o detalhe com a data no título; sem sessão a carga
    // pode falhar (alerta), mas o cabeçalho e os links do rodapé não dependem dela.
    await page.getByRole("grid", { name: "Dias de Setembro/2026" }).getByRole("gridcell").filter({ hasText: /^20/ }).first().click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("Dia 20/09/2026 · Retorno de rota")).toBeVisible();
    const link = drawer.getByRole("link", { name: "Abrir Mês/Dia neste dia" });
    await expect(link).toHaveAttribute("href", /aba=matriz/);
    await expect(link).toHaveAttribute("href", /dia=2026-09-20/);
    await expect(link).toHaveAttribute("href", /contexto=retorno/);

    expect(crashes).toEqual([]);
  });

  test("dashboard mensal: doze meses, o corrente com 88,89% e os futuros sem resultado", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (error) => crashes.push(error.message));

    await page.goto(PREVIEW);
    await expect(page.getByRole("heading", { name: /Dashboard mensal · 2026/ })).toBeVisible();
    await expect(page.getByRole("img", { name: /Aderência mensal de 2026/ })).toBeVisible();
    for (const mes of ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]) {
      await expect(page.getByRole("cell", { name: new RegExp(`^${mes}`) })).toBeVisible();
    }
    const corrente = page.locator('tr[data-current="true"]');
    await expect(corrente).toContainText("Setembro");
    await expect(corrente).toContainText("88,89%");
    await expect(corrente).toContainText("-1,11 pts");
    // Fevereiro sem base: escrito, nunca 0% ou 100%.
    await expect(page.getByRole("row", { name: /^Fevereiro/ })).toContainText("Sem base");
    // Meses futuros nunca mostram resultado: a coluna Aderência diz "Futuro", sem percentual
    // (a meta continua visível porque é parâmetro, não resultado).
    for (const mes of ["Outubro", "Novembro", "Dezembro"]) {
      const aderencia = page.getByRole("row", { name: new RegExp(`^${mes}`) }).getByRole("cell").nth(4);
      await expect(aderencia).toHaveText("Futuro");
    }
    await expect(page.getByRole("row", { name: /^Total do ano/ })).toContainText("90,70%");
    // O ano do dashboard é independente da competência.
    await page.getByRole("combobox", { name: "Ano do dashboard" }).selectOption("2025");
    await expect(page).toHaveURL(/ano_dash=2025/);

    expect(crashes).toEqual([]);
  });

  test("insights: variação sobre o mês anterior e operações abaixo da meta, com os números", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (error) => crashes.push(error.message));

    await page.goto(PREVIEW);
    const card = page.getByRole("list", { name: "Insights da competência" });
    await expect(card.getByText(/Aderência de 88,89% \(8 de 9\), \+2,30 pontos em relação a Agosto\/2026 \(86,59%\)/)).toBeVisible();
    await expect(card.getByText(/Desvio de -1,11 pontos em relação à meta de 90,00%/)).toBeVisible();
    await expect(card.getByText(/9 de 22 dias com base ficaram abaixo dela/)).toBeVisible();
    await expect(card.getByText(/Hoje: 3 de 6 obrigações realizadas; 3 não realizada\(s\) provisória\(s\)/)).toBeVisible();
    await expect(card.getByText(/2 operação\(ões\) abaixo da meta: Last Mille MG \(83,33%\), Merchandising \(85,71%\)/)).toBeVisible();
    await expect(card.getByText(/Localidade\(s\) abaixo da meta: Divinópolis \(80,00%\)/)).toBeVisible();

    expect(crashes).toEqual([]);
  });

  test("jornada: saída feita não é jornada completa", async ({ page }) => {
    await page.goto(`${PREVIEW}?aba=jornada&dia=2026-09-22`);
    await expect(page.getByText("Jornada completa: 1")).toBeVisible();
    await expect(page.getByText("Em rota: 3")).toBeVisible();
    await expect(page.getByText("Não realizada: 2")).toBeVisible();
  });

  test("expurgos: pendente, aprovada e rejeitada são estados distintos", async ({ page }) => {
    await page.goto(`${PREVIEW}?aba=expurgos`);
    const table = page.getByRole("table").first();
    await expect(table.getByText("Pendente", { exact: true }).first()).toBeVisible();
    await expect(table.getByText("Aprovada", { exact: true })).toBeVisible();
    await expect(table.getByText("Rejeitada", { exact: true })).toBeVisible();
    // As duas pendentes têm a ação de decidir; as decididas não.
    await expect(page.getByRole("button", { name: "Decidir" })).toHaveCount(2);
  });

  test("expurgos em lote: só pendentes são selecionáveis e os botões de lote ligam com a seleção", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (error) => crashes.push(error.message));
    await page.goto(`${PREVIEW}?aba=expurgos`);

    // §57: uma caixa por linha pendente (2 no fixture); aprovada/rejeitada não têm caixa.
    const boxes = page.getByRole("checkbox", { name: /^Selecionar solicitação/ });
    await expect(boxes).toHaveCount(2);
    const aprovar = page.getByRole("button", { name: "Aprovar em lote" });
    const rejeitar = page.getByRole("button", { name: "Rejeitar em lote" });
    const reclassificar = page.getByRole("button", { name: "Reclassificar em lote" });
    await expect(page.getByText("0 selecionadas")).toBeVisible();
    await expect(aprovar).toBeDisabled();
    await expect(rejeitar).toBeDisabled();
    await expect(reclassificar).toBeDisabled();

    await boxes.nth(0).click();
    await expect(page.getByText("1 selecionada", { exact: true })).toBeVisible();
    await boxes.nth(1).click();
    await expect(page.getByText("2 selecionadas")).toBeVisible();
    await expect(aprovar).toBeEnabled();
    await expect(rejeitar).toBeEnabled();
    await expect(reclassificar).toBeEnabled();

    // O cabeçalho seleciona/desmarca todas as pendentes da página.
    const all = page.getByRole("checkbox", { name: "Selecionar todas as pendentes da página" });
    await expect(all).toHaveAttribute("aria-checked", "true");
    await all.click();
    await expect(page.getByText("0 selecionadas")).toBeVisible();
    await expect(aprovar).toBeDisabled();
    await all.click();
    await expect(page.getByText("2 selecionadas")).toBeVisible();
    await page.getByRole("button", { name: "Limpar" }).click();
    await expect(page.getByText("0 selecionadas")).toBeVisible();

    expect(crashes).toEqual([]);
  });

  test("expurgos em lote: rejeitar exige motivo e prévia antes de aplicar", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (error) => crashes.push(error.message));
    await page.goto(`${PREVIEW}?aba=expurgos`);

    await page.getByRole("checkbox", { name: "Selecionar todas as pendentes da página" }).click();
    await page.getByRole("button", { name: "Rejeitar em lote" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Rejeitar em lote" })).toBeVisible();
    // O motivo é obrigatório na rejeição (§31): sem ele nem a prévia é calculada.
    const motivo = dialog.getByLabel(/Motivo da rejeição/);
    await expect(motivo).toBeVisible();
    const previa = dialog.getByRole("button", { name: "Calcular prévia" });
    await expect(previa).toBeDisabled();
    // Aplicar nunca fica disponível sem prévia calculada (§57).
    await expect(dialog.getByRole("button", { name: "Aplicar" })).toBeDisabled();
    await motivo.fill("Havia rota programada nas duas datas.");
    await expect(previa).toBeEnabled();
    await expect(dialog.getByRole("button", { name: "Aplicar" })).toBeDisabled();
    // (A prévia em si chama o servidor e não roda sem sessão: o que se prova aqui é o portão.)

    expect(crashes).toEqual([]);
  });

  test("celular: a matriz vira visão por veículo, sem rolagem horizontal da página", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${PREVIEW}?aba=matriz`);
    await expect(page.getByRole("combobox", { name: "Veículo" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "a página não pode rolar horizontalmente no celular").toBeLessThanOrEqual(0);
  });

  test("governança: reconciliação exige prévia e motivo; regras e motivos são parâmetros visíveis", async ({ page }) => {
    await page.goto(`${PREVIEW}?aba=governanca`);
    await expect(page.getByRole("button", { name: "Aplicar reconciliação" })).toBeDisabled();
    await expect(page.getByText("Frota prevista: saída e retorno diários")).toBeVisible();
    await expect(page.getByText("Execução comprovada por outra fonte")).toBeVisible();
    await expect(page.getByRole("cell", { name: "Execução sem obrigação" })).toBeVisible();
  });

  test("matriz: seleção de dias explícita habilita a alteração em massa, que abre com motivo e justificativa", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (error) => crashes.push(error.message));
    await page.goto(`${PREVIEW}?aba=matriz`);

    // §37: navegação de mês ao lado da matriz.
    await expect(page.getByRole("button", { name: "Mês anterior" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Próximo mês" })).toBeVisible();

    // §40: sem seleção de dias não há alteração em massa; nada é "todos os dias" por omissão.
    const selecionar = page.getByRole("button", { name: "Selecionar dias" });
    await expect(selecionar).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("checkbox", { name: /^Selecionar dia/ })).toHaveCount(0);
    await selecionar.click();
    await expect(selecionar).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("checkbox", { name: /^Selecionar dia/ })).toHaveCount(30);
    const alterar = page.getByRole("button", { name: "Alterar em massa…" });
    await expect(alterar).toBeDisabled();
    await expect(page.getByText("0 dias selecionados")).toBeVisible();

    await page.getByRole("checkbox", { name: "Selecionar dia 19" }).click();
    await page.getByRole("checkbox", { name: "Selecionar dia 21" }).click();
    await expect(page.getByText("2 dias selecionados")).toBeVisible();
    await expect(alterar).toBeEnabled();

    await alterar.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Alterar em massa" })).toBeVisible();
    await expect(dialog.getByLabel(/^Motivo/)).toBeVisible();
    await expect(dialog.getByLabel(/^Justificativa/)).toBeVisible();
    // Aplicar nunca fica disponível sem prévia (§40).
    await expect(dialog.getByRole("button", { name: "Aplicar" })).toBeDisabled();
    // (A seleção das obrigações chama o servidor e não roda sem sessão: o que se prova aqui é o portão.)
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // Limpar zera a seleção e desliga a ação em massa.
    await page.getByRole("button", { name: "Limpar", exact: true }).click();
    await expect(page.getByText("0 dias selecionados")).toBeVisible();
    await expect(alterar).toBeDisabled();

    expect(crashes).toEqual([]);
  });

  test("jornada: o acompanhamento do retorno distingue aguardando, sem saída e vencido", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (error) => crashes.push(error.message));
    await page.goto(`${PREVIEW}?aba=jornada&dia=2026-09-22`);

    await expect(page.getByRole("heading", { name: "Acompanhamento do retorno" })).toBeVisible();
    // §50: aguardando retorno (saída feita, dentro do prazo) nunca é falta — e é contado à parte dos vencidos.
    const kpis = page.getByLabel("Indicadores do retorno");
    await expect(kpis.getByText("Aguardando retorno", { exact: true })).toBeVisible();
    await expect(kpis.locator("section").filter({ hasText: /Aguardando retorno\s*2\s*saída feita, dentro do prazo/ })).toBeVisible();
    await expect(kpis.locator("section").filter({ hasText: /Vencidos\s*2\s*3 com saída feita/ })).toBeVisible();
    // A fila mostra as quatro situações.
    await expect(page.getByText("Retorno vencido", { exact: true })).toBeVisible();
    await expect(page.getByText("Retorno vencido (saiu)", { exact: true })).toBeVisible();
    await expect(page.getByText(/^Sem saída registrada/)).toBeVisible();
    await expect(page.getByRole("cell", { name: "Walace Rocha De Souza" }).first()).toBeVisible();
    // Aderência do retorno com denominador próprio (§46).
    await expect(page.getByText("75,00%").first()).toBeVisible();

    expect(crashes).toEqual([]);
  });

  test("governança: o histórico de importações lista os lotes e abre os erros por linha", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (error) => crashes.push(error.message));
    await page.goto(`${PREVIEW}?aba=governanca`);

    await expect(page.getByRole("heading", { name: "Histórico de importações" })).toBeVisible();
    await expect(page.getByText("aderencia_setembro_v2.xlsx")).toBeVisible();
    await expect(page.getByText("aderencia_setembro_v1.xlsx")).toBeVisible();
    // §67: os erros ficam disponíveis linha a linha, recolhidos por padrão.
    const erros = page.getByText("2 erros por linha");
    await expect(erros).toBeVisible();
    await expect(page.getByText("Veículo VA999 não encontrado na frota.")).toBeHidden();
    await erros.click();
    await expect(page.getByText("Veículo VA999 não encontrado na frota.")).toBeVisible();
    await expect(page.getByText(/Linha 88/)).toBeVisible();

    expect(crashes).toEqual([]);
  });
});
