"use client";

import * as React from "react";
import { NativeSelect } from "./selects";
import { FormField } from "@/components/ui/form-field";

export interface CoverageEntry {
  operationId: string;
  operationCityId: string;
  stateId: number;
  uf: string;
  cityId: number;
  cityName: string;
}

export interface BrEntry {
  id: string;
  code: string;
  operationId: string;
  operationCityId: string;
  status: string;
}

export interface ScopeValue {
  operationId: string;
  operationCityId: string | null;
  operationBrId: string | null;
}

export interface ScopePickerProps {
  operations: { id: string; name: string; status: string }[];
  coverage: CoverageEntry[];
  brs?: BrEntry[];
  value: ScopeValue;
  onChange: (value: ScopeValue) => void;
  /** How deep the chain goes. */
  depth: "operation" | "city" | "br";
  disabled?: boolean;
  /** Renders the three fields side by side instead of stacked. */
  inline?: boolean;
}

/**
 * Operação → Estado → Cidade → BR, chained.
 *
 * The chain is derived from the operation's own coverage, never from the IBGE
 * tables: an operation offers the states it covers and a state offers the
 * municipalities it covers there. Never the 27 UFs and never the 853
 * municipalities of Minas Gerais.
 *
 * Choosing a level upstream clears everything downstream. Keeping a stale city
 * when the operation changes is how a BR ends up saved in a city its operation
 * does not cover — which the database would refuse anyway, but only after the
 * person filled in the whole form.
 */
export function ScopePicker({
  operations,
  coverage,
  brs = [],
  value,
  onChange,
  depth,
  disabled,
  inline,
}: ScopePickerProps) {
  const scoped = React.useMemo(
    () => coverage.filter((c) => c.operationId === value.operationId),
    [coverage, value.operationId],
  );

  const states = React.useMemo(() => {
    const seen = new Map<number, string>();
    for (const c of scoped) seen.set(c.stateId, c.uf);
    return [...seen.entries()]
      .map(([id, uf]) => ({ id, uf }))
      .sort((a, b) => a.uf.localeCompare(b.uf));
  }, [scoped]);

  // The state is not stored on the value — it is implied by the chosen city.
  // One less field to keep in step, and no way for the two to disagree.
  //
  // `pickedState` only holds what the person chose in the state field while no
  // city is selected yet. Once there is a city, the city decides — derived, not
  // synchronised, so the two can never drift apart and no effect is needed.
  const selectedCity = scoped.find((c) => c.operationCityId === value.operationCityId);
  const [pickedState, setPickedState] = React.useState<number | null>(null);
  const stateId = selectedCity?.stateId ?? pickedState;

  const setStateId = (next: number | null) => setPickedState(next);

  const cities = React.useMemo(
    () => scoped.filter((c) => c.stateId === stateId).sort((a, b) => a.cityName.localeCompare(b.cityName)),
    [scoped, stateId],
  );

  const availableBrs = React.useMemo(
    () =>
      brs
        .filter((b) => b.operationCityId === value.operationCityId)
        .sort((a, b) => a.code.localeCompare(b.code, "pt-BR", { numeric: true })),
    [brs, value.operationCityId],
  );

  return (
    <div className={inline ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-4" : "flex flex-col gap-3"}>
      <FormField label="Operação" required id="scope-operation">
        <NativeSelect
          id="scope-operation"
          value={value.operationId}
          disabled={disabled}
          onChange={(e) => {
            setStateId(null);
            onChange({ operationId: e.target.value, operationCityId: null, operationBrId: null });
          }}
        >
          <option value="">Selecione a operação</option>
          {operations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {o.status !== "active" ? " (inativa)" : ""}
            </option>
          ))}
        </NativeSelect>
      </FormField>

      {depth !== "operation" ? (
        <>
          <FormField label="Estado" required id="scope-state">
            <NativeSelect
              id="scope-state"
              value={stateId === null ? "" : String(stateId)}
              disabled={disabled || !value.operationId}
              onChange={(e) => {
                setStateId(e.target.value ? Number(e.target.value) : null);
                onChange({ ...value, operationCityId: null, operationBrId: null });
              }}
            >
              <option value="">
                {value.operationId ? "Selecione o estado" : "Escolha a operação primeiro"}
              </option>
              {states.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.uf}
                </option>
              ))}
            </NativeSelect>
          </FormField>

          <FormField label="Cidade" required id="scope-city">
            <NativeSelect
              id="scope-city"
              value={value.operationCityId ?? ""}
              disabled={disabled || stateId === null}
              onChange={(e) =>
                onChange({ ...value, operationCityId: e.target.value || null, operationBrId: null })
              }
            >
              <option value="">
                {stateId === null ? "Escolha o estado primeiro" : "Selecione a cidade"}
              </option>
              {cities.map((c) => (
                <option key={c.operationCityId} value={c.operationCityId}>
                  {c.cityName}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        </>
      ) : null}

      {depth === "br" ? (
        <FormField
          label="BR"
          required
          id="scope-br"
          helperText={
            value.operationCityId && availableBrs.length === 0
              ? "Esta cidade ainda não possui BR cadastrada."
              : undefined
          }
        >
          <NativeSelect
            id="scope-br"
            value={value.operationBrId ?? ""}
            disabled={disabled || !value.operationCityId || availableBrs.length === 0}
            onChange={(e) => onChange({ ...value, operationBrId: e.target.value || null })}
          >
            <option value="">
              {value.operationCityId ? "Selecione a BR" : "Escolha a cidade primeiro"}
            </option>
            {availableBrs.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code}
                {b.status !== "active" ? " (inativa)" : ""}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      ) : null}
    </div>
  );
}
