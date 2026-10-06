"use client";

import * as React from "react";
import {
  Ban, BookOpen, Check, CheckCircle2, ChevronRight, FileCheck2, FileSpreadsheet, History, RefreshCw, ShieldCheck, Upload, X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { ImportProgress } from "@/components/feedback/import-progress";
import { useToast } from "@/components/feedback/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { FormField } from "@/components/ui/form-field";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/governance/selects";
import { cancelTireImport, confirmTireImport, validateTireImport } from "@/lib/tires/actions";
import {
  readRodoparFile, TIRE_IMPORT_STAGE_LABEL, uploadRodoparImport, type TireImportProgress, type TireImportStage,
} from "@/lib/tires/import-client";
import type { TiresTabData } from "@/lib/tires/loaders";
import { RODOPAR_FIELD_LABEL, RODOPAR_REQUIRED_COLUMNS, type RodoparRead } from "@/lib/tires/rodopar-sheet";
import {
  BATCH_STATUS_LABEL, BATCH_STATUS_TONE, CHANGE_LABEL, ERROR_ISSUES, fmtInt, fmtMm, fmtNum, fmtPsi, formatDate, formatStamp,
  issueCode, issueLabel, STATUS_LABEL, STATUS_ORDER, STATUS_TONE,
  type CanonicalStatus, type ImportPreviewSection, type TireImportAbsentRow, type TireImportBatch, type TireImportHistory,
  type TireImportPreview, type TireImportPreviewRow,
} from "@/lib/tires/types";
import type { TiresPanelContext } from "../shared";
import {
  chartColorOf, FireLink, PanelEmpty, PanelError, PlateLink, plural, Section, TiresKpi, TiresPagination, useTiresLink, vehicleName,
} from "./tires-ui";

/**
 * Gestão de Pneus → Importação Rodopar.
 *
 * LER (navegador) → VALIDAR → COMPARAR → PRÉVIA → CONFIRMAR → ATUALIZAR
 * FOTOGRAFIA → HISTÓRICO. O navegador só lê o XLSX e envia as células; toda
 * regra (Nº Fogo como texto, situação canônica, limites técnicos, frota,
 * comparação, ausentes, bloqueio) é das rotinas `tire_import_*`. A prévia é
 * lida no servidor (`?lote=&secao=&filtro=&pagina=`) e nada entra no cadastro
 * antes da confirmação, que revalida tudo numa única transação.
 */
const TID = "tires-import";
type ImportData = NonNullable<TiresTabData["importacao"]>;
type Nav = ReturnType<typeof useTiresLink>;

export function ImportPanel({ data, ctx }: { data: TiresTabData["importacao"] | null; ctx: TiresPanelContext }) {
  if (ctx.error) return <PanelError ctx={ctx} title="Não foi possível carregar a importação Rodopar." testId={`${TID}-error`} />;
  if (!data) {
    return (
      <PanelEmpty
        icon={<FileSpreadsheet />}
        title="Sem dados da importação"
        description="A leitura do histórico de lotes não devolveu resultado. Recarregue a página."
        testId={`${TID}-empty`}
      />
    );
  }
  return <ImportContent data={data} ctx={ctx} />;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
/** Data/hora "de parede" do Rodopar (sem fuso): exibida como veio. */
function fmtWall(ts: string | null | undefined): string {
  if (!ts) return "—";
  const m = ts.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return ts;
  return m[4] && !(m[4] === "00" && m[5] === "00") ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : `${m[3]}/${m[2]}/${m[1]}`;
}

/** Hoje em São Paulo (aaaa-mm-dd). Só orienta o formulário; quem decide é o banco. */
function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const sizeFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
function fmtBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${sizeFmt.format(bytes / 1024)} KB`;
  return `${sizeFmt.format(bytes / (1024 * 1024))} MB`;
}

const fieldLabel = (key: string) => RODOPAR_FIELD_LABEL[key] ?? key;
const REQUIRED = new Set<string>(RODOPAR_REQUIRED_COLUMNS);

/** Contadores chegam camelizados (`emUso`, `kmRealNegativo`): volta ao código do banco. */
const counterEntries = (record: Record<string, number> | undefined) =>
  Object.entries(record ?? {}).map(([key, count]) => ({ code: issueCode(key), count: Number(count) || 0 }));

const ROW_SEVERITY: Record<TireImportPreviewRow["severity"], { label: string; tone: StatusTone }> = {
  error: { label: "Erro — bloqueia", tone: "danger" },
  warning: { label: "Aviso", tone: "warning" },
  ok: { label: "Sem problema", tone: "success" },
  pending: { label: "Não validada", tone: "pending" },
};
const ROW_ACTION: Record<NonNullable<TireImportPreviewRow["action"]>, { label: string; tone: StatusTone }> = {
  new: { label: "Novo", tone: "info" },
  updated: { label: "Atualizado", tone: "progress" },
  unchanged: { label: "Sem mudança", tone: "neutral" },
};

const SECTION_LABEL: Record<ImportPreviewSection, string> = {
  issues: "Problemas",
  changes: "Mudanças",
  new: "Novos",
  rows: "Todas as linhas",
  absent: "Ausentes",
  reappeared: "Reaparecidos",
};
const SECTIONS: ImportPreviewSection[] = ["issues", "changes", "new", "rows", "absent", "reappeared"];
const CHANGE_KEYS = Object.keys(CHANGE_LABEL);

const statusLabel = (s: string | null | undefined) => (s ? (STATUS_LABEL[s as CanonicalStatus] ?? s) : "—");

// ---------------------------------------------------------------------------
// Conteúdo
// ---------------------------------------------------------------------------
function ImportContent({ data, ctx }: { data: ImportData; ctx: TiresPanelContext }) {
  const { history, preview, previewError } = data;
  const link = useTiresLink(ctx);
  const [uploadStage, setUploadStage] = React.useState<TireImportStage | null>(null);
  const [fileReady, setFileReady] = React.useState(false);
  const canImport = ctx.perms.import;
  const requestedBatch = ctx.params.lote ?? null;
  const waiting = history.rows.filter((b) => (b.status === "validated" || b.status === "blocked" || b.status === "staging") && b.id !== preview?.batch.id);

  return (
    <div className="flex flex-col gap-5" data-testid={TID}>
      <PipelineSteps stage={uploadStage} fileReady={fileReady} batch={preview?.batch ?? null} />

      {/* Celular e tablet (e quem não envia arquivos): as regras ficam num bloco expansível. */}
      <details
        className={cn("group rounded-lg border border-border bg-surface-raised", canImport && "xl:hidden")}
        data-testid={`${TID}-rules-expandable`}
      >
        <summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg px-4 py-3 hfm-focus-ring">
          <BookOpen className="size-4 shrink-0 text-fg-muted" aria-hidden />
          <span className="flex min-w-0 flex-col">
            <span className="text-body-sm font-semibold text-fg">Regras da importação</span>
            <span className="text-caption text-fg-muted">Nº Fogo, situação, data de referência, ausentes e arquivos repetidos</span>
          </span>
          <ChevronRight className="ml-auto size-4 shrink-0 text-fg-muted transition-transform group-open:rotate-90" aria-hidden />
        </summary>
        <div className="border-t border-border px-4 py-3">
          <RulesContent latest={history.latestReferenceDate} columns />
        </div>
      </details>

      {requestedBatch && canImport && !preview ? (
        <Alert variant="warning" data-testid={`${TID}-batch-missing`}>
          <AlertTitle>{previewError ? "Não foi possível abrir o lote" : "Lote não encontrado"}</AlertTitle>
          <AlertDescription>
            {previewError ?? "O lote indicado no endereço não existe nesta organização."} Escolha um lote no histórico abaixo.
          </AlertDescription>
        </Alert>
      ) : null}

      {waiting.length > 0 && canImport ? (
        <Alert variant="info" data-testid={`${TID}-waiting`}>
          <AlertTitle>
            {fmtInt(waiting.length)} {plural(waiting.length, "lote aguardando decisão", "lotes aguardando decisão")}
          </AlertTitle>
          <AlertDescription>
            <ul className="mt-1 flex flex-col gap-1">
              {waiting.slice(0, 3).map((b) => {
                const nav = link({ lote: b.id, secao: "issues", filtro: null });
                return (
                  <li key={b.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <a href={nav.href} onClick={nav.onClick} className="break-all rounded-xs font-medium underline underline-offset-2 hfm-focus-ring">
                      {b.fileName}
                    </a>
                    <span className="text-caption">referência {formatDate(b.referenceDate)} · {BATCH_STATUS_LABEL[b.status]}</span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-1 text-caption">Confirme ou descarte cada lote: um lote aberto não altera nada, mas fica no histórico até a decisão.</p>
          </AlertDescription>
        </Alert>
      ) : null}

      {preview ? <PreviewSection preview={preview} ctx={ctx} canImport={canImport} /> : null}

      {canImport ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]">
          <UploadSection
            ctx={ctx}
            latest={history.latestReferenceDate}
            compact={Boolean(preview)}
            onStage={setUploadStage}
            onFileReady={setFileReady}
          />
          {/* Painel lateral: a altura é a do formulário; as regras rolam por dentro. */}
          <aside className="relative hidden min-h-0 xl:block" aria-labelledby={`${TID}-rules-title`} data-testid={`${TID}-rules`}>
            <div className="flex flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-surface-raised p-4 shadow-card xl:absolute xl:inset-0">
              <h2 id={`${TID}-rules-title`} className="flex items-center gap-2 text-h4 font-semibold text-fg">
                <BookOpen className="size-4 text-fg-muted" aria-hidden />
                Regras da importação
              </h2>
              <RulesContent latest={history.latestReferenceDate} />
            </div>
          </aside>
        </div>
      ) : (
        <Alert variant="neutral" icon={<ShieldCheck />} data-testid={`${TID}-no-permission`}>
          <AlertTitle>Envio de arquivos restrito</AlertTitle>
          <AlertDescription>
            Importar o relatório Rodopar 10 exige a permissão <strong>tires.import</strong>. Você acompanha o histórico de lotes abaixo; peça o acesso ao
            administrador em Administração › Perfis &amp; Permissões.
          </AlertDescription>
        </Alert>
      )}

      <HistorySection history={history} ctx={ctx} canOpen={canImport} openId={preview?.batch.id ?? null} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Etapas do fluxo
// ---------------------------------------------------------------------------
type StepState = "done" | "current" | "blocked" | "todo";
const STEPS: { key: string; label: string; hint: string }[] = [
  { key: "ler", label: "Ler", hint: "XLSX lido no navegador" },
  { key: "validar", label: "Validar", hint: "Regras por linha, no banco" },
  { key: "comparar", label: "Comparar", hint: "Com a fotografia anterior" },
  { key: "previa", label: "Prévia", hint: "Conferência paginada" },
  { key: "confirmar", label: "Confirmar", hint: "Uma única transação" },
  { key: "fotografia", label: "Atualizar fotografia", hint: "Fotografia oficial e eventos" },
  { key: "historico", label: "Histórico", hint: "Lote registrado" },
];
const STATE_LABEL: Record<StepState, string> = { done: "concluída", current: "em andamento", blocked: "bloqueada", todo: "pendente" };

function stepStates(stage: TireImportStage | null, fileReady: boolean, batch: TireImportBatch | null): StepState[] {
  const states: StepState[] = STEPS.map(() => "todo");
  const upTo = (n: number, current: StepState = "current") => {
    for (let i = 0; i < n; i++) states[i] = "done";
    if (n < states.length) states[n] = current;
  };
  if (stage) {
    upTo(stage === "reading" ? 0 : stage === "sending" ? 1 : 2);
  } else if (batch) {
    if (batch.status === "confirmed") states.fill("done");
    else if (batch.status === "validated") upTo(3);
    else if (batch.status === "blocked") {
      upTo(3);
      states[4] = "blocked";
    } else if (batch.status === "staging") upTo(1);
    else upTo(4, "blocked");
  } else if (fileReady) {
    upTo(1);
  } else {
    upTo(0);
  }
  return states;
}

function PipelineSteps({ stage, fileReady, batch }: { stage: TireImportStage | null; fileReady: boolean; batch: TireImportBatch | null }) {
  const states = stepStates(stage, fileReady, batch);
  return (
    <nav aria-label="Etapas da importação Rodopar" data-testid={`${TID}-steps`}>
      <ol className="flex flex-wrap items-stretch gap-1.5">
        {STEPS.map((s, i) => {
          const st = states[i];
          return (
            <li
              key={s.key}
              aria-current={st === "current" ? "step" : undefined}
              data-state={st}
              title={s.hint}
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-md border px-2.5 py-1.5 text-body-sm max-sm:px-1.5",
                st === "done" && "border-success-border bg-success-soft text-success-soft-fg",
                st === "current" && "border-border-emphasis bg-primary-soft font-semibold text-primary-soft-fg",
                st === "blocked" && "border-danger-border bg-danger-soft text-danger-soft-fg",
                st === "todo" && "border-border bg-surface-raised text-fg-muted",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-caption font-semibold tabular-nums",
                  st === "done" && "bg-success text-success-fg",
                  st === "current" && "bg-primary text-primary-fg",
                  st === "blocked" && "bg-danger text-danger-fg",
                  st === "todo" && "border border-border-strong text-fg-muted",
                )}
              >
                {st === "done" ? <Check className="size-3" /> : st === "blocked" ? <X className="size-3" /> : i + 1}
              </span>
              <span className={cn("whitespace-nowrap", st !== "current" && st !== "blocked" && "max-sm:sr-only")}>{s.label}</span>
              <span className="sr-only">: {s.hint} — etapa {STATE_LABEL[st]}</span>
            </li>
          );
        })}
      </ol>
      {stage ? (
        <p className="mt-1.5 text-caption text-fg-muted" aria-live="polite">{TIRE_IMPORT_STAGE_LABEL[stage]}…</p>
      ) : null}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Regras
// ---------------------------------------------------------------------------
function RulesContent({ latest, columns = false }: { latest: string | null; columns?: boolean }) {
  return (
    <div className={cn("text-body-sm text-fg-secondary", columns ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3" : "flex flex-col gap-3")}>
      <Rule title="Nº Fogo é texto">
        O identificador do pneu nunca vira número: zeros à esquerda e códigos com letras são preservados e exibidos exatamente como no Rodopar.
      </Rule>
      <Rule title="Situação canônica">
        A coluna Situação Pneu define a situação técnica: USO → Em uso, ESTOQUE → Estoque, DESCARTE → Descartado, BAIXADO → Baixado, recapagem →
        Ressolagem. Valor desconhecido vira Outro, com aviso. A coluna Condição (APROPRIADO/ALERTA/RECAPAR) é recomendação e não muda a situação.
      </Rule>
      <Rule title="Data de referência ≠ data de cadastro">
        A data de referência é o dia que a fotografia representa — sugerida pela maior Data Última Alteração do arquivo. Não é a data de cadastro do
        pneu no Rodopar nem a data do envio. Não pode ser futura e precisa ser posterior à última fotografia
        {latest ? <> ({formatDate(latest)})</> : null}.
      </Rule>
      <Rule title="Ausentes não são excluídos">
        Pneu que estava na fotografia anterior e não veio no relatório fica no cadastro com a última fotografia conhecida e recebe o evento “Ausente no
        relatório”. Se voltar, recebe “Voltou ao relatório”.
      </Rule>
      <Rule title="O mesmo arquivo não entra duas vezes">
        Cada arquivo é reconhecido pela assinatura SHA-256 do conteúdo: um arquivo já confirmado é recusado, e confirmar de novo não duplica nada.
      </Rule>
      <Rule title="O que bloqueia a confirmação">
        Linha sem Nº Fogo ou com caracteres inválidos, Nº Fogo duplicado no arquivo, dois pneus em uso na mesma frota e posição, colunas oficiais
        ausentes. Avisos não bloqueiam: o valor inválido é ignorado e o problema fica registrado.
      </Rule>
      <Rule title="Vistoria de campo não altera a base">
        Só o Rodopar muda a fotografia oficial. Na confirmação, as vistorias pendentes de lançamento são conciliadas com a nova fotografia.
      </Rule>
    </div>
  );
}

function Rule({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h3 className="text-label font-semibold text-fg">{title}</h3>
      <p className="text-caption leading-relaxed text-fg-muted">{children}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Envio: ler no navegador → validar no banco
// ---------------------------------------------------------------------------
type ReadState = { status: "idle" } | { status: "reading" } | { status: "ok"; data: RodoparRead } | { status: "error"; error: string };
interface UploadError {
  message: string;
  code: string | null;
  stage: TireImportStage;
  batchId: string | null;
}

function UploadSection({
  ctx, latest, compact, onStage, onFileReady,
}: {
  ctx: TiresPanelContext;
  latest: string | null;
  compact: boolean;
  onStage: (stage: TireImportStage | null) => void;
  onFileReady: (ready: boolean) => void;
}) {
  const { toast } = useToast();
  const today = React.useMemo(() => todayIso(), []);
  const minDate = latest ? addDays(latest, 1) : undefined;
  const [file, setFile] = React.useState<File | null>(null);
  const [read, setRead] = React.useState<ReadState>({ status: "idle" });
  const [referenceDate, setReferenceDate] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [progress, setProgress] = React.useState<TireImportProgress | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<UploadError | null>(null);
  const current = React.useRef<File | null>(null);
  const stageRef = React.useRef<TireImportStage>("reading");

  const pick = async (f: File | null) => {
    current.current = f;
    setFile(f);
    setError(null);
    setTouched(false);
    if (!f) {
      setRead({ status: "idle" });
      setReferenceDate("");
      onFileReady(false);
      return;
    }
    setRead({ status: "reading" });
    onFileReady(false);
    const r = await readRodoparFile(f);
    if (current.current !== f) return;
    if (r.ok) {
      setRead({ status: "ok", data: r.data });
      setReferenceDate(r.data.meta.suggested_reference_date ?? "");
      onFileReady(r.data.missingRequired.length === 0);
    } else {
      setRead({ status: "error", error: r.error });
    }
  };

  const dateError = !referenceDate
    ? "Informe a data de referência da fotografia."
    : referenceDate > today
      ? "A data de referência não pode ser futura."
      : latest && referenceDate <= latest
        ? `Já existe fotografia confirmada em ${formatDate(latest)}. A data de referência precisa ser posterior.`
        : null;
  const ready = read.status === "ok" && read.data.missingRequired.length === 0 && read.data.rows.length > 0;

  const onProgress = (p: TireImportProgress | null) => {
    setProgress(p);
    if (p) {
      stageRef.current = p.stage;
      onStage(p.stage);
    }
  };

  const validate = async () => {
    setTouched(true);
    if (!file || !ready || dateError || busy) return;
    setBusy(true);
    setError(null);
    stageRef.current = "reading";
    try {
      const r = await uploadRodoparImport(file, referenceDate, onProgress);
      if (r.ok) {
        const blocked = r.batch.status === "blocked";
        toast({
          title: blocked ? "Arquivo validado com bloqueio" : "Arquivo validado",
          description: `${fmtInt(r.batch.totalRows)} ${plural(r.batch.totalRows, "linha", "linhas")} · ${BATCH_STATUS_LABEL[r.batch.status]}. Confira a prévia: nada foi gravado no cadastro.`,
          variant: blocked ? "warning" : "success",
        });
        current.current = null;
        setFile(null);
        setRead({ status: "idle" });
        setReferenceDate("");
        setTouched(false);
        onFileReady(false);
        ctx.navigate({ lote: r.batch.id, secao: "issues", filtro: null, pagina: null });
      } else {
        setError({ message: r.error, code: r.code ?? null, stage: r.stage, batchId: r.batchId ?? null });
      }
    } catch {
      setError({
        message: "A conexão com o servidor caiu. Verifique a internet e valide de novo.",
        code: null,
        stage: stageRef.current,
        batchId: null,
      });
    } finally {
      setProgress(null);
      setBusy(false);
      onStage(null);
    }
  };

  const meta = read.status === "ok" ? read.data.meta : null;

  return (
    <section
      aria-labelledby={`${TID}-upload-title`}
      aria-busy={busy}
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface-raised p-4 shadow-card"
      data-testid={`${TID}-upload`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={`${TID}-upload-title`} className="flex items-center gap-2 text-h4 font-semibold text-fg">
            <Upload className="size-4 text-fg-muted" aria-hidden />
            {compact ? "Enviar outro relatório Rodopar 10" : "Enviar o relatório Rodopar 10"}
          </h2>
          <p className="max-w-[90ch] text-caption text-fg-muted">
            O arquivo é lido no seu navegador; o banco valida, compara com a fotografia anterior e monta a prévia.{" "}
            <strong className="font-semibold text-fg-secondary">Nada é gravado no cadastro de pneus antes de você confirmar.</strong>
          </p>
        </div>
        {latest ? (
          <Badge variant="neutral" appearance="outline" size="md">Última fotografia: {formatDate(latest)}</Badge>
        ) : (
          <Badge variant="info" size="md">Nenhuma fotografia confirmada ainda</Badge>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <Dropzone file={file} disabled={busy} onFile={(f) => void pick(f)} />
        <div className="flex flex-col gap-2">
          <FormField
            label="Data de referência"
            required
            error={(touched || referenceDate) && dateError ? dateError : undefined}
            helperText={
              meta?.suggested_reference_date
                ? `Sugerida: ${formatDate(meta.suggested_reference_date)} — maior data de atualização do arquivo (Data Última Alteração).`
                : "O dia que a fotografia representa. Não é a data de cadastro do pneu."
            }
            disabled={busy}
          >
            <DateInput
              value={referenceDate}
              min={minDate}
              max={today}
              disabled={busy}
              onChange={(e) => setReferenceDate(e.currentTarget.value)}
              onBlur={() => setTouched(true)}
              data-testid={`${TID}-reference-date`}
            />
          </FormField>
          {meta?.suggested_reference_date && referenceDate && referenceDate !== meta.suggested_reference_date ? (
            <Button
              size="sm"
              variant="ghost"
              className="self-start"
              onClick={() => setReferenceDate(meta.suggested_reference_date ?? "")}
              disabled={busy}
            >
              Usar a data sugerida ({formatDate(meta.suggested_reference_date)})
            </Button>
          ) : null}
        </div>
      </div>

      {read.status === "reading" ? (
        <p className="text-body-sm text-fg-muted" aria-live="polite" data-testid={`${TID}-reading`}>Lendo o arquivo no navegador…</p>
      ) : null}
      {read.status === "error" ? (
        <Alert variant="danger" data-testid={`${TID}-read-error`}>
          <AlertTitle>Arquivo não reconhecido</AlertTitle>
          <AlertDescription>{read.error}</AlertDescription>
        </Alert>
      ) : null}
      {read.status === "ok" ? <LocalRead read={read.data} /> : null}

      <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center">
        <p className="text-caption text-fg-muted sm:mr-auto">
          Validar envia as linhas para a área de preparação do lote e devolve a prévia. A confirmação é um passo separado.
        </p>
        <Button
          leadingIcon={<FileCheck2 />}
          onClick={() => void validate()}
          loading={busy}
          disabled={!ready || busy || (touched && Boolean(dateError))}
          data-testid={`${TID}-validate`}
        >
          Validar arquivo
        </Button>
      </div>

      {progress ? (
        <div className="flex flex-col gap-1" data-testid={`${TID}-progress`}>
          <p className="text-caption font-medium text-fg-secondary">{TIRE_IMPORT_STAGE_LABEL[progress.stage]}</p>
          <ImportProgress progress={{ phase: progress.stage, done: progress.done, total: progress.total }} />
        </div>
      ) : null}

      {error ? <UploadErrorAlert error={error} ctx={ctx} /> : null}
    </section>
  );
}

function UploadErrorAlert({ error, ctx }: { error: UploadError; ctx: TiresPanelContext }) {
  if (error.code === "tire_duplicate_file") {
    return (
      <Alert variant="warning" data-testid={`${TID}-duplicate`}>
        <AlertTitle>Este arquivo já foi importado</AlertTitle>
        <AlertDescription>
          <p>{error.message}</p>
          <p className="mt-1">
            A importação é idempotente: o mesmo arquivo (mesma assinatura SHA-256) nunca vira duas fotografias. Para atualizar a base, exporte um relatório
            novo do Rodopar.
          </p>
        </AlertDescription>
      </Alert>
    );
  }
  if (error.code === "tire_reference_not_after_latest") {
    return (
      <Alert variant="warning" data-testid={`${TID}-reference-error`}>
        <AlertTitle>A data de referência precisa ser posterior à última fotografia</AlertTitle>
        <AlertDescription>
          <p>{error.message}</p>
          <p className="mt-1">Ajuste a data de referência e valide de novo. Uma fotografia confirmada não é substituída.</p>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="danger" data-testid={`${TID}-upload-error`}>
      <AlertTitle>Não foi possível validar o arquivo</AlertTitle>
      <AlertDescription>
        <p>{error.message}</p>
        <p className="mt-1 text-caption">Etapa: {TIRE_IMPORT_STAGE_LABEL[error.stage]}.</p>
        {error.batchId ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-caption">O lote ficou aberto e não alterou nada. Abra-o para validar de novo ou descartar.</span>
            <Button size="sm" variant="outline" onClick={() => ctx.navigate({ lote: error.batchId, secao: "issues", filtro: null, pagina: null })}>
              Abrir o lote
            </Button>
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

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
    <div className="flex min-w-0 flex-col gap-2">
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
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-7 text-center hfm-transition",
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
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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
          Arraste o XLSX aqui ou <span className="text-link underline underline-offset-4">escolha no computador</span>
        </span>
        <span id={hintId} className="text-caption text-fg-muted">
          Relatório Rodopar 10 (pneus) exportado em .xlsx, sem editar. Lido no navegador e enviado em partes.
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

/** O que a leitura local encontrou: aba, cabeçalho, janela e colunas. */
function LocalRead({ read }: { read: RodoparRead }) {
  const { meta, missingRequired } = read;
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3" data-testid={`${TID}-local-read`}>
      <h3 className="text-label font-semibold text-fg">Leitura local do arquivo</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
        <Fact label="Aba">{meta.sheet_name}</Fact>
        <Fact label="Linha do cabeçalho">{fmtInt(meta.header_row)}</Fact>
        <Fact label="Janela oficial">
          {meta.window_start} → {meta.window_end}
        </Fact>
        <Fact label="Linhas de pneus">{fmtInt(meta.total_rows)}</Fact>
        <Fact label="Data sugerida">
          {meta.suggested_reference_date ? formatDate(meta.suggested_reference_date) : "—"}
          <span className="block text-caption text-fg-muted">maior data de atualização</span>
        </Fact>
      </dl>
      {missingRequired.length > 0 ? (
        <Alert variant="danger" data-testid={`${TID}-missing-columns`}>
          <AlertTitle>Colunas obrigatórias ausentes — o arquivo não pode ser validado</AlertTitle>
          <AlertDescription>
            <ChipList items={missingRequired.map(fieldLabel)} variant="danger" label="Colunas obrigatórias ausentes" />
            <p className="mt-1.5">Exporte de novo o relatório Rodopar 10 completo, sem remover colunas.</p>
          </AlertDescription>
        </Alert>
      ) : null}
      <ColumnGroups recognized={meta.recognized_columns} unrecognized={meta.unrecognized_columns} ignored={meta.ignored_columns} />
    </div>
  );
}

function ColumnGroups({ recognized, unrecognized, ignored }: { recognized: string[]; unrecognized: string[]; ignored: string[] }) {
  const required = recognized.filter((k) => REQUIRED.has(k));
  const optional = recognized.filter((k) => !REQUIRED.has(k));
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-caption font-semibold text-fg-secondary">
          Reconhecidas ({fmtInt(recognized.length)}) · {fmtInt(required.length)} de {fmtInt(REQUIRED.size)} obrigatórias
        </span>
        <ChipList items={required.map(fieldLabel)} variant="primary" label="Colunas obrigatórias reconhecidas" />
        {optional.length ? (
          <details className="group/cols">
            <summary className="cursor-pointer list-none rounded-xs text-caption font-medium text-link hfm-focus-ring">
              <span className="group-open/cols:hidden">Ver as outras {fmtInt(optional.length)} colunas reconhecidas</span>
              <span className="hidden group-open/cols:inline">Ocultar as demais colunas</span>
            </summary>
            <div className="mt-1.5">
              <ChipList items={optional.map(fieldLabel)} variant="info" label="Demais colunas reconhecidas" />
            </div>
          </details>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-caption font-semibold text-fg-secondary">Não reconhecidas na janela ({fmtInt(unrecognized.length)})</span>
        {unrecognized.length ? (
          <ChipList items={unrecognized} variant="warning" label="Colunas não reconhecidas" />
        ) : (
          <span className="text-caption text-fg-muted">nenhuma</span>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-caption font-semibold text-fg-secondary">Ignoradas — fora da janela ({fmtInt(ignored.length)})</span>
        {ignored.length ? (
          <ChipList items={ignored} variant="neutral" label="Colunas ignoradas" />
        ) : (
          <span className="text-caption text-fg-muted">nenhuma (o cabeçalho começa no N.Fogo)</span>
        )}
      </div>
    </div>
  );
}

function ChipList({ items, variant, label }: { items: string[]; variant: "primary" | "info" | "neutral" | "warning" | "danger"; label: string }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={label}>
      {items.map((h, i) => (
        <li key={`${h}-${i}`}>
          <Badge variant={variant} appearance={variant === "neutral" ? "outline" : "soft"} size="sm">{h}</Badge>
        </li>
      ))}
    </ul>
  );
}

function Fact({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="min-w-0 break-words text-body-sm font-medium text-fg tabular-nums">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prévia do lote
// ---------------------------------------------------------------------------
function PreviewSection({ preview, ctx, canImport }: { preview: TireImportPreview; ctx: TiresPanelContext; canImport: boolean }) {
  const link = useTiresLink(ctx);
  const b = preview.batch;
  const counters = b.counters ?? {};
  const open = b.status === "staging" || b.status === "validated" || b.status === "blocked";
  const blockReasons = counters.blockReasons?.length ? counters.blockReasons : b.blockReason ? [b.blockReason] : [];
  const sectionNav = (secao: ImportPreviewSection, filtro: string | null = null) => link({ secao, filtro });
  const comparedWith = b.previousReferenceDate ? `com a fotografia de ${formatDate(b.previousReferenceDate)}` : "sem fotografia anterior (primeira carga)";

  return (
    <section
      aria-labelledby={`${TID}-preview-title`}
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface-raised p-4 shadow-card"
      data-testid={`${TID}-preview`}
      data-status={b.status}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-caption font-semibold uppercase tracking-wide text-fg-muted">Prévia do lote</p>
          <h2 id={`${TID}-preview-title`} className="min-w-0 break-all text-h3 font-semibold text-fg">{b.fileName}</h2>
          <p className="text-body-sm text-fg-secondary">
            Fotografia de <strong className="font-semibold text-fg">{formatDate(b.referenceDate)}</strong> · comparada {comparedWith} · enviada por{" "}
            {b.createdByName ?? "—"} em {formatStamp(b.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={BATCH_STATUS_TONE[b.status]} size="md" withIcon data-testid={`${TID}-batch-status`}>
            {BATCH_STATUS_LABEL[b.status]}
          </StatusBadge>
          <Button size="sm" variant="ghost" leadingIcon={<X />} onClick={() => ctx.navigate({ lote: null, secao: null, filtro: null, pagina: null })} data-testid={`${TID}-close-preview`}>
            Fechar prévia
          </Button>
        </div>
      </div>

      {b.status === "confirmed" ? (
        <Alert variant="success" data-testid={`${TID}-confirmed`}>
          <AlertTitle>Fotografia oficial de {formatDate(b.referenceDate)}</AlertTitle>
          <AlertDescription>
            Confirmada por {b.confirmedByName ?? "—"} em {formatStamp(b.confirmedAt)}. Os números abaixo são os do lote aplicado.
          </AlertDescription>
        </Alert>
      ) : b.status === "cancelled" ? (
        <Alert variant="neutral" data-testid={`${TID}-cancelled`}>
          <AlertTitle>Lote descartado em {formatStamp(b.cancelledAt)}</AlertTitle>
          <AlertDescription>{b.cancelReason ? `Motivo: ${b.cancelReason}. ` : ""}Nenhuma linha deste lote entrou no cadastro.</AlertDescription>
        </Alert>
      ) : (
        <p className="flex items-start gap-2 rounded-md border border-info-border bg-info-soft px-3 py-2 text-body-sm text-info-soft-fg">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          Nada foi gravado no cadastro de pneus: esta prévia vem da área de preparação do lote. Só a confirmação aplica a fotografia.
        </p>
      )}

      {b.status === "blocked" && blockReasons.length ? (
        <Alert variant="danger" data-testid={`${TID}-blocked`}>
          <AlertTitle>Lote bloqueado — não pode ser confirmado</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {blockReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p className="mt-1.5">Corrija no Rodopar, exporte o relatório de novo e envie o novo arquivo. Este lote pode ser descartado.</p>
          </AlertDescription>
        </Alert>
      ) : null}

      {counters.referenceBeforeLastChange ? (
        <Alert variant="warning" data-testid={`${TID}-reference-before`}>
          <AlertTitle>A data de referência é anterior a alterações do próprio arquivo</AlertTitle>
          <AlertDescription>
            O arquivo traz alterações até {fmtWall(counters.maxUpdatedAt)}, depois da data de referência {formatDate(b.referenceDate)}. Confira se a
            data escolhida representa o dia do relatório.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2">
        <h3 className="text-label font-semibold text-fg">Linhas do arquivo</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <TiresKpi kpi="import-rows" label="Linhas lidas" value={fmtInt(b.totalRows)} nav={sectionNav("rows")} destination="ver todas as linhas" />
          <TiresKpi kpi="import-valid" label="Válidas" value={fmtInt(b.validRows)} status="success" period="entram na fotografia" />
          <TiresKpi
            kpi="import-warnings"
            label="Com aviso"
            value={fmtInt(b.warningRows)}
            status={b.warningRows > 0 ? "warning" : undefined}
            nav={sectionNav("issues", "warning")}
            destination="ver as linhas com aviso"
            period="não bloqueiam"
          />
          <TiresKpi
            kpi="import-errors"
            label="Com erro"
            value={fmtInt(b.errorRows)}
            status={b.errorRows > 0 ? "danger" : undefined}
            nav={sectionNav("issues", "error")}
            destination="ver as linhas com erro"
            period="bloqueiam o lote"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-label font-semibold text-fg">Comparação {comparedWith}</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <TiresKpi kpi="import-new" label="Novos" value={fmtInt(b.newTires)} status={b.newTires > 0 ? "info" : undefined} nav={sectionNav("new")} destination="ver os pneus novos" />
          <TiresKpi kpi="import-updated" label="Atualizados" value={fmtInt(b.updatedTires)} status={b.updatedTires > 0 ? "progress" : undefined} nav={sectionNav("changes")} destination="ver as mudanças" />
          <TiresKpi kpi="import-unchanged" label="Sem mudança" value={fmtInt(b.unchangedTires)} />
          <TiresKpi
            kpi="import-absent"
            label="Ausentes no relatório"
            value={fmtInt(b.absentTires)}
            status={b.absentTires > 0 ? "warning" : undefined}
            nav={sectionNav("absent")}
            destination="ver os pneus ausentes"
            period="mantidos, não excluídos"
          />
          <TiresKpi kpi="import-reappeared" label="Reaparecidos" value={fmtInt(b.reappearedTires)} nav={sectionNav("reappeared")} destination="ver os pneus reaparecidos" />
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-4">
        <StatusCounts counters={counters.status} />
        <ChangeCounts counters={counters.changes} nav={(key) => sectionNav("changes", key)} />
        <IssueCounts counters={counters.issues} nav={(code) => sectionNav("issues", code)} />
        <FleetCounts batch={b} nav={sectionNav("issues", "frota_nao_encontrada")} />
      </div>

      <details className="group/file rounded-md border border-border bg-surface" data-testid={`${TID}-file-details`}>
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 text-body-sm font-medium text-fg hfm-focus-ring">
          <FileSpreadsheet className="size-4 text-fg-muted" aria-hidden />
          Arquivo lido: aba {b.sheetName ?? "—"}, cabeçalho na linha {b.headerRow ?? "—"}, janela {b.windowStart ?? "—"} → {b.windowEnd ?? "—"}
          <ChevronRight className="ml-auto size-4 shrink-0 text-fg-muted transition-transform group-open/file:rotate-90" aria-hidden />
        </summary>
        <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            <Fact label="Tamanho">{fmtBytes(b.fileSize)}</Fact>
            <Fact label="Layout">{b.layoutVersion}</Fact>
            <Fact label="Data sugerida pelo arquivo">{formatDate(b.suggestedReferenceDate)}</Fact>
            <Fact label="Assinatura (SHA-256)">
              <span className="font-mono text-caption" title={b.fileHash}>{b.fileHash.slice(0, 16)}…</span>
            </Fact>
          </dl>
          {counters.missingColumns?.length ? (
            <div className="flex flex-col gap-1">
              <span className="text-caption font-semibold text-danger">Colunas obrigatórias ausentes</span>
              <ChipList items={counters.missingColumns.map(fieldLabel)} variant="danger" label="Colunas obrigatórias ausentes" />
            </div>
          ) : null}
          {b.recognizedColumns ? (
            <ColumnGroups recognized={b.recognizedColumns} unrecognized={b.unrecognizedColumns ?? []} ignored={b.ignoredColumns ?? []} />
          ) : null}
        </div>
      </details>

      <PreviewRows preview={preview} ctx={ctx} />

      {canImport && open ? <PreviewActions batch={b} ctx={ctx} blockReasons={blockReasons} /> : null}
    </section>
  );
}

function CountCard({ title, testId, children, empty }: { title: string; testId: string; children: React.ReactNode; empty?: string | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-surface p-3" data-testid={testId}>
      <h3 className="text-label font-semibold text-fg">{title}</h3>
      {empty ? <p className="text-caption text-fg-muted">{empty}</p> : children}
    </div>
  );
}

function StatusCounts({ counters }: { counters: Record<string, number> | undefined }) {
  const entries = counterEntries(counters);
  const total = entries.reduce((s, e) => s + e.count, 0);
  const ordered = [...entries].sort(
    (a, b) => STATUS_ORDER.indexOf(a.code as CanonicalStatus) - STATUS_ORDER.indexOf(b.code as CanonicalStatus),
  );
  return (
    <CountCard title="Situação no arquivo" testId={`${TID}-status-counts`} empty={entries.length ? null : "Sem situação lida."}>
      <ul className="flex flex-col gap-1.5">
        {ordered.map((e) => {
          const tone = STATUS_TONE[e.code as CanonicalStatus] ?? "neutral";
          const pct = total > 0 ? (e.count / total) * 100 : 0;
          return (
            <li key={e.code} className="flex flex-col gap-1">
              <span className="flex items-center justify-between gap-2 text-body-sm">
                <StatusBadge status={tone} size="sm">{statusLabel(e.code)}</StatusBadge>
                <span className="font-semibold tabular-nums text-fg">{fmtInt(e.count)}</span>
              </span>
              <span aria-hidden className="h-1 overflow-hidden rounded-full bg-surface-sunken">
                <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: chartColorOf(tone) }} />
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-caption text-fg-muted">Situação canônica calculada no banco a partir da coluna Situação Pneu.</p>
    </CountCard>
  );
}

function ChangeCounts({ counters, nav }: { counters: Record<string, number> | undefined; nav: (key: string) => ReturnType<Nav> }) {
  const entries = counterEntries(counters).sort((a, b) => b.count - a.count);
  return (
    <CountCard title="Mudanças por tipo" testId={`${TID}-change-counts`} empty={entries.length ? null : "Nenhuma mudança em relação à fotografia anterior."}>
      <ul className="flex flex-col divide-y divide-border-subtle">
        {entries.map((e) => (
          <CountLink key={e.code} nav={nav(e.code)} label={CHANGE_LABEL[e.code] ?? e.code} count={e.count} unit={plural(e.count, "pneu", "pneus")} />
        ))}
      </ul>
    </CountCard>
  );
}

function IssueCounts({ counters, nav }: { counters: Record<string, number> | undefined; nav: (code: string) => ReturnType<Nav> }) {
  const entries = counterEntries(counters).sort((a, b) => Number(ERROR_ISSUES.has(b.code)) - Number(ERROR_ISSUES.has(a.code)) || b.count - a.count);
  return (
    <CountCard title="Problemas por tipo" testId={`${TID}-issue-counts`} empty={entries.length ? null : "Nenhum problema encontrado no arquivo."}>
      <ul className="flex flex-col divide-y divide-border-subtle">
        {entries.map((e) => (
          <CountLink
            key={e.code}
            nav={nav(e.code)}
            label={issueLabel(e.code)}
            count={e.count}
            unit={plural(e.count, "ocorrência", "ocorrências")}
            tone={ERROR_ISSUES.has(e.code) ? "danger" : "warning"}
          />
        ))}
      </ul>
    </CountCard>
  );
}

function CountLink({ nav, label, count, unit, tone }: { nav: ReturnType<Nav>; label: string; count: number; unit: string; tone?: StatusTone }) {
  return (
    <li>
      <a
        href={nav.href}
        onClick={nav.onClick}
        className="flex items-center justify-between gap-2 rounded-xs py-1.5 text-body-sm text-fg hover:text-primary hfm-focus-ring"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {tone ? (
            <span
              aria-hidden
              className={cn("size-2 shrink-0 rounded-full", tone === "danger" ? "bg-danger" : "bg-warning")}
            />
          ) : null}
          <span className="min-w-0">{label}</span>
          {tone === "danger" ? <span className="sr-only">(bloqueia)</span> : null}
        </span>
        <span className="shrink-0 tabular-nums">
          <span className="font-semibold">{fmtInt(count)}</span> <span className="text-caption text-fg-muted">{unit}</span>
        </span>
      </a>
    </li>
  );
}

function FleetCounts({ batch, nav }: { batch: TireImportBatch; nav: ReturnType<Nav> }) {
  const c = batch.counters ?? {};
  const notFound = c.fleetsNotFound ?? null;
  return (
    <CountCard title="Frotas do arquivo" testId={`${TID}-fleet-counts`}>
      <dl className="grid grid-cols-3 gap-2">
        <Fact label="No arquivo">{fmtInt(c.fleetsInFile)}</Fact>
        <Fact label="Veículos do HFM">{fmtInt(c.vehiclesResolved)}</Fact>
        <Fact label="Não encontradas">
          <span className={cn(notFound && notFound > 0 ? "text-warning-soft-fg" : undefined)}>{fmtInt(notFound)}</span>
        </Fact>
      </dl>
      {notFound && notFound > 0 ? (
        <a href={nav.href} onClick={nav.onClick} className="self-start rounded-xs text-caption font-medium text-link underline underline-offset-2 hfm-focus-ring">
          Ver as linhas com frota não encontrada
        </a>
      ) : null}
      <p className="text-caption text-fg-muted">
        Frota sem cadastro no HFM não cria veículo: o pneu entra sem veículo e a linha recebe aviso.
      </p>
    </CountCard>
  );
}

// ---------------------------------------------------------------------------
// Prévia: seções e tabela paginada
// ---------------------------------------------------------------------------
function sectionCount(b: TireImportBatch, s: ImportPreviewSection): number {
  switch (s) {
    case "issues":
      return b.warningRows + b.errorRows;
    case "changes":
      return b.updatedTires;
    case "new":
      return b.newTires;
    case "rows":
      return b.totalRows;
    case "absent":
      return b.absentTires;
    case "reappeared":
      return b.reappearedTires;
  }
}

function PreviewRows({ preview, ctx }: { preview: TireImportPreview; ctx: TiresPanelContext }) {
  const b = preview.batch;
  const section = preview.section;
  const filter = preview.filter ?? "";
  const issueCodes = counterEntries(b.counters?.issues).map((e) => e.code);
  const changeCounts = Object.fromEntries(counterEntries(b.counters?.changes).map((e) => [e.code, e.count]));
  const absentLike = section === "absent" || section === "reappeared";

  return (
    <div className="flex flex-col gap-3" data-testid={`${TID}-sections`}>
      <Tabs
        appearance="container"
        value={section}
        onValueChange={(v) => ctx.navigate({ secao: v, filtro: null, pagina: null })}
        className="gap-0"
      >
        <TabsList aria-label="Seções da prévia">
          {SECTIONS.map((s) => (
            <TabsTrigger key={s} value={s} data-testid={`${TID}-section-${s}`}>
              {SECTION_LABEL[s]}
              <span className="ml-1.5 rounded-full bg-surface-interactive px-1.5 text-caption tabular-nums text-fg-secondary">{fmtInt(sectionCount(b, s))}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-end gap-3">
        {section === "issues" ? (
          <label className="flex min-w-[14rem] flex-col gap-1">
            <span className="text-caption text-fg-muted">Mostrar</span>
            <NativeSelect
              fieldSize="sm"
              value={filter}
              disabled={ctx.pending}
              onChange={(e) => ctx.navigate({ filtro: e.target.value || null, pagina: null })}
              data-testid={`${TID}-filter-issues`}
            >
              <option value="">Todos os problemas</option>
              <option value="error">Só erros (bloqueiam)</option>
              <option value="warning">Só avisos</option>
              {issueCodes.length ? (
                <optgroup label="Por tipo de problema">
                  {issueCodes.map((code) => (
                    <option key={code} value={code}>{issueLabel(code)}</option>
                  ))}
                </optgroup>
              ) : null}
              {filter && filter !== "error" && filter !== "warning" && !issueCodes.includes(filter) ? <option value={filter}>{issueLabel(filter)}</option> : null}
            </NativeSelect>
          </label>
        ) : null}
        {section === "changes" ? (
          <label className="flex min-w-[14rem] flex-col gap-1">
            <span className="text-caption text-fg-muted">Tipo de mudança</span>
            <NativeSelect
              fieldSize="sm"
              value={filter}
              disabled={ctx.pending}
              onChange={(e) => ctx.navigate({ filtro: e.target.value || null, pagina: null })}
              data-testid={`${TID}-filter-changes`}
            >
              <option value="">Todas as mudanças</option>
              {CHANGE_KEYS.map((k) => (
                <option key={k} value={k}>
                  {CHANGE_LABEL[k]}
                  {changeCounts[k] != null ? ` (${fmtInt(changeCounts[k])})` : " (0)"}
                </option>
              ))}
            </NativeSelect>
          </label>
        ) : null}
        <p className="text-caption text-fg-muted sm:ml-auto" data-testid={`${TID}-section-total`}>
          {fmtInt(preview.total)} {absentLike ? plural(preview.total, "pneu", "pneus") : plural(preview.total, "linha", "linhas")}
          {filter ? " com o filtro aplicado" : ""}
        </p>
      </div>

      {section === "absent" ? (
        <Alert variant="neutral" className="py-2">
          <AlertDescription>
            {b.status === "confirmed"
              ? "Pneus marcados como ausentes por esta fotografia: mantidos no cadastro com a última fotografia; não são excluídos."
              : "Estavam na fotografia anterior e não vieram neste relatório. Cada um é mantido no cadastro com a última fotografia; não é excluído. Na confirmação recebe o evento “Ausente no relatório”."}
          </AlertDescription>
        </Alert>
      ) : null}
      {section === "reappeared" ? (
        <Alert variant="neutral" className="py-2">
          <AlertDescription>Estavam marcados como ausentes e voltaram neste relatório: recebem o evento “Voltou ao relatório”.</AlertDescription>
        </Alert>
      ) : null}

      {preview.rows.length === 0 ? (
        <PanelEmpty
          icon={absentLike ? <History /> : <CheckCircle2 />}
          title={emptyTitle(section, Boolean(filter))}
          description={emptyDescription(section)}
          testId={`${TID}-section-empty`}
        />
      ) : absentLike ? (
        <AbsentTable rows={preview.rows as TireImportAbsentRow[]} />
      ) : (
        <RowsTable rows={preview.rows as TireImportPreviewRow[]} section={section} />
      )}

      <TiresPagination ctx={ctx} total={preview.total} limit={preview.limit} label="Paginação da prévia" testId={`${TID}-pagination`} />
    </div>
  );
}

function emptyTitle(section: ImportPreviewSection, filtered: boolean): string {
  if (filtered) return "Nenhuma linha com este filtro";
  switch (section) {
    case "issues":
      return "Nenhum problema no arquivo";
    case "changes":
      return "Nenhuma mudança";
    case "new":
      return "Nenhum pneu novo";
    case "rows":
      return "Nenhuma linha";
    case "absent":
      return "Nenhum pneu ausente";
    case "reappeared":
      return "Nenhum pneu reaparecido";
  }
}

function emptyDescription(section: ImportPreviewSection): string {
  switch (section) {
    case "issues":
      return "Todas as linhas passaram nas regras do banco. Confira as mudanças e os ausentes antes de confirmar.";
    case "changes":
      return "Nenhum pneu mudou de situação, frota, posição, vida, medição, calibragem ou cadastro em relação à fotografia anterior.";
    case "new":
      return "Todos os Nº Fogo do arquivo já existem no cadastro.";
    case "rows":
      return "O lote não tem linhas na área de preparação.";
    case "absent":
      return "Todos os pneus da fotografia anterior vieram neste relatório.";
    case "reappeared":
      return "Nenhum pneu marcado como ausente voltou neste relatório.";
  }
}

/** "antes: …" quando o valor mudou em relação à fotografia anterior. */
function Prev({ show, children }: { show: boolean; children: React.ReactNode }) {
  if (!show) return null;
  return <span className="block whitespace-nowrap text-caption text-fg-muted">antes: {children}</span>;
}

function RowsTable({ rows, section }: { rows: TireImportPreviewRow[]; section: ImportPreviewSection }) {
  return (
    <TableContainer stickyHeader className="max-h-[70vh]" data-testid={`${TID}-rows-table`}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead numeric>Linha</TableHead>
            <TableHead>Nº Fogo</TableHead>
            <TableHead>Severidade · ação · mudanças</TableHead>
            <TableHead className="min-w-[20rem]">Problemas</TableHead>
            <TableHead>Situação</TableHead>
            <TableHead>Frota → placa</TableHead>
            <TableHead>Posição</TableHead>
            <TableHead numeric>Vida</TableHead>
            <TableHead>Menor sulco (informado × calculado)</TableHead>
            <TableHead numeric>PSI</TableHead>
            <TableHead>Medição</TableHead>
            <TableHead>Calibragem</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const sev = ROW_SEVERITY[r.severity] ?? ROW_SEVERITY.pending;
            const act = r.action ? ROW_ACTION[r.action] : null;
            const hasPrev = r.action !== "new" && (r.prevStatus != null || r.prevFleet != null || r.prevLife != null || r.prevTreadMin != null);
            const divergent = r.issues.some((i) => i.code === "menor_mm_divergente");
            const fleetChanged = hasPrev && (r.prevFleet ?? null) !== (r.fleetNumberRaw ?? null);
            const measurementPrevDate = r.prevMeasurementDate ?? null;
            const measurementNowDate = r.measurementAt ? r.measurementAt.slice(0, 10) : null;
            const calibrationNowDate = r.calibrationAt ? r.calibrationAt.slice(0, 10) : null;
            return (
              <TableRow key={`${r.rowNumber}-${r.fireNumber ?? ""}`} data-testid={`${TID}-row`} data-severity={r.severity} data-section={section} className="align-top">
                <TableCell numeric className="py-2 align-top text-fg-secondary">{fmtInt(r.rowNumber)}</TableCell>
                <TableCell className="py-2 align-top">
                  {r.fireNumber ? (
                    <span className="font-semibold tabular-nums text-fg">{r.fireNumber}</span>
                  ) : (
                    <span className="font-semibold text-danger">sem Nº Fogo</span>
                  )}
                  {r.brand || r.model || r.dimension ? (
                    <span className="block max-w-[11rem] truncate text-caption text-fg-muted" title={[r.brand, r.model, r.dimension].filter(Boolean).join(" · ")}>
                      {[r.brand, r.model, r.dimension].filter(Boolean).join(" · ")}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="py-2 align-top">
                  <span className="flex max-w-[13rem] flex-wrap items-start gap-1">
                    <StatusBadge status={sev.tone} size="sm">{sev.label}</StatusBadge>
                    {act ? <StatusBadge status={act.tone} size="sm">{act.label}</StatusBadge> : null}
                    {r.changes.map((c) => (
                      <Badge key={c} variant="progress" appearance="outline" size="sm">
                        <span className="sr-only">Mudou: </span>
                        {CHANGE_LABEL[c] ?? c}
                      </Badge>
                    ))}
                  </span>
                </TableCell>
                <TableCell className="py-2 align-top">
                  {r.issues.length ? (
                    <ul className="flex flex-col gap-1.5">
                      {r.issues.map((i, idx) => (
                        <li key={`${i.code}-${idx}`} className="text-caption leading-snug" title={issueLabel(i.code)}>
                          <span className={cn("font-semibold", i.severity === "error" ? "text-danger" : "text-warning-soft-fg")}>
                            {i.severity === "error" ? "Erro" : "Aviso"}:
                          </span>{" "}
                          <span className="text-fg-secondary">{i.message}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-fg-muted">—</span>
                  )}
                </TableCell>
                <TableCell className="py-2 align-top whitespace-nowrap">
                  {r.canonicalStatus ? (
                    <StatusBadge status={STATUS_TONE[r.canonicalStatus] ?? "neutral"} size="sm">{statusLabel(r.canonicalStatus)}</StatusBadge>
                  ) : (
                    <span className="text-fg-muted">—</span>
                  )}
                  {r.rodoparStatusRaw ? <span className="block text-caption text-fg-muted">Rodopar: {r.rodoparStatusRaw}</span> : null}
                  <Prev show={hasPrev && r.prevStatus != null && r.prevStatus !== r.canonicalStatus}>{statusLabel(r.prevStatus)}</Prev>
                </TableCell>
                <TableCell className="py-2 align-top whitespace-nowrap">
                  {r.fleetNumberRaw ? (
                    <span className="flex flex-col">
                      <span className="tabular-nums text-fg-secondary">{r.fleetNumberRaw} →</span>
                      {r.vehicleId ? (
                        <PlateLink vehicleId={r.vehicleId} plate={r.licensePlate} />
                      ) : (
                        <span className="text-caption font-medium text-warning-soft-fg">não encontrada no HFM</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-fg-muted">sem frota</span>
                  )}
                  <Prev show={fleetChanged}>{vehicleName(r.prevFleet, r.prevPlate) === "—" ? "sem frota" : vehicleName(r.prevFleet, r.prevPlate)}</Prev>
                </TableCell>
                <TableCell className="py-2 align-top whitespace-nowrap tabular-nums">
                  {r.positionCode ?? "—"}
                  <Prev show={hasPrev && !fleetChanged && (r.prevPosition ?? null) !== (r.positionCode ?? null)}>{r.prevPosition ?? "sem posição"}</Prev>
                </TableCell>
                <TableCell numeric className="py-2 align-top">
                  {fmtInt(r.life)}
                  <Prev show={hasPrev && r.prevLife != null && r.prevLife !== r.life}>{fmtInt(r.prevLife)}</Prev>
                </TableCell>
                <TableCell className="py-2 align-top whitespace-nowrap tabular-nums">
                  <span className={cn(divergent && "font-semibold text-warning-soft-fg")}>
                    {fmtNum(r.treadMinRaw)} × {fmtMm(r.treadMinCalculated)}
                  </span>
                  {divergent ? <span className="sr-only"> (divergente)</span> : null}
                  <span className="block text-caption text-fg-muted">
                    sulcos {[r.tread1, r.tread2, r.tread3, r.tread4].map((t) => fmtNum(t)).join(" · ")}
                  </span>
                  <Prev show={hasPrev && r.prevTreadMin != null && r.prevTreadMin !== Math.min(r.treadMinRaw ?? Infinity, r.treadMinCalculated ?? Infinity)}>
                    {fmtMm(r.prevTreadMin)}
                  </Prev>
                </TableCell>
                <TableCell numeric className="py-2 align-top whitespace-nowrap">
                  {fmtPsi(r.psi)}
                  <Prev show={hasPrev && r.prevPsi != null && r.prevPsi !== r.psi}>{fmtPsi(r.prevPsi)}</Prev>
                </TableCell>
                <TableCell className="py-2 align-top whitespace-nowrap tabular-nums">
                  {fmtWall(r.measurementAt)}
                  <Prev show={hasPrev && measurementPrevDate != null && measurementPrevDate !== measurementNowDate}>{formatDate(measurementPrevDate)}</Prev>
                </TableCell>
                <TableCell className="py-2 align-top whitespace-nowrap tabular-nums">
                  {fmtWall(r.calibrationAt)}
                  <Prev show={hasPrev && r.prevCalibrationDate != null && r.prevCalibrationDate !== calibrationNowDate}>{formatDate(r.prevCalibrationDate)}</Prev>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function AbsentTable({ rows }: { rows: TireImportAbsentRow[] }) {
  return (
    <TableContainer stickyHeader className="max-h-[70vh]" data-testid={`${TID}-absent-table`}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nº Fogo</TableHead>
            <TableHead>Situação no cadastro</TableHead>
            <TableHead>Veículo</TableHead>
            <TableHead>Posição</TableHead>
            <TableHead>Última fotografia</TableHead>
            <TableHead>Marca / modelo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} data-testid={`${TID}-absent-row`}>
              <TableCell>
                <FireLink tireId={r.id} fireNumber={r.fireNumber} />
              </TableCell>
              <TableCell>
                <StatusBadge status={STATUS_TONE[r.currentStatus] ?? "neutral"} size="sm">{statusLabel(r.currentStatus)}</StatusBadge>
              </TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">{vehicleName(r.fleetCode, r.licensePlate)}</TableCell>
              <TableCell className="tabular-nums">{r.currentPositionCode ?? "—"}</TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">{formatDate(r.lastReferenceDate)}</TableCell>
              <TableCell className="text-fg-secondary">{[r.brand, r.model].filter(Boolean).join(" · ") || "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

// ---------------------------------------------------------------------------
// Confirmar / descartar
// ---------------------------------------------------------------------------
function PreviewActions({ batch, ctx, blockReasons }: { batch: TireImportBatch; ctx: TiresPanelContext; blockReasons: string[] }) {
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [revalidating, setRevalidating] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  const canConfirm = batch.status === "validated";

  const confirm = async () => {
    setFailure(null);
    const r = await confirmTireImport(batch.id);
    if (!r.ok || !r.data) {
      setFailure(r.error ?? "Não foi possível confirmar a fotografia.");
      toast({ title: "A fotografia não foi confirmada", description: r.error, variant: "danger" });
      return;
    }
    const o = r.data;
    const rc = o.reconciliation ?? {};
    const recon =
      rc.checked != null
        ? `Vistorias conciliadas: ${fmtInt(rc.checked)} conferidas · ${fmtInt(rc.synced)} sincronizadas · ${fmtInt(rc.persistent)} com divergência persistente · ${fmtInt(rc.pending)} aguardando.`
        : "Nenhuma vistoria pendente de lançamento para conciliar.";
    toast({
      title: `Fotografia de ${formatDate(o.referenceDate)} confirmada`,
      description: `${fmtInt(o.snapshots)} ${plural(o.snapshots, "pneu na fotografia", "pneus na fotografia")} · ${fmtInt(o.newTires)} ${plural(o.newTires, "novo", "novos")} · ${fmtInt(o.events)} ${plural(o.events, "evento", "eventos")} · ${fmtInt(o.absent)} ${plural(o.absent, "ausente", "ausentes")}. ${recon}`,
      variant: "success",
      duration: 12000,
    });
    ctx.navigate({ lote: null, secao: null, filtro: null, pagina: null });
  };

  const discard = async () => {
    const r = await cancelTireImport(batch.id, reason.trim() || null);
    if (!r.ok) {
      toast({ title: "Não foi possível descartar o lote", description: r.error, variant: "danger" });
      return;
    }
    toast({ title: "Lote descartado", description: "Nenhuma linha entrou no cadastro. O lote fica no histórico como descartado.", variant: "success" });
    setReason("");
    ctx.navigate({ lote: null, secao: null, filtro: null, pagina: null });
  };

  const revalidate = async () => {
    setRevalidating(true);
    const r = await validateTireImport(batch.id);
    setRevalidating(false);
    if (!r.ok) {
      toast({ title: "Não foi possível validar o lote", description: r.error, variant: "danger" });
      return;
    }
    toast({ title: "Lote validado", description: r.data ? BATCH_STATUS_LABEL[r.data.status] : undefined, variant: "success" });
    ctx.refresh();
  };

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4" data-testid={`${TID}-actions`}>
      {failure ? (
        <Alert variant="danger" data-testid={`${TID}-confirm-error`}>
          <AlertTitle>A fotografia não foi confirmada</AlertTitle>
          <AlertDescription>{failure} Nada foi aplicado: a confirmação é uma única transação.</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <p className="text-caption text-fg-muted sm:mr-auto" data-testid={`${TID}-actions-note`}>
          {canConfirm
            ? "Ao confirmar, o banco revalida o lote e aplica tudo numa única transação: cadastro, fotografia, eventos, ausentes e conciliação das vistorias."
            : batch.status === "blocked"
              ? `Confirmação indisponível: ${blockReasons.join(" ") || "o lote tem inconsistências bloqueantes."}`
              : "O lote recebeu as linhas mas a validação não terminou. Valide de novo ou descarte."}
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button variant="outline" leadingIcon={<Ban />} onClick={() => setDiscardOpen(true)} disabled={ctx.pending} data-testid={`${TID}-discard`}>
            Descartar lote
          </Button>
          {batch.status === "staging" ? (
            <Button variant="secondary" leadingIcon={<RefreshCw />} onClick={() => void revalidate()} loading={revalidating} data-testid={`${TID}-revalidate`}>
              Validar de novo
            </Button>
          ) : null}
          <Button
            leadingIcon={<CheckCircle2 />}
            onClick={() => setConfirmOpen(true)}
            disabled={!canConfirm || ctx.pending}
            aria-describedby={!canConfirm ? `${TID}-actions-note` : undefined}
            title={!canConfirm ? "Só um lote validado, sem bloqueio, pode ser confirmado." : undefined}
            data-testid={`${TID}-confirm`}
          >
            Confirmar importação
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Confirmar a fotografia oficial de ${formatDate(batch.referenceDate)}?`}
        description="O banco revalida o lote e aplica tudo numa única transação: ou tudo entra, ou nada muda."
        confirmLabel="Confirmar e atualizar a fotografia"
        cancelLabel="Voltar à prévia"
        icon={<CheckCircle2 />}
        onConfirm={confirm}
      >
        <ul className="flex list-disc flex-col gap-1 pl-5 text-body-sm text-fg-secondary" data-testid={`${TID}-confirm-summary`}>
          <li>
            Nova fotografia oficial com {fmtInt(batch.validRows)} {plural(batch.validRows, "pneu", "pneus")}: {fmtInt(batch.newTires)}{" "}
            {plural(batch.newTires, "novo", "novos")}, {fmtInt(batch.updatedTires)} {plural(batch.updatedTires, "atualizado", "atualizados")} e{" "}
            {fmtInt(batch.unchangedTires)} sem mudança.
          </li>
          <li>Eventos de histórico para cada mudança: movimentação, posição, vida, medição, calibragem e situação.</li>
          <li>
            {fmtInt(batch.absentTires)} {plural(batch.absentTires, "pneu ausente é mantido", "pneus ausentes são mantidos")} no cadastro com a última
            fotografia — nada é excluído.
          </li>
          <li>As vistorias pendentes de lançamento no Rodopar são conciliadas com a nova fotografia.</li>
          {batch.warningRows > 0 ? (
            <li>
              {fmtInt(batch.warningRows)} {plural(batch.warningRows, "linha com aviso entra", "linhas com aviso entram")}: valores inválidos são ignorados e
              o problema fica registrado.
            </li>
          ) : null}
        </ul>
      </ConfirmDialog>

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={(o) => {
          setDiscardOpen(o);
          if (!o) setReason("");
        }}
        title="Descartar este lote?"
        description={`O lote ${batch.fileName} (referência ${formatDate(batch.referenceDate)}) é marcado como descartado. Nada entra no cadastro e o registro fica no histórico.`}
        confirmLabel="Descartar lote"
        cancelLabel="Manter o lote"
        destructive
        onConfirm={discard}
      >
        <FormField label="Motivo" labelHint="Opcional" helperText="Fica na trilha de auditoria (até 300 caracteres).">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} data-testid={`${TID}-discard-reason`} />
        </FormField>
      </ConfirmDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Histórico de lotes
// ---------------------------------------------------------------------------
function Reconciliation({ batch }: { batch: TireImportBatch }) {
  const r = batch.reconciliation ?? {};
  if (batch.status !== "confirmed" || r.checked == null) return <span className="text-fg-muted">—</span>;
  if (r.checked === 0) return <span className="text-caption text-fg-muted">nenhuma vistoria pendente</span>;
  return (
    <span className="flex flex-col text-caption tabular-nums">
      <span className="text-fg">{fmtInt(r.checked)} {plural(r.checked, "conferida", "conferidas")}</span>
      <span className="text-fg-muted">
        {fmtInt(r.synced)} sincronizadas · {fmtInt(r.persistent)} persistentes · {fmtInt(r.pending)} aguardando
      </span>
    </span>
  );
}

function HistorySection({ history, ctx, canOpen, openId }: { history: TireImportHistory; ctx: TiresPanelContext; canOpen: boolean; openId: string | null }) {
  const link = useTiresLink(ctx);
  const shown = history.rows.length;
  return (
    <Section
      title="Histórico de lotes"
      testId={`${TID}-history`}
      description={
        <>
          {shown < history.total ? `Os ${fmtInt(shown)} lotes mais recentes de ${fmtInt(history.total)}.` : `${fmtInt(history.total)} ${plural(history.total, "lote", "lotes")}.`}{" "}
          {history.latestReferenceDate ? `Fotografia oficial vigente: ${formatDate(history.latestReferenceDate)}.` : "Nenhuma fotografia confirmada ainda."}
          {canOpen ? " Clique num lote para abrir a prévia." : ""}
        </>
      }
    >
      {history.rows.length === 0 ? (
        <PanelEmpty
          icon={<History />}
          title="Nenhum lote enviado"
          description="O primeiro relatório Rodopar 10 validado aparece aqui, com a situação, os totais e a conciliação das vistorias."
          testId={`${TID}-history-empty`}
        />
      ) : (
        <TableContainer data-testid={`${TID}-history-table`}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Arquivo</TableHead>
                <TableHead>Referência</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Linhas</TableHead>
                <TableHead>Comparação</TableHead>
                <TableHead>Conciliação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.rows.map((b) => {
                const nav = link({ lote: b.id, secao: "issues", filtro: null });
                return (
                  <TableRow
                    key={b.id}
                    selected={b.id === openId}
                    data-testid={`${TID}-history-row`}
                    data-status={b.status}
                    className={cn("align-top", canOpen && "cursor-pointer")}
                    onClick={canOpen ? () => ctx.navigate({ lote: b.id, secao: "issues", filtro: null, pagina: null }) : undefined}
                  >
                    <TableCell className="max-w-[13rem] py-2">
                      {canOpen ? (
                        <a
                          href={nav.href}
                          onClick={(e) => {
                            e.stopPropagation();
                            nav.onClick?.(e);
                          }}
                          className="block truncate rounded-xs font-medium text-fg underline-offset-2 hover:text-primary hover:underline hfm-focus-ring"
                          title={b.fileName}
                          data-testid={`${TID}-history-open`}
                        >
                          {b.fileName}
                          <span className="sr-only"> — abrir a prévia do lote</span>
                        </a>
                      ) : (
                        <span className="block truncate font-medium text-fg" title={b.fileName}>{b.fileName}</span>
                      )}
                      <span className="block text-caption text-fg-muted">
                        {[b.sheetName ? `aba ${b.sheetName}` : null, fmtBytes(b.fileSize)].filter(Boolean).join(" · ")}
                      </span>
                      <span className="block truncate text-caption text-fg-muted" title={b.createdByName ?? undefined}>
                        enviado {formatStamp(b.createdAt)} · {b.createdByName ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-2 tabular-nums">
                      <span className="font-semibold text-fg">{formatDate(b.referenceDate)}</span>
                      {b.previousReferenceDate ? <span className="block text-caption text-fg-muted">anterior {formatDate(b.previousReferenceDate)}</span> : null}
                    </TableCell>
                    <TableCell className="max-w-[15.5rem] py-2">
                      <StatusBadge status={BATCH_STATUS_TONE[b.status]} size="sm">{BATCH_STATUS_LABEL[b.status]}</StatusBadge>
                      {b.status === "confirmed" ? (
                        <span className="mt-0.5 block truncate text-caption text-fg-muted" title={b.confirmedByName ?? undefined}>
                          {formatStamp(b.confirmedAt)} · {b.confirmedByName ?? "—"}
                        </span>
                      ) : b.status === "cancelled" ? (
                        <span className="mt-0.5 block text-caption text-fg-muted" title={b.cancelReason ?? undefined}>
                          {formatStamp(b.cancelledAt)}
                          {b.cancelReason ? ` · ${b.cancelReason}` : ""}
                        </span>
                      ) : b.status === "blocked" && b.blockReason ? (
                        <span className="mt-0.5 line-clamp-2 block text-caption text-danger" title={b.blockReason}>{b.blockReason}</span>
                      ) : (
                        <span className="mt-0.5 block text-caption text-fg-muted">aguardando decisão</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-2 tabular-nums">
                      <span className="font-medium text-fg">{fmtInt(b.totalRows)}</span>
                      <span className="block text-caption text-fg-muted">{fmtInt(b.validRows)} válidas</span>
                      <span className="block text-caption text-fg-muted">
                        {fmtInt(b.warningRows)} avisos · <span className={cn(b.errorRows > 0 && "font-semibold text-danger")}>{fmtInt(b.errorRows)} erros</span>
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-2 text-caption tabular-nums">
                      <span className="block text-fg">
                        {fmtInt(b.newTires)} {plural(b.newTires, "novo", "novos")} · {fmtInt(b.updatedTires)} {plural(b.updatedTires, "atualizado", "atualizados")}
                      </span>
                      <span className="block text-fg-muted">
                        {fmtInt(b.unchangedTires)} sem mudança · {fmtInt(b.absentTires)} {plural(b.absentTires, "ausente", "ausentes")}
                        {b.reappearedTires > 0 ? ` · ${fmtInt(b.reappearedTires)} reaparecidos` : ""}
                      </span>
                    </TableCell>
                    <TableCell className="py-2">
                      <Reconciliation batch={b} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Section>
  );
}
