"use client";

import { StatusBadge } from "@/components/ui/status-badge";
import {
  AUDIT_CATEGORY_LABEL,
  AUDIT_SEVERITY_LABEL,
  AUDIT_SEVERITY_TONE,
  GROUP_BY_LABEL,
  type AuditCategory,
  type AuditGroupBy,
  type AuditSeverity,
  type TireAuditScan,
  type TiresAuditCenter,
} from "@/lib/tires/types";

/**
 * Vocabulário comum da Central de Auditoria dos Dados de Pneus: rótulos de
 * gravidade, categoria, gatilho da varredura e agrupamento. As regras, as
 * contagens e a situação de cada achado vêm prontas do banco
 * (`tires_audit_center`); aqui só há apresentação.
 */
export const TID = "tires-audit";

export type AuditStatusFilter = TiresAuditCenter["filters"]["status"];

export const AUDIT_CATEGORIES = Object.keys(AUDIT_CATEGORY_LABEL) as AuditCategory[];
export const AUDIT_SEVERITIES: AuditSeverity[] = ["critica", "alta", "media", "baixa"];
export const AUDIT_GROUPS: AuditGroupBy[] = ["rule", "category", "severity", "operation", "city", "leader"];

export const AUDIT_GROUP_LABEL: Record<AuditGroupBy, string> = {
  rule: "Regra",
  category: "Categoria",
  severity: "Gravidade",
  operation: GROUP_BY_LABEL.operation,
  city: GROUP_BY_LABEL.city,
  leader: GROUP_BY_LABEL.leader,
};

export const AUDIT_STATUS_LABEL: Record<AuditStatusFilter, string> = {
  aberta: "Abertas",
  resolvida: "Resolvidas",
  todas: "Todas",
};

export const SCAN_TRIGGER_LABEL: Record<TireAuditScan["trigger"], string> = {
  confirmacao: "Confirmação dos dados",
  agendada: "Agendada",
  manual: "Manual",
};

export const SCAN_STATUS_LABEL: Record<TireAuditScan["status"], string> = {
  em_andamento: "Em andamento",
  concluida: "Concluída",
  falhou: "Falhou",
};

/** A varredura gravada traz também reaberturas e a mensagem de falha. */
export type AuditScan = TireAuditScan & { reopened?: number | null; errorMessage?: string | null };

export const categoryLabel = (code: string | null | undefined) =>
  code ? (AUDIT_CATEGORY_LABEL[code as AuditCategory] ?? code) : "—";
export const severityLabel = (code: string | null | undefined) =>
  code ? (AUDIT_SEVERITY_LABEL[code as AuditSeverity] ?? code) : "—";
export const isSeverity = (v: string | null | undefined): v is AuditSeverity => !!v && v in AUDIT_SEVERITY_LABEL;
export const isCategory = (v: string | null | undefined): v is AuditCategory => !!v && v in AUDIT_CATEGORY_LABEL;

/** Gravidade em texto e cor (a cor nunca é a única informação). */
export function SeverityBadge({ severity, size = "sm" }: { severity: AuditSeverity; size?: "sm" | "md" }) {
  return (
    <StatusBadge status={AUDIT_SEVERITY_TONE[severity] ?? "neutral"} size={size} withIcon data-severity={severity}>
      {AUDIT_SEVERITY_LABEL[severity] ?? severity}
    </StatusBadge>
  );
}

/** Rótulo do grupo: categoria e gravidade chegam como código; o resto, como nome. */
export function groupLabel(groupBy: AuditGroupBy, group: { key: string; label: string }): string {
  if (groupBy === "category") return categoryLabel(group.key);
  if (groupBy === "severity") return severityLabel(group.key);
  return group.label;
}
