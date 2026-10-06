"use client";

import * as React from "react";
import {
  AlertTriangle, ChevronDown, ChevronRight, ChevronUp, Disc3, Hash, Layers, ListOrdered, Loader2, PackageX, Recycle, Ruler, Truck,
  Warehouse,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  ConformBadge, CriticalityBadge, VehicleCroqui, criticalityOf, croquiLayout, type CroquiTire,
} from "@/components/tires/vehicle-croqui";
import { NativeSelect } from "@/components/governance/selects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SegmentedControl, ToggleChip } from "@/components/ui/segmented-control";
import { StatusBadge, StatusDot } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { TiresTabData } from "@/lib/tires/loaders";
import {
  DEADLINE_LABEL, DEADLINE_SHORT, DEADLINE_TONE, GROUP_BY_LABEL, GROUP_BY_PARAM, LAYOUT_SOURCE_LABEL, PSI_LABEL, PSI_TONE,
  SEVERITY_LABEL, SEVERITY_TONE, STATUS_LABEL, STATUS_ORDER, STATUS_TONE, TREAD_LABEL, TREAD_TONE, fmtInt, fmtKm, fmtMm, fmtNum,
  fmtPct, formatDate, issueLabel, reasonLabel, type CanonicalStatus, type DeadlineStatus, type PsiStatus, type TireBaseGroup,
  type TireFleetGroup, type TirePositionInfo, type TireRow, type TiresBaseFleet, type TiresBaseGroups, type TiresBaseRows,
  type TiresBaseView, type TiresGroupBy, type TireVehicleLayout, type TiresTone, type TreadClass,
} from "@/lib/tires/types";
import { splitList, type TiresBaseSort } from "@/lib/tires/url";
import type { TiresPanelContext } from "../shared";
import {
  ExportButton, FireLink, PanelEmpty, PanelError, PlateLink, plural, Section, TiresKpi, TiresPagination, useTiresLink, useViewParam,
  type TiresNavLink,
} from "./tires-ui";

/**
 * Gestão de Pneus → Base geral.
 *
 * `tires_base` devolve a página já filtrada, ordenada e avaliada (classe do
 * sulco, prazos, regra de PSI, severidade, criticidade e conformidade vêm do
 * banco). Três visões na URL (`visao`):
 * - por frota: pneus em uso agrupados por veículo, com o croqui real do
 *   veículo (montado do layout e do dicionário de posições). Por padrão as
 *   frotas vêm agrupadas (`agrupar` = operação | local | liderança | nenhum);
 *   cada grupo aberto (`abertos`, até 6) traz as suas frotas do servidor;
 * - por Nº Fogo: todos os pneus da base oficial (Rodopar);
 * - fora da frota: estoque, ressolagem, descarte e baixa.
 */
export function BasePanel({ data, ctx }: { data: TiresTabData["base"] | null; ctx: TiresPanelContext }) {
  if (ctx.error) return <PanelError ctx={ctx} title="Não foi possível carregar a Base geral." testId="tires-base-error" />;
  if (!data) {
    return (
      <PanelEmpty
        icon={<Disc3 />}
        title="Sem dados da Base geral"
        description="A rotina não devolveu a base. Recarregue a página."
        testId="tires-base-empty"
      />
    );
  }
  if (data.empty) {
    return (
      <PanelEmpty
        icon={<Disc3 />}
        title="Nenhum dado oficial disponível"
        description="A Base geral mostra a base oficial (Rodopar). Sincronize ou envie o relatório em Sincronização Rodopar para começar."
        testId="tires-base-no-photo"
      />
    );
  }
  return <BaseContent data={data} ctx={ctx} />;
}

const VIEW_OPTIONS: { value: TiresBaseView; label: string; icon: React.ReactNode }[] = [
  { value: "frota", label: "Por frota", icon: <Truck aria-hidden /> },
  { value: "fogo", label: "Por Nº Fogo", icon: <Hash aria-hidden /> },
  { value: "fora", label: "Fora da frota", icon: <Warehouse aria-hidden /> },
];

type BaseData = NonNullable<TiresTabData["base"]>;
type GroupByValue = TiresGroupBy | "nenhum";

/** Frota da Base Geral com a conformidade calculada no banco. */
type FleetGroup = TireFleetGroup & {
  nonconform?: number | null;
  conformPct?: number | null;
  operationId?: string | null;
  cityId?: number | null;
  leaderId?: string | null;
  tireRows: CroquiTire[];
};

/** Frotas da página (sem agrupamento) × resumo por grupo (com agrupamento). */
function splitGroups(data: BaseData): { fleets: FleetGroup[]; grouped: TiresBaseGroups | null } {
  const raw = (data as unknown as { groups?: unknown }).groups;
  const summary = data.groupSummary ?? null;
  if (summary && Array.isArray(summary.groups)) return { fleets: [], grouped: summary };
  return { fleets: Array.isArray(raw) ? (raw as FleetGroup[]) : [], grouped: null };
}

function BaseContent({ data, ctx }: { data: BaseData; ctx: TiresPanelContext }) {
  const view: TiresBaseView = data.view ?? "frota";
  const groupBy: GroupByValue = view === "frota" ? (data.groupBy ?? "nenhum") : "nenhum";
  const sort = ctx.params.ordem ?? null;
  const dir = ctx.params.dir === "desc" ? "desc" : "asc";

  const changeView = (v: TiresBaseView) =>
    ctx.navigate({ visao: v === "frota" ? null : v, pagina: null, ordem: null, dir: null, grupo: null, abertos: null });

  return (
    <div className="flex flex-col gap-5" data-testid="tires-base" data-view={view} data-group-by={groupBy}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl<TiresBaseView>
          aria-label="Visão da Base geral"
          value={view}
          onValueChange={changeView}
          disabled={ctx.pending}
          wrap
          options={VIEW_OPTIONS.map((o) => ({ ...o, "data-testid": `tires-base-view-${o.value}` }))}
          data-testid="tires-base-view"
        />
        <div className="flex flex-wrap items-center gap-2">
          {view === "frota" ? (
            <>
              <GroupBySelect ctx={ctx} value={groupBy} />
              <FleetSort ctx={ctx} />
            </>
          ) : null}
          <ExportButton ctx={ctx} kind="base" extra={{ visao: view, ordem: sort, dir: sort ? dir : null }} testId="tires-base-export" />
        </div>
      </div>

      <p className="text-body-sm text-fg-muted" data-testid="tires-base-photo">
        Base oficial (Rodopar), dados de{" "}
        <span className="font-medium text-fg-secondary tabular-nums">{formatDate(data.referenceDate)}</span> · prazos contados em{" "}
        <span className="font-medium text-fg-secondary tabular-nums">{formatDate(data.asOf)}</span>
        {view === "fora" ? " · estoque, ressolagem, descarte e baixa" : null}
        <span className="sr-only">. A vistoria de campo não altera a base oficial.</span>
      </p>

      {data.view === "fogo" || data.view === "fora" ? (
        <RowsView data={data} ctx={ctx} />
      ) : (
        <FleetView data={data} groupBy={groupBy} positions={data.positions ?? []} ctx={ctx} />
      )}
    </div>
  );
}

const GROUP_OPTIONS: { value: GroupByValue; label: string }[] = [
  { value: "operation", label: GROUP_BY_LABEL.operation },
  { value: "city", label: GROUP_BY_LABEL.city },
  { value: "leader", label: GROUP_BY_LABEL.leader },
  { value: "nenhum", label: "Sem agrupamento" },
];

function GroupBySelect({ ctx, value }: { ctx: TiresPanelContext; value: GroupByValue }) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-caption text-fg-muted">Agrupar por</span>
      <NativeSelect
        fieldSize="sm"
        value={value}
        disabled={ctx.pending}
        onChange={(e) => {
          const v = e.target.value as GroupByValue;
          // operação é o padrão (sem parâmetro); trocar o agrupamento fecha os grupos e volta à 1ª página
          ctx.navigate({
            agrupar: v === "operation" ? null : v === "nenhum" ? "nenhum" : GROUP_BY_PARAM[v],
            abertos: null,
            grupo: null,
            pagina: null,
          });
        }}
        className="w-auto min-w-44"
        data-testid="tires-base-groupby"
      >
        {GROUP_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}
// ---------------------------------------------------------------------------
// Peças compartilhadas (também usadas na ficha 360°)
// ---------------------------------------------------------------------------

/** Data/hora do Rodopar (sem fuso: hora local do relatório) → "dd/mm/aaaa hh:mm". */
export function fmtRodoparStamp(value: string | null | undefined): string {
  if (!value) return "—";
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return value;
  return m[4] && !(m[4] === "00" && m[5] === "00") ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : `${m[3]}/${m[2]}/${m[1]}`;
}

export function TreadClassBadge({ value, size = "sm" }: { value: TreadClass; size?: "sm" | "md" }) {
  return (
    <StatusBadge status={TREAD_TONE[value]} size={size} data-testid="tires-tread-class">
      {TREAD_LABEL[value]}
    </StatusBadge>
  );
}

export function SeverityBadge({ value, size = "sm", withLabel = false }: { value: TireRow["severity"]; size?: "sm" | "md"; withLabel?: boolean }) {
  return (
    <StatusBadge status={SEVERITY_TONE[value]} size={size} data-testid="tires-severity">
      {withLabel ? `Severidade: ${SEVERITY_LABEL[value].toLowerCase()}` : SEVERITY_LABEL[value]}
    </StatusBadge>
  );
}

export function TireStatusBadge({ value, size = "sm" }: { value: CanonicalStatus; size?: "sm" | "md" }) {
  return (
    <StatusBadge status={STATUS_TONE[value]} size={size} data-testid="tires-status">
      {STATUS_LABEL[value]}
    </StatusBadge>
  );
}

/** Prazo de medição/calibragem: data, dias desde o registro e situação (sempre com rótulo). */
export function DeadlineCell({ date, days, status, compact = false }: {
  date: string | null;
  days: number | null;
  status: DeadlineStatus;
  compact?: boolean;
}) {
  return (
    <span className="flex flex-col items-start gap-0.5 leading-tight">
      {date ? <span className="tabular-nums text-fg">{formatDate(date)}</span> : null}
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <StatusBadge status={DEADLINE_TONE[status]} size="sm" title={DEADLINE_LABEL[status]}>
          {compact ? DEADLINE_SHORT[status] : DEADLINE_LABEL[status]}
        </StatusBadge>
        {days != null ? (
          <span className="text-caption tabular-nums text-fg-muted">{days === 0 ? "hoje" : `${fmtInt(days)} ${plural(days, "dia", "dias")}`}</span>
        ) : null}
      </span>
    </span>
  );
}

/** PSI lido, faixa da regra aplicável (ou "sem parâmetro") e situação. */
export function PsiCell({ psi, min, max, status }: { psi: number | null; min: number | null; max: number | null; status: PsiStatus }) {
  return (
    <span className="flex flex-col items-start gap-0.5 leading-tight">
      <span className="tabular-nums text-fg">
        {psi == null ? "—" : fmtNum(psi)}
        <span className="text-caption text-fg-muted">
          {" · "}
          {min != null && max != null ? `faixa ${fmtNum(min)}–${fmtNum(max)}` : "sem parâmetro"}
        </span>
      </span>
      <StatusBadge status={PSI_TONE[status]} size="sm">
        {PSI_LABEL[status]}
      </StatusBadge>
    </span>
  );
}

/** Sulco mínimo; quando o informado pelo Rodopar difere do calculado, ícone + texto. */
export function TreadMinCell({ row }: { row: Pick<TireRow, "treadMin" | "treadMinRaw" | "treadMinCalculated" | "treadDivergence"> }) {
  if (!row.treadDivergence) return <span className="tabular-nums">{fmtMm(row.treadMin)}</span>;
  const detail = `Menor informado ${fmtMm(row.treadMinRaw)} ≠ calculado dos sulcos ${fmtMm(row.treadMinCalculated)}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="inline-flex items-center gap-1 rounded-xs tabular-nums hfm-focus-ring"
          data-testid="tires-tread-divergence"
        >
          {fmtMm(row.treadMin)}
          <AlertTriangle aria-hidden className="size-3.5 text-warning" />
          <span className="text-caption font-medium text-warning-soft-fg">divergente</span>
          <span className="sr-only">. {detail}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        {detail}
      </TooltipContent>
    </Tooltip>
  );
}

/** KM real; negativo é problema de qualidade do relatório (sinalizado, nunca somado). */
export function KmRealCell({ value }: { value: number | null }) {
  if (value == null || value >= 0) return <span className="tabular-nums">{fmtKm(value)}</span>;
  return (
    <span className="inline-flex items-center gap-1 tabular-nums text-danger" title="KM Real negativo no Rodopar: problema de qualidade do dado; não entra em nenhuma soma." data-testid="tires-km-negative">
      <AlertTriangle aria-hidden className="size-3.5" />
      {fmtKm(value)}
      <span className="sr-only"> — valor negativo no Rodopar, problema de qualidade do dado; não entra em nenhuma soma</span>
    </span>
  );
}

/** Alerta de ressolagem e inconsistências do registro, ao lado do Nº Fogo. */
function RowFlags({ row }: { row: Pick<TireRow, "retreadAlert" | "qualityFlags"> }) {
  const flags = row.qualityFlags ?? [];
  if (!row.retreadAlert && flags.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1">
      {row.retreadAlert ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className="inline-flex rounded-xs text-progress hfm-focus-ring" data-testid="tires-retread-flag">
              <Recycle aria-hidden className="size-3.5" />
              <span className="sr-only">Alerta de ressolagem</span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">Alerta de ressolagem (alerta operacional)</TooltipContent>
        </Tooltip>
      ) : null}
      {flags.length ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className="inline-flex rounded-xs text-warning hfm-focus-ring" data-testid="tires-quality-flag">
              <AlertTriangle aria-hidden className="size-3.5" />
              <span className="sr-only">Qualidade do dado: {flags.map(issueLabel).join("; ")}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <span className="flex flex-col gap-0.5">
              <span className="font-semibold">Qualidade do dado</span>
              {flags.map((f) => (
                <span key={f}>{issueLabel(f)}</span>
              ))}
            </span>
          </TooltipContent>
        </Tooltip>
      ) : null}
    </span>
  );
}

const placeText = (city: string | null, uf: string | null) => (city ? `${city}${uf ? `/${uf}` : ""}` : (uf ?? null));

// ---------------------------------------------------------------------------
// Visão por frota
// ---------------------------------------------------------------------------
const FLEET_STATUS: Record<TireFleetGroup["status"], { label: string; tone: TiresTone }> = {
  critico: { label: "Crítica", tone: "danger" },
  atencao: { label: "Atenção", tone: "warning" },
  ok: { label: "Sem pendência", tone: "success" },
};

const FLEET_SORTS: { value: string; label: string; sort: TiresBaseSort | null; dir: "asc" | "desc" }[] = [
  { value: "", label: "Mais graves primeiro", sort: null, dir: "asc" },
  { value: "tread", label: "Pior sulco", sort: "tread", dir: "asc" },
  { value: "fleet", label: "Frota (A–Z)", sort: "fleet", dir: "asc" },
  { value: "fleet:desc", label: "Frota (Z–A)", sort: "fleet", dir: "desc" },
  { value: "plate", label: "Placa (A–Z)", sort: "plate", dir: "asc" },
  { value: "operation", label: "Operação (A–Z)", sort: "operation", dir: "asc" },
];

function FleetSort({ ctx }: { ctx: TiresPanelContext }) {
  const current = ctx.params.ordem ? `${ctx.params.ordem}${ctx.params.dir === "desc" ? ":desc" : ""}` : "";
  const value = FLEET_SORTS.some((s) => s.value === current) ? current : "";
  return (
    <label className="flex items-center gap-2">
      <span className="text-caption text-fg-muted">Ordenar</span>
      <NativeSelect
        fieldSize="sm"
        value={value}
        disabled={ctx.pending}
        onChange={(e) => {
          const opt = FLEET_SORTS.find((s) => s.value === e.target.value) ?? FLEET_SORTS[0];
          ctx.navigate({ ordem: opt.sort, dir: opt.sort && opt.dir === "desc" ? "desc" : null, pagina: null });
        }}
        className="w-auto min-w-44"
        data-testid="tires-base-fleet-sort"
      >
        {FLEET_SORTS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}

/**
 * Frotas abertas ("Ver pneus e posições") na URL (`grupo`), sem nova consulta.
 * Sem escolha explícita, uma lista com uma única frota (ex.: link da placa)
 * já abre expandida.
 */
function useFleetExpansion() {
  const [param, setParam] = useViewParam("grupo");
  const explicit = React.useMemo(() => (param == null ? null : new Set(param.split(",").filter((k) => k && k !== "-"))), [param]);
  const isOpen = (key: string, single: boolean) => (explicit ? explicit.has(key) : single);
  const toggle = (key: string, single: boolean) => {
    const next = new Set(explicit ?? (single ? [key] : []));
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setParam(next.size ? [...next].join(",") : "-");
  };
  return { isOpen, toggle };
}
type FleetExpansion = ReturnType<typeof useFleetExpansion>;

const MAX_OPEN_GROUPS = 6;

/**
 * Grupos abertos na URL (`abertos`, até 6): cada um traz as suas frotas do
 * servidor. Enquanto a navegação corre, o grupo já aparece aberto (carregando).
 */
function useOpenGroups(ctx: TiresPanelContext, keys: string[]) {
  const server = ctx.params.abertos ?? "";
  const [local, setLocal] = React.useState<{ base: string; value: string } | null>(null);
  const value = local && local.base === server && ctx.pending ? local.value : server;
  const open = React.useMemo(() => splitList(value).slice(0, MAX_OPEN_GROUPS), [value]);
  const toggle = (key: string) => {
    // chaves que sumiram do recorte (filtros mudaram) não ocupam vaga
    const list = open.filter((k) => k !== key && keys.includes(k));
    if (!open.includes(key)) list.push(key);
    const next = list.slice(-MAX_OPEN_GROUPS).join(",");
    setLocal({ base: server, value: next });
    ctx.navigate({ abertos: next || null });
  };
  return { open, toggle };
}

function FleetView({ data, groupBy, positions, ctx }: {
  data: BaseData;
  groupBy: GroupByValue;
  positions: TirePositionInfo[];
  ctx: TiresPanelContext;
}) {
  const fleetData = data as unknown as TiresBaseFleet;
  const { fleets, grouped } = splitGroups(data);
  const expansion = useFleetExpansion();
  const summary = fleetData.summary;

  return (
    <>
      <Section
        title="Resumo das frotas"
        testId="tires-base-fleet-summary"
        description="Frotas com pneus em uso nos dados atuais. Crítica: algum pneu com sulco crítico ou abaixo do legal, ou medição vencida. Atenção: sulco em atenção, PSI fora da faixa, calibragem vencida ou medição/calibragem sem registro."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <TiresKpi kpi="base-fleets" label="Frotas no recorte" value={fmtInt(summary?.fleets)} icon={<Truck />} status="primary" />
          <TiresKpi
            kpi="base-fleets-critical"
            label="Frotas críticas"
            value={fmtInt(summary?.critical)}
            status={(summary?.critical ?? 0) > 0 ? "danger" : undefined}
            icon={<AlertTriangle />}
          />
          <TiresKpi
            kpi="base-fleets-attention"
            label="Frotas em atenção"
            value={fmtInt(summary?.attention)}
            status={(summary?.attention ?? 0) > 0 ? "warning" : undefined}
            icon={<Ruler />}
          />
          <TiresKpi kpi="base-fleets-ok" label="Frotas sem pendência" value={fmtInt(summary?.ok)} status="success" icon={<Layers />} />
          <TiresKpi kpi="base-fleets-tires" label="Pneus em uso" value={fmtInt(summary?.tires)} icon={<Disc3 />} />
        </div>
      </Section>

      {groupBy === "nenhum" ? (
        <Section
          title="Frotas"
          testId="tires-base-fleets"
          description="Abra uma frota para ver o croqui do veículo (montado do layout e do dicionário de posições) e os pneus montados."
        >
          {fleets.length === 0 && (fleetData.total ?? 0) > 0 ? (
            // o resumo conta frotas, mas a página delas não veio: nunca dizer "nenhum pneu"
            <PanelEmpty
              icon={<Truck />}
              title="A lista de frotas não veio do servidor"
              description="O resumo tem frotas no recorte, mas a página de frotas não foi devolvida. Recarregue a página."
              testId="tires-base-fleets-missing"
            />
          ) : fleets.length === 0 ? (
            <PanelEmpty
              icon={<Truck />}
              title="Nenhum pneu em uso no recorte"
              description="Nenhuma frota tem pneus em uso com os filtros atuais. Ajuste ou limpe os filtros da tela."
              testId="tires-base-fleets-empty"
            />
          ) : (
            <FleetList fleets={fleets} positions={positions} expansion={expansion} label="Frotas com pneus em uso" />
          )}
          <TiresPagination ctx={ctx} total={fleetData.total} limit={fleetData.limit} label="Paginação das frotas" testId="tires-base-fleet-pagination" />
        </Section>
      ) : (
        <GroupedFleets
          grouped={grouped}
          groupBy={groupBy}
          openGroups={data.openGroups ?? {}}
          positions={positions}
          expansion={expansion}
          ctx={ctx}
        />
      )}
    </>
  );
}

function FleetList({ fleets, positions, expansion, label }: {
  fleets: FleetGroup[];
  positions: TirePositionInfo[];
  expansion: FleetExpansion;
  label: string;
}) {
  const single = fleets.length === 1;
  return (
    <ul className="flex flex-col gap-3" aria-label={label}>
      {fleets.map((g) => (
        <li key={g.key}>
          <FleetCard group={g} positions={positions} expanded={expansion.isOpen(g.key, single)} onToggle={() => expansion.toggle(g.key, single)} />
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Por frota, agrupada (operação · local de operação · liderança)
// ---------------------------------------------------------------------------
function GroupedFleets({ grouped, groupBy, openGroups, positions, expansion, ctx }: {
  grouped: TiresBaseGroups | null;
  groupBy: TiresGroupBy;
  openGroups: Record<string, TiresBaseFleet>;
  positions: TirePositionInfo[];
  expansion: FleetExpansion;
  ctx: TiresPanelContext;
}) {
  const link = useTiresLink(ctx);
  const groups = React.useMemo(() => grouped?.groups ?? [], [grouped]);
  const { open, toggle } = useOpenGroups(ctx, groups.map((g) => g.key));
  const dim = GROUP_BY_LABEL[groupBy];

  /** "Ver todas": aplica o filtro global do grupo e desliga o agrupamento (lista paginada). */
  const allLink = (g: TireBaseGroup): TiresNavLink => {
    const param = GROUP_BY_PARAM[groupBy];
    const patch: Record<string, string | null> = { agrupar: "nenhum", abertos: null, grupo: null };
    if (g.id == null || g.key === "—") {
      const missing = new Set(splitList(ctx.filters.missing));
      missing.add(param);
      patch.sem = [...missing].join(",");
      patch[param] = null;
    } else {
      patch[param] = g.id;
    }
    return link(patch);
  };

  return (
    <Section
      title={`Frotas por ${dim.toLowerCase()}`}
      testId="tires-base-fleets"
      description={`Grupos do mais crítico para o menos crítico. Abra um grupo (até ${MAX_OPEN_GROUPS} ao mesmo tempo) para ver as frotas e, em cada frota, o croqui com os pneus e posições.`}
      actions={
        <span className="text-caption text-fg-muted tabular-nums">
          {fmtInt(groups.length)} {plural(groups.length, "grupo", "grupos")}
        </span>
      }
    >
      {groups.length === 0 ? (
        <PanelEmpty
          icon={<Truck />}
          title="Nenhum pneu em uso no recorte"
          description="Nenhuma frota tem pneus em uso com os filtros atuais. Ajuste ou limpe os filtros da tela."
          testId="tires-base-fleets-empty"
        />
      ) : (
        <ul className="flex flex-col gap-3" aria-label={`Frotas agrupadas por ${dim.toLowerCase()}`} data-testid="tires-base-groups">
          {groups.map((g) => (
            <li key={g.key}>
              <GroupCard
                group={g}
                dim={dim}
                open={open.includes(g.key)}
                fleetData={openGroups[g.key]}
                pending={ctx.pending}
                onToggle={() => toggle(g.key)}
                onRetry={ctx.refresh}
                allLink={allLink(g)}
                positions={positions}
                expansion={expansion}
              />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function GroupStat({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="text-body-sm font-semibold tabular-nums text-fg">{children}</dd>
    </div>
  );
}

/** % de conformidade geral (do banco) com barra de apoio; o número é a informação. */
function ConformityMeter({ pct }: { pct: number | null | undefined }) {
  if (pct == null) return <span className="text-fg-muted">—</span>;
  const width = Math.max(0, Math.min(100, pct));
  return (
    <span className="flex items-center gap-2">
      <span>{fmtPct(pct)}</span>
      <span aria-hidden className="h-1.5 w-14 overflow-hidden rounded-full bg-surface-sunken ring-1 ring-border-subtle ring-inset">
        <span className="block h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
      </span>
    </span>
  );
}

function FleetStatusCounts({ critical, attention, ok }: { critical: number; attention: number; ok: number }) {
  const items = [
    { n: critical, label: plural(critical, "crítica", "críticas"), tone: "danger" as const },
    { n: attention, label: "em atenção", tone: "warning" as const },
    { n: ok, label: "sem pendência", tone: "success" as const },
  ];
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-caption font-normal">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1 whitespace-nowrap">
          <StatusDot status={i.tone} size="sm" />
          <span className="font-semibold text-fg">{fmtInt(i.n)}</span>
          <span className="text-fg-secondary">{i.label}</span>
        </span>
      ))}
    </span>
  );
}

function GroupCard({ group: g, dim, open, fleetData, pending, onToggle, onRetry, allLink, positions, expansion }: {
  group: TireBaseGroup;
  dim: string;
  open: boolean;
  fleetData: TiresBaseFleet | undefined;
  pending: boolean;
  onToggle: () => void;
  onRetry: () => void;
  allLink: TiresNavLink;
  positions: TirePositionInfo[];
  expansion: FleetExpansion;
}) {
  const bodyId = React.useId();
  const fleets = (fleetData?.groups ?? null) as FleetGroup[] | null;
  const loading = open && !fleets && pending;
  return (
    <article
      className={cn(
        "flex flex-col rounded-lg border bg-surface-raised shadow-card",
        g.critical > 0 ? "border-danger/40" : g.attention > 0 ? "border-warning/40" : "border-border",
      )}
      data-testid="tires-base-group"
      data-key={g.key}
      data-open={open || undefined}
    >
      <div className="flex flex-col gap-3 p-3 sm:p-4 lg:flex-row lg:items-center lg:gap-6">
        <h3 className="min-w-0 lg:w-[19rem] lg:shrink-0">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={onToggle}
            className="-mx-1 flex min-h-11 w-[calc(100%+0.5rem)] items-center gap-2 rounded-md px-1 text-left hfm-transition hfm-focus-ring hover:bg-hover-overlay"
            data-testid="tires-base-group-toggle"
          >
            <ChevronRight aria-hidden className={cn("size-4 shrink-0 text-fg-muted hfm-transition", open && "rotate-90")} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-body font-semibold text-fg">{g.label}</span>
              <span className="text-caption font-normal text-fg-muted">{open ? "Ocultar frotas" : "Ver frotas"}</span>
            </span>
            <span className="sr-only"> — {dim}</span>
          </button>
        </h3>
        <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-4 xl:grid-cols-[repeat(4,minmax(0,auto))_minmax(0,1fr)] xl:gap-x-6">
          <GroupStat label="Frotas">{fmtInt(g.fleets)}</GroupStat>
          <GroupStat label="Pneus em uso">{fmtInt(g.tires)}</GroupStat>
          <GroupStat label="Não conformes">{fmtInt(g.nonconform)}</GroupStat>
          <GroupStat label="Conformidade geral">
            <ConformityMeter pct={g.conformPct} />
          </GroupStat>
          <GroupStat label="Situação das frotas" className="col-span-2 sm:col-span-4 xl:col-span-1">
            <FleetStatusCounts critical={g.critical} attention={g.attention} ok={g.ok} />
          </GroupStat>
        </dl>
      </div>

      {open ? (
        <div
          id={bodyId}
          className="flex flex-col gap-3 border-t border-border-subtle bg-surface px-3 py-3 sm:px-4"
          aria-busy={loading || undefined}
          data-testid="tires-base-group-fleets"
        >
          {fleets ? (
            fleets.length ? (
              <>
                <FleetList fleets={fleets} positions={positions} expansion={expansion} label={`Frotas de ${g.label}`} />
                {fleetData && fleetData.total > fleets.length ? (
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-fg-muted">
                    Mostrando {fmtInt(fleets.length)} de {fmtInt(fleetData.total)} frotas (as mais graves primeiro).
                    <Button asChild variant="link" size="sm">
                      <a href={allLink.href} onClick={allLink.onClick} data-testid="tires-base-group-all">
                        Ver todas as {fmtInt(fleetData.total)} frotas
                      </a>
                    </Button>
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-caption text-fg-muted">Nenhuma frota com pneus em uso neste grupo com os filtros atuais.</p>
            )
          ) : loading ? (
            <p className="flex items-center gap-2 text-caption text-fg-muted" role="status">
              <Loader2 aria-hidden className="size-4 animate-spin" />
              Carregando as frotas do grupo…
            </p>
          ) : (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-fg-secondary">
              Não foi possível carregar as frotas deste grupo.
              <Button type="button" variant="link" size="sm" onClick={onRetry}>
                Tentar de novo
              </Button>
            </p>
          )}
        </div>
      ) : null}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Cartão da frota (o mesmo com ou sem agrupamento)
// ---------------------------------------------------------------------------
interface FleetCountItem {
  count: number;
  label: string;
  tone: TiresTone;
}

/** Um bloco de contagens da frota: só as pendências que existem; nenhuma → "Nenhuma pendência". */
function FleetMetric({ label, items, foot, testId }: { label: string; items: FleetCountItem[]; foot?: React.ReactNode; testId?: string }) {
  const present = items.filter((i) => i.count > 0);
  return (
    <div className="flex min-w-0 flex-col gap-0.5" data-testid={testId}>
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="flex min-w-0 flex-col gap-0.5 text-caption">
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
          {present.length ? (
            present.map((i) => (
              <span key={i.label} className="inline-flex items-center gap-1 whitespace-nowrap tabular-nums">
                <StatusDot status={i.tone} size="sm" />
                <span className="font-semibold text-fg">{fmtInt(i.count)}</span>
                <span className="text-fg-secondary">{i.label}</span>
              </span>
            ))
          ) : (
            <span className="text-fg-muted">Nenhuma pendência</span>
          )}
        </span>
        {foot ? <span className="text-fg-muted tabular-nums">{foot}</span> : null}
      </dd>
    </div>
  );
}

const layoutText = (layout: TireVehicleLayout | null) =>
  layout
    ? `${layout.layoutName ?? "Sem layout cadastrado"} · ${LAYOUT_SOURCE_LABEL[layout.layoutSource] ?? layout.layoutSource}`
    : "Sem veículo identificado: posições dos dados Rodopar";

function FleetCard({ group: g, positions, expanded, onToggle }: {
  group: FleetGroup;
  positions: TirePositionInfo[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const st = FLEET_STATUS[g.status];
  const bodyId = React.useId();
  const context = [g.operationName, placeText(g.cityName, g.stateUf), g.brCode, g.leaderName].filter(Boolean).join(" · ");
  return (
    <article
      className={cn(
        "flex flex-col rounded-lg border bg-surface-raised shadow-card",
        g.status === "critico" ? "border-danger/40" : g.status === "atencao" ? "border-warning/40" : "border-border",
      )}
      data-testid="tires-base-fleet"
      data-status={g.status}
      data-key={g.key}
    >
      <div className="flex flex-col gap-3 p-3 sm:p-4 xl:flex-row xl:items-start xl:gap-6">
        <div className="flex min-w-0 flex-col gap-1 xl:w-[19rem] xl:shrink-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-body font-semibold">
              <PlateLink vehicleId={g.vehicleId} plate={g.licensePlate} fleetCode={g.fleetNumber} testId="tires-base-fleet-plate" />
            </h3>
            {g.vehicleTypeName ? (
              <Badge variant="neutral" appearance="outline" size="sm">
                {g.vehicleTypeName}
              </Badge>
            ) : null}
            <StatusBadge status={st.tone} size="sm" data-testid="tires-base-fleet-status">
              {st.label}
            </StatusBadge>
          </div>
          <p className="text-caption text-fg-secondary">{context || "Sem operação na data dos dados"}</p>
          {g.unitName ? <p className="text-caption text-fg-muted">Filial {g.unitName}</p> : null}
          {g.conformPct !== undefined || g.nonconform !== undefined ? (
            <p className="text-caption text-fg-secondary" data-testid="tires-base-fleet-conformity">
              Conformidade geral <span className="font-semibold tabular-nums text-fg">{fmtPct(g.conformPct ?? null)}</span>
              {g.nonconform != null ? (
                <span className="tabular-nums text-fg-muted">
                  {" · "}
                  {fmtInt(g.nonconform)} {plural(g.nonconform, "pneu não conforme", "pneus não conformes")}
                </span>
              ) : null}
            </p>
          ) : null}
        </div>

        <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-4">
          <FleetMetric
            label="Sulco"
            foot={`pior ${fmtMm(g.worstTread)}`}
            testId="tires-base-fleet-tread"
            items={[
              { count: g.belowLegal, label: "abaixo do legal", tone: "danger" },
              { count: g.critical - g.belowLegal, label: plural(g.critical - g.belowLegal, "crítico", "críticos"), tone: "danger" },
              { count: g.attention, label: "em atenção", tone: "warning" },
            ]}
          />
          <FleetMetric
            label="Pressão (PSI)"
            testId="tires-base-fleet-psi"
            items={[
              { count: g.psiOut, label: "fora da faixa", tone: "danger" },
              { count: g.psiNoRule, label: "sem parâmetro", tone: "pending" },
            ]}
          />
          <FleetMetric
            label="Medição"
            foot={g.oldestMeasurement ? `mais antiga ${formatDate(g.oldestMeasurement)}` : "sem medição registrada"}
            testId="tires-base-fleet-measurement"
            items={[
              { count: g.measurementOverdue, label: plural(g.measurementOverdue, "vencida", "vencidas"), tone: "danger" },
              { count: g.measurementMissing, label: "sem registro", tone: "pending" },
            ]}
          />
          <FleetMetric
            label="Calibragem"
            foot={g.oldestCalibration ? `mais antiga ${formatDate(g.oldestCalibration)}` : "sem calibragem registrada"}
            testId="tires-base-fleet-calibration"
            items={[
              { count: g.calibrationOverdue, label: plural(g.calibrationOverdue, "vencida", "vencidas"), tone: "warning" },
              { count: g.calibrationMissing, label: "sem registro", tone: "pending" },
            ]}
          />
        </dl>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle px-3 py-2 sm:px-4">
        <p className="min-w-0 text-caption text-fg-muted">
          <span className="font-medium text-fg-secondary tabular-nums">
            {fmtInt(g.tires)} {plural(g.tires, "pneu em uso", "pneus em uso")}
          </span>
          {" · "}Layout: {layoutText(g.layout)}
        </p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={onToggle}
          trailingIcon={expanded ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
          data-testid="tires-base-fleet-toggle"
        >
          {expanded ? "Ocultar pneus" : "Ver pneus e posições"}
          <span className="sr-only"> de {g.licensePlate ?? g.fleetNumber ?? "veículo"}</span>
        </Button>
      </div>

      {expanded ? (
        <div id={bodyId} className="flex flex-col gap-4 border-t border-border-subtle bg-surface px-3 py-4 sm:px-4" data-testid="tires-base-fleet-body">
          <FleetBody group={g} positions={positions} />
        </div>
      ) : null}
    </article>
  );
}

/** Croqui + tabela do veículo: tocar numa posição abre o pneu e destaca a linha correspondente. */
function FleetBody({ group: g, positions }: { group: FleetGroup; positions: TirePositionInfo[] }) {
  const [selected, setSelected] = React.useState<string | null>(null);
  const name = g.licensePlate ?? g.fleetNumber ?? "veículo";
  return (
    <>
      <div data-testid="tires-base-positions">
        <VehicleCroqui
          positions={positions}
          layout={croquiLayout(g.layout)}
          tires={g.tireRows}
          selected={selected}
          onSelectedChange={setSelected}
          label={`Croqui dos pneus de ${name}: posições do veículo`}
        />
      </div>
      <FleetTiresTable rows={g.tireRows} selected={selected} />
    </>
  );
}

/** Conformidade geral (do banco) + motivos; "—" quando a linha não a traz (pneu fora de uso). */
function ConformityCell({ row }: { row: CroquiTire }) {
  if (row.overallConform == null) return <span className="text-fg-muted">—</span>;
  const reasons = row.reasons ?? [];
  return (
    <span className="flex flex-col items-start gap-0.5 leading-tight">
      <ConformBadge value={row.overallConform} />
      {reasons.length ? (
        <span className="min-w-[10rem] max-w-[16rem] whitespace-normal text-fg-muted" data-testid="tires-reasons">
          {reasons.map(reasonLabel).join("; ")}
        </span>
      ) : null}
    </span>
  );
}

function FleetTiresTable({ rows, selected }: { rows: CroquiTire[]; selected: string | null }) {
  return (
    <TableContainer data-testid="tires-base-fleet-tires">
      <Table className="text-caption">
        <TableHeader>
          <TableRow>
            <TableHead>Posição</TableHead>
            <TableHead>Nº Fogo</TableHead>
            <TableHead numeric>S1</TableHead>
            <TableHead numeric>S2</TableHead>
            <TableHead numeric>S3</TableHead>
            <TableHead numeric>S4</TableHead>
            <TableHead>Mínimo</TableHead>
            <TableHead>Classe</TableHead>
            <TableHead>PSI</TableHead>
            <TableHead>Medição</TableHead>
            <TableHead>Calibragem</TableHead>
            <TableHead>Criticidade</TableHead>
            <TableHead>Conformidade</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableEmpty colSpan={13} message="Nenhum pneu em uso neste veículo." />
          ) : (
            rows.map((r) => (
              <TableRow
                key={r.snapshotId}
                className="h-auto"
                selected={selected != null && r.positionCode === selected}
                data-testid="tires-base-fleet-tire"
                data-position={r.positionCode ?? ""}
              >
                <TableCell className="py-1.5">
                  <span className="flex flex-col leading-tight">
                    <span className="font-semibold tabular-nums">{r.positionCode ?? "—"}</span>
                    {r.positionLabel && r.positionLabel !== r.positionCode ? <span className="text-fg-muted">{r.positionLabel}</span> : null}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap py-1.5">
                  <span className="inline-flex items-center gap-1.5">
                    <FireLink tireId={r.tireId} fireNumber={r.fireNumber} testId="tires-base-fire-link" />
                    <RowFlags row={r} />
                  </span>
                </TableCell>
                <TableCell numeric className="py-1.5">{fmtNum(r.tread1)}</TableCell>
                <TableCell numeric className="py-1.5">{fmtNum(r.tread2)}</TableCell>
                <TableCell numeric className="py-1.5">{fmtNum(r.tread3)}</TableCell>
                <TableCell numeric className="py-1.5">{fmtNum(r.tread4)}</TableCell>
                <TableCell className="whitespace-nowrap py-1.5 font-semibold"><TreadMinCell row={r} /></TableCell>
                <TableCell className="py-1.5"><TreadClassBadge value={r.treadClass} /></TableCell>
                <TableCell className="whitespace-nowrap py-1.5"><PsiCell psi={r.psi} min={r.psiMin} max={r.psiMax} status={r.psiStatus} /></TableCell>
                <TableCell className="whitespace-nowrap py-1.5"><DeadlineCell date={r.measurementDate} days={r.measurementDays} status={r.measurementStatus} compact /></TableCell>
                <TableCell className="whitespace-nowrap py-1.5"><DeadlineCell date={r.calibrationDate} days={r.calibrationDays} status={r.calibrationStatus} compact /></TableCell>
                <TableCell className="py-1.5"><CriticalityBadge value={criticalityOf(r)} /></TableCell>
                <TableCell className="py-1.5"><ConformityCell row={r} /></TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

// ---------------------------------------------------------------------------
// Visões por Nº Fogo e fora da frota
// ---------------------------------------------------------------------------
function RowsView({ data, ctx }: { data: TiresBaseRows; ctx: TiresPanelContext }) {
  const link = useTiresLink(ctx);
  const s = data.summary;
  const fora = data.view === "fora";
  const sort = (ctx.params.ordem as TiresBaseSort | undefined) ?? "fire_number";
  const dir: "asc" | "desc" = ctx.params.dir === "desc" ? "desc" : "asc";
  const statusFilter = ctx.filters.status ?? null;
  const statusCounts = [...data.statusCounts].sort((a, b) => STATUS_ORDER.indexOf(a.key) - STATUS_ORDER.indexOf(b.key));
  const countsTotal = statusCounts.reduce((acc, c) => acc + c.count, 0);

  return (
    <>
      <Section
        title={fora ? "Resumo fora da frota" : "Resumo dos dados"}
        testId="tires-base-summary"
        description={
          fora
            ? "Pneus da base oficial que não estão em uso. Prazos de medição e calibragem só valem para pneus em uso."
            : "Todos os pneus da base oficial no recorte. Prazos, PSI e conformidade contam só os pneus em uso; KM Real negativo e divergência de sulco são problemas de qualidade do relatório."
        }
      >
        <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3", fora ? "lg:grid-cols-5" : "sm:grid-cols-4 2xl:grid-cols-8")}>
          <TiresKpi
            kpi="base-total"
            label="Pneus no recorte"
            value={fmtInt(s.total)}
            period={fora ? undefined : `${fmtInt(s.inUse)} em uso`}
            icon={<Disc3 />}
            status="primary"
          />
          {fora ? null : (
            <>
              <TiresKpi
                kpi="base-measurement-overdue"
                label="Medição vencida"
                value={fmtInt(s.measurementOverdue)}
                period={`${fmtInt(s.measurementDueSoon)} próximas do vencimento`}
                status={s.measurementOverdue > 0 ? "danger" : undefined}
                nav={link({ medicao: "vencido" })}
                destination="Filtrar a base por medição vencida"
              />
              <TiresKpi
                kpi="base-psi-out"
                label="PSI fora da faixa"
                value={fmtInt(s.psiOut)}
                period="abaixo do mínimo ou acima do máximo"
                status={s.psiOut > 0 ? "warning" : undefined}
                nav={link({ pressao: "baixa,excesso" })}
                destination="Filtrar a base por PSI fora da faixa"
              />
              <TiresKpi
                kpi="base-without-vehicle"
                label="Em uso sem frota"
                value={fmtInt(s.withoutVehicle)}
                status={s.withoutVehicle > 0 ? "warning" : undefined}
              />
            </>
          )}
          <TiresKpi
            kpi="base-measurement-missing"
            label="Sem data de medição"
            value={fmtInt(s.measurementMissing)}
            nav={fora ? null : link({ medicao: "sem_registro" })}
            destination={fora ? undefined : "Filtrar a base por medição sem registro"}
          />
          <TiresKpi
            kpi="base-tread-divergence"
            label="Divergência de sulco"
            value={fmtInt(s.treadDivergence)}
            period="menor informado ≠ calculado"
            status={s.treadDivergence > 0 ? "warning" : undefined}
          />
          <TiresKpi
            kpi="base-km-negative"
            label="KM Real negativo"
            value={fmtInt(s.kmRealNegative)}
            period="qualidade do relatório"
            status={s.kmRealNegative > 0 ? "warning" : undefined}
          />
          <TiresKpi
            kpi="base-retread"
            label="Alerta de ressolagem"
            value={fmtInt(s.retreadAlerts)}
            status={s.retreadAlerts > 0 ? "progress" : undefined}
            icon={<Recycle />}
            nav={link({ ressolagem: "1" })}
            destination="Filtrar a base por alerta de ressolagem"
          />
        </div>
      </Section>

      <Section
        title={fora ? "Pneus fora da frota" : "Pneus por Nº Fogo"}
        testId="tires-base-rows"
        description="Clique no Nº Fogo para abrir a ficha 360° do pneu. A ordenação é feita no servidor sobre todo o recorte; criticidade, conformidade e motivos vêm do banco."
        actions={
          <span className="text-caption text-fg-muted tabular-nums">
            {fmtInt(data.total)} {plural(data.total, "pneu", "pneus")}
          </span>
        }
      >
        {statusCounts.length ? (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Situação dos pneus (filtro)" data-testid="tires-base-status-counts">
            <ToggleChip
              pressed={!statusFilter}
              onPressedChange={() => ctx.navigate({ situacao: null, pagina: null })}
              disabled={ctx.pending}
              data-testid="tires-base-status-all"
            >
              Todas
              <span className="tabular-nums text-fg">{fmtInt(countsTotal)}</span>
            </ToggleChip>
            {statusCounts.map((c) => {
              const pressed = statusFilter === c.key;
              return (
                <ToggleChip
                  key={c.key}
                  pressed={pressed}
                  onPressedChange={() => ctx.navigate({ situacao: pressed ? null : c.key, pagina: null })}
                  disabled={ctx.pending}
                  data-testid={`tires-base-status-${c.key}`}
                >
                  <StatusDot status={STATUS_TONE[c.key]} />
                  {STATUS_LABEL[c.key] ?? c.key}
                  <span className="tabular-nums text-fg">{fmtInt(c.count)}</span>
                </ToggleChip>
              );
            })}
          </div>
        ) : null}

        <TireRowsTable
          rows={data.rows as CroquiTire[]}
          fora={fora}
          sort={sort}
          dir={dir}
          onSort={(key, d) => ctx.navigate({ ordem: key, dir: d, pagina: null })}
        />
        <TiresPagination ctx={ctx} total={data.total} limit={data.limit} label="Paginação dos pneus" testId="tires-base-rows-pagination" />
      </Section>
    </>
  );
}

/** Nº Fogo fica visível enquanto a tabela larga rola na horizontal. */
const STICKY_HEAD = "left-0 z-20! shadow-[inset_-1px_0_0_var(--color-border-subtle)]";
const STICKY_CELL = "sticky left-0 z-[1] bg-inherit shadow-[inset_-1px_0_0_var(--color-border-subtle)]";

function TireRowsTable({ rows, fora, sort, dir, onSort }: {
  rows: CroquiTire[];
  fora: boolean;
  sort: string;
  dir: "asc" | "desc";
  onSort: (key: TiresBaseSort, dir: "asc" | "desc") => void;
}) {
  // Larguras mínimas no cabeçalho: o rótulo ordenável nunca é cortado.
  const head = (key: TiresBaseSort, label: string, className: string, numeric = false) => (
    <TableHead sortable numeric={numeric} sortDirection={sort === key ? dir : null} onSort={(d) => onSort(key, d)} className={className}>
      {label}
    </TableHead>
  );
  const cols = fora ? 11 : 13;
  return (
    <TableContainer stickyHeader className="max-h-[75vh]" data-testid="tires-base-table">
      <Table className="text-caption">
        <TableHeader>
          <TableRow>
            {head("fire_number", "Nº Fogo", cn("min-w-[7.5rem]", STICKY_HEAD))}
            {head("status", "Situação", "min-w-[7.5rem]")}
            {head("brand", "Pneu", "min-w-[6rem]")}
            {head("life", "Vida", "min-w-[5.5rem]", true)}
            {head("plate", "Veículo", "min-w-[7.5rem]")}
            {head("position", "Posição", "min-w-[7.5rem]")}
            {head("tread", "Sulco mín.", "min-w-[8.5rem]")}
            {head("measurement", "Medição", "min-w-[7.5rem]")}
            {head("psi", "PSI", "min-w-[5.5rem]")}
            {head("calibration", "Calibragem", "min-w-[8.5rem]")}
            {head("km", "KM real", "min-w-[7.5rem]", true)}
            {fora ? null : <TableHead className="min-w-[7.5rem]">Criticidade</TableHead>}
            {fora ? null : <TableHead className="min-w-[9rem]">Conformidade</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableEmpty
              colSpan={cols}
              icon={fora ? <PackageX /> : <ListOrdered />}
              message={fora ? "Nenhum pneu fora da frota no recorte." : "Nenhum pneu encontrado com os filtros atuais."}
            />
          ) : (
            rows.map((r) => (
              <TableRow key={r.snapshotId} className="h-auto" data-testid="tires-base-row" data-status={r.canonicalStatus}>
                <TableCell className={cn("whitespace-nowrap py-1.5", STICKY_CELL)}>
                  <span className="inline-flex items-center gap-1.5">
                    <FireLink tireId={r.tireId} fireNumber={r.fireNumber} testId="tires-base-fire-link" />
                    <RowFlags row={r} />
                  </span>
                </TableCell>
                <TableCell className="py-1.5">
                  <span className="flex flex-col items-start gap-0.5 leading-tight">
                    <TireStatusBadge value={r.canonicalStatus} />
                    {r.rodoparStatusRaw ? (
                      <span
                        className="whitespace-nowrap text-fg-muted"
                        title={`Rodopar: situação ${r.rodoparStatusRaw}${r.rodoparStatusLabel ? ` · status ${r.rodoparStatusLabel}` : ""}`}
                      >
                        Rodopar: {r.rodoparStatusRaw}
                      </span>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className="py-1.5">
                  <span className="flex min-w-[11rem] max-w-[13rem] flex-col leading-tight">
                    <span className="text-fg">{[r.brand, r.model].filter(Boolean).join(" ") || "—"}</span>
                    <span className="text-fg-muted">{r.dimension ?? "—"}</span>
                  </span>
                </TableCell>
                <TableCell numeric className="py-1.5">{fmtInt(r.life)}</TableCell>
                <TableCell className="whitespace-nowrap py-1.5">
                  {r.licensePlate || r.fleetNumber ? (
                    <PlateLink vehicleId={r.vehicleId} plate={r.licensePlate} fleetCode={r.fleetNumber} />
                  ) : (
                    <span className="text-fg-muted">—</span>
                  )}
                </TableCell>
                <TableCell className="py-1.5">
                  {r.positionCode ? (
                    <span className="flex flex-col leading-tight" title={r.positionLabel ?? undefined}>
                      <span className="font-semibold tabular-nums">{r.positionCode}</span>
                      {r.positionLabel && r.positionLabel !== r.positionCode ? <span className="text-fg-muted">{r.positionLabel}</span> : null}
                    </span>
                  ) : (
                    <span className="text-fg-muted">—</span>
                  )}
                </TableCell>
                <TableCell className="py-1.5">
                  <span className="flex flex-col items-start gap-0.5 whitespace-nowrap leading-tight">
                    <span className="font-semibold"><TreadMinCell row={r} /></span>
                    <TreadClassBadge value={r.treadClass} />
                  </span>
                </TableCell>
                <TableCell className="py-1.5"><DeadlineCell date={r.measurementDate} days={r.measurementDays} status={r.measurementStatus} compact /></TableCell>
                <TableCell className="whitespace-nowrap py-1.5"><PsiCell psi={r.psi} min={r.psiMin} max={r.psiMax} status={r.psiStatus} /></TableCell>
                <TableCell className="py-1.5"><DeadlineCell date={r.calibrationDate} days={r.calibrationDays} status={r.calibrationStatus} compact /></TableCell>
                <TableCell numeric className="whitespace-nowrap py-1.5"><KmRealCell value={r.kmReal} /></TableCell>
                {fora ? null : (
                  <>
                    {/* criticidade e conformidade só se aplicam a pneus em uso */}
                    <TableCell className="py-1.5"><CriticalityBadge value={r.canonicalStatus === "em_uso" ? criticalityOf(r) : null} /></TableCell>
                    <TableCell className="py-1.5"><ConformityCell row={r} /></TableCell>
                  </>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
