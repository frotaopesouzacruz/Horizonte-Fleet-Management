"use client";

import * as React from "react";
import Link from "next/link";
import { Ban, CarFront, ExternalLink, Pencil, Plus, Settings2, Wrench } from "lucide-react";
import { cn } from "@/lib/cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SegmentedControl, ToggleChip } from "@/components/ui/segmented-control";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { SwitchField } from "@/components/ui/switch";
import { Table, TableActionCell, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/governance/selects";
import { resolveRepairVehicle, saveTireRepair, voidTireRepair, type Result } from "@/lib/tires/actions";
import type { TiresTabData } from "@/lib/tires/loaders";
import {
  OPEN_STATUSES, STATUS_LABEL as MAINTENANCE_STATUS_LABEL, STATUS_TONE as MAINTENANCE_STATUS_TONE, typeLabel, type MaintenanceStatus,
} from "@/lib/maintenance/types";
import {
  CONFIDENCE_LABEL, fmt1, fmtInt, formatDate, formatStamp, modernTerms, RESOLUTION_LABEL, SERVICE_KIND_LABEL, STATUS_LABEL, TIRES_FILTER_PARAM,
  type RepairResolution, type ServiceKind, type TireFilterOptions, type TireMaintenanceServiceRow, type TireRepairRow,
  type TireRepairSuggestion, type TiresMaintenanceServices, type TiresRepairsList,
} from "@/lib/tires/types";
import type { TiresPanelContext } from "../shared";
import {
  FireLink, PanelEmpty, PanelError, PlateLink, plural, REASON_MIN, ReasonDialog, Section, SubTabs, TiresKpi, TiresPagination, useTiresLink,
} from "./tires-ui";

/**
 * Gestão de Pneus → Serviços.
 *
 * Consertos: registro por Nº Fogo; o veículo da data do serviço é resolvido
 * pelo banco (dados da data → dados anteriores → movimentação →
 * não resolvido; nunca a placa atual). Troca manual exige motivo; cancelar
 * exige motivo e nada é apagado. Sem custo nem valor nesta etapa.
 *
 * Alinhamento e balanceamento: SOMENTE leitura das manutenções da Gestão de
 * Manutenção cujos serviços foram mapeados em Parâmetros — não existe base
 * paralela de serviços de pneus.
 */
const TID = "tires-services";
type ServicesData = NonNullable<TiresTabData["servicos"]>;
type Sub = ServicesData["sub"];

const SUBS: { value: Sub; label: string }[] = [
  { value: "consertos", label: "Consertos" },
  { value: "alinhamento", label: "Alinhamento e balanceamento" },
];

export function ServicesPanel({ data, ctx }: { data: TiresTabData["servicos"] | null; ctx: TiresPanelContext }) {
  if (ctx.error) return <PanelError ctx={ctx} title="Não foi possível carregar os serviços de pneus." testId={`${TID}-error`} />;
  if (!data) {
    return (
      <PanelEmpty
        icon={<Wrench />}
        title="Sem dados de serviços"
        description="A leitura de consertos e serviços não devolveu resultado. Recarregue a página."
        testId={`${TID}-empty`}
      />
    );
  }
  return (
    <div className="flex flex-col gap-4" data-testid={TID} data-sub={data.sub}>
      <SubTabs ctx={ctx} value={data.sub} items={SUBS} label="Serviços de pneus" testIdPrefix={`${TID}-sub`} />
      {data.sub === "consertos" ? (
        data.repairs ? (
          <RepairsSection list={data.repairs} ctx={ctx} />
        ) : (
          <PanelEmpty icon={<Wrench />} title="Sem consertos" description="A rotina não devolveu a lista de consertos. Recarregue a página." testId={`${TID}-repairs-empty`} />
        )
      ) : data.maintenance ? (
        <MaintenanceSection data={data.maintenance} ctx={ctx} />
      ) : (
        <PanelEmpty
          icon={<Wrench />}
          title="Sem serviços da Manutenção"
          description="A leitura da Gestão de Manutenção não devolveu resultado. Recarregue a página."
          testId={`${TID}-maintenance-empty`}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Peças comuns
// ---------------------------------------------------------------------------
function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Período (`de`/`ate`) na URL; a troca zera a página. */
function PeriodFilter({ ctx, label, testId }: { ctx: TiresPanelContext; label: string; testId: string }) {
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <span className="text-caption text-fg-muted">{label}</span>
      <div className="flex items-center gap-1.5">
        <DateInput
          size="sm"
          aria-label={`${label}: de`}
          value={ctx.params.de ?? ""}
          max={ctx.params.ate || undefined}
          disabled={ctx.pending}
          onChange={(e) => ctx.navigate({ de: e.target.value || null, pagina: null })}
          wrapperClassName="w-[9.5rem]"
        />
        <span className="text-caption text-fg-muted">até</span>
        <DateInput
          size="sm"
          aria-label={`${label}: até`}
          value={ctx.params.ate ?? ""}
          min={ctx.params.de || undefined}
          disabled={ctx.pending}
          onChange={(e) => ctx.navigate({ ate: e.target.value || null, pagina: null })}
          wrapperClassName="w-[9.5rem]"
        />
      </div>
    </div>
  );
}

const RESOLUTION_TONE: Record<RepairResolution, StatusTone> = {
  snapshot_exact: "success",
  snapshot_previous: "info",
  event: "progress",
  manual: "warning",
  unresolved: "danger",
};

const confidenceLabel = (c: string | null | undefined) => (c ? (CONFIDENCE_LABEL[c] ?? c) : null);

// ---------------------------------------------------------------------------
// Consertos
// ---------------------------------------------------------------------------
type Registro = "active" | "voided" | "all";
const REGISTRO_OPTIONS: { value: Registro; label: string }[] = [
  { value: "active", label: "Ativos" },
  { value: "voided", label: "Cancelados" },
  { value: "all", label: "Todos" },
];

function RepairsSection({ list, ctx }: { list: TiresRepairsList; ctx: TiresPanelContext }) {
  const link = useTiresLink(ctx);
  const [editing, setEditing] = React.useState<{ repair: TireRepairRow | null } | null>(null);
  const [voiding, setVoiding] = React.useState<TireRepairRow | null>(null);
  const canManage = ctx.perms.servicesManage;
  const registro: Registro = ctx.params.registro === "voided" || ctx.params.registro === "all" ? ctx.params.registro : "active";
  const serviceName = React.useMemo(() => new Map(list.services.map((s) => [s.id, s.name])), [list.services]);
  const anyFilter = Boolean(registro !== "active" || ctx.params.de || ctx.params.ate || ctx.filters.q);
  const k = list.kpis;
  const scope = registro === "active" ? "ativos" : registro === "voided" ? "cancelados" : "ativos e cancelados";

  return (
    <Section
      title="Consertos por Nº Fogo"
      testId={`${TID}-repairs`}
      description="O veículo de cada conserto é o da data do serviço, resolvido pela base oficial (Rodopar) daquela data (nunca a placa atual). Consertos não alteram a base oficial nem têm valor nesta etapa."
      actions={
        canManage ? (
          <Button size="sm" leadingIcon={<Plus />} onClick={() => setEditing({ repair: null })} data-testid={`${TID}-repair-new`}>
            Registrar conserto
          </Button>
        ) : null
      }
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <TiresKpi kpi="repairs-total" label="Consertos" value={fmtInt(k.total)} period={scope} />
        <TiresKpi kpi="repairs-tires" label="Pneus consertados" value={fmtInt(k.tires)} period="Nº Fogo distintos" />
        <TiresKpi
          kpi="repairs-unresolved"
          label="Sem veículo resolvido"
          value={fmtInt(k.unresolved)}
          status={k.unresolved > 0 ? "warning" : undefined}
          period="sem dados do pneu em uso na data"
        />
        <TiresKpi kpi="repairs-manual" label="Veículo informado manualmente" value={fmtInt(k.manual)} period="com motivo registrado" />
        <div className="col-span-2 flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-surface-raised px-3.5 py-3 shadow-card lg:col-span-1" data-testid="tires-kpi-repairs-types">
          <h3 className="text-caption font-semibold tracking-wide text-fg-muted uppercase">Tipos mais frequentes</h3>
          {k.topTypes.length ? (
            <ul className="flex flex-col gap-0.5">
              {k.topTypes.map((t) => {
                const nav = link({ [TIRES_FILTER_PARAM.q]: t.type });
                return (
                  <li key={t.type} className="flex items-center justify-between gap-2 text-body-sm">
                    <a
                      href={nav.href}
                      onClick={nav.onClick}
                      className="min-w-0 truncate rounded-xs text-fg underline-offset-2 hover:text-primary hover:underline hfm-focus-ring"
                      title={`Filtrar por ${t.type}`}
                    >
                      {t.type}
                    </a>
                    <span className="shrink-0 font-semibold tabular-nums text-fg">{fmtInt(t.count)}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <span className="text-body-sm text-fg-muted">—</span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3" data-testid={`${TID}-repairs-filters`}>
        <div className="flex flex-col gap-1">
          <span className="text-caption text-fg-muted" id={`${TID}-registro-label`}>Registros</span>
          <SegmentedControl
            aria-label="Registros"
            value={registro}
            options={REGISTRO_OPTIONS.map((o) => ({ ...o, "data-testid": `${TID}-registro-${o.value}` }))}
            onValueChange={(v) => ctx.navigate({ registro: v === "active" ? null : v, pagina: null })}
            disabled={ctx.pending}
          />
        </div>
        <PeriodFilter ctx={ctx} label="Data do serviço" testId={`${TID}-repairs-period`} />
        {anyFilter ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => ctx.navigate({ registro: null, de: null, ate: null, [TIRES_FILTER_PARAM.q]: null, pagina: null })}
          >
            Limpar filtros
          </Button>
        ) : null}
        <p className="text-caption tabular-nums text-fg-muted sm:ml-auto">
          {fmtInt(list.total)} {plural(list.total, "conserto", "consertos")}
        </p>
      </div>

      {list.rows.length === 0 ? (
        <PanelEmpty
          icon={<Wrench />}
          title="Nenhum conserto"
          description={
            anyFilter
              ? "Nenhum conserto corresponde aos filtros. Ajuste o período, a situação ou a busca."
              : "Nenhum conserto registrado ainda. Registre pelo Nº Fogo: o veículo da data é resolvido pela base oficial (Rodopar)."
          }
          testId={`${TID}-repairs-none`}
          action={
            canManage && !anyFilter ? (
              <Button size="sm" leadingIcon={<Plus />} onClick={() => setEditing({ repair: null })}>
                Registrar conserto
              </Button>
            ) : undefined
          }
        />
      ) : (
        <TableContainer stickyHeader className="max-h-[70vh]" data-testid={`${TID}-repairs-table`}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Nº Fogo</TableHead>
                <TableHead className="min-w-[12rem]">Tipo e observação</TableHead>
                <TableHead className="min-w-[13rem]">Veículo na data</TableHead>
                <TableHead>Fornecedor · OS</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Registrado por</TableHead>
                {canManage ? (
                  <TableHead>
                    <span className="sr-only">Ações</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.rows.map((r) => {
                const resolutionNote = [
                  confidenceLabel(r.resolutionConfidence) ? `confiança ${confidenceLabel(r.resolutionConfidence)?.toLowerCase()}` : null,
                  r.resolutionReferenceDate ? `dados de ${formatDate(r.resolutionReferenceDate)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <TableRow key={r.id} data-testid={`${TID}-repair-row`} data-status={r.status} className={cn("align-top", r.status === "voided" && "opacity-75")}>
                    <TableCell className="whitespace-nowrap py-2 tabular-nums">{formatDate(r.serviceDate)}</TableCell>
                    <TableCell className="whitespace-nowrap py-2">
                      <FireLink tireId={r.tireId} fireNumber={r.fireNumberSnapshot} />
                    </TableCell>
                    <TableCell className="max-w-[18rem] py-2">
                      <span className="font-medium text-fg">{r.repairType}</span>
                      {r.serviceId && serviceName.get(r.serviceId) ? (
                        <span className="block text-caption text-fg-muted">Serviço: {serviceName.get(r.serviceId)}</span>
                      ) : null}
                      {r.notes ? <span className="block text-caption text-fg-secondary">{r.notes}</span> : null}
                    </TableCell>
                    <TableCell className="py-2">
                      {r.vehicleId || r.licensePlateSnapshot || r.fleetCodeSnapshot ? (
                        <span className="block whitespace-nowrap">
                          <PlateLink vehicleId={r.vehicleId} plate={r.licensePlateSnapshot} fleetCode={r.fleetCodeSnapshot} />
                          {r.positionCodeSnapshot ? <span className="text-caption text-fg-muted"> · posição {r.positionCodeSnapshot}</span> : null}
                        </span>
                      ) : (
                        <span className="block text-body-sm text-fg-muted">Sem veículo</span>
                      )}
                      <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                        <StatusBadge status={RESOLUTION_TONE[r.vehicleResolution] ?? "neutral"} size="sm">
                          {RESOLUTION_LABEL[r.vehicleResolution] ?? r.vehicleResolution}
                        </StatusBadge>
                        {resolutionNote ? <span className="text-caption text-fg-muted">{resolutionNote}</span> : null}
                      </span>
                      {r.overrideReason ? (
                        <span className="mt-0.5 block max-w-[18rem] text-caption text-fg-secondary">Motivo da troca: {r.overrideReason}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="py-2 text-fg-secondary">
                      <span className="block max-w-[12rem] truncate" title={r.supplierNameSnapshot ?? undefined}>{r.supplierNameSnapshot ?? "Sem fornecedor"}</span>
                      <span className="block whitespace-nowrap text-caption tabular-nums text-fg-muted">{r.serviceOrderNumber ?? "sem OS"}</span>
                    </TableCell>
                    <TableCell className="py-2">
                      <StatusBadge status={r.status === "active" ? "success" : "neutral"} size="sm">{r.status === "active" ? "Ativo" : "Cancelado"}</StatusBadge>
                      {r.status === "voided" && r.voidReason ? (
                        <span className="mt-0.5 block max-w-[12rem] text-caption text-fg-muted" title={r.voidReason}>{r.voidReason}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="py-2 text-fg-secondary">
                      <span className="block max-w-[11rem] truncate" title={r.createdByName ?? undefined}>{r.createdByName ?? "—"}</span>
                      <span className="block whitespace-nowrap text-caption tabular-nums text-fg-muted">{formatStamp(r.createdAt)}</span>
                    </TableCell>
                    {canManage ? (
                      <TableActionCell className="py-1.5">
                        {r.status === "active" ? (
                          <span className="flex gap-0.5">
                            <IconButton size="sm" label={`Editar o conserto do pneu ${r.fireNumberSnapshot}`} onClick={() => setEditing({ repair: r })} data-testid={`${TID}-repair-edit`}>
                              <Pencil aria-hidden />
                            </IconButton>
                            <IconButton size="sm" label={`Cancelar o conserto do pneu ${r.fireNumberSnapshot}`} onClick={() => setVoiding(r)} data-testid={`${TID}-repair-void`}>
                              <Ban aria-hidden />
                            </IconButton>
                          </span>
                        ) : null}
                      </TableActionCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <TiresPagination ctx={ctx} total={list.total} limit={list.limit} label="Paginação dos consertos" testId={`${TID}-repairs-pagination`} />

      {editing ? (
        <RepairDialog
          key={editing.repair?.id ?? "new"}
          repair={editing.repair}
          list={list}
          vehicles={ctx.options?.vehicles ?? null}
          onClose={() => setEditing(null)}
          onDone={ctx.refresh}
        />
      ) : null}

      <ReasonDialog
        open={voiding !== null}
        onOpenChange={(o) => (!o ? setVoiding(null) : undefined)}
        title="Cancelar este conserto?"
        description={
          voiding
            ? `${voiding.repairType} do pneu ${voiding.fireNumberSnapshot} em ${formatDate(voiding.serviceDate)}. O registro não é apagado: fica como cancelado, com o motivo na trilha.`
            : undefined
        }
        confirmLabel="Confirmar cancelamento"
        destructive
        onConfirm={(reason) => (voiding ? voidTireRepair(voiding.id, reason) : Promise.resolve({ ok: false, error: "Conserto não encontrado." }))}
        successTitle="Conserto cancelado"
        onDone={ctx.refresh}
        testId={`${TID}-void-dialog`}
      />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Registrar / editar conserto
// ---------------------------------------------------------------------------
type Vehicles = TireFilterOptions["vehicles"] | null;
type Resolution = Result<TireRepairSuggestion> | "loading" | null;

function RepairDialog({
  repair, list, vehicles, onClose, onDone,
}: {
  repair: TireRepairRow | null;
  list: TiresRepairsList;
  vehicles: Vehicles;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const today = React.useMemo(() => todayIso(), []);
  const listId = React.useId();
  const manualInitially = repair?.vehicleResolution === "manual";
  const [fireNumber, setFireNumber] = React.useState(repair?.fireNumberSnapshot ?? "");
  const [serviceDate, setServiceDate] = React.useState(repair?.serviceDate ?? today);
  const [repairType, setRepairType] = React.useState(repair?.repairType ?? "");
  const [supplierId, setSupplierId] = React.useState(repair?.supplierId ?? "");
  const [serviceId, setServiceId] = React.useState(repair?.serviceId ?? "");
  const [serviceOrder, setServiceOrder] = React.useState(repair?.serviceOrderNumber ?? "");
  const [notes, setNotes] = React.useState(repair?.notes ?? "");
  const [override, setOverride] = React.useState(manualInitially);
  const [vehicleId, setVehicleId] = React.useState(manualInitially ? (repair?.vehicleId ?? "") : "");
  const [overrideReason, setOverrideReason] = React.useState(manualInitially ? (repair?.overrideReason ?? "") : "");
  const [touched, setTouched] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [reasonServerError, setReasonServerError] = React.useState<string | null>(null);

  // Nº Fogo é texto: só tira espaços das pontas (o banco normaliza do mesmo jeito para buscar).
  const fire = fireNumber.trim();
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(serviceDate) && serviceDate <= today;
  const key = fire && dateOk ? `${fire}|${serviceDate}` : null;
  const [resolved, setResolved] = React.useState<{ key: string; result: Result<TireRepairSuggestion> } | null>(null);

  React.useEffect(() => {
    if (!key) return;
    let alive = true;
    const [f, d] = key.split("|");
    const timer = window.setTimeout(() => {
      resolveRepairVehicle(f, d).then(
        (result) => {
          if (alive) setResolved({ key, result });
        },
        () => {
          if (alive) setResolved({ key, result: { ok: false, error: "A conexão com o servidor caiu ao consultar a base oficial." } });
        },
      );
    }, 400);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [key]);

  const resolution: Resolution = !key ? null : resolved?.key === key ? resolved.result : "loading";
  const notFound = resolution !== null && resolution !== "loading" && resolution.ok && resolution.data?.found === false;

  const sortedVehicles = React.useMemo(
    () => [...(vehicles ?? [])].sort((a, b) => (a.plate ?? a.fleet ?? "").localeCompare(b.plate ?? b.fleet ?? "", "pt-BR")),
    [vehicles],
  );

  const errors = {
    fire: !fire ? "Informe o Nº Fogo." : notFound ? "Nº Fogo não encontrado no cadastro de pneus." : null,
    date: !serviceDate ? "Informe a data do serviço." : !dateOk ? "A data do serviço não pode ser futura." : null,
    type: repairType.trim().length < 2 ? "Informe o tipo de conserto (2 a 80 caracteres)." : repairType.trim().length > 80 ? "Use no máximo 80 caracteres." : null,
    vehicle: override && !vehicleId ? "Escolha o veículo." : null,
    reason:
      reasonServerError ?? (override && overrideReason.trim().length < REASON_MIN ? `Justifique a troca com pelo menos ${REASON_MIN} caracteres.` : null),
  };
  const invalid = Object.values(errors).some(Boolean);
  const show = (msg: string | null) => (touched && msg ? msg : undefined);

  const save = async () => {
    setTouched(true);
    setServerError(null);
    if (invalid) return;
    setBusy(true);
    let r: Result<{ id: string }>;
    try {
      r = await saveTireRepair({
        id: repair?.id ?? null,
        fireNumber: fire,
        serviceDate,
        repairType: repairType.trim(),
        serviceId: serviceId || null,
        supplierId: supplierId || null,
        serviceOrderNumber: serviceOrder.trim() || null,
        notes: notes.trim() || null,
        vehicleId: override ? vehicleId : null,
        overrideReason: override ? overrideReason.trim() : null,
      });
    } catch {
      r = { ok: false, error: "A conexão com o servidor caiu. Tente de novo." };
    } finally {
      setBusy(false);
    }
    if (!r.ok) {
      if (r.code === "tire_repair_override_reason") setReasonServerError(r.error ?? "Justifique a troca do veículo.");
      else setServerError(r.error ?? "Não foi possível salvar o conserto.");
      toast({ title: "O conserto não foi salvo", description: r.error, variant: "danger" });
      return;
    }
    toast({ title: repair ? "Conserto atualizado" : "Conserto registrado", description: `Pneu ${fire} · ${formatDate(serviceDate)}.`, variant: "success" });
    onClose();
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => (!o && !busy ? onClose() : undefined)}>
      <DialogContent size="lg" data-testid={`${TID}-repair-dialog`}>
        <DialogHeader>
          <DialogTitle>{repair ? "Editar conserto" : "Registrar conserto"}</DialogTitle>
          <DialogDescription>
            Pelo Nº Fogo e pela data do serviço o banco localiza onde o pneu estava naquela data. Sem custo nem valor nesta etapa.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Nº Fogo" required error={show(errors.fire)} helperText="Exatamente como no Rodopar (texto).">
              <Input
                value={fireNumber}
                onChange={(e) => setFireNumber(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                autoFocus={!repair}
                disabled={busy}
                data-testid={`${TID}-repair-fire`}
              />
            </FormField>
            <FormField label="Data do serviço" required error={show(errors.date)}>
              <DateInput value={serviceDate} max={today} onChange={(e) => setServiceDate(e.currentTarget.value)} disabled={busy} data-testid={`${TID}-repair-date`} />
            </FormField>
          </div>

          <SuggestionCard resolution={resolution} />

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Tipo de conserto" required error={show(errors.type)} helperText="Escolha um tipo já usado ou escreva um novo.">
              <Input
                value={repairType}
                onChange={(e) => setRepairType(e.target.value)}
                list={listId}
                maxLength={80}
                autoComplete="off"
                disabled={busy}
                data-testid={`${TID}-repair-type`}
              />
            </FormField>
            <datalist id={listId}>
              {list.knownTypes.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <FormField label="Fornecedor" labelHint="Opcional" helperText="Cadastro de fornecedores da Manutenção.">
              <NativeSelect value={supplierId} onChange={(e) => setSupplierId(e.target.value)} disabled={busy} data-testid={`${TID}-repair-supplier`}>
                <option value="">Sem fornecedor</option>
                {list.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField
              label="Serviço do catálogo da Manutenção"
              labelHint="Opcional"
              helperText={list.services.length ? "Serviços mapeados como “Serviço de pneu” em Parâmetros." : "Nenhum serviço mapeado como “Serviço de pneu” em Parâmetros."}
            >
              <NativeSelect value={serviceId} onChange={(e) => setServiceId(e.target.value)} disabled={busy || !list.services.length} data-testid={`${TID}-repair-service`}>
                <option value="">Sem serviço do catálogo</option>
                {list.services.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Nº da OS" labelHint="Opcional">
              <Input value={serviceOrder} onChange={(e) => setServiceOrder(e.target.value)} maxLength={60} disabled={busy} data-testid={`${TID}-repair-os`} />
            </FormField>
          </div>
          <FormField label="Observação" labelHint="Opcional">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} disabled={busy} data-testid={`${TID}-repair-notes`} />
          </FormField>

          <div className="flex flex-col gap-3 rounded-md border border-border p-3">
            <SwitchField
              label="Informar outro veículo"
              description="Use só quando os dados do Rodopar não refletem onde o pneu estava. A troca fica registrada com o motivo."
              checked={override}
              onCheckedChange={(v) => {
                setOverride(v);
                setReasonServerError(null);
              }}
              disabled={busy}
              data-testid={`${TID}-repair-override`}
            />
            {override ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Veículo" required error={show(errors.vehicle)}>
                  {vehicles ? (
                    <NativeSelect value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} disabled={busy} data-testid={`${TID}-repair-vehicle`}>
                      <option value="">Escolha o veículo</option>
                      {sortedVehicles.map((v) => (
                        <option key={v.id} value={v.id}>
                          {[v.plate, v.fleet].filter(Boolean).join(" · ") || v.id}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : (
                    <p className="text-body-sm text-danger">A lista de veículos não carregou. Recarregue a página para trocar o veículo.</p>
                  )}
                </FormField>
                <FormField label="Motivo da troca" required error={show(errors.reason) ?? reasonServerError ?? undefined} helperText={`Mínimo de ${REASON_MIN} caracteres; fica na trilha.`}>
                  <Textarea
                    value={overrideReason}
                    onChange={(e) => {
                      setOverrideReason(e.target.value);
                      setReasonServerError(null);
                    }}
                    rows={2}
                    disabled={busy}
                    data-testid={`${TID}-repair-override-reason`}
                  />
                </FormField>
              </div>
            ) : null}
          </div>

          {serverError ? (
            <Alert variant="danger" data-testid={`${TID}-repair-error`}>
              <AlertTitle>Não foi possível salvar</AlertTitle>
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Voltar
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={touched && invalid} data-testid={`${TID}-repair-save`}>
            {repair ? "Salvar alterações" : "Registrar conserto"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** O que o banco respondeu sobre o veículo do pneu na data do serviço. */
function SuggestionCard({ resolution }: { resolution: Resolution }) {
  const frame = "flex flex-col gap-1.5 rounded-md border px-3 py-2.5 text-body-sm";
  if (resolution === null) {
    return (
      <div className={cn(frame, "border-border bg-surface-sunken text-fg-muted")} data-testid={`${TID}-repair-suggestion`} data-state="idle">
        <span className="flex items-center gap-2">
          <CarFront className="size-4 shrink-0" aria-hidden />
          Informe o Nº Fogo e a data do serviço para localizar o veículo na data.
        </span>
      </div>
    );
  }
  if (resolution === "loading") {
    return (
      <div className={cn(frame, "border-border bg-surface-sunken text-fg-muted")} aria-live="polite" data-testid={`${TID}-repair-suggestion`} data-state="loading">
        Consultando a base oficial (Rodopar)…
      </div>
    );
  }
  if (!resolution.ok || !resolution.data) {
    return (
      <div className={cn(frame, "border-danger-border bg-danger-soft text-danger-soft-fg")} aria-live="polite" data-testid={`${TID}-repair-suggestion`} data-state="error">
        <span className="font-semibold">Não foi possível consultar a base oficial.</span>
        <span>{resolution.error ?? "Tente de novo."} O banco resolve o veículo de novo ao salvar.</span>
      </div>
    );
  }
  const d = resolution.data;
  if (!d.found || !d.tire) {
    return (
      <div className={cn(frame, "border-warning-border bg-warning-soft text-warning-soft-fg")} aria-live="polite" data-testid={`${TID}-repair-suggestion`} data-state="not-found">
        <span className="font-semibold">Nº Fogo não encontrado no cadastro de pneus.</span>
        <span>Confira o número exatamente como no Rodopar. Só pneus que já vieram nos dados do Rodopar podem receber conserto.</span>
      </div>
    );
  }
  const s = d.suggestion;
  const resolved = s && s.resolution !== "unresolved" && (s.licensePlate || s.fleetCode);
  const where = s ? [s.licensePlate, s.fleetCode].filter(Boolean).join(" · ") : "";
  const source =
    s?.resolution === "event"
      ? `segundo a movimentação registrada em ${formatDate(s.referenceDate)}`
      : `segundo os dados de ${formatDate(s?.referenceDate)}`;
  return (
    <div
      className={cn(frame, resolved ? "border-info-border bg-info-soft text-info-soft-fg" : "border-warning-border bg-warning-soft text-warning-soft-fg")}
      aria-live="polite"
      data-testid={`${TID}-repair-suggestion`}
      data-state={resolved ? "resolved" : "unresolved"}
    >
      <span className="text-caption">
        Pneu <strong className="font-semibold tabular-nums">{d.tire.fireNumber}</strong>
        {[d.tire.brand, d.tire.model, d.tire.dimension].filter(Boolean).length ? ` · ${[d.tire.brand, d.tire.model, d.tire.dimension].filter(Boolean).join(" · ")}` : ""} ·
        hoje: {STATUS_LABEL[d.tire.currentStatus] ?? d.tire.currentStatus}
      </span>
      {resolved && s ? (
        <span>
          Na data, o pneu estava em <strong className="font-semibold tabular-nums">{where}</strong>
          {s.positionCode ? <>, posição <strong className="font-semibold">{s.positionCode}</strong></> : null}, {source}.
        </span>
      ) : (
        <span>
          <strong className="font-semibold">Veículo não resolvido na data.</strong> {modernTerms(s?.message)} Informe o veículo manualmente se souber onde o pneu estava.
        </span>
      )}
      {s ? (
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={RESOLUTION_TONE[s.resolution] ?? "neutral"} size="sm">{RESOLUTION_LABEL[s.resolution] ?? s.resolution}</StatusBadge>
          {confidenceLabel(s.confidence) ? (
            <Badge variant="neutral" appearance="outline" size="sm">Confiança {confidenceLabel(s.confidence)?.toLowerCase()}</Badge>
          ) : null}
          {resolved && s.message ? <span className="text-caption">{modernTerms(s.message)}</span> : null}
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alinhamento e balanceamento (leitura da Gestão de Manutenção)
// ---------------------------------------------------------------------------
const KINDS = Object.keys(SERVICE_KIND_LABEL) as ServiceKind[];
const KIND_TONE: Record<ServiceKind, "info" | "progress" | "accent" | "neutral"> = {
  alignment: "info",
  balancing: "progress",
  alignment_balancing: "accent",
  tire_service: "neutral",
};
const MAINTENANCE_STATUSES = Object.keys(MAINTENANCE_STATUS_LABEL) as MaintenanceStatus[];

const splitParam = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function MaintenanceSection({ data, ctx }: { data: TiresMaintenanceServices; ctx: TiresPanelContext }) {
  const link = useTiresLink(ctx);
  const kinds = splitParam(ctx.params.servico);
  const statuses = splitParam(ctx.params.status_manutencao);
  const anyFilter = Boolean(kinds.length || statuses.length || ctx.params.de || ctx.params.ate || ctx.filters.q);
  const k = data.kpis;
  const toggle = (list: string[], value: string, on: boolean) => (on ? [...list, value] : list.filter((v) => v !== value)).join(",") || null;
  const parametersHref = `${ctx.basePath}?aba=parametros&sub=servicos`;

  return (
    <Section
      title="Alinhamento, balanceamento e serviços de pneu"
      testId={`${TID}-maintenance`}
      description="Manutenções da Gestão de Manutenção que contêm serviços mapeados como alinhamento, balanceamento ou serviço de pneu. Somente leitura: abrir, agendar e concluir é feito na Gestão de Manutenção."
    >
      <Alert variant={data.mappedServices > 0 ? "info" : "warning"} data-testid={`${TID}-maintenance-source`}>
        <AlertTitle>Fonte: Gestão de Manutenção — não há base paralela</AlertTitle>
        <AlertDescription>
          <p>
            {data.mappedServices > 0
              ? `${fmtInt(data.mappedServices)} ${plural(data.mappedServices, "serviço do catálogo da Manutenção está mapeado", "serviços do catálogo da Manutenção estão mapeados")} para esta lista. Uma manutenção entra aqui quando tem ao menos um desses serviços.`
              : "Nenhum serviço do catálogo da Manutenção está mapeado como alinhamento, balanceamento ou serviço de pneu: a lista fica vazia até o mapeamento."}
          </p>
          {ctx.perms.parameters ? (
            <Link href={parametersHref} className="mt-1 inline-flex items-center gap-1 rounded-xs font-medium underline underline-offset-2 hfm-focus-ring" data-testid={`${TID}-maintenance-mapping`}>
              <Settings2 className="size-3.5" aria-hidden />
              Mapear serviços em Parâmetros
            </Link>
          ) : null}
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <TiresKpi kpi="services-total" label="Manutenções" value={fmtInt(k.total)} period="com serviço mapeado" />
        <TiresKpi
          kpi="services-alignment"
          label={SERVICE_KIND_LABEL.alignment}
          value={fmtInt(k.alignment)}
          nav={link({ servico: "alignment" })}
          destination="filtrar por alinhamento"
        />
        <TiresKpi
          kpi="services-balancing"
          label={SERVICE_KIND_LABEL.balancing}
          value={fmtInt(k.balancing)}
          nav={link({ servico: "balancing" })}
          destination="filtrar por balanceamento"
        />
        <TiresKpi
          kpi="services-both"
          label="Alinhamento e balanceamento"
          value={fmtInt(k.alignmentBalancing)}
          nav={link({ servico: "alignment_balancing" })}
          destination="filtrar por alinhamento e balanceamento"
        />
        <TiresKpi
          kpi="services-tire"
          label={SERVICE_KIND_LABEL.tire_service}
          value={fmtInt(k.tireService)}
          nav={link({ servico: "tire_service" })}
          destination="filtrar por serviço de pneu"
        />
        <TiresKpi
          kpi="services-open"
          label="Abertas"
          value={fmtInt(k.open)}
          status={k.open > 0 ? "warning" : undefined}
          nav={link({ status_manutencao: OPEN_STATUSES.join(",") })}
          destination="filtrar as abertas"
          period="há agendar, agendadas, em execução"
        />
        <TiresKpi
          kpi="services-completed"
          label="Concluídas"
          value={fmtInt(k.completed)}
          status={k.completed > 0 ? "success" : undefined}
          nav={link({ status_manutencao: "completed" })}
          destination="filtrar as concluídas"
        />
        <TiresKpi kpi="services-days" label="Dias médios na oficina" value={k.avgDays == null ? "—" : fmt1(k.avgDays)} unit={k.avgDays == null ? undefined : "dias"} period="entrada → saída, concluídas" />
      </div>

      <div className="flex flex-col gap-3" data-testid={`${TID}-maintenance-filters`}>
        <div className="flex flex-col gap-1">
          <span className="text-caption text-fg-muted" id={`${TID}-kind-label`}>Tipo de serviço</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={`${TID}-kind-label`}>
            {KINDS.map((kind) => (
              <ToggleChip
                key={kind}
                pressed={kinds.includes(kind)}
                disabled={ctx.pending}
                onPressedChange={(on) => ctx.navigate({ servico: toggle(kinds, kind, on), pagina: null })}
                data-testid={`${TID}-kind-${kind}`}
              >
                {SERVICE_KIND_LABEL[kind]}
              </ToggleChip>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-caption text-fg-muted" id={`${TID}-status-label`}>Situação da manutenção</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={`${TID}-status-label`}>
              {MAINTENANCE_STATUSES.map((s) => (
                <ToggleChip
                  key={s}
                  pressed={statuses.includes(s)}
                  disabled={ctx.pending}
                  onPressedChange={(on) => ctx.navigate({ status_manutencao: toggle(statuses, s, on), pagina: null })}
                  data-testid={`${TID}-status-${s}`}
                >
                  {MAINTENANCE_STATUS_LABEL[s]}
                </ToggleChip>
              ))}
            </div>
          </div>
          <PeriodFilter ctx={ctx} label="Data da solicitação" testId={`${TID}-maintenance-period`} />
          {anyFilter ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => ctx.navigate({ servico: null, status_manutencao: null, de: null, ate: null, [TIRES_FILTER_PARAM.q]: null, pagina: null })}
            >
              Limpar filtros
            </Button>
          ) : null}
          <p className="text-caption tabular-nums text-fg-muted sm:ml-auto">
            {fmtInt(data.total)} {plural(data.total, "manutenção", "manutenções")}
          </p>
        </div>
      </div>

      {data.rows.length === 0 ? (
        <PanelEmpty
          icon={<Wrench />}
          title="Nenhuma manutenção"
          description={
            anyFilter
              ? "Nenhuma manutenção corresponde aos filtros. Ajuste o tipo, a situação, o período ou a busca."
              : "Nenhuma manutenção com serviço mapeado foi aberta na Gestão de Manutenção."
          }
          testId={`${TID}-maintenance-none`}
        />
      ) : (
        <MaintenanceTable rows={data.rows} />
      )}

      <TiresPagination ctx={ctx} total={data.total} limit={data.limit} label="Paginação das manutenções" testId={`${TID}-maintenance-pagination`} />
    </Section>
  );
}

function MaintenanceTable({ rows }: { rows: TireMaintenanceServiceRow[] }) {
  return (
    <TableContainer stickyHeader className="max-h-[70vh]" data-testid={`${TID}-maintenance-table`}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Manutenção</TableHead>
            <TableHead>Veículo</TableHead>
            <TableHead className="min-w-[13rem]">Tipo e serviços</TableHead>
            <TableHead>Situação</TableHead>
            <TableHead>Datas</TableHead>
            <TableHead>Fornecedor · OS</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((m) => {
            const status = m.status as MaintenanceStatus;
            return (
              <TableRow key={m.id} data-testid={`${TID}-maintenance-row`} data-kind={m.kind} className="align-top">
                <TableCell className="whitespace-nowrap py-2">
                  <Link
                    href={`/frota/manutencao?q=${encodeURIComponent(m.code)}`}
                    className="inline-flex items-center gap-1 rounded-xs font-semibold tabular-nums text-fg underline-offset-2 hover:text-primary hover:underline hfm-focus-ring"
                    data-testid={`${TID}-maintenance-link`}
                  >
                    {m.code}
                    <ExternalLink className="size-3.5 text-fg-muted" aria-hidden />
                    <span className="sr-only"> — abrir na Gestão de Manutenção</span>
                  </Link>
                  {m.maintenanceTypeCode ? <span className="block text-caption text-fg-muted">{typeLabel(m.maintenanceTypeCode)}</span> : null}
                </TableCell>
                <TableCell className="whitespace-nowrap py-2">
                  <PlateLink vehicleId={m.vehicleId} plate={m.licensePlateSnapshot} fleetCode={m.fleetCodeSnapshot} />
                  {m.operationNameSnapshot || m.cityNameSnapshot ? (
                    <span className="block max-w-[12rem] truncate text-caption text-fg-muted" title={[m.operationNameSnapshot, m.cityNameSnapshot, m.stateUfSnapshot].filter(Boolean).join(" · ")}>
                      {[m.operationNameSnapshot, [m.cityNameSnapshot, m.stateUfSnapshot].filter(Boolean).join("/")].filter(Boolean).join(" · ")}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="max-w-[18rem] py-2">
                  <Badge variant={KIND_TONE[m.kind] ?? "neutral"} size="sm">{SERVICE_KIND_LABEL[m.kind] ?? m.kind}</Badge>
                  {m.services ? <span className="mt-1 block text-caption text-fg-secondary">{m.services}</span> : null}
                </TableCell>
                <TableCell className="py-2">
                  <StatusBadge status={MAINTENANCE_STATUS_TONE[status] ?? "neutral"} size="sm">{MAINTENANCE_STATUS_LABEL[status] ?? m.status}</StatusBadge>
                </TableCell>
                <TableCell className="whitespace-nowrap py-2 text-caption tabular-nums">
                  <MaintenanceDates m={m} />
                </TableCell>
                <TableCell className="py-2 text-fg-secondary">
                  <span className="block max-w-[13rem] truncate" title={m.supplierName ?? undefined}>{m.supplierName ?? "Sem fornecedor"}</span>
                  <span className="block whitespace-nowrap text-caption tabular-nums text-fg-muted">{m.serviceOrderNumber ?? "sem OS"}</span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function MaintenanceDates({ m }: { m: TireMaintenanceServiceRow }) {
  const lines: [string, string | null][] = [
    ["Solicitada", m.requestedOn],
    ["Agendada", m.scheduledDate],
    ["Entrada", m.entryDate],
    ["Saída", m.exitDate],
  ];
  const shown = lines.filter(([, v]) => v);
  if (!shown.length) return <span className="text-fg-muted">—</span>;
  return (
    <dl className="grid grid-cols-[auto_auto] gap-x-2 gap-y-0.5">
      {shown.map(([label, v]) => (
        <React.Fragment key={label}>
          <dt className="text-fg-muted">{label}</dt>
          <dd className="text-fg">{formatDate(v)}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
