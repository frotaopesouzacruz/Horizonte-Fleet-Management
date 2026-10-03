import { MTSR_FIXED_COLUMNS, MTSR_SHEET_NAME, MTSR_TEMPLATE_FILE } from "./import-sheet";

/**
 * Planilha modelo da conformidade MTSR, gerada no navegador a partir do
 * catálogo de componentes ativos: Placa, Frota, Última vistoria, Observação e
 * uma coluna por componente (lista suspensa OK / NOK / Sem informação). Uma
 * aba de instruções explica as regras que o banco aplica.
 */
const BRAND = { primary: "FF1F4B93", soft: "FFE8EEF8", accent: "FFB8912E", muted: "FF64748B" };
const DATA_ROWS = 2000;
const STATUS_VALUES = ["OK", "NOK", "Sem informação"];

type ValidationSheet = { dataValidations: { add: (range: string, validation: Record<string, unknown>) => void } };
const validations = (ws: unknown) => (ws as ValidationSheet).dataValidations;

const col = (n: number) => {
  let s = "";
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
};

export async function buildMtsrTemplate(components: { name: string; verificationMode: string }[]): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Horizonte Fleet Management";

  const headers = [
    ...MTSR_FIXED_COLUMNS.map((c) => ({ header: c.label, width: c.field === "observation" ? 40 : 18, kind: "fixed" as const, field: c.field })),
    ...components.map((c) => ({ header: c.name, width: 22, kind: "component" as const, field: c.name })),
  ];
  const ws = wb.addWorksheet(MTSR_SHEET_NAME, { properties: { tabColor: { argb: BRAND.primary } } });
  ws.columns = headers.map((h) => ({ width: h.width }));
  const row = ws.addRow(headers.map((h) => h.header));
  row.height = 36;
  row.eachCell((cell, i) => {
    const h = headers[i - 1];
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10, name: "Arial" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: h.kind === "fixed" ? BRAND.primary : "FF2F5FA8" } };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "medium", color: { argb: BRAND.accent } } };
  });
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 1, showGridLines: true }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };

  headers.forEach((h, i) => {
    const letter = col(i + 1);
    const range = `${letter}2:${letter}${DATA_ROWS + 1}`;
    if (h.kind === "fixed" && h.field === "last_inspection_date") {
      ws.getColumn(i + 1).numFmt = "dd/mm/yyyy";
      validations(ws).add(range, { type: "date", operator: "greaterThan", formulae: [new Date(2020, 0, 1)], showErrorMessage: true, errorTitle: "Data", error: "Informe uma data válida (dd/mm/aaaa)." });
    } else if (h.kind === "component") {
      validations(ws).add(range, { type: "list", allowBlank: true, formulae: [`"${STATUS_VALUES.join(",")}"`], showErrorMessage: true, errorTitle: "Status", error: "Use OK, NOK ou Sem informação." });
    }
  });

  const info = wb.addWorksheet("Instruções", { properties: { tabColor: { argb: BRAND.accent } } });
  info.columns = [{ width: 28 }, { width: 100 }];
  const lines: [string, string][] = [
    ["Como preencher", "Uma linha por veículo. Placa é obrigatória (ou Frota quando a placa estiver vazia). A importação nunca cria veículos: placas fora do Cadastro de Frotas são recusadas com motivo."],
    ["Última vistoria", "Data da última vistoria válida (dd/mm/aaaa). Alimenta o prazo (CONFORME / ATENÇÃO / VENCIDO). Nunca retrocede uma data já registrada."],
    ["Componentes", `Uma coluna por componente: ${STATUS_VALUES.join(" · ")}. Também aceita Conforme / Não conforme / Sim / Não / Ausente. Valores não reconhecidos são ignorados e informados na prévia.`],
    ["Prioridade de fonte", "A importação manual tem prioridade menor que a vistoria de campo e a atualização do backoffice: na mesma data, não sobrescreve uma leitura dessas fontes (fica registrado como conflito)."],
    ["Leituras antigas", "Uma leitura com data anterior à leitura atual do componente é ignorada (stale) e fica no histórico de ingestão."],
    ["Prévia e confirmação", "Nada é gravado sem a confirmação. A prévia mostra linhas aproveitáveis, avisos e recusas; linhas com erro não são aplicadas."],
    ["Componentes de campo × backoffice", components.map((c) => `${c.name} (${c.verificationMode === "field" ? "campo" : "backoffice"})`).join(" · ")],
  ];
  info.addRow(["Modelo de conformidade MTSR", ""]).font = { bold: true, size: 14, color: { argb: BRAND.primary } };
  info.addRow(["", ""]);
  for (const [k, v] of lines) {
    const r = info.addRow([k, v]);
    r.getCell(1).font = { bold: true };
    r.getCell(2).alignment = { wrapText: true, vertical: "top" };
    r.getCell(1).alignment = { vertical: "top" };
  }
  return wb.xlsx.writeBuffer() as unknown as Promise<ArrayBuffer>;
}

export function downloadMtsrTemplate(buffer: ArrayBuffer, fileName = MTSR_TEMPLATE_FILE) {
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
