import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * GaugeChart — indicador circular para taxas com faixa conhecida (aderência,
 * cobertura, SLA, score de qualidade). Arco de 240°, trilho tonal, arco no tom
 * de negócio e, opcionalmente, a meta como marcador dourado. Sem neon: o brilho
 * é só o da superfície.
 *
 * Usar apenas para indicadores percentuais com significado de "quanto do
 * total"; volumes absolutos vão em KPI ou barras.
 */
export type GaugeTone = "primary" | "accent" | "success" | "warning" | "danger" | "neutral";

const TONE_COLOR: Record<GaugeTone, string> = {
  primary: "var(--chart-brand-primary)",
  accent: "var(--chart-brand-secondary)",
  success: "var(--chart-success)",
  warning: "var(--chart-warning)",
  danger: "var(--chart-danger)",
  neutral: "var(--chart-neutral)",
};

export interface GaugeChartProps {
  /** 0–100; nulo = sem base (trilho vazio e "—"). */
  value: number | null;
  /** Meta 0–100 (marcador dourado). */
  target?: number | null;
  tone?: GaugeTone;
  /** Texto central abaixo do número ("Cobertura"). */
  label?: React.ReactNode;
  /** Formata o número central (padrão: "88,9%"). */
  format?: (value: number) => string;
  size?: number;
  ariaLabel: string;
  className?: string;
  "data-testid"?: string;
}

const pct = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function GaugeChart({
  value,
  target = null,
  tone = "primary",
  label,
  format = (v) => `${pct.format(v)}%`,
  size = 168,
  ariaLabel,
  className,
  "data-testid": testId,
}: GaugeChartProps) {
  const uid = React.useId().replace(/:/g, "");
  const stroke = Math.max(10, Math.round(size * 0.075));
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const start = 150; // graus (sentido horário a partir do eixo x)
  const sweep = 240;
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const point = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  const arc = (fromDeg: number, toDeg: number) => {
    const [x1, y1] = point(fromDeg);
    const [x2, y2] = point(toDeg);
    const large = toDeg - fromDeg > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  };
  const end = value == null ? start : start + (sweep * clamp(value)) / 100;
  const targetDeg = target == null ? null : start + (sweep * clamp(target)) / 100;
  const color = TONE_COLOR[tone];
  const height = Math.round(size * 0.84);

  return (
    <figure className={cn("relative inline-flex flex-col items-center", className)} style={{ width: size }} data-testid={testId}>
      <svg
        width={size}
        height={height}
        viewBox={`0 0 ${size} ${height}`}
        role="img"
        aria-label={`${ariaLabel}: ${value == null ? "sem base" : format(value)}${target != null ? `; meta ${format(target)}` : ""}`}
      >
        <defs>
          <linearGradient id={`g-${uid}`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor={color} stopOpacity={0.75} />
            <stop offset="100%" stopColor={color} stopOpacity={1} />
          </linearGradient>
        </defs>
        <path d={arc(start, start + sweep)} fill="none" stroke="var(--chart-track)" strokeWidth={stroke} strokeLinecap="round" />
        {value != null && value > 0 ? (
          <path d={arc(start, Math.max(end, start + 0.01))} fill="none" stroke={`url(#g-${uid})`} strokeWidth={stroke} strokeLinecap="round" />
        ) : null}
        {targetDeg != null
          ? (() => {
              const rad = (targetDeg * Math.PI) / 180;
              const inner = r - stroke / 2 - 3;
              const outer = r + stroke / 2 + 3;
              return (
                <line
                  x1={cx + inner * Math.cos(rad)}
                  y1={cy + inner * Math.sin(rad)}
                  x2={cx + outer * Math.cos(rad)}
                  y2={cy + outer * Math.sin(rad)}
                  stroke="var(--chart-target)"
                  strokeWidth={3}
                  strokeLinecap="round"
                />
              );
            })()
          : null}
      </svg>
      <figcaption className="pointer-events-none absolute inset-x-0 flex flex-col items-center" style={{ top: size * 0.32 }}>
        <span className="text-kpi-sm font-semibold text-fg tabular-nums">{value == null ? "—" : format(value)}</span>
        {label ? <span className="mt-0.5 text-caption text-fg-muted">{label}</span> : null}
      </figcaption>
    </figure>
  );
}
