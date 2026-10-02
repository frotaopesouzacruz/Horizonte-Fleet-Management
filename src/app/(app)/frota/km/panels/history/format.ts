/**
 * Histórico por frota — rótulos e formatação (apresentação apenas: nada aqui
 * recalcula KM, status ou cobertura).
 */
import { KM_FRESHNESS, weekdayShort, type KmTone } from "@/lib/km/types";

const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTHS_FULL = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** "2026-05-01" → "01/05". */
export const dayMonth = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** "2026-05-01" → "01/05/2026". */
export const fullDate = (iso: string | null | undefined) =>
  iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—";

/** Dia da semana de uma data ISO, sem passar por fuso. */
export function weekdayOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  return weekdayShort(dow === 0 ? 7 : dow);
}

/** "2026-05" → "mai/26". */
export function monthShort(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return y && m ? `${MONTHS_SHORT[m - 1]}/${String(y).slice(2)}` : ym;
}

/** "2026-05" → "maio de 2026". */
export function monthFull(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return y && m ? `${MONTHS_FULL[m - 1]} de ${y}` : ym;
}

/** Carimbo ISO → "dd/mm/aaaa hh:mm" no fuso de São Paulo. */
export function stamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export const HEALTH: Record<string, { label: string; tone: KmTone; hint: string }> = {
  healthy: { label: "Saudável", tone: "success", hint: "Atualizado, sem regressões nem divergências e com boa cobertura." },
  attention: {
    label: "Atenção",
    tone: "warning",
    hint: "2 ou mais dias sem leitura, uma regressão, divergência de KM ou cobertura abaixo de 70%.",
  },
  critical: {
    label: "Crítico",
    tone: "danger",
    hint: "Mais de 7 dias sem leitura, 2 ou mais regressões ou cobertura abaixo de 30%.",
  },
  no_data: { label: "Sem dados", tone: "neutral", hint: "O veículo nunca teve leitura confiável de hodômetro." },
};

export function freshnessMeta(bucket: string | null | undefined): { label: string; tone: KmTone } {
  const meta = KM_FRESHNESS.find((f) => f.key === bucket);
  return meta ? { label: meta.label, tone: meta.tone } : { label: "—", tone: "neutral" };
}

export const VEHICLE_STATUS: Record<string, { label: string; tone: KmTone }> = {
  active: { label: "Ativo", tone: "success" },
  inactive: { label: "Inativo", tone: "neutral" },
};

export const CONFIDENCE: Record<string, { label: string; tone: KmTone }> = {
  high: { label: "Confiança alta", tone: "success" },
  medium: { label: "Confiança média", tone: "warning" },
  low: { label: "Confiança baixa", tone: "danger" },
  none: { label: "Sem base para projetar", tone: "neutral" },
};

export const AUDIT_ACTION: Record<string, string> = {
  import_update: "Atualização pela importação",
  correction: "Correção manual",
  review: "Análise de pendência",
  reprocess: "Reprocessamento",
  context_refresh: "Contexto operacional atualizado",
};

/** Campos da trilha (chaves já em camelCase). */
export const AUDIT_FIELD: Record<string, { label: string; kind: "km" | "status" | "ref" }> = {
  odometerStart: { label: "Hodômetro inicial", kind: "km" },
  odometerEnd: { label: "Hodômetro final", kind: "km" },
  distanceValidated: { label: "KM validado", kind: "km" },
  distanceImported: { label: "KM informado", kind: "km" },
  status: { label: "Situação", kind: "status" },
  operationId: { label: "Operação", kind: "ref" },
  operationBrId: { label: "BR", kind: "ref" },
  leaderEmployeeId: { label: "Liderança", kind: "ref" },
};

/** Situações em que o dia não tem ocorrência a tratar. */
export const QUIET_STATUSES = new Set(["validated", "no_movement", "no_reading", "future"]);
