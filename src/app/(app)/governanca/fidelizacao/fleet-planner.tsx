"use client";

import * as React from "react";
import {
  ArrowLeftRight, Building2, ChevronDown, ChevronLeft, ChevronRight, CircleSlash, FilterX, Loader2, MapPin,
  Pencil, Plus, Truck, UserRound,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { SearchField } from "@/components/ui/search-field";
import { EmptyState } from "@/components/feedback/empty-state";
import { NativeSelect } from "@/components/governance/selects";
import {
  daysInCompetence, formatCompetence, monthStart, weekdayOf, WEEKDAY_INITIALS, type Competence,
} from "@/lib/governance/competence";
import type { ApplyPeriodInput, PeriodResult, Result } from "@/lib/governance/actions";
import type {
  AllocationSituation, PlannerMatrix, PlannerRow, PlannerSegment,
} from "@/lib/governance/fidelization-central";
import { PeriodDialog, formatDateBr, vehicleLabel, type SearchVehicles } from "./period-dialog";

/* ------------------------------------------------------------------ helpers */

/**
 * Espelho de `ALLOCATION_SITUATIONS`. O módulo de origem é `server-only` (lê o
 * banco), e um componente cliente só pode importar tipos dele. O `Record` sobre
 * `AllocationSituation` faz o TypeScript apontar qualquer situação nova que
 * falte aqui.
 */
const SITUATION_LABEL: Record<AllocationSituation, string> = {
  with_vehicle: "Com veículo no mês",
  without_vehicle: "Sem veículo no mês",
  partial: "Com dias sem veículo",
  full: "Com veículo todos os dias",
  changed: "Com troca no mês",
};

const STATUS_STYLE: Record<PlannerSegment["status"], { bar: string; text: string; label: string; tone: BadgeVariant }> = {
  planned: { bar: "bg-info-soft border-info", text: "text-info-soft-fg", label: "Planejado", tone: "info" },
  confirmed: { bar: "bg-primary-soft border-primary", text: "text-primary-soft-fg", label: "Confirmado", tone: "primary" },
  executed: { bar: "bg-success-soft border-success", text: "text-success-soft-fg", label: "Executado", tone: "success" },
  cancelled: { bar: "bg-surface-secondary border-border", text: "text-fg-muted", label: "Cancelado", tone: "neutral" },
};

const WEEKDAY_NAMES = ["", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado", "domingo"];

const OPEN_END = "9999-12-31";
const number = new Intl.NumberFormat("pt-BR");

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (c: Competence, day: number) => `${c.year}-${pad(c.month)}-${pad(day)}`;
const activeSegments = (row: PlannerRow) =>
  row.segments.filter((s) => s.status !== "cancelled").sort((a, b) => a.firstDay - b.firstDay);
const isSwap = (s: PlannerSegment) => s.source === "substitution" || s.source === "inversion";
const plural = (n: number, one: string, many: string) => `${number.format(n)} ${n === 1 ? one : many}`;

/** dd/mm no ano da competência; dd/mm/aaaa quando o vínculo começa ou termina noutro ano. */
function dayMonth(iso: string, year: number): string {
  const [y, m, d] = iso.split("-");
  return Number(y) === year ? `${d}/${m}` : `${d}/${m}/${y}`;
}

type Run =
  | { kind: "vehicle"; segment: PlannerSegment; start: number; end: number }
  | { kind: "empty"; start: number; end: number };

/**
 * Os trechos de uma linha: um bloco por vínculo e um bloco por sequência de
 * dias sem veículo. Dois vínculos do mesmo veículo separados por dias vazios
 * ficam dois blocos — são duas decisões, e desenhá-los juntos esconderia o
 * intervalo que alguém precisa explicar.
 */
function buildRuns(row: PlannerRow, days: number): Run[] {
  const runs: Run[] = [];
  let cursor = 1;
  for (const segment of activeSegments(row)) {
    const start = Math.max(cursor, segment.firstDay, 1);
    const end = Math.min(days, segment.lastDay);
    if (end < start) continue;
    if (start > cursor) runs.push({ kind: "empty", start: cursor, end: start - 1 });
    runs.push({ kind: "vehicle", segment, start, end });
    cursor = end + 1;
  }
  if (cursor <= days) runs.push({ kind: "empty", start: cursor, end: days });
  return runs;
}

function segmentAtDay(row: PlannerRow, day: number): PlannerSegment | null {
  return activeSegments(row).find((s) => s.firstDay <= day && day <= s.lastDay) ?? null;
}

const withoutVehicle = (rows: PlannerRow[]) => rows.filter((r) => activeSegments(r).length === 0).length;

/* ----------------------------------------------------------------- grouping */

interface CityGroup { key: string; label: string; rows: PlannerRow[] }
interface LeaderGroup { key: string; name: string | null; cities: CityGroup[]; rows: PlannerRow[] }
interface OperationGroup { key: string; name: string; leaders: LeaderGroup[]; cities: CityGroup[]; rows: PlannerRow[] }

/**
 * Operação → Liderança → Cidade/UF (matriz) e Operação → Cidade/UF (celular).
 * As linhas já chegam na ordem operação, liderança, cidade, código: os mapas
 * só preservam essa ordem, sem reordenar.
 */
function groupRows(rows: PlannerRow[]): OperationGroup[] {
  const operations = new Map<string, OperationGroup>();
  for (const row of rows) {
    const opKey = `op:${row.operationId}`;
    let op = operations.get(opKey);
    if (!op) {
      op = { key: opKey, name: row.operationName, leaders: [], cities: [], rows: [] };
      operations.set(opKey, op);
    }
    op.rows.push(row);

    const leaderKey = `${opKey}|lid:${row.leaderEmployeeId ?? "none"}`;
    let leader = op.leaders.find((l) => l.key === leaderKey);
    if (!leader) {
      leader = { key: leaderKey, name: row.leaderName, cities: [], rows: [] };
      op.leaders.push(leader);
    }
    leader.rows.push(row);

    const cityLabel = `${row.cityName}/${row.stateUf}`;
    const leaderCityKey = `${leaderKey}|city:${row.cityId}`;
    let leaderCity = leader.cities.find((c) => c.key === leaderCityKey);
    if (!leaderCity) {
      leaderCity = { key: leaderCityKey, label: cityLabel, rows: [] };
      leader.cities.push(leaderCity);
    }
    leaderCity.rows.push(row);

    const opCityKey = `${opKey}|city:${row.cityId}`;
    let opCity = op.cities.find((c) => c.key === opCityKey);
    if (!opCity) {
      opCity = { key: opCityKey, label: cityLabel, rows: [] };
      op.cities.push(opCity);
    }
    opCity.rows.push(row);
  }
  return [...operations.values()];
}

/* -------------------------------------------------------------------- props */

export interface FleetPlannerProps {
  matrix: PlannerMatrix;
  competence: Competence;
  filters: { q?: string; leaderEmployeeId?: string; vehicle?: string; vehicleTypeId?: string; situation?: string };
  leaders: { id: string; name: string }[];
  vehicleTypes: { id: string; name: string }[];
  onNavigate: (patch: Record<string, string | null>) => void;
  pending: boolean;
  canEdit: boolean;
  canManageHistorical: boolean;
  onOpenBr?: (operationBrId: string) => void;
  /** Padrão: a server action `applyFidelizationPeriod`. */
  applyPeriod?: (input: ApplyPeriodInput) => Promise<Result<PeriodResult>>;
  /** Padrão: a server action `searchEligibleVehicles`. Só a prévia de desenvolvimento troca. */
  searchVehicles?: SearchVehicles;
}

const FILTER_KEYS = { q: "q", leader: "lideranca", vehicle: "placa", vehicleType: "tipo_equipamento", situation: "alocacao" } as const;

/**
 * Planner de Frotas — o "Grid Mensal de Placas" (§23–§28).
 *
 * Uma linha por BR, uma coluna por dia, agrupadas como a operação pensa:
 * operação → liderança → cidade. Cada vínculo é um bloco que atravessa os seus
 * dias, com o código de frota escrito — cor nunca é o único portador —, e cada
 * dia, ocupado ou vazio, é um botão que abre "Editar fidelização do dia" para
 * aquela BR e aquela data. A edição é por período e passa sempre por prévia.
 *
 * No celular a matriz não existe: 31 colunas espremidas não se leem. Cada BR
 * vira um cartão com os seus períodos escritos e um "Editar período".
 */
export function FleetPlanner({
  matrix,
  competence,
  filters,
  leaders,
  vehicleTypes,
  onNavigate,
  pending,
  canEdit,
  canManageHistorical,
  onOpenBr,
  applyPeriod,
  searchVehicles,
}: FleetPlannerProps) {
  const rows = matrix.rows;
  const days = matrix.daysInMonth > 0 ? matrix.daysInMonth : daysInCompetence(competence);
  const dayList = React.useMemo(() => Array.from({ length: days }, (_, i) => i + 1), [days]);
  const today = matrix.today || new Date().toISOString().slice(0, 10);
  const monthPrefix = `${competence.year}-${pad(competence.month)}-`;
  const todayDay = today.startsWith(monthPrefix) ? Number(today.slice(8, 10)) : null;
  const groups = React.useMemo(() => groupRows(rows), [rows]);

  const weekend = React.useMemo(
    () => dayList.map((day) => {
      const dow = weekdayOf(competence.year, competence.month, day);
      return dow === 6 || dow === 7;
    }),
    [dayList, competence.year, competence.month],
  );

  /* ------------------------------------------------------------- filtros */
  // Texto: aplicado no Enter ou ao sair do campo — cada navegação é uma consulta
  // ao servidor, e uma por tecla transformaria "BR0024901" em nove.
  const [q, setQ] = React.useState(filters.q ?? "");
  const [vehicleText, setVehicleText] = React.useState(filters.vehicle ?? "");
  const [basis, setBasis] = React.useState({ q: filters.q ?? "", vehicle: filters.vehicle ?? "" });
  if (basis.q !== (filters.q ?? "") || basis.vehicle !== (filters.vehicle ?? "")) {
    // A URL mudou por fora (voltar, limpar): o campo acompanha.
    setBasis({ q: filters.q ?? "", vehicle: filters.vehicle ?? "" });
    setQ(filters.q ?? "");
    setVehicleText(filters.vehicle ?? "");
  }
  const sent = React.useRef<Record<string, { from: string; value: string }>>({});
  const commit = (urlKey: string, current: string | undefined, raw: string) => {
    const value = raw.trim();
    const base = current ?? "";
    const last = sent.current[urlKey];
    // Enter seguido de blur, com a navegação ainda em curso, não repete a consulta.
    const reference = last && last.from === base ? last.value : base;
    if (value === reference) return;
    sent.current[urlKey] = { from: base, value };
    onNavigate({ [urlKey]: value || null });
  };

  const hasFilters = Boolean(
    filters.q || filters.leaderEmployeeId || filters.vehicle || filters.vehicleTypeId || filters.situation,
  );
  const clearFilters = () => {
    setQ("");
    setVehicleText("");
    sent.current = {};
    onNavigate({
      [FILTER_KEYS.q]: null,
      [FILTER_KEYS.leader]: null,
      [FILTER_KEYS.vehicle]: null,
      [FILTER_KEYS.vehicleType]: null,
      [FILTER_KEYS.situation]: null,
    });
  };

  /* --------------------------------------------------------- recolher */
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /* ------------------------------------------------------------ edição */
  const [editing, setEditing] = React.useState<{ row: PlannerRow; date: string; nonce: number } | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const openEditor = (row: PlannerRow, date: string) => {
    setEditing((current) => ({ row, date, nonce: (current?.nonce ?? 0) + 1 }));
    setDialogOpen(true);
  };
  // No celular o dia não foi clicado: hoje, se está no mês; senão o dia 1.
  const defaultDate = todayDay ? today : monthStart(competence);

  const operationCount = groups.length;

  /* O grid abre com o dia de hoje à vista (a um terço da área dos dias), e não
     no dia 1: no dia 23, a pergunta é o que vem agora, não o que já passou. A
     rolagem continua livre para trás. */
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const hasRows = rows.length > 0;
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el || !todayDay || !hasRows) return;
    const cell = el.querySelector<HTMLElement>(`[data-day="${todayDay}"]`);
    const label = el.querySelector<HTMLElement>("[data-label-head]");
    if (!cell || !label || el.clientWidth === 0) return;
    const visible = el.clientWidth - label.offsetWidth;
    el.scrollLeft = Math.max(0, cell.offsetLeft - label.offsetWidth - visible / 3);
  }, [todayDay, hasRows, competence.year, competence.month]);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* ------------------------------------------------------------ filtros */}
      <div
        role="search"
        aria-label="Filtros do planner de frotas"
        className="flex flex-wrap items-end gap-x-3 gap-y-3"
      >
        <FormField label="Busca BR/descrição" className="w-full sm:w-60">
          <SearchField
            size="sm"
            value={q}
            placeholder="Código ou descrição"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              commit(FILTER_KEYS.q, filters.q, e.currentTarget.value);
            }}
            onBlur={(e) => commit(FILTER_KEYS.q, filters.q, e.currentTarget.value)}
            onClear={() => commit(FILTER_KEYS.q, filters.q, "")}
          />
        </FormField>

        <FormField label="Liderança" className="w-full sm:w-56">
          <NativeSelect
            fieldSize="sm"
            value={filters.leaderEmployeeId ?? ""}
            onChange={(e) => onNavigate({ [FILTER_KEYS.leader]: e.target.value || null })}
          >
            <option value="">Todas as lideranças</option>
            {leaders.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </NativeSelect>
        </FormField>

        <FormField label="Placa ou frota" className="w-full sm:w-44">
          <SearchField
            size="sm"
            value={vehicleText}
            placeholder="VA116, SNT8E16…"
            clearLabel="Limpar placa ou frota"
            onChange={(e) => setVehicleText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              commit(FILTER_KEYS.vehicle, filters.vehicle, e.currentTarget.value);
            }}
            onBlur={(e) => commit(FILTER_KEYS.vehicle, filters.vehicle, e.currentTarget.value)}
            onClear={() => commit(FILTER_KEYS.vehicle, filters.vehicle, "")}
          />
        </FormField>

        <FormField label="Tipo de equipamento" className="w-full sm:w-48">
          <NativeSelect
            fieldSize="sm"
            value={filters.vehicleTypeId ?? ""}
            onChange={(e) => onNavigate({ [FILTER_KEYS.vehicleType]: e.target.value || null })}
          >
            <option value="">Todos os tipos</option>
            {vehicleTypes.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </NativeSelect>
        </FormField>

        <FormField label="Situação da alocação" className="w-full sm:w-56">
          <NativeSelect
            fieldSize="sm"
            value={filters.situation ?? ""}
            onChange={(e) => onNavigate({ [FILTER_KEYS.situation]: e.target.value || null })}
          >
            <option value="">Todas as situações</option>
            {(Object.keys(SITUATION_LABEL) as AllocationSituation[]).map((value) => (
              <option key={value} value={value}>{SITUATION_LABEL[value]}</option>
            ))}
          </NativeSelect>
        </FormField>

        <Button
          variant="ghost"
          size="sm"
          leadingIcon={<FilterX />}
          disabled={!hasFilters && !q && !vehicleText}
          onClick={clearFilters}
        >
          Limpar filtros
        </Button>
      </div>

      {/* ------------------------------------------------- resumo e legenda */}
      <div className="flex flex-col gap-2">
        <p className="flex flex-wrap items-center gap-x-1.5 text-body-sm text-fg-secondary" aria-live="polite">
          <span>
            <strong className="font-semibold text-fg">{plural(rows.length, "BR", "BRs")}</strong>
            {matrix.total > rows.length ? ` de ${number.format(matrix.total)}` : ""}
            {" · "}
            {plural(operationCount, "operação", "operações")}
            {" · "}
            {plural(days, "dia", "dias")}
            {" · "}
            {formatCompetence(competence)}
          </span>
          {pending ? (
            <span role="status" className="inline-flex items-center gap-1 text-fg-muted">
              <Loader2 aria-hidden className="size-3.5 animate-spin" />
              Atualizando…
            </span>
          ) : null}
        </p>
        {rows.length > 0 ? <PlannerLegend /> : null}
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Truck />}
            title="Nenhuma BR encontrada"
            description={
              hasFilters
                ? `Nenhuma BR corresponde aos filtros em ${formatCompetence(competence)}. Ajuste a busca, a liderança, a placa, o tipo de equipamento ou a situação da alocação — ou limpe os filtros.`
                : `Não há BRs no recorte atual para ${formatCompetence(competence)}. As BRs são cadastradas no módulo BRs; a operação, o estado e a cidade escolhidos no topo da página também limitam o que aparece aqui.`
            }
            action={hasFilters ? (
              <Button variant="secondary" leadingIcon={<FilterX />} onClick={clearFilters}>Limpar filtros</Button>
            ) : undefined}
          />
        </Card>
      ) : (
        <>
          {/* ------------------------------------------------ matriz (md+) */}
          <Card className={cn("hidden overflow-hidden md:flex", pending && "opacity-70")}>
            <div
              role="region"
              aria-label={`Grid mensal de placas · ${formatCompetence(competence)}`}
              aria-busy={pending || undefined}
              tabIndex={0}
              ref={scrollRef}
              className="relative max-h-[72vh] overflow-auto overscroll-x-contain rounded-md hfm-focus-ring"
              style={{ ["--cell-w" as string]: "2.75rem", ["--label-w" as string]: "18.5rem" }}
            >
              <div className="min-w-max">
                {/* cabeçalho dos dias */}
                <div className="sticky top-0 z-30 flex border-b border-border bg-surface-elevated">
                  <div
                    data-label-head
                    className="sticky left-0 z-40 flex shrink-0 items-end border-r border-border bg-surface-elevated px-3 py-2"
                    style={{ width: "var(--label-w)" }}
                  >
                    <span className="text-caption font-medium uppercase tracking-wide text-fg-muted">
                      BR · local · liderança
                    </span>
                  </div>
                  <div className="grid shrink-0" style={{ gridTemplateColumns: `repeat(${days}, var(--cell-w))` }}>
                    {dayList.map((day, i) => {
                      const dow = weekdayOf(competence.year, competence.month, day);
                      const isToday = day === todayDay;
                      return (
                        <div
                          key={day}
                          data-day={day}
                          title={`${WEEKDAY_NAMES[dow]}, ${formatDateBr(isoOf(competence, day))}${isToday ? " · hoje" : ""}`}
                          className={cn(
                            "flex flex-col items-center justify-center gap-0.5 border-l border-border/60 py-1.5",
                            weekend[i] && "bg-surface-secondary",
                            isToday && "bg-primary",
                          )}
                        >
                          <span className={cn("text-caption font-semibold tabular-nums", isToday ? "text-primary-fg" : "text-fg")}>
                            {day}
                          </span>
                          <span className={cn("text-caption leading-none", isToday ? "text-primary-fg" : "text-fg-muted")}>
                            {isToday ? "hoje" : WEEKDAY_INITIALS[dow]}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {groups.map((op) => {
                  const opOpen = !collapsed.has(op.key);
                  return (
                    <React.Fragment key={op.key}>
                      <GroupHeader
                        level={0}
                        open={opOpen}
                        onToggle={() => toggle(op.key)}
                        icon={<Building2 />}
                        title={op.name}
                        rows={op.rows}
                      />
                      {opOpen
                        ? op.leaders.map((leader) => {
                            const leaderOpen = !collapsed.has(leader.key);
                            return (
                              <React.Fragment key={leader.key}>
                                <GroupHeader
                                  level={1}
                                  open={leaderOpen}
                                  onToggle={() => toggle(leader.key)}
                                  icon={<UserRound />}
                                  title={leader.name ? `Liderança: ${leader.name}` : "Sem liderança definida"}
                                  rows={leader.rows}
                                />
                                {leaderOpen
                                  ? leader.cities.map((city) => {
                                      const cityOpen = !collapsed.has(city.key);
                                      return (
                                        <React.Fragment key={city.key}>
                                          <GroupHeader
                                            level={2}
                                            open={cityOpen}
                                            onToggle={() => toggle(city.key)}
                                            icon={<MapPin />}
                                            title={city.label}
                                            rows={city.rows}
                                          />
                                          {cityOpen
                                            ? city.rows.map((row) => (
                                                <MatrixRow
                                                  key={row.operationBrId}
                                                  row={row}
                                                  days={days}
                                                  dayList={dayList}
                                                  weekend={weekend}
                                                  todayDay={todayDay}
                                                  competence={competence}
                                                  canEdit={canEdit}
                                                  onEdit={openEditor}
                                                  onOpenBr={onOpenBr}
                                                />
                                              ))
                                            : null}
                                        </React.Fragment>
                                      );
                                    })
                                  : null}
                              </React.Fragment>
                            );
                          })
                        : null}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          </Card>

          {/* ------------------------------------------- cartões (celular) */}
          <div className="flex min-w-0 flex-col gap-5 md:hidden" aria-label="BRs da competência">
            {groups.map((op) => {
              const semVeiculo = withoutVehicle(op.rows);
              return (
                <section key={op.key} aria-label={op.name} className="flex min-w-0 flex-col gap-3">
                  <h3 className="flex flex-wrap items-center gap-2 text-body-sm font-semibold text-fg">
                    <Building2 aria-hidden className="size-4 shrink-0 text-fg-muted" />
                    <span className="min-w-0 break-words">{op.name}</span>
                    <Badge size="sm">{plural(op.rows.length, "BR", "BRs")}</Badge>
                    {semVeiculo > 0 ? (
                      <Badge size="sm" variant="warning">{number.format(semVeiculo)} sem veículo no mês</Badge>
                    ) : null}
                  </h3>
                  {op.cities.map((city) => (
                    <div key={city.key} className="flex min-w-0 flex-col gap-2">
                      <h4 className="flex items-center gap-1.5 text-caption font-medium uppercase tracking-wide text-fg-muted">
                        <MapPin aria-hidden className="size-3.5 shrink-0" />
                        {city.label} · {plural(city.rows.length, "BR", "BRs")}
                      </h4>
                      <ul className="flex min-w-0 flex-col gap-2">
                        {city.rows.map((row) => (
                          <li key={row.operationBrId} className="min-w-0">
                            <BrCard
                              row={row}
                              days={days}
                              competence={competence}
                              canEdit={canEdit}
                              onEdit={() => openEditor(row, defaultDate)}
                              onOpenBr={onOpenBr}
                            />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
              );
            })}
          </div>
        </>
      )}

      {canEdit ? (
        <PeriodDialog
          key={editing?.nonce ?? 0}
          open={dialogOpen && editing !== null}
          onOpenChange={setDialogOpen}
          row={editing?.row ?? null}
          date={editing?.date ?? null}
          competence={competence}
          today={today}
          canManageHistorical={canManageHistorical}
          applyPeriod={applyPeriod}
          searchVehicles={searchVehicles}
        />
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------- legenda */

/** A legenda, escrita: cor nunca é a única forma de dizer o estado. */
function PlannerLegend() {
  return (
    <ul
      aria-label="Legenda do grid"
      className="hidden flex-wrap items-center gap-x-4 gap-y-1.5 text-caption text-fg-secondary md:flex"
    >
      {(["planned", "confirmed", "executed"] as const).map((key) => (
        <li key={key} className="flex items-center gap-1.5">
          <span aria-hidden className={cn("size-3 rounded-xs border", STATUS_STYLE[key].bar)} />
          {STATUS_STYLE[key].label}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <ArrowLeftRight aria-hidden className="size-3.5" />
        Entrou por substituição/inversão
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="size-3 rounded-xs border border-dashed border-border-strong" />
        Sem veículo
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="size-3 rounded-xs border border-border bg-surface-secondary" />
        Fim de semana
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="size-3 rounded-xs border-x-2 border-primary bg-primary-soft" />
        Dia de hoje
      </li>
      <li className="flex items-center gap-1.5">
        <ChevronRight aria-hidden className="size-3.5" />
        Continua em outro mês
      </li>
    </ul>
  );
}

/* ------------------------------------------------------------ group header */

const HEADER_INDENT = ["pl-3", "pl-8", "pl-12"] as const;

function GroupHeader({
  level, open, onToggle, icon, title, rows,
}: {
  level: 0 | 1 | 2;
  open: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  title: string;
  rows: PlannerRow[];
}) {
  const semVeiculo = withoutVehicle(rows);
  return (
    <div
      className={cn(
        "flex border-b border-border",
        level === 0 ? "bg-surface-secondary" : level === 1 ? "bg-surface" : "bg-surface",
      )}
    >
      {/* Fixo à esquerda: rolar até o dia 30 não tira o grupo de vista. */}
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          "sticky left-0 z-20 flex items-center gap-2 py-2 pr-4 text-left hfm-transition hfm-focus-ring hover:bg-hover-overlay",
          HEADER_INDENT[level],
        )}
      >
        {open ? (
          <ChevronDown aria-hidden className="size-4 shrink-0 text-fg-muted" />
        ) : (
          <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-muted" />
        )}
        <span aria-hidden className="flex shrink-0 text-fg-muted [&_svg]:size-4">{icon}</span>
        <span
          className={cn(
            "whitespace-nowrap text-fg",
            level === 0 ? "text-body-sm font-semibold" : level === 1 ? "text-body-sm font-medium" : "text-body-sm text-fg-secondary",
          )}
        >
          {title}
        </span>
        <Badge size="sm">{plural(rows.length, "BR", "BRs")}</Badge>
        {semVeiculo > 0 ? (
          <Badge size="sm" variant="warning">{number.format(semVeiculo)} sem veículo no mês</Badge>
        ) : null}
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- matrix row */

interface MatrixRowProps {
  row: PlannerRow;
  days: number;
  dayList: number[];
  weekend: boolean[];
  todayDay: number | null;
  competence: Competence;
  canEdit: boolean;
  onEdit: (row: PlannerRow, date: string) => void;
  onOpenBr?: (operationBrId: string) => void;
}

function dayTitle(row: PlannerRow, segment: PlannerSegment | null, iso: string, dow: number, canEdit: boolean): string {
  const lines = [
    `${row.brCode}${row.brDescription ? ` — ${row.brDescription}` : ""}`,
    `${WEEKDAY_NAMES[dow]}, ${formatDateBr(iso)}`,
  ];
  if (!segment) {
    lines.push("Sem veículo neste dia");
  } else {
    lines.push(
      `Veículo: ${segment.fleetCode ?? "sem código de frota"} · placa ${segment.licensePlate ?? "—"}${
        segment.vehicleTypeName ? ` · ${segment.vehicleTypeName}` : ""
      }`,
    );
    lines.push(
      `Situação: ${STATUS_STYLE[segment.status].label}${
        isSwap(segment) ? (segment.source === "inversion" ? " · entrou por inversão" : " · entrou por substituição") : ""
      }`,
    );
    const drivers = segment.drivers.filter((d) => d.startDate <= iso && (d.endDate ?? OPEN_END) >= iso);
    lines.push(
      drivers.length > 0
        ? `Motoristas: ${drivers.map((d) => `${d.name} (${d.driverRole === "primary" ? "principal" : "secundário"})`).join(", ")}`
        : "Sem motorista planejado",
    );
    lines.push(`Vínculo: ${formatDateBr(segment.startDate)} a ${segment.endDate ? formatDateBr(segment.endDate) : "em aberto"}`);
  }
  if (canEdit) lines.push("Clique para editar o período");
  return lines.join("\n");
}

function MatrixRow({ row, days, dayList, weekend, todayDay, competence, canEdit, onEdit, onOpenBr }: MatrixRowProps) {
  const runs = buildRuns(row, days);
  const empty = runs.every((r) => r.kind === "empty");

  return (
    <div className="flex border-b border-border/60">
      {/* ---------------------------------------------------- primeira coluna */}
      <div
        className="sticky left-0 z-20 flex shrink-0 flex-col justify-center gap-0.5 border-r border-border bg-surface px-3 py-1.5"
        style={{ width: "var(--label-w)" }}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {onOpenBr ? (
            <button
              type="button"
              onClick={() => onOpenBr(row.operationBrId)}
              title={`Abrir a BR ${row.brCode}`}
              className="min-w-0 truncate rounded-xs text-left text-body-sm font-semibold text-link hover:text-link-hover hover:underline hfm-focus-ring"
            >
              {row.brCode}
            </button>
          ) : (
            <span className="min-w-0 truncate text-body-sm font-semibold text-fg">{row.brCode}</span>
          )}
          {row.brStatus !== "active" ? <Badge size="sm">Inativa</Badge> : null}
        </span>
        <span className="truncate text-caption text-fg-secondary">
          {row.brDescription ? `${row.brDescription} · ` : ""}
          {row.cityName}/{row.stateUf}
        </span>
        <span className="truncate text-caption text-fg-muted">
          {row.leaderName ?? "Sem liderança definida"}
        </span>
        {row.leaderLevel === "br" ? (
          <span className="truncate text-caption font-medium text-accent-soft-fg">por exceção do BR</span>
        ) : null}
      </div>

      {/* --------------------------------------------------------------- dias */}
      <div className="relative shrink-0" style={{ width: `calc(${days} * var(--cell-w))`, minHeight: "3.5rem" }}>
        <div aria-hidden className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${days}, var(--cell-w))` }}>
          {dayList.map((day, i) => (
            <div
              key={day}
              className={cn(
                "border-l border-border/40",
                weekend[i] && "bg-surface-secondary/70",
                day === todayDay && "bg-primary-soft/60",
              )}
            />
          ))}
        </div>

        {runs.map((run) =>
          run.kind === "vehicle" ? (
            <VehicleBlock key={`${run.segment.assignmentId}-${run.start}`} run={run} days={days} canEdit={canEdit} />
          ) : (
            <EmptyBlock key={`empty-${run.start}`} run={run} wholeMonth={empty} canEdit={canEdit} />
          ),
        )}

        {todayDay ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 z-[5] border-x-2 border-primary/70"
            style={{ left: `calc(${todayDay - 1} * var(--cell-w))`, width: "var(--cell-w)" }}
          />
        ) : null}

        {canEdit ? (
          <div className="absolute inset-0 z-10 grid" style={{ gridTemplateColumns: `repeat(${days}, var(--cell-w))` }}>
            {dayList.map((day) => {
              const segment = segmentAtDay(row, day);
              const iso = isoOf(competence, day);
              const dow = weekdayOf(competence.year, competence.month, day);
              const what = segment
                ? `${vehicleLabel(segment.fleetCode, segment.licensePlate)}${
                    segment.fleetCode && segment.licensePlate ? ` (${segment.licensePlate})` : ""
                  }, ${STATUS_STYLE[segment.status].label.toLowerCase()}`
                : "sem veículo";
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => onEdit(row, iso)}
                  aria-label={`${row.brCode} · ${formatDateBr(iso)} · ${what}`}
                  title={dayTitle(row, segment, iso, dow, true)}
                  className="group/day relative flex items-center justify-center hfm-transition hover:bg-selected-overlay hfm-focus-ring focus-visible:z-10"
                >
                  {!segment ? (
                    <Plus
                      aria-hidden
                      className="size-3.5 text-fg-muted opacity-0 group-hover/day:opacity-100 group-focus-visible/day:opacity-100"
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** O rótulo de um bloco gruda logo depois da primeira coluna fixa. */
const STICKY_LABEL_LEFT = "calc(var(--label-w) + 0.375rem)";

function VehicleBlock({
  run, days, canEdit,
}: {
  run: Extract<Run, { kind: "vehicle" }>;
  days: number;
  canEdit: boolean;
}) {
  const s = run.segment;
  const length = run.end - run.start + 1;
  // Borda aberta: o vínculo vem do mês anterior ou segue no próximo.
  const openLeft = !s.startsHere && run.start === 1;
  const openRight = !s.endsHere && run.end === days;
  const style = STATUS_STYLE[s.status] ?? STATUS_STYLE.planned;
  const label = vehicleLabel(s.fleetCode, s.licensePlate);
  const inset = (openLeft ? 0 : 2) + (openRight ? 0 : 2);

  return (
    <div
      aria-hidden={canEdit || undefined}
      title={canEdit ? undefined : `${label}${s.licensePlate && s.fleetCode ? ` · placa ${s.licensePlate}` : ""} · ${style.label}`}
      className={cn(
        // `overflow-clip`, não `overflow-hidden`: não cria contêiner de rolagem, e
        // assim o rótulo pode ficar grudado ao lado da primeira coluna quando o
        // começo do bloco sai de vista na rolagem horizontal.
        "absolute top-1.5 bottom-1.5 flex items-center gap-1 overflow-clip border px-1.5",
        style.bar,
        openLeft ? "rounded-l-none border-l-0 pl-1" : "rounded-l-sm",
        openRight ? "rounded-r-none border-r-0 pr-1" : "rounded-r-sm",
        canEdit && "pointer-events-none",
      )}
      style={{
        left: `calc(${run.start - 1} * var(--cell-w) + ${openLeft ? 0 : 2}px)`,
        width: `calc(${length} * var(--cell-w) - ${inset}px)`,
      }}
    >
      {openLeft ? <ChevronLeft aria-hidden className={cn("size-3 shrink-0", style.text)} /> : null}
      <span className="sticky flex min-w-0 items-center gap-1" style={{ left: STICKY_LABEL_LEFT }}>
        {isSwap(s) && length > 1 ? <ArrowLeftRight aria-hidden className={cn("size-3 shrink-0", style.text)} /> : null}
        <span className={cn("min-w-0 truncate text-caption font-semibold", style.text)}>
          {label}
          {length >= 5 && s.fleetCode && s.licensePlate ? (
            <span className="font-normal"> · {s.licensePlate}</span>
          ) : null}
        </span>
      </span>
      {!canEdit ? <span className="sr-only">{`, ${style.label}, dias ${run.start} a ${run.end}`}</span> : null}
      {openRight ? <ChevronRight aria-hidden className={cn("ml-auto size-3 shrink-0", style.text)} /> : null}
    </div>
  );
}

function EmptyBlock({
  run, wholeMonth, canEdit,
}: {
  run: Extract<Run, { kind: "empty" }>;
  wholeMonth: boolean;
  canEdit: boolean;
}) {
  const length = run.end - run.start + 1;
  return (
    <div
      aria-hidden={canEdit || undefined}
      className="pointer-events-none absolute top-1.5 bottom-1.5 flex items-center gap-1 overflow-clip rounded-sm border border-dashed border-border-strong px-1.5 text-fg-muted"
      style={{
        left: `calc(${run.start - 1} * var(--cell-w) + 2px)`,
        width: `calc(${length} * var(--cell-w) - 4px)`,
      }}
    >
      {length >= 3 ? (
        <span className="sticky flex min-w-0 items-center gap-1" style={{ left: STICKY_LABEL_LEFT }}>
          <CircleSlash aria-hidden className="size-3 shrink-0" />
          <span className="truncate text-caption">{wholeMonth ? "Sem veículo no mês" : "Sem veículo"}</span>
        </span>
      ) : (
        <span className="mx-auto text-caption">
          <span aria-hidden>—</span>
          <span className="sr-only">Sem veículo</span>
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ mobile card */

function BrCard({
  row, days, competence, canEdit, onEdit, onOpenBr,
}: {
  row: PlannerRow;
  days: number;
  competence: Competence;
  canEdit: boolean;
  onEdit: () => void;
  onOpenBr?: (operationBrId: string) => void;
}) {
  const segments = activeSegments(row);
  const gaps = buildRuns(row, days).filter((r): r is Extract<Run, { kind: "empty" }> => r.kind === "empty");
  const dm = (iso: string) => dayMonth(iso, competence.year);
  const dayIso = (day: number) => dm(isoOf(competence, day));

  return (
    <Card className="min-w-0 gap-2.5 p-3">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-body-sm font-semibold text-fg">{row.brCode}</p>
          {row.brDescription ? (
            <p className="truncate text-caption text-fg-secondary">{row.brDescription}</p>
          ) : null}
          <p className="text-caption text-fg-muted">
            {row.leaderName ?? "Sem liderança definida"}
            {row.leaderLevel === "br" ? " · por exceção do BR" : ""}
          </p>
        </div>
        {segments.length === 0 ? (
          <Badge size="sm" variant="warning" icon={<CircleSlash />}>Sem veículo no mês</Badge>
        ) : null}
      </div>

      {segments.length > 0 ? (
        <ul className="flex min-w-0 flex-col gap-1.5" aria-label={`Veículos da ${row.brCode} no mês`}>
          {segments.map((s) => (
            <li key={s.assignmentId} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-body-sm">
              <span className="min-w-0 break-words text-fg">
                <span className="tabular-nums text-fg-secondary">
                  {dm(s.startDate)} – {s.endDate ? dm(s.endDate) : "em aberto"}
                </span>
                {" · "}
                <span className="font-medium">
                  {vehicleLabel(s.fleetCode, s.licensePlate)}
                  {s.fleetCode && s.licensePlate ? ` (${s.licensePlate})` : ""}
                </span>
              </span>
              {isSwap(s) ? (
                <Badge size="sm" icon={<ArrowLeftRight />}>
                  {s.source === "inversion" ? "Inversão" : "Substituição"}
                </Badge>
              ) : null}
              <Badge size="sm" variant={STATUS_STYLE[s.status].tone}>{STATUS_STYLE[s.status].label}</Badge>
            </li>
          ))}
        </ul>
      ) : null}

      {segments.length > 0 && gaps.length > 0 ? (
        <p className="flex min-w-0 items-start gap-1.5 text-caption text-warning-soft-fg">
          <CircleSlash aria-hidden className="mt-px size-3.5 shrink-0" />
          <span className="min-w-0 break-words">
            Sem veículo:{" "}
            {gaps
              .map((g) => (g.start === g.end ? dayIso(g.start) : `${dayIso(g.start)} – ${dayIso(g.end)}`))
              .join(", ")}
          </span>
        </p>
      ) : null}

      {canEdit || onOpenBr ? (
        <div className="flex flex-wrap gap-2">
          {canEdit ? (
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<Pencil />}
              aria-label={`Editar período da ${row.brCode}`}
              onClick={onEdit}
            >
              Editar período
            </Button>
          ) : null}
          {onOpenBr ? (
            <Button size="sm" variant="ghost" onClick={() => onOpenBr(row.operationBrId)}>
              Abrir BR
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
