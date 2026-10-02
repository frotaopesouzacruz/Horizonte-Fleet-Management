"use client";

import * as React from "react";
import { PencilLine } from "lucide-react";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { NativeSelect } from "@/components/governance/selects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { SearchField } from "@/components/ui/search-field";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table, TableActionCell, TableBody, TableCaption, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { KmQualityIssue } from "@/lib/km/quality";
import {
  fmt2, fmtInt, fmtKm1, formatDate, KM_ALERT_LABEL, kmStatusLabel, kmStatusTone, weekdayShort, type KmAlert,
} from "@/lib/km/types";
import type { KmCorrectionTarget } from "../../components/correction-dialog";
import { usePage } from "../analysis/shared";

/**
 * Ocorrências da qualidade (`issues`): a lista inteira que a rotina devolve,
 * filtrada por tipo/alerta e por placa e paginada no cliente. Cada linha traz
 * o KM informado pela fonte ao lado do calculado e do validado, e os
 * hodômetros vigentes; "Corrigir" abre a correção auditada.
 */
export type IssueFilter =
  | "all"
  | "status:inconsistent"
  | "status:km_divergence"
  | "status:pending_review"
  | "status:high_mileage"
  | "alert:odometer_regression"
  | "alert:odometer_jump"
  | "alert:registry_divergence"
  | "corrected";

const FILTERS: { value: IssueFilter; label: string }[] = [
  { value: "all", label: "Todas as ocorrências" },
  { value: "status:inconsistent", label: "Inconsistente" },
  { value: "status:pending_review", label: "Pendente de análise" },
  { value: "status:km_divergence", label: "Divergência de KM" },
  { value: "status:high_mileage", label: "Alta rodagem" },
  { value: "alert:odometer_regression", label: "Hodômetro regressivo" },
  { value: "alert:odometer_jump", label: "Salto de hodômetro" },
  { value: "alert:registry_divergence", label: "Divergência cadastral" },
  { value: "corrected", label: "Corrigidas" },
];

export function matchesFilter(issue: KmQualityIssue, filter: IssueFilter): boolean {
  if (filter === "all") return true;
  if (filter === "corrected") return Boolean(issue.corrected);
  const [kind, code] = filter.split(":");
  const alerts = issue.alerts ?? [];
  if (kind === "status") return issue.status === code || (code === "high_mileage" && alerts.includes("high_mileage"));
  return alerts.includes(code);
}

/** Teto de ocorrências devolvidas pela rotina (as mais recentes). */
const ISSUE_LIMIT = 1000;

const dayOfWeek = (iso: string) => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  // Dia da semana pelo calendário (UTC), sem fuso.
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return weekdayShort(d.getUTCDay());
};

export function IssuesTable({
  issues, filter, onFilterChange, canCorrect, onCorrect,
}: {
  issues: KmQualityIssue[];
  filter: IssueFilter;
  onFilterChange: (next: IssueFilter) => void;
  canCorrect: boolean;
  onCorrect: (target: KmCorrectionTarget) => void;
}) {
  const [query, setQuery] = React.useState("");
  const counts = React.useMemo(() => {
    const out = {} as Record<IssueFilter, number>;
    for (const f of FILTERS) out[f.value] = issues.filter((i) => matchesFilter(i, f.value)).length;
    return out;
  }, [issues]);
  const listed = React.useMemo(() => {
    const q = query.trim().toUpperCase().replace(/[\s-]/g, "");
    return issues.filter(
      (i) =>
        matchesFilter(i, filter) &&
        (!q ||
          i.plate.toUpperCase().replace(/[\s-]/g, "").includes(q) ||
          (i.fleetCode ?? "").toUpperCase().includes(q)),
    );
  }, [issues, filter, query]);
  const pager = usePage(listed, 50, `${filter}|${query}`);
  const colSpan = canCorrect ? 11 : 10;

  return (
    <section aria-labelledby="km-qualidade-ocorrencias" className="flex flex-col gap-3" data-testid="km-qualidade-ocorrencias">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="km-qualidade-ocorrencias" className="text-h4 font-semibold text-fg">
            Ocorrências <span className="font-normal text-fg-muted">({fmtInt(listed.length)})</span>
          </h3>
          <p className="text-caption text-fg-muted">
            Leituras com situação ou alerta para análise. KM informado = fonte; calculado = final − inicial informados;
            validado = o que entra nos totais.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
          <label className="flex min-w-0 flex-1 flex-col gap-1 sm:w-60 sm:flex-none">
            <span className="text-caption text-fg-muted">Tipo / alerta</span>
            <NativeSelect
              fieldSize="sm"
              value={filter}
              onChange={(e) => onFilterChange(e.target.value as IssueFilter)}
              data-testid="km-qualidade-filtro-tipo"
            >
              {FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label} ({fmtInt(counts[f.value])})
                </option>
              ))}
            </NativeSelect>
          </label>
          <div className="flex min-w-0 flex-1 flex-col gap-1 sm:w-56 sm:flex-none">
            <span className="text-caption text-fg-muted" id="km-qualidade-busca-rotulo">Placa ou frota</span>
            <SearchField
              size="sm"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onClear={() => setQuery("")}
              aria-labelledby="km-qualidade-busca-rotulo"
              placeholder="Ex.: SNT0F13"
              data-testid="km-qualidade-busca"
            />
          </div>
        </div>
      </div>

      {issues.length >= ISSUE_LIMIT ? (
        <Alert variant="info">
          <AlertDescription>
            A rotina devolve as {fmtInt(ISSUE_LIMIT)} ocorrências mais recentes do período. Reduza o período ou aplique filtros
            para ver as anteriores.
          </AlertDescription>
        </Alert>
      ) : null}

      <TableContainer>
        <Table className="min-w-[1240px]" data-testid="km-qualidade-ocorrencias-tabela">
          <TableCaption>
            Valores informados pela fonte ao lado dos vigentes. Leituras inconsistentes não entram nos totais.
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Data</TableHead>
              <TableHead className="w-32">Placa</TableHead>
              <TableHead className="w-36">Modelo</TableHead>
              <TableHead className="w-48">Situação</TableHead>
              <TableHead className="w-44">Alertas</TableHead>
              <TableHead numeric>Hod. inicial</TableHead>
              <TableHead numeric>Hod. final</TableHead>
              <TableHead numeric>KM informado</TableHead>
              <TableHead numeric>KM calculado</TableHead>
              <TableHead numeric>KM validado</TableHead>
              {canCorrect ? <TableHead className="w-28"><span className="sr-only">Ações</span></TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pager.slice.length === 0 ? (
              <TableEmpty
                colSpan={colSpan}
                message={issues.length === 0 ? "Nenhuma ocorrência no período e filtros escolhidos." : "Nenhuma ocorrência para o filtro e a busca."}
              />
            ) : (
              pager.slice.map((i) => (
                <TableRow key={i.readingId} data-testid="km-qualidade-ocorrencia">
                  <TableCell className="tabular-nums">
                    <span className="flex flex-col leading-tight">
                      <span>{formatDate(i.day)}</span>
                      <span className="text-caption text-fg-muted">{dayOfWeek(i.day)}</span>
                    </span>
                  </TableCell>
                  <TableCell className="font-medium">
                    <span className="flex flex-col leading-tight">
                      <span>{i.plate}</span>
                      {i.fleetCode && i.fleetCode !== i.plate ? <span className="text-caption text-fg-muted">{i.fleetCode}</span> : null}
                    </span>
                  </TableCell>
                  <TableCell truncate title={i.model ?? undefined} className="max-w-36">{i.model ?? "—"}</TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-1">
                      <StatusBadge status={kmStatusTone(i.status)} size="sm">{kmStatusLabel(i.status)}</StatusBadge>
                      {i.corrected ? <Badge size="sm" variant="info" appearance="outline">Corrigida</Badge> : null}
                    </span>
                  </TableCell>
                  <TableCell>
                    {(i.alerts ?? []).length ? (
                      <span className="flex flex-wrap gap-1">
                        {(i.alerts ?? []).map((a) => (
                          <Badge key={a} size="sm" variant="neutral" appearance="outline">
                            {KM_ALERT_LABEL[a as KmAlert] ?? kmStatusLabel(a)}
                          </Badge>
                        ))}
                      </span>
                    ) : (
                      <span className="text-fg-muted">—</span>
                    )}
                  </TableCell>
                  <TableCell numeric>{fmt2(i.odometerStart)}</TableCell>
                  <TableCell numeric>{fmt2(i.odometerEnd)}</TableCell>
                  <TableCell numeric>{fmtKm1(i.kmInformed)}</TableCell>
                  <TableCell numeric>{fmtKm1(i.kmCalculated)}</TableCell>
                  <TableCell numeric className="font-medium">
                    {i.km == null ? <span className="text-caption font-normal text-fg-muted">Fora dos totais</span> : fmtKm1(i.km)}
                  </TableCell>
                  {canCorrect ? (
                    <TableActionCell>
                      <Button
                        size="sm"
                        variant="outline"
                        leadingIcon={<PencilLine aria-hidden />}
                        aria-label={`Corrigir leitura de ${i.plate} em ${formatDate(i.day)}`}
                        onClick={() =>
                          onCorrect({
                            readingId: i.readingId,
                            plate: i.plate,
                            day: i.day,
                            odometerStart: i.odometerStart,
                            odometerEnd: i.odometerEnd,
                            kmInformed: i.kmInformed,
                            status: i.status,
                            alerts: i.alerts,
                          })
                        }
                        data-testid="km-qualidade-corrigir"
                      >
                        Corrigir
                      </Button>
                    </TableActionCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <Pagination
        page={pager.page}
        pageSize={pager.pageSize}
        total={listed.length}
        onPageChange={pager.setPage}
        onPageSizeChange={pager.setPageSize}
        pageSizeOptions={[25, 50, 100, 200]}
        label="Paginação das ocorrências"
      />
    </section>
  );
}
