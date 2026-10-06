"use client";

import * as React from "react";
import { Lock } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import type { AxlePosition } from "@/components/tires/axle-diagram";
import type { Result } from "@/lib/tires/actions";
import {
  AXLE_LABEL, fmtNum, TIRES_PERMISSION_CODES, type AxleGroup, type TirePosition, type TirePressureRule, type TiresTone,
} from "@/lib/tires/types";

/**
 * Peças comuns da aba Parâmetros: leitura dos números digitados em pt-BR,
 * validação espelhando as checagens das tabelas (o banco continua sendo quem
 * decide), execução de uma ação com toast e os rótulos de vigência/eixo.
 */

// ---------------------------------------------------------------------------
// Números digitados
// ---------------------------------------------------------------------------
/** "1,6" / "20" → número; vazio → null; qualquer outra coisa → NaN (sem sinal: só positivos). */
export function parseNumber(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  if (!/^\d+([.,]\d+)?$/.test(t)) return Number.NaN;
  return Number(t.replace(",", "."));
}

const decimalsOf = (raw: string) => raw.trim().match(/[.,](\d+)$/)?.[1].length ?? 0;

/** Número → texto do campo em pt-BR ("0,1"). */
export const numberText = (v: number | null | undefined) => (v == null ? "" : String(v).replace(".", ","));

export interface NumberRule {
  integer?: boolean;
  min?: number;
  /** `min` exclusivo (maior que). */
  above?: boolean;
  max?: number;
  /** Casas decimais aceitas pela coluna (numeric(p,2) → 2). */
  decimals?: number;
  optional?: boolean;
}

export function numberError(raw: string, rule: NumberRule): string | undefined {
  const v = parseNumber(raw);
  if (v === null) return rule.optional ? undefined : "Obrigatório.";
  if (Number.isNaN(v)) return rule.integer ? "Use um número inteiro, sem sinal." : "Use um número positivo (ex.: 1,6).";
  if (rule.integer && !Number.isInteger(v)) return "Use um número inteiro.";
  if (!rule.integer && rule.decimals != null && decimalsOf(raw) > rule.decimals) return `No máximo ${rule.decimals} casas decimais.`;
  if (rule.min != null && (rule.above ? v <= rule.min : v < rule.min)) {
    return rule.above ? `Deve ser maior que ${fmtNum(rule.min)}.` : `Mínimo ${fmtNum(rule.min)}.`;
  }
  if (rule.max != null && v > rule.max) return `Máximo ${fmtNum(rule.max)}.`;
  return undefined;
}

/** Mesma normalização das chaves do banco (`private.tire_dimension_key` / `tire_position_key`). */
export const dimensionKey = (v: string | null | undefined) => (v ?? "").toUpperCase().replace(/[^A-Z0-9/.]/g, "") || null;
export const positionKey = (v: string | null | undefined) => (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "") || null;

/** Dia anterior de uma data ISO (yyyy-mm-dd), sem fuso. */
export function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Ação com toast
// ---------------------------------------------------------------------------
/**
 * Executa uma ação do servidor marcando `busy` com a chave da linha/diálogo;
 * erro do banco (já em português) vira toast; sucesso → toast + refresh.
 */
export function useParamAction(onDone: () => void) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  const run = React.useCallback(
    async (
      key: string,
      action: () => Promise<Result<unknown>>,
      messages: { success: string; successDescription?: string; failure: string },
    ): Promise<boolean> => {
      setBusy(key);
      let r: Result<unknown>;
      try {
        r = await action();
      } catch {
        r = { ok: false, error: "Falha de comunicação com o servidor. Tente de novo." };
      } finally {
        setBusy(null);
      }
      if (!r.ok) {
        toast({ title: messages.failure, description: r.error, variant: "danger" });
        return false;
      }
      toast({ title: messages.success, description: messages.successDescription, variant: "success" });
      onDone();
      return true;
    },
    [toast, onDone],
  );
  return { busy, run };
}

// ---------------------------------------------------------------------------
// Avisos
// ---------------------------------------------------------------------------
export function ReadOnlyNotice() {
  return (
    <Alert variant="neutral" icon={<Lock />} data-testid="tires-param-readonly">
      <AlertTitle>Somente leitura</AlertTitle>
      <AlertDescription>
        Você pode consultar prazos, regras de PSI, posições, layouts, vínculos, a fonte oficial e a agenda dos indicadores, mas alterá-los exige a permissão{" "}
        <span className="font-mono text-caption">{TIRES_PERMISSION_CODES.parameters}</span>.
      </AlertDescription>
    </Alert>
  );
}

// ---------------------------------------------------------------------------
// Vigência das regras de PSI
// ---------------------------------------------------------------------------
export type RuleState = "vigente" | "futura" | "encerrada" | "inativa";
export const RULE_STATE_LABEL: Record<RuleState, string> = {
  vigente: "Vigente",
  futura: "Futura",
  encerrada: "Encerrada",
  inativa: "Inativa",
};
export const RULE_STATE_TONE: Record<RuleState, TiresTone> = {
  vigente: "success",
  futura: "info",
  encerrada: "neutral",
  inativa: "neutral",
};

export function ruleState(r: Pick<TirePressureRule, "isActive" | "validFrom" | "validTo">, today: string): RuleState {
  if (!r.isActive) return "inativa";
  if (r.validFrom > today) return "futura";
  if (r.validTo && r.validTo < today) return "encerrada";
  return "vigente";
}

// ---------------------------------------------------------------------------
// Posições e eixos
// ---------------------------------------------------------------------------
export const toAxle = (p: TirePosition): AxlePosition => ({
  code: p.code,
  label: p.label,
  axleGroup: p.axleGroup,
  axleIndex: p.axleIndex,
  side: p.side,
  slot: p.slot,
  sortOrder: p.sortOrder,
});

const GROUP_RANK: Record<AxleGroup, number> = { front: 0, rear: 1, spare: 2, other: 3 };

export function axleTitle(group: AxleGroup, index: number): string {
  if (group === "spare") return index > 1 ? `Estepe ${index}` : "Estepe";
  if (group === "other") return "Outras posições";
  return `${AXLE_LABEL[group]} · eixo ${index}`;
}

/** Posições agrupadas por eixo, da frente para trás (estepe e outras no fim). */
export function groupByAxle(positions: TirePosition[]): { key: string; title: string; positions: TirePosition[] }[] {
  const map = new Map<string, { key: string; group: AxleGroup; index: number; title: string; positions: TirePosition[] }>();
  for (const p of positions) {
    const key = `${p.axleGroup}:${p.axleIndex}`;
    let g = map.get(key);
    if (!g) {
      g = { key, group: p.axleGroup, index: p.axleIndex, title: axleTitle(p.axleGroup, p.axleIndex), positions: [] };
      map.set(key, g);
    }
    g.positions.push(p);
  }
  return [...map.values()]
    .sort((a, b) => GROUP_RANK[a.group] - GROUP_RANK[b.group] || a.index - b.index)
    .map((g) => ({ key: g.key, title: g.title, positions: g.positions.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code)) }));
}

/** Texto do escopo de posição de uma regra de PSI. */
export function ruleScopeLabel(r: Pick<TirePressureRule, "positionCode" | "axleGroup">, positions: Map<string, TirePosition>): string {
  if (r.positionCode) {
    const p = positions.get(r.positionCode);
    return p ? `${r.positionCode} · ${p.label}` : r.positionCode;
  }
  if (r.axleGroup) return `Eixo ${AXLE_LABEL[r.axleGroup].toLowerCase()}`;
  return "Todas as posições";
}

export const normalizeText = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
