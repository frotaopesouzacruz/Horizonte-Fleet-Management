"use client";

import * as React from "react";
import { Info, Save } from "lucide-react";
import {
  Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { SwitchField } from "@/components/ui/switch";
import { StatusBadge } from "@/components/ui/status-badge";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import { NativeSelect } from "@/components/governance/selects";
import { cn } from "@/lib/cn";
import {
  saveMaintenanceCluster, saveMaintenanceOrigin, saveMaintenanceSettings, saveMaintenanceSupplier, savePreventiveRule,
  type Result,
} from "@/lib/maintenance/actions";
import type { MaintenanceFilterOptions } from "@/lib/maintenance/queries";
import {
  CRITICALITY_LABEL, formatInt, formatKm,
  type Criticality, type MaintenanceCatalog, type MaintenanceCluster, type MaintenanceOrigin, type MaintenanceSettings,
  type MaintenanceSupplier, type PreventiveRule,
} from "@/lib/maintenance/types";

/**
 * Formulários dos Cadastros da Manutenção (clusters, fornecedores, origens,
 * configurações e parâmetros preventivos) e as peças que os outros
 * formulários do módulo reaproveitam.
 *
 * Toda gravação é uma rotina do banco: a tela confere o óbvio (campo
 * obrigatório, número no formato) para poupar uma ida ao servidor, e mostra
 * a mensagem do banco como ela vier — já escrita para quem opera.
 */

// ---------------------------------------------------------------------------
// Peças compartilhadas
// ---------------------------------------------------------------------------
export const CRITICALITIES = Object.keys(CRITICALITY_LABEL) as Criticality[];

/** Chamada de action que nunca rejeita: falha de rede vira mensagem. */
export async function safeCall<T>(call: () => Promise<Result<T>>, fallback: string): Promise<Result<T>> {
  try {
    return await call();
  } catch {
    return { ok: false, error: fallback };
  }
}

/** "10.000" → 10000; vazio → null. Só dígitos: KM, dias, ciclos, ordem. */
export function parseIntField(value: string): number | null {
  const digits = value.replace(/\D/g, "");
  return digits ? Number(digits) : null;
}

/** "5,5" → 5.5; vazio ou inválido → null. */
export function parseDecimalField(value: string): number | null {
  const text = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** Número → texto de campo, com vírgula decimal. */
export const numberText = (value: number | null | undefined) => (value == null ? "" : String(value).replace(".", ","));

/** CNPJ/CPF formatado; outro tamanho aparece como veio. */
export function formatDocument(doc: string | null | undefined): string {
  const d = (doc ?? "").replace(/\D/g, "");
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return doc || "—";
}

export function SituationBadge({ active, feminine = false }: { active: boolean; feminine?: boolean }) {
  const label = active ? (feminine ? "Ativa" : "Ativo") : feminine ? "Inativa" : "Inativo";
  return (
    <StatusBadge status={active ? "success" : "neutral"} size="sm">
      {label}
    </StatusBadge>
  );
}

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="text-h4 font-semibold text-fg">{title}</h3>
        {description ? <p className="text-caption text-fg-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function FormErrorAlert({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <Alert variant="danger">
      <AlertTitle>Não foi possível salvar</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}

export function ReadOnlyAlert({ what }: { what: string }) {
  return (
    <Alert variant="neutral" icon={<Info />}>
      <AlertDescription>Modo leitura: você não tem permissão para alterar {what}.</AlertDescription>
    </Alert>
  );
}

/** Em modo leitura o formulário inteiro fica desabilitado de uma vez. */
export function FormFieldset({ readOnly, className, children }: { readOnly: boolean; className?: string; children: React.ReactNode }) {
  return (
    <fieldset disabled={readOnly} className={cn("m-0 flex min-w-0 flex-col gap-6 border-0 p-0", className)}>
      {children}
    </fieldset>
  );
}

export function FormFooter({
  readOnly,
  saving,
  disabled,
  onClose,
  submitLabel = "Salvar",
}: {
  readOnly: boolean;
  saving: boolean;
  disabled?: boolean;
  onClose: () => void;
  submitLabel?: string;
}) {
  return (
    <DrawerFooter>
      <Button variant="outline" onClick={onClose} disabled={saving}>
        {readOnly ? "Fechar" : "Cancelar"}
      </Button>
      {!readOnly ? (
        <Button type="submit" leadingIcon={<Save />} loading={saving} disabled={disabled} data-testid="maintenance-form-save">
          {submitLabel}
        </Button>
      ) : null}
    </DrawerFooter>
  );
}

/**
 * A gaveta só monta o formulário quando está aberta: cada abertura começa do
 * registro escolhido, sem estado herdado da anterior.
 */
export function FormDrawer({
  open,
  onOpenChange,
  size = "lg",
  testId,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  size?: "sm" | "md" | "lg" | "xl";
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent size={size} data-testid={testId}>
        {open ? children : null}
      </DrawerContent>
    </Drawer>
  );
}

export function CriticalitySelect({
  value,
  onChange,
  ...props
}: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange" | "size"> & {
  value: string;
  onChange: (value: Criticality) => void;
}) {
  return (
    <NativeSelect value={value} onChange={(e) => onChange(e.target.value as Criticality)} {...props}>
      {CRITICALITIES.map((c) => (
        <option key={c} value={c}>
          {CRITICALITY_LABEL[c]}
        </option>
      ))}
    </NativeSelect>
  );
}

export function StatusSelect({
  value,
  onChange,
  feminine = false,
  ...props
}: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange" | "size"> & {
  value: string;
  onChange: (value: "active" | "inactive") => void;
  feminine?: boolean;
}) {
  return (
    <NativeSelect value={value} onChange={(e) => onChange(e.target.value as "active" | "inactive")} {...props}>
      <option value="active">{feminine ? "Ativa" : "Ativo"}</option>
      <option value="inactive">{feminine ? "Inativa" : "Inativo"}</option>
    </NativeSelect>
  );
}

export interface CheckOption {
  id: string;
  label: string;
  group?: string;
  hint?: string;
}

/**
 * Lista de marcação para escolhas múltiplas (tipos, clusters, cidades…).
 * Nativa e sem portal: dentro de uma gaveta, abre sempre.
 */
export function CheckboxList({
  label,
  helper,
  options,
  value,
  onChange,
  emptyText = "Nada para escolher.",
  extra,
  testId,
}: {
  label: string;
  helper?: React.ReactNode;
  options: CheckOption[];
  value: string[];
  onChange: (next: string[]) => void;
  emptyText?: string;
  /** Linha extra sob a lista (ex.: itens mantidos fora das opções). */
  extra?: React.ReactNode;
  testId?: string;
}) {
  const baseId = React.useId();
  const helperId = helper ? `${baseId}-helper` : undefined;
  const selected = new Set(value);
  const visibleSelected = options.filter((o) => selected.has(o.id)).length;
  const toggle = (id: string, checked: boolean) =>
    onChange(checked ? [...value.filter((v) => v !== id), id] : value.filter((v) => v !== id));

  const groups: { name: string | undefined; items: CheckOption[] }[] = [];
  for (const option of options) {
    const last = groups[groups.length - 1];
    if (last && last.name === option.group) last.items.push(option);
    else groups.push({ name: option.group, items: [option] });
  }

  return (
    <fieldset className="m-0 min-w-0 border-0 p-0" aria-describedby={helperId} data-testid={testId}>
      <legend className="mb-1.5 text-label font-medium text-fg">{label}</legend>
      <div className="max-h-52 overflow-y-auto rounded-sm border border-border bg-surface p-1">
        {options.length === 0 ? (
          <p className="px-2 py-3 text-caption text-fg-muted">{emptyText}</p>
        ) : (
          groups.map((group, gi) => (
            <div key={`${group.name ?? ""}-${gi}`} role={group.name ? "group" : undefined} aria-label={group.name}>
              {group.name ? (
                <p className="px-1.5 pt-1.5 pb-0.5 text-overline font-semibold tracking-wide text-fg-muted uppercase">{group.name}</p>
              ) : null}
              {group.items.map((option) => {
                const id = `${baseId}-${option.id}`;
                return (
                  <div key={option.id} className="flex min-h-8 items-center gap-2 rounded-xs px-1.5 hover:bg-hover-overlay">
                    <Checkbox
                      id={id}
                      checked={selected.has(option.id)}
                      onCheckedChange={(checked) => toggle(option.id, checked === true)}
                    />
                    <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2 py-1 text-body-sm text-fg">
                      <span className="truncate">{option.label}</span>
                      {option.hint ? <span className="shrink-0 text-caption text-fg-muted">{option.hint}</span> : null}
                    </label>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-caption text-fg-muted">
        <span aria-live="polite">
          {visibleSelected === 0 ? "Nenhum marcado" : `${formatInt(visibleSelected)} marcado(s)`}
        </span>
        {value.length > 0 ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="rounded-xs px-1 font-medium text-link hover:underline hfm-focus-ring disabled:text-fg-disabled disabled:no-underline"
          >
            Desmarcar todos
          </button>
        ) : null}
      </div>
      {extra ? <p className="mt-0.5 text-caption text-fg-muted">{extra}</p> : null}
      {helper ? (
        <p id={helperId} className="mt-0.5 text-helper text-fg-muted">
          {helper}
        </p>
      ) : null}
    </fieldset>
  );
}

/**
 * Pede um motivo antes de uma mudança que fica na trilha (situação de plano,
 * nova versão). O diálogo só fecha quando `onConfirm` devolve `true`: uma
 * recusa do banco mantém o motivo digitado para a próxima tentativa.
 */
export function ReasonPromptDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirmar",
  minLength = 5,
  placeholder = "Ex.: revisão do manual do fabricante, edição 2026.",
  hint = "Fica registrado no histórico, com o autor e a data.",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: string;
  minLength?: number;
  placeholder?: string;
  hint?: React.ReactNode;
  onConfirm: (reason: string) => Promise<boolean>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        {open ? (
          <ReasonPromptBody
            title={title}
            description={description}
            confirmLabel={confirmLabel}
            minLength={minLength}
            placeholder={placeholder}
            hint={hint}
            onConfirm={onConfirm}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ReasonPromptBody({
  title,
  description,
  confirmLabel,
  minLength,
  placeholder,
  hint,
  onConfirm,
  onClose,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel: string;
  minLength: number;
  placeholder: string;
  hint: React.ReactNode;
  onConfirm: (reason: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [reason, setReason] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const trimmed = reason.trim();
  const invalid = trimmed.length < minLength;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    if (invalid || busy) return;
    setBusy(true);
    const done = await onConfirm(trimmed);
    setBusy(false);
    if (done) onClose();
  };

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" aria-busy={busy}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
      </DialogHeader>
      <DialogBody>
        <FormField
          label="Motivo"
          required
          helperText={hint}
          error={touched && invalid ? `Descreva o motivo em pelo menos ${minLength} caracteres.` : undefined}
        >
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            rows={3}
            maxLength={1000}
            placeholder={placeholder}
          />
        </FormField>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button type="submit" loading={busy} disabled={invalid}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Cluster
// ---------------------------------------------------------------------------
export function ClusterFormDrawer({
  open,
  cluster,
  readOnly,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  cluster: MaintenanceCluster | null;
  readOnly: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <FormDrawer open={open} onOpenChange={onOpenChange} size="md" testId="maintenance-cluster-form">
      <ClusterForm
        key={cluster?.id ?? "novo"}
        cluster={cluster}
        readOnly={readOnly}
        onClose={() => onOpenChange(false)}
        onSaved={onSaved}
      />
    </FormDrawer>
  );
}

function ClusterForm({
  cluster,
  readOnly,
  onClose,
  onSaved,
}: {
  cluster: MaintenanceCluster | null;
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = React.useState(cluster?.name ?? "");
  const [code, setCode] = React.useState(cluster?.code ?? "");
  const [description, setDescription] = React.useState(cluster?.description ?? "");
  const [criticality, setCriticality] = React.useState<Criticality>(cluster?.defaultCriticality ?? "medium");
  const [status, setStatus] = React.useState<"active" | "inactive">(cluster?.status ?? "active");
  const [sortOrder, setSortOrder] = React.useState(String(cluster?.sortOrder ?? 100));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const codeInvalid = !cluster && code.trim() !== "" && !/^[A-Z0-9][A-Z0-9_]{1,39}$/.test(code.trim());
  const canSubmit = name.trim().length >= 2 && !codeInvalid;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly || saving || !canSubmit) return;
    setSaving(true);
    setError(null);
    const result = await safeCall(
      () =>
        saveMaintenanceCluster({
          id: cluster?.id,
          name: name.trim(),
          // O identificador técnico não muda depois de criado: só vai na criação.
          code: cluster ? undefined : code.trim() || undefined,
          description: description.trim() || null,
          default_criticality: criticality,
          status,
          sort_order: parseIntField(sortOrder) ?? 100,
        }),
      "Não foi possível salvar o cluster.",
    );
    setSaving(false);
    if (!result.ok) {
      const message = result.error ?? "Não foi possível salvar o cluster.";
      setError(message);
      toast({ title: message, variant: "danger" });
      return;
    }
    toast({ title: cluster ? "Cluster atualizado." : "Cluster criado.", variant: "success" });
    onSaved();
    onClose();
  };

  return (
    <>
      <DrawerHeader>
        <DrawerTitle>{cluster ? (readOnly ? "Cluster técnico" : "Editar cluster técnico") : "Novo cluster técnico"}</DrawerTitle>
        <DrawerDescription>
          Agrupador técnico dos serviços (Motor, Freios, Elétrica…). Todo serviço pertence a um cluster.
        </DrawerDescription>
      </DrawerHeader>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" aria-busy={saving}>
        <DrawerBody className="flex flex-col gap-5">
          {readOnly ? <ReadOnlyAlert what="clusters" /> : null}
          <FormErrorAlert error={error} />
          <FormFieldset readOnly={readOnly}>
            <FormGrid columns={2}>
              <FormField label="Nome" required className="sm:col-span-2">
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Freios" required />
              </FormField>
              <FormField
                label="Identificador técnico"
                helperText={
                  cluster
                    ? "Não muda depois de criado: é a chave usada por importações e integrações."
                    : "Vazio = gerado a partir do nome. Maiúsculas, números e _. Não muda depois de criado."
                }
                error={codeInvalid ? "Use de 2 a 40 caracteres: letras maiúsculas, números e _." : undefined}
              >
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s+/g, "_"))}
                  disabled={Boolean(cluster)}
                  maxLength={40}
                  placeholder="FREIOS"
                  className="font-mono"
                />
              </FormField>
              <FormField label="Criticidade padrão" helperText="Sugerida aos serviços novos do cluster.">
                <CriticalitySelect value={criticality} onChange={setCriticality} />
              </FormField>
              <FormField
                label="Situação"
                helperText="Inativar exige que não haja serviços ativos no cluster."
              >
                <StatusSelect value={status} onChange={setStatus} />
              </FormField>
              <FormField label="Ordem de exibição" helperText="Menor aparece antes.">
                <Input
                  inputMode="numeric"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value.replace(/\D/g, ""))}
                  maxLength={4}
                />
              </FormField>
              <FormField label="Descrição" className="sm:col-span-2">
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={500} />
              </FormField>
            </FormGrid>
          </FormFieldset>
        </DrawerBody>
        <FormFooter readOnly={readOnly} saving={saving} disabled={!canSubmit} onClose={onClose} />
      </form>
    </>
  );
}

// ---------------------------------------------------------------------------
// Fornecedor
// ---------------------------------------------------------------------------
export function SupplierFormDrawer({
  open,
  supplier,
  catalog,
  options,
  readOnly,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  supplier: MaintenanceSupplier | null;
  catalog: MaintenanceCatalog;
  options: MaintenanceFilterOptions;
  readOnly: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <FormDrawer open={open} onOpenChange={onOpenChange} size="lg" testId="maintenance-supplier-form">
      <SupplierForm
        key={supplier?.id ?? "novo"}
        supplier={supplier}
        catalog={catalog}
        options={options}
        readOnly={readOnly}
        onClose={() => onOpenChange(false)}
        onSaved={onSaved}
      />
    </FormDrawer>
  );
}

interface CityOption {
  id: number;
  name: string;
  stateId: number;
  uf: string;
}

function SupplierForm({
  supplier,
  catalog,
  options,
  readOnly,
  onClose,
  onSaved,
}: {
  supplier: MaintenanceSupplier | null;
  catalog: MaintenanceCatalog;
  options: MaintenanceFilterOptions;
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = React.useState(supplier?.name ?? "");
  const [tradeName, setTradeName] = React.useState(supplier?.tradeName ?? "");
  const [documentNumber, setDocumentNumber] = React.useState(formatDocument(supplier?.documentNumber).replace("—", ""));
  const [address, setAddress] = React.useState(supplier?.address ?? "");
  const [stateId, setStateId] = React.useState(supplier?.stateId != null ? String(supplier.stateId) : "");
  const [cityId, setCityId] = React.useState(supplier?.cityId != null ? String(supplier.cityId) : "");
  const [clusterIds, setClusterIds] = React.useState<string[]>(supplier?.clusterIds ?? []);
  const [serviceIds, setServiceIds] = React.useState<string[]>(supplier?.serviceIds ?? []);
  const [servedCityIds, setServedCityIds] = React.useState<string[]>((supplier?.servedCityIds ?? []).map(String));
  const [status, setStatus] = React.useState<"active" | "inactive">(supplier?.status ?? "active");
  const [notes, setNotes] = React.useState(supplier?.notes ?? "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  /** UF e cidade vêm da cobertura das operações — a mesma geografia do resto do sistema. */
  const geography = React.useMemo(() => {
    const states = new Map<number, string>();
    const cities = new Map<number, CityOption>();
    for (const c of options.coverage) {
      states.set(c.stateId, c.uf);
      cities.set(c.cityId, { id: c.cityId, name: c.cityName, stateId: c.stateId, uf: c.uf });
    }
    // A cidade atual do fornecedor pode estar fora da cobertura: continua escolhível.
    if (supplier?.stateId != null && supplier.stateUf) states.set(supplier.stateId, supplier.stateUf);
    if (supplier?.cityId != null && supplier.cityName && supplier.stateId != null) {
      cities.set(supplier.cityId, { id: supplier.cityId, name: supplier.cityName, stateId: supplier.stateId, uf: supplier.stateUf ?? "" });
    }
    return {
      states: [...states.entries()].map(([id, uf]) => ({ id, uf })).sort((a, b) => a.uf.localeCompare(b.uf)),
      cities: [...cities.values()].sort((a, b) => a.uf.localeCompare(b.uf) || a.name.localeCompare(b.name, "pt-BR")),
    };
  }, [options.coverage, supplier]);

  const citiesOfState = geography.cities.filter((c) => String(c.stateId) === stateId);
  const coverageCityIds = new Set(geography.cities.map((c) => String(c.id)));
  const hiddenServed = servedCityIds.filter((id) => !coverageCityIds.has(id)).length;

  const clusterOptions: CheckOption[] = catalog.clusters
    .filter((c) => c.status === "active" || clusterIds.includes(c.id))
    .map((c) => ({ id: c.id, label: c.name, hint: c.status === "inactive" ? "inativo" : undefined }));
  const serviceOptions: CheckOption[] = catalog.services
    .filter(
      (s) =>
        serviceIds.includes(s.id) ||
        (s.status === "active" && (clusterIds.length === 0 || clusterIds.includes(s.clusterId))),
    )
    .map((s) => ({ id: s.id, label: s.name, group: s.clusterName, hint: s.status === "inactive" ? "inativo" : undefined }));
  const servedOptions: CheckOption[] = geography.cities.map((c) => ({ id: String(c.id), label: c.name, group: c.uf }));

  const docDigits = documentNumber.replace(/\D/g, "");
  const docInvalid = docDigits.length > 0 && docDigits.length !== 11 && docDigits.length !== 14;
  const canSubmit = name.trim().length >= 2 && !docInvalid;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly || saving || !canSubmit) return;
    setSaving(true);
    setError(null);
    const result = await safeCall(
      () =>
        saveMaintenanceSupplier({
          id: supplier?.id,
          name: name.trim(),
          trade_name: tradeName.trim() || null,
          document_number: docDigits || null,
          address: address.trim() || null,
          state_id: stateId ? Number(stateId) : null,
          city_id: cityId ? Number(cityId) : null,
          cluster_ids: clusterIds,
          service_ids: serviceIds,
          served_city_ids: servedCityIds.map(Number),
          status,
          notes: notes.trim() || null,
        }),
      "Não foi possível salvar o fornecedor.",
    );
    setSaving(false);
    if (!result.ok) {
      const message = result.error ?? "Não foi possível salvar o fornecedor.";
      setError(message);
      toast({ title: message, variant: "danger" });
      return;
    }
    toast({ title: supplier ? "Fornecedor atualizado." : "Fornecedor cadastrado.", variant: "success" });
    onSaved();
    onClose();
  };

  return (
    <>
      <DrawerHeader>
        <DrawerTitle>{supplier ? (readOnly ? "Fornecedor" : "Editar fornecedor") : "Novo fornecedor"}</DrawerTitle>
        <DrawerDescription>
          Oficina ou prestador. A base de manutenções e o agendamento só aceitam fornecedores cadastrados aqui.
        </DrawerDescription>
      </DrawerHeader>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" aria-busy={saving}>
        <DrawerBody className="flex flex-col gap-6">
          {readOnly ? <ReadOnlyAlert what="fornecedores" /> : null}
          <FormErrorAlert error={error} />
          <FormFieldset readOnly={readOnly}>
            <FormSection title="Identificação">
              <FormGrid columns={2}>
                <FormField label="Razão social ou nome" required className="sm:col-span-2">
                  <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} required />
                </FormField>
                <FormField label="Nome fantasia">
                  <Input value={tradeName} onChange={(e) => setTradeName(e.target.value)} maxLength={160} />
                </FormField>
                <FormField
                  label="CNPJ/CPF"
                  helperText="11 dígitos (CPF) ou 14 (CNPJ). Gravado só com os números."
                  error={docInvalid ? "Informe 11 dígitos (CPF) ou 14 (CNPJ)." : undefined}
                >
                  <Input
                    inputMode="numeric"
                    value={documentNumber}
                    onChange={(e) => setDocumentNumber(e.target.value.replace(/[^\d./-]/g, ""))}
                    onBlur={() => {
                      if (docDigits.length === 11 || docDigits.length === 14) setDocumentNumber(formatDocument(docDigits));
                    }}
                    maxLength={18}
                    placeholder="00.000.000/0000-00"
                    className="tabular-nums"
                  />
                </FormField>
                <FormField label="Situação">
                  <StatusSelect value={status} onChange={setStatus} />
                </FormField>
              </FormGrid>
            </FormSection>

            <FormSection
              title="Endereço"
              description="UF e cidade das operações cadastradas. A cidade precisa pertencer à UF escolhida."
            >
              <FormGrid columns={2}>
                <FormField label="Endereço" className="sm:col-span-2">
                  <Input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} placeholder="Rua, número, bairro" />
                </FormField>
                <FormField label="UF">
                  <NativeSelect
                    value={stateId}
                    onChange={(e) => {
                      setStateId(e.target.value);
                      setCityId("");
                    }}
                  >
                    <option value="">Não informada</option>
                    {geography.states.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.uf}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField label="Cidade" helperText={stateId ? undefined : "Escolha a UF primeiro."}>
                  <NativeSelect value={cityId} onChange={(e) => setCityId(e.target.value)} disabled={!stateId}>
                    <option value="">{stateId ? "Não informada" : "Escolha a UF"}</option>
                    {citiesOfState.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
              </FormGrid>
            </FormSection>

            <FormSection
              title="Atendimento"
              description="O que o fornecedor atende e onde. Ajuda a sugerir o fornecedor certo no agendamento."
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <CheckboxList
                  label="Clusters atendidos"
                  options={clusterOptions}
                  value={clusterIds}
                  onChange={setClusterIds}
                  emptyText="Nenhum cluster cadastrado."
                  testId="maintenance-supplier-clusters"
                />
                <CheckboxList
                  label="Serviços específicos"
                  helper={clusterIds.length ? "Só os serviços dos clusters marcados." : "Opcional. Marque clusters para filtrar."}
                  options={serviceOptions}
                  value={serviceIds}
                  onChange={setServiceIds}
                  emptyText="Nenhum serviço nos clusters marcados."
                />
              </div>
              <CheckboxList
                label="Cidades atendidas"
                options={servedOptions}
                value={servedCityIds}
                onChange={setServedCityIds}
                emptyText="Nenhuma cidade na cobertura das operações."
                extra={hiddenServed > 0 ? `${formatInt(hiddenServed)} cidade(s) fora da cobertura atual, mantida(s).` : undefined}
              />
            </FormSection>

            <FormField label="Observações">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} />
            </FormField>
          </FormFieldset>
        </DrawerBody>
        <FormFooter readOnly={readOnly} saving={saving} disabled={!canSubmit} onClose={onClose} />
      </form>
    </>
  );
}

// ---------------------------------------------------------------------------
// Origem
// ---------------------------------------------------------------------------
export function OriginFormDrawer({
  open,
  origin,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  origin: MaintenanceOrigin | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <FormDrawer open={open} onOpenChange={onOpenChange} size="md" testId="maintenance-origin-form">
      <OriginForm key={origin?.id ?? "nova"} origin={origin} onClose={() => onOpenChange(false)} onSaved={onSaved} />
    </FormDrawer>
  );
}

function OriginForm({ origin, onClose, onSaved }: { origin: MaintenanceOrigin | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [name, setName] = React.useState(origin?.name ?? "");
  const [description, setDescription] = React.useState(origin?.description ?? "");
  const [active, setActive] = React.useState(origin?.isActive ?? true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const canSubmit = name.trim().length >= 2;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !canSubmit) return;
    setSaving(true);
    setError(null);
    const result = await safeCall(
      () => saveMaintenanceOrigin({ id: origin?.id, name: name.trim(), description: description.trim() || null, is_active: active }),
      "Não foi possível salvar a origem.",
    );
    setSaving(false);
    if (!result.ok) {
      const message = result.error ?? "Não foi possível salvar a origem.";
      setError(message);
      toast({ title: message, variant: "danger" });
      return;
    }
    toast({ title: origin ? "Origem atualizada." : "Origem criada.", variant: "success" });
    onSaved();
    onClose();
  };

  return (
    <>
      <DrawerHeader>
        <DrawerTitle>{origin ? "Editar origem" : "Nova origem da organização"}</DrawerTitle>
        <DrawerDescription>
          De onde veio a demanda de manutenção. As origens do sistema (Check List, preventiva, preditiva…) são fixas.
        </DrawerDescription>
      </DrawerHeader>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" aria-busy={saving}>
        <DrawerBody className="flex flex-col gap-5">
          <FormErrorAlert error={error} />
          <FormGrid columns={1}>
            <FormField label="Nome" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Solicitação do cliente" required />
            </FormField>
            {origin ? (
              <FormField label="Código" helperText="Gerado a partir do nome na criação.">
                <Input value={origin.code} disabled className="font-mono" />
              </FormField>
            ) : null}
            <FormField label="Descrição">
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={500} />
            </FormField>
            <SwitchField
              label="Ativa"
              description="Origens inativas deixam de ser oferecidas na abertura; o histórico continua com elas."
              checked={active}
              onCheckedChange={setActive}
            />
          </FormGrid>
        </DrawerBody>
        <FormFooter readOnly={false} saving={saving} disabled={!canSubmit} onClose={onClose} />
      </form>
    </>
  );
}

// ---------------------------------------------------------------------------
// Configurações
// ---------------------------------------------------------------------------
/** "2, 5, 10, 20" → [2, 5, 10, 20], com a mesma regra do banco (crescentes, 1 a 8). */
export function parseAgingBuckets(text: string): { values: number[]; error: string | null } {
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  if (!parts.length) return { values: [], error: "Informe ao menos um limite." };
  const values = parts.map(Number);
  if (values.some((v) => !Number.isInteger(v) || v <= 0)) return { values, error: "Use dias inteiros maiores que zero." };
  if (values.length > 8) return { values, error: "No máximo 8 limites." };
  for (let i = 1; i < values.length; i++) {
    if (values[i] <= values[i - 1]) return { values, error: "Os limites precisam ser crescentes." };
  }
  return { values, error: null };
}

/** [2, 5, 10, 20] → ["0–2", "3–5", "6–10", "11–20", ">20"]. */
export function agingLabels(values: number[]): string[] {
  if (!values.length) return [];
  const out: string[] = [];
  let from = 0;
  for (const v of values) {
    out.push(`${from}–${v}`);
    from = v + 1;
  }
  out.push(`>${values[values.length - 1]}`);
  return out;
}

type SettingKey =
  | "recurrence_window_days" | "km_compatible_days" | "km_estimated_max_days" | "default_sla_hours"
  | "schedule_overdue_days" | "predictive_forecast_km" | "predictive_forecast_days";

export const SETTING_FIELDS: {
  key: SettingKey;
  prop: keyof MaintenanceSettings;
  label: string;
  unit: string;
  min: number;
  max: number;
  decimal?: boolean;
  helper: string;
}[] = [
  {
    key: "recurrence_window_days", prop: "recurrenceWindowDays", label: "Janela de reincidência", unit: "dias", min: 1, max: 365,
    helper: "Nova manutenção do mesmo cluster no mesmo veículo dentro desta janela conta como reincidência.",
  },
  {
    key: "km_compatible_days", prop: "kmCompatibleDays", label: "KM compatível", unit: "dias", min: 0, max: 30,
    helper: "Leitura oficial até esta distância da data de referência vale como KM compatível.",
  },
  {
    key: "km_estimated_max_days", prop: "kmEstimatedMaxDays", label: "KM estimado (distância máx.)", unit: "dias", min: 1, max: 365,
    helper: "Além desta distância das leituras oficiais, o KM fica \"A revisar\" em vez de estimado.",
  },
  {
    key: "default_sla_hours", prop: "defaultSlaHours", label: "SLA padrão", unit: "h", min: 1, max: 2000, decimal: true,
    helper: "Em execução há mais tempo que a soma das horas previstas dos serviços; sem horas previstas, vale este SLA.",
  },
  {
    key: "schedule_overdue_days", prop: "scheduleOverdueDays", label: "Vencida sem agendamento", unit: "dias", min: 1, max: 90,
    helper: "\"Há agendar\" há mais que estes dias desde a solicitação entra na fila de vencidas sem agendamento.",
  },
  {
    key: "predictive_forecast_km", prop: "predictiveForecastKm", label: "Previsão preditiva (KM)", unit: "km", min: 100, max: 100000,
    helper: "Horizonte de KM da previsão de itens preditivos que vencem em breve.",
  },
  {
    key: "predictive_forecast_days", prop: "predictiveForecastDays", label: "Previsão preditiva (dias)", unit: "dias", min: 1, max: 365,
    helper: "Horizonte em dias da mesma previsão.",
  },
];

export function SettingsFormDrawer({
  open,
  settings,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  settings: MaintenanceSettings;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <FormDrawer open={open} onOpenChange={onOpenChange} size="md" testId="maintenance-settings-form">
      <SettingsForm settings={settings} onClose={() => onOpenChange(false)} onSaved={onSaved} />
    </FormDrawer>
  );
}

function SettingsForm({
  settings,
  onClose,
  onSaved,
}: {
  settings: MaintenanceSettings;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [aging, setAging] = React.useState(settings.agingBuckets.join(", "));
  const [values, setValues] = React.useState<Record<SettingKey, string>>(() => {
    const out = {} as Record<SettingKey, string>;
    for (const f of SETTING_FIELDS) out[f.key] = numberText(settings[f.prop] as number);
    return out;
  });
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const buckets = parseAgingBuckets(aging);
  const parsed = SETTING_FIELDS.map((f) => {
    const n = f.decimal ? parseDecimalField(values[f.key]) : parseIntField(values[f.key]);
    const invalid = n == null || n < f.min || n > f.max;
    return { field: f, value: n, invalid };
  });
  const canSubmit = !buckets.error && parsed.every((p) => !p.invalid);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !canSubmit) return;
    setSaving(true);
    setError(null);
    const payload: Record<string, number | number[] | null> = { aging_buckets: buckets.values };
    for (const p of parsed) payload[p.field.key] = p.value;
    const result = await safeCall(() => saveMaintenanceSettings(payload), "Não foi possível salvar as configurações.");
    setSaving(false);
    if (!result.ok) {
      const message = result.error ?? "Não foi possível salvar as configurações.";
      setError(message);
      toast({ title: message, variant: "danger" });
      return;
    }
    toast({ title: "Configurações salvas. Valem para as próximas leituras da tela.", variant: "success" });
    onSaved();
    onClose();
  };

  return (
    <>
      <DrawerHeader>
        <DrawerTitle>Configurações da Manutenção</DrawerTitle>
        <DrawerDescription>Parâmetros da organização usados pelos indicadores, filas e pela resolução do KM.</DrawerDescription>
      </DrawerHeader>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" aria-busy={saving}>
        <DrawerBody className="flex flex-col gap-5">
          <FormErrorAlert error={error} />
          <FormField
            label="Faixas de aging (dias)"
            required
            helperText={
              buckets.error ? undefined : (
                <>
                  Prévia: <span className="font-medium text-fg">{agingLabels(buckets.values).join(" · ")} dias</span>
                </>
              )
            }
            error={buckets.error ?? undefined}
          >
            <Input value={aging} onChange={(e) => setAging(e.target.value)} placeholder="2, 5, 10, 20" data-testid="maintenance-settings-aging" />
          </FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {parsed.map(({ field, invalid }) => (
              <FormField
                key={field.key}
                label={field.label}
                required
                helperText={field.helper}
                error={invalid ? `Entre ${formatInt(field.min)} e ${formatInt(field.max)} ${field.unit}.` : undefined}
              >
                <Input
                  inputMode={field.decimal ? "decimal" : "numeric"}
                  value={values[field.key]}
                  onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                  trailingAddon={field.unit}
                  maxLength={9}
                />
              </FormField>
            ))}
          </div>
        </DrawerBody>
        <FormFooter readOnly={false} saving={saving} disabled={!canSubmit} onClose={onClose} />
      </form>
    </>
  );
}

// ---------------------------------------------------------------------------
// Parâmetro preventivo
// ---------------------------------------------------------------------------
export function PreventiveRuleFormDrawer({
  open,
  rule,
  catalog,
  options,
  readOnly,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  rule: PreventiveRule | null;
  catalog: MaintenanceCatalog;
  options: MaintenanceFilterOptions;
  readOnly: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <FormDrawer open={open} onOpenChange={onOpenChange} size="lg" testId="maintenance-preventive-rule-form">
      <PreventiveRuleForm
        key={rule?.id ?? "novo"}
        rule={rule}
        catalog={catalog}
        options={options}
        readOnly={readOnly}
        onClose={() => onOpenChange(false)}
        onSaved={onSaved}
      />
    </FormDrawer>
  );
}

/** Serviços que servem a uma preventiva: ativos e aplicáveis ao tipo (vazio = todos). */
export function preventiveServices(catalog: MaintenanceCatalog, keepId?: string | null) {
  return catalog.services.filter(
    (s) =>
      s.id === keepId ||
      (s.status === "active" && (s.maintenanceTypeCodes.length === 0 || s.maintenanceTypeCodes.includes("preventive"))),
  );
}

function PreventiveRuleForm({
  rule,
  catalog,
  options,
  readOnly,
  onClose,
  onSaved,
}: {
  rule: PreventiveRule | null;
  catalog: MaintenanceCatalog;
  options: MaintenanceFilterOptions;
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [vehicleTypeId, setVehicleTypeId] = React.useState(rule?.vehicleTypeId ?? "");
  const [subcategoryId, setSubcategoryId] = React.useState(rule?.vehicleSubcategoryId ?? "");
  const [modelId, setModelId] = React.useState(rule?.vehicleModelId ?? "");
  const [serviceId, setServiceId] = React.useState(rule?.serviceId ?? "");
  const [intervalKm, setIntervalKm] = React.useState(String(rule?.intervalKm ?? 10000));
  const [initialKm, setInitialKm] = React.useState(String(rule?.initialKm ?? 0));
  const [cycleCount, setCycleCount] = React.useState(String(rule?.cycleCount ?? 20));
  const [alertPct, setAlertPct] = React.useState(numberText(rule?.alertBeforePct ?? 5));
  const [tolerancePct, setTolerancePct] = React.useState(numberText(rule?.toleranceAfterPct ?? 5));
  const [criticality, setCriticality] = React.useState<Criticality>(rule?.criticality ?? "medium");
  const [status, setStatus] = React.useState<"active" | "inactive">(rule?.status ?? "active");
  const [notes, setNotes] = React.useState(rule?.notes ?? "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const makeName = React.useMemo(() => new Map(options.makes.map((m) => [m.id, m.name])), [options.makes]);
  const types = options.vehicleTypes.some((t) => t.id === vehicleTypeId) || !rule
    ? options.vehicleTypes
    : [...options.vehicleTypes, { id: rule.vehicleTypeId, name: rule.vehicleTypeName }];
  const subcategories = options.subcategories.filter((s) => s.vehicleTypeId === vehicleTypeId);
  const models = [...options.models].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const services = preventiveServices(catalog, rule?.serviceId);

  const interval = parseIntField(intervalKm);
  const initial = parseIntField(initialKm) ?? 0;
  const cycles = parseIntField(cycleCount);
  const alert = parseDecimalField(alertPct);
  const tolerance = parseDecimalField(tolerancePct);

  const intervalInvalid = interval == null || interval < 100 || interval > 1_000_000;
  const cyclesInvalid = cycles == null || cycles < 1 || cycles > 500;
  const alertInvalid = alert == null || alert < 0 || alert > 100;
  const toleranceInvalid = tolerance == null || tolerance < 0 || tolerance > 100;
  const canSubmit = Boolean(vehicleTypeId) && !intervalInvalid && !cyclesInvalid && !alertInvalid && !toleranceInvalid;

  /** Prévia dos marcos: MP1 = inicial + intervalo, e assim por diante. */
  const milestones = React.useMemo(() => {
    if (intervalInvalid || !interval || !cycles || cyclesInvalid) return null;
    const shown = Math.min(5, cycles);
    const list = Array.from({ length: shown }, (_, i) => ({ n: i + 1, km: initial + interval * (i + 1) }));
    return { list, last: cycles > shown ? { n: cycles, km: initial + interval * cycles } : null };
  }, [interval, initial, cycles, intervalInvalid, cyclesInvalid]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly || saving || !canSubmit) return;
    setSaving(true);
    setError(null);
    const result = await safeCall(
      () =>
        savePreventiveRule({
          id: rule?.id,
          vehicle_type_id: vehicleTypeId,
          vehicle_subcategory_id: subcategoryId || null,
          vehicle_model_id: modelId || null,
          service_id: serviceId || null,
          interval_km: interval,
          initial_km: initial,
          cycle_count: cycles,
          alert_before_pct: alert,
          tolerance_after_pct: tolerance,
          criticality,
          status,
          notes: notes.trim() || null,
        }),
      "Não foi possível salvar o parâmetro preventivo.",
    );
    setSaving(false);
    if (!result.ok) {
      const message = result.error ?? "Não foi possível salvar o parâmetro preventivo.";
      setError(message);
      toast({ title: message, variant: "danger" });
      return;
    }
    const synced = result.data?.vehiclesSynced ?? 0;
    toast({
      title: `Parâmetro ${rule ? "atualizado" : "criado"}. ${formatInt(synced)} veículo(s) com os ciclos sincronizados.`,
      variant: "success",
    });
    onSaved();
    onClose();
  };

  return (
    <>
      <DrawerHeader>
        <DrawerTitle>{rule ? (readOnly ? "Parâmetro preventivo" : "Editar parâmetro preventivo") : "Novo parâmetro preventivo"}</DrawerTitle>
        <DrawerDescription>
          Ciclo de KM que gera os marcos MP1, MP2, MP3… de cada veículo e classifica a preventiva.
        </DrawerDescription>
      </DrawerHeader>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" aria-busy={saving}>
        <DrawerBody className="flex flex-col gap-6">
          {readOnly ? <ReadOnlyAlert what="parâmetros preventivos" /> : null}
          <Alert variant="info">
            <AlertDescription>
              Vale a regra ativa mais específica: <strong>modelo</strong> &gt; <strong>subcategoria</strong> &gt;{" "}
              <strong>tipo de equipamento</strong>. Um veículo com regra do seu modelo ignora a do tipo. Salvar
              sincroniza agora os ciclos dos veículos do tipo.
            </AlertDescription>
          </Alert>
          <FormErrorAlert error={error} />
          <FormFieldset readOnly={readOnly}>
            <FormSection title="Aplicabilidade">
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
                <FormField label="Subcategoria" helperText={vehicleTypeId ? "Vazio = todas as do tipo." : "Escolha o tipo primeiro."}>
                  <NativeSelect value={subcategoryId} onChange={(e) => setSubcategoryId(e.target.value)} disabled={!vehicleTypeId}>
                    <option value="">Todas</option>
                    {subcategories.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField label="Modelo" helperText="Vazio = todos os modelos.">
                  <NativeSelect value={modelId} onChange={(e) => setModelId(e.target.value)}>
                    <option value="">Todos</option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                        {makeName.get(m.makeId) ? ` · ${makeName.get(m.makeId)}` : ""}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField label="Serviço da preventiva" helperText="Serviço lançado quando o marco é programado.">
                  <NativeSelect value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                    <option value="">Não definido</option>
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.clusterName} · {s.name}
                        {s.status === "inactive" ? " (inativo)" : ""}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
              </FormGrid>
            </FormSection>

            <FormSection title="Ciclo" description="Os percentuais são do intervalo: alerta antes do marco, tolerância depois dele.">
              <FormGrid columns={3}>
                <FormField label="Intervalo" required error={intervalInvalid ? "Mínimo 100 km." : undefined}>
                  <Input inputMode="numeric" value={intervalKm} onChange={(e) => setIntervalKm(e.target.value)} trailingAddon="km" />
                </FormField>
                <FormField label="KM inicial" helperText="Marco zero do ciclo.">
                  <Input inputMode="numeric" value={initialKm} onChange={(e) => setInitialKm(e.target.value)} trailingAddon="km" />
                </FormField>
                <FormField label="Ciclos" required error={cyclesInvalid ? "De 1 a 500." : undefined}>
                  <Input inputMode="numeric" value={cycleCount} onChange={(e) => setCycleCount(e.target.value)} maxLength={3} />
                </FormField>
                <FormField label="Alerta antes" required error={alertInvalid ? "De 0 a 100%." : undefined}>
                  <Input inputMode="decimal" value={alertPct} onChange={(e) => setAlertPct(e.target.value)} trailingAddon="%" />
                </FormField>
                <FormField label="Tolerância depois" required error={toleranceInvalid ? "De 0 a 100%." : undefined}>
                  <Input inputMode="decimal" value={tolerancePct} onChange={(e) => setTolerancePct(e.target.value)} trailingAddon="%" />
                </FormField>
                <FormField label="Criticidade">
                  <CriticalitySelect value={criticality} onChange={setCriticality} />
                </FormField>
              </FormGrid>
              <div className="rounded-md border border-border bg-surface-secondary px-3 py-2" data-testid="maintenance-preventive-milestones">
                <p className="text-caption font-medium text-fg-secondary">Prévia dos marcos</p>
                {milestones ? (
                  <ol className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-body-sm tabular-nums text-fg">
                    {milestones.list.map((m) => (
                      <li key={m.n}>
                        <span className="font-semibold">MP{m.n}</span> {formatKm(m.km)}
                      </li>
                    ))}
                    {milestones.last ? (
                      <li className="text-fg-secondary">
                        … <span className="font-semibold">MP{milestones.last.n}</span> {formatKm(milestones.last.km)}
                      </li>
                    ) : null}
                  </ol>
                ) : (
                  <p className="mt-1 text-caption text-fg-muted">Informe intervalo e ciclos para ver os marcos.</p>
                )}
              </div>
            </FormSection>

            <FormGrid columns={2}>
              <FormField label="Situação" helperText="Inativo deixa de gerar ciclos; os já gerados ficam no histórico.">
                <StatusSelect value={status} onChange={setStatus} />
              </FormField>
              <FormField label="Observações" className="sm:col-span-2">
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} />
              </FormField>
            </FormGrid>
          </FormFieldset>
        </DrawerBody>
        <FormFooter readOnly={readOnly} saving={saving} disabled={!canSubmit} onClose={onClose} />
      </form>
    </>
  );
}
