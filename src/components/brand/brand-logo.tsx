"use client";

import * as React from "react";
import { useTheme } from "@/design-system/theme/theme-provider";
import { cn } from "@/lib/cn";

/**
 * Official Horizonte assets. The PNG files are the source of truth and are never
 * redrawn, cropped or recolored. Place the originals at:
 *   public/brand/logo-light.png       (Logo Tema Claro)
 *   public/brand/logo-dark.png        (Logo Tema Escuro)
 */
export const brandAssets = {
  logoLight: "/brand/logo-light.png",
  logoDark: "/brand/logo-dark.png",
  backgroundLight: "/brand/background-light.png",
  backgroundDark: "/brand/background-dark.png",
} as const;

export type BrandVariant = "auto" | "light" | "dark";

export interface BrandLogoProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  /** `auto` picks the logo that matches the active theme. */
  variant?: BrandVariant;
  /** Compact renders a small square mark (for the collapsed sidebar). */
  compact?: boolean;
  /** Rendered height in px; width follows the image's intrinsic aspect ratio. */
  height?: number;
  /** Accessible name. Empty string makes it decorative. */
  alt?: string;
}

/**
 * BrandLogo — the only place that decides which logo file to show.
 * Renders nothing theme-dependent until mounted (avoids a wrong-theme flash);
 * while the official PNG is unavailable it falls back to a plain wordmark so
 * layouts stay measurable. The fallback is not a logo and must not ship.
 */
export function BrandLogo({
  variant = "auto",
  compact = false,
  height,
  alt = "Horizonte Fleet Management",
  className,
  ...props
}: BrandLogoProps) {
  const { resolved, mounted } = useTheme();
  const [failed, setFailed] = React.useState(false);

  const mode: "light" | "dark" | undefined = variant === "auto" ? resolved : variant;
  const src = mode === "dark" ? brandAssets.logoDark : brandAssets.logoLight;
  const h = height ?? (compact ? 28 : 32);

  if (variant === "auto" && !mounted) {
    // reserve space, avoid flashing the wrong asset
    return <span aria-hidden className={cn("inline-block", className)} style={{ height: h, width: compact ? h : h * 3.2 }} />;
  }

  if (failed) {
    return (
      <span
        role="img"
        aria-label={alt}
        className={cn("inline-flex items-center gap-1 font-semibold tracking-tight text-fg", className)}
        style={{ height: h, fontSize: Math.round(h * 0.5) }}
        {...props}
      >
        {compact ? "H" : "Horizonte"}
        {!compact && <span className="font-medium text-fg-secondary">Fleet Management</span>}
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center", compact && "justify-center", className)} style={{ height: h }} {...props}>
      {/* eslint-disable-next-line @next/next/no-img-element -- intrinsic ratio must be preserved; no crop, no resize logic */}
      <img
        key={src}
        src={src}
        alt={alt}
        height={h}
        style={{ height: h, width: "auto", maxWidth: compact ? h * 1.4 : undefined, objectFit: "contain" }}
        className={cn("block select-none", compact && "object-left")}
        draggable={false}
        onError={() => setFailed(true)}
      />
    </span>
  );
}
