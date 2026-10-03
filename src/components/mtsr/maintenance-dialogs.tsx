"use client";

import * as React from "react";
import { Link2, Unlink, Wrench } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { CheckboxField } from "@/components/ui/checkbox";
import { RadioField, RadioGroup } from "@/components/ui/radio-group";
import { SearchField } from "@/components/ui/search-field";
import { NativeSelect } from "@/components/governance/selects";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { useToast } from "@/components/feedback/toast";
import {
  linkMaintenance,
  loadMaintenanceCandidates,
  loadMtsrCatalog,
  openMaintenanceFromNok,
  unlinkMaintenance,
  type OpenMaintenanceOutcome,
} from "@/lib/mtsr/actions";
import { fmtInt, formatDate, type MtsrCatalog, type MtsrComponentService, type MtsrMaintenanceCandidate } from "@/lib/mtsr/types";
import { STATUS_LABEL, STATUS_TONE, typeLabel, type MaintenanceStatus } from "@/lib/maintenance/types";

/**
 * Diálogos de Manutenção do MTSR: abrir uma manutenção corporativa a partir de
 * um componente NOK, vincular o componente a uma manutenção já existente e
 * desvincular.
 *
 * Nada é decidido aqui. A rotina do banco confere permissão, escopo e
 * duplicidade, grava o vínculo componente × manutenção e a trilha. O diálogo
 * só reúne o payload, mostra o que a rotina respondeu e devolve o resultado
 * para a tela recarregar.
 */

export type LinkMaintenanceOutcome = { linkId: string; maintenanceId: string; code: string; status: string };
export type UnlinkMaintenanceOutcome = { linkId: string; status: string };

const PRIORITY_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Automática (pela criticidade do componente)" },
  { value: "low", label: "Baixa" },
  { value: "medium", label: "Média" },
  { value: "high", label: "Alta" },
  { value: "critical", label: "Crítica" },
];

const MIN_JUSTIFICATION = 10;
const MIN_REASON = 5;
const MAX_SEARCH_RESULTS = 25;

/** Compara sem acento e sem caixa (busca de serviço). */
const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function MaintenanceStatusTag({ status, label }: { status: string; label?: string | null }) {
  const tone = STATUS_TONE[status as MaintenanceStatus] ?? "neutral";
  return (
    <StatusBadge status={tone} size="sm">
      {label || STATUS_LABEL[status as MaintenanceStatus] || status}
    </StatusBadge>
  );
}

/** Serviços do catálogo de Manutenção mapeados ao componente (vínculos ativos). */
function mappedServices(catalog: MtsrCatalog, componentId: string): MtsrComponentService[] {
  return catalog.componentServices.filter((cs) => cs.componentId === componentId && cs.isActive);
}

// ---------------------------------------------------------------------------
// Abrir manutenção a partir de um componente NOK
// ---------------------------------------------------------------------------
export interface OpenMaintenanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: string;
  componentId: string;
  componentName: string;
  inspectionItemId?: string | null;
  /** Manutenção aberta (ou, ao vincular à já existente, a manutenção vinculada) — a tela recarrega a ficha. */
  onDone: (data: OpenMaintenanceOutcome) => void;
}

export function OpenMaintenanceDialog({ open, onOpenChange, ...rest }: OpenMaintenanceDialogProps) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent size="lg" data-testid="mtsr-open-maintenance-dialog">
        {/* O corpo desmonta ao fechar: cada abertura começa do zero. */}
        <OpenMaintenanceBody {...rest} onBusyChange={setBusy} close={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

type CatalogState = { data: MtsrCatalog | null; error: string | null } | null;

function OpenMaintenanceBody({
  vehicleId,
  componentId,
  componentName,
  inspectionItemId,
  onDone,
  onBusyChange,
  close,
}: Omit<OpenMaintenanceDialogProps, "open" | "onOpenChange"> & { onBusyChange: (busy: boolean) => void; close: () => void }) {
  const { toast } = useToast();
  const [attempt, setAttempt] = React.useState(0);
  const [catalog, setCatalog] = React.useState<CatalogState>(null);
  const [serviceIds, setServiceIds] = React.useState<string[]>([]);
  const [query, setQuery] = React.useState("");
  const [priority, setPriority] = React.useState("");
  const [description, setDescription] = React.useState(`MTSR · ${componentName} não conforme`);
  const [reason, setReason] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [duplicate, setDuplicate] = React.useState<{ maintenanceId: string | null } | null>(null);
  const [justification, setJustification] = React.useState("");
  const [working, setWorking] = React.useState<"open" | "link" | null>(null);

  // Catálogo do MTSR: serviços mapeados ao componente (padrão pré-marcado) e
  // a lista completa de serviços para escolher outros.
  React.useEffect(() => {
    let alive = true;
    void loadMtsrCatalog().then((result) => {
      if (!alive) return;
      if (result.ok && result.data) {
        const mapped = mappedServices(result.data, componentId);
        const defaults = mapped.filter((cs) => cs.isDefault);
        setServiceIds([...new Set((defaults.length ? defaults : mapped).map((cs) => cs.serviceId))]);
        setCatalog({ data: result.data, error: null });
      } else {
        setCatalog({ data: null, error: result.error ?? "Não foi possível ler o catálogo MTSR." });
      }
    });
    return () => {
      alive = false;
    };
  }, [componentId, attempt]);

  const data = catalog?.data ?? null;
  const mapped = React.useMemo(() => (data ? mappedServices(data, componentId) : []), [data, componentId]);
  const mappedIds = React.useMemo(() => new Set(mapped.map((cs) => cs.serviceId)), [mapped]);

  const others = React.useMemo(() => {
    if (!data) return [];
    const q = normalize(query.trim());
    const selectedOutside = data.services.filter((s) => serviceIds.includes(s.id) && !mappedIds.has(s.id));
    if (!q) return selectedOutside;
    const hits = data.services.filter(
      (s) => !mappedIds.has(s.id) && !serviceIds.includes(s.id) && (normalize(s.name).includes(q) || normalize(s.clusterName ?? "").includes(q)),
    );
    return [...selectedOutside, ...hits.slice(0, MAX_SEARCH_RESULTS)];
  }, [data, query, serviceIds, mappedIds]);

  const toggle = (id: string, checked: boolean) =>
    setServiceIds((prev) => (checked ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));

  const servicesError = touched && serviceIds.length === 0 ? "Escolha pelo menos um serviço." : undefined;
  const justificationOk = justification.trim().length >= MIN_JUSTIFICATION;

  const run = async (force: boolean) => {
    setTouched(true);
    if (serviceIds.length === 0) return;
    if (force && !justificationOk) return;
    setWorking("open");
    onBusyChange(true);
    const result = await openMaintenanceFromNok({
      vehicleId,
      componentId,
      inspectionItemId: inspectionItemId ?? null,
      serviceIds,
      priority: priority || null,
      description: description.trim() || null,
      reason: reason.trim() || null,
      duplicateJustification: force ? justification.trim() : null,
    });
    setWorking(null);
    onBusyChange(false);
    if (result.ok && result.data) {
      toast({
        variant: "success",
        title: `Manutenção ${result.data.code} aberta`,
        description: `${componentName}: o componente fica NOK até nova vistoria ou leitura, mesmo após a conclusão.`,
      });
      onDone(result.data);
      close();
      return;
    }
    if (result.duplicate) {
      setDuplicate(result.duplicate);
      return;
    }
    toast({ variant: "danger", title: "Não foi possível abrir a manutenção", description: result.error });
  };

  const linkExisting = async () => {
    if (!duplicate?.maintenanceId) return;
    setWorking("link");
    onBusyChange(true);
    const result = await linkMaintenance({
      maintenanceId: duplicate.maintenanceId,
      componentId,
      inspectionItemId: inspectionItemId ?? null,
      reason: reason.trim() || null,
    });
    setWorking(null);
    onBusyChange(false);
    if (result.ok && result.data) {
      toast({ variant: "success", title: `${componentName} vinculado à manutenção ${result.data.code}` });
      onDone({
        id: result.data.maintenanceId,
        code: result.data.code,
        status: result.data.status,
        linkId: result.data.linkId,
        componentId,
      });
      close();
      return;
    }
    toast({ variant: "danger", title: "Não foi possível vincular a manutenção", description: result.error });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Wrench aria-hidden className="size-5 text-fg-muted" />
          Abrir manutenção corporativa
        </DialogTitle>
        <DialogDescription>
          Componente <strong className="font-semibold text-fg">{componentName}</strong> não conforme. A manutenção é aberta no módulo oficial
          (Gestão de Frota › Manutenção) com origem MTSR e já vinculada a este componente.
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="flex flex-col gap-4">
        {!catalog ? (
          <LoadingState variant="block" label="Carregando serviços do catálogo…" />
        ) : catalog.error || !data ? (
          <ErrorState
            variant="panel"
            title="Não foi possível ler o catálogo MTSR"
            description={catalog.error ?? undefined}
            onRetry={() => setAttempt((n) => n + 1)}
          />
        ) : (
          <>
            <FormField
              label="Serviços da manutenção"
              required
              error={servicesError}
              helperText={
                serviceIds.length
                  ? `${fmtInt(serviceIds.length)} ${serviceIds.length === 1 ? "serviço selecionado" : "serviços selecionados"}.`
                  : "Os serviços mapeados ao componente no catálogo do MTSR vêm pré-marcados; outros podem ser buscados abaixo."
              }
            >
              <div className="flex flex-col gap-3" data-testid="mtsr-open-maintenance-services">
                <div className="rounded-md border border-border">
                  <p className="border-b border-border bg-surface-secondary px-3 py-1.5 text-caption font-semibold text-fg-secondary">
                    Mapeados ao componente
                  </p>
                  {mapped.length === 0 ? (
                    <p className="px-3 py-3 text-caption text-fg-muted">
                      Nenhum serviço mapeado a este componente no catálogo do MTSR. Busque e escolha um serviço abaixo.
                    </p>
                  ) : (
                    <ul className="flex flex-col divide-y divide-border-subtle px-1.5 py-1">
                      {mapped.map((cs) => (
                        <li key={cs.id}>
                          <CheckboxField
                            checked={serviceIds.includes(cs.serviceId)}
                            onCheckedChange={(v) => toggle(cs.serviceId, v === true)}
                            disabled={working !== null}
                            label={
                              <span className="flex flex-wrap items-center gap-1.5">
                                {cs.serviceName}
                                {cs.isDefault ? (
                                  <Badge variant="primary" appearance="outline" size="sm">Padrão</Badge>
                                ) : null}
                              </span>
                            }
                            description={cs.clusterName ?? undefined}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <SearchField
                    value={query}
                    onValueChange={setQuery}
                    placeholder="Buscar outro serviço por nome ou cluster…"
                    aria-label="Buscar serviço"
                    disabled={working !== null}
                  />
                  {others.length > 0 ? (
                    <ul className="flex max-h-56 flex-col divide-y divide-border-subtle overflow-y-auto rounded-md border border-border px-1.5 py-1">
                      {others.map((s) => (
                        <li key={s.id}>
                          <CheckboxField
                            checked={serviceIds.includes(s.id)}
                            onCheckedChange={(v) => toggle(s.id, v === true)}
                            disabled={working !== null}
                            label={s.name}
                            description={s.clusterName ?? undefined}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : query.trim() ? (
                    <p className="text-caption text-fg-muted">Nenhum serviço encontrado para “{query.trim()}”.</p>
                  ) : null}
                </div>
              </div>
            </FormField>

            <FormField label="Prioridade" helperText="Em branco, a rotina define pela criticidade do componente.">
              <NativeSelect value={priority} onChange={(e) => setPriority(e.target.value)} disabled={working !== null}>
                {PRIORITY_OPTIONS.map((o) => (
                  <option key={o.value || "auto"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            </FormField>

            <FormField label="Descrição">
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={500} disabled={working !== null} />
            </FormField>

            <FormField label="Observação / motivo" labelHint="Opcional" helperText="Fica na trilha do MTSR e na manutenção.">
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} disabled={working !== null} />
            </FormField>

            {duplicate ? (
              <Alert variant="warning" data-testid="mtsr-open-maintenance-duplicate">
                <AlertTitle>Já existe manutenção aberta para este componente</AlertTitle>
                <AlertDescription className="flex flex-col gap-3">
                  <p>
                    Vincule o componente à manutenção já aberta ou, se for mesmo necessária outra manutenção, justifique a abertura
                    (mínimo de {MIN_JUSTIFICATION} caracteres).
                  </p>
                  <div>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      leadingIcon={<Link2 />}
                      onClick={() => void linkExisting()}
                      loading={working === "link"}
                      disabled={working !== null || !duplicate.maintenanceId}
                    >
                      Vincular a essa manutenção
                    </Button>
                    {!duplicate.maintenanceId ? (
                      <p className="mt-1 text-caption">
                        A rotina não informou qual manutenção está aberta. Use “Vincular manutenção” na ficha para escolher.
                      </p>
                    ) : null}
                  </div>
                  <FormField
                    label="Justificativa para abrir mesmo assim"
                    required
                    error={justification.length > 0 && !justificationOk ? `Mínimo de ${MIN_JUSTIFICATION} caracteres.` : undefined}
                  >
                    <Textarea
                      value={justification}
                      onChange={(e) => setJustification(e.target.value)}
                      rows={2}
                      maxLength={500}
                      disabled={working !== null}
                      data-testid="mtsr-open-maintenance-justification"
                    />
                  </FormField>
                </AlertDescription>
              </Alert>
            ) : null}
          </>
        )}
      </DialogBody>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={close} disabled={working !== null}>
          Cancelar
        </Button>
        {duplicate ? (
          <Button
            type="button"
            variant="primary"
            leadingIcon={<Wrench />}
            onClick={() => void run(true)}
            loading={working === "open"}
            disabled={working !== null || !justificationOk || serviceIds.length === 0}
            data-testid="mtsr-open-maintenance-force"
          >
            Abrir mesmo assim
          </Button>
        ) : (
          <Button
            type="button"
            variant="primary"
            leadingIcon={<Wrench />}
            onClick={() => void run(false)}
            loading={working === "open"}
            disabled={working !== null || !data}
            data-testid="mtsr-open-maintenance-submit"
          >
            Abrir manutenção
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------------------
// Vincular manutenção existente
// ---------------------------------------------------------------------------
export interface LinkMaintenanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: string;
  componentId: string;
  componentName: string;
  inspectionItemId?: string | null;
  onDone: (data: LinkMaintenanceOutcome) => void;
}

export function LinkMaintenanceDialog({ open, onOpenChange, ...rest }: LinkMaintenanceDialogProps) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent size="lg" data-testid="mtsr-link-maintenance-dialog">
        <LinkMaintenanceBody {...rest} onBusyChange={setBusy} close={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

type CandidatesState = { rows: MtsrMaintenanceCandidate[] | null; error: string | null } | null;

function candidateDates(c: MtsrMaintenanceCandidate): string {
  const parts: string[] = [];
  if (c.requestedOn) parts.push(`Solicitada em ${formatDate(c.requestedOn)}`);
  if (c.scheduledDate) parts.push(`Agendada para ${formatDate(c.scheduledDate)}`);
  if (c.exitDate) parts.push(`Saída em ${formatDate(c.exitDate)}`);
  return parts.join(" · ");
}

function LinkMaintenanceBody({
  vehicleId,
  componentId,
  componentName,
  inspectionItemId,
  onDone,
  onBusyChange,
  close,
}: Omit<LinkMaintenanceDialogProps, "open" | "onOpenChange"> & { onBusyChange: (busy: boolean) => void; close: () => void }) {
  const { toast } = useToast();
  const [attempt, setAttempt] = React.useState(0);
  const [state, setState] = React.useState<CandidatesState>(null);
  const [selected, setSelected] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [working, setWorking] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    void loadMaintenanceCandidates(vehicleId, componentId).then((result) => {
      if (!alive) return;
      setState({
        rows: result.ok ? (result.data ?? []) : null,
        error: result.ok ? null : (result.error ?? "Não foi possível listar as manutenções do veículo."),
      });
    });
    return () => {
      alive = false;
    };
  }, [vehicleId, componentId, attempt]);

  const rows = state?.rows ?? [];
  const chosen = rows.find((r) => r.id === selected) ?? null;

  const submit = async () => {
    if (!chosen || chosen.alreadyLinked) return;
    setWorking(true);
    onBusyChange(true);
    const result = await linkMaintenance({
      maintenanceId: chosen.id,
      componentId,
      inspectionItemId: inspectionItemId ?? null,
      reason: reason.trim() || null,
    });
    setWorking(false);
    onBusyChange(false);
    if (result.ok && result.data) {
      toast({
        variant: "success",
        title: `${componentName} vinculado à manutenção ${result.data.code}`,
        description: "A conformidade do componente só muda com nova vistoria ou leitura.",
      });
      onDone(result.data);
      close();
      return;
    }
    toast({ variant: "danger", title: "Não foi possível vincular a manutenção", description: result.error });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Link2 aria-hidden className="size-5 text-fg-muted" />
          Vincular manutenção existente
        </DialogTitle>
        <DialogDescription>
          Escolha uma manutenção deste veículo para tratar o componente{" "}
          <strong className="font-semibold text-fg">{componentName}</strong>. O vínculo é registrado no MTSR e aparece na gaveta da
          manutenção.
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="flex flex-col gap-4">
        {!state ? (
          <LoadingState variant="block" label="Buscando manutenções do veículo…" />
        ) : state.error ? (
          <ErrorState
            variant="panel"
            title="Não foi possível listar as manutenções"
            description={state.error}
            onRetry={() => setAttempt((n) => n + 1)}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            variant="panel"
            size="sm"
            title="Nenhuma manutenção disponível para vincular"
            description="Este veículo não tem manutenção aberta no módulo de Manutenção. Abra uma nova a partir do componente."
          />
        ) : (
          <>
            <RadioGroup value={selected} onValueChange={setSelected} aria-label="Manutenções do veículo" className="flex flex-col gap-1">
              {rows.map((c) => (
                <RadioField
                  key={c.id}
                  value={c.id}
                  disabled={working || c.alreadyLinked}
                  className="rounded-md border border-border px-3"
                  data-testid={`mtsr-link-candidate-${c.code}`}
                  label={
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-caption font-semibold text-fg">{c.code}</span>
                      <MaintenanceStatusTag status={c.status} label={c.label} />
                      <Badge variant="neutral" appearance="outline" size="sm">
                        {typeLabel(c.maintenanceTypeCode)}
                      </Badge>
                      {c.alreadyLinked ? (
                        <Badge variant="info" appearance="soft" size="sm">Já vinculada</Badge>
                      ) : null}
                      {c.mappedService ? (
                        <Badge variant="success" appearance="outline" size="sm">Serviço mapeado</Badge>
                      ) : null}
                    </span>
                  }
                  description={
                    <span className="flex flex-col gap-0.5">
                      {candidateDates(c) ? <span>{candidateDates(c)}</span> : null}
                      {c.services.length ? <span>Serviços: {c.services.join(", ")}</span> : <span>Sem serviços registrados.</span>}
                      {c.description ? <span className="text-fg-secondary">{c.description}</span> : null}
                    </span>
                  }
                />
              ))}
            </RadioGroup>

            <FormField label="Motivo do vínculo" labelHint="Opcional" helperText="Fica na trilha do MTSR.">
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} disabled={working} />
            </FormField>
          </>
        )}
      </DialogBody>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={close} disabled={working}>
          Cancelar
        </Button>
        <Button
          type="button"
          variant="primary"
          leadingIcon={<Link2 />}
          onClick={() => void submit()}
          loading={working}
          disabled={working || !chosen || chosen.alreadyLinked}
          data-testid="mtsr-link-maintenance-submit"
        >
          Vincular
        </Button>
      </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------------------
// Desvincular
// ---------------------------------------------------------------------------
export interface UnlinkMaintenanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linkId: string;
  /** O que está sendo desvinculado, para a pessoa confirmar ("MNT-000123 · Cinto de segurança"). */
  label: string;
  onDone: (data: UnlinkMaintenanceOutcome) => void;
}

export function UnlinkMaintenanceDialog({ open, onOpenChange, ...rest }: UnlinkMaintenanceDialogProps) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent size="md" data-testid="mtsr-unlink-maintenance-dialog">
        <UnlinkMaintenanceBody {...rest} onBusyChange={setBusy} close={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function UnlinkMaintenanceBody({
  linkId,
  label,
  onDone,
  onBusyChange,
  close,
}: Omit<UnlinkMaintenanceDialogProps, "open" | "onOpenChange"> & { onBusyChange: (busy: boolean) => void; close: () => void }) {
  const { toast } = useToast();
  const [reason, setReason] = React.useState("");
  const [working, setWorking] = React.useState(false);
  const ok = reason.trim().length >= MIN_REASON;

  const submit = async () => {
    if (!ok) return;
    setWorking(true);
    onBusyChange(true);
    const result = await unlinkMaintenance(linkId, reason.trim());
    setWorking(false);
    onBusyChange(false);
    if (result.ok && result.data) {
      toast({ variant: "success", title: "Vínculo desfeito", description: label });
      onDone(result.data);
      close();
      return;
    }
    toast({ variant: "danger", title: "Não foi possível desvincular a manutenção", description: result.error });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Unlink aria-hidden className="size-5 text-fg-muted" />
          Desvincular manutenção
        </DialogTitle>
        <DialogDescription>{label}</DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4">
        <Alert variant="warning">
          <AlertDescription>
            O vínculo entre a manutenção e o componente deixa de valer para o MTSR; a manutenção continua existindo no módulo de
            Manutenção. O componente segue com o status oficial atual.
          </AlertDescription>
        </Alert>
        <FormField
          label="Motivo"
          required
          helperText={`Mínimo de ${MIN_REASON} caracteres. Fica na trilha do MTSR.`}
          error={reason.length > 0 && !ok ? `Informe pelo menos ${MIN_REASON} caracteres.` : undefined}
        >
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} disabled={working} autoFocus data-testid="mtsr-unlink-reason" />
        </FormField>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={close} disabled={working}>
          Cancelar
        </Button>
        <Button
          type="button"
          variant="danger"
          leadingIcon={<Unlink />}
          onClick={() => void submit()}
          loading={working}
          disabled={working || !ok}
          data-testid="mtsr-unlink-maintenance-submit"
        >
          Desvincular
        </Button>
      </DialogFooter>
    </>
  );
}
