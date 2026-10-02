"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { RadioField, RadioGroup } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import { NativeSelect } from "@/components/governance/selects";
import type { KmRotationCandidate, KmRotationParams, KmRotationPlanRow } from "@/lib/km/rotation";
import { addItems, createPlan } from "@/lib/km/rotation-actions";
import { fmtInt } from "@/lib/km/types";
import type { Json } from "@/types/database.types";
import { pairText, period, plural, scopeText } from "./format";

/**
 * "Adicionar N rodízio(s) ao plano": cria um plano novo com os parâmetros da
 * tela ou inclui os pares num plano existente (aberto). Só os ids dos pares
 * vão ao banco; a rotina recalcula cada par com os parâmetros DO PLANO.
 */
export function AddToPlanDialog({
  open,
  onOpenChange,
  pairs,
  plans,
  params,
  analyzedPeriod,
  filtersPayload,
  onSaved,
  onOpenPlan,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pairs: KmRotationCandidate[];
  plans: KmRotationPlanRow[];
  params: KmRotationParams;
  analyzedPeriod: { from: string; to: string } | null;
  filtersPayload: Record<string, Json>;
  onSaved: () => void;
  onOpenPlan: (planId: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" data-testid="km-rodizio-add-dialog">
        {open ? (
          <AddToPlanForm
            pairs={pairs}
            plans={plans}
            params={params}
            analyzedPeriod={analyzedPeriod}
            filtersPayload={filtersPayload}
            onCancel={() => onOpenChange(false)}
            onSaved={onSaved}
            onOpenPlan={onOpenPlan}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

const defaultName = (to: string | null | undefined) => {
  const m = to?.match(/^(\d{4})-(\d{2})/);
  return m ? `Plano de Rodízio — ${m[2]}/${m[1]}` : "Plano de Rodízio";
};

function AddToPlanForm({
  pairs,
  plans,
  params,
  analyzedPeriod,
  filtersPayload,
  onCancel,
  onSaved,
  onOpenPlan,
}: {
  pairs: KmRotationCandidate[];
  plans: KmRotationPlanRow[];
  params: KmRotationParams;
  analyzedPeriod: { from: string; to: string } | null;
  filtersPayload: Record<string, Json>;
  onCancel: () => void;
  onSaved: () => void;
  onOpenPlan: (planId: string) => void;
}) {
  const { toast } = useToast();
  const openPlans = plans.filter((p) => p.status !== "executed" && p.status !== "cancelled");
  const [mode, setMode] = React.useState<"new" | "existing">("new");
  const [name, setName] = React.useState(() => defaultName(analyzedPeriod?.to));
  const [notes, setNotes] = React.useState("");
  const [planId, setPlanId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const target = openPlans.find((p) => p.id === planId) ?? null;
  const differences: string[] = [];
  if (target) {
    if (analyzedPeriod && (target.periodFrom !== analyzedPeriod.from || target.periodTo !== analyzedPeriod.to)) {
      differences.push(`período ${period(target.periodFrom, target.periodTo)} (na tela: ${period(analyzedPeriod.from, analyzedPeriod.to)})`);
    }
    if (target.horizonDays !== params.horizon) {
      differences.push(`horizonte de ${target.horizonDays} dias (na tela: ${params.horizon})`);
    }
    if (target.scopeMode !== params.scope || target.differentLocationsOnly !== params.differentLocations) {
      differences.push(`escopo “${scopeText(target.scopeMode, target.differentLocationsOnly)}”`);
    }
  }

  const n = pairs.length;
  const items = pairs.map((p) => ({ vehicle_a_id: p.vehicleAId, vehicle_b_id: p.vehicleBId }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (mode === "existing" && !target) {
      setError("Selecione um plano existente.");
      return;
    }
    if (mode === "new" && !name.trim()) {
      setError("Informe o nome do plano.");
      return;
    }
    setBusy(true);
    if (mode === "new") {
      const res = await createPlan({
        name,
        notes,
        filters: filtersPayload,
        horizon_days: params.horizon,
        scope_mode: params.scope,
        different_locations_only: params.differentLocations,
        items,
      });
      setBusy(false);
      if (!res.ok || !res.data) {
        setError(res.error ?? "Não foi possível criar o plano.");
        return;
      }
      const planIdNew = res.data.planId;
      toast({
        variant: "success",
        title: `Plano ${res.data.code} criado`,
        description: `${plural(res.data.items, "rodízio sugerido incluído", "rodízios sugeridos incluídos")}. Nada foi movimentado.`,
        action: { label: "Abrir plano", onClick: () => onOpenPlan(planIdNew) },
      });
      onSaved();
      return;
    }
    const res = await addItems(target!.id, items);
    setBusy(false);
    if (!res.ok || !res.data) {
      setError(res.error ?? "Não foi possível adicionar os rodízios.");
      return;
    }
    const planIdExisting = target!.id;
    toast({
      variant: "success",
      title: "Rodízios adicionados ao plano",
      description: `${plural(res.data.items, "rodízio incluído", "rodízios incluídos")} em ${target!.code}. Nada foi movimentado.`,
      action: { label: "Abrir plano", onClick: () => onOpenPlan(planIdExisting) },
    });
    onSaved();
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <DialogHeader>
        <DialogTitle>Adicionar {plural(n, "rodízio", "rodízios")} ao plano</DialogTitle>
        <DialogDescription>
          Incluir no plano não movimenta nenhuma frota: os rodízios entram como Sugeridos e seguem para aprovação.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4">
        <ul className="flex max-h-32 flex-col gap-0.5 overflow-y-auto rounded-sm border border-border bg-surface-secondary px-3 py-2 text-body-sm">
          {pairs.map((p) => (
            <li key={p.key} className="truncate">
              {pairText(p.vehicleA, p.vehicleB)} <span className="text-fg-muted">· {p.cohortLabel}</span>
            </li>
          ))}
        </ul>

        <RadioGroup
          value={mode}
          onValueChange={(v) => setMode(v as "new" | "existing")}
          aria-label="Destino dos rodízios"
          className="gap-1"
        >
          <RadioField value="new" label="Criar novo plano" description="Com o período, o horizonte e o escopo desta tela." data-testid="km-rodizio-add-new" />
          <RadioField
            value="existing"
            label="Adicionar a plano existente"
            description={openPlans.length ? `${plural(openPlans.length, "plano aberto", "planos abertos")}` : "Nenhum plano aberto."}
            disabled={openPlans.length === 0}
            data-testid="km-rodizio-add-existing"
          />
        </RadioGroup>

        {mode === "new" ? (
          <div className="flex flex-col gap-3">
            <FormField label="Nome do plano" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} data-testid="km-rodizio-add-name" />
            </FormField>
            <FormField label="Observação" labelHint="Opcional">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} />
            </FormField>
            <p className="text-caption text-fg-muted">
              Período {analyzedPeriod ? period(analyzedPeriod.from, analyzedPeriod.to) : "—"} · horizonte de {fmtInt(params.horizon)} dias ·{" "}
              {scopeText(params.scope, params.differentLocations)}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <FormField label="Plano" required>
              <NativeSelect value={planId} onChange={(e) => setPlanId(e.target.value)} data-testid="km-rodizio-add-plan">
                <option value="">{openPlans.length ? "Selecione o plano" : "Nenhum plano aberto"}</option>
                {openPlans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} · {p.name} · {plural(p.items, "rodízio", "rodízios")}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            {target && differences.length > 0 ? (
              <Alert variant="warning" data-testid="km-rodizio-add-diff">
                <AlertTitle>O plano {target.code} foi gerado com outros parâmetros</AlertTitle>
                <AlertDescription>
                  Diferenças: {differences.join("; ")}. Os rodízios serão recalculados com os parâmetros do plano — a
                  redução estimada pode mudar.
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        )}

        {error ? (
          <Alert variant="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button type="submit" loading={busy} data-testid="km-rodizio-add-submit">
          {mode === "new" ? "Criar plano" : "Adicionar ao plano"}
        </Button>
      </DialogFooter>
    </form>
  );
}
