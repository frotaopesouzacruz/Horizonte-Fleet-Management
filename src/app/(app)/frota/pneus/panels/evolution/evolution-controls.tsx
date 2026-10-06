"use client";

import * as React from "react";
import { CalendarClock, Lock } from "lucide-react";
import { NativeSelect } from "@/components/governance/selects";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { KPI_DIMENSION_LABEL, type KpiDimension, type KpiPeriod, type TiresKpiHistory } from "@/lib/tires/types";
import type { TiresPanelContext } from "../../shared";
import { FieldLabel } from "./evolution-ui";
import { IMMUTABLE_RULE, MONTHLY_RULE, nextCaptureSentence } from "./evolution-utils";

/**
 * Barra de controles da Evolução: período, indicador, dimensão e item da
 * dimensão — tudo na URL (`periodo`, `indicador`, `dimensao`, `membro`), que o
 * carregador lê. Trocar a dimensão limpa o item. Com acesso restrito por
 * operação o banco só aceita Geral (soma das próprias operações) e Operação.
 */
const DIMENSIONS: KpiDimension[] = ["geral", "operation", "city", "leader", "vehicle_type", "dimension"];
const SCOPED_DIMENSIONS: KpiDimension[] = ["geral", "operation"];

const PERIOD_OPTIONS = [
  { value: "semana", label: "Semana", title: "Semana × semana: cada captura semanal", "data-testid": "tires-evolution-period-semana" },
  { value: "mes", label: "Mês", title: "Mês × mês: a última captura semanal de cada mês", "data-testid": "tires-evolution-period-mes" },
] as const;

export function EvolutionControls({ data, ctx }: { data: TiresKpiHistory; ctx: TiresPanelContext }) {
  const uid = React.useId();
  const dims = data.scoped ? SCOPED_DIMENSIONS : DIMENSIONS;
  const pct = data.catalog.filter((c) => c.kind === "pct");
  const qty = data.catalog.filter((c) => c.kind === "qty");
  const members = [...data.members].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  const unknownMember = data.dimensionId && !members.some((m) => m.id === data.dimensionId) ? data.dimensionId : null;
  const showMember = data.dimension !== "geral";

  return (
    <div
      role="group"
      aria-label="Recorte da evolução dos indicadores"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-3 sm:p-4"
      data-testid="tires-evolution-controls"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end">
        <div className="flex min-w-0 flex-col gap-1.5">
          <FieldLabel>Período</FieldLabel>
          <SegmentedControl<KpiPeriod>
            aria-label="Período"
            value={data.period}
            onValueChange={(v) => ctx.navigate({ periodo: v })}
            options={PERIOD_OPTIONS}
            disabled={ctx.pending}
            data-testid="tires-evolution-period"
          />
        </div>

        <div className="flex min-w-0 flex-col gap-1.5 lg:w-80">
          <FieldLabel htmlFor={`${uid}-indicator`}>Indicador</FieldLabel>
          <NativeSelect
            id={`${uid}-indicator`}
            value={data.indicator}
            onChange={(e) => ctx.navigate({ indicador: e.target.value })}
            disabled={ctx.pending}
            data-testid="tires-evolution-indicator"
          >
            {pct.length ? (
              <optgroup label="Percentuais">
                {pct.map((c) => (
                  <option key={c.indicator} value={c.indicator}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {qty.length ? (
              <optgroup label="Quantidades">
                {qty.map((c) => (
                  <option key={c.indicator} value={c.indicator}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {data.catalog.some((c) => c.indicator === data.indicator) ? null : <option value={data.indicator}>{data.label}</option>}
          </NativeSelect>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5 lg:w-60">
          <FieldLabel htmlFor={`${uid}-dimension`}>Dimensão</FieldLabel>
          <NativeSelect
            id={`${uid}-dimension`}
            value={data.dimension}
            onChange={(e) => ctx.navigate({ dimensao: e.target.value, membro: null })}
            disabled={ctx.pending}
            data-testid="tires-evolution-dimension"
          >
            {dims.map((d) => (
              <option key={d} value={d}>
                {KPI_DIMENSION_LABEL[d]}
              </option>
            ))}
          </NativeSelect>
        </div>

        {showMember ? (
          <div className="flex min-w-0 flex-col gap-1.5 lg:w-72">
            <FieldLabel htmlFor={`${uid}-member`}>{KPI_DIMENSION_LABEL[data.dimension]}</FieldLabel>
            <NativeSelect
              id={`${uid}-member`}
              value={data.dimensionId ?? ""}
              onChange={(e) => ctx.navigate({ membro: e.target.value || null })}
              disabled={ctx.pending}
              data-testid="tires-evolution-member"
            >
              <option value="">Todos (ranking)</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
              {unknownMember ? <option value={unknownMember}>Item selecionado (sem captura recente)</option> : null}
            </NativeSelect>
          </div>
        ) : null}
      </div>

      {data.scoped ? (
        <p className="flex items-start gap-1.5 text-caption text-fg-muted" data-testid="tires-evolution-scoped">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            Seu acesso é restrito por operação: “Geral” é a soma das suas operações. As visões por local, liderança, tipo de equipamento e perfil
            exigem acesso a todas as operações.
          </span>
        </p>
      ) : null}

      <div className="flex flex-col gap-1 border-t border-border-subtle pt-3 text-caption text-fg-muted" data-testid="tires-evolution-schedule">
        <p className="flex items-start gap-1.5">
          <CalendarClock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{nextCaptureSentence(data.schedule)}</span>
        </p>
        <p className="pl-5">
          {IMMUTABLE_RULE} {MONTHLY_RULE}
        </p>
      </div>
    </div>
  );
}
