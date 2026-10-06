import * as React from "react";
import { ChevronRight } from "lucide-react";
import { InsightCard, InsightList } from "@/components/feedback/insight-card";
import { modernTerms, type TireInsight } from "@/lib/tires/types";
import type { TiresNavLink } from "../tires-ui";
import { Section } from "../tires-ui";
import type { Nav } from "./shared";

/**
 * Alertas: só o que `tires_overview` apontou (frase pronta do banco). A tela
 * acrescenta apenas o destino de cada alerta, quando há uma lista que o explica.
 */
function targetOf(key: string, to: Nav): { nav: TiresNavLink | null; label: string } | null {
  const inUse = (patch: Record<string, string | null>) => to("base", { visao: "fogo", situacao: "em_uso", ...patch });
  switch (key) {
    case "below_legal":
      return { nav: inUse({ sulco: "abaixo_legal" }), label: "Ver os pneus" };
    case "fleets_with_critical":
      return { nav: to("base", { visao: "frota", sulco: "abaixo_legal,critico" }), label: "Ver as frotas" };
    case "measurement_overdue":
      return { nav: to("medicao", { sub: "prazo", pendencia: "vencido" }), label: "Ver medições vencidas" };
    case "on_time_bad_psi":
      return { nav: to("calibragem", { sub: "conformidade", pendencia: "prazo_ok_psi_inadequado" }), label: "Ver os pneus" };
    case "psi_gaps":
      return { nav: to("calibragem", { sub: "psi", pendencia: "sem_parametro" }), label: "Ver os pneus sem parâmetro" };
    case "absent":
      return { nav: to("qualidade", { regra: "ausente_planilha" }), label: "Ver na Auditoria dos dados" };
    case "rodopar_sla":
      return { nav: to("vistorias", { fase: "pendente_rodopar" }), label: "Ver as vistorias" };
    default:
      return null;
  }
}

export function AlertsSection({ insights, to }: { insights: TireInsight[]; to: Nav }) {
  return (
    <Section title="Alertas" testId="tires-overview-alerts" description="Fatos destacados pelo banco sobre os dados e os filtros atuais.">
      {insights.length === 0 ? (
        <p className="text-body-sm text-fg-muted">Nenhum alerta para os dados e os filtros atuais.</p>
      ) : (
        <InsightList className="xl:grid-cols-3">
          {insights.map((i) => {
            const t = targetOf(i.key, to);
            return (
              <InsightCard
                key={i.key}
                tone={i.tone}
                compact
                data-testid="tires-overview-alert"
                data-key={i.key}
                action={
                  t?.nav ? (
                    <a
                      href={t.nav.href}
                      onClick={t.nav.onClick}
                      className="inline-flex items-center gap-1 rounded-xs text-body-sm font-medium text-link hover:text-link-hover hover:underline hfm-focus-ring"
                    >
                      {t.label}
                      <ChevronRight aria-hidden className="size-3.5" />
                    </a>
                  ) : undefined
                }
              >
                {modernTerms(i.text)}
              </InsightCard>
            );
          })}
        </InsightList>
      )}
    </Section>
  );
}
