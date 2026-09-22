"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, CircleSlash } from "lucide-react";
import {
  Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import { ScopePicker, type CoverageEntry } from "@/components/governance/scope-picker";
import { createBrsBatch, type BatchBrResult } from "@/lib/governance/actions";

export interface BrBatchDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  operations: { id: string; name: string; status: string }[];
  coverage: CoverageEntry[];
}

const RESULT_LABEL: Record<string, string> = {
  create: "Entra",
  exists: "Já cadastrada",
  duplicated_in_batch: "Repetida na lista",
  invalid: "Inválida",
};

/**
 * Multicadastro de BRs (§17 e §18).
 *
 * Uma cidade tem várias posições, e cadastrá-las uma a uma significava repetir
 * a seleção de operação e cidade quatro, oito, quarenta vezes. Aqui o local é
 * escolhido uma vez e os códigos vêm em lista.
 *
 * Nada é gravado antes da prévia (§58). A prévia não é um resumo otimista: ela
 * é a mesma contagem que a gravação fará, vinda da mesma rotina no banco, com
 * `dry_run` ligado — então o que ela promete é o que acontece.
 */
export function BrBatchDrawer({ open, onOpenChange, operations, coverage }: BrBatchDrawerProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const [operationId, setOperationId] = React.useState(
    () => operations.find((o) => o.status === "active")?.id ?? "",
  );
  const [operationCityId, setOperationCityId] = React.useState<string | null>(null);
  const [raw, setRaw] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [preview, setPreview] = React.useState<BatchBrResult | null>(null);

  /**
   * Um código por linha, e também separados por vírgula ou ponto e vírgula —
   * porque a lista quase sempre chega colada de uma planilha, e recusá-la por
   * causa do separador seria pedir que a pessoa reformate à mão.
   */
  const codes = React.useMemo(
    () =>
      raw
        .split(/[\n,;]+/)
        .map((c) => c.trim())
        .filter(Boolean),
    [raw],
  );

  // A prévia vale para a lista que a gerou. Mudou a lista ou o local, ela é
  // descartada — mostrar a antiga seria mostrar uma promessa vencida.
  const previewKey = `${operationId}|${operationCityId ?? ""}|${codes.join("|")}`;
  const [validFor, setValidFor] = React.useState("");
  const current = validFor === previewKey ? preview : null;

  const run = (dryRun: boolean) => {
    setError(null);
    if (!operationCityId) return setError("Escolha a operação e a cidade das BRs.");
    if (codes.length === 0) return setError("Informe ao menos um código de BR.");

    startTransition(async () => {
      const result = await createBrsBatch({
        operationId,
        operationCityId,
        codes,
        description: description.trim() || undefined,
        dryRun,
      });

      if (!result.ok || !result.data) {
        setError(result.error ?? "Não foi possível cadastrar as BRs.");
        return;
      }

      if (dryRun) {
        setPreview(result.data);
        setValidFor(previewKey);
        return;
      }

      toast({
        title:
          result.data.created === 1
            ? "1 posição operacional cadastrada."
            : `${result.data.created} posições operacionais cadastradas.`,
        variant: "success",
      });
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent size="lg">
        <DrawerHeader>
          <DrawerTitle>Cadastrar BRs em lote</DrawerTitle>
          <DrawerDescription>
            Escolha o local uma vez e informe os códigos. Nada é gravado antes de você ver a
            prévia do que entra e do que já existe.
          </DrawerDescription>
        </DrawerHeader>

        <DrawerBody className="flex flex-col gap-4">
          {error ? (
            <Alert variant="danger">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <ScopePicker
            operations={operations}
            coverage={coverage}
            depth="city"
            value={{ operationId, operationCityId, operationBrId: null }}
            onChange={(scope) => {
              setOperationId(scope.operationId);
              setOperationCityId(scope.operationCityId);
            }}
          />

          <FormField
            label="Códigos das BRs"
            required
            id="br-batch-codes"
            helperText="Um por linha. Vírgula e ponto e vírgula também separam."
          >
            <Textarea
              id="br-batch-codes"
              rows={6}
              value={raw}
              placeholder={"BR001\nBR002\nBR003"}
              onChange={(e) => setRaw(e.target.value)}
            />
          </FormField>

          <FormField
            label="Descrição"
            id="br-batch-description"
            labelHint="Opcional"
            helperText="Aplicada a todas as posições deste lote."
          >
            <Input
              id="br-batch-description"
              value={description}
              maxLength={240}
              onChange={(e) => setDescription(e.target.value)}
            />
          </FormField>

          {codes.length > 0 ? (
            <p className="text-caption text-fg-muted">
              {codes.length === 1 ? "1 código informado." : `${codes.length} códigos informados.`}
            </p>
          ) : null}

          {current ? (
            <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-secondary p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="success">{current.created} entram</Badge>
                {current.existing > 0 ? (
                  <Badge variant="neutral">{current.existing} já existem</Badge>
                ) : null}
                {current.invalid > 0 ? (
                  <Badge variant="warning">{current.invalid} com problema</Badge>
                ) : null}
              </div>
              <ul className="flex flex-col gap-1">
                {current.details.map((line, index) => (
                  <li
                    key={`${line.code}-${index}`}
                    className="flex items-start gap-2 text-body-sm text-fg-secondary"
                  >
                    {line.result === "create" ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                    ) : line.result === "exists" ? (
                      <CircleSlash className="mt-0.5 size-4 shrink-0 text-fg-muted" aria-hidden />
                    ) : (
                      <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                    )}
                    <span className="font-medium text-fg">{line.code}</span>
                    <span className="text-fg-muted">
                      {RESULT_LABEL[line.result] ?? line.result}
                      {line.detail ? ` — ${line.detail}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </DrawerBody>

        <DrawerFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button variant="secondary" onClick={() => run(true)} loading={pending && !current}>
            Ver prévia
          </Button>
          <Button
            onClick={() => run(false)}
            disabled={!current || current.created === 0}
            loading={pending && Boolean(current)}
          >
            {current ? `Cadastrar ${current.created}` : "Cadastrar"}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
