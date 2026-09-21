"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { DateInput } from "@/components/ui/date-input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import { NativeSelect } from "@/components/governance/selects";
import { EmployeePicker } from "@/components/governance/employee-picker";
import { ScopePicker, type BrEntry, type CoverageEntry } from "@/components/governance/scope-picker";
import { saveLeadership, type EmployeeOption } from "@/lib/governance/actions";
import { monthStart, monthEnd, type Competence } from "@/lib/governance/competence";

export interface LeadershipFormValue {
  id?: string;
  employee: EmployeeOption | null;
  scopeLevel: "operation" | "city" | "br";
  operationId: string;
  operationCityId: string | null;
  operationBrId: string | null;
  responsibilityType: "principal" | "substitute" | "support";
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
  updatedAt?: string | null;
}

export interface LeadershipFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value?: LeadershipFormValue;
  competence: Competence;
  operations: { id: string; name: string; status: string }[];
  coverage: CoverageEntry[];
  brs: BrEntry[];
}

const SCOPE_LABELS: Record<LeadershipFormValue["scopeLevel"], string> = {
  operation: "Operação inteira",
  city: "Cidade",
  br: "BR (posição operacional)",
};

const RESPONSIBILITY_LABELS: Record<LeadershipFormValue["responsibilityType"], string> = {
  principal: "Responsável principal",
  substitute: "Responsável substituto",
  support: "Responsável de apoio",
};

/**
 * Creating and editing a responsibility.
 *
 * Two things this form deliberately does not do, because §12 and §27 say so
 * and because they are the mistakes the old system made: it does not offer to
 * change the person's access profile, and it does not offer to change who
 * their line manager is. Neither belongs to an operational responsibility, and
 * neither is reachable from here.
 */
export function LeadershipFormDrawer({
  open,
  onOpenChange,
  value,
  competence,
  operations,
  coverage,
  brs,
}: LeadershipFormDrawerProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [saving, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [warnings, setWarnings] = React.useState<string[]>([]);

  const blank = React.useCallback(
    (): LeadershipFormValue => ({
      employee: null,
      scopeLevel: "operation",
      operationId: operations.find((o) => o.status === "active")?.id ?? "",
      operationCityId: null,
      operationBrId: null,
      responsibilityType: "principal",
      // A new responsibility defaults to the competence being planned, which
      // is what someone opening the form from a month's screen means.
      effectiveFrom: monthStart(competence),
      effectiveTo: monthEnd(competence),
      notes: null,
    }),
    [competence, operations],
  );

  // Initialised once, at mount. The parent remounts this drawer on every open
  // (see the `key` it passes), so there is nothing to reset and no effect that
  // could fire a cascading render.
  const [form, setForm] = React.useState<LeadershipFormValue>(value ?? blank());

  const patch = (next: Partial<LeadershipFormValue>) => setForm((f) => ({ ...f, ...next }));

  const submit = () => {
    setError(null);
    setWarnings([]);

    if (!form.employee) return setError("Escolha o colaborador responsável.");
    if (!form.operationId) return setError("Escolha a operação.");
    if (form.scopeLevel !== "operation" && !form.operationCityId) {
      return setError("Escolha a cidade da responsabilidade.");
    }
    if (form.scopeLevel === "br" && !form.operationBrId) {
      return setError("Escolha a BR da responsabilidade.");
    }
    if (!form.effectiveFrom) return setError("Informe a data de início.");

    startTransition(async () => {
      const result = await saveLeadership({
        id: form.id ?? null,
        employeeId: form.employee!.id,
        scopeLevel: form.scopeLevel,
        operationId: form.operationId,
        operationCityId: form.scopeLevel === "operation" ? null : form.operationCityId,
        operationBrId: form.scopeLevel === "br" ? form.operationBrId : null,
        responsibilityType: form.responsibilityType,
        effectiveFrom: form.effectiveFrom,
        effectiveTo: form.effectiveTo,
        notes: form.notes,
        expectedUpdatedAt: form.updatedAt ?? null,
      });

      if (!result.ok) {
        setError(result.error ?? "Não foi possível salvar.");
        return;
      }

      // §19: a warning is not a refusal. The save happened; the person is told
      // what the system noticed about it and decides what to do next.
      if (result.warnings?.length) {
        setWarnings(result.warnings);
        toast({ title: "Vínculo salvo com observações.", variant: "warning" });
      } else {
        toast({ title: "Vínculo de liderança salvo.", variant: "success" });
        onOpenChange(false);
      }
      router.refresh();
    });
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent size="lg">
        <DrawerHeader>
          <DrawerTitle>{form.id ? "Editar responsabilidade" : "Novo vínculo de liderança"}</DrawerTitle>
          <DrawerDescription>
            A designação registra quem responde pelo escopo operacional. Ela não altera o Perfil de
            Acesso do colaborador no HFM nem o seu líder imediato.
          </DrawerDescription>
        </DrawerHeader>

        <DrawerBody className="flex flex-col gap-4">
          {error ? (
            <Alert variant="danger">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {warnings.length > 0 ? (
            <Alert variant="warning" icon={<AlertTriangle />}>
              <AlertTitle>Salvo, com observações</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-4">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          <FormField label="Colaborador" required id="leadership-employee">
            <EmployeePicker
              id="leadership-employee"
              value={form.employee}
              onChange={(employee) => patch({ employee })}
            />
          </FormField>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Nível de responsabilidade" required id="leadership-scope">
              <NativeSelect
                id="leadership-scope"
                value={form.scopeLevel}
                onChange={(e) => {
                  const scopeLevel = e.target.value as LeadershipFormValue["scopeLevel"];
                  patch({
                    scopeLevel,
                    operationCityId: scopeLevel === "operation" ? null : form.operationCityId,
                    operationBrId: scopeLevel === "br" ? form.operationBrId : null,
                  });
                }}
              >
                {Object.entries(SCOPE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </FormField>

            <FormField
              label="Função"
              required
              id="leadership-type"
              helperText="Só pode haver um responsável principal por escopo em cada dia."
            >
              <NativeSelect
                id="leadership-type"
                value={form.responsibilityType}
                onChange={(e) =>
                  patch({ responsibilityType: e.target.value as LeadershipFormValue["responsibilityType"] })
                }
              >
                {Object.entries(RESPONSIBILITY_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          </div>

          <ScopePicker
            operations={operations}
            coverage={coverage}
            brs={brs}
            depth={form.scopeLevel}
            value={{
              operationId: form.operationId,
              operationCityId: form.operationCityId,
              operationBrId: form.operationBrId,
            }}
            onChange={(scope) =>
              patch({
                operationId: scope.operationId,
                operationCityId: scope.operationCityId,
                operationBrId: scope.operationBrId,
              })
            }
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Início da vigência" required id="leadership-from">
              <DateInput
                id="leadership-from"
                value={form.effectiveFrom}
                onChange={(e) => patch({ effectiveFrom: e.target.value })}
              />
            </FormField>

            <FormField
              label="Fim da vigência"
              id="leadership-to"
              labelHint="Opcional"
              helperText="Em branco, a responsabilidade segue em aberto. A data informada é o último dia."
            >
              <DateInput
                id="leadership-to"
                value={form.effectiveTo ?? ""}
                onChange={(e) => patch({ effectiveTo: e.target.value || null })}
              />
            </FormField>
          </div>

          <FormField label="Observações" id="leadership-notes" labelHint="Opcional">
            <Textarea
              id="leadership-notes"
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
            {form.id ? "Salvar alterações" : "Criar vínculo"}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
