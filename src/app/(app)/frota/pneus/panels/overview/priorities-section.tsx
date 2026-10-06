"use client";

import * as React from "react";
import { ChevronRight, CircleHelp, ExternalLink, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  CRITICALITY_LABEL, CRITICALITY_TONE, fmtDays, fmtInt, fmtMm, fmtNum, fmtPct, fmtPsi, GROUP_BY_LABEL, GROUP_BY_PARAM, issueCode,
  modernTerms, parseGroupBy, plural, reasonLabel, type Criticality, type TirePriorityGroup, type TirePriorityTire, type TiresGroupBy,
  type TiresPriorities,
} from "@/lib/tires/types";
import type { TiresPanelContext } from "../../shared";
import { FireLink, PlateLink, Section, TiresPagination } from "../tires-ui";
import { filterPatch, GROUP_FIELD, type Nav } from "./shared";

/**
 * Prioridades: grupos (Operação | Local de Operação | Liderança) na ordem do
 * banco — mais pneus críticos primeiro — e, ao abrir um grupo (`?grupo=`), os
 * pneus dele, paginados no servidor. Uma falha aqui não derruba a Visão Geral.
 */
const GROUP_OPTIONS = (["operation", "city", "leader"] as TiresGroupBy[]).map((v) => ({
  value: v,
  label: GROUP_BY_LABEL[v],
  "data-testid": `tires-priorities-groupby-${v}`,
}));

const LEVELS: Exclude<Criticality, "ok">[] = ["critico", "alto", "medio", "baixo"];

export function PrioritiesSection({
  priorities: p, error, ctx, to,
}: {
  priorities: TiresPriorities | null;
  error: string | null;
  ctx: TiresPanelContext;
  to: Nav;
}) {
  const groupBy = parseGroupBy(ctx.params.prioridade);
  const groups = p && !p.empty ? p.groups ?? [] : [];
  const openKey = p?.groupId ?? null;
  const drillId = React.useId();
  const drillRef = React.useRef<HTMLElement>(null);
  const openedHere = React.useRef(false);

  // Abriu pelo clique: leva o foco (e a rolagem) ao detalhe. Um link copiado não rola a página.
  React.useEffect(() => {
    if (!openKey || !openedHere.current) return;
    openedHere.current = false;
    drillRef.current?.focus({ preventScroll: true });
    drillRef.current?.scrollIntoView({ block: "nearest" });
  }, [openKey]);

  const toggle = (key: string) => {
    const closing = openKey === key;
    openedHere.current = !closing;
    ctx.navigate({ grupo: closing ? null : key, pagina: null });
  };

  return (
    <Section
      title="Prioridades"
      testId="tires-priorities"
      description="Onde agir primeiro: grupos com mais pneus críticos no topo, depois altos, médios e não conformes. Clique num grupo para ver os pneus."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <span aria-hidden className="text-caption text-fg-muted">Agrupar por</span>
          <SegmentedControl
            aria-label="Agrupar prioridades por"
            value={groupBy}
            onValueChange={(v) => ctx.navigate({ prioridade: GROUP_BY_PARAM[v], grupo: null, pagina: null })}
            options={GROUP_OPTIONS}
            disabled={ctx.pending}
            wrap
            data-testid="tires-priorities-groupby"
          />
        </div>
      }
    >
      <CriticalityRule summary={p && !p.empty ? p.summary : null} />

      {error ? (
        <Alert
          variant="danger"
          data-testid="tires-priorities-error"
          action={
            <Button size="sm" variant="outline" onClick={ctx.refresh} loading={ctx.pending}>
              Tentar de novo
            </Button>
          }
        >
          <AlertTitle>Não foi possível carregar as prioridades.</AlertTitle>
          <AlertDescription>{modernTerms(error)}</AlertDescription>
        </Alert>
      ) : (
        <TableContainer>
          <Table className="min-w-[1120px]" data-testid="tires-priorities-table">
            <TableHeader>
              <TableRow>
                <TableHead>{GROUP_BY_LABEL[groupBy]}</TableHead>
                <TableHead>Criticidade</TableHead>
                <TableHead numeric>Pneus em uso</TableHead>
                <TableHead numeric>Frotas</TableHead>
                <TableHead numeric>Não conformes</TableHead>
                <TableHead numeric title="Conformidade Geral dos Pneus do grupo">Conformidade</TableHead>
                <TableHead numeric>Crítico</TableHead>
                <TableHead numeric>Alto</TableHead>
                <TableHead numeric>Médio</TableHead>
                <TableHead numeric title="Sulco crítico ou abaixo do legal">Sulco crítico</TableHead>
                <TableHead numeric>Medição vencida</TableHead>
                <TableHead numeric>Calibragem vencida</TableHead>
                <TableHead numeric title="PSI abaixo do mínimo ou acima do máximo">PSI fora</TableHead>
                <TableHead numeric title="Pneus com dois ou mais motivos de não conformidade">Combinações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.length === 0 ? (
                <TableEmpty colSpan={14} message="Nenhum pneu em uso neste recorte." />
              ) : (
                groups.map((g) => (
                  <GroupRow key={g.key} g={g} open={g.key === openKey} drillId={drillId} onToggle={() => toggle(g.key)} />
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {p && openKey && !error ? (
        <Drill
          ref={drillRef}
          id={drillId}
          priorities={p}
          group={groups.find((g) => g.key === openKey) ?? null}
          groupBy={groupBy}
          ctx={ctx}
          to={to}
          onClose={() => ctx.navigate({ grupo: null, pagina: null })}
        />
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Regra da criticidade
// ---------------------------------------------------------------------------
function CriticalityRule({ summary }: { summary: TiresPriorities["summary"] | null }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      {summary ? (
        <ul aria-label="Pneus em uso por criticidade" className="flex flex-wrap items-center gap-1.5" data-testid="tires-priorities-summary">
          {LEVELS.map((lv) => (
            <li key={lv}>
              <StatusBadge status={CRITICALITY_TONE[lv]} withIcon size="sm">
                {CRITICALITY_LABEL[lv]} <span className="font-semibold tabular-nums">{fmtInt(summary[lv])}</span>
              </StatusBadge>
            </li>
          ))}
          <li className="text-caption text-fg-muted">
            de {fmtInt(summary.tires)} {plural(summary.tires, "pneu em uso", "pneus em uso")} em {fmtInt(summary.groups)}{" "}
            {plural(summary.groups, "grupo", "grupos")}
          </li>
        </ul>
      ) : (
        <span />
      )}
      <div className="flex flex-wrap items-center gap-x-1.5 text-caption text-fg-muted" data-testid="tires-priorities-rule">
        <span>Criticidade pela pontuação de cada pneu: Crítico ≥ 100 · Alto ≥ 50 · Médio ≥ 20 · Baixo &gt; 0.</span>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-xs font-medium text-link hover:text-link-hover hover:underline hfm-focus-ring"
              data-testid="tires-priorities-rule-open"
            >
              <CircleHelp aria-hidden className="size-3.5" />
              Como pontuamos
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80" data-testid="tires-priorities-rule-detail">
            <p className="font-semibold text-fg">Pontuação de criticidade (pneus em uso)</p>
            <ul className="mt-2 flex flex-col gap-1 text-caption text-fg-secondary">
              <li>Sulco abaixo do legal: 120 · crítico: 100 ou mais (cresce quanto menor o sulco) · em atenção: 40</li>
              <li>Prazo de medição e de calibragem (cada um): vencido 30 · sem registro 20 · próximo do vencimento 10</li>
              <li>PSI abaixo do mínimo ou acima do máximo: 25 · sem parâmetro: 5</li>
              <li>Menor sulco informado diferente do medido: 12 · alerta de ressolagem: 15</li>
            </ul>
            <p className="mt-2 text-caption text-fg-secondary">
              Soma dos pontos: <b>Crítico</b> ≥ 100 · <b>Alto</b> ≥ 50 · <b>Médio</b> ≥ 20 · <b>Baixo</b> &gt; 0 · Sem pendência = 0. O nível do
              grupo é o do seu pneu mais grave.
            </p>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Linha de grupo
// ---------------------------------------------------------------------------
function Count({ value, sub }: { value: number; sub?: string | null }) {
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className={value === 0 ? "text-fg-muted" : "font-semibold text-fg"}>{fmtInt(value)}</span>
      {sub ? <span className="text-caption whitespace-nowrap text-fg-muted">{sub}</span> : null}
    </span>
  );
}

function GroupRow({ g, open, drillId, onToggle }: { g: TirePriorityGroup; open: boolean; drillId: string; onToggle: () => void }) {
  return (
    <TableRow
      selected={open}
      className="h-auto cursor-pointer"
      onClick={onToggle}
      data-testid="tires-priority-group"
      data-key={g.key}
      data-level={g.level}
    >
      <TableCell className="max-w-64 py-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? drillId : undefined}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="flex max-w-full items-center gap-1.5 rounded-xs text-left font-semibold text-fg hover:text-primary hfm-focus-ring"
          data-testid="tires-priority-group-open"
        >
          <ChevronRight aria-hidden className={cn("size-4 shrink-0 text-fg-muted transition-transform", open && "rotate-90")} />
          <span className="truncate" title={g.label}>{g.label}</span>
          <span className="sr-only">{open ? " — fechar os pneus do grupo" : " — ver os pneus do grupo"}</span>
        </button>
      </TableCell>
      <TableCell className="py-2">
        <StatusBadge status={CRITICALITY_TONE[g.level]} withIcon size="sm">
          {CRITICALITY_LABEL[g.level]}
        </StatusBadge>
      </TableCell>
      <TableCell numeric className="py-2 font-semibold">{fmtInt(g.tires)}</TableCell>
      <TableCell numeric className="py-2">{fmtInt(g.fleets)}</TableCell>
      <TableCell numeric className="py-2"><Count value={g.nonconform} /></TableCell>
      <TableCell numeric className="py-2 font-semibold">{fmtPct(g.conformPct)}</TableCell>
      <TableCell numeric className="py-2"><Count value={g.critico} /></TableCell>
      <TableCell numeric className="py-2"><Count value={g.alto} /></TableCell>
      <TableCell numeric className="py-2"><Count value={g.medio} /></TableCell>
      <TableCell numeric className="py-2">
        <Count value={g.treadCritical} sub={g.belowLegal > 0 ? `${fmtInt(g.belowLegal)} abaixo do legal` : null} />
      </TableCell>
      <TableCell numeric className="py-2">
        <Count value={g.measurementOverdue} sub={g.measurementMissing > 0 ? `${fmtInt(g.measurementMissing)} sem registro` : null} />
      </TableCell>
      <TableCell numeric className="py-2">
        <Count value={g.calibrationOverdue} sub={g.calibrationMissing > 0 ? `${fmtInt(g.calibrationMissing)} sem registro` : null} />
      </TableCell>
      <TableCell numeric className="py-2">
        <Count value={g.psiOut} sub={g.psiNoRule > 0 ? `${fmtInt(g.psiNoRule)} sem parâmetro` : null} />
      </TableCell>
      <TableCell numeric className="py-2"><Count value={g.multiFailures} /></TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// Pneus do grupo aberto
// ---------------------------------------------------------------------------
const Drill = React.forwardRef<
  HTMLElement,
  {
    id: string;
    priorities: TiresPriorities;
    group: TirePriorityGroup | null;
    groupBy: TiresGroupBy;
    ctx: TiresPanelContext;
    to: Nav;
    onClose: () => void;
  }
>(function Drill({ id, priorities: p, group, groupBy, ctx, to, onClose }, ref) {
  const headingId = React.useId();
  const key = p.groupId ?? "";
  const label = group?.label ?? "grupo selecionado";
  const patch = filterPatch(ctx.filters, GROUP_FIELD[groupBy], key, "set");
  const baseNav = patch ? to("base", { visao: "fogo", situacao: "em_uso", severidade: "critica,alta,media,baixa", ...patch }) : null;
  const tires = p.tires ?? [];

  return (
    <section
      ref={ref}
      id={id}
      tabIndex={-1}
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4 shadow-card hfm-focus-ring"
      data-testid="tires-priority-drill"
      data-key={key}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 id={headingId} className="text-card-title font-semibold text-fg">
            Pneus de {label}
          </h3>
          <p className="text-caption text-fg-muted">
            {fmtInt(p.tiresTotal)} {plural(p.tiresTotal, "pneu em uso com alguma criticidade", "pneus em uso com alguma criticidade")}, do mais
            crítico para o menos crítico ({GROUP_BY_LABEL[groupBy]}).
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {baseNav ? (
            <Button asChild variant="secondary" size="sm">
              <a href={baseNav.href} onClick={baseNav.onClick} data-testid="tires-priority-drill-base">
                <ExternalLink aria-hidden />
                Ver na Base geral
              </a>
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" leadingIcon={<X />} onClick={onClose} disabled={ctx.pending} data-testid="tires-priority-drill-close">
            Fechar
            <span className="sr-only"> os pneus de {label}</span>
          </Button>
        </div>
      </header>

      <TableContainer>
        <Table className="min-w-[880px]" data-testid="tires-priority-drill-table">
          <TableHeader>
            <TableRow>
              <TableHead>Nº Fogo</TableHead>
              <TableHead>Veículo</TableHead>
              <TableHead>Posição</TableHead>
              <TableHead>Motivos</TableHead>
              <TableHead>Criticidade</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tires.length === 0 ? (
              <TableEmpty colSpan={5} message="Nenhum pneu com criticidade neste grupo." />
            ) : (
              tires.map((t) => <DrillRow key={t.tireId} t={t} />)
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <TiresPagination ctx={ctx} total={p.tiresTotal} limit={p.limit} label="Paginação dos pneus do grupo" testId="tires-priority-drill-pagination" />
    </section>
  );
});

/** Complemento do motivo com o dado que o explica (sulco, dias, PSI e faixa). */
function reasonDetail(code: string, t: TirePriorityTire): string | null {
  switch (code) {
    case "sulco_abaixo_legal":
    case "sulco_critico":
      return t.treadMin == null ? null : fmtMm(t.treadMin);
    case "medicao_vencida":
      return t.measurementDays == null ? null : `há ${fmtDays(t.measurementDays)}`;
    case "calibragem_vencida":
      return t.calibrationDays == null ? null : `há ${fmtDays(t.calibrationDays)}`;
    case "psi_baixa":
    case "psi_excesso":
      return `${fmtPsi(t.psi)}${t.psiMin != null && t.psiMax != null ? `, faixa ${fmtNum(t.psiMin)}–${fmtNum(t.psiMax)}` : ""}`;
    default:
      return null;
  }
}

function DrillRow({ t }: { t: TirePriorityTire }) {
  const place = [t.operationName, t.cityName ? `${t.cityName}${t.stateUf ? ` · ${t.stateUf}` : ""}` : null].filter(Boolean).join(" — ");
  const showCode = Boolean(t.positionCode && t.positionLabel && t.positionLabel !== t.positionCode);
  const reasons = (t.reasons ?? []).map(issueCode);
  return (
    <TableRow className="h-auto" data-testid="tires-priority-tire" data-criticality={t.criticality}>
      <TableCell className="py-2 align-top">
        <FireLink tireId={t.tireId} fireNumber={t.fireNumber} testId="tires-priority-fire" />
      </TableCell>
      <TableCell className="max-w-56 py-2 align-top">
        <span className="flex min-w-0 flex-col gap-0.5 leading-tight">
          <PlateLink vehicleId={t.vehicleId} plate={t.licensePlate} fleetCode={t.fleetNumber} testId="tires-priority-plate" />
          {place ? <span className="truncate text-caption text-fg-muted" title={place}>{place}</span> : null}
        </span>
      </TableCell>
      <TableCell className="py-2 align-top">
        <span className="flex flex-col gap-0.5 leading-tight">
          <span className="text-fg">{t.positionLabel ?? t.positionCode ?? "—"}</span>
          {showCode ? <span className="text-caption text-fg-muted">{t.positionCode}</span> : null}
        </span>
      </TableCell>
      <TableCell className="py-2 align-top">
        {reasons.length === 0 ? (
          <span className="text-fg-muted">Conforme nos quatro critérios</span>
        ) : (
          <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
            {reasons.map((code) => {
              const detail = reasonDetail(code, t);
              return (
                <li key={code} className="whitespace-nowrap">
                  <span className="text-fg">{reasonLabel(code)}</span>
                  {detail ? <span className="text-caption text-fg-muted tabular-nums"> ({detail})</span> : null}
                </li>
              );
            })}
          </ul>
        )}
      </TableCell>
      <TableCell className="py-2 align-top">
        <span className="flex flex-col items-start gap-0.5">
          <StatusBadge status={CRITICALITY_TONE[t.criticality]} withIcon size="sm">
            {CRITICALITY_LABEL[t.criticality]}
          </StatusBadge>
          <span className="text-caption text-fg-muted tabular-nums">{fmtInt(t.severityScore)} pontos</span>
        </span>
      </TableCell>
    </TableRow>
  );
}
