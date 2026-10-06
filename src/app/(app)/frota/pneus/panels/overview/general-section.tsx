"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, CircleSlash, Disc3, LogOut, PackageCheck, Recycle, Truck, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ChartCard, ChartLegend } from "@/components/charts";
import {
  fmtInt, fmtPct, plural, STATUS_LABEL, type CanonicalStatus, type TireOverviewV2, type TireOverviewV2Kpis, type TireProfileItem,
  type TireWhereItem,
} from "@/lib/tires/types";
import type { TiresPanelContext } from "../../shared";
import { Section, TiresKpi, useViewParam } from "../tires-ui";
import { BarList, type BarRow } from "./bar-list";
import { canFilter, isFilterActive, NONE_KEY, shareOf, type CrossField, type Nav } from "./shared";
import { useSessionFlag } from "./use-session-flag";

/**
 * Dados Gerais dos Pneus: quantos são e onde estão, de todos os pneus dos
 * dados exibidos — recolhível (preferência guardada na sessão). Os gráficos
 * filtram a tela inteira com um clique.
 */
const SESSION_KEY = "hfm.tires.overview.general";

type ProfileDim = "brand" | "model" | "dimension" | "life" | "status";
const PROFILE_PARAM: Record<ProfileDim, string> = {
  brand: "fabricante", model: "modelo", dimension: "medida", life: "vida", status: "situacao",
};
const PROFILE_OPTIONS: { value: ProfileDim; label: string }[] = [
  { value: "brand", label: "Fabricante" },
  { value: "model", label: "Modelo" },
  { value: "dimension", label: "Medida" },
  { value: "life", label: "Vida" },
  { value: "status", label: "Situação" },
];
const PROFILE_NONE: Record<ProfileDim, string> = {
  brand: "Sem fabricante", model: "Sem modelo", dimension: "Sem medida", life: "Sem vida informada", status: "Sem situação",
};

type WhereDim = "operation" | "city" | "leader" | "vehicleType";
const WHERE_PARAM: Record<WhereDim, string> = { operation: "operacao", city: "local", leader: "lideranca", vehicleType: "tipo" };
const WHERE_OPTIONS: { value: WhereDim; label: string }[] = [
  { value: "operation", label: "Operação" },
  { value: "city", label: "Local de Operação" },
  { value: "leader", label: "Liderança" },
  { value: "vehicleType", label: "Tipo de equipamento" },
];

const fromParam = <T extends string>(map: Record<T, string>, raw: string | null, fallback: T): T =>
  (Object.keys(map) as T[]).find((k) => map[k] === raw) ?? fallback;

export function GeneralSection({
  overview, kpis: k, ctx, to, onFilter,
}: {
  overview: TireOverviewV2;
  kpis: TireOverviewV2Kpis;
  ctx: TiresPanelContext;
  to: Nav;
  onFilter: (field: CrossField, key: string) => void;
}) {
  const [open, setOpen] = useSessionFlag(SESSION_KEY, true);
  const bodyId = React.useId();
  const discarded = k.descartado + k.baixado;

  const summary = `${fmtInt(k.total)} ${plural(k.total, "pneu", "pneus")} · ${fmtInt(k.emUso)} em uso · ${fmtInt(k.estoque)} em estoque · ${fmtInt(k.foraDaFrota)} fora da frota`;

  return (
    <Section
      title="Dados Gerais dos Pneus"
      testId="tires-general-section"
      description={open ? "Todos os pneus dos dados exibidos, pela situação na base oficial (Rodopar). Cada cartão abre a Base geral com o mesmo recorte." : summary}
      actions={
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-controls={bodyId}
          leadingIcon={open ? <ChevronUp /> : <ChevronDown />}
          onClick={() => setOpen(!open)}
          data-testid="tires-general-toggle"
        >
          {open ? "Recolher" : "Expandir"}
          <span className="sr-only"> os Dados Gerais dos Pneus</span>
        </Button>
      }
    >
      <div id={bodyId} hidden={!open} className={open ? "flex flex-col gap-4" : undefined} data-testid="tires-general-body">
        {open ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7">
              <TiresKpi
                kpi="total"
                label="Total de pneus"
                value={fmtInt(k.total)}
                icon={<Disc3 />}
                status="primary"
                period={`${fmtInt(k.fleets)} ${plural(k.fleets, "frota", "frotas")} com pneu em uso`}
                nav={to("base", { visao: "fogo" })}
                destination="Abrir a Base geral com todos os pneus"
              />
              <TiresKpi
                kpi="em-uso"
                label="Em uso"
                value={fmtInt(k.emUso)}
                icon={<Truck />}
                period={k.pctEmUso == null ? undefined : `${fmtPct(k.pctEmUso)} do total`}
                nav={to("base", { visao: "frota" })}
                destination="Abrir a Base geral por frota, com os pneus em uso"
              />
              <TiresKpi
                kpi="estoque"
                label="Estoque"
                value={fmtInt(k.estoque)}
                icon={<Warehouse />}
                period={k.pctEstoque == null ? undefined : `${fmtPct(k.pctEstoque)} do total`}
                nav={to("base", { visao: "fora", situacao: "estoque" })}
                destination="Abrir a Base geral fora da frota, em estoque"
              />
              <TiresKpi
                kpi="disponiveis"
                label="Disponíveis"
                value={fmtInt(k.disponiveis)}
                icon={<PackageCheck />}
                period="estoque apto: sulco adequado ou em atenção"
                nav={to("base", { visao: "fora", situacao: "estoque", sulco: "adequado,atencao" })}
                destination="Abrir a Base geral com o estoque de sulco adequado ou em atenção"
              />
              <TiresKpi
                kpi="manutencao"
                label="Em manutenção"
                value={fmtInt(k.emManutencao)}
                icon={<Recycle />}
                period="em ressolagem"
                nav={to("base", { visao: "fora", situacao: "ressolagem" })}
                destination="Abrir a Base geral fora da frota, em ressolagem"
              />
              <TiresKpi
                kpi="fora"
                label="Fora da frota"
                value={fmtInt(k.foraDaFrota)}
                icon={<LogOut />}
                period={k.outro > 0 ? `inclui ${fmtInt(k.outro)} em situação não reconhecida` : "todos os pneus que não estão em uso"}
                nav={to("base", { visao: "fora" })}
                destination="Abrir a Base geral com os pneus fora da frota"
              />
              <TiresKpi
                kpi="descartados"
                label="Descartados/baixados"
                value={fmtInt(discarded)}
                icon={<CircleSlash />}
                period={`${fmtInt(k.descartado)} ${plural(k.descartado, "descartado", "descartados")} · ${fmtInt(k.baixado)} ${plural(k.baixado, "baixado", "baixados")}`}
                nav={to("base", { visao: "fora", situacao: "descartado,baixado" })}
                destination="Abrir a Base geral com os pneus descartados e baixados"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ProfileChart overview={overview} total={k.total} ctx={ctx} onFilter={onFilter} />
              <WhereChart overview={overview} ctx={ctx} onFilter={onFilter} />
            </div>
          </>
        ) : null}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Perfil dos Pneus
// ---------------------------------------------------------------------------
function ProfileChart({
  overview, total, ctx, onFilter,
}: {
  overview: TireOverviewV2;
  total: number;
  ctx: TiresPanelContext;
  onFilter: (field: CrossField, key: string) => void;
}) {
  const [raw, setRaw] = useViewParam("perfil_por");
  const dim = fromParam<ProfileDim>(PROFILE_PARAM, raw, "brand");
  const list: TireProfileItem[] = overview.profile?.[dim] ?? [];
  const field: CrossField = dim;
  const labelOf = (i: TireProfileItem) => {
    if (i.key === NONE_KEY) return PROFILE_NONE[dim];
    if (dim === "status") return STATUS_LABEL[i.key as CanonicalStatus] ?? i.key;
    if (dim === "life") return `${i.key}ª vida`;
    return i.label ?? i.key;
  };
  const rows: BarRow[] = list.map((i) => {
    const filterable = canFilter(field, i.key);
    return {
      key: i.key,
      label: labelOf(i),
      value: i.count,
      color: "var(--chart-brand-primary)",
      detail: dim === "status" ? `· ${fmtPct(shareOf(i.count, total))}` : i.inUse != null ? `· ${fmtInt(i.inUse)} em uso` : undefined,
      active: filterable && isFilterActive(ctx.filters, field, i.key),
      onSelect: filterable ? () => onFilter(field, i.key) : undefined,
    };
  });
  const option = PROFILE_OPTIONS.find((o) => o.value === dim);
  return (
    <ChartCard
      title="Perfil dos Pneus"
      description={
        dim === "model"
          ? "Os 12 modelos mais frequentes, entre todos os pneus. Clique numa barra para filtrar a tela."
          : "Todos os pneus dos dados exibidos. Clique numa barra para filtrar a tela."
      }
      data-testid="tires-profile-chart"
    >
      <div className="flex flex-col gap-3">
        <SegmentedControl
          aria-label="Perfil por"
          value={dim}
          onValueChange={(v) => setRaw(v === "brand" ? null : PROFILE_PARAM[v])}
          options={PROFILE_OPTIONS.map((o) => ({ ...o, "data-testid": `tires-profile-dim-${o.value}` }))}
          wrap
          data-testid="tires-profile-dim"
        />
        <BarList
          rows={rows}
          ariaLabel={`Pneus por ${option?.label.toLowerCase() ?? "perfil"}`}
          disabled={ctx.pending}
          testId="tires-profile-bars"
        />
      </div>
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// Onde estão os pneus em uso
// ---------------------------------------------------------------------------
function WhereChart({
  overview, ctx, onFilter,
}: {
  overview: TireOverviewV2;
  ctx: TiresPanelContext;
  onFilter: (field: CrossField, key: string) => void;
}) {
  const [raw, setRaw] = useViewParam("onde");
  const dim = fromParam<WhereDim>(WHERE_PARAM, raw, "operation");
  const list: TireWhereItem[] = overview.where?.[dim] ?? [];
  const field: CrossField = dim;
  const rows: BarRow[] = list.map((i) => {
    const nok = Math.max(0, i.count - i.conform);
    const filterable = canFilter(field, i.key);
    return {
      key: i.key,
      label: i.label,
      value: i.count,
      segments: [
        { key: "conform", value: i.conform, color: "var(--chart-success)" },
        { key: "nonconform", value: nok, color: "var(--chart-danger)" },
      ],
      detail: `· ${fmtPct(shareOf(i.conform, i.count))} conformes`,
      srText: `${fmtInt(i.conform)} ${plural(i.conform, "conforme", "conformes")} e ${fmtInt(nok)} ${plural(nok, "não conforme", "não conformes")}${
        i.critical > 0 ? `; ${fmtInt(i.critical)} de criticidade crítica` : ""
      }`,
      active: filterable && isFilterActive(ctx.filters, field, i.key),
      onSelect: filterable ? () => onFilter(field, i.key) : undefined,
    };
  });
  const option = WHERE_OPTIONS.find((o) => o.value === dim);
  return (
    <ChartCard
      title="Onde estão os pneus em uso"
      description="Pneus em uso e a Conformidade Geral de cada grupo. Clique numa barra para filtrar a tela."
      data-testid="tires-where-chart"
    >
      <div className="flex flex-col gap-3">
        <SegmentedControl
          aria-label="Agrupar os pneus em uso por"
          value={dim}
          onValueChange={(v) => setRaw(v === "operation" ? null : WHERE_PARAM[v])}
          options={WHERE_OPTIONS.map((o) => ({ ...o, "data-testid": `tires-where-dim-${o.value}` }))}
          wrap
          data-testid="tires-where-dim"
        />
        <ChartLegend
          items={[
            { key: "conform", label: "Conformes", color: "var(--chart-success)" },
            { key: "nonconform", label: "Não conformes", color: "var(--chart-danger)" },
          ]}
        />
        <BarList
          rows={rows}
          ariaLabel={`Pneus em uso por ${option?.label.toLowerCase() ?? "grupo"}`}
          disabled={ctx.pending}
          testId="tires-where-bars"
          emptyText="Nenhum pneu em uso neste recorte."
        />
      </div>
    </ChartCard>
  );
}
