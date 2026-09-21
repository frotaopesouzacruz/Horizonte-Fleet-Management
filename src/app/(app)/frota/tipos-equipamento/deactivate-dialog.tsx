"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { LoadingState } from "@/components/feedback/loading-state";
import type { EquipmentTypeImpact, EquipmentTypeRow } from "@/lib/equipment/queries";
import { loadEquipmentTypeImpact } from "@/lib/equipment/detail-actions";
import { setEquipmentTypeStatus } from "@/lib/equipment/actions";

const numberFormat = new Intl.NumberFormat("pt-BR");

/**
 * Deactivating a type, with the consequences counted first.
 *
 * This dialog is the reason the module exists. The system it replaces asked
 * for the same confirmation over an impact analysis that always returned an
 * empty list — so it always said nothing would be affected, and people
 * confirmed. Here the numbers are queried when the dialog opens, and what the
 * product cannot know yet says so instead of reporting zero (§31, §35).
 */
export function DeactivateDialog({
  target,
  onClose,
  onDone,
  disabled,
}: {
  target: EquipmentTypeRow | null;
  onClose: () => void;
  onDone: () => void;
  disabled?: boolean;
}) {
  const [impact, setImpact] = React.useState<EquipmentTypeImpact | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const deactivating = target?.effectiveStatus === "active";

  // Reset during render, keyed by the type: the previous type's numbers must
  // never be painted under this type's name.
  const [loadedId, setLoadedId] = React.useState(target?.id ?? null);
  if (loadedId !== (target?.id ?? null)) {
    setLoadedId(target?.id ?? null);
    setImpact(null);
    setReason("");
    setError(null);
    setLoading(Boolean(target));
  }

  React.useEffect(() => {
    if (!target) return;

    let active = true;
    void loadEquipmentTypeImpact(target.id)
      .then((result) => {
        if (!active) return;
        setImpact(result.ok ? (result.data ?? null) : null);
        if (!result.ok) setError(result.error ?? null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [target]);

  async function confirm() {
    if (!target || saving) return;
    setSaving(true);
    setError(null);

    const result = await setEquipmentTypeStatus(target.id, !deactivating, reason.trim() || null);
    setSaving(false);

    if (!result.ok) {
      setError(result.error ?? "Não foi possível alterar a situação.");
      return;
    }
    onDone();
  }

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{deactivating ? "Inativar tipo de equipamento" : "Reativar tipo de equipamento"}</DialogTitle>
          <DialogDescription>
            {target ? `${target.code} · ${target.name}` : ""}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          {error ? (
            <Alert variant="danger">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {loading ? (
            <LoadingState label="Calculando o impacto…" />
          ) : impact ? (
            <>
              {deactivating ? (
                <Alert variant={impact.vehiclesTotal > 0 ? "warning" : "info"}>
                  <AlertTitle>
                    {impact.vehiclesTotal > 0
                      ? `Inativar ${target?.name} poderá afetar ${numberFormat.format(impact.vehiclesTotal)} veículo(s) cadastrado(s).`
                      : `Nenhum veículo está classificado como ${target?.name} hoje.`}
                  </AlertTitle>
                  <AlertDescription>
                    O tipo sai das listas de novos cadastros. Os veículos que já o usam mantêm a
                    classificação, a situação e o histórico — nada é alterado neles.
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert variant="info">
                  <AlertTitle>O tipo volta a ficar disponível para novos cadastros.</AlertTitle>
                  <AlertDescription>
                    As operações, aplicativos e regras de elegibilidade permanecem como estão. Vínculos
                    removidos antes não são restaurados.
                  </AlertDescription>
                </Alert>
              )}

              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Fact label="Veículos" value={numberFormat.format(impact.vehiclesTotal)} />
                <Fact label="Ativos" value={numberFormat.format(impact.vehiclesActive)} />
                <Fact label="Alocados hoje" value={numberFormat.format(impact.vehiclesAllocated)} />
                <Fact label="Subcategorias" value={numberFormat.format(impact.subcategoriesTotal)} />
                <Fact label="Operações habilitadas" value={numberFormat.format(impact.operationsLinked)} />
                <Fact label="Aplicativos" value={numberFormat.format(impact.appsLinked)} />
              </dl>

              {impact.operationsWithVehicles.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <p className="text-body-sm font-semibold text-fg">Operações com veículos deste tipo</p>
                  <ul className="flex flex-col gap-1">
                    {impact.operationsWithVehicles.map((entry) => (
                      <li
                        key={entry.operationId}
                        className="flex items-baseline justify-between gap-3 text-body-sm"
                      >
                        <span className="truncate text-fg-secondary">{entry.operationName}</span>
                        <span className="shrink-0 font-semibold tabular-nums text-fg">
                          {numberFormat.format(entry.vehicleCount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* §35: o que o produto ainda não tem não vira zero. */}
              {impact.pendingModules.length > 0 ? (
                <p className="text-caption text-fg-muted">
                  Impacto em {impact.pendingModules.map((m) => m.moduleName).join(", ")}: não disponível
                  nesta etapa — esses módulos ainda não existem no HFM.
                </p>
              ) : null}
            </>
          ) : null}

          <FormField
            label="Motivo"
            helperText="Opcional. Fica registrado na auditoria junto com quem alterou."
          >
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={deactivating ? "Categoria descontinuada" : "Retomada de uso"}
            />
          </FormField>
        </DialogBody>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            variant={deactivating ? "danger" : "primary"}
            onClick={() => void confirm()}
            disabled={saving || loading || disabled}
          >
            {saving ? "Aplicando…" : deactivating ? "Inativar tipo" : "Reativar tipo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface p-2.5">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="text-h4 font-semibold tabular-nums text-fg">{value}</dd>
    </div>
  );
}
