import { cn } from "@/lib/cn";
import { KM_STATUS } from "@/lib/km/types";
import { HEAT_CLASS, HEAT_LEGEND, STATUS_MARK } from "./model";

/** Legenda do mapa de calor — as mesmas classes da grade, com texto (cor nunca sozinha). */
export function PlannerLegend() {
  return (
    <div className="flex flex-col gap-2" data-testid="km-planner-legend">
      <ul aria-label="Legenda do planner" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-caption text-fg-secondary">
        {HEAT_LEGEND.map((item) => (
          <li key={item.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className={cn(
                "inline-flex h-5 w-11 items-center justify-end rounded-xs border border-border-subtle px-1 tabular-nums",
                HEAT_CLASS[item.key],
              )}
            >
              {item.sample}
            </span>
            {item.label}
          </li>
        ))}
      </ul>
      <ul aria-label="Marcadores de situação" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-fg-muted">
        {(Object.entries(STATUS_MARK) as [keyof typeof KM_STATUS, string][]).map(([code, mark]) => (
          <li key={code} className="inline-flex items-center gap-1">
            <span
              aria-hidden
              className="inline-flex size-4 items-center justify-center rounded-xs text-[10px] font-bold text-fg shadow-[inset_0_0_0_1px_var(--warning)]"
            >
              {mark}
            </span>
            {KM_STATUS[code].label} (conta nos totais)
          </li>
        ))}
        <li>Faixas pelo KM validado do dia. Passe o cursor na célula para ver situação e hodômetros.</li>
      </ul>
    </div>
  );
}
