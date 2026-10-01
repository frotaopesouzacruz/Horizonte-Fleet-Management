"use client";

import * as React from "react";
import { ChevronDown, History, Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SearchField } from "@/components/ui/search-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { NativeSelect } from "@/components/governance/selects";
import { cn } from "@/lib/cn";
import type { Competence } from "@/lib/governance/competence";
import {
  formatDateBr,
  type FidelizationHistoryEvolution,
  type FidelizationHistoryRow,
  type FidelizationHistoryRows,
} from "@/lib/governance/fidelization-competence";

const number = new Intl.NumberFormat("pt-BR");
/** O filtro "sem BR" — a BR nula é um valor de verdade, não um código. */
const NO_BR = "__sem_br__";

export interface HistoryConsolidatedProps {
  competence: Competence;
  /** `null` quando a leitura falhou. */
  rows: FidelizationHistoryRows | null;
  evolution: FidelizationHistoryEvolution | null;
  /** Clicar num mês da evolução abre aquela competência. */
  onSelectMonth?: (competence: Competence) => void;
}

interface CityGroup {
  key: string;
  label: string;
  rows: FidelizationHistoryRow[];
}
interface BrGroup {
  key: string;
  code: string | null;
  cities: CityGroup[];
  plates: number;
}
interface OperationGroup {
  key: string;
  name: string;
  /** 2025: Operação → BR → Local/Cidade → Placas. */
  brs: BrGroup[];
  /** 2024: Operação → Cidade → Placas. */
  cities: CityGroup[];
  plates: number;
}

const distinctPlates = (rows: FidelizationHistoryRow[]) => new Set(rows.map((r) => r.vehicleId)).size;

/**
 * Histórico consolidado (2024/2025) — SOMENTE CONSULTA.
 *
 * O que cada placa ocupou em cada mês, como veio da planilha histórica. Nunca
 * é recalculado e nunca é usado para recriar vínculos atuais ou futuros: a
 * replicação mensal lê só os vínculos operacionais (2026 em diante).
 *
 * 2024 não tem BR: Operação → Cidade → Placas, e a coluna BR diz "—".
 * 2025 tem BR: Operação → BR → Local/Cidade → Placas, com filtro por BR.
 * O agrupamento segue o dado (há BR no mês?), não o ano escrito na tela.
 */
export function HistoryConsolidated({ competence, rows, evolution, onSelectMonth }: HistoryConsolidatedProps) {
  const [operationId, setOperationId] = React.useState("");
  const [cityId, setCityId] = React.useState("");
  const [brCode, setBrCode] = React.useState("");
  const [q, setQ] = React.useState("");

  const hasBr = rows?.hasBr ?? false;
  const all = React.useMemo(() => rows?.rows ?? [], [rows]);

  const cities = React.useMemo(
    () => (rows?.options.cities ?? []).filter((c) => !operationId || c.operationId === operationId),
    [rows, operationId],
  );
  const brs = React.useMemo(
    () =>
      [...new Set((rows?.options.brs ?? [])
        .filter((b) => (!operationId || b.operationId === operationId) && (!cityId || String(b.cityId) === cityId))
        .map((b) => b.code))].sort(),
    [rows, operationId, cityId],
  );

  const filtered = React.useMemo(() => {
    const needle = q.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    return all.filter((r) => {
      if (operationId && r.operationId !== operationId) return false;
      if (cityId && String(r.cityId) !== cityId) return false;
      if (brCode === NO_BR && r.brCode !== null) return false;
      if (brCode && brCode !== NO_BR && (r.brCode ?? "").toUpperCase() !== brCode) return false;
      if (needle) {
        const plate = (r.licensePlate ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        const fleet = (r.fleetCode ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (!plate.includes(needle) && !fleet.includes(needle)) return false;
      }
      return true;
    });
  }, [all, operationId, cityId, brCode, q]);

  const groups = React.useMemo<OperationGroup[]>(() => {
    const ops = new Map<string, { name: string; rows: FidelizationHistoryRow[] }>();
    for (const r of filtered) {
      const g = ops.get(r.operationId) ?? { name: r.operationName, rows: [] };
      g.rows.push(r);
      ops.set(r.operationId, g);
    }
    const byCity = (list: FidelizationHistoryRow[], prefix: string): CityGroup[] => {
      const map = new Map<string, CityGroup>();
      for (const r of list) {
        const key = `${prefix}:${r.cityId}`;
        const g = map.get(key) ?? { key, label: `${r.cityName}/${r.stateUf}`, rows: [] };
        g.rows.push(r);
        map.set(key, g);
      }
      return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
    };
    return [...ops.entries()]
      .map(([id, g]): OperationGroup => {
        const brMap = new Map<string, FidelizationHistoryRow[]>();
        for (const r of g.rows) {
          const key = r.brCode === null ? NO_BR : r.brCode.toUpperCase();
          brMap.set(key, [...(brMap.get(key) ?? []), r]);
        }
        const brGroups = [...brMap.entries()]
          .map(([key, list]): BrGroup => ({
            key: `${id}:${key}`,
            code: key === NO_BR ? null : list[0].brCode,
            cities: byCity(list, `${id}:${key}`),
            plates: distinctPlates(list),
          }))
          // A BR nula ("—") vem por último: é a exceção do mês.
          .sort((a, b) => (a.code === null ? 1 : b.code === null ? -1 : a.code.localeCompare(b.code, "pt-BR")));
        return {
          key: id,
          name: g.name,
          brs: brGroups,
          cities: byCity(g.rows, id),
          plates: distinctPlates(g.rows),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [filtered]);

  const filtering = Boolean(operationId || cityId || brCode || q.trim());
  const totals = {
    plates: distinctPlates(filtered),
    brs: new Set(filtered.filter((r) => r.brCode !== null).map((r) => `${r.operationId}:${r.cityId}:${r.brCode!.toUpperCase()}`)).size,
    locais: new Set(filtered.map((r) => `${r.operationId}:${r.cityId}`)).size,
  };

  return (
    <section aria-label="Histórico consolidado" className="flex flex-col gap-4" data-testid="fidelization-history">
      <Alert variant="info" icon={<Lock />}>
        <AlertTitle>Competência histórica — somente consulta</AlertTitle>
        <AlertDescription>
          O histórico consolidado de {rows?.label || `${competence.month}/${competence.year}`} mostra a posição de cada
          placa no mês, como foi carregado. Não é recalculado e não é usado para recriar vínculos atuais.
          {hasBr ? null : " Este mês não tem BR: as placas ficam agrupadas por operação e cidade."}
        </AlertDescription>
      </Alert>

      {rows === null ? (
        <Alert variant="danger">
          <AlertDescription>Não foi possível carregar o histórico consolidado. Recarregue a página.</AlertDescription>
        </Alert>
      ) : all.length === 0 ? (
        <Card>
          <EmptyState
            icon={<History />}
            title={`Sem histórico carregado para ${rows.label}`}
            description="O histórico de 2024 e 2025 entra pela carga da planilha consolidada (somente consulta)."
          />
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-4 p-4">
            <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filtros do histórico">
              <label className="flex min-w-[11rem] flex-1 flex-col gap-1 sm:flex-none">
                <span className="text-caption text-fg-muted">Operação</span>
                <NativeSelect
                  fieldSize="sm"
                  aria-label="Filtrar o histórico por operação"
                  value={operationId}
                  onChange={(e) => {
                    setOperationId(e.target.value);
                    setCityId("");
                    setBrCode("");
                  }}
                >
                  <option value="">Todas</option>
                  {rows.options.operations.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </NativeSelect>
              </label>
              <label className="flex min-w-[10rem] flex-1 flex-col gap-1 sm:flex-none">
                <span className="text-caption text-fg-muted">Cidade</span>
                <NativeSelect
                  fieldSize="sm"
                  aria-label="Filtrar o histórico por cidade"
                  value={cityId}
                  onChange={(e) => {
                    setCityId(e.target.value);
                    setBrCode("");
                  }}
                >
                  <option value="">Todas</option>
                  {[...new Map(cities.map((c) => [c.id, c])).values()].map((c) => (
                    <option key={c.id} value={String(c.id)}>{c.name}/{c.uf}</option>
                  ))}
                </NativeSelect>
              </label>
              {hasBr ? (
                <label className="flex min-w-[9rem] flex-1 flex-col gap-1 sm:flex-none">
                  <span className="text-caption text-fg-muted">BR</span>
                  <NativeSelect
                    fieldSize="sm"
                    aria-label="Filtrar o histórico por BR"
                    value={brCode}
                    onChange={(e) => setBrCode(e.target.value)}
                  >
                    <option value="">Todas</option>
                    {brs.map((code) => (
                      <option key={code} value={code.toUpperCase()}>{code}</option>
                    ))}
                    {rows.totals.withoutBr > 0 ? <option value={NO_BR}>Sem BR (—)</option> : null}
                  </NativeSelect>
                </label>
              ) : null}
              <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
                <span className="text-caption text-fg-muted">Placa ou frota</span>
                <SearchField
                  size="sm"
                  value={q}
                  onValueChange={setQ}
                  placeholder="Ex.: ABC1D23"
                  aria-label="Buscar placa ou frota no histórico"
                />
              </label>
            </div>

            <p className="text-body-sm text-fg-secondary" aria-live="polite" data-testid="fidelization-history-totals">
              <strong className="text-fg">{number.format(totals.plates)}</strong> placa(s) ·{" "}
              <strong className="text-fg">{hasBr ? number.format(totals.brs) : "—"}</strong> BR(s) ·{" "}
              <strong className="text-fg">{number.format(totals.locais)}</strong> local(is) de operação
              {filtering ? ` · filtrado de ${number.format(distinctPlates(all))} placa(s)` : null}
            </p>

            {groups.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-body-sm text-fg-muted">
                Nenhuma placa com estes filtros.
              </p>
            ) : (
              <ul className="flex flex-col gap-3" aria-label="Operações">
                {groups.map((op) => (
                  <li key={`${op.key}:${filtering}`}>
                    <Group
                      level={1}
                      title={op.name}
                      meta={`${number.format(op.plates)} placa(s)`}
                      defaultOpen
                    >
                      {hasBr ? (
                        <ul className="flex flex-col gap-2">
                          {op.brs.map((br) => (
                            <li key={br.key}>
                              <Group
                                level={2}
                                title={br.code === null ? "BR —" : `BR ${br.code}`}
                                meta={`${br.cities.map((c) => c.label).join(", ")} · ${number.format(br.plates)} placa(s)`}
                                defaultOpen={filtering || op.brs.length <= 4}
                              >
                                <ul className="flex flex-col gap-2">
                                  {br.cities.map((city) => (
                                    <li key={city.key}>
                                      <p className="px-1 pb-1 text-caption font-medium text-fg-muted">Local · {city.label}</p>
                                      <PlateList rows={city.rows} />
                                    </li>
                                  ))}
                                </ul>
                              </Group>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <ul className="flex flex-col gap-2">
                          {op.cities.map((city) => (
                            <li key={city.key}>
                              <Group
                                level={2}
                                title={city.label}
                                meta={`${number.format(distinctPlates(city.rows))} placa(s)`}
                                defaultOpen={filtering || op.cities.length <= 4}
                              >
                                <PlateList rows={city.rows} />
                              </Group>
                            </li>
                          ))}
                        </ul>
                      )}
                    </Group>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {evolution ? <Evolution evolution={evolution} competence={competence} onSelectMonth={onSelectMonth} /> : null}
    </section>
  );
}

function Group({
  level,
  title,
  meta,
  defaultOpen = false,
  children,
}: {
  level: 1 | 2;
  title: string;
  meta: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      className={cn(
        "rounded-md border border-border",
        // Um nome de grupo por nível: a seta de um grupo fechado não gira
        // porque o grupo de fora está aberto.
        level === 1 ? "group/op bg-surface" : "group/br bg-surface-raised",
      )}
      open={defaultOpen}
    >
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 hfm-focus-ring [&::-webkit-details-marker]:hidden",
          level === 1 ? "min-h-11" : "min-h-10",
        )}
      >
        <span className="flex min-w-0 flex-col">
          <span className={cn("truncate font-semibold text-fg", level === 1 ? "text-body" : "text-body-sm")}>{title}</span>
          <span className="truncate text-caption text-fg-muted">{meta}</span>
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-fg-muted transition-transform",
            level === 1 ? "group-open/op:rotate-180" : "group-open/br:rotate-180",
          )}
        />
      </summary>
      <div className="border-t border-border-subtle p-2 sm:p-3">{children}</div>
    </details>
  );
}

function PlateList({ rows }: { rows: FidelizationHistoryRow[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-border-subtle">
      <div
        aria-hidden
        className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_4rem] gap-3 bg-surface-sunken px-3 py-1.5 text-caption font-medium text-fg-muted sm:grid"
      >
        <span>Placa</span>
        <span>Frota</span>
        <span>BR</span>
        <span>Período no mês</span>
        <span className="text-right">Dias</span>
      </div>
      <ul className="divide-y divide-border-subtle">
        {rows.map((r) => (
          <li
            key={r.id}
            className="grid grid-cols-2 gap-x-3 gap-y-0.5 px-3 py-2 text-body-sm sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_4rem] sm:items-center"
            data-testid="fidelization-history-plate"
          >
            <span className="truncate font-semibold text-fg">{r.licensePlate ?? r.fleetCode ?? "—"}</span>
            <span className="truncate text-fg-secondary">
              <span className="sm:hidden">Frota </span>
              {r.fleetCode ?? "—"}
            </span>
            <span className="truncate text-fg-secondary" data-testid="fidelization-history-br">
              <span className="sm:hidden">BR </span>
              {r.brCode ?? "—"}
            </span>
            <span className="truncate tabular-nums text-fg-secondary">
              {formatDateBr(r.firstDay).slice(0, 5)} a {formatDateBr(r.lastDay).slice(0, 5)}
            </span>
            <span className="col-span-2 tabular-nums text-fg-muted sm:col-span-1 sm:text-right">
              {number.format(r.days)} dia(s)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Evolution({
  evolution,
  competence,
  onSelectMonth,
}: {
  evolution: FidelizationHistoryEvolution;
  competence: Competence;
  onSelectMonth?: (competence: Competence) => void;
}) {
  const max = Math.max(1, ...evolution.months.map((m) => m.plates));
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-card-title font-semibold text-fg">Evolução do ano · {evolution.year}</h3>
          <span className="text-caption text-fg-muted">
            Mudanças: placas com mais de uma posição no mês ou em posição diferente da do mês anterior.
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-body-sm" data-testid="fidelization-history-evolution">
            <thead>
              <tr className="text-left text-caption text-fg-muted">
                <th scope="col" className="py-1.5 pr-2 font-medium">Mês</th>
                <th scope="col" className="px-1 py-1.5 font-medium sm:px-2">Placas</th>
                <th scope="col" className="px-1 py-1.5 text-right font-medium sm:px-2">BRs</th>
                <th scope="col" className="px-1 py-1.5 text-right font-medium sm:px-2">Locais</th>
                <th scope="col" className="py-1.5 pl-2 text-right font-medium">Mudanças</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {evolution.months.map((m) => {
                const current = m.month === competence.month && evolution.year === competence.year;
                return (
                  <tr key={m.competence} className={cn(current && "bg-primary-soft/50")} aria-current={current ? "true" : undefined}>
                    <th scope="row" className="py-1.5 pr-2 text-left font-medium">
                      {onSelectMonth && m.loaded && !current ? (
                        <button
                          type="button"
                          className="rounded-xs text-link underline-offset-2 hover:underline hfm-focus-ring"
                          onClick={() => onSelectMonth({ year: evolution.year, month: m.month })}
                        >
                          {m.label.split("/")[0]}
                        </button>
                      ) : (
                        <span className={cn(current ? "text-fg" : "text-fg-secondary")}>{m.label.split("/")[0]}</span>
                      )}
                    </th>
                    <td className="px-1 py-1.5 sm:px-2">
                      {m.loaded ? (
                        <span className="flex items-center gap-2">
                          <span className="w-8 shrink-0 text-right tabular-nums text-fg">{number.format(m.plates)}</span>
                          <span aria-hidden className="hidden h-1.5 w-full max-w-28 rounded-full bg-neutral-soft sm:block">
                            <span
                              className="block h-1.5 rounded-full bg-chart-1"
                              style={{ width: `${Math.round((100 * m.plates) / max)}%` }}
                            />
                          </span>
                        </span>
                      ) : (
                        <span className="text-fg-muted">—</span>
                      )}
                    </td>
                    <td className="px-1 py-1.5 text-right tabular-nums sm:px-2">{m.loaded && m.brs > 0 ? number.format(m.brs) : "—"}</td>
                    <td className="px-1 py-1.5 text-right tabular-nums sm:px-2">{m.loaded ? number.format(m.locais) : "—"}</td>
                    <td className="py-1.5 pl-2 text-right tabular-nums">
                      {m.loaded ? (
                        m.changes > 0 ? <Badge variant="info" size="sm">{number.format(m.changes)}</Badge> : "0"
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
