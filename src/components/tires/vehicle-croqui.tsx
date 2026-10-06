"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Check, Circle, CircleDot, Diamond, OctagonAlert, Recycle, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/button";
import { StatusBadge, statusTone, type StatusTone } from "@/components/ui/status-badge";
import { AxleDiagram, type AxlePosition, type AxleTireState } from "./axle-diagram";
import {
  CRITICALITY_LABEL,
  CRITICALITY_TONE,
  DEADLINE_LABEL,
  DEADLINE_TONE,
  LAYOUT_SOURCE_LABEL,
  PSI_LABEL,
  PSI_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  TIRES_BASE_PATH,
  TREAD_LABEL,
  TREAD_TONE,
  fmtDays,
  fmtMm,
  fmtNum,
  fmtPsi,
  formatDate,
  issueLabel,
  reasonLabel,
  type Criticality,
  type DeadlineStatus,
  type Severity,
  type TirePositionInfo,
  type TireRow,
  type TireVehicleLayout,
} from "@/lib/tires/types";

/**
 * Croqui do veículo — "Ver pneus e posições". UM componente para toda a
 * Gestão de Pneus: Base Geral (cartão da frota), ficha do pneu, aba Pneus do
 * Cadastro de Frotas e o aplicativo Vistoria de Pneus.
 *
 * O desenho (vista de cima, chassi, eixos, rodado duplo lado a lado, estepes
 * à parte, "Frente" indicada) sai do dicionário de posições e do layout do
 * veículo (`AxleDiagram`) — nada fixo por tipo de veículo.
 *
 * - Modo "official" (padrão): pneus da base oficial (Rodopar). Cada posição
 *   mostra a criticidade calculada no banco por tom E por forma (octógono,
 *   triângulo, losango, círculo, ✓; sem pneu = tracejado) e abre o painel de
 *   detalhes do pneu (Nº Fogo, sulcos, PSI × faixa, prazos, conformidade,
 *   motivos e alertas).
 * - Modo "blind" (aplicativo, leitura cega): só posições e o estado da
 *   medição feita no aparelho — nunca um dado oficial.
 *
 * A tela não recalcula nada: conformidade, motivos e criticidade vêm prontos
 * nas linhas. Onde a rotina ainda não devolve a criticidade (resumo do
 * veículo, ficha), usa-se a severidade da mesma linha, na correspondência fixa
 * do banco (`private.tire_criticality`).
 */

/** Linha oficial + conformidade do banco (Base Geral). Em outras rotinas esses campos podem não vir. */
export type CroquiTire = TireRow & {
  overallConform?: boolean | null;
  calibrationConform?: boolean | null;
  reasons?: string[] | null;
  criticality?: Criticality | null;
};

export interface CroquiLayout {
  /** vehicle | vehicle_type | inferred | snapshot (LAYOUT_SOURCE_LABEL) */
  source: string | null;
  name?: string | null;
  positionCodes?: string[] | null;
}

export const croquiLayout = (layout: TireVehicleLayout | null | undefined): CroquiLayout | null =>
  layout ? { source: layout.layoutSource, name: layout.layoutName, positionCodes: layout.positionCodes } : null;

export type CroquiReadingState = "complete" | "partial" | "invalid" | "empty";

/** Correspondência fixa do banco (private.tire_criticality): severidade → criticidade. */
const SEVERITY_CRITICALITY: Record<Severity, Criticality> = { critica: "critico", alta: "alto", media: "medio", baixa: "baixo", ok: "ok" };

export const criticalityOf = (t: Pick<CroquiTire, "criticality" | "severity">): Criticality | null =>
  t.criticality ?? SEVERITY_CRITICALITY[t.severity] ?? null;

export const CRITICALITY_ORDER: Criticality[] = ["critico", "alto", "medio", "baixo", "ok"];

/** Indicador de forma (nunca só a cor): octógono, triângulo, losango, círculo, ✓. */
export const CRITICALITY_GLYPH: Record<Criticality, React.ReactNode> = {
  critico: <OctagonAlert />,
  alto: <TriangleAlert />,
  medio: <Diamond />,
  baixo: <Circle />,
  ok: <Check />,
};

/** Criticidade com tom + forma + texto (tabelas e painel de detalhes). */
export function CriticalityBadge({ value, size = "sm", className }: { value: Criticality | null; size?: "sm" | "md"; className?: string }) {
  if (!value) return <span className="text-fg-muted">—</span>;
  return (
    <Badge
      variant={statusTone(CRITICALITY_TONE[value]).variant}
      size={size}
      icon={CRITICALITY_GLYPH[value]}
      className={className}
      data-testid="tires-criticality"
      data-criticality={value}
    >
      {CRITICALITY_LABEL[value]}
    </Badge>
  );
}

/** Conformidade (geral ou de calibragem) como veio do banco; ausente = "—". */
export function ConformBadge({ value, size = "sm" }: { value: boolean | null | undefined; size?: "sm" | "md" }) {
  if (value == null) return <span className="text-fg-muted">—</span>;
  return (
    <Badge variant={value ? "success" : "danger"} size={size} icon={value ? <Check /> : <X />} data-testid="tires-conform" data-conform={value}>
      {value ? "Conforme" : "Não conforme"}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------
interface CroquiCommonProps {
  /** Dicionário de posições (todo o catálogo, ou só as do veículo — ver `positionsScope`). */
  positions: TirePositionInfo[];
  layout: CroquiLayout | null;
  /** Nome do grupo de posições para leitor de tela. */
  label: string;
  size?: "sm" | "md";
  className?: string;
  /** Prefixo do data-testid de cada posição (`<prefixo>-<CÓDIGO>`). */
  testIdPrefix?: string;
}

export interface OfficialCroquiProps extends CroquiCommonProps {
  mode?: "official";
  tires: CroquiTire[];
  /**
   * "dictionary" (padrão): desenha as posições do layout ∪ as ocupadas.
   * "vehicle": `positions` já são as do veículo — todas entram no desenho.
   */
  positionsScope?: "dictionary" | "vehicle";
  /** Seleção controlada (ex.: destacar a linha na tabela ao lado). */
  selected?: string | null;
  defaultSelected?: string | null;
  onSelectedChange?: (code: string | null) => void;
}

export interface BlindCroquiProps extends CroquiCommonProps {
  mode: "blind";
  /** Estado da leitura feita no aparelho (nada oficial). */
  readingState: (code: string) => CroquiReadingState;
  selected: string | null;
  onSelect: (code: string) => void;
}

export type VehicleCroquiProps = OfficialCroquiProps | BlindCroquiProps;

export function VehicleCroqui(props: VehicleCroquiProps) {
  return props.mode === "blind" ? <BlindCroqui {...props} /> : <OfficialCroqui {...props} />;
}

const layoutSourceOf = (layout: CroquiLayout | null) => layout?.source ?? "snapshot";

function LayoutLine({ layout }: { layout: CroquiLayout | null }) {
  const source = layoutSourceOf(layout);
  const sourceLabel = LAYOUT_SOURCE_LABEL[source] ?? source;
  return (
    <p className="max-w-72 text-center text-caption text-fg-muted" data-testid="tires-croqui-layout">
      {layout?.name ? `${layout.name} · ${sourceLabel}` : sourceLabel}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Modo oficial
// ---------------------------------------------------------------------------
interface CroquiModel {
  dict: Map<string, TirePositionInfo>;
  byCode: Map<string, CroquiTire[]>;
  drawn: AxlePosition[];
  outside: string[];
  noPosition: CroquiTire[];
}

function buildModel(positions: TirePositionInfo[], layout: CroquiLayout | null, tires: CroquiTire[], scope: "dictionary" | "vehicle"): CroquiModel {
  const dict = new Map(positions.map((p) => [p.code, p]));
  const byCode = new Map<string, CroquiTire[]>();
  const noPosition: CroquiTire[] = [];
  for (const t of tires) {
    if (!t.positionCode) {
      noPosition.push(t);
      continue;
    }
    const list = byCode.get(t.positionCode);
    if (list) list.push(t);
    else byCode.set(t.positionCode, [t]);
  }
  // mais de um pneu na mesma posição (colisão no relatório): o mais grave representa a posição
  for (const list of byCode.values()) list.sort((a, b) => b.severityScore - a.severityScore);
  // Posições = layout do veículo ∪ posições ocupadas nos dados (∪ todas, quando o dicionário já é do veículo).
  const codes = new Set<string>([...(scope === "vehicle" ? positions.map((p) => p.code) : []), ...(layout?.positionCodes ?? []), ...byCode.keys()]);
  const drawn: AxlePosition[] = [];
  const outside: string[] = [];
  for (const code of codes) {
    const p = dict.get(code);
    if (p) drawn.push(p);
    else outside.push(code);
  }
  const sortOf = (code: string) => byCode.get(code)?.[0]?.positionSort ?? 999;
  outside.sort((a, b) => sortOf(a) - sortOf(b) || a.localeCompare(b));
  return { dict, byCode, drawn, outside, noPosition };
}

function tireAria(p: { code: string; label: string }, list: CroquiTire[]): string {
  if (!list.length) return `${p.label} (${p.code}): sem pneu nos dados atuais`;
  const t = list[0];
  const crit = criticalityOf(t);
  const parts = [
    `Nº Fogo ${t.fireNumber}`,
    crit ? `criticidade: ${CRITICALITY_LABEL[crit].toLowerCase()}` : null,
    t.overallConform == null ? null : t.overallConform ? "conforme" : "não conforme",
    `menor sulco ${fmtMm(t.treadMin)}`,
    list.length > 1 ? `mais ${list.length - 1} ${list.length - 1 === 1 ? "pneu informado" : "pneus informados"} na mesma posição` : null,
  ].filter(Boolean);
  return `${p.label} (${p.code}): ${parts.join(", ")}`;
}

function OfficialCroqui({
  positions, layout, tires, label, size = "md", className, testIdPrefix = "tires-croqui-pos", positionsScope = "dictionary",
  selected: selectedProp, defaultSelected = null, onSelectedChange,
}: OfficialCroquiProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const detailId = React.useId();
  const [inner, setInner] = React.useState<string | null>(defaultSelected);
  const controlled = selectedProp !== undefined;
  const selected = controlled ? (selectedProp ?? null) : inner;
  const select = (code: string | null) => {
    if (!controlled) setInner(code);
    onSelectedChange?.(code);
  };

  const model = React.useMemo(() => buildModel(positions, layout, tires, positionsScope), [positions, layout, tires, positionsScope]);
  const { dict, byCode, drawn, outside, noPosition } = model;

  const stateOf = (p: AxlePosition): AxleTireState => {
    const list = byCode.get(p.code) ?? [];
    if (!list.length) return { empty: true, caption: "sem pneu", ariaLabel: tireAria(p, list) };
    const t = list[0];
    const crit = criticalityOf(t);
    return {
      tone: crit ? CRITICALITY_TONE[crit] : null,
      glyph: crit ? CRITICALITY_GLYPH[crit] : null,
      caption: `${t.fireNumber}${list.length > 1 ? ` +${list.length - 1}` : ""}`,
      subcaption: size === "md" ? (t.treadMin == null ? "—" : fmtNum(t.treadMin)) : undefined,
      ariaLabel: tireAria(p, list),
    };
  };

  // posição selecionada: do desenho, fora do dicionário, ou nenhuma (seleção de outro veículo)
  const known = selected != null && (drawn.some((p) => p.code === selected) || outside.includes(selected));
  const current = known && selected ? { code: selected, label: dict.get(selected)?.label ?? byCode.get(selected)?.[0]?.positionLabel ?? selected } : null;

  const close = () => {
    const code = selected;
    select(null);
    if (code) rootRef.current?.querySelector<HTMLElement>(`[data-position="${CSS.escape(code)}"]`)?.focus();
  };
  // No celular o painel fica abaixo do desenho: ao escolher uma posição, traz o painel à vista (sem mexer no foco).
  const reveal = React.useRef(false);
  const toggle = (code: string) => {
    reveal.current = selected !== code;
    select(selected === code ? null : code);
  };
  const currentCode = current?.code ?? null;
  React.useEffect(() => {
    if (!reveal.current || !currentCode) return;
    reveal.current = false;
    const panel = rootRef.current?.querySelector<HTMLElement>('[data-testid="tires-croqui-detail"]');
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    panel?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [currentCode]);

  return (
    <div
      ref={rootRef}
      className={cn("flex flex-col gap-4 md:flex-row md:items-start md:gap-6", className)}
      data-testid="tires-croqui"
      data-mode="official"
      data-layout-source={layoutSourceOf(layout)}
    >
      {drawn.length ? (
        <div className="flex flex-col items-center gap-2 md:shrink-0">
          <AxleDiagram
            positions={drawn}
            state={stateOf}
            selected={current?.code ?? null}
            onSelect={toggle}
            label={label}
            size={size}
            testIdPrefix={testIdPrefix}
            controls={detailId}
          />
          <LayoutLine layout={layout} />
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <CroquiLegend mode="official" withSubcaption={size === "md"} />
        {drawn.length === 0 ? (
          <p className="text-caption text-fg-secondary">
            As posições deste veículo não estão no dicionário de posições: veja a lista abaixo, na ordem dos dados.
          </p>
        ) : null}

        {current ? (
          <TireDetail
            id={detailId}
            code={current.code}
            positionLabel={current.label}
            tires={byCode.get(current.code) ?? []}
            onClose={close}
          />
        ) : (
          <p id={detailId} className="rounded-md border border-dashed border-border px-3 py-2.5 text-caption text-fg-muted" data-testid="tires-croqui-hint">
            Toque ou clique numa posição para ver o pneu: Nº Fogo, sulcos, PSI, prazos, conformidade e alertas.
          </p>
        )}

        {outside.length ? (
          <div className="flex flex-col gap-1" data-testid="tires-croqui-outside">
            <p className="text-caption font-medium text-fg-secondary">
              {drawn.length ? "Posições fora do dicionário de posições" : "Posições"}
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {outside.map((code) => {
                const list = byCode.get(code) ?? [];
                const t = list[0];
                const crit = t ? criticalityOf(t) : null;
                return (
                  <li key={code}>
                    <button
                      type="button"
                      onClick={() => toggle(code)}
                      aria-pressed={selected === code}
                      aria-controls={detailId}
                      aria-label={tireAria({ code, label: t?.positionLabel ?? code }, list)}
                      data-position={code}
                      data-testid={`${testIdPrefix}-${code}`}
                      className={cn(
                        "inline-flex min-h-11 items-center gap-1.5 rounded-md border px-2.5 text-caption hfm-transition hfm-focus-ring hover:border-primary",
                        !t ? "border-dashed border-border-strong bg-surface" : crit ? statusTone(CRITICALITY_TONE[crit]).softClassName : "border-border bg-surface-raised",
                        selected === code && "ring-2 ring-primary ring-offset-2 ring-offset-surface",
                      )}
                    >
                      <span className="font-semibold tabular-nums text-fg">{code}</span>
                      {crit ? <span aria-hidden className={cn("inline-flex [&_svg]:size-3.5", statusTone(CRITICALITY_TONE[crit]).softForegroundClassName)}>{CRITICALITY_GLYPH[crit]}</span> : null}
                      <span className="tabular-nums text-fg-secondary">{t ? t.fireNumber : "sem pneu"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {noPosition.length ? (
          <div className="flex flex-col gap-1" data-testid="tires-croqui-no-position">
            <p className="text-caption font-medium text-warning-soft-fg">Em uso sem posição informada</p>
            <ul className="flex flex-wrap gap-2">
              {noPosition.map((t) => {
                const crit = criticalityOf(t);
                return (
                  <li key={t.snapshotId} className="flex items-center gap-1.5 rounded-sm border border-warning-border bg-warning-soft px-2 py-1 text-caption">
                    <TireLink tireId={t.tireId} fireNumber={t.fireNumber} />
                    <span className="tabular-nums text-fg-secondary">{fmtMm(t.treadMin)}</span>
                    {crit ? <span className="text-fg-secondary">· {CRITICALITY_LABEL[crit]}</span> : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TireLink({ tireId, fireNumber, className }: { tireId: string | null | undefined; fireNumber: string | null | undefined; className?: string }) {
  if (!tireId) return <span className={cn("font-semibold tabular-nums text-fg", className)}>{fireNumber ?? "—"}</span>;
  return (
    <Link
      href={`${TIRES_BASE_PATH}/${tireId}`}
      className={cn("rounded-xs font-semibold tabular-nums text-fg underline-offset-2 hover:text-primary hover:underline hfm-focus-ring", className)}
      data-testid="tires-croqui-fire-link"
    >
      {fireNumber ?? "—"}
      <span className="sr-only"> — abrir a ficha do pneu</span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Painel de detalhes do pneu
// ---------------------------------------------------------------------------
function TireDetail({ id, code, positionLabel, tires, onClose }: {
  id: string;
  code: string;
  positionLabel: string;
  tires: CroquiTire[];
  onClose: () => void;
}) {
  const headingId = React.useId();
  const first = tires[0];
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-3 rounded-md border border-border bg-surface-raised p-3"
      data-testid="tires-croqui-detail"
      data-position={code}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-caption text-fg-muted">
            Posição <span className="font-semibold tabular-nums text-fg-secondary">{code}</span>
            {positionLabel && positionLabel !== code ? ` · ${positionLabel}` : ""}
          </p>
          <h4 id={headingId} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body font-semibold text-fg">
            {first ? (
              <>
                <span>
                  Nº Fogo <TireLink tireId={first.tireId} fireNumber={first.fireNumber} />
                </span>
                <CriticalityBadge value={criticalityOf(first)} />
              </>
            ) : (
              "Sem pneu"
            )}
          </h4>
        </div>
        <IconButton label="Fechar detalhes do pneu" size="sm" onClick={onClose} data-testid="tires-croqui-detail-close">
          <X aria-hidden />
        </IconButton>
      </header>

      {first ? (
        <>
          {tires.length > 1 ? (
            <p className="flex items-start gap-1.5 text-caption text-warning-soft-fg">
              <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning" />
              Mais de um pneu informado nesta posição nos dados: {tires.map((t) => t.fireNumber).join(", ")}.
            </p>
          ) : null}
          {tires.map((t, i) => (
            <TireFacts key={t.snapshotId} tire={t} showHeader={i > 0} />
          ))}
        </>
      ) : (
        <p className="text-body-sm text-fg-secondary" data-testid="tires-croqui-detail-empty">
          Sem pneu nesta posição nos dados atuais.
        </p>
      )}
    </section>
  );
}

function DetailFact({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="min-w-0 text-body-sm text-fg">{children}</dd>
    </div>
  );
}

function DetailBlock({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 border-t border-border-subtle pt-2.5" data-testid={testId}>
      <h5 className="text-caption font-semibold text-fg-secondary">{title}</h5>
      {children}
    </div>
  );
}

function DeadlineLine({ label, date, days, status, due }: {
  label: string;
  date: string | null;
  days: number | null;
  status: DeadlineStatus;
  due: string | null;
}) {
  return (
    <DetailFact label={label}>
      <span className="flex flex-col items-start gap-0.5">
        <span className="tabular-nums">
          {formatDate(date)}
          {days != null ? <span className="text-caption text-fg-muted"> · há {fmtDays(days)}</span> : null}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={DEADLINE_TONE[status]} size="sm">
            {DEADLINE_LABEL[status]}
          </StatusBadge>
          {due ? <span className="text-caption tabular-nums text-fg-muted">prazo {formatDate(due)}</span> : null}
        </span>
      </span>
    </DetailFact>
  );
}

function TireFacts({ tire: t, showHeader }: { tire: CroquiTire; showHeader: boolean }) {
  const treads = [t.tread1, t.tread2, t.tread3, t.tread4];
  const flags = t.qualityFlags ?? [];
  const reasons = t.reasons ?? [];
  const hasRule = t.psiMin != null || t.psiMax != null;
  const alerts = t.treadDivergence || t.retreadAlert || flags.length > 0;
  return (
    <div className="flex min-w-0 flex-col gap-2.5" data-testid="tires-croqui-detail-tire">
      {showHeader ? (
        <p className="border-t border-border pt-2.5 text-body-sm font-semibold text-fg">
          Nº Fogo <TireLink tireId={t.tireId} fireNumber={t.fireNumber} />
        </p>
      ) : null}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <DetailFact label="Fabricante">{t.brand ?? "—"}</DetailFact>
        <DetailFact label="Modelo">{t.model ?? "—"}</DetailFact>
        <DetailFact label="Medida">{t.dimension ?? "—"}</DetailFact>
        <DetailFact label="Situação">
          <StatusBadge status={STATUS_TONE[t.canonicalStatus]} size="sm">
            {STATUS_LABEL[t.canonicalStatus] ?? t.canonicalStatus}
          </StatusBadge>
        </DetailFact>
        <DetailFact label="Conformidade geral">
          <ConformBadge value={t.overallConform} />
        </DetailFact>
        <DetailFact label="Conformidade de calibragem">
          <ConformBadge value={t.calibrationConform} />
        </DetailFact>
      </dl>

      <DetailBlock title="Sulco (MM)" testId="tires-croqui-detail-tread">
        <ul className="grid grid-cols-5 gap-1" aria-label="Sulcos medidos e menor sulco">
          {treads.map((v, i) => (
            <li key={i} className="flex flex-col items-center rounded-sm border border-border-subtle bg-surface px-1 py-0.5">
              <span className="text-caption text-fg-muted">S{i + 1}</span>
              <span className="text-body-sm font-semibold tabular-nums text-fg">{fmtNum(v)}</span>
            </li>
          ))}
          <li className="flex flex-col items-center rounded-sm border border-border-strong bg-surface-sunken px-1 py-0.5">
            <span className="text-caption text-fg-muted">Menor</span>
            <span className="text-body-sm font-semibold tabular-nums text-fg">{fmtNum(t.treadMin)}</span>
          </li>
        </ul>
        <p className="flex flex-wrap items-center gap-1.5 text-caption text-fg-secondary">
          <StatusBadge status={TREAD_TONE[t.treadClass]} size="sm">
            {TREAD_LABEL[t.treadClass]}
          </StatusBadge>
          {t.legalTreadMm != null ? <span>limite legal {fmtMm(t.legalTreadMm)}</span> : null}
        </p>
      </DetailBlock>

      <DetailBlock title="Pressão (PSI)" testId="tires-croqui-detail-psi">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm">
          <span>
            Medido <span className="font-semibold tabular-nums text-fg">{fmtPsi(t.psi)}</span>
          </span>
          <span aria-hidden className="text-fg-muted">×</span>
          <span className="text-fg-secondary">
            {hasRule ? (
              <>
                faixa <span className="tabular-nums">mín {fmtNum(t.psiMin)} · ideal {fmtNum(t.psiIdeal)} · máx {fmtNum(t.psiMax)}</span>
              </>
            ) : (
              "sem parâmetro de PSI"
            )}
          </span>
          <StatusBadge status={PSI_TONE[t.psiStatus]} size="sm">
            {PSI_LABEL[t.psiStatus]}
          </StatusBadge>
        </p>
      </DetailBlock>

      <DetailBlock title="Medição e calibragem">
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
          <DeadlineLine label="Última medição" date={t.measurementDate} days={t.measurementDays} status={t.measurementStatus} due={t.measurementDueDate} />
          <DeadlineLine label="Última calibragem" date={t.calibrationDate} days={t.calibrationDays} status={t.calibrationStatus} due={t.calibrationDueDate} />
        </dl>
      </DetailBlock>

      {reasons.length ? (
        <DetailBlock title="Motivos da não conformidade" testId="tires-croqui-detail-reasons">
          <ul className="flex flex-wrap gap-1.5">
            {reasons.map((r) => (
              <li key={r}>
                <StatusBadge status="danger" appearance="outline" size="sm">
                  {reasonLabel(r)}
                </StatusBadge>
              </li>
            ))}
          </ul>
        </DetailBlock>
      ) : null}

      {alerts ? (
        <DetailBlock title="Alertas" testId="tires-croqui-detail-alerts">
          <ul className="flex flex-col gap-1 text-caption">
            {t.treadDivergence ? (
              <li className="flex items-start gap-1.5 text-warning-soft-fg">
                <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning" />
                Divergência de sulco: menor informado {fmtMm(t.treadMinRaw)} ≠ calculado dos sulcos {fmtMm(t.treadMinCalculated)}
              </li>
            ) : null}
            {t.retreadAlert ? (
              <li className="flex items-start gap-1.5 text-progress-soft-fg">
                <Recycle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-progress" />
                Alerta de ressolagem (alerta operacional)
              </li>
            ) : null}
            {flags.map((f) => (
              <li key={f} className="flex items-start gap-1.5 text-warning-soft-fg">
                <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning" />
                Qualidade do dado: {issueLabel(f)}
              </li>
            ))}
          </ul>
        </DetailBlock>
      ) : null}

      <p className="text-caption text-fg-muted">Base oficial (Rodopar), dados de {formatDate(t.referenceDate)}.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legenda
// ---------------------------------------------------------------------------
const BLIND_STATES: { key: CroquiReadingState; label: string; tone: StatusTone | null; glyph: React.ReactNode }[] = [
  { key: "complete", label: "Completa", tone: "success", glyph: <Check /> },
  { key: "partial", label: "Parcial", tone: "warning", glyph: <CircleDot /> },
  { key: "invalid", label: "Com erro", tone: "danger", glyph: <OctagonAlert /> },
  { key: "empty", label: "Pendente", tone: null, glyph: null },
];

function Swatch({ tone, glyph, dashed = false, ring = false }: { tone: StatusTone | null; glyph?: React.ReactNode; dashed?: boolean; ring?: boolean }) {
  const t = tone ? statusTone(tone) : null;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex h-5 w-4 shrink-0 items-center justify-center rounded-sm border-2 [&_svg]:size-2.5",
        dashed ? "border-dashed border-border-strong bg-surface" : t ? cn(t.softClassName, t.softForegroundClassName) : "border-border-strong bg-surface-raised",
        ring && "ring-2 ring-primary ring-offset-1 ring-offset-surface",
      )}
    >
      {glyph}
    </span>
  );
}

function CroquiLegend({ mode, withSubcaption = false }: { mode: "official" | "blind"; withSubcaption?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5" data-testid="tires-croqui-legend">
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-caption text-fg-secondary" aria-label={mode === "blind" ? "Legenda: estado da medição" : "Legenda: criticidade do pneu"}>
        {mode === "official"
          ? CRITICALITY_ORDER.map((c) => (
              <li key={c} className="inline-flex items-center gap-1.5">
                <Swatch tone={CRITICALITY_TONE[c]} glyph={CRITICALITY_GLYPH[c]} />
                {CRITICALITY_LABEL[c]}
              </li>
            ))
          : BLIND_STATES.map((s) => (
              <li key={s.key} className="inline-flex items-center gap-1.5">
                <Swatch tone={s.tone} glyph={s.glyph} />
                {s.label}
              </li>
            ))}
        {mode === "official" ? (
          <li className="inline-flex items-center gap-1.5">
            <Swatch tone={null} dashed />
            Sem pneu
          </li>
        ) : null}
        <li className="inline-flex items-center gap-1.5">
          <Swatch tone={null} ring />
          Selecionada
        </li>
      </ul>
      {mode === "official" ? (
        <p className="text-caption text-fg-muted">
          Em cada pneu: posição, Nº Fogo{withSubcaption ? " e menor sulco (mm)" : ""}. Tom e forma indicam a criticidade do pneu.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modo leitura cega (aplicativo)
// ---------------------------------------------------------------------------
function BlindCroqui({ positions, layout, readingState, selected, onSelect, label, size = "md", className, testIdPrefix = "tires-croqui-pos" }: BlindCroquiProps) {
  const stateOf = (p: AxlePosition): AxleTireState => {
    const s = readingState(p.code);
    if (s === "complete") return { tone: "success", glyph: <Check />, caption: "Medida", srText: "medida completa" };
    if (s === "partial") return { tone: "warning", glyph: <CircleDot />, caption: "Parcial", srText: "medida parcial" };
    if (s === "invalid") return { tone: "danger", glyph: <OctagonAlert />, caption: "Erro", srText: "leitura com erro, a corrigir" };
    return { tone: null, srText: "pendente" };
  };
  return (
    <div
      className={cn("flex flex-col items-center gap-3", className)}
      data-testid="tires-croqui"
      data-mode="blind"
      data-layout-source={layoutSourceOf(layout)}
    >
      <AxleDiagram positions={positions} state={stateOf} selected={selected} onSelect={onSelect} label={label} size={size} testIdPrefix={testIdPrefix} />
      <CroquiLegend mode="blind" />
    </div>
  );
}
