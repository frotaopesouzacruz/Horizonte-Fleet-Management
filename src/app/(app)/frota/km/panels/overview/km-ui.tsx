"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";
import { KpiCard, type KpiCardProps } from "@/components/ui/kpi-card";
import type { StatusTone } from "@/components/ui/status-badge";
import type { KmTone } from "@/lib/km/types";
import type { KmPanelContext } from "../../shared";

/**
 * Peças comuns da Visão geral e da Visão diária do KM: links reais entre abas,
 * estado de exibição na URL sem nova consulta, seções, indicadores e datas
 * por extenso (sem passar por fuso).
 */

// ---------------------------------------------------------------------------
// Links e estado na URL
// ---------------------------------------------------------------------------
export interface KmNavLink {
  href: string;
  onClick: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}

/**
 * Link de verdade (abre em nova aba, copia o endereço) que, no clique simples,
 * navega pela transição da tela — com o `pending` e o `aria-busy` de sempre.
 */
export function useKmLink(ctx: KmPanelContext) {
  const params = useSearchParams();
  const pathname = usePathname();
  const { navigate } = ctx;
  return React.useCallback(
    (patch: Record<string, string | null>): KmNavLink => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      return {
        href: qs ? `${pathname}?${qs}` : pathname,
        onClick: (event) => {
          if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            return;
          }
          event.preventDefault();
          navigate(patch);
        },
      };
    },
    [params, pathname, navigate],
  );
}

/**
 * Estado de exibição (faixa escolhida, Top N, agrupamento) na URL, sem nova
 * consulta ao servidor: o histórico do navegador, que o roteador acompanha.
 */
export function useViewParam(key: string): [string | null, (value: string | null) => void] {
  const params = useSearchParams();
  const pathname = usePathname();
  const value = params.get(key);
  const set = React.useCallback(
    (v: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (v == null || v === "") next.delete(key);
      else next.set(key, v);
      const qs = next.toString();
      window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
    },
    [params, pathname, key],
  );
  return [value, set];
}

// ---------------------------------------------------------------------------
// Blocos
// ---------------------------------------------------------------------------
export function Section({
  title, description, actions, children, testId, className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
  className?: string;
}) {
  const headingId = React.useId();
  return (
    <section aria-labelledby={headingId} className={cn("flex min-w-0 flex-col gap-3", className)} data-testid={testId}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={headingId} className="text-h4 font-semibold text-fg">{title}</h2>
          {description ? <p className="max-w-[90ch] text-caption text-fg-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** O realce de hover do Card interativo, aplicado ao KpiCard dentro do link. */
const INTERACTIVE_KPI = cn(
  "cursor-pointer",
  "after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:bg-hover-overlay after:opacity-0",
  "after:transition-opacity after:duration-(--duration-base) group-hover:after:opacity-100",
);

export type KmKpiProps = Omit<KpiCardProps, "size"> & {
  testId: string;
  /** Leva à visão que explica o número. */
  nav?: KmNavLink | null;
  /** Para leitor de tela: para onde o link leva. */
  destination?: string;
};

/**
 * Um indicador. Os rótulos reservam duas linhas, para que os números da
 * fileira fiquem na mesma linha de base qualquer que seja o tamanho do nome.
 */
export function KmKpi({ testId, nav, destination, label, className, ...card }: KmKpiProps) {
  const body = (
    <KpiCard
      size="compact"
      label={<span className="block min-h-9 leading-snug">{label}</span>}
      className={cn("h-full justify-start", nav && INTERACTIVE_KPI, className)}
      data-testid={nav ? undefined : testId}
      {...card}
    />
  );
  if (!nav) return body;
  return (
    <a href={nav.href} onClick={nav.onClick} className="group block h-full rounded-lg hfm-focus-ring" data-testid={testId}>
      {body}
      {destination ? <span className="sr-only">. {destination}</span> : null}
    </a>
  );
}

/** "VA174 · SNU9C19" — código de frota e placa, o que existir. */
export const vehicleName = (fleetCode: string | null | undefined, plate: string | null | undefined) =>
  [fleetCode, plate].filter((v, i, a) => Boolean(v) && a.indexOf(v) === i).join(" · ") || "—";

/** Nome do veículo; com permissão de histórico, um link para o Histórico por frota. */
export function VehicleRef({
  ctx, vehicleId, fleetCode, plate, testId,
}: {
  ctx: KmPanelContext;
  vehicleId: string;
  fleetCode: string | null | undefined;
  plate: string | null | undefined;
  testId?: string;
}) {
  const link = useKmLink(ctx);
  const name = vehicleName(fleetCode, plate);
  if (!ctx.perms.history) return <span className="font-medium text-fg">{name}</span>;
  const nav = link({ aba: "historico", veiculo: vehicleId });
  return (
    <a
      href={nav.href}
      onClick={nav.onClick}
      className="rounded-xs font-medium text-link underline-offset-4 hover:text-link-hover hover:underline hfm-focus-ring"
      data-testid={testId}
    >
      {name}
      <span className="sr-only"> — abrir o histórico do veículo</span>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Tons
// ---------------------------------------------------------------------------
export const statusToneOf = (tone: KmTone | string | null | undefined): StatusTone =>
  tone === "success" || tone === "warning" || tone === "danger" || tone === "info" ? tone : "neutral";

/** Cor de gráfico do tom (tokens do kit). */
export function chartColorOf(tone: KmTone | string | null | undefined): string {
  switch (tone) {
    case "success":
      return "var(--chart-success)";
    case "warning":
      return "var(--chart-warning)";
    case "danger":
      return "var(--chart-danger)";
    case "info":
      return "var(--chart-brand-secondary)";
    default:
      return "var(--chart-neutral)";
  }
}

// ---------------------------------------------------------------------------
// Datas (aaaa-mm-dd, sem fuso)
// ---------------------------------------------------------------------------
const WEEKDAY_LONG = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function parts(iso: string): [number, number, number] | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

const utc = (iso: string): Date | null => {
  const p = parts(iso);
  return p ? new Date(Date.UTC(p[0], p[1] - 1, p[2])) : null;
};

/** "terça-feira, 30 de setembro de 2026". */
export function dateLong(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = utc(iso);
  if (!d) return iso;
  return `${WEEKDAY_LONG[d.getUTCDay()]}, ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

/** "ter" — dia da semana abreviado. */
export function weekdayOf(iso: string): string {
  const d = utc(iso);
  return d ? WEEKDAY_SHORT[d.getUTCDay()] : "";
}

/** "30/09" — dia e mês. */
export function dayMonth(iso: string): string {
  const p = parts(iso);
  return p ? `${String(p[2]).padStart(2, "0")}/${String(p[1]).padStart(2, "0")}` : iso;
}

/** Soma dias a uma data aaaa-mm-dd. */
export function addDays(iso: string, n: number): string {
  const d = utc(iso);
  if (!d) return iso;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Carimbo de data/hora em pt-BR (fuso de São Paulo). */
export function formatStamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** Parte de um todo, em %, só para exibir (nunca para decidir status). */
export const shareOf = (part: number | null | undefined, whole: number | null | undefined): number | null =>
  part == null || whole == null || whole <= 0 ? null : (part / whole) * 100;
