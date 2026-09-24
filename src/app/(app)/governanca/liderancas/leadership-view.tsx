"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CopyCheck, Gauge, Layers, ListTree, MapPin, Plus, Users } from "lucide-react";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { FilterBar } from "@/components/ui/filter-bar";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { CompetencePicker } from "@/components/governance/competence-picker";
import { NativeSelect } from "@/components/governance/selects";
import type { BrEntry, CoverageEntry } from "@/components/governance/scope-picker";
import type { LeadershipIndicators, LeadershipRow } from "@/lib/governance/queries";
import { formatCompetence, monthEnd, monthStart, type Competence } from "@/lib/governance/competence";
import type { LeaderOption } from "@/lib/governance/leadership-export";
import {
  anchorDate, plannerIndicators,
  type CityLeadershipSaver, type LeadershipPlanner, type PlannerCity, type PlannerLeader, type PlannerOperation,
} from "@/lib/governance/leadership-planner-types";
import {
  LeadershipFormDrawer,
  type LeadershipFormValue,
  type LeadershipImpactLoader,
  type LeadershipSaver,
} from "./leadership-form-drawer";
import { LeadershipExportMenu } from "./export-menu";
import { ReplicateDialog } from "./replicate-dialog";
import { LeaderScopeDrawer, type LeaderScopeLoader } from "./leader-scope-drawer";
import { CityPlanner } from "./city-planner";

const number = new Intl.NumberFormat("pt-BR");
const percent = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

/** Quem a gaveta "o que esta liderança responde" descreve. */
interface ScopeLeader {
  id: string;
  name: string;
  code: string | null;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  return d ? `${d}/${m}/${y}` : value;
}

/** Onde a pessoa responde, em poucas palavras: "Contagem/MG", "BR0024901 · Contagem/MG", "Toda a operação". */
function placeLabel(row: LeadershipRow): string {
  if (row.scopeLevel === "operation") return "Toda a operação";
  const city = [row.cityName, row.stateUf].filter(Boolean).join("/");
  return row.scopeLevel === "br" ? `${row.brCode ?? "BR"} · ${city}` : city;
}

/** O pedaço da competência em que valeu, quando não foi o mês inteiro. */
function partOfMonth(row: LeadershipRow, first: string, last: string): string | null {
  const from = row.effectiveFrom > first ? `desde ${formatDate(row.effectiveFrom)}` : null;
  const to = row.effectiveTo && row.effectiveTo < last ? `até ${formatDate(row.effectiveTo)}` : null;
  return [from, to].filter(Boolean).join(" ") || null;
}

export interface LeadershipViewProps {
  rows: LeadershipRow[];
  indicators: LeadershipIndicators | null;
  /** A matriz Tipo de Operação → Cidades; `null` quando a leitura falhou. */
  planner: LeadershipPlanner | null;
  competence: Competence;
  operations: { id: string; name: string; status: string }[];
  coverage: CoverageEntry[];
  brs: BrEntry[];
  filters: {
    operationId?: string;
    stateId?: string;
    cityId?: string;
    scope?: string;
    status?: string;
    employeeId?: string;
  };
  /** Lideranças da competência, para o filtro "Liderança" (§20). */
  leaders?: LeaderOption[];
  canManage: boolean;
  canAssign: boolean;
  canReplicate: boolean;
  /** `leadership.export` — "Exportar, quando autorizado" (§20). */
  canExport?: boolean;
  /** `leadership.manage_historical_data` — correção de datas passadas (Etapa 13 §14). */
  canManageHistorical?: boolean;
  /** A prévia de desenvolvimento injeta o escopo de uma liderança; a tela real usa a server action. */
  scopeLoader?: LeaderScopeLoader;
  /** Idem para a prévia de impacto e para a gravação do formulário. */
  impactLoader?: LeadershipImpactLoader;
  saver?: LeadershipSaver;
  /** Idem para a escolha da liderança de uma cidade no Planejamento. */
  citySaver?: CityLeadershipSaver;
}

/**
 * Governança Operacional → Lideranças.
 *
 * Duas perguntas, uma aba cada. "Planejamento": quem responde por cada cidade
 * de cada tipo de operação na competência — a matriz do HFC, onde escolher a
 * pessoa já grava. "Por liderança": o que cada pessoa responde, agrupado por
 * ela ou por tipo de operação. Tudo lê e grava `leadership_assignments`: a
 * designação não altera o Perfil de Acesso de ninguém.
 */
export function LeadershipView({
  rows,
  indicators,
  planner,
  competence,
  operations,
  coverage,
  brs,
  filters,
  leaders = [],
  canManage,
  canAssign,
  canReplicate,
  canExport = false,
  canManageHistorical = false,
  scopeLoader,
  impactLoader,
  saver,
  citySaver,
}: LeadershipViewProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = React.useTransition();
  const [formOpen, setFormOpen] = React.useState(false);
  const [replicateOpen, setReplicateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<LeadershipFormValue | undefined>();
  const [scopeLeader, setScopeLeader] = React.useState<ScopeLeader | null>(null);
  const [groupBy, setGroupBy] = React.useState<"leader" | "operation">(
    params.get("agrupar") === "operacao" ? "operation" : "leader",
  );
  // Bumped on every open so the form remounts with fresh state. Resetting it
  // from an effect instead would re-render the whole drawer a second time on
  // each open, and would leave the previous edit visible for that first frame.
  const [formKey, setFormKey] = React.useState(0);

  const navigate = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    startTransition(() => router.push(`/governanca/liderancas?${next.toString()}`, { scroll: false }));
  };

  const setCompetence = (value: Competence) =>
    navigate({ ano: String(value.year), mes: String(value.month) });

  const statesOfOperation = React.useMemo(() => {
    const scoped = filters.operationId
      ? coverage.filter((c) => c.operationId === filters.operationId)
      : coverage;
    const seen = new Map<number, string>();
    for (const c of scoped) seen.set(c.stateId, c.uf);
    return [...seen.entries()].map(([id, uf]) => ({ id, uf })).sort((a, b) => a.uf.localeCompare(b.uf));
  }, [coverage, filters.operationId]);

  /** As cidades da operação e do estado escolhidos — sem estado, todas as da operação (ou da organização). */
  const citiesOfFilter = React.useMemo(() => {
    const seen = new Map<number, { cityId: number; cityName: string; uf: string }>();
    for (const c of coverage) {
      if (filters.operationId && c.operationId !== filters.operationId) continue;
      if (filters.stateId && c.stateId !== Number(filters.stateId)) continue;
      seen.set(c.cityId, { cityId: c.cityId, cityName: c.cityName, uf: c.uf });
    }
    return [...seen.values()].sort((a, b) => a.cityName.localeCompare(b.cityName, "pt-BR"));
  }, [coverage, filters.operationId, filters.stateId]);

  /** A query da tela, sem formato: a exportação recebe exatamente os mesmos filtros. */
  const exportQuery = React.useMemo(() => {
    const query = new URLSearchParams({ ano: String(competence.year), mes: String(competence.month) });
    const entries: [string, string | undefined][] = [
      ["operacao", filters.operationId],
      ["uf", filters.stateId],
      ["cidade", filters.cityId],
      ["nivel", filters.scope],
      ["situacao", filters.status],
      ["lideranca", filters.employeeId],
    ];
    for (const [key, value] of entries) if (value) query.set(key, value);
    return query.toString();
  }, [competence, filters]);

  const first = monthStart(competence);
  const last = monthEnd(competence);
  // O que valeu em algum dia da competência — encerrado no meio do mês também conta.
  const visible = React.useMemo(() => rows.filter((r) => r.status !== "cancelled"), [rows]);

  /** §22: o que cada pessoa responde, a partir dos vínculos que existem. */
  const byLeader = React.useMemo(() => {
    const map = new Map<string, { name: string; code: string | null; rows: LeadershipRow[] }>();
    for (const row of visible) {
      const entry = map.get(row.employeeId) ?? { name: row.employeeName, code: row.employeeCode, rows: [] };
      entry.rows.push(row);
      map.set(row.employeeId, entry);
    }
    return [...map.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [visible]);

  /** Por tipo de operação: em cada operação, quais lideranças estão com quais cidades. */
  const byOperation = React.useMemo(() => {
    const ops = new Map<string, { name: string; leaders: Map<string, { name: string; code: string | null; rows: LeadershipRow[] }> }>();
    for (const row of visible) {
      const op = ops.get(row.operationId) ?? { name: row.operationName, leaders: new Map() };
      const leader = op.leaders.get(row.employeeId) ?? { name: row.employeeName, code: row.employeeCode, rows: [] };
      leader.rows.push(row);
      op.leaders.set(row.employeeId, leader);
      ops.set(row.operationId, op);
    }
    return [...ops.entries()]
      .map(([id, op]) => ({
        id,
        name: op.name,
        leaders: [...op.leaders.entries()]
          .map(([employeeId, l]) => ({
            employeeId,
            ...l,
            rows: [...l.rows].sort((a, b) => placeLabel(a).localeCompare(placeLabel(b), "pt-BR")),
          }))
          .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [visible]);

  const cards = React.useMemo(
    () => (planner ? plannerIndicators(planner.operations, anchorDate(planner)) : null),
    [planner],
  );

  const openNew = () => {
    setEditing(undefined);
    setFormKey((k) => k + 1);
    setFormOpen(true);
  };

  /** §35: o que aquela pessoa responde na competência. */
  const openScope = (leader: ScopeLeader) => setScopeLeader(leader);

  /** Datas exatas e prévia de impacto de um vínculo de cidade do Planejamento. */
  const openPlannerEdit = (operation: PlannerOperation, city: PlannerCity, leader: PlannerLeader) => {
    setEditing({
      id: leader.id,
      employee: { id: leader.employeeId, name: leader.employeeName, code: leader.employeeCode, operationName: operation.name },
      scopeLevel: "city",
      operationId: operation.id,
      operationCityId: city.operationCityId,
      operationBrId: null,
      responsibilityType: "principal",
      effectiveFrom: leader.effectiveFrom,
      effectiveTo: leader.effectiveTo,
      notes: leader.notes,
      updatedAt: leader.updatedAt,
    });
    setFormKey((k) => k + 1);
    setFormOpen(true);
  };

  const leaderScopeButton = (leader: { id: string; name: string; code: string | null }) => (
    <Button
      variant="outline"
      size="sm"
      leadingIcon={<ListTree />}
      aria-label={`O que esta liderança responde: ${leader.name}`}
      onClick={() => openScope(leader)}
    >
      O que responde
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Lideranças"
        description="Planeje quem responde por cada cidade de cada tipo de operação. A designação registra quem responde — ela não altera o Perfil de Acesso de ninguém."
        secondaryActions={
          canReplicate || canExport || (canManage && canAssign) ? (
            <>
              {canExport ? <LeadershipExportMenu query={exportQuery} rowCount={rows.length} /> : null}
              {canManage && canAssign ? (
                <Button variant="ghost" leadingIcon={<Plus />} onClick={openNew}>
                  Vínculo por período
                </Button>
              ) : null}
              {canReplicate ? (
                <Button variant="secondary" leadingIcon={<CopyCheck />} onClick={() => setReplicateOpen(true)}>
                  Replicar competência
                </Button>
              ) : null}
            </>
          ) : undefined
        }
        filters={
          <FilterBar className="flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-caption text-fg-muted">Competência</span>
              <CompetencePicker value={competence} onChange={setCompetence} disabled={pending} />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-caption text-fg-muted">Tipo de operação</span>
              <NativeSelect
                fieldSize="sm"
                aria-label="Filtrar por operação"
                value={filters.operationId ?? ""}
                onChange={(e) => navigate({ operacao: e.target.value || null, uf: null, cidade: null })}
                className="min-w-[12rem]"
              >
                <option value="">Todas as operações</option>
                {operations.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </NativeSelect>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-caption text-fg-muted">Estado</span>
              <NativeSelect
                fieldSize="sm"
                aria-label="Filtrar por estado"
                value={filters.stateId ?? ""}
                onChange={(e) => navigate({ uf: e.target.value || null, cidade: null })}
                className="min-w-[7rem]"
              >
                <option value="">Todos</option>
                {statesOfOperation.map((s) => (
                  <option key={s.id} value={s.id}>{s.uf}</option>
                ))}
              </NativeSelect>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-caption text-fg-muted">Cidade</span>
              <NativeSelect
                fieldSize="sm"
                aria-label="Filtrar por cidade"
                value={filters.cityId ?? ""}
                disabled={citiesOfFilter.length === 0}
                onChange={(e) => navigate({ cidade: e.target.value || null })}
                className="min-w-[11rem]"
              >
                <option value="">Todas</option>
                {citiesOfFilter.map((c) => (
                  <option key={c.cityId} value={c.cityId}>
                    {filters.stateId ? c.cityName : `${c.cityName}/${c.uf}`}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-caption text-fg-muted">Liderança</span>
              <NativeSelect
                fieldSize="sm"
                aria-label="Filtrar por liderança"
                value={filters.employeeId ?? ""}
                onChange={(e) => navigate({ lideranca: e.target.value || null })}
                className="min-w-[12rem] max-w-[18rem]"
              >
                <option value="">Todas as lideranças</option>
                {leaders.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code ? `${l.name} (${l.code})` : l.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </FilterBar>
        }
      />

      <PageContent className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Locais de operação"
            value={cards ? number.format(cards.places) : "—"}
            period="Cidades das operações ativas"
            icon={<MapPin />}
          />
          <KpiCard
            label="Atribuídos no mês"
            value={cards ? `${number.format(cards.assigned)}/${number.format(cards.places)}` : "—"}
            status={cards && cards.assigned < cards.places ? "warning" : undefined}
            period={
              cards?.coveragePct !== null && cards?.coveragePct !== undefined
                ? `Cobertura ${percent.format(cards.coveragePct)}% · ${formatCompetence(competence)}`
                : formatCompetence(competence)
            }
            icon={<Gauge />}
          />
          <KpiCard
            label="Lideranças envolvidas"
            value={cards ? number.format(cards.leaders) : "—"}
            period="Pessoas distintas nas cidades"
            icon={<Users />}
          />
          <KpiCard
            label="Sob responsabilidade"
            value={number.format(indicators?.brsUnderLeadership ?? 0)}
            unit="BRs"
            period={
              indicators
                ? `${number.format(indicators.vehiclesLinked)} veículos · ${number.format(indicators.driversLinked)} motoristas`
                : "—"
            }
            icon={<Layers />}
          />
        </div>

        <Tabs defaultValue={params.get("aba") === "liderancas" ? "liderancas" : "planejamento"}>
          <TabsList>
            <TabsTrigger value="planejamento">Planejamento</TabsTrigger>
            <TabsTrigger value="liderancas">Por liderança</TabsTrigger>
          </TabsList>

          {/* ------------------------------------------------ planejamento */}
          <TabsContent value="planejamento">
            {planner ? (
              <CityPlanner
                planner={planner}
                competence={competence}
                filters={filters}
                canPlan={canManage && canAssign}
                canRemove={canManage}
                canManageHistorical={canManageHistorical}
                onEdit={openPlannerEdit}
                saver={citySaver}
              />
            ) : (
              <Alert variant="danger">
                <AlertTitle>Não foi possível carregar o planejamento.</AlertTitle>
                <AlertDescription>
                  A aba Por liderança continua disponível. Recarregue a página; se o erro continuar, avise o administrador.
                </AlertDescription>
              </Alert>
            )}
          </TabsContent>

          {/* -------------------------------------------------- por liderança */}
          <TabsContent value="liderancas" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Agrupar por">
              <span className="text-caption text-fg-muted">Agrupar por</span>
              <Button
                variant={groupBy === "leader" ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={groupBy === "leader"}
                onClick={() => setGroupBy("leader")}
              >
                Liderança
              </Button>
              <Button
                variant={groupBy === "operation" ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={groupBy === "operation"}
                onClick={() => setGroupBy("operation")}
              >
                Tipo de operação
              </Button>
              <span className="ml-auto text-caption text-fg-muted">{formatCompetence(competence)}</span>
            </div>

            {visible.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-body-sm text-fg-muted">
                  Nenhuma liderança designada nesta competência.
                </CardContent>
              </Card>
            ) : groupBy === "leader" ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {byLeader.map((leader) => (
                  <Card key={leader.id}>
                    <CardContent className="flex flex-col gap-3">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-body font-medium text-fg">{leader.name}</p>
                          <p className="text-caption text-fg-muted">
                            {leader.code ? `Matrícula ${leader.code} · ` : ""}
                            {leader.rows.length === 1 ? "1 local" : `${leader.rows.length} locais`} na competência
                          </p>
                        </div>
                        {leaderScopeButton(leader)}
                      </div>
                      <ul className="flex flex-col gap-1.5">
                        {leader.rows.map((row) => {
                          const part = partOfMonth(row, first, last);
                          return (
                            <li key={row.id} className="flex items-start gap-2 text-body-sm">
                              <Badge variant="neutral" appearance="soft" size="sm">
                                {row.operationName}
                              </Badge>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-fg">{placeLabel(row)}</span>
                                {part || !row.isPrimary ? (
                                  <span className="block text-caption text-fg-muted">
                                    {[part, row.isPrimary ? null : "substituto/apoio"].filter(Boolean).join(" · ")}
                                  </span>
                                ) : null}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {byOperation.map((op) => (
                  <section
                    key={op.id}
                    aria-label={op.name}
                    className="overflow-hidden rounded-md border border-border bg-surface"
                  >
                    <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                      <h3 className="text-body font-semibold text-fg">{op.name}</h3>
                      <Badge variant="primary" appearance="soft" size="sm">
                        {op.leaders.length === 1 ? "1 liderança" : `${op.leaders.length} lideranças`}
                      </Badge>
                    </header>
                    <ul className="divide-y divide-border">
                      {op.leaders.map((leader) => (
                        <li
                          key={leader.employeeId}
                          className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3"
                          data-testid="operation-leader"
                        >
                          <div className="min-w-[12rem] flex-1 sm:max-w-[18rem]">
                            <p className="font-medium text-fg">{leader.name}</p>
                            {leader.code ? (
                              <p className="text-caption text-fg-muted">Matrícula {leader.code}</p>
                            ) : null}
                          </div>
                          <ul className="flex min-w-[12rem] flex-[2] flex-wrap gap-1.5" aria-label={`Locais de ${leader.name}`}>
                            {leader.rows.map((row) => {
                              const part = partOfMonth(row, first, last);
                              return (
                                <li key={row.id}>
                                  <Badge variant="neutral" appearance="soft">
                                    {placeLabel(row)}
                                    {part ? ` (${part})` : ""}
                                    {row.isPrimary ? "" : " · substituto/apoio"}
                                  </Badge>
                                </li>
                              );
                            })}
                          </ul>
                          <div className="shrink-0">
                            {leaderScopeButton({ id: leader.employeeId, name: leader.name, code: leader.code })}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </PageContent>

      <LeadershipFormDrawer
        key={`form-${formKey}`}
        open={formOpen}
        onOpenChange={setFormOpen}
        value={editing}
        competence={competence}
        operations={operations}
        coverage={coverage}
        brs={brs}
        canManageHistorical={canManageHistorical}
        impactLoader={impactLoader}
        saver={saver}
      />

      <ReplicateDialog
        key={`replicate-${replicateOpen}`}
        open={replicateOpen}
        onOpenChange={setReplicateOpen}
        competence={competence}
        operations={operations}
      />

      <LeaderScopeDrawer
        leader={scopeLeader}
        competence={competence}
        onClose={() => setScopeLeader(null)}
        loader={scopeLoader}
      />
    </>
  );
}
