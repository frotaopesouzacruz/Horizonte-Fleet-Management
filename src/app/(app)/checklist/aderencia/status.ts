import type { StatusTone } from "@/lib/adherence/queries";

/**
 * Apresentação do catálogo de status (§20, §66).
 *
 * O código técnico é o do banco; o rótulo e o tom vêm do catálogo em tempo de
 * execução e este mapa é o fallback — nunca uma segunda fonte de verdade. A
 * abreviação de duas letras é o que cabe numa célula de 2,5rem sem depender
 * da cor: "NF" continua legível em preto e branco.
 */
export interface StatusMeta {
  label: string;
  tone: StatusTone;
  short: string;
}

export const STATUS_META: Record<string, StatusMeta> = {
  FEZ_CHECKLIST: { label: "Fez checklist", tone: "success", short: "OK" },
  NAO_FEZ_CHECKLIST: { label: "Não fez checklist", tone: "danger", short: "NF" },
  RETORNO_PENDENTE: { label: "Retorno pendente", tone: "pending", short: "RP" },
  PLANEJADO: { label: "Planejado", tone: "neutral", short: "PL" },
  SEM_ROTA: { label: "Sem rota", tone: "info", short: "SR" },
  MANUTENCAO: { label: "Manutenção", tone: "warning", short: "MN" },
  FROTA_RESERVA: { label: "Frota reserva", tone: "neutral", short: "RS" },
  EM_VIAGEM: { label: "Em viagem", tone: "info", short: "EV" },
  FROTA_NAO_ATIVA: { label: "Frota não ativa", tone: "neutral", short: "NA" },
  SEM_DADOS: { label: "Sem dados", tone: "neutral", short: "—" },
};

export function statusMeta(code: string | null | undefined): StatusMeta {
  if (!code) return STATUS_META.SEM_DADOS;
  return STATUS_META[code] ?? { label: code, tone: "neutral", short: code.slice(0, 2) };
}

/** Classes de fundo/texto por tom, para células e chips que não usam Badge. */
export const TONE_CLASS: Record<StatusTone, string> = {
  success: "bg-success-soft text-success-soft-fg border-success/40",
  danger: "bg-danger-soft text-danger-soft-fg border-danger/40",
  warning: "bg-warning-soft text-warning-soft-fg border-warning/40",
  info: "bg-info-soft text-info-soft-fg border-info/40",
  neutral: "bg-neutral-soft text-neutral-soft-fg border-border",
  pending: "bg-surface-secondary text-fg-muted border-border border-dashed",
};

export const JOURNEY_META: Record<string, { label: string; tone: StatusTone }> = {
  prevista: { label: "Prevista", tone: "neutral" },
  completa: { label: "Jornada completa", tone: "success" },
  em_rota: { label: "Em rota", tone: "info" },
  incompleta: { label: "Jornada incompleta", tone: "warning" },
  nao_realizada: { label: "Não realizada", tone: "danger" },
  excecao: { label: "Exceção operacional", tone: "neutral" },
};

const pct = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat("pt-BR");

/** "88,89%" — ou "Sem base" quando não há denominador (§35). */
export function formatPct(value: number | null | undefined): string {
  return value == null ? "Sem base" : `${pct.format(value)}%`;
}

export function formatInt(value: number): string {
  return int.format(value);
}

export function formatDateBr(value: string | null | undefined): string {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-");
  return d ? `${d}/${m}/${y}` : value;
}

export function formatDateTimeBr(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export const CONTEXT_LABEL = { saida: "Saída de rota", retorno: "Retorno de rota" } as const;
