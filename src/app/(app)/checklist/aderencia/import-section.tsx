"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileCheck2, Upload } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import {
  Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/feedback/toast";
import { useConfirm } from "@/components/feedback/confirm-dialog";
import { ImportProgress } from "@/components/feedback/import-progress";
import type { AdherenceImportPreview } from "@/lib/adherence/import-actions";
import { confirmAdherenceImport, uploadAdherenceImport } from "@/lib/adherence/import-client";
import type { ImportProgressState } from "@/lib/import/client";
import { ACCEPTED_STATUSES, IMPORT_COLUMNS } from "@/lib/adherence/import-columns";
import { formatDateBr, formatInt, statusMeta } from "./status";

/**
 * Importação (§54–§56). O arquivo passa por validação e prévia antes de
 * qualquer gravação, e o que ele grava são SOLICITAÇÕES pendentes: a decisão
 * continua sendo de uma pessoa autorizada, nunca do arquivo.
 */
export function ImportSection({ onChanged }: { onChanged: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [preview, setPreview] = React.useState<AdherenceImportPreview | null>(null);
  const [busy, startTransition] = React.useTransition();
  const [progress, setProgress] = React.useState<ImportProgressState | null>(null);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await uploadAdherenceImport(data, setProgress);
      if (result.ok && result.data) setPreview(result.data);
      else toast({ title: result.error ?? "Não foi possível validar o arquivo.", variant: "danger" });
    });
  };

  const apply = async () => {
    if (!preview) return;
    const ok = await confirm({
      title: "Confirmar a importação?",
      description: `${formatInt(preview.createRows)} solicitação(ões) de justificativa serão abertas como PENDENTES, para decisão. ${formatInt(preview.errorRows)} linha(s) com erro ficam de fora e viram inconsistências quando o motivo for status ou veículo desconhecido.`,
      confirmLabel: "Importar",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await confirmAdherenceImport(preview.batchId, setProgress, preview.validRows);
      if (result.ok && result.data) {
        toast({ title: `Importação concluída: ${formatInt(result.data.requestsCreated)} solicitação(ões) pendente(s), ${formatInt(result.data.inconsistencies)} inconsistência(s).`, variant: "success" });
        setPreview(null);
        formRef.current?.reset();
        router.refresh();
        onChanged();
      } else {
        toast({ title: result.error ?? "Não foi possível processar a importação.", variant: "danger" });
      }
    });
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <div>
          <h3 className="text-h4 font-semibold text-fg">Importação de status diário</h3>
          <p className="text-caption text-fg-muted">
            XLSX ou CSV com uma linha por veículo e dia. A importação abre solicitações pendentes com o motivo informado; não cria veículos, obrigações nem execuções, não sobrescreve checklist oficial, expurgo aprovado ou solicitação pendente, e nunca aprova nada. Status vazio ou desconhecido vira inconsistência.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md border border-border p-3">
            <h4 className="mb-1 text-label font-semibold text-fg">Colunas reconhecidas</h4>
            <ul className="text-caption text-fg-muted">
              {IMPORT_COLUMNS.map((c) => (
                <li key={c.field}><span className="font-medium text-fg">{c.label}</span>{c.required ? " *" : ""} — {c.hint}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-md border border-border p-3">
            <h4 className="mb-1 text-label font-semibold text-fg">Status aceitos</h4>
            <p className="text-caption text-fg-muted">{ACCEPTED_STATUSES.join(" · ")}</p>
            <p className="mt-2 text-caption text-fg-muted">&ldquo;Fez&rdquo; não vira execução: abre uma solicitação de execução comprovada, que exige evidência e aprovação por outra pessoa.</p>
          </div>
        </div>

        <form ref={formRef} onSubmit={submit} className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            name="file"
            accept=".xlsx,.csv"
            required
            aria-label="Arquivo de status diário"
            className="text-body-sm text-fg file:mr-3 file:rounded-sm file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-label file:text-fg hover:file:bg-secondary"
          />
          <Button type="submit" variant="secondary" leadingIcon={<Upload />} disabled={busy}>Validar arquivo</Button>
        </form>

        <ImportProgress progress={progress} />

        {preview ? (
          <div className="flex flex-col gap-3">
            {preview.alreadyImported ? (
              <Alert variant="warning"><AlertDescription>Este mesmo arquivo já foi importado antes. Reprocessar não duplica solicitações: as linhas já cobertas aparecem como conflito.</AlertDescription></Alert>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Badge variant="neutral">{preview.fileName} · {preview.sheetName}</Badge>
              <Badge variant="neutral">{formatInt(preview.totalRows)} linhas</Badge>
              <Badge variant="success">{formatInt(preview.validRows)} válidas</Badge>
              <Badge variant="warning">{formatInt(preview.warningRows)} avisos</Badge>
              <Badge variant="danger">{formatInt(preview.errorRows)} erros</Badge>
              <Badge variant="primary">{formatInt(preview.createRows)} solicitações a abrir</Badge>
            </div>
            <p className="text-caption text-fg-muted">
              Colunas mapeadas: {preview.mappedColumns.map((m) => `${m.header} → ${m.label}`).join(" · ")}
              {preview.unmappedColumns.length ? ` · ignoradas: ${preview.unmappedColumns.join(", ")}` : ""}
            </p>

            <TableContainer>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Linha</TableHead><TableHead>Situação</TableHead><TableHead>Frota / Placa</TableHead><TableHead>Data</TableHead><TableHead>Contexto</TableHead><TableHead>Status informado</TableHead><TableHead>Motivo</TableHead><TableHead>Status atual no HFM</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {preview.sample.length === 0 ? <TableEmpty colSpan={8} message="Sem linhas." /> : preview.sample.map((s) => (
                    <TableRow key={s.rowNumber}>
                      <TableCell className="tabular-nums">{s.rowNumber}</TableCell>
                      <TableCell><StatusBadge size="sm" status={s.status === "valid" ? "success" : s.status === "warning" ? "warning" : "danger"}>{s.status === "valid" ? "Válida" : s.status === "warning" ? "Aviso" : "Erro"}</StatusBadge></TableCell>
                      <TableCell>{s.fleetCode ?? "—"} {s.licensePlate ? <span className="text-fg-muted">{s.licensePlate}</span> : null}</TableCell>
                      <TableCell className="tabular-nums">{formatDateBr(s.operationalDate)}</TableCell>
                      <TableCell>{s.context === "retorno" ? "Retorno" : s.context === "saida" ? "Saída" : "—"}</TableCell>
                      <TableCell>{s.statusRaw ?? "—"}</TableCell>
                      <TableCell>{s.reasonCode ?? "—"}</TableCell>
                      <TableCell>{s.currentStatus ? statusMeta(s.currentStatus).label : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            {preview.findings.length > 0 ? (
              <TableContainer>
                <Table>
                  <TableHeader><TableRow><TableHead>Linha</TableHead><TableHead>Nível</TableHead><TableHead>Campo</TableHead><TableHead>Mensagem</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {preview.findings.map((f, i) => (
                      <TableRow key={`${f.rowNumber}-${i}`}>
                        <TableCell className="tabular-nums">{f.rowNumber ?? "—"}</TableCell>
                        <TableCell><StatusBadge size="sm" status={f.level === "error" ? "danger" : "warning"}>{f.level === "error" ? "Erro" : "Aviso"}</StatusBadge></TableCell>
                        <TableCell className="text-fg-muted">{f.field ?? "—"}</TableCell>
                        <TableCell>{f.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : null}

            <div className="flex justify-end">
              <Button leadingIcon={<FileCheck2 />} onClick={() => void apply()} disabled={busy || preview.createRows === 0}>
                Confirmar importação
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
