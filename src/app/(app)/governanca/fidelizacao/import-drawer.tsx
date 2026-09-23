"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, Upload } from "lucide-react";
import {
  Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import { useConfirm } from "@/components/feedback/confirm-dialog";
import type { Result } from "@/lib/governance/actions";
import {
  confirmImport, deleteImportLayout, inspectImportFile, listImportLayouts, saveImportLayout,
  uploadAllocationImport, uploadBrImport,
  type AllocationImportPreview, type BrImportPreview, type ImportFileColumns, type ImportLayout,
  type ImportOutcome, type ImportPreview,
} from "@/lib/governance/import-actions";
import { ColumnMappingPanel, mappingProblems, type HeaderMapping } from "./import-mapping";
import {
  ALLOCATION_IMPORT_COLUMNS, BR_IMPORT_COLUMNS, type ImportKind,
} from "@/lib/governance/import-columns";

/**
 * Importação da Fidelização (Etapa 13, §56–§58).
 *
 * Dois arquivos, um fluxo: escolher o tipo, validar, ler a prévia, confirmar.
 * A prévia de alocações mostra as sete contagens da §58 antes de qualquer
 * gravação — existentes, novos, substituições, sobreposições, BRs
 * desconhecidas, veículos não encontrados e erros de competência — porque a
 * regra da etapa é que nada histórico seja sobrescrito em silêncio.
 *
 * `loaders` existe para a prévia de desenvolvimento (dados fixos, sem
 * Supabase); a tela real usa as server actions.
 */

export interface ImportLoaders {
  upload: (kind: ImportKind, formData: FormData) => Promise<Result<ImportPreview>>;
  confirm: (kind: ImportKind, batchId: string) => Promise<Result<ImportOutcome>>;
  /**
   * Mapeamento de colunas e layouts salvos (Etapa 15). Opcionais: sem
   * `inspect`, a gaveta reconhece as colunas só pelo nome, como na Etapa 13.
   */
  inspect?: (kind: ImportKind, formData: FormData) => Promise<Result<ImportFileColumns>>;
  listLayouts?: (kind: ImportKind) => Promise<Result<ImportLayout[]>>;
  saveLayout?: (kind: ImportKind, name: string, mapping: Record<string, string>) => Promise<Result<{ id: string }>>;
  deleteLayout?: (layoutId: string) => Promise<Result>;
}

export interface ImportDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Cadastro de BRs pelo arquivo exige também `fidelization.manage_brs`. */
  canImportBrs: boolean;
  initialKind?: ImportKind;
  loaders?: ImportLoaders;
  /** Rota base dos modelos; a prévia de desenvolvimento aponta para lugar nenhum. */
  exportPath?: string;
}

const defaultLoaders: ImportLoaders = {
  upload: (kind, formData) =>
    kind === "brs"
      ? (uploadBrImport(formData) as Promise<Result<ImportPreview>>)
      : (uploadAllocationImport(formData) as Promise<Result<ImportPreview>>),
  confirm: (kind, batchId) => confirmImport(kind, batchId),
  inspect: (kind, formData) => inspectImportFile(kind, formData),
  listLayouts: (kind) => listImportLayouts(kind),
  saveLayout: (kind, name, mapping) => saveImportLayout(kind, name, mapping),
  deleteLayout: (layoutId) => deleteImportLayout(layoutId),
};

const formatInt = (n: number) => n.toLocaleString("pt-BR");

function formatDate(value: string | null): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  return d ? `${d}/${m}/${y}` : value;
}

const ROW_STATUS: Record<string, { label: string; status: "success" | "warning" | "danger" }> = {
  valid: { label: "Válida", status: "success" },
  warning: { label: "Aviso", status: "warning" },
  error: { label: "Erro", status: "danger" },
};

const ACTION_LABEL: Record<string, string> = {
  create: "Criar", update: "Atualizar", skip: "Ignorar", substitute: "Substituir",
};

const STATUS_VALUE: Record<string, string> = {
  active: "Ativa", inactive: "Inativa",
  planned: "Planejado", confirmed: "Confirmado", executed: "Executado",
};

export function ImportDrawer({
  open,
  onOpenChange,
  canImportBrs,
  initialKind = "allocations",
  loaders = defaultLoaders,
  exportPath = "/governanca/fidelizacao/export",
}: ImportDrawerProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent size="xl" aria-describedby="fidelization-import-description">
        {open ? (
          <ImportBody
            key={initialKind}
            canImportBrs={canImportBrs}
            initialKind={initialKind}
            loaders={loaders}
            exportPath={exportPath}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}

function ImportBody({
  canImportBrs,
  initialKind,
  loaders,
  exportPath,
  onClose,
}: {
  canImportBrs: boolean;
  initialKind: ImportKind;
  loaders: ImportLoaders;
  exportPath: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [kind, setKind] = React.useState<ImportKind>(canImportBrs ? initialKind : "allocations");
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, startTransition] = React.useTransition();
  const [fileColumns, setFileColumns] = React.useState<ImportFileColumns | null>(null);
  const [headerMapping, setHeaderMapping] = React.useState<HeaderMapping>({});
  const [layouts, setLayouts] = React.useState<ImportLayout[]>([]);

  const columns = kind === "brs" ? BR_IMPORT_COLUMNS : ALLOCATION_IMPORT_COLUMNS;
  const problems = fileColumns ? mappingProblems(kind, headerMapping) : { missing: [], repeated: [] };
  const mappingBlocked = problems.missing.length > 0 || problems.repeated.length > 0;

  // Os layouts salvos são por tipo de arquivo: trocar o tipo recarrega a lista.
  const { listLayouts } = loaders;
  const [layoutsVersion, setLayoutsVersion] = React.useState(0);
  const reloadLayouts = () => setLayoutsVersion((v) => v + 1);
  React.useEffect(() => {
    if (!listLayouts) return;
    let active = true;
    listLayouts(kind).then((result) => {
      if (active) setLayouts(result.ok && result.data ? result.data : []);
    });
    return () => {
      active = false;
    };
  }, [listLayouts, kind, layoutsVersion]);

  /** Escolher o arquivo lê os cabeçalhos e sugere a ligação — antes de qualquer validação. */
  const inspectFile = (file: File | null) => {
    setPreview(null);
    setError(null);
    setFileColumns(null);
    setHeaderMapping({});
    if (!file || !loaders.inspect) return;
    const data = new FormData();
    data.set("file", file);
    startTransition(async () => {
      const result = await loaders.inspect!(kind, data);
      if (result.ok && result.data) {
        setFileColumns(result.data);
        setHeaderMapping(result.data.suggestion);
      } else {
        setError(result.error ?? "Não foi possível ler as colunas do arquivo.");
      }
    });
  };

  const saveLayout = async (name: string): Promise<boolean> => {
    if (!loaders.saveLayout) return false;
    const result = await loaders.saveLayout(kind, name, headerMapping);
    if (!result.ok) {
      setError(result.error ?? "Não foi possível salvar o layout.");
      return false;
    }
    toast({ title: `Layout "${name}" salvo.`, variant: "success" });
    reloadLayouts();
    return true;
  };

  const deleteLayout = async (layout: { id: string; name: string }): Promise<boolean> => {
    if (!loaders.deleteLayout) return false;
    const ok = await confirm({
      title: `Excluir o layout "${layout.name}"?`,
      description: "A ligação salva deixa de aparecer para todos da organização. Importações já feitas não mudam.",
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!ok) return false;
    const result = await loaders.deleteLayout(layout.id);
    if (!result.ok) {
      setError(result.error ?? "Não foi possível excluir o layout.");
      return false;
    }
    toast({ title: `Layout "${layout.name}" excluído.`, variant: "success" });
    reloadLayouts();
    return true;
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (fileColumns && mappingBlocked) return;
    const data = new FormData(event.currentTarget);
    if (fileColumns) data.set("mapping", JSON.stringify(headerMapping));
    setError(null);
    startTransition(async () => {
      const result = await loaders.upload(kind, data);
      if (result.ok && result.data) setPreview(result.data);
      else setError(result.error ?? "Não foi possível validar o arquivo.");
    });
  };

  const writable =
    preview?.kind === "brs"
      ? preview.createRows + preview.updateRows
      : preview?.kind === "allocations"
        ? preview.createRows + preview.substituteRows
        : 0;

  const apply = async () => {
    if (!preview) return;
    const description =
      preview.kind === "brs"
        ? `${formatInt(preview.createRows)} BR(s) serão criadas e ${formatInt(preview.updateRows)} atualizada(s). ${formatInt(preview.errorRows)} linha(s) com erro ficam de fora. A situação de uma BR existente não muda por importação.`
        : `${formatInt(preview.createRows)} vínculo(s) novo(s) e ${formatInt(preview.substituteRows)} substituição(ões). Sobreposições, BRs desconhecidas e veículos não encontrados ficam de fora; nenhum veículo é criado e nenhum vínculo histórico é sobrescrito.`;
    const ok = await confirm({
      title: "Confirmar a importação?",
      description,
      confirmLabel: "Importar",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await loaders.confirm(preview.kind, preview.batchId);
      if (result.ok && result.data) {
        const d = result.data;
        toast({
          title:
            preview.kind === "brs"
              ? `Importação concluída: ${formatInt(d.created)} criada(s), ${formatInt(d.updated)} atualizada(s), ${formatInt(d.skipped)} ignorada(s).`
              : `Importação concluída: ${formatInt(d.created)} vínculo(s) novo(s), ${formatInt(d.substituted)} substituição(ões), ${formatInt(d.skipped)} ignorada(s).`,
          variant: "success",
        });
        setPreview(null);
        formRef.current?.reset();
        router.refresh();
        onClose();
      } else {
        setError(result.error ?? "Não foi possível processar a importação.");
      }
    });
  };

  return (
    <>
      <DrawerHeader>
        <DrawerTitle>Importar fidelização</DrawerTitle>
        <DrawerDescription id="fidelization-import-description">
          XLSX ou CSV. O arquivo é validado antes de qualquer gravação e a prévia diz linha a linha o que vai acontecer.
        </DrawerDescription>
      </DrawerHeader>

      <DrawerBody className="flex flex-col gap-4">
        {canImportBrs ? (
          <Tabs
            value={kind}
            onValueChange={(v) => {
              setKind(v as ImportKind);
              setPreview(null);
              setError(null);
              setFileColumns(null);
              setHeaderMapping({});
              formRef.current?.reset();
            }}
          >
            <TabsList aria-label="Tipo de arquivo">
              <TabsTrigger value="allocations">Alocações de veículos</TabsTrigger>
              <TabsTrigger value="brs">Cadastro de BRs</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md border border-border p-3">
            <h4 className="mb-1 text-label font-semibold text-fg">Colunas reconhecidas</h4>
            <ul className="text-caption text-fg-muted">
              {columns.map((c) => (
                <li key={c.field}>
                  <span className="font-medium text-fg">{c.label}</span>
                  {c.required ? " *" : ""} — {c.hint}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-md border border-border p-3 text-caption text-fg-muted">
            <h4 className="mb-1 text-label font-semibold text-fg">O que a importação faz</h4>
            {kind === "brs" ? (
              <p>
                Cria BRs novas na operação e cidade informadas e atualiza descrição e observações das
                existentes. Não altera a situação de uma BR já cadastrada, não move BR de operação e recusa
                códigos ambíguos.
              </p>
            ) : (
              <p>
                Cria vínculos novos e executa substituições quando a BR já tem um titular que cobre a data
                inicial. Não cria veículos, BRs nem colaboradores; sobreposições ficam de fora; nenhum
                vínculo histórico é sobrescrito.
              </p>
            )}
            <a
              className="mt-2 inline-flex items-center gap-1.5 text-label font-medium text-primary hover:underline"
              href={`${exportPath}?tipo=${kind === "brs" ? "modelo-brs" : "modelo-alocacoes"}`}
            >
              <Download aria-hidden className="size-3.5" />
              Baixar modelo {kind === "brs" ? "de BRs" : "de alocações"}
            </a>
          </div>
        </div>

        <form ref={formRef} onSubmit={submit} className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            name="file"
            accept=".xlsx,.csv"
            required
            onChange={(e) => inspectFile(e.currentTarget.files?.[0] ?? null)}
            aria-label={kind === "brs" ? "Arquivo de BRs" : "Arquivo de alocações"}
            className="text-body-sm text-fg file:mr-3 file:rounded-sm file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-label file:text-fg hover:file:bg-secondary"
          />
          <Button
            type="submit"
            variant="secondary"
            leadingIcon={<Upload />}
            loading={busy}
            disabled={Boolean(fileColumns) && mappingBlocked}
          >
            Validar arquivo
          </Button>
        </form>

        {fileColumns ? (
          <ColumnMappingPanel
            kind={kind}
            headers={fileColumns.headers}
            rowCount={fileColumns.rowCount}
            mapping={headerMapping}
            onChange={(next) => {
              setHeaderMapping(next);
              setPreview(null);
            }}
            layouts={layouts}
            onSaveLayout={loaders.saveLayout ? saveLayout : undefined}
            onDeleteLayout={loaders.deleteLayout ? deleteLayout : undefined}
            busy={busy}
          />
        ) : null}

        {error ? (
          <Alert variant="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {preview ? <PreviewPanel preview={preview} /> : null}
      </DrawerBody>

      <DrawerFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Fechar
        </Button>
        <Button onClick={apply} disabled={!preview || writable === 0} loading={busy}>
          {preview ? `Importar ${formatInt(writable)} linha(s)` : "Importar"}
        </Button>
      </DrawerFooter>
    </>
  );
}

function PreviewPanel({ preview }: { preview: ImportPreview }) {
  return (
    <div className="flex flex-col gap-3" data-testid="import-preview">
      {preview.alreadyImported ? (
        <Alert variant="warning">
          <AlertDescription>
            Este mesmo arquivo já foi importado antes. Revalidar não duplica nada: o que já existe aparece como
            existente.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Badge variant="neutral">{preview.fileName} · {preview.sheetName}</Badge>
        <Badge variant="neutral">{formatInt(preview.totalRows)} linhas</Badge>
        <Badge variant="success">{formatInt(preview.validRows)} válidas</Badge>
        <Badge variant="warning">{formatInt(preview.warningRows)} avisos</Badge>
        <Badge variant="danger">{formatInt(preview.errorRows)} erros</Badge>
      </div>

      {preview.kind === "allocations" ? <Categories preview={preview} /> : <BrCounts preview={preview} />}

      <p className="text-caption text-fg-muted">
        Colunas mapeadas: {preview.mappedColumns.map((m) => `${m.header} → ${m.label}`).join(" · ")}
        {preview.unmappedColumns.length ? ` · ignoradas: ${preview.unmappedColumns.join(", ")}` : ""}
      </p>

      {preview.kind === "allocations" ? <AllocationSample preview={preview} /> : <BrSample preview={preview} />}

      {preview.findings.length ? (
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Linha</TableHead>
                <TableHead>Nível</TableHead>
                <TableHead>Campo</TableHead>
                <TableHead>Mensagem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.findings.map((f, i) => (
                <TableRow key={`${f.rowNumber}-${i}`}>
                  <TableCell className="tabular-nums">{f.rowNumber ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge size="sm" status={f.level === "error" ? "danger" : "warning"}>
                      {f.level === "error" ? "Erro" : "Aviso"}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="text-fg-muted">{f.field ?? "—"}</TableCell>
                  <TableCell>{f.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : null}
    </div>
  );
}

/** As sete contagens da §58, nomeadas como a especificação as nomeia. */
function Categories({ preview }: { preview: AllocationImportPreview }) {
  const c = preview.categories;
  const tiles: { label: string; value: number; tone: "neutral" | "success" | "warning" | "danger" | "primary" }[] = [
    { label: "Registros existentes", value: c.existing, tone: "neutral" },
    { label: "Novos vínculos", value: c.new, tone: "success" },
    { label: "Substituições", value: c.substitutions, tone: "primary" },
    { label: "Sobreposições", value: c.overlaps, tone: "danger" },
    { label: "BRs desconhecidas", value: c.unknownBrs, tone: "danger" },
    { label: "Veículos não encontrados", value: c.vehiclesNotFound, tone: "danger" },
    { label: "Erros de competência", value: c.competenceErrors, tone: "danger" },
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Resumo da prévia">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-md border border-border bg-surface p-2.5">
          <dt className="text-caption text-fg-muted">{t.label}</dt>
          <dd className="mt-0.5 flex items-center gap-2">
            <span className="text-h4 font-semibold tabular-nums text-fg">{formatInt(t.value)}</span>
            {t.value > 0 && t.tone !== "neutral" ? <Badge variant={t.tone} size="sm" appearance="soft">{t.tone === "danger" ? "fica de fora" : "será gravado"}</Badge> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function BrCounts({ preview }: { preview: BrImportPreview }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Badge variant="success">{formatInt(preview.createRows)} a criar</Badge>
      <Badge variant="primary">{formatInt(preview.updateRows)} a atualizar</Badge>
      <Badge variant="neutral">{formatInt(preview.skipRows)} já cadastradas sem alteração</Badge>
    </div>
  );
}

function BrSample({ preview }: { preview: BrImportPreview }) {
  return (
    <TableContainer>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Linha</TableHead>
            <TableHead>Situação</TableHead>
            <TableHead>Ação</TableHead>
            <TableHead>Operação</TableHead>
            <TableHead>Cidade</TableHead>
            <TableHead>Código BR</TableHead>
            <TableHead>Descrição</TableHead>
            <TableHead>Situação da BR</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {preview.sample.length === 0 ? (
            <TableEmpty colSpan={8} message="Sem linhas." />
          ) : (
            preview.sample.map((s) => {
              const rs = ROW_STATUS[s.status] ?? ROW_STATUS.error;
              return (
                <TableRow key={s.rowNumber}>
                  <TableCell className="tabular-nums">{s.rowNumber}</TableCell>
                  <TableCell><StatusBadge size="sm" status={rs.status}>{rs.label}</StatusBadge></TableCell>
                  <TableCell>{ACTION_LABEL[s.action] ?? s.action}</TableCell>
                  <TableCell>{s.operation ?? "—"}</TableCell>
                  <TableCell>{s.city ? `${s.city}${s.stateUf ? `/${s.stateUf}` : ""}` : "—"}</TableCell>
                  <TableCell className="font-medium">{s.code ?? "—"}</TableCell>
                  <TableCell className="text-fg-muted">{s.description ?? "—"}</TableCell>
                  <TableCell>
                    {s.currentStatus ? `${STATUS_VALUE[s.currentStatus] ?? s.currentStatus} (HFM)` : (STATUS_VALUE[s.statusValue ?? ""] ?? "—")}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function AllocationSample({ preview }: { preview: AllocationImportPreview }) {
  return (
    <TableContainer>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Linha</TableHead>
            <TableHead>Situação</TableHead>
            <TableHead>Ação</TableHead>
            <TableHead>BR</TableHead>
            <TableHead>Frota / Placa</TableHead>
            <TableHead>Período</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Situação do vínculo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {preview.sample.length === 0 ? (
            <TableEmpty colSpan={8} message="Sem linhas." />
          ) : (
            preview.sample.map((s) => {
              const rs = ROW_STATUS[s.status] ?? ROW_STATUS.error;
              return (
                <TableRow key={s.rowNumber}>
                  <TableCell className="tabular-nums">{s.rowNumber}</TableCell>
                  <TableCell><StatusBadge size="sm" status={rs.status}>{rs.label}</StatusBadge></TableCell>
                  <TableCell>
                    {ACTION_LABEL[s.action] ?? s.action}
                    {s.action === "substitute" && s.previousVehicle ? (
                      <span className="block text-caption text-fg-muted">sai {s.previousVehicle}</span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">{s.brCode ?? "—"}</span>
                    {s.operation ? (
                      <span className="block text-caption text-fg-muted">{s.city ? `${s.city} · ` : ""}{s.operation}</span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {s.fleetCode ?? "—"}
                    {s.licensePlate ? <span className="text-fg-muted"> {s.licensePlate}</span> : null}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatDate(s.startDate)} — {s.endDate ? formatDate(s.endDate) : "em aberto"}
                  </TableCell>
                  <TableCell>{s.vehicleRole === "support" ? "Apoio" : s.vehicleRole === "primary" ? "Titular" : "—"}</TableCell>
                  <TableCell>{STATUS_VALUE[s.statusValue ?? ""] ?? s.statusValue ?? "—"}</TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
