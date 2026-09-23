"use client";

import * as React from "react";
import { ListChecks } from "lucide-react";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import { useConfirm } from "@/components/feedback/confirm-dialog";
import { NativeSelect } from "@/components/governance/selects";
import { decideRequestsBulk, type BulkDecisionOutcome, type BulkDecisionReport } from "@/lib/adherence/actions";
import type { AdherenceOptions, ChecklistContext } from "@/lib/adherence/queries";

export type BulkDecision = "approve" | "reject" | "reclassify";

export interface BulkDecisionDialogProps {
  open: boolean;
  decision: BulkDecision;
  /** Ids das solicitações pendentes selecionadas na tabela. */
  requestIds: string[];
  options: AdherenceOptions;
  /**
   * Contextos (saída/retorno) presentes na seleção. Um lote pode misturar os
   * dois; o novo motivo da reclassificação precisa valer para todos eles.
   */
  contexts?: ChecklistContext[];
  onOpenChange: (open: boolean) => void;
  /** Chamado após aplicar: quem chamou recarrega a lista e limpa a seleção. */
  onDone: () => void;
}

const DECISION_META: Record<BulkDecision, { title: string; description: string; verb: string; past: string }> = {
  approve: {
    title: "Aprovar em lote",
    description: "Aprova cada solicitação selecionada com o motivo que foi pedido. Uma solicitação cuja obrigação já tem checklist válido não é aprovada: a execução nunca é descartada.",
    verb: "aprovar",
    past: "aprovadas",
  },
  reject: {
    title: "Rejeitar em lote",
    description: "Rejeita as solicitações selecionadas com um único motivo, registrado em cada uma. Quem pediu precisa saber por quê.",
    verb: "rejeitar",
    past: "rejeitadas",
  },
  reclassify: {
    title: "Reclassificar em lote",
    description: "Aprova as solicitações selecionadas trocando o motivo pedido por outro. O novo motivo precisa valer para o contexto de cada uma.",
    verb: "reclassificar",
    past: "reclassificadas",
  },
};

/**
 * Rótulos em pt-BR das saídas da prévia (§57). A ordem é a ordem das linhas da
 * tabela: primeiro o que passa, depois cada razão de não passar.
 */
const OUTCOME_LABEL: Record<BulkDecisionOutcome, string> = {
  applicable: "Aplicáveis",
  applied: "Aplicadas",
  failed: "Falhou ao aplicar",
  not_pending: "Já decididas",
  own_request: "Solicitação própria",
  out_of_scope: "Fora do escopo",
  reason_not_applicable: "Motivo não aplicável",
  has_execution: "Com checklist válido (não pode aprovar)",
  evidence_missing: "Evidência ausente",
  not_found: "Não encontrada",
};
const OUTCOME_ORDER = Object.keys(OUTCOME_LABEL) as BulkDecisionOutcome[];
const OK_OUTCOMES: ReadonlySet<string> = new Set<BulkDecisionOutcome>(["applicable", "applied"]);

const EFFECT_LABEL: Record<string, string> = {
  exclude: "expurgo",
  count_done: "conta como feito",
  none: "sem efeito no indicador",
};

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

/**
 * Decisão em lote (§57). A prévia e a gravação são a mesma rotina do servidor,
 * chamada com `dryRun` e depois sem: cada item é classificado pelas mesmas
 * regras da decisão individual (§31, §32), e nada é aplicado sem que a pessoa
 * tenha visto o que passa e o que não passa. Conflitos são listados, nunca
 * ignorados por terem vindo em massa.
 */
export function BulkDecisionDialog({ open, decision, requestIds, options, contexts, onOpenChange, onDone }: BulkDecisionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        {open ? (
          // A chave remonta o formulário a cada abertura/decisão: estado novo,
          // sem prévia herdada de um lote anterior.
          <BulkDecisionForm
            key={decision}
            decision={decision}
            requestIds={requestIds}
            options={options}
            contexts={contexts ?? []}
            onOpenChange={onOpenChange}
            onDone={onDone}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function BulkDecisionForm({
  decision, requestIds, options, contexts, onOpenChange, onDone,
}: Omit<BulkDecisionDialogProps, "open" | "contexts"> & { contexts: ChecklistContext[] }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [running, startTransition] = React.useTransition();
  const [note, setNote] = React.useState("");
  const [newReason, setNewReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  // Relatório da gravação. Quando algum item não foi aplicado, o diálogo fica
  // aberto mostrando item a item — a pessoa fecha depois de ler.
  const [applied, setApplied] = React.useState<BulkDecisionReport | null>(null);

  const meta = DECISION_META[decision];

  // O motivo novo precisa valer para todo contexto presente na seleção.
  const reasons = React.useMemo(
    () => options.reasons.filter((r) =>
      r.isActive && contexts.every((c) => (c === "retorno" ? r.appliesToReturn : r.appliesToDeparture)),
    ),
    [options.reasons, contexts],
  );

  // A prévia carrega os insumos para os quais foi calculada. Comparar as
  // chaves é o que a invalida quando algo muda — aplicar com base numa prévia
  // de outra observação ou de outro motivo é exatamente o erro que ela existe
  // para evitar. (Mesma técnica do replicate-dialog das lideranças.)
  const [computed, setComputed] = React.useState<{ key: string; data: BulkDecisionReport } | null>(null);
  const inputKey = `${decision}|${requestIds.join(",")}|${note.trim()}|${newReason}`;
  const preview = computed?.key === inputKey ? computed.data : null;

  const noteMissing = decision === "reject" && !note.trim();
  const reasonMissing = decision === "reclassify" && !newReason;
  const canPreview = requestIds.length > 0 && !noteMissing && !reasonMissing;
  const applicable = preview?.counts.applicable ?? 0;

  const payload = () => ({
    requestIds,
    decision,
    note: note.trim() || null,
    newReasonCode: decision === "reclassify" ? newReason || null : null,
  });

  const runPreview = () => {
    setError(null);
    const key = inputKey;
    startTransition(async () => {
      const result = await decideRequestsBulk({ ...payload(), dryRun: true });
      if (!result.ok || !result.data) {
        setError(result.error ?? "Não foi possível calcular a prévia.");
        return;
      }
      setComputed({ key, data: result.data });
    });
  };

  const apply = async () => {
    if (!preview || applicable === 0) return;
    const skipped = preview.total - applicable;
    const ok = await confirm({
      title: `${meta.title}?`,
      description: `${applicable} solicitação(ões) serão ${meta.past}.${skipped > 0 ? ` Outras ${skipped} não passam nas regras e ficam como estão.` : ""} Cada decisão fica no histórico com quem decidiu e quando.`,
      confirmLabel: "Aplicar",
      destructive: decision === "reject",
    });
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const result = await decideRequestsBulk({ ...payload(), dryRun: false });
      if (!result.ok || !result.data) {
        setError(result.error ?? `Não foi possível ${meta.verb} as solicitações.`);
        return;
      }
      const report = result.data;
      const done = report.counts.applied ?? 0;
      const notApplied = report.total - done;
      toast({
        title: `${done} solicitações ${meta.past} · ${notApplied} não aplicadas`,
        variant: notApplied > 0 ? "warning" : "success",
      });
      onDone();
      if (notApplied > 0) {
        // §57: o que não foi aplicado é listado, não engolido.
        setApplied(report);
      } else {
        onOpenChange(false);
      }
    });
  };

  const report = applied ?? preview;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{meta.title}</DialogTitle>
        <DialogDescription>
          {applied
            ? `Resultado da aplicação em ${applied.total} solicitação(ões).`
            : `${requestIds.length} solicitação(ões) selecionada(s). ${meta.description}`}
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="flex flex-col gap-4">
        {error ? (
          <Alert variant="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {!applied ? (
          <>
            {decision === "reclassify" ? (
              <FormField label="Novo motivo" required id="bulk-reason"
                helperText={contexts.length > 1 ? "A seleção mistura saída e retorno: só motivos válidos nos dois contextos." : undefined}>
                <NativeSelect id="bulk-reason" value={newReason} disabled={running} onChange={(e) => setNewReason(e.target.value)}>
                  <option value="">Escolha…</option>
                  {reasons.map((r) => (
                    <option key={r.code} value={r.code}>{r.name} · {EFFECT_LABEL[r.effect] ?? r.effect}</option>
                  ))}
                </NativeSelect>
              </FormField>
            ) : null}

            {decision === "reject" ? (
              <FormField label="Motivo da rejeição" required id="bulk-note"
                helperText="Obrigatório na rejeição: fica registrado em cada solicitação para quem pediu.">
                <Textarea id="bulk-note" rows={3} value={note} disabled={running} onChange={(e) => setNote(e.target.value)} />
              </FormField>
            ) : (
              <FormField label="Observação" id="bulk-note" labelHint="Opcional" helperText="Fica no histórico de cada decisão.">
                <Textarea id="bulk-note" rows={2} value={note} disabled={running} onChange={(e) => setNote(e.target.value)} />
              </FormField>
            )}
          </>
        ) : null}

        {report ? (
          <BulkReport report={report} />
        ) : (
          <Alert variant="neutral" icon={<ListChecks />}>
            <AlertTitle>Nada é aplicado sem prévia</AlertTitle>
            <AlertDescription>
              Calcule a prévia para ver, item a item, o que passa nas regras e o que não passa. Só depois o botão Aplicar é liberado.
            </AlertDescription>
          </Alert>
        )}
      </DialogBody>

      <DialogFooter>
        {applied ? (
          <Button onClick={() => onOpenChange(false)}>Fechar</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={running}>Cancelar</Button>
            <Button variant="secondary" onClick={runPreview} loading={running} disabled={!canPreview}>
              Calcular prévia
            </Button>
            <Button
              variant={decision === "reject" ? "danger" : "primary"}
              onClick={() => void apply()}
              disabled={running || !preview || applicable === 0}
            >
              Aplicar
            </Button>
          </>
        )}
      </DialogFooter>
    </>
  );
}

/** Contagens por saída e a lista do que não passa (ou não foi aplicado). */
function BulkReport({ report }: { report: BulkDecisionReport }) {
  const rows = OUTCOME_ORDER
    .filter((o) => (report.preview ? o !== "applied" : o !== "applicable"))
    .map((o) => ({ outcome: o, count: report.counts[o] ?? 0 }))
    .filter((r) => OK_OUTCOMES.has(r.outcome) || r.count > 0);
  const conflicts = report.items.filter((it) => !OK_OUTCOMES.has(it.outcome));
  const okCount = (report.preview ? report.counts.applicable : report.counts.applied) ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <TableContainer>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{report.preview ? "Prévia" : "Resultado"}</TableHead>
              <TableHead className="text-right">Solicitações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.outcome}>
                <TableCell className={OK_OUTCOMES.has(r.outcome) ? "font-medium text-fg" : "text-fg-muted"}>
                  {OUTCOME_LABEL[r.outcome]}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {OK_OUTCOMES.has(r.outcome) ? <strong>{r.count}</strong> : <Badge variant="warning">{r.count}</Badge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {okCount === 0 && report.preview ? (
        <Alert variant="warning">
          <AlertDescription>Nenhuma das solicitações selecionadas passa nas regras. Nada será aplicado.</AlertDescription>
        </Alert>
      ) : null}

      {conflicts.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-caption font-medium text-fg-muted">
            {report.preview ? "Não serão aplicadas" : "Não foram aplicadas"} ({conflicts.length})
          </p>
          <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-border bg-surface-secondary p-2 text-body-sm">
            {conflicts.map((it) => (
              <li key={it.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <code className="text-caption text-fg-muted">{shortId(it.id)}</code>
                <span className="font-medium text-fg">{OUTCOME_LABEL[it.outcome] ?? it.outcome}</span>
                {it.message ? <span className="text-fg-muted">— {it.message}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
