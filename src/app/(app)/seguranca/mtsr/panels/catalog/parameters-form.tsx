"use client";

import * as React from "react";
import { Save } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { saveParameters } from "@/lib/mtsr/actions";
import { fmtDays, fmtInt, formatDate, type MtsrCatalog, type MtsrParameterSet } from "@/lib/mtsr/types";

/**
 * Parâmetros do MTSR: prazos, SLAs e retenção de evidências.
 *
 * Os valores iniciais são SEMPRE os vigentes no catálogo (nunca um número
 * fixo na tela). Salvar cria uma nova vigência a partir da data informada; o
 * histórico fica abaixo.
 */
interface Form {
  conformeMaxDays: string;
  attentionMinDays: string;
  attentionMaxDays: string;
  evidenceRetentionInspections: string;
  evidenceRetentionDays: string;
  reviewSlaDays: string;
  maintenanceOpenSlaDays: string;
  revalidationSlaDays: string;
  effectiveFrom: string;
  note: string;
}

const fromCatalog = (p: MtsrParameterSet, today: string): Form => ({
  conformeMaxDays: String(p.conformeMaxDays),
  attentionMinDays: String(p.attentionMinDays),
  attentionMaxDays: String(p.attentionMaxDays),
  evidenceRetentionInspections: String(p.evidenceRetentionInspections),
  evidenceRetentionDays: p.evidenceRetentionDays == null ? "" : String(p.evidenceRetentionDays),
  reviewSlaDays: String(p.reviewSlaDays),
  maintenanceOpenSlaDays: String(p.maintenanceOpenSlaDays),
  revalidationSlaDays: String(p.revalidationSlaDays),
  effectiveFrom: today,
  note: "",
});

const int = (v: string) => (v.trim() === "" ? null : Number(v));
const isInt = (v: string, min: number) => {
  const n = Number(v);
  return v.trim() !== "" && Number.isInteger(n) && n >= min;
};

export function ParametersForm({ catalog, canManage, onDone }: { catalog: MtsrCatalog; canManage: boolean; onDone: () => void }) {
  const { toast } = useToast();
  const p = catalog.parameters;
  const [form, setForm] = React.useState<Form>(() => fromCatalog(p, catalog.today));
  const [touched, setTouched] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  const errors: Partial<Record<keyof Form, string>> = {};
  if (touched) {
    if (!isInt(form.conformeMaxDays, 1)) errors.conformeMaxDays = "Inteiro a partir de 1.";
    if (!isInt(form.attentionMinDays, 1)) errors.attentionMinDays = "Inteiro a partir de 1.";
    if (!isInt(form.attentionMaxDays, 1)) errors.attentionMaxDays = "Inteiro a partir de 1.";
    if (!errors.conformeMaxDays && !errors.attentionMinDays && Number(form.attentionMinDays) <= Number(form.conformeMaxDays)) errors.attentionMinDays = "Deve ser maior que o limite de Conforme.";
    if (!errors.attentionMinDays && !errors.attentionMaxDays && Number(form.attentionMaxDays) < Number(form.attentionMinDays)) errors.attentionMaxDays = "Deve ser maior ou igual ao início da Atenção.";
    if (!isInt(form.evidenceRetentionInspections, 1)) errors.evidenceRetentionInspections = "Inteiro a partir de 1.";
    if (form.evidenceRetentionDays.trim() !== "" && !isInt(form.evidenceRetentionDays, 1)) errors.evidenceRetentionDays = "Inteiro a partir de 1 ou vazio.";
    if (!isInt(form.reviewSlaDays, 1)) errors.reviewSlaDays = "Inteiro a partir de 1.";
    if (!isInt(form.maintenanceOpenSlaDays, 1)) errors.maintenanceOpenSlaDays = "Inteiro a partir de 1.";
    if (!isInt(form.revalidationSlaDays, 1)) errors.revalidationSlaDays = "Inteiro a partir de 1.";
    if (!form.effectiveFrom) errors.effectiveFrom = "Informe a data de vigência.";
  }
  const hasErrors = Object.keys(errors).length > 0;

  const submit = async () => {
    setTouched(true);
    if (hasErrors) return;
    setBusy(true);
    const r = await saveParameters({
      effectiveFrom: form.effectiveFrom,
      conformeMaxDays: int(form.conformeMaxDays),
      attentionMinDays: int(form.attentionMinDays),
      attentionMaxDays: int(form.attentionMaxDays),
      evidenceRetentionInspections: int(form.evidenceRetentionInspections),
      evidenceRetentionDays: form.evidenceRetentionDays.trim() === "" ? null : int(form.evidenceRetentionDays),
      reviewSlaDays: int(form.reviewSlaDays),
      maintenanceOpenSlaDays: int(form.maintenanceOpenSlaDays),
      revalidationSlaDays: int(form.revalidationSlaDays),
      note: form.note.trim() || null,
    });
    setBusy(false);
    if (!r.ok || !r.data) {
      toast({ title: "Não foi possível salvar os parâmetros", description: r.error, variant: "danger" });
      return;
    }
    toast({ title: "Parâmetros salvos", description: `Nova vigência a partir de ${formatDate(r.data.effectiveFrom)}.`, variant: "success" });
    setTouched(false);
    set("note", "");
    onDone();
  };

  return (
    <div className="flex flex-col gap-4" data-testid="mtsr-parameters">
      <Alert variant="info" className="py-2">
        <AlertTitle>Vigente desde {formatDate(p.effectiveFrom)}</AlertTitle>
        <AlertDescription>
          Conforme até {fmtDays(p.conformeMaxDays)} · Atenção de {fmtInt(p.attentionMinDays)} a {fmtDays(p.attentionMaxDays)} · Vencido acima disso · SLA de validação{" "}
          {fmtDays(p.reviewSlaDays)} · SLA para abrir manutenção {fmtDays(p.maintenanceOpenSlaDays)} · SLA de revalidação {fmtDays(p.revalidationSlaDays)} · Retenção de evidências:{" "}
          {fmtInt(p.evidenceRetentionInspections)} vistorias por veículo{p.evidenceRetentionDays != null ? ` ou ${fmtDays(p.evidenceRetentionDays)}` : ""}.
          {p.note ? ` Nota: ${p.note}` : ""}
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader
          title="Nova vigência"
          description="Os campos já vêm com os valores vigentes. Salvar cria uma vigência nova a partir da data informada; prazo, conformidade e criticidade passam a ser calculados com ela."
        />
        <CardContent>
          <form
            className="flex flex-col gap-4"
            data-testid="mtsr-parameters-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <fieldset disabled={!canManage || busy} className="contents">
              <FormGrid columns={3}>
                <FormField label="Conforme até (dias)" required error={errors.conformeMaxDays} helperText="Dias desde a última vistoria válida.">
                  <Input type="number" min={1} step={1} inputMode="numeric" value={form.conformeMaxDays} onChange={(e) => set("conformeMaxDays", e.target.value)} data-testid="mtsr-param-conforme" />
                </FormField>
                <FormField label="Atenção de (dias)" required error={errors.attentionMinDays}>
                  <Input type="number" min={1} step={1} inputMode="numeric" value={form.attentionMinDays} onChange={(e) => set("attentionMinDays", e.target.value)} data-testid="mtsr-param-atencao-min" />
                </FormField>
                <FormField label="Atenção até (dias)" required error={errors.attentionMaxDays} helperText="Acima disso o veículo fica Vencido.">
                  <Input type="number" min={1} step={1} inputMode="numeric" value={form.attentionMaxDays} onChange={(e) => set("attentionMaxDays", e.target.value)} data-testid="mtsr-param-atencao-max" />
                </FormField>
                <FormField label="SLA de validação (dias)" required error={errors.reviewSlaDays} helperText="Vistoria pendente acima disso fica acima do SLA.">
                  <Input type="number" min={1} step={1} inputMode="numeric" value={form.reviewSlaDays} onChange={(e) => set("reviewSlaDays", e.target.value)} />
                </FormField>
                <FormField label="SLA para abrir manutenção (dias)" required error={errors.maintenanceOpenSlaDays} helperText="Contado do NOK.">
                  <Input type="number" min={1} step={1} inputMode="numeric" value={form.maintenanceOpenSlaDays} onChange={(e) => set("maintenanceOpenSlaDays", e.target.value)} />
                </FormField>
                <FormField label="SLA de revalidação (dias)" required error={errors.revalidationSlaDays} helperText="Contado da conclusão da manutenção.">
                  <Input type="number" min={1} step={1} inputMode="numeric" value={form.revalidationSlaDays} onChange={(e) => set("revalidationSlaDays", e.target.value)} />
                </FormField>
                <FormField label="Retenção de evidências (vistorias)" required error={errors.evidenceRetentionInspections} helperText="Fotos ficam só das N vistorias mais recentes de cada veículo.">
                  <Input type="number" min={1} step={1} inputMode="numeric" value={form.evidenceRetentionInspections} onChange={(e) => set("evidenceRetentionInspections", e.target.value)} />
                </FormField>
                <FormField label="Retenção de evidências (dias)" labelHint="Opcional" error={errors.evidenceRetentionDays} helperText="Além das N vistorias, expurga fotos mais antigas que isso.">
                  <Input type="number" min={1} step={1} inputMode="numeric" value={form.evidenceRetentionDays} onChange={(e) => set("evidenceRetentionDays", e.target.value)} placeholder="Sem limite por dias" />
                </FormField>
                <FormField label="Vigência a partir de" required error={errors.effectiveFrom}>
                  <DateInput value={form.effectiveFrom} onChange={(e) => set("effectiveFrom", e.target.value)} data-testid="mtsr-param-effective" />
                </FormField>
                <FormField label="Nota" labelHint="Opcional" helperText="Por que mudou — fica no histórico." className="sm:col-span-2 lg:col-span-3">
                  <Textarea rows={2} value={form.note} onChange={(e) => set("note", e.target.value)} />
                </FormField>
              </FormGrid>
            </fieldset>
            {canManage ? (
              <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
                <Button type="button" variant="ghost" onClick={() => { setForm(fromCatalog(p, catalog.today)); setTouched(false); }} disabled={busy}>
                  Voltar aos vigentes
                </Button>
                <Button type="submit" variant="primary" leadingIcon={<Save />} loading={busy} data-testid="mtsr-parameters-save">
                  Salvar nova vigência
                </Button>
              </div>
            ) : (
              <p className="text-caption text-fg-muted">Você pode ver os parâmetros, mas não alterá-los (permissão mtsr.parameters.manage).</p>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Histórico de vigências" description="Cada linha é um conjunto de parâmetros e o período em que valeu." />
        <CardContent className="px-0 pb-0">
          <TableContainer className="rounded-t-none border-x-0 border-b-0 shadow-none">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vigência</TableHead>
                  <TableHead numeric>Conforme até</TableHead>
                  <TableHead numeric>Atenção</TableHead>
                  <TableHead numeric>SLA validação</TableHead>
                  <TableHead numeric>SLA manutenção</TableHead>
                  <TableHead numeric>SLA revalidação</TableHead>
                  <TableHead numeric>Retenção</TableHead>
                  <TableHead>Nota</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(catalog.parameterHistory.length ? catalog.parameterHistory : [p]).map((h) => (
                  <TableRow key={h.id} className="h-10" data-testid="mtsr-parameters-history-row" selected={h.id === p.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatDate(h.effectiveFrom)} {h.effectiveTo ? `a ${formatDate(h.effectiveTo)}` : <span className="text-success-soft-fg">(vigente)</span>}
                    </TableCell>
                    <TableCell numeric>{fmtDays(h.conformeMaxDays)}</TableCell>
                    <TableCell numeric className="whitespace-nowrap">{fmtInt(h.attentionMinDays)}–{fmtDays(h.attentionMaxDays)}</TableCell>
                    <TableCell numeric>{fmtDays(h.reviewSlaDays)}</TableCell>
                    <TableCell numeric>{fmtDays(h.maintenanceOpenSlaDays)}</TableCell>
                    <TableCell numeric>{fmtDays(h.revalidationSlaDays)}</TableCell>
                    <TableCell numeric className="whitespace-nowrap">
                      {fmtInt(h.evidenceRetentionInspections)} vist.{h.evidenceRetentionDays != null ? ` / ${fmtDays(h.evidenceRetentionDays)}` : ""}
                    </TableCell>
                    <TableCell className="max-w-[20rem] text-fg-secondary">{h.note ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    </div>
  );
}
