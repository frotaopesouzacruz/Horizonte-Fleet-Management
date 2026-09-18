/**
 * Chart palette exposed as CSS variable references so charts follow the active
 * theme (light/dark) automatically. Use with any charting library that accepts
 * CSS color strings, e.g. `stroke={chartSeries[0]}`.
 */
export const chartSeries = [
  "var(--chart-1)", // Horizonte blue
  "var(--chart-2)", // cyan
  "var(--chart-3)", // gold
  "var(--chart-4)", // green
  "var(--chart-5)", // red
  "var(--chart-6)", // neutral
  "var(--chart-7)", // light blue
  "var(--chart-8)", // deep navy / cyan (dark)
] as const;

export const chartSemantic = {
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  info: "var(--info)",
  neutral: "var(--neutral)",
  primary: "var(--primary)",
  accent: "var(--accent)",
  highlight: "var(--highlight)",
} as const;

export const chartChrome = {
  grid: "var(--chart-grid)",
  axis: "var(--chart-axis)",
  tooltipBackground: "var(--chart-tooltip-bg)",
  tooltipForeground: "var(--chart-tooltip-fg)",
} as const;

/** Resolves a CSS variable to its computed value (client only), for canvas-based charts. */
export function resolveCssVar(variable: string, element: HTMLElement = document.documentElement): string {
  const name = variable.replace(/^var\((--[^)]+)\)$/, "$1");
  return getComputedStyle(element).getPropertyValue(name).trim();
}
