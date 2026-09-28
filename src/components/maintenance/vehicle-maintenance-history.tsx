"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { loadVehicleMaintenanceHistory } from "@/lib/maintenance/actions";
import {
  formatDate,
  formatHours,
  formatInt,
  type VehicleMaintenanceHistory as History,
} from "@/lib/maintenance/types";
import { MaintenanceStatusBadge, MaintenanceTypeBadge } from "./badges";

/**
 * Histórico de manutenção de um veículo — a aba "Manutenção" do Cadastro de
 * Frotas. É uma CONSULTA à base oficial (`vehicle_maintenance_history`, pelo
 * id do veículo, nunca pela placa), não uma cópia: o que muda na Manutenção
 * aparece aqui na próxima abertura. Mudar a manutenção é no módulo.
 */
export function VehicleMaintenanceHistory({ vehicleId }: { vehicleId: string }) {
  const [attempt, setAttempt] = React.useState(0);
  const [state, setState] = React.useState<{
    id: string;
    attempt: number;
    data: History | null;
    error: string | null;
  } | null>(null);

  // A resposta só vale para o veículo e a tentativa que a pediram; trocar de
  // veículo no meio da leitura descarta a resposta atrasada.
  React.useEffect(() => {
    let cancelled = false;
    void loadVehicleMaintenanceHistory(vehicleId).then((result) => {
      if (cancelled) return;
      setState({
        id: vehicleId,
        attempt,
        data: result.ok ? (result.data ?? null) : null,
        error: result.ok ? null : (result.error ?? "Falha ao carregar."),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [vehicleId, attempt]);

  const current = state && state.id === vehicleId && state.attempt === attempt ? state : null;
  if (!current) return <LoadingState label="Carregando manutenções…" />;
  if (current.error) {
    return (
      <Alert variant="danger">
        <AlertTitle>Não foi possível carregar o histórico de manutenção</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center gap-2">
          {current.error}
          <Button size="sm" variant="secondary" leadingIcon={<RotateCcw />} onClick={() => setAttempt((n) => n + 1)}>
            Tentar de novo
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  const data = current.data;
  if (!data) return <LoadingState label="Carregando manutenções…" />;
  const { summary } = data;

  if (summary.total === 0) {
    return (
      <EmptyState
        title="Nenhuma manutenção registrada"
        description="Este veículo ainda não tem manutenções na base, ou elas estão fora do seu escopo de acesso."
        action={
          <Button asChild size="sm" variant="secondary" trailingIcon={<ArrowUpRight />}>
            <Link href="/frota/manutencao">Abrir o módulo Manutenção</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="vehicle-maintenance-history">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fact label="Manutenções">{formatInt(summary.total)}</Fact>
        <Fact label="Em aberto">{formatInt(summary.open)}</Fact>
        <Fact label="TMM médio">{formatHours(summary.avgDurationHours)}</Fact>
        <Fact label="Última saída">{formatDate(summary.lastExit)}</Fact>
        <Fact label="Corretivas">{formatInt(summary.corrective)}</Fact>
        <Fact label="Preventivas">{formatInt(summary.preventive)}</Fact>
        <Fact label="Preditivas">{formatInt(summary.predictive)}</Fact>
        <Fact label={`Possível reincidência (${data.recurrenceWindowDays} d)`}>{formatInt(summary.recurrences)}</Fact>
      </dl>

      {data.suppliers.length ? (
        <p className="text-caption text-fg-secondary">
          <span className="text-fg-muted">Fornecedores: </span>
          {data.suppliers.map((s) => `${s.supplier} (${s.count})`).join(" · ")}
        </p>
      ) : null}

      <TableContainer tabIndex={0}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Serviços</TableHead>
              <TableHead>Entrada</TableHead>
              <TableHead>Saída</TableHead>
              <TableHead numeric>TMM</TableHead>
              <TableHead>Operação (na data)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.maintenances.map((m) => {
              const services = m.items.filter((i) => i.status !== "cancelled");
              return (
                <TableRow key={m.id}>
                  <TableCell>
                    <Link
                      href={`/frota/manutencao?aba=base&veiculo=${m.vehicleId}&m=${m.id}`}
                      className="font-mono text-caption text-link hover:underline hfm-focus-ring"
                    >
                      {m.code}
                    </Link>
                    {m.recurrent ? (
                      <Badge variant="warning" size="sm" appearance="soft" className="ml-2">
                        Possível reincidência
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell><MaintenanceTypeBadge type={m.type} name={m.typeName} /></TableCell>
                  <TableCell><MaintenanceStatusBadge status={m.status} /></TableCell>
                  <TableCell className="max-w-[16rem]" truncate title={services.map((i) => i.service).join(", ")}>
                    {services.map((i) => i.service).join(", ") || "—"}
                  </TableCell>
                  <TableCell className="tabular-nums">{formatDate(m.entryDate)}</TableCell>
                  <TableCell className="tabular-nums">{formatDate(m.exitDate)}</TableCell>
                  <TableCell numeric>
                    {m.durationHours == null ? "—" : `${m.durationPrecision === "date" ? "≈ " : ""}${formatHours(m.durationHours)}`}
                  </TableCell>
                  <TableCell>{m.operationName ?? "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="text-body-sm font-medium tabular-nums text-fg">{children}</dd>
    </div>
  );
}
