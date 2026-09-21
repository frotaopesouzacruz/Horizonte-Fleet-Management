"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Gauge, Pencil } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerBody,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { LoadingState } from "@/components/feedback/loading-state";
import { EmptyState } from "@/components/feedback/empty-state";
import { useToast } from "@/components/feedback/toast";
import {
  OWNERSHIP_LABELS,
  VEHICLE_STATUS_LABELS,
  ODOMETER_SOURCE_LABELS,
} from "@/lib/fleet/columns";
import type { VehicleDetail } from "@/lib/fleet/queries";
import { correctOdometer, setVehicleAssignment } from "@/lib/fleet/actions";
import { loadVehicleDetail, loadVehicleTimeline, type TimelineEntry } from "@/lib/fleet/detail-actions";
import { listOperationsForFleet } from "@/lib/fleet/option-actions";
import { useOperationGeography } from "./use-operation-geography";
import { formatDate, formatPlate } from "./fleet-view";

const numberFormat = new Intl.NumberFormat("pt-BR");
const currencyFormat = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateTimeFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

const EVENT_LABELS: Record<string, string> = {
  "vehicle.created": "Cadastro criado",
  "vehicle.updated": "Cadastro atualizado",
  "vehicle.deleted": "Cadastro removido",
  "vehicle.status_changed": "Situação alterada",
  "vehicle.assigned": "Alocação registrada",
  "vehicle.odometer_recorded": "Leitura de quilometragem",
  "vehicle.odometer_corrected": "Correção de quilometragem",
};

/** A labelled fact. The dash is a value: it means "not informed". */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="text-body-sm text-fg">{children}</dd>
    </div>
  );
}

function Dash() {
  return <span className="text-fg-muted">—</span>;
}

export function VehicleDetailDrawer({
  vehicleId,
  permissions,
  isPlatformAdmin,
  onClose,
  onEdit,
}: {
  vehicleId: string | null;
  permissions: string[];
  isPlatformAdmin: boolean;
  onClose: () => void;
  onEdit: (id: string) => void;
}) {
  const router = useRouter();
  const [detail, setDetail] = React.useState<VehicleDetail | null>(null);
  const [timeline, setTimeline] = React.useState<TimelineEntry[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const can = (permission: string) => isPlatformAdmin || permissions.includes(permission);
  const open = Boolean(vehicleId);

  /**
   * The two reads the drawer needs, together. It holds no state of its own, so
   * both the effect below and the panels' "reload after a change" can use it
   * and keep every setState inside a `.then`.
   */
  const applyResults = React.useCallback(
    ([detailResult, timelineResult]: [
      Awaited<ReturnType<typeof loadVehicleDetail>>,
      Awaited<ReturnType<typeof loadVehicleTimeline>>,
    ]) => {
      if (!detailResult.ok || !detailResult.data) {
        setError(detailResult.error ?? "Não foi possível carregar o veículo.");
        setDetail(null);
      } else {
        setError(null);
        setDetail(detailResult.data);
      }
      setTimeline(timelineResult.ok ? (timelineResult.data ?? []) : []);
      setLoading(false);
    },
    [],
  );

  const reload = React.useCallback(
    (id: string) => Promise.all([loadVehicleDetail(id), loadVehicleTimeline(id)]).then(applyResults),
    [applyResults],
  );

  /**
   * The drawer resets during render, keyed by the vehicle it was opened for.
   * Clearing inside the effect would let the previous vehicle's data be
   * painted once before it disappears.
   */
  const [loadedId, setLoadedId] = React.useState(vehicleId);
  if (loadedId !== vehicleId) {
    setLoadedId(vehicleId);
    setDetail(null);
    setTimeline([]);
    setError(null);
    setLoading(Boolean(vehicleId));
  }

  React.useEffect(() => {
    if (!vehicleId) return;

    let active = true;
    void Promise.all([loadVehicleDetail(vehicleId), loadVehicleTimeline(vehicleId)]).then((results) => {
      if (active) applyResults(results);
    });

    return () => {
      active = false;
    };
  }, [vehicleId, applyResults]);

  const vehicle = detail?.vehicle;

  return (
    <Drawer open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DrawerContent size="lg">
        <DrawerHeader>
          <DrawerTitle>
            {vehicle ? `Frota ${vehicle.fleet_code} · ${formatPlate(vehicle.license_plate)}` : "Veículo"}
          </DrawerTitle>
          <DrawerDescription>
            {vehicle
              ? [vehicle.vehicle_type_name, vehicle.vehicle_make_name, vehicle.vehicle_model_name]
                  .filter(Boolean)
                  .join(" · ") || "Sem classificação informada"
              : "Carregando…"}
          </DrawerDescription>
        </DrawerHeader>

        <DrawerBody className="flex min-h-0 flex-col gap-4">
          {loading && !detail ? (
            <LoadingState label="Carregando veículo…" />
          ) : error ? (
            <Alert variant="danger">
              <AlertTitle>Não foi possível abrir o veículo</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : detail && vehicle ? (
            <Tabs defaultValue="resumo" className="flex min-h-0 flex-1 flex-col gap-4">
              <TabsList>
                <TabsTrigger value="resumo">Resumo</TabsTrigger>
                <TabsTrigger value="operacao">Vínculo operacional</TabsTrigger>
                <TabsTrigger value="km">Quilometragem</TabsTrigger>
                <TabsTrigger value="historico">Histórico</TabsTrigger>
              </TabsList>

              {/* ------------------------------------------------ resumo -- */}
              <TabsContent value="resumo" className="flex flex-col gap-4">
                {vehicle.deleted_at ? (
                  <Alert variant="warning">
                    <AlertTitle>Cadastro arquivado</AlertTitle>
                    <AlertDescription>
                      Arquivado em {formatDate(vehicle.deleted_at.slice(0, 10))}. O histórico permanece
                      íntegro e o cadastro pode ser restaurado.
                    </AlertDescription>
                  </Alert>
                ) : null}

                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <Fact label="Situação cadastral">
                    <StatusBadge status={vehicle.status === "active" ? "success" : "neutral"}>
                      {VEHICLE_STATUS_LABELS[vehicle.status ?? ""] ?? "—"}
                    </StatusBadge>
                  </Fact>
                  <Fact label="Titularidade">
                    {OWNERSHIP_LABELS[vehicle.ownership_type ?? ""] ?? <Dash />}
                  </Fact>
                  <Fact label="Valor do ativo">
                    {vehicle.asset_value === null || vehicle.asset_value === undefined ? (
                      <span className="text-fg-muted" title="Não informado — não é zero">
                        Não informado
                      </span>
                    ) : (
                      currencyFormat.format(Number(vehicle.asset_value))
                    )}
                  </Fact>
                  <Fact label="Tipo">{vehicle.vehicle_type_name ?? <Dash />}</Fact>
                  <Fact label="Subcategoria">{vehicle.vehicle_subcategory_name ?? <Dash />}</Fact>
                  <Fact label="Marca / modelo">
                    {[vehicle.vehicle_make_name, vehicle.vehicle_model_name].filter(Boolean).join(" ") || (
                      <Dash />
                    )}
                  </Fact>
                  <Fact label="Ano fabricação / modelo">
                    {vehicle.manufacture_year || vehicle.model_year
                      ? `${vehicle.manufacture_year ?? "—"} / ${vehicle.model_year ?? "—"}`
                      : <Dash />}
                  </Fact>
                  <Fact label="Filial">{vehicle.organization_unit_name ?? <Dash />}</Fact>
                  <Fact label="Centro de custo">{vehicle.cost_center_name ?? <Dash />}</Fact>
                </dl>

                <Separator />

                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <Fact label="Chassi">
                    {vehicle.vin ? <span className="font-mono text-caption">{vehicle.vin}</span> : <Dash />}
                  </Fact>
                  <Fact label="RENAVAM">
                    {vehicle.renavam ? (
                      <span className="font-mono text-caption">{vehicle.renavam}</span>
                    ) : (
                      <Dash />
                    )}
                  </Fact>
                  <Fact label="ANTT / RNTRC">{vehicle.antt_code ?? <Dash />}</Fact>
                  <Fact label="Tacógrafo">
                    {vehicle.has_tachograph
                      ? vehicle.tachograph_number
                        ? `Sim · ${vehicle.tachograph_number}`
                        : "Sim"
                      : "Não"}
                  </Fact>
                </dl>

                {vehicle.notes ? (
                  <>
                    <Separator />
                    <Fact label="Observações">{vehicle.notes}</Fact>
                  </>
                ) : null}
              </TabsContent>

              {/* -------------------------------------------- vínculo ----- */}
              <TabsContent value="operacao" className="flex flex-col gap-4">
                <AssignmentPanel
                  detail={detail}
                  canManage={can("vehicles.manage_assignment") && !vehicle.deleted_at}
                  onDone={() => {
                    if (vehicleId) void reload(vehicleId);
                    router.refresh();
                  }}
                />
              </TabsContent>

              {/* ------------------------------------------------- KM ----- */}
              <TabsContent value="km" className="flex flex-col gap-4">
                <OdometerPanel
                  detail={detail}
                  canCorrect={can("vehicles.correct_odometer") && !vehicle.deleted_at}
                  onDone={() => {
                    if (vehicleId) void reload(vehicleId);
                    router.refresh();
                  }}
                />
              </TabsContent>

              {/* ------------------------------------------- histórico ---- */}
              <TabsContent value="historico" className="flex flex-col gap-3">
                {timeline.length === 0 ? (
                  <EmptyState
                    title="Sem histórico visível"
                    description="Nenhum evento registrado, ou seu perfil não possui permissão de auditoria da frota."
                  />
                ) : (
                  <ol className="flex flex-col gap-2">
                    {timeline.map((entry) => (
                      <li
                        key={`${entry.eventType}-${entry.id}`}
                        className="rounded-md border border-border bg-surface p-3"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-body-sm font-medium text-fg">
                            {EVENT_LABELS[entry.eventType] ?? entry.eventType}
                          </span>
                          <span className="text-caption tabular-nums text-fg-muted">
                            {entry.occurredAt ? dateTimeFormat.format(new Date(entry.occurredAt)) : "—"}
                          </span>
                        </div>
                        <p className="text-caption text-fg-secondary">
                          {entry.actorName ?? "Responsável não identificado"}
                        </p>
                        <EventDetail entry={entry} />
                        {entry.reason ? (
                          <p className="mt-1 text-caption text-fg-secondary">
                            <span className="text-fg-muted">Motivo: </span>
                            {entry.reason}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
              </TabsContent>
            </Tabs>
          ) : null}
        </DrawerBody>

        <DrawerFooter>
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
          {vehicle && can("vehicles.update") && !vehicle.deleted_at ? (
            <Button leadingIcon={<Pencil />} onClick={() => vehicle.id && onEdit(vehicle.id)}>
              Editar cadastro
            </Button>
          ) : null}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

/* -------------------------------------------------------------------------- */

/** What actually changed, rendered from the audit payload. */
function EventDetail({ entry }: { entry: TimelineEntry }) {
  if (entry.eventType === "vehicle.status_changed") {
    const from = entry.previousValue?.status as string | undefined;
    const to = entry.newValue?.status as string | undefined;
    return (
      <p className="mt-1 text-caption text-fg-secondary">
        {VEHICLE_STATUS_LABELS[from ?? ""] ?? from ?? "—"} → {VEHICLE_STATUS_LABELS[to ?? ""] ?? to ?? "—"}
      </p>
    );
  }

  if (entry.eventType === "vehicle.assigned") {
    const value = entry.newValue ?? {};
    return (
      <p className="mt-1 text-caption text-fg-secondary">
        {String(value.operation ?? "—")} · {String(value.city ?? "—")}/{String(value.uf ?? "")} · a partir
        de {formatDate(String(value.effective_from ?? ""))}
        {value.effective_to ? ` até ${formatDate(String(value.effective_to))}` : ""}
      </p>
    );
  }

  if (entry.eventType.startsWith("vehicle.odometer")) {
    const value = entry.newValue ?? {};
    return (
      <p className="mt-1 text-caption tabular-nums text-fg-secondary">
        {numberFormat.format(Number(value.odometer_km ?? 0))} km em{" "}
        {formatDate(String(value.reading_date ?? ""))} ·{" "}
        {ODOMETER_SOURCE_LABELS[String(value.source ?? "")] ?? String(value.source ?? "")}
      </p>
    );
  }

  if (entry.fields.length > 0) {
    return (
      <p className="mt-1 flex flex-wrap gap-1">
        {entry.fields.slice(0, 8).map((field) => (
          <Badge key={field} variant="neutral" size="sm">
            {field}
          </Badge>
        ))}
        {entry.fields.length > 8 ? (
          <Badge variant="neutral" size="sm">
            +{entry.fields.length - 8}
          </Badge>
        ) : null}
      </p>
    );
  }

  return null;
}

/* -------------------------------------------------------------------------- */

/**
 * Allocation and transfer.
 *
 * A transfer is not an edit of the current row: it closes the running period
 * and opens the new one, atomically, in the database (§27, §28). The form only
 * asks for where and from when.
 */
function AssignmentPanel({
  detail,
  canManage,
  onDone,
}: {
  detail: VehicleDetail;
  canManage: boolean;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [operations, setOperations] = React.useState<{ id: string; label: string }[]>([]);
  const [operationId, setOperationId] = React.useState("");
  const [stateId, setStateId] = React.useState("");
  const [cityId, setCityId] = React.useState("");
  const [effectiveFrom, setEffectiveFrom] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!canManage) return;
    let active = true;
    listOperationsForFleet().then((result) => {
      if (active && result.ok) setOperations(result.data ?? []);
    });
    return () => {
      active = false;
    };
  }, [canManage]);

  const geography = useOperationGeography(operationId || undefined, stateId || undefined);
  const current = detail.assignments.find((item) => item.isCurrent);
  const scheduled = detail.assignments.find((item) => item.isScheduled);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail.vehicle.id || !operationId || !stateId || !cityId || saving) return;

    setSaving(true);
    setError(null);
    const result = await setVehicleAssignment({
      vehicleId: detail.vehicle.id,
      operationId,
      stateId: Number(stateId),
      cityId: Number(cityId),
      effectiveFrom: effectiveFrom || new Date().toISOString().slice(0, 10),
      reason: reason.trim() || null,
    });
    setSaving(false);

    if (!result.ok) {
      setError(result.error ?? "Não foi possível alocar o veículo.");
      return;
    }
    toast({ title: "Alocação registrada", variant: "success" });
    setOperationId("");
    setStateId("");
    setCityId("");
    setEffectiveFrom("");
    setReason("");
    onDone();
  }

  return (
    <>
      <div className="rounded-md border border-border bg-surface-secondary p-3">
        <p className="text-caption text-fg-muted">Alocação vigente</p>
        {current ? (
          <p className="text-body-sm font-medium text-fg">
            {current.operationName} · {current.cityName}/{current.stateUf}
            <span className="ml-2 font-normal text-fg-secondary">
              desde {formatDate(current.effectiveFrom)}
            </span>
          </p>
        ) : (
          <p className="text-body-sm text-fg-secondary">
            Sem alocação operacional. Isso não é o mesmo que estar inativo: o veículo existe e está
            cadastrado, apenas não pertence a nenhuma operação hoje.
          </p>
        )}
        {scheduled ? (
          <p className="mt-1 text-caption text-fg-secondary">
            Transferência programada para {scheduled.cityName}/{scheduled.stateUf} a partir de{" "}
            {formatDate(scheduled.effectiveFrom)}.
          </p>
        ) : null}
      </div>

      {canManage ? (
        <form onSubmit={submit} className="flex flex-col gap-3 rounded-md border border-border p-3">
          <p className="text-body-sm font-semibold text-fg">
            {current ? "Transferir operação" : "Alocar veículo"}
          </p>
          {error ? (
            <Alert variant="danger">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <FormGrid columns={2}>
            <FormField label="Operação" required>
              <Select
                value={operationId}
                onValueChange={(value) => {
                  setOperationId(value);
                  setStateId("");
                  setCityId("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {operations.map((operation) => (
                    <SelectItem key={operation.id} value={operation.id}>
                      {operation.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField label="Estado" required disabled={!operationId}>
              <Select
                value={stateId}
                onValueChange={(value) => {
                  setStateId(value);
                  setCityId("");
                }}
                disabled={!operationId || geography.states.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {geography.states.map((state) => (
                    <SelectItem key={state.stateId} value={String(state.stateId)}>
                      {state.name} ({state.uf})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField label="Cidade" required disabled={!stateId}>
              <Select
                value={cityId}
                onValueChange={setCityId}
                disabled={!stateId || geography.cities.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {geography.cities.map((city) => (
                    <SelectItem key={city.cityId} value={String(city.cityId)}>
                      {city.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField
              label="A partir de"
              helperText={
                current
                  ? `A vigência atual é encerrada no dia anterior. Precisa ser depois de ${formatDate(current.effectiveFrom)}.`
                  : "Em branco, hoje."
              }
            >
              <DateInput
                value={effectiveFrom}
                onChange={(event) => setEffectiveFrom(event.target.value)}
              />
            </FormField>
          </FormGrid>

          <FormField label="Motivo">
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Mudança de base operacional"
            />
          </FormField>

          <div className="flex justify-end">
            <Button
              type="submit"
              size="sm"
              leadingIcon={<ArrowRightLeft />}
              disabled={!operationId || !stateId || !cityId || saving}
            >
              {saving ? "Registrando…" : current ? "Transferir" : "Alocar"}
            </Button>
          </div>
        </form>
      ) : null}

      <div className="flex flex-col gap-2">
        <p className="text-body-sm font-semibold text-fg">Histórico de alocação</p>
        {detail.assignments.length === 0 ? (
          <p className="text-body-sm text-fg-muted">Nenhuma alocação registrada.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {detail.assignments.map((item) => (
              <li
                key={item.id}
                className={cn(
                  "rounded-md border p-3",
                  item.isCurrent ? "border-border-strong bg-surface" : "border-border bg-surface",
                )}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-body-sm font-medium text-fg">
                    {item.operationName} · {item.cityName}/{item.stateUf}
                  </span>
                  {item.isCurrent ? (
                    <Badge variant="success" size="sm">
                      Vigente
                    </Badge>
                  ) : item.isScheduled ? (
                    <Badge variant="primary" size="sm">
                      Programada
                    </Badge>
                  ) : null}
                </div>
                <p className="text-caption tabular-nums text-fg-secondary">
                  {formatDate(item.effectiveFrom)} → {item.effectiveTo ? formatDate(item.effectiveTo) : "em aberto"}
                </p>
                {item.reason ? <p className="text-caption text-fg-muted">{item.reason}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Odometer.
 *
 * A correction does not edit the wrong reading: it records the right one and
 * marks the previous as superseded, with a reason (§20). The old value stays
 * visible, which is what lets somebody answer "why did the KM drop in March".
 */
function OdometerPanel({
  detail,
  canCorrect,
  onDone,
}: {
  detail: VehicleDetail;
  canCorrect: boolean;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [km, setKm] = React.useState("");
  const [date, setDate] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const current = detail.readings.find((reading) => reading.supersededBy === null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail.vehicle.id || !km || reason.trim().length < 3 || saving) return;

    setSaving(true);
    setError(null);
    const result = await correctOdometer({
      vehicleId: detail.vehicle.id,
      odometerKm: Number(km),
      readingDate: date || new Date().toISOString().slice(0, 10),
      reason: reason.trim(),
    });
    setSaving(false);

    if (!result.ok) {
      setError(result.error ?? "Não foi possível registrar a correção.");
      return;
    }
    toast({ title: "Correção registrada", variant: "success" });
    setKm("");
    setDate("");
    setReason("");
    onDone();
  }

  return (
    <>
      <div className="rounded-md border border-border bg-surface-secondary p-3">
        <p className="text-caption text-fg-muted">Leitura vigente</p>
        {current ? (
          <>
            <p className="text-h3 font-semibold tabular-nums text-fg">
              {numberFormat.format(current.odometerKm)} km
            </p>
            <p className="text-caption text-fg-secondary">
              {formatDate(current.readingDate)} ·{" "}
              {ODOMETER_SOURCE_LABELS[current.source] ?? current.source}
            </p>
          </>
        ) : (
          <p className="text-body-sm text-fg-secondary">
            Sem leitura registrada. Ausência de leitura não é quilometragem zero.
          </p>
        )}
      </div>

      {canCorrect ? (
        <form onSubmit={submit} className="flex flex-col gap-3 rounded-md border border-border p-3">
          <p className="text-body-sm font-semibold text-fg">Corrigir quilometragem</p>
          {error ? (
            <Alert variant="danger">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <FormGrid columns={2}>
            <FormField label="Nova leitura (km)" required>
              <Input
                value={km}
                onChange={(event) => setKm(event.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                placeholder="118500"
                required
              />
            </FormField>
            <FormField label="Data da leitura" helperText="Em branco, hoje.">
              <DateInput value={date} onChange={(event) => setDate(event.target.value)} />
            </FormField>
          </FormGrid>

          <FormField
            label="Motivo"
            required
            helperText="Obrigatório. Fica registrado junto com o valor anterior e quem corrigiu."
          >
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Leitura inicial digitada com erro"
              minLength={3}
              required
            />
          </FormField>

          <div className="flex justify-end">
            <Button
              type="submit"
              size="sm"
              leadingIcon={<Gauge />}
              disabled={!km || reason.trim().length < 3 || saving}
            >
              {saving ? "Registrando…" : "Registrar correção"}
            </Button>
          </div>
        </form>
      ) : null}

      <div className="flex flex-col gap-2">
        <p className="text-body-sm font-semibold text-fg">Leituras</p>
        {detail.readings.length === 0 ? (
          <p className="text-body-sm text-fg-muted">Nenhuma leitura registrada.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {detail.readings.map((reading) => (
              <li
                key={reading.id}
                className={cn(
                  "flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-border p-3",
                  reading.supersededBy && "opacity-70",
                )}
              >
                <span className="text-body-sm tabular-nums text-fg">
                  {numberFormat.format(reading.odometerKm)} km
                  <span className="ml-2 text-caption text-fg-secondary">
                    {formatDate(reading.readingDate)}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge variant="neutral" size="sm">
                    {ODOMETER_SOURCE_LABELS[reading.source] ?? reading.source}
                  </Badge>
                  {reading.supersededBy ? (
                    <Badge variant="warning" size="sm">
                      Corrigida
                    </Badge>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  );
}
