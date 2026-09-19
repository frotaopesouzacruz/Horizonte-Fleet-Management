"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { saveOperation, type CoverageInput } from "@/lib/organization/actions";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import {
  OperationGeographyPicker,
  type PickerState,
} from "@/components/organization/operation-geography-picker";

export interface OperationFormValue {
  id?: string;
  code?: string | null;
  name: string;
  description: string | null;
  status: "active" | "inactive";
  coverage: CoverageInput[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Absent for a new operation. */
  operation?: OperationFormValue;
  states: PickerState[];
}

/**
 * Dados gerais and geographic coverage in one form, saved in one call.
 *
 * They belong together: the rule that an active operation must cover at least
 * one municipality in every state it claims is checked at save time, so letting
 * the two halves be saved separately would mean letting an operation exist in a
 * state the rule forbids.
 */
export function OperationFormDrawer({ open, onOpenChange, operation, states }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();

  const isEdit = Boolean(operation?.id);
  const [name, setName] = React.useState(operation?.name ?? "");
  const [description, setDescription] = React.useState(operation?.description ?? "");
  const [status, setStatus] = React.useState<"active" | "inactive">(operation?.status ?? "active");
  const [coverage, setCoverage] = React.useState<CoverageInput[]>(operation?.coverage ?? []);
  const [error, setError] = React.useState<string | null>(null);
  const [touched, setTouched] = React.useState(false);

  // The drawer is mounted once and reused, so the form follows whichever
  // operation it was opened for instead of keeping the previous one's values.
  const [loaded, setLoaded] = React.useState<string | null>(null);
  const key = open ? (operation?.id ?? "__new__") : null;
  if (key !== loaded) {
    setLoaded(key);
    setName(operation?.name ?? "");
    setDescription(operation?.description ?? "");
    setStatus(operation?.status ?? "active");
    setCoverage(operation?.coverage ?? []);
    setError(null);
    setTouched(false);
  }

  const nameError = touched && name.trim().length === 0 ? "Informe o nome da operação." : undefined;

  const submit = () => {
    setTouched(true);
    if (name.trim().length === 0) return;

    startTransition(async () => {
      const result = await saveOperation({
        id: operation?.id ?? null,
        name: name.trim(),
        description: description.trim() || null,
        status,
        coverage,
      });

      if (result.ok) {
        toast({ title: isEdit ? "Operação atualizada." : "Operação criada.", variant: "success" });
        onOpenChange(false);
        router.refresh();
      } else {
        setError(result.error ?? "Não foi possível salvar a operação.");
      }
    });
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent side="right" size="xl">
        <DrawerHeader>
          <DrawerTitle>
            {isEdit ? "Editar operação" : "Nova operação"}
            {operation?.code ? (
              <span className="ml-2 font-mono text-body-sm font-normal text-fg-muted">{operation.code}</span>
            ) : null}
          </DrawerTitle>
        </DrawerHeader>

        <DrawerBody className="flex flex-col gap-6">
          {error ? (
            <Alert variant="danger">
              <AlertTitle>Não foi possível salvar</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <section className="flex flex-col gap-4">
            <h3 className="text-h4 font-semibold text-fg">Dados gerais</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Nome da operação" required error={nameError} className="sm:col-span-2">
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Last Mile MG"
                  maxLength={160}
                />
              </FormField>

              <FormField
                label="Código"
                className="sm:col-span-1"
                helperText={isEdit ? "Gerado pelo sistema e imutável." : "Gerado automaticamente ao salvar."}
              >
                <Input value={operation?.code ?? "—"} readOnly disabled />
              </FormField>

              <FormField label="Situação">
                <Select value={status} onValueChange={(value) => setStatus(value as "active" | "inactive")}>
                  <SelectTrigger aria-label="Situação da operação">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Ativa</SelectItem>
                    <SelectItem value="inactive">Inativa</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>

              <FormField label="Descrição" className="sm:col-span-2">
                <Textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="O que esta operação faz."
                  maxLength={500}
                  rows={2}
                />
              </FormField>
            </div>
          </section>

          <section className="flex flex-col gap-3 border-t border-border pt-5">
            <div>
              <h3 className="text-h4 font-semibold text-fg">Cobertura geográfica</h3>
              <p className="mt-1 text-body-sm text-fg-secondary">
                Uma operação ativa precisa de ao menos um estado, e cada estado de ao menos um município.
              </p>
            </div>
            <OperationGeographyPicker
              value={coverage}
              onChange={setCoverage}
              states={states}
              disabled={pending}
            />
          </section>
        </DrawerBody>

        <DrawerFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={pending}>
            {isEdit ? "Salvar alterações" : "Criar operação"}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
