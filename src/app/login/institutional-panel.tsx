"use client";

import * as React from "react";
import { Zap } from "lucide-react";
import { BrandBackground } from "@/components/brand/brand-background";

/**
 * Headlines and supporting copy come from the customer's own artwork and
 * reference screen — nothing here is invented product marketing.
 */
const HEADLINES = [
  { lead: "Monitoramento em Tempo", accent: "Real" },
  { lead: "Gestão Inteligente de", accent: "Frotas" },
  { lead: "Rota", accent: "Inteligente" },
  { lead: "Segurança e", accent: "Confiabilidade" },
];

const SUMMARY =
  "Monitoramento em tempo real, governança operacional e inteligência logística em um único ecossistema digital de alta performance.";

const ROTATION_MS = 6000;

/**
 * The institutional column: the official photograph with a caption layer.
 *
 * The photograph already carries the capability rail along its right edge, so
 * the overlay is kept to the left half and the scrim only darkens (or, in the
 * light theme, lightens) the bottom — enough to carry text over the studio
 * floor without touching the vehicles or the rail.
 *
 * The scrim is built from `--background`, which flips with the theme, so the
 * same gradient reads correctly against both official files without either
 * being edited.
 */
export function InstitutionalPanel() {
  const [index, setIndex] = React.useState(0);
  const [paused, setPaused] = React.useState(false);

  React.useEffect(() => {
    if (paused) return;
    // Auto-advancing content that cannot be stopped fails WCAG 2.2.2, and
    // someone who asked the system for less motion did not ask for a carousel.
    // Hover, focus and the OS preference each hold it still; the dots below
    // remain the manual way through.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setIndex((current) => (current + 1) % HEADLINES.length), ROTATION_MS);
    return () => window.clearInterval(id);
  }, [paused]);

  const headline = HEADLINES[index];

  return (
    <section
      aria-label="Horizonte Fleet Management"
      className="relative hidden overflow-hidden lg:block"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      {/* Anchored right: the scene's left third is empty studio floor, and the
          capability rail at its right edge is the part worth keeping when the
          column is narrower than the photograph. */}
      <BrandBackground scrim="none" position="right center" />

      <div
        aria-hidden
        className="absolute inset-0 bg-linear-to-t from-background/90 via-background/55 to-background/38"
      />

      <div className="absolute inset-0 flex flex-col justify-between px-8 pt-8 pb-[14vh] xl:px-12 xl:pt-10">
        <p className="flex items-center gap-2.5 text-caption font-semibold uppercase tracking-[0.22em] text-fg-secondary">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-highlight opacity-70 motion-reduce:hidden" />
            <span className="relative inline-flex size-1.5 rounded-full bg-highlight" />
          </span>
          Central operacional · Online
        </p>

        <div className="max-w-lg">
          <p className="inline-flex items-center gap-1.5 rounded-full border border-highlight/60 px-3 py-1 text-caption font-semibold uppercase tracking-[0.16em] text-highlight-soft-fg">
            <Zap className="size-3.5" aria-hidden />
            Plataforma Enterprise
          </p>

          {/* aria-live: the headline changes on its own, so a screen reader is
              told politely rather than left reading a stale line. */}
          <h2 aria-live="polite" className="mt-4 max-w-[15ch] text-display font-semibold leading-[1.06] text-fg">
            {headline.lead} <span className="text-highlight-soft-fg">{headline.accent}</span>
          </h2>

          <p className="mt-4 max-w-[38ch] text-body-sm text-fg-secondary">{SUMMARY}</p>

          <div className="mt-6 flex items-center gap-1.5">
            {HEADLINES.map((item, position) => (
              <button
                key={item.accent}
                type="button"
                onClick={() => setIndex(position)}
                aria-current={position === index}
                aria-label={item.lead + " " + item.accent}
                className={
                  "h-[3px] rounded-full hfm-transition hfm-focus-ring " +
                  (position === index ? "w-8 bg-highlight" : "w-5 bg-fg-muted/45 hover:bg-fg-muted/75")
                }
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
