import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * Importação da Fidelização · mapeamento de colunas e layouts salvos
 * (Etapa 15, §46–§54).
 *
 * Roda contra `/dev/preview-fidelizacao`, na gaveta "com mapeamento": o
 * arquivo lido tem as colunas Rota, Carro, Entrada e Obs — só Obs é
 * reconhecida pelo nome (Motivo) — e há um layout salvo "Planilha do cliente"
 * que liga as outras três. O que se verifica é o contrato da tela: o que falta
 * fica escrito antes do envio, um campo não recebe duas colunas, o layout
 * salvo se aplica às colunas do arquivo e salvar/excluir layout funciona.
 */
const abrir = async (page: Page) => {
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));
  await page.goto("/dev/preview-fidelizacao");
  await page.getByRole("button", { name: "Importar com mapeamento (prévia)" }).click();
  const drawer = page.getByRole("dialog", { name: "Importar fidelização" });
  await drawer.getByLabel("Arquivo de alocações").setInputFiles({
    name: "cliente.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Rota;Carro;Entrada;Obs\nBR0024054;SNT8E16;01/10/2026;\n"),
  });
  return { drawer, crashes };
};

const campo = (drawer: Locator, coluna: string) => drawer.getByLabel(`Campo da coluna ${coluna}`, { exact: true });

test.describe("importação · mapeamento de colunas", () => {
  test("mostra as colunas do arquivo, a sugestão pelo nome e o que falta antes de validar", async ({ page }) => {
    const { drawer, crashes } = await abrir(page);
    const tabela = drawer.getByRole("table", { name: "Ligação das colunas do arquivo" });
    await expect(tabela.getByRole("row")).toHaveCount(5);
    await expect(campo(drawer, "Obs")).toHaveValue("reason");
    await expect(campo(drawer, "Rota")).toHaveValue("");
    await expect(drawer.getByText("Ligue as colunas obrigatórias: Código BR, Frota ou Placa, Data inicial.")).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Validar arquivo" })).toBeDisabled();

    await campo(drawer, "Rota").selectOption("br_code");
    await campo(drawer, "Carro").selectOption("license_plate");
    await campo(drawer, "Entrada").selectOption("start_date");
    await expect(drawer.getByText("Todas as colunas obrigatórias estão ligadas.")).toBeVisible();

    await drawer.getByRole("button", { name: "Validar arquivo" }).click();
    // A prévia só chega se o mapeamento foi junto com o arquivo.
    await expect(drawer.getByText("alocacoes-outubro.xlsx")).toBeVisible();
    expect(crashes, crashes.join("\n")).toEqual([]);
  });

  test("um campo não recebe duas colunas", async ({ page }) => {
    const { drawer } = await abrir(page);
    await campo(drawer, "Rota").selectOption("br_code");
    await campo(drawer, "Carro").selectOption("license_plate");
    await campo(drawer, "Entrada").selectOption("start_date");
    await campo(drawer, "Obs").selectOption("br_code");
    await expect(drawer.getByText("Campo ligado a mais de uma coluna.")).toHaveCount(2);
    await expect(drawer.getByText("Cada campo recebe uma coluna só: Código BR.")).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Validar arquivo" })).toBeDisabled();
    await expect(drawer.getByRole("button", { name: "Salvar layout" })).toBeDisabled();

    await campo(drawer, "Obs").selectOption("");
    await expect(drawer.getByRole("button", { name: "Validar arquivo" })).toBeEnabled();
  });

  test("aplica um layout salvo às colunas do arquivo", async ({ page }) => {
    const { drawer } = await abrir(page);
    await drawer.getByLabel("Layout salvo").selectOption({ label: "Planilha do cliente" });
    await expect(campo(drawer, "Rota")).toHaveValue("br_code");
    await expect(campo(drawer, "Carro")).toHaveValue("license_plate");
    await expect(campo(drawer, "Entrada")).toHaveValue("start_date");
    // O layout manda ignorar Obs, mesmo com o alias reconhecendo Motivo.
    await expect(campo(drawer, "Obs")).toHaveValue("");
    await expect(drawer.getByRole("button", { name: "Validar arquivo" })).toBeEnabled();
  });

  test("salva a ligação como layout e exclui com confirmação", async ({ page }) => {
    const { drawer } = await abrir(page);
    await campo(drawer, "Rota").selectOption("br_code");
    await campo(drawer, "Carro").selectOption("fleet_code");
    await campo(drawer, "Entrada").selectOption("start_date");

    await drawer.getByLabel("Salvar esta ligação como layout").fill("Base semanal");
    await drawer.getByRole("button", { name: "Salvar layout" }).click();
    await expect(page.getByText('Layout "Base semanal" salvo.', { exact: true })).toBeVisible();
    const layouts = drawer.getByLabel("Layout salvo");
    await expect(layouts.locator("option", { hasText: "Base semanal" })).toHaveCount(1);

    await layouts.selectOption({ label: "Base semanal" });
    await drawer.getByRole("button", { name: "Excluir layout" }).click();
    const confirmar = page.getByRole("alertdialog").or(page.getByRole("dialog", { name: /Excluir o layout/ }));
    await confirmar.getByRole("button", { name: "Excluir" }).click();
    await expect(page.getByText('Layout "Base semanal" excluído.', { exact: true })).toBeVisible();
    await expect(layouts.locator("option", { hasText: "Base semanal" })).toHaveCount(0);
  });
});
