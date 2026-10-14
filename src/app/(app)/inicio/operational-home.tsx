"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, CalendarDays, CheckCircle2, CircleDot, ClipboardCheck, Clock, Gauge, History, LayoutGrid,
  MinusCircle, Play, RotateCcw, ShieldCheck, Sparkles, Truck, Wrench,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/ui/kpi-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Progress } from "@/components/feedback/progress";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import type { Competence } from "@/lib/governance/competence";
import type { HomeCapabilities } from "@/lib/home/resolver";
import type { Loaded, MyVehicle, OperationalHome, RecentActivity } from "@/lib/portal/types";
import {
  ACTION_STATE, buildDayActions, dateBr, dateTimeBr, INSPECTION_STATUS_LABEL, longDateBr, MAINTENANCE_STATUS_LABEL,
  openActions, VEHICLE_STATUS_LABEL, visibleApps, type ActionState, type DayActionItem,
} from "@/lib/portal/home-status";
import { ChecklistCalendar, type ChecklistCalendarProps, type ObligationsSource } from "./checklist-calendar";
import { AppGrid } from "./app-grid";
import { HomeSection } from "./shortcut-card";

export interface OperationalHomeProps {
  /** Nome da conta, para quando o cadastro do colaborador não veio. */
  displayName: string;
  home: Loaded<OperationalHome>;
  obligations: ObligationsSource;
  competence: Competence;
  currentCompetence: Competence;
  can: HomeCapabilities;
  /** Instante do servidor (ISO): decide "vencido" sem depender do relógio do aparelho. */
  now: string;
  /** Caminho da tela (a prévia de desenvolvimento usa outro). */
  basePath?: string;
  detailLoader?: ChecklistCalendarProps["detailLoader"];
}

const int = new Intl.NumberFormat("pt-BR");
const pct1 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

const STATE_ICON: Record<ActionState, React.ReactNode> = {
  pendente: <Clock />,
  em_andamento: <Play />,
  concluido: <CheckCircle2 />,
  retornado: <RotateCcw />,
  vencido: <AlertTriangle />,
  dispensado: <MinusCircle />,
};

const STATE_CHIP: Record<ActionState, string> = {
  pendente: "bg-warning-soft text-warning-soft-fg",
  em_andamento: "bg-info-soft text-info-soft-fg",
  concluido: "bg-success-soft text-success-soft-fg",
  retornado: "bg-warning-soft text-warning-soft-fg",
  vencido: "bg-danger-soft text-danger-soft-fg",
  dispensado: "bg-surface-interactive text-fg-muted",
};

const ACTIVITY_ICON: Record<RecentActivity["kind"], React.ReactNode> = {
  checklist: <ClipboardCheck />,
  mtsr: <ShieldCheck />,
  tires: <CircleDot />,
};

function activityTitle(a: RecentActivity): string {
  if (a.kind === "checklist") return a.context === "retorno" ? "Checklist de retorno" : "Checklist de saída";
  return a.kind === "mtsr" ? "Vistoria MTSR" : "Vistoria de pneus";
}

function ActionRow({ item }: { item: DayActionItem }) {
  const state = ACTION_STATE[item.state];
  const primary = item.state === "pendente" || item.state === "vencido";
  return (
    <li
      className="flex items-center gap-3 px-3 py-3 sm:px-4"
      data-testid="acao"
      data-state={item.state}
    >
      <span aria-hidden className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg [&_svg]:size-5", STATE_CHIP[item.state])}>
        {STATE_ICON[item.state]}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-body-sm font-semibold text-fg">{item.title}</p>
          <StatusBadge status={state.tone} size="sm" withIcon>
            {state.label}
          </StatusBadge>
        </div>
        <p className="mt-0.5 line-clamp-2 text-caption text-fg-muted">{item.detail}</p>
      </div>
      {item.href && item.cta ? (
        <Button asChild size="sm" variant={primary ? "primary" : "secondary"} className="shrink-0">
          <Link href={item.href}>{item.cta}</Link>
        </Button>
      ) : null}
    </li>
  );
}

function VehicleCard({ vehicle, can }: { vehicle: MyVehicle; can: HomeCapabilities }) {
  const status = VEHICLE_STATUS_LABEL[vehicle.status ?? ""] ?? { label: vehicle.status ?? "—", tone: "neutral" as const };
  const maintenance = vehicle.maintenance ? MAINTENANCE_STATUS_LABEL[vehicle.maintenance.status] : null;
  const place = [vehicle.operationName, vehicle.cityName ? `${vehicle.cityName}${vehicle.uf ? `/${vehicle.uf}` : ""}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="rounded-xl border border-border bg-surface-raised p-4 shadow-card" data-testid="meu-veiculo-cartao">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span aria-hidden className="flex size-12 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-fg [&_svg]:size-6">
            <Truck />
          </span>
          <div>
            <p className="text-section-title font-semibold tabular-nums text-fg">{vehicle.licensePlate ?? "Sem placa"}</p>
            <p className="text-caption text-fg-muted">
              {[vehicle.fleetCode ? `Frota ${vehicle.fleetCode}` : null, vehicle.typeName, vehicle.modelName].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
        </div>
        <StatusBadge status={status.tone} withIcon>
          {status.label}
        </StatusBadge>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-body-sm md:grid-cols-3">
        <div>
          <dt className="text-caption text-fg-muted">BR</dt>
          <dd className="font-medium text-fg">{vehicle.brCode ?? "—"}</dd>
        </div>
        <div className="col-span-2 md:col-span-2">
          <dt className="text-caption text-fg-muted">Operação</dt>
          <dd className="font-medium text-fg">{place || "—"}</dd>
        </div>
        <div>
          <dt className="text-caption text-fg-muted">Último checklist</dt>
          <dd className="font-medium text-fg" data-testid="veiculo-ultimo-checklist">
            {vehicle.lastChecklist
              ? `${dateTimeBr(vehicle.lastChecklist.submittedAt ?? vehicle.lastChecklist.date)} · ${vehicle.lastChecklist.context === "retorno" ? "retorno" : "saída"}${vehicle.lastChecklist.mine ? "" : " · outro motorista"}`
              : "Nenhum"}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-fg-muted">KM atual</dt>
          <dd className="font-medium tabular-nums text-fg" data-testid="veiculo-km">
            {vehicle.odometerKm != null ? `${int.format(vehicle.odometerKm)} km` : "Sem leitura"}
            {vehicle.odometerDate ? <span className="text-caption font-normal text-fg-muted"> · {dateBr(vehicle.odometerDate)}</span> : null}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-fg-muted">Apontamentos em aberto</dt>
          <dd className="font-medium text-fg" data-testid="veiculo-apontamentos">
            {vehicle.openReports == null ? (
              "—"
            ) : can.ownReports ? (
              <Link href="/checklist/planos-acao/meus-apontamentos" className="text-link hover:underline">
                {int.format(vehicle.openReports)}
              </Link>
            ) : (
              int.format(vehicle.openReports)
            )}
          </dd>
        </div>
        <div className="col-span-2 md:col-span-3">
          <dt className="text-caption text-fg-muted">Manutenção</dt>
          <dd className="font-medium text-fg" data-testid="veiculo-manutencao">
            {vehicle.maintenance && maintenance ? (
              <span className="inline-flex flex-wrap items-center gap-2">
                <StatusBadge status={maintenance.tone} size="sm" withIcon>
                  {maintenance.label}
                </StatusBadge>
                <span className="text-caption text-fg-muted">
                  {vehicle.maintenance.code}
                  {vehicle.maintenance.status === "in_progress" && vehicle.maintenance.expectedExitDate
                    ? ` · saída prevista ${dateBr(vehicle.maintenance.expectedExitDate)}`
                    : vehicle.maintenance.scheduledDate
                      ? ` · agendada para ${dateBr(vehicle.maintenance.scheduledDate)}`
                      : ""}
                </span>
              </span>
            ) : (
              "Sem manutenção aberta"
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * Início do Operacional — responde "o que preciso fazer agora?", nesta ordem:
 *
 *   saudação compacta › ações do dia › pendências › meus aplicativos ›
 *   meu veículo › histórico recente › meus números › resolução › calendário
 *
 * Tudo é da própria pessoa e vem do servidor já recortado; um bloco que não
 * carrega diz isso no lugar dos números e nunca mostra zero no lugar do erro.
 * Cada estado tem rótulo e ícone — a cor nunca é a única informação.
 */
export function OperationalHomeView({
  displayName,
  home,
  obligations,
  competence,
  currentCompetence,
  can,
  now,
  basePath = "/inicio",
  detailLoader,
}: OperationalHomeProps) {
  const router = useRouter();
  const [navigating, startNavigation] = React.useTransition();

  const data = home.ok ? home.data : null;
  const name = data?.employee?.name || displayName;
  const firstName = name.trim().split(/\s+/)[0] || name;
  const context = [
    data ? longDateBr(data.today) : null,
    data?.employee?.operationName ?? null,
    data?.employee?.unitName ?? null,
    data?.employee?.code ? `Matrícula ${data.employee.code}` : null,
  ].filter(Boolean);

  const joiner = basePath.includes("?") ? "&" : "?";
  const goTo = (c: Competence) =>
    startNavigation(() => router.push(`${basePath}${joiner}ano=${c.year}&mes=${c.month}#calendario`, { scroll: false }));
  const retry = () => startNavigation(() => router.refresh());

  const actions = React.useMemo(
    () => (data ? buildDayActions(data.todayActions, data.pending, can, now) : []),
    [data, can, now],
  );
  const open = openActions(actions);
  const done = actions.filter((a) => a.state === "concluido").length;
  const issues = open.filter((a) => a.state === "vencido" || a.state === "retornado");
  const apps = React.useMemo(() => visibleApps(data?.apps ?? null, can), [data, can]);

  const reports = data?.reports ?? null;
  const treated = reports ? reports.open + reports.resolved : 0;
  const resolvedPct = reports && treated > 0 ? (reports.resolved * 100) / treated : null;

  return (
    <>
      <PageHeader
        eyebrow="Início"
        title={`Olá, ${firstName}`}
        description={context.length ? context.join(" · ") : "O que você precisa fazer hoje, os seus aplicativos e o seu veículo."}
      />
      <PageContent aria-busy={navigating || undefined}>
        <div className="flex w-full max-w-5xl flex-col gap-6" data-testid="inicio-operacional">
          {/* ------------------------------------------------------ ações do dia */}
          <HomeSection
            id="acoes-do-dia"
            title="Ações do dia"
            icon={<ClipboardCheck />}
            description={
              data && actions.length
                ? `${int.format(done)} de ${int.format(actions.length)} concluídas`
                : "As obrigações de hoje pela regra oficial da Aderência."
            }
            testId="acoes-do-dia"
          >
            {!data ? (
              <ErrorState
                variant="panel"
                headingLevel={3}
                title="Não foi possível carregar as suas ações de hoje."
                description={home.ok ? undefined : home.error}
                onRetry={retry}
                retrying={navigating}
              />
            ) : data.todayActions === null && data.pending.length === 0 ? (
              <EmptyState
                variant="panel"
                headingLevel={3}
                icon={<ClipboardCheck />}
                title="Sua conta não consulta as obrigações do dia"
                description="Peça ao seu gestor a permissão de ver a própria situação na Aderência. Enquanto isso, o Check List de Frota continua disponível em Meus aplicativos."
              />
            ) : actions.length === 0 ? (
              <EmptyState
                variant="panel"
                headingLevel={3}
                icon={<Sparkles />}
                title="Tudo em dia"
                description={
                  data.vehicle
                    ? "Nenhuma obrigação de checklist para hoje."
                    : "Você não é motorista titular de nenhuma BR hoje; quando houver, as saídas e os retornos aparecem aqui."
                }
                action={
                  can.checklistExecute ? (
                    <Button asChild>
                      <Link href="/aplicativos/check-list-frota">Abrir o Check List de Frota</Link>
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border-emphasis bg-surface-raised shadow-card">
                <ul className="divide-y divide-border" aria-label="Ações de hoje">
                  {actions.map((item) => (
                    <ActionRow key={item.key} item={item} />
                  ))}
                </ul>
              </div>
            )}
          </HomeSection>

          {/* -------------------------------------------------------- pendências */}
          {data ? (
            <HomeSection
              id="pendencias"
              title="Pendências"
              icon={<AlertTriangle />}
              description="Só o que depende de você: prazos vencidos e vistorias devolvidas."
              testId="pendencias"
            >
              {issues.length === 0 ? (
                <p
                  className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-4 py-3 text-body-sm text-fg-secondary"
                  data-testid="pendencias-vazio"
                >
                  <CheckCircle2 aria-hidden className="size-4 text-success-soft-fg" />
                  Nenhuma pendência. Tudo em dia.
                </p>
              ) : (
                <div className="overflow-hidden rounded-xl border border-border bg-surface-raised shadow-card">
                  <ul className="divide-y divide-border" aria-label="Pendências">
                    {issues.map((item) => (
                      <ActionRow key={`p-${item.key}`} item={item} />
                    ))}
                  </ul>
                </div>
              )}
            </HomeSection>
          ) : null}

          {/* -------------------------------------------------- meus aplicativos */}
          {can.apps ? (
            <HomeSection
              id="meus-aplicativos"
              title="Meus aplicativos"
              icon={<LayoutGrid />}
              testId="meus-aplicativos"
              actions={
                <Button asChild size="sm" variant="secondary">
                  <Link href="/aplicativos">Ver todos</Link>
                </Button>
              }
            >
              {apps.length === 0 ? (
                <EmptyState
                  variant="panel"
                  headingLevel={3}
                  icon={<LayoutGrid />}
                  title="Nenhum aplicativo liberado"
                  description="Nenhum aplicativo está liberado para você ou habilitado para a sua operação."
                />
              ) : (
                <AppGrid apps={apps} />
              )}
            </HomeSection>
          ) : null}

          {/* ------------------------------------------------------- meu veículo */}
          {data ? (
            <HomeSection id="meu-veiculo" title="Meu veículo" icon={<Truck />} testId="meu-veiculo">
              {data.vehicle ? (
                <VehicleCard vehicle={data.vehicle} can={can} />
              ) : (
                <EmptyState
                  variant="panel"
                  headingLevel={3}
                  icon={<Truck />}
                  title="Sem veículo fidelizado hoje"
                  description="O veículo aparece aqui quando você é o motorista titular de uma BR na Fidelização."
                />
              )}
            </HomeSection>
          ) : null}

          {/* -------------------------------------------------- histórico recente */}
          {data ? (
            <HomeSection
              id="historico-recente"
              title="Histórico recente"
              icon={<History />}
              testId="historico-recente"
              actions={
                can.ownChecklists ? (
                  <Button asChild size="sm" variant="secondary">
                    <Link href="/aplicativos/check-list-frota/meus-checklists">Ver histórico</Link>
                  </Button>
                ) : undefined
              }
            >
              {data.recent.length === 0 ? (
                <p className="rounded-lg border border-border bg-surface-raised px-4 py-3 text-body-sm text-fg-secondary">
                  Nenhuma atividade registrada ainda. O que você enviar pelos aplicativos aparece aqui.
                </p>
              ) : (
                <div className="overflow-hidden rounded-xl border border-border bg-surface-raised shadow-card">
                  <ul className="divide-y divide-border" aria-label="Atividades recentes">
                    {data.recent.map((a) => {
                      const status = INSPECTION_STATUS_LABEL[a.status] ?? { label: a.status, tone: "neutral" as const };
                      return (
                        <li key={`${a.kind}-${a.id}`} className="flex items-center gap-3 px-3 py-2.5 sm:px-4" data-testid="atividade">
                          <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-interactive text-fg-secondary [&_svg]:size-4">
                            {ACTIVITY_ICON[a.kind]}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-body-sm font-medium text-fg">
                              {activityTitle(a)}
                              {a.licensePlate ? <span className="text-fg-muted"> · {a.licensePlate}</span> : null}
                            </p>
                            <p className="text-caption text-fg-muted">
                              {dateTimeBr(a.submittedAt ?? a.date)}
                              {a.protocol ? ` · ${a.protocol}` : ""}
                              {a.nonConforming ? ` · ${int.format(a.nonConforming)} ${a.nonConforming === 1 ? "apontamento" : "apontamentos"}` : ""}
                            </p>
                          </div>
                          <StatusBadge status={status.tone} size="sm" withIcon>
                            {status.label}
                          </StatusBadge>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </HomeSection>
          ) : null}

          {/* ------------------------------------------------------ meus números */}
          <HomeSection id="meus-numeros" title="Meus números" icon={<Gauge />} testId="meus-numeros">
            {!data ? (
              <ErrorState
                variant="panel"
                headingLevel={3}
                title="Não foi possível carregar seus números."
                description={home.ok ? undefined : home.error}
                onRetry={retry}
                retrying={navigating}
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <KpiCard
                  label="Checklists realizados"
                  value={data.checklists.total}
                  status="primary"
                  icon={<ClipboardCheck />}
                  period={
                    data.checklists.lastDate
                      ? `Último em ${dateBr(data.checklists.lastDate)} · ${int.format(data.checklists.monthTotal)} neste mês`
                      : "Nenhum enviado ainda"
                  }
                  data-testid="kpi-checklists"
                />
                {reports ? (
                  <>
                    <KpiCard
                      label="Aguardando reparo"
                      value={reports.open}
                      status={reports.open > 0 ? "warning" : "neutral"}
                      icon={<Wrench />}
                      period={`Apontamentos em tratativa · últimos ${reports.windowDays} dias`}
                      data-testid="kpi-aguardando"
                    />
                    <KpiCard
                      label="Já resolvidos"
                      value={reports.resolved}
                      status="success"
                      icon={<CheckCircle2 />}
                      period={
                        resolvedPct == null
                          ? `Nenhum apontamento nos últimos ${reports.windowDays} dias`
                          : `${pct1.format(resolvedPct)}% dos seus apontamentos`
                      }
                      data-testid="kpi-resolvidos"
                    />
                  </>
                ) : null}
              </div>
            )}
          </HomeSection>

          {data && reports ? (
            <HomeSection
              id="resolucao"
              title="Quanto do que apontei já foi resolvido"
              icon={<CheckCircle2 />}
              testId="resolucao"
              actions={
                can.ownReports ? (
                  <Button asChild size="sm" variant="secondary">
                    <Link href="/checklist/planos-acao/meus-apontamentos">Ver meus apontamentos</Link>
                  </Button>
                ) : undefined
              }
            >
              <div className="rounded-xl border border-border bg-surface-raised p-4 shadow-card">
                {treated === 0 ? (
                  <p className="text-body-sm text-fg-secondary">
                    Você ainda não tem apontamentos de manutenção nos últimos {reports.windowDays} dias. Assim que houver,
                    o andamento dos reparos aparece aqui.
                    {reports.closedOther > 0
                      ? ` ${int.format(reports.closedOther)} ${reports.closedOther === 1 ? "foi encerrado" : "foram encerrados"} sem reparo ou sem procedência.`
                      : ""}
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    <p className="text-kpi font-semibold text-success-soft-fg tabular-nums">{pct1.format(resolvedPct ?? 0)}%</p>
                    <Progress value={resolvedPct ?? 0} tone="success" srLabel="Apontamentos com reparo concluído" />
                    <p className="text-body-sm text-fg-secondary">
                      {int.format(reports.resolved)} de {int.format(treated)} apontamentos com reparo concluído nos últimos{" "}
                      {reports.windowDays} dias
                      {reports.closedOther > 0
                        ? ` · ${int.format(reports.closedOther)} encerrados sem reparo ou sem procedência`
                        : ""}
                      .
                    </p>
                  </div>
                )}
              </div>
            </HomeSection>
          ) : null}

          {/* -------------------------------------------------------- calendário */}
          <HomeSection
            id="calendario"
            title="Meu calendário de checklists"
            icon={<CalendarDays />}
            description="Cada dia mostra a Saída e o Retorno. Só é falta o que era obrigação: a BR em que você é motorista titular, com os expurgos da Aderência. Dia sem obrigação e sem checklist fica neutro."
          >
            {!data ? (
              <ErrorState
                variant="panel"
                headingLevel={3}
                title="Não foi possível carregar o seu calendário."
                description={home.ok ? undefined : home.error}
                onRetry={retry}
                retrying={navigating}
              />
            ) : (
              <ChecklistCalendar
                competence={competence}
                currentCompetence={currentCompetence}
                today={data.today}
                executions={data.executions}
                executionsTruncated={data.executionsTruncated}
                obligations={obligations}
                onNavigate={goTo}
                navigating={navigating}
                canOpenExecution={can.ownChecklists}
                detailLoader={detailLoader}
              />
            )}
          </HomeSection>
        </div>
      </PageContent>
    </>
  );
}
