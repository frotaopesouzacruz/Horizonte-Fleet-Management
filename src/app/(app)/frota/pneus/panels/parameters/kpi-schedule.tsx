"use client";

import * as React from "react";
import { CalendarClock, RotateCcw, Save } from "lucide-react";
import { cn } from "@/lib/cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { NativeSelect } from "@/components/governance/selects";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SwitchField } from "@/components/ui/switch";
import { saveTireKpiSchedule } from "@/lib/tires/actions";
import { fmtInt, type KpiSchedule } from "@/lib/tires/types";
import { DEFAULT_TZ, FREQUENCY_LABEL, formatSlot, hhmm, scheduleRule, WEEKDAY_LONG } from "../evolution/evolution-utils";
import { numberError, parseNumber, useParamAction } from "./param-ui";

/**
 * Parâmetros → Agenda dos indicadores. Quando o banco captura os indicadores
 * da Evolução (padrão: semanal, sexta-feira 22:00, horário de Brasília) e por
 * quantos dias recupera um horário perdido. A rotina `tire_kpi_schedule_save`
 * revalida e grava a trilha; as capturas já feitas nunca mudam.
 */
type Frequency = KpiSchedule["frequency"];

interface FormState {
  isActive: boolean;
  frequency: Frequency;
  weekday: number;
  monthDay: string;
  runTime: string;
  catchUpDays: string;
}

/** Os mesmos padrões da tabela `tire_kpi_schedules`. */
const fromSchedule = (s: KpiSchedule | null): FormState => ({
  isActive: s?.isActive ?? true,
  frequency: s?.frequency ?? "weekly",
  weekday: s?.weekday ?? 5,
  monthDay: String(s?.monthDay ?? 1),
  runTime: s ? hhmm(s.runTime) : "22:00",
  catchUpDays: String(s?.catchUpDays ?? 3),
});

const FREQUENCY_OPTIONS = [
  { value: "weekly", label: "Semanal", "data-testid": "tires-param-kpi-frequency-weekly" },
  { value: "daily", label: "Diária", "data-testid": "tires-param-kpi-frequency-daily" },
  { value: "monthly", label: "Mensal", "data-testid": "tires-param-kpi-frequency-monthly" },
] as const;

const MONTH_DAY_RULE = { integer: true, min: 1, max: 28 } as const;
const CATCH_UP_RULE = { integer: true, min: 0, max: 14 } as const;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

type ErrKey = "monthDay" | "runTime" | "catchUpDays";

function validate(f: FormState): Partial<Record<ErrKey, string>> {
  const e: Partial<Record<ErrKey, string>> = {};
  if (f.frequency === "monthly") {
    const m = numberError(f.monthDay, MONTH_DAY_RULE);
    if (m) e.monthDay = m;
  }
  if (!f.runTime.trim()) e.runTime = "Obrigatório.";
  else if (!TIME_RE.test(f.runTime.trim())) e.runTime = "Use o formato HH:MM (ex.: 22:00).";
  const c = numberError(f.catchUpDays, CATCH_UP_RULE);
  if (c) e.catchUpDays = c;
  return e;
}

const capitalize = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);
const daysText = (n: number | null | undefined) => (n == null ? "—" : `${fmtInt(n)} ${n === 1 ? "dia" : "dias"}`);

export function KpiScheduleSection({ schedule, canManage, onDone }: { schedule: KpiSchedule | null; canManage: boolean; onDone: () => void }) {
  return (
    <div className="flex flex-col gap-5" data-testid="tires-param-kpi">
      <Alert variant="info" icon={<CalendarClock />} data-testid="tires-param-kpi-rules">
        <AlertTitle>Como a captura dos indicadores funciona</AlertTitle>
        <AlertDescription>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
            <li>
              <span className="font-semibold">Imutável:</span> cada captura grava os indicadores do período (Geral e por operação, local, liderança, tipo
              de equipamento e perfil) e nunca é recalculada. Alterações posteriores da planilha não mudam a série; aparecem na próxima captura.
            </li>
            <li>
              <span className="font-semibold">Sem duplicidade:</span> no máximo uma captura concluída por período. Rodar o mesmo horário de novo não
              duplica a série, e reprocessar só vale para período que falhou ou foi ignorado (aba Evolução dos indicadores).
            </li>
            <li>
              <span className="font-semibold">Recuperação:</span> se o servidor estiver indisponível no horário, a captura roda depois, dentro da janela
              de recuperação, avaliando os dados como estavam na data do período. Passada a janela, o período fica como ignorado — sem valor inventado.
            </li>
            <li>Mudar a agenda vale para os próximos períodos; as capturas já gravadas continuam na série.</li>
          </ul>
        </AlertDescription>
      </Alert>
      {/* Remonta quando a agenda gravada muda (depois de salvar e recarregar). */}
      <ScheduleForm
        key={schedule ? `${schedule.id}:${schedule.isActive}:${schedule.frequency}:${schedule.weekday}:${schedule.monthDay}:${schedule.runTime}:${schedule.catchUpDays}` : "none"}
        schedule={schedule}
        canManage={canManage}
        onDone={onDone}
      />
    </div>
  );
}

function ScheduleForm({ schedule, canManage, onDone }: { schedule: KpiSchedule | null; canManage: boolean; onDone: () => void }) {
  const initial = React.useMemo(() => fromSchedule(schedule), [schedule]);
  const [form, setForm] = React.useState<FormState>(initial);
  const [submitted, setSubmitted] = React.useState(false);
  const { busy, run } = useParamAction(onDone);
  const saving = busy === "kpi-schedule";
  const errors = validate(form);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const tz = schedule?.timezone || DEFAULT_TZ;

  const changed = (Object.keys(initial) as (keyof FormState)[]).filter((k) => {
    if (k === "monthDay" || k === "catchUpDays") return parseNumber(form[k]) !== parseNumber(initial[k]);
    if (k === "runTime") return form.runTime.trim() !== initial.runTime;
    return form[k] !== initial[k];
  });
  const changeCount = schedule ? changed.length : 0;
  const isChanged = (k: keyof FormState) => schedule != null && changed.includes(k);
  const shown = (k: ErrKey) => (submitted || form[k] !== initial[k] ? errors[k] : undefined);
  const preview = scheduleRule({
    frequency: form.frequency,
    weekday: form.weekday,
    monthDay: parseNumber(form.monthDay) ?? 1,
    runTime: TIME_RE.test(form.runTime.trim()) ? form.runTime.trim() : "—",
    timezone: tz,
  });

  const submit = async () => {
    setSubmitted(true);
    if (Object.keys(errors).length > 0 || (schedule && changeCount === 0)) return;
    const monthDay = form.frequency === "monthly" ? (parseNumber(form.monthDay) as number) : schedule?.monthDay ?? 1;
    const ok = await run(
      "kpi-schedule",
      () =>
        saveTireKpiSchedule({
          isActive: form.isActive,
          frequency: form.frequency,
          weekday: form.weekday,
          monthDay,
          runTime: form.runTime.trim(),
          catchUpDays: parseNumber(form.catchUpDays) as number,
        }),
      {
        success: schedule ? "Agenda dos indicadores atualizada" : "Agenda dos indicadores criada",
        successDescription: `${form.isActive ? "Ativa" : "Pausada"}: ${preview}.`,
        failure: "Não foi possível salvar a agenda dos indicadores",
      },
    );
    if (ok) setSubmitted(false);
  };

  const reset = () => {
    setForm(initial);
    setSubmitted(false);
  };

  const status = (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2" data-testid="tires-param-kpi-status">
      <div className="flex flex-col gap-0.5">
        <dt className="text-caption text-fg-muted">Último horário planejado</dt>
        <dd className="text-body-sm font-medium text-fg tabular-nums">{formatSlot(schedule?.lastSlotAt, tz)}</dd>
      </div>
      {schedule?.nextSlotAt ? (
        <div className="flex flex-col gap-0.5">
          <dt className="text-caption text-fg-muted">Próxima captura</dt>
          <dd className="text-body-sm font-medium text-fg tabular-nums">{formatSlot(schedule.nextSlotAt, tz)}</dd>
        </div>
      ) : null}
      <div className="flex flex-col gap-0.5">
        <dt className="text-caption text-fg-muted">Fuso horário</dt>
        <dd className="text-body-sm font-medium text-fg">{tz}</dd>
      </div>
    </dl>
  );

  if (!canManage) {
    return (
      <Card variant="outlined" data-testid="tires-param-kpi-view">
        <CardHeader title="Agenda vigente" description="Quando o banco captura os indicadores exibidos na Evolução dos indicadores." />
        <CardContent className="flex flex-col gap-4">
          {schedule ? (
            <dl className="flex flex-col divide-y divide-border-subtle">
              <ReadRow label="Situação" value={schedule.isActive ? "Ativa" : "Pausada"} />
              <ReadRow label="Periodicidade" value={FREQUENCY_LABEL[schedule.frequency] ?? schedule.frequency} />
              {schedule.frequency === "weekly" ? <ReadRow label="Dia da semana" value={capitalize(WEEKDAY_LONG[schedule.weekday] ?? "—")} /> : null}
              {schedule.frequency === "monthly" ? <ReadRow label="Dia do mês" value={String(schedule.monthDay)} /> : null}
              <ReadRow label="Horário" value={hhmm(schedule.runTime)} />
              <ReadRow label="Janela de recuperação" value={daysText(schedule.catchUpDays)} />
            </dl>
          ) : (
            <p className="text-body-sm text-fg-muted">Agenda dos indicadores ainda não configurada.</p>
          )}
          {schedule ? status : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      data-testid="tires-param-kpi-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {schedule ? null : (
        <Alert variant="warning" data-testid="tires-param-kpi-missing">
          <AlertTitle>Agenda ainda não configurada</AlertTitle>
          <AlertDescription>Salvar cria a agenda com os valores abaixo (padrão: semanal, sexta-feira às 22:00, horário de Brasília).</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card variant="outlined" data-testid="tires-param-kpi-when">
          <CardHeader title="Quando capturar" description="Horário no fuso da agenda. Semanal é o ritmo da Evolução (semana × semana e mês × mês)." />
          <CardContent className="flex flex-col gap-4">
            <SwitchField
              label="Agenda ativa"
              description="Pausada, nenhuma captura automática acontece; os períodos sem captura ficam sem valor."
              checked={form.isActive}
              onCheckedChange={(v) => set("isActive", v)}
              disabled={saving}
              className={cn("rounded-md border border-border", isChanged("isActive") && "border-info")}
              data-testid="tires-param-kpi-active"
            />
            <div className="flex flex-col gap-1.5">
              <span className="text-label font-medium text-fg-secondary" aria-hidden>
                Periodicidade
              </span>
              <SegmentedControl<Frequency>
                aria-label="Periodicidade"
                value={form.frequency}
                onValueChange={(v) => set("frequency", v)}
                options={FREQUENCY_OPTIONS}
                disabled={saving}
                className={cn(isChanged("frequency") && "border-info")}
                data-testid="tires-param-kpi-frequency"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {form.frequency === "weekly" ? (
                <FormField label="Dia da semana" required helperText={isChanged("weekday") ? <Recorded value={capitalize(WEEKDAY_LONG[initial.weekday] ?? "—")} /> : undefined}>
                  <NativeSelect
                    value={String(form.weekday)}
                    onChange={(e) => set("weekday", Number(e.target.value))}
                    disabled={saving}
                    className={cn(isChanged("weekday") && "border-info")}
                    data-testid="tires-param-kpi-weekday"
                  >
                    {WEEKDAY_LONG.map((d, i) => (
                      <option key={d} value={i}>
                        {capitalize(d)}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
              ) : null}
              {form.frequency === "monthly" ? (
                <FormField
                  label="Dia do mês"
                  required
                  error={shown("monthDay")}
                  helperText={isChanged("monthDay") && !shown("monthDay") ? <Recorded value={initial.monthDay} /> : "De 1 a 28, para existir em todos os meses."}
                >
                  <Input
                    value={form.monthDay}
                    onChange={(e) => set("monthDay", e.target.value)}
                    inputMode="numeric"
                    autoComplete="off"
                    disabled={saving}
                    className={cn(isChanged("monthDay") && !shown("monthDay") && "border-info")}
                    data-testid="tires-param-kpi-monthday"
                  />
                </FormField>
              ) : null}
              <FormField
                label="Horário"
                required
                error={shown("runTime")}
                helperText={isChanged("runTime") && !shown("runTime") ? <Recorded value={initial.runTime} /> : `HH:MM, no fuso ${tz}.`}
              >
                <Input
                  type="time"
                  step={60}
                  value={form.runTime}
                  onChange={(e) => set("runTime", e.target.value)}
                  disabled={saving}
                  className={cn(isChanged("runTime") && !shown("runTime") && "border-info")}
                  data-testid="tires-param-kpi-time"
                />
              </FormField>
            </div>
          </CardContent>
        </Card>

        <Card variant="outlined" data-testid="tires-param-kpi-recovery">
          <CardHeader title="Recuperação e situação" description="Se o horário for perdido (servidor indisponível), por quantos dias a captura ainda roda." />
          <CardContent className="flex flex-col gap-4">
            <FormField
              label="Janela de recuperação"
              required
              error={shown("catchUpDays")}
              helperText={
                isChanged("catchUpDays") && !shown("catchUpDays") ? (
                  <Recorded value={daysText(parseNumber(initial.catchUpDays))} />
                ) : (
                  "De 0 a 14 dias. Zero: horário perdido vira período ignorado."
                )
              }
              className="sm:max-w-[16rem]"
            >
              <Input
                value={form.catchUpDays}
                onChange={(e) => set("catchUpDays", e.target.value)}
                inputMode="numeric"
                autoComplete="off"
                trailingAddon="dias"
                disabled={saving}
                className={cn(isChanged("catchUpDays") && !shown("catchUpDays") && "border-info")}
                data-testid="tires-param-kpi-catchup"
              />
            </FormField>
            {schedule ? status : null}
          </CardContent>
        </Card>
      </div>

      <Card data-testid="tires-param-kpi-save-card">
        <CardContent className="flex flex-col-reverse gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-body-sm text-fg-muted" aria-live="polite" data-testid="tires-param-kpi-preview">
            <span className="font-semibold text-fg-secondary">{form.isActive ? "Agenda:" : "Agenda (pausada):"}</span> {preview}.{" "}
            {!schedule
              ? ""
              : changeCount === 0
                ? "Nenhum valor alterado."
                : `${fmtInt(changeCount)} ${changeCount === 1 ? "valor alterado" : "valores alterados"}${
                    submitted && Object.keys(errors).length ? " — corrija os campos destacados." : "."
                  }`}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="ghost" leadingIcon={<RotateCcw />} onClick={reset} disabled={saving || (schedule != null && changeCount === 0)}>
              Descartar alterações
            </Button>
            <Button
              type="submit"
              variant="primary"
              leadingIcon={<Save />}
              loading={saving}
              disabled={schedule != null && changeCount === 0}
              data-testid="tires-param-kpi-save"
            >
              {schedule ? "Salvar agenda" : "Criar agenda"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}

function Recorded({ value }: { value: React.ReactNode }) {
  return <span className="text-info-soft-fg">Gravado: {value}</span>;
}

function ReadRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0 sm:grid sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:items-baseline sm:gap-x-4">
      <dt className="text-body-sm text-fg-secondary">{label}</dt>
      <dd className="min-w-0 text-body-sm font-medium text-fg tabular-nums">{value ?? "—"}</dd>
    </div>
  );
}
