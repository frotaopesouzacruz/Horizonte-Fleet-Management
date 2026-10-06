"use client";

import * as React from "react";
import { CalendarX, Gauge, GaugeCircle, Ruler, Settings2 } from "lucide-react";
import {
  DEADLINE_ORDER, DEADLINE_SHORT, DEADLINE_TONE, fmtInt, fmtMm, fmtPct, plural, PSI_LABEL, PSI_ORDER, PSI_TONE,
  TREAD_LABEL, TREAD_ORDER, TREAD_TONE, type TireDistItem, type TireOverviewV2, type TireOverviewV2Kpis, type TiresTone,
} from "@/lib/tires/types";
import type { TiresPanelContext } from "../../shared";
import { chartColorOf, Section, TiresKpi } from "../tires-ui";
import { BarList, type BarRow } from "./bar-list";
import { isFilterActive, shareOf, type CrossField, type Nav } from "./shared";

/**
 * Saúde e Prazos dos pneus em uso: primeiro o que pede ação (cartões), depois
 * as distribuições que explicam os números. Classes, prazos e PSI chegam
 * prontos do banco; a tela só conta a participação de cada fatia.
 */
export function HealthSection({
  overview, kpis: k, ctx, to, onFilter,
}: {
  overview: TireOverviewV2;
  kpis: TireOverviewV2Kpis;
  ctx: TiresPanelContext;
  to: Nav;
  onFilter: (field: CrossField, key: string) => void;
}) {
  const p = overview.parameters;
  const psiOut = k.psiLow + k.psiHigh;
  const inUse = (patch: Record<string, string | null>) => to("base", { visao: "fogo", situacao: "em_uso", ...patch });
  const headingId = React.useId();

  const due = (soon: number, missing: number, unit: [string, string]) =>
    [
      `${fmtInt(soon)} ${plural(soon, unit[0], unit[1])} do vencimento`,
      missing > 0 ? `${fmtInt(missing)} sem registro` : null,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <Section
      title="Saúde e Prazos"
      testId="tires-health-section"
      description="Pneus em uso: sulco, prazos de medição e de calibragem e pressão (PSI)."
    >
      <div className="flex flex-col gap-2" role="group" aria-labelledby={headingId}>
        <h3 id={headingId} className="text-body-sm font-semibold text-fg-secondary">Prazos e pressão dos pneus em uso</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <TiresKpi
            kpi="sulco-critico"
            label="Sulco crítico"
            value={fmtInt(k.critical)}
            icon={<Ruler />}
            status={k.critical > 0 ? "danger" : undefined}
            period={[
              p ? `até ${fmtMm(p.treadCriticalMm)}` : null,
              `${fmtInt(k.belowLegal)} abaixo do legal`,
            ]
              .filter(Boolean)
              .join(" · ")}
            nav={inUse({ sulco: "abaixo_legal,critico" })}
            destination="Abrir a Base geral com os pneus de sulco crítico ou abaixo do legal"
          />
          <TiresKpi
            kpi="medicao-vencida"
            label="Medição vencida"
            value={fmtInt(k.measurementOverdue)}
            icon={<CalendarX />}
            status={k.measurementOverdue > 0 ? "warning" : undefined}
            period={due(k.measurementDueSoon, k.measurementMissing, ["próxima", "próximas"])}
            nav={to("medicao", { sub: "prazo", pendencia: "vencido" })}
            destination="Abrir a Aderência MM com as medições vencidas"
          />
          <TiresKpi
            kpi="calibragem-vencida"
            label="Calibragem vencida"
            value={fmtInt(k.calibrationOverdue)}
            icon={<CalendarX />}
            status={k.calibrationOverdue > 0 ? "warning" : undefined}
            period={due(k.calibrationDueSoon, k.calibrationMissing, ["próxima", "próximas"])}
            nav={to("calibragem", { sub: "prazo", pendencia: "vencido" })}
            destination="Abrir a Aderência de calibragem com as calibragens vencidas"
          />
          <TiresKpi
            kpi="psi-fora"
            label="PSI fora da faixa"
            value={fmtInt(psiOut)}
            icon={<Gauge />}
            status={psiOut > 0 ? "warning" : undefined}
            period={`${fmtInt(k.psiLow)} abaixo do mínimo · ${fmtInt(k.psiHigh)} acima do máximo`}
            nav={inUse({ pressao: "baixa,excesso" })}
            destination="Abrir a Base geral com os pneus de PSI abaixo do mínimo ou acima do máximo"
          />
          <TiresKpi
            kpi="psi-sem-parametro"
            label="Sem parâmetro de PSI"
            value={fmtInt(k.psiNoRule)}
            icon={<Settings2 />}
            status={k.psiNoRule > 0 ? "info" : undefined}
            period={
              k.psiRuleGaps > 0
                ? `${fmtInt(k.psiRuleGaps)} ${plural(k.psiRuleGaps, "combinação", "combinações")} sem regra`
                : "nunca contam como PSI adequado"
            }
            nav={to("calibragem", { sub: "psi", pendencia: "sem_parametro" })}
            destination="Abrir a Aderência de calibragem com os pneus sem parâmetro de PSI"
          />
        </div>
      </div>

      <HealthCharts overview={overview} base={k.emUso} ctx={ctx} onFilter={onFilter} />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Distribuições (classe do sulco, prazos e PSI)
// ---------------------------------------------------------------------------
interface HealthBlock {
  key: string;
  title: string;
  hint: string;
  field: CrossField;
  order: readonly string[];
  labelOf: (key: string) => string;
  toneOf: (key: string) => TiresTone;
  list: TireDistItem[];
  icon: React.ReactNode;
}

function HealthCharts({
  overview, base, ctx, onFilter,
}: {
  overview: TireOverviewV2;
  base: number;
  ctx: TiresPanelContext;
  onFilter: (field: CrossField, key: string) => void;
}) {
  const h = overview.health;
  if (!h) return null;
  const blocks: HealthBlock[] = [
    {
      key: "tread", title: "Classe do sulco", hint: "pelo menor sulco do pneu", field: "tread", order: TREAD_ORDER,
      labelOf: (c) => TREAD_LABEL[c as keyof typeof TREAD_LABEL] ?? c, toneOf: (c) => TREAD_TONE[c as keyof typeof TREAD_TONE] ?? "neutral",
      list: h.treadClass, icon: <Ruler />,
    },
    {
      key: "measurement", title: "Prazo de medição", hint: "desde a última medição de sulco", field: "measurement", order: DEADLINE_ORDER,
      labelOf: (c) => DEADLINE_SHORT[c as keyof typeof DEADLINE_SHORT] ?? c, toneOf: (c) => DEADLINE_TONE[c as keyof typeof DEADLINE_TONE] ?? "neutral",
      list: h.measurementStatus, icon: <CalendarX />,
    },
    {
      key: "calibration", title: "Prazo de calibragem", hint: "desde a última calibragem", field: "calibration", order: DEADLINE_ORDER,
      labelOf: (c) => DEADLINE_SHORT[c as keyof typeof DEADLINE_SHORT] ?? c, toneOf: (c) => DEADLINE_TONE[c as keyof typeof DEADLINE_TONE] ?? "neutral",
      list: h.calibrationStatus, icon: <CalendarX />,
    },
    {
      key: "psi", title: "Pressão (PSI)", hint: "pela faixa da regra de PSI", field: "psi", order: PSI_ORDER,
      labelOf: (c) => PSI_LABEL[c as keyof typeof PSI_LABEL] ?? c, toneOf: (c) => PSI_TONE[c as keyof typeof PSI_TONE] ?? "neutral",
      list: h.psiStatus, icon: <GaugeCircle />,
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      <p className="text-caption text-fg-muted">
        Distribuição dos {fmtInt(base)} {plural(base, "pneu em uso", "pneus em uso")}. Clique numa barra para filtrar a tela.
      </p>
      <div className="overflow-hidden rounded-lg border border-border bg-surface-raised shadow-card" data-testid="tires-health-charts">
        {/* Divisórias como sombras internas e a grade deslocada 1px (como a MetricStrip): sem "buracos" na última linha. */}
        <div className="-mt-px -ml-px grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-4">
          {blocks.map((b) => (
            <HealthBlockView key={b.key} block={b} base={base} ctx={ctx} onFilter={onFilter} />
          ))}
        </div>
      </div>
    </div>
  );
}

function HealthBlockView({
  block: b, base, ctx, onFilter,
}: {
  block: HealthBlock;
  base: number;
  ctx: TiresPanelContext;
  onFilter: (field: CrossField, key: string) => void;
}) {
  const headingId = React.useId();
  const counts = new Map(b.list.map((i) => [i.key, i.count]));
  // vocabulário completo, na ordem de gravidade; códigos novos do banco entram no fim
  const keys = [...b.order, ...b.list.map((i) => i.key).filter((key) => !b.order.includes(key))];
  const rows: BarRow[] = keys.map((key) => {
    const count = counts.get(key) ?? 0;
    const active = isFilterActive(ctx.filters, b.field, key);
    return {
      key,
      label: b.labelOf(key),
      value: count,
      color: chartColorOf(b.toneOf(key)),
      detail: count > 0 ? `· ${fmtPct(shareOf(count, base))}` : undefined,
      active,
      onSelect: count > 0 || active ? () => onFilter(b.field, key) : undefined,
    };
  });
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-1.5 px-3 py-3 shadow-[inset_1px_0_0_var(--border-subtle),inset_0_1px_0_var(--border-subtle)]"
      data-testid={`tires-health-${b.key}`}
    >
      <header className="flex items-center gap-2 px-2">
        <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-interactive text-fg-secondary [&_svg]:size-3.5">
          {b.icon}
        </span>
        <div className="flex min-w-0 flex-col">
          <h4 id={headingId} className="text-body-sm font-semibold text-fg">{b.title}</h4>
          <p className="text-caption text-fg-muted">{b.hint}</p>
        </div>
      </header>
      <BarList rows={rows} ariaLabel={`${b.title} dos pneus em uso`} density="compact" limit={8} disabled={ctx.pending} testId={`tires-health-${b.key}-bars`} />
    </section>
  );
}
