"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerBody,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { LoadingState } from "@/components/feedback/loading-state";
import { ImportProgress } from "@/components/feedback/import-progress";
import { useToast } from "@/components/feedback/toast";
import { cancelFleetImport, type FleetImportPreview } from "@/lib/fleet/import-actions";
import { processFleetImport, uploadFleetImport } from "@/lib/fleet/import-client";
import type { ImportProgressState } from "@/lib/import/client";

const MODES = [
  {
    id: "validate",
    label: "Validar apenas",
    description: "Nada é gravado. Serve para conferir o arquivo antes de decidir.",
  },
  {
    id: "create",
    label: "Cadastrar novos",
    description: "Cria os veículos que ainda não existem e ignora os já cadastrados.",
  },
  {
    id: "create_update",
    label: "Cadastrar e atualizar",
    description: "Cria os novos e atualiza os campos cadastrais permitidos dos existentes.",
  },
] as const;

const ROW_STATUS_LABEL: Record<string, string> = {
  valid: "Válida",
  warning: "Atenção",
  error: "Erro",
};

const ACTION_LABEL: Record<string, string> = {
  create: "Cadastrar",
  update: "Atualizar",
  skip: "Ignorar",
};

/**
 * Fleet import.
 *
 * Upload, map, normalize, validate, preview, confirm. Nothing reaches the
 * vehicles table before the confirmation, and the preview is where the import's
 * limits become visible: what it will create, what it will update, and what it
 * refuses to touch — allocation and homologated kilometres — with both values
 * side by side (§54, §55).
 */
export function FleetImportDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [mode, setMode] = React.useState<string>("create_update");
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<FleetImportPreview | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState<ImportProgressState | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<{ created: number; updated: number; skipped: number } | null>(
    null,
  );

  // Every opening starts clean: a batch staged for one file must never be
  // confirmed against the next one.
  const [wasOpen, setWasOpen] = React.useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setFile(null);
      setPreview(null);
      setError(null);
      setDone(null);
      setMode("create_update");
    }
  }

  async function submitFile() {
    if (!file || busy) return;
    setBusy(true);
    setError(null);

    const data = new FormData();
    data.set("file", file);
    data.set("mode", mode);

    const result = await uploadFleetImport(data, setProgress);
    setBusy(false);

    if (!result.ok || !result.data) {
      setError(result.error ?? "Não foi possível preparar a importação.");
      return;
    }
    setPreview(result.data);
  }

  async function confirmImport() {
    if (!preview || busy) return;
    setBusy(true);
    setError(null);

    const result = await processFleetImport(preview.batchId, setProgress, preview.createRows + preview.updateRows);
    setBusy(false);

    if (!result.ok || !result.data) {
      setError(result.error ?? "A importação falhou.");
      return;
    }
    setDone(result.data);
    toast({ title: "Importação concluída", variant: "success" });
    router.refresh();
  }

  async function discard() {
    if (preview && !done) await cancelFleetImport(preview.batchId);
    onOpenChange(false);
  }

  const canConfirm =
    preview !== null &&
    !done &&
    preview.mode !== "validate" &&
    preview.createRows + preview.updateRows > 0;

  return (
    <Drawer open={open} onOpenChange={(next) => (next ? onOpenChange(true) : void discard())}>
      <DrawerContent size="lg">
        <DrawerHeader>
          <DrawerTitle>Importar frotas</DrawerTitle>
          <DrawerDescription>
            XLSX ou CSV. Nada é gravado antes da confirmação.
          </DrawerDescription>
        </DrawerHeader>

        <DrawerBody className="flex flex-col gap-4">
          {error ? (
            <Alert variant="danger">
              <AlertTitle>Não foi possível continuar</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {done ? (
            <Alert variant="success">
              <AlertTitle>Importação concluída</AlertTitle>
              <AlertDescription>
                {done.created} veículo(s) cadastrado(s), {done.updated} atualizado(s) e {done.skipped}{" "}
                ignorado(s). O relatório fica registrado na auditoria.
              </AlertDescription>
            </Alert>
          ) : null}

          {busy ? (
            progress ? <ImportProgress progress={progress} /> : <LoadingState label="Processando o arquivo…" />
          ) : null}

          {!preview && !busy ? (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="fleet-import-file">Arquivo</Label>
                <input
                  ref={inputRef}
                  id="fleet-import-file"
                  type="file"
                  accept=".xlsx,.csv"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  className="block w-full rounded-md border border-border bg-surface px-3 py-2 text-body-sm text-fg file:mr-3 file:rounded file:border-0 file:bg-surface-secondary file:px-3 file:py-1 file:text-body-sm file:text-fg hfm-focus-ring"
                />
                <p className="text-caption text-fg-muted">
                  Sem limite de linhas: arquivos grandes são enviados e validados em partes. As colunas são
                  reconhecidas pelo cabeçalho; baixe o modelo em Exportar se precisar.
                </p>
              </div>

              <Separator />

              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-body-sm font-semibold text-fg">Modo da importação</legend>
                <RadioGroup value={mode} onValueChange={setMode} className="flex flex-col gap-2">
                  {MODES.map((item) => (
                    <label
                      key={item.id}
                      className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 hfm-transition hover:border-border-strong"
                    >
                      <RadioGroupItem value={item.id} className="mt-0.5" />
                      <span>
                        <span className="block text-body-sm font-medium text-fg">{item.label}</span>
                        <span className="block text-caption text-fg-muted">{item.description}</span>
                      </span>
                    </label>
                  ))}
                </RadioGroup>
              </fieldset>

              <Alert variant="info">
                <AlertTitle>O que a importação não altera</AlertTitle>
                <AlertDescription>
                  Identidade técnica (placa, chassi, RENAVAM, código de frota), histórico de alocação,
                  última leitura de quilometragem homologada e permissões de usuários. Divergências
                  aparecem na pré-visualização com os dois valores lado a lado.
                </AlertDescription>
              </Alert>
            </>
          ) : null}

          {preview && !busy ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <FileSpreadsheet aria-hidden className="size-4 text-fg-muted" />
                <span className="text-body-sm font-medium text-fg">{preview.fileName}</span>
                <span className="text-caption text-fg-muted">planilha “{preview.sheetName}”</span>
              </div>

              {preview.alreadyImported ? (
                <Alert variant="warning">
                  <AlertTitle>Este arquivo já foi importado antes</AlertTitle>
                  <AlertDescription>
                    O conteúdo é idêntico a um lote já processado. Reimportar é permitido e não duplica
                    veículos, mas confira se é isso mesmo que se quer.
                  </AlertDescription>
                </Alert>
              ) : null}

              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Summary label="Linhas" value={preview.totalRows} />
                <Summary label="A cadastrar" value={preview.createRows} tone="success" />
                <Summary label="A atualizar" value={preview.updateRows} />
                <Summary label="Com atenção" value={preview.warningRows} tone="warning" />
                <Summary label="Com erro" value={preview.errorRows} tone="danger" />
                <Summary
                  label="Ignoradas"
                  value={Math.max(0, preview.totalRows - preview.createRows - preview.updateRows)}
                />
              </dl>

              {preview.assignmentDivergences > 0 || preview.odometerDivergences > 0 ? (
                <Alert variant="warning">
                  <AlertTitle>Divergências preservadas</AlertTitle>
                  <AlertDescription>
                    {preview.assignmentDivergences > 0 ? (
                      <p>
                        {preview.assignmentDivergences} linha(s) indicam operação ou cidade diferente da
                        alocação vigente. A alocação <strong>não</strong> será alterada — transferir é uma
                        movimentação com data de vigência.
                      </p>
                    ) : null}
                    {preview.odometerDivergences > 0 ? (
                      <p>
                        {preview.odometerDivergences} linha(s) trazem quilometragem diferente da leitura
                        homologada. A leitura <strong>não</strong> será alterada — corrigir exige motivo.
                      </p>
                    ) : null}
                  </AlertDescription>
                </Alert>
              ) : null}

              {preview.unmappedColumns.length > 0 ? (
                <p className="text-caption text-fg-muted">
                  Colunas não reconhecidas e ignoradas: {preview.unmappedColumns.join(", ")}.
                </p>
              ) : null}

              {preview.sample.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-body-sm font-semibold text-fg">Primeiras linhas</p>
                  <TableContainer>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead style={{ width: 64 }}>Linha</TableHead>
                          <TableHead style={{ width: 110 }}>Frota</TableHead>
                          <TableHead style={{ width: 110 }}>Placa</TableHead>
                          <TableHead style={{ width: 160 }}>Operação</TableHead>
                          <TableHead style={{ width: 110 }}>Ação</TableHead>
                          <TableHead style={{ width: 100 }}>Situação</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.sample.map((row) => (
                          <TableRow key={row.row_number}>
                            <TableCell className="tabular-nums">{row.row_number}</TableCell>
                            <TableCell>{row.fleetCode || "—"}</TableCell>
                            <TableCell>{row.plate || "—"}</TableCell>
                            <TableCell>{row.operation || "—"}</TableCell>
                            <TableCell>{ACTION_LABEL[row.action] ?? row.action}</TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  row.status === "error"
                                    ? "danger"
                                    : row.status === "warning"
                                      ? "warning"
                                      : "success"
                                }
                                size="sm"
                              >
                                {ROW_STATUS_LABEL[row.status] ?? row.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </div>
              ) : null}

              {preview.findings.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-body-sm font-semibold text-fg">
                    Inconsistências ({preview.findings.length})
                  </p>
                  <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
                    {preview.findings.map((finding, index) => (
                      <li
                        key={`${finding.row_number}-${finding.field}-${index}`}
                        className="flex items-start gap-2 text-caption"
                      >
                        <span
                          className={cn(
                            "mt-0.5 shrink-0",
                            finding.level === "error" ? "text-danger" : "text-warning",
                          )}
                          aria-hidden
                        >
                          {finding.level === "error" ? (
                            <AlertTriangle className="size-3.5" />
                          ) : (
                            <AlertTriangle className="size-3.5" />
                          )}
                        </span>
                        <span className="text-fg-secondary">
                          <span className="font-medium text-fg">Linha {finding.row_number ?? "—"}</span>
                          {finding.field ? ` · ${finding.field}` : ""} — {finding.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : null}
        </DrawerBody>

        <DrawerFooter>
          <Button variant="secondary" onClick={() => void discard()} disabled={busy}>
            {done ? "Fechar" : "Cancelar"}
          </Button>
          {!preview && !done ? (
            <Button leadingIcon={<Upload />} onClick={() => void submitFile()} disabled={!file || busy}>
              Analisar arquivo
            </Button>
          ) : null}
          {canConfirm ? (
            <Button leadingIcon={<CheckCircle2 />} onClick={() => void confirmImport()} disabled={busy}>
              Confirmar importação
            </Button>
          ) : null}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function Summary({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd
        className={cn(
          "text-h3 font-semibold tabular-nums",
          tone === "success" && value > 0 && "text-success",
          tone === "warning" && value > 0 && "text-warning",
          tone === "danger" && value > 0 && "text-danger",
          (tone === "neutral" || value === 0) && "text-fg",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
