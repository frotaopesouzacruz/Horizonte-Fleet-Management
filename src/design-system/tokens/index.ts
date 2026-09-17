export * from "./chart";

/** Spacing scale (px) used across the product. Tailwind spacing utilities map 1 unit = 4px. */
export const spacingScale = [4, 8, 12, 16, 20, 24, 32, 40, 48, 64] as const;

/** Radius scale (px). */
export const radiusScale = { xs: 4, sm: 6, md: 8, lg: 10, xl: 12 } as const;

/** Breakpoints (px) — mirror the Tailwind defaults used in layout components. */
export const breakpoints = { tablet: 768, notebook: 1024, desktop: 1440 } as const;
