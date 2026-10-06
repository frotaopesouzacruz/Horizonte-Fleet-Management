"use client";

import * as React from "react";
import { History, RotateCcw, Save } from "lucide-react";
import { cn } from "@/lib/cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { SwitchField } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { saveTireParameters, type ParametersInput } from "@/lib/tires/actions";
import { fmtInt, fmtNum, formatDate, formatStamp, type TireParameterSet, type TiresCatalog } from "@/lib/tires/types";
import { REASON_MIN } from "../tires-ui";
import { dayBefore, numberError, numberText, parseNumber, useParamAction, type NumberRule } from "./param-ui";

/**
 * Parâmetros → Prazos e limites. Um formulário (nunca JSON) com os valores
 * VIGENTES do banco — nenhum número fixo na tela. Salvar envia só o que mudou
 * e a rotina `tire_save_parameters` versiona: no mesmo dia corrige a versão de
 * hoje; em outro dia encerra a vigente ontem e abre uma nova a partir de hoje.
 * Fotografias de datas anteriores seguem avaliadas com a versão da sua data.
 */
type NumKey =
  | "measurementOkDays" | "measurementWarningDays" | "calibrationOkDays" | "calibrationWarningDays"
  | "treadCriticalMm" | "treadAttentionMm" | "maxValidTreadMm" | "maxValidPsi" | "futureDateToleranceDays"
  | "treadMinDivergenceToleranceMm" | "staleUpdateDays" | "inspectionTreadToleranceMm" | "inspectionPsiTolerance"
  | "reviewSlaDays" | "rodoparSyncSlaDays" | "repairResolutionMaxAgeDays";

type Unit = "dias" | "mm" | "PSI";

interface FieldDef extends NumberRule {
  key: NumKey;
  label: string;
  /** Rótulo curto para o histórico ("Medição em dia"). */
  short: string;
  unit: Unit;
  help?: string;
}

interface GroupDef {
  id: string;
  title: string;
  description: string;
  /** "pair": campos lado a lado; "list": uma linha por campo (rótulos longos). */
  layout: "pair" | "list";
  fields: FieldDef[];
}

// Faixas = checagens da tabela `tire_parameter_sets` (o banco revalida).
const DAYS = (min: number, max: number): NumberRule => ({ integer: true, min, max });
const MM = (max: number, above = true): NumberRule => ({ min: 0, above, max, decimals: 2 });

const GROUPS: GroupDef[] = [
  {
    id: "medicao",
    layout: "pair",
    title: "Medição de sulco",
    description: "Dias desde a última medição: até “em dia” o pneu está Em dia; até “próximo” fica Próximo do vencimento; acima disso, Vencido.",
    fields: [
      { key: "measurementOkDays", label: "Em dia até", short: "Medição em dia", unit: "dias", ...DAYS(1, 365) },
      { key: "measurementWarningDays", label: "Próximo do vencimento até", short: "Medição próximo", unit: "dias", ...DAYS(1, 730) },
    ],
  },
  {
    id: "calibragem",
    layout: "pair",
    title: "Calibragem",
    description: "Dias desde a última calibragem, com as mesmas faixas: Em dia, Próximo do vencimento e Vencido.",
    fields: [
      { key: "calibrationOkDays", label: "Em dia até", short: "Calibragem em dia", unit: "dias", ...DAYS(1, 365) },
      { key: "calibrationWarningDays", label: "Próximo do vencimento até", short: "Calibragem próximo", unit: "dias", ...DAYS(1, 730) },
    ],
  },
  {
    id: "sulco",
    layout: "pair",
    title: "Sulco",
    description: "Classe do menor sulco medido: até “crítico” = Crítico; até “atenção” = Atenção. O sulco legal (Abaixo do legal) vem da regra de PSI do pneu.",
    fields: [
      { key: "treadCriticalMm", label: "Crítico até", short: "Sulco crítico", unit: "mm", ...MM(999.99) },
      { key: "treadAttentionMm", label: "Atenção até", short: "Sulco atenção", unit: "mm", ...MM(999.99) },
    ],
  },
  {
    id: "importacao",
    layout: "list",
    title: "Validação da importação",
    description: "Limites técnicos do arquivo do Rodopar 10 e do aplicativo de vistoria: valor fora deles é tratado como erro de digitação, não como leitura.",
    fields: [
      { key: "maxValidTreadMm", label: "Sulco máximo válido", short: "Sulco máximo válido", unit: "mm", ...MM(999.99) },
      { key: "maxValidPsi", label: "PSI máximo válido", short: "PSI máximo válido", unit: "PSI", ...MM(9999.99) },
      { key: "futureDateToleranceDays", label: "Tolerância de data futura", short: "Tolerância de data futura", unit: "dias", ...DAYS(0, 30), help: "Datas de medição/calibragem além disso, à frente da data da fotografia, são erro." },
      { key: "treadMinDivergenceToleranceMm", label: "Tolerância menor sulco informado × calculado", short: "Tolerância menor sulco", unit: "mm", ...MM(99.99, false), help: "Diferença aceita entre o menor sulco do Rodopar e o menor dos sulcos 1 a 4." },
      { key: "staleUpdateDays", label: "Atualização desatualizada após", short: "Desatualizado após", unit: "dias", ...DAYS(1, 3650), help: "Pneu sem nova medição ou calibragem há mais tempo que isso é apontado na qualidade de dados." },
    ],
  },
  {
    id: "vistorias",
    layout: "list",
    title: "Vistorias de campo",
    description: "Comparação cega da vistoria com a fotografia oficial (a vistoria nunca altera a base) e os prazos de tratamento.",
    fields: [
      { key: "inspectionTreadToleranceMm", label: "Tolerância de sulco", short: "Tolerância sulco (vistoria)", unit: "mm", ...MM(99.99, false) },
      { key: "inspectionPsiTolerance", label: "Tolerância de PSI", short: "Tolerância PSI (vistoria)", unit: "PSI", ...MM(999.99, false) },
      { key: "reviewSlaDays", label: "SLA de revisão", short: "SLA de revisão", unit: "dias", ...DAYS(0, 365), help: "Prazo para revisar uma vistoria recebida." },
      { key: "rodoparSyncSlaDays", label: "SLA de sincronização com o Rodopar", short: "SLA de sincronização", unit: "dias", ...DAYS(0, 365), help: "Prazo para a correção aparecer numa fotografia importada." },
    ],
  },
  {
    id: "consertos",
    layout: "list",
    title: "Consertos",
    description: "Ao registrar um conserto pelo Nº Fogo, o veículo é resolvido pela fotografia mais próxima da data do serviço.",
    fields: [
      { key: "repairResolutionMaxAgeDays", label: "Idade máxima da fotografia", short: "Idade máx. da fotografia (consertos)", unit: "dias", ...DAYS(1, 365), help: "Fotografia mais antiga que isso, em relação à data do serviço, não resolve o veículo do conserto." },
    ],
  },
];

const FIELDS: FieldDef[] = GROUPS.flatMap((g) => g.fields);
/** Duas colunas de alturas parecidas no desktop; no celular, uma coluna. */
const LEFT = ["medicao", "calibragem", "sulco"];
const RIGHT = ["importacao", "vistorias", "consertos"];
const RETREAD_RULE: NumberRule = { ...MM(999.99), optional: true };
const NOTE_MAX = 500;

interface FormState {
  values: Record<NumKey, string>;
  useRodopar: boolean;
  retreadMm: string;
  note: string;
}

const fromParams = (p: TireParameterSet | null): FormState => ({
  values: Object.fromEntries(FIELDS.map((f) => [f.key, numberText(p?.[f.key])])) as Record<NumKey, string>,
  useRodopar: p?.retreadAlertUseRodoparCondition ?? true,
  retreadMm: numberText(p?.retreadAlertTreadMm),
  note: "",
});

const unitSuffix = (v: number | null | undefined, unit: Unit) => (v == null ? "—" : unit === "dias" ? `${fmtInt(v)} ${v === 1 ? "dia" : "dias"}` : `${fmtNum(v)} ${unit}`);

export function GeneralParameters({ catalog, canManage, onDone }: { catalog: TiresCatalog; canManage: boolean; onDone: () => void }) {
  const p = catalog.parameters;
  return (
    <div className="flex flex-col gap-5" data-testid="tires-param-general">
      {/* Remonta quando a versão vigente muda (depois de salvar e recarregar). */}
      <ParametersForm key={`${p?.id ?? "none"}:${p?.updatedAt ?? ""}`} catalog={catalog} canManage={canManage} onDone={onDone} />
      <ParameterHistory catalog={catalog} />
    </div>
  );
}

function ParametersForm({ catalog, canManage, onDone }: { catalog: TiresCatalog; canManage: boolean; onDone: () => void }) {
  const p = catalog.parameters;
  const initial = React.useMemo(() => fromParams(p), [p]);
  const [form, setForm] = React.useState<FormState>(initial);
  const [submitted, setSubmitted] = React.useState(false);
  const [noteTouched, setNoteTouched] = React.useState(false);
  const { busy, run } = useParamAction(onDone);
  const saving = busy === "parameters";

  const setValue = (key: NumKey, value: string) => setForm((f) => ({ ...f, values: { ...f.values, [key]: value } }));

  // --- validação (campo a campo + regras entre campos) ---------------------
  const rawErrors: Partial<Record<NumKey | "retreadMm" | "note", string>> = {};
  for (const f of FIELDS) {
    const e = numberError(form.values[f.key], f);
    if (e) rawErrors[f.key] = e;
  }
  const num = (k: NumKey) => parseNumber(form.values[k]);
  const cross = (k: NumKey, ok: boolean, message: string) => {
    if (!rawErrors[k] && !ok) rawErrors[k] = message;
  };
  const bothValid = (a: NumKey, b: NumKey) => !rawErrors[a] && !rawErrors[b];
  if (bothValid("measurementOkDays", "measurementWarningDays")) {
    cross("measurementWarningDays", num("measurementWarningDays")! >= num("measurementOkDays")!, "Deve ser maior ou igual a “em dia até”.");
  }
  if (bothValid("calibrationOkDays", "calibrationWarningDays")) {
    cross("calibrationWarningDays", num("calibrationWarningDays")! >= num("calibrationOkDays")!, "Deve ser maior ou igual a “em dia até”.");
  }
  if (bothValid("treadCriticalMm", "treadAttentionMm")) {
    cross("treadAttentionMm", num("treadAttentionMm")! >= num("treadCriticalMm")!, "Deve ser maior ou igual ao sulco crítico.");
  }
  if (bothValid("treadAttentionMm", "maxValidTreadMm")) {
    cross("maxValidTreadMm", num("maxValidTreadMm")! > num("treadAttentionMm")!, "Deve ser maior que o sulco de atenção.");
  }
  const retreadError = numberError(form.retreadMm, RETREAD_RULE);
  if (retreadError) rawErrors.retreadMm = retreadError;
  const note = form.note.trim();
  if (note.length < REASON_MIN) rawErrors.note = `Descreva o motivo da mudança (mínimo de ${REASON_MIN} caracteres).`;
  else if (note.length > NOTE_MAX) rawErrors.note = `No máximo ${NOTE_MAX} caracteres.`;

  // Erro aparece enquanto se digita (campo alterado) ou depois de tentar salvar.
  const shown = (key: NumKey | "retreadMm"): string | undefined => {
    const dirty = key === "retreadMm" ? form.retreadMm !== initial.retreadMm : form.values[key] !== initial.values[key];
    return submitted || dirty ? rawErrors[key] : undefined;
  };
  const noteError = submitted || noteTouched ? rawErrors.note : undefined;

  // --- o que mudou ----------------------------------------------------------
  const changed: NumKey[] = FIELDS.filter((f) => {
    const v = num(f.key);
    return v === null || Number.isNaN(v) ? form.values[f.key] !== initial.values[f.key] : v !== (p?.[f.key] ?? null);
  }).map((f) => f.key);
  const retreadValue = parseNumber(form.retreadMm);
  const retreadMmChanged = form.retreadMm.trim() === "" ? p?.retreadAlertTreadMm != null : retreadValue !== (p?.retreadAlertTreadMm ?? null);
  const rodoparChanged = form.useRodopar !== (p?.retreadAlertUseRodoparCondition ?? true);
  const changeCount = changed.length + (retreadMmChanged ? 1 : 0) + (rodoparChanged ? 1 : 0);
  const fieldErrors = Object.keys(rawErrors).filter((k) => k !== "note");
  const sameDay = p?.effectiveFrom === catalog.today;

  const submit = async () => {
    setSubmitted(true);
    if (changeCount === 0 || Object.keys(rawErrors).length > 0) return;
    // Sem versão vigente (base nova), a rotina precisa de todos os valores.
    const payload: ParametersInput = { note };
    const out = payload as Record<string, unknown>;
    for (const f of FIELDS) if (!p || changed.includes(f.key)) out[f.key] = num(f.key);
    if (!p || rodoparChanged) payload.retreadAlertUseRodoparCondition = form.useRodopar;
    if (!p || retreadMmChanged) payload.retreadAlertTreadMm = form.retreadMm.trim() === "" ? null : retreadValue;
    const ok = await run("parameters", () => saveTireParameters(payload), {
      success: "Parâmetros salvos",
      successDescription: sameDay
        ? `Versão vigente desde ${formatDate(catalog.today)} corrigida.`
        : `Nova versão vigente a partir de ${formatDate(catalog.today)}.`,
      failure: "Não foi possível salvar os parâmetros",
    });
    if (ok) {
      setSubmitted(false);
      setNoteTouched(false);
      setForm((f) => ({ ...f, note: "" }));
    }
  };

  const reset = () => {
    setForm(initial);
    setSubmitted(false);
    setNoteTouched(false);
  };

  const renderGroup = (id: string) => {
    const g = GROUPS.find((x) => x.id === id)!;
    const list = g.layout === "list";
    return (
      <Card key={g.id} variant="outlined" data-testid={`tires-param-group-${g.id}`}>
        <CardHeader title={g.title} description={g.description} />
        <CardContent>
          {canManage ? (
            <div className={list ? "flex flex-col divide-y divide-border-subtle" : "grid grid-cols-1 gap-4 sm:grid-cols-2"}>
              {g.fields.map((f) => {
                const error = shown(f.key);
                const isChanged = p != null && changed.includes(f.key);
                return (
                  <FormField
                    key={f.key}
                    label={f.label}
                    required
                    error={error}
                    helperText={isChanged && !error ? <span className="text-info-soft-fg">Vigente: {unitSuffix(p?.[f.key], f.unit)}</span> : f.help}
                    className={cn(
                      list &&
                        "py-3 first:pt-0 last:pb-0 sm:grid sm:grid-cols-[minmax(0,1fr)_10.5rem] sm:items-start sm:gap-x-4 sm:gap-y-1 sm:[&>label]:pt-2 sm:[&>p[role=alert]]:col-start-2",
                    )}
                  >
                    <Input
                      value={form.values[f.key]}
                      onChange={(e) => setValue(f.key, e.target.value)}
                      inputMode={f.integer ? "numeric" : "decimal"}
                      autoComplete="off"
                      trailingAddon={f.unit}
                      disabled={saving}
                      className={cn(isChanged && !error && "border-info")}
                      data-testid={`tires-param-${f.key}`}
                    />
                  </FormField>
                );
              })}
            </div>
          ) : (
            <dl className={list ? "flex flex-col divide-y divide-border-subtle" : "grid grid-cols-1 gap-3 sm:grid-cols-2"}>
              {g.fields.map((f) => (
                <div
                  key={f.key}
                  className={cn(
                    "flex min-w-0 gap-x-4 gap-y-0.5",
                    list ? "flex-col py-2.5 first:pt-0 last:pb-0 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline" : "flex-col",
                  )}
                >
                  <dt className="text-body-sm text-fg-secondary">
                    {f.label}
                    {f.help ? <span className="block text-caption text-fg-muted">{f.help}</span> : null}
                  </dt>
                  <dd className="text-body font-semibold text-fg tabular-nums sm:row-start-1 sm:col-start-2" data-testid={`tires-param-value-${f.key}`}>
                    {unitSuffix(p?.[f.key], f.unit)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      data-testid="tires-param-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {p ? (
        <Alert variant="info" data-testid="tires-param-current">
          <AlertTitle>
            Versão vigente desde {formatDate(p.effectiveFrom)}
            {p.effectiveTo ? ` até ${formatDate(p.effectiveTo)}` : ""}
          </AlertTitle>
          <AlertDescription>
            {p.note ? <span className="block">Observação: {p.note}</span> : null}
            {canManage ? (
              <span className="block">
                {sameDay
                  ? "Esta versão começou hoje: salvar corrige esta mesma versão (a anterior não muda)."
                  : `Salvar encerra esta versão em ${formatDate(dayBefore(catalog.today))} e abre uma nova a partir de hoje (${formatDate(catalog.today)}).`}{" "}
                Fotografias de datas anteriores continuam avaliadas com a versão vigente na sua data.
              </span>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="warning" data-testid="tires-param-missing">
          <AlertTitle>Nenhuma versão de parâmetros cadastrada</AlertTitle>
          <AlertDescription>
            Sem parâmetros vigentes, prazos e classes de sulco não são calculados.
            {canManage ? " Preencha todos os campos e salve para abrir a primeira versão a partir de hoje." : ""}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          {LEFT.map(renderGroup)}
          <Card variant="outlined" data-testid="tires-param-group-ressolagem">
            <CardHeader
              title="Alerta de ressolagem"
              description="Alerta operacional de retirada para ressolagem de pneus em uso ou em estoque — não é cálculo de custo. Liga pela condição do Rodopar e/ou por um sulco."
            />
            <CardContent className="flex flex-col gap-3">
              {canManage ? (
                <>
                  <SwitchField
                    label="Usar a condição do Rodopar"
                    description="Pneu com condição de recapagem (“RECAPAR”) no Rodopar entra no alerta."
                    checked={form.useRodopar}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, useRodopar: v }))}
                    disabled={saving}
                    className={cn("rounded-md border border-border", rodoparChanged && "border-info")}
                    data-testid="tires-param-retreadAlertUseRodoparCondition"
                  />
                  <FormField
                    label="Sulco de alerta"
                    labelHint="Opcional"
                    error={shown("retreadMm")}
                    helperText={
                      retreadMmChanged && !shown("retreadMm") && p ? (
                        <span className="text-info-soft-fg">Vigente: {p.retreadAlertTreadMm == null ? "sem alerta por sulco" : unitSuffix(p.retreadAlertTreadMm, "mm")}</span>
                      ) : (
                        "Pneu com sulco igual ou abaixo disso entra no alerta. Vazio = sem alerta por sulco."
                      )
                    }
                    className="sm:max-w-[16rem]"
                  >
                    <Input
                      value={form.retreadMm}
                      onChange={(e) => setForm((f) => ({ ...f, retreadMm: e.target.value }))}
                      inputMode="decimal"
                      autoComplete="off"
                      trailingAddon="mm"
                      placeholder="Sem alerta por sulco"
                      disabled={saving}
                      className={cn(retreadMmChanged && !shown("retreadMm") && "border-info")}
                      data-testid="tires-param-retreadAlertTreadMm"
                    />
                  </FormField>
                </>
              ) : (
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-body-sm text-fg-secondary">Condição do Rodopar</dt>
                    <dd className="text-body font-semibold text-fg">{p ? (p.retreadAlertUseRodoparCondition ? "Considerada" : "Ignorada") : "—"}</dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-body-sm text-fg-secondary">Sulco de alerta</dt>
                    <dd className="text-body font-semibold text-fg tabular-nums">
                      {p ? (p.retreadAlertTreadMm == null ? "Sem alerta por sulco" : unitSuffix(p.retreadAlertTreadMm, "mm")) : "—"}
                    </dd>
                  </div>
                </dl>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="flex min-w-0 flex-col gap-4">{RIGHT.map(renderGroup)}</div>
      </div>

      {canManage ? (
        <Card data-testid="tires-param-save-card">
          <CardContent className="flex flex-col gap-4 pt-4">
            <FormField
              label="Observação da mudança"
              required
              error={noteError}
              helperText={`Fica gravada na versão e na trilha de auditoria. Mínimo de ${REASON_MIN} caracteres.`}
            >
              <Textarea
                rows={2}
                value={form.note}
                maxLength={NOTE_MAX}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                onBlur={() => setNoteTouched(true)}
                disabled={saving}
                placeholder="Ex.: prazo de calibragem ajustado à nova rotina das bases"
                data-testid="tires-param-note"
              />
            </FormField>
            <div className="flex flex-col-reverse gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-body-sm text-fg-muted" aria-live="polite" data-testid="tires-param-changes">
                {changeCount === 0
                  ? "Nenhum valor alterado."
                  : `${fmtInt(changeCount)} ${changeCount === 1 ? "valor alterado" : "valores alterados"}${submitted && fieldErrors.length ? " — corrija os campos destacados." : "."}`}
              </p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button type="button" variant="ghost" leadingIcon={<RotateCcw />} onClick={reset} disabled={saving || (changeCount === 0 && !form.note)}>
                  Descartar alterações
                </Button>
                <Button type="submit" variant="primary" leadingIcon={<Save />} loading={saving} disabled={changeCount === 0} data-testid="tires-param-save">
                  {sameDay ? "Salvar correção" : "Salvar nova versão"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Histórico de versões
// ---------------------------------------------------------------------------
type DiffItem = { label: string; from: string; to: string };

function diffVersions(cur: TireParameterSet, prev: TireParameterSet | undefined): DiffItem[] | null {
  if (!prev) return null;
  const out: DiffItem[] = [];
  for (const f of FIELDS) {
    if (cur[f.key] !== prev[f.key]) out.push({ label: f.short, from: unitSuffix(prev[f.key], f.unit), to: unitSuffix(cur[f.key], f.unit) });
  }
  if (cur.retreadAlertUseRodoparCondition !== prev.retreadAlertUseRodoparCondition) {
    out.push({ label: "Ressolagem pela condição do Rodopar", from: prev.retreadAlertUseRodoparCondition ? "sim" : "não", to: cur.retreadAlertUseRodoparCondition ? "sim" : "não" });
  }
  if (cur.retreadAlertTreadMm !== prev.retreadAlertTreadMm) {
    out.push({ label: "Sulco de alerta de ressolagem", from: prev.retreadAlertTreadMm == null ? "sem" : unitSuffix(prev.retreadAlertTreadMm, "mm"), to: cur.retreadAlertTreadMm == null ? "sem" : unitSuffix(cur.retreadAlertTreadMm, "mm") });
  }
  return out;
}

const pair = (a: number | null | undefined, b: number | null | undefined, unit: Unit) =>
  a == null && b == null ? "—" : `${a == null ? "—" : fmtNum(a)} / ${b == null ? "—" : fmtNum(b)} ${unit}`;

function ParameterHistory({ catalog }: { catalog: TiresCatalog }) {
  const history = [...catalog.parameterHistory].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  const today = catalog.today;
  return (
    <Card data-testid="tires-param-history">
      <CardHeader
        title="Histórico de versões"
        description="Cada linha é um conjunto de parâmetros e o período em que valeu. Quem alterou e os valores anteriores ficam também na trilha de auditoria (Histórico → Auditoria)."
        actions={<History className="size-4 text-fg-muted" aria-hidden />}
      />
      <CardContent className="px-0 pb-0">
        {history.length === 0 ? (
          <p className="px-4 pb-4 text-body-sm text-fg-muted">Nenhuma versão cadastrada.</p>
        ) : (
          <TableContainer className="rounded-t-none border-x-0 border-b-0 shadow-none">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vigência</TableHead>
                  <TableHead>Medição (em dia / próximo)</TableHead>
                  <TableHead>Calibragem (em dia / próximo)</TableHead>
                  <TableHead>Sulco (crítico / atenção)</TableHead>
                  <TableHead>Limites válidos</TableHead>
                  <TableHead>Vistorias (tolerâncias)</TableHead>
                  <TableHead>Ressolagem</TableHead>
                  <TableHead>Observação</TableHead>
                  <TableHead>O que mudou</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((h, i) => {
                  const current = h.effectiveFrom <= today && (!h.effectiveTo || h.effectiveTo >= today);
                  const diff = diffVersions(h, history[i + 1]);
                  return (
                    <TableRow key={h.id} className="align-top" selected={current} data-testid="tires-param-history-row">
                      <TableCell className="whitespace-nowrap py-2 tabular-nums">
                        <span className="block">
                          {formatDate(h.effectiveFrom)} {h.effectiveTo ? `a ${formatDate(h.effectiveTo)}` : "em diante"}
                        </span>
                        {current ? (
                          <StatusBadge status="success" size="sm" className="mt-1">Vigente</StatusBadge>
                        ) : h.effectiveFrom > today ? (
                          <StatusBadge status="info" size="sm" className="mt-1">Futura</StatusBadge>
                        ) : null}
                        {h.updatedAt ? <span className="mt-1 block text-caption text-fg-muted">Gravada em {formatStamp(h.updatedAt)}</span> : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-2 tabular-nums">{pair(h.measurementOkDays, h.measurementWarningDays, "dias")}</TableCell>
                      <TableCell className="whitespace-nowrap py-2 tabular-nums">{pair(h.calibrationOkDays, h.calibrationWarningDays, "dias")}</TableCell>
                      <TableCell className="whitespace-nowrap py-2 tabular-nums">{pair(h.treadCriticalMm, h.treadAttentionMm, "mm")}</TableCell>
                      <TableCell className="whitespace-nowrap py-2 tabular-nums">
                        {unitSuffix(h.maxValidTreadMm, "mm")} · {unitSuffix(h.maxValidPsi, "PSI")}
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-2 tabular-nums">
                        ± {unitSuffix(h.inspectionTreadToleranceMm, "mm")} · ± {unitSuffix(h.inspectionPsiTolerance, "PSI")}
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-2">
                        {[h.retreadAlertUseRodoparCondition ? "Condição Rodopar" : null, h.retreadAlertTreadMm != null ? `≤ ${unitSuffix(h.retreadAlertTreadMm, "mm")}` : null]
                          .filter(Boolean)
                          .join(" · ") || "Desligado"}
                      </TableCell>
                      <TableCell className="min-w-[16rem] max-w-[24rem] py-2 text-body-sm text-fg-secondary">{h.note ?? "—"}</TableCell>
                      <TableCell className="min-w-[16rem] py-2 text-body-sm">
                        {diff === null ? (
                          <span className="text-fg-muted">Primeira versão</span>
                        ) : diff.length === 0 ? (
                          <span className="text-fg-muted">Sem diferença de valores</span>
                        ) : (
                          <ul className="flex flex-col gap-0.5">
                            {diff.map((d) => (
                              <li key={d.label}>
                                <span className="text-fg-secondary">{d.label}:</span>{" "}
                                <span className="tabular-nums text-fg-muted line-through decoration-fg-subtle">{d.from}</span>{" "}
                                <span aria-hidden>→</span>
                                <span className="sr-only">para</span> <span className="font-medium tabular-nums text-fg">{d.to}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  );
}
