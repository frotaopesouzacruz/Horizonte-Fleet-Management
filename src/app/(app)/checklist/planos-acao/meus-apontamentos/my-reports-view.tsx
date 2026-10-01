"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardCheck, ClipboardList, MessageSquareText, Wrench } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { ItemStatusBadge } from "@/components/action-plans/badges";
import {
  CHECKLIST_TYPE_LABEL,
  formatDate,
  formatInt,
  MAINTENANCE_STATUS_LABEL,
  OPEN_ITEM_STATUSES,
} from "@/lib/action-plans/labels";
import type { MyReportRow } from "@/lib/action-plans/types";

export type MyReportsResult =
  | { ok: true; data: { employeeId: string | null; rows: MyReportRow[] } }
  | { ok: false; error: string };

export interface MyReportsViewProps {
  result: MyReportsResult;
  /** Janela consultada, em dias. */
  days: number;
  /** Dia operacional (São Paulo), do servidor. */
  today: string;
  /** Link para o portal de planos — só para quem tem `action_plans.view`. */
  portalHref?: string | null;
}

type Filter = "todos" | "abertos" | "tratados";

const FILTER_LABEL: Record<Filter, string> = {
  todos: "Todos",
  abertos: "Em andamento",
  tratados: "Tratados",
};

const shortDay = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });

/** aaaa-mm-dd ou instante → dd/mm (sem fuso para a data pura). */
function ddmm(value: string | null | undefined): string {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m) return `${m[3]}/${m[2]}`;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : shortDay.format(d);
}

const isOpen = (row: MyReportRow) => OPEN_ITEM_STATUSES.includes(row.itemStatus);

/**
 * A frase que o motorista lê: o que está acontecendo com o que ele apontou.
 * Vem da situação do apontamento e da manutenção que o trata — nenhuma regra
 * nova, só a tradução do que o banco já disse.
 */
function friendlySentence(row: MyReportRow): string {
  const m = row.maintenance;
  switch (row.itemStatus) {
    case "resolved": {
      const at = m?.exitDate ?? row.resolvedAt;
      return at ? `Concluída em ${ddmm(at)}` : "Concluída";
    }
    case "resolved_without_maintenance":
      return "Resolvido sem manutenção";
    case "improper":
      return "Improcedente";
    case "cancelled":
      return "Cancelado";
    case "needs_action":
      return "Aguardando nova tratativa da equipe de manutenção";
    case "in_maintenance":
    case "pending":
    default: {
      if (m?.status === "in_progress") return "Em execução";
      if (m?.status === "completed") return m.exitDate ? `Concluída em ${ddmm(m.exitDate)}` : "Concluída";
      if (m?.status === "scheduled" || m?.scheduledDate) {
        return m.scheduledDate ? `Manutenção agendada para ${ddmm(m.scheduledDate)}` : "Manutenção agendada";
      }
      if (m) return "Manutenção aberta, aguardando agendamento";
      if (row.planStatus === "in_analysis") return "Em análise pela equipe de manutenção";
      return "Recebido — aguardando análise da equipe de manutenção";
    }
  }
}

/**
 * Gestão de Checklist → Planos de Ação → Meus apontamentos (§65).
 *
 * O retorno ao motorista: cada inconformidade de manutenção que ele apontou
 * no Check List, com a situação atual em uma frase e a manutenção que a
 * trata. Só leitura — nenhuma ação administrativa. Pensada para o celular:
 * cartões empilhados, nenhuma tabela larga.
 */
export function MyReportsView({ result, days, today, portalHref = null }: MyReportsViewProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [filter, setFilter] = React.useState<Filter>("todos");

  const rows = React.useMemo(() => (result.ok ? result.data.rows : []), [result]);
  const counts = React.useMemo(
    () => ({ todos: rows.length, abertos: rows.filter(isOpen).length, tratados: rows.filter((r) => !isOpen(r)).length }),
    [rows],
  );
  const visible = rows.filter((r) => (filter === "todos" ? true : filter === "abertos" ? isOpen(r) : !isOpen(r)));

  return (
    <>
      <PageHeader
        eyebrow="Gestão de checklist"
        title="Meus apontamentos"
        description={`O andamento das inconformidades de manutenção que você apontou no Check List de Frota nos últimos ${days} dias.`}
        secondaryActions={
          portalHref ? (
            <Button asChild variant="secondary" leadingIcon={<ClipboardList />}>
              <Link href={portalHref}>Planos de ação</Link>
            </Button>
          ) : undefined
        }
      />

      <PageContent aria-busy={pending || undefined}>
        <div className="flex w-full max-w-3xl flex-col gap-4">
        {!result.ok ? (
          <ErrorState
            variant="panel"
            headingLevel={2}
            title="Não foi possível carregar os seus apontamentos."
            description={result.error}
            onRetry={() => startTransition(() => router.refresh())}
            retrying={pending}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            variant="panel"
            icon={<ClipboardCheck />}
            headingLevel={2}
            title={`Nenhum apontamento nos últimos ${days} dias`}
            description={
              result.data.employeeId
                ? "Quando você marcar um item de manutenção como inconforme no Check List de Frota, ele aparece aqui com o andamento: análise, manutenção agendada, execução e conclusão."
                : "Sua conta não está vinculada a um cadastro de colaborador; aparecem aqui só os checklists enviados por esta conta. Se você envia checklists com outra conta, peça ao administrador do HFM para vincular o seu cadastro."
            }
          />
        ) : (
          <>
            <p className="text-body-sm text-fg-muted">
              {formatInt(counts.todos)} {counts.todos === 1 ? "apontamento" : "apontamentos"} ·{" "}
              {formatInt(counts.abertos)} em andamento · {formatInt(counts.tratados)}{" "}
              {counts.tratados === 1 ? "tratado" : "tratados"} · atualizado em {formatDate(today)}
            </p>

            <div role="group" aria-label="Filtrar apontamentos" className="flex flex-wrap gap-1.5">
              {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={filter === f ? "primary" : "outline"}
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                >
                  {FILTER_LABEL[f]} ({formatInt(counts[f])})
                </Button>
              ))}
            </div>

            {visible.length === 0 ? (
              <EmptyState
                size="sm"
                variant="panel"
                headingLevel={2}
                title={filter === "abertos" ? "Nada em andamento" : "Nenhum apontamento tratado ainda"}
                description={
                  filter === "abertos"
                    ? "Todos os seus apontamentos do período já foram tratados."
                    : "Os apontamentos aparecem aqui quando a manutenção ou a equipe concluir a tratativa."
                }
              />
            ) : (
              <ul className="flex flex-col gap-3" aria-label="Seus apontamentos" data-testid="my-reports-list">
                {visible.map((row) => (
                  <li key={row.itemId}>
                    <ReportCard row={row} />
                  </li>
                ))}
              </ul>
            )}

            <Card>
              <CardContent className="flex items-start gap-2 p-4 text-body-sm text-fg-muted">
                <MessageSquareText className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p>
                  Cada apontamento é tratado pela equipe de manutenção da sua operação: pode virar uma manutenção, ser resolvido
                  sem manutenção (um ajuste simples) ou ser considerado improcedente após a verificação. Avarias seguem o fluxo
                  próprio de Sinistros/Avarias e não aparecem aqui.
                </p>
              </CardContent>
            </Card>
          </>
        )}
        </div>
      </PageContent>
    </>
  );
}

function ReportCard({ row }: { row: MyReportRow }) {
  const open = isOpen(row);
  const m = row.maintenance;
  const relato = [row.detailText, row.note].filter((v): v is string => Boolean(v && v.trim()));
  return (
    <article
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-md border border-border bg-surface p-4",
        open && "border-l-2 border-l-warning",
      )}
      data-testid="my-report"
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-fg-muted">
        <span className="font-medium text-fg tabular-nums">{formatDate(row.operationalDate)}</span>
        {row.checklistType ? (
          <Badge variant="neutral" appearance="outline" size="sm">
            {CHECKLIST_TYPE_LABEL[row.checklistType] ?? row.checklistType}
          </Badge>
        ) : null}
        {row.licensePlate ? <span className="font-mono text-fg-secondary">{row.licensePlate}</span> : null}
        <span className="ml-auto font-mono">{row.planCode}</span>
      </header>

      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="text-body font-semibold break-words text-fg">
          {row.title}
          {row.detail ? <span className="font-normal text-fg-secondary"> — {row.detail}</span> : null}
        </h2>
        {row.clusterName ? <span className="text-caption text-fg-muted">{row.clusterName}</span> : null}
      </div>

      {relato.length ? (
        <blockquote className="rounded-sm border-l-2 border-border-strong bg-surface-secondary px-3 py-2 text-body-sm break-words text-fg-secondary">
          <span className="sr-only">Seu relato: </span>
          {relato.join(" · ")}
        </blockquote>
      ) : null}

      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <ItemStatusBadge status={row.itemStatus} />
          <span className="text-body-sm font-medium text-fg">{friendlySentence(row)}</span>
        </div>
        {row.daysToTreat != null ? (
          <span className="text-caption text-fg-muted">
            Tratado em {formatInt(row.daysToTreat)} {row.daysToTreat === 1 ? "dia" : "dias"}
          </span>
        ) : null}
      </div>

      {m ? (
        <div className="flex flex-col gap-1.5 rounded-sm border border-border px-3 py-2">
          <span className="flex flex-wrap items-center gap-2 text-caption text-fg-muted">
            <Wrench className="size-3.5" aria-hidden />
            <span>
              Manutenção <span className="font-mono text-fg-secondary">{m.code}</span>
            </span>
            <Badge variant="neutral" size="sm">{MAINTENANCE_STATUS_LABEL[m.status] ?? m.status}</Badge>
          </span>
          {m.services ? <span className="text-body-sm break-words text-fg">{m.services}</span> : null}
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-caption sm:grid-cols-2">
            {m.serviceOrderNumber ? <Mini label="OS">{m.serviceOrderNumber}</Mini> : null}
            {m.supplierName ? <Mini label="Oficina">{m.supplierName}</Mini> : null}
            {m.scheduledDate ? <Mini label="Agendada para">{formatDate(m.scheduledDate)}</Mini> : null}
            {m.entryDate ? <Mini label="Entrada">{formatDate(m.entryDate)}</Mini> : null}
            {m.exitDate ? <Mini label="Saída">{formatDate(m.exitDate)}</Mini> : null}
          </dl>
        </div>
      ) : null}
    </article>
  );
}

function Mini({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 gap-1">
      <dt className="text-fg-muted">{label}:</dt>
      <dd className="min-w-0 break-words text-fg">{children}</dd>
    </div>
  );
}
