"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import { NativeSelect } from "./selects";
import { MONTH_NAMES, type Competence } from "@/lib/governance/competence";

export interface CompetencePickerProps {
  value: Competence;
  onChange: (value: Competence) => void;
  disabled?: boolean;
  /** Years offered around the current one. */
  span?: number;
}

/**
 * Month and year, plus the two arrows.
 *
 * Planning a month is almost always "the next one" or "the one before", and a
 * planner does that dozens of times in a sitting. Making them open two selects
 * for the most common move is the kind of friction that gets a screen
 * abandoned for a spreadsheet.
 */
export function CompetencePicker({ value, onChange, disabled, span = 3 }: CompetencePickerProps) {
  const thisYear = new Date().getFullYear();
  const years = React.useMemo(
    () => Array.from({ length: span * 2 + 1 }, (_, i) => thisYear - span + i),
    [span, thisYear],
  );

  const shift = (delta: number) => {
    const index = value.year * 12 + (value.month - 1) + delta;
    onChange({ year: Math.floor(index / 12), month: (index % 12) + 1 });
  };

  return (
    <div className="flex items-center gap-1.5">
      <IconButton
        variant="ghost"
        size="sm"
        label="Competência anterior"
        disabled={disabled}
        onClick={() => shift(-1)}
      >
        <ChevronLeft />
      </IconButton>

      <div className="flex items-center gap-1.5">
        <NativeSelect
          fieldSize="sm"
          aria-label="Mês da competência"
          value={String(value.month)}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, month: Number(e.target.value) })}
          className="min-w-[8.5rem]"
        >
          {MONTH_NAMES.slice(1).map((name, i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </NativeSelect>

        <NativeSelect
          fieldSize="sm"
          aria-label="Ano da competência"
          value={String(value.year)}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, year: Number(e.target.value) })}
          className="min-w-[5.5rem]"
        >
          {years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </NativeSelect>
      </div>

      <IconButton
        variant="ghost"
        size="sm"
        label="Próxima competência"
        disabled={disabled}
        onClick={() => shift(1)}
      >
        <ChevronRight />
      </IconButton>
    </div>
  );
}
