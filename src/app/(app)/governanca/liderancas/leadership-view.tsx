"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CalendarClock, CopyCheck, MapPin, Pencil, Plus, ShieldCheck, Square, UserRound, Users,
} from "lucide-react";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { FilterBar } from "@/components/ui/filter-bar";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/feedback/toast";
import { useConfirm } from "@/components/feedback/confirm-dialog";
import { CompetencePicker } from "@/components/governance/competence-picker";
import { NativeSelect } from "@/components/governance/selects";
import type { BrEntry, CoverageEntry } from "@/components/governance/scope-picker";
import { endLeadership } from "@/lib/governance/actions";
import type { LeadershipIndicators, LeadershipRow } from "@/lib/governance/queries";
import { formatCompetence, monthEnd, type Competence } from "@/lib/governance/competence";
import { LeadershipFormDrawer, type LeadershipFormValue } from "./leadership-form-drawer";
import { ReplicateDialog } from "./replicate-dialog";

const number = new Intl.NumberFormat("pt-BR");

function formatDate(value: string | null): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  return d ? `${d}/${m}/${y}` : value;
}

const SCOPE_LABEL: Record<string, string> = {
  operation: "Operação",
  city: "Cidade",
  br: "BR",
};

/** What the scope reads as on screen: "Last Mile MG · MG · Contagem · BR 001". */
function scopeLabel(row: LeadershipRow): string {
  return [row.operationName, row.stateUf, row.cityName, row.brCode ? `BR ${row.brCode}` : null]
    .filter(Boolean)
    .join(" · ");
}

/** Identity of a scope, mirroring the `scope_key` the database groups by. */
function scopeKey(row: LeadershipRow): string {
  return `${row.scopeLevel}:${row.operationBrId ?? row.operationCityId ?? row.operationId}`;
}

export interface LeadershipViewProps {
  rows: LeadershipRow[];
  indicators: LeadershipIndicators | null;
  competence: Competence;
  operations: { id: string; name: string; status: string }[];
  coverage: CoverageEntry[];
  brs: BrEntry[];
  filters: { operationId?: string; stateId?: string; cityId?: string; scope?: string; status?: string };
  canManage: boolean;
  canAssign: boolean;
  canReplicate: boolean;
}

/**
 * Governança Operacional → Lideranças.
 *
 * The question this screen answers is "who answers for this, and since when" —
 * at three levels, and for any month, not only the current one. Everything
 * here is a period, which is why a leader who changed mid-month shows up twice
 * and both rows are right.
 */
export function LeadershipView({
  rows,
  indicators,
  competence,
  operations,
  coverage,
  brs,
  filters,
  canManage,
  canAssign,
  canReplicate,
}: LeadershipViewProps) {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [pending, startTransition] = React.useTransition();
  const [formOpen, setFormOpen] = React.useState(false);
  const [replicateOpen, setReplicateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<LeadershipFormValue | undefined>();
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

  const active = rows.filter((r) => r.status === "active");
  const history = rows.filter((r) => r.status !== "active");

  /** One line per scope, with its principal and its substitutes side by side (§21). */
  const planning = React.useMemo(() => {
    const groups = new Map<string, { sample: LeadershipRow; principal?: LeadershipRow; others: LeadershipRow[] }>();
    for (const row of active) {
      const key = scopeKey(row);
      const group = groups.get(key) ?? { sample: row, others: [] };
      if (row.responsibilityType === "principal") group.principal = row;
      else group.others.push(row);
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => scopeLabel(a.sample).localeCompare(scopeLabel(b.sample)));
  }, [active]);

  /** §22: what a given person answers for, from the links that actually exist. */
  const byLeader = React.useMemo(() => {
    const map = new Map<string, { name: string; code: string | null; rows: LeadershipRow[] }>();
    for (const row of active) {
      const entry = map.get(row.employeeId) ?? {
        name: row.employeeName,
        code: row.employeeCode,
        rows: [],
      };
      entry.rows.push(row);
      map.set(row.employeeId, entry);
    }
    return [...map.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [active]);

  const openNew = () => {
    setEditing(undefined);
    setFormKey((k) => k + 1);
    setFormOpen(true);
  };

  const openEdit = (row: LeadershipRow) => {
    setEditing({
      id: row.id,
      employee: {
        id: row.employeeId,
        name: row.employeeName,
        code: row.employeeCode,
        operationName: row.operationName,
      },
      scopeLevel: row.scopeLevel,
      operationId: row.operationId,
      operationCityId: row.operationCityId,
      operationBrId: row.operationBrId,
      responsibilityType: row.responsibilityType,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      notes: row.notes,
      updatedAt: row.updatedAt,
    });
    setFormKey((k) => k + 1);
    setFormOpen(true);
  };

  const end = async (row: LeadershipRow) => {
    const suggested = monthEnd(competence);
    const confirmed = await confirm({
      title: `Encerrar a responsabilidade de ${row.employeeName}?`,
      description: `A vigência passa a terminar em ${formatDate(suggested)}. O vínculo continua no histórico e nas consultas do período em que valeu — nada é apagado, e o colaborador não sai da sua operação.`,
      confirmLabel: "Encerrar",
      destructive: true,
    });
    if (!confirmed) return;

    startTransition(async () => {
      const result = await endLeadership(row.id, suggested, null);
      if (result.ok) {
        toast({ title: "Responsabilidade encerrada.", variant: "success" });
        router.refresh();
      } else {
        toast({ title: result.error ?? "Não foi possível encerrar.", variant: "danger" });
      }
    });
  };

  return (
    <>
      <PageHeader
        title="Lideranças"
        description="Gerencie responsáveis e planeje a liderança das operações. A designação registra quem responde por cada escopo — ela não altera o Perfil de Acesso de ninguém."
        primaryAction={
          canManage && canAssign ? (
            <Button leadingIcon={<Plus />} onClick={openNew}>
              Novo vínculo
            </Button>
          ) : undefined
        }
        secondaryActions={
          canReplicate ? (
            <Button variant="secondary" leadingIcon={<CopyCheck />} onClick={() => setReplicateOpen(true)}>
              Replicar competência
            </Button>
          ) : undefined
        }
        filters={
          <FilterBar className="flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-caption text-fg-muted">Competência</span>
              <CompetencePicker value={competence} onChange={setCompetence} disabled={pending} />
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

            <div className="flex flex-col gap-1">
              <span className="text-caption text-fg-muted">Nível</span>
              <NativeSelect
                fieldSize="sm"
                aria-label="Filtrar por nível de responsabilidade"
                value={filters.scope ?? ""}
                onChange={(e) => navigate({ nivel: e.target.value || null })}
                className="min-w-[9rem]"
              >
                <option value="">Todos</option>
                <option value="operation">Operação</option>
                <option value="city">Cidade</option>
                <option value="br">BR</option>
              </NativeSelect>
            </div>
          </FilterBar>
        }
      />

      <PageContent className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label="Responsabilidades"
            value={number.format(indicators?.assignments ?? active.length)}
            period={formatCompetence(competence)}
            icon={<ShieldCheck />}
          />
          <KpiCard
            label="Lideranças distintas"
            value={number.format(indicators?.leaders ?? byLeader.length)}
            icon={<Users />}
          />
          <KpiCard
            label="BRs com responsável"
            value={
              indicators
                ? `${number.format(indicators.brsWithLeader)}/${number.format(indicators.brsTotal)}`
                : "—"
            }
            period="Principal vigente na competência"
            icon={<MapPin />}
          />
          <KpiCard
            label="Substitutos e apoio"
            value={number.format(indicators?.substitutes ?? 0)}
            icon={<UserRound />}
          />
        </div>

        <Tabs defaultValue="planejamento">
          <TabsList>
            <TabsTrigger value="planejamento">Planejamento</TabsTrigger>
            <TabsTrigger value="responsabilidades">Responsabilidades</TabsTrigger>
            <TabsTrigger value="liderancas">Por liderança</TabsTrigger>
            <TabsTrigger value="historico">Histórico</TabsTrigger>
          </TabsList>

          {/* ------------------------------------------------ planejamento */}
          <TabsContent value="planejamento">
            <Card>
              <CardContent className="p-0">
                <TableContainer className="rounded-none border-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead style={{ width: 90 }}>Nível</TableHead>
                        <TableHead>Escopo</TableHead>
                        <TableHead style={{ width: 220 }}>Liderança principal</TableHead>
                        <TableHead style={{ width: 220 }}>Substituto / apoio</TableHead>
                        <TableHead style={{ width: 170 }}>Vigência</TableHead>
                        <TableHead style={{ width: 96 }}>Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {planning.length === 0 ? (
                        <TableEmpty
                          colSpan={6}
                          icon={<ShieldCheck />}
                          message={`Nenhuma responsabilidade vigente em ${formatCompetence(competence)}.`}
                        />
                      ) : (
                        planning.map((group) => {
                          const row = group.principal ?? group.sample;
                          return (
                            <TableRow key={scopeKey(group.sample)} className="h-(--table-row-height)">
                              <TableCell>
                                <Badge variant="neutral" appearance="soft">
                                  {SCOPE_LABEL[group.sample.scopeLevel]}
                                </Badge>
                              </TableCell>
                              <TableCell className="font-medium text-fg">
                                {scopeLabel(group.sample)}
                              </TableCell>
                              <TableCell>
                                {group.principal ? (
                                  <span className="block truncate" title={group.principal.employeeName}>
                                    {group.principal.employeeName}
                                  </span>
                                ) : (
                                  <span className="text-fg-muted">Sem responsável principal</span>
                                )}
                              </TableCell>
                              <TableCell>
                                {group.others.length === 0 ? (
                                  <span className="text-fg-muted">—</span>
                                ) : (
                                  group.others.map((o) => (
                                    <span key={o.id} className="block truncate text-body-sm">
                                      {o.employeeName}
                                      <span className="text-fg-muted">
                                        {" "}
                                        ({o.responsibilityType === "substitute" ? "substituto" : "apoio"})
                                      </span>
                                    </span>
                                  ))
                                )}
                              </TableCell>
                              <TableCell className="text-body-sm text-fg-secondary">
                                {formatDate(row.effectiveFrom)} —{" "}
                                {row.effectiveTo ? formatDate(row.effectiveTo) : "em aberto"}
                              </TableCell>
                              <TableCell>
                                {canManage && group.principal ? (
                                  <div className="flex gap-1">
                                    <IconButton
                                      label="Editar responsabilidade"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => openEdit(group.principal!)}
                                    >
                                      <Pencil />
                                    </IconButton>
                                    <IconButton
                                      label="Encerrar responsabilidade"
                                      variant="ghost"
                                      size="sm"
                                      disabled={pending}
                                      onClick={() => end(group.principal!)}
                                    >
                                      <Square />
                                    </IconButton>
                                  </div>
                                ) : null}
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ------------------------------------------- responsabilidades */}
          <TabsContent value="responsabilidades">
            <Card>
              <CardContent className="p-0">
                <TableContainer className="rounded-none border-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead style={{ width: 220 }}>Colaborador</TableHead>
                        <TableHead style={{ width: 90 }}>Nível</TableHead>
                        <TableHead>Escopo</TableHead>
                        <TableHead style={{ width: 130 }}>Função</TableHead>
                        <TableHead style={{ width: 170 }}>Vigência</TableHead>
                        <TableHead style={{ width: 110 }}>Situação</TableHead>
                        <TableHead style={{ width: 96 }}>Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {active.length === 0 ? (
                        <TableEmpty colSpan={7} icon={<ShieldCheck />} message="Nenhuma responsabilidade nesta competência." />
                      ) : (
                        active.map((row) => (
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
                              <Badge variant="neutral" appearance="soft">
                                {SCOPE_LABEL[row.scopeLevel]}
                              </Badge>
                            </TableCell>
                            <TableCell className="truncate">{scopeLabel(row)}</TableCell>
                            <TableCell>
                              {row.isPrimary ? (
                                <Badge variant="primary" appearance="soft">Principal</Badge>
                              ) : (
                                <Badge variant="neutral" appearance="soft">
                                  {row.responsibilityType === "substitute" ? "Substituto" : "Apoio"}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-body-sm text-fg-secondary">
                              {formatDate(row.effectiveFrom)} —{" "}
                              {row.effectiveTo ? formatDate(row.effectiveTo) : "em aberto"}
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={row.isCurrent ? "success" : "info"}>
                                {row.isCurrent ? "Vigente hoje" : "Na competência"}
                              </StatusBadge>
                            </TableCell>
                            <TableCell>
                              {canManage ? (
                                <div className="flex gap-1">
                                  <IconButton label="Editar" variant="ghost" size="sm" onClick={() => openEdit(row)}>
                                    <Pencil />
                                  </IconButton>
                                  <IconButton
                                    label="Encerrar"
                                    variant="ghost"
                                    size="sm"
                                    disabled={pending}
                                    onClick={() => end(row)}
                                  >
                                    <Square />
                                  </IconButton>
                                </div>
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

          {/* -------------------------------------------------- por liderança */}
          <TabsContent value="liderancas">
            {byLeader.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-body-sm text-fg-muted">
                  Nenhuma liderança designada nesta competência.
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {byLeader.map((leader) => (
                  <Card key={leader.id}>
                    <CardContent className="flex flex-col gap-3">
                      <div>
                        <p className="text-body font-medium text-fg">{leader.name}</p>
                        <p className="text-caption text-fg-muted">
                          {leader.code ? `Matrícula ${leader.code} · ` : ""}
                          {leader.rows.length} escopo(s) sob responsabilidade
                        </p>
                      </div>
                      <ul className="flex flex-col gap-1.5">
                        {leader.rows.map((row) => (
                          <li key={row.id} className="flex items-start gap-2 text-body-sm">
                            <Badge variant="neutral" appearance="soft" size="sm">
                              {SCOPE_LABEL[row.scopeLevel]}
                            </Badge>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-fg">{scopeLabel(row)}</span>
                              <span className="block text-caption text-fg-muted">
                                {formatDate(row.effectiveFrom)} —{" "}
                                {row.effectiveTo ? formatDate(row.effectiveTo) : "em aberto"}
                                {row.isPrimary ? "" : " · substituto/apoio"}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ------------------------------------------------------ histórico */}
          <TabsContent value="historico">
            <Card>
              <CardContent className="p-0">
                <TableContainer className="rounded-none border-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead style={{ width: 220 }}>Colaborador</TableHead>
                        <TableHead>Escopo</TableHead>
                        <TableHead style={{ width: 170 }}>Vigência</TableHead>
                        <TableHead style={{ width: 110 }}>Situação</TableHead>
                        <TableHead>Motivo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.length === 0 ? (
                        <TableEmpty
                          colSpan={5}
                          icon={<CalendarClock />}
                          message="Nenhuma responsabilidade encerrada nesta competência."
                        />
                      ) : (
                        history.map((row) => (
                          <TableRow key={row.id} className="h-(--table-row-height)">
                            <TableCell className="truncate font-medium text-fg">{row.employeeName}</TableCell>
                            <TableCell className="truncate">{scopeLabel(row)}</TableCell>
                            <TableCell className="text-body-sm text-fg-secondary">
                              {formatDate(row.effectiveFrom)} — {formatDate(row.effectiveTo)}
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={row.status === "cancelled" ? "neutral" : "warning"}>
                                {row.status === "cancelled" ? "Cancelada" : "Encerrada"}
                              </StatusBadge>
                            </TableCell>
                            <TableCell className="text-body-sm text-fg-secondary">
                              {row.endReason ?? "—"}
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

      <LeadershipFormDrawer
        key={`form-${formKey}`}
        open={formOpen}
        onOpenChange={setFormOpen}
        value={editing}
        competence={competence}
        operations={operations}
        coverage={coverage}
        brs={brs}
      />

      <ReplicateDialog
        key={`replicate-${replicateOpen}`}
        open={replicateOpen}
        onOpenChange={setReplicateOpen}
        competence={competence}
        operations={operations}
      />
    </>
  );
}
