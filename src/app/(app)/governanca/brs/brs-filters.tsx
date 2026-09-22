"use client";

import * as React from "react";
import { FilterBar } from "@/components/ui/filter-bar";
import { SearchField } from "@/components/ui/search-field";
import { CompetencePicker } from "@/components/governance/competence-picker";
import { NativeSelect } from "@/components/governance/selects";
import type { CoverageEntry } from "@/components/governance/scope-picker";
import type { BrPlannerFilters } from "@/lib/governance/br-planner";
import type { Competence } from "@/lib/governance/competence";

export interface BrsFiltersProps {
  competence: Competence;
  filters: BrPlannerFilters;
  operations: { id: string; name: string; status: string }[];
  coverage: CoverageEntry[];
  leaders: { id: string; name: string }[];
  pending: boolean;
  /** Escreve o par na URL; `null` apaga a chave. Toda mudança volta à primeira página. */
  onNavigate: (patch: Record<string, string | null>) => void;
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption text-fg-muted">{label}</span>
      {children}
    </div>
  );
}

/**
 * Os filtros do módulo (§25): competência, busca, o recorte operação → estado
 * → cidade encadeado pela cobertura, e os filtros de ocupação. Todos vivem na
 * URL — o componente só traduz o controle para o par que a página entende.
 */
export function BrsFilters({
  competence, filters, operations, coverage, leaders, pending, onNavigate,
}: BrsFiltersProps) {
  const statesOfOperation = React.useMemo(() => {
    const scoped = filters.operationId
      ? coverage.filter((c) => c.operationId === filters.operationId)
      : coverage;
    const seen = new Map<number, string>();
    for (const c of scoped) seen.set(c.stateId, c.uf);
    return [...seen.entries()].map(([id, uf]) => ({ id, uf })).sort((a, b) => a.uf.localeCompare(b.uf));
  }, [coverage, filters.operationId]);

  // Sem operação escolhida a mesma cidade pode vir de duas coberturas; o mapa
  // por `cityId` deixa uma opção só, que é o que o filtro do servidor entende.
  const citiesOfState = React.useMemo(() => {
    if (!filters.stateId) return [];
    const seen = new Map<number, string>();
    for (const c of coverage) {
      if (c.stateId !== Number(filters.stateId)) continue;
      if (filters.operationId && c.operationId !== filters.operationId) continue;
      seen.set(c.cityId, c.cityName);
    }
    return [...seen.entries()]
      .map(([cityId, cityName]) => ({ cityId, cityName }))
      .sort((a, b) => a.cityName.localeCompare(b.cityName));
  }, [coverage, filters.stateId, filters.operationId]);

  return (
    <FilterBar label="Filtros das posições operacionais" className="flex-wrap items-end gap-3">
      <Labeled label="Competência">
        <CompetencePicker
          value={competence}
          onChange={(v) => onNavigate({ ano: String(v.year), mes: String(v.month) })}
          disabled={pending}
        />
      </Labeled>

      <Labeled label="Busca">
        {/* Busca no Enter, não a cada tecla: cada navegação é uma consulta ao
            servidor, e "BR0024901" viraria nove consultas descartadas. */}
        <SearchField
          key={filters.q ?? ""}
          placeholder="Código ou descrição…"
          defaultValue={filters.q ?? ""}
          aria-label="Buscar BR por código ou descrição"
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            onNavigate({ q: (event.target as HTMLInputElement).value || null });
          }}
          onClear={() => onNavigate({ q: null })}
          className="w-full sm:w-56"
        />
      </Labeled>

      <Labeled label="Operação">
        <NativeSelect
          fieldSize="sm"
          aria-label="Filtrar por operação"
          value={filters.operationId ?? ""}
          onChange={(e) => onNavigate({ operacao: e.target.value || null, uf: null, cidade: null })}
          className="min-w-[12rem]"
        >
          <option value="">Todas as operações</option>
          {operations.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </NativeSelect>
      </Labeled>

      <Labeled label="Estado">
        <NativeSelect
          fieldSize="sm"
          aria-label="Filtrar por estado"
          value={filters.stateId ?? ""}
          onChange={(e) => onNavigate({ uf: e.target.value || null, cidade: null })}
          className="min-w-[7rem]"
        >
          <option value="">Todos</option>
          {statesOfOperation.map((s) => (
            <option key={s.id} value={s.id}>{s.uf}</option>
          ))}
        </NativeSelect>
      </Labeled>

      <Labeled label="Cidade">
        <NativeSelect
          fieldSize="sm"
          aria-label="Filtrar por cidade"
          value={filters.cityId ?? ""}
          disabled={!filters.stateId}
          onChange={(e) => onNavigate({ cidade: e.target.value || null })}
          className="min-w-[11rem]"
        >
          <option value="">{filters.stateId ? "Todas" : "Escolha o estado"}</option>
          {citiesOfState.map((c) => (
            <option key={c.cityId} value={c.cityId}>{c.cityName}</option>
          ))}
        </NativeSelect>
      </Labeled>

      <Labeled label="Liderança">
        <NativeSelect
          fieldSize="sm"
          aria-label="Filtrar por liderança"
          value={filters.leaderEmployeeId ?? ""}
          onChange={(e) => onNavigate({ lideranca: e.target.value || null })}
          className="min-w-[12rem]"
        >
          <option value="">Todas</option>
          {leaders.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </NativeSelect>
      </Labeled>

      <Labeled label="Situação">
        <NativeSelect
          fieldSize="sm"
          aria-label="Filtrar por situação da BR"
          value={filters.status ?? ""}
          onChange={(e) => onNavigate({ situacao: e.target.value || null })}
        >
          <option value="">Todas</option>
          <option value="active">Ativas</option>
          <option value="inactive">Inativas</option>
        </NativeSelect>
      </Labeled>

      <Labeled label="Veículo">
        <NativeSelect
          fieldSize="sm"
          aria-label="Filtrar por ocupação de veículo"
          value={filters.vehicle ?? ""}
          onChange={(e) => onNavigate({ veiculo: e.target.value || null })}
        >
          <option value="">Com e sem</option>
          <option value="with">Com veículo</option>
          <option value="without">Sem veículo</option>
        </NativeSelect>
      </Labeled>

      <Labeled label="Motorista">
        <NativeSelect
          fieldSize="sm"
          aria-label="Filtrar por motorista vinculado"
          value={filters.driver ?? ""}
          onChange={(e) => onNavigate({ motorista: e.target.value || null })}
        >
          <option value="">Com e sem</option>
          <option value="with">Com motorista</option>
          <option value="without">Sem motorista</option>
        </NativeSelect>
      </Labeled>

      <Labeled label="Substituição no período">
        <NativeSelect
          fieldSize="sm"
          aria-label="Filtrar por substituição de veículo no período"
          value={filters.swapped ?? ""}
          onChange={(e) => onNavigate({ substituicao: e.target.value || null })}
        >
          <option value="">Com e sem</option>
          <option value="with">Com substituição</option>
          <option value="without">Sem substituição</option>
        </NativeSelect>
      </Labeled>
    </FilterBar>
  );
}
