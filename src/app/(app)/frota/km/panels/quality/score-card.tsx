"use client";

import * as React from "react";
import { Gauge } from "lucide-react";
import type { KmQualityComponents } from "@/lib/km/quality";
import { fmt1, fmtInt, fmtPct } from "@/lib/km/types";

/**
 * Score de qualidade dos dados (0–100), com os critérios escritos na tela e
 * os números de cada componente. O score e os percentuais vêm prontos da
 * rotina (`km_quality`); aqui só se mostra.
 */
function Bar({ value }: { value: number | null }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <span aria-hidden className="block h-1.5 w-full overflow-hidden rounded-xs bg-surface-tertiary">
      <span className="block h-full rounded-xs bg-primary" style={{ width: `${pct}%` }} />
    </span>
  );
}

function Component({
  name, weight, value, detail, testId,
}: {
  name: string;
  weight: string;
  value: number | null;
  detail: React.ReactNode;
  testId: string;
}) {
  return (
    <li className="flex min-w-0 flex-col gap-1.5" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-body-sm font-medium text-fg">
          {name} <span className="text-caption font-normal text-fg-muted">· peso {weight}</span>
        </span>
        <span className="text-body font-semibold text-fg tabular-nums">{fmtPct(value)}</span>
      </div>
      <Bar value={value} />
      <span className="text-caption text-fg-muted">{detail}</span>
    </li>
  );
}

export function QualityScoreCard({
  score, components,
}: {
  score: number | null | undefined;
  components: KmQualityComponents | null | undefined;
}) {
  const c = components;
  return (
    <section
      aria-labelledby="km-qualidade-score"
      className="grid gap-5 rounded-lg border border-border bg-surface-raised p-4 shadow-card lg:grid-cols-[minmax(12rem,16rem)_minmax(0,1fr)]"
      data-testid="km-qualidade-score"
    >
      <div className="flex flex-col gap-2">
        <h3 id="km-qualidade-score" className="flex items-center gap-2 text-label font-semibold text-fg-secondary">
          <Gauge className="size-4 text-fg-muted" aria-hidden />
          Qualidade dos dados (DQ)
        </h3>
        <p className="flex items-baseline gap-1">
          <span className="text-kpi font-semibold text-fg tabular-nums" data-testid="km-qualidade-score-valor">
            {fmt1(score ?? null)}
          </span>
          <span className="text-body-sm text-fg-muted">de 100</span>
        </p>
        <Bar value={score ?? null} />
        <p className="text-caption text-fg-muted">
          Score = 50 × cobertura + 30 × consistência + 20 × atualização (cada componente de 0 a 1). Calculado sobre o período e
          os filtros da tela.
        </p>
      </div>
      <ul className="grid gap-4 md:grid-cols-3">
        <Component
          name="Cobertura"
          weight="50%"
          value={c?.coveragePct ?? null}
          testId="km-qualidade-componente-cobertura"
          detail={
            <>
              {fmtInt(c?.withReading ?? null)} de {fmtInt(c?.elapsedVehicleDays ?? null)} dias-veículo decorridos com leitura
              confiável.
            </>
          }
        />
        <Component
          name="Consistência"
          weight="30%"
          value={c?.consistencyPct ?? null}
          testId="km-qualidade-componente-consistencia"
          detail={
            <>
              1 − {fmtInt(c?.problems ?? null)} leitura(s) com problema ÷ {fmtInt(c?.readings ?? null)} leitura(s). Problema =
              inconsistente, divergência de KM, pendente de análise ou hodômetro regressivo.
            </>
          }
        />
        <Component
          name="Atualização"
          weight="20%"
          value={c?.freshnessPct ?? null}
          testId="km-qualidade-componente-atualizacao"
          detail={
            <>
              {fmtInt(c?.updatedVehicles ?? null)} de {fmtInt(c?.activeVehicles ?? null)} frota(s) ativa(s) com leitura até
              ontem.
            </>
          }
        />
      </ul>
    </section>
  );
}
