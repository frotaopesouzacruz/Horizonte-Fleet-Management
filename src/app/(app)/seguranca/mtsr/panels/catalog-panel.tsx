"use client";

import * as React from "react";
import { Camera, Check, ListChecks, Pencil, Plug, Plus, Trash2, Wrench, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { useConfirm } from "@/components/feedback/confirm-dialog";
import { useToast } from "@/components/feedback/toast";
import { CriticalityBadge, VerificationModeBadge } from "@/components/mtsr/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableActionCell, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { applyEvidenceRetention, type PurgeOutcome } from "@/lib/mtsr/actions";
import { fmtDays, fmtInt, formatDate, type MtsrCatalog, type MtsrComponent } from "@/lib/mtsr/types";
import type { MtsrPanelContext } from "../shared";
import { ComponentDialog, ServicesDialog, SourcesDialog } from "./catalog/catalog-dialogs";
import { ParametersForm } from "./catalog/parameters-form";
import { PanelEmpty, PanelError, plural, SubTabs } from "./mtsr-ui";

/**
 * MTSR → Cadastros: componentes, serviços mapeados, parâmetros, fontes por
 * componente e retenção de evidências. Tudo vem de `mtsr_catalog`; cada
 * alteração é uma rotina do banco com trilha.
 */
type Sub = "componentes" | "servicos" | "parametros" | "fontes" | "evidencias";

export function CatalogPanel({ data, ctx }: { data: MtsrCatalog | null; ctx: MtsrPanelContext }) {
  if (ctx.error) return <PanelError ctx={ctx} title="Não foi possível carregar os cadastros do MTSR." testId="mtsr-cadastros-error" />;
  if (!data) {
    return <PanelEmpty icon={<ListChecks />} title="Sem catálogo" description="A rotina não devolveu o catálogo do MTSR. Recarregue a página." testId="mtsr-cadastros-empty" />;
  }
  return <CatalogContent catalog={data} ctx={ctx} />;
}

function CatalogContent({ catalog, ctx }: { catalog: MtsrCatalog; ctx: MtsrPanelContext }) {
  const subs: { value: Sub; label: string }[] = [
    { value: "componentes", label: "Componentes" },
    { value: "servicos", label: "Serviços" },
  ];
  if (ctx.perms.parametersManage) subs.push({ value: "parametros", label: "Parâmetros" });
  if (ctx.perms.ingestionManage) subs.push({ value: "fontes", label: "Fontes" });
  if (ctx.perms.validate || ctx.perms.parametersManage) subs.push({ value: "evidencias", label: "Evidências" });
  const requested = ctx.params.sub as Sub | undefined;
  const sub: Sub = requested && subs.some((s) => s.value === requested) ? requested : subs[0].value;

  return (
    <div className="flex flex-col gap-4" data-testid="mtsr-cadastros">
      <SubTabs ctx={ctx} value={sub} items={subs} label="Seções dos cadastros" testIdPrefix="mtsr-catalog-sub" />
      {sub === "componentes" ? <ComponentsSection catalog={catalog} ctx={ctx} /> : null}
      {sub === "servicos" ? <ServicesSection catalog={catalog} ctx={ctx} /> : null}
      {sub === "parametros" ? <ParametersForm catalog={catalog} canManage={ctx.perms.parametersManage} onDone={ctx.refresh} /> : null}
      {sub === "fontes" ? <SourcesSection catalog={catalog} ctx={ctx} /> : null}
      {sub === "evidencias" ? <EvidenceSection catalog={catalog} ctx={ctx} /> : null}
    </div>
  );
}

const sorted = (list: MtsrComponent[]) => [...list].sort((a, b) => a.sortOrder - b.sortOrder || a.priority - b.priority || a.name.localeCompare(b.name, "pt-BR"));

// ---------------------------------------------------------------------------
// Componentes
// ---------------------------------------------------------------------------
function Policy({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-caption", on ? "text-fg" : "text-fg-muted")} title={`${label}: ${on ? "sim" : "não"}`}>
      {on ? <Check className="size-3.5 text-success" aria-hidden /> : <X className="size-3.5" aria-hidden />}
      {label}
    </span>
  );
}

function ComponentsSection({ catalog, ctx }: { catalog: MtsrCatalog; ctx: MtsrPanelContext }) {
  const [editing, setEditing] = React.useState<{ component: MtsrComponent | null } | null>(null);
  const components = sorted(catalog.components);
  const nextOrder = components.reduce((m, c) => Math.max(m, c.sortOrder, c.priority), 0) + 1;
  const canManage = ctx.perms.componentManage;

  return (
    <div className="flex flex-col gap-3" data-testid="mtsr-catalog-components">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body-sm text-fg-muted">
          {fmtInt(components.length)} {plural(components.length, "componente", "componentes")} · {fmtInt(components.filter((c) => c.isActive).length)} ativos. A ordem define a matriz e o app; a
          prioridade, qual componente NOK é o principal do veículo.
        </p>
        {canManage ? (
          <Button size="sm" variant="primary" leadingIcon={<Plus />} onClick={() => setEditing({ component: null })} data-testid="mtsr-component-new">
            Novo componente
          </Button>
        ) : null}
      </div>
      {components.length === 0 ? (
        <PanelEmpty icon={<ListChecks />} title="Nenhum componente cadastrado" description="Cadastre os componentes de segurança MTSR (MDVR, câmeras, teclado, travas, sirene, Geotab…) para a matriz existir." testId="mtsr-components-empty" />
      ) : (
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead numeric>Ordem</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Código</TableHead>
                <TableHead>Modo</TableHead>
                <TableHead>Criticidade base</TableHead>
                <TableHead numeric>Prioridade</TableHead>
                <TableHead>Ativo</TableHead>
                <TableHead>Políticas</TableHead>
                <TableHead>Apelidos</TableHead>
                {canManage ? <TableHead className="sr-only">Ações</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {components.map((c) => (
                <TableRow key={c.id} data-testid="mtsr-component-row" data-code={c.code} className={cn(!c.isActive && "opacity-70")}>
                  <TableCell numeric>{fmtInt(c.sortOrder)}</TableCell>
                  <TableCell>
                    <span className="font-medium text-fg">{c.name}</span>
                    {c.contextLabel ? <Badge variant="neutral" appearance="outline" size="sm" className="ml-1.5">{c.contextLabel}</Badge> : null}
                    {c.description ? <span className="block text-caption text-fg-muted">{c.description}</span> : null}
                  </TableCell>
                  <TableCell className="font-mono text-caption text-fg-secondary">{c.code}</TableCell>
                  <TableCell><VerificationModeBadge value={c.verificationMode} size="sm" /></TableCell>
                  <TableCell><CriticalityBadge value={c.baseCriticality} size="sm" /></TableCell>
                  <TableCell numeric>{fmtInt(c.priority)}</TableCell>
                  <TableCell><StatusBadge status={c.isActive ? "success" : "neutral"} size="sm">{c.isActive ? "Ativo" : "Inativo"}</StatusBadge></TableCell>
                  <TableCell>
                    <span className="flex flex-col gap-0.5">
                      <Policy on={c.evidenceRequiredWhenOk} label="Foto em OK" />
                      <Policy on={c.evidenceRequiredWhenNok} label="Foto em NOK" />
                      <Policy on={c.observationRequiredWhenNok} label="Observação em NOK" />
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[16rem] text-caption text-fg-secondary">{c.aliases.length ? c.aliases.join(", ") : "—"}</TableCell>
                  {canManage ? (
                    <TableActionCell>
                      <Button size="sm" variant="ghost" leadingIcon={<Pencil />} onClick={() => setEditing({ component: c })} data-testid="mtsr-component-edit">
                        Editar
                      </Button>
                    </TableActionCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {editing ? (
        <ComponentDialog
          key={editing.component?.id ?? "new"}
          open
          onOpenChange={(o) => (!o ? setEditing(null) : undefined)}
          component={editing.component}
          nextOrder={nextOrder}
          onDone={ctx.refresh}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Serviços
// ---------------------------------------------------------------------------
function ServicesSection({ catalog, ctx }: { catalog: MtsrCatalog; ctx: MtsrPanelContext }) {
  const [editing, setEditing] = React.useState<MtsrComponent | null>(null);
  const components = sorted(catalog.components.filter((c) => c.isActive));
  const canManage = ctx.perms.componentManage;
  const without = components.filter((c) => !catalog.componentServices.some((s) => s.componentId === c.id && s.isActive));

  return (
    <div className="flex flex-col gap-3" data-testid="mtsr-catalog-services">
      <p className="text-body-sm text-fg-muted">
        Mapeamento componente ↔ serviços do catálogo corporativo de Manutenção. Ao abrir manutenção a partir de um NOK, o serviço padrão do componente é
        proposto.
      </p>
      {without.length > 0 ? (
        <Alert variant="warning" className="py-2">
          <AlertTitle>{fmtInt(without.length)} {plural(without.length, "componente sem serviço mapeado", "componentes sem serviço mapeado")}</AlertTitle>
          <AlertDescription>{without.map((c) => c.name).join(", ")}: abrir manutenção exigirá escolher o serviço a cada vez.</AlertDescription>
        </Alert>
      ) : null}
      {components.length === 0 ? (
        <PanelEmpty icon={<Wrench />} title="Nenhum componente ativo" description="Cadastre ou ative componentes para mapear serviços." testId="mtsr-services-empty" />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {components.map((c) => {
            const links = catalog.componentServices.filter((s) => s.componentId === c.id && s.isActive);
            return (
              <Card key={c.id} data-testid="mtsr-service-card" data-code={c.code}>
                <CardHeader
                  title={c.name}
                  description={`${fmtInt(links.length)} ${plural(links.length, "serviço", "serviços")}`}
                  actions={
                    canManage ? (
                      <Button size="sm" variant="secondary" leadingIcon={<Pencil />} onClick={() => setEditing(c)} data-testid="mtsr-services-edit">
                        Editar serviços
                      </Button>
                    ) : null
                  }
                />
                <CardContent>
                  {links.length === 0 ? (
                    <p className="text-body-sm text-warning-soft-fg">Sem serviço mapeado.</p>
                  ) : (
                    <ul className="flex flex-col gap-1 text-body-sm">
                      {links.map((l) => (
                        <li key={l.id} className="flex items-center justify-between gap-2">
                          <span className="min-w-0">
                            <span className="font-medium text-fg">{l.serviceName}</span>
                            {l.clusterName ? <span className="text-caption text-fg-muted"> · {l.clusterName}</span> : null}
                          </span>
                          {l.isDefault ? <Badge variant="highlight" size="sm">Padrão</Badge> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      {editing ? (
        <ServicesDialog
          key={editing.id}
          open
          onOpenChange={(o) => (!o ? setEditing(null) : undefined)}
          component={editing}
          current={catalog.componentServices.filter((s) => s.componentId === editing.id)}
          services={catalog.services}
          onDone={ctx.refresh}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fontes por componente
// ---------------------------------------------------------------------------
function SourcesSection({ catalog, ctx }: { catalog: MtsrCatalog; ctx: MtsrPanelContext }) {
  const [editing, setEditing] = React.useState<MtsrComponent | null>(null);
  const components = sorted(catalog.components.filter((c) => c.isActive));
  const sources = [...catalog.sources].sort((a, b) => a.priority - b.priority);
  const canManage = ctx.perms.ingestionManage;

  return (
    <div className="flex flex-col gap-3" data-testid="mtsr-catalog-sources">
      <p className="text-body-sm text-fg-muted">
        Prioridade de cada fonte por componente: quando duas fontes informam o mesmo componente na mesma data, vence a de menor número. Fonte sem adaptador nesta
        versão aparece como indisponível.
      </p>
      {components.length === 0 || sources.length === 0 ? (
        <PanelEmpty icon={<Plug />} title="Nada para mapear" description={sources.length === 0 ? "Nenhuma fonte cadastrada." : "Nenhum componente ativo."} testId="mtsr-sources-matrix-empty" />
      ) : (
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Componente</TableHead>
                {sources.map((s) => (
                  <TableHead key={s.id} align="center" className="whitespace-normal text-center leading-tight">
                    {s.name}
                    {!s.isAvailable ? <span className="block text-[10px] font-normal text-fg-muted">indisponível</span> : null}
                  </TableHead>
                ))}
                {canManage ? <TableHead className="sr-only">Ações</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {components.map((c) => (
                <TableRow key={c.id} data-testid="mtsr-sources-row" data-code={c.code}>
                  <TableCell>
                    <span className="font-medium text-fg">{c.name}</span>
                    <span className="block"><VerificationModeBadge value={c.verificationMode} size="sm" /></span>
                  </TableCell>
                  {sources.map((s) => {
                    const link = catalog.componentSources.find((l) => l.componentId === c.id && l.sourceId === s.id);
                    return (
                      <TableCell key={s.id} align="center">
                        {link ? (
                          <StatusBadge status={link.isEnabled ? (s.isAvailable ? "success" : "neutral") : "neutral"} size="sm" title={link.isEnabled ? "Habilitada" : "Desabilitada"}>
                            prioridade {fmtInt(link.priority)}{link.isEnabled ? "" : " · off"}
                          </StatusBadge>
                        ) : (
                          <span className="text-fg-muted">—</span>
                        )}
                      </TableCell>
                    );
                  })}
                  {canManage ? (
                    <TableActionCell>
                      <Button size="sm" variant="ghost" leadingIcon={<Pencil />} onClick={() => setEditing(c)} data-testid="mtsr-sources-edit">
                        Editar
                      </Button>
                    </TableActionCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {editing ? (
        <SourcesDialog
          key={editing.id}
          open
          onOpenChange={(o) => (!o ? setEditing(null) : undefined)}
          component={editing}
          sources={sources}
          current={catalog.componentSources.filter((l) => l.componentId === editing.id)}
          onDone={ctx.refresh}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Evidências (retenção)
// ---------------------------------------------------------------------------
function EvidenceSection({ catalog, ctx }: { catalog: MtsrCatalog; ctx: MtsrPanelContext }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = React.useState(false);
  const [outcome, setOutcome] = React.useState<PurgeOutcome | null>(null);
  const p = catalog.parameters;
  const canRun = ctx.perms.validate || ctx.perms.parametersManage;

  const run = async () => {
    const ok = await confirm({
      title: "Aplicar a retenção de evidências agora?",
      description: `Fotos fora da regra vigente (${fmtInt(p.evidenceRetentionInspections)} ${plural(p.evidenceRetentionInspections, "vistoria", "vistorias")} por veículo${
        p.evidenceRetentionDays != null ? ` ou ${fmtDays(p.evidenceRetentionDays)}` : ""
      }) são apagadas do armazenamento e marcadas como expurgadas. A vistoria e seus itens continuam na trilha; só a imagem deixa de existir.`,
      confirmLabel: "Aplicar retenção",
      destructive: true,
      icon: <Trash2 />,
    });
    if (!ok) return;
    setBusy(true);
    const r = await applyEvidenceRetention();
    setBusy(false);
    if (!r.ok || !r.data) {
      toast({ title: "Não foi possível aplicar a retenção", description: r.error, variant: "danger" });
      return;
    }
    setOutcome(r.data);
    toast({
      title: r.data.candidates === 0 ? "Nada a expurgar" : "Retenção aplicada",
      description: `${fmtInt(r.data.candidates)} candidatas · ${fmtInt(r.data.removed)} removidas · ${fmtInt(r.data.marked)} marcadas.`,
      variant: "success",
    });
    ctx.refresh();
  };

  return (
    <div className="flex flex-col gap-3" data-testid="mtsr-catalog-evidence">
      <Card>
        <CardHeader
          title="Retenção de evidências"
          description="As fotos das vistorias ficam só pelo tempo da regra vigente; a validação de uma vistoria já aplica a retenção ao veículo. Aqui a regra roda para toda a organização."
          actions={
            canRun ? (
              <Button size="sm" variant="danger" leadingIcon={<Trash2 />} onClick={run} loading={busy} data-testid="mtsr-evidence-apply">
                Aplicar retenção agora
              </Button>
            ) : null
          }
        />
        <CardContent className="flex flex-col gap-3">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-caption text-fg-muted">Vistorias mantidas por veículo</dt>
              <dd className="text-h3 font-semibold text-fg tabular-nums">{fmtInt(p.evidenceRetentionInspections)}</dd>
            </div>
            <div>
              <dt className="text-caption text-fg-muted">Limite por dias</dt>
              <dd className="text-h3 font-semibold text-fg tabular-nums">{p.evidenceRetentionDays == null ? "Sem limite" : fmtDays(p.evidenceRetentionDays)}</dd>
            </div>
            <div>
              <dt className="text-caption text-fg-muted">Regra vigente desde</dt>
              <dd className="text-h3 font-semibold text-fg tabular-nums">{formatDate(p.effectiveFrom)}</dd>
            </div>
          </dl>
          {outcome ? (
            <Alert variant={outcome.candidates === 0 ? "neutral" : "success"} className="py-2" icon={<Camera />} data-testid="mtsr-evidence-outcome">
              <AlertTitle>{outcome.candidates === 0 ? "Nenhuma foto fora da regra" : "Retenção aplicada"}</AlertTitle>
              <AlertDescription>
                {fmtInt(outcome.candidates)} candidatas · {fmtInt(outcome.removed)} removidas do armazenamento · {fmtInt(outcome.marked)} marcadas como expurgadas (regra:{" "}
                {fmtInt(outcome.retentionInspections)} vistorias{outcome.retentionDays != null ? ` ou ${fmtDays(outcome.retentionDays)}` : ""}).
              </AlertDescription>
            </Alert>
          ) : null}
          {!canRun ? <p className="text-caption text-fg-muted">Aplicar a retenção exige permissão para validar vistorias ou gerir parâmetros.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
