"use client";

import * as React from "react";
import {
  ChevronRight, ChevronsDownUp, ChevronsUpDown, Info, MapPin, Network, Plus, ShieldCheck, Truck, UserRound,
  UserRoundPen, UserRoundX, Users,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SearchField } from "@/components/ui/search-field";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/empty-state";
import type { PlannerMatrix, PlannerRow, PlannerSegment } from "@/lib/governance/fidelization-central";
import type { DriverPlanRow } from "@/lib/governance/queries";
import { canSubstituteDriver } from "./driver-substitute-dialog";
import { EndDriverDialog, canEndDriver, type EndDriverAction } from "./end-driver-dialog";

const number = new Intl.NumberFormat("pt-BR");

const normalize = (value: string) =>
  value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

interface Situation {
  label: string;
  tone: StatusTone;
  /** Conta como motorista ativo da BR: não cancelado e não terminado na data-âncora. */
  active: boolean;
}

/**
 * A situação é lida na data-âncora da competência (hoje, no mês corrente; o
 * último dia, num mês passado; o primeiro, num mês futuro) — a mesma data em
 * que o planner diz "veículo atual", para as duas leituras não divergirem.
 */
function situationOf(row: DriverPlanRow, anchor: string): Situation {
  if (row.status === "cancelled") return { label: "Cancelado", tone: "neutral", active: false };
  if (row.endDate && row.endDate < anchor) return { label: "Encerrado", tone: "neutral", active: false };
  if (row.startDate > anchor) return { label: "A iniciar", tone: "pending", active: true };
  return { label: "Vigente", tone: "success", active: true };
}

const ROLE_ORDER = { primary: 0, secondary: 1 } as const;

interface VehicleInMonth {
  id: string;
  label: string;
  plate: string | null;
}

/** Os titulares do mês em ordem cronológica — sem cancelados e sem repetir o veículo. */
function vehiclesOf(segments: PlannerSegment[]): VehicleInMonth[] {
  const seen = new Set<string>();
  const out: VehicleInMonth[] = [];
  for (const s of [...segments].sort((a, b) => a.firstDay - b.firstDay)) {
    if (s.status === "cancelled" || seen.has(s.vehicleId)) continue;
    seen.add(s.vehicleId);
    const label = s.fleetCode ?? s.licensePlate ?? "—";
    out.push({ id: s.vehicleId, label, plate: s.licensePlate && s.licensePlate !== label ? s.licensePlate : null });
  }
  return out;
}

interface BrGroup {
  row: PlannerRow;
  drivers: { plan: DriverPlanRow; situation: Situation }[];
  activeDrivers: number;
  hasShifts: boolean;
  vehicles: VehicleInMonth[];
}

/** Local = cidade/UF. A mesma cidade pode aparecer sob duas lideranças quando há exceção por BR. */
interface CityGroup {
  key: string;
  cityName: string;
  stateUf: string;
  brs: BrGroup[];
}

interface LeaderGroup {
  key: string;
  leaderName: string | null;
  cities: CityGroup[];
  brs: number;
  withoutDriver: number;
}

interface OperationGroup {
  id: string;
  name: string;
  leaders: LeaderGroup[];
  cities: number;
  brs: number;
  withoutDriver: number;
}

const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });

/**
 * Operação → Liderança → Local → BR, a hierarquia em que a liderança
 * trabalha. A liderança é a da competência (Planner de Lideranças, com a
 * exceção por BR), então uma BR com exceção fica sob quem responde por ela, e
 * não sob a liderança da cidade. Dentro de cada local, as BRs seguem a ordem
 * da matriz.
 */
function groupByOperation(groups: BrGroup[]): OperationGroup[] {
  const operations = new Map<string, { name: string; leaders: Map<string, LeaderGroup> }>();
  for (const group of groups) {
    const { row } = group;
    const operation =
      operations.get(row.operationId) ?? { name: row.operationName, leaders: new Map<string, LeaderGroup>() };
    operations.set(row.operationId, operation);

    const leaderKey = row.leaderEmployeeId ?? "sem-lideranca";
    const leader: LeaderGroup =
      operation.leaders.get(leaderKey) ??
      { key: `${row.operationId}:${leaderKey}`, leaderName: row.leaderName, cities: [], brs: 0, withoutDriver: 0 };
    operation.leaders.set(leaderKey, leader);

    const cityKey = `${leader.key}:${row.cityId}`;
    let city = leader.cities.find((c) => c.key === cityKey);
    if (!city) {
      city = { key: cityKey, cityName: row.cityName, stateUf: row.stateUf, brs: [] };
      leader.cities.push(city);
    }
    city.brs.push(group);
    leader.brs += 1;
    if (group.activeDrivers === 0) leader.withoutDriver += 1;
  }

  return [...operations.entries()]
    .map(([id, { name, leaders }]) => {
      const list = [...leaders.values()]
        .map((leader) => ({
          ...leader,
          cities: [...leader.cities].sort(
            (a, b) => collator.compare(a.stateUf, b.stateUf) || collator.compare(a.cityName, b.cityName),
          ),
        }))
        // Quem responde vem em ordem alfabética; a ausência de liderança fica por último, dita por extenso.
        .sort((a, b) =>
          a.leaderName === null ? 1 : b.leaderName === null ? -1 : collator.compare(a.leaderName, b.leaderName),
        );
      const cityIds = new Set(list.flatMap((l) => l.cities.map((c) => `${c.stateUf}:${c.cityName}`)));
      return {
        id,
        name,
        leaders: list,
        cities: cityIds.size,
        brs: list.reduce((sum, l) => sum + l.brs, 0),
        withoutDriver: list.reduce((sum, l) => sum + l.withoutDriver, 0),
      };
    })
    .sort((a, b) => collator.compare(a.name, b.name));
}

const plural = (value: number, one: string, many: string) =>
  `${number.format(value)} ${value === 1 ? one : many}`;

/** Colunas da linha da BR, iguais no cabeçalho de cada liderança. */
const BR_GRID =
  "md:grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(9rem,0.9fr)_8.5rem] md:items-center md:gap-4";

export interface DriversPlannerProps {
  matrix: PlannerMatrix;
  driverPlans: DriverPlanRow[];
  competenceLabel: string;
  canChangeDriver: boolean;
  onOpenBr: (operationBrId: string) => void;
  onSubstitute: (row: DriverPlanRow) => void;
  /** A prévia de desenvolvimento troca a server action de encerramento por uma resposta fixa. */
  endDriverAction?: EndDriverAction;
}

/**
 * Planner de Motoristas (Etapa 15).
 *
 * Organizado por BR, como no HFC: cada posição da matriz é um grupo, com os
 * veículos que a ocuparam no mês e os motoristas vinculados a eles. Uma BR
 * pode ter mais de um motorista ao mesmo tempo — principal e secundário, para
 * turnos —, e por isso a contagem é de motoristas ativos, não um nome só.
 *
 * Vincular um motorista é da gaveta da BR (`onOpenBr`); substituir é do
 * diálogo de substituição (`onSubstitute`); encerrar é daqui, num diálogo
 * próprio. Nenhum dos três cria conta ou mexe em Perfil de Acesso.
 */
export function DriversPlanner({
  matrix,
  driverPlans,
  competenceLabel,
  canChangeDriver,
  onOpenBr,
  onSubstitute,
  endDriverAction,
}: DriversPlannerProps) {
  const anchor = matrix.anchorDate || matrix.today;
  const competenceYear = matrix.competence.slice(0, 4);
  const [query, setQuery] = React.useState("");
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [leaderExpanded, setLeaderExpanded] = React.useState<Record<string, boolean>>({});
  const [operationExpanded, setOperationExpanded] = React.useState<Record<string, boolean>>({});
  const [endRow, setEndRow] = React.useState<DriverPlanRow | null>(null);

  const groups = React.useMemo<BrGroup[]>(() => {
    const byBr = new Map<string, DriverPlanRow[]>();
    for (const plan of driverPlans) {
      const list = byBr.get(plan.operationBrId) ?? [];
      list.push(plan);
      byBr.set(plan.operationBrId, list);
    }
    return matrix.rows.map((row) => {
      const drivers = (byBr.get(row.operationBrId) ?? [])
        .map((plan) => ({ plan, situation: situationOf(plan, anchor) }))
        .sort(
          (a, b) =>
            Number(b.situation.active) - Number(a.situation.active) ||
            ROLE_ORDER[a.plan.driverRole] - ROLE_ORDER[b.plan.driverRole] ||
            a.plan.startDate.localeCompare(b.plan.startDate),
        );
      const active = drivers.filter((d) => d.situation.active);
      return {
        row,
        drivers,
        activeDrivers: new Set(active.map((d) => d.plan.employeeId)).size,
        hasShifts:
          active.some((d) => d.plan.driverRole === "primary") && active.some((d) => d.plan.driverRole === "secondary"),
        vehicles: vehiclesOf(row.segments),
      };
    });
  }, [matrix.rows, driverPlans, anchor]);

  const summary = React.useMemo(() => {
    const withDriver = groups.filter((g) => g.activeDrivers > 0).length;
    const distinct = new Set(
      groups.flatMap((g) => g.drivers.filter((d) => d.situation.active).map((d) => d.plan.employeeId)),
    ).size;
    return { withDriver, withoutDriver: groups.length - withDriver, distinct };
  }, [groups]);

  // A busca olha a BR (código, local, veículos) e os motoristas. Quando o que
  // casou foi um motorista, o grupo abre sozinho — senão o resultado ficaria
  // escondido atrás de um clique.
  const term = normalize(query);
  const { visible, openedByDriver } = React.useMemo(() => {
    if (!term) return { visible: groups, openedByDriver: new Set<string>() };
    const opened = new Set<string>();
    const list = groups.filter((g) => {
      const brText = normalize(
        [
          g.row.brCode,
          g.row.brDescription ?? "",
          g.row.operationName,
          g.row.cityName,
          g.row.stateUf,
          ...g.vehicles.flatMap((v) => [v.label, v.plate ?? ""]),
        ].join(" "),
      );
      const driverHit = g.drivers.some((d) =>
        normalize(`${d.plan.employeeName} ${d.plan.employeeCode ?? ""}`).includes(term),
      );
      if (driverHit) opened.add(g.row.operationBrId);
      return brText.includes(term) || driverHit;
    });
    return { visible: list, openedByDriver: opened };
  }, [groups, term]);

  const isOpen = (id: string) => expanded[id] ?? openedByDriver.has(id);
  const toggle = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !(prev[id] ?? openedByDriver.has(id)) }));

  const operationGroups = React.useMemo(() => groupByOperation(visible), [visible]);

  // A liderança abre com um clique; com uma busca digitada, as que sobraram já
  // vêm abertas — o resultado não fica escondido atrás de outro clique.
  const isLeaderOpen = (key: string) => leaderExpanded[key] ?? Boolean(term);
  const toggleLeader = (key: string) =>
    setLeaderExpanded((prev) => ({ ...prev, [key]: !(prev[key] ?? Boolean(term)) }));
  const isOperationOpen = (id: string) => operationExpanded[id] ?? true;
  const toggleOperation = (id: string) => setOperationExpanded((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));

  const leaderKeys = operationGroups.flatMap((o) => o.leaders.map((l) => l.key));
  const allOpen = leaderKeys.length > 0 && leaderKeys.every(isLeaderOpen);
  const setAll = (value: boolean) => {
    setLeaderExpanded((prev) => {
      const next = { ...prev };
      for (const key of leaderKeys) next[key] = value;
      return next;
    });
    if (value) {
      setOperationExpanded((prev) => {
        const next = { ...prev };
        for (const o of operationGroups) next[o.id] = true;
        return next;
      });
    }
  };

  const formatShort = (value: string) => {
    const [y, m, d] = value.split("-");
    if (!d) return value;
    return y === competenceYear ? `${d}/${m}` : `${d}/${m}/${y}`;
  };
  const period = (plan: DriverPlanRow) =>
    `${formatShort(plan.startDate)} – ${plan.endDate ? formatShort(plan.endDate) : "em aberto"}`;

  return (
    <section aria-label="Planner de motoristas" className="flex min-w-0 flex-col gap-3">
      <dl aria-label="Resumo do planner de motoristas" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <SummaryItem label="BRs com motorista" value={summary.withDriver} icon={<UserRound />} />
        <SummaryItem
          label="BRs sem motorista"
          value={summary.withoutDriver}
          icon={<UserRoundX />}
          warn={summary.withoutDriver > 0}
        />
        <SummaryItem label="Motoristas distintos" value={summary.distinct} icon={<Users />} />
      </dl>

      <p className="flex items-start gap-1.5 text-caption text-fg-muted">
        <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <span>
          {competenceLabel}, situação em {formatDate(anchor)}. Uma BR pode ter mais de um motorista ao mesmo tempo —
          principal e secundário, para turnos. Vincular um motorista não cria conta de acesso e não altera o Perfil de
          Acesso de ninguém.
        </span>
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          size="sm"
          aria-label="Buscar BR ou motorista"
          placeholder="Buscar BR, local, veículo ou motorista"
          value={query}
          onValueChange={setQuery}
          wrapperClassName="w-full sm:w-80"
        />
        {visible.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={allOpen ? <ChevronsDownUp /> : <ChevronsUpDown />}
            onClick={() => setAll(!allOpen)}
          >
            {allOpen ? "Recolher lideranças" : "Expandir lideranças"}
          </Button>
        ) : null}
        {term ? (
          <span className="text-caption text-fg-muted" aria-live="polite">
            {number.format(visible.length)} de {number.format(groups.length)} BRs
          </span>
        ) : null}
      </div>

      {groups.length === 0 ? (
        <EmptyState
          variant="panel"
          size="sm"
          icon={<UserRound />}
          title="Nenhuma BR no filtro atual"
          description={`Não há posições operacionais no recorte escolhido para ${competenceLabel}. Ajuste os filtros do topo da página.`}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          variant="panel"
          size="sm"
          icon={<UserRound />}
          title="Nenhuma BR ou motorista encontrado"
          description="A busca não casou com o código da BR, o local, o veículo nem o nome ou a matrícula de um motorista."
          action={
            <Button variant="secondary" size="sm" onClick={() => setQuery("")}>
              Limpar busca
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {operationGroups.map((operation) => {
            const opOpen = isOperationOpen(operation.id);
            const opPanel = `drivers-op-${operation.id}`;
            return (
              <Card key={operation.id} className="overflow-hidden" aria-label={`Operação ${operation.name}`} role="region">
                <button
                  type="button"
                  aria-expanded={opOpen}
                  aria-controls={opPanel}
                  onClick={() => toggleOperation(operation.id)}
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-left hfm-transition hfm-focus-ring hover:bg-hover-overlay"
                >
                  <span className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-1">
                    <ChevronRight
                      aria-hidden
                      className={cn("size-4 shrink-0 text-fg-muted transition-transform", opOpen && "rotate-90")}
                    />
                    <Network aria-hidden className="size-4 shrink-0 text-fg-muted" />
                    <span className="min-w-0">
                      <span className="block truncate text-body font-semibold text-fg">{operation.name}</span>
                      <span className="block text-caption text-fg-muted">Operação</span>
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 pl-6 sm:pl-0">
                    <Badge variant="neutral" appearance="soft" size="sm">
                      {plural(operation.leaders.length, "liderança", "lideranças")}
                    </Badge>
                    <Badge variant="neutral" appearance="soft" size="sm">
                      {plural(operation.cities, "local", "locais")}
                    </Badge>
                    <Badge variant="neutral" appearance="soft" size="sm">
                      {plural(operation.brs, "BR", "BRs")}
                    </Badge>
                    {operation.withoutDriver > 0 ? (
                      <Badge variant="warning" appearance="soft" size="sm">
                        {number.format(operation.withoutDriver)} sem motorista
                      </Badge>
                    ) : null}
                  </span>
                </button>

                {opOpen ? (
                  <ul id={opPanel} className="flex flex-col border-t border-border">
                    {operation.leaders.map((leader) => (
                      <LeaderBlock
                        key={leader.key}
                        leader={leader}
                        open={isLeaderOpen(leader.key)}
                        onToggle={() => toggleLeader(leader.key)}
                        isBrOpen={isOpen}
                        onToggleBr={toggle}
                        competenceLabel={competenceLabel}
                        canChangeDriver={canChangeDriver}
                        onOpenBr={onOpenBr}
                        onSubstitute={onSubstitute}
                        onEnd={setEndRow}
                        period={period}
                      />
                    ))}
                  </ul>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      {/* A linha é a chave: outro motorista remonta o diálogo com o formulário limpo. */}
      <EndDriverDialog
        key={`end-${endRow?.id ?? "none"}`}
        row={endRow}
        onClose={() => setEndRow(null)}
        action={endDriverAction}
      />
    </section>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  return d ? `${d}/${m}/${y}` : value;
}

function SummaryItem({
  label,
  value,
  icon,
  warn = false,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  warn?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border border-border bg-surface-raised px-4 py-2.5 shadow-card",
        warn && "border-l-2 border-l-warning",
      )}
    >
      <span aria-hidden className="text-fg-muted [&_svg]:size-4">
        {icon}
      </span>
      <dt className="min-w-0 flex-1 text-body-sm text-fg-secondary">{label}</dt>
      <dd className="text-h4 font-semibold tabular-nums text-fg">{number.format(value)}</dd>
    </div>
  );
}

function LeaderBlock({
  leader,
  open,
  onToggle,
  isBrOpen,
  onToggleBr,
  ...brProps
}: {
  leader: LeaderGroup;
  open: boolean;
  onToggle: () => void;
  isBrOpen: (operationBrId: string) => boolean;
  onToggleBr: (operationBrId: string) => void;
  competenceLabel: string;
  canChangeDriver: boolean;
  onOpenBr: (operationBrId: string) => void;
  onSubstitute: (row: DriverPlanRow) => void;
  onEnd: (row: DriverPlanRow) => void;
  period: (plan: DriverPlanRow) => string;
}) {
  const panelId = `drivers-leader-${leader.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const name = leader.leaderName ?? "Sem liderança definida";

  return (
    <li className="border-b border-border last:border-b-0" aria-label={`Liderança ${name}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 pr-4 pl-8 text-left hfm-transition hfm-focus-ring hover:bg-hover-overlay"
      >
        <span className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-1">
          <ChevronRight
            aria-hidden
            className={cn("size-3.5 shrink-0 text-fg-muted transition-transform", open && "rotate-90")}
          />
          <ShieldCheck aria-hidden className="size-3.5 shrink-0 text-fg-muted" />
          <span className="min-w-0">
            <span className={cn("block truncate text-body-sm font-medium", leader.leaderName ? "text-fg" : "text-fg-muted")}>
              {name}
            </span>
            <span className="block text-caption text-fg-muted">Liderança</span>
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5 pl-6 sm:pl-0">
          <Badge variant="neutral" appearance="soft" size="sm">
            {plural(leader.cities.length, "local", "locais")}
          </Badge>
          <Badge variant="neutral" appearance="soft" size="sm">
            {plural(leader.brs, "BR", "BRs")}
          </Badge>
          {leader.withoutDriver > 0 ? (
            <Badge variant="warning" appearance="soft" size="sm">
              {number.format(leader.withoutDriver)} sem motorista
            </Badge>
          ) : null}
        </span>
      </button>

      {open ? (
        <div id={panelId} className="border-t border-border-subtle">
          <div
            aria-hidden
            className={cn(
              "hidden bg-surface-secondary py-2 pr-4 pl-12 text-caption font-semibold text-fg-secondary",
              BR_GRID,
            )}
          >
            <span className="pl-6">BR</span>
            <span>Veículo(s) no mês</span>
            <span>Motoristas</span>
            <span />
          </div>
          {leader.cities.map((city) => (
            <section key={city.key} aria-label={`Local ${city.cityName}/${city.stateUf}`}>
              <p className="flex items-center gap-1.5 border-t border-border-subtle bg-surface-secondary/60 py-1.5 pr-4 pl-12 text-caption font-medium text-fg-secondary">
                <MapPin aria-hidden className="size-3.5 shrink-0 text-fg-muted" />
                <span className="truncate">
                  {city.cityName}/{city.stateUf}
                </span>
                <span className="text-fg-muted">· {plural(city.brs.length, "BR", "BRs")}</span>
              </p>
              <ul className="flex flex-col">
                {city.brs.map((group) => (
                  <BrBlock
                    key={group.row.operationBrId}
                    group={group}
                    open={isBrOpen(group.row.operationBrId)}
                    onToggle={() => onToggleBr(group.row.operationBrId)}
                    {...brProps}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </li>
  );
}

function BrBlock({
  group,
  open,
  onToggle,
  competenceLabel,
  canChangeDriver,
  onOpenBr,
  onSubstitute,
  onEnd,
  period,
}: {
  group: BrGroup;
  open: boolean;
  onToggle: () => void;
  competenceLabel: string;
  canChangeDriver: boolean;
  onOpenBr: (operationBrId: string) => void;
  onSubstitute: (row: DriverPlanRow) => void;
  onEnd: (row: DriverPlanRow) => void;
  period: (plan: DriverPlanRow) => string;
}) {
  const { row, drivers, activeDrivers, hasShifts, vehicles } = group;
  const panelId = `drivers-br-${row.operationBrId}`;

  return (
    <li
      className="border-t border-border-subtle"
      data-br={row.brCode}
      aria-label={`BR ${row.brCode}`}
    >
      <div className={cn("flex flex-col gap-2 py-3 pr-4 pl-12", BR_GRID)}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="-mx-1 flex min-w-0 items-start gap-2 rounded-sm px-1 py-0.5 text-left hfm-transition hfm-focus-ring hover:bg-hover-overlay"
        >
          <ChevronRight
            aria-hidden
            className={cn("mt-0.5 size-4 shrink-0 text-fg-muted transition-transform", open && "rotate-90")}
          />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="truncate font-semibold text-fg">{row.brCode}</span>
              {row.brStatus !== "active" ? (
                <Badge variant="neutral" appearance="soft" size="sm">
                  Inativa
                </Badge>
              ) : null}
            </span>
            {row.brDescription ? (
              <span className="block truncate text-caption text-fg-muted">{row.brDescription}</span>
            ) : null}
          </span>
        </button>

        <div className="flex min-w-0 items-start gap-1.5 pl-6 text-body-sm md:pl-0">
          <Truck aria-hidden className="mt-0.5 size-3.5 shrink-0 text-fg-muted" />
          {vehicles.length === 0 ? (
            <span className="text-fg-muted">Sem veículo no mês</span>
          ) : (
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
              {vehicles.slice(0, 3).map((v, i) => (
                <React.Fragment key={v.id}>
                  {i > 0 ? (
                    <>
                      <span aria-hidden className="text-fg-muted">
                        →
                      </span>
                      <span className="sr-only">depois</span>
                    </>
                  ) : null}
                  <span className="whitespace-nowrap">
                    <span className="font-medium text-fg">{v.label}</span>
                    {v.plate ? <span className="text-caption text-fg-muted"> · {v.plate}</span> : null}
                  </span>
                </React.Fragment>
              ))}
              {vehicles.length > 3 ? (
                <span className="text-caption text-fg-muted">+{number.format(vehicles.length - 3)}</span>
              ) : null}
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pl-6 md:pl-0">
          {activeDrivers > 0 ? (
            <span className="text-body-sm font-medium text-fg">
              {number.format(activeDrivers)} {activeDrivers === 1 ? "ativo" : "ativos"}
            </span>
          ) : (
            <Badge variant="warning" size="sm" dot>
              Sem motorista
            </Badge>
          )}
          <span className="text-caption text-fg-muted">
            {number.format(drivers.length)} {drivers.length === 1 ? "vínculo" : "vínculos"}
            {hasShifts ? " · principal + secundário" : ""}
          </span>
        </div>

        <div className="flex justify-start pl-6 md:justify-end md:pl-0">
          {canChangeDriver ? (
            <Button variant="outline" size="sm" leadingIcon={<Plus />} onClick={() => onOpenBr(row.operationBrId)}>
              Motorista<span className="sr-only"> na {row.brCode}</span>
            </Button>
          ) : null}
        </div>
      </div>

      {open ? (
        <div id={panelId} className="border-t border-border-subtle bg-surface-secondary/60 py-3 pr-4 pl-12">
          {drivers.length === 0 ? (
            <p className="pl-6 text-body-sm text-fg-muted">
              Nenhum motorista vinculado a esta BR em {competenceLabel}.
              {canChangeDriver ? " Use “+ Motorista” para vincular." : ""}
            </p>
          ) : (
            <>
              {/* ------------------------------------------------ desktop */}
              <div className="hidden overflow-x-auto rounded-md border border-border bg-surface md:block">
                <Table aria-label={`Motoristas da ${row.brCode}`}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Colaborador</TableHead>
                      <TableHead>Função</TableHead>
                      <TableHead>Veículo</TableHead>
                      <TableHead>Período</TableHead>
                      <TableHead>Situação</TableHead>
                      {canChangeDriver ? <TableHead className="text-right">Ações</TableHead> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {drivers.map(({ plan, situation }) => (
                      <TableRow key={plan.id} className="h-auto">
                        <TableCell className="py-2">
                          <span className="block font-medium text-fg">{plan.employeeName}</span>
                          <span className="block text-caption text-fg-muted">
                            {plan.employeeCode ? `Matrícula ${plan.employeeCode}` : "Sem matrícula"}
                          </span>
                        </TableCell>
                        <TableCell className="py-2">
                          <RoleBadge role={plan.driverRole} />
                        </TableCell>
                        <TableCell className="py-2 whitespace-nowrap">
                          <DriverVehicle plan={plan} />
                        </TableCell>
                        <TableCell className="py-2 whitespace-nowrap tabular-nums text-fg-secondary">
                          {period(plan)}
                        </TableCell>
                        <TableCell className="py-2">
                          <StatusBadge status={situation.tone} size="sm">
                            {situation.label}
                          </StatusBadge>
                        </TableCell>
                        {canChangeDriver ? (
                          <TableCell className="py-2">
                            <DriverActions plan={plan} onSubstitute={onSubstitute} onEnd={onEnd} />
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* ------------------------------------------------ celular */}
              <ul aria-label={`Motoristas da ${row.brCode}`} className="flex flex-col gap-2 md:hidden">
                {drivers.map(({ plan, situation }) => (
                  <li key={plan.id} className="rounded-md border border-border bg-surface p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-fg">{plan.employeeName}</p>
                        <p className="text-caption text-fg-muted">
                          {plan.employeeCode ? `Matrícula ${plan.employeeCode}` : "Sem matrícula"}
                        </p>
                      </div>
                      <StatusBadge status={situation.tone} size="sm">
                        {situation.label}
                      </StatusBadge>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm">
                      <RoleBadge role={plan.driverRole} />
                      <DriverVehicle plan={plan} />
                      <span className="tabular-nums text-fg-secondary">{period(plan)}</span>
                    </div>
                    {canChangeDriver ? (
                      <div className="mt-2 border-t border-border-subtle pt-2">
                        <DriverActions plan={plan} onSubstitute={onSubstitute} onEnd={onEnd} align="start" />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}

function RoleBadge({ role }: { role: DriverPlanRow["driverRole"] }) {
  return (
    <Badge variant={role === "primary" ? "primary" : "neutral"} size="sm">
      {role === "primary" ? "Principal" : "Secundário"}
    </Badge>
  );
}

function DriverVehicle({ plan }: { plan: DriverPlanRow }) {
  const label = plan.fleetCode ?? plan.licensePlate;
  if (!label) return <span className="text-fg-muted">—</span>;
  return (
    <span className="whitespace-nowrap">
      <span className="text-fg">{label}</span>
      {plan.licensePlate && plan.licensePlate !== label ? (
        <span className="text-caption text-fg-muted"> · {plan.licensePlate}</span>
      ) : null}
    </span>
  );
}

/**
 * §34/§35: um vínculo cancelado ou já terminado não tem véspera para fechar —
 * as ações ficam desabilitadas, não escondidas, para a linha dizer que existem.
 */
function DriverActions({
  plan,
  onSubstitute,
  onEnd,
  align = "end",
}: {
  plan: DriverPlanRow;
  onSubstitute: (row: DriverPlanRow) => void;
  onEnd: (row: DriverPlanRow) => void;
  align?: "start" | "end";
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1", align === "end" ? "justify-end" : "justify-start")}>
      <Button
        variant="ghost"
        size="sm"
        leadingIcon={<UserRoundPen />}
        disabled={!canSubstituteDriver(plan)}
        onClick={() => onSubstitute(plan)}
      >
        Substituir<span className="sr-only"> {plan.employeeName}</span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        leadingIcon={<UserRoundX />}
        disabled={!canEndDriver(plan)}
        onClick={() => onEnd(plan)}
      >
        Encerrar<span className="sr-only"> {plan.employeeName}</span>
      </Button>
    </div>
  );
}
