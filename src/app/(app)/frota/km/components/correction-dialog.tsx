"use client";

import * as React from "react";
import { CheckCheck, History, PencilLine } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import {
  correctReading, loadReadingSource, reviewReading, type KmReadingSource,
} from "@/lib/km/quality-actions";
import { formatDate, fmt2, fmtKm1, KM_ALERT_LABEL, kmStatusLabel, kmStatusTone, type KmAlert } from "@/lib/km/types";

/**
 * Correção manual auditada de uma leitura diária (km_correct_reading).
 *
 * Mostra o que a fonte informou (importado, nunca apagado) ao lado do que vale
 * hoje, pede os hodômetros novos e o motivo, e grava pela rotina — que
 * reclassifica a leitura, registra a trilha e sincroniza o hodômetro oficial da
 * Manutenção. A prévia "fim − início" é só informativa: o KM e a situação
 * finais são decididos no banco.
 */
export interface KmCorrectionTarget {
  readingId: string;
  plate: string;
  day: string;
  odometerStart: number | null;
  odometerEnd: number | null;
  /** Valores originais da fonte (nunca apagados). */
  odometerStartImported?: number | null;
  odometerEndImported?: number | null;
  kmInformed?: number | null;
  status?: string | null;
  alerts?: string[] | null;
}

export interface KmCorrectionDialogProps {
  target: KmCorrectionTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Chamado depois de gravar (a tela relê). */
  onDone?: () => void;
  /** Permite "Marcar como analisada" (km_review_reading) além da correção. */
  allowReview?: boolean;
}

const MIN_REASON = 10;
const MAX_ODOMETER = 9_999_999;

/** "19.985,38", "19985,38" ou "19985.38" → número; vazio/ inválido → null. */
function parseOdometer(text: string): number | null {
  const t = text.trim().replace(/\s/g, "");
  if (!t) return null;
  const normalized = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

const toField = (v: number | null | undefined) =>
  v == null ? "" : String(v).replace(".", ",");

export function KmCorrectionDialog({ target, open, onOpenChange, onDone, allowReview = false }: KmCorrectionDialogProps) {
  return (
    <Dialog open={open && target != null} onOpenChange={onOpenChange}>
      <DialogContent size="lg" data-testid="km-correction-dialog">
        {target ? (
          <CorrectionForm
            key={target.readingId}
            target={target}
            allowReview={allowReview}
            onClose={() => onOpenChange(false)}
            onDone={onDone}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CorrectionForm({
  target, allowReview, onClose, onDone,
}: {
  target: KmCorrectionTarget;
  allowReview: boolean;
  onClose: () => void;
  onDone?: () => void;
}) {
  const { toast } = useToast();
  const [start, setStart] = React.useState(() => toField(target.odometerStart));
  const [end, setEnd] = React.useState(() => toField(target.odometerEnd));
  const [reason, setReason] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [busy, setBusy] = React.useState<"correct" | "review" | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);

  // Originais da fonte: vêm do alvo quando a tela já os tem; senão, uma leitura sob demanda.
  const provided = target.odometerStartImported !== undefined || target.odometerEndImported !== undefined;
  const [source, setSource] = React.useState<KmReadingSource | null>(null);
  const [sourceError, setSourceError] = React.useState<string | null>(null);
  const [sourceLoading, setSourceLoading] = React.useState(!provided);

  React.useEffect(() => {
    if (provided) return;
    let alive = true;
    loadReadingSource(target.readingId).then(
      (res) => {
        if (!alive) return;
        if (res.ok && res.data) setSource(res.data);
        else setSourceError(res.error ?? "Não foi possível ler os valores da fonte.");
        setSourceLoading(false);
      },
      () => {
        if (!alive) return;
        setSourceError("Não foi possível ler os valores da fonte.");
        setSourceLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [provided, target.readingId]);

  const original = {
    start: provided ? target.odometerStartImported ?? null : source?.odometerStartImported ?? null,
    end: provided ? target.odometerEndImported ?? null : source?.odometerEndImported ?? null,
    km: target.kmInformed !== undefined ? target.kmInformed ?? null : source?.distanceImported ?? null,
  };
  const status = target.status ?? source?.status ?? null;
  const alerts = target.alerts ?? source?.alerts ?? [];

  const startValue = parseOdometer(start);
  const endValue = parseOdometer(end);
  const startError =
    start.trim() === ""
      ? "Informe o hodômetro inicial."
      : startValue == null
        ? "Número inválido."
        : startValue < 0 || startValue > MAX_ODOMETER
          ? "Fora da faixa (0 a 9.999.999)."
          : null;
  const endError =
    end.trim() === ""
      ? "Informe o hodômetro final."
      : endValue == null
        ? "Número inválido."
        : endValue < 0 || endValue > MAX_ODOMETER
          ? "Fora da faixa (0 a 9.999.999)."
          : null;
  const reasonLength = reason.trim().length;
  const reasonError = reasonLength < MIN_REASON ? `Descreva o motivo (mínimo de ${MIN_REASON} caracteres).` : null;
  const preview = startValue != null && endValue != null && !startError && !endError ? endValue - startValue : null;
  const unchanged = startValue === target.odometerStart && endValue === target.odometerEnd;
  const canCorrect = !startError && !endError && !reasonError && !busy;
  const canReview = allowReview && (status == null || status === "pending_review");

  async function submitCorrection() {
    setTouched(true);
    setFormError(null);
    if (startError || endError || reasonError || startValue == null || endValue == null) return;
    setBusy("correct");
    const res = await correctReading(target.readingId, {
      odometerStart: startValue,
      odometerEnd: endValue,
      reason: reason.trim(),
    }).catch(() => ({ ok: false as const, error: "Não foi possível corrigir a leitura.", data: undefined }));
    setBusy(null);
    if (!res.ok) {
      setFormError(res.error ?? "Não foi possível corrigir a leitura.");
      toast({ title: res.error ?? "Não foi possível corrigir a leitura.", variant: "danger" });
      return;
    }
    toast({
      title: `Leitura de ${target.plate} em ${formatDate(target.day)} corrigida.`,
      description: res.data
        ? `Situação: ${kmStatusLabel(res.data.status)} · KM validado: ${fmtKm1(res.data.km ?? null)}. Registrada na trilha de auditoria.`
        : "Registrada na trilha de auditoria.",
      variant: "success",
    });
    onClose();
    onDone?.();
  }

  async function submitReview() {
    setTouched(true);
    setFormError(null);
    if (reasonError) return;
    setBusy("review");
    const res = await reviewReading(target.readingId, reason.trim()).catch(() => ({
      ok: false as const,
      error: "Não foi possível registrar a análise da leitura.",
      data: undefined,
    }));
    setBusy(null);
    if (!res.ok) {
      setFormError(res.error ?? "Não foi possível registrar a análise da leitura.");
      toast({ title: res.error ?? "Não foi possível registrar a análise da leitura.", variant: "danger" });
      return;
    }
    toast({
      title: `Leitura de ${target.plate} em ${formatDate(target.day)} marcada como analisada.`,
      description: res.data ? `Nova situação: ${kmStatusLabel(res.data.status)}. Parecer registrado na trilha.` : undefined,
      variant: "success",
    });
    onClose();
    onDone?.();
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        void submitCorrection();
      }}
      noValidate
    >
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <PencilLine className="size-4 text-fg-muted" aria-hidden />
          Corrigir leitura de KM
        </DialogTitle>
        <DialogDescription>
          <span className="font-semibold text-fg">{target.plate}</span> · {formatDate(target.day)}
        </DialogDescription>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {status ? (
            <StatusBadge status={kmStatusTone(status)} size="sm" data-testid="km-correction-status">
              {kmStatusLabel(status)}
            </StatusBadge>
          ) : null}
          {(alerts ?? []).map((a) => (
            <Badge key={a} size="sm" variant="neutral" appearance="outline">
              {KM_ALERT_LABEL[a as KmAlert] ?? kmStatusLabel(a)}
            </Badge>
          ))}
        </div>
      </DialogHeader>

      <DialogBody className="flex flex-col gap-4">
        <section aria-labelledby="km-corr-values" className="flex flex-col gap-2">
          <h3 id="km-corr-values" className="text-label font-semibold text-fg">
            Valores da leitura
          </h3>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[26rem] text-body-sm" data-testid="km-correction-values">
              <caption className="sr-only">Valores informados pela fonte e valores vigentes</caption>
              <thead className="bg-surface-secondary text-caption text-fg-secondary">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">Campo</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Informado pela fonte</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Vigente</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                <tr className="border-t border-border-subtle">
                  <th scope="row" className="px-3 py-2 text-left font-medium">Hodômetro inicial</th>
                  <td className="px-3 py-2 text-right">{sourceLoading ? "…" : fmt2(original.start)}</td>
                  <td className="px-3 py-2 text-right">{fmt2(target.odometerStart)}</td>
                </tr>
                <tr className="border-t border-border-subtle">
                  <th scope="row" className="px-3 py-2 text-left font-medium">Hodômetro final</th>
                  <td className="px-3 py-2 text-right">{sourceLoading ? "…" : fmt2(original.end)}</td>
                  <td className="px-3 py-2 text-right">{fmt2(target.odometerEnd)}</td>
                </tr>
                <tr className="border-t border-border-subtle">
                  <th scope="row" className="px-3 py-2 text-left font-medium">KM informado</th>
                  <td className="px-3 py-2 text-right">{sourceLoading ? "…" : fmtKm1(original.km)}</td>
                  <td className="px-3 py-2 text-right text-fg-muted">—</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-caption text-fg-muted">
            Os valores informados pela fonte ficam guardados como importados e nunca são apagados por uma correção.
          </p>
          {sourceError ? <p className="text-caption text-warning-soft-fg">{sourceError}</p> : null}
        </section>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Hodômetro inicial" required error={touched ? startError : undefined}>
            <Input
              inputMode="decimal"
              autoComplete="off"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              trailingAddon="km"
              data-testid="km-correction-start"
            />
          </FormField>
          <FormField label="Hodômetro final" required error={touched ? endError : undefined}>
            <Input
              inputMode="decimal"
              autoComplete="off"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              trailingAddon="km"
              data-testid="km-correction-end"
            />
          </FormField>
        </div>

        <div
          className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-border bg-surface-sunken px-3 py-2"
          aria-live="polite"
          data-testid="km-correction-preview"
        >
          <span className="text-caption text-fg-secondary">Prévia do KM do dia (final − inicial, só informativa)</span>
          <span className="text-h4 font-semibold text-fg tabular-nums">{preview == null ? "—" : fmtKm1(preview)}</span>
          {preview != null && preview < 0 ? (
            <span className="w-full text-caption text-danger-soft-fg">
              O final é menor que o inicial: a rotina classificará a leitura como inconsistente e o KM não entrará nos totais.
            </span>
          ) : null}
          {unchanged && !startError && !endError ? (
            <span className="w-full text-caption text-fg-muted">Os hodômetros informados são iguais aos vigentes.</span>
          ) : null}
        </div>

        <FormField
          label="Motivo"
          required
          helperText={`${reasonLength} caractere(s) — mínimo de ${MIN_REASON}. Fica registrado na trilha.`}
          error={touched ? reasonError : undefined}
        >
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="Ex.: hodômetro final digitado com um dígito a mais, conferido na foto do painel."
            data-testid="km-correction-reason"
          />
        </FormField>

        <Alert variant="info" icon={<History />}>
          <AlertTitle>Correção auditada</AlertTitle>
          <AlertDescription>
            A correção fica na trilha de auditoria (valores anterior e novo, motivo, usuário e momento) e atualiza o
            hodômetro oficial usado pela Manutenção. A situação e o KM validado são recalculados pela rotina.
          </AlertDescription>
        </Alert>

        {formError ? (
          <p role="alert" className="text-body-sm text-danger-soft-fg">
            {formError}
          </p>
        ) : null}
      </DialogBody>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy != null}>
          Cancelar
        </Button>
        {canReview ? (
          <Button
            variant="secondary"
            leadingIcon={<CheckCheck aria-hidden />}
            loading={busy === "review"}
            disabled={busy != null}
            onClick={() => void submitReview()}
            data-testid="km-correction-review"
            title="Mantém os hodômetros e registra o parecer (só para leituras pendentes de análise)."
          >
            Marcar como analisada
          </Button>
        ) : null}
        <Button
          type="submit"
          loading={busy === "correct"}
          disabled={busy != null || (touched && !canCorrect)}
          data-testid="km-correction-submit"
        >
          Gravar correção
        </Button>
      </DialogFooter>
    </form>
  );
}
