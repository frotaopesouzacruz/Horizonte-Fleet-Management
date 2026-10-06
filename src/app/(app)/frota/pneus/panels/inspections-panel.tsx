"use client";

import * as React from "react";
import { AlarmClock, AlertTriangle, ClipboardCheck, Inbox, RefreshCcwDot, Send } from "lucide-react";
import { cn } from "@/lib/cn";
import { DateInput } from "@/components/ui/date-input";
import { MetricStrip } from "@/components/ui/kpi-card";
import { ToggleChip } from "@/components/ui/segmented-control";
import { StatusBadge, statusTone } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/governance/selects";
import type { TiresTabData } from "@/lib/tires/loaders";
import {
  fmtDays, fmtInt, formatDate, formatStamp, INSPECTION_STATUS_LABEL, INSPECTION_STATUS_SHORT, INSPECTION_STATUS_TONE, INSPECTION_STATUSES,
  type InspectionStatus, type TireInspectionRow, type TiresInspectionsReceived,
} from "@/lib/tires/types";
import type { TiresPanelContext } from "../shared";
import { InspectionDrawer } from "./inspection-drawer";
import {
  ExportButton, fmtHours, PanelEmpty, PanelError, PlateLink, plural, TiresKpi, TiresPagination, useTiresLink,
} from "./tires-ui";

/**
 * Gestão de Pneus → Vistorias recebidas.
 *
 * A fila de revisão do que o aplicativo enviou em leitura cega.
 * `tire_inspections_received` filtra, pagina e conta; a vistoria aberta
 * (`?vistoria=<id>`) é lida no servidor e mostrada na gaveta, com as leituras
 * ao lado da referência oficial do Rodopar. A vistoria nunca altera a
 * fotografia oficial: a conciliação acontece na próxima importação.
 */
type Data = NonNullable<TiresTabData["vistorias"]>;

/** Divergência: valores aceitos pela rotina (`f_div`). */
const DIVERGENCE_FILTER: { value: string; label: string }[] = [
  { value: "com", label: "Com divergência" },
  { value: "sem", label: "Sem divergência" },
  { value: "persistente", label: "Divergência persistente" },
];

/** Contagem de cada situação no escopo (os indicadores da rotina). */
const STATUS_COUNT: Record<InspectionStatus, keyof TiresInspectionsReceived["kpis"]> = {
  pendente_revisao: "pendenteRevisao",
  pendente_rodopar: "pendenteRodopar",
  sincronizado_rodopar: "sincronizadoRodopar",
  retornar_divergencia: "retornarDivergencia",
  substituida: "substituida",
};

export function InspectionsPanel({ data, ctx }: { data: TiresTabData["vistorias"] | null; ctx: TiresPanelContext }) {
  if (ctx.error) return <PanelError ctx={ctx} title="Não foi possível carregar as vistorias recebidas." testId="tires-vistorias-error" />;
  if (!data) {
    return (
      <PanelEmpty
        icon={<ClipboardCheck />}
        title="Sem dados de vistorias"
        description="A rotina não devolveu a fila de vistorias. Recarregue a página."
        testId="tires-vistorias-empty"
      />
    );
  }
  return <InspectionsContent data={data} ctx={ctx} />;
}

function InspectionsContent({ data, ctx }: { data: Data; ctx: TiresPanelContext }) {
  const { kpis: k, rows, total, limit } = data;
  const link = useTiresLink(ctx);
  const { navigate } = ctx;

  // A gaveta abre na hora do clique (intenção local) e passa a seguir a URL
  // assim que o servidor devolve a vistoria pedida: cada resposta é um novo
  // objeto `data`, o que torna a intenção obsoleta.
  const urlId = ctx.params.vistoria ?? null;
  const [intent, setIntent] = React.useState<{ id: string | null; at: Data } | null>(null);
  const live = intent && intent.at === data ? intent : null;
  const openId = live ? live.id : urlId;
  const openDrawer = React.useCallback(
    (id: string) => {
      setIntent({ id, at: data });
      navigate({ vistoria: id });
    },
    [data, navigate],
  );
  const closeDrawer = React.useCallback(() => {
    setIntent({ id: null, at: data });
    navigate({ vistoria: null });
  }, [data, navigate]);

  const rawFase = ctx.params.fase ?? "";
  const all = rawFase === "todas";
  const selected = React.useMemo<InspectionStatus[]>(() => {
    if (all) return [];
    const list = rawFase.split(",").map((s) => s.trim()).filter((s): s is InspectionStatus => (INSPECTION_STATUSES as string[]).includes(s));
    return list.length ? list : ["pendente_revisao"];
  }, [rawFase, all]);

  const toggleStatus = (code: InspectionStatus) => {
    const next = selected.includes(code) ? selected.filter((c) => c !== code) : INSPECTION_STATUSES.filter((c) => c === code || selected.includes(c));
    // Nenhuma escolhida: a rotina volta ao padrão (pendentes de revisão).
    navigate({ fase: next.length ? next.join(",") : null, pagina: null });
  };

  const inspector = ctx.params.inspetor ?? "";
  const divergence = ctx.params.divergencia ?? "";
  const from = ctx.params.de ?? "";
  const to = ctx.params.ate ?? "";
  const isDefaultQueue = !rawFase && !inspector && !divergence && !from && !to && !ctx.filters.q;

  const kpiNav = (patch: Record<string, string | null>) =>
    link({ fase: null, divergencia: null, inspetor: null, de: null, ate: null, vistoria: null, ...patch });

  return (
    <div className="flex flex-col gap-5" data-testid="tires-vistorias">
      <section aria-label="Indicadores das vistorias" className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <TiresKpi
            kpi="vistorias-pendentes"
            label="Pendentes de revisão"
            value={fmtInt(k.pendenteRevisao)}
            status={k.pendenteRevisao > 0 ? "warning" : "neutral"}
            icon={<Inbox />}
            period="Aguardam a decisão do revisor"
            nav={kpiNav({ fase: "pendente_revisao" })}
            destination="ver a fila de revisão"
          />
          <TiresKpi
            kpi="vistorias-com-divergencia"
            label="Pendentes com divergência"
            value={fmtInt(k.pendingWithDivergence)}
            status={k.pendingWithDivergence > 0 ? "danger" : "neutral"}
            icon={<AlertTriangle />}
            period="Leitura diferente da referência Rodopar"
            nav={kpiNav({ fase: "pendente_revisao", divergencia: "com" })}
            destination="ver as pendentes com divergência"
          />
          <TiresKpi
            kpi="vistorias-acima-sla-revisao"
            label="Acima do SLA de revisão"
            value={fmtInt(k.reviewOverSla)}
            status={k.reviewOverSla > 0 ? "danger" : "neutral"}
            icon={<AlarmClock />}
            period={`Pendentes há mais de ${fmtDays(k.reviewSlaDays)}`}
            nav={kpiNav({ fase: "pendente_revisao" })}
            destination="ver a fila de revisão"
          />
          <TiresKpi
            kpi="vistorias-pendente-rodopar"
            label="Aprovadas, aguardando o Rodopar"
            value={fmtInt(k.pendenteRodopar)}
            status={k.rodoparOverSla > 0 ? "danger" : k.pendenteRodopar > 0 ? "progress" : "neutral"}
            icon={<Send />}
            period={
              <span className={cn(k.rodoparOverSla > 0 && "font-medium text-danger")}>
                {fmtInt(k.rodoparOverSla)} acima do SLA de sincronização ({fmtDays(k.rodoparSyncSlaDays)})
              </span>
            }
            nav={kpiNav({ fase: "pendente_rodopar" })}
            destination="ver as aprovadas aguardando o Rodopar"
          />
          <div className="col-span-2 lg:col-span-1">
            <TiresKpi
              kpi="vistorias-persistentes"
              label="Divergência persistente"
              value={fmtInt(k.persistent)}
              status={k.persistent > 0 ? "danger" : "neutral"}
              icon={<RefreshCcwDot />}
              period="A nova fotografia não confirmou a leitura"
              nav={kpiNav({ fase: "pendente_rodopar", divergencia: "persistente" })}
              destination="ver as vistorias com divergência persistente"
            />
          </div>
        </div>
        <MetricStrip
          ariaLabel="Situação das vistorias e SLAs vigentes"
          className="sm:grid-cols-3 xl:grid-cols-6"
          items={[
            { key: "sincronizadas", label: "Sincronizadas com o Rodopar", value: <span data-testid="tires-kpi-vistorias-sincronizadas">{fmtInt(k.sincronizadoRodopar)}</span>, hint: "Confirmadas pela importação" },
            { key: "retornadas", label: "Retornadas por divergência", value: <span data-testid="tires-kpi-vistorias-retornadas">{fmtInt(k.retornarDivergencia)}</span>, hint: "Aguardam nova medição" },
            { key: "substituidas", label: "Substituídas", value: fmtInt(k.substituida), hint: "Refeitas por nova medição" },
            { key: "tempo", label: "Tempo médio de revisão", value: <span data-testid="tires-kpi-vistorias-tempo">{fmtHours(k.avgReviewHours)}</span>, hint: "Do envio à decisão, últimos 90 dias" },
            { key: "sla-revisao", label: "SLA de revisão", value: fmtDays(k.reviewSlaDays), hint: "Parâmetro vigente" },
            { key: "sla-rodopar", label: "SLA de sincronização", value: fmtDays(k.rodoparSyncSlaDays), hint: "Da aprovação à fotografia" },
          ]}
        />
        <p className="text-caption text-fg-muted">
          Indicadores de todas as vistorias do seu escopo, sem os filtros da fila. A vistoria de campo nunca altera a fotografia oficial: o que
          for aprovado só chega à base pela próxima importação do Rodopar.
        </p>
      </section>

      <div className="flex flex-col gap-3" data-testid="tires-inspections-filters">
        <div className="flex flex-col gap-1">
          <span className="text-caption text-fg-muted" id="tires-inspections-status-label">Situação</span>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-labelledby="tires-inspections-status-label">
            {INSPECTION_STATUSES.map((code) => {
              const tone = statusTone(INSPECTION_STATUS_TONE[code]);
              return (
                <ToggleChip
                  key={code}
                  pressed={selected.includes(code)}
                  onPressedChange={() => toggleStatus(code)}
                  disabled={ctx.pending}
                  title={INSPECTION_STATUS_LABEL[code]}
                  data-testid={`tires-inspections-status-${code}`}
                >
                  <span aria-hidden className={cn("size-2 rounded-full", tone.dotClassName)} />
                  {INSPECTION_STATUS_SHORT[code]}
                  <span className="text-caption text-fg-muted tabular-nums">{fmtInt(k[STATUS_COUNT[code]] as number)}</span>
                </ToggleChip>
              );
            })}
            <ToggleChip
              pressed={all}
              onPressedChange={(on) => navigate({ fase: on ? "todas" : null, pagina: null })}
              disabled={ctx.pending}
              data-testid="tires-inspections-status-todas"
            >
              Todas
            </ToggleChip>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex w-full min-w-[12rem] flex-col gap-1 sm:w-auto">
            <span className="text-caption text-fg-muted">Vistoriador</span>
            <NativeSelect
              fieldSize="sm"
              value={inspector}
              disabled={ctx.pending}
              onChange={(e) => navigate({ inspetor: e.target.value || null, pagina: null })}
              data-testid="tires-inspections-inspector"
            >
              <option value="">Todos</option>
              {data.inspectors.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </NativeSelect>
          </label>
          <label className="flex w-full min-w-[12rem] flex-col gap-1 sm:w-auto">
            <span className="text-caption text-fg-muted">Divergência</span>
            <NativeSelect
              fieldSize="sm"
              value={divergence}
              disabled={ctx.pending}
              onChange={(e) => navigate({ divergencia: e.target.value || null, pagina: null })}
              data-testid="tires-inspections-divergence"
            >
              <option value="">Todas</option>
              {DIVERGENCE_FILTER.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </NativeSelect>
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-caption text-fg-muted">Data da vistoria</span>
            <div className="flex items-center gap-1.5">
              <DateInput
                size="sm"
                aria-label="Data da vistoria: de"
                value={from}
                max={to || undefined}
                disabled={ctx.pending}
                onChange={(e) => navigate({ de: e.target.value || null, pagina: null })}
                wrapperClassName="w-[9.5rem]"
                data-testid="tires-inspections-from"
              />
              <span className="text-caption text-fg-muted">até</span>
              <DateInput
                size="sm"
                aria-label="Data da vistoria: até"
                value={to}
                min={from || undefined}
                disabled={ctx.pending}
                onChange={(e) => navigate({ ate: e.target.value || null, pagina: null })}
                wrapperClassName="w-[9.5rem]"
                data-testid="tires-inspections-to"
              />
            </div>
          </div>
          <div className="flex w-full items-center justify-between gap-2 sm:ml-auto sm:w-auto sm:justify-end">
            <span className="text-caption text-fg-muted tabular-nums" aria-live="polite" data-testid="tires-inspections-total">
              {fmtInt(total)} {plural(total, "vistoria", "vistorias")}
            </span>
            <ExportButton
              ctx={ctx}
              kind="vistorias"
              extra={{ fase: rawFase || null, inspetor: inspector || null, divergencia: divergence || null, de: from || null, ate: to || null }}
            />
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <PanelEmpty
          icon={<Inbox />}
          title={isDefaultQueue ? "Nenhuma vistoria aguardando revisão" : "Nenhuma vistoria nesta seleção"}
          description={
            isDefaultQueue
              ? "As vistorias enviadas pelo aplicativo aparecem aqui assim que chegam. Use “Todas” para ver as já decididas."
              : "Nenhuma vistoria corresponde à situação, ao vistoriador, à divergência, ao período ou aos filtros da tela."
          }
          testId="tires-vistorias-empty"
        />
      ) : (
        <InspectionsTable rows={rows} kpis={k} onOpen={openDrawer} />
      )}

      <TiresPagination ctx={ctx} total={total} limit={limit} label="Paginação das vistorias" testId="tires-inspections-pagination" />

      <InspectionDrawer
        openId={openId}
        loading={openId !== null && openId !== urlId}
        detail={data.detail}
        detailError={data.detailError}
        onClose={closeDrawer}
        onOpen={openDrawer}
        ctx={ctx}
      />
    </div>
  );
}

/** Espera acima do SLA da etapa (revisão ou sincronização com o Rodopar). */
function overSla(row: TireInspectionRow, k: TiresInspectionsReceived["kpis"]): number | null {
  if (row.waitingDays == null) return null;
  if (row.status === "pendente_revisao" && row.waitingDays > k.reviewSlaDays) return k.reviewSlaDays;
  if (row.status === "pendente_rodopar" && row.waitingDays > k.rodoparSyncSlaDays) return k.rodoparSyncSlaDays;
  return null;
}

function InspectionsTable({
  rows, kpis, onOpen,
}: {
  rows: TireInspectionRow[];
  kpis: TiresInspectionsReceived["kpis"];
  onOpen: (id: string) => void;
}) {
  return (
    <TableContainer stickyHeader className="max-h-[70vh]" data-testid="tires-inspections-table">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Protocolo</TableHead>
            <TableHead>Placa / frota</TableHead>
            <TableHead>Operação / local</TableHead>
            <TableHead>Vistoriador</TableHead>
            <TableHead>Data</TableHead>
            <TableHead numeric className="whitespace-normal">Posições medidas</TableHead>
            <TableHead numeric>Divergentes</TableHead>
            <TableHead>Situação</TableHead>
            <TableHead numeric>Espera</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const sla = overSla(row, kpis);
            const place = [row.cityName, row.stateUf].filter(Boolean).join("/");
            return (
              <TableRow
                key={row.id}
                className="cursor-pointer"
                data-testid="tires-inspection-row"
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
                    data-testid="tires-inspection-open"
                  >
                    {row.protocol}
                    <span className="sr-only"> — abrir a vistoria</span>
                  </button>
                  {row.parentInspectionId ? <span className="block text-caption text-fg-muted">Nova medição</span> : null}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <PlateLink vehicleId={row.vehicleId} plate={row.licensePlate} fleetCode={row.fleetCode} />
                  {row.vehicleTypeName ? <span className="block text-caption text-fg-muted">{row.vehicleTypeName}</span> : null}
                </TableCell>
                <TableCell className="min-w-[9rem] max-w-[12rem] text-fg-secondary">
                  <span className="line-clamp-2">{row.operationName ?? "—"}</span>
                  {place || row.brCode ? (
                    <span className="block truncate text-caption text-fg-muted">{[place, row.brCode].filter(Boolean).join(" · ")}</span>
                  ) : null}
                </TableCell>
                <TableCell className="max-w-[9rem] truncate text-fg-secondary" title={row.inspectorName}>{row.inspectorName || "—"}</TableCell>
                <TableCell className="whitespace-nowrap tabular-nums" title={`Enviada em ${formatStamp(row.submittedAt)}`}>
                  {formatDate(row.inspectionDate)}
                </TableCell>
                <TableCell numeric className="whitespace-nowrap">
                  <span className={cn(row.positionsMeasured < row.positionsExpected && "text-warning-soft-fg")}>{fmtInt(row.positionsMeasured)}</span>
                  <span className="text-fg-muted"> / {fmtInt(row.positionsExpected)}</span>
                </TableCell>
                <TableCell numeric className={cn("whitespace-nowrap", row.positionsDivergent > 0 ? "font-semibold text-danger" : "text-fg-muted")}>
                  {fmtInt(row.positionsDivergent)}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <span className="flex flex-col items-start gap-1">
                    <StatusBadge status={INSPECTION_STATUS_TONE[row.status]} size="sm" title={INSPECTION_STATUS_LABEL[row.status]}>
                      {INSPECTION_STATUS_SHORT[row.status]}
                    </StatusBadge>
                    {row.persistentDivergence ? (
                      <StatusBadge status="danger" size="sm" withIcon data-testid="tires-inspection-persistent">Divergência persistente</StatusBadge>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell numeric className="whitespace-nowrap">
                  <span className="inline-flex flex-col items-end gap-1">
                    {row.waitingDays == null ? "—" : fmtDays(row.waitingDays)}
                    {sla != null ? (
                      <StatusBadge status="danger" size="sm" title={`Acima do SLA de ${fmtDays(sla)}`} data-testid="tires-inspection-over-sla">
                        Acima do SLA
                      </StatusBadge>
                    ) : null}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="sr-only">{fmtInt(rows.length)} {plural(rows.length, "vistoria nesta página", "vistorias nesta página")}</p>
    </TableContainer>
  );
}
