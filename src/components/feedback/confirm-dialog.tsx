"use client";

import * as React from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

/**
 * ConfirmDialog — the single "are you sure?" of the product, built on Radix
 * AlertDialog so focus is trapped, Escape cancels and the description is read
 * with the title. Use it only for actions that are hard to undo; everything
 * reversible should just happen and offer an undo toast.
 *
 * `onConfirm` may return a promise: the dialog keeps itself open and the
 * confirm button busy until it settles, and closes only on success. A rejection
 * leaves the dialog open and propagates — handle it in `onConfirm` (e.g. with a
 * danger toast) if the operator should see why.
 */

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  /** What exactly will happen, in operational terms. */
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button as `danger` and shows the warning icon. */
  destructive?: boolean;
  /** Externally controlled busy state, merged with the promise returned by `onConfirm`. */
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  /** Overrides the icon square. Pass `null` to drop it. */
  icon?: React.ReactNode | null;
  /** Extra content between the description and the footer (a reason field, a summary). */
  children?: React.ReactNode;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  destructive = false,
  loading = false,
  onConfirm,
  icon,
  children,
}: ConfirmDialogProps) {
  const [pending, setPending] = React.useState(false);
  const alive = React.useRef(true);

  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const busy = loading || pending;
  const showIcon = icon !== null && (icon != null || destructive);

  const handleConfirm = (event: React.MouseEvent<HTMLButtonElement>) => {
    // Radix closes on click by default; keep it open until onConfirm settles.
    event.preventDefault();
    if (busy) return;
    setPending(true);
    void Promise.resolve()
      .then(() => onConfirm())
      .then(
        () => {
          if (!alive.current) return;
          setPending(false);
          onOpenChange(false);
        },
        (error: unknown) => {
          if (alive.current) setPending(false);
          throw error;
        },
      );
  };

  return (
    <AlertDialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (busy && !next) return;
        onOpenChange(next);
      }}
    >
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-(--z-overlay) bg-surface-overlay data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
        <AlertDialogPrimitive.Content
          // Without a Description, Radix would keep pointing aria-describedby at
          // an element that is never rendered; drop the attribute instead.
          {...(description == null ? { "aria-describedby": undefined } : null)}
          className={cn(
            "fixed top-1/2 left-1/2 z-(--z-overlay) w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2",
            "max-h-[calc(100dvh-2rem)] overflow-y-auto",
            "rounded-lg border border-border bg-surface-elevated p-5 text-fg shadow-lg outline-none",
            "data-[state=open]:animate-scale-in data-[state=closed]:animate-fade-out",
          )}
        >
          <div className="flex items-start gap-3">
            {showIcon ? (
              <span
                aria-hidden
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-md [&_svg]:size-5",
                  destructive ? "bg-danger-soft text-danger" : "bg-primary-soft text-primary-soft-fg",
                )}
              >
                {icon ?? <AlertTriangle />}
              </span>
            ) : null}

            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <AlertDialogPrimitive.Title className="text-h3 font-semibold text-fg">
                {title}
              </AlertDialogPrimitive.Title>
              {description != null ? (
                <AlertDialogPrimitive.Description className="text-body-sm text-fg-secondary">
                  {description}
                </AlertDialogPrimitive.Description>
              ) : null}
            </div>
          </div>

          {children ? <div className="mt-4">{children}</div> : null}

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="outline" disabled={busy}>
                {cancelLabel}
              </Button>
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action asChild>
              <Button variant={destructive ? "danger" : "primary"} loading={busy} onClick={handleConfirm}>
                {confirmLabel}
              </Button>
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

/* -------------------------------------------------------------------------- */

export type ConfirmOptions = Pick<
  ConfirmDialogProps,
  "title" | "description" | "confirmLabel" | "cancelLabel" | "destructive" | "icon"
>;

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = React.createContext<ConfirmFn | null>(null);

/**
 * ConfirmProvider — mounts a single ConfirmDialog for the whole app so any
 * handler can `await confirm({...})` instead of wiring local state.
 * Put it next to `ToastProvider` in the app shell.
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [options, setOptions] = React.useState<ConfirmOptions | null>(null);
  const resolverRef = React.useRef<((value: boolean) => void) | null>(null);

  /** Resolves the pending promise exactly once. */
  const settle = React.useCallback((value: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(value);
  }, []);

  const confirm = React.useCallback<ConfirmFn>(
    (next) =>
      new Promise<boolean>((resolve) => {
        // A second request supersedes the first, which resolves as "cancelled".
        settle(false);
        resolverRef.current = resolve;
        setOptions(next);
        setOpen(true);
      }),
    [settle],
  );

  React.useEffect(() => () => settle(false), [settle]);

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next) settle(false);
      setOpen(next);
    },
    [settle],
  );

  const handleConfirm = React.useCallback(() => {
    settle(true);
    setOpen(false);
  }, [settle]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        {...(options ?? {})}
        title={options?.title ?? ""}
        open={open}
        onOpenChange={handleOpenChange}
        onConfirm={handleConfirm}
      />
    </ConfirmContext.Provider>
  );
}

/** useConfirm — `if (await confirm({ title: "Excluir veículo?", destructive: true })) …` */
export function useConfirm(): ConfirmFn {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx;
}
