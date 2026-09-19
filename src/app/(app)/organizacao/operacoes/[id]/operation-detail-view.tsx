"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Landmark, MapPin, Pencil, Users } from "lucide-react";
import type { CoverageState, OperationDetail } from "@/lib/organization/operations";
import type { CoverageInput } from "@/lib/organization/actions";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { EmptyState } from "@/components/feedback/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OperationFormDrawer } from "../operation-form-drawer";
import type { PickerState } from "@/components/organization/operation-geography-picker";

const number = new Intl.NumberFormat("pt-BR");

interface Props {
  operation: OperationDetail;
  coverage: CoverageState[];
  states: PickerState[];
  canUpdate: boolean;
}

/**
 * One operation: what it is, and where it runs.
 *
 * The coverage is shown here and edited in the same form that creates an
 * operation — one place decides what a coverage is, so the rules that apply
 * when it is created apply when it is changed.
 */
export function OperationDetailView({ operation, coverage, states, canUpdate }: Props) {
  const [formOpen, setFormOpen] = React.useState(false);

  const totalCities = coverage.reduce((sum, state) => sum + state.cities.length, 0);
  const totalPeople = coverage.reduce(
    (sum, state) => sum + state.cities.reduce((inner, city) => inner + city.employeeCount, 0),
    0,
  );

  const formValue = React.useMemo(
    () => ({
      id: operation.id,
      code: operation.code,
      name: operation.name,
      description: operation.description,
      status: (operation.status === "inactive" ? "inactive" : "active") as "active" | "inactive",
      coverage: coverage.map<CoverageInput>((state) => ({
        stateId: state.stateId,
        cityIds: state.cities.map((city) => city.cityId),
      })),
    }),
    [operation, coverage],
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
        description={operation.description ?? "Estados e municípios onde esta operação atua."}
        meta={
          <span className="flex items-center gap-2">
            {operation.code ? (
              <span className="font-mono text-body-sm text-fg-muted">{operation.code}</span>
            ) : null}
            <Badge variant={operation.status === "active" ? "success" : "neutral"} appearance="soft" dot>
              {operation.status === "active" ? "Ativa" : "Inativa"}
            </Badge>
          </span>
        }
        primaryAction={
          canUpdate ? (
            <Button leadingIcon={<Pencil />} onClick={() => setFormOpen(true)}>
              Editar operação
            </Button>
          ) : undefined
        }
      />

      <PageContent className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <KpiCard label="Estados" value={number.format(coverage.length)} icon={<Landmark />} />
          <KpiCard label="Municípios" value={number.format(totalCities)} icon={<MapPin />} />
          <KpiCard label="Colaboradores alocados" value={number.format(totalPeople)} icon={<Users />} />
        </div>

        {coverage.length === 0 ? (
          <EmptyState
            icon={<MapPin />}
            title="Nenhum estado na cobertura"
            description={
              canUpdate
                ? "Use “Editar operação” para definir os estados e, dentro de cada um, os municípios."
                : "Esta operação ainda não teve sua cobertura definida."
            }
          />
        ) : (
          coverage.map((state) => (
            <Card key={state.stateId}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-body-sm text-fg-muted">{state.uf}</span>
                  {state.name}
                  <span className="font-normal text-fg-muted">
                    · {number.format(state.cities.length)}{" "}
                    {state.cities.length === 1 ? "município" : "municípios"}
                  </span>
                </CardTitle>
              </CardHeader>

              <CardContent className="p-0">
                {state.cities.length === 0 ? (
                  <p className="border-t border-border px-4 py-4 text-body-sm text-fg-secondary">
                    Nenhum município selecionado neste estado.
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
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {state.cities.map((city) => (
                          <TableRow key={city.cityId} className="h-(--table-row-height)">
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

      <OperationFormDrawer
        open={formOpen}
        onOpenChange={setFormOpen}
        operation={formValue}
        states={states}
      />
    </>
  );
}
