"use client";

import * as React from "react";
import { Database, Plug, PlugZap, Radio, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import { IngestionOutcomeBadge } from "@/components/mtsr/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SearchField } from "@/components/ui/search-field";
import { StatusBadge } from "@/components/ui/status-badge";
import { SwitchField } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/governance/selects";
import { saveSource, updateBackofficeStatus } from "@/lib/mtsr/actions";
import type { MtsrIngestionData } from "@/lib/mtsr/loaders";
import type { MtsrVehicleOption } from "@/lib/mtsr/queries";
import {
  COMPONENT_STATUS_LABEL, fmtInt, formatStamp, INGESTION_OUTCOME_LABEL, INGESTION_REASON_LABEL, sourceTypeLabel,
  type ComponentStatus, type IngestionOutcome, type MtsrComponent, type MtsrSource,
} from "@/lib/mtsr/types";
import type { MtsrPanelContext } from "../shared";
import { MtsrImportSection } from "./ingestion/import-section";
import { MtsrPagination, PanelEmpty, PanelError, PlateLink, plural, SubTabs } from "./mtsr-ui";

/**
 * MTSR → Ingestão: por onde o estado oficial entra.
 *
 * Fontes (quais existem, quais têm adaptador nesta versão, quais estão
 * habilitadas), atualização manual do backoffice para componentes de
 * backoffice, o histórico de eventos recebidos (aplicados, ignorados,
 * rejeitados, conflitos) e a importação por planilha.
 */
type Sub = "fontes" | "backoffice" | "eventos" | "importacao";

/** Tipos de fonte sem adaptador nesta versão: dizemos isso em vez de inventar uma API. */
const CONNECTOR_TYPES = new Set(["geotab_api", "mdvr_api", "cftv_api", "other_connector"]);

export function IngestionPanel({ data, ctx }: { data: MtsrIngestionData | null; ctx: MtsrPanelContext }) {
  if (ctx.error) return <PanelError ctx={ctx} title="Não foi possível carregar a ingestão do MTSR." testId="mtsr-ingestao-error" />;
  if (!data) {
    return (
      <PanelEmpty
        icon={<Database />}
        title="Sem dados de ingestão"
        description="A leitura das fontes e dos eventos não devolveu resultado. Recarregue a página."
        testId="mtsr-ingestao-empty"
      />
    );
  }
  return <IngestionContent data={data} ctx={ctx} />;
}

function IngestionContent({ data, ctx }: { data: MtsrIngestionData; ctx: MtsrPanelContext }) {
  const subs: { value: Sub; label: string }[] = [{ value: "fontes", label: "Fontes" }];
  if (ctx.perms.backofficeUpdate) subs.push({ value: "backoffice", label: "Backoffice" });
  subs.push({ value: "eventos", label: "Eventos" });
  if (ctx.perms.import) subs.push({ value: "importacao", label: "Importação" });
  const requested = ctx.params.sub as Sub | undefined;
  const sub: Sub = requested && subs.some((s) => s.value === requested) ? requested : subs[0].value;

  return (
    <div className="flex flex-col gap-4" data-testid="mtsr-ingestao">
      <SubTabs ctx={ctx} value={sub} items={subs} label="Seções da ingestão" testIdPrefix="mtsr-ingestion-sub" />
      {sub === "fontes" ? <SourcesSection sources={data.catalog.sources} ctx={ctx} /> : null}
      {sub === "backoffice" ? <BackofficeSection data={data} ctx={ctx} /> : null}
      {sub === "eventos" ? <EventsSection data={data} ctx={ctx} /> : null}
      {sub === "importacao" ? (
        <MtsrImportSection catalog={data.catalog} imports={data.imports} canImport={ctx.perms.import} onDone={ctx.refresh} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fontes
// ---------------------------------------------------------------------------
function SourcesSection({ sources, ctx }: { sources: MtsrSource[]; ctx: MtsrPanelContext }) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  const ordered = [...sources].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name, "pt-BR"));

  const toggle = async (s: MtsrSource, enabled: boolean) => {
    setBusy(s.id);
    const r = await saveSource({ id: s.id, isEnabled: enabled });
    setBusy(null);
    if (!r.ok) {
      toast({ title: "Não foi possível alterar a fonte", description: r.error, variant: "danger" });
      return;
    }
    toast({ title: enabled ? `Fonte ${s.name} habilitada` : `Fonte ${s.name} desabilitada`, variant: "success" });
    ctx.refresh();
  };

  if (ordered.length === 0) {
    return (
      <PanelEmpty icon={<Plug />} title="Nenhuma fonte cadastrada" description="As fontes de leitura são criadas pela configuração do módulo." testId="mtsr-sources-empty" />
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="mtsr-sources">
      <p className="text-body-sm text-fg-muted">
        Prioridade decide quem vence quando duas fontes informam o mesmo componente na mesma data: <strong>menor número = maior prioridade</strong>.
        Fonte indisponível não tem adaptador nesta versão.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {ordered.map((s) => {
          const connector = CONNECTOR_TYPES.has(s.sourceType);
          const canToggle = s.isAvailable && ctx.perms.ingestionManage;
          return (
            <Card key={s.id} data-testid="mtsr-source-card" data-code={s.code}>
              <CardHeader
                title={s.name}
                description={`${sourceTypeLabel(s.sourceType)}${s.sourceSystem ? ` · ${s.sourceSystem}` : ""}`}
                actions={
                  <span className="flex items-center gap-1.5">
                    <StatusBadge status={s.isAvailable ? "success" : "neutral"} size="sm" withIcon>
                      {s.isAvailable ? "Disponível" : "Indisponível"}
                    </StatusBadge>
                  </span>
                }
              />
              <CardContent className="flex flex-col gap-3">
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-body-sm">
                  <div>
                    <dt className="text-caption text-fg-muted">Prioridade</dt>
                    <dd className="font-semibold tabular-nums text-fg">{fmtInt(s.priority)}</dd>
                  </div>
                  <div>
                    <dt className="text-caption text-fg-muted">Último evento</dt>
                    <dd className="tabular-nums text-fg">{s.lastEventAt ? formatStamp(s.lastEventAt) : "Nenhum"}</dd>
                  </div>
                  <div>
                    <dt className="text-caption text-fg-muted">Código</dt>
                    <dd className="font-mono text-caption text-fg-secondary">{s.code}</dd>
                  </div>
                  <div>
                    <dt className="text-caption text-fg-muted">Situação</dt>
                    <dd>
                      <StatusBadge status={s.isEnabled ? "info" : "neutral"} size="sm">{s.isEnabled ? "Habilitada" : "Desabilitada"}</StatusBadge>
                    </dd>
                  </div>
                </dl>
                {s.notes ? <p className="text-caption text-fg-muted">{s.notes}</p> : null}
                {connector && !s.isAvailable ? (
                  <Alert variant="neutral" className="py-2" icon={<PlugZap />}>
                    <AlertDescription>Conector não disponível nesta versão — não inventamos APIs. O estado deste tipo de fonte entra por importação ou backoffice manual.</AlertDescription>
                  </Alert>
                ) : null}
                {canToggle ? (
                  <SwitchField
                    label="Habilitada"
                    description="Fonte desabilitada tem seus eventos ignorados."
                    checked={s.isEnabled}
                    disabled={busy === s.id || ctx.pending}
                    onCheckedChange={(v) => void toggle(s, v)}
                    size="sm"
                    data-testid="mtsr-source-toggle"
                  />
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Backoffice
// ---------------------------------------------------------------------------
type ItemState = { status: ComponentStatus | ""; observation: string };

function BackofficeSection({ data, ctx }: { data: MtsrIngestionData; ctx: MtsrPanelContext }) {
  const { toast } = useToast();
  const components = React.useMemo(
    () => data.catalog.components.filter((c) => c.verificationMode === "backoffice" && c.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
    [data.catalog.components],
  );
  const [search, setSearch] = React.useState("");
  const [vehicle, setVehicle] = React.useState<MtsrVehicleOption | null>(null);
  const [referenceDate, setReferenceDate] = React.useState(data.catalog.today);
  const [sourceSystem, setSourceSystem] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [items, setItems] = React.useState<Record<string, ItemState>>({});
  const [touched, setTouched] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const matches = React.useMemo(() => {
    const q = search.trim().toUpperCase();
    if (q.length < 2) return [];
    return ctx.options.vehicles.filter((v) => v.plate.toUpperCase().includes(q) || (v.fleetCode ?? "").toUpperCase().includes(q)).slice(0, 20);
  }, [ctx.options.vehicles, search]);

  const item = (id: string): ItemState => items[id] ?? { status: "", observation: "" };
  const setItem = (id: string, patch: Partial<ItemState>) => setItems((prev) => ({ ...prev, [id]: { ...item(id), ...patch } }));
  const filled = components.filter((c) => item(c.id).status !== "");
  const missingObs = filled.filter((c) => item(c.id).status === "nok" && !item(c.id).observation.trim());

  const submit = async () => {
    setTouched(true);
    if (!vehicle || filled.length === 0 || missingObs.length > 0) return;
    setBusy(true);
    const r = await updateBackofficeStatus({
      vehicleId: vehicle.id,
      referenceDate: referenceDate || null,
      sourceSystem: sourceSystem.trim() || null,
      reference: reference.trim() || null,
      items: filled.map((c) => ({ componentId: c.id, status: item(c.id).status as ComponentStatus, observation: item(c.id).observation.trim() || null })),
    });
    setBusy(false);
    if (!r.ok || !r.data) {
      toast({ title: "Não foi possível atualizar o backoffice", description: r.error, variant: "danger" });
      return;
    }
    toast({
      title: `Backoffice atualizado para ${vehicle.plate}`,
      description: `${fmtInt(r.data.applied)} ${plural(r.data.applied, "componente aplicado", "componentes aplicados")}. Leituras mais antigas que a atual ou iguais são ignoradas pela rotina.`,
      variant: "success",
    });
    setItems({});
    setTouched(false);
    ctx.refresh();
  };

  if (components.length === 0) {
    return (
      <PanelEmpty
        icon={<Database />}
        title="Nenhum componente de backoffice ativo"
        description="A atualização manual vale só para componentes com modo de verificação Backoffice. Cadastre ou ative um em Cadastros › Componentes."
        testId="mtsr-backoffice-empty"
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3" data-testid="mtsr-backoffice">
      <Card className="xl:col-span-1">
        <CardHeader title="Veículo" description="Busque pela placa ou pelo código da frota (lista do cadastro oficial)." />
        <CardContent className="flex flex-col gap-3">
          <SearchField
            size="sm"
            value={search}
            onValueChange={setSearch}
            placeholder="Placa ou frota"
            aria-label="Buscar veículo"
            data-testid="mtsr-backoffice-search"
          />
          {vehicle ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-border-emphasis bg-surface-selected px-3 py-2" data-testid="mtsr-backoffice-vehicle">
              <span className="font-semibold text-fg tabular-nums">
                {vehicle.plate}
                {vehicle.fleetCode ? <span className="ml-1 font-normal text-fg-muted">· {vehicle.fleetCode}</span> : null}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setVehicle(null)}>Trocar</Button>
            </div>
          ) : null}
          {!vehicle && search.trim().length >= 2 ? (
            matches.length === 0 ? (
              <p className="text-body-sm text-fg-muted">Nenhum veículo com “{search.trim()}”.</p>
            ) : (
              <ul className="max-h-64 overflow-auto rounded-md border border-border" role="listbox" aria-label="Veículos encontrados">
                {matches.map((v) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => setVehicle(v)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-body-sm hover:bg-surface-hover hfm-focus-ring"
                      data-testid="mtsr-backoffice-vehicle-option"
                    >
                      <span className="font-medium text-fg tabular-nums">{v.plate}</span>
                      <span className="text-caption text-fg-muted">{[v.fleetCode, v.status !== "active" ? "inativo" : null].filter(Boolean).join(" · ")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : !vehicle ? (
            <p className="flex items-center gap-1.5 text-caption text-fg-muted"><Search className="size-3.5" aria-hidden />Digite pelo menos 2 caracteres.</p>
          ) : null}
          <FormGrid columns={1}>
            <FormField label="Data de referência" helperText="Data a que a leitura se refere; leitura mais antiga que a atual é ignorada.">
              <DateInput size="sm" value={referenceDate} max={data.catalog.today} onChange={(e) => setReferenceDate(e.target.value)} />
            </FormField>
            <FormField label="Sistema de origem" labelHint="Opcional">
              <Input size="sm" value={sourceSystem} onChange={(e) => setSourceSystem(e.target.value)} placeholder="Ex.: planilha da central, portal do fornecedor" />
            </FormField>
            <FormField label="Referência" labelHint="Opcional" helperText="Número de chamado, protocolo ou identificador externo.">
              <Input size="sm" value={reference} onChange={(e) => setReference(e.target.value)} />
            </FormField>
          </FormGrid>
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader
          title="Atualização manual do backoffice"
          description="Informe o estado lido de cada componente de backoffice. Só os componentes marcados são enviados; NOK exige observação."
        />
        <CardContent className="flex flex-col gap-3">
          <ul className="flex flex-col divide-y divide-border-subtle">
            {components.map((c) => (
              <BackofficeItem
                key={c.id}
                component={c}
                state={item(c.id)}
                error={touched && item(c.id).status === "nok" && !item(c.id).observation.trim() ? "Observação obrigatória em NOK." : undefined}
                onChange={(patch) => setItem(c.id, patch)}
                disabled={busy}
              />
            ))}
          </ul>
          {touched && !vehicle ? <p className="text-helper text-danger">Escolha um veículo.</p> : null}
          {touched && vehicle && filled.length === 0 ? <p className="text-helper text-danger">Marque pelo menos um componente.</p> : null}
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
            <Button variant="ghost" onClick={() => { setItems({}); setTouched(false); }} disabled={busy || filled.length === 0}>
              Limpar marcações
            </Button>
            <Button variant="primary" onClick={submit} loading={busy} disabled={!vehicle || filled.length === 0} data-testid="mtsr-backoffice-submit">
              Aplicar {filled.length ? `(${fmtInt(filled.length)})` : ""}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function BackofficeItem({
  component, state, error, onChange, disabled,
}: {
  component: MtsrComponent;
  state: ItemState;
  error?: string;
  onChange: (patch: Partial<ItemState>) => void;
  disabled: boolean;
}) {
  const groupId = React.useId();
  return (
    <li className="flex flex-col gap-2 py-3" data-testid="mtsr-backoffice-item" data-component={component.code}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p id={groupId} className="font-medium text-fg">{component.name}</p>
          {component.description ? <p className="text-caption text-fg-muted">{component.description}</p> : null}
        </div>
        <RadioGroup
          orientation="horizontal"
          aria-labelledby={groupId}
          value={state.status}
          onValueChange={(v) => onChange({ status: v as ComponentStatus })}
          disabled={disabled}
          className="gap-3"
        >
          {(["ok", "nok", "sem_informacao"] as ComponentStatus[]).map((code) => {
            const id = `${groupId}-${code}`;
            return (
              <label key={code} htmlFor={id} className={cn("inline-flex cursor-pointer items-center gap-1.5 text-body-sm", disabled && "cursor-not-allowed text-fg-disabled")}>
                <RadioGroupItem id={id} value={code} data-testid={`mtsr-backoffice-${code}`} />
                {COMPONENT_STATUS_LABEL[code]}
              </label>
            );
          })}
          {state.status ? (
            <Button size="sm" variant="ghost" onClick={() => onChange({ status: "" })} disabled={disabled} aria-label={`Desmarcar ${component.name}`}>
              Desmarcar
            </Button>
          ) : null}
        </RadioGroup>
      </div>
      {state.status ? (
        <FormField label="Observação" required={state.status === "nok"} error={error} className="max-w-xl">
          <Textarea
            rows={2}
            value={state.observation}
            onChange={(e) => onChange({ observation: e.target.value })}
            disabled={disabled}
            placeholder={state.status === "nok" ? "O que foi constatado" : "Opcional"}
          />
        </FormField>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------
const OUTCOMES: IngestionOutcome[] = ["applied", "ignored", "rejected", "conflict", "received"];

function EventsSection({ data, ctx }: { data: MtsrIngestionData; ctx: MtsrPanelContext }) {
  const { events, catalog } = data;
  const outcome = ctx.params.resultado ?? "";
  const source = ctx.params.fonte ?? "";
  return (
    <div className="flex flex-col gap-3" data-testid="mtsr-ingestion-events">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[10rem] flex-col gap-1">
          <span className="text-caption text-fg-muted">Resultado</span>
          <NativeSelect fieldSize="sm" value={outcome} disabled={ctx.pending} onChange={(e) => ctx.navigate({ resultado: e.target.value || null, pagina: null })} data-testid="mtsr-events-outcome">
            <option value="">Todos</option>
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>{INGESTION_OUTCOME_LABEL[o]}</option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex min-w-[12rem] flex-col gap-1">
          <span className="text-caption text-fg-muted">Fonte</span>
          <NativeSelect fieldSize="sm" value={source} disabled={ctx.pending} onChange={(e) => ctx.navigate({ fonte: e.target.value || null, pagina: null })} data-testid="mtsr-events-source">
            <option value="">Todas</option>
            {catalog.sources.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </NativeSelect>
        </label>
        <p className="ml-auto text-caption text-fg-muted">{fmtInt(events.total)} {plural(events.total, "evento", "eventos")}</p>
      </div>

      {events.rows.length === 0 ? (
        <PanelEmpty
          icon={<Radio />}
          title="Nenhum evento de ingestão"
          description={outcome || source ? "Nenhum evento corresponde aos filtros. Ajuste o resultado ou a fonte." : "Nenhuma leitura chegou pelas fontes ainda. Importações e atualizações de backoffice aparecem aqui."}
          testId="mtsr-events-empty"
        />
      ) : (
        <TableContainer stickyHeader className="max-h-[65vh]" data-testid="mtsr-events-table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recebido em</TableHead>
                <TableHead>Fonte</TableHead>
                <TableHead>Placa</TableHead>
                <TableHead>Componente</TableHead>
                <TableHead>Status lido</TableHead>
                <TableHead>Resultado</TableHead>
                <TableHead>Ator</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.rows.map((e) => (
                <TableRow key={e.id} data-testid="mtsr-event-row" data-outcome={e.status}>
                  <TableCell className="whitespace-nowrap tabular-nums text-fg-secondary">{formatStamp(e.receivedAt)}</TableCell>
                  <TableCell className="text-fg-secondary">
                    {catalog.sources.find((s) => s.id === e.sourceId)?.name ?? e.sourceCode ?? sourceTypeLabel(e.sourceType)}
                    {e.sourceSystem ? <span className="block text-caption text-fg-muted">{e.sourceSystem}</span> : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {e.vehicleId && e.licensePlate ? (
                      <PlateLink vehicleId={e.vehicleId} plate={e.licensePlate} />
                    ) : (
                      <span className="font-mono text-caption text-fg-muted" title="Placa como veio na leitura">{e.licensePlateRaw ?? "—"}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {e.componentName ?? <span className="font-mono text-caption text-fg-muted" title="Código como veio na leitura">{e.componentCodeRaw ?? "—"}</span>}
                  </TableCell>
                  <TableCell className="font-mono text-caption">{e.statusRaw ?? "—"}</TableCell>
                  <TableCell>
                    <span className="flex flex-col gap-0.5">
                      <IngestionOutcomeBadge value={e.status} size="sm" />
                      {e.outcomeReason ? <span className="text-caption text-fg-muted">{INGESTION_REASON_LABEL[e.outcomeReason] ?? e.outcomeReason}</span> : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-fg-secondary">
                    {e.actorName ?? "Sistema"}
                    {e.importBatchId ? <Badge variant="neutral" appearance="outline" size="sm" className="ml-1">lote</Badge> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <MtsrPagination ctx={ctx} total={events.total} limit={events.limit} label="Paginação dos eventos de ingestão" testId="mtsr-events-pagination" />
      <Alert variant="neutral" className="py-2">
        <AlertTitle>Como ler o resultado</AlertTitle>
        <AlertDescription>
          <strong>Aplicado</strong> mudou o estado oficial. <strong>Ignorado</strong> chegou, mas não mudou nada (sem mudança, leitura mais antiga ou fonte de
          menor prioridade). <strong>Rejeitado</strong> não pôde ser interpretado (veículo, componente ou status desconhecidos, data futura).{" "}
          <strong>Conflito</strong> divergiu de outra fonte na mesma data e ficou para análise.
        </AlertDescription>
      </Alert>
    </div>
  );
}
