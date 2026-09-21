"use client";

import * as React from "react";
import {
  Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { Spinner } from "@/components/feedback/spinner";
import { EmptyState } from "@/components/feedback/empty-state";
import { loadBrVehicleHistory, type BrHistoryLine } from "@/lib/governance/actions";
import type { BrPlannerRow } from "@/lib/governance/br-planner";

function formatDate(value: string | null): string {
  if (!value) return "em aberto";
  const [y, m, d] = value.split("-");
  return d ? `${d}/${m}/${y}` : value;
}

const STATUS_LABEL: Record<string, string> = {
  planned: "Planejado",
  confirmed: "Confirmado",
  executed: "Executado",
  cancelled: "Cancelado",
};

const SOURCE_LABEL: Record<string, string> = {
  manual: "Manual",
  import: "Importação",
  substitution: "Substituição",
  inversion: "Inversão",
};

export interface BrHistoryDrawerProps {
  br: BrPlannerRow | null;
  onClose: () => void;
}

/**
 * Histórico de veículos de uma posição (§34).
 *
 * É a prova da regra central da etapa: a placa muda, o BR não. Cada linha aqui
 * é um veículo que passou por esta posição, com a vigência que teve e o motivo
 * pelo qual saiu — nenhuma delas reescreve a anterior.
 *
 * Carregado ao abrir, não junto com a tela: 88 posições × todo o histórico
 * seria a consulta mais cara do módulo para responder uma pergunta que se faz
 * uma de cada vez.
 */
export function BrHistoryDrawer({ br, onClose }: BrHistoryDrawerProps) {
  return (
    <Drawer open={Boolean(br)} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent size="md">
        <DrawerHeader>
          <DrawerTitle>{br ? `Histórico da ${br.code}` : "Histórico"}</DrawerTitle>
          <DrawerDescription>
            {br
              ? `${br.operationName} · ${br.cityName}/${br.stateUf}. Cada linha é um veículo que ocupou esta posição.`
              : null}
          </DrawerDescription>
        </DrawerHeader>

        {/* A identidade do BR é a chave do corpo: trocar de posição remonta o
            painel em vez de mostrar o histórico anterior sob outro título. */}
        {br ? <HistoryBody key={br.id} operationBrId={br.id} /> : null}
      </DrawerContent>
    </Drawer>
  );
}

function HistoryBody({ operationBrId }: { operationBrId: string }) {
  const [lines, setLines] = React.useState<BrHistoryLine[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, startTransition] = React.useTransition();

  React.useEffect(() => {
    let cancelled = false;
    startTransition(async () => {
      const result = await loadBrVehicleHistory(operationBrId);
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error ?? "Não foi possível carregar o histórico.");
        return;
      }
      setLines(result.data ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [operationBrId]);

  return (
    <DrawerBody className="flex flex-col gap-3">
      {error ? (
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {loading && !lines ? (
        <div className="flex items-center gap-2 py-6 text-body-sm text-fg-muted">
          <Spinner size="sm" />
          Carregando o histórico…
        </div>
      ) : null}

      {lines && lines.length === 0 ? (
        <EmptyState
          title="Nenhum veículo passou por esta posição"
          description="Assim que um veículo for fidelizado aqui, o histórico começa."
        />
      ) : null}

      {lines && lines.length > 0 ? (
        <ol className="flex flex-col gap-3">
          {lines.map((line) => (
            <li
              key={line.assignmentId}
              className="flex flex-col gap-1 rounded-md border border-border p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-fg">{line.licensePlate ?? "—"}</span>
                {line.fleetCode && line.fleetCode !== line.licensePlate ? (
                  <span className="text-caption text-fg-muted">frota {line.fleetCode}</span>
                ) : null}
                <StatusBadge
                  status={
                    line.status === "cancelled"
                      ? "neutral"
                      : line.status === "executed"
                        ? "info"
                        : "success"
                  }
                >
                  {STATUS_LABEL[line.status] ?? line.status}
                </StatusBadge>
                {line.vehicleRole === "support" ? (
                  <Badge variant="neutral">Apoio</Badge>
                ) : null}
                <Badge variant="neutral" className="ml-auto">
                  {SOURCE_LABEL[line.source] ?? line.source}
                </Badge>
              </div>
              <p className="text-body-sm tabular-nums text-fg-secondary">
                {formatDate(line.startDate)} → {formatDate(line.endDate)}
              </p>
              {line.reason ? (
                <p className="text-caption text-fg-muted">Entrada: {line.reason}</p>
              ) : null}
              {line.endReason ? (
                <p className="text-caption text-fg-muted">Saída: {line.endReason}</p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </DrawerBody>
  );
}
