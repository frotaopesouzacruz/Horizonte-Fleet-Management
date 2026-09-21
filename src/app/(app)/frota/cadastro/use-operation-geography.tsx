"use client";

import * as React from "react";
import { loadOperationCities, loadOperationStates } from "@/lib/fleet/actions";
import type { CityOption, StateOption } from "@/lib/organization/operations";

/**
 * The Etapa 04 cascade, on the client.
 *
 * An operation offers only the states it covers; a state offers only the
 * municipalities that operation covers there (§22). Never the 27 UFs of Brazil,
 * never the 853 municipalities of Minas Gerais.
 *
 * The server validates the combination regardless (§23) — the composite FK on
 * the allocation refuses a city outside the coverage. This exists so an invalid
 * combination is never offered in the first place, which is a different job.
 *
 * Clearing the previous lists happens during render, keyed by the selection,
 * rather than inside the effect: the stale list of the operation just
 * deselected must never be painted once, and an effect runs after that paint.
 */
export function useOperationGeography(operationId?: string, stateId?: string) {
  const [states, setStates] = React.useState<StateOption[]>([]);
  const [cities, setCities] = React.useState<CityOption[]>([]);
  const [loading, setLoading] = React.useState(false);

  const stateKey = operationId ?? "";
  const cityKey = `${operationId ?? ""}|${stateId ?? ""}`;

  const [loadedStateKey, setLoadedStateKey] = React.useState(stateKey);
  if (loadedStateKey !== stateKey) {
    setLoadedStateKey(stateKey);
    setStates([]);
    setCities([]);
    setLoading(Boolean(operationId));
  }

  const [loadedCityKey, setLoadedCityKey] = React.useState(cityKey);
  if (loadedCityKey !== cityKey) {
    setLoadedCityKey(cityKey);
    setCities([]);
    if (operationId && stateId) setLoading(true);
  }

  React.useEffect(() => {
    if (!operationId) return;

    // A late response from a previously selected operation must not overwrite
    // the list belonging to the current one.
    let active = true;
    void loadOperationStates(operationId)
      .then((result) => {
        if (!active) return;
        setStates(result.ok ? (result.data ?? []) : []);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [operationId]);

  React.useEffect(() => {
    if (!operationId || !stateId) return;

    let active = true;
    void loadOperationCities(operationId, Number(stateId))
      .then((result) => {
        if (!active) return;
        setCities(result.ok ? (result.data ?? []) : []);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [operationId, stateId]);

  return { states, cities, loading };
}
