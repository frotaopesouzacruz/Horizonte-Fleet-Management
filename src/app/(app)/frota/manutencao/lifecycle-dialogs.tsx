"use client";

import * as React from "react";
import { ArrowRight, CheckCheck, X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { RadioField, RadioGroup } from "@/components/ui/radio-group";
import { SearchField } from "@/components/ui/search-field";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { NativeSelect, type NativeSelectProps } from "@/components/governance/selects";
import { useToast } from "@/components/feedback/toast";
import { CriticalityBadge, KmStatusBadge } from "@/components/maintenance/badges";
import {
  addMaintenanceItems,
  completeMaintenance,
  rescheduleMaintenance,
  scheduleMaintenance,
  setEntryKm,
  startMaintenance,
  updateMaintenanceDetails,
  type DetailsInput,
  type ScheduleInput,
} from "@/lib/maintenance/actions";
import {
  CRITICALITY_LABEL,
  ITEM_RESULT_LABEL,
  KM_SOURCE_LABEL,
  KM_STATUS_HINT,
  formatDate,
  formatDateTime,
  formatDays,
  formatHours,
  formatInt,
  formatKm,
  formatTime,
  type Criticality,
  type KmResolution,
  type MaintenanceCatalog,
  type MaintenanceCluster,
  type MaintenanceDetail,
  type MaintenanceService,
} from "@/lib/maintenance/types";

/**
 * Diálogos do ciclo de vida da manutenção.
 *
 * Cada um pede só o que a rotina do banco precisa e mostra o que ela devolve —
 * transição, KM, TMM e validações de data são decididos lá, na mesma transação
 * da escrita. A gaveta monta um diálogo por vez e o desmonta ao fechar: cada
 * abertura começa limpa, e um motivo digitado para uma ação nunca vai para a
 * seguinte.
 */

// ---------------------------------------------------------------------------
// Utilidades de tela (sem regra de negócio)
// ---------------------------------------------------------------------------

/** Hoje em São Paulo, como o banco conta "o passado". Só para valores iniciais. */
export function todayInSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Busca sem acento e sem caixa. */
export function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function supplierDisplayName(catalog: MaintenanceCatalog, id: string | null | undefined): string {
  if (!id) return "—";
  const supplier = catalog.suppliers.find((s) => s.id === id);
  return supplier ? supplier.tradeName || supplier.name : "Fornecedor fora do catálogo";
}

/**
 * Serviços que podem entrar numa manutenção: ativos, de cluster ativo e
 * aplicáveis ao tipo e ao tipo de equipamento (lista vazia = vale para todos).
 * O banco confere de novo ao gravar.
 */
export function availableServices(
  catalog: MaintenanceCatalog,
  typeCode: string,
  vehicleTypeId: string | null,
): MaintenanceService[] {
  const inactiveClusters = new Set(catalog.clusters.filter((c) => c.status !== "active").map((c) => c.id));
  return catalog.services.filter(
    (s) =>
      s.status === "active" &&
      !inactiveClusters.has(s.clusterId) &&
      (s.maintenanceTypeCodes.length === 0 || s.maintenanceTypeCodes.includes(typeCode)) &&
      (!vehicleTypeId || s.vehicleTypeIds.length === 0 || s.vehicleTypeIds.includes(vehicleTypeId)),
  );
}

/** Prévia do TMM com a mesma regra da coluna gerada no banco — só para conferência. */
export function previewDurationHours(
  entryDate: string | null,
  entryTime: string | null,
  exitDate: string | null,
  exitTime: string | null,
): { hours: number; precision: "exact" | "date" } | null {
  if (!entryDate || !exitDate) return null;
  const day = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const days = Math.round((day(exitDate) - day(entryDate)) / 86_400_000);
  if (entryTime && exitTime) {
    const hours = days * 24 + (minutes(exitTime) - minutes(entryTime)) / 60;
    return { hours: Math.round(hours * 100) / 100, precision: "exact" };
  }
  return { hours: days * 24, precision: "date" };
}

export function formatDuration(hours: number | null | undefined, precision: "exact" | "date" | null | undefined): string {
  if (hours == null) return "—";
  const approx = precision === "date" ? "≈ " : "";
  return `${approx}${formatHours(hours)} · ${approx}${formatDays(hours / 24)}`;
}

const minLengthError = (value: string, min: number, what: string) =>
  value.trim().length < min ? `${what} precisa de pelo menos ${min} caracteres.` : undefined;

/** Campo de hora nativo, com a mesma casca do Input. */
export function TimeInput({ className, ...props }: Omit<React.ComponentProps<typeof Input>, "type">) {
  return <Input type="time" step={60} className={cn("[color-scheme:light] dark:[color-scheme:dark]", className)} {...props} />;
}

export interface SupplierSelectProps extends Omit<NativeSelectProps, "value" | "onChange" | "children"> {
  catalog: MaintenanceCatalog;
  value: string;
  onValueChange: (id: string) => void;
  /** Fornecedor atual: continua visível mesmo inativo, para não sumir da tela. */
  currentId?: string | null;
  emptyLabel?: string;
  allowEmpty?: boolean;
}

/** Fornecedores ativos do catálogo; o atual aparece mesmo se inativo. */
export function SupplierSelect({
  catalog, value, onValueChange, currentId, emptyLabel = "Sem fornecedor", allowEmpty = true, ...props
}: SupplierSelectProps) {
  const options = React.useMemo(() => {
    const list = catalog.suppliers
      .filter((s) => s.status === "active" || s.id === currentId)
      .map((s) => ({
        id: s.id,
        label: `${s.tradeName || s.name}${s.cityName ? ` · ${s.cityName}${s.stateUf ? `/${s.stateUf}` : ""}` : ""}${s.status !== "active" ? " (inativo)" : ""}`,
      }));
    return list.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [catalog.suppliers, currentId]);
  return (
    <NativeSelect value={value} onChange={(e) => onValueChange(e.target.value)} {...props}>
      {allowEmpty || !value ? <option value="">{emptyLabel}</option> : null}
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </NativeSelect>
  );
}

// ---------------------------------------------------------------------------
// Peças compartilhadas com a gaveta e o assistente
// ---------------------------------------------------------------------------

function Fact({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="text-body-sm break-words text-fg">{children}</dd>
    </div>
  );
}

/** O KM que o servidor resolveu: valor, situação (com a regra), fonte e leitura oficial. */
export function KmResolutionView({
  km,
  className,
}: {
  km: (KmResolution & { difference?: number | null }) | null;
  className?: string;
}) {
  if (!km || !km.status) {
    return (
      <p className={cn("text-body-sm text-fg-muted", className)}>
        Sem data de entrada: o KM de entrada é resolvido quando o veículo entra na oficina.
      </p>
    );
  }
  const difference = km.difference ?? null;
  return (
    <div className={cn("flex flex-col gap-3 rounded-md border border-border bg-surface p-3", className)} data-testid="maintenance-km-resolution">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-h3 font-semibold tabular-nums text-fg">{formatKm(km.km)}</span>
        <KmStatusBadge status={km.status} size="md" />
      </div>
      <p className="text-caption text-fg-secondary">{KM_STATUS_HINT[km.status]}</p>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Fonte">{km.source ? KM_SOURCE_LABEL[km.source] ?? km.source : "—"}</Fact>
        <Fact label="Leitura oficial">{formatKm(km.officialKm)}</Fact>
        <Fact label="Data da leitura">{formatDate(km.readingDate)}</Fact>
        <Fact label="Data de referência">{formatDate(km.referenceDate)}</Fact>
        {difference != null ? (
          <Fact label="Diferença para o oficial">
            <span className="tabular-nums">{difference > 0 ? "+" : ""}{formatInt(difference)} km</span>
          </Fact>
        ) : null}
      </dl>
      {km.status === "divergent" ? (
        <Alert variant="warning">
          <AlertDescription>
            O KM informado não é coerente com as leituras oficiais vizinhas. Isso não bloqueia a manutenção: o registro fica
            sinalizado como divergente para revisão.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

/** Lista "de → para" do que vai mudar. */
export function ChangeList({ changes }: { changes: { label: string; from: string; to: string }[] }) {
  if (changes.length === 0) {
    return <p className="text-body-sm text-fg-muted">Nenhuma alteração ainda.</p>;
  }
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Alterações">
      {changes.map((c) => (
        <li key={c.label} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-body-sm">
          <span className="font-medium text-fg">{c.label}:</span>
          <span className="text-fg-muted line-through decoration-fg-muted/60">{c.from}</span>
          <ArrowRight className="size-3.5 text-fg-muted" aria-hidden />
          <span className="sr-only">para</span>
          <span className="font-medium text-fg">{c.to}</span>
        </li>
      ))}
    </ul>
  );
}

export interface ServicePickerProps {
  /** Serviços já filtrados por tipo e equipamento. */
  services: MaintenanceService[];
  clusters: MaintenanceCluster[];
  value: string[];
  onChange: (ids: string[]) => void;
  /** Serviços que já estão na manutenção: aparecem marcados e travados. */
  locked?: Set<string>;
  /** Serviços sugeridos pelos apontamentos do Check List. */
  suggested?: Set<string>;
  idPrefix: string;
  listClassName?: string;
}

/** Multisseleção por cluster (MANUTENÇÃO → ITENS), com busca por nome. */
export function ServicePicker({
  services, clusters, value, onChange, locked, suggested, idPrefix, listClassName,
}: ServicePickerProps) {
  const [query, setQuery] = React.useState("");
  const selected = React.useMemo(() => new Set(value), [value]);
  const byId = React.useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);

  const groups = React.useMemo(() => {
    const q = normalizeSearch(query);
    const order = new Map(clusters.map((c) => [c.id, c.sortOrder]));
    const map = new Map<string, { id: string; name: string; services: MaintenanceService[] }>();
    for (const s of services) {
      if (q && !normalizeSearch(`${s.name} ${s.clusterName}`).includes(q)) continue;
      const group = map.get(s.clusterId) ?? { id: s.clusterId, name: s.clusterName, services: [] };
      group.services.push(s);
      map.set(s.clusterId, group);
    }
    return [...map.values()]
      .map((g) => ({ ...g, services: g.services.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")) }))
      .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999) || a.name.localeCompare(b.name, "pt-BR"));
  }, [services, clusters, query]);

  const toggle = (id: string, checked: boolean) => {
    if (checked) onChange(selected.has(id) ? value : [...value, id]);
    else onChange(value.filter((v) => v !== id));
  };

  const chosen = value.map((id) => byId.get(id)).filter((s): s is MaintenanceService => Boolean(s));

  return (
    <div className="flex flex-col gap-2" data-testid="maintenance-service-picker">
      {chosen.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" aria-label="Serviços selecionados">
          {chosen.map((s) => (
            <span
              key={s.id}
              className="inline-flex max-w-full items-center gap-1 rounded-xs border border-primary/40 bg-primary-soft py-0.5 pr-0.5 pl-2 text-caption text-primary-soft-fg"
            >
              <span className="truncate">{s.clusterName} → {s.name}</span>
              <button
                type="button"
                onClick={() => toggle(s.id, false)}
                aria-label={`Remover ${s.name}`}
                className="inline-flex size-5 shrink-0 items-center justify-center rounded-xs hfm-transition hover:bg-hover-overlay hfm-focus-ring"
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <SearchField
        size="sm"
        value={query}
        onValueChange={setQuery}
        placeholder="Buscar serviço ou cluster"
        aria-label="Buscar serviço ou cluster"
      />

      <div className={cn("max-h-72 overflow-y-auto rounded-md border border-border bg-surface", listClassName)}>
        {groups.length === 0 ? (
          <p className="px-3 py-4 text-body-sm text-fg-muted">
            {services.length === 0
              ? "Nenhum serviço ativo se aplica a este tipo de manutenção e equipamento. Confira o cadastro de serviços."
              : "Nenhum serviço corresponde à busca."}
          </p>
        ) : (
          groups.map((g) => {
            const count = g.services.filter((s) => selected.has(s.id) || locked?.has(s.id)).length;
            return (
              <fieldset key={g.id} className="border-b border-border-subtle last:border-b-0">
                <legend className="sr-only">{g.name}</legend>
                <div
                  aria-hidden
                  className="sticky top-0 flex items-center justify-between gap-2 bg-surface-secondary px-3 py-1.5 text-caption font-semibold text-fg-secondary"
                >
                  <span className="truncate">{g.name}</span>
                  <span className="tabular-nums">{count}/{g.services.length}</span>
                </div>
                <ul className="flex flex-col py-1">
                  {g.services.map((s) => {
                    const id = `${idPrefix}-svc-${s.id}`;
                    const isLocked = locked?.has(s.id) ?? false;
                    return (
                      <li key={s.id} className="flex items-start gap-2.5 px-3 py-1.5 hfm-transition hover:bg-hover-overlay">
                        <Checkbox
                          id={id}
                          className="mt-0.5"
                          checked={isLocked || selected.has(s.id)}
                          disabled={isLocked}
                          onCheckedChange={(v) => toggle(s.id, v === true)}
                        />
                        <label htmlFor={id} className={cn("flex min-w-0 flex-1 flex-col gap-0.5", isLocked ? "cursor-not-allowed" : "cursor-pointer")}>
                          <span className="text-body-sm font-medium text-fg">{s.name}</span>
                          <span className="text-caption text-fg-muted">
                            Criticidade {CRITICALITY_LABEL[s.criticality].toLowerCase()}
                            {s.expectedHours != null ? ` · previsão ${formatHours(s.expectedHours)}` : ""}
                            {isLocked ? " · já está na manutenção" : ""}
                            {suggested?.has(s.id) ? " · sugerido pelo Check List" : ""}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            );
          })
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Casca comum dos diálogos
// ---------------------------------------------------------------------------

export interface LifecycleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: MaintenanceDetail;
  catalog: MaintenanceCatalog;
  /** Depois de gravar: a gaveta avisa, recarrega o detalhe e a lista. */
  onSuccess: (title: string, description?: React.ReactNode) => void;
}

function Shell({
  open, onOpenChange, busy, title, description, size = "md", testId, children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  title: React.ReactNode;
  description?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Enquanto grava, o diálogo não fecha: o resultado precisa de um lugar para aparecer.
        if (!next && busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        size={size}
        data-testid={testId}
        aria-busy={busy || undefined}
        // Sem descrição, o Radix não deve apontar aria-describedby para um elemento inexistente.
        {...(description ? null : { "aria-describedby": undefined })}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function FormFrame({ onSubmit, children }: { onSubmit: () => void; children: React.ReactNode }) {
  return (
    <form
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {children}
    </form>
  );
}

function Footer({
  busy, onCancel, confirmLabel, confirmDisabled, destructive, testId,
}: {
  busy: boolean;
  onCancel: () => void;
  confirmLabel: string;
  confirmDisabled?: boolean;
  destructive?: boolean;
  testId?: string;
}) {
  return (
    <DialogFooter>
      <Button variant="outline" onClick={onCancel} disabled={busy}>
        Cancelar
      </Button>
      <Button type="submit" variant={destructive ? "danger" : "primary"} loading={busy} disabled={confirmDisabled} data-testid={testId}>
        {confirmLabel}
      </Button>
    </DialogFooter>
  );
}

// ---------------------------------------------------------------------------
// Motivo obrigatório (cancelar, não realizada, desfazer agendamento, reabrir…)
// ---------------------------------------------------------------------------

export interface ReasonActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  /** Aviso acima do campo (ex.: o que a reabertura reverte). */
  warning?: React.ReactNode;
  label?: string;
  placeholder?: string;
  hint?: React.ReactNode;
  minLength?: number;
  confirmLabel: string;
  destructive?: boolean;
  /** Resolve `true` quando gravou; o diálogo então fecha. */
  onConfirm: (reason: string) => Promise<boolean>;
  testId?: string;
}

/**
 * Confirmação com motivo. O mínimo de caracteres é o mesmo que o banco cobra,
 * para que o botão só aja quando a rotina vai aceitar.
 */
export function ReasonActionDialog({
  open, onOpenChange, title, description, warning, label = "Motivo", placeholder, hint = "Fica registrado na trilha da manutenção, com o seu nome e o horário.",
  minLength = 5, confirmLabel, destructive = false, onConfirm, testId = "maintenance-reason-dialog",
}: ReasonActionDialogProps) {
  const [reason, setReason] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [busy, start] = React.useTransition();
  const invalid = reason.trim().length < minLength;

  const submit = () => {
    setTouched(true);
    if (invalid) return;
    start(async () => {
      const ok = await onConfirm(reason.trim());
      if (ok) onOpenChange(false);
    });
  };

  return (
    <Shell open={open} onOpenChange={onOpenChange} busy={busy} title={title} description={description} testId={testId}>
      <FormFrame onSubmit={submit}>
        <DialogBody className="flex flex-col gap-3">
          {warning ? (
            <Alert variant="warning">
              <AlertDescription>{warning}</AlertDescription>
            </Alert>
          ) : null}
          <FormField
            label={label}
            required
            helperText={<>{hint} Mínimo de {minLength} caracteres.</>}
            error={touched && invalid ? `Descreva o motivo em pelo menos ${minLength} caracteres.` : undefined}
          >
            <Textarea
              rows={3}
              maxLength={500}
              value={reason}
              placeholder={placeholder}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setTouched(true)}
              data-testid="maintenance-reason-input"
            />
          </FormField>
        </DialogBody>
        <Footer
          busy={busy}
          onCancel={() => onOpenChange(false)}
          confirmLabel={confirmLabel}
          confirmDisabled={invalid}
          destructive={destructive}
          testId="maintenance-reason-confirm"
        />
      </FormFrame>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Agendar
// ---------------------------------------------------------------------------

export function ScheduleDialog({ open, onOpenChange, detail, catalog, onSuccess }: LifecycleDialogProps) {
  const { toast } = useToast();
  const [busy, start] = React.useTransition();
  const [touched, setTouched] = React.useState(false);
  const [form, setForm] = React.useState(() => ({
    scheduledDate: detail.scheduledDate ?? "",
    scheduledTime: formatTime(detail.scheduledTime),
    expectedExitDate: detail.expectedExitDate ?? "",
    expectedExitTime: formatTime(detail.expectedExitTime),
    supplierId: detail.supplierId ?? "",
    serviceOrderNumber: detail.serviceOrderNumber ?? "",
    schedulingNotes: detail.schedulingNotes ?? "",
  }));
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const dateError = !form.scheduledDate ? "Informe a data do agendamento." : undefined;

  const submit = () => {
    setTouched(true);
    if (dateError) return;
    const input: ScheduleInput = {
      scheduledDate: form.scheduledDate,
      scheduledTime: form.scheduledTime || null,
      expectedExitDate: form.expectedExitDate || null,
      expectedExitTime: form.expectedExitTime || null,
      supplierId: form.supplierId || null,
      serviceOrderNumber: form.serviceOrderNumber.trim() || null,
      schedulingNotes: form.schedulingNotes.trim() || null,
    };
    start(async () => {
      const result = await scheduleMaintenance(detail.id, input);
      if (result.ok) {
        onSuccess(`${detail.code} agendada para ${formatDateTime(input.scheduledDate, input.scheduledTime)}.`);
        onOpenChange(false);
      } else {
        toast({ title: result.error ?? "Não foi possível agendar a manutenção.", variant: "danger" });
      }
    });
  };

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      size="lg"
      title={`Agendar ${detail.code}`}
      description={`Solicitada em ${formatDate(detail.requestedOn)}. A data agendada não pode ser anterior à solicitação.`}
      testId="maintenance-dialog-schedule"
    >
      <FormFrame onSubmit={submit}>
        <DialogBody className="flex flex-col gap-4">
          <FormGrid columns={2}>
            <FormField label="Data do agendamento" required error={touched ? dateError : undefined}>
              <DateInput value={form.scheduledDate} min={detail.requestedOn ?? undefined} onChange={(e) => set({ scheduledDate: e.target.value })} />
            </FormField>
            <FormField label="Hora" labelHint="Opcional">
              <TimeInput value={form.scheduledTime} onChange={(e) => set({ scheduledTime: e.target.value })} />
            </FormField>
            <FormField label="Previsão de saída" labelHint="Opcional">
              <DateInput value={form.expectedExitDate} min={form.scheduledDate || undefined} onChange={(e) => set({ expectedExitDate: e.target.value })} />
            </FormField>
            <FormField label="Hora prevista de saída" labelHint="Opcional">
              <TimeInput value={form.expectedExitTime} onChange={(e) => set({ expectedExitTime: e.target.value })} />
            </FormField>
            <FormField label="Fornecedor" labelHint="Opcional">
              <SupplierSelect catalog={catalog} currentId={detail.supplierId} value={form.supplierId} onValueChange={(v) => set({ supplierId: v })} />
            </FormField>
            <FormField label="Ordem de serviço (OS)" labelHint="Opcional">
              <Input value={form.serviceOrderNumber} maxLength={60} onChange={(e) => set({ serviceOrderNumber: e.target.value })} />
            </FormField>
          </FormGrid>
          <FormField label="Observações do agendamento" labelHint="Opcional">
            <Textarea rows={2} maxLength={1000} value={form.schedulingNotes} onChange={(e) => set({ schedulingNotes: e.target.value })} />
          </FormField>
        </DialogBody>
        <Footer busy={busy} onCancel={() => onOpenChange(false)} confirmLabel="Agendar" testId="maintenance-schedule-confirm" />
      </FormFrame>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Reprogramar
// ---------------------------------------------------------------------------

export function RescheduleDialog({ open, onOpenChange, detail, catalog, onSuccess }: LifecycleDialogProps) {
  const { toast } = useToast();
  const [busy, start] = React.useTransition();
  const [touched, setTouched] = React.useState(false);
  const inProgress = detail.status === "in_progress";
  const initial = React.useMemo(
    () => ({
      scheduledDate: detail.scheduledDate ?? "",
      scheduledTime: formatTime(detail.scheduledTime),
      expectedExitDate: detail.expectedExitDate ?? "",
      expectedExitTime: formatTime(detail.expectedExitTime),
      supplierId: detail.supplierId ?? "",
    }),
    [detail],
  );
  const [form, setForm] = React.useState(initial);
  const [reason, setReason] = React.useState("");
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  // Campo em branco mantém o valor atual (a rotina só troca o que recebe).
  const changed = (key: keyof typeof form) => Boolean(form[key]) && form[key] !== initial[key];
  const changes: { label: string; from: string; to: string }[] = [];
  if (!inProgress && changed("scheduledDate")) changes.push({ label: "Data agendada", from: formatDate(initial.scheduledDate), to: formatDate(form.scheduledDate) });
  if (!inProgress && changed("scheduledTime")) changes.push({ label: "Hora agendada", from: initial.scheduledTime || "—", to: form.scheduledTime });
  if (changed("expectedExitDate")) changes.push({ label: "Previsão de saída", from: formatDate(initial.expectedExitDate), to: formatDate(form.expectedExitDate) });
  if (changed("expectedExitTime")) changes.push({ label: "Hora prevista de saída", from: initial.expectedExitTime || "—", to: form.expectedExitTime });
  if (changed("supplierId")) changes.push({ label: "Fornecedor", from: supplierDisplayName(catalog, initial.supplierId), to: supplierDisplayName(catalog, form.supplierId) });

  const reasonError = minLengthError(reason, 5, "O motivo");
  const invalid = changes.length === 0 || Boolean(reasonError);

  const submit = () => {
    setTouched(true);
    if (invalid) return;
    const input: Partial<ScheduleInput> = {
      scheduledDate: !inProgress && changed("scheduledDate") ? form.scheduledDate : undefined,
      scheduledTime: !inProgress && changed("scheduledTime") ? form.scheduledTime : undefined,
      expectedExitDate: changed("expectedExitDate") ? form.expectedExitDate : undefined,
      expectedExitTime: changed("expectedExitTime") ? form.expectedExitTime : undefined,
      supplierId: changed("supplierId") ? form.supplierId : undefined,
    };
    start(async () => {
      const result = await rescheduleMaintenance(detail.id, input, reason.trim());
      if (result.ok) {
        onSuccess(`${detail.code} reprogramada.`, `${changes.length} alteração(ões) registrada(s) na trilha.`);
        onOpenChange(false);
      } else {
        toast({ title: result.error ?? "Não foi possível reprogramar a manutenção.", variant: "danger" });
      }
    });
  };

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      size="lg"
      title={`Reprogramar ${detail.code}`}
      description={
        inProgress
          ? "Em execução, só o fornecedor e a previsão de saída podem mudar. A entrada real não é reprogramada."
          : "A situação continua Agendado. O valor anterior e o novo ficam na trilha, com o motivo."
      }
      testId="maintenance-dialog-reschedule"
    >
      <FormFrame onSubmit={submit}>
        <DialogBody className="flex flex-col gap-4">
          <FormGrid columns={2}>
            {!inProgress ? (
              <>
                <FormField label="Nova data agendada" helperText="Em branco mantém a atual.">
                  <DateInput value={form.scheduledDate} min={detail.requestedOn ?? undefined} onChange={(e) => set({ scheduledDate: e.target.value })} />
                </FormField>
                <FormField label="Nova hora">
                  <TimeInput value={form.scheduledTime} onChange={(e) => set({ scheduledTime: e.target.value })} />
                </FormField>
              </>
            ) : null}
            <FormField label="Previsão de saída" helperText="Em branco mantém a atual.">
              <DateInput value={form.expectedExitDate} onChange={(e) => set({ expectedExitDate: e.target.value })} />
            </FormField>
            <FormField label="Hora prevista de saída">
              <TimeInput value={form.expectedExitTime} onChange={(e) => set({ expectedExitTime: e.target.value })} />
            </FormField>
            <FormField label="Fornecedor" className="sm:col-span-2">
              <SupplierSelect
                catalog={catalog}
                currentId={detail.supplierId}
                value={form.supplierId}
                onValueChange={(v) => set({ supplierId: v })}
                allowEmpty={!detail.supplierId}
              />
            </FormField>
          </FormGrid>

          <section aria-label="De → para" className="rounded-md border border-border bg-surface-secondary p-3">
            <h4 className="mb-2 text-label font-semibold text-fg">De → para</h4>
            <ChangeList changes={changes} />
          </section>

          <FormField
            label="Motivo da reprogramação"
            required
            helperText="Fica na trilha, com o valor anterior e o novo. Mínimo de 5 caracteres."
            error={touched ? reasonError ?? (changes.length === 0 ? "Altere ao menos um campo." : undefined) : undefined}
          >
            <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="maintenance-reason-input" />
          </FormField>
        </DialogBody>
        <Footer busy={busy} onCancel={() => onOpenChange(false)} confirmLabel="Confirmar reprogramação" confirmDisabled={invalid} testId="maintenance-reschedule-confirm" />
      </FormFrame>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Iniciar / registrar entrada
// ---------------------------------------------------------------------------

type KmResult = KmResolution & { difference?: number | null };

export function StartDialog({ open, onOpenChange, detail, catalog, onSuccess }: LifecycleDialogProps) {
  const { toast } = useToast();
  const [busy, start] = React.useTransition();
  const [today] = React.useState(todayInSaoPaulo);
  const [touched, setTouched] = React.useState(false);
  const [done, setDone] = React.useState<{ km: KmResult | null } | null>(null);
  const [form, setForm] = React.useState(() => ({
    entryDate: today,
    entryTime: "",
    entryKm: "",
    entryKmJustification: "",
    supplierId: detail.supplierId ?? "",
    serviceOrderNumber: detail.serviceOrderNumber ?? "",
    expectedExitDate: detail.expectedExitDate ?? "",
    expectedExitTime: formatTime(detail.expectedExitTime),
  }));
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const kmText = form.entryKm.trim();
  const kmValue = kmText === "" ? null : Number(kmText);
  const dateError = !form.entryDate
    ? "Informe a data real de entrada."
    : form.entryDate > today
      ? "A entrada real não pode estar no futuro."
      : undefined;
  const kmError = kmValue != null && (!Number.isInteger(kmValue) || kmValue < 0) ? "Informe o KM em número inteiro, sem pontos." : undefined;
  const justificationError = kmValue != null ? minLengthError(form.entryKmJustification, 5, "A justificativa") : undefined;
  const invalid = Boolean(dateError || kmError || justificationError);

  const submit = () => {
    setTouched(true);
    if (invalid) return;
    start(async () => {
      const response = await startMaintenance(detail.id, {
        entryDate: form.entryDate,
        entryTime: form.entryTime || null,
        entryKm: kmValue,
        entryKmJustification: kmValue != null ? form.entryKmJustification.trim() : null,
        supplierId: form.supplierId || null,
        serviceOrderNumber: form.serviceOrderNumber.trim() || null,
        expectedExitDate: form.expectedExitDate || null,
        expectedExitTime: form.expectedExitTime || null,
      });
      if (response.ok) {
        setDone({ km: (response.data as KmResult | undefined) ?? null });
        onSuccess(`Entrada de ${detail.code} registrada em ${formatDateTime(form.entryDate, form.entryTime)}.`);
      } else {
        toast({ title: response.error ?? "Não foi possível registrar a entrada.", variant: "danger" });
      }
    });
  };

  if (done) {
    return (
      <Shell open={open} onOpenChange={onOpenChange} busy={false} size="lg" title={`Entrada registrada · ${detail.code}`}
        description="A manutenção está Em execução. O KM de entrada abaixo foi resolvido pelo servidor." testId="maintenance-dialog-start">
        <DialogBody className="flex flex-col gap-3">
          <KmResolutionView km={done.km} />
          <p className="text-caption text-fg-muted">
            O contexto operacional (operação e cidade) foi fixado na data de entrada. Para corrigir o KM, use “KM de entrada” na gaveta.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} data-testid="maintenance-start-close">Fechar</Button>
        </DialogFooter>
      </Shell>
    );
  }

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      size="lg"
      title={`Registrar entrada · ${detail.code}`}
      description={
        detail.scheduledDate
          ? `Agendada para ${formatDateTime(detail.scheduledDate, detail.scheduledTime)}. A data agendada é preservada para a análise de aderência.`
          : "Entrada sem agendamento prévio (socorro, oportunidade). Informe a data real em que o veículo entrou na oficina."
      }
      testId="maintenance-dialog-start"
    >
      <FormFrame onSubmit={submit}>
        <DialogBody className="flex flex-col gap-4">
          <FormGrid columns={2}>
            <FormField label="Data real de entrada" required error={touched ? dateError : undefined}>
              <DateInput value={form.entryDate} max={today} min={detail.requestedOn ?? undefined} onChange={(e) => set({ entryDate: e.target.value })} />
            </FormField>
            <FormField label="Hora real de entrada" labelHint="Opcional" helperText="Sem hora, o TMM é contado em dias.">
              <TimeInput value={form.entryTime} onChange={(e) => set({ entryTime: e.target.value })} />
            </FormField>
            <FormField
              label="KM de entrada"
              labelHint="Opcional"
              helperText="Em branco, o KM oficial da data é resolvido automaticamente."
              error={touched ? kmError : undefined}
            >
              <Input inputMode="numeric" trailingAddon="km" value={form.entryKm} onChange={(e) => set({ entryKm: e.target.value.replace(/[^\d]/g, "") })} />
            </FormField>
            <FormField
              label="Justificativa do KM manual"
              required={kmValue != null}
              disabled={kmValue == null}
              helperText={kmValue == null ? "Só quando o KM for informado." : "Mínimo de 5 caracteres."}
              error={touched ? justificationError : undefined}
            >
              <Input
                value={form.entryKmJustification}
                disabled={kmValue == null}
                maxLength={300}
                onChange={(e) => set({ entryKmJustification: e.target.value })}
              />
            </FormField>
            <FormField label="Fornecedor" labelHint="Opcional">
              <SupplierSelect catalog={catalog} currentId={detail.supplierId} value={form.supplierId} onValueChange={(v) => set({ supplierId: v })} />
            </FormField>
            <FormField label="Ordem de serviço (OS)" labelHint="Opcional">
              <Input value={form.serviceOrderNumber} maxLength={60} onChange={(e) => set({ serviceOrderNumber: e.target.value })} />
            </FormField>
            <FormField label="Previsão de saída" labelHint="Opcional">
              <DateInput value={form.expectedExitDate} min={form.entryDate || undefined} onChange={(e) => set({ expectedExitDate: e.target.value })} />
            </FormField>
            <FormField label="Hora prevista de saída" labelHint="Opcional">
              <TimeInput value={form.expectedExitTime} onChange={(e) => set({ expectedExitTime: e.target.value })} />
            </FormField>
          </FormGrid>
          {kmValue != null ? (
            <Alert variant="info">
              <AlertDescription>
                O KM informado é comparado com as leituras oficiais. Se for incoerente, fica marcado como divergente — isso
                não impede a entrada.
              </AlertDescription>
            </Alert>
          ) : null}
        </DialogBody>
        <Footer busy={busy} onCancel={() => onOpenChange(false)} confirmLabel="Registrar entrada" testId="maintenance-start-confirm" />
      </FormFrame>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Concluir
// ---------------------------------------------------------------------------

type ItemDecision = { status: "" | "done" | "not_done"; result: "resolved" | "partially_resolved"; notes: string };

export function CompleteDialog({ open, onOpenChange, detail, catalog, onSuccess }: LifecycleDialogProps) {
  const { toast } = useToast();
  const [busy, start] = React.useTransition();
  const [today] = React.useState(todayInSaoPaulo);
  const [touched, setTouched] = React.useState(false);
  const pending = React.useMemo(() => detail.itemsAll.filter((i) => i.status === "pending"), [detail.itemsAll]);
  const [decisions, setDecisions] = React.useState<Record<string, ItemDecision>>(() =>
    Object.fromEntries(pending.map((i) => [i.id, { status: "", result: "resolved", notes: i.notes ?? "" }])),
  );
  const [form, setForm] = React.useState(() => ({
    exitDate: today,
    exitTime: "",
    supplierId: detail.supplierId ?? "",
    serviceOrderNumber: detail.serviceOrderNumber ?? "",
    completionNotes: detail.completionNotes ?? "",
  }));
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const decide = (id: string, patch: Partial<ItemDecision>) =>
    setDecisions((d) => ({ ...d, [id]: { ...(d[id] ?? { status: "", result: "resolved", notes: "" }), ...patch } }));

  const dateError = !form.exitDate
    ? "Informe a data real de saída."
    : form.exitDate > today
      ? "A saída real não pode estar no futuro."
      : detail.entryDate && form.exitDate < detail.entryDate
        ? `A saída não pode ser anterior à entrada (${formatDate(detail.entryDate)}).`
        : undefined;
  const itemErrors = Object.fromEntries(
    pending.map((i) => {
      const d = decisions[i.id];
      const error = !d?.status
        ? "Informe se o serviço foi executado."
        : d.status === "not_done" && d.notes.trim().length < 5
          ? "Explique por que não foi executado (mínimo de 5 caracteres)."
          : undefined;
      return [i.id, error];
    }),
  ) as Record<string, string | undefined>;
  const undecided = pending.filter((i) => itemErrors[i.id]).length;
  const invalid = Boolean(dateError) || undecided > 0 || pending.length === 0;
  const tmm = previewDurationHours(detail.entryDate, formatTime(detail.entryTime) || null, form.exitDate || null, form.exitTime || null);

  const submit = () => {
    setTouched(true);
    if (invalid) return;
    start(async () => {
      const result = await completeMaintenance(detail.id, {
        exitDate: form.exitDate,
        exitTime: form.exitTime || null,
        supplierId: form.supplierId || null,
        serviceOrderNumber: form.serviceOrderNumber.trim() || null,
        completionNotes: form.completionNotes.trim() || null,
        items: pending.map((i) => {
          const d = decisions[i.id];
          return {
            itemId: i.id,
            status: d.status as "done" | "not_done",
            result: d.status === "done" ? d.result : "not_resolved",
            notes: d.notes.trim() || null,
          };
        }),
      });
      if (result.ok) {
        onSuccess(`${detail.code} concluída.`, "O TMM e os efeitos no ciclo preventivo/preditivo foram gravados pelo servidor.");
        onOpenChange(false);
      } else {
        toast({ title: result.error ?? "Não foi possível concluir a manutenção.", variant: "danger" });
      }
    });
  };

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      size="xl"
      title={`Concluir ${detail.code}`}
      description={`Entrada real em ${formatDateTime(detail.entryDate, detail.entryTime)}. Cada serviço precisa de uma decisão.`}
      testId="maintenance-dialog-complete"
    >
      <FormFrame onSubmit={submit}>
        <DialogBody className="flex flex-col gap-4">
          <FormGrid columns={2}>
            <FormField label="Data real de saída" required error={touched ? dateError : undefined}>
              <DateInput value={form.exitDate} max={today} min={detail.entryDate ?? undefined} onChange={(e) => set({ exitDate: e.target.value })} />
            </FormField>
            <FormField label="Hora real de saída" labelHint="Opcional" helperText="Com as duas horas, o TMM é exato; sem elas, em dias.">
              <TimeInput value={form.exitTime} onChange={(e) => set({ exitTime: e.target.value })} />
            </FormField>
          </FormGrid>

          <div className="flex flex-col gap-1 rounded-md border border-border bg-surface-secondary p-3" aria-live="polite">
            <span className="text-caption text-fg-muted">TMM que será calculado (entrada real → saída real)</span>
            <span className="text-body font-semibold tabular-nums text-fg" data-testid="maintenance-complete-tmm">
              {formatDateTime(detail.entryDate, detail.entryTime)} → {form.exitDate ? formatDateTime(form.exitDate, form.exitTime) : "—"}
              {tmm ? ` · ${formatDuration(tmm.hours, tmm.precision)}` : ""}
            </span>
            <span className="text-caption text-fg-muted">
              Prévia para conferência. Quem calcula e grava o TMM é o servidor, na conclusão
              {tmm?.precision === "date" ? "; sem as duas horas, a conta é por dias de calendário (≈)." : "."}
            </span>
          </div>

          <section aria-labelledby="complete-items-title" className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 id="complete-items-title" className="text-label font-semibold text-fg">
                Serviços ({pending.length}){undecided > 0 ? ` · ${undecided} sem decisão` : ""}
              </h4>
              {pending.length > 1 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  leadingIcon={<CheckCheck />}
                  onClick={() => pending.forEach((i) => decide(i.id, { status: "done" }))}
                >
                  Marcar todos como executados
                </Button>
              ) : null}
            </div>
            {pending.length === 0 ? (
              <Alert variant="warning">
                <AlertDescription>Não há serviço pendente. Adicione um serviço antes de concluir.</AlertDescription>
              </Alert>
            ) : (
              <ul className="flex flex-col gap-2">
                {pending.map((item) => {
                  const d = decisions[item.id] ?? { status: "", result: "resolved", notes: "" };
                  const error = touched ? itemErrors[item.id] : undefined;
                  return (
                    <li
                      key={item.id}
                      className={cn("flex flex-col gap-2 rounded-md border p-3", error ? "border-danger/50" : "border-border")}
                      data-testid="maintenance-complete-item"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-body-sm font-semibold text-fg">{item.service}</span>
                        <span className="text-caption text-fg-muted">{item.cluster}</span>
                        <CriticalityBadge value={item.criticality} />
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                        <FormField label="Decisão" required error={error && !d.status ? error : undefined}>
                          <RadioGroup
                            aria-label={`Decisão para ${item.service}`}
                            orientation="horizontal"
                            value={d.status}
                            onValueChange={(v) => decide(item.id, { status: v as ItemDecision["status"] })}
                          >
                            <RadioField value="done" label="Executado" />
                            <RadioField value="not_done" label="Não executado" />
                          </RadioGroup>
                        </FormField>
                        {d.status === "done" ? (
                          <FormField label={<>Resultado<span className="sr-only"> de {item.service}</span></>} required>
                            <NativeSelect value={d.result} onChange={(e) => decide(item.id, { result: e.target.value as ItemDecision["result"] })}>
                              <option value="resolved">{ITEM_RESULT_LABEL.resolved}</option>
                              <option value="partially_resolved">{ITEM_RESULT_LABEL.partially_resolved}</option>
                            </NativeSelect>
                          </FormField>
                        ) : d.status === "not_done" ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-label font-medium text-fg-secondary">Resultado</span>
                            <span className="text-body-sm text-fg">{ITEM_RESULT_LABEL.not_resolved}</span>
                          </div>
                        ) : null}
                      </div>
                      <FormField
                        label={
                          <>
                            {d.status === "not_done" ? "Por que não foi executado" : "Nota"}
                            <span className="sr-only"> ({item.service})</span>
                          </>
                        }
                        required={d.status === "not_done"}
                        labelHint={d.status === "not_done" ? undefined : "Opcional"}
                        error={error && d.status === "not_done" ? error : undefined}
                      >
                        <Input value={d.notes} maxLength={500} onChange={(e) => decide(item.id, { notes: e.target.value })} />
                      </FormField>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <FormGrid columns={2}>
            <FormField label="Fornecedor" labelHint="Opcional">
              <SupplierSelect catalog={catalog} currentId={detail.supplierId} value={form.supplierId} onValueChange={(v) => set({ supplierId: v })} />
            </FormField>
            <FormField label="Ordem de serviço (OS)" labelHint="Opcional">
              <Input value={form.serviceOrderNumber} maxLength={60} onChange={(e) => set({ serviceOrderNumber: e.target.value })} />
            </FormField>
          </FormGrid>
          <FormField label="Observações de conclusão" labelHint="Opcional">
            <Textarea rows={2} maxLength={1000} value={form.completionNotes} onChange={(e) => set({ completionNotes: e.target.value })} />
          </FormField>
        </DialogBody>
        <Footer busy={busy} onCancel={() => onOpenChange(false)} confirmLabel="Concluir manutenção" testId="maintenance-complete-confirm" />
      </FormFrame>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// KM de entrada (manual, com justificativa)
// ---------------------------------------------------------------------------

export function EntryKmDialog({ open, onOpenChange, detail, onSuccess }: LifecycleDialogProps) {
  const { toast } = useToast();
  const [busy, start] = React.useTransition();
  const [touched, setTouched] = React.useState(false);
  const [km, setKm] = React.useState(detail.entryKm != null ? String(detail.entryKm) : "");
  const [justification, setJustification] = React.useState("");
  const [done, setDone] = React.useState<{ km: KmResult | null } | null>(null);

  const value = km.trim() === "" ? null : Number(km);
  const kmError = value == null ? "Informe o KM de entrada." : !Number.isInteger(value) || value < 0 ? "Informe o KM em número inteiro." : undefined;
  const justificationError = minLengthError(justification, 5, "A justificativa");
  const invalid = Boolean(kmError || justificationError);

  const submit = () => {
    setTouched(true);
    if (invalid || value == null) return;
    start(async () => {
      const response = await setEntryKm(detail.id, value, justification.trim());
      if (response.ok) {
        setDone({ km: (response.data as KmResult | undefined) ?? null });
        onSuccess(`KM de entrada de ${detail.code} registrado.`);
      } else {
        toast({ title: response.error ?? "Não foi possível registrar o KM de entrada.", variant: "danger" });
      }
    });
  };

  if (done) {
    return (
      <Shell open={open} onOpenChange={onOpenChange} busy={false} size="lg" title={`KM de entrada · ${detail.code}`}
        description="Resultado da conferência com as leituras oficiais." testId="maintenance-dialog-entry-km">
        <DialogBody>
          <KmResolutionView km={done.km} />
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </Shell>
    );
  }

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      size="md"
      title={`KM de entrada · ${detail.code}`}
      description={`Entrada em ${formatDate(detail.entryDate)}. O KM informado é comparado com as leituras oficiais da data; divergência não bloqueia, só sinaliza.`}
      testId="maintenance-dialog-entry-km"
    >
      <FormFrame onSubmit={submit}>
        <DialogBody className="flex flex-col gap-4">
          <dl className="grid grid-cols-1 gap-3 rounded-md border border-border bg-surface-secondary p-3 sm:grid-cols-3">
            <Fact label="KM atual da manutenção">{formatKm(detail.entryKm)}</Fact>
            <Fact label="Situação"><KmStatusBadge status={detail.entryKmStatus} /></Fact>
            <Fact label="Leitura oficial">{formatKm(detail.entryKmOfficial)}</Fact>
          </dl>
          <FormField label="KM de entrada" required error={touched ? kmError : undefined}>
            <Input inputMode="numeric" trailingAddon="km" value={km} onChange={(e) => setKm(e.target.value.replace(/[^\d]/g, ""))} />
          </FormField>
          <FormField label="Justificativa" required helperText="Mínimo de 5 caracteres. Fica na trilha com o valor anterior." error={touched ? justificationError : undefined}>
            <Textarea rows={2} maxLength={300} value={justification} onChange={(e) => setJustification(e.target.value)} />
          </FormField>
        </DialogBody>
        <Footer busy={busy} onCancel={() => onOpenChange(false)} confirmLabel="Registrar KM" testId="maintenance-entry-km-confirm" />
      </FormFrame>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Adicionar serviços
// ---------------------------------------------------------------------------

export function AddServicesDialog({ open, onOpenChange, detail, catalog, onSuccess }: LifecycleDialogProps) {
  const { toast } = useToast();
  const [busy, start] = React.useTransition();
  const [touched, setTouched] = React.useState(false);
  const [serviceIds, setServiceIds] = React.useState<string[]>([]);
  const [reason, setReason] = React.useState("");
  const services = React.useMemo(() => availableServices(catalog, detail.type, null), [catalog, detail.type]);
  const locked = React.useMemo(
    () => new Set(detail.itemsAll.filter((i) => i.status !== "cancelled").map((i) => i.serviceId)),
    [detail.itemsAll],
  );
  const invalid = serviceIds.length === 0;

  const submit = () => {
    setTouched(true);
    if (invalid) return;
    start(async () => {
      const result = await addMaintenanceItems(detail.id, serviceIds, reason.trim() || undefined);
      if (result.ok) {
        onSuccess(`${serviceIds.length} serviço(s) adicionado(s) a ${detail.code}.`);
        onOpenChange(false);
      } else {
        toast({ title: result.error ?? "Não foi possível adicionar os serviços.", variant: "danger" });
      }
    });
  };

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      size="lg"
      title={`Adicionar serviços · ${detail.code}`}
      description="Só serviços ativos e aplicáveis ao tipo desta manutenção. A aplicabilidade ao equipamento é conferida ao gravar."
      testId="maintenance-dialog-add-items"
    >
      <FormFrame onSubmit={submit}>
        <DialogBody className="flex flex-col gap-4">
          <ServicePicker
            services={services}
            clusters={catalog.clusters}
            value={serviceIds}
            onChange={setServiceIds}
            locked={locked}
            idPrefix="add-items"
          />
          {touched && invalid ? (
            <p role="alert" className="text-helper text-danger">Selecione ao menos um serviço.</p>
          ) : null}
          <FormField label="Motivo" labelHint="Opcional" helperText="Ajuda a ler a trilha depois (ex.: achado na oficina).">
            <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </FormField>
        </DialogBody>
        <Footer
          busy={busy}
          onCancel={() => onOpenChange(false)}
          confirmLabel={serviceIds.length > 0 ? `Adicionar ${serviceIds.length} serviço(s)` : "Adicionar serviços"}
          confirmDisabled={invalid}
          testId="maintenance-add-items-confirm"
        />
      </FormFrame>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Editar dados
// ---------------------------------------------------------------------------

const CRITICALITIES: Criticality[] = ["low", "medium", "high", "critical"];

export function EditDetailsDialog({ open, onOpenChange, detail, catalog, onSuccess }: LifecycleDialogProps) {
  const { toast } = useToast();
  const [busy, start] = React.useTransition();
  const initial = React.useMemo(
    () => ({
      description: detail.description ?? "",
      notes: detail.notes ?? "",
      originId: detail.originId ?? "",
      priority: detail.priority,
      serviceOrderNumber: detail.serviceOrderNumber ?? "",
    }),
    [detail],
  );
  const [form, setForm] = React.useState(initial);
  const [reason, setReason] = React.useState("");
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const origins = catalog.origins.filter((o) => o.manualSelectable && o.isActive);
  const currentIsSystem = Boolean(detail.originId) && !origins.some((o) => o.id === detail.originId);

  const input: DetailsInput = {};
  if (form.description.trim() !== initial.description.trim()) input.description = form.description.trim();
  if (form.notes.trim() !== initial.notes.trim()) input.notes = form.notes.trim();
  if (form.originId && form.originId !== initial.originId) input.originId = form.originId;
  if (form.priority !== initial.priority) input.priority = form.priority;
  if (form.serviceOrderNumber.trim() !== initial.serviceOrderNumber.trim()) input.serviceOrderNumber = form.serviceOrderNumber.trim();
  const dirty = Object.keys(input).length > 0;

  const submit = () => {
    if (!dirty) return;
    start(async () => {
      const result = await updateMaintenanceDetails(detail.id, input, reason.trim() || undefined);
      if (result.ok) {
        onSuccess(`Dados de ${detail.code} atualizados.`);
        onOpenChange(false);
      } else {
        toast({ title: result.error ?? "Não foi possível salvar os dados.", variant: "danger" });
      }
    });
  };

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      size="lg"
      title={`Editar dados · ${detail.code}`}
      description="Dados descritivos. Situação, datas de execução e KM mudam pelas ações próprias, que registram o motivo."
      testId="maintenance-dialog-details"
    >
      <FormFrame onSubmit={submit}>
        <DialogBody className="flex flex-col gap-4">
          <FormGrid columns={2}>
            <FormField
              label="Origem"
              helperText={currentIsSystem ? `A origem atual (${detail.originName ?? "sistema"}) é gravada por rotina do sistema.` : undefined}
            >
              <NativeSelect value={form.originId} onChange={(e) => set({ originId: e.target.value })}>
                {currentIsSystem ? (
                  <option value={detail.originId ?? ""} disabled>
                    {detail.originName ?? "Origem do sistema"} (sistema)
                  </option>
                ) : null}
                {!detail.originId ? <option value="">Não informada</option> : null}
                {origins.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Prioridade">
              <NativeSelect value={form.priority} onChange={(e) => set({ priority: e.target.value as Criticality })}>
                {CRITICALITIES.map((c) => (
                  <option key={c} value={c}>
                    {CRITICALITY_LABEL[c]}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Ordem de serviço (OS)" className="sm:col-span-2">
              <Input value={form.serviceOrderNumber} maxLength={60} onChange={(e) => set({ serviceOrderNumber: e.target.value })} />
            </FormField>
          </FormGrid>
          <FormField label="Descrição">
            <Textarea rows={3} maxLength={2000} value={form.description} onChange={(e) => set({ description: e.target.value })} />
          </FormField>
          <FormField label="Observações">
            <Textarea rows={2} maxLength={2000} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
          </FormField>
          <FormField label="Motivo da alteração" labelHint="Opcional" helperText="O valor anterior e o novo ficam na trilha.">
            <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </FormField>
        </DialogBody>
        <Footer busy={busy} onCancel={() => onOpenChange(false)} confirmLabel="Salvar dados" confirmDisabled={!dirty} testId="maintenance-details-confirm" />
      </FormFrame>
    </Shell>
  );
}
