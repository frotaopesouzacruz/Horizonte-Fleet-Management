"use client";

import * as React from "react";
import {
  Ban,
  CalendarClock,
  CheckCheck,
  ChevronDown,
  ClipboardList,
  Flag,
  Link2,
  MessageSquarePlus,
  Plus,
  RotateCcw,
  Route,
  SearchCheck,
  ShieldCheck,
  ThumbsDown,
  Unlink,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { Skeleton, SkeletonGroup } from "@/components/feedback/skeleton";
import { useToast } from "@/components/feedback/toast";
import {
  ConfidenceBadge,
  DeadlineBadge,
  ItemStatusBadge,
  PlanStatusBadge,
  PriorityBadge,
  RecurrenceBadge,
} from "@/components/action-plans/badges";
import { MaintenanceTypeBadge } from "@/components/maintenance/badges";
import { ExecutionDetailDrawer } from "@/app/(app)/aplicativos/check-list-frota/execution-detail-drawer";
import type { WizardPreset } from "@/app/(app)/frota/manutencao/shared";
import { loadActionPlanDetail, loadMaintenanceCandidates, type Result } from "@/lib/action-plans/actions";
import {
  CHECKLIST_TYPE_LABEL,
  EVENT_LABEL,
  ITEM_STATUS_LABEL,
  LINK_ORIGIN_LABEL,
  OPEN_ITEM_STATUSES,
  PLAN_STATUS_LABEL,
  PRIORITY_LABEL,
  REASON_LABEL,
  RESOLUTION_TYPE_LABEL,
  RULE_LABEL,
  SOURCE_LABEL,
  formatDate,
  formatDateTime,
  formatDays,
  formatInt,
  isClosed,
  planTitle,
} from "@/lib/action-plans/labels";
import type {
  ActionPlanCatalog,
  ActionPlanDetail,
  Confidence,
  MaintenanceCandidate,
  PlanEvent,
  PlanExecution,
  PlanItem,
  PlanMaintenanceLink,
  PlanResolution,
  PlanStatus,
} from "@/lib/action-plans/types";
import {
  AnalysisDialog,
  AssignDialog,
  DUE_SOURCE_LABEL,
  DueDialog,
  DuplicateMaintenanceDialog,
  FindingResolutionTag,
  LinkMaintenanceDialog,
  MaintenanceStatusTag,
  NoteDialog,
  PRIORITY_SOURCE_LABEL,
  PriorityDialog,
  ReopenDialog,
  ResolveDialog,
  UnlinkDialog,
  ValidateDialog,
  answerLabel,
  checklistLoader,
  completedLinks,
  isOpenMaintenance,
  plural,
  previewChecklistLoader,
  type CandidateLoader,
  type ManualResolution,
  type PlanTarget,
  type WriteRunner,
} from "./plan-dialogs";
import type { ActionPlanPerms, PanelActions, PreviewFixtures } from "./shared";

/**
 * Gaveta do Plano de Ação (§28–§30).
 *
 * Mostra o plano como o banco o guarda — contexto histórico do checklist,
 * apontamentos, tratativas, manutenções vinculadas e trilha — e oferece só as
 * ações que a situação e as permissões permitem. Cada botão chama uma rotina do
 * banco, que confere permissão, escopo e trilha de novo; depois de gravar, a
 * gaveta relê o plano e avisa a tela.
 */

export interface PlanDrawerProps {
  planId: string | null;
  onOpenChange: (open: boolean) => void;
  catalog: ActionPlanCatalog;
  perms: ActionPlanPerms;
  actions: PanelActions;
  onChanged: () => void;
  /** Só na prévia de desenvolvimento: dados fixos, sem servidor. */
  fixtures?: PreviewFixtures;
}

export function PlanDrawer(props: PlanDrawerProps) {
  const { planId, onOpenChange } = props;
  // O último plano aberto continua na tela enquanto a gaveta desliza para fora;
  // o corpo remonta (estado novo: aba, seleção, diálogo) a cada plano.
  const [shownId, setShownId] = React.useState(planId);
  if (planId && planId !== shownId) setShownId(planId);

  return (
    <Drawer open={Boolean(planId)} onOpenChange={onOpenChange}>
      {/* No telefone, cabeçalho e conteúdo rolam juntos (a barra de abas fica presa no topo);
          a partir de `sm`, só o corpo rola. */}
      <DrawerContent size="xl" className="max-sm:overflow-y-auto sm:max-w-4xl" data-testid="plan-drawer">
        {shownId ? <PlanDrawerInner key={shownId} {...props} planId={shownId} /> : null}
      </DrawerContent>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Vocabulário local
// ---------------------------------------------------------------------------

const PREVIEW_WRITE = "Prévia de desenvolvimento: as tratativas não são gravadas.";

/** analysis_changed guarda a etapa de análise (não a situação do plano). */
const ANALYSIS_LABEL: Record<string, string> = {
  new: "Sem tratativa definida",
  in_analysis: "Em análise",
  awaiting_maintenance: "Manutenção necessária",
};

const LINK_STATUS_LABEL: Record<string, string> = {
  unlinked: "Desvinculada",
  discarded: "Descartada",
};

const isOpenItem = (i: PlanItem) => OPEN_ITEM_STATUSES.includes(i.status);

type TabKey = "resumo" | "apontamentos" | "tratativas" | "manutencoes" | "eventos" | "checklists";

const TABS: { key: TabKey; label: string }[] = [
  { key: "resumo", label: "Resumo" },
  { key: "apontamentos", label: "Apontamentos" },
  { key: "tratativas", label: "Tratativas" },
  { key: "manutencoes", label: "Manutenções" },
  { key: "eventos", label: "Eventos" },
  { key: "checklists", label: "Checklists de origem" },
];

type ActionName =
  | "analysis"
  | "maintenance-required"
  | "open-maintenance"
  | "link-maintenance"
  | "validate"
  | "resolve-without-maintenance"
  | "improper"
  | "cancel"
  | "reopen"
  | "priority"
  | "due"
  | "assign"
  | "note";

type DialogState =
  | { kind: "analysis"; state: "in_analysis" | "awaiting_maintenance" }
  | { kind: "resolve"; resolution: ManualResolution }
  | { kind: "validate" }
  | { kind: "link" }
  | { kind: "duplicates"; candidates: MaintenanceCandidate[]; preset: WizardPreset }
  | { kind: "unlink"; link: PlanMaintenanceLink }
  | { kind: "reopen" }
  | { kind: "priority" }
  | { kind: "due" }
  | { kind: "assign" }
  | { kind: "note" };

/**
 * O que a tela oferece: situação E permissão. Quem decide é o banco — esconder
 * botão não é controle de segurança. Encerrado, só sobra reabrir (e observar).
 */
function availableActions(d: ActionPlanDetail, p: ActionPlanPerms, openItems: number): Record<ActionName, boolean> {
  const open = !isClosed(d.status);
  const treat = open && openItems > 0;
  const inMaintenance = d.maintenanceLinks.some((l) => l.linkStatus === "active" && isOpenMaintenance(l.status));
  return {
    analysis: treat && p.manage && d.analysisState === "new",
    "maintenance-required": treat && p.manage && d.analysisState !== "awaiting_maintenance" && !inMaintenance,
    "open-maintenance": treat && p.openMaintenance && p.maintenanceCreate,
    "link-maintenance": treat && p.linkMaintenance,
    validate: treat && p.manage && completedLinks(d).length > 0,
    "resolve-without-maintenance": treat && p.resolveWithoutMaintenance,
    improper: treat && p.markImproper,
    cancel: treat && p.cancel,
    reopen: !open && p.reopen && d.canReopen,
    priority: open && p.changePriority,
    due: open && p.manage,
    assign: open && p.assign,
    note: p.manage,
  };
}

function buildPreset(d: ActionPlanDetail, target: PlanTarget): WizardPreset {
  return {
    vehicleId: d.vehicleId,
    maintenanceTypeCode: "corrective",
    originCode: "action_plan",
    checklistAnswerIds: Array.from(new Set(target.items.map((i) => i.answerId))),
    serviceIds: d.services.map((s) => s.serviceId),
    actionPlanId: d.id,
    actionPlanCode: d.code,
    actionPlanItemIds: target.items.map((i) => i.id),
    description: `${planTitle(d)} (Plano de Ação ${d.code})`,
    priority: d.priority,
  };
}

// ---------------------------------------------------------------------------
// Corpo
// ---------------------------------------------------------------------------

function PlanDrawerInner({
  planId, catalog, perms, actions, onChanged, fixtures,
}: PlanDrawerProps & { planId: string }) {
  const { toast } = useToast();
  const preview = fixtures !== undefined;
  const [detail, setDetail] = React.useState<ActionPlanDetail | null>(() => (preview ? fixtures?.details?.[planId] ?? null : null));
  const [error, setError] = React.useState<string | null>(() =>
    preview && !fixtures?.details?.[planId] ? "Plano não encontrado nos dados da prévia." : null,
  );
  const [loading, startLoad] = React.useTransition();
  const [checking, startCheck] = React.useTransition();
  const [tab, setTab] = React.useState<TabKey>("resumo");
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(() => new Set());
  const [dialog, setDialog] = React.useState<DialogState | null>(null);
  const [checklistId, setChecklistId] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    if (preview) return;
    startLoad(async () => {
      const result = await loadActionPlanDetail(planId);
      if (result.ok && result.data) {
        setDetail(result.data);
        setError(null);
      } else {
        setError(result.ok ? "Plano não encontrado ou fora do seu acesso." : result.error ?? "Não foi possível carregar o plano.");
      }
    });
  }, [planId, preview]);

  React.useEffect(() => {
    load();
  }, [load]);

  // O assistente e a gaveta da Manutenção gravam fora daqui e recarregam a tela
  // (`refresh`); quando esse recarregamento termina, o plano é relido.
  const externalChange = React.useRef(false);
  const wasPending = React.useRef(actions.pending);
  React.useEffect(() => {
    if (wasPending.current && !actions.pending && externalChange.current) {
      externalChange.current = false;
      load();
    }
    wasPending.current = actions.pending;
  }, [actions.pending, load]);

  const run = React.useCallback(
    <T,>(call: () => Promise<Result<T>>): Promise<Result<T>> =>
      preview ? Promise.resolve({ ok: false, error: PREVIEW_WRITE }) : call(),
    [preview],
  ) satisfies WriteRunner;

  const loadCandidates: CandidateLoader = React.useCallback(async () => {
    if (preview) return { ok: true, data: fixtures?.candidates?.[planId] ?? [] };
    return loadMaintenanceCandidates(planId);
  }, [planId, preview, fixtures]);

  const handleSuccess = React.useCallback(
    (title: string, description?: string) => {
      toast({ title, description, variant: "success" });
      setSelected(new Set());
      load();
      onChanged();
    },
    [toast, load, onChanged],
  );

  const openMaintenance = React.useCallback(
    (id: string) => {
      externalChange.current = true;
      actions.openMaintenance(id);
    },
    [actions],
  );

  const openWizard = (preset: WizardPreset) => {
    externalChange.current = true;
    actions.openWizard(preset);
  };

  if (!detail) {
    return (
      <>
        <DrawerHeader className="px-4 sm:px-5">
          <DrawerTitle>Plano de ação</DrawerTitle>
          <DrawerDescription>{error ? "Falha na leitura" : "Carregando…"}</DrawerDescription>
        </DrawerHeader>
        <DrawerBody className="px-4 sm:px-5" aria-busy={loading}>
          {error ? (
            <ErrorState
              title="Não foi possível carregar o plano."
              description={error}
              onRetry={preview ? undefined : load}
              retryLabel="Tentar de novo"
              retrying={loading}
            />
          ) : (
            <SkeletonGroup label="Carregando o plano…" className="flex flex-col gap-4">
              <Skeleton className="h-6 w-56" />
              <Skeleton className="h-4 w-80 max-w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-32 w-full" />
            </SkeletonGroup>
          )}
        </DrawerBody>
      </>
    );
  }

  const closed = isClosed(detail.status);
  const openItems = detail.items.filter(isOpenItem);
  const selectedOpen = openItems.filter((i) => selected.has(i.id));
  const target: PlanTarget =
    selectedOpen.length > 0 ? { items: selectedOpen, explicit: true } : { items: openItems, explicit: false };
  const can = availableActions(detail, perms, openItems.length);
  const canSelect =
    can["open-maintenance"] || can["link-maintenance"] || can.validate ||
    can["resolve-without-maintenance"] || can.improper || can.cancel;

  const startOpenMaintenance = () => {
    const preset = buildPreset(detail, target);
    // §38: antes do assistente, as manutenções ativas do veículo — vincular
    // evita levar o veículo duas vezes à oficina.
    startCheck(async () => {
      const result = await loadCandidates();
      if (!result.ok) {
        toast({
          title: "Não foi possível conferir as manutenções em aberto.",
          description: "O assistente confere de novo ao gravar.",
          variant: "warning",
        });
        openWizard(preset);
        return;
      }
      const active = (result.data ?? []).filter((c) => isOpenMaintenance(c.status));
      if (active.length > 0) setDialog({ kind: "duplicates", candidates: active, preset });
      else openWizard(preset);
    });
  };

  const onAction = (name: ActionName) => {
    switch (name) {
      case "analysis":
        return setDialog({ kind: "analysis", state: "in_analysis" });
      case "maintenance-required":
        return setDialog({ kind: "analysis", state: "awaiting_maintenance" });
      case "open-maintenance":
        return startOpenMaintenance();
      case "link-maintenance":
        return setDialog({ kind: "link" });
      case "validate":
        return setDialog({ kind: "validate" });
      case "resolve-without-maintenance":
        return setDialog({ kind: "resolve", resolution: "resolved_without_maintenance" });
      case "improper":
        return setDialog({ kind: "resolve", resolution: "improper" });
      case "cancel":
        return setDialog({ kind: "resolve", resolution: "cancelled" });
      default:
        return setDialog({ kind: name });
    }
  };

  const toggleItem = (id: string, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const close = () => setDialog(null);
  const common = {
    open: true,
    onOpenChange: (o: boolean) => {
      if (!o) close();
    },
    plan: detail,
    run,
    onSuccess: handleSuccess,
  };
  const activeLinks = detail.maintenanceLinks.filter((l) => l.linkStatus === "active").length;
  const counts: Partial<Record<TabKey, number>> = {
    apontamentos: detail.items.length,
    tratativas: detail.resolutions.length,
    manutencoes: activeLinks,
    eventos: detail.events.length,
    checklists: detail.executions.length,
  };

  return (
    <>
      <DrawerHeader className="gap-2 px-4 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <DrawerTitle className="tabular-nums" data-testid="plan-drawer-code">
            {detail.code}
          </DrawerTitle>
          <PlanStatusBadge status={detail.status} size="md" />
          <PriorityBadge priority={detail.priority} size="md" />
          <DeadlineBadge deadline={detail.deadline} days={detail.daysOverdue} size="md" />
          {detail.isRecurrence ? <RecurrenceBadge size="md" /> : null}
        </div>
        <DrawerDescription className="text-body text-fg">{planTitle(detail)}</DrawerDescription>
        <p className="text-caption text-fg-secondary">
          <span className="font-semibold text-fg tabular-nums">{detail.licensePlate ?? "Sem placa"}</span>
          {[
            detail.fleetCode ? `Frota ${detail.fleetCode}` : null,
            detail.vehicleTypeName,
            detail.operationName,
            detail.cycleNumber > 1 ? `${formatInt(detail.cycleNumber)}º ciclo do problema` : null,
          ]
            .filter(Boolean)
            .map((part) => ` · ${part}`)
            .join("")}
        </p>
        <ActionBar
          detail={detail}
          can={can}
          checking={checking}
          selectedCount={selectedOpen.length}
          onClearSelection={() => setSelected(new Set())}
          onAction={onAction}
        />
      </DrawerHeader>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as TabKey)}
        className="flex min-h-0 flex-1 flex-col gap-0 max-sm:min-h-fit max-sm:flex-none"
      >
        <TabsList aria-label="Seções do plano" className="px-3 max-sm:sticky max-sm:top-0 max-sm:z-10 max-sm:bg-surface-elevated sm:px-5">
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key} count={counts[t.key]} data-testid={`plan-drawer-tab-${t.key}`}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <DrawerBody
          className="flex flex-col gap-4 px-4 max-sm:min-h-fit max-sm:flex-none max-sm:overflow-visible sm:px-5"
          aria-busy={loading || checking}
        >
          {error ? (
            <Alert variant="danger">
              <AlertDescription>{error} O que aparece abaixo é a última leitura bem-sucedida.</AlertDescription>
            </Alert>
          ) : null}

          <TabsContent value="resumo" className="flex flex-col gap-4">
            <SummaryTab detail={detail} onOpenPlan={actions.openPlan} />
          </TabsContent>
          <TabsContent value="apontamentos" className="flex flex-col gap-4">
            <ItemsTab
              detail={detail}
              openItems={openItems}
              selected={selected}
              selectable={canSelect}
              onToggle={toggleItem}
              onSelectAll={(all) => setSelected(all ? new Set(openItems.map((i) => i.id)) : new Set())}
              canOpenMaintenance={perms.maintenanceView}
              onOpenMaintenance={openMaintenance}
              onOpenChecklist={setChecklistId}
              onOpenTrace={actions.openTrace}
            />
          </TabsContent>
          <TabsContent value="tratativas" className="flex flex-col gap-4">
            <ResolutionsTab resolutions={detail.resolutions} canOpenMaintenance={perms.maintenanceView} onOpenMaintenance={openMaintenance} />
          </TabsContent>
          <TabsContent value="manutencoes" className="flex flex-col gap-4">
            <MaintenancesTab
              links={detail.maintenanceLinks}
              canOpenMaintenance={perms.maintenanceView}
              canUnlink={!closed && perms.linkMaintenance}
              onOpenMaintenance={openMaintenance}
              onUnlink={(link) => setDialog({ kind: "unlink", link })}
            />
          </TabsContent>
          <TabsContent value="eventos" className="flex flex-col gap-4">
            <EventsTab events={detail.events} canOpenMaintenance={perms.maintenanceView} onOpenMaintenance={openMaintenance} />
          </TabsContent>
          <TabsContent value="checklists" className="flex flex-col gap-4">
            <ExecutionsTab executions={detail.executions} onOpenTrace={actions.openTrace} onOpenChecklist={setChecklistId} />
          </TabsContent>
        </DrawerBody>
      </Tabs>

      {dialog?.kind === "analysis" ? <AnalysisDialog {...common} state={dialog.state} /> : null}
      {dialog?.kind === "resolve" ? <ResolveDialog {...common} resolution={dialog.resolution} target={target} /> : null}
      {dialog?.kind === "validate" ? <ValidateDialog {...common} target={target} /> : null}
      {dialog?.kind === "link" ? <LinkMaintenanceDialog {...common} target={target} loadCandidates={loadCandidates} /> : null}
      {dialog?.kind === "duplicates" ? (
        <DuplicateMaintenanceDialog
          {...common}
          candidates={dialog.candidates}
          target={target}
          canLink={perms.linkMaintenance}
          onOpenNew={() => openWizard(dialog.preset)}
        />
      ) : null}
      {dialog?.kind === "unlink" ? <UnlinkDialog {...common} link={dialog.link} /> : null}
      {dialog?.kind === "reopen" ? <ReopenDialog {...common} /> : null}
      {dialog?.kind === "priority" ? <PriorityDialog {...common} /> : null}
      {dialog?.kind === "due" ? <DueDialog {...common} /> : null}
      {dialog?.kind === "assign" ? <AssignDialog {...common} catalog={catalog} /> : null}
      {dialog?.kind === "note" ? <NoteDialog {...common} /> : null}

      {/* O checklist original, só leitura (o detalhe oficial do Check List de Frota). */}
      <ExecutionDetailDrawer
        executionId={checklistId}
        onOpenChange={(open) => {
          if (!open) setChecklistId(null);
        }}
        loader={preview ? previewChecklistLoader : checklistLoader}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Barra de ações
// ---------------------------------------------------------------------------

const ACTION_DEFS: Record<ActionName, { label: string; icon: React.ReactNode }> = {
  analysis: { label: "Iniciar análise", icon: <SearchCheck /> },
  "maintenance-required": { label: "Manutenção necessária", icon: <Wrench /> },
  "open-maintenance": { label: "Abrir manutenção", icon: <Plus /> },
  "link-maintenance": { label: "Vincular manutenção", icon: <Link2 /> },
  validate: { label: "Validar resolução", icon: <ShieldCheck /> },
  "resolve-without-maintenance": { label: "Resolver sem manutenção", icon: <CheckCheck /> },
  improper: { label: "Improcedente", icon: <ThumbsDown /> },
  cancel: { label: "Cancelar apontamentos", icon: <Ban /> },
  reopen: { label: "Reabrir", icon: <RotateCcw /> },
  priority: { label: "Alterar prioridade", icon: <Flag /> },
  due: { label: "Alterar prazo", icon: <CalendarClock /> },
  assign: { label: "Responsável", icon: <UserRound /> },
  note: { label: "Observação", icon: <MessageSquarePlus /> },
};

/** O próximo passo natural de cada situação vem primeiro. */
const PRIMARY_ORDER: Record<PlanStatus, ActionName[]> = {
  new: ["analysis", "open-maintenance", "resolve-without-maintenance"],
  in_analysis: ["open-maintenance", "maintenance-required", "resolve-without-maintenance"],
  awaiting_maintenance: ["open-maintenance", "link-maintenance"],
  maintenance_open: ["validate", "link-maintenance"],
  maintenance_scheduled: ["validate", "link-maintenance"],
  maintenance_in_progress: ["validate", "link-maintenance"],
  pending_new_action: ["open-maintenance", "link-maintenance", "resolve-without-maintenance"],
  resolved: ["reopen", "note"],
  resolved_without_maintenance: ["reopen", "note"],
  improper: ["reopen", "note"],
  cancelled: ["note"],
};

const MENU_TREAT: ActionName[] = [
  "analysis", "maintenance-required", "open-maintenance", "link-maintenance", "validate", "resolve-without-maintenance",
];
const MENU_ADMIN: ActionName[] = ["priority", "due", "assign", "note", "reopen"];
const MENU_DANGER: ActionName[] = ["improper", "cancel"];

function ActionBar({
  detail, can, checking, selectedCount, onClearSelection, onAction,
}: {
  detail: ActionPlanDetail;
  can: Record<ActionName, boolean>;
  checking: boolean;
  selectedCount: number;
  onClearSelection: () => void;
  onAction: (name: ActionName) => void;
}) {
  const primary = PRIMARY_ORDER[detail.status].filter((a) => can[a]).slice(0, 3);
  const rest = (list: ActionName[]) => list.filter((a) => can[a] && !primary.includes(a));
  const treat = rest(MENU_TREAT);
  const admin = rest(MENU_ADMIN);
  const danger = rest(MENU_DANGER);
  const hasMenu = treat.length + admin.length + danger.length > 0;

  if (primary.length === 0 && !hasMenu) {
    return (
      <p className="text-caption text-fg-muted" data-testid="plan-drawer-actions">
        Nenhuma ação disponível para o seu perfil nesta situação.
      </p>
    );
  }

  const item = (name: ActionName, destructive = false) => (
    <DropdownMenuItem key={name} destructive={destructive} onSelect={() => onAction(name)} data-testid={`plan-action-${name}`}>
      {ACTION_DEFS[name].icon}
      {ACTION_DEFS[name].label}
    </DropdownMenuItem>
  );

  return (
    <div className="flex flex-col gap-2 pt-1">
      <div role="group" aria-label="Ações do plano" className="flex flex-wrap items-center gap-2" data-testid="plan-drawer-actions">
        {primary.map((name, index) => (
          <Button
            key={name}
            size="sm"
            variant={index === 0 ? "primary" : "outline"}
            leadingIcon={ACTION_DEFS[name].icon}
            loading={name === "open-maintenance" && checking}
            disabled={checking && name !== "open-maintenance"}
            onClick={() => onAction(name)}
            data-testid={`plan-action-${name}`}
          >
            {ACTION_DEFS[name].label}
          </Button>
        ))}
        {hasMenu ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" trailingIcon={<ChevronDown />} disabled={checking} data-testid="plan-action-more">
                Mais ações
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-60">
              <DropdownMenuLabel>{detail.code}</DropdownMenuLabel>
              {treat.map((name) => item(name))}
              {admin.length > 0 && treat.length > 0 ? <DropdownMenuSeparator /> : null}
              {admin.map((name) => item(name))}
              {danger.length > 0 && treat.length + admin.length > 0 ? <DropdownMenuSeparator /> : null}
              {danger.map((name) => item(name, true))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {selectedCount > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-caption text-fg-secondary" data-testid="plan-drawer-selection">
          <Badge variant="primary" size="sm">
            {plural(selectedCount, "apontamento selecionado", "apontamentos selecionados")}
          </Badge>
          <span>As tratativas por apontamento valem só para a seleção.</span>
          <Button size="sm" variant="ghost" leadingIcon={<X />} onClick={onClearSelection} data-testid="plan-drawer-clear-selection">
            Limpar seleção
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Peças de layout
// ---------------------------------------------------------------------------

function Section({
  title, description, action, children, testId,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
}) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3 sm:p-4" data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 id={id} className="text-h4 font-semibold text-fg">
            {title}
          </h3>
          {description ? <p className="text-caption text-fg-muted">{description}</p> : null}
        </div>
        {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function Fact({ label, children, wide }: { label: string; children?: React.ReactNode; wide?: boolean }) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", wide && "sm:col-span-2 lg:col-span-3")}>
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="text-body-sm break-words text-fg">{empty ? "—" : children}</dd>
    </div>
  );
}

const Facts = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <dl className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3", className)}>{children}</dl>
);

/** Código de manutenção: abre a gaveta oficial quando a pessoa pode ver a Manutenção. */
function MaintenanceCode({
  id, code, canOpen, onOpen,
}: {
  id: string;
  code: string;
  canOpen: boolean;
  onOpen: (id: string) => void;
}) {
  if (!canOpen) return <span className="font-semibold tabular-nums text-fg">{code}</span>;
  return (
    <Button
      variant="link"
      size="sm"
      className="h-auto px-0 font-semibold tabular-nums"
      onClick={() => onOpen(id)}
      aria-label={`Abrir a manutenção ${code}`}
      data-testid="plan-maintenance-open"
    >
      {code}
    </Button>
  );
}

const cityLabel = (d: { cityName: string | null; stateUf: string | null }) =>
  d.cityName ? `${d.cityName}${d.stateUf ? `/${d.stateUf}` : ""}` : d.stateUf;

// ---------------------------------------------------------------------------
// Resumo (§29)
// ---------------------------------------------------------------------------

function SummaryTab({ detail, onOpenPlan }: { detail: ActionPlanDetail; onOpenPlan: (id: string) => void }) {
  const question = detail.items[0]?.question ?? null;
  const closed = isClosed(detail.status);
  const samePlan = detail.openPlanSameProblem;
  const previous = detail.previousPlan;
  return (
    <>
      {samePlan ? (
        <Alert
          variant="info"
          data-testid="plan-same-problem"
          action={
            <Button size="sm" variant="outline" onClick={() => onOpenPlan(samePlan.id)} data-testid="plan-same-problem-open">
              Abrir {samePlan.code}
            </Button>
          }
        >
          <AlertTitle>Há um plano aberto para o mesmo problema</AlertTitle>
          <AlertDescription>
            O plano {samePlan.code} trata este mesmo problema no veículo; novas ocorrências e tratativas seguem nele.
          </AlertDescription>
        </Alert>
      ) : null}

      <Section title="Plano" testId="plan-summary">
        <Facts>
          <Fact label="Código"><span className="tabular-nums">{detail.code}</span></Fact>
          <Fact label="Situação"><PlanStatusBadge status={detail.status} /></Fact>
          <Fact label="Prioridade">
            <span className="flex flex-wrap items-center gap-1.5">
              <PriorityBadge priority={detail.priority} />
              <span className="text-caption text-fg-muted">{PRIORITY_SOURCE_LABEL[detail.prioritySource] ?? detail.prioritySource}</span>
            </span>
          </Fact>
          <Fact label="Prazo">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="tabular-nums">{formatDate(detail.dueOn)}</span>
              <DeadlineBadge deadline={detail.deadline} days={detail.daysOverdue} />
            </span>
            {detail.dueOn ? (
              <span className="block text-caption text-fg-muted">{DUE_SOURCE_LABEL[detail.dueSource] ?? detail.dueSource}</span>
            ) : null}
          </Fact>
          <Fact label="Responsável">{detail.responsibleName ?? <span className="text-fg-muted">Sem responsável</span>}</Fact>
          <Fact label="Cluster">{detail.clusterName}</Fact>
          <Fact label="Problema / item" wide>{planTitle(detail)}</Fact>
          {question ? <Fact label="Pergunta do checklist" wide>{question}</Fact> : null}
          <Fact label="Action key">
            <span className="font-mono text-caption break-all">{detail.actionKey}</span>
          </Fact>
          {detail.criticality ? <Fact label="Criticidade da pergunta">{PRIORITY_LABEL[detail.criticality as keyof typeof PRIORITY_LABEL] ?? detail.criticality}</Fact> : null}
          <Fact label="Tratativa">{ANALYSIS_LABEL[detail.analysisState] ?? detail.analysisState}</Fact>
        </Facts>
      </Section>

      <Section
        title="Veículo e contexto histórico"
        description="Onde o veículo estava no checklist de origem. Fica preservado: mudanças posteriores de alocação não reescrevem o plano."
        testId="plan-summary-context"
      >
        <Facts>
          <Fact label="Veículo (frota)">{detail.fleetCode}</Fact>
          <Fact label="Placa"><span className="tabular-nums">{detail.licensePlate}</span></Fact>
          <Fact label="Tipo de equipamento">{detail.vehicleTypeName}</Fact>
          <Fact label="Operação">{detail.operationName}</Fact>
          <Fact label="BR">{detail.brCode}</Fact>
          <Fact label="Cidade/UF">{cityLabel(detail)}</Fact>
          <Fact label="Filial">{detail.unitName}</Fact>
          <Fact label="Liderança histórica">{detail.leaderName}</Fact>
        </Facts>
      </Section>

      <Section title="Ocorrências e tratativa" testId="plan-summary-timeline">
        <Facts>
          <Fact label="1º apontamento">
            <span className="tabular-nums">{formatDate(detail.firstOperationalDate)}</span>
          </Fact>
          <Fact label="Última ocorrência">
            <span className="tabular-nums">{formatDate(detail.lastOperationalDate)}</span>
          </Fact>
          <Fact label="Ocorrências">
            <span className="tabular-nums">{formatInt(detail.occurrences)}</span>
            <span className="text-caption text-fg-muted">
              {" "}· {formatInt(detail.openItems)} em aberto · {formatInt(detail.resolvedItems)} tratada(s)
            </span>
          </Fact>
          {!closed && detail.ageDays != null ? <Fact label="Em aberto há">{plural(detail.ageDays, "dia", "dias")}</Fact> : null}
          <Fact label="Última tratativa">
            {detail.lastTreatment ? (
              <>
                {detail.lastTreatment}
                {detail.lastTreatmentAt ? <span className="text-caption text-fg-muted"> · {formatDateTime(detail.lastTreatmentAt)}</span> : null}
              </>
            ) : null}
          </Fact>
          {closed ? (
            <Fact label="Encerrado em">
              {formatDateTime(detail.closedAt)}
              {detail.autoClosed ? <span className="text-caption text-fg-muted"> · automaticamente</span> : null}
            </Fact>
          ) : null}
          {detail.tmrDays != null ? <Fact label="Tempo até a resolução (TMR)">{formatDays(detail.tmrDays)}</Fact> : null}
          {detail.reopenedCount > 0 ? <Fact label="Reaberturas">{formatInt(detail.reopenedCount)}</Fact> : null}
        </Facts>
      </Section>

      <Section
        title={`Serviços mapeados (${detail.services.length})`}
        description="Serviços da Manutenção que tratam este item (Parâmetros & Mapeamento). Com baixa automática, a conclusão da manutenção com o serviço resolve o apontamento."
        testId="plan-summary-services"
      >
        {detail.services.length === 0 ? (
          <p className="text-body-sm text-fg-secondary">
            Item ainda sem serviço mapeado: sem baixa automática nem conciliação de alta confiança. A resolução pela manutenção
            precisa ser validada.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {detail.services.map((s) => (
              <li key={s.serviceId} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm" data-testid="plan-service">
                <span className="font-medium text-fg">{s.name}</span>
                {s.cluster ? <span className="text-caption text-fg-muted">{s.cluster}</span> : null}
                {s.autoResolve ? (
                  <Badge size="sm" variant="success" icon={<CheckCheck />}>
                    Baixa automática
                  </Badge>
                ) : (
                  <Badge size="sm" variant="neutral" appearance="outline">
                    Sem baixa automática
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {previous || detail.nextPlans.length > 0 ? (
        <Section
          title="Ciclos do problema"
          description="O mesmo problema no mesmo veículo, antes e depois deste plano."
          testId="plan-summary-cycles"
        >
          <ul className="flex flex-col gap-2">
            {previous ? (
              <li className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm">
                <span className="text-fg-muted">Ciclo anterior:</span>
                <Button variant="link" size="sm" className="h-auto px-0 tabular-nums" onClick={() => onOpenPlan(previous.id)} data-testid="plan-cycle-previous">
                  {previous.code}
                </Button>
                <PlanStatusBadge status={previous.status} />
                {previous.closedAt ? (
                  <span className="text-caption text-fg-muted">encerrado em {formatDate(previous.closedAt)}</span>
                ) : null}
              </li>
            ) : null}
            {detail.nextPlans.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm">
                <span className="text-fg-muted">Ciclo seguinte:</span>
                <Button variant="link" size="sm" className="h-auto px-0 tabular-nums" onClick={() => onOpenPlan(p.id)} data-testid="plan-cycle-next">
                  {p.code}
                </Button>
                <PlanStatusBadge status={p.status} />
                <span className="text-caption text-fg-muted">desde {formatDate(p.firstOperationalDate)}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Apontamentos (§30)
// ---------------------------------------------------------------------------

function ItemsTab({
  detail, openItems, selected, selectable, onToggle, onSelectAll, canOpenMaintenance, onOpenMaintenance, onOpenChecklist, onOpenTrace,
}: {
  detail: ActionPlanDetail;
  openItems: PlanItem[];
  selected: ReadonlySet<string>;
  selectable: boolean;
  onToggle: (id: string, checked: boolean) => void;
  onSelectAll: (all: boolean) => void;
  canOpenMaintenance: boolean;
  onOpenMaintenance: (id: string) => void;
  onOpenChecklist: (executionId: string) => void;
  onOpenTrace: (executionId: string) => void;
}) {
  const selectAllId = React.useId();
  if (detail.items.length === 0) {
    return <EmptyState size="sm" variant="panel" title="Nenhum apontamento" description="Este plano não tem apontamentos registrados." />;
  }
  const selectedCount = openItems.filter((i) => selected.has(i.id)).length;
  const showSelection = selectable && openItems.length > 0;

  return (
    <>
      {showSelection ? (
        <div className="flex flex-col gap-1 rounded-md border border-border bg-surface-secondary p-3" data-testid="plan-items-selection">
          <div className="flex flex-wrap items-center gap-2.5">
            <Checkbox
              id={selectAllId}
              checked={selectedCount === 0 ? false : selectedCount === openItems.length ? true : "indeterminate"}
              onCheckedChange={(v) => onSelectAll(v === true)}
              data-testid="plan-items-select-all"
            />
            <label htmlFor={selectAllId} className="cursor-pointer text-body-sm font-medium text-fg">
              {openItems.length === 1 ? "Selecionar o apontamento em aberto" : `Selecionar os ${formatInt(openItems.length)} em aberto`}
            </label>
            {selectedCount > 0 ? (
              <span className="text-caption text-fg-secondary">· {formatInt(selectedCount)} selecionado(s)</span>
            ) : null}
          </div>
          <p className="text-caption text-fg-muted">
            As tratativas valem para os apontamentos selecionados; sem seleção, para todos os apontamentos em aberto.
          </p>
        </div>
      ) : null}
      <ul className="flex flex-col gap-3" aria-label="Apontamentos do plano">
        {detail.items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            selectable={showSelection && isOpenItem(item)}
            checked={selected.has(item.id)}
            onToggle={onToggle}
            canOpenMaintenance={canOpenMaintenance}
            onOpenMaintenance={onOpenMaintenance}
            onOpenChecklist={onOpenChecklist}
            onOpenTrace={onOpenTrace}
          />
        ))}
      </ul>
    </>
  );
}

function ItemCard({
  item, selectable, checked, onToggle, canOpenMaintenance, onOpenMaintenance, onOpenChecklist, onOpenTrace,
}: {
  item: PlanItem;
  selectable: boolean;
  checked: boolean;
  onToggle: (id: string, checked: boolean) => void;
  canOpenMaintenance: boolean;
  onOpenMaintenance: (id: string) => void;
  onOpenChecklist: (executionId: string) => void;
  onOpenTrace: (executionId: string) => void;
}) {
  const checkboxId = React.useId();
  const type = item.checklistType ? CHECKLIST_TYPE_LABEL[item.checklistType] ?? item.checklistType : null;
  const heading = [formatDate(item.operationalDate), type ? `Checklist de ${type.toLowerCase()}` : "Checklist"].join(" · ");
  const last = item.lastResolution;

  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-md border p-3 hfm-transition sm:p-4",
        selectable && checked ? "border-primary bg-surface-selected" : "border-border bg-surface",
      )}
      data-testid="plan-item"
      data-status={item.status}
    >
      <div className="flex items-start gap-3">
        {selectable ? (
          <Checkbox
            id={checkboxId}
            checked={checked}
            onCheckedChange={(v) => onToggle(item.id, v === true)}
            className="mt-1"
            aria-label={`Selecionar o apontamento de ${formatDate(item.operationalDate)}${item.optionLabel ? ` — ${item.optionLabel}` : ""}`}
            data-testid="plan-item-select"
          />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-body-sm font-semibold text-fg">{heading}</p>
            <p className="text-caption text-fg-muted">Registrado em {formatDateTime(item.occurredAt)}</p>
          </div>
          <ItemStatusBadge status={item.status} size="md" />
        </div>
      </div>

      <Facts>
        <Fact label="Pergunta" wide>{item.question}</Fact>
        <Fact label="Resposta">{answerLabel(item.answer)}</Fact>
        <Fact label="Opção / detalhe">{item.optionLabel}</Fact>
        <Fact label="Colaborador">
          {item.employeeName}
          {item.employeeCode ? <span className="text-caption text-fg-muted"> · Matrícula {item.employeeCode}</span> : null}
        </Fact>
        {item.userName && item.userName !== item.employeeName ? <Fact label="Usuário">{item.userName}</Fact> : null}
        {item.detailText || item.note ? (
          <Fact label="Relato" wide>
            {item.detailText ? <span className="block whitespace-pre-line">{item.detailText}</span> : null}
            {item.note ? <span className="block whitespace-pre-line text-fg-secondary">Nota: {item.note}</span> : null}
          </Fact>
        ) : null}
        <Fact label="Operação · BR">{[item.operationName, item.brCode].filter(Boolean).join(" · ") || null}</Fact>
        <Fact label="Liderança na data">{item.leaderName}</Fact>
      </Facts>

      {item.maintenances.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-caption font-medium text-fg-muted">Manutenções</p>
          <ul className="flex flex-col gap-1.5">
            {item.maintenances.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm">
                <MaintenanceCode id={m.id} code={m.code} canOpen={canOpenMaintenance} onOpen={onOpenMaintenance} />
                <MaintenanceStatusTag status={m.status} />
                <span className="text-caption text-fg-muted">apontamento:</span>
                <FindingResolutionTag status={m.resolutionStatus} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {item.resolvedAt || last ? (
        <div className="flex flex-col gap-1 rounded-md border border-border-subtle bg-surface-secondary px-3 py-2 text-caption text-fg-secondary">
          {item.resolvedAt ? (
            <p>
              Tratado em {formatDateTime(item.resolvedAt)}
              {item.resolvedByName ? ` por ${item.resolvedByName}` : ""}
              {item.resolvedMaintenanceCode ? ` · manutenção ${item.resolvedMaintenanceCode}` : ""}
            </p>
          ) : null}
          {last ? (
            <p>
              <span className="font-medium text-fg">Última tratativa: {RESOLUTION_TYPE_LABEL[last.type] ?? last.type}</span>
              {last.reasonCode ? ` · ${REASON_LABEL[last.reasonCode] ?? last.reasonCode}` : ""}
              {last.reason ? ` · “${last.reason}”` : ""}
              {last.observation ? ` · ${last.observation}` : ""}
              {` · ${last.by ?? SOURCE_LABEL[last.source] ?? last.source}, ${formatDateTime(last.at)}`}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          leadingIcon={<ClipboardList />}
          onClick={() => onOpenChecklist(item.executionId)}
          data-testid="plan-item-open-checklist"
        >
          Abrir checklist
        </Button>
        <Button size="sm" variant="ghost" leadingIcon={<Route />} onClick={() => onOpenTrace(item.executionId)} data-testid="plan-item-trace">
          Ver rastro
        </Button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Tratativas
// ---------------------------------------------------------------------------

function ResolutionsTab({
  resolutions, canOpenMaintenance, onOpenMaintenance,
}: {
  resolutions: PlanResolution[];
  canOpenMaintenance: boolean;
  onOpenMaintenance: (id: string) => void;
}) {
  const sorted = React.useMemo(() => [...resolutions].sort((a, b) => b.at.localeCompare(a.at)), [resolutions]);
  if (sorted.length === 0) {
    return (
      <EmptyState
        size="sm"
        variant="panel"
        title="Nenhuma tratativa registrada"
        description="As resoluções por apontamento (pela manutenção, sem manutenção, improcedente, cancelado, reabertura) aparecem aqui."
      />
    );
  }
  return (
    <ul className="flex flex-col gap-2" aria-label="Histórico de tratativas">
      {sorted.map((r) => (
        <li key={r.id} className="flex flex-col gap-1.5 rounded-md border border-border bg-surface p-3" data-testid="plan-resolution">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-body-sm font-semibold text-fg">{RESOLUTION_TYPE_LABEL[r.type] ?? r.type}</span>
            <span className="text-caption text-fg-secondary">
              {r.from ? `${ITEM_STATUS_LABEL[r.from as keyof typeof ITEM_STATUS_LABEL] ?? r.from} → ` : "→ "}
              {ITEM_STATUS_LABEL[r.to as keyof typeof ITEM_STATUS_LABEL] ?? r.to}
            </span>
            {r.confidence ? <ConfidenceBadge confidence={r.confidence as Confidence} /> : null}
          </div>
          <p className="text-caption text-fg-secondary">
            Apontamento de {formatDate(r.operationalDate)}
            {r.optionLabel ? ` · ${r.optionLabel}` : ""}
          </p>
          {r.maintenanceId && r.maintenanceCode ? (
            <p className="flex flex-wrap items-center gap-1.5 text-caption text-fg-secondary">
              Manutenção
              <MaintenanceCode id={r.maintenanceId} code={r.maintenanceCode} canOpen={canOpenMaintenance} onOpen={onOpenMaintenance} />
            </p>
          ) : null}
          {r.reasonCode ? <p className="text-caption text-fg-secondary">Motivo: {REASON_LABEL[r.reasonCode] ?? r.reasonCode}</p> : null}
          {r.reason ? <p className="text-body-sm break-words text-fg">“{r.reason}”</p> : null}
          {r.observation ? <p className="text-caption break-words text-fg-secondary">{r.observation}</p> : null}
          <p className="text-caption text-fg-muted">
            {r.by ?? SOURCE_LABEL[r.source] ?? r.source}
            {r.by && r.source !== "user" ? ` (${SOURCE_LABEL[r.source] ?? r.source})` : ""} · <time dateTime={r.at}>{formatDateTime(r.at)}</time>
          </p>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Manutenções vinculadas
// ---------------------------------------------------------------------------

function MaintenancesTab({
  links, canOpenMaintenance, canUnlink, onOpenMaintenance, onUnlink,
}: {
  links: PlanMaintenanceLink[];
  canOpenMaintenance: boolean;
  canUnlink: boolean;
  onOpenMaintenance: (id: string) => void;
  onUnlink: (link: PlanMaintenanceLink) => void;
}) {
  if (links.length === 0) {
    return (
      <EmptyState
        size="sm"
        variant="panel"
        title="Nenhuma manutenção vinculada"
        description="Abra uma manutenção pelo plano ou vincule uma existente do mesmo veículo. A conciliação automática também vincula quando a correspondência é de alta confiança."
      />
    );
  }
  return (
    <ul className="flex flex-col gap-3" aria-label="Manutenções vinculadas">
      {links.map((l) => {
        const active = l.linkStatus === "active";
        return (
          <li
            key={l.id}
            className={cn("flex flex-col gap-3 rounded-md border border-border p-3 sm:p-4", active ? "bg-surface" : "bg-surface-secondary")}
            data-testid="plan-maintenance-link"
            data-link-status={l.linkStatus}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <MaintenanceCode id={l.maintenanceId} code={l.code} canOpen={canOpenMaintenance} onOpen={onOpenMaintenance} />
                <MaintenanceStatusTag status={l.status} />
                <MaintenanceTypeBadge type={l.type} />
                {!active ? (
                  <Badge size="sm" variant="neutral" appearance="outline">
                    {LINK_STATUS_LABEL[l.linkStatus] ?? l.linkStatus}
                  </Badge>
                ) : null}
                <Badge size="sm" variant={l.resolutive ? "success" : "neutral"} appearance="outline">
                  {l.resolutive ? "Resolutiva" : "Não resolutiva"}
                </Badge>
              </div>
              {canUnlink && active ? (
                <Button size="sm" variant="ghost" leadingIcon={<Unlink />} onClick={() => onUnlink(l)} data-testid="plan-maintenance-unlink">
                  Desvincular
                </Button>
              ) : null}
            </div>
            <Facts>
              <Fact label="Origem do vínculo">{LINK_ORIGIN_LABEL[l.origin] ?? l.origin}</Fact>
              <Fact label="Correspondência">
                {l.confidence || l.rule ? (
                  <span className="flex flex-col gap-1">
                    {l.confidence ? <ConfidenceBadge confidence={l.confidence as Confidence} /> : null}
                    {l.rule ? <span className="text-caption text-fg-secondary">{RULE_LABEL[l.rule] ?? l.rule}</span> : null}
                  </span>
                ) : null}
              </Fact>
              <Fact label="Apontamentos tratados">
                <span className="tabular-nums">
                  {formatInt(l.answersResolved)} de {formatInt(l.answers)}
                </span>
              </Fact>
              <Fact label="Origem da manutenção">{l.originName}</Fact>
              <Fact label="Ordem de serviço (OS)">{l.serviceOrderNumber}</Fact>
              <Fact label="Fornecedor">{l.supplierName}</Fact>
              <Fact label="Solicitação">{l.requestedOn ? formatDate(l.requestedOn) : null}</Fact>
              <Fact label="Agendamento">{l.scheduledDate ? formatDate(l.scheduledDate) : null}</Fact>
              <Fact label="Entrada · saída">
                {l.entryDate || l.exitDate ? `${formatDate(l.entryDate)} · ${formatDate(l.exitDate)}` : null}
              </Fact>
              {l.services ? <Fact label="Serviços" wide>{l.services}</Fact> : null}
              <Fact label="Vinculada">
                {formatDateTime(l.linkedAt)}
                {l.linkedBy ? <span className="text-caption text-fg-muted"> · {l.linkedBy}</span> : null}
              </Fact>
              {l.unlinkedAt ? (
                <Fact label={l.linkStatus === "discarded" ? "Descartada" : "Desvinculada"}>
                  {formatDateTime(l.unlinkedAt)}
                  {l.unlinkedBy ? <span className="text-caption text-fg-muted"> · {l.unlinkedBy}</span> : null}
                </Fact>
              ) : null}
              {l.reason ? <Fact label="Motivo" wide>“{l.reason}”</Fact> : null}
            </Facts>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;
const asStr = (v: unknown): string | null => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);
const asNum = (v: unknown): number | null =>
  typeof v === "number" ? v : Array.isArray(v) ? v.length : typeof v === "string" && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null;

const priorityText = (v: unknown) => {
  const s = asStr(v);
  return s ? PRIORITY_LABEL[s as keyof typeof PRIORITY_LABEL] ?? s : "—";
};

function statusText(type: string, value: string | null): string | null {
  if (!value) return null;
  if (type === "analysis_changed") return ANALYSIS_LABEL[value] ?? value;
  return PLAN_STATUS_LABEL[value as PlanStatus] ?? value;
}

function eventLines(e: PlanEvent): string[] {
  const p: Json = e.payload ?? {};
  const code = asStr(p.maintenanceCode);
  const count = (key: string, one: string, many: string) => {
    const n = asNum(p[key]);
    return n ? plural(n, one, many) : "";
  };
  switch (e.type) {
    case "priority_changed": {
      const dueFrom = asStr(p.dueFrom);
      const dueTo = asStr(p.dueTo);
      return [
        `Prioridade: ${priorityText(p.from)} → ${priorityText(p.to)}`,
        dueFrom !== dueTo ? `Prazo: ${formatDate(dueFrom)} → ${formatDate(dueTo)}` : "",
      ].filter(Boolean);
    }
    case "due_changed":
      return [`Prazo: ${formatDate(asStr(p.from))} → ${formatDate(asStr(p.to))}`];
    case "assigned":
      return [`Responsável: ${asStr(p.fromName) ?? "sem responsável"} → ${asStr(p.toName) ?? "sem responsável"}`];
    case "maintenance_linked":
    case "maintenance_relinked": {
      const origin = asStr(p.origin);
      const rule = asStr(p.rule);
      return [
        code ? `Manutenção ${code}` : "",
        origin ? LINK_ORIGIN_LABEL[origin] ?? origin : "",
        rule && rule !== "manual" ? RULE_LABEL[rule] ?? rule : "",
        p.resolutive === false ? "Não resolutiva" : "",
        count("answersLinked", "apontamento vinculado", "apontamentos vinculados"),
      ].filter(Boolean);
    }
    case "maintenance_unlinked":
      return [code ? `Manutenção ${code}` : "", count("answersUnlinked", "apontamento retirado da manutenção", "apontamentos retirados da manutenção")].filter(Boolean);
    case "maintenance_opened":
      return [code ? `Manutenção ${code}` : "", count("answers", "apontamento", "apontamentos")].filter(Boolean);
    case "candidate_discarded":
      return code ? [`Manutenção ${code}`] : [];
    case "items_resolved_without_maintenance":
    case "items_improper":
    case "items_cancelled":
    case "items_validated_by_maintenance": {
      const reasonCode = asStr(p.reasonCode);
      const observation = asStr(p.observation);
      return [
        count("items", "apontamento", "apontamentos"),
        reasonCode ? `Motivo: ${REASON_LABEL[reasonCode] ?? reasonCode}` : "",
        code ? `Manutenção ${code}` : "",
        observation ?? "",
      ].filter(Boolean);
    }
    case "reopened":
      return [count("items", "apontamento voltou a pendente", "apontamentos voltaram a pendente")].filter(Boolean);
    case "occurrence_added":
      return [
        asStr(p.operationalDate) ? `Checklist de ${formatDate(asStr(p.operationalDate))}` : "",
      ].filter(Boolean);
    case "recurrence_detected":
      return [asStr(p.previousCode) ? `Plano anterior: ${asStr(p.previousCode)}` : ""].filter(Boolean);
    default:
      return [];
  }
}

function eventAuthor(e: PlanEvent): string {
  if (e.source === "user") return e.actor ?? "Usuário";
  const source = SOURCE_LABEL[e.source] ?? e.source;
  return e.actor ? `${source} (${e.actor})` : source;
}

function EventsTab({
  events, canOpenMaintenance, onOpenMaintenance,
}: {
  events: PlanEvent[];
  canOpenMaintenance: boolean;
  onOpenMaintenance: (id: string) => void;
}) {
  if (events.length === 0) {
    return <EmptyState size="sm" variant="panel" title="Sem eventos registrados" />;
  }
  return (
    <Section
      title="Linha do tempo"
      description="Tudo o que aconteceu com o plano, em ordem. Nada é apagado: decisões guardam quem, quando e o motivo."
      testId="plan-events"
    >
      <ol className="flex flex-col">
        {events.map((e, index) => {
          const lines = eventLines(e);
          const lastItem = index === events.length - 1;
          const from = statusText(e.type, e.from);
          const to = statusText(e.type, e.to);
          const maintenanceId = asStr(e.payload?.maintenanceId);
          const maintenanceCode = asStr(e.payload?.maintenanceCode);
          return (
            <li key={e.id} className={cn("relative flex gap-3", !lastItem && "pb-4")} data-testid="plan-event" data-type={e.type}>
              <span aria-hidden className="relative flex w-3 shrink-0 justify-center">
                {!lastItem ? <span className="absolute top-3 -bottom-1 w-px bg-border" /> : null}
                <span className="relative mt-1.5 size-2.5 rounded-full border-2 border-surface bg-primary" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-body-sm font-semibold text-fg">{EVENT_LABEL[e.type] ?? e.type}</span>
                  {to && from !== to ? (
                    <span className="text-caption text-fg-secondary">
                      {from ? `${from} → ` : "→ "}
                      {to}
                    </span>
                  ) : null}
                </div>
                <p className="text-caption text-fg-muted">
                  {eventAuthor(e)} · <time dateTime={e.at}>{formatDateTime(e.at)}</time>
                </p>
                {e.reason ? <p className="text-body-sm break-words text-fg">“{e.reason}”</p> : null}
                {lines.length > 0 ? (
                  <ul className="mt-0.5 flex flex-col gap-0.5">
                    {lines.map((line, i) => (
                      <li key={i} className="text-caption break-words text-fg-secondary">
                        {line}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {maintenanceId && maintenanceCode && canOpenMaintenance ? (
                  <span>
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto px-0 text-caption"
                      onClick={() => onOpenMaintenance(maintenanceId)}
                      aria-label={`Abrir a manutenção ${maintenanceCode}`}
                    >
                      Abrir {maintenanceCode}
                    </Button>
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Checklists de origem
// ---------------------------------------------------------------------------

function ExecutionsTab({
  executions, onOpenTrace, onOpenChecklist,
}: {
  executions: PlanExecution[];
  onOpenTrace: (id: string) => void;
  onOpenChecklist: (id: string) => void;
}) {
  if (executions.length === 0) {
    return <EmptyState size="sm" variant="panel" title="Nenhum checklist de origem" />;
  }
  return (
    <ul className="flex flex-col gap-2" aria-label="Checklists de origem">
      {executions.map((x) => {
        const type = x.checklistType ? CHECKLIST_TYPE_LABEL[x.checklistType] ?? x.checklistType : null;
        return (
          <li
            key={x.id}
            className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3 sm:flex-row sm:items-center sm:justify-between"
            data-testid="plan-execution"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm">
                <span className="font-semibold tabular-nums text-fg">{formatDate(x.operationalDate)}</span>
                {type ? <Badge size="sm" variant="neutral">{type}</Badge> : null}
                {x.licensePlate ? <span className="tabular-nums text-fg-secondary">{x.licensePlate}</span> : null}
                <Badge size="sm" variant={x.nonConforming > 0 ? "warning" : "neutral"} appearance="outline">
                  {plural(x.nonConforming, "inconformidade", "inconformidades")}
                </Badge>
              </p>
              <p className="text-caption text-fg-secondary">
                {x.employeeName ?? "Colaborador não identificado"}
                {x.employeeCode ? ` · Matrícula ${x.employeeCode}` : ""}
                {x.submittedAt ? ` · enviado em ${formatDateTime(x.submittedAt)}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" leadingIcon={<Route />} onClick={() => onOpenTrace(x.id)} data-testid="plan-execution-trace">
                Ver rastro
              </Button>
              <Button size="sm" variant="ghost" leadingIcon={<ClipboardList />} onClick={() => onOpenChecklist(x.id)} data-testid="plan-execution-open">
                Abrir checklist
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
