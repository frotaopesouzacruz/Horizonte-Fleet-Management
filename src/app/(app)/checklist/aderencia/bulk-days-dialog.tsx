"use client";

import * as React from "react";
import { Calculator, CheckCheck } from "lucide-react";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import { useConfirm } from "@/components/feedback/confirm-dialog";
import { NativeSelect } from "@/components/governance/selects";
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  bulkOverride, selectObligationsForDays, type BulkOverrideReport, type SelectedObligations,
} from "@/lib/adherence/actions";
import type { AdherenceOptions, ChecklistContext } from "@/lib/adherence/queries";
import { CONTEXT_LABEL, formatDateBr, formatInt, statusMeta } from "./status";
import type { AdherenceFilterState } from "./adherence-view";

export interface BulkDaysDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dias selecionados na matriz (YYYY-MM-DD), já ordenados. */
  dates: string[];
  context: ChecklistContext;
  filters: AdherenceFilterState;
  options: AdherenceOptions;
  onChanged: () => void;
}

/** Rótulos dos resultados da prévia, na ordem em que a §40 os explica. */
const COUNT_ROWS: { key: string; label: string; hint: string }[] = [
  { key: "applied", label: "Aplicáveis", hint: "recebem o motivo e a justificativa" },
  { key: "has_execution", label: "Com execução", hint: "checklist válido registrado; ficam como estão" },
  { key: "already_excluded", label: "Já expurgadas", hint: "expurgo aprovado anterior prevalece" },
  { key: "pending_request", label: "Com solicitação pendente", hint: "a solicitação em análise decide primeiro" },
  { key: "future", label: "Futuras", hint: "planejamento, nunca descumprimento" },
  { key: "reason_not_applicable", label: "Motivo não aplicável", hint: "o motivo não vale para este contexto" },
  { key: "out_of_scope", label: "Fora do escopo", hint: "fora do seu perfil de acesso" },
];

/**
 * Alteração em massa por dias da matriz (§40).
 *
 * Nunca silenciosa e nunca "todos os dias": a seleção explícita dos dias vem
 * da matriz, a lista de obrigações vem do servidor com os mesmos filtros da
 * tela, e a prévia é a mesma rotina da aplicação, chamada com `dryRun` — uma
 * segunda contagem seria uma segunda implementação da regra. Só as obrigações
 * elegíveis mudam: com execução válida, expurgo aprovado, solicitação
 * pendente ou data futura ficam como estão.
 */
export function BulkDaysDialog({ open, onOpenChange, dates, context, filters, options, onChanged }: BulkDaysDialogProps) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [running, startTransition] = React.useTransition();

  const [reasonCode, setReasonCode] = React.useState("");
  const [justification, setJustification] = React.useState("");

  // Chaves serializadas: `dates` e `filters` são objetos novos a cada render,
  // e a seleção só deve ser refeita quando o que está na URL muda. A resposta
  // do servidor carrega a chave para a qual foi pedida; uma resposta atrasada
  // de outra seleção é simplesmente ignorada, sem estado a "limpar".
  const datesKey = dates.join(",");
  const filtersKey = JSON.stringify(filters);
  const requestKey = `${datesKey}|${context}|${filtersKey}`;
  const [fetched, setFetched] = React.useState<{ key: string; data: SelectedObligations | null; error: string | null } | null>(null);
  const selection = fetched?.key === requestKey ? fetched.data : null;
  const selectionError = fetched?.key === requestKey ? fetched.error : null;

  // Motivos que um ajuste em massa pode aplicar: ativos, que valem no contexto
  // em tela e que não "contam como feito" — esse efeito exige evidência por
  // obrigação e o banco o recusa em lote.
  const reasons = React.useMemo(
    () => options.reasons.filter((r) =>
      r.isActive && r.effect !== "count_done" && (context === "saida" ? r.appliesToDeparture : r.appliesToReturn)),
    [options.reasons, context],
  );

  // A prévia carrega a chave dos dados para os quais foi calculada; mudar
  // motivo, justificativa ou seleção a invalida (mesma técnica de
  // replicate-dialog): confirmar uma contagem de outros dados é o erro que a
  // prévia existe para evitar.
  const [computed, setComputed] = React.useState<{ key: string; data: BulkOverrideReport } | null>(null);
  const idsKey = selection?.ids.join(",") ?? "";
  const inputKey = `${idsKey}|${reasonCode}|${justification.trim()}`;
  const preview = computed?.key === inputKey ? computed.data : null;
  // O erro da prévia/aplicação também é da entrada que o produziu: mudar algo o dispensa.
  const [failure, setFailure] = React.useState<{ key: string; message: string } | null>(null);
  const error = failure?.key === inputKey ? failure.message : null;
  const setError = (message: string | null) => setFailure(message ? { key: inputKey, message } : null);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const input = { dates: datesKey ? datesKey.split(",") : [], context, filters: JSON.parse(filtersKey) as AdherenceFilterState };
    void selectObligationsForDays(input)
      .then((result) => {
        if (cancelled) return;
        setFetched(result.ok && result.data
          ? { key: requestKey, data: result.data, error: null }
          : { key: requestKey, data: null, error: result.error ?? "Não foi possível selecionar as obrigações dos dias." });
      })
      .catch(() => {
        if (!cancelled) setFetched({ key: requestKey, data: null, error: "Não foi possível selecionar as obrigações dos dias." });
      });
    return () => { cancelled = true; };
  }, [open, datesKey, context, filtersKey, requestKey]);

  const justificationOk = justification.trim().length >= 10;
  const canPreview = !!selection && selection.ids.length > 0 && !!reasonCode && justificationOk;

  const runPreview = () => {
    if (!selection) return;
    setError(null);
    startTransition(async () => {
      const result = await bulkOverride({ obligationIds: selection.ids, reasonCode, justification: justification.trim(), dryRun: true });
      if (result.ok && result.data) setComputed({ key: inputKey, data: result.data });
      else setError(result.error ?? "Não foi possível calcular a prévia.");
    });
  };

  const apply = async () => {
    if (!selection || !preview) return;
    const applicable = preview.counts.applied ?? 0;
    const ok = await confirm({
      title: `Aplicar a ${formatInt(applicable)} ${applicable === 1 ? "obrigação" : "obrigações"}?`,
      description: `Motivo "${reasons.find((r) => r.code === reasonCode)?.name ?? reasonCode}" em ${formatInt(dates.length)} ${dates.length === 1 ? "dia" : "dias"} de ${CONTEXT_LABEL[context].toLowerCase()}. As demais ${formatInt(preview.total - applicable)} ficam como estão. A alteração fica registrada com a justificativa e o seu nome.`,
      confirmLabel: "Aplicar",
    });
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const result = await bulkOverride({ obligationIds: selection.ids, reasonCode, justification: justification.trim(), dryRun: false });
      if (!result.ok || !result.data) {
        setError(result.error ?? "Não foi possível aplicar a alteração em massa.");
        return;
      }
      const c = result.data.counts;
      toast({
        title: `Alteração aplicada a ${formatInt(c.applied ?? 0)} de ${formatInt(result.data.total)} obrigações.`,
        description: `${formatInt(c.has_execution ?? 0)} com execução · ${formatInt(c.already_excluded ?? 0)} já expurgadas · ${formatInt(c.pending_request ?? 0)} com solicitação pendente · ${formatInt(c.future ?? 0)} futuras ficaram como estavam.`,
        variant: "success",
      });
      onOpenChange(false);
      setJustification("");
      setReasonCode("");
      setComputed(null);
      onChanged();
    });
  };

  const daysLabel = dates.length === 1
    ? formatDateBr(dates[0])
    : `${formatInt(dates.length)} dias (${formatDateBr(dates[0])} a ${formatDateBr(dates[dates.length - 1])})`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Alterar em massa</DialogTitle>
          <DialogDescription>
            {CONTEXT_LABEL[context]} · {daysLabel} · com os filtros atuais. Só as obrigações elegíveis são alteradas: com execução válida, expurgo aprovado, solicitação pendente ou data futura ficam como estão.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          {error ? (
            <Alert variant="danger"><AlertDescription>{error}</AlertDescription></Alert>
          ) : null}

          {selectionError ? (
            <Alert variant="danger"><AlertDescription>{selectionError}</AlertDescription></Alert>
          ) : selection ? (
            <Alert variant={selection.truncated ? "warning" : "neutral"}>
              <AlertTitle>
                {formatInt(selection.total)} {selection.total === 1 ? "obrigação" : "obrigações"} nos dias selecionados · {formatInt(selection.eligible)} elegíveis
              </AlertTitle>
              <AlertDescription>
                {Object.keys(selection.byStatus).length > 0 ? (
                  <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
                    {Object.entries(selection.byStatus).map(([code, n]) => (
                      <li key={code}>{statusMeta(code).label}: <strong>{formatInt(n)}</strong></li>
                    ))}
                  </ul>
                ) : null}
                {selection.truncated ? (
                  <p className="mt-1">Seleção truncada a 500 obrigações: reduza os dias ou aperte os filtros para alcançar as demais.</p>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : (
            <p className="text-caption text-fg-muted" role="status">Selecionando as obrigações dos dias…</p>
          )}

          <FormField label="Motivo" id="bulk-reason" required helperText="Só motivos ativos que valem neste contexto; “conta como feito” não se aplica em lote.">
            <NativeSelect id="bulk-reason" value={reasonCode} disabled={running} onChange={(e) => setReasonCode(e.target.value)}>
              <option value="">Escolha o motivo</option>
              {reasons.map((r) => (
                <option key={r.id} value={r.code}>{r.name}{r.effect === "exclude" ? " · expurga" : " · só registra"}</option>
              ))}
            </NativeSelect>
          </FormField>

          <FormField
            label="Justificativa"
            id="bulk-justification"
            required
            helperText="Mínimo de 10 caracteres. Fica registrada em cada obrigação alterada."
            error={justification.length > 0 && !justificationOk ? "A justificativa precisa ter ao menos 10 caracteres." : undefined}
          >
            <Textarea id="bulk-justification" rows={3} value={justification} disabled={running} onChange={(e) => setJustification(e.target.value)} />
          </FormField>

          {preview ? (
            <div className="flex flex-col gap-2">
              <p className="text-label font-semibold text-fg">Prévia: {formatInt(preview.counts.applied ?? 0)} de {formatInt(preview.total)} seriam alteradas</p>
              <TableContainer>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Resultado</TableHead>
                      <TableHead className="text-right">Obrigações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {COUNT_ROWS.map((row) => (
                      <TableRow key={row.key}>
                        <TableCell>
                          <span className="font-medium text-fg">{row.label}</span>
                          <span className="block text-caption text-fg-muted">{row.hint}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatInt(preview.counts[row.key] ?? 0)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </div>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={running}>Cancelar</Button>
          <Button variant="secondary" leadingIcon={<Calculator />} onClick={runPreview} loading={running} disabled={!canPreview}>
            Calcular prévia
          </Button>
          <Button leadingIcon={<CheckCheck />} onClick={() => void apply()} loading={running}
            disabled={!preview || (preview.counts.applied ?? 0) === 0}>
            Aplicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
