"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarDays, Route } from "lucide-react";
import {
  Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/ui/kpi-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { LoadingState } from "@/components/feedback/loading-state";
import { loadDayDetail } from "@/lib/adherence/actions";
import type { ChecklistContext, DayDetail, DayGroup } from "@/lib/adherence/queries";
import { CONTEXT_LABEL, formatDateBr, formatInt, formatPct, statusMeta } from "./status";
import { pctTone } from "./consolidated-panel";
import type { AdherenceFilterState } from "./adherence-view";

export interface DayDetailDrawerProps {
  date: string | null;
  context: ChecklistContext;
  filters: AdherenceFilterState;
  basePath: string;
  onOpenChange: (open: boolean) => void;
  onSelectObligation: (id: string) => void;
}

/**
 * Detalhe do dia (§29–§31): o que o Heatmap resume numa célula, aberto por
 * dimensão e por veículo. O contexto (saída/retorno) é o da tela e vai junto
 * em tudo — na consulta, nos links e no título — porque os dois denominadores
 * nunca se misturam (§31).
 */
export function DayDetailDrawer({ date, context, filters, basePath, onOpenChange, onSelectObligation }: DayDetailDrawerProps) {
  return (
    <Drawer open={Boolean(date)} onOpenChange={onOpenChange}>
      <DrawerContent size="lg">
        {date ? (
          // A chave remonta o corpo a cada dia: estado novo, sem efeito de
          // reset e sem o primeiro quadro mostrando o dia anterior.
          <DayBody key={`${date}-${context}`} date={date} context={context} filters={filters}
            basePath={basePath} onSelectObligation={onSelectObligation} />
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}

function DayBody({ date, context, filters, basePath, onSelectObligation }: Omit<DayDetailDrawerProps, "date" | "onOpenChange"> & { date: string }) {
  const params = useSearchParams();
  const [detail, setDetail] = React.useState<DayDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();
  const loading = detail === null && error === null;

  const load = React.useCallback(() => {
    startTransition(async () => {
      const result = await loadDayDetail(date, context, filters);
      if (result.ok && result.data) { setDetail(result.data); setError(null); }
      else { setDetail(null); setError(result.error ?? "Não foi possível carregar o dia."); }
    });
  }, [date, context, filters]);

  React.useEffect(() => { load(); }, [load]);

  /** Os links do rodapé levam os filtros em tela e apontam a competência do dia. */
  const hrefTo = (aba: "matriz" | "jornada") => {
    const next = new URLSearchParams(params.toString());
    next.set("aba", aba);
    next.set("dia", date);
    next.set("contexto", context);
    next.set("ano", date.slice(0, 4));
    next.set("mes", String(Number(date.slice(5, 7))));
    next.delete("pagina");
    return `${basePath}?${next.toString()}`;
  };

  const hint = detail?.isFuture ? "data futura · obrigações planejadas" : detail?.isToday ? "dia vigente · resultados provisórios" : null;

  return (
    <>
      <DrawerHeader>
        <DrawerTitle>Dia {formatDateBr(date)} · {CONTEXT_LABEL[context]}</DrawerTitle>
        <DrawerDescription>
          {hint ?? "Realizados sobre obrigações devidas, no recorte dos filtros em tela."}
        </DrawerDescription>
      </DrawerHeader>

      <DrawerBody className="flex flex-col gap-4">
        {loading ? <LoadingState variant="block" label="Carregando o dia…" /> : null}
        {error ? (
          <Alert variant="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {detail ? <DayContent detail={detail} context={context} onSelectObligation={onSelectObligation} /> : null}
      </DrawerBody>

      <DrawerFooter>
        <Button asChild variant="outline" leadingIcon={<Route />}>
          <Link href={hrefTo("jornada")}>Ver jornada do dia</Link>
        </Button>
        <Button asChild variant="secondary" leadingIcon={<CalendarDays />}>
          <Link href={hrefTo("matriz")}>Abrir Mês/Dia neste dia</Link>
        </Button>
      </DrawerFooter>
    </>
  );
}

function GroupTable({ label, groups, target }: { label: string; groups: DayGroup[]; target: number | null }) {
  return (
    <TableContainer>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{label}</TableHead>
            <TableHead className="text-right">Obrigações</TableHead>
            <TableHead className="text-right">Realizados</TableHead>
            <TableHead className="text-right">Não realizados</TableHead>
            <TableHead className="text-right">Expurgos</TableHead>
            <TableHead className="text-right">Aderência</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.length === 0 ? (
            <TableEmpty colSpan={6} message="Sem obrigações nesta dimensão." />
          ) : (
            groups.map((g) => (
              <TableRow key={g.key || g.label}>
                <TableCell className="font-medium text-fg">{g.label}</TableCell>
                <TableCell className="text-right tabular-nums">{formatInt(g.obligations)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatInt(g.done)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatInt(g.notDone)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatInt(g.excluded)}</TableCell>
                <TableCell className="text-right">
                  <StatusBadge status={pctTone(g.adherencePct, target)}>{formatPct(g.adherencePct)}</StatusBadge>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function DayContent({ detail, context, onSelectObligation }: { detail: DayDetail; context: ChecklistContext; onSelectObligation: (id: string) => void }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <KpiCard size="compact" label="Obrigações" value={formatInt(detail.obligations)}
          period={detail.planned > 0 ? `${formatInt(detail.planned)} planejadas` : undefined} />
        <KpiCard size="compact" label="Realizados" value={formatInt(detail.done)} />
        <KpiCard size="compact" label="Não realizados" value={formatInt(detail.notDone)}
          period={detail.provisional > 0 ? `${formatInt(detail.provisional)} provisórios` : undefined} />
        {context === "retorno" ? (
          <KpiCard size="compact" label="Retornos no prazo" value={formatInt(detail.pendingReturn)} />
        ) : null}
        <KpiCard size="compact" label="Expurgos" value={formatInt(detail.excluded)} />
        <KpiCard size="compact" label="Justificativas pendentes" value={formatInt(detail.pendingRequests)} />
        <KpiCard size="compact" label="Aderência" value={formatPct(detail.adherencePct)}
          period={`${formatInt(detail.numerator)} / ${formatInt(detail.denominator)}`} />
        <KpiCard size="compact" label="Meta" value={detail.targetPct == null ? "Não definida" : formatPct(detail.targetPct)} />
      </div>

      <Tabs defaultValue="operacoes">
        <TabsList>
          <TabsTrigger value="operacoes">Operações</TabsTrigger>
          <TabsTrigger value="localidades">Localidades</TabsTrigger>
          <TabsTrigger value="liderancas">Lideranças</TabsTrigger>
          <TabsTrigger value="sem-checklist" count={detail.notDoneVehicles.length}>Sem checklist</TabsTrigger>
          <TabsTrigger value="expurgos" count={detail.excludedVehicles.length}>Expurgos</TabsTrigger>
        </TabsList>
        <TabsContent value="operacoes">
          <GroupTable label="Operação" groups={detail.byOperation} target={detail.targetPct} />
        </TabsContent>
        <TabsContent value="localidades">
          <GroupTable label="Localidade" groups={detail.byCity} target={detail.targetPct} />
        </TabsContent>
        <TabsContent value="liderancas">
          <GroupTable label="Liderança" groups={detail.byLeader} target={detail.targetPct} />
        </TabsContent>
        <TabsContent value="sem-checklist">
          {detail.notDoneVehicles.length === 0 ? (
            <p className="px-1 py-3 text-body-sm text-fg-muted">
              {detail.isFuture ? "Data futura: ainda não há descumprimento." : "Nenhum veículo sem checklist neste dia."}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border" aria-label="Veículos sem checklist">
              {detail.notDoneVehicles.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => onSelectObligation(v.id)}
                    className="flex w-full flex-col gap-1 px-3 py-2 text-left transition-colors hover:bg-secondary hfm-focus-ring"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-body-sm font-semibold text-fg">{v.fleetCode ?? "—"}</span>
                      <span className="text-body-sm text-fg-muted">{v.licensePlate ?? ""}</span>
                      {v.provisional ? <Badge variant="warning" size="sm">Provisório</Badge> : null}
                      {v.pendingRequest ? <Badge variant="info" size="sm">Justificativa pendente</Badge> : null}
                      {v.condition ? <Badge variant="neutral" size="sm">{statusMeta(v.condition).label}</Badge> : null}
                    </span>
                    <span className="text-caption text-fg-muted">
                      {[v.operationName, v.cityName, v.brCode, v.leaderName].filter(Boolean).join(" · ") || "Sem vínculo informado"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="expurgos">
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Frota</TableHead>
                  <TableHead>Placa</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.excludedVehicles.length === 0 ? (
                  <TableEmpty colSpan={4} message="Nenhum expurgo aprovado neste dia." />
                ) : (
                  detail.excludedVehicles.map((v) => {
                    const meta = statusMeta(v.status);
                    return (
                      <TableRow key={v.id}>
                        <TableCell className="font-medium text-fg">{v.fleetCode ?? "—"}</TableCell>
                        <TableCell className="text-fg-muted">{v.licensePlate ?? "—"}</TableCell>
                        <TableCell><StatusBadge status={meta.tone}>{meta.label}</StatusBadge></TableCell>
                        <TableCell>{v.reasonName ?? "—"}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </TabsContent>
      </Tabs>
    </>
  );
}
