"use client";

import { Play, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableActionCell, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { KmImportBatch } from "@/lib/km/batches";
import { formatStamp } from "@/lib/maintenance/types";
import { fmtCount, isCancellableBatch, kmBatchStatus } from "./shared";

/**
 * Lotes que ainda não terminaram: rascunho (prévia por montar), validado
 * (aguardando confirmação) e gravando (consolidação interrompida). Podem ser
 * retomados ou, os dois primeiros, cancelados.
 */
export function KmOpenBatches({
  batches,
  busy,
  canAct,
  onResume,
  onCancel,
  testId,
}: {
  batches: KmImportBatch[];
  busy: boolean;
  canAct: boolean;
  onResume: (batch: KmImportBatch) => void;
  onCancel: (batch: KmImportBatch) => void;
  testId: string;
}) {
  return (
    <TableContainer tabIndex={0} aria-label="Lotes em aberto">
      <Table layout="fixed" style={{ minWidth: 760 }} data-testid={testId}>
        <TableHeader>
          <TableRow>
            <TableHead style={{ width: 240 }}>Arquivo</TableHead>
            <TableHead style={{ width: 130 }}>Situação</TableHead>
            <TableHead style={{ width: 150 }}>Criado em</TableHead>
            <TableHead style={{ width: 90 }} numeric>
              Linhas
            </TableHead>
            <TableHead style={{ width: 90 }} numeric>
              Erros
            </TableHead>
            <TableHead style={{ width: 230 }}>
              <span className="sr-only">Ações</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {batches.map((b) => {
            const st = kmBatchStatus(b.status);
            return (
              <TableRow key={b.id}>
                <TableCell truncate title={b.fileName ?? undefined} className="font-medium">
                  {b.fileName ?? "—"}
                </TableCell>
                <TableCell>
                  <StatusBadge status={st.tone} size="sm" title={st.hint}>
                    {st.label}
                  </StatusBadge>
                </TableCell>
                <TableCell className="tabular-nums">{formatStamp(b.createdAt)}</TableCell>
                <TableCell numeric>{fmtCount(b.totalRows)}</TableCell>
                <TableCell numeric className={(b.errorRows ?? 0) > 0 ? "font-semibold text-danger" : undefined}>
                  {fmtCount(b.errorRows)}
                </TableCell>
                <TableActionCell>
                  {canAct ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        leadingIcon={b.status === "processing" ? <Play /> : <RotateCcw />}
                        disabled={busy}
                        onClick={() => onResume(b)}
                        aria-label={`${b.status === "processing" ? "Continuar gravação" : "Retomar"} do lote ${b.fileName ?? ""}`}
                        data-testid={`${testId}-retomar`}
                      >
                        {b.status === "processing" ? "Continuar gravação" : "Retomar"}
                      </Button>
                      {isCancellableBatch(b.status) ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          leadingIcon={<Trash2 />}
                          disabled={busy}
                          onClick={() => onCancel(b)}
                          aria-label={`Cancelar o lote ${b.fileName ?? ""}`}
                          data-testid={`${testId}-cancelar`}
                        >
                          Cancelar
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                </TableActionCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
