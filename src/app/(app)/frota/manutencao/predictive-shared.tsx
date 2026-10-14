"use client";

import * as React from "react";
import { Clock, Eye } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import {
  formatInt,
  REFERENCE_FORMAL,
  REFERENCE_TYPE_LABEL,
  type MaintenanceCatalog,
  type PredictiveInsight,
  type PredictiveRanking,
  type PredictiveRankingKey,
} from "@/lib/maintenance/types";
import type { PanelActions } from "./shared";

/**
 * Preditiva — peças compartilhadas pelas visões (painel, alertas, matriz,
 * indicadores, qualidade, auditoria, envios). Nada aqui calcula status: só
 * apresenta o que o servidor devolveu e traduz cliques em filtros da URL.
 */

export const PAGE_SIZES = [25, 50, 100, 200];

const pct1 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
export const pctText = (v: number | null | undefined) => (v == null ? "—" : `${pct1.format(v)}%`);
export const pct1Format = (v: number) => `${pct1.format(v)}%`;

export function ViewButton({
  pressed, disabled, onClick, children, testId,
}: {
  pressed: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "inline-flex h-8 items-center gap-1 rounded-sm px-2.5 text-body-sm font-medium hfm-transition hfm-focus-ring",
        "disabled:pointer-events-none disabled:opacity-55",
        pressed ? "bg-surface text-fg shadow-sm" : "text-fg-secondary hover:bg-hover-overlay hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

/** Paginação de lista paginada no servidor: `pagina`/`por_pagina` na URL. */
export function ServerPagination({
  page, pageSize, total, pending, actions, label,
}: {
  page: number;
  pageSize: number;
  total: number;
  pending: boolean;
  actions: PanelActions;
  label: string;
}) {
  if (total <= PAGE_SIZES[0] && page === 1) return null;
  return (
    <Pagination
      page={page}
      pageSize={pageSize}
      total={total}
      pageSizeOptions={PAGE_SIZES}
      disabled={pending}
      onPageChange={(p) => actions.navigate({ pagina: String(p) })}
      onPageSizeChange={(size) => actions.navigate({ por_pagina: String(size), pagina: null })}
      label={label}
    />
  );
}

export function KmStaleBadge({ ageDays, size = "sm" }: { ageDays?: number | null; size?: "sm" | "md" }) {
  return (
    <Badge size={size} variant="warning" appearance="outline" icon={<Clock />} title="KM oficial desatualizado: a situação é uma estimativa">
      KM desatualizado{ageDays != null ? ` · ${formatInt(ageDays)} d` : ""}
    </Badge>
  );
}

export function MonitoringBadge({ size = "sm" }: { size?: "sm" | "md" }) {
  return (
    <Badge size={size} variant="neutral" appearance="outline" icon={<Eye />}>
      Monitorando
    </Badge>
  );
}

/** "Verificação · formal" / "Histórico · não formal": o tipo de referência e se ela vale como fato. */
export function ReferenceBadge({ type, size = "sm" }: { type: string; size?: "sm" | "md" }) {
  const formal = REFERENCE_FORMAL[type];
  return (
    <Badge
      size={size}
      variant={formal ? "success" : type === "none" ? "neutral" : "warning"}
      appearance="outline"
      title={formal ? "Referência formal: verificação, manutenção ou baixa manual" : "Referência indicativa: não é verificação formal"}
    >
      {REFERENCE_TYPE_LABEL[type] ?? type}
      {formal === false && type !== "none" ? " · não formal" : ""}
    </Badge>
  );
}

/** Filtro de um insight (chaves da rotina) → parâmetros da URL da aba. */
export function insightPatch(filter: Record<string, unknown> | null, catalog: MaintenanceCatalog): Record<string, string | null> {
  const patch: Record<string, string | null> = { pagina: null };
  if (!filter) return patch;
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : []);
  if (filter.statuses) patch.pd_situacao = arr(filter.statuses).join(",") || null;
  if (filter.execution) patch.pd_execucao = arr(filter.execution).join(",") || null;
  if (filter.conformity) patch.pd_conformidade = arr(filter.conformity).join(",") || null;
  if (filter.cluster_ids) patch.cluster = arr(filter.cluster_ids).join(",") || null;
  if (filter.cluster_names) {
    const ids = arr(filter.cluster_names)
      .map((name) => catalog.clusters.find((c) => c.name === name)?.id)
      .filter((id): id is string => Boolean(id));
    if (ids.length) patch.cluster = ids.join(",");
  }
  if (filter.operation_ids) patch.operacao = arr(filter.operation_ids).join(",") || null;
  if (filter.km_stale) patch.pd_km = "desatualizado";
  if (filter.monitoring) patch.pd_monitoramento = "1";
  if (filter.quality) {
    patch.pd_visao = "qualidade";
    patch.pd_inconsistencia = String(filter.quality);
  }
  if (!patch.pd_visao && (patch.pd_situacao || patch.pd_execucao || patch.pd_conformidade || patch.pd_km || patch.pd_monitoramento)) {
    patch.pd_visao = "alertas";
  }
  return patch;
}

const RANKING_PARAM: Record<PredictiveRankingKey, string> = {
  fleets: "veiculo",
  clusters: "cluster",
  models: "modelo",
  types: "equipamento",
  operations: "operacao",
  cities: "cidade",
  brs: "br",
  leaders: "lideranca",
};

/** Clique numa linha de ranking → filtro equivalente (e a visão de alertas). */
export function rankingPatch(key: PredictiveRankingKey, item: PredictiveRanking, current: string | undefined): Record<string, string | null> {
  const param = RANKING_PARAM[key];
  const same = current === item.key;
  return { [param]: same ? null : item.key, pagina: null, pd_visao: same ? null : "alertas" };
}

export function insightTone(tone: PredictiveInsight["tone"]): "success" | "warning" | "danger" | "info" | "neutral" {
  return tone;
}
