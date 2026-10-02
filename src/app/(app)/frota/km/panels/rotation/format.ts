/**
 * Plano de rodízio — rótulos e textos da tela (sem cálculo de KM: os números
 * chegam prontos das rotinas `km_*rotation*`; aqui só se formata e agrupa).
 */
import { formatStamp } from "@/lib/maintenance/types";
import type {
  KmRotationCandidate,
  KmRotationCohort,
  KmRotationEvaluation,
  KmRotationEvent,
  KmRotationItem,
  KmRotationPlan,
  KmRotationPlanDetail,
  KmRotationPriority,
  KmRotationScenario,
  KmRotationSimulation,
  KmRotationVehicle,
} from "@/lib/km/rotation";
import {
  fmtInt,
  fmtKm,
  fmtPct,
  formatDate,
  KM_ROTATION_PRIORITY,
  KM_ROTATION_SCOPE,
  KM_ROTATION_STATUS,
} from "@/lib/km/types";

export { formatStamp };

export const ROTATION_HORIZONS = [30, 60, 90] as const;

export const NO_LOCAL = "local não informado";
export const OBJECTIVE = "Equalização de quilometragem da frota";
export const SAFETY_NOTICE =
  "O rodízio só sugere. Nada é movimentado sem aprovação; a Fidelização só muda por 'Aplicar na Fidelização', com prévia e confirmação.";

export const pad2 = (n: number | null | undefined) => (n == null ? "—" : String(n).padStart(2, "0"));
export const plural = (n: number, one: string, many: string) => `${fmtInt(n)} ${n === 1 ? one : many}`;
export const localOf = (v: KmRotationVehicle | null | undefined) => v?.local || NO_LOCAL;
export const kmMonth = (v: number | null | undefined) => (v == null ? "—" : `${fmtInt(v)} km/mês`);
export const kmDay = (v: number | null | undefined) =>
  v == null ? "—" : `${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v)} km/dia`;
export const period = (from: string | null | undefined, to: string | null | undefined) =>
  from && to ? `${formatDate(from)} a ${formatDate(to)}` : "—";
export const signedKm = (v: number | null | undefined) =>
  v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtKm(Math.abs(v))}`;

export const statusLabel = (s: string | null | undefined) => (s ? (KM_ROTATION_STATUS[s]?.label ?? s) : "—");
export const statusTone = (s: string | null | undefined) => (s ? (KM_ROTATION_STATUS[s]?.tone ?? "neutral") : "neutral");
export const priorityLabel = (p: string | null | undefined) => (p ? (KM_ROTATION_PRIORITY[p]?.label ?? p) : "—");
export const priorityTone = (p: string | null | undefined) => (p ? (KM_ROTATION_PRIORITY[p]?.tone ?? "neutral") : "neutral");
export const scopeLabel = (s: string | null | undefined) => (s ? (KM_ROTATION_SCOPE[s] ?? s) : "—");
export const scopeText = (s: string | null | undefined, differentLocations: boolean | null | undefined) =>
  `${scopeLabel(s)}${differentLocations ? " · somente locais diferentes" : ""}`;

export const pairText = (a: KmRotationVehicle | null | undefined, b: KmRotationVehicle | null | undefined) =>
  `${a?.plate ?? "—"} ⇄ ${b?.plate ?? "—"}`;

/** "MP3 em 90.000 km · faltam 573 km" / "MP4 vencida · 10.378 km além do marco". */
export function preventiveText(v: KmRotationVehicle | null | undefined): string {
  const p = v?.preventive;
  if (!p || p.milestoneKm == null) return "Sem ciclo preventivo em aberto";
  const cycle = p.cycleNumber != null ? `MP${p.cycleNumber}` : "Preventiva";
  if (p.kmRemaining == null) return `${cycle} em ${fmtKm(p.milestoneKm)}`;
  if (p.kmRemaining <= 0) return `${cycle} vencida · ${fmtKm(Math.abs(p.kmRemaining))} além do marco de ${fmtKm(p.milestoneKm)}`;
  return `${cycle} em ${fmtKm(p.milestoneKm)} · faltam ${fmtKm(p.kmRemaining)}`;
}

export function maintenanceText(v: KmRotationVehicle | null | undefined): string {
  switch (v?.maintenanceOpen) {
    case "in_progress":
      return "Em andamento";
    case "scheduled":
      return "Programada";
    case null:
    case undefined:
      return "Nenhuma";
    default:
      return String(v.maintenanceOpen);
  }
}

export const EVALUATION: Record<string, { label: string; tone: "success" | "warning" | "neutral"; text: string }> = {
  converging: {
    label: "Convergindo",
    tone: "success",
    text: "A diferença entre os hodômetros diminuiu desde a execução: o rodízio está equalizando as frotas.",
  },
  not_converging: {
    label: "Sem convergência",
    tone: "warning",
    text: "A diferença entre os hodômetros não diminuiu desde a execução. Verifique se as frotas assumiram as rotas trocadas.",
  },
  insufficient_data: {
    label: "Dados insuficientes",
    tone: "neutral",
    text: "Ainda não há 7 dias com leitura de cada frota após a execução para avaliar o resultado.",
  },
};
export const evaluationMeta = (e: KmRotationEvaluation | null | undefined) =>
  EVALUATION[e?.result ?? ""] ?? { label: e?.result ?? "—", tone: "neutral" as const, text: "" };

// ---------------------------------------------------------------------------
// Análise de um par (sugestão, item do plano ou simulação) num formato só
// ---------------------------------------------------------------------------
export interface RotationAnalysis {
  source: "suggestion" | "plan" | "simulation";
  vehicleA: KmRotationVehicle;
  vehicleB: KmRotationVehicle;
  cohort: KmRotationCohort | null;
  cohortLabel: string | null;
  gapCurrent: number | null;
  gapWithout: number | null;
  gapWith: number | null;
  reductionKm: number | null;
  reductionPct: number | null;
  intensityReductionAPct: number | null;
  priority: KmRotationPriority | string;
  conditioned: boolean;
  conditionReasons: string[];
  scenarios: KmRotationScenario[];
  justification: string | null;
  horizonDays: number;
  period: { from: string; to: string } | null;
  sameCohort?: boolean;
  /** Linha de origem (ex.: "Plano ROD-00001 · rodízio 01 · dados de 30/09/2026"). */
  origin?: string;
}

const emptyVehicle = (id: string): KmRotationVehicle => ({ vehicleId: id, plate: "—" });

export function analysisFromCandidate(
  c: KmRotationCandidate,
  horizonDays: number,
  p: { from: string; to: string } | null,
): RotationAnalysis {
  return {
    source: "suggestion",
    vehicleA: c.vehicleA,
    vehicleB: c.vehicleB,
    cohort: c.cohort,
    cohortLabel: c.cohortLabel,
    gapCurrent: c.gapCurrent,
    gapWithout: c.gapWithout,
    gapWith: c.gapWith,
    reductionKm: c.reductionKm,
    reductionPct: c.reductionPct,
    intensityReductionAPct: c.intensityReductionAPct,
    priority: c.priority,
    conditioned: c.conditioned,
    conditionReasons: c.conditionReasons ?? [],
    scenarios: c.scenarios ?? [],
    justification: c.justification,
    horizonDays,
    period: p,
    origin: p ? `Sugestão calculada com o período ${period(p.from, p.to)}` : undefined,
  };
}

export function analysisFromItem(item: KmRotationItem, plan: KmRotationPlan): RotationAnalysis {
  const s = item.snapshot ?? {};
  return {
    source: "plan",
    vehicleA: s.vehicleA ?? emptyVehicle(item.vehicleAId),
    vehicleB: s.vehicleB ?? emptyVehicle(item.vehicleBId),
    cohort: s.cohort ?? null,
    cohortLabel: item.cohortLabel,
    gapCurrent: item.gapCurrentKm,
    gapWithout: item.gapFutureWithoutKm,
    gapWith: item.gapFutureWithKm,
    reductionKm: item.reductionKm,
    reductionPct: item.reductionPct,
    intensityReductionAPct: s.intensityReductionAPct ?? null,
    priority: item.priority,
    conditioned: Boolean(s.conditioned),
    conditionReasons: s.conditionReasons ?? [],
    scenarios: s.scenarios ?? [],
    justification: item.justification,
    horizonDays: plan.horizonDays,
    period: { from: plan.periodFrom, to: plan.periodTo },
    origin: `Plano ${plan.code} · rodízio ${pad2(item.itemNumber)} · ${
      item.revalidatedAt ? `revalidado em ${formatStamp(item.revalidatedAt)}` : `analisado em ${formatStamp(plan.analyzedAt ?? plan.createdAt)}`
    }`,
  };
}

export function analysisFromSimulation(sim: KmRotationSimulation, fallback: RotationAnalysis): RotationAnalysis {
  return {
    source: "simulation",
    vehicleA: sim.vehicleA ?? fallback.vehicleA,
    vehicleB: sim.vehicleB ?? fallback.vehicleB,
    cohort: sim.cohort ?? null,
    cohortLabel: sim.cohortLabel ?? sim.cohort?.label ?? fallback.cohortLabel,
    gapCurrent: sim.gapCurrent ?? null,
    gapWithout: sim.gapWithout ?? null,
    gapWith: sim.gapWith ?? null,
    reductionKm: sim.reductionKm ?? null,
    reductionPct: sim.reductionPct ?? null,
    intensityReductionAPct: sim.intensityReductionAPct ?? null,
    priority: sim.priority ?? "none",
    conditioned: Boolean(sim.conditioned),
    conditionReasons: sim.conditionReasons ?? [],
    scenarios: sim.scenarios ?? [],
    justification: sim.justification ?? null,
    horizonDays: sim.horizonDays ?? fallback.horizonDays,
    period: sim.period ?? null,
    sameCohort: sim.sameCohort,
    origin: sim.period ? `Simulação com as leituras atuais · período ${period(sim.period.from, sim.period.to)}` : undefined,
  };
}

// ---------------------------------------------------------------------------
// Itens do plano agrupados por grupo técnico (ordem do servidor)
// ---------------------------------------------------------------------------
export interface ItemGroup {
  label: string;
  items: KmRotationItem[];
}

export function groupItems(items: KmRotationItem[]): ItemGroup[] {
  const groups = new Map<string, KmRotationItem[]>();
  for (const it of items) {
    const label = it.cohortLabel || it.snapshot?.cohort?.label || "Grupo técnico não identificado";
    const list = groups.get(label);
    if (list) list.push(it);
    else groups.set(label, [it]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
    .map(([label, list]) => ({ label, items: list }));
}

export const activeItems = (items: KmRotationItem[]) => items.filter((i) => i.status !== "cancelled");

export function involvedLocals(items: KmRotationItem[]): { known: string[]; unknown: number } {
  const known = new Set<string>();
  let unknown = 0;
  for (const it of items) {
    for (const v of [it.snapshot?.vehicleA, it.snapshot?.vehicleB]) {
      if (v?.local) known.add(v.local);
      else unknown++;
    }
  }
  return { known: [...known].sort((a, b) => a.localeCompare(b, "pt-BR")), unknown };
}

export function localsText(items: KmRotationItem[]): string {
  const { known, unknown } = involvedLocals(items);
  if (known.length === 0) return unknown > 0 ? "Não informados" : "—";
  return `${fmtInt(known.length)}${unknown > 0 ? " (há frotas sem local informado)" : ""}`;
}

// ---------------------------------------------------------------------------
// Linha do tempo
// ---------------------------------------------------------------------------
const str = (v: unknown) => (v == null || v === "" ? null : String(v));
const num = (v: unknown) => (typeof v === "number" ? v : v == null || v === "" ? null : Number(v));

export function eventText(ev: KmRotationEvent, items: KmRotationItem[], employees: Map<string, string>): string {
  const item = ev.itemId ? items.find((i) => i.id === ev.itemId) : undefined;
  const ref = item
    ? `Rodízio ${pad2(item.itemNumber)} (${pairText(item.snapshot?.vehicleA, item.snapshot?.vehicleB)})`
    : "Rodízio";
  const p = (ev.payload ?? {}) as Record<string, unknown>;
  switch (ev.eventType) {
    case "created":
      return `Plano criado · período ${period(str(p.periodFrom), str(p.periodTo))} · horizonte de ${fmtInt(num(p.horizonDays))} dias · ${scopeText(str(p.scopeMode), Boolean(p.differentLocationsOnly))}`;
    case "item_added":
      return `Rodízio incluído: ${str(p.vehicleA) ?? "—"} ⇄ ${str(p.vehicleB) ?? "—"} · redução estimada de ${fmtPct(num(p.reductionPct))}`;
    case "item_status_changed":
      return `${ref}: ${statusLabel(ev.fromStatus)} → ${statusLabel(ev.toStatus)}`;
    case "executed":
      return `${ref} executado em ${formatDate(str(p.executionDate))} · hodômetros na execução: ${item?.snapshot?.vehicleA?.plate ?? "A"} ${fmtKm(num(p.odometerA))}, ${item?.snapshot?.vehicleB?.plate ?? "B"} ${fmtKm(num(p.odometerB))}`;
    case "item_updated": {
      const parts: string[] = [];
      const date = p.effectiveDate as { to?: string | null } | undefined;
      if (date) parts.push(`data prevista ${date.to ? formatDate(date.to) : "removida"}`);
      const resp = p.responsibleEmployeeId as { to?: string | null } | undefined;
      if (resp) parts.push(`responsável ${resp.to ? (employees.get(resp.to) ?? "alterado") : "removido"}`);
      if (p.notes) parts.push("observação atualizada");
      return `${ref} atualizado${parts.length ? `: ${parts.join(" · ")}` : ""}`;
    }
    case "status_changed": {
      const n = num(p.items);
      return `Situação do plano: ${statusLabel(ev.fromStatus)} → ${statusLabel(ev.toStatus)}${n != null ? ` · ${plural(n, "rodízio alterado", "rodízios alterados")}` : ""}`;
    }
    case "revalidated":
      return `Plano revalidado · período ${period(str(p.periodFrom), str(p.periodTo))} · ${plural(num(p.updated) ?? 0, "rodízio atualizado", "rodízios atualizados")} · ${fmtInt(num(p.noBenefit) ?? 0)} sem benefício · ${fmtInt(num(p.withoutData) ?? 0)} sem dados`;
    case "updated": {
      const parts: string[] = [];
      const name = p.name as { to?: string } | undefined;
      if (name?.to) parts.push(`nome: “${name.to}”`);
      if (p.notes) parts.push("observação atualizada");
      return `Plano editado${parts.length ? ` · ${parts.join(" · ")}` : ""}`;
    }
    case "fidelization_applied":
      return `${ref} aplicado na Fidelização com vigência a partir de ${formatDate(str(p.effectiveDate))}`;
    default:
      return ev.eventType;
  }
}

// ---------------------------------------------------------------------------
// "Copiar relatório": texto para e-mail/Teams montado com os dados do servidor
// ---------------------------------------------------------------------------
export function planReportText(detail: KmRotationPlanDetail, avgReductionPct: number | null | undefined): string {
  const { plan } = detail;
  const active = activeItems(detail.items);
  const groups = groupItems(active);
  const lines: string[] = [];
  lines.push(`Assunto sugerido: Plano de Rodízio de Frotas — Equalização de KM (${plan.name} · ${plan.code})`);
  lines.push("");
  lines.push("Prezados,");
  lines.push("");
  lines.push(
    `Encaminho o plano de rodízio ${plan.code} para equalização da quilometragem da frota. As trocas abaixo foram propostas a partir da análise de utilização das frotas de cada grupo técnico no período de ${period(plan.periodFrom, plan.periodTo)}, com projeção de ${fmtInt(plan.horizonDays)} dias.`,
  );
  lines.push("");
  lines.push(`PLANO DE RODÍZIO — ${plan.name.toLocaleUpperCase("pt-BR")}`);
  lines.push(`Código: ${plan.code}`);
  lines.push(`Situação: ${statusLabel(plan.status)}`);
  lines.push(`Objetivo: ${OBJECTIVE}`);
  lines.push(`Período analisado: ${period(plan.periodFrom, plan.periodTo)}`);
  lines.push(`Horizonte de projeção: ${fmtInt(plan.horizonDays)} dias`);
  lines.push(`Escopo: ${scopeText(plan.scopeMode, plan.differentLocationsOnly)}`);
  lines.push(`Rodízios: ${fmtInt(active.length)}`);
  lines.push(`Grupos envolvidos: ${fmtInt(groups.length)}`);
  lines.push(`Locais envolvidos: ${localsText(active)}`);
  lines.push(`Redução média estimada do desequilíbrio: ${fmtPct(avgReductionPct ?? null)}`);
  lines.push(
    `Dados analisados em: ${formatStamp(plan.analyzedAt ?? plan.createdAt)}${plan.dataAsOf ? ` (leituras até ${formatDate(plan.dataAsOf)})` : ""}`,
  );
  if (plan.notes) lines.push(`Observação: ${plan.notes}`);

  for (const g of groups) {
    lines.push("");
    lines.push(g.label.toLocaleUpperCase("pt-BR"));
    for (const it of g.items) {
      const a = it.snapshot?.vehicleA;
      const b = it.snapshot?.vehicleB;
      lines.push("");
      lines.push(
        `${pad2(it.itemNumber)}. ${a?.plate ?? "—"} (${localOf(a)}) ⇄ ${b?.plate ?? "—"} (${localOf(b)}) — ${statusLabel(it.status)} · prioridade ${priorityLabel(it.priority).toLocaleLowerCase("pt-BR")}`,
      );
      if (it.justification) lines.push(it.justification);
      if (it.snapshot?.conditioned && it.snapshot.conditionReasons?.length) {
        lines.push(`Condicionado: ${it.snapshot.conditionReasons.join("; ")}.`);
      }
      if (it.status === "executed") lines.push(`Executado em: ${formatDate(it.executionDate)}`);
      else lines.push(`Previsto para: ${it.effectiveDate ? formatDate(it.effectiveDate) : "a definir"}`);
      lines.push(`Responsável: ${it.responsibleName ?? "a definir"}`);
    }
  }

  lines.push("");
  lines.push(
    "Os rodízios só serão executados após aprovação. A Fidelização das frotas só será alterada pela ação \"Aplicar na Fidelização\", com prévia e confirmação. Ficamos à disposição para ajustes.",
  );
  lines.push("");
  lines.push("Atenciosamente,");
  return lines.join("\n");
}

/** Copia texto para a área de transferência (com recuo para navegadores sem a API). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // segue para o recuo
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
