"use client";

import * as React from "react";
import {
  Activity, CheckCircle2, ChevronDown, ChevronRight, Clock, Download, FileUp, History, Inbox, RefreshCw, RotateCcw,
  ShieldCheck, Sparkles, TriangleAlert, Upload, Wrench, XCircle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { KpiCard, type KpiStatus } from "@/components/ui/kpi-card";
import { DateInput } from "@/components/ui/date-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { useToast } from "@/components/feedback/toast";
import { ChartCard, ColumnChart, SrTable, chartFormat, type ColumnDatum } from "@/components/charts";
import type { CellValue } from "@/lib/admin/qlp";
import { readImportFile } from "@/lib/import/client";
import {
  importFollowup, reprocessActionPlans, runQualityFix, type FollowupInputRow,
} from "@/lib/action-plans/actions";
import {
  EVENT_LABEL, formatDate, formatDateTime, formatInt, PLAN_STATUS_LABEL, QUALITY_CLASS_LABEL, QUALITY_LABEL, REASON_LABEL,
  REASONS, SOURCE_LABEL,
} from "@/lib/action-plans/labels";
import type { FollowupResult, FollowupRow, HealthData, PlanStatus, QualityCheck, QualityData } from "@/lib/action-plans/types";
import type { ActionPlanPerms, ActionPlansViewData, PanelActions } from "./shared";

/**
 * Qualidade & Auditoria (§57–§58), Saúde da integração (§59) e Importação de
 * follow-up — três seções numa aba, a seção na URL (`secao`).
 *
 * Nada é decidido aqui. As verificações, a classe de cada uma (segura,
 * revisão, bloqueada) e os indicadores da integração vêm prontos do banco; a
 * correção automática, o reprocessamento e a importação são rotinas do banco
 * que conferem permissão e escopo e deixam trilha. A tela apresenta, pede
 * confirmação e mostra o que a rotina respondeu.
 */

export interface QualityPanelProps {
  quality: NonNullable<ActionPlansViewData["quality"]>;
  perms: ActionPlanPerms;
  actions: PanelActions;
}

type Section = "qualidade" | "saude" | "importacao";

const SECTION_LABEL: Record<Section, string> = {
  qualidade: "Qualidade & Auditoria",
  saude: "Saúde da integração",
  importacao: "Importação & Follow-up",
};

export function QualityPanel({ quality, perms, actions }: QualityPanelProps) {
  const sections: Section[] = perms.import ? ["qualidade", "saude", "importacao"] : ["qualidade", "saude"];
  const section: Section = sections.includes(quality.section) ? quality.section : "qualidade";

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="action-plans-quality">
      <Tabs
        appearance="segmented"
        value={section}
        activationMode="manual"
        onValueChange={(value) => actions.navigate({ secao: value === "qualidade" ? null : value })}
      >
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList aria-label="Seções de qualidade e integração" className="w-max">
            {sections.map((s) => (
              <TabsTrigger key={s} value={s} data-testid={`action-plans-quality-section-${s}`}>
                {SECTION_LABEL[s]}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* Só a seção aberta é montada. */}
        <TabsContent value={section} className="flex flex-col gap-5">
          {section === "qualidade" ? <QualitySection data={quality.quality} perms={perms} actions={actions} /> : null}
          {section === "saude" ? (
            <HealthSection health={quality.health} days={quality.days} perms={perms} actions={actions} />
          ) : null}
          {section === "importacao" ? <ImportSection actions={actions} /> : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ===========================================================================
// Qualidade & Auditoria
// ===========================================================================
const CLASS_TONE: Record<QualityCheck["class"], StatusTone> = {
  safe: "success",
  review: "warning",
  blocked: "danger",
};

/** Rótulos dos campos da amostra (dados vindos do banco; a chave nunca decide nada). */
const SAMPLE_FIELD_LABEL: Record<string, string> = {
  date: "Data",
  plate: "Placa",
  status: "Situação",
  title: "Item",
  actionKey: "Chave do item",
  questionKey: "Pergunta",
  openPlans: "Planos abertos",
  service: "Serviço",
  days: "Dias em aberto",
  maintenanceCode: "Manutenção",
  error: "Erro",
  attempts: "Tentativas",
  candidates: "Candidatas",
};
/** Identificadores que viram botão (plano, checklist) ou não ajudam a ler. */
const SAMPLE_HIDDEN = new Set(["planId", "code", "executionId", "answerId", "itemId"]);
const SAMPLE_LIMIT = 20;

const asText = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
};

function sampleValue(key: string, value: unknown): string | null {
  const text = asText(value);
  if (text == null) return null;
  if (key === "status") return PLAN_STATUS_LABEL[text as PlanStatus] ?? text;
  if (key === "date") return formatDate(text);
  if (key === "at") return formatDateTime(text);
  if (typeof value === "number") return formatInt(value);
  return text;
}

function QualitySection({ data, perms, actions }: { data: QualityData | null; perms: ActionPlanPerms; actions: PanelActions }) {
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  if (!data) {
    return (
      <ErrorState
        variant="panel"
        headingLevel={2}
        title="Não foi possível carregar as verificações de qualidade."
        description="A consulta falhou. Tente de novo; se persistir, avise o administrador do HFM."
        onRetry={actions.refresh}
        retrying={actions.pending}
      />
    );
  }

  // Com ocorrência primeiro; dentro de cada grupo, a ordem do banco.
  const checks = [...data.checks].sort((a, b) => Number(b.count > 0) - Number(a.count > 0));
  const withFindings = checks.filter((c) => c.count > 0);
  const byClass = (cls: QualityCheck["class"]) => withFindings.filter((c) => c.class === cls).length;

  const applyFix = async () => {
    const result = await runQualityFix();
    if (result.ok) {
      toast({
        variant: "success",
        title: "Correção automática aplicada",
        description: `${formatInt(result.data?.plansRefreshed ?? 0)} planos recalculados · ${formatInt(result.data?.executionsReprocessed ?? 0)} checklists reprocessados.`,
      });
      actions.refresh();
    } else {
      toast({ variant: "danger", title: "Não foi possível aplicar a correção", description: result.error });
    }
  };

  return (
    <>
      <section aria-labelledby="ap-quality-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 max-w-3xl flex-col gap-1">
            <h2 id="ap-quality-title" className="text-h4 font-semibold text-fg">Verificações de consistência</h2>
            <p className="text-body-sm text-fg-muted">
              {withFindings.length === 0
                ? "Nenhuma inconsistência encontrada: planos, apontamentos, vínculos e recebimentos concordam entre si."
                : `${formatInt(withFindings.length)} ${withFindings.length === 1 ? "verificação com ocorrência" : "verificações com ocorrência"}: ${formatInt(byClass("safe"))} com correção automática segura, ${formatInt(byClass("review"))} para revisão e ${formatInt(byClass("blocked"))} bloqueadas (correção manual auditada).`}
            </p>
          </div>
          {perms.reprocess ? (
            <Button
              leadingIcon={<Sparkles />}
              onClick={() => setConfirmOpen(true)}
              disabled={actions.pending}
              data-testid="action-plans-quality-fix"
            >
              Aplicar correção automática segura
            </Button>
          ) : null}
        </div>

        {perms.reprocess ? (
          <p className="flex items-start gap-2 text-caption text-fg-muted">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
            A correção automática segura recalcula a situação e os contadores dos planos e reprocessa os recebimentos que
            falharam. Nunca altera respostas do motorista, decisões de usuários nem manutenções.
          </p>
        ) : null}

        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Verificações">
          {checks.map((check) => (
            <li key={check.key} className="min-w-0">
              <QualityCheckCard check={check} actions={actions} />
            </li>
          ))}
        </ul>
      </section>

      <EventsList events={data.events} actions={actions} />

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Aplicar a correção automática segura?"
        description="Recalcula a situação e os contadores de todos os planos a partir dos apontamentos e reprocessa os recebimentos de checklist que falharam (e as inconformidades de manutenção que ficaram sem apontamento). Nunca altera respostas do motorista, decisões de usuários nem manutenções. Verificações de revisão ou bloqueadas continuam pedindo análise."
        confirmLabel="Aplicar correção"
        icon={<Sparkles className="size-5" />}
        onConfirm={applyFix}
      />
    </>
  );
}

function QualityCheckCard({ check, actions }: { check: QualityCheck; actions: PanelActions }) {
  const [open, setOpen] = React.useState(false);
  const listId = React.useId();
  const meta = QUALITY_LABEL[check.key] ?? { title: check.key, hint: "" };
  const sample = check.sample.slice(0, SAMPLE_LIMIT);
  const hasFindings = check.count > 0;

  return (
    <article
      className={cn(
        "relative flex h-full min-w-0 flex-col gap-3 overflow-hidden rounded-lg border border-border bg-surface-raised p-4 shadow-card",
        !hasFindings && "bg-surface",
      )}
      data-testid="action-plans-quality-check"
      data-class={check.class}
      data-count={check.count}
    >
      {hasFindings ? (
        <span
          aria-hidden
          className={cn(
            "absolute inset-x-0 top-0 h-0.5",
            check.class === "safe" ? "bg-success" : check.class === "review" ? "bg-warning" : "bg-danger",
          )}
        />
      ) : null}
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-card-title font-semibold text-fg">{meta.title}</h3>
          {meta.hint ? <p className="text-caption text-fg-muted">{meta.hint}</p> : null}
        </div>
        <span
          className={cn("shrink-0 text-kpi-sm font-semibold tabular-nums", hasFindings ? "text-fg" : "text-fg-muted")}
          aria-label={`${formatInt(check.count)} ocorrências`}
        >
          {formatInt(check.count)}
        </span>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={CLASS_TONE[check.class] ?? "neutral"} size="sm">
          {QUALITY_CLASS_LABEL[check.class] ?? check.class}
        </StatusBadge>
        {!hasFindings ? (
          <span className="inline-flex items-center gap-1 text-caption text-fg-muted">
            <CheckCircle2 className="size-3.5 text-success" aria-hidden />
            Nada encontrado
          </span>
        ) : null}
      </div>

      {hasFindings && sample.length > 0 ? (
        <div className="mt-auto flex flex-col gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 w-fit"
            aria-expanded={open}
            aria-controls={listId}
            leadingIcon={open ? <ChevronDown /> : <ChevronRight />}
            onClick={() => setOpen((v) => !v)}
          >
            {open
              ? "Ocultar amostra"
              : `Ver amostra (${formatInt(sample.length)}${check.count > sample.length ? ` de ${formatInt(check.count)}` : ""})`}
          </Button>
          {open ? (
            <ul id={listId} className="flex flex-col divide-y divide-border rounded-sm border border-border bg-surface">
              {sample.map((entry, index) => (
                <SampleEntry key={index} entry={entry} actions={actions} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function SampleEntry({ entry, actions }: { entry: Record<string, unknown>; actions: PanelActions }) {
  const planId = asText(entry.planId);
  const code = asText(entry.code);
  const executionId = asText(entry.executionId);
  const fields = Object.entries(entry)
    .filter(([key]) => !SAMPLE_HIDDEN.has(key))
    .map(([key, value]) => ({ key, label: SAMPLE_FIELD_LABEL[key] ?? key, value: sampleValue(key, value) }))
    .filter((f) => f.value != null);

  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-caption">
      {planId ? (
        <button
          type="button"
          onClick={() => actions.openPlan(planId)}
          className="rounded-xs font-mono font-semibold text-link underline-offset-2 hover:underline hfm-focus-ring"
          aria-label={`Abrir plano ${code ?? ""}`.trim()}
        >
          {code ?? "Abrir plano"}
        </button>
      ) : code ? (
        <span className="font-mono font-semibold text-fg">{code}</span>
      ) : null}
      {executionId ? (
        <button
          type="button"
          onClick={() => actions.openTrace(executionId)}
          className="rounded-xs font-medium text-link underline-offset-2 hover:underline hfm-focus-ring"
        >
          Ver checklist
        </button>
      ) : null}
      {fields.map((f) => (
        <span key={f.key} className="min-w-0 break-words text-fg-secondary">
          <span className="text-fg-muted">{f.label}: </span>
          {f.value}
        </span>
      ))}
    </li>
  );
}

const EVENTS_STEP = 30;

function EventsList({ events, actions }: { events: QualityData["events"]; actions: PanelActions }) {
  const [shown, setShown] = React.useState(EVENTS_STEP);
  const visible = events.slice(0, shown);

  return (
    <section aria-labelledby="ap-events-title" className="flex flex-col gap-3" data-testid="action-plans-quality-events">
      <div className="flex flex-col gap-0.5">
        <h2 id="ap-events-title" className="text-h4 font-semibold text-fg">Eventos recentes</h2>
        <p className="text-caption text-fg-muted">
          Os {formatInt(Math.min(events.length, 200))} últimos eventos da trilha dos planos, do mais recente ao mais antigo.
        </p>
      </div>
      {events.length === 0 ? (
        <EmptyState size="sm" variant="panel" icon={<History />} headingLevel={3} title="Nenhum evento registrado ainda" />
      ) : (
        <>
          <ol className="flex flex-col divide-y divide-border rounded-md border border-border bg-surface">
            {visible.map((e) => (
              <li
                key={e.id}
                className="grid min-w-0 grid-cols-1 gap-1 px-3 py-2 sm:grid-cols-[8.5rem_minmax(0,1fr)_auto] sm:items-center sm:gap-3"
              >
                <span className="min-w-0">
                  {e.planId ? (
                    <button
                      type="button"
                      onClick={() => actions.openPlan(e.planId)}
                      className="rounded-xs font-mono text-caption font-semibold text-link underline-offset-2 hover:underline hfm-focus-ring"
                    >
                      {e.code ?? "Abrir plano"}
                    </button>
                  ) : (
                    <span className="font-mono text-caption text-fg-muted">{e.code ?? "—"}</span>
                  )}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-body-sm font-medium text-fg">{EVENT_LABEL[e.type] ?? e.type}</span>
                  {e.reason ? <span className="text-caption break-words text-fg-secondary">{e.reason}</span> : null}
                </span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-fg-muted sm:justify-end sm:text-right">
                  <Badge variant="neutral" appearance="outline" size="sm">{SOURCE_LABEL[e.source] ?? e.source}</Badge>
                  <span>{e.actor ?? "Sistema"}</span>
                  <span className="tabular-nums">{formatDateTime(e.at)}</span>
                </span>
              </li>
            ))}
          </ol>
          {events.length > shown ? (
            <Button variant="secondary" size="sm" className="w-fit" onClick={() => setShown((n) => n + EVENTS_STEP * 2)}>
              Mostrar mais ({formatInt(events.length - shown)} restantes)
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}

// ===========================================================================
// Saúde da integração
// ===========================================================================
const PERIODS = [7, 30, 90] as const;

/** aaaa-mm-dd + n dias, sem fuso. */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

interface DayBucket {
  key: string;
  label: string;
  title: string;
  executions: number;
  items: number;
}

/**
 * A série do período: os dias sem envio entram com zero (o banco só devolve
 * dias com checklist). Acima de um mês, a leitura vai por semana — 90 colunas
 * não cabem num celular.
 */
function buildBuckets(health: HealthData): { buckets: DayBucket[]; weekly: boolean } {
  const byDate = new Map(health.byDay.map((d) => [d.date, d]));
  const total = Math.max(1, health.days || health.byDay.length || 1);
  const days = Array.from({ length: total }, (_, i) => addDays(health.from, i));
  const weekly = total > 31;
  if (!weekly) {
    return {
      weekly,
      buckets: days.map((date) => ({
        key: date,
        label: ddmm(date),
        title: formatDate(date),
        executions: byDate.get(date)?.executions ?? 0,
        items: byDate.get(date)?.items ?? 0,
      })),
    };
  }
  const buckets: DayBucket[] = [];
  for (let i = 0; i < days.length; i += 7) {
    const slice = days.slice(i, i + 7);
    buckets.push({
      key: slice[0],
      label: ddmm(slice[0]),
      title: `${formatDate(slice[0])} a ${formatDate(slice[slice.length - 1])}`,
      executions: slice.reduce((acc, d) => acc + (byDate.get(d)?.executions ?? 0), 0),
      items: slice.reduce((acc, d) => acc + (byDate.get(d)?.items ?? 0), 0),
    });
  }
  return { weekly, buckets };
}

function HealthSection({
  health, days, perms, actions,
}: { health: HealthData | null; days: number; perms: ActionPlanPerms; actions: PanelActions }) {
  const today = health ? addDays(health.from, Math.max(0, (health.days || days) - 1)) : null;

  return (
    <section aria-labelledby="ap-health-title" className="flex flex-col gap-5" data-testid="action-plans-health">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 max-w-3xl flex-col gap-1">
          <h2 id="ap-health-title" className="text-h4 font-semibold text-fg">Saúde da integração</h2>
          <p className="text-body-sm text-fg-muted">
            Do checklist enviado ao plano: quantos chegaram, foram processados e viraram apontamento. Avarias saem daqui
            para o fluxo próprio de Sinistros/Avarias.
            {health ? ` Período: ${formatDate(health.from)} a ${formatDate(today)}.` : ""}
          </p>
        </div>
        <div role="group" aria-label="Período" className="inline-flex rounded-sm border border-border bg-surface-secondary p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={days === p}
              disabled={actions.pending}
              onClick={() => actions.navigate({ dias: p === 30 ? null : String(p) })}
              className={cn(
                "h-(--control-height-sm) rounded-xs px-3 text-body-sm font-medium hfm-transition hfm-focus-ring",
                days === p ? "bg-surface-raised text-fg shadow-card" : "text-fg-secondary hover:text-fg",
              )}
            >
              {p} dias
            </button>
          ))}
        </div>
      </div>

      {!health ? (
        <ErrorState
          variant="panel"
          headingLevel={3}
          title="Não foi possível carregar a saúde da integração."
          description="A consulta falhou. Tente de novo; se persistir, avise o administrador do HFM."
          onRetry={actions.refresh}
          retrying={actions.pending}
        />
      ) : (
        <>
          <HealthKpis health={health} />
          <HealthCharts health={health} />
          <RecentFailures health={health} perms={perms} actions={actions} />
          {perms.reprocess && today ? (
            <ReprocessForm key={`${health.from}|${today}`} defaultFrom={health.from} today={today} actions={actions} />
          ) : null}
        </>
      )}
    </section>
  );
}

interface KpiDef {
  label: string;
  value: React.ReactNode;
  period?: string;
  status?: KpiStatus;
  icon?: React.ReactNode;
}

function KpiGroup({ title, items }: { title: string; items: KpiDef[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-label font-semibold text-fg-secondary">{title}</h3>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {items.map((k) => (
          <KpiCard key={k.label} size="compact" label={k.label} value={k.value} period={k.period} status={k.status} icon={k.icon} />
        ))}
      </div>
    </div>
  );
}

function HealthKpis({ health: h }: { health: HealthData }) {
  return (
    <div className="flex flex-col gap-4" data-testid="action-plans-health-kpis">
      <KpiGroup
        title="Recebimento"
        items={[
          { label: "Checklists enviados", value: formatInt(h.executionsSubmitted), icon: <Inbox /> },
          { label: "Com inconformidade", value: formatInt(h.executionsWithFindings), period: "ao menos uma resposta inconforme" },
          { label: "Processados", value: formatInt(h.processed), status: "success", icon: <CheckCircle2 /> },
          { label: "Falhas", value: formatInt(h.failed), status: h.failed > 0 ? "danger" : "neutral", icon: <XCircle /> },
          { label: "Pendentes", value: formatInt(h.pending), status: h.pending > 0 ? "warning" : "neutral", period: "com inconformidade, ainda não processados", icon: <Clock /> },
          { label: "Reprocessamentos", value: formatInt(h.reprocessed), icon: <RefreshCw /> },
          {
            label: "Último processamento",
            value: <span className="text-body font-semibold">{formatDateTime(h.lastProcessedAt)}</span>,
            icon: <Activity />,
          },
        ]}
      />
      <KpiGroup
        title="Classificação das inconformidades"
        items={[
          { label: "Inconformidades identificadas", value: formatInt(h.findings) },
          { label: "De manutenção", value: formatInt(h.maintenanceFindings), status: "primary", icon: <Wrench /> },
          { label: "De avaria", value: formatInt(h.damageFindings), period: "encaminhadas ao fluxo de Avarias", status: "accent" },
          { label: "Não elegíveis", value: formatInt(h.notEligible), period: "não geram plano" },
          {
            label: "Eventos de avaria pendentes",
            value: formatInt(h.damageEventsPending),
            period: "aguardando consumo pelo fluxo de Avarias",
            status: h.damageEventsPending > 0 ? "warning" : "neutral",
          },
        ]}
      />
      <KpiGroup
        title="Resultado no Plano de Ação"
        items={[
          { label: "Apontamentos criados", value: formatInt(h.itemsCreated) },
          { label: "Planos criados", value: formatInt(h.plansCreated) },
          { label: "Planos atualizados", value: formatInt(h.plansUpdated), period: "nova ocorrência em plano aberto" },
        ]}
      />
    </div>
  );
}

function HealthCharts({ health }: { health: HealthData }) {
  const { buckets, weekly } = React.useMemo(() => buildBuckets(health), [health]);
  const empty = buckets.every((b) => b.executions === 0 && b.items === 0);
  const unit = weekly ? "Por semana" : "Por dia";

  const toItems = (pick: "executions" | "items", color: string): ColumnDatum[] =>
    buckets.map((b) => ({
      key: b.key,
      label: b.label,
      value: b[pick],
      color,
      tooltip: {
        title: b.title,
        rows: [
          { label: "Checklists enviados", value: formatInt(b.executions), color: "var(--chart-brand-primary)", marker: "square", emphasis: pick === "executions" },
          { label: "Apontamentos criados", value: formatInt(b.items), color: "var(--chart-brand-secondary)", marker: "square", emphasis: pick === "items" },
        ],
        announce: `${b.title}: ${formatInt(b.executions)} checklists enviados, ${formatInt(b.items)} apontamentos criados`,
      },
    }));

  const srRows = buckets.map((b) => ({ key: b.key, cells: [b.title, formatInt(b.executions), formatInt(b.items)] }));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ChartCard
        title="Checklists enviados"
        description={`${unit} · todos os checklists enviados no período`}
        empty={empty ? "Nenhum checklist enviado no período." : undefined}
      >
        <ColumnChart
          items={toItems("executions", "var(--chart-brand-primary)")}
          ariaLabel={`Checklists enviados, ${unit.toLowerCase()}`}
          format={chartFormat.int}
          axisFormat={chartFormat.compact}
          showValues={buckets.length <= 14}
          height={160}
        />
      </ChartCard>
      <ChartCard
        title="Apontamentos criados"
        description={`${unit} · inconformidades de manutenção que viraram apontamento`}
        empty={empty ? "Nenhum apontamento criado no período." : undefined}
      >
        <ColumnChart
          items={toItems("items", "var(--chart-brand-secondary)")}
          ariaLabel={`Apontamentos criados, ${unit.toLowerCase()}`}
          format={chartFormat.int}
          axisFormat={chartFormat.compact}
          showValues={buckets.length <= 14}
          height={160}
        />
      </ChartCard>
      <SrTable
        caption={`Checklists enviados e apontamentos criados, ${unit.toLowerCase()}`}
        columns={[weekly ? "Semana" : "Dia", "Checklists enviados", "Apontamentos criados"]}
        rows={srRows}
      />
    </div>
  );
}

function RecentFailures({ health, perms, actions }: { health: HealthData; perms: ActionPlanPerms; actions: PanelActions }) {
  const { toast } = useToast();
  const [running, setRunning] = React.useState<string | null>(null);

  const retry = async (executionId: string) => {
    setRunning(executionId);
    const result = await reprocessActionPlans({ executionIds: [executionId] });
    setRunning(null);
    if (result.ok && (result.data?.errors ?? 0) === 0) {
      toast({ variant: "success", title: "Checklist reprocessado", description: "O recebimento foi processado de novo." });
      actions.refresh();
    } else {
      toast({
        variant: "danger",
        title: "O reprocessamento não resolveu",
        description: result.ok ? "O checklist falhou de novo; o erro fica registrado na lista." : result.error,
      });
      if (result.ok) actions.refresh();
    }
  };

  return (
    <section aria-labelledby="ap-failures-title" className="flex flex-col gap-2">
      <h3 id="ap-failures-title" className="text-label font-semibold text-fg-secondary">Falhas recentes de recebimento</h3>
      {health.recentFailures.length === 0 ? (
        <p className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-4 text-body-sm text-fg-muted">
          <CheckCircle2 className="size-4 text-success" aria-hidden />
          Nenhuma falha de recebimento em aberto.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-surface">
          {health.recentFailures.map((f) => (
            <li key={f.executionId} className="flex min-w-0 flex-wrap items-start justify-between gap-2 px-3 py-2">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2 text-caption text-fg-muted">
                  <button
                    type="button"
                    onClick={() => actions.openTrace(f.executionId)}
                    className="rounded-xs font-medium text-link underline-offset-2 hover:underline hfm-focus-ring"
                  >
                    Ver checklist
                  </button>
                  <span className="tabular-nums">{formatDateTime(f.at)}</span>
                  <span>
                    {formatInt(f.attempts)} {f.attempts === 1 ? "tentativa" : "tentativas"}
                  </span>
                </span>
                <span className="text-body-sm break-words text-danger">{f.error ?? "Erro não informado"}</span>
              </span>
              {perms.reprocess ? (
                <Button
                  size="sm"
                  variant="secondary"
                  leadingIcon={<RotateCcw />}
                  loading={running === f.executionId}
                  disabled={running !== null}
                  onClick={() => void retry(f.executionId)}
                >
                  Reprocessar
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ReprocessForm({ defaultFrom, today, actions }: { defaultFrom: string; today: string; actions: PanelActions }) {
  const { toast } = useToast();
  const [from, setFrom] = React.useState(defaultFrom);
  const [to, setTo] = React.useState(today);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<
    { executions: number; errors: number; itemsCreated: number; plansCreated: number; plansRefreshed: number } | null
  >(null);
  const [error, setError] = React.useState<string | null>(null);

  const problem = !from || !to
    ? "Informe as duas datas."
    : to < from
      ? "A data final precisa ser igual ou posterior à inicial."
      : to > addMonths(from, 12)
        ? "O período pode ter no máximo 12 meses."
        : null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (problem) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const response = await reprocessActionPlans({ dateFrom: from, dateTo: to });
    setBusy(false);
    if (response.ok && response.data) {
      setResult(response.data);
      toast({ variant: "success", title: "Período reprocessado", description: `${formatInt(response.data.executions)} checklists lidos de novo.` });
      actions.refresh();
    } else {
      setError(response.error ?? "Não foi possível reprocessar.");
    }
  };

  return (
    <section aria-labelledby="ap-reprocess-title" className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4 shadow-card">
      <div className="flex flex-col gap-1">
        <h3 id="ap-reprocess-title" className="text-card-title font-semibold text-fg">Reprocessar período</h3>
        <p className="text-caption text-fg-muted">
          Lê de novo os checklists enviados no período (até 12 meses) e cria o que faltou. É idempotente: não duplica
          apontamentos nem planos e não altera respostas do motorista, decisões de usuários ou manutenções.
        </p>
      </div>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3" aria-describedby={problem ? "ap-reprocess-problem" : undefined}>
        <label className="flex w-40 min-w-0 flex-col gap-1">
          <span className="text-caption font-medium text-fg-secondary">De</span>
          <DateInput size="sm" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} required />
        </label>
        <label className="flex w-40 min-w-0 flex-col gap-1">
          <span className="text-caption font-medium text-fg-secondary">Até</span>
          <DateInput size="sm" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} required aria-invalid={Boolean(problem) || undefined} />
        </label>
        <Button type="submit" size="sm" leadingIcon={<RefreshCw />} loading={busy} disabled={Boolean(problem)} data-testid="action-plans-reprocess">
          Reprocessar período
        </Button>
      </form>
      {problem ? (
        <p id="ap-reprocess-problem" className="text-caption text-danger">{problem}</p>
      ) : null}
      {error ? (
        <Alert variant="danger">
          <AlertTitle>Não foi possível reprocessar</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {result ? (
        <Alert variant={result.errors > 0 ? "warning" : "success"}>
          <AlertTitle>Reprocessamento concluído</AlertTitle>
          <AlertDescription>
            {formatInt(result.executions)} checklists processados · {formatInt(result.errors)} com erro ·{" "}
            {formatInt(result.itemsCreated)} apontamentos criados · {formatInt(result.plansCreated)} planos criados ·{" "}
            {formatInt(result.plansRefreshed)} planos atualizados.
          </AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}

// ===========================================================================
// Importação & Follow-up
// ===========================================================================
type Field = "planCode" | "plate" | "item" | "action" | "reasonCode" | "reason" | "resolvedOn";

const FIELDS: { key: Field; label: string; aliases: string[] }[] = [
  { key: "planCode", label: "Código do plano", aliases: ["codigo do plano", "codigo plano", "cod plano", "plano", "plano de acao", "codigo", "plan code"] },
  { key: "plate", label: "Placa", aliases: ["placa", "placa do veiculo", "veiculo"] },
  { key: "item", label: "Item", aliases: ["item", "item do checklist", "apontamento", "inconformidade", "pergunta"] },
  { key: "action", label: "Ação", aliases: ["acao", "tratativa", "acao tomada", "decisao"] },
  { key: "reasonCode", label: "Motivo", aliases: ["motivo", "codigo do motivo", "motivo padrao"] },
  { key: "reason", label: "Justificativa", aliases: ["justificativa", "observacao", "descricao", "comentario"] },
  { key: "resolvedOn", label: "Data da resolução", aliases: ["data da resolucao", "data resolucao", "resolvido em", "data de resolucao", "data"] },
];

const FOLLOWUP_ACTIONS: { code: string; label: string; detail: string }[] = [
  { code: "SEM_MANUTENCAO", label: "Resolvido sem manutenção", detail: "Ajuste simples, sem intervenção técnica. Exige justificativa." },
  { code: "IMPROCEDENTE", label: "Improcedente", detail: "Falha não confirmada na verificação. Exige justificativa." },
  { code: "CANCELAR", label: "Cancelado", detail: "Decisão administrativa (veículo devolvido, erro cadastral). Exige justificativa." },
  { code: "MANTER", label: "Manter", detail: "Só confere a linha: o plano continua como está." },
];

const ACTION_SYNONYMS: Record<string, string> = {
  SEM_MANUTENCAO: "SEM_MANUTENCAO",
  RESOLVIDO_SEM_MANUTENCAO: "SEM_MANUTENCAO",
  IMPROCEDENTE: "IMPROCEDENTE",
  CANCELAR: "CANCELAR",
  CANCELADO: "CANCELAR",
  MANTER: "MANTER",
  MANTIDO: "MANTER",
};

const MAX_ROWS_PER_SEND = 2000;
const NONE = "__nenhuma__";

const norm = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

type Mapping = Record<Field, number | null>;
const EMPTY_MAPPING: Mapping = { planCode: null, plate: null, item: null, action: null, reasonCode: null, reason: null, resolvedOn: null };

/** Sugere a coluna de cada campo pelo cabeçalho (apelidos, sem acento). Cada coluna serve a um campo só. */
function guessMapping(headers: string[]): Mapping {
  const normalized = headers.map((h) => norm(h ?? ""));
  const used = new Set<number>();
  const out: Mapping = { ...EMPTY_MAPPING };
  for (const field of FIELDS) {
    for (const alias of field.aliases) {
      const index = normalized.findIndex((h, i) => h === alias && !used.has(i));
      if (index >= 0) {
        out[field.key] = index;
        used.add(index);
        break;
      }
    }
  }
  return out;
}

function cellText(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

/** Data da planilha → aaaa-mm-dd; `undefined` quando não dá para ler. */
function parseDate(value: CellValue): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    // Número de série do Excel (dias desde 30/12/1899).
    if (value < 1 || value > 80000) return undefined;
    return new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000).toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (!text) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (m) {
    const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    const d = new Date(`${iso}T00:00:00Z`);
    return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? undefined : iso;
  }
  return undefined;
}

const REASON_BY_LABEL = new Map(Object.entries(REASON_LABEL).map(([code, label]) => [norm(label), code]));
const REASON_CODES = new Set(Object.keys(REASON_LABEL));

function reasonCode(text: string): string | null {
  if (!text) return null;
  const n = norm(text);
  const asCode = n.replace(/ /g, "_");
  if (REASON_CODES.has(asCode)) return asCode;
  return REASON_BY_LABEL.get(n) ?? text;
}

interface BuiltRows {
  send: FollowupInputRow[];
  /** Linhas recusadas antes de enviar (data ilegível, ação vazia). */
  local: FollowupRow[];
  /** Linhas totalmente em branco nos campos mapeados. */
  blank: number;
}

function buildRows(rows: CellValue[][], mapping: Mapping): BuiltRows {
  const get = (values: CellValue[], field: Field) => {
    const index = mapping[field];
    return index == null ? null : (values[index] ?? null);
  };
  const out: BuiltRows = { send: [], local: [], blank: 0 };
  rows.forEach((values, index) => {
    const row = index + 2; // a linha 1 é o cabeçalho
    const planCode = cellText(get(values, "planCode")).toUpperCase();
    const plate = cellText(get(values, "plate")).toUpperCase();
    const item = cellText(get(values, "item"));
    const rawAction = cellText(get(values, "action"));
    const reasonText = cellText(get(values, "reasonCode"));
    const reason = cellText(get(values, "reason"));
    const resolvedOn = parseDate(get(values, "resolvedOn"));
    if (!planCode && !plate && !item && !rawAction && !reason) {
      out.blank += 1;
      return;
    }
    const actionKey = norm(rawAction).toUpperCase().replace(/ /g, "_");
    const action = ACTION_SYNONYMS[actionKey] ?? (rawAction ? rawAction.toUpperCase() : "");
    if (!action) {
      out.local.push({ row, planCode: planCode || null, action: "", ok: false, message: "Ação vazia." });
      return;
    }
    if (resolvedOn === undefined) {
      out.local.push({ row, planCode: planCode || null, action, ok: false, message: "Data da resolução ilegível (use dd/mm/aaaa)." });
      return;
    }
    out.send.push({
      row,
      planCode: planCode || null,
      plate: plate || null,
      item: item || null,
      action,
      reasonCode: reasonCode(reasonText),
      reason: reason || null,
      resolvedOn,
    });
  });
  return out;
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function downloadTemplate() {
  const header = FIELDS.map((f) => f.label);
  const examples = [
    ["PA-2026-000123", "", "", "SEM_MANUTENCAO", "ajuste_operacional", "Retrovisor ajustado pela operação no pátio, sem intervenção técnica.", "30/09/2026"],
    ["", "TST1A23", "Faróis com falha", "IMPROCEDENTE", "falha_nao_confirmada", "Faróis testados na verificação e funcionando normalmente.", ""],
    ["PA-2026-000124", "", "", "MANTER", "", "", ""],
  ];
  const escape = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = `﻿${[header, ...examples].map((r) => r.map(escape).join(";")).join("\r\n")}\r\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "modelo-follow-up-planos-de-acao.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface SheetState {
  fileName: string;
  headers: string[];
  rows: CellValue[][];
}

function mergeResults(parts: FollowupResult[], local: FollowupRow[], applied: boolean): FollowupResult {
  const rows = [...local, ...parts.flatMap((p) => p.rows)].sort((a, b) => a.row - b.row);
  return { applied, ok: rows.filter((r) => r.ok).length, errors: rows.filter((r) => !r.ok).length, rows };
}

function ImportSection({ actions }: { actions: PanelActions }) {
  const { toast } = useToast();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = React.useState<SheetState | null>(null);
  const [reading, setReading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [mapping, setMapping] = React.useState<Mapping>(EMPTY_MAPPING);
  const [preview, setPreview] = React.useState<FollowupResult | null>(null);
  const [applied, setApplied] = React.useState<FollowupResult | null>(null);
  const [busy, setBusy] = React.useState<null | "preview" | "apply">(null);
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const built = React.useMemo(() => (sheet ? buildRows(sheet.rows, mapping) : null), [sheet, mapping]);
  const mappingProblem =
    mapping.action == null
      ? "Indique a coluna da Ação."
      : mapping.planCode == null && (mapping.plate == null || mapping.item == null)
        ? "Indique o Código do plano, ou a Placa e o Item."
        : null;

  const okRows = React.useMemo(() => {
    if (!preview || !built) return [];
    const ok = new Set(preview.rows.filter((r) => r.ok).map((r) => r.row));
    return built.send.filter((r) => ok.has(r.row));
  }, [preview, built]);
  const okToApply = okRows.filter((r) => r.action !== "MANTER").length;

  const resetResults = () => {
    setPreview(null);
    setApplied(null);
    setError(null);
  };

  const onFile = async (file: File | null) => {
    resetResults();
    setSheet(null);
    if (!file) return;
    setReading(true);
    const result = await readImportFile(file);
    setReading(false);
    if (!result.ok || !result.data) {
      setError(result.error ?? "Não foi possível ler o arquivo.");
      return;
    }
    const { sheet: data, fileName } = result.data;
    setSheet({ fileName, headers: data.headers, rows: data.rows });
    setMapping(guessMapping(data.headers));
  };

  const send = async (rows: FollowupInputRow[], apply: boolean): Promise<FollowupResult[] | null> => {
    const parts: FollowupResult[] = [];
    const slices = chunks(rows, MAX_ROWS_PER_SEND);
    setProgress({ done: 0, total: rows.length });
    for (const slice of slices) {
      const response = await importFollowup(slice, apply);
      if (!response.ok || !response.data) {
        setError(response.error ?? "Não foi possível processar o follow-up.");
        setProgress(null);
        return null;
      }
      parts.push(response.data);
      setProgress((p) => (p ? { ...p, done: p.done + slice.length } : p));
    }
    setProgress(null);
    return parts;
  };

  const runPreview = async () => {
    if (!built || mappingProblem) return;
    resetResults();
    setBusy("preview");
    const parts = built.send.length ? await send(built.send, false) : [];
    setBusy(null);
    if (parts) setPreview(mergeResults(parts, built.local, false));
  };

  const runApply = async () => {
    if (!okRows.length) return;
    setBusy("apply");
    setError(null);
    const parts = await send(okRows, true);
    setBusy(null);
    if (!parts) return;
    const result = mergeResults(parts, [], true);
    setApplied(result);
    toast({
      variant: result.errors > 0 ? "warning" : "success",
      title: "Follow-up aplicado",
      description: `${formatInt(result.ok)} linhas aplicadas${result.errors ? ` · ${formatInt(result.errors)} com erro` : ""}.`,
    });
    actions.refresh();
  };

  const headerOptions = sheet?.headers.map((h, i) => ({ value: String(i), label: h || `Coluna ${i + 1}` })) ?? [];

  return (
    <section aria-labelledby="ap-import-title" className="flex flex-col gap-5" data-testid="action-plans-import">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 max-w-3xl flex-col gap-1">
          <h2 id="ap-import-title" className="text-h4 font-semibold text-fg">Importação de follow-up</h2>
          <p className="text-body-sm text-fg-muted">
            Registre em lote as tratativas acompanhadas fora do sistema: cada linha indica o plano (pelo código, ou pela
            placa e o item quando há um único plano aberto) e a ação. Primeiro a prévia confere tudo; só depois você aplica.
          </p>
        </div>
        <Button variant="secondary" leadingIcon={<Download />} onClick={downloadTemplate} data-testid="action-plans-import-template">
          Baixar modelo (CSV)
        </Button>
      </div>

      <Alert variant="info">
        <AlertTitle>O que a importação nunca faz</AlertTitle>
        <AlertDescription>
          Nunca cria veículos ou operações, nunca altera perfis de acesso e nunca reescreve o histórico de manutenção.
          Cada linha aplicada é a mesma tratativa feita na gaveta do plano, com justificativa e trilha de auditoria; planos
          fora do seu escopo ou já encerrados são recusados.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3">
          <h3 className="text-label font-semibold text-fg">Ações aceitas</h3>
          <dl className="flex flex-col gap-1.5">
            {FOLLOWUP_ACTIONS.map((a) => (
              <div key={a.code} className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
                <dt className="shrink-0 font-mono text-caption font-semibold text-fg sm:w-36">{a.code}</dt>
                <dd className="text-caption text-fg-secondary">
                  <span className="font-medium text-fg">{a.label}.</span> {a.detail}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <details className="group rounded-md border border-border bg-surface p-3">
          <summary className="cursor-pointer text-label font-semibold text-fg hfm-focus-ring">
            Motivos padronizados (coluna Motivo)
          </summary>
          <div className="mt-2 flex flex-col gap-2 text-caption">
            <p className="text-fg-muted">
              Use o código ou o texto do motivo. A justificativa (mínimo de 10 caracteres) descreve o caso.
            </p>
            {(Object.keys(REASONS) as (keyof typeof REASONS)[]).map((kind) => (
              <div key={kind} className="flex flex-col gap-0.5">
                <span className="font-medium text-fg-secondary">
                  {kind === "resolved_without_maintenance" ? "SEM_MANUTENCAO" : kind === "improper" ? "IMPROCEDENTE" : "CANCELAR"}
                </span>
                <ul className="flex flex-col">
                  {REASONS[kind].map((r) => (
                    <li key={r.code} className="break-words text-fg-muted">
                      <span className="font-mono text-fg">{r.code}</span> — {r.label}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-label font-semibold text-fg">1. Arquivo</h3>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.csv"
            disabled={reading || busy !== null}
            aria-label="Arquivo de follow-up (XLSX ou CSV)"
            aria-describedby="ap-import-file-hint"
            data-testid="action-plans-import-file"
            onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
            className="max-w-full text-body-sm text-fg file:mr-3 file:rounded-sm file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-label file:text-fg hover:file:bg-secondary disabled:opacity-60"
          />
          {reading ? <span className="text-caption text-fg-muted" role="status">Lendo o arquivo…</span> : null}
        </div>
        <p id="ap-import-file-hint" className="text-caption text-fg-muted">
          XLSX ou CSV; a linha 1 é o cabeçalho. O arquivo é lido no seu navegador e enviado em partes de até{" "}
          {formatInt(MAX_ROWS_PER_SEND)} linhas.
        </p>
      </div>

      {error ? (
        <Alert variant="danger">
          <AlertTitle>Não foi possível continuar</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {sheet && built ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-label font-semibold text-fg">2. Colunas</h3>
            <span className="text-caption text-fg-muted">
              <FileUp className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
              {sheet.fileName} · {formatInt(sheet.rows.length)} linhas
              {built.blank ? ` · ${formatInt(built.blank)} em branco ignoradas` : ""}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {FIELDS.map((field) => {
              const id = `ap-import-map-${field.key}`;
              const value = mapping[field.key];
              return (
                <div key={field.key} className="flex min-w-0 flex-col gap-1">
                  <span id={id} className="text-caption font-medium text-fg-secondary">{field.label}</span>
                  <Select
                    value={value == null ? NONE : String(value)}
                    onValueChange={(v) => {
                      setMapping((m) => ({ ...m, [field.key]: v === NONE ? null : Number(v) }));
                      resetResults();
                    }}
                    disabled={busy !== null}
                  >
                    <SelectTrigger size="sm" aria-labelledby={id}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>— não usar —</SelectItem>
                      {headerOptions.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
          {mappingProblem ? <p className="text-caption text-danger">{mappingProblem}</p> : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              leadingIcon={<Upload />}
              loading={busy === "preview"}
              disabled={Boolean(mappingProblem) || busy !== null || (built.send.length === 0 && built.local.length === 0)}
              onClick={() => void runPreview()}
              data-testid="action-plans-import-preview"
            >
              Conferir (prévia)
            </Button>
            {progress ? (
              <span className="text-caption text-fg-muted tabular-nums" role="status">
                {busy === "apply" ? "Aplicando" : "Conferindo"} {formatInt(progress.done)} de {formatInt(progress.total)} linhas…
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {preview && !applied ? (
        <div className="flex flex-col gap-3" data-testid="action-plans-import-result">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-label font-semibold text-fg">3. Prévia</h3>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status="success" size="sm">{formatInt(preview.ok)} prontas</StatusBadge>
              <StatusBadge status={preview.errors ? "danger" : "neutral"} size="sm">{formatInt(preview.errors)} com erro</StatusBadge>
            </div>
          </div>
          <FollowupTable result={preview} />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              leadingIcon={<CheckCircle2 />}
              disabled={okRows.length === 0 || busy !== null}
              loading={busy === "apply"}
              onClick={() => setConfirmOpen(true)}
              data-testid="action-plans-import-apply"
            >
              Aplicar {formatInt(okRows.length)} {okRows.length === 1 ? "linha" : "linhas"}
            </Button>
            <span className="text-caption text-fg-muted">
              Só as linhas prontas são aplicadas; corrija as demais no arquivo e envie de novo.
            </span>
          </div>
        </div>
      ) : null}

      {applied ? (
        <div className="flex flex-col gap-3" data-testid="action-plans-import-applied">
          <Alert variant={applied.errors ? "warning" : "success"}>
            <AlertTitle>Follow-up aplicado</AlertTitle>
            <AlertDescription>
              {formatInt(applied.ok)} {applied.ok === 1 ? "linha aplicada" : "linhas aplicadas"}
              {applied.errors ? ` · ${formatInt(applied.errors)} recusadas na gravação` : ""}. A trilha de cada plano registra a
              importação.
            </AlertDescription>
          </Alert>
          <FollowupTable result={applied} />
          <Button
            variant="secondary"
            className="w-fit"
            leadingIcon={<RotateCcw />}
            onClick={() => {
              resetResults();
              setSheet(null);
              if (fileRef.current) fileRef.current.value = "";
            }}
          >
            Importar outro arquivo
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Aplicar ${formatInt(okRows.length)} ${okRows.length === 1 ? "linha" : "linhas"} de follow-up?`}
        description={`${formatInt(okToApply)} ${okToApply === 1 ? "tratativa será registrada" : "tratativas serão registradas"} nos planos (as linhas MANTER só conferem). Cada uma é a mesma tratativa da gaveta do plano, com justificativa e trilha de auditoria. A importação nunca cria veículos ou operações, nunca altera perfis e nunca reescreve o histórico de manutenção.`}
        confirmLabel="Aplicar"
        icon={<TriangleAlert className="size-5" />}
        onConfirm={async () => {
          setConfirmOpen(false);
          await runApply();
        }}
      />
    </section>
  );
}

const TABLE_LIMIT = 300;

function FollowupTable({ result }: { result: FollowupResult }) {
  const [onlyErrors, setOnlyErrors] = React.useState(result.errors > 0);
  const rows = onlyErrors ? result.rows.filter((r) => !r.ok) : result.rows;
  const visible = rows.slice(0, TABLE_LIMIT);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={onlyErrors ? "outline" : "primary"} aria-pressed={!onlyErrors} onClick={() => setOnlyErrors(false)}>
          Todas ({formatInt(result.rows.length)})
        </Button>
        <Button size="sm" variant={onlyErrors ? "primary" : "outline"} aria-pressed={onlyErrors} onClick={() => setOnlyErrors(true)}>
          Só erros ({formatInt(result.errors)})
        </Button>
        {rows.length > TABLE_LIMIT ? (
          <span className="text-caption text-fg-muted">
            Mostrando {formatInt(TABLE_LIMIT)} de {formatInt(rows.length)} linhas.
          </span>
        ) : null}
      </div>
      {visible.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-body-sm text-fg-muted">
          Nenhuma linha com erro.
        </p>
      ) : (
        <TableContainer tabIndex={0} maxHeight="28rem" stickyHeader>
          <Table aria-label="Resultado por linha" style={{ minWidth: 520 }}>
            <TableHeader>
              <TableRow>
                <TableHead numeric style={{ width: 72 }}>Linha</TableHead>
                <TableHead style={{ width: 150 }}>Plano</TableHead>
                <TableHead style={{ width: 150 }}>Ação</TableHead>
                <TableHead>Resultado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((r) => (
                <TableRow key={`${r.row}-${r.planCode ?? ""}`}>
                  <TableCell numeric>{formatInt(r.row)}</TableCell>
                  <TableCell className="font-mono text-caption">{r.planCode ?? "—"}</TableCell>
                  <TableCell className="font-mono text-caption">{r.action || "—"}</TableCell>
                  <TableCell>
                    {r.ok ? (
                      <StatusBadge status="success" size="sm">{result.applied ? "Aplicada" : "Pronta"}</StatusBadge>
                    ) : (
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <StatusBadge status="danger" size="sm">Erro</StatusBadge>
                        <span className="text-body-sm break-words text-fg-secondary">{r.message ?? "Recusada."}</span>
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </div>
  );
}
