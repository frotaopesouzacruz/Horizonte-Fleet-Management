"use client";

import * as React from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import {
  Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer";
import { Button, IconButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { SwitchField } from "@/components/ui/switch";
import { CheckboxField } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { NativeSelect } from "@/components/governance/selects";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import { useConfirm } from "@/components/feedback/confirm-dialog";
import type {
  AdminCluster,
  AdminConditional,
  AdminOperation,
  AdminQuestion,
  AdminVehicleType,
  ChecklistAdminActions,
  ConditionalFieldType,
  QuestionStatus,
  RuleKind,
  RuleMode,
} from "@/lib/applications/admin-queries";
import type { Answer, Criticality } from "@/lib/applications/queries";
import {
  ANSWER_LABEL, FIELD_TYPE_LABEL, KEY_PATTERN, RULE_KIND_LABEL, RULE_MODE_LABEL, parseOptions,
} from "./labels";

export interface QuestionDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versionId: string;
  clusters: AdminCluster[];
  /** A pergunta em edição, já resolvida pela árvore atual; `null` cria uma nova. */
  question: AdminQuestion | null;
  defaultClusterId: string | null;
  vehicleTypes: AdminVehicleType[];
  operations: AdminOperation[];
  /** `configure` E versão em rascunho. */
  canEdit: boolean;
  /** `manage_rules` E versão em rascunho. */
  canManageRules: boolean;
  /** Se a pessoa pode ao menos VER as regras (permissão de regras, em qualquer situação). */
  showRules: boolean;
  actions: ChecklistAdminActions;
  /** Recarrega a árvore; a gaveta recebe a pergunta atualizada por props. */
  onChanged: () => Promise<void>;
  /** Uma pergunta nova foi criada: o pai passa a apontar a gaveta para ela. */
  onCreated: (questionId: string) => void;
}

/**
 * Criar e editar uma pergunta — com o campo condicional e as regras de
 * aplicabilidade na mesma gaveta, porque é assim que a administração pensa
 * numa pergunta: o que ela pergunta, o que pede a mais quando a resposta é
 * ruim, e para quem ela vale.
 */
export function QuestionDrawer(props: QuestionDrawerProps) {
  const { open, onOpenChange, question } = props;
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent size="xl">
        {open ? <QuestionBody key={question?.id ?? "new"} {...props} /> : null}
      </DrawerContent>
    </Drawer>
  );
}

interface QuestionFormState {
  clusterId: string;
  questionText: string;
  conformingAnswer: Answer;
  criticality: Criticality;
  isRequired: boolean;
  generatesActionPlan: boolean;
  allowsNote: boolean;
  noteRequired: boolean;
  status: QuestionStatus;
  newIdentity: boolean;
  questionKey: string;
}

function initialForm(question: AdminQuestion | null, defaultClusterId: string | null, clusters: AdminCluster[]): QuestionFormState {
  const clusterId = question
    ? clusters.find((c) => c.questions.some((q) => q.id === question.id))?.id ?? clusters[0]?.id ?? ""
    : defaultClusterId ?? clusters[0]?.id ?? "";
  return {
    clusterId,
    questionText: question?.questionText ?? "",
    conformingAnswer: question?.conformingAnswer ?? "yes",
    criticality: question?.criticality ?? "media",
    isRequired: question?.isRequired ?? true,
    generatesActionPlan: question?.generatesActionPlan ?? true,
    allowsNote: question?.allowsNote ?? true,
    noteRequired: question?.noteRequired ?? false,
    status: question?.status ?? "active",
    newIdentity: false,
    questionKey: "",
  };
}

function QuestionBody({
  versionId,
  clusters,
  question,
  defaultClusterId,
  vehicleTypes,
  operations,
  canEdit,
  canManageRules,
  showRules,
  actions,
  onChanged,
  onCreated,
  onOpenChange,
}: QuestionDrawerProps) {
  const { toast } = useToast();
  const [form, setForm] = React.useState<QuestionFormState>(() => initialForm(question, defaultClusterId, clusters));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const set = <K extends keyof QuestionFormState>(key: K, value: QuestionFormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const isEdit = Boolean(question);
  const keyInvalid = form.questionKey.trim() !== "" && !KEY_PATTERN.test(form.questionKey.trim());

  const submit = async () => {
    if (saving) return;
    setError(null);
    if (form.questionText.trim().length < 3) {
      setError("O texto da pergunta deve ter entre 3 e 500 caracteres.");
      return;
    }
    if (!form.clusterId) {
      setError("Escolha o cluster da pergunta.");
      return;
    }
    if (form.newIdentity && !form.questionKey.trim()) {
      setError("Informe a nova identidade técnica da pergunta.");
      return;
    }
    if (keyInvalid) {
      setError('A identidade técnica aceita apenas letras minúsculas, números, "_" e "." (ex.: luzes.farois).');
      return;
    }
    setSaving(true);
    const result = await actions.saveQuestion({
      id: question?.id,
      versionId,
      clusterId: form.clusterId,
      questionText: form.questionText.trim(),
      conformingAnswer: form.conformingAnswer,
      criticality: form.criticality,
      isRequired: form.isRequired,
      generatesActionPlan: form.generatesActionPlan,
      allowsNote: form.allowsNote,
      noteRequired: form.noteRequired,
      status: form.status,
      // §47: a chave só viaja quando a administração declarou nova identidade
      // (ou na criação, como sugestão). Editar o texto nunca a altera.
      newIdentity: isEdit ? form.newIdentity : false,
      questionKey: (isEdit ? form.newIdentity : true) ? form.questionKey.trim() || null : null,
    });
    setSaving(false);
    if (!result.ok || !result.data) {
      setError(result.error ?? "Não foi possível salvar a pergunta.");
      return;
    }
    toast({ title: isEdit ? "Pergunta salva." : "Pergunta criada.", variant: "success" });
    await onChanged();
    if (!isEdit) onCreated(result.data.id);
    else set("newIdentity", false);
  };

  return (
    <>
      <DrawerHeader>
        <DrawerTitle>{isEdit ? "Editar pergunta" : "Nova pergunta"}</DrawerTitle>
        <DrawerDescription>
          {isEdit
            ? "O texto pode mudar sem quebrar a série histórica: a identidade técnica só muda quando declarado."
            : "Salve a pergunta para depois configurar o campo condicional e a aplicabilidade."}
        </DrawerDescription>
      </DrawerHeader>

      <DrawerBody className="flex flex-col gap-5">
        {!canEdit ? (
          <Alert variant="info">
            <AlertDescription>
              Esta versão não está em rascunho ou você não possui permissão para editar: os campos estão em modo de consulta.
            </AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="danger">
            <AlertTitle>Não foi possível salvar</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {/* ------------------------------------------------------ pergunta */}
        <section className="flex flex-col gap-4" aria-labelledby="secao-pergunta">
          <h3 id="secao-pergunta" className="text-h4 font-semibold text-fg">Pergunta</h3>

          <FormField label="Cluster" required id="pergunta-cluster">
            <NativeSelect value={form.clusterId} onChange={(e) => set("clusterId", e.target.value)} disabled={!canEdit}>
              {clusters.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </NativeSelect>
          </FormField>

          <FormField label="Texto da pergunta" required id="pergunta-texto" helperText="Como o motorista vai ler, em pé ao lado do veículo. Entre 3 e 500 caracteres.">
            <Textarea
              rows={3}
              value={form.questionText}
              onChange={(e) => set("questionText", e.target.value)}
              maxLength={500}
              disabled={!canEdit}
            />
          </FormField>

          <FormGrid columns={2}>
            <FormField label="Resposta conforme" required id="pergunta-conforme" helperText="Qual resposta significa que está tudo certo. Perguntas como “Possui avaria?” são conformes com NÃO.">
              <NativeSelect value={form.conformingAnswer} onChange={(e) => set("conformingAnswer", e.target.value === "no" ? "no" : "yes")} disabled={!canEdit}>
                <option value="yes">SIM é conforme</option>
                <option value="no">NÃO é conforme</option>
              </NativeSelect>
            </FormField>
            <FormField label="Criticidade" required id="pergunta-criticidade" helperText="Item crítico inconforme é destacado no envio e nos indicadores.">
              <NativeSelect value={form.criticality} onChange={(e) => set("criticality", e.target.value === "critica" ? "critica" : "media")} disabled={!canEdit}>
                <option value="media">Média</option>
                <option value="critica">Crítica</option>
              </NativeSelect>
            </FormField>
          </FormGrid>

          <div className="flex flex-col gap-2 rounded-md border border-border p-3">
            <SwitchField label="Resposta obrigatória" description="O checklist não é enviado sem responder esta pergunta." checked={form.isRequired} onCheckedChange={(v) => set("isRequired", v)} disabled={!canEdit} />
            <SwitchField label="Permite observação" description="O motorista pode escrever um comentário livre." checked={form.allowsNote} onCheckedChange={(v) => { set("allowsNote", v); if (!v) set("noteRequired", false); }} disabled={!canEdit} />
            <SwitchField label="Observação obrigatória na inconformidade" description="Exige o comentário quando a resposta não for a conforme. Depende de permitir observação." checked={form.noteRequired} onCheckedChange={(v) => set("noteRequired", v)} disabled={!canEdit || !form.allowsNote} />
            <SwitchField label="Gera plano de ação" description="Inconformidade abre item para tratamento (§61)." checked={form.generatesActionPlan} onCheckedChange={(v) => set("generatesActionPlan", v)} disabled={!canEdit} />
          </div>

          <FormField label="Situação" id="pergunta-situacao" helperText="Inativa: continua na versão, com histórico, mas não é apresentada ao motorista.">
            <NativeSelect value={form.status} onChange={(e) => set("status", e.target.value === "inactive" ? "inactive" : "active")} disabled={!canEdit}>
              <option value="active">Ativa</option>
              <option value="inactive">Inativa</option>
            </NativeSelect>
          </FormField>
        </section>

        <Separator />

        {/* ----------------------------------------------------- identidade */}
        <section className="flex flex-col gap-3" aria-labelledby="secao-identidade">
          <h3 id="secao-identidade" className="text-h4 font-semibold text-fg">Identidade técnica</h3>
          {isEdit && question ? (
            <>
              <FormField label="Identidade atual" id="pergunta-chave-atual" helperText="É o que liga esta pergunta às execuções anteriores e às próximas versões. Editar o texto acima não a altera.">
                <Input value={question.questionKey} readOnly disabled className="font-mono" />
              </FormField>
              <CheckboxField
                label="Nova identidade (mudança substancial de significado)"
                description="Marque somente quando a pergunta passou a perguntar OUTRA coisa. A série histórica da identidade atual é preservada, e a nova passa a ser medida a partir desta versão (§47)."
                checked={form.newIdentity}
                onCheckedChange={(v) => { set("newIdentity", v === true); if (v !== true) set("questionKey", ""); }}
                disabled={!canEdit}
              />
              {form.newIdentity ? (
                <FormField label="Nova identidade técnica" required id="pergunta-chave-nova" helperText='Letras minúsculas, números, "_" e "." (ex.: luzes.farois).' error={keyInvalid ? "Formato inválido." : undefined}>
                  <Input value={form.questionKey} onChange={(e) => set("questionKey", e.target.value)} className="font-mono" placeholder={question.questionKey} disabled={!canEdit} />
                </FormField>
              ) : null}
            </>
          ) : (
            <FormField label="Identidade técnica" id="pergunta-chave" helperText='Opcional: deixe em branco para derivar do cluster e do texto. Letras minúsculas, números, "_" e "." (ex.: luzes.farois).' error={keyInvalid ? "Formato inválido." : undefined}>
              <Input value={form.questionKey} onChange={(e) => set("questionKey", e.target.value)} className="font-mono" placeholder="cluster.pergunta" disabled={!canEdit} />
            </FormField>
          )}
        </section>

        <Separator />

        {/* ---------------------------------------------------- condicional */}
        <section className="flex flex-col gap-3" aria-labelledby="secao-condicional">
          <h3 id="secao-condicional" className="text-h4 font-semibold text-fg">Campo condicional</h3>
          <p className="text-caption text-fg-muted">
            Um campo a mais, apresentado quando a resposta acionadora é dada. O executor apresenta
            um por pergunta. Tipos: texto livre, escolha única e múltipla escolha.
          </p>
          {question ? (
            <ConditionalSection
              key={question.conditionals[0]?.id ?? "new"}
              question={question}
              conditional={question.conditionals[0] ?? null}
              canEdit={canEdit}
              actions={actions}
              onChanged={onChanged}
            />
          ) : (
            <Alert variant="info">
              <AlertDescription>Salve a pergunta para configurar o campo condicional.</AlertDescription>
            </Alert>
          )}
        </section>

        {showRules ? (
          <>
            <Separator />
            {/* ------------------------------------------------- aplicabilidade */}
            <section className="flex flex-col gap-3" aria-labelledby="secao-aplicabilidade">
              <h3 id="secao-aplicabilidade" className="text-h4 font-semibold text-fg">Aplicabilidade</h3>
              <p className="text-caption text-fg-muted">
                Sem regra de inclusão num eixo, a pergunta vale para todos naquele eixo. Inclusão
                restringe aos listados; exclusão retira; orientação não restringe — mostra um texto
                ao motorista naquela operação, tipo ou subcategoria.
              </p>
              {question ? (
                <RulesSection
                  question={question}
                  vehicleTypes={vehicleTypes}
                  operations={operations}
                  canManage={canManageRules}
                  actions={actions}
                  onChanged={onChanged}
                />
              ) : (
                <Alert variant="info">
                  <AlertDescription>Salve a pergunta para definir a aplicabilidade.</AlertDescription>
                </Alert>
              )}
            </section>
          </>
        ) : null}
      </DrawerBody>

      <DrawerFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
          Concluir
        </Button>
        <Button leadingIcon={<Save />} onClick={() => void submit()} loading={saving} disabled={!canEdit}>
          {isEdit ? "Salvar pergunta" : "Criar pergunta"}
        </Button>
      </DrawerFooter>
    </>
  );
}

// ---------------------------------------------------------------------------
// Campo condicional
// ---------------------------------------------------------------------------
function ConditionalSection({
  question,
  conditional,
  canEdit,
  actions,
  onChanged,
}: {
  question: AdminQuestion;
  conditional: AdminConditional | null;
  canEdit: boolean;
  actions: ChecklistAdminActions;
  onChanged: () => Promise<void>;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [trigger, setTrigger] = React.useState<Answer>(conditional?.triggerAnswer ?? (question.conformingAnswer === "yes" ? "no" : "yes"));
  const [label, setLabel] = React.useState(conditional?.label ?? "");
  const [fieldType, setFieldType] = React.useState<ConditionalFieldType>(conditional?.fieldType ?? "text");
  const [isRequired, setIsRequired] = React.useState(conditional?.isRequired ?? true);
  const [options, setOptions] = React.useState(conditional ? conditional.options.map((o) => o.label).join(", ") : "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const result = await actions.saveConditional({
      id: conditional?.id,
      questionId: question.id,
      triggerAnswer: trigger,
      label: label.trim(),
      fieldType,
      isRequired,
      options: fieldType === "text" ? [] : parseOptions(options),
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Não foi possível salvar o campo condicional.");
      return;
    }
    toast({ title: "Campo condicional salvo.", variant: "success" });
    await onChanged();
  };

  const remove = async () => {
    if (!conditional) return;
    const ok = await confirm({
      title: "Remover o campo condicional?",
      description: `O campo “${conditional.label}” deixa de ser apresentado nesta versão. As execuções anteriores mantêm o que foi respondido.`,
      confirmLabel: "Remover",
      destructive: true,
    });
    if (!ok) return;
    setSaving(true);
    const result = await actions.deleteConditional(conditional.id);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Não foi possível remover o campo condicional.");
      return;
    }
    toast({ title: "Campo condicional removido.", variant: "success" });
    await onChanged();
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      {conditional ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="info">Campo {conditional.fieldKey}</Badge>
          <span className="text-caption text-fg-muted">Acionado por {ANSWER_LABEL[conditional.triggerAnswer]}</span>
        </div>
      ) : null}

      {error ? (
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <FormGrid columns={2}>
        <FormField label="Resposta que aciona" id="cond-gatilho" helperText="Normalmente a resposta inconforme.">
          <NativeSelect value={trigger} onChange={(e) => setTrigger(e.target.value === "yes" ? "yes" : "no")} disabled={!canEdit}>
            <option value="yes">SIM</option>
            <option value="no">NÃO</option>
          </NativeSelect>
        </FormField>
        <FormField label="Tipo de campo" id="cond-tipo">
          <NativeSelect value={fieldType} onChange={(e) => setFieldType(e.target.value as ConditionalFieldType)} disabled={!canEdit}>
            {(Object.keys(FIELD_TYPE_LABEL) as ConditionalFieldType[]).map((t) => (
              <option key={t} value={t}>{FIELD_TYPE_LABEL[t]}</option>
            ))}
          </NativeSelect>
        </FormField>
      </FormGrid>

      <FormField label="Rótulo do campo" required id="cond-rotulo" helperText="A pergunta complementar, como o motorista vai ler.">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} placeholder="Onde está a inconformidade?" disabled={!canEdit} />
      </FormField>

      {fieldType !== "text" ? (
        <FormField label="Opções" required id="cond-opcoes" helperText="Separe por vírgula ou por linha. Pelo menos duas.">
          <Textarea rows={2} value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Baú lateral, Baú traseiro" disabled={!canEdit} />
        </FormField>
      ) : null}

      <SwitchField label="Preenchimento obrigatório" description="Quando acionado, o checklist não avança sem este campo." checked={isRequired} onCheckedChange={setIsRequired} disabled={!canEdit} />

      {canEdit ? (
        <div className="flex flex-wrap justify-end gap-2">
          {conditional ? (
            <Button variant="outline" size="sm" leadingIcon={<Trash2 />} onClick={() => void remove()} disabled={saving}>
              Remover campo
            </Button>
          ) : null}
          <Button size="sm" leadingIcon={<Save />} onClick={() => void save()} loading={saving}>
            {conditional ? "Salvar campo" : "Adicionar campo"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Regras de aplicabilidade (§24)
// ---------------------------------------------------------------------------
function RulesSection({
  question,
  vehicleTypes,
  operations,
  canManage,
  actions,
  onChanged,
}: {
  question: AdminQuestion;
  vehicleTypes: AdminVehicleType[];
  operations: AdminOperation[];
  canManage: boolean;
  actions: ChecklistAdminActions;
  onChanged: () => Promise<void>;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [kind, setKind] = React.useState<RuleKind>("operation");
  const [mode, setMode] = React.useState<RuleMode>("include");
  const [targetId, setTargetId] = React.useState("");
  const [guidance, setGuidance] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const targets = React.useMemo(() => {
    if (kind === "operation") return operations.map((o) => ({ id: o.id, label: o.name, group: null as string | null }));
    if (kind === "vehicle_type") return vehicleTypes.map((t) => ({ id: t.id, label: t.name, group: null as string | null }));
    return vehicleTypes.flatMap((t) =>
      t.subcategories.filter((s) => s.isActive).map((s) => ({ id: s.id, label: s.name, group: t.name })),
    );
  }, [kind, operations, vehicleTypes]);

  const add = async () => {
    if (saving) return;
    setError(null);
    if (!targetId) {
      setError("Informe o alvo da regra.");
      return;
    }
    if (mode === "guidance" && !guidance.trim()) {
      setError("Uma regra de orientação precisa do texto orientativo.");
      return;
    }
    setSaving(true);
    const result = await actions.saveRule({
      questionId: question.id,
      ruleKind: kind,
      mode,
      targetId,
      guidance: mode === "guidance" ? guidance.trim() : null,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Não foi possível salvar a regra.");
      return;
    }
    toast({ title: "Regra adicionada.", variant: "success" });
    setTargetId("");
    setGuidance("");
    await onChanged();
  };

  const remove = async (ruleId: string, name: string) => {
    const ok = await confirm({
      title: "Excluir a regra?",
      description: `A regra para “${name}” deixa de valer nesta versão.`,
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    setSaving(true);
    const result = await actions.deleteRule(ruleId);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Não foi possível excluir a regra.");
      return;
    }
    toast({ title: "Regra excluída.", variant: "success" });
    await onChanged();
  };

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {question.rules.length === 0 ? (
        <p className="text-body-sm text-fg-muted">Sem regras: a pergunta vale para todas as operações, tipos e subcategorias.</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Regras de aplicabilidade">
          {question.rules.map((rule) => (
            <li key={rule.id} className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={rule.mode === "exclude" ? "danger" : rule.mode === "guidance" ? "info" : "accent"}>
                    {RULE_MODE_LABEL[rule.mode]}
                  </Badge>
                  <span className="text-body-sm font-medium text-fg">{rule.targetName}</span>
                  <span className="text-caption text-fg-muted">{RULE_KIND_LABEL[rule.ruleKind]}</span>
                </div>
                {rule.guidance ? <p className="mt-1 text-caption text-fg-secondary">{rule.guidance}</p> : null}
              </div>
              {canManage ? (
                <IconButton label={`Excluir regra ${rule.targetName}`} variant="ghost" size="sm" onClick={() => void remove(rule.id, rule.targetName)} disabled={saving}>
                  <Trash2 aria-hidden />
                </IconButton>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <div className="flex flex-col gap-3 rounded-md border border-dashed border-border p-3">
          <FormGrid columns={3}>
            <FormField label="Eixo" id="regra-eixo">
              <NativeSelect fieldSize="sm" value={kind} onChange={(e) => { setKind(e.target.value as RuleKind); setTargetId(""); }}>
                {(Object.keys(RULE_KIND_LABEL) as RuleKind[]).map((k) => (
                  <option key={k} value={k}>{RULE_KIND_LABEL[k]}</option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Modo" id="regra-modo">
              <NativeSelect fieldSize="sm" value={mode} onChange={(e) => setMode(e.target.value as RuleMode)}>
                {(Object.keys(RULE_MODE_LABEL) as RuleMode[]).map((m) => (
                  <option key={m} value={m}>{RULE_MODE_LABEL[m]}</option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Alvo" id="regra-alvo">
              <NativeSelect fieldSize="sm" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                <option value="">Selecione…</option>
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>{t.group ? `${t.group} · ${t.label}` : t.label}</option>
                ))}
              </NativeSelect>
            </FormField>
          </FormGrid>
          {mode === "guidance" ? (
            <FormField label="Texto orientativo" required id="regra-orientacao" helperText="Aparece na pergunta, para o motorista, quando o contexto bate com o alvo.">
              <Textarea rows={2} value={guidance} onChange={(e) => setGuidance(e.target.value)} maxLength={500} />
            </FormField>
          ) : null}
          <div className="flex justify-end">
            <Button size="sm" variant="secondary" leadingIcon={<Plus />} onClick={() => void add()} loading={saving}>
              Adicionar regra
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
