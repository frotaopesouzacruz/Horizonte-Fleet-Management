"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, FoldVertical, UnfoldVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCaption, TableCell, TableContainer, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/cn";
import type { KmAnalysisData, KmAnalysisLocationRow } from "@/lib/km/analysis";
import { fmtInt, fmtKm1, fmtPct } from "@/lib/km/types";

/**
 * Análise gerencial → Por localização: Operação → Estado → Cidade → BR.
 *
 * `by_location` vem de grouping sets e não diz o nível de cada linha; a
 * hierarquia é remontada só para exibir: por operação, a linha de nível 1 é a
 * que não tem estado/cidade/BR (a de maior KM, se houver empate de rótulos);
 * dentro de cada estado, a de nível 2; dentro de cada cidade, a de nível 3;
 * o resto são as BRs. Nenhum número é somado ou recalculado aqui.
 */
export interface LocationNode {
  id: string;
  level: 1 | 2 | 3 | 4;
  label: string;
  row: KmAnalysisLocationRow;
  children: LocationNode[];
}

const LEVEL_LABEL: Record<LocationNode["level"], string> = { 1: "Operação", 2: "Estado", 3: "Cidade", 4: "BR" };
const NO_CITY = "Sem local";

const isNoCity = (city: string | null) => city == null || city === NO_CITY;

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

/** Tira do grupo a linha agregada do nível: a que casa com o critério, depois a de maior KM e mais veículos. */
function takeAggregate(rows: KmAnalysisLocationRow[], matches: (r: KmAnalysisLocationRow) => boolean) {
  if (rows.length === 0) return { head: null, rest: rows };
  let best = 0;
  rows.forEach((r, i) => {
    const b = rows[best];
    const score = (x: KmAnalysisLocationRow) => [matches(x) ? 1 : 0, x.km ?? 0, x.vehicles ?? 0];
    const [m1, k1, v1] = score(r);
    const [m2, k2, v2] = score(b);
    if (m1 > m2 || (m1 === m2 && (k1 > k2 || (k1 === k2 && v1 > v2)))) best = i;
  });
  return { head: rows[best], rest: rows.filter((_, i) => i !== best) };
}

export function buildLocationTree(rows: KmAnalysisLocationRow[]): LocationNode[] {
  const out: LocationNode[] = [];
  for (const [opKey, opRows] of groupBy(rows, (r) => r.operationId ?? `nome:${r.operation}`)) {
    const l1 = takeAggregate(opRows, (r) => r.state == null && isNoCity(r.city) && r.br == null);
    if (!l1.head) continue;
    const opNode: LocationNode = { id: `op:${opKey}`, level: 1, label: l1.head.operation, row: l1.head, children: [] };
    for (const [stateKey, stateRows] of groupBy(l1.rest, (r) => r.state ?? "")) {
      const l2 = takeAggregate(stateRows, (r) => isNoCity(r.city) && r.br == null);
      if (!l2.head) continue;
      const stateNode: LocationNode = {
        id: `${opNode.id}|uf:${stateKey}`,
        level: 2,
        label: l2.head.state ?? "Sem UF",
        row: l2.head,
        children: [],
      };
      for (const [cityKey, cityRows] of groupBy(l2.rest, (r) => r.city ?? NO_CITY)) {
        const l3 = takeAggregate(cityRows, (r) => r.br == null);
        if (!l3.head) continue;
        const cityNode: LocationNode = {
          id: `${stateNode.id}|cidade:${cityKey}`,
          level: 3,
          label: l3.head.city ?? NO_CITY,
          row: l3.head,
          children: l3.rest.map((r, i) => ({
            id: `${stateNode.id}|cidade:${cityKey}|br:${r.br ?? ""}:${i}`,
            level: 4 as const,
            label: r.br ?? "Sem BR",
            row: r,
            children: [],
          })),
        };
        cityNode.children.sort((a, b) => (b.row.km ?? 0) - (a.row.km ?? 0));
        stateNode.children.push(cityNode);
      }
      stateNode.children.sort((a, b) => (b.row.km ?? 0) - (a.row.km ?? 0));
      opNode.children.push(stateNode);
    }
    opNode.children.sort((a, b) => (b.row.km ?? 0) - (a.row.km ?? 0));
    out.push(opNode);
  }
  return out.sort((a, b) => (b.row.km ?? 0) - (a.row.km ?? 0));
}

function collectIds(nodes: LocationNode[], acc: string[] = []): string[] {
  for (const n of nodes) {
    if (n.children.length) {
      acc.push(n.id);
      collectIds(n.children, acc);
    }
  }
  return acc;
}

export function LocationView({ data }: { data: KmAnalysisData }) {
  const tree = React.useMemo(() => buildLocationTree(data.byLocation ?? []), [data.byLocation]);
  const allIds = React.useMemo(() => collectIds(tree), [tree]);
  // Abre o primeiro nível (operações → estados).
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set(tree.map((n) => n.id)));

  if (tree.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-body-sm text-fg-muted">
        Sem KM por localização no período e filtros escolhidos.
      </p>
    );
  }

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const visible: LocationNode[] = [];
  const walk = (nodes: LocationNode[]) => {
    for (const n of nodes) {
      visible.push(n);
      if (n.children.length && expanded.has(n.id)) walk(n.children);
    }
  };
  walk(tree);

  return (
    <div className="flex flex-col gap-3" data-testid="km-analise-localizacao">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body-sm text-fg-secondary">
          Operação → Estado → Cidade → BR, pelo contexto vigente na data de cada leitura.
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            leadingIcon={<UnfoldVertical aria-hidden />}
            onClick={() => setExpanded(new Set(allIds))}
            data-testid="km-analise-localizacao-expandir"
          >
            Expandir tudo
          </Button>
          <Button
            size="sm"
            variant="outline"
            leadingIcon={<FoldVertical aria-hidden />}
            onClick={() => setExpanded(new Set())}
            data-testid="km-analise-localizacao-recolher"
          >
            Recolher tudo
          </Button>
        </div>
      </div>

      <TableContainer>
        <Table className="min-w-[960px]" data-testid="km-analise-localizacao-tabela">
          <TableCaption>
            Cada nível traz o total do recorte. Participação sobre o KM total do período.
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead className="w-80">Local</TableHead>
              <TableHead numeric>KM</TableHead>
              <TableHead numeric>Veículos</TableHead>
              <TableHead numeric>Média/veículo</TableHead>
              <TableHead numeric>Mediana/veículo</TableHead>
              <TableHead numeric>KM/dia</TableHead>
              <TableHead numeric>Cobertura</TableHead>
              <TableHead numeric>Participação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((n) => {
              const open = expanded.has(n.id);
              const hasChildren = n.children.length > 0;
              return (
                <TableRow key={n.id} className={cn(n.level === 1 && "bg-surface-secondary/60 font-medium")}>
                  <TableHead scope="row" className="font-normal">
                    <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: (n.level - 1) * 20 }}>
                      {hasChildren ? (
                        <button
                          type="button"
                          onClick={() => toggle(n.id)}
                          aria-expanded={open}
                          aria-label={`${open ? "Recolher" : "Expandir"} ${LEVEL_LABEL[n.level].toLowerCase()} ${n.label}`}
                          className="inline-flex size-6 shrink-0 items-center justify-center rounded-xs text-fg-muted hfm-transition hfm-focus-ring hover:bg-secondary hover:text-fg"
                        >
                          {open ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
                        </button>
                      ) : (
                        <span aria-hidden className="size-6 shrink-0" />
                      )}
                      <span className={cn("truncate text-fg", n.level === 1 && "font-semibold")} title={n.label}>
                        {n.label}
                      </span>
                      <span className="shrink-0 text-caption text-fg-muted">{LEVEL_LABEL[n.level]}</span>
                    </div>
                  </TableHead>
                  <TableCell numeric>{fmtKm1(n.row.km)}</TableCell>
                  <TableCell numeric>{fmtInt(n.row.vehicles)}</TableCell>
                  <TableCell numeric>{fmtKm1(n.row.avgPerVehicle)}</TableCell>
                  <TableCell numeric>{fmtKm1(n.row.medianPerVehicle)}</TableCell>
                  <TableCell numeric>{fmtKm1(n.row.kmPerDay)}</TableCell>
                  <TableCell numeric>{fmtPct(n.row.coveragePct)}</TableCell>
                  <TableCell numeric>{fmtPct(n.row.sharePct)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  );
}
