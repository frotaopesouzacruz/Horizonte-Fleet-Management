"use client";

import * as React from "react";
import { Activity, ArrowLeftRight, ChevronDown, Gauge, ShieldCheck, Shuffle, Truck, UserRound } from "lucide-react";
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
}

/**
 * Dashboard de Estabilidade (§39–§43).
 *
 * As fórmulas vivem no banco e estão listadas no rodapé, palavra por palavra,
 * porque um indicador que a pessoa não consegue reproduzir é um número em que
 * ela não confia. A distinção que mais importa aqui é a da §42: substituição e
 * inversão são eventos explícitos e contam como mobilização; a troca observada
 * na matriz sem evento por trás é "inferida" e fica em número separado — nunca
 * somada, para a mesma mobilização não contar duas vezes.
 */
export function StabilityDashboard({ stability, competence }: StabilityDashboardProps) {
  return (
    <section aria-label="Dashboard de estabilidade" className="flex flex-col gap-4">
      {stability ? (
        <>
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
            <KpiCard
              label="Mobilizações"
              value={number.format(stability.mobilizations)}
              period={`${number.format(stability.vehicleSubstitutions)} substituições · ${number.format(stability.vehicleInversions)} inversões`}
              icon={<ArrowLeftRight />}
            />
            <KpiCard
              label="BRs com troca de veículo"
              value={number.format(stability.brsWithVehicleChange)}
              period={`de ${number.format(stability.brsWithVehicle)} com veículo em ${formatCompetence(competence)}`}
              icon={<Truck />}
            />
            <KpiCard
              label="Trocas inferidas"
              value={number.format(stability.inferredVehicleChanges)}
              period="Não somadas às mobilizações"
              icon={<Shuffle />}
            />
          </div>

          {/* §42: o número fica explicado ao lado do cartão, não só no rodapé —
              é o único da linha que não entra em nenhuma soma. */}
          <p className="flex items-start gap-1.5 text-caption text-fg-muted">
            <Activity className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              Trocas inferidas são trocas de titular observadas na matriz sem evento explícito por trás
              (substituição, inversão ou importação-substituição). Ficam fora da soma das mobilizações,
              para a mesma troca não contar duas vezes. Indicadores resolvidos em{" "}
              {formatDate(stability.anchorDate)}, sobre o período de {formatDate(stability.periodStart)} a{" "}
              {formatDate(stability.periodEnd)}.
            </span>
          </p>

          <Card>
            <CardHeader
              title="Estabilidade por recorte"
              description="As mesmas contas, abertas por operação, por local e por liderança vigente na data-âncora."
            />
            <CardContent>
              <Tabs defaultValue="operacao">
                <TabsList>
                  <TabsTrigger value="operacao">Por operação</TabsTrigger>
                  <TabsTrigger value="local">Por local</TabsTrigger>
                  <TabsTrigger value="lideranca">Por liderança</TabsTrigger>
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
              </Tabs>
            </CardContent>
          </Card>
        </>
      ) : (
        <Alert variant="neutral">
          <AlertDescription>
            Os indicadores de estabilidade não puderam ser calculados agora. A hierarquia abaixo
            continua disponível.
          </AlertDescription>
        </Alert>
      )}

      <FormulasCard />
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

/**
 * As fórmulas, tal como o banco as aplica (§39–§43). Fechado por padrão: quem
 * já as conhece não precisa rolar por elas todo dia, e quem duvida de um número
 * abre e confere.
 */
function FormulasCard() {
  return (
    <Card>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-body-sm font-semibold text-fg hfm-focus-ring [&::-webkit-details-marker]:hidden">
          <ChevronDown
            aria-hidden
            className="size-4 shrink-0 text-fg-muted transition-transform group-open:rotate-180"
          />
          Como os indicadores são calculados
        </summary>
        <div className="border-t border-border px-4 py-3">
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-body-sm text-fg-secondary">
            <li>
              <strong className="text-fg">Universo</strong> = BRs ativas do filtro.
            </li>
            <li>
              <strong className="text-fg">Com veículo</strong> = BR com titular não cancelado que toca a
              competência.
            </li>
            <li>
              <strong className="text-fg">Troca de veículo</strong> = vínculo com{" "}
              <code className="rounded-xs bg-surface-secondary px-1 text-caption">replaces_assignment_id</code>{" "}
              iniciado no mês (substituição, inversão ou importação-substituição). A inversão gera duas
              linhas e conta como UM evento; a BR com troca conta uma vez.
            </li>
            <li>
              <strong className="text-fg">Estabilidade da frota</strong> = 1 − BRs com troca / BRs com
              veículo.
            </li>
            <li>
              <strong className="text-fg">Troca de motorista</strong> = motorista principal iniciado no mês
              cujo antecessor no mesmo BR terminou na véspera.
            </li>
            <li>
              <strong className="text-fg">Estabilidade de motoristas</strong> = 1 − BRs com troca de
              motorista / BRs com motorista.
            </li>
            <li>
              <strong className="text-fg">Cobertura</strong> = BRs ativas com liderança na data-âncora / BRs
              ativas.
            </li>
            <li>
              <strong className="text-fg">Mobilização inferida</strong> = troca de titular entre vínculos
              consecutivos sem{" "}
              <code className="rounded-xs bg-surface-secondary px-1 text-caption">replaces_assignment_id</code>,
              mostrada à parte — sem contagem dupla com as mobilizações.
            </li>
          </ul>
        </div>
      </details>
    </Card>
  );
}
