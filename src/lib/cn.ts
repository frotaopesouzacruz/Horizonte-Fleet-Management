import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The product uses a named typographic scale (`text-body`, `text-h1`, …) instead
 * of Tailwind's t-shirt sizes. tailwind-merge cannot know that, so by default it
 * files `text-body` under `text-color` — where it collides with `text-fg`,
 * `text-primary-fg` and friends, and silently drops whichever comes first.
 *
 * Teaching it the real scale keeps size and colour in separate conflict groups,
 * so `cn("text-primary-fg", "text-body")` keeps both.
 */
const FONT_SIZES = [
  "display",
  "h1",
  "h2",
  "h3",
  "h4",
  "body",
  "body-sm",
  "label",
  "caption",
  "helper",
  // Faltava aqui, e o efeito não era cosmético: em `cn("text-overline", …,
  // "text-fg-muted")` o merge classificava `text-overline` como cor, descartava
  // a classe e os rótulos de grupo da Sidebar renderizavam em 16px — não nos
  // 11px do token. Todo nome da escala precisa estar nesta lista.
  "overline",
] as const;

const twMerge = extendTailwindMerge({
  override: {
    classGroups: {
      "font-size": [{ text: [...FONT_SIZES] }],
    },
  },
});

/** Merges class names with Tailwind-aware conflict resolution. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
