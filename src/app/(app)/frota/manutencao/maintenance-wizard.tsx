"use client";

import * as React from "react";
import { ArrowLeft, ArrowRight, Check, ExternalLink, ListPlus, Repeat, Truck } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox, CheckboxField } from "@/components/ui/checkbox";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { RadioField, RadioGroup } from "@/components/ui/radio-group";
import { SearchField } from "@/components/ui/search-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { Skeleton, SkeletonGroup } from "@/components/feedback/skeleton";
import { NativeSelect } from "@/components/governance/selects";
import { useToast } from "@/components/feedback/toast";
import {
  MaintenanceStatusBadge,
  PredictiveStatusBadge,
  PreventiveStatusBadge,
} from "@/components/maintenance/badges";
import {
  addMaintenanceItems,
  createMaintenance,
  findOpenEquivalents,
  linkFindings,
  loadVehicleContext,
  loadVehicleFindings,
  searchMaintenanceVehicles,
  type CreateMaintenanceInput,
} from "@/lib/maintenance/actions";
import {
  CRITICALITY_LABEL,
  EXECUTION_LABEL,
  KM_STATUS_LABEL,
  PREVENTIVE_STATUS_LABEL,
  STATUS_LABEL,
  formatDate,
  formatDateTime,
  formatInt,
  formatKm,
  typeLabel,
  vehicleLabel,
  type ChecklistFinding,
  type Criticality,
  type MaintenanceCatalog,
  type MaintenanceContext,
  type MaintenanceService,
  type OpenEquivalent,
  type VehicleContext,
  type VehicleOption,
} from "@/lib/maintenance/types";
import {
  KmResolutionView,
  ServicePicker,
  SupplierSelect,
  TimeInput,
  availableServices,
  supplierDisplayName,
  todayInSaoPaulo,
} from "./lifecycle-dialogs";
import type { MaintenancePerms, WizardPreset } from "./shared";

/**
 * Assistente de abertura de manutenção — cinco passos, uma rotina.
 *
 * O navegador reúne o que a rotina `maintenance_create` precisa e mostra o que
 * o servidor já sabe (contexto na data, KM oficial, abertas equivalentes,
 * ciclos pendentes). Nada é decidido aqui: situação inicial, duplicidade,
 * aplicabilidade dos serviços e KM são conferidos de novo na gravação.
 */

export interface MaintenanceWizardProps {
  open: boolean;
  preset?: WizardPreset;
  onOpenChange: (open: boolean) => void;
  catalog: MaintenanceCatalog;
  perms: MaintenancePerms;
  onCreated: (id: string) => void;
  onOpenMaintenance: (id: string) => void;
}

/** Em telefone o assistente ocupa a tela inteira; no desktop tem altura fixa (não pula entre passos). */
const PHONE_FULLSCREEN = cn(
  "max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:w-full max-sm:max-w-none",
  "max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0",
  "sm:h-[min(52rem,calc(100dvh-2rem))]",
);

export function MaintenanceWizard(props: MaintenanceWizardProps) {
  const { open, onOpenChange } = props;
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent size="xl" className={PHONE_FULLSCREEN} data-testid="maintenance-wizard">
        {/* O conteúdo do diálogo desmonta ao fechar: cada abertura começa do zero. */}
        <WizardBody {...props} onBusyChange={setBusy} />
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Estado e passos
// ---------------------------------------------------------------------------

type Step = 1 | 2 | 3 | 4 | 5;
type InitialStatus = "to_schedule" | "scheduled" | "in_progress";

const STEPS: { n: Step; label: string; hint: string }[] = [
  { n: 1, label: "Frota", hint: "Escolha o veículo e confira o contexto e o que já está aberto." },
  { n: 2, label: "Serviço", hint: "Tipo, origem, prioridade e os serviços da manutenção." },
  { n: 3, label: "Programação", hint: "Situação inicial, datas, fornecedor e OS." },
  { n: 4, label: "KM", hint: "KM oficial resolvido pelo servidor, ou informado com justificativa." },
  { n: 5, label: "Revisão", hint: "Confira tudo antes de abrir." },
];

const CRITICALITIES: Criticality[] = ["low", "medium", "high", "critical"];
const VEHICLE_STATUS_LABEL: Record<string, string> = { active: "Ativa", inactive: "Inativa" };
interface Plan {
  status: InitialStatus;
  requestedOn: string;
  scheduledDate: string;
  scheduledTime: string;
  expectedExitDate: string;
  expectedExitTime: string;
  supplierId: string;
  serviceOrderNumber: string;
  schedulingNotes: string;
  entryDate: string;
  entryTime: string;
}

/** Veículo escolhido, com contexto e apontamentos: uma resposta só, sem mistura entre veículos. */
interface VehicleState {
  id: string | null;
  context: VehicleContext | null;
  error: string | null;
  loading: boolean;
  findings: ChecklistFinding[] | null;
  findingsError: string | null;
}

const NO_VEHICLE: VehicleState = { id: null, context: null, error: null, loading: false, findings: null, findingsError: null };

function WizardBody({
  preset, onOpenChange, catalog, perms, onCreated, onOpenMaintenance, onBusyChange,
}: MaintenanceWizardProps & { onBusyChange: (busy: boolean) => void }) {
  const { toast } = useToast();
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  const [today] = React.useState(todayInSaoPaulo);
  // O preset é lido uma vez, na abertura.
  const [initial] = React.useState(() => preset ?? {});
  const [step, setStep] = React.useState<Step>(1);
  const [touched, setTouched] = React.useState<Record<Step, boolean>>({ 1: false, 2: false, 3: false, 4: false, 5: false });

  // Passo 1 — frota
  const [term, setTerm] = React.useState("");
  const [search, setSearch] = React.useState<{ term: string; rows: VehicleOption[]; error: string | null } | null>(null);
  const [searching, startSearch] = React.useTransition();
  const [vehicle, setVehicle] = React.useState<VehicleState>(() =>
    initial.vehicleId ? { ...NO_VEHICLE, id: initial.vehicleId, loading: true } : NO_VEHICLE,
  );

  // Passo 2 — serviço
  const typeCodes = catalog.types.map((t) => t.code);
  const [typeCode, setTypeCode] = React.useState(() =>
    initial.maintenanceTypeCode && typeCodes.includes(initial.maintenanceTypeCode)
      ? initial.maintenanceTypeCode
      : typeCodes.includes("corrective") ? "corrective" : typeCodes[0] ?? "corrective",
  );
  const presetOrigin = catalog.origins.find((o) => o.code === initial.originCode && o.isActive) ?? null;
  const [originId, setOriginId] = React.useState(presetOrigin?.id ?? "");
  const [priority, setPriority] = React.useState<Criticality>(
    initial.priority === "low" || initial.priority === "high" || initial.priority === "critical" ? initial.priority : "medium",
  );
  const [description, setDescription] = React.useState(initial.description ?? "");
  const [serviceIds, setServiceIds] = React.useState<string[]>(initial.serviceIds ?? []);
  const [preventiveCycleId, setPreventiveCycleId] = React.useState("");
  const [findingIds, setFindingIds] = React.useState<string[]>(initial.checklistAnswerIds ?? []);
  const [dup, setDup] = React.useState<{ key: string; rows: OpenEquivalent[] } | null>(null);
  const [dupJustification, setDupJustification] = React.useState("");
  const [dupAccepted, setDupAccepted] = React.useState<string | null>(null);

  // Passo 3 — programação
  const [plan, setPlan] = React.useState<Plan>(() => ({
    status: "to_schedule",
    requestedOn: today,
    scheduledDate: "",
    scheduledTime: "",
    expectedExitDate: "",
    expectedExitTime: "",
    supplierId: "",
    serviceOrderNumber: "",
    schedulingNotes: "",
    entryDate: today,
    entryTime: "",
  }));
  const setPlanField = (patch: Partial<Plan>) => setPlan((p) => ({ ...p, ...patch }));

  // Passo 4 — KM
  const [kmState, setKmState] = React.useState<{ date: string; context: VehicleContext | null; error: string | null } | null>(null);
  const [manualKm, setManualKm] = React.useState(false);
  const [entryKm, setEntryKm] = React.useState("");
  const [entryKmJustification, setEntryKmJustification] = React.useState("");

  const [working, startWorking] = React.useTransition();

  // ---------------------------------------------------------------------------
  // Leituras
  // ---------------------------------------------------------------------------

  /** Contexto e apontamentos do veículo. Só grava estado quando a resposta chega. */
  const fetchVehicle = React.useCallback(
    (id: string, date: string) => {
      void Promise.all([loadVehicleContext(id, date), loadVehicleFindings(id, 60)]).then(([ctx, found]) => {
        // Resposta de um veículo que já foi trocado é descartada.
        setVehicle((prev) =>
          prev.id !== id
            ? prev
            : {
                id,
                context: ctx.ok ? ctx.data ?? null : null,
                error: ctx.ok ? (ctx.data ? null : "Veículo não encontrado.") : ctx.error ?? "Não foi possível carregar o veículo.",
                loading: false,
                findings: found.ok ? found.data ?? [] : null,
                findingsError: found.ok ? null : found.error ?? "Não foi possível carregar os apontamentos do Check List.",
              },
        );
        // Apontamentos vindos do preset já sugerem os seus serviços.
        if (found.ok && initial.checklistAnswerIds?.length && !initial.serviceIds?.length) {
          const wanted = new Set(initial.checklistAnswerIds);
          const suggested = (found.data ?? []).filter((f) => wanted.has(f.answerId)).flatMap((f) => f.suggestedServiceIds);
          if (suggested.length) setServiceIds((prev) => [...new Set([...prev, ...suggested])]);
        }
      }).catch(() => {
        setVehicle((prev) =>
          prev.id !== id ? prev : { ...prev, loading: false, error: "Não foi possível carregar o veículo. Verifique a conexão." },
        );
      });
    },
    [initial],
  );

  React.useEffect(() => {
    if (initial.vehicleId) fetchVehicle(initial.vehicleId, today);
  }, [initial, fetchVehicle, today]);

  // Busca por placa/frota, com espera de 300 ms entre teclas.
  React.useEffect(() => {
    const q = term.trim();
    if (q.length < 2) return;
    const handle = window.setTimeout(() => {
      startSearch(async () => {
        const result = await searchMaintenanceVehicles(q);
        setSearch({ term: q, rows: result.ok ? result.data ?? [] : [], error: result.ok ? null : result.error ?? "Não foi possível buscar veículos." });
      });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [term]);

  // ---------------------------------------------------------------------------
  // Derivados
  // ---------------------------------------------------------------------------

  const ctx = vehicle.context;
  const vehicleActive = Boolean(ctx && ctx.vehicle.status === "active" && !ctx.vehicle.archived);
  const isPreventive = typeCode === "preventive";
  const services = React.useMemo(
    () => availableServices(catalog, typeCode, ctx?.vehicle.vehicleTypeId ?? null),
    [catalog, typeCode, ctx?.vehicle.vehicleTypeId],
  );
  const serviceById = React.useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);
  const allServiceById = React.useMemo(() => new Map(catalog.services.map((s) => [s.id, s])), [catalog.services]);
  // Serviço que deixou de se aplicar (troca de tipo ou de veículo) sai da seleção.
  const effectiveServiceIds = serviceIds.filter((id) => serviceById.has(id));
  const servicesKey = `${vehicle.id ?? ""}|${[...effectiveServiceIds].sort().join(",")}`;
  const selectedFindings = (vehicle.findings ?? []).filter((f) => findingIds.includes(f.answerId));
  const suggested = new Set(selectedFindings.flatMap((f) => f.suggestedServiceIds));
  const origins = catalog.origins.filter((o) => o.isActive && (o.manualSelectable || o.id === presetOrigin?.id));
  const checklistOrigin = catalog.origins.find((o) => o.code === "checklist" && o.isActive && o.manualSelectable) ?? null;
  const cycles = (ctx?.preventiveCycles ?? []).filter((c) => c.status !== "completed");
  const chosenCycle = cycles.find((c) => c.id === preventiveCycleId) ?? null;
  const kmDate = plan.status === "in_progress" ? plan.entryDate : plan.requestedOn;
  const kmContext = kmState && kmState.date === kmDate ? kmState.context : null;
  const kmValue = entryKm.trim() === "" ? null : Number(entryKm);
  const dupRows = dup && dup.key === servicesKey && dupAccepted !== servicesKey ? dup.rows : null;

  // ---------------------------------------------------------------------------
  // Validação por passo (só completude; as regras são do banco)
  // ---------------------------------------------------------------------------

  const step1Error = !vehicle.id
    ? "Escolha um veículo."
    : vehicle.loading
      ? "Aguarde o carregamento do veículo."
      : !ctx
        ? vehicle.error ?? "Não foi possível carregar o veículo."
        : !vehicleActive
          ? "Frota inativa: novas manutenções só podem ser abertas para frotas ativas."
          : null;

  const step2Errors = {
    type: isPreventive && !perms.managePreventive
      ? "Manutenção preventiva é gerada a partir do ciclo (permissão de gerir preventiva)."
      : undefined,
    origin: !isPreventive && !originId ? "Escolha a origem." : undefined,
    cycle: isPreventive && !preventiveCycleId ? "Escolha o ciclo preventivo (MP) do veículo." : undefined,
    services: !isPreventive && effectiveServiceIds.length === 0 ? "Selecione ao menos um serviço." : undefined,
  };

  const step3Errors = {
    requestedOn: !plan.requestedOn
      ? "Informe a data da solicitação."
      : plan.requestedOn > today
        ? "A solicitação não pode estar no futuro."
        : undefined,
    scheduledDate: plan.status === "scheduled" && !plan.scheduledDate ? "Informe a data do agendamento." : undefined,
    entryDate:
      plan.status === "in_progress"
        ? !plan.entryDate
          ? "Informe a data real de entrada."
          : plan.entryDate > today
            ? "A entrada real não pode estar no futuro."
            : undefined
        : undefined,
  };

  const step4Errors = {
    km: plan.status === "in_progress" && manualKm
      ? kmValue == null
        ? "Informe o KM de entrada."
        : !Number.isInteger(kmValue) || kmValue < 0
          ? "Informe o KM em número inteiro."
          : undefined
      : undefined,
    justification: plan.status === "in_progress" && manualKm && entryKmJustification.trim().length < 5
      ? "Justifique o KM manual (mínimo de 5 caracteres)."
      : undefined,
  };

  const hasErrors = (errors: Record<string, string | undefined>) => Object.values(errors).some(Boolean);
  const show = (s: Step, error: string | undefined) => (touched[s] ? error : undefined);

  // ---------------------------------------------------------------------------
  // Ações
  // ---------------------------------------------------------------------------

  const goTo = (next: Step) => {
    setStep(next);
    bodyRef.current?.scrollTo({ top: 0 });
  };

  const chooseVehicle = (option: VehicleOption) => {
    setVehicle({ ...NO_VEHICLE, id: option.id, loading: true });
    setFindingIds([]);
    setPreventiveCycleId("");
    setDup(null);
    setDupAccepted(null);
    setKmState(null);
    fetchVehicle(option.id, plan.requestedOn || today);
  };

  const clearVehicle = () => {
    setVehicle(NO_VEHICLE);
    setFindingIds([]);
    setPreventiveCycleId("");
    setDup(null);
    setDupAccepted(null);
    setKmState(null);
  };

  const retryVehicle = () => {
    if (!vehicle.id) return;
    setVehicle((v) => ({ ...v, loading: true, error: null, findingsError: null }));
    fetchVehicle(vehicle.id, plan.requestedOn || today);
  };

  const changeType = (code: string) => {
    setTypeCode(code);
    setPreventiveCycleId("");
  };

  const toggleFinding = (finding: ChecklistFinding, checked: boolean) => {
    setFindingIds((ids) => (checked ? [...new Set([...ids, finding.answerId])] : ids.filter((id) => id !== finding.answerId)));
    if (!checked) return;
    const add = finding.suggestedServiceIds.filter((id) => serviceById.has(id));
    if (add.length) setServiceIds((ids) => [...new Set([...ids, ...add])]);
    if (!originId && !isPreventive && checklistOrigin) setOriginId(checklistOrigin.id);
  };

  /** Ao sair do passo 2: há manutenção aberta equivalente? */
  const checkDuplicates = () => {
    if (!vehicle.id) return;
    if (dupAccepted === servicesKey) {
      goTo(3);
      return;
    }
    const vehicleId = vehicle.id;
    const key = servicesKey;
    startWorking(async () => {
      const result = await findOpenEquivalents(vehicleId, effectiveServiceIds);
      if (!result.ok) {
        // Não bloqueia: o banco repete a verificação ao abrir.
        toast({ title: result.error ?? "Não foi possível verificar manutenções abertas.", description: "A verificação é refeita ao abrir a manutenção.", variant: "warning" });
        goTo(3);
        return;
      }
      const rows = (result.data ?? []).filter((e) => e.sameService || e.sameCluster);
      if (rows.length === 0) {
        setDup(null);
        goTo(3);
        return;
      }
      setDup({ key, rows });
      bodyRef.current?.scrollTo({ top: 0 });
    });
  };

  const complementExisting = (existing: OpenEquivalent) => {
    if (effectiveServiceIds.length === 0) return;
    const ids = effectiveServiceIds;
    const answers = findingIds;
    onBusyChange(true);
    startWorking(async () => {
      let done = false;
      try {
        const result = await addMaintenanceItems(existing.id, ids, "Complemento via assistente");
        if (!result.ok) {
          toast({ title: result.error ?? "Não foi possível complementar a manutenção.", variant: "danger" });
          return;
        }
        if (answers.length > 0) {
          const linked = await linkFindings(existing.id, answers, "Complemento via assistente");
          if (!linked.ok) {
            toast({ title: "Serviços adicionados, mas os apontamentos não foram vinculados.", description: linked.error, variant: "warning" });
          }
        }
        const added = Array.isArray(result.data) ? result.data.length : ids.length;
        toast({
          title: added > 0 ? `${added} serviço(s) adicionado(s) a ${existing.code}.` : `Os serviços já estavam em ${existing.code}.`,
          variant: "success",
        });
        done = true;
      } catch {
        toast({ title: "Não foi possível complementar a manutenção. Tente de novo.", variant: "danger" });
      } finally {
        onBusyChange(false);
      }
      if (done) onOpenMaintenance(existing.id);
    });
  };

  const acceptDuplicate = () => {
    if (dupJustification.trim().length < 10) return;
    setDupAccepted(servicesKey);
    goTo(3);
  };

  /** Ao sair do passo 3: o servidor resolve contexto e KM para a data efetiva. */
  const loadKmStep = () => {
    if (!vehicle.id) return;
    if (kmState && kmState.date === kmDate && kmState.context) {
      goTo(4);
      return;
    }
    const vehicleId = vehicle.id;
    const date = kmDate;
    startWorking(async () => {
      const result = await loadVehicleContext(vehicleId, date);
      setKmState({
        date,
        context: result.ok ? result.data ?? null : null,
        error: result.ok ? null : result.error ?? "Não foi possível resolver o KM da data.",
      });
      goTo(4);
    });
  };

  const retryKm = () => {
    if (!vehicle.id) return;
    const vehicleId = vehicle.id;
    const date = kmDate;
    startWorking(async () => {
      const result = await loadVehicleContext(vehicleId, date);
      setKmState({ date, context: result.ok ? result.data ?? null : null, error: result.ok ? null : result.error ?? "Não foi possível resolver o KM da data." });
    });
  };

  const next = () => {
    setTouched((t) => ({ ...t, [step]: true }));
    if (step === 1) {
      if (!step1Error) goTo(2);
    } else if (step === 2) {
      if (!hasErrors(step2Errors)) checkDuplicates();
    } else if (step === 3) {
      if (!hasErrors(step3Errors)) loadKmStep();
    } else if (step === 4) {
      if (!hasErrors(step4Errors)) goTo(5);
    }
  };

  const back = () => {
    if (step > 1) goTo((step - 1) as Step);
  };

  const buildInput = (): CreateMaintenanceInput | null => {
    if (!vehicle.id) return null;
    const scheduled = plan.status === "scheduled";
    const inProgress = plan.status === "in_progress";
    const justification = dupJustification.trim();
    return {
      vehicleId: vehicle.id,
      maintenanceTypeCode: typeCode,
      originId: isPreventive ? null : originId || null,
      priority,
      serviceIds: effectiveServiceIds,
      description: description.trim() || null,
      requestedOn: plan.requestedOn,
      status: plan.status,
      scheduledDate: scheduled ? plan.scheduledDate : null,
      scheduledTime: scheduled ? plan.scheduledTime || null : null,
      expectedExitDate: plan.expectedExitDate || null,
      expectedExitTime: plan.expectedExitTime || null,
      supplierId: plan.supplierId || null,
      serviceOrderNumber: plan.serviceOrderNumber.trim() || null,
      schedulingNotes: plan.schedulingNotes.trim() || null,
      entryDate: inProgress ? plan.entryDate : null,
      entryTime: inProgress ? plan.entryTime || null : null,
      entryKm: inProgress && manualKm ? kmValue : null,
      entryKmJustification: inProgress && manualKm ? entryKmJustification.trim() : null,
      preventiveCycleId: isPreventive ? preventiveCycleId : null,
      checklistAnswerIds: findingIds,
      duplicateJustification: justification.length >= 10 ? justification : null,
      actionPlanId: initial.actionPlanId ?? null,
      actionPlanItemIds: initial.actionPlanItemIds,
      mtsrComponentId: initial.mtsrComponentId ?? null,
      mtsrInspectionItemId: initial.mtsrInspectionItemId ?? null,
    };
  };

  const submit = () => {
    const input = buildInput();
    if (!input) return;
    const vehicleId = input.vehicleId;
    const key = servicesKey;
    onBusyChange(true);
    startWorking(async () => {
      let result: Awaited<ReturnType<typeof createMaintenance>>;
      try {
        result = await createMaintenance(input);
      } catch {
        toast({ title: "Não foi possível abrir a manutenção. Tente de novo.", variant: "danger" });
        return;
      } finally {
        onBusyChange(false);
      }
      if (result.ok && result.data) {
        toast({ title: `Manutenção ${result.data.code} aberta.`, description: `Situação inicial: ${STATUS_LABEL[plan.status]}.`, variant: "success" });
        onCreated(result.data.id);
        return;
      }
      if (result.duplicate) {
        // Surgiu uma equivalente entre a verificação e a gravação: volta ao aviso.
        const again = await findOpenEquivalents(vehicleId, input.serviceIds);
        const rows = again.ok ? (again.data ?? []).filter((e) => e.sameService || e.sameCluster) : [];
        setDup({ key, rows });
        setDupAccepted(null);
        goTo(2);
        toast({ title: result.error ?? "Já existe manutenção aberta equivalente.", variant: "warning" });
        return;
      }
      toast({ title: result.error ?? "Não foi possível abrir a manutenção.", variant: "danger" });
    });
  };

  // ---------------------------------------------------------------------------
  // Tela
  // ---------------------------------------------------------------------------

  const current = STEPS[step - 1];
  const q = term.trim();
  const searchRows = search && search.term === q ? search.rows : null;
  const searchPending = q.length >= 2 && (searching || !search || search.term !== q);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Nova manutenção</DialogTitle>
        <DialogDescription>
          Passo {step} de 5 · {current.label}. {current.hint}
          {initial.actionPlanCode ? ` Origem: Plano de Ação ${initial.actionPlanCode} — Checklist.` : ""}
          {initial.mtsrComponentName ? ` Origem: componente MTSR "${initial.mtsrComponentName}" não conforme — Segurança.` : ""}
        </DialogDescription>
      </DialogHeader>
      <Stepper step={step} onGoTo={(s) => goTo(s)} disabled={working} />

      {/* O corpo do DialogBody, com ref: cada passo volta ao topo. */}
      <div
        ref={bodyRef}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4"
        aria-busy={working || vehicle.loading}
        data-testid={`maintenance-wizard-step-${step}`}
      >
        {step === 1 ? (
          <>
            {!vehicle.id ? (
              <div className="flex flex-col gap-3">
                <FormField label="Placa ou frota" helperText="Digite ao menos 2 caracteres. Só aparecem veículos do seu acesso.">
                  <SearchField
                    value={term}
                    onValueChange={setTerm}
                    placeholder="Ex.: ABC1D23 ou código da frota"
                    autoFocus
                    data-testid="maintenance-vehicle-search"
                  />
                </FormField>
                <div aria-live="polite" aria-busy={searchPending}>
                  {q.length < 2 ? null : searchPending && !searchRows ? (
                    <SkeletonGroup label="Buscando veículos…" className="flex flex-col gap-2">
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                    </SkeletonGroup>
                  ) : search?.error && search.term === q ? (
                    <ErrorState variant="inline" title="Não foi possível buscar veículos." description={search.error} />
                  ) : searchRows && searchRows.length === 0 ? (
                    <EmptyState size="sm" variant="panel" icon={<Truck />} title="Nenhum veículo encontrado" description="Confira a placa ou o código da frota." />
                  ) : searchRows ? (
                    <ul className="flex flex-col gap-1.5" aria-label="Veículos encontrados">
                      {searchRows.map((v) => (
                        <li key={v.id}>
                          <button
                            type="button"
                            onClick={() => chooseVehicle(v)}
                            className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2 text-left hfm-transition hover:bg-hover-overlay hfm-focus-ring"
                            data-testid="maintenance-vehicle-option"
                          >
                            <span className="flex min-w-0 flex-col">
                              <span className="truncate text-body-sm font-semibold text-fg">{vehicleLabel(v.licensePlate, v.fleetCode)}</span>
                              <span className="truncate text-caption text-fg-muted">{v.typeName ?? "Tipo de equipamento não informado"}</span>
                            </span>
                            <StatusBadge status={v.status === "active" ? "success" : "neutral"} size="sm">
                              {VEHICLE_STATUS_LABEL[v.status] ?? v.status}
                            </StatusBadge>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            ) : (
              <VehicleSummary
                state={vehicle}
                active={vehicleActive}
                onChange={clearVehicle}
                onRetry={retryVehicle}
                onOpenMaintenance={onOpenMaintenance}
              />
            )}
            {touched[1] && step1Error && !vehicle.loading ? (
              <p role="alert" className="text-helper text-danger">{step1Error}</p>
            ) : null}
          </>
        ) : null}

        {step === 2 ? (
          <>
            {dupRows ? (
              <DuplicatePanel
                rows={dupRows}
                busy={working}
                canComplement={effectiveServiceIds.length > 0}
                justification={dupJustification}
                onJustificationChange={setDupJustification}
                onOpen={(id) => onOpenMaintenance(id)}
                onComplement={complementExisting}
                onAccept={acceptDuplicate}
              />
            ) : null}

            <FormGrid columns={3}>
              <FormField label="Tipo" required error={show(2, step2Errors.type)}>
                <NativeSelect value={typeCode} onChange={(e) => changeType(e.target.value)} data-testid="maintenance-wizard-type">
                  {catalog.types.map((t) => (
                    <option key={t.code} value={t.code} disabled={t.code === "preventive" && !perms.managePreventive}>
                      {typeLabel(t.code, t.name)}
                      {t.code === "preventive" && !perms.managePreventive ? " (requer gerir preventiva)" : ""}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              {isPreventive ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-label font-medium text-fg-secondary">Origem</span>
                  <span className="flex h-(--control-height-md) items-center text-body-sm text-fg">
                    Preventiva programada <span className="ml-1 text-fg-muted">(definida pelo ciclo)</span>
                  </span>
                </div>
              ) : (
                <FormField
                  label="Origem"
                  required
                  error={show(2, step2Errors.origin)}
                  helperText={presetOrigin && !presetOrigin.manualSelectable ? "Definida pelo fluxo de origem." : undefined}
                >
                  <NativeSelect value={originId} onChange={(e) => setOriginId(e.target.value)} data-testid="maintenance-wizard-origin">
                    <option value="">Escolha…</option>
                    {origins.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
              )}
              <FormField label="Prioridade" required>
                <NativeSelect value={priority} onChange={(e) => setPriority(e.target.value as Criticality)}>
                  {CRITICALITIES.map((c) => (
                    <option key={c} value={c}>
                      {CRITICALITY_LABEL[c]}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
            </FormGrid>

            <FormField label="Descrição" labelHint="Opcional" helperText="O que foi observado, em linguagem de operação.">
              <Textarea rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
            </FormField>

            {isPreventive ? (
              cycles.length === 0 ? (
                <Alert variant="info">
                  <AlertTitle>Sem ciclo preventivo pendente</AlertTitle>
                  <AlertDescription>
                    {ctx?.preventiveRule
                      ? "Todos os ciclos (MP) deste veículo já foram realizados ou programados. Acompanhe pela aba Preventiva."
                      : "Não há parâmetro preventivo para este equipamento. A preventiva é programada a partir dos ciclos, na aba Preventiva."}
                  </AlertDescription>
                </Alert>
              ) : (
                <FormField
                  label="Ciclo preventivo (MP)"
                  required
                  error={show(2, step2Errors.cycle)}
                  helperText={chosenCycle?.openMaintenanceCode ? `Este ciclo já está em ${chosenCycle.openMaintenanceCode}.` : "A manutenção realiza este ciclo ao ser concluída."}
                >
                  <NativeSelect value={preventiveCycleId} onChange={(e) => setPreventiveCycleId(e.target.value)} data-testid="maintenance-wizard-cycle">
                    <option value="">Escolha o ciclo…</option>
                    {cycles.map((c) => (
                      <option key={c.id} value={c.id}>
                        {`MP${c.number} · marco ${formatKm(c.milestoneKm)} · ${PREVENTIVE_STATUS_LABEL[c.status] ?? c.status}`}
                        {c.kmRemaining != null && c.kmRemaining > 0 ? ` · faltam ${formatInt(c.kmRemaining)} km` : ""}
                        {c.kmExceeded != null && c.kmExceeded > 0 ? ` · excedido ${formatInt(c.kmExceeded)} km` : ""}
                        {c.openMaintenanceCode ? ` · já em ${c.openMaintenanceCode}` : ""}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
              )
            ) : null}

            <section aria-labelledby="wizard-services-title" className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 id="wizard-services-title" className="text-h4 font-semibold text-fg">
                  Serviços {isPreventive ? <span className="text-caption font-normal text-fg-muted">(opcional)</span> : <span className="text-danger" aria-hidden>*</span>}
                </h3>
                <span className="text-caption text-fg-muted">
                  {effectiveServiceIds.length} selecionado(s) · filtrados por {typeLabel(typeCode)}
                  {ctx?.vehicle.typeName ? ` e ${ctx.vehicle.typeName}` : ""}
                </span>
              </div>
              {isPreventive ? (
                <p className="text-caption text-fg-muted">Sem seleção, a manutenção usa o serviço do parâmetro preventivo.</p>
              ) : null}
              <ServicePicker
                services={services}
                clusters={catalog.clusters}
                value={effectiveServiceIds}
                onChange={setServiceIds}
                suggested={suggested}
                idPrefix="wizard"
              />
              {show(2, step2Errors.services) ? (
                <p role="alert" className="text-helper text-danger">{step2Errors.services}</p>
              ) : null}
            </section>

            <FindingsPicker
              state={vehicle.loading ? null : { rows: vehicle.findings, error: vehicle.findingsError }}
              selected={findingIds}
              onToggle={toggleFinding}
              serviceName={(id) => allServiceById.get(id)?.name ?? null}
            />
          </>
        ) : null}

        {step === 3 ? (
          <>
            <FormField label="Situação inicial" required>
              <RadioGroup
                orientation="horizontal"
                value={plan.status}
                onValueChange={(v) => setPlanField({ status: v as InitialStatus })}
                className="gap-x-6"
                data-testid="maintenance-wizard-status"
              >
                <RadioField value="to_schedule" label={STATUS_LABEL.to_schedule} description="Aguardando agendamento." />
                <RadioField
                  value="scheduled"
                  label={STATUS_LABEL.scheduled}
                  description={perms.schedule ? "Já tem data marcada." : "Requer permissão de agendar."}
                  disabled={!perms.schedule}
                />
                <RadioField
                  value="in_progress"
                  label={STATUS_LABEL.in_progress}
                  description={perms.start ? "O veículo já entrou na oficina." : "Requer permissão de registrar entrada."}
                  disabled={!perms.start}
                />
              </RadioGroup>
            </FormField>

            <FormGrid columns={2}>
              <FormField label="Data da solicitação" required error={show(3, step3Errors.requestedOn)}>
                <DateInput value={plan.requestedOn} max={today} onChange={(e) => setPlanField({ requestedOn: e.target.value })} />
              </FormField>
              <div className="hidden sm:block" aria-hidden />
              {plan.status === "scheduled" ? (
                <>
                  <FormField label="Data do agendamento" required error={show(3, step3Errors.scheduledDate)}>
                    <DateInput value={plan.scheduledDate} min={plan.requestedOn || undefined} onChange={(e) => setPlanField({ scheduledDate: e.target.value })} />
                  </FormField>
                  <FormField label="Hora do agendamento" labelHint="Opcional">
                    <TimeInput value={plan.scheduledTime} onChange={(e) => setPlanField({ scheduledTime: e.target.value })} />
                  </FormField>
                </>
              ) : null}
              {plan.status === "in_progress" ? (
                <>
                  <FormField label="Data real de entrada" required error={show(3, step3Errors.entryDate)}>
                    <DateInput value={plan.entryDate} max={today} min={plan.requestedOn || undefined} onChange={(e) => setPlanField({ entryDate: e.target.value })} />
                  </FormField>
                  <FormField label="Hora real de entrada" labelHint="Opcional" helperText="Sem hora, o TMM é contado em dias.">
                    <TimeInput value={plan.entryTime} onChange={(e) => setPlanField({ entryTime: e.target.value })} />
                  </FormField>
                </>
              ) : null}
              <FormField label="Previsão de saída" labelHint="Opcional">
                <DateInput
                  value={plan.expectedExitDate}
                  min={(plan.status === "in_progress" ? plan.entryDate : plan.scheduledDate) || plan.requestedOn || undefined}
                  onChange={(e) => setPlanField({ expectedExitDate: e.target.value })}
                />
              </FormField>
              <FormField label="Hora prevista de saída" labelHint="Opcional">
                <TimeInput value={plan.expectedExitTime} onChange={(e) => setPlanField({ expectedExitTime: e.target.value })} />
              </FormField>
              <FormField label="Fornecedor" labelHint="Opcional">
                <SupplierSelect catalog={catalog} value={plan.supplierId} onValueChange={(v) => setPlanField({ supplierId: v })} />
              </FormField>
              <FormField label="Ordem de serviço (OS)" labelHint="Opcional">
                <Input value={plan.serviceOrderNumber} maxLength={60} onChange={(e) => setPlanField({ serviceOrderNumber: e.target.value })} />
              </FormField>
            </FormGrid>
            <FormField label="Observações de programação" labelHint="Opcional">
              <Textarea rows={2} maxLength={1000} value={plan.schedulingNotes} onChange={(e) => setPlanField({ schedulingNotes: e.target.value })} />
            </FormField>
          </>
        ) : null}

        {step === 4 ? (
          plan.status === "in_progress" ? (
            <>
              <section aria-labelledby="wizard-km-title" className="flex flex-col gap-2">
                <h3 id="wizard-km-title" className="text-h4 font-semibold text-fg">
                  KM oficial na data de entrada ({formatDate(plan.entryDate)})
                </h3>
                {working && !kmContext ? (
                  <SkeletonGroup label="Resolvendo o KM…" className="flex flex-col gap-2">
                    <Skeleton className="h-24 w-full" />
                  </SkeletonGroup>
                ) : kmContext ? (
                  <KmResolutionView km={kmContext.kmAtDate} />
                ) : (
                  <ErrorState
                    variant="inline"
                    title="Não foi possível resolver o KM desta data."
                    description={`${kmState?.error ?? "Tente de novo."} Sem ele, o servidor resolve o KM ao abrir a manutenção.`}
                    onRetry={retryKm}
                    retryLabel="Tentar de novo"
                    retrying={working}
                  />
                )}
              </section>
              <CheckboxField
                label="Informar KM manualmente"
                description="Use quando o hodômetro na entrada difere da base oficial. Exige justificativa. Divergência não bloqueia a abertura: o KM fica sinalizado para revisão."
                checked={manualKm}
                onCheckedChange={(v) => setManualKm(v === true)}
                data-testid="maintenance-wizard-manual-km"
              />
              {manualKm ? (
                <FormGrid columns={2}>
                  <FormField label="KM de entrada" required error={show(4, step4Errors.km)}>
                    <Input inputMode="numeric" trailingAddon="km" value={entryKm} onChange={(e) => setEntryKm(e.target.value.replace(/[^\d]/g, ""))} />
                  </FormField>
                  <FormField label="Justificativa do KM manual" required helperText="Mínimo de 5 caracteres." error={show(4, step4Errors.justification)}>
                    <Input value={entryKmJustification} maxLength={300} onChange={(e) => setEntryKmJustification(e.target.value)} />
                  </FormField>
                </FormGrid>
              ) : null}
            </>
          ) : (
            <>
              <Alert variant="info">
                <AlertTitle>O KM de entrada é resolvido na entrada em oficina</AlertTitle>
                <AlertDescription>
                  A manutenção nasce como {STATUS_LABEL[plan.status]}. Quando a entrada for registrada, o servidor busca o KM
                  oficial da data de entrada (ou aceita um KM informado, com justificativa).
                </AlertDescription>
              </Alert>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Fact label="KM atual do veículo">
                  {formatKm(ctx?.currentKm.km)}
                  {ctx?.currentKm.date ? <span className="text-fg-muted"> · leitura de {formatDate(ctx.currentKm.date)}</span> : null}
                </Fact>
              </dl>
            </>
          )
        ) : null}

        {step === 5 ? (
          <Review
            ctx={ctx}
            kmContext={kmContext}
            catalog={catalog}
            typeCode={typeCode}
            originName={isPreventive ? "Preventiva programada" : catalog.origins.find((o) => o.id === originId)?.name ?? "—"}
            priority={priority}
            description={description}
            services={effectiveServiceIds.map((id) => serviceById.get(id)).filter((s): s is MaintenanceService => Boolean(s))}
            cycleLabel={chosenCycle ? `MP${chosenCycle.number} · marco ${formatKm(chosenCycle.milestoneKm)}` : null}
            isPreventive={isPreventive}
            findings={selectedFindings}
            findingCount={findingIds.length}
            plan={plan}
            manualKm={plan.status === "in_progress" && manualKm ? { km: kmValue, justification: entryKmJustification.trim() } : null}
            duplicateJustification={dupJustification.trim().length >= 10 ? dupJustification.trim() : null}
          />
        ) : null}
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={working} className="sm:mr-auto">
          Cancelar
        </Button>
        {step > 1 ? (
          <Button variant="outline" leadingIcon={<ArrowLeft />} onClick={back} disabled={working} data-testid="maintenance-wizard-back">
            Voltar
          </Button>
        ) : null}
        {step < 5 ? (
          <Button
            trailingIcon={<ArrowRight />}
            onClick={next}
            loading={working}
            disabled={step === 2 && Boolean(dupRows)}
            data-testid="maintenance-wizard-next"
          >
            Avançar
          </Button>
        ) : (
          <Button leadingIcon={<Check />} onClick={submit} loading={working} data-testid="maintenance-wizard-submit">
            Abrir manutenção
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------------------
// Peças
// ---------------------------------------------------------------------------

function Stepper({ step, onGoTo, disabled }: { step: Step; onGoTo: (step: Step) => void; disabled: boolean }) {
  return (
    <nav aria-label="Etapas da abertura" className="border-b border-border px-5 py-3">
      <ol className="flex items-center gap-1.5 sm:gap-2">
        {STEPS.map((s) => {
          const state = s.n < step ? "done" : s.n === step ? "current" : "todo";
          const content = (
            <>
              <span
                aria-hidden
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-caption font-semibold tabular-nums",
                  state === "done" && "border-primary bg-primary text-primary-fg",
                  state === "current" && "border-primary bg-primary-soft text-primary-soft-fg",
                  state === "todo" && "border-border text-fg-muted",
                )}
              >
                {state === "done" ? <Check className="size-3.5" /> : s.n}
              </span>
              <span
                className={cn(
                  "text-caption font-semibold tracking-wide uppercase",
                  state === "current" ? "text-fg" : "hidden text-fg-muted md:inline",
                )}
              >
                {s.label}
              </span>
              <span className="sr-only">
                {state === "done" ? " (concluído)" : state === "current" ? " (atual)" : ""}
              </span>
            </>
          );
          return (
            <li key={s.n} className="flex min-w-0 items-center gap-1.5 sm:flex-1 sm:gap-2" aria-current={state === "current" ? "step" : undefined}>
              {state === "done" ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onGoTo(s.n)}
                  className="flex items-center gap-2 rounded-sm hfm-transition hover:opacity-80 hfm-focus-ring disabled:opacity-55"
                  title={`Voltar para ${s.label}`}
                >
                  {content}
                </button>
              ) : (
                <span className="flex items-center gap-2">{content}</span>
              )}
              {s.n < 5 ? <span aria-hidden className="hidden h-px min-w-3 flex-1 bg-border sm:block" /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Fact({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", wide && "sm:col-span-2 lg:col-span-3")}>
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="text-body-sm break-words text-fg">{children ?? "—"}</dd>
    </div>
  );
}

function ContextFacts({ context }: { context: MaintenanceContext }) {
  const city = context.cityName ? `${context.cityName}${context.stateUf ? `/${context.stateUf}` : ""}` : context.stateUf;
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Fact label="Operação">{context.operationName}</Fact>
      <Fact label="Cidade/UF">{city}</Fact>
      <Fact label="Filial">{context.unitName}</Fact>
      <Fact label="Data do contexto">{formatDate(context.date)}</Fact>
    </dl>
  );
}

function Block({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={id} className="text-label font-semibold text-fg">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function VehicleSummary({
  state, active, onChange, onRetry, onOpenMaintenance,
}: {
  state: VehicleState;
  active: boolean;
  onChange: () => void;
  onRetry: () => void;
  onOpenMaintenance: (id: string) => void;
}) {
  const ctx = state.context;
  if (state.loading) {
    return (
      <SkeletonGroup label="Carregando o veículo…" className="flex flex-col gap-3">
        <Skeleton className="h-10 w-72 max-w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </SkeletonGroup>
    );
  }
  if (!ctx) {
    return (
      <ErrorState
        title="Não foi possível carregar o veículo."
        description={state.error ?? "Tente de novo."}
        onRetry={onRetry}
        retryLabel="Tentar de novo"
        action={<Button variant="ghost" onClick={onChange}>Escolher outro veículo</Button>}
      />
    );
  }
  const v = ctx.vehicle;
  const kind = [v.typeName, v.subcategoryName].filter(Boolean).join(" / ");
  const model = [v.makeName, v.modelName].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-3" data-testid="maintenance-wizard-vehicle">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border bg-surface-secondary p-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-h4 font-semibold text-fg">{vehicleLabel(v.licensePlate, v.fleetCode)}</span>
            <StatusBadge status={active ? "success" : "neutral"} size="sm">
              {v.archived ? "Arquivada" : VEHICLE_STATUS_LABEL[v.status] ?? v.status}
            </StatusBadge>
          </span>
          <span className="text-caption text-fg-secondary">{[kind, model].filter(Boolean).join(" · ") || "Equipamento não informado"}</span>
          <span className="text-caption text-fg-secondary">
            KM atual: <span className="font-medium tabular-nums text-fg">{formatKm(ctx.currentKm.km)}</span>
            {ctx.currentKm.date ? ` · leitura de ${formatDate(ctx.currentKm.date)}` : " · sem leitura oficial"}
          </span>
        </div>
        <Button size="sm" variant="outline" leadingIcon={<Repeat />} onClick={onChange} data-testid="maintenance-wizard-change-vehicle">
          Trocar veículo
        </Button>
      </div>

      {!active ? (
        <Alert variant="danger">
          <AlertTitle>Frota inativa</AlertTitle>
          <AlertDescription>
            Novas manutenções só podem ser abertas para frotas ativas. O histórico deste veículo continua disponível na Base geral.
          </AlertDescription>
        </Alert>
      ) : null}

      <Block title="Contexto operacional (fontes oficiais)">
        <p className="text-caption text-fg-muted">
          Resolvido pelo servidor a partir da fidelização e da alocação na data. É o contexto gravado na manutenção e
          preservado depois.
        </p>
        <ContextFacts context={ctx.context} />
      </Block>

      <Block title={`Manutenções abertas deste veículo (${ctx.open.length})`}>
        {ctx.open.length === 0 ? (
          <p className="text-body-sm text-fg-muted">Nenhuma manutenção aberta.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {ctx.open.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm">
                <Button variant="link" size="sm" onClick={() => onOpenMaintenance(m.id)} trailingIcon={<ExternalLink />}>
                  {m.code}
                </Button>
                <MaintenanceStatusBadge status={m.status} />
                <span className="text-fg-secondary">{typeLabel(m.type)}</span>
                <span className="min-w-0 text-caption text-fg-muted">
                  {m.items.map((i) => `${i.cluster} → ${i.service}`).join("; ") || "sem serviços"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Block title="Ciclos preventivos pendentes">
          {!ctx.preventiveRule ? (
            <p className="text-body-sm text-fg-muted">Sem parâmetro preventivo para este equipamento.</p>
          ) : ctx.preventiveCycles.filter((c) => c.status !== "completed").length === 0 ? (
            <p className="text-body-sm text-fg-muted">Nenhum ciclo pendente.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {ctx.preventiveCycles
                .filter((c) => c.status !== "completed")
                .map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm">
                    <span className="font-semibold text-fg">MP{c.number}</span>
                    <PreventiveStatusBadge status={c.status} />
                    <span className="tabular-nums text-fg-secondary">marco {formatKm(c.milestoneKm)}</span>
                    {c.kmExceeded != null && c.kmExceeded > 0 ? (
                      <span className="text-caption text-danger-soft-fg">excedido {formatInt(c.kmExceeded)} km</span>
                    ) : c.kmRemaining != null ? (
                      <span className="text-caption text-fg-muted">faltam {formatInt(c.kmRemaining)} km</span>
                    ) : null}
                    {c.openMaintenanceCode ? <Badge size="sm" variant="info">em {c.openMaintenanceCode}</Badge> : null}
                  </li>
                ))}
            </ul>
          )}
        </Block>
        <Block title="Atenção preditiva">
          {ctx.predictiveAttention.length === 0 ? (
            <p className="text-body-sm text-fg-muted">Nenhum item preditivo pedindo atenção.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {ctx.predictiveAttention.map((p) => (
                <li key={p.cycleId} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm">
                  <span className="text-fg">{p.cluster} → {p.item}</span>
                  <PredictiveStatusBadge status={p.status} />
                  <span className="text-caption text-fg-muted">{EXECUTION_LABEL[p.execution] ?? p.execution}</span>
                </li>
              ))}
            </ul>
          )}
        </Block>
      </div>
    </div>
  );
}

function FindingsPicker({
  state, selected, onToggle, serviceName,
}: {
  state: { rows: ChecklistFinding[] | null; error: string | null } | null;
  selected: string[];
  onToggle: (finding: ChecklistFinding, checked: boolean) => void;
  serviceName: (id: string) => string | null;
}) {
  return (
    <section aria-labelledby="wizard-findings-title" className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h3 id="wizard-findings-title" className="text-h4 font-semibold text-fg">
          Apontamentos do Check List <span className="text-caption font-normal text-fg-muted">(opcional · últimos 60 dias)</span>
        </h3>
        <p className="text-caption text-fg-muted">
          Inconformidades deste veículo. Marcar um apontamento vincula-o à manutenção e adiciona os serviços mapeados para ele
          (Serviços × Check List).
        </p>
      </div>
      {!state ? (
        <SkeletonGroup label="Carregando apontamentos…" className="flex flex-col gap-2">
          <Skeleton className="h-14 w-full" />
        </SkeletonGroup>
      ) : state.error ? (
        <ErrorState variant="inline" title="Não foi possível carregar os apontamentos." description={state.error} />
      ) : !state.rows || state.rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-3 text-body-sm text-fg-muted">
          Nenhuma inconformidade do Check List nos últimos 60 dias.
        </p>
      ) : (
        <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
          {state.rows.map((f) => {
            const id = `wizard-finding-${f.answerId}`;
            const checked = selected.includes(f.answerId);
            const names = f.suggestedServiceIds.map(serviceName).filter(Boolean);
            const openLinks = f.links.filter((l) => l.status === "to_schedule" || l.status === "scheduled" || l.status === "in_progress");
            return (
              <li
                key={f.answerId}
                className={cn("flex items-start gap-2.5 rounded-md border px-3 py-2", checked ? "border-primary/50 bg-primary-soft/40" : "border-border")}
                data-testid="maintenance-wizard-finding"
              >
                <Checkbox id={id} className="mt-0.5" checked={checked} onCheckedChange={(v) => onToggle(f, v === true)} />
                <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5">
                  <span className="text-body-sm font-medium text-fg">{f.questionText}</span>
                  <span className="text-caption text-fg-secondary">
                    {formatDate(f.operationalDate)} · {f.checklistType} · Resposta: {f.answer}
                    {f.note ? ` · Nota: ${f.note}` : ""}
                  </span>
                  <span className="text-caption text-fg-muted">
                    {names.length > 0 ? `Sugere: ${names.join(", ")}` : "Sem serviço mapeado para esta pergunta"}
                  </span>
                </label>
                {openLinks.length > 0 ? (
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    {openLinks.map((l) => (
                      <Badge key={l.linkId} size="sm" variant="warning" title={`Já vinculado a ${l.code} (${STATUS_LABEL[l.status]})`}>
                        Em {l.code}
                      </Badge>
                    ))}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function DuplicatePanel({
  rows, busy, canComplement, justification, onJustificationChange, onOpen, onComplement, onAccept,
}: {
  rows: OpenEquivalent[];
  busy: boolean;
  canComplement: boolean;
  justification: string;
  onJustificationChange: (value: string) => void;
  onOpen: (id: string) => void;
  onComplement: (row: OpenEquivalent) => void;
  onAccept: () => void;
}) {
  const short = justification.trim().length < 10;
  return (
    <section
      aria-labelledby="wizard-dup-title"
      className="flex flex-col gap-3 rounded-md border border-warning/40 bg-warning-soft p-3"
      data-testid="maintenance-wizard-duplicate"
    >
      <div className="flex flex-col gap-0.5">
        <h3 id="wizard-dup-title" className="text-h4 font-semibold text-warning-soft-fg">
          Já existe manutenção aberta equivalente para este veículo
        </h3>
        <p className="text-body-sm text-warning-soft-fg">
          Escolha um caminho: abrir a existente, complementá-la com os serviços selecionados, ou abrir uma nova com justificativa.
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-body-sm font-semibold text-fg">{r.code}</span>
              <MaintenanceStatusBadge status={r.status} />
              <span className="text-caption text-fg-secondary">{typeLabel(r.type)}</span>
              {r.sameService ? <Badge size="sm" variant="danger">Mesmo serviço</Badge> : r.sameCluster ? <Badge size="sm" variant="warning">Mesmo cluster</Badge> : null}
            </div>
            <p className="text-caption text-fg-secondary">
              Solicitada em {formatDate(r.requestedOn)}
              {r.scheduledDate ? ` · agendada para ${formatDate(r.scheduledDate)}` : ""}
              {r.entryDate ? ` · entrada em ${formatDate(r.entryDate)}` : ""}
            </p>
            <p className="text-caption text-fg-muted">{r.items.map((i) => `${i.cluster} → ${i.service}`).join("; ") || "sem serviços"}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" leadingIcon={<ExternalLink />} onClick={() => onOpen(r.id)} disabled={busy}>
                Abrir a existente
              </Button>
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={<ListPlus />}
                onClick={() => onComplement(r)}
                disabled={busy || !canComplement}
                title={canComplement ? undefined : "Selecione ao menos um serviço para complementar."}
                data-testid="maintenance-wizard-complement"
              >
                Complementar esta
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3">
        <FormField
          label="Abrir uma nova mesmo assim — justificativa"
          required
          helperText="Mínimo de 10 caracteres. Fica gravada na nova manutenção e na trilha."
        >
          <Textarea rows={2} maxLength={500} value={justification} onChange={(e) => onJustificationChange(e.target.value)} data-testid="maintenance-wizard-dup-justification" />
        </FormField>
        <div>
          <Button size="sm" onClick={onAccept} disabled={busy || short} data-testid="maintenance-wizard-dup-accept">
            Abrir nova com justificativa
          </Button>
        </div>
      </div>
    </section>
  );
}

function Review({
  ctx, kmContext, catalog, typeCode, originName, priority, description, services, cycleLabel, isPreventive, findings, findingCount,
  plan, manualKm, duplicateJustification,
}: {
  ctx: VehicleContext | null;
  kmContext: VehicleContext | null;
  catalog: MaintenanceCatalog;
  typeCode: string;
  originName: string;
  priority: Criticality;
  description: string;
  services: MaintenanceService[];
  cycleLabel: string | null;
  isPreventive: boolean;
  findings: ChecklistFinding[];
  findingCount: number;
  plan: Plan;
  manualKm: { km: number | null; justification: string } | null;
  duplicateJustification: string | null;
}) {
  const context = kmContext?.context ?? ctx?.context ?? null;
  const groups = new Map<string, string[]>();
  for (const s of services) groups.set(s.clusterName, [...(groups.get(s.clusterName) ?? []), s.name]);
  const km = kmContext?.kmAtDate ?? null;
  const v = ctx?.vehicle;
  return (
    <div className="flex flex-col gap-3" data-testid="maintenance-wizard-review">
      <Block title="Frota">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Veículo">{v ? vehicleLabel(v.licensePlate, v.fleetCode) : "—"}</Fact>
          <Fact label="Equipamento">{v ? [v.typeName, v.modelName].filter(Boolean).join(" · ") || null : null}</Fact>
          <Fact label="KM atual">{formatKm(ctx?.currentKm.km)}</Fact>
        </dl>
        {context ? (
          <>
            <p className="text-caption text-fg-muted">Contexto na data {formatDate(context.date)} — é o que fica gravado.</p>
            <ContextFacts context={context} />
          </>
        ) : null}
      </Block>

      <Block title="Serviço">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Tipo">{typeLabel(typeCode)}</Fact>
          <Fact label="Origem">{originName}</Fact>
          <Fact label="Prioridade">{CRITICALITY_LABEL[priority]}</Fact>
          {isPreventive ? <Fact label="Ciclo preventivo">{cycleLabel}</Fact> : null}
          {description.trim() ? <Fact label="Descrição" wide>{description.trim()}</Fact> : null}
        </dl>
        <div className="flex flex-col gap-1">
          <span className="text-caption text-fg-muted">Itens ({services.length})</span>
          {services.length === 0 ? (
            <span className="text-body-sm text-fg">{isPreventive ? "Serviço do parâmetro preventivo (definido pelo servidor)." : "—"}</span>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {[...groups.entries()].map(([cluster, names]) => (
                <li key={cluster} className="text-body-sm text-fg">
                  <span className="font-medium">{cluster}</span> → {names.join(", ")}
                </li>
              ))}
            </ul>
          )}
        </div>
        {findingCount > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="text-caption text-fg-muted">Apontamentos do Check List vinculados ({findingCount})</span>
            <ul className="flex flex-col gap-0.5">
              {findings.map((f) => (
                <li key={f.answerId} className="text-body-sm text-fg">
                  {f.questionText} <span className="text-fg-muted">· {formatDate(f.operationalDate)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Block>

      <Block title="Programação">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Situação inicial">
            <MaintenanceStatusBadge status={plan.status} />
          </Fact>
          <Fact label="Solicitação">{formatDate(plan.requestedOn)}</Fact>
          {plan.status === "scheduled" ? <Fact label="Agendamento">{formatDateTime(plan.scheduledDate, plan.scheduledTime)}</Fact> : null}
          {plan.status === "in_progress" ? <Fact label="Entrada real">{formatDateTime(plan.entryDate, plan.entryTime)}</Fact> : null}
          <Fact label="Previsão de saída">{formatDateTime(plan.expectedExitDate || null, plan.expectedExitTime)}</Fact>
          <Fact label="Fornecedor">{plan.supplierId ? supplierDisplayName(catalog, plan.supplierId) : null}</Fact>
          <Fact label="Ordem de serviço (OS)">{plan.serviceOrderNumber.trim() || null}</Fact>
          {plan.schedulingNotes.trim() ? <Fact label="Observações de programação" wide>{plan.schedulingNotes.trim()}</Fact> : null}
        </dl>
      </Block>

      <Block title="KM">
        {plan.status !== "in_progress" ? (
          <p className="text-body-sm text-fg-secondary">Resolvido pelo servidor quando a entrada em oficina for registrada.</p>
        ) : manualKm ? (
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Fact label="KM de entrada (informado)">{formatKm(manualKm.km)}</Fact>
            <Fact label="Justificativa">{manualKm.justification}</Fact>
            {km?.status ? (
              <Fact label="Oficial na data" wide>
                {formatKm(km.km)} · {KM_STATUS_LABEL[km.status]} — o informado é conferido com a base; divergência só sinaliza.
              </Fact>
            ) : null}
          </dl>
        ) : (
          <p className="text-body-sm text-fg">
            Automático: {km?.status ? `${formatKm(km.km)} · ${KM_STATUS_LABEL[km.status]}` : "resolvido pelo servidor ao abrir"}.
          </p>
        )}
      </Block>

      {duplicateJustification ? (
        <Alert variant="warning">
          <AlertTitle>Aberta com manutenção equivalente em aberto</AlertTitle>
          <AlertDescription>Justificativa: “{duplicateJustification}”</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
