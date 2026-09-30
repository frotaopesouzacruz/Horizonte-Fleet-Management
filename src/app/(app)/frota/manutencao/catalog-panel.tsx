"use client";

import * as React from "react";
import { Archive, ClipboardList, Copy, Eye, Gauge, Layers, Link2, Lock, Pencil, Plus, Settings2, Store, Wrench } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SearchField } from "@/components/ui/search-field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { useConfirm } from "@/components/feedback/confirm-dialog";
import { useToast } from "@/components/feedback/toast";
import { NativeSelect } from "@/components/governance/selects";
import { cn } from "@/lib/cn";
import { CriticalityBadge, PlanStatusBadge } from "@/components/maintenance/badges";
import {
  archiveMaintenanceCluster, archiveMaintenanceService, archiveMaintenanceSupplier, archivePreventiveRule,
} from "@/lib/maintenance/actions";
import type { MaintenanceFilterOptions } from "@/lib/maintenance/queries";
import {
  formatHours, formatInt, formatKm, PLAN_SOURCE_LABEL, PLAN_STATUS_LABEL,
  type MaintenanceCatalog, type MaintenanceCluster, type MaintenanceOrigin, type MaintenanceParameters,
  type MaintenanceService, type MaintenanceSupplier, type PlanStatus, type PredictivePlan, type PreventiveRule,
} from "@/lib/maintenance/types";
import {
  agingLabels, ClusterFormDrawer, formatDocument, numberText, OriginFormDrawer, PreventiveRuleFormDrawer, safeCall,
  SETTING_FIELDS, SettingsFormDrawer, SituationBadge, SupplierFormDrawer,
} from "./catalog-forms";
import { ServiceFormDrawer } from "./catalog-forms-service";
import {
  DuplicatePlanDialog, planApplicability, planYears, PredictivePlanDetailDrawer, PredictivePlanFormDrawer,
} from "./catalog-forms-predictive";
import { CATALOG_SECTIONS, type CatalogSection, type MaintenancePerms, type PanelActions } from "./shared";

/**
 * Manutenção → Cadastros.
 *
 * Sete seções numa aba, a seção na URL (`secao`). O catálogo (clusters,
 * serviços, fornecedores, origens, configurações) chega com a página; os
 * parâmetros preventivos e os planos preditivos só nas duas seções que os
 * usam. Cada seção fica em modo leitura para quem não tem a permissão de
 * gestão correspondente — a tela esconde, o banco decide.
 */

export interface CatalogPanelProps {
  cadastros: { section: CatalogSection; parameters: MaintenanceParameters | null };
  catalog: MaintenanceCatalog;
  options: MaintenanceFilterOptions;
  perms: MaintenancePerms;
  actions: PanelActions;
}

const SECTION_LABEL: Record<CatalogSection, string> = {
  clusters: "Clusters",
  servicos: "Serviços",
  fornecedores: "Fornecedores",
  preventiva: "Parâmetros preventivos",
  preditiva: "Planos preditivos",
  origens: "Origens",
  configuracoes: "Configurações",
};

const norm = (value: string | null | undefined) =>
  (value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const matches = (q: string, fields: (string | null | undefined)[]) => {
  const needle = norm(q.trim());
  return !needle || fields.some((f) => norm(f).includes(needle));
};

export function CatalogPanel({ cadastros, catalog, options, perms, actions }: CatalogPanelProps) {
  const { section, parameters } = cadastros;
  const counts: Partial<Record<CatalogSection, number>> = {
    clusters: catalog.clusters.length,
    servicos: catalog.services.length,
    fornecedores: catalog.suppliers.length,
    origens: catalog.origins.length,
  };

  return (
    <div className="flex flex-col gap-4" data-testid="maintenance-catalog">
      <Tabs
        appearance="segmented"
        value={section}
        activationMode="manual"
        onValueChange={(value) => actions.navigate({ secao: value, pagina: null })}
      >
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList aria-label="Seções do cadastro" className="w-max">
            {CATALOG_SECTIONS.map((s) => (
              <TabsTrigger key={s} value={s} count={counts[s]} data-testid={`maintenance-catalog-section-${s}`}>
                {SECTION_LABEL[s]}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* Só a seção aberta é montada; o conteúdo fica dentro do TabsContent
            para que o aria-controls da aba ativa aponte para algo que existe. */}
        <TabsContent value={section} className="flex flex-col gap-4">
        {section === "clusters" ? <ClustersSection catalog={catalog} canManage={perms.manageClusters} actions={actions} /> : null}
        {section === "servicos" ? (
          <ServicesSection catalog={catalog} options={options} canManage={perms.manageServices} actions={actions} />
        ) : null}
        {section === "fornecedores" ? (
          <SuppliersSection catalog={catalog} options={options} canManage={perms.manageSuppliers} actions={actions} />
        ) : null}
        {section === "preventiva" ? (
          <PreventiveSection
            rules={parameters?.preventiveRules ?? null}
            catalog={catalog}
            options={options}
            canManage={perms.manageParameters}
            actions={actions}
          />
        ) : null}
        {section === "preditiva" ? (
          <PredictiveSection
            plans={parameters?.predictivePlans ?? null}
            catalog={catalog}
            options={options}
            canManage={perms.managePredictive}
            actions={actions}
          />
        ) : null}
        {section === "origens" ? <OriginsSection catalog={catalog} canManage={perms.manageParameters} actions={actions} /> : null}
        {section === "configuracoes" ? (
          <SettingsSection catalog={catalog} canManage={perms.manageParameters} actions={actions} />
        ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Peças da aba
// ---------------------------------------------------------------------------
function SectionHeader({
  title,
  description,
  canManage,
  actions,
}: {
  title: string;
  description: React.ReactNode;
  canManage: boolean;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-h3 font-semibold text-fg">{title}</h2>
          {!canManage ? (
            <Badge variant="neutral" size="sm" icon={<Lock aria-hidden />}>
              Somente leitura
            </Badge>
          ) : null}
        </div>
        <p className="mt-0.5 max-w-3xl text-body-sm text-fg-secondary">{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

function Toolbar({ children, summary }: { children: React.ReactNode; summary?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      {children}
      {summary ? <p className="ml-auto text-caption text-fg-muted" aria-live="polite">{summary}</p> : null}
    </div>
  );
}

function ToolbarField({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 ${className ?? ""}`}>
      <span className="text-caption text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

function StatusFilter({ value, onChange, feminine = false }: { value: string; onChange: (v: string) => void; feminine?: boolean }) {
  return (
    <ToolbarField label="Situação">
      <NativeSelect fieldSize="sm" value={value} onChange={(e) => onChange(e.target.value)} className="min-w-[8.5rem]">
        <option value="">{feminine ? "Todas" : "Todos"}</option>
        <option value="active">{feminine ? "Ativas" : "Ativos"}</option>
        <option value="inactive">{feminine ? "Inativas" : "Inativos"}</option>
      </NativeSelect>
    </ToolbarField>
  );
}

function RowActions({
  name,
  canManage,
  busy,
  onOpen,
  onArchive,
  archiveLabel = "Inativar",
}: {
  name: string;
  canManage: boolean;
  busy?: boolean;
  onOpen: () => void;
  onArchive?: () => void;
  archiveLabel?: string;
}) {
  return (
    <div className="flex items-center justify-end gap-0.5" aria-busy={busy || undefined}>
      <IconButton size="sm" label={`${canManage ? "Editar" : "Ver"} ${name}`} onClick={onOpen}>
        {canManage ? <Pencil aria-hidden /> : <Eye aria-hidden />}
      </IconButton>
      {canManage && onArchive ? (
        <IconButton size="sm" variant="danger" label={`${archiveLabel} ${name}`} onClick={onArchive} disabled={busy}>
          <Archive aria-hidden />
        </IconButton>
      ) : null}
    </div>
  );
}

/**
 * Inativar = arquivar no banco: o registro sai do cadastro e das escolhas,
 * o histórico continua com ele. A mensagem de recusa vem do banco.
 */
function useArchive(actions: PanelActions) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const run = async (options: {
    id: string;
    title: string;
    description: string;
    call: () => Promise<{ ok: boolean; error?: string }>;
    success: string;
    fallback: string;
  }) => {
    const ok = await confirm({ title: options.title, description: options.description, confirmLabel: "Inativar", destructive: true });
    if (!ok) return;
    setBusyId(options.id);
    const result = await safeCall(options.call, options.fallback);
    setBusyId(null);
    if (!result.ok) {
      toast({ title: result.error ?? options.fallback, variant: "danger" });
      return;
    }
    toast({ title: options.success, variant: "success" });
    actions.refresh();
  };
  return { busyId, run };
}

// ---------------------------------------------------------------------------
// Clusters
// ---------------------------------------------------------------------------
function ClustersSection({ catalog, canManage, actions }: { catalog: MaintenanceCatalog; canManage: boolean; actions: PanelActions }) {
  const [form, setForm] = React.useState<{ open: boolean; cluster: MaintenanceCluster | null }>({ open: false, cluster: null });
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("");
  const archive = useArchive(actions);
  const rows = catalog.clusters.filter(
    (c) => (!status || c.status === status) && matches(q, [c.name, c.code, c.description]),
  );

  return (
    <section className="flex flex-col gap-4" data-testid="maintenance-catalog-clusters">
      <SectionHeader
        title="Clusters técnicos"
        description="Agrupadores técnicos dos serviços. O identificador técnico é fixo depois de criado; inativar só é aceito sem serviços nem itens preditivos ativos no cluster."
        canManage={canManage}
        actions={
          canManage ? (
            <Button leadingIcon={<Plus />} onClick={() => setForm({ open: true, cluster: null })} data-testid="maintenance-cluster-new">
              Novo cluster
            </Button>
          ) : undefined
        }
      />
      {catalog.clusters.length === 0 ? (
        <EmptyState
          variant="panel"
          icon={<Layers />}
          title="Nenhum cluster cadastrado"
          description="Os clusters vêm primeiro: todo serviço pertence a um. Cadastre aqui ou importe a planilha de clusters na aba Importações."
          action={canManage ? <Button leadingIcon={<Plus />} onClick={() => setForm({ open: true, cluster: null })}>Novo cluster</Button> : undefined}
        />
      ) : (
        <>
          <Toolbar summary={`${formatInt(rows.length)} de ${formatInt(catalog.clusters.length)} cluster(s)`}>
            <ToolbarField label="Buscar" className="w-full sm:w-64">
              <SearchField size="sm" aria-label="Buscar cluster por nome ou código" value={q} onValueChange={setQ} placeholder="Nome ou código" />
            </ToolbarField>
            <StatusFilter value={status} onChange={setStatus} />
          </Toolbar>
          <TableContainer tabIndex={0} stickyHeader maxHeight="70vh">
            <Table layout="fixed" style={{ minWidth: 820 }}>
              <TableHeader>
                <TableRow>
                  <TableHead style={{ width: 150 }}>Código</TableHead>
                  <TableHead style={{ width: 260 }}>Nome</TableHead>
                  <TableHead style={{ width: 150 }}>Criticidade padrão</TableHead>
                  <TableHead style={{ width: 100 }} numeric>Serviços</TableHead>
                  <TableHead style={{ width: 100 }}>Situação</TableHead>
                  <TableHead style={{ width: 80 }}><span className="sr-only">Ações</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableEmpty
                    colSpan={6}
                    message={catalog.clusters.length === 0 ? "Nenhum cluster cadastrado. Cadastre os clusters antes dos serviços." : "Nenhum cluster corresponde à busca."}
                  />
                ) : (
                  rows.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell truncate className="font-mono text-caption" title={c.code}>{c.code}</TableCell>
                      <TableCell>
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-medium" title={c.name}>{c.name}</span>
                          {c.description ? <span className="truncate text-caption text-fg-muted" title={c.description}>{c.description}</span> : null}
                        </div>
                      </TableCell>
                      <TableCell><CriticalityBadge value={c.defaultCriticality} /></TableCell>
                      <TableCell numeric>{formatInt(c.services)}</TableCell>
                      <TableCell><SituationBadge active={c.status === "active"} /></TableCell>
                      <TableCell>
                        <RowActions
                          name={`cluster ${c.name}`}
                          canManage={canManage}
                          busy={archive.busyId === c.id}
                          onOpen={() => setForm({ open: true, cluster: c })}
                          onArchive={() =>
                            void archive.run({
                              id: c.id,
                              title: `Inativar o cluster ${c.name}?`,
                              description:
                                "O cluster sai do cadastro e das listas de escolha; manutenções antigas continuam mostrando o nome. O banco recusa enquanto houver serviços no cluster ou itens ativos de plano preditivo.",
                              call: () => archiveMaintenanceCluster(c.id),
                              success: `Cluster ${c.name} inativado.`,
                              fallback: "Não foi possível inativar o cluster.",
                            })
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
      <ClusterFormDrawer
        open={form.open}
        cluster={form.cluster}
        readOnly={!canManage}
        onOpenChange={(open) => setForm((s) => ({ ...s, open }))}
        onSaved={actions.refresh}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Serviços
// ---------------------------------------------------------------------------
function ServicesSection({
  catalog,
  options,
  canManage,
  actions,
}: {
  catalog: MaintenanceCatalog;
  options: MaintenanceFilterOptions;
  canManage: boolean;
  actions: PanelActions;
}) {
  const [form, setForm] = React.useState<{ open: boolean; service: MaintenanceService | null }>({ open: false, service: null });
  const [q, setQ] = React.useState("");
  const [cluster, setCluster] = React.useState("");
  const [status, setStatus] = React.useState("");
  const archive = useArchive(actions);
  const typeName = React.useMemo(() => new Map(catalog.types.map((t) => [t.code, t.name])), [catalog.types]);
  const rows = catalog.services.filter(
    (s) =>
      (!cluster || s.clusterId === cluster) &&
      (!status || s.status === status) &&
      matches(q, [s.name, s.clusterName, s.description, ...(s.aliasNames ?? [])]),
  );

  return (
    <section className="flex flex-col gap-4" data-testid="maintenance-catalog-services">
      <SectionHeader
        title="Serviços"
        description="O que se lança numa manutenção. Cada serviço pertence a um cluster e pode ser vinculado a perguntas do Check List: um apontamento inconforme sugere o serviço — a mesma relação que o Plano de Ação usará."
        canManage={canManage}
        actions={
          canManage ? (
            <Button
              leadingIcon={<Plus />}
              onClick={() => setForm({ open: true, service: null })}
              disabled={catalog.clusters.length === 0}
              title={catalog.clusters.length === 0 ? "Cadastre um cluster antes." : undefined}
              data-testid="maintenance-service-new"
            >
              Novo serviço
            </Button>
          ) : undefined
        }
      />
      {catalog.services.length === 0 ? (
        <EmptyState
          variant="panel"
          icon={<Wrench />}
          title="Nenhum serviço cadastrado"
          description={
            catalog.clusters.length === 0
              ? "Cadastre os clusters antes: todo serviço pertence a um cluster técnico."
              : "Sem serviços, nenhuma manutenção pode ser aberta. Cadastre aqui ou importe a planilha de serviços."
          }
          action={
            canManage && catalog.clusters.length > 0 ? (
              <Button leadingIcon={<Plus />} onClick={() => setForm({ open: true, service: null })}>Novo serviço</Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Toolbar summary={`${formatInt(rows.length)} de ${formatInt(catalog.services.length)} serviço(s)`}>
            <ToolbarField label="Buscar" className="w-full sm:w-64">
              <SearchField size="sm" aria-label="Buscar serviço" value={q} onValueChange={setQ} placeholder="Serviço ou cluster" />
            </ToolbarField>
            <ToolbarField label="Cluster">
              <NativeSelect fieldSize="sm" value={cluster} onChange={(e) => setCluster(e.target.value)} className="min-w-[11rem]">
                <option value="">Todos</option>
                {catalog.clusters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </ToolbarField>
            <StatusFilter value={status} onChange={setStatus} />
          </Toolbar>
          <TableContainer tabIndex={0} stickyHeader maxHeight="70vh">
            <Table layout="fixed" style={{ minWidth: 1180 }}>
              <TableHeader>
                <TableRow>
                  <TableHead style={{ width: 150 }}>Cluster</TableHead>
                  <TableHead style={{ width: 240 }}>Serviço</TableHead>
                  <TableHead style={{ width: 200 }}>Tipos aplicáveis</TableHead>
                  <TableHead style={{ width: 110 }}>Criticidade</TableHead>
                  <TableHead style={{ width: 120 }} numeric>Horas previstas</TableHead>
                  <TableHead style={{ width: 90 }}>Preditivo</TableHead>
                  <TableHead style={{ width: 100 }} numeric>Check List</TableHead>
                  <TableHead style={{ width: 90 }}>Situação</TableHead>
                  <TableHead style={{ width: 80 }}><span className="sr-only">Ações</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableEmpty
                    colSpan={9}
                    message={catalog.services.length === 0 ? "Nenhum serviço cadastrado." : "Nenhum serviço corresponde aos filtros."}
                  />
                ) : (
                  rows.map((s) => {
                    const types = s.maintenanceTypeCodes.length
                      ? s.maintenanceTypeCodes.map((c) => typeName.get(c) ?? c).join(", ")
                      : "Todos";
                    return (
                      <TableRow key={s.id}>
                        <TableCell truncate title={s.clusterName}>{s.clusterName}</TableCell>
                        <TableCell truncate className="font-medium" title={s.description ? `${s.name} — ${s.description}` : s.name}>
                          {s.name}
                        </TableCell>
                        <TableCell truncate title={types} className={s.maintenanceTypeCodes.length ? undefined : "text-fg-muted"}>
                          {types}
                        </TableCell>
                        <TableCell><CriticalityBadge value={s.criticality} /></TableCell>
                        <TableCell numeric>{formatHours(s.expectedHours)}</TableCell>
                        <TableCell>{s.isPredictive ? "Sim" : <span className="text-fg-muted">Não</span>}</TableCell>
                        <TableCell numeric>
                          {s.checklistLinks.length ? (
                            <span className="inline-flex items-center gap-1" title="Perguntas do Check List vinculadas">
                              <Link2 className="size-3.5 text-fg-muted" aria-hidden />
                              {formatInt(s.checklistLinks.length)}
                            </span>
                          ) : (
                            <span className="text-fg-muted">0</span>
                          )}
                        </TableCell>
                        <TableCell><SituationBadge active={s.status === "active"} /></TableCell>
                        <TableCell>
                          <RowActions
                            name={`serviço ${s.name}`}
                            canManage={canManage}
                            busy={archive.busyId === s.id}
                            onOpen={() => setForm({ open: true, service: s })}
                            onArchive={() =>
                              void archive.run({
                                id: s.id,
                                title: `Inativar o serviço ${s.name}?`,
                                description:
                                  "O serviço sai do catálogo e deixa de ser sugerido pelo Check List; manutenções antigas continuam com ele. O banco recusa se um parâmetro preventivo ativo usa o serviço.",
                                call: () => archiveMaintenanceService(s.id),
                                success: `Serviço ${s.name} inativado.`,
                                fallback: "Não foi possível inativar o serviço.",
                              })
                            }
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
      <ServiceFormDrawer
        open={form.open}
        service={form.service}
        catalog={catalog}
        options={options}
        readOnly={!canManage}
        onOpenChange={(open) => setForm((s) => ({ ...s, open }))}
        onSaved={actions.refresh}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Fornecedores
// ---------------------------------------------------------------------------
function SuppliersSection({
  catalog,
  options,
  canManage,
  actions,
}: {
  catalog: MaintenanceCatalog;
  options: MaintenanceFilterOptions;
  canManage: boolean;
  actions: PanelActions;
}) {
  const [form, setForm] = React.useState<{ open: boolean; supplier: MaintenanceSupplier | null }>({ open: false, supplier: null });
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("");
  const archive = useArchive(actions);
  const clusterName = React.useMemo(() => new Map(catalog.clusters.map((c) => [c.id, c.name])), [catalog.clusters]);
  const rows = catalog.suppliers.filter(
    (s) =>
      (!status || s.status === status) &&
      matches(q, [
        s.name, s.tradeName, s.documentNumber, s.cityName, formatDocument(s.documentNumber),
        s.externalCode ?? null, s.category ?? null, s.serviceType ?? null, ...(s.aliasNames ?? []),
      ]),
  );

  return (
    <section className="flex flex-col gap-4" data-testid="maintenance-catalog-suppliers">
      <SectionHeader
        title="Fornecedores"
        description="Oficinas e prestadores. O agendamento e a base de manutenções só aceitam fornecedores cadastrados; o banco valida o CNPJ/CPF (11 ou 14 dígitos)."
        canManage={canManage}
        actions={
          canManage ? (
            <Button leadingIcon={<Plus />} onClick={() => setForm({ open: true, supplier: null })} data-testid="maintenance-supplier-new">
              Novo fornecedor
            </Button>
          ) : undefined
        }
      />
      {catalog.suppliers.length === 0 ? (
        <EmptyState
          variant="panel"
          icon={<Store />}
          title="Nenhum fornecedor cadastrado"
          description="O agendamento e a base de manutenções só aceitam fornecedores cadastrados. Cadastre aqui ou importe a planilha de fornecedores."
          action={canManage ? <Button leadingIcon={<Plus />} onClick={() => setForm({ open: true, supplier: null })}>Novo fornecedor</Button> : undefined}
        />
      ) : (
        <>
          <Toolbar summary={`${formatInt(rows.length)} de ${formatInt(catalog.suppliers.length)} fornecedor(es)`}>
            <ToolbarField label="Buscar" className="w-full sm:w-72">
              <SearchField size="sm" aria-label="Buscar fornecedor" value={q} onValueChange={setQ} placeholder="Nome, outro nome, código, CNPJ ou cidade" />
            </ToolbarField>
            <StatusFilter value={status} onChange={setStatus} />
          </Toolbar>
          <TableContainer tabIndex={0} stickyHeader maxHeight="70vh">
            <Table layout="fixed" style={{ minWidth: 1320 }}>
              <TableHeader>
                <TableRow>
                  <TableHead style={{ width: 280 }}>Nome / fantasia</TableHead>
                  <TableHead style={{ width: 180 }}>Código · CNPJ/CPF</TableHead>
                  <TableHead style={{ width: 220 }}>Categoria · tipo</TableHead>
                  <TableHead style={{ width: 160 }}>Pagamento</TableHead>
                  <TableHead style={{ width: 150 }}>Cidade/UF</TableHead>
                  <TableHead style={{ width: 170 }}>Clusters atendidos</TableHead>
                  <TableHead style={{ width: 100 }}>Situação</TableHead>
                  <TableHead style={{ width: 80 }}><span className="sr-only">Ações</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableEmpty
                    colSpan={8}
                    message={catalog.suppliers.length === 0 ? "Nenhum fornecedor cadastrado." : "Nenhum fornecedor corresponde à busca."}
                  />
                ) : (
                  rows.map((s) => {
                    const clusters = s.clusterIds.map((id) => clusterName.get(id)).filter(Boolean).join(", ");
                    const place = s.cityName ? `${s.cityName}${s.stateUf ? `/${s.stateUf}` : ""}` : s.stateUf ?? "—";
                    return (
                      <TableRow key={s.id}>
                        <TableCell>
                          <div className="flex min-w-0 flex-col">
                            <span className="truncate font-medium" title={s.name}>{s.name}</span>
                            {s.tradeName ? <span className="truncate text-caption text-fg-muted" title={s.tradeName}>{s.tradeName}</span> : null}
                            {s.aliasNames?.length ? (
                              <span className="truncate text-caption text-fg-muted" title={`Outros nomes: ${s.aliasNames.join("; ")}`}>
                                Outros nomes: {s.aliasNames.join("; ")}
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex min-w-0 flex-col tabular-nums">
                            {s.externalCode ? <span className="truncate text-caption text-fg-muted">Cód. {s.externalCode}</span> : null}
                            <span className="truncate">{formatDocument(s.documentNumber)}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex min-w-0 flex-col">
                            <span className={cn("truncate", s.category ? undefined : "text-fg-muted")} title={s.category ?? undefined}>
                              {s.category ?? "Não informada"}
                            </span>
                            {s.serviceType ? <span className="truncate text-caption text-fg-muted" title={s.serviceType}>{s.serviceType}</span> : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex min-w-0 flex-col">
                            <span className={cn("truncate", s.paymentTerms ? undefined : "text-fg-muted")} title={s.paymentTerms ?? undefined}>
                              {s.paymentTerms ?? "—"}
                            </span>
                            {s.financialValidation ? (
                              <span className="truncate text-caption text-fg-muted">Financeiro: {s.financialValidation}</span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell truncate title={place}>{place}</TableCell>
                        <TableCell truncate title={clusters || undefined} className={clusters ? undefined : "text-fg-muted"}>
                          {clusters || "Não informado"}
                        </TableCell>
                        <TableCell><SituationBadge active={s.status === "active"} /></TableCell>
                        <TableCell>
                          <RowActions
                            name={`fornecedor ${s.tradeName || s.name}`}
                            canManage={canManage}
                            busy={archive.busyId === s.id}
                            onOpen={() => setForm({ open: true, supplier: s })}
                            onArchive={() =>
                              void archive.run({
                                id: s.id,
                                title: `Inativar o fornecedor ${s.tradeName || s.name}?`,
                                description:
                                  "O fornecedor sai do cadastro e das escolhas de agendamento; o histórico continua com ele. O banco recusa enquanto houver manutenções agendadas ou em execução com ele.",
                                call: () => archiveMaintenanceSupplier(s.id),
                                success: `Fornecedor ${s.tradeName || s.name} inativado.`,
                                fallback: "Não foi possível inativar o fornecedor.",
                              })
                            }
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
      <SupplierFormDrawer
        open={form.open}
        supplier={form.supplier}
        catalog={catalog}
        options={options}
        readOnly={!canManage}
        onOpenChange={(open) => setForm((s) => ({ ...s, open }))}
        onSaved={actions.refresh}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Parâmetros preventivos
// ---------------------------------------------------------------------------
function PreventiveSection({
  rules,
  catalog,
  options,
  canManage,
  actions,
}: {
  rules: PreventiveRule[] | null;
  catalog: MaintenanceCatalog;
  options: MaintenanceFilterOptions;
  canManage: boolean;
  actions: PanelActions;
}) {
  const [form, setForm] = React.useState<{ open: boolean; rule: PreventiveRule | null }>({ open: false, rule: null });
  const [type, setType] = React.useState("");
  const [status, setStatus] = React.useState("");
  const archive = useArchive(actions);

  const header = (
    <SectionHeader
      title="Parâmetros preventivos"
      description={
        <>
          Intervalo de KM, marco inicial e ciclos que geram os marcos MP1, MP2… de cada veículo. Vale a regra ativa mais
          específica: <strong>modelo</strong> &gt; <strong>subcategoria</strong> &gt; <strong>tipo</strong>. Salvar
          sincroniza os ciclos dos veículos do tipo na hora.
        </>
      }
      canManage={canManage}
      actions={
        canManage && rules ? (
          <Button leadingIcon={<Plus />} onClick={() => setForm({ open: true, rule: null })} data-testid="maintenance-preventive-rule-new">
            Novo parâmetro
          </Button>
        ) : undefined
      }
    />
  );

  if (!rules) {
    return (
      <section className="flex flex-col gap-4" data-testid="maintenance-catalog-preventive">
        {header}
        <ErrorState
          title="Não foi possível carregar os parâmetros preventivos."
          description="Os demais cadastros seguem disponíveis. Tente de novo em instantes."
          onRetry={actions.refresh}
          retryLabel="Tentar de novo"
          retrying={actions.pending}
        />
      </section>
    );
  }

  const types = [...new Map(rules.map((r) => [r.vehicleTypeId, r.vehicleTypeName])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1], "pt-BR"),
  );
  const rows = rules.filter((r) => (!type || r.vehicleTypeId === type) && (!status || r.status === status));

  return (
    <section className="flex flex-col gap-4" data-testid="maintenance-catalog-preventive">
      {header}
      {rules.length === 0 ? (
        <EmptyState
          variant="panel"
          icon={<Gauge />}
          title="Nenhum parâmetro preventivo"
          description="Sem parâmetro, a matriz preventiva mostra os veículos como sem regra. Cadastre por tipo de equipamento ou importe a planilha de parâmetros."
          action={canManage ? <Button leadingIcon={<Plus />} onClick={() => setForm({ open: true, rule: null })}>Novo parâmetro</Button> : undefined}
        />
      ) : (
        <>
          <Toolbar summary={`${formatInt(rows.length)} de ${formatInt(rules.length)} parâmetro(s)`}>
            <ToolbarField label="Tipo de equipamento">
              <NativeSelect fieldSize="sm" value={type} onChange={(e) => setType(e.target.value)} className="min-w-[12rem]">
                <option value="">Todos</option>
                {types.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </NativeSelect>
            </ToolbarField>
            <StatusFilter value={status} onChange={setStatus} />
          </Toolbar>
          <TableContainer tabIndex={0} stickyHeader maxHeight="70vh">
            <Table layout="fixed" style={{ minWidth: 1500 }}>
              <TableHeader>
                <TableRow>
                  <TableHead style={{ width: 160 }}>Tipo de equipamento</TableHead>
                  <TableHead style={{ width: 130 }}>Subcategoria</TableHead>
                  <TableHead style={{ width: 130 }}>Modelo</TableHead>
                  <TableHead style={{ width: 170 }}>Serviço</TableHead>
                  <TableHead style={{ width: 120 }} numeric>Intervalo</TableHead>
                  <TableHead style={{ width: 110 }} numeric>KM inicial</TableHead>
                  <TableHead style={{ width: 70 }} numeric>Ciclos</TableHead>
                  <TableHead style={{ width: 100 }} numeric>Alerta antes</TableHead>
                  <TableHead style={{ width: 130 }} numeric>Tolerância depois</TableHead>
                  <TableHead style={{ width: 110 }}>Criticidade</TableHead>
                  <TableHead style={{ width: 80 }} numeric>Veículos</TableHead>
                  <TableHead style={{ width: 90 }}>Situação</TableHead>
                  <TableHead style={{ width: 80 }}><span className="sr-only">Ações</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableEmpty
                    colSpan={13}
                    message={
                      rules.length === 0
                        ? "Nenhum parâmetro preventivo. Sem parâmetro, a matriz preventiva mostra o veículo como \"sem regra\"."
                        : "Nenhum parâmetro corresponde aos filtros."
                    }
                  />
                ) : (
                  rows.map((r) => {
                    const label = [r.vehicleTypeName, r.vehicleSubcategoryName, r.vehicleModelName].filter(Boolean).join(" · ");
                    return (
                      <TableRow key={r.id}>
                        <TableCell truncate className="font-medium" title={r.vehicleTypeName}>{r.vehicleTypeName}</TableCell>
                        <TableCell truncate title={r.vehicleSubcategoryName ?? undefined} className={r.vehicleSubcategoryName ? undefined : "text-fg-muted"}>
                          {r.vehicleSubcategoryName ?? "Todas"}
                        </TableCell>
                        <TableCell truncate title={r.vehicleModelName ?? undefined} className={r.vehicleModelName ? undefined : "text-fg-muted"}>
                          {r.vehicleModelName ?? "Todos"}
                        </TableCell>
                        <TableCell truncate title={r.serviceName ?? undefined} className={r.serviceName ? undefined : "text-fg-muted"}>
                          {r.serviceName ?? "Não definido"}
                        </TableCell>
                        <TableCell numeric>{formatKm(r.intervalKm)}</TableCell>
                        <TableCell numeric>{formatKm(r.initialKm)}</TableCell>
                        <TableCell numeric>{formatInt(r.cycleCount)}</TableCell>
                        <TableCell numeric>{numberText(r.alertBeforePct)}%</TableCell>
                        <TableCell numeric>{numberText(r.toleranceAfterPct)}%</TableCell>
                        <TableCell><CriticalityBadge value={r.criticality} /></TableCell>
                        <TableCell numeric>{formatInt(r.vehicles)}</TableCell>
                        <TableCell><SituationBadge active={r.status === "active"} /></TableCell>
                        <TableCell>
                          <RowActions
                            name={`parâmetro ${label}`}
                            canManage={canManage}
                            busy={archive.busyId === r.id}
                            onOpen={() => setForm({ open: true, rule: r })}
                            onArchive={() =>
                              void archive.run({
                                id: r.id,
                                title: `Inativar o parâmetro ${label}?`,
                                description:
                                  "O parâmetro deixa de gerar ciclos novos. Os ciclos já gerados e as preventivas realizadas ficam no histórico.",
                                call: () => archivePreventiveRule(r.id),
                                success: "Parâmetro preventivo inativado.",
                                fallback: "Não foi possível inativar o parâmetro preventivo.",
                              })
                            }
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
      <PreventiveRuleFormDrawer
        open={form.open}
        rule={form.rule}
        catalog={catalog}
        options={options}
        readOnly={!canManage}
        onOpenChange={(open) => setForm((s) => ({ ...s, open }))}
        onSaved={actions.refresh}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Planos técnicos preditivos
// ---------------------------------------------------------------------------
const PLAN_STATUSES = Object.keys(PLAN_STATUS_LABEL) as PlanStatus[];

function PredictiveSection({
  plans,
  catalog,
  options,
  canManage,
  actions,
}: {
  plans: PredictivePlan[] | null;
  catalog: MaintenanceCatalog;
  options: MaintenanceFilterOptions;
  canManage: boolean;
  actions: PanelActions;
}) {
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<{ open: boolean; plan: PredictivePlan | null }>({ open: false, plan: null });
  const [duplicate, setDuplicate] = React.useState<PredictivePlan | null>(null);
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("");

  const header = (
    <SectionHeader
      title="Planos técnicos preditivos"
      description={
        <>
          Inspeções por tipo, subcategoria, marca, modelo e faixa de ano. Fluxo: rascunho → em revisão → aprovado →
          arquivado. <strong>Só planos aprovados alimentam o motor preditivo</strong>; em plano aprovado, mudar item
          sensível exige motivo e publica nova versão.
        </>
      }
      canManage={canManage}
      actions={
        canManage && plans ? (
          <Button leadingIcon={<Plus />} onClick={() => setForm({ open: true, plan: null })} data-testid="maintenance-plan-new">
            Novo plano
          </Button>
        ) : undefined
      }
    />
  );

  if (!plans) {
    return (
      <section className="flex flex-col gap-4" data-testid="maintenance-catalog-predictive">
        {header}
        <ErrorState
          title="Não foi possível carregar os planos técnicos."
          description="Os demais cadastros seguem disponíveis. Tente de novo em instantes."
          onRetry={actions.refresh}
          retryLabel="Tentar de novo"
          retrying={actions.pending}
        />
      </section>
    );
  }

  const rows = plans.filter(
    (p) =>
      (!status || p.approvalStatus === status) &&
      matches(q, [p.code, p.name, p.vehicleTypeName, p.vehicleModelName, p.vehicleMakeName, p.vehicleSubcategoryName]),
  );
  const detail = detailId ? plans.find((p) => p.id === detailId) ?? null : null;

  return (
    <section className="flex flex-col gap-4" data-testid="maintenance-catalog-predictive">
      {header}
      {plans.length === 0 ? (
        <EmptyState
          variant="panel"
          icon={<ClipboardList />}
          title="Nenhum plano técnico"
          description="Sem plano aprovado, a preditiva não monitora nenhum veículo. Crie o plano, cadastre os itens e aprove."
          action={canManage ? <Button leadingIcon={<Plus />} onClick={() => setForm({ open: true, plan: null })}>Novo plano</Button> : undefined}
        />
      ) : (
        <>
          <Toolbar summary={`${formatInt(rows.length)} de ${formatInt(plans.length)} plano(s)`}>
            <ToolbarField label="Buscar" className="w-full sm:w-64">
              <SearchField size="sm" aria-label="Buscar plano" value={q} onValueChange={setQ} placeholder="Código, nome ou modelo" />
            </ToolbarField>
            <ToolbarField label="Situação">
              <NativeSelect fieldSize="sm" value={status} onChange={(e) => setStatus(e.target.value)} className="min-w-[9rem]">
                <option value="">Todas</option>
                {PLAN_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {PLAN_STATUS_LABEL[s]}
                  </option>
                ))}
              </NativeSelect>
            </ToolbarField>
          </Toolbar>
          <TableContainer tabIndex={0} stickyHeader maxHeight="70vh">
            <Table layout="fixed" style={{ minWidth: 1220 }}>
              <TableHeader>
                <TableRow>
                  <TableHead style={{ width: 270 }}>Plano</TableHead>
                  <TableHead style={{ width: 240 }}>Aplicabilidade</TableHead>
                  <TableHead style={{ width: 110 }}>Anos</TableHead>
                  <TableHead style={{ width: 140 }}>Fonte</TableHead>
                  <TableHead style={{ width: 70 }} numeric>Versão</TableHead>
                  <TableHead style={{ width: 120 }}>Situação</TableHead>
                  <TableHead style={{ width: 80 }} numeric>Itens</TableHead>
                  <TableHead style={{ width: 80 }} numeric>Veículos</TableHead>
                  <TableHead style={{ width: 110 }}><span className="sr-only">Ações</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableEmpty
                    colSpan={9}
                    message={plans.length === 0 ? "Nenhum plano técnico cadastrado. Sem plano aprovado, a preditiva não monitora nenhum veículo." : "Nenhum plano corresponde aos filtros."}
                  />
                ) : (
                  rows.map((p) => {
                    const active = p.items.filter((i) => i.isActive).length;
                    const applicability = planApplicability(p);
                    return (
                      <TableRow key={p.id}>
                        <TableCell>
                          <button
                            type="button"
                            onClick={() => setDetailId(p.id)}
                            className="flex w-full min-w-0 flex-col rounded-xs text-left hfm-focus-ring"
                            data-testid="maintenance-plan-open"
                          >
                            <span className="font-mono text-caption text-fg-muted">{p.code}</span>
                            <span className="truncate font-medium text-link hover:underline" title={p.name}>{p.name}</span>
                          </button>
                        </TableCell>
                        <TableCell truncate title={applicability}>{applicability}</TableCell>
                        <TableCell className="tabular-nums">{planYears(p)}</TableCell>
                        <TableCell truncate>{PLAN_SOURCE_LABEL[p.source] ?? p.source}</TableCell>
                        <TableCell numeric>v{p.version}</TableCell>
                        <TableCell><PlanStatusBadge status={p.approvalStatus} /></TableCell>
                        <TableCell numeric title={`${active} ativo(s) de ${p.items.length}`}>
                          {formatInt(active)}
                          <span className="text-fg-muted">/{formatInt(p.items.length)}</span>
                        </TableCell>
                        <TableCell numeric>{formatInt(p.vehicles)}</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-0.5">
                            <IconButton size="sm" label={`Abrir plano ${p.code}`} onClick={() => setDetailId(p.id)}>
                              <Eye aria-hidden />
                            </IconButton>
                            {canManage ? (
                              <>
                                <IconButton size="sm" label={`Editar plano ${p.code}`} onClick={() => setForm({ open: true, plan: p })}>
                                  <Pencil aria-hidden />
                                </IconButton>
                                <IconButton size="sm" label={`Duplicar plano ${p.code}`} onClick={() => setDuplicate(p)}>
                                  <Copy aria-hidden />
                                </IconButton>
                              </>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}

      <PredictivePlanDetailDrawer
        planId={detailId}
        plan={detail}
        catalog={catalog}
        options={options}
        canManage={canManage}
        pending={actions.pending}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
        onChanged={actions.refresh}
        onOpenPlan={setDetailId}
      />
      {canManage ? (
        <>
          <PredictivePlanFormDrawer
            open={form.open}
            plan={form.plan}
            options={options}
            onOpenChange={(open) => setForm((s) => ({ ...s, open }))}
            onSaved={(id) => {
              actions.refresh();
              // Plano novo abre no detalhe: o próximo passo é cadastrar os itens.
              if (!form.plan && id) setDetailId(id);
            }}
          />
          <DuplicatePlanDialog
            plan={duplicate}
            onOpenChange={(open) => {
              if (!open) setDuplicate(null);
            }}
            onDuplicated={(id) => {
              actions.refresh();
              if (id) setDetailId(id);
            }}
          />
        </>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Origens
// ---------------------------------------------------------------------------
function OriginsSection({ catalog, canManage, actions }: { catalog: MaintenanceCatalog; canManage: boolean; actions: PanelActions }) {
  const [form, setForm] = React.useState<{ open: boolean; origin: MaintenanceOrigin | null }>({ open: false, origin: null });
  const isSystem = (o: MaintenanceOrigin) => o.isSystem || o.organizationId == null;

  return (
    <section className="flex flex-col gap-4" data-testid="maintenance-catalog-origins">
      <SectionHeader
        title="Origens"
        description="De onde veio a demanda de manutenção. As origens do sistema são globais e só de leitura; a organização pode criar as suas."
        canManage={canManage}
        actions={
          canManage ? (
            <Button leadingIcon={<Plus />} onClick={() => setForm({ open: true, origin: null })} data-testid="maintenance-origin-new">
              Nova origem
            </Button>
          ) : undefined
        }
      />
      <TableContainer tabIndex={0} stickyHeader maxHeight="70vh">
        <Table layout="fixed" style={{ minWidth: 860 }}>
          <TableHeader>
            <TableRow>
              <TableHead style={{ width: 240 }}>Nome</TableHead>
              <TableHead style={{ width: 180 }}>Código</TableHead>
              <TableHead style={{ width: 140 }}>Escopo</TableHead>
              <TableHead style={{ width: 160 }}>Selecionável manualmente</TableHead>
              <TableHead style={{ width: 90 }}>Situação</TableHead>
              <TableHead style={{ width: 60 }}><span className="sr-only">Ações</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {catalog.origins.length === 0 ? (
              <TableEmpty colSpan={6} message="Nenhuma origem disponível." />
            ) : (
              catalog.origins.map((o) => {
                const system = isSystem(o);
                return (
                  <TableRow key={o.id}>
                    <TableCell>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium" title={o.name}>{o.name}</span>
                        {o.description ? <span className="truncate text-caption text-fg-muted" title={o.description}>{o.description}</span> : null}
                      </div>
                    </TableCell>
                    <TableCell truncate className="font-mono text-caption" title={o.code}>{o.code}</TableCell>
                    <TableCell>
                      {system ? (
                        <Badge variant="neutral" size="sm" icon={<Lock aria-hidden />}>Sistema</Badge>
                      ) : (
                        <Badge variant="primary" size="sm">Organização</Badge>
                      )}
                    </TableCell>
                    <TableCell>{o.manualSelectable ? "Sim" : <span className="text-fg-muted">Não (automática)</span>}</TableCell>
                    <TableCell><SituationBadge active={o.isActive} feminine /></TableCell>
                    <TableCell>
                      {canManage && !system ? (
                        <div className="flex justify-end">
                          <IconButton size="sm" label={`Editar origem ${o.name}`} onClick={() => setForm({ open: true, origin: o })}>
                            <Pencil aria-hidden />
                          </IconButton>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {canManage ? (
        <OriginFormDrawer
          open={form.open}
          origin={form.origin}
          onOpenChange={(open) => setForm((s) => ({ ...s, open }))}
          onSaved={actions.refresh}
        />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Configurações
// ---------------------------------------------------------------------------
function SettingsSection({ catalog, canManage, actions }: { catalog: MaintenanceCatalog; canManage: boolean; actions: PanelActions }) {
  const [open, setOpen] = React.useState(false);
  const settings = catalog.settings;
  const buckets = agingLabels(settings.agingBuckets);

  return (
    <section className="flex flex-col gap-4" data-testid="maintenance-catalog-settings">
      <SectionHeader
        title="Configurações"
        description="Parâmetros da organização usados pelos indicadores, pelas filas da Programação e pela resolução do KM de entrada."
        canManage={canManage}
        actions={
          canManage ? (
            <Button variant="secondary" leadingIcon={<Settings2 />} onClick={() => setOpen(true)} data-testid="maintenance-settings-edit">
              Editar configurações
            </Button>
          ) : undefined
        }
      />
      <div className="rounded-md border border-border bg-surface">
        <div className="border-b border-border-subtle px-4 py-3">
          <p className="text-caption text-fg-muted">Faixas de aging</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Faixas de aging em dias">
            {buckets.map((b) => (
              <li key={b}>
                <Badge variant="neutral" size="md" className="tabular-nums">
                  {b} dias
                </Badge>
              </li>
            ))}
          </ul>
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 px-4 py-3 sm:grid-cols-2 xl:grid-cols-4">
          {SETTING_FIELDS.map((f) => {
            const value = settings[f.prop] as number;
            return (
              <div key={f.key} className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-caption text-fg-muted">{f.label}</dt>
                <dd className="text-h4 font-semibold tabular-nums text-fg">
                  {f.unit === "km" ? formatKm(value) : `${numberText(value)} ${f.unit}`}
                </dd>
                <dd className="text-caption text-fg-muted">{f.helper}</dd>
              </div>
            );
          })}
        </dl>
      </div>
      {canManage ? (
        <SettingsFormDrawer open={open} settings={settings} onOpenChange={setOpen} onSaved={actions.refresh} />
      ) : null}
    </section>
  );
}
