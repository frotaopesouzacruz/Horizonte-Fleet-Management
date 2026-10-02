"use client";

import * as React from "react";
import { FileSpreadsheet, ShieldCheck, Upload, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { KM_SHEET_COLUMNS, KM_SHEET_NAME, KM_SOURCE_FILE } from "@/lib/km/import-sheet";
import { fmtBytes } from "./shared";

/**
 * Fonte oficial, colunas esperadas, o que a importação nunca faz e a área de
 * arrastar/soltar o arquivo.
 */

export function KmSourceInfo({ testId }: { testId: string }) {
  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      <p className="flex items-start gap-1.5 text-body-sm text-fg">
        <FileSpreadsheet className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
        <span data-testid={`${testId}-fonte`}>
          <span className="font-semibold">Fonte oficial:</span> {KM_SOURCE_FILE} → aba {KM_SHEET_NAME}
        </span>
      </p>
      <p className="text-body-sm text-fg-secondary">
        Só a aba <span className="font-medium text-fg">{KM_SHEET_NAME}</span> é lida (nome exato, sem diferenciar acento,
        maiúsculas ou espaços). Outras abas do arquivo — Planner, Base Frotas Leves, Geotab, Mob7 — nunca são usadas como
        fonte. O cabeçalho é procurado nas primeiras 40 linhas; cada linha leva o seu número real na planilha.
      </p>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-caption font-semibold text-fg-secondary">Campos esperados</h3>
        <ul className="flex flex-wrap gap-1.5" aria-label="Colunas esperadas na aba Controle KM Rodado">
          {KM_SHEET_COLUMNS.map((c) => (
            <li key={c.field}>
              <Badge variant={c.required ? "primary" : "neutral"} size="md" title={c.hint}>
                {c.label}
                {c.required ? <span className="sr-only"> (obrigatória)</span> : null}
                {c.required ? <span aria-hidden>*</span> : null}
              </Badge>
            </li>
          ))}
        </ul>
        <p className="text-caption text-fg-muted">
          * obrigatória. &ldquo;Hodômetro Final&rdquo; vale como Hodômetro Fim. Datas do Excel viram data; números seguem
          como número; texto (&ldquo;57.629,6&rdquo;) é lido no padrão brasileiro pelo banco.
        </p>
      </div>
      <Alert variant="neutral" icon={<ShieldCheck />}>
        <AlertTitle>O que a importação nunca faz</AlertTitle>
        <AlertDescription>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li>
              alterar o Cadastro de Frotas: Frota, Tipo e Modelo da planilha só são comparados com o cadastro e, se
              diferentes, viram <span className="font-medium">divergência cadastral</span> (alerta);
            </li>
            <li>criar veículos: placa não cadastrada fica de fora e aparece na prévia;</li>
            <li>sobrescrever uma correção manual feita no HFM sem aviso — ela é preservada e listada;</li>
            <li>transformar ausência de leitura em 0 km: Sem leitura é diferente de Sem movimento;</li>
            <li>duplicar: reimportar o mesmo arquivo é reconhecido pelo SHA-256 e pela chave veículo + data.</li>
          </ul>
        </AlertDescription>
      </Alert>
    </div>
  );
}

export function KmDropzone({
  file,
  onFile,
  disabled,
  testId,
}: {
  file: File | null;
  onFile: (file: File | null) => void;
  disabled?: boolean;
  testId: string;
}) {
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
        data-testid={testId}
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
          data-testid={`${testId}-input`}
        />
        <Upload className="size-6 text-fg-muted" aria-hidden />
        <span className="text-body font-medium text-fg">
          Arraste o arquivo aqui ou <span className="text-link underline underline-offset-4">escolha no computador</span>
        </span>
        <span id={hintId} className="text-caption text-fg-muted">
          {KM_SOURCE_FILE} (.xlsx), sem limite de linhas. Nada é gravado antes da sua confirmação.
        </span>
      </label>

      {file ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2"
          data-testid={`${testId}-arquivo`}
        >
          <FileSpreadsheet className="size-4 shrink-0 text-accent" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-fg" title={file.name}>
            {file.name}
          </span>
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
