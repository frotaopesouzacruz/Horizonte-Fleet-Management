"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, CircleAlert, Download, FileSpreadsheet, Upload } from "lucide-react";
import {
  Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import { useConfirm } from "@/components/feedback/confirm-dialog";
import { ImportProgress } from "@/components/feedback/import-progress";
import type { Result } from "@/lib/branches/actions";
import type {
  BranchImportChange, BranchImportOutcome, BranchImportPreview, BranchImportRow,
} from "@/lib/branches/import-actions";
import { confirmBranchImport, uploadBranchImport } from "@/lib/branches/import-client";
import type { ImportProgressHandler, ImportProgressState } from "@/lib/import/client";
import { BRANCH_IMPORT_COLUMNS } from "@/lib/branches/import-columns";
import { formatAddress, formatCnpj, formatPostalCode } from "@/lib/branches/format";

/**
 * Importação de Filiais (Etapa 09, §58–§62).
 *
 * Validar, ler a prévia, confirmar. Toda regra vive no banco; a gaveta só
 * mostra o que `stage_branch_import` devolveu — linha a linha, com a
 * diferença entre o que está cadastrado e o que chegou no arquivo (§60) — e
 * deixa claro, antes de gravar, o que a importação não faz: desvincular
 * operações, mudar a situação, mexer em colaboradores, veículos ou acessos.
 *
 * `loaders` existe para a prévia de desenvolvimento (dados fixos, sem
 * Supabase); a tela real usa as server actions.
 */

export interface BranchImportLoaders {
  /** Sem teto de linhas: lê no navegador e valida em partes, informando o progresso. */
  upload: (formData: FormData, onProgress?: ImportProgressHandler) => Promise<Result<BranchImportPreview>>;
  confirm: (
    batchId: string,
    onProgress?: ImportProgressHandler,
    expectedRows?: number,
  ) => Promise<Result<BranchImportOutcome>>;
}

const defaultLoaders: BranchImportLoaders = {
  upload: uploadBranchImport,
  confirm: confirmBranchImport,
};

export interface BranchImportDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loaders?: BranchImportLoaders;
  /** Rota da exportação, de onde sai o modelo vazio. */
  exportPath?: string;
}

const formatInt = (n: number) => n.toLocaleString("pt-BR");

const ROW_STATUS: Record<BranchImportRow["status"], { label: string; tone: "success" | "warning" | "danger" }> = {
  valid: { label: "Válida", tone: "success" },
  warning: { label: "Aviso", tone: "warning" },
  error: { label: "Erro", tone: "danger" },
};

const ACTION: Record<BranchImportRow["action"], { label: string; variant: "success" | "primary" | "neutral" }> = {
  create: { label: "Criar", variant: "success" },
  update: { label: "Atualizar", variant: "primary" },
  skip: { label: "Ignorar", variant: "neutral" },
};

type RowFilter = "all" | "create" | "update" | "error" | "skip";

function displayValue(change: BranchImportChange, value: string | null): string {
  if (value == null || value === "") return "vazio";
  if (change.field === "document_number") return formatCnpj(value);
  if (change.field === "postal_code") return formatPostalCode(value);
  return value;
}

export function BranchImportDrawer({
  open,
  onOpenChange,
  loaders = defaultLoaders,
  exportPath = "/estrutura/filiais/export",
}: BranchImportDrawerProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent size="xl" aria-describedby="branch-import-description">
        {open ? (
          <ImportBody loaders={loaders} exportPath={exportPath} onClose={() => onOpenChange(false)} />
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}

function ImportBody({
  loaders,
  exportPath,
  onClose,
}: {
  loaders: BranchImportLoaders;
  exportPath: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [preview, setPreview] = React.useState<BranchImportPreview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [failures, setFailures] = React.useState<BranchImportOutcome["errors"]>([]);
  const [filter, setFilter] = React.useState<RowFilter>("all");
  const [busy, startTransition] = React.useTransition();
  const [progress, setProgress] = React.useState<ImportProgressState | null>(null);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError(null);
    setFailures([]);
    startTransition(async () => {
      const result = await loaders.upload(data, setProgress);
      if (result.ok && result.data) {
        setPreview(result.data);
        setFilter("all");
      } else {
        setPreview(null);
        setError(result.error ?? "Não foi possível validar o arquivo.");
      }
    });
  };

  const writable = preview ? preview.createRows + preview.updateRows : 0;

  const apply = async () => {
    if (!preview) return;
    const ok = await confirm({
      title: "Confirmar a importação?",
      description:
        `${formatInt(preview.createRows)} filial(is) serão criadas e ${formatInt(preview.updateRows)} atualizada(s). ` +
        `${formatInt(preview.errorRows)} linha(s) com erro ficam de fora. Nenhum vínculo operacional é removido, ` +
        "nenhuma filial é inativada, e colaboradores, veículos, perfis e permissões não mudam.",
      confirmLabel: "Importar",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await loaders.confirm(preview.batchId, setProgress, preview.validRows + preview.warningRows);
      if (!result.ok || !result.data) {
        setError(result.error ?? "Não foi possível processar a importação.");
        return;
      }
      const d = result.data;
      const summary =
        `Importação concluída: ${formatInt(d.created)} criada(s), ${formatInt(d.updated)} atualizada(s), ` +
        `${formatInt(d.linksAdded)} vínculo(s) novo(s), ${formatInt(d.skipped)} ignorada(s).`;
      router.refresh();
      if (d.failed > 0) {
        // Linhas que falharam na gravação ficam na tela, com o motivo.
        toast({ title: summary, variant: "warning" });
        setFailures(d.errors);
        setPreview(null);
        formRef.current?.reset();
        return;
      }
      toast({ title: summary, variant: "success" });
      onClose();
    });
  };

  const counts = React.useMemo(() => {
    const rows = preview?.rows ?? [];
    return {
      all: rows.length,
      create: rows.filter((r) => r.action === "create").length,
      update: rows.filter((r) => r.action === "update").length,
      error: rows.filter((r) => r.status === "error").length,
      skip: rows.filter((r) => r.status !== "error" && r.action === "skip").length,
    };
  }, [preview]);

  const visibleRows = React.useMemo(() => {
    const rows = preview?.rows ?? [];
    switch (filter) {
      case "create": return rows.filter((r) => r.action === "create");
      case "update": return rows.filter((r) => r.action === "update");
      case "error": return rows.filter((r) => r.status === "error");
      case "skip": return rows.filter((r) => r.status !== "error" && r.action === "skip");
      default: return rows;
    }
  }, [preview, filter]);

  return (
    <>
      <DrawerHeader>
        <DrawerTitle>Importar filiais</DrawerTitle>
        <DrawerDescription id="branch-import-description">
          XLSX ou CSV. O arquivo é validado antes de qualquer gravação, e a prévia mostra linha a linha o que
          vai acontecer — inclusive o que muda em cada filial já cadastrada.
        </DrawerDescription>
      </DrawerHeader>

      <DrawerBody className="flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-2">
          <section aria-labelledby="branch-import-columns" className="min-w-0 rounded-md border border-border p-3">
            <h3 id="branch-import-columns" className="mb-1 text-label font-semibold text-fg">Colunas reconhecidas</h3>
            <ul className="flex flex-col gap-0.5 text-caption text-fg-muted">
              {BRANCH_IMPORT_COLUMNS.map((c) => (
                <li key={c.field}>
                  <span className="font-medium text-fg">{c.label}</span>
                  {c.required ? " *" : ""} — {c.hint}
                </li>
              ))}
            </ul>
          </section>
          <section
            aria-labelledby="branch-import-rules"
            className="flex min-w-0 flex-col gap-2 rounded-md border border-border p-3 text-caption text-fg-muted"
          >
            <h3 id="branch-import-rules" className="text-label font-semibold text-fg">O que a importação faz</h3>
            <p>
              Cria as filiais novas e atualiza as já cadastradas, identificadas pelo <strong>código interno</strong>.
              Coluna vazia não apaga nada. Operações informadas só são <strong>acrescentadas</strong>.
            </p>
            <p>
              Não desvincula operações, não inativa nem reativa filiais, não troca CNPJ já cadastrado e não altera
              colaboradores, veículos, perfis de acesso, permissões ou escopos. Linhas ambíguas — código repetido,
              nome ou CNPJ de outra filial, cidade sem estado — ficam de fora.
            </p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              <a
                className="inline-flex items-center gap-1.5 text-label font-medium text-link hover:underline"
                href={`${exportPath}?tipo=modelo&format=xlsx`}
                download
              >
                <Download aria-hidden className="size-3.5" />
                Modelo (XLSX)
              </a>
              <a
                className="inline-flex items-center gap-1.5 text-label font-medium text-link hover:underline"
                href={`${exportPath}?tipo=modelo&format=csv`}
                download
              >
                <Download aria-hidden className="size-3.5" />
                Modelo (CSV)
              </a>
            </div>
          </section>
        </div>

        <form ref={formRef} onSubmit={submit} className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            name="file"
            accept=".xlsx,.csv"
            required
            aria-label="Arquivo de filiais"
            onChange={() => {
              setPreview(null);
              setError(null);
              setFailures([]);
            }}
            className="min-w-0 max-w-full text-body-sm text-fg file:mr-3 file:rounded-sm file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-label file:text-fg hover:file:bg-secondary"
          />
          <Button type="submit" variant="secondary" leadingIcon={<Upload />} loading={busy && !preview}>
            Validar arquivo
          </Button>
        </form>

        <ImportProgress progress={progress} />

        {error ? (
          <Alert variant="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {failures.length > 0 ? (
          <Alert variant="warning">
            <AlertDescription>
              <span className="block font-medium">Algumas linhas não foram gravadas:</span>
              <ul className="mt-1 list-disc pl-5">
                {failures.map((f) => (
                  <li key={`${f.rowNumber}-${f.message}`}>Linha {f.rowNumber}: {f.message}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        {preview ? (
          <div className="flex flex-col gap-3" data-testid="branch-import-preview">
            {preview.alreadyImported ? (
              <Alert variant="warning">
                <AlertDescription>
                  Este mesmo arquivo já foi importado antes. Validar de novo não duplica nada: o que já existe aparece
                  como filial cadastrada.
                </AlertDescription>
              </Alert>
            ) : null}

            <p className="flex min-w-0 flex-wrap items-center gap-2 text-caption text-fg-muted">
              <FileSpreadsheet aria-hidden className="size-3.5 shrink-0" />
              <span className="min-w-0 break-all">{preview.fileName} · {preview.sheetName}</span>
            </p>

            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Resumo da prévia">
              {[
                { label: "Linhas", value: preview.totalRows },
                { label: "A criar", value: preview.createRows },
                { label: "A atualizar", value: preview.updateRows },
                { label: "Sem alteração", value: preview.skipRows },
                { label: "Com erro", value: preview.errorRows },
              ].map((t) => (
                <div key={t.label} className="rounded-md border border-border bg-surface p-2.5">
                  <dt className="text-caption text-fg-muted">{t.label}</dt>
                  <dd className="mt-0.5 text-h4 font-semibold tabular-nums text-fg">{formatInt(t.value)}</dd>
                </div>
              ))}
            </dl>

            <p className="text-caption text-fg-muted">
              Colunas mapeadas: {preview.mappedColumns.map((m) => `${m.header} → ${m.label}`).join(" · ")}
              {preview.unmappedColumns.length ? ` · ignoradas: ${preview.unmappedColumns.join(", ")}` : ""}
            </p>

            {preview.rows.length < preview.totalRows ? (
              <p className="text-caption text-fg-muted">
                A lista abaixo mostra as primeiras {formatInt(preview.rows.length)} linhas do arquivo; os totais acima
                contam as {formatInt(preview.totalRows)}, e a importação grava todas as válidas.
              </p>
            ) : null}

            <Tabs value={filter} onValueChange={(v) => setFilter(v as RowFilter)} appearance="segmented">
              <TabsList aria-label="Filtrar linhas da prévia" className="max-w-full">
                <TabsTrigger value="all" count={counts.all}>Todas</TabsTrigger>
                <TabsTrigger value="create" count={counts.create}>A criar</TabsTrigger>
                <TabsTrigger value="update" count={counts.update}>A atualizar</TabsTrigger>
                <TabsTrigger value="error" count={counts.error}>Com erro</TabsTrigger>
                <TabsTrigger value="skip" count={counts.skip}>Sem alteração</TabsTrigger>
              </TabsList>
            </Tabs>

            {preview.rows.length < preview.totalRows ? (
              <p className="text-caption text-fg-muted">
                A prévia mostra as primeiras {formatInt(preview.rows.length)} de {formatInt(preview.totalRows)} linhas;
                os totais acima valem para o arquivo inteiro.
              </p>
            ) : null}

            <ul aria-label="Linhas da prévia" className="flex flex-col gap-2">
              {visibleRows.length === 0 ? (
                <li className="rounded-md border border-border px-3 py-6 text-center text-body-sm text-fg-muted">
                  Nenhuma linha neste filtro.
                </li>
              ) : (
                visibleRows.map((row) => <PreviewRow key={row.rowNumber} row={row} />)
              )}
            </ul>
          </div>
        ) : null}
      </DrawerBody>

      <DrawerFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Fechar
        </Button>
        <Button onClick={apply} disabled={!preview || writable === 0} loading={busy && Boolean(preview)}>
          {preview ? `Importar ${formatInt(writable)} filial(is)` : "Importar"}
        </Button>
      </DrawerFooter>
    </>
  );
}

function PreviewRow({ row }: { row: BranchImportRow }) {
  const status = ROW_STATUS[row.status];
  const action = ACTION[row.action];
  const title = row.name ?? row.currentName ?? "Sem nome";
  const address = formatAddress({
    street: row.street,
    streetNumber: row.streetNumber,
    district: row.district,
    cityName: row.cityName,
    stateUf: row.stateUf,
  });
  const added = row.operations.filter((o) => o.link === "add");
  const kept = row.operations.filter((o) => o.link === "kept");

  return (
    <li
      className="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-surface p-3"
      aria-label={`Linha ${row.rowNumber}${row.code ? `, código ${row.code}` : ""}`}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-caption tabular-nums text-fg-muted">Linha {row.rowNumber}</span>
        <StatusBadge size="sm" status={status.tone}>{status.label}</StatusBadge>
        <Badge size="sm" variant={action.variant} appearance="soft">{action.label}</Badge>
        {row.code ? <span className="font-mono text-caption text-fg-secondary">{row.code}</span> : null}
        <span className="min-w-0 truncate text-body-sm font-medium text-fg" title={title}>{title}</span>
      </div>

      {row.action === "create" ? (
        <dl className="grid gap-x-4 gap-y-1 text-caption sm:grid-cols-2">
          <Fact label="CNPJ">{row.documentNumber ? formatCnpj(row.documentNumber) : "Não informado"}</Fact>
          <Fact label="Situação">{row.statusValue === "inactive" ? "Inativa" : "Ativa"}</Fact>
          <Fact label="Endereço">{address}</Fact>
          <Fact label="CEP">{row.postalCode ? formatPostalCode(row.postalCode) : "—"}</Fact>
          {row.legalName ? <Fact label="Razão social">{row.legalName}</Fact> : null}
        </dl>
      ) : null}

      {row.changes.length > 0 ? (
        <div data-testid="branch-import-diff" className="min-w-0 rounded-sm border border-border">
          <p className="border-b border-border bg-surface-secondary px-2.5 py-1.5 text-caption font-medium text-fg-secondary">
            Atual × recebido
          </p>
          <dl className="divide-y divide-border">
            {row.changes.map((c) => (
              <div key={c.field} className="grid min-w-0 gap-1 px-2.5 py-1.5 text-caption sm:grid-cols-[9rem_1fr]">
                <dt className="font-medium text-fg-secondary">{c.label}</dt>
                <dd className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="min-w-0 break-words text-fg-muted">
                    <span className="sr-only">Atual: </span>
                    <span className="line-through">{displayValue(c, c.current)}</span>
                  </span>
                  <ArrowRight aria-hidden className="size-3 shrink-0 text-fg-muted" />
                  <span className="min-w-0 break-words font-medium text-fg">
                    <span className="sr-only">Recebido: </span>
                    {displayValue(c, c.received)}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {added.length > 0 || kept.length > 0 || row.linksKept.length > 0 ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-caption">
          <span className="text-fg-muted">Operações:</span>
          {added.map((o) => (
            <Badge key={o.id} size="sm" variant="success" appearance="soft" className="max-w-full">
              <span className="truncate">+ {o.name}</span>
            </Badge>
          ))}
          {kept.map((o) => (
            <Badge key={o.id} size="sm" variant="neutral" appearance="soft" className="max-w-full">
              <span className="truncate">{o.name} (já vinculada)</span>
            </Badge>
          ))}
          {row.linksKept.length > 0 ? (
            <span className="text-fg-muted">· mantidas fora do arquivo: {row.linksKept.join(", ")}</span>
          ) : null}
        </div>
      ) : null}

      {row.issues.length > 0 ? (
        <ul className="flex flex-col gap-1" aria-label={`Mensagens da linha ${row.rowNumber}`}>
          {row.issues.map((issue, index) => (
            <li
              key={`${issue.code}-${index}`}
              className={
                issue.level === "error"
                  ? "flex items-start gap-1.5 text-caption text-danger"
                  : "flex items-start gap-1.5 text-caption text-warning-soft-fg"
              }
            >
              {issue.level === "error" ? (
                <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              ) : (
                <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              )}
              <span className="min-w-0 break-words">
                <span className="sr-only">{issue.level === "error" ? "Erro: " : "Aviso: "}</span>
                {issue.message}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 gap-1.5">
      <dt className="shrink-0 text-fg-muted">{label}:</dt>
      <dd className="min-w-0 break-words text-fg">{children}</dd>
    </div>
  );
}
