import { test, expect, type Page } from "@playwright/test";

/**
 * Central de Fidelização → Planner de Frotas (Etapa 15, §23–§28).
 *
 * Roda contra `/dev/preview-central-fidelizacao/planner`, que renderiza o mesmo
 * componente com dados fixos (Setembro/2026, hoje = 23/09/2026) e troca as duas
 * rotinas do servidor — a busca de placas e `apply_fidelization_period` — por
 * versões que seguem as mesmas regras sobre o fixture. O que se prova aqui é a
 * tela: o agrupamento operação → liderança → cidade, a BR sem veículo dita como
 * tal, o dia que vira período, a prévia obrigatória antes de gravar, o
 * conflito nomeado e a inversão, e a matriz que não espreme 30 colunas.
 */
const PREVIEW = "/dev/preview-central-fidelizacao/planner";

const grid = (page: Page) => page.getByRole("region", { name: /Grid mensal de placas/ });
const dialogOf = (page: Page) => page.getByRole("dialog", { name: "Editar fidelização do dia" });

test.describe("planner de frotas", () => {
  test("agrupa por operação, liderança e cidade, e recolhe um grupo sem apagá-lo", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (error) => crashes.push(error.message));

    await page.goto(PREVIEW);
    const g = grid(page);
    await expect(g).toBeVisible();
    await expect(page.getByText(/8 BRs · 2 operações · 30 dias · Setembro\/2026/)).toBeVisible();

    // A hierarquia é a da leitura: operação, depois liderança, depois cidade.
    const headers = await g.locator("button[aria-expanded]").allInnerTexts();
    expect(headers[0]).toMatch(/^Last Mille MG/);
    expect(headers[1]).toMatch(/^Liderança: Daniela Ferreira Lima/);
    expect(headers[2]).toMatch(/^Contagem\/MG/);
    await expect(g.getByRole("button", { name: /^Divinópolis\/MG/ })).toBeVisible();
    await expect(g.getByRole("button", { name: /^Liderança: Walace Rodrigues Santos/ })).toBeVisible();
    await expect(g.getByRole("button", { name: /^Redespacho - Belém/ })).toBeVisible();
    await expect(g.getByRole("button", { name: /^Liderança: Marcos Vinícius Andrade/ })).toBeVisible();
    await expect(g.getByRole("button", { name: /^Belém\/PA/ })).toBeVisible();

    // §43: a liderança que vem de uma exceção do próprio BR é dita na linha.
    await expect(g.getByText("por exceção do BR")).toBeVisible();

    const lastMille = g.getByRole("button", { name: /^Last Mille MG/ });
    await lastMille.click();
    await expect(lastMille).toHaveAttribute("aria-expanded", "false");
    await expect(g.getByText("BR0024706")).toBeHidden();
    await expect(g.getByText("Redespacho Belem/Pa_1")).toBeVisible();
    await lastMille.click();
    await expect(g.getByText("BR0024706")).toBeVisible();

    expect(crashes, crashes.join("\n")).toEqual([]);
  });

  test("uma BR sem veículo aparece como tal na linha, no dia e no grupo", async ({ page }) => {
    await page.goto(PREVIEW);
    const g = grid(page);
    await expect(g.getByText("Sem veículo no mês", { exact: true })).toBeVisible();
    // O dia vazio é um botão que diz o que é, não uma célula muda.
    await expect(g.getByRole("button", { name: "BR0024733 · 10/09/2026 · sem veículo" })).toBeVisible();
    await expect(g.getByRole("button", { name: /^Contagem\/MG.*1 sem veículo no mês/ }).first()).toBeVisible();
  });

  test("clicar num dia vazio abre o diálogo daquela data; Confirmar só liga depois da prévia", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (error) => crashes.push(error.message));

    await page.goto(PREVIEW);
    await grid(page).getByRole("button", { name: "BR0024901 · 25/09/2026 · sem veículo" }).click();

    const dialog = dialogOf(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("BR0024901 · Last Mille MG · Contagem/MG · 25/09/2026");
    await expect(dialog.getByText("Sem veículo nesta data.")).toBeVisible();
    await expect(dialog.getByText("Período: somente 25/09/2026 (1 dia)")).toBeVisible();

    const confirmar = dialog.getByRole("button", { name: "Confirmar" });
    await expect(confirmar).toBeDisabled();
    // Não há o que remover num período sem veículo.
    await expect(dialog.getByRole("radio", { name: /Remover veículo neste período/ })).toBeDisabled();

    await dialog.getByRole("button", { name: /^VA106/ }).click();
    await expect(confirmar).toBeDisabled();

    await dialog.getByRole("button", { name: "Pré-visualizar" }).click();
    const previa = dialog.getByRole("region", { name: "Prévia da alteração" });
    await expect(previa).toContainText("Primeira alocação");
    await expect(previa.getByRole("list", { name: "O que será feito" })).toContainText(
      "BR0024901 · VA106: entra em 25/09 (só este dia)",
    );
    await expect(confirmar).toBeEnabled();

    // Mudar o período invalida a prévia: confirmar outra coisa é o erro que ela evita.
    await dialog.getByRole("button", { name: "Em diante" }).click();
    await expect(confirmar).toBeDisabled();
    await expect(previa).toBeHidden();
    await dialog.getByRole("button", { name: "Pré-visualizar" }).click();
    await expect(previa).toContainText("BR0024901 · VA106: entra em 25/09, em diante");

    await confirmar.click();
    // Exato: o Radix Toast repete o título numa região "assertive" por um instante.
    await expect(page.getByText("Primeira alocação registrada na BR0024901.", { exact: true })).toBeVisible();
    await expect(dialog).toBeHidden();

    expect(crashes, crashes.join("\n")).toEqual([]);
  });

  test("substituição num dia ocupado exige motivo e descreve o que acontece antes, durante e depois", async ({ page }) => {
    await page.goto(PREVIEW);
    await grid(page).getByRole("button", { name: /^BR0024706 · 24\/09\/2026 · VA116/ }).click();

    const dialog = dialogOf(page);
    await expect(dialog.getByRole("region", { name: "Veículo nesta data" })).toContainText("VA116");
    await expect(dialog).toContainText("Rafael Souza Campos (principal)");

    await dialog.getByRole("button", { name: "Até o fim do mês" }).click();
    await expect(dialog.getByText("Período: 24/09/2026 a 30/09/2026 (7 dias)")).toBeVisible();
    await dialog.getByRole("button", { name: /^VA140/ }).click();

    // Sem motivo a prévia não sai: substituir exige dizer por quê.
    await dialog.getByRole("button", { name: "Pré-visualizar" }).click();
    await expect(dialog.getByText("Informe o motivo da alteração.")).toBeVisible();

    await dialog.getByLabel("Motivo").fill("Manutenção preventiva do VA116");
    await dialog.getByRole("button", { name: "Pré-visualizar" }).click();
    const previa = dialog.getByRole("region", { name: "Prévia da alteração" });
    await expect(previa).toContainText("Substituição");
    await expect(previa.getByRole("list", { name: "O que será feito" }).getByRole("listitem")).toHaveText([
      /BR0024706 · VA116: encerra em 23\/09/,
      /BR0024706 · VA140: entra de 24\/09 a 30\/09/,
      /BR0024706 · VA116: volta em 01\/10/,
    ]);
    await expect(previa).toContainText("1 motorista segue com a BR no novo veículo.");
    await expect(dialog.getByRole("button", { name: "Confirmar" })).toBeEnabled();
  });

  test("a placa que ocupa outra BR mostra o conflito e oferece a inversão", async ({ page }) => {
    await page.goto(PREVIEW);
    await grid(page).getByRole("button", { name: /^BR0024715 · 24\/09\/2026 · FL145/ }).click();

    const dialog = dialogOf(page);
    const va116 = dialog.getByRole("button", { name: /^VA116/ });
    await expect(va116).toContainText("Em BR0024706");
    await va116.click();
    await dialog.getByLabel("Motivo").fill("FL145 em manutenção; VA116 cobre a rota industrial");
    await dialog.getByRole("button", { name: "Pré-visualizar" }).click();

    // §28: o conflito é nomeado — BR, operação, cidade, período — e não gravável.
    await expect(dialog.getByRole("list", { name: "BRs em conflito" })).toContainText(
      "BR0024706 · Last Mille MG · Contagem · 14/08/2026 – em aberto",
    );
    const confirmar = dialog.getByRole("button", { name: "Confirmar" });
    await expect(confirmar).toBeDisabled();

    const inverter = dialog.getByRole("checkbox", { name: "Inverter as placas entre as BRs" });
    await expect(inverter).not.toBeChecked();
    await inverter.check();

    const previa = dialog.getByRole("region", { name: "Prévia da alteração" });
    await expect(previa).toContainText("Inversão de placas");
    const acoes = previa.getByRole("list", { name: "O que será feito" });
    await expect(acoes).toContainText("BR0024715 · VA116: entra em 24/09 (só este dia)");
    await expect(acoes).toContainText("BR0024706 · FL145: entra em 24/09 (só este dia)");
    await expect(acoes).toContainText("BR0024706 · VA116: volta em 25/09");
    await expect(confirmar).toBeEnabled();

    await confirmar.click();
    await expect(page.getByText("Inversão de placas registrada na BR0024715.", { exact: true })).toBeVisible();
  });

  test("um período que começa antes de hoje é correção histórica; sem a permissão, não confirma", async ({ page }) => {
    await page.goto(`${PREVIEW}?sem_historico=1`);
    await grid(page).getByRole("button", { name: "BR0024901 · 21/09/2026 · sem veículo" }).click();

    const dialog = dialogOf(page);
    await expect(dialog.getByText("Correção histórica", { exact: true })).toBeVisible();
    await expect(dialog).toContainText("Corrigir dados históricos da fidelização");

    await dialog.getByRole("button", { name: /^VA106/ }).click();
    await dialog.getByRole("button", { name: "Pré-visualizar" }).click();
    await expect(dialog.getByRole("region", { name: "Prévia da alteração" })).toContainText("Primeira alocação");
    await expect(dialog.getByRole("button", { name: "Confirmar" })).toBeDisabled();
  });

  test("filtros: situação da alocação, busca e estado vazio que fala dos filtros", async ({ page }) => {
    await page.goto(PREVIEW);
    await page.getByLabel("Situação da alocação").selectOption("without_vehicle");
    await expect(page.getByText(/^1 BR · 1 operação · 30 dias/)).toBeVisible();
    await expect(grid(page).getByText("BR0024733")).toBeVisible();

    await page.getByRole("button", { name: "Limpar filtros" }).first().click();
    await expect(page.getByText(/^8 BRs · 2 operações/)).toBeVisible();

    const busca = page.getByLabel("Busca BR/descrição");
    await busca.fill("nada-assim");
    await busca.press("Enter");
    await expect(page.getByRole("heading", { name: "Nenhuma BR encontrada" })).toBeVisible();
    await expect(page.getByText(/Nenhuma BR corresponde aos filtros/)).toBeVisible();
    await page.getByRole("button", { name: "Limpar filtros" }).last().click();
    await expect(busca).toHaveValue("");
    await expect(grid(page)).toBeVisible();
  });

  test("o código da BR abre a BR; em modo leitura os dias não são botões", async ({ page }) => {
    await page.goto(PREVIEW);
    await grid(page).getByRole("button", { name: "BR0024706", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Abrir BR (prévia): BR0024706" })).toBeVisible();

    await page.goto(`${PREVIEW}?leitura=1`);
    await expect(grid(page).getByText("VA116").first()).toBeVisible();
    await expect(grid(page).getByRole("button", { name: /· 25\/09\/2026 ·/ })).toHaveCount(0);
  });

  test("desktop: a matriz rola dentro do cartão, sem espremer os dias e sem rolar a página", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(PREVIEW);
    const g = grid(page);
    await expect(g).toBeVisible();

    const { scrollWidth, clientWidth } = await g.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(scrollWidth).toBeGreaterThan(clientWidth);
    // Largura de coluna legível: 30 dias não são espremidos para caber.
    const dayWidth = await g.locator("[data-day='1']").evaluate((el) => el.getBoundingClientRect().width);
    expect(dayWidth).toBeGreaterThanOrEqual(40);

    // O grid abre com hoje à vista, destacado.
    const hoje = g.locator("[data-day='23']");
    await expect(hoje).toContainText("hoje");
    const gridBox = (await g.boundingBox())!;
    const hojeBox = (await hoje.boundingBox())!;
    expect(hojeBox.x).toBeGreaterThanOrEqual(gridBox.x);
    expect(hojeBox.x + hojeBox.width).toBeLessThanOrEqual(gridBox.x + gridBox.width);

    // A primeira coluna é fixa: no fim da rolagem, a BR continua à esquerda.
    await g.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    const label = (await g.getByRole("button", { name: "BR0024706", exact: true }).boundingBox())!;
    expect(label.x).toBeGreaterThanOrEqual(gridBox.x);
    expect(label.x).toBeLessThan(gridBox.x + 40);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `sobra de ${overflow}px na largura`).toBeLessThanOrEqual(0);
  });

  test("celular (390px): cartões por BR, sem matriz e sem rolagem horizontal", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(PREVIEW);

    await expect(grid(page)).toBeHidden();
    const lastMille = page.getByRole("region", { name: "Last Mille MG" });
    await expect(lastMille).toBeVisible();
    await expect(page.getByRole("region", { name: "Redespacho - Belém" })).toBeVisible();
    await expect(lastMille.getByText("14/08 – em aberto · VA116 (SNT8E16)")).toBeVisible();
    await expect(lastMille.getByText("01/07 – 14/09 · VA125 (RTA4C09)")).toBeVisible();
    await expect(lastMille.getByText("Sem veículo: 21/09 – 30/09")).toBeVisible();
    await expect(lastMille.getByText("Sem veículo no mês", { exact: true })).toBeVisible();

    let overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `sobra de ${overflow}px na largura`).toBeLessThanOrEqual(0);

    // Sem dia clicado, o período parte de hoje (23/09, dentro do mês).
    await page.getByRole("button", { name: "Editar período da BR0024706" }).click();
    const dialog = dialogOf(page);
    await expect(dialog).toContainText("BR0024706 · Last Mille MG · Contagem/MG · 23/09/2026");
    await expect(dialog.getByRole("button", { name: "Confirmar" })).toBeDisabled();
    overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `sobra de ${overflow}px na largura com o diálogo aberto`).toBeLessThanOrEqual(0);
  });
});
