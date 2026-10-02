"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Download, FileCheck2, Upload } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { SwitchField } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import {
  Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/feedback/toast";
import { useConfirm } from "@/components/feedback/confirm-dialog";
import { ImportProgress } from "@/components/feedback/import-progress";
import type { ImportProgressState } from "@/lib/import/client";
import type { ChecklistHistoryLayout } from "@/lib/adherence/history-import-columns";
import { HISTORY_FIXED_COLUMNS } from "@/lib/adherence/history-import-columns";
import type { HistoryImportOutcome, HistoryImportPreview } from "@/lib/adherence/history-import-actions";
import { confirmHistoryImport, uploadHistoryImport } from "@/lib/adherence/history-import-client";
import { downloadHistoryTemplate } from "@/lib/adherence/history-template";
import { formatDateBr, formatInt } from "./status";

/**
 * Histórico de Check List: a planilha modelo (gerada do catálogo publicado),
 * a prévia e a gravação em partes. "Fez" vira execução oficial — e por isso
 * alimenta a Aderência e os Planos de Ação pelo mesmo caminho do aplicativo.
 */
export function HistoryImportSection({ layout, onChanged }: { layout: ChecklistHistoryLayout; onChanged: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [preview, setPreview] = React.useState<HistoryImportPreview | null>(null);
  const [outcome, setOutcome] = React.useState<HistoryImportOutcome | null>(null);
  const [applyExclusions, setApplyExclusions] = React.useState(layout.canOverride);
  const [busy, startTransition] = React.useTransition();
  const [downloading, setDownloading] = React.useState(false);
  const [progress, setProgress] = React.useState<ImportProgressState | null>(null);

  const template = async () => {
    setDownloading(true);
    try {
      await downloadHistoryTemplate(layout);
    } catch {
      toast({ title: "Não foi possível gerar a planilha modelo.", variant: "danger" });
    } finally {
      setDownloading(false);
    }
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setOutcome(null);
    startTransition(async () => {
      const result = await uploadHistoryImport(data, layout, { applyExclusions }, setProgress);
      if (result.ok && result.data) setPreview(result.data);
      else toast({ title: result.error ?? "Não foi possível validar o arquivo.", variant: "danger" });
    });
  };

  const apply = async () => {
    if (!preview) return;
    const parts = [
      `${formatInt(preview.executions)} execução(ões) do Check List serão criadas com ${formatInt(preview.answers)} resposta(s)`,
      preview.overrides > 0 ? `${formatInt(preview.overrides)} expurgo(s) aplicados como exceção autorizada por você` : null,
      preview.requests > 0 ? `${formatInt(preview.requests)} solicitação(ões) ficam PENDENTES para decisão` : null,
      preview.noChange > 0 ? `${formatInt(preview.noChange)} dia(s) "Não fez" só geram a obrigação` : null,
    ].filter(Boolean);
    const ok = await confirm({
      title: "Confirmar a importação do histórico?",
      description: `${parts.join("; ")}. As obrigações de ${formatDateBr(preview.dateFrom)} a ${formatDateBr(preview.dateTo)} são geradas antes. ${formatInt(preview.errorRows)} linha(s) com erro ficam de fora.`,
      confirmLabel: "Importar histórico",
    });
    if (!ok) return;
    startTransition(async () => {
      const total = preview.executions + preview.overrides + preview.requests;
      const result = await confirmHistoryImport(preview.batchId, setProgress, total);
      if (result.ok && result.data) {
        setOutcome(result.data);
        toast({
          title: `Histórico importado: ${formatInt(result.data.executionsCreated)} execução(ões), ${formatInt(result.data.overridesApplied)} expurgo(s), ${formatInt(result.data.requestsCreated)} solicitação(ões).`,
          variant: "success",
        });
        setPreview(null);
        formRef.current?.reset();
        router.refresh();
        onChanged();
      } else {
        toast({ title: result.error ?? "Não foi possível processar a importação.", variant: "danger" });
      }
    });
  };

  const conditionals = layout.questions.filter((q) => q.conditional).length;

  return (
    <Card data-testid="adherence-history-import">
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-h4 font-semibold text-fg">Histórico de Check List</h3>
            <p className="text-caption text-fg-muted">
              Uma linha por placa e dia com o status do dia e, quando o checklist foi feito, a resposta de cada pergunta. &ldquo;Fez Check List&rdquo; vira
              execução oficial do Check List de Frota: a Aderência concilia o dia e os Planos de Ação recebem as inconformidades, pelo mesmo caminho do aplicativo.
              Os demais status viram expurgo ou solicitação; &ldquo;Não fez&rdquo; só gera a obrigação do dia. A importação não cria veículos nem colaboradores.
            </p>
          </div>
          <Button type="button" variant="secondary" leadingIcon={<Download />} onClick={() => void template()} loading={downloading} data-testid="adherence-history-template">
            Baixar planilha modelo (XLSX)
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md border border-border p-3">
            <h4 className="mb-1 text-label font-semibold text-fg">Colunas fixas</h4>
            <ul className="text-caption text-fg-muted">
              {HISTORY_FIXED_COLUMNS.map((c) => (
                <li key={c.field}><span className="font-medium text-fg">{c.label}</span>{c.required ? " *" : ""} — {c.hint}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-md border border-border p-3">
            <h4 className="mb-1 text-label font-semibold text-fg">Perguntas do catálogo publicado</h4>
            <p className="text-caption text-fg-muted" data-testid="adherence-history-catalog">
              Versão {layout.version.label}: {formatInt(layout.questions.length)} perguntas (Sim, Não ou N/A) e {formatInt(conditionals)} campos condicionais, uma coluna cada, na ordem do formulário.
              Status aceitos: {layout.statuses.map((s) => s.label).join(" · ")}.
            </p>
            <p className="mt-2 text-caption text-fg-muted">
              Sem colaborador cadastrado, &ldquo;Fez&rdquo; entra como solicitação pendente de execução comprovada, sem as respostas. Reimportar o mesmo dia não duplica.
            </p>
          </div>
        </div>

        <form ref={formRef} onSubmit={submit} className="flex flex-col gap-3">
          {layout.canOverride ? (
            <SwitchField
              label="Aplicar expurgos como exceção autorizada"
              description="Sem rota, Manutenção, Em viagem, Reserva, Frota não ativa e Outros são gravados como decididos por você (correção administrativa em lote, com origem na importação). Desligado, viram solicitações pendentes."
              checked={applyExclusions}
              onCheckedChange={setApplyExclusions}
              disabled={busy}
              data-testid="adherence-history-apply-exclusions"
            />
          ) : (
            <p className="text-caption text-fg-muted">Os expurgos do arquivo abrem solicitações pendentes: a decisão é de quem tem a permissão de aprovar ou corrigir.</p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="file"
              name="file"
              accept=".xlsx,.csv"
              required
              aria-label="Arquivo do histórico de Check List"
              className="text-body-sm text-fg file:mr-3 file:rounded-sm file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-label file:text-fg hover:file:bg-secondary"
            />
            <Button type="submit" variant="secondary" leadingIcon={<Upload />} disabled={busy} data-testid="adherence-history-validate">Validar arquivo</Button>
          </div>
        </form>

        <ImportProgress progress={progress} />

        {outcome ? (
          <Alert variant="success" data-testid="adherence-history-outcome">
            <AlertDescription>
              Importação concluída: {formatInt(outcome.executionsCreated)} execução(ões) com {formatInt(outcome.answersCreated)} resposta(s) ({formatInt(outcome.nonConforming)} inconformidades encaminhadas aos Planos de Ação),
              {" "}{formatInt(outcome.overridesApplied)} expurgo(s) aplicados, {formatInt(outcome.requestsCreated)} solicitação(ões) pendentes, {formatInt(outcome.obligationsCreated)} obrigação(ões) geradas em {formatInt(outcome.monthsGenerated)} mês(es).
              {outcome.skipped + outcome.failed > 0 ? ` ${formatInt(outcome.skipped)} linha(s) ignoradas e ${formatInt(outcome.failed)} com falha — veja o Histórico de importações.` : ""}
            </AlertDescription>
          </Alert>
        ) : null}

        {preview ? (
          <div className="flex flex-col gap-3" data-testid="adherence-history-preview">
            {preview.alreadyImported ? (
              <Alert variant="warning"><AlertDescription>Este mesmo arquivo já foi importado antes. Reprocessar não duplica: os dias já importados aparecem como aviso e são mantidos.</AlertDescription></Alert>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Badge variant="neutral">{preview.fileName} · {preview.sheetName}</Badge>
              <Badge variant="neutral">{formatInt(preview.totalRows)} linhas</Badge>
              <Badge variant="success">{formatInt(preview.validRows)} válidas</Badge>
              <Badge variant="warning">{formatInt(preview.warningRows)} avisos</Badge>
              <Badge variant="danger">{formatInt(preview.errorRows)} erros</Badge>
              <Badge variant="neutral">{formatInt(preview.vehicles)} placas · {formatDateBr(preview.dateFrom)} a {formatDateBr(preview.dateTo)}</Badge>
            </div>
            <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Stat label="Execuções a criar" value={preview.executions} hint={`${formatInt(preview.answers)} respostas`} tone="primary" />
              <Stat label={preview.applyExclusions ? "Expurgos a aplicar" : "Expurgos (solicitações)"} value={preview.applyExclusions ? preview.overrides : preview.requests} tone="warning" />
              <Stat label="Solicitações pendentes" value={preview.applyExclusions ? preview.requests : 0} hint="Fez sem colaborador ou sem respostas" tone="neutral" />
              <Stat label="Dias &ldquo;Não fez&rdquo;" value={preview.noChange} hint="Só a obrigação é gerada" tone="neutral" />
            </dl>
            <p className="text-caption text-fg-muted">
              Por status: {Object.entries(preview.byStatus).map(([k, v]) => `${k} ${formatInt(v)}`).join(" · ")}.
              {preview.columns.unmapped.length ? ` Colunas ignoradas: ${preview.columns.unmapped.join(", ")}.` : ""}
              {preview.columns.unansweredQuestions.length ? ` Perguntas sem coluna no arquivo: ${preview.columns.unansweredQuestions.length}.` : ""}
            </p>

            {preview.unknownEmployees.length > 0 ? (
              <details className="group/emp rounded-md border border-warning/30 bg-warning-soft p-3" data-testid="adherence-history-unknown-employees">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-body-sm font-medium text-warning-soft-fg hfm-focus-ring rounded-xs">
                  <ChevronRight className="size-3.5 transition-transform group-open/emp:rotate-90" aria-hidden />
                  {formatInt(preview.unknownEmployees.length)} colaborador(es) não encontrado(s) — os dias deles entram como solicitação pendente, sem respostas
                </summary>
                <ul className="mt-2 grid gap-0.5 pl-5 text-caption text-fg md:grid-cols-2">
                  {preview.unknownEmployees.map((u) => (
                    <li key={`${u.code}-${u.name}`}><span className="font-mono tabular-nums">{u.code ?? "—"}</span> {u.name ?? ""} <span className="text-fg-muted">({formatInt(u.rows)} dias)</span></li>
                  ))}
                </ul>
                <p className="mt-2 pl-5 text-caption text-fg-muted">Cadastre os colaboradores em Administração › Usuários (importação de colaboradores) e reimporte para ter as respostas destes dias.</p>
              </details>
            ) : null}
            {preview.unknownPlates.length > 0 ? (
              <Alert variant="danger"><AlertDescription>Placas não encontradas no Cadastro de Frotas (linhas recusadas): {preview.unknownPlates.join(", ")}.</AlertDescription></Alert>
            ) : null}

            <TableContainer>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Linha</TableHead><TableHead>Situação</TableHead><TableHead>Placa</TableHead><TableHead>Data</TableHead><TableHead>Status informado</TableHead><TableHead>Motorista</TableHead><TableHead className="text-right">Respostas</TableHead><TableHead>Ação</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {preview.sample.length === 0 ? <TableEmpty colSpan={8} message="Sem linhas." /> : preview.sample.map((s) => (
                    <TableRow key={s.rowNumber}>
                      <TableCell className="tabular-nums">{s.rowNumber}</TableCell>
                      <TableCell><StatusBadge size="sm" status={s.status === "valid" ? "success" : s.status === "warning" ? "warning" : "danger"}>{s.status === "valid" ? "Válida" : s.status === "warning" ? "Aviso" : "Erro"}</StatusBadge></TableCell>
                      <TableCell className="font-medium tabular-nums">{s.licensePlate ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{formatDateBr(s.operationalDate)}{s.context === "retorno" ? " · Retorno" : ""}</TableCell>
                      <TableCell>{s.statusRaw ?? "—"}</TableCell>
                      <TableCell className="text-fg-muted">{s.employeeCode ? `${s.employeeCode} ` : ""}{s.employeeName ?? ""}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.answersCount ? formatInt(s.answersCount) : "—"}</TableCell>
                      <TableCell className="text-fg-muted">{kindLabel(s.kind, s.code)}</TableCell>
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
              <Button leadingIcon={<FileCheck2 />} onClick={() => void apply()} disabled={busy || preview.executions + preview.overrides + preview.requests + preview.noChange === 0} data-testid="adherence-history-confirm">
                Confirmar importação
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function kindLabel(kind: string | null, code: string | null): string {
  if (code === "already_imported") return "Já importado";
  if (code === "already_done") return "Já tem checklist";
  switch (kind) {
    case "execution": return "Execução do Check List";
    case "override": return "Expurgo (exceção autorizada)";
    case "request": return "Solicitação pendente";
    case "none": return "Só a obrigação";
    default: return "—";
  }
}

function Stat({ label, value, hint, tone }: { label: React.ReactNode; value: number; hint?: string; tone: "primary" | "warning" | "neutral" }) {
  const toneClass = tone === "primary" ? "text-primary" : tone === "warning" ? "text-warning-soft-fg" : "text-fg";
  return (
    <div className="rounded-md border border-border bg-surface-raised px-3 py-2">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className={`text-h3 font-semibold tabular-nums ${toneClass}`}>{formatInt(value)}</dd>
      {hint ? <dd className="text-caption text-fg-muted">{hint}</dd> : null}
    </div>
  );
}
