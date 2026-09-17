"use client";

import * as React from "react";
import { useTheme } from "@/design-system/theme/theme-provider";
import { brandAssets, type BrandVariant } from "./brand-logo";
import { cn } from "@/lib/cn";

export interface BrandBackgroundProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: BrandVariant;
  /**
   * Scrim strength over the photo so foreground text stays legible.
   * none: raw image · soft: light gradient · strong: solid-ish veil.
   */
  scrim?: "none" | "soft" | "strong";
  /** Focal point of the photo (object-position). */
  position?: string;
  /** Load eagerly (login) or lazily (secondary institutional areas). */
  priority?: boolean;
}

/**
 * BrandBackground — the official fleet photograph for login, onboarding and
 * institutional areas only. Never behind tables, forms, grids or dashboards.
 * Fills its positioned parent (`relative` container required).
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
  const mode: "light" | "dark" | undefined = variant === "auto" ? (mounted ? resolved : undefined) : variant;
  const src = mode === "dark" ? brandAssets.backgroundDark : mode === "light" ? brandAssets.backgroundLight : null;

  return (
    <div className={cn("absolute inset-0 overflow-hidden bg-surface-secondary", className)} aria-hidden {...props}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- full-bleed cover image, ratio preserved via object-fit
        <img
          key={src}
          src={src}
          alt=""
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          className="absolute inset-0 size-full object-cover"
          style={{ objectPosition: position }}
          draggable={false}
        />
      ) : null}
      {scrim !== "none" ? (
        <div
          className={cn(
            "absolute inset-0",
            scrim === "soft" && "bg-linear-to-t from-background/70 via-background/20 to-transparent",
            scrim === "strong" && "bg-background/72",
          )}
        />
      ) : null}
      {children}
    </div>
  );
}
