"use client";

import * as React from "react";
import { CheckCircle2, Download, FileCheck2, FileSpreadsheet, History, ShieldCheck, Upload, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { useConfirm } from "@/components/feedback/confirm-dialog";
import { EmptyState } from "@/components/feedback/empty-state";
import { Progress } from "@/components/feedback/progress";
import { useToast } from "@/components/feedback/toast";
import { SectionHeader } from "@/components/layout/section-header";
import { VerificationModeBadge } from "@/components/mtsr/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { FormField } from "@/components/ui/form-field";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import type { MtsrImportFinding, MtsrImportOutcome, MtsrImportPreview } from "@/lib/mtsr/import-actions";
import {
  confirmMtsrImport,
  uploadMtsrImport,
  type MtsrImportProgress,
  type MtsrImportStage,
  type MtsrSheetInfo,
} from "@/lib/mtsr/import-client";
import { componentSpecs, MTSR_FIXED_COLUMNS, MTSR_SHEET_NAME, MTSR_TEMPLATE_FILE } from "@/lib/mtsr/import-sheet";
import type { MtsrImportBatch } from "@/lib/mtsr/queries";
import { buildMtsrTemplate, downloadMtsrTemplate } from "@/lib/mtsr/template";
import { COMPONENT_STATUS_LABEL, fmtInt, formatDate, formatStamp, type MtsrCatalog } from "@/lib/mtsr/types";

/**
 * Gestão de MTSR › Ingestão › Importação histórica de conformidade.
 *
 * Planilha modelo gerada do catálogo → upload (lido no navegador) → staging em
 * blocos → validação → prévia → confirmação → ingestão pela fonte
 * `manual_import`. Nada é gravado sem a confirmação; nenhuma regra mora aqui:
 * a tela mostra o que `stage_mtsr_import` e `process_mtsr_import` disseram.
 */
const TID = "mtsr-import";

export function MtsrImportSection({
  catalog,
  imports,
  canImport,
  onDone,
}: {
  catalog: MtsrCatalog;
  imports: MtsrImportBatch[];
  canImport: boolean;
  onDone: () => void;
}) {
  if (!canImport) {
    return (
      <EmptyState
        variant="panel"
        icon={<ShieldCheck />}
        title="Sem acesso à importação de conformidade"
        description="Importar a conformidade MTSR por planilha exige a permissão mtsr.import. Peça ao administrador da organização em Administração › Perfis & Permissões."
        data-testid={TID}
      />
    );
  }
  return <ImportWorkspace catalog={catalog} imports={imports} onDone={onDone} />;
}

// ---------------------------------------------------------------------------
// Fluxo
// ---------------------------------------------------------------------------
type Phase = "idle" | "running" | "preview" | "saving" | "done";

interface Flow {
  phase: Phase;
  sheet: MtsrSheetInfo | null;
  preview: MtsrImportPreview | null;
  outcome: MtsrImportOutcome | null;
  error: string | null;
  errorStage: MtsrImportStage | null;
  sheetNames: string[] | null;
  /** A gravação começou e parou: o lote pode ser retomado confirmando de novo. */
  saveStarted: boolean;
}

const IDLE: Flow = { phase: "idle", sheet: null, preview: null, outcome: null, error: null, errorStage: null, sheetNames: null, saveStarted: false };

function ImportWorkspace({ catalog, imports, onDone }: { catalog: MtsrCatalog; imports: MtsrImportBatch[]; onDone: () => void }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [file, setFile] = React.useState<File | null>(null);
  const [referenceDefault, setReferenceDefault] = React.useState("");
  const [flow, setFlow] = React.useState<Flow>(IDLE);
  const [progress, setProgress] = React.useState<MtsrImportProgress | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [downloading, setDownloading] = React.useState(false);
  const stageRef = React.useRef<MtsrImportStage>("reading");

  const activeComponents = React.useMemo(
    () => catalog.components.filter((c) => c.isActive).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "pt-BR")),
    [catalog.components],
  );
  const componentName = React.useMemo(() => new Map(catalog.components.map((c) => [c.code, c.name])), [catalog.components]);
  const specs = React.useMemo(() => componentSpecs(catalog.components), [catalog.components]);

  const onProgress = React.useCallback((p: MtsrImportProgress | null) => {
    setProgress(p);
    if (p) stageRef.current = p.stage;
  }, []);

  const locked = busy || flow.phase === "preview" || flow.phase === "saving";
  const usable = flow.preview ? flow.preview.validRows + flow.preview.warningRows : 0;

  const template = async () => {
    setDownloading(true);
    try {
      const buffer = await buildMtsrTemplate(activeComponents.map((c) => ({ name: c.name, verificationMode: c.verificationMode })));
      downloadMtsrTemplate(buffer);
    } catch {
      toast({ title: "Não foi possível gerar a planilha modelo.", variant: "danger" });
    } finally {
      setDownloading(false);
    }
  };

  const fail = (stage: MtsrImportStage, error: string, extra: Partial<Flow> = {}) => {
    setFlow((f) => ({ ...f, phase: extra.phase ?? "idle", error, errorStage: stage, ...extra }));
    toast({ title: error, variant: "danger" });
  };

  const validate = async () => {
    if (!file || busy) return;
    setBusy(true);
    stageRef.current = "reading";
    setFlow({ ...IDLE, phase: "running" });
    try {
      const result = await uploadMtsrImport(file, specs, { referenceDefault: referenceDefault || null }, onProgress);
      if (result.ok) {
        setFlow({ ...IDLE, phase: "preview", sheet: result.sheet, preview: result.preview });
        toast({
          title: `Planilha lida: aba "${result.sheet.sheetName}", cabeçalho na linha ${result.sheet.headerRow}.`,
          description: `${fmtInt(result.sheet.rowsRead)} linha(s) lidas. Confira a prévia antes de confirmar.`,
          variant: "success",
        });
      } else {
        fail(result.stage, result.error, { sheetNames: result.sheetNames ?? null });
      }
    } catch {
      fail(stageRef.current, "A conexão com o servidor caiu. Verifique a internet e tente de novo.");
    } finally {
      setProgress(null);
      setBusy(false);
    }
  };

  const save = async () => {
    const preview = flow.preview;
    if (!preview || busy || usable === 0) return;
    if (!flow.saveStarted) {
      const ok = await confirm({
        title: "Confirmar a importação da conformidade?",
        description:
          `${fmtInt(usable)} linha(s) aproveitáveis (${fmtInt(preview.vehicles)} veículo(s)) entram pela fonte Importação manual: ` +
          `${fmtInt(preview.cells)} leitura(s) de componente e ${fmtInt(preview.withLastInspection)} data(s) de última vistoria. ` +
          `Leituras mais antigas que a atual são ignoradas; na mesma data, vistoria de campo e backoffice prevalecem (conflito). ` +
          `${fmtInt(preview.errorRows)} linha(s) com erro ficam de fora. A importação nunca cria veículos.`,
        confirmLabel: "Confirmar importação",
        cancelLabel: "Voltar à prévia",
      });
      if (!ok) return;
    }
    setBusy(true);
    setFlow((f) => ({ ...f, phase: "saving", error: null, errorStage: null, saveStarted: true }));
    try {
      const result = await confirmMtsrImport(preview.batchId, usable, onProgress);
      if (result.ok && result.data) {
        const outcome = result.data;
        setFlow((f) => ({ ...f, phase: "done", outcome }));
        setFile(null);
        toast({
          title: `Importação concluída: ${fmtInt(outcome.applied)} leitura(s) aplicada(s), ${fmtInt(outcome.facts)} data(s) de vistoria atualizada(s).`,
          variant: "success",
        });
        onDone();
      } else {
        fail("saving", result.error ?? "Não foi possível concluir a importação.", { phase: "preview" });
      }
    } catch {
      fail("saving", "A conexão caiu durante a gravação. O que já foi gravado continua gravado; confirme de novo para continuar.", { phase: "preview" });
    } finally {
      setProgress(null);
      setBusy(false);
    }
  };

  const reset = () => {
    setFlow(IDLE);
    setFile(null);
  };

  return (
    <div className="flex flex-col gap-5" data-testid={TID}>
      <TemplateCard components={activeComponents} onDownload={() => void template()} downloading={downloading} />

      <section
        aria-labelledby={`${TID}-upload-titulo`}
        aria-busy={busy}
        className="flex flex-col gap-4 rounded-lg border border-border bg-surface-raised p-4 shadow-card"
      >
        <SectionHeader
          headingLevel={2}
          icon={<Upload />}
          title={<span id={`${TID}-upload-titulo`}>Importar conformidade histórica</span>}
          description="Upload → leitura → envio em blocos → validação → prévia → confirmação → ingestão. Sem limite de linhas; nada é gravado antes da confirmação."
        />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <Dropzone
            file={file}
            disabled={locked}
            onFile={(f) => {
              setFile(f);
              if (flow.phase === "idle" || flow.phase === "done") setFlow(IDLE);
            }}
          />
          <FormField
            label="Data de referência padrão"
            labelHint="Opcional"
            helperText="Usada como data da leitura quando a linha não traz “Última vistoria”. Sem ela, vale a data de hoje. Nunca pode ser futura."
            disabled={locked}
          >
            <DateInput
              value={referenceDefault}
              max={catalog.today}
              disabled={locked}
              onChange={(e) => setReferenceDefault(e.currentTarget.value)}
              data-testid={`${TID}-reference-date`}
            />
          </FormField>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button leadingIcon={<FileCheck2 />} onClick={() => void validate()} disabled={!file || locked} loading={busy && flow.phase === "running"} data-testid={`${TID}-validate`}>
            Ler e validar planilha
          </Button>
          {locked && flow.phase === "preview" ? (
            <span className="text-caption text-fg-muted">Confirme a prévia aberta ou descarte-a para enviar outro arquivo.</span>
          ) : null}
          {flow.phase === "preview" && !busy ? (
            <Button variant="ghost" leadingIcon={<X />} onClick={reset} data-testid={`${TID}-discard`}>
              Descartar prévia
            </Button>
          ) : null}
        </div>

        <StageProgress progress={progress} />

        {flow.error ? (
          <Alert variant="danger" data-testid={`${TID}-error`}>
            <AlertTitle>{flow.sheetNames ? "Planilha não reconhecida" : "Não foi possível concluir"}</AlertTitle>
            <AlertDescription>
              <p>{flow.error}</p>
              {flow.errorStage ? <p className="mt-1 text-caption">Etapa: {STAGE_LABEL[flow.errorStage]}.</p> : null}
              {flow.sheetNames?.length ? (
                <div className="mt-1.5">
                  <p>Abas encontradas no arquivo:</p>
                  <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="Abas encontradas">
                    {flow.sheetNames.map((name) => (
                      <li key={name}>
                        <Badge variant="neutral" appearance="outline" size="md">{name}</Badge>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5">Use a planilha modelo: a aba &ldquo;{MTSR_SHEET_NAME}&rdquo; precisa da coluna Placa e de ao menos uma coluna de componente ou a Última vistoria.</p>
                </div>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
      </section>

      {flow.outcome ? <OutcomeCard outcome={flow.outcome} fileName={flow.sheet?.fileName ?? null} onReset={reset} /> : null}

      {flow.preview && flow.sheet && flow.phase !== "done" ? (
        <PreviewSection
          preview={flow.preview}
          sheet={flow.sheet}
          componentName={componentName}
          saving={flow.phase === "saving"}
          saveStarted={flow.saveStarted}
          busy={busy}
          usable={usable}
          onConfirm={() => void save()}
        />
      ) : null}

      <HistorySection imports={imports} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// (a) Planilha modelo
// ---------------------------------------------------------------------------
const ACCEPTED_VALUES: { status: string; tone: StatusTone; values: string }[] = [
  { status: COMPONENT_STATUS_LABEL.ok, tone: "success", values: "OK · Conforme · Sim · Funcionando · Operante" },
  { status: COMPONENT_STATUS_LABEL.nok, tone: "danger", values: "NOK · Não conforme · Não · Inoperante · Defeito · Falha" },
  { status: COMPONENT_STATUS_LABEL.sem_informacao, tone: "neutral", values: "vazio · — · N/A · Sem informação · Não informado" },
];

function TemplateCard({
  components,
  onDownload,
  downloading,
}: {
  components: MtsrCatalog["components"];
  onDownload: () => void;
  downloading: boolean;
}) {
  return (
    <section
      aria-labelledby={`${TID}-template-titulo`}
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface-raised p-4 shadow-card"
      data-testid={`${TID}-template-card`}
    >
      <SectionHeader
        headingLevel={2}
        icon={<FileSpreadsheet />}
        title={<span id={`${TID}-template-titulo`}>Planilha modelo</span>}
        description={`${MTSR_TEMPLATE_FILE}: aba "${MTSR_SHEET_NAME}" com Placa, Frota, Última vistoria, Observação e uma coluna por componente ativo do catálogo (lista suspensa OK / NOK / Sem informação), mais uma aba de instruções.`}
        actions={
          <Button variant="secondary" leadingIcon={<Download />} onClick={onDownload} loading={downloading} data-testid={`${TID}-template`}>
            Baixar planilha modelo (XLSX)
          </Button>
        }
      />
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-md border border-border p-3">
          <h3 className="mb-1.5 text-label font-semibold text-fg">Colunas fixas</h3>
          <ul className="flex flex-col gap-1 text-caption text-fg-muted">
            {MTSR_FIXED_COLUMNS.map((c) => (
              <li key={c.field}>
                <span className="font-medium text-fg">{c.label}</span>
                {c.required ? <span aria-hidden> *</span> : null}
                {c.required ? <span className="sr-only"> (obrigatória)</span> : null} — {c.hint}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-caption text-fg-muted">* obrigatória (ou Frota quando a placa estiver vazia). Datas em dd/mm/aaaa ou como data do Excel.</p>
        </div>
        <div className="rounded-md border border-border p-3">
          <h3 className="mb-1.5 text-label font-semibold text-fg">Componentes ({fmtInt(components.length)})</h3>
          <ul className="flex flex-col gap-1" aria-label="Componentes do catálogo">
            {components.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-1.5 text-caption text-fg">
                <span className="font-medium">{c.name}</span>
                <VerificationModeBadge value={c.verificationMode} size="sm" />
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-caption text-fg-muted">O cabeçalho é reconhecido pelo nome, pelo código ou pelos apelidos cadastrados do componente.</p>
        </div>
        <div className="rounded-md border border-border p-3">
          <h3 className="mb-1.5 text-label font-semibold text-fg">Valores aceitos</h3>
          <ul className="flex flex-col gap-1.5">
            {ACCEPTED_VALUES.map((v) => (
              <li key={v.status} className="flex flex-wrap items-center gap-1.5 text-caption text-fg-muted">
                <StatusBadge status={v.tone} size="sm">{v.status}</StatusBadge>
                <span>{v.values}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-caption text-fg-muted">Qualquer outro texto é ignorado e aparece na prévia como aviso; a linha segue com os demais valores.</p>
        </div>
      </div>
      <Alert variant="neutral" icon={<ShieldCheck />}>
        <AlertTitle>O que a importação nunca faz</AlertTitle>
        <AlertDescription>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li>criar veículos: placa ou frota fora do Cadastro de Frotas é recusada com motivo;</li>
            <li>sobrescrever uma leitura mais recente: a leitura mais antiga é ignorada e fica no histórico de ingestão;</li>
            <li>vencer a vistoria de campo ou o backoffice na mesma data: a importação tem a menor prioridade e fica registrada como conflito;</li>
            <li>retroceder a última vistoria válida de um veículo;</li>
            <li>duplicar: o hash de cada leitura e o hash do arquivo reconhecem o que já entrou.</li>
          </ul>
        </AlertDescription>
      </Alert>
    </section>
  );
}

// ---------------------------------------------------------------------------
// (b) Upload e andamento
// ---------------------------------------------------------------------------
function Dropzone({ file, onFile, disabled }: { file: File | null; onFile: (file: File | null) => void; disabled?: boolean }) {
  const inputId = React.useId();
  const hintId = React.useId();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [over, setOver] = React.useState(false);
  const take = (list: FileList | null | undefined) => {
    const f = list?.[0] ?? null;
    if (f) onFile(f);
  };
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!disabled) take(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center hfm-transition",
          "has-[:focus-visible]:border-border-focus has-[:focus-visible]:shadow-focus",
          over ? "border-primary bg-primary-soft" : "border-border bg-surface-sunken hover:border-border-strong hover:bg-hover-overlay",
          disabled && "cursor-not-allowed opacity-60",
        )}
        data-testid={`${TID}-file`}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          disabled={disabled}
          aria-describedby={hintId}
          onChange={(e) => {
            take(e.currentTarget.files);
            e.currentTarget.value = "";
          }}
          data-testid={`${TID}-file-input`}
        />
        <Upload className="size-6 text-fg-muted" aria-hidden />
        <span className="text-body font-medium text-fg">
          Arraste a planilha aqui ou <span className="text-link underline underline-offset-4">escolha no computador</span>
        </span>
        <span id={hintId} className="text-caption text-fg-muted">
          Planilha modelo de conformidade (.xlsx). Lida no navegador e enviada em blocos; nada é gravado antes da confirmação.
        </span>
      </label>
      {file ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2" data-testid={`${TID}-file-selected`}>
          <FileSpreadsheet className="size-4 shrink-0 text-accent" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-fg" title={file.name}>{file.name}</span>
          <span className="text-caption tabular-nums text-fg-muted">{fmtBytes(file.size)}</span>
          {!disabled ? (
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={<X />}
              onClick={() => {
                onFile(null);
                inputRef.current?.focus();
              }}
            >
              Remover
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const STAGE_LABEL: Record<MtsrImportStage, string> = {
  reading: "Lendo a planilha no navegador",
  sending: "Enviando as linhas em blocos",
  validating: "Validando placas, datas e valores",
  finalizing: "Montando a prévia",
  saving: "Gravando as leituras (ingestão)",
};
const STAGE_UNIT: Record<MtsrImportStage, string> = {
  reading: "linhas",
  sending: "linhas enviadas",
  validating: "linhas validadas",
  finalizing: "linhas",
  saving: "linhas gravadas",
};

function StageProgress({ progress }: { progress: MtsrImportProgress | null }) {
  if (!progress) return null;
  const percent = progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;
  return (
    <div aria-live="polite" className="flex flex-col gap-1" data-testid={`${TID}-progress`}>
      <Progress
        label={STAGE_LABEL[progress.stage]}
        value={percent}
        indeterminate={progress.total === 0}
        valueLabel={progress.total > 0 ? `${fmtInt(progress.done)} de ${fmtInt(progress.total)} ${STAGE_UNIT[progress.stage]}` : undefined}
        srLabel={STAGE_LABEL[progress.stage]}
      />
      <p className="text-caption text-fg-muted">Não feche esta janela até terminar.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// (c) Prévia
// ---------------------------------------------------------------------------
const FINDING_LABEL: Record<string, string> = {
  import_unknown_vehicle: "Placa/frota não encontrada",
  invalid_date: "Data inválida",
  future_date: "Data futura",
  no_components: "Nada a aplicar",
  partial: "Valores não reconhecidos",
  failed: "Falha na gravação",
};
const findingLabel = (code: string | null | undefined) => (code ? FINDING_LABEL[code] ?? code : "—");

const LEVEL: Record<string, { label: string; tone: StatusTone }> = {
  error: { label: "Erro", tone: "danger" },
  warning: { label: "Aviso", tone: "warning" },
  info: { label: "Informação", tone: "info" },
};
const levelOf = (level: string) => LEVEL[level] ?? { label: level || "—", tone: "neutral" as StatusTone };

const ROW_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  valid: { label: "Válida", tone: "success" },
  warning: { label: "Aviso", tone: "warning" },
  error: { label: "Erro", tone: "danger" },
  updated: { label: "Aplicada", tone: "success" },
  skipped: { label: "Sem efeito", tone: "neutral" },
  failed: { label: "Falhou", tone: "danger" },
  pending: { label: "Pendente", tone: "pending" },
};
const rowStatus = (s: string) => ROW_STATUS[s] ?? { label: s || "—", tone: "neutral" as StatusTone };

function PreviewSection({
  preview,
  sheet,
  componentName,
  saving,
  saveStarted,
  busy,
  usable,
  onConfirm,
}: {
  preview: MtsrImportPreview;
  sheet: MtsrSheetInfo;
  componentName: Map<string, string>;
  saving: boolean;
  saveStarted: boolean;
  busy: boolean;
  usable: number;
  onConfirm: () => void;
}) {
  const byComponent = Object.entries(preview.byComponent);
  const errorFindings = preview.findings.filter((f) => f.level === "error").length;
  const fixedColumns = sheet.columns.filter((c) => c.kind === "fixed");
  const componentColumns = sheet.columns.filter((c) => c.kind === "component");

  return (
    <section
      aria-labelledby={`${TID}-preview-titulo`}
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface-raised p-4 shadow-card"
      data-testid={`${TID}-preview`}
    >
      <SectionHeader
        headingLevel={2}
        title={<span id={`${TID}-preview-titulo`}>Prévia da importação</span>}
        description={`${sheet.fileName} · aba "${sheet.sheetName}", cabeçalho na linha ${sheet.headerRow} · ${fmtInt(sheet.rowsRead)} linha(s) lidas. Nada foi gravado ainda.`}
        actions={
          <StatusBadge status={saving ? "progress" : "info"} size="md">
            {saving ? "Gravando" : "Aguardando confirmação"}
          </StatusBadge>
        }
      />

      {preview.alreadyImported ? (
        <Alert variant="warning" data-testid={`${TID}-already-imported`}>
          <AlertTitle>Este arquivo já foi importado antes</AlertTitle>
          <AlertDescription>
            O mesmo conteúdo (hash) já entrou em um lote concluído. Reprocessar não duplica: cada leitura é reconhecida pelo hash e as repetidas aparecem como
            duplicadas no resultado.
          </AlertDescription>
        </Alert>
      ) : null}

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        <Stat label="Linhas" value={preview.totalRows} />
        <Stat label="Aproveitáveis" value={usable} tone="primary" hint="Válidas + com aviso" testId={`${TID}-preview-usable`} />
        <Stat label="Avisos" value={preview.warningRows} tone="warning" />
        <Stat label="Erros" value={preview.errorRows} tone="danger" hint="Ficam de fora" />
        <Stat label="Veículos" value={preview.vehicles} />
        <Stat label="Com última vistoria" value={preview.withLastInspection} />
        <Stat label="Leituras de componente" value={preview.cells} hint="Células OK/NOK reconhecidas" />
        <Stat
          label="Período"
          value={preview.dateFrom || preview.dateTo ? `${formatDate(preview.dateFrom)} – ${formatDate(preview.dateTo)}` : "—"}
          hint={preview.referenceDefault ? `Padrão sem data: ${formatDate(preview.referenceDefault)}` : undefined}
        />
      </dl>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="text-label font-semibold text-fg">Por componente</h3>
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Componente</TableHead>
                  <TableHead align="right">OK</TableHead>
                  <TableHead align="right">NOK</TableHead>
                  <TableHead align="right">Sem informação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byComponent.length === 0 ? (
                  <TableEmpty colSpan={4} message="Nenhuma coluna de componente reconhecida." />
                ) : (
                  byComponent.map(([code, c]) => (
                    <TableRow key={code}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell align="right" className="tabular-nums">{fmtInt(c.ok)}</TableCell>
                      <TableCell align="right" className={cn("tabular-nums", c.nok > 0 && "font-semibold text-danger")}>{fmtInt(c.nok)}</TableCell>
                      <TableCell align="right" className="tabular-nums text-fg-muted">{fmtInt(c.semInformacao)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-label font-semibold text-fg">Colunas da planilha</h3>
          <div className="flex flex-col gap-2 rounded-md border border-border p-3">
            <ColumnChips label="Fixas reconhecidas" items={fixedColumns.map((c) => (c.header === c.label ? c.label : `${c.header} → ${c.label}`))} variant="primary" />
            <ColumnChips label="Componentes reconhecidos" items={componentColumns.map((c) => (c.header === c.label ? c.label : `${c.header} → ${c.label}`))} variant="info" />
            <ColumnChips label="Não reconhecidas (ignoradas)" items={sheet.unknownHeaders} variant="neutral" empty="nenhuma" />
          </div>
        </div>
      </div>

      {preview.unknownPlates.length > 0 ? (
        <Alert variant="danger" data-testid={`${TID}-unknown-plates`}>
          <AlertTitle>{fmtInt(preview.unknownPlates.length)} placa(s)/frota(s) não encontrada(s) no Cadastro de Frotas</AlertTitle>
          <AlertDescription>
            <p>A importação nunca cria veículos: estas linhas são recusadas. Cadastre ou corrija a placa em Gestão de frota › Cadastro de frotas e reimporte.</p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Placas não encontradas">
              {preview.unknownPlates.map((p) => (
                <li key={p}>
                  <Badge variant="danger" appearance="outline" size="md" className="font-mono tabular-nums">{p}</Badge>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {preview.findings.length > 0 ? (
        <div className="flex flex-col gap-2" data-testid={`${TID}-findings`}>
          <h3 className="text-label font-semibold text-fg">
            Achados <span className="font-normal text-fg-muted">({fmtInt(errorFindings)} erro(s), {fmtInt(preview.findings.length - errorFindings)} aviso(s) — primeiros {fmtInt(preview.findings.length)})</span>
          </h3>
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Linha</TableHead>
                  <TableHead>Nível</TableHead>
                  <TableHead>Achado</TableHead>
                  <TableHead>Mensagem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.findings.map((f: MtsrImportFinding, i) => {
                  const lv = levelOf(f.level);
                  return (
                    <TableRow key={`${f.row}-${f.code}-${i}`}>
                      <TableCell className="tabular-nums">{f.row}</TableCell>
                      <TableCell><StatusBadge size="sm" status={lv.tone}>{lv.label}</StatusBadge></TableCell>
                      <TableCell className="font-medium">{findingLabel(f.code)}</TableCell>
                      <TableCell className="text-fg-muted">{f.message}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </div>
      ) : null}

      <div className="flex flex-col gap-2" data-testid={`${TID}-sample`}>
        <h3 className="text-label font-semibold text-fg">Amostra <span className="font-normal text-fg-muted">(primeiras {fmtInt(preview.sample.length)} linhas)</span></h3>
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Linha</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Placa</TableHead>
                <TableHead>Frota</TableHead>
                <TableHead>Última vistoria</TableHead>
                <TableHead>Componentes</TableHead>
                <TableHead>Achado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.sample.length === 0 ? (
                <TableEmpty colSpan={7} message="Sem linhas." />
              ) : (
                preview.sample.map((s) => {
                  const st = rowStatus(s.status);
                  return (
                    <TableRow key={s.row}>
                      <TableCell className="tabular-nums">{s.row}</TableCell>
                      <TableCell><StatusBadge size="sm" status={st.tone}>{st.label}</StatusBadge></TableCell>
                      <TableCell className="font-medium tabular-nums">{s.licensePlate ?? "—"}</TableCell>
                      <TableCell className="tabular-nums text-fg-muted">{s.fleetCode ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{formatDate(s.lastInspectionDate)}</TableCell>
                      <TableCell className="text-fg-muted">{componentsText(s.components, componentName)}</TableCell>
                      <TableCell className="text-fg-muted">{findingLabel(s.code)}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-end">
        <p className="text-caption text-fg-muted sm:mr-auto" data-testid={`${TID}-preview-note`}>
          {usable > 0
            ? `${fmtInt(usable)} linha(s) serão aplicadas pela fonte Importação manual. Avisos não bloqueiam; ${fmtInt(preview.errorRows)} linha(s) com erro ficam de fora.`
            : "Nenhuma linha aproveitável: corrija a planilha e envie de novo."}
        </p>
        <Button
          leadingIcon={<FileCheck2 />}
          onClick={onConfirm}
          loading={busy && saving}
          disabled={busy || usable === 0}
          data-testid={`${TID}-confirm`}
        >
          {saveStarted ? "Continuar gravação" : "Confirmar importação"}
        </Button>
      </div>
    </section>
  );
}

function ColumnChips({ label, items, variant, empty }: { label: string; items: string[]; variant: "primary" | "info" | "neutral"; empty?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption font-semibold text-fg-secondary">{label}</span>
      {items.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={label}>
          {items.map((h) => (
            <li key={h}>
              <Badge variant={variant} appearance={variant === "neutral" ? "outline" : "soft"} size="md">{h}</Badge>
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-caption text-fg-muted">{empty ?? "—"}</span>
      )}
    </div>
  );
}

function componentsText(components: Record<string, string>, names: Map<string, string>): string {
  const entries = Object.entries(components);
  if (!entries.length) return "—";
  return entries.map(([code, status]) => `${names.get(code) ?? code}: ${COMPONENT_STATUS_LABEL[status as keyof typeof COMPONENT_STATUS_LABEL] ?? status}`).join(" · ");
}

// ---------------------------------------------------------------------------
// (d) Resultado
// ---------------------------------------------------------------------------
function OutcomeCard({ outcome, fileName, onReset }: { outcome: MtsrImportOutcome; fileName: string | null; onReset: () => void }) {
  return (
    <section
      aria-labelledby={`${TID}-outcome-titulo`}
      className="flex flex-col gap-3 rounded-lg border border-success/30 bg-success-soft p-4"
      data-testid={`${TID}-outcome`}
    >
      <div className="flex flex-wrap items-start gap-2">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id={`${TID}-outcome-titulo`} className="text-h4 font-semibold text-success-soft-fg">Importação concluída</h2>
          <p className="truncate text-body-sm text-success-soft-fg" title={fileName ?? undefined}>
            {fileName ?? "Planilha de conformidade"} — {fmtInt(outcome.rows)} linha(s) processadas pela fonte Importação manual.
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Aplicadas" value={outcome.applied} tone="success" hint="Estado oficial atualizado" testId={`${TID}-outcome-applied`} />
        <Stat label="Ignoradas" value={outcome.ignored} hint="Leitura mais antiga ou sem mudança" />
        <Stat label="Conflitos" value={outcome.conflict} tone="warning" hint="Fonte de maior prioridade na mesma data" />
        <Stat label="Rejeitadas" value={outcome.rejected} tone="danger" hint="Veículo, componente, status ou data" />
        <Stat label="Duplicadas" value={outcome.duplicate} hint="Já recebidas (mesmo hash)" />
        <Stat label="Datas de vistoria" value={outcome.facts} tone="primary" hint="Última vistoria válida avançada" />
      </dl>
      <div className="text-caption text-success-soft-fg">
        <p className="font-medium">Como o banco decidiu cada leitura</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li>Prioridade de fonte: vistoria de campo &gt; backoffice &gt; importação. Na mesma data, uma fonte melhor não é sobrescrita (conflito).</li>
          <li>Uma leitura com data anterior à atual do componente não sobrescreve (ignorada, motivo &ldquo;leitura mais antiga&rdquo;); mesma data, mesma fonte e mesmo status é &ldquo;sem mudança&rdquo;.</li>
          <li>A última vistoria válida só avança: datas anteriores à registrada não a alteram.</li>
          <li>O hash de cada leitura evita duplicar; tudo fica no histórico de ingestão e na auditoria (evento IMPORTAÇÃO).</li>
        </ul>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" leadingIcon={<Upload />} onClick={onReset} data-testid={`${TID}-new`}>
          Importar outra planilha
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// (e) Histórico de lotes
// ---------------------------------------------------------------------------
const BATCH_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  draft: { label: "Rascunho", tone: "pending" },
  validated: { label: "Prévia pronta", tone: "info" },
  processing: { label: "Gravando", tone: "progress" },
  completed: { label: "Concluído", tone: "success" },
  failed: { label: "Falhou", tone: "danger" },
  cancelled: { label: "Cancelado", tone: "neutral" },
};
const batchStatus = (s: string) => BATCH_STATUS[s] ?? { label: s || "—", tone: "neutral" as StatusTone };

function statsOf(summary: Record<string, unknown> | null): { applied: number; ignored: number; conflict: number; rejected: number; duplicate: number } | null {
  const s = summary?.stats;
  if (!s || typeof s !== "object") return null;
  const r = s as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
  return { applied: n(r.applied), ignored: n(r.ignored), conflict: n(r.conflict), rejected: n(r.rejected), duplicate: n(r.duplicate) };
}

function HistorySection({ imports }: { imports: MtsrImportBatch[] }) {
  return (
    <section aria-labelledby={`${TID}-history-titulo`} className="flex flex-col gap-3" data-testid={`${TID}-history`}>
      <SectionHeader
        headingLevel={2}
        icon={<History />}
        title={<span id={`${TID}-history-titulo`}>Histórico de importações</span>}
        description="Os lotes mais recentes de conformidade: arquivo, quem enviou, situação, totais e o resumo da ingestão."
      />
      <TableContainer>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Arquivo</TableHead>
              <TableHead>Quando</TableHead>
              <TableHead>Por quem</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Linhas</TableHead>
              <TableHead>Resumo da ingestão</TableHead>
              <TableHead>Erros</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {imports.length === 0 ? (
              <TableEmpty colSpan={7} message="Nenhuma importação de conformidade registrada ainda. A primeira planilha confirmada aparece aqui." />
            ) : (
              imports.map((b) => {
                const st = batchStatus(b.status);
                const stats = statsOf(b.summary);
                return (
                  <TableRow key={b.id}>
                    <TableCell className="max-w-56 truncate font-medium" title={b.fileName ?? undefined}>{b.fileName ?? "Planilha de conformidade"}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatStamp(b.createdAt)}
                      {b.processedAt ? <span className="block text-caption text-fg-muted">concluído {formatStamp(b.processedAt)}</span> : null}
                    </TableCell>
                    <TableCell className="text-fg-muted">{b.createdByName ?? "—"}</TableCell>
                    <TableCell><StatusBadge size="sm" status={st.tone}>{st.label}</StatusBadge></TableCell>
                    <TableCell className="whitespace-nowrap text-caption tabular-nums">
                      {fmtInt(b.totalRows)} total · {fmtInt(b.validRows)} válidas · {fmtInt(b.warningRows)} avisos · {fmtInt(b.errorRows)} erros
                      {b.updatedRows != null ? <span className="block text-fg-muted">{fmtInt(b.updatedRows)} com efeito · {fmtInt(b.skippedRows)} sem efeito</span> : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-caption tabular-nums">
                      {stats
                        ? `${fmtInt(stats.applied)} aplicadas · ${fmtInt(stats.ignored)} ignoradas · ${fmtInt(stats.conflict)} conflitos · ${fmtInt(stats.rejected)} rejeitadas · ${fmtInt(stats.duplicate)} duplicadas`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {b.errorMessage ? <p className="text-caption text-danger">{b.errorMessage}</p> : null}
                      {b.errors.length ? (
                        <details className="group/err">
                          <summary className="cursor-pointer list-none text-caption font-medium text-fg hfm-focus-ring rounded-xs">
                            {fmtInt(b.errors.length)} achado(s) <span className="text-fg-muted group-open/err:hidden">· ver</span>
                          </summary>
                          <ul className="mt-1 max-h-40 overflow-auto text-caption text-fg-muted">
                            {b.errors.map((e, i) => {
                              const lv = levelOf(e.level);
                              return (
                                <li key={`${e.row}-${i}`}>
                                  <span className="tabular-nums">L{e.row}</span> · {lv.label}: {e.message}
                                </li>
                              );
                            })}
                          </ul>
                        </details>
                      ) : !b.errorMessage ? (
                        <span className="text-caption text-fg-muted">—</span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Peças
// ---------------------------------------------------------------------------
type StatTone = "neutral" | "primary" | "success" | "warning" | "danger";
const STAT_VALUE: Record<StatTone, string> = {
  neutral: "text-fg",
  primary: "text-primary-soft-fg",
  success: "text-success-soft-fg",
  warning: "text-warning-soft-fg",
  danger: "text-danger",
};

/** Contador compacto: o tom de alerta só acende com valor > 0; o rótulo sempre diz o que é. */
function Stat({ label, value, tone = "neutral", hint, testId }: { label: string; value: number | string; tone?: StatTone; hint?: string; testId?: string }) {
  const numeric = typeof value === "number" ? value : null;
  const lit = tone === "warning" || tone === "danger" ? (numeric ?? 1) > 0 : true;
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-border bg-surface px-3 py-2" data-testid={testId}>
      <dt className="truncate text-caption text-fg-muted" title={label}>{label}</dt>
      <dd className={cn("font-semibold tabular-nums", numeric !== null ? "text-h3" : "text-body", lit ? STAT_VALUE[tone] : "text-fg")}>
        {numeric !== null ? fmtInt(numeric) : value}
      </dd>
      {hint ? <dd className="truncate text-caption text-fg-muted" title={hint}>{hint}</dd> : null}
    </div>
  );
}

const sizeFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${sizeFmt.format(bytes / 1024)} KB`;
  return `${sizeFmt.format(bytes / (1024 * 1024))} MB`;
}
