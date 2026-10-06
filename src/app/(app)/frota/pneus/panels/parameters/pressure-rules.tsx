"use client";

import * as React from "react";
import { CalendarPlus, Gauge, Pencil, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import { NativeSelect } from "@/components/governance/selects";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatusBadge } from "@/components/ui/status-badge";
import { SwitchField } from "@/components/ui/switch";
import {
  Table, TableActionCell, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { saveTirePressureRule, type PressureRuleInput } from "@/lib/tires/actions";
import {
  AXLE_LABEL, fmtInt, fmtNum, formatDate, type TirePosition, type TirePressureRule, type TiresCatalog, type TiresTone,
} from "@/lib/tires/types";
import { PanelEmpty } from "../tires-ui";
import {
  dayBefore, dimensionKey, numberError, numberText, parseNumber, RULE_STATE_LABEL, RULE_STATE_TONE, ruleScopeLabel, ruleState,
} from "./param-ui";

/**
 * Parâmetros → Regras de PSI. PSI não é universal: a regra vale por tipo de
 * equipamento × dimensão × posição (ou grupo de eixo), com vigência. Campo
 * vazio = vale para todos; vence a regra mais específica (dimensão > posição >
 * eixo > tipo). Pneu sem regra aplicável é "sem parâmetro" — nunca adequado.
 */
type Coverage = "coberta" | "parcial" | "sem_regra";
const COVERAGE_LABEL: Record<Coverage, string> = { coberta: "Coberta", parcial: "Parcial", sem_regra: "Sem parâmetro" };
const COVERAGE_TONE: Record<Coverage, TiresTone> = { coberta: "success", parcial: "warning", sem_regra: "danger" };
const COVERAGE_HINT: Record<Coverage, string> = {
  coberta: "Há regra vigente para todos os tipos e posições desta dimensão.",
  parcial: "Só há regras restritas a tipo, posição ou eixo: os demais pneus desta dimensão ficam sem parâmetro.",
  sem_regra: "Sem parâmetro: não é classificado como adequado.",
};

const unrestricted = (r: TirePressureRule) => !r.vehicleTypeId && !r.positionCode && !r.axleGroup;

function coverageOf(key: string, rules: TirePressureRule[], today: string): Coverage {
  const applicable = rules.filter((r) => ruleState(r, today) === "vigente" && (r.dimensionKey === key || r.dimensionKey == null));
  if (!applicable.length) return "sem_regra";
  return applicable.some(unrestricted) ? "coberta" : "parcial";
}

const ALL = "";
const GENERAL = "__geral";

type Dialogs =
  | { mode: "create"; preset?: { dimensionKey?: string } }
  | { mode: "edit"; rule: TirePressureRule }
  | { mode: "successor"; rule: TirePressureRule };

export function PressureRulesSection({ catalog, canManage, onDone }: { catalog: TiresCatalog; canManage: boolean; onDone: () => void }) {
  const today = catalog.today;
  const [typeFilter, setTypeFilter] = React.useState(ALL);
  const [dimFilter, setDimFilter] = React.useState(ALL);
  const [onlyCurrent, setOnlyCurrent] = React.useState<"vigentes" | "todas">("todas");
  const [dialog, setDialog] = React.useState<Dialogs | null>(null);

  const positions = React.useMemo(() => new Map(catalog.positions.map((p) => [p.code, p])), [catalog.positions]);
  const rules = catalog.pressureRules;

  const coverage = React.useMemo(
    () => catalog.observedDimensions.map((d) => ({ ...d, coverage: coverageOf(d.key, rules, today) })),
    [catalog.observedDimensions, rules, today],
  );
  const gaps = coverage.filter((d) => d.coverage === "sem_regra");
  const gapTires = gaps.reduce((s, d) => s + d.tires, 0);

  const typeOptions = React.useMemo(() => {
    const m = new Map(catalog.vehicleTypes.map((t) => [t.id, t.name]));
    for (const r of rules) if (r.vehicleTypeId && !m.has(r.vehicleTypeId)) m.set(r.vehicleTypeId, r.vehicleTypeName ?? "Tipo sem veículos");
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [catalog.vehicleTypes, rules]);
  const dimensionOptions = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const d of catalog.observedDimensions) m.set(d.key, d.label);
    for (const r of rules) if (r.dimensionKey && !m.has(r.dimensionKey)) m.set(r.dimensionKey, r.dimension ?? r.dimensionKey);
    return [...m.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR", { numeric: true }));
  }, [catalog.observedDimensions, rules]);

  const visible = rules.filter((r) => {
    if (typeFilter === GENERAL ? r.vehicleTypeId != null : typeFilter !== ALL && r.vehicleTypeId !== typeFilter) return false;
    if (dimFilter === GENERAL ? r.dimensionKey != null : dimFilter !== ALL && r.dimensionKey !== dimFilter) return false;
    if (onlyCurrent === "vigentes" && ruleState(r, today) !== "vigente") return false;
    return true;
  });
  const filtered = typeFilter !== ALL || dimFilter !== ALL || onlyCurrent !== "todas";
  const colSpan = canManage ? 10 : 9;

  return (
    <div className="flex flex-col gap-5" data-testid="tires-param-psi">
      <p className="max-w-[100ch] text-body-sm text-fg-muted">
        PSI não é universal: cada regra vale para um tipo de equipamento, uma dimensão e uma posição ou grupo de eixo, com vigência. Campo vazio vale para
        todos; quando mais de uma regra se aplica, vence a mais específica (dimensão, depois posição, eixo e tipo). Pneu sem regra aplicável fica{" "}
        <strong className="font-semibold text-fg">sem parâmetro</strong> — nunca é classificado como adequado.
      </p>

      {gaps.length > 0 ? (
        <Alert variant="danger" data-testid="tires-psi-gaps">
          <AlertTitle>
            {fmtInt(gaps.length)} {gaps.length === 1 ? "dimensão dos dados atuais sem nenhuma regra vigente" : "dimensões dos dados atuais sem nenhuma regra vigente"} ·{" "}
            {fmtInt(gapTires)} {gapTires === 1 ? "pneu" : "pneus"}
          </AlertTitle>
          <AlertDescription>
            {gaps.map((g) => g.label).join(", ")}. Sem parâmetro: não é classificado como adequado.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card data-testid="tires-psi-coverage">
        <CardHeader
          title="Cobertura das dimensões dos dados atuais"
          description={
            catalog.latestReferenceDate
              ? `Dimensões presentes nos dados de ${formatDate(catalog.latestReferenceDate)}. Coberta = há regra vigente hoje para todos os tipos e posições daquela dimensão.`
              : "Nenhum dado oficial confirmado ainda: não há dimensões observadas."
          }
        />
        <CardContent>
          {coverage.length === 0 ? (
            <p className="text-body-sm text-fg-muted">Sem dimensões observadas.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {coverage.map((d) => (
                <li
                  key={d.key}
                  className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                  data-testid="tires-psi-coverage-item"
                  data-coverage={d.coverage}
                >
                  <div className="min-w-0">
                    <span className="block truncate font-medium text-fg tabular-nums">{d.label}</span>
                    <span className="block text-caption text-fg-muted">
                      {fmtInt(d.tires)} {d.tires === 1 ? "pneu" : "pneus"}
                      {d.coverage === "coberta" ? null : <span className="block text-fg-secondary">{COVERAGE_HINT[d.coverage]}</span>}
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge status={COVERAGE_TONE[d.coverage]} size="sm">{COVERAGE_LABEL[d.coverage]}</StatusBadge>
                    {canManage && d.coverage !== "coberta" ? (
                      <Button
                        size="sm"
                        variant="link"
                        className="h-auto text-caption"
                        onClick={() => setDialog({ mode: "create", preset: { dimensionKey: d.key } })}
                        data-testid="tires-psi-gap-create"
                      >
                        Criar regra
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid w-full grid-cols-1 gap-3 sm:w-auto sm:grid-cols-[14rem_14rem_auto] sm:items-end">
            <FormField label="Tipo de equipamento">
              <NativeSelect fieldSize="sm" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} data-testid="tires-psi-filter-type">
                <option value={ALL}>Todos</option>
                <option value={GENERAL}>Só regras para todos os tipos</option>
                {typeOptions.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Dimensão">
              <NativeSelect fieldSize="sm" value={dimFilter} onChange={(e) => setDimFilter(e.target.value)} data-testid="tires-psi-filter-dimension">
                <option value={ALL}>Todas</option>
                <option value={GENERAL}>Só regras para todas as dimensões</option>
                {dimensionOptions.map((d) => (
                  <option key={d.key} value={d.key}>{d.label}</option>
                ))}
              </NativeSelect>
            </FormField>
            <SegmentedControl
              aria-label="Situação das regras"
              value={onlyCurrent}
              onValueChange={setOnlyCurrent}
              options={[
                { value: "todas", label: "Todas" },
                { value: "vigentes", label: "Só vigentes" },
              ]}
              data-testid="tires-psi-filter-state"
            />
          </div>
          {canManage ? (
            <Button size="sm" variant="primary" leadingIcon={<Plus />} onClick={() => setDialog({ mode: "create" })} data-testid="tires-psi-new">
              Nova regra
            </Button>
          ) : null}
        </div>
        <p className="text-caption text-fg-muted" aria-live="polite">
          {filtered ? `${fmtInt(visible.length)} de ${fmtInt(rules.length)} regras` : `${fmtInt(rules.length)} ${rules.length === 1 ? "regra" : "regras"}`} ·{" "}
          {fmtInt(rules.filter((r) => ruleState(r, today) === "vigente").length)} vigentes hoje
        </p>

        {rules.length === 0 ? (
          <PanelEmpty
            icon={<Gauge />}
            title="Nenhuma regra de PSI cadastrada"
            description="Sem regra, nenhum pneu tem a pressão avaliada: todos ficam “sem parâmetro”."
            testId="tires-psi-empty"
          />
        ) : (
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo de equipamento</TableHead>
                  <TableHead>Dimensão</TableHead>
                  <TableHead>Posição ou eixo</TableHead>
                  <TableHead numeric>Mín.</TableHead>
                  <TableHead numeric>Ideal</TableHead>
                  <TableHead numeric>Máx.</TableHead>
                  <TableHead numeric>Sulco legal / atenção</TableHead>
                  <TableHead>Vigência</TableHead>
                  <TableHead>Situação</TableHead>
                  {canManage ? <TableHead><span className="sr-only">Ações</span></TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.length === 0 ? (
                  <TableEmpty
                    colSpan={colSpan}
                    message="Nenhuma regra com esses filtros."
                    action={
                      <Button size="sm" variant="secondary" onClick={() => { setTypeFilter(ALL); setDimFilter(ALL); setOnlyCurrent("todas"); }}>
                        Limpar filtros
                      </Button>
                    }
                  />
                ) : (
                  visible.map((r) => {
                    const st = ruleState(r, today);
                    return (
                      <TableRow key={r.id} className={cn("align-top", st !== "vigente" && "text-fg-secondary")} data-testid="tires-psi-row" data-state-rule={st}>
                        <TableCell className="py-2">{r.vehicleTypeName ?? <span className="text-fg-muted">Todos os tipos</span>}</TableCell>
                        <TableCell className="whitespace-nowrap py-2 font-medium tabular-nums">{r.dimension ?? <span className="font-normal text-fg-muted">Todas</span>}</TableCell>
                        <TableCell className="py-2">
                          {r.positionCode || r.axleGroup ? ruleScopeLabel(r, positions) : <span className="whitespace-nowrap text-fg-muted">Todas as posições</span>}
                        </TableCell>
                        <TableCell numeric className="py-2">{fmtNum(r.minPsi)}</TableCell>
                        <TableCell numeric className="py-2 font-semibold text-fg">{fmtNum(r.idealPsi)}</TableCell>
                        <TableCell numeric className="py-2">{fmtNum(r.maxPsi)}</TableCell>
                        <TableCell numeric className="whitespace-nowrap py-2">
                          {r.minLegalTreadMm == null && r.attentionTreadMm == null
                            ? "—"
                            : `${r.minLegalTreadMm == null ? "—" : fmtNum(r.minLegalTreadMm)} / ${r.attentionTreadMm == null ? "—" : fmtNum(r.attentionTreadMm)} mm`}
                        </TableCell>
                        <TableCell className="whitespace-nowrap py-2 tabular-nums">
                          {formatDate(r.validFrom)} {r.validTo ? `a ${formatDate(r.validTo)}` : "em diante"}
                          {r.notes ? <span className="block max-w-[14rem] whitespace-normal text-caption text-fg-muted">{r.notes}</span> : null}
                        </TableCell>
                        <TableCell className="py-2">
                          <StatusBadge status={RULE_STATE_TONE[st]} size="sm">{RULE_STATE_LABEL[st]}</StatusBadge>
                        </TableCell>
                        {canManage ? (
                          <TableActionCell className="py-1">
                            <IconButton size="sm" label="Corrigir regra" onClick={() => setDialog({ mode: "edit", rule: r })} data-testid="tires-psi-edit">
                              <Pencil />
                            </IconButton>
                            {st === "vigente" ? (
                              <IconButton
                                size="sm"
                                label="Nova vigência (encerra esta e abre outra)"
                                onClick={() => setDialog({ mode: "successor", rule: r })}
                                data-testid="tires-psi-successor"
                              >
                                <CalendarPlus />
                              </IconButton>
                            ) : (
                              <span className="inline-block size-(--control-height-sm)" aria-hidden />
                            )}
                          </TableActionCell>
                        ) : null}
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </div>

      {dialog ? (
        <RuleDialog
          key={dialog.mode === "create" ? `new:${dialog.preset?.dimensionKey ?? ""}` : `${dialog.mode}:${dialog.rule.id}`}
          state={dialog}
          catalog={catalog}
          typeOptions={typeOptions}
          dimensionOptions={dimensionOptions}
          onClose={() => setDialog(null)}
          onDone={onDone}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diálogo da regra (criar, corrigir, nova vigência)
// ---------------------------------------------------------------------------
type Scope = "all" | "position" | "axle";
const OTHER_DIMENSION = "__outra";

interface RuleForm {
  vehicleTypeId: string;
  dimensionChoice: string;
  dimensionText: string;
  scope: Scope;
  positionCode: string;
  axleGroup: "" | "front" | "rear" | "spare";
  minPsi: string;
  idealPsi: string;
  maxPsi: string;
  minLegalTreadMm: string;
  attentionTreadMm: string;
  validFrom: string;
  validTo: string;
  isActive: boolean;
  notes: string;
}

function initialForm(state: Dialogs, today: string, knownDims: Set<string>): RuleForm {
  const r = state.mode === "create" ? null : state.rule;
  const dimKey = r ? r.dimensionKey : state.mode === "create" ? state.preset?.dimensionKey ?? null : null;
  return {
    vehicleTypeId: r?.vehicleTypeId ?? "",
    dimensionChoice: dimKey ? (knownDims.has(dimKey) ? dimKey : OTHER_DIMENSION) : "",
    dimensionText: r?.dimension ?? "",
    scope: r?.positionCode ? "position" : r?.axleGroup ? "axle" : "all",
    positionCode: r?.positionCode ?? "",
    axleGroup: r?.axleGroup ?? "",
    minPsi: numberText(r?.minPsi),
    idealPsi: numberText(r?.idealPsi),
    maxPsi: numberText(r?.maxPsi),
    minLegalTreadMm: numberText(r?.minLegalTreadMm),
    attentionTreadMm: numberText(r?.attentionTreadMm),
    validFrom: state.mode === "edit" ? r!.validFrom : state.mode === "successor" && r!.validFrom >= today ? "" : today,
    validTo: state.mode === "edit" ? r!.validTo ?? "" : state.mode === "successor" ? r!.validTo ?? "" : "",
    isActive: state.mode === "edit" ? r!.isActive : true,
    notes: state.mode === "edit" ? r!.notes ?? "" : "",
  };
}

const ruleToInput = (r: TirePressureRule): PressureRuleInput => ({
  id: r.id,
  vehicleTypeId: r.vehicleTypeId,
  dimension: r.dimension,
  positionCode: r.positionCode,
  axleGroup: r.axleGroup,
  minPsi: r.minPsi,
  idealPsi: r.idealPsi,
  maxPsi: r.maxPsi,
  minLegalTreadMm: r.minLegalTreadMm,
  attentionTreadMm: r.attentionTreadMm,
  isActive: r.isActive,
  validFrom: r.validFrom,
  validTo: r.validTo,
  notes: r.notes,
});

// Faixas = checagens da tabela `tire_pressure_rules` (o banco revalida).
const PSI_RULE = { min: 0, max: 300, decimals: 2 };
const TREAD_RULE = { min: 0, above: true, max: 999.99, decimals: 2, optional: true };

function RuleDialog({
  state, catalog, typeOptions, dimensionOptions, onClose, onDone,
}: {
  state: Dialogs;
  catalog: TiresCatalog;
  typeOptions: { id: string; name: string }[];
  dimensionOptions: { key: string; label: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const today = catalog.today;
  const knownDims = React.useMemo(() => new Set(dimensionOptions.map((d) => d.key)), [dimensionOptions]);
  const [form, setForm] = React.useState<RuleForm>(() => initialForm(state, today, knownDims));
  const [submitted, setSubmitted] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const set = <K extends keyof RuleForm>(key: K, value: RuleForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const rule = state.mode === "create" ? null : state.rule;
  const successor = state.mode === "successor";
  const scopeLocked = successor;

  const observedTires = new Map(catalog.observedDimensions.map((d) => [d.key, d.tires]));
  const activePositions = catalog.positions.filter((p) => p.isActive || p.code === rule?.positionCode);

  // --- valores normalizados -------------------------------------------------
  const dimension =
    form.dimensionChoice === ""
      ? null
      : form.dimensionChoice === OTHER_DIMENSION
        ? form.dimensionText.trim() || null
        : (dimensionOptions.find((d) => d.key === form.dimensionChoice)?.label ?? form.dimensionChoice);
  const dimKey = dimensionKey(dimension);
  const positionCode = form.scope === "position" ? form.positionCode || null : null;
  const axleGroup = form.scope === "axle" ? form.axleGroup || null : null;
  const minPsi = parseNumber(form.minPsi);
  const idealPsi = parseNumber(form.idealPsi);
  const maxPsi = parseNumber(form.maxPsi);
  const legal = parseNumber(form.minLegalTreadMm);
  const attention = parseNumber(form.attentionTreadMm);

  // --- validação ------------------------------------------------------------
  const errors: Partial<Record<keyof RuleForm | "overlap", string>> = {};
  if (form.dimensionChoice === OTHER_DIMENSION && !dimKey) errors.dimensionText = "Informe a dimensão (ex.: 295/80 R22.5).";
  if (form.scope === "position" && !form.positionCode) errors.positionCode = "Escolha a posição.";
  if (form.scope === "axle" && !form.axleGroup) errors.axleGroup = "Escolha o grupo de eixo.";
  (["minPsi", "idealPsi", "maxPsi"] as const).forEach((k) => {
    const e = numberError(form[k], PSI_RULE);
    if (e) errors[k] = e;
  });
  if (!errors.minPsi && !errors.idealPsi && minPsi! > idealPsi!) errors.idealPsi = "O ideal não pode ser menor que o mínimo.";
  if (!errors.idealPsi && !errors.maxPsi && idealPsi! > maxPsi!) errors.maxPsi = "O máximo não pode ser menor que o ideal.";
  if (!errors.minPsi && !errors.maxPsi && minPsi! > maxPsi!) errors.maxPsi ??= "O máximo não pode ser menor que o mínimo.";
  (["minLegalTreadMm", "attentionTreadMm"] as const).forEach((k) => {
    const e = numberError(form[k], TREAD_RULE);
    if (e) errors[k] = e;
  });
  if (!errors.minLegalTreadMm && !errors.attentionTreadMm && legal != null && attention != null && attention < legal) {
    errors.attentionTreadMm = "A atenção não pode ser menor que o sulco legal.";
  }
  if (!form.validFrom) errors.validFrom = "Informe o início da vigência.";
  else if (successor && rule && form.validFrom <= rule.validFrom) errors.validFrom = `A nova vigência deve começar depois de ${formatDate(rule.validFrom)}.`;
  if (form.validTo && form.validFrom && form.validTo < form.validFrom) errors.validTo = "O fim não pode ser antes do início.";
  if (form.notes.trim().length > 500) errors.notes = "No máximo 500 caracteres.";

  // Mesma combinação ativa com vigência sobreposta: o banco recusa; avisamos antes.
  const overlapping =
    form.isActive && form.validFrom
      ? catalog.pressureRules.find(
          (x) =>
            x.isActive &&
            x.id !== rule?.id &&
            (x.vehicleTypeId ?? null) === (form.vehicleTypeId || null) &&
            (x.dimensionKey ?? null) === dimKey &&
            (x.positionCode ?? null) === positionCode &&
            (x.axleGroup ?? null) === axleGroup &&
            x.validFrom <= (form.validTo || "9999-12-31") &&
            (x.validTo ?? "9999-12-31") >= form.validFrom,
        )
      : undefined;
  if (overlapping) {
    errors.overlap = `Já existe uma regra ativa para a mesma combinação com vigência sobreposta (${formatDate(overlapping.validFrom)} ${
      overlapping.validTo ? `a ${formatDate(overlapping.validTo)}` : "em diante"
    }). Encerre ou desative a outra antes, ou ajuste a vigência.`;
  }
  const hasErrors = Object.keys(errors).length > 0;
  const err = (k: keyof RuleForm) => (submitted ? errors[k] : undefined);
  // Valores numéricos já mostram erro enquanto se digita.
  const live = (k: keyof RuleForm) => (submitted || form[k] !== "" ? errors[k] : undefined);

  const submit = async () => {
    setSubmitted(true);
    if (hasErrors) return;
    const input: PressureRuleInput = {
      id: state.mode === "edit" ? rule!.id : null,
      vehicleTypeId: form.vehicleTypeId || null,
      dimension,
      positionCode,
      axleGroup,
      minPsi: minPsi!,
      idealPsi: idealPsi!,
      maxPsi: maxPsi!,
      minLegalTreadMm: legal,
      attentionTreadMm: attention,
      isActive: form.isActive,
      validFrom: form.validFrom,
      validTo: form.validTo || null,
      notes: form.notes.trim() || null,
    };
    setBusy(true);
    try {
      if (successor && rule) {
        // Encerra a regra atual na véspera e abre a nova; se a nova falhar, a anterior volta como estava.
        const needsClose = rule.validTo == null || rule.validTo >= form.validFrom;
        if (needsClose) {
          const closed = await saveTirePressureRule({ ...ruleToInput(rule), validTo: dayBefore(form.validFrom) });
          if (!closed.ok) {
            toast({ title: "Não foi possível encerrar a regra atual", description: closed.error, variant: "danger" });
            return;
          }
        }
        const created = await saveTirePressureRule(input);
        if (!created.ok) {
          const restored = needsClose ? await saveTirePressureRule(ruleToInput(rule)) : { ok: true };
          toast({
            title: "Nova vigência não criada",
            description: `${created.error ?? ""} ${
              restored.ok ? "A regra anterior continua como estava." : `Atenção: a regra anterior ficou encerrada em ${formatDate(dayBefore(form.validFrom))}; revise-a.`
            }`.trim(),
            variant: "danger",
          });
          if (!restored.ok) onDone();
          return;
        }
        toast({
          title: "Nova vigência criada",
          description: `${needsClose ? `A regra anterior vale até ${formatDate(dayBefore(form.validFrom))}; a` : "A"} nova vale a partir de ${formatDate(form.validFrom)}.`,
          variant: "success",
        });
      } else {
        const r = await saveTirePressureRule(input);
        if (!r.ok) {
          toast({ title: "Não foi possível salvar a regra de PSI", description: r.error, variant: "danger" });
          return;
        }
        toast({ title: state.mode === "edit" ? "Regra de PSI atualizada" : "Regra de PSI criada", variant: "success" });
      }
      onClose();
      onDone();
    } catch {
      toast({ title: "Falha de comunicação com o servidor", description: "Tente de novo.", variant: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const title = state.mode === "create" ? "Nova regra de PSI" : state.mode === "edit" ? "Editar regra de PSI" : "Nova vigência da regra";
  const scopeSummary = rule
    ? [rule.vehicleTypeName ?? "Todos os tipos", rule.dimension ?? "todas as dimensões", ruleScopeLabel(rule, new Map(catalog.positions.map((p) => [p.code, p])))].join(" · ")
    : null;

  return (
    <Dialog open onOpenChange={(o) => (!o && !busy ? onClose() : undefined)}>
      <DialogContent size="lg" data-testid="tires-psi-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {state.mode === "create"
              ? "Campo vazio vale para todos. A regra mais específica vence quando mais de uma se aplica ao pneu."
              : state.mode === "edit"
                ? "Corrige esta regra (os valores anteriores ficam na trilha de auditoria). Para mudar valores a partir de uma data mantendo o histórico, use “Nova vigência”."
                : `Encerra a regra atual (${scopeSummary}) na véspera da data escolhida e abre uma nova com os valores abaixo. Os dados anteriores continuam avaliados com a regra antiga.`}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          <fieldset className="flex flex-col gap-4" disabled={busy}>
            <legend className="mb-3 text-body-sm font-semibold text-fg">Onde a regra vale</legend>
            {scopeLocked ? (
              <p className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-body-sm text-fg-secondary" data-testid="tires-psi-scope-locked">
                {scopeSummary}
              </p>
            ) : (
              <>
                <FormGrid columns={2}>
                  <FormField label="Tipo de equipamento" helperText="Vazio = todos os tipos.">
                    <NativeSelect value={form.vehicleTypeId} onChange={(e) => set("vehicleTypeId", e.target.value)} data-testid="tires-psi-type">
                      <option value="">Todos os tipos</option>
                      {typeOptions.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </NativeSelect>
                  </FormField>
                  <FormField label="Dimensão" helperText="Entre parênteses, pneus nos dados mais recentes.">
                    <NativeSelect value={form.dimensionChoice} onChange={(e) => set("dimensionChoice", e.target.value)} data-testid="tires-psi-dimension">
                      <option value="">Todas as dimensões</option>
                      {dimensionOptions.map((d) => {
                        const n = observedTires.get(d.key);
                        return (
                          <option key={d.key} value={d.key}>
                            {d.label} ({n == null ? "sem pneus nos dados atuais" : `${fmtInt(n)} ${n === 1 ? "pneu" : "pneus"}`})
                          </option>
                        );
                      })}
                      <option value={OTHER_DIMENSION}>Outra dimensão…</option>
                    </NativeSelect>
                  </FormField>
                  {form.dimensionChoice === OTHER_DIMENSION ? (
                    <FormField label="Outra dimensão" required error={err("dimensionText")} className="sm:col-start-2">
                      <Input value={form.dimensionText} onChange={(e) => set("dimensionText", e.target.value)} placeholder="Ex.: 295/80 R22.5" data-testid="tires-psi-dimension-text" />
                    </FormField>
                  ) : null}
                </FormGrid>
                <FormField label="Posição">
                  <SegmentedControl
                    aria-label="Escopo de posição"
                    value={form.scope}
                    onValueChange={(v) => set("scope", v)}
                    wrap
                    options={[
                      { value: "all", label: "Todas as posições", "data-testid": "tires-psi-scope-all" },
                      { value: "position", label: "Uma posição", "data-testid": "tires-psi-scope-position" },
                      { value: "axle", label: "Grupo de eixo", "data-testid": "tires-psi-scope-axle" },
                    ]}
                  />
                </FormField>
                {form.scope === "position" ? (
                  <FormField label="Posição" required error={err("positionCode")} className="sm:max-w-sm">
                    <NativeSelect value={form.positionCode} onChange={(e) => set("positionCode", e.target.value)} data-testid="tires-psi-position">
                      <option value="">Escolha…</option>
                      {activePositions.map((p: TirePosition) => (
                        <option key={p.code} value={p.code}>
                          {p.code} · {p.label}
                          {p.isActive ? "" : " (inativa)"}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormField>
                ) : null}
                {form.scope === "axle" ? (
                  <FormField label="Grupo de eixo" required error={err("axleGroup")} className="sm:max-w-sm">
                    <NativeSelect value={form.axleGroup} onChange={(e) => set("axleGroup", e.target.value as RuleForm["axleGroup"])} data-testid="tires-psi-axle">
                      <option value="">Escolha…</option>
                      {(["front", "rear", "spare"] as const).map((g) => (
                        <option key={g} value={g}>{AXLE_LABEL[g]}</option>
                      ))}
                    </NativeSelect>
                  </FormField>
                ) : null}
              </>
            )}
          </fieldset>

          <fieldset className="flex flex-col gap-4" disabled={busy}>
            <legend className="mb-3 text-body-sm font-semibold text-fg">Pressão (PSI) e sulco</legend>
            <div className="grid grid-cols-3 gap-3">
              <FormField label="Mínimo (PSI)" required error={live("minPsi")}>
                <Input value={form.minPsi} onChange={(e) => set("minPsi", e.target.value)} inputMode="decimal" autoComplete="off" data-testid="tires-psi-min" />
              </FormField>
              <FormField label="Ideal (PSI)" required error={live("idealPsi")}>
                <Input value={form.idealPsi} onChange={(e) => set("idealPsi", e.target.value)} inputMode="decimal" autoComplete="off" data-testid="tires-psi-ideal" />
              </FormField>
              <FormField label="Máximo (PSI)" required error={live("maxPsi")}>
                <Input value={form.maxPsi} onChange={(e) => set("maxPsi", e.target.value)} inputMode="decimal" autoComplete="off" data-testid="tires-psi-max" />
              </FormField>
            </div>
            <p className="-mt-2 text-helper text-fg-muted">Abaixo do mínimo = pressão baixa; acima do máximo = excesso. O ideal é a pressão recomendada.</p>
            <FormGrid columns={2}>
              <FormField label="Sulco legal" labelHint="Opcional" error={live("minLegalTreadMm")} helperText="Igual ou abaixo = Abaixo do legal.">
                <Input value={form.minLegalTreadMm} onChange={(e) => set("minLegalTreadMm", e.target.value)} inputMode="decimal" autoComplete="off" trailingAddon="mm" data-testid="tires-psi-legal" />
              </FormField>
              <FormField label="Sulco de atenção" labelHint="Opcional" error={live("attentionTreadMm")} helperText="Referência da regra; a classe Atenção usa o limite geral de Prazos e limites.">
                <Input value={form.attentionTreadMm} onChange={(e) => set("attentionTreadMm", e.target.value)} inputMode="decimal" autoComplete="off" trailingAddon="mm" data-testid="tires-psi-attention" />
              </FormField>
            </FormGrid>
          </fieldset>

          <fieldset className="flex flex-col gap-4" disabled={busy}>
            <legend className="mb-3 text-body-sm font-semibold text-fg">Vigência</legend>
            <FormGrid columns={2}>
              <FormField label={successor ? "Nova vigência a partir de" : "Vale a partir de"} required error={err("validFrom") ?? (form.validFrom ? errors.validFrom : undefined)}>
                <DateInput value={form.validFrom} onChange={(e) => set("validFrom", e.target.value)} data-testid="tires-psi-from" />
              </FormField>
              <FormField label="Vale até" labelHint="Opcional" error={errors.validTo} helperText="Vazio = sem data de fim.">
                <DateInput value={form.validTo} min={form.validFrom || undefined} onChange={(e) => set("validTo", e.target.value)} data-testid="tires-psi-to" />
              </FormField>
            </FormGrid>
            {!successor ? (
              <SwitchField
                label="Ativa"
                description="Regra inativa não é aplicada a nenhum pneu (fica no histórico)."
                checked={form.isActive}
                onCheckedChange={(v) => set("isActive", v)}
                className="rounded-md border border-border"
                data-testid="tires-psi-active"
              />
            ) : null}
            <FormField label="Notas" labelHint="Opcional" error={errors.notes} helperText="Origem do valor (manual do fabricante, norma interna…).">
              <Textarea rows={2} value={form.notes} maxLength={500} onChange={(e) => set("notes", e.target.value)} data-testid="tires-psi-notes" />
            </FormField>
          </fieldset>
        </DialogBody>
        {errors.overlap && (submitted || !scopeLocked) ? (
          <div className="border-t border-border px-5 py-3">
            <Alert variant="warning" className="py-2" data-testid="tires-psi-overlap">
              <AlertDescription>{errors.overlap}</AlertDescription>
            </Alert>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} data-testid="tires-psi-save">
            {state.mode === "create" ? "Criar regra" : state.mode === "edit" ? "Salvar correção" : "Criar nova vigência"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
