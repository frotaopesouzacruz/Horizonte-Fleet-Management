"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronRight, FileSpreadsheet, Upload } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/empty-state";
import type { FidelizationImportBatch } from "@/lib/governance/fidelization-central";

const number = new Intl.NumberFormat("pt-BR");

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Os dois arquivos que passam por aqui: alocações (esta tela) e cadastro de BRs (módulo BRs). */
const TYPE_LABEL: Record<string, string> = {
  fidelization: "Alocações",
  operation_brs: "Cadastro de BRs",
};

/** A situação do lote como `import_batches.status` a grava. */
const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  draft: { label: "Rascunho", tone: "pending" },
  validated: { label: "Validada, não gravada", tone: "info" },
  processing: { label: "Em processamento", tone: "progress" },
  completed: { label: "Concluída", tone: "success" },
  failed: { label: "Falhou", tone: "danger" },
  cancelled: { label: "Cancelada", tone: "neutral" },
};

const statusOf = (status: string) => STATUS[status] ?? { label: status || "—", tone: "neutral" as const };

const STEPS = [
  { title: "Envio do arquivo", text: "XLSX ou CSV, com uma linha por vínculo de veículo com a BR." },
  { title: "Mapeamento de colunas", text: "Os cabeçalhos são reconhecidos pelo nome e pelos sinônimos aceitos." },
  { title: "Prévia com erros por linha", text: "Cada linha diz o que vai acontecer — criar, substituir, ignorar ou erro." },
  { title: "Gravação", text: "Só depois da confirmação, e só as linhas válidas. O resultado fica no histórico abaixo." },
] as const;

export interface ImportPanelProps {
  history: FidelizationImportBatch[];
  canImport: boolean;
  brsModuleHref: string;
  onOpenImport: () => void;
}

/**
 * Importação da Fidelização (Etapa 15): o fluxo controlado e o histórico.
 *
 * O arquivo de alocações entra por aqui (a gaveta `ImportDrawer`, aberta por
 * `onOpenImport`); o de cadastro de BRs entra pelo módulo BRs (§38), e os dois
 * aparecem no mesmo histórico porque a pergunta "o que foi importado e por
 * quem" é uma só. Uma importação nunca apaga e nunca cria BR ou veículo.
 */
export function ImportPanel({ history, canImport, brsModuleHref, onOpenImport }: ImportPanelProps) {
  return (
    <section aria-label="Importação" className="flex min-w-0 flex-col gap-4">
      <Card>
        <CardHeader
          title="Importação controlada"
          description="Alocações de veículos por BR, validadas antes de qualquer gravação. Nada histórico é sobrescrito em silêncio."
        />
        <CardContent className="flex flex-col gap-4">
          <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-2.5 rounded-md border border-border bg-surface-secondary p-3">
                <span
                  aria-hidden
                  className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-caption font-semibold text-primary-soft-fg"
                >
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-body-sm font-semibold text-fg">{step.title}</span>
                  <span className="block text-caption text-fg-muted">{step.text}</span>
                </span>
              </li>
            ))}
          </ol>

          <ul className="flex list-disc flex-col gap-1 pl-5 text-body-sm text-fg-secondary">
            <li>BRs e placas desconhecidas não são criadas: a linha fica de fora, com o erro dito na prévia.</li>
            <li>Reimportar o mesmo arquivo é reconhecido — a prévia avisa, e o que já existe é ignorado.</li>
            <li>
              O cadastro de BRs (criar, atualizar, inativar) é importado no módulo BRs; aqui entram só as alocações.
            </li>
          </ul>

          <div className="flex flex-wrap items-center gap-2">
            {canImport ? (
              <Button leadingIcon={<Upload />} onClick={onOpenImport}>
                Importar alocações
              </Button>
            ) : null}
            <Button asChild variant="secondary">
              <Link href={brsModuleHref}>
                Cadastro de BRs no módulo BRs
                <ArrowUpRight aria-hidden />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          title="Histórico de importações"
          description="Os lotes de alocações e de cadastro de BRs, com o resultado linha a linha. Linhas com erro não entram; as ignoradas já existiam ou não mudavam nada."
        />
        <CardContent>
          {history.length === 0 ? (
            <EmptyState
              size="sm"
              variant="panel"
              icon={<FileSpreadsheet />}
              title="Nenhuma importação registrada"
              description="Os arquivos enviados aparecem aqui com quem enviou, quantas linhas entraram e os erros de cada linha."
            />
          ) : (
            <>
              {/* ------------------------------------------------ desktop (xl+)
                  O tipo mora sob o arquivo e o responsável sob a data: assim as
                  sete contagens cabem lado a lado a partir de 1280px. */}
              <TableContainer className="hidden xl:block">
                <Table aria-label="Histórico de importações">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Arquivo e tipo</TableHead>
                      <TableHead>Data e responsável</TableHead>
                      <TableHead numeric className="px-2">Linhas</TableHead>
                      <TableHead numeric className="px-2">Válidas</TableHead>
                      <TableHead numeric className="px-2">Avisos</TableHead>
                      <TableHead numeric className="px-2">Erros</TableHead>
                      <TableHead numeric className="px-2">Criadas</TableHead>
                      <TableHead numeric className="px-2">Atualizadas</TableHead>
                      <TableHead numeric className="px-2">Ignoradas</TableHead>
                      <TableHead>Situação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((batch) => {
                      const status = statusOf(batch.status);
                      const hasErrors = batch.errors.length > 0 || Boolean(batch.errorMessage);
                      return (
                        <React.Fragment key={batch.id}>
                          <TableRow className={cn("h-auto", hasErrors && "border-b-0")}>
                            <TableCell className="py-2.5 align-top">
                              <span className="block font-medium break-all text-fg">
                                {batch.fileName || "Arquivo sem nome"}
                              </span>
                              <span className="mt-1 flex">
                                <TypeBadge type={batch.type} />
                              </span>
                            </TableCell>
                            <TableCell className="py-2.5 align-top">
                              <span className="block whitespace-nowrap tabular-nums text-fg-secondary">
                                {formatDateTime(batch.createdAt)}
                              </span>
                              <span className="block text-caption text-fg-muted">
                                <span className="sr-only">Responsável: </span>
                                {batch.createdByName ?? "—"}
                              </span>
                            </TableCell>
                            <TableCell numeric className="px-2 py-2.5 align-top">{number.format(batch.totalRows)}</TableCell>
                            <TableCell numeric className="px-2 py-2.5 align-top">{number.format(batch.validRows)}</TableCell>
                            <TableCell numeric className="px-2 py-2.5 align-top">{number.format(batch.warningRows)}</TableCell>
                            <TableCell
                              numeric
                              className={cn("px-2 py-2.5 align-top", batch.errorRows > 0 && "font-medium text-danger-soft-fg")}
                            >
                              {number.format(batch.errorRows)}
                            </TableCell>
                            <TableCell numeric className="px-2 py-2.5 align-top">{number.format(batch.createdRows)}</TableCell>
                            <TableCell numeric className="px-2 py-2.5 align-top">{number.format(batch.updatedRows)}</TableCell>
                            <TableCell numeric className="px-2 py-2.5 align-top">{number.format(batch.skippedRows)}</TableCell>
                            <TableCell className="py-2.5 align-top">
                              <StatusBadge status={status.tone} size="sm">
                                {status.label}
                              </StatusBadge>
                            </TableCell>
                          </TableRow>
                          {hasErrors ? (
                            <TableRow className="h-auto hover:bg-transparent">
                              <TableCell colSpan={10} className="pb-2.5 pt-0">
                                <BatchErrors batch={batch} />
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>

              {/* ---------------------------------------------- celular */}
              <ul aria-label="Histórico de importações" className="flex flex-col gap-2 xl:hidden">
                {history.map((batch) => {
                  const status = statusOf(batch.status);
                  const hasErrors = batch.errors.length > 0 || Boolean(batch.errorMessage);
                  return (
                    <li key={batch.id} className="rounded-md border border-border bg-surface p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="break-all font-medium text-fg">{batch.fileName || "Arquivo sem nome"}</p>
                          <p className="text-caption text-fg-muted">
                            {formatDateTime(batch.createdAt)} · {batch.createdByName ?? "—"}
                          </p>
                        </div>
                        <TypeBadge type={batch.type} />
                      </div>
                      <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1.5 text-body-sm sm:grid-cols-4 lg:grid-cols-7">
                        <Count label="Linhas" value={batch.totalRows} />
                        <Count label="Válidas" value={batch.validRows} />
                        <Count label="Avisos" value={batch.warningRows} />
                        <Count label="Erros" value={batch.errorRows} danger={batch.errorRows > 0} />
                        <Count label="Criadas" value={batch.createdRows} />
                        <Count label="Atualizadas" value={batch.updatedRows} />
                        <Count label="Ignoradas" value={batch.skippedRows} />
                      </dl>
                      <div className="mt-2 flex">
                        <StatusBadge status={status.tone} size="sm">
                          {status.label}
                        </StatusBadge>
                      </div>
                      {hasErrors ? (
                        <div className="mt-2 border-t border-border-subtle pt-2">
                          <BatchErrors batch={batch} />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function TypeBadge({ type }: { type: string }) {
  return (
    <Badge variant={type === "operation_brs" ? "accent" : "primary"} size="sm">
      {TYPE_LABEL[type] ?? type}
    </Badge>
  );
}

function Count({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className={danger ? "font-medium tabular-nums text-danger-soft-fg" : "tabular-nums text-fg"}>
        {number.format(value)}
      </dd>
    </div>
  );
}

function BatchErrors({ batch }: { batch: FidelizationImportBatch }) {
  const count = batch.errors.length;
  return (
    <details className="group/errors">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-xs text-caption text-fg-muted hfm-focus-ring hover:text-fg [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 transition-transform group-open/errors:rotate-90" aria-hidden />
        {count > 0 ? `${number.format(count)} ${count === 1 ? "erro por linha" : "erros por linha"}` : "Detalhe da falha"}
      </summary>
      <div className="mt-2 flex flex-col gap-1 pl-5">
        {batch.errorMessage ? <p className="text-caption text-danger-soft-fg">{batch.errorMessage}</p> : null}
        {count > 0 ? (
          <ul className="flex flex-col gap-0.5 text-caption text-fg-muted" aria-label={`Erros do arquivo ${batch.fileName}`}>
            {batch.errors.map((e, i) => (
              <li key={`${e.row}-${i}`} className="break-words">
                <span className="font-mono tabular-nums text-fg">Linha {number.format(e.row)}</span> → {e.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}
