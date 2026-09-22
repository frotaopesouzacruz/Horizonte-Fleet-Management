"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Landmark, MapPin, Pencil, Users } from "lucide-react";
import type { CoverageState, OperationDetail } from "@/lib/organization/operations";
import { saveOperation, type CoverageInput } from "@/lib/organization/actions";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import { OperationFormDrawer } from "../operation-form-drawer";
import { ApplicationLinksPanel } from "@/components/applications/application-links-panel";
import type { ApplicationLinks } from "@/lib/applications/links-queries";
import {
  OperationGeographyPicker,
  type PickerState,
} from "@/components/organization/operation-geography-picker";

const number = new Intl.NumberFormat("pt-BR");

interface Props {
  operation: OperationDetail;
  coverage: CoverageState[];
  states: PickerState[];
  canUpdate: boolean;
  canManageGeography: boolean;
  /** Vínculos aplicativo × operação (null quando a leitura não foi autorizada). */
  links: ApplicationLinks | null;
  canManageApps: boolean;
  canViewAppHistory: boolean;
  /** `fidelization.view`: mostra o atalho para as BRs desta operação. */
  canViewBrs: boolean;
}

/**
 * One operation: what it is, and where it runs.
 *
 * The coverage is edited right here, where it is read, instead of only inside
 * the form that creates an operation — someone looking at the states of an
 * operation is one click from changing them. The picker and the save call are
 * the same ones the form uses, so the rule that an active operation must cover
 * at least one municipality in every state it claims is checked either way.
 */
export function OperationDetailView({
  operation,
  coverage,
  states,
  canUpdate,
  canManageGeography,
  links,
  canManageApps,
  canViewAppHistory,
  canViewBrs,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [formOpen, setFormOpen] = React.useState(false);
  const [editingCoverage, setEditingCoverage] = React.useState(false);
  const [draft, setDraft] = React.useState<CoverageInput[]>([]);
  const [coverageError, setCoverageError] = React.useState<string | null>(null);
  const [saving, startSaving] = React.useTransition();

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

  const startEditing = () => {
    setDraft(formValue.coverage);
    setCoverageError(null);
    setEditingCoverage(true);
  };

  const saveCoverage = () => {
    startSaving(async () => {
      // saveOperation takes the operation whole: name and status ride along
      // unchanged so the coverage rule is checked against the operation as it
      // actually is, not against a half-filled copy of it.
      const result = await saveOperation({
        id: operation.id,
        name: formValue.name,
        description: formValue.description,
        status: formValue.status,
        coverage: draft,
      });
      if (result.ok) {
        toast({ title: "Abrangência atualizada.", variant: "success" });
        setEditingCoverage(false);
        router.refresh();
      } else {
        setCoverageError(result.error ?? "Não foi possível salvar a abrangência.");
      }
    });
  };

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
        secondaryActions={
          canViewBrs ? (
            // asChild renders the child alone, so Button's leadingIcon slot is
            // dropped: the icon has to live inside the link.
            <Button asChild variant="secondary">
              <Link href={`/governanca/brs?operacao=${encodeURIComponent(operation.id)}`}>
                <MapPin className="size-4" aria-hidden />
                Consultar BRs desta operação
              </Link>
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

        {/* Refinamento da Etapa 12 (§8–§14): a operação decide quais aplicativos
            pode usar. Sem vínculo, o aplicativo não a lista — e uma operação nova
            nasce sem vínculo algum.

            Duas portas, uma fonte: este cartão e a aba "Aplicativos" do
            formulário (OperationFormDrawer) leem e gravam os MESMOS vínculos
            (§26). Aqui a lista chega pré-carregada do servidor; no formulário o
            painel carrega sozinho. Alterar num lado aparece no outro. */}
        {links ? (
          <Card>
            <CardContent className="pt-4">
              <ApplicationLinksPanel
                mode="operation"
                targetId={operation.id}
                links={links}
                canManage={canManageApps}
                canViewHistory={canViewAppHistory}
              />
            </CardContent>
          </Card>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-h4 font-semibold text-fg">Abrangência</h2>
            <p className="text-body-sm text-fg-secondary">
              Os estados onde a operação atua e, dentro de cada um, os municípios.
            </p>
          </div>
          {canManageGeography && !editingCoverage ? (
            <Button variant="secondary" leadingIcon={<MapPin />} onClick={startEditing}>
              {coverage.length === 0 ? "Definir abrangência" : "Editar abrangência"}
            </Button>
          ) : null}
        </div>

        {editingCoverage ? (
          <Card>
            <CardContent className="flex flex-col gap-4 pt-4">
              {coverageError ? (
                <Alert variant="danger">
                  <AlertTitle>Não foi possível salvar</AlertTitle>
                  <AlertDescription>{coverageError}</AlertDescription>
                </Alert>
              ) : null}

              <OperationGeographyPicker
                value={draft}
                onChange={setDraft}
                states={states}
                disabled={saving}
              />

              <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
                <Button
                  variant="ghost"
                  onClick={() => setEditingCoverage(false)}
                  disabled={saving}
                >
                  Cancelar
                </Button>
                <Button onClick={saveCoverage} loading={saving}>
                  Salvar abrangência
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : coverage.length === 0 ? (
          <EmptyState
            icon={<MapPin />}
            title="Nenhum estado na cobertura"
            description={
              canManageGeography
                ? "Use “Definir abrangência” para escolher os estados e, dentro de cada um, os municípios."
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
        canManageApps={canManageApps}
        canViewAppHistory={canViewAppHistory}
      />
    </>
  );
}
