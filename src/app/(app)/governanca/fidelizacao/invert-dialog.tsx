"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight } from "lucide-react";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { DateInput } from "@/components/ui/date-input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import { NativeSelect } from "@/components/governance/selects";
import { invertFidelizationVehicles } from "@/lib/governance/actions";
import type { FidelizationRow } from "@/lib/governance/queries";
import { monthStart, type Competence } from "@/lib/governance/competence";

export interface InvertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Only vínculos currently in force can be inverted. */
  candidates: FidelizationRow[];
  competence: Competence;
}

const label = (row: FidelizationRow) =>
  `BR ${row.brCode} (${row.cityName}) · ${row.fleetCode ?? row.licensePlate ?? "sem identificação"}`;

/**
 * Inverter veículos entre duas BRs (§50).
 *
 * One call and one transaction. Doing it as two substitutions would, between
 * the first and the second, put one vehicle in two positions at once — which
 * the occupancy constraint refuses, so the second half would fail and leave
 * the first half applied. The preview below is what the operation will do, and
 * the server revalidates all of it before committing.
 */
export function InvertDialog({ open, onOpenChange, candidates, competence }: InvertDialogProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, startTransition] = React.useTransition();
  const [a, setA] = React.useState("");
  const [b, setB] = React.useState("");
  const [from, setFrom] = React.useState(monthStart(competence));
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const rowA = candidates.find((c) => c.id === a) ?? null;
  const rowB = candidates.find((c) => c.id === b) ?? null;

  const submit = () => {
    setError(null);
    if (!rowA || !rowB) return setError("Escolha os dois vínculos.");
    if (rowA.operationBrId === rowB.operationBrId) {
      return setError("Os dois vínculos são da mesma BR — não há o que inverter.");
    }
    if (!reason.trim()) return setError("Informe o motivo da inversão.");

    startTransition(async () => {
      const result = await invertFidelizationVehicles({
        assignmentA: rowA.id,
        assignmentB: rowB.id,
        effectiveFrom: from,
        reason: reason.trim(),
      });
      if (result.ok) {
        toast({ title: "Veículos invertidos.", variant: "success" });
        onOpenChange(false);
        router.refresh();
      } else {
        setError(result.error ?? "Não foi possível inverter os veículos.");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Inverter veículos entre BRs</DialogTitle>
          <DialogDescription>
            Os dois vínculos são encerrados na véspera e recriados trocados, numa única transação.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          {error ? (
            <Alert variant="danger">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {candidates.length < 2 ? (
            <Alert variant="info">
              <AlertDescription>
                São necessários pelo menos dois vínculos vigentes na competência para inverter.
              </AlertDescription>
            </Alert>
          ) : null}

          <FormField label="Primeiro vínculo" required id="invert-a">
            <NativeSelect id="invert-a" value={a} onChange={(e) => setA(e.target.value)}>
              <option value="">Selecione</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id} disabled={c.id === b}>
                  {label(c)}
                </option>
              ))}
            </NativeSelect>
          </FormField>

          <FormField label="Segundo vínculo" required id="invert-b">
            <NativeSelect id="invert-b" value={b} onChange={(e) => setB(e.target.value)}>
              <option value="">Selecione</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id} disabled={c.id === a}>
                  {label(c)}
                </option>
              ))}
            </NativeSelect>
          </FormField>

          {rowA && rowB ? (
            <Alert variant="info" icon={<ArrowLeftRight />}>
              <AlertTitle>Prévia</AlertTitle>
              <AlertDescription>
                <p>
                  BR {rowA.brCode} passa a receber{" "}
                  <strong>{rowB.fleetCode ?? rowB.licensePlate ?? "o veículo do segundo vínculo"}</strong>.
                </p>
                <p>
                  BR {rowB.brCode} passa a receber{" "}
                  <strong>{rowA.fleetCode ?? rowA.licensePlate ?? "o veículo do primeiro vínculo"}</strong>.
                </p>
                <p className="mt-1">
                  Os vínculos atuais continuam no histórico — nada é apagado.
                </p>
              </AlertDescription>
            </Alert>
          ) : null}

          <FormField label="Vale a partir de" required id="invert-from">
            <DateInput id="invert-from" value={from} onChange={(e) => setFrom(e.target.value)} />
          </FormField>

          <FormField label="Motivo" required id="invert-reason">
            <Textarea
              id="invert-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Por que os veículos estão sendo trocados de posição?"
            />
          </FormField>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={busy} disabled={!rowA || !rowB}>
            Inverter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
