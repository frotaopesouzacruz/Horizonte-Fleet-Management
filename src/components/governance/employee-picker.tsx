"use client";

import * as React from "react";
import { Check, Loader2, Search, UserRound, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/input";
import { IconButton } from "@/components/ui/button";
import { searchEmployees, type EmployeeOption } from "@/lib/governance/actions";

export interface EmployeePickerProps {
  value: EmployeeOption | null;
  onChange: (value: EmployeeOption | null) => void;
  disabled?: boolean;
  id?: string;
  placeholder?: string;
}

/**
 * Picks a person from the master employee registry (§18).
 *
 * Search is by name, matrícula or current operation, and it runs on the
 * server: 143 people today, and the registry is the one thing in this product
 * that only grows. What travels back into the form is the id — never the name.
 * A typed name is not an identifier here and never becomes one.
 */
export function EmployeePicker({ value, onChange, disabled, id, placeholder }: EmployeePickerProps) {
  const [term, setTerm] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [options, setOptions] = React.useState<EmployeeOption[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const requestRef = React.useRef(0);

  React.useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(async () => {
      const ticket = ++requestRef.current;
      setLoading(true);
      setError(null);
      const result = await searchEmployees(term);
      // A slower earlier request must not overwrite a faster later one.
      if (ticket !== requestRef.current) return;
      setLoading(false);
      if (result.ok) setOptions(result.data ?? []);
      else setError(result.error ?? "Não foi possível buscar colaboradores.");
    }, 250);
    return () => window.clearTimeout(handle);
  }, [term, open]);

  React.useEffect(() => {
    if (!open) return;
    const onDocumentClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocumentClick);
    return () => document.removeEventListener("mousedown", onDocumentClick);
  }, [open]);

  if (value && !open) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
        <UserRound aria-hidden className="size-4 shrink-0 text-fg-muted" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body-sm font-medium text-fg">{value.name}</span>
          <span className="block truncate text-caption text-fg-muted">
            {[value.code ? `Matrícula ${value.code}` : null, value.operationName]
              .filter(Boolean)
              .join(" · ") || "Sem vínculo funcional registrado"}
          </span>
        </span>
        {!disabled ? (
          <IconButton
            label="Trocar colaborador"
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(null);
              setTerm("");
              setOpen(true);
            }}
          >
            <X />
          </IconButton>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        id={id}
        value={term}
        disabled={disabled}
        autoComplete="off"
        placeholder={placeholder ?? "Buscar por nome, matrícula ou operação"}
        leadingIcon={<Search />}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
      />

      {open ? (
        <div
          role="listbox"
          className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-surface-elevated p-1 shadow-lg"
        >
          {loading ? (
            <p className="flex items-center gap-2 px-3 py-2 text-body-sm text-fg-muted">
              <Loader2 aria-hidden className="size-4 animate-spin" />
              Buscando…
            </p>
          ) : error ? (
            <p className="px-3 py-2 text-body-sm text-danger">{error}</p>
          ) : options.length === 0 ? (
            <p className="px-3 py-2 text-body-sm text-fg-muted">
              {term ? "Nenhum colaborador encontrado." : "Digite para buscar."}
            </p>
          ) : (
            options.map((option) => (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={value?.id === option.id}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left hfm-focus-ring",
                  "hover:bg-surface-secondary",
                )}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                  setTerm("");
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-sm text-fg">{option.name}</span>
                  <span className="block truncate text-caption text-fg-muted">
                    {[option.code ? `Matrícula ${option.code}` : null, option.operationName]
                      .filter(Boolean)
                      .join(" · ") || "Sem vínculo funcional registrado"}
                  </span>
                </span>
                {value?.id === option.id ? (
                  <Check aria-hidden className="size-4 shrink-0 text-primary" />
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
