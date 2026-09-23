"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CalendarCheck, CalendarX2, CheckCircle2, ClipboardList, Gauge, Send, Timer, UserX, XCircle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { FilterBar } from "@/components/ui/filter-bar";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { CompetencePicker } from "@/components/governance/competence-picker";
import { formatCompetence, type Competence } from "@/lib/governance/competence";
import type { StatusTone } from "@/lib/adherence/queries";
import type {
  MyPendingSituation, MySituation, MySituationCell, MySituationCounts, MySituationDay, MySituationPending, MySituationResult,
} from "@/lib/adherence/my-situation";
import { CONTEXT_LABEL, formatDateBr, formatDateTimeBr, formatInt, formatPct, statusMeta } from "../status";
import { pctTone } from "../consolidated-panel";

export interface MySituationViewProps {
  competence: Competence;
  result: MySituationResult;
  /** Competência do dia operacional vigente (servidor), para o atalho "Mês atual". */
  currentCompetence: Competence;
  /** Caminho base da navegação (a prévia de desenvolvimento usa outro). */
  basePath?: string;
  /** Link para a Aderência da operação — só para quem tem `adherence.view`. */
  operationViewHref?: string | null;
}

const SHORT_CONTEXT = { saida: "Saída", retorno: "Retorno" } as const;

/** As mesmas palavras do Acompanhamento do Retorno (§50): retorno no prazo não é falta. */
const PENDING_META: Record<MyPendingSituation, { label: string; tone: StatusTone }> = {
  provisional: { label: "Não fez checklist · dia vigente", tone: "danger" },
  overdue: { label: "Não fez checklist", tone: "danger" },
  overdue_after_departure: { label: "Retorno vencido (saiu)", tone: "danger" },
  awaiting_return: { label: "Aguardando retorno", tone: "info" },
  not_departed: { label: "Retorno no prazo · sem saída registrada", tone: "neutral" },
};

const sameCompetence = (a: Competence, b: Competence) => a.year === b.year && a.month === b.month;

/** "qua., 23/09" — o dia da semana do calendário, sem fuso (a data já é operacional). */
function dayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const weekday = d.toLocaleDateString("pt-BR", { weekday: "short", timeZone: "UTC" });
  return `${weekday} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

function vehicleLabel(fleetCode: string | null, plate: string | null): string {
  return [fleetCode, plate].filter(Boolean).join(" · ") || "Veículo sem identificação";
}

/**
 * Gestão de Checklist → Aderência → Minha situação (§63).
 *
 * A aderência da própria pessoa na competência, e nada além dela: as saídas e
 * os retornos da BR em que é motorista titular fidelizado e os checklists que
 * ela mesma enviou. Números, status e prazo vêm prontos do banco — a mesma
 * fórmula da Aderência da operação; a tela só apresenta.
 *
 * Pensada para o celular: listas empilhadas, nenhuma tabela larga, e cada
 * estado vazio diz o porquê e o que fazer.
 */
export function MySituationView({
  competence, result, currentCompetence, basePath = "/checklist/aderencia/minha-situacao", operationViewHref = null,
}: MySituationViewProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  // A competência vive na URL: um link copiado abre o mesmo mês.
  const goTo = React.useCallback(
    (c: Competence) => {
      const next = new URLSearchParams(params.toString());
      next.set("ano", String(c.year));
      next.set("mes", String(c.month));
      startTransition(() => router.push(`${basePath}?${next.toString()}`, { scroll: false }));
    },
    [router, params, basePath],
  );

  return (
    <>
      <PageHeader
        title="Minha situação"
        description="Sua aderência aos checklists obrigatórios: saídas e retornos da BR em que você é motorista fidelizado e os checklists que você enviou."
        secondaryActions={
          operationViewHref ? (
            <Button asChild variant="secondary" leadingIcon={<Gauge />}>
              <Link href={operationViewHref}>Aderência da operação</Link>
            </Button>
          ) : undefined
        }
        filters={
          <FilterBar className="flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-caption text-fg-muted">Competência</span>
              <CompetencePicker value={competence} onChange={goTo} disabled={pending} />
            </div>
            <Button
              variant="outline"
              size="sm"
              leadingIcon={<CalendarCheck />}
              disabled={pending || sameCompetence(currentCompetence, competence)}
              onClick={() => goTo(currentCompetence)}
            >
              Mês atual
            </Button>
          </FilterBar>
        }
      />

      <PageContent className="flex flex-col gap-5" aria-busy={pending || undefined}>
        {!result.ok ? (
          <ErrorState
            variant="panel"
            headingLevel={2}
            title="Não foi possível carregar a sua situação."
            description={result.error}
            onRetry={() => startTransition(() => router.refresh())}
            retrying={pending}
          />
        ) : result.data.state === "no_employee" ? (
          <EmptyState
            variant="panel"
            icon={<UserX />}
            headingLevel={2}
            title="Sua conta não está vinculada a um colaborador"
            description="A sua situação é calculada a partir do cadastro de colaborador ligado à sua conta nesta organização. Peça ao administrador do HFM para vincular o seu cadastro em Colaboradores e usuários."
          />
        ) : result.data.state === "not_driver" ? (
          <EmptyState
            variant="panel"
            icon={<CalendarX2 />}
            headingLevel={2}
            title={`Nenhuma BR fidelizada em ${formatCompetence(competence)}`}
            description="A sua situação mostra as saídas e os retornos da BR em que você está como motorista titular na Fidelização e os checklists que você enviou. Nesta competência não há nenhum dos dois. Se você dirige um veículo fidelizado, peça à sua liderança para registrar você como motorista na Fidelização."
          />
        ) : (
          <SituationContent data={result.data} competence={competence} />
        )}
      </PageContent>
    </>
  );
}

function SituationContent({ data, competence }: { data: MySituation; competence: Competence }) {
  const total = data.summary?.total ?? null;
  return (
    <>
      <p className="text-body-sm text-fg-muted">
        {data.employeeName ? <span className="font-medium text-fg">{data.employeeName}</span> : null}
        {data.employeeName ? " · " : ""}
        {formatCompetence(competence)} · dia vigente {formatDateBr(data.today)}
      </p>

      <PositionsCard data={data} />

      {total ? <SummaryKpis total={total} /> : null}
      {data.summary ? <ContextBreakdown saida={data.summary.saida} retorno={data.summary.retorno} /> : null}

      <PendingSection items={data.pending} total={data.pendingTotal} />
      <DaysSection days={data.days} today={data.today} />

      <Card>
        <CardContent className="flex flex-col gap-2 p-4 text-body-sm text-fg-muted">
          <p className="flex items-start gap-2">
            <Send className="mt-0.5 size-4 shrink-0 text-fg-muted" aria-hidden />
            <span>
              Checklists enviados por você na competência:{" "}
              <span className="font-medium text-fg">{formatInt(data.executions.submitted)}</span>
              {" "}· {formatInt(data.executions.linked)} conciliado{data.executions.linked === 1 ? "" : "s"} com uma obrigação.
            </span>
          </p>
          <p>
            Aderência = feitas ÷ devidas × 100, a mesma fórmula da Aderência da operação. Retorno ainda no prazo e datas
            futuras não entram na conta; expurgo aprovado sai do denominador; justificativa pendente não muda nada até a decisão.
          </p>
        </CardContent>
      </Card>
    </>
  );
}

function PositionsCard({ data }: { data: MySituation }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <h2 className="text-h4 font-semibold text-fg">Sua fidelização no mês</h2>
        {data.positions.length === 0 ? (
          <p className="text-body-sm text-fg-muted">
            Você não está como motorista titular de nenhuma BR nesta competência. A situação abaixo vem só dos checklists que você enviou.
          </p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="BRs em que você é motorista titular">
            {data.positions.map((p) => (
              <li
                key={`${p.operationBrId}-${p.dateFrom}`}
                className="flex min-w-0 flex-col gap-0.5 rounded-sm border border-border bg-surface-secondary px-3 py-2"
              >
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-semibold break-all text-fg">{p.brCode}</span>
                  <span className="text-body-sm text-fg-secondary">{vehicleLabel(p.fleetCode, p.licensePlate)}</span>
                </span>
                <span className="text-caption text-fg-muted">
                  {[p.operationName, [p.cityName, p.uf].filter(Boolean).join("/")].filter(Boolean).join(" · ")}
                  {" · "}de {formatDateBr(p.dateFrom)} a {formatDateBr(p.dateTo)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryKpis({ total }: { total: MySituationCounts }) {
  const tone = pctTone(total.adherencePct, total.targetPct);
  return (
    <section aria-labelledby="my-summary" className="flex flex-col gap-3">
      <h2 id="my-summary" className="sr-only">Resumo do mês</h2>
      {/* No celular: a aderência e as planejadas ocupam a linha toda; o resto, em pares. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <KpiCard
          className="col-span-2 sm:col-span-1"
          label="Aderência no mês"
          value={formatPct(total.adherencePct)}
          status={tone === "neutral" ? "neutral" : tone}
          period={`${formatInt(total.numerator)} feitas / ${formatInt(total.denominator)} devidas${total.targetPct == null ? "" : ` · meta ${formatPct(total.targetPct)}`}`}
          icon={<Gauge />}
        />
        <KpiCard label="Devidas" value={formatInt(total.denominator)} period="obrigações já exigíveis" icon={<ClipboardList />} />
        <KpiCard label="Feitas" value={formatInt(total.numerator)} status="success" icon={<CheckCircle2 />} />
        <KpiCard
          label="Não feitas"
          value={formatInt(total.notDone)}
          status={total.notDone > 0 ? "danger" : "neutral"}
          period={total.provisional > 0 ? `${formatInt(total.provisional)} provisória (hoje)` : undefined}
          icon={<XCircle />}
        />
        <KpiCard
          label="Pendências de retorno"
          value={formatInt(total.pendingReturn)}
          status={total.pendingReturn > 0 ? "info" : "neutral"}
          period="no prazo — não é falta"
          icon={<Timer />}
        />
        <KpiCard
          className="col-span-2 sm:col-span-1"
          label="Planejadas"
          value={formatInt(total.planned)}
          period="datas futuras, fora da conta"
          icon={<CalendarCheck />}
        />
      </div>
    </section>
  );
}

function ContextBreakdown({ saida, retorno }: { saida: MySituationCounts; retorno: MySituationCounts }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <h2 className="text-h4 font-semibold text-fg">Saída e retorno</h2>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {([["saida", saida], ["retorno", retorno]] as const).map(([ctx, c]) => (
            <div key={ctx} className="flex items-center justify-between gap-3 rounded-sm border border-border px-3 py-2">
              <dt className="text-body-sm text-fg-secondary">{CONTEXT_LABEL[ctx]}</dt>
              <dd className="flex flex-col items-end">
                <StatusBadge status={pctTone(c.adherencePct, c.targetPct)} size="sm">{formatPct(c.adherencePct)}</StatusBadge>
                <span className="text-caption text-fg-muted tabular-nums">
                  {formatInt(c.numerator)} / {formatInt(c.denominator)}
                  {ctx === "retorno" && c.pendingReturn > 0 ? ` · ${formatInt(c.pendingReturn)} no prazo` : ""}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function PendingSection({ items, total }: { items: MySituationPending[]; total: number }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="my-pending" className="text-h4 font-semibold text-fg">Pendências</h2>
          <span className="text-caption text-fg-muted">
            {items.length < total ? `${formatInt(items.length)} de ${formatInt(total)}` : `${formatInt(total)} no mês`}
          </span>
        </div>
        {items.length === 0 ? (
          <EmptyState
            size="sm"
            variant="panel"
            icon={<CheckCircle2 />}
            headingLevel={3}
            title="Nenhuma pendência na competência"
            description="Todas as saídas e retornos já exigíveis foram feitos ou expurgados. Datas futuras aparecem no dia a dia como planejadas."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border" aria-labelledby="my-pending">
            {items.map((p) => {
              const meta = PENDING_META[p.situation];
              return (
                <li key={`${p.date}-${p.context}-${p.brCode ?? ""}-${p.licensePlate ?? ""}`} className="flex min-w-0 flex-col gap-1.5 py-2.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium text-fg tabular-nums">{dayLabel(p.date)}</span>
                    <span className="text-body-sm text-fg-secondary">{CONTEXT_LABEL[p.context]}</span>
                    <StatusBadge status={meta.tone} size="sm">{meta.label}</StatusBadge>
                    {p.pendingRequest ? <StatusBadge status="warning" size="sm">Justificativa pendente</StatusBadge> : null}
                  </div>
                  <span className="text-caption break-words text-fg-muted">
                    {[p.brCode, vehicleLabel(p.fleetCode, p.licensePlate), p.cityName].filter(Boolean).join(" · ")}
                    {p.deadlineAt ? ` · prazo ${formatDateTimeBr(p.deadlineAt)}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function CellBadge({ context, cell }: { context: "saida" | "retorno"; cell: MySituationCell | null }) {
  if (!cell) {
    return (
      <span className="text-caption text-fg-subtle">
        {SHORT_CONTEXT[context]}: sem obrigação
      </span>
    );
  }
  const meta = statusMeta(cell.status);
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
      <span className="text-caption text-fg-muted">{SHORT_CONTEXT[context]}</span>
      <StatusBadge status={meta.tone} size="sm">
        {meta.label}
        {cell.provisional ? " · provisório" : ""}
      </StatusBadge>
      {cell.performedByMe ? (
        <span className="inline-flex items-center gap-0.5 text-caption text-fg-muted" title="Checklist enviado por você">
          <Send className="size-3" aria-hidden />
          <span className="sr-only">Checklist enviado por você</span>
          <span aria-hidden>você</span>
        </span>
      ) : null}
      {cell.pendingRequest ? <StatusBadge status="warning" size="sm">Justificativa pendente</StatusBadge> : null}
    </span>
  );
}

function DaysSection({ days, today }: { days: MySituationDay[]; today: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-0.5">
          <h2 id="my-days" className="text-h4 font-semibold text-fg">Dia a dia</h2>
          <p className="text-caption text-fg-muted">Saída e retorno de cada dia, com o status oficial da Aderência.</p>
        </div>
        {days.length === 0 ? (
          <EmptyState
            size="sm"
            variant="panel"
            icon={<ClipboardList />}
            headingLevel={3}
            title="Nenhuma obrigação gerada ainda"
            description="O vínculo existe, mas o planejamento desta competência ainda não gerou obrigações. Elas aparecem aqui assim que a rotina da Aderência processar o período."
          />
        ) : (
          <ol className="flex flex-col divide-y divide-border" aria-labelledby="my-days">
            {days.map((d) => {
              const isToday = d.date === today;
              return (
                <li
                  key={`${d.date}-${d.brCode ?? ""}-${d.licensePlate ?? ""}-${d.journey}`}
                  className={cn(
                    "grid min-w-0 grid-cols-1 gap-1.5 py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center sm:gap-3",
                    isToday && "-ml-3 border-l-2 border-l-primary pl-2.5",
                  )}
                  aria-current={isToday ? "date" : undefined}
                >
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium text-fg tabular-nums">{dayLabel(d.date)}</span>
                    {isToday ? <Badge variant="primary" appearance="solid" size="sm">Hoje</Badge> : null}
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-caption break-words text-fg-muted">
                      {[d.brCode, vehicleLabel(d.fleetCode, d.licensePlate)].filter(Boolean).join(" · ")}
                      {!d.byFidelization && d.byExecution ? " · checklist enviado por você em outra BR" : ""}
                    </span>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <CellBadge context="saida" cell={d.saida} />
                      <CellBadge context="retorno" cell={d.retorno} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
