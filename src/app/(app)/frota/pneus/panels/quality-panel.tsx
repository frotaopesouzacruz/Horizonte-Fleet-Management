"use client";

import * as React from "react";
import { Camera, ChevronRight, FileSpreadsheet, ListChecks, ShieldCheck, Upload, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge, StatusDot, type StatusTone } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GaugeChart } from "@/components/charts";
import type { TiresTabData } from "@/lib/tires/loaders";
import {
  BATCH_STATUS_LABEL, BATCH_STATUS_TONE, CHANGE_LABEL, ERROR_ISSUES, fmtInt, fmtPct, formatDate, formatStamp, issueCode, issueLabel,
  plural, STATUS_LABEL, tiresVisibleTabs, type CanonicalStatus, type TireQualityRow, type TiresQuality,
} from "@/lib/tires/types";
import type { TiresPanelContext } from "../shared";
import {
  ExportButton, Fact, FireLink, PanelEmpty, PanelError, PlateLink, Section, TiresKpi, TiresPagination, useTiresLink,
} from "./tires-ui";

/**
 * Gestão de Pneus → Qualidade de dados.
 *
 * `tires_quality` avalia a fotografia mais recente: inconsistências que a
 * importação gravou no pneu (relatório Rodopar), lacunas de cadastro do HFM
 * (regra de PSI, layout de posições), prazos sem registro e pneus ausentes.
 * O problema escolhido vai para a URL (`problema`) e os pneus vêm paginados
 * do banco. A tela não reclassifica nada.
 */
type IssueGroup = "rodopar" | "cadastro" | "prazo" | "presenca";

const GROUP_LABEL: Record<IssueGroup, string> = {
  rodopar: "Relatório Rodopar",
  cadastro: "Cadastro do HFM",
  prazo: "Prazo sem registro",
  presenca: "Presença",
};

const CADASTRO = new Set(["sem_parametro_psi", "posicao_fora_layout", "posicao_layout_vazia"]);
const PRAZO = new Set(["sem_medicao", "sem_calibragem"]);

const groupOf = (code: string): IssueGroup =>
  CADASTRO.has(code) ? "cadastro" : PRAZO.has(code) ? "prazo" : code === "ausente_ultima_importacao" ? "presenca" : "rodopar";

const toneOf = (code: string): StatusTone => {
  if (ERROR_ISSUES.has(code)) return "danger";
  const g = groupOf(code);
  return g === "cadastro" ? "info" : g === "prazo" ? "pending" : "warning";
};

/** O que cada problema significa, em uma linha (regras de `tire_import_*` e `tires_quality`). */
const ISSUE_HELP: Record<string, string> = {
  fogo_ausente: "Linha com dados e sem Nº Fogo: o pneu não pode ser identificado e a linha não é aplicada.",
  fogo_invalido: "Nº Fogo com caracteres fora do padrão (letras, números e . / _ -): a linha não é aplicada.",
  fogo_duplicado: "O mesmo Nº Fogo aparece em mais de uma linha do arquivo: as linhas não são aplicadas.",
  colisao_posicao: "Dois pneus em uso informados na mesma frota e posição: as linhas não são aplicadas.",
  sulco_invalido: "Sulco fora do limite técnico dos parâmetros: o valor foi ignorado e valem os demais sulcos.",
  menor_mm_divergente: "O menor sulco informado no Rodopar difere do menor sulco medido (sulcos 1 a 4) além da tolerância; a saúde usa o menor dos dois.",
  sem_milimetragem: "Pneu em uso sem nenhuma milimetragem válida no relatório.",
  psi_invalido: "Calibragem fora do limite técnico dos parâmetros: o valor foi ignorado.",
  numero_formatado_como_data: "A célula de PSI veio formatada como data no Rodopar; o número foi recuperado, mas a origem precisa de correção.",
  data_invalida: "Data de medição, calibragem, compra, cadastro ou alteração ilegível: a data foi ignorada.",
  data_futura: "Data posterior à fotografia (além da tolerância): a data foi ignorada.",
  km_rodado_invalido: "KM Rodado negativo ou ilegível no relatório: o valor foi ignorado.",
  km_real_negativo: "KM Real negativo no relatório Rodopar: problema de qualidade da origem, guardado só como diagnóstico.",
  vida_invalida: "Nº da vida ilegível no relatório: o valor foi ignorado.",
  situacao_nao_reconhecida: "Situação do Rodopar sem correspondência: o pneu foi classificado como Outro.",
  em_uso_sem_frota: "Pneu em uso sem frota informada no relatório.",
  em_uso_sem_posicao: "Pneu em uso com frota, mas sem posição informada.",
  fora_de_uso_com_frota: "Pneu em estoque, ressolagem ou descarte com frota ou posição preenchida.",
  posicao_desconhecida: "Código de posição que não existe no dicionário de posições (Parâmetros).",
  frota_nao_encontrada: "A frota do relatório não existe no Cadastro de Frotas do HFM: o pneu fica sem veículo.",
  vida_regrediu: "O nº da vida ficou menor que o da fotografia anterior do pneu.",
  reativado_apos_baixa: "O pneu estava descartado ou baixado e voltou em uso ou em estoque.",
  sem_data_medicao: "Pneu em uso sem data de medição no relatório.",
  sem_data_calibragem: "Pneu em uso sem data de calibragem no relatório.",
  sem_medicao: "Pneu em uso sem data de medição de sulco: o prazo fica “Sem registro”.",
  sem_calibragem: "Pneu em uso sem data de calibragem: o prazo fica “Sem registro”.",
  sem_parametro_psi: "Pneu em uso sem regra de PSI aplicável (tipo, dimensão e posição): a pressão fica “Sem parâmetro”, nunca adequada.",
  posicao_fora_layout: "Posição do pneu que não existe no layout do veículo (cadastro do veículo ou do tipo de equipamento).",
  posicao_layout_vazia: "Posição prevista no layout do veículo sem nenhum pneu em uso nesta fotografia.",
  ausente_ultima_importacao: "Pneu que estava na fotografia anterior e não veio no último relatório Rodopar.",
};
const issueHelp = (code: string) => ISSUE_HELP[code] ?? ISSUE_HELP[issueCode(code)] ?? null;

/** Quando a contagem não é "N pneus": posições vazias do layout ou mais de uma ocorrência por pneu. */
function issueExtra(i: { code: string; count: number; tires: number }): string | null {
  if (i.code === "posicao_layout_vazia") return `${plural(i.count, "posição vazia", "posições vazias")}`;
  if (i.tires > 0 && i.tires !== i.count) return `ocorrências em ${fmtInt(i.tires)} ${plural(i.tires, "pneu", "pneus")}`;
  return null;
}

/** "4 pneus", "4 posições vazias", "6 ocorrências em 4 pneus". */
function issueAmount(i: { code: string; count: number; tires: number }): string {
  if (i.code === "posicao_layout_vazia") return `${fmtInt(i.count)} ${plural(i.count, "posição vazia", "posições vazias")}`;
  if (i.tires > 0 && i.tires !== i.count) return `${fmtInt(i.count)} ocorrências em ${fmtInt(i.tires)} ${plural(i.tires, "pneu", "pneus")}`;
  return `${fmtInt(i.count)} ${plural(i.count, "pneu", "pneus")}`;
}

/** aaaa-mm-ddThh:mm[:ss] sem fuso → "dd/mm/aaaa hh:mm", sem passar por Date. */
const localStamp = (v: string | null | undefined) => {
  if (!v) return "—";
  const m = v.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  return m ? `${formatDate(m[1])} ${m[2]}` : formatDate(v);
};

export function QualityPanel({ data, ctx }: { data: TiresTabData["qualidade"] | null; ctx: TiresPanelContext }) {
  const link = useTiresLink(ctx);
  if (ctx.error) return <PanelError ctx={ctx} title="Não foi possível carregar a qualidade de dados dos pneus." testId="tires-qualidade-error" />;
  if (!data) {
    return (
      <PanelEmpty
        icon={<ShieldCheck />}
        title="Sem dados de qualidade"
        description="A leitura da qualidade de dados não trouxe resultado. Recarregue a página."
        testId="tires-qualidade-empty"
      />
    );
  }
  if (data.empty) {
    const importNav = ctx.perms.import ? link({ aba: "importacao", problema: null }) : null;
    return (
      <PanelEmpty
        icon={<Camera />}
        title="Nenhuma fotografia oficial de pneus"
        description="A qualidade de dados avalia a última fotografia confirmada do relatório Rodopar 10. Ainda não há nenhuma."
        testId="tires-qualidade-empty"
        action={
          importNav ? (
            <Button asChild size="sm" variant="primary">
              <a href={importNav.href} onClick={importNav.onClick} data-testid="tires-qualidade-import">
                <Upload aria-hidden />
                Importação Rodopar
              </a>
            </Button>
          ) : undefined
        }
      />
    );
  }
  return <QualityContent data={data} ctx={ctx} link={link} />;
}

function QualityContent({ data, ctx, link }: { data: TiresQuality; ctx: TiresPanelContext; link: ReturnType<typeof useTiresLink> }) {
  const visible = new Set(tiresVisibleTabs(ctx.perms));
  const selected = data.issue ?? ctx.params.problema ?? null;
  const photoIgnored = Boolean(ctx.filters.reference && ctx.filters.reference !== data.referenceDate);
  const flagged = visible.has("base") ? link({ aba: "base", visao: "fogo", qualidade: "1", problema: null }) : null;

  return (
    <div className="flex flex-col gap-6" data-testid="tires-qualidade">
      <p className="text-body-sm text-fg-muted" data-testid="tires-qualidade-period">
        Fotografia mais recente, de <span className="font-medium text-fg-secondary tabular-nums">{formatDate(data.referenceDate)}</span> · prazos
        contados até <span className="tabular-nums">{formatDate(data.asOf)}</span>
        {photoIgnored ? " · a Qualidade avalia sempre a última fotografia; o seletor de fotografia não se aplica aqui" : ""}.
      </p>

      {/* -------------------------------------------------------------- Índice */}
      <section
        aria-labelledby="tires-qualidade-score-title"
        className="grid gap-5 rounded-lg border border-border bg-surface-raised p-4 shadow-card md:grid-cols-[minmax(12rem,15rem)_minmax(0,1fr)]"
        data-testid="tires-qualidade-score"
      >
        <div className="flex flex-col items-center gap-2 md:items-start">
          <h2 id="tires-qualidade-score-title" className="flex items-center gap-2 self-start text-label font-semibold text-fg-secondary">
            <ShieldCheck className="size-4 text-fg-muted" aria-hidden />
            Índice de qualidade
          </h2>
          <GaugeChart
            value={data.qualityScore}
            label="sem inconsistência"
            size={176}
            ariaLabel="Índice de qualidade dos dados de pneus"
            className="self-center"
            data-testid="tires-qualidade-score-value"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TiresKpi kpi="qualidade-total" label="Pneus na fotografia" value={fmtInt(data.totalTires)} icon={<ListChecks />} status="primary" period="dentro dos filtros da tela" />
            <TiresKpi
              kpi="qualidade-inconsistentes"
              label="Com inconsistência no relatório"
              value={fmtInt(data.tiresWithRodoparIssue)}
              icon={<FileSpreadsheet />}
              status={data.tiresWithRodoparIssue > 0 ? "warning" : "success"}
              period={data.totalTires > 0 ? `${fmtPct((100 * data.tiresWithRodoparIssue) / data.totalTires)} dos pneus` : undefined}
              nav={flagged}
              destination="Abrir a Base geral só com os pneus com inconsistência"
            />
          </div>
          <p className="text-caption text-fg-muted">
            Índice = pneus sem nenhuma inconsistência gravada pela importação ÷ pneus da fotografia. Entram só os problemas do{" "}
            <strong className="font-semibold text-fg-secondary">relatório Rodopar</strong> — a correção é na origem e chega na próxima importação. Lacunas
            de cadastro do HFM (regra de PSI, layout de posições), prazos sem registro e pneus ausentes aparecem na lista para correção, mas não
            mexem no índice.
          </p>
        </div>
      </section>

      <Problems data={data} ctx={ctx} link={link} selected={selected} />

      <LastBatch data={data} link={link} canOpen={visible.has("importacao")} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Problemas e pneus do problema escolhido
// ---------------------------------------------------------------------------
function Problems({
  data, ctx, link, selected,
}: {
  data: TiresQuality;
  ctx: TiresPanelContext;
  link: ReturnType<typeof useTiresLink>;
  selected: string | null;
}) {
  const detailRef = React.useRef<HTMLElement>(null);
  const shown = React.useRef(selected);
  React.useEffect(() => {
    // No celular a lista fica acima da tabela: ao trocar de problema, leva a tabela à vista
    // (só na troca — abrir um link com o problema já escolhido não rola a página).
    if (shown.current === selected) return;
    shown.current = selected;
    const el = detailRef.current;
    if (!el || !selected) return;
    const top = el.getBoundingClientRect().top;
    if (top > window.innerHeight * 0.6 || top < 0) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    }
  }, [selected]);

  if (data.issues.length === 0) {
    return (
      <Section title="Problemas encontrados" testId="tires-qualidade-issues">
        <PanelEmpty
          icon={<ShieldCheck />}
          title="Nenhum problema na fotografia"
          description="Nenhuma inconsistência do relatório, lacuna de cadastro, prazo sem registro ou pneu ausente neste recorte."
          testId="tires-qualidade-issues-empty"
        />
      </Section>
    );
  }

  const current = selected ? data.issues.find((i) => i.code === selected) ?? null : null;
  const clear = link({ problema: null });

  return (
    <Section
      title="Problemas encontrados"
      testId="tires-qualidade-issues"
      description="Escolha um problema para ver os pneus afetados. A contagem é da fotografia mais recente, dentro dos filtros da tela."
      actions={<ExportButton ctx={ctx} kind="qualidade" extra={{ problema: selected }} label={selected ? "Exportar problema (XLSX)" : "Exportar XLSX"} />}
    >
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <nav aria-label="Problemas encontrados" className="min-w-0">
          <ul className="flex flex-col gap-2" data-testid="tires-qualidade-issue-list">
            {data.issues.map((i) => {
              const nav = link({ problema: i.code });
              const active = i.code === selected;
              const help = issueHelp(i.code);
              const group = groupOf(i.code);
              return (
                <li key={i.code}>
                  <a
                    href={nav.href}
                    onClick={nav.onClick}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border bg-surface-raised px-3 py-2.5 shadow-xs hfm-transition hfm-focus-ring",
                      active
                        ? "border-primary/50 bg-selected-overlay shadow-[inset_3px_0_0_var(--primary)]"
                        : "border-border hover:border-border-strong hover:bg-surface-hover",
                    )}
                    data-testid="tires-qualidade-issue"
                    data-code={i.code}
                  >
                    <StatusDot status={toneOf(i.code)} className="mt-1.5" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-body-sm font-semibold text-fg">{issueLabel(i.code)}</span>
                      {help ? <span className="text-caption text-fg-muted">{help}</span> : null}
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge size="sm" variant={group === "rodopar" ? (ERROR_ISSUES.has(i.code) ? "danger" : "warning") : group === "cadastro" ? "info" : "neutral"} appearance="outline">
                          {GROUP_LABEL[group]}
                        </Badge>
                        {issueExtra(i) ? <span className="text-caption text-fg-muted tabular-nums">{issueExtra(i)}</span> : null}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 self-center">
                      <span className="text-body font-semibold text-fg tabular-nums">
                        {fmtInt(i.count)}
                        <span className="sr-only"> {i.code === "posicao_layout_vazia" ? "ocorrências" : plural(i.count, "pneu", "pneus")}</span>
                      </span>
                      <ChevronRight aria-hidden className={cn("size-4", active ? "text-primary" : "text-fg-muted")} />
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        <section
          ref={detailRef}
          aria-labelledby="tires-qualidade-detail-title"
          className={cn("flex min-w-0 scroll-mt-4 flex-col gap-3", !selected && "xl:sticky xl:top-4")}
          data-testid="tires-qualidade-detail"
        >
          {selected ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-surface-raised px-4 py-3 shadow-card sm:flex-nowrap">
                <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1 sm:basis-auto">
                  <h3 id="tires-qualidade-detail-title" className="flex flex-wrap items-center gap-2 text-card-title font-semibold text-fg">
                    {issueLabel(selected)}
                    <StatusBadge status={toneOf(selected)} size="sm">{GROUP_LABEL[groupOf(selected)]}</StatusBadge>
                  </h3>
                  {issueHelp(selected) ? <p className="text-body-sm text-fg-secondary">{issueHelp(selected)}</p> : null}
                  <p className="text-caption text-fg-muted tabular-nums">
                    {current ? issueAmount(current) : "Sem ocorrências na fotografia"} · {fmtInt(data.issueTotal)}{" "}
                    {plural(data.issueTotal, "linha", "linhas")} na lista
                  </p>
                </div>
                <Button asChild size="sm" variant="ghost" className="shrink-0">
                  <a href={clear.href} onClick={clear.onClick} data-testid="tires-qualidade-clear">
                    <X aria-hidden />
                    Limpar seleção
                  </a>
                </Button>
              </div>
              <IssueRows data={data} ctx={ctx} code={selected} />
              <TiresPagination ctx={ctx} total={data.issueTotal} limit={data.limit} label="pneus" testId="tires-qualidade-pagination" />
            </>
          ) : (
            <EmptyState
              variant="panel"
              size="sm"
              icon={<ListChecks />}
              title={<span id="tires-qualidade-detail-title">Escolha um problema</span>}
              description="Os pneus afetados aparecem aqui, com placa, posição e o detalhe que a rotina registrou."
              data-testid="tires-qualidade-detail-empty"
            />
          )}
        </section>
      </div>
    </Section>
  );
}

function IssueRows({ data, ctx, code }: { data: TiresQuality; ctx: TiresPanelContext; code: string }) {
  const positionLabel = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const p of ctx.options?.positions ?? []) m.set(p.code, p.label);
    return m;
  }, [ctx.options]);
  return (
    <TableContainer>
      <Table className={data.rows.length ? "min-w-[640px]" : undefined} data-testid="tires-qualidade-rows">
        <TableHeader>
          <TableRow>
            <TableHead className="w-28">Nº Fogo</TableHead>
            <TableHead className="w-44">Veículo</TableHead>
            <TableHead className="w-48">Posição</TableHead>
            <TableHead>Detalhe</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.length === 0 ? (
            <TableEmpty colSpan={4} message="Nenhum pneu com este problema na fotografia e nos filtros atuais." />
          ) : (
            data.rows.map((r, idx) => (
              <TableRow key={`${r.tireId ?? r.vehicleId ?? "x"}-${r.positionCode ?? ""}-${idx}`} className="h-auto" data-testid="tires-qualidade-row">
                <TableCell className="py-2.5">
                  {r.tireId || r.fireNumber ? (
                    <FireLink tireId={r.tireId} fireNumber={r.fireNumber} testId="tires-qualidade-fire" />
                  ) : (
                    <span className="text-fg-muted">Sem pneu</span>
                  )}
                </TableCell>
                <TableCell className="py-2.5">
                  {r.vehicleId || r.licensePlate || r.fleetNumber ? (
                    <PlateLink vehicleId={r.vehicleId} plate={r.licensePlate} fleetCode={r.fleetNumber} testId="tires-qualidade-plate" />
                  ) : (
                    <span className="text-fg-muted">Sem veículo</span>
                  )}
                </TableCell>
                <TableCell className="py-2.5">
                  {r.positionCode ? (
                    <span className="flex flex-col leading-tight">
                      <span className="text-fg">{positionLabel.get(r.positionCode) ?? r.positionCode}</span>
                      {positionLabel.has(r.positionCode) && positionLabel.get(r.positionCode) !== r.positionCode ? (
                        <span className="text-caption text-fg-muted tabular-nums">{r.positionCode}</span>
                      ) : null}
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="py-2.5 text-fg-secondary">{detailOf(r, code)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/** O detalhe vem cru da rotina; aqui só ganha o rótulo do que ele é. */
function detailOf(r: TireQualityRow, code: string): string {
  const d = r.detail;
  if (!d) return "—";
  switch (r.code || code) {
    case "ausente_ultima_importacao":
      return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `Ausente desde ${formatDate(d)}` : d;
    case "sem_parametro_psi":
      return `Dimensão ${d}`;
    case "posicao_fora_layout":
      return `Posições do layout: ${d}`;
    default:
      return d;
  }
}

// ---------------------------------------------------------------------------
// Último lote de importação
// ---------------------------------------------------------------------------
function LastBatch({ data, link, canOpen }: { data: TiresQuality; link: ReturnType<typeof useTiresLink>; canOpen: boolean }) {
  const b = data.lastBatch;
  if (!b) {
    return (
      <Section title="Último lote de importação" testId="tires-qualidade-batch">
        <p className="text-body-sm text-fg-muted">Nenhum lote validado, bloqueado ou confirmado ainda.</p>
      </Section>
    );
  }
  const c = b.counters ?? {};
  const nav = canOpen ? link({ aba: "importacao", lote: b.id, problema: null }) : null;
  const issues = Object.entries(c.issues ?? {}).sort((x, y) => y[1] - x[1]);
  const statuses = Object.entries(c.status ?? {}).sort((x, y) => y[1] - x[1]);
  const changes = Object.entries(c.changes ?? {}).sort((x, y) => y[1] - x[1]);
  const blockReasons = c.blockReasons ?? [];
  const isCurrent = b.status === "confirmed" && b.referenceDate === data.referenceDate;

  return (
    <Section
      title="Último lote de importação"
      testId="tires-qualidade-batch"
      description="O lote mais recente que passou pela validação — confirmado ou não. Linhas com erro nunca são aplicadas; avisos são aplicados e ficam gravados no pneu."
      actions={
        nav ? (
          <Button asChild size="sm" variant="secondary">
            <a href={nav.href} onClick={nav.onClick} data-testid="tires-qualidade-batch-open">
              Abrir na Importação Rodopar
              <ChevronRight aria-hidden />
            </a>
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface-raised p-4 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-body font-semibold text-fg [overflow-wrap:anywhere]" data-testid="tires-qualidade-batch-file">{b.fileName}</p>
            <p className="text-caption text-fg-muted">
              Data de referência <span className="tabular-nums">{formatDate(b.referenceDate)}</span> · recebido em{" "}
              <span className="tabular-nums">{formatStamp(b.createdAt)}</span>
            </p>
          </div>
          <StatusBadge status={BATCH_STATUS_TONE[b.status]} withIcon data-testid="tires-qualidade-batch-status">
            {BATCH_STATUS_LABEL[b.status]}
          </StatusBadge>
        </div>

        {b.status === "blocked" ? (
          <Alert variant="danger" data-testid="tires-qualidade-batch-blocked">
            <AlertTitle>Importação bloqueada</AlertTitle>
            <AlertDescription>
              {blockReasons.length > 1 ? (
                <ul className="list-disc pl-4">
                  {blockReasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              ) : (
                b.blockReason ?? blockReasons[0] ?? "Motivo não registrado."
              )}
            </AlertDescription>
          </Alert>
        ) : b.status === "validated" ? (
          <Alert variant="info" data-testid="tires-qualidade-batch-pending">
            <AlertDescription>
              Lote validado, aguardando confirmação: ainda não é fotografia oficial. Os números desta aba são da fotografia de{" "}
              {formatDate(data.referenceDate)}.
            </AlertDescription>
          </Alert>
        ) : isCurrent ? (
          <p className="text-caption text-fg-muted">É a fotografia avaliada nesta aba.</p>
        ) : null}

        {c.missingColumns && c.missingColumns.length > 0 ? (
          <Alert variant="warning">
            <AlertDescription>Colunas oficiais não reconhecidas no arquivo: {c.missingColumns.join(", ")}.</AlertDescription>
          </Alert>
        ) : null}
        {c.referenceBeforeLastChange ? (
          <Alert variant="warning">
            <AlertDescription>
              Há alterações no Rodopar ({localStamp(c.maxUpdatedAt)}) posteriores à data de referência do lote: a fotografia pode não refletir essas mudanças.
            </AlertDescription>
          </Alert>
        ) : null}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="tires-qualidade-batch-facts">
          <Fact label="Linhas no arquivo"><span className="font-semibold tabular-nums">{fmtInt(b.totalRows)}</span></Fact>
          <Fact label="Linhas com erro">
            <span className={cn("font-semibold tabular-nums", b.errorRows > 0 && "text-danger-soft-fg")}>{fmtInt(b.errorRows)}</span>
            {b.errorRows > 0 ? <span className="text-caption text-fg-muted"> · não aplicadas</span> : null}
          </Fact>
          <Fact label="Linhas com aviso"><span className="font-semibold tabular-nums">{fmtInt(b.warningRows)}</span></Fact>
          <Fact label="Frotas no arquivo"><span className="tabular-nums">{fmtInt(c.fleetsInFile ?? null)}</span></Fact>
          <Fact label="Frotas não encontradas">
            <span className={cn("tabular-nums", (c.fleetsNotFound ?? 0) > 0 && "font-semibold text-warning-soft-fg")}>{fmtInt(c.fleetsNotFound ?? null)}</span>
          </Fact>
          <Fact label="Última alteração no Rodopar"><span className="tabular-nums">{localStamp(c.maxUpdatedAt)}</span></Fact>
        </dl>

        <div className="grid grid-cols-1 gap-4 border-t border-border-subtle pt-4 md:grid-cols-3">
          <CounterList
            title="Avisos e erros por tipo"
            empty="Nenhum aviso ou erro."
            testId="tires-qualidade-batch-issues"
            items={issues.map(([code, n]) => ({
              key: code,
              label: issueLabel(code),
              value: n,
              tone: ERROR_ISSUES.has(issueCode(code)) ? "danger" : "warning",
            }))}
          />
          <CounterList
            title="Situação no arquivo"
            empty="Sem contagem por situação."
            testId="tires-qualidade-batch-status-counts"
            items={statuses.map(([code, n]) => ({ key: code, label: STATUS_LABEL[issueCode(code) as CanonicalStatus] ?? code, value: n }))}
          />
          <CounterList
            title="Mudanças desde a fotografia anterior"
            empty="Nenhuma mudança apontada."
            testId="tires-qualidade-batch-changes"
            items={changes.map(([code, n]) => ({ key: code, label: CHANGE_LABEL[code] ?? CHANGE_LABEL[issueCode(code)] ?? code, value: n }))}
          />
        </div>
      </div>
    </Section>
  );
}

function CounterList({
  title, empty, items, testId,
}: {
  title: string;
  empty: string;
  items: { key: string; label: string; value: number; tone?: StatusTone }[];
  testId: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid={testId}>
      <h3 className="text-caption font-semibold tracking-wide text-fg-muted uppercase">{title}</h3>
      {items.length === 0 ? (
        <p className="text-body-sm text-fg-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((i) => (
            <li key={i.key} className="flex items-center gap-2 text-body-sm">
              {i.tone ? <StatusDot status={i.tone} /> : null}
              <span className="min-w-0 flex-1 text-fg-secondary">{i.label}</span>
              <span className="font-semibold text-fg tabular-nums">{fmtInt(i.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
