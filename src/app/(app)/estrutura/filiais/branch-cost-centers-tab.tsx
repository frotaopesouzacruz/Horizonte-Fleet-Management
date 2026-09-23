"use client";

import * as React from "react";
import { Landmark, Loader2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FormField } from "@/components/ui/form-field";
import { EmptyState } from "@/components/feedback/empty-state";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import { useConfirm } from "@/components/feedback/confirm-dialog";
import { NativeSelect } from "@/components/governance/selects";
import {
  loadBranchCostCenters, setBranchCostCenter,
  type BranchCostCenterRow, type Result,
} from "@/lib/branches/actions";

/**
 * Centros de custo da filial (§38).
 *
 * Filial e centro de custo continuam sendo entidades diferentes: aqui só se
 * escolhe quais centros EXISTENTES respondem por esta filial. Uma filial pode
 * ter vários; um centro que já responde por outra filial aparece, mas não pode
 * ser trazido para cá sem antes ser desassociado lá — nada muda de dono em
 * silêncio. Esta tela nunca cria centro de custo.
 */

export interface BranchCostCenterLoaders {
  list: () => Promise<Result<BranchCostCenterRow[]>>;
  set: (branchId: string, costCenterId: string, linked: boolean) => Promise<Result>;
}

const defaultLoaders: BranchCostCenterLoaders = {
  list: () => loadBranchCostCenters(),
  set: (branchId, costCenterId, linked) => setBranchCostCenter(branchId, costCenterId, linked),
};

export interface BranchCostCentersTabProps {
  branchId: string;
  branchName: string;
  branchActive: boolean;
  canManage: boolean;
  loaders?: BranchCostCenterLoaders;
}

const label = (c: BranchCostCenterRow) => (c.code ? `${c.code} · ${c.name}` : c.name);

export function BranchCostCentersTab({
  branchId,
  branchName,
  branchActive,
  canManage,
  loaders = defaultLoaders,
}: BranchCostCentersTabProps) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [state, setState] = React.useState<{ loading: boolean; error: string | null; rows: BranchCostCenterRow[] }>({
    loading: true,
    error: null,
    rows: [],
  });
  const [version, setVersion] = React.useState(0);
  const [choice, setChoice] = React.useState("");
  const [busy, startTransition] = React.useTransition();
  const [actionError, setActionError] = React.useState<string | null>(null);

  const { list } = loaders;
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await list();
      if (cancelled) return;
      setState({
        loading: false,
        error: result.ok ? null : result.error ?? "Não foi possível carregar os centros de custo.",
        rows: result.ok ? result.data ?? [] : [],
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [list, version]);

  if (state.loading) {
    return (
      <p className="flex items-center gap-2 py-6 text-body-sm text-fg-muted">
        <Loader2 aria-hidden className="size-4 animate-spin" />
        Carregando…
      </p>
    );
  }
  if (state.error) {
    return (
      <Alert variant="danger">
        <AlertDescription>{state.error}</AlertDescription>
      </Alert>
    );
  }

  if (state.rows.length === 0) {
    return (
      <EmptyState
        size="sm"
        icon={<Landmark />}
        title="Nenhum centro de custo cadastrado"
        description="A organização ainda não tem centros de custo. Quando eles forem cadastrados, poderão ser associados a esta filial aqui — esta tela não cria centros de custo."
      />
    );
  }

  const linked = state.rows.filter((c) => c.organizationUnitId === branchId);
  const candidates = state.rows.filter((c) => c.organizationUnitId !== branchId);
  const selectable = candidates.filter((c) => !c.organizationUnitId && c.status === "active");

  const change = (costCenter: BranchCostCenterRow, link: boolean) => {
    setActionError(null);
    startTransition(async () => {
      const result = await loaders.set(branchId, costCenter.id, link);
      if (!result.ok) {
        setActionError(result.error ?? "Não foi possível alterar o centro de custo.");
        return;
      }
      toast({
        title: link
          ? `${costCenter.name} associado a ${branchName}.`
          : `${costCenter.name} desassociado de ${branchName}.`,
        variant: "success",
      });
      setChoice("");
      setVersion((v) => v + 1);
    });
  };

  const unlink = async (costCenter: BranchCostCenterRow) => {
    const ok = await confirm({
      title: `Desassociar ${costCenter.name}?`,
      description: `O centro de custo continua cadastrado e deixa de responder por ${branchName}. Nada mais é alterado.`,
      confirmLabel: "Desassociar",
    });
    if (ok) change(costCenter, false);
  };

  return (
    <div className="flex flex-col gap-3">
      {actionError ? (
        <Alert variant="danger">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}

      <section aria-labelledby="branch-cc-linked" className="flex flex-col gap-2">
        <h3 id="branch-cc-linked" className="text-label font-semibold text-fg">
          Associados a esta filial ({linked.length})
        </h3>
        {linked.length === 0 ? (
          <p className="rounded-md border border-border px-3 py-4 text-body-sm text-fg-muted">
            Nenhum centro de custo associado a esta filial.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border" aria-label="Centros de custo da filial">
            {linked.map((c) => (
              <li key={c.id} className="flex min-w-0 items-center gap-3 px-3 py-2">
                <Landmark aria-hidden className="size-4 shrink-0 text-fg-muted" />
                <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-fg" title={label(c)}>
                  {label(c)}
                </span>
                {c.status !== "active" ? <Badge size="sm" variant="neutral">Inativo</Badge> : null}
                {canManage ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    leadingIcon={<Unlink />}
                    disabled={busy}
                    onClick={() => unlink(c)}
                    aria-label={`Desassociar ${c.name}`}
                  >
                    <span className="hidden sm:inline">Desassociar</span>
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage ? (
        branchActive ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <FormField label="Associar centro de custo" id="branch-cc-choice" className="min-w-0 flex-1">
              <NativeSelect id="branch-cc-choice" value={choice} onChange={(e) => setChoice(e.target.value)}>
                <option value="">
                  {selectable.length === 0 ? "Nenhum centro disponível" : "Selecione"}
                </option>
                {candidates.map((c) => {
                  const taken = Boolean(c.organizationUnitId);
                  const inactive = c.status !== "active";
                  const suffix = taken
                    ? ` — associado a ${c.branchName ?? "outra filial"}`
                    : inactive
                      ? " — inativo"
                      : "";
                  return (
                    <option key={c.id} value={c.id} disabled={taken || inactive}>
                      {label(c)}{suffix}
                    </option>
                  );
                })}
              </NativeSelect>
            </FormField>
            <Button
              variant="secondary"
              disabled={!choice || busy}
              loading={busy}
              onClick={() => {
                const target = candidates.find((c) => c.id === choice);
                if (target) change(target, true);
              }}
            >
              Associar
            </Button>
          </div>
        ) : (
          <Alert variant="info">
            <AlertDescription>Uma filial inativa não recebe novos centros de custo.</AlertDescription>
          </Alert>
        )
      ) : (
        <p className="text-caption text-fg-muted">
          Você pode consultar os centros de custo da filial, mas não alterá-los.
        </p>
      )}

      <p className="text-caption text-fg-muted">
        Um centro de custo já associado a outra filial precisa ser desassociado lá antes. Associar ou desassociar
        fica registrado no histórico da filial.
      </p>
    </div>
  );
}
