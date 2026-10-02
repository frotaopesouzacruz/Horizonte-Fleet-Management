"use client";

import * as React from "react";
import { Pagination } from "@/components/ui/pagination";
import { SearchField } from "@/components/ui/search-field";
import {
  Table, TableBody, TableCaption, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/cn";
import type { KmAnalysisData, KmAnalysisVehicle } from "@/lib/km/analysis";
import { fmt1, fmtInt, fmtKm } from "@/lib/km/types";
import { signedNum, SortHead, ToneBadge, usePage, useSorted } from "./shared";

/**
 * Análise gerencial → Projeções. O hodômetro em 30/60/90 dias e o próximo
 * marco preventivo vêm da rotina (ritmo do período × dias); a confiança segue
 * a cobertura de leituras. A tela só ordena: vencidos primeiro, depois os
 * marcos mais próximos.
 */
const CONFIDENCE: Record<string, { label: string; tone: "success" | "info" | "warning" }> = {
  high: { label: "Alta", tone: "success" },
  medium: { label: "Média", tone: "info" },
  low: { label: "Baixa", tone: "warning" },
};

type PKey = "plate" | "model" | "odometer" | "dailyAvg" | "d30" | "d60" | "d90";

const P_ACCESSORS: Record<PKey, (v: KmAnalysisVehicle) => number | string | null> = {
  plate: (v) => v.plate,
  model: (v) => v.model,
  odometer: (v) => v.odometer,
  dailyAvg: (v) => v.dailyAvg,
  d30: (v) => v.projection?.d30 ?? null,
  d60: (v) => v.projection?.d60 ?? null,
  d90: (v) => v.projection?.d90 ?? null,
};

function SearchInput({ value, onChange, testId, label }: { value: string; onChange: (v: string) => void; testId: string; label: string }) {
  return (
    <SearchField
      size="sm"
      wrapperClassName="w-44"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onClear={() => onChange("")}
      aria-label={label}
      placeholder="Placa ou frota"
      data-testid={testId}
    />
  );
}

const matches = (v: KmAnalysisVehicle, q: string) =>
  !q || v.plate.toUpperCase().includes(q) || (v.fleetCode ?? "").toUpperCase().includes(q);

export function ProjectionsView({ data }: { data: KmAnalysisData }) {
  const vehicles = React.useMemo(() => data.vehicles ?? [], [data.vehicles]);
  return (
    <div className="flex flex-col gap-6" data-testid="km-analise-projecoes">
      <PreventiveTable vehicles={vehicles} />
      <ProjectionTable vehicles={vehicles} />
    </div>
  );
}

// ---------------------------------------------------------------------------
function ProjectionTable({ vehicles }: { vehicles: KmAnalysisVehicle[] }) {
  const [query, setQuery] = React.useState("");
  const listed = React.useMemo(() => {
    const q = query.trim().toUpperCase();
    return vehicles.filter((v) => matches(v, q));
  }, [vehicles, query]);
  const { sorted, sort, setSort } = useSorted(listed, P_ACCESSORS, { key: "d90", dir: "desc" });
  const pager = usePage(sorted, 50, query);
  const withoutBase = vehicles.filter((v) => v.projection == null).length;

  return (
    <section aria-labelledby="km-proj-hodometro" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="km-proj-hodometro" className="text-h4 font-semibold text-fg">Projeção do hodômetro</h3>
          <p className="text-caption text-fg-muted">
            Hodômetro atual + KM/dia do período × 30, 60 e 90 dias. Confiança pela cobertura: alta ≥ 70%, média ≥ 40%.
            {withoutBase > 0 ? ` ${fmtInt(withoutBase)} frota(s) sem base para projetar.` : ""}
          </p>
        </div>
        <SearchInput value={query} onChange={setQuery} testId="km-analise-projecoes-busca" label="Buscar placa ou frota na projeção" />
      </div>
      <TableContainer>
        <Table className="min-w-[1000px]" data-testid="km-analise-projecoes-tabela">
          <TableCaption>Projeção por ritmo do período; não considera rodízio nem mudança de operação.</TableCaption>
          <TableHeader>
            <TableRow>
              <SortHead sortKey="plate" sort={sort} onSort={setSort} className="w-28">Placa</SortHead>
              <SortHead sortKey="model" sort={sort} onSort={setSort} className="w-40">Modelo</SortHead>
              <TableHead className="w-56">Coorte</TableHead>
              <SortHead sortKey="odometer" sort={sort} onSort={setSort} numeric>Hodômetro atual</SortHead>
              <SortHead sortKey="dailyAvg" sort={sort} onSort={setSort} numeric>KM/dia</SortHead>
              <SortHead sortKey="d30" sort={sort} onSort={setSort} numeric>Em 30 dias</SortHead>
              <SortHead sortKey="d60" sort={sort} onSort={setSort} numeric>Em 60 dias</SortHead>
              <SortHead sortKey="d90" sort={sort} onSort={setSort} numeric>Em 90 dias</SortHead>
              <TableHead className="w-28">Confiança</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pager.slice.length === 0 ? (
              <TableEmpty colSpan={9} message="Nenhuma frota para a busca." />
            ) : (
              pager.slice.map((v) => {
                const conf = v.projection?.confidence ? CONFIDENCE[v.projection.confidence] : null;
                return (
                  <TableRow key={v.vehicleId}>
                    <TableCell className="font-medium">{v.plate}</TableCell>
                    <TableCell truncate title={v.model ?? undefined} className="max-w-40">{v.model ?? "—"}</TableCell>
                    <TableCell truncate title={v.cohortLabel ?? undefined} className="max-w-56 text-fg-secondary">
                      {v.cohortLabel ?? "—"}
                    </TableCell>
                    <TableCell numeric>{fmtKm(v.odometer)}</TableCell>
                    <TableCell numeric>{fmt1(v.dailyAvg)}</TableCell>
                    <TableCell numeric>{fmtKm(v.projection?.d30)}</TableCell>
                    <TableCell numeric>{fmtKm(v.projection?.d60)}</TableCell>
                    <TableCell numeric className="font-medium">{fmtKm(v.projection?.d90)}</TableCell>
                    <TableCell>
                      {conf ? (
                        <ToneBadge tone={conf.tone}>{conf.label}</ToneBadge>
                      ) : (
                        <span className="text-caption text-fg-muted">Sem base</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <Pagination
        page={pager.page}
        pageSize={pager.pageSize}
        total={sorted.length}
        onPageChange={pager.setPage}
        onPageSizeChange={pager.setPageSize}
        label="Paginação da projeção do hodômetro"
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
type DueState = "overdue" | "soon" | "planned" | "no_pace";

const DUE: Record<DueState, { label: string; tone: "danger" | "warning" | "info" | "neutral" }> = {
  overdue: { label: "Vencido", tone: "danger" },
  soon: { label: "Até 30 dias", tone: "warning" },
  planned: { label: "Previsto", tone: "info" },
  no_pace: { label: "Sem ritmo para estimar", tone: "neutral" },
};

/** Situação para exibição: o sinal dos KM restantes e os dias estimados vêm da rotina. */
function dueState(v: KmAnalysisVehicle): DueState {
  const p = v.preventive;
  if (p?.kmRemaining != null && p.kmRemaining < 0) return "overdue";
  if (p?.daysEstimate != null && p.daysEstimate <= 30) return "soon";
  if (p?.daysEstimate != null) return "planned";
  return "no_pace";
}

const DUE_ORDER: Record<DueState, number> = { overdue: 0, soon: 1, planned: 2, no_pace: 3 };

function PreventiveTable({ vehicles }: { vehicles: KmAnalysisVehicle[] }) {
  const [query, setQuery] = React.useState("");
  const rows = React.useMemo(() => {
    const q = query.trim().toUpperCase();
    return vehicles
      .filter((v) => v.preventive != null && v.preventive.milestoneKm != null && matches(v, q))
      .map((v) => ({ v, state: dueState(v) }))
      .sort(
        (a, b) =>
          DUE_ORDER[a.state] - DUE_ORDER[b.state] ||
          (a.state === "overdue"
            ? (a.v.preventive?.kmRemaining ?? 0) - (b.v.preventive?.kmRemaining ?? 0)
            : (a.v.preventive?.daysEstimate ?? Number.MAX_SAFE_INTEGER) - (b.v.preventive?.daysEstimate ?? Number.MAX_SAFE_INTEGER)) ||
          (a.v.preventive?.kmRemaining ?? Number.MAX_SAFE_INTEGER) - (b.v.preventive?.kmRemaining ?? Number.MAX_SAFE_INTEGER) ||
          a.v.plate.localeCompare(b.v.plate),
      );
  }, [vehicles, query]);
  const pager = usePage(rows, 25, query);
  const overdue = rows.filter((r) => r.state === "overdue").length;
  const soon = rows.filter((r) => r.state === "soon").length;

  return (
    <section aria-labelledby="km-proj-preventiva" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="km-proj-preventiva" className="text-h4 font-semibold text-fg">Previsão da preventiva</h3>
          <p className="text-caption text-fg-muted">
            Próximo ciclo em aberto da Manutenção. Dias estimados = KM restantes ÷ KM/dia do período.{" "}
            <span className="font-medium text-danger-soft-fg">{fmtInt(overdue)} vencido(s)</span> ·{" "}
            <span className="font-medium text-warning-soft-fg">{fmtInt(soon)} em até 30 dias</span>
          </p>
        </div>
        <SearchInput value={query} onChange={setQuery} testId="km-analise-preventiva-busca" label="Buscar placa ou frota na previsão da preventiva" />
      </div>
      <TableContainer>
        <Table className="min-w-[900px]" data-testid="km-analise-preventiva-tabela">
          <TableCaption>Ordenado pelos mais próximos: vencidos primeiro, depois pelos dias estimados.</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Placa</TableHead>
              <TableHead className="w-40">Modelo</TableHead>
              <TableHead numeric>Ciclo</TableHead>
              <TableHead numeric>Marco</TableHead>
              <TableHead numeric>Hodômetro atual</TableHead>
              <TableHead numeric>KM restantes</TableHead>
              <TableHead numeric>Dias estimados</TableHead>
              <TableHead className="w-44">Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pager.slice.length === 0 ? (
              <TableEmpty colSpan={8} message="Nenhuma frota com ciclo preventivo em aberto para os filtros." />
            ) : (
              pager.slice.map(({ v, state }) => {
                const p = v.preventive;
                return (
                  <TableRow
                    key={v.vehicleId}
                    data-testid="km-analise-preventiva-linha"
                    data-state-due={state}
                    className={cn(state === "overdue" && "bg-danger-soft/40 hover:bg-danger-soft/60")}
                  >
                    <TableCell className="font-medium">{v.plate}</TableCell>
                    <TableCell truncate title={v.model ?? undefined} className="max-w-40">{v.model ?? "—"}</TableCell>
                    <TableCell numeric>{p?.cycleNumber != null ? `MP${fmtInt(p.cycleNumber)}` : "—"}</TableCell>
                    <TableCell numeric>{fmtKm(p?.milestoneKm)}</TableCell>
                    <TableCell numeric>{fmtKm(v.odometer)}</TableCell>
                    <TableCell
                      numeric
                      className={cn(state === "overdue" && "font-semibold text-danger-soft-fg")}
                    >
                      {p?.kmRemaining == null ? "—" : `${signedNum(p.kmRemaining, 0)} km`}
                    </TableCell>
                    <TableCell numeric>{p?.daysEstimate == null ? "—" : `${fmtInt(p.daysEstimate)} d`}</TableCell>
                    <TableCell>
                      <ToneBadge tone={DUE[state].tone}>{DUE[state].label}</ToneBadge>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <Pagination
        page={pager.page}
        pageSize={pager.pageSize}
        total={rows.length}
        onPageChange={pager.setPage}
        onPageSizeChange={pager.setPageSize}
        pageSizeOptions={[25, 50, 100]}
        label="Paginação da previsão da preventiva"
      />
    </section>
  );
}
