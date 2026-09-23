"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Search, Truck, UserRound } from "lucide-react";
import {
  Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import { NativeSelect } from "@/components/governance/selects";
import {
  loadBranchAudit, loadBranchEmployees, loadBranchOperationImpact, loadBranchVehicles, saveBranch,
  type BranchAuditRow, type BranchEmployeeRow, type BranchVehicleRow,
} from "@/lib/branches/actions";
import type { BranchOperationRow } from "@/lib/branches/queries";
import { isValidCnpj, maskCnpjInput, maskPostalInput, normalizeDocument } from "@/lib/branches/format";
import { listCitiesOfState } from "@/lib/organization/actions";
import { BranchCostCentersTab, type BranchCostCenterLoaders } from "./branch-cost-centers-tab";

export interface BranchFormValue {
  id?: string;
  code: string;
  name: string;
  legalName: string | null;
  documentNumber: string | null;
  status: "active" | "inactive";
  notes: string | null;
  postalCode: string | null;
  street: string | null;
  streetNumber: string | null;
  complement: string | null;
  district: string | null;
  stateId: number | null;
  cityId: number | null;
  operations: string[];
  updatedAt?: string | null;
}

export interface BranchFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value?: BranchFormValue;
  operations: { id: string; code: string | null; name: string; status: string }[];
  /** Historical links, so an inactive operation the branch used to serve still shows. */
  links: BranchOperationRow[];
  states: { id: number; uf: string; name: string }[];
  canManageOperations: boolean;
  canViewEmployees: boolean;
  canViewVehicles: boolean;
  canViewAudit: boolean;
  /** §38: a aba Centros de custo aparece para quem lê centros de custo. */
  canViewCostCenters?: boolean;
  /** Associar e desassociar exige `branches.update` e `cost_centers.manage`. */
  canManageCostCenters?: boolean;
  /** Prévia de desenvolvimento: dados fixos no lugar das server actions. */
  costCenterLoaders?: BranchCostCenterLoaders;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const iso = value.length > 10 ? value.slice(0, 10) : value;
  const [y, m, d] = iso.split("-");
  return d ? `${d}/${m}/${y}` : value;
}

const ACTION_LABEL: Record<string, string> = {
  INSERT: "Criado",
  UPDATE: "Alterado",
  DELETE: "Removido",
};

const ENTITY_LABEL: Record<string, string> = {
  "public.organization_units": "Filial",
  "public.organization_unit_operations": "Operação vinculada",
  "public.vehicle_unit_assignments": "Veículo",
  "public.cost_centers": "Centro de custo",
  branch_import: "Importação",
};

/**
 * Cadastro da filial, em seções (§44).
 *
 * Dados Gerais, Endereço, Operações Vinculadas e Observações são o formulário.
 * Colaboradores, Frotas e Histórico só existem depois que a filial existe —
 * são leituras dos módulos oficiais, não cadastros próprios, e por isso não
 * aparecem enquanto não há um id para consultar.
 */
export function BranchFormDrawer({
  open,
  onOpenChange,
  value,
  operations,
  links,
  states,
  canManageOperations,
  canViewEmployees,
  canViewVehicles,
  canViewAudit,
  canViewCostCenters = false,
  canManageCostCenters = false,
  costCenterLoaders,
}: BranchFormDrawerProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [saving, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const blank = (): BranchFormValue => ({
    code: "",
    name: "",
    legalName: null,
    documentNumber: null,
    status: "active",
    notes: null,
    postalCode: null,
    street: null,
    streetNumber: null,
    complement: null,
    district: null,
    stateId: null,
    cityId: null,
    operations: [],
  });

  // Initialised at mount; the parent remounts the drawer on every open.
  const [form, setForm] = React.useState<BranchFormValue>(value ?? blank());
  const [cnpjText, setCnpjText] = React.useState(maskCnpjInput(value?.documentNumber ?? ""));
  const [cepText, setCepText] = React.useState(maskPostalInput(value?.postalCode ?? ""));
  const [operationSearch, setOperationSearch] = React.useState("");
  // The loaded list carries the state it belongs to. Comparing them is what
  // clears it when the state changes — derived, not reset from an effect that
  // would re-render the whole drawer a second time on every pick.
  const [loaded, setLoaded] = React.useState<{ stateId: number; rows: { id: number; name: string }[] } | null>(null);

  const patch = (next: Partial<BranchFormValue>) => setForm((f) => ({ ...f, ...next }));

  // The municipality list follows the state. It is the IBGE table, not an
  // operation's coverage: this is the branch's physical address (§18).
  React.useEffect(() => {
    const stateId = form.stateId;
    if (!stateId) return;
    let cancelled = false;
    (async () => {
      const rows = await listCitiesOfState(stateId);
      if (cancelled) return;
      setLoaded({ stateId, rows: rows.map((c) => ({ id: c.id, name: c.name })) });
    })();
    return () => {
      cancelled = true;
    };
  }, [form.stateId]);

  const cities = loaded?.stateId === form.stateId ? loaded.rows : [];
  const loadingCities = Boolean(form.stateId) && loaded?.stateId !== form.stateId;

  const cnpjInvalid = cnpjText.replace(/\D/g, "").length > 0 && !isValidCnpj(cnpjText);

  const visibleOperations = React.useMemo(() => {
    const term = operationSearch.trim().toLowerCase();
    const historical = new Set(links.filter((l) => !l.isCurrent).map((l) => l.operationId));
    return operations
      // §25: an inactive operation cannot be newly linked. It still appears when
      // the branch already serves it or used to — the history does not vanish.
      .filter((o) => o.status === "active" || form.operations.includes(o.id) || historical.has(o.id))
      .filter((o) => !term || o.name.toLowerCase().includes(term) || (o.code ?? "").toLowerCase().includes(term));
  }, [operations, operationSearch, form.operations, links]);

  const linkOf = (operationId: string) => links.find((l) => l.operationId === operationId);

  const toggleOperation = async (operationId: string) => {
    const selected = form.operations.includes(operationId);

    if (selected) {
      // §26: unlinking shows the real impact first. Nothing is transferred and
      // nothing is deleted — the warning exists so the decision is informed.
      const impact = await loadBranchOperationImpact(form.id ?? "", operationId);
      if (form.id && impact.ok && impact.data && (impact.data.employees > 0 || impact.data.vehicles > 0)) {
        toast({
          title: `Ao salvar, esta operação será desvinculada — ${impact.data.employees} colaborador(es) e ${impact.data.vehicles} veículo(s) continuam como estão.`,
          variant: "warning",
        });
      }
      patch({ operations: form.operations.filter((id) => id !== operationId) });
      return;
    }
    patch({ operations: [...form.operations, operationId] });
  };

  const submit = () => {
    setError(null);
    if (!form.code.trim()) return setError("Informe o código interno da filial.");
    if (!form.name.trim()) return setError("Informe o nome da filial.");
    if (cnpjInvalid) return setError("O CNPJ informado é inválido.");
    if (form.cityId && !form.stateId) return setError("Informe o estado do endereço.");

    startTransition(async () => {
      const result = await saveBranch({
        id: form.id ?? null,
        code: form.code.trim(),
        name: form.name.trim(),
        legalName: form.legalName,
        documentNumber: normalizeDocument(cnpjText),
        status: form.status,
        notes: form.notes,
        postalCode: normalizeDocument(cepText),
        street: form.street,
        streetNumber: form.streetNumber,
        complement: form.complement,
        district: form.district,
        stateId: form.stateId,
        cityId: form.cityId,
        operations: canManageOperations ? form.operations : null,
        expectedUpdatedAt: form.updatedAt ?? null,
      });

      if (!result.ok) {
        setError(result.error ?? "Não foi possível salvar a filial.");
        return;
      }
      toast({ title: form.id ? "Filial atualizada." : "Filial cadastrada.", variant: "success" });
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent size="lg">
        <DrawerHeader>
          <DrawerTitle>{form.id ? `Editar ${form.name}` : "Nova filial"}</DrawerTitle>
          <DrawerDescription>
            A filial é a unidade que responde pelos colaboradores e pela frota. O endereço dela é
            o endereço físico — ele não define a cobertura geográfica das operações vinculadas.
          </DrawerDescription>
        </DrawerHeader>

        <DrawerBody className="flex flex-col gap-4">
          {error ? (
            <Alert variant="danger">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Tabs defaultValue="gerais">
            <TabsList>
              <TabsTrigger value="gerais">Dados gerais</TabsTrigger>
              <TabsTrigger value="endereco">Endereço</TabsTrigger>
              <TabsTrigger value="operacoes">
                Operações
                {form.operations.length > 0 ? (
                  <Badge variant="primary" appearance="soft" size="sm" className="ml-1.5">
                    {form.operations.length}
                  </Badge>
                ) : null}
              </TabsTrigger>
              {form.id && canViewEmployees ? <TabsTrigger value="colaboradores">Colaboradores</TabsTrigger> : null}
              {form.id && canViewVehicles ? <TabsTrigger value="frotas">Frotas</TabsTrigger> : null}
              {form.id && canViewCostCenters ? <TabsTrigger value="centros">Centros de custo</TabsTrigger> : null}
              {form.id && canViewAudit ? <TabsTrigger value="historico">Histórico</TabsTrigger> : null}
            </TabsList>

            {/* ------------------------------------------------ dados gerais */}
            <TabsContent value="gerais" className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  label="Código interno"
                  required
                  id="branch-code"
                  helperText="Aceita letras e números. Zeros à esquerda são preservados — 087 e 87 são códigos diferentes."
                >
                  <Input
                    id="branch-code"
                    value={form.code}
                    maxLength={30}
                    autoComplete="off"
                    placeholder="Ex.: 87 ou MG-01"
                    onChange={(e) => patch({ code: e.target.value.toUpperCase() })}
                  />
                </FormField>

                <FormField label="Situação" id="branch-status">
                  <NativeSelect
                    id="branch-status"
                    value={form.status}
                    onChange={(e) => patch({ status: e.target.value as "active" | "inactive" })}
                  >
                    <option value="active">Ativa</option>
                    <option value="inactive">Inativa</option>
                  </NativeSelect>
                </FormField>
              </div>

              <FormField label="Nome da filial" required id="branch-name">
                <Input
                  id="branch-name"
                  value={form.name}
                  maxLength={200}
                  placeholder="Ex.: Horizonte MG"
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </FormField>

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  label="Razão social"
                  id="branch-legal-name"
                  labelHint="Opcional"
                  helperText="Uma unidade operacional pode compartilhar a razão social da matriz."
                >
                  <Input
                    id="branch-legal-name"
                    value={form.legalName ?? ""}
                    maxLength={200}
                    onChange={(e) => patch({ legalName: e.target.value || null })}
                  />
                </FormField>

                <FormField
                  label="CNPJ"
                  id="branch-cnpj"
                  labelHint="Opcional"
                  error={cnpjInvalid ? "CNPJ inválido — confira os dígitos." : undefined}
                  helperText={!cnpjInvalid ? "Não é exigido de unidades sem inscrição própria." : undefined}
                >
                  <Input
                    id="branch-cnpj"
                    value={cnpjText}
                    inputMode="numeric"
                    placeholder="00.000.000/0000-00"
                    onChange={(e) => setCnpjText(maskCnpjInput(e.target.value))}
                  />
                </FormField>
              </div>
            </TabsContent>

            {/* ---------------------------------------------------- endereço */}
            <TabsContent value="endereco" className="flex flex-col gap-4">
              <p className="text-caption text-fg-muted">
                Endereço físico da filial. Uma filial em implantação pode ficar sem endereço
                completo — nenhum campo aqui é obrigatório.
              </p>

              <div className="grid gap-3 sm:grid-cols-3">
                <FormField label="CEP" id="branch-cep">
                  <Input
                    id="branch-cep"
                    value={cepText}
                    inputMode="numeric"
                    placeholder="00000-000"
                    onChange={(e) => setCepText(maskPostalInput(e.target.value))}
                  />
                </FormField>

                <FormField label="Estado" id="branch-state">
                  <NativeSelect
                    id="branch-state"
                    value={form.stateId === null ? "" : String(form.stateId)}
                    onChange={(e) =>
                      patch({ stateId: e.target.value ? Number(e.target.value) : null, cityId: null })
                    }
                  >
                    <option value="">Selecione</option>
                    {states.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.uf} — {s.name}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>

                <FormField label="Cidade" id="branch-city">
                  <NativeSelect
                    id="branch-city"
                    value={form.cityId === null ? "" : String(form.cityId)}
                    disabled={!form.stateId || loadingCities}
                    onChange={(e) => patch({ cityId: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">
                      {!form.stateId ? "Escolha o estado" : loadingCities ? "Carregando…" : "Selecione"}
                    </option>
                    {cities.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </NativeSelect>
                </FormField>
              </div>

              <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
                <FormField label="Logradouro" id="branch-street">
                  <Input
                    id="branch-street"
                    value={form.street ?? ""}
                    maxLength={200}
                    onChange={(e) => patch({ street: e.target.value || null })}
                  />
                </FormField>
                <FormField label="Número" id="branch-number">
                  <Input
                    id="branch-number"
                    value={form.streetNumber ?? ""}
                    maxLength={20}
                    onChange={(e) => patch({ streetNumber: e.target.value || null })}
                  />
                </FormField>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Complemento" id="branch-complement">
                  <Input
                    id="branch-complement"
                    value={form.complement ?? ""}
                    maxLength={120}
                    onChange={(e) => patch({ complement: e.target.value || null })}
                  />
                </FormField>
                <FormField label="Bairro" id="branch-district">
                  <Input
                    id="branch-district"
                    value={form.district ?? ""}
                    maxLength={120}
                    onChange={(e) => patch({ district: e.target.value || null })}
                  />
                </FormField>
              </div>

              <FormField label="Observações" id="branch-notes" labelHint="Opcional">
                <Textarea
                  id="branch-notes"
                  rows={3}
                  value={form.notes ?? ""}
                  onChange={(e) => patch({ notes: e.target.value || null })}
                  placeholder="Informações adicionais que não possuem campo próprio."
                />
              </FormField>
            </TabsContent>

            {/* -------------------------------------------------- operações */}
            <TabsContent value="operacoes" className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-body-sm text-fg-secondary">
                  {form.operations.length === 0
                    ? "Sem operações vinculadas."
                    : `${form.operations.length} operação(ões) selecionada(s).`}
                </p>
                <div className="w-56">
                  <Input
                    value={operationSearch}
                    leadingIcon={<Search />}
                    placeholder="Buscar operação"
                    aria-label="Buscar operação"
                    onChange={(e) => setOperationSearch(e.target.value)}
                  />
                </div>
              </div>

              {!canManageOperations ? (
                <Alert variant="info">
                  <AlertDescription>
                    Você pode consultar as operações vinculadas, mas não alterá-las.
                  </AlertDescription>
                </Alert>
              ) : null}

              <ul className="divide-y divide-border rounded-md border border-border">
                {visibleOperations.length === 0 ? (
                  <li className="px-3 py-6 text-center text-body-sm text-fg-muted">
                    Nenhuma operação encontrada.
                  </li>
                ) : (
                  visibleOperations.map((operation) => {
                    const selected = form.operations.includes(operation.id);
                    const link = linkOf(operation.id);
                    const blocked = operation.status !== "active" && !selected;
                    return (
                      <li key={operation.id}>
                        <button
                          type="button"
                          disabled={!canManageOperations || blocked}
                          aria-pressed={selected}
                          onClick={() => toggleOperation(operation.id)}
                          className="flex w-full items-center gap-3 px-3 py-2.5 text-left hfm-focus-ring enabled:hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <span
                            aria-hidden
                            className={
                              selected
                                ? "flex size-4 shrink-0 items-center justify-center rounded-xs bg-primary text-primary-fg"
                                : "size-4 shrink-0 rounded-xs border border-border-strong"
                            }
                          >
                            {selected ? <Check className="size-3" /> : null}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-body-sm font-medium text-fg">
                                {operation.name}
                              </span>
                              {operation.code ? (
                                <span className="font-mono text-caption text-fg-muted">
                                  {operation.code}
                                </span>
                              ) : null}
                              {operation.status !== "active" ? (
                                <Badge variant="neutral" appearance="soft" size="sm">Inativa</Badge>
                              ) : null}
                            </span>
                            <span className="block text-caption text-fg-muted">
                              {link?.isCurrent
                                ? `Vinculada desde ${formatDate(link.effectiveFrom)}`
                                : link
                                  ? `Vínculo encerrado em ${formatDate(link.effectiveTo)}`
                                  : "Sem vínculo"}
                              {link && link.vehicleCount > 0
                                ? ` · ${link.vehicleCount} veículo(s) nesta combinação`
                                : ""}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>

              <p className="text-caption text-fg-muted">
                Desvincular uma operação encerra o vínculo com a data de hoje. O histórico
                permanece, e nenhum colaborador ou veículo é transferido automaticamente.
              </p>
            </TabsContent>

            {form.id && canViewEmployees ? (
              <TabsContent value="colaboradores">
                <BranchEmployeesTab branchId={form.id} />
              </TabsContent>
            ) : null}

            {form.id && canViewVehicles ? (
              <TabsContent value="frotas">
                <BranchVehiclesTab branchId={form.id} />
              </TabsContent>
            ) : null}

            {form.id && canViewCostCenters ? (
              <TabsContent value="centros">
                <BranchCostCentersTab
                  branchId={form.id}
                  branchName={value?.name ?? form.name}
                  branchActive={(value?.status ?? form.status) === "active"}
                  canManage={canManageCostCenters}
                  loaders={costCenterLoaders}
                />
              </TabsContent>
            ) : null}

            {form.id && canViewAudit ? (
              <TabsContent value="historico">
                <BranchAuditTab branchId={form.id} />
              </TabsContent>
            ) : null}
          </Tabs>
        </DrawerBody>

        <DrawerFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            {form.id ? "Salvar alterações" : "Cadastrar filial"}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ abas */

function useLazy<T>(load: () => Promise<{ ok: boolean; error?: string; data?: T }>) {
  const [state, setState] = React.useState<{ loading: boolean; error: string | null; data: T | null }>({
    loading: true,
    error: null,
    data: null,
  });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await load();
      if (cancelled) return;
      setState({
        loading: false,
        error: result.ok ? null : result.error ?? "Não foi possível carregar.",
        data: result.ok ? result.data ?? null : null,
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}

function TabState({ loading, error }: { loading: boolean; error: string | null }) {
  if (loading) {
    return (
      <p className="flex items-center gap-2 py-6 text-body-sm text-fg-muted">
        <Loader2 aria-hidden className="size-4 animate-spin" />
        Carregando…
      </p>
    );
  }
  return <p className="py-6 text-body-sm text-danger">{error}</p>;
}

function BranchEmployeesTab({ branchId }: { branchId: string }) {
  const { loading, error, data } = useLazy<BranchEmployeeRow[]>(() => loadBranchEmployees(branchId));
  if (loading || error) return <TabState loading={loading} error={error} />;
  if (!data?.length) {
    return <p className="py-6 text-body-sm text-fg-muted">Nenhum colaborador vinculado a esta filial.</p>;
  }

  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {data.map((row) => (
        <li key={row.employeeId} className="flex items-center gap-3 px-3 py-2">
          <UserRound aria-hidden className="size-4 shrink-0 text-fg-muted" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body-sm font-medium text-fg">{row.fullName}</span>
            <span className="block truncate text-caption text-fg-muted">
              {[row.employeeCode ? `Matrícula ${row.employeeCode}` : null, row.jobPosition, row.operationName, row.cityName]
                .filter(Boolean)
                .join(" · ") || "Sem vínculo funcional registrado"}
            </span>
          </span>
          <StatusBadge status={row.status === "active" ? "success" : "neutral"} size="sm">
            {row.status === "active" ? "Ativo" : "Inativo"}
          </StatusBadge>
        </li>
      ))}
    </ul>
  );
}

function BranchVehiclesTab({ branchId }: { branchId: string }) {
  const { loading, error, data } = useLazy<BranchVehicleRow[]>(() => loadBranchVehicles(branchId));
  if (loading || error) return <TabState loading={loading} error={error} />;
  if (!data?.length) {
    return <p className="py-6 text-body-sm text-fg-muted">Nenhum veículo sob responsabilidade desta filial.</p>;
  }

  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {data.map((row) => (
        <li key={row.vehicleId} className="flex items-center gap-3 px-3 py-2">
          <Truck aria-hidden className="size-4 shrink-0 text-fg-muted" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body-sm font-medium text-fg">
              {row.fleetCode ?? row.licensePlate ?? "Sem identificação"}
              {row.fleetCode && row.licensePlate ? (
                <span className="font-normal text-fg-muted"> · {row.licensePlate}</span>
              ) : null}
            </span>
            <span className="block truncate text-caption text-fg-muted">
              {[row.vehicleType, row.operationName, row.cityName].filter(Boolean).join(" · ") || "—"}
            </span>
          </span>
          <StatusBadge status={row.status === "active" ? "success" : "neutral"} size="sm">
            {row.status === "active" ? "Ativo" : "Inativo"}
          </StatusBadge>
        </li>
      ))}
    </ul>
  );
}

function BranchAuditTab({ branchId }: { branchId: string }) {
  const { loading, error, data } = useLazy<BranchAuditRow[]>(() => loadBranchAudit(branchId));
  if (loading || error) return <TabState loading={loading} error={error} />;
  if (!data?.length) {
    return <p className="py-6 text-body-sm text-fg-muted">Nenhum evento registrado.</p>;
  }

  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {data.map((row) => (
        <li key={row.id} className="flex flex-col gap-0.5 px-3 py-2">
          <span className="flex items-center gap-2 text-body-sm">
            <Badge variant="neutral" appearance="soft" size="sm">
              {ENTITY_LABEL[row.entityType] ?? row.entityType}
            </Badge>
            <span className="text-fg">{ACTION_LABEL[row.action] ?? row.action}</span>
            <span className="text-fg-muted">
              {new Date(row.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
            </span>
          </span>
          <span className="text-caption text-fg-muted">
            {row.actorName ? `Por ${row.actorName}` : "Autor não identificado"}
            {row.changedFields.length > 0 ? ` · ${row.changedFields.join(", ")}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
