"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer";
import {
  Table, TableBody, TableCaption, TableCell, TableContainer, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import type { KmRotationSimulation, KmRotationVehicle } from "@/lib/km/rotation";
import type { Result } from "@/lib/km/rotation-actions";
import { fmtInt, fmtKm, fmtPct } from "@/lib/km/types";
import {
  analysisFromSimulation,
  kmMonth,
  localOf,
  maintenanceText,
  pairText,
  period,
  preventiveText,
  type RotationAnalysis,
} from "./format";
import { ConditionedNote, Fact, Facts, PriorityBadge, Section } from "./ui";

/**
 * Gaveta "Análise do rodízio A ⇄ B": as duas frotas, a simulação no horizonte,
 * os cenários de 30/60/90 dias e a justificativa — tudo como a rotina devolveu.
 * Com `onSimulate`, oferece recalcular o par com as leituras atuais
 * (`km_simulate_rotation`), sem gravar nada.
 */
export function AnalysisDrawer({
  analysis,
  onOpenChange,
  onSimulate,
}: {
  analysis: RotationAnalysis | null;
  onOpenChange: (open: boolean) => void;
  onSimulate?: () => Promise<Result<KmRotationSimulation>>;
}) {
  return (
    <Drawer open={analysis != null} onOpenChange={onOpenChange}>
      <DrawerContent size="xl" data-testid="km-rodizio-analysis">
        {analysis ? (
          <AnalysisBody
            key={`${analysis.vehicleA.vehicleId}|${analysis.vehicleB.vehicleId}|${analysis.source}`}
            base={analysis}
            onSimulate={onSimulate}
          />
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}

function AnalysisBody({
  base,
  onSimulate,
}: {
  base: RotationAnalysis;
  onSimulate?: () => Promise<Result<KmRotationSimulation>>;
}) {
  const { toast } = useToast();
  const [current, setCurrent] = React.useState<RotationAnalysis>(base);
  const [busy, setBusy] = React.useState(false);
  const [simError, setSimError] = React.useState<string | null>(null);
  const a = current.vehicleA;
  const b = current.vehicleB;

  async function simulate() {
    if (!onSimulate) return;
    setBusy(true);
    setSimError(null);
    const res = await onSimulate();
    setBusy(false);
    if (!res.ok || !res.data) {
      toast({ variant: "danger", title: "Simulação não realizada", description: res.error });
      return;
    }
    if (res.data.error) {
      setSimError(res.data.error);
      return;
    }
    setCurrent(analysisFromSimulation(res.data, base));
  }

  return (
    <>
      <DrawerHeader>
        <DrawerTitle>Análise do rodízio {pairText(a, b)}</DrawerTitle>
        <DrawerDescription>
          {current.cohortLabel ?? "Grupo técnico não identificado"} · horizonte de {fmtInt(current.horizonDays)} dias
          {current.period ? ` · período ${period(current.period.from, current.period.to)}` : ""}
        </DrawerDescription>
      </DrawerHeader>
      <DrawerBody className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <PriorityBadge priority={current.priority} />
          {current.origin ? <span className="text-caption text-fg-muted">{current.origin}</span> : null}
          {onSimulate ? (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              leadingIcon={<RefreshCw aria-hidden />}
              loading={busy}
              onClick={simulate}
              data-testid="km-rodizio-analysis-simulate"
            >
              Simular com as leituras atuais
            </Button>
          ) : null}
        </div>

        {simError ? (
          <Alert variant="warning">
            <AlertDescription>{simError}</AlertDescription>
          </Alert>
        ) : null}
        {current.sameCohort === false ? (
          <Alert variant="warning">
            <AlertDescription>As frotas não são da mesma coorte técnica: o rodízio não pode entrar num plano.</AlertDescription>
          </Alert>
        ) : null}
        {current.conditioned ? <ConditionedNote reasons={current.conditionReasons} /> : null}

        <div className="grid gap-4 md:grid-cols-2">
          <VehicleSection title="Frota A" hint="Hodômetro e rodagem maiores" vehicle={a} />
          <VehicleSection title="Frota B" hint="Hodômetro e rodagem menores" vehicle={b} />
        </div>

        <Section
          title="Simulação"
          description="Gap = diferença entre os hodômetros de A e B. Com o rodízio, A passa a rodar como B e vice-versa."
          testId="km-rodizio-analysis-simulation"
        >
          <Facts>
            <Fact label="Média do grupo (mediana da coorte)">{kmMonth(current.cohort?.kmMonthMedian)}</Fact>
            <Fact label="Gap atual entre hodômetros">{fmtKm(current.gapCurrent)}</Fact>
            <Fact label={`Gap projetado sem rodízio (${current.horizonDays} dias)`}>{fmtKm(current.gapWithout)}</Fact>
            <Fact label={`Gap projetado com rodízio (${current.horizonDays} dias)`}>{fmtKm(current.gapWith)}</Fact>
            <Fact label="Redução projetada do desequilíbrio">
              {current.reductionKm == null ? "—" : `${fmtKm(current.reductionKm)} (${fmtPct(current.reductionPct)})`}
            </Fact>
            <Fact label={`Redução projetada da intensidade de rodagem da ${a.plate}`}>
              {fmtPct(current.intensityReductionAPct)}
            </Fact>
            <Fact label="Horizonte">{fmtInt(current.horizonDays)} dias</Fact>
          </Facts>
        </Section>

        <Section title="Cenários por horizonte" testId="km-rodizio-analysis-scenarios">
          {current.scenarios.length === 0 ? (
            <p className="text-body-sm text-fg-muted">Sem cenários calculados para este par.</p>
          ) : (
            <TableContainer>
              <Table>
                <TableCaption className="sr-only">Gap projetado entre os hodômetros sem e com o rodízio</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Horizonte</TableHead>
                    <TableHead numeric>Sem rodízio</TableHead>
                    <TableHead numeric>Com rodízio</TableHead>
                    <TableHead numeric>Redução</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {current.scenarios.map((s) => (
                    <TableRow
                      key={s.horizonDays}
                      className={s.horizonDays === current.horizonDays ? "bg-primary-soft/40" : undefined}
                    >
                      <TableHead scope="row" className="font-medium">
                        {s.horizonDays} dias{s.horizonDays === current.horizonDays ? " (selecionado)" : ""}
                      </TableHead>
                      <TableCell numeric>
                        <span className="block">{fmtKm(s.without.gap)}</span>
                        <span className="block text-caption text-fg-muted">
                          A {fmtKm(s.without.odometerA)} · B {fmtKm(s.without.odometerB)}
                        </span>
                      </TableCell>
                      <TableCell numeric>
                        <span className="block">{fmtKm(s.with.gap)}</span>
                        <span className="block text-caption text-fg-muted">
                          A {fmtKm(s.with.odometerA)} · B {fmtKm(s.with.odometerB)}
                        </span>
                      </TableCell>
                      <TableCell numeric>
                        <span className="block font-medium">{fmtKm(s.reductionKm)}</span>
                        <span className="block text-caption text-fg-muted">{fmtPct(s.reductionPct)}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Section>

        <Section title="Justificativa" testId="km-rodizio-analysis-justification">
          <p className="text-body-sm text-fg">{current.justification ?? "—"}</p>
        </Section>
      </DrawerBody>
    </>
  );
}

function VehicleSection({ title, hint, vehicle }: { title: string; hint: string; vehicle: KmRotationVehicle }) {
  return (
    <Section title={`${title} · ${vehicle.plate}`} description={hint}>
      <Facts className="sm:grid-cols-2 lg:grid-cols-2">
        <Fact label="Placa">
          {vehicle.plate}
          {vehicle.fleetCode ? <span className="text-fg-muted"> · frota {vehicle.fleetCode}</span> : null}
        </Fact>
        <Fact label="Local">{localOf(vehicle)}</Fact>
        <Fact label="Operação">{vehicle.operation ?? "Não informada"}</Fact>
        <Fact label="BR">{vehicle.br ?? "Não informada"}</Fact>
        <Fact label="KM atual">{fmtKm(vehicle.odometer)}</Fact>
        <Fact label="Rodagem média">{kmMonth(vehicle.kmMonth)}</Fact>
        <Fact label="Percentil de utilização">
          {vehicle.percentile == null ? "—" : `${fmtInt(vehicle.percentile)}º na coorte`}
        </Fact>
        <Fact label="Cobertura de leitura">{fmtPct(vehicle.coveragePct)}</Fact>
        <Fact label="Preventiva">{preventiveText(vehicle)}</Fact>
        <Fact label="Manutenção aberta">{maintenanceText(vehicle)}</Fact>
      </Facts>
    </Section>
  );
}
