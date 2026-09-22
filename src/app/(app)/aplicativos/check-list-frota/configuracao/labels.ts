import type { BadgeVariant } from "@/components/ui/badge";
import type {
  ConditionalFieldType,
  RuleKind,
  RuleMode,
  VersionStatus,
} from "@/lib/applications/admin-queries";
import type { Answer, Criticality } from "@/lib/applications/queries";

/** Rótulos e formatadores compartilhados pelo editor (§45–§47). */

export const STATUS_LABEL: Record<VersionStatus, string> = {
  draft: "Rascunho",
  published: "Publicada",
  archived: "Arquivada",
};

export const STATUS_VARIANT: Record<VersionStatus, BadgeVariant> = {
  draft: "warning",
  published: "success",
  archived: "neutral",
};

export const ANSWER_LABEL: Record<Answer, string> = { yes: "SIM", no: "NÃO" };

export const CRITICALITY_LABEL: Record<Criticality, string> = { media: "Média", critica: "Crítica" };

export const FIELD_TYPE_LABEL: Record<ConditionalFieldType, string> = {
  text: "Texto livre",
  single_select: "Escolha única",
  multi_select: "Múltipla escolha",
};

export const RULE_KIND_LABEL: Record<RuleKind, string> = {
  vehicle_type: "Tipo de equipamento",
  vehicle_subcategory: "Subcategoria",
  operation: "Operação",
};

export const RULE_MODE_LABEL: Record<RuleMode, string> = {
  include: "Aplica-se apenas a",
  exclude: "Não se aplica a",
  guidance: "Orientação para",
};

/** §47: o formato aceito pelo banco para a identidade técnica. */
export const KEY_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateTime.format(date);
}

/** Mesma derivação de chave do banco (`private.checklist_slug`), para a prévia. */
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Opções digitadas como texto separado por vírgula ou quebra de linha. */
export function parseOptions(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
