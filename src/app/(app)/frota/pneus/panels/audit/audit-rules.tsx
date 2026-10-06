"use client";

import * as React from "react";
import { BookOpen, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { fmtInt, plural, type TireAuditRule } from "@/lib/tires/types";
import type { TiresPanelContext } from "../../shared";
import { useTiresLink } from "../tires-ui";
import { AUDIT_CATEGORIES, categoryLabel, SeverityBadge, TID } from "./audit-common";

/**
 * Catálogo das regras da auditoria (o que cada uma confere, em que campo, o
 * valor esperado e a gravidade), numa gaveta. As regras moram no banco
 * (`tire_audit_rules`); a tela só lista. "Ver os achados" aplica a regra na
 * lista (`?regra=`).
 */
export function AuditRules({ rules, ctx, activeRule }: { rules: TireAuditRule[]; ctx: TiresPanelContext; activeRule: string | null }) {
  const [open, setOpen] = React.useState(false);
  const link = useTiresLink(ctx);
  const byCategory = AUDIT_CATEGORIES.map((c) => ({ category: c, rules: rules.filter((r) => r.category === c) })).filter((g) => g.rules.length);
  const other = rules.filter((r) => !AUDIT_CATEGORIES.includes(r.category));
  if (other.length) byCategory.push({ category: other[0].category, rules: other });

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <Button variant="secondary" size="sm" leadingIcon={<BookOpen />} onClick={() => setOpen(true)} data-testid={`${TID}-rules`}>
        Regras da auditoria
        <span className="text-caption font-normal text-fg-muted tabular-nums">({fmtInt(rules.length)})</span>
      </Button>
      <DrawerContent size="lg" data-testid={`${TID}-rules-drawer`}>
        <DrawerHeader>
          <DrawerTitle>Regras da auditoria</DrawerTitle>
          <DrawerDescription>
            O que cada regra confere nos dados de pneus, o campo, o valor esperado e a gravidade. A auditoria só aponta: a correção é feita na origem
            (planilha/Rodopar, Cadastro de Frotas ou Parâmetros) e a próxima varredura resolve o achado.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody className="flex flex-col gap-5">
          {byCategory.length === 0 ? (
            <p className="text-body-sm text-fg-muted">Nenhuma regra ativa.</p>
          ) : (
            byCategory.map((g) => (
              <section key={g.category} aria-labelledby={`${TID}-rules-${g.category}`} className="flex flex-col gap-2">
                <h3 id={`${TID}-rules-${g.category}`} className="text-label font-semibold text-fg">
                  {categoryLabel(g.category)}
                  <span className="ml-1.5 text-caption font-normal text-fg-muted tabular-nums">
                    {fmtInt(g.rules.length)} {plural(g.rules.length, "regra", "regras")}
                  </span>
                </h3>
                <ul className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border bg-surface-raised">
                  {g.rules.map((r) => {
                    const nav = link({ regra: r.code, categoria: null, gravidade: null, achado: null });
                    return (
                      <li
                        key={r.code}
                        className="flex flex-col gap-1.5 px-3 py-2.5"
                        data-testid={`${TID}-rule`}
                        data-code={r.code}
                        aria-current={activeRule === r.code ? "true" : undefined}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="min-w-0 text-body-sm font-semibold text-fg">{r.title}</span>
                          <SeverityBadge severity={r.severity} />
                          {activeRule === r.code ? (
                            <Badge variant="primary" size="sm">Aplicada na lista</Badge>
                          ) : null}
                        </div>
                        <p className="text-caption leading-relaxed text-fg-secondary">{r.description}</p>
                        <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-caption">
                          <div className="flex gap-1">
                            <dt className="text-fg-muted">Campo:</dt>
                            <dd className="text-fg">{r.field ?? "—"}</dd>
                          </div>
                          <div className="flex gap-1">
                            <dt className="text-fg-muted">Esperado:</dt>
                            <dd className="text-fg">{r.expected ?? "—"}</dd>
                          </div>
                        </dl>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-caption text-fg-muted tabular-nums">
                            {r.open > 0
                              ? `${fmtInt(r.open)} ${plural(r.open, "achado aberto", "achados abertos")}`
                              : "Nenhum achado aberto"}
                          </span>
                          {r.open > 0 ? (
                            <a
                              href={nav.href}
                              onClick={(e) => {
                                nav.onClick?.(e);
                                if (e.defaultPrevented) setOpen(false);
                              }}
                              className="inline-flex items-center gap-1 rounded-xs text-caption font-medium text-link underline-offset-2 hover:underline hfm-focus-ring"
                            >
                              Ver os achados
                              <span className="sr-only"> da regra {r.title}</span>
                              <ChevronRight className="size-3.5" aria-hidden />
                            </a>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
