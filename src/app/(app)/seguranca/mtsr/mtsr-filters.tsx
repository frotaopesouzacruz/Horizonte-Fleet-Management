"use client";

import * as React from "react";
import { RefreshCw, SlidersHorizontal, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FilterBar, FilterChip } from "@/components/ui/filter-bar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchField } from "@/components/ui/search-field";
import { ToggleChip } from "@/components/ui/segmented-control";
import { NativeSelect } from "@/components/governance/selects";
import type { MtsrFilterOptions } from "@/lib/mtsr/queries";
import {
  COMPONENT_STATUS_LABEL,
  CONFORMITY_LABEL,
  CRITICALITY_LABEL,
  DEADLINE_LABEL,
  MTSR_FILTER_PARAM,
  type MtsrFilters,
  type MtsrNavigate,
} from "@/lib/mtsr/types";

/**
 * Filtros globais do MTSR — todos por id oficial (operação, UF, cidade, BR,
 * liderança, filial, tipo) mais os recortes do próprio módulo (prazo,
 * conformidade, criticidade, componente e seu status, aguardando revalidação,
 * frota) e a busca por placa/frota. Operação → UF → Cidade → BR se encadeiam
 * pela cobertura da operação. Cada mudança é uma ida ao servidor e zera a
 * página.
 */
const P = MTSR_FILTER_PARAM;

export type MtsrFilterField = keyof MtsrFilters;

const ALL_FIELDS: MtsrFilterField[] = [
  "operation", "state", "city", "br", "leader", "unit", "vehicleType", "deadline", "conformity", "criticality",
  "component", "componentStatus", "awaiting", "fleet", "q",
];

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 ${className ?? ""}`}>
      <span className="text-caption text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

const FLEET_LABEL: Record<string, string> = { default: "Ativas", all: "Todas", inactive: "Inativas" };

export interface MtsrFilterBarProps {
  filters: MtsrFilters;
  options: MtsrFilterOptions;
  navigate: MtsrNavigate;
  pending: boolean;
  /** Componentes do catálogo (quando o painel os tem); sem eles o filtro de componente não aparece. */
  components?: { id: string; name: string }[];
  /** Campos exibidos (padrão: todos). Abas que não filtram por frota mostram só o que usam. */
  fields?: MtsrFilterField[];
  searchPlaceholder?: string;
}

export function MtsrFilterBar({
  filters, options, navigate, pending, components, fields = ALL_FIELDS, searchPlaceholder = "Ex.: SNT8I36 ou VA174",
}: MtsrFilterBarProps) {
  const show = (f: MtsrFilterField) => fields.includes(f);
  const set = (key: keyof MtsrFilters, value: string | null, extra: Record<string, string | null> = {}) =>
    navigate({ [P[key]]: value || null, pagina: null, ...extra });

  const states = React.useMemo(() => {
    const scoped = filters.operation ? options.coverage.filter((c) => c.operationId === filters.operation) : options.coverage;
    const seen = new Map<number, string>();
    for (const c of scoped) seen.set(c.stateId, c.uf);
    return [...seen.entries()].map(([id, uf]) => ({ id, uf })).sort((a, b) => a.uf.localeCompare(b.uf));
  }, [options.coverage, filters.operation]);

  const cities = React.useMemo(() => {
    if (!filters.state) return [];
    const seen = new Map<number, string>();
    for (const c of options.coverage) {
      if (String(c.stateId) === filters.state && (!filters.operation || c.operationId === filters.operation)) {
        seen.set(c.cityId, c.cityName);
      }
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [options.coverage, filters.state, filters.operation]);

  const brs = React.useMemo(
    () =>
      options.brs.filter(
        (b) => (!filters.operation || b.operationId === filters.operation) && (!filters.city || String(b.cityId) === filters.city),
      ),
    [options.brs, filters.operation, filters.city],
  );

  const componentList = components ?? [];
  const awaiting = filters.awaiting === "1" || filters.awaiting === "true";

  const moreKeys: (keyof MtsrFilters)[] = ["br", "leader", "unit", "componentStatus", "awaiting", "fleet"];
  const moreCount = moreKeys.filter((k) => show(k) && Boolean(filters[k])).length;
  const anyActive = ALL_FIELDS.some((k) => Boolean(filters[k])) || Boolean(filters.vehicle);

  const clearAll = () => {
    const patch: Record<string, string | null> = { pagina: null };
    for (const param of Object.values(P)) patch[param] = null;
    navigate(patch);
  };

  // Chips dos filtros aplicados: o que está valendo, à vista, com remoção
  // individual. Os nomes vêm das opções oficiais; o filtro é o id.
  const name = (list: { id: string | number; name?: string; code?: string }[], id?: string) =>
    id ? (list.find((o) => String(o.id) === id)?.name ?? list.find((o) => String(o.id) === id)?.code ?? id) : "";
  const labelsOf = (map: Record<string, string>, raw: string) =>
    raw.split(",").map((v) => map[v] ?? v).join(", ");
  const chips: { key: string; label: string; value: string; clear: Record<string, string | null> }[] = [];
  if (filters.operation) chips.push({ key: "operation", label: "Operação", value: name(options.operations, filters.operation), clear: { [P.operation]: null, [P.state]: null, [P.city]: null, [P.br]: null } });
  if (filters.state) chips.push({ key: "state", label: "UF", value: states.find((x) => String(x.id) === filters.state)?.uf ?? filters.state, clear: { [P.state]: null, [P.city]: null, [P.br]: null } });
  if (filters.city) chips.push({ key: "city", label: "Cidade", value: cities.find((x) => String(x.id) === filters.city)?.name ?? filters.city, clear: { [P.city]: null, [P.br]: null } });
  if (filters.br) chips.push({ key: "br", label: "BR", value: options.brs.find((b) => b.id === filters.br)?.code ?? filters.br, clear: { [P.br]: null } });
  if (filters.leader) chips.push({ key: "leader", label: "Liderança", value: name(options.leaders, filters.leader), clear: { [P.leader]: null } });
  if (filters.unit) chips.push({ key: "unit", label: "Filial", value: name(options.units, filters.unit), clear: { [P.unit]: null } });
  if (filters.vehicleType) chips.push({ key: "vehicleType", label: "Tipo", value: name(options.vehicleTypes, filters.vehicleType), clear: { [P.vehicleType]: null } });
  if (filters.deadline) chips.push({ key: "deadline", label: "Prazo", value: labelsOf(DEADLINE_LABEL, filters.deadline), clear: { [P.deadline]: null } });
  if (filters.conformity) chips.push({ key: "conformity", label: "Conformidade", value: labelsOf(CONFORMITY_LABEL, filters.conformity), clear: { [P.conformity]: null } });
  if (filters.criticality) chips.push({ key: "criticality", label: "Criticidade", value: labelsOf(CRITICALITY_LABEL, filters.criticality), clear: { [P.criticality]: null } });
  if (filters.component) chips.push({ key: "component", label: "Componente", value: name(componentList, filters.component), clear: { [P.component]: null, [P.componentStatus]: null } });
  if (filters.component && filters.componentStatus) chips.push({ key: "componentStatus", label: "Status do componente", value: labelsOf(COMPONENT_STATUS_LABEL, filters.componentStatus), clear: { [P.componentStatus]: null } });
  if (awaiting) chips.push({ key: "awaiting", label: "Revalidação", value: "Aguardando", clear: { [P.awaiting]: null } });
  if (filters.fleet && filters.fleet !== "default") chips.push({ key: "fleet", label: "Frota", value: FLEET_LABEL[filters.fleet] ?? filters.fleet, clear: { [P.fleet]: null } });
  if (filters.vehicle) chips.push({ key: "vehicle", label: "Veículo", value: filters.vehicle.split(",").map((id) => options.vehicles.find((v) => v.id === id)?.plate ?? id).join(", "), clear: { [P.vehicle]: null } });
  if (filters.q) chips.push({ key: "q", label: "Busca", value: filters.q, clear: { [P.q]: null } });

  const hasMore = moreKeys.some((k) => show(k));

  return (
    <>
      <FilterBar className="items-end gap-x-3 gap-y-2.5" label="Filtros da Gestão de MTSR" data-testid="mtsr-filters">
        <div className="flex min-w-0 flex-1 basis-[36rem] flex-wrap items-end gap-2.5">
          {show("operation") ? (
            <Field label="Operação" className="flex-[1.2_1_8.5rem]">
              <NativeSelect
                fieldSize="sm"
                aria-label="Filtrar por operação"
                value={filters.operation ?? ""}
                disabled={pending}
                onChange={(e) => set("operation", e.target.value || null, { [P.state]: null, [P.city]: null, [P.br]: null })}
                className="w-full"
                data-testid="mtsr-filter-operation"
              >
                <option value="">Todas</option>
                {options.operations.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}

          {show("state") ? (
            <Field label="UF" className="flex-[0_0_5.75rem]">
              <NativeSelect
                fieldSize="sm"
                aria-label="Filtrar por estado"
                value={filters.state ?? ""}
                disabled={pending}
                onChange={(e) => set("state", e.target.value || null, { [P.city]: null, [P.br]: null })}
                className="w-full"
              >
                <option value="">Todas</option>
                {states.map((s) => (
                  <option key={s.id} value={s.id}>{s.uf}</option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}

          {show("city") ? (
            <Field label="Cidade" className="flex-[1_1_7.5rem]">
              <NativeSelect
                fieldSize="sm"
                aria-label="Filtrar por cidade"
                value={filters.city ?? ""}
                disabled={pending || !filters.state}
                onChange={(e) => set("city", e.target.value || null, { [P.br]: null })}
                className="w-full"
              >
                <option value="">{filters.state ? "Todas" : "Escolha a UF"}</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}

          {show("vehicleType") ? (
            <Field label="Tipo de equipamento" className="flex-[1_1_8rem]">
              <NativeSelect
                fieldSize="sm"
                aria-label="Filtrar por tipo de equipamento"
                value={filters.vehicleType ?? ""}
                disabled={pending}
                onChange={(e) => set("vehicleType", e.target.value || null)}
                className="w-full"
              >
                <option value="">Todos</option>
                {options.vehicleTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}

          {show("deadline") ? (
            <Field label="Prazo" className="flex-[0_0_7rem]">
              <NativeSelect
                fieldSize="sm"
                aria-label="Filtrar por prazo"
                value={filters.deadline ?? ""}
                disabled={pending}
                onChange={(e) => set("deadline", e.target.value || null)}
                className="w-full"
                data-testid="mtsr-filter-deadline"
              >
                <option value="">Todos</option>
                {Object.entries(DEADLINE_LABEL).map(([code, label]) => (
                  <option key={code} value={code}>{label}</option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}

          {show("conformity") ? (
            <Field label="Conformidade" className="flex-[0_0_8rem]">
              <NativeSelect
                fieldSize="sm"
                aria-label="Filtrar por conformidade"
                value={filters.conformity ?? ""}
                disabled={pending}
                onChange={(e) => set("conformity", e.target.value || null)}
                className="w-full"
                data-testid="mtsr-filter-conformity"
              >
                <option value="">Todas</option>
                {Object.entries(CONFORMITY_LABEL).map(([code, label]) => (
                  <option key={code} value={code}>{label}</option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}

          {show("criticality") ? (
            <Field label="Criticidade" className="flex-[0_0_7.5rem]">
              <NativeSelect
                fieldSize="sm"
                aria-label="Filtrar por criticidade"
                value={filters.criticality ?? ""}
                disabled={pending}
                onChange={(e) => set("criticality", e.target.value || null)}
                className="w-full"
                data-testid="mtsr-filter-criticality"
              >
                <option value="">Todas</option>
                {Object.entries(CRITICALITY_LABEL).map(([code, label]) => (
                  <option key={code} value={code}>{label}</option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}

          {show("component") && componentList.length > 0 ? (
            <Field label="Componente" className="flex-[1_1_8rem]">
              <NativeSelect
                fieldSize="sm"
                aria-label="Filtrar por componente"
                value={filters.component ?? ""}
                disabled={pending}
                onChange={(e) => set("component", e.target.value || null, { [P.componentStatus]: null })}
                className="w-full"
                data-testid="mtsr-filter-component"
              >
                <option value="">Todos</option>
                {componentList.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}

          {show("q") ? (
            <Field label="Placa ou frota" className="flex-[1.3_1_9rem]">
              <SearchField
                size="sm"
                aria-label="Buscar por placa ou código da frota"
                defaultValue={filters.q ?? ""}
                placeholder={searchPlaceholder}
                onKeyDown={(e) => {
                  if (e.key === "Enter") set("q", (e.target as HTMLInputElement).value.trim() || null);
                }}
                onClear={() => set("q", null)}
                data-testid="mtsr-filter-search"
              />
            </Field>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-end gap-2">
          {hasMore ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="secondary" size="sm" leadingIcon={<SlidersHorizontal />} disabled={pending} data-testid="mtsr-more-filters">
                  Mais filtros
                  {moreCount ? (
                    <Badge variant="accent" size="sm" appearance="solid" className="ml-1">
                      {moreCount}
                    </Badge>
                  ) : null}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[min(92vw,36rem)]">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {show("br") ? (
                    <Field label="BR">
                      <NativeSelect fieldSize="sm" value={filters.br ?? ""} onChange={(e) => set("br", e.target.value || null)}>
                        <option value="">Todas</option>
                        {brs.map((b) => (
                          <option key={b.id} value={b.id}>{b.code}</option>
                        ))}
                      </NativeSelect>
                    </Field>
                  ) : null}
                  {show("leader") ? (
                    <Field label="Liderança">
                      <NativeSelect fieldSize="sm" value={filters.leader ?? ""} onChange={(e) => set("leader", e.target.value || null)}>
                        <option value="">Todas</option>
                        {options.leaders.map((l) => (
                          <option key={l.id} value={l.id}>{l.name}</option>
                        ))}
                      </NativeSelect>
                    </Field>
                  ) : null}
                  {show("unit") ? (
                    <Field label="Filial">
                      <NativeSelect fieldSize="sm" value={filters.unit ?? ""} onChange={(e) => set("unit", e.target.value || null)}>
                        <option value="">Todas</option>
                        {options.units.map((u) => (
                          <option key={u.id} value={u.id}>{u.name}</option>
                        ))}
                      </NativeSelect>
                    </Field>
                  ) : null}
                  {show("componentStatus") && componentList.length > 0 ? (
                    <Field label="Status do componente">
                      <NativeSelect
                        fieldSize="sm"
                        value={filters.componentStatus ?? ""}
                        disabled={!filters.component}
                        onChange={(e) => set("componentStatus", e.target.value || null)}
                        data-testid="mtsr-filter-component-status"
                      >
                        <option value="">{filters.component ? "Todos" : "Escolha um componente"}</option>
                        {Object.entries(COMPONENT_STATUS_LABEL).map(([code, label]) => (
                          <option key={code} value={code}>{label}</option>
                        ))}
                      </NativeSelect>
                    </Field>
                  ) : null}
                  {show("fleet") ? (
                    <Field label="Frota">
                      <NativeSelect fieldSize="sm" value={filters.fleet ?? ""} onChange={(e) => set("fleet", e.target.value || null)}>
                        <option value="">Ativas</option>
                        <option value="all">Todas</option>
                        <option value="inactive">Inativas (histórico)</option>
                      </NativeSelect>
                    </Field>
                  ) : null}
                  {show("awaiting") ? (
                    <div className="flex flex-col gap-1">
                      <span className="text-caption text-fg-muted">Revalidação</span>
                      <ToggleChip
                        pressed={awaiting}
                        onPressedChange={(on) => set("awaiting", on ? "1" : null)}
                        disabled={pending}
                        data-testid="mtsr-filter-awaiting"
                      >
                        <RefreshCw aria-hidden />
                        Aguardando revalidação
                      </ToggleChip>
                    </div>
                  ) : null}
                </div>
              </PopoverContent>
            </Popover>
          ) : null}

          {anyActive ? (
            <Button variant="ghost" size="sm" leadingIcon={<X />} onClick={clearAll} disabled={pending} data-testid="mtsr-clear-filters">
              Limpar filtros
            </Button>
          ) : null}
        </div>
      </FilterBar>
      {chips.length ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border-subtle pt-2 pb-1.5" aria-label="Filtros aplicados" data-testid="mtsr-filter-chips">
          {chips.map((c) => (
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
