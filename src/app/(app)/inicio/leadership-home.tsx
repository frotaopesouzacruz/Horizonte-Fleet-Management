"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertOctagon, CalendarRange, CheckCircle2, CircleDot, ClipboardCheck, ClipboardList, Flame, Gauge, Lightbulb, MapPin,
  Network, Route, ShieldCheck, Truck, UserCheck, Users, UserX, Wrench,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/ui/kpi-card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatusBadge } from "@/components/ui/status-badge";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { InsightCard, InsightList } from "@/components/feedback/insight-card";
import { PageContent, PageHeader, PageHeaderContext } from "@/components/layout/page-header";
import type { HomeCapabilities } from "@/lib/home/resolver";
import type { LeadershipHome, LeadershipResponsibility, Loaded } from "@/lib/portal/types";
import {
  buildInsights, buildPriorities, pctDelta, pendingByCategory,
  type AdherenceNumbers, type Insight, type LeadershipBlocks, type PendingCategory, type Priority, type PrioritySeverity,
} from "@/lib/portal/leadership";
import { HomeSection, ShortcutCard, type ShortcutTone } from "./shortcut-card";

export type LeadershipScope = "leadership" | "operations";
export type LeadershipMode = "padrao" | "compacto";

export interface LeadershipHomeProps {
  displayName: string;
  home: Loaded<LeadershipHome>;
  blocks: LeadershipBlocks;
  scope: LeadershipScope;
  /** Há responsabilidades vigentes: o recorte "minha liderança" existe. */
  canToggleScope: boolean;
  /** Colaborador do líder, para levar o recorte aos módulos ("?lideranca="). */
  leaderId: string | null;
  can: HomeCapabilities;
  /** Compacto: só ação e resumo (níveis 1 e 2); padrão: tudo. */
  mode: LeadershipMode;
  /** Blocos de nível 3 e 4 (manutenção, preditiva, KM, tendência), em Suspense. */
  secondary?: React.ReactNode;
  basePath?: string;
}

const int = new Intl.NumberFormat("pt-BR");
const pct = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

function dateBr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d ? `${d}/${m}/${y}` : iso;
}

function pctLabel(n: AdherenceNumbers): string {
  return n.pct == null ? "Sem base" : `${pct.format(n.pct)}%`;
}

/** Abaixo da meta (ou de 90% sem meta) pede atenção; sem base não julga. */
function pctStatus(n: AdherenceNumbers): "success" | "warning" | "neutral" {
  if (n.pct == null) return "neutral";
  return n.pct >= (n.targetPct ?? 90) ? "success" : "warning";
}

const RESPONSIBILITY_TYPE: Record<LeadershipResponsibility["responsibilityType"], string> = {
  principal: "Titular",
  substitute: "Substituto",
  support: "Apoio",
};

function responsibilityLabel(r: LeadershipResponsibility): string {
  const place =
    r.scopeLevel === "br"
      ? `BR ${r.brCode ?? "—"}${r.cityName ? ` · ${r.cityName}/${r.uf ?? ""}` : ""}`
      : r.scopeLevel === "city"
        ? `${r.cityName ?? "—"}/${r.uf ?? ""}`
        : "Operação inteira";
  return `${r.operationName ?? "Operação"} · ${place}`;
}

const SEVERITY: Record<PrioritySeverity, { label: string; tone: "danger" | "warning" | "info"; bar: string }> = {
  critical: { label: "Crítico", tone: "danger", bar: "bg-danger" },
  high: { label: "Alto", tone: "warning", bar: "bg-warning" },
  medium: { label: "Médio", tone: "info", bar: "bg-info" },
};

const INSIGHT_TONE: Record<Insight["tone"], "success" | "warning" | "danger" | "info"> = {
  positive: "success",
  warning: "warning",
  critical: "danger",
  info: "info",
};

function BlockError({ title, error, onRetry, retrying }: { title: string; error: string; onRetry: () => void; retrying: boolean }) {
  return <ErrorState variant="panel" headingLevel={3} title={title} description={error} onRetry={onRetry} retrying={retrying} />;
}

/** Cartão de prioridade: o cartão inteiro é o link para o drill-down. */
function PriorityCard({ p }: { p: Priority }) {
  const s = SEVERITY[p.severity];
  return (
    <li>
      <Link
        href={p.href}
        className="relative flex h-full flex-col gap-1.5 overflow-hidden rounded-lg border border-border bg-surface-raised p-3 pt-3.5 shadow-card outline-none hfm-transition hfm-focus-ring hover:-translate-y-px hover:border-border-emphasis hover:shadow-card-hover"
        data-testid="prioridade"
        data-severity={p.severity}
      >
        <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1", s.bar)} />
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge status={s.tone} size="sm">{s.label}</StatusBadge>
          <span className="text-caption font-semibold text-fg-muted">{p.source}</span>
        </span>
        <span className="text-body-sm font-semibold text-fg">{p.title}</span>
        <span className="text-caption text-fg-secondary">{p.description}</span>
        <span className="mt-auto pt-1 text-body-sm font-semibold text-link">Ver →</span>
      </Link>
    </li>
  );
}

function CategoryCard({ c }: { c: PendingCategory }) {
  const tone = c.total == null ? "neutral" : c.critical > 0 ? "danger" : c.total > 0 ? "warning" : "success";
  return (
    <li>
      <Link
        href={c.href}
        className="flex h-full flex-col gap-1 rounded-lg border border-border bg-surface-raised p-3.5 shadow-card outline-none hfm-transition hfm-focus-ring hover:-translate-y-px hover:border-border-emphasis hover:shadow-card-hover"
        data-testid={`categoria-${c.key}`}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="text-body-sm font-semibold text-fg">{c.label}</span>
          <StatusBadge status={tone} size="sm">
            {c.total == null ? "Não carregou" : c.total === 0 ? "Em dia" : c.critical > 0 ? `${int.format(c.critical)} crítica${c.critical === 1 ? "" : "s"}` : "Atenção"}
          </StatusBadge>
        </span>
        <span className="text-kpi font-semibold tabular-nums text-fg">{c.total == null ? "—" : int.format(c.total)}</span>
        <span className="text-caption text-fg-muted">
          {c.total == null ? "A fonte não respondeu." : c.parts.filter((p) => p.value > 0).map((p) => `${int.format(p.value)} ${p.label}`).join(" · ") || "Nenhuma pendência"}
        </span>
      </Link>
    </li>
  );
}

/**
 * Home da Liderança de Operações — responde "o que exige minha atenção
 * agora?", em camadas:
 *
 *   nível 1 (ação)      cabeçalho com escopo e contagens › prioridades
 *   nível 2 (resumo)    KPIs críticos › resumo operacional › aderência do dia
 *                       com comparativos › pendências da equipe › insights
 *   nível 3 (tendência) manutenção, preditiva, KM e tendência (Suspense)
 *   nível 4 (detalhe)   pneus, MTSR, planos, equipe, atalhos, aplicativos
 *
 * O modo compacto corta nos níveis 1 e 2. Cada número vem da rotina oficial
 * do módulo e leva ao módulo com o mesmo recorte; um bloco que falha mostra
 * o motivo no lugar dos números.
 */
export function LeadershipHomeView({
  displayName,
  home,
  blocks,
  scope,
  canToggleScope,
  leaderId,
  can,
  mode,
  secondary,
  basePath = "/inicio",
}: LeadershipHomeProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const retry = () => startTransition(() => router.refresh());
  const navigate = (next: { scope?: LeadershipScope; mode?: LeadershipMode }) => {
    const s = next.scope ?? scope;
    const m = next.mode ?? mode;
    const params: string[] = [];
    if (s === "operations") params.push("escopo=operacoes");
    if (m === "compacto") params.push("modo=compacto");
    const url = params.length ? `${basePath}${basePath.includes("?") ? "&" : "?"}${params.join("&")}` : basePath;
    startTransition(() => router.push(url, { scroll: false }));
  };

  const data = home.ok ? home.data : null;
  const team = data?.team ?? null;
  const query = scope === "leadership" && leaderId ? `?lideranca=${leaderId}` : "";
  const priorities = React.useMemo(() => buildPriorities(blocks, team, query), [blocks, team, query]);
  const categories = React.useMemo(() => pendingByCategory(blocks, query), [blocks, query]);
  const insights = React.useMemo(() => buildInsights(blocks, team, categories, query), [blocks, team, categories, query]);
  const name = data?.employee?.name || displayName;
  const compact = mode === "compacto";
  // Sem operação liberada a RLS devolve tudo vazio: "sob controle" seria mentira.
  const noScope = Boolean(data && !data.scope.allOperations && data.scope.operations.length === 0);
  const criticalCount = priorities.items.filter((p) => p.severity === "critical").length;

  const today = blocks.today;
  const yesterday = blocks.yesterday;
  const week = blocks.week;
  const fleet = blocks.fleet;

  const moduleCards: { href: string; title: string; description: string; icon: React.ReactNode; tone: ShortcutTone; allowed: boolean }[] = [
    { href: `/checklist/aderencia${query}`, title: "Aderência e checklists", description: "Execução diária e mensal da sua operação", icon: <Gauge />, tone: "primary", allowed: can.adherence },
    { href: `/checklist/planos-acao${query}`, title: "Planos de ação", description: "Tratativas das inconformidades do Check List", icon: <ClipboardList />, tone: "warning", allowed: can.actionPlans },
    { href: "/governanca/fidelizacao", title: "Fidelização", description: "Frotas e motoristas por BR e competência", icon: <CalendarRange />, tone: "info", allowed: can.fidelization },
    { href: "/governanca/brs", title: "BRs", description: "As posições operacionais da sua operação", icon: <MapPin />, tone: "neutral", allowed: can.fidelization },
    { href: "/frota/km", title: "KM rodado", description: "Rodagem diária e mensal das suas placas", icon: <Route />, tone: "neutral", allowed: can.km },
    { href: `/frota/pneus${query}`, title: "Gestão de Pneus", description: "Sulco, calibragem e prazos da sua frota", icon: <CircleDot />, tone: "info", allowed: can.tires },
    { href: "/frota/manutencao", title: "Manutenção", description: "Programação e execução das manutenções", icon: <Wrench />, tone: "warning", allowed: can.maintenance },
    { href: `/seguranca/mtsr${query}`, title: "Gestão de MTSR", description: "Conformidade dos componentes de segurança", icon: <ShieldCheck />, tone: "highlight", allowed: can.mtsr },
  ];
  const modules = moduleCards.filter((m) => m.allowed);

  const todaySaidaDelta =
    today && yesterday && today.saida.ok && yesterday.saida.ok ? pctDelta(today.saida.data.pct, yesterday.saida.data.pct) : null;
  const todayRetornoDelta =
    today && yesterday && today.retorno.ok && yesterday.retorno.ok ? pctDelta(today.retorno.data.pct, yesterday.retorno.data.pct) : null;

  return (
    <>
      <PageHeader
        eyebrow="Liderança de Operações"
        title="Portal da Liderança"
        description={`Olá, ${name}. O que exige a sua atenção agora.`}
        context={
          data ? (
            <>
              <PageHeaderContext label="Hoje">{dateBr(data.today)}</PageHeaderContext>
              <PageHeaderContext label="Semana desde">{dateBr(data.weekFrom)}</PageHeaderContext>
              {data.employee?.code ? <PageHeaderContext label="Matrícula">{data.employee.code}</PageHeaderContext> : null}
            </>
          ) : undefined
        }
        secondaryActions={
          <div className="flex flex-wrap items-center gap-2">
            {canToggleScope ? (
              <SegmentedControl<LeadershipScope>
                aria-label="Recorte dos números"
                value={scope}
                onValueChange={(next) => navigate({ scope: next })}
                disabled={pending}
                options={[
                  { value: "leadership", label: "Minha liderança" },
                  { value: "operations", label: "Operações liberadas" },
                ]}
              />
            ) : null}
            <SegmentedControl<LeadershipMode>
              aria-label="Modo da tela"
              value={mode}
              onValueChange={(next) => navigate({ mode: next })}
              disabled={pending}
              options={[
                { value: "padrao", label: "Padrão" },
                { value: "compacto", label: "Compacto" },
              ]}
            />
          </div>
        }
      />
      <PageContent aria-busy={pending || undefined}>
        <div className="flex w-full flex-col gap-6" data-testid="inicio-lideranca" data-mode={mode}>
          {/* ------------------------------------------------- escopo e contagens */}
          {!data ? (
            <BlockError title="Não foi possível carregar o seu escopo." error={home.ok ? "" : home.error} onRetry={retry} retrying={pending} />
          ) : (
            <section aria-label="Seu escopo" className="flex flex-col gap-3" data-testid="escopo">
              {noScope ? (
                <Alert variant="warning" data-testid="escopo-vazio">
                  <AlertDescription>
                    Sua conta ainda não tem operações liberadas: os módulos ficam vazios até que o administrador do HFM
                    inclua as operações da sua liderança no seu acesso (Colaboradores e usuários › Acesso ao HFM).
                  </AlertDescription>
                </Alert>
              ) : null}
              {!data.employee ? (
                <Alert variant="info">
                  <AlertDescription>
                    Sua conta não está vinculada a um cadastro de colaborador: responsabilidades de liderança e equipe
                    dependem desse vínculo. Peça ao administrador do HFM para vinculá-lo.
                  </AlertDescription>
                </Alert>
              ) : null}
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <KpiCard
                  size="compact"
                  label="Operações liberadas"
                  value={data.scope.allOperations ? "Todas" : data.scope.operations.length}
                  icon={<Network />}
                  period={
                    data.scope.allOperations
                      ? "Sua conta enxerga todas as operações"
                      : data.scope.operations.slice(0, 3).map((o) => o.name).join(", ") +
                        (data.scope.operations.length > 3 ? ` +${data.scope.operations.length - 3}` : "") || "Nenhuma"
                  }
                  data-testid="kpi-operacoes"
                />
                <KpiCard
                  size="compact"
                  label="Veículos ativos"
                  value={fleet ? (fleet.ok ? fleet.data.active : "—") : "—"}
                  icon={<Truck />}
                  period={fleet ? (fleet.ok ? `${int.format(fleet.data.total)} cadastrados · ${int.format(fleet.data.unassigned)} sem operação` : "Não foi possível carregar a frota") : "Sem permissão para a frota"}
                  data-testid="kpi-veiculos"
                />
                <KpiCard
                  size="compact"
                  label="Colaboradores"
                  value={team ? team.members : "—"}
                  icon={<Users />}
                  period={team ? "Equipe direta (gestor imediato)" : "Sem colaborador vinculado"}
                  data-testid="kpi-equipe"
                />
                <KpiCard
                  size="compact"
                  label="Pendências críticas"
                  value={criticalCount}
                  status={criticalCount > 0 ? "danger" : "success"}
                  icon={<AlertOctagon />}
                  period={priorities.incomplete ? "Algumas fontes não carregaram" : `${int.format(priorities.items.length)} prioridades no total`}
                  data-testid="kpi-criticas"
                />
              </div>
              <p className="text-caption text-fg-muted">
                {scope === "leadership"
                  ? "Números da sua liderança: as obrigações, pneus, vistorias e planos das cidades e BRs pelos quais você responde."
                  : "Números de tudo o que a sua conta enxerga nas operações liberadas."}
                {data.scope.responsibilities.length
                  ? ` Responsabilidades: ${data.scope.responsibilities.slice(0, 2).map((r) => `${responsibilityLabel(r)} (${RESPONSIBILITY_TYPE[r.responsibilityType]})`).join("; ")}${data.scope.responsibilities.length > 2 ? "…" : "."}`
                  : ""}
              </p>
            </section>
          )}

          {/* ------------------------------------------------------- prioridades */}
          <HomeSection
            id="prioridades"
            title="Prioridades"
            icon={<AlertOctagon />}
            description="Geradas das regras oficiais de aderência, pneus, MTSR, planos de ação e da sua equipe. Cada uma abre o módulo já filtrado."
            testId="prioridades"
          >
            {priorities.items.length === 0 ? (
              noScope ? (
                <p className="rounded-lg border border-border bg-surface-raised p-4 text-body-sm text-fg-secondary" data-testid="prioridades-sem-escopo">
                  Sem operações liberadas na sua conta, não há o que priorizar ainda.
                </p>
              ) : priorities.incomplete ? (
                <Alert variant="warning">
                  <AlertDescription>
                    Algumas fontes não carregaram, então não dá para dizer que não há pendências. Tente recarregar.
                  </AlertDescription>
                </Alert>
              ) : (
                <EmptyState
                  variant="panel"
                  headingLevel={3}
                  icon={<CheckCircle2 />}
                  title="Tudo em dia"
                  description="Nenhuma pendência no seu escopo pelas regras oficiais de hoje."
                />
              )
            ) : (
              <>
                {priorities.incomplete ? (
                  <p className="text-caption text-fg-muted">Algumas fontes não carregaram; a lista pode estar incompleta.</p>
                ) : null}
                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {priorities.items.map((p) => (
                    <PriorityCard key={p.key} p={p} />
                  ))}
                </ul>
              </>
            )}
          </HomeSection>

          {/* ---------------------------------------------- aderência do dia (KPIs) */}
          {today ? (
            <HomeSection
              id="aderencia-dia"
              title="Aderência do dia"
              icon={<ClipboardCheck />}
              description={`Aderência oficial de ${dateBr(today.from)} — obrigações de saída e retorno, com expurgos — comparada com ontem, a semana e a meta.`}
              actions={
                <Button asChild size="sm" variant="secondary">
                  <Link href={`/checklist/aderencia${query}`}>Abrir a Aderência</Link>
                </Button>
              }
              testId="aderencia-dia"
            >
              {!today.saida.ok || !today.retorno.ok ? (
                <BlockError
                  title="Não foi possível carregar a aderência de hoje."
                  error={!today.saida.ok ? today.saida.error : !today.retorno.ok ? today.retorno.error : ""}
                  onRetry={retry}
                  retrying={pending}
                />
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <KpiCard
                      label="Saída hoje"
                      value={pctLabel(today.saida.data)}
                      status={pctStatus(today.saida.data)}
                      period={`${int.format(today.saida.data.numerator)} de ${int.format(today.saida.data.denominator)} obrigações`}
                      target={today.saida.data.targetPct != null ? `Meta ${pct.format(today.saida.data.targetPct)}%` : undefined}
                      trend={todaySaidaDelta ? { value: todaySaidaDelta.value, direction: todaySaidaDelta.direction, goodWhen: "up", comparison: "vs. ontem" } : undefined}
                      data-testid="kpi-saida-hoje"
                    />
                    <KpiCard
                      label="Retorno hoje"
                      value={pctLabel(today.retorno.data)}
                      status={pctStatus(today.retorno.data)}
                      period={`${int.format(today.retorno.data.pendingReturn)} ainda no prazo`}
                      target={today.retorno.data.targetPct != null ? `Meta ${pct.format(today.retorno.data.targetPct)}%` : undefined}
                      trend={todayRetornoDelta ? { value: todayRetornoDelta.value, direction: todayRetornoDelta.direction, goodWhen: "up", comparison: "vs. ontem" } : undefined}
                      data-testid="kpi-retorno-hoje"
                    />
                    <KpiCard
                      label="Sem checklist ainda"
                      value={today.saida.data.notDone + today.retorno.data.notDone}
                      status={today.saida.data.notDone + today.retorno.data.notDone > 0 ? "warning" : "success"}
                      icon={<AlertOctagon />}
                      period={`${int.format(today.saida.data.done + today.retorno.data.done)} realizados · ${int.format(today.saida.data.excluded + today.retorno.data.excluded)} dispensados`}
                      data-testid="kpi-sem-checklist"
                    />
                    {week && week.saida.ok && week.retorno.ok ? (
                      <KpiCard
                        label="Semana até hoje"
                        value={pctLabel(week.saida.data)}
                        status={pctStatus(week.saida.data)}
                        icon={<CalendarRange />}
                        period={`Saída ${int.format(week.saida.data.numerator)}/${int.format(week.saida.data.denominator)} · Retorno ${week.retorno.data.pct == null ? "sem base" : `${pct.format(week.retorno.data.pct)}%`}`}
                        data-testid="kpi-semana"
                      />
                    ) : week ? (
                      <KpiCard label="Semana até hoje" value="—" status="neutral" period="Não foi possível carregar a semana" />
                    ) : null}
                  </div>
                  {team && team.withoutWeekNames.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5" data-testid="sem-checklist-semana">
                      <span className="text-caption font-semibold text-fg-muted">Sem checklist na semana:</span>
                      {team.withoutWeekNames.map((n) => (
                        <Badge key={n} variant="warning" size="sm">{n}</Badge>
                      ))}
                      {team.withoutChecklistWeek > team.withoutWeekNames.length ? (
                        <span className="text-caption text-fg-muted">+{team.withoutChecklistWeek - team.withoutWeekNames.length}</span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )}
            </HomeSection>
          ) : null}

          {/* ------------------------------------------------ resumo operacional */}
          {data ? (
            <HomeSection id="resumo-operacional" title="Resumo operacional" icon={<Truck />} testId="resumo-operacional">
              <div className="rounded-xl border border-border bg-surface-raised p-4 shadow-card">
                <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <div>
                    <dt className="text-caption text-fg-muted">Frotas ativas</dt>
                    <dd className="text-kpi font-semibold tabular-nums text-fg" data-testid="resumo-frotas">
                      {fleet && fleet.ok ? int.format(fleet.data.active) : "—"}
                    </dd>
                    <dd className="text-caption text-fg-muted">{fleet ? (fleet.ok ? `${int.format(fleet.data.inactive)} inativas` : "não carregou") : "sem permissão"}</dd>
                  </div>
                  <div>
                    <dt className="text-caption text-fg-muted">Checklist OK hoje</dt>
                    <dd className="text-kpi font-semibold tabular-nums text-fg" data-testid="resumo-checklist">
                      {today && today.saida.ok ? pctLabel(today.saida.data) : "—"}
                    </dd>
                    <dd className="text-caption text-fg-muted">saída, pela regra oficial</dd>
                  </div>
                  <div>
                    <dt className="text-caption text-fg-muted">Pneus críticos</dt>
                    <dd className="text-kpi font-semibold tabular-nums text-fg" data-testid="resumo-pneus">
                      {blocks.tires ? (blocks.tires.ok ? (blocks.tires.data.empty ? "—" : int.format(blocks.tires.data.fleetsWithCritical)) : "—") : "—"}
                    </dd>
                    <dd className="text-caption text-fg-muted">{blocks.tires ? (blocks.tires.ok ? (blocks.tires.data.empty ? "sem base oficial" : "frotas") : "não carregou") : "sem permissão"}</dd>
                  </div>
                  <div>
                    <dt className="text-caption text-fg-muted">MTSR vencidas</dt>
                    <dd className="text-kpi font-semibold tabular-nums text-fg" data-testid="resumo-mtsr">
                      {blocks.mtsr ? (blocks.mtsr.ok ? int.format(blocks.mtsr.data.overdue) : "—") : "—"}
                    </dd>
                    <dd className="text-caption text-fg-muted">{blocks.mtsr ? (blocks.mtsr.ok ? `de ${int.format(blocks.mtsr.data.vehicles)} veículos` : "não carregou") : "sem permissão"}</dd>
                  </div>
                </dl>
              </div>
            </HomeSection>
          ) : null}

          {/* ------------------------------------------- pendências da equipe */}
          {categories.length ? (
            <HomeSection
              id="pendencias-equipe"
              title="Pendências da equipe"
              icon={<ClipboardList />}
              description="Por categoria; cada cartão abre o módulo já filtrado pelo seu recorte."
              testId="pendencias-equipe"
            >
              <ul className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                {categories.map((c) => (
                  <CategoryCard key={c.key} c={c} />
                ))}
              </ul>
            </HomeSection>
          ) : null}

          {/* ---------------------------------------------------------- insights */}
          {data && !noScope ? (
            <HomeSection id="insights" title="Insights" icon={<Lightbulb />} testId="insights">
              {insights.length === 0 ? (
                <p className="rounded-lg border border-border bg-surface-raised px-4 py-3 text-body-sm text-fg-secondary">
                  Ainda não há base para insights: eles aparecem quando a aderência, as pendências ou a equipe tiverem números.
                </p>
              ) : (
                <InsightList>
                  {insights.map((i) => (
                    <InsightCard
                      key={i.key}
                      tone={INSIGHT_TONE[i.tone]}
                      title={i.title}
                      action={
                        i.href ? (
                          <Link href={i.href} className="text-body-sm font-semibold text-link hover:underline">
                            Ver
                          </Link>
                        ) : undefined
                      }
                    >
                      {i.text}
                    </InsightCard>
                  ))}
                </InsightList>
              )}
            </HomeSection>
          ) : null}

          {/* --------------------------------------- nível 3: blocos secundários */}
          {!compact ? secondary : null}

          {/* ------------------------------------------------ nível 4: detalhes */}
          {!compact && blocks.tires ? (
            <HomeSection
              id="pneus"
              title="Gestão de Pneus da minha frota"
              icon={<CircleDot />}
              description={
                blocks.tires.ok && !blocks.tires.data.empty
                  ? `Pneus em uso pela regra oficial de sulco, medição e calibragem · base de ${dateBr(blocks.tires.data.referenceDate)}.`
                  : "Pneus em uso pela regra oficial de sulco, medição e calibragem."
              }
              actions={
                <Button asChild size="sm" variant="secondary">
                  <Link href={`/frota/pneus${query}`}>Abrir Gestão de Pneus</Link>
                </Button>
              }
              testId="pneus"
            >
              {!blocks.tires.ok ? (
                <BlockError title="Não foi possível carregar os pneus." error={blocks.tires.error} onRetry={retry} retrying={pending} />
              ) : blocks.tires.data.empty ? (
                <EmptyState variant="panel" headingLevel={3} icon={<CircleDot />} title="Ainda não há base oficial de pneus"
                  description="Os números aparecem quando a primeira fotografia do Rodopar for importada." />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <KpiCard size="compact" label="Frotas com pneu crítico" value={blocks.tires.data.fleetsWithCritical}
                    status={blocks.tires.data.fleetsWithCritical > 0 ? "danger" : "success"} icon={<Flame />}
                    period={`${int.format(blocks.tires.data.critical)} pneus críticos ou abaixo do legal`} />
                  <KpiCard size="compact" label="Medição vencida" value={blocks.tires.data.measurementOverdue}
                    status={blocks.tires.data.measurementOverdue > 0 ? "danger" : "success"} period="pneus" />
                  <KpiCard size="compact" label="Medição próxima" value={blocks.tires.data.measurementDueSoon}
                    status={blocks.tires.data.measurementDueSoon > 0 ? "warning" : "success"} period="pneus a medir esta semana" />
                  <KpiCard size="compact" label="Calibragem vencida" value={blocks.tires.data.calibrationOverdue}
                    status={blocks.tires.data.calibrationOverdue > 0 ? "danger" : "success"} period="pneus" />
                  <KpiCard size="compact" label="Calibragem próxima" value={blocks.tires.data.calibrationDueSoon}
                    status={blocks.tires.data.calibrationDueSoon > 0 ? "warning" : "success"} period="pneus a calibrar esta semana" />
                </div>
              )}
            </HomeSection>
          ) : null}

          {!compact && (blocks.mtsr || blocks.plans) ? (
            <div className="grid gap-6 xl:grid-cols-2">
              {blocks.mtsr ? (
                <HomeSection
                  id="mtsr"
                  title="Segurança (MTSR)"
                  icon={<ShieldCheck />}
                  description="Vistorias dos componentes de segurança da sua frota."
                  actions={
                    <Button asChild size="sm" variant="secondary">
                      <Link href={`/seguranca/mtsr${query}`}>Abrir MTSR</Link>
                    </Button>
                  }
                  testId="mtsr"
                >
                  {!blocks.mtsr.ok ? (
                    <BlockError title="Não foi possível carregar o MTSR." error={blocks.mtsr.error} onRetry={retry} retrying={pending} />
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <KpiCard size="compact" label="Vistoria vencida" value={blocks.mtsr.data.overdue}
                        status={blocks.mtsr.data.overdue > 0 ? "danger" : "success"} period={`de ${int.format(blocks.mtsr.data.vehicles)} veículos`} />
                      <KpiCard size="compact" label="Não conformes" value={blocks.mtsr.data.nonConforming}
                        status={blocks.mtsr.data.nonConforming > 0 ? "warning" : "success"} period="veículos com componente NOK" />
                      <KpiCard size="compact" label="Aguardando validação" value={blocks.mtsr.data.pendingInspections}
                        status={blocks.mtsr.data.pendingInspections > 0 ? "info" : "neutral"} period="vistorias enviadas pelo app" />
                    </div>
                  )}
                </HomeSection>
              ) : null}
              {blocks.plans ? (
                <HomeSection
                  id="planos"
                  title="Planos de ação"
                  icon={<ClipboardList />}
                  description="Tratativas de manutenção dos últimos 90 dias."
                  actions={
                    <Button asChild size="sm" variant="secondary">
                      <Link href={`/checklist/planos-acao${query}`}>Abrir Planos de ação</Link>
                    </Button>
                  }
                  testId="planos"
                >
                  {!blocks.plans.ok ? (
                    <BlockError title="Não foi possível carregar os planos de ação." error={blocks.plans.error} onRetry={retry} retrying={pending} />
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <KpiCard size="compact" label="Em aberto" value={blocks.plans.data.plansActive}
                        status={blocks.plans.data.plansActive > 0 ? "info" : "neutral"} period={`${int.format(blocks.plans.data.vehiclesPending)} veículos com pendência`} />
                      <KpiCard size="compact" label="Vencidos" value={blocks.plans.data.plansOverdue}
                        status={blocks.plans.data.plansOverdue > 0 ? "danger" : "success"} period="fora do prazo" />
                      <KpiCard size="compact" label="Críticos" value={blocks.plans.data.plansCritical}
                        status={blocks.plans.data.plansCritical > 0 ? "warning" : "success"} period="prioridade crítica" />
                    </div>
                  )}
                </HomeSection>
              ) : null}
            </div>
          ) : null}

          {/* ------------------------------------------------------------ equipe */}
          {!compact ? (
            <HomeSection
              id="equipe"
              title="Meu time"
              icon={<Users />}
              description="Equipe direta do cadastro (gestor imediato), com os checklists de hoje e da semana."
              testId="equipe"
            >
              {!data ? null : !team ? (
                <EmptyState variant="panel" headingLevel={3} icon={<Users />} title="Sem colaborador vinculado à sua conta"
                  description="A equipe é a de quem tem você como gestor imediato no cadastro; sem o seu cadastro vinculado, não há equipe a mostrar." />
              ) : team.members === 0 ? (
                <EmptyState variant="panel" headingLevel={3} icon={<Users />} title="Ninguém tem você como gestor imediato"
                  description="Quando o cadastro dos colaboradores indicar você como gestor imediato, eles aparecem aqui." />
              ) : (
                <div className="overflow-hidden rounded-xl border border-border bg-surface-raised shadow-card">
                  <ul className="divide-y divide-border" aria-label="Colaboradores da equipe">
                    {team.list.map((m) => (
                      <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 sm:px-4" data-testid="membro">
                        <div className="min-w-0 flex-1 basis-48">
                          <p className="truncate text-body-sm font-semibold text-fg">{m.name}</p>
                          <p className="truncate text-caption text-fg-muted">
                            {[m.code ? `Matrícula ${m.code}` : null, m.jobPosition].filter(Boolean).join(" · ") || "—"}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-caption tabular-nums">
                          {m.week === 0 ? (
                            <StatusBadge status="warning" size="sm" withIcon>Sem checklist na semana</StatusBadge>
                          ) : (
                            <StatusBadge status="success" size="sm" withIcon>
                              {m.week} {m.week === 1 ? "checklist" : "checklists"} na semana
                            </StatusBadge>
                          )}
                          <span className="text-fg-secondary">Hoje: {m.today}</span>
                          <span className="text-fg-muted">Último: {dateBr(m.lastDate)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {team.truncated ? (
                    <p className="border-t border-border px-4 py-2 text-caption text-fg-muted">Mostrando 200 colaboradores.</p>
                  ) : null}
                </div>
              )}
            </HomeSection>
          ) : team && team.withoutChecklistWeek > 0 ? (
            <p id="equipe" className="flex scroll-mt-20 items-center gap-2 text-body-sm text-fg-secondary" data-testid="equipe-compacta">
              <UserX aria-hidden className="size-4 text-warning-soft-fg" />
              {int.format(team.withoutChecklistWeek)} de {int.format(team.members)} da equipe sem checklist na semana.
            </p>
          ) : null}

          {/* ------------------------------------------------- atalhos e apps */}
          {!compact && modules.length > 0 ? (
            <HomeSection id="navegacao" title="Atalhos" icon={<UserCheck />} testId="navegacao">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {modules.map((m) => (
                  <ShortcutCard key={m.title} href={m.href} title={m.title} description={m.description} icon={m.icon} tone={m.tone} />
                ))}
              </div>
            </HomeSection>
          ) : null}

          {!compact && can.apps ? (
            <HomeSection id="aplicativos" title="Aplicativos operacionais" icon={<ClipboardCheck />} testId="aplicativos">
              <div className="grid gap-3 sm:grid-cols-3">
                {can.checklistExecute ? (
                  <ShortcutCard href="/aplicativos/check-list-frota" title="Check List de Frota"
                    description="Checklist de saída e retorno de rota" icon={<ClipboardCheck />} tone="primary" />
                ) : null}
                {can.tiresExecute ? (
                  <ShortcutCard href="/aplicativos/vistoria-pneus" title="Vistoria de Pneus"
                    description="Aferição de sulco e calibragem em campo" icon={<CircleDot />} tone="info" />
                ) : null}
                {can.mtsrExecute ? (
                  <ShortcutCard href="/aplicativos/vistoria-mtsr" title="Vistoria MTSR"
                    description="Vistoria dos componentes MTSR da sua frota" icon={<ShieldCheck />} tone="highlight" />
                ) : null}
              </div>
            </HomeSection>
          ) : null}
        </div>
      </PageContent>
    </>
  );
}
