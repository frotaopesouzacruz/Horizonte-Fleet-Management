"use client";

import * as React from "react";
import { ChevronRight, MapPin, Network, Truck, UserRound } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { HierarchyOperation } from "@/lib/governance/queries";

const number = new Intl.NumberFormat("pt-BR");

/**
 * Operação → Estado → Cidade → BR → Veículo → Motorista (§54).
 *
 * Expand and collapse, with real counters at each level. It renders what the
 * server sent for this organization and the chosen operation — never the whole
 * hierarchy of every organization in one query, which is exactly what §54
 * forbids.
 */
export function HierarchyPanel({ operations }: { operations: HierarchyOperation[] }) {
  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  const toggle = (key: string) => setOpen((o) => ({ ...o, [key]: !o[key] }));

  if (operations.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-body-sm text-fg-muted">
          Nenhuma posição operacional cadastrada no seu escopo.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {operations.map((operation) => {
        const opKey = operation.operation_id;
        const opOpen = open[opKey] ?? true;
        return (
          <Card key={opKey}>
            <CardContent className="p-0">
              <button
                type="button"
                onClick={() => toggle(opKey)}
                aria-expanded={opOpen}
                className="flex w-full items-center gap-2 px-4 py-3 text-left hfm-focus-ring hover:bg-surface-secondary"
              >
                <ChevronRight
                  aria-hidden
                  className={cn("size-4 shrink-0 text-fg-muted transition-transform", opOpen && "rotate-90")}
                />
                <Network aria-hidden className="size-4 shrink-0 text-fg-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-fg">
                    {operation.operation_name}
                  </span>
                  {operation.leader ? (
                    <span className="block truncate text-caption text-fg-muted">
                      Responsável: {operation.leader}
                    </span>
                  ) : (
                    <span className="block text-caption text-fg-muted">Sem responsável designado</span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <Badge variant="neutral" appearance="soft" size="sm">
                    {number.format(operation.cities)} cidade(s)
                  </Badge>
                  <Badge variant="neutral" appearance="soft" size="sm">
                    {number.format(operation.brs)} BR(s)
                  </Badge>
                  <Badge variant="neutral" appearance="soft" size="sm">
                    {number.format(operation.vehicles)} veículo(s)
                  </Badge>
                </span>
              </button>

              {opOpen ? (
                <div className="border-t border-border">
                  {(operation.states ?? []).map((state) => (
                    <div key={state.uf} className="border-b border-border last:border-b-0">
                      <p className="bg-surface-secondary px-4 py-1.5 text-caption font-medium uppercase tracking-wide text-fg-secondary">
                        {state.uf}
                      </p>
                      {state.cities.map((city) => {
                        const cityKey = `${opKey}:${state.uf}:${city.city_name}`;
                        const cityOpen = open[cityKey] ?? false;
                        return (
                          <div key={cityKey}>
                            <button
                              type="button"
                              onClick={() => toggle(cityKey)}
                              aria-expanded={cityOpen}
                              className="flex w-full items-center gap-2 px-4 py-2 pl-8 text-left hfm-focus-ring hover:bg-surface-secondary"
                            >
                              <ChevronRight
                                aria-hidden
                                className={cn(
                                  "size-3.5 shrink-0 text-fg-muted transition-transform",
                                  cityOpen && "rotate-90",
                                )}
                              />
                              <MapPin aria-hidden className="size-3.5 shrink-0 text-fg-muted" />
                              <span className="min-w-0 flex-1 truncate text-body-sm text-fg">
                                {city.city_name}
                              </span>
                              {city.leader ? (
                                <span className="truncate text-caption text-fg-muted">
                                  {city.leader}
                                </span>
                              ) : null}
                              <Badge variant="neutral" appearance="soft" size="sm">
                                {number.format(city.brs.length)} BR(s)
                              </Badge>
                            </button>

                            {cityOpen ? (
                              <ul className="divide-y divide-border border-t border-border">
                                {city.brs.map((br) => (
                                  <li
                                    key={br.br_id}
                                    className="flex items-center gap-2 px-4 py-2 pl-16 text-body-sm"
                                  >
                                    <span className="min-w-0 flex-1">
                                      <span className="flex items-center gap-1.5">
                                        <span className="truncate font-medium text-fg">
                                          BR {br.code}
                                        </span>
                                        {br.status !== "active" ? (
                                          <Badge variant="neutral" appearance="soft" size="sm">
                                            Inativa
                                          </Badge>
                                        ) : null}
                                      </span>
                                      {br.leader ? (
                                        <span className="block truncate text-caption text-fg-muted">
                                          Responsável: {br.leader}
                                        </span>
                                      ) : null}
                                    </span>
                                    <span className="flex shrink-0 items-center gap-3 text-caption text-fg-secondary">
                                      <span className="flex items-center gap-1">
                                        <Truck aria-hidden className="size-3.5 text-fg-muted" />
                                        {br.vehicle ?? br.license_plate ?? "sem veículo"}
                                      </span>
                                      <span className="flex items-center gap-1">
                                        <UserRound aria-hidden className="size-3.5 text-fg-muted" />
                                        {number.format(br.drivers)}
                                      </span>
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
