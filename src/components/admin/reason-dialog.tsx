"use client";

import * as React from "react";
import { ShieldAlert } from "lucide-react";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";

/**
 * ReasonDialog — confirmation for a change that alters what somebody may do.
 *
 * The reason is required, and required by the database too: this dialog exists
 * so the person is asked for it while they still remember why, not so the call
 * can be made to succeed. Six months later the audit trail is the only thing
 * that can answer "why does this person have this access", and an empty field
 * answers nothing.
 */

export interface ReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  /** What exactly will change, in operational terms. */
  description?: React.ReactNode;
  confirmLabel?: string;
  /** Resolves when the change has been applied; a rejection keeps the dialog open. */
  onConfirm: (reason: string) => void | Promise<void>;
  /** Helper under the field, e.g. the ticket or the approval this follows. */
  hint?: React.ReactNode;
  loading?: boolean;
}

const MIN_REASON = 3;

export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirmar alteração",
  onConfirm,
  hint = "Fica registrado na auditoria junto com o perfil anterior, o novo e quem alterou.",
  loading = false,
}: ReasonDialogProps) {
  const [reason, setReason] = React.useState("");
  const [touched, setTouched] = React.useState(false);

  // Each opening starts clean: a reason typed for one change must never be
  // submitted for the next one.
  const [wasOpen, setWasOpen] = React.useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setReason("");
      setTouched(false);
    }
  }

  const trimmed = reason.trim();
  const invalid = trimmed.length < MIN_REASON;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      loading={loading}
      icon={<ShieldAlert aria-hidden />}
      // Disabled rather than rejected: the confirm button simply does not act
      // until there is a reason, so an empty field never reaches the database
      // and never produces an error anybody has to read.
      confirmDisabled={invalid}
      onConfirm={() => onConfirm(trimmed)}
    >
      <FormField
        label="Motivo da alteração"
        required
        error={touched && invalid ? "Descreva o motivo em pelo menos 3 caracteres." : undefined}
        helperText={hint}
      >
        <Textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          onBlur={() => setTouched(true)}
          rows={3}
          maxLength={500}
          placeholder="Ex.: promoção a líder da operação Last Mille MG, aprovada por Gente em 12/03."
        />
      </FormField>
    </ConfirmDialog>
  );
}
