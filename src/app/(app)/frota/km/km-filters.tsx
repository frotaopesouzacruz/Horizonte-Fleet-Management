"use client";

import * as React from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FilterBar, FilterChip } from "@/components/ui/filter-bar";
import { DateInput } from "@/components/ui/date-input";
import { SearchField } from "@/components/ui/search-field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NativeSelect } from "@/components/governance/selects";
import type { KmFilterOptions } from "@/lib/km/options";
import { competenceLabel, formatDate, KM_FILTER_PARAM, KM_STATUS, type KmFilters, type KmNavigate } from "@/lib/km/types";

/**
 * Filtros globais do KM — todos por id oficial (operação, UF, cidade, BR,
 * liderança, filial, tipo, subcategoria, modelo, veículo) e a competência.
 * Operação → UF → Cidade → BR se encadeiam pela cobertura da operação; tipo →
 * subcategoria idem. Cada mudança é uma ida ao servidor.
 */
const P = KM_FILTER_PARAM;

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 ${className ?? ""}`}>
      <span className="text-caption text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

/** Últimas 24 competências até a atual (aaaa-mm). */
function competences(today: string): string[] {
  const [y, m] = (today || new Date().toISOString().slice(0, 10)).split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < 24; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export interface KmFilterBarProps {
  filters: KmFilters;
  options: KmFilterOptions;
  navigate: KmNavigate;
  pending: boolean;
  /** Competência efetiva da aba (quando a URL não define, a do último dia com leitura). */
  effectiveCompetence?: string | null;
  showPeriod?: boolean;
  showStatus?: boolean;
  today?: string;
}

export function KmFilterBar({
  filters, options, navigate, pending, effectiveCompetence, showPeriod = true, showStatus = true, today = "",
}: KmFilterBarProps) {
  const set = (key: keyof KmFilters, value: string | null, extra: Record<string, string | null> = {}) =>
    navigate({ [P[key]]: value || null, ...extra });

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
        (b) =>
          (!filters.operation || b.operationId === filters.operation) &&
          (!filters.city || String(b.cityId) === filters.city),
      ),
    [options.brs, filters.operation, filters.city],
  );

  const subcategories = React.useMemo(
    () => options.subcategories.filter((s) => !filters.vehicleType || s.vehicleTypeId === filters.vehicleType),
    [options.subcategories, filters.vehicleType],
  );

  const months = React.useMemo(() => competences(today), [today]);
  const competence = filters.competence ?? effectiveCompetence ?? "";
  const customPeriod = Boolean(filters.from && filters.to);

  const moreKeys: (keyof KmFilters)[] = ["subcategory", "model", "leader", "unit", "br", "fleet", "status"];
  const moreCount = moreKeys.filter((k) => Boolean(filters[k])).length;
  const anyActive =
    moreCount > 0 ||
    Boolean(filters.q || filters.operation || filters.state || filters.city || filters.vehicleType || filters.vehicle || customPeriod);

  const clearAll = () => {
    const patch: Record<string, string | null> = {};
    for (const [key, param] of Object.entries(P)) if (key !== "competence") patch[param] = null;
    navigate(patch);
  };

  // Chips dos filtros aplicados (UI 2.0): o que está valendo, à vista, com
  // remoção individual. Os nomes vêm das opções oficiais; o filtro é o id.
  const name = (list: { id: string | number; name?: string; uf?: string; code?: string }[], id?: string) =>
    id ? (list.find((o) => String(o.id) === id)?.name ?? list.find((o) => String(o.id) === id)?.code ?? id) : "";
  const chips: { key: keyof KmFilters | "period"; label: string; value: string; clear: Record<string, string | null> }[] = [];
  if (customPeriod)
    chips.push({ key: "period", label: "Período", value: `${formatDate(filters.from)} a ${formatDate(filters.to)}`, clear: { [P.from]: null, [P.to]: null } });
  if (filters.operation) chips.push({ key: "operation", label: "Operação", value: name(options.operations, filters.operation), clear: { [P.operation]: null, [P.state]: null, [P.city]: null, [P.br]: null } });
  if (filters.state) chips.push({ key: "state", label: "UF", value: states.find((x) => String(x.id) === filters.state)?.uf ?? filters.state, clear: { [P.state]: null, [P.city]: null, [P.br]: null } });
  if (filters.city) chips.push({ key: "city", label: "Cidade", value: cities.find((x) => String(x.id) === filters.city)?.name ?? filters.city, clear: { [P.city]: null, [P.br]: null } });
  if (filters.br) chips.push({ key: "br", label: "BR", value: options.brs.find((b) => b.id === filters.br)?.code ?? filters.br, clear: { [P.br]: null } });
  if (filters.leader) chips.push({ key: "leader", label: "Liderança", value: name(options.leaders, filters.leader), clear: { [P.leader]: null } });
  if (filters.unit) chips.push({ key: "unit", label: "Filial", value: name(options.units, filters.unit), clear: { [P.unit]: null } });
  if (filters.vehicleType) chips.push({ key: "vehicleType", label: "Tipo", value: name(options.vehicleTypes, filters.vehicleType), clear: { [P.vehicleType]: null, [P.subcategory]: null } });
  if (filters.subcategory) chips.push({ key: "subcategory", label: "Subcategoria", value: name(options.subcategories, filters.subcategory), clear: { [P.subcategory]: null } });
  if (filters.model) chips.push({ key: "model", label: "Modelo", value: name(options.models, filters.model), clear: { [P.model]: null } });
  if (filters.status) chips.push({ key: "status", label: "Situação", value: KM_STATUS[filters.status as keyof typeof KM_STATUS]?.label ?? filters.status, clear: { [P.status]: null } });
  if (filters.fleet) chips.push({ key: "fleet", label: "Frota", value: { active: "Somente ativas", inactive: "Inativas", all: "Todas" }[filters.fleet], clear: { [P.fleet]: null } });
  if (filters.vehicle) chips.push({ key: "vehicle", label: "Veículo", value: filters.vehicle.split(",").map((id) => options.vehicles.find((v) => v.id === id)?.plate ?? id).join(", "), clear: { [P.vehicle]: null } });
  if (filters.q) chips.push({ key: "q", label: "Busca", value: filters.q, clear: { [P.q]: null } });

  return (
    <>
    <FilterBar className="items-end gap-x-3 gap-y-2.5" label="Filtros da Gestão de KM">
      {/* Os campos crescem juntos e só quebram linha quando não cabem; as ações
          ficam à direita da primeira linha (sem botão órfão numa linha própria). */}
      <div className="flex min-w-0 flex-1 basis-[36rem] flex-wrap items-end gap-2.5">
        {showPeriod ? (
          <Field label="Competência" className="flex-[0_0_10.5rem]">
            <NativeSelect
              fieldSize="sm"
              aria-label="Competência"
              value={customPeriod ? "" : competence}
              disabled={pending}
              onChange={(e) => set("competence", e.target.value || null, { [P.from]: null, [P.to]: null })}
              className="w-full"
              data-testid="km-filter-competence"
            >
              {customPeriod ? <option value="">Período personalizado</option> : null}
              {!months.includes(competence) && competence ? <option value={competence}>{competenceLabel(competence)}</option> : null}
              {months.map((m) => (
                <option key={m} value={m}>{competenceLabel(m)}</option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}

        <Field label="Operação" className="flex-[1.2_1_8.5rem]">
          <NativeSelect
            fieldSize="sm"
            aria-label="Filtrar por operação"
            value={filters.operation ?? ""}
            disabled={pending}
            onChange={(e) => set("operation", e.target.value || null, { [P.state]: null, [P.city]: null, [P.br]: null })}
            className="w-full"
          >
            <option value="">Todas</option>
            {options.operations.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </NativeSelect>
        </Field>

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

        <Field label="Tipo de equipamento" className="flex-[1_1_8rem]">
          <NativeSelect
            fieldSize="sm"
            aria-label="Filtrar por tipo de equipamento"
            value={filters.vehicleType ?? ""}
            disabled={pending}
            onChange={(e) => set("vehicleType", e.target.value || null, { [P.subcategory]: null })}
            className="w-full"
          >
            <option value="">Todos</option>
            {options.vehicleTypes.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="Placa ou frota" className="flex-[1.3_1_9rem]">
          <SearchField
            size="sm"
            aria-label="Buscar por placa ou código da frota"
            defaultValue={filters.q ?? ""}
            placeholder="Ex.: SNT8I36"
            onKeyDown={(e) => {
              if (e.key === "Enter") set("q", (e.target as HTMLInputElement).value.trim() || null);
            }}
            onClear={() => set("q", null)}
          />
        </Field>
      </div>

      <div className="flex shrink-0 flex-wrap items-end gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary" size="sm" leadingIcon={<SlidersHorizontal />} disabled={pending} data-testid="km-more-filters">
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
              {showPeriod ? (
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <span className="text-caption text-fg-muted">Período personalizado (substitui a competência; até 400 dias)</span>
                  <div className="flex items-center gap-1.5">
                    <DateInput
                      size="sm"
                      aria-label="Data inicial"
                      value={filters.from ?? ""}
                      onChange={(e) => set("from", e.target.value || null)}
                      wrapperClassName="w-[9.5rem]"
                    />
                    <span className="text-caption text-fg-muted">até</span>
                    <DateInput
                      size="sm"
                      aria-label="Data final"
                      value={filters.to ?? ""}
                      onChange={(e) => set("to", e.target.value || null)}
                      wrapperClassName="w-[9.5rem]"
                    />
                  </div>
                </div>
              ) : null}
              <Field label="BR">
                <NativeSelect fieldSize="sm" value={filters.br ?? ""} onChange={(e) => set("br", e.target.value || null)}>
                  <option value="">Todas</option>
                  {brs.map((b) => (
                    <option key={b.id} value={b.id}>{b.code}</option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Liderança">
                <NativeSelect fieldSize="sm" value={filters.leader ?? ""} onChange={(e) => set("leader", e.target.value || null)}>
                  <option value="">Todas</option>
                  {options.leaders.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Subcategoria">
                <NativeSelect fieldSize="sm" value={filters.subcategory ?? ""} onChange={(e) => set("subcategory", e.target.value || null)}>
                  <option value="">Todas</option>
                  {subcategories.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Modelo">
                <NativeSelect fieldSize="sm" value={filters.model ?? ""} onChange={(e) => set("model", e.target.value || null)}>
                  <option value="">Todos</option>
                  {options.models.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Filial">
                <NativeSelect fieldSize="sm" value={filters.unit ?? ""} onChange={(e) => set("unit", e.target.value || null)}>
                  <option value="">Todas</option>
                  {options.units.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </NativeSelect>
              </Field>
              {showStatus ? (
                <Field label="Situação da leitura">
                  <NativeSelect fieldSize="sm" value={filters.status ?? ""} onChange={(e) => set("status", e.target.value || null)}>
                    <option value="">Todas</option>
                    {Object.entries(KM_STATUS).map(([code, meta]) => (
                      <option key={code} value={code}>{meta.label}</option>
                    ))}
                  </NativeSelect>
                </Field>
              ) : null}
              <Field label="Frota">
                <NativeSelect fieldSize="sm" value={filters.fleet ?? ""} onChange={(e) => set("fleet", e.target.value || null)}>
                  <option value="">Ativas e com leitura no período</option>
                  <option value="active">Somente ativas</option>
                  <option value="inactive">Inativas (histórico)</option>
                  <option value="all">Todas</option>
                </NativeSelect>
              </Field>
            </div>
          </PopoverContent>
        </Popover>

        {anyActive ? (
          <Button variant="ghost" size="sm" leadingIcon={<X />} onClick={clearAll} disabled={pending}>
            Limpar filtros
          </Button>
        ) : null}
      </div>
    </FilterBar>
    {chips.length ? (
      <div className="flex flex-wrap items-center gap-1.5 border-t border-border-subtle pt-2 pb-1.5" aria-label="Filtros aplicados" data-testid="km-filter-chips">
        {chips.map((c) => (
          <FilterChip
            key={c.key}
            label={c.label}
            value={c.value}
            disabled={pending}
            removeLabel={`Remover filtro ${c.label}`}
            onRemove={() => navigate(c.clear)}
          />
        ))}
      </div>
    ) : null}
    </>
  );
}
