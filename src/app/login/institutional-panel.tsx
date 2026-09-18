"use client";

import { BrandBackground } from "@/components/brand/brand-background";

/**
 * The institutional column: the official photograph, with as little on top of
 * it as the screen can get away with.
 *
 * The artwork already carries its own capability rail — "Monitoramento em tempo
 * real", "Rota inteligente", "Segurança e confiabilidade" — printed into the
 * image. Repeating those exact phrases in an overlay, as this panel used to,
 * read as a duplication rather than as a message, so the overlay now says the
 * one thing the picture does not: the product's name and what it is for.
 *
 * The scrim is built from `--background`, which flips with the theme, so the
 * same gradient reads correctly against both official files without either
 * being edited. It only touches the lower third — the vehicles and the rail
 * stay untouched.
 */
export function InstitutionalPanel() {
  return (
    <section aria-label="Horizonte Fleet Management" className="relative hidden overflow-hidden lg:block">
      {/* Anchored right: the scene's left third is empty studio floor, and the
          capability rail at its right edge is the part worth keeping when the
          column is narrower than the photograph. */}
      <BrandBackground
        scrim="none"
        position="right center"
        sizes="(max-width: 1024px) 0px, (max-width: 1280px) 65vw, 75vw"
        quality={90}
      />

      <div
        aria-hidden
        className="absolute inset-0 bg-linear-to-t from-background/92 via-background/45 to-transparent"
      />

      <div className="absolute inset-0 flex flex-col justify-between px-10 pt-9 pb-[12vh] xl:px-16 xl:pt-12">
        <p className="flex items-center gap-2.5 text-caption font-semibold tracking-[0.22em] text-fg-secondary uppercase">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-highlight opacity-70 motion-reduce:hidden" />
            <span className="relative inline-flex size-1.5 rounded-full bg-highlight" />
          </span>
          Central operacional · Online
        </p>

        <div className="max-w-xl">
          <p className="text-overline font-semibold tracking-[0.18em] text-highlight-soft-fg uppercase">
            Horizonte Fleet Management
          </p>
          <h2 className="mt-3 max-w-[18ch] text-display font-semibold text-fg">
            Gestão inteligente da frota, da operação ao{" "}
            <span className="text-highlight-soft-fg">resultado</span>.
          </h2>
        </div>
      </div>
    </section>
  );
}
