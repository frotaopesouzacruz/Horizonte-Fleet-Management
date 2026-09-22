"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Truck, UserRound } from "lucide-react";
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
import { EmployeePicker } from "@/components/governance/employee-picker";
import { substituteFidelizationDriver, type EmployeeOption } from "@/lib/governance/actions";
import type { DriverPlanRow } from "@/lib/governance/queries";

function formatDate(value: string | null): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  return d ? `${d}/${m}/${y}` : value;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Um vínculo de motorista que já terminou ou foi cancelado não tem o que
 * substituir: a substituição fecha o atual na véspera, e não há véspera para
 * fechar num vínculo encerrado.
 */
export function canSubstituteDriver(row: DriverPlanRow, today = todayIso()): boolean {
  if (row.status === "cancelled") return false;
  if (row.endDate && row.endDate < today) return false;
  return true;
}

export interface DriverSubstituteDialogProps {
  row: DriverPlanRow | null;
  onClose: () => void;
}

/**
 * Substituir motorista (§34/§35).
 *
 * Uma só transação no servidor: o motorista que sai é fechado na véspera (ou
 * cancelado, se ainda não começou) e o que entra abre no mesmo vínculo de
 * veículo. Fazer isso como "encerrar" e depois "vincular" deixaria, entre os
 * dois cliques, uma posição sem motorista — ou, se o segundo falhasse, o
 * primeiro aplicado sozinho. O motivo é obrigatório porque um mês depois é a
 * única coisa que alguém pergunta sobre a troca.
 */
export function DriverSubstituteDialog({ row, onClose }: DriverSubstituteDialogProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, startTransition] = React.useTransition();

  // O vínculo pode ter começado no futuro: "a partir de" nunca antecede o
  // início do vínculo que está sendo substituído.
  const minDate = row?.startDate ?? todayIso();
  const [employee, setEmployee] = React.useState<EmployeeOption | null>(null);
  const [effectiveFrom, setEffectiveFrom] = React.useState(() =>
    todayIso() < minDate ? minDate : todayIso(),
  );
  const [endDate, setEndDate] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const submit = () => {
    setError(null);
    if (!row) return;
    if (!employee) return setError("Escolha o motorista que entra.");
    if (employee.id === row.employeeId) return setError("O motorista escolhido já é o motorista atual.");
    if (!effectiveFrom) return setError("Informe a data a partir da qual a substituição vale.");
    if (effectiveFrom < row.startDate) {
      return setError(`A substituição não pode ser anterior ao início do vínculo (${formatDate(row.startDate)}).`);
    }
    if (endDate && endDate < effectiveFrom) return setError("A data final não pode ser anterior ao início.");
    if (!reason.trim()) return setError("Informe o motivo da substituição.");

    startTransition(async () => {
      const result = await substituteFidelizationDriver({
        driverId: row.id,
        newEmployeeId: employee.id,
        effectiveFrom,
        endDate: endDate || null,
        reason: reason.trim(),
      });
      if (result.ok) {
        toast({ title: "Motorista substituído.", variant: "success" });
        onClose();
        router.refresh();
      } else {
        setError(result.error ?? "Não foi possível substituir o motorista.");
      }
    });
  };

  return (
    <Dialog open={Boolean(row)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Substituir motorista</DialogTitle>
          <DialogDescription>
            O motorista atual é encerrado na véspera e o novo entra no mesmo vínculo de veículo, em
            uma só operação. Nada é apagado: o vínculo anterior continua no histórico.
          </DialogDescription>
        </DialogHeader>

        {row ? (
          <DialogBody className="flex flex-col gap-4">
            {error ? (
              <Alert variant="danger">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3">
              <div className="flex items-start gap-2.5">
                <UserRound aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body-sm font-medium text-fg">{row.employeeName}</p>
                  <p className="text-caption text-fg-muted">
                    {row.employeeCode ? `Matrícula ${row.employeeCode} · ` : ""}
                    {formatDate(row.startDate)} — {row.endDate ? formatDate(row.endDate) : "em aberto"}
                  </p>
                </div>
                <Badge variant={row.driverRole === "primary" ? "primary" : "neutral"} appearance="soft" size="sm">
                  {row.driverRole === "primary" ? "Principal" : "Secundário"}
                </Badge>
              </div>
              <div className="flex items-start gap-2.5">
                <Truck aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body-sm text-fg">
                    BR {row.brCode}
                    <span className="text-fg-muted">
                      {" "}· {row.cityName}/{row.stateUf} · {row.operationName}
                    </span>
                  </p>
                  <p className="text-caption text-fg-muted">
                    Veículo {row.fleetCode ?? row.licensePlate ?? "—"}
                    {row.fleetCode && row.licensePlate && row.fleetCode !== row.licensePlate
                      ? ` · ${row.licensePlate}`
                      : ""}
                  </p>
                </div>
              </div>
            </div>

            <FormField label="Novo motorista" required id="substitute-driver-employee">
              <EmployeePicker
                id="substitute-driver-employee"
                value={employee}
                onChange={setEmployee}
                disabled={busy}
              />
            </FormField>

            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="A partir de" required id="substitute-driver-from">
                <DateInput
                  id="substitute-driver-from"
                  value={effectiveFrom}
                  min={minDate}
                  disabled={busy}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                />
              </FormField>
              <FormField
                label="Até"
                id="substitute-driver-until"
                labelHint="Opcional"
                helperText="Em branco, herda o fim do motorista que sai ou, se não houver, o do vínculo do veículo."
              >
                <DateInput
                  id="substitute-driver-until"
                  value={endDate}
                  min={effectiveFrom || minDate}
                  disabled={busy}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </FormField>
            </div>

            <FormField label="Motivo" required id="substitute-driver-reason">
              <Textarea
                id="substitute-driver-reason"
                rows={2}
                value={reason}
                disabled={busy}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Por que o motorista está sendo trocado?"
              />
            </FormField>

            <p className="text-caption text-fg-muted">
              Substituir aqui não cria colaborador, não cria conta de acesso e não altera o Perfil de
              Acesso HFM de ninguém.
            </p>
          </DialogBody>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={busy}>
            Substituir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
