"use client";

import * as React from "react";
import Image from "next/image";
import { useTheme } from "@/design-system/theme/theme-provider";
import { cn } from "@/lib/cn";

/**
 * Official Horizonte assets, stored untouched in `public/brand/`. They are never
 * redrawn, cropped, recolored or regenerated — this module only decides which
 * file to show and at what size.
 */
export const brandAssets = {
  logoLight: "/brand/logo-light.png",
  logoDark: "/brand/logo-dark.png",
  symbolLight: "/brand/symbol-light.png",
  symbolDark: "/brand/symbol-dark.png",
  backgroundLight: "/brand/background-light.webp",
  backgroundDark: "/brand/background-dark.webp",
} as const;

/**
 * Intrinsic ratio of the official lockup (1920 × 1041). It is a stacked
 * composition — symbol, `HORIZONTE`, `Logística` — so the width follows the
 * height and the image is never cropped to isolate a part of it.
 *
 * Practical floor: the wordmark band is ~23% of the total height, so anything
 * below ~32px tall turns the words into texture. Callers size accordingly.
 */
export const LOGO_RATIO = 1920 / 1041;

/**
 * Ratio of the symbol alone (1364 × 488), cut from the top band of the same
 * lockup by `scripts/brand-icons.mjs`. Nothing is redrawn — the wordmark is
 * simply not in the crop, because a rail 68px wide cannot show it and shrinking
 * the whole lockup to fit turns `HORIZONTE` into three grey pixels.
 */
export const SYMBOL_RATIO = 1364 / 488;

export type BrandVariant = "auto" | "light" | "dark";

export interface BrandLogoProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  /** `auto` picks the file that matches the active theme. */
  variant?: BrandVariant;
  /** Space-constrained placement (collapsed rail): only changes the text fallback. */
  compact?: boolean;
  /** Rendered height in px; the width follows the official ratio. */
  height?: number;
  /** Accessible name. Empty string makes it decorative. */
  alt?: string;
}

/**
 * BrandLogo — the only place that decides which logo file to show.
 *
 * Renders nothing theme-dependent until mounted (avoids flashing the wrong
 * asset), and goes through next/image at quality 100 so the 140 KB original is
 * served as a right-sized, visually lossless WebP without touching the file.
 * No `priority`: the element only exists after hydration, so a preload could
 * never run ahead of the fetch it duplicates — it just leaves an unconsumed
 * request open in the browser.
 * If the asset is missing it degrades to a plain wordmark so layouts stay
 * measurable; that fallback is not a logo and must not ship.
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
  const h = height ?? (compact ? 26 : 38);
  const w = Math.round(h * LOGO_RATIO);

  if (variant === "auto" && !mounted) {
    // reserve the exact footprint, avoid flashing the wrong asset
    return <span aria-hidden className={cn("inline-block", className)} style={{ height: h, width: w }} />;
  }

  if (failed) {
    return (
      <span
        role="img"
        aria-label={alt}
        className={cn("inline-flex items-center gap-1 font-semibold tracking-tight text-fg", className)}
        style={{ height: h, fontSize: Math.round(h * 0.42) }}
        {...props}
      >
        {compact ? "H" : "Horizonte"}
        {!compact && <span className="font-medium text-fg-secondary">Fleet Management</span>}
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center", className)} style={{ height: h }} {...props}>
      <Image
        key={src}
        src={src}
        alt={alt}
        width={w}
        height={h}
        quality={100}
        draggable={false}
        onError={() => setFailed(true)}
        className="block h-full w-auto select-none"
      />
    </span>
  );
}

/**
 * BrandSymbol — the mark without the wordmark.
 *
 * For the collapsed rail and anywhere else too narrow for the lockup. Picks the
 * variant that matches the theme, exactly as BrandLogo does: the dark file is
 * the official one where the navy elements are white, so the mark stays legible
 * on a navy surface instead of disappearing into it.
 */
export interface BrandSymbolProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  variant?: BrandVariant;
  /** Rendered height in px; the width follows the official ratio. */
  height?: number;
  alt?: string;
}

export function BrandSymbol({
  variant = "auto",
  height = 26,
  alt = "Horizonte",
  className,
  ...props
}: BrandSymbolProps) {
  const { resolved, mounted } = useTheme();
  const [failed, setFailed] = React.useState(false);

  const mode: "light" | "dark" | undefined = variant === "auto" ? resolved : variant;
  const src = mode === "dark" ? brandAssets.symbolDark : brandAssets.symbolLight;
  const w = Math.round(height * SYMBOL_RATIO);

  if (variant === "auto" && !mounted) {
    return <span aria-hidden className={cn("inline-block", className)} style={{ height, width: w }} />;
  }

  if (failed) {
    return (
      <span
        role="img"
        aria-label={alt}
        className={cn("inline-flex items-center justify-center font-semibold text-fg", className)}
        style={{ height, width: height, fontSize: Math.round(height * 0.7) }}
        {...props}
      >
        H
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center", className)} style={{ height }} {...props}>
      <Image
        key={src}
        src={src}
        alt={alt}
        width={w}
        height={height}
        quality={100}
        draggable={false}
        onError={() => setFailed(true)}
        className="block h-full w-auto select-none"
      />
    </span>
  );
}
