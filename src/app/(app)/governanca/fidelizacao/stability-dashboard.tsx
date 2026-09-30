"use client";

import * as React from "react";
import {
  Activity, ArrowLeftRight, CarFront, Gauge, MapPin, Repeat, ShieldCheck, Shuffle, Truck, UserRound, UserRoundX,
  Users,
} from "lucide-react";
import { KpiCard, type KpiStatus } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import type { FidelizationStability, StabilityBreakdownRow } from "@/lib/governance/brs";
import { formatCompetence, type Competence } from "@/lib/governance/competence";

const number = new Intl.NumberFormat("pt-BR");
const percent = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

function formatDate(value: string | null): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  return d ? `${d}/${m}/${y}` : value;
}

/** "97,7%" em pt-BR; "—" quando o denominador é zero e a razão não existe. */
export function formatPct(value: number | null): string {
  return value === null ? "—" : `${percent.format(value)}%`;
}

/**
 * Faixas do Dashboard de Estabilidade (§39): a mesma escala para as três
 * razões, para que "verde" signifique o mesmo em qualquer cartão.
 */
export function stabilityStatus(value: number | null): KpiStatus | undefined {
  if (value === null) return undefined;
  if (value >= 95) return "success";
  if (value >= 85) return "warning";
  return "danger";
}

export interface StabilityDashboardProps {
  stability: FidelizationStability | null;
  competence: Competence;
  /**
   * Vínculos da competência abertos por substituição ou inversão (indicadores
   * da Central). Usado quando a estabilidade não pôde ser calculada; com ela,
   * o cartão lê `vehicleChangeLinks`, que inclui as trocas inferidas.
   */
  substitutionsAndInversions: number;
}

/**
 * Dashboard de Estabilidade (§39–§43).
 *
 * As fórmulas vivem no banco. Mobilizações são substituições e inversões —
 * as registradas (tela ou importação, com `replaces_assignment_id`) e as
 * inferidas (troca de titular sem evento por trás, típica de cargas antigas),
 * sem contagem dupla: a troca inferida recíproca entre duas BRs no mesmo dia
 * é uma inversão (20260930120000).
 */
export function StabilityDashboard({
  stability,
  competence,
  substitutionsAndInversions,
}: StabilityDashboardProps) {
  const substitutionsCard = (
    <KpiCard
      label="Substituições e inversões"
      value={number.format(stability ? stability.vehicleChangeLinks : substitutionsAndInversions)}
      period={`Vínculos que entraram por troca · ${formatCompetence(competence)}`}
      icon={<Repeat />}
    />
  );

  return (
    <section aria-label="Dashboard de estabilidade" className="flex flex-col gap-4">
      {stability ? (
        <>
          {/* Etapa 15 (§14, §17): o tamanho do recorte antes das razões — quantas
              posições existem, quantos veículos e motoristas passaram por elas no
              mês e quantas BRs ativas estão sem motorista. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="BRs cadastradas"
              value={number.format(stability.brsRegistered)}
              period={`${number.format(stability.brsTotal)} ${stability.brsTotal === 1 ? "ativa" : "ativas"}`}
              icon={<MapPin />}
            />
            <KpiCard
              label="Veículos fidelizados"
              value={number.format(stability.vehiclesFidelized)}
              period="Titulares distintos no mês"
              icon={<CarFront />}
            />
            <KpiCard
              label="Motoristas fidelizados"
              value={number.format(stability.driversFidelized)}
              period="Principal ou secundário, no mês"
              icon={<Users />}
            />
            <KpiCard
              label="BRs sem motorista"
              value={number.format(stability.brsWithoutDriver)}
              status={stability.brsWithoutDriver > 0 ? "warning" : undefined}
              period={`de ${number.format(stability.brsTotal)} BRs ativas`}
              icon={<UserRoundX />}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <KpiCard
              label="Estabilidade da frota"
              value={formatPct(stability.fleetStabilityPct)}
              status={stabilityStatus(stability.fleetStabilityPct)}
              period={`${number.format(stability.brsWithVehicleChange)} de ${number.format(stability.brsWithVehicle)} BRs com troca de veículo`}
              icon={<Gauge />}
            />
            <KpiCard
              label="Estabilidade de motoristas"
              value={formatPct(stability.driverStabilityPct)}
              status={stabilityStatus(stability.driverStabilityPct)}
              period={
                stability.brsWithDriver > 0
                  ? `${number.format(stability.brsWithDriverChange)} de ${number.format(stability.brsWithDriver)} BRs com troca de motorista`
                  : "Nenhuma BR com motorista planejado"
              }
              icon={<UserRound />}
            />
            <KpiCard
              label="Cobertura de lideranças"
              value={formatPct(stability.leadershipCoveragePct)}
              status={stabilityStatus(stability.leadershipCoveragePct)}
              period={`${number.format(stability.brsWithLeader)} de ${number.format(stability.brsTotal)} BRs ativas com liderança`}
              icon={<ShieldCheck />}
            />
          </div>

          {/* As trocas do mês lado a lado: os eventos explícitos, os vínculos que
              eles abriram, as BRs afetadas e, à parte, as inferidas. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Mobilizações"
              value={number.format(stability.mobilizations)}
              period={`${number.format(stability.vehicleSubstitutions)} substituições · ${number.format(stability.vehicleInversions)} inversões`}
              icon={<ArrowLeftRight />}
            />
            {substitutionsCard}
            <KpiCard
              label="BRs com troca de veículo"
              value={number.format(stability.brsWithVehicleChange)}
              period={`de ${number.format(stability.brsWithVehicle)} com veículo em ${formatCompetence(competence)}`}
              icon={<Truck />}
            />
            <KpiCard
              label="Trocas inferidas"
              value={number.format(stability.inferredVehicleChanges)}
              period={
                stability.inferredVehicleChanges > 0
                  ? `Incluídas nas mobilizações: ${number.format(stability.inferredSubstitutions)} subst. · ${number.format(stability.inferredInversions)} inv.`
                  : "Incluídas nas mobilizações"
              }
              icon={<Shuffle />}
            />
          </div>

          {/* §42: o que é troca inferida e como ela entra nas contas, dito ao lado dos cartões. */}
          <p className="flex items-start gap-1.5 text-caption text-fg-muted">
            <Activity className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              Trocas inferidas são trocas de titular sem evento registrado por trás — por exemplo, períodos
              consecutivos trazidos por importações anteriores. Entram nas mobilizações sem contagem dupla (a
              troca recíproca entre duas BRs no mesmo dia conta como uma inversão) e na estabilidade da frota.
              As importações novas já registram a troca como substituição ou inversão. Indicadores resolvidos em{" "}
              {formatDate(stability.anchorDate)}, sobre o período de {formatDate(stability.periodStart)} a{" "}
              {formatDate(stability.periodEnd)}.
            </span>
          </p>

          <Card>
            <CardHeader
              title="Estabilidade por recorte"
              description="As mesmas contas, abertas por operação, por local, por liderança vigente na data-âncora, por estado e por tipo de equipamento."
            />
            <CardContent>
              <Tabs defaultValue="operacao">
                <TabsList>
                  <TabsTrigger value="operacao">Por operação</TabsTrigger>
                  <TabsTrigger value="local">Por local</TabsTrigger>
                  <TabsTrigger value="lideranca">Por liderança</TabsTrigger>
                  <TabsTrigger value="estado">Por estado</TabsTrigger>
                  <TabsTrigger value="equipamento">Por tipo de equipamento</TabsTrigger>
                </TabsList>
                <TabsContent value="operacao">
                  <BreakdownTable rows={stability.byOperation} firstColumn="Operação" />
                </TabsContent>
                <TabsContent value="local">
                  <BreakdownTable rows={stability.byCity} firstColumn="Local" />
                </TabsContent>
                <TabsContent value="lideranca">
                  <BreakdownTable rows={stability.byLeader} firstColumn="Liderança" />
                </TabsContent>
                <TabsContent value="estado">
                  <BreakdownTable rows={stability.byState} firstColumn="Estado" />
                </TabsContent>
                <TabsContent value="equipamento">
                  <BreakdownTable rows={stability.byVehicleType} firstColumn="Tipo de equipamento" />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          <Alert variant="neutral">
            <AlertDescription>
              Os indicadores de estabilidade não puderam ser calculados agora. A hierarquia abaixo
              continua disponível.
            </AlertDescription>
          </Alert>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {substitutionsCard}
          </div>
        </>
      )}
    </section>
  );
}

function BreakdownTable({ rows, firstColumn }: { rows: StabilityBreakdownRow[]; firstColumn: string }) {
  return (
    <TableContainer>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{firstColumn}</TableHead>
            <TableHead numeric>BRs</TableHead>
            <TableHead numeric>Com veículo</TableHead>
            <TableHead numeric>Mobilizações</TableHead>
            <TableHead numeric>BRs com troca</TableHead>
            <TableHead numeric>Estabilidade</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableEmpty colSpan={6} message="Nenhuma BR ativa neste recorte." />
          ) : (
            rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell>
                  <span className="block truncate font-medium text-fg">{row.label}</span>
                  {row.sublabel ? (
                    <span className="block truncate text-caption text-fg-muted">{row.sublabel}</span>
                  ) : null}
                </TableCell>
                <TableCell numeric>{number.format(row.brs)}</TableCell>
                <TableCell numeric>{number.format(row.withVehicle)}</TableCell>
                <TableCell numeric>{number.format(row.mobilizations)}</TableCell>
                <TableCell numeric>{number.format(row.brsWithChange)}</TableCell>
                <TableCell numeric className="font-medium text-fg">
                  {formatPct(row.stabilityPct)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
