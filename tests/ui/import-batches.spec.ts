import { test, expect, type Page } from "@playwright/test";
import ExcelJS from "exceljs";

/**
 * Importação sem teto de linhas — a leitura da planilha no navegador e o
 * envio em partes (migration 20260925100000).
 *
 * Roda contra `/dev/preview-importacao-lotes`: a gaveta real da Fidelização,
 * a leitura real do arquivo (CSV e XLSX, este pelo ExcelJS do navegador) e o
 * protocolo real de partes; só as rotinas do servidor são simuladas, e cada
 * chamada fica registrada em `window.__importBatches`.
 *
 * O que se verifica: um arquivo acima do teto antigo (5.000 linhas) é aceito,
 * chega inteiro — partes contíguas, nenhuma linha perdida ou repetida, cada
 * parte dentro do tamanho de uma requisição —, é validado e gravado em várias
 * chamadas, com o progresso na tela.
 */

interface BatchLog {
  loads: { first: number; last: number; rows: number; headers: string[] }[];
  validates: number[];
  processes: number[];
  sheetName: string | null;
}

const HEADERS = ["Código BR", "Frota", "Data inicial", "Data final"];

function csvFile(rows: number): Buffer {
  const lines = [HEADERS.join(";")];
  for (let i = 1; i <= rows; i++) lines.push(`BR${String(i).padStart(7, "0")};VA${i % 900};01/10/2026;31/10/2026`);
  return Buffer.from(lines.join("\n"), "utf8");
}

async function xlsxFile(rows: number): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Alocações");
  sheet.addRow(HEADERS);
  for (let i = 1; i <= rows; i++) {
    sheet.addRow([`BR${String(i).padStart(7, "0")}`, `VA${i % 900}`, new Date(Date.UTC(2026, 9, 1)), new Date(Date.UTC(2026, 9, 31))]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function importFile(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));
  await page.goto("/dev/preview-importacao-lotes");
  await page.getByRole("button", { name: "Importar fidelização" }).click();
  const drawer = page.getByRole("dialog", { name: "Importar fidelização" });
  await drawer.getByLabel("Arquivo de alocações").setInputFiles(file);
  await drawer.getByRole("button", { name: "Validar arquivo" }).click();
  return { drawer, crashes };
}

const readLog = (page: Page) => page.evaluate(() => (window as unknown as { __importBatches: BatchLog }).__importBatches);

function expectContiguous(log: BatchLog, total: number) {
  expect(log.loads.length).toBeGreaterThan(1);
  expect(log.loads[0].first).toBe(2);
  for (let i = 1; i < log.loads.length; i++) expect(log.loads[i].first).toBe(log.loads[i - 1].last + 1);
  expect(log.loads.at(-1)!.last).toBe(total + 1);
  expect(log.loads.reduce((sum, l) => sum + l.rows, 0)).toBe(total);
  for (const load of log.loads) expect(load.rows).toBeLessThanOrEqual(1000);
  expect(log.loads[0].headers).toEqual(HEADERS);
}

test.describe("importação sem teto de linhas", () => {
  test("CSV de 12.000 linhas: enviado em partes contíguas, validado e gravado em partes, com progresso", async ({ page }) => {
    const { drawer, crashes } = await importFile(page, { name: "alocacoes.csv", mimeType: "text/csv", buffer: csvFile(12_000) });

    await expect(drawer.getByTestId("import-progress")).toBeVisible();
    await expect(drawer.getByText("12.000 linhas", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(drawer.getByTestId("import-progress")).toBeHidden();

    const log = await readLog(page);
    expectContiguous(log, 12_000);
    expect(log.validates.length).toBeGreaterThan(1);
    expect(log.sheetName).toBe("CSV");

    await drawer.getByRole("button", { name: "Importar 12.000 linha(s)" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Importar" }).click();
    await expect(
      page.getByLabel("Notifications (F8)").getByText("Importação concluída: 12.000 vínculo(s) novo(s)", { exact: false }),
    ).toBeVisible({ timeout: 30_000 });
    const after = await readLog(page);
    expect(after.processes.length).toBeGreaterThan(1);
    expect(crashes).toEqual([]);
  });

  test("XLSX de 6.001 linhas (acima do teto antigo) lido no navegador pelo ExcelJS", async ({ page }) => {
    const buffer = await xlsxFile(6_001);
    const { drawer, crashes } = await importFile(page, {
      name: "alocacoes.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
    });

    await expect(drawer.getByText("6.001 linhas", { exact: true })).toBeVisible({ timeout: 30_000 });
    const log = await readLog(page);
    expectContiguous(log, 6_001);
    expect(log.sheetName).toBe("Alocações");
    expect(crashes).toEqual([]);
  });
});
