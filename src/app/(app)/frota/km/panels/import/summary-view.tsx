"use client";

import * as React from "react";
import { AlertTriangle, CalendarRange, Car, FileSpreadsheet, Gauge, Rows3 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { HBarChart, type HBarDatum } from "@/components/charts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/ui/kpi-card";
import { Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { KmImportSummary } from "@/lib/km/batches";
import {
  KM_STATUS, byCode, camelCode, competenceLabel, fmtKm1, formatDate, type KmReadingStatus, type KmTone,
} from "@/lib/km/types";
import { FactList, Stat, fmtBytes, fmtCount, shortHash } from "./shared";

/**
 * O resumo de um lote de KM — a prévia antes de confirmar e o detalhe em
 * Lotes mostram o mesmo bloco (`import_batches.summary`). Tudo que aparece
 * aqui é o que a rotina devolveu: a tela ordena e fatia, não recalcula.
 */

export interface KmSummarySource {
  fileName?: string | null;
  fileSize?: number | null;
  fileHash?: string | null;
  sheetName?: string | null;
  headerRow?: number | null;
}

const TONE_COLOR: Record<KmTone, string> = {
  success: "var(--chart-success)",
  warning: "var(--chart-warning)",
  danger: "var(--chart-danger)",
  info: "var(--chart-brand-secondary)",
  neutral: "var(--chart-neutral)",
};

const STATUS_ORDER: KmReadingStatus[] = [
  "validated",
  "no_movement",
  "high_mileage",
  "km_divergence",
  "pending_review",
  "inconsistent",
  "no_reading",
];

const VEHICLES_STEP = 20;

export function KmImportSummaryView({
  summary,
  categories,
  source,
  testId,
}: {
  summary: KmImportSummary;
  categories: Record<string, number>;
  source: KmSummarySource;
  /** Prefixo dos data-testid (`km-importacao-previa`, `km-lotes-detalhe`). */
  testId: string;
}) {
  const s = summary;
  const period =
    s.periodFrom || s.periodTo ? `${formatDate(s.periodFrom ?? null)} a ${formatDate(s.periodTo ?? null)}` : "—";
  const unregistered = s.unregisteredPlates ?? [];
  const unregisteredRows = byCode(categories, "unregistered_plate");

  const statusItems: HBarDatum[] = STATUS_ORDER.map((code) => ({
    key: code,
    label: KM_STATUS[code].label,
    value: byCode(s.byStatus, code) ?? 0,
    color: TONE_COLOR[KM_STATUS[code].tone],
  })).filter((i) => (i.value ?? 0) > 0);
  // Situações fora do catálogo local (se o banco ganhar uma nova), sem sumir.
  for (const [code, n] of Object.entries(s.byStatus ?? {})) {
    if (!STATUS_ORDER.some((k) => k === code || camelCode(k) === code) && n > 0) {
      statusItems.push({ key: code, label: code, value: n, color: TONE_COLOR.neutral });
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid={testId}>
      <FactList
        items={[
          { label: "Arquivo", value: source.fileName || "—", title: source.fileName ?? undefined },
          { label: "Aba", value: source.sheetName || s.sheetName || "—" },
          { label: "Linha do cabeçalho", value: source.headerRow ?? s.headerRow ?? "—" },
          { label: "Período", value: period },
          { label: "Tamanho", value: fmtBytes(source.fileSize) },
          { label: "SHA-256 do arquivo", value: <span className="font-mono">{shortHash(source.fileHash)}</span>, title: source.fileHash ?? undefined },
        ]}
      />

      {s.alreadyImported ? (
        <Alert variant="warning" data-testid={`${testId}-ja-importado`}>
          <AlertTitle>Este mesmo arquivo já foi importado</AlertTitle>
          <AlertDescription>
            Há um lote concluído com o mesmo SHA-256. Confirmar de novo não duplica: a chave é veículo + data, e o que já
            está na base aparece como &ldquo;iguais (sem alteração)&rdquo;.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid={`${testId}-kpis`}>
        <KpiCard size="compact" label="Linhas lidas" value={fmtCount(s.rows)} icon={<Rows3 />} period={period} />
        <KpiCard size="compact" label="Placas no arquivo" value={fmtCount(s.plates)} icon={<FileSpreadsheet />} />
        <KpiCard
          size="compact"
          status="primary"
          label="Veículos reconhecidos"
          value={fmtCount(s.vehicles)}
          icon={<Car />}
          period="Placas encontradas no Cadastro de Frotas"
        />
        <KpiCard
          size="compact"
          status="accent"
          label="KM total do arquivo"
          value={fmtKm1(s.kmTotal ?? null)}
          icon={<Gauge />}
          period="Só situações que entram nos totais"
        />
      </div>

      <section aria-labelledby={`${testId}-efeito`} className="flex flex-col gap-2">
        <h3 id={`${testId}-efeito`} className="text-label font-semibold text-fg">
          Efeito na base
        </h3>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Novos" value={s.createRows ?? 0} tone="primary" testId={`${testId}-novos`} />
          <Stat label="Atualizações" value={s.updateRows ?? 0} tone="primary" testId={`${testId}-atualizacoes`} />
          <Stat label="Iguais (sem alteração)" value={s.unchangedRows ?? 0} />
          <Stat
            label="Correções manuais preservadas"
            value={s.manualKeptRows ?? 0}
            tone="warning"
            hint="A planilha não sobrescreve"
          />
        </dl>
      </section>

      <section aria-labelledby={`${testId}-situacao`} className="flex flex-col gap-2">
        <h3 id={`${testId}-situacao`} className="text-label font-semibold text-fg">
          Situação das leituras
        </h3>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
          <Stat label="Sem leitura" value={s.noReadingRows ?? 0} hint="Não vira 0 km" />
          <Stat label="Sem movimento" value={s.noMovementRows ?? 0} />
          <Stat label="Inconsistências" value={s.inconsistentRows ?? 0} tone="danger" />
          <Stat label="Alta rodagem" value={s.highMileageRows ?? 0} tone="warning" />
          <Stat label="Divergências de KM" value={s.divergenceRows ?? 0} tone="warning" />
          <Stat label="Pendentes de análise" value={s.pendingReviewRows ?? 0} tone="warning" hint="Hodômetro regressivo" />
          <Stat label="Saltos de hodômetro" value={s.jumpRows ?? 0} tone="warning" />
          <Stat label="Divergência cadastral" value={s.registryDivergenceRows ?? 0} tone="warning" hint="Cadastro não muda" />
        </dl>
      </section>

      <section aria-labelledby={`${testId}-fora`} className="flex flex-col gap-2">
        <h3 id={`${testId}-fora`} className="text-label font-semibold text-fg">
          Fora da gravação
        </h3>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <Stat label="Linhas com erro" value={s.errorRows ?? 0} tone="danger" testId={`${testId}-erros`} />
          <Stat
            label="Placas não cadastradas"
            value={unregistered.length}
            tone="danger"
            hint={unregistered.length && unregisteredRows != null ? `${fmtCount(unregisteredRows)} linha(s)` : undefined}
          />
          <Stat label="Duplicidades conflitantes" value={byCode(categories, "duplicate_conflict") ?? 0} tone="danger" />
          <Stat label="Duplicidades idênticas" value={byCode(categories, "duplicate_identical") ?? 0} tone="warning" />
          <Stat label="Datas futuras com hodômetro" value={s.futureRows ?? 0} tone="danger" />
          <Stat
            label="Linhas futuras ignoradas"
            value={s.futurePlaceholderRows ?? 0}
            hint="Dias ainda sem leitura"
          />
        </dl>
        {unregistered.length ? (
          <div className="flex flex-col gap-1.5 rounded-md border border-danger/25 bg-danger-soft p-3" data-testid={`${testId}-placas`}>
            <p className="flex items-center gap-1.5 text-body-sm font-medium text-danger-soft-fg">
              <AlertTriangle className="size-4 text-danger" aria-hidden />
              {fmtCount(unregistered.length)} placa(s) fora do Cadastro de Frotas — as linhas ficam de fora; a importação não
              cria veículos.
            </p>
            <ul className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto" aria-label="Placas não cadastradas">
              {unregistered.map((p) => (
                <li key={p.plate}>
                  <Badge variant="danger" appearance="outline" size="md" title={`${p.plate}: ${fmtCount(p.rows)} linha(s)`}>
                    <span className="font-mono">{p.plate}</span>
                    <span className="ml-1 font-semibold tabular-nums">{fmtCount(p.rows)}</span>
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section aria-labelledby={`${testId}-dist`} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface-raised p-4">
          <h3 id={`${testId}-dist`} className="text-label font-semibold text-fg">
            Distribuição por situação
          </h3>
          <p className="text-caption text-fg-muted">
            Linhas que entram na base, pela situação do catálogo. Sem leitura não é Sem movimento.
          </p>
          {statusItems.length ? (
            <HBarChart items={statusItems} ariaLabel="Linhas por situação da leitura" format={(v) => fmtCount(v)} labelWidth={150} />
          ) : (
            <p className="py-6 text-center text-body-sm text-fg-muted">Nenhuma linha com situação para gravar.</p>
          )}
        </section>

        <CompareBlock summary={s} testId={testId} />
      </div>
    </div>
  );
}

/** Importado × atual na base, por mês, veículo e operação (nada é alterado até confirmar). */
function CompareBlock({ summary, testId }: { summary: KmImportSummary; testId: string }) {
  const months = summary.compareMonths ?? [];
  const vehicles = summary.compareVehicles ?? [];
  const operations = summary.compareOperations ?? [];
  const [shown, setShown] = React.useState(VEHICLES_STEP);
  const visibleVehicles = vehicles.slice(0, shown);

  return (
    <section aria-labelledby={`${testId}-comparacao`} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface-raised p-4">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarRange className="size-4 text-fg-muted" aria-hidden />
        <h3 id={`${testId}-comparacao`} className="text-label font-semibold text-fg">
          Comparação com a base atual
        </h3>
      </div>
      <p className="text-caption text-fg-muted">
        KM do arquivo × KM que a base tem hoje para as mesmas linhas. Nenhum dado é alterado antes da confirmação.
      </p>
      <Tabs defaultValue="mes" appearance="segmented" className="gap-2">
        <TabsList aria-label="Comparação por">
          <TabsTrigger value="mes" count={months.length}>
            Por mês
          </TabsTrigger>
          <TabsTrigger value="veiculo" count={vehicles.length}>
            Por veículo
          </TabsTrigger>
          <TabsTrigger value="operacao" count={operations.length}>
            Por operação
          </TabsTrigger>
        </TabsList>

        <TabsContent value="mes">
          <TableContainer tabIndex={0} stickyHeader maxHeight={360} aria-label="Comparação por mês">
            <Table style={{ minWidth: 560 }} data-testid={`${testId}-meses`}>
              <TableHeader>
                <TableRow>
                  <TableHead>Mês</TableHead>
                  <TableHead numeric>KM no arquivo</TableHead>
                  <TableHead numeric>KM atual na base</TableHead>
                  <TableHead numeric>Novos</TableHead>
                  <TableHead numeric>Atualizações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {months.length === 0 ? (
                  <TableEmpty colSpan={5} message="Sem linhas para comparar." />
                ) : (
                  months.map((m) => (
                    <TableRow key={m.month}>
                      <TableHead scope="row" className="font-medium text-fg">
                        <span className="capitalize">{competenceLabel(m.month)}</span>
                      </TableHead>
                      <TableCell numeric>{fmtKm1(m.kmFile)}</TableCell>
                      <TableCell numeric className="text-fg-secondary">{fmtKm1(m.kmCurrent)}</TableCell>
                      <TableCell numeric>{fmtCount(m.newRows)}</TableCell>
                      <TableCell numeric>{fmtCount(m.updateRows)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </TabsContent>

        <TabsContent value="veiculo" className="flex flex-col gap-2">
          <TableContainer tabIndex={0} stickyHeader maxHeight={360} aria-label="Comparação por veículo">
            <Table style={{ minWidth: 560 }} data-testid={`${testId}-veiculos`}>
              <TableHeader>
                <TableRow>
                  <TableHead>Placa</TableHead>
                  <TableHead>Frota</TableHead>
                  <TableHead numeric>KM no arquivo</TableHead>
                  <TableHead numeric>KM atual na base</TableHead>
                  <TableHead numeric>Diferença</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicles.length === 0 ? (
                  <TableEmpty colSpan={5} message="Nenhum veículo reconhecido para comparar." />
                ) : (
                  visibleVehicles.map((v) => (
                    <TableRow key={v.vehicleId ?? v.plate ?? ""}>
                      <TableHead scope="row" className="font-mono font-medium text-fg">
                        {v.plate ?? "—"}
                      </TableHead>
                      <TableCell>{v.fleet ?? "—"}</TableCell>
                      <TableCell numeric>{fmtKm1(v.kmFile)}</TableCell>
                      <TableCell numeric className="text-fg-secondary">{fmtKm1(v.kmCurrent)}</TableCell>
                      <TableCell numeric className="font-medium">{fmtKm1(v.diff)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
          {vehicles.length ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-caption text-fg-muted" aria-live="polite">
                Mostrando {fmtCount(visibleVehicles.length)} de {fmtCount(vehicles.length)} veículo(s), maior diferença primeiro.
              </p>
              {visibleVehicles.length < vehicles.length ? (
                <Button size="sm" variant="outline" onClick={() => setShown((n) => n + VEHICLES_STEP * 5)}>
                  Mostrar mais {fmtCount(Math.min(VEHICLES_STEP * 5, vehicles.length - visibleVehicles.length))}
                </Button>
              ) : null}
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="operacao">
          <TableContainer tabIndex={0} stickyHeader maxHeight={360} aria-label="Comparação por operação">
            <Table style={{ minWidth: 420 }} data-testid={`${testId}-operacoes`}>
              <TableHeader>
                <TableRow>
                  <TableHead>Operação atual do veículo</TableHead>
                  <TableHead numeric>KM no arquivo</TableHead>
                  <TableHead numeric>KM atual na base</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {operations.length === 0 ? (
                  <TableEmpty colSpan={3} message="Sem operações para comparar." />
                ) : (
                  operations.map((o) => (
                    <TableRow key={o.operationId ?? "sem-operacao"}>
                      <TableHead scope="row" className="font-medium text-fg">
                        {o.operation ?? "Sem operação"}
                      </TableHead>
                      <TableCell numeric>{fmtKm1(o.kmFile)}</TableCell>
                      <TableCell numeric className="text-fg-secondary">{fmtKm1(o.kmCurrent)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </TabsContent>
      </Tabs>
    </section>
  );
}
