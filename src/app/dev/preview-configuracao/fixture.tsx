"use client";

import * as React from "react";
import { ConfigurationView } from "@/app/(app)/aplicativos/check-list-frota/configuracao/configuration-view";
import { KEY_PATTERN, slugify } from "@/app/(app)/aplicativos/check-list-frota/configuracao/labels";
import type {
  AdminCluster,
  AdminQuestion,
  AdminResult,
  AdminVersionSummary,
  ChecklistAdminActions,
  ChecklistAdminOverview,
  ChecklistVersionTree,
  ValidationIssue,
  VersionValidation,
} from "@/lib/applications/admin-queries";
import type { ApplicationLinks } from "@/lib/applications/links-queries";
import type { ChecklistForm } from "@/lib/applications/queries";

/**
 * Amostra do editor: um rascunho 1.1 nascido da 1.0 publicada.
 *
 * Traz um caso de cada coisa que o editor precisa distinguir — pergunta
 * invertida, campo condicional, regra de orientação e de exclusão, um cluster
 * vazio (que a validação recusa) — e ações em memória que repetem as recusas
 * do banco palavra por palavra. Nada aqui é aleatório e nada sai do navegador.
 */
export const TODAY = "2026-09-22";

const APP = { id: "app-1", name: "Check List de Frota", isActive: true, allowsAttachments: false };

const OPERATIONS = [
  { id: "op-1", name: "Last Mille MG", code: "LMMG", status: "active", isEnabled: true },
  { id: "op-2", name: "Distribuição Belém", code: "DBEL", status: "active", isEnabled: true },
  { id: "op-3", name: "Frota Leve ADM", code: "FLADM", status: "active", isEnabled: false },
];

const VEHICLE_TYPES = [
  {
    id: "t-van", code: "VAN", name: "Van",
    subcategories: [
      { id: "s-furgao", name: "Furgão", isActive: true },
      { id: "s-bau", name: "Baú", isActive: true },
    ],
  },
  { id: "t-truck", code: "CAM34", name: "Caminhão 3/4", subcategories: [] },
];

export const LINKS: ApplicationLinks = {
  apps: [{ id: APP.id, code: "CLF", name: APP.name, slug: "check-list-frota", isActive: true }],
  operations: OPERATIONS.map((o) => ({ id: o.id, code: o.code, name: o.name, status: o.status })),
  vehicleTypes: VEHICLE_TYPES.map((t) => ({ id: t.id, code: t.code, name: t.name, isActive: true, scope: "organization" as const })),
  operationLinks: OPERATIONS.filter((o) => o.isEnabled).map((o) => ({
    appId: APP.id, operationId: o.id, isEnabled: true, effectiveFrom: "2026-01-01", effectiveTo: null,
    updatedAt: "2026-01-01T09:00:00Z", inForce: true,
  })),
  typeLinks: [
    { appId: APP.id, vehicleTypeId: "t-van", isEnabled: true, effectiveFrom: "2026-01-01", effectiveTo: null, updatedAt: "2026-01-01T09:00:00Z", inForce: true },
  ],
};

function question(partial: Partial<AdminQuestion> & Pick<AdminQuestion, "id" | "questionKey" | "sortOrder" | "questionText">): AdminQuestion {
  return {
    answerType: "yes_no",
    conformingAnswer: "yes",
    criticality: "media",
    isRequired: true,
    generatesActionPlan: true,
    allowsNote: true,
    noteRequired: false,
    status: "active",
    conditionals: [],
    rules: [],
    ...partial,
  };
}

function baseClusters(prefix: string): AdminCluster[] {
  return [
    {
      id: `${prefix}-cl-1`, clusterKey: "5s", name: "5S", sortOrder: 1, isRequired: true,
      questions: [
        question({ id: `${prefix}-q-1`, questionKey: "5s.limpeza_externa", sortOrder: 1, questionText: "A frota está limpa externamente?" }),
        question({
          id: `${prefix}-q-2`, questionKey: "5s.interior_organizado", sortOrder: 2, questionText: "O interior está organizado?",
          rules: [{
            id: `${prefix}-r-1`, ruleKind: "vehicle_type", mode: "exclude", vehicleTypeId: "t-truck",
            vehicleSubcategoryId: null, operationId: null, targetName: "Caminhão 3/4", guidance: null,
          }],
        }),
      ],
    },
    {
      id: `${prefix}-cl-2`, clusterKey: "funilaria", name: "Funilaria", sortOrder: 2, isRequired: true,
      questions: [
        question({
          id: `${prefix}-q-3`, questionKey: "funilaria.avaria", sortOrder: 1,
          questionText: "Possui alguma avaria? Exemplo: amassado, arranhão, quebra ou dano aparente.",
          // Invertida: SIM é inconformidade.
          conformingAnswer: "no",
          conditionals: [{
            id: `${prefix}-c-1`, fieldKey: "descricao_avaria", triggerAnswer: "yes",
            label: "Descreva a avaria identificada.", fieldType: "text", isRequired: true, options: [], sortOrder: 1,
          }],
        }),
        question({
          id: `${prefix}-q-4`, questionKey: "funilaria.retrovisores", sortOrder: 2,
          questionText: "Os retrovisores estão íntegros?", criticality: "critica",
          rules: [{
            id: `${prefix}-r-2`, ruleKind: "operation", mode: "guidance", vehicleTypeId: null,
            vehicleSubcategoryId: null, operationId: "op-1", targetName: "Last Mille MG",
            guidance: "Nesta operação os veículos podem sair sem o retrovisor auxiliar. Conforme regra operacional aprovada, responda SIM quando o veículo não o possuir.",
          }],
        }),
      ],
    },
  ];
}

interface FixtureState {
  versions: AdminVersionSummary[];
  trees: Record<string, ChecklistVersionTree>;
  seq: number;
}

export function buildFixture(): FixtureState {
  const publishedId = "ver-10";
  const draftId = "ver-11";
  const trees: Record<string, ChecklistVersionTree> = {
    [publishedId]: {
      version: {
        id: publishedId, major: 1, minor: 0, label: "1.0", status: "published",
        notes: "Versão inicial, importada do HFC.", sourceNote: "Origem: HFC 1.1",
        publishedAt: "2026-06-01T12:00:00Z", createdAt: "2026-05-20T09:00:00Z", updatedAt: "2026-06-01T12:00:00Z",
        minDurationSeconds: 60, maxDurationSeconds: 600,
      },
      clusters: baseClusters("p"),
    },
    [draftId]: {
      version: {
        id: draftId, major: 1, minor: 1, label: "1.1", status: "draft",
        notes: "Inclui o cluster de documentação.", sourceNote: "Criada a partir da versão 1.0",
        publishedAt: null, createdAt: "2026-09-20T14:30:00Z", updatedAt: "2026-09-21T10:15:00Z",
        minDurationSeconds: 60, maxDurationSeconds: 600,
      },
      clusters: [
        ...baseClusters("d"),
        // Sem perguntas: a validação recusa a publicação até que seja resolvido.
        { id: "d-cl-3", clusterKey: "documentacao", name: "Documentação", sortOrder: 3, isRequired: true, questions: [] },
      ],
    },
  };
  const state: FixtureState = { versions: [], trees, seq: 100 };
  state.versions = [summaryOf(state, draftId, 0), summaryOf(state, publishedId, 128)];
  return state;
}

function summaryOf(state: FixtureState, id: string, executions: number): AdminVersionSummary {
  const tree = state.trees[id];
  return {
    ...tree.version,
    clusters: tree.clusters.length,
    questions: tree.clusters.reduce((n, c) => n + c.questions.filter((q) => q.status === "active").length, 0),
    executions,
  };
}

const clone = <T,>(value: T): T => structuredClone(value);
const ok = <T,>(data: T): AdminResult<T> => ({ ok: true, data });
const fail = <T,>(error: string): AdminResult<T> => ({ ok: false, error });

class Refusal extends Error {}

/**
 * As ações em memória. Cada uma valida como a rotina do banco valida e recusa
 * com a MESMA frase, porque o que se prova no navegador é que a tela repete a
 * recusa do servidor sem reescrevê-la.
 */
export function createFixtureActions(state: FixtureState): ChecklistAdminActions {
  const nextId = (prefix: string) => `${prefix}-${++state.seq}`;

  const overview = (): ChecklistAdminOverview => ({
    app: { ...APP },
    versions: state.versions
      .map((v) => summaryOf(state, v.id, v.executions))
      .sort((a, b) => b.major - a.major || b.minor - a.minor),
    operations: clone(OPERATIONS),
    vehicleTypes: clone(VEHICLE_TYPES),
  });

  const treeOf = (versionId: string): ChecklistVersionTree => {
    const tree = state.trees[versionId];
    if (!tree) throw new Refusal("Versão não encontrada nesta organização.");
    return tree;
  };

  const editable = (versionId: string): ChecklistVersionTree => {
    const tree = treeOf(versionId);
    if (tree.version.status !== "draft") {
      throw new Refusal(
        `A versão ${tree.version.label} está ${tree.version.status === "published" ? "publicada" : "arquivada"} e é imutável. Crie uma nova versão de trabalho para editar.`,
      );
    }
    tree.version.updatedAt = new Date().toISOString();
    return tree;
  };

  const findQuestion = (questionId: string): { tree: ChecklistVersionTree; cluster: AdminCluster; question: AdminQuestion } => {
    for (const tree of Object.values(state.trees)) {
      for (const cluster of tree.clusters) {
        const q = cluster.questions.find((x) => x.id === questionId);
        if (q) return { tree, cluster, question: q };
      }
    }
    throw new Refusal("Pergunta não encontrada nesta organização.");
  };

  const renumber = <T extends { sortOrder: number }>(items: T[]) => items.forEach((item, i) => { item.sortOrder = i + 1; });

  const validate = (versionId: string): VersionValidation => {
    const tree = treeOf(versionId);
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const issue = (code: string, message: string, extra: Partial<ValidationIssue> = {}): ValidationIssue =>
      ({ code, message, questionId: null, clusterId: null, ...extra });
    const short = (text: string) => text.slice(0, 60);

    if (tree.clusters.length === 0) errors.push(issue("sem_clusters", "A versão não possui nenhum cluster."));
    for (const cluster of tree.clusters) {
      if (!cluster.questions.some((q) => q.status === "active")) {
        errors.push(issue("cluster_vazio", `O cluster "${cluster.name}" não possui pergunta ativa.`, { clusterId: cluster.id }));
      }
    }
    const all = tree.clusters.flatMap((c) => c.questions);
    const active = all.filter((q) => q.status === "active");
    if (tree.clusters.length > 0 && active.length === 0) errors.push(issue("sem_perguntas", "A versão não possui nenhuma pergunta ativa."));
    for (const q of active) {
      if (q.noteRequired && !q.allowsNote) errors.push(issue("observacao", `"${short(q.questionText)}": exige observação mas não permite observação.`, { questionId: q.id }));
      for (const c of q.conditionals) {
        if (c.fieldType !== "text" && c.options.length < 2) {
          errors.push(issue("condicional_opcoes", `"${short(q.questionText)}": o campo de escolha precisa de pelo menos duas opções.`, { questionId: q.id }));
        }
      }
      for (const r of q.rules) {
        if (r.mode === "guidance" && !r.guidance?.trim()) errors.push(issue("regra_orientacao", `"${short(q.questionText)}": regra de orientação sem texto.`, { questionId: q.id }));
        if (r.ruleKind === "operation" && !OPERATIONS.find((o) => o.id === r.operationId)?.isEnabled) {
          warnings.push(issue("regra_operacao_desabilitada", `"${short(q.questionText)}": a regra aponta para a operação "${r.targetName}", que não está habilitada para o aplicativo.`, { questionId: q.id }));
        }
      }
    }
    const enabledOps = OPERATIONS.filter((o) => o.isEnabled && o.status === "active").length;
    if (enabledOps === 0) errors.push(issue("sem_operacoes", "Nenhuma operação ativa está habilitada para o aplicativo."));
    if (APP.allowsAttachments) errors.push(issue("anexos", "O aplicativo está marcado para permitir anexos; o Check List de Frota não admite anexos e o executor não os executa."));
    const { minDurationSeconds: min, maxDurationSeconds: max } = tree.version;
    if (min < 0 || max <= min) errors.push(issue("duracao", "Os limites de tempo são inválidos: o máximo deve ser maior que o mínimo."));
    if (max > 3600) warnings.push(issue("duracao_longa", "O tempo máximo é maior que uma hora."));
    if (active.length > 0 && !active.some((q) => q.criticality === "critica")) warnings.push(issue("sem_criticas", "Nenhuma pergunta ativa é crítica."));
    const inactive = all.length - active.length;
    if (inactive > 0) warnings.push(issue("perguntas_inativas", `${inactive} pergunta(s) inativa(s) não serão apresentadas ao motorista.`));

    const published = Object.values(state.trees).find((t) => t.version.status === "published" && t.version.id !== versionId);
    if (published) {
      const pubKeys = new Set(published.clusters.flatMap((c) => c.questions.filter((q) => q.status === "active").map((q) => q.questionKey)));
      const draftKeys = new Set(active.map((q) => q.questionKey));
      const removed = [...pubKeys].filter((k) => !draftKeys.has(k)).length;
      const added = [...draftKeys].filter((k) => !pubKeys.has(k)).length;
      if (removed > 0) warnings.push(issue("identidades_retiradas", `${removed} pergunta(s) ativa(s) na versão publicada não seguem ativas nesta versão; o histórico delas fica preservado, mas a comparação futura para.`));
      if (added > 0) warnings.push(issue("identidades_novas", `${added} pergunta(s) com identidade nova: passam a ser medidas a partir desta versão.`));
    }

    return {
      ok: errors.length === 0,
      versionId,
      label: tree.version.label,
      status: tree.version.status,
      errors,
      warnings,
      summary: {
        clusters: tree.clusters.length,
        questionsActive: active.length,
        questionsInactive: inactive,
        conditionals: all.reduce((n, q) => n + q.conditionals.length, 0),
        rules: all.reduce((n, q) => n + q.rules.length, 0),
        operationsEnabled: enabledOps,
        answerTypes: ["yes_no"],
        allowsAttachments: APP.allowsAttachments,
      },
    };
  };

  const guard = async <T,>(fn: () => T): Promise<AdminResult<T>> => {
    try {
      return ok(fn());
    } catch (error) {
      if (error instanceof Refusal) return fail(error.message);
      throw error;
    }
  };

  return {
    loadOverview: async () => ok(overview()),
    loadVersionTree: async (versionId) => guard(() => clone(treeOf(versionId))),
    loadVersionPreview: async (input) =>
      guard((): ChecklistForm => {
        const tree = treeOf(input.versionId);
        const matches = (r: AdminQuestion["rules"][number]) =>
          (r.ruleKind === "operation" && r.operationId === input.operationId) ||
          (r.ruleKind === "vehicle_type" && r.vehicleTypeId === input.vehicleTypeId) ||
          (r.ruleKind === "vehicle_subcategory" && r.vehicleSubcategoryId === input.vehicleSubcategoryId);
        const context: Record<string, string | null | undefined> = {
          operation: input.operationId, vehicle_type: input.vehicleTypeId, vehicle_subcategory: input.vehicleSubcategoryId,
        };
        return {
          appId: APP.id,
          appName: APP.name,
          versionId: tree.version.id,
          versionLabel: tree.version.label,
          minDurationSeconds: tree.version.minDurationSeconds,
          maxDurationSeconds: tree.version.maxDurationSeconds,
          vehicle: { id: "preview", licensePlate: "PRÉVIA", fleetCode: null },
          clusters: tree.clusters
            .map((c) => ({
              id: c.id,
              clusterKey: c.clusterKey,
              name: c.name,
              questions: c.questions
                .filter((q) => q.status === "active")
                .filter((q) => {
                  for (const kind of ["operation", "vehicle_type", "vehicle_subcategory"] as const) {
                    const includes = q.rules.filter((r) => r.ruleKind === kind && r.mode === "include");
                    if (context[kind] && includes.length > 0 && !includes.some(matches)) return false;
                  }
                  return !q.rules.some((r) => r.mode === "exclude" && matches(r));
                })
                .map((q) => {
                  const c0 = q.conditionals[0];
                  return {
                    id: q.id,
                    questionKey: q.questionKey,
                    text: q.questionText,
                    conformingAnswer: q.conformingAnswer,
                    criticality: q.criticality,
                    isRequired: q.isRequired,
                    allowsNote: q.allowsNote,
                    noteRequired: q.noteRequired,
                    guidance: q.rules.find((r) => r.mode === "guidance" && matches(r))?.guidance ?? null,
                    conditional: c0
                      ? { fieldKey: c0.fieldKey, triggerAnswer: c0.triggerAnswer, label: c0.label, fieldType: c0.fieldType, isRequired: c0.isRequired, options: clone(c0.options) }
                      : null,
                  };
                }),
            }))
            .filter((c) => c.questions.length > 0),
        };
      }),
    validateVersion: async (versionId) => guard(() => validate(versionId)),

    createVersion: async (input) =>
      guard(() => {
        const draft = state.versions.find((v) => v.status === "draft");
        if (draft) throw new Refusal(`Já existe uma versão de trabalho (${draft.label}). Edite, publique ou descarte-a antes de criar outra.`);
        const base = [...state.versions].sort((a, b) => b.major - a.major || b.minor - a.minor).find((v) => v.status === "published")
          ?? [...state.versions].sort((a, b) => b.major - a.major || b.minor - a.minor)[0];
        const major = base ? (input.bump === "major" ? base.major + 1 : base.major) : 1;
        const minor = base ? (input.bump === "major" ? 0 : base.minor + 1) : 0;
        const id = nextId("ver");
        const label = `${major}.${minor}`;
        const copied = base ? clone(state.trees[base.id].clusters) : [];
        // Ids novos para tudo o que foi copiado: o rascunho é uma cópia, não um vínculo.
        for (const c of copied) {
          c.id = nextId("cl");
          for (const q of c.questions) {
            q.id = nextId("q");
            for (const cd of q.conditionals) cd.id = nextId("c");
            for (const r of q.rules) r.id = nextId("r");
          }
        }
        state.trees[id] = {
          version: {
            id, major, minor, label, status: "draft", notes: input.notes ?? null,
            sourceNote: base ? `Criada a partir da versão ${base.label}` : "Primeira versão",
            publishedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            minDurationSeconds: base?.minDurationSeconds ?? 60, maxDurationSeconds: base?.maxDurationSeconds ?? 600,
          },
          clusters: copied,
        };
        state.versions.unshift(summaryOf(state, id, 0));
        return { id, label, baseLabel: base?.label ?? null, clusters: copied.length, questions: copied.reduce((n, c) => n + c.questions.length, 0) };
      }),

    updateVersion: async (input) =>
      guard(() => {
        const tree = editable(input.id);
        if (input.minDurationSeconds < 0 || input.maxDurationSeconds <= input.minDurationSeconds) {
          throw new Refusal("O tempo mínimo deve ser zero ou mais e o máximo maior que o mínimo.");
        }
        tree.version.notes = input.notes?.trim() || null;
        tree.version.minDurationSeconds = input.minDurationSeconds;
        tree.version.maxDurationSeconds = input.maxDurationSeconds;
        return { id: tree.version.id, label: tree.version.label };
      }),

    discardVersion: async (id) =>
      guard(() => {
        const tree = editable(id);
        delete state.trees[id];
        state.versions = state.versions.filter((v) => v.id !== id);
        return { id, label: tree.version.label };
      }),

    publishVersion: async (versionId) =>
      guard(() => {
        const tree = editable(versionId);
        const check = validate(versionId);
        if (!check.ok) {
          throw new Refusal(`A versão ${tree.version.label} não pode ser publicada: ${check.errors.slice(0, 3).map((e) => e.message).join(" ")}`);
        }
        const previous = Object.values(state.trees).find((t) => t.version.status === "published");
        if (previous) {
          previous.version.status = "archived";
          previous.version.updatedAt = new Date().toISOString();
        }
        const now = new Date().toISOString();
        tree.version.status = "published";
        tree.version.publishedAt = now;
        tree.version.updatedAt = now;
        state.versions = state.versions.map((v) => summaryOf(state, v.id, v.executions));
        return {
          id: versionId, label: tree.version.label,
          archivedId: previous?.version.id ?? null, archivedLabel: previous?.version.label ?? null,
          publishedAt: now, warnings: check.warnings,
        };
      }),

    saveCluster: async (input) =>
      guard(() => {
        const tree = editable(input.versionId);
        const name = input.name.trim();
        if (name.length < 1 || name.length > 120) throw new Refusal("O nome do cluster deve ter entre 1 e 120 caracteres.");
        if (input.id) {
          const cluster = tree.clusters.find((c) => c.id === input.id);
          if (!cluster) throw new Refusal("Cluster não encontrado nesta versão.");
          cluster.name = name;
          cluster.isRequired = input.isRequired;
          return { id: cluster.id, clusterKey: cluster.clusterKey };
        }
        let key = slugify(name).slice(0, 60);
        if (!key) throw new Refusal("Não foi possível derivar a chave do cluster a partir do nome.");
        let n = 1;
        const base = key;
        while (tree.clusters.some((c) => c.clusterKey === key)) key = `${base}_${++n}`;
        const cluster: AdminCluster = { id: nextId("cl"), clusterKey: key, name, sortOrder: tree.clusters.length + 1, isRequired: input.isRequired, questions: [] };
        tree.clusters.push(cluster);
        return { id: cluster.id, clusterKey: key };
      }),

    deleteCluster: async (id) =>
      guard(() => {
        const tree = Object.values(state.trees).find((t) => t.clusters.some((c) => c.id === id));
        if (!tree) throw new Refusal("Cluster não encontrado nesta organização.");
        editable(tree.version.id);
        const cluster = tree.clusters.find((c) => c.id === id)!;
        if (cluster.questions.length > 0) {
          throw new Refusal(`O cluster "${cluster.name}" possui ${cluster.questions.length} pergunta(s). Mova ou exclua as perguntas antes de excluí-lo.`);
        }
        tree.clusters = tree.clusters.filter((c) => c.id !== id);
        renumber(tree.clusters);
        return { id };
      }),

    reorderClusters: async (versionId, orderedIds) =>
      guard(() => {
        const tree = editable(versionId);
        const current = tree.clusters.map((c) => c.id);
        if (orderedIds.length !== current.length || !orderedIds.every((id) => current.includes(id))) {
          throw new Refusal("A ordem informada não corresponde aos clusters desta versão.");
        }
        tree.clusters = orderedIds.map((id) => tree.clusters.find((c) => c.id === id)!);
        renumber(tree.clusters);
        return { count: orderedIds.length };
      }),

    saveQuestion: async (input) =>
      guard(() => {
        const tree = editable(input.versionId);
        const text = input.questionText.trim();
        if (text.length < 3 || text.length > 500) throw new Refusal("O texto da pergunta deve ter entre 3 e 500 caracteres.");
        if (input.noteRequired && !input.allowsNote) {
          throw new Refusal('A pergunta exige observação mas não permite observação. Ative "permite observação" ou desative a exigência.');
        }
        const cluster = tree.clusters.find((c) => c.id === input.clusterId);
        if (!cluster) throw new Refusal("Cluster não encontrado nesta versão.");
        const keyIn = input.questionKey?.trim() || null;
        if (keyIn && !KEY_PATTERN.test(keyIn)) {
          throw new Refusal('A identidade técnica aceita apenas letras minúsculas, números, "_" e "." (ex.: luzes.farois).');
        }
        const allQuestions = tree.clusters.flatMap((c) => c.questions);
        const fields = {
          questionText: text, conformingAnswer: input.conformingAnswer, criticality: input.criticality,
          isRequired: input.isRequired, generatesActionPlan: input.generatesActionPlan, allowsNote: input.allowsNote,
          noteRequired: input.noteRequired, status: input.status,
        };

        if (!input.id) {
          let key = keyIn ?? `${cluster.clusterKey}.${slugify(text).slice(0, 60)}`;
          let n = 1;
          const base = key;
          while (allQuestions.some((q) => q.questionKey === key)) key = `${base}_${++n}`;
          const created = question({ id: nextId("q"), questionKey: key, sortOrder: cluster.questions.length + 1, ...fields });
          cluster.questions.push(created);
          return { id: created.id, questionKey: key, clusterId: cluster.id };
        }

        const found = findQuestion(input.id);
        if (found.tree !== tree) throw new Refusal("Pergunta não encontrada nesta versão.");
        // §47: editar o texto NÃO muda a chave; só a declaração de nova identidade.
        let key = found.question.questionKey;
        if (input.newIdentity) {
          if (!keyIn || keyIn === key) throw new Refusal(`Informe a nova identidade técnica da pergunta, diferente da atual (${key}).`);
          if (allQuestions.some((q) => q.questionKey === keyIn && q.id !== input.id)) {
            throw new Refusal(`Já existe uma pergunta com a identidade ${keyIn} nesta versão.`);
          }
          key = keyIn;
        }
        Object.assign(found.question, fields, { questionKey: key });
        if (found.cluster.id !== cluster.id) {
          found.cluster.questions = found.cluster.questions.filter((q) => q.id !== input.id);
          renumber(found.cluster.questions);
          found.question.sortOrder = cluster.questions.length + 1;
          cluster.questions.push(found.question);
        }
        return { id: found.question.id, questionKey: key, clusterId: cluster.id };
      }),

    deleteQuestion: async (id) =>
      guard(() => {
        const found = findQuestion(id);
        editable(found.tree.version.id);
        found.cluster.questions = found.cluster.questions.filter((q) => q.id !== id);
        renumber(found.cluster.questions);
        return { id };
      }),

    reorderQuestions: async (clusterId, orderedIds) =>
      guard(() => {
        const tree = Object.values(state.trees).find((t) => t.clusters.some((c) => c.id === clusterId));
        if (!tree) throw new Refusal("Cluster não encontrado nesta organização.");
        editable(tree.version.id);
        const cluster = tree.clusters.find((c) => c.id === clusterId)!;
        const current = cluster.questions.map((q) => q.id);
        if (orderedIds.length !== current.length || !orderedIds.every((id) => current.includes(id))) {
          throw new Refusal("A ordem informada não corresponde às perguntas deste cluster.");
        }
        cluster.questions = orderedIds.map((id) => cluster.questions.find((q) => q.id === id)!);
        renumber(cluster.questions);
        return { count: orderedIds.length };
      }),

    saveConditional: async (input) =>
      guard(() => {
        const found = findQuestion(input.questionId);
        editable(found.tree.version.id);
        const label = input.label.trim();
        if (label.length < 3 || label.length > 200) throw new Refusal("O rótulo do campo condicional deve ter entre 3 e 200 caracteres.");
        const options: { value: string; label: string }[] = [];
        if (input.fieldType !== "text") {
          for (const raw of input.options) {
            const optLabel = raw.trim();
            const value = slugify(optLabel);
            if (!optLabel || !value) continue;
            if (options.some((o) => o.value === value)) throw new Refusal(`Opção repetida: ${optLabel}.`);
            options.push({ value, label: optLabel });
          }
          if (options.length < 2) throw new Refusal("Um campo de escolha precisa de pelo menos duas opções.");
        }
        if (!input.id) {
          if (found.question.conditionals.length > 0) {
            throw new Refusal("Esta pergunta já possui um campo condicional. O executor apresenta um por pergunta: edite o existente.");
          }
          const fieldKey = slugify(label).slice(0, 60);
          if (!fieldKey) throw new Refusal("Não foi possível derivar a chave do campo a partir do rótulo.");
          const id = nextId("c");
          found.question.conditionals.push({ id, fieldKey, triggerAnswer: input.triggerAnswer, label, fieldType: input.fieldType, isRequired: input.isRequired, options, sortOrder: 1 });
          return { id, fieldKey, options };
        }
        const current = found.question.conditionals.find((c) => c.id === input.id);
        if (!current) throw new Refusal("Campo condicional não encontrado nesta pergunta.");
        Object.assign(current, { triggerAnswer: input.triggerAnswer, label, fieldType: input.fieldType, isRequired: input.isRequired, options });
        return { id: current.id, fieldKey: current.fieldKey, options };
      }),

    deleteConditional: async (id) =>
      guard(() => {
        for (const tree of Object.values(state.trees)) {
          for (const cluster of tree.clusters) {
            for (const q of cluster.questions) {
              if (q.conditionals.some((c) => c.id === id)) {
                editable(tree.version.id);
                q.conditionals = q.conditionals.filter((c) => c.id !== id);
                return { id };
              }
            }
          }
        }
        throw new Refusal("Campo condicional não encontrado nesta organização.");
      }),

    saveRule: async (input) =>
      guard(() => {
        const found = findQuestion(input.questionId);
        editable(found.tree.version.id);
        if (!input.targetId) throw new Refusal("Informe o alvo da regra.");
        const guidance = input.mode === "guidance" ? input.guidance?.trim() || null : null;
        if (input.mode === "guidance" && !guidance) throw new Refusal("Uma regra de orientação precisa do texto orientativo.");
        let name: string | undefined;
        let vehicleTypeId: string | null = null, vehicleSubcategoryId: string | null = null, operationId: string | null = null;
        if (input.ruleKind === "vehicle_type") {
          name = VEHICLE_TYPES.find((t) => t.id === input.targetId)?.name;
          if (!name) throw new Refusal("Tipo de equipamento não encontrado nesta organização.");
          vehicleTypeId = input.targetId;
        } else if (input.ruleKind === "vehicle_subcategory") {
          name = VEHICLE_TYPES.flatMap((t) => t.subcategories).find((s) => s.id === input.targetId)?.name;
          if (!name) throw new Refusal("Subcategoria não encontrada nesta organização.");
          vehicleSubcategoryId = input.targetId;
        } else {
          name = OPERATIONS.find((o) => o.id === input.targetId)?.name;
          if (!name) throw new Refusal("Operação não encontrada nesta organização.");
          operationId = input.targetId;
        }
        const duplicate = found.question.rules.some(
          (r) => r.id !== input.id && r.ruleKind === input.ruleKind && r.mode === input.mode &&
            r.vehicleTypeId === vehicleTypeId && r.vehicleSubcategoryId === vehicleSubcategoryId && r.operationId === operationId,
        );
        if (duplicate) throw new Refusal(`Já existe uma regra desta pergunta para "${name}".`);
        if (input.id) {
          const rule = found.question.rules.find((r) => r.id === input.id);
          if (!rule) throw new Refusal("Regra não encontrada nesta pergunta.");
          Object.assign(rule, { ruleKind: input.ruleKind, mode: input.mode, vehicleTypeId, vehicleSubcategoryId, operationId, targetName: name, guidance });
          return { id: rule.id, targetName: name };
        }
        const id = nextId("r");
        found.question.rules.push({ id, ruleKind: input.ruleKind, mode: input.mode, vehicleTypeId, vehicleSubcategoryId, operationId, targetName: name, guidance });
        return { id, targetName: name };
      }),

    deleteRule: async (id) =>
      guard(() => {
        for (const tree of Object.values(state.trees)) {
          for (const cluster of tree.clusters) {
            for (const q of cluster.questions) {
              if (q.rules.some((r) => r.id === id)) {
                editable(tree.version.id);
                q.rules = q.rules.filter((r) => r.id !== id);
                return { id };
              }
            }
          }
        }
        throw new Refusal("Regra não encontrada nesta organização.");
      }),
  };
}

/** A tela real, com a amostra e as ações em memória. */
export function PreviewConfiguration() {
  const [state] = React.useState(buildFixture);
  const actions = React.useMemo(() => createFixtureActions(state), [state]);
  const draftId = state.versions.find((v) => v.status === "draft")?.id ?? state.versions[0]?.id ?? null;

  return (
    <ConfigurationView
      overview={{ app: { ...APP }, versions: clone(state.versions), operations: clone(OPERATIONS), vehicleTypes: clone(VEHICLE_TYPES) }}
      initialVersionId={draftId}
      initialTree={draftId ? clone(state.trees[draftId]) : null}
      links={LINKS}
      linksLoader={async () => ({ ok: true, data: LINKS })}
      today={TODAY}
      actions={actions}
      perms={{
        configure: true,
        createVersion: true,
        publish: true,
        manageRules: true,
        manageOperationLinks: true,
        manageEquipmentLinks: true,
      }}
    />
  );
}
