"use client";

import * as React from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";

export type ToastVariant = "neutral" | "success" | "warning" | "danger" | "info";

export interface ToastOptions {
  title: string;
  description?: React.ReactNode;
  variant?: ToastVariant;
  /** ms; defaults to 5000 (danger toasts stay 8000) */
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastItem extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

const icons: Record<ToastVariant, React.ElementType> = {
  neutral: Info,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
};

const accent: Record<ToastVariant, string> = {
  neutral: "text-fg-secondary",
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const counter = React.useRef(0);

  const dismiss = React.useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback((options: ToastOptions) => {
    const id = ++counter.current;
    setItems((prev) => [...prev.slice(-4), { ...options, id }]);
    return id;
  }, []);

  const value = React.useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="right" label="Notificações">
        {children}
        {items.map((item) => {
          const variant = item.variant ?? "neutral";
          const Icon = icons[variant];
          return (
            <ToastPrimitive.Root
              key={item.id}
              duration={item.duration ?? (variant === "danger" ? 8000 : 5000)}
              onOpenChange={(open) => !open && dismiss(item.id)}
              className={cn(
                "group pointer-events-auto relative flex w-full items-start gap-3 rounded-md border border-border bg-surface-elevated p-3 pr-9 text-body shadow-lg",
                "data-[state=open]:animate-toast-in data-[state=closed]:animate-toast-out",
                "data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x) data-[swipe=end]:animate-toast-out",
              )}
            >
              <Icon className={cn("mt-0.5 size-4 shrink-0", accent[variant])} aria-hidden />
              <div className="min-w-0 flex-1">
                <ToastPrimitive.Title className="font-semibold text-fg">{item.title}</ToastPrimitive.Title>
                {item.description ? (
                  <ToastPrimitive.Description className="mt-0.5 text-body-sm text-fg-secondary">
                    {item.description}
                  </ToastPrimitive.Description>
                ) : null}
                {item.action ? (
                  <ToastPrimitive.Action asChild altText={item.action.label}>
                    <button
                      type="button"
                      onClick={item.action.onClick}
                      className="mt-2 text-body-sm font-medium text-link hover:text-link-hover hover:underline hfm-focus-ring rounded-xs"
                    >
                      {item.action.label}
                    </button>
                  </ToastPrimitive.Action>
                ) : null}
              </div>
              <ToastPrimitive.Close
                aria-label="Fechar notificação"
                className="absolute top-2 right-2 rounded-xs p-1 text-fg-muted hover:bg-secondary hover:text-fg hfm-focus-ring"
              >
                <X className="size-3.5" aria-hidden />
              </ToastPrimitive.Close>
            </ToastPrimitive.Root>
          );
        })}
        <ToastPrimitive.Viewport className="fixed right-4 bottom-4 z-(--z-toast) flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
