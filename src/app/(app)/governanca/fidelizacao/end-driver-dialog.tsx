"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { UserRound } from "lucide-react";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FormField } from "@/components/ui/form-field";
import { DateInput } from "@/components/ui/date-input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import { endFidelizationDriver, type Result } from "@/lib/governance/actions";
import type { DriverPlanRow } from "@/lib/governance/queries";
import { canSubstituteDriver } from "./driver-substitute-dialog";

function formatDate(value: string | null): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  return d ? `${d}/${m}/${y}` : value;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Encerrar tem a mesma pré-condição de substituir: um vínculo cancelado ou que
 * já terminou não tem o que encerrar.
 */
export function canEndDriver(row: DriverPlanRow, today = todayIso()): boolean {
  return canSubstituteDriver(row, today);
}

export type EndDriverAction = (id: string, endDate: string, reason: string) => Promise<Result>;

export interface EndDriverDialogProps {
  row: DriverPlanRow | null;
  onClose: () => void;
  /** A prévia de desenvolvimento troca a server action por uma resposta fixa. */
  action?: EndDriverAction;
}

/**
 * Encerrar o vínculo de um motorista (§34).
 *
 * A data e o motivo são obrigatórios, como no banco: o motivo é o que alguém
 * pergunta um mês depois. Uma data anterior ao início do vínculo não o
 * encerra — o banco o cancela —, e o diálogo diz isso antes de gravar, em vez
 * de a pessoa descobrir no histórico.
 */
export function EndDriverDialog({ row, onClose, action = endFidelizationDriver }: EndDriverDialogProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, startTransition] = React.useTransition();

  const [endDate, setEndDate] = React.useState(() => {
    const today = todayIso();
    if (!row) return today;
    if (row.endDate && row.endDate < today) return row.endDate;
    return today;
  });
  const [reason, setReason] = React.useState("");
  const [dateError, setDateError] = React.useState<string | null>(null);
  const [reasonError, setReasonError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const cancels = Boolean(row && endDate && endDate < row.startDate);

  const submit = () => {
    if (!row) return;
    setError(null);
    const nextDateError = endDate ? null : "Informe a data de encerramento.";
    const nextReasonError = reason.trim() ? null : "Informe o motivo do encerramento.";
    setDateError(nextDateError);
    setReasonError(nextReasonError);
    if (nextDateError || nextReasonError) return;

    startTransition(async () => {
      const result = await action(row.id, endDate, reason.trim());
      if (result.ok) {
        toast({ title: cancels ? "Vínculo do motorista cancelado." : "Vínculo do motorista encerrado.", variant: "success" });
        onClose();
        router.refresh();
      } else {
        setError(result.error ?? "Não foi possível encerrar o vínculo do motorista.");
      }
    });
  };

  return (
    <Dialog open={Boolean(row)} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Encerrar motorista</DialogTitle>
          <DialogDescription>
            O vínculo do motorista termina na data informada; o do veículo com a BR continua. Nada é apagado: o
            período fica no histórico de movimentações.
          </DialogDescription>
        </DialogHeader>

        {row ? (
          <DialogBody className="flex flex-col gap-4">
            {error ? (
              <Alert variant="danger">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex items-start gap-2.5 rounded-md border border-border bg-surface p-3">
              <UserRound aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-sm font-medium text-fg">{row.employeeName}</p>
                <p className="text-caption text-fg-muted">
                  {row.employeeCode ? `Matrícula ${row.employeeCode} · ` : ""}
                  {row.brCode} · {formatDate(row.startDate)} — {row.endDate ? formatDate(row.endDate) : "em aberto"}
                </p>
              </div>
              <Badge variant={row.driverRole === "primary" ? "primary" : "neutral"} size="sm">
                {row.driverRole === "primary" ? "Principal" : "Secundário"}
              </Badge>
            </div>

            <FormField label="Data de encerramento" required id="end-driver-date" error={dateError}>
              <DateInput
                id="end-driver-date"
                value={endDate}
                disabled={busy}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setDateError(null);
                }}
              />
            </FormField>

            {cancels ? (
              <Alert variant="warning">
                <AlertDescription>
                  A data é anterior ao início do vínculo ({formatDate(row.startDate)}): o vínculo será cancelado,
                  não encerrado.
                </AlertDescription>
              </Alert>
            ) : null}

            <FormField label="Motivo" required id="end-driver-reason" error={reasonError}>
              <Textarea
                id="end-driver-reason"
                rows={3}
                value={reason}
                disabled={busy}
                maxLength={500}
                placeholder="Por que o vínculo do motorista está terminando?"
                onChange={(e) => {
                  setReason(e.target.value);
                  setReasonError(null);
                }}
              />
            </FormField>

            <p className="text-caption text-fg-muted">
              Encerrar aqui não desativa o colaborador, não mexe na conta de acesso e não altera o Perfil de Acesso
              HFM de ninguém.
            </p>
          </DialogBody>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Voltar
          </Button>
          <Button variant="danger" onClick={submit} loading={busy}>
            {cancels ? "Cancelar vínculo" : "Encerrar vínculo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
