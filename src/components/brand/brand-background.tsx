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
  /**
   * Viewport-relative width of the element, for next/image's srcset choice.
   * Getting this wrong is invisible in code and obvious on screen: it decides
   * which variant is downloaded, and a variant narrower than the box is
   * upscaled by the browser.
   */
  sizes?: string;
  /** JPEG/WebP quality. 90 for hero surfaces; the default 75 is for thumbnails. */
  quality?: number;
}

/**
 * BrandBackground — the official fleet photograph, for login, onboarding and
 * institutional areas only. Never behind tables, forms, grids or dashboards.
 * Fills its positioned parent, so the parent needs `relative`.
 *
 * The image goes through next/image, which serves WebP at the right size. The
 * official files are 1672 × 941 — that is the ceiling, and it is low enough that
 * nothing here may waste any of it. `sizes` must describe the real width of the
 * element: when it claimed 55vw for a column that renders at 72vw, the browser
 * downloaded the 1080-wide variant and stretched it to 1919, which is exactly
 * what "a imagem está borrada" looks like. The originals stay untouched in
 * `public/brand/`.
 *
 * The artwork is a composed scene with its own baked-in captions, so it is
 * decorative here and carries no foreground copy of ours. If the file is
 * missing it degrades to a brand-tinted surface, which is a placeholder, not
 * the artwork.
 */
export function BrandBackground({
  variant = "auto",
  scrim = "soft",
  position = "center",
  sizes = "(max-width: 1024px) 100vw, 75vw",
  quality = 90,
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
          sizes={sizes}
          quality={quality}
          // Above the fold and the largest thing on the screen. The element only
          // exists once the theme is known, so `priority` could not preload it,
          // but the browser can still be told not to queue it behind anything.
          fetchPriority="high"
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
