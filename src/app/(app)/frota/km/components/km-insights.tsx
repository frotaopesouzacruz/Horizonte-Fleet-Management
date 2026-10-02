import * as React from "react";
import { Lightbulb } from "lucide-react";
import { InsightCard, InsightList, type InsightTone } from "@/components/feedback/insight-card";
import { SectionHeader } from "@/components/layout/section-header";

/**
 * Leituras determinísticas do KM (visão geral e análise gerencial): cada fato
 * vem da rotina, com o tom que ela calculou. A tela só apresenta.
 */
const TONES = new Set<InsightTone>(["success", "warning", "danger", "info", "neutral"]);

export function KmInsights({
  items,
  description,
  empty,
  testId,
  itemTestId,
}: {
  items: { tone: string; text: string }[];
  description?: React.ReactNode;
  /** Sem leituras: mensagem curta (ou nada, se omitido). */
  empty?: string;
  testId: string;
  itemTestId?: string;
}) {
  const headingId = React.useId();
  if (items.length === 0 && !empty) return null;
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3" data-testid={testId}>
      <SectionHeader
        headingId={headingId}
        headingLevel={3}
        icon={<Lightbulb />}
        title="Leituras do período"
        description={description}
      />
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-3 text-body-sm text-fg-muted">{empty}</p>
      ) : (
        <InsightList className="xl:grid-cols-2">
          {items.map((item, i) => {
            const tone = (TONES.has(item.tone as InsightTone) ? item.tone : "neutral") as InsightTone;
            return (
              <InsightCard key={i} compact tone={tone} data-testid={itemTestId}>
                {item.text}
              </InsightCard>
            );
          })}
        </InsightList>
      )}
    </section>
  );
}
