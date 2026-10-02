"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/cn";

/**
 * Tabs — três aparências (UI 2.0):
 *  - underline (padrão): telas de um módulo, logo abaixo do título;
 *  - segmented: alternâncias compactas (visões, períodos) — trilho tonal com o
 *    segmento ativo elevado, como os controles selecionados;
 *  - container: sub-abas dentro de um card ou painel (trilho de nível 2).
 */
type TabsAppearance = "underline" | "segmented" | "container";
const TabsAppearanceContext = React.createContext<TabsAppearance>("underline");

export interface TabsProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root> {
  appearance?: TabsAppearance;
}

export const Tabs = React.forwardRef<React.ComponentRef<typeof TabsPrimitive.Root>, TabsProps>(function Tabs(
  { appearance = "underline", className, ...props },
  ref,
) {
  return (
    <TabsAppearanceContext.Provider value={appearance}>
      <TabsPrimitive.Root ref={ref} className={cn("flex flex-col gap-3", className)} {...props} />
    </TabsAppearanceContext.Provider>
  );
});

export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, ...props }, ref) {
  const appearance = React.useContext(TabsAppearanceContext);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const [edge, setEdge] = React.useState({ start: false, end: false });

  const setRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      listRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  // Quando as abas não cabem (10 abas do KM a 1366px), as bordas esmaecem e
  // aparecem setas — a rolagem lateral deixa de ser invisível. O
  // ResizeObserver já notifica ao começar a observar, então o estado inicial
  // chega sem setState síncrono no efeito.
  React.useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const update = () => {
      const start = el.scrollLeft > 2;
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      setEdge((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    };
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // A aba ativa vinda da URL (ex.: Relatórios) entra na área visível.
    const active = el.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
    if (active && el.scrollWidth > el.clientWidth) {
      el.scrollLeft = Math.max(0, active.offsetLeft - el.clientWidth / 2 + active.offsetWidth / 2);
    }
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  const scrollBy = (dir: -1 | 1) => {
    const el = listRef.current;
    if (el) el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.6), behavior: "smooth" });
  };
  const fade = 36;
  const mask =
    edge.start || edge.end
      ? `linear-gradient(to right, ${edge.start ? `transparent 0, #000 ${fade}px` : "#000 0"}, ${
          edge.end ? `#000 calc(100% - ${fade}px), transparent 100%` : "#000 100%"
        })`
      : undefined;

  return (
    <div
      data-slot="tabs-list-frame"
      className={cn(
        "relative min-w-0 shrink-0",
        appearance === "underline" ? "w-full" : "inline-flex w-fit max-w-full",
        className,
      )}
    >
      <TabsPrimitive.List
        ref={setRefs}
        className={cn(
          // Scrolls sideways instead of pushing the page: four tabs at 390px are
          // wider than the viewport, and a page that scrolls horizontally because
          // of its own tab bar is a page nobody can read on a phone.
          // `shrink-0`: dentro de uma coluna flex (gaveta com corpo rolável), a lista
          // de abas não pode encolher até 1px e deixar os botões fora da área clicável.
          "flex min-w-0 shrink-0 items-center overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          appearance === "underline" && "gap-0.5 border-b border-border",
          appearance === "segmented" &&
            "inline-flex w-fit max-w-full gap-0.5 rounded-md border border-border-subtle bg-surface-interactive p-0.5",
          appearance === "container" &&
            "inline-flex w-fit max-w-full gap-1 rounded-lg border border-border-subtle bg-surface-interactive p-1",
        )}
        style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
        {...props}
      />
      {edge.start ? (
        <TabsScrollButton side="start" onClick={() => scrollBy(-1)} />
      ) : null}
      {edge.end ? <TabsScrollButton side="end" onClick={() => scrollBy(1)} /> : null}
    </div>
  );
});

/** Seta de rolagem das abas: só para ponteiro (o teclado já percorre as abas). */
function TabsScrollButton({ side, onClick }: { side: "start" | "end"; onClick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden
      onClick={onClick}
      className={cn(
        "absolute top-1/2 z-10 flex size-6 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface-raised text-fg-secondary shadow-sm hfm-transition hover:text-fg",
        side === "start" ? "left-0" : "right-0",
      )}
    >
      <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {side === "start" ? <path d="M10 3.5 5.5 8l4.5 4.5" /> : <path d="M6 3.5 10.5 8 6 12.5" />}
      </svg>
    </button>
  );
}

export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & { count?: number }
>(function TabsTrigger({ className, children, count, ...props }, ref) {
  const appearance = React.useContext(TabsAppearanceContext);
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap text-body-sm font-medium hfm-transition hfm-focus-ring",
        "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        appearance === "underline" && [
          "relative -mb-px h-10 rounded-t-md px-3 text-fg-secondary hover:bg-hover-overlay hover:text-fg",
          "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent after:transition-colors",
          "data-[state=active]:font-semibold data-[state=active]:text-primary-soft-fg data-[state=active]:after:bg-primary",
        ],
        appearance === "segmented" &&
          "h-7 rounded-sm px-3 text-fg-secondary hover:text-fg data-[state=active]:bg-surface-raised data-[state=active]:font-semibold data-[state=active]:text-fg data-[state=active]:shadow-selected",
        appearance === "container" &&
          "h-8 rounded-md px-3 text-fg-secondary hover:bg-hover-overlay hover:text-fg data-[state=active]:bg-surface-raised data-[state=active]:font-semibold data-[state=active]:text-primary-soft-fg data-[state=active]:shadow-selected",
        className,
      )}
      {...props}
    >
      {children}
      {typeof count === "number" ? (
        <span className="rounded-xs bg-secondary px-1.5 text-caption tabular-nums text-fg-secondary">{count}</span>
      ) : null}
    </TabsPrimitive.Trigger>
  );
});

export const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return <TabsPrimitive.Content ref={ref} className={cn("outline-none", className)} {...props} />;
});
