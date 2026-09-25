import type { CellValue } from "@/lib/admin/qlp";
import { parseCsv, readWorkbookSheet, type SheetData } from "./sheet-core";

/**
 * Importação sem teto de linhas — o lado do navegador.
 *
 * O arquivo é lido aqui, não no servidor: assim ele não esbarra no tamanho
 * máximo do corpo de uma requisição, e o servidor recebe só linhas, em partes
 * que cabem numa chamada. Depois o banco valida e grava em partes também,
 * cada uma bem dentro do tempo de uma chamada. Nenhuma regra de negócio mora
 * aqui: este módulo só lê, fatia, repete e informa o progresso.
 */

export interface StepResult<T> {
  ok: boolean;
  error?: string;
  data?: T;
  /** A chamada estourou o tempo do banco: tentar de novo com uma parte menor. */
  retry?: boolean;
}

export interface ParsedImportFile {
  fileName: string;
  fileSize: number;
  fileHash: string;
  sheet: SheetData;
}

export type ImportPhase = "reading" | "sending" | "validating" | "saving";

export interface ImportProgressState {
  phase: ImportPhase;
  done: number;
  total: number;
}

export type ImportProgressHandler = (progress: ImportProgressState | null) => void;

const PHASE_LABEL: Record<ImportPhase, string> = {
  reading: "Lendo o arquivo",
  sending: "Enviando as linhas",
  validating: "Validando as linhas",
  saving: "Gravando",
};

export function describeProgress(progress: ImportProgressState): { label: string; detail: string; percent: number } {
  const format = (n: number) => n.toLocaleString("pt-BR");
  const percent = progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;
  return {
    label: PHASE_LABEL[progress.phase],
    detail: progress.total > 0 ? `${format(progress.done)} de ${format(progress.total)} linhas` : "",
    percent,
  };
}

const parsedFiles = new WeakMap<File, Promise<StepResult<ParsedImportFile>>>();

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function parse(file: File): Promise<StepResult<ParsedImportFile>> {
  if (file.size === 0) return { ok: false, error: "O arquivo está vazio." };
  if (!/\.(xlsx|csv)$/i.test(file.name)) return { ok: false, error: "Formato não suportado. Utilize XLSX ou CSV." };

  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    return { ok: false, error: "Não foi possível ler o arquivo." };
  }

  let sheet: SheetData;
  try {
    if (/\.csv$/i.test(file.name)) {
      sheet = parseCsv(new TextDecoder("utf-8").decode(buffer));
    } else {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      sheet = readWorkbookSheet(workbook);
    }
  } catch {
    return { ok: false, error: "Não foi possível ler o arquivo. Verifique se é um XLSX ou CSV válido." };
  }
  if (!sheet.rows.length) return { ok: false, error: "A planilha não possui linhas de dados." };

  return { ok: true, data: { fileName: file.name, fileSize: file.size, fileHash: await sha256Hex(buffer), sheet } };
}

/**
 * Lê o arquivo uma vez só: escolher o arquivo (para sugerir as colunas) e
 * validá-lo em seguida usam a mesma leitura.
 */
export function readImportFile(file: File): Promise<StepResult<ParsedImportFile>> {
  let pending = parsedFiles.get(file);
  if (!pending) {
    pending = parse(file);
    parsedFiles.set(file, pending);
  }
  return pending;
}

export function fileFromForm(formData: FormData): File | null {
  const file = formData.get("file");
  return file instanceof File && file.name ? file : null;
}

/**
 * Partes de no máximo `maxRows` linhas e `maxBytes` de conteúdo, para que cada
 * envio caiba com folga no corpo de uma requisição.
 */
export function sliceRows(rows: CellValue[][], maxRows = 1000, maxBytes = 1_200_000): [number, number][] {
  const slices: [number, number][] = [];
  let start = 0;
  let bytes = 0;
  for (let i = 0; i < rows.length; i++) {
    const size = JSON.stringify(rows[i]).length + 64;
    if (i > start && (i - start >= maxRows || bytes + size > maxBytes)) {
      slices.push([start, i]);
      start = i;
      bytes = 0;
    }
    bytes += size;
  }
  if (start < rows.length) slices.push([start, rows.length]);
  return slices;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Uma chamada com as repetições que a rede merece: uma falha de conexão é
 * tentada de novo (até três vezes, com espera crescente); um erro que o
 * servidor devolveu não é — ele é a resposta.
 */
export async function withRetry<T>(call: () => Promise<StepResult<T>>): Promise<StepResult<T>> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch {
      if (attempt >= 3) {
        return { ok: false, error: "A conexão com o servidor caiu. Verifique a internet e tente de novo." };
      }
      await wait(1000 * 2 ** attempt);
    }
  }
}

/**
 * Repete `step` até ele dizer que acabou, ajustando o tamanho de cada parte
 * para que uma chamada leve por volta de 2,5 s: cresce quando o banco anda
 * rápido, encolhe quando anda devagar, e cai à metade quando uma chamada
 * estoura o tempo do banco.
 */
export async function runInSteps<T>(options: {
  step: (limit: number) => Promise<StepResult<T>>;
  remaining: (data: T) => number;
  onStep?: (data: T) => void;
  initialLimit?: number;
  minLimit?: number;
  maxLimit?: number;
  targetMs?: number;
}): Promise<StepResult<T>> {
  const { step, remaining, onStep, minLimit = 10, maxLimit = 2000, targetMs = 2500 } = options;
  let limit = options.initialLimit ?? 200;
  let timeouts = 0;
  for (;;) {
    const started = performance.now();
    const result = await withRetry(() => step(limit));
    const elapsed = Math.max(1, performance.now() - started);
    if (!result.ok || !result.data) {
      if (result.retry && timeouts < 6 && limit > minLimit) {
        timeouts++;
        limit = Math.max(minLimit, Math.floor(limit / 2));
        continue;
      }
      return result;
    }
    timeouts = 0;
    onStep?.(result.data);
    if (remaining(result.data) <= 0) return result;
    limit = Math.round(Math.min(maxLimit, Math.max(minLimit, limit * Math.min(2, targetMs / elapsed))));
  }
}

export interface StagedImportSteps<P> {
  /** Grava uma parte das linhas como pendentes; a primeira cria o lote. */
  load: (input: {
    batchId: string | null;
    file: { name: string; size: number; hash: string };
    sheetName: string;
    headers: string[];
    rows: CellValue[][];
    firstRowNumber: number;
  }) => Promise<StepResult<{ batchId: string }>>;
  /** Valida as próximas `limit` linhas pendentes. */
  validate: (batchId: string, limit: number) => Promise<StepResult<{ pending: number }>>;
  /** Fecha a prévia. */
  finalize: (batchId: string, sheet: { fileName: string; sheetName: string; headers: string[] }) => Promise<StepResult<P>>;
  /** Descarta um lote que não chegou à prévia, quando o módulo sabe descartar. */
  abort?: (batchId: string) => Promise<unknown>;
}

/**
 * Ler → enviar em partes → validar em partes → prévia. O resultado é o mesmo
 * de validar o arquivo inteiro de uma vez; só não tem teto de linhas.
 */
export async function runStagedImport<P>(
  file: File | null,
  steps: StagedImportSteps<P>,
  onProgress?: ImportProgressHandler,
): Promise<StepResult<P>> {
  if (!file) return { ok: false, error: "Selecione um arquivo." };
  let batchId: string | null = null;
  const fail = async (error?: string): Promise<StepResult<P>> => {
    if (batchId && steps.abort) await steps.abort(batchId).catch(() => undefined);
    return { ok: false, error };
  };
  try {
    onProgress?.({ phase: "reading", done: 0, total: 0 });
    const parsed = await readImportFile(file);
    if (!parsed.ok || !parsed.data) return { ok: false, error: parsed.error };
    const { sheet } = parsed.data;
    const total = sheet.rows.length;

    for (const [start, end] of sliceRows(sheet.rows)) {
      onProgress?.({ phase: "sending", done: start, total });
      const loaded: StepResult<{ batchId: string }> = await withRetry(() =>
        steps.load({
          batchId,
          file: { name: parsed.data!.fileName, size: parsed.data!.fileSize, hash: parsed.data!.fileHash },
          sheetName: sheet.sheetName,
          headers: sheet.headers,
          rows: sheet.rows.slice(start, end),
          firstRowNumber: start + 2, // a linha 1 é o cabeçalho, como o arquivo mostra
        }),
      );
      if (!loaded.ok || !loaded.data) return await fail(loaded.error);
      batchId = loaded.data.batchId;
    }
    if (!batchId) return { ok: false, error: "A planilha não possui linhas de dados." };

    onProgress?.({ phase: "validating", done: 0, total });
    const id = batchId;
    const validated = await runInSteps({
      step: (limit) => steps.validate(id, limit),
      remaining: (data) => data.pending,
      onStep: (data) => onProgress?.({ phase: "validating", done: total - data.pending, total }),
    });
    if (!validated.ok) return await fail(validated.error);

    const preview = await withRetry(() =>
      steps.finalize(id, { fileName: parsed.data!.fileName, sheetName: sheet.sheetName, headers: sheet.headers }),
    );
    return preview.ok ? preview : await fail(preview.error);
  } finally {
    onProgress?.(null);
  }
}

/** Grava um lote validado em partes, até não sobrar linha por gravar. */
export async function runChunkedProcess<O>(
  step: (limit: number) => Promise<StepResult<{ done: boolean; remaining: number; outcome?: O }>>,
  onProgress?: ImportProgressHandler,
  expectedTotal = 0,
): Promise<StepResult<O>> {
  try {
    let total = expectedTotal;
    onProgress?.({ phase: "saving", done: 0, total });
    const result = await runInSteps({
      step,
      remaining: (data) => (data.done ? 0 : Math.max(1, data.remaining)),
      onStep: (data) => {
        total = Math.max(total, data.remaining);
        onProgress?.({ phase: "saving", done: data.done ? total : Math.max(0, total - data.remaining), total });
      },
    });
    if (!result.ok || !result.data) return { ok: false, error: result.error };
    return { ok: true, data: result.data.outcome };
  } finally {
    onProgress?.(null);
  }
}
