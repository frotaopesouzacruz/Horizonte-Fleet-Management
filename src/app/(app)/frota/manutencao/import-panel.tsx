"use client";

import * as React from "react";
import { CheckCircle2, Download, FileCheck2, History, ShieldCheck, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import {
  Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { ImportProgress } from "@/components/feedback/import-progress";
import { useConfirm } from "@/components/feedback/confirm-dialog";
import { useToast } from "@/components/feedback/toast";
import { cn } from "@/lib/cn";
import type { ImportProgressState } from "@/lib/import/client";
import { cancelMaintenanceImport, type MaintenanceImportOutcome, type MaintenanceImportPreview } from "@/lib/maintenance/import-actions";
import { confirmMaintenanceImport, uploadMaintenanceImport } from "@/lib/maintenance/import-client";
import { IMPORT_COLUMNS, IMPORT_KINDS, templateHeaders, type MaintenanceImportKind } from "@/lib/maintenance/import-columns";
import type { MaintenanceImportHistoryRow } from "@/lib/maintenance/queries";
import {
  CRITICALITY_LABEL, formatDate, formatInt, formatStamp, IMPORT_KIND_LABEL, STATUS_LABEL, typeLabel,
  type Criticality, type MaintenanceStatus,
} from "@/lib/maintenance/types";
import type { MaintenancePerms, PanelActions } from "./shared";

/**
 * Manutenção → Importações.
 *
 * Cinco bases, um fluxo: escolher a base, ler o layout, enviar o arquivo,
 * conferir a prévia e só então gravar. O arquivo é lido no navegador e vai
 * em partes, sem teto de linhas; o banco valida, classifica cada linha e
 * grava de forma idempotente. A tela não decide nada: mostra o que o banco
 * disse que vai acontecer e pede a confirmação.
 */

export interface ImportPanelProps {
  importacoes: { history: MaintenanceImportHistoryRow[] | null };
  perms: MaintenancePerms;
  actions: PanelActions;
}

/** A base não cria serviço nem fornecedor: os cadastros vêm antes. */
const RECOMMENDED_ORDER: MaintenanceImportKind[] = ["clusters", "services", "suppliers", "preventive_rules", "records"];

const CATEGORY_LABEL: Record<string, string> = {
  unknown_vehicle: "Veículo não encontrado",
  unknown_service: "Serviço fora do catálogo",
  unknown_supplier: "Fornecedor não reconhecido (entra sem vínculo)",
  cluster_mismatch: "Cluster diferente do cadastro (vale o cadastro)",
  group_status_mixed: "Situações diferentes na mesma entrada",
  exit_time_before_entry: "Saída antes da hora de entrada (TMM por data)",
  invalid_km: "KM ilegível ou com erro do Excel (ignorado)",
  invalid_document: "CNPJ/CPF inválido (sem documento)",
  duplicate_document: "CNPJ/CPF repetido (sem documento)",
  duplicate_external_code: "Código repetido no arquivo",
  unknown_criticality: "Criticidade não reconhecida",
  type_from_subcategory: "Subcategoria no lugar do tipo",
  model_is_subcategory: "Subcategoria no lugar do modelo",
  subcategory_conflict: "Subcategoria divergente",
  unknown_cluster: "Cluster inexistente",
  unknown_type: "Tipo de manutenção não reconhecido",
  type_mapped: "Tipo convertido em Corretiva com origem",
  damage_flow: "Avaria (fluxo de Sinistros)",
  unknown_status: "Situação não reconhecida",
  status_default: "Situação vazia (entra como Há agendar)",
  unknown_origin: "Origem fora do catálogo (Não informado)",
  missing_service: "Serviço ausente",
  missing_name: "Nome ausente",
  invalid_date: "Data inválida",
  missing_scheduled: "Agendado sem data agendada",
  missing_entry: "Sem data de entrada real",
  missing_exit: "Concluído sem data de saída",
  exit_before_entry: "Saída antes da entrada",
  future_fact: "Entrada ou saída no futuro",
  exit_ignored: "Saída ignorada (em execução)",
  km_out_of_range: "KM fora da faixa (ignorado)",
  expected_before_schedule: "Previsão de saída antes do agendamento",
  no_cycle: "Preventiva sem ciclo (MP)",
  no_preventive_rule: "MP sem regra preventiva do veículo (sem vínculo)",
  cycle_out_of_plan: "MP além dos ciclos da regra (sem vínculo)",
  matched_by_os: "Mesma entrada reconhecida pela OS (fornecedor reescrito)",
  reidentified: "Aberta reconhecida (OS ou data mudou na planilha)",
  reidentify_ambiguous: "Mais de uma aberta candidata (segue como nova)",
  os_kept: "OS ausente na planilha (mantida a do HFM)",
  os_changed: "OS alterada pela planilha",
  rescheduled: "Reprogramada pela planilha",
  reschedule_before_request: "Data agendada antes da solicitação (mantida a do HFM)",
  unknown_operation: "Operação não encontrada (entra sem operação)",
  ambiguous_operation: "Operação ambígua (entra sem operação)",
  ambiguous_city: "Cidade em mais de um estado (informe a UF)",
  city_outside_operation: "Cidade fora da abrangência da operação",
  context_divergent: "Contexto divergente (mantido o do HFM)",
  duplicate_in_file: "Repetida no arquivo",
  superseded: "Aviso superado pela reidentificação",
  cycle_reconciled: "Ciclo preventivo conciliado pelo KM",
  conflict: "Conflito: alterada no HFM",
  unchanged: "Já importada, sem mudança",
  unknown_city: "Cidade não encontrada",
  unknown_vehicle_type: "Tipo de equipamento inexistente",
  unknown_subcategory: "Subcategoria inexistente",
  unknown_model: "Modelo inexistente",
  invalid_interval: "Intervalo de KM inválido",
  process_failed: "Falha na gravação",
};

const LEVEL: Record<string, { label: string; tone: StatusTone }> = {
  error: { label: "Erro", tone: "danger" },
  warning: { label: "Aviso", tone: "warning" },
  info: { label: "Informação", tone: "info" },
};

const ROW_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  valid: { label: "Válida", tone: "success" },
  warning: { label: "Com aviso", tone: "warning" },
  error: { label: "Com erro", tone: "danger" },
  pending: { label: "Pendente", tone: "pending" },
};

const ACTION_LABEL: Record<string, string> = { create: "Criar", update: "Atualizar", skip: "Ignorar" };

const BATCH_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  draft: { label: "Em validação", tone: "pending" },
  validated: { label: "Aguardando confirmação", tone: "info" },
  processing: { label: "Gravando", tone: "progress" },
  completed: { label: "Concluída", tone: "success" },
  failed: { label: "Falhou", tone: "danger" },
  cancelled: { label: "Descartada", tone: "neutral" },
};

/** Colunas da amostra por base: o que ajuda a reconhecer a linha. */
const SAMPLE_COLUMNS: Record<MaintenanceImportKind, { key: string; label: string }[]> = {
  records: [
    { key: "license_plate", label: "Placa" },
    { key: "operation_name", label: "Operação" },
    { key: "city_label", label: "Cidade/UF" },
    { key: "type", label: "Tipo" },
    { key: "status", label: "Situação" },
    { key: "service", label: "Serviço" },
    { key: "supplier", label: "Parceiro" },
    { key: "entry_date", label: "Entrada" },
    { key: "service_order_number", label: "OS" },
    { key: "existing_code", label: "Manutenção existente" },
  ],
  clusters: [
    { key: "code", label: "Código" },
    { key: "name", label: "Cluster" },
    { key: "default_criticality", label: "Criticidade" },
  ],
  services: [
    { key: "name", label: "Serviço" },
    { key: "maintenance_type_codes", label: "Tipos" },
    { key: "criticality", label: "Criticidade" },
    { key: "expected_hours", label: "Horas previstas" },
    { key: "is_predictive", label: "Preditivo" },
  ],
  suppliers: [
    { key: "external_code", label: "Código" },
    { key: "name", label: "Fornecedor" },
    { key: "document_number", label: "CNPJ/CPF" },
    { key: "category", label: "Categoria" },
    { key: "payment_terms", label: "Pagamento" },
  ],
  preventive_rules: [
    { key: "interval_km", label: "Intervalo (km)" },
    { key: "initial_km", label: "KM inicial" },
    { key: "cycle_count", label: "Ciclos" },
    { key: "alert_before_pct", label: "Alerta (%)" },
    { key: "tolerance_after_pct", label: "Tolerância (%)" },
  ],
};

function sampleValue(key: string, value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (Array.isArray(value)) return value.map((v) => (key === "maintenance_type_codes" ? typeLabel(String(v)) : String(v))).join(", ") || "Todos";
  const text = String(value);
  if (key === "type") return typeLabel(text);
  if (key === "status") return STATUS_LABEL[text as MaintenanceStatus] ?? text;
  if (key === "criticality" || key === "default_criticality") return CRITICALITY_LABEL[text as Criticality] ?? text;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return formatDate(text);
  return text;
}

/** Aba e nome do modelo, como as planilhas da operação. */
const TEMPLATE_SHEET: Record<MaintenanceImportKind, string> = {
  clusters: "Clusters",
  services: "Serviços",
  suppliers: "Fornecedores",
  preventive_rules: "Parâmetros",
  records: "Manutenções",
};

/**
 * Modelo em XLSX gerado no navegador, com os cabeçalhos do layout na ordem
 * das planilhas da operação (as colunas opcionais vêm depois).
 */
async function downloadTemplate(kind: MaintenanceImportKind) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(TEMPLATE_SHEET[kind]);
  const headers = templateHeaders(kind);
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  headers.forEach((h, i) => {
    sheet.getColumn(i + 1).width = Math.min(Math.max(h.length + 4, 12), 40);
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `modelo-manutencao-${kind.replace(/_/g, "-")}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ImportPanel({ importacoes, perms, actions }: ImportPanelProps) {
  if (!perms.import) {
    return (
      <EmptyState
        variant="panel"
        icon={<ShieldCheck />}
        title="Sem acesso às importações"
        description="Importar manutenções e cadastros exige a permissão maintenance.import. Peça ao administrador da organização."
      />
    );
  }
  return (
    <div className="flex flex-col gap-5" data-testid="maintenance-imports">
      <ImportWorkspace actions={actions} />
      <ImportHistoryTable history={importacoes.history} actions={actions} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fluxo: base → layout → arquivo → prévia → gravação
// ---------------------------------------------------------------------------
interface Outcome extends MaintenanceImportOutcome {
  kind: MaintenanceImportKind;
  fileName: string;
}

function ImportWorkspace({ actions }: { actions: PanelActions }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [kind, setKind] = React.useState<MaintenanceImportKind>("records");
  const [preview, setPreview] = React.useState<MaintenanceImportPreview | null>(null);
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<ImportProgressState | null>(null);
  const [busy, startTransition] = React.useTransition();

  const kindInfo = IMPORT_KINDS.find((k) => k.kind === kind);
  const columns = IMPORT_COLUMNS[kind];
  const locked = busy || preview !== null;

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError(null);
    setOutcome(null);
    startTransition(async () => {
      try {
        const result = await uploadMaintenanceImport(kind, data, setProgress);
        if (result.ok && result.data) {
          setPreview(result.data);
        } else {
          const message = result.error ?? "Não foi possível validar o arquivo.";
          setError(message);
          toast({ title: message, variant: "danger" });
        }
      } catch {
        setProgress(null);
        setError("A conexão com o servidor caiu. Verifique a internet e tente de novo.");
      }
    });
  };

  const write = async () => {
    if (!preview) return;
    const writable = preview.createRows + preview.updateRows;
    const ok = await confirm({
      title: `Gravar a importação de ${IMPORT_KIND_LABEL[preview.kind] ?? preview.kind}?`,
      description: `${formatInt(preview.createRows)} registro(s) novo(s) e ${formatInt(preview.updateRows)} atualização(ões)${
        preview.kind === "records" ? `, formando ${formatInt(preview.maintenances)} manutenção(ões)` : ""
      }. ${formatInt(preview.errorRows)} linha(s) com erro, ${formatInt(preview.conflictRows)} conflito(s) e ${formatInt(
        preview.unchangedRows,
      )} sem mudança ficam de fora. A gravação é idempotente: repetir o arquivo não duplica.`,
      confirmLabel: `Gravar ${formatInt(writable)} linha(s)`,
    });
    if (!ok) return;
    const current = preview;
    setError(null);
    startTransition(async () => {
      try {
        const result = await confirmMaintenanceImport(current.batchId, setProgress, current.validRows + current.warningRows);
        if (result.ok && result.data) {
          const d = result.data;
          setOutcome({ ...d, kind: current.kind, fileName: current.fileName });
          setPreview(null);
          formRef.current?.reset();
          toast({
            title: `Importação gravada: ${formatInt(d.createdRows)} criada(s), ${formatInt(d.updatedRows)} atualizada(s), ${formatInt(d.skippedRows)} ignorada(s).`,
            description: current.kind === "records" ? `${formatInt(d.maintenancesCreated)} manutenção(ões) criada(s).` : undefined,
            variant: "success",
          });
          actions.refresh();
        } else {
          const message = result.error ?? "Não foi possível gravar a importação.";
          setError(message);
          toast({ title: message, variant: "danger" });
          actions.refresh();
        }
      } catch {
        setProgress(null);
        setError("A conexão com o servidor caiu. O que já foi gravado continua gravado; confirme de novo para continuar.");
      }
    });
  };

  const discard = () => {
    if (!preview) return;
    const batchId = preview.batchId;
    startTransition(async () => {
      try {
        const result = await cancelMaintenanceImport(batchId);
        if (result.ok) {
          setPreview(null);
          formRef.current?.reset();
          toast({ title: "Prévia descartada. Nada foi gravado.", variant: "neutral" });
          actions.refresh();
        } else {
          toast({ title: result.error ?? "Não foi possível descartar a importação.", variant: "danger" });
        }
      } catch {
        toast({ title: "Não foi possível descartar a importação.", variant: "danger" });
      }
    });
  };

  return (
    <section className="flex flex-col gap-4 rounded-md border border-border bg-surface p-4" aria-labelledby="maintenance-import-title" aria-busy={busy}>
      <div>
        <h2 id="maintenance-import-title" className="text-h3 font-semibold text-fg">
          Importar planilha
        </h2>
        <p className="mt-0.5 max-w-4xl text-body-sm text-fg-secondary">
          XLSX ou CSV, sem limite de linhas. O arquivo é validado inteiro antes de qualquer gravação, e a prévia diz linha a
          linha o que vai acontecer. Nada é gravado sem a sua confirmação.
        </p>
      </div>

      <fieldset className="m-0 min-w-0 border-0 p-0" disabled={locked}>
        <legend className="text-label font-semibold text-fg">1. Base a importar</legend>
        <p className="mt-0.5 text-caption text-fg-muted">
          Ordem recomendada: clusters → serviços → fornecedores → parâmetros preventivos → base de manutenções. A base não
          cria serviço nem fornecedor: eles precisam existir antes.
          {preview ? " Descarte ou grave a prévia aberta para trocar de base." : ""}
        </p>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {RECOMMENDED_ORDER.map((k, index) => {
            const info = IMPORT_KINDS.find((x) => x.kind === k);
            const checked = kind === k;
            return (
              <label
                key={k}
                className={cn(
                  "relative flex cursor-pointer flex-col gap-1 rounded-md border p-3 hfm-transition",
                  "has-[:focus-visible]:border-border-focus has-[:focus-visible]:shadow-focus",
                  checked ? "border-primary bg-surface ring-1 ring-primary" : "border-border bg-surface hover:bg-hover-overlay",
                  locked && "cursor-not-allowed opacity-70",
                )}
                data-testid={`maintenance-import-kind-${k}`}
              >
                <input
                  type="radio"
                  name="maintenance-import-kind"
                  value={k}
                  checked={checked}
                  onChange={() => {
                    setKind(k);
                    setError(null);
                    setOutcome(null);
                  }}
                  className="sr-only"
                />
                <span className="flex items-center gap-2">
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-xs bg-secondary px-1 text-caption font-semibold tabular-nums text-fg-secondary">
                    {index + 1}
                  </span>
                  <span className={cn("text-body-sm font-semibold", checked ? "text-primary-soft-fg" : "text-fg")}>
                    {IMPORT_KIND_LABEL[k] ?? info?.label ?? k}
                  </span>
                  {checked ? <CheckCircle2 className="ml-auto size-4 text-primary-soft-fg" aria-hidden /> : null}
                </span>
                <span className="text-caption text-fg-muted">{info?.description}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-label font-semibold text-fg">2. Layout: {kindInfo?.label ?? kind}</h3>
          <Button
            size="sm"
            variant="outline"
            leadingIcon={<Download />}
            onClick={() => void downloadTemplate(kind)}
            data-testid="maintenance-import-template"
          >
            Baixar modelo (XLSX)
          </Button>
        </div>
        <TableContainer tabIndex={0}>
          <Table layout="fixed" style={{ minWidth: 620 }} data-testid="maintenance-import-layout">
            <TableHeader>
              <TableRow>
                <TableHead style={{ width: 190 }}>Coluna</TableHead>
                <TableHead style={{ width: 130 }}>Obrigatória</TableHead>
                <TableHead>Como preencher</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {columns.map((c) => {
                const either = kind === "records" && (c.field === "fleet_code" || c.field === "license_plate");
                return (
                  <TableRow key={c.field}>
                    <TableCell className="font-medium">{c.label}</TableCell>
                    <TableCell>
                      {c.required ? (
                        <Badge variant="primary" size="sm">Sim</Badge>
                      ) : either ? (
                        <Badge variant="info" size="sm">Frota ou placa</Badge>
                      ) : (
                        <span className="text-fg-muted">Não</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-normal text-fg-secondary">{c.hint}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
        <p className="text-caption text-fg-muted">
          O modelo sai com os cabeçalhos das planilhas da operação, nesta ordem. Os cabeçalhos são reconhecidos pelo nome, sem
          acento nem maiúsculas (os nomes antigos também valem); colunas a mais são ignoradas e aparecem na prévia.
        </p>
      </div>

      <form ref={formRef} onSubmit={submit} className="flex flex-col gap-2">
        <h3 className="text-label font-semibold text-fg">3. Arquivo</h3>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            name="file"
            accept=".xlsx,.xls,.csv"
            required
            disabled={locked}
            aria-label={`Arquivo de ${kindInfo?.label ?? "importação"}`}
            aria-describedby="maintenance-import-file-hint"
            data-testid="maintenance-import-file"
            className="max-w-full text-body-sm text-fg file:mr-3 file:rounded-sm file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-label file:text-fg hover:file:bg-secondary disabled:opacity-60"
          />
          <Button type="submit" variant="secondary" leadingIcon={<Upload />} loading={busy && !preview} disabled={locked} data-testid="maintenance-import-validate">
            Validar arquivo
          </Button>
        </div>
        <p id="maintenance-import-file-hint" className="text-caption text-fg-muted">
          A primeira aba com dados é lida (a de-para em outra aba é ignorada); a linha 1 é o cabeçalho. Arquivos .xls antigos
          precisam ser salvos como .xlsx antes.
        </p>
      </form>

      <ImportProgress progress={progress} />

      {error ? (
        <Alert variant="danger">
          <AlertTitle>Não foi possível concluir</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {outcome ? <OutcomeSummary outcome={outcome} /> : null}

      {preview ? <PreviewPanel preview={preview} busy={busy} onWrite={() => void write()} onDiscard={discard} /> : null}
    </section>
  );
}

function OutcomeSummary({ outcome }: { outcome: Outcome }) {
  return (
    <Alert variant="success" data-testid="maintenance-import-outcome">
      <AlertTitle>
        Importação gravada: {IMPORT_KIND_LABEL[outcome.kind] ?? outcome.kind} · {outcome.fileName}
      </AlertTitle>
      <AlertDescription>
        {formatInt(outcome.createdRows)} criada(s) · {formatInt(outcome.updatedRows)} atualizada(s) · {formatInt(outcome.skippedRows)}{" "}
        ignorada(s)
        {outcome.kind === "records" ? ` · ${formatInt(outcome.maintenancesCreated)} manutenção(ões) criada(s)` : ""}. O lote está
        no histórico abaixo.
      </AlertDescription>
    </Alert>
  );
}

// ---------------------------------------------------------------------------
// Prévia
// ---------------------------------------------------------------------------
function Stat({ label, value, tone, testId }: { label: string; value: number; tone?: "danger" | "warning" | "success" | "primary"; testId?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-border bg-surface px-3 py-2" data-testid={testId}>
      <span className="truncate text-caption text-fg-muted">{label}</span>
      <span
        className={cn(
          "text-h3 font-semibold tabular-nums",
          tone === "danger" && value > 0 ? "text-danger" : tone === "warning" && value > 0 ? "text-warning-soft-fg" : "text-fg",
          tone === "success" && "text-success-soft-fg",
          tone === "primary" && "text-primary-soft-fg",
        )}
      >
        {formatInt(value)}
      </span>
    </div>
  );
}

function PreviewPanel({
  preview,
  busy,
  onWrite,
  onDiscard,
}: {
  preview: MaintenanceImportPreview;
  busy: boolean;
  onWrite: () => void;
  onDiscard: () => void;
}) {
  const [level, setLevel] = React.useState<string>("");
  const columns = IMPORT_COLUMNS[preview.kind];
  const fieldLabel = (field: string | null) => (field ? columns.find((c) => c.field === field)?.label ?? field : "—");
  const findings = preview.findings.filter((f) => !level || f.level === level);
  const levels = [...new Set(preview.findings.map((f) => f.level))];
  const categories = Object.entries(preview.categories).sort((a, b) => b[1] - a[1]);
  const sampleColumns = SAMPLE_COLUMNS[preview.kind] ?? [];
  const writable = preview.createRows + preview.updateRows;

  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4" data-testid="maintenance-import-preview">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-label font-semibold text-fg">4. Prévia</h3>
        <Badge variant="neutral" size="sm">{IMPORT_KIND_LABEL[preview.kind] ?? preview.kind}</Badge>
        <span className="min-w-0 truncate text-caption text-fg-muted" title={`${preview.fileName} · ${preview.sheetName}`}>
          {preview.fileName} · aba {preview.sheetName}
        </span>
      </div>

      {preview.alreadyImported ? (
        <Alert variant="warning">
          <AlertTitle>Este mesmo arquivo já foi importado</AlertTitle>
          <AlertDescription>
            O conteúdo é idêntico ao de um lote concluído. Gravar de novo não duplica: o que já existe aparece como &ldquo;sem
            mudança&rdquo; ou &ldquo;conflito&rdquo;.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" data-testid="maintenance-import-counters">
        <Stat label="Linhas no arquivo" value={preview.totalRows} />
        <Stat label="Válidas" value={preview.validRows} tone="success" />
        <Stat label="Com aviso" value={preview.warningRows} tone="warning" />
        <Stat label="Com erro" value={preview.errorRows} tone="danger" />
        <Stat label="Novas" value={preview.createRows} tone="primary" testId="maintenance-import-create" />
        <Stat label="Atualizações" value={preview.updateRows} tone="primary" />
        <Stat label="Sem mudança" value={preview.unchangedRows} />
        <Stat label="Conflitos" value={preview.conflictRows} tone="warning" />
        <Stat label="Duplicadas no arquivo" value={preview.duplicateRows} tone="danger" />
        {preview.kind === "records" ? <Stat label="Manutenções resultantes" value={preview.maintenances} tone="primary" /> : null}
        {preview.kind === "records" ? (
          <Stat label="Operação a preencher" value={preview.contextFillRows} tone="primary" testId="maintenance-import-context-fill" />
        ) : null}
        {preview.kind === "records" ? (
          <Stat label="Abertas reconhecidas" value={preview.reidentifiedRows} tone="warning" testId="maintenance-import-reidentified" />
        ) : null}
      </div>

      {preview.kind === "records" && preview.unknownSuppliers.length ? (
        <Alert variant="warning" data-testid="maintenance-import-unknown-suppliers">
          <AlertTitle>
            {formatInt(preview.unknownSuppliers.length)} fornecedor(es) da planilha não reconhecido(s) no catálogo
          </AlertTitle>
          <AlertDescription>
            <p>
              As manutenções entram sem vínculo e guardam o nome informado. Para ligar, informe o nome em{" "}
              <span className="font-medium">Cadastros › Fornecedores › Outros nomes</span> do fornecedor certo e importe o
              arquivo de novo: a manutenção ganha o vínculo, sem duplicar.
            </p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {preview.unknownSuppliers.map((u) => (
                <li key={u.name}>
                  <Badge variant="neutral" size="sm" title={u.name}>
                    {u.name}
                    <span className="ml-1 font-semibold tabular-nums">{formatInt(u.rows)}</span>
                  </Badge>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <Alert variant="neutral" icon={<ShieldCheck />}>
        <AlertTitle>O que a importação nunca faz</AlertTitle>
        <AlertDescription>
          <ul className="mt-1 list-disc pl-5">
            <li>criar veículo ou operação fictícios — linha sem veículo cadastrado fica de fora;</li>
            <li>alterar Perfis &amp; Permissões;</li>
            <li>sobrescrever o histórico de status de uma manutenção alterada por usuário — vira conflito;</li>
            <li>apagar vínculos com Planos de Ação ou apontamentos do Check List.</li>
          </ul>
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2">
          <h4 className="text-caption font-semibold text-fg-secondary">Colunas</h4>
          <p className="text-body-sm text-fg">
            {preview.mappedColumns.length ? (
              preview.mappedColumns.map((m, i) => (
                <React.Fragment key={`${m.header}-${i}`}>
                  {i > 0 ? <span className="text-fg-muted"> · </span> : null}
                  <span className="text-fg-secondary">{m.header}</span> → <span className="font-medium">{m.label}</span>
                </React.Fragment>
              ))
            ) : (
              <span className="text-fg-muted">Nenhuma coluna reconhecida.</span>
            )}
          </p>
          {preview.unmappedColumns.length ? (
            <p className="text-caption text-fg-muted">
              Não reconhecidas (ignoradas): {preview.unmappedColumns.join(", ")}
            </p>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <h4 className="text-caption font-semibold text-fg-secondary">Ocorrências por categoria</h4>
          {categories.length === 0 ? (
            <p className="text-body-sm text-fg-muted">Nenhuma ocorrência: todas as linhas estão prontas.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5" data-testid="maintenance-import-categories">
              {categories.map(([code, count]) => (
                <li key={code}>
                  <Badge variant="neutral" size="md" title={code}>
                    {CATEGORY_LABEL[code] ?? code}
                    <span className="ml-1 font-semibold tabular-nums">{formatInt(count)}</span>
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h4 className="text-caption font-semibold text-fg-secondary">
            Achados {preview.findings.length >= 300 ? "(os 300 primeiros, erros antes)" : ""}
          </h4>
          {levels.length > 1 ? (
            <div role="group" aria-label="Filtrar achados por nível" className="inline-flex gap-0.5 rounded-sm border border-border bg-surface-secondary p-0.5">
              {["", ...levels].map((l) => (
                <button
                  key={l || "all"}
                  type="button"
                  aria-pressed={level === l}
                  onClick={() => setLevel(l)}
                  className={cn(
                    "h-7 rounded-xs px-3 text-body-sm font-medium hfm-transition hfm-focus-ring",
                    level === l ? "bg-surface text-fg shadow-xs" : "text-fg-secondary hover:text-fg",
                  )}
                >
                  {l ? LEVEL[l]?.label ?? l : "Todos"}{" "}
                  <span className="tabular-nums text-fg-muted">
                    {formatInt(l ? preview.findings.filter((f) => f.level === l).length : preview.findings.length)}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <TableContainer tabIndex={0} stickyHeader maxHeight={360}>
          <Table layout="fixed" style={{ minWidth: 720 }} data-testid="maintenance-import-findings">
            <TableHeader>
              <TableRow>
                <TableHead style={{ width: 80 }} numeric>Linha</TableHead>
                <TableHead style={{ width: 110 }}>Nível</TableHead>
                <TableHead style={{ width: 160 }}>Campo</TableHead>
                <TableHead>Mensagem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {findings.length === 0 ? (
                <TableEmpty colSpan={4} message="Nenhum achado." />
              ) : (
                findings.map((f, i) => {
                  const meta = LEVEL[f.level] ?? { label: f.level, tone: "neutral" as StatusTone };
                  return (
                    <TableRow key={`${f.rowNumber ?? "x"}-${f.code ?? ""}-${i}`}>
                      <TableCell numeric>{f.rowNumber ?? "—"}</TableCell>
                      <TableCell>
                        <StatusBadge status={meta.tone} size="sm">{meta.label}</StatusBadge>
                      </TableCell>
                      <TableCell truncate className="text-fg-secondary" title={f.field ?? undefined}>{fieldLabel(f.field)}</TableCell>
                      <TableCell className="whitespace-normal">{f.message}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="text-caption font-semibold text-fg-secondary">Amostra das primeiras linhas</h4>
        <TableContainer tabIndex={0}>
          <Table layout="fixed" style={{ minWidth: 300 + sampleColumns.length * 140 }} data-testid="maintenance-import-sample">
            <TableHeader>
              <TableRow>
                <TableHead style={{ width: 70 }} numeric>Linha</TableHead>
                <TableHead style={{ width: 120 }}>Situação</TableHead>
                <TableHead style={{ width: 100 }}>Ação</TableHead>
                {sampleColumns.map((c) => (
                  <TableHead key={c.key} style={{ width: 140 }}>{c.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.sample.length === 0 ? (
                <TableEmpty colSpan={3 + sampleColumns.length} message="Sem linhas para mostrar." />
              ) : (
                preview.sample.map((s) => {
                  const st = ROW_STATUS[s.status] ?? { label: s.status, tone: "neutral" as StatusTone };
                  return (
                    <TableRow key={s.rowNumber}>
                      <TableCell numeric>{s.rowNumber}</TableCell>
                      <TableCell>
                        <StatusBadge status={st.tone} size="sm">{st.label}</StatusBadge>
                      </TableCell>
                      <TableCell>{ACTION_LABEL[s.action] ?? (s.action || "—")}</TableCell>
                      {sampleColumns.map((c) => {
                        const v = sampleValue(c.key, s.data[c.key]);
                        return (
                          <TableCell key={c.key} truncate title={v}>
                            {v}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-end">
        <p className="text-caption text-fg-muted sm:mr-auto">
          {writable > 0
            ? `${formatInt(writable)} linha(s) serão gravadas. Linhas com erro, conflito ou sem mudança ficam de fora.`
            : "Nenhuma linha nova ou a atualizar: não há o que gravar."}
        </p>
        <Button variant="outline" leadingIcon={<Trash2 />} onClick={onDiscard} disabled={busy} data-testid="maintenance-import-discard">
          Descartar
        </Button>
        <Button leadingIcon={<FileCheck2 />} onClick={onWrite} loading={busy} disabled={writable === 0} data-testid="maintenance-import-confirm">
          Confirmar gravação
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Histórico
// ---------------------------------------------------------------------------
function ImportHistoryTable({ history, actions }: { history: MaintenanceImportHistoryRow[] | null; actions: PanelActions }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="maintenance-import-history-title" data-testid="maintenance-import-history">
      <div>
        <h2 id="maintenance-import-history-title" className="flex items-center gap-2 text-h3 font-semibold text-fg">
          <History className="size-4 text-fg-muted" aria-hidden />
          Histórico de importações
        </h2>
        <p className="mt-0.5 text-body-sm text-fg-secondary">
          Os 50 lotes mais recentes da Manutenção. Ignoradas são linhas com erro, conflito ou sem mudança.
        </p>
      </div>
      {history === null ? (
        <ErrorState
          title="Não foi possível carregar o histórico de importações."
          description="A importação continua disponível acima."
          onRetry={actions.refresh}
          retryLabel="Tentar de novo"
          retrying={actions.pending}
        />
      ) : history.length === 0 ? (
        <EmptyState
          variant="panel"
          size="sm"
          icon={<History />}
          title="Nenhuma importação ainda"
          description="Os lotes enviados aparecem aqui com o resultado: criadas, atualizadas, ignoradas e erros. Comece pelos clusters."
        />
      ) : (
        <TableContainer tabIndex={0} stickyHeader maxHeight="60vh">
          <Table layout="fixed" style={{ minWidth: 1180 }}>
            <TableHeader>
              <TableRow>
                <TableHead style={{ width: 140 }}>Data</TableHead>
                <TableHead style={{ width: 170 }}>Tipo</TableHead>
                <TableHead style={{ width: 220 }}>Arquivo</TableHead>
                <TableHead style={{ width: 160 }}>Autor</TableHead>
                <TableHead style={{ width: 170 }}>Situação</TableHead>
                <TableHead style={{ width: 70 }} numeric>Total</TableHead>
                <TableHead style={{ width: 80 }} numeric>Criadas</TableHead>
                <TableHead style={{ width: 100 }} numeric>Atualizadas</TableHead>
                <TableHead style={{ width: 90 }} numeric>Ignoradas</TableHead>
                <TableHead style={{ width: 70 }} numeric>Erros</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((b) => {
                const st = BATCH_STATUS[b.status] ?? { label: b.status || "—", tone: "neutral" as StatusTone };
                return (
                  <TableRow key={b.id}>
                    <TableCell className="tabular-nums" title={b.processedAt ? `Processada em ${formatStamp(b.processedAt)}` : undefined}>
                      {formatStamp(b.createdAt)}
                    </TableCell>
                    <TableCell truncate>{b.kind ? IMPORT_KIND_LABEL[b.kind] ?? b.kind : "—"}</TableCell>
                    <TableCell truncate title={b.fileName ?? undefined}>{b.fileName ?? "Arquivo sem nome"}</TableCell>
                    <TableCell truncate title={b.createdByName ?? undefined}>{b.createdByName ?? "—"}</TableCell>
                    <TableCell>
                      <StatusBadge status={st.tone} size="sm">{st.label}</StatusBadge>
                    </TableCell>
                    <TableCell numeric>{formatInt(b.totalRows)}</TableCell>
                    <TableCell numeric>{formatInt(b.createdRows)}</TableCell>
                    <TableCell numeric>{formatInt(b.updatedRows)}</TableCell>
                    <TableCell numeric>{formatInt(b.skippedRows)}</TableCell>
                    <TableCell numeric className={b.errorRows > 0 ? "font-semibold text-danger" : undefined}>
                      {formatInt(b.errorRows)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </section>
  );
}
