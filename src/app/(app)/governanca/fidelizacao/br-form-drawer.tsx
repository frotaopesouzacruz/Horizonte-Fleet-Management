"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import { ScopePicker, type CoverageEntry } from "@/components/governance/scope-picker";
import { saveOperationBr } from "@/lib/governance/actions";

export interface BrFormValue {
  id?: string;
  operationId: string;
  operationCityId: string | null;
  code: string;
  description: string | null;
  notes: string | null;
  updatedAt?: string | null;
}

export interface BrFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value?: BrFormValue;
  operations: { id: string; name: string; status: string }[];
  coverage: CoverageEntry[];
}

/**
 * Cadastro de BR (§33).
 *
 * The city comes from the operation's own coverage, so a BR cannot be saved in
 * a municipality the operation does not cover — the form cannot even offer it,
 * and the database refuses it regardless.
 *
 * The code is typed by hand and is unique only inside organização + operação +
 * cidade. Two operations may both have a "001", and they are different
 * positions; the identity is the row, not the string.
 */
export function BrFormDrawer({ open, onOpenChange, value, operations, coverage }: BrFormDrawerProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [saving, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const blank = React.useCallback(
    (): BrFormValue => ({
      operationId: operations.find((o) => o.status === "active")?.id ?? "",
      operationCityId: null,
      code: "",
      description: null,
      notes: null,
    }),
    [operations],
  );

  // Initialised once, at mount — the parent remounts this drawer on every open.
  const [form, setForm] = React.useState<BrFormValue>(value ?? blank());

  const patch = (next: Partial<BrFormValue>) => setForm((f) => ({ ...f, ...next }));

  const submit = () => {
    setError(null);
    if (!form.operationCityId) return setError("Escolha a operação e a cidade da BR.");
    if (!form.code.trim()) return setError("Informe o código da BR.");

    startTransition(async () => {
      const result = await saveOperationBr({
        id: form.id ?? null,
        operationCityId: form.operationCityId!,
        code: form.code.trim(),
        description: form.description,
        notes: form.notes,
        expectedUpdatedAt: form.updatedAt ?? null,
      });

      if (!result.ok) {
        setError(result.error ?? "Não foi possível salvar a BR.");
        return;
      }
      toast({ title: form.id ? "BR atualizada." : "BR cadastrada.", variant: "success" });
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent size="md">
        <DrawerHeader>
          <DrawerTitle>{form.id ? `Editar BR ${form.code}` : "Nova posição operacional"}</DrawerTitle>
          <DrawerDescription>
            A BR pertence a uma operação e a uma cidade da cobertura dessa operação. O código é o
            que o negócio usa; a identidade no sistema é o registro.
          </DrawerDescription>
        </DrawerHeader>

        <DrawerBody className="flex flex-col gap-4">
          {error ? (
            <Alert variant="danger">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <ScopePicker
            operations={operations}
            coverage={coverage}
            depth="city"
            disabled={Boolean(form.id)}
            value={{
              operationId: form.operationId,
              operationCityId: form.operationCityId,
              operationBrId: null,
            }}
            onChange={(scope) =>
              patch({ operationId: scope.operationId, operationCityId: scope.operationCityId })
            }
          />

          {form.id ? (
            <p className="text-caption text-fg-muted">
              A operação de uma BR não muda depois de criada: todo o histórico de fidelização
              pendurado nela mudaria de significado. Para mover a posição, cadastre uma BR na
              operação de destino.
            </p>
          ) : null}

          <FormField label="Código da BR" required id="br-code">
            <Input
              id="br-code"
              value={form.code}
              maxLength={40}
              autoComplete="off"
              placeholder="Ex.: 001"
              onChange={(e) => patch({ code: e.target.value })}
            />
          </FormField>

          <FormField label="Descrição" id="br-description" labelHint="Opcional">
            <Input
              id="br-description"
              value={form.description ?? ""}
              maxLength={240}
              onChange={(e) => patch({ description: e.target.value || null })}
            />
          </FormField>

          <FormField label="Observações" id="br-notes" labelHint="Opcional">
            <Textarea
              id="br-notes"
              rows={3}
              value={form.notes ?? ""}
              onChange={(e) => patch({ notes: e.target.value || null })}
            />
          </FormField>
        </DrawerBody>

        <DrawerFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            {form.id ? "Salvar alterações" : "Cadastrar BR"}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
