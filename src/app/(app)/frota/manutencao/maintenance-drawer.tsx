"use client";

import * as React from "react";
import {
  Ban,
  CalendarClock,
  CalendarPlus,
  CalendarX,
  CheckCircle2,
  ChevronDown,
  Gauge,
  ListPlus,
  LogIn,
  Pencil,
  RefreshCw,
  RotateCcw,
  Trash2,
  Unlink,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer";
import { Button, IconButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { Skeleton, SkeletonGroup } from "@/components/feedback/skeleton";
import { useToast } from "@/components/feedback/toast";
import {
  CriticalityBadge,
  KmStatusBadge,
  MaintenanceStatusBadge,
  MaintenanceTypeBadge,
} from "@/components/maintenance/badges";
import {
  cancelMaintenance,
  loadMaintenanceDetail,
  markMaintenanceNotPerformed,
  removeMaintenanceItem,
  reopenMaintenance,
  reprocessMaintenanceKm,
  unlinkFinding,
  unscheduleMaintenance,
  type Result,
} from "@/lib/maintenance/actions";
import {
  CRITICALITY_LABEL,
  EVENT_LABEL,
  EVENT_SOURCE_LABEL,
  ITEM_RESULT_LABEL,
  ITEM_STATUS_LABEL,
  KM_SOURCE_LABEL,
  KM_STATUS_LABEL,
  OPEN_STATUSES,
  RESOLUTION_LABEL,
  STATUS_LABEL,
  formatDate,
  formatDateTime,
  formatHours,
  formatInt,
  formatKm,
  formatStamp,
  vehicleLabel,
  type Criticality,
  type ItemResult,
  type ItemStatus,
  type KmStatus,
  type MaintenanceCatalog,
  type MaintenanceDetail,
  type MaintenanceEvent,
  type MaintenanceFindingLink,
  type MaintenanceItemDetail,
  type MaintenanceStatus,
} from "@/lib/maintenance/types";
import {
  AddServicesDialog,
  CompleteDialog,
  EditDetailsDialog,
  EntryKmDialog,
  ReasonActionDialog,
  RescheduleDialog,
  ScheduleDialog,
  StartDialog,
  formatDuration,
  supplierDisplayName,
} from "./lifecycle-dialogs";
import type { MaintenancePerms } from "./shared";

/**
 * Gaveta de detalhe da manutenção.
 *
 * Mostra o registro como o banco o guarda — contexto histórico congelado, KM
 * resolvido, TMM calculado, trilha — e oferece só as ações que a máquina de
 * estados (`transitions`) e as permissões permitem. Cada botão chama uma
 * rotina do banco; depois de gravar, a gaveta relê o detalhe e avisa a tela.
 */

export interface MaintenanceDrawerProps {
  maintenanceId: string | null;
  onOpenChange: (open: boolean) => void;
  catalog: MaintenanceCatalog;
  perms: MaintenancePerms;
  onChanged: () => void;
  onOpenMaintenance: (id: string) => void;
}

export function MaintenanceDrawer(props: MaintenanceDrawerProps) {
  const { maintenanceId, onOpenChange } = props;
  // A última manutenção aberta continua na tela enquanto a gaveta desliza
  // para fora; o corpo remonta (estado novo) a cada id.
  const [shownId, setShownId] = React.useState(maintenanceId);
  if (maintenanceId && maintenanceId !== shownId) setShownId(maintenanceId);

  return (
    <Drawer open={Boolean(maintenanceId)} onOpenChange={onOpenChange}>
      <DrawerContent size="xl" data-testid="maintenance-drawer">
        {shownId ? <DrawerInner key={shownId} {...props} maintenanceId={shownId} /> : null}
      </DrawerContent>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Vocabulário local
// ---------------------------------------------------------------------------

const CONTEXT_SOURCE_LABEL: Record<string, string> = {
  fidelization: "Fidelização (BR na data)",
  allocation: "Alocação operacional",
  none: "Sem vínculo operacional na data",
};

const LINK_ORIGIN_LABEL: Record<string, string> = {
  opened_from_finding: "Abertura a partir do apontamento",
  manual: "Vínculo manual",
  auto: "Vínculo automático",
};

const ITEM_STATUS_TONE: Record<ItemStatus, StatusTone> = {
  pending: "pending",
  done: "success",
  not_done: "danger",
  cancelled: "neutral",
};

const RESULT_TONE: Record<string, StatusTone> = {
  pending: "pending",
  resolved: "success",
  partially_resolved: "warning",
  not_resolved: "danger",
};

type DialogState =
  | { kind: "schedule" }
  | { kind: "reschedule" }
  | { kind: "start" }
  | { kind: "complete" }
  | { kind: "entryKm" }
  | { kind: "addItems" }
  | { kind: "details" }
  | { kind: "unschedule" }
  | { kind: "cancel" }
  | { kind: "notPerformed" }
  | { kind: "reopen" }
  | { kind: "removeItem"; item: MaintenanceItemDetail }
  | { kind: "unlink"; finding: MaintenanceFindingLink };

/** O que a tela oferece: destino em `transitions` E permissão. Quem decide é o banco. */
function availableActions(d: MaintenanceDetail, p: MaintenancePerms) {
  const t = new Set<MaintenanceStatus>(d.transitions);
  const open = OPEN_STATUSES.includes(d.status);
  const reopenTarget: MaintenanceStatus = d.status === "completed" ? "in_progress" : "to_schedule";
  return {
    schedule: d.status === "to_schedule" && t.has("scheduled") && p.schedule,
    start: (d.status === "to_schedule" || d.status === "scheduled") && t.has("in_progress") && p.start,
    complete: d.status === "in_progress" && t.has("completed") && p.complete,
    // Reprogramar não é transição (não muda a situação): vale para agendada e em execução.
    reschedule: (d.status === "scheduled" || d.status === "in_progress") && p.reschedule,
    unschedule: d.status === "scheduled" && t.has("to_schedule") && p.reschedule,
    cancel: t.has("cancelled") && p.edit,
    notPerformed: t.has("not_performed") && p.edit,
    reopen: !open && t.has(reopenTarget) && p.reopen,
    entryKm: Boolean(d.entryDate) && (d.status === "in_progress" || d.status === "completed") && p.start,
    reprocessKm: Boolean(d.entryDate) && p.reprocess,
    addItems: open && p.create,
    editDetails: open && p.edit,
    removeItem: open && p.edit,
    unlink: p.edit,
  };
}

// ---------------------------------------------------------------------------
// Corpo
// ---------------------------------------------------------------------------

function DrawerInner({
  maintenanceId, catalog, perms, onChanged, onOpenMaintenance,
}: MaintenanceDrawerProps & { maintenanceId: string }) {
  const { toast } = useToast();
  const [detail, setDetail] = React.useState<MaintenanceDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, startLoad] = React.useTransition();
  const [reprocessing, startReprocess] = React.useTransition();
  const [dialog, setDialog] = React.useState<DialogState | null>(null);

  const load = React.useCallback(() => {
    startLoad(async () => {
      const result = await loadMaintenanceDetail(maintenanceId);
      if (result.ok && result.data) {
        setDetail(result.data);
        setError(null);
      } else {
        setError(result.ok ? "Manutenção não encontrada ou fora do seu acesso." : result.error ?? "Não foi possível carregar a manutenção.");
      }
    });
  }, [maintenanceId]);

  React.useEffect(() => {
    load();
  }, [load]);

  const handleSuccess = React.useCallback(
    (title: string, description?: React.ReactNode) => {
      toast({ title, description, variant: "success" });
      load();
      onChanged();
    },
    [toast, load, onChanged],
  );

  const runReason = React.useCallback(
    async (call: () => Promise<Result<unknown>>, success: string, fallback: string) => {
      const result = await call();
      if (result.ok) {
        handleSuccess(success);
        return true;
      }
      toast({ title: result.error ?? fallback, variant: "danger" });
      return false;
    },
    [handleSuccess, toast],
  );

  const reprocess = () => {
    if (!detail) return;
    startReprocess(async () => {
      const result = await reprocessMaintenanceKm(detail.id);
      if (result.ok) {
        const km = result.data;
        handleSuccess(
          "KM de entrada reprocessado.",
          km?.status ? `${formatKm(km.km)} · ${KM_STATUS_LABEL[km.status] ?? km.status}` : "Sem entrada registrada: nada a resolver.",
        );
      } else {
        toast({ title: result.error ?? "Não foi possível reprocessar o KM.", variant: "danger" });
      }
    });
  };

  if (!detail) {
    return (
      <>
        <DrawerHeader>
          <DrawerTitle>Manutenção</DrawerTitle>
          <DrawerDescription>{error ? "Falha na leitura" : "Carregando…"}</DrawerDescription>
        </DrawerHeader>
        <DrawerBody aria-busy={loading}>
          {error ? (
            <ErrorState
              title="Não foi possível carregar a manutenção."
              description={error}
              onRetry={load}
              retryLabel="Tentar de novo"
              retrying={loading}
            />
          ) : (
            <SkeletonGroup label="Carregando a manutenção…" className="flex flex-col gap-4">
              <Skeleton className="h-6 w-56" />
              <Skeleton className="h-4 w-80 max-w-full" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-32 w-full" />
            </SkeletonGroup>
          )}
        </DrawerBody>
      </>
    );
  }

  const can = availableActions(detail, perms);
  const close = () => setDialog(null);
  const dialogProps = { open: true, onOpenChange: (o: boolean) => (!o ? close() : undefined), detail, catalog, onSuccess: handleSuccess };

  return (
    <>
      <DrawerHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <DrawerTitle className="tabular-nums" data-testid="maintenance-drawer-code">{detail.code}</DrawerTitle>
          <MaintenanceStatusBadge status={detail.status} size="md" />
        </div>
        <DrawerDescription>
          <VehicleLine detail={detail} />
        </DrawerDescription>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-caption text-fg-secondary">
          <MaintenanceTypeBadge type={detail.type} name={detail.typeName} />
          <span className="inline-flex items-center gap-1.5">
            Prioridade <CriticalityBadge value={detail.priority} />
          </span>
          <span>Origem: <span className="font-medium text-fg">{detail.originName ?? "—"}</span></span>
        </div>
        <AlertBadges detail={detail} />
        <ActionBar
          detail={detail}
          can={can}
          busy={reprocessing}
          onAction={(kind) => (kind === "reprocessKm" ? reprocess() : setDialog({ kind } as DialogState))}
        />
      </DrawerHeader>

      <DrawerBody className="flex flex-col gap-4" aria-busy={loading || reprocessing}>
        {error ? (
          <Alert variant="danger">
            <AlertDescription>{error} O que aparece abaixo é a última leitura bem-sucedida.</AlertDescription>
          </Alert>
        ) : null}

        <ContextSection detail={detail} />
        <ScheduleSection detail={detail} catalog={catalog} />
        <KmSection
          detail={detail}
          canSet={can.entryKm}
          canReprocess={can.reprocessKm}
          reprocessing={reprocessing}
          onSet={() => setDialog({ kind: "entryKm" })}
          onReprocess={reprocess}
        />
        <ItemsSection
          detail={detail}
          canAdd={can.addItems}
          canRemove={can.removeItem}
          onAdd={() => setDialog({ kind: "addItems" })}
          onRemove={(item) => setDialog({ kind: "removeItem", item })}
        />
        <FindingsSection detail={detail} canUnlink={can.unlink} onUnlink={(finding) => setDialog({ kind: "unlink", finding })} />
        {detail.recurrence.length > 0 ? <RecurrenceSection detail={detail} onOpenMaintenance={onOpenMaintenance} /> : null}
        <TrailSection detail={detail} catalog={catalog} fullAudit={perms.viewAudit} />
      </DrawerBody>

      {dialog?.kind === "schedule" ? <ScheduleDialog {...dialogProps} /> : null}
      {dialog?.kind === "reschedule" ? <RescheduleDialog {...dialogProps} /> : null}
      {dialog?.kind === "start" ? <StartDialog {...dialogProps} /> : null}
      {dialog?.kind === "complete" ? <CompleteDialog {...dialogProps} /> : null}
      {dialog?.kind === "entryKm" ? <EntryKmDialog {...dialogProps} /> : null}
      {dialog?.kind === "addItems" ? <AddServicesDialog {...dialogProps} /> : null}
      {dialog?.kind === "details" ? <EditDetailsDialog {...dialogProps} /> : null}

      {dialog?.kind === "unschedule" ? (
        <ReasonActionDialog
          open
          onOpenChange={(o) => (!o ? close() : undefined)}
          title={`Desfazer agendamento · ${detail.code}`}
          description={`Volta para ${STATUS_LABEL.to_schedule} e limpa a data e a hora agendadas (${formatDateTime(detail.scheduledDate, detail.scheduledTime)}). O agendamento anterior fica na trilha.`}
          confirmLabel="Desfazer agendamento"
          onConfirm={(reason) =>
            runReason(() => unscheduleMaintenance(detail.id, reason), `Agendamento de ${detail.code} desfeito.`, "Não foi possível desfazer o agendamento.")
          }
        />
      ) : null}
      {dialog?.kind === "cancel" ? (
        <ReasonActionDialog
          open
          onOpenChange={(o) => (!o ? close() : undefined)}
          title={`Cancelar ${detail.code}`}
          description="Encerra a manutenção sem execução; os serviços pendentes são marcados como removidos. Pode ser reaberta depois, com justificativa."
          label="Motivo do cancelamento"
          confirmLabel="Cancelar manutenção"
          destructive
          onConfirm={(reason) =>
            runReason(() => cancelMaintenance(detail.id, reason), `${detail.code} cancelada.`, "Não foi possível cancelar a manutenção.")
          }
        />
      ) : null}
      {dialog?.kind === "notPerformed" ? (
        <ReasonActionDialog
          open
          onOpenChange={(o) => (!o ? close() : undefined)}
          title={`Registrar ${detail.code} como não realizada`}
          description="O veículo não compareceu ou o serviço não aconteceu. Encerra sem execução; pode ser reaberta depois, com justificativa."
          label="Motivo da não realização"
          confirmLabel="Marcar como não realizada"
          destructive
          onConfirm={(reason) =>
            runReason(
              () => markMaintenanceNotPerformed(detail.id, reason),
              `${detail.code} registrada como não realizada.`,
              "Não foi possível registrar a não realização.",
            )
          }
        />
      ) : null}
      {dialog?.kind === "reopen" ? (
        <ReasonActionDialog
          open
          onOpenChange={(o) => (!o ? close() : undefined)}
          title={`Reabrir ${detail.code}`}
          description={
            detail.status === "completed"
              ? `Volta para ${STATUS_LABEL.in_progress}: a saída real é limpa e os serviços voltam a pendentes.`
              : `Volta para ${STATUS_LABEL.to_schedule}, sem data agendada.`
          }
          warning={
            detail.status === "completed"
              ? "O histórico é preservado: a conclusão anterior continua na trilha. Os efeitos da conclusão são revertidos — o ciclo preventivo/preditivo que ela alimentou volta ao estado anterior e os apontamentos do Check List voltam a pendentes."
              : "O histórico é preservado: o encerramento anterior continua na trilha. Os serviços removidos pelo encerramento voltam a pendentes."
          }
          label="Justificativa da reabertura"
          minLength={10}
          confirmLabel="Reabrir manutenção"
          onConfirm={(reason) =>
            runReason(() => reopenMaintenance(detail.id, reason), `${detail.code} reaberta.`, "Não foi possível reabrir a manutenção.")
          }
          testId="maintenance-dialog-reopen"
        />
      ) : null}
      {dialog?.kind === "removeItem" ? (
        <ReasonActionDialog
          open
          onOpenChange={(o) => (!o ? close() : undefined)}
          title="Remover serviço"
          description={`${dialog.item.service} (${dialog.item.cluster}) sai de ${detail.code}. O item continua visível como removido e a remoção fica na trilha.`}
          label="Motivo da remoção"
          confirmLabel="Remover serviço"
          destructive
          onConfirm={(reason) =>
            runReason(() => removeMaintenanceItem(dialog.item.id, reason), `${dialog.item.service} removido de ${detail.code}.`, "Não foi possível remover o serviço.")
          }
        />
      ) : null}
      {dialog?.kind === "unlink" ? (
        <ReasonActionDialog
          open
          onOpenChange={(o) => (!o ? close() : undefined)}
          title="Desvincular apontamento"
          description={`“${dialog.finding.question ?? dialog.finding.questionKey}” deixa de ser tratado por ${detail.code}. O apontamento volta a ficar disponível para outra manutenção.`}
          confirmLabel="Desvincular"
          onConfirm={(reason) =>
            runReason(() => unlinkFinding(dialog.finding.id, reason), "Apontamento desvinculado.", "Não foi possível desvincular o apontamento.")
          }
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Cabeçalho e ações
// ---------------------------------------------------------------------------

function VehicleLine({ detail }: { detail: MaintenanceDetail }) {
  const v = detail.vehicle;
  const kind = [v.typeName, v.subcategoryName].filter(Boolean).join(" / ");
  const model = [v.makeName, v.modelName].filter(Boolean).join(" ");
  return (
    <span className="flex flex-wrap items-center gap-x-2">
      <span className="font-semibold text-fg">{vehicleLabel(detail.licensePlate ?? v.licensePlate, detail.fleetCode ?? v.fleetCode)}</span>
      {kind || model ? <span>{[kind, model].filter(Boolean).join(" · ")}</span> : null}
    </span>
  );
}

function AlertBadges({ detail }: { detail: MaintenanceDetail }) {
  const badges: React.ReactNode[] = [];
  if (detail.lateEntry) {
    badges.push(<StatusBadge key="late" status="warning" withIcon>Entrada atrasada</StatusBadge>);
  }
  if (detail.exitOverdue) {
    badges.push(<StatusBadge key="exit" status="danger" withIcon>Saída vencida</StatusBadge>);
  }
  if (detail.reopenCount > 0) {
    badges.push(
      <Badge key="reopen" variant="info" icon={<RotateCcw />}>
        Reaberta {detail.reopenCount}×
      </Badge>,
    );
  }
  if (detail.vehicle.status !== "active") {
    badges.push(<Badge key="inactive" variant="neutral">Frota inativa</Badge>);
  }
  if (detail.entryKmStatus === "divergent") {
    badges.push(<StatusBadge key="km" status="danger">KM divergente</StatusBadge>);
  }
  if (badges.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Alertas" data-testid="maintenance-drawer-alerts">
      {badges}
    </div>
  );
}

type ActionKind =
  | "schedule" | "reschedule" | "start" | "complete" | "entryKm" | "reprocessKm" | "addItems" | "details"
  | "unschedule" | "cancel" | "notPerformed" | "reopen";

interface ActionDef {
  kind: ActionKind;
  label: string;
  icon: React.ReactNode;
  destructive?: boolean;
}

function ActionBar({
  detail, can, busy, onAction,
}: {
  detail: MaintenanceDetail;
  can: ReturnType<typeof availableActions>;
  busy: boolean;
  onAction: (kind: ActionKind) => void;
}) {
  const defs: Record<ActionKind, ActionDef> = {
    schedule: { kind: "schedule", label: "Agendar", icon: <CalendarPlus /> },
    start: { kind: "start", label: "Registrar entrada", icon: <LogIn /> },
    complete: { kind: "complete", label: "Concluir", icon: <CheckCircle2 /> },
    reschedule: { kind: "reschedule", label: "Reprogramar", icon: <CalendarClock /> },
    unschedule: { kind: "unschedule", label: "Desfazer agendamento", icon: <CalendarX /> },
    reopen: { kind: "reopen", label: "Reabrir", icon: <RotateCcw /> },
    addItems: { kind: "addItems", label: "Adicionar serviços", icon: <ListPlus /> },
    details: { kind: "details", label: "Editar dados", icon: <Pencil /> },
    entryKm: { kind: "entryKm", label: "KM de entrada", icon: <Gauge /> },
    reprocessKm: { kind: "reprocessKm", label: "Reprocessar KM", icon: <RefreshCw /> },
    cancel: { kind: "cancel", label: "Cancelar manutenção", icon: <XCircle />, destructive: true },
    notPerformed: { kind: "notPerformed", label: "Não realizada", icon: <Ban />, destructive: true },
  };
  const allowed: Record<ActionKind, boolean> = {
    schedule: can.schedule,
    start: can.start,
    complete: can.complete,
    reschedule: can.reschedule,
    unschedule: can.unschedule,
    reopen: can.reopen,
    addItems: can.addItems,
    details: can.editDetails,
    entryKm: can.entryKm,
    reprocessKm: can.reprocessKm,
    cancel: can.cancel,
    notPerformed: can.notPerformed,
  };

  // O botão principal é o próximo passo natural da situação atual.
  const primaryOrder: Record<MaintenanceStatus, ActionKind[]> = {
    to_schedule: ["schedule", "start"],
    scheduled: ["start", "reschedule"],
    in_progress: ["complete", "reschedule"],
    completed: ["reopen"],
    cancelled: ["reopen"],
    not_performed: ["reopen"],
  };
  const primary = primaryOrder[detail.status].filter((k) => allowed[k]);
  const menuMain: ActionKind[] = ["unschedule", "addItems", "details", "entryKm", "reprocessKm"];
  const menuDanger: ActionKind[] = ["cancel", "notPerformed"];
  const more = menuMain.filter((k) => allowed[k] && !primary.includes(k));
  const danger = menuDanger.filter((k) => allowed[k]);

  if (primary.length === 0 && more.length === 0 && danger.length === 0) {
    return (
      <p className="text-caption text-fg-muted" data-testid="maintenance-drawer-actions">
        Nenhuma ação disponível para o seu perfil nesta situação.
      </p>
    );
  }

  return (
    <div role="group" aria-label="Ações da manutenção" className="flex flex-wrap items-center gap-2 pt-1" data-testid="maintenance-drawer-actions">
      {primary.map((kind, index) => (
        <Button
          key={kind}
          size="sm"
          variant={index === 0 ? "primary" : "outline"}
          leadingIcon={defs[kind].icon}
          onClick={() => onAction(kind)}
          data-testid={`maintenance-action-${kind}`}
        >
          {defs[kind].label}
        </Button>
      ))}
      {more.length > 0 || danger.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" trailingIcon={<ChevronDown />} loading={busy} data-testid="maintenance-action-more">
              Mais ações
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            <DropdownMenuLabel>{detail.code}</DropdownMenuLabel>
            {more.map((kind) => (
              <DropdownMenuItem key={kind} onSelect={() => onAction(kind)} data-testid={`maintenance-action-${kind}`}>
                {defs[kind].icon}
                {defs[kind].label}
              </DropdownMenuItem>
            ))}
            {danger.length > 0 ? (
              <>
                {more.length > 0 ? <DropdownMenuSeparator /> : null}
                {danger.map((kind) => (
                  <DropdownMenuItem key={kind} destructive onSelect={() => onAction(kind)} data-testid={`maintenance-action-${kind}`}>
                    {defs[kind].icon}
                    {defs[kind].label}
                  </DropdownMenuItem>
                ))}
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Seções
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

function Fact({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", wide && "sm:col-span-2 lg:col-span-3")}>
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="text-body-sm break-words text-fg">{children ?? "—"}</dd>
    </div>
  );
}

const Facts = ({ children }: { children: React.ReactNode }) => (
  <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</dl>
);

function ContextSection({ detail }: { detail: MaintenanceDetail }) {
  const city = detail.cityName ? `${detail.cityName}${detail.stateUf ? `/${detail.stateUf}` : ""}` : detail.stateUf;
  return (
    <Section
      title="Contexto operacional histórico"
      description="Onde o veículo estava NA DATA da manutenção (entrada real ou, antes dela, a solicitação). Fica preservado: mudanças posteriores de fidelização ou alocação não reescrevem este registro."
      testId="maintenance-drawer-context"
    >
      <Facts>
        <Fact label="Operação">{detail.operationName}</Fact>
        <Fact label="Cidade/UF">{city}</Fact>
        <Fact label="BR">{detail.brCode}</Fact>
        <Fact label="Liderança na data">{detail.leaderName}</Fact>
        <Fact label="Filial">{detail.unitName}</Fact>
        <Fact label="Data do contexto">{formatDate(detail.contextDate)}</Fact>
        <Fact label="Fonte do contexto">{detail.contextSource ? CONTEXT_SOURCE_LABEL[detail.contextSource] ?? detail.contextSource : null}</Fact>
      </Facts>
      {detail.contextSource === "none" ? (
        <p className="text-caption text-fg-muted">
          Na data, o veículo não tinha fidelização nem alocação registradas; a manutenção fica sem operação atribuída.
        </p>
      ) : null}
    </Section>
  );
}

function ScheduleSection({ detail, catalog }: { detail: MaintenanceDetail; catalog: MaintenanceCatalog }) {
  const open = OPEN_STATUSES.includes(detail.status);
  const supplier =
    detail.supplierName ??
    (detail.supplierId
      ? supplierDisplayName(catalog, detail.supplierId)
      : detail.supplierNameInformed
        ? `${detail.supplierNameInformed} (informado na importação, fora do catálogo)`
        : null);
  return (
    <Section title="Programação e execução" testId="maintenance-drawer-schedule">
      <Facts>
        <Fact label="Solicitação">{formatDate(detail.requestedOn)}</Fact>
        <Fact label="Agendamento">{formatDateTime(detail.scheduledDate, detail.scheduledTime)}</Fact>
        <Fact label="Previsão de saída">
          {formatDateTime(detail.expectedExitDate, detail.expectedExitTime)}
          {detail.exitOverdue ? <span className="text-danger-soft-fg"> · vencida</span> : null}
        </Fact>
        <Fact label="Entrada real">
          {formatDateTime(detail.entryDate, detail.entryTime)}
          {detail.lateEntry ? <span className="text-warning-soft-fg"> · atrasada em relação ao agendamento</span> : null}
        </Fact>
        <Fact label="Saída real">{formatDateTime(detail.exitDate, detail.exitTime)}</Fact>
        <Fact label="TMM (entrada → saída)">
          {detail.durationHours != null ? (
            <span className="tabular-nums" title={detail.durationPrecision === "date" ? "Calculado por dias de calendário: falta a hora de entrada ou de saída." : "Calculado em horas exatas."}>
              {formatDuration(detail.durationHours, detail.durationPrecision)}
              {detail.durationPrecision === "date" ? <span className="text-fg-muted"> (por data)</span> : null}
            </span>
          ) : detail.status === "in_progress" ? (
            <span className="text-fg-muted">Calculado pelo servidor na conclusão</span>
          ) : null}
        </Fact>
        {open && detail.ageDays != null ? <Fact label="Em aberto há">{formatInt(detail.ageDays)} dia(s)</Fact> : null}
        <Fact label="Fornecedor">{supplier}</Fact>
        <Fact label="Ordem de serviço (OS)">{detail.serviceOrderNumber}</Fact>
        {detail.description ? <Fact label="Descrição" wide>{detail.description}</Fact> : null}
        {detail.notes ? <Fact label="Observações" wide>{detail.notes}</Fact> : null}
        {detail.schedulingNotes ? <Fact label="Observações do agendamento" wide>{detail.schedulingNotes}</Fact> : null}
        {detail.completionNotes ? <Fact label="Observações de conclusão" wide>{detail.completionNotes}</Fact> : null}
      </Facts>
      {detail.duplicateJustification ? (
        <Alert variant="warning">
          <AlertDescription>
            Aberta com outra manutenção equivalente em aberto. Justificativa: “{detail.duplicateJustification}”
          </AlertDescription>
        </Alert>
      ) : null}
    </Section>
  );
}

function KmSection({
  detail, canSet, canReprocess, reprocessing, onSet, onReprocess,
}: {
  detail: MaintenanceDetail;
  canSet: boolean;
  canReprocess: boolean;
  reprocessing: boolean;
  onSet: () => void;
  onReprocess: () => void;
}) {
  const current = (
    <Fact label="KM atual do veículo">
      {formatKm(detail.currentKm)}
      {detail.currentKmDate ? <span className="text-fg-muted"> · leitura de {formatDate(detail.currentKmDate)}</span> : null}
    </Fact>
  );
  const difference = detail.entryKmDifference;
  return (
    <Section
      title="KM"
      description="O KM de entrada vem das leituras oficiais da data de entrada; informado à mão, exige justificativa e é conferido com a base."
      testId="maintenance-drawer-km"
      action={
        <>
          {canSet ? (
            <Button size="sm" variant="outline" leadingIcon={<Gauge />} onClick={onSet} data-testid="maintenance-km-set">
              Informar KM
            </Button>
          ) : null}
          {canReprocess ? (
            <Button size="sm" variant="ghost" leadingIcon={<RefreshCw />} onClick={onReprocess} loading={reprocessing} data-testid="maintenance-km-reprocess">
              Reprocessar
            </Button>
          ) : null}
        </>
      }
    >
      {detail.entryDate ? (
        <Facts>
          <Fact label="KM de entrada"><span className="tabular-nums">{formatKm(detail.entryKm)}</span></Fact>
          <Fact label="Situação do KM"><KmStatusBadge status={detail.entryKmStatus} /></Fact>
          <Fact label="Fonte">{detail.entryKmSource ? KM_SOURCE_LABEL[detail.entryKmSource] ?? detail.entryKmSource : null}</Fact>
          <Fact label="Leitura oficial"><span className="tabular-nums">{formatKm(detail.entryKmOfficial)}</span></Fact>
          <Fact label="Diferença para o oficial">
            {difference != null ? <span className="tabular-nums">{difference > 0 ? "+" : ""}{formatInt(difference)} km</span> : null}
          </Fact>
          <Fact label="Data de referência">{formatDate(detail.entryKmReferenceDate ?? detail.entryDate)}</Fact>
          {current}
          {detail.entryKmJustification ? <Fact label="Justificativa do KM manual" wide>{detail.entryKmJustification}</Fact> : null}
        </Facts>
      ) : (
        <>
          <p className="text-body-sm text-fg-secondary">
            Sem entrada registrada. O KM de entrada é resolvido automaticamente quando o veículo entra na oficina.
          </p>
          <Facts>{current}</Facts>
        </>
      )}
      {detail.entryKmStatus === "divergent" ? (
        <Alert variant="warning">
          <AlertDescription>
            KM divergente das leituras oficiais vizinhas. Não bloqueia a manutenção; fica sinalizado para revisão.
          </AlertDescription>
        </Alert>
      ) : null}
    </Section>
  );
}

function ItemsSection({
  detail, canAdd, canRemove, onAdd, onRemove,
}: {
  detail: MaintenanceDetail;
  canAdd: boolean;
  canRemove: boolean;
  onAdd: () => void;
  onRemove: (item: MaintenanceItemDetail) => void;
}) {
  const active = detail.itemsAll.filter((i) => i.status !== "cancelled").length;
  return (
    <Section
      title={`Serviços (${active})`}
      description="Cada serviço é um item da manutenção, com a própria situação e resultado."
      testId="maintenance-drawer-items"
      action={
        canAdd ? (
          <Button size="sm" variant="outline" leadingIcon={<ListPlus />} onClick={onAdd} data-testid="maintenance-items-add">
            Adicionar serviços
          </Button>
        ) : null
      }
    >
      {detail.itemsAll.length === 0 ? (
        <EmptyState size="sm" title="Nenhum serviço" description="Esta manutenção ainda não tem serviços. Adicione ao menos um antes de concluir." />
      ) : (
        <TableContainer tabIndex={0}>
          <Table layout="fixed" style={{ minWidth: canRemove ? 684 : 640 }}>
            <TableHeader>
              <TableRow>
                <TableHead style={{ width: 230 }}>Serviço · cluster</TableHead>
                <TableHead style={{ width: 100 }}>Criticidade</TableHead>
                <TableHead style={{ width: 120 }}>Situação</TableHead>
                <TableHead>Resultado e nota</TableHead>
                {canRemove ? <TableHead style={{ width: 44 }}><span className="sr-only">Ações</span></TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.itemsAll.map((item) => {
                const removed = item.status === "cancelled";
                return (
                  <TableRow key={item.id} className={cn("h-auto", removed && "text-fg-muted")} data-testid="maintenance-item-row">
                    <TableCell className="py-2">
                      <span className={cn("block truncate font-medium", removed ? "line-through" : "text-fg")} title={item.service}>
                        {item.service}
                      </span>
                      <span className="block truncate text-caption text-fg-muted" title={item.cluster}>
                        {item.cluster}
                        {item.expectedHours != null ? ` · previsão ${formatHours(item.expectedHours)}` : ""}
                      </span>
                    </TableCell>
                    <TableCell><CriticalityBadge value={item.criticality as Criticality} /></TableCell>
                    <TableCell>
                      <StatusBadge status={ITEM_STATUS_TONE[item.status] ?? "neutral"} size="sm">
                        {ITEM_STATUS_LABEL[item.status] ?? item.status}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="py-2">
                      {item.result ? (
                        <StatusBadge status={RESULT_TONE[item.result] ?? "neutral"} size="sm">
                          {ITEM_RESULT_LABEL[item.result as ItemResult] ?? item.result}
                        </StatusBadge>
                      ) : (
                        <span className="text-fg-muted">—</span>
                      )}
                      {item.notes ? <span className="mt-0.5 block text-caption break-words text-fg-secondary">{item.notes}</span> : null}
                    </TableCell>
                    {canRemove ? (
                      <TableCell className="px-1">
                        {item.status === "pending" ? (
                          <IconButton
                            size="sm"
                            variant="danger"
                            label={active <= 1 ? "A manutenção precisa de ao menos um serviço" : `Remover ${item.service}`}
                            disabled={active <= 1}
                            onClick={() => onRemove(item)}
                          >
                            <Trash2 aria-hidden />
                          </IconButton>
                        ) : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Section>
  );
}

function FindingsSection({
  detail, canUnlink, onUnlink,
}: {
  detail: MaintenanceDetail;
  canUnlink: boolean;
  onUnlink: (finding: MaintenanceFindingLink) => void;
}) {
  return (
    <Section
      title={`Apontamentos do Check List (${detail.findings.length})`}
      description="Inconformidades do Check List que esta manutenção trata. A conclusão resolve o que um serviço mapeado executou."
      testId="maintenance-drawer-findings"
    >
      {detail.findings.length === 0 ? (
        <EmptyState size="sm" title="Nenhum apontamento vinculado" description="A manutenção não foi aberta a partir do Check List e nenhum apontamento foi vinculado a ela." />
      ) : (
        <ul className="flex flex-col gap-2">
          {detail.findings.map((f) => (
            <li key={f.id} className="flex flex-col gap-1.5 rounded-md border border-border p-3" data-testid="maintenance-finding">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 flex-1 text-body-sm font-medium text-fg">{f.question ?? f.questionKey}</p>
                <StatusBadge status={RESULT_TONE[f.resolutionStatus] ?? "neutral"} size="sm">
                  {RESOLUTION_LABEL[f.resolutionStatus] ?? f.resolutionStatus}
                </StatusBadge>
              </div>
              <p className="text-caption text-fg-secondary">
                Check List de {formatDate(f.checklistDate)} · Resposta: {f.answer ?? "—"}
                {f.note ? ` · Nota: ${f.note}` : ""}
              </p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-caption text-fg-muted">
                  {LINK_ORIGIN_LABEL[f.linkOrigin] ?? f.linkOrigin}
                  {f.resolvedAt ? ` · tratado em ${formatStamp(f.resolvedAt)}` : ""}
                </p>
                {canUnlink && f.resolutionStatus === "pending" ? (
                  <Button size="sm" variant="ghost" leadingIcon={<Unlink />} onClick={() => onUnlink(f)}>
                    Desvincular
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function RecurrenceSection({ detail, onOpenMaintenance }: { detail: MaintenanceDetail; onOpenMaintenance: (id: string) => void }) {
  return (
    <Section
      title="Possível reincidência"
      description={`Outra manutenção do mesmo veículo no mesmo cluster dentro da janela de ${detail.recurrenceWindowDays} dias.`}
      testId="maintenance-drawer-recurrence"
    >
      <ul className="flex flex-col gap-2">
        {detail.recurrence.map((r) => (
          <li key={`${r.previousId}-${r.cluster}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm">
            <StatusBadge status="warning" size="sm">Mesmo cluster em {formatInt(r.daysBetween)} dia(s)</StatusBadge>
            <span className="text-fg">{r.cluster}</span>
            {r.sameService ? <Badge variant="danger" size="sm">Mesmo serviço</Badge> : null}
            <span className="text-fg-muted">· anterior:</span>
            <Button variant="link" size="sm" onClick={() => onOpenMaintenance(r.previousId)} data-testid="maintenance-recurrence-open">
              {r.previousCode ?? "abrir manutenção anterior"}
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Trilha
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;
const asObj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const asStr = (v: unknown): string | null => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);
const asNum = (v: unknown): number | null => (typeof v === "number" ? v : typeof v === "string" && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null);
const asList = (v: unknown): Json[] => (Array.isArray(v) ? v.map(asObj).filter((x): x is Json => Boolean(x)) : []);
const kmStatusText = (v: unknown) => {
  const s = asStr(v);
  return s ? KM_STATUS_LABEL[s as KmStatus] ?? s : "—";
};

interface FieldDef {
  key: string;
  label: string;
  format: (v: unknown) => string;
}

function diffLines(before: Json | null, after: Json | null, fields: FieldDef[]): string[] {
  if (!before && !after) return [];
  const lines: string[] = [];
  for (const f of fields) {
    const a = before?.[f.key] ?? null;
    const b = after?.[f.key] ?? null;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    lines.push(`${f.label}: ${f.format(a)} → ${f.format(b)}`);
  }
  return lines;
}

function eventDetails(e: MaintenanceEvent, catalog: MaintenanceCatalog): string[] {
  const p = e.payload ?? {};
  const before = asObj(p.before);
  const after = asObj(p.after);
  const supplier = (v: unknown) => supplierDisplayName(catalog, asStr(v));
  const date = (v: unknown) => formatDate(asStr(v));
  const time = (v: unknown) => asStr(v)?.slice(0, 5) ?? "—";
  const text = (v: unknown) => asStr(v) ?? "—";
  const services = (v: unknown) => asList(v).map((i) => asStr(i.service)).filter(Boolean).join(", ");

  switch (e.type) {
    case "rescheduled":
      return diffLines(before, after, [
        { key: "scheduledDate", label: "Data agendada", format: date },
        { key: "scheduledTime", label: "Hora agendada", format: time },
        { key: "expectedExitDate", label: "Previsão de saída", format: date },
        { key: "expectedExitTime", label: "Hora prevista de saída", format: time },
        { key: "supplierId", label: "Fornecedor", format: supplier },
      ]);
    case "supplier_changed":
      return [`Fornecedor: ${supplier(p.before)} → ${supplier(p.after)}`];
    case "unscheduled":
      return before ? [`Agendamento desfeito: ${formatDateTime(asStr(before.scheduledDate), asStr(before.scheduledTime))}`] : [];
    case "scheduled":
      return [
        `Agendada para ${formatDateTime(asStr(p.scheduledDate), asStr(p.scheduledTime))}`,
        asStr(p.expectedExitDate) ? `Previsão de saída: ${date(p.expectedExitDate)}` : "",
        asStr(p.supplierId) ? `Fornecedor: ${supplier(p.supplierId)}` : "",
        asStr(p.serviceOrderNumber) ? `OS: ${text(p.serviceOrderNumber)}` : "",
      ].filter(Boolean);
    case "started": {
      const km = asObj(p.entryKm);
      return [
        `Entrada real: ${formatDateTime(asStr(p.entryDate), asStr(p.entryTime))}`,
        km ? `KM de entrada: ${formatKm(asNum(km.km))} (${kmStatusText(km.status)})` : "",
        asStr(p.supplierId) ? `Fornecedor: ${supplier(p.supplierId)}` : "",
        p.contextChanged === true ? "Contexto operacional atualizado para a data de entrada." : "",
      ].filter(Boolean);
    }
    case "completed": {
      const items = asList(p.items).map((i) => {
        const status = asStr(i.status);
        const result = asStr(i.result);
        return `${text(i.service)}: ${status ? ITEM_STATUS_LABEL[status as ItemStatus] ?? status : "—"}${result ? ` (${ITEM_RESULT_LABEL[result as ItemResult] ?? result})` : ""}`;
      });
      const hours = asNum(p.durationHours);
      return [
        `Saída real: ${formatDateTime(asStr(p.exitDate), asStr(p.exitTime))}`,
        hours != null ? `TMM gravado: ${formatHours(hours)}` : "",
        ...items,
      ].filter(Boolean);
    }
    case "km_changed":
      return before || after
        ? [`KM: ${formatKm(asNum(before?.km))} (${kmStatusText(before?.status)}) → ${formatKm(asNum(after?.km))} (${kmStatusText(after?.status)})`]
        : [];
    case "details_updated":
      return diffLines(before, after, [
        { key: "priority", label: "Prioridade", format: (v) => (asStr(v) ? CRITICALITY_LABEL[asStr(v) as Criticality] ?? text(v) : "—") },
        { key: "originId", label: "Origem", format: (v) => catalog.origins.find((o) => o.id === asStr(v))?.name ?? (asStr(v) ? "Origem fora do catálogo" : "—") },
        { key: "description", label: "Descrição", format: text },
        { key: "notes", label: "Observações", format: text },
        { key: "schedulingNotes", label: "Observações do agendamento", format: text },
        { key: "serviceOrderNumber", label: "OS", format: text },
      ]);
    case "items_added": {
      const names = services(p.items);
      return names ? [`Serviços: ${names}`] : [];
    }
    case "item_removed":
      return asStr(p.service) ? [`Serviço: ${text(p.service)}${asStr(p.cluster) ? ` (${text(p.cluster)})` : ""}`] : [];
    case "reopened":
      return asStr(p.previousExitDate)
        ? [`Saída anterior: ${formatDateTime(asStr(p.previousExitDate), asStr(p.previousExitTime))} — preservada na trilha.`]
        : [];
    case "created": {
      const names = services(p.items);
      return [
        names ? `Serviços: ${names}` : "",
        asStr(p.scheduledDate) ? `Agendada para ${date(p.scheduledDate)}` : "",
        asStr(p.entryDate) ? `Entrada real: ${date(p.entryDate)}` : "",
      ].filter(Boolean);
    }
    case "finding_linked": {
      const n = Array.isArray(p.answers) ? p.answers.length : 0;
      return n ? [`${n} apontamento(s) do Check List`] : [];
    }
    case "finding_resolved": {
      const n = Array.isArray(p.findings) ? p.findings.length : 0;
      return n ? [`${n} apontamento(s) tratado(s) pela conclusão`] : [];
    }
    default:
      return [];
  }
}

function eventAuthor(e: MaintenanceEvent): string {
  if (e.source === "user") return e.actor ?? "Usuário";
  const source = EVENT_SOURCE_LABEL[e.source] ?? e.source;
  return e.actor ? `${source} (${e.actor})` : source;
}

function TrailSection({ detail, catalog, fullAudit }: { detail: MaintenanceDetail; catalog: MaintenanceCatalog; fullAudit: boolean }) {
  const events = detail.events;
  return (
    <Section
      title="Trilha"
      description={
        fullAudit
          ? "Tudo o que aconteceu com esta manutenção, em ordem cronológica. Nada é apagado: reprogramações e reaberturas ficam com o antes e o depois."
          : "Linha do tempo resumida. Motivos e valores anteriores e novos exigem a permissão de auditoria da Manutenção."
      }
      testId="maintenance-drawer-trail"
    >
      {events.length === 0 ? (
        <p className="text-body-sm text-fg-muted">Sem eventos registrados.</p>
      ) : (
        <ol className="flex flex-col">
          {events.map((e, index) => {
            const lines = fullAudit ? eventDetails(e, catalog) : [];
            const last = index === events.length - 1;
            return (
              <li key={e.id} className={cn("relative flex gap-3", !last && "pb-4")} data-testid="maintenance-event">
                <span aria-hidden className="relative flex w-3 shrink-0 justify-center">
                  {!last ? <span className="absolute top-3 -bottom-1 w-px bg-border" /> : null}
                  <span className="relative mt-1.5 size-2.5 rounded-full border-2 border-surface bg-primary" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-body-sm font-semibold text-fg">{EVENT_LABEL[e.type] ?? e.type}</span>
                    {fullAudit && e.toStatus && e.fromStatus !== e.toStatus ? (
                      <span className="text-caption text-fg-secondary">
                        {e.fromStatus ? `${STATUS_LABEL[e.fromStatus] ?? e.fromStatus} → ` : "→ "}
                        {STATUS_LABEL[e.toStatus] ?? e.toStatus}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-caption text-fg-muted">
                    {eventAuthor(e)} · <time dateTime={e.occurredAt}>{formatStamp(e.occurredAt)}</time>
                  </p>
                  {fullAudit && e.reason ? <p className="text-body-sm text-fg">“{e.reason}”</p> : null}
                  {lines.length > 0 ? (
                    <ul className="mt-0.5 flex flex-col gap-0.5">
                      {lines.map((line, i) => (
                        <li key={i} className="text-caption break-words text-fg-secondary">
                          {line}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}
