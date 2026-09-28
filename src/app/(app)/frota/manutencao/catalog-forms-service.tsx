"use client";

import * as React from "react";
import { Link2, Plus, Trash2 } from "lucide-react";
import { DrawerBody, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { SwitchField } from "@/components/ui/switch";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { useToast } from "@/components/feedback/toast";
import { NativeSelect } from "@/components/governance/selects";
import { loadChecklistQuestions, saveMaintenanceService, saveServiceChecklistLinks } from "@/lib/maintenance/actions";
import type { ChecklistQuestionOption, MaintenanceFilterOptions } from "@/lib/maintenance/queries";
import type { Criticality, MaintenanceCatalog, MaintenanceService } from "@/lib/maintenance/types";
import {
  CheckboxList, CriticalitySelect, FormDrawer, FormErrorAlert, FormFieldset, FormFooter, FormSection, ReadOnlyAlert,
  StatusSelect, numberText, parseDecimalField, safeCall, type CheckOption,
} from "./catalog-forms";

/**
 * Cadastro de serviço e o mapeamento Serviços × Check List.
 *
 * O mapeamento é a relação "pergunta do Check List (ou campo condicional) →
 * serviço": um apontamento inconforme naquela pergunta sugere este serviço ao
 * abrir a manutenção, e é a MESMA relação que o Plano de Ação vai usar. A
 * gravação substitui o conjunto de vínculos do serviço de uma vez.
 */

interface LinkDraft {
  appId: string;
  questionKey: string;
  fieldKey: string | null;
  autoResolve: boolean;
}

const linkKey = (l: Pick<LinkDraft, "appId" | "questionKey" | "fieldKey">) => `${l.appId}|${l.questionKey}|${l.fieldKey ?? ""}`;
const serializeLinks = (links: LinkDraft[]) =>
  JSON.stringify(links.map((l) => `${linkKey(l)}|${l.autoResolve ? 1 : 0}`).sort());

export function ServiceFormDrawer({
  open,
  service,
  catalog,
  options,
  readOnly,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  service: MaintenanceService | null;
  catalog: MaintenanceCatalog;
  options: MaintenanceFilterOptions;
  readOnly: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <FormDrawer open={open} onOpenChange={onOpenChange} size="xl" testId="maintenance-service-form">
      <ServiceForm
        key={service?.id ?? "novo"}
        service={service}
        catalog={catalog}
        options={options}
        readOnly={readOnly}
        onClose={() => onOpenChange(false)}
        onSaved={onSaved}
      />
    </FormDrawer>
  );
}

function ServiceForm({
  service,
  catalog,
  options,
  readOnly,
  onClose,
  onSaved,
}: {
  service: MaintenanceService | null;
  catalog: MaintenanceCatalog;
  options: MaintenanceFilterOptions;
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [tab, setTab] = React.useState<"dados" | "checklist">("dados");
  const [clusterId, setClusterId] = React.useState(service?.clusterId ?? "");
  const [name, setName] = React.useState(service?.name ?? "");
  const [description, setDescription] = React.useState(service?.description ?? "");
  const [typeCodes, setTypeCodes] = React.useState<string[]>(service?.maintenanceTypeCodes ?? []);
  const [vehicleTypeIds, setVehicleTypeIds] = React.useState<string[]>(service?.vehicleTypeIds ?? []);
  const [expectedHours, setExpectedHours] = React.useState(numberText(service?.expectedHours));
  const [criticality, setCriticality] = React.useState<Criticality>(service?.criticality ?? "medium");
  const [criticalityTouched, setCriticalityTouched] = React.useState(Boolean(service));
  const [isPredictive, setIsPredictive] = React.useState(service?.isPredictive ?? false);
  const [status, setStatus] = React.useState<"active" | "inactive">(service?.status ?? "active");
  const initialLinks = React.useMemo<LinkDraft[]>(
    () =>
      (service?.checklistLinks ?? []).map((l) => ({
        appId: l.appId,
        questionKey: l.questionKey,
        fieldKey: l.fieldKey ?? null,
        autoResolve: l.autoResolve,
      })),
    [service],
  );
  const [links, setLinks] = React.useState<LinkDraft[]>(initialLinks);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const clusters = catalog.clusters.filter((c) => c.status === "active" || c.id === service?.clusterId);
  const hours = parseDecimalField(expectedHours);
  const hoursInvalid = expectedHours.trim() !== "" && (hours == null || hours <= 0 || hours > 2000);
  const canSubmit = Boolean(clusterId) && name.trim().length >= 2 && !hoursInvalid;
  const linksDirty = serializeLinks(links) !== serializeLinks(initialLinks);

  const typeOptions: CheckOption[] = catalog.types.map((t) => ({ id: t.code, label: t.name }));
  const vehicleTypeOptions: CheckOption[] = options.vehicleTypes.map((t) => ({ id: t.id, label: t.name }));

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly || saving) return;
    if (!canSubmit) {
      setTab("dados");
      return;
    }
    setSaving(true);
    setError(null);
    const result = await safeCall(
      () =>
        saveMaintenanceService({
          id: service?.id,
          cluster_id: clusterId,
          name: name.trim(),
          description: description.trim() || null,
          maintenance_type_codes: typeCodes,
          vehicle_type_ids: vehicleTypeIds,
          expected_hours: hours,
          criticality,
          is_predictive: isPredictive,
          status,
        }),
      "Não foi possível salvar o serviço.",
    );
    if (!result.ok) {
      setSaving(false);
      const message = result.error ?? "Não foi possível salvar o serviço.";
      setError(message);
      toast({ title: message, variant: "danger" });
      return;
    }

    const serviceId = service?.id ?? result.data ?? null;
    if (linksDirty && serviceId) {
      const saved = await safeCall(
        () => saveServiceChecklistLinks(serviceId, links),
        "Não foi possível salvar o mapeamento com o Check List.",
      );
      setSaving(false);
      if (!saved.ok) {
        // O serviço já existe: fechar evita recriá-lo na próxima tentativa.
        toast({
          title: `O serviço foi salvo, mas o mapeamento com o Check List não: ${saved.error ?? "erro desconhecido"}`,
          description: "Abra o serviço e grave o mapeamento de novo.",
          variant: "danger",
        });
        onSaved();
        onClose();
        return;
      }
    } else {
      setSaving(false);
    }
    toast({
      title: service ? "Serviço atualizado." : "Serviço criado.",
      description: linksDirty ? `${links.length} vínculo(s) com o Check List gravado(s).` : undefined,
      variant: "success",
    });
    onSaved();
    onClose();
  };

  return (
    <>
      <DrawerHeader>
        <DrawerTitle>{service ? (readOnly ? "Serviço" : "Editar serviço") : "Novo serviço"}</DrawerTitle>
        <DrawerDescription>
          Serviço do catálogo: é o que se lança numa manutenção. Todo serviço pertence a um cluster técnico.
        </DrawerDescription>
      </DrawerHeader>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" aria-busy={saving}>
        <DrawerBody className="flex flex-col gap-4">
          {readOnly ? <ReadOnlyAlert what="serviços" /> : null}
          <FormErrorAlert error={error} />
          <Tabs value={tab} onValueChange={(v) => setTab(v as "dados" | "checklist")}>
            <TabsList aria-label="Partes do cadastro do serviço">
              <TabsTrigger value="dados">Dados do serviço</TabsTrigger>
              <TabsTrigger value="checklist" count={links.length} data-testid="maintenance-service-checklist-tab">
                Check List
              </TabsTrigger>
            </TabsList>

            <TabsContent value="dados" forceMount hidden={tab !== "dados"}>
              <FormFieldset readOnly={readOnly}>
                <FormGrid columns={2}>
                  <FormField label="Cluster técnico" required>
                    <NativeSelect
                      value={clusterId}
                      onChange={(e) => {
                        const next = e.target.value;
                        setClusterId(next);
                        // Serviço novo herda a criticidade padrão do cluster, até alguém escolher outra.
                        const cluster = catalog.clusters.find((c) => c.id === next);
                        if (cluster && !criticalityTouched) setCriticality(cluster.defaultCriticality);
                      }}
                      required
                    >
                      <option value="">Selecione</option>
                      {clusters.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {c.status === "inactive" ? " (inativo)" : ""}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormField>
                  <FormField label="Nome do serviço" required>
                    <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Troca de pastilhas" required />
                  </FormField>
                  <FormField label="Criticidade">
                    <CriticalitySelect
                      value={criticality}
                      onChange={(c) => {
                        setCriticality(c);
                        setCriticalityTouched(true);
                      }}
                    />
                  </FormField>
                  <FormField
                    label="Horas previstas"
                    helperText="Tempo esperado de execução; a soma dos serviços define o SLA da manutenção."
                    error={hoursInvalid ? "Informe um valor entre 0 e 2.000 horas." : undefined}
                  >
                    <Input
                      inputMode="decimal"
                      value={expectedHours}
                      onChange={(e) => setExpectedHours(e.target.value)}
                      trailingAddon="h"
                      placeholder="4"
                    />
                  </FormField>
                  <FormField label="Situação" helperText="Serviço inativo não é oferecido em manutenções novas.">
                    <StatusSelect value={status} onChange={setStatus} />
                  </FormField>
                  <div className="flex items-end">
                    <SwitchField
                      className="w-full"
                      label="Participa da preditiva"
                      description="Pode ser inspeção ou cobertura em planos técnicos preditivos."
                      checked={isPredictive}
                      onCheckedChange={setIsPredictive}
                    />
                  </div>
                  <FormField label="Descrição" className="sm:col-span-2">
                    <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={1000} />
                  </FormField>
                </FormGrid>

                <FormSection title="Aplicabilidade" description="Onde o serviço aparece para escolha. Nada marcado = todos.">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <CheckboxList
                      label="Tipos de manutenção"
                      options={typeOptions}
                      value={typeCodes}
                      onChange={setTypeCodes}
                      helper="Nenhum marcado = todos os tipos."
                      testId="maintenance-service-types"
                    />
                    <CheckboxList
                      label="Tipos de equipamento"
                      options={vehicleTypeOptions}
                      value={vehicleTypeIds}
                      onChange={setVehicleTypeIds}
                      helper="Nenhum marcado = todos os equipamentos."
                      emptyText="Nenhum tipo de equipamento ativo."
                    />
                  </div>
                </FormSection>
              </FormFieldset>
            </TabsContent>

            <TabsContent value="checklist" forceMount hidden={tab !== "checklist"}>
              {!readOnly && !canSubmit ? (
                <p className="mb-3 text-caption text-fg-secondary" role="status">
                  Para salvar, preencha cluster e nome na aba &ldquo;Dados do serviço&rdquo;.
                </p>
              ) : null}
              <ChecklistMapping
                links={links}
                onChange={setLinks}
                readOnly={readOnly}
                appNames={options.apps}
                dirty={linksDirty}
              />
            </TabsContent>
          </Tabs>
        </DrawerBody>
        <FormFooter readOnly={readOnly} saving={saving} disabled={!canSubmit} onClose={onClose} />
      </form>
    </>
  );
}

// ---------------------------------------------------------------------------
// Mapeamento Serviços × Check List
// ---------------------------------------------------------------------------
function ChecklistMapping({
  links,
  onChange,
  readOnly,
  appNames,
  dirty,
}: {
  links: LinkDraft[];
  onChange: (next: LinkDraft[]) => void;
  readOnly: boolean;
  appNames: { id: string; name: string }[];
  dirty: boolean;
}) {
  // Só quem gere serviços lê as perguntas; em modo leitura mostramos as chaves.
  const [questions, setQuestions] = React.useState<ChecklistQuestionOption[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    if (readOnly) return;
    let active = true;
    loadChecklistQuestions()
      .then((result) => {
        if (!active) return;
        if (result.ok && result.data) {
          setQuestions(result.data);
          setLoadError(null);
        } else {
          setLoadError(result.error ?? "Não foi possível carregar as perguntas do Check List.");
        }
      })
      .catch(() => {
        if (active) setLoadError("Não foi possível carregar as perguntas do Check List.");
      });
    return () => {
      active = false;
    };
  }, [readOnly, attempt]);

  const byKey = React.useMemo(() => {
    const map = new Map<string, ChecklistQuestionOption>();
    for (const q of questions ?? []) map.set(`${q.appId}|${q.questionKey}`, q);
    return map;
  }, [questions]);
  const appName = (appId: string) =>
    (questions ?? []).find((q) => q.appId === appId)?.appName ?? appNames.find((a) => a.id === appId)?.name ?? "Aplicativo";

  const remove = (key: string) => onChange(links.filter((l) => linkKey(l) !== key));
  const toggleAuto = (key: string, value: boolean) =>
    onChange(links.map((l) => (linkKey(l) === key ? { ...l, autoResolve: value } : l)));

  return (
    <div className="flex flex-col gap-4" data-testid="maintenance-service-checklist">
      <Alert variant="info" icon={<Link2 />}>
        <AlertDescription>
          Quando um apontamento do Check List for <strong>inconforme</strong> numa pergunta vinculada (ou no campo
          condicional escolhido), este serviço é sugerido ao abrir a manutenção do veículo. Esta é a mesma relação que
          o <strong>Plano de Ação</strong> usará: apontamento inconforme → serviço sugerido. Com &ldquo;resolver
          automaticamente&rdquo;, concluir este serviço dá baixa no apontamento vinculado à manutenção.
        </AlertDescription>
      </Alert>

      <TableContainer tabIndex={0}>
        <Table layout="fixed" style={{ minWidth: 640 }}>
          <TableHeader>
            <TableRow>
              <TableHead style={{ width: 150 }}>Aplicativo</TableHead>
              <TableHead>Pergunta</TableHead>
              <TableHead style={{ width: 160 }}>Campo condicional</TableHead>
              <TableHead style={{ width: 120 }} align="center">Resolver ao concluir</TableHead>
              {!readOnly ? <TableHead style={{ width: 56 }}><span className="sr-only">Ações</span></TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {links.length === 0 ? (
              <TableEmpty
                colSpan={readOnly ? 4 : 5}
                message="Nenhuma pergunta vinculada. Sem vínculo, o serviço não é sugerido a partir do Check List."
              />
            ) : (
              links.map((l) => {
                const key = linkKey(l);
                const q = byKey.get(`${l.appId}|${l.questionKey}`);
                const field = l.fieldKey ? q?.fields.find((f) => f.fieldKey === l.fieldKey) : null;
                return (
                  <TableRow key={key}>
                    <TableCell truncate title={appName(l.appId)}>{appName(l.appId)}</TableCell>
                    <TableCell>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate" title={q?.questionText ?? l.questionKey}>
                          {q?.questionText ?? l.questionKey}
                        </span>
                        <span className="truncate font-mono text-caption text-fg-muted">{l.questionKey}</span>
                      </div>
                    </TableCell>
                    <TableCell truncate title={field?.label ?? l.fieldKey ?? undefined}>
                      {l.fieldKey ? field?.label ?? <span className="font-mono text-caption">{l.fieldKey}</span> : (
                        <span className="text-fg-muted">Qualquer inconformidade</span>
                      )}
                    </TableCell>
                    <TableCell align="center">
                      {readOnly ? (
                        l.autoResolve ? "Sim" : "Não"
                      ) : (
                        <Checkbox
                          checked={l.autoResolve}
                          onCheckedChange={(c) => toggleAuto(key, c === true)}
                          aria-label={`Resolver automaticamente ao concluir: ${q?.questionText ?? l.questionKey}`}
                        />
                      )}
                    </TableCell>
                    {!readOnly ? (
                      <TableCell align="right">
                        <IconButton
                          label={`Remover vínculo com ${q?.questionText ?? l.questionKey}`}
                          variant="danger"
                          size="sm"
                          onClick={() => remove(key)}
                        >
                          <Trash2 aria-hidden />
                        </IconButton>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {!readOnly ? (
        questions ? (
          <AddLinkForm
            questions={questions}
            existing={new Set(links.map(linkKey))}
            onAdd={(link) => onChange([...links, link])}
          />
        ) : loadError ? (
          <ErrorState
            variant="inline"
            title="Não foi possível carregar as perguntas do Check List."
            description={loadError}
            onRetry={() => {
              setLoadError(null);
              setAttempt((n) => n + 1);
            }}
            retryLabel="Tentar de novo"
          />
        ) : (
          <LoadingState label="Carregando perguntas do Check List…" />
        )
      ) : null}

      {dirty && !readOnly ? (
        <p className="text-caption text-fg-secondary" aria-live="polite">
          Vínculos alterados. Salve o serviço para gravar o mapeamento (a gravação substitui o conjunto).
        </p>
      ) : null}
    </div>
  );
}

function AddLinkForm({
  questions,
  existing,
  onAdd,
}: {
  questions: ChecklistQuestionOption[];
  existing: Set<string>;
  onAdd: (link: LinkDraft) => void;
}) {
  const apps = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const q of questions) if (!seen.has(q.appId)) seen.set(q.appId, q.appName);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [questions]);
  const [appId, setAppId] = React.useState(apps.length === 1 ? apps[0].id : "");
  const [questionKey, setQuestionKey] = React.useState("");
  const [fieldKey, setFieldKey] = React.useState("");
  const [autoResolve, setAutoResolve] = React.useState(true);
  const autoId = React.useId();

  const appQuestions = questions.filter((q) => q.appId === appId);
  // As perguntas chegam ordenadas por aplicativo e cluster: agrupar é só cortar.
  const groups: { cluster: string; items: ChecklistQuestionOption[] }[] = [];
  for (const q of appQuestions) {
    const name = q.clusterName ?? "Sem cluster";
    const last = groups[groups.length - 1];
    if (last && last.cluster === name) last.items.push(q);
    else groups.push({ cluster: name, items: [q] });
  }
  const question = appQuestions.find((q) => q.questionKey === questionKey);
  const draft: LinkDraft | null = appId && questionKey ? { appId, questionKey, fieldKey: fieldKey || null, autoResolve } : null;
  const duplicate = draft ? existing.has(linkKey(draft)) : false;

  if (questions.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-caption text-fg-muted">
        Nenhuma pergunta publicada no Check List desta organização.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-surface-secondary p-3" data-testid="maintenance-service-add-link">
      <p className="text-label font-semibold text-fg">Adicionar vínculo</p>
      <FormGrid columns={3}>
        <FormField label="Aplicativo">
          <NativeSelect
            fieldSize="sm"
            value={appId}
            onChange={(e) => {
              setAppId(e.target.value);
              setQuestionKey("");
              setFieldKey("");
            }}
          >
            <option value="">Selecione</option>
            {apps.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Pergunta" className="lg:col-span-2" helperText={question?.versionLabel ? `Texto da versão ${question.versionLabel}.` : undefined}>
          <NativeSelect
            fieldSize="sm"
            value={questionKey}
            disabled={!appId}
            onChange={(e) => {
              setQuestionKey(e.target.value);
              setFieldKey("");
            }}
          >
            <option value="">{appId ? "Selecione" : "Escolha o aplicativo"}</option>
            {groups.map((g, gi) => (
              <optgroup key={`${g.cluster}-${gi}`} label={g.cluster}>
                {g.items.map((q) => (
                  <option key={q.questionKey} value={q.questionKey}>
                    {q.questionText}
                  </option>
                ))}
              </optgroup>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Campo condicional" helperText="Opcional: restringe o vínculo a um campo da pergunta.">
          <NativeSelect
            fieldSize="sm"
            value={fieldKey}
            disabled={!question || question.fields.length === 0}
            onChange={(e) => setFieldKey(e.target.value)}
          >
            <option value="">{question && question.fields.length === 0 ? "A pergunta não tem campos" : "Qualquer inconformidade"}</option>
            {(question?.fields ?? []).map((f) => (
              <option key={f.fieldKey} value={f.fieldKey}>
                {f.label}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <div className="flex items-center gap-2 self-end pb-2 lg:col-span-2">
          <Checkbox id={autoId} checked={autoResolve} onCheckedChange={(c) => setAutoResolve(c === true)} />
          <label htmlFor={autoId} className="cursor-pointer text-body-sm text-fg">
            Resolver automaticamente ao concluir o serviço
          </label>
        </div>
      </FormGrid>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-fg-muted" aria-live="polite">
          {duplicate ? "Este vínculo já está na lista." : "O vínculo entra na lista; grave salvando o serviço."}
        </p>
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Plus />}
          disabled={!draft || duplicate}
          onClick={() => {
            if (!draft || duplicate) return;
            onAdd(draft);
            setQuestionKey("");
            setFieldKey("");
          }}
        >
          Adicionar vínculo
        </Button>
      </div>
    </div>
  );
}
