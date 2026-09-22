"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeftRight, CalendarDays, ChevronDown, CircleSlash, CopyCheck, Download, MapPin, Truck, Upload,
  UserRound, UserRoundPen,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { FilterBar } from "@/components/ui/filter-bar";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { CompetencePicker } from "@/components/governance/competence-picker";
import { NativeSelect } from "@/components/governance/selects";
import type { CoverageEntry } from "@/components/governance/scope-picker";
import type {
  CalendarRow, DriverPlanRow, FidelizationIndicators, FidelizationRow,
  HierarchyOperation, OperationBrRow,
} from "@/lib/governance/queries";
import type { BrPlannerIndicators, BrPlannerRow } from "@/lib/governance/br-planner";
import type { FidelizationStability } from "@/lib/governance/brs";
import { formatCompetence, type Competence } from "@/lib/governance/competence";
import { CalendarLegend, CalendarMatrix } from "./calendar-matrix";
import { BrPlanner } from "./br-planner";
import { BrsModuleNotice } from "./brs-module-notice";
import { AssignmentDrawer } from "./assignment-drawer";
import { InvertDialog } from "./invert-dialog";
import { HierarchyPanel } from "./hierarchy-panel";
import { ImportDrawer } from "./import-drawer";
import { StabilityDashboard } from "./stability-dashboard";
import { DriverSubstituteDialog, canSubstituteDriver } from "./driver-substitute-dialog";
import { ReplicateFidelizationDialog } from "./replicate-fidelization-dialog";

const number = new Intl.NumberFormat("pt-BR");

function formatDate(value: string | null): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  return d ? `${d}/${m}/${y}` : value;
}

/** A origem de cada vínculo, com nome — a replicação (§37) não é uma substituição. */
const SOURCE_LABEL: Record<string, string> = {
  manual: "Manual",
  import: "Importação",
  substitution: "Substituição",
  inversion: "Inversão",
  replication: "Replicação",
};

/** Os filtros que o módulo BRs entende e que a pessoa não deve ter de refazer lá. */
const BRS_MODULE_FILTERS = ["operacao", "uf", "cidade", "ano", "mes"] as const;

export interface FidelizationViewProps {
  calendar: CalendarRow[];
  brs: OperationBrRow[];
  history: FidelizationRow[];
  driverPlans: DriverPlanRow[];
  hierarchy: HierarchyOperation[];
  indicators: FidelizationIndicators | null;
  stability: FidelizationStability | null;
  plannerRows: BrPlannerRow[];
  plannerIndicators: BrPlannerIndicators | null;
  leaders: { id: string; name: string }[];
  competence: Competence;
  operations: { id: string; name: string; status: string }[];
  coverage: CoverageEntry[];
  filters: {
    operationId?: string;
    stateId?: string;
    cityId?: string;
    brId?: string;
    q?: string;
    status?: string;
    leaderEmployeeId?: string;
    vehicle?: string;
    driver?: string;
  };
  canPlan: boolean;
  canChangeVehicle: boolean;
  canChangeDriver: boolean;
  canImport: boolean;
  canExport: boolean;
}

/**
 * Governança Operacional → Fidelização.
 *
 * Fidelizar is not allocating. A vehicle allocated to Last Mile MG / Contagem
 * can occupy a position for two weeks without its operation or city changing,
 * and nothing on this screen writes to the vehicle's allocation. The two
 * questions stay in two tables and this screen only answers the second one.
 *
 * O cadastro de BRs (criar, editar, importar, inativar) saiu daqui para o
 * módulo Governança › BRs (Etapa 13.1, §38). Esta tela consulta e planeja a
 * posição; não a cria.
 */
export function FidelizationView({
  calendar,
  brs,
  history,
  driverPlans,
  hierarchy,
  indicators,
  stability,
  plannerRows,
  plannerIndicators,
  leaders,
  competence,
  operations,
  coverage,
  filters,
  canPlan,
  canChangeVehicle,
  canChangeDriver,
  canImport,
  canExport,
}: FidelizationViewProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  const [assignmentBr, setAssignmentBr] = React.useState<FidelizationViewProps["brs"][number] | null>(null);
  const [invertOpen, setInvertOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [replicateOpen, setReplicateOpen] = React.useState(false);
  const [substituteRow, setSubstituteRow] = React.useState<DriverPlanRow | null>(null);
  const [onlyMobilisations, setOnlyMobilisations] = React.useState(false);

  /** A exportação leva a competência e os filtros em tela: o arquivo é o que se vê. */
  const exportHref = (kind: "planner" | "historico", format: "xlsx" | "csv") => {
    const next = new URLSearchParams(params.toString());
    next.set("tipo", kind);
    next.set("format", format);
    return `/governanca/fidelizacao/export?${next.toString()}`;
  };

  /** O atalho para o módulo BRs carrega o recorte atual — competência, operação, estado e cidade. */
  const brsModuleHref = React.useMemo(() => {
    const next = new URLSearchParams();
    for (const key of BRS_MODULE_FILTERS) {
      const value = params.get(key);
      if (value) next.set(key, value);
    }
    const query = next.toString();
    return query ? `/governanca/brs?${query}` : "/governanca/brs";
  }, [params]);

  const navigate = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    startTransition(() => router.push(`/governanca/fidelizacao?${next.toString()}`, { scroll: false }));
  };

  const statesOfOperation = React.useMemo(() => {
    const scoped = filters.operationId
      ? coverage.filter((c) => c.operationId === filters.operationId)
      : coverage;
    const seen = new Map<number, string>();
    for (const c of scoped) seen.set(c.stateId, c.uf);
    return [...seen.entries()].map(([id, uf]) => ({ id, uf })).sort((a, b) => a.uf.localeCompare(b.uf));
  }, [coverage, filters.operationId]);

  const citiesOfState = React.useMemo(() => {
    if (!filters.stateId) return [];
    return coverage
      .filter(
        (c) =>
          c.stateId === Number(filters.stateId) &&
          (!filters.operationId || c.operationId === filters.operationId),
      )
      .sort((a, b) => a.cityName.localeCompare(b.cityName));
  }, [coverage, filters.stateId, filters.operationId]);

  const mobilisations = history.filter((h) => h.source === "substitution" || h.source === "inversion");
  const invertible = history.filter((h) => h.isCurrent && h.status !== "cancelled");
  const visibleHistory = onlyMobilisations ? mobilisations : history;

  /**
   * O planner trabalha com a posição pelo id; a gaveta de planejamento precisa
   * da linha completa do diretório de BRs. A ponte é feita aqui, e não
   * duplicando os campos dentro das linhas do planner — que seriam os mesmos
   * dados em duas formas, livres para divergir.
   */
  const openPlanningById = (id: string) => {
    const br = brs.find((b) => b.id === id) ?? null;
    if (br) setAssignmentBr(br);
  };

  const assignmentHistory = assignmentBr
    ? history.filter((h) => h.operationBrId === assignmentBr.id)
    : [];

  return (
    <>
      <PageHeader
        title="Fidelização"
        description="Planejamento das posições operacionais por veículo e motorista. Fidelizar não transfere a operação nem a cidade do veículo — a alocação continua no Cadastro de Frotas."
        secondaryActions={
          <>
            {canExport ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" leadingIcon={<Download />} trailingIcon={<ChevronDown />}>
                    Exportar
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Planner de locais e BRs</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => window.location.assign(exportHref("planner", "xlsx"))}>
                    Planner (XLSX)
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => window.location.assign(exportHref("planner", "csv"))}>
                    Planner (CSV)
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Histórico de movimentações</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => window.location.assign(exportHref("historico", "xlsx"))}>
                    Histórico (XLSX)
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => window.location.assign(exportHref("historico", "csv"))}>
                    Histórico (CSV)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {canImport ? (
              <Button variant="secondary" leadingIcon={<Upload />} onClick={() => setImportOpen(true)}>
                Importar
              </Button>
            ) : null}
            {canPlan ? (
              <Button variant="secondary" leadingIcon={<CopyCheck />} onClick={() => setReplicateOpen(true)}>
                Replicar competência
              </Button>
            ) : null}
            {canChangeVehicle ? (
              <Button
                variant="secondary"
                leadingIcon={<ArrowLeftRight />}
                onClick={() => setInvertOpen(true)}
              >
                Inverter veículos
              </Button>
            ) : null}
          </>
        }
        filters={
          <FilterBar className="flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-caption text-fg-muted">Competência</span>
              <CompetencePicker
                value={competence}
                onChange={(v) => navigate({ ano: String(v.year), mes: String(v.month) })}
                disabled={pending}
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-caption text-fg-muted">Operação</span>
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
                disabled={!filters.stateId}
                onChange={(e) => navigate({ cidade: e.target.value || null })}
                className="min-w-[11rem]"
              >
                <option value="">{filters.stateId ? "Todas" : "Escolha o estado"}</option>
                {citiesOfState.map((c) => (
                  <option key={c.cityId} value={c.cityId}>{c.cityName}</option>
                ))}
              </NativeSelect>
            </div>
          </FilterBar>
        }
      />

      <PageContent className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label="Posições operacionais"
            value={number.format(indicators?.totalBrs ?? brs.length)}
            period={`${number.format(indicators?.activeBrs ?? 0)} ativas`}
            icon={<MapPin />}
          />
          <KpiCard
            label="BRs com veículo"
            value={number.format(indicators?.brsWithVehicle ?? 0)}
            period={formatCompetence(competence)}
            icon={<Truck />}
          />
          <KpiCard
            label="BRs sem veículo"
            value={number.format(indicators?.brsWithoutVehicle ?? 0)}
            period={formatCompetence(competence)}
            status={(indicators?.brsWithoutVehicle ?? 0) > 0 ? "warning" : undefined}
            icon={<CircleSlash />}
          />
          <KpiCard
            label="Substituições e inversões"
            value={number.format((indicators?.substitutions ?? 0) + (indicators?.inversions ?? 0))}
            period={formatCompetence(competence)}
            icon={<ArrowLeftRight />}
          />
        </div>

        {/* §5: a ordem das abas é a ordem da leitura — primeiro o panorama da
            operação, depois as posições, depois os recursos que passam por elas
            e por fim o que já aconteceu. */}
        <Tabs defaultValue="visao-geral">
          <TabsList>
            <TabsTrigger value="visao-geral">Visão geral</TabsTrigger>
            <TabsTrigger value="locais">Planner de locais e BRs</TabsTrigger>
            <TabsTrigger value="frotas">Planner de frotas</TabsTrigger>
            <TabsTrigger value="motoristas">Planner de motoristas</TabsTrigger>
            <TabsTrigger value="historico">Histórico de movimentações</TabsTrigger>
          </TabsList>

          {/* ----------------------------------------------------- visão geral */}
          <TabsContent value="visao-geral" className="flex flex-col gap-5">
            <StabilityDashboard stability={stability} competence={competence} />

            <section aria-labelledby="hierarquia-operacional" className="flex flex-col gap-3">
              <h2 id="hierarquia-operacional" className="text-h4 font-semibold text-fg">
                Hierarquia operacional
              </h2>
              <HierarchyPanel operations={hierarchy} />
            </section>
          </TabsContent>

          {/* ------------------------------------------- planner de locais e BRs */}
          <TabsContent value="locais" className="flex flex-col gap-4">
            <BrsModuleNotice href={brsModuleHref} />
            <BrPlanner
              rows={plannerRows}
              indicators={plannerIndicators}
              competence={competence}
              operations={operations}
              coverage={coverage}
              leaders={leaders}
              filters={filters}
              onNavigate={navigate}
              canManageBrs={false}
              pending={pending}
              onOpenPlanning={openPlanningById}
            />
          </TabsContent>

          {/* ------------------------------------------------------ calendário */}
          <TabsContent value="frotas">
            <Card>
              <CardContent className="p-0">
                {calendar.length === 0 ? (
                  <p className="px-4 py-10 text-center text-body-sm text-fg-muted">
                    Nenhuma posição operacional no filtro atual. Cadastre uma BR no módulo BRs para
                    começar o planejamento de {formatCompetence(competence)}.
                  </p>
                ) : (
                  <>
                    <CalendarMatrix
                      rows={calendar}
                      competence={competence}
                      onSelect={({ row }) => {
                        const br = brs.find((b) => b.id === row.operationBrId);
                        if (br) setAssignmentBr(br);
                      }}
                    />
                    <div className="border-t border-border">
                      <CalendarLegend />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ------------------------------------------------------ motoristas */}
          <TabsContent value="motoristas">
            <Card>
              <CardContent className="p-0">
                <TableContainer className="rounded-none border-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead style={{ width: 220 }}>Colaborador</TableHead>
                        <TableHead style={{ width: 110 }}>Função</TableHead>
                        <TableHead style={{ width: 200 }}>Posição</TableHead>
                        <TableHead style={{ width: 160 }}>Veículo</TableHead>
                        <TableHead style={{ width: 170 }}>Período</TableHead>
                        <TableHead style={{ width: 110 }}>Situação</TableHead>
                        {canChangeDriver ? <TableHead style={{ width: 72 }}>Ações</TableHead> : null}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {driverPlans.length === 0 ? (
                        <TableEmpty
                          colSpan={canChangeDriver ? 7 : 6}
                          icon={<UserRound />}
                          message={`Nenhum motorista planejado em ${formatCompetence(competence)}.`}
                        />
                      ) : (
                        driverPlans.map((row) => (
                          <TableRow key={row.id} className="h-(--table-row-height)">
                            <TableCell>
                              <span className="block truncate font-medium text-fg">{row.employeeName}</span>
                              {row.employeeCode ? (
                                <span className="block text-caption text-fg-muted">
                                  Matrícula {row.employeeCode}
                                </span>
                              ) : null}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={row.driverRole === "primary" ? "primary" : "neutral"}
                                appearance="soft"
                              >
                                {row.driverRole === "primary" ? "Principal" : "Secundário"}
                              </Badge>
                            </TableCell>
                            <TableCell className="truncate">
                              BR {row.brCode}
                              <span className="block text-caption text-fg-muted">
                                {row.cityName}/{row.stateUf} · {row.operationName}
                              </span>
                            </TableCell>
                            <TableCell className="truncate">
                              {row.fleetCode ?? row.licensePlate ?? "—"}
                            </TableCell>
                            <TableCell className="text-body-sm text-fg-secondary">
                              {formatDate(row.startDate)} —{" "}
                              {row.endDate ? formatDate(row.endDate) : "em aberto"}
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={row.status === "cancelled" ? "neutral" : "info"}>
                                {row.status === "cancelled" ? "Cancelado" : "Planejado"}
                              </StatusBadge>
                            </TableCell>
                            {canChangeDriver ? (
                              <TableCell>
                                {/* §34/§35: um vínculo cancelado ou já terminado
                                    não tem véspera para fechar — a ação fica
                                    desabilitada, não escondida. */}
                                <IconButton
                                  label={`Substituir motorista ${row.employeeName}`}
                                  variant="ghost"
                                  size="sm"
                                  disabled={!canSubstituteDriver(row)}
                                  onClick={() => setSubstituteRow(row)}
                                >
                                  <UserRoundPen aria-hidden />
                                </IconButton>
                              </TableCell>
                            ) : null}
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ------------------------------------------ histórico e mobilizações */}
          <TabsContent value="historico">
            <Card>
              <CardContent className="flex flex-col gap-0 p-0">
                {/* Substituições e inversões são um recorte do histórico, não
                    outra tabela: separá-las escondia que a linha anterior e a
                    que a substituiu contam a mesma sequência. */}
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                  <Button
                    variant={onlyMobilisations ? "ghost" : "secondary"}
                    size="sm"
                    onClick={() => setOnlyMobilisations(false)}
                    aria-pressed={!onlyMobilisations}
                  >
                    Todos os vínculos
                    <Badge variant="neutral">{number.format(history.length)}</Badge>
                  </Button>
                  <Button
                    variant={onlyMobilisations ? "secondary" : "ghost"}
                    size="sm"
                    leadingIcon={<ArrowLeftRight />}
                    onClick={() => setOnlyMobilisations(true)}
                    aria-pressed={onlyMobilisations}
                  >
                    Só substituições e inversões
                    <Badge variant="neutral">{number.format(mobilisations.length)}</Badge>
                  </Button>
                </div>

                <TableContainer className="rounded-none border-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead style={{ width: 180 }}>Posição</TableHead>
                        <TableHead style={{ width: 190 }}>Veículo</TableHead>
                        <TableHead style={{ width: 180 }}>Período</TableHead>
                        <TableHead style={{ width: 120 }}>Origem</TableHead>
                        <TableHead style={{ width: 120 }}>Situação</TableHead>
                        <TableHead>Motivo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleHistory.length === 0 ? (
                        <TableEmpty
                          colSpan={6}
                          icon={<CalendarDays />}
                          message={
                            onlyMobilisations
                              ? `Nenhuma substituição ou inversão em ${formatCompetence(competence)}.`
                              : `Nenhum vínculo de fidelização em ${formatCompetence(competence)}.`
                          }
                        />
                      ) : (
                        visibleHistory.map((row) => (
                          <TableRow key={row.id} className="h-(--table-row-height)">
                            <TableCell className="truncate">
                              BR {row.brCode}
                              <span className="block text-caption text-fg-muted">
                                {row.cityName}/{row.stateUf} · {row.operationName}
                              </span>
                            </TableCell>
                            <TableCell className="truncate">
                              {row.fleetCode ?? row.licensePlate ?? "—"}
                              {row.vehicleModelName ? (
                                <span className="block text-caption text-fg-muted">
                                  {[row.vehicleMakeName, row.vehicleModelName].filter(Boolean).join(" ")}
                                </span>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-body-sm text-fg-secondary">
                              {formatDate(row.startDate)} —{" "}
                              {row.endDate ? formatDate(row.endDate) : "em aberto"}
                            </TableCell>
                            <TableCell className="text-body-sm text-fg-secondary">
                              {SOURCE_LABEL[row.source] ?? row.source}
                            </TableCell>
                            <TableCell>
                              <StatusBadge
                                status={
                                  row.status === "cancelled"
                                    ? "neutral"
                                    : row.isCurrent
                                      ? "success"
                                      : "info"
                                }
                              >
                                {row.status === "cancelled"
                                  ? "Cancelado"
                                  : row.isCurrent
                                    ? "Vigente"
                                    : "Planejado"}
                              </StatusBadge>
                            </TableCell>
                            <TableCell className="text-body-sm text-fg-secondary">
                              {row.endReason ?? row.reason ?? "—"}
                              {row.endReason && row.reason ? (
                                <span className="block text-caption text-fg-muted">
                                  Entrou por: {row.reason}
                                </span>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </PageContent>

      <AssignmentDrawer
        key={`assignment-${assignmentBr?.id ?? "none"}`}
        open={assignmentBr !== null}
        onOpenChange={(open) => {
          if (!open) setAssignmentBr(null);
        }}
        br={
          assignmentBr
            ? {
                id: assignmentBr.id,
                code: assignmentBr.code,
                cityName: assignmentBr.cityName,
                stateUf: assignmentBr.stateUf,
                operationName: assignmentBr.operationName,
              }
            : null
        }
        competence={competence}
        history={assignmentHistory}
        canPlan={canPlan}
        canChangeVehicle={canChangeVehicle}
        canChangeDriver={canChangeDriver}
      />

      <InvertDialog
        key={`invert-${invertOpen}`}
        open={invertOpen}
        onOpenChange={setInvertOpen}
        candidates={invertible}
        competence={competence}
      />

      {/* A importação aqui é só de alocações: o arquivo de BRs entra pelo módulo BRs (§38). */}
      <ImportDrawer
        open={importOpen}
        onOpenChange={setImportOpen}
        canImportBrs={false}
      />

      <ReplicateFidelizationDialog
        key={`replicate-${replicateOpen}`}
        open={replicateOpen}
        onOpenChange={setReplicateOpen}
        competence={competence}
        operations={operations}
        canChangeDriver={canChangeDriver}
      />

      {/* A linha é a chave: trocar de motorista remonta o diálogo com o
          formulário limpo, em vez de mostrar o motivo digitado para outro. */}
      <DriverSubstituteDialog
        key={`substitute-${substituteRow?.id ?? "none"}`}
        row={substituteRow}
        onClose={() => setSubstituteRow(null)}
      />
    </>
  );
}
