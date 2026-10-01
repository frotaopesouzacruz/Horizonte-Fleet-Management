"use client";

import * as React from "react";
import { ArrowRight, Eye, Info, Link2, Lock, Pencil, RefreshCw, Save, SearchX, ShieldAlert, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox, CheckboxField } from "@/components/ui/checkbox";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SearchField } from "@/components/ui/search-field";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { useToast } from "@/components/feedback/toast";
import { NativeSelect } from "@/components/governance/selects";
import { PriorityBadge } from "@/components/action-plans/badges";
import {
  reprocessActionPlans, saveActionPlanSettings, saveParameter, saveQuestionServices, type ParameterInput, type Result,
} from "@/lib/action-plans/actions";
import { PRIORITY_LABEL, PRIORITY_ORDER, formatDateTime, formatInt, formatPct } from "@/lib/action-plans/labels";
import {
  FILTER_PARAM,
  type ActionParameter,
  type ActionPlanCatalog,
  type ActionPlanSettings,
  type Coverage,
  type MappingData,
  type MappingRow,
  type Priority,
} from "@/lib/action-plans/types";
import type { MaintenanceCatalog } from "@/lib/maintenance/types";
import { cn } from "@/lib/cn";
import type { ActionPlanPerms, PanelActions } from "./shared";

/**
 * Planos de Ação → Parâmetros & Mapeamento (§49–§56).
 *
 * Cada pergunta (e cada detalhe/campo condicional) do Check List de Frota, pela
 * chave estável: se é Manutenção ou Avaria, que papel tem, se gera plano, com
 * que prioridade e prazo padrão, e quais serviços da Manutenção a tratam. O
 * mapeamento de serviços é o OFICIAL da Manutenção
 * (maintenance_checklist_service_links) — o mesmo do cadastro de serviços, na
 * direção inversa (Pergunta × Serviços).
 *
 * Regras que a tela espelha (o banco decide de novo em cada gravação):
 *  - o detalhe de seleção ESPECIALIZA o gatilho: por opção, um plano por opção
 *    marcada; por pergunta, um plano com um apontamento por opção;
 *  - texto livre é relato (descrição), nunca plano;
 *  - Avaria segue o fluxo próprio e nunca gera plano de manutenção; a pergunta
 *    de Avaria arrasta os seus detalhes e não recebe serviços.
 * Nenhuma chave de pergunta é conhecida aqui: tudo vem do mapeamento.
 */

export interface ParametersPanelProps {
  mapping: MappingData | null;
  catalog: ActionPlanCatalog;
  maintenanceCatalog: MaintenanceCatalog | null;
  perms: ActionPlanPerms;
  actions: PanelActions;
}

type Domain = ActionParameter["actionDomain"];
type Role = ActionParameter["questionRole"];
type Grouping = ActionParameter["planGrouping"];
type Status = ActionParameter["status"];
type MappingService = MappingRow["services"][number];

const ROLE_LABEL: Record<Role, string> = {
  trigger: "Gatilho",
  standalone: "Simples",
  detail: "Detalhe",
  description: "Relato",
};

const ROLE_HINT: Record<Role, string> = {
  trigger: "A pergunta tem detalhe de seleção que especializa o plano.",
  standalone: "Um plano por pergunta, sem especialização.",
  detail: "Cada opção marcada especializa o plano do gatilho.",
  description: "Informativo: acompanha o apontamento como descrição; nunca gera plano.",
};

const FIELD_TYPE_LABEL: Record<string, string> = {
  single_select: "Seleção única",
  multi_select: "Seleção múltipla",
  text: "Texto livre",
};

const GROUPING_LABEL: Record<Grouping, string> = {
  option: "Um plano por opção marcada",
  question: "Um plano da pergunta, um apontamento por opção",
};

const keyOf = (r: Pick<MappingRow, "appId" | "questionKey" | "fieldKey">) => `${r.appId}|${r.questionKey}|${r.fieldKey ?? ""}`;
const parentKeyOf = (r: Pick<MappingRow, "appId" | "questionKey">) => `${r.appId}|${r.questionKey}|`;
const isSelectField = (r: MappingRow) => r.fieldType === "single_select" || r.fieldType === "multi_select";
const isUsable = (s: MappingService) => s.isActive && !s.archived && s.serviceStatus === "active";
const isConflicting = (s: MappingService) => s.isActive && (s.archived || s.serviceStatus !== "active");

const plural = (n: number, one: string, many: string) => `${formatInt(n)} ${n === 1 ? one : many}`;

const norm = (value: string | null | undefined) =>
  (value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Chamada de action que nunca rejeita: falha de rede vira mensagem. */
async function safe<T>(call: () => Promise<Result<T>>, fallback: string): Promise<Result<T>> {
  try {
    return await call();
  } catch {
    return { ok: false, error: fallback };
  }
}

function todayInSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function shiftIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Leitura efetiva de cada linha (parâmetro salvo ou o padrão do motor)
// ---------------------------------------------------------------------------
interface RowInfo {
  row: MappingRow;
  key: string;
  isQuestion: boolean;
  isSelect: boolean;
  /** Campo de texto livre: sempre relato. */
  isText: boolean;
  parent: MappingRow | null;
  domain: Domain;
  /** Detalhe arrastado para Avaria pela pergunta. */
  domainForced: boolean;
  role: Role;
  status: Status;
  generatesPlan: boolean;
  grouping: Grouping;
  /** O apontamento nesta chave vira plano (direto ou especializando o gatilho). */
  producesPlans: boolean;
  /** Ação geradora (conta na cobertura do mapeamento). */
  generator: boolean;
  ownServices: MappingService[];
  inheritedServices: MappingService[];
  disabledLinks: number;
  mapped: boolean;
  conflicting: boolean;
  priority: Priority | null;
  priorityInherited: boolean;
  slaDays: number | null;
  slaInherited: boolean;
  requiresMaintenance: boolean;
}

function buildInfos(rows: MappingRow[]): RowInfo[] {
  const questions = new Map<string, MappingRow>();
  const details = new Map<string, MappingRow[]>();
  for (const r of rows) {
    const pk = parentKeyOf(r);
    if (r.fieldKey == null) questions.set(pk, r);
    else details.set(pk, [...(details.get(pk) ?? []), r]);
  }
  const domainOf = (q: MappingRow | null) => q?.parameter?.actionDomain ?? "maintenance";
  const questionProduces = (q: MappingRow | null) =>
    domainOf(q) === "maintenance" && (q?.parameter?.status ?? "active") === "active" && (q?.parameter?.generatesPlan ?? true);
  // Mesmo critério do motor: detalhe de seleção, papel "detalhe", ativo e de manutenção.
  const specializes = (d: MappingRow, q: MappingRow | null) =>
    isSelectField(d)
    && (d.parameter?.questionRole ?? "detail") === "detail"
    && (d.parameter?.status ?? "active") === "active"
    && domainOf(q) !== "damage"
    && (d.parameter?.actionDomain ?? "maintenance") === "maintenance";

  return rows.map((row) => {
    const p = row.parameter;
    const isQuestion = row.fieldKey == null;
    const isSelect = !isQuestion && isSelectField(row);
    const isText = !isQuestion && !isSelect;
    const parent = isQuestion ? null : questions.get(parentKeyOf(row)) ?? null;
    const domainForced = !isQuestion && domainOf(parent) === "damage";
    const domain: Domain = domainForced ? "damage" : p?.actionDomain ?? "maintenance";
    const hasSpecializing = isQuestion && (details.get(parentKeyOf(row)) ?? []).some((d) => specializes(d, row));
    const role: Role = isQuestion
      ? p?.questionRole ?? (hasSpecializing ? "trigger" : "standalone")
      : isSelect
        ? p?.questionRole ?? "detail"
        : "description";
    const status: Status = p?.status ?? "active";
    const generatesPlan = isQuestion && domain !== "damage" && (p?.generatesPlan ?? true);
    const producesPlans = isQuestion
      ? domain === "maintenance" && status === "active" && generatesPlan
      : isSelect && role === "detail" && status === "active" && domain === "maintenance" && questionProduces(parent);
    const ownServices = row.services.filter((s) => s.isActive);
    const inheritedServices = isQuestion ? [] : (parent?.services ?? []).filter((s) => s.isActive);
    const parentPriority = parent?.parameter?.defaultPriority ?? null;
    const parentSla = parent?.parameter?.slaDays ?? null;
    return {
      row,
      key: keyOf(row),
      isQuestion,
      isSelect,
      isText,
      parent,
      domain,
      domainForced,
      role,
      status,
      generatesPlan,
      grouping: p?.planGrouping ?? "option",
      producesPlans,
      generator: producesPlans && (!isQuestion || !hasSpecializing),
      ownServices,
      inheritedServices,
      disabledLinks: row.services.length - ownServices.length,
      mapped: [...ownServices, ...inheritedServices].some(isUsable),
      conflicting: ownServices.some(isConflicting),
      priority: p?.defaultPriority ?? (isQuestion ? null : parentPriority),
      priorityInherited: !isQuestion && p?.defaultPriority == null && parentPriority != null,
      slaDays: p?.slaDays ?? (isQuestion ? null : parentSla),
      slaInherited: !isQuestion && p?.slaDays == null && parentSla != null,
      requiresMaintenance: (isQuestion ? p?.requiresMaintenance : parent?.parameter?.requiresMaintenance) ?? true,
    };
  });
}

type Chip = "all" | "unmapped" | "mapped" | "conflicting" | "damage" | "no_plan";

const CHIPS: { key: Chip; label: string; test: (i: RowInfo) => boolean }[] = [
  { key: "all", label: "Todas", test: () => true },
  { key: "unmapped", label: "Não mapeadas", test: (i) => i.generator && !i.mapped },
  { key: "mapped", label: "Mapeadas", test: (i) => i.generator && i.mapped },
  { key: "conflicting", label: "Conflitantes", test: (i) => i.conflicting },
  { key: "damage", label: "Avaria", test: (i) => i.domain === "damage" },
  { key: "no_plan", label: "Sem plano", test: (i) => i.domain !== "damage" && !i.producesPlans },
];

function matchesQuery(info: RowInfo, query: string): boolean {
  const needle = norm(query.trim());
  if (!needle) return true;
  const r = info.row;
  return [
    r.question,
    r.questionKey,
    r.fieldLabel,
    r.actionKey,
    r.clusterName,
    ...(r.options ?? []).map((o) => o.label),
    ...info.ownServices.map((s) => s.name),
  ].some((field) => norm(field).includes(needle));
}

function groupByCluster(infos: RowInfo[]) {
  const groups: { key: string; name: string; items: RowInfo[] }[] = [];
  for (const info of infos) {
    const last = groups[groups.length - 1];
    if (last && last.key === info.row.clusterKey) last.items.push(info);
    else groups.push({ key: info.row.clusterKey, name: info.row.clusterName, items: [info] });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------
export function ParametersPanel({ mapping, catalog, maintenanceCatalog, perms, actions }: ParametersPanelProps) {
  const { toast } = useToast();
  const [chip, setChip] = React.useState<Chip>("all");
  const [query, setQuery] = React.useState("");
  const [editing, setEditing] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState(false);
  const [confirmReprocess, setConfirmReprocess] = React.useState(false);

  const rows = mapping?.rows;
  const infos = React.useMemo(() => buildInfos(rows ?? []), [rows]);
  const counts = React.useMemo(() => {
    const out = {} as Record<Chip, number>;
    for (const c of CHIPS) out[c.key] = infos.filter(c.test).length;
    return out;
  }, [infos]);
  const chipTest = CHIPS.find((c) => c.key === chip)?.test ?? (() => true);
  const visible = infos.filter((i) => chipTest(i) && matchesQuery(i, query));
  const groups = groupByCluster(visible);
  const editingInfo = editing ? infos.find((i) => i.key === editing) ?? null : null;
  const canEditAny = perms.manageParameters || perms.manageMappings;
  // Sem o mapeamento, os prazos ainda vêm do catálogo da tela.
  const settings = mapping?.settings ?? catalog.settings;

  const openPlans = (info: RowInfo) =>
    actions.navigate({
      aba: "planos",
      [FILTER_PARAM.question]: info.isQuestion ? info.row.questionKey : null,
      [FILTER_PARAM.actionKey]: info.isQuestion ? null : info.row.actionKey,
      pagina: null,
      agrupar: null,
      secao: null,
      confianca: null,
    });

  const reprocess = async () => {
    const to = todayInSaoPaulo();
    const from = shiftIsoDate(to, -30);
    const fallback = "Não foi possível reprocessar.";
    const result = await safe(() => reprocessActionPlans({ dateFrom: from, dateTo: to }), fallback);
    if (!result.ok || !result.data) {
      toast({ title: result.error ?? fallback, variant: "danger" });
      return;
    }
    const d = result.data;
    toast({
      title: "Reprocessamento concluído.",
      description: [
        plural(d.executions, "checklist reprocessado", "checklists reprocessados"),
        plural(d.itemsCreated, "apontamento novo", "apontamentos novos"),
        plural(d.plansCreated, "plano novo", "planos novos"),
        plural(d.plansRefreshed, "plano em aberto recalculado", "planos em aberto recalculados"),
        d.errors ? plural(d.errors, "falha", "falhas") : null,
      ]
        .filter(Boolean)
        .join(" · "),
      variant: d.errors ? "warning" : "success",
    });
    setNotice(false);
    actions.refresh();
  };

  return (
    <div className="flex flex-col gap-5" data-testid="action-plans-parameters">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-h3 font-semibold text-fg">Parâmetros & Mapeamento</h2>
          {!canEditAny ? (
            <Badge variant="neutral" size="sm" icon={<Lock aria-hidden />}>
              Somente leitura
            </Badge>
          ) : null}
        </div>
        <p className="max-w-3xl text-body-sm text-fg-secondary">
          Como cada pergunta e cada detalhe do Check List de Frota vira (ou não) plano de manutenção — domínio, papel,
          prioridade e prazo padrão — e quais serviços da Manutenção tratam cada ação. O mapeamento de serviços é o
          oficial da Manutenção: o mesmo do cadastro de serviços, aqui no sentido Pergunta × Serviços.
        </p>
      </div>

      {notice ? (
        <Alert
          variant="warning"
          icon={<RefreshCw />}
          onDismiss={() => setNotice(false)}
          data-testid="parameters-reprocess-notice"
          action={
            perms.reprocess ? (
              <Button
                size="sm"
                variant="outline"
                leadingIcon={<RefreshCw />}
                onClick={() => setConfirmReprocess(true)}
                disabled={actions.pending}
                data-testid="parameters-reprocess"
              >
                Reprocessar últimos 30 dias
              </Button>
            ) : undefined
          }
        >
          <AlertTitle>A mudança vale para os próximos checklists</AlertTitle>
          <AlertDescription>
            O domínio, a geração de plano ou o agrupamento mudaram. Para aplicar a regra nova aos checklists dos
            últimos 30 dias, reprocesse: o reprocessamento cria os apontamentos que faltam e recalcula os planos em
            aberto. O histórico nunca é reescrito — decisões encerradas (resolvido, resolvido sem manutenção,
            improcedente, cancelado) ficam como estão.
            {!perms.reprocess ? " Peça a quem tem permissão de reprocessar." : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {!mapping ? (
        <ErrorState
          title="Não foi possível carregar o mapeamento."
          description="As perguntas e os serviços associados não chegaram. Tente de novo; os prazos abaixo seguem disponíveis."
          onRetry={actions.refresh}
          retrying={actions.pending}
        />
      ) : (
        <>
          <CoverageStrip coverage={mapping.coverage} />

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div role="group" aria-label="Filtrar as ações" className="flex flex-wrap gap-1.5">
              {CHIPS.map((c) => {
                const active = chip === c.key;
                return (
                  <button
                    key={c.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setChip(c.key)}
                    data-testid={`parameters-chip-${c.key}`}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-body-sm font-medium hfm-transition hfm-focus-ring",
                      active
                        ? "border-primary bg-primary-soft text-primary-soft-fg"
                        : "border-border bg-surface text-fg-secondary hover:border-border-strong hover:text-fg",
                    )}
                  >
                    {c.label}
                    <span className="rounded-full bg-secondary px-1.5 text-caption text-fg-secondary tabular-nums">
                      {formatInt(counts[c.key])}
                    </span>
                  </button>
                );
              })}
            </div>
            <SearchField
              size="sm"
              value={query}
              onValueChange={setQuery}
              placeholder="Buscar pergunta, chave, detalhe ou serviço"
              aria-label="Buscar no mapeamento"
              wrapperClassName="lg:w-80"
            />
          </div>

          {mapping.rows.length === 0 ? (
            <EmptyState
              variant="panel"
              icon={<Info />}
              title="Nenhuma pergunta do Check List de Frota"
              description="O mapeamento lista as perguntas e os detalhes do aplicativo Check List de Frota. Publique uma versão do formulário para parametrizar as ações."
            />
          ) : visible.length === 0 ? (
            <EmptyState
              variant="panel"
              icon={<SearchX />}
              title="Nenhuma ação neste filtro"
              description="Nenhuma pergunta ou detalhe corresponde ao filtro e à busca. Limpe os filtros para ver o mapeamento completo."
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setChip("all");
                    setQuery("");
                  }}
                >
                  Limpar filtros
                </Button>
              }
            />
          ) : (
            <>
              <p className="text-caption text-fg-muted" aria-live="polite">
                {plural(visible.length, "linha", "linhas")} de {formatInt(infos.length)} · agrupadas por cluster
              </p>
              <MappingTable groups={groups} canEdit={canEditAny} onEdit={setEditing} onOpenPlans={openPlans} />
              <MappingCards groups={groups} canEdit={canEditAny} onEdit={setEditing} onOpenPlans={openPlans} />
            </>
          )}
        </>
      )}

      <SettingsCard settings={settings} canManage={perms.manageParameters} onSaved={actions.refresh} />

      <ParameterDialog
        info={editingInfo}
        maintenanceCatalog={maintenanceCatalog}
        perms={perms}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onSaved={({ reprocessHint }) => {
          if (reprocessHint) setNotice(true);
          actions.refresh();
        }}
      />

      <ConfirmDialog
        open={confirmReprocess}
        onOpenChange={setConfirmReprocess}
        icon={<RefreshCw />}
        title="Reprocessar os últimos 30 dias?"
        description="Os checklists enviados nos últimos 30 dias passam de novo pela classificação com os parâmetros atuais: apontamentos que faltam são criados e os planos em aberto são recalculados. É idempotente e nunca reescreve decisões encerradas."
        confirmLabel="Reprocessar"
        onConfirm={reprocess}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cobertura
// ---------------------------------------------------------------------------
function CoverageStrip({ coverage }: { coverage: Coverage | null | undefined }) {
  const pct = coverage?.pct ?? null;
  const tone = pct == null ? null : pct >= 90 ? "bg-success" : pct >= 60 ? "bg-warning" : "bg-danger";
  const n = (v: number | undefined) => formatInt(v ?? 0);
  return (
    <section aria-label="Cobertura do mapeamento" className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
      <Metric label="Cobertura do mapeamento" value={formatPct(pct)} accent={tone} className="col-span-2 sm:col-span-1">
        {pct != null ? (
          <span className="h-1 w-full overflow-hidden rounded-full bg-surface-tertiary" aria-hidden>
            <span className={cn("block h-full rounded-full", tone)} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
          </span>
        ) : (
          <span className="text-caption text-fg-muted">Sem ações geradoras</span>
        )}
      </Metric>
      <Metric label="Ações geradoras" value={n(coverage?.actionKeys)} hint="Chaves que viram plano" />
      <Metric label="Mapeadas" value={n(coverage?.mapped)} hint="Com serviço ativo" accent="bg-success" />
      <Metric
        label="Não mapeadas"
        value={n(coverage?.unmapped)}
        hint="Sem alta confiança"
        accent={coverage?.unmapped ? "bg-warning" : null}
      />
      <Metric
        label="Conflitantes"
        value={n(coverage?.conflicting)}
        hint="Serviço inativo"
        accent={coverage?.conflicting ? "bg-danger" : null}
      />
      <Metric label="Inativas" value={n(coverage?.inactive)} hint="Só vínculos desativados" />
      <Metric label="Com baixa automática" value={n(coverage?.autoResolve)} hint="Serviço resolve o apontamento" />
    </section>
  );
}

function Metric({
  label,
  value,
  hint,
  accent,
  className,
  children,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  accent?: string | null;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative flex min-h-[5rem] min-w-0 flex-col justify-between gap-1.5 overflow-hidden rounded-lg border border-border bg-surface-raised px-3 py-2.5 shadow-card",
        className,
      )}
    >
      {accent ? <span aria-hidden className={cn("absolute inset-x-0 top-0 h-0.5", accent)} /> : null}
      <span className="text-caption font-medium text-fg-secondary">{label}</span>
      <span className="text-h2 leading-none font-semibold text-fg tabular-nums">{value}</span>
      {children}
      {hint ? <span className="text-caption text-fg-muted">{hint}</span> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Células (tabela e cartões dizem a mesma coisa)
// ---------------------------------------------------------------------------
const Muted = ({ children }: { children: React.ReactNode }) => (
  <span className="text-caption text-fg-muted">{children}</span>
);

function DomainBadge({ info }: { info: RowInfo }) {
  return info.domain === "damage" ? (
    <Badge variant="warning" size="sm" icon={<ShieldAlert aria-hidden />}>
      Avaria — fluxo próprio
    </Badge>
  ) : (
    <Badge variant="info" appearance="outline" size="sm">
      Manutenção
    </Badge>
  );
}

function planEffect(i: RowInfo): { label: string; hint?: string } {
  if (i.domain === "damage") return { label: "Não", hint: "Avaria — fluxo próprio" };
  if (i.isText) return { label: "Não", hint: "Relato" };
  if (i.status === "inactive") return { label: "Não", hint: "Inativa" };
  if (i.isQuestion) {
    if (!i.generatesPlan) return { label: "Não" };
    return { label: "Sim", hint: i.role === "trigger" ? "Especializada pelo detalhe" : undefined };
  }
  if (i.role === "description") return { label: "Não", hint: "Relato" };
  if (!i.producesPlans) return { label: "Não", hint: "O gatilho não gera plano" };
  return { label: "Especializa", hint: GROUPING_LABEL[i.grouping] };
}

function PlanEffect({ info }: { info: RowInfo }) {
  const effect = planEffect(info);
  return (
    <span className="flex flex-col">
      <span className="font-medium text-fg">{effect.label}</span>
      {effect.hint ? <Muted>{effect.hint}</Muted> : null}
    </span>
  );
}

/** Prioridade, prazo e "exige manutenção" só valem quando a chave vira plano. */
const planFieldsApply = (i: RowInfo) => i.domain !== "damage" && !i.isText && i.role !== "description";

function RequiresMaintenance({ info }: { info: RowInfo }) {
  if (!planFieldsApply(info)) return <Muted>—</Muted>;
  return (
    <span className="flex flex-col">
      <span className="text-fg">{info.requiresMaintenance ? "Sim" : "Não"}</span>
      {!info.isQuestion ? <Muted>da pergunta</Muted> : null}
    </span>
  );
}

function DefaultPriority({ info }: { info: RowInfo }) {
  if (!planFieldsApply(info)) return <Muted>—</Muted>;
  if (!info.priority) return <Muted>Pela criticidade</Muted>;
  return (
    <span className="flex flex-col items-start gap-0.5">
      <PriorityBadge priority={info.priority} />
      {info.priorityInherited ? <Muted>da pergunta</Muted> : null}
    </span>
  );
}

function DefaultSla({ info }: { info: RowInfo }) {
  if (!planFieldsApply(info)) return <Muted>—</Muted>;
  if (info.slaDays == null) return <Muted>SLA por prioridade</Muted>;
  return (
    <span className="flex flex-col">
      <span className="text-fg tabular-nums">{plural(info.slaDays, "dia", "dias")}</span>
      {info.slaInherited ? <Muted>da pergunta</Muted> : null}
    </span>
  );
}

function ServicesSummary({ info }: { info: RowInfo }) {
  if (info.domain === "damage") return <Muted>Não se aplica (Avaria)</Muted>;
  if (info.isText) return <Muted>—</Muted>;
  const own = info.ownServices;
  const inherited = info.inheritedServices;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {own.length === 0 && inherited.length === 0 ? (
        info.generator ? (
          <span className="text-caption font-medium text-warning-soft-fg">Sem serviço mapeado</span>
        ) : (
          <Muted>—</Muted>
        )
      ) : null}
      {own.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {own.map((s) => (
            <li key={s.serviceId} className="flex flex-wrap items-center gap-1 text-body-sm text-fg">
              <span className="min-w-0 break-words">{s.name}</span>
              {s.autoResolve ? (
                <Badge variant="success" appearance="outline" size="sm">
                  baixa automática
                </Badge>
              ) : null}
              {isConflicting(s) ? (
                <Badge variant="danger" size="sm">
                  serviço inativo
                </Badge>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {inherited.length > 0 ? <Muted>Da pergunta: {inherited.map((s) => s.name).join(", ")}</Muted> : null}
      {info.disabledLinks > 0 ? <Muted>{plural(info.disabledLinks, "vínculo desativado", "vínculos desativados")}</Muted> : null}
    </div>
  );
}

function OpenPlans({ info, onOpen }: { info: RowInfo; onOpen: (info: RowInfo) => void }) {
  const n = info.row.openPlans;
  if (!n) return <span className="text-fg-muted tabular-nums">0</span>;
  return (
    <button
      type="button"
      onClick={() => onOpen(info)}
      className="rounded-xs font-medium text-link tabular-nums hover:underline hfm-focus-ring"
      aria-label={`Ver ${plural(n, "plano aberto", "planos abertos")} de ${info.row.question}`}
    >
      {formatInt(n)}
    </button>
  );
}

function DetailText({ info }: { info: RowInfo }) {
  const r = info.row;
  if (info.isQuestion) return <Muted>Pergunta (sim/não)</Muted>;
  const options = r.options ?? [];
  const shown = options.slice(0, 4).map((o) => o.label).join(", ");
  return (
    <span className="flex min-w-0 flex-col">
      <span className="text-fg">{r.fieldLabel ?? r.fieldKey}</span>
      <Muted>{FIELD_TYPE_LABEL[r.fieldType ?? ""] ?? "Campo"}</Muted>
      {options.length > 0 ? (
        <Muted>
          {shown}
          {options.length > 4 ? ` +${options.length - 4}` : ""}
        </Muted>
      ) : null}
    </span>
  );
}

function EditButton({ info, canEdit, onEdit, className }: { info: RowInfo; canEdit: boolean; onEdit: (key: string) => void; className?: string }) {
  const what = info.isQuestion ? info.row.question : `${info.row.question} — ${info.row.fieldLabel ?? info.row.fieldKey}`;
  return (
    <Button
      size="sm"
      variant="outline"
      leadingIcon={canEdit ? <Pencil /> : <Eye />}
      onClick={() => onEdit(info.key)}
      aria-label={`${canEdit ? "Editar" : "Ver"} o parâmetro de ${what}`}
      className={className}
      data-testid="parameters-edit"
    >
      {canEdit ? "Editar" : "Ver"}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Tabela (desktop) e cartões (celular)
// ---------------------------------------------------------------------------
type Groups = ReturnType<typeof groupByCluster>;

const COLUMNS = 12;

function MappingTable({
  groups,
  canEdit,
  onEdit,
  onOpenPlans,
}: {
  groups: Groups;
  canEdit: boolean;
  onEdit: (key: string) => void;
  onOpenPlans: (info: RowInfo) => void;
}) {
  return (
    <TableContainer stickyHeader maxHeight="72vh" className="hidden md:block" tabIndex={0} aria-label="Mapeamento por cluster">
      <Table style={{ minWidth: 1480 }}>
        <TableHeader>
          <TableRow>
            <TableHead style={{ width: 260 }}>Pergunta</TableHead>
            <TableHead style={{ width: 180 }}>Detalhe</TableHead>
            <TableHead style={{ width: 160 }}>Action key</TableHead>
            <TableHead>Domínio</TableHead>
            <TableHead>Papel</TableHead>
            <TableHead>Gera plano?</TableHead>
            <TableHead>Exige manutenção?</TableHead>
            <TableHead>Prioridade padrão</TableHead>
            <TableHead>Prazo padrão</TableHead>
            <TableHead style={{ width: 240 }}>Serviços associados</TableHead>
            <TableHead numeric>Planos abertos</TableHead>
            <TableHead>
              <span className="sr-only">Ações</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        {groups.map((group, gi) => (
          <TableBody key={`${group.key}-${gi}`}>
            <tr>
              <th
                scope="rowgroup"
                colSpan={COLUMNS}
                className="border-b border-border bg-surface-secondary px-3 py-1.5 text-left text-caption font-semibold text-fg-secondary"
              >
                {group.name}
                <span className="ml-2 font-normal text-fg-muted">{plural(group.items.length, "linha", "linhas")}</span>
              </th>
            </tr>
            {group.items.map((info) => (
              <TableRow key={info.key} className="[&>td]:py-2 [&>td]:align-top" data-testid={`parameters-row-${info.row.actionKey}`}>
                <TableCell className={cn(!info.isQuestion && "pl-8")}>
                  <span className="flex min-w-0 flex-col">
                    <span className={cn("break-words", info.isQuestion ? "font-medium text-fg" : "text-fg-secondary")}>
                      {!info.isQuestion ? <span aria-hidden>↳ </span> : null}
                      {info.row.question}
                    </span>
                    <span className="font-mono text-caption break-all text-fg-muted">{info.row.questionKey}</span>
                  </span>
                </TableCell>
                <TableCell>
                  <DetailText info={info} />
                </TableCell>
                <TableCell>
                  <span className="flex flex-col">
                    <span className="font-mono text-caption break-all text-fg">{info.row.actionKey}</span>
                    {!info.row.parameter ? <Muted>sem parâmetro (padrão)</Muted> : null}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="flex flex-col items-start gap-0.5">
                    <DomainBadge info={info} />
                    {info.domainForced ? <Muted>segue a pergunta</Muted> : null}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="flex flex-col">
                    <span className="text-fg">{ROLE_LABEL[info.role]}</span>
                    {info.status === "inactive" ? <Muted>inativa</Muted> : null}
                  </span>
                </TableCell>
                <TableCell>
                  <PlanEffect info={info} />
                </TableCell>
                <TableCell>
                  <RequiresMaintenance info={info} />
                </TableCell>
                <TableCell>
                  <DefaultPriority info={info} />
                </TableCell>
                <TableCell>
                  <DefaultSla info={info} />
                </TableCell>
                <TableCell>
                  <ServicesSummary info={info} />
                </TableCell>
                <TableCell numeric>
                  <OpenPlans info={info} onOpen={onOpenPlans} />
                </TableCell>
                <TableCell align="right">
                  <EditButton info={info} canEdit={canEdit} onEdit={onEdit} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        ))}
      </Table>
    </TableContainer>
  );
}

function MappingCards({
  groups,
  canEdit,
  onEdit,
  onOpenPlans,
}: {
  groups: Groups;
  canEdit: boolean;
  onEdit: (key: string) => void;
  onOpenPlans: (info: RowInfo) => void;
}) {
  return (
    <div className="flex flex-col gap-4 md:hidden">
      {groups.map((group, gi) => (
        <section key={`${group.key}-${gi}`} aria-label={`Cluster ${group.name}`} className="flex flex-col gap-2">
          <h3 className="border-b border-border pb-1 text-caption font-semibold text-fg-secondary">
            {group.name} <span className="font-normal text-fg-muted">· {plural(group.items.length, "linha", "linhas")}</span>
          </h3>
          <ul className="flex flex-col gap-2">
            {group.items.map((info) => (
              <li
                key={info.key}
                className={cn(
                  "flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-3 shadow-card",
                  !info.isQuestion && "ml-3",
                )}
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className={cn("break-words text-body-sm", info.isQuestion ? "font-medium text-fg" : "text-fg-secondary")}>
                    {!info.isQuestion ? <span aria-hidden>↳ </span> : null}
                    {info.row.question}
                  </p>
                  {!info.isQuestion ? (
                    <p className="text-caption text-fg">
                      {info.row.fieldLabel ?? info.row.fieldKey}{" "}
                      <span className="text-fg-muted">· {FIELD_TYPE_LABEL[info.row.fieldType ?? ""] ?? "Campo"}</span>
                    </p>
                  ) : null}
                  <p className="font-mono text-caption break-all text-fg-muted">{info.row.actionKey}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <DomainBadge info={info} />
                  <Badge variant="neutral" appearance="outline" size="sm">
                    {ROLE_LABEL[info.role]}
                  </Badge>
                  {info.status === "inactive" ? (
                    <Badge variant="neutral" size="sm">
                      Inativa
                    </Badge>
                  ) : null}
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-body-sm">
                  <div className="flex min-w-0 flex-col">
                    <dt className="text-caption text-fg-muted">Gera plano?</dt>
                    <dd>
                      <PlanEffect info={info} />
                    </dd>
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <dt className="text-caption text-fg-muted">Exige manutenção?</dt>
                    <dd>
                      <RequiresMaintenance info={info} />
                    </dd>
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <dt className="text-caption text-fg-muted">Prioridade padrão</dt>
                    <dd>
                      <DefaultPriority info={info} />
                    </dd>
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <dt className="text-caption text-fg-muted">Prazo padrão</dt>
                    <dd>
                      <DefaultSla info={info} />
                    </dd>
                  </div>
                  <div className="col-span-2 flex min-w-0 flex-col">
                    <dt className="text-caption text-fg-muted">Serviços associados</dt>
                    <dd>
                      <ServicesSummary info={info} />
                    </dd>
                  </div>
                </dl>
                <div className="flex items-center justify-between gap-2 border-t border-border-subtle pt-2">
                  <span className="text-caption text-fg-muted">
                    Planos abertos: <OpenPlans info={info} onOpen={onOpenPlans} />
                  </span>
                  <EditButton info={info} canEdit={canEdit} onEdit={onEdit} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edição de uma linha: parâmetro + serviços
// ---------------------------------------------------------------------------
interface Draft {
  domain: Domain;
  role: Role;
  generatesPlan: boolean;
  planGrouping: Grouping;
  actionTitle: string;
  defaultPriority: Priority | "";
  slaDays: string;
  requiresMaintenance: boolean;
  requiresManualAnalysis: boolean;
  driverVisible: boolean;
  status: Status;
  notes: string;
}

interface ServiceDraft {
  serviceId: string;
  autoResolve: boolean;
}

function draftOf(info: RowInfo): Draft {
  const p = info.row.parameter;
  return {
    domain: info.domain,
    role: info.role,
    generatesPlan: info.isQuestion ? info.generatesPlan : false,
    planGrouping: info.grouping,
    actionTitle: p?.actionTitle ?? "",
    defaultPriority: p?.defaultPriority ?? "",
    slaDays: p?.slaDays != null ? String(p.slaDays) : "",
    requiresMaintenance: p?.requiresMaintenance ?? true,
    requiresManualAnalysis: p?.requiresManualAnalysis ?? false,
    driverVisible: p?.driverVisible ?? true,
    status: p?.status ?? "active",
    notes: p?.notes ?? "",
  };
}

const serializeServices = (list: ServiceDraft[]) =>
  JSON.stringify(list.map((s) => `${s.serviceId}|${s.autoResolve ? 1 : 0}`).sort());

function ParameterDialog({
  info,
  maintenanceCatalog,
  perms,
  onOpenChange,
  onSaved,
}: {
  info: RowInfo | null;
  maintenanceCatalog: MaintenanceCatalog | null;
  perms: ActionPlanPerms;
  onOpenChange: (open: boolean) => void;
  onSaved: (result: { reprocessHint: boolean }) => void;
}) {
  return (
    <Dialog open={info != null} onOpenChange={onOpenChange}>
      <DialogContent size="xl" data-testid="parameters-dialog">
        {info ? (
          <ParameterForm
            key={info.key}
            info={info}
            maintenanceCatalog={maintenanceCatalog}
            perms={perms}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ParameterForm({
  info,
  maintenanceCatalog,
  perms,
  onClose,
  onSaved,
}: {
  info: RowInfo;
  maintenanceCatalog: MaintenanceCatalog | null;
  perms: ActionPlanPerms;
  onClose: () => void;
  onSaved: (result: { reprocessHint: boolean }) => void;
}) {
  const { toast } = useToast();
  const { row, isQuestion, isSelect, isText } = info;
  const [initial] = React.useState(() => draftOf(info));
  const [draft, setDraft] = React.useState<Draft>(initial);
  const [initialServices] = React.useState<ServiceDraft[]>(() =>
    info.ownServices.map((s) => ({ serviceId: s.serviceId, autoResolve: s.autoResolve })),
  );
  const [services, setServices] = React.useState<ServiceDraft[]>(initialServices);
  const [tab, setTab] = React.useState<"parametro" | "servicos">("parametro");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const canParams = perms.manageParameters;
  const damage = draft.domain === "damage";
  const servicesApplicable = !isText && !damage && !info.domainForced;
  const canServices = perms.manageMappings && servicesApplicable && maintenanceCatalog != null;
  const readOnly = !canParams && !canServices;
  const specializing = isSelect && draft.role === "detail";
  const showPlanFields = !damage && !isText && (isQuestion || specializing);

  // Validação do óbvio (o banco confere de novo).
  const slaText = draft.slaDays.trim();
  const slaValue = slaText === "" ? null : /^\d{1,3}$/.test(slaText) ? Number(slaText) : Number.NaN;
  const slaInvalid = slaValue != null && !(slaValue >= 0 && slaValue <= 365);
  const title = draft.actionTitle.trim();
  const titleInvalid = isQuestion && title !== "" && (title.length < 2 || title.length > 160);
  const invalid = canParams && showPlanFields && (slaInvalid || titleInvalid);

  const paramDirty = canParams && JSON.stringify(draft) !== JSON.stringify(initial);
  const servicesDirty = canServices && serializeServices(services) !== serializeServices(initialServices);
  const dirty = paramDirty || servicesDirty;

  const changeDomain = (value: Domain) =>
    setDraft((d) => ({
      ...d,
      domain: value,
      // Avaria nunca gera plano; ao voltar para Manutenção, volta o que estava.
      generatesPlan: value === "damage" ? false : isQuestion ? initial.generatesPlan || initial.domain === "damage" : d.generatesPlan,
    }));

  const buildInput = (): ParameterInput => ({
    appId: row.appId,
    questionKey: row.questionKey,
    fieldKey: row.fieldKey,
    actionDomain: info.domainForced ? "damage" : draft.domain,
    questionRole: isText ? "description" : draft.role,
    status: draft.status,
    driverVisible: draft.driverVisible,
    notes: draft.notes.trim() || null,
    ...(showPlanFields ? { defaultPriority: draft.defaultPriority || null, slaDays: slaValue } : {}),
    ...(isQuestion
      ? {
          generatesPlan: damage ? false : draft.generatesPlan,
          actionTitle: title || null,
          requiresMaintenance: draft.requiresMaintenance,
          requiresManualAnalysis: draft.requiresManualAnalysis,
        }
      : {}),
    ...(isSelect ? { planGrouping: draft.planGrouping } : {}),
  });

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || readOnly) return;
    if (invalid) {
      setTab("parametro");
      return;
    }
    if (!dirty) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);

    let reprocessHint = false;
    let savedParameter = false;
    if (paramDirty) {
      const fallback = "Não foi possível salvar o parâmetro.";
      const result = await safe(() => saveParameter(buildInput()), fallback);
      if (!result.ok) {
        setSaving(false);
        setError(result.error ?? fallback);
        setTab("parametro");
        return;
      }
      savedParameter = true;
      // Sem parâmetro anterior o banco não sinaliza; a tela sabe se o comportamento mudou.
      const behaviorChanged =
        draft.domain !== initial.domain
        || draft.generatesPlan !== initial.generatesPlan
        || draft.planGrouping !== initial.planGrouping
        || draft.role !== initial.role
        || draft.status !== initial.status;
      reprocessHint = Boolean(result.data?.reprocessHint) || (row.parameter == null && behaviorChanged);
    }

    if (servicesDirty) {
      const fallback = "Não foi possível salvar o mapeamento de serviços.";
      const result = await safe(
        () => saveQuestionServices({ appId: row.appId, questionKey: row.questionKey, fieldKey: row.fieldKey, services }),
        fallback,
      );
      if (!result.ok) {
        setSaving(false);
        if (savedParameter) {
          // O parâmetro já mudou: fechar evita regravar sobre dado velho.
          toast({
            title: `O parâmetro foi salvo, mas o mapeamento de serviços não: ${result.error ?? fallback}`,
            description: "Abra a linha de novo e grave os serviços.",
            variant: "danger",
          });
          onSaved({ reprocessHint });
          onClose();
          return;
        }
        setError(result.error ?? fallback);
        setTab("servicos");
        return;
      }
    }

    setSaving(false);
    toast({
      title: "Mapeamento atualizado.",
      description: [
        paramDirty ? "Parâmetro gravado." : null,
        servicesDirty ? `${plural(services.length, "serviço associado", "serviços associados")}.` : null,
      ]
        .filter(Boolean)
        .join(" "),
      variant: "success",
    });
    onSaved({ reprocessHint });
    onClose();
  };

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" aria-busy={saving}>
      <DialogHeader>
        <DialogTitle>{readOnly ? "Parâmetro da ação" : "Editar parâmetro da ação"}</DialogTitle>
        <DialogDescription className="flex flex-col gap-0.5">
          <span className="text-fg">{row.question}</span>
          {!isQuestion ? (
            <span>
              ↳ {row.fieldLabel ?? row.fieldKey} · {FIELD_TYPE_LABEL[row.fieldType ?? ""] ?? "Campo"}
            </span>
          ) : null}
          <span className="font-mono text-caption break-all">{row.actionKey}</span>
          <span className="text-caption">
            {row.clusterName} · texto da versão {row.versionLabel} · {plural(row.openPlans, "plano aberto", "planos abertos")}
          </span>
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4">
        {error ? (
          <Alert variant="danger">
            <AlertTitle>Não foi possível salvar</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Tabs value={tab} onValueChange={(v) => setTab(v as "parametro" | "servicos")}>
          <TabsList aria-label="Partes do parâmetro">
            <TabsTrigger value="parametro">Parâmetro</TabsTrigger>
            <TabsTrigger value="servicos" count={services.length} data-testid="parameters-services-tab">
              Serviços
            </TabsTrigger>
          </TabsList>

          <TabsContent value="parametro" forceMount hidden={tab !== "parametro"}>
            <ParameterFields
              info={info}
              draft={draft}
              initial={initial}
              set={set}
              changeDomain={changeDomain}
              readOnly={!canParams}
              showPlanFields={showPlanFields}
              specializing={specializing}
              slaInvalid={slaInvalid}
              titleInvalid={titleInvalid}
            />
          </TabsContent>

          <TabsContent value="servicos" forceMount hidden={tab !== "servicos"}>
            <ServicesEditor
              info={info}
              damage={damage}
              services={services}
              onChange={setServices}
              catalog={maintenanceCatalog}
              editable={canServices}
              canManage={perms.manageMappings}
              dirty={servicesDirty}
            />
          </TabsContent>
        </Tabs>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>
          {readOnly ? "Fechar" : "Cancelar"}
        </Button>
        {!readOnly ? (
          <Button
            type="submit"
            leadingIcon={<Save />}
            loading={saving}
            disabled={!dirty || invalid}
            data-testid="parameters-save"
          >
            Salvar
          </Button>
        ) : null}
      </DialogFooter>
    </form>
  );
}

function ParameterFields({
  info,
  draft,
  initial,
  set,
  changeDomain,
  readOnly,
  showPlanFields,
  specializing,
  slaInvalid,
  titleInvalid,
}: {
  info: RowInfo;
  draft: Draft;
  initial: Draft;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  changeDomain: (value: Domain) => void;
  readOnly: boolean;
  showPlanFields: boolean;
  specializing: boolean;
  slaInvalid: boolean;
  titleInvalid: boolean;
}) {
  const { row, isQuestion, isSelect, isText } = info;
  const damage = draft.domain === "damage";
  const exampleOption = row.options?.[0]?.label;
  const roleOptions: Role[] = isQuestion ? ["trigger", "standalone"] : isSelect ? ["detail", "description"] : ["description"];

  return (
    <fieldset disabled={readOnly} className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">
      {readOnly ? (
        <Alert variant="neutral" icon={<Info />}>
          <AlertDescription>Modo leitura: você não tem permissão para alterar parâmetros.</AlertDescription>
        </Alert>
      ) : null}

      {damage ? (
        <Alert variant="warning" icon={<ShieldAlert />}>
          <AlertTitle>Avaria — fluxo próprio</AlertTitle>
          <AlertDescription>
            {info.domainForced
              ? "A pergunta deste detalhe é de Avaria: o detalhe segue a pergunta para o fluxo de Sinistros/Avarias e nunca gera plano de manutenção."
              : isQuestion
                ? "Apontamentos desta pergunta vão para o fluxo de Sinistros/Avarias e nunca geram plano de manutenção. Os detalhes da pergunta passam a Avaria também, e ela não recebe serviços de manutenção."
                : "Este detalhe não especializa planos de manutenção e não recebe serviços."}
          </AlertDescription>
        </Alert>
      ) : null}

      {isText ? (
        <Alert variant="info" icon={<Info />}>
          <AlertDescription>
            Campo de texto livre é relato: o texto acompanha o apontamento da pergunta como descrição. Nunca gera
            plano nem recebe serviços.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          label="Domínio"
          helperText={
            info.domainForced
              ? "Segue a pergunta (Avaria)."
              : "Manutenção alimenta este módulo; Avaria segue o fluxo próprio e nunca gera plano."
          }
        >
          <NativeSelect
            value={draft.domain}
            disabled={readOnly || info.domainForced || isText}
            onChange={(e) => changeDomain(e.target.value as Domain)}
            data-testid="parameters-domain"
          >
            <option value="maintenance">Manutenção</option>
            <option value="damage">Avaria — fluxo próprio</option>
          </NativeSelect>
        </FormField>

        <FormField label="Papel" helperText={ROLE_HINT[draft.role]}>
          <NativeSelect
            value={draft.role}
            disabled={readOnly || roleOptions.length === 1}
            onChange={(e) => set("role", e.target.value as Role)}
          >
            {roleOptions.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </NativeSelect>
        </FormField>

        {isQuestion && !damage ? (
          <CheckboxField
            className="sm:col-span-2"
            label="Gera plano"
            description="Desmarcado, a inconformidade desta pergunta não vira plano de manutenção."
            checked={draft.generatesPlan}
            onCheckedChange={(c) => set("generatesPlan", c === true)}
          />
        ) : null}

        {specializing && !damage ? (
          <FormField
            label="Agrupamento"
            className="sm:col-span-2"
            helperText={
              draft.planGrouping === "option"
                ? `Cada opção marcada abre o seu plano${exampleOption ? ` (ex.: “${row.question} — ${exampleOption}”)` : ""}.`
                : "Um plano da pergunta, com um apontamento para cada opção marcada."
            }
          >
            <NativeSelect value={draft.planGrouping} onChange={(e) => set("planGrouping", e.target.value as Grouping)}>
              <option value="option">{GROUPING_LABEL.option}</option>
              <option value="question">{GROUPING_LABEL.question}</option>
            </NativeSelect>
          </FormField>
        ) : null}

        {isQuestion && showPlanFields ? (
          <FormField
            label="Título da ação"
            className="sm:col-span-2"
            labelHint="Opcional"
            helperText="Nome do plano. Vazio: o texto da pergunta."
            error={titleInvalid ? "Use entre 2 e 160 caracteres." : undefined}
          >
            <Input
              value={draft.actionTitle}
              onChange={(e) => set("actionTitle", e.target.value)}
              maxLength={160}
              placeholder={row.question}
            />
          </FormField>
        ) : null}

        {showPlanFields ? (
          <>
            <FormField
              label="Prioridade padrão"
              helperText={
                isQuestion
                  ? "Vazio: pela criticidade da pergunta (crítica → Alta; demais → Média)."
                  : "Vazio: a da pergunta (ou pela criticidade)."
              }
            >
              <NativeSelect
                value={draft.defaultPriority}
                onChange={(e) => set("defaultPriority", e.target.value as Priority | "")}
              >
                <option value="">{isQuestion ? "Pela criticidade" : "Da pergunta"}</option>
                {PRIORITY_ORDER.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField
              label="Prazo padrão"
              helperText={
                isQuestion
                  ? "Dias corridos desde o 1º apontamento. Vazio: SLA por prioridade (Prazos e janelas)."
                  : "Vazio: o da pergunta ou o SLA por prioridade."
              }
              error={slaInvalid ? "Informe de 0 a 365 dias, ou deixe vazio." : undefined}
            >
              <Input
                inputMode="numeric"
                value={draft.slaDays}
                onChange={(e) => set("slaDays", e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                trailingAddon="dias"
                placeholder="SLA por prioridade"
              />
            </FormField>
          </>
        ) : null}

        {isQuestion && showPlanFields ? (
          <>
            <CheckboxField
              label="Exige manutenção"
              description="Os planos deste item esperam uma manutenção para serem resolvidos."
              checked={draft.requiresMaintenance}
              onCheckedChange={(c) => set("requiresMaintenance", c === true)}
            />
            <CheckboxField
              label="Exige análise manual"
              description="O plano nasce “Em análise” em vez de “Novo”."
              checked={draft.requiresManualAnalysis}
              onCheckedChange={(c) => set("requiresManualAnalysis", c === true)}
            />
          </>
        ) : null}

        <CheckboxField
          label="Visível ao operacional"
          description="O apontamento aparece em “Meus relatos” de quem fez o checklist."
          checked={draft.driverVisible}
          onCheckedChange={(c) => set("driverVisible", c === true)}
        />

        <FormField label="Situação" helperText="Inativa: a chave deixa de gerar ou especializar planos.">
          <NativeSelect value={draft.status} onChange={(e) => set("status", e.target.value as Status)}>
            <option value="active">Ativa</option>
            <option value="inactive">Inativa</option>
          </NativeSelect>
        </FormField>

        <FormField label="Observações" className="sm:col-span-2" labelHint="Opcional">
          <Textarea
            value={draft.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="Contexto da parametrização (fica visível para quem gere o módulo)."
          />
        </FormField>
      </div>

      {!isQuestion && !isText && specializing && !damage ? (
        <p className="text-caption text-fg-muted">
          Título, “exige manutenção” e “exige análise manual” vêm da pergunta (gatilho).
        </p>
      ) : null}

      {!readOnly && (draft.domain !== initial.domain || draft.planGrouping !== initial.planGrouping || draft.generatesPlan !== initial.generatesPlan) ? (
        <p className="text-caption text-fg-secondary" role="status">
          Mudança de comportamento: vale para os próximos checklists. Depois de salvar, a tela oferece reprocessar os
          últimos 30 dias (decisões encerradas nunca são reescritas).
        </p>
      ) : null}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Pergunta × Serviços (mapeamento oficial da Manutenção)
// ---------------------------------------------------------------------------
interface ServiceView {
  id: string;
  name: string;
  cluster: string | null;
  inactive: boolean;
}

function ServicesEditor({
  info,
  damage,
  services,
  onChange,
  catalog,
  editable,
  canManage,
  dirty,
}: {
  info: RowInfo;
  damage: boolean;
  services: ServiceDraft[];
  onChange: (next: ServiceDraft[]) => void;
  catalog: MaintenanceCatalog | null;
  editable: boolean;
  canManage: boolean;
  dirty: boolean;
}) {
  const known = React.useMemo(() => {
    const map = new Map<string, ServiceView>();
    for (const s of info.row.services) {
      map.set(s.serviceId, { id: s.serviceId, name: s.name, cluster: s.cluster, inactive: s.archived || s.serviceStatus !== "active" });
    }
    for (const s of catalog?.services ?? []) {
      map.set(s.id, { id: s.id, name: s.name, cluster: s.clusterName, inactive: s.status !== "active" });
    }
    return map;
  }, [info.row.services, catalog]);

  const remove = (id: string) => onChange(services.filter((s) => s.serviceId !== id));
  const toggleAuto = (id: string, value: boolean) =>
    onChange(services.map((s) => (s.serviceId === id ? { ...s, autoResolve: value } : s)));

  if (info.isText) {
    return (
      <Alert variant="info" icon={<Info />}>
        <AlertDescription>Relatos (texto livre) não geram plano e não recebem serviços.</AlertDescription>
      </Alert>
    );
  }

  if (damage || info.domainForced) {
    return (
      <div className="flex flex-col gap-3">
        <Alert variant="warning" icon={<ShieldAlert />}>
          <AlertTitle>Avaria — fluxo próprio</AlertTitle>
          <AlertDescription>
            Pergunta do domínio Avaria não é mapeada para serviços de manutenção: o apontamento segue para o fluxo de
            Sinistros/Avarias.
          </AlertDescription>
        </Alert>
        {info.ownServices.length > 0 ? (
          <p className="text-caption text-fg-secondary">
            Vínculos existentes (não usados enquanto for Avaria): {info.ownServices.map((s) => s.name).join(", ")}. Para
            removê-los, volte o domínio para Manutenção ou ajuste no cadastro do serviço.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="parameters-services">
      <Alert variant="info" icon={<Link2 />}>
        <AlertDescription>
          Quando o apontamento é <strong>inconforme</strong> nesta {info.isQuestion ? "pergunta" : "opção do detalhe"},
          estes serviços são sugeridos ao abrir a manutenção e dão a conciliação de <strong>alta confiança</strong>. Com
          “baixa automática”, concluir o serviço resolve o apontamento vinculado. É o mapeamento oficial da Manutenção —
          o mesmo do cadastro de serviços.
        </AlertDescription>
      </Alert>

      {!canManage ? (
        <Alert variant="neutral" icon={<Info />}>
          <AlertDescription>Modo leitura: você não tem permissão para alterar o mapeamento de serviços.</AlertDescription>
        </Alert>
      ) : !catalog ? (
        <Alert variant="neutral" icon={<Info />}>
          <AlertDescription>
            O catálogo de serviços da Manutenção não está disponível para o seu acesso; os serviços abaixo aparecem só
            para leitura.
          </AlertDescription>
        </Alert>
      ) : null}

      {info.inheritedServices.length > 0 ? (
        <p className="text-caption text-fg-secondary">
          Também valem para este detalhe os serviços da pergunta:{" "}
          <span className="text-fg">{info.inheritedServices.map((s) => s.name).join(", ")}</span>. Edite-os na linha da
          pergunta.
        </p>
      ) : null}

      <section aria-label="Serviços associados" className="flex flex-col gap-2">
        <h4 className="text-label font-semibold text-fg">Serviços associados</h4>
        {services.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-caption text-fg-muted">
            Nenhum serviço associado. Sem serviço, não há baixa automática nem conciliação de alta confiança.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border-subtle rounded-md border border-border bg-surface">
            {services.map((s) => {
              const view = known.get(s.serviceId);
              const name = view?.name ?? "Serviço";
              return (
                <li key={s.serviceId} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-col">
                    <span className="flex flex-wrap items-center gap-1.5 text-body-sm text-fg">
                      <span className="break-words">{name}</span>
                      {view?.inactive ? (
                        <Badge variant="danger" size="sm">
                          serviço inativo — revisar
                        </Badge>
                      ) : null}
                    </span>
                    {view?.cluster ? <Muted>{view.cluster}</Muted> : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {editable ? (
                      <label className="flex cursor-pointer items-center gap-2 text-body-sm text-fg">
                        <Checkbox
                          checked={s.autoResolve}
                          onCheckedChange={(c) => toggleAuto(s.serviceId, c === true)}
                          aria-label={`Baixa automática ao concluir ${name}`}
                        />
                        Baixa automática
                      </label>
                    ) : (
                      <Muted>{s.autoResolve ? "Baixa automática" : "Sem baixa automática"}</Muted>
                    )}
                    {editable ? (
                      <IconButton label={`Remover ${name}`} variant="danger" size="sm" onClick={() => remove(s.serviceId)}>
                        <Trash2 aria-hidden />
                      </IconButton>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {editable && catalog ? (
        <ServicePicker catalog={catalog} services={services} onChange={onChange} />
      ) : null}

      {dirty ? (
        <p className="text-caption text-fg-secondary" aria-live="polite">
          Serviços alterados. Salve para gravar o mapeamento (a gravação substitui o conjunto desta chave; os que saem
          são desativados, nunca apagados).
        </p>
      ) : null}
    </div>
  );
}

function ServicePicker({
  catalog,
  services,
  onChange,
}: {
  catalog: MaintenanceCatalog;
  services: ServiceDraft[];
  onChange: (next: ServiceDraft[]) => void;
}) {
  const baseId = React.useId();
  const [query, setQuery] = React.useState("");
  const selected = new Set(services.map((s) => s.serviceId));
  const needle = norm(query.trim());

  const available = catalog.services
    .filter((s) => s.status === "active" || selected.has(s.id))
    .filter(
      (s) =>
        !needle
        || [s.name, s.clusterName, ...(s.aliasNames ?? [])].some((field) => norm(field).includes(needle)),
    )
    .sort((a, b) => a.clusterName.localeCompare(b.clusterName, "pt-BR") || a.name.localeCompare(b.name, "pt-BR"));

  const groups: { cluster: string; items: typeof available }[] = [];
  for (const s of available) {
    const last = groups[groups.length - 1];
    if (last && last.cluster === s.clusterName) last.items.push(s);
    else groups.push({ cluster: s.clusterName, items: [s] });
  }

  const toggle = (id: string, checked: boolean) =>
    onChange(checked ? [...services.filter((s) => s.serviceId !== id), { serviceId: id, autoResolve: true }] : services.filter((s) => s.serviceId !== id));

  return (
    <section aria-label="Adicionar serviços" className="flex flex-col gap-2 rounded-md border border-border bg-surface-secondary p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h4 className="text-label font-semibold text-fg">Catálogo de serviços da Manutenção</h4>
        <SearchField
          size="sm"
          value={query}
          onValueChange={setQuery}
          placeholder="Buscar serviço ou cluster"
          aria-label="Buscar serviço"
          wrapperClassName="sm:w-64"
        />
      </div>
      <div className="max-h-64 overflow-y-auto rounded-sm border border-border bg-surface p-1">
        {groups.length === 0 ? (
          <p className="px-2 py-3 text-caption text-fg-muted">
            {needle ? "Nenhum serviço corresponde à busca." : "Nenhum serviço ativo no catálogo da Manutenção."}
          </p>
        ) : (
          groups.map((group, gi) => (
            <div key={`${group.cluster}-${gi}`} role="group" aria-label={group.cluster}>
              <p className="px-1.5 pt-1.5 pb-0.5 text-overline font-semibold tracking-wide text-fg-muted uppercase">
                {group.cluster}
              </p>
              {group.items.map((s) => {
                const id = `${baseId}-${s.id}`;
                return (
                  <div key={s.id} className="flex min-h-8 items-center gap-2 rounded-xs px-1.5 hover:bg-hover-overlay">
                    <Checkbox id={id} checked={selected.has(s.id)} onCheckedChange={(c) => toggle(s.id, c === true)} />
                    <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2 py-1 text-body-sm text-fg">
                      <span className="truncate">{s.name}</span>
                      {s.status !== "active" ? <span className="shrink-0 text-caption text-fg-muted">inativo</span> : null}
                    </label>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
      <p className="text-caption text-fg-muted">
        Serviço marcado entra com “baixa automática”; ajuste acima. Só serviços ativos podem ser adicionados.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Prazos e janelas
// ---------------------------------------------------------------------------
type NumericSetting = Exclude<keyof ActionPlanSettings, "autoReconcile" | "updatedAt">;

const SLA_FIELDS: { key: NumericSetting; priority: Priority }[] = [
  { key: "slaDaysCritical", priority: "critical" },
  { key: "slaDaysHigh", priority: "high" },
  { key: "slaDaysMedium", priority: "medium" },
  { key: "slaDaysLow", priority: "low" },
];

const WINDOW_FIELDS: { key: NumericSetting; label: string; helper: string }[] = [
  {
    key: "dueSoonDays",
    label: "“Vence em breve”",
    helper: "Dias antes do prazo em que o plano passa a “Vence em breve”.",
  },
  {
    key: "recurrenceWindowDays",
    label: "Janela de reincidência",
    helper: "Mesmo veículo e mesmo item até N dias após o fechamento: o novo plano é marcado como possível reincidência.",
  },
  {
    key: "reconciliationWindowDays",
    label: "Janela de conciliação",
    helper: "Manutenções do veículo até N dias após o último apontamento entram como candidatas.",
  },
];

const SETTING_RANGE: Record<NumericSetting, [number, number]> = {
  slaDaysCritical: [0, 365],
  slaDaysHigh: [0, 365],
  slaDaysMedium: [0, 365],
  slaDaysLow: [0, 365],
  dueSoonDays: [1, 30],
  recurrenceWindowDays: [1, 365],
  reconciliationWindowDays: [1, 180],
};

const NUMERIC_KEYS = Object.keys(SETTING_RANGE) as NumericSetting[];

function SettingsCard({
  settings,
  canManage,
  onSaved,
}: {
  settings: ActionPlanSettings;
  canManage: boolean;
  onSaved: () => void;
}) {
  const headingId = React.useId();
  const signature = JSON.stringify(settings);
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col rounded-lg border border-border bg-surface-raised shadow-card"
      data-testid="parameters-settings"
    >
      <header className="flex flex-col gap-1 border-b border-border px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h3 id={headingId} className="text-card-title font-semibold text-fg">
            Prazos e janelas
          </h3>
          <p className="text-body-sm text-fg-muted">
            Prazo padrão por prioridade (quando a ação não define o seu), aviso de “vence em breve” e as janelas de
            reincidência e de conciliação. Os prazos valem para planos novos e para mudança de prioridade com recálculo;
            prazos já definidos não mudam.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
          {!canManage ? (
            <Badge variant="neutral" size="sm" icon={<Lock aria-hidden />}>
              Somente leitura
            </Badge>
          ) : null}
          {settings.updatedAt ? <Muted>Atualizado em {formatDateTime(settings.updatedAt)}</Muted> : null}
        </div>
      </header>
      <div className="p-4">
        {canManage ? <SettingsForm key={signature} settings={settings} onSaved={onSaved} /> : <SettingsView settings={settings} />}
      </div>
    </section>
  );
}

function SettingsView({ settings }: { settings: ActionPlanSettings }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
      {SLA_FIELDS.map((f) => (
        <div key={f.key} className="flex min-w-0 flex-col">
          <dt className="text-caption text-fg-muted">Prazo · {PRIORITY_LABEL[f.priority]}</dt>
          <dd className="text-body font-medium text-fg tabular-nums">{plural(settings[f.key], "dia", "dias")}</dd>
        </div>
      ))}
      {WINDOW_FIELDS.map((f) => (
        <div key={f.key} className="flex min-w-0 flex-col">
          <dt className="text-caption text-fg-muted">{f.label}</dt>
          <dd className="text-body font-medium text-fg tabular-nums">{plural(settings[f.key], "dia", "dias")}</dd>
        </div>
      ))}
      <div className="flex min-w-0 flex-col">
        <dt className="text-caption text-fg-muted">Conciliação automática</dt>
        <dd className="text-body font-medium text-fg">{settings.autoReconcile ? "Ligada (alta confiança)" : "Desligada"}</dd>
      </div>
    </dl>
  );
}

function SettingsForm({ settings, onSaved }: { settings: ActionPlanSettings; onSaved: () => void }) {
  const { toast } = useToast();
  const initial = React.useMemo(() => {
    const out = {} as Record<NumericSetting, string>;
    for (const k of NUMERIC_KEYS) out[k] = String(settings[k]);
    return out;
  }, [settings]);
  const [values, setValues] = React.useState(initial);
  const [autoReconcile, setAutoReconcile] = React.useState(settings.autoReconcile);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const parsed = (k: NumericSetting) => (/^\d{1,3}$/.test(values[k]) ? Number(values[k]) : null);
  const errorOf = (k: NumericSetting) => {
    const [min, max] = SETTING_RANGE[k];
    const v = parsed(k);
    return v == null || v < min || v > max ? `De ${min} a ${max} dias.` : undefined;
  };
  const invalid = NUMERIC_KEYS.some((k) => errorOf(k));
  const dirty =
    autoReconcile !== settings.autoReconcile || NUMERIC_KEYS.some((k) => values[k] !== initial[k]);

  const setValue = (k: NumericSetting, v: string) => setValues((prev) => ({ ...prev, [k]: v.replace(/[^\d]/g, "").slice(0, 3) }));

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || invalid || !dirty) return;
    setSaving(true);
    setError(null);
    const payload: Partial<ActionPlanSettings> = { autoReconcile };
    for (const k of NUMERIC_KEYS) payload[k] = parsed(k) ?? settings[k];
    const fallback = "Não foi possível salvar as configurações.";
    const result = await safe(() => saveActionPlanSettings(payload), fallback);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? fallback);
      toast({ title: result.error ?? fallback, variant: "danger" });
      return;
    }
    toast({ title: "Prazos e janelas atualizados.", variant: "success" });
    onSaved();
  };

  const field = (k: NumericSetting, label: string, helper?: string) => (
    <FormField key={k} label={label} helperText={helper} error={errorOf(k)}>
      <Input
        inputMode="numeric"
        value={values[k]}
        onChange={(e) => setValue(k, e.target.value)}
        trailingAddon="dias"
        data-testid={`parameters-setting-${k}`}
      />
    </FormField>
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" aria-busy={saving}>
      {error ? (
        <Alert variant="danger">
          <AlertTitle>Não foi possível salvar</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className="mb-2 text-label font-semibold text-fg">Prazo padrão por prioridade</legend>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {SLA_FIELDS.map((f) => field(f.key, PRIORITY_LABEL[f.priority]))}
        </div>
      </fieldset>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {WINDOW_FIELDS.map((f) => field(f.key, f.label, f.helper))}
      </div>
      <CheckboxField
        label="Conciliação automática (alta confiança)"
        description="Vincula sozinha a manutenção quando há uma candidata de alta confiança — serviço mapeado, específico e sem disputa. Média confiança e revisão manual sempre pedem decisão na aba Conciliação."
        checked={autoReconcile}
        onCheckedChange={(c) => setAutoReconcile(c === true)}
        data-testid="parameters-setting-autoReconcile"
      />
      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-end">
        <Button
          variant="outline"
          disabled={!dirty || saving}
          onClick={() => {
            setValues(initial);
            setAutoReconcile(settings.autoReconcile);
            setError(null);
          }}
        >
          Descartar alterações
        </Button>
        <Button
          type="submit"
          leadingIcon={<Save />}
          loading={saving}
          disabled={!dirty || invalid}
          data-testid="parameters-settings-save"
        >
          Salvar prazos e janelas
        </Button>
      </div>
      {dirty ? (
        <p className="flex items-center gap-1 text-caption text-fg-secondary" aria-live="polite">
          <ArrowRight aria-hidden className="size-3.5" />
          Alterações não salvas.
        </p>
      ) : null}
    </form>
  );
}
