"use client";

import * as React from "react";
import { CalendarCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import type { KmDailyData } from "@/lib/km/daily";
import type { KmPanelContext } from "../../shared";
import { addDays, dateLong } from "../overview/km-ui";

const VALID = /^(\d{4})-\d{2}-\d{2}$/;

/**
 * Escolha do dia: campo de data mais dia anterior/próximo. O dia vai para a
 * URL (`dia`) e a tela consulta de novo; o futuro não é oferecido.
 */
export function DayPicker({ data, ctx }: { data: KmDailyData; ctx: KmPanelContext }) {
  const [draft, setDraft] = React.useState(data.date);
  const inputId = React.useId();
  const prev = addDays(data.date, -1);
  const next = addDays(data.date, 1);
  const canNext = next <= data.today;

  const go = (day: string | null) => {
    if (day && day > data.today) return;
    ctx.navigate({ dia: day });
  };

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised px-4 py-3 shadow-card md:flex-row md:items-center md:justify-between"
      data-testid="km-diaria-day-picker"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-caption text-fg-muted">
          {data.requestedDay ? "Dia escolhido" : "Último dia com KM validado (padrão)"}
        </p>
        <p className="text-h3 font-semibold text-fg first-letter:uppercase" data-testid="km-diaria-date-long" aria-live="polite">
          {dateLong(data.date)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <IconButton
          variant="outline"
          label="Dia anterior"
          onClick={() => go(prev)}
          disabled={ctx.pending}
          data-testid="km-diaria-prev"
        >
          <ChevronLeft aria-hidden />
        </IconButton>
        <label htmlFor={inputId} className="sr-only">
          Dia
        </label>
        <DateInput
          id={inputId}
          value={draft}
          max={data.today}
          wrapperClassName="w-44"
          onChange={(e) => {
            const v = e.target.value;
            setDraft(v);
            const m = v.match(VALID);
            // o campo nativo emite datas completas; anos com menos de 4 dígitos digitados ainda não valem
            if (m && Number(m[1]) >= 2000 && v !== data.date && v <= data.today) go(v);
          }}
          data-testid="km-diaria-date"
        />
        <IconButton
          variant="outline"
          label="Próximo dia"
          onClick={() => go(next)}
          disabled={!canNext || ctx.pending}
          data-testid="km-diaria-next"
        >
          <ChevronRight aria-hidden />
        </IconButton>
        {data.requestedDay ? (
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<CalendarCheck aria-hidden />}
            onClick={() => go(null)}
            data-testid="km-diaria-latest"
          >
            Último dia com KM
          </Button>
        ) : null}
      </div>
    </div>
  );
}
