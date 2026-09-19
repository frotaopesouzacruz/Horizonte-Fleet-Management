"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, MapPin, Plus, Trash2, Users } from "lucide-react";
import type { OperationDetail, OperationState } from "@/lib/organization/queries";
import {
  addOperationCity,
  addOperationState,
  removeOperationCity,
  removeOperationState,
  searchCitiesInState,
  type CityOption,
} from "@/lib/organization/actions";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { SearchField } from "@/components/ui/search-field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/empty-state";
import { useToast } from "@/components/feedback/toast";
import { useConfirm } from "@/components/feedback/confirm-dialog";

const number = new Intl.NumberFormat("pt-BR");

interface StateOption {
  id: number;
  uf: string;
  name: string;
  region: string;
}

interface Props {
  operation: OperationDetail;
  geography: OperationState[];
  allStates: StateOption[];
  canManage: boolean;
}

/**
 * The geographic structure of one operation: the states it covers, and inside
 * each the municipalities, with how many people are assigned to each.
 *
 * Two levels rather than a flat list of cities, because that is how the
 * operation is described and because a state can legitimately be covered before
 * its cities are chosen. Removing a state removes its cities with it, so that
 * one is confirmed; everything else applies straight away.
 */
export function OperationGeographyView({ operation, geography, allStates, canManage }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [pending, startTransition] = React.useTransition();

  const covered = React.useMemo(() => new Set(geography.map((state) => state.stateId)), [geography]);
  const available = allStates.filter((state) => !covered.has(state.id));

  const totalCities = geography.reduce((sum, state) => sum + state.cities.length, 0);
  const totalPeople = geography.reduce(
    (sum, state) => sum + state.cities.reduce((inner, city) => inner + city.employeeCount, 0),
    0,
  );

  const run = React.useCallback(
    (action: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
      startTransition(async () => {
        const result = await action();
        if (result.ok) {
          toast({ title: success, variant: "success" });
          router.refresh();
        } else {
          toast({ title: result.error ?? "Não foi possível concluir a ação.", variant: "danger" });
        }
      });
    },
    [router, toast],
  );

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link
            href="/organizacao/operacoes"
            className="inline-flex items-center gap-1.5 rounded-xs text-body-sm text-fg-secondary hover:text-fg"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Operações
          </Link>
        }
        title={operation.name}
        description="Estados e municípios onde esta operação atua. É a base que os demais módulos usarão para se vincular a um local."
        meta={
          <Badge variant={operation.status === "active" ? "success" : "neutral"} appearance="soft" dot>
            {operation.status === "active" ? "Ativa" : operation.status}
          </Badge>
        }
        primaryAction={
          canManage ? (
            <AddStateControl
              available={available}
              disabled={pending}
              onAdd={(stateId) =>
                run(() => addOperationState(operation.id, stateId), "Estado adicionado à operação.")
              }
            />
          ) : undefined
        }
      />

      <PageContent className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <KpiCard label="Estados" value={number.format(geography.length)} icon={<Building2 />} />
          <KpiCard label="Municípios" value={number.format(totalCities)} icon={<MapPin />} />
          <KpiCard label="Colaboradores alocados" value={number.format(totalPeople)} icon={<Users />} />
        </div>

        {geography.length === 0 ? (
          <EmptyState
            icon={<MapPin />}
            title="Nenhum estado vinculado"
            description={
              canManage
                ? "Adicione os estados onde esta operação atua e, dentro de cada um, os municípios."
                : "Esta operação ainda não teve sua abrangência definida."
            }
          />
        ) : (
          geography.map((state) => (
            <Card key={state.id}>
              <CardHeader className="gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle className="flex items-center gap-2">
                    <span className="font-mono text-body-sm text-fg-muted">{state.uf}</span>
                    {state.name}
                    <span className="font-normal text-fg-muted">
                      · {number.format(state.cities.length)}{" "}
                      {state.cities.length === 1 ? "município" : "municípios"}
                    </span>
                  </CardTitle>

                  {canManage ? (
                    <div className="flex items-center gap-2">
                      <AddCityControl
                        stateId={state.stateId}
                        stateName={state.name}
                        alreadyAdded={new Set(state.cities.map((city) => city.cityId))}
                        disabled={pending}
                        onAdd={(cityId) =>
                          run(
                            () => addOperationCity(operation.id, state.stateId, cityId),
                            "Município adicionado à operação.",
                          )
                        }
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        leadingIcon={<Trash2 />}
                        disabled={pending}
                        onClick={async () => {
                          const confirmed = await confirm({
                            title: `Remover ${state.name} da operação?`,
                            description:
                              state.cities.length > 0
                                ? `Os ${number.format(state.cities.length)} municípios vinculados a este estado também serão removidos desta operação. Os cadastros de colaboradores não são alterados.`
                                : "O estado será removido da abrangência desta operação.",
                            confirmLabel: "Remover",
                            destructive: true,
                          });
                          if (confirmed) {
                            run(
                              () => removeOperationState(operation.id, state.stateId),
                              "Estado removido da operação.",
                            );
                          }
                        }}
                      >
                        Remover estado
                      </Button>
                    </div>
                  ) : null}
                </div>
              </CardHeader>

              <CardContent className="p-0">
                {state.cities.length === 0 ? (
                  <p className="border-t border-border px-4 py-4 text-body-sm text-fg-secondary">
                    Nenhum município vinculado ainda. O estado já faz parte da abrangência
                    {canManage ? " — use “Adicionar município” para detalhar." : "."}
                  </p>
                ) : (
                  <TableContainer className="rounded-none border-0 border-t">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Município</TableHead>
                          <TableHead numeric>Código IBGE</TableHead>
                          <TableHead numeric>DDD</TableHead>
                          <TableHead numeric>Colaboradores</TableHead>
                          {canManage ? <TableHead className="w-12" /> : null}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {state.cities.map((city) => (
                          <TableRow key={city.id} className="h-(--table-row-height)">
                            <TableCell className="font-medium text-fg">
                              <span className="flex items-center gap-2">
                                {city.name}
                                {city.isCapital ? (
                                  <Badge variant="highlight" appearance="soft" size="sm">
                                    Capital
                                  </Badge>
                                ) : null}
                              </span>
                            </TableCell>
                            <TableCell numeric className="font-mono text-caption">
                              {city.cityId}
                            </TableCell>
                            <TableCell numeric>{city.ddd ?? "—"}</TableCell>
                            <TableCell numeric>
                              {city.employeeCount === 0 ? (
                                <span className="text-fg-muted">—</span>
                              ) : (
                                number.format(city.employeeCount)
                              )}
                            </TableCell>
                            {canManage ? (
                              <TableCell>
                                <IconButton
                                  label={`Remover ${city.name}`}
                                  variant="ghost"
                                  size="sm"
                                  disabled={pending}
                                  onClick={async () => {
                                    const confirmed = await confirm({
                                      title: `Remover ${city.name} da operação?`,
                                      description:
                                        city.employeeCount > 0
                                          ? `${number.format(city.employeeCount)} colaborador(es) estão alocados aqui. O vínculo geográfico da operação é removido; os cadastros não são alterados.`
                                          : "O município será removido da abrangência desta operação.",
                                      confirmLabel: "Remover",
                                      destructive: true,
                                    });
                                    if (confirmed) {
                                      run(
                                        () => removeOperationCity(operation.id, city.cityId),
                                        "Município removido da operação.",
                                      );
                                    }
                                  }}
                                >
                                  <Trash2 aria-hidden />
                                </IconButton>
                              </TableCell>
                            ) : null}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </PageContent>
    </>
  );
}

/* -------------------------------------------------------------------------- */

function AddStateControl({
  available,
  disabled,
  onAdd,
}: {
  available: StateOption[];
  disabled: boolean;
  onAdd: (stateId: number) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  if (available.length === 0) {
    return (
      <Button variant="secondary" disabled>
        Todas as 27 UFs vinculadas
      </Button>
    );
  }

  const normalized = query
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  const matches = available.filter((state) =>
    normalized.length === 0
      ? true
      : `${state.uf} ${state.name}`
          .toLowerCase()
          .normalize("NFD")
          .replace(/\p{Diacritic}/gu, "")
          .includes(normalized),
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button leadingIcon={<Plus />} disabled={disabled}>
          Adicionar estado
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="flex flex-col gap-3">
          <p className="text-h4 font-semibold text-fg">Estados disponíveis</p>
          {/* All 27 fit in memory, so this filters locally — no round trip for
              a list this size. */}
          <SearchField
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery("")}
            placeholder="Buscar estado"
            aria-label="Buscar estado"
            autoFocus
          />
          <div className="max-h-72 overflow-y-auto">
            {matches.length === 0 ? (
              <p className="px-1 py-3 text-body-sm text-fg-muted">Nenhum estado encontrado.</p>
            ) : (
              <ul className="flex flex-col">
                {matches.map((state) => (
                  <li key={state.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onAdd(state.id);
                        setOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-xs px-2 py-1.5 text-left text-body-sm hfm-transition hfm-focus-ring hover:bg-hover-overlay"
                    >
                      <span className="w-7 shrink-0 font-mono text-caption text-fg-secondary">{state.uf}</span>
                      <span className="min-w-0 flex-1 truncate">{state.name}</span>
                      <span className="shrink-0 text-caption text-fg-muted">{state.region}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* -------------------------------------------------------------------------- */

function AddCityControl({
  stateId,
  stateName,
  alreadyAdded,
  disabled,
  onAdd,
}: {
  stateId: number;
  stateName: string;
  alreadyAdded: Set<number>;
  disabled: boolean;
  onAdd: (cityId: number) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<CityOption[]>([]);
  const [loading, setLoading] = React.useState(false);

  const timer = React.useRef<number | null>(null);
  // Every search carries a sequence number and only the newest one is allowed
  // to write: a slow early request must not overwrite the list you are reading.
  const latest = React.useRef(0);

  const search = React.useCallback(
    (text: string, immediate = false) => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      const id = ++latest.current;
      setLoading(true);

      const run = async () => {
        const found = await searchCitiesInState(stateId, text);
        if (id === latest.current) {
          setResults(found);
          setLoading(false);
        }
      };

      if (immediate) void run();
      else timer.current = window.setTimeout(() => void run(), 250);
    },
    [stateId],
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // The first page of results is fetched when the picker opens, not by an
        // effect watching `open` — the click is the event, so it does the work.
        if (next) {
          setQuery("");
          search("", true);
        } else {
          if (timer.current !== null) window.clearTimeout(timer.current);
          latest.current += 1;
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm" leadingIcon={<Plus />} disabled={disabled}>
          Adicionar município
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="flex flex-col gap-3">
          <p className="text-h4 font-semibold text-fg">Municípios de {stateName}</p>
          <SearchField
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              search(event.target.value);
            }}
            onClear={() => {
              setQuery("");
              search("", true);
            }}
            placeholder="Buscar município (ignora acentos)"
            aria-label={`Buscar município em ${stateName}`}
            autoFocus
          />
          <div className="max-h-72 overflow-y-auto">
            {loading ? (
              <p className="px-1 py-3 text-body-sm text-fg-muted">Buscando…</p>
            ) : results.length === 0 ? (
              <p className="px-1 py-3 text-body-sm text-fg-muted">Nenhum município encontrado.</p>
            ) : (
              <ul className="flex flex-col">
                {results.map((city) => {
                  const added = alreadyAdded.has(city.id);
                  return (
                    <li key={city.id}>
                      <button
                        type="button"
                        disabled={added}
                        onClick={() => {
                          onAdd(city.id);
                          setOpen(false);
                          setQuery("");
                        }}
                        className="flex w-full items-center justify-between gap-2 rounded-xs px-2 py-1.5 text-left text-body-sm hfm-transition hfm-focus-ring hover:bg-hover-overlay disabled:pointer-events-none disabled:opacity-55"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate">{city.name}</span>
                          {city.isCapital ? (
                            <Badge variant="highlight" appearance="soft" size="sm">
                              Capital
                            </Badge>
                          ) : null}
                        </span>
                        {added ? <span className="shrink-0 text-caption text-fg-muted">já incluído</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
