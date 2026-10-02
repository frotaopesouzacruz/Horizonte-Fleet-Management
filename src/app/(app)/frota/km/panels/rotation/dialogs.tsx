"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCaption, TableCell, TableContainer, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { LoadingState } from "@/components/feedback/loading-state";
import type { KmRotationItem, KmRotationPlan } from "@/lib/km/rotation";
import {
  applyFidelization,
  fidelizationPreview,
  setItem,
  setPlanStatus,
  updatePlan,
  type FidelizationPreview,
  type FidelizationPreviewSide,
  type Result,
} from "@/lib/km/rotation-actions";
import { formatDate } from "@/lib/km/types";
import { pad2, pairText, plural } from "./format";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MIN_REASON = 5;

// ---------------------------------------------------------------------------
// Diálogo de ação: confirma, mostra o erro do banco e só fecha no sucesso
// ---------------------------------------------------------------------------
export function ActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  confirmDisabled,
  onConfirm,
  children,
  size = "md",
  testId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  confirmDisabled?: boolean;
  /** Devolve a mensagem de erro (o diálogo fica aberto) ou null (fecha). */
  onConfirm: () => Promise<string | null>;
  children?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  testId?: string;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (busy || confirmDisabled) return;
    setBusy(true);
    setError(null);
    const err = await onConfirm();
    setBusy(false);
    if (err) setError(err);
    else onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy && !next) return;
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent size={size} data-testid={testId}>
        <form onSubmit={confirm} className="flex min-h-0 flex-1 flex-col" noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          {children || error ? (
            <DialogBody className="flex flex-col gap-4">
              {children}
              {error ? (
                <Alert variant="danger">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
            </DialogBody>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Voltar
            </Button>
            <Button
              type="submit"
              variant={destructive ? "danger" : "primary"}
              loading={busy}
              disabled={confirmDisabled}
              data-testid={testId ? `${testId}-confirm` : undefined}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const fail = <T,>(res: Result<T>, fallback: string) => (res.ok ? null : (res.error ?? fallback));

// ---------------------------------------------------------------------------
// Transições do rodízio (cada uma com a permissão e a validação do banco)
// ---------------------------------------------------------------------------
export type ItemAction = "approve" | "back_suggested" | "back_approved" | "schedule" | "execute" | "cancel";

export const ITEM_ACTION_LABEL: Record<ItemAction, string> = {
  approve: "Aprovar",
  back_suggested: "Voltar a sugerido",
  back_approved: "Voltar a aprovado",
  schedule: "Programar",
  execute: "Executar",
  cancel: "Cancelar rodízio",
};

export function ItemActionDialog({
  item,
  action,
  today,
  onClose,
  onDone,
}: {
  item: KmRotationItem;
  action: ItemAction;
  today: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const pair = pairText(item.snapshot?.vehicleA, item.snapshot?.vehicleB);
  const ref = `rodízio ${pad2(item.itemNumber)} (${pair})`;
  const [date, setDate] = React.useState(
    action === "execute" ? (item.effectiveDate && item.effectiveDate <= today ? item.effectiveDate : today) : (item.effectiveDate ?? ""),
  );
  const [reason, setReason] = React.useState("");

  const needsDate = action === "schedule" || action === "execute";
  const dateError =
    needsDate && date && !ISO.test(date)
      ? "Data inválida."
      : action === "execute" && date > today
        ? "A data de execução não pode estar no futuro."
        : null;
  const reasonOk = reason.trim().length >= MIN_REASON;

  const copy: Record<ItemAction, { title: string; description: string; done: string }> = {
    approve: {
      title: `Aprovar o ${ref}?`,
      description: "O rodízio passa para Aprovado. Nada é movimentado: a troca ainda precisa ser programada e executada em campo.",
      done: "Rodízio aprovado.",
    },
    back_suggested: {
      title: `Voltar o ${ref} a Sugerido?`,
      description: "A aprovação é desfeita; o rodízio volta a aguardar decisão.",
      done: "Rodízio voltou a Sugerido.",
    },
    back_approved: {
      title: `Voltar o ${ref} a Aprovado?`,
      description: "A programação é desfeita; a data prevista continua registrada.",
      done: "Rodízio voltou a Aprovado.",
    },
    schedule: {
      title: `Programar o ${ref}`,
      description: "Informe a data prevista da troca. Programar não movimenta as frotas nem altera a Fidelização.",
      done: "Rodízio programado.",
    },
    execute: {
      title: `Registrar a execução do ${ref}`,
      description:
        "Registre a troca feita em campo. Os hodômetros das duas frotas na data viram a base da avaliação pós-rodízio. A Fidelização não é alterada por esta ação.",
      done: "Execução registrada.",
    },
    cancel: {
      title: `Cancelar o ${ref}?`,
      description: "O rodízio sai do plano ativo e fica registrado como Cancelado, com o motivo. Nenhuma frota é alterada.",
      done: "Rodízio cancelado.",
    },
  };

  async function run(): Promise<string | null> {
    const payload =
      action === "approve"
        ? { status: "approved" as const }
        : action === "back_suggested"
          ? { status: "suggested" as const }
          : action === "back_approved"
            ? { status: "approved" as const }
            : action === "schedule"
              ? { status: "scheduled" as const, ...(date !== item.effectiveDate ? { effective_date: date } : {}) }
              : action === "execute"
                ? { status: "executed" as const, execution_date: date }
                : { status: "cancelled" as const, reason: reason.trim() };
    const res = await setItem(item.id, payload);
    const err = fail(res, "Não foi possível atualizar o rodízio.");
    if (!err) onDone(copy[action].done);
    return err;
  }

  return (
    <ActionDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={copy[action].title}
      description={copy[action].description}
      confirmLabel={ITEM_ACTION_LABEL[action]}
      destructive={action === "cancel"}
      confirmDisabled={(needsDate && (!date || Boolean(dateError))) || (action === "cancel" && !reasonOk)}
      onConfirm={run}
      testId={`km-rodizio-item-dialog-${action}`}
    >
      {needsDate ? (
        <FormField
          label={action === "schedule" ? "Data prevista" : "Data da execução"}
          required
          error={dateError}
          helperText={action === "execute" ? "Padrão: a data prevista (ou hoje, se ela ainda não chegou)." : undefined}
        >
          <DateInput
            value={date}
            max={action === "execute" ? today : undefined}
            onChange={(e) => setDate(e.target.value)}
            data-testid="km-rodizio-item-dialog-date"
          />
        </FormField>
      ) : null}
      {action === "cancel" ? (
        <FormField
          label="Motivo do cancelamento"
          required
          helperText={`Mínimo de ${MIN_REASON} caracteres. Fica na trilha do plano.`}
        >
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} data-testid="km-rodizio-item-dialog-reason" />
        </FormField>
      ) : null}
    </ActionDialog>
  );
}

// ---------------------------------------------------------------------------
// Plano: editar, aprovar sugeridos, cancelar
// ---------------------------------------------------------------------------
export function EditPlanDialog({
  plan,
  open,
  onOpenChange,
  onDone,
}: {
  plan: KmRotationPlan;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (message: string) => void;
}) {
  const [name, setName] = React.useState(plan.name);
  const [notes, setNotes] = React.useState(plan.notes ?? "");
  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Editar o plano ${plan.code}`}
      description="Nome e observação operacional. Os rodízios e os números não mudam."
      confirmLabel="Salvar"
      confirmDisabled={!name.trim()}
      onConfirm={async () => {
        const err = fail(await updatePlan(plan.id, { name: name.trim(), notes: notes.trim() || null }), "Não foi possível salvar o plano.");
        if (!err) onDone("Plano atualizado.");
        return err;
      }}
      testId="km-rodizio-plan-edit"
    >
      <FormField label="Nome do plano" required>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} />
      </FormField>
      <FormField label="Observação operacional" labelHint="Opcional">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} maxLength={2000} />
      </FormField>
    </ActionDialog>
  );
}

export function PlanStatusDialog({
  plan,
  status,
  count,
  onClose,
  onDone,
}: {
  plan: KmRotationPlan;
  status: "approved" | "cancelled";
  /** Rodízios afetados (sugeridos para aprovar; não executados para cancelar). */
  count: number;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [reason, setReason] = React.useState("");
  const approving = status === "approved";
  return (
    <ActionDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={approving ? `Aprovar ${plural(count, "rodízio sugerido", "rodízios sugeridos")}?` : `Cancelar o plano ${plan.code}?`}
      description={
        approving
          ? "Todos os rodízios Sugeridos deste plano passam para Aprovado. Nada é movimentado: cada troca ainda precisa ser programada e executada."
          : `${plural(count, "rodízio não executado passa", "rodízios não executados passam")} para Cancelado. Os executados permanecem como estão. Nenhuma frota, fidelização ou histórico de KM é alterado.`
      }
      confirmLabel={approving ? "Aprovar sugeridos" : "Cancelar plano"}
      destructive={!approving}
      confirmDisabled={!approving && reason.trim().length < MIN_REASON}
      onConfirm={async () => {
        const res = await setPlanStatus(plan.id, status, approving ? null : reason.trim());
        const err = fail(res, approving ? "Não foi possível aprovar." : "Não foi possível cancelar o plano.");
        if (!err) {
          const n = res.data?.items ?? count;
          onDone(approving ? `${plural(n, "rodízio aprovado", "rodízios aprovados")}.` : `Plano cancelado · ${plural(n, "rodízio cancelado", "rodízios cancelados")}.`);
        }
        return err;
      }}
      testId={approving ? "km-rodizio-plan-approve" : "km-rodizio-plan-cancel"}
    >
      {!approving ? (
        <FormField label="Motivo do cancelamento" required helperText={`Mínimo de ${MIN_REASON} caracteres. Fica na trilha do plano.`}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} data-testid="km-rodizio-plan-cancel-reason" />
        </FormField>
      ) : null}
    </ActionDialog>
  );
}

// ---------------------------------------------------------------------------
// Aplicar na Fidelização: prévia, data de vigência, motivo e confirmação
// ---------------------------------------------------------------------------
const ROLE: Record<string, string> = { primary: "Titular", support: "Apoio" };

export function FidelizationDialog({
  item,
  plan,
  today,
  onClose,
  onDone,
}: {
  item: KmRotationItem;
  plan: KmRotationPlan;
  today: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [date, setDate] = React.useState(item.effectiveDate ?? item.executionDate ?? today);
  const [reason, setReason] = React.useState("");
  const [confirmed, setConfirmed] = React.useState(false);
  const [loaded, setLoaded] = React.useState<{ date: string; res: Result<FidelizationPreview> } | null>(null);
  const valid = ISO.test(date);

  // A prévia acompanha a data: cada data válida pede a sua à rotina.
  React.useEffect(() => {
    if (!ISO.test(date)) return;
    let alive = true;
    fidelizationPreview(item.id, date).then((res) => {
      if (alive) setLoaded({ date, res });
    });
    return () => {
      alive = false;
    };
  }, [item.id, date]);

  const current = loaded && loaded.date === date ? loaded.res : null;
  const loading = valid && !current;
  const preview = current?.ok ? (current.data ?? null) : null;
  const pair = pairText(item.snapshot?.vehicleA, item.snapshot?.vehicleB);
  const canApply = Boolean(preview?.canApply) && confirmed && valid;

  return (
    <ActionDialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={`Aplicar na Fidelização — rodízio ${pad2(item.itemNumber)} (${pair})`}
      description="Inverte as frotas entre as duas BRs pela rotina oficial da Fidelização, numa transação, com trilha. Confira a prévia antes de confirmar."
      confirmLabel="Aplicar na Fidelização"
      confirmDisabled={!canApply}
      onConfirm={async () => {
        const res = await applyFidelization(item.id, { effective_date: date, reason: reason.trim() || null, confirm: true });
        const err = fail(res, "Não foi possível aplicar o rodízio na Fidelização.");
        if (!err) onDone(`Rodízio aplicado na Fidelização com vigência a partir de ${formatDate(date)}.`);
        return err;
      }}
      testId="km-rodizio-fidelization"
    >
      <FormField label="Vigência a partir de" required error={date && !valid ? "Data inválida." : undefined}>
        <DateInput
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setConfirmed(false);
          }}
          data-testid="km-rodizio-fidelization-date"
        />
      </FormField>

      {loading ? (
        <LoadingState label="Montando a prévia…" />
      ) : current && !current.ok ? (
        <Alert variant="danger">
          <AlertDescription>{current.error}</AlertDescription>
        </Alert>
      ) : preview ? (
        <div className="flex flex-col gap-3" data-testid="km-rodizio-fidelization-preview">
          <TableContainer>
            <Table className="min-w-[36rem]">
              <TableCaption className="sr-only">Vínculos de fidelização vigentes na data</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Frota</TableHead>
                  <TableHead>BR</TableHead>
                  <TableHead>Operação</TableHead>
                  <TableHead>Local</TableHead>
                  <TableHead>Vigência</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <PreviewRow side={preview.vehicleA} />
                <PreviewRow side={preview.vehicleB} />
              </TableBody>
            </Table>
          </TableContainer>

          {preview.result && preview.result.length > 0 ? (
            <Alert variant="info">
              <AlertTitle>O que vai acontecer</AlertTitle>
              <AlertDescription>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {preview.result.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          {preview.errors.length > 0 ? (
            <Alert variant="danger" data-testid="km-rodizio-fidelization-errors">
              <AlertTitle>Não é possível aplicar</AlertTitle>
              <AlertDescription>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {preview.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          {preview.requiresFidelizationPermission ? (
            <Alert variant="warning">
              <AlertTitle>Falta a permissão da Fidelização</AlertTitle>
              <AlertDescription>
                Aplicar exige também a permissão de alterar veículos na Fidelização, nas duas BRs. Peça a quem tem essa
                permissão para concluir.
              </AlertDescription>
            </Alert>
          ) : null}

          <FormField
            label="Motivo"
            labelHint="Opcional"
            helperText={`Sem motivo, a trilha registra “Rodízio de KM ${plan.code} · item ${item.itemNumber} (${pair})”.`}
          >
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} />
          </FormField>

          <CheckboxField
            label="Confirmo a alteração na Fidelização"
            description="Os vínculos atuais (e os motoristas vinculados) são encerrados no dia anterior e os novos começam na data informada."
            checked={confirmed}
            disabled={!preview.canApply}
            onCheckedChange={(v) => setConfirmed(v === true)}
            data-testid="km-rodizio-fidelization-confirm"
          />
        </div>
      ) : null}
    </ActionDialog>
  );
}

function PreviewRow({ side }: { side: FidelizationPreviewSide }) {
  return (
    <TableRow>
      <TableHead scope="row" className="font-medium text-fg">
        {side.plate ?? "—"}
        {side.role ? <span className="block text-caption font-normal text-fg-muted">{ROLE[side.role] ?? side.role}</span> : null}
      </TableHead>
      {side.assignmentId ? (
        <>
          <TableCell>{side.br ?? "—"}</TableCell>
          <TableCell>{side.operation ?? "—"}</TableCell>
          <TableCell>{side.local ?? "—"}</TableCell>
          <TableCell className="whitespace-nowrap">
            {formatDate(side.startDate)} a {side.endDate ? formatDate(side.endDate) : "sem fim"}
          </TableCell>
        </>
      ) : (
        <TableCell colSpan={4} className="text-fg-muted">
          Sem vínculo de fidelização vigente na data.
        </TableCell>
      )}
    </TableRow>
  );
}
