"use client";

import * as React from "react";
import { ChevronDown, MapPin, Plus, X } from "lucide-react";
import { listCitiesOfState, type CityChoice, type CoverageInput } from "@/lib/organization/actions";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchField } from "@/components/ui/search-field";
import { cn } from "@/lib/cn";

const number = new Intl.NumberFormat("pt-BR");

/** How many municipalities are rendered at once before asking for a narrower search. */
const RENDER_LIMIT = 150;

export interface PickerState {
  stateId: number;
  uf: string;
  name: string;
  region: string;
}

export interface OperationGeographyPickerProps {
  /** The coverage being edited. */
  value: CoverageInput[];
  onChange: (next: CoverageInput[]) => void;
  /** All 27 federative units, for the "add state" control. */
  states: PickerState[];
  disabled?: boolean;
}

const fold = (text: string) =>
  text.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

/**
 * OperationGeographyPicker — the one place that knows how an operation's
 * coverage is chosen.
 *
 * States are added explicitly and each becomes its own section; municipalities
 * are multi-selected inside the state they belong to. The list for a state is
 * fetched once, the first time it is opened, and kept for the life of the form —
 * Minas Gerais has 853 municipalities and São Paulo 645, so search, "select all"
 * and "clear" all run locally against that copy rather than asking the server
 * again on every keystroke.
 *
 * Only the matching municipalities are rendered, capped, because painting 853
 * checkboxes to show three is what makes a form feel broken.
 */
export function OperationGeographyPicker({
  value,
  onChange,
  states,
  disabled = false,
}: OperationGeographyPickerProps) {
  const [cities, setCities] = React.useState<Record<number, CityChoice[]>>({});
  const [loading, setLoading] = React.useState<Record<number, boolean>>({});
  const [open, setOpen] = React.useState<Record<number, boolean>>({});
  const [query, setQuery] = React.useState<Record<number, string>>({});
  const [stateQuery, setStateQuery] = React.useState("");
  const [cityError, setCityError] = React.useState<Record<number, boolean>>({});

  const byId = React.useMemo(() => new Map(states.map((s) => [s.stateId, s])), [states]);
  const chosen = React.useMemo(() => new Set(value.map((entry) => entry.stateId)), [value]);
  const available = states.filter((state) => !chosen.has(state.stateId));

  const loadCities = React.useCallback(
    async (stateId: number) => {
      if (cities[stateId] || loading[stateId]) return;
      setLoading((current) => ({ ...current, [stateId]: true }));
      // A failed load is a failed load: it says so and the rest of the form
      // survives. Letting it throw here would bubble out of a click handler and
      // take the person somewhere else with the coverage half-edited.
      try {
        const list = await listCitiesOfState(stateId);
        setCities((current) => ({ ...current, [stateId]: list }));
        setCityError((current) => ({ ...current, [stateId]: false }));
      } catch {
        setCityError((current) => ({ ...current, [stateId]: true }));
      } finally {
        setLoading((current) => ({ ...current, [stateId]: false }));
      }
    },
    [cities, loading],
  );

  const setCitiesFor = (stateId: number, cityIds: number[]) =>
    onChange(value.map((entry) => (entry.stateId === stateId ? { ...entry, cityIds } : entry)));

  const addState = async (stateId: number) => {
    onChange([...value, { stateId, cityIds: [] }]);
    setOpen((current) => ({ ...current, [stateId]: true }));
    setStateQuery("");
    await loadCities(stateId);
  };

  const removeState = (stateId: number) =>
    onChange(value.filter((entry) => entry.stateId !== stateId));

  const totalCities = value.reduce((sum, entry) => sum + entry.cityIds.length, 0);
  const stateMatches = available.filter((state) =>
    fold(`${state.uf} ${state.name}`).includes(fold(stateQuery.trim())),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-sm text-fg-secondary">
          {value.length === 0 ? (
            "Nenhum estado na abrangência."
          ) : (
            <>
              <strong className="font-semibold text-fg">{number.format(value.length)}</strong>{" "}
              {value.length === 1 ? "estado" : "estados"} ·{" "}
              <strong className="font-semibold text-fg">{number.format(totalCities)}</strong>{" "}
              {totalCities === 1 ? "município" : "municípios"}
            </>
          )}
        </p>

      </div>

      {/* Escolher um estado não fica atrás de nada que precise abrir: a lista
          está sempre à vista enquanto a abrangência é editada. Um controle que
          só existe depois de um clique é um controle que pode não aparecer. */}
      <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-muted p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-body-sm font-medium text-fg">
            {available.length === 0
              ? "Todas as 27 unidades federativas já estão na abrangência."
              : "Adicionar estado"}
          </p>
          {available.length > 8 ? (
            <SearchField
              value={stateQuery}
              onChange={(event) => setStateQuery(event.target.value)}
              onClear={() => setStateQuery("")}
              placeholder="Buscar estado"
              aria-label="Buscar estado"
              className="w-full sm:w-56"
            />
          ) : null}
        </div>

        {available.length === 0 ? null : stateMatches.length === 0 ? (
          <p className="text-body-sm text-fg-muted">Nenhum estado encontrado para essa busca.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {stateMatches.map((state) => (
              <button
                key={state.stateId}
                type="button"
                disabled={disabled}
                onClick={() => void addState(state.stateId)}
                title={`${state.name} · ${state.region}`}
                className="inline-flex items-center gap-1.5 rounded-sm border border-border-strong bg-surface px-2.5 py-1.5 text-body-sm text-fg hfm-transition hfm-focus-ring hover:bg-secondary disabled:pointer-events-none disabled:opacity-55"
              >
                <Plus className="size-3.5 text-fg-muted" aria-hidden />
                <span className="font-mono text-caption text-fg-secondary">{state.uf}</span>
                <span className="truncate">{state.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {value.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border px-4 py-8 text-center">
          <MapPin className="size-5 text-fg-muted" aria-hidden />
          <p className="text-body-sm text-fg-secondary">
            Adicione os estados onde a operação atua e escolha os municípios de cada um.
          </p>
        </div>
      ) : null}

      {value.map((entry) => {
        const state = byId.get(entry.stateId);
        const list = cities[entry.stateId] ?? [];
        const term = fold((query[entry.stateId] ?? "").trim());
        const matches = term.length === 0 ? list : list.filter((city) => fold(city.name).includes(term));
        const selected = new Set(entry.cityIds);
        const isOpen = open[entry.stateId] ?? false;

        return (
          <section key={entry.stateId} className="rounded-md border border-border bg-surface">
            <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
              <button
                type="button"
                onClick={() => {
                  const next = !isOpen;
                  setOpen((current) => ({ ...current, [entry.stateId]: next }));
                  if (next) void loadCities(entry.stateId);
                }}
                aria-expanded={isOpen}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-xs text-left hfm-focus-ring"
              >
                <ChevronDown
                  aria-hidden
                  className={cn("size-4 shrink-0 text-fg-muted hfm-transition", !isOpen && "-rotate-90")}
                />
                <span className="font-mono text-caption text-fg-muted">{state?.uf ?? entry.stateId}</span>
                <span className="truncate text-body-sm font-semibold text-fg">{state?.name ?? "—"}</span>
                <span className="shrink-0 text-caption text-fg-secondary">
                  {number.format(entry.cityIds.length)}{" "}
                  {entry.cityIds.length === 1 ? "município" : "municípios"}
                </span>
              </button>

              <IconButton
                label={`Remover ${state?.name ?? "estado"} da abrangência`}
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => removeState(entry.stateId)}
              >
                <X aria-hidden />
              </IconButton>
            </div>

            {entry.cityIds.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 border-t border-border-subtle px-3 py-2.5">
                {entry.cityIds.map((cityId) => {
                  const city = list.find((item) => item.id === cityId);
                  return (
                    <span
                      key={cityId}
                      className="inline-flex h-7 max-w-full items-center gap-1 rounded-xs border border-border bg-surface-secondary pr-1 pl-2 text-caption text-fg-secondary"
                    >
                      <span className="truncate">{city?.name ?? cityId}</span>
                      <button
                        type="button"
                        disabled={disabled}
                        aria-label={`Remover ${city?.name ?? cityId}`}
                        onClick={() =>
                          setCitiesFor(entry.stateId, entry.cityIds.filter((id) => id !== cityId))
                        }
                        className="inline-flex size-5 shrink-0 items-center justify-center rounded-xs text-fg-muted hfm-transition hfm-focus-ring hover:bg-secondary-hover hover:text-fg"
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                    </span>
                  );
                })}
              </div>
            ) : null}

            {isOpen ? (
              <div className="flex flex-col gap-2.5 border-t border-border px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <SearchField
                    value={query[entry.stateId] ?? ""}
                    onChange={(event) =>
                      setQuery((current) => ({ ...current, [entry.stateId]: event.target.value }))
                    }
                    onClear={() => setQuery((current) => ({ ...current, [entry.stateId]: "" }))}
                    placeholder="Buscar município"
                    aria-label={`Buscar município em ${state?.name ?? ""}`}
                    className="w-full sm:w-64"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled || matches.length === 0}
                    onClick={() =>
                      setCitiesFor(
                        entry.stateId,
                        // "All" means everything currently matching the search,
                        // kept together with what was already chosen elsewhere.
                        [...new Set([...entry.cityIds, ...matches.map((city) => city.id)])],
                      )
                    }
                  >
                    Selecionar {term.length > 0 ? `os ${number.format(matches.length)} filtrados` : "todas"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled || entry.cityIds.length === 0}
                    onClick={() => setCitiesFor(entry.stateId, [])}
                  >
                    Limpar
                  </Button>
                </div>

                {loading[entry.stateId] ? (
                  <p className="py-3 text-body-sm text-fg-muted">Carregando municípios…</p>
                ) : cityError[entry.stateId] ? (
                  <p className="py-3 text-body-sm text-danger">
                    Não foi possível carregar os municípios deste estado. O estado continua na
                    lista; tente recolher e abrir de novo.
                  </p>
                ) : matches.length === 0 ? (
                  <p className="py-3 text-body-sm text-fg-muted">Nenhum município encontrado.</p>
                ) : (
                  <>
                    <ul className="grid max-h-72 grid-cols-1 gap-0.5 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                      {matches.slice(0, RENDER_LIMIT).map((city) => {
                        const isSelected = selected.has(city.id);
                        return (
                          <li key={city.id}>
                            <label
                              className={cn(
                                "flex cursor-pointer items-center gap-2 rounded-xs px-2 py-1.5 text-body-sm hfm-transition",
                                isSelected ? "bg-selected-overlay text-fg" : "text-fg-secondary hover:bg-hover-overlay",
                              )}
                            >
                              <Checkbox
                                checked={isSelected}
                                disabled={disabled}
                                onCheckedChange={(checked) =>
                                  setCitiesFor(
                                    entry.stateId,
                                    checked
                                      ? [...entry.cityIds, city.id]
                                      : entry.cityIds.filter((id) => id !== city.id),
                                  )
                                }
                                aria-label={city.name}
                              />
                              <span className="min-w-0 truncate">{city.name}</span>
                              {city.isCapital ? (
                                <Badge variant="highlight" appearance="soft" size="sm">
                                  Capital
                                </Badge>
                              ) : null}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                    {matches.length > RENDER_LIMIT ? (
                      <p className="text-caption text-fg-muted">
                        Exibindo {number.format(RENDER_LIMIT)} de {number.format(matches.length)} municípios.
                        Refine a busca para ver os demais — “Selecionar os filtrados” considera todos os{" "}
                        {number.format(matches.length)}.
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
