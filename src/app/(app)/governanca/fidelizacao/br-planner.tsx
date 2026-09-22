"use client";

import * as React from "react";
import {
  Building2, CalendarDays, ChevronDown, ChevronRight, CircleSlash, History, Layers, MapPin,
  Pencil, Plus, Power, Truck, UserRound,
} from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { FilterBar } from "@/components/ui/filter-bar";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { SearchField } from "@/components/ui/search-field";
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/empty-state";
import { NativeSelect } from "@/components/governance/selects";
import type { CoverageEntry } from "@/components/governance/scope-picker";
import { formatCompetence, type Competence } from "@/lib/governance/competence";
import type { BrPlannerIndicators, BrPlannerRow } from "@/lib/governance/br-planner";
import { BrBatchDrawer } from "@/components/governance/brs/br-batch-drawer";
import { BrHistoryDrawer } from "@/components/governance/brs/br-history-drawer";

const number = new Intl.NumberFormat("pt-BR");

function formatDate(value: string | null): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  return d ? `${d}/${m}/${y}` : value;
}

/** De onde veio a liderança — §43, para a tela poder dizer e não só mostrar. */
const LEADER_SCOPE_LABEL: Record<string, string> = {
  br: "exceção do BR",
  city: "cidade",
  operation: "operação",
};

export interface BrPlannerProps {
  rows: BrPlannerRow[];
  indicators: BrPlannerIndicators | null;
  competence: Competence;
  operations: { id: string; name: string; status: string }[];
  coverage: CoverageEntry[];
  leaders: { id: string; name: string }[];
  filters: {
    q?: string;
    operationId?: string;
    stateId?: string;
    cityId?: string;
    status?: string;
    leaderEmployeeId?: string;
    vehicle?: string;
    driver?: string;
  };
  onNavigate: (patch: Record<string, string | null>) => void;
  canManageBrs: boolean;
  /** Abre o planejamento de veículos e motoristas daquela posição. */
  onOpenPlanning: (brId: string) => void;
  /** Só chega preenchido com `fidelization.manage_brs`. */
  onEdit?: (brId: string) => void;
  onToggleStatus?: (brId: string) => void;
  /** Uma ação de escrita em curso — desabilita a que pode ser repetida. */
  pending?: boolean;
}

/**
 * Planner de Locais e BRs (§21).
 *
 * O BR é a posição operacional permanente. A placa e o motorista passam por
 * ela; a liderança responde por ela. Por isso a hierarquia da §24 é a da tela —
 * operação, estado, cidade, BRs — e não uma lista plana de códigos: um código
 * como `BR0024901` não diz onde fica, e é onde ele fica que decide quem
 * responde.
 *
 * A competência é uma janela, nunca um cadastro novo (§22/§23): trocar o mês
 * muda o que se vê — qual veículo, qual liderança —, nunca quais BRs existem.
 */
export function BrPlanner({
  rows,
  indicators,
  competence,
  operations,
  coverage,
  leaders,
  filters,
  onNavigate,
  canManageBrs,
  onOpenPlanning,
  onEdit,
  onToggleStatus,
  pending = false,
}: BrPlannerProps) {
  const [batchOpen, setBatchOpen] = React.useState(false);
  const [historyBr, setHistoryBr] = React.useState<BrPlannerRow | null>(null);
  const [collapsed, setCollapsed] = React.useState<string[]>([]);

  /**
   * Agrupamento operação → cidade. Feito aqui e não no banco porque as linhas
   * já vêm ordenadas por operação, UF, cidade e código: o agrupamento é só a
   * leitura dessa ordem, não uma segunda consulta.
   */
  const groups = React.useMemo(() => {
    const out: { key: string; operation: string; city: string; uf: string; items: BrPlannerRow[] }[] = [];
    for (const row of rows) {
      const key = `${row.operationId}:${row.cityId}`;
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(row);
      else out.push({ key, operation: row.operationName, city: row.cityName, uf: row.stateUf, items: [row] });
    }
    return out;
  }, [rows]);

  const toggleGroup = (key: string) =>
    setCollapsed((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    );

  const withoutVehicle = indicators?.withoutVehicle ?? 0;

  return (
    <div className="flex flex-col gap-4">
      {/* §26: cadastrais e da competência, separados — um BR com seis trocas de
          placa no mês continua sendo um BR. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Posições cadastradas"
          value={number.format(indicators?.total ?? rows.length)}
          period={`${number.format(indicators?.active ?? 0)} ativas`}
          icon={<MapPin />}
        />
        <KpiCard
          label="Com veículo"
          value={number.format(indicators?.withVehicle ?? 0)}
          period={formatCompetence(competence)}
          icon={<Truck />}
        />
        <KpiCard
          label="Sem veículo"
          value={number.format(withoutVehicle)}
          status={withoutVehicle > 0 ? "warning" : undefined}
          period={formatCompetence(competence)}
          icon={<CircleSlash />}
        />
        <KpiCard
          label="Com motorista"
          value={number.format(indicators?.withDriver ?? 0)}
          period={`${number.format(indicators?.withoutDriver ?? 0)} sem motorista`}
          icon={<UserRound />}
        />
      </div>

      <FilterBar
        label="Filtros do planner de locais e BRs"
        start={
          <>
            {/* Busca no Enter, não a cada tecla: cada navegação é uma consulta
                ao servidor, e disparar uma por letra digitada transformaria
                "BR0024901" em nove consultas descartadas. */}
            <SearchField
              placeholder="Buscar por código ou descrição…"
              defaultValue={filters.q ?? ""}
              aria-label="Buscar BR por código ou descrição"
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                onNavigate({ q: (event.target as HTMLInputElement).value || null });
              }}
              onClear={() => onNavigate({ q: null })}
              className="w-full sm:w-64"
            />
            {/* Operação, estado e cidade ficam no cabeçalho da página: são o
                recorte de toda a tela, não deste painel. Repeti-los aqui daria
                dois lugares para responder a mesma pergunta. */}
            <NativeSelect
              fieldSize="sm"
              aria-label="Filtrar por liderança"
              className="min-w-[12rem]"
              value={filters.leaderEmployeeId ?? ""}
              onChange={(e) => onNavigate({ lideranca: e.target.value || null })}
            >
              <option value="">Todas</option>
              {leaders.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </NativeSelect>
            <NativeSelect
              fieldSize="sm"
              aria-label="Filtrar por situação da BR"
              value={filters.status ?? ""}
              onChange={(e) => onNavigate({ situacao: e.target.value || null })}
            >
              <option value="">Todas</option>
              <option value="active">Ativas</option>
              <option value="inactive">Inativas</option>
            </NativeSelect>
            <NativeSelect
              fieldSize="sm"
              aria-label="Filtrar por ocupação de veículo"
              value={filters.vehicle ?? ""}
              onChange={(e) => onNavigate({ veiculo: e.target.value || null })}
            >
              <option value="">Com e sem</option>
              <option value="with">Com veículo</option>
              <option value="without">Sem veículo</option>
            </NativeSelect>
            <NativeSelect
              fieldSize="sm"
              aria-label="Filtrar por motorista vinculado"
              value={filters.driver ?? ""}
              onChange={(e) => onNavigate({ motorista: e.target.value || null })}
            >
              <option value="">Com e sem</option>
              <option value="with">Com motorista</option>
              <option value="without">Sem motorista</option>
            </NativeSelect>
          </>
        }
        end={
          canManageBrs ? (
            <Button onClick={() => setBatchOpen(true)}>
              <Plus aria-hidden />
              Cadastrar BRs
            </Button>
          ) : null
        }
      />

      {groups.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<MapPin />}
              title="Nenhuma posição operacional encontrada"
              description="Ajuste os filtros ou cadastre as BRs deste local."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((group) => {
            const open = !collapsed.includes(group.key);
            const semVeiculo = group.items.filter((i) => !i.vehicleId).length;
            return (
              <Card key={group.key}>
                <CardContent className="flex flex-col gap-3 p-0">
                  {/* Cabeçalho do local: a §24 pede a hierarquia, e é aqui que
                      ela aparece — operação, UF e cidade juntas dizem onde o
                      grupo de BRs fica. */}
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    aria-expanded={open}
                    /* Em telefone o nome da operação, a cidade e os dois
                       contadores não cabem numa linha: sem `flex-wrap` os
                       contadores empurram o cartão para fora da tela e a página
                       inteira ganha rolagem horizontal. */
                    className="flex w-full flex-wrap items-center gap-2 rounded-t-md px-4 py-3 text-left hfm-transition hover:bg-hover-overlay hfm-focus-ring"
                  >
                    {open ? (
                      <ChevronDown className="size-4 shrink-0 text-fg-muted" aria-hidden />
                    ) : (
                      <ChevronRight className="size-4 shrink-0 text-fg-muted" aria-hidden />
                    )}
                    <Building2 className="size-4 shrink-0 text-fg-muted" aria-hidden />
                    <span className="min-w-0 truncate text-body-sm font-semibold text-fg">
                      {group.operation}
                    </span>
                    <span aria-hidden className="text-fg-disabled">·</span>
                    <span className="min-w-0 truncate text-body-sm text-fg-secondary">
                      {group.city}/{group.uf}
                    </span>
                    <Badge variant="neutral" className="ml-auto">
                      {number.format(group.items.length)}{" "}
                      {group.items.length === 1 ? "BR" : "BRs"}
                    </Badge>
                    {semVeiculo > 0 ? (
                      <Badge variant="warning">{number.format(semVeiculo)} sem veículo</Badge>
                    ) : null}
                  </button>

                  {open ? (
                    <TableContainer className="border-t border-border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Código</TableHead>
                            <TableHead>Situação</TableHead>
                            <TableHead>Liderança vigente</TableHead>
                            <TableHead>Veículo atual</TableHead>
                            <TableHead>Motorista</TableHead>
                            <TableHead>Desde</TableHead>
                            <TableHead className="text-right">Ações</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {group.items.map((br) => (
                            <TableRow key={br.id}>
                              <TableCell>
                                <span className="font-medium text-fg">{br.code}</span>
                                {br.description ? (
                                  <span className="block truncate text-caption text-fg-muted">
                                    {br.description}
                                  </span>
                                ) : null}
                              </TableCell>
                              <TableCell>
                                <StatusBadge status={br.status === "active" ? "success" : "neutral"}>
                                  {br.status === "active" ? "Ativa" : "Inativa"}
                                </StatusBadge>
                              </TableCell>
                              <TableCell>
                                {br.leaderName ? (
                                  <>
                                    <span className="text-fg">{br.leaderName}</span>
                                    {br.leaderScope ? (
                                      <span className="block text-caption text-fg-muted">
                                        por {LEADER_SCOPE_LABEL[br.leaderScope]}
                                      </span>
                                    ) : null}
                                  </>
                                ) : (
                                  <span className="text-fg-muted">Sem liderança definida</span>
                                )}
                              </TableCell>
                              <TableCell>
                                {br.licensePlate ? (
                                  <>
                                    <span className="font-medium text-fg">{br.licensePlate}</span>
                                    {br.fleetCode && br.fleetCode !== br.licensePlate ? (
                                      <span className="block text-caption text-fg-muted">
                                        frota {br.fleetCode}
                                      </span>
                                    ) : null}
                                  </>
                                ) : (
                                  <span className="text-warning-fg">Sem veículo</span>
                                )}
                              </TableCell>
                              <TableCell>
                                {br.driverName ?? <span className="text-fg-muted">—</span>}
                              </TableCell>
                              <TableCell className="tabular-nums">
                                {formatDate(br.assignmentStart)}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-1">
                                  <IconButton
                                    label={`Histórico de veículos da ${br.code}`}
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setHistoryBr(br)}
                                  >
                                    <History aria-hidden />
                                  </IconButton>
                                  <IconButton
                                    label={`Abrir planejamento da ${br.code}`}
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => onOpenPlanning(br.id)}
                                  >
                                    <CalendarDays aria-hidden />
                                  </IconButton>
                                  {onEdit ? (
                                    <IconButton
                                      label={`Editar a ${br.code}`}
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => onEdit(br.id)}
                                    >
                                      <Pencil aria-hidden />
                                    </IconButton>
                                  ) : null}
                                  {onToggleStatus ? (
                                    <IconButton
                                      label={
                                        br.status === "active"
                                          ? `Inativar a ${br.code}`
                                          : `Reativar a ${br.code}`
                                      }
                                      variant="ghost"
                                      size="sm"
                                      disabled={pending}
                                      onClick={() => onToggleStatus(br.id)}
                                    >
                                      <Power aria-hidden />
                                    </IconButton>
                                  ) : null}
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* §22: a data que a competência representa fica dita, não subentendida —
          senão "veículo atual" num mês passado pareceria o veículo de hoje. */}
      {indicators?.anchorDate ? (
        <p className="flex items-center gap-1.5 text-caption text-fg-muted">
          <Layers className="size-3.5" aria-hidden />
          Recursos resolvidos em {formatDate(indicators.anchorDate)} — o cadastro das posições não muda
          com a competência.
        </p>
      ) : null}

      {canManageBrs ? (
        <BrBatchDrawer
          open={batchOpen}
          onOpenChange={setBatchOpen}
          operations={operations}
          coverage={coverage}
        />
      ) : null}

      <BrHistoryDrawer br={historyBr} onClose={() => setHistoryBr(null)} />
    </div>
  );
}
