import { test, expect, type Page } from "@playwright/test";

/**
 * Check List de Frota — histórico do escopo e detalhe da execução (Etapa 12,
 * §59, §60, §64).
 *
 * Roda contra `/dev/preview-historico`, que renderiza os mesmos componentes
 * com dados fixos. O que se prova aqui é a APRESENTAÇÃO, porque a regra mora
 * no banco (RLS, selagem do enviado, conformidade por pergunta):
 *
 *  · a lista distingue saída de retorno, OK de "Com inconformidade";
 *  · "Ver" abre o detalhe com quem fez, os quatro números e o resumo por cluster;
 *  · a aba de inconformidades mostra SÓ o que foi inconforme — inclusive a
 *    pergunta invertida respondida SIM;
 *  · o campo condicional e a observação aparecem como foram gravados;
 *  · não existe editar, salvar, anexar ou campo de entrada no detalhe (§53).
 */
const PREVIEW = "/dev/preview-historico";

const table = (page: Page) => page.getByRole("table").first();
const dialog = (page: Page) => page.getByRole("dialog");

async function abrirCritica(page: Page) {
  await page.goto(PREVIEW);
  await page.getByRole("button", { name: /^Ver checklist de SNT8E16/ }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByText("Check List finalizado")).toBeVisible();
}

test.describe("histórico do Check List de Frota", () => {
  test("a lista traz as execuções do escopo com tipo e situação", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (error) => crashes.push(error.message));

    await page.goto(PREVIEW);
    await expect(page.getByRole("heading", { name: "Histórico do Check List", level: 1 })).toBeVisible();

    const lista = table(page);
    await expect(lista.getByRole("cell", { name: /^SNT8E16/ })).toBeVisible();
    await expect(lista.getByRole("cell", { name: /^SNT8G21/ })).toBeVisible();
    await expect(lista.getByRole("cell", { name: /^SNT1A73/ })).toBeVisible();
    await expect(page.getByText("3 checklists no período.")).toBeVisible();

    // Tipo e situação são etiquetas, não cor: uma de cada caso.
    await expect(lista.getByText("Saída", { exact: true })).toHaveCount(2);
    await expect(lista.getByText("Retorno", { exact: true })).toHaveCount(1);
    await expect(lista.getByText("Com inconformidade", { exact: true })).toHaveCount(2);
    await expect(lista.getByText("OK", { exact: true })).toHaveCount(1);

    // Colaborador com matrícula e duração no formato do executor.
    await expect(lista.getByRole("cell", { name: /Walace Rocha De Souza/ })).toContainText("Matrícula 10234");
    await expect(lista.getByRole("cell", { name: "4 min 32 s" })).toBeVisible();

    expect(crashes).toEqual([]);
  });

  test("os filtros reduzem a lista e o vazio é dito com todas as letras", async ({ page }) => {
    await page.goto(PREVIEW);
    await expect(table(page).getByRole("cell", { name: /^SNT8E16/ })).toBeVisible();

    await page.getByLabel("Tipo").selectOption("retorno");
    await page.getByRole("button", { name: "Aplicar" }).click();
    await expect(table(page).getByRole("cell", { name: /^SNT1A73/ })).toBeVisible();
    await expect(table(page).getByRole("cell", { name: /^SNT8E16/ })).toHaveCount(0);

    // Enter na busca aplica sem precisar do botão.
    await page.getByLabel("Busca").fill("nenhuma-placa");
    await page.getByLabel("Busca").press("Enter");
    await expect(table(page).getByText("Nenhum checklist no período")).toBeVisible();
  });

  test("Ver abre o detalhe com cabeçalho, indicadores e resumo por cluster", async ({ page }) => {
    await abrirCritica(page);
    const drawer = dialog(page);

    await expect(drawer.getByRole("heading", { name: "SNT8E16 · VA116" })).toBeVisible();
    await expect(drawer.getByText("Walace Rocha De Souza")).toBeVisible();
    await expect(drawer.getByText("Matrícula 10234 · Saída para rota · versão 1.0")).toBeVisible();
    await expect(drawer.getByText("4 min 32 s")).toBeVisible();

    // Os quatro números da execução.
    for (const rotulo of ["Perguntas aplicáveis", "Conformes", "Inconformes", "Críticas"]) {
      await expect(drawer.getByRole("heading", { name: rotulo, exact: true })).toBeVisible();
    }

    // Resumo por cluster: nome · aplicáveis · conformes · inconformes.
    const resumo = drawer.locator("section", { hasText: "Resumo por cluster" }).first();
    await expect(resumo.getByRole("listitem").filter({ hasText: "Luzes e Sinalização" })).toContainText("2 aplicáveis");
    await expect(resumo.getByRole("listitem").filter({ hasText: "Luzes e Sinalização" })).toContainText("0 conformes");
    await expect(resumo.getByRole("listitem").filter({ hasText: "Luzes e Sinalização" })).toContainText("2 inconformes");
    await expect(resumo.getByRole("listitem").filter({ hasText: "5S" })).toContainText("0 inconformes");

    await expect(drawer.getByText(/Um checklist enviado não pode ser editado/)).toBeVisible();
  });

  test("a aba de inconformidades mostra só o que foi inconforme — inclusive a invertida respondida SIM", async ({ page }) => {
    await abrirCritica(page);
    const drawer = dialog(page);

    await drawer.getByRole("tab", { name: "Inconformidades (3)" }).click();
    const painel = drawer.getByRole("tabpanel");

    await expect(painel.getByText(/Possui alguma avaria/)).toBeVisible();
    await expect(painel.getByText("As luzes de freio funcionam?")).toBeVisible();
    await expect(painel.getByText("Os faróis funcionam?")).toBeVisible();
    // O que foi conforme não entra.
    await expect(painel.getByText(/limpa externamente/)).toHaveCount(0);
    await expect(painel.getByText(/para-choques/)).toHaveCount(0);

    // A invertida foi respondida SIM e ainda assim é inconformidade.
    const avaria = painel.getByRole("listitem").filter({ hasText: /Possui alguma avaria/ });
    await expect(avaria).toContainText("Resposta: SIM");
    // A crítica é marcada como tal.
    await expect(painel.getByRole("listitem").filter({ hasText: "luzes de freio" })).toContainText("Crítica");
  });

  test("o campo condicional e a observação aparecem como foram gravados", async ({ page }) => {
    await abrirCritica(page);
    const drawer = dialog(page);
    const completo = drawer.getByRole("tabpanel");

    // Escolha única: chave e valor humanizados.
    await expect(completo.getByText("Lado freio: Esquerdo")).toBeVisible();
    // Múltipla escolha: os valores separados por vírgula.
    await expect(completo.getByText("Farois: Farol esquerdo, Milha direito")).toBeVisible();
    // Texto livre.
    await expect(completo.getByText("Descricao avaria: Amassado na porta lateral direita")).toBeVisible();
    // Observação gravada e ausência de observação, ambas ditas.
    await expect(completo.getByText("Lâmpada queimada, trocada no pátio.")).toBeVisible();
    await expect(completo.getByText("sem observação").first()).toBeVisible();

    // A situação é por pergunta: a invertida respondida SIM é "Inconforme".
    const linha = completo.getByRole("row").filter({ hasText: /Possui alguma avaria/ });
    await expect(linha).toContainText("SIM");
    await expect(linha).toContainText("Inconforme");
    await expect(completo.getByRole("row").filter({ hasText: "luzes de freio" })).toContainText("Inconforme · crítica");
  });

  test("o detalhe é só leitura: sem editar, salvar, anexar ou campo de entrada", async ({ page }) => {
    await abrirCritica(page);
    const drawer = dialog(page);

    // Percorre as duas abas para que tudo tenha sido renderizado.
    await drawer.getByRole("tab", { name: /Inconformidades/ }).click();
    await drawer.getByRole("tab", { name: "Checklist completo" }).click();

    await expect(drawer.getByRole("button", { name: /editar|salvar|excluir|corrigir|alterar|reenviar|anexar/i })).toHaveCount(0);
    await expect(drawer.locator("input, textarea, select, [contenteditable='true']")).toHaveCount(0);

    const proibidos = await drawer.evaluate((root) => ({
      fileInputs: root.querySelectorAll('input[type="file"]').length,
      capture: root.querySelectorAll("[capture]").length,
      textoDeAnexo: /anexar|anexo|fotografia|tirar foto|c[âa]mera|galeria|upload/i.test(
        (root as HTMLElement).innerText,
      ),
    }));
    expect(proibidos.fileInputs, "campo de arquivo encontrado").toBe(0);
    expect(proibidos.capture, "atributo capture encontrado").toBe(0);
    expect(proibidos.textoDeAnexo, "texto pedindo foto/anexo encontrado").toBe(false);

    // Fechar é a única ação — e devolve à lista.
    await drawer.getByRole("button", { name: "Fechar", exact: true }).last().click();
    await expect(drawer).toBeHidden();
    await expect(table(page).getByRole("cell", { name: /^SNT8E16/ })).toBeVisible();
  });
});
