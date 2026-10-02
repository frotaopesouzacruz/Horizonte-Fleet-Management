import type { StatusTone } from "@/components/ui/status-badge";
import type { KmFleetCurrentRow } from "@/lib/km/fleet-current";
import { KM_CURRENT_FRESHNESS_LABEL, type KmCurrentFreshness } from "@/lib/km/types";

/**
 * KM atual das frotas — apresentação. Nada aqui decide atualização, dias ou
 * hodômetro: a rotina `km_fleet_current` devolve tudo pronto; a tela só
 * agrupa por operação, rotula e pinta.
 */

/** Acima disto, a leitura defasada é mostrada como crítica (só a cor; o código continua `stale`). */
export const STALE_CRITICAL_DAYS = 7;

export function freshnessTone(row: Pick<KmFleetCurrentRow, "freshness" | "daysSince">): StatusTone {
  if (row.freshness === "recent") return "success";
  if (row.freshness === "never") return "neutral";
  return (row.daysSince ?? 0) > STALE_CRITICAL_DAYS ? "danger" : "warning";
}

export const freshnessLabel = (code: KmCurrentFreshness) => KM_CURRENT_FRESHNESS_LABEL[code];

/** Origem da leitura vigente, nas palavras dos módulos que a gravam. */
const SOURCE_LABEL: Record<string, string> = {
  initial_registration: "Cadastro inicial",
  manual_correction: "Correção manual",
  import: "Importação de frotas",
  checklist: "Check List",
  fuelling: "Abastecimento",
  maintenance: "Manutenção",
  telemetry: "Telemetria",
};

export function sourceLabel(row: Pick<KmFleetCurrentRow, "source" | "fromKmModule">): string | null {
  if (!row.source) return null;
  if (row.fromKmModule) return "Gestão de KM";
  return SOURCE_LABEL[row.source] ?? row.source;
}

export function localLabel(row: Pick<KmFleetCurrentRow, "city" | "state">): string {
  if (row.city && row.state) return `${row.city} · ${row.state}`;
  return row.city ?? row.state ?? "—";
}

export interface OperationGroup {
  key: string;
  label: string;
  /** Sem operação no contexto de hoje (Fidelização, alocação ou Lideranças). */
  missing: boolean;
  rows: KmFleetCurrentRow[];
  recent: number;
  stale: number;
  never: number;
}

/** Agrupa na ordem em que a rotina devolveu (operação A–Z, "Sem operação" por último). */
export function groupByOperation(rows: KmFleetCurrentRow[]): OperationGroup[] {
  const groups = new Map<string, OperationGroup>();
  for (const row of rows) {
    const key = row.operationId ?? "-";
    let group = groups.get(key);
    if (!group) {
      group = { key, label: row.operation ?? "Sem operação", missing: !row.operationId, rows: [], recent: 0, stale: 0, never: 0 };
      groups.set(key, group);
    }
    group.rows.push(row);
    group[row.freshness] += 1;
  }
  return [...groups.values()];
}

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

/** Busca local da tela (placa, frota, tipo, carroceria, modelo, cidade) — só apresentação. */
export function matchesSearch(row: KmFleetCurrentRow, query: string): boolean {
  const q = norm(query).replace(/[^A-Z0-9]/g, "");
  if (!q) return true;
  const plate = norm(row.plate).replace(/[^A-Z0-9]/g, "");
  if (plate.includes(q)) return true;
  const fleet = norm(row.fleetCode).replace(/[^A-Z0-9]/g, "");
  if (fleet.includes(q)) return true;
  const text = norm(`${row.type ?? ""} ${row.subcategory ?? ""} ${row.model ?? ""} ${row.city ?? ""} ${row.operation ?? ""}`);
  return text.includes(norm(query));
}
