"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CopyCheck } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import { CompetencePicker } from "@/components/governance/competence-picker";
import { NativeSelect } from "@/components/governance/selects";
import { replicateLeadershipCompetence, type ReplicationPreview } from "@/lib/governance/actions";
import { formatCompetence, type Competence } from "@/lib/governance/competence";

export interface ReplicateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  competence: Competence;
  operations: { id: string; name: string; status: string }[];
}

/**
 * Replicar competência (§23 and §24).
 *
 * The preview and the execution are the same routine, called twice: once with
 * `dryRun` and once without. A separate "count what would happen" query is a
 * second implementation of the same rule, and the day the two disagree the
 * person confirms one thing and gets another.
 *
 * The default is to preserve: a scope that already has a responsible person in
 * the destination month is left exactly as it is, and only the missing ones
 * are copied. Replacing is a second, explicit decision.
 */
export function ReplicateDialog({ open, onOpenChange, competence, operations }: ReplicateDialogProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [running, startTransition] = React.useTransition();

  const nextMonth = React.useMemo(() => {
    const index = competence.year * 12 + competence.month; // already +1
    return { year: Math.floor(index / 12), month: (index % 12) + 1 };
  }, [competence]);

  const [from, setFrom] = React.useState<Competence>(competence);
  const [to, setTo] = React.useState<Competence>(nextMonth);
  const [operationId, setOperationId] = React.useState("");
  const [overwrite, setOverwrite] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // The preview carries the inputs it was computed for. Comparing them is what
  // invalidates it when something changes — confirming a count computed for
  // different months is exactly the bug the preview exists to prevent, and
  // deriving it beats clearing it from an effect that would fire on every edit.
  const [computed, setComputed] = React.useState<
    { key: string; data: ReplicationPreview } | null
  >(null);
  const inputKey = `${from.year}-${from.month}|${to.year}-${to.month}|${operationId}|${overwrite}`;
  const preview = computed?.key === inputKey ? computed.data : null;
  const setPreview = (data: ReplicationPreview | null) =>
    setComputed(data ? { key: inputKey, data } : null);

  const run = (dryRun: boolean) => {
    setError(null);
    startTransition(async () => {
      const result = await replicateLeadershipCompetence({
        from,
        to,
        operationId: operationId || null,
        overwrite,
        dryRun,
      });

      if (!result.ok) {
        setError(result.error ?? "Não foi possível replicar.");
        return;
      }

      if (dryRun) {
        setPreview(result.data ?? null);
        return;
      }

      const d = result.data;
      toast({
        title: `Replicação concluída: ${d?.created ?? 0} criados, ${d?.preserved ?? 0} preservados, ${d?.replaced ?? 0} substituídos.`,
        variant: "success",
      });
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Replicar competência</DialogTitle>
          <DialogDescription>
            Copia o planejamento de lideranças de uma competência para outra. Por padrão nada do
            destino é sobrescrito — só os escopos ainda sem responsável são criados.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          {error ? (
            <Alert variant="danger">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
            <FormField label="Origem" id="replicate-from">
              <CompetencePicker value={from} onChange={setFrom} disabled={running} />
            </FormField>
            <ArrowRight aria-hidden className="mb-2.5 hidden size-4 shrink-0 text-fg-muted sm:block" />
            <FormField label="Destino" id="replicate-to">
              <CompetencePicker value={to} onChange={setTo} disabled={running} />
            </FormField>
          </div>

          <FormField
            label="Operação"
            id="replicate-operation"
            labelHint="Opcional"
            helperText="Em branco, replica todas as operações do seu escopo."
          >
            <NativeSelect
              id="replicate-operation"
              value={operationId}
              disabled={running}
              onChange={(e) => setOperationId(e.target.value)}
            >
              <option value="">Todas as operações</option>
              {operations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>

          <label className="flex items-start gap-2.5 rounded-md border border-border bg-surface p-3">
            <Checkbox
              checked={overwrite}
              disabled={running}
              onCheckedChange={(checked) => setOverwrite(checked === true)}
            />
            <span className="text-body-sm">
              <span className="block font-medium text-fg">Substituir responsáveis do destino</span>
              <span className="block text-caption text-fg-muted">
                Encerra a responsabilidade que já existe na competência de destino e cria a da
                origem no lugar. Nada é apagado: o vínculo anterior continua no histórico.
              </span>
            </span>
          </label>

          {preview ? (
            <Alert variant={preview.replaced > 0 ? "warning" : "info"} icon={<CopyCheck />}>
              <AlertTitle>
                Prévia de {formatCompetence(from)} para {formatCompetence(to)}
              </AlertTitle>
              <AlertDescription>
                <ul className="space-y-0.5">
                  <li>
                    <strong>{preview.created}</strong> vínculo(s) serão criados.
                  </li>
                  <li>
                    <strong>{preview.preserved}</strong> já existem no destino e serão preservados.
                  </li>
                  <li>
                    <strong>{preview.replaced}</strong> serão substituídos.
                  </li>
                </ul>
                {preview.created === 0 && preview.replaced === 0 ? (
                  <p className="mt-2">
                    Nada a fazer: o destino já reflete a origem. Executar de novo não muda nada.
                  </p>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={running}>
            Cancelar
          </Button>
          {preview ? (
            <Button
              onClick={() => run(false)}
              loading={running}
              disabled={preview.created === 0 && preview.replaced === 0}
            >
              Confirmar replicação
            </Button>
          ) : (
            <Button onClick={() => run(true)} loading={running}>
              Ver prévia
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
