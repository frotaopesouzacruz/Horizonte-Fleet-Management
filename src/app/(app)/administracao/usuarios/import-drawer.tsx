"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Drawer, DrawerContent, DrawerHeader, DrawerBody, DrawerFooter, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { Progress } from "@/components/feedback/progress";
import { ImportProgress } from "@/components/feedback/import-progress";
import { useToast } from "@/components/feedback/toast";
import { cancelImport, type ImportPreview } from "@/lib/admin/import-actions";
import { processImport, uploadImportFile } from "@/lib/admin/import-client";
import type { ImportProgressState } from "@/lib/import/client";

type Stage = "upload" | "preview" | "done";

const MODE_LABELS: Record<string, string> = {
  create_update: "Criar e atualizar",
  create: "Somente criar novos",
  validate: "Apenas validar",
};

/**
 * Import wizard: upload → mapping and preview → confirmation → result.
 *
 * Nothing reaches the employee tables before the preview is confirmed, and the
 * import never touches accounts, roles or operation scopes — a changed "Perfil"
 * column is a change of organizational label, not of privilege.
 */
export function ImportDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [stage, setStage] = React.useState<Stage>("upload");
  const [mode, setMode] = React.useState("create_update");
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [result, setResult] = React.useState<{ created: number; updated: number; skipped: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, startBusy] = React.useTransition();
  const [progress, setProgress] = React.useState<ImportProgressState | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Reopening the wizard starts from scratch, adjusted during render so the
  // previous run's result never flashes behind the upload step.
  const [wasOpen, setWasOpen] = React.useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setStage("upload");
      setFile(null);
      setPreview(null);
      setResult(null);
      setError(null);
    }
  }

  function upload() {
    if (!file) return;
    setError(null);
    startBusy(async () => {
      const data = new FormData();
      data.set("file", file);
      data.set("mode", mode);
      const response = await uploadImportFile(data, setProgress);
      if (!response.ok || !response.data) {
        setError(response.error ?? "Não foi possível ler o arquivo.");
        return;
      }
      setPreview(response.data);
      setStage("preview");
    });
  }

  function confirmImport() {
    if (!preview) return;
    startBusy(async () => {
      const response = await processImport(preview.batchId, setProgress, preview.validRows + preview.warningRows);
      if (!response.ok || !response.data) {
        setError(response.error ?? "A importação falhou.");
        return;
      }
      setResult(response.data);
      setStage("done");
      toast({
        title: `Importação concluída: ${response.data.created} novo(s), ${response.data.updated} atualizado(s).`,
        variant: "success",
      });
      router.refresh();
    });
  }

  function discard() {
    if (preview) void cancelImport(preview.batchId);
    onOpenChange(false);
  }

  const errors = preview?.findings.filter((f) => f.level === "error") ?? [];
  const warnings = preview?.findings.filter((f) => f.level === "warning") ?? [];

  return (
    <Drawer open={open} onOpenChange={(next) => (next ? onOpenChange(true) : discard())}>
      <DrawerContent side="right" size="lg" className="w-[min(100vw,50rem)]">
        <DrawerHeader>
          <DrawerTitle>Importar colaboradores</DrawerTitle>
          <DrawerDescription>
            O arquivo é analisado em área de staging e nada é gravado antes da sua confirmação.
          </DrawerDescription>
        </DrawerHeader>

        <DrawerBody>
          {progress ? (
            <div className="mb-4">
              <ImportProgress progress={progress} />
            </div>
          ) : null}
          {error ? (
            <Alert variant="danger" className="mb-4">
              <AlertTitle>Não foi possível prosseguir</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {stage === "upload" ? (
            <div className="flex flex-col gap-4">
              <FormField label="Modo de importação" helperText="A primeira carga da base normalmente usa “Criar e atualizar”.">
                <Select value={mode} onValueChange={setMode}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(MODE_LABELS).map(([id, label]) => (
                      <SelectItem key={id} value={id}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <div
                className={cn(
                  "flex flex-col items-center gap-3 rounded-md border border-dashed border-border p-8 text-center",
                  file && "border-primary bg-primary-soft/40",
                )}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const dropped = event.dataTransfer.files?.[0];
                  if (dropped) setFile(dropped);
                }}
              >
                <FileSpreadsheet className="size-8 text-fg-muted" aria-hidden />
                {file ? (
                  <p className="text-body-sm text-fg">
                    <span className="font-medium">{file.name}</span>
                    <span className="block text-caption text-fg-muted">{(file.size / 1024).toFixed(0)} KB</span>
                  </p>
                ) : (
                  <p className="text-body-sm text-fg-secondary">
                    Arraste o arquivo aqui ou selecione. Formatos aceitos: XLSX e CSV.
                  </p>
                )}
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.csv"
                  className="sr-only"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
                <div className="flex gap-2">
                  <Button variant="secondary" leadingIcon={<Upload />} onClick={() => inputRef.current?.click()}>
                    Selecionar arquivo
                  </Button>
                  {file ? (
                    <Button variant="ghost" leadingIcon={<X />} onClick={() => setFile(null)}>
                      Remover
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="rounded-md border border-border bg-surface-secondary p-3">
                <p className="text-body-sm font-medium text-fg">Colunas reconhecidas automaticamente</p>
                <p className="mt-1 text-caption text-fg-muted">
                  Nome, Matrícula, CPF, Situação, Admissão, Cargo, Área, Operação, Perfil, Localidade, Filial, Líder
                  Imediato, Email, CNH tipo, CNH número, CNH validade, CNH 1ª habilitação, CNH pontuação e Data de
                  nascimento.
                </p>
                <Button variant="link" size="sm" className="mt-1 px-0" asChild>
                  <a href="./usuarios/export?layout=template&format=xlsx" download>
                    <Download aria-hidden /> Baixar modelo de importação
                  </a>
                </Button>
              </div>
            </div>
          ) : null}

          {stage === "preview" && preview ? (
            <div className="flex flex-col gap-4">
              {preview.alreadyImported ? (
                <Alert variant="warning">
                  <AlertTitle>Este arquivo já foi processado anteriormente</AlertTitle>
                  <AlertDescription>
                    O conteúdo é idêntico a uma importação concluída. Prosseguir é seguro — registros existentes serão
                    apenas atualizados — mas verifique se é isso que você espera.
                  </AlertDescription>
                </Alert>
              ) : null}

              {preview.profileDivergences > 0 ? (
                <Alert variant="info">
                  <AlertTitle>
                    {preview.profileDivergences} perfil(is) informados na base diferem do Perfil de Acesso HFM
                  </AlertTitle>
                  <AlertDescription>
                    O Perfil de Acesso do HFM foi <strong>preservado</strong> em todos os casos — um arquivo não concede
                    nem retira acesso. As divergências ficam listadas abaixo e em Administração → Perfis e permissões,
                    para que um Administrador decida caso a caso.
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Stat label="Linhas" value={preview.totalRows} />
                <Stat label="Novos" value={preview.createRows} tone="success" />
                <Stat label="Atualizações" value={preview.updateRows} tone="info" />
                <Stat
                  label="Perfis preservados"
                  value={preview.profileDivergences}
                  tone={preview.profileDivergences ? "info" : "neutral"}
                />
                <Stat label="Com erro" value={preview.errorRows} tone={preview.errorRows ? "danger" : "neutral"} />
              </div>

              <Progress
                value={preview.totalRows ? ((preview.validRows + preview.warningRows) / preview.totalRows) * 100 : 0}
                label="Linhas aptas a importar"
              />

              <div>
                <p className="text-body-sm font-medium text-fg">Mapeamento de colunas</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {preview.mappedColumns.map((column) => (
                    <Badge key={column.field} variant="neutral">
                      {column.header} → {column.label}
                    </Badge>
                  ))}
                </div>
                {preview.unmappedColumns.length ? (
                  <p className="mt-2 text-caption text-fg-muted">
                    Colunas ignoradas: {preview.unmappedColumns.join(", ")}.
                  </p>
                ) : null}
              </div>

              <Separator />

              <div>
                <p className="mb-2 text-body-sm font-medium text-fg">Prévia das primeiras linhas</p>
                <TableContainer>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Linha</TableHead>
                        <TableHead>Matrícula</TableHead>
                        <TableHead>Nome</TableHead>
                        <TableHead>Ação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.sample.map((row) => (
                        <TableRow key={row.row_number}>
                          <TableCell numeric>{row.row_number}</TableCell>
                          <TableCell numeric>{row.code}</TableCell>
                          <TableCell>{row.name}</TableCell>
                          <TableCell>
                            <Badge
                              variant={row.action === "create" ? "success" : row.action === "update" ? "info" : "neutral"}
                            >
                              {row.action === "create" ? "Criar" : row.action === "update" ? "Atualizar" : "Ignorar"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </div>

              {errors.length ? (
                <FindingList
                  title={`Erros (${preview.errorRows} linha(s) não serão importadas)`}
                  tone="danger"
                  items={errors}
                />
              ) : null}
              {warnings.length ? (
                <FindingList title={`Avisos (${warnings.length})`} tone="warning" items={warnings} />
              ) : null}
            </div>
          ) : null}

          {stage === "done" && result ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <CheckCircle2 className="size-10 text-success" aria-hidden />
              <h3 className="text-h4 font-semibold text-fg">Importação concluída</h3>
              <dl className="grid grid-cols-3 gap-6">
                <Stat label="Novos" value={result.created} tone="success" />
                <Stat label="Atualizados" value={result.updated} tone="info" />
                <Stat label="Ignorados" value={result.skipped} />
              </dl>
              <p className="max-w-md text-body-sm text-fg-secondary">
                Nenhuma conta de acesso foi criada. Colaboradores importados existem na base corporativa; o acesso ao HFM
                é concedido individualmente pela aba Acesso.
              </p>
            </div>
          ) : null}
        </DrawerBody>

        <DrawerFooter className="justify-between">
          <Button variant="ghost" onClick={discard} disabled={busy}>
            {stage === "done" ? "Fechar" : "Cancelar"}
          </Button>
          <div className="flex gap-2">
            {stage === "upload" ? (
              <Button leadingIcon={<Upload />} disabled={!file} loading={busy} onClick={upload}>
                Analisar arquivo
              </Button>
            ) : null}
            {stage === "preview" && preview ? (
              <>
                <Button variant="secondary" onClick={() => { setStage("upload"); setPreview(null); }} disabled={busy}>
                  Trocar arquivo
                </Button>
                <Button
                  loading={busy}
                  disabled={preview.mode === "validate" || preview.validRows + preview.warningRows === 0}
                  onClick={confirmImport}
                >
                  Confirmar importação de {preview.createRows + preview.updateRows} registro(s)
                </Button>
              </>
            ) : null}
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function Stat({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "success" | "info" | "danger" }) {
  const toneClass = {
    neutral: "text-fg",
    success: "text-success",
    info: "text-info",
    danger: "text-danger",
  }[tone];

  return (
    <div className="rounded-sm border border-border-subtle px-3 py-2">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className={cn("text-h3 font-semibold tabular-nums", toneClass)}>{value}</dd>
    </div>
  );
}

function FindingList({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "danger" | "warning";
  items: { row_number: number | null; field: string | null; message: string }[];
}) {
  const [expanded, setExpanded] = React.useState(false);
  const visible = expanded ? items : items.slice(0, 8);

  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <AlertTriangle className={cn("size-4", tone === "danger" ? "text-danger" : "text-warning")} aria-hidden />
        <span className="text-body-sm font-medium text-fg">{title}</span>
      </div>
      <ul className="divide-y divide-border-subtle">
        {visible.map((item, index) => (
          <li key={`${item.row_number}-${item.field}-${index}`} className="flex gap-3 px-3 py-2 text-body-sm">
            <span className="w-14 shrink-0 tabular-nums text-fg-muted">
              {item.row_number ? `L ${item.row_number}` : "—"}
            </span>
            <span className="text-fg-secondary">{item.message}</span>
          </li>
        ))}
      </ul>
      {items.length > 8 ? (
        <div className="border-t border-border px-3 py-2">
          <Button variant="link" size="sm" className="px-0" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Mostrar menos" : `Ver todas as ${items.length} ocorrências`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
