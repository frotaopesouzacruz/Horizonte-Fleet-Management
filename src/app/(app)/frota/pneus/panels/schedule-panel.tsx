"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarClock, CalendarDays, CalendarX, ChevronRight, CircleSlash, Truck, Upload } from "lucide-react";
import { cn } from "@/lib/cn";
import { InsightCard } from "@/components/feedback/insight-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge, statusTone, type StatusTone } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TiresTabData } from "@/lib/tires/loaders";
import {
  DEADLINE_SHORT, DEADLINE_TONE, SCHEDULE_WINDOW_LABEL, fmtDays, fmtInt, formatDate, plural,
  type DeadlineStatus, type ScheduleWindow, type TireScheduleRow, type TiresSchedule,
} from "@/lib/tires/types";
import type { TiresPanelContext } from "../shared";
import {
  ExportButton, FireLink, PanelEmpty, PanelError, PlateLink, Section, TiresKpi, TiresPagination, useTiresLink, vehicleName,
} from "./tires-ui";

/**
 * Gestão de Pneus → Cronograma.
 *
 * `tires_schedule` agrupa os pneus em uso da fotografia mais recente por
 * frota/placa — o pior pneu manda: a frota assume a data mais antiga de
 * medição e de calibragem — e devolve a página já ordenada pela pior
 * situação e pelo vencimento, com a agenda de janelas e os pneus de cada
 * frota. A tela só agrupa visualmente a página por data e abre os pneus.
 */
export function SchedulePanel({ data, ctx }: { data: TiresTabData["cronograma"] | null; ctx: TiresPanelContext }) {
  if (ctx.error) return <PanelError ctx={ctx} title="Não foi possível carregar o cronograma de pneus." testId="tires-cronograma-error" />;
  if (!data) {
    return (
      <PanelEmpty
        icon={<CalendarDays />}
        title="Sem dados do cronograma"
        description="A rotina não devolveu resultado. Recarregue a página."
        testId="tires-cronograma-empty"
      />
    );
  }
  if (data.empty) {
    return (
      <PanelEmpty
        icon={<Upload />}
        title="Nenhuma fotografia importada"
        description="O cronograma de medição e calibragem é montado sobre a fotografia oficial mais recente importada do Rodopar 10. Assim que a primeira planilha for confirmada, as frotas aparecem aqui."
        testId="tires-cronograma-empty"
        action={
          ctx.perms.import ? (
            <Button asChild size="sm" variant="primary">
              <Link href={`${ctx.basePath}?aba=importacao`}>
                <Upload aria-hidden />
                Importar fotografia
              </Link>
            </Button>
          ) : undefined
        }
      />
    );
  }
  return <ScheduleContent data={data} ctx={ctx} />;
}

const WINDOW_ORDER: ScheduleWindow[] = ["todos", "vencidos", "hoje", "7d", "15d", "proximos", "sem_medicao", "sem_calibragem"];
const WINDOW_TONE: Record<ScheduleWindow, StatusTone | null> = {
  todos: null,
  vencidos: "danger",
  hoje: "warning",
  "7d": "warning",
  "15d": "info",
  proximos: "warning",
  sem_medicao: "pending",
  sem_calibragem: "pending",
};

/** `worst` da rotina (0 = vencido, 1 = sem registro, 2 = próximo, 3 = em dia) → situação. */
const WORST_STATUS: DeadlineStatus[] = ["vencido", "sem_registro", "proximo", "em_dia"];
const worstOf = (row: TireScheduleRow): DeadlineStatus => WORST_STATUS[row.worst] ?? "em_dia";

/** Faixa à esquerda da linha, na cor da pior situação (o rótulo vem nos selos). */
const ROW_ACCENT: Record<DeadlineStatus, string> = {
  vencido: "shadow-[inset_3px_0_0_var(--danger)]",
  sem_registro: "shadow-[inset_3px_0_0_var(--neutral)]",
  proximo: "shadow-[inset_3px_0_0_var(--warning)]",
  em_dia: "",
};

// ---------------------------------------------------------------------------
// Datas (aaaa-mm-dd, sem fuso)
// ---------------------------------------------------------------------------
const dayNumber = (iso: string | null | undefined): number | null => {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000 : null;
};
const daysFrom = (today: string, date: string | null): number | null => {
  const a = dayNumber(today);
  const b = dayNumber(date);
  return a == null || b == null ? null : b - a;
};
/** dd/mm/aa — a forma curta das colunas de prazo (a data completa fica nos pneus). */
const shortDate = (iso: string | null) => {
  const m = iso?.match(/^\d{2}(\d{2})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
};
const relative = (diff: number) => (diff === 0 ? "hoje" : diff < 0 ? `há ${fmtDays(-diff)}` : `em ${fmtDays(diff)}`);

/** Grupos visuais da página, pela pior situação e pela data de vencimento. */
type Bucket = "vencidos" | "sem_registro" | "hoje" | "7d" | "15d" | "depois" | "sem_data";
const BUCKET_ORDER: Bucket[] = ["vencidos", "sem_registro", "hoje", "7d", "15d", "depois", "sem_data"];
const BUCKET_LABEL: Record<Bucket, string> = {
  vencidos: "Vencidos",
  sem_registro: "Sem medição ou calibragem em algum pneu",
  hoje: "Vence hoje",
  "7d": "Próximos 7 dias",
  "15d": "De 8 a 15 dias",
  depois: "Mais de 15 dias",
  sem_data: "Sem data de vencimento",
};
const BUCKET_TONE: Record<Bucket, StatusTone> = {
  vencidos: "danger",
  sem_registro: "pending",
  hoje: "warning",
  "7d": "warning",
  "15d": "info",
  depois: "success",
  sem_data: "neutral",
};

function bucketOf(row: TireScheduleRow, today: string): Bucket {
  if (row.worst === 0) return "vencidos";
  if (row.worst === 1) return "sem_registro";
  const diff = daysFrom(today, row.nextDue);
  if (diff == null) return "sem_data";
  if (diff < 0) return "vencidos";
  if (diff === 0) return "hoje";
  if (diff <= 7) return "7d";
  if (diff <= 15) return "15d";
  return "depois";
}

const rowKey = (row: TireScheduleRow, i: number) => row.vehicleId ?? `frota:${row.fleetNumber ?? row.licensePlate ?? i}`;

// ---------------------------------------------------------------------------
// Conteúdo
// ---------------------------------------------------------------------------
function ScheduleContent({ data, ctx }: { data: TiresSchedule; ctx: TiresPanelContext }) {
  const k = data.kpis;
  const p = data.parameters;
  const link = useTiresLink(ctx);
  // A mesma validação do carregador: a janela pedida na URL é a que a rotina recebeu.
  const requested = ctx.params.janela as ScheduleWindow | undefined;
  const current: ScheduleWindow =
    requested && WINDOW_ORDER.includes(requested) ? requested : WINDOW_ORDER.includes(data.window) ? data.window : "todos";
  const toWindow = (w: ScheduleWindow) => (w === current ? null : link({ janela: w === "todos" ? null : w }));

  return (
    <div className="flex flex-col gap-6" data-testid="tires-cronograma">
      <p className="text-body-sm text-fg-muted" data-testid="tires-cronograma-period">
        Fotografia oficial mais recente: <span className="font-medium text-fg-secondary tabular-nums">{formatDate(data.referenceDate)}</span> ·{" "}
        {fmtInt(k.units)} {plural(k.units, "frota com pneus em uso", "frotas com pneus em uso")} · prazos contados até{" "}
        <span className="tabular-nums">{formatDate(data.asOf)}</span>
      </p>

      <Section
        title="Situação das frotas"
        testId="tires-cronograma-kpis"
        description="Uma frota por veículo (ou código de frota). O pior pneu manda: a frota assume a data mais antiga de medição e de calibragem entre os pneus em uso, e fica sem registro se algum pneu não tiver data."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1 sm:row-span-2">
            <TiresKpi
              kpi="cronograma-frotas"
              label="Frotas no cronograma"
              value={fmtInt(k.units)}
              period="com pneus em uso na fotografia"
              status="primary"
              icon={<Truck />}
              nav={toWindow("todos")}
              destination="Mostrar todas as frotas"
            />
          </div>
          <TiresKpi
            kpi="cronograma-medicao-vencida"
            label="Medição vencida"
            value={fmtInt(k.measurementOverdue)}
            period={`acima de ${fmtDays(p.measurementWarningDays)}`}
            status={k.measurementOverdue > 0 ? "danger" : undefined}
            icon={<CalendarX />}
          />
          <TiresKpi
            kpi="cronograma-medicao-proxima"
            label="Medição próxima"
            value={fmtInt(k.measurementDueSoon)}
            period={`${fmtInt(p.measurementOkDays + 1)} a ${fmtDays(p.measurementWarningDays)}`}
            status={k.measurementDueSoon > 0 ? "warning" : undefined}
            icon={<CalendarClock />}
          />
          <TiresKpi
            kpi="cronograma-sem-medicao"
            label="Sem medição"
            value={fmtInt(k.measurementMissing)}
            period="algum pneu sem data"
            status={k.measurementMissing > 0 ? "neutral" : undefined}
            icon={<CircleSlash />}
            nav={toWindow("sem_medicao")}
            destination="Mostrar as frotas sem medição"
          />
          <TiresKpi
            kpi="cronograma-calibragem-vencida"
            label="Calibragem vencida"
            value={fmtInt(k.calibrationOverdue)}
            period={`acima de ${fmtDays(p.calibrationWarningDays)}`}
            status={k.calibrationOverdue > 0 ? "danger" : undefined}
            icon={<CalendarX />}
          />
          <TiresKpi
            kpi="cronograma-calibragem-proxima"
            label="Calibragem próxima"
            value={fmtInt(k.calibrationDueSoon)}
            period={`${fmtInt(p.calibrationOkDays + 1)} a ${fmtDays(p.calibrationWarningDays)}`}
            status={k.calibrationDueSoon > 0 ? "warning" : undefined}
            icon={<CalendarClock />}
          />
          <TiresKpi
            kpi="cronograma-sem-calibragem"
            label="Sem calibragem"
            value={fmtInt(k.calibrationMissing)}
            period="algum pneu sem data"
            status={k.calibrationMissing > 0 ? "neutral" : undefined}
            icon={<CircleSlash />}
            nav={toWindow("sem_calibragem")}
            destination="Mostrar as frotas sem calibragem"
          />
        </div>
      </Section>

      <InsightCard tone="info" label="Regra vigente" compact data-testid="tires-cronograma-rule">
        <strong>Medição</strong>: em dia até {fmtDays(p.measurementOkDays)} desde a medição mais antiga da frota, próxima do vencimento até{" "}
        {fmtDays(p.measurementWarningDays)}, vencida acima disso; a próxima medição vence {fmtDays(p.measurementWarningDays)} depois dela.{" "}
        <strong>Calibragem</strong>: em dia até {fmtDays(p.calibrationOkDays)}, próxima até {fmtDays(p.calibrationWarningDays)}, vencida acima
        disso; a próxima vence {fmtDays(p.calibrationWarningDays)} depois da calibragem mais antiga. As janelas da agenda contam a partir de hoje
        ({formatDate(data.today)}). Sempre a fotografia mais recente do Rodopar 10 — vistorias de campo não alteram a base até serem lançadas no
        Rodopar e importadas.
      </InsightCard>

      <Section
        title="Agenda de vencimentos"
        testId="tires-cronograma-agenda"
        description="Escolha uma janela para ver as frotas que vencem nela. A lista vem do vencimento mais atrasado para o mais distante; abra uma frota para ver os pneus por posição."
        actions={<ExportButton ctx={ctx} kind="cronograma" extra={{ janela: current === "todos" ? null : current }} />}
      >
        <WindowNav data={data} current={current} ctx={ctx} />
        {data.rows.length === 0 ? (
          <PanelEmpty
            icon={<CalendarDays />}
            title={current === "todos" ? "Nenhuma frota no recorte" : `Nenhuma frota em “${SCHEDULE_WINDOW_LABEL[current]}”`}
            description={
              current === "todos"
                ? "Nenhuma frota com pneus em uso corresponde aos filtros. Ajuste ou limpe os filtros da tela."
                : "Escolha outra janela da agenda ou ajuste os filtros da tela."
            }
            testId="tires-cronograma-rows-empty"
          />
        ) : (
          <ScheduleTable rows={data.rows} today={data.today} />
        )}
        <TiresPagination ctx={ctx} total={data.total} limit={data.limit} label="Paginação do cronograma" testId="tires-cronograma-pagination" />
      </Section>
    </div>
  );
}

/** Janelas da agenda como links (copiáveis), com as contagens da rotina. */
function WindowNav({ data, current, ctx }: { data: TiresSchedule; current: ScheduleWindow; ctx: TiresPanelContext }) {
  const link = useTiresLink(ctx);
  const a = data.agenda;
  const counts: Record<ScheduleWindow, number | null> = {
    todos: data.kpis.units,
    vencidos: a.vencidos,
    hoje: a.hoje,
    "7d": a.proximos7,
    "15d": a.proximos15,
    proximos: null,
    sem_medicao: a.semMedicao,
    sem_calibragem: a.semCalibragem,
  };
  return (
    <nav aria-label="Janela da agenda" data-testid="tires-cronograma-windows">
      <ul className="flex flex-wrap gap-1.5">
        {WINDOW_ORDER.map((w) => {
          const selected = w === current;
          const nav = link({ janela: w === "todos" ? null : w });
          const tone = WINDOW_TONE[w];
          const count = counts[w];
          return (
            <li key={w}>
              <a
                href={nav.href}
                onClick={nav.onClick}
                aria-current={selected ? "true" : undefined}
                data-testid={`tires-cronograma-window-${w}`}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-body-sm font-medium whitespace-nowrap hfm-transition hfm-focus-ring",
                  selected
                    ? "border-primary/40 bg-primary-soft text-primary-soft-fg"
                    : "border-border bg-surface-raised text-fg-secondary shadow-xs hover:border-input-border-hover hover:text-fg",
                  ctx.pending && "pointer-events-none opacity-70",
                )}
              >
                {tone ? <span aria-hidden className={cn("size-2 shrink-0 rounded-full", statusTone(tone).dotClassName)} /> : null}
                {SCHEDULE_WINDOW_LABEL[w]}
                {count != null ? (
                  <span className={cn("tabular-nums", selected ? "font-semibold" : "text-fg")}>{fmtInt(count)}</span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Lista por frota
// ---------------------------------------------------------------------------
const COLS = 7;

function ScheduleTable({ rows, today }: { rows: TireScheduleRow[]; today: string }) {
  const [open, setOpen] = React.useState<Set<string>>(() => new Set());
  const baseId = React.useId();

  const groups = React.useMemo(() => {
    const map = new Map<Bucket, { row: TireScheduleRow; key: string }[]>();
    rows.forEach((row, i) => {
      const b = bucketOf(row, today);
      const list = map.get(b) ?? [];
      list.push({ row, key: rowKey(row, i) });
      map.set(b, list);
    });
    return BUCKET_ORDER.filter((b) => map.has(b)).map((b) => ({ bucket: b, items: map.get(b) ?? [] }));
  }, [rows, today]);
  const showGroups = groups.length > 1;

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <TableContainer stickyHeader className="max-h-[75vh]" data-testid="tires-cronograma-table">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-px pr-0 pl-2">
              <span className="sr-only">Pneus da frota</span>
            </TableHead>
            <TableHead>Veículo</TableHead>
            <TableHead>Vence em</TableHead>
            <TableHead>Medição</TableHead>
            <TableHead>Calibragem</TableHead>
            <TableHead>Operação / local</TableHead>
            <TableHead>BR · liderança</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((g) => (
            <React.Fragment key={g.bucket}>
              {showGroups ? (
                <TableRow className="h-9 bg-surface-sunken/60 hover:bg-surface-sunken/60" data-testid="tires-cronograma-group" data-bucket={g.bucket}>
                  <TableCell colSpan={COLS} className="py-1.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span aria-hidden className={cn("size-2 rounded-full", statusTone(BUCKET_TONE[g.bucket]).dotClassName)} />
                      <span className="text-body-sm font-semibold text-fg">{BUCKET_LABEL[g.bucket]}</span>
                      <Badge variant="neutral" size="sm" className="tabular-nums">
                        {fmtInt(g.items.length)} {plural(g.items.length, "frota nesta página", "frotas nesta página")}
                      </Badge>
                    </span>
                  </TableCell>
                </TableRow>
              ) : null}
              {g.items.map(({ row, key }) => (
                <ScheduleRow
                  key={key}
                  row={row}
                  today={today}
                  isOpen={open.has(key)}
                  onToggle={() => toggle(key)}
                  detailId={`${baseId}-${key}`}
                />
              ))}
            </React.Fragment>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function ScheduleRow({
  row, today, isOpen, onToggle, detailId,
}: {
  row: TireScheduleRow;
  today: string;
  isOpen: boolean;
  onToggle: () => void;
  detailId: string;
}) {
  const worst = worstOf(row);
  const name = vehicleName(row.fleetNumber, row.licensePlate);
  const diff = daysFrom(today, row.nextDue);
  const local = [row.cityName, row.stateUf].filter(Boolean).join("/");

  return (
    <>
      <TableRow className={cn("h-14", ROW_ACCENT[worst])} data-testid="tires-cronograma-row" data-worst={worst} data-open={isOpen || undefined}>
        <TableCell className="w-px py-1.5 pr-0 pl-2">
          <button
            type="button"
            aria-expanded={isOpen}
            aria-controls={detailId}
            onClick={onToggle}
            className="flex size-8 items-center justify-center rounded-sm text-fg-muted hfm-transition hfm-focus-ring hover:bg-hover-overlay hover:text-fg"
            data-testid="tires-cronograma-row-toggle"
          >
            <ChevronRight className={cn("size-4 transition-transform", isOpen && "rotate-90")} aria-hidden />
            <span className="sr-only">
              {isOpen ? "Ocultar" : "Mostrar"} {plural(row.tires, "o pneu", `os ${fmtInt(row.tires)} pneus`)} de {name}
            </span>
          </button>
        </TableCell>
        <TableCell className="whitespace-nowrap py-1.5">
          <span className="flex flex-col leading-tight">
            <PlateLink vehicleId={row.vehicleId} plate={row.licensePlate} fleetCode={row.fleetNumber} testId="tires-cronograma-plate" />
            <span className="text-caption text-fg-muted">
              {row.vehicleTypeName ?? "Sem tipo"} · {fmtInt(row.tires)} {plural(row.tires, "pneu", "pneus")}
            </span>
          </span>
          <span className="sr-only">. Pior situação: {DEADLINE_SHORT[worst]}.</span>
        </TableCell>
        <TableCell className="whitespace-nowrap py-1.5">
          {row.nextDue ? (
            <span className="flex flex-col leading-tight">
              <span className={cn("tabular-nums", worst === "vencido" ? "font-semibold text-danger-soft-fg" : "text-fg")}>{formatDate(row.nextDue)}</span>
              {diff != null ? <span className="text-caption text-fg-muted">{relative(diff)}</span> : null}
            </span>
          ) : (
            <span className="text-fg-muted">sem data</span>
          )}
        </TableCell>
        <TableCell className="py-1.5">
          <DeadlinePair status={row.measurementStatus} worst={worst} last={row.lastMeasurement} next={row.nextMeasurement} />
        </TableCell>
        <TableCell className="py-1.5">
          <DeadlinePair status={row.calibrationStatus} worst={worst} last={row.lastCalibration} next={row.nextCalibration} />
        </TableCell>
        <TableCell className="max-w-[14rem] py-1.5">
          <span className="flex min-w-0 flex-col leading-tight">
            <span className={cn("truncate", row.operationName ? "text-fg-secondary" : "text-fg-muted")}>{row.operationName ?? "Sem operação"}</span>
            {local ? <span className="truncate text-caption text-fg-muted">{local}</span> : null}
          </span>
        </TableCell>
        <TableCell className="max-w-[12rem] py-1.5">
          <span className="flex min-w-0 flex-col leading-tight">
            <span className={cn("truncate", row.brCode ? "text-fg-secondary" : "text-fg-muted")}>{row.brCode ?? "Sem BR"}</span>
            <span className="truncate text-caption text-fg-muted">{row.leaderName ?? "Sem liderança"}</span>
          </span>
        </TableCell>
      </TableRow>
      <TableRow id={detailId} hidden={!isOpen} className="bg-surface-sunken/40 hover:bg-surface-sunken/40" data-testid="tires-cronograma-detail">
        <TableCell colSpan={COLS} className="px-3 py-3">
          {isOpen ? <TireRows row={row} name={name} /> : null}
        </TableCell>
      </TableRow>
    </>
  );
}

/** Selo da situação com a última e a próxima data; o selo da pior situação leva o ícone. */
function DeadlinePair({ status, worst, last, next }: { status: DeadlineStatus; worst: DeadlineStatus; last: string | null; next: string | null }) {
  const isWorst = status === worst && status !== "em_dia";
  return (
    <span className="flex flex-col items-start gap-1">
      <StatusBadge status={DEADLINE_TONE[status]} size="sm" withIcon={isWorst} className={cn(isWorst && "font-bold")}>
        {DEADLINE_SHORT[status]}
      </StatusBadge>
      <span className="whitespace-nowrap text-caption text-fg-muted tabular-nums">
        <span className="sr-only">Última: </span>
        <span aria-hidden>Últ. </span>
        {shortDate(last)} · <span className="sr-only">próxima: </span>
        <span aria-hidden>Próx. </span>
        {shortDate(next)}
      </span>
    </span>
  );
}

function TireRows({ row, name }: { row: TireScheduleRow; name: string }) {
  if (row.tireRows.length === 0) return <p className="text-body-sm text-fg-muted">Nenhum pneu em uso listado para esta frota.</p>;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-caption text-fg-muted">
        {fmtInt(row.tireRows.length)} {plural(row.tireRows.length, "pneu em uso", "pneus em uso")} de {name}, por posição. Nº Fogo abre a ficha
        do pneu.
      </p>
      <div className="max-w-4xl overflow-x-auto rounded-md border border-border-subtle bg-surface">
        <table className="w-full text-body-sm" aria-label={`Pneus de ${name}`}>
          <thead className="bg-surface-secondary text-caption font-semibold text-fg-secondary">
            <tr className="h-8 border-b border-border-subtle">
              <th scope="col" className="px-3 text-left">Nº Fogo</th>
              <th scope="col" className="px-3 text-left">Posição</th>
              <th scope="col" className="px-3 text-left">Última medição</th>
              <th scope="col" className="px-3 text-left">Medição</th>
              <th scope="col" className="px-3 text-left">Última calibragem</th>
              <th scope="col" className="px-3 text-left">Calibragem</th>
            </tr>
          </thead>
          <tbody>
            {row.tireRows.map((t) => {
              const position = t.positionLabel ?? t.positionCode;
              return (
                <tr key={t.tireId} className="h-9 border-b border-border-subtle last:border-0" data-testid="tires-cronograma-tire">
                  <td className="whitespace-nowrap px-3">
                    <FireLink tireId={t.tireId} fireNumber={t.fireNumber} testId="tires-cronograma-tire-fire" />
                  </td>
                  <td className="whitespace-nowrap px-3 text-fg-secondary">
                    {position ?? <span className="text-fg-muted">—</span>}
                    {t.positionLabel && t.positionCode && t.positionLabel !== t.positionCode ? (
                      <span className="ml-1.5 text-caption text-fg-muted">{t.positionCode}</span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 tabular-nums">
                    {t.measurementDate ? formatDate(t.measurementDate) : <span className="text-fg-muted">sem registro</span>}
                  </td>
                  <td className="px-3">
                    <StatusBadge status={DEADLINE_TONE[t.measurementStatus]} size="sm">
                      {DEADLINE_SHORT[t.measurementStatus]}
                    </StatusBadge>
                  </td>
                  <td className="whitespace-nowrap px-3 tabular-nums">
                    {t.calibrationDate ? formatDate(t.calibrationDate) : <span className="text-fg-muted">sem registro</span>}
                  </td>
                  <td className="px-3">
                    <StatusBadge status={DEADLINE_TONE[t.calibrationStatus]} size="sm">
                      {DEADLINE_SHORT[t.calibrationStatus]}
                    </StatusBadge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
