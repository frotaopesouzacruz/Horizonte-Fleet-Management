"use client";

import * as React from "react";
import { Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { NativeSelect } from "@/components/governance/selects";
import {
  ALLOCATION_IMPORT_COLUMNS, ALLOCATION_REQUIRED, BR_IMPORT_COLUMNS, BR_REQUIRED, normalizeHeader,
  type ImportKind,
} from "@/lib/governance/import-columns";

/** Um layout salvo, como a tela o recebe (a chave é o cabeçalho normalizado). */
export interface MappingLayout {
  id: string;
  name: string;
  mapping: Record<string, string>;
}

/** Cabeçalho do arquivo → campo do HFM ("" = ignorar a coluna). */
export type HeaderMapping = Record<string, string>;

/** O que falta e o que se repete na ligação atual — o que impede validar o arquivo. */
export function mappingProblems(kind: ImportKind, mapping: HeaderMapping): { missing: string[]; repeated: string[] } {
  const columns = kind === "brs" ? BR_IMPORT_COLUMNS : ALLOCATION_IMPORT_COLUMNS;
  const required = kind === "brs" ? BR_REQUIRED : ALLOCATION_REQUIRED;
  const chosen = Object.values(mapping).filter(Boolean);
  const taken = new Set<string>(chosen);
  const missing = required
    .filter((group) => !group.fields.some((f) => taken.has(f)))
    .map((group) => group.label);
  const counts = new Map<string, number>();
  for (const field of chosen) counts.set(field, (counts.get(field) ?? 0) + 1);
  const repeated = [...counts.entries()]
    .filter(([, n]) => n > 1)
    .map(([field]) => (columns as { field: string; label: string }[]).find((c) => c.field === field)?.label ?? field);
  return { missing, repeated };
}

/** Aplica um layout salvo às colunas deste arquivo; as que o layout não conhece ficam como estavam. */
export function applyLayout(headers: string[], current: HeaderMapping, layout: MappingLayout): HeaderMapping {
  const next: HeaderMapping = { ...current };
  for (const header of headers) {
    const key = normalizeHeader(header);
    if (Object.prototype.hasOwnProperty.call(layout.mapping, key)) next[header] = layout.mapping[key];
  }
  return next;
}

export interface ColumnMappingPanelProps {
  kind: ImportKind;
  headers: string[];
  rowCount: number;
  mapping: HeaderMapping;
  onChange: (mapping: HeaderMapping) => void;
  layouts: MappingLayout[];
  /** Salvar e excluir layouts; sem estes, a escolha de layout continua disponível. */
  onSaveLayout?: (name: string) => Promise<boolean>;
  onDeleteLayout?: (layout: MappingLayout) => Promise<boolean>;
  busy: boolean;
}

/**
 * Mapeamento de colunas da importação (Etapa 15, §47–§49).
 *
 * Cada coluna do arquivo aparece com o campo do HFM a que está ligada — a
 * sugestão vem dos nomes aceitos, e a pessoa pode trocar, ignorar ou aplicar
 * um layout salvo. Um campo não pode receber duas colunas, e os obrigatórios
 * precisam estar ligados antes de validar: o que falta fica escrito aqui, não
 * num erro depois do envio.
 */
export function ColumnMappingPanel({
  kind,
  headers,
  rowCount,
  mapping,
  onChange,
  layouts,
  onSaveLayout,
  onDeleteLayout,
  busy,
}: ColumnMappingPanelProps) {
  const columns = (kind === "brs" ? BR_IMPORT_COLUMNS : ALLOCATION_IMPORT_COLUMNS) as {
    field: string;
    label: string;
    required: boolean;
  }[];
  const [layoutId, setLayoutId] = React.useState("");
  const [name, setName] = React.useState("");
  const selected = layouts.find((l) => l.id === layoutId) ?? null;
  const { missing, repeated } = mappingProblems(kind, mapping);
  const counts = new Map<string, number>();
  for (const field of Object.values(mapping)) if (field) counts.set(field, (counts.get(field) ?? 0) + 1);

  return (
    <section aria-labelledby="import-mapping-title" className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 id="import-mapping-title" className="text-label font-semibold text-fg">
          Colunas do arquivo
        </h4>
        <span className="text-caption text-fg-muted">
          {headers.length} coluna(s) · {rowCount.toLocaleString("pt-BR")} linha(s) de dados
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <FormField label="Layout salvo" className="w-full sm:w-64">
          <NativeSelect
            fieldSize="sm"
            value={layoutId}
            disabled={busy || layouts.length === 0}
            onChange={(e) => {
              setLayoutId(e.target.value);
              const layout = layouts.find((l) => l.id === e.target.value);
              if (layout) {
                onChange(applyLayout(headers, mapping, layout));
                setName(layout.name);
              }
            }}
          >
            <option value="">{layouts.length === 0 ? "Nenhum layout salvo" : "Escolha um layout"}</option>
            {layouts.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        {onDeleteLayout && selected ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            leadingIcon={<Trash2 />}
            disabled={busy}
            onClick={async () => {
              if (await onDeleteLayout(selected)) {
                setLayoutId("");
                setName("");
              }
            }}
          >
            Excluir layout
          </Button>
        ) : null}
      </div>

      <TableContainer>
        <Table aria-label="Ligação das colunas do arquivo">
          <TableHeader>
            <TableRow>
              <TableHead>Coluna no arquivo</TableHead>
              <TableHead style={{ width: "55%" }}>Campo no HFM</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {headers.map((header) => {
              const field = mapping[header] ?? "";
              const clash = field !== "" && (counts.get(field) ?? 0) > 1;
              return (
                <TableRow key={header}>
                  <TableCell className="font-medium text-fg">{header}</TableCell>
                  <TableCell>
                    <NativeSelect
                      fieldSize="sm"
                      aria-label={`Campo da coluna ${header}`}
                      aria-invalid={clash || undefined}
                      value={field}
                      disabled={busy}
                      onChange={(e) => onChange({ ...mapping, [header]: e.target.value })}
                    >
                      <option value="">Ignorar coluna</option>
                      {columns.map((c) => (
                        <option key={c.field} value={c.field}>
                          {c.label}
                          {c.required ? " *" : ""}
                        </option>
                      ))}
                    </NativeSelect>
                    {clash ? (
                      <span className="mt-1 block text-caption text-danger">Campo ligado a mais de uma coluna.</span>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {missing.length || repeated.length ? (
        <Alert variant="warning">
          <AlertDescription>
            {missing.length ? <>Ligue as colunas obrigatórias: {missing.join(", ")}. </> : null}
            {repeated.length ? <>Cada campo recebe uma coluna só: {repeated.join(", ")}.</> : null}
          </AlertDescription>
        </Alert>
      ) : (
        <p className="text-caption text-fg-muted">Todas as colunas obrigatórias estão ligadas.</p>
      )}

      {onSaveLayout ? (
        <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
          <FormField
            label="Salvar esta ligação como layout"
            helperText="O mesmo nome atualiza o layout existente."
            className="w-full sm:w-64"
          >
            <Input
              size="sm"
              value={name}
              maxLength={80}
              placeholder="Ex.: Planilha do cliente"
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            leadingIcon={<Save />}
            disabled={busy || !name.trim() || repeated.length > 0}
            onClick={async () => {
              if (await onSaveLayout(name.trim())) setName(name.trim());
            }}
          >
            Salvar layout
          </Button>
        </div>
      ) : null}
    </section>
  );
}
