"use client";

import * as React from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FilterBar } from "@/components/ui/filter-bar";
import { DateInput } from "@/components/ui/date-input";
import { SearchField } from "@/components/ui/search-field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NativeSelect } from "@/components/governance/selects";
import type { MaintenanceFilterOptions } from "@/lib/maintenance/queries";
import {
  CRITICALITY_LABEL,
  FILTER_PARAM,
  KM_STATUS_LABEL,
  STATUS_LABEL,
  type MaintenanceCatalog,
  type MaintenanceFilters,
} from "@/lib/maintenance/types";
import type { Navigate } from "./shared";

/**
 * Filtros comuns da Visão geral, Programação e Base geral.
 *
 * Todos por id oficial (operação, UF, cidade, liderança, tipo de
 * equipamento, fornecedor, cluster, serviço) — nunca por texto. Operação →
 * UF → Cidade se encadeiam pela cobertura da operação: escolher a
 * operação limpa o que ficou fora dela. Cada mudança é uma ida ao servidor.
 */

const P = FILTER_PARAM;

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 ${className ?? ""}`}>
      <span className="text-caption text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

export interface MaintenanceFilterBarProps {
  filters: MaintenanceFilters;
  options: MaintenanceFilterOptions;
  catalog: MaintenanceCatalog;
  navigate: Navigate;
  pending: boolean;
  /** A Visão geral usa o período; as outras abas também, mas sem padrão. */
  showPeriod?: boolean;
  /** Programação: a situação vem das filas, não do filtro. */
  showStatus?: boolean;
}

export function MaintenanceFilterBar({
  filters, options, catalog, navigate, pending, showPeriod = true, showStatus = true,
}: MaintenanceFilterBarProps) {
  const set = (key: keyof MaintenanceFilters, value: string | null, extra: Record<string, string | null> = {}) =>
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

  const services = React.useMemo(
    () => catalog.services.filter((s) => !filters.cluster || s.clusterId === filters.cluster),
    [catalog.services, filters.cluster],
  );

  const moreKeys: (keyof MaintenanceFilters)[] = [
    "vehicleType", "leader", "unit", "supplier", "cluster", "service", "origin", "priority", "km", "fleet",
  ];
  const moreCount = moreKeys.filter((k) => Boolean(filters[k])).length;
  const anyActive =
    moreCount > 0 ||
    Boolean(filters.from || filters.to || filters.q || filters.operation || filters.state || filters.city || filters.type || filters.status || filters.queue);

  const clearAll = () => {
    const patch: Record<string, string | null> = { pagina: null };
    for (const key of Object.values(P)) patch[key] = null;
    navigate(patch);
  };

  return (
    <FilterBar className="items-end gap-x-3 gap-y-2.5">
      {showPeriod ? (
        <div className="flex flex-col gap-1">
          <span className="text-caption text-fg-muted">Período (referência)</span>
          <div className="flex items-center gap-1.5">
            <DateInput
              size="sm"
              aria-label="Data inicial"
              value={filters.from ?? ""}
              disabled={pending}
              onChange={(e) => set("from", e.target.value || null)}
              wrapperClassName="w-[9.5rem]"
            />
            <span className="text-caption text-fg-muted">até</span>
            <DateInput
              size="sm"
              aria-label="Data final"
              value={filters.to ?? ""}
              disabled={pending}
              onChange={(e) => set("to", e.target.value || null)}
              wrapperClassName="w-[9.5rem]"
            />
          </div>
        </div>
      ) : null}

      <Field label="Operação" className="flex-[1.2_1_9rem]">
        <NativeSelect
          fieldSize="sm"
          aria-label="Filtrar por operação"
          value={filters.operation ?? ""}
          disabled={pending}
          onChange={(e) => set("operation", e.target.value || null, { [P.state]: null, [P.city]: null })}
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
          onChange={(e) => set("state", e.target.value || null, { [P.city]: null })}
          className="w-full"
        >
          <option value="">Todas</option>
          {states.map((s) => (
            <option key={s.id} value={s.id}>{s.uf}</option>
          ))}
        </NativeSelect>
      </Field>

      <Field label="Cidade" className="flex-[1_1_8rem]">
        <NativeSelect
          fieldSize="sm"
          aria-label="Filtrar por cidade"
          value={filters.city ?? ""}
          disabled={pending || !filters.state}
          onChange={(e) => set("city", e.target.value || null)}
          className="w-full"
        >
          <option value="">{filters.state ? "Todas" : "Escolha a UF"}</option>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </NativeSelect>
      </Field>

      <Field label="Tipo" className="flex-[1_1_8rem]">
        <NativeSelect
          fieldSize="sm"
          aria-label="Filtrar por tipo de manutenção"
          value={filters.type ?? ""}
          disabled={pending}
          onChange={(e) => set("type", e.target.value || null)}
          className="w-full"
        >
          <option value="">Todos</option>
          {catalog.types.map((t) => (
            <option key={t.code} value={t.code}>{t.name}</option>
          ))}
        </NativeSelect>
      </Field>

      {showStatus ? (
        <Field label="Situação" className="flex-[1_1_8rem]">
          <NativeSelect
            fieldSize="sm"
            aria-label="Filtrar por situação"
            value={filters.status ?? ""}
            disabled={pending}
            onChange={(e) => set("status", e.target.value || null)}
            className="w-full"
          >
            <option value="">Todas</option>
            {Object.entries(STATUS_LABEL).map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </NativeSelect>
        </Field>
      ) : null}

      <Field label="Veículo, código ou OS" className="flex-[1.4_1_11rem]">
        <SearchField
          size="sm"
          aria-label="Buscar por placa, frota, código da manutenção ou OS"
          defaultValue={filters.q ?? ""}
          placeholder="SNT8J46, VA170, MAN-2026…"
          onKeyDown={(e) => {
            if (e.key === "Enter") set("q", (e.target as HTMLInputElement).value.trim() || null);
          }}
          onClear={() => set("q", null)}
        />
      </Field>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="secondary" size="sm" leadingIcon={<SlidersHorizontal />} disabled={pending}>
            Mais filtros
            {moreCount ? (
              <Badge variant="accent" size="sm" appearance="solid" className="ml-1">
                {moreCount}
              </Badge>
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(92vw,34rem)]">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Tipo de equipamento">
              <NativeSelect fieldSize="sm" value={filters.vehicleType ?? ""} onChange={(e) => set("vehicleType", e.target.value || null)}>
                <option value="">Todos</option>
                {options.vehicleTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
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
            <Field label="Filial">
              <NativeSelect fieldSize="sm" value={filters.unit ?? ""} onChange={(e) => set("unit", e.target.value || null)}>
                <option value="">Todas</option>
                {options.units.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Fornecedor">
              <NativeSelect fieldSize="sm" value={filters.supplier ?? ""} onChange={(e) => set("supplier", e.target.value || null)}>
                <option value="">Todos</option>
                {catalog.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.tradeName || s.name}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Cluster">
              <NativeSelect
                fieldSize="sm"
                value={filters.cluster ?? ""}
                onChange={(e) => set("cluster", e.target.value || null, { [P.service]: null })}
              >
                <option value="">Todos</option>
                {catalog.clusters.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Serviço">
              <NativeSelect fieldSize="sm" value={filters.service ?? ""} onChange={(e) => set("service", e.target.value || null)}>
                <option value="">Todos</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Origem">
              <NativeSelect fieldSize="sm" value={filters.origin ?? ""} onChange={(e) => set("origin", e.target.value || null)}>
                <option value="">Todas</option>
                {catalog.origins.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Prioridade">
              <NativeSelect fieldSize="sm" value={filters.priority ?? ""} onChange={(e) => set("priority", e.target.value || null)}>
                <option value="">Todas</option>
                {Object.entries(CRITICALITY_LABEL).map(([code, label]) => (
                  <option key={code} value={code}>{label}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="KM de entrada">
              <NativeSelect fieldSize="sm" value={filters.km ?? ""} onChange={(e) => set("km", e.target.value || null)}>
                <option value="">Todos</option>
                {Object.entries(KM_STATUS_LABEL).map(([code, label]) => (
                  <option key={code} value={code}>{label}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Frota">
              <NativeSelect fieldSize="sm" value={filters.fleet ?? "active"} onChange={(e) => set("fleet", e.target.value === "active" ? null : e.target.value)}>
                <option value="active">Veículos ativos</option>
                <option value="inactive">Veículos inativos (histórico)</option>
                <option value="all">Todos</option>
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
    </FilterBar>
  );
}
