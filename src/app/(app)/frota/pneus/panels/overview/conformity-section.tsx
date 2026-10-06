"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, Gauge, Info, ShieldCheck, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import {
  fmt1, fmtInt, fmtPct, issueCode, plural, reasonLabel, type TireConformity, type TireConformityBlock,
} from "@/lib/tires/types";
import type { TiresNavLink } from "../tires-ui";
import { Section } from "../tires-ui";
import type { Nav } from "./shared";

/**
 * Conformidade: os dois indicadores gerais em destaque, os quatro critérios
 * que os compõem e a regra em uma frase. Tudo vem de `tires_overview`
 * (definição única no banco); a tela não recalcula nada.
 */

/** Motivo de não conformidade → filtro da Base geral que lista exatamente esses pneus. */
const REASON_FILTER: Record<string, Record<string, string>> = {
  sulco_abaixo_legal: { sulco: "abaixo_legal" },
  sulco_critico: { sulco: "critico" },
  sulco_sem_medicao: { sulco: "sem_medicao" },
  medicao_vencida: { medicao: "vencido" },
  medicao_sem_registro: { medicao: "sem_registro" },
  calibragem_vencida: { calibragem: "vencido" },
  calibragem_sem_registro: { calibragem: "sem_registro" },
  psi_baixa: { pressao: "baixa" },
  psi_excesso: { pressao: "excesso" },
  psi_sem_parametro: { pressao: "sem_parametro" },
  psi_sem_leitura: { pressao: "sem_calibragem" },
};

export function ConformitySection({ conformity: c, to }: { conformity: TireConformity; to: Nav }) {
  const inUse = (patch: Record<string, string | null>) => to("base", { visao: "fogo", situacao: "em_uso", ...patch });
  const reasons = Object.entries(c.reasons ?? {})
    .map(([code, n]) => ({ code: issueCode(code), n }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n || reasonLabel(a.code).localeCompare(reasonLabel(b.code), "pt-BR"));
  const cal = c.calibrationConformity;

  return (
    <Section
      title="Conformidade"
      testId="tires-conformity-section"
      description={`Base: ${fmtInt(c.base)} ${plural(c.base, "pneu em uso", "pneus em uso")}. Mesma definição nas telas, exportações e indicadores.`}
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <HeadlineCard
          testId="tires-conformity-overall"
          title="Conformidade Geral dos Pneus"
          icon={<ShieldCheck />}
          base={c.base}
          block={c.overall}
          nonconformNav={to("base", { visao: "fogo", conformidade: "nao_conforme" })}
        >
          <div className="flex flex-col gap-1.5">
            <h4 className="text-overline font-semibold tracking-wide text-fg-muted uppercase">Não conformes por nº de falhas</h4>
            <dl className="grid grid-cols-3 gap-2" data-testid="tires-conformity-overall-failures">
              {[
                { key: "1", label: "1 falha", value: c.overall.oneFailure },
                { key: "2", label: "2 falhas", value: c.overall.twoFailures },
                { key: "3", label: "3 ou mais", value: c.overall.threePlusFailures },
              ].map((f) => (
                <div key={f.key} className="flex flex-col gap-0.5 rounded-md bg-surface-secondary px-3 py-2">
                  <dt className="text-caption text-fg-muted">{f.label}</dt>
                  <dd className="text-h4 font-semibold text-fg tabular-nums">{fmtInt(f.value)}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="flex flex-col gap-1">
            <h4 className="text-overline font-semibold tracking-wide text-fg-muted uppercase">
              Motivos <span className="font-normal tracking-normal normal-case">(um pneu pode ter mais de um)</span>
            </h4>
            {reasons.length === 0 ? (
              <p className="text-body-sm text-fg-muted">Nenhum motivo de não conformidade.</p>
            ) : (
              <ul className="-mx-2 flex flex-col" data-testid="tires-conformity-reasons">
                {reasons.map((r) => (
                  <li key={r.code}>
                    <LinkRow
                      nav={REASON_FILTER[r.code] ? inUse(REASON_FILTER[r.code]) : null}
                      testId="tires-conformity-reason"
                      dataKey={r.code}
                      label={reasonLabel(r.code)}
                      value={r.n}
                      destination={`Abrir a Base geral com os pneus em uso — ${reasonLabel(r.code)}`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </HeadlineCard>

        <HeadlineCard
          testId="tires-conformity-calibration"
          title="Conformidade Geral de Calibragem"
          icon={<Gauge />}
          base={c.base}
          block={cal}
          nonconformNav={to("base", { visao: "fogo", conf_calibragem: "nao_conforme" })}
        >
          <div className="flex flex-col gap-1">
            <h4 className="text-overline font-semibold tracking-wide text-fg-muted uppercase">Por que não é conforme</h4>
            <ul className="-mx-2 flex flex-col gap-0.5" data-testid="tires-conformity-calibration-breakdown">
              <li>
                <LinkRow
                  nav={to("calibragem", { sub: "conformidade", pendencia: "prazo_ok_psi_inadequado" })}
                  testId="tires-conformity-on-time-bad-psi"
                  label="No prazo, mas PSI inadequado"
                  hint="calibrada no prazo, pressão fora da faixa"
                  value={cal.onTimeBadPsi}
                  highlight={cal.onTimeBadPsi > 0}
                  destination="Abrir a Aderência de calibragem com os pneus no prazo e PSI inadequado"
                />
              </li>
              <li>
                <LinkRow
                  nav={to("calibragem", { sub: "conformidade", pendencia: "psi_ok_prazo_vencido" })}
                  testId="tires-conformity-late-good-psi"
                  label="PSI ok, prazo vencido"
                  hint="pressão na faixa, calibragem vencida ou sem registro"
                  value={cal.lateGoodPsi}
                  destination="Abrir a Aderência de calibragem com os pneus de PSI ok e prazo vencido"
                />
              </li>
              <li>
                <LinkRow
                  nav={to("calibragem", { sub: "conformidade", pendencia: "prazo_e_psi" })}
                  testId="tires-conformity-late-bad-psi"
                  label="Prazo e PSI fora"
                  hint="calibragem vencida e pressão inadequada"
                  value={cal.lateBadPsi}
                  destination="Abrir a Aderência de calibragem com os pneus de prazo e PSI fora"
                />
              </li>
            </ul>
          </div>
        </HeadlineCard>
      </div>

      <CriteriaStrip conformity={c} to={to} />

      <div className="flex gap-2.5 rounded-md bg-surface-secondary px-3 py-2.5 text-caption text-fg-secondary" data-testid="tires-conformity-method">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-semibold text-fg">Como calculamos</p>
          <p>
            <strong className="font-semibold text-fg">Conformidade Geral dos Pneus</strong> = Sulco OK <b>E</b> Prazo de medição OK <b>E</b> Prazo de
            calibragem OK <b>E</b> PSI OK. Base: pneus em uso; basta um critério falhar para o pneu ser não conforme.
          </p>
          <p>
            <strong className="font-semibold text-fg">Conformidade Geral de Calibragem</strong> = Prazo de calibragem OK <b>E</b> PSI OK: calibragem
            no prazo com pressão inadequada não é conforme.
          </p>
          <p>
            Sulco OK = adequado ou em atenção · Prazo OK = em dia ou próximo do vencimento · PSI OK = dentro da faixa da regra (sem parâmetro ou
            sem leitura não contam como OK).
          </p>
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Cartão de destaque (percentual grande, conformes × não conformes)
// ---------------------------------------------------------------------------
function HeadlineCard({
  testId, title, icon, base, block, nonconformNav, children,
}: {
  testId: string;
  title: string;
  icon: React.ReactNode;
  base: number;
  block: TireConformityBlock;
  nonconformNav: TiresNavLink | null;
  children: React.ReactNode;
}) {
  const headingId = React.useId();
  const pct = block.pct;
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col rounded-lg border border-border bg-surface-raised shadow-card"
      data-testid={testId}
    >
      <header className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 id={headingId} className="text-card-title font-semibold text-fg">{title}</h3>
          <p className="text-caption text-fg-muted">
            Base: {fmtInt(base)} {plural(base, "pneu em uso", "pneus em uso")}
          </p>
        </div>
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-fg [&_svg]:size-[18px]">
          {icon}
        </span>
      </header>

      <div className="flex flex-col gap-4 px-4 pt-3 pb-4">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <p className="flex items-baseline gap-1" data-testid={`${testId}-pct`}>
            <span className="text-kpi-lg font-semibold text-fg tabular-nums">{pct == null ? "—" : fmt1(pct)}</span>
            {pct != null ? <span className="text-h4 font-medium text-fg-muted">%</span> : null}
            <span className="sr-only"> de conformidade</span>
          </p>
          <dl className="flex flex-col gap-1 text-body-sm">
            <div className="flex items-center gap-2">
              <CheckCircle2 aria-hidden className="size-4 shrink-0 text-success" />
              <dt className="sr-only">Conformes</dt>
              <dd className="tabular-nums">
                <span className="font-semibold text-fg" data-testid={`${testId}-ok`}>{fmtInt(block.ok)}</span>{" "}
                <span className="text-fg-secondary">{plural(block.ok, "conforme", "conformes")}</span>
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <XCircle aria-hidden className="size-4 shrink-0 text-danger" />
              <dt className="sr-only">Não conformes</dt>
              <dd className="tabular-nums">
                <span className="font-semibold text-fg" data-testid={`${testId}-nok`}>{fmtInt(block.nok)}</span>{" "}
                <span className="text-fg-secondary">{plural(block.nok, "não conforme", "não conformes")}</span>
              </dd>
            </div>
          </dl>
        </div>
        {base > 0 ? (
          <div aria-hidden className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-surface-sunken">
            <span className="h-full bg-chart-success" style={{ width: `${(block.ok / base) * 100}%` }} />
            <span className="h-full bg-chart-danger" style={{ width: `${(block.nok / base) * 100}%` }} />
          </div>
        ) : null}
        {children}
      </div>

      {nonconformNav && block.nok > 0 ? (
        <footer className="mt-auto border-t border-border-subtle px-4 py-2.5">
          <Button asChild variant="secondary" size="sm">
            <a href={nonconformNav.href} onClick={nonconformNav.onClick} data-testid={`${testId}-nonconform`}>
              Ver não conformes
              <ChevronRight aria-hidden />
              <span className="sr-only"> na Base geral — {title}</span>
            </a>
          </Button>
        </footer>
      ) : null}
    </section>
  );
}

/** Linha "rótulo … valor ›" que leva à lista dos pneus; destaque opcional (tom de atenção + ícone). */
function LinkRow({
  nav, testId, dataKey, label, hint, value, highlight = false, destination,
}: {
  nav: TiresNavLink | null;
  testId: string;
  dataKey?: string;
  label: string;
  hint?: string;
  value: number;
  highlight?: boolean;
  destination: string;
}) {
  const body = (
    <>
      {highlight ? <AlertTriangle aria-hidden className="size-4 shrink-0 text-warning" /> : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn("text-body-sm", highlight ? "font-semibold text-fg" : "text-fg")}>{label}</span>
        {hint ? <span className={cn("text-caption", highlight ? "text-fg-secondary" : "text-fg-muted")}>{hint}</span> : null}
      </span>
      <span className="text-body font-semibold text-fg tabular-nums">{fmtInt(value)}</span>
      {nav ? <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-muted" /> : <span aria-hidden className="w-4 shrink-0" />}
    </>
  );
  const cls = cn(
    "flex items-center gap-2.5 rounded-md px-2 py-1.5",
    highlight && "border border-warning-border bg-warning-soft",
  );
  if (!nav || value === 0) {
    return (
      <div className={cls} data-testid={testId} data-key={dataKey}>
        {body}
      </div>
    );
  }
  return (
    <a
      href={nav.href}
      onClick={nav.onClick}
      className={cn(cls, "hfm-transition hfm-focus-ring hover:bg-hover-overlay")}
      data-testid={testId}
      data-key={dataKey}
    >
      {body}
      <span className="sr-only">. {destination}</span>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Os quatro critérios
// ---------------------------------------------------------------------------
function CriteriaStrip({ conformity: c, to }: { conformity: TireConformity; to: Nav }) {
  const items: { key: string; label: string; block: TireConformityBlock; nav: TiresNavLink | null; destination: string }[] = [
    { key: "tread", label: "Sulco OK", block: c.tread, nav: to("medicao", { sub: "sulco" }), destination: "Abrir a Aderência MM — Sulco" },
    { key: "measurement", label: "Prazo de medição OK", block: c.measurement, nav: to("medicao", { sub: "prazo" }), destination: "Abrir a Aderência MM — Prazo de medição" },
    { key: "calibration", label: "Prazo de calibragem OK", block: c.calibration, nav: to("calibragem", { sub: "prazo" }), destination: "Abrir a Aderência de calibragem — Prazo" },
    { key: "psi", label: "PSI OK", block: c.psi, nav: to("calibragem", { sub: "psi" }), destination: "Abrir a Aderência de calibragem — PSI" },
  ];
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface-raised shadow-card">
      <ul aria-label="Critérios da Conformidade Geral" className="-mt-px -ml-px grid grid-cols-2 md:grid-cols-4" data-testid="tires-conformity-criteria">
        {items.map((it) => {
          const body = (
            <>
              <span className="text-caption text-fg-muted">{it.label}</span>
              <span className="flex items-baseline gap-1">
                <span className="text-h3 font-semibold text-fg tabular-nums">{it.block.pct == null ? "—" : fmt1(it.block.pct)}</span>
                {it.block.pct != null ? <span className="text-body-sm text-fg-muted">%</span> : null}
              </span>
              <span className="text-caption text-fg-muted tabular-nums">
                {fmtInt(it.block.ok)} ok · {fmtInt(it.block.nok)} fora
              </span>
            </>
          );
          const cell = "flex min-w-0 flex-col gap-0.5 px-4 py-3";
          return (
            <li key={it.key} className="min-w-0 shadow-[inset_1px_0_0_var(--border-subtle),inset_0_1px_0_var(--border-subtle)]">
              {it.nav ? (
                <a
                  href={it.nav.href}
                  onClick={it.nav.onClick}
                  className={cn(cell, "h-full hfm-transition hfm-focus-ring hover:bg-hover-overlay")}
                  data-testid={`tires-conformity-criterion-${it.key}`}
                  aria-label={`${it.label}: ${fmtPct(it.block.pct)}, ${fmtInt(it.block.ok)} ok e ${fmtInt(it.block.nok)} fora. ${it.destination}`}
                >
                  {body}
                </a>
              ) : (
                <div className={cell} data-testid={`tires-conformity-criterion-${it.key}`}>
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
