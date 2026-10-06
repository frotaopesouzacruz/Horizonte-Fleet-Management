/**
 * Vocabulário das visões gerenciais de Aderência MM e Aderência calibragem.
 *
 * Só apresentação: o que é "OK" em cada indicador é decidido no banco
 * (`private.tire_mm_ok`, `tire_deadline_ok`, `tire_psi_ok`,
 * `tire_calibration_conform`). Aqui ficam o rótulo, o tom e a ordem de cada
 * situação que a rotina `tires_indicator` devolve, e o espelho (sem
 * `server-only`) dos mapas de sub-visão → indicador do carregador.
 */
import type { TiresCalibrationSub, TiresMeasurementSub } from "@/lib/tires/loaders";
import {
  CAL_CONF_LABEL, DEADLINE_LABEL, DEADLINE_TONE, PSI_LABEL, PSI_TONE, TREAD_LABEL, TREAD_TONE, issueCode,
  type KpiIndicator, type TireIndicatorDim, type TireIndicatorKey, type TiresIndicator, type TiresTone,
} from "@/lib/tires/types";

export type IndicatorTab = "medicao" | "calibragem";
export type IndicatorSub = TiresMeasurementSub | TiresCalibrationSub;

export interface SubItem {
  value: IndicatorSub;
  label: string;
  indicator: TireIndicatorKey;
}

/** Sub-visões de cada aba (`?sub=`), na ordem das abas. */
export const INDICATOR_SUBS: Record<IndicatorTab, SubItem[]> = {
  medicao: [
    { value: "sulco", label: "Sulco (MM)", indicator: "tread" },
    { value: "prazo", label: "Prazo de medição", indicator: "measurement" },
  ],
  calibragem: [
    { value: "conformidade", label: "Calibragem: prazo + PSI", indicator: "calibration_conformity" },
    { value: "prazo", label: "Prazo de calibragem", indicator: "calibration" },
    { value: "psi", label: "Pressão (PSI)", indicator: "psi" },
  ],
};

/** Indicador do histórico semanal de cada indicador gerencial (espelho de `INDICATOR_KPI`). */
export const INDICATOR_KPI_OF: Record<TireIndicatorKey, KpiIndicator> = {
  tread: "tread_conformity",
  measurement: "measurement_deadline",
  calibration: "calibration_deadline",
  psi: "psi_conformity",
  calibration_conformity: "calibration_conformity",
  overall: "overall_conformity",
};

// ---------------------------------------------------------------------------
// Situações
// ---------------------------------------------------------------------------
interface StatusVocab {
  /** ordem de leitura: as conformes primeiro, depois as não conformes */
  order: string[];
  label: Record<string, string>;
  tone: Record<string, TiresTone>;
  /** situações que a regra do banco conta como conformes (não entram nas pendências) */
  ok: string[];
}

const DEADLINE: StatusVocab = {
  order: ["em_dia", "proximo", "vencido", "sem_registro"],
  label: DEADLINE_LABEL,
  tone: DEADLINE_TONE,
  ok: ["em_dia", "proximo"],
};

const CAL_CONF_TONE: Record<string, TiresTone> = {
  conforme: "success",
  prazo_ok_psi_inadequado: "danger",
  psi_ok_prazo_vencido: "warning",
  prazo_e_psi: "danger",
  nao_conforme: "danger",
};

const VOCAB: Record<TireIndicatorKey, StatusVocab> = {
  tread: {
    order: ["adequado", "atencao", "critico", "abaixo_legal", "sem_medicao"],
    label: TREAD_LABEL,
    tone: TREAD_TONE,
    ok: ["adequado", "atencao"],
  },
  measurement: DEADLINE,
  calibration: DEADLINE,
  psi: {
    order: ["adequada", "baixa", "excesso", "sem_parametro", "sem_calibragem"],
    label: PSI_LABEL,
    tone: PSI_TONE,
    ok: ["adequada"],
  },
  calibration_conformity: {
    order: ["conforme", "prazo_ok_psi_inadequado", "psi_ok_prazo_vencido", "prazo_e_psi"],
    label: CAL_CONF_LABEL,
    tone: CAL_CONF_TONE,
    ok: ["conforme"],
  },
  overall: {
    order: ["conforme", "nao_conforme"],
    label: { conforme: "Conforme", nao_conforme: "Não conforme" },
    tone: { conforme: "success", nao_conforme: "danger" },
    ok: ["conforme"],
  },
};

export interface StatusEntry {
  /** código do banco em snake (o valor de `?pendencia=`) */
  code: string;
  label: string;
  tone: TiresTone;
  ok: boolean;
  count: number;
}

export const statusLabel = (indicator: TireIndicatorKey, code: string) => VOCAB[indicator].label[code] ?? code.replace(/_/g, " ");
export const statusTone = (indicator: TireIndicatorKey, code: string): TiresTone => VOCAB[indicator].tone[code] ?? "neutral";
export const statusIsOk = (indicator: TireIndicatorKey, code: string) => VOCAB[indicator].ok.includes(code);

/**
 * Situações do indicador com a contagem do banco. As chaves de `distribution`
 * chegam camelizadas (emDia, abaixoLegal): voltam a snake para o filtro. As
 * situações conhecidas aparecem mesmo com zero (zero é dado, não ausência).
 */
export function statusEntries(ind: TiresIndicator): StatusEntry[] {
  const v = VOCAB[ind.indicator];
  const counts = new Map<string, number>();
  for (const [k, n] of Object.entries(ind.distribution ?? {})) counts.set(issueCode(k), Number(n) || 0);
  const codes = [...v.order, ...[...counts.keys()].filter((c) => !v.order.includes(c))];
  return codes.map((code) => ({
    code,
    label: statusLabel(ind.indicator, code),
    tone: statusTone(ind.indicator, code),
    ok: statusIsOk(ind.indicator, code),
    count: counts.get(code) ?? 0,
  }));
}

/** Contagem de uma situação (código snake) na distribuição camelizada. */
export function statusCount(ind: TiresIndicator, code: string): number {
  for (const [k, n] of Object.entries(ind.distribution ?? {})) if (issueCode(k) === code) return Number(n) || 0;
  return 0;
}

// ---------------------------------------------------------------------------
// Quebras ("Onde estão os desvios")
// ---------------------------------------------------------------------------
export const DIM_ORDER: TireIndicatorDim[] = ["operation", "city", "leader", "vehicleType", "dimension"];
/** Valor de `?agrupar=` de cada quebra (estado de exibição, sem nova consulta). */
export const DIM_PARAM: Record<TireIndicatorDim, string> = {
  operation: "operacao",
  city: "local",
  leader: "lideranca",
  vehicleType: "tipo",
  dimension: "perfil",
};
/** Filtro global da tela que corresponde ao id de cada quebra. */
export const DIM_FILTER_PARAM: Record<TireIndicatorDim, string> = {
  operation: "operacao",
  city: "local",
  leader: "lideranca",
  vehicleType: "tipo",
  dimension: "dimensao",
};

// ---------------------------------------------------------------------------
// Formatos
// ---------------------------------------------------------------------------
const nf1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** "+3,2%" / "−51,0%" (sinal tipográfico). */
export const fmtSignedPct = (v: number | null | undefined) =>
  v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${nf1.format(Math.abs(v))}%`;

/** Variação em pontos percentuais. */
export const fmtPp = (v: number | null | undefined) =>
  v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${nf1.format(Math.abs(v))} p.p.`;

/** Média de dias com uma casa ("8,0 dias"). */
export const fmtDaysAvg = (v: number | null | undefined) => (v == null ? "—" : `${nf1.format(v)} ${v === 1 ? "dia" : "dias"}`);

/** "2026-10-09" → "09/10". */
export const shortDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const [, m, d] = iso.slice(0, 10).split("-");
  return d && m ? `${d}/${m}` : iso;
};
