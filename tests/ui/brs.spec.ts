import { test, expect } from "@playwright/test";

/**
 * Módulo BRs (Etapa 13.1).
 *
 * A BR é a posição operacional permanente e este módulo é a sua única casa
 * administrativa. A tela precisa dizer, para cada posição, o que a ocupa na
 * data-âncora da competência — e dizer por extenso quando nada a ocupa —,
 * agrupar como a Hierarquia Operacional (operação → estado → cidade → BR),
 * ordenar no servidor pela URL, e virar cartões no celular em vez de espremer
 * dez colunas.
 *
 * Roda contra `/dev/preview-brs`, que renderiza o mesmo componente com dados
 * fixos — o mesmo portão do design system. Sem isso, nenhum destes
 * comportamentos seria verificável num ambiente que não alcança o Supabase.
 */
test.describe("módulo BRs", () => {
  test("lista as posições na hierarquia Operação → Estado → Cidade → BR, com o que as ocupa", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (error) => crashes.push(error.message));

    await page.goto("/dev/preview-brs");

    await expect(page.getByRole("heading", { level: 1, name: "BRs" })).toBeVisible();

    // §26: cadastrais e da competência, lado a lado mas separados.
    await expect(page.getByText("Posições cadastradas")).toBeVisible();
    await expect(page.getByText("2 ativas · 1 inativas")).toBeVisible();
    await expect(page.getByText("Com substituição no período")).toBeVisible();

    // O desenho da Hierarquia Operacional: um quadro por operação, o estado e a cidade abaixo.
    const lista = page.getByRole("region", { name: "Posições operacionais" });
    await expect(lista.getByRole("button", { name: /^Last Mille MG/ })).toHaveAttribute("aria-expanded", "true");
    await expect(lista.getByRole("button", { name: /^Redespacho - Belém/ })).toBeVisible();
    await expect(lista.getByRole("button", { name: /^Contagem/ })).toHaveAttribute("aria-expanded", "true");
    await expect(lista.getByRole("list", { name: "BRs de Contagem/MG" }).getByRole("listitem")).toHaveCount(2);

    // §24: uma linha por posição, as três do cenário.
    const br = (codigo: string) => lista.getByRole("listitem", { name: `BR ${codigo}` });
    await expect(br("BR0024706")).toBeVisible();
    await expect(br("BR0024901")).toBeVisible();
    await expect(br("Redespacho Belem/Pa_1")).toBeVisible();

    // Nenhuma informação da antiga tabela se perdeu: descrição, situação,
    // liderança e o nível que respondeu, veículo com frota e início da
    // alocação, motorista, última movimentação e o selo de substituição.
    const ocupada = br("BR0024706");
    await expect(ocupada).toContainText("Rota centro-sul");
    await expect(ocupada).toContainText("Ativa");
    await expect(ocupada).toContainText("Daniela Ferreira Lima");
    await expect(ocupada).toContainText("por cidade");
    await expect(ocupada).toContainText("SNO1J56");
    await expect(ocupada).toContainText("FR-0142");
    await expect(ocupada).toContainText(/Início da alocação: (desde )?10\/09\/2026/);
    await expect(ocupada).toContainText("Rafael Souza Campos");
    await expect(ocupada.getByText("substituição", { exact: true })).toBeVisible();

    // A ausência é dita por extenso, nunca um traço mudo — e legível.
    const vaga = br("BR0024901");
    await expect(vaga.getByText("Sem veículo")).toBeVisible();
    await expect(vaga).toContainText("por exceção do BR");
    await expect(br("Redespacho Belem/Pa_1")).toContainText("Sem liderança definida");
    await expect(br("Redespacho Belem/Pa_1")).toContainText("Inativa");

    // Recolher a cidade esconde as BRs dela; o quadro da operação continua.
    await lista.getByRole("button", { name: /^Contagem/ }).click();
    await expect(br("BR0024706")).toHaveCount(0);
    await expect(br("Redespacho Belem/Pa_1")).toBeVisible();

    // §22: a data que a competência representa fica dita, não subentendida.
    await expect(page.getByText(/Recursos resolvidos em 21\/09\/2026/)).toBeVisible();

    expect(crashes, crashes.join("\n")).toEqual([]);
  });

  test("os filtros ficam logo abaixo da competência", async ({ page }) => {
    await page.goto("/dev/preview-brs");
    const filtros = page.getByRole("group", { name: "Filtros das posições operacionais" });
    const competencia = await filtros.getByText("Competência", { exact: true }).boundingBox();
    const busca = await filtros.getByText("Busca", { exact: true }).boundingBox();
    const operacao = await filtros.getByText("Operação", { exact: true }).boundingBox();
    expect(competencia && busca && operacao).toBeTruthy();
    // Busca abaixo da competência, alinhada à esquerda com ela; Operação na mesma linha da Busca.
    expect(busca!.y).toBeGreaterThan(competencia!.y + competencia!.height);
    expect(Math.abs(busca!.x - competencia!.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(operacao!.y - busca!.y)).toBeLessThanOrEqual(8);
  });

  test("ordenar por um cabeçalho escreve a ordem na URL, e o servidor faz o resto", async ({ page }) => {
    await page.goto("/dev/preview-brs");

    const lista = page.getByRole("region", { name: "Posições operacionais" });
    await lista.getByRole("button", { name: "Ordenar por Veículo atual" }).first().click();
    // §24: a ordenação vive na URL — não há uma segunda ordenação no cliente.
    await expect(page).toHaveURL(/ordem=vehicle/);
    await expect(page).toHaveURL(/dir=asc/);

    // Trocar a ordenação nunca carrega a página anterior consigo.
    await expect(page).not.toHaveURL(/page=/);
  });

  test("celular: as posições viram cartões, sem rolagem lateral", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (error) => crashes.push(error.message));

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dev/preview-brs");

    const lista = page.getByRole("region", { name: "Posições operacionais" });
    await expect(lista.getByRole("listitem", { name: /^BR / })).toHaveCount(3);
    // No cartão cada informação vem com o seu rótulo.
    const cartao = lista.getByRole("listitem", { name: "BR Redespacho Belem/Pa_1" });
    await expect(cartao.getByText("Liderança vigente")).toBeVisible();
    await expect(cartao.getByText("Sem liderança definida")).toBeVisible();
    // As mesmas ações da grade, no cartão.
    await expect(lista.getByRole("button", { name: "Detalhar a BR0024706" })).toBeVisible();
    // Abaixo de xl a ordem se escolhe numa lista.
    await lista.getByRole("combobox").selectOption("driver");
    await expect(page).toHaveURL(/ordem=driver/);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `sobra de ${overflow}px na largura`).toBeLessThanOrEqual(0);
    expect(crashes, crashes.join("\n")).toEqual([]);
  });

  test("o detalhe abre sob o código da posição e falha em pé quando não há sessão", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (error) => crashes.push(error.message));

    await page.goto("/dev/preview-brs");
    await page.getByRole("button", { name: "Detalhar a BR0024706" }).click();

    const gaveta = page.getByRole("dialog");
    await expect(gaveta).toBeVisible();
    // Sem Supabase a leitura não tem como responder: o painel diz isso e
    // continua de pé, em vez de derrubar a tela.
    await expect(gaveta.getByText(/Não foi possível|sessão expirou/)).toBeVisible({ timeout: 15_000 });
    expect(crashes, crashes.join("\n")).toEqual([]);
  });
});
