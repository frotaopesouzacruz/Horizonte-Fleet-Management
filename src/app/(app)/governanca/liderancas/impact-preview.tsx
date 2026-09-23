"use client";

import * as React from "react";
import { ClipboardCheck, History, ListChecks, MapPin, Truck, UserRound } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { CheckboxField } from "@/components/ui/checkbox";
import type { LeadershipImpact } from "@/lib/governance/leadership-impact-types";

const number = new Intl.NumberFormat("pt-BR");

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  return d ? `${d}/${m}/${y}` : value;
}

const period = (from: string, to: string) => (from === to ? formatDate(from) : `${formatDate(from)} a ${formatDate(to)}`);

const CONTEXT_LABEL: Record<string, string> = { saida: "Saída", retorno: "Retorno" };

export interface ImpactPreviewProps {
  impact: LeadershipImpact;
  reason: string;
  onReasonChange: (value: string) => void;
  confirmed: boolean;
  onConfirmedChange: (value: boolean) => void;
  /** Mensagem quando a pessoa tentou confirmar sem motivo. */
  reasonError?: string | null;
}

/** "e mais 30" quando a amostra é menor que o total. */
function More({ count, shown }: { count: number; shown: number }) {
  if (count <= shown) return null;
  return <li className="text-caption text-fg-muted">e mais {number.format(count - shown)}</li>;
}

function Section({
  id,
  icon,
  title,
  count,
  children,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-1.5">
      <h4 id={id} className="flex items-center gap-1.5 text-body-sm font-semibold text-fg">
        <span aria-hidden className="text-fg-muted [&>svg]:size-4">{icon}</span>
        {title}
        <span className="font-normal text-fg-muted">· {number.format(count)}</span>
      </h4>
      {count === 0 ? <p className="text-body-sm text-fg-muted">Nenhum no período.</p> : children}
    </section>
  );
}

/**
 * Prévia do impacto de uma correção histórica de liderança (Etapa 13 §14).
 *
 * Os números vêm de `leadership_change_impact`, que resolve a liderança de
 * cada BR dia a dia antes e depois da alteração. A prévia não grava nada, e a
 * correção não regrava checklists nem obrigações — isso é dito aqui, com todas
 * as letras, porque é a primeira pergunta de quem vai confirmar.
 */
export function ImpactPreview({
  impact,
  reason,
  onReasonChange,
  confirmed,
  onConfirmedChange,
  reasonError,
}: ImpactPreviewProps) {
  const periods = impact.periods.map((p) => period(p.from, p.to)).join("; ");

  return (
    <section
      aria-labelledby="leadership-impact-title"
      className="flex flex-col gap-4 rounded-md border border-border bg-surface p-3"
      data-testid="leadership-impact"
    >
      <Alert variant="warning" icon={<History />}>
        <AlertTitle id="leadership-impact-title">Correção histórica</AlertTitle>
        <AlertDescription>
          A alteração muda a liderança de dias que já passaram: {periods} ({number.format(impact.pastDays)}{" "}
          {impact.pastDays === 1 ? "dia" : "dias"}). Confira o impacto, informe o motivo e confirme.
        </AlertDescription>
      </Alert>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Impacto da alteração">
        {[
          { label: "BRs afetadas", value: impact.brs.count },
          { label: "Veículos", value: impact.vehicles.count },
          { label: "Motoristas", value: impact.drivers.count },
          { label: "Checklists", value: impact.checklists.count },
          { label: "Obrigações", value: impact.obligations.count },
          { label: "Dias com mudança", value: impact.changedDays },
        ].map((item) => (
          <div key={item.label} className="min-w-0 rounded-md border border-border bg-surface-secondary px-3 py-2">
            <dt className="truncate text-caption text-fg-muted">{item.label}</dt>
            <dd className="text-h3 font-semibold tabular-nums text-fg">{number.format(item.value)}</dd>
          </div>
        ))}
      </dl>

      {impact.brs.count === 0 ? (
        <p className="text-body-sm text-fg-secondary">
          Nenhuma BR muda de liderança nesses dias: a responsabilidade não é principal, ou outra regra mais
          específica (exceção do BR, cidade) já respondia por elas.
        </p>
      ) : null}

      <Section id="impact-brs" icon={<MapPin />} title="BRs cuja liderança muda" count={impact.brs.count}>
        <ul className="flex flex-col gap-1">
          {impact.brs.sample.map((br) => (
            <li key={br.id} className="min-w-0 text-body-sm">
              <span className="font-medium text-fg">{br.code}</span>
              <span className="text-fg-muted">
                {" "}· {[br.cityName && br.stateUf ? `${br.cityName}/${br.stateUf}` : br.cityName, br.operationName].filter(Boolean).join(" · ")}
              </span>
              <span className="block text-caption text-fg-secondary">
                {period(br.firstDay, br.lastDay)} ({number.format(br.days)} {br.days === 1 ? "dia" : "dias"}):{" "}
                {br.leadersBefore.join(", ") || "sem liderança"} → {br.leadersAfter.join(", ") || "sem liderança"}
              </span>
            </li>
          ))}
          <More count={impact.brs.count} shown={impact.brs.sample.length} />
        </ul>
      </Section>

      <Section id="impact-vehicles" icon={<Truck />} title="Veículos fidelizados nessas BRs" count={impact.vehicles.count}>
        <ul className="flex flex-col gap-1">
          {impact.vehicles.sample.map((v) => (
            <li key={v.id} className="text-body-sm text-fg">
              {v.licensePlate ?? v.fleetCode ?? "Sem identificação"}
              {v.fleetCode && v.licensePlate ? <span className="text-fg-muted"> · frota {v.fleetCode}</span> : null}
              <span className="block text-caption text-fg-secondary">
                {v.brCode ?? "—"} · {period(v.from, v.to)}
              </span>
            </li>
          ))}
          <More count={impact.vehicles.count} shown={impact.vehicles.sample.length} />
        </ul>
      </Section>

      <Section id="impact-drivers" icon={<UserRound />} title="Motoristas fidelizados nessas BRs" count={impact.drivers.count}>
        <ul className="flex flex-col gap-1">
          {impact.drivers.sample.map((d) => (
            <li key={d.id} className="text-body-sm text-fg">
              {d.name}
              {d.employeeCode ? <span className="text-fg-muted"> · matrícula {d.employeeCode}</span> : null}
              <span className="block text-caption text-fg-secondary">
                {d.brCode ?? "—"} · {period(d.from, d.to)}
              </span>
            </li>
          ))}
          <More count={impact.drivers.count} shown={impact.drivers.sample.length} />
        </ul>
      </Section>

      <Section id="impact-checklists" icon={<ClipboardCheck />} title="Checklists executados no período" count={impact.checklists.count}>
        <ul className="flex flex-col gap-1">
          {impact.checklists.sample.map((c) => (
            <li key={c.id} className="text-body-sm text-fg">
              {formatDate(c.date)} · {CONTEXT_LABEL[c.context ?? ""] ?? c.context ?? "—"} ·{" "}
              {c.licensePlate ?? c.fleetCode ?? "—"}
              <span className="block text-caption text-fg-secondary">
                {c.brCode ?? "Sem BR"} · liderança registrada: {c.leaderName ?? "nenhuma"}
              </span>
            </li>
          ))}
          <More count={impact.checklists.count} shown={impact.checklists.sample.length} />
        </ul>
      </Section>

      <Section id="impact-obligations" icon={<ListChecks />} title="Obrigações da Aderência no período" count={impact.obligations.count}>
        <ul className="flex flex-col gap-1">
          {impact.obligations.sample.map((o) => (
            <li key={o.id} className="text-body-sm text-fg">
              {formatDate(o.date)} · {CONTEXT_LABEL[o.context ?? ""] ?? o.context ?? "—"} ·{" "}
              {o.licensePlate ?? o.fleetCode ?? "—"}
              <span className="block text-caption text-fg-secondary">
                {o.brCode ?? "Sem BR"} · liderança registrada: {o.leaderName ?? "nenhuma"}
                {o.open ? " · sem checklist nem decisão" : ""}
              </span>
            </li>
          ))}
          <More count={impact.obligations.count} shown={impact.obligations.sample.length} />
        </ul>
      </Section>

      {/* §14: "não alterar automaticamente o contexto histórico de checklists e
          indicadores já consolidados" — dito antes da confirmação, não depois. */}
      <Alert variant="info">
        <AlertTitle>O contexto histórico não é reescrito</AlertTitle>
        <AlertDescription>
          Checklists executados e obrigações da Aderência guardam a liderança registrada quando foram gerados, e
          esta correção não os altera. Ela vale para as consultas de liderança feitas a partir de agora e fica na
          auditoria com o motivo e o seu usuário.
          {impact.recentPendingObligations > 0
            ? ` ${number.format(impact.recentPendingObligations)} obrigação(ões) de ontem ainda sem checklist nem decisão podem ser realinhadas pela rotina automática da Aderência.`
            : ""}
        </AlertDescription>
      </Alert>

      <FormField
        label="Motivo da correção"
        required
        id="leadership-change-reason"
        error={reasonError ?? undefined}
        helperText="Fica registrado na auditoria junto com o antes e o depois."
      >
        <Textarea
          id="leadership-change-reason"
          rows={3}
          maxLength={500}
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
        />
      </FormField>

      <CheckboxField
        id="leadership-impact-confirm"
        label="Revisei o impacto e confirmo a correção histórica."
        checked={confirmed}
        onCheckedChange={(value) => onConfirmedChange(value === true)}
      />
    </section>
  );
}
