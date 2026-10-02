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
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        // Scrolls sideways instead of pushing the page: four tabs at 390px are
        // wider than the viewport, and a page that scrolls horizontally because
        // of its own tab bar is a page nobody can read on a phone.
        // `shrink-0`: dentro de uma coluna flex (gaveta com corpo rolável), a lista
        // de abas não pode encolher até 1px e deixar os botões fora da área clicável.
        "flex shrink-0 items-center overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        appearance === "underline" && "gap-0.5 border-b border-border",
        appearance === "segmented" &&
          "inline-flex w-fit gap-0.5 rounded-md border border-border-subtle bg-surface-interactive p-0.5",
        appearance === "container" &&
          "inline-flex w-fit max-w-full gap-1 rounded-lg border border-border-subtle bg-surface-interactive p-1",
        className,
      )}
      {...props}
    />
  );
});

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
