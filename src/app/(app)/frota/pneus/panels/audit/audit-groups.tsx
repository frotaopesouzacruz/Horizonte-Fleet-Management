"use client";

import * as React from "react";
import { Layers } from "lucide-react";
import { cn } from "@/lib/cn";
import { StatusDot } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/governance/selects";
import {
  AUDIT_SEVERITY_LABEL,
  AUDIT_SEVERITY_TONE,
  GROUP_BY_PARAM,
  fmtInt,
  type AuditGroupBy,
  type TiresAuditCenter,
} from "@/lib/tires/types";
import type { TiresPanelContext } from "../../shared";
import { chartColorOf, PanelEmpty, Section, useTiresLink, type TiresNavLink } from "../tires-ui";
import {
  AUDIT_GROUP_LABEL, AUDIT_GROUPS, AUDIT_SEVERITIES, categoryLabel, groupLabel, isCategory, isSeverity, SeverityBadge, TID,
} from "./audit-common";

type Group = TiresAuditCenter["groups"][number];

/**
 * Onde estão as inconsistências abertas: por regra, categoria, gravidade,
 * operação, local de operação ou liderança (`?agrupar=`). O clique aplica o
 * filtro correspondente — regra, categoria e gravidade filtram a lista de
 * achados; operação, local e liderança viram filtros globais da tela.
 */
export function AuditGroups({ data, ctx }: { data: TiresAuditCenter; ctx: TiresPanelContext }) {
  const link = useTiresLink(ctx);
  const groupBy = data.groupBy;
  const ruleOf = React.useMemo(() => new Map(data.rules.map((r) => [r.code, r])), [data.rules]);
  const max = Math.max(1, ...data.groups.map((g) => g.findings));

  const isActive = (g: Group) =>
    (groupBy === "rule" && data.filters.rule === g.key) ||
    (groupBy === "category" && data.filters.category === g.key) ||
    (groupBy === "severity" && data.filters.severity === g.key) ||
    (groupBy === "operation" && ctx.filters.operation === g.key) ||
    (groupBy === "city" && ctx.filters.city === g.key) ||
    (groupBy === "leader" && ctx.filters.leader === g.key);

  const what = AUDIT_GROUP_LABEL[groupBy].toLowerCase();
  const hint =
    groupBy === "rule" || groupBy === "category" || groupBy === "severity"
      ? `Clique numa linha para filtrar a lista de achados por ${what}; clique de novo para limpar.`
      : `Clique numa linha para aplicar o filtro global de ${what} (vale para as outras abas também).`;

  return (
    <Section
      title={`Inconsistências abertas por ${what}`}
      description={`Contagem dos achados abertos com os filtros globais${data.filters.category || data.filters.severity ? ", a categoria e a gravidade escolhidas" : ""}. ${hint}`}
      testId={`${TID}-groups`}
      actions={
        <label className="flex items-center gap-2">
          <span className="text-caption font-medium whitespace-nowrap text-fg-secondary">Agrupar por</span>
          <NativeSelect
            fieldSize="sm"
            value={groupBy}
            disabled={ctx.pending}
            onChange={(e) => ctx.navigate({ agrupar: e.target.value === "rule" ? null : e.target.value, pagina: null })}
            className="min-w-[11rem]"
            data-testid={`${TID}-groupby`}
          >
            {AUDIT_GROUPS.map((g) => (
              <option key={g} value={g}>
                {AUDIT_GROUP_LABEL[g]}
              </option>
            ))}
          </NativeSelect>
        </label>
      }
    >
      {data.groups.length === 0 ? (
        <PanelEmpty
          icon={<Layers />}
          title="Nenhuma inconsistência aberta neste recorte"
          description="Com os filtros aplicados, a última varredura não deixou achados abertos."
          testId={`${TID}-groups-empty`}
        />
      ) : (
        <TableContainer stickyHeader maxHeight={440} data-testid={`${TID}-groups-table`} data-group-by={groupBy}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[14rem]">{AUDIT_GROUP_LABEL[groupBy]}</TableHead>
                {groupBy === "rule" ? <TableHead>Categoria · gravidade</TableHead> : null}
                <TableHead numeric>Achados</TableHead>
                <TableHead numeric>Registros</TableHead>
                {AUDIT_SEVERITIES.map((s) => (
                  <TableHead key={s} numeric>
                    <span className="inline-flex items-center gap-1.5">
                      <StatusDot status={AUDIT_SEVERITY_TONE[s]} />
                      {AUDIT_SEVERITY_LABEL[s]}
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.groups.map((g) => {
                const active = isActive(g);
                const patch = patchOf(groupBy, g, active);
                const nav: TiresNavLink | null = patch ? link(patch) : null;
                const rule = groupBy === "rule" ? ruleOf.get(g.key) : undefined;
                const name = groupLabel(groupBy, g);
                return (
                  <TableRow
                    key={g.key}
                    selected={active}
                    className={cn("align-top", nav && "cursor-pointer")}
                    onClick={patch ? () => ctx.navigate({ pagina: null, ...patch }) : undefined}
                    data-testid={`${TID}-group`}
                    data-key={g.key}
                  >
                    <TableCell className="py-2">
                      <span className="flex min-w-0 items-center gap-2">
                        {nav ? (
                          <a
                            href={nav.href}
                            onClick={(e) => {
                              e.stopPropagation();
                              nav.onClick?.(e);
                            }}
                            aria-current={active ? "true" : undefined}
                            className="min-w-0 rounded-xs font-medium text-fg underline-offset-2 hover:text-primary hover:underline hfm-focus-ring"
                          >
                            {groupBy === "severity" && isSeverity(g.key) ? <SeverityBadge severity={g.key} /> : name}
                            <span className="sr-only">{active ? " — filtro aplicado; clique para limpar" : " — filtrar"}</span>
                          </a>
                        ) : (
                          <span className="min-w-0 font-medium text-fg">
                            {name}
                            {g.key === "—" ? (
                              <span className="block text-caption font-normal text-fg-muted">cadastro ausente — sem filtro global para este grupo</span>
                            ) : null}
                          </span>
                        )}
                      </span>
                      <span aria-hidden className="mt-1.5 block h-1 max-w-[14rem] overflow-hidden rounded-full bg-surface-sunken">
                        <span className="flex h-full" style={{ width: `${(100 * g.findings) / max}%` }}>
                          {AUDIT_SEVERITIES.map((s) =>
                            g[s] > 0 ? (
                              <span key={s} className="h-full" style={{ width: `${(100 * g[s]) / g.findings}%`, backgroundColor: chartColorOf(AUDIT_SEVERITY_TONE[s]) }} />
                            ) : null,
                          )}
                        </span>
                      </span>
                    </TableCell>
                    {groupBy === "rule" ? (
                      <TableCell className="py-2 whitespace-nowrap">
                        {rule ? (
                          <span className="flex flex-col items-start gap-1">
                            <span className="text-caption text-fg-secondary">{categoryLabel(rule.category)}</span>
                            <SeverityBadge severity={rule.severity} />
                          </span>
                        ) : (
                          <span className="text-fg-muted">—</span>
                        )}
                      </TableCell>
                    ) : null}
                    <TableCell numeric className="py-2 font-semibold">{fmtInt(g.findings)}</TableCell>
                    <TableCell numeric className="py-2">{fmtInt(g.records)}</TableCell>
                    {AUDIT_SEVERITIES.map((s) => (
                      <TableCell key={s} numeric className={cn("py-2", g[s] === 0 && "text-fg-muted")}>
                        {fmtInt(g[s])}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Section>
  );
}

/**
 * O filtro que a linha aplica (o clique na linha inteira repete o link). Um
 * filtro da lista já aplicado é limpo no segundo clique. "—" (sem operação,
 * local ou liderança) não tem filtro global equivalente nesta aba.
 */
function patchOf(groupBy: AuditGroupBy, g: Group, active: boolean): Record<string, string | null> | null {
  switch (groupBy) {
    case "rule":
      return { regra: active ? null : g.key };
    case "category":
      return isCategory(g.key) ? { categoria: active ? null : g.key } : null;
    case "severity":
      return isSeverity(g.key) ? { gravidade: active ? null : g.key } : null;
    default:
      return g.key === "—" ? null : { [GROUP_BY_PARAM[groupBy]]: g.key };
  }
}
