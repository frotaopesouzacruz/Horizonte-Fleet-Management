"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { ChartLegend, SrTable, type ChartLegendItem } from "@/components/charts";
import { StatusDot, statusTone as toneConfig } from "@/components/ui/status-badge";
import { fmtInt, fmtPct, plural, type TiresTone } from "@/lib/tires/types";
import { chartColorOf, type TiresNavLink } from "../tires-ui";
import type { StatusEntry } from "./model";

/**
 * Desenhos das visões gerenciais, em HTML (os números ficam escritos; a cor
 * acompanha o rótulo, nunca o substitui) e com a tabela gêmea para leitor de
 * tela. Cores só por token (`chartColorOf`, tons do StatusBadge).
 */

const share = (count: number, base: number) => (base > 0 ? (100 * count) / base : null);

// ---------------------------------------------------------------------------
// Barras por situação (clicáveis nas não conformes)
// ---------------------------------------------------------------------------
export function StatusBars({
  entries, base, active, linkFor, testId,
}: {
  entries: StatusEntry[];
  /** pneus em uso no recorte (base dos percentuais) */
  base: number;
  /** situação filtrada nas pendências */
  active: string | null;
  linkFor: (code: string) => TiresNavLink;
  testId?: string;
}) {
  const groups = [
    { key: "ok", title: "Conformes", items: entries.filter((e) => e.ok) },
    { key: "nok", title: "Não conformes — clique para ver as pendências", items: entries.filter((e) => !e.ok) },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      {groups.map((g) => (
        <div key={g.key} className="flex flex-col gap-1">
          <p className="text-overline font-semibold tracking-wide text-fg-muted uppercase">{g.title}</p>
          <ul className="flex flex-col" aria-label={g.key === "ok" ? "Situações conformes" : "Situações não conformes"}>
            {g.items.map((e) => {
              const pct = share(e.count, base);
              const clickable = !e.ok && e.count > 0;
              const isActive = active === e.code;
              const content = (
                <>
                  <span className="flex min-w-0 items-center gap-2">
                    <StatusDot status={e.tone} />
                    <span className={cn("truncate text-body-sm", e.count > 0 ? "text-fg" : "text-fg-muted")}>{e.label}</span>
                    {isActive ? <span className="shrink-0 text-caption font-semibold text-primary">filtrando</span> : null}
                  </span>
                  <span aria-hidden className="block h-2 overflow-hidden rounded-full bg-surface-sunken">
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%`, minWidth: e.count > 0 ? 3 : 0, background: chartColorOf(e.tone) }}
                    />
                  </span>
                  <span className="whitespace-nowrap text-right text-body-sm tabular-nums">
                    <span className={cn("font-semibold", e.count > 0 ? "text-fg" : "text-fg-muted")}>{fmtInt(e.count)}</span>
                    <span className="text-fg-muted"> · {fmtPct(pct == null ? null : Math.round(pct * 10) / 10)}</span>
                  </span>
                  {clickable ? <ChevronRight aria-hidden className="size-4 text-fg-muted" /> : <span aria-hidden className="size-4" />}
                </>
              );
              const row = "grid grid-cols-[minmax(0,13rem)_minmax(3rem,1fr)_auto_1rem] items-center gap-3 rounded-md px-2 py-1.5";
              if (!clickable) {
                return (
                  <li key={e.code} className={row} data-testid="tires-indicator-status" data-status={e.code}>
                    {content}
                  </li>
                );
              }
              const nav = linkFor(e.code);
              return (
                <li key={e.code} data-testid="tires-indicator-status" data-status={e.code}>
                  <a
                    href={nav.href}
                    onClick={nav.onClick}
                    aria-current={isActive ? "true" : undefined}
                    className={cn(row, "hfm-transition hover:bg-hover-overlay hfm-focus-ring", isActive && "bg-primary-soft")}
                    data-testid="tires-indicator-status-link"
                  >
                    {content}
                    <span className="sr-only">
                      {" "}
                      — ver {plural(e.count, "o pneu", `os ${fmtInt(e.count)} pneus`)} nesta situação
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Colunas (histograma de MM, dias de atraso, desvio de PSI)
// ---------------------------------------------------------------------------
export interface ColumnItem {
  key: string;
  label: string;
  count: number;
  tone: TiresTone;
  /**
   * Faixa fora de escala (ex.: "Na faixa" do PSI, muito maior que os desvios):
   * vira um bloco de altura cheia com o número escrito, e não entra na escala.
   */
  band?: boolean;
}

export interface ColumnMarker {
  /** posição em unidades de coluna, de 0 a `items.length` (3 = início da 4ª coluna) */
  at: number;
  label: string;
}

export function Columns({
  items, markers = [], caption, legend, height = 156, testId,
}: {
  items: ColumnItem[];
  markers?: ColumnMarker[];
  /** descrição do gráfico (leitor de tela e tabela gêmea) */
  caption: string;
  legend?: ChartLegendItem[];
  height?: number;
  testId?: string;
}) {
  const max = Math.max(1, ...items.filter((i) => !i.band).map((i) => i.count));
  const plot = height - 22;
  const n = Math.max(items.length, 1);
  return (
    <figure className="flex min-w-0 flex-col gap-2" data-testid={testId}>
      {legend?.length ? <ChartLegend items={legend} /> : null}
      <div aria-hidden className={cn("relative", markers.length ? "pt-5" : "pt-1")}>
        <div className="flex items-end border-b" style={{ height, borderColor: "var(--chart-axis-line)" }}>
          {items.map((it) => {
            const px = it.count > 0 ? Math.max(2, Math.round((it.count / max) * plot)) : 0;
            const soft = toneConfig(it.tone === "pending" ? "neutral" : it.tone);
            return (
              <div
                key={it.key}
                className="flex h-full min-w-0 flex-1 flex-col items-center justify-end px-px"
                title={`${it.label}: ${fmtInt(it.count)} ${plural(it.count, "pneu", "pneus")}`}
              >
                {it.band ? (
                  <div className={cn("flex w-full flex-1 flex-col items-center justify-center rounded-t-[4px] border border-b-0 border-dashed px-0.5 text-center", soft.softClassName)}>
                    <span className="text-body-sm font-semibold text-fg tabular-nums">{fmtInt(it.count)}</span>
                    <span className={cn("text-caption leading-tight", soft.softForegroundClassName)}>fora de escala</span>
                  </div>
                ) : (
                  <>
                    <span className="mb-1 text-caption font-semibold leading-none text-fg tabular-nums">{it.count > 0 ? fmtInt(it.count) : ""}</span>
                    <div className="w-full max-w-9 rounded-t-[4px]" style={{ height: px, background: chartColorOf(it.tone) }} />
                  </>
                )}
              </div>
            );
          })}
        </div>
        {markers.map((m) => (
          <div
            key={`${m.label}-${m.at}`}
            className="pointer-events-none absolute top-5 border-l-2 border-dashed"
            style={{ left: `${(Math.max(0, Math.min(n, m.at)) / n) * 100}%`, height, borderColor: "var(--chart-target)" }}
          >
            <span
              className="absolute -top-5 left-0 -translate-x-1/2 whitespace-nowrap text-caption font-semibold tabular-nums"
              style={{ color: "var(--chart-target-label)" }}
            >
              {m.label}
            </span>
          </div>
        ))}
      </div>
      <div aria-hidden className="flex">
        {items.map((it) => (
          <span key={it.key} className="min-w-0 flex-1 break-words px-px text-center text-caption leading-tight text-fg-muted">
            {it.label}
          </span>
        ))}
      </div>
      <figcaption className="sr-only">{caption}</figcaption>
      <SrTable
        caption={caption}
        columns={["Faixa", "Pneus"]}
        rows={items.map((it) => ({ key: it.key, cells: [it.label, fmtInt(it.count)] }))}
      />
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Matriz prazo × PSI (Conformidade de calibragem)
// ---------------------------------------------------------------------------
export function CalibrationMatrix({
  entries, base, active, linkFor, testId,
}: {
  entries: StatusEntry[];
  base: number;
  active: string | null;
  linkFor: (code: string) => TiresNavLink;
  testId?: string;
}) {
  const by = new Map(entries.map((e) => [e.code, e]));
  const cell = (code: string, note?: string) => {
    const e = by.get(code);
    if (!e) return <td className="rounded-md border border-dashed border-border p-3 text-caption text-fg-muted">—</td>;
    const t = toneConfig(e.tone === "pending" ? "neutral" : e.tone);
    const pct = share(e.count, base);
    const clickable = !e.ok && e.count > 0;
    const body = (
      <>
        <span className="text-h3 font-semibold text-fg tabular-nums">{fmtInt(e.count)}</span>
        <span className="text-caption text-fg-secondary tabular-nums">{fmtPct(pct == null ? null : Math.round(pct * 10) / 10)} dos pneus</span>
        <span className={cn("text-caption font-semibold", t.softForegroundClassName)}>{e.label}</span>
        {note ? <span className="text-caption text-fg-secondary">{note}</span> : null}
      </>
    );
    const box = cn("flex h-full flex-col gap-0.5 rounded-md border p-3", t.softClassName, active === code && "ring-2 ring-primary");
    return (
      <td className="h-full p-0 align-top" data-testid="tires-indicator-matrix-cell" data-status={code}>
        {clickable ? (
          (() => {
            const nav = linkFor(code);
            return (
              <a href={nav.href} onClick={nav.onClick} aria-current={active === code ? "true" : undefined} className={cn(box, "hfm-transition hover:ring-1 hover:ring-primary/40 hfm-focus-ring")}>
                {body}
                <span className="sr-only"> — ver as pendências nesta situação</span>
              </a>
            );
          })()
        ) : (
          <div className={box}>{body}</div>
        )}
      </td>
    );
  };
  return (
    <div className="min-w-0 overflow-x-auto" data-testid={testId}>
      <table className="w-full min-w-[20rem] table-fixed border-separate border-spacing-1.5">
        <caption className="sr-only">Pneus em uso por prazo de calibragem e situação do PSI</caption>
        <thead>
          <tr>
            <td className="w-[24%]" />
            <th scope="col" className="px-1 text-left text-caption font-semibold text-fg-secondary">PSI dentro da faixa</th>
            <th scope="col" className="px-1 text-left text-caption font-semibold text-fg-secondary">PSI inadequado</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" className="px-1 text-left align-middle text-caption font-semibold text-fg-secondary">Prazo OK</th>
            {cell("conforme")}
            {cell("prazo_ok_psi_inadequado", "Não é saudável: conta como não conforme.")}
          </tr>
          <tr>
            <th scope="row" className="px-1 text-left align-middle text-caption font-semibold text-fg-secondary">Prazo fora</th>
            {cell("psi_ok_prazo_vencido")}
            {cell("prazo_e_psi")}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
