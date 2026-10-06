"use client";

import * as React from "react";
import { Recycle, SlidersHorizontal, TriangleAlert, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FilterBar, FilterChip } from "@/components/ui/filter-bar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchField } from "@/components/ui/search-field";
import { ToggleChip } from "@/components/ui/segmented-control";
import { NativeSelect } from "@/components/governance/selects";
import {
  DEADLINE_LABEL,
  formatDate,
  PSI_LABEL,
  SEVERITY_LABEL,
  STATUS_LABEL,
  TIRES_FILTER_PARAM,
  TREAD_LABEL,
  type TireFilterOptions,
  type TiresFilters,
  type TiresNavigate,
} from "@/lib/tires/types";

/**
 * Filtros padronizados da Gestão de Pneus — os mesmos em todas as telas:
 *
 *   Data dos dados · Operação → Local de Operação → Liderança → Tipo de
 *   equipamento → Frota · Nº Fogo/placa/frota
 *   (Mais filtros: Situação, Fabricante → Modelo, Medida e recortes técnicos)
 *
 * A cascata usa as combinações REAIS devolvidas pelo banco (`combos`): um
 * nível só oferece opções compatíveis com o que já foi escolhido, e trocar um
 * nível limpa os de baixo. O banco recebe ids e códigos canônicos; cada
 * mudança é uma ida ao servidor e zera a página.
 */
const P = TIRES_FILTER_PARAM;

export type TiresFilterField = keyof TiresFilters;

const ALL_FIELDS: TiresFilterField[] = [
  "reference", "operation", "city", "leader", "vehicleType", "vehicle", "status", "brand", "model", "dimension",
  "state", "br", "unit", "life", "position", "tread", "measurement", "calibration", "psi", "severity", "quality", "retread",
  "conformity", "calConformity", "q",
];

/** Campos do primeiro nível (o resto fica em "Mais filtros"). */
const PRIMARY: TiresFilterField[] = ["reference", "operation", "city", "leader", "vehicleType", "vehicle", "q"];

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 ${className ?? ""}`}>
      <span className="text-caption text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

export interface TiresFilterBarProps {
  filters: TiresFilters;
  options: TireFilterOptions;
  navigate: TiresNavigate;
  pending: boolean;
  /** Campos exibidos (padrão: todos). */
  fields?: TiresFilterField[];
  searchPlaceholder?: string;
  searchLabel?: string;
}

type Combo = { operationId: string | null; cityId: number | null; leaderId: string | null; vehicleTypeId: string | null };

export function TiresFilterBar({
  filters, options, navigate, pending, fields = ALL_FIELDS, searchPlaceholder = "Ex.: 001234, SNT8I36 ou VA174", searchLabel = "Nº Fogo, placa ou frota",
}: TiresFilterBarProps) {
  const show = (f: TiresFilterField) => fields.includes(f);
  const set = (key: keyof TiresFilters, value: string | null, extra: Record<string, string | null> = {}) =>
    navigate({ [P[key]]: value || null, pagina: null, ...extra });

  // ------------------------------------------------------------ cascata pelas combinações reais
  const combos = React.useMemo(() => (options.combos ?? []) as Combo[], [options.combos]);
  const matches = React.useCallback(
    (c: Combo, upTo: "city" | "leader" | "type" | "vehicle") => {
      if (filters.operation && c.operationId !== filters.operation) return false;
      if (upTo === "city") return true;
      if (filters.city && String(c.cityId) !== filters.city) return false;
      if (upTo === "leader") return true;
      if (filters.leader && c.leaderId !== filters.leader) return false;
      if (upTo === "type") return true;
      if (filters.vehicleType && c.vehicleTypeId !== filters.vehicleType) return false;
      return true;
    },
    [filters.operation, filters.city, filters.leader, filters.vehicleType],
  );
  const cityIds = React.useMemo(() => new Set(combos.filter((c) => matches(c, "city")).map((c) => String(c.cityId))), [combos, matches]);
  const leaderIds = React.useMemo(() => new Set(combos.filter((c) => matches(c, "leader")).map((c) => c.leaderId)), [combos, matches]);
  const typeIds = React.useMemo(() => new Set(combos.filter((c) => matches(c, "type")).map((c) => c.vehicleTypeId)), [combos, matches]);
  const cities = options.cities.filter((c) => !filters.operation || cityIds.has(String(c.id)));
  const leaders = options.leaders.filter((l) => !(filters.operation || filters.city) || leaderIds.has(l.id));
  const types = options.vehicleTypes.filter((t) => !(filters.operation || filters.city || filters.leader) || typeIds.has(t.id));
  const vehicles = options.vehicles.filter(
    (v) =>
      (!filters.operation || v.operationId === filters.operation) &&
      (!filters.city || String(v.cityId) === filters.city) &&
      (!filters.leader || v.leaderId === filters.leader) &&
      (!filters.vehicleType || v.vehicleTypeId === filters.vehicleType),
  );
  const brs = options.brs.filter((b) => !filters.operation || b.operationId === filters.operation);
  const models = options.models.filter((m) => !filters.brand || m.brand === filters.brand);

  const quality = filters.quality === "1" || filters.quality === "true";
  const retread = filters.retread === "1" || filters.retread === "true";

  const moreKeys = ALL_FIELDS.filter((k) => !PRIMARY.includes(k));
  const moreCount = moreKeys.filter((k) => show(k) && Boolean(filters[k])).length;
  const anyActive = ALL_FIELDS.some((k) => show(k) && Boolean(filters[k])) || Boolean(filters.missing);

  const clearAll = () => {
    const patch: Record<string, string | null> = { pagina: null, foto: null };
    for (const param of Object.values(P)) patch[param] = null;
    navigate(patch);
  };

  const name = (list: { id: string | number; name?: string; code?: string; uf?: string }[], id?: string) => {
    if (!id) return "";
    const found = list.find((o) => String(o.id) === id);
    return found?.name ?? found?.code ?? found?.uf ?? id;
  };
  const labelsOf = (map: Record<string, string>, raw: string) => raw.split(",").map((v) => map[v] ?? v).join(", ");
  const latest = options.referenceDates[0]?.referenceDate ?? null;
  const cityLabel = (c: { name: string; uf: string }) => `${c.name} · ${c.uf}`;

  const chips: { key: string; label: string; value: string; clear: Record<string, string | null> }[] = [];
  if (filters.reference && filters.reference !== latest) chips.push({ key: "reference", label: "Data dos dados", value: formatDate(filters.reference), clear: { [P.reference]: null, foto: null } });
  if (filters.operation) chips.push({ key: "operation", label: "Operação", value: name(options.operations, filters.operation), clear: { [P.operation]: null, [P.city]: null, [P.leader]: null, [P.vehicle]: null, [P.br]: null } });
  if (filters.city) {
    const c = options.cities.find((x) => String(x.id) === filters.city);
    chips.push({ key: "city", label: "Local", value: c ? cityLabel(c) : filters.city, clear: { [P.city]: null, [P.leader]: null, [P.vehicle]: null } });
  }
  if (filters.leader) chips.push({ key: "leader", label: "Liderança", value: name(options.leaders, filters.leader), clear: { [P.leader]: null, [P.vehicle]: null } });
  if (filters.vehicleType) chips.push({ key: "vehicleType", label: "Tipo", value: name(options.vehicleTypes, filters.vehicleType), clear: { [P.vehicleType]: null, [P.vehicle]: null } });
  if (filters.vehicle) chips.push({ key: "vehicle", label: "Frota", value: filters.vehicle.split(",").map((id) => { const v = options.vehicles.find((x) => x.id === id); return v ? [v.fleet, v.plate].filter(Boolean).join(" · ") : id; }).join(", "), clear: { [P.vehicle]: null } });
  if (filters.missing) chips.push({ key: "missing", label: "Sem", value: filters.missing.split(",").map((m) => (m === "operacao" ? "operação" : m === "local" ? "local de operação" : m === "lideranca" ? "liderança" : m)).join(", "), clear: { [P.missing]: null } });
  if (filters.state) chips.push({ key: "state", label: "UF", value: name(options.states, filters.state), clear: { [P.state]: null } });
  if (filters.br) chips.push({ key: "br", label: "BR", value: name(options.brs, filters.br), clear: { [P.br]: null } });
  if (filters.unit) chips.push({ key: "unit", label: "Filial", value: name(options.units, filters.unit), clear: { [P.unit]: null } });
  if (filters.status) chips.push({ key: "status", label: "Situação", value: labelsOf(STATUS_LABEL, filters.status), clear: { [P.status]: null } });
  if (filters.brand) chips.push({ key: "brand", label: "Fabricante", value: filters.brand, clear: { [P.brand]: null, [P.model]: null } });
  if (filters.model) chips.push({ key: "model", label: "Modelo", value: filters.model, clear: { [P.model]: null } });
  if (filters.dimension) chips.push({ key: "dimension", label: "Medida", value: filters.dimension.split(",").map((k) => options.dimensions.find((d) => d.key === k)?.label ?? k).join(", "), clear: { [P.dimension]: null } });
  if (filters.life) chips.push({ key: "life", label: "Vida", value: filters.life, clear: { [P.life]: null } });
  if (filters.position) chips.push({ key: "position", label: "Posição", value: filters.position, clear: { [P.position]: null } });
  if (filters.tread) chips.push({ key: "tread", label: "Sulco", value: labelsOf(TREAD_LABEL, filters.tread), clear: { [P.tread]: null } });
  if (filters.measurement) chips.push({ key: "measurement", label: "Medição", value: labelsOf(DEADLINE_LABEL, filters.measurement), clear: { [P.measurement]: null } });
  if (filters.calibration) chips.push({ key: "calibration", label: "Calibragem", value: labelsOf(DEADLINE_LABEL, filters.calibration), clear: { [P.calibration]: null } });
  if (filters.psi) chips.push({ key: "psi", label: "Pressão", value: labelsOf(PSI_LABEL, filters.psi), clear: { [P.psi]: null } });
  if (filters.severity) chips.push({ key: "severity", label: "Criticidade", value: labelsOf(SEVERITY_LABEL, filters.severity), clear: { [P.severity]: null } });
  if (filters.conformity) chips.push({ key: "conformity", label: "Conformidade geral", value: filters.conformity === "conforme" ? "Conformes" : "Não conformes", clear: { [P.conformity]: null } });
  if (filters.calConformity) chips.push({ key: "calConformity", label: "Conformidade de calibragem", value: filters.calConformity === "conforme" ? "Conformes" : "Não conformes", clear: { [P.calConformity]: null } });
  if (quality) chips.push({ key: "quality", label: "Qualidade", value: "Com inconsistência", clear: { [P.quality]: null } });
  if (retread) chips.push({ key: "retread", label: "Ressolagem", value: "Com alerta", clear: { [P.retread]: null } });
  if (filters.q) chips.push({ key: "q", label: "Busca", value: filters.q, clear: { [P.q]: null } });
  const visibleChips = chips.filter((c) => c.key === "missing" || show(c.key as TiresFilterField));

  const hasMore = moreKeys.some((k) => show(k));
  const select = (
    key: keyof TiresFilters,
    label: string,
    items: { value: string; label: string }[],
    opts: { className?: string; all?: string; testId?: string; extra?: Record<string, string | null>; disabled?: boolean } = {},
  ) => (
    <Field label={label} className={opts.className}>
      <NativeSelect
        fieldSize="sm"
        aria-label={`Filtrar por ${label.toLowerCase()}`}
        value={filters[key] ?? ""}
        disabled={pending || opts.disabled}
        onChange={(e) => set(key, e.target.value || null, opts.extra)}
        className="w-full"
        data-testid={opts.testId ?? `tires-filter-${key}`}
      >
        <option value="">{opts.all ?? "Todos"}</option>
        {items.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </NativeSelect>
    </Field>
  );
  const fromMap = (map: Record<string, string>) => Object.entries(map).map(([value, label]) => ({ value, label }));

  return (
    <>
      <FilterBar className="items-end gap-x-3 gap-y-2.5" label="Filtros da Gestão de Pneus" data-testid="tires-filters">
        <div className="flex min-w-0 flex-1 basis-[36rem] flex-wrap items-end gap-2.5">
          {show("reference") && options.referenceDates.length > 0 ? (
            <Field label="Data dos dados" className="flex-[0_0_9.5rem]">
              <NativeSelect
                fieldSize="sm"
                aria-label="Data de referência dos dados Rodopar"
                value={filters.reference ?? latest ?? ""}
                disabled={pending}
                onChange={(e) => set("reference", e.target.value === latest ? null : e.target.value, { foto: null })}
                className="w-full"
                data-testid="tires-filter-reference"
              >
                {options.referenceDates.map((r, i) => (
                  <option key={r.batchId} value={r.referenceDate}>
                    {formatDate(r.referenceDate)}{i === 0 ? " (atual)" : ""}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
          {show("operation")
            ? select("operation", "Operação", options.operations.map((o) => ({ value: o.id, label: o.name })), {
                className: "flex-[1.2_1_8.5rem]", all: "Todas", extra: { [P.city]: null, [P.leader]: null, [P.vehicle]: null, [P.br]: null },
              })
            : null}
          {show("city")
            ? select("city", "Local de operação", cities.map((c) => ({ value: String(c.id), label: cityLabel(c) })), {
                className: "flex-[1.1_1_8.5rem]", all: "Todos", extra: { [P.leader]: null, [P.vehicle]: null },
              })
            : null}
          {show("leader")
            ? select("leader", "Liderança", leaders.map((l) => ({ value: l.id, label: l.name })), {
                className: "flex-[1.1_1_8.5rem]", all: "Todas", extra: { [P.vehicle]: null },
              })
            : null}
          {show("vehicleType")
            ? select("vehicleType", "Tipo de equipamento", types.map((t) => ({ value: t.id, label: t.name })), {
                className: "flex-[1_1_8rem]", extra: { [P.vehicle]: null },
              })
            : null}
          {show("vehicle")
            ? select("vehicle", "Frota", vehicles.map((v) => ({ value: v.id, label: [v.fleet, v.plate].filter(Boolean).join(" · ") || v.id })), {
                className: "flex-[0.9_1_7.5rem]", all: "Todas",
              })
            : null}
          {show("q") ? (
            <Field label={searchLabel} className="flex-[1.3_1_9rem]">
              <SearchField
                size="sm"
                aria-label={`Buscar por ${searchLabel.toLowerCase()}`}
                defaultValue={filters.q ?? ""}
                placeholder={searchPlaceholder}
                onKeyDown={(e) => {
                  if (e.key === "Enter") set("q", (e.target as HTMLInputElement).value.trim() || null);
                }}
                onClear={() => set("q", null)}
                data-testid="tires-filter-search"
              />
            </Field>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-end gap-2">
          {hasMore ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="secondary" size="sm" leadingIcon={<SlidersHorizontal />} disabled={pending} data-testid="tires-more-filters">
                  Mais filtros
                  {moreCount ? (
                    <Badge variant="accent" size="sm" appearance="solid" className="ml-1">
                      {moreCount}
                    </Badge>
                  ) : null}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="max-h-[min(80vh,40rem)] w-[min(92vw,40rem)] overflow-y-auto">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {show("status") ? select("status", "Situação", fromMap(STATUS_LABEL), { all: "Todas" }) : null}
                  {show("brand") ? select("brand", "Fabricante", options.brands.map((b) => ({ value: b, label: b })), { extra: { [P.model]: null } }) : null}
                  {show("model") ? select("model", "Modelo", models.map((m) => ({ value: m.value, label: m.value }))) : null}
                  {show("dimension") ? select("dimension", "Medida", options.dimensions.map((d) => ({ value: d.key, label: d.label })), { all: "Todas" }) : null}
                  {show("conformity")
                    ? select("conformity", "Conformidade geral", [{ value: "conforme", label: "Conformes" }, { value: "nao_conforme", label: "Não conformes" }])
                    : null}
                  {show("calConformity")
                    ? select("calConformity", "Conformidade de calibragem", [{ value: "conforme", label: "Conformes" }, { value: "nao_conforme", label: "Não conformes" }])
                    : null}
                  {show("tread") ? select("tread", "Sulco", fromMap(TREAD_LABEL)) : null}
                  {show("measurement") ? select("measurement", "Prazo de medição", fromMap(DEADLINE_LABEL)) : null}
                  {show("calibration") ? select("calibration", "Prazo de calibragem", fromMap(DEADLINE_LABEL)) : null}
                  {show("psi") ? select("psi", "Pressão (PSI)", fromMap(PSI_LABEL), { all: "Todas" }) : null}
                  {show("severity") ? select("severity", "Criticidade", fromMap(SEVERITY_LABEL), { all: "Todas" }) : null}
                  {show("life") ? select("life", "Vida", options.lives.map((l) => ({ value: String(l), label: `${l}ª vida` })), { all: "Todas" }) : null}
                  {show("position") ? select("position", "Posição", options.positions.map((p) => ({ value: p.code, label: `${p.code} · ${p.label}` })), { all: "Todas" }) : null}
                  {show("state") ? select("state", "UF", options.states.map((s) => ({ value: String(s.id), label: s.uf })), { all: "Todas" }) : null}
                  {show("br") ? select("br", "BR", brs.map((b) => ({ value: b.id, label: b.code })), { all: "Todas" }) : null}
                  {show("unit") ? select("unit", "Filial", options.units.map((u) => ({ value: u.id, label: u.name })), { all: "Todas" }) : null}
                  {show("quality") || show("retread") ? (
                    <div className="flex flex-col gap-1 sm:col-span-2">
                      <span className="text-caption text-fg-muted">Recortes</span>
                      <div className="flex flex-wrap gap-2">
                        {show("quality") ? (
                          <ToggleChip pressed={quality} onPressedChange={(on) => set("quality", on ? "1" : null)} disabled={pending} data-testid="tires-filter-quality">
                            <TriangleAlert aria-hidden />
                            Com inconsistência de dados
                          </ToggleChip>
                        ) : null}
                        {show("retread") ? (
                          <ToggleChip pressed={retread} onPressedChange={(on) => set("retread", on ? "1" : null)} disabled={pending} data-testid="tires-filter-retread">
                            <Recycle aria-hidden />
                            Alerta de ressolagem
                          </ToggleChip>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              </PopoverContent>
            </Popover>
          ) : null}

          {anyActive ? (
            <Button variant="ghost" size="sm" leadingIcon={<X />} onClick={clearAll} disabled={pending} data-testid="tires-clear-filters">
              Limpar filtros
            </Button>
          ) : null}
        </div>
      </FilterBar>
      {visibleChips.length ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border-subtle pt-2 pb-1.5" aria-label="Filtros aplicados" data-testid="tires-filter-chips">
          {visibleChips.map((c) => (
            <FilterChip
              key={c.key}
              label={c.label}
              value={c.value}
              disabled={pending}
              removeLabel={`Remover filtro ${c.label}`}
              onRemove={() => navigate({ pagina: null, ...c.clear })}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}
