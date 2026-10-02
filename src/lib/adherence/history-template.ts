import type { ChecklistHistoryLayout } from "./history-import-columns";
import { conditionalHeader, historyTemplateHeaders } from "./history-import-columns";

/**
 * Planilha modelo do histórico de Check List, gerada no navegador a partir
 * do catálogo publicado: uma aba para preencher, uma de instruções e uma de
 * listas. Os cabeçalhos são exatamente os que a importação reconhece; os
 * valores aceitos ficam em listas suspensas onde o Excel permite.
 */
const BRAND = { primary: "FF1F4B93", soft: "FFE8EEF8", ink: "FF0F172A", muted: "FF64748B", accent: "FFB8912E" };
const SHEET = "Histórico";
export const HISTORY_TEMPLATE_FILE = "modelo-historico-check-list.xlsx";

const ANSWERS = ["Sim", "Não", "N/A"];
const CONTEXTS = ["Saída", "Retorno"];
const DATA_ROWS = 5000;

/** As validações de dados existem no ExcelJS, mas a tipagem pública não as declara. */
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

export async function buildHistoryTemplate(layout: ChecklistHistoryLayout): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Horizonte Fleet Management";
  const headers = historyTemplateHeaders(layout);

  // ------------------------------------------------------------ Histórico --
  const ws = wb.addWorksheet(SHEET, { properties: { tabColor: { argb: BRAND.primary } } });
  ws.columns = headers.map((h) => ({ width: h.width }));
  const row = ws.addRow(headers.map((h) => h.header));
  row.height = 48;
  row.eachCell((cell, i) => {
    const target = headers[i - 1].target;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10, name: "Arial" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: target.kind === "fixed" ? BRAND.primary : target.kind === "answer" ? "FF2F5FA8" : "FF6C86B8" } };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "medium", color: { argb: BRAND.accent } } };
  });
  ws.views = [{ state: "frozen", xSplit: 5, ySplit: 1, showGridLines: true }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };

  headers.forEach((h, i) => {
    const letter = col(i + 1);
    const range = `${letter}2:${letter}${DATA_ROWS + 1}`;
    if (h.target.kind === "fixed" && h.target.field === "operational_date") {
      ws.getColumn(i + 1).numFmt = "dd/mm/yyyy";
      validations(ws).add(range, { type: "date", operator: "greaterThan", formulae: [new Date(2020, 0, 1)], showErrorMessage: true, errorTitle: "Data", error: "Informe uma data válida (dd/mm/aaaa)." });
    } else if (h.target.kind === "fixed" && h.target.field === "status") {
      validations(ws).add(range, { type: "list", allowBlank: true, formulae: [`"${layout.statuses.map((s) => s.label).join(",")}"`], showErrorMessage: true, errorTitle: "Status", error: "Use um dos status da aba Listas." });
    } else if (h.target.kind === "fixed" && h.target.field === "context") {
      validations(ws).add(range, { type: "list", allowBlank: true, formulae: [`"${CONTEXTS.join(",")}"`] });
    } else if (h.target.kind === "answer") {
      validations(ws).add(range, { type: "list", allowBlank: true, formulae: [`"${ANSWERS.join(",")}"`], showErrorMessage: true, errorTitle: "Resposta", error: "Use Sim, Não ou N/A." });
    } else if (h.target.kind === "conditional") {
      const q = layout.questions.find((x) => x.questionKey === (h.target as { questionKey: string }).questionKey);
      const c = q?.conditional;
      if (c && c.fieldType === "single_select" && c.options.length) {
        validations(ws).add(range, { type: "list", allowBlank: true, formulae: [`"${c.options.map((o) => o.label).join(",")}"`] });
      }
    }
  });

  // ---------------------------------------------------------- Instruções --
  const info = wb.addWorksheet("Instruções", { properties: { tabColor: { argb: BRAND.accent } } });
  info.columns = [{ width: 4 }, { width: 110 }];
  const lines: [string, "title" | "h" | "p" | "li"][] = [
    ["Histórico de Check List — planilha modelo", "title"],
    [`Catálogo do Check List de Frota: versão ${layout.version.label}. Uma linha por placa e dia operacional.`, "p"],
    ["Como preencher", "h"],
    ["Placa (obrigatória) e Frota (opcional): a importação não cria veículos; a placa precisa existir no Cadastro de Frotas.", "li"],
    ["Data: o dia operacional, até hoje. Contexto: Saída (padrão) ou Retorno.", "li"],
    ["Status: um dos valores da aba Listas. \"Fez Check List\" exige Matrícula (ou Motorista) e as respostas das perguntas.", "li"],
    ["Perguntas: Sim, Não ou N/A. Deixe em branco o que não foi perguntado. Os campos condicionais (\"Qual lado…\", \"Descreva…\") só valem quando a resposta da pergunta os aciona; separe várias opções com ponto e vírgula.", "li"],
    ["Matrícula e Motorista: identificam quem fez o checklist. Sem colaborador cadastrado, o dia entra como solicitação pendente de execução comprovada, sem as respostas.", "li"],
    ["Justificativa (opcional): entra na solicitação ou no expurgo.", "li"],
    ["O que a importação faz", "h"],
    ["Fez Check List → execução oficial do Check List de Frota, com as respostas. A Aderência concilia o dia (FEZ) e os Planos de Ação recebem as inconformidades.", "li"],
    ["Não Fez Check List → nada a gravar: é o padrão do motor; a obrigação do dia é gerada pela importação.", "li"],
    ["Sem Rota, Manutenção, Em Viagem, Frota Reserva, Frota não ativa, Outros → expurgo do dia (exceção autorizada, quando você tiver permissão e marcar a opção; senão, solicitação pendente).", "li"],
    ["Reimportar o mesmo dia da mesma placa não duplica: a execução existente é mantida.", "li"],
    ["Exemplo", "h"],
    ["SNM9H96 | 01/01/2026 | Saída | Fez Check List | 140573 | Nilton Batista Da Costa | (perguntas) Sim · Sim · Não … | (Descreva o problema) Falha no ARLA", "li"],
    ["SNM9I66 | 01/01/2026 | Saída | Sem Rota | (vazio) | (vazio) | (perguntas em branco)", "li"],
  ];
  let r = 1;
  for (const [text, kind] of lines) {
    const cell = info.getCell(r, 2);
    cell.value = kind === "li" ? `• ${text}` : text;
    cell.alignment = { wrapText: true, vertical: "top" };
    cell.font = kind === "title" ? { bold: true, size: 15, color: { argb: BRAND.primary }, name: "Arial" }
      : kind === "h" ? { bold: true, size: 11, color: { argb: BRAND.ink }, name: "Arial" }
      : { size: 10, color: { argb: kind === "p" ? BRAND.muted : BRAND.ink }, name: "Arial" };
    if (kind === "h") { r++; }
    r++;
  }

  // -------------------------------------------------------------- Listas --
  const lists = wb.addWorksheet("Listas", { properties: { tabColor: { argb: "FF6C86B8" } } });
  lists.columns = [{ width: 26 }, { width: 24 }, { width: 80 }];
  const head = (rowIdx: number, values: string[]) => {
    const hr = lists.getRow(rowIdx);
    values.forEach((v, i) => {
      const c = hr.getCell(i + 1);
      c.value = v;
      c.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.primary } };
    });
  };
  head(1, ["Status do dia", "Código", "Significado"]);
  let lr = 2;
  for (const s of layout.statuses) {
    lists.getCell(lr, 1).value = s.label; lists.getCell(lr, 2).value = s.code; lists.getCell(lr, 3).value = s.description;
    lr++;
  }
  lr++;
  head(lr, ["Resposta das perguntas", "", ""]); lr++;
  for (const a of ANSWERS) { lists.getCell(lr, 1).value = a; lr++; }
  lr++;
  head(lr, ["Contexto", "", ""]); lr++;
  for (const c of CONTEXTS) { lists.getCell(lr, 1).value = c; lr++; }
  lr++;
  head(lr, ["Campo condicional", "Opções aceitas", "Pergunta"]); lr++;
  for (const q of layout.questions) {
    if (!q.conditional) continue;
    lists.getCell(lr, 1).value = conditionalHeader(q, layout);
    lists.getCell(lr, 2).value = q.conditional.fieldType === "text" ? "texto livre" : q.conditional.options.map((o) => o.label).join("; ");
    lists.getCell(lr, 3).value = q.text;
    lr++;
  }
  lr++;
  head(lr, ["Pergunta", "Cluster", "Resposta conforme"]); lr++;
  for (const q of layout.questions) {
    lists.getCell(lr, 1).value = q.text; lists.getCell(lr, 2).value = q.clusterName;
    lists.getCell(lr, 3).value = q.conformingAnswer === "no" ? "Não" : "Sim";
    lr++;
  }
  lists.getColumn(1).width = 70;
  lists.getColumn(1).alignment = { wrapText: true, vertical: "top" };

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

export async function downloadHistoryTemplate(layout: ChecklistHistoryLayout): Promise<void> {
  const buffer = await buildHistoryTemplate(layout);
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = HISTORY_TEMPLATE_FILE;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
