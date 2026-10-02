"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  CalendarPlus,
  ChevronDown,
  ChevronRight,
  FoldVertical,
  History,
  RefreshCw,
  SlidersHorizontal,
  UnfoldVertical,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { GaugeChart, type GaugeTone } from "@/components/charts/gauge-chart";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FilterBar } from "@/components/ui/filter-bar";
import { FormField } from "@/components/ui/form-field";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SearchField } from "@/components/ui/search-field";
import {
  StatusBadge,
  statusTone,
  type StatusTone,
} from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { useToast } from "@/components/feedback/toast";
import { NativeSelect } from "@/components/governance/selects";
import {
  schedulePreventiveCycle,
  syncPreventiveCycles,
} from "@/lib/maintenance/actions";
import type {
  MaintenanceFilterOptions,
  PreventiveFilters,
} from "@/lib/maintenance/queries";
import {
  ADHERENCE_LABEL,
  formatDate,
  formatInt,
  formatKm,
  PREVENTIVE_STATUS_LABEL,
  PREVENTIVE_STATUS_TONE,
  STATUS_LABEL,
  vehicleLabel,
  type MaintenanceCatalog,
  type PreventiveCycleCell,
  type PreventiveMatrix,
  type PreventiveMatrixRow,
  type PreventiveStatus,
} from "@/lib/maintenance/types";
import type { MaintenancePerms, PanelActions } from "./shared";

/**
 * Manutenção → Preventiva.
 *
 * Veículos nas linhas, ciclos MP1..MPn nas colunas, agrupados por tipo de
 * equipamento. Situação, marco, saldo e aderência de cada ciclo chegam prontos
 * do servidor (faixa de alerta e tolerância do parâmetro); a tela só apresenta
 * e chama as rotinas: criar a manutenção do ciclo (idempotente, já agendada ou
 * "Há agendar") e sincronizar os ciclos. Acima da matriz, os quadros de frotas
 * com preventiva crítica, vencida e a programar — o mesmo recorte do HFC.
 * A frota inativa é histórico — consulta, sem geração e sem quadros.
 */

// ---------------------------------------------------------------------------
// Peças compartilhadas com a aba Preditiva
// ---------------------------------------------------------------------------

/** Borda esquerda por tom: o texto carrega o significado, a cor só acompanha. */
export const TONE_BORDER: Record<StatusTone, string> = {
  success: "border-l-success",
  warning: "border-l-warning",
  danger: "border-l-danger",
  info: "border-l-info",
  neutral: "border-l-border-strong",
  pending: "border-l-border-strong",
  progress: "border-l-accent",
};

/** Linha de acento no topo do indicador — o mesmo gesto do KpiCard. */
const TONE_TOP: Record<StatusTone, string | null> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  neutral: null,
  pending: null,
  progress: "bg-accent",
};

export function FilterField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-caption text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

export interface StatTileProps {
  label: string;
  value: React.ReactNode;
  unit?: React.ReactNode;
  hint?: React.ReactNode;
  tone?: StatusTone;
  /** Indicador clicável: filtra a visão. `active` marca o filtro aplicado. */
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  testId?: string;
}

/** Indicador compacto. Clicável quando filtra; `aria-pressed` diz se está aplicado. */
export function StatTile({
  label,
  value,
  unit,
  hint,
  tone,
  onClick,
  active = false,
  disabled,
  testId,
}: StatTileProps) {
  const accent = tone ? TONE_TOP[tone] : null;
  const body = (
    <>
      {accent ? (
        <span
          aria-hidden
          className={cn("absolute inset-x-0 top-0 h-0.5", accent)}
        />
      ) : null}
      <span className="text-caption font-medium text-fg-secondary">
        {label}
      </span>
      <span className="flex min-w-0 items-baseline gap-1">
        <span className="text-h2 font-semibold leading-none text-fg tabular-nums">
          {value}
        </span>
        {unit != null ? (
          <span className="truncate text-caption text-fg-muted">{unit}</span>
        ) : null}
      </span>
      {hint != null ? (
        <span className="text-caption text-fg-muted">{hint}</span>
      ) : null}
    </>
  );
  const base = cn(
    "relative flex min-h-[4.25rem] min-w-0 flex-col justify-between gap-1.5 overflow-hidden rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-left shadow-card",
  );
  if (!onClick) {
    return (
      <div className={base} data-testid={testId}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        base,
        "hfm-transition hfm-focus-ring hover:border-border-strong hover:shadow-card-hover",
        "disabled:pointer-events-none disabled:opacity-55",
        active &&
          "border-primary bg-primary-soft hover:border-primary hover:bg-primary-soft",
      )}
    >
      {body}
    </button>
  );
}

const PAGE_SIZES = [25, 50, 100, 200];
const DEFAULT_PAGE_SIZE = 50;

/** Página e tamanho vindos da URL (`pagina`, `por_pagina`), já limitados ao total. */
export function useUrlPage(total: number) {
  const params = useSearchParams();
  const requested = Number(params.get("por_pagina"));
  const pageSize = PAGE_SIZES.includes(requested)
    ? requested
    : DEFAULT_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(
    pageCount,
    Math.max(1, Number(params.get("pagina")) || 1),
  );
  return {
    page,
    pageSize,
    start: (page - 1) * pageSize,
    pageSizes: PAGE_SIZES,
  };
}

// ---------------------------------------------------------------------------
// Preventiva
// ---------------------------------------------------------------------------

export interface PreventivePanelProps {
  preventive: { matrix: PreventiveMatrix | null; filters: PreventiveFilters };
  options: MaintenanceFilterOptions;
  catalog: MaintenanceCatalog;
  perms: MaintenancePerms;
  actions: PanelActions;
}

const STATUS_ORDER: PreventiveStatus[] = [
  "critical",
  "due",
  "to_schedule",
  "not_reached",
  "completed",
  "no_km",
];
const ACTIONABLE: PreventiveStatus[] = ["to_schedule", "due", "critical"];

/**
 * Formatação condicional do ciclo. O cartão inteiro leva o tom da situação —
 * fundo suave, borda e faixa sólida no canto esquerdo —, e o selo com ícone e
 * texto continua lá: a cor nunca é o único sinal. "Sem KM" fica no neutro, mas
 * com borda tracejada e faixa pontilhada, para não se confundir com "Não
 * atingida". Texto sobre o fundo suave usa os tons `*-soft-fg`, legíveis em
 * light e dark.
 */
const STATUS_CARD: Record<
  PreventiveStatus,
  { bg: string; border: string; stripe: string; fg: string }
> = {
  critical: {
    bg: "bg-danger-soft",
    border: "border-danger/50",
    stripe: "bg-danger",
    fg: "text-danger-soft-fg",
  },
  due: {
    bg: "bg-warning-soft",
    border: "border-warning/50",
    stripe: "bg-warning",
    fg: "text-warning-soft-fg",
  },
  to_schedule: {
    bg: "bg-info-soft",
    border: "border-info/50",
    stripe: "bg-info",
    fg: "text-info-soft-fg",
  },
  not_reached: {
    bg: "bg-neutral-soft",
    border: "border-neutral/40",
    stripe: "bg-neutral",
    fg: "text-neutral-soft-fg",
  },
  completed: {
    bg: "bg-success-soft",
    border: "border-success/50",
    stripe: "bg-success",
    fg: "text-success-soft-fg",
  },
  no_km: {
    bg: "bg-surface-secondary",
    border: "border-dashed border-neutral/60",
    stripe:
      "bg-[repeating-linear-gradient(to_bottom,var(--neutral)_0_4px,transparent_4px_8px)]",
    fg: "text-fg-muted",
  },
};

const cardTone = (status: PreventiveStatus) =>
  cn(STATUS_CARD[status].bg, STATUS_CARD[status].border);

/** Faixa sólida no canto esquerdo, na cor da situação (decorativa). */
function ToneStripe({
  status,
  className,
}: {
  status: PreventiveStatus;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-y-0 left-0 w-1",
        STATUS_CARD[status].stripe,
        className,
      )}
    />
  );
}

/** Selo da situação sobre o cartão tingido: fundo da superfície para destacar, com ícone e texto. */
function CycleStatusBadge({
  status,
  size = "sm",
}: {
  status: PreventiveStatus;
  size?: "sm" | "md";
}) {
  return (
    <StatusBadge
      status={PREVENTIVE_STATUS_TONE[status] ?? "neutral"}
      size={size}
      withIcon
      className="bg-surface"
    >
      {PREVENTIVE_STATUS_LABEL[status] ?? status}
    </StatusBadge>
  );
}

/** Miniatura do cartão: a legenda e os contadores do grupo seguem a mesma formatação da célula. */
function StatusChip({
  status,
  count,
}: {
  status: PreventiveStatus;
  count?: number;
}) {
  const Icon = statusTone(PREVENTIVE_STATUS_TONE[status] ?? "neutral").icon;
  return (
    <span
      className={cn(
        "relative inline-flex h-6 shrink-0 items-center gap-1 overflow-hidden rounded-xs border py-0.5 pl-2.5 pr-2 text-caption font-medium",
        cardTone(status),
        STATUS_CARD[status].fg,
      )}
    >
      <ToneStripe status={status} className="w-[3px]" />
      <Icon className="size-3 shrink-0" aria-hidden />
      <span>{PREVENTIVE_STATUS_LABEL[status] ?? status}</span>
      {count != null ? (
        <span className="font-semibold tabular-nums">{formatInt(count)}</span>
      ) : null}
    </span>
  );
}

const DIAGNOSTIC_LABEL: Record<string, string> = {
  no_rule: "Sem parâmetro preventivo para este tipo/modelo.",
  no_km: "Sem leitura oficial de KM: os marcos não podem ser avaliados.",
  no_cycles: "Ciclos MP ainda não gerados. Sincronize os ciclos.",
};

function diagnosticsOf(row: PreventiveMatrixRow): string[] {
  const list = (row.diagnostics ?? []).map((d) => DIAGNOSTIC_LABEL[d] ?? d);
  if (!row.hasRule) list.unshift(DIAGNOSTIC_LABEL.no_rule);
  return [...new Set(list)];
}

const pct1 = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const sign = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "");

function adherenceText(c: PreventiveCycleCell): string | null {
  if (!c.adherence) return null;
  const parts: string[] = [];
  if (c.adherenceKm != null)
    parts.push(
      `${sign(c.adherenceKm)}${formatInt(Math.abs(c.adherenceKm))} km`,
    );
  if (c.adherencePct != null)
    parts.push(
      `${sign(c.adherencePct)}${pct1.format(Math.abs(c.adherencePct))}%`,
    );
  const label = ADHERENCE_LABEL[c.adherence] ?? c.adherence;
  return parts.length ? `${label} · ${parts.join(" · ")}` : label;
}

function balance(c: PreventiveCycleCell): {
  text: string;
  title: string;
  exceeded: boolean;
} {
  if (c.kmExceeded != null && c.kmExceeded > 0) {
    return {
      text: `+${formatInt(c.kmExceeded)} km`,
      title: `${formatInt(c.kmExceeded)} km além do marco`,
      exceeded: true,
    };
  }
  if (c.kmRemaining != null) {
    return {
      text: `faltam ${formatInt(c.kmRemaining)} km`,
      title: `Faltam ${formatInt(c.kmRemaining)} km para o marco`,
      exceeded: false,
    };
  }
  return {
    text: "saldo indisponível",
    title: "Sem KM para calcular o saldo",
    exceeded: false,
  };
}

/** De onde o diálogo foi aberto: o título repete a ação do botão que o abriu. */
type ScheduleOrigin = "board" | "matrix";
type ScheduleTarget = {
  cycle: PreventiveCycleCell;
  row: PreventiveMatrixRow;
  origin: ScheduleOrigin;
};

// ---------------------------------------------------------------- quadros

type BoardStatus = "critical" | "due" | "to_schedule";

/** Gravidade para escolher o ciclo do veículo: crítica > vencida > a programar. */
const BOARD_RANK: Record<BoardStatus, number> = {
  critical: 0,
  due: 1,
  to_schedule: 2,
};
const isBoardStatus = (s: PreventiveStatus): s is BoardStatus =>
  s in BOARD_RANK;

const BOARDS: {
  status: BoardStatus;
  title: string;
  hint: string;
  icon: LucideIcon;
  badge: "danger" | "warning" | "info";
}[] = [
  {
    status: "critical",
    title: "Frotas com preventiva vencida crítica",
    hint: "KM além da tolerância do marco · maior KM excedido primeiro",
    icon: XCircle,
    badge: "danger",
  },
  {
    status: "due",
    title: "Frotas com preventiva vencida",
    hint: "Marco ultrapassado, dentro da tolerância · maior KM excedido primeiro",
    icon: AlertTriangle,
    badge: "warning",
  },
  {
    status: "to_schedule",
    title: "Frotas com preventiva a programar",
    hint: "Na faixa de alerta antes do marco · menor saldo primeiro",
    icon: CalendarClock,
    badge: "info",
  },
];

const BOARD_PREVIEW = 10;

interface BoardEntry {
  row: PreventiveMatrixRow;
  /** Ciclo mais grave do veículo (o de menor número, entre os de mesma gravidade). */
  cycle: PreventiveCycleCell & { status: BoardStatus };
  /** Os demais ciclos pendentes (críticos, vencidos ou a programar) do veículo. */
  others: PreventiveCycleCell[];
}

/** Uma linha por veículo, no quadro do seu ciclo pendente mais grave. */
function boardEntries(
  rows: PreventiveMatrixRow[],
): Record<BoardStatus, BoardEntry[]> {
  const out: Record<BoardStatus, BoardEntry[]> = {
    critical: [],
    due: [],
    to_schedule: [],
  };
  for (const row of rows) {
    const pending = row.cycles.filter((c): c is BoardEntry["cycle"] =>
      isBoardStatus(c.status),
    );
    if (!pending.length) continue;
    const cycle = pending.reduce((best, c) => {
      const diff = BOARD_RANK[c.status] - BOARD_RANK[best.status];
      return diff < 0 || (diff === 0 && c.number < best.number) ? c : best;
    });
    out[cycle.status].push({
      row,
      cycle,
      others: pending
        .filter((c) => c !== cycle)
        .sort((a, b) => a.number - b.number),
    });
  }
  const plate = (e: BoardEntry) => e.row.licensePlate ?? e.row.fleetCode ?? "";
  const byPlate = (a: BoardEntry, b: BoardEntry) =>
    plate(a).localeCompare(plate(b), "pt-BR");
  const byExceeded = (a: BoardEntry, b: BoardEntry) =>
    (b.cycle.kmExceeded ?? 0) - (a.cycle.kmExceeded ?? 0) || byPlate(a, b);
  const remaining = (e: BoardEntry) =>
    e.cycle.kmRemaining ?? Number.MAX_SAFE_INTEGER;
  out.critical.sort(byExceeded);
  out.due.sort(byExceeded);
  out.to_schedule.sort((a, b) => remaining(a) - remaining(b) || byPlate(a, b));
  return out;
}

// ---------------------------------------------------------------- grupos

const NO_TYPE_KEY = "\u0000sem-tipo";
const NO_TYPE_LABEL = "Sem tipo";
const GROUP_INITIAL = 25;
const GROUP_STEP = 50;

interface MatrixGroupData {
  key: string;
  label: string;
  rows: PreventiveMatrixRow[];
  /** Ciclos críticos, vencidos e a programar no grupo. */
  counts: Record<BoardStatus, number>;
}

/** Linhas por tipo de equipamento, em ordem alfabética (pt-BR); "Sem tipo" por último. */
function groupByType(rows: PreventiveMatrixRow[]): MatrixGroupData[] {
  const map = new Map<string, MatrixGroupData>();
  for (const row of rows) {
    const name = row.typeName?.trim();
    const key = name || NO_TYPE_KEY;
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        label: name || NO_TYPE_LABEL,
        rows: [],
        counts: { critical: 0, due: 0, to_schedule: 0 },
      };
      map.set(key, group);
    }
    group.rows.push(row);
    for (const c of row.cycles)
      if (isBoardStatus(c.status)) group.counts[c.status] += 1;
  }
  return [...map.values()].sort((a, b) => {
    if (a.key === NO_TYPE_KEY || b.key === NO_TYPE_KEY)
      return a.key === NO_TYPE_KEY ? 1 : -1;
    return a.label.localeCompare(b.label, "pt-BR");
  });
}

export function PreventivePanel({
  preventive,
  options,
  catalog,
  perms,
  actions,
}: PreventivePanelProps) {
  const { matrix, filters } = preventive;
  const { toast } = useToast();
  const [syncing, startSync] = React.useTransition();
  const [target, setTarget] = React.useState<ScheduleTarget | null>(null);
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const pending = actions.pending;

  const inactive = (matrix?.situation ?? filters.situation) === "inactive";
  // O banco exige maintenance.manage_preventive para gerar; agendar na mesma chamada exige também schedule.
  const canGenerate = !inactive && perms.managePreventive;
  const canSync = !inactive && (perms.managePreventive || perms.reprocess);

  const set = (patch: Record<string, string | null>) =>
    actions.navigate({ ...patch, pagina: null });

  // ---------------------------------------------------------------- opções
  const models = React.useMemo(() => {
    const makes = new Map(options.makes.map((m) => [m.id, m.name]));
    return options.models
      .map((m) => ({
        id: m.id,
        label: [makes.get(m.makeId), m.name].filter(Boolean).join(" "),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [options.makes, options.models]);

  const cities = React.useMemo(() => {
    const seen = new Map<
      number,
      { id: number; label: string; stateId: number }
    >();
    for (const c of options.coverage) {
      if (filters.operation && c.operationId !== filters.operation) continue;
      seen.set(c.cityId, {
        id: c.cityId,
        label: `${c.cityName}/${c.uf}`,
        stateId: c.stateId,
      });
    }
    return [...seen.values()].sort((a, b) =>
      a.label.localeCompare(b.label, "pt-BR"),
    );
  }, [options.coverage, filters.operation]);

  const moreCount = [filters.model, filters.city].filter(Boolean).length;
  const anyFilter = Boolean(
    filters.q ||
    filters.status ||
    filters.vehicleType ||
    filters.model ||
    filters.operation ||
    filters.city,
  );
  const clearFilters = () =>
    set({
      q: null,
      mp_situacao: null,
      equipamento: null,
      modelo: null,
      operacao: null,
      cidade: null,
    });

  // ---------------------------------------------------------------- matriz
  const rows = React.useMemo(() => matrix?.rows ?? [], [matrix]);
  const groups = React.useMemo(() => groupByType(rows), [rows]);
  const boards = React.useMemo(() => boardEntries(rows), [rows]);
  const anyOpen = groups.some((g) => !collapsed.has(g.key));

  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const toggleAll = () =>
    setCollapsed(anyOpen ? new Set(groups.map((g) => g.key)) : new Set());

  const sync = () =>
    startSync(async () => {
      const result = await syncPreventiveCycles();
      if (!result.ok) {
        toast({
          title:
            result.error ??
            "Não foi possível sincronizar os ciclos preventivos.",
          variant: "danger",
        });
        return;
      }
      const data = (result.data ?? {}) as {
        vehicles?: number;
        withRule?: number;
        withoutRule?: number;
      };
      toast({
        title: "Ciclos preventivos sincronizados.",
        description:
          data.vehicles != null
            ? `${formatInt(data.vehicles)} veículos · ${formatInt(data.withRule ?? 0)} com parâmetro · ${formatInt(data.withoutRule ?? 0)} sem parâmetro`
            : undefined,
        variant: "success",
      });
      actions.refresh();
    });

  const filterBar = (
    <FilterBar
      className="items-end gap-3"
      label="Filtros da preventiva"
      data-testid="maintenance-preventive-filters"
    >
      <FilterField label="Frota">
        <NativeSelect
          fieldSize="sm"
          aria-label="Frota ativa ou histórico da frota inativa"
          value={filters.situation ?? "active"}
          disabled={pending}
          onChange={(e) =>
            set({ mp_frota: e.target.value === "inactive" ? "inactive" : null })
          }
          className="min-w-[10rem]"
        >
          <option value="active">Ativa</option>
          <option value="inactive">Inativa (histórico)</option>
        </NativeSelect>
      </FilterField>
      <FilterField label="Situação do ciclo">
        <NativeSelect
          fieldSize="sm"
          aria-label="Filtrar por situação do ciclo"
          value={filters.status ?? ""}
          disabled={pending}
          onChange={(e) => set({ mp_situacao: e.target.value || null })}
          className="min-w-[9.5rem]"
        >
          <option value="">Todas</option>
          {STATUS_ORDER.map((code) => (
            <option key={code} value={code}>
              {PREVENTIVE_STATUS_LABEL[code]}
            </option>
          ))}
        </NativeSelect>
      </FilterField>
      <FilterField label="Tipo de equipamento">
        <NativeSelect
          fieldSize="sm"
          aria-label="Filtrar por tipo de equipamento"
          value={filters.vehicleType ?? ""}
          disabled={pending}
          onChange={(e) => set({ equipamento: e.target.value || null })}
          className="min-w-[11rem]"
        >
          <option value="">Todos</option>
          {options.vehicleTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </NativeSelect>
      </FilterField>
      <FilterField label="Operação">
        <NativeSelect
          fieldSize="sm"
          aria-label="Filtrar por operação"
          value={filters.operation ?? ""}
          disabled={pending}
          onChange={(e) =>
            set({ operacao: e.target.value || null, uf: null, cidade: null })
          }
          className="min-w-[11rem]"
        >
          <option value="">Todas</option>
          {options.operations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </NativeSelect>
      </FilterField>
      <FilterField
        label="Placa ou frota"
        className="min-w-[11rem] flex-1 sm:max-w-[15rem]"
      >
        <SearchField
          key={filters.q ?? ""}
          size="sm"
          aria-label="Buscar por placa ou frota (Enter para aplicar)"
          defaultValue={filters.q ?? ""}
          placeholder="SNT8J46, VA170…"
          onKeyDown={(e) => {
            if (e.key === "Enter")
              set({ q: (e.target as HTMLInputElement).value.trim() || null });
          }}
          onClear={() => set({ q: null })}
        />
      </FilterField>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={<SlidersHorizontal />}
            disabled={pending}
          >
            Mais filtros
            {moreCount ? (
              <Badge
                variant="accent"
                size="sm"
                appearance="solid"
                className="ml-1"
              >
                {moreCount}
              </Badge>
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(92vw,30rem)]">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FilterField label="Modelo">
              <NativeSelect
                fieldSize="sm"
                value={filters.model ?? ""}
                onChange={(e) => set({ modelo: e.target.value || null })}
              >
                <option value="">Todos</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </NativeSelect>
            </FilterField>
            <FilterField label="Cidade">
              <NativeSelect
                fieldSize="sm"
                value={filters.city ?? ""}
                onChange={(e) => {
                  const city = cities.find(
                    (c) => String(c.id) === e.target.value,
                  );
                  set({
                    cidade: city ? String(city.id) : null,
                    uf: city ? String(city.stateId) : null,
                  });
                }}
              >
                <option value="">Todas</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </NativeSelect>
            </FilterField>
          </div>
        </PopoverContent>
      </Popover>
      {anyFilter ? (
        <Button
          variant="ghost"
          size="sm"
          leadingIcon={<X />}
          onClick={clearFilters}
          disabled={pending}
        >
          Limpar filtros
        </Button>
      ) : null}
    </FilterBar>
  );

  const inactiveNotice = inactive ? (
    <Alert
      variant="neutral"
      icon={<History aria-hidden />}
      data-testid="maintenance-preventive-inactive"
    >
      <AlertTitle>Histórico da frota inativa</AlertTitle>
      <AlertDescription>
        Ciclos registrados enquanto os veículos estavam ativos, preservados para
        consulta. Nesta visão nenhum alerta novo é calculado e nenhuma
        manutenção é gerada.
      </AlertDescription>
    </Alert>
  ) : null;

  if (!matrix) {
    return (
      <div
        className="flex flex-col gap-4"
        data-testid="maintenance-preventive-panel"
      >
        {filterBar}
        {inactiveNotice}
        <ErrorState
          title="Não foi possível carregar a matriz preventiva."
          description="A leitura dos ciclos falhou. Tente de novo em instantes."
          onRetry={actions.refresh}
          retryLabel="Tentar de novo"
          retrying={pending}
        />
      </div>
    );
  }

  const s = matrix.summary;
  const toggleStatus = (code: PreventiveStatus) =>
    set({ mp_situacao: filters.status === code ? null : code });
  const statusTile = (
    code: PreventiveStatus,
    label: string,
    value: number | undefined,
  ) => (
    <StatTile
      key={code}
      label={label}
      value={formatInt(value ?? 0)}
      unit="ciclos"
      tone={PREVENTIVE_STATUS_TONE[code]}
      onClick={() => toggleStatus(code)}
      active={filters.status === code}
      disabled={pending}
      testId={`maintenance-preventive-kpi-${code}`}
    />
  );

  return (
    <div
      className="flex flex-col gap-4"
      data-testid="maintenance-preventive-panel"
    >
      {filterBar}
      {inactiveNotice}

      <section
        aria-label="Resumo da preventiva"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-9"
      >
        <StatTile
          label="Veículos"
          value={formatInt(s?.vehicles ?? 0)}
          unit="no recorte"
        />
        <StatTile
          label="Sem regra"
          value={formatInt(s?.noRule ?? 0)}
          unit="veículos"
          tone={s?.noRule ? "warning" : undefined}
        />
        <StatTile
          label="Sem KM"
          value={formatInt(s?.noKm ?? 0)}
          unit="veículos"
          tone={s?.noKm ? "pending" : undefined}
        />
        {statusTile("not_reached", "Não atingidas", s?.notReached)}
        {statusTile("to_schedule", "A programar", s?.toSchedule)}
        {statusTile("due", "Vencidas", s?.due)}
        {statusTile("critical", "Críticas", s?.critical)}
        {statusTile("completed", "Realizadas", s?.completed)}
        <StatTile
          label="Programadas"
          value={formatInt(s?.programmed ?? 0)}
          unit="com manutenção aberta"
          tone="info"
        />
      </section>

      <PreventiveCompliance rows={rows} inactive={inactive} />

      {!inactive && rows.length > 0 ? (
        <section
          aria-label="Frotas com preventiva pendente"
          className="flex flex-col gap-3"
          data-testid="maintenance-preventive-boards"
        >
          {BOARDS.map((board) => (
            <PreventiveBoard
              key={board.status}
              {...board}
              entries={boards[board.status]}
              canGenerate={canGenerate}
              pending={pending}
              onSchedule={(entry) =>
                setTarget({
                  cycle: entry.cycle,
                  row: entry.row,
                  origin: "board",
                })
              }
              onOpenMaintenance={actions.openMaintenance}
            />
          ))}
        </section>
      ) : null}

      <section
        className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3 sm:p-4"
        aria-labelledby="preventive-matrix-title"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3
              id="preventive-matrix-title"
              className="text-h4 font-semibold text-fg"
            >
              Matriz preventiva · veículos × ciclos MP
            </h3>
            <p className="text-caption text-fg-muted">
              {formatInt(rows.length)} veículo(s) em {formatInt(groups.length)}{" "}
              tipo(s) de equipamento · situação calculada pelo servidor a partir
              do KM atual, do marco de cada ciclo e da faixa de
              alerta/tolerância do parâmetro.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {groups.length > 1 ? (
              <Button
                variant="ghost"
                size="sm"
                leadingIcon={anyOpen ? <FoldVertical /> : <UnfoldVertical />}
                onClick={toggleAll}
                data-testid="maintenance-preventive-groups-toggle"
              >
                {anyOpen ? "Recolher grupos" : "Expandir grupos"}
              </Button>
            ) : null}
            {canSync ? (
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<RefreshCw />}
                onClick={sync}
                loading={syncing}
                disabled={pending}
                data-testid="maintenance-preventive-sync"
              >
                Sincronizar ciclos
              </Button>
            ) : null}
          </div>
        </div>

        <ul
          className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-caption text-fg-muted"
          aria-label="Legenda das situações"
        >
          {STATUS_ORDER.map((code) => (
            <li key={code} className="flex">
              <StatusChip status={code} />
            </li>
          ))}
          <li className="sm:ml-1">
            “faltam X km” = antes do marco · “+X km” = além do marco
          </li>
          <li>Código azul = manutenção aberta para o ciclo</li>
        </ul>

        {rows.length === 0 ? (
          <EmptyState
            variant="panel"
            size="sm"
            title={
              inactive
                ? "Nenhum veículo inativo com histórico preventivo"
                : "Nenhum veículo no recorte"
            }
            description={
              anyFilter
                ? "Nenhum veículo corresponde aos filtros. Ajuste ou limpe os filtros para ver a frota completa."
                : inactive
                  ? "Não há veículos inativos com ciclos preventivos registrados."
                  : "Não há veículos ativos no seu escopo. Cadastre parâmetros preventivos e sincronize os ciclos."
            }
            action={
              anyFilter ? (
                <Button
                  variant="secondary"
                  size="sm"
                  leadingIcon={<X />}
                  onClick={clearFilters}
                >
                  Limpar filtros
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div
            className="flex flex-col gap-3"
            data-testid="maintenance-preventive-matrix"
          >
            {groups.map((group) => (
              <MatrixGroup
                key={group.key}
                group={group}
                open={!collapsed.has(group.key)}
                onToggle={() => toggleGroup(group.key)}
                canGenerate={canGenerate}
                onGenerate={(cycle, row) =>
                  setTarget({ cycle, row, origin: "matrix" })
                }
                onOpenMaintenance={actions.openMaintenance}
              />
            ))}
          </div>
        )}
      </section>

      {canGenerate ? (
        <ScheduleCycleDialog
          target={target}
          today={matrix.today}
          catalog={catalog}
          canSchedule={perms.schedule}
          onOpenChange={(open) => {
            if (!open) setTarget(null);
          }}
          actions={actions}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conformidade preventiva
// ---------------------------------------------------------------------------

type ComplianceBucket =
  | "ok"
  | "to_schedule"
  | "due"
  | "critical"
  | "no_km"
  | "no_rule";

const COMPLIANCE_ORDER: ComplianceBucket[] = [
  "ok",
  "to_schedule",
  "due",
  "critical",
  "no_km",
  "no_rule",
];
const COMPLIANCE_LABEL: Record<ComplianceBucket, string> = {
  ok: "Em dia",
  to_schedule: "A programar",
  due: "Vencida",
  critical: "Vencida crítica",
  no_km: "Sem KM",
  no_rule: "Sem regra",
};
const COMPLIANCE_COLOR: Record<ComplianceBucket, string> = {
  ok: "bg-success",
  to_schedule: "bg-info",
  due: "bg-warning",
  critical: "bg-danger",
  no_km: "bg-neutral/60",
  no_rule: "bg-neutral/35",
};

/**
 * Uma frota por balde, pelo ciclo pendente mais grave que ela tem. Conforme é a
 * frota sem preventiva vencida (em dia ou a programar); sem regra e sem KM não
 * podem ser conformes, então entram no denominador e aparecem na barra. Só
 * conta — a situação de cada ciclo vem do servidor.
 */
function complianceOf(rows: PreventiveMatrixRow[]) {
  const buckets: Record<ComplianceBucket, number> = {
    ok: 0,
    to_schedule: 0,
    due: 0,
    critical: 0,
    no_km: 0,
    no_rule: 0,
  };
  let withCompleted = 0;
  let completedCycles = 0;
  for (const row of rows) {
    const done = row.cycles.filter((c) => c.status === "completed").length;
    completedCycles += done;
    if (done > 0) withCompleted += 1;
    const has = (status: PreventiveStatus) =>
      row.cycles.some((c) => c.status === status);
    if (!row.hasRule) buckets.no_rule += 1;
    else if (row.currentKm == null) buckets.no_km += 1;
    else if (has("critical")) buckets.critical += 1;
    else if (has("due")) buckets.due += 1;
    else if (has("to_schedule")) buckets.to_schedule += 1;
    else buckets.ok += 1;
  }
  const total = rows.length;
  const compliant = buckets.ok + buckets.to_schedule;
  const overdue = buckets.due + buckets.critical;
  return {
    total,
    buckets,
    compliant,
    overdue,
    withCompleted,
    completedCycles,
    compliancePct: total ? (100 * compliant) / total : null,
    completedPct: total ? (100 * withCompleted) / total : null,
  };
}

function PreventiveCompliance({
  rows,
  inactive,
}: {
  rows: PreventiveMatrixRow[];
  inactive: boolean;
}) {
  const c = React.useMemo(() => complianceOf(rows), [rows]);
  if (inactive || c.total === 0) return null;
  const tone: GaugeTone =
    c.compliancePct == null
      ? "neutral"
      : c.compliancePct >= 90
        ? "success"
        : c.compliancePct >= 70
          ? "warning"
          : "danger";
  const ratio = (n: number) =>
    `${formatInt(n)} de ${formatInt(c.total)} ${c.total === 1 ? "frota" : "frotas"}`;
  const barLabel = COMPLIANCE_ORDER.filter((b) => c.buckets[b] > 0)
    .map((b) => `${COMPLIANCE_LABEL[b]}: ${formatInt(c.buckets[b])}`)
    .join("; ");

  return (
    <Card
      className="border border-border shadow-card"
      data-testid="maintenance-preventive-compliance"
    >
      <CardHeader
        title="Conformidade das preventivas"
        description="Frotas sem preventiva vencida (em dia ou a programar) e frotas com preventiva realizada, sobre o total de frotas do recorte. Sem regra e sem KM não contam como conformes."
      />
      <CardContent className="grid gap-5 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center">
        <GaugeChart
          value={c.compliancePct}
          tone={tone}
          label="conformes"
          size={168}
          ariaLabel="Conformidade das preventivas"
          className="justify-self-center"
          data-testid="maintenance-preventive-compliance-gauge"
        />
        <div className="flex min-w-0 flex-col gap-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <div className="flex min-w-0 flex-col">
              <dt className="text-caption text-fg-muted">Conformes</dt>
              <dd
                className="text-h3 font-semibold text-fg tabular-nums"
                data-testid="maintenance-preventive-compliance-value"
              >
                {c.compliancePct == null
                  ? "—"
                  : `${pct1.format(c.compliancePct)}%`}
              </dd>
              <dd className="text-caption text-fg-secondary">
                {ratio(c.compliant)}
              </dd>
            </div>
            <div className="flex min-w-0 flex-col">
              <dt className="text-caption text-fg-muted">Realizadas</dt>
              <dd
                className="text-h3 font-semibold text-fg tabular-nums"
                data-testid="maintenance-preventive-completed-value"
              >
                {c.completedPct == null
                  ? "—"
                  : `${pct1.format(c.completedPct)}%`}
              </dd>
              <dd className="text-caption text-fg-secondary">
                {ratio(c.withCompleted)} · {formatInt(c.completedCycles)}{" "}
                {c.completedCycles === 1
                  ? "ciclo MP realizado"
                  : "ciclos MP realizados"}
              </dd>
            </div>
            <div className="flex min-w-0 flex-col">
              <dt className="text-caption text-fg-muted">
                Com preventiva vencida
              </dt>
              <dd
                className={cn(
                  "text-h3 font-semibold tabular-nums",
                  c.overdue > 0 ? "text-danger" : "text-fg",
                )}
              >
                {formatInt(c.overdue)}
              </dd>
              <dd className="text-caption text-fg-secondary">
                {formatInt(c.buckets.due)}{" "}
                {c.buckets.due === 1 ? "vencida" : "vencidas"} ·{" "}
                {formatInt(c.buckets.critical)}{" "}
                {c.buckets.critical === 1 ? "crítica" : "críticas"}
              </dd>
            </div>
          </dl>
          <div className="flex flex-col gap-2">
            <div
              role="img"
              aria-label={`Frotas por situação preventiva — ${barLabel}`}
              className="flex h-2.5 w-full overflow-hidden rounded-full bg-chart-track"
            >
              {COMPLIANCE_ORDER.map((b) =>
                c.buckets[b] > 0 ? (
                  <span
                    key={b}
                    className={COMPLIANCE_COLOR[b]}
                    style={{ width: `${(100 * c.buckets[b]) / c.total}%` }}
                  />
                ) : null,
              )}
            </div>
            <ul
              className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-fg-secondary"
              aria-label="Legenda da barra"
            >
              {COMPLIANCE_ORDER.map((b) => (
                <li key={b} className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      COMPLIANCE_COLOR[b],
                    )}
                  />
                  {COMPLIANCE_LABEL[b]}{" "}
                  <span className="font-semibold text-fg tabular-nums">
                    {formatInt(c.buckets[b])}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Quadros: frotas com preventiva crítica, vencida e a programar
// ---------------------------------------------------------------------------

function PreventiveBoard({
  status,
  title,
  hint,
  icon: Icon,
  badge,
  entries,
  canGenerate,
  pending,
  onSchedule,
  onOpenMaintenance,
}: (typeof BOARDS)[number] & {
  entries: BoardEntry[];
  canGenerate: boolean;
  pending: boolean;
  onSchedule: (entry: BoardEntry) => void;
  onOpenMaintenance: (id: string) => void;
}) {
  const [showAll, setShowAll] = React.useState(false);
  // Recolhido, sobra o cabeçalho tingido com a contagem — o quadro continua dizendo quantas frotas tem.
  const [open, setOpen] = React.useState(true);
  const titleId = React.useId();
  const bodyId = React.useId();
  const tone = STATUS_CARD[status];
  const visible = showAll ? entries : entries.slice(0, BOARD_PREVIEW);
  const exceededBoard = status !== "to_schedule";
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        "min-w-0 overflow-hidden rounded-md border bg-surface shadow-card",
        tone.border,
      )}
      data-testid={`maintenance-preventive-board-${status}`}
    >
      <header
        className={cn(
          "relative flex flex-wrap items-center gap-x-3 gap-y-1 py-2 pr-3 pl-4",
          open && "border-b",
          cardTone(status),
        )}
      >
        <ToneStripe status={status} />
        <h3
          id={titleId}
          className="flex min-w-0 items-center text-label font-semibold text-fg"
        >
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? bodyId : undefined}
            onClick={() => setOpen((v) => !v)}
            className="-ml-1.5 flex min-h-8 min-w-0 items-center gap-2 rounded-xs px-1.5 text-left hfm-focus-ring hover:bg-hover-overlay"
            data-testid={`maintenance-preventive-board-toggle-${status}`}
          >
            <Chevron className="size-4 shrink-0 text-fg-muted" aria-hidden />
            <Icon className={cn("size-4 shrink-0", tone.fg)} aria-hidden />
            <span>{title}</span>
            <Badge
              variant={badge}
              appearance="solid"
              size="sm"
              className="tabular-nums"
            >
              {formatInt(entries.length)}
              <span className="sr-only">
                {" "}
                {entries.length === 1 ? "frota" : "frotas"}
              </span>
            </Badge>
          </button>
        </h3>
        <p className="w-full text-caption text-fg-secondary sm:ml-auto sm:w-auto">
          {hint}
        </p>
      </header>

      {open ? (
        <div id={bodyId}>
          {entries.length === 0 ? (
            <p className="px-4 py-3 text-body-sm text-fg-muted">
              Nenhuma frota nesta situação.
            </p>
          ) : (
            <>
              <TableContainer
                tabIndex={0}
                className="isolate rounded-none border-0"
              >
                {/* Larguras em %, iguais nos três quadros: as colunas se alinham de um quadro para o outro. */}
                <Table layout="fixed" className="min-w-[64rem]">
                  <TableCaption className="sr-only">
                    {title}: placa, tipo de operação, local, tipo de
                    equipamento, ciclo, KM atual, KM previsto, KM excedido e
                    ação.
                  </TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 z-[2] w-[9%] border-r border-border-subtle bg-surface-secondary">
                        Placa
                      </TableHead>
                      <TableHead className="w-[14%]">
                        Tipo de operação
                      </TableHead>
                      <TableHead className="w-[10%]">Local</TableHead>
                      <TableHead className="w-[13%]">
                        Tipo de equipamento
                      </TableHead>
                      <TableHead className="w-[8%]">Ciclo</TableHead>
                      <TableHead numeric className="w-[10%]">
                        KM atual
                      </TableHead>
                      <TableHead numeric className="w-[9%]">
                        KM previsto
                      </TableHead>
                      <TableHead numeric className="w-[10%]">
                        KM excedido
                      </TableHead>
                      <TableHead className="w-[17%]">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((entry) => (
                      <BoardRow
                        key={entry.row.vehicleId}
                        entry={entry}
                        exceededBoard={exceededBoard}
                        canGenerate={canGenerate}
                        pending={pending}
                        onSchedule={() => onSchedule(entry)}
                        onOpenMaintenance={onOpenMaintenance}
                      />
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              {entries.length > BOARD_PREVIEW ? (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle px-3 py-1.5 text-caption text-fg-muted">
                  <span>
                    {showAll
                      ? `Todas as ${formatInt(entries.length)} frotas`
                      : `${formatInt(BOARD_PREVIEW)} de ${formatInt(entries.length)} frotas`}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-expanded={showAll}
                    onClick={() => setShowAll((v) => !v)}
                  >
                    {showAll
                      ? `Mostrar só as ${formatInt(BOARD_PREVIEW)} primeiras`
                      : `Mostrar todos (${formatInt(entries.length)})`}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

function BoardRow({
  entry,
  exceededBoard,
  canGenerate,
  pending,
  onSchedule,
  onOpenMaintenance,
}: {
  entry: BoardEntry;
  exceededBoard: boolean;
  canGenerate: boolean;
  pending: boolean;
  onSchedule: () => void;
  onOpenMaintenance: (id: string) => void;
}) {
  const { row, cycle, others } = entry;
  const vehicle = vehicleLabel(row.licensePlate, row.fleetCode);
  const tone = STATUS_CARD[cycle.status];
  const exceeded =
    cycle.kmExceeded != null && cycle.kmExceeded > 0 ? cycle.kmExceeded : null;
  const open = cycle.openMaintenance;

  return (
    <TableRow
      className="align-top"
      data-testid="maintenance-preventive-board-row"
    >
      <TableCell className="sticky left-0 z-[1] border-r border-border-subtle bg-surface py-2 align-top">
        <p className="font-semibold text-fg">
          {row.licensePlate ?? "Sem placa"}
        </p>
        <p className="text-caption text-fg-muted">{row.fleetCode ?? "—"}</p>
      </TableCell>
      <TableCell className="py-2 align-top text-fg-secondary">
        {row.operationName ?? "Sem operação"}
      </TableCell>
      <TableCell className="py-2 align-top text-fg-secondary">
        {row.cityName ?? "—"}
      </TableCell>
      <TableCell className="py-2 align-top text-fg-secondary">
        {row.typeName ?? NO_TYPE_LABEL}
      </TableCell>
      <TableCell className="py-2 align-top">
        <p className="font-semibold text-fg">MP{cycle.number}</p>
        {others.length ? (
          <p
            className="text-caption text-fg-muted"
            title={`Também pendentes: ${others.map((c) => `MP${c.number} (${PREVENTIVE_STATUS_LABEL[c.status]})`).join(", ")}`}
          >
            +{others.length}{" "}
            {others.length === 1 ? "ciclo pendente" : "ciclos pendentes"}
          </p>
        ) : null}
      </TableCell>
      <TableCell numeric className="py-2 align-top">
        <p className="whitespace-nowrap text-fg">{formatKm(row.currentKm)}</p>
        <p className="whitespace-nowrap text-caption text-fg-muted">
          {row.currentKmDate
            ? `em ${formatDate(row.currentKmDate)}`
            : "sem leitura"}
        </p>
      </TableCell>
      <TableCell numeric className="whitespace-nowrap py-2 align-top text-fg">
        {formatKm(cycle.milestoneKm)}
      </TableCell>
      <TableCell numeric className="py-2 align-top">
        {exceeded != null ? (
          <p className={cn("whitespace-nowrap font-semibold", tone.fg)}>
            +{formatKm(exceeded)}
          </p>
        ) : (
          <>
            <p className="text-fg-muted">
              <span aria-hidden>—</span>
              <span className="sr-only">Sem KM excedido</span>
            </p>
            {!exceededBoard && cycle.kmRemaining != null ? (
              <p className="whitespace-nowrap text-caption text-fg-muted">
                faltam {formatKm(cycle.kmRemaining)}
              </p>
            ) : null}
          </>
        )}
      </TableCell>
      <TableCell className="py-1.5 align-top">
        {open ? (
          <div className="flex flex-col items-start py-0.5">
            <button
              type="button"
              className="rounded-xs text-left font-semibold text-link underline-offset-2 hover:underline hfm-focus-ring"
              onClick={() => onOpenMaintenance(open.id)}
              aria-label={`Abrir a manutenção ${open.code} do MP${cycle.number} de ${vehicle}`}
            >
              {open.code}
            </button>
            <span className="text-caption text-fg-muted">
              {STATUS_LABEL[open.status] ?? open.status}
            </span>
          </div>
        ) : canGenerate ? (
          <Button
            size="sm"
            variant="outline"
            leadingIcon={<CalendarPlus />}
            onClick={onSchedule}
            disabled={pending}
            aria-label={`Nova manutenção preventiva: agendar o MP${cycle.number} de ${vehicle}`}
            data-testid="maintenance-preventive-new"
          >
            Nova manutenção
          </Button>
        ) : (
          <span className="text-fg-muted">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// Grupo por tipo de equipamento, linha e célula
// ---------------------------------------------------------------------------

function MatrixGroup({
  group,
  open,
  onToggle,
  canGenerate,
  onGenerate,
  onOpenMaintenance,
}: {
  group: MatrixGroupData;
  open: boolean;
  onToggle: () => void;
  canGenerate: boolean;
  onGenerate: (cycle: PreventiveCycleCell, row: PreventiveMatrixRow) => void;
  onOpenMaintenance: (id: string) => void;
}) {
  // "Mostrar mais" local ao grupo: a página nasce leve mesmo com a frota inteira no recorte.
  const [limit, setLimit] = React.useState(GROUP_INITIAL);
  const id = React.useId();
  const maxCycle = React.useMemo(
    () =>
      group.rows.reduce(
        (max, r) => r.cycles.reduce((m, c) => Math.max(m, c.number), max),
        0,
      ),
    [group.rows],
  );
  const cycleNumbers = React.useMemo(
    () => Array.from({ length: maxCycle }, (_, i) => i + 1),
    [maxCycle],
  );
  const shown = group.rows.slice(0, limit);
  const rest = group.rows.length - shown.length;
  const next = Math.min(GROUP_STEP, rest);
  const pendingCounts = (["critical", "due", "to_schedule"] as const).filter(
    (code) => group.counts[code] > 0,
  );

  return (
    <section
      className="min-w-0 overflow-hidden rounded-md border border-border"
      aria-labelledby={`${id}-title`}
      data-testid="maintenance-preventive-group"
      data-type={group.label}
    >
      <h4 className="text-body-sm">
        <button
          type="button"
          id={`${id}-title`}
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={onToggle}
          className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 bg-surface-secondary px-3 py-2 text-left hfm-transition hfm-focus-ring hover:bg-surface-hover"
        >
          <span className="flex min-w-0 items-center gap-2">
            <ChevronRight
              className={cn(
                "size-4 shrink-0 text-fg-muted hfm-transition",
                open && "rotate-90",
              )}
              aria-hidden
            />
            <span className="truncate font-semibold text-fg">
              {group.label}
            </span>
            <span className="shrink-0 text-caption font-normal text-fg-muted">
              {formatInt(group.rows.length)}{" "}
              {group.rows.length === 1 ? "veículo" : "veículos"}
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
            {pendingCounts.length ? (
              pendingCounts.map((code) => (
                <StatusChip
                  key={code}
                  status={code}
                  count={group.counts[code]}
                />
              ))
            ) : (
              <span className="text-caption font-normal text-fg-muted">
                Sem ciclos pendentes
              </span>
            )}
          </span>
        </button>
      </h4>
      <div id={`${id}-body`} hidden={!open}>
        {open ? (
          <>
            {/* `isolate`: o cabeçalho fixo (z-20) fica contido na tabela e nunca passa por cima da barra do topo. */}
            <TableContainer
              tabIndex={0}
              stickyHeader
              maxHeight="72vh"
              className="isolate rounded-none border-x-0 border-b-0"
            >
              <Table
                layout="fixed"
                style={{ minWidth: `${16 + Math.max(maxCycle, 1) * 10.5}rem` }}
              >
                <TableCaption className="sr-only">
                  Matriz preventiva de {group.label}: veículos nas linhas,
                  ciclos MP nas colunas.
                </TableCaption>
                <TableHeader>
                  <TableRow>
                    {/* Veículo, modelo, operação e KM numa coluna fixa: a rolagem horizontal
                        fica toda para os ciclos MP, que é o que se compara. */}
                    <TableHead className="left-0 z-20! w-[12.5rem] border-r border-border sm:w-[16rem]">
                      Veículo · KM atual
                    </TableHead>
                    {cycleNumbers.length ? (
                      cycleNumbers.map((n) => (
                        <TableHead key={n} className="w-[10.5rem]">
                          MP{n}
                        </TableHead>
                      ))
                    ) : (
                      <TableHead className="w-[10.5rem]">Ciclos MP</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((row) => (
                    <MatrixRow
                      key={row.vehicleId}
                      row={row}
                      cycleNumbers={cycleNumbers}
                      canGenerate={canGenerate}
                      onGenerate={(cycle) => onGenerate(cycle, row)}
                      onOpenMaintenance={onOpenMaintenance}
                    />
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            {group.rows.length > GROUP_INITIAL ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-1.5 text-caption text-fg-muted">
                <span>
                  {formatInt(shown.length)} de {formatInt(group.rows.length)}{" "}
                  veículos
                </span>
                <div className="flex flex-wrap items-center gap-1">
                  {rest > 0 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setLimit((v) => v + GROUP_STEP)}
                      aria-label={`Mostrar mais ${formatInt(next)} veículos de ${group.label}`}
                    >
                      Mostrar mais {formatInt(next)}
                    </Button>
                  ) : null}
                  {limit > GROUP_INITIAL ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setLimit(GROUP_INITIAL)}
                    >
                      Mostrar menos
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

function MatrixRow({
  row,
  cycleNumbers,
  canGenerate,
  onGenerate,
  onOpenMaintenance,
}: {
  row: PreventiveMatrixRow;
  cycleNumbers: number[];
  canGenerate: boolean;
  onGenerate: (cycle: PreventiveCycleCell) => void;
  onOpenMaintenance: (id: string) => void;
}) {
  const byNumber = new Map(row.cycles.map((c) => [c.number, c]));
  const warnings = diagnosticsOf(row);
  const label = vehicleLabel(row.licensePlate, row.fleetCode);
  // O tipo já está no cabeçalho do grupo: aqui vai o modelo (e a subcategoria).
  const model = [row.modelName, row.subcategoryName]
    .filter(Boolean)
    .join(" · ");

  return (
    <TableRow className="align-top" data-testid="maintenance-preventive-row">
      <TableCell className="sticky left-0 z-[1] border-r border-border bg-surface py-2 align-top">
        <div className="flex items-start gap-1.5">
          <div className="min-w-0 flex-1">
            <p
              className="truncate text-label font-semibold text-fg"
              title={label}
            >
              {row.fleetCode ?? "—"}{" "}
              <span className="font-normal text-fg-muted">
                {row.licensePlate ?? ""}
              </span>
            </p>
            <p
              className="truncate text-caption text-fg-secondary"
              title={[row.typeName, row.modelName, row.subcategoryName]
                .filter(Boolean)
                .join(" · ")}
            >
              {model || row.typeName || "—"}
            </p>
            <p
              className="truncate text-caption text-fg-muted"
              title={[row.operationName, row.cityName]
                .filter(Boolean)
                .join(" · ")}
            >
              {[row.operationName ?? "Sem operação", row.cityName]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <p className="text-caption tabular-nums text-fg">
              {formatKm(row.currentKm)}
              <span className="text-fg-muted">
                {row.currentKmDate
                  ? ` em ${formatDate(row.currentKmDate)}`
                  : " · sem leitura"}
              </span>
            </p>
            {row.vehicleStatus !== "active" ? (
              <Badge size="sm" variant="neutral" className="mt-0.5">
                Inativo
              </Badge>
            ) : null}
          </div>
          {warnings.length ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="mt-0.5 shrink-0 rounded-xs text-warning hfm-focus-ring"
                  aria-label={`Avisos de ${label}: ${warnings.join(" ")}`}
                >
                  <AlertTriangle className="size-4" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-72">
                <ul className="flex flex-col gap-1">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </TableCell>
      {row.cycles.length === 0 ? (
        <TableCell
          colSpan={Math.max(cycleNumbers.length, 1)}
          className="py-2 align-top"
        >
          <p className="flex items-start gap-1.5 text-caption text-fg-secondary">
            <AlertTriangle
              className="mt-px size-3.5 shrink-0 text-warning"
              aria-hidden
            />
            <span>
              {warnings.join(" ") ||
                "Nenhum ciclo preventivo para este veículo."}
            </span>
          </p>
        </TableCell>
      ) : (
        cycleNumbers.map((n) => {
          const cycle = byNumber.get(n);
          return (
            <TableCell key={n} className="px-1.5 py-1.5 align-top">
              {cycle ? (
                <CycleCell
                  cycle={cycle}
                  vehicle={label}
                  canGenerate={canGenerate}
                  onGenerate={() => onGenerate(cycle)}
                  onOpenMaintenance={onOpenMaintenance}
                />
              ) : (
                <span className="flex h-full items-center justify-center text-fg-muted">
                  <span aria-hidden>—</span>
                  <span className="sr-only">Sem ciclo MP{n}</span>
                </span>
              )}
            </TableCell>
          );
        })
      )}
    </TableRow>
  );
}

function CycleCell({
  cycle,
  vehicle,
  canGenerate,
  onGenerate,
  onOpenMaintenance,
}: {
  cycle: PreventiveCycleCell;
  vehicle: string;
  canGenerate: boolean;
  onGenerate: () => void;
  onOpenMaintenance: (id: string) => void;
}) {
  const tone = STATUS_CARD[cycle.status] ?? STATUS_CARD.not_reached;
  const done = cycle.status === "completed";
  const actionable =
    canGenerate && ACTIONABLE.includes(cycle.status) && !cycle.openMaintenance;
  const bal = balance(cycle);
  const adherence = adherenceText(cycle);

  return (
    <div
      className={cn(
        "relative flex min-h-[5.5rem] flex-col items-start gap-1 overflow-hidden rounded-sm border py-1.5 pl-3 pr-2 text-caption",
        cardTone(cycle.status),
      )}
      data-status={cycle.status}
    >
      <ToneStripe status={cycle.status} />
      <CycleStatusBadge status={cycle.status} />
      <span
        className="font-semibold text-fg tabular-nums"
        title="Marco do ciclo"
      >
        <span className="sr-only">Marco </span>
        {formatKm(cycle.milestoneKm)}
      </span>
      {done ? (
        <>
          <span className="text-fg-secondary tabular-nums">
            {formatDate(cycle.completedOn)}
            {cycle.completedKm != null
              ? ` · ${formatKm(cycle.completedKm)}`
              : ""}
          </span>
          {adherence ? (
            <span className="text-fg-secondary">{adherence}</span>
          ) : null}
          {cycle.completedMaintenanceId ? (
            <button
              type="button"
              className="rounded-xs font-medium text-link underline-offset-2 hover:underline hfm-focus-ring"
              onClick={() => onOpenMaintenance(cycle.completedMaintenanceId!)}
              aria-label={`Ver a manutenção que realizou o MP${cycle.number} de ${vehicle}`}
            >
              Ver manutenção
            </button>
          ) : null}
        </>
      ) : (
        <span
          className={cn(
            "tabular-nums",
            bal.exceeded ? cn("font-semibold", tone.fg) : "text-fg-secondary",
          )}
          title={bal.title}
        >
          {bal.text}
        </span>
      )}
      {cycle.openMaintenance ? (
        <button
          type="button"
          className="rounded-xs text-left font-semibold text-link underline-offset-2 hover:underline hfm-focus-ring"
          onClick={() => onOpenMaintenance(cycle.openMaintenance!.id)}
          aria-label={`Abrir a manutenção ${cycle.openMaintenance.code} do MP${cycle.number} de ${vehicle}`}
        >
          {cycle.openMaintenance.code}
          <span className="font-normal text-fg-secondary">
            {" "}
            ·{" "}
            {STATUS_LABEL[cycle.openMaintenance.status] ??
              cycle.openMaintenance.status}
          </span>
        </button>
      ) : null}
      {actionable ? (
        <Button
          size="sm"
          variant="outline"
          leadingIcon={<CalendarPlus />}
          className="mt-auto h-7 w-full justify-center px-2 text-caption"
          onClick={onGenerate}
          aria-label={`Gerar manutenção para o MP${cycle.number} de ${vehicle}`}
          data-testid="maintenance-preventive-generate"
        >
          Gerar
        </Button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nova manutenção preventiva: agendamento do ciclo
// ---------------------------------------------------------------------------

function ScheduleCycleDialog({
  target,
  today,
  catalog,
  canSchedule,
  onOpenChange,
  actions,
}: {
  target: ScheduleTarget | null;
  today: string;
  catalog: MaintenanceCatalog;
  canSchedule: boolean;
  onOpenChange: (open: boolean) => void;
  actions: PanelActions;
}) {
  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent
        size="md"
        data-testid="maintenance-preventive-schedule-dialog"
      >
        {target ? (
          <ScheduleCycleForm
            key={target.cycle.id}
            target={target}
            today={today}
            catalog={catalog}
            canSchedule={canSchedule}
            onOpenChange={onOpenChange}
            actions={actions}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ScheduleCycleForm({
  target,
  today,
  catalog,
  canSchedule,
  onOpenChange,
  actions,
}: {
  target: ScheduleTarget;
  today: string;
  catalog: MaintenanceCatalog;
  canSchedule: boolean;
  onOpenChange: (open: boolean) => void;
  actions: PanelActions;
}) {
  const { toast } = useToast();
  const [busy, startTransition] = React.useTransition();
  const [date, setDate] = React.useState("");
  const [supplier, setSupplier] = React.useState("");
  const { cycle, row, origin } = target;
  const vehicle = vehicleLabel(row.licensePlate, row.fleetCode);
  const suppliers = React.useMemo(
    () =>
      catalog.suppliers
        .filter((s) => s.status === "active")
        .map((s) => ({ id: s.id, label: s.tradeName || s.name }))
        .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    [catalog.suppliers],
  );
  const bal = balance(cycle);
  const scheduledDate = canSchedule ? date || null : null;
  const context = [row.typeName, row.operationName, row.cityName]
    .filter(Boolean)
    .join(" · ");

  const submit = () =>
    startTransition(async () => {
      const result = await schedulePreventiveCycle(cycle.id, {
        scheduledDate,
        supplierId: supplier || null,
      });
      if (!result.ok || !result.data) {
        toast({
          title:
            result.error ?? "Não foi possível criar a manutenção preventiva.",
          variant: "danger",
        });
        return;
      }
      const { id, code, created } = result.data;
      onOpenChange(false);
      if (created === false) {
        toast({
          title: `Já existia a manutenção ${code}.`,
          description: "Nenhuma nova foi criada para este ciclo.",
          variant: "info",
        });
      } else {
        toast({
          title: scheduledDate
            ? `Manutenção ${code} criada e agendada.`
            : `Manutenção ${code} criada.`,
          description: scheduledDate
            ? `Preventiva MP${cycle.number} de ${vehicle} agendada para ${formatDate(scheduledDate)}.`
            : `Preventiva MP${cycle.number} de ${vehicle} · Há agendar.`,
          variant: "success",
        });
      }
      actions.refresh();
      actions.openMaintenance(id);
    });

  return (
    <>
      <DialogHeader>
        {/* O título repete o botão que abriu o diálogo ("Nova manutenção" no quadro, "Gerar" na matriz). */}
        <DialogTitle>
          {origin === "matrix"
            ? "Gerar manutenção preventiva"
            : "Nova manutenção preventiva"}
        </DialogTitle>
        <DialogDescription>
          Agendamento do MP{cycle.number} · marco {formatKm(cycle.milestoneKm)}{" "}
          · {vehicle}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4">
        <div
          className={cn(
            "relative flex flex-col gap-1 overflow-hidden rounded-sm border py-2 pl-4 pr-3",
            cardTone(cycle.status),
          )}
        >
          <ToneStripe status={cycle.status} />
          <div className="flex flex-wrap items-center gap-2 text-body-sm">
            <CycleStatusBadge status={cycle.status} />
            <span
              className={cn(
                "tabular-nums",
                bal.exceeded
                  ? cn("font-semibold", STATUS_CARD[cycle.status].fg)
                  : "text-fg-secondary",
              )}
            >
              {bal.title}
            </span>
          </div>
          <p className="text-caption text-fg-secondary">
            {context ? `${context} · ` : ""}KM atual {formatKm(row.currentKm)}
          </p>
        </div>
        {canSchedule ? (
          <FormField
            label="Data do agendamento"
            labelHint="Opcional"
            helperText="Sem data, a manutenção é criada como Há agendar; com data, já nasce agendada."
          >
            <DateInput
              value={date}
              min={today || undefined}
              onChange={(e) => setDate(e.target.value)}
            />
          </FormField>
        ) : (
          <p className="text-caption text-fg-muted">
            A manutenção é criada como Há agendar; o agendamento fica com quem
            tem permissão de agendar.
          </p>
        )}
        <FormField label="Fornecedor" labelHint="Opcional">
          <NativeSelect
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
          >
            <option value="">Definir depois</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <p className="text-caption text-fg-muted">
          O serviço e a prioridade vêm do parâmetro preventivo. Se o ciclo já
          tiver manutenção aberta, nenhuma nova é criada: a existente é aberta.
        </p>
      </DialogBody>
      <DialogFooter>
        <Button
          variant="secondary"
          onClick={() => onOpenChange(false)}
          disabled={busy}
        >
          Cancelar
        </Button>
        <Button
          leadingIcon={<CalendarPlus />}
          onClick={submit}
          loading={busy}
          data-testid="maintenance-preventive-schedule-submit"
        >
          {scheduledDate ? "Criar e agendar" : "Criar manutenção"}
        </Button>
      </DialogFooter>
    </>
  );
}
