"use client";

import * as React from "react";
import Link from "next/link";
import { Link2Off, Wrench } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { MaintenanceStatusBadge } from "@/components/maintenance/badges";
import { RevalidationBadge } from "@/components/mtsr/badges";
import { UnlinkMaintenanceDialog } from "@/components/mtsr/maintenance-dialogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetricStrip } from "@/components/ui/kpi-card";
import { Table, TableActionCell, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/governance/selects";
import type { MaintenanceStatus } from "@/lib/maintenance/types";
import type { MtsrTabData } from "@/lib/mtsr/loaders";
import { fmtInt, formatDate, formatStamp, REVALIDATION_LABEL, type MtsrMaintenanceLinkRow, type RevalidationStatus } from "@/lib/mtsr/types";
import type { MtsrPanelContext } from "../shared";
import { MtsrPagination, PanelEmpty, PanelError, PlateLink } from "./mtsr-ui";

/**
 * MTSR → Manutenções: os vínculos componente × manutenção corporativa.
 *
 * A manutenção mora na Gestão de Manutenção (o código abre a gaveta de lá);
 * aqui fica o vínculo com o componente e a revalidação. Concluir a manutenção
 * NÃO torna o componente OK — ele fica aguardando revalidação até uma nova
 * vistoria ou leitura dizer que está OK.
 */
type Data = MtsrTabData["manutencoes"];

const LINK_TYPE_LABEL: Record<string, string> = {
  opened_from_nok: "Aberta do NOK",
  linked_existing: "Vinculada",
  import: "Importação",
};
const LINK_STATUS_LABEL: Record<string, string> = { active: "Ativo", unlinked: "Desvinculado" };
const REVALIDATION_ORDER: RevalidationStatus[] = ["pending", "awaiting", "done", "not_required", "cancelled"];

export function MaintenancePanel({ data, ctx }: { data: Data | null; ctx: MtsrPanelContext }) {
  if (ctx.error) return <PanelError ctx={ctx} title="Não foi possível carregar as manutenções vinculadas." testId="mtsr-manutencoes-error" />;
  if (!data) {
    return (
      <PanelEmpty
        icon={<Wrench />}
        title="Sem dados de manutenções"
        description="A leitura dos vínculos não devolveu resultado. Recarregue a página."
        testId="mtsr-manutencoes-empty"
      />
    );
  }
  return <MaintenanceContent data={data} ctx={ctx} />;
}

function MaintenanceContent({ data, ctx }: { data: Data; ctx: MtsrPanelContext }) {
  const { summary, rows, total, limit } = data;
  const [unlink, setUnlink] = React.useState<MtsrMaintenanceLinkRow | null>(null);
  const linkFilter = ctx.params.vinculo ?? "";
  const revalidation = ctx.params.revalidacao_status ?? "";

  return (
    <div className="flex flex-col gap-4" data-testid="mtsr-manutencoes">
      <MetricStrip
        ariaLabel="Resumo dos vínculos"
        className="md:grid-cols-4"
        items={[
          { key: "active", label: "Vínculos ativos", value: <span data-testid="mtsr-kpi-vinculos-ativos">{fmtInt(summary.active)}</span>, hint: "Componente × manutenção" },
          { key: "open", label: "Manutenções abertas", value: <span data-testid="mtsr-kpi-manutencoes-abertas">{fmtInt(summary.open)}</span>, hint: "Há agendar, agendadas ou em execução" },
          { key: "awaiting", label: "Aguardando revalidação", value: <span data-testid="mtsr-kpi-aguardando-revalidacao">{fmtInt(summary.awaiting)}</span>, hint: "Concluídas, à espera de nova leitura" },
          { key: "done", label: "Revalidadas", value: <span data-testid="mtsr-kpi-revalidadas">{fmtInt(summary.done)}</span>, hint: "Componente voltou a OK depois da manutenção" },
        ]}
      />

      <div className="flex flex-wrap items-end gap-3" data-testid="mtsr-maintenance-filters">
        <label className="flex min-w-[10rem] flex-col gap-1">
          <span className="text-caption text-fg-muted">Situação do vínculo</span>
          <NativeSelect
            fieldSize="sm"
            value={linkFilter}
            disabled={ctx.pending}
            onChange={(e) => ctx.navigate({ vinculo: e.target.value || null, pagina: null })}
            data-testid="mtsr-maintenance-link-status"
          >
            <option value="">Ativos</option>
            <option value="unlinked">Desvinculados</option>
            <option value="active,unlinked">Todos</option>
          </NativeSelect>
        </label>
        <label className="flex min-w-[12rem] flex-col gap-1">
          <span className="text-caption text-fg-muted">Revalidação</span>
          <NativeSelect
            fieldSize="sm"
            value={revalidation}
            disabled={ctx.pending}
            onChange={(e) => ctx.navigate({ revalidacao_status: e.target.value || null, pagina: null })}
            data-testid="mtsr-maintenance-revalidation"
          >
            <option value="">Todas</option>
            {REVALIDATION_ORDER.map((code) => (
              <option key={code} value={code}>{REVALIDATION_LABEL[code]}</option>
            ))}
          </NativeSelect>
        </label>
      </div>

      {rows.length === 0 ? (
        <PanelEmpty
          icon={<Wrench />}
          title="Nenhum vínculo no recorte"
          description={
            linkFilter || revalidation || ctx.filters.component || ctx.filters.q
              ? "Nenhuma manutenção vinculada corresponde aos filtros. Ajuste a situação, a revalidação, o componente ou a busca."
              : "Nenhuma manutenção foi aberta a partir de NOK nem vinculada a um componente MTSR ainda. Os vínculos nascem na gaveta da vistoria ou na ficha do veículo."
          }
          testId="mtsr-manutencoes-empty"
        />
      ) : (
        <TableContainer stickyHeader className="max-h-[65vh]" data-testid="mtsr-maintenance-table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Placa</TableHead>
                <TableHead>Componente</TableHead>
                <TableHead>Manutenção</TableHead>
                <TableHead>Situação da manutenção</TableHead>
                <TableHead>Solicitada</TableHead>
                <TableHead>Agendada</TableHead>
                <TableHead>Saída</TableHead>
                <TableHead>Vínculo</TableHead>
                <TableHead>Revalidação</TableHead>
                <TableHead>Vinculada em</TableHead>
                {ctx.perms.maintenanceLink ? <TableHead className="sr-only">Ações</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} data-testid="mtsr-maintenance-row" data-link-status={row.status}>
                  <TableCell className="whitespace-nowrap">
                    <PlateLink vehicleId={row.vehicleId} plate={row.vehicle?.licensePlate} fleetCode={row.vehicle?.fleetCode} />
                  </TableCell>
                  <TableCell className="font-medium text-fg">{row.componentName}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {row.maintenance ? (
                      <Link
                        href={`/frota/manutencao?m=${row.maintenanceId}`}
                        className="rounded-xs font-semibold text-link tabular-nums underline-offset-4 hover:text-link-hover hover:underline hfm-focus-ring"
                        data-testid="mtsr-maintenance-code"
                      >
                        {row.maintenance.code}
                        <span className="sr-only"> — abrir na Gestão de Manutenção</span>
                      </Link>
                    ) : (
                      <span className="text-fg-muted">sem acesso à manutenção</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.maintenance ? <MaintenanceStatusBadge status={row.maintenance.status as MaintenanceStatus} /> : <span className="text-fg-muted">—</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums text-fg-secondary">{formatDate(row.maintenance?.requestedOn)}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums text-fg-secondary">{formatDate(row.maintenance?.scheduledDate)}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums text-fg-secondary">{formatDate(row.maintenance?.exitDate)}</TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-1">
                      <Badge variant={row.linkType === "opened_from_nok" ? "primary" : "neutral"} size="sm">{LINK_TYPE_LABEL[row.linkType] ?? row.linkType}</Badge>
                      {row.status !== "active" ? <Badge variant="neutral" appearance="outline" size="sm">{LINK_STATUS_LABEL[row.status] ?? row.status}</Badge> : null}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-col gap-0.5">
                      <RevalidationBadge value={row.revalidationStatus} size="sm" />
                      {row.revalidationStatus === "awaiting" && row.maintenanceConcludedAt ? (
                        <span className="text-caption text-fg-muted">concluída em {formatDate(row.maintenanceConcludedAt)}</span>
                      ) : null}
                      {row.revalidationStatus === "done" && row.revalidatedAt ? (
                        <span className="text-caption text-fg-muted">revalidado em {formatDate(row.revalidatedAt)}</span>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums text-fg-secondary">{formatStamp(row.linkedAt)}</TableCell>
                  {ctx.perms.maintenanceLink ? (
                    <TableActionCell>
                      {row.status === "active" ? (
                        <Button size="sm" variant="ghost" leadingIcon={<Link2Off />} onClick={() => setUnlink(row)} data-testid="mtsr-maintenance-unlink">
                          Desvincular
                        </Button>
                      ) : null}
                    </TableActionCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <MtsrPagination ctx={ctx} total={total} limit={limit} label="Paginação das manutenções vinculadas" testId="mtsr-maintenance-pagination" />

      <Alert variant="neutral" className="py-2" data-testid="mtsr-maintenance-note">
        <AlertTitle>Concluir a manutenção não torna o componente OK</AlertTitle>
        <AlertDescription>
          Quando a manutenção vinculada é concluída, o componente passa a <strong>Aguardando revalidação</strong> e continua com o estado
          oficial que tinha (em geral NOK). Só uma nova vistoria validada ou uma nova leitura da fonte do componente muda o estado — e aí a
          revalidação é registrada aqui.
        </AlertDescription>
      </Alert>

      {unlink ? (
        <UnlinkMaintenanceDialog
          key={unlink.id}
          open
          onOpenChange={(o) => (!o ? setUnlink(null) : undefined)}
          linkId={unlink.id}
          label={`${unlink.maintenance?.code ?? "Manutenção"} · ${unlink.componentName}`}
          onDone={() => {
            setUnlink(null);
            ctx.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
