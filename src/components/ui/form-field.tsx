"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { Label } from "@/components/ui/label";

export interface FormFieldContextValue {
  /** Id of the control. */
  id: string;
  /**
   * Id of the rendered label, or `undefined` when the field has none. Controls
   * that are not labelable elements (a `role="radiogroup"`/`role="group"`
   * wrapper, for instance) must point `aria-labelledby` at it, because the
   * label's `htmlFor` has no effect on them.
   */
  labelId: string | undefined;
  /** Ids to place in the control's `aria-describedby`, already joined. */
  describedBy: string | undefined;
  /** Id of the helper text, when present. */
  helperTextId: string | undefined;
  /** Id of the error message, when present. */
  errorId: string | undefined;
  /** True when the field carries an error. */
  invalid: boolean;
  required: boolean;
  disabled: boolean;
}

const FormFieldContext = React.createContext<FormFieldContextValue | null>(null);

/**
 * Reads the wiring of the surrounding `FormField`. Controls that render their
 * own markup can spread the returned ids/flags manually; single-element
 * children are wired automatically by `FormField`.
 */
export function useFormField(): FormFieldContextValue {
  const context = React.useContext(FormFieldContext);
  if (!context) {
    throw new Error("useFormField deve ser usado dentro de um <FormField>.");
  }
  return context;
}

/**
 * Same as `useFormField`, but returns `null` outside a `FormField`. Used by
 * controls that must work both inside and outside a field (e.g. `SelectTrigger`).
 */
export function useOptionalFormField(): FormFieldContextValue | null {
  return React.useContext(FormFieldContext);
}

export interface FormFieldProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  /** Visible label. Omit only when the control is labelled elsewhere. */
  label?: React.ReactNode;
  /** Secondary content on the right of the label row (e.g. "Opcional"). */
  labelHint?: React.ReactNode;
  /** Explanatory line under the control. */
  helperText?: React.ReactNode;
  /** Error message; its presence turns the field invalid. */
  error?: React.ReactNode;
  /** Marks the label with an asterisk. */
  required?: boolean;
  /** Propagated to the context (does not disable the control by itself). */
  disabled?: boolean;
  /** Id of the control; generated when omitted. */
  id?: string;
  /** The control. A single element is wired automatically. */
  children: React.ReactNode;
  /** Class names of the label. */
  labelClassName?: string;
}

/**
 * FormField — label, control, helper text and error as one accessible unit.
 * Generates the ids and wires `aria-describedby` / `aria-invalid` into the
 * control, either automatically (single element child) or through
 * `useFormField()` for composite children.
 */
export const FormField = React.forwardRef<HTMLDivElement, FormFieldProps>(function FormField(
  {
    label,
    labelHint,
    helperText,
    error,
    required = false,
    disabled = false,
    id,
    className,
    labelClassName,
    children,
    ...props
  },
  ref,
) {
  const generatedId = React.useId();
  const controlId = id ?? `field-${generatedId}`;
  const labelId = label ? `${controlId}-label` : undefined;
  const helperTextId = helperText ? `${controlId}-helper` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const invalid = Boolean(error);

  const context = React.useMemo<FormFieldContextValue>(
    () => ({
      id: controlId,
      labelId,
      helperTextId,
      errorId,
      describedBy: [helperTextId, errorId].filter(Boolean).join(" ") || undefined,
      invalid,
      required,
      disabled,
    }),
    [controlId, labelId, helperTextId, errorId, invalid, required, disabled],
  );

  const singleChild = React.Children.count(children) === 1 && React.isValidElement(children);

  const control = singleChild ? (
    <Slot
      id={context.id}
      aria-describedby={context.describedBy}
      aria-invalid={invalid || undefined}
      aria-required={required || undefined}
    >
      {children}
    </Slot>
  ) : (
    children
  );

  return (
    <FormFieldContext.Provider value={context}>
      <div ref={ref} className={cn("flex w-full min-w-0 flex-col gap-1.5", className)} {...props}>
        {label ? (
          <Label
            id={labelId}
            htmlFor={controlId}
            required={required}
            hint={labelHint}
            className={cn(disabled && "text-fg-disabled", labelClassName)}
          >
            {label}
          </Label>
        ) : null}

        {control}

        {helperText ? (
          <p id={helperTextId} className="text-helper text-fg-muted">
            {helperText}
          </p>
        ) : null}

        {error ? (
          <p id={errorId} role="alert" className="flex items-start gap-1.5 text-helper text-danger">
            <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    </FormFieldContext.Provider>
  );
});

/* -------------------------------------------------------------------------- */

export interface FormRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Stacks on small screens and flows horizontally from `sm` upwards. */
  children: React.ReactNode;
}

/** FormRow — fields side by side, each taking an equal share of the row. */
export const FormRow = React.forwardRef<HTMLDivElement, FormRowProps>(function FormRow(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn("flex flex-col gap-4 sm:flex-row sm:items-start [&>*]:min-w-0 sm:[&>*]:flex-1", className)}
      {...props}
    />
  );
});

const gridColumns = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
} as const;

export interface FormGridProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Number of dense columns on wide viewports. */
  columns?: 1 | 2 | 3;
}

/** FormGrid — dense 1–3 column layout for form sections. */
export const FormGrid = React.forwardRef<HTMLDivElement, FormGridProps>(function FormGrid(
  { className, columns = 2, ...props },
  ref,
) {
  return <div ref={ref} className={cn("grid gap-4", gridColumns[columns], className)} {...props} />;
});

export interface FormActionsProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Adds the separating top border of a form footer. */
  bordered?: boolean;
}

/** FormActions — right-aligned footer row for the form's buttons. */
export const FormActions = React.forwardRef<HTMLDivElement, FormActionsProps>(function FormActions(
  { className, bordered = true, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "flex flex-wrap items-center justify-end gap-2",
        bordered && "border-t border-border pt-4",
        className,
      )}
      {...props}
    />
  );
});
