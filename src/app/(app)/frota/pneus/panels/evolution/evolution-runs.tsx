"use client";

import * as React from "react";
import { Clock, RefreshCw } from "lucide-react";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { useToast } from "@/components/feedback/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { reprocessTireKpi, type Result } from "@/lib/tires/actions";
import { fmtInt, formatDate, modernTerms, type KpiRun, type TiresKpiHistory } from "@/lib/tires/types";
import type { TiresPanelContext } from "../../shared";
import { plural, Section } from "../tires-ui";
import { DEFAULT_TZ, formatSlot, periodLabel, periodSpoken, RUN_KIND_LABEL, RUN_STATUS } from "./evolution-utils";

/**
 * Execuções recentes da captura (as 12 últimas, de qualquer situação): período,
 * horário planejado, situação com o motivo, dados de origem e atraso. Quem tem
 * `tires.parameters.manage` reprocessa uma captura que falhou ou foi ignorada —
 * o banco recusa período que já tem captura concluída (o histórico não é
 * recalculado).
 */
const periodOf = (r: Pick<KpiRun, "periodKind" | "periodKey">) => `${r.periodKind}:${r.periodKey}`;

export function EvolutionRuns({ data, ctx }: { data: TiresKpiHistory; ctx: TiresPanelContext }) {
  const { toast } = useToast();
  const [target, setTarget] = React.useState<KpiRun | null>(null);
  const tz = data.schedule?.timezone || DEFAULT_TZ;
  const canReprocess = ctx.perms.parameters;
  const captured = new Set(data.runs.filter((r) => r.status === "concluida").map(periodOf));
  const failed = data.runs.filter((r) => r.status === "falhou" || r.status === "ignorada").length;

  const confirm = async () => {
    const run = target;
    if (!run) return;
    let r: Result<unknown>;
    try {
      r = await reprocessTireKpi(run.id);
    } catch {
      r = { ok: false, error: "Falha de comunicação com o servidor. Tente de novo." };
    }
    if (!r.ok) {
      toast({ title: "Não foi possível reprocessar a captura", description: r.error, variant: "danger" });
      return;
    }
    toast({ title: "Captura reprocessada", description: `Período ${periodLabel(run.periodKey)}: veja a situação na lista.`, variant: "success" });
    ctx.refresh();
  };

  return (
    <Section
      title="Capturas recentes"
      description="As últimas execuções da captura dos indicadores, agendadas e reprocessamentos. No máximo uma captura concluída por período: rodar de novo não duplica a série."
      actions={
        failed > 0 ? (
          <StatusBadge status="warning" size="sm" withIcon data-testid="tires-evolution-runs-failed">
            {fmtInt(failed)} {plural(failed, "com falha ou ignorada", "com falha ou ignoradas")}
          </StatusBadge>
        ) : null
      }
      testId="tires-evolution-runs"
    >
      {data.runs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-body-sm text-fg-muted" data-testid="tires-evolution-runs-empty">
          Nenhuma execução registrada ainda.
        </p>
      ) : (
        <TableContainer>
          <Table>
            <caption className="sr-only">Execuções recentes da captura dos indicadores de pneus</caption>
            <TableHeader>
              <TableRow>
                <TableHead>Período</TableHead>
                <TableHead>Horário planejado</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Execução</TableHead>
                <TableHead>Dados de origem</TableHead>
                {canReprocess ? <TableHead align="right">Ação</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.runs.map((r) => {
                const status = RUN_STATUS[r.status] ?? { label: r.status, tone: "neutral" as const };
                const retryable = (r.status === "falhou" || r.status === "ignorada") && !captured.has(periodOf(r));
                return (
                  <TableRow key={r.id} className="align-top" data-testid="tires-evolution-run" data-status={r.status}>
                    <TableCell className="whitespace-nowrap py-2">
                      <span className="block font-medium text-fg" title={periodSpoken(r.periodKey)}>
                        {periodLabel(r.periodKey)}
                      </span>
                      <span className="block text-caption text-fg-muted">
                        {RUN_KIND_LABEL[r.periodKind] ?? r.periodKind}
                        {r.trigger === "reprocessamento" ? " · reprocessamento" : ""}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-2 tabular-nums text-fg-secondary">{formatSlot(r.slotAt, tz)}</TableCell>
                    <TableCell className="min-w-[13rem] max-w-[26rem] py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={status.tone} size="sm" withIcon>
                          {status.label}
                        </StatusBadge>
                        {r.executedLate ? (
                          <Badge
                            variant="warning"
                            appearance="outline"
                            size="sm"
                            icon={<Clock aria-hidden />}
                            title="Rodou depois do horário planejado (janela de recuperação), avaliando os dados como estavam na data do período."
                            data-testid="tires-evolution-run-late"
                          >
                            Executada com atraso
                          </Badge>
                        ) : null}
                      </div>
                      {r.errorMessage ? (
                        <p className="mt-1 text-caption text-fg-secondary" data-testid="tires-evolution-run-reason">
                          <span className="font-semibold">Motivo:</span> {modernTerms(r.errorMessage)}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-2 text-caption text-fg-secondary">
                      <span className="block tabular-nums">Início {formatSlot(r.startedAt, tz, false)}</span>
                      {r.finishedAt ? <span className="block tabular-nums">Fim {formatSlot(r.finishedAt, tz, false)}</span> : null}
                      {r.requestedByName ? <span className="block text-fg-muted">{r.requestedByName}</span> : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-2 text-caption text-fg-secondary">
                      <span className="block text-body-sm text-fg">{r.sourceReferenceDate ? `dados de ${formatDate(r.sourceReferenceDate)}` : "—"}</span>
                      {r.tiresInUse != null || r.tiresTotal != null ? (
                        <span className="block tabular-nums">
                          {fmtInt(r.tiresInUse)} em uso de {fmtInt(r.tiresTotal)} pneus
                        </span>
                      ) : null}
                      {r.status === "concluida" ? (
                        <span className="block tabular-nums">
                          {fmtInt(r.valuesCount)} {plural(r.valuesCount, "valor gravado", "valores gravados")}
                        </span>
                      ) : null}
                    </TableCell>
                    {canReprocess ? (
                      <TableCell align="right" className="whitespace-nowrap py-2">
                        {retryable ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            leadingIcon={<RefreshCw />}
                            onClick={() => setTarget(r)}
                            disabled={ctx.pending}
                            data-testid="tires-evolution-reprocess"
                          >
                            Reprocessar
                          </Button>
                        ) : r.status === "falhou" || r.status === "ignorada" ? (
                          <span className="text-caption text-fg-muted">Período já capturado</span>
                        ) : (
                          <span className="text-caption text-fg-muted">
                            <span aria-hidden>—</span>
                            <span className="sr-only">Sem ação</span>
                          </span>
                        )}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <ConfirmDialog
        open={target != null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        title="Reprocessar a captura?"
        description={
          target ? (
            <>
              Período {periodLabel(target.periodKey)} (horário planejado {formatSlot(target.slotAt, tz)}). A captura roda de novo avaliando os dados como
              estavam na data do período e fica registrada como reprocessamento. Só vale para período sem captura concluída: o que já foi gravado não é
              recalculado.
            </>
          ) : undefined
        }
        confirmLabel="Reprocessar"
        icon={<RefreshCw />}
        onConfirm={confirm}
      />
    </Section>
  );
}
