"use client";

import * as React from "react";
import { Check, Search, Truck } from "lucide-react";
import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/input";
import type { KmVehicleOption } from "@/lib/km/options";

/**
 * Seletor pesquisável de veículo (combobox ARIA 1.2): digita-se a placa ou a
 * frota, as setas percorrem a lista, Enter escolhe, Esc fecha. O que sai daqui
 * é o id do veículo — nunca a placa digitada.
 */
const MAX_OPTIONS = 60;

const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s-]/g, "")
    .toLowerCase();

export const vehicleOptionLabel = (v: Pick<KmVehicleOption, "plate" | "fleetCode">) =>
  [v.plate, v.fleetCode && v.fleetCode !== v.plate ? v.fleetCode : null].filter(Boolean).join(" · ");

export interface VehiclePickerProps {
  vehicles: KmVehicleOption[];
  value: string | null;
  onChange: (vehicleId: string) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function VehiclePicker({ vehicles, value, onChange, disabled, id, className }: VehiclePickerProps) {
  const generated = React.useId();
  const inputId = id ?? `km-vehicle-${generated}`;
  const listId = `${inputId}-list`;
  const selected = React.useMemo(() => vehicles.find((v) => v.id === value) ?? null, [vehicles, value]);

  const [open, setOpen] = React.useState(false);
  const [term, setTerm] = React.useState<string | null>(null);
  const [active, setActive] = React.useState(0);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  const text = term ?? (selected ? vehicleOptionLabel(selected) : "");

  const matches = React.useMemo(() => {
    const q = normalize(term ?? "");
    const pool = q
      ? vehicles.filter((v) => normalize(v.plate).includes(q) || (v.fleetCode ? normalize(v.fleetCode).includes(q) : false))
      : vehicles;
    return pool.slice(0, MAX_OPTIONS);
  }, [vehicles, term]);

  const total = React.useMemo(() => {
    const q = normalize(term ?? "");
    if (!q) return vehicles.length;
    return vehicles.filter((v) => normalize(v.plate).includes(q) || (v.fleetCode ? normalize(v.fleetCode).includes(q) : false))
      .length;
  }, [vehicles, term]);

  const close = React.useCallback(() => {
    setOpen(false);
    setTerm(null);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onDocumentDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("mousedown", onDocumentDown);
    return () => document.removeEventListener("mousedown", onDocumentDown);
  }, [open, close]);

  // Mantém a opção ativa à vista quando se navega pelas setas.
  React.useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const choose = (vehicle: KmVehicleOption) => {
    close();
    if (vehicle.id !== value) onChange(vehicle.id);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) setOpen(true);
      setActive((i) => Math.min(matches.length - 1, open ? i + 1 : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === "Home" && open) {
      setActive(0);
    } else if (event.key === "End" && open) {
      setActive(Math.max(0, matches.length - 1));
    } else if (event.key === "Enter") {
      if (open && matches[active]) {
        event.preventDefault();
        choose(matches[active]);
      }
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        close();
      }
    } else if (event.key === "Tab") {
      close();
    }
  };

  const activeId = open && matches[active] ? `${listId}-${matches[active].id}` : undefined;

  return (
    <div ref={containerRef} className={cn("relative min-w-0", className)}>
      <Input
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-label="Veículo (placa ou frota)"
        autoComplete="off"
        spellCheck={false}
        size="sm"
        disabled={disabled}
        placeholder="Buscar por placa ou frota"
        leadingIcon={<Search />}
        value={text}
        data-testid="km-historico-vehicle"
        onFocus={(e) => {
          e.currentTarget.select();
        }}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setTerm(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />

      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Veículos"
          className="absolute z-50 mt-1 max-h-72 w-full min-w-64 overflow-auto rounded-md border border-border bg-surface-elevated p-1 shadow-lg"
        >
          {matches.length === 0 ? (
            <li role="presentation" className="px-3 py-2 text-body-sm text-fg-muted">
              Nenhum veículo encontrado.
            </li>
          ) : (
            matches.map((v, i) => {
              const isSelected = v.id === value;
              return (
                <li
                  key={v.id}
                  id={`${listId}-${v.id}`}
                  role="option"
                  aria-selected={isSelected}
                  data-index={i}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-left",
                    i === active ? "bg-surface-secondary" : "hover:bg-surface-secondary",
                  )}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(v)}
                >
                  <Truck aria-hidden className="size-4 shrink-0 text-fg-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-sm font-medium text-fg">{v.plate}</span>
                    <span className="block truncate text-caption text-fg-muted">
                      {[v.fleetCode ? `Frota ${v.fleetCode}` : null, v.status === "inactive" ? "Inativo" : null]
                        .filter(Boolean)
                        .join(" · ") || "Sem código de frota"}
                    </span>
                  </span>
                  {isSelected ? <Check aria-hidden className="size-4 shrink-0 text-primary" /> : null}
                </li>
              );
            })
          )}
          {total > matches.length ? (
            <li role="presentation" className="px-3 py-1.5 text-caption text-fg-muted">
              Mostrando {matches.length} de {total}. Digite mais para refinar.
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
