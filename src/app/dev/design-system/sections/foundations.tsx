"use client";

import * as React from "react";
import { Specimen } from "../design-system-view";
import { chartSeries } from "@/design-system/tokens/chart";
import { spacingScale } from "@/design-system/tokens";

const brand = [
  { token: "--brand-blue", label: "Azul Horizonte", swatch: "bg-brand-blue" },
  { token: "--brand-cyan", label: "Ciano", swatch: "bg-brand-cyan" },
  { token: "--brand-gold", label: "Dourado", swatch: "bg-brand-gold" },
  { token: "--brand-navy", label: "Navy", swatch: "bg-brand-navy" },
];

const surfaces = [
  { token: "--background", label: "background", swatch: "bg-background" },
  { token: "--surface", label: "surface", swatch: "bg-surface" },
  { token: "--surface-secondary", label: "surface secondary", swatch: "bg-surface-secondary" },
  { token: "--surface-tertiary", label: "surface tertiary", swatch: "bg-surface-tertiary" },
  { token: "--surface-elevated", label: "surface elevated", swatch: "bg-surface-elevated" },
  { token: "--surface-sidebar", label: "surface sidebar", swatch: "bg-surface-sidebar" },
];

const semantic = [
  { label: "primary", solid: "bg-primary text-primary-fg", soft: "bg-primary-soft text-primary-soft-fg" },
  { label: "accent", solid: "bg-accent text-accent-fg", soft: "bg-accent-soft text-accent-soft-fg" },
  { label: "highlight", solid: "bg-highlight text-highlight-fg", soft: "bg-highlight-soft text-highlight-soft-fg" },
  { label: "success", solid: "bg-success text-success-fg", soft: "bg-success-soft text-success-soft-fg" },
  { label: "warning", solid: "bg-warning text-warning-fg", soft: "bg-warning-soft text-warning-soft-fg" },
  { label: "danger", solid: "bg-danger text-danger-fg", soft: "bg-danger-soft text-danger-soft-fg" },
  { label: "info", solid: "bg-info text-info-fg", soft: "bg-info-soft text-info-soft-fg" },
  { label: "neutral", solid: "bg-neutral text-neutral-fg", soft: "bg-neutral-soft text-neutral-soft-fg" },
];

const typeScale = [
  { cls: "text-display", label: "Display · 28/34" },
  { cls: "text-h1", label: "H1 · 22/28" },
  { cls: "text-h2", label: "H2 · 18/24" },
  { cls: "text-h3", label: "H3 · 16/22" },
  { cls: "text-h4", label: "H4 · 14/20" },
  { cls: "text-body", label: "Body · 14/20" },
  { cls: "text-body-sm", label: "Body small · 13/18" },
  { cls: "text-label", label: "Label · 13/16" },
  { cls: "text-caption", label: "Caption · 12/16" },
];

const radii = ["rounded-xs", "rounded-sm", "rounded-md", "rounded-lg", "rounded-xl"];
const shadows = ["shadow-xs", "shadow-sm", "shadow-md", "shadow-lg"];

function Swatch({ swatch, label, token }: { swatch: string; label: string; token: string }) {
  return (
    <div className="w-40">
      <div className={`h-12 rounded-sm border border-border ${swatch}`} />
      <p className="mt-1.5 text-body-sm font-medium text-fg">{label}</p>
      <p className="font-mono text-caption text-fg-muted">{token}</p>
    </div>
  );
}

export function FoundationsSection() {
  return (
    <div className="flex flex-col gap-8">
      <Specimen title="Marca" description="Cores fixas derivadas da logo oficial. Não variam entre temas.">
        {brand.map((c) => (
          <Swatch key={c.token} {...c} />
        ))}
      </Specimen>

      <Specimen title="Superfícies" description="Hierarquia de fundo. Cada nível é perceptivelmente distinto nos dois temas.">
        {surfaces.map((c) => (
          <Swatch key={c.token} {...c} />
        ))}
      </Specimen>

      <Specimen title="Semântica" description="Sólido para ação e ênfase; suave para estados e rótulos.">
        <div className="grid w-full gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {semantic.map((c) => (
            <div key={c.label} className="overflow-hidden rounded-sm border border-border">
              <div className={`flex h-10 items-center px-3 text-body-sm font-medium ${c.solid}`}>{c.label}</div>
              <div className={`flex h-9 items-center px-3 text-body-sm ${c.soft}`}>{c.label} soft</div>
            </div>
          ))}
        </div>
      </Specimen>

      <Specimen
        title="Texto"
        description="Quatro níveis de ênfase sobre a superfície padrão."
        className="flex flex-col gap-1"
      >
        {/* token documentation: the disabled sample is meant to be low-contrast */}
        <p className="text-body text-fg">text-fg · conteúdo principal</p>
        <p className="text-body text-fg-secondary">text-fg-secondary · apoio</p>
        <p className="text-body text-fg-muted">text-fg-muted · metadados</p>
        <p data-token-specimen className="text-body text-fg-disabled">
          text-fg-disabled · indisponível
        </p>
        <p className="text-body text-link">text-link · navegação</p>
      </Specimen>

      <Specimen title="Tipografia" description="Montserrat. Escala densa para telas operacionais (base 14px)." className="flex flex-col gap-2">
        {typeScale.map((t) => (
          <div key={t.cls} className="flex items-baseline gap-4 border-b border-border-subtle pb-2">
            <span className={`${t.cls} font-semibold text-fg`}>Gestão de frota</span>
            <span className="ml-auto font-mono text-caption text-fg-muted">{t.label}</span>
          </div>
        ))}
      </Specimen>

      <Specimen title="Raio" description="Moderado. Nada de cápsulas em contêineres.">
        {radii.map((r) => (
          <div key={r} className="w-28 text-center">
            <div className={`h-14 border border-border-strong bg-surface-secondary ${r}`} />
            <p className="mt-1.5 font-mono text-caption text-fg-muted">{r}</p>
          </div>
        ))}
      </Specimen>

      <Specimen title="Elevação" description="Discreta e reservada a camadas realmente flutuantes.">
        {shadows.map((s) => (
          <div key={s} className="w-28 text-center">
            <div className={`h-14 rounded-sm bg-surface ${s}`} />
            <p className="mt-1.5 font-mono text-caption text-fg-muted">{s}</p>
          </div>
        ))}
      </Specimen>

      <Specimen title="Espaçamento" description="Escala de 4 a 64px." className="flex flex-wrap items-end gap-3">
        {spacingScale.map((s) => (
          <div key={s} className="text-center">
            <div className="bg-primary-soft" style={{ width: s, height: s }} />
            <p className="mt-1.5 font-mono text-caption text-fg-muted">{s}</p>
          </div>
        ))}
      </Specimen>

      <Specimen title="Gráficos" description="Paleta ordenada, legível nos dois temas." className="flex flex-col gap-3">
        <div className="flex h-28 items-end gap-2 rounded-md border border-border bg-surface p-3">
          {chartSeries.map((color, i) => (
            <div key={color} className="flex-1 rounded-t-xs" style={{ background: color, height: `${40 + i * 7}%` }} />
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          {chartSeries.map((color, i) => (
            <span key={color} className="flex items-center gap-1.5 text-caption text-fg-secondary">
              <span className="size-2.5 rounded-full" style={{ background: color }} />
              chart-{i + 1}
            </span>
          ))}
        </div>
      </Specimen>
    </div>
  );
}
