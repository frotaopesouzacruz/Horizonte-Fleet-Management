"use client";

import * as React from "react";
import { AlertTriangle, ClipboardCheck, Inbox } from "lucide-react";
import { cn } from "@/lib/cn";
import { InspectionStatusBadge } from "@/components/mtsr/badges";
import { DateInput } from "@/components/ui/date-input";
import { MetricStrip } from "@/components/ui/kpi-card";
import { SearchField } from "@/components/ui/search-field";
import { ToggleChip } from "@/components/ui/segmented-control";
import { StatusBadge, statusTone } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/governance/selects";
import {
  fmt1, fmtDays, fmtInt, formatDate, formatStamp, INSPECTION_STATUS_LABEL, INSPECTION_STATUS_TONE, MTSR_FILTER_PARAM,
  type InspectionStatus, type MtsrInspectionRow, type MtsrInspectionsReceived,
} from "@/lib/mtsr/types";
import type { MtsrPanelContext } from "../shared";
import { InspectionDrawer } from "./inspection-drawer";
import { fmtHours, MtsrPagination, PanelEmpty, PanelError, plural, useViewParam, vehicleName } from "./mtsr-ui";

/**
 * MTSR → Vistorias recebidas.
 *
 * A fila de validação do que o app enviou. `mtsr_inspections_received` já
 * filtra e pagina; a tela mostra a fila, os indicadores do fluxo e abre a
 * gaveta da vistoria (`?vistoria=<id>`), onde validar, retornar e rejeitar são
 * rotinas do banco.
 */
const STATUSES: InspectionStatus[] = ["pendente_validacao", "validada", "retornada", "rejeitada"];

export function InspectionsPanel({ data, ctx }: { data: MtsrInspectionsReceived | null; ctx: MtsrPanelContext }) {
  if (ctx.error) return <PanelError ctx={ctx} title="Não foi possível carregar as vistorias recebidas." testId="mtsr-vistorias-error" />;
  if (!data) {
    return (
      <PanelEmpty
        icon={<ClipboardCheck />}
        title="Sem dados de vistorias"
        description="A rotina não devolveu a fila. Recarregue a página."
        testId="mtsr-vistorias-empty"
      />
    );
  }
  return <InspectionsContent data={data} ctx={ctx} />;
}

function InspectionsContent({ data, ctx }: { data: MtsrInspectionsReceived; ctx: MtsrPanelContext }) {
  const { kpis: k, rows, total, limit } = data;
  const [openId, setOpenId] = useViewParam("vistoria");

  const selected = React.useMemo(() => {
    const raw = ctx.params.situacao;
    const list = (raw ?? "").split(",").map((s) => s.trim()).filter((s): s is InspectionStatus => (STATUSES as string[]).includes(s));
    return list.length ? list : (["pendente_validacao"] as InspectionStatus[]);
  }, [ctx.params.situacao]);

  const toggleStatus = (code: InspectionStatus) => {
    const next = selected.includes(code) ? selected.filter((c) => c !== code) : STATUSES.filter((c) => c === code || selected.includes(c));
    // Sem nenhum escolhido a rotina volta ao padrão (pendentes); gravamos a lista cheia para o link ser fiel.
    ctx.navigate({ situacao: next.length ? next.join(",") : null, pagina: null });
  };

  const nokOnly = ctx.params.nok === "1";
  const inspectors = data.options.inspectors.filter((i) => i.id);

  return (
    <div className="flex flex-col gap-4" data-testid="mtsr-vistorias">
      <MetricStrip
        ariaLabel="Indicadores das vistorias"
        className="sm:grid-cols-3 xl:grid-cols-5"
        items={[
          { key: "pendentes", label: "Pendentes de validação", value: <span data-testid="mtsr-kpi-vistorias-pendentes">{fmtInt(k.pendentes)}</span>, hint: `SLA de validação: ${fmtDays(data.reviewSlaDays)}` },
          { key: "com-nok", label: "Pendentes com NOK", value: <span data-testid="mtsr-kpi-vistorias-com-nok">{fmtInt(k.comNok)}</span>, hint: "Pedem atenção primeiro" },
          { key: "acima-sla", label: "Acima do SLA", value: <span data-testid="mtsr-kpi-vistorias-acima-sla" className={cn(k.acimaSla > 0 && "text-danger")}>{fmtInt(k.acimaSla)}</span>, hint: "Pendentes há mais dias que o SLA" },
          { key: "validadas", label: "Validadas", value: fmtInt(k.validadas), hint: "Viraram estado oficial" },
          { key: "retornadas", label: "Retornadas", value: fmtInt(k.retornadas), hint: "Devolvidas ao inspetor" },
          { key: "rejeitadas", label: "Rejeitadas", value: fmtInt(k.rejeitadas), hint: "Descartadas com motivo" },
          { key: "espera", label: "Espera média", value: k.esperaMediaDias == null ? "—" : `${fmt1(k.esperaMediaDias)} dias`, hint: "Das pendentes, desde o envio" },
          { key: "validacao", label: "Validação média", value: fmtHours(k.validacaoMediaHoras), hint: "Do envio à decisão" },
          { key: "30d", label: "Recebidas em 30 dias", value: fmtInt(k.ultimos30d), hint: "Todas as situações" },
        ]}
      />

      <div className="flex flex-wrap items-end gap-3" data-testid="mtsr-inspections-filters">
        <div className="flex flex-col gap-1">
          <span className="text-caption text-fg-muted">Situação</span>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por situação da vistoria">
            {STATUSES.map((code) => {
              const tone = statusTone(INSPECTION_STATUS_TONE[code]);
              return (
                <ToggleChip
                  key={code}
                  pressed={selected.includes(code)}
                  onPressedChange={() => toggleStatus(code)}
                  disabled={ctx.pending}
                  data-testid={`mtsr-inspections-status-${code}`}
                >
                  <span aria-hidden className={cn("size-2 rounded-full", tone.dotClassName)} />
                  {INSPECTION_STATUS_LABEL[code]}
                </ToggleChip>
              );
            })}
            <ToggleChip
              pressed={nokOnly}
              onPressedChange={(on) => ctx.navigate({ nok: on ? "1" : null, pagina: null })}
              disabled={ctx.pending}
              data-testid="mtsr-inspections-nok-only"
            >
              <AlertTriangle aria-hidden />
              Só com NOK
            </ToggleChip>
          </div>
        </div>
        <label className="flex min-w-[11rem] flex-col gap-1">
          <span className="text-caption text-fg-muted">Inspetor</span>
          <NativeSelect
            fieldSize="sm"
            value={ctx.params.inspetor ?? ""}
            disabled={ctx.pending}
            onChange={(e) => ctx.navigate({ inspetor: e.target.value || null, pagina: null })}
            data-testid="mtsr-inspections-inspector"
          >
            <option value="">Todos</option>
            {inspectors.map((i) => (
              <option key={i.id ?? ""} value={i.id ?? ""}>{i.name ?? i.id}</option>
            ))}
          </NativeSelect>
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-caption text-fg-muted">Data da vistoria</span>
          <div className="flex items-center gap-1.5">
            <DateInput size="sm" aria-label="De" value={ctx.params.de ?? ""} onChange={(e) => ctx.navigate({ de: e.target.value || null, pagina: null })} wrapperClassName="w-[9.5rem]" />
            <span className="text-caption text-fg-muted">até</span>
            <DateInput size="sm" aria-label="Até" value={ctx.params.ate ?? ""} onChange={(e) => ctx.navigate({ ate: e.target.value || null, pagina: null })} wrapperClassName="w-[9.5rem]" />
          </div>
        </div>
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 sm:max-w-xs">
          <span className="text-caption text-fg-muted">Placa, frota ou protocolo</span>
          <SearchField
            size="sm"
            defaultValue={ctx.filters.q ?? ""}
            placeholder="Ex.: SNT8I36"
            onKeyDown={(e) => {
              if (e.key === "Enter") ctx.navigate({ [MTSR_FILTER_PARAM.q]: (e.target as HTMLInputElement).value.trim() || null, pagina: null });
            }}
            onClear={() => ctx.navigate({ [MTSR_FILTER_PARAM.q]: null, pagina: null })}
            data-testid="mtsr-inspections-search"
          />
        </label>
      </div>

      {rows.length === 0 ? (
        <PanelEmpty
          icon={<Inbox />}
          title="Nenhuma vistoria nesta fila"
          description={
            selected.length === 1 && selected[0] === "pendente_validacao" && !nokOnly && !ctx.params.inspetor && !ctx.params.de && !ctx.filters.q
              ? "Não há vistorias aguardando validação. As enviadas pelo app aparecem aqui assim que chegam."
              : "Nenhuma vistoria corresponde aos filtros desta fila. Ajuste a situação, o período ou a busca."
          }
          testId="mtsr-vistorias-empty"
        />
      ) : (
        <InspectionsTable rows={rows} slaDays={data.reviewSlaDays} onOpen={(id) => setOpenId(id)} />
      )}

      <MtsrPagination ctx={ctx} total={total} limit={limit} label="Paginação das vistorias" testId="mtsr-inspections-pagination" />

      <InspectionDrawer
        inspectionId={openId}
        onClose={() => setOpenId(null)}
        ctx={ctx}
      />
    </div>
  );
}

function InspectionsTable({ rows, slaDays, onOpen }: { rows: MtsrInspectionRow[]; slaDays: number; onOpen: (id: string) => void }) {
  return (
    <TableContainer stickyHeader className="max-h-[65vh]" data-testid="mtsr-inspections-table">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Protocolo</TableHead>
            <TableHead>Placa / frota</TableHead>
            <TableHead>Operação</TableHead>
            <TableHead>Inspetor</TableHead>
            <TableHead>Data da vistoria</TableHead>
            <TableHead>Enviada em</TableHead>
            <TableHead numeric className="whitespace-normal">Itens / NOK / fotos</TableHead>
            <TableHead numeric className="whitespace-normal">Dias aguardando</TableHead>
            <TableHead>Situação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.id}
              className="cursor-pointer"
              data-testid="mtsr-inspection-row"
              data-status={row.status}
              onClick={() => onOpen(row.id)}
            >
              <TableCell className="whitespace-nowrap">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(row.id);
                  }}
                  className="rounded-xs font-semibold text-fg tabular-nums underline-offset-2 hover:text-primary hover:underline hfm-focus-ring"
                  data-testid="mtsr-inspection-open"
                >
                  {row.protocol}
                  <span className="sr-only"> — abrir a vistoria</span>
                </button>
              </TableCell>
              <TableCell className="whitespace-nowrap font-medium text-fg tabular-nums">{vehicleName(row.fleetCodeSnapshot, row.licensePlateSnapshot)}</TableCell>
              <TableCell className="text-fg-secondary">{row.operationNameSnapshot ?? "—"}</TableCell>
              <TableCell className="text-fg-secondary">
                {row.inspectorNameSnapshot ?? "—"}
                {row.inspectorCodeSnapshot ? <span className="ml-1 text-caption text-fg-muted">({row.inspectorCodeSnapshot})</span> : null}
              </TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">{formatDate(row.inspectionDate)}</TableCell>
              <TableCell className="whitespace-nowrap text-fg-secondary tabular-nums">{formatStamp(row.submittedAt)}</TableCell>
              <TableCell numeric className="whitespace-nowrap">
                {fmtInt(row.itemCount)} / <span className={cn(row.nokCount > 0 ? "font-semibold text-danger" : "text-fg-muted")}>{fmtInt(row.nokCount)}</span> / {fmtInt(row.evidenceCount)}
              </TableCell>
              <TableCell numeric className="whitespace-nowrap">
                <span className="inline-flex items-center justify-end gap-1.5">
                  {row.daysWaiting == null ? "—" : fmtInt(row.daysWaiting)}
                  {row.overSla ? (
                    <StatusBadge status="danger" size="sm" title={`Acima do SLA de ${fmtDays(slaDays)}`}>Acima do SLA</StatusBadge>
                  ) : null}
                </span>
              </TableCell>
              <TableCell><InspectionStatusBadge value={row.status} size="sm" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="sr-only">{fmtInt(rows.length)} {plural(rows.length, "vistoria nesta página", "vistorias nesta página")}</p>
    </TableContainer>
  );
}
