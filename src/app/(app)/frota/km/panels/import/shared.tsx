"use client";

import * as React from "react";
import type { StatusTone } from "@/components/ui/status-badge";
import { cn } from "@/lib/cn";
import { fmtInt } from "@/lib/km/types";

/**
 * Catálogos e peças comuns às abas Importação e Lotes da Gestão de KM.
 * Rótulos dos códigos gravados pelo pipeline (`import_errors.code`,
 * `import_batches.status`); os números vêm sempre do banco.
 */

export const KM_BATCH_STATUS: Record<string, { label: string; tone: StatusTone; hint: string }> = {
  draft: { label: "Rascunho", tone: "pending", hint: "Linhas no staging; a prévia ainda não foi montada." },
  validated: { label: "Validado", tone: "info", hint: "Prévia pronta, aguardando confirmação." },
  processing: { label: "Gravando", tone: "progress", hint: "Consolidação iniciada e não concluída; pode ser continuada." },
  completed: { label: "Concluído", tone: "success", hint: "Leituras consolidadas no razão diário." },
  failed: { label: "Falhou", tone: "danger", hint: "A gravação parou com erro." },
  cancelled: { label: "Cancelado", tone: "neutral", hint: "Descartado sem gravar no razão." },
};

export const kmBatchStatus = (code: string | null | undefined) =>
  KM_BATCH_STATUS[code ?? ""] ?? { label: code || "—", tone: "neutral" as StatusTone, hint: "" };

/** Lote aberto: ainda pode ser retomado (prévia / gravação) ou cancelado. */
export const isOpenBatch = (status: string | null | undefined) =>
  status === "draft" || status === "validated" || status === "processing";
export const isCancellableBatch = (status: string | null | undefined) => status === "draft" || status === "validated";

export const KM_SOURCE_LABEL: Record<string, string> = {
  manual_xlsx: "Planilha (manual)",
};
export const kmSourceLabel = (code: string | null | undefined) => (code ? KM_SOURCE_LABEL[code] ?? code : "—");

export interface KmFindingMeta {
  label: string;
  level: "error" | "warning";
  description: string;
}

/** Achados do pipeline: erro bloqueia a linha (e a confirmação); aviso não. */
export const KM_FINDING: Record<string, KmFindingMeta> = {
  missing_plate: { label: "Placa vazia", level: "error", description: "Linha sem placa." },
  unregistered_plate: {
    label: "Placa não cadastrada",
    level: "error",
    description: "Placa fora do Cadastro de Frotas. A importação não cria veículos.",
  },
  archived_vehicle: { label: "Veículo arquivado", level: "error", description: "Veículo arquivado no cadastro." },
  missing_date: { label: "Data vazia", level: "error", description: "Linha sem data." },
  invalid_date: { label: "Data inválida", level: "error", description: "Data que não pôde ser lida." },
  invalid_number: {
    label: "Número inválido",
    level: "error",
    description: "Hodômetro ou KM com texto no lugar de número.",
  },
  future_date: {
    label: "Data futura com hodômetro",
    level: "error",
    description: "Leitura de hodômetro em data posterior a hoje.",
  },
  duplicate_conflict: {
    label: "Duplicidade conflitante",
    level: "error",
    description: "Mesma placa e data repetidas com valores diferentes: nenhuma é gravada.",
  },
  duplicate_identical: {
    label: "Duplicidade idêntica",
    level: "warning",
    description: "Mesma placa e data repetidas com os mesmos valores: a primeira vale.",
  },
  inconsistent: {
    label: "Inconsistente",
    level: "warning",
    description: "Final menor que o inicial ou só um hodômetro: o KM não entra nos totais.",
  },
  km_divergence: {
    label: "Divergência de KM",
    level: "warning",
    description: "KM informado difere do calculado pelos hodômetros; vale o calculado.",
  },
  high_mileage: { label: "Alta rodagem", level: "warning", description: "KM do dia acima do limite configurado." },
  odometer_regression: {
    label: "Hodômetro regressivo",
    level: "warning",
    description: "Inicial abaixo do final do dia anterior: leitura pendente de análise.",
  },
  odometer_jump: {
    label: "Salto de hodômetro",
    level: "warning",
    description: "Inicial muito acima do final do dia anterior.",
  },
  registry_divergence: {
    label: "Divergência cadastral",
    level: "warning",
    description: "Frota, Tipo ou Modelo da planilha diferem do cadastro. O cadastro não é alterado.",
  },
  inactive_vehicle: {
    label: "Veículo inativo com leitura",
    level: "warning",
    description: "Veículo com situação diferente de ativo no cadastro e com leitura no dia.",
  },
  manual_correction_kept: {
    label: "Correção manual preservada",
    level: "warning",
    description: "Leitura corrigida no HFM; a planilha não a sobrescreve.",
  },
};

export const kmFindingLabel = (code: string | null | undefined) => (code ? KM_FINDING[code]?.label ?? code : "—");

export const KM_LEVEL: Record<string, { label: string; tone: StatusTone }> = {
  error: { label: "Erro", tone: "danger" },
  warning: { label: "Aviso", tone: "warning" },
  info: { label: "Informação", tone: "info" },
};

/** "77733ea55bb1…" — o hash inteiro fica no title. */
export const shortHash = (hash: string | null | undefined) => (hash ? `${hash.slice(0, 12)}…` : "—");

const sizeFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
export function fmtBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${sizeFmt.format(bytes / 1024)} KB`;
  return `${sizeFmt.format(bytes / (1024 * 1024))} MB`;
}

/** Número de linhas (inteiro pt-BR); null/indefinido vira "—". */
export const fmtCount = (v: number | null | undefined) => fmtInt(v ?? null);

export type StatTone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

const STAT_VALUE: Record<StatTone, string> = {
  neutral: "text-fg",
  primary: "text-primary-soft-fg",
  success: "text-success-soft-fg",
  info: "text-info-soft-fg",
  warning: "text-warning-soft-fg",
  danger: "text-danger",
};

/**
 * Contador compacto da prévia. O tom de alerta só acende com valor > 0; o
 * rótulo sempre diz o que é (cor nunca é a única informação).
 */
export function Stat({
  label,
  value,
  tone = "neutral",
  hint,
  testId,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: StatTone;
  hint?: React.ReactNode;
  testId?: string;
  className?: string;
}) {
  const numeric = typeof value === "number" ? value : null;
  const lit = tone === "warning" || tone === "danger" ? (numeric ?? 1) > 0 : true;
  return (
    <div
      className={cn("flex min-w-0 flex-col gap-0.5 rounded-md border border-border bg-surface px-3 py-2", className)}
      data-testid={testId}
    >
      <dt className="truncate text-caption text-fg-muted" title={typeof label === "string" ? label : undefined}>
        {label}
      </dt>
      <dd className={cn("text-h3 font-semibold tabular-nums", lit ? STAT_VALUE[tone] : "text-fg")}>
        {numeric !== null ? fmtInt(numeric) : value}
      </dd>
      {hint != null ? <dd className="truncate text-caption text-fg-muted">{hint}</dd> : null}
    </div>
  );
}

/** Lista de fatos (rótulo → valor) do cabeçalho de um lote ou prévia. */
export function FactList({ items, className }: { items: { label: string; value: React.ReactNode; title?: string }[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-3", className)}>
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-col">
          <dt className="text-caption text-fg-muted">{item.label}</dt>
          <dd className="min-w-0 truncate text-body-sm font-medium text-fg" title={item.title}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
