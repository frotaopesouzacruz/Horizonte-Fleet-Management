"use client";

import * as React from "react";
import { CalendarDays, CheckCircle2, Download, Rows3, Truck, UserRound } from "lucide-react";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { NativeSelect } from "@/components/governance/selects";
import { cn } from "@/lib/cn";

type Base = "base-frotas" | "base-motoristas";
type Layout = "periodos" | "diario";

export interface ExportBaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Período sugerido: a competência em tela. */
  defaultFrom: string;
  defaultTo: string;
  /** Base aberta por padrão: a do Planner em que a pessoa está. */
  defaultBase?: Base;
  operations: { id: string; name: string }[];
  coverage: { operationId: string; stateId: number; uf: string; cityId: number; cityName: string }[];
  brCodes: string[];
  /** Filtros em tela, que chegam preenchidos. */
  initial?: { operationId?: string; stateId?: string; cityId?: string };
}

const DAILY_MAX_DAYS = 366;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * Exportar a base dos Planners (frotas e motoristas).
 *
 * Quem abre monta o diálogo de novo a cada abertura (`key`), para que ele
 * volte ao recorte da tela.
 *
 * O arquivo sai da rota de exportação da Central, com a mesma permissão e a
 * mesma auditoria das outras exportações; aqui só se monta o recorte. Duas
 * formas: um registro por vínculo (com o pedaço dele dentro do período) ou a
 * grade diária — uma linha por BR e dia, que é o que o Planner mostra.
 */
export function ExportBaseDialog({
  open,
  onOpenChange,
  defaultFrom,
  defaultTo,
  defaultBase = "base-frotas",
  operations,
  coverage,
  brCodes,
  initial,
}: ExportBaseDialogProps) {
  const [base, setBase] = React.useState<Base>(defaultBase);
  const [layout, setLayout] = React.useState<Layout>("periodos");
  const [dateFrom, setDateFrom] = React.useState(defaultFrom);
  const [dateTo, setDateTo] = React.useState(defaultTo);
  const [plate, setPlate] = React.useState("");
  const [brCode, setBrCode] = React.useState("");
  const [operationId, setOperationId] = React.useState(initial?.operationId ?? "");
  const [stateId, setStateId] = React.useState(initial?.stateId ?? "");
  const [cityId, setCityId] = React.useState(initial?.cityId ?? "");
  const [format, setFormat] = React.useState<"xlsx" | "csv">("xlsx");

  const states = React.useMemo(() => {
    const seen = new Map<number, string>();
    for (const c of coverage) if (!operationId || c.operationId === operationId) seen.set(c.stateId, c.uf);
    return [...seen.entries()].map(([id, uf]) => ({ id, uf })).sort((a, b) => a.uf.localeCompare(b.uf));
  }, [coverage, operationId]);
  const cities = React.useMemo(() => {
    const seen = new Map<number, string>();
    for (const c of coverage) {
      if (operationId && c.operationId !== operationId) continue;
      if (stateId && c.stateId !== Number(stateId)) continue;
      seen.set(c.cityId, c.cityName);
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [coverage, operationId, stateId]);

  const invertedPeriod = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  const dailyProblem =
    layout === "diario"
      ? !dateFrom || !dateTo
        ? "A grade diária precisa de data inicial e final."
        : !invertedPeriod && daysBetween(dateFrom, dateTo) > DAILY_MAX_DAYS
          ? `A grade diária aceita até ${DAILY_MAX_DAYS} dias. Use um período menor ou o layout por vínculo.`
          : null
      : null;
  const problem = invertedPeriod ? "A data inicial é posterior à final." : dailyProblem;

  const href = React.useMemo(() => {
    const q = new URLSearchParams({ tipo: base, layout, format });
    if (dateFrom) q.set("de", dateFrom);
    if (dateTo) q.set("ate", dateTo);
    if (plate.trim()) q.set("placa", plate.trim());
    if (brCode.trim()) q.set("br_codigo", brCode.trim());
    if (operationId) q.set("operacao", operationId);
    if (stateId) q.set("uf", stateId);
    if (cityId) q.set("cidade", cityId);
    return `/governanca/fidelizacao/export?${q.toString()}`;
  }, [base, layout, format, dateFrom, dateTo, plate, brCode, operationId, stateId, cityId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" data-testid="fidelization-export-base">
        <DialogHeader>
          <DialogTitle>Exportar base dos Planners</DialogTitle>
          <DialogDescription>
            Toda a base de vínculos de veículos ou de motoristas, com o recorte que você escolher. O arquivo traz só o que
            o seu perfil enxerga e a exportação fica registrada na auditoria.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="text-label font-semibold text-fg">Base</legend>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <OptionCard
                name="export-base"
                checked={base === "base-frotas"}
                onSelect={() => setBase("base-frotas")}
                icon={<Truck />}
                title="Planner de frotas"
                description="Veículos por BR: placa, frota, alocação, vínculo, origem e trocas."
              />
              <OptionCard
                name="export-base"
                checked={base === "base-motoristas"}
                onSelect={() => setBase("base-motoristas")}
                icon={<UserRound />}
                title="Planner de motoristas"
                description="Motoristas por BR: matrícula, função, veículo do vínculo e período."
              />
            </div>
          </fieldset>

          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="text-label font-semibold text-fg">Formato das linhas</legend>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <OptionCard
                name="export-layout"
                checked={layout === "periodos"}
                onSelect={() => setLayout("periodos")}
                icon={<Rows3 />}
                title="Um registro por vínculo"
                description="Início e fim de cada vínculo e o pedaço dele dentro do período, em dias."
              />
              <OptionCard
                name="export-layout"
                checked={layout === "diario"}
                onSelect={() => setLayout("diario")}
                icon={<CalendarDays />}
                title="Grade diária (BR × dia)"
                description={`Uma linha por BR e dia, como o Planner mostra. Até ${DAILY_MAX_DAYS} dias.`}
              />
            </div>
          </fieldset>

          <FormGrid columns={2}>
            <FormField label="De" id="export-base-from" helperText={layout === "periodos" ? "Em branco: desde o início." : undefined}>
              <DateInput id="export-base-from" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </FormField>
            <FormField label="Até" id="export-base-to" helperText={layout === "periodos" ? "Em branco: até hoje e os planejados." : undefined}>
              <DateInput id="export-base-to" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </FormField>
            <FormField label="Placa ou frota" id="export-base-plate" labelHint="Opcional">
              <Input
                id="export-base-plate"
                value={plate}
                onChange={(e) => setPlate(e.target.value)}
                placeholder="SNT0A23 ou VA151"
                maxLength={20}
                autoComplete="off"
              />
            </FormField>
            <FormField label="BR" id="export-base-br" labelHint="Opcional">
              <Input
                id="export-base-br"
                value={brCode}
                onChange={(e) => setBrCode(e.target.value)}
                placeholder="Código da BR"
                list="export-base-br-codes"
                maxLength={40}
                autoComplete="off"
              />
              <datalist id="export-base-br-codes">
                {brCodes.map((code) => (
                  <option key={code} value={code} />
                ))}
              </datalist>
            </FormField>
            <FormField label="Operação" id="export-base-operation" className="sm:col-span-2">
              <NativeSelect
                id="export-base-operation"
                value={operationId}
                onChange={(e) => {
                  setOperationId(e.target.value);
                  setStateId("");
                  setCityId("");
                }}
              >
                <option value="">Todas as operações</option>
                {operations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="UF" id="export-base-state">
              <NativeSelect
                id="export-base-state"
                value={stateId}
                onChange={(e) => {
                  setStateId(e.target.value);
                  setCityId("");
                }}
              >
                <option value="">Todas</option>
                {states.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.uf}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Local (cidade)" id="export-base-city">
              <NativeSelect id="export-base-city" value={cityId} onChange={(e) => setCityId(e.target.value)}>
                <option value="">Todos</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Arquivo" id="export-base-format">
              <NativeSelect id="export-base-format" value={format} onChange={(e) => setFormat(e.target.value as "xlsx" | "csv")}>
                <option value="xlsx">Excel (XLSX)</option>
                <option value="csv">CSV</option>
              </NativeSelect>
            </FormField>
          </FormGrid>

          {problem ? (
            <Alert variant="warning">
              <AlertDescription>{problem}</AlertDescription>
            </Alert>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            leadingIcon={<Download />}
            disabled={Boolean(problem)}
            onClick={() => {
              window.location.assign(href);
              onOpenChange(false);
            }}
            data-testid="fidelization-export-base-submit"
          >
            Exportar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OptionCard({
  name,
  checked,
  onSelect,
  icon,
  title,
  description,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <label
      className={cn(
        "relative flex cursor-pointer gap-3 rounded-md border p-3 hfm-transition",
        "has-[:focus-visible]:border-border-focus has-[:focus-visible]:shadow-focus",
        checked ? "border-primary bg-primary-soft/40 ring-1 ring-primary" : "border-border bg-surface hover:bg-hover-overlay",
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="sr-only" />
      <span
        aria-hidden
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-sm [&_svg]:size-4",
          checked ? "bg-primary text-primary-fg" : "bg-secondary text-fg-secondary",
        )}
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-body-sm font-semibold text-fg">
          {title}
          {checked ? <CheckCircle2 className="size-4 text-primary-soft-fg" aria-hidden /> : null}
        </span>
        <span className="text-caption text-fg-muted">{description}</span>
      </span>
    </label>
  );
}
