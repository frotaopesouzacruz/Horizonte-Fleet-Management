"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, FileSpreadsheet, Gauge, Truck } from "lucide-react";
import { cn } from "@/lib/cn";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { SectionHeader } from "@/components/layout/section-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetricStrip } from "@/components/ui/kpi-card";
import { SearchField } from "@/components/ui/search-field";
import { ToggleChip } from "@/components/ui/segmented-control";
import { StatusBadge, statusTone } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { KmFleetCurrentData, KmFleetCurrentRow } from "@/lib/km/fleet-current";
import {
  fmt1, fmtInt, fmtKm, formatDate, KM_CURRENT_FRESHNESS, KM_CURRENT_FRESHNESS_PARAM, type KmCurrentFreshness,
} from "@/lib/km/types";
import { kmFiltersQuery } from "@/lib/km/url";
import type { KmPanelContext } from "../shared";
import {
  freshnessLabel, freshnessTone, groupByOperation, localLabel, matchesSearch, sourceLabel, STALE_CRITICAL_DAYS,
  type OperationGroup,
} from "./fleet/model";

/**
 * KM atual das frotas — todas as placas do recorte agrupadas por operação,
 * com o hodômetro oficial vigente (a leitura mais recente de qualquer origem:
 * Gestão de KM, Manutenção, correção manual, cadastro), a data dessa leitura,
 * os dias sem atualização e a situação. A mesma leitura que o Cadastro de
 * Frotas e a Manutenção usam; a origem aparece ao lado da data.
 */
export function FleetPanel({ data, ctx }: { data: KmFleetCurrentData | null; ctx: KmPanelContext }) {
  if (ctx.error) {
    return (
      <ErrorState
        title="Não foi possível carregar o KM atual das frotas."
        description={ctx.error}
        onRetry={ctx.refresh}
        retrying={ctx.pending}
        data-testid="km-frotas-error"
      />
    );
  }
  if (!data) {
    return (
      <EmptyState
        variant="panel"
        icon={<Gauge />}
        title="Sem dados do KM atual"
        description="A rotina não devolveu o retrato de hoje. Recarregue a página."
        data-testid="km-frotas-empty"
      />
    );
  }
  return <FleetContent data={data} ctx={ctx} />;
}

const plural = (n: number, one: string, many: string) => `${fmtInt(n)} ${n === 1 ? one : many}`;

function FleetContent({ data, ctx }: { data: KmFleetCurrentData; ctx: KmPanelContext }) {
  const { summary, rows, freshnessFilter } = data;
  const [search, setSearch] = React.useState("");
  const deferredSearch = React.useDeferredValue(search);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());

  const visibleRows = React.useMemo(() => rows.filter((r) => matchesSearch(r, deferredSearch)), [rows, deferredSearch]);
  const groups = React.useMemo(() => groupByOperation(visibleRows), [visibleRows]);
  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed.has(g.key));

  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const setAll = (open: boolean) => setCollapsed(open ? new Set() : new Set(groups.map((g) => g.key)));

  const toggleFreshness = (code: KmCurrentFreshness) => {
    const next = freshnessFilter.includes(code)
      ? freshnessFilter.filter((c) => c !== code)
      : KM_CURRENT_FRESHNESS.filter((c) => c === code || freshnessFilter.includes(c));
    ctx.navigate({ leitura: next.length ? next.map((c) => KM_CURRENT_FRESHNESS_PARAM[c]).join(",") : null });
  };

  const exportQs = kmFiltersQuery(ctx.filters, {
    leitura: freshnessFilter.length ? freshnessFilter.map((c) => KM_CURRENT_FRESHNESS_PARAM[c]).join(",") : null,
  });
  const exportHref = `${ctx.basePath}/export/km-atual${exportQs ? `?${exportQs}` : ""}`;

  const days =
    summary.avgDays == null && summary.maxDays == null
      ? "—"
      : `${fmt1(summary.avgDays)} · máx. ${fmtInt(summary.maxDays)}`;

  return (
    <div className="flex flex-col gap-5" data-testid="km-frotas">
      <SectionHeader
        icon={<Gauge />}
        title="KM atual das frotas"
        description={`Retrato de ${formatDate(data.today)}: hodômetro oficial vigente de cada placa (a leitura mais recente, de qualquer origem), agrupado por operação. Recente = leitura de hoje ou de ontem; defasada = 2 dias ou mais.`}
        actions={
          ctx.perms.export ? (
            <Button asChild size="sm" variant="secondary">
              <a href={exportHref} download data-testid="km-frotas-export">
                <FileSpreadsheet aria-hidden />
                Exportar Excel
              </a>
            </Button>
          ) : null
        }
      />

      <MetricStrip
        ariaLabel="Resumo do KM atual"
        className="md:grid-cols-3 xl:grid-cols-6"
        items={[
          { key: "vehicles", label: "Frotas", value: fmtInt(summary.vehicles), hint: plural(summary.operations, "operação", "operações") },
          {
            key: "recent",
            label: "Atualizadas recentemente",
            value: <span data-testid="km-frotas-recent">{fmtInt(summary.recent)}</span>,
            hint: "Leitura de hoje ou de ontem",
          },
          {
            key: "stale",
            label: "Leitura defasada",
            value: <span data-testid="km-frotas-stale">{fmtInt(summary.stale)}</span>,
            hint: "2 dias ou mais sem atualizar",
          },
          {
            key: "never",
            label: "Sem leitura",
            value: <span data-testid="km-frotas-never">{fmtInt(summary.never)}</span>,
            hint: "Nunca tiveram hodômetro registrado",
          },
          { key: "days", label: "Dias sem atualização", value: days, hint: "Média · máximo entre as frotas com leitura" },
          {
            key: "km",
            label: "Vindas da Gestão de KM",
            value: fmtInt(summary.fromKmModule),
            hint: summary.lastReadingDate ? `Última leitura em ${formatDate(summary.lastReadingDate)}` : "Nenhuma leitura registrada",
          },
        ]}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por atualização">
          <span className="text-caption font-medium text-fg-muted">Atualização:</span>
          {KM_CURRENT_FRESHNESS.map((code) => {
            const tone = statusTone(code === "recent" ? "success" : code === "stale" ? "warning" : "neutral");
            return (
              <ToggleChip
                key={code}
                pressed={freshnessFilter.includes(code)}
                onPressedChange={() => toggleFreshness(code)}
                disabled={ctx.pending}
                data-testid={`km-frotas-filter-${code}`}
              >
                <span aria-hidden className={cn("size-2 rounded-full", tone.dotClassName)} />
                {freshnessLabel(code)}
              </ToggleChip>
            );
          })}
        </div>
        <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
          <SearchField
            size="sm"
            value={search}
            onValueChange={setSearch}
            placeholder="Placa, frota, tipo ou cidade"
            aria-label="Buscar nesta lista"
            wrapperClassName="w-full md:w-64"
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setAll(allCollapsed)}
            disabled={groups.length === 0}
            data-testid="km-frotas-toggle-all"
          >
            {allCollapsed ? <ChevronsUpDown aria-hidden /> : <ChevronsDownUp aria-hidden />}
            {allCollapsed ? "Expandir tudo" : "Recolher tudo"}
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          variant="panel"
          icon={<Truck />}
          title="Nenhuma frota no recorte"
          description={
            freshnessFilter.length
              ? "Nenhuma frota com a atualização escolhida. Limpe o filtro de atualização ou ajuste os filtros da tela."
              : "Nenhuma frota visível com os filtros atuais. Ajuste os filtros da tela."
          }
          data-testid="km-frotas-empty"
        />
      ) : visibleRows.length === 0 ? (
        <EmptyState
          variant="panel"
          size="sm"
          icon={<Truck />}
          title="Nada encontrado na lista"
          description={`Nenhuma frota corresponde a "${search}".`}
          data-testid="km-frotas-empty-search"
        />
      ) : (
        <FleetTable groups={groups} collapsed={collapsed} onToggle={toggleGroup} ctx={ctx} />
      )}

      <Alert variant="neutral" className="py-2" data-testid="km-frotas-note">
        <AlertDescription>
          A leitura vigente é a mesma do Cadastro de Frotas e da Manutenção: um só registro oficial de hodômetro, no qual
          a Gestão de KM grava o hodômetro final de cada dia importado e a Manutenção, as correções manuais e o cadastro
          inicial também escrevem. Frota sem leitura aparece sem KM — nunca como 0 km. Leitura defasada acima de{" "}
          {STALE_CRITICAL_DAYS} dias é destacada em vermelho.
        </AlertDescription>
      </Alert>
    </div>
  );
}

const COLUMNS = 9;

function FleetTable({
  groups, collapsed, onToggle, ctx,
}: {
  groups: OperationGroup[];
  collapsed: Set<string>;
  onToggle: (key: string) => void;
  ctx: KmPanelContext;
}) {
  const historyHref = (row: KmFleetCurrentRow) => {
    const qs = kmFiltersQuery(ctx.filters, { aba: "historico", veiculo: row.vehicleId, leitura: null });
    return `${ctx.basePath}?${qs}`;
  };
  return (
    <TableContainer stickyHeader className="max-h-[70vh]" data-testid="km-frotas-table">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Frota</TableHead>
            <TableHead>Placa</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Carroceria</TableHead>
            <TableHead>Local</TableHead>
            <TableHead>Última leitura</TableHead>
            <TableHead numeric>KM atual</TableHead>
            <TableHead numeric className="min-w-[5.5rem] whitespace-normal">Dias s/ atualização</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) => {
            const open = !collapsed.has(group.key);
            const Chevron = open ? ChevronDown : ChevronRight;
            return (
              <React.Fragment key={group.key}>
                <TableRow
                  className="bg-surface-sunken/60 hover:bg-surface-sunken/60"
                  data-testid="km-frotas-group"
                  data-operation={group.key}
                >
                  <TableCell colSpan={COLUMNS} className="py-1.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => onToggle(group.key)}
                        className="flex min-h-8 min-w-0 items-center gap-1.5 rounded-xs px-1 text-left text-body-sm hfm-focus-ring hover:bg-hover-overlay"
                        data-testid="km-frotas-group-toggle"
                      >
                        <Chevron className="size-4 shrink-0 text-fg-muted" aria-hidden />
                        <span className="sr-only">Operação: </span>
                        <span className={cn("truncate font-semibold text-fg", group.missing && "text-fg-muted italic")} title={group.label}>
                          {group.label}
                        </span>
                        <Badge variant="neutral" size="sm" className="shrink-0 tabular-nums">
                          {plural(group.rows.length, "frota", "frotas")}
                        </Badge>
                      </button>
                      <span className="flex flex-wrap items-center gap-1.5 text-caption text-fg-muted">
                        {group.recent > 0 ? <GroupCount tone="success" count={group.recent} label="recentes" /> : null}
                        {group.stale > 0 ? <GroupCount tone="warning" count={group.stale} label="defasadas" /> : null}
                        {group.never > 0 ? <GroupCount tone="neutral" count={group.never} label="sem leitura" /> : null}
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
                {open
                  ? group.rows.map((row) => {
                      const tone = freshnessTone(row);
                      const source = sourceLabel(row);
                      return (
                        <TableRow key={row.vehicleId} data-testid="km-frotas-row" data-freshness={row.freshness}>
                          <TableCell className="whitespace-nowrap text-fg-secondary tabular-nums">{row.fleetCode ?? "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {ctx.perms.history ? (
                              <Link
                                href={historyHref(row)}
                                className="font-semibold text-fg tabular-nums underline-offset-2 hover:text-primary hover:underline hfm-focus-ring rounded-xs"
                                data-testid="km-frotas-plate"
                              >
                                {row.plate}
                              </Link>
                            ) : (
                              <span className="font-semibold text-fg tabular-nums" data-testid="km-frotas-plate">{row.plate}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-fg-secondary">{row.type ?? "—"}</TableCell>
                          <TableCell className="text-fg-secondary">{row.subcategory ?? "—"}</TableCell>
                          <TableCell className="whitespace-nowrap text-fg-secondary">{localLabel(row)}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {row.lastReadingDate ? (
                              <span className="flex flex-col leading-tight">
                                <span className="tabular-nums">{formatDate(row.lastReadingDate)}</span>
                                {source ? <span className="text-caption text-fg-muted">{source}</span> : null}
                              </span>
                            ) : (
                              <span className="text-fg-muted">—</span>
                            )}
                          </TableCell>
                          <TableCell numeric className={cn("whitespace-nowrap font-medium", row.odometerKm == null && "text-fg-muted")}>
                            {fmtKm(row.odometerKm)}
                          </TableCell>
                          <TableCell numeric className={cn(row.daysSince == null && "text-fg-muted")}>
                            {fmtInt(row.daysSince)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={tone} size="sm" data-testid="km-frotas-status">
                              {freshnessLabel(row.freshness)}
                            </StatusBadge>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  : null}
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function GroupCount({ tone, count, label }: { tone: "success" | "warning" | "neutral"; count: number; label: string }) {
  const t = statusTone(tone);
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <span aria-hidden className={cn("size-1.5 rounded-full", t.dotClassName)} />
      {fmtInt(count)} {label}
    </span>
  );
}
