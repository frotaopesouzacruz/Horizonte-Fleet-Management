"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeftRight, CalendarDays, CircleSlash, MapPin, Pencil, Plus, Power, Truck, UserRound,
} from "lucide-react";
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
import { useToast } from "@/components/feedback/toast";
import { useConfirm } from "@/components/feedback/confirm-dialog";
import { CompetencePicker } from "@/components/governance/competence-picker";
import { NativeSelect } from "@/components/governance/selects";
import type { CoverageEntry } from "@/components/governance/scope-picker";
import { loadBrImpact, setOperationBrStatus } from "@/lib/governance/actions";
import type {
  CalendarRow, DriverPlanRow, FidelizationIndicators, FidelizationRow,
  HierarchyOperation, OperationBrRow,
} from "@/lib/governance/queries";
import { formatCompetence, type Competence } from "@/lib/governance/competence";
import { CalendarLegend, CalendarMatrix } from "./calendar-matrix";
import { BrFormDrawer, type BrFormValue } from "./br-form-drawer";
import { AssignmentDrawer } from "./assignment-drawer";
import { InvertDialog } from "./invert-dialog";
import { HierarchyPanel } from "./hierarchy-panel";

const number = new Intl.NumberFormat("pt-BR");

function formatDate(value: string | null): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  return d ? `${d}/${m}/${y}` : value;
}

export interface FidelizationViewProps {
  calendar: CalendarRow[];
  brs: OperationBrRow[];
  history: FidelizationRow[];
  driverPlans: DriverPlanRow[];
  hierarchy: HierarchyOperation[];
  indicators: FidelizationIndicators | null;
  competence: Competence;
  operations: { id: string; name: string; status: string }[];
  coverage: CoverageEntry[];
  filters: { operationId?: string; stateId?: string; cityId?: string; brId?: string };
  canManageBrs: boolean;
  canPlan: boolean;
  canChangeVehicle: boolean;
  canChangeDriver: boolean;
}

/**
 * Governança Operacional → Fidelização.
 *
 * Fidelizar is not allocating. A vehicle allocated to Last Mile MG / Contagem
 * can occupy a position for two weeks without its operation or city changing,
 * and nothing on this screen writes to the vehicle's allocation. The two
 * questions stay in two tables and this screen only answers the second one.
 */
export function FidelizationView({
  calendar,
  brs,
  history,
  driverPlans,
  hierarchy,
  indicators,
  competence,
  operations,
  coverage,
  filters,
  canManageBrs,
  canPlan,
  canChangeVehicle,
  canChangeDriver,
}: FidelizationViewProps) {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [pending, startTransition] = React.useTransition();

  const [brFormOpen, setBrFormOpen] = React.useState(false);
  const [editingBr, setEditingBr] = React.useState<BrFormValue | undefined>();
  // Bumped on every open so the form remounts with fresh state instead of being
  // reset from an effect after the first frame has already shown the old one.
  const [brFormKey, setBrFormKey] = React.useState(0);
  const [assignmentBr, setAssignmentBr] = React.useState<FidelizationViewProps["brs"][number] | null>(null);
  const [invertOpen, setInvertOpen] = React.useState(false);

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

  const openNewBr = () => {
    setEditingBr(undefined);
    setBrFormKey((k) => k + 1);
    setBrFormOpen(true);
  };

  const openEditBr = (br: OperationBrRow) => {
    setEditingBr({
      id: br.id,
      operationId: br.operationId,
      operationCityId: br.operationCityId,
      code: br.code,
      description: br.description,
      notes: br.notes,
      updatedAt: br.updatedAt,
    });
    setBrFormKey((k) => k + 1);
    setBrFormOpen(true);
  };

  const toggleBrStatus = async (br: OperationBrRow) => {
    const next = br.status === "active" ? "inactive" : "active";

    if (next === "inactive") {
      // §52 in spirit: the dependencies shown are counted from the tables, not
      // guessed. Someone deciding to deactivate needs the real number.
      const impact = await loadBrImpact(br.id);
      const lines = impact.ok && impact.data
        ? [
            `${impact.data.currentVehicles} veículo(s) com vínculo vigente`,
            `${impact.data.currentDrivers} motorista(s) planejado(s)`,
            `${impact.data.currentLeaders} liderança(s) responsável(is)`,
            `${impact.data.totalVehicles} vínculo(s) no histórico`,
          ].join(" · ")
        : "Não foi possível calcular as dependências agora.";

      const confirmed = await confirm({
        title: `Inativar a BR ${br.code}?`,
        description: `A BR deixa de receber novo planejamento. O que já está vigente continua vigente e nada é apagado. Hoje ela tem: ${lines}.`,
        confirmLabel: "Inativar",
        destructive: true,
      });
      if (!confirmed) return;
    }

    startTransition(async () => {
      const result = await setOperationBrStatus(br.id, next, null);
      if (result.ok) {
        toast({ title: next === "inactive" ? "BR inativada." : "BR reativada.", variant: "success" });
        router.refresh();
      } else {
        toast({ title: result.error ?? "Não foi possível alterar a situação.", variant: "danger" });
      }
    });
  };

  const assignmentHistory = assignmentBr
    ? history.filter((h) => h.operationBrId === assignmentBr.id)
    : [];

  return (
    <>
      <PageHeader
        title="Fidelização"
        description="Planejamento das posições operacionais por veículo e motorista. Fidelizar não transfere a operação nem a cidade do veículo — a alocação continua no Cadastro de Frotas."
        primaryAction={
          canManageBrs ? (
            <Button leadingIcon={<Plus />} onClick={openNewBr}>
              Nova BR
            </Button>
          ) : undefined
        }
        secondaryActions={
          canChangeVehicle ? (
            <Button
              variant="secondary"
              leadingIcon={<ArrowLeftRight />}
              onClick={() => setInvertOpen(true)}
            >
              Inverter veículos
            </Button>
          ) : undefined
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

        <Tabs defaultValue="frotas">
          <TabsList>
            <TabsTrigger value="frotas">Planejamento de frotas</TabsTrigger>
            <TabsTrigger value="motoristas">Planejamento de motoristas</TabsTrigger>
            <TabsTrigger value="brs">Estrutura de BRs</TabsTrigger>
            <TabsTrigger value="mobilizacoes">Mobilizações</TabsTrigger>
            <TabsTrigger value="hierarquia">Hierarquia</TabsTrigger>
            <TabsTrigger value="historico">Histórico</TabsTrigger>
          </TabsList>

          {/* ------------------------------------------------------ calendário */}
          <TabsContent value="frotas">
            <Card>
              <CardContent className="p-0">
                {calendar.length === 0 ? (
                  <p className="px-4 py-10 text-center text-body-sm text-fg-muted">
                    Nenhuma posição operacional no filtro atual. Cadastre uma BR para começar o
                    planejamento de {formatCompetence(competence)}.
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
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {driverPlans.length === 0 ? (
                        <TableEmpty
                          colSpan={6}
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
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ------------------------------------------------------------- BRs */}
          <TabsContent value="brs">
            <Card>
              <CardContent className="p-0">
                <TableContainer className="rounded-none border-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead style={{ width: 110 }}>Código</TableHead>
                        <TableHead>Descrição</TableHead>
                        <TableHead style={{ width: 200 }}>Operação / cidade</TableHead>
                        <TableHead style={{ width: 170 }}>Veículo de hoje</TableHead>
                        <TableHead style={{ width: 180 }}>Responsável</TableHead>
                        <TableHead style={{ width: 110 }}>Situação</TableHead>
                        <TableHead style={{ width: 96 }}>Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {brs.length === 0 ? (
                        <TableEmpty colSpan={7} icon={<MapPin />} message="Nenhuma BR cadastrada." />
                      ) : (
                        brs.map((br) => (
                          <TableRow key={br.id} className="h-(--table-row-height)">
                            <TableCell className="font-mono text-caption text-fg-secondary">
                              {br.code}
                            </TableCell>
                            <TableCell className="truncate">{br.description ?? "—"}</TableCell>
                            <TableCell className="truncate text-body-sm">
                              {br.operationName}
                              <span className="block text-caption text-fg-muted">
                                {br.cityName}/{br.stateUf}
                              </span>
                            </TableCell>
                            <TableCell className="truncate">
                              {br.currentFleetCode ?? br.currentLicensePlate ?? (
                                <span className="text-fg-muted">sem veículo</span>
                              )}
                            </TableCell>
                            <TableCell className="truncate">
                              {br.currentLeaderName ?? <span className="text-fg-muted">—</span>}
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={br.status === "active" ? "success" : "neutral"}>
                                {br.status === "active" ? "Ativa" : "Inativa"}
                              </StatusBadge>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <IconButton
                                  label="Abrir planejamento"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setAssignmentBr(br)}
                                >
                                  <CalendarDays />
                                </IconButton>
                                {canManageBrs ? (
                                  <>
                                    <IconButton
                                      label="Editar BR"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => openEditBr(br)}
                                    >
                                      <Pencil />
                                    </IconButton>
                                    <IconButton
                                      label={br.status === "active" ? "Inativar BR" : "Reativar BR"}
                                      variant="ghost"
                                      size="sm"
                                      disabled={pending}
                                      onClick={() => toggleBrStatus(br)}
                                    >
                                      <Power />
                                    </IconButton>
                                  </>
                                ) : null}
                              </div>
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

          {/* --------------------------------------------------- mobilizações */}
          <TabsContent value="mobilizacoes">
            <Card>
              <CardContent className="p-0">
                <TableContainer className="rounded-none border-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead style={{ width: 130 }}>Tipo</TableHead>
                        <TableHead style={{ width: 180 }}>Posição</TableHead>
                        <TableHead style={{ width: 170 }}>Veículo que entrou</TableHead>
                        <TableHead style={{ width: 170 }}>A partir de</TableHead>
                        <TableHead>Motivo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {mobilisations.length === 0 ? (
                        <TableEmpty
                          colSpan={5}
                          icon={<ArrowLeftRight />}
                          message={`Nenhuma substituição ou inversão em ${formatCompetence(competence)}.`}
                        />
                      ) : (
                        mobilisations.map((row) => (
                          <TableRow key={row.id} className="h-(--table-row-height)">
                            <TableCell>
                              <Badge variant="info" appearance="soft">
                                {row.source === "inversion" ? "Inversão" : "Substituição"}
                              </Badge>
                            </TableCell>
                            <TableCell className="truncate">
                              BR {row.brCode}
                              <span className="block text-caption text-fg-muted">
                                {row.cityName}/{row.stateUf}
                              </span>
                            </TableCell>
                            <TableCell className="truncate">
                              {row.fleetCode ?? row.licensePlate ?? "—"}
                            </TableCell>
                            <TableCell className="text-body-sm text-fg-secondary">
                              {formatDate(row.startDate)}
                            </TableCell>
                            <TableCell className="text-body-sm text-fg-secondary">
                              {row.reason ?? "—"}
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

          {/* ------------------------------------------------------ hierarquia */}
          <TabsContent value="hierarquia">
            <HierarchyPanel operations={hierarchy} />
          </TabsContent>

          {/* ------------------------------------------------------- histórico */}
          <TabsContent value="historico">
            <Card>
              <CardContent className="p-0">
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
                      {history.length === 0 ? (
                        <TableEmpty
                          colSpan={6}
                          icon={<CalendarDays />}
                          message={`Nenhum vínculo de fidelização em ${formatCompetence(competence)}.`}
                        />
                      ) : (
                        history.map((row) => (
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
                              {row.source === "manual"
                                ? "Manual"
                                : row.source === "import"
                                  ? "Importação"
                                  : row.source === "inversion"
                                    ? "Inversão"
                                    : "Substituição"}
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

      <BrFormDrawer
        key={`br-${brFormKey}`}
        open={brFormOpen}
        onOpenChange={setBrFormOpen}
        value={editingBr}
        operations={operations}
        coverage={coverage}
      />

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
    </>
  );
}
