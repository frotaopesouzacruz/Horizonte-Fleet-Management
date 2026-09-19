"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MapPin, Network, Pencil, Plus, Power, Users } from "lucide-react";
import type { OperationSummary } from "@/lib/organization/operations";
import type { CoverageInput } from "@/lib/organization/actions";
import { setOperationStatus } from "@/lib/organization/actions";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { KpiCard } from "@/components/ui/kpi-card";
import { FilterBar } from "@/components/ui/filter-bar";
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
import { useToast } from "@/components/feedback/toast";
import { useConfirm } from "@/components/feedback/confirm-dialog";
import { OperationFormDrawer, type OperationFormValue } from "./operation-form-drawer";
import type { PickerState } from "@/components/organization/operation-geography-picker";

const number = new Intl.NumberFormat("pt-BR");

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export interface OperationsViewProps {
  operations: OperationSummary[];
  /** Coverage of every operation, so editing opens already filled. */
  coverage: Record<string, CoverageInput[]>;
  states: PickerState[];
  includeInactive: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDeactivate: boolean;
}

/**
 * Administração → Operações.
 *
 * The operation is the axis the product turns on: people, fleet and every
 * module still to come will hang off it, and off the municipality inside it.
 * This screen is the list of them; the geography of each lives one level down,
 * not in a module of its own.
 */
export function OperationsView({
  operations,
  coverage,
  states,
  includeInactive,
  canCreate,
  canUpdate,
  canDeactivate,
}: OperationsViewProps) {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [pending, startTransition] = React.useTransition();
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<OperationFormValue | undefined>();

  const employees = operations.reduce((sum, o) => sum + o.employeeCount, 0);
  const cities = operations.reduce((sum, o) => sum + o.cityCount, 0);

  const openNew = () => {
    setEditing(undefined);
    setFormOpen(true);
  };

  const openEdit = (operation: OperationSummary) => {
    setEditing({
      id: operation.id,
      code: operation.code,
      name: operation.name,
      description: operation.description,
      status: operation.status === "inactive" ? "inactive" : "active",
      coverage: coverage[operation.id] ?? [],
    });
    setFormOpen(true);
  };

  const toggleStatus = async (operation: OperationSummary) => {
    const next = operation.status === "active" ? "inactive" : "active";
    if (next === "inactive") {
      const confirmed = await confirm({
        title: `Inativar ${operation.name}?`,
        description:
          "A operação sai das listas de vínculo, mas continua no histórico: colaboradores, alocações e indicadores já registrados não são alterados. Ela pode ser reativada depois.",
        confirmLabel: "Inativar",
        destructive: true,
      });
      if (!confirmed) return;
    }

    startTransition(async () => {
      const result = await setOperationStatus(operation.id, next);
      if (result.ok) {
        toast({ title: next === "inactive" ? "Operação inativada." : "Operação reativada.", variant: "success" });
        router.refresh();
      } else {
        toast({ title: result.error ?? "Não foi possível alterar a situação.", variant: "danger" });
      }
    });
  };

  return (
    <>
      <PageHeader
        title="Operações"
        description="A operação é a unidade central do HFM. Cada uma reúne suas pessoas e a área geográfica onde atua — estados e municípios são definidos dentro dela."
        primaryAction={
          canCreate ? (
            <Button leadingIcon={<Plus />} onClick={openNew}>
              Nova operação
            </Button>
          ) : undefined
        }
        filters={
          <FilterBar>
            <label className="flex items-center gap-2 text-body-sm text-fg-secondary">
              <Checkbox
                checked={includeInactive}
                onCheckedChange={(checked) =>
                  startTransition(() =>
                    router.push(checked ? "/organizacao/operacoes?inativas=1" : "/organizacao/operacoes", {
                      scroll: false,
                    }),
                  )
                }
              />
              Exibir operações inativas
            </label>
          </FilterBar>
        }
      />

      <PageContent className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <KpiCard label="Operações" value={number.format(operations.length)} icon={<Network />} />
          <KpiCard label="Colaboradores" value={number.format(employees)} icon={<Users />} />
          <KpiCard label="Municípios cobertos" value={number.format(cities)} icon={<MapPin />} />
        </div>

        <Card>
          <CardContent className="p-0">
            <TableContainer className="rounded-none border-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead style={{ width: 110 }}>Código</TableHead>
                    <TableHead style={{ width: 260 }}>Operação</TableHead>
                    <TableHead numeric style={{ width: 100 }}>Estados</TableHead>
                    <TableHead numeric style={{ width: 120 }}>Municípios</TableHead>
                    <TableHead numeric style={{ width: 130 }}>Colaboradores</TableHead>
                    <TableHead numeric style={{ width: 120 }}>Com acesso</TableHead>
                    <TableHead style={{ width: 110 }}>Situação</TableHead>
                    <TableHead style={{ width: 150 }}>Atualizada em</TableHead>
                    <TableHead style={{ width: 96 }}>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {operations.length === 0 ? (
                    <TableEmpty
                      colSpan={9}
                      icon={<Network />}
                      message="Nenhuma operação cadastrada."
                    />
                  ) : (
                    operations.map((operation) => (
                      <TableRow key={operation.id} className="h-(--table-row-height)">
                        <TableCell className="font-mono text-caption text-fg-secondary">
                          {operation.code ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/organizacao/operacoes/${operation.id}`}
                            className="rounded-xs font-medium text-fg hfm-focus-ring hover:text-primary hover:underline"
                          >
                            {operation.name}
                          </Link>
                          {operation.description ? (
                            <span className="block truncate text-caption text-fg-muted" title={operation.description}>
                              {operation.description}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell numeric>{number.format(operation.stateCount)}</TableCell>
                        <TableCell numeric>{number.format(operation.cityCount)}</TableCell>
                        <TableCell numeric>{number.format(operation.employeeCount)}</TableCell>
                        <TableCell numeric>
                          {operation.accessCount === 0 ? (
                            <span className="text-fg-muted">—</span>
                          ) : (
                            number.format(operation.accessCount)
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={operation.status === "active" ? "success" : "neutral"}
                            appearance="soft"
                            dot
                          >
                            {operation.status === "active" ? "Ativa" : "Inativa"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-caption text-fg-secondary">
                          {formatDate(operation.updatedAt)}
                        </TableCell>
                        <TableCell>
                          <span className="flex items-center gap-0.5">
                            {canUpdate ? (
                              <IconButton
                                label={`Editar ${operation.name}`}
                                variant="ghost"
                                size="sm"
                                disabled={pending}
                                onClick={() => openEdit(operation)}
                              >
                                <Pencil aria-hidden />
                              </IconButton>
                            ) : null}
                            {canDeactivate ? (
                              <IconButton
                                label={
                                  operation.status === "active"
                                    ? `Inativar ${operation.name}`
                                    : `Reativar ${operation.name}`
                                }
                                variant="ghost"
                                size="sm"
                                disabled={pending}
                                onClick={() => void toggleStatus(operation)}
                              >
                                <Power aria-hidden />
                              </IconButton>
                            ) : null}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      </PageContent>

      <OperationFormDrawer
        open={formOpen}
        onOpenChange={setFormOpen}
        operation={editing}
        states={states}
      />
    </>
  );
}
