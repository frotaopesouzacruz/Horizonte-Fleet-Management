/**
 * Gestão de KM Rodado — contratos comuns (abas, filtros, permissões, status).
 *
 * As leituras vêm de rotinas do banco (`km_*`) sobre a mesma grade
 * veículo × dia (`private.km_grid`): cartões, tabelas, planner e arquivos usam
 * o mesmo conjunto. O navegador só apresenta — nunca recalcula KM, status,
 * cobertura ou dispersão.
 */
export { camelize, formatDate } from "@/lib/maintenance/types";

export const KM_TABS = [
  "visao-geral",
  "analise",
  "planner",
  "diaria",
  "historico",
  "rodizio",
  "qualidade",
  "importacao",
  "lotes",
  "relatorios",
] as const;
export type KmTab = (typeof KM_TABS)[number];

export const KM_TAB_LABEL: Record<KmTab, string> = {
  "visao-geral": "Visão geral",
  analise: "Análise gerencial",
  planner: "Planner mês/dia",
  diaria: "Visão diária",
  historico: "Histórico por frota",
  rodizio: "Plano de rodízio",
  qualidade: "Qualidade de dados",
  importacao: "Importação",
  lotes: "Lotes",
  relatorios: "Relatórios",
};

/** Filtros da tela (estado na URL). Tudo por id oficial; texto só na busca. */
export interface KmFilters {
  /** Competência AAAA-MM (padrão: a do último dia com leitura). */
  competence?: string;
  from?: string;
  to?: string;
  operation?: string;
  state?: string;
  city?: string;
  br?: string;
  leader?: string;
  unit?: string;
  vehicleType?: string;
  subcategory?: string;
  model?: string;
  vehicle?: string;
  /** Situação da leitura (código do catálogo). */
  status?: string;
  /** Frota: padrão = ativas ou com leitura no período. */
  fleet?: "active" | "inactive" | "all";
  q?: string;
}

/** Nome do parâmetro de URL de cada filtro. */
export const KM_FILTER_PARAM: Record<keyof KmFilters, string> = {
  competence: "competencia",
  from: "de",
  to: "ate",
  operation: "operacao",
  state: "uf",
  city: "cidade",
  br: "br",
  leader: "lideranca",
  unit: "filial",
  vehicleType: "tipo",
  subcategory: "subcategoria",
  model: "modelo",
  vehicle: "veiculos",
  status: "situacao",
  fleet: "frota",
  q: "q",
};

export interface KmPerms {
  view: boolean;
  dashboard: boolean;
  planner: boolean;
  daily: boolean;
  history: boolean;
  analysis: boolean;
  quality: boolean;
  import: boolean;
  export: boolean;
  correct: boolean;
  reprocess: boolean;
  rotationView: boolean;
  rotationCreate: boolean;
  rotationApprove: boolean;
  rotationSchedule: boolean;
  rotationExecute: boolean;
  rotationApplyFidelization: boolean;
  audit: boolean;
  manageParameters: boolean;
}

export const KM_PERMISSION_CODES: Record<keyof KmPerms, string> = {
  view: "km.view",
  dashboard: "km.view_dashboard",
  planner: "km.view_planner",
  daily: "km.view_daily",
  history: "km.view_history",
  analysis: "km.view_analysis",
  quality: "km.view_quality",
  import: "km.import",
  export: "km.export",
  correct: "km.correct",
  reprocess: "km.reprocess",
  rotationView: "km.rotation.view",
  rotationCreate: "km.rotation.create",
  rotationApprove: "km.rotation.approve",
  rotationSchedule: "km.rotation.schedule",
  rotationExecute: "km.rotation.execute",
  rotationApplyFidelization: "km.rotation.apply_fidelization",
  audit: "km.view_audit",
  manageParameters: "km.manage_parameters",
};

/** Abas visíveis para quem tem as permissões. */
export function kmVisibleTabs(p: KmPerms): KmTab[] {
  const out: KmTab[] = [];
  if (p.dashboard) out.push("visao-geral");
  if (p.analysis) out.push("analise");
  if (p.planner) out.push("planner");
  if (p.daily) out.push("diaria");
  if (p.history) out.push("historico");
  if (p.rotationView) out.push("rodizio");
  if (p.quality) out.push("qualidade");
  if (p.import) out.push("importacao");
  if (p.import || p.audit) out.push("lotes");
  if (p.export) out.push("relatorios");
  return out;
}

// ---------------------------------------------------------------------------
// Catálogo de status (espelha km_reading_statuses; o banco é a fonte)
// ---------------------------------------------------------------------------
export type KmTone = "success" | "warning" | "danger" | "info" | "neutral";

export type KmReadingStatus =
  | "validated"
  | "no_movement"
  | "high_mileage"
  | "km_divergence"
  | "pending_review"
  | "inconsistent"
  | "no_reading";

export type KmAlert = "registry_divergence" | "odometer_jump" | "odometer_regression";

export interface KmStatusMeta {
  label: string;
  tone: KmTone;
  /** Conta KM nos totais. */
  counts: boolean;
  description: string;
}

export const KM_STATUS: Record<KmReadingStatus, KmStatusMeta> = {
  validated: { label: "Validado", tone: "success", counts: true, description: "Hodômetros coerentes; o KM entra nos totais." },
  no_movement: {
    label: "Sem movimento",
    tone: "neutral",
    counts: true,
    description: "Leitura válida, deslocamento zero ou dentro da tolerância.",
  },
  high_mileage: {
    label: "Alta rodagem",
    tone: "warning",
    counts: true,
    description: "KM do dia acima do limite configurado; rodagem real, para análise.",
  },
  km_divergence: {
    label: "Divergência de KM",
    tone: "warning",
    counts: true,
    description: "KM informado difere do calculado pelos hodômetros; vale o calculado.",
  },
  pending_review: {
    label: "Pendente de análise",
    tone: "warning",
    counts: true,
    description: "Hodômetro regrediu em relação ao dia anterior além da tolerância.",
  },
  inconsistent: {
    label: "Inconsistente",
    tone: "danger",
    counts: false,
    description: "Final menor que o inicial, ou só um hodômetro informado; não entra nos totais.",
  },
  no_reading: {
    label: "Sem leitura",
    tone: "neutral",
    counts: false,
    description: "Não há informação confiável de hodômetro no dia. Não é 0 km.",
  },
};

export const KM_ALERT_LABEL: Record<KmAlert, string> = {
  registry_divergence: "Divergência cadastral",
  odometer_jump: "Salto de hodômetro",
  odometer_regression: "Hodômetro regressivo",
};

export const kmStatusLabel = (code: string | null | undefined): string =>
  code ? (KM_STATUS[code as KmReadingStatus]?.label ?? KM_ALERT_LABEL[code as KmAlert] ?? code) : "—";

export const kmStatusTone = (code: string | null | undefined): KmTone =>
  code ? (KM_STATUS[code as KmReadingStatus]?.tone ?? "neutral") : "neutral";

/** Faixas de atualização (§26). */
export const KM_FRESHNESS = [
  { key: "updated", label: "Atualizado", tone: "success" },
  { key: "d1", label: "1 dia sem leitura", tone: "info" },
  { key: "d2_3", label: "2 a 3 dias", tone: "warning" },
  { key: "d4_7", label: "4 a 7 dias", tone: "warning" },
  { key: "d7_plus", label: "Mais de 7 dias", tone: "danger" },
  { key: "never", label: "Nunca teve leitura", tone: "neutral" },
] as const;
export type KmFreshnessBucket = (typeof KM_FRESHNESS)[number]["key"];

// ---------------------------------------------------------------------------
// Veículo (cartão comum devolvido pelas rotinas)
// ---------------------------------------------------------------------------
export interface KmVehicleCard {
  vehicleId: string;
  plate: string;
  fleetCode: string | null;
  status: string;
  vehicleTypeId: string | null;
  type: string | null;
  subcategoryId: string | null;
  subcategory: string | null;
  modelId: string | null;
  model: string | null;
}

// ---------------------------------------------------------------------------
// Formatação pt-BR
// ---------------------------------------------------------------------------
const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtInt = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "—" : nf0.format(v));
export const fmt1 = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "—" : nf1.format(v));
export const fmt2 = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "—" : nf2.format(v));
export const fmtKm = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "—" : `${nf0.format(v)} km`);
export const fmtKm1 = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "—" : `${nf1.format(v)} km`);
export const fmtPct = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "—" : `${nf1.format(v)}%`);

const WEEKDAY = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
/** ISO (aaaa-mm-dd) → "seg" sem passar por fuso. isodow: 1 = segunda … 7 = domingo. */
export const weekdayShort = (isodow: number) => WEEKDAY[isodow % 7];

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
/** "2026-09" → "setembro de 2026". */
export function competenceLabel(competence: string | null | undefined): string {
  if (!competence || !/^\d{4}-\d{2}$/.test(competence)) return "—";
  const [y, m] = competence.split("-").map(Number);
  return `${MONTHS[m - 1]} de ${y}`;
}

/** Contexto que todo painel recebe da tela. */
export type KmNavigate = (patch: Record<string, string | null>) => void;

// ---------------------------------------------------------------------------
// Dispersão & outliers (códigos do banco → rótulos do HFC)
// ---------------------------------------------------------------------------
export const KM_BAND: Record<string, { label: string; tone: KmTone | "brand" }> = {
  far_above: { label: "Muito acima da faixa", tone: "danger" },
  above: { label: "Acima da faixa", tone: "warning" },
  within: { label: "Dentro da faixa", tone: "success" },
  below: { label: "Abaixo da faixa", tone: "info" },
  far_below: { label: "Muito abaixo da faixa", tone: "brand" },
  small_cohort: { label: "Coorte insuficiente", tone: "neutral" },
  insufficient_coverage: { label: "Dados insuficientes", tone: "neutral" },
};

/** Quadrantes: hodômetro acumulado (x) × intensidade de rodagem (y), pelas medianas da coorte. */
export const KM_QUADRANT: Record<string, { label: string; tone: KmTone; hint: string }> = {
  high_km_high_use: {
    label: "Prioridade de alívio",
    tone: "danger",
    hint: "Hodômetro acima da mediana da coorte e rodagem acima da mediana.",
  },
  high_km_low_use: {
    label: "Utilização compensatória",
    tone: "warning",
    hint: "Hodômetro acima da mediana, rodagem abaixo: já compensa o acumulado.",
  },
  low_km_high_use: {
    label: "Em equalização",
    tone: "info",
    hint: "Hodômetro abaixo da mediana, rodagem acima: aproxima-se da coorte.",
  },
  low_km_low_use: {
    label: "Pode absorver rodagem",
    tone: "success",
    hint: "Hodômetro e rodagem abaixo da mediana: candidato a receber rodagem.",
  },
};

/** Outlier é "ponto para análise", nunca erro. */
export const KM_OUTLIER: Record<string, string> = {
  above_cohort: "Rodagem acima da coorte",
  below_cohort: "Rodagem abaixo da coorte",
  high_odometer: "Hodômetro acima da coorte",
  underused: "Baixa utilização",
  low_coverage: "Cobertura insuficiente",
};
export const KM_OUTLIER_TAG = "Ponto para análise";

// ---------------------------------------------------------------------------
// Plano de rodízio
// ---------------------------------------------------------------------------
export const KM_ROTATION_STATUS: Record<string, { label: string; tone: KmTone }> = {
  suggested: { label: "Sugerido", tone: "neutral" },
  approved: { label: "Aprovado", tone: "info" },
  scheduled: { label: "Programado", tone: "warning" },
  executed: { label: "Executado", tone: "success" },
  cancelled: { label: "Cancelado", tone: "danger" },
};

export const KM_ROTATION_PRIORITY: Record<string, { label: string; tone: KmTone }> = {
  high: { label: "Alta", tone: "success" },
  medium: { label: "Média", tone: "warning" },
  low: { label: "Baixa", tone: "info" },
  none: { label: "Sem benefício", tone: "neutral" },
};

export const KM_ROTATION_SCOPE: Record<string, string> = {
  same_cohort_same_operation: "Mesma coorte e mesma operação",
  same_cohort_global: "Mesma coorte técnica (todas as operações)",
};

// ---------------------------------------------------------------------------
// Atenção: kmRpc camelCaseia TODAS as chaves, inclusive as de mapas indexados
// por código (by_status.no_reading → byStatus.noReading; freshness.d2_3 →
// freshness.d23; quadrants.high_km_high_use → quadrants.highKmHighUse). Os
// valores (ex.: status: "no_reading") não mudam. Para ler um mapa pelo código
// do catálogo, use `byCode`.
// ---------------------------------------------------------------------------
export const camelCode = (code: string) => code.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

export function byCode<T>(map: Record<string, T> | null | undefined, code: string): T | undefined {
  if (!map) return undefined;
  return map[code] ?? map[camelCode(code)];
}
