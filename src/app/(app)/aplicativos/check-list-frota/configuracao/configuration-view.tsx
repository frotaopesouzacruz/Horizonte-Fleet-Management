"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowDown, ArrowLeft, ArrowUp, ClipboardList, GitBranchPlus, Layers, ListChecks, Pencil, Plus, Rocket, Save, Trash2,
} from "lucide-react";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button, IconButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { NativeSelect } from "@/components/governance/selects";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { useToast } from "@/components/feedback/toast";
import { useConfirm } from "@/components/feedback/confirm-dialog";
import { ApplicationLinksPanel } from "@/components/applications/application-links-panel";
import type { ApplicationLinks } from "@/lib/applications/links-queries";
import type {
  AdminCluster,
  AdminQuestion,
  AdminVersionSummary,
  ChecklistAdminActions,
  ChecklistAdminOverview,
  ChecklistVersionTree,
  CreateVersionResult,
  PublishResult,
} from "@/lib/applications/admin-queries";
import {
  createVersion, deleteCluster, deleteConditional, deleteQuestion, deleteRule, discardVersion,
  loadAdminOverview, loadVersionPreview, loadVersionTree, publishVersion, reorderClusters,
  reorderQuestions, saveCluster, saveConditional, saveQuestion, saveRule, updateVersion, validateVersion,
} from "@/lib/applications/admin-actions";
import { ANSWER_LABEL, CRITICALITY_LABEL, STATUS_LABEL, STATUS_VARIANT, formatDateTime } from "./labels";
import { ClusterDialog } from "./cluster-dialog";
import { QuestionDrawer } from "./question-drawer";
import { PreviewPanel } from "./preview-panel";
import { NewVersionDialog, PublishDialog } from "./version-dialogs";

const number = new Intl.NumberFormat("pt-BR");

export type ConfigurationTab =
  | "geral" | "clusters" | "perguntas" | "operacoes" | "tipos" | "previa" | "historico";

export interface ConfigurationPerms {
  configure: boolean;
  createVersion: boolean;
  publish: boolean;
  manageRules: boolean;
  manageOperationLinks: boolean;
  manageEquipmentLinks: boolean;
}

export interface ConfigurationViewProps {
  overview: ChecklistAdminOverview;
  initialVersionId: string | null;
  initialTree: ChecklistVersionTree | null;
  /** Vínculos já carregados no servidor; sem eles o painel carrega sozinho. */
  links?: ApplicationLinks;
  perms: ConfigurationPerms;
  today: string;
  initialTab?: ConfigurationTab;
  /** Injeção para a prévia sem sessão; o padrão são as ações de servidor. */
  actions?: ChecklistAdminActions;
  linksLoader?: () => Promise<{ ok: boolean; error?: string; data?: ApplicationLinks }>;
}

const REAL_ACTIONS: ChecklistAdminActions = {
  loadOverview: loadAdminOverview,
  loadVersionTree,
  loadVersionPreview,
  validateVersion,
  createVersion,
  updateVersion,
  discardVersion,
  publishVersion,
  saveCluster,
  deleteCluster,
  reorderClusters,
  saveQuestion,
  deleteQuestion,
  reorderQuestions,
  saveConditional,
  deleteConditional,
  saveRule,
  deleteRule,
};

/** O rascunho, se houver; senão a publicada; senão a mais recente. */
function pickDefaultVersion(versions: AdminVersionSummary[]): AdminVersionSummary | null {
  return (
    versions.find((v) => v.status === "draft") ??
    versions.find((v) => v.status === "published") ??
    versions[0] ??
    null
  );
}

/** Troca dois vizinhos de lugar e devolve a lista de ids na nova ordem. */
function swapIds<T extends { id: string }>(items: T[], index: number, delta: number): string[] | null {
  const target = index + delta;
  if (target < 0 || target >= items.length) return null;
  const ids = items.map((item) => item.id);
  [ids[index], ids[target]] = [ids[target], ids[index]];
  return ids;
}

/**
 * Editor administrativo do Check List de Frota (§45–§47).
 *
 * A versão publicada é imutável: tudo que se edita é o rascunho, e publicar é
 * uma decisão explícita que passa pela validação. A tela não guarda regra de
 * negócio — mostra o que o banco devolveu e repete, literalmente, o que ele
 * recusou.
 */
export function ConfigurationView({
  overview: initialOverview,
  initialVersionId,
  initialTree,
  links,
  perms,
  today,
  initialTab = "geral",
  actions = REAL_ACTIONS,
  linksLoader,
}: ConfigurationViewProps) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [overview, setOverview] = React.useState(initialOverview);
  const [versionId, setVersionId] = React.useState<string | null>(initialVersionId);
  const [tree, setTree] = React.useState<ChecklistVersionTree | null>(initialTree);
  const [loadingTree, setLoadingTree] = React.useState(false);
  const [tab, setTab] = React.useState<ConfigurationTab>(initialTab);
  const [busy, setBusy] = React.useState(false);
  const [newVersionOpen, setNewVersionOpen] = React.useState(false);
  const [publishOpen, setPublishOpen] = React.useState(false);

  const versions = overview.versions;
  const version = tree?.version ?? null;
  const summary = versions.find((v) => v.id === versionId) ?? null;
  const draft = versions.find((v) => v.status === "draft") ?? null;
  const published = versions.find((v) => v.status === "published") ?? null;
  const isDraft = version?.status === "draft";
  const canEdit = perms.configure && isDraft;

  const loadTree = React.useCallback(
    async (id: string) => {
      setLoadingTree(true);
      const result = await actions.loadVersionTree(id);
      setLoadingTree(false);
      if (result.ok && result.data) setTree(result.data);
      else toast({ title: result.error ?? "Não foi possível carregar a versão.", variant: "danger" });
    },
    [actions, toast],
  );

  const refreshOverview = React.useCallback(async () => {
    const result = await actions.loadOverview();
    if (result.ok && result.data) setOverview(result.data);
    return result.ok && result.data ? result.data : null;
  }, [actions]);

  const refreshTree = React.useCallback(async () => {
    if (versionId) await loadTree(versionId);
  }, [versionId, loadTree]);

  const refreshAll = React.useCallback(async () => {
    await Promise.all([refreshTree(), refreshOverview()]);
  }, [refreshTree, refreshOverview]);

  const selectVersion = (id: string) => {
    if (!id || id === versionId) return;
    setVersionId(id);
    void loadTree(id);
  };

  const onVersionCreated = async (result: CreateVersionResult) => {
    setNewVersionOpen(false);
    toast({
      title: `Versão de trabalho ${result.label} criada${result.baseLabel ? ` a partir da ${result.baseLabel}` : ""}.`,
      variant: "success",
    });
    await refreshOverview();
    setVersionId(result.id);
    setTab("geral");
    await loadTree(result.id);
  };

  const onPublished = async (result: PublishResult) => {
    setPublishOpen(false);
    toast({
      title: `Versão ${result.label} publicada.${result.archivedLabel ? ` A versão ${result.archivedLabel} foi arquivada.` : ""}`,
      variant: "success",
    });
    await refreshOverview();
    await loadTree(result.id);
  };

  const discard = async () => {
    if (!version) return;
    const ok = await confirm({
      title: `Descartar o rascunho ${version.label}?`,
      description: "Tudo o que foi editado nesta versão de trabalho é perdido. A versão publicada continua como está.",
      confirmLabel: "Descartar rascunho",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    const result = await actions.discardVersion(version.id);
    setBusy(false);
    if (!result.ok) {
      toast({ title: result.error ?? "Não foi possível descartar o rascunho.", variant: "danger" });
      return;
    }
    toast({ title: `Rascunho ${version.label} descartado.`, variant: "success" });
    const next = await refreshOverview();
    const fallback = next ? pickDefaultVersion(next.versions) : null;
    setVersionId(fallback?.id ?? null);
    if (fallback) await loadTree(fallback.id);
    else setTree(null);
  };

  const readOnlyAction = perms.createVersion ? (
    draft ? (
      <Button variant="secondary" size="sm" leadingIcon={<Pencil />} onClick={() => selectVersion(draft.id)}>
        Abrir rascunho {draft.label}
      </Button>
    ) : (
      <Button size="sm" leadingIcon={<GitBranchPlus />} onClick={() => setNewVersionOpen(true)}>
        Nova versão de trabalho
      </Button>
    )
  ) : null;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link
            href="/aplicativos/check-list-frota"
            className="inline-flex items-center gap-1.5 rounded-xs text-body-sm text-fg-secondary hover:text-fg"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Check List de Frota
          </Link>
        }
        title="Configuração do Check List de Frota"
        description="Versões, clusters, perguntas, campos condicionais, aplicabilidade e vínculos do formulário."
        meta={
          summary ? (
            <Badge variant={STATUS_VARIANT[summary.status]} appearance="soft" dot>
              {STATUS_LABEL[summary.status]} · {summary.label}
            </Badge>
          ) : null
        }
        secondaryActions={
          versions.length > 0 ? (
            <div className="w-56">
              <NativeSelect
                aria-label="Versão"
                fieldSize="sm"
                value={versionId ?? ""}
                onChange={(e) => selectVersion(e.target.value)}
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label} · {STATUS_LABEL[v.status]}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null
        }
        primaryAction={
          version ? (
            isDraft ? (
              <>
                {perms.createVersion ? (
                  <Button variant="outline" leadingIcon={<Trash2 />} onClick={() => void discard()} disabled={busy}>
                    Descartar rascunho
                  </Button>
                ) : null}
                {perms.publish ? (
                  <Button leadingIcon={<Rocket />} onClick={() => setPublishOpen(true)} disabled={busy}>
                    Publicar
                  </Button>
                ) : null}
              </>
            ) : perms.createVersion && !draft ? (
              <Button leadingIcon={<GitBranchPlus />} onClick={() => setNewVersionOpen(true)} disabled={busy}>
                Nova versão de trabalho
              </Button>
            ) : null
          ) : null
        }
      />

      <PageContent className="flex flex-col gap-4">
        {!overview.app ? (
          <EmptyState
            icon={<ClipboardList />}
            title="Aplicativo não cadastrado"
            description="O Check List de Frota não está cadastrado nesta organização. Sem o aplicativo não há versão para configurar."
          />
        ) : versions.length === 0 ? (
          <EmptyState
            icon={<ClipboardList />}
            title="Nenhuma versão do formulário"
            description="Crie a primeira versão de trabalho para montar os clusters e as perguntas."
            action={
              perms.createVersion ? (
                <Button leadingIcon={<GitBranchPlus />} onClick={() => setNewVersionOpen(true)}>
                  Nova versão de trabalho
                </Button>
              ) : undefined
            }
          />
        ) : null}

        {version && !isDraft ? (
          <Alert variant="info">
            <AlertTitle>
              Versão {version.label} {version.status === "published" ? "publicada" : "arquivada"} — somente leitura
            </AlertTitle>
            <AlertDescription>
              <span className="block">
                Uma versão {version.status === "published" ? "publicada" : "arquivada"} é imutável. Para alterar o
                formulário, crie uma nova versão de trabalho: o rascunho nasce com tudo copiado da publicada
                {published ? ` (${published.label})` : ""} e só passa a valer quando for publicado.
              </span>
              {readOnlyAction ? <span className="mt-2 block">{readOnlyAction}</span> : null}
            </AlertDescription>
          </Alert>
        ) : null}

        {version && isDraft && !perms.configure ? (
          <Alert variant="warning">
            <AlertDescription>
              Você pode consultar o rascunho, mas não possui permissão para editá-lo.
            </AlertDescription>
          </Alert>
        ) : null}

        {loadingTree ? <LoadingState label="Carregando versão…" /> : null}

        {tree && version ? (
          <Tabs value={tab} onValueChange={(v) => setTab(v as ConfigurationTab)}>
            <TabsList>
              <TabsTrigger value="geral">Dados gerais</TabsTrigger>
              <TabsTrigger value="clusters" count={tree.clusters.length}>Clusters</TabsTrigger>
              <TabsTrigger value="perguntas" count={tree.clusters.reduce((n, c) => n + c.questions.length, 0)}>Perguntas</TabsTrigger>
              <TabsTrigger value="operacoes">Operações</TabsTrigger>
              <TabsTrigger value="tipos">Tipos de equipamento</TabsTrigger>
              <TabsTrigger value="previa">Pré-visualização</TabsTrigger>
              <TabsTrigger value="historico">Histórico</TabsTrigger>
            </TabsList>

            <TabsContent value="geral">
              <GeneralTab
                key={version.id}
                tree={tree}
                summary={summary}
                app={overview.app}
                canEdit={canEdit}
                actions={actions}
                onSaved={refreshAll}
              />
            </TabsContent>

            <TabsContent value="clusters">
              <ClustersTab tree={tree} canEdit={canEdit} actions={actions} onChanged={refreshAll} />
            </TabsContent>

            <TabsContent value="perguntas">
              <QuestionsTab
                tree={tree}
                overview={overview}
                canEdit={canEdit}
                canManageRules={perms.manageRules && isDraft}
                showRules={perms.manageRules}
                actions={actions}
                onChanged={refreshAll}
              />
            </TabsContent>

            <TabsContent value="operacoes">
              {overview.app ? (
                <ApplicationLinksPanel
                  mode="app-operations"
                  targetId={overview.app.id}
                  links={links}
                  canManage={perms.manageOperationLinks}
                  canViewHistory
                  loader={linksLoader}
                  title="Operações habilitadas"
                  description="As operações que podem executar o Check List de Frota. A versão publicada vale para todas elas; a aplicabilidade por operação é definida pergunta a pergunta."
                />
              ) : null}
            </TabsContent>

            <TabsContent value="tipos">
              {overview.app ? (
                <ApplicationLinksPanel
                  mode="app-vehicle-types"
                  targetId={overview.app.id}
                  links={links}
                  canManage={perms.manageEquipmentLinks}
                  canViewHistory
                  loader={linksLoader}
                  title="Tipos de equipamento habilitados"
                  description="Os tipos cujos veículos podem ser inspecionados pelo aplicativo. As perguntas podem ainda restringir por tipo ou subcategoria."
                />
              ) : null}
            </TabsContent>

            <TabsContent value="previa">
              <PreviewPanel
                key={version.id}
                versionId={version.id}
                versionLabel={version.label}
                operations={overview.operations}
                vehicleTypes={overview.vehicleTypes}
                actions={actions}
                today={today}
              />
            </TabsContent>

            <TabsContent value="historico">
              <HistoryTab versions={versions} selectedId={versionId} onSelect={selectVersion} />
            </TabsContent>
          </Tabs>
        ) : null}
      </PageContent>

      <NewVersionDialog
        open={newVersionOpen}
        onOpenChange={setNewVersionOpen}
        baseLabel={published?.label ?? null}
        actions={actions}
        onCreated={(result) => void onVersionCreated(result)}
      />

      {version ? (
        <PublishDialog
          open={publishOpen}
          onOpenChange={setPublishOpen}
          versionId={version.id}
          versionLabel={version.label}
          actions={actions}
          onPublished={(result) => void onPublished(result)}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Dados gerais
// ---------------------------------------------------------------------------
function GeneralTab({
  tree,
  summary,
  app,
  canEdit,
  actions,
  onSaved,
}: {
  tree: ChecklistVersionTree;
  summary: AdminVersionSummary | null;
  app: ChecklistAdminOverview["app"];
  canEdit: boolean;
  actions: ChecklistAdminActions;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const { version } = tree;
  const [notes, setNotes] = React.useState(version.notes ?? "");
  const [minSeconds, setMinSeconds] = React.useState(String(version.minDurationSeconds));
  const [maxSeconds, setMaxSeconds] = React.useState(String(version.maxDurationSeconds));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const activeQuestions = tree.clusters.reduce(
    (n, c) => n + c.questions.filter((q) => q.status === "active").length,
    0,
  );
  const conditionals = tree.clusters.reduce(
    (n, c) => n + c.questions.reduce((m, q) => m + q.conditionals.length, 0),
    0,
  );
  const rules = tree.clusters.reduce((n, c) => n + c.questions.reduce((m, q) => m + q.rules.length, 0), 0);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const result = await actions.updateVersion({
      id: version.id,
      notes: notes.trim() || null,
      minDurationSeconds: Number(minSeconds),
      maxDurationSeconds: Number(maxSeconds),
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Não foi possível salvar os dados da versão.");
      return;
    }
    toast({ title: "Dados da versão salvos.", variant: "success" });
    await onSaved();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Clusters" value={number.format(tree.clusters.length)} icon={<Layers />} />
        <KpiCard label="Perguntas ativas" value={number.format(activeQuestions)} icon={<ListChecks />} />
        <KpiCard label="Condicionais · regras" value={`${number.format(conditionals)} · ${number.format(rules)}`} />
        <KpiCard label="Execuções nesta versão" value={number.format(summary?.executions ?? 0)} icon={<ClipboardList />} />
      </div>

      <Card>
        <CardHeader
          title={`Versão ${version.label}`}
          description={
            version.sourceNote
              ? version.sourceNote
              : version.status === "draft"
                ? "Rascunho em edição. Nada aqui vale para o motorista até a publicação."
                : undefined
          }
        />
        <CardContent className="flex flex-col gap-4 p-4 pt-0">
          {error ? (
            <Alert variant="danger">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <dl className="grid gap-x-6 gap-y-1 text-body-sm sm:grid-cols-3">
            <div>
              <dt className="text-caption text-fg-muted">Criada em</dt>
              <dd className="text-fg">{formatDateTime(version.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-caption text-fg-muted">Última alteração</dt>
              <dd className="text-fg">{formatDateTime(version.updatedAt)}</dd>
            </div>
            <div>
              <dt className="text-caption text-fg-muted">Publicada em</dt>
              <dd className="text-fg">{formatDateTime(version.publishedAt)}</dd>
            </div>
          </dl>

          <FormField label="Notas da versão" id="versao-notas" helperText="O que muda nesta versão e por quê. Fica no histórico.">
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} disabled={!canEdit} />
          </FormField>

          <FormGrid columns={2}>
            <FormField label="Tempo mínimo (segundos)" id="versao-min" helperText="Abaixo disso o envio pede confirmação: um checklist rápido demais costuma não ter sido feito.">
              <Input type="number" min={0} inputMode="numeric" value={minSeconds} onChange={(e) => setMinSeconds(e.target.value)} disabled={!canEdit} />
            </FormField>
            <FormField label="Tempo máximo (segundos)" id="versao-max" helperText="Deve ser maior que o mínimo.">
              <Input type="number" min={1} inputMode="numeric" value={maxSeconds} onChange={(e) => setMaxSeconds(e.target.value)} disabled={!canEdit} />
            </FormField>
          </FormGrid>

          {canEdit ? (
            <div className="flex justify-end">
              <Button leadingIcon={<Save />} onClick={() => void save()} loading={saving}>
                Salvar dados gerais
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Alert variant="info" data-testid="politica-anexos">
        <AlertTitle>Sem anexos, por decisão</AlertTitle>
        <AlertDescription>
          Este formulário não admite anexos: nenhuma pergunta aceita fotografia, upload de arquivo
          ou uso de câmera, e não existe opção para habilitar isso nesta tela (§26, §42). O que
          o motorista informa a mais é o campo condicional e a observação em texto.
        </AlertDescription>
      </Alert>

      {app?.allowsAttachments ? (
        <Alert variant="danger">
          <AlertTitle>Cadastro do aplicativo incompatível</AlertTitle>
          <AlertDescription>
            O aplicativo está marcado no cadastro como se permitisse arquivos. O executor não os
            aceita e a publicação é recusada até a correção no cadastro do aplicativo.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Clusters
// ---------------------------------------------------------------------------
function ClustersTab({
  tree,
  canEdit,
  actions,
  onChanged,
}: {
  tree: ChecklistVersionTree;
  canEdit: boolean;
  actions: ChecklistAdminActions;
  onChanged: () => Promise<void>;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [dialog, setDialog] = React.useState<{ open: boolean; cluster: AdminCluster | null }>({ open: false, cluster: null });
  const [busy, setBusy] = React.useState(false);

  const move = async (index: number, delta: number) => {
    const ids = swapIds(tree.clusters, index, delta);
    if (!ids || busy) return;
    setBusy(true);
    const result = await actions.reorderClusters(tree.version.id, ids);
    setBusy(false);
    if (!result.ok) {
      toast({ title: result.error ?? "Não foi possível reordenar os clusters.", variant: "danger" });
      return;
    }
    await onChanged();
  };

  const remove = async (cluster: AdminCluster) => {
    const ok = await confirm({
      title: `Excluir o cluster “${cluster.name}”?`,
      description: "Só é possível excluir um cluster sem perguntas. A exclusão vale apenas para este rascunho.",
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    const result = await actions.deleteCluster(cluster.id);
    setBusy(false);
    if (!result.ok) {
      toast({ title: result.error ?? "Não foi possível excluir o cluster.", variant: "danger" });
      return;
    }
    toast({ title: `Cluster “${cluster.name}” excluído.`, variant: "success" });
    await onChanged();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-3xl text-body-sm text-fg-secondary">
          Cada cluster é uma etapa do checklist, na ordem em que o motorista a percorre. A chave é
          derivada do nome na criação e não muda depois.
        </p>
        {canEdit ? (
          <Button size="sm" leadingIcon={<Plus />} onClick={() => setDialog({ open: true, cluster: null })}>
            Novo cluster
          </Button>
        ) : null}
      </div>

      <TableContainer>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Cluster</TableHead>
              <TableHead>Chave</TableHead>
              <TableHead>Obrigatório</TableHead>
              <TableHead align="right">Perguntas</TableHead>
              <TableHead align="right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tree.clusters.length === 0 ? (
              <TableEmpty colSpan={6} message="Nenhum cluster nesta versão. Crie o primeiro para começar a montar o formulário." />
            ) : (
              tree.clusters.map((cluster, index) => (
                <TableRow key={cluster.id}>
                  <TableCell className="tabular-nums text-fg-muted">{index + 1}</TableCell>
                  <TableCell className="font-medium text-fg">{cluster.name}</TableCell>
                  <TableCell className="font-mono text-caption text-fg-muted">{cluster.clusterKey}</TableCell>
                  <TableCell>
                    {cluster.isRequired ? <Badge variant="primary">Obrigatório</Badge> : <Badge variant="neutral">Opcional</Badge>}
                  </TableCell>
                  <TableCell align="right" className="tabular-nums">
                    {number.format(cluster.questions.length)}
                  </TableCell>
                  <TableCell align="right">
                    <div className="flex items-center justify-end gap-1">
                      <IconButton label={`Mover ${cluster.name} para cima`} size="sm" onClick={() => void move(index, -1)} disabled={!canEdit || busy || index === 0}>
                        <ArrowUp aria-hidden />
                      </IconButton>
                      <IconButton label={`Mover ${cluster.name} para baixo`} size="sm" onClick={() => void move(index, 1)} disabled={!canEdit || busy || index === tree.clusters.length - 1}>
                        <ArrowDown aria-hidden />
                      </IconButton>
                      <IconButton label={`Editar ${cluster.name}`} size="sm" onClick={() => setDialog({ open: true, cluster })} disabled={!canEdit || busy}>
                        <Pencil aria-hidden />
                      </IconButton>
                      <IconButton label={`Excluir ${cluster.name}`} size="sm" onClick={() => void remove(cluster)} disabled={!canEdit || busy}>
                        <Trash2 aria-hidden />
                      </IconButton>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <ClusterDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        versionId={tree.version.id}
        cluster={dialog.cluster}
        actions={actions}
        onSaved={() => {
          setDialog({ open: false, cluster: null });
          toast({ title: dialog.cluster ? "Cluster salvo." : "Cluster criado.", variant: "success" });
          void onChanged();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Perguntas
// ---------------------------------------------------------------------------
function QuestionsTab({
  tree,
  overview,
  canEdit,
  canManageRules,
  showRules,
  actions,
  onChanged,
}: {
  tree: ChecklistVersionTree;
  overview: ChecklistAdminOverview;
  canEdit: boolean;
  canManageRules: boolean;
  showRules: boolean;
  actions: ChecklistAdminActions;
  onChanged: () => Promise<void>;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [drawer, setDrawer] = React.useState<{ open: boolean; questionId: string | null; clusterId: string | null }>({
    open: false, questionId: null, clusterId: null,
  });
  const [busy, setBusy] = React.useState(false);

  const drawerQuestion = React.useMemo(
    () => tree.clusters.flatMap((c) => c.questions).find((q) => q.id === drawer.questionId) ?? null,
    [tree, drawer.questionId],
  );

  const move = async (cluster: AdminCluster, index: number, delta: number) => {
    const ids = swapIds(cluster.questions, index, delta);
    if (!ids || busy) return;
    setBusy(true);
    const result = await actions.reorderQuestions(cluster.id, ids);
    setBusy(false);
    if (!result.ok) {
      toast({ title: result.error ?? "Não foi possível reordenar as perguntas.", variant: "danger" });
      return;
    }
    await onChanged();
  };

  const remove = async (question: AdminQuestion) => {
    const ok = await confirm({
      title: "Excluir a pergunta?",
      description: `“${question.questionText}” sai deste rascunho. Se a intenção é parar de perguntar sem perder a comparação, prefira inativá-la.`,
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    const result = await actions.deleteQuestion(question.id);
    setBusy(false);
    if (!result.ok) {
      toast({ title: result.error ?? "Não foi possível excluir a pergunta.", variant: "danger" });
      return;
    }
    toast({ title: "Pergunta excluída.", variant: "success" });
    await onChanged();
  };

  if (tree.clusters.length === 0) {
    return (
      <EmptyState
        icon={<Layers />}
        title="Nenhum cluster nesta versão"
        description="As perguntas pertencem a um cluster. Crie o primeiro na aba Clusters."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-body-sm text-fg-secondary">
        A conformidade é por pergunta: cada uma declara qual resposta é a conforme. A identidade
        técnica liga a pergunta ao histórico e só muda quando declarado (§47).
      </p>

      {tree.clusters.map((cluster) => (
        <Card key={cluster.id}>
          <CardHeader
            title={cluster.name}
            description={`${cluster.clusterKey} · ${number.format(cluster.questions.length)} pergunta(s)`}
            actions={
              canEdit ? (
                <Button size="sm" variant="secondary" leadingIcon={<Plus />} onClick={() => setDrawer({ open: true, questionId: null, clusterId: cluster.id })}>
                  Nova pergunta
                </Button>
              ) : undefined
            }
          />
          <CardContent className="p-4 pt-0">
            {cluster.questions.length === 0 ? (
              <p className="text-body-sm text-fg-muted">Nenhuma pergunta neste cluster. Um cluster sem pergunta ativa impede a publicação.</p>
            ) : (
              <ol className="flex flex-col gap-2" aria-label={`Perguntas do cluster ${cluster.name}`}>
                {cluster.questions.map((question, index) => (
                  <li key={question.id} className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 gap-3">
                      <span className="w-6 shrink-0 pt-0.5 text-body-sm tabular-nums text-fg-muted">{index + 1}.</span>
                      <div className="min-w-0">
                        <p className="text-body font-medium text-fg">{question.questionText}</p>
                        <p className="font-mono text-caption text-fg-muted" data-testid="question-key">{question.questionKey}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          <Badge variant={question.conformingAnswer === "yes" ? "success" : "highlight"} size="sm">
                            Conforme: {ANSWER_LABEL[question.conformingAnswer]}
                          </Badge>
                          <Badge variant={question.criticality === "critica" ? "danger" : "neutral"} size="sm">
                            {CRITICALITY_LABEL[question.criticality]}
                          </Badge>
                          {!question.isRequired ? <Badge variant="neutral" size="sm">Opcional</Badge> : null}
                          {question.noteRequired ? <Badge variant="neutral" size="sm">Observação obrigatória</Badge> : null}
                          {question.conditionals.length > 0 ? <Badge variant="info" size="sm">Campo condicional</Badge> : null}
                          {question.rules.length > 0 ? (
                            <Badge variant="accent" size="sm">{number.format(question.rules.length)} regra(s)</Badge>
                          ) : null}
                          {question.status === "inactive" ? <Badge variant="warning" size="sm">Inativa</Badge> : null}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 self-end sm:self-start">
                      <IconButton label={`Mover para cima: ${question.questionText}`} size="sm" onClick={() => void move(cluster, index, -1)} disabled={!canEdit || busy || index === 0}>
                        <ArrowUp aria-hidden />
                      </IconButton>
                      <IconButton label={`Mover para baixo: ${question.questionText}`} size="sm" onClick={() => void move(cluster, index, 1)} disabled={!canEdit || busy || index === cluster.questions.length - 1}>
                        <ArrowDown aria-hidden />
                      </IconButton>
                      <Button size="sm" variant="secondary" leadingIcon={<Pencil />} aria-label={`${canEdit ? "Editar" : "Consultar"}: ${question.questionText}`} onClick={() => setDrawer({ open: true, questionId: question.id, clusterId: cluster.id })}>
                        {canEdit ? "Editar" : "Consultar"}
                      </Button>
                      <IconButton label={`Excluir: ${question.questionText}`} size="sm" onClick={() => void remove(question)} disabled={!canEdit || busy}>
                        <Trash2 aria-hidden />
                      </IconButton>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      ))}

      <QuestionDrawer
        open={drawer.open}
        onOpenChange={(open) => setDrawer((d) => ({ ...d, open }))}
        versionId={tree.version.id}
        clusters={tree.clusters}
        question={drawerQuestion}
        defaultClusterId={drawer.clusterId}
        vehicleTypes={overview.vehicleTypes}
        operations={overview.operations}
        canEdit={canEdit}
        canManageRules={canManageRules}
        showRules={showRules}
        actions={actions}
        onChanged={onChanged}
        onCreated={(questionId) => setDrawer((d) => ({ ...d, questionId }))}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Histórico de versões
// ---------------------------------------------------------------------------
function HistoryTab({
  versions,
  selectedId,
  onSelect,
}: {
  versions: AdminVersionSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <TableContainer>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Versão</TableHead>
            <TableHead>Situação</TableHead>
            <TableHead align="right">Clusters</TableHead>
            <TableHead align="right">Perguntas</TableHead>
            <TableHead align="right">Execuções</TableHead>
            <TableHead>Publicada em</TableHead>
            <TableHead>Criada em</TableHead>
            <TableHead>Notas</TableHead>
            <TableHead align="right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {versions.length === 0 ? (
            <TableEmpty colSpan={9} message="Nenhuma versão registrada." />
          ) : (
            versions.map((v) => (
              <TableRow key={v.id} data-state={v.id === selectedId ? "selected" : undefined}>
                <TableCell className="font-medium text-fg">{v.label}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[v.status]} appearance="soft" dot>{STATUS_LABEL[v.status]}</Badge>
                </TableCell>
                <TableCell align="right" className="tabular-nums">{number.format(v.clusters)}</TableCell>
                <TableCell align="right" className="tabular-nums">{number.format(v.questions)}</TableCell>
                <TableCell align="right" className="tabular-nums">{number.format(v.executions)}</TableCell>
                <TableCell className="tabular-nums">{formatDateTime(v.publishedAt)}</TableCell>
                <TableCell className="tabular-nums">{formatDateTime(v.createdAt)}</TableCell>
                <TableCell className="max-w-xs truncate text-fg-secondary" title={v.notes ?? undefined}>
                  {v.notes ?? v.sourceNote ?? "—"}
                </TableCell>
                <TableCell align="right">
                  <Button size="sm" variant="ghost" onClick={() => onSelect(v.id)} disabled={v.id === selectedId}>
                    {v.id === selectedId ? "Selecionada" : "Abrir"}
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
