"use client";

import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import type { KmImportBatch } from "@/lib/km/batches";
import { fmtKm1, formatDate } from "@/lib/km/types";
import { formatStamp } from "@/lib/maintenance/types";
import { fmtCount, kmBatchStatus, kmSourceLabel, shortHash } from "../import/shared";

/**
 * Lotes de importação de KM (mais recentes primeiro). Clicar numa linha — ou
 * no nome do arquivo, pelo teclado — abre o detalhe do lote.
 */
export function KmBatchTable({
  rows,
  selectedId,
  onOpen,
  testId,
}: {
  rows: KmImportBatch[];
  selectedId: string | null;
  onOpen: (id: string) => void;
  testId: string;
}) {
  return (
    <TableContainer tabIndex={0} stickyHeader maxHeight="70vh" aria-label="Lotes de importação de KM">
      <Table layout="fixed" style={{ minWidth: 1880 }} data-testid={testId}>
        <TableHeader>
          <TableRow>
            <TableHead style={{ width: 230 }}>Arquivo</TableHead>
            <TableHead style={{ width: 150 }}>Aba</TableHead>
            <TableHead style={{ width: 120 }}>Situação</TableHead>
            <TableHead style={{ width: 190 }}>Período</TableHead>
            <TableHead style={{ width: 80 }} numeric>
              Linhas
            </TableHead>
            <TableHead style={{ width: 80 }} numeric>
              Criados
            </TableHead>
            <TableHead style={{ width: 96 }} numeric>
              Atualizados
            </TableHead>
            <TableHead style={{ width: 84 }} numeric>
              Ignorados
            </TableHead>
            <TableHead style={{ width: 76 }} numeric>
              Avisos
            </TableHead>
            <TableHead style={{ width: 68 }} numeric>
              Erros
            </TableHead>
            <TableHead style={{ width: 130 }} numeric>
              KM total
            </TableHead>
            <TableHead style={{ width: 130 }}>Hash</TableHead>
            <TableHead style={{ width: 190 }}>Criado por</TableHead>
            <TableHead style={{ width: 130 }}>Criado em</TableHead>
            <TableHead style={{ width: 130 }}>Processado em</TableHead>
            <TableHead style={{ width: 140 }}>Fonte</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((b) => {
            const st = kmBatchStatus(b.status);
            const selected = b.id === selectedId;
            return (
              <TableRow
                key={b.id}
                selected={selected}
                onClick={() => onOpen(b.id)}
                className="cursor-pointer"
                data-testid={`${testId}-linha`}
              >
                <TableCell truncate title={b.fileName ?? undefined}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(b.id);
                    }}
                    aria-current={selected ? "true" : undefined}
                    className="max-w-full truncate rounded-xs text-left font-medium text-link underline-offset-4 hover:underline hfm-focus-ring"
                  >
                    {b.fileName ?? "Lote sem nome"}
                  </button>
                </TableCell>
                <TableCell truncate title={b.sheetName ?? undefined}>
                  {b.sheetName ?? "—"}
                </TableCell>
                <TableCell>
                  <StatusBadge status={st.tone} size="sm" title={st.hint}>
                    {st.label}
                  </StatusBadge>
                </TableCell>
                <TableCell className="tabular-nums">
                  {b.periodFrom || b.periodTo ? `${formatDate(b.periodFrom)} a ${formatDate(b.periodTo)}` : "—"}
                </TableCell>
                <TableCell numeric>{fmtCount(b.totalRows)}</TableCell>
                <TableCell numeric>{fmtCount(b.createdRows)}</TableCell>
                <TableCell numeric>{fmtCount(b.updatedRows)}</TableCell>
                <TableCell numeric>{fmtCount(b.skippedRows)}</TableCell>
                <TableCell numeric className={cn((b.warningRows ?? 0) > 0 && "text-warning-soft-fg")}>
                  {fmtCount(b.warningRows)}
                </TableCell>
                <TableCell numeric className={cn((b.errorRows ?? 0) > 0 && "font-semibold text-danger")}>
                  {fmtCount(b.errorRows)}
                </TableCell>
                <TableCell numeric>{fmtKm1(b.kmTotal)}</TableCell>
                <TableCell className="font-mono text-caption" title={b.fileHash ?? undefined}>
                  {shortHash(b.fileHash)}
                </TableCell>
                <TableCell truncate title={b.createdBy ?? undefined}>
                  {b.createdBy ?? "—"}
                </TableCell>
                <TableCell className="tabular-nums">{formatStamp(b.createdAt)}</TableCell>
                <TableCell className="tabular-nums">{formatStamp(b.processedAt)}</TableCell>
                <TableCell truncate>{kmSourceLabel(b.sourceType)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
