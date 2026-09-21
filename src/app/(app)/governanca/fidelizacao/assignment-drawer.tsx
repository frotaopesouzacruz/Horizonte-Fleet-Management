"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Plus, Square, Truck, UserRound } from "lucide-react";
import {
  Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer";
import { Button, IconButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FormField } from "@/components/ui/form-field";
import { DateInput } from "@/components/ui/date-input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import { NativeSelect } from "@/components/governance/selects";
import { VehiclePicker } from "@/components/governance/vehicle-picker";
import { EmployeePicker } from "@/components/governance/employee-picker";
import {
  endFidelization, endFidelizationDriver, loadFidelizationDrivers, saveFidelization,
  saveFidelizationDriver, substituteFidelizationVehicle,
  type AssignmentDriver, type EligibleVehicle, type EmployeeOption,
} from "@/lib/governance/actions";
import type { FidelizationRow } from "@/lib/governance/queries";
import { monthEnd, monthStart, type Competence } from "@/lib/governance/competence";

function formatDate(value: string | null): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  return d ? `${d}/${m}/${y}` : value;
}

const STATUS_LABEL: Record<string, string> = {
  planned: "Planejado",
  confirmed: "Confirmado",
  executed: "Executado",
  cancelled: "Cancelado",
};

export interface AssignmentDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  br: { id: string; code: string; cityName: string; stateUf: string; operationName: string } | null;
  competence: Competence;
  /** Every vínculo of this BR that touches the competence, newest first. */
  history: FidelizationRow[];
  canPlan: boolean;
  canChangeVehicle: boolean;
  canChangeDriver: boolean;
}

type Mode = "idle" | "plan" | "substitute" | "end";

/**
 * The planning detail of one position.
 *
 * Three actions live here and each is a different decision: planning a vehicle
 * where there was none, substituting the one that is there, and ending the
 * vínculo. The last two demand a reason — §49 — because a month later the only
 * question anyone asks about a substitution is why.
 */
export function AssignmentDrawer({
  open,
  onOpenChange,
  br,
  competence,
  history,
  canPlan,
  canChangeVehicle,
  canChangeDriver,
}: AssignmentDrawerProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, startTransition] = React.useTransition();
  const [mode, setMode] = React.useState<Mode>("idle");
  const [error, setError] = React.useState<string | null>(null);

  const [vehicle, setVehicle] = React.useState<EligibleVehicle | null>(null);
  const [startDate, setStartDate] = React.useState(monthStart(competence));
  const [endDate, setEndDate] = React.useState<string>(monthEnd(competence));
  const [reason, setReason] = React.useState("");

  const [driver, setDriver] = React.useState<EmployeeOption | null>(null);
  const [driverRole, setDriverRole] = React.useState<"primary" | "secondary">("primary");
  const [drivers, setDrivers] = React.useState<AssignmentDriver[]>([]);
  const [driversError, setDriversError] = React.useState<string | null>(null);

  const current = history.find((h) => h.isCurrent && h.status !== "cancelled") ?? null;

  // No reset effect: the parent remounts this drawer for each BR it opens, so
  // every piece of state above starts from its initial value already.
  React.useEffect(() => {
    if (!open || !current) return;
    let cancelled = false;
    (async () => {
      const result = await loadFidelizationDrivers(current.id);
      if (cancelled) return;
      if (result.ok) {
        setDrivers(result.data ?? []);
        setDriversError(null);
      } else {
        setDriversError(result.error ?? "Não foi possível carregar os motoristas.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, current]);

  const done = (message: string) => {
    toast({ title: message, variant: "success" });
    setMode("idle");
    setError(null);
    router.refresh();
  };

  const plan = () => {
    setError(null);
    if (!br) return;
    if (!vehicle) return setError("Escolha o veículo.");
    if (!startDate) return setError("Informe a data de início.");

    startTransition(async () => {
      const result = await saveFidelization({
        operationBrId: br.id,
        vehicleId: vehicle.vehicleId,
        startDate,
        endDate: endDate || null,
        reason: reason.trim() || null,
      });
      if (result.ok) done("Veículo fidelizado.");
      else setError(result.error ?? "Não foi possível fidelizar o veículo.");
    });
  };

  const substitute = () => {
    setError(null);
    if (!current) return;
    if (!vehicle) return setError("Escolha o veículo que entra.");
    if (!startDate) return setError("Informe a data a partir da qual a substituição vale.");
    if (!reason.trim()) return setError("Informe o motivo da substituição.");

    startTransition(async () => {
      const result = await substituteFidelizationVehicle({
        assignmentId: current.id,
        newVehicleId: vehicle.vehicleId,
        effectiveFrom: startDate,
        reason: reason.trim(),
      });
      if (result.ok) done("Veículo substituído.");
      else setError(result.error ?? "Não foi possível substituir o veículo.");
    });
  };

  const finish = () => {
    setError(null);
    if (!current) return;
    if (!endDate) return setError("Informe a data de encerramento.");
    if (!reason.trim()) return setError("Informe o motivo do encerramento.");

    startTransition(async () => {
      const result = await endFidelization(current.id, endDate, reason.trim());
      if (result.ok) done("Fidelização encerrada.");
      else setError(result.error ?? "Não foi possível encerrar.");
    });
  };

  const addDriver = () => {
    setError(null);
    if (!current) return;
    if (!driver) return setError("Escolha o colaborador.");

    startTransition(async () => {
      const result = await saveFidelizationDriver({
        fidelizationAssignmentId: current.id,
        employeeId: driver.id,
        driverRole,
      });
      if (result.ok) {
        setDriver(null);
        const refreshed = await loadFidelizationDrivers(current.id);
        if (refreshed.ok) setDrivers(refreshed.data ?? []);
        done("Motorista vinculado.");
      } else {
        setError(result.error ?? "Não foi possível vincular o motorista.");
      }
    });
  };

  const removeDriver = (row: AssignmentDriver) => {
    startTransition(async () => {
      const result = await endFidelizationDriver(
        row.id,
        monthEnd(competence),
        "Encerrado pelo planejamento da competência.",
      );
      if (result.ok && current) {
        const refreshed = await loadFidelizationDrivers(current.id);
        if (refreshed.ok) setDrivers(refreshed.data ?? []);
        toast({ title: "Vínculo do motorista encerrado.", variant: "success" });
        router.refresh();
      } else if (!result.ok) {
        toast({ title: result.error ?? "Não foi possível encerrar.", variant: "danger" });
      }
    });
  };

  if (!br) return null;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent size="lg">
        <DrawerHeader>
          <DrawerTitle>BR {br.code}</DrawerTitle>
          <DrawerDescription>
            {br.cityName}/{br.stateUf} · {br.operationName}
          </DrawerDescription>
        </DrawerHeader>

        <DrawerBody className="flex flex-col gap-4">
          {error ? (
            <Alert variant="danger">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Tabs defaultValue="veiculo">
            <TabsList>
              <TabsTrigger value="veiculo">Veículo</TabsTrigger>
              <TabsTrigger value="motoristas">Motoristas</TabsTrigger>
              <TabsTrigger value="historico">Histórico</TabsTrigger>
            </TabsList>

            {/* ------------------------------------------------------ veículo */}
            <TabsContent value="veiculo" className="flex flex-col gap-4">
              <div className="rounded-md border border-border bg-surface p-3">
                {current ? (
                  <div className="flex items-start gap-2.5">
                    <Truck aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body-sm font-medium text-fg">
                        {current.fleetCode ?? current.licensePlate ?? "Sem identificação"}
                        {current.fleetCode && current.licensePlate ? (
                          <span className="font-normal text-fg-muted"> · {current.licensePlate}</span>
                        ) : null}
                      </p>
                      <p className="text-caption text-fg-muted">
                        {[current.vehicleMakeName, current.vehicleModelName].filter(Boolean).join(" ") ||
                          current.vehicleTypeName ||
                          "Sem modelo cadastrado"}
                      </p>
                      <p className="mt-1 text-caption text-fg-secondary">
                        {formatDate(current.startDate)} —{" "}
                        {current.endDate ? formatDate(current.endDate) : "em aberto"}
                      </p>
                    </div>
                    <Badge variant="neutral" appearance="soft" size="sm">
                      {STATUS_LABEL[current.status] ?? current.status}
                    </Badge>
                  </div>
                ) : (
                  <p className="text-body-sm text-fg-muted">
                    Nenhum veículo fidelizado nesta posição no período.
                  </p>
                )}
              </div>

              {mode === "idle" ? (
                <div className="flex flex-wrap gap-2">
                  {!current && canPlan ? (
                    <Button leadingIcon={<Plus />} onClick={() => setMode("plan")}>
                      Fidelizar veículo
                    </Button>
                  ) : null}
                  {current && canChangeVehicle ? (
                    <>
                      <Button
                        variant="secondary"
                        leadingIcon={<ArrowLeftRight />}
                        onClick={() => {
                          setMode("substitute");
                          setStartDate(monthStart(competence));
                          setReason("");
                        }}
                      >
                        Substituir veículo
                      </Button>
                      <Button
                        variant="ghost"
                        leadingIcon={<Square />}
                        onClick={() => {
                          setError(null);
                          setReason("");
                          setEndDate(monthEnd(competence));
                          setMode("end");
                        }}
                      >
                        Encerrar vínculo
                      </Button>
                    </>
                  ) : null}
                </div>
              ) : null}

              {mode === "plan" || mode === "substitute" ? (
                <div className="flex flex-col gap-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField
                      label={mode === "substitute" ? "Vale a partir de" : "Início"}
                      required
                      id="assignment-start"
                    >
                      <DateInput
                        id="assignment-start"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                      />
                    </FormField>
                    {mode === "plan" ? (
                      <FormField
                        label="Fim"
                        id="assignment-end"
                        labelHint="Opcional"
                        helperText="Em branco, o vínculo segue em aberto."
                      >
                        <DateInput
                          id="assignment-end"
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                        />
                      </FormField>
                    ) : null}
                  </div>

                  <FormField
                    label={mode === "substitute" ? "Veículo que entra" : "Veículo"}
                    required
                    id="assignment-vehicle"
                  >
                    <VehiclePicker
                      id="assignment-vehicle"
                      operationBrId={br.id}
                      startDate={startDate}
                      endDate={mode === "plan" ? endDate || null : current?.endDate ?? null}
                      excludeAssignmentId={mode === "substitute" ? current?.id ?? null : null}
                      value={vehicle}
                      onChange={setVehicle}
                    />
                  </FormField>

                  <FormField
                    label="Motivo"
                    required={mode === "substitute"}
                    id="assignment-reason"
                    labelHint={mode === "plan" ? "Opcional" : undefined}
                  >
                    <Textarea
                      id="assignment-reason"
                      rows={2}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder={
                        mode === "substitute"
                          ? "Por que o veículo está sendo trocado?"
                          : "Observação sobre este planejamento"
                      }
                    />
                  </FormField>

                  <div className="flex gap-2">
                    <Button onClick={mode === "plan" ? plan : substitute} loading={busy}>
                      {mode === "plan" ? "Fidelizar" : "Substituir"}
                    </Button>
                    <Button variant="ghost" onClick={() => setMode("idle")} disabled={busy}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : null}

              {mode === "end" ? (
                <div className="flex flex-col gap-3">
                  <FormField
                    label="Último dia do vínculo"
                    required
                    id="assignment-end-date"
                    helperText="A partir do dia seguinte a BR fica sem veículo planejado, até que outro seja fidelizado."
                  >
                    <DateInput
                      id="assignment-end-date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </FormField>

                  <FormField label="Motivo" required id="assignment-end-reason">
                    <Textarea
                      id="assignment-end-reason"
                      rows={2}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Por que o vínculo está sendo encerrado?"
                    />
                  </FormField>

                  <div className="flex gap-2">
                    <Button variant="danger" onClick={finish} loading={busy}>
                      Encerrar vínculo
                    </Button>
                    <Button variant="ghost" onClick={() => setMode("idle")} disabled={busy}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : null}
            </TabsContent>

            {/* --------------------------------------------------- motoristas */}
            <TabsContent value="motoristas" className="flex flex-col gap-3">
              {!current ? (
                <p className="text-body-sm text-fg-muted">
                  Vincule um veículo antes de planejar motoristas: o motorista é planejado para um
                  veículo em uma posição, não para a posição sozinha.
                </p>
              ) : (
                <>
                  {driversError ? (
                    <Alert variant="danger">
                      <AlertDescription>{driversError}</AlertDescription>
                    </Alert>
                  ) : null}

                  {drivers.length === 0 ? (
                    <p className="text-body-sm text-fg-muted">Nenhum motorista planejado.</p>
                  ) : (
                    <ul className="divide-y divide-border rounded-md border border-border">
                      {drivers.map((row) => (
                        <li key={row.id} className="flex items-center gap-2 px-3 py-2">
                          <UserRound aria-hidden className="size-4 shrink-0 text-fg-muted" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-body-sm text-fg">{row.employeeName}</span>
                            <span className="block text-caption text-fg-muted">
                              {row.driverRole === "primary" ? "Principal" : "Secundário"} ·{" "}
                              {formatDate(row.startDate)} —{" "}
                              {row.endDate ? formatDate(row.endDate) : "em aberto"}
                            </span>
                          </span>
                          {row.status === "cancelled" ? (
                            <Badge variant="neutral" appearance="soft" size="sm">Cancelado</Badge>
                          ) : canChangeDriver ? (
                            <IconButton
                              label="Encerrar vínculo do motorista"
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => removeDriver(row)}
                            >
                              <Square />
                            </IconButton>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}

                  {canChangeDriver ? (
                    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
                      <FormField label="Colaborador" required id="driver-employee">
                        <EmployeePicker id="driver-employee" value={driver} onChange={setDriver} />
                      </FormField>
                      <FormField label="Função" id="driver-role">
                        <NativeSelect
                          id="driver-role"
                          value={driverRole}
                          onChange={(e) => setDriverRole(e.target.value as "primary" | "secondary")}
                        >
                          <option value="primary">Motorista principal</option>
                          <option value="secondary">Motorista secundário</option>
                        </NativeSelect>
                      </FormField>
                      <p className="text-caption text-fg-muted">
                        Vincular alguém aqui não cria colaborador, não cria conta de acesso e não
                        altera o Perfil de Acesso HFM de ninguém.
                      </p>
                      <div>
                        <Button size="sm" onClick={addDriver} loading={busy} leadingIcon={<Plus />}>
                          Vincular motorista
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </TabsContent>

            {/* ---------------------------------------------------- histórico */}
            <TabsContent value="historico">
              {history.length === 0 ? (
                <p className="text-body-sm text-fg-muted">Nenhuma mobilização registrada no período.</p>
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {history.map((row) => (
                    <li key={row.id} className="flex flex-col gap-0.5 px-3 py-2">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-body-sm font-medium text-fg">
                          {row.fleetCode ?? row.licensePlate ?? "Sem identificação"}
                        </span>
                        <Badge variant="neutral" appearance="soft" size="sm">
                          {STATUS_LABEL[row.status] ?? row.status}
                        </Badge>
                        {row.source !== "manual" ? (
                          <Badge variant="info" appearance="soft" size="sm">
                            {row.source === "substitution"
                              ? "Substituição"
                              : row.source === "inversion"
                                ? "Inversão"
                                : "Importação"}
                          </Badge>
                        ) : null}
                      </span>
                      <span className="text-caption text-fg-secondary">
                        {formatDate(row.startDate)} — {row.endDate ? formatDate(row.endDate) : "em aberto"}
                      </span>
                      {row.reason ? (
                        <span className="text-caption text-fg-muted">Entrou por: {row.reason}</span>
                      ) : null}
                      {row.endReason ? (
                        <span className="text-caption text-fg-muted">Encerrado por: {row.endReason}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          </Tabs>
        </DrawerBody>

        <DrawerFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
