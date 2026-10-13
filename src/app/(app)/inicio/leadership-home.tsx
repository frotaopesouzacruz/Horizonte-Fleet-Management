"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertOctagon, CalendarRange, CheckCircle2, CircleDot, ClipboardCheck, ClipboardList, Flame, Gauge, MapPin,
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
import { PageContent, PageHeader, PageHeaderContext } from "@/components/layout/page-header";
import type { LeadershipHome, LeadershipResponsibility, Loaded } from "@/lib/portal/types";
import {
  buildPriorities, type AdherenceNumbers, type LeadershipBlocks, type Priority, type PrioritySeverity,
} from "@/lib/portal/leadership";
import { HomeSection, ShortcutCard, type ShortcutTone } from "./shortcut-card";

export type LeadershipScope = "leadership" | "operations";

export interface LeadershipHomeProps {
  displayName: string;
  home: Loaded<LeadershipHome>;
  blocks: LeadershipBlocks;
  scope: LeadershipScope;
  /** Há responsabilidades vigentes: o recorte "minha liderança" existe. */
  canToggleScope: boolean;
  /** Colaborador do líder, para levar o recorte aos módulos ("?lideranca="). */
  leaderId: string | null;
  /** Permissões da conta, para os atalhos dos módulos (dado, não função: vem do servidor). */
  permissions: string[];
  isPlatformAdmin?: boolean;
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

function BlockError({ title, error, onRetry, retrying }: { title: string; error: string; onRetry: () => void; retrying: boolean }) {
  return <ErrorState variant="panel" headingLevel={3} title={title} description={error} onRetry={onRetry} retrying={retrying} />;
}

function PriorityCard({ p }: { p: Priority }) {
  const s = SEVERITY[p.severity];
  return (
    <li className="relative flex flex-col gap-1.5 overflow-hidden rounded-lg border border-border bg-surface-raised p-3 pt-3.5 shadow-card">
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1", s.bar)} />
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={s.tone} size="sm">{s.label}</StatusBadge>
        <span className="text-caption font-semibold text-fg-muted">{p.source}</span>
      </div>
      <p className="text-body-sm font-semibold text-fg">{p.title}</p>
      <p className="text-caption text-fg-secondary">{p.description}</p>
      <Link href={p.href} className="self-start rounded-xs text-body-sm font-semibold text-link hfm-focus-ring hover:text-link-hover hover:underline">
        Ver →
      </Link>
    </li>
  );
}

/**
 * Início da Liderança de Operações — "Portal da Liderança" (HFC), na ordem
 * do HFC: escopo › minha operação hoje › semana até hoje › prioridades ›
 * pneus › segurança e planos › minha equipe › navegação e aplicativos.
 *
 * Cada número vem da rotina oficial do módulo (ver `leadership-data.ts`) e
 * leva ao módulo com o mesmo recorte. Diferente do HFC, a aderência é a do
 * Motor oficial (obrigações com expurgos, no fuso da operação) — não uma
 * conta paralela sobre os checklists da equipe.
 */
export function LeadershipHomeView({
  displayName,
  home,
  blocks,
  scope,
  canToggleScope,
  leaderId,
  permissions,
  isPlatformAdmin = false,
  basePath = "/inicio",
}: LeadershipHomeProps) {
  const can = (permission: string) => isPlatformAdmin || permissions.includes(permission);
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const retry = () => startTransition(() => router.refresh());
  const setScope = (next: LeadershipScope) =>
    startTransition(() =>
      router.push(next === "operations" ? `${basePath}${basePath.includes("?") ? "&" : "?"}escopo=operacoes` : basePath, {
        scroll: false,
      }),
    );

  const data = home.ok ? home.data : null;
  const team = data?.team ?? null;
  const query = scope === "leadership" && leaderId ? `?lideranca=${leaderId}` : "";
  const priorities = React.useMemo(() => buildPriorities(blocks, team, query), [blocks, team, query]);
  const name = data?.employee?.name || displayName;
  // Sem operação liberada a RLS devolve tudo vazio: "sob controle" seria mentira.
  const noScope = Boolean(data && !data.scope.allOperations && data.scope.operations.length === 0);

  const moduleCards: { href: string; title: string; description: string; icon: React.ReactNode; tone: ShortcutTone; permission: string }[] = [
    { href: `/checklist/aderencia${query}`, title: "Aderência e checklists", description: "Execução diária e mensal da sua operação", icon: <Gauge />, tone: "primary", permission: "adherence.view" },
    { href: `/checklist/planos-acao${query}`, title: "Planos de ação", description: "Tratativas das inconformidades do Check List", icon: <ClipboardList />, tone: "warning", permission: "action_plans.view" },
    { href: "/governanca/fidelizacao", title: "Fidelização", description: "Frotas e motoristas por BR e competência", icon: <CalendarRange />, tone: "info", permission: "fidelization.view" },
    { href: "/governanca/brs", title: "BRs", description: "As posições operacionais da sua operação", icon: <MapPin />, tone: "neutral", permission: "fidelization.view" },
    { href: "/frota/km", title: "KM rodado", description: "Rodagem diária e mensal das suas placas", icon: <Route />, tone: "neutral", permission: "km.view" },
    { href: `/frota/pneus${query}`, title: "Gestão de Pneus", description: "Sulco, calibragem e prazos da sua frota", icon: <CircleDot />, tone: "info", permission: "tires.view" },
    { href: "/frota/manutencao", title: "Manutenção", description: "Programação e execução das manutenções", icon: <Wrench />, tone: "warning", permission: "maintenance.view" },
    { href: `/seguranca/mtsr${query}`, title: "Gestão de MTSR", description: "Conformidade dos componentes de segurança", icon: <ShieldCheck />, tone: "highlight", permission: "mtsr.view" },
  ];
  const modules = moduleCards.filter((m) => can(m.permission));

  const today = blocks.today;
  const week = blocks.week;

  return (
    <>
      <PageHeader
        eyebrow="Liderança de Operações"
        title="Portal da Liderança"
        description={`Olá, ${name}. A operação que você lidera: execução dos checklists, pneus, segurança e equipe.`}
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
          canToggleScope ? (
            <SegmentedControl<LeadershipScope>
              aria-label="Recorte dos números"
              value={scope}
              onValueChange={setScope}
              disabled={pending}
              options={[
                { value: "leadership", label: "Minha liderança" },
                { value: "operations", label: "Operações liberadas" },
              ]}
            />
          ) : undefined
        }
      />
      <PageContent aria-busy={pending || undefined}>
        <div className="flex w-full flex-col gap-6" data-testid="inicio-lideranca">
          {/* ----------------------------------------------------------- escopo */}
          {!data ? (
            <BlockError title="Não foi possível carregar o seu escopo." error={home.ok ? "" : home.error} onRetry={retry} retrying={pending} />
          ) : (
            <section aria-label="Seu escopo" className="flex flex-col gap-3" data-testid="escopo">
              {!data.scope.allOperations && data.scope.operations.length === 0 ? (
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
              <div className="grid gap-3 sm:grid-cols-3">
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
                  label="Minhas responsabilidades"
                  value={data.scope.responsibilities.length}
                  icon={<UserCheck />}
                  period={
                    data.scope.responsibilities.length
                      ? data.scope.responsibilities
                          .slice(0, 2)
                          .map((r) => `${responsibilityLabel(r)} (${RESPONSIBILITY_TYPE[r.responsibilityType]})`)
                          .join("; ") + (data.scope.responsibilities.length > 2 ? "…" : "")
                      : "Nenhuma liderança vigente no Planejamento de lideranças"
                  }
                  data-testid="kpi-responsabilidades"
                />
                <KpiCard
                  size="compact"
                  label="Equipe direta"
                  value={team ? team.members : "—"}
                  icon={<Users />}
                  period={team ? "Colaboradores que têm você como gestor imediato" : "Sem colaborador vinculado"}
                  data-testid="kpi-equipe"
                />
              </div>
              <p className="text-caption text-fg-muted">
                {scope === "leadership"
                  ? "Números da sua liderança: as obrigações, pneus, vistorias e planos das cidades e BRs pelos quais você responde."
                  : "Números de tudo o que a sua conta enxerga nas operações liberadas."}
              </p>
            </section>
          )}

          {/* ----------------------------------------------------- hoje e semana */}
          {today ? (
            <HomeSection
              id="hoje"
              title="Minha operação hoje"
              icon={<ClipboardCheck />}
              description={`Aderência oficial do dia ${dateBr(today.from)} — obrigações de saída e retorno, com expurgos.`}
              actions={
                <Button asChild size="sm" variant="secondary">
                  <Link href={`/checklist/aderencia${query}`}>Abrir a Aderência</Link>
                </Button>
              }
              testId="hoje"
            >
              {!today.saida.ok || !today.retorno.ok ? (
                <BlockError
                  title="Não foi possível carregar a aderência de hoje."
                  error={!today.saida.ok ? today.saida.error : !today.retorno.ok ? today.retorno.error : ""}
                  onRetry={retry}
                  retrying={pending}
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <KpiCard
                    label="Saída hoje"
                    value={pctLabel(today.saida.data)}
                    status={pctStatus(today.saida.data)}
                    period={`${int.format(today.saida.data.numerator)} de ${int.format(today.saida.data.denominator)} obrigações`}
                    data-testid="kpi-saida-hoje"
                  />
                  <KpiCard
                    label="Retorno hoje"
                    value={pctLabel(today.retorno.data)}
                    status={pctStatus(today.retorno.data)}
                    period={`${int.format(today.retorno.data.pendingReturn)} ainda no prazo`}
                    data-testid="kpi-retorno-hoje"
                  />
                  <KpiCard
                    label="Realizados hoje"
                    value={today.saida.data.done + today.retorno.data.done}
                    status="success"
                    icon={<CheckCircle2 />}
                    period="Saídas e retornos com checklist"
                  />
                  <KpiCard
                    label="Sem checklist ainda"
                    value={today.saida.data.notDone + today.retorno.data.notDone}
                    status={today.saida.data.notDone + today.retorno.data.notDone > 0 ? "warning" : "neutral"}
                    icon={<AlertOctagon />}
                    period={`${int.format(today.saida.data.excluded + today.retorno.data.excluded)} dispensadas por expurgo`}
                  />
                </div>
              )}
            </HomeSection>
          ) : null}

          {week ? (
            <HomeSection
              id="semana"
              title="Semana até hoje"
              icon={<CalendarRange />}
              description={`${dateBr(week.from)} a ${dateBr(week.to)} — dias futuros não contam.`}
              testId="semana"
            >
              {!week.saida.ok || !week.retorno.ok ? (
                <BlockError
                  title="Não foi possível carregar a aderência da semana."
                  error={!week.saida.ok ? week.saida.error : !week.retorno.ok ? week.retorno.error : ""}
                  onRetry={retry}
                  retrying={pending}
                />
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <KpiCard
                      label="Saída na semana"
                      value={pctLabel(week.saida.data)}
                      status={pctStatus(week.saida.data)}
                      period={`${int.format(week.saida.data.numerator)} de ${int.format(week.saida.data.denominator)}`}
                      target={week.saida.data.targetPct != null ? `Meta ${pct.format(week.saida.data.targetPct)}%` : undefined}
                    />
                    <KpiCard
                      label="Retorno na semana"
                      value={pctLabel(week.retorno.data)}
                      status={pctStatus(week.retorno.data)}
                      period={`${int.format(week.retorno.data.numerator)} de ${int.format(week.retorno.data.denominator)}`}
                      target={week.retorno.data.targetPct != null ? `Meta ${pct.format(week.retorno.data.targetPct)}%` : undefined}
                    />
                    <KpiCard
                      label="Não realizados"
                      value={week.saida.data.notDone + week.retorno.data.notDone}
                      status={week.saida.data.notDone + week.retorno.data.notDone > 0 ? "danger" : "neutral"}
                      period="Obrigações da semana sem checklist"
                    />
                    <KpiCard
                      label="Equipe sem checklist"
                      value={team ? team.withoutChecklistWeek : "—"}
                      status={team && team.withoutChecklistWeek > 0 ? "warning" : "neutral"}
                      icon={<UserX />}
                      period={team ? `de ${int.format(team.members)} na equipe direta` : "Sem colaborador vinculado"}
                    />
                  </div>
                  {team && team.withoutWeekNames.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5" data-testid="sem-checklist-semana">
                      <span className="text-caption font-semibold text-fg-muted">Sem checklist na semana:</span>
                      {team.withoutWeekNames.map((n) => (
                        <Badge key={n} variant="warning" size="sm">{n}</Badge>
                      ))}
                      {team.withoutChecklistWeek > team.withoutWeekNames.length ? (
                        <span className="text-caption text-fg-muted">
                          +{team.withoutChecklistWeek - team.withoutWeekNames.length}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )}
            </HomeSection>
          ) : null}

          {/* ------------------------------------------------------- prioridades */}
          <HomeSection
            id="prioridades"
            title="Prioridades da minha operação"
            icon={<AlertOctagon />}
            description="Geradas das regras oficiais de aderência, pneus, MTSR, planos de ação e da sua equipe."
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
                  title="Nenhuma pendência no seu escopo"
                  description="Operação sob controle pelas regras oficiais de hoje."
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

          {/* ------------------------------------------------------------- pneus */}
          {blocks.tires ? (
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
                <EmptyState
                  variant="panel"
                  headingLevel={3}
                  icon={<CircleDot />}
                  title="Ainda não há base oficial de pneus"
                  description="Os números aparecem quando a primeira fotografia do Rodopar for importada."
                />
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

          {/* ----------------------------------------------- segurança e planos */}
          {blocks.mtsr || blocks.plans ? (
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
          <HomeSection
            id="equipe"
            title="Minha equipe"
            icon={<Users />}
            description="Equipe direta do cadastro (gestor imediato), com os checklists de hoje e da semana."
            testId="equipe"
          >
            {!data ? null : !team ? (
              <EmptyState
                variant="panel"
                headingLevel={3}
                icon={<Users />}
                title="Sem colaborador vinculado à sua conta"
                description="A equipe é a de quem tem você como gestor imediato no cadastro; sem o seu cadastro vinculado, não há equipe a mostrar."
              />
            ) : team.members === 0 ? (
              <EmptyState
                variant="panel"
                headingLevel={3}
                icon={<Users />}
                title="Ninguém tem você como gestor imediato"
                description="Quando o cadastro dos colaboradores indicar você como gestor imediato, eles aparecem aqui."
              />
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
                          <StatusBadge status="warning" size="sm">Sem checklist na semana</StatusBadge>
                        ) : (
                          <StatusBadge status="success" size="sm">
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

          {/* ------------------------------------------------- navegação e apps */}
          {modules.length > 0 ? (
            <HomeSection id="navegacao" title="Navegação da liderança" icon={<Truck />} testId="navegacao">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {modules.map((m) => (
                  <ShortcutCard key={m.title} href={m.href} title={m.title} description={m.description} icon={m.icon} tone={m.tone} />
                ))}
              </div>
            </HomeSection>
          ) : null}

          {can("applications.view") ? (
            <HomeSection id="aplicativos" title="Aplicativos operacionais" icon={<ClipboardCheck />} testId="aplicativos">
              <div className="grid gap-3 sm:grid-cols-3">
                <ShortcutCard href="/aplicativos/check-list-frota" title="Check List de Frota"
                  description="Checklist de saída e retorno de rota" icon={<ClipboardCheck />} tone="primary" />
                <ShortcutCard href="/aplicativos/vistoria-pneus" title="Vistoria de Pneus"
                  description="Aferição de sulco e calibragem em campo" icon={<CircleDot />} tone="info" />
                <ShortcutCard href="/aplicativos/vistoria-mtsr" title="Vistoria MTSR"
                  description="Vistoria dos componentes MTSR da sua frota" icon={<ShieldCheck />} tone="highlight" />
              </div>
            </HomeSection>
          ) : null}
        </div>
      </PageContent>
    </>
  );
}
