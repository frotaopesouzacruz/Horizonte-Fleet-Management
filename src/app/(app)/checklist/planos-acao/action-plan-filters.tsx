"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, SlidersHorizontal, UserRound, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateInput } from "@/components/ui/date-input";
import { FilterBar, FilterBarClear, FilterChip } from "@/components/ui/filter-bar";
import { inputVariants } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchField } from "@/components/ui/search-field";
import { NativeSelect } from "@/components/governance/selects";
import {
  DEADLINE_LABEL,
  PLAN_STATUS_LABEL,
  PLAN_STATUS_ORDER,
  PRIORITY_LABEL,
  PRIORITY_ORDER,
} from "@/lib/action-plans/labels";
import { FILTER_PARAM, type ActionPlanCatalog, type ActionPlanFilters, type Deadline } from "@/lib/action-plans/types";
import { activeFilterCount } from "@/lib/action-plans/url";
import type { Navigate } from "./shared";

/**
 * Filtros do Plano de Ação — Visão geral, Planos e Conciliação.
 *
 * O estado vive na URL (`FILTER_PARAM`), vários valores separados por vírgula,
 * e cada mudança é uma ida ao servidor que volta para a primeira página. Tudo
 * por id oficial vindo do catálogo — nunca por texto. UF → Cidade e Operação →
 * BR se encadeiam: trocar o pai descarta o filho que ficou fora dele. As listas
 * de várias opções aplicam ao fechar (Esc descarta).
 */

const P = FILTER_PARAM;
type Patch = Record<string, string | null>;

const split = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
const join = (values: string[]) => (values.length ? values.join(",") : null);
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((v) => b.includes(v));
const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Valor especial do Responsável: planos sem responsável (`sem_responsavel=1`). */
const UNASSIGNED = "__sem_responsavel__";

const DEADLINES = Object.keys(DEADLINE_LABEL) as Deadline[];

const byName = (items: { id: string; name: string }[]) =>
  [...items].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map((i) => ({ value: i.id, label: i.name }));

// ---------------------------------------------------------------------------
// Peças
// ---------------------------------------------------------------------------

function Field({
  label,
  children,
  className,
  group = false,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  /** Mais de um controle: vira um grupo nomeado em vez de <label>. */
  group?: boolean;
}) {
  const id = React.useId();
  if (group) {
    return (
      <div role="group" aria-labelledby={id} className={cn("flex min-w-0 flex-col gap-1", className)}>
        <span id={id} className="text-caption text-fg-muted">
          {label}
        </span>
        {children}
      </div>
    );
  }
  return (
    <label className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-caption text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

interface Option {
  value: string;
  label: string;
  hint?: string | null;
}

interface MultiSelectProps {
  label: string;
  options: Option[];
  selected: string[];
  onApply: (values: string[]) => void;
  disabled?: boolean;
  /** "Todas" / "Todos" — o que se vê sem seleção (e com tudo marcado). */
  allLabel?: string;
  /** "3 selecionadas" */
  manyLabel?: (n: number) => string;
  /** Nome para um valor da URL que não está entre as opções (drill-down). */
  fallbackLabel?: (value: string) => string;
  /** Texto quando não há opções (ex.: cascata sem pai). */
  emptyText?: string;
  className?: string;
  testId?: string;
}

const MAX_VISIBLE = 200;

/**
 * Lista de várias opções num popover: busca (listas longas), caixas de marcar,
 * Limpar e Aplicar. Fechar aplica; Esc descarta. Valores da URL que não estão
 * no catálogo (vindos de um clique na árvore) continuam visíveis e marcados.
 */
function MultiSelect({
  label,
  options,
  selected,
  onApply,
  disabled,
  allLabel = "Todas",
  manyLabel = (n) => `${n} selecionadas`,
  fallbackLabel,
  emptyText = "Nenhuma opção disponível.",
  className,
  testId,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<string[]>(selected);
  const [query, setQuery] = React.useState("");
  const discard = React.useRef(false);
  const baseId = React.useId();

  const all = React.useMemo(() => {
    const known = new Set(options.map((o) => o.value));
    const extra = selected
      .filter((v) => !known.has(v))
      .map((v) => ({ value: v, label: fallbackLabel?.(v) ?? v, hint: "selecionado" }));
    return [...extra, ...options];
  }, [options, selected, fallbackLabel]);

  const labelOf = (value: string) => all.find((o) => o.value === value)?.label ?? value;
  const everything = options.length > 1 && options.every((o) => selected.includes(o.value));
  const summary =
    selected.length === 0 || everything
      ? allLabel
      : selected.length === 1
        ? labelOf(selected[0])
        : manyLabel(selected.length);

  const searchable = all.length > 8;
  const q = fold(query.trim());
  const matches = q ? all.filter((o) => fold(`${o.label} ${o.hint ?? ""}`).includes(q)) : all;
  const visible = matches.slice(0, MAX_VISIBLE);

  const commit = (values: string[]) => {
    if (!sameSet(values, selected)) onApply(values);
  };

  const onOpenChange = (next: boolean) => {
    if (next) {
      setDraft(selected);
      setQuery("");
      discard.current = false;
      setOpen(true);
      return;
    }
    setOpen(false);
    if (!discard.current) commit(draft);
  };

  const toggle = (value: string, checked: boolean) =>
    setDraft((d) => (checked ? (d.includes(value) ? d : [...d, value]) : d.filter((v) => v !== value)));

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`${label}: ${summary}`}
          data-testid={testId}
          data-active={selected.length > 0 || undefined}
          className={cn(
            inputVariants({ size: "sm" }),
            "inline-flex cursor-pointer items-center justify-between gap-2 text-left",
            selected.length > 0 && !everything && "border-border-strong",
            className,
          )}
        >
          <span className={cn("truncate", (selected.length === 0 || everything) && "text-fg-secondary")}>{summary}</span>
          {selected.length > 1 && !everything ? (
            <Badge variant="accent" size="sm" className="ml-auto tabular-nums" aria-hidden>
              {selected.length}
            </Badge>
          ) : null}
          <ChevronDown aria-hidden className="size-4 shrink-0 text-fg-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex w-[min(92vw,20rem)] flex-col p-0"
        onEscapeKeyDown={() => {
          discard.current = true;
        }}
        aria-label={label}
      >
        {searchable ? (
          <div className="border-b border-border-subtle p-2">
            <SearchField
              size="sm"
              autoFocus
              value={query}
              onValueChange={setQuery}
              onClear={() => setQuery("")}
              aria-label={`Buscar em ${label}`}
              placeholder="Buscar…"
            />
          </div>
        ) : null}
        <div role="group" aria-label={label} className="max-h-64 overflow-y-auto p-1">
          {all.length === 0 ? (
            <p className="px-2 py-3 text-caption text-fg-muted">{emptyText}</p>
          ) : visible.length === 0 ? (
            <p className="px-2 py-3 text-caption text-fg-muted">Nada encontrado para “{query.trim()}”.</p>
          ) : (
            visible.map((o, index) => {
              const id = `${baseId}-${index}`;
              return (
                <div
                  key={o.value}
                  className="flex min-h-8 items-center gap-2 rounded-sm px-2 py-1 hfm-transition hover:bg-hover-overlay"
                >
                  <Checkbox id={id} checked={draft.includes(o.value)} onCheckedChange={(c) => toggle(o.value, c === true)} />
                  <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2 select-none">
                    <span className="min-w-0 flex-1 truncate text-body-sm text-fg" title={o.label}>
                      {o.label}
                    </span>
                    {o.hint ? <span className="shrink-0 truncate text-caption text-fg-muted">{o.hint}</span> : null}
                  </label>
                </div>
              );
            })
          )}
          {matches.length > MAX_VISIBLE ? (
            <p className="px-2 py-2 text-caption text-fg-muted">
              Mostrando {MAX_VISIBLE} de {matches.length}. Refine a busca.
            </p>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border-subtle p-2">
          <Button variant="ghost" size="sm" onClick={() => setDraft([])} disabled={draft.length === 0}>
            Limpar
          </Button>
          <span className="text-caption text-fg-muted tabular-nums" aria-live="polite">
            {draft.length ? `${draft.length} marcada(s)` : allLabel}
          </span>
          <Button
            size="sm"
            onClick={() => {
              setOpen(false);
              commit(draft);
            }}
          >
            Aplicar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Botão liga/desliga (aria-pressed) para filtros booleanos. */
function Toggle({
  pressed,
  onPressedChange,
  disabled,
  children,
  icon,
  testId,
}: {
  pressed: boolean;
  onPressedChange: (next: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
  icon?: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      data-testid={testId}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        "inline-flex h-(--control-height-sm) shrink-0 items-center gap-1.5 rounded-sm border px-2.5 text-body-sm font-medium",
        "hfm-transition hfm-focus-ring disabled:pointer-events-none disabled:opacity-55 [&_svg]:size-4",
        pressed
          ? "border-primary/50 bg-primary-soft text-primary-soft-fg"
          : "border-input-border bg-input text-fg-secondary hover:bg-hover-overlay hover:text-fg",
      )}
    >
      {icon ? <span aria-hidden className="inline-flex">{icon}</span> : null}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Barra
// ---------------------------------------------------------------------------

export interface ActionPlanFilterBarProps {
  filters: ActionPlanFilters;
  catalog: ActionPlanCatalog;
  navigate: Navigate;
  pending: boolean;
}

type QuickGroup = "open" | "closed" | "all";

const QUICK: { value: QuickGroup; label: string }[] = [
  { value: "open", label: "Abertos" },
  { value: "closed", label: "Encerrados" },
  { value: "all", label: "Todos" },
];

/** Filtros guardados em "Mais filtros" (o contador do botão). */
const MORE_KEYS: (keyof ActionPlanFilters)[] = [
  "state",
  "city",
  "unit",
  "br",
  "leader",
  "vehicleType",
  "cluster",
  "actionKey",
  "responsible",
  "unassigned",
  "withMaintenance",
  "deadline",
  "recurrence",
  "fleet",
];

const FLEET_LABEL: Record<NonNullable<ActionPlanFilters["fleet"]>, string> = {
  all: "Todas",
  active: "Frota ativa",
  inactive: "Frota inativa",
};

export function ActionPlanFilterBar({ filters, catalog, navigate, pending }: ActionPlanFilterBarProps) {
  const params = useSearchParams();
  const [moreOpen, setMoreOpen] = React.useState(false);
  const moreId = React.useId();

  const apply = (patch: Patch) => navigate({ ...patch, pagina: null });
  const set = (key: keyof ActionPlanFilters, value: string | null, extra: Patch = {}) =>
    apply({ [P[key]]: value || null, ...extra });

  // ---- seleções atuais
  const sel = {
    status: split(filters.status),
    priority: split(filters.priority),
    operation: split(filters.operation),
    state: split(filters.state),
    city: split(filters.city),
    unit: split(filters.unit),
    br: split(filters.br),
    leader: split(filters.leader),
    vehicleType: split(filters.vehicleType),
    cluster: split(filters.cluster),
    actionKey: split(filters.actionKey),
    responsible: [...split(filters.responsible), ...(filters.unassigned ? [UNASSIGNED] : [])],
  };

  // ---- opções (todas do catálogo; as cascatas filtram pelo pai escolhido)
  const statusOptions = React.useMemo<Option[]>(
    () => PLAN_STATUS_ORDER.map((s) => ({ value: s, label: PLAN_STATUS_LABEL[s] })),
    [],
  );
  const priorityOptions = React.useMemo<Option[]>(
    () => PRIORITY_ORDER.map((p) => ({ value: p, label: PRIORITY_LABEL[p] })),
    [],
  );
  const operationOptions = React.useMemo<Option[]>(
    () => catalog.operations.map((o) => ({ value: o.id, label: o.name })),
    [catalog.operations],
  );
  const stateOptions = React.useMemo<Option[]>(
    () =>
      [...catalog.states]
        .sort((a, b) => a.uf.localeCompare(b.uf))
        .map((s) => ({ value: String(s.id), label: s.uf })),
    [catalog.states],
  );
  const ufById = React.useMemo(() => new Map(catalog.states.map((s) => [s.id, s.uf])), [catalog.states]);

  const stateKey = filters.state ?? "";
  const cityOptions = React.useMemo<Option[]>(() => {
    const states = split(stateKey);
    return catalog.cities
      .filter((c) => states.length === 0 || states.includes(String(c.stateId)))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
      .map((c) => ({ value: String(c.id), label: c.name, hint: ufById.get(c.stateId) ?? null }));
  }, [catalog.cities, stateKey, ufById]);

  const operationKey = filters.operation ?? "";
  const operationName = React.useMemo(() => new Map(catalog.operations.map((o) => [o.id, o.name])), [catalog.operations]);
  const brOptions = React.useMemo<Option[]>(() => {
    const ops = split(operationKey);
    return catalog.brs
      .filter((b) => ops.length === 0 || ops.includes(b.operationId))
      .sort((a, b) => a.code.localeCompare(b.code, "pt-BR", { numeric: true }))
      .map((b) => ({ value: b.id, label: b.code, hint: ops.length === 1 ? null : operationName.get(b.operationId) ?? null }));
  }, [catalog.brs, operationKey, operationName]);

  const clusterName = React.useMemo(() => new Map(catalog.clusters.map((c) => [c.key, c.name])), [catalog.clusters]);
  const clusterKey = filters.cluster ?? "";
  const itemOptions = React.useMemo<Option[]>(() => {
    const clusters = split(clusterKey);
    return catalog.actionKeys
      .filter((a) => clusters.length === 0 || (a.clusterKey != null && clusters.includes(a.clusterKey)))
      .sort((a, b) => a.title.localeCompare(b.title, "pt-BR"))
      .map((a) => ({ value: a.key, label: a.title, hint: a.clusterKey ? clusterName.get(a.clusterKey) ?? null : null }));
  }, [catalog.actionKeys, clusterKey, clusterName]);

  /**
   * Um item vindo da árvore é a identidade do problema (plan key), que
   * especializa a chave de ação do catálogo com a opção marcada.
   */
  const parentActionKey = React.useCallback(
    (value: string) =>
      catalog.actionKeys
        .filter((a) => value === a.key || value.startsWith(`${a.key}:`) || value.startsWith(`${a.key}=`))
        .sort((a, b) => b.key.length - a.key.length)[0],
    [catalog.actionKeys],
  );
  const itemFallback = React.useCallback(
    (value: string) => {
      const parent = parentActionKey(value);
      if (!parent) return value;
      const option = value.includes("=") ? value.slice(value.lastIndexOf("=") + 1) : null;
      return option ? `${parent.title} — ${option}` : parent.title;
    },
    [parentActionKey],
  );

  const responsibleOptions = React.useMemo<Option[]>(
    () => [
      { value: UNASSIGNED, label: "Sem responsável" },
      ...[...catalog.responsibles]
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
        .map((r) => ({ value: r.id, label: r.name })),
    ],
    [catalog.responsibles],
  );

  const unitOptions = React.useMemo(() => byName(catalog.units), [catalog.units]);
  const leaderOptions = React.useMemo(() => byName(catalog.leaders), [catalog.leaders]);
  const vehicleTypeOptions = React.useMemo(() => byName(catalog.vehicleTypes), [catalog.vehicleTypes]);
  const clusterOptions = React.useMemo<Option[]>(
    () =>
      [...catalog.clusters]
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
        .map((c) => ({ value: c.key, label: c.name })),
    [catalog.clusters],
  );

  // ---- aplicação (com as cascatas)
  const applyStates = (states: string[]) => {
    const keep = states.length
      ? sel.city.filter((id) => {
          const city = catalog.cities.find((c) => String(c.id) === id);
          return city ? states.includes(String(city.stateId)) : false;
        })
      : sel.city;
    apply({ [P.state]: join(states), [P.city]: join(keep) });
  };

  const applyOperations = (ops: string[]) => {
    const keep = ops.length
      ? sel.br.filter((id) => {
          const br = catalog.brs.find((b) => b.id === id);
          return br ? ops.includes(br.operationId) : false;
        })
      : sel.br;
    apply({ [P.operation]: join(ops), [P.br]: join(keep) });
  };

  const applyClusters = (clusters: string[]) => {
    const keep = clusters.length
      ? sel.actionKey.filter((key) => {
          const ak = catalog.actionKeys.find((a) => a.key === key) ?? parentActionKey(key);
          return ak?.clusterKey != null && clusters.includes(ak.clusterKey);
        })
      : sel.actionKey;
    apply({ [P.cluster]: join(clusters), [P.actionKey]: join(keep) });
  };

  const applyResponsibles = (values: string[]) =>
    apply({
      [P.responsible]: join(values.filter((v) => v !== UNASSIGNED)),
      [P.unassigned]: values.includes(UNASSIGNED) ? "1" : null,
    });

  // A situação escolhida na lista substitui o atalho (e vice-versa).
  const applyStatuses = (values: string[]) => apply({ [P.status]: join(values), [P.statusGroup]: null });

  const allStatuses = PLAN_STATUS_ORDER.every((s) => sel.status.includes(s));
  const quick: QuickGroup | null = sel.status.length
    ? allStatuses && !filters.statusGroup
      ? "all"
      : null
    : filters.statusGroup ?? "all";

  const applyQuick = (value: QuickGroup) => {
    if (value === "all") {
      // "Todos" precisa ser explícito: sem situação, a aba Planos abre nos abertos.
      apply({ [P.statusGroup]: null, [P.status]: PLAN_STATUS_ORDER.join(",") });
    } else {
      apply({ [P.statusGroup]: value, [P.status]: null });
    }
  };

  // ---- contadores
  const moreCount = MORE_KEYS.filter((k) => {
    const v = filters[k];
    return v !== undefined && v !== false && v !== "";
  }).length;
  // A aba Planos abre nos abertos sem pedir: isso não é um filtro a limpar.
  const implicitOpen = filters.statusGroup === "open" && !params.has(P.statusGroup);
  const count = activeFilterCount(filters) - (implicitOpen ? 1 : 0);

  const clearAll = () => {
    const patch: Patch = {};
    for (const key of Object.values(P)) patch[key] = null;
    apply(patch);
  };

  // ---- resumos (chips) do que não aparece na linha principal
  const names = (values: string[], label: (v: string) => string | undefined) => {
    const list = values.map((v) => label(v) ?? v);
    return list.length > 2 ? `${list.slice(0, 2).join(", ")} +${list.length - 2}` : list.join(", ");
  };
  const optionLabel = (options: Option[]) => (v: string) => options.find((o) => o.value === v)?.label;

  const chips: { key: string; label: string; value: string; patch: Patch }[] = [];
  if (filters.vehicle) {
    const n = split(filters.vehicle).length;
    chips.push({ key: "vehicle", label: "Veículo", value: n > 1 ? `${n} selecionados` : "selecionado na árvore", patch: { [P.vehicle]: null } });
  }
  if (filters.question) {
    const questions = split(filters.question);
    chips.push({
      key: "question",
      label: "Pergunta",
      value: names(questions, (q) => catalog.actionKeys.find((a) => a.questionKey === q)?.title),
      patch: { [P.question]: null },
    });
  }
  if (!moreOpen) {
    const push = (key: keyof ActionPlanFilters, label: string, value: string, patch: Patch) => {
      if (value) chips.push({ key, label, value, patch });
    };
    push("state", "UF", names(sel.state, optionLabel(stateOptions)), { [P.state]: null, [P.city]: null });
    push("city", "Cidade", names(sel.city, (v) => catalog.cities.find((c) => String(c.id) === v)?.name), { [P.city]: null });
    push("unit", "Filial", names(sel.unit, optionLabel(unitOptions)), { [P.unit]: null });
    push("br", "BR", names(sel.br, (v) => catalog.brs.find((b) => b.id === v)?.code), { [P.br]: null });
    push("leader", "Liderança", names(sel.leader, optionLabel(leaderOptions)), { [P.leader]: null });
    push("vehicleType", "Tipo de equipamento", names(sel.vehicleType, optionLabel(vehicleTypeOptions)), { [P.vehicleType]: null });
    push("cluster", "Cluster", names(sel.cluster, optionLabel(clusterOptions)), { [P.cluster]: null });
    push("actionKey", "Item", names(sel.actionKey, (v) => catalog.actionKeys.find((a) => a.key === v)?.title ?? itemFallback(v)), {
      [P.actionKey]: null,
    });
    push("responsible", "Responsável", names(sel.responsible, optionLabel(responsibleOptions)), {
      [P.responsible]: null,
      [P.unassigned]: null,
    });
    push("withMaintenance", "Manutenção", filters.withMaintenance ? (filters.withMaintenance === "yes" ? "Com manutenção" : "Sem manutenção") : "", {
      [P.withMaintenance]: null,
    });
    push("deadline", "Prazo", filters.deadline ? DEADLINE_LABEL[filters.deadline] : "", { [P.deadline]: null });
    push("recurrence", "Reincidência", filters.recurrence ? "Possível reincidência" : "", { [P.recurrence]: null });
    push("fleet", "Frota", filters.fleet ? FLEET_LABEL[filters.fleet] : "", { [P.fleet]: null });
  }

  return (
    <div className="flex flex-col" data-testid="action-plans-filters">
      <FilterBar label="Filtros dos planos de ação" className="items-end gap-3">
        <Field label="Período (apontamentos)" group>
          <div className="flex items-center gap-1.5">
            <DateInput
              size="sm"
              aria-label="Data inicial"
              value={filters.from ?? ""}
              max={filters.to}
              disabled={pending}
              onChange={(e) => set("from", e.target.value || null)}
              wrapperClassName="w-[8.75rem]"
            />
            <span className="text-caption text-fg-muted">até</span>
            <DateInput
              size="sm"
              aria-label="Data final"
              value={filters.to ?? ""}
              min={filters.from}
              disabled={pending}
              onChange={(e) => set("to", e.target.value || null)}
              wrapperClassName="w-[8.75rem]"
            />
          </div>
        </Field>

        <Field label="Código, placa, frota ou item" className="w-full min-w-[12rem] flex-1 sm:w-auto sm:max-w-[18rem]">
          <SearchField
            key={filters.q ?? ""}
            size="sm"
            aria-label="Buscar por código do plano, placa, frota ou item"
            defaultValue={filters.q ?? ""}
            placeholder="PA-2026-…, placa, frota, item"
            onKeyDown={(e) => {
              if (e.key === "Enter") set("q", (e.target as HTMLInputElement).value.trim() || null);
            }}
            onClear={() => {
              if (filters.q) set("q", null);
            }}
            data-testid="action-plans-search"
          />
        </Field>

        <Field label="Situação" group>
          <div className="flex flex-wrap items-center gap-1.5">
            <div
              role="group"
              aria-label="Atalho de situação"
              className="inline-flex h-(--control-height-sm) items-center rounded-sm border border-input-border bg-input p-0.5"
            >
              {QUICK.map((q) => {
                const active = quick === q.value;
                return (
                  <button
                    key={q.value}
                    type="button"
                    aria-pressed={active}
                    disabled={pending}
                    data-testid={`action-plans-quick-${q.value}`}
                    onClick={() => {
                      if (!active) applyQuick(q.value);
                    }}
                    className={cn(
                      "inline-flex h-full items-center rounded-xs px-2.5 text-caption font-medium hfm-transition hfm-focus-ring",
                      "disabled:cursor-wait",
                      active ? "bg-primary text-primary-fg shadow-xs" : "text-fg-secondary hover:text-fg",
                    )}
                  >
                    {q.label}
                  </button>
                );
              })}
            </div>
            <MultiSelect
              label="Situação"
              options={statusOptions}
              selected={sel.status}
              onApply={applyStatuses}
              disabled={pending}
              allLabel="Todas as situações"
              className="w-[11rem]"
              testId="action-plans-status"
            />
          </div>
        </Field>

        <Field label="Operação" group>
          <MultiSelect
            label="Operação"
            options={operationOptions}
            selected={sel.operation}
            onApply={applyOperations}
            disabled={pending}
            className="w-[11rem]"
            testId="action-plans-operation"
          />
        </Field>

        <Field label="Prioridade" group>
          <MultiSelect
            label="Prioridade"
            options={priorityOptions}
            selected={sel.priority}
            onApply={(values) => apply({ [P.priority]: join(values) })}
            disabled={pending}
            className="w-[8.5rem]"
            testId="action-plans-priority"
          />
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <Toggle
            pressed={Boolean(filters.mine)}
            onPressedChange={(next) => set("mine", next ? "1" : null)}
            disabled={pending}
            icon={<UserRound />}
            testId="action-plans-mine"
          >
            Só os meus
          </Toggle>

          <Button
            variant="secondary"
            size="sm"
            leadingIcon={<SlidersHorizontal />}
            aria-expanded={moreOpen}
            aria-controls={moreId}
            onClick={() => setMoreOpen((o) => !o)}
            data-testid="action-plans-more-filters"
          >
            Mais filtros
            {moreCount ? (
              <Badge variant="accent" size="sm" appearance="solid" className="ml-1 tabular-nums">
                {moreCount}
                <span className="sr-only"> ativos</span>
              </Badge>
            ) : null}
          </Button>

          <FilterBarClear
            count={count}
            onClear={clearAll}
            disabled={pending}
            leadingIcon={<X />}
            data-testid="action-plans-clear-filters"
          />
        </div>
      </FilterBar>

      {moreOpen ? (
        <div
          id={moreId}
          role="region"
          aria-label="Mais filtros"
          className="mb-2 grid grid-cols-1 gap-3 rounded-md border border-border-subtle bg-surface p-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          <Field label="UF" group>
            <MultiSelect label="UF" options={stateOptions} selected={sel.state} onApply={applyStates} disabled={pending} />
          </Field>
          <Field label="Cidade" group>
            <MultiSelect
              label="Cidade"
              options={cityOptions}
              selected={sel.city}
              onApply={(values) => apply({ [P.city]: join(values) })}
              disabled={pending}
              manyLabel={(n) => `${n} cidades`}
              fallbackLabel={(v) => catalog.cities.find((c) => String(c.id) === v)?.name ?? v}
              emptyText="Nenhuma cidade nas UFs escolhidas."
            />
          </Field>
          <Field label="Filial" group>
            <MultiSelect
              label="Filial"
              options={unitOptions}
              selected={sel.unit}
              onApply={(values) => apply({ [P.unit]: join(values) })}
              disabled={pending}
            />
          </Field>
          <Field label="BR" group>
            <MultiSelect
              label="BR"
              options={brOptions}
              selected={sel.br}
              onApply={(values) => apply({ [P.br]: join(values) })}
              disabled={pending}
              fallbackLabel={(v) => catalog.brs.find((b) => b.id === v)?.code ?? v}
              emptyText="Nenhuma BR nas operações escolhidas."
            />
          </Field>
          <Field label="Liderança" group>
            <MultiSelect
              label="Liderança"
              options={leaderOptions}
              selected={sel.leader}
              onApply={(values) => apply({ [P.leader]: join(values) })}
              disabled={pending}
            />
          </Field>
          <Field label="Tipo de equipamento" group>
            <MultiSelect
              label="Tipo de equipamento"
              options={vehicleTypeOptions}
              selected={sel.vehicleType}
              onApply={(values) => apply({ [P.vehicleType]: join(values) })}
              disabled={pending}
              allLabel="Todos"
              manyLabel={(n) => `${n} selecionados`}
            />
          </Field>
          <Field label="Cluster" group>
            <MultiSelect
              label="Cluster"
              options={clusterOptions}
              selected={sel.cluster}
              onApply={applyClusters}
              disabled={pending}
              allLabel="Todos"
              manyLabel={(n) => `${n} selecionados`}
            />
          </Field>
          <Field label="Item" group>
            <MultiSelect
              label="Item"
              options={itemOptions}
              selected={sel.actionKey}
              onApply={(values) => apply({ [P.actionKey]: join(values) })}
              disabled={pending}
              allLabel="Todos"
              manyLabel={(n) => `${n} itens`}
              fallbackLabel={itemFallback}
              emptyText="Nenhum item nos clusters escolhidos."
            />
          </Field>
          <Field label="Responsável" group>
            <MultiSelect
              label="Responsável"
              options={responsibleOptions}
              selected={sel.responsible}
              onApply={applyResponsibles}
              disabled={pending}
              allLabel="Todos"
              manyLabel={(n) => `${n} selecionados`}
            />
          </Field>
          <Field label="Manutenção">
            <NativeSelect
              fieldSize="sm"
              value={filters.withMaintenance ?? ""}
              disabled={pending}
              onChange={(e) => set("withMaintenance", e.target.value || null)}
            >
              <option value="">Com e sem manutenção</option>
              <option value="yes">Com manutenção vinculada</option>
              <option value="no">Sem manutenção vinculada</option>
            </NativeSelect>
          </Field>
          <Field label="Prazo">
            <NativeSelect
              fieldSize="sm"
              value={filters.deadline ?? ""}
              disabled={pending}
              onChange={(e) => set("deadline", e.target.value || null)}
            >
              <option value="">Todos</option>
              {DEADLINES.map((d) => (
                <option key={d} value={d}>
                  {DEADLINE_LABEL[d]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Frota">
            <NativeSelect
              fieldSize="sm"
              value={filters.fleet ?? "all"}
              disabled={pending}
              onChange={(e) => set("fleet", e.target.value === "all" ? null : e.target.value)}
            >
              <option value="all">Ativa e inativa</option>
              <option value="active">Somente frota ativa</option>
              <option value="inactive">Somente frota inativa (histórico)</option>
            </NativeSelect>
          </Field>
          <div className="flex items-end sm:col-span-2 lg:col-span-4">
            <Toggle
              pressed={Boolean(filters.recurrence)}
              onPressedChange={(next) => set("recurrence", next ? "1" : null)}
              disabled={pending}
              testId="action-plans-recurrence"
            >
              Somente possíveis reincidências
            </Toggle>
          </div>
        </div>
      ) : null}

      {chips.length ? (
        <div className="flex flex-wrap items-center gap-1.5 pb-2" aria-label="Outros filtros ativos" role="group">
          {chips.map((chip) => (
            <FilterChip
              key={chip.key}
              label={chip.label}
              value={chip.value}
              disabled={pending}
              onRemove={() => apply(chip.patch)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
