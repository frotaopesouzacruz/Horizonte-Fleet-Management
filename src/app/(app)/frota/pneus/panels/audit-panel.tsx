"use client";

import { AlertTriangle, Database, Percent, ScanSearch, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { MetricStrip } from "@/components/ui/kpi-card";
import type { TiresTabData } from "@/lib/tires/loaders";
import { fmtInt, fmtPct, plural, type TiresAuditCenter } from "@/lib/tires/types";
import type { TiresPanelContext } from "../shared";
import { PanelEmpty, PanelError, TiresKpi, useTiresLink } from "./tires-ui";
import { AUDIT_CATEGORIES, categoryLabel, TID } from "./audit/audit-common";
import { AuditFindings } from "./audit/audit-findings";
import { AuditGroups } from "./audit/audit-groups";
import { AuditHeader } from "./audit/audit-header";

/**
 * Gestão de Pneus → Auditoria dos dados (Central de Auditoria).
 *
 * As regras da auditoria rodam no banco a cada confirmação dos dados, na
 * agenda diária e sob demanda (`tire_data_findings`); cada achado tem regra,
 * categoria, gravidade, onde está, o valor encontrado × o esperado e o
 * histórico (primeira/última detecção, ocorrências, reaberturas). A tela
 * identifica, classifica, localiza, prioriza e acompanha — não corrige: a
 * correção é feita na origem e a próxima varredura resolve o achado.
 *
 * URL: `categoria`, `regra`, `gravidade`, `achado` (aberta|resolvida|todas),
 * `agrupar` e `pagina`, mais os filtros globais de operação, local,
 * liderança, frota e busca.
 */
export function AuditPanel({ data, ctx }: { data: TiresTabData["qualidade"] | null; ctx: TiresPanelContext }) {
  if (ctx.error) return <PanelError ctx={ctx} title="Não foi possível carregar a auditoria dos dados de pneus." testId={`${TID}-error`} />;
  if (!data) {
    return (
      <PanelEmpty
        icon={<ScanSearch />}
        title="Sem dados da auditoria"
        description="A leitura da Central de Auditoria não trouxe resultado. Recarregue a página."
        testId={`${TID}-empty`}
      />
    );
  }
  return (
    <div className="flex flex-col gap-6" data-testid={TID}>
      <AuditHeader data={data} ctx={ctx} />
      <AuditIndicators data={data} />
      <CategoryStrip data={data} ctx={ctx} />
      <AuditGroups data={data} ctx={ctx} />
      <AuditFindings data={data} ctx={ctx} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Indicadores (achados abertos, com os filtros globais)
// ---------------------------------------------------------------------------
function AuditIndicators({ data }: { data: TiresAuditCenter }) {
  const k = data.kpis;
  const severe = k.critical + k.high;
  return (
    <section aria-labelledby={`${TID}-kpis-title`} className="flex flex-col gap-3" data-testid={`${TID}-kpis`}>
      <div className="flex flex-col gap-0.5">
        <h2 id={`${TID}-kpis-title`} className="text-h4 font-semibold text-fg">Situação atual da auditoria</h2>
        <p className="text-caption text-fg-muted">
          Achados abertos com os filtros globais da tela. Categoria, regra, gravidade e situação filtram só a lista de achados.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div data-testid={`${TID}-kpi-open`}>
          <TiresKpi
            kpi="audit-open"
            label="Inconsistências abertas"
            value={fmtInt(k.open)}
            icon={<AlertTriangle />}
            status={k.open > 0 ? "warning" : "success"}
            period={k.open > 0 ? `${fmtInt(k.new7d)} ${plural(k.new7d, "nova", "novas")} nos últimos 7 dias` : "nenhum achado aberto"}
          />
        </div>
        <div data-testid={`${TID}-kpi-records`}>
          <TiresKpi
            kpi="audit-records"
            label="Registros afetados"
            value={fmtInt(k.records)}
            icon={<Database />}
            period={`${fmtInt(k.tiresAffected)} ${plural(k.tiresAffected, "pneu", "pneus")} · ${fmtInt(k.vehiclesAffected)} ${plural(k.vehiclesAffected, "frota", "frotas")}`}
          />
        </div>
        <div data-testid={`${TID}-kpi-pct`}>
          <TiresKpi
            kpi="audit-pct"
            label="% da base com inconsistência"
            value={fmtPct(k.pctBase)}
            icon={<Percent />}
            status={k.pctBase == null ? undefined : k.pctBase > 0 ? "warning" : "success"}
            period={
              data.totalTires > 0
                ? `${fmtInt(k.tiresAffected)} de ${fmtInt(data.totalTires)} pneus nos dados atuais`
                : "sem pneus nos dados atuais"
            }
          />
        </div>
        <div data-testid={`${TID}-kpi-severe`}>
          <TiresKpi
            kpi="audit-severe"
            label="Críticas e altas"
            value={fmtInt(severe)}
            icon={<ShieldAlert />}
            status={k.critical > 0 ? "danger" : k.high > 0 ? "warning" : "success"}
            period={`${fmtInt(k.critical)} ${plural(k.critical, "crítica", "críticas")} · ${fmtInt(k.high)} ${plural(k.high, "alta", "altas")}`}
          />
        </div>
      </div>
      <MetricStrip
        ariaLabel="Acompanhamento da correção"
        className="md:grid-cols-3"
        items={[
          { key: "new", label: "Novas em 7 dias", value: fmtInt(k.new7d), hint: "abertas pela primeira vez na última semana" },
          { key: "resolved", label: "Resolvidas em 30 dias", value: fmtInt(k.resolved30d), hint: "corrigidas na origem e confirmadas pela varredura" },
          { key: "reopened", label: "Reabertas", value: fmtInt(k.reopened), hint: "voltaram depois de resolvidas" },
        ]}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Faixa de categorias (aplica `?categoria=`)
// ---------------------------------------------------------------------------
function CategoryStrip({ data, ctx }: { data: TiresAuditCenter; ctx: TiresPanelContext }) {
  const link = useTiresLink(ctx);
  const active = data.filters.category;
  return (
    <nav aria-label="Inconsistências abertas por categoria" data-testid={`${TID}-categories`}>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
        {AUDIT_CATEGORIES.map((c) => {
          const count = data.kpis.byCategory[c] ?? 0;
          const on = active === c;
          const nav = link({ categoria: on ? null : c });
          return (
            <li key={c} className="min-w-0">
              <a
                href={nav.href}
                onClick={nav.onClick}
                aria-current={on ? "true" : undefined}
                className={cn(
                  "flex h-full min-w-0 items-center justify-between gap-2 rounded-md border px-3 py-2 hfm-transition hfm-focus-ring",
                  on
                    ? "border-primary/50 bg-selected-overlay shadow-[inset_3px_0_0_var(--primary)]"
                    : "border-border bg-surface-raised hover:border-border-strong hover:bg-surface-hover",
                )}
                data-testid={`${TID}-category`}
                data-category={c}
              >
                <span className={cn("min-w-0 truncate text-body-sm", on ? "font-semibold text-fg" : "text-fg-secondary")}>{categoryLabel(c)}</span>
                <span className={cn("shrink-0 text-body-sm tabular-nums", count > 0 ? "font-semibold text-fg" : "text-fg-muted")}>
                  {fmtInt(count)}
                  <span className="sr-only">
                    {" "}
                    {plural(count, "achado aberto", "achados abertos")}
                    {on ? " — filtro aplicado; clique para limpar" : ""}
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
