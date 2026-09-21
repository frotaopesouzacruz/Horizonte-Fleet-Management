"use client";

import * as React from "react";
import { AlertTriangle, Check, Loader2, Search, Truck } from "lucide-react";
import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { searchEligibleVehicles, type EligibleVehicle } from "@/lib/governance/actions";

export interface VehiclePickerProps {
  operationBrId: string;
  startDate: string;
  endDate?: string | null;
  excludeAssignmentId?: string | null;
  value: EligibleVehicle | null;
  onChange: (value: EligibleVehicle | null) => void;
  id?: string;
  disabled?: boolean;
}

/**
 * Picks the vehicle for a position and period (§48).
 *
 * The list is fetched for this BR and this period, so what comes back is
 * already filtered by registration status, archiving, operation scope and the
 * type restriction the equipment catalogue defines. The vehicles that would
 * conflict are still shown — greyed and labelled with the BR they clash with —
 * because §51 says a conflict must be named, not silently hidden.
 */
export function VehiclePicker({
  operationBrId,
  startDate,
  endDate,
  excludeAssignmentId,
  value,
  onChange,
  id,
  disabled,
}: VehiclePickerProps) {
  const [term, setTerm] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [options, setOptions] = React.useState<EligibleVehicle[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const requestRef = React.useRef(0);

  React.useEffect(() => {
    if (!operationBrId || !startDate) return;
    const handle = window.setTimeout(async () => {
      const ticket = ++requestRef.current;
      setLoading(true);
      setError(null);
      const result = await searchEligibleVehicles({
        operationBrId,
        startDate,
        endDate: endDate ?? null,
        search: term || null,
        excludeAssignmentId: excludeAssignmentId ?? null,
      });
      if (ticket !== requestRef.current) return;
      setLoading(false);
      if (result.ok) setOptions(result.data ?? []);
      else setError(result.error ?? "Não foi possível buscar veículos.");
    }, 250);
    return () => window.clearTimeout(handle);
  }, [term, operationBrId, startDate, endDate, excludeAssignmentId]);

  const describe = (v: EligibleVehicle) =>
    [v.makeName, v.modelName].filter(Boolean).join(" ") || v.vehicleType || "Sem modelo cadastrado";

  return (
    <div className="flex flex-col gap-2">
      <Input
        id={id}
        value={term}
        disabled={disabled}
        autoComplete="off"
        leadingIcon={<Search />}
        placeholder="Buscar por código de frota, placa, marca ou modelo"
        onChange={(e) => setTerm(e.target.value)}
      />

      <div className="max-h-64 overflow-auto rounded-md border border-border">
        {loading ? (
          <p className="flex items-center gap-2 px-3 py-3 text-body-sm text-fg-muted">
            <Loader2 aria-hidden className="size-4 animate-spin" />
            Buscando veículos elegíveis…
          </p>
        ) : error ? (
          <p className="px-3 py-3 text-body-sm text-danger">{error}</p>
        ) : options.length === 0 ? (
          <p className="px-3 py-3 text-body-sm text-fg-muted">
            Nenhum veículo elegível encontrado para este período.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {options.map((option) => {
              const selected = value?.vehicleId === option.vehicleId;
              return (
                <li key={option.vehicleId}>
                  <button
                    type="button"
                    disabled={disabled || option.hasConflict}
                    aria-pressed={selected}
                    onClick={() => onChange(selected ? null : option)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left hfm-focus-ring",
                      option.hasConflict
                        ? "cursor-not-allowed opacity-60"
                        : "hover:bg-surface-secondary",
                      selected && "bg-primary-soft",
                    )}
                  >
                    <Truck aria-hidden className="size-4 shrink-0 text-fg-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-sm font-medium text-fg">
                        {option.fleetCode ?? option.licensePlate ?? "Sem identificação"}
                        {option.fleetCode && option.licensePlate ? (
                          <span className="font-normal text-fg-muted"> · {option.licensePlate}</span>
                        ) : null}
                      </span>
                      <span className="block truncate text-caption text-fg-muted">
                        {describe(option)}
                      </span>
                    </span>
                    {option.hasConflict ? (
                      <Badge variant="warning" appearance="soft" size="sm">
                        <AlertTriangle aria-hidden className="size-3" />
                        {option.conflictBr ? `Em BR ${option.conflictBr}` : "Em conflito"}
                      </Badge>
                    ) : selected ? (
                      <Check aria-hidden className="size-4 shrink-0 text-primary" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="text-caption text-fg-muted">
        A lista já considera situação cadastral, escopo de acesso e os tipos de equipamento
        admitidos na operação desta BR. Veículos em conflito aparecem com a BR que os ocupa.
      </p>
    </div>
  );
}
