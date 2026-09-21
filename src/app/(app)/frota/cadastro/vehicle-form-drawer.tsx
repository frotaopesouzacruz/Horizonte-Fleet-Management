"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { DateInput } from "@/components/ui/date-input";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { LoadingState } from "@/components/feedback/loading-state";
import { useToast } from "@/components/feedback/toast";
import { OWNERSHIP_LABELS, VEHICLE_STATUS_LABELS, parseDecimal } from "@/lib/fleet/columns";
import type { FleetOptions } from "@/lib/fleet/queries";
import { saveVehicle } from "@/lib/fleet/actions";
import { loadVehicleDetail } from "@/lib/fleet/detail-actions";
import { useOperationGeography } from "./use-operation-geography";

interface FormState {
  id: string | null;
  fleet_code: string;
  license_plate: string;
  status: string;
  ownership_type: string;
  asset_value: string;
  notes: string;

  vehicle_type_id: string;
  vehicle_subcategory_id: string;
  vehicle_make_id: string;
  vehicle_model_id: string;
  manufacture_year: string;
  model_year: string;

  operation_id: string;
  state_id: string;
  city_id: string;
  assigned_from: string;
  assignment_reason: string;
  organization_unit_id: string;
  cost_center_id: string;

  vin: string;
  renavam: string;
  antt_code: string;
  has_tachograph: boolean;
  tachograph_number: string;

  initial_odometer_km: string;
  initial_odometer_date: string;
}

const EMPTY: FormState = {
  id: null,
  fleet_code: "",
  license_plate: "",
  status: "active",
  ownership_type: "owned",
  asset_value: "",
  notes: "",
  vehicle_type_id: "",
  vehicle_subcategory_id: "",
  vehicle_make_id: "",
  vehicle_model_id: "",
  manufacture_year: "",
  model_year: "",
  operation_id: "",
  state_id: "",
  city_id: "",
  assigned_from: "",
  assignment_reason: "",
  organization_unit_id: "",
  cost_center_id: "",
  vin: "",
  renavam: "",
  antt_code: "",
  has_tachograph: false,
  tachograph_number: "",
  initial_odometer_km: "",
  initial_odometer_date: "",
};

const NONE = "__none";

/** A section of the form, with its own heading. §35, grouped rather than piled. */
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="text-h4 font-semibold text-fg">{title}</h3>
        {description ? <p className="text-caption text-fg-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Registration and editing of a vehicle.
 *
 * The form carries the registration record and nothing else. Allocation and the
 * odometer are offered only while the vehicle is being created, because on an
 * existing vehicle each of them is a dated, audited movement with its own
 * permission — a save button is the wrong shape for "this vehicle moved to
 * Betim on the first of September" (§20, §27, §55).
 */
export function VehicleFormDrawer({
  open,
  vehicleId,
  options,
  permissions,
  isPlatformAdmin,
  onOpenChange,
}: {
  open: boolean;
  vehicleId: string | null;
  options: FleetOptions;
  permissions: string[];
  isPlatformAdmin: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const isEdit = Boolean(vehicleId);
  // Allocating is its own permission, and the database says so too. Offering
  // the fields to someone who cannot use them only produces a refusal after
  // the form has been filled in.
  const canAssign = isPlatformAdmin || permissions.includes("vehicles.manage_assignment");

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  /**
   * Each opening starts from the vehicle it was opened for.
   *
   * The reset happens during render, keyed by what the drawer is showing,
   * rather than inside the effect: a form still holding the previous vehicle's
   * plate must never be painted, and an effect runs after that paint.
   */
  const target = `${open ? "open" : "closed"}:${vehicleId ?? ""}`;
  const [loadedTarget, setLoadedTarget] = React.useState(target);
  if (loadedTarget !== target) {
    setLoadedTarget(target);
    setForm(EMPTY);
    setError(null);
    setLoading(Boolean(open && vehicleId));
  }

  React.useEffect(() => {
    if (!open || !vehicleId) return;

    let active = true;
    void loadVehicleDetail(vehicleId)
      .then((result) => {
        if (!active) return;
        if (!result.ok || !result.data) {
          setError(result.error ?? "Não foi possível carregar o veículo.");
          return;
        }
        const v = result.data.vehicle;
        setForm({
          ...EMPTY,
          id: v.id ?? null,
          fleet_code: v.fleet_code ?? "",
          license_plate: v.license_plate ?? "",
          status: v.status ?? "active",
          ownership_type: v.ownership_type ?? "owned",
          asset_value: v.asset_value === null || v.asset_value === undefined ? "" : String(v.asset_value),
          notes: v.notes ?? "",
          vehicle_type_id: v.vehicle_type_id ?? "",
          vehicle_subcategory_id: v.vehicle_subcategory_id ?? "",
          vehicle_make_id: v.vehicle_make_id ?? "",
          vehicle_model_id: v.vehicle_model_id ?? "",
          manufacture_year: v.manufacture_year ? String(v.manufacture_year) : "",
          model_year: v.model_year ? String(v.model_year) : "",
          organization_unit_id: v.organization_unit_id ?? "",
          cost_center_id: v.cost_center_id ?? "",
          vin: v.vin ?? "",
          renavam: v.renavam ?? "",
          antt_code: v.antt_code ?? "",
          has_tachograph: Boolean(v.has_tachograph),
          tachograph_number: v.tachograph_number ?? "",
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [open, vehicleId]);

  const geography = useOperationGeography(form.operation_id || undefined, form.state_id || undefined);

  /** A subcategory belongs to a type; changing the type invalidates it (§12, §37). */
  const subcategories = React.useMemo(
    () => options.subcategories.filter((item) => item.vehicleTypeId === form.vehicle_type_id),
    [options.subcategories, form.vehicle_type_id],
  );
  const models = React.useMemo(
    () =>
      form.vehicle_make_id
        ? options.models.filter((item) => item.vehicleMakeId === form.vehicle_make_id)
        : options.models,
    [options.models, form.vehicle_make_id],
  );

  const plateNormalized = form.license_plate.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const plateInvalid = plateNormalized.length > 0 && !/^[A-Z0-9]{5,10}$/.test(plateNormalized);
  const vinNormalized = form.vin.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const vinInvalid = vinNormalized.length > 0 && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vinNormalized);
  const renavamDigits = form.renavam.replace(/\D/g, "");
  const renavamInvalid = renavamDigits.length > 0 && !/^\d{9,11}$/.test(renavamDigits);
  const assetValue = parseDecimal(form.asset_value);
  const assetInvalid = form.asset_value.trim().length > 0 && assetValue.value === null;

  const canSubmit =
    form.fleet_code.trim().length > 0 &&
    plateNormalized.length > 0 &&
    !plateInvalid &&
    !vinInvalid &&
    !renavamInvalid &&
    !assetInvalid &&
    form.vehicle_type_id.length > 0 &&
    // An allocation is all-or-nothing: an operation without a city would be a
    // vehicle allocated to nowhere in particular.
    (!form.operation_id || (form.state_id !== "" && form.city_id !== ""));

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || saving) return;

    setSaving(true);
    setError(null);

    const data = new FormData();
    if (form.id) data.set("id", form.id);
    data.set("fleet_code", form.fleet_code.trim());
    data.set("license_plate", plateNormalized);
    data.set("status", form.status);
    data.set("ownership_type", form.ownership_type);
    if (form.asset_value.trim()) data.set("asset_value", form.asset_value.trim());
    if (form.notes.trim()) data.set("notes", form.notes.trim());
    data.set("vehicle_type_id", form.vehicle_type_id);
    if (form.vehicle_subcategory_id) data.set("vehicle_subcategory_id", form.vehicle_subcategory_id);
    if (form.vehicle_model_id) data.set("vehicle_model_id", form.vehicle_model_id);
    if (form.manufacture_year) data.set("manufacture_year", form.manufacture_year);
    if (form.model_year) data.set("model_year", form.model_year);
    if (form.organization_unit_id) data.set("organization_unit_id", form.organization_unit_id);
    if (form.cost_center_id) data.set("cost_center_id", form.cost_center_id);
    if (vinNormalized) data.set("vin", vinNormalized);
    if (renavamDigits) data.set("renavam", renavamDigits);
    if (form.antt_code.trim()) data.set("antt_code", form.antt_code.replace(/\D/g, ""));
    data.set("has_tachograph", form.has_tachograph ? "true" : "false");
    if (form.has_tachograph && form.tachograph_number.trim()) {
      data.set("tachograph_number", form.tachograph_number.trim());
    }

    if (!form.id) {
      if (canAssign && form.operation_id && form.state_id && form.city_id) {
        data.set("operation_id", form.operation_id);
        data.set("state_id", form.state_id);
        data.set("city_id", form.city_id);
        if (form.assigned_from) data.set("assigned_from", form.assigned_from);
        if (form.assignment_reason.trim()) data.set("assignment_reason", form.assignment_reason.trim());
      }
      if (form.initial_odometer_km.trim()) {
        data.set("initial_odometer_km", form.initial_odometer_km.replace(/\D/g, ""));
        if (form.initial_odometer_date) data.set("initial_odometer_date", form.initial_odometer_date);
      }
    }

    const result = await saveVehicle(data);
    setSaving(false);

    if (!result.ok) {
      setError(result.error ?? "Não foi possível salvar o veículo.");
      return;
    }

    toast({ title: form.id ? "Cadastro atualizado" : "Veículo cadastrado", variant: "success" });
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent size="lg">
        <DrawerHeader>
          <DrawerTitle>{isEdit ? "Editar frota" : "Nova frota"}</DrawerTitle>
          <DrawerDescription>
            {isEdit
              ? "Dados cadastrais do veículo. Alocação e quilometragem têm fluxos próprios, nos detalhes."
              : "Identificação, classificação e, opcionalmente, a primeira alocação e a leitura inicial."}
          </DrawerDescription>
        </DrawerHeader>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DrawerBody className="flex flex-col gap-6">
            {loading ? (
              <LoadingState label="Carregando veículo…" />
            ) : (
              <>
                {error ? (
                  <Alert variant="danger">
                    <AlertTitle>Não foi possível salvar</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}

                <Section
                  title="Dados gerais"
                  description="Identificação operacional, situação cadastral e titularidade."
                >
                  <FormGrid columns={2}>
                    <FormField
                      label="Código da frota"
                      required
                      helperText="Alfanumérico. Zeros à esquerda são preservados."
                    >
                      <Input
                        value={form.fleet_code}
                        onChange={(event) => set("fleet_code", event.target.value)}
                        placeholder="0012"
                        maxLength={30}
                        required
                      />
                    </FormField>

                    <FormField
                      label="Placa"
                      required
                      error={plateInvalid ? "Informe uma placa válida (ABC1234 ou ABC1D23)." : undefined}
                      helperText="Gravada sem hífen e em maiúsculas."
                    >
                      <Input
                        value={form.license_plate}
                        onChange={(event) => set("license_plate", event.target.value.toUpperCase())}
                        placeholder="ABC1D23"
                        maxLength={10}
                        required
                      />
                    </FormField>

                    {/* Situação CADASTRAL. O status operacional — em rota, em
                        manutenção, parado — pertence a outros módulos e não é
                        escrito aqui (§16). */}
                    <FormField label="Situação cadastral" required>
                      <Select value={form.status} onValueChange={(value) => set("status", value)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(VEHICLE_STATUS_LABELS).map(([id, label]) => (
                            <SelectItem key={id} value={id}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>

                    <FormField label="Titularidade" required>
                      <Select
                        value={form.ownership_type}
                        onValueChange={(value) => set("ownership_type", value)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(OWNERSHIP_LABELS).map(([id, label]) => (
                            <SelectItem key={id} value={id}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>

                    <FormField
                      label="Valor do ativo (R$)"
                      error={assetInvalid ? "Informe um valor numérico não negativo." : undefined}
                      helperText="Deixe em branco quando desconhecido — em branco não é zero."
                    >
                      <Input
                        value={form.asset_value}
                        onChange={(event) => set("asset_value", event.target.value)}
                        placeholder="189.900,00"
                        inputMode="decimal"
                      />
                    </FormField>
                  </FormGrid>

                  <FormField label="Observações">
                    <Textarea
                      value={form.notes}
                      onChange={(event) => set("notes", event.target.value)}
                      rows={3}
                      maxLength={2000}
                      placeholder="Informações relevantes sobre o veículo."
                    />
                  </FormField>
                </Section>

                <Separator />

                <Section
                  title="Classificação"
                  description="Tipo, carroceria e o modelo do cadastro mestre. Marca e modelo não são texto livre."
                >
                  <FormGrid columns={2}>
                    <FormField label="Tipo de equipamento" required>
                      <Select
                        value={form.vehicle_type_id || NONE}
                        onValueChange={(value) => {
                          set("vehicle_type_id", value === NONE ? "" : value);
                          // The subcategory belonged to the previous type.
                          set("vehicle_subcategory_id", "");
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          {options.types.map((type) => (
                            <SelectItem key={type.id} value={type.id}>
                              {type.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>

                    <FormField
                      label="Subcategoria / carroceria"
                      disabled={!form.vehicle_type_id}
                      helperText={
                        form.vehicle_type_id
                          ? undefined
                          : "Escolha o tipo de equipamento para ver as subcategorias."
                      }
                    >
                      <Select
                        value={form.vehicle_subcategory_id || NONE}
                        onValueChange={(value) =>
                          set("vehicle_subcategory_id", value === NONE ? "" : value)
                        }
                        disabled={!form.vehicle_type_id || subcategories.length === 0}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Não informada" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>Não informada</SelectItem>
                          {subcategories.map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>

                    <FormField label="Marca">
                      <Select
                        value={form.vehicle_make_id || NONE}
                        onValueChange={(value) => {
                          set("vehicle_make_id", value === NONE ? "" : value);
                          set("vehicle_model_id", "");
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Não informada" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>Não informada</SelectItem>
                          {options.makes.map((make) => (
                            <SelectItem key={make.id} value={make.id}>
                              {make.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>

                    <FormField label="Modelo">
                      <Select
                        value={form.vehicle_model_id || NONE}
                        onValueChange={(value) => set("vehicle_model_id", value === NONE ? "" : value)}
                        disabled={models.length === 0}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Não informado" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>Não informado</SelectItem>
                          {models.map((model) => (
                            <SelectItem key={model.id} value={model.id}>
                              {model.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>

                    <FormField label="Ano de fabricação">
                      <Input
                        value={form.manufacture_year}
                        onChange={(event) =>
                          set("manufacture_year", event.target.value.replace(/\D/g, "").slice(0, 4))
                        }
                        inputMode="numeric"
                        placeholder="2021"
                      />
                    </FormField>

                    <FormField label="Ano do modelo">
                      <Input
                        value={form.model_year}
                        onChange={(event) =>
                          set("model_year", event.target.value.replace(/\D/g, "").slice(0, 4))
                        }
                        inputMode="numeric"
                        placeholder="2022"
                      />
                    </FormField>
                  </FormGrid>
                </Section>

                <Separator />

                <Section
                  title="Vínculo operacional"
                  description="Operação → Estado → Cidade, na cobertura definida em Administração > Operações."
                >
                  {isEdit ? (
                    <Alert variant="info">
                      <AlertTitle>A alocação não se altera por aqui</AlertTitle>
                      <AlertDescription>
                        Transferir o veículo é uma movimentação com data de vigência e histórico
                        próprio. Use <strong>Transferir operação</strong> nos detalhes do veículo.
                      </AlertDescription>
                    </Alert>
                  ) : !canAssign ? (
                    <Alert variant="info">
                      <AlertTitle>Cadastro sem alocação</AlertTitle>
                      <AlertDescription>
                        Seu perfil não inclui a permissão de alocar veículos. O cadastro é criado sem
                        alocação operacional, e alguém com essa permissão pode alocá-lo depois.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <>
                      <FormGrid columns={2}>
                        <FormField
                          label="Operação"
                          helperText="Opcional. Sem operação o veículo fica “sem alocação”, o que é diferente de inativo."
                        >
                          <Select
                            value={form.operation_id || NONE}
                            onValueChange={(value) => {
                              set("operation_id", value === NONE ? "" : value);
                              set("state_id", "");
                              set("city_id", "");
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Sem alocação" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>Sem alocação</SelectItem>
                              {options.operations.map((operation) => (
                                <SelectItem key={operation.id} value={operation.id}>
                                  {operation.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormField>

                        <FormField
                          label="Estado"
                          required={Boolean(form.operation_id)}
                          disabled={!form.operation_id}
                          helperText={
                            form.operation_id && geography.states.length === 0 && !geography.loading
                              ? "Esta operação não possui estados na cobertura."
                              : undefined
                          }
                        >
                          <Select
                            value={form.state_id || NONE}
                            onValueChange={(value) => {
                              set("state_id", value === NONE ? "" : value);
                              set("city_id", "");
                            }}
                            disabled={!form.operation_id || geography.states.length === 0}
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

                        <FormField
                          label="Cidade"
                          required={Boolean(form.operation_id)}
                          disabled={!form.state_id}
                        >
                          <Select
                            value={form.city_id || NONE}
                            onValueChange={(value) => set("city_id", value === NONE ? "" : value)}
                            disabled={!form.state_id || geography.cities.length === 0}
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

                        <FormField label="Início do vínculo" disabled={!form.operation_id}>
                          <DateInput
                            value={form.assigned_from}
                            onChange={(event) => set("assigned_from", event.target.value)}
                            disabled={!form.operation_id}
                          />
                        </FormField>
                      </FormGrid>

                      {form.operation_id ? (
                        <FormField label="Motivo da alocação">
                          <Input
                            value={form.assignment_reason}
                            onChange={(event) => set("assignment_reason", event.target.value)}
                            placeholder="Cadastro inicial"
                          />
                        </FormField>
                      ) : null}
                    </>
                  )}

                  {/* Filial e centro de custo são outras dimensões: não se
                      deduzem da cidade nem da operação (§30). */}
                  <FormGrid columns={2}>
                    <FormField label="Filial">
                      <Select
                        value={form.organization_unit_id || NONE}
                        onValueChange={(value) =>
                          set("organization_unit_id", value === NONE ? "" : value)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Não informada" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>Não informada</SelectItem>
                          {options.units.map((unit) => (
                            <SelectItem key={unit.id} value={unit.id}>
                              {unit.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>

                    <FormField label="Centro de custo">
                      <Select
                        value={form.cost_center_id || NONE}
                        onValueChange={(value) => set("cost_center_id", value === NONE ? "" : value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Não informado" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>Não informado</SelectItem>
                          {options.costCenters.map((center) => (
                            <SelectItem key={center.id} value={center.id}>
                              {center.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                  </FormGrid>
                </Section>

                <Separator />

                <Section
                  title="Documentação e dados técnicos"
                  description="Campos opcionais no cadastro inicial. Em branco não significa irregularidade."
                >
                  <FormGrid columns={2}>
                    <FormField
                      label="Chassi (VIN)"
                      error={vinInvalid ? "O chassi deve ter 17 caracteres, sem I, O ou Q." : undefined}
                    >
                      <Input
                        value={form.vin}
                        onChange={(event) => set("vin", event.target.value.toUpperCase())}
                        maxLength={17}
                        placeholder="9BW11111111111111"
                      />
                    </FormField>

                    <FormField
                      label="RENAVAM"
                      error={renavamInvalid ? "O RENAVAM deve ter 9 a 11 dígitos." : undefined}
                    >
                      <Input
                        value={form.renavam}
                        onChange={(event) => set("renavam", event.target.value.replace(/\D/g, ""))}
                        maxLength={11}
                        inputMode="numeric"
                        placeholder="00123456789"
                      />
                    </FormField>

                    <FormField label="Registro ANTT / RNTRC" helperText="Somente quando aplicável ao veículo.">
                      <Input
                        value={form.antt_code}
                        onChange={(event) => set("antt_code", event.target.value.replace(/\D/g, ""))}
                        maxLength={12}
                        inputMode="numeric"
                      />
                    </FormField>

                    <FormField label="Tacógrafo">
                      <div className="flex items-center gap-3 pt-1.5">
                        <Switch
                          checked={form.has_tachograph}
                          onCheckedChange={(checked) => {
                            set("has_tachograph", checked);
                            if (!checked) set("tachograph_number", "");
                          }}
                          aria-label="Possui tacógrafo"
                        />
                        <span className="text-body-sm text-fg-secondary">
                          {form.has_tachograph ? "Possui tacógrafo" : "Não possui tacógrafo"}
                        </span>
                      </div>
                    </FormField>

                    {form.has_tachograph ? (
                      <FormField label="Número do tacógrafo">
                        <Input
                          value={form.tachograph_number}
                          onChange={(event) => set("tachograph_number", event.target.value)}
                          maxLength={40}
                        />
                      </FormField>
                    ) : null}
                  </FormGrid>
                </Section>

                <Separator />

                <Section
                  title="Quilometragem"
                  description="A leitura oficial vem do hodômetro, não de um número editável."
                >
                  {isEdit ? (
                    <Alert variant="info">
                      <AlertTitle>A quilometragem não se edita por aqui</AlertTitle>
                      <AlertDescription>
                        A leitura vigente só muda por correção registrada, com valor anterior, motivo e
                        responsável. Use <strong>Corrigir quilometragem</strong> nos detalhes do veículo.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <FormGrid columns={2}>
                      <FormField
                        label="KM inicial"
                        helperText="Opcional. Em branco o veículo fica sem leitura — não com zero."
                      >
                        <Input
                          value={form.initial_odometer_km}
                          onChange={(event) =>
                            set("initial_odometer_km", event.target.value.replace(/\D/g, ""))
                          }
                          inputMode="numeric"
                          placeholder="120000"
                        />
                      </FormField>

                      <FormField label="Data da leitura" disabled={!form.initial_odometer_km}>
                        <DateInput
                          value={form.initial_odometer_date}
                          onChange={(event) => set("initial_odometer_date", event.target.value)}
                          disabled={!form.initial_odometer_km}
                        />
                      </FormField>
                    </FormGrid>
                  )}
                </Section>

                <Separator />

                <Section
                  title="Aplicativos e regras"
                  description="O que deste cadastro influencia a elegibilidade do veículo em outros módulos."
                >
                  {/* Nenhuma flag de elegibilidade é gravada aqui (§68): quem
                      decide é o módulo do aplicativo, lendo estes campos. */}
                  <ul className="flex flex-col gap-1 text-body-sm text-fg-secondary">
                    <li>· Situação cadastral: veículos inativos ficam fora dos aplicativos operacionais.</li>
                    <li>· Tipo e subcategoria: definem quais operações o veículo pode atender.</li>
                    <li>· Alocação vigente: a operação e a cidade determinam quem o enxerga e o utiliza.</li>
                  </ul>
                  <p className="text-caption text-fg-muted">
                    A elegibilidade efetiva é resolvida pelo módulo responsável. Este cadastro informa os
                    atributos; não guarda uma segunda marcação de elegibilidade.
                  </p>
                </Section>

                {isEdit ? (
                  <>
                    <Separator />
                    <Section
                      title="Histórico e auditoria"
                      description="Toda alteração cadastral é registrada e não pode ser apagada."
                    >
                      <p className="text-body-sm text-fg-secondary">
                        A linha do tempo completa — alterações, mudanças de situação, alocações e leituras
                        de quilometragem — fica na aba <strong>Histórico</strong> dos detalhes do veículo.
                      </p>
                    </Section>
                  </>
                ) : null}
              </>
            )}
          </DrawerBody>

          <DrawerFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" leadingIcon={<Save />} disabled={!canSubmit || saving || loading}>
              {saving ? "Salvando…" : isEdit ? "Salvar alterações" : "Cadastrar veículo"}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
