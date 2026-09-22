"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, Trash2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApplicationLinksPanel } from "@/components/applications/application-links-panel";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { LoadingState } from "@/components/feedback/loading-state";
import { EmptyState } from "@/components/feedback/empty-state";
import { useToast } from "@/components/feedback/toast";
import type {
  EquipmentOptions,
  EquipmentTypeDetail,
  ModuleRule,
} from "@/lib/equipment/queries";
import { saveEquipmentType, type SubcategoryInput } from "@/lib/equipment/actions";
import {
  loadEquipmentType,
  loadEquipmentTypeHistory,
  type HistoryEntry,
} from "@/lib/equipment/detail-actions";

const numberFormat = new Intl.NumberFormat("pt-BR");
const dateTimeFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

/**
 * The three questions a module can ask about a type, spelled out (§25, §54).
 *
 * A single checkbox labelled "Motor de Aderência" would leave the reader
 * guessing which of these it controls — and they are not the same thing. A
 * vehicle can be visible to the checklist module without being counted in its
 * adherence indicator.
 */
const CAPABILITIES = [
  {
    id: "visibility" as const,
    label: "Pode consultar",
    effect: "O módulo enxerga os veículos deste tipo nas suas telas e consultas.",
  },
  {
    id: "operation" as const,
    label: "Elegível à operação",
    effect: "Veículos deste tipo participam das rotinas operacionais do módulo.",
  },
  {
    id: "indicator" as const,
    label: "Entra no indicador",
    effect: "Veículos deste tipo são contabilizados no indicador calculado pelo módulo.",
  },
];

const ENTITY_LABELS: Record<string, string> = {
  vehicle_types: "Tipo",
  vehicle_subcategories: "Subcategoria",
  vehicle_type_settings: "Configuração",
  vehicle_type_operations: "Operações",
  vehicle_type_apps: "Aplicativos",
  vehicle_type_module_rules: "Elegibilidade",
};

const ACTION_LABELS: Record<string, string> = {
  INSERT: "criado",
  UPDATE: "atualizado",
  DELETE: "removido",
};

interface FormState {
  name: string;
  description: string;
  operationRestrictionEnabled: boolean;
  requiresSubcategory: boolean;
  notes: string;
  subcategories: (SubcategoryInput & { vehicleCount: number; scope: "global" | "organization" })[];
  operations: string[];
  apps: string[];
  moduleRules: Record<string, boolean>;
}

const ruleKey = (moduleCode: string, capability: string) => `${moduleCode}:${capability}`;

function toFormState(detail: EquipmentTypeDetail): FormState {
  const rules: Record<string, boolean> = {};
  for (const rule of detail.moduleRules) rules[ruleKey(rule.moduleCode, rule.capability)] = rule.isEligible;

  return {
    name: detail.name,
    description: detail.description ?? "",
    operationRestrictionEnabled: detail.settings.operationRestrictionEnabled,
    requiresSubcategory: detail.settings.requiresSubcategory,
    notes: detail.settings.notes ?? "",
    subcategories: detail.subcategories.map((sub) => ({
      id: sub.id,
      name: sub.name,
      description: sub.description ?? "",
      isActive: sub.isActive,
      vehicleCount: sub.vehicleCount,
      scope: sub.scope,
    })),
    operations: detail.operations.map((op) => op.operationId),
    apps: detail.apps.map((app) => app.appId),
    moduleRules: rules,
  };
}

const EMPTY: FormState = {
  name: "",
  description: "",
  operationRestrictionEnabled: false,
  requiresSubcategory: false,
  notes: "",
  subcategories: [],
  operations: [],
  apps: [],
  moduleRules: {},
};

/**
 * Creating and parameterising a type.
 *
 * One form, one save (§37). Everything the tabs touch travels together to a
 * routine that applies it in a single transaction — so a type never ends up
 * created with its subcategories missing because a second request failed.
 */
export function EquipmentTypeDrawer({
  open,
  typeId,
  options,
  permissions,
  isPlatformAdmin,
  onOpenChange,
}: {
  open: boolean;
  typeId: string | null;
  options: EquipmentOptions;
  permissions: string[];
  isPlatformAdmin: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [detail, setDetail] = React.useState<EquipmentTypeDetail | null>(null);
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [history, setHistory] = React.useState<HistoryEntry[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const isEdit = Boolean(typeId);
  const can = (permission: string) => isPlatformAdmin || permissions.includes(permission);
  const isGlobal = detail?.scope === "global";
  const canEditIdentity = can(isEdit ? "equipment_types.update" : "equipment_types.create") && !isGlobal;
  const canViewAudit = can("equipment_types.view_audit");

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const target = `${open ? "open" : "closed"}:${typeId ?? ""}`;
  const [loadedTarget, setLoadedTarget] = React.useState(target);
  if (loadedTarget !== target) {
    setLoadedTarget(target);
    setForm(EMPTY);
    setDetail(null);
    setHistory([]);
    setError(null);
    setLoading(Boolean(open && typeId));
  }

  React.useEffect(() => {
    if (!open || !typeId) return;

    let active = true;
    void Promise.all([
      loadEquipmentType(typeId),
      canViewAudit ? loadEquipmentTypeHistory(typeId) : Promise.resolve(null),
    ])
      .then(([detailResult, historyResult]) => {
        if (!active) return;
        if (!detailResult.ok || !detailResult.data) {
          setError(detailResult.error ?? "Não foi possível carregar o tipo.");
          return;
        }
        setDetail(detailResult.data);
        setForm(toFormState(detailResult.data));
        setHistory(historyResult?.ok ? (historyResult.data ?? []) : []);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [open, typeId, canViewAudit]);

  async function submit() {
    if (saving) return;
    if (!form.name.trim() && !isGlobal) {
      setError("Informe o nome do tipo de equipamento.");
      return;
    }

    setSaving(true);
    setError(null);

    const moduleRules = Object.entries(form.moduleRules).map(([key, isEligible]) => {
      const [moduleCode, capability] = key.split(":");
      return { moduleCode, capability: capability as ModuleRule["capability"], isEligible };
    });

    const result = await saveEquipmentType({
      id: typeId ?? undefined,
      expectedUpdatedAt: detail?.updatedAt,
      // O nome de um tipo do catálogo base não é enviado: ele não é da
      // organização para ser alterado, e o banco recusaria de qualquer forma.
      ...(canEditIdentity ? { name: form.name.trim(), description: form.description.trim() || null } : {}),
      settings: {
        operationRestrictionEnabled: form.operationRestrictionEnabled,
        requiresSubcategory: form.requiresSubcategory,
        notes: form.notes.trim() || null,
      },
      ...(can("equipment_types.manage_subcategories")
        ? {
            subcategories: form.subcategories
              .filter((sub) => sub.scope === "organization")
              .map((sub) => ({
                id: sub.id ?? null,
                name: sub.name.trim(),
                description: sub.description?.trim() || null,
                isActive: sub.isActive,
              })),
          }
        : {}),
      ...(can("equipment_types.manage_operations") ? { operations: form.operations } : {}),
      ...(can("equipment_types.manage_eligibility") && moduleRules.length > 0 ? { moduleRules } : {}),
    });

    setSaving(false);

    if (!result.ok) {
      setError(result.error ?? "Não foi possível salvar o tipo.");
      return;
    }

    toast({ title: isEdit ? "Tipo atualizado" : "Tipo cadastrado", variant: "success" });
    onOpenChange(false);
    router.refresh();
  }

  function toggleOperation(id: string, checked: boolean) {
    set("operations", checked ? [...form.operations, id] : form.operations.filter((item) => item !== id));
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent size="lg">
        <DrawerHeader>
          <DrawerTitle>
            {isEdit ? detail?.name ?? "Tipo de equipamento" : "Novo tipo de equipamento"}
          </DrawerTitle>
          <DrawerDescription>
            {isEdit && detail
              ? `${detail.code} · ${detail.scope === "global" ? "catálogo base da plataforma" : "tipo da organização"}`
              : "Classificação, subcategorias e as regras que valem para esta organização."}
          </DrawerDescription>
        </DrawerHeader>

        <DrawerBody className="flex min-h-0 flex-col gap-4">
          {loading ? (
            <LoadingState label="Carregando tipo…" />
          ) : (
            <>
              {error ? (
                <Alert variant="danger">
                  <AlertTitle>Não foi possível salvar</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              {isGlobal ? (
                <Alert variant="info">
                  <AlertTitle>Tipo do catálogo base</AlertTitle>
                  <AlertDescription>
                    O nome e a descrição são mantidos pela plataforma e compartilhados entre as
                    organizações. As subcategorias próprias, as operações, os aplicativos e a
                    elegibilidade abaixo são da sua organização e podem ser configurados aqui.
                  </AlertDescription>
                </Alert>
              ) : null}

              <Tabs defaultValue="geral" className="flex min-h-0 flex-1 flex-col gap-4">
                <TabsList>
                  <TabsTrigger value="geral">Dados gerais</TabsTrigger>
                  <TabsTrigger value="subcategorias">Subcategorias</TabsTrigger>
                  <TabsTrigger value="operacoes">Operações</TabsTrigger>
                  <TabsTrigger value="aplicativos">Aplicativos</TabsTrigger>
                  <TabsTrigger value="elegibilidade">Elegibilidade</TabsTrigger>
                  {isEdit && canViewAudit ? (
                    <TabsTrigger value="historico">Histórico</TabsTrigger>
                  ) : null}
                </TabsList>

                {/* ------------------------------------------- dados gerais */}
                <TabsContent value="geral" className="flex flex-col gap-4">
                  <FormGrid columns={2}>
                    <FormField
                      label="Código"
                      helperText="Gerado pelo sistema e imutável depois de criado."
                    >
                      <Input value={detail?.code ?? "Gerado ao salvar"} disabled readOnly />
                    </FormField>

                    <FormField label="Nome" required={!isGlobal}>
                      <Input
                        value={form.name}
                        onChange={(event) => set("name", event.target.value)}
                        disabled={!canEditIdentity}
                        placeholder="Van"
                        maxLength={80}
                      />
                    </FormField>
                  </FormGrid>

                  <FormField label="Descrição">
                    <Textarea
                      value={form.description}
                      onChange={(event) => set("description", event.target.value)}
                      disabled={!canEditIdentity}
                      rows={2}
                      maxLength={500}
                      placeholder="Para que serve esta categoria na operação."
                    />
                  </FormField>

                  <Separator />

                  <FormField
                    label="Subcategoria obrigatória"
                    helperText="Quando ligado, o Cadastro de Frotas exige uma subcategoria para veículos deste tipo."
                  >
                    <div className="flex items-center gap-3 pt-1.5">
                      <Switch
                        checked={form.requiresSubcategory}
                        onCheckedChange={(checked) => set("requiresSubcategory", checked)}
                        disabled={!can("equipment_types.update")}
                        aria-label="Exigir subcategoria"
                      />
                      <span className="text-body-sm text-fg-secondary">
                        {form.requiresSubcategory ? "Exigida" : "Opcional"}
                      </span>
                    </div>
                  </FormField>

                  <FormField label="Observações">
                    <Textarea
                      value={form.notes}
                      onChange={(event) => set("notes", event.target.value)}
                      disabled={!can("equipment_types.update")}
                      rows={2}
                      maxLength={1000}
                    />
                  </FormField>
                </TabsContent>

                {/* ------------------------------------------ subcategorias */}
                <TabsContent value="subcategorias" className="flex flex-col gap-3">
                  <p className="text-caption text-fg-muted">
                    Uma subcategoria pertence a este tipo. Nenhuma é excluída: o que sai da lista é
                    inativado, e os veículos que a usam continuam classificados.
                  </p>

                  {form.subcategories.length === 0 ? (
                    <EmptyState
                      title="Sem subcategorias"
                      description="Este tipo pode ser usado sem subcategoria. Adicione uma se a frota precisar dessa distinção."
                    />
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {form.subcategories.map((sub, index) => (
                        <li
                          key={sub.id ?? `nova-${index}`}
                          className="flex flex-col gap-2 rounded-md border border-border p-3"
                        >
                          <div className="flex items-start gap-2">
                            <Input
                              value={sub.name}
                              onChange={(event) => {
                                const next = [...form.subcategories];
                                next[index] = { ...sub, name: event.target.value };
                                set("subcategories", next);
                              }}
                              disabled={sub.scope === "global" || !can("equipment_types.manage_subcategories")}
                              placeholder="Furgão"
                              maxLength={80}
                            />
                            {sub.scope === "global" ? (
                              <Badge variant="neutral" className="mt-2 shrink-0">
                                Base
                              </Badge>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="mt-0.5 shrink-0"
                                aria-label={`Remover ${sub.name || "subcategoria"}`}
                                disabled={!can("equipment_types.manage_subcategories")}
                                onClick={() =>
                                  set(
                                    "subcategories",
                                    form.subcategories.filter((_, i) => i !== index),
                                  )
                                }
                              >
                                <Trash2 aria-hidden />
                              </Button>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <label className="flex items-center gap-2 text-caption text-fg-secondary">
                              <Checkbox
                                checked={sub.isActive}
                                onCheckedChange={(checked) => {
                                  const next = [...form.subcategories];
                                  next[index] = { ...sub, isActive: Boolean(checked) };
                                  set("subcategories", next);
                                }}
                                disabled={sub.scope === "global" || !can("equipment_types.manage_subcategories")}
                              />
                              Ativa
                            </label>
                            {sub.vehicleCount > 0 ? (
                              <span className="text-caption text-fg-muted">
                                {numberFormat.format(sub.vehicleCount)} veículo(s) vinculado(s)
                              </span>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  {can("equipment_types.manage_subcategories") ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      leadingIcon={<Plus />}
                      className="self-start"
                      onClick={() =>
                        set("subcategories", [
                          ...form.subcategories,
                          { id: null, name: "", description: "", isActive: true, vehicleCount: 0, scope: "organization" },
                        ])
                      }
                    >
                      Adicionar subcategoria
                    </Button>
                  ) : null}
                </TabsContent>

                {/* ---------------------------------------------- operações */}
                <TabsContent value="operacoes" className="flex flex-col gap-3">
                  <FormField
                    label="Restringir às operações selecionadas"
                    helperText="Desligado, qualquer operação aceita este tipo. Ligado, só as marcadas — e nenhuma marcada significa nenhuma operação."
                  >
                    <div className="flex items-center gap-3 pt-1.5">
                      <Switch
                        checked={form.operationRestrictionEnabled}
                        onCheckedChange={(checked) => set("operationRestrictionEnabled", checked)}
                        disabled={!can("equipment_types.manage_operations")}
                        aria-label="Restringir operações"
                      />
                      <span className="text-body-sm text-fg-secondary">
                        {form.operationRestrictionEnabled ? "Restrição ativa" : "Sem restrição configurada"}
                      </span>
                    </div>
                  </FormField>

                  {form.operationRestrictionEnabled && form.operations.length === 0 ? (
                    <Alert variant="warning">
                      <AlertTitle>Nenhuma operação habilitada</AlertTitle>
                      <AlertDescription>
                        Com a restrição ligada e nenhuma operação marcada, veículos deste tipo não
                        poderão ser alocados em lugar nenhum. As alocações que já existem continuam.
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  <ul className="flex flex-col gap-1.5">
                    {options.operations.map((operation) => {
                      const checked = form.operations.includes(operation.id);
                      const inactive = operation.status !== "active";
                      return (
                        <li key={operation.id}>
                          <label
                            className={cn(
                              "flex items-center gap-2.5 rounded-md border border-border p-2.5 text-body-sm",
                              !form.operationRestrictionEnabled && "opacity-60",
                            )}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(next) => toggleOperation(operation.id, Boolean(next))}
                              disabled={
                                !can("equipment_types.manage_operations") ||
                                !form.operationRestrictionEnabled ||
                                // Operação inativa já vinculada continua visível para
                                // consulta; o que não se faz é criar vínculo novo nela.
                                (inactive && !checked)
                              }
                            />
                            <span className="min-w-0 flex-1 truncate text-fg">{operation.label}</span>
                            {inactive ? (
                              <Badge variant="neutral" size="sm">
                                Inativa
                              </Badge>
                            ) : null}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </TabsContent>

                {/* -------------------------------------------- aplicativos */}
                {/* Refinamento da Etapa 12 (§15–§20): os aplicativos habilitados do
                    tipo são gravados na hora, na MESMA fonte que Operações e o
                    Gerenciador leem. Um tipo novo nasce sem aplicativo algum e
                    continua válido assim. */}
                <TabsContent value="aplicativos" className="flex flex-col gap-3">
                  {isEdit && typeId ? (
                    <ApplicationLinksPanel
                      mode="vehicle_type"
                      targetId={typeId}
                      canManage={can("applications.manage_equipment_links")}
                      canViewHistory={can("applications.manage_equipment_links") || can("audit.view")}
                      title="Aplicativos habilitados"
                      description="Quais aplicativos os veículos deste tipo podem utilizar. Cada alteração é gravada e auditada imediatamente; não depende do botão Salvar."
                    />
                  ) : (
                    <EmptyState
                      title="Salve o tipo para habilitar aplicativos"
                      description="Um tipo de equipamento nasce sem aplicativo vinculado. Depois de salvar, habilite aqui os aplicativos que os veículos deste tipo podem utilizar."
                    />
                  )}
                </TabsContent>

                {/* ------------------------------------------ elegibilidade */}
                <TabsContent value="elegibilidade" className="flex flex-col gap-4">
                  <p className="text-caption text-fg-muted">
                    Cada módulo faz três perguntas diferentes sobre um tipo, e responder uma não
                    responde as outras. Nada é marcado automaticamente.
                  </p>

                  {options.modules.map((module) => (
                    <div key={module.code} className="flex flex-col gap-2 rounded-md border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-body-sm font-semibold text-fg">{module.name}</span>
                        {!module.isAvailable ? (
                          <Badge variant="neutral" size="sm" title="O módulo ainda não foi implementado no HFM">
                            Não disponível nesta etapa
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-caption text-fg-muted">{module.description}</p>

                      <div className="flex flex-col gap-2 pt-1">
                        {CAPABILITIES.map((capability) => {
                          const key = ruleKey(module.code, capability.id);
                          return (
                            <label
                              key={capability.id}
                              className="flex items-start gap-2.5 text-body-sm"
                            >
                              <Switch
                                checked={Boolean(form.moduleRules[key])}
                                onCheckedChange={(checked) =>
                                  set("moduleRules", { ...form.moduleRules, [key]: checked })
                                }
                                disabled={!can("equipment_types.manage_eligibility")}
                                aria-label={`${module.name}: ${capability.label}`}
                              />
                              <span className="min-w-0">
                                <span className="block font-medium text-fg">{capability.label}</span>
                                <span className="block text-caption text-fg-muted">{capability.effect}</span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </TabsContent>

                {/* ----------------------------------------------- histórico */}
                {isEdit ? (
                  <TabsContent value="historico" className="flex flex-col gap-2">
                    {history.length === 0 ? (
                      <EmptyState
                        title="Sem histórico visível"
                        description="Nenhuma alteração registrada, ou seu perfil não possui permissão de auditoria."
                      />
                    ) : (
                      <ol className="flex flex-col gap-2">
                        {history.map((entry) => (
                          <li key={entry.id} className="rounded-md border border-border bg-surface p-3">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <span className="text-body-sm font-medium text-fg">
                                {ENTITY_LABELS[entry.entity] ?? entry.entity}{" "}
                                {ACTION_LABELS[entry.action] ?? entry.action.toLowerCase()}
                              </span>
                              <span className="text-caption tabular-nums text-fg-muted">
                                {entry.occurredAt ? dateTimeFormat.format(new Date(entry.occurredAt)) : "—"}
                              </span>
                            </div>
                            <p className="text-caption text-fg-secondary">
                              {entry.actorName ?? "Responsável não identificado"}
                            </p>
                            {entry.fields.length > 0 ? (
                              <p className="mt-1 flex flex-wrap gap-1">
                                {entry.fields.slice(0, 8).map((field) => (
                                  <Badge key={field} variant="neutral" size="sm">
                                    {field}
                                  </Badge>
                                ))}
                              </p>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    )}
                  </TabsContent>
                ) : null}
              </Tabs>
            </>
          )}
        </DrawerBody>

        <DrawerFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button
            leadingIcon={<Save />}
            onClick={() => void submit()}
            disabled={saving || loading || !can(isEdit ? "equipment_types.update" : "equipment_types.create")}
          >
            {saving ? "Salvando…" : isEdit ? "Salvar alterações" : "Cadastrar tipo"}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
