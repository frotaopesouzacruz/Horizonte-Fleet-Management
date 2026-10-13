"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, CalendarDays, CheckCircle2, CircleDot, ClipboardCheck, Gauge, History, ShieldCheck, UserCheck, Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/ui/kpi-card";
import { Progress } from "@/components/feedback/progress";
import { ErrorState } from "@/components/feedback/error-state";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import type { Competence } from "@/lib/governance/competence";
import type { Loaded, OperationalHome } from "@/lib/portal/types";
import { ChecklistCalendar, type ChecklistCalendarProps, type ObligationsSource } from "./checklist-calendar";
import { HomeSection, ShortcutCard } from "./shortcut-card";

export interface OperationalHomeProps {
  /** Nome da conta, para quando o cadastro do colaborador não veio. */
  displayName: string;
  home: Loaded<OperationalHome>;
  obligations: ObligationsSource;
  competence: Competence;
  currentCompetence: Competence;
  can: {
    viewApps: boolean;
    viewOwnChecklists: boolean;
    viewReports: boolean;
    viewSituation: boolean;
  };
  /** Caminho da tela (a prévia de desenvolvimento usa outro). */
  basePath?: string;
  detailLoader?: ChecklistCalendarProps["detailLoader"];
}

const int = new Intl.NumberFormat("pt-BR");
const pct1 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

function dateBr(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d ? `${d}/${m}/${y}` : iso;
}

/**
 * Início do Operacional — "Meu resumo" (HFC), na ordem do HFC:
 *
 *   saudação › abrir o app de checklist › atalhos › meus números ›
 *   quanto do que apontei já foi resolvido › meu calendário de checklists
 *
 * Tudo é da própria pessoa e vem do servidor já recortado; um bloco que não
 * carrega diz isso no lugar dos números, e nunca mostra zero no lugar do erro.
 */
export function OperationalHomeView({
  displayName,
  home,
  obligations,
  competence,
  currentCompetence,
  can,
  basePath = "/inicio",
  detailLoader,
}: OperationalHomeProps) {
  const router = useRouter();
  const [navigating, startNavigation] = React.useTransition();

  const data = home.ok ? home.data : null;
  const name = data?.employee?.name || displayName;
  // O título leva o primeiro nome (cabe no celular sem cortar); o nome
  // completo vai na linha de baixo, junto da matrícula.
  const firstName = name.trim().split(/\s+/)[0] || name;
  const identity = [
    name !== firstName ? name : null,
    data?.employee?.code ? `Matrícula ${data.employee.code}` : null,
    data?.employee?.jobPosition ?? null,
    data?.employee?.operationName ?? null,
  ].filter(Boolean);

  const joiner = basePath.includes("?") ? "&" : "?";
  const goTo = (c: Competence) =>
    startNavigation(() => router.push(`${basePath}${joiner}ano=${c.year}&mes=${c.month}#calendario`, { scroll: false }));
  const retry = () => startNavigation(() => router.refresh());

  const reports = data?.reports ?? null;
  const treated = reports ? reports.open + reports.resolved : 0;
  const resolvedPct = reports && treated > 0 ? (reports.resolved * 100) / treated : null;

  return (
    <>
      <PageHeader
        eyebrow="Meu resumo"
        title={`Olá, ${firstName}`}
        description={identity.length ? identity.join(" · ") : "Seus checklists, seus apontamentos e o seu calendário."}
      />
      <PageContent aria-busy={navigating || undefined}>
        <div className="flex w-full max-w-5xl flex-col gap-6" data-testid="inicio-operacional">
          <nav aria-label="Atalhos" className="flex flex-col gap-3">
            {can.viewApps ? (
              <ShortcutCard
                featured
                href="/aplicativos/check-list-frota"
                title="Abrir o App de Checklist"
                description="Responder o checklist do veículo agora"
                icon={<ClipboardCheck />}
                testId="atalho-checklist"
              />
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {can.viewOwnChecklists ? (
                <ShortcutCard
                  href="/aplicativos/check-list-frota/meus-checklists"
                  title="Meus checklists realizados"
                  description="Ver tudo o que já respondi"
                  icon={<History />}
                  tone="info"
                />
              ) : null}
              {can.viewReports ? (
                <ShortcutCard
                  href="/checklist/planos-acao/meus-apontamentos"
                  title="Meus apontamentos"
                  description="O andamento dos reparos do que apontei"
                  icon={<Wrench />}
                  tone="warning"
                />
              ) : null}
              {can.viewSituation ? (
                <ShortcutCard
                  href="/checklist/aderencia/minha-situacao"
                  title="Minha situação"
                  description="Minha aderência às saídas e retornos do mês"
                  icon={<UserCheck />}
                  tone="success"
                />
              ) : null}
              {can.viewApps ? (
                <>
                  <ShortcutCard
                    href="/aplicativos/vistoria-pneus"
                    title="Vistoria de Pneus"
                    description="Aferir sulcos e calibragem (leitura cega)"
                    icon={<CircleDot />}
                    tone="info"
                  />
                  <ShortcutCard
                    href="/aplicativos/vistoria-mtsr"
                    title="Vistoria MTSR"
                    description="Verificar os componentes MTSR do veículo em campo"
                    icon={<ShieldCheck />}
                    tone="highlight"
                  />
                </>
              ) : null}
            </div>
          </nav>

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
                      icon={<AlertTriangle />}
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
                <Button asChild size="sm" variant="secondary">
                  <Link href="/checklist/planos-acao/meus-apontamentos">Ver meus apontamentos</Link>
                </Button>
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
                canOpenExecution={can.viewOwnChecklists}
                detailLoader={detailLoader}
              />
            )}
          </HomeSection>
        </div>
      </PageContent>
    </>
  );
}
