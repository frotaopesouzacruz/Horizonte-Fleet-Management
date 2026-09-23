"use client";

import * as React from "react";
import { CalendarCheck, ChevronLeft, ChevronRight, ListChecks, Wand2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox, CheckboxField } from "@/components/ui/checkbox";
import { Pagination } from "@/components/ui/pagination";
import { StatusBadge } from "@/components/ui/status-badge";
import { NativeSelect } from "@/components/governance/selects";
import { EmptyState } from "@/components/feedback/empty-state";
import type { AdherenceOptions, ChecklistContext, MatrixCell, MatrixPage, MatrixRow } from "@/lib/adherence/queries";
import { daysInCompetence, formatCompetence, weekdayOf, WEEKDAY_INITIALS, type Competence } from "@/lib/governance/competence";
import { CONTEXT_LABEL, formatInt, statusMeta, TONE_CLASS } from "./status";
import { BulkDaysDialog } from "./bulk-days-dialog";
import type { AdherenceFilterState, AdherencePerms, Navigate } from "./adherence-view";

export interface MatrixPanelProps {
  matrix: MatrixPage;
  competence: Competence;
  today: string;
  context: ChecklistContext;
  filters: AdherenceFilterState;
  options: AdherenceOptions;
  perms: AdherencePerms;
  navigate: Navigate;
  pending: boolean;
  onSelect: (obligationId: string) => void;
  onChanged: () => void;
}

/** Competência vizinha; o mês já é 1–12. */
function shiftCompetence({ year, month }: Competence, delta: number): Competence {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function cellTitle(cell: MatrixCell | undefined, date: string): string {
  if (!cell) return `${date}: sem dados (nenhuma obrigação conhecida)`;
  const meta = statusMeta(cell.status);
  const extras = [
    cell.provisional ? "dia vigente, ainda pode ser regularizado" : null,
    cell.pendingRequest ? "justificativa pendente" : null,
    cell.condition ? `condição detectada: ${statusMeta(cell.condition).label}` : null,
  ].filter(Boolean);
  return `${date}: ${meta.label}${extras.length ? ` · ${extras.join(" · ")}` : ""}`;
}

/**
 * Uma célula. O texto de duas letras é o status; a cor acompanha. Borda
 * tracejada marca o provisório (§15) e o ponto no canto, a solicitação
 * pendente (§66). Sem obrigação, a célula é um traço: "sem dados" é a
 * ausência de obrigação conhecida, nunca a ausência de execução (§21).
 */
function Cell({ cell, date, onSelect }: { cell: MatrixCell | undefined; date: string; onSelect: (id: string) => void }) {
  if (!cell) {
    return (
      <div className="flex h-8 w-[var(--cell-w)] items-center justify-center text-fg-subtle" title={cellTitle(cell, date)}>
        <span aria-hidden>—</span>
        <span className="sr-only">Sem dados</span>
      </div>
    );
  }
  const meta = statusMeta(cell.status);
  return (
    <button
      type="button"
      onClick={() => onSelect(cell.id)}
      title={cellTitle(cell, date)}
      aria-label={cellTitle(cell, date)}
      className={cn(
        "relative flex h-8 w-[var(--cell-w)] items-center justify-center rounded-xs border text-[11px] font-semibold tracking-wide transition-colors hfm-focus-ring",
        TONE_CLASS[meta.tone],
        cell.provisional && "border-dashed",
      )}
    >
      {meta.short}
      {cell.pendingRequest ? (
        <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-warning" aria-hidden />
      ) : null}
    </button>
  );
}

function RowLabel({ row }: { row: MatrixRow }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="truncate text-label font-semibold text-fg">
        {row.fleetCode ?? "—"} <span className="font-normal text-fg-muted">{row.licensePlate ?? ""}</span>
      </span>
      <span className="truncate text-caption text-fg-muted">
        {[row.operationName, row.cityName ? `${row.cityName}${row.stateUf ? `/${row.stateUf}` : ""}` : null, row.brCode]
          .filter(Boolean).join(" · ")}
      </span>
      <span className="truncate text-caption text-fg-subtle">{row.leaderName ?? "Sem liderança resolvida"}</span>
    </div>
  );
}

/**
 * Matriz mês/dia (§47, §65): veículos nas linhas, dias nas colunas, primeira
 * coluna e cabeçalho fixos, rolagem horizontal. Cada célula é a obrigação
 * daquele dia com o contexto congelado na data — a operação atual do veículo
 * não reclassifica nada. No celular, a matriz vira a visão por veículo:
 * 31 colunas não cabem em 390px e não devem ser espremidas.
 */
export function MatrixPanel({
  matrix, competence, today, context, filters, options, perms, navigate, pending, onSelect, onChanged,
}: MatrixPanelProps) {
  const days = daysInCompetence(competence);
  const dayList = React.useMemo(() => Array.from({ length: days }, (_, i) => i + 1), [days]);
  const dateOf = (day: number) => `${competence.year}-${String(competence.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const [mobileVehicle, setMobileVehicle] = React.useState<string>("");
  const mobileRow = matrix.rows.find((r) => r.vehicleId === mobileVehicle) ?? matrix.rows[0];

  // Navegação de mês (§37): troca a competência na URL e volta à primeira página.
  const goTo = (c: Competence) => navigate({ ano: String(c.year), mes: String(c.month), dia: null, pagina: null });
  const todayCompetence: Competence = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
  const isCurrentMonth = todayCompetence.year === competence.year && todayCompetence.month === competence.month;

  // Seleção de dias (§40): só existe enquanto o modo está ligado, e a
  // alteração em massa só alcança os dias marcados — nunca "todos os dias"
  // por omissão. Trocar de competência descarta a seleção: os dias são de um mês.
  const [selecting, setSelecting] = React.useState(false);
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const competenceKey = `${competence.year}-${competence.month}`;
  const [selection, setSelection] = React.useState<{ key: string; days: number[] }>({ key: competenceKey, days: [] });
  const selectedDays = selection.key === competenceKey ? selection.days : [];
  const setSelectedDays = (days: number[]) => setSelection({ key: competenceKey, days });
  const toggleDay = (day: number, checked: boolean) =>
    setSelectedDays(checked ? [...new Set([...selectedDays, day])].sort((a, b) => a - b) : selectedDays.filter((d) => d !== day));
  const selectedDates = selectedDays.map(dateOf);
  const canBulk = perms.bulk && perms.override;

  const monthNav = (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Navegação de mês">
      <Button variant="secondary" size="sm" leadingIcon={<ChevronLeft />} disabled={pending} onClick={() => goTo(shiftCompetence(competence, -1))}>
        Mês anterior
      </Button>
      <Button variant="secondary" size="sm" trailingIcon={<ChevronRight />} disabled={pending} onClick={() => goTo(shiftCompetence(competence, 1))}>
        Próximo mês
      </Button>
      <Button variant="ghost" size="sm" leadingIcon={<CalendarCheck />} disabled={pending || isCurrentMonth} onClick={() => goTo(todayCompetence)}>
        Mês atual
      </Button>
    </div>
  );

  if (matrix.rows.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          {monthNav}
          <EmptyState
            title="Nenhuma obrigação no recorte"
            description="Não há veículos com obrigação de checklist para os filtros e a competência escolhidos. Se a competência é futura, as obrigações aparecem conforme a rotina diária materializa o planejamento."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {monthNav}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={selecting ? "primary" : "secondary"}
              size="sm"
              leadingIcon={<ListChecks />}
              aria-pressed={selecting}
              disabled={pending}
              onClick={() => { setSelecting((v) => !v); if (selecting) setSelectedDays([]); }}
            >
              Selecionar dias
            </Button>
            {selecting ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-secondary px-2.5 py-1 text-caption text-fg" role="status">
                {formatInt(selectedDays.length)} {selectedDays.length === 1 ? "dia selecionado" : "dias selecionados"}
                <button type="button" className="text-fg-muted underline-offset-2 hover:underline hfm-focus-ring rounded-xs disabled:opacity-50"
                  disabled={selectedDays.length === 0} onClick={() => setSelectedDays([])}>
                  Limpar
                </button>
              </span>
            ) : null}
            {selecting && canBulk ? (
              <Button size="sm" leadingIcon={<Wand2 />} disabled={pending || selectedDays.length === 0} onClick={() => setBulkOpen(true)}>
                Alterar em massa…
              </Button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-h4 font-semibold text-fg">{CONTEXT_LABEL[context]} · {formatCompetence(competence)}</h3>
            <p className="text-caption text-fg-muted">
              {formatInt(matrix.total)} veículos · página {matrix.page} de {Math.max(1, Math.ceil(matrix.total / matrix.pageSize))} · selecione uma célula para o detalhe
            </p>
          </div>
          <ul className="flex flex-wrap gap-2 text-caption text-fg-muted" aria-label="Legenda dos status">
            {(["FEZ_CHECKLIST", "NAO_FEZ_CHECKLIST", "RETORNO_PENDENTE", "PLANEJADO", "SEM_ROTA", "MANUTENCAO", "FROTA_RESERVA", "EM_VIAGEM"] as const).map((code) => {
              const m = statusMeta(code);
              return (
                <li key={code} className="flex items-center gap-1">
                  <span className={cn("inline-flex h-4 min-w-6 items-center justify-center rounded-xs border px-1 text-[10px] font-semibold", TONE_CLASS[m.tone])}>{m.short}</span>
                  {m.label}
                </li>
              );
            })}
          </ul>
        </div>
        <p className="text-caption text-fg-muted">
          Situação da justificativa: o filtro &ldquo;Justificativa&rdquo; no topo da página recorta a matriz por pendente, aprovada, rejeitada ou sem justificativa; o ponto no canto da célula marca a solicitação pendente (§36, §66).
        </p>

        {/* ------------------------------------------------- desktop / tablet */}
        <div
          className="relative hidden overflow-x-auto md:block"
          style={{ ["--cell-w" as string]: "2.5rem", ["--label-w" as string]: "16rem" }}
        >
          <div className="min-w-max">
            <div className="sticky top-0 z-30 flex border-b border-border bg-surface-elevated">
              <div
                className="sticky left-0 z-40 flex items-center border-r border-border bg-surface-elevated px-3 py-2"
                style={{ width: "var(--label-w)", minWidth: "var(--label-w)" }}
              >
                <span className="text-caption font-medium uppercase tracking-wide text-fg-muted">Veículo</span>
              </div>
              {dayList.map((day) => {
                const date = dateOf(day);
                const wd = weekdayOf(competence.year, competence.month, day);
                const selected = selectedDays.includes(day);
                return (
                  <div
                    key={day}
                    data-selected={selected || undefined}
                    className={cn(
                      "flex w-[var(--cell-w)] flex-col items-center justify-center gap-0.5 py-1 text-caption",
                      date === today ? "text-primary font-semibold" : wd >= 6 ? "text-fg-subtle" : "text-fg-muted",
                      selected && "rounded-xs bg-selected-overlay text-fg",
                    )}
                  >
                    <span className="text-[10px] uppercase">{WEEKDAY_INITIALS[wd]}</span>
                    <span className="tabular-nums">{day}</span>
                    {selecting ? (
                      <Checkbox
                        aria-label={`Selecionar dia ${String(day).padStart(2, "0")}`}
                        checked={selected}
                        onCheckedChange={(v) => toggleDay(day, v === true)}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>

            {matrix.rows.map((row) => (
              <div key={row.vehicleId} className="flex border-b border-border last:border-b-0">
                <div
                  className="sticky left-0 z-20 flex items-center border-r border-border bg-surface px-3 py-1.5"
                  style={{ width: "var(--label-w)", minWidth: "var(--label-w)" }}
                >
                  <RowLabel row={row} />
                </div>
                {dayList.map((day) => (
                  <div key={day} className="flex items-center justify-center py-1">
                    <Cell cell={row.days[String(day)]} date={dateOf(day)} onSelect={onSelect} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* ------------------------------------------------------- celular */}
        <div className="flex flex-col gap-3 md:hidden">
          {selecting ? (
            <fieldset className="rounded-md border border-border p-3">
              <legend className="px-1 text-caption font-medium text-fg-muted">Dias selecionados</legend>
              <div className="grid grid-cols-3 gap-x-3 gap-y-1.5">
                {dayList.map((day) => (
                  <CheckboxField
                    key={day}
                    label={`${String(day).padStart(2, "0")} ${WEEKDAY_INITIALS[weekdayOf(competence.year, competence.month, day)]}`}
                    checked={selectedDays.includes(day)}
                    onCheckedChange={(v) => toggleDay(day, v === true)}
                  />
                ))}
              </div>
            </fieldset>
          ) : null}
          <NativeSelect
            fieldSize="sm"
            aria-label="Veículo"
            value={mobileRow?.vehicleId ?? ""}
            onChange={(e) => setMobileVehicle(e.target.value)}
          >
            {matrix.rows.map((r) => (
              <option key={r.vehicleId} value={r.vehicleId}>
                {r.fleetCode ?? "—"} · {r.licensePlate ?? ""}
              </option>
            ))}
          </NativeSelect>
          {mobileRow ? (
            <>
              <RowLabel row={mobileRow} />
              <ul className="divide-y divide-border rounded-md border border-border">
                {dayList.map((day) => {
                  const cell = mobileRow.days[String(day)];
                  const meta = statusMeta(cell?.status ?? null);
                  const date = dateOf(day);
                  return (
                    <li key={day} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className={cn("text-label tabular-nums", date === today ? "font-semibold text-primary" : "text-fg")}>
                        {String(day).padStart(2, "0")} <span className="text-caption text-fg-muted">{WEEKDAY_INITIALS[weekdayOf(competence.year, competence.month, day)]}</span>
                      </span>
                      {cell ? (
                        <button type="button" onClick={() => onSelect(cell.id)} className="hfm-focus-ring rounded-sm">
                          <StatusBadge status={meta.tone} size="sm">
                            {meta.label}{cell.provisional ? " · provisório" : ""}{cell.pendingRequest ? " · pendente" : ""}
                          </StatusBadge>
                        </button>
                      ) : (
                        <span className="text-caption text-fg-subtle">Sem dados</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </div>

        {matrix.total > matrix.pageSize ? (
          <Pagination
            page={matrix.page}
            pageSize={matrix.pageSize}
            total={matrix.total}
            disabled={pending}
            onPageChange={(p) => navigate({ pagina: String(p) })}
            label="Páginas da matriz"
          />
        ) : null}
      </CardContent>

      {canBulk ? (
        <BulkDaysDialog
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          dates={selectedDates}
          context={context}
          filters={filters}
          options={options}
          onChanged={() => { setSelectedDays([]); onChanged(); }}
        />
      ) : null}
    </Card>
  );
}
