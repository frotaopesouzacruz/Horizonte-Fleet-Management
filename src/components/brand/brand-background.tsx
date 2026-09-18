"use client";

import * as React from "react";
import Image from "next/image";
import { useTheme } from "@/design-system/theme/theme-provider";
import { brandAssets, type BrandVariant } from "./brand-logo";
import { cn } from "@/lib/cn";

export interface BrandBackgroundProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: BrandVariant;
  /**
   * Scrim strength over the photograph so foreground text stays legible.
   * none: raw image · soft: light gradient from the bottom · strong: solid veil.
   */
  scrim?: "none" | "soft" | "strong";
  /** Focal point of the photograph (object-position). */
  position?: string;
}

/**
 * BrandBackground — the official fleet photograph, for login, onboarding and
 * institutional areas only. Never behind tables, forms, grids or dashboards.
 * Fills its positioned parent, so the parent needs `relative`.
 *
 * The image goes through next/image, which serves AVIF/WebP at the right size:
 * the official files are 1672 × 941 and ~200 KB, too heavy to ship as-is for a
 * panel that rarely needs more than half that. The originals stay untouched in
 * `public/brand/`.
 *
 * The artwork is a composed scene with its own baked-in captions, so it is
 * decorative here and carries no foreground copy of ours. If the file is
 * missing it degrades to a brand-tinted surface, which is a placeholder, not
 * the artwork.
 *
 * No `priority`: the element only exists after hydration (the theme decides the
 * file), so a preload could never run ahead of the fetch it duplicates — it just
 * leaves an unconsumed request open in the browser.
 */
export function BrandBackground({
  variant = "auto",
  scrim = "soft",
  position = "center",
  className,
  children,
  ...props
}: BrandBackgroundProps) {
  const { resolved, mounted } = useTheme();
  const [failed, setFailed] = React.useState(false);

  const mode: "light" | "dark" | undefined = variant === "auto" ? (mounted ? resolved : undefined) : variant;
  const src = mode === "dark" ? brandAssets.backgroundDark : mode === "light" ? brandAssets.backgroundLight : null;

  return (
    <div className={cn("absolute inset-0 overflow-hidden bg-surface-secondary", className)} {...props}>
      {src && !failed ? (
        <Image
          key={src}
          src={src}
          alt=""
          fill
          sizes="(max-width: 1024px) 100vw, 55vw"
          style={{ objectFit: "cover", objectPosition: position }}
          onError={() => setFailed(true)}
          aria-hidden
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-linear-to-br from-primary-soft via-surface-secondary to-accent-soft" />
      )}

      {scrim !== "none" && !failed ? (
        <div
          aria-hidden
          className={cn(
            "absolute inset-0",
            scrim === "soft" && "bg-linear-to-t from-background/75 via-background/25 to-transparent",
            scrim === "strong" && "bg-background/72",
          )}
        />
      ) : null}

      {children}
    </div>
  );
}
