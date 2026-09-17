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
  /** Load eagerly (login) or lazily (secondary institutional areas). */
  priority?: boolean;
}

/**
 * BrandBackground — the official fleet photograph, for login, onboarding and
 * institutional areas only. Never behind tables, forms, grids or dashboards.
 * Fills its positioned parent, so the parent needs `relative`.
 *
 * The image goes through next/image, which serves AVIF/WebP at the right size:
 * the official PNGs are ~2 MB and must not be shipped as-is. The originals stay
 * untouched in `public/brand/`.
 *
 * While the official file is absent, it degrades to a brand-tinted surface
 * instead of a broken image. That surface is a placeholder, not the artwork.
 */
export function BrandBackground({
  variant = "auto",
  scrim = "soft",
  position = "center",
  priority = false,
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
          priority={priority}
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
