"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/feedback/empty-state";
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { ImportHistoryRow } from "@/lib/adherence/queries";
import { formatDateTimeBr, formatInt } from "./status";

export interface ImportHistoryProps {
  imports: ImportHistoryRow[];
}

function statusOf(status: string): { label: string; tone: "success" | "danger" | "neutral" | "pending" } {
  switch (status) {
    case "completed": return { label: "Concluída", tone: "success" };
    case "failed": return { label: "Falhou", tone: "danger" };
    case "processing": return { label: "Em processamento", tone: "pending" };
    default: return { label: status || "—", tone: "neutral" };
  }
}

/**
 * Histórico de importações (§67): cada lote registra o arquivo, quem enviou,
 * quantas linhas entraram, quantas foram criadas ou ignoradas e os erros
 * linha a linha. Uma importação nunca apaga: o que ela não criou, ignorou —
 * e o motivo fica aqui para conferência.
 */
export function ImportHistory({ imports }: ImportHistoryProps) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <div>
          <h3 className="text-h4 font-semibold text-fg">Histórico de importações</h3>
          <p className="text-caption text-fg-muted">
            Lotes enviados pela planilha, com o resultado linha a linha. Linhas com erro não entram; as ignoradas já existiam ou não mudaram nada (§67).
          </p>
        </div>
        {imports.length === 0 ? (
          <EmptyState
            size="sm"
            variant="panel"
            title="Nenhuma importação registrada"
            description="Os lotes enviados pela planilha aparecem aqui com o resultado de cada linha."
          />
        ) : (
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Arquivo</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead className="text-right">Linhas</TableHead>
                  <TableHead className="text-right">Válidas</TableHead>
                  <TableHead className="text-right">Avisos</TableHead>
                  <TableHead className="text-right">Erros</TableHead>
                  <TableHead className="text-right">Criadas</TableHead>
                  <TableHead className="text-right">Ignoradas</TableHead>
                  <TableHead>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {imports.map((b) => {
                  const st = statusOf(b.status);
                  const hasErrors = b.errors.length > 0 || !!b.errorMessage;
                  return (
                    <React.Fragment key={b.id}>
                      <TableRow>
                        <TableCell>
                          <span className="font-medium text-fg">{b.fileName ?? "Arquivo sem nome"}</span>
                        </TableCell>
                        <TableCell className="text-caption tabular-nums text-fg-muted">{formatDateTimeBr(b.createdAt)}</TableCell>
                        <TableCell className="text-fg-muted">{b.createdByName ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatInt(b.totalRows)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatInt(b.validRows)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatInt(b.warningRows)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatInt(b.errorRows)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatInt(b.createdRows)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatInt(b.skippedRows)}</TableCell>
                        <TableCell><StatusBadge status={st.tone} size="sm">{st.label}</StatusBadge></TableCell>
                      </TableRow>
                      {hasErrors ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={10} className="py-1.5">
                            <details className="group/errors">
                              <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-xs text-caption text-fg-muted hfm-focus-ring hover:text-fg">
                                <ChevronRight className="size-3.5 transition-transform group-open/errors:rotate-90" aria-hidden />
                                {b.errors.length > 0
                                  ? `${formatInt(b.errors.length)} ${b.errors.length === 1 ? "erro por linha" : "erros por linha"}`
                                  : "Detalhe da falha"}
                              </summary>
                              <div className="mt-2 flex flex-col gap-1 pl-5">
                                {b.errorMessage ? <p className="text-caption text-danger-soft-fg">{b.errorMessage}</p> : null}
                                {b.errors.length > 0 ? (
                                  <ul className="flex flex-col gap-0.5 text-caption text-fg-muted" aria-label={`Erros do arquivo ${b.fileName ?? b.id}`}>
                                    {b.errors.map((e, i) => (
                                      <li key={`${e.row}-${i}`}>
                                        <span className="font-mono tabular-nums text-fg">Linha {formatInt(e.row)}</span> → {e.message}
                                      </li>
                                    ))}
                                  </ul>
                                ) : null}
                              </div>
                            </details>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  );
}
