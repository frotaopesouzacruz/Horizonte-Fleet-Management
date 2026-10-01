"use client";

import * as React from "react";
import {
  CheckCheck,
  CircleDashed,
  ClipboardCheck,
  ClipboardList,
  FileSearch,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeAppearance, type BadgeVariant } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { Skeleton, SkeletonGroup } from "@/components/feedback/skeleton";
import { ItemStatusBadge, PlanStatusBadge } from "@/components/action-plans/badges";
import { ExecutionDetailDrawer } from "@/app/(app)/aplicativos/check-list-frota/execution-detail-drawer";
import { loadExecutionTrace } from "@/lib/action-plans/actions";
import {
  CHECKLIST_TYPE_LABEL,
  QUALITY_LABEL,
  RESOLUTION_TYPE_LABEL,
  ROUTE_LABEL,
  formatDate,
  formatDateTime,
  formatInt,
} from "@/lib/action-plans/labels";
import type { ExecutionTrace } from "@/lib/action-plans/types";
import {
  FindingResolutionTag,
  MaintenanceStatusTag,
  answerLabel,
  checklistLoader,
  conditionalPairs,
  plural,
  previewChecklistLoader,
} from "./plan-dialogs";
import type { ActionPlanPerms, PanelActions, PreviewFixtures } from "./shared";

/**
 * Rastro de um checklist (§66): checklist → inconformidade → caminho →
 * apontamento → plano → manutenção → resolução, de ponta a ponta. Só leitura;
 * cada elo abre a própria gaveta (plano, manutenção, checklist completo).
 */

export interface TraceDrawerProps {
  executionId: string | null;
  onOpenChange: (open: boolean) => void;
  actions: PanelActions;
  fixtures?: PreviewFixtures;
  /**
   * Opcional: sem `maintenanceView`, o código da manutenção vira texto (a gaveta
   * oficial da Manutenção não abre para quem não pode vê-la).
   */
  perms?: Pick<ActionPlanPerms, "maintenanceView">;
}

export function TraceDrawer(props: TraceDrawerProps) {
  const { executionId, onOpenChange } = props;
  const [shownId, setShownId] = React.useState(executionId);
  if (executionId && executionId !== shownId) setShownId(executionId);

  return (
    <Drawer open={Boolean(executionId)} onOpenChange={onOpenChange}>
      <DrawerContent size="xl" data-testid="trace-drawer">
        {shownId ? <TraceInner key={shownId} {...props} executionId={shownId} /> : null}
      </DrawerContent>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Vocabulário local
// ---------------------------------------------------------------------------

type Route = NonNullable<ExecutionTrace["findings"][number]["route"]>;
type Finding = ExecutionTrace["findings"][number];
type TraceItem = Finding["items"][number];

const ROUTE_STYLE: Record<Route | "unknown", { variant: BadgeVariant; appearance: BadgeAppearance; icon: React.ReactNode }> = {
  maintenance: { variant: "primary", appearance: "soft", icon: <Wrench /> },
  damage: { variant: "neutral", appearance: "outline", icon: <ShieldAlert /> },
  not_eligible: { variant: "neutral", appearance: "soft", icon: <CircleDashed /> },
  conforming: { variant: "success", appearance: "soft", icon: <CheckCheck /> },
  not_submitted: { variant: "neutral", appearance: "soft", icon: <CircleDashed /> },
  unknown: { variant: "neutral", appearance: "outline", icon: <CircleDashed /> },
};

const ROUTE_HINT: Partial<Record<Route | "unknown", string>> = {
  damage:
    "Avaria segue o fluxo próprio de Sinistros/Avarias: não entra no Plano de Ação de Manutenção nem gera apontamento aqui.",
  not_eligible: "A pergunta está parametrizada para não gerar plano de ação.",
  conforming: "O checklist foi corrigido e a resposta passou a conforme.",
  not_submitted: "O checklist não foi enviado; nada é processado.",
  unknown: "Ainda não classificada pelo Plano de Ação: o recebimento do checklist está pendente.",
};

const INGESTION_LABEL: Record<string, string> = {
  pending: "Pendente",
  processed: "Processado",
  failed: "Falhou",
};

// ---------------------------------------------------------------------------
// Corpo
// ---------------------------------------------------------------------------

function TraceInner({ executionId, onOpenChange, actions, fixtures, perms }: TraceDrawerProps & { executionId: string }) {
  const preview = fixtures !== undefined;
  const [trace, setTrace] = React.useState<ExecutionTrace | null>(() => (preview ? fixtures?.traces?.[executionId] ?? null : null));
  const [error, setError] = React.useState<string | null>(() =>
    preview && !fixtures?.traces?.[executionId] ? "Checklist não encontrado nos dados da prévia." : null,
  );
  const [loading, startLoad] = React.useTransition();
  const [fullOpen, setFullOpen] = React.useState(false);
  const titleId = React.useId();
  const canOpenMaintenance = perms?.maintenanceView ?? true;

  const load = React.useCallback(() => {
    if (preview) return;
    startLoad(async () => {
      const result = await loadExecutionTrace(executionId);
      if (result.ok && result.data) {
        setTrace(result.data);
        setError(null);
      } else {
        setError(result.ok ? "Checklist não encontrado ou fora do seu acesso." : result.error ?? "Não foi possível carregar o checklist.");
      }
    });
  }, [executionId, preview]);

  React.useEffect(() => {
    load();
  }, [load]);

  // O plano abre na gaveta do plano, que fica por baixo desta: fecha o rastro
  // para que ela apareça.
  const openPlan = (planId: string) => {
    onOpenChange(false);
    actions.openPlan(planId);
  };

  if (!trace) {
    return (
      <>
        <DrawerHeader className="px-4 sm:px-5">
          <DrawerTitle>Rastro do checklist</DrawerTitle>
          <DrawerDescription>{error ? "Falha na leitura" : "Carregando…"}</DrawerDescription>
        </DrawerHeader>
        <DrawerBody className="px-4 sm:px-5" aria-busy={loading}>
          {error ? (
            <ErrorState
              title="Não foi possível carregar o rastro."
              description={error}
              onRetry={preview ? undefined : load}
              retryLabel="Tentar de novo"
              retrying={loading}
            />
          ) : (
            <SkeletonGroup label="Carregando o rastro…" className="flex flex-col gap-4">
              <Skeleton className="h-6 w-56" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </SkeletonGroup>
          )}
        </DrawerBody>
      </>
    );
  }

  const x = trace.execution;
  const type = x.checklistType ? CHECKLIST_TYPE_LABEL[x.checklistType] ?? x.checklistType : null;
  const subtitle = [formatDate(x.operationalDate), type, x.licensePlate, x.employeeName].filter(Boolean).join(" · ");

  return (
    <>
      <DrawerHeader className="gap-1 px-4 sm:px-5">
        <DrawerTitle>Rastro do checklist</DrawerTitle>
        <DrawerDescription>{subtitle}</DrawerDescription>
        <p className="text-caption text-fg-muted">
          Do checklist à resolução: cada inconformidade, o caminho que seguiu, o plano, a manutenção e a baixa.
        </p>
      </DrawerHeader>

      <DrawerBody className="flex flex-col gap-4 px-4 sm:px-5" aria-busy={loading}>
        {error ? (
          <Alert variant="danger">
            <AlertDescription>{error} O que aparece abaixo é a última leitura bem-sucedida.</AlertDescription>
          </Alert>
        ) : null}

        <section
          aria-labelledby={titleId}
          className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3 sm:p-4"
          data-testid="trace-checklist"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <StepIcon>
                <ClipboardCheck />
              </StepIcon>
              <h3 id={titleId} className="text-h4 font-semibold text-fg">
                Checklist
              </h3>
            </div>
            <Button
              size="sm"
              variant="outline"
              leadingIcon={<ClipboardList />}
              onClick={() => setFullOpen(true)}
              data-testid="trace-open-checklist"
            >
              Abrir checklist completo
            </Button>
          </div>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="Data operacional">{formatDate(x.operationalDate)}</Fact>
            <Fact label="Tipo">{type}</Fact>
            <Fact label="Placa">{x.licensePlate}</Fact>
            <Fact label="Colaborador">{x.employeeName}</Fact>
            <Fact label="Enviado em">{x.submittedAt ? formatDateTime(x.submittedAt) : null}</Fact>
            <Fact label="Inconformidades">{formatInt(x.nonConforming)}</Fact>
          </dl>
          <IngestionLine ingestion={trace.ingestion} />
        </section>

        {trace.findings.length === 0 ? (
          <EmptyState
            size="sm"
            variant="panel"
            icon={<FileSearch />}
            title="Sem inconformidades"
            description="Todas as respostas deste checklist foram conformes: nada seguiu para o Plano de Ação nem para Avarias."
          />
        ) : (
          <ol className="flex flex-col gap-3" aria-label="Inconformidades do checklist">
            {trace.findings.map((f) => (
              <FindingCard
                key={f.answerId}
                finding={f}
                canOpenMaintenance={canOpenMaintenance}
                onOpenPlan={openPlan}
                onOpenMaintenance={actions.openMaintenance}
              />
            ))}
          </ol>
        )}
      </DrawerBody>

      <ExecutionDetailDrawer
        executionId={fullOpen ? x.id : null}
        onOpenChange={(open) => {
          if (!open) setFullOpen(false);
        }}
        loader={preview ? previewChecklistLoader : checklistLoader}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Peças
// ---------------------------------------------------------------------------

function Fact({ label, children }: { label: string; children?: React.ReactNode }) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="text-body-sm break-words text-fg">{empty ? "—" : children}</dd>
    </div>
  );
}

function StepIcon({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full [&_svg]:size-3.5",
        muted ? "bg-neutral-soft text-neutral-soft-fg" : "bg-primary-soft text-primary-soft-fg",
      )}
    >
      {children}
    </span>
  );
}

function IngestionLine({ ingestion }: { ingestion: ExecutionTrace["ingestion"] }) {
  if (!ingestion) {
    return <p className="text-caption text-fg-muted">Recebimento pelo Plano de Ação: ainda não registrado.</p>;
  }
  if (ingestion.status === "failed") {
    return (
      <Alert variant="warning" data-testid="trace-ingestion-failed">
        <AlertTitle>Falha no recebimento pelo Plano de Ação</AlertTitle>
        <AlertDescription>
          {plural(ingestion.attempts, "tentativa", "tentativas")}
          {ingestion.lastError ? ` · ${ingestion.lastError}` : ""}. {QUALITY_LABEL.ingestion_failed?.hint ?? ""}
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <p className="text-caption text-fg-muted">
      Recebimento pelo Plano de Ação: {INGESTION_LABEL[ingestion.status] ?? ingestion.status}
      {ingestion.processedAt ? ` em ${formatDateTime(ingestion.processedAt)}` : ""}
    </p>
  );
}

function RouteBadge({ route }: { route: Finding["route"] }) {
  const key = route ?? "unknown";
  const style = ROUTE_STYLE[key] ?? ROUTE_STYLE.unknown;
  return (
    <Badge variant={style.variant} appearance={style.appearance} icon={style.icon} data-testid="trace-route">
      {route ? ROUTE_LABEL[route] ?? route : "Aguardando classificação"}
    </Badge>
  );
}

function FindingCard({
  finding: f, canOpenMaintenance, onOpenPlan, onOpenMaintenance,
}: {
  finding: Finding;
  canOpenMaintenance: boolean;
  onOpenPlan: (id: string) => void;
  onOpenMaintenance: (id: string) => void;
}) {
  const routeKey = f.route ?? "unknown";
  const damage = f.route === "damage";
  const pairs = conditionalPairs(f.conditionalValue);
  const hint =
    ROUTE_HINT[routeKey] ??
    (f.route === "maintenance" && f.items.length === 0 ? QUALITY_LABEL.finding_without_item?.hint ?? null : null);

  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-md border p-3 sm:p-4",
        // Avaria é outro fluxo: moldura tracejada e neutra, para não ser lida como pendência do plano.
        damage ? "border-dashed border-border-strong bg-surface-secondary" : "border-border bg-surface",
      )}
      data-testid="trace-finding"
      data-route={f.route ?? "unknown"}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-body-sm font-semibold text-fg">{f.question}</p>
        <RouteBadge route={f.route} />
      </div>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Fact label="Resposta">{answerLabel(f.answer)}</Fact>
        {pairs.map((p) => (
          <Fact key={p.label} label={p.label}>
            {p.value}
          </Fact>
        ))}
        {f.note ? (
          <div className="flex min-w-0 flex-col gap-0.5 sm:col-span-2">
            <dt className="text-caption text-fg-muted">Relato</dt>
            <dd className="text-body-sm break-words whitespace-pre-line text-fg">{f.note}</dd>
          </div>
        ) : null}
      </dl>
      {hint ? <p className={cn("text-caption", damage ? "text-fg-secondary" : "text-fg-muted")}>{hint}</p> : null}

      {f.items.length > 0 ? (
        <div className="flex flex-col gap-3">
          {f.items.map((item) => (
            <ItemChain
              key={item.itemId}
              item={item}
              canOpenMaintenance={canOpenMaintenance}
              onOpenPlan={onOpenPlan}
              onOpenMaintenance={onOpenMaintenance}
            />
          ))}
        </div>
      ) : null}
    </li>
  );
}

function ChainStep({
  icon, title, last, muted, children,
}: {
  icon: React.ReactNode;
  title: string;
  last?: boolean;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className={cn("relative flex gap-3", !last && "pb-3")}>
      <span className="relative flex w-7 shrink-0 justify-center">
        {!last ? <span aria-hidden className="absolute top-7 bottom-0 w-px bg-border" /> : null}
        <StepIcon muted={muted}>{icon}</StepIcon>
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 pt-1">
        <p className="text-caption font-medium text-fg-muted">{title}</p>
        {children}
      </div>
    </li>
  );
}

function ItemChain({
  item, canOpenMaintenance, onOpenPlan, onOpenMaintenance,
}: {
  item: TraceItem;
  canOpenMaintenance: boolean;
  onOpenPlan: (id: string) => void;
  onOpenMaintenance: (id: string) => void;
}) {
  const r = item.resolution;
  return (
    <ol
      className="flex flex-col rounded-md border border-border-subtle bg-surface-secondary p-3"
      aria-label={`Caminho do apontamento${item.optionLabel ? ` ${item.optionLabel}` : ""}`}
      data-testid="trace-item"
    >
      <ChainStep icon={<ClipboardCheck />} title="Apontamento">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm">
          <span className="text-fg">{item.optionLabel ?? "Sem opção específica"}</span>
          <ItemStatusBadge status={item.status} />
        </p>
      </ChainStep>
      <ChainStep icon={<ClipboardList />} title="Plano de ação">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm">
          <Button
            variant="link"
            size="sm"
            className="h-auto px-0 font-semibold tabular-nums"
            onClick={() => onOpenPlan(item.planId)}
            aria-label={`Abrir o plano ${item.planCode}`}
            data-testid="trace-open-plan"
          >
            {item.planCode}
          </Button>
          <PlanStatusBadge status={item.planStatus} />
        </p>
        <p className="text-caption break-words text-fg-secondary">{item.title}</p>
      </ChainStep>
      <ChainStep icon={<Wrench />} title="Manutenção" muted={item.maintenances.length === 0}>
        {item.maintenances.length === 0 ? (
          <p className="text-body-sm text-fg-muted">Nenhuma manutenção vinculada ao apontamento.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {item.maintenances.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm">
                {canOpenMaintenance ? (
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto px-0 font-semibold tabular-nums"
                    onClick={() => onOpenMaintenance(m.id)}
                    aria-label={`Abrir a manutenção ${m.code}`}
                    data-testid="trace-open-maintenance"
                  >
                    {m.code}
                  </Button>
                ) : (
                  <span className="font-semibold tabular-nums text-fg">{m.code}</span>
                )}
                <MaintenanceStatusTag status={m.status} />
                <FindingResolutionTag status={m.resolutionStatus} />
              </li>
            ))}
          </ul>
        )}
      </ChainStep>
      <ChainStep icon={<CheckCheck />} title="Resolução" last muted={!r}>
        {r ? (
          <>
            <p className="text-body-sm font-medium text-fg">{RESOLUTION_TYPE_LABEL[r.type] ?? r.type}</p>
            <p className="text-caption text-fg-secondary">
              {formatDateTime(r.at)}
              {r.by ? ` · ${r.by}` : ""}
            </p>
            {r.reason ? <p className="text-caption break-words text-fg-secondary">“{r.reason}”</p> : null}
          </>
        ) : (
          <p className="text-body-sm text-fg-muted">Em aberto.</p>
        )}
      </ChainStep>
    </ol>
  );
}
