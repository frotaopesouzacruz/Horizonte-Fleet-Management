"use client";

import * as React from "react";
import { RefreshCw, Save, SlidersHorizontal } from "lucide-react";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { useToast } from "@/components/feedback/toast";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { KmSettings, KmStatusCatalogEntry } from "@/lib/km/quality";
import { reprocess, saveSettings, type KmSettingsInput } from "@/lib/km/quality-actions";
import {
  fmtInt, formatDate, KM_ALERT_LABEL, KM_STATUS, type KmAlert, type KmReadingStatus,
} from "@/lib/km/types";
import { ToneBadge } from "../analysis/shared";

/**
 * Parâmetros da Gestão de KM (km.manage_parameters), reprocessamento do
 * período (km.reprocess) e o catálogo de status. Salvar grava pela rotina
 * `km_save_settings` (que registra o evento); reprocessar reclassifica as
 * leituras do período com os parâmetros vigentes e refaz o contexto da data.
 */
type FieldKey = keyof KmSettingsInput;

interface FieldDef {
  key: FieldKey;
  label: string;
  unit: string;
  help: string;
  min: number;
  max: number;
  integer?: boolean;
  /** O limite inferior é exclusivo (> min). */
  exclusiveMin?: boolean;
}

const GROUPS: { title: string; fields: FieldDef[] }[] = [
  {
    title: "Classificação da leitura",
    fields: [
      { key: "noMovementToleranceKm", label: "Tolerância de sem movimento", unit: "km", min: 0, max: 9999.99, help: "Deslocamento do dia até este valor = Sem movimento." },
      { key: "divergenceToleranceKm", label: "Tolerância de divergência", unit: "km", min: 0, max: 9999.99, help: "|KM informado − KM calculado| acima disto = Divergência de KM." },
      { key: "highMileageKm", label: "Alta rodagem", unit: "km/dia", min: 0, max: 999999.9, exclusiveMin: true, help: "KM do dia acima disto = Alta rodagem (rodagem real, para análise)." },
      { key: "odometerJumpKm", label: "Salto de hodômetro", unit: "km", min: 0, max: 999999.9, exclusiveMin: true, help: "Inicial acima do final do dia anterior por mais que isto = Salto." },
      { key: "regressionToleranceKm", label: "Tolerância de regressão", unit: "km", min: 0, max: 9999.99, help: "Inicial abaixo do final anterior por mais que isto = Regressão (pendente de análise)." },
    ],
  },
  {
    title: "Análise estatística",
    fields: [
      { key: "minCoveragePct", label: "Cobertura mínima", unit: "%", min: 0, max: 100, help: "Dias com leitura no período para a frota entrar nas estatísticas." },
      { key: "minCohortSize", label: "Coorte mínima", unit: "frotas", min: 2, max: 50, integer: true, help: "Frotas elegíveis para usar a coorte fina (N1); abaixo, recua para N2/N3." },
      { key: "outlierIqrFactor", label: "Fator IQR", unit: "× IQR", min: 0.5, max: 5, help: "Ponto para análise fora de Q1 − k·IQR ou Q3 + k·IQR." },
    ],
  },
  {
    title: "Plano de rodízio",
    fields: [
      { key: "rotationMinGapKm", label: "Gap mínimo do rodízio", unit: "km", min: 0, max: 99999999.9, help: "Diferença mínima de hodômetro para sugerir uma troca." },
      { key: "rotationStaleDays", label: "Dias para revalidar", unit: "dias", min: 1, max: 180, integer: true, help: "Depois disso, o plano pede revalidação antes de seguir." },
    ],
  },
];

const ALL_FIELDS = GROUPS.flatMap((g) => g.fields);

const toText = (v: number | null | undefined) => (v == null ? "" : String(v).replace(".", ","));

function parse(text: string): number | null {
  const t = text.trim().replace(/\s/g, "");
  if (!t) return null;
  const normalized = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function validate(def: FieldDef, text: string): string | null {
  const n = parse(text);
  if (text.trim() === "") return "Obrigatório.";
  if (n == null) return "Número inválido.";
  if (def.integer && !Number.isInteger(n)) return "Use um número inteiro.";
  if (def.exclusiveMin ? n <= def.min : n < def.min) return def.exclusiveMin ? `Maior que ${def.min}.` : `Mínimo ${String(def.min).replace(".", ",")}.`;
  if (n > def.max) return `Máximo ${String(def.max).replace(".", ",")}.`;
  return null;
}

const KIND_LABEL: Record<string, string> = { reading: "Leitura", alert: "Alerta", import: "Importação" };

/** Catálogo do banco; sem ele (perfil sem parâmetros), o espelho em types.ts. */
function catalogOf(settings: KmSettings | null | undefined): KmStatusCatalogEntry[] {
  if (settings?.statuses?.length) return settings.statuses;
  const readings = (Object.keys(KM_STATUS) as KmReadingStatus[]).map((code, i) => ({
    code,
    kind: "reading",
    tone: KM_STATUS[code].tone,
    label: KM_STATUS[code].label,
    sortOrder: i,
    description: KM_STATUS[code].description,
    hasReading: null,
    countsDistance: KM_STATUS[code].counts,
  }));
  const alerts = (Object.keys(KM_ALERT_LABEL) as KmAlert[]).map((code, i) => ({
    code,
    kind: "alert",
    tone: "info",
    label: KM_ALERT_LABEL[code],
    sortOrder: 100 + i,
    description: null,
    hasReading: null,
    countsDistance: null,
  }));
  return [...readings, ...alerts];
}

export function StatusCatalog({ settings }: { settings: KmSettings | null | undefined }) {
  const entries = catalogOf(settings);
  return (
    <section aria-labelledby="km-qualidade-catalogo" className="flex flex-col gap-2" data-testid="km-qualidade-catalogo">
      <h3 id="km-qualidade-catalogo" className="text-h4 font-semibold text-fg">Catálogo de situações e alertas</h3>
      <TableContainer>
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-52">Situação</TableHead>
              <TableHead className="w-28">Tipo</TableHead>
              <TableHead className="w-32">Conta nos totais</TableHead>
              <TableHead>Descrição</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e) => (
              <TableRow key={e.code}>
                <TableCell>
                  <ToneBadge tone={e.tone}>{e.label}</ToneBadge>
                </TableCell>
                <TableCell className="text-fg-secondary">{KIND_LABEL[e.kind] ?? e.kind}</TableCell>
                <TableCell className="text-fg-secondary">
                  {e.kind === "reading" ? (e.countsDistance ? "Sim" : "Não") : "—"}
                </TableCell>
                <TableCell className="py-2 text-fg-secondary whitespace-normal">{e.description ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </section>
  );
}

export function SettingsPanel({
  settings, settingsError, canEdit, canReprocess, period, vehicleIds, onChanged,
}: {
  settings: KmSettings | null | undefined;
  settingsError?: string | null;
  canEdit: boolean;
  canReprocess: boolean;
  period: { from: string; to: string } | null | undefined;
  /** Veículos do filtro da tela (reprocessa só eles quando houver). */
  vehicleIds: string[];
  onChanged: () => void;
}) {
  return (
    <section
      aria-labelledby="km-qualidade-parametros"
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface-raised p-4 shadow-card"
      data-testid="km-qualidade-parametros"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="km-qualidade-parametros" className="flex items-center gap-2 text-h4 font-semibold text-fg">
            <SlidersHorizontal className="size-4 text-fg-muted" aria-hidden />
            Parâmetros da Gestão de KM
          </h3>
          <p className="text-caption text-fg-muted">
            Limites usados na classificação das leituras, na análise por coorte e no rodízio.
            {settings?.updatedAt ? ` Última alteração em ${formatStamp(settings.updatedAt)}.` : ""}
          </p>
        </div>
        {canReprocess ? (
          <ReprocessButton period={period} vehicleIds={vehicleIds} onDone={onChanged} />
        ) : null}
      </div>
      {settingsError ? (
        <Alert variant="warning">
          <AlertDescription>Não foi possível ler os parâmetros: {settingsError}</AlertDescription>
        </Alert>
      ) : null}
      {settings ? (
        <SettingsForm key={settings.updatedAt ?? "inicial"} settings={settings} canEdit={canEdit} onSaved={onChanged} />
      ) : null}
    </section>
  );
}

function formatStamp(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function SettingsForm({ settings, canEdit, onSaved }: { settings: KmSettings; canEdit: boolean; onSaved: () => void }) {
  const { toast } = useToast();
  const initial = React.useMemo(() => {
    const out = {} as Record<FieldKey, string>;
    for (const f of ALL_FIELDS) out[f.key] = toText(settings[f.key] as number | null | undefined);
    return out;
  }, [settings]);
  const [values, setValues] = React.useState<Record<FieldKey, string>>(initial);
  const [touched, setTouched] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const errors = {} as Record<FieldKey, string | null>;
  for (const f of ALL_FIELDS) errors[f.key] = validate(f, values[f.key]);
  const invalid = ALL_FIELDS.some((f) => errors[f.key]);
  const dirty = ALL_FIELDS.some((f) => parse(values[f.key]) !== parse(initial[f.key]));

  async function submit() {
    setTouched(true);
    if (invalid || !dirty) return;
    setSaving(true);
    const payload: KmSettingsInput = {};
    for (const f of ALL_FIELDS) payload[f.key] = parse(values[f.key]);
    const res = await saveSettings(payload).catch(() => ({ ok: false as const, error: "Não foi possível salvar os parâmetros." }));
    setSaving(false);
    if (!res.ok) {
      toast({ title: res.error ?? "Não foi possível salvar os parâmetros.", variant: "danger" });
      return;
    }
    toast({
      title: "Parâmetros salvos.",
      description: "Valem para as próximas importações e análises. Para reclassificar leituras já gravadas, reprocesse o período.",
      variant: "success",
    });
    onSaved();
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-4"
    >
      {GROUPS.map((g) => (
        <fieldset key={g.title} className="flex flex-col gap-3">
          <legend className="mb-1 text-label font-semibold text-fg-secondary">{g.title}</legend>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {g.fields.map((f) => (
              <FormField
                key={f.key}
                label={f.label}
                helperText={f.help}
                error={touched ? errors[f.key] : undefined}
                required={canEdit}
              >
                <Input
                  inputMode={f.integer ? "numeric" : "decimal"}
                  autoComplete="off"
                  value={values[f.key]}
                  readOnly={!canEdit}
                  onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  trailingAddon={f.unit}
                  data-testid={`km-qualidade-param-${f.key}`}
                />
              </FormField>
            ))}
          </div>
        </fieldset>
      ))}
      {canEdit ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          {dirty ? <span className="mr-auto text-caption text-fg-muted">Há alterações não salvas.</span> : null}
          <Button
            variant="outline"
            disabled={!dirty || saving}
            onClick={() => {
              setValues(initial);
              setTouched(false);
            }}
          >
            Descartar
          </Button>
          <Button type="submit" loading={saving} disabled={!dirty} leadingIcon={<Save aria-hidden />} data-testid="km-qualidade-salvar-parametros">
            Salvar parâmetros
          </Button>
        </div>
      ) : (
        <p className="text-caption text-fg-muted">Somente leitura: alterar parâmetros exige a permissão de gestão de parâmetros do KM.</p>
      )}
    </form>
  );
}

function ReprocessButton({
  period, vehicleIds, onDone,
}: {
  period: { from: string; to: string } | null | undefined;
  vehicleIds: string[];
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  if (!period) return null;
  const scope = vehicleIds.length
    ? `${fmtInt(vehicleIds.length)} veículo(s) do filtro`
    : "todas as frotas da organização";

  return (
    <>
      <Button
        variant="outline"
        leadingIcon={<RefreshCw aria-hidden />}
        onClick={() => setOpen(true)}
        data-testid="km-qualidade-reprocessar"
      >
        Reprocessar período
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Reprocessar o período?"
        confirmLabel="Reprocessar"
        description={
          <>
            Reclassifica as leituras de {formatDate(period.from)} a {formatDate(period.to)} ({scope}) com os parâmetros
            vigentes e refaz o contexto da data (Fidelização, alocação e Lideranças). Correções manuais mantêm os hodômetros
            corrigidos e leituras pendentes de análise não são reclassificadas. Cada mudança vai para a trilha de auditoria.
          </>
        }
        onConfirm={async () => {
          const res = await reprocess(period.from, period.to, vehicleIds.length ? vehicleIds : undefined).catch(() => ({
            ok: false as const,
            error: "Não foi possível reprocessar o período.",
            data: undefined,
          }));
          if (!res.ok) {
            toast({ title: res.error ?? "Não foi possível reprocessar o período.", variant: "danger" });
            return;
          }
          toast({
            title: "Período reprocessado.",
            description: `${fmtInt(res.data?.statusChanges ?? 0)} leitura(s) reclassificada(s) e ${fmtInt(
              res.data?.contextChanges ?? 0,
            )} contexto(s) da data atualizado(s).`,
            variant: "success",
          });
          onDone();
        }}
      />
    </>
  );
}
