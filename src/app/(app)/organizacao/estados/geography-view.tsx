"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Landmark, Map as MapIcon, MapPin, Star } from "lucide-react";
import type { CityFilters, CityPage, StateSummary } from "@/lib/organization/queries";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { Pagination } from "@/components/ui/pagination";
import { SearchField } from "@/components/ui/search-field";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/cn";

const number = new Intl.NumberFormat("pt-BR");
const coordinate = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });

const REGION_ORDER = ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul"] as const;

interface GeographyViewProps {
  states: StateSummary[];
  cities: CityPage;
  filters: CityFilters;
  /** UFs where the organization has at least one work location. */
  operatingStates: string[];
}

/**
 * Estados e cidades.
 *
 * Reference data, so the screen is a finder rather than an editor: pick a state
 * or type a name, read the IBGE code. Everything that decides what is shown —
 * the state, the search, the page — lives in the URL, which means the server
 * does the filtering, a result is shareable, and the browser never holds more
 * than fifty of the 5 571 municipalities.
 */
export function GeographyView({ states, cities, filters, operatingStates }: GeographyViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  const [search, setSearch] = React.useState(filters.q ?? "");

  // Adjusting state during render rather than in an effect: the box follows the
  // URL when the user navigates back, without an extra commit in between.
  const [syncedQuery, setSyncedQuery] = React.useState(filters.q ?? "");
  if (syncedQuery !== (filters.q ?? "")) {
    setSyncedQuery(filters.q ?? "");
    setSearch(filters.q ?? "");
  }

  const apply = React.useCallback(
    (changes: Record<string, string | undefined>, resetPage = true) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value === undefined || value === "") params.delete(key);
        else params.set(key, value);
      }
      if (resetPage) params.delete("page");
      const query = params.toString();
      startTransition(() => router.push(query ? `${pathname}?${query}` : pathname, { scroll: false }));
    },
    [pathname, router, searchParams],
  );

  // Debounced so typing does not fire a query per keystroke.
  React.useEffect(() => {
    if ((filters.q ?? "") === search) return;
    const timer = setTimeout(() => apply({ q: search || undefined }), 350);
    return () => clearTimeout(timer);
  }, [search, filters.q, apply]);

  const operating = React.useMemo(() => new Set(operatingStates), [operatingStates]);
  const selected = states.find((state) => state.id === filters.stateId) ?? null;

  const totalCities = states.reduce((sum, state) => sum + state.cityCount, 0);

  const byRegion = React.useMemo(() => {
    const groups = new Map<string, StateSummary[]>();
    for (const region of REGION_ORDER) groups.set(region, []);
    for (const state of states) {
      const bucket = groups.get(state.region);
      if (bucket) bucket.push(state);
      else groups.set(state.region, [state]);
    }
    return [...groups.entries()].filter(([, list]) => list.length > 0);
  }, [states]);

  return (
    <>
      <PageHeader
        title="Estados e cidades"
        description="Lista oficial do IBGE: 27 unidades federativas e 5.571 municípios. É a referência para todo campo geográfico do sistema."
      />

      <PageContent className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Unidades federativas" value={number.format(states.length)} icon={<MapIcon />} />
          <KpiCard label="Municípios" value={number.format(totalCities)} icon={<MapPin />} />
          <KpiCard label="Capitais" value={number.format(states.filter((s) => s.capitalId).length)} icon={<Landmark />} />
          <KpiCard
            label="UF com operação"
            value={number.format(operating.size)}
            icon={<Star />}
            period="onde há local de trabalho"
          />
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
          {/* ------------------------------------------------------- estados */}
          <Card className="h-fit">
            <CardHeader className="pb-2">
              <CardTitle>Unidades federativas</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 pt-1">
              <button
                type="button"
                onClick={() => apply({ uf: undefined })}
                className={cn(
                  "flex items-center justify-between rounded-xs px-2 py-1.5 text-left text-body-sm hfm-transition hfm-focus-ring",
                  filters.stateId === undefined
                    ? "bg-selected-overlay font-medium text-fg"
                    : "text-fg-secondary hover:bg-hover-overlay",
                )}
              >
                <span>Todas as UF</span>
                <span className="tabular-nums text-caption text-fg-muted">{number.format(totalCities)}</span>
              </button>

              {byRegion.map(([region, list]) => (
                <div key={region} className="flex flex-col gap-0.5">
                  <p className="px-2 pt-1 text-caption font-semibold uppercase tracking-[0.08em] text-fg-muted">
                    {region}
                  </p>
                  {list.map((state) => {
                    const active = state.id === filters.stateId;
                    return (
                      <button
                        key={state.id}
                        type="button"
                        onClick={() => apply({ uf: String(state.id) })}
                        aria-current={active ? "true" : undefined}
                        className={cn(
                          "flex items-center gap-2 rounded-xs px-2 py-1.5 text-left text-body-sm hfm-transition hfm-focus-ring",
                          active
                            ? "bg-selected-overlay font-medium text-fg"
                            : "text-fg-secondary hover:bg-hover-overlay",
                        )}
                      >
                        <span
                          className={cn(
                            "w-7 shrink-0 font-mono text-caption",
                            active ? "text-fg-secondary" : "text-fg-muted",
                          )}
                        >
                          {state.uf}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{state.name}</span>
                        {operating.has(state.uf) ? (
                          <Star className="size-3 shrink-0 text-highlight-soft-fg" aria-label="Com operação" />
                        ) : null}
                        <span
                          className={cn(
                            "shrink-0 tabular-nums text-caption",
                            active ? "text-fg-secondary" : "text-fg-muted",
                          )}
                        >
                          {number.format(state.cityCount)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* ------------------------------------------------------ municípios */}
          <Card>
            <CardHeader className="gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle>
                  {selected ? `Municípios · ${selected.name}` : "Municípios"}
                  <span className="ml-2 font-normal text-fg-muted">{number.format(cities.total)}</span>
                </CardTitle>
                {selected?.capitalName ? (
                  <Badge variant="highlight" appearance="soft" icon={<Landmark />}>
                    Capital: {selected.capitalName}
                  </Badge>
                ) : null}
              </div>
              <SearchField
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onClear={() => setSearch("")}
                placeholder="Buscar município (ignora acentos)"
                aria-label="Buscar município"
              />
            </CardHeader>

            <CardContent className="p-0">
              <TableContainer className="rounded-none border-0 border-t" stickyHeader maxHeight={640}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Município</TableHead>
                      <TableHead>UF</TableHead>
                      <TableHead numeric>Código IBGE</TableHead>
                      <TableHead numeric>DDD</TableHead>
                      <TableHead>Fuso horário</TableHead>
                      <TableHead numeric>Coordenadas</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cities.rows.length === 0 ? (
                      <TableEmpty
                        colSpan={6}
                        icon={<MapPin />}
                        message="Nenhum município encontrado. Revise o termo buscado ou escolha outra unidade federativa."
                      />
                    ) : (
                      cities.rows.map((city) => (
                        <TableRow key={city.id}>
                          <TableCell className="font-medium text-fg">
                            <span className="flex items-center gap-2">
                              {city.name}
                              {city.isCapital ? (
                                <Badge variant="highlight" appearance="soft" size="sm">
                                  Capital
                                </Badge>
                              ) : null}
                              {!city.isMunicipality ? (
                                <Badge variant="info" appearance="soft" size="sm">
                                  Distrito estadual
                                </Badge>
                              ) : null}
                            </span>
                          </TableCell>
                          <TableCell className="font-mono text-caption">{city.uf}</TableCell>
                          <TableCell numeric className="font-mono text-caption">
                            {city.id}
                          </TableCell>
                          <TableCell numeric>{city.ddd ?? "—"}</TableCell>
                          <TableCell className="text-caption text-fg-secondary">{city.timeZone ?? "—"}</TableCell>
                          <TableCell numeric className="text-caption text-fg-secondary">
                            {city.latitude !== null && city.longitude !== null
                              ? `${coordinate.format(city.latitude)}, ${coordinate.format(city.longitude)}`
                              : "—"}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>

              {cities.total > cities.pageSize ? (
                <div className="border-t border-border px-3 py-2">
                  <Pagination
                    page={cities.page}
                    pageSize={cities.pageSize}
                    total={cities.total}
                    disabled={pending}
                    onPageChange={(next) => apply({ page: next > 1 ? String(next) : undefined }, false)}
                    label="Paginação de municípios"
                  />
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </PageContent>
    </>
  );
}
