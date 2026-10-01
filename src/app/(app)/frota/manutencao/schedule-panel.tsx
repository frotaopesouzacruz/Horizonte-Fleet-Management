"use client";

import * as React from "react";
import {
  AlertTriangle,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarX,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleCheck,
  ClipboardList,
  Hourglass,
  Info,
  MapPin,
  Plus,
  Timer,
  Wrench,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KpiCard, type KpiStatus } from "@/components/ui/kpi-card";
import { statusTone } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { MaintenanceTypeBadge } from "@/components/maintenance/badges";
import {
  formatDate,
  formatDateTime,
  formatHours,
  formatInt,
  STATUS_LABEL,
  STATUS_TONE,
  vehicleLabel,
  type MaintenanceCatalog,
  type MaintenanceFilters,
  type MaintenanceRow,
  type MaintenanceSortKey,
  type MaintenanceStatus,
  type ScheduleKpis,
  type ScheduleQueue,
} from "@/lib/maintenance/types";
import { SORT_LABEL } from "./maintenance-table";
import type { ListState, MaintenancePerms, MaintenanceViewData, PanelActions } from "./shared";

/**
 * Programação & execução — o funil do dia a dia.
 *
 * Nove indicadores do banco (mesmas definições das filas da lista: o cartão e
 * a lista que ele abre contam a mesma coisa) e a fila aberta inteira, num
 * quadro por situação, agrupada por operação e cidade. A situação muda na
 * gaveta de detalhe, nunca aqui.
 */

export interface SchedulePanelProps {
  schedule: NonNullable<MaintenanceViewData["schedule"]>;
  filters: MaintenanceFilters;
  catalog: MaintenanceCatalog;
  perms: MaintenancePerms;
  actions: PanelActions;
}

type CardFilter = { kind: "status"; status: MaintenanceStatus } | { kind: "queue"; queue: ScheduleQueue };

interface CardDef {
  id: string;
  label: string;
  filter: CardFilter;
  icon: React.ReactNode;
  value: (k: ScheduleKpis) => number;
  period: (k: ScheduleKpis) => string;
  /** Tom da borda; alertas só se colorem quando há ocorrência. */
  tone: (n: number) => KpiStatus;
}

const alert = (tone: KpiStatus) => (n: number): KpiStatus => (n > 0 ? tone : "neutral");

const CARDS: CardDef[] = [
  {
    id: "to_schedule",
    label: "Há agendar",
    filter: { kind: "status", status: "to_schedule" },
    icon: <ClipboardList />,
    value: (k) => k.toSchedule,
    period: () => "aguardando data de agendamento",
    tone: () => "neutral",
  },
  {
    id: "scheduled",
    label: "Agendadas",
    filter: { kind: "status", status: "scheduled" },
    icon: <CalendarCheck />,
    value: (k) => k.scheduled,
    period: () => "com data marcada na oficina",
    tone: () => "info",
  },
  {
    id: "in_progress",
    label: "Em execução",
    filter: { kind: "status", status: "in_progress" },
    icon: <Wrench />,
    value: (k) => k.inProgress,
    period: () => "com entrada registrada",
    tone: () => "accent",
  },
  {
    id: "scheduled_today",
    label: "Agendadas hoje",
    filter: { kind: "queue", queue: "scheduled_today" },
    icon: <CalendarDays />,
    value: (k) => k.scheduledToday,
    period: (k) => `entrada prevista em ${formatDate(k.today)}`,
    tone: alert("primary"),
  },
  {
    id: "exit_overdue",
    label: "Previsão de saída vencida",
    filter: { kind: "queue", queue: "exit_overdue" },
    icon: <CalendarX />,
    value: (k) => k.exitOverdue,
    period: () => "em execução, previsão já passou",
    tone: alert("danger"),
  },
  {
    id: "unscheduled_overdue",
    label: "Vencidas sem agendamento",
    filter: { kind: "queue", queue: "unscheduled_overdue" },
    icon: <Hourglass />,
    value: (k) => k.unscheduledOverdue,
    period: (k) => `há mais de ${formatInt(k.scheduleOverdueDays)} dias`,
    tone: alert("warning"),
  },
  {
    id: "late_entry",
    label: "Atrasadas para entrada",
    filter: { kind: "queue", queue: "late_entry" },
    icon: <CalendarClock />,
    value: (k) => k.lateEntry,
    period: () => "agendamento passou sem entrada",
    tone: alert("warning"),
  },
  {
    id: "over_sla",
    label: "Acima do SLA",
    filter: { kind: "queue", queue: "over_sla" },
    icon: <Timer />,
    value: (k) => k.overSla,
    period: (k) => `em execução · padrão ${formatInt(k.defaultSlaHours)} h`,
    tone: alert("danger"),
  },
  {
    id: "completed_today",
    label: "Concluídas hoje",
    filter: { kind: "queue", queue: "completed_today" },
    icon: <CircleCheck />,
    value: (k) => k.completedToday,
    period: () => "saída registrada hoje",
    tone: alert("success"),
  },
];

const QUEUE_LABEL: Record<ScheduleQueue, string> = {
  scheduled_today: "Agendadas hoje",
  late_entry: "Atrasadas para entrada",
  exit_overdue: "Previsão de saída vencida",
  unscheduled_overdue: "Vencidas sem agendamento",
  over_sla: "Acima do SLA",
  completed_today: "Concluídas hoje",
};

/** Um KPI clicável: o cartão é o desenho, o botão por cima é o controle. */
function QueueCard({
  def,
  kpis,
  active,
  disabled,
  onToggle,
}: {
  def: CardDef;
  kpis: ScheduleKpis;
  active: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const value = def.value(kpis);
  const period = def.period(kpis);
  return (
    <div className="relative min-w-0">
      <KpiCard
        aria-hidden
        size="compact"
        label={def.label}
        value={formatInt(value)}
        icon={def.icon}
        status={def.tone(value)}
        period={
          active ? (
            <>
              <span className="font-semibold text-primary-soft-fg">Filtrando a lista</span> · {period}
            </>
          ) : (
            period
          )
        }
        className={cn("h-full", active && "border-primary ring-2 ring-primary")}
      />
      <button
        type="button"
        aria-pressed={active}
        disabled={disabled}
        onClick={onToggle}
        data-testid={`maintenance-kpi-${def.id}`}
        aria-label={`${def.label}: ${formatInt(value)} (${period}). ${active ? "Remover o filtro da lista" : "Filtrar a lista"}`}
        className="absolute inset-0 rounded-md hfm-transition hfm-focus-ring hover:bg-hover-overlay disabled:cursor-wait"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quadros por situação
// ---------------------------------------------------------------------------

/** Ordem do funil; o que vier fora dela (ex.: um filtro de situação) entra depois. */
const FUNNEL: MaintenanceStatus[] = ["to_schedule", "scheduled", "in_progress", "completed", "not_performed", "cancelled"];

const BOARD_TITLE: Record<MaintenanceStatus, string> = {
  to_schedule: "Há agendar",
  scheduled: "Agendadas",
  in_progress: "Em execução",
  completed: "Concluídas",
  cancelled: "Canceladas",
  not_performed: "Não realizadas",
};

const BOARD_HINT: Partial<Record<MaintenanceStatus, string>> = {
  to_schedule: "aguardando data de agendamento",
  scheduled: "com data marcada na oficina",
  in_progress: "com entrada registrada na oficina",
  completed: "com saída registrada",
};

type ColumnKey = "code" | "vehicle" | "services" | "supplier" | "requested" | "scheduled" | "entry" | "exit" | "age" | "duration";

interface BoardColumn {
  key: ColumnKey;
  label: string;
  /** Largura fixa em px; sem ela a coluna (Serviços) fica com o que sobrar. */
  width?: number;
  sort?: MaintenanceSortKey;
  numeric?: boolean;
  hint?: string;
  /** Coluna que decide a fila deste quadro (ex.: agendamento, previsão). */
  strong?: boolean;
}

/** Largura mínima de Serviços: abaixo disso a tabela rola na horizontal. */
const ELASTIC_MIN = 190;

/**
 * Cada quadro mostra só as datas que fazem sentido na sua etapa — um "Há
 * agendar" não tem agendamento nem entrada; uma "Em execução" se mede pela
 * entrada e pela previsão de saída.
 */
function boardColumns(status: MaintenanceStatus): BoardColumn[] {
  const base: BoardColumn[] = [
    { key: "code", label: "Código / tipo", width: 172, sort: "code" },
    { key: "vehicle", label: "Veículo", width: 144, sort: "plate" },
    { key: "services", label: "Serviços" },
    { key: "supplier", label: "Fornecedor", width: 156 },
  ];
  const requested: BoardColumn = { key: "requested", label: "Solicitação", width: 128, sort: "requested" };
  const scheduled: BoardColumn = { key: "scheduled", label: "Agendamento", width: 148, sort: "scheduled", strong: true };
  const entry: BoardColumn = { key: "entry", label: "Entrada", width: 148, sort: "entry" };
  const exit = (label: string, width = 168): BoardColumn => ({ key: "exit", label, width, sort: "exit", strong: true });
  const age = (hint: string): BoardColumn => ({ key: "age", label: "Aberta há", width: 92, numeric: true, hint });
  switch (status) {
    case "to_schedule":
      return [...base, { ...requested, strong: true }, age("Dias desde a solicitação")];
    case "scheduled":
      return [...base, scheduled, exit("Previsão de saída"), age("Dias desde a solicitação")];
    case "in_progress":
      return [...base, entry, exit("Previsão de saída"), age("Dias desde a entrada na oficina")];
    case "completed":
      return [
        ...base,
        entry,
        exit("Saída", 148),
        { key: "duration", label: "TMM", width: 100, sort: "duration", numeric: true, hint: "Tempo de manutenção: da entrada real à saída real" },
      ];
    default:
      return [...base, requested, { ...scheduled, strong: false }, entry, { ...exit("Saída / previsão"), strong: false }];
  }
}

interface CityGroup {
  key: string;
  label: string;
  missing: boolean;
  rows: MaintenanceRow[];
}

interface OperationGroup {
  key: string;
  label: string;
  missing: boolean;
  total: number;
  lateEntry: number;
  exitOverdue: number;
  cities: CityGroup[];
}

const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });
const byLabel = (a: { label: string; missing: boolean }, b: { label: string; missing: boolean }) =>
  Number(a.missing) - Number(b.missing) || collator.compare(a.label, b.label);

/** Operação → Cidade/UF, na ordem alfabética; "Sem operação" e "Sem cidade" por último. A ordem das linhas é a do servidor. */
function groupByLocation(rows: MaintenanceRow[]): OperationGroup[] {
  const ops = new Map<string, OperationGroup & { cityMap: Map<string, CityGroup> }>();
  for (const row of rows) {
    const opKey = row.operationId ?? (row.operationName ? `n:${row.operationName}` : "none");
    let op = ops.get(opKey);
    if (!op) {
      op = {
        key: opKey,
        label: row.operationName ?? "Sem operação",
        missing: !row.operationName,
        total: 0,
        lateEntry: 0,
        exitOverdue: 0,
        cities: [],
        cityMap: new Map(),
      };
      ops.set(opKey, op);
    }
    op.total += 1;
    if (row.lateEntry) op.lateEntry += 1;
    if (row.exitOverdue) op.exitOverdue += 1;

    const cityKey = row.cityId != null ? `c:${row.cityId}` : row.cityName ? `n:${row.cityName}/${row.stateUf ?? ""}` : `uf:${row.stateUf ?? ""}`;
    let city = op.cityMap.get(cityKey);
    if (!city) {
      city = {
        key: cityKey,
        label: row.cityName
          ? `${row.cityName}${row.stateUf ? `/${row.stateUf}` : ""}`
          : row.stateUf
            ? `Sem cidade (${row.stateUf})`
            : "Sem cidade",
        missing: !row.cityName,
        rows: [],
      };
      op.cityMap.set(cityKey, city);
    }
    city.rows.push(row);
  }
  return [...ops.values()]
    .map(({ cityMap, ...op }) => ({ ...op, cities: [...cityMap.values()].sort(byLabel) }))
    .sort(byLabel);
}

const plural = (n: number, one: string, many: string) => `${formatInt(n)} ${n === 1 ? one : many}`;

const dash = <span className="text-fg-muted">—</span>;

function Two({ main, sub, title }: { main: React.ReactNode; sub?: React.ReactNode; title?: string }) {
  return (
    <div className="flex min-w-0 flex-col" title={title}>
      <span className="truncate">{main}</span>
      {sub ? <span className="truncate text-caption text-fg-muted">{sub}</span> : null}
    </div>
  );
}

function ServicesCell({ row }: { row: MaintenanceRow }) {
  if (row.items.length === 0) return <span className="text-fg-muted">Sem serviços</span>;
  const [first, ...rest] = row.items;
  const clusters = [...new Set(row.items.map((i) => i.cluster))];
  const full = row.items.map((i) => `${i.cluster}: ${i.service}`).join("\n");
  return (
    <div className="flex min-w-0 flex-col" title={full}>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-fg">{first.service}</span>
        {rest.length > 0 ? (
          <Badge variant="neutral" size="sm" className="tabular-nums">
            <span aria-hidden>+{rest.length}</span>
            <span className="sr-only">e mais: {rest.map((i) => i.service).join(", ")}</span>
          </Badge>
        ) : null}
      </span>
      <span className="truncate text-caption text-fg-muted">{clusters.join(" · ")}</span>
    </div>
  );
}

function SupplierCell({ row }: { row: MaintenanceRow }) {
  if (!row.supplierName && !row.supplierNameInformed && !row.serviceOrderNumber) return dash;
  return (
    <Two
      main={
        row.supplierName ??
        (row.supplierNameInformed ? (
          <span className="text-fg-secondary">
            {row.supplierNameInformed} <span className="text-fg-muted">(fora do catálogo)</span>
          </span>
        ) : (
          <span className="text-fg-muted">Sem fornecedor</span>
        ))
      }
      sub={row.serviceOrderNumber ? `OS ${row.serviceOrderNumber}` : undefined}
      title={[
        row.supplierName ?? (row.supplierNameInformed ? `${row.supplierNameInformed} (informado na importação, fora do catálogo)` : null),
        row.serviceOrderNumber ? `OS ${row.serviceOrderNumber}` : null,
      ]
        .filter(Boolean)
        .join(" · ")}
    />
  );
}

const LateEntryBadge = () => (
  <Badge variant="warning" appearance="outline" size="sm" title="Agendada para uma data que já passou, sem entrada registrada">
    Entrada atrasada
  </Badge>
);
const ExitOverdueBadge = () => (
  <Badge variant="danger" appearance="outline" size="sm" title="Em execução com a previsão de saída já vencida">
    Saída vencida
  </Badge>
);
const ReopenBadge = ({ count }: { count: number }) => (
  <Badge variant="neutral" appearance="outline" size="sm" title={`Reaberta ${count} vez(es)`}>
    Reaberta{count > 1 ? ` ${count}×` : ""}
  </Badge>
);

/** Selos de alerta (todos calculados pelo banco), para os cartões do celular. */
function AlertBadges({ row }: { row: MaintenanceRow }) {
  return (
    <>
      {row.lateEntry ? <LateEntryBadge /> : null}
      {row.exitOverdue ? <ExitOverdueBadge /> : null}
      {row.reopenCount > 0 ? <ReopenBadge count={row.reopenCount} /> : null}
    </>
  );
}

function DurationValue({ row }: { row: MaintenanceRow }) {
  if (row.durationHours == null) return dash;
  const approx = row.durationPrecision === "date";
  return (
    <span title={approx ? "Aproximado: calculado só pelas datas, sem a hora de entrada ou de saída" : "Entrada e saída reais"}>
      {approx ? (
        <>
          <span aria-hidden>≈ </span>
          <span className="sr-only">aproximadamente </span>
        </>
      ) : null}
      {formatHours(row.durationHours)}
    </span>
  );
}

/** Data com o alerta que ela explica logo abaixo (entrada atrasada, saída vencida). */
function DateCell({ value, alertBadge, danger }: { value: string | null; alertBadge?: React.ReactNode; danger?: boolean }) {
  if (!value && !alertBadge) return dash;
  return (
    <div className="flex min-w-0 flex-col items-start gap-0.5">
      <span className={cn("truncate tabular-nums", danger && "text-danger-soft-fg")}>{value ?? "—"}</span>
      {alertBadge}
    </div>
  );
}

function exitValue(row: MaintenanceRow, column: BoardColumn) {
  if (row.exitDate) return formatDateTime(row.exitDate, row.exitTime);
  if (!row.expectedExitDate) return null;
  const value = formatDateTime(row.expectedExitDate, row.expectedExitTime);
  return column.label === "Saída / previsão" ? `Prev. ${value}` : value;
}

function renderCell(column: BoardColumn, row: MaintenanceRow, keys: Set<ColumnKey>, open: (id: string) => void) {
  switch (column.key) {
    case "code": {
      // Alerta cuja data não está neste quadro vai para junto do código.
      const orphanLate = row.lateEntry && !keys.has("scheduled");
      const orphanExit = row.exitOverdue && !keys.has("exit");
      return (
        <div className="flex min-w-0 flex-col items-start gap-0.5">
          <button
            type="button"
            data-testid="maintenance-row-open"
            onClick={(event) => {
              event.stopPropagation();
              open(row.id);
            }}
            aria-label={`Abrir manutenção ${row.code}`}
            className="rounded-xs font-semibold whitespace-nowrap text-link tabular-nums underline-offset-2 hfm-focus-ring hover:underline"
          >
            {row.code}
          </button>
          <span className="flex flex-wrap items-center gap-1">
            <MaintenanceTypeBadge type={row.type} name={row.typeName} />
            {row.reopenCount > 0 ? <ReopenBadge count={row.reopenCount} /> : null}
            {orphanLate ? <LateEntryBadge /> : null}
            {orphanExit ? <ExitOverdueBadge /> : null}
          </span>
        </div>
      );
    }
    case "vehicle":
      return (
        <Two
          main={<span className="font-medium text-fg">{vehicleLabel(row.licensePlate, row.fleetCode)}</span>}
          sub={row.leaderName ?? undefined}
          title={[vehicleLabel(row.licensePlate, row.fleetCode), row.leaderName].filter(Boolean).join(" · ")}
        />
      );
    case "services":
      return <ServicesCell row={row} />;
    case "supplier":
      return <SupplierCell row={row} />;
    case "requested":
      return row.requestedOn ? <span className="tabular-nums">{formatDate(row.requestedOn)}</span> : dash;
    case "scheduled":
      return (
        <DateCell
          value={row.scheduledDate ? formatDateTime(row.scheduledDate, row.scheduledTime) : null}
          alertBadge={row.lateEntry ? <LateEntryBadge /> : null}
        />
      );
    case "entry":
      return row.entryDate ? <span className="whitespace-nowrap tabular-nums">{formatDateTime(row.entryDate, row.entryTime)}</span> : dash;
    case "exit":
      return (
        <DateCell
          value={exitValue(row, column)}
          danger={row.exitOverdue && !row.exitDate}
          alertBadge={row.exitOverdue ? <ExitOverdueBadge /> : null}
        />
      );
    case "age":
      return row.ageDays == null ? dash : `${formatInt(row.ageDays)} d`;
    case "duration":
      return <DurationValue row={row} />;
  }
}

/** Rótulo e valor de uma coluna de data/tempo, para o cartão do celular. */
function cardField(column: BoardColumn, row: MaintenanceRow): { label: string; value: React.ReactNode } | null {
  switch (column.key) {
    case "requested":
      return { label: "Solicitação", value: formatDate(row.requestedOn) };
    case "scheduled":
      return { label: "Agendamento", value: formatDateTime(row.scheduledDate, row.scheduledTime) };
    case "entry":
      return { label: "Entrada", value: formatDateTime(row.entryDate, row.entryTime) };
    case "exit":
      return {
        label: row.exitDate ? "Saída" : "Previsão de saída",
        value: row.exitDate ? formatDateTime(row.exitDate, row.exitTime) : formatDateTime(row.expectedExitDate, row.expectedExitTime),
      };
    case "age":
      return { label: "Aberta há", value: row.ageDays == null ? "—" : `${formatInt(row.ageDays)} d` };
    case "duration":
      return { label: "TMM", value: <DurationValue row={row} /> };
    default:
      return null;
  }
}

function GroupToggle({
  level,
  label,
  missing,
  count,
  expanded,
  onToggle,
  extra,
  className,
}: {
  level: "operation" | "city";
  label: string;
  missing: boolean;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  extra?: React.ReactNode;
  className?: string;
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      className={cn(
        "flex min-h-8 max-w-full min-w-0 items-center gap-1.5 rounded-xs px-1 text-left text-body-sm hfm-focus-ring hover:bg-hover-overlay",
        className,
      )}
    >
      <Chevron className="size-4 shrink-0 text-fg-muted" aria-hidden />
      {level === "city" ? <MapPin className="size-3.5 shrink-0 text-fg-muted" aria-hidden /> : null}
      <span className="sr-only">{level === "operation" ? "Operação" : "Cidade"}: </span>
      <span
        className={cn(
          "truncate",
          level === "operation" ? "font-semibold text-fg" : "font-medium text-fg-secondary",
          missing && "text-fg-muted italic",
        )}
        title={label}
      >
        {label}
      </span>
      <Badge variant="neutral" size="sm" className="shrink-0 tabular-nums">
        {formatInt(count)}
        <span className="sr-only"> {count === 1 ? "manutenção" : "manutenções"}</span>
      </Badge>
      {extra}
    </button>
  );
}

/** Resumo dos alertas da operação: some quando o grupo está recolhido, então fica no cabeçalho. */
function OperationAlerts({ op }: { op: OperationGroup }) {
  if (!op.lateEntry && !op.exitOverdue) return null;
  return (
    <span className="hidden shrink-0 items-center gap-1 sm:inline-flex">
      {op.lateEntry ? (
        <Badge variant="warning" appearance="outline" size="sm" className="tabular-nums">
          {plural(op.lateEntry, "entrada atrasada", "entradas atrasadas")}
        </Badge>
      ) : null}
      {op.exitOverdue ? (
        <Badge variant="danger" appearance="outline" size="sm" className="tabular-nums">
          {plural(op.exitOverdue, "saída vencida", "saídas vencidas")}
        </Badge>
      ) : null}
    </span>
  );
}

function StatusBoard({
  status,
  rows,
  list,
  actions,
}: {
  status: MaintenanceStatus;
  rows: MaintenanceRow[];
  list: ListState;
  actions: PanelActions;
}) {
  const { navigate, openMaintenance } = actions;
  const uid = React.useId();
  const titleId = `${uid}-title`;
  const bodyId = `${uid}-body`;
  const title = BOARD_TITLE[status] ?? STATUS_LABEL[status] ?? status;
  const tone = statusTone(STATUS_TONE[status] ?? "neutral");

  const groups = React.useMemo(() => groupByLocation(rows), [rows]);
  const columns = React.useMemo(() => boardColumns(status), [status]);
  const keys = React.useMemo(() => new Set(columns.map((c) => c.key)), [columns]);
  const minWidth = columns.reduce((sum, c) => sum + (c.width ?? ELASTIC_MIN), 0);
  const cityCount = groups.reduce((sum, g) => sum + g.cities.length, 0);
  const collapsible = groups.length > 1 || cityCount > 1;

  // Sem escolha explícita: quadro aberto; com muitas operações, só a primeira vem aberta.
  const [boardOpen, setBoardOpen] = React.useState(true);
  const [openState, setOpenState] = React.useState<Record<string, boolean>>({});
  const opKey = (op: OperationGroup) => `o:${op.key}`;
  const cityKey = (op: OperationGroup, city: CityGroup) => `c:${op.key}|${city.key}`;
  const isOpOpen = (op: OperationGroup, index: number) => openState[opKey(op)] ?? (groups.length <= 3 || index === 0);
  const isCityOpen = (op: OperationGroup, city: CityGroup) => openState[cityKey(op, city)] ?? true;
  const toggle = (key: string, current: boolean) => setOpenState((s) => ({ ...s, [key]: !current }));
  const setAll = (value: boolean) =>
    setOpenState(
      Object.fromEntries(
        groups.flatMap((op) => [[opKey(op), value] as const, ...op.cities.map((c) => [cityKey(op, c), value] as const)]),
      ),
    );

  const onRowClick = (event: React.MouseEvent<HTMLTableRowElement>, id: string) => {
    // Botões dentro da linha têm ação própria.
    const row = event.currentTarget;
    const own = (event.target as HTMLElement).closest("a, button, input, select, textarea, [tabindex]");
    if (own && own !== row && row.contains(own)) return;
    openMaintenance(id);
  };
  const onSort = (key: MaintenanceSortKey) => (dir: "asc" | "desc") => navigate({ ordenar: key, dir, pagina: null });

  const BoardChevron = boardOpen ? ChevronDown : ChevronRight;
  const cardFields = columns.filter((c) => !["code", "vehicle", "services", "supplier"].includes(c.key));

  return (
    <section
      aria-labelledby={titleId}
      data-testid={`maintenance-schedule-board-${status}`}
      className="relative flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-surface"
    >
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1", tone.dotClassName)} />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 pt-3.5 pb-2.5 sm:px-4">
        <div className="flex min-w-0 flex-col">
          <h3 id={titleId} className="text-body font-semibold text-fg">
            <button
              type="button"
              aria-expanded={boardOpen}
              aria-controls={boardOpen ? bodyId : undefined}
              onClick={() => setBoardOpen((v) => !v)}
              className="-ml-1 flex min-h-8 items-center gap-2 rounded-xs px-1 text-left hfm-focus-ring hover:bg-hover-overlay"
            >
              <BoardChevron className="size-4 shrink-0 text-fg-muted" aria-hidden />
              <span className={cn("size-2.5 shrink-0 rounded-full", tone.dotClassName)} aria-hidden />
              <span>{title}</span>
              <Badge variant="neutral" size="md" className="tabular-nums">
                {formatInt(rows.length)}
                <span className="sr-only"> {rows.length === 1 ? "manutenção" : "manutenções"}</span>
              </Badge>
            </button>
          </h3>
          <p className="pl-[2.625rem] text-caption text-fg-muted">
            {[BOARD_HINT[status], plural(groups.length, "operação", "operações"), plural(cityCount, "cidade", "cidades")]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {boardOpen && collapsible ? (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" leadingIcon={<ChevronsUpDown />} onClick={() => setAll(true)}>
              Expandir tudo
            </Button>
            <Button variant="ghost" size="sm" leadingIcon={<ChevronsDownUp />} onClick={() => setAll(false)}>
              Recolher tudo
            </Button>
          </div>
        ) : null}
      </div>

      {boardOpen ? (
        <div id={bodyId} className="border-t border-border">
          {/* lg+: uma tabela por quadro, com as linhas de operação e de cidade entre as manutenções. */}
          <TableContainer
            tabIndex={0}
            stickyHeader
            maxHeight="max(24rem, calc(100dvh - 18rem))"
            className="hidden rounded-none border-0 lg:block"
          >
            <Table layout="fixed" style={{ minWidth }} aria-label={`${title}: manutenções por operação e cidade`}>
              <TableHeader>
                <TableRow>
                  {columns.map((column, index) => (
                    <TableHead
                      key={column.key}
                      style={{ width: column.width, left: index === 0 ? 0 : undefined, zIndex: index === 0 ? 21 : undefined }}
                      className={cn(index === 0 && "sticky border-r border-border bg-surface-secondary", column.strong && "text-fg")}
                      numeric={column.numeric}
                      title={column.hint}
                      sortable={Boolean(column.sort)}
                      sortDirection={column.sort && list.sort === column.sort ? list.dir : null}
                      onSort={column.sort ? onSort(column.sort) : undefined}
                    >
                      {column.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((op, opIndex) => {
                  const opOpen = isOpOpen(op, opIndex);
                  return (
                    <React.Fragment key={op.key}>
                      <TableRow
                        data-testid="maintenance-schedule-group"
                        data-level="operation"
                        className="border-b border-border hover:bg-transparent [&>td]:bg-surface-secondary"
                      >
                        <TableCell colSpan={columns.length} className="px-2 py-1">
                          <div className="sticky left-2 flex w-fit min-w-0 items-center gap-2">
                            <GroupToggle
                              level="operation"
                              label={op.label}
                              missing={op.missing}
                              count={op.total}
                              expanded={opOpen}
                              onToggle={() => toggle(opKey(op), opOpen)}
                            />
                            <span className="shrink-0 text-caption text-fg-muted">{plural(op.cities.length, "cidade", "cidades")}</span>
                            <OperationAlerts op={op} />
                          </div>
                        </TableCell>
                      </TableRow>
                      {opOpen
                        ? op.cities.map((city) => {
                            const cityOpen = isCityOpen(op, city);
                            return (
                              <React.Fragment key={city.key}>
                                <TableRow
                                  data-testid="maintenance-schedule-group"
                                  data-level="city"
                                  className="hover:bg-transparent"
                                >
                                  <TableCell colSpan={columns.length} className="py-0.5 pr-2 pl-5">
                                    <GroupToggle
                                      level="city"
                                      label={city.label}
                                      missing={city.missing}
                                      count={city.rows.length}
                                      expanded={cityOpen}
                                      onToggle={() => toggle(cityKey(op, city), cityOpen)}
                                      className="sticky left-5 w-fit"
                                    />
                                  </TableCell>
                                </TableRow>
                                {cityOpen
                                  ? city.rows.map((row) => (
                                      <TableRow
                                        key={row.id}
                                        data-testid="maintenance-row"
                                        onClick={(event) => onRowClick(event, row.id)}
                                        className="group h-(--table-row-height) cursor-pointer"
                                      >
                                        {columns.map((column, index) => (
                                          <TableCell
                                            key={column.key}
                                            numeric={column.numeric}
                                            style={{ left: index === 0 ? 0 : undefined, zIndex: index === 0 ? 1 : undefined }}
                                            className={cn(
                                              "py-1.5",
                                              index === 0 &&
                                                "sticky border-r border-border bg-surface pl-6 after:pointer-events-none after:absolute after:inset-0 after:bg-hover-overlay after:opacity-0 group-hover:after:opacity-100",
                                              column.strong ? "font-medium text-fg" : "text-fg-secondary",
                                            )}
                                          >
                                            {renderCell(column, row, keys, openMaintenance)}
                                          </TableCell>
                                        ))}
                                      </TableRow>
                                    ))
                                  : null}
                              </React.Fragment>
                            );
                          })
                        : null}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Abaixo de lg: os mesmos grupos, com cartões no lugar das linhas. */}
          <div className="flex flex-col lg:hidden">
            {groups.map((op, opIndex) => {
              const opOpen = isOpOpen(op, opIndex);
              return (
                <div
                  key={op.key}
                  data-testid="maintenance-schedule-group-mobile"
                  data-level="operation"
                  className="border-b border-border last:border-b-0"
                >
                  <div className="flex flex-wrap items-center gap-x-2 bg-surface-secondary px-2 py-1">
                    <GroupToggle
                      level="operation"
                      label={op.label}
                      missing={op.missing}
                      count={op.total}
                      expanded={opOpen}
                      onToggle={() => toggle(opKey(op), opOpen)}
                    />
                    <span className="text-caption text-fg-muted">{plural(op.cities.length, "cidade", "cidades")}</span>
                  </div>
                  {opOpen ? (
                    <div className="flex flex-col gap-2 px-3 pt-1 pb-3">
                      {op.cities.map((city) => {
                        const cityOpen = isCityOpen(op, city);
                        return (
                          <div key={city.key} data-testid="maintenance-schedule-group-mobile" data-level="city" className="flex flex-col gap-1.5">
                            <GroupToggle
                              level="city"
                              label={city.label}
                              missing={city.missing}
                              count={city.rows.length}
                              expanded={cityOpen}
                              onToggle={() => toggle(cityKey(op, city), cityOpen)}
                              className="-ml-1"
                            />
                            {cityOpen ? (
                              <ul className="flex flex-col gap-2" aria-label={`${title} · ${op.label} · ${city.label}`}>
                                {city.rows.map((row) => (
                                  <li key={row.id}>
                                    <button
                                      type="button"
                                      data-testid="maintenance-card"
                                      onClick={() => openMaintenance(row.id)}
                                      className="flex w-full flex-col gap-2 rounded-md border border-border bg-surface p-3 text-left hfm-transition hover:border-border-strong hfm-focus-ring"
                                    >
                                      <span className="flex w-full items-start justify-between gap-2">
                                        <span className="min-w-0">
                                          <span className="block truncate text-body-sm font-semibold text-fg tabular-nums">{row.code}</span>
                                          <span className="block truncate text-caption text-fg-secondary">
                                            {vehicleLabel(row.licensePlate, row.fleetCode)}
                                            {row.supplierName ? ` · ${row.supplierName}` : ""}
                                          </span>
                                        </span>
                                        <MaintenanceTypeBadge type={row.type} name={row.typeName} />
                                      </span>
                                      {row.lateEntry || row.exitOverdue || row.reopenCount > 0 ? (
                                        <span className="flex flex-wrap items-center gap-1">
                                          <AlertBadges row={row} />
                                        </span>
                                      ) : null}
                                      {row.items.length ? (
                                        <span className="line-clamp-2 text-caption text-fg-secondary">
                                          {row.items.map((i) => i.service).join(" · ")}
                                        </span>
                                      ) : null}
                                      <span className="grid w-full grid-cols-2 gap-x-3 gap-y-1 text-caption">
                                        {cardFields.map((column) => {
                                          const field = cardField(column, row);
                                          if (!field) return null;
                                          return (
                                            <span key={column.key} className="flex min-w-0 flex-col">
                                              <span className="text-fg-muted">{field.label}</span>
                                              <span className={cn("truncate text-fg tabular-nums", column.strong && "font-semibold")}>
                                                {field.value}
                                              </span>
                                            </span>
                                          );
                                        })}
                                      </span>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------
export function SchedulePanel(props: SchedulePanelProps) {
  const { schedule, filters, perms, actions } = props;
  const { kpis, page, list } = schedule;
  const { navigate, pending } = actions;

  const activeQueue = filters.queue ?? null;
  const activeStatus = !activeQueue && filters.status ? (filters.status as MaintenanceStatus) : null;
  const hasFilter = Boolean(activeQueue || filters.status);

  const isActive = (f: CardFilter) =>
    f.kind === "queue" ? activeQueue === f.queue : activeStatus === f.status;

  const clearQueue = () => navigate({ fila: null, situacao: null, pagina: null });

  const toggle = (f: CardFilter) => {
    if (isActive(f)) return clearQueue();
    if (f.kind === "queue") navigate({ fila: f.queue, pagina: null, situacao: null });
    else navigate({ situacao: f.status, fila: null, pagina: null });
  };

  const scope = activeQueue
    ? `Fila: ${QUEUE_LABEL[activeQueue]}`
    : filters.status
      ? `Situação: ${STATUS_LABEL[filters.status as MaintenanceStatus] ?? filters.status}`
      : "Em aberto: há agendar, agendadas e em execução";
  const order = `ordenada por ${SORT_LABEL[list.sort]} (${list.dir === "asc" ? "crescente" : "decrescente"})`;

  // Um quadro por situação presente, na ordem do funil; a ordem das linhas é a do servidor.
  const boards = React.useMemo(() => {
    const byStatus = new Map<MaintenanceStatus, MaintenanceRow[]>();
    for (const row of page?.rows ?? []) {
      const bucket = byStatus.get(row.status);
      if (bucket) bucket.push(row);
      else byStatus.set(row.status, [row]);
    }
    const rank = (s: MaintenanceStatus) => {
      const i = FUNNEL.indexOf(s);
      return i === -1 ? FUNNEL.length : i;
    };
    return [...byStatus.entries()].sort(([a], [b]) => rank(a) - rank(b));
  }, [page]);

  const newButton = perms.create ? (
    <Button size="sm" leadingIcon={<Plus />} onClick={() => actions.openWizard()} data-testid="maintenance-schedule-new">
      Nova manutenção
    </Button>
  ) : null;

  let content: React.ReactNode;
  if (!page) {
    content = (
      <ErrorState
        title="Não foi possível carregar as manutenções."
        description="A leitura da fila falhou. Os demais dados da tela seguem disponíveis."
        onRetry={actions.refresh}
        retryLabel="Tentar de novo"
        retrying={pending}
        data-testid="maintenance-table-error"
      />
    );
  } else if (page.rows.length === 0) {
    content = (
      <EmptyState
        variant="panel"
        title={hasFilter ? "Nenhuma manutenção nesta fila" : "Nenhuma manutenção em aberto"}
        description={
          hasFilter
            ? `Não há manutenções em “${activeQueue ? QUEUE_LABEL[activeQueue] : STATUS_LABEL[filters.status as MaintenanceStatus] ?? filters.status}” para os filtros escolhidos.`
            : "Não há manutenções há agendar, agendadas ou em execução para os filtros escolhidos."
        }
        action={
          hasFilter ? (
            <Button variant="secondary" size="sm" leadingIcon={<X />} onClick={clearQueue} disabled={pending}>
              Limpar fila
            </Button>
          ) : (
            newButton
          )
        }
        data-testid="maintenance-table-empty"
      />
    );
  } else {
    content = (
      <div className="flex min-w-0 flex-col gap-4" aria-busy={pending || undefined}>
        {page.total > page.rows.length ? (
          <p
            role="status"
            data-testid="maintenance-schedule-truncated"
            className="flex items-start gap-2 rounded-md border border-warning/50 bg-warning-soft px-3 py-2 text-body-sm text-warning-soft-fg"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Mostrando {formatInt(page.rows.length)} de {formatInt(page.total)} manutenções — refine os filtros.
            </span>
          </p>
        ) : null}
        {boards.map(([status, rows]) => (
          <StatusBoard key={status} status={status} rows={rows} list={list} actions={actions} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5" data-testid="maintenance-schedule">
      <section aria-labelledby="maintenance-schedule-kpis" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 id="maintenance-schedule-kpis" className="text-h4 font-semibold text-fg">
              Indicadores da programação
            </h2>
            <p className="text-caption text-fg-muted">
              {kpis ? `Situação em ${formatDate(kpis.today)} · ` : ""}selecione um indicador para filtrar a fila abaixo.
            </p>
          </div>
          {hasFilter ? (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<X />}
              onClick={clearQueue}
              disabled={pending}
              data-testid="maintenance-queue-clear"
            >
              Limpar fila
            </Button>
          ) : null}
        </div>

        {kpis ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-9">
            {CARDS.map((def) => (
              <QueueCard
                key={def.id}
                def={def}
                kpis={kpis}
                active={isActive(def.filter)}
                disabled={pending}
                onToggle={() => toggle(def.filter)}
              />
            ))}
          </div>
        ) : (
          <ErrorState
            variant="inline"
            title="Não foi possível carregar os indicadores."
            description="A fila abaixo continua disponível."
            onRetry={actions.refresh}
            retryLabel="Tentar de novo"
            retrying={pending}
            className="rounded-md border border-border bg-surface p-3"
          />
        )}
      </section>

      <section aria-labelledby="maintenance-schedule-list" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 id="maintenance-schedule-list" className="text-h4 font-semibold text-fg">
                Fila de manutenções
              </h2>
              {page ? (
                <Badge variant="neutral" size="sm" className="tabular-nums">
                  {formatInt(page.total)}
                  <span className="sr-only"> {page.total === 1 ? "manutenção" : "manutenções"}</span>
                </Badge>
              ) : null}
            </div>
            <p className="text-caption text-fg-muted" aria-live="polite">
              {scope} · {order} · um quadro por situação, agrupado por operação e cidade
            </p>
          </div>
          {newButton}
        </div>

        {content}

        <p className="flex items-start gap-1.5 text-caption text-fg-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            O TMM conta da entrada real à saída real na oficina, nunca da data da solicitação; “≈” indica TMM calculado
            só pelas datas. Para mudar a situação, abra a manutenção: Agendar → Iniciar → Concluir.
          </span>
        </p>
      </section>
    </div>
  );
}
