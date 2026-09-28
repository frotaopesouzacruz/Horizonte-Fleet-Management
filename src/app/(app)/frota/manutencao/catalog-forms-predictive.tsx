"use client";

import * as React from "react";
import {
  Archive, ArrowDown, ArrowUp, CheckCircle2, ChevronRight, Copy, Eye, FileClock, Pencil, Plus, RotateCcw, Send, Trash2, Undo2,
} from "lucide-react";
import {
  Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button, IconButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { SwitchField } from "@/components/ui/switch";
import { FormField, FormGrid } from "@/components/ui/form-field";
import {
  Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { useToast } from "@/components/feedback/toast";
import { NativeSelect } from "@/components/governance/selects";
import { CriticalityBadge, PlanStatusBadge } from "@/components/maintenance/badges";
import { cn } from "@/lib/cn";
import {
  duplicatePredictivePlan, savePredictiveCoverage, savePredictiveItem, savePredictivePlan, setPredictivePlanStatus,
} from "@/lib/maintenance/actions";
import type { MaintenanceFilterOptions } from "@/lib/maintenance/queries";
import {
  formatInt, formatKm, formatStamp, PLAN_SOURCE_LABEL, PLAN_STATUS_LABEL,
  type Criticality, type MaintenanceCatalog, type PlanStatus, type PredictivePlan, type PredictivePlanItem,
} from "@/lib/maintenance/types";
import {
  CriticalitySelect, FormDrawer, FormErrorAlert, FormFieldset, FormFooter, FormSection, ReadOnlyAlert,
  ReasonPromptDialog, SituationBadge, numberText, parseDecimalField, parseIntField, safeCall,
} from "./catalog-forms";

/**
 * Planos técnicos preditivos: cabeçalho (aplicabilidade), itens (intervalos,
 * bandas, roteiro técnico, cobertura) e o fluxo rascunho → em revisão →
 * aprovado → arquivado. Só planos aprovados alimentam o motor; em plano
 * aprovado, toda alteração sensível pede motivo e publica nova versão — a
 * regra é do banco, a tela só pergunta antes.
 */

// ---------------------------------------------------------------------------
// Vocabulário do plano
// ---------------------------------------------------------------------------
export const PLAN_TRANSITIONS: Record<PlanStatus, PlanStatus[]> = {
  draft: ["in_review", "approved"],
  in_review: ["draft", "approved"],
  approved: ["archived"],
  archived: ["draft"],
};

const TRANSITION: Record<PlanStatus, { label: string; done: string; icon: React.ReactNode; description: string }> = {
  draft: {
    label: "Voltar para rascunho",
    done: "voltou para rascunho",
    icon: <Undo2 aria-hidden />,
    description: "O plano deixa de alimentar o motor (se estava arquivado, continua fora) e volta a ser editável sem versão.",
  },
  in_review: {
    label: "Enviar para revisão",
    done: "enviado para revisão",
    icon: <Send aria-hidden />,
    description: "O plano segue fora do motor até ser aprovado.",
  },
  approved: {
    label: "Aprovar",
    done: "aprovado",
    icon: <CheckCircle2 aria-hidden />,
    description: "Publica uma versão do plano e passa a alimentar o motor preditivo: os ciclos dos veículos do tipo são sincronizados agora.",
  },
  archived: {
    label: "Arquivar",
    done: "arquivado",
    icon: <Archive aria-hidden />,
    description: "O plano deixa de alimentar o motor. Os ciclos e verificações já registrados ficam no histórico.",
  },
};

export function planApplicability(plan: Pick<PredictivePlan, "vehicleTypeName" | "vehicleSubcategoryName" | "vehicleMakeName" | "vehicleModelName">) {
  return [plan.vehicleTypeName, plan.vehicleSubcategoryName, plan.vehicleMakeName, plan.vehicleModelName].filter(Boolean).join(" · ");
}

export function planYears(plan: Pick<PredictivePlan, "yearFrom" | "yearTo">) {
  if (plan.yearFrom == null && plan.yearTo == null) return "Todos";
  if (plan.yearFrom != null && plan.yearTo != null) return plan.yearFrom === plan.yearTo ? String(plan.yearFrom) : `${plan.yearFrom}–${plan.yearTo}`;
  return plan.yearFrom != null ? `A partir de ${plan.yearFrom}` : `Até ${plan.yearTo}`;
}

function intervalText(item: Pick<PredictivePlanItem, "intervalKm" | "intervalDays" | "intervalEngineHours">) {
  const parts: string[] = [];
  if (item.intervalKm != null) parts.push(formatKm(item.intervalKm));
  if (item.intervalDays != null) parts.push(`${formatInt(item.intervalDays)} d`);
  if (item.intervalEngineHours != null) parts.push(`${formatInt(item.intervalEngineHours)} h motor`);
  return parts.join(" · ") || "—";
}

const pct = (v: number) => `${numberText(v)}%`;

function vehiclesSynced(data: unknown): number | null {
  if (data && typeof data === "object" && "vehiclesSynced" in data) {
    const n = Number((data as { vehiclesSynced: unknown }).vehiclesSynced);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

// ---------------------------------------------------------------------------
// Cabeçalho do plano
// ---------------------------------------------------------------------------
export function PredictivePlanFormDrawer({
  open,
  plan,
  options,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  plan: PredictivePlan | null;
  options: MaintenanceFilterOptions;
  onOpenChange: (open: boolean) => void;
  onSaved: (id: string | null) => void;
}) {
  return (
    <FormDrawer open={open} onOpenChange={onOpenChange} size="lg" testId="maintenance-plan-form">
      <PlanForm key={plan?.id ?? "novo"} plan={plan} options={options} onClose={() => onOpenChange(false)} onSaved={onSaved} />
    </FormDrawer>
  );
}

function PlanForm({
  plan,
  options,
  onClose,
  onSaved,
}: {
  plan: PredictivePlan | null;
  options: MaintenanceFilterOptions;
  onClose: () => void;
  onSaved: (id: string | null) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = React.useState(plan?.name ?? "");
  const [description, setDescription] = React.useState(plan?.description ?? "");
  const [vehicleTypeId, setVehicleTypeId] = React.useState(plan?.vehicleTypeId ?? "");
  const [subcategoryId, setSubcategoryId] = React.useState(plan?.vehicleSubcategoryId ?? "");
  const [makeId, setMakeId] = React.useState(plan?.vehicleMakeId ?? "");
  const [modelId, setModelId] = React.useState(plan?.vehicleModelId ?? "");
  const [yearFrom, setYearFrom] = React.useState(plan?.yearFrom != null ? String(plan.yearFrom) : "");
  const [yearTo, setYearTo] = React.useState(plan?.yearTo != null ? String(plan.yearTo) : "");
  const [source, setSource] = React.useState(plan?.source ?? "internal");
  const [referenceDocument, setReferenceDocument] = React.useState(plan?.referenceDocument ?? "");
  const [oemReference, setOemReference] = React.useState(plan?.oemReference ?? "");
  const [notes, setNotes] = React.useState(plan?.notes ?? "");
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const types = !plan || options.vehicleTypes.some((t) => t.id === plan.vehicleTypeId)
    ? options.vehicleTypes
    : [...options.vehicleTypes, { id: plan.vehicleTypeId, name: plan.vehicleTypeName }];
  const subcategories = options.subcategories.filter((s) => s.vehicleTypeId === vehicleTypeId);
  const models = options.models.filter((m) => !makeId || m.makeId === makeId);

  const from = parseIntField(yearFrom);
  const to = parseIntField(yearTo);
  const yearInvalid =
    (from != null && (from < 1950 || from > 2100)) || (to != null && (to < 1950 || to > 2100)) || (from != null && to != null && from > to);

  // Mudar a aplicabilidade de um plano aprovado gera versão: o banco exige motivo.
  const keyChanged =
    plan != null &&
    (vehicleTypeId !== plan.vehicleTypeId ||
      (subcategoryId || null) !== plan.vehicleSubcategoryId ||
      (makeId || null) !== plan.vehicleMakeId ||
      (modelId || null) !== plan.vehicleModelId ||
      from !== plan.yearFrom ||
      to !== plan.yearTo);
  const needsReason = plan?.approvalStatus === "approved" && keyChanged;
  const reasonInvalid = needsReason && reason.trim().length < 5;
  const canSubmit = name.trim().length >= 2 && Boolean(vehicleTypeId) && !yearInvalid && !reasonInvalid;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !canSubmit) return;
    setSaving(true);
    setError(null);
    const result = await safeCall(
      () =>
        savePredictivePlan(
          {
            id: plan?.id,
            name: name.trim(),
            description: description.trim() || null,
            vehicle_type_id: vehicleTypeId,
            vehicle_subcategory_id: subcategoryId || null,
            vehicle_make_id: makeId || null,
            vehicle_model_id: modelId || null,
            year_from: from,
            year_to: to,
            source,
            reference_document: referenceDocument.trim() || null,
            oem_reference: oemReference.trim() || null,
            notes: notes.trim() || null,
          },
          needsReason ? reason.trim() : undefined,
        ),
      "Não foi possível salvar o plano técnico.",
    );
    setSaving(false);
    if (!result.ok) {
      const message = result.error ?? "Não foi possível salvar o plano técnico.";
      setError(message);
      toast({ title: message, variant: "danger" });
      return;
    }
    toast({
      title: plan
        ? needsReason
          ? `Plano atualizado. Nova versão publicada (v${plan.version + 1}).`
          : "Plano atualizado."
        : "Plano criado como rascunho. Cadastre os itens e aprove para alimentar o motor.",
      variant: "success",
    });
    onSaved(plan?.id ?? result.data ?? null);
    onClose();
  };

  return (
    <>
      <DrawerHeader>
        <DrawerTitle>{plan ? `Editar plano ${plan.code}` : "Novo plano técnico preditivo"}</DrawerTitle>
        <DrawerDescription>
          A quem o plano se aplica e de onde vem a referência técnica. Os itens são cadastrados no detalhe do plano.
        </DrawerDescription>
      </DrawerHeader>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" aria-busy={saving}>
        <DrawerBody className="flex flex-col gap-6">
          <FormErrorAlert error={error} />
          <FormSection title="Identificação">
            <FormGrid columns={2}>
              <FormField label="Nome do plano" required className="sm:col-span-2">
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} placeholder="Cavalo mecânico 6x2 — linha pesada" required />
              </FormField>
              <FormField label="Fonte">
                <NativeSelect value={source} onChange={(e) => setSource(e.target.value)}>
                  {Object.entries(PLAN_SOURCE_LABEL).map(([code, label]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField label="Documento de referência">
                <Input value={referenceDocument} onChange={(e) => setReferenceDocument(e.target.value)} maxLength={200} placeholder="Manual de manutenção, ed. 2025" />
              </FormField>
              <FormField label="Referência OEM" className="sm:col-span-2">
                <Input value={oemReference} onChange={(e) => setOemReference(e.target.value)} maxLength={200} />
              </FormField>
              <FormField label="Descrição" className="sm:col-span-2">
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={1000} />
              </FormField>
            </FormGrid>
          </FormSection>

          <FormSection
            title="Aplicabilidade"
            description="Tipo obrigatório; subcategoria, marca, modelo e faixa de ano restringem o plano. Vazio = todos."
          >
            <FormGrid columns={2}>
              <FormField label="Tipo de equipamento" required>
                <NativeSelect
                  value={vehicleTypeId}
                  onChange={(e) => {
                    setVehicleTypeId(e.target.value);
                    setSubcategoryId("");
                  }}
                  required
                >
                  <option value="">Selecione</option>
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField label="Subcategoria">
                <NativeSelect value={subcategoryId} onChange={(e) => setSubcategoryId(e.target.value)} disabled={!vehicleTypeId}>
                  <option value="">{vehicleTypeId ? "Todas" : "Escolha o tipo"}</option>
                  {subcategories.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField label="Marca">
                <NativeSelect
                  value={makeId}
                  onChange={(e) => {
                    setMakeId(e.target.value);
                    setModelId("");
                  }}
                >
                  <option value="">Todas</option>
                  {options.makes.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField label="Modelo">
                <NativeSelect value={modelId} onChange={(e) => setModelId(e.target.value)}>
                  <option value="">Todos</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField label="Ano de" error={yearInvalid ? "Anos entre 1950 e 2100, com o inicial até o final." : undefined}>
                <Input inputMode="numeric" value={yearFrom} onChange={(e) => setYearFrom(e.target.value.replace(/\D/g, ""))} maxLength={4} placeholder="2018" />
              </FormField>
              <FormField label="Ano até">
                <Input inputMode="numeric" value={yearTo} onChange={(e) => setYearTo(e.target.value.replace(/\D/g, ""))} maxLength={4} placeholder="2026" />
              </FormField>
            </FormGrid>
          </FormSection>

          <FormField label="Observações">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} />
          </FormField>

          {needsReason ? (
            <div className="flex flex-col gap-3">
              <Alert variant="warning">
                <AlertTitle>Plano aprovado: a aplicabilidade mudou</AlertTitle>
                <AlertDescription>
                  Salvar publica a versão v{(plan?.version ?? 0) + 1}. Informe o motivo; ele fica no histórico de versões.
                </AlertDescription>
              </Alert>
              <FormField
                label="Motivo da alteração"
                required
                error={reasonInvalid && reason.length > 0 ? "Descreva o motivo em pelo menos 5 caracteres." : undefined}
              >
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000} />
              </FormField>
            </div>
          ) : null}
        </DrawerBody>
        <FormFooter readOnly={false} saving={saving} disabled={!canSubmit} onClose={onClose} />
      </form>
    </>
  );
}

// ---------------------------------------------------------------------------
// Duplicar
// ---------------------------------------------------------------------------
export function DuplicatePlanDialog({
  plan,
  onOpenChange,
  onDuplicated,
}: {
  plan: PredictivePlan | null;
  onOpenChange: (open: boolean) => void;
  onDuplicated: (id: string | null) => void;
}) {
  const open = plan !== null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="maintenance-plan-duplicate">
        {plan ? <DuplicateBody key={plan.id} plan={plan} onClose={() => onOpenChange(false)} onDuplicated={onDuplicated} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function DuplicateBody({ plan, onClose, onDuplicated }: { plan: PredictivePlan; onClose: () => void; onDuplicated: (id: string | null) => void }) {
  const { toast } = useToast();
  const [name, setName] = React.useState(`${plan.name} (cópia)`.slice(0, 160));
  const [busy, setBusy] = React.useState(false);
  const canSubmit = name.trim().length >= 2;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !canSubmit) return;
    setBusy(true);
    const result = await safeCall(() => duplicatePredictivePlan(plan.id, name.trim()), "Não foi possível duplicar o plano.");
    setBusy(false);
    if (!result.ok) {
      toast({ title: result.error ?? "Não foi possível duplicar o plano.", variant: "danger" });
      return;
    }
    toast({ title: "Plano duplicado como rascunho, com itens, roteiros e coberturas.", variant: "success" });
    onDuplicated(result.data ?? null);
    onClose();
  };

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" aria-busy={busy}>
      <DialogHeader>
        <DialogTitle>Duplicar plano {plan.code}</DialogTitle>
        <DialogDescription>A cópia nasce em rascunho, versão 1, fora do motor até ser aprovada.</DialogDescription>
      </DialogHeader>
      <DialogBody>
        <FormField label="Nome do novo plano" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} />
        </FormField>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button type="submit" leadingIcon={<Copy />} loading={busy} disabled={!canSubmit}>
          Duplicar
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Detalhe do plano
// ---------------------------------------------------------------------------
export function PredictivePlanDetailDrawer({
  planId,
  plan,
  catalog,
  options,
  canManage,
  pending,
  onOpenChange,
  onChanged,
  onOpenPlan,
}: {
  planId: string | null;
  plan: PredictivePlan | null;
  catalog: MaintenanceCatalog;
  options: MaintenanceFilterOptions;
  canManage: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
  onOpenPlan: (id: string) => void;
}) {
  const open = planId !== null;
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent size="xl" data-testid="maintenance-plan-detail">
        {open ? (
          plan ? (
            <PlanDetail
              key={plan.id}
              plan={plan}
              catalog={catalog}
              options={options}
              canManage={canManage}
              onChanged={onChanged}
              onOpenPlan={onOpenPlan}
              onClose={() => onOpenChange(false)}
            />
          ) : (
            <>
              <DrawerHeader>
                <DrawerTitle>Plano técnico</DrawerTitle>
                <DrawerDescription>Detalhe do plano preditivo.</DrawerDescription>
              </DrawerHeader>
              <DrawerBody aria-busy={pending}>
                {pending ? (
                  <LoadingState label="Carregando o plano…" />
                ) : (
                  <EmptyState
                    size="sm"
                    title="Plano não encontrado"
                    description="Ele não está mais na lista desta organização. Atualize a tela para ver os planos atuais."
                  />
                )}
              </DrawerBody>
            </>
          )
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}

function Fact({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", wide && "sm:col-span-2 lg:col-span-3")}>
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="text-body-sm break-words text-fg">{children}</dd>
    </div>
  );
}

function PlanDetail({
  plan,
  catalog,
  options,
  canManage,
  onChanged,
  onOpenPlan,
  onClose,
}: {
  plan: PredictivePlan;
  catalog: MaintenanceCatalog;
  options: MaintenanceFilterOptions;
  canManage: boolean;
  onChanged: () => void;
  onOpenPlan: (id: string) => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = React.useState(false);
  const [itemForm, setItemForm] = React.useState<{ open: boolean; item: PredictivePlanItem | null }>({ open: false, item: null });
  const [target, setTarget] = React.useState<PlanStatus | null>(null);
  const [duplicating, setDuplicating] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string[]>([]);

  const activeItems = plan.items.filter((i) => i.isActive).length;
  const transitions = PLAN_TRANSITIONS[plan.approvalStatus] ?? [];

  const changeStatus = async (reason: string): Promise<boolean> => {
    if (!target) return false;
    const result = await safeCall(
      () => setPredictivePlanStatus(plan.id, target, reason),
      "Não foi possível alterar a situação do plano.",
    );
    if (!result.ok) {
      toast({ title: result.error ?? "Não foi possível alterar a situação do plano.", variant: "danger" });
      return false;
    }
    const synced = vehiclesSynced(result.data);
    toast({
      title: `Plano ${TRANSITION[target].done}.${synced != null && synced > 0 ? ` ${formatInt(synced)} veículo(s) sincronizado(s).` : ""}`,
      variant: "success",
    });
    onChanged();
    return true;
  };

  const statusNotice: Record<PlanStatus, { variant: "success" | "info" | "neutral"; text: string }> = {
    draft: { variant: "info", text: "Rascunho: fora do motor preditivo. Edite à vontade; aprovar publica a primeira versão." },
    in_review: { variant: "info", text: "Em revisão: fora do motor preditivo até ser aprovado." },
    approved: {
      variant: "success",
      text: "Aprovado: alimenta o motor preditivo. Mudar intervalo, bandas, cluster ou ativação de um item (ou incluir item) exige motivo e publica nova versão, recalculando os ciclos.",
    },
    archived: { variant: "neutral", text: "Arquivado: fora do motor. O histórico de ciclos e verificações continua disponível." },
  };
  const notice = statusNotice[plan.approvalStatus];

  const toggle = (id: string) => setExpanded((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  return (
    <>
      <DrawerHeader>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-caption text-fg-muted">{plan.code}</span>
          <PlanStatusBadge status={plan.approvalStatus} />
          <Badge variant="neutral" size="sm">
            Versão {plan.version}
          </Badge>
        </div>
        <DrawerTitle>{plan.name}</DrawerTitle>
        <DrawerDescription>{planApplicability(plan)}</DrawerDescription>
      </DrawerHeader>

      <DrawerBody className="flex flex-col gap-5">
        {canManage ? (
          <div className="flex flex-wrap items-center gap-2" data-testid="maintenance-plan-actions">
            <Button size="sm" variant="outline" leadingIcon={<Pencil />} onClick={() => setEditing(true)}>
              Editar plano
            </Button>
            <Button size="sm" variant="outline" leadingIcon={<Plus />} onClick={() => setItemForm({ open: true, item: null })}>
              Novo item
            </Button>
            <Button size="sm" variant="outline" leadingIcon={<Copy />} onClick={() => setDuplicating(true)}>
              Duplicar
            </Button>
            <span className="mx-1 hidden h-5 w-px bg-border sm:inline-block" aria-hidden />
            {transitions.map((next) => {
              const blocked = next === "approved" && activeItems === 0;
              return (
                <Button
                  key={next}
                  size="sm"
                  variant={next === "approved" ? "primary" : next === "archived" ? "outline" : "secondary"}
                  leadingIcon={TRANSITION[next].icon}
                  disabled={blocked}
                  title={blocked ? "O plano precisa de ao menos um item ativo para ser aprovado." : undefined}
                  onClick={() => setTarget(next)}
                  data-testid={`maintenance-plan-status-${next}`}
                >
                  {plan.approvalStatus === "archived" && next === "draft" ? "Reabrir como rascunho" : TRANSITION[next].label}
                </Button>
              );
            })}
          </div>
        ) : (
          <ReadOnlyAlert what="planos técnicos" />
        )}

        <Alert variant={notice.variant}>
          <AlertDescription>{notice.text}</AlertDescription>
        </Alert>

        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-md border border-border bg-surface p-3 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Tipo de equipamento">{plan.vehicleTypeName}</Fact>
          <Fact label="Subcategoria">{plan.vehicleSubcategoryName ?? "Todas"}</Fact>
          <Fact label="Marca · modelo">
            {[plan.vehicleMakeName ?? "Todas as marcas", plan.vehicleModelName ?? "todos os modelos"].join(" · ")}
          </Fact>
          <Fact label="Anos de fabricação">{planYears(plan)}</Fact>
          <Fact label="Fonte">{PLAN_SOURCE_LABEL[plan.source] ?? plan.source}</Fact>
          <Fact label="Veículos no plano">{formatInt(plan.vehicles)}</Fact>
          <Fact label="Documento de referência">{plan.referenceDocument ?? "—"}</Fact>
          <Fact label="Referência OEM">{plan.oemReference ?? "—"}</Fact>
          <Fact label="Aprovação">
            {plan.approvedAt ? `${formatStamp(plan.approvedAt)}${plan.approvedByName ? ` · ${plan.approvedByName}` : ""}` : "—"}
          </Fact>
          {plan.description ? <Fact label="Descrição" wide>{plan.description}</Fact> : null}
          {plan.notes ? <Fact label="Observações" wide>{plan.notes}</Fact> : null}
        </dl>

        <section className="flex flex-col gap-2" aria-labelledby="maintenance-plan-items-title">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="maintenance-plan-items-title" className="text-h4 font-semibold text-fg">
              Itens do plano
            </h3>
            <span className="text-caption text-fg-muted">
              {formatInt(activeItems)} ativo(s) de {formatInt(plan.items.length)}. Horas de motor ficam registradas, mas ainda não entram no cálculo.
            </span>
          </div>
          <TableContainer tabIndex={0}>
            <Table layout="fixed" style={{ minWidth: 1040 }} data-testid="maintenance-plan-items">
              <TableHeader>
                <TableRow>
                  <TableHead style={{ width: 40 }}><span className="sr-only">Expandir</span></TableHead>
                  <TableHead style={{ width: 56 }} numeric>Ordem</TableHead>
                  <TableHead style={{ width: 130 }}>Cluster</TableHead>
                  <TableHead style={{ width: 190 }}>Item</TableHead>
                  <TableHead style={{ width: 150 }}>Serviço</TableHead>
                  <TableHead style={{ width: 170 }}>Intervalo</TableHead>
                  <TableHead style={{ width: 130 }} title="Alerta / Programar / Tolerância">A / P / T</TableHead>
                  <TableHead style={{ width: 100 }}>Criticidade</TableHead>
                  <TableHead style={{ width: 84 }}>Situação</TableHead>
                  <TableHead style={{ width: 76 }} numeric>Roteiro</TableHead>
                  <TableHead style={{ width: 90 }} numeric>Cobertura</TableHead>
                  <TableHead style={{ width: 52 }}><span className="sr-only">Ações</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.items.length === 0 ? (
                  <TableEmpty
                    colSpan={12}
                    message={canManage ? "Sem itens. Use \"Novo item\" para cadastrar as inspeções do plano." : "Sem itens cadastrados."}
                  />
                ) : (
                  plan.items.map((item) => {
                    const isOpen = expanded.includes(item.id);
                    const detailId = `maintenance-plan-item-${item.id}`;
                    const full = item.coverage.filter((c) => c.coverage === "full").length;
                    return (
                      <React.Fragment key={item.id}>
                        <TableRow className={cn(!item.isActive && "text-fg-muted")}>
                          <TableCell>
                            <IconButton
                              size="sm"
                              label={`${isOpen ? "Ocultar" : "Mostrar"} roteiro e cobertura de ${item.name}`}
                              aria-expanded={isOpen}
                              aria-controls={detailId}
                              onClick={() => toggle(item.id)}
                            >
                              <ChevronRight className={cn("hfm-transition", isOpen && "rotate-90")} aria-hidden />
                            </IconButton>
                          </TableCell>
                          <TableCell numeric>{item.sortOrder}</TableCell>
                          <TableCell truncate title={item.clusterName}>{item.clusterName}</TableCell>
                          <TableCell truncate title={item.name} className="font-medium">{item.name}</TableCell>
                          <TableCell truncate title={item.serviceName ?? undefined}>{item.serviceName ?? "—"}</TableCell>
                          <TableCell truncate className="tabular-nums" title={intervalText(item)}>{intervalText(item)}</TableCell>
                          <TableCell className="tabular-nums">
                            {pct(item.alertPct)} / {pct(item.schedulePct)} / {pct(item.tolerancePct)}
                          </TableCell>
                          <TableCell><CriticalityBadge value={item.criticality} /></TableCell>
                          <TableCell><SituationBadge active={item.isActive} /></TableCell>
                          <TableCell numeric>{formatInt(item.checklist.length)}</TableCell>
                          <TableCell numeric title={`${full} total, ${item.coverage.length - full} parcial`}>
                            {formatInt(item.coverage.length)}
                          </TableCell>
                          <TableCell align="right">
                            <IconButton
                              size="sm"
                              label={`${canManage ? "Editar" : "Ver"} item ${item.name}`}
                              onClick={() => setItemForm({ open: true, item })}
                            >
                              {canManage ? <Pencil aria-hidden /> : <Eye aria-hidden />}
                            </IconButton>
                          </TableCell>
                        </TableRow>
                        {isOpen ? (
                          <TableRow className="hover:bg-transparent">
                            <TableCell colSpan={12} className="bg-surface-secondary py-3" id={detailId}>
                              <ItemExpansion item={item} />
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </React.Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </section>

        <section className="flex flex-col gap-2" aria-labelledby="maintenance-plan-versions-title">
          <h3 id="maintenance-plan-versions-title" className="flex items-center gap-2 text-h4 font-semibold text-fg">
            <FileClock className="size-4 text-fg-muted" aria-hidden />
            Histórico de versões
          </h3>
          <TableContainer tabIndex={0}>
            <Table layout="fixed" style={{ minWidth: 640 }} data-testid="maintenance-plan-versions">
              <TableHeader>
                <TableRow>
                  <TableHead style={{ width: 80 }} numeric>Versão</TableHead>
                  <TableHead style={{ width: 120 }}>Situação</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead style={{ width: 160 }}>Autor</TableHead>
                  <TableHead style={{ width: 140 }}>Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.versions.length === 0 ? (
                  <TableEmpty colSpan={5} message="Nenhuma versão publicada. A primeira nasce na aprovação." />
                ) : (
                  plan.versions.map((v) => (
                    <TableRow key={v.version}>
                      <TableCell numeric className="font-medium">v{v.version}</TableCell>
                      <TableCell><PlanStatusBadge status={v.approvalStatus} /></TableCell>
                      <TableCell truncate title={v.reason ?? undefined}>{v.reason ?? "—"}</TableCell>
                      <TableCell truncate title={v.createdByName ?? undefined}>{v.createdByName ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{formatStamp(v.createdAt)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </section>
      </DrawerBody>

      <DrawerFooter>
        <Button variant="outline" onClick={onClose}>
          Fechar
        </Button>
      </DrawerFooter>

      {canManage ? (
        <>
          <PredictivePlanFormDrawer
            open={editing}
            plan={plan}
            options={options}
            onOpenChange={setEditing}
            onSaved={() => onChanged()}
          />
          <ReasonPromptDialog
            open={target !== null}
            onOpenChange={(open) => {
              if (!open) setTarget(null);
            }}
            title={target ? `${plan.approvalStatus === "archived" && target === "draft" ? "Reabrir como rascunho" : TRANSITION[target].label}: ${plan.code}` : ""}
            description={target ? TRANSITION[target].description : undefined}
            confirmLabel={target ? TRANSITION[target].label : "Confirmar"}
            placeholder="Ex.: revisado com o manual do fabricante, edição 2026."
            onConfirm={changeStatus}
          />
          <DuplicatePlanDialog
            plan={duplicating ? plan : null}
            onOpenChange={(open) => {
              if (!open) setDuplicating(false);
            }}
            onDuplicated={(id) => {
              onChanged();
              if (id) onOpenPlan(id);
            }}
          />
        </>
      ) : null}
      <PredictiveItemFormDrawer
        open={itemForm.open}
        plan={plan}
        item={itemForm.item}
        catalog={catalog}
        readOnly={!canManage}
        onOpenChange={(open) => setItemForm((s) => ({ ...s, open }))}
        onSaved={onChanged}
      />
    </>
  );
}

function ItemExpansion({ item }: { item: PredictivePlanItem }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="min-w-0">
        <p className="text-caption font-semibold text-fg-secondary">Roteiro técnico</p>
        {item.technicalDescription ? <p className="mt-1 text-body-sm whitespace-pre-line text-fg">{item.technicalDescription}</p> : null}
        {item.checklist.length === 0 ? (
          <p className="mt-1 text-caption text-fg-muted">Sem passos cadastrados.</p>
        ) : (
          <ol className="mt-1 flex list-decimal flex-col gap-1 pl-5 text-body-sm text-fg">
            {item.checklist.map((step) => (
              <li key={step.key}>
                {step.description}{" "}
                <span className="text-caption text-fg-muted">
                  ({step.required ? "obrigatório" : "opcional"} · <span className="font-mono">{step.key}</span>)
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="min-w-0">
        <p className="text-caption font-semibold text-fg-secondary">Cobertura técnica</p>
        {item.coverage.length === 0 ? (
          <p className="mt-1 text-caption text-fg-muted">Nenhum serviço reinicia este item.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1 text-body-sm text-fg">
            {item.coverage.map((c) => (
              <li key={c.serviceId} className="flex items-center gap-2">
                <Badge size="sm" variant={c.coverage === "full" ? "success" : "neutral"}>
                  {c.coverage === "full" ? "Total" : "Parcial"}
                </Badge>
                <span className="truncate">{c.serviceName}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Item do plano
// ---------------------------------------------------------------------------
export function PredictiveItemFormDrawer({
  open,
  plan,
  item,
  catalog,
  readOnly,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  plan: PredictivePlan;
  item: PredictivePlanItem | null;
  catalog: MaintenanceCatalog;
  readOnly: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <FormDrawer open={open} onOpenChange={onOpenChange} size="xl" testId="maintenance-plan-item-form">
      <ItemForm
        key={item?.id ?? "novo"}
        plan={plan}
        item={item}
        catalog={catalog}
        readOnly={readOnly}
        onClose={() => onOpenChange(false)}
        onSaved={onSaved}
      />
    </FormDrawer>
  );
}

interface StepDraft {
  uid: string;
  key: string;
  description: string;
  required: boolean;
}
interface CoverageDraft {
  serviceId: string;
  coverage: "full" | "partial";
}

const serializeCoverage = (list: CoverageDraft[]) => JSON.stringify(list.map((c) => `${c.serviceId}:${c.coverage}`).sort());

function ItemForm({
  plan,
  item,
  catalog,
  readOnly,
  onClose,
  onSaved,
}: {
  plan: PredictivePlan;
  item: PredictivePlanItem | null;
  catalog: MaintenanceCatalog;
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [clusterId, setClusterId] = React.useState(item?.clusterId ?? "");
  const [serviceId, setServiceId] = React.useState(item?.serviceId ?? "");
  const [name, setName] = React.useState(item?.name ?? "");
  const [technicalDescription, setTechnicalDescription] = React.useState(item?.technicalDescription ?? "");
  const [intervalKm, setIntervalKm] = React.useState(item?.intervalKm != null ? String(item.intervalKm) : "");
  const [intervalDays, setIntervalDays] = React.useState(item?.intervalDays != null ? String(item.intervalDays) : "");
  const [engineHours, setEngineHours] = React.useState(item?.intervalEngineHours != null ? String(item.intervalEngineHours) : "");
  const [alertPct, setAlertPct] = React.useState(numberText(item?.alertPct ?? 20));
  const [schedulePct, setSchedulePct] = React.useState(numberText(item?.schedulePct ?? 10));
  const [tolerancePct, setTolerancePct] = React.useState(numberText(item?.tolerancePct ?? 10));
  const [criticality, setCriticality] = React.useState<Criticality>(item?.criticality ?? "medium");
  const [sortOrder, setSortOrder] = React.useState(String(item?.sortOrder ?? (plan.items.length + 1) * 10));
  const [isActive, setIsActive] = React.useState(item?.isActive ?? true);
  const [steps, setSteps] = React.useState<StepDraft[]>(() =>
    (item?.checklist ?? []).map((s, i) => ({ uid: `s${i}`, key: s.key, description: s.description, required: s.required })),
  );
  const [nextUid, setNextUid] = React.useState((item?.checklist.length ?? 0) + 1);
  const initialCoverage = React.useMemo<CoverageDraft[]>(
    () => (item?.coverage ?? []).map((c) => ({ serviceId: c.serviceId, coverage: c.coverage })),
    [item],
  );
  const [coverage, setCoverage] = React.useState<CoverageDraft[]>(initialCoverage);
  const [newCoverageService, setNewCoverageService] = React.useState("");
  const [newCoverageKind, setNewCoverageKind] = React.useState<"full" | "partial">("full");
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const clusters = catalog.clusters.filter((c) => c.status === "active" || c.id === item?.clusterId);
  const activeServices = catalog.services.filter((s) => s.status === "active" || s.id === item?.serviceId);
  const serviceName = React.useMemo(() => new Map(catalog.services.map((s) => [s.id, `${s.clusterName} · ${s.name}`])), [catalog.services]);
  const itemServices = (item?.coverage ?? []).reduce((map, c) => map.set(c.serviceId, c.serviceName), new Map<string, string>());

  const km = parseIntField(intervalKm);
  const days = parseIntField(intervalDays);
  const hours = parseIntField(engineHours);
  const alert = parseDecimalField(alertPct);
  const schedule = parseDecimalField(schedulePct);
  const tolerance = parseDecimalField(tolerancePct);

  const intervalMissing = km == null && days == null;
  const kmInvalid = km != null && (km < 100 || km > 1_000_000);
  const daysInvalid = days != null && (days < 1 || days > 3650);
  const hoursInvalid = hours != null && (hours < 1 || hours > 100_000);
  const pctInvalid = (v: number | null) => v == null || v < 0 || v > 100;
  const bandsInvalid = !pctInvalid(alert) && !pctInvalid(schedule) && (schedule ?? 0) > (alert ?? 0);

  const stepKeys = steps.map((s) => s.key.trim() || slugify(s.description));
  const stepsInvalid =
    steps.some((s, i) => s.description.trim().length < 2 || !stepKeys[i]) || new Set(stepKeys).size !== stepKeys.length;

  const sensitive =
    !item ||
    clusterId !== item.clusterId ||
    km !== item.intervalKm ||
    days !== item.intervalDays ||
    hours !== item.intervalEngineHours ||
    alert !== item.alertPct ||
    schedule !== item.schedulePct ||
    tolerance !== item.tolerancePct ||
    isActive !== item.isActive;
  const needsReason = plan.approvalStatus === "approved" && sensitive;
  const reasonInvalid = needsReason && reason.trim().length < 5;
  const coverageDirty = serializeCoverage(coverage) !== serializeCoverage(initialCoverage);

  const canSubmit =
    Boolean(clusterId) &&
    name.trim().length >= 2 &&
    !intervalMissing && !kmInvalid && !daysInvalid && !hoursInvalid &&
    !pctInvalid(alert) && !pctInvalid(schedule) && !pctInvalid(tolerance) && !bandsInvalid &&
    !stepsInvalid && !reasonInvalid;

  // ---- roteiro técnico
  const addStep = () => {
    setSteps((list) => [...list, { uid: `n${nextUid}`, key: "", description: "", required: true }]);
    setNextUid((n) => n + 1);
  };
  const updateStep = (uid: string, patch: Partial<StepDraft>) =>
    setSteps((list) => list.map((s) => (s.uid === uid ? { ...s, ...patch } : s)));
  const moveStep = (index: number, delta: number) =>
    setSteps((list) => {
      const next = [...list];
      const [moved] = next.splice(index, 1);
      next.splice(index + delta, 0, moved);
      return next;
    });
  const fillKey = (uid: string) =>
    setSteps((list) => {
      const step = list.find((s) => s.uid === uid);
      if (!step || step.key.trim()) return list;
      const base = slugify(step.description) || `passo_${list.indexOf(step) + 1}`;
      const taken = new Set(list.filter((s) => s.uid !== uid).map((s) => s.key));
      let key = base;
      for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
      return list.map((s) => (s.uid === uid ? { ...s, key } : s));
    });

  // ---- cobertura
  const coverageChoices = catalog.services.filter(
    (s) => s.status === "active" && !coverage.some((c) => c.serviceId === s.id),
  );

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly || saving || !canSubmit) return;
    setSaving(true);
    setError(null);
    const result = await safeCall(
      () =>
        savePredictiveItem(
          plan.id,
          {
            id: item?.id,
            cluster_id: clusterId,
            service_id: serviceId || null,
            name: name.trim(),
            technical_description: technicalDescription.trim() || null,
            interval_km: km,
            interval_days: days,
            interval_engine_hours: hours,
            alert_pct: alert,
            schedule_pct: schedule,
            tolerance_pct: tolerance,
            criticality,
            sort_order: parseIntField(sortOrder) ?? 100,
            is_active: isActive,
            checklist: steps.map((s, i) => ({ key: stepKeys[i], description: s.description.trim(), required: s.required })),
          },
          needsReason ? reason.trim() : undefined,
        ),
      "Não foi possível salvar o item do plano.",
    );
    if (!result.ok) {
      setSaving(false);
      const message = result.error ?? "Não foi possível salvar o item do plano.";
      setError(message);
      toast({ title: message, variant: "danger" });
      return;
    }

    const itemId = result.data?.id ?? item?.id ?? null;
    if (coverageDirty && itemId) {
      const saved = await safeCall(() => savePredictiveCoverage(itemId, coverage), "Não foi possível salvar a cobertura técnica.");
      if (!saved.ok) {
        setSaving(false);
        toast({
          title: `O item foi salvo, mas a cobertura técnica não: ${saved.error ?? "erro desconhecido"}`,
          description: "Abra o item e grave a cobertura de novo.",
          variant: "danger",
        });
        onSaved();
        onClose();
        return;
      }
    }
    setSaving(false);
    const synced = vehiclesSynced(result.data);
    toast({
      title: result.data?.versionChanged
        ? `Item salvo. Nova versão do plano publicada (v${plan.version + 1}).`
        : item
          ? "Item atualizado."
          : "Item incluído no plano.",
      description: result.data?.versionChanged && synced != null ? `${formatInt(synced)} veículo(s) com os ciclos recalculados.` : undefined,
      variant: "success",
    });
    onSaved();
    onClose();
  };

  return (
    <>
      <DrawerHeader>
        <DrawerTitle>{item ? (readOnly ? `Item: ${item.name}` : `Editar item: ${item.name}`) : "Novo item do plano"}</DrawerTitle>
        <DrawerDescription>
          {plan.code} · {plan.name} · {PLAN_STATUS_LABEL[plan.approvalStatus]}, versão {plan.version}
        </DrawerDescription>
      </DrawerHeader>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" aria-busy={saving}>
        <DrawerBody className="flex flex-col gap-6">
          {readOnly ? <ReadOnlyAlert what="planos técnicos" /> : null}
          <FormErrorAlert error={error} />
          <FormFieldset readOnly={readOnly}>
            <FormSection title="Inspeção">
              <FormGrid columns={2}>
                <FormField label="Cluster técnico" required>
                  <NativeSelect value={clusterId} onChange={(e) => setClusterId(e.target.value)} required>
                    <option value="">Selecione</option>
                    {clusters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField label="Nome do item" required>
                  <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} placeholder="Inspeção de lonas de freio" required />
                </FormField>
                <FormField label="Serviço de inspeção" helperText="Lançado quando o item gera uma manutenção preditiva.">
                  <NativeSelect value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                    <option value="">Não definido</option>
                    {activeServices.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.clusterName} · {s.name}
                        {s.isPredictive ? " (preditivo)" : ""}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField label="Criticidade">
                  <CriticalitySelect value={criticality} onChange={setCriticality} />
                </FormField>
                <FormField label="Ordem" helperText="Menor aparece antes.">
                  <Input inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value.replace(/\D/g, ""))} maxLength={4} />
                </FormField>
                <div className="flex items-end">
                  <SwitchField
                    className="w-full"
                    label="Item ativo"
                    description="Inativo deixa de gerar ciclos; o histórico fica."
                    checked={isActive}
                    onCheckedChange={setIsActive}
                  />
                </div>
                <FormField label="Descrição técnica" className="sm:col-span-2">
                  <Textarea value={technicalDescription} onChange={(e) => setTechnicalDescription(e.target.value)} rows={2} maxLength={2000} />
                </FormField>
              </FormGrid>
            </FormSection>

            <FormSection
              title="Intervalo e bandas"
              description="Informe KM, dias ou ambos (vale o que vencer antes). As bandas são percentuais do intervalo."
            >
              <FormGrid columns={3}>
                <FormField label="A cada (KM)" error={kmInvalid ? "Entre 100 e 1.000.000 km." : undefined}>
                  <Input inputMode="numeric" value={intervalKm} onChange={(e) => setIntervalKm(e.target.value)} trailingAddon="km" placeholder="20000" />
                </FormField>
                <FormField label="A cada (dias)" helperText="Ex.: 90, 180, 365." error={daysInvalid ? "Entre 1 e 3.650 dias." : undefined}>
                  <Input inputMode="numeric" value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} trailingAddon="dias" />
                </FormField>
                <FormField
                  label="Horas de motor"
                  helperText="Registrada para uso futuro: ainda não entra no cálculo."
                  error={hoursInvalid ? "Entre 1 e 100.000 h." : undefined}
                >
                  <Input inputMode="numeric" value={engineHours} onChange={(e) => setEngineHours(e.target.value)} trailingAddon="h" />
                </FormField>
                <FormField
                  label="Alerta"
                  required
                  helperText="Faltando isto do intervalo: Próximo."
                  error={pctInvalid(alert) ? "De 0 a 100%." : undefined}
                >
                  <Input inputMode="decimal" value={alertPct} onChange={(e) => setAlertPct(e.target.value)} trailingAddon="%" />
                </FormField>
                <FormField
                  label="Programar"
                  required
                  helperText="Faltando isto: A programar."
                  error={pctInvalid(schedule) ? "De 0 a 100%." : bandsInvalid ? "Precisa ser menor ou igual ao alerta." : undefined}
                >
                  <Input inputMode="decimal" value={schedulePct} onChange={(e) => setSchedulePct(e.target.value)} trailingAddon="%" />
                </FormField>
                <FormField
                  label="Tolerância"
                  required
                  helperText="Depois do marco, até isto: Vencido; além: Crítico."
                  error={pctInvalid(tolerance) ? "De 0 a 100%." : undefined}
                >
                  <Input inputMode="decimal" value={tolerancePct} onChange={(e) => setTolerancePct(e.target.value)} trailingAddon="%" />
                </FormField>
              </FormGrid>
              {intervalMissing ? (
                <p className="text-helper text-danger" role="alert">
                  Informe o intervalo em KM, em dias, ou ambos.
                </p>
              ) : null}
            </FormSection>

            <FormSection
              title="Roteiro técnico"
              description="Passos da verificação, na ordem em que o técnico os executa. A chave identifica o passo nas respostas; não a troque depois de usada."
            >
              {steps.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-3 text-caption text-fg-muted">Sem passos cadastrados.</p>
              ) : (
                <ol className="flex flex-col gap-2" data-testid="maintenance-plan-item-steps">
                  {steps.map((step, index) => {
                    const duplicateKey = stepKeys[index] && stepKeys.indexOf(stepKeys[index]) !== index;
                    return (
                      <li key={step.uid} className="flex flex-col gap-2 rounded-md border border-border bg-surface p-2 sm:flex-row sm:items-start">
                        <span className="w-6 shrink-0 pt-2 text-caption font-semibold tabular-nums text-fg-muted">{index + 1}.</span>
                        <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-[1fr_11rem]">
                          <Input
                            size="sm"
                            aria-label={`Descrição do passo ${index + 1}`}
                            value={step.description}
                            onChange={(e) => updateStep(step.uid, { description: e.target.value })}
                            onBlur={() => fillKey(step.uid)}
                            maxLength={300}
                            placeholder="Medir a espessura das lonas"
                            aria-invalid={step.description.trim().length < 2 || undefined}
                          />
                          <Input
                            size="sm"
                            aria-label={`Chave do passo ${index + 1}`}
                            value={step.key}
                            onChange={(e) => updateStep(step.uid, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
                            maxLength={60}
                            placeholder="chave_do_passo"
                            className="font-mono"
                            aria-invalid={duplicateKey || undefined}
                            title={duplicateKey ? "Chave repetida" : undefined}
                          />
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <div className="flex items-center gap-1.5 px-1">
                            <Checkbox
                              id={`${step.uid}-required`}
                              checked={step.required}
                              onCheckedChange={(c) => updateStep(step.uid, { required: c === true })}
                            />
                            <label htmlFor={`${step.uid}-required`} className="cursor-pointer text-caption text-fg">
                              Obrigatório
                            </label>
                          </div>
                          <IconButton size="sm" label={`Subir passo ${index + 1}`} disabled={index === 0} onClick={() => moveStep(index, -1)}>
                            <ArrowUp aria-hidden />
                          </IconButton>
                          <IconButton
                            size="sm"
                            label={`Descer passo ${index + 1}`}
                            disabled={index === steps.length - 1}
                            onClick={() => moveStep(index, 1)}
                          >
                            <ArrowDown aria-hidden />
                          </IconButton>
                          <IconButton
                            size="sm"
                            variant="danger"
                            label={`Remover passo ${index + 1}`}
                            onClick={() => setSteps((list) => list.filter((s) => s.uid !== step.uid))}
                          >
                            <Trash2 aria-hidden />
                          </IconButton>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-caption text-fg-muted" aria-live="polite">
                  {stepsInvalid ? "Cada passo precisa de descrição e de uma chave única." : `${formatInt(steps.length)} passo(s).`}
                </p>
                <Button size="sm" variant="secondary" leadingIcon={<Plus />} onClick={addStep}>
                  Adicionar passo
                </Button>
              </div>
            </FormSection>

            <FormSection
              title="Cobertura técnica"
              description="Serviços cuja conclusão atende este item. A conclusão de um serviço com cobertura total reinicia o ciclo do item; a parcial fica registrada, mas não reinicia."
            >
              {coverage.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-3 text-caption text-fg-muted">
                  Nenhum serviço cobre este item: o ciclo só reinicia por verificação conforme ou reinício manual.
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-border-subtle rounded-md border border-border bg-surface" data-testid="maintenance-plan-item-coverage">
                  {coverage.map((c) => {
                    const label = serviceName.get(c.serviceId) ?? itemServices.get(c.serviceId) ?? "Serviço";
                    return (
                      <li key={c.serviceId} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                        <span className="min-w-0 flex-1 truncate text-body-sm text-fg" title={label}>
                          {label}
                        </span>
                        <NativeSelect
                          fieldSize="sm"
                          aria-label={`Cobertura de ${label}`}
                          value={c.coverage}
                          onChange={(e) =>
                            setCoverage((list) =>
                              list.map((x) => (x.serviceId === c.serviceId ? { ...x, coverage: e.target.value as "full" | "partial" } : x)),
                            )
                          }
                          className="w-32"
                        >
                          <option value="full">Total</option>
                          <option value="partial">Parcial</option>
                        </NativeSelect>
                        <IconButton
                          size="sm"
                          variant="danger"
                          label={`Remover ${label} da cobertura`}
                          onClick={() => setCoverage((list) => list.filter((x) => x.serviceId !== c.serviceId))}
                        >
                          <Trash2 aria-hidden />
                        </IconButton>
                      </li>
                    );
                  })}
                </ul>
              )}
              {!readOnly ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <FormField label="Serviço" className="min-w-0 flex-1">
                    <NativeSelect fieldSize="sm" value={newCoverageService} onChange={(e) => setNewCoverageService(e.target.value)}>
                      <option value="">Selecione</option>
                      {coverageChoices.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.clusterName} · {s.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormField>
                  <FormField label="Cobertura" className="sm:w-36">
                    <NativeSelect
                      fieldSize="sm"
                      value={newCoverageKind}
                      onChange={(e) => setNewCoverageKind(e.target.value as "full" | "partial")}
                    >
                      <option value="full">Total</option>
                      <option value="partial">Parcial</option>
                    </NativeSelect>
                  </FormField>
                  <Button
                    size="sm"
                    variant="secondary"
                    leadingIcon={<Plus />}
                    disabled={!newCoverageService}
                    onClick={() => {
                      if (!newCoverageService) return;
                      setCoverage((list) => [...list, { serviceId: newCoverageService, coverage: newCoverageKind }]);
                      setNewCoverageService("");
                    }}
                  >
                    Incluir
                  </Button>
                </div>
              ) : null}
              {coverageDirty && !readOnly ? (
                <p className="text-caption text-fg-secondary">Cobertura alterada: é gravada junto com o item (não gera versão).</p>
              ) : null}
            </FormSection>

            {needsReason ? (
              <div className="flex flex-col gap-3">
                <Alert variant="warning" icon={<RotateCcw />}>
                  <AlertTitle>Plano aprovado: esta alteração publica a versão v{plan.version + 1}</AlertTitle>
                  <AlertDescription>
                    {item
                      ? "Intervalo, bandas, cluster ou ativação mudaram. Os ciclos dos veículos do plano são recalculados."
                      : "Incluir item num plano aprovado publica nova versão e recalcula os ciclos dos veículos."}
                  </AlertDescription>
                </Alert>
                <FormField
                  label="Motivo da alteração"
                  required
                  helperText="Fica no histórico de versões do plano."
                  error={reasonInvalid && reason.length > 0 ? "Descreva o motivo em pelo menos 5 caracteres." : undefined}
                >
                  <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    maxLength={1000}
                    placeholder="Ex.: fabricante reduziu o intervalo de troca para 15.000 km."
                    data-testid="maintenance-plan-item-reason"
                  />
                </FormField>
              </div>
            ) : null}
          </FormFieldset>
        </DrawerBody>
        <FormFooter readOnly={readOnly} saving={saving} disabled={!canSubmit} onClose={onClose} />
      </form>
    </>
  );
}
