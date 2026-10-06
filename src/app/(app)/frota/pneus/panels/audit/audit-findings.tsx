"use client";

import { CheckCircle2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtInt, formatDate, formatStamp, modernTerms, plural, type TireAuditFinding, type TiresAuditCenter } from "@/lib/tires/types";
import type { TiresPanelContext } from "../../shared";
import { ExportButton, FireLink, PanelEmpty, PlateLink, Section, TiresPagination, useTiresLink } from "../tires-ui";
import { AUDIT_STATUS_LABEL, categoryLabel, SeverityBadge, severityLabel, TID, type AuditStatusFilter } from "./audit-common";

const STATUS_OPTIONS: AuditStatusFilter[] = ["aberta", "resolvida", "todas"];

/**
 * Lista paginada dos achados (no banco, 50 por página): gravidade, regra,
 * onde (Nº Fogo, frota/placa, posição), recorte, campo com o valor encontrado
 * × o esperado, detalhe, detecções e situação. A situação (`?achado=`) e os
 * filtros de categoria, regra e gravidade vivem na URL; a exportação leva o
 * mesmo recorte, todas as páginas.
 */
export function AuditFindings({ data, ctx }: { data: TiresAuditCenter; ctx: TiresPanelContext }) {
  const link = useTiresLink(ctx);
  const f = data.filters;
  const ruleTitle = f.rule ? (data.rules.find((r) => r.code === f.rule)?.title ?? f.rule) : null;
  const chips = [
    f.category ? { key: "categoria", label: "Categoria", value: categoryLabel(f.category) } : null,
    f.rule ? { key: "regra", label: "Regra", value: ruleTitle ?? f.rule } : null,
    f.severity ? { key: "gravidade", label: "Gravidade", value: severityLabel(f.severity) } : null,
  ].filter((c): c is { key: string; label: string; value: string } => c !== null);
  const clearAll = link({ categoria: null, regra: null, gravidade: null });
  const statusWord = f.status === "aberta" ? plural(data.total, "aberto", "abertos") : f.status === "resolvida" ? plural(data.total, "resolvido", "resolvidos") : "";

  return (
    <Section
      title="Achados"
      testId={`${TID}-findings`}
      description={
        <>
          {fmtInt(data.total)} {plural(data.total, "achado", "achados")}
          {statusWord ? ` ${statusWord}` : " (abertos e resolvidos)"} com os filtros aplicados, do mais grave para o mais leve. Datas de detecção são as
          datas dos dados em que a regra apontou o problema.
        </>
      }
      actions={
        <>
          <SegmentedControl
            aria-label="Situação dos achados"
            value={f.status}
            disabled={ctx.pending}
            onValueChange={(v) => ctx.navigate({ achado: v === "aberta" ? null : v, pagina: null })}
            options={STATUS_OPTIONS.map((s) => ({ value: s, label: AUDIT_STATUS_LABEL[s], "data-testid": `${TID}-status-${s}` }))}
            data-testid={`${TID}-status`}
          />
          <ExportButton
            ctx={ctx}
            kind="qualidade"
            extra={{ categoria: f.category, regra: f.rule, gravidade: f.severity, achado: f.status === "aberta" ? null : f.status }}
            testId={`${TID}-export`}
          />
        </>
      }
    >
      {chips.length ? (
        <div className="flex flex-wrap items-center gap-2" data-testid={`${TID}-active-filters`}>
          <span className="text-caption text-fg-muted">Filtrando a lista por:</span>
          {chips.map((c) => {
            const nav = link({ [c.key]: null });
            return (
              <a
                key={c.key}
                href={nav.href}
                onClick={nav.onClick}
                className="inline-flex items-center gap-1 rounded-sm border border-border-emphasis/70 bg-primary-soft px-2 py-0.5 text-caption font-medium text-primary-soft-fg hover:border-primary hfm-focus-ring"
                data-testid={`${TID}-filter-chip`}
              >
                <span className="text-fg-muted">{c.label}:</span> {c.value}
                <X className="size-3" aria-hidden />
                <span className="sr-only"> — remover este filtro</span>
              </a>
            );
          })}
          {chips.length > 1 ? (
            <a href={clearAll.href} onClick={clearAll.onClick} className="rounded-xs text-caption font-medium text-link underline-offset-2 hover:underline hfm-focus-ring">
              Limpar filtros da auditoria
            </a>
          ) : null}
        </div>
      ) : null}

      {data.rows.length === 0 ? (
        <PanelEmpty
          icon={<CheckCircle2 />}
          title={f.status === "resolvida" ? "Nenhum achado resolvido neste recorte" : "Nenhum achado neste recorte"}
          description={
            chips.length
              ? "Nenhum achado com os filtros escolhidos. Remova um filtro ou troque a situação para ampliar a lista."
              : f.status === "aberta"
                ? "A última varredura não deixou inconsistências abertas para os filtros globais aplicados."
                : "Nada a listar para os filtros globais aplicados."
          }
          testId={`${TID}-empty`}
        />
      ) : (
        <TableContainer data-testid={`${TID}-rows`}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Gravidade</TableHead>
                <TableHead className="min-w-[15rem]">Regra · detalhe</TableHead>
                <TableHead>Onde</TableHead>
                <TableHead>Operação · local · liderança</TableHead>
                <TableHead className="min-w-[13rem]">Campo: encontrado × esperado</TableHead>
                <TableHead>Detecção</TableHead>
                <TableHead numeric>Ocorrências</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r) => (
                <FindingRow key={r.id} row={r} />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <TiresPagination ctx={ctx} total={data.total} limit={data.limit} label="Paginação dos achados" testId={`${TID}-pagination`} />
    </Section>
  );
}

/** "dados de 05/10/2026" — a data dos dados em que a regra apontou; sem ela, o carimbo da varredura. */
function detectedOn(referenceDate: string | null, stamp: string): string {
  return referenceDate ? `dados de ${formatDate(referenceDate)}` : formatStamp(stamp);
}

function FindingRow({ row: r }: { row: TireAuditFinding }) {
  const hasVehicle = Boolean(r.licensePlate || r.fleetNumber);
  const detail = modernTerms(r.detail);
  const sameDetection = (r.firstReferenceDate ?? r.firstSeenAt) === (r.lastReferenceDate ?? r.lastSeenAt);
  return (
    <TableRow className="align-top" data-testid={`${TID}-row`} data-severity={r.severity} data-status={r.status} data-rule={r.ruleCode}>
      <TableCell className="py-2 align-top whitespace-nowrap">
        <SeverityBadge severity={r.severity} />
      </TableCell>
      <TableCell className="py-2 align-top">
        <span className="block font-medium text-fg">{r.ruleTitle}</span>
        <span className="block text-caption text-fg-muted">{categoryLabel(r.category)}</span>
        {detail ? (
          <span className="mt-0.5 block max-w-[28rem] text-caption leading-snug text-fg-secondary">{detail}</span>
        ) : null}
      </TableCell>
      <TableCell className="py-2 align-top whitespace-nowrap">
        {r.fireNumber || r.tireId ? (
          <span className="block">
            <span className="text-caption text-fg-muted">Nº Fogo </span>
            <FireLink tireId={r.tireId} fireNumber={r.fireNumber} />
          </span>
        ) : null}
        {hasVehicle ? (
          <span className="block">
            <PlateLink vehicleId={r.vehicleId} plate={r.licensePlate} fleetCode={r.fleetNumber} />
          </span>
        ) : null}
        {r.positionCode ? <span className="block text-caption text-fg-muted tabular-nums">posição {r.positionCode}</span> : null}
        {!r.fireNumber && !r.tireId && !hasVehicle && !r.positionCode ? <span className="text-fg-muted">—</span> : null}
      </TableCell>
      <TableCell className="py-2 align-top text-caption">
        <span className="block text-fg">{r.operationName ?? "—"}</span>
        <span className="block text-fg-muted">{r.cityLabel ?? "—"}</span>
        <span className="block text-fg-muted">{r.leaderName ?? "—"}</span>
      </TableCell>
      <TableCell className="py-2 align-top text-caption">
        <span className="block font-semibold text-fg-secondary">{r.field ?? "—"}</span>
        <span className="block">
          <span className="text-fg-muted">encontrado: </span>
          <span className="font-medium text-fg">{r.foundValue ?? "—"}</span>
        </span>
        <span className="block">
          <span className="text-fg-muted">esperado: </span>
          <span className="text-fg">{r.expectedValue ?? "—"}</span>
        </span>
      </TableCell>
      <TableCell className="py-2 align-top whitespace-nowrap text-caption tabular-nums">
        <span className="block text-fg" title={`Primeira detecção: ${formatStamp(r.firstSeenAt)}`}>
          <span className="text-fg-muted">{sameDetection ? "detectado: " : "1ª: "}</span>
          {detectedOn(r.firstReferenceDate, r.firstSeenAt)}
        </span>
        {!sameDetection ? (
          <span className="block text-fg" title={`Última detecção: ${formatStamp(r.lastSeenAt)}`}>
            <span className="text-fg-muted">última: </span>
            {detectedOn(r.lastReferenceDate, r.lastSeenAt)}
          </span>
        ) : null}
      </TableCell>
      <TableCell numeric className="py-2 align-top">
        <span className="font-medium text-fg">{fmtInt(r.occurrences)}</span>
        {r.reopenedCount > 0 ? (
          <Badge variant="warning" appearance="outline" size="sm" className="mt-1 ml-auto flex w-fit">
            {fmtInt(r.reopenedCount)} {plural(r.reopenedCount, "reabertura", "reaberturas")}
          </Badge>
        ) : (
          <span className="block text-caption text-fg-muted">sem reabertura</span>
        )}
      </TableCell>
      <TableCell className="py-2 align-top whitespace-nowrap">
        <StatusBadge status={r.status === "resolvida" ? "success" : "warning"} size="sm">
          {r.status === "resolvida" ? "Resolvida" : "Aberta"}
        </StatusBadge>
        {r.status === "resolvida" ? (
          <span className={cn("mt-0.5 block text-caption text-fg-muted tabular-nums")}>em {formatStamp(r.resolvedAt)}</span>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
