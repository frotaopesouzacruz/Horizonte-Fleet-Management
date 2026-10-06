"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Camera, ClipboardCheck, History, Recycle, Wrench } from "lucide-react";
import { cn } from "@/lib/cn";
import { PageContent, PageHeader, PageHeaderContext } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { Sparkline } from "@/components/charts/sparkline";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CONFIDENCE_LABEL, DEADLINE_LABEL, DEADLINE_TONE, DIVERGENCE_LABEL, DIVERGENCE_TONE, ENRICHMENT_LABEL, EVENT_TONE,
  INSPECTION_STATUS_SHORT, INSPECTION_STATUS_TONE, LAYOUT_SOURCE_LABEL, PSI_LABEL, PSI_TONE, RESOLUTION_LABEL, STATUS_LABEL, SYNC_LABEL,
  SYNC_TONE, eventTypeLabel, fmtDays, fmtInt, fmtKm, fmtMm, fmtNum, fmtPsi, formatDate, formatStamp, issueLabel, type CanonicalStatus,
  type DeadlineStatus, type TireRow, type TireSheet,
} from "@/lib/tires/types";
import { Fact, PlateLink, plural } from "../panels/tires-ui";
import { KmRealCell, SeverityBadge, TireStatusBadge, TreadClassBadge, fmtRodoparStamp } from "../panels/base-panel";

/**
 * Ficha 360° de um pneu (Nº Fogo).
 *
 * Tudo vem da rotina `tire_sheet`: o cadastro do pneu, a avaliação da última
 * fotografia em que ele aparece (sulco, PSI e prazos pela regra vigente), os
 * campos brutos do Rodopar, as fotografias anteriores, os eventos derivados
 * das importações, os consertos e as vistorias de campo. A tela só apresenta —
 * e a vistoria de campo nunca altera a fotografia oficial.
 */
export function TireSheetView({ sheet, basePath }: { sheet: TireSheet; basePath: string }) {
  const { tire, current, rodopar } = sheet;
  const backHref = `${basePath}?aba=base`;
  const absent = tire.presenceStatus === "absent";
  const outdated = Boolean(sheet.latestReferenceDate && tire.lastReferenceDate !== sheet.latestReferenceDate);

  return (
    <div className="flex flex-col" data-testid="tires-sheet">
      <PageHeader
        breadcrumb={<SheetBreadcrumb basePath={basePath} fireNumber={tire.fireNumber} />}
        title={`Nº Fogo ${tire.fireNumber}`}
        meta={
          <span className="flex flex-wrap items-center gap-1.5" data-testid="tires-sheet-status">
            <TireStatusBadge value={tire.currentStatus} size="md" />
            {absent ? (
              <StatusBadge status="warning" data-testid="tires-sheet-absent">
                Ausente do Rodopar desde {formatDate(tire.absentSince)}
              </StatusBadge>
            ) : null}
            {current ? <SeverityBadge value={current.severity} size="md" withLabel /> : null}
          </span>
        }
        description="Ficha 360° do pneu: estado na fotografia oficial do Rodopar, dados brutos do relatório, linha do tempo, fotografias anteriores, consertos e vistorias de campo."
        context={
          <>
            <PageHeaderContext label="Última fotografia">{formatDate(tire.lastReferenceDate)}</PageHeaderContext>
            <PageHeaderContext label="Primeira fotografia">{formatDate(tire.firstReferenceDate)}</PageHeaderContext>
            {current?.licensePlate || current?.fleetNumber ? (
              <PageHeaderContext label="Veículo">
                {[current.licensePlate, current.fleetNumber].filter(Boolean).join(" · ")}
                {current.positionCode ? ` · ${current.positionCode}` : ""}
              </PageHeaderContext>
            ) : null}
          </>
        }
        secondaryActions={
          <Button asChild variant="secondary" size="sm">
            <Link href={backHref} data-testid="tires-sheet-back">
              <ArrowLeft aria-hidden />
              Voltar à Base geral
            </Link>
          </Button>
        }
      />

      <PageContent className="flex flex-col gap-5">
        {absent || outdated ? (
          <Alert variant="warning" data-testid="tires-sheet-absent-alert">
            <AlertTitle>{absent ? `Ausente do Rodopar desde ${formatDate(tire.absentSince)}` : "Fora da fotografia mais recente"}</AlertTitle>
            <AlertDescription>
              Os dados abaixo são da última fotografia em que o pneu apareceu ({formatDate(tire.lastReferenceDate)})
              {outdated ? `; a fotografia oficial mais recente é de ${formatDate(sheet.latestReferenceDate)}` : ""}.
            </AlertDescription>
          </Alert>
        ) : null}

        {current?.retreadAlert ? (
          <Alert variant="warning" icon={<Recycle />} data-testid="tires-sheet-retread">
            <AlertTitle>Alerta de ressolagem</AlertTitle>
            <AlertDescription>
              O pneu atende ao critério de alerta de ressolagem dos Parâmetros vigentes
              {current.rodoparCondition ? ` (condição no Rodopar: ${current.rodoparCondition})` : ""}. É um alerta operacional para
              avaliação: não muda a situação do pneu nem a fotografia oficial.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-3">
          <CurrentPanel sheet={sheet} className="xl:col-span-2" />
          <div className="flex min-w-0 flex-col gap-4">
            <Panel title="Identificação" data-testid="tires-sheet-identity">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Fact label="Nº Fogo">
                  <span className="font-semibold tabular-nums">{tire.fireNumber}</span>
                </Fact>
                <Fact label="Situação">
                  <span className="flex flex-col items-start gap-0.5">
                    <TireStatusBadge value={tire.currentStatus} />
                    {tire.rodoparStatusRaw ? <span className="text-caption text-fg-muted">Rodopar: {tire.rodoparStatusRaw}</span> : null}
                  </span>
                </Fact>
                <Fact label="Presença no relatório">
                  {absent ? (
                    <span className="text-warning-soft-fg">Ausente do Rodopar desde {formatDate(tire.absentSince)}</span>
                  ) : (
                    "Presente na última importação"
                  )}
                </Fact>
                <Fact label="Vida">{tire.currentLife == null ? "—" : `${fmtInt(tire.currentLife)}ª vida`}</Fact>
                <Fact label="Marca">{tire.brand ?? "—"}</Fact>
                <Fact label="Modelo">{tire.model ?? "—"}</Fact>
                <Fact label="Dimensão">{tire.dimension ?? "—"}</Fact>
                <Fact label="DOT">{tire.dot ?? "—"}</Fact>
                <Fact label="Nº de série">{tire.serialNumber ?? "—"}</Fact>
                <Fact label="Desenho">{tire.drawing ?? "—"}</Fact>
                <Fact label="Borracha">{tire.rubber ?? "—"}</Fact>
                <Fact label="Compra">{formatDate(tire.purchaseDate)}</Fact>
                <Fact label="Cadastro">{formatDate(tire.registrationDate)}</Fact>
              </dl>
            </Panel>

            <Panel title="Dados do Rodopar" meta={`fotografia de ${formatDate(rodopar.referenceDate)}`} data-testid="tires-sheet-rodopar">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Fact label="Situação (bruta)">{rodopar.rodoparStatusRaw ?? "—"}</Fact>
                <Fact label="Status">{rodopar.rodoparStatusLabel ?? "—"}</Fact>
                <Fact label="Condição">{rodopar.rodoparCondition ?? "—"}</Fact>
                <Fact label="Classificação">{rodopar.rodoparClassification ?? "—"}</Fact>
                <Fact label="Frota (como veio)">{rodopar.fleetNumberRaw ?? "—"}</Fact>
                <Fact label="Filial do pneu / da frota">
                  {rodopar.rodoparTireBranch || rodopar.fleetBranch ? `${rodopar.rodoparTireBranch ?? "—"} / ${rodopar.fleetBranch ?? "—"}` : "—"}
                </Fact>
                <Fact label="Atualizado em">{fmtRodoparStamp(rodopar.rodoparUpdatedAt)}</Fact>
                <Fact label="Atualizado por">{rodopar.rodoparUpdatedBy ?? "—"}</Fact>
                <Fact label="Cadastrado em">{fmtRodoparStamp(rodopar.registrationAt)}</Fact>
                <Fact label="Cadastrado por">{rodopar.rodoparCreatedBy ?? "—"}</Fact>
                <Fact label="Medição registrada em">{fmtRodoparStamp(rodopar.measurementAt)}</Fact>
                <Fact label="Calibragem registrada em">{fmtRodoparStamp(rodopar.calibrationAt)}</Fact>
                <Fact label="Contexto no HFM">{ENRICHMENT_LABEL[rodopar.enrichmentStatus] ?? rodopar.enrichmentStatus}</Fact>
                <Fact label="Lote de importação">
                  <span className="font-mono text-caption" title={rodopar.importBatchId}>
                    {rodopar.importBatchId ? rodopar.importBatchId.slice(0, 8) : "—"}
                  </span>
                </Fact>
              </dl>
            </Panel>
          </div>
        </div>

        <Tabs defaultValue="timeline" className="flex flex-col gap-4">
          <TabsList aria-label="Histórico do pneu">
            <TabsTrigger value="timeline" count={sheet.events.length} data-testid="tires-sheet-tab-timeline">
              Linha do tempo
            </TabsTrigger>
            <TabsTrigger value="snapshots" count={sheet.snapshots.length} data-testid="tires-sheet-tab-snapshots">
              Fotografias
            </TabsTrigger>
            <TabsTrigger value="repairs" count={sheet.repairs.length} data-testid="tires-sheet-tab-repairs">
              Consertos
            </TabsTrigger>
            <TabsTrigger value="inspections" count={sheet.inspections.length} data-testid="tires-sheet-tab-inspections">
              Vistorias de campo
            </TabsTrigger>
          </TabsList>
          <TabsContent value="timeline">
            <Timeline events={sheet.events} />
          </TabsContent>
          <TabsContent value="snapshots">
            <Snapshots snapshots={sheet.snapshots} />
          </TabsContent>
          <TabsContent value="repairs">
            <Repairs repairs={sheet.repairs} />
          </TabsContent>
          <TabsContent value="inspections">
            <Inspections inspections={sheet.inspections} fireNumber={tire.fireNumber} basePath={basePath} />
          </TabsContent>
        </Tabs>
      </PageContent>
    </div>
  );
}

function SheetBreadcrumb({ basePath, fireNumber }: { basePath: string; fireNumber: string | null }) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <span>Gestão de Frota</span>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link href={`${basePath}?aba=base`}>Gestão de Pneus</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{fireNumber ? `Nº Fogo ${fireNumber}` : "Ficha do pneu"}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/** Falha ao ler a ficha: a página diz o que faltou e oferece tentar de novo. */
export function TireSheetError({ message, basePath }: { message: string; basePath: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  return (
    <div className="flex flex-col" data-testid="tires-sheet-error">
      <PageHeader breadcrumb={<SheetBreadcrumb basePath={basePath} fireNumber={null} />} title="Ficha do pneu" />
      <PageContent>
        <ErrorState
          variant="page"
          title="Não foi possível abrir a ficha do pneu"
          description="A rotina da Gestão de Pneus não respondeu. Tente de novo; se persistir, avise o suporte."
          details={message}
          onRetry={() => startTransition(() => router.refresh())}
          retrying={pending}
          action={
            <Button asChild variant="ghost">
              <Link href={`${basePath}?aba=base`}>Voltar à Base geral</Link>
            </Button>
          }
        />
      </PageContent>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estado atual
// ---------------------------------------------------------------------------
function SubBlock({ title, children, className, testId }: { title: string; children: React.ReactNode; className?: string; testId?: string }) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-2 rounded-md border border-border-subtle bg-surface p-3", className)} data-testid={testId}>
      <h4 className="text-label font-semibold text-fg">{title}</h4>
      {children}
    </section>
  );
}

function DeadlineBlock({ label, date, days, status, due, testId }: {
  label: string;
  date: string | null;
  days: number | null;
  status: DeadlineStatus;
  due: string | null;
  testId: string;
}) {
  return (
    <SubBlock title={label} testId={testId}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={DEADLINE_TONE[status]}>{DEADLINE_LABEL[status]}</StatusBadge>
      </div>
      <dl className="grid grid-cols-3 gap-x-3 gap-y-1">
        <Fact label="Último registro">{formatDate(date)}</Fact>
        <Fact label="Dias desde">{fmtDays(days)}</Fact>
        <Fact label="Vencimento">{formatDate(due)}</Fact>
      </dl>
    </SubBlock>
  );
}

function CurrentPanel({ sheet, className }: { sheet: TireSheet; className?: string }) {
  const c = sheet.current;
  if (!c) {
    return (
      <Panel title="Estado atual" className={className} data-testid="tires-sheet-current">
        <EmptyState
          size="sm"
          title="Sem avaliação na fotografia"
          description="A rotina não devolveu a avaliação deste pneu na última fotografia em que ele aparece."
        />
      </Panel>
    );
  }
  const layout = sheet.layout;
  const context = [c.operationName, c.cityName ? `${c.cityName}${c.stateUf ? `/${c.stateUf}` : ""}` : c.stateUf, c.brCode].filter(Boolean).join(" · ");
  const flags = c.qualityFlags ?? [];
  return (
    <Panel title="Estado atual" meta={`fotografia de ${formatDate(c.referenceDate)}`} className={className} data-testid="tires-sheet-current">
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Fact label="Veículo">
            {c.licensePlate || c.fleetNumber ? (
              <PlateLink vehicleId={c.vehicleId} plate={c.licensePlate} fleetCode={c.fleetNumber} testId="tires-sheet-plate" />
            ) : (
              <span className="text-fg-muted">Sem veículo</span>
            )}
          </Fact>
          <Fact label="Posição">
            {c.positionCode ? (
              <span className="flex flex-col leading-tight">
                <span className="font-semibold tabular-nums">{c.positionCode}</span>
                {c.positionLabel && c.positionLabel !== c.positionCode ? <span className="text-caption text-fg-muted">{c.positionLabel}</span> : null}
              </span>
            ) : (
              "—"
            )}
          </Fact>
          <Fact label="Tipo de equipamento">{c.vehicleTypeName ?? "—"}</Fact>
          <Fact label="Operação · local · BR">{context || "—"}</Fact>
          <Fact label="Liderança">{c.leaderName ?? "—"}</Fact>
          <Fact label="Layout do veículo">
            {layout ? `${layout.layoutName ?? "Sem layout cadastrado"} · ${LAYOUT_SOURCE_LABEL[layout.layoutSource] ?? layout.layoutSource}` : "—"}
          </Fact>
        </dl>

        <div className="grid gap-3 md:grid-cols-2">
          <TreadBlock row={c} />
          <SubBlock title="Pressão (PSI)" testId="tires-sheet-psi">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-h3 font-semibold tabular-nums text-fg">{c.psi == null ? "—" : fmtNum(c.psi)}</span>
              {c.psi != null ? <span className="text-caption text-fg-muted">PSI lido no Rodopar</span> : null}
              <StatusBadge status={PSI_TONE[c.psiStatus]} size="sm">
                {PSI_LABEL[c.psiStatus]}
              </StatusBadge>
            </div>
            {c.pressureRuleId && c.psiMin != null && c.psiMax != null ? (
              <p className="text-caption text-fg-secondary">
                Regra aplicável: mínimo {fmtPsi(c.psiMin)} · ideal {fmtPsi(c.psiIdeal)} · máximo {fmtPsi(c.psiMax)}
              </p>
            ) : (
              <p className="text-caption text-fg-secondary">Sem parâmetro de PSI para este pneu (tipo, dimensão e posição) — nunca contado como adequado.</p>
            )}
          </SubBlock>
          <DeadlineBlock
            label="Medição de sulco"
            date={c.measurementDate}
            days={c.measurementDays}
            status={c.measurementStatus}
            due={c.measurementDueDate}
            testId="tires-sheet-measurement"
          />
          <DeadlineBlock
            label="Calibragem"
            date={c.calibrationDate}
            days={c.calibrationDays}
            status={c.calibrationStatus}
            due={c.calibrationDueDate}
            testId="tires-sheet-calibration"
          />
          <SubBlock title="KM (Rodopar)" testId="tires-sheet-km">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
              <Fact label="KM rodado">{fmtKm(c.kmRodado)}</Fact>
              <Fact label="KM real">
                <KmRealCell value={c.kmReal} />
              </Fact>
            </dl>
            <p className="text-caption text-fg-muted">Informado pelo Rodopar; não substitui a Gestão de KM.</p>
          </SubBlock>
          <SubBlock title="Qualidade do dado" testId="tires-sheet-quality">
            {flags.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {flags.map((f) => (
                  <li key={f}>
                    <Badge variant="warning" size="sm" icon={<AlertTriangle />} className="h-auto min-h-5 whitespace-normal py-0.5">
                      {issueLabel(f)}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-caption text-fg-secondary">Nenhuma inconsistência apontada na importação.</p>
            )}
            <p className="text-caption text-fg-muted">
              {ENRICHMENT_LABEL[c.enrichmentStatus] ?? c.enrichmentStatus}
              {c.rodoparCondition ? ` · condição no Rodopar: ${c.rodoparCondition}` : ""}
            </p>
          </SubBlock>
        </div>
      </div>
    </Panel>
  );
}

function TreadBlock({ row: c }: { row: TireRow }) {
  const treads = [c.tread1, c.tread2, c.tread3, c.tread4];
  return (
    <SubBlock title="Sulco" testId="tires-sheet-tread">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-h3 font-semibold tabular-nums text-fg">{fmtMm(c.treadMin)}</span>
        <TreadClassBadge value={c.treadClass} />
      </div>
      <ul className="grid grid-cols-4 gap-1.5" aria-label="Sulcos medidos">
        {treads.map((t, i) => (
          <li
            key={i}
            className={cn(
              "flex flex-col items-center rounded-sm border px-1 py-1",
              t != null && c.treadMinCalculated != null && t === c.treadMinCalculated ? "border-border-strong bg-surface-sunken" : "border-border-subtle",
            )}
          >
            <span className="text-caption text-fg-muted">S{i + 1}</span>
            <span className="text-body-sm font-semibold tabular-nums text-fg">{fmtNum(t)}</span>
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-3 gap-x-3 gap-y-1">
        <Fact label="Mínimo calculado">{fmtMm(c.treadMinCalculated)}</Fact>
        <Fact label="Menor informado">{fmtMm(c.treadMinRaw)}</Fact>
        <Fact label="Limite legal">{fmtMm(c.legalTreadMm)}</Fact>
      </dl>
      {c.treadDivergence ? (
        <p className="flex items-start gap-1.5 text-caption text-warning-soft-fg" data-testid="tires-sheet-tread-divergence">
          <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning" />
          Divergência: o menor sulco informado pelo Rodopar ({fmtMm(c.treadMinRaw)}) difere do calculado a partir dos sulcos (
          {fmtMm(c.treadMinCalculated)}).
        </p>
      ) : null}
    </SubBlock>
  );
}

// ---------------------------------------------------------------------------
// Linha do tempo
// ---------------------------------------------------------------------------
type Fmt = (v: unknown) => string;
const asText: Fmt = (v) => (v == null || v === "" ? "—" : String(v));
const asMm: Fmt = (v) => (typeof v === "number" ? fmtMm(v) : asText(v));
const asPsi: Fmt = (v) => (typeof v === "number" ? fmtPsi(v) : asText(v));
const asDate: Fmt = (v) => (typeof v === "string" ? formatDate(v) : asText(v));
const asStatus: Fmt = (v) => (typeof v === "string" ? (STATUS_LABEL[v as CanonicalStatus] ?? v) : asText(v));
const asLife: Fmt = (v) => (typeof v === "number" ? `${fmtInt(v)}ª vida` : asText(v));

const CHANGE_FIELDS: { key: string; label: string; fmt: Fmt }[] = [
  { key: "status", label: "Situação", fmt: asStatus },
  { key: "fleetNumber", label: "Frota", fmt: asText },
  { key: "licensePlate", label: "Placa", fmt: asText },
  { key: "positionCode", label: "Posição", fmt: asText },
  { key: "life", label: "Vida", fmt: asLife },
  { key: "treadMin", label: "Sulco mínimo", fmt: asMm },
  { key: "treads", label: "Sulcos 1–4", fmt: asText },
  { key: "measurementDate", label: "Medição", fmt: asDate },
  { key: "psi", label: "PSI", fmt: asPsi },
  { key: "calibrationDate", label: "Calibragem", fmt: asDate },
  { key: "brand", label: "Marca", fmt: asText },
  { key: "model", label: "Modelo", fmt: asText },
  { key: "dimension", label: "Dimensão", fmt: asText },
  { key: "dot", label: "DOT", fmt: asText },
  { key: "serialNumber", label: "Nº de série", fmt: asText },
  { key: "drawing", label: "Desenho", fmt: asText },
  { key: "rubber", label: "Borracha", fmt: asText },
];

/** O que cada tipo de evento mudou (os demais campos vêm de outros eventos da mesma importação). */
const EVENT_FIELDS: Record<string, string[]> = {
  TIRE_MEASURED: ["treadMin", "treads", "measurementDate"],
  TIRE_PRESSURE_UPDATED: ["psi", "calibrationDate"],
  TIRE_MOVED: ["fleetNumber", "licensePlate", "positionCode"],
  TIRE_POSITION_CHANGED: ["positionCode"],
  TIRE_LIFE_CHANGED: ["life"],
  TIRE_STATUS_CHANGED: ["status", "fleetNumber", "licensePlate", "positionCode"],
  TIRE_REMOVED: ["status", "fleetNumber", "licensePlate", "positionCode"],
  TIRE_RETURNED_TO_STOCK: ["status", "fleetNumber", "licensePlate", "positionCode"],
  TIRE_SENT_TO_RETREAD: ["status", "fleetNumber", "licensePlate", "positionCode"],
  TIRE_DISCARDED: ["status", "fleetNumber", "licensePlate", "positionCode"],
  TIRE_IMPORTED: ["brand", "model", "dimension", "dot", "serialNumber", "drawing", "rubber"],
};
const CREATED_FIELDS = ["status", "fleetNumber", "licensePlate", "positionCode", "life", "treadMin", "psi"];

const SOURCE_LABEL: Record<string, string> = { rodopar_import: "Importação Rodopar", system: "Sistema" };

function fieldValue(obj: Record<string, unknown>, key: string): unknown {
  if (key === "treads") {
    const t = [obj.tread1, obj.tread2, obj.tread3, obj.tread4];
    return t.every((v) => v == null) ? null : t.map((v) => (typeof v === "number" ? fmtNum(v) : "—")).join(" / ");
  }
  return obj[key];
}

function eventChanges(type: string, previous: Record<string, unknown>, current: Record<string, unknown>) {
  const prev = previous ?? {};
  const cur = current ?? {};
  if (Object.keys(prev).length === 0) {
    return CREATED_FIELDS.map((k) => CHANGE_FIELDS.find((f) => f.key === k)!)
      .filter((f) => fieldValue(cur, f.key) != null && fieldValue(cur, f.key) !== "")
      .map((f) => ({ label: f.label, from: null as string | null, to: f.fmt(fieldValue(cur, f.key)) }));
  }
  const differs = (k: string) => JSON.stringify(fieldValue(prev, k) ?? null) !== JSON.stringify(fieldValue(cur, k) ?? null);
  const wanted = EVENT_FIELDS[type];
  let fields = CHANGE_FIELDS.filter((f) => (!wanted || wanted.includes(f.key)) && differs(f.key));
  if (fields.length === 0 && wanted) fields = CHANGE_FIELDS.filter((f) => differs(f.key));
  return fields.map((f) => ({ label: f.label, from: f.fmt(fieldValue(prev, f.key)), to: f.fmt(fieldValue(cur, f.key)) }));
}

function Timeline({ events }: { events: TireSheet["events"] }) {
  if (events.length === 0) {
    return (
      <EmptyState
        variant="panel"
        size="sm"
        icon={<History />}
        title="Nenhum evento registrado"
        description="Movimentações, medições, calibragens e mudanças de situação detectadas nas importações do Rodopar aparecem aqui."
      />
    );
  }
  return (
    <ol className="flex flex-col" aria-label="Linha do tempo do pneu" data-testid="tires-sheet-timeline">
      {events.map((e, i) => {
        const changes = eventChanges(e.eventType, e.previous, e.current);
        const tone = EVENT_TONE[e.eventType] ?? "neutral";
        return (
          <li key={e.id} className="relative flex gap-3 pb-3 last:pb-0" data-testid="tires-sheet-event" data-type={e.eventType}>
            <div className="flex flex-col items-center" aria-hidden>
              <span className="mt-3 size-2.5 shrink-0 rounded-full border-2 border-surface bg-border-strong ring-1 ring-border" />
              {i < events.length - 1 ? <span className="w-px flex-1 bg-border" /> : null}
            </div>
            <article className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-md border border-border bg-surface-raised px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <StatusBadge status={tone} size="sm">
                  {eventTypeLabel(e.eventType)}
                </StatusBadge>
                <span className="text-caption tabular-nums text-fg-muted">
                  Fotografia de {formatDate(e.referenceDate)} · {SOURCE_LABEL[e.source] ?? e.source}
                </span>
              </div>
              {changes.length ? (
                <ul className="flex flex-col gap-0.5 text-caption">
                  {changes.map((c) => (
                    <li key={c.label} className="flex flex-wrap items-baseline gap-x-1.5">
                      <span className="text-fg-muted">{c.label}:</span>
                      {c.from != null ? (
                        <>
                          <span className="tabular-nums text-fg-secondary">{c.from}</span>
                          <span aria-hidden className="text-fg-muted">→</span>
                          <span className="sr-only">para</span>
                        </>
                      ) : null}
                      <span className="font-medium tabular-nums text-fg">{c.to}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {e.note ? <p className="text-caption text-fg-secondary">{e.note}</p> : null}
              <p className="text-caption text-fg-muted">Registrado em {formatStamp(e.occurredAt)}</p>
            </article>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Fotografias
// ---------------------------------------------------------------------------
function Snapshots({ snapshots }: { snapshots: TireSheet["snapshots"] }) {
  if (snapshots.length === 0) {
    return (
      <EmptyState variant="panel" size="sm" icon={<Camera />} title="Nenhuma fotografia" description="As fotografias do Rodopar em que o pneu aparece ficam aqui." />
    );
  }
  const chrono = [...snapshots].reverse();
  const withTread = chrono.filter((s) => s.treadMin != null);
  const first = withTread[0];
  const last = withTread[withTread.length - 1];
  return (
    <div className="flex flex-col gap-3" data-testid="tires-sheet-snapshots">
      {withTread.length >= 2 && first && last ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border bg-surface-raised px-3 py-2.5" data-testid="tires-sheet-tread-trend">
          <Sparkline
            values={chrono.map((s) => s.treadMin)}
            width={180}
            height={40}
            ariaLabel={`Sulco mínimo nas fotografias: de ${fmtMm(first.treadMin)} em ${formatDate(first.referenceDate)} a ${fmtMm(last.treadMin)} em ${formatDate(last.referenceDate)}`}
          />
          <p className="text-caption text-fg-secondary">
            Sulco mínimo nas fotografias:{" "}
            <span className="font-medium tabular-nums text-fg">{fmtMm(first.treadMin)}</span> em {formatDate(first.referenceDate)} →{" "}
            <span className="font-medium tabular-nums text-fg">{fmtMm(last.treadMin)}</span> em {formatDate(last.referenceDate)}
          </p>
        </div>
      ) : null}
      <TableContainer>
        <Table className="text-caption">
          <TableHeader>
            <TableRow>
              <TableHead>Fotografia</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Veículo</TableHead>
              <TableHead>Posição</TableHead>
              <TableHead numeric>Vida</TableHead>
              <TableHead numeric>S1</TableHead>
              <TableHead numeric>S2</TableHead>
              <TableHead numeric>S3</TableHead>
              <TableHead numeric>S4</TableHead>
              <TableHead numeric>Mínimo</TableHead>
              <TableHead>Medição</TableHead>
              <TableHead numeric>PSI</TableHead>
              <TableHead>Calibragem</TableHead>
              <TableHead>Operação · local · BR</TableHead>
              <TableHead>Qualidade</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {snapshots.map((s) => (
              <TableRow key={s.referenceDate} className="h-auto" data-testid="tires-sheet-snapshot">
                <TableCell className="whitespace-nowrap py-1.5 font-semibold tabular-nums">{formatDate(s.referenceDate)}</TableCell>
                <TableCell className="py-1.5">
                  <span className="flex flex-col items-start gap-0.5 leading-tight">
                    <TireStatusBadge value={s.canonicalStatus} />
                    {s.rodoparStatusRaw ? <span className="whitespace-nowrap text-fg-muted">Rodopar: {s.rodoparStatusRaw}</span> : null}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap py-1.5">
                  {s.licensePlate || s.fleetNumber ? <PlateLink vehicleId={s.vehicleId} plate={s.licensePlate} fleetCode={s.fleetNumber} /> : "—"}
                </TableCell>
                <TableCell className="py-1.5 font-semibold tabular-nums">{s.positionCode ?? "—"}</TableCell>
                <TableCell numeric className="py-1.5">{fmtInt(s.life)}</TableCell>
                <TableCell numeric className="py-1.5">{fmtNum(s.tread1)}</TableCell>
                <TableCell numeric className="py-1.5">{fmtNum(s.tread2)}</TableCell>
                <TableCell numeric className="py-1.5">{fmtNum(s.tread3)}</TableCell>
                <TableCell numeric className="py-1.5">{fmtNum(s.tread4)}</TableCell>
                <TableCell numeric className="whitespace-nowrap py-1.5 font-semibold">{fmtMm(s.treadMin)}</TableCell>
                <TableCell className="whitespace-nowrap py-1.5 tabular-nums">{formatDate(s.measurementDate)}</TableCell>
                <TableCell numeric className="py-1.5">{fmtNum(s.psi)}</TableCell>
                <TableCell className="whitespace-nowrap py-1.5 tabular-nums">{formatDate(s.calibrationDate)}</TableCell>
                <TableCell className="min-w-44 py-1.5 text-fg-secondary">{[s.operationName, s.cityName, s.brCode].filter(Boolean).join(" · ") || "—"}</TableCell>
                <TableCell className="py-1.5">
                  {s.qualityFlags?.length ? (
                    <span className="flex flex-wrap gap-1">
                      {s.qualityFlags.map((f) => (
                        <Badge key={f} variant="warning" size="sm" className="h-auto min-h-5 whitespace-normal py-0.5">
                          {issueLabel(f)}
                        </Badge>
                      ))}
                    </span>
                  ) : (
                    <span className="text-fg-muted">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Consertos
// ---------------------------------------------------------------------------
function Repairs({ repairs }: { repairs: TireSheet["repairs"] }) {
  if (repairs.length === 0) {
    return (
      <EmptyState
        variant="panel"
        size="sm"
        icon={<Wrench />}
        title="Nenhum conserto registrado"
        description="Consertos e serviços lançados em Serviços › Consertos para este pneu aparecem aqui."
      />
    );
  }
  return (
    <TableContainer data-testid="tires-sheet-repairs">
      <Table className="text-caption">
        <TableHeader>
          <TableRow>
            <TableHead>Data</TableHead>
            <TableHead>Serviço</TableHead>
            <TableHead>Fornecedor</TableHead>
            <TableHead>OS</TableHead>
            <TableHead>Veículo na data</TableHead>
            <TableHead>Registro</TableHead>
            <TableHead>Observação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {repairs.map((r) => (
            <TableRow key={r.id} className={cn("h-auto", r.status === "voided" && "text-fg-muted")} data-testid="tires-sheet-repair">
              <TableCell className="whitespace-nowrap py-1.5 tabular-nums">{formatDate(r.serviceDate)}</TableCell>
              <TableCell className="py-1.5 font-medium">{r.repairType}</TableCell>
              <TableCell className="py-1.5">{r.supplierName ?? "—"}</TableCell>
              <TableCell className="whitespace-nowrap py-1.5 tabular-nums">{r.serviceOrderNumber ?? "—"}</TableCell>
              <TableCell className="py-1.5">
                <span className="flex flex-col leading-tight">
                  <span className="whitespace-nowrap font-medium">{[r.licensePlate, r.fleetCode].filter(Boolean).join(" · ") || "—"}</span>
                  <span className="text-fg-muted">
                    {RESOLUTION_LABEL[r.vehicleResolution] ?? r.vehicleResolution}
                    {r.resolutionConfidence ? ` · confiança ${(CONFIDENCE_LABEL[r.resolutionConfidence] ?? r.resolutionConfidence).toLowerCase()}` : ""}
                  </span>
                </span>
              </TableCell>
              <TableCell className="py-1.5">
                <StatusBadge status={r.status === "voided" ? "neutral" : "success"} size="sm">
                  {r.status === "voided" ? "Anulado" : "Ativo"}
                </StatusBadge>
              </TableCell>
              <TableCell className="min-w-48 py-1.5 text-fg-secondary">{r.notes ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

// ---------------------------------------------------------------------------
// Vistorias de campo
// ---------------------------------------------------------------------------
function Inspections({ inspections, fireNumber, basePath }: { inspections: TireSheet["inspections"]; fireNumber: string; basePath: string }) {
  return (
    <div className="flex flex-col gap-3" data-testid="tires-sheet-inspections">
      <Alert variant="info">
        <AlertDescription>
          Vistoria de campo é leitura cega feita no aplicativo e nunca altera a fotografia oficial do Rodopar. A conciliação mostra se a
          medição já chegou ao Rodopar numa importação posterior.
        </AlertDescription>
      </Alert>
      {inspections.length === 0 ? (
        <EmptyState
          variant="panel"
          size="sm"
          icon={<ClipboardCheck />}
          title="Nenhuma vistoria de campo"
          description="Vistorias em que este pneu era o esperado na posição, ou em que o Nº Fogo foi lido, aparecem aqui."
        />
      ) : (
        <TableContainer>
          <Table className="text-caption">
            <TableHeader>
              <TableRow>
                <TableHead>Protocolo</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Posição</TableHead>
                <TableHead>Nº Fogo lido</TableHead>
                <TableHead numeric>S1</TableHead>
                <TableHead numeric>S2</TableHead>
                <TableHead numeric>S3</TableHead>
                <TableHead numeric>S4</TableHead>
                <TableHead numeric>PSI lido</TableHead>
                <TableHead>Divergências</TableHead>
                <TableHead>Conciliação</TableHead>
                <TableHead>Inspetor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inspections.map((i) => (
                <TableRow key={`${i.inspectionId}:${i.positionCode}`} className="h-auto" data-testid="tires-sheet-inspection">
                  <TableCell className="whitespace-nowrap py-1.5">
                    <Link
                      href={`${basePath}?aba=vistorias&fase=todas&vistoria=${i.inspectionId}`}
                      className="rounded-xs font-mono font-semibold text-link hover:underline hfm-focus-ring"
                    >
                      {i.protocol}
                      <span className="sr-only"> — abrir a vistoria</span>
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-1.5 tabular-nums">{formatDate(i.inspectionDate)}</TableCell>
                  <TableCell className="py-1.5">
                    <StatusBadge status={INSPECTION_STATUS_TONE[i.status]} size="sm">
                      {INSPECTION_STATUS_SHORT[i.status]}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="py-1.5 font-semibold tabular-nums">{i.positionCode}</TableCell>
                  <TableCell className={cn("py-1.5 tabular-nums", i.fireNumberRead && i.fireNumberRead !== fireNumber && "font-semibold text-danger")}>
                    {i.fireNumberRead ?? "—"}
                  </TableCell>
                  <TableCell numeric className="py-1.5">{fmtNum(i.tread1)}</TableCell>
                  <TableCell numeric className="py-1.5">{fmtNum(i.tread2)}</TableCell>
                  <TableCell numeric className="py-1.5">{fmtNum(i.tread3)}</TableCell>
                  <TableCell numeric className="py-1.5">{fmtNum(i.tread4)}</TableCell>
                  <TableCell numeric className="py-1.5">{fmtNum(i.psiRead)}</TableCell>
                  <TableCell className="py-1.5">
                    {i.divergences?.length ? (
                      <span className="flex flex-wrap gap-1">
                        {i.divergences.map((d, k) => (
                          <StatusBadge key={`${d.type}:${k}`} status={DIVERGENCE_TONE[d.type] ?? "neutral"} size="sm" title={d.detail}>
                            {DIVERGENCE_LABEL[d.type] ?? d.type}
                            {d.detail ? <span className="sr-only">: {d.detail}</span> : null}
                          </StatusBadge>
                        ))}
                      </span>
                    ) : (
                      <span className="text-fg-muted">Nenhuma</span>
                    )}
                  </TableCell>
                  <TableCell className="py-1.5">
                    <StatusBadge status={SYNC_TONE[i.syncStatus] ?? "neutral"} size="sm">
                      {SYNC_LABEL[i.syncStatus] ?? i.syncStatus}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="py-1.5">{i.inspectorName}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {inspections.length ? (
        <p className="text-caption text-fg-muted">
          {fmtInt(inspections.length)} {plural(inspections.length, "leitura", "leituras")} de campo deste pneu. Passe o ponteiro numa divergência
          para ver o detalhe.
        </p>
      ) : null}
    </div>
  );
}
