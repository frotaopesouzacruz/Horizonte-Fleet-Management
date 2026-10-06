"use client";

import { SlidersHorizontal } from "lucide-react";
import type { TiresTabData } from "@/lib/tires/loaders";
import type { TiresPanelContext } from "../shared";
import { GeneralParameters } from "./parameters/general-form";
import { KpiScheduleSection } from "./parameters/kpi-schedule";
import { LayoutsSection } from "./parameters/layouts";
import { LinksSection } from "./parameters/links";
import { ReadOnlyNotice } from "./parameters/param-ui";
import { PositionsSection } from "./parameters/positions";
import { PressureRulesSection } from "./parameters/pressure-rules";
import { ServiceKindsSection } from "./parameters/service-kinds";
import { SyncSourceSection } from "./parameters/sync-source";
import { PanelEmpty, PanelError, SubTabs } from "./tires-ui";

/**
 * Gestão de Pneus → Parâmetros. Tudo é cadastro por formulário (nunca JSON),
 * gravado por rotina do banco com vigência e trilha de auditoria. Prazos,
 * tolerâncias e limites vêm sempre de `tires_catalog` — nenhum número fixo na
 * tela. Sem `tires.parameters.manage` a aba é só leitura.
 */
type Sub = "prazos" | "psi" | "posicoes" | "layouts" | "vinculos" | "servicos" | "fonte" | "indicadores";

const SUBS: { value: Sub; label: string }[] = [
  { value: "prazos", label: "Prazos e limites" },
  { value: "psi", label: "Regras de PSI" },
  { value: "posicoes", label: "Posições" },
  { value: "layouts", label: "Layouts" },
  { value: "vinculos", label: "Vínculos" },
  { value: "servicos", label: "Serviços da Manutenção" },
  { value: "fonte", label: "Fonte oficial (SharePoint)" },
  { value: "indicadores", label: "Agenda dos indicadores" },
];

export function ParametersPanel({ data, ctx }: { data: TiresTabData["parametros"] | null; ctx: TiresPanelContext }) {
  if (ctx.error) return <PanelError ctx={ctx} title="Não foi possível carregar os parâmetros de pneus." testId="tires-parametros-error" />;
  if (!data) {
    return (
      <PanelEmpty
        icon={<SlidersHorizontal />}
        title="Parâmetros indisponíveis"
        description="A rotina não devolveu os parâmetros de pneus. Recarregue a página."
        testId="tires-parametros-empty"
      />
    );
  }

  const requested = ctx.params.sub as Sub | undefined;
  const sub: Sub = requested && SUBS.some((s) => s.value === requested) ? requested : "prazos";
  const canManage = ctx.perms.parameters;
  const onDone = ctx.refresh;

  return (
    <div className="flex flex-col gap-4" data-testid="tires-parametros" data-readonly={canManage ? undefined : "true"}>
      <SubTabs ctx={ctx} value={sub} items={SUBS} label="Seções dos parâmetros" testIdPrefix="tires-param-sub" />
      {!canManage ? <ReadOnlyNotice /> : null}
      {sub === "prazos" ? <GeneralParameters catalog={data} canManage={canManage} onDone={onDone} /> : null}
      {sub === "psi" ? <PressureRulesSection catalog={data} canManage={canManage} onDone={onDone} /> : null}
      {sub === "posicoes" ? <PositionsSection catalog={data} canManage={canManage} onDone={onDone} /> : null}
      {sub === "layouts" ? <LayoutsSection catalog={data} canManage={canManage} onDone={onDone} /> : null}
      {sub === "vinculos" ? <LinksSection catalog={data} canManage={canManage} vehicles={ctx.options?.vehicles ?? null} onDone={onDone} /> : null}
      {sub === "servicos" ? <ServiceKindsSection catalog={data} canManage={canManage} onDone={onDone} /> : null}
      {sub === "fonte" ? <SyncSourceSection source={data.syncSource} canManage={canManage} onDone={onDone} /> : null}
      {sub === "indicadores" ? <KpiScheduleSection schedule={data.kpiSchedule} canManage={canManage} onDone={onDone} /> : null}
    </div>
  );
}
