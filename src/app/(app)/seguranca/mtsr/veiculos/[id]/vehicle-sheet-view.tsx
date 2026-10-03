"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, ClipboardCheck, History, Link2, Pencil, RefreshCw, Unlink, Wrench } from "lucide-react";
import { cn } from "@/lib/cn";
import { PageContent, PageHeader, PageHeaderContext } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Panel } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DateInput } from "@/components/ui/date-input";
import { RadioField, RadioGroup } from "@/components/ui/radio-group";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { useToast } from "@/components/feedback/toast";
import {
  ComponentStatusBadge,
  ConformityBadge,
  CriticalityBadge,
  DeadlineBadge,
  InspectionStatusBadge,
  RevalidationBadge,
  VerificationModeBadge,
} from "@/components/mtsr/badges";
import { LinkMaintenanceDialog, OpenMaintenanceDialog, UnlinkMaintenanceDialog } from "@/components/mtsr/maintenance-dialogs";
import { loadMtsrCatalog, loadVehicleSheet, updateBackofficeStatus } from "@/lib/mtsr/actions";
import {
  COMPONENT_STATUS_LABEL,
  INSPECTION_STATUS_LABEL,
  MTSR_BASE_PATH,
  REVALIDATION_LABEL,
  componentStatusLabel,
  eventTypeLabel,
  fmt1,
  fmtDays,
  fmtInt,
  formatDate,
  formatStamp,
  sourceTypeLabel,
  type ComponentStatus,
  type MtsrEvent,
  type MtsrParameterSet,
  type MtsrPerms,
  type MtsrSheetComponent,
  type MtsrSheetInspection,
  type MtsrSheetMaintenance,
  type MtsrVehicleSheet,
} from "@/lib/mtsr/types";
import { STATUS_LABEL, STATUS_TONE, type MaintenanceStatus } from "@/lib/maintenance/types";
import { VEHICLE_STATUS_LABELS } from "@/lib/fleet/columns";

/**
 * Ficha MTSR 360° de um veículo.
 *
 * Tudo vem da rotina `mtsr_vehicle_sheet` (veículo avaliado, componentes com
 * estado oficial e histórico, vistorias, manutenções vinculadas e eventos). A
 * tela só apresenta e dispara ações — abrir/vincular/desvincular manutenção e
 * atualizar componentes de backoffice — e recarrega a ficha depois de cada uma.
 */

export interface VehicleSheetViewProps {
  vehicleId: string;
  initial: MtsrVehicleSheet | null;
  error: string | null;
  perms: MtsrPerms;
}

const REVALIDATION_NOTE =
  "A conclusão de uma manutenção não torna o componente OK: ele fica Aguardando revalidação até nova vistoria ou leitura.";

const CONTEXT_SOURCE_LABEL: Record<string, string> = {
  fidelization: "Fidelização",
  allocation: "Vínculo operacional",
  none: "Sem contexto na data",
};

const LINK_TYPE_LABEL: Record<string, string> = {
  opened_from_nok: "Aberta pelo MTSR",
  linked_existing: "Vínculo a manutenção existente",
  import: "Importação",
};

const LINK_STATUS_LABEL: Record<string, string> = {
  active: "Vínculo ativo",
  unlinked: "Desvinculado",
};

const PRIORITY_LABEL: Record<string, string> = { low: "Baixa", medium: "Média", high: "Alta", critical: "Crítica" };

const maintenanceHref = (vehicleId: string, maintenanceId: string) =>
  `/frota/manutencao?aba=base&veiculo=${vehicleId}&m=${maintenanceId}`;

function MaintenanceStatusTag({ status, label }: { status: string; label?: string | null }) {
  const tone = STATUS_TONE[status as MaintenanceStatus] ?? "neutral";
  return (
    <StatusBadge status={tone} size="sm">
      {label || STATUS_LABEL[status as MaintenanceStatus] || status}
    </StatusBadge>
  );
}

// ---------------------------------------------------------------------------
// Resumo de payload: texto, nunca JSON cru
// ---------------------------------------------------------------------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PAYLOAD_KEY_LABEL: Record<string, string> = {
  status: "Status",
  previousStatus: "De",
  newStatus: "Para",
  result: "Resultado",
  officialStatus: "Status oficial",
  code: "Código",
  maintenanceCode: "Manutenção",
  maintenanceStatus: "Situação da manutenção",
  protocol: "Protocolo",
  referenceDate: "Referência",
  sourceType: "Fonte",
  sourceSystem: "Sistema de origem",
  source: "Origem",
  observation: "Observação",
  reason: "Motivo",
  priority: "Prioridade",
  description: "Descrição",
  services: "Serviços",
  serviceNames: "Serviços",
  duplicateJustification: "Justificativa",
  linkType: "Tipo de vínculo",
  revalidationStatus: "Revalidação",
  nokCount: "NOK",
  itemCount: "Itens",
  evidenceCount: "Fotos",
  applied: "Aplicados",
  skipped: "Ignorados",
  skippedStale: "Ignorados (mais antigos)",
  changed: "Alterados",
  nok: "NOK",
  inspectionDate: "Data da vistoria",
  componentName: "Componente",
  componentCode: "Componente",
  licensePlate: "Placa",
  actorName: "Responsável",
  retentionInspections: "Vistorias retidas",
  retentionDays: "Dias de retenção",
  purged: "Expurgadas",
  removed: "Removidas",
};

const STATUS_KEYS = new Set(["status", "previousStatus", "newStatus", "result", "officialStatus", "maintenanceStatus", "revalidationStatus"]);

function anyStatusLabel(value: string): string {
  return (
    COMPONENT_STATUS_LABEL[value as ComponentStatus] ??
    STATUS_LABEL[value as MaintenanceStatus] ??
    INSPECTION_STATUS_LABEL[value as keyof typeof INSPECTION_STATUS_LABEL] ??
    REVALIDATION_LABEL[value as keyof typeof REVALIDATION_LABEL] ??
    humanize(value)
  );
}

function humanize(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

function payloadValue(key: string, value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "number") return Number.isInteger(value) ? fmtInt(value) : fmt1(value);
  if (typeof value === "string") {
    if (UUID_RE.test(value)) return null;
    if (STATUS_KEYS.has(key)) return anyStatusLabel(value);
    if (key === "sourceType" || key === "source") return sourceTypeLabel(value);
    if (key === "priority") return PRIORITY_LABEL[value] ?? value;
    if (key === "linkType") return LINK_TYPE_LABEL[value] ?? value;
    if (/(Date|On)$/.test(key) || key === "date") return formatDate(value);
    if (/At$/.test(key)) return formatStamp(value);
    return value.length > 140 ? `${value.slice(0, 137)}…` : value;
  }
  if (Array.isArray(value)) {
    const items = value
      .filter((v): v is string | number => typeof v === "string" || typeof v === "number")
      .map(String)
      .filter((v) => !UUID_RE.test(v));
    if (items.length) return items.join(", ");
    return value.length ? `${fmtInt(value.length)} ${value.length === 1 ? "item" : "itens"}` : null;
  }
  // Objetos aninhados não entram no resumo: o detalhe está na própria entidade.
  return null;
}

function summarizePayload(payload: Record<string, unknown> | null, max = 6): string[] {
  if (!payload) return [];
  const out: string[] = [];
  for (const [key, raw] of Object.entries(payload)) {
    if (key === "id" || /Id$/.test(key) || /Ids$/.test(key)) continue;
    const value = payloadValue(key, raw);
    if (value == null) continue;
    out.push(`${PAYLOAD_KEY_LABEL[key] ?? humanize(key)}: ${value}`);
    if (out.length >= max) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cartão de KM (km_vehicle_card): só o que existir, lido com segurança
// ---------------------------------------------------------------------------
type CardKind = "km" | "date" | "stamp" | "text";
const CARD_FIELDS: { keys: string[]; label: string; kind: CardKind }[] = [
  { keys: ["currentKm", "kmCurrent", "odometerKm", "odometer", "km"], label: "KM atual", kind: "km" },
  { keys: ["currentKmDate", "lastReadingDate", "lastKmDate", "kmDate"], label: "Última leitura", kind: "date" },
  { keys: ["lastReadingAt", "kmUpdatedAt", "updatedAt"], label: "Atualizado em", kind: "stamp" },
  { keys: ["kmSource", "lastReadingSource"], label: "Fonte da leitura", kind: "text" },
  { keys: ["kmStatus"], label: "Situação do KM", kind: "text" },
];

function cardFacts(card: Record<string, unknown> | null): { label: string; value: string }[] {
  if (!card) return [];
  const out: { label: string; value: string }[] = [];
  for (const field of CARD_FIELDS) {
    const key = field.keys.find((k) => card[k] != null && card[k] !== "");
    if (!key) continue;
    const raw = card[key];
    if (typeof raw !== "string" && typeof raw !== "number") continue;
    let value: string;
    if (field.kind === "km") value = typeof raw === "number" ? `${fmtInt(raw)} km` : `${raw} km`;
    else if (field.kind === "date") value = formatDate(String(raw));
    else if (field.kind === "stamp") value = formatStamp(String(raw));
    else value = String(raw);
    out.push({ label: field.label, value });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------
type DialogState =
  | { kind: "open"; component: MtsrSheetComponent }
  | { kind: "link"; component: MtsrSheetComponent }
  | { kind: "backoffice"; component: MtsrSheetComponent }
  | { kind: "unlink"; maintenance: MtsrSheetMaintenance }
  | null;

export function VehicleSheetView({ vehicleId, initial, error: initialError, perms }: VehicleSheetViewProps) {
  const [sheet, setSheet] = React.useState<MtsrVehicleSheet | null>(initial);
  const [error, setError] = React.useState<string | null>(initialError);
  const [pending, startTransition] = React.useTransition();
  const [dialog, setDialog] = React.useState<DialogState>(null);
  const [parameters, setParameters] = React.useState<MtsrParameterSet | null>(null);

  const reload = React.useCallback(() => {
    startTransition(async () => {
      const result = await loadVehicleSheet(vehicleId);
      if (result.ok && result.data) {
        setSheet(result.data);
        setError(null);
      } else {
        setError(result.error ?? "Não foi possível recarregar a ficha MTSR.");
      }
    });
  }, [vehicleId]);

  // Parâmetros vigentes (regra de prazo) — leitura secundária, sem bloquear a ficha.
  React.useEffect(() => {
    let alive = true;
    void loadMtsrCatalog().then((result) => {
      if (alive && result.ok && result.data) setParameters(result.data.parameters);
    });
    return () => {
      alive = false;
    };
  }, []);

  const vehicle = sheet?.vehicle ?? null;
  const plate = vehicle?.licensePlate ?? "Veículo";

  const breadcrumb = (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <span>Segurança</span>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link href={MTSR_BASE_PATH}>Gestão de MTSR</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{plate}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );

  const refreshButton = (
    <Button type="button" variant="secondary" size="sm" leadingIcon={<RefreshCw />} onClick={reload} loading={pending} data-testid="mtsr-sheet-refresh">
      Atualizar
    </Button>
  );

  if (!sheet || !vehicle) {
    return (
      <div data-testid="mtsr-sheet">
        <PageHeader breadcrumb={breadcrumb} title="Ficha MTSR" description="Visão 360° do veículo no MTSR." secondaryActions={refreshButton} />
        <PageContent>
          {error ? (
            <ErrorState
              variant="page"
              title="Não foi possível abrir a ficha MTSR"
              description="A rotina do MTSR não respondeu. Tente de novo; se persistir, avise o suporte."
              details={error}
              onRetry={reload}
              retrying={pending}
            />
          ) : (
            <EmptyState
              variant="panel"
              title="Veículo fora do escopo do MTSR"
              description="Este veículo não está na frota avaliada pelo MTSR ou está fora do seu escopo de acesso."
            />
          )}
        </PageContent>
      </div>
    );
  }

  const facts = sheet.facts;
  const kmFacts = cardFacts(sheet.card);
  const lastValidInspection = facts?.lastValidInspectionId ? sheet.inspections.find((i) => i.id === facts.lastValidInspectionId) ?? null : null;

  const afterAction = () => {
    setDialog(null);
    reload();
  };

  return (
    <div data-testid="mtsr-sheet" className="flex flex-col">
      <PageHeader
        breadcrumb={breadcrumb}
        title={vehicle.fleetCode ? `${vehicle.licensePlate} · Frota ${vehicle.fleetCode}` : vehicle.licensePlate}
        meta={
          <span className="flex flex-wrap items-center gap-1.5" data-testid="mtsr-sheet-status">
            <ConformityBadge value={vehicle.conformityStatus} />
            <CriticalityBadge value={vehicle.criticality} />
            <DeadlineBadge value={vehicle.deadlineStatus} />
          </span>
        }
        description="Ficha 360° do veículo no MTSR: estado oficial por componente, vistorias recebidas, manutenções vinculadas e linha do tempo."
        context={
          <>
            <PageHeaderContext label="Última vistoria válida">
              {facts?.lastValidInspectionDate ? `${formatDate(facts.lastValidInspectionDate)} · ${fmtDays(vehicle.daysSince)}` : "Nenhuma"}
            </PageHeaderContext>
            <PageHeaderContext label="Componentes NOK">{fmtInt(vehicle.nokCount)}</PageHeaderContext>
            <PageHeaderContext label="Manutenções abertas">{fmtInt(vehicle.openMaintenances)}</PageHeaderContext>
            <PageHeaderContext label="Hoje">{formatDate(sheet.today)}</PageHeaderContext>
          </>
        }
        secondaryActions={refreshButton}
      />

      <PageContent className="flex flex-col gap-6">
        {error ? (
          <Alert variant="danger">
            <AlertTitle>A ficha pode estar desatualizada</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-2">
              {error}
              <Button type="button" size="sm" variant="secondary" onClick={reload} loading={pending}>
                Tentar de novo
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <Alert variant="info" data-testid="mtsr-sheet-revalidation-note">
          <AlertDescription>{REVALIDATION_NOTE}</AlertDescription>
        </Alert>

        <div aria-busy={pending} className={cn("flex flex-col gap-6", pending && "opacity-70 transition-opacity")}>
          {/* ------------------------------------------------ veículo ---- */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Veículo" meta={VEHICLE_STATUS_LABELS[vehicle.vehicleStatus] ?? vehicle.vehicleStatus} data-testid="mtsr-sheet-vehicle">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                <Fact label="Tipo">{vehicle.vehicleTypeName ?? "—"}</Fact>
                <Fact label="Subcategoria">{vehicle.subcategoryName ?? "—"}</Fact>
                <Fact label="Modelo">{vehicle.modelName ?? "—"}</Fact>
                <Fact label="Operação">{vehicle.operationName ?? "—"}</Fact>
                <Fact label="Cidade / UF">
                  {vehicle.cityName ? `${vehicle.cityName}${vehicle.stateUf ? ` / ${vehicle.stateUf}` : ""}` : (vehicle.stateUf ?? "—")}
                </Fact>
                <Fact label="BR">{vehicle.brCode ?? "—"}</Fact>
                <Fact label="Liderança">{vehicle.leaderName ?? "—"}</Fact>
                <Fact label="Filial">{vehicle.unitName ?? "—"}</Fact>
                <Fact label="Origem do contexto">
                  {vehicle.contextSource ? (CONTEXT_SOURCE_LABEL[vehicle.contextSource] ?? humanize(vehicle.contextSource)) : "—"}
                </Fact>
                {kmFacts.map((f) => (
                  <Fact key={f.label} label={f.label}>
                    {f.value}
                  </Fact>
                ))}
              </dl>
            </Panel>

            <Panel title="Última vistoria válida" meta={facts?.lastValidInspectionDate ? fmtDays(vehicle.daysSince) : "nenhuma"} data-testid="mtsr-sheet-last-inspection">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                <Fact label="Data">{formatDate(facts?.lastValidInspectionDate)}</Fact>
                <Fact label="Dias desde">{fmtDays(vehicle.daysSince)}</Fact>
                <Fact label="Prazo">
                  <DeadlineBadge value={vehicle.deadlineStatus} size="sm" />
                </Fact>
                <Fact label="Fonte">{sourceTypeLabel(facts?.lastValidSource)}</Fact>
                <Fact label="Protocolo">{lastValidInspection?.protocol ?? "—"}</Fact>
                <Fact label="Último envio">{formatStamp(facts?.lastSubmissionAt)}</Fact>
                <Fact label="Vistorias pendentes">{fmtInt(vehicle.pendingInspections)}</Fact>
                <Fact label="Componentes aguardando revalidação">{fmtInt(vehicle.awaitingCount)}</Fact>
                <Fact label="Regra vigente">
                  {parameters
                    ? `Conforme até ${fmtInt(parameters.conformeMaxDays)} dias · Atenção de ${fmtInt(parameters.attentionMinDays)} a ${fmtInt(parameters.attentionMaxDays)} dias · Vencido depois`
                    : "—"}
                </Fact>
              </dl>
            </Panel>
          </div>

          {/* --------------------------------------------- componentes --- */}
          <section className="flex flex-col gap-3" aria-labelledby="mtsr-sheet-components-title">
            <SectionHeader
              headingId="mtsr-sheet-components-title"
              title="Componentes"
              description="Estado oficial por componente, na ordem do catálogo. Fonte, referência e histórico vêm da rotina do MTSR."
              actions={
                <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption">
                  <Counter label="OK">{vehicle.okCount}</Counter>
                  <Counter label="NOK">{vehicle.nokCount}</Counter>
                  <Counter label="Sem informação">{vehicle.unknownCount}</Counter>
                  <Counter label="Aguardando revalidação">{vehicle.awaitingCount}</Counter>
                </dl>
              }
            />
            {sheet.components.length === 0 ? (
              <EmptyState variant="panel" size="sm" title="Nenhum componente ativo no catálogo" description="Cadastre componentes em Gestão de MTSR › Cadastros." />
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Componentes MTSR">
                {sheet.components.map((c) => (
                  <li key={c.componentId}>
                    <ComponentCard
                      component={c}
                      vehicleId={vehicleId}
                      perms={perms}
                      onOpen={() => setDialog({ kind: "open", component: c })}
                      onLink={() => setDialog({ kind: "link", component: c })}
                      onBackoffice={() => setDialog({ kind: "backoffice", component: c })}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* --------------------------------------------------- abas ---- */}
          <Tabs defaultValue="timeline" className="flex flex-col gap-4">
            <TabsList aria-label="Detalhes do veículo no MTSR">
              <TabsTrigger value="timeline" count={sheet.events.length} data-testid="mtsr-sheet-tab-timeline">
                Linha do tempo
              </TabsTrigger>
              <TabsTrigger value="inspections" count={sheet.inspections.length} data-testid="mtsr-sheet-tab-inspections">
                Vistorias
              </TabsTrigger>
              <TabsTrigger value="maintenances" count={sheet.maintenances.length} data-testid="mtsr-sheet-tab-maintenances">
                Manutenções
              </TabsTrigger>
            </TabsList>

            <TabsContent value="timeline">
              <TimelinePanel events={sheet.events} />
            </TabsContent>
            <TabsContent value="inspections">
              <InspectionsPanel inspections={sheet.inspections} />
            </TabsContent>
            <TabsContent value="maintenances">
              <MaintenancesPanel
                maintenances={sheet.maintenances}
                vehicleId={vehicleId}
                canUnlink={perms.maintenanceLink}
                onUnlink={(m) => setDialog({ kind: "unlink", maintenance: m })}
              />
            </TabsContent>
          </Tabs>
        </div>
      </PageContent>

      {dialog?.kind === "open" ? (
        <OpenMaintenanceDialog
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          vehicleId={vehicleId}
          componentId={dialog.component.componentId}
          componentName={dialog.component.name}
          onDone={afterAction}
        />
      ) : null}
      {dialog?.kind === "link" ? (
        <LinkMaintenanceDialog
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          vehicleId={vehicleId}
          componentId={dialog.component.componentId}
          componentName={dialog.component.name}
          onDone={afterAction}
        />
      ) : null}
      {dialog?.kind === "unlink" ? (
        <UnlinkMaintenanceDialog
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          linkId={dialog.maintenance.linkId}
          label={`${dialog.maintenance.code} · ${dialog.maintenance.componentName}`}
          onDone={afterAction}
        />
      ) : null}
      {dialog?.kind === "backoffice" ? (
        <BackofficeDialog
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          vehicleId={vehicleId}
          component={dialog.component}
          today={sheet.today}
          onDone={afterAction}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente (cartão)
// ---------------------------------------------------------------------------
function ComponentCard({
  component: c,
  vehicleId,
  perms,
  onOpen,
  onLink,
  onBackoffice,
}: {
  component: MtsrSheetComponent;
  vehicleId: string;
  perms: MtsrPerms;
  onOpen: () => void;
  onLink: () => void;
  onBackoffice: () => void;
}) {
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const isNok = c.status === "nok";
  const canOpen = isNok && !c.openMaintenance && perms.maintenanceOpen && perms.maintenanceCreate;
  const canLink = isNok && !c.openMaintenance && perms.maintenanceLink;
  const canBackoffice = c.verificationMode === "backoffice" && perms.backofficeUpdate;
  const historyId = `mtsr-history-${c.code}`;

  return (
    <article
      data-testid={`mtsr-sheet-component-${c.code}`}
      className={cn(
        "flex h-full flex-col gap-3 rounded-lg border bg-surface-raised p-4 shadow-card",
        isNok ? "border-danger/40" : c.awaitingRevalidation ? "border-warning/40" : "border-border",
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-body font-semibold text-fg">{c.name}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <VerificationModeBadge value={c.verificationMode} size="sm" />
            <CriticalityBadge value={c.baseCriticality} size="sm" />
          </div>
        </div>
        <ComponentStatusBadge value={c.status} awaiting={c.awaitingRevalidation} />
      </header>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-caption">
        <Mini label="Referência">{formatDate(c.referenceDate)}</Mini>
        <Mini label="Fonte">
          {sourceTypeLabel(c.sourceType)}
          {c.sourceSystem ? ` · ${c.sourceSystem}` : ""}
        </Mini>
        <Mini label="Status alterado em">{formatStamp(c.statusChangedAt)}</Mini>
        {c.awaitingRevalidation ? <Mini label="Aguardando desde">{formatStamp(c.awaitingSince)}</Mini> : null}
      </dl>

      {c.observation ? (
        <p className="text-caption text-fg-secondary">
          <span className="text-fg-muted">Observação: </span>
          {c.observation}
        </p>
      ) : null}

      {c.openMaintenance ? (
        <p className="flex flex-wrap items-center gap-1.5 text-caption">
          <Wrench aria-hidden className="size-3.5 text-fg-muted" />
          <span className="text-fg-muted">Manutenção aberta:</span>
          <Link
            href={maintenanceHref(vehicleId, c.openMaintenance.id)}
            className="font-mono font-semibold text-link hover:underline hfm-focus-ring"
            data-testid="mtsr-sheet-component-maintenance"
          >
            {c.openMaintenance.code}
          </Link>
          <MaintenanceStatusTag status={c.openMaintenance.status} label={c.openMaintenance.label} />
        </p>
      ) : null}

      {canOpen || canLink || canBackoffice ? (
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          {canOpen ? (
            <Button type="button" size="sm" variant="primary" leadingIcon={<Wrench />} onClick={onOpen} data-testid="mtsr-sheet-open-maintenance">
              Abrir manutenção
            </Button>
          ) : null}
          {canLink ? (
            <Button type="button" size="sm" variant="secondary" leadingIcon={<Link2 />} onClick={onLink} data-testid="mtsr-sheet-link-maintenance">
              Vincular manutenção
            </Button>
          ) : null}
          {canBackoffice ? (
            <Button type="button" size="sm" variant="outline" leadingIcon={<Pencil />} onClick={onBackoffice} data-testid="mtsr-sheet-backoffice-update">
              Atualizar (backoffice)
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className={cn("border-t border-border-subtle pt-2", !(canOpen || canLink || canBackoffice) && "mt-auto")}>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 text-caption text-fg-secondary hfm-focus-ring rounded-xs hover:text-fg"
          aria-expanded={historyOpen}
          aria-controls={historyId}
          onClick={() => setHistoryOpen((v) => !v)}
          data-testid="mtsr-sheet-component-history-toggle"
        >
          <span className="flex items-center gap-1.5">
            <History aria-hidden className="size-3.5" />
            Histórico ({fmtInt(c.history.length)})
          </span>
          {historyOpen ? <ChevronUp aria-hidden className="size-4" /> : <ChevronDown aria-hidden className="size-4" />}
        </button>
        {historyOpen ? (
          <div id={historyId} className="mt-2">
            {c.history.length === 0 ? (
              <p className="text-caption text-fg-muted">Nenhuma mudança de status registrada.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {c.history.map((h) => (
                  <li key={h.id} className="rounded-sm border border-border-subtle bg-surface px-2.5 py-2 text-caption">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-fg-muted">{h.previousStatus ? componentStatusLabel(h.previousStatus) : "Sem registro"}</span>
                      <span aria-hidden className="text-fg-muted">→</span>
                      <ComponentStatusBadge value={h.newStatus} size="sm" />
                    </div>
                    <p className="mt-1 text-fg-secondary">
                      Referência {formatDate(h.referenceDate)} · {sourceTypeLabel(h.sourceType)}
                      {h.sourceSystem ? ` (${h.sourceSystem})` : ""}
                      {h.actorName ? ` · ${h.actorName}` : ""} · {formatStamp(h.occurredAt)}
                    </p>
                    {h.observation ? <p className="mt-0.5 text-fg-secondary">{h.observation}</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </div>
        ) : null}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Linha do tempo
// ---------------------------------------------------------------------------
function TimelinePanel({ events }: { events: MtsrEvent[] }) {
  if (events.length === 0) {
    return (
      <EmptyState
        variant="panel"
        size="sm"
        title="Nenhum evento registrado"
        description="Vistorias, mudanças de status, manutenções e importações deste veículo aparecem aqui."
      />
    );
  }
  return (
    <ol className="flex flex-col gap-2" data-testid="mtsr-sheet-timeline" aria-label="Linha do tempo do veículo">
      {events.map((e) => {
        const summary = summarizePayload(e.payload);
        return (
          <li key={e.id} className="flex flex-col gap-1 rounded-md border border-border bg-surface-raised px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="text-body-sm font-medium text-fg">{eventTypeLabel(e.eventType)}</span>
              <time dateTime={e.occurredAt} className="text-caption tabular-nums text-fg-muted">
                {formatStamp(e.occurredAt)}
              </time>
            </div>
            <p className="text-caption text-fg-secondary">
              {e.componentName ? <span>{e.componentName} · </span> : null}
              {e.actorName ?? "Sistema"}
              {e.sourceType ? ` · ${sourceTypeLabel(e.sourceType)}` : ""}
            </p>
            {e.reason ? (
              <p className="text-caption text-fg-secondary">
                <span className="text-fg-muted">Motivo: </span>
                {e.reason}
              </p>
            ) : null}
            {summary.length ? <p className="text-caption text-fg-muted">{summary.join(" · ")}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Vistorias
// ---------------------------------------------------------------------------
function InspectionsPanel({ inspections }: { inspections: MtsrSheetInspection[] }) {
  if (inspections.length === 0) {
    return (
      <EmptyState
        variant="panel"
        size="sm"
        title="Nenhuma vistoria recebida"
        description="As vistorias enviadas pelo aplicativo Vistoria MTSR para este veículo aparecem aqui."
      />
    );
  }
  return (
    <ul className="flex flex-col gap-2" aria-label="Vistorias do veículo" data-testid="mtsr-sheet-inspections">
      {inspections.map((i) => (
        <li key={i.id}>
          <InspectionCard inspection={i} />
        </li>
      ))}
    </ul>
  );
}

function InspectionCard({ inspection: i }: { inspection: MtsrSheetInspection }) {
  const [open, setOpen] = React.useState(false);
  const itemsId = `mtsr-inspection-items-${i.id}`;
  return (
    <article className="flex flex-col gap-2 rounded-md border border-border bg-surface-raised p-3" data-testid={`mtsr-sheet-inspection-${i.protocol}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-mono text-caption font-semibold text-fg">{i.protocol}</span>
          <span className="text-caption text-fg-secondary">
            Vistoria em {formatDate(i.inspectionDate)} · enviada {formatStamp(i.submittedAt)}
          </span>
        </div>
        <InspectionStatusBadge value={i.status} />
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-caption sm:grid-cols-4">
        <Mini label="Inspetor">
          {i.inspectorName ?? "—"}
          {i.inspectorCode ? ` (${i.inspectorCode})` : ""}
        </Mini>
        <Mini label="Itens / NOK / fotos">
          {fmtInt(i.itemCount)} / {fmtInt(i.nokCount)} / {fmtInt(i.evidenceCount)}
        </Mini>
        <Mini label="Revisado por">{i.reviewerName ?? "—"}</Mini>
        <Mini label="Revisado em">{formatStamp(i.reviewedAt)}</Mini>
      </dl>
      {i.reviewReason ? (
        <p className="text-caption text-fg-secondary">
          <span className="text-fg-muted">Motivo da revisão: </span>
          {i.reviewReason}
        </p>
      ) : null}
      <div>
        <button
          type="button"
          className="flex items-center gap-1.5 text-caption text-link hfm-focus-ring rounded-xs hover:underline"
          aria-expanded={open}
          aria-controls={itemsId}
          onClick={() => setOpen((v) => !v)}
        >
          <ClipboardCheck aria-hidden className="size-3.5" />
          {open ? "Ocultar itens" : `Ver itens (${fmtInt(i.items.length)})`}
        </button>
        {open ? (
          <ul id={itemsId} className="mt-2 flex flex-col divide-y divide-border-subtle rounded-sm border border-border-subtle">
            {i.items.map((it) => (
              <li key={it.componentId} className="flex flex-wrap items-start justify-between gap-2 px-2.5 py-1.5 text-caption">
                <div className="min-w-0">
                  <span className="font-medium text-fg">{it.componentName}</span>
                  {it.observation ? <p className="text-fg-secondary">{it.observation}</p> : null}
                </div>
                <div className="flex items-center gap-1.5">
                  {it.evidenceCount > 0 ? (
                    <Badge variant="neutral" appearance="outline" size="sm">
                      {it.evidenceCount === 1 ? "1 foto" : `${fmtInt(it.evidenceCount)} fotos`}
                    </Badge>
                  ) : null}
                  <ComponentStatusBadge value={it.status} size="sm" />
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Manutenções
// ---------------------------------------------------------------------------
function MaintenancesPanel({
  maintenances,
  vehicleId,
  canUnlink,
  onUnlink,
}: {
  maintenances: MtsrSheetMaintenance[];
  vehicleId: string;
  canUnlink: boolean;
  onUnlink: (m: MtsrSheetMaintenance) => void;
}) {
  if (maintenances.length === 0) {
    return (
      <EmptyState
        variant="panel"
        size="sm"
        title="Nenhuma manutenção vinculada"
        description="Manutenções abertas a partir de componentes NOK ou vinculadas manualmente aparecem aqui."
      />
    );
  }
  return (
    <div className="flex flex-col gap-3" data-testid="mtsr-sheet-maintenances">
      <p className="text-caption text-fg-muted">{REVALIDATION_NOTE}</p>
      <ul className="flex flex-col gap-2" aria-label="Manutenções vinculadas">
        {maintenances.map((m) => (
          <li key={m.linkId} className="flex flex-col gap-2 rounded-md border border-border bg-surface-raised p-3" data-testid={`mtsr-sheet-maintenance-${m.code}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <Link href={maintenanceHref(vehicleId, m.maintenanceId)} className="font-mono text-caption font-semibold text-link hover:underline hfm-focus-ring">
                  {m.code}
                </Link>
                <MaintenanceStatusTag status={m.status} label={m.label} />
                <RevalidationBadge value={m.revalidationStatus} size="sm" />
                <Badge variant={m.linkStatus === "active" ? "info" : "neutral"} appearance="outline" size="sm">
                  {LINK_STATUS_LABEL[m.linkStatus] ?? humanize(m.linkStatus)}
                </Badge>
              </div>
              {canUnlink && m.linkStatus === "active" ? (
                <Button type="button" size="sm" variant="ghost" leadingIcon={<Unlink />} onClick={() => onUnlink(m)} data-testid="mtsr-sheet-unlink-maintenance">
                  Desvincular
                </Button>
              ) : null}
            </div>
            <p className="text-body-sm text-fg">
              {m.componentName}
              <span className="text-fg-muted"> · {LINK_TYPE_LABEL[m.linkType] ?? humanize(m.linkType)}</span>
            </p>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-caption sm:grid-cols-4">
              <Mini label="Solicitada em">{formatDate(m.requestedOn)}</Mini>
              <Mini label="Agendada para">{formatDate(m.scheduledDate)}</Mini>
              <Mini label="Saída">{formatDate(m.exitDate)}</Mini>
              <Mini label="Concluída em">{formatStamp(m.maintenanceConcludedAt)}</Mini>
              <Mini label="Revalidada em">{formatStamp(m.revalidatedAt)}</Mini>
              <Mini label="Fornecedor">{m.supplier ?? "—"}</Mini>
              <Mini label="Ordem de serviço">{m.serviceOrderNumber ?? "—"}</Mini>
              <Mini label="Vinculada em">{formatStamp(m.linkedAt)}</Mini>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Backoffice: atualizar estado oficial de um componente BACKOFFICE
// ---------------------------------------------------------------------------
type BackofficeStatus = "ok" | "nok" | "sem_informacao";

function BackofficeDialog({
  open,
  onOpenChange,
  vehicleId,
  component,
  today,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: string;
  component: MtsrSheetComponent;
  today: string;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [status, setStatus] = React.useState<BackofficeStatus>(component.status);
  const [observation, setObservation] = React.useState("");
  const [referenceDate, setReferenceDate] = React.useState(today);
  const [sourceSystem, setSourceSystem] = React.useState(component.sourceSystem ?? "");
  const [reference, setReference] = React.useState("");
  const [working, setWorking] = React.useState(false);
  const [touched, setTouched] = React.useState(false);

  const observationRequired = status === "nok";
  const observationError = touched && observationRequired && observation.trim().length === 0 ? "Descreva a não conformidade." : undefined;
  const dateError = touched && !referenceDate ? "Informe a data de referência." : undefined;

  const submit = async () => {
    setTouched(true);
    if ((observationRequired && !observation.trim()) || !referenceDate) return;
    setWorking(true);
    const result = await updateBackofficeStatus({
      vehicleId,
      referenceDate,
      sourceSystem: sourceSystem.trim() || null,
      reference: reference.trim() || null,
      items: [{ componentId: component.componentId, status, observation: observation.trim() || null }],
    });
    setWorking(false);
    if (result.ok) {
      toast({ variant: "success", title: `${component.name} atualizado`, description: `Status oficial: ${componentStatusLabel(status)}.` });
      onDone();
      return;
    }
    toast({ variant: "danger", title: "Não foi possível atualizar o componente", description: result.error });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && working) return;
        onOpenChange(next);
      }}
    >
      <DialogContent size="md" data-testid="mtsr-backoffice-dialog">
        <DialogHeader>
          <DialogTitle>Atualizar componente (backoffice)</DialogTitle>
          <DialogDescription>
            <strong className="font-semibold text-fg">{component.name}</strong> é verificado pelo backoffice. A leitura vale a partir da data de
            referência e passa pela regra de prioridade de fontes da rotina.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <FormField label="Status oficial" required>
            <RadioGroup value={status} onValueChange={(v) => setStatus(v as BackofficeStatus)} aria-label="Status oficial" className="flex flex-col gap-0.5">
              <RadioField value="ok" label="OK" description="Componente conforme na data de referência." disabled={working} />
              <RadioField value="nok" label="NOK" description="Não conforme — exige observação e, se houver permissão, abertura de manutenção." disabled={working} />
              <RadioField value="sem_informacao" label="Sem informação" description="Não foi possível verificar." disabled={working} />
            </RadioGroup>
          </FormField>
          <FormField
            label="Observação"
            required={observationRequired}
            labelHint={observationRequired ? undefined : "Opcional"}
            error={observationError}
          >
            <Textarea value={observation} onChange={(e) => setObservation(e.target.value)} rows={3} maxLength={500} disabled={working} data-testid="mtsr-backoffice-observation" />
          </FormField>
          <FormGrid columns={2}>
            <FormField label="Data de referência" required error={dateError}>
              <DateInput value={referenceDate} max={today} onChange={(e) => setReferenceDate(e.target.value)} disabled={working} />
            </FormField>
            <FormField label="Sistema de origem" labelHint="Opcional" helperText="Ex.: Geotab, MDVR, CFTV.">
              <Input value={sourceSystem} onChange={(e) => setSourceSystem(e.target.value)} maxLength={80} disabled={working} />
            </FormField>
          </FormGrid>
          <FormField label="Referência do registro" labelHint="Opcional" helperText="Número do laudo, chamado ou documento que embasa a leitura.">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} disabled={working} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={working}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" onClick={() => void submit()} loading={working} disabled={working} data-testid="mtsr-backoffice-submit">
            Salvar leitura
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Peças
// ---------------------------------------------------------------------------
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="text-body-sm font-medium break-words text-fg">{children}</dd>
    </div>
  );
}

function Mini({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="break-words text-fg tabular-nums">{children}</dd>
    </div>
  );
}

function Counter({ label, children }: { label: string; children: number }) {
  return (
    <div className="flex items-baseline gap-1">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="font-semibold tabular-nums text-fg">{fmtInt(children)}</dd>
    </div>
  );
}
