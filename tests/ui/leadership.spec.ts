import { test, expect, type Page } from "@playwright/test";

/**
 * Lideranças — Planejamento por Tipo de Operação → Cidade (modelo do HFC),
 * "Por liderança" (por pessoa ou por tipo de operação), cartões e a gaveta
 * "o que esta liderança responde" (§35).
 *
 * Roda contra `/dev/preview-liderancas`, a mesma tela com dados fixos
 * (Setembro/2026, "hoje" 23/09). A gravação da prévia aplica à matriz em
 * memória a regra da rotina `set_city_leadership` e guarda o que recebeu em
 * `window.__cityLeadershipSaves`; a regra em si (datas, véspera, correção
 * histórica, escopo) é coberta pela suíte SQL 18.
 */
const PREVIEW = "/dev/preview-liderancas";
const WIDTHS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "celular", width: 390, height: 844 },
];

type CitySave = { operationCityId: string; employeeId: string | null; reason?: string | null };
const saves = (page: Page) =>
  page.evaluate(() => (window as unknown as { __cityLeadershipSaves?: CitySave[] }).__cityLeadershipSaves ?? []);
const toasts = (page: Page) => page.getByLabel("Notifications (F8)");
const city = (page: Page, name: string) => page.getByTestId("planner-city").filter({ hasText: name });
/** Cada cartão é a `section` mais próxima do seu rótulo em `h3`. */
const card = (page: Page, name: string) =>
  page.getByRole("heading", { name, exact: true }).locator("xpath=ancestor::section[1]");

test.describe("lideranças · planejamento", () => {
  test("só existem as abas Planejamento e Por liderança", async ({ page }) => {
    await page.goto(PREVIEW);
    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveText(["Planejamento", "Por liderança"]);
  });

  test("os cartões dizem locais, atribuídos no mês, lideranças envolvidas e o que está sob responsabilidade", async ({ page }) => {
    const crashes: string[] = [];
    page.on("pageerror", (error) => crashes.push(error.message));
    await page.goto(PREVIEW);

    await expect(card(page, "Locais de operação")).toContainText("4");
    // Em 23/09: Contagem (Daniela) e Uberlândia (Rogério). Belo Horizonte só
    // começa em 25/09 e Belém terminou em 10/09.
    await expect(card(page, "Atribuídos no mês")).toContainText("2/4");
    await expect(card(page, "Atribuídos no mês")).toContainText("Cobertura 50%");
    await expect(card(page, "Lideranças envolvidas")).toContainText("2");
    const sob = card(page, "Sob responsabilidade");
    await expect(sob).toContainText("62");
    await expect(sob).toContainText("60 veículos · 12 motoristas");
    expect(crashes, crashes.join("\n")).toEqual([]);
  });

  test("cada tipo de operação traz código, número de cidades e a liderança de cada cidade", async ({ page }) => {
    await page.goto(PREVIEW);
    const lastMile = page.getByRole("region", { name: "Last Mille MG" });
    await expect(lastMile).toContainText("OP-00004");
    await expect(lastMile).toContainText("2 cidades");
    await expect(lastMile).toContainText("1 de 2 com liderança");

    const contagem = city(page, "Contagem");
    await expect(contagem.getByRole("combobox", { name: "Liderança de Contagem/MG" })).toHaveValue("emp-1");
    await expect(contagem).toContainText("desde 01/07/2026 · em aberto");
    await expect(contagem).toContainText("1 BR com liderança própria");

    const bh = city(page, "Belo Horizonte");
    await expect(bh.getByRole("combobox", { name: "Liderança de Belo Horizonte/MG" })).toHaveValue("");
    await expect(bh).toContainText("Sem liderança em 23/09/2026");
    await expect(bh).toContainText("Depois: Paulo Henrique Martins (25/09/2026 a 30/09/2026)");

    await expect(city(page, "Belém")).toContainText("Antes: Renata Alves Moreira (01/08/2026 a 10/09/2026)");

    // Quem responde sem ser do perfil continua visível, dito como tal.
    const uberlandia = city(page, "Uberlândia").getByRole("combobox", { name: "Liderança de Uberlândia/MG" });
    await expect(uberlandia).toHaveValue("emp-7");
    await expect(uberlandia.locator("option:checked")).toHaveText(/fora do perfil Liderança Operações/);

    // O seletor oferece as pessoas do perfil, com matrícula.
    await expect(contagem.getByRole("combobox", { name: "Liderança de Contagem/MG" }).locator("option")).toContainText([
      "Selecionar liderança",
      "Daniela Ferreira Lima · 10234",
      "Marco Vieira dos Santos · 140538",
      "Paulo Henrique Martins · 10555",
      "Walace Rodrigues Santos · 10418",
    ]);
  });

  test("escolher a liderança de uma cidade grava de hoje em diante e atualiza a matriz", async ({ page }) => {
    await page.goto(PREVIEW);
    await city(page, "Belém").getByRole("combobox", { name: "Liderança de Belém/PA" }).selectOption("emp-2");

    await expect(toasts(page).getByText("Belém/PA: Walace Rodrigues Santos a partir de 23/09/2026.")).toBeVisible();
    expect(await saves(page)).toEqual([
      expect.objectContaining({ operationCityId: "oc-3", employeeId: "emp-2", reason: null }),
    ]);
    await expect(city(page, "Belém").getByRole("combobox", { name: "Liderança de Belém/PA" })).toHaveValue("emp-2");
    await expect(card(page, "Atribuídos no mês")).toContainText("3/4");
  });

  test("trocar a liderança diz até quando a anterior responde", async ({ page }) => {
    await page.goto(PREVIEW);
    await city(page, "Contagem").getByRole("combobox", { name: "Liderança de Contagem/MG" }).selectOption("emp-5");
    await expect(toasts(page).getByText("Contagem/MG: Marco Vieira dos Santos a partir de 23/09/2026.")).toBeVisible();
    await expect(toasts(page).getByText(/Daniela Ferreira Lima responde até 22\/09\/2026/)).toBeVisible();
    await expect(city(page, "Contagem")).toContainText("Antes: Daniela Ferreira Lima (01/07/2026 a 22/09/2026)");
  });

  test("a lixeira pede confirmação e encerra a liderança a partir de hoje", async ({ page }) => {
    await page.goto(PREVIEW);
    await page.getByRole("button", { name: "Remover liderança de Contagem/MG" }).click();
    const dialog = page.getByRole("alertdialog").or(page.getByRole("dialog", { name: /Remover a liderança de Contagem/ }));
    await expect(dialog).toContainText("a partir de hoje (23/09/2026)");
    expect(await saves(page)).toHaveLength(0);
    await dialog.getByRole("button", { name: "Remover" }).click();

    await expect(toasts(page).getByText("Contagem/MG sem liderança a partir de 23/09/2026.")).toBeVisible();
    expect(await saves(page)).toEqual([expect.objectContaining({ operationCityId: "oc-1", employeeId: null })]);
    await expect(city(page, "Contagem")).toContainText("Sem liderança em 23/09/2026");
  });

  test("numa competência passada a escolha é correção histórica, com motivo", async ({ page }) => {
    await page.goto(`${PREVIEW}?competencia=passada`);
    await expect(page.getByText(/Competência encerrada/).first()).toBeVisible();
    await city(page, "Contagem").getByRole("combobox", { name: "Liderança de Contagem/MG" }).selectOption("emp-2");

    const dialog = page.getByRole("dialog", { name: "Correção histórica — Contagem/MG" });
    await expect(dialog).toContainText("vale só para essa competência");
    await dialog.getByRole("button", { name: "Confirmar correção" }).click();
    await expect(dialog.getByText("Informe o motivo da correção histórica.")).toBeVisible();
    expect(await saves(page)).toHaveLength(0);

    await dialog.getByLabel("Motivo da correção").fill("A liderança de agosto foi cadastrada errada.");
    await dialog.getByRole("button", { name: "Confirmar correção" }).click();
    await expect(dialog).toBeHidden();
    expect(await saves(page)).toEqual([
      expect.objectContaining({ operationCityId: "oc-1", employeeId: "emp-2", reason: "A liderança de agosto foi cadastrada errada." }),
    ]);
  });

  test("sem a permissão de correção histórica, a competência passada fica só para leitura", async ({ page }) => {
    await page.goto(`${PREVIEW}?competencia=passada&sem_historico=1`);
    await expect(city(page, "Contagem").getByRole("combobox", { name: "Liderança de Contagem/MG" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Remover liderança de Contagem/MG" })).toHaveCount(0);
    await expect(page.getByText(/Só quem pode corrigir dados históricos/)).toBeVisible();
  });

  test("os filtros Estado e Cidade trazem as opções da cobertura", async ({ page }) => {
    await page.goto(PREVIEW);
    await expect(page.getByLabel("Filtrar por estado").locator("option")).toHaveText(["Todos", "MG", "PA"]);
    const cidade = page.getByLabel("Filtrar por cidade");
    await expect(cidade).toBeEnabled();
    await expect(cidade.locator("option")).toContainText(["Todas", "Belém/PA", "Belo Horizonte/MG", "Contagem/MG"]);
  });
});

test.describe("lideranças · por liderança", () => {
  test("por tipo de operação mostra quais lideranças estão com quais cidades", async ({ page }) => {
    await page.goto(PREVIEW);
    await page.getByRole("tab", { name: "Por liderança" }).click();
    await page.getByRole("button", { name: "Tipo de operação" }).click();

    const lastMile = page.getByRole("region", { name: "Last Mille MG" });
    await expect(lastMile.getByTestId("operation-leader").filter({ hasText: "Daniela Ferreira Lima" })).toContainText("Contagem/MG");
    await expect(lastMile.getByTestId("operation-leader").filter({ hasText: "Walace Rodrigues Santos" })).toContainText("BR0024901 · Contagem/MG");
    const belem = page.getByRole("region", { name: "Redespacho - Belém" });
    await expect(belem.getByTestId("operation-leader").filter({ hasText: "Renata Alves Moreira" })).toContainText("Belém/PA (até 10/09/2026)");
  });

  test("a gaveta lista as BRs de uma liderança com a regra que respondeu por cada uma", async ({ page }) => {
    await page.goto(PREVIEW);
    await page.getByRole("tab", { name: "Por liderança" }).click();
    await page.getByRole("button", { name: "O que esta liderança responde: Daniela Ferreira Lima" }).first().click();

    const gaveta = page.getByRole("dialog", { name: "Daniela Ferreira Lima" });
    await expect(gaveta).toBeVisible();
    const totais = gaveta.locator("dl[aria-label='Totais sob responsabilidade']");
    await expect(totais.locator("div").filter({ hasText: "BRs" })).toContainText("2");
    await expect(totais.locator("div").filter({ hasText: "Veículos" })).toContainText("1");
    await expect(totais.locator("div").filter({ hasText: "Motoristas" })).toContainText("1");

    // §43: a BR0024901 tem exceção própria e por isso não está sob a liderança
    // da cidade; as duas que estão dizem "cidade" como origem da regra.
    const tabela = gaveta.getByRole("table");
    await expect(tabela.getByRole("row").filter({ hasText: "BR0024706" })).toContainText("cidade");
    await expect(tabela.getByRole("row").filter({ hasText: "BR0024706" })).toContainText("Rafael Souza Campos");
    await expect(tabela.getByRole("row").filter({ hasText: "BR0024052" })).toContainText("Sem veículo");
    await expect(tabela.getByRole("row").filter({ hasText: "BR0024901" })).toHaveCount(0);
    await expect(gaveta.getByText(/Resolvido em 21\/09\/2026 pela precedência exceção do BR → cidade → operação/)).toBeVisible();
  });

  test("a exceção do BR aparece como tal na gaveta de quem a tem", async ({ page }) => {
    await page.goto(PREVIEW);
    await page.getByRole("tab", { name: "Por liderança" }).click();
    await page.getByRole("button", { name: "O que esta liderança responde: Walace Rodrigues Santos" }).first().click();

    const gaveta = page.getByRole("dialog", { name: "Walace Rodrigues Santos" });
    await expect(gaveta.getByRole("row").filter({ hasText: "BR0024901" })).toContainText("exceção do BR");
    await expect(gaveta.getByRole("heading", { name: "Cidades" })).toBeVisible();
  });
});

for (const size of WIDTHS) {
  test(`lideranças: não há rolagem horizontal (${size.name})`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto(PREVIEW);
    await expect(page.getByRole("heading", { name: "Atribuídos no mês", exact: true })).toBeVisible();
    for (const tab of ["Planejamento", "Por liderança"]) {
      await page.getByRole("tab", { name: tab }).click();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `sobra de ${overflow}px na largura (${tab})`).toBeLessThanOrEqual(0);
    }
  });
}
