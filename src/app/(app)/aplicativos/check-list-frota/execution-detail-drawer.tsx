"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, History, ListChecks, PenLine, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/ui/kpi-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { Skeleton } from "@/components/feedback/skeleton";
import { loadExecutionDetail } from "@/lib/applications/history-actions";
import type {
  ConditionalValue, ExecutionAnswer, ExecutionCluster, ExecutionDetail,
} from "@/lib/applications/history-queries";
import type { ChecklistType } from "@/lib/applications/queries";
import type { CorrectionResult } from "@/lib/applications/correction-model";
import { CorrectionHistory, formatWhen } from "./correction-history";
import { ExecutionCorrection, type CorrectionLoaders } from "./execution-correction";

export type { ExecutionDetail } from "@/lib/applications/history-queries";

// ---------------------------------------------------------------------------
// Apresentação compartilhada com a lista do escopo
// ---------------------------------------------------------------------------

export const CHECKLIST_TYPE_LABEL: Record<ChecklistType, string> = {
  saida: "Saída para rota",
  retorno: "Retorno de rota",
};

export const CHECKLIST_TYPE_SHORT: Record<ChecklistType, string> = {
  saida: "Saída",
  retorno: "Retorno",
};

/** "22/09/2026" a partir de "2026-09-22" (ou de um timestamp). */
export function formatDateBr(value: string | null | undefined): string {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-");
  return d ? `${d}/${m}/${y}` : value;
}

/** "22/09/2026 07:06", no fuso da operação. */
export function formatDateTimeBr(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** "4 min 32 s" — o mesmo formato do executor; "—" quando a duração não foi medida. */
export function formatDurationLabel(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m} min ${String(s).padStart(2, "0")} s` : `${s} s`;
}

/** "lado_freio" → "Lado freio"; "farol_esquerdo" → "Farol esquerdo". */
export function humanize(value: string): string {
  const text = value.replace(/_/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** O valor condicional como pares "rótulo: valor(es)", prontos para ler. */
export function formatConditional(value: ConditionalValue | null): { label: string; value: string }[] {
  if (!value) return [];
  return Object.entries(value)
    .filter(([, v]) => (Array.isArray(v) ? v.length > 0 : v !== ""))
    .map(([key, v]) => ({
      label: humanize(key),
      value: Array.isArray(v) ? v.map(humanize).join(", ") : humanize(v),
    }));
}

const ANSWER_LABEL = { yes: "SIM", no: "NÃO" } as const;

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------

export type ExecutionDetailLoader = (
  id: string,
) => Promise<{ ok: boolean; error?: string; data?: ExecutionDetail | null }>;

export interface ExecutionDetailDrawerProps {
  executionId: string | null;
  onOpenChange: (open: boolean) => void;
  /** Injetável para a prévia e os testes; em produção é a action. */
  loader?: ExecutionDetailLoader;
  /**
   * `applications.checklist_fleet.correct`: mostra "Corrigir execução". Sem
   * ela, o detalhe é só leitura e não há campo editável algum.
   */
  canCorrect?: boolean;
  /** Injetável para a prévia e os testes; em produção são as actions. */
  correctionLoaders?: CorrectionLoaders;
}

/**
 * O detalhe de uma execução (§60).
 *
 * Um checklist enviado é selado no banco (§53): não há edição livre, nem
 * anexo. Quem tem a permissão de correção administrativa vê "Corrigir
 * execução", que abre o procedimento próprio — itens escolhidos, motivo
 * obrigatório, antes/depois e confirmação —, e o detalhe passa a mostrar
 * "Corrigida" com o histórico. Sem a permissão, nada é editável.
 */
export function ExecutionDetailDrawer({
  executionId, onOpenChange, loader, canCorrect = false, correctionLoaders,
}: ExecutionDetailDrawerProps) {
  return (
    <Drawer open={Boolean(executionId)} onOpenChange={onOpenChange}>
      <DrawerContent size="lg">
        {executionId ? (
          // A chave remonta o corpo a cada execução: estado novo, sem efeito
          // de reset e sem o primeiro quadro mostrando o detalhe anterior.
          <ExecutionDetailBody
            key={executionId}
            executionId={executionId}
            loader={loader}
            canCorrect={canCorrect}
            correctionLoaders={correctionLoaders}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}

function ExecutionDetailBody({
  executionId, loader, canCorrect, correctionLoaders, onClose,
}: {
  executionId: string;
  loader?: ExecutionDetailLoader;
  canCorrect: boolean;
  correctionLoaders?: CorrectionLoaders;
  onClose: () => void;
}) {
  const load = loader ?? loadExecutionDetail;
  const [detail, setDetail] = React.useState<ExecutionDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [correcting, setCorrecting] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [registered, setRegistered] = React.useState<CorrectionResult | null>(null);
  const loading = detail === null && error === null;

  const finishCorrection = (result: CorrectionResult) => {
    setRegistered(result);
    setCorrecting(false);
    // Recarrega do servidor: o que aparece é o que ficou gravado.
    setDetail(null);
    setError(null);
    setReloadKey((k) => k + 1);
  };

  React.useEffect(() => {
    let cancelled = false;
    load(executionId)
      .then((result) => {
        if (cancelled) return;
        if (result.ok && result.data) {
          setDetail(result.data);
          setError(null);
        } else {
          setDetail(null);
          setError(result.error ?? "Não foi possível carregar o checklist.");
        }
      })
      .catch(() => {
        if (!cancelled) setError("Não foi possível carregar o checklist.");
      });
    return () => {
      cancelled = true;
    };
  }, [executionId, load, reloadKey]);

  return (
    <>
      <DrawerHeader>
        <DrawerTitle>
          {detail
            ? [detail.licensePlate, detail.fleetCode].filter(Boolean).join(" · ") || "Checklist"
            : "Checklist"}
        </DrawerTitle>
        <DrawerDescription>
          {detail
            ? `${correcting ? "Correção administrativa · " : ""}${CHECKLIST_TYPE_LABEL[detail.checklistType]} · ${formatDateBr(detail.operationalDate)}`
            : loading ? "Carregando…" : "Detalhe da execução"}
        </DrawerDescription>
      </DrawerHeader>

      {correcting && detail ? (
        <ExecutionCorrection
          detail={detail}
          loaders={correctionLoaders}
          onCancel={() => setCorrecting(false)}
          onDone={finishCorrection}
        />
      ) : (
        <>
          <DrawerBody className="flex flex-col gap-4">
            {registered && !loading ? (
              <Alert variant="success">
                <AlertTitle>
                  Correção registrada{registered.sequence ? ` (correção ${registered.sequence})` : ""}
                </AlertTitle>
                <AlertDescription>
                  O checklist aparece como corrigido, com o motivo e os valores anteriores no histórico.
                </AlertDescription>
              </Alert>
            ) : null}
            {loading ? (
              <div className="flex flex-col gap-3" aria-busy>
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-40 w-full" />
              </div>
            ) : null}
            {error ? (
              <Alert variant="danger">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {detail ? <ExecutionDetailContent detail={detail} /> : null}
          </DrawerBody>

          <DrawerFooter className="sm:items-center sm:justify-between">
            <p className="text-caption text-fg-muted">
              Um checklist enviado não pode ser editado. Correções administrativas seguem procedimento
              próprio e auditável.
            </p>
            <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row">
              <Button variant="secondary" onClick={onClose}>
                Fechar
              </Button>
              {canCorrect && detail ? (
                <Button
                  variant="outline"
                  leadingIcon={<PenLine />}
                  onClick={() => {
                    setRegistered(null);
                    setCorrecting(true);
                  }}
                >
                  Corrigir execução
                </Button>
              ) : null}
            </div>
          </DrawerFooter>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Conteúdo (puro — a prévia e os testes o renderizam sem drawer)
// ---------------------------------------------------------------------------

function Info({ label, children }: { label: string; children?: React.ReactNode }) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-border bg-surface-secondary px-3 py-2">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="truncate text-body-sm text-fg">{empty ? "—" : children}</dd>
    </div>
  );
}

/** Espelha o cartão do produto de referência: ícone, quem fez, contexto, duração. */
export function ExecutionDetailContent({ detail }: { detail: ExecutionDetail }) {
  const nonConforming = React.useMemo(
    () =>
      detail.clusters
        .map((c) => ({ ...c, answers: c.answers.filter((a) => !a.isConforming) }))
        .filter((c) => c.answers.length > 0),
    [detail.clusters],
  );
  const nonConformingCount = nonConforming.reduce((n, c) => n + c.answers.length, 0);

  const subtitle = [
    detail.employeeCode ? `Matrícula ${detail.employeeCode}` : null,
    CHECKLIST_TYPE_LABEL[detail.checklistType],
    detail.versionLabel ? `versão ${detail.versionLabel}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const city = detail.cityName
    ? `${detail.cityName}${detail.stateUf ? `/${detail.stateUf}` : ""}`
    : detail.stateUf;

  const corrections = detail.corrections ?? [];
  const lastCorrection = corrections[0];

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-label="Resumo da execução"
        className="flex items-start gap-3 rounded-md border border-border bg-surface p-4"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success-soft text-success-soft-fg">
          <CheckCircle2 className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-caption font-medium text-success-soft-fg">
            Check List finalizado
            {corrections.length > 0 ? (
              <Badge variant="info" appearance="soft" size="sm" data-testid="execution-corrected-badge">
                Corrigida
              </Badge>
            ) : null}
          </p>
          <p className="truncate text-body font-semibold text-fg">{detail.employeeName ?? "—"}</p>
          <p className="text-caption text-fg-muted">{subtitle}</p>
          {lastCorrection ? (
            <p className="text-caption text-fg-muted">
              {corrections.length === 1 ? "1 correção administrativa" : `${corrections.length} correções administrativas`}
              {" · última em "}
              {formatWhen(lastCorrection.correctedAt)}
              {lastCorrection.correctedByName ? ` por ${lastCorrection.correctedByName}` : ""}
            </p>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-caption text-fg-muted">Duração</p>
          <p className="text-body font-semibold tabular-nums text-fg">
            {formatDurationLabel(detail.durationSeconds)}
          </p>
        </div>
      </section>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Info label="Data">{formatDateBr(detail.operationalDate)}</Info>
        <Info label="Placa">
          {detail.licensePlate ?? detail.fleetCode}
          {detail.licensePlate && detail.fleetCode ? (
            <span className="text-fg-muted"> · {detail.fleetCode}</span>
          ) : null}
        </Info>
        <Info label="BR">{detail.brCode}</Info>
        <Info label="Operação">{detail.operationName}</Info>
        <Info label="Cidade/UF">{city}</Info>
        <Info label="Início">{formatDateTimeBr(detail.startedAt)}</Info>
        <Info label="Conclusão">{formatDateTimeBr(detail.submittedAt)}</Info>
        <Info label="Liderança">{detail.leaderName}</Info>
      </dl>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KpiCard size="compact" label="Perguntas aplicáveis" value={detail.applicable} icon={<ListChecks />} />
        <KpiCard size="compact" label="Conformes" value={detail.conforming} icon={<CheckCircle2 />} status="success" />
        <KpiCard
          size="compact"
          label="Inconformes"
          value={detail.nonConforming}
          icon={<AlertTriangle />}
          status={detail.nonConforming > 0 ? "warning" : "neutral"}
        />
        <KpiCard
          size="compact"
          label="Críticas"
          value={detail.criticalNonConforming}
          icon={<ShieldAlert />}
          status={detail.criticalNonConforming > 0 ? "danger" : "neutral"}
        />
      </div>

      <section aria-labelledby="execution-cluster-summary" className="rounded-md border border-border">
        <h4
          id="execution-cluster-summary"
          className="border-b border-border bg-surface-secondary px-3 py-2 text-label font-semibold text-fg"
        >
          Resumo por cluster
        </h4>
        {detail.clusters.length === 0 ? (
          <p className="px-3 py-3 text-body-sm text-fg-muted">Nenhum cluster aplicável a este veículo.</p>
        ) : (
          <ul className="divide-y divide-border">
            {detail.clusters.map((c) => (
              <li
                key={c.clusterKey}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-body-sm tabular-nums"
              >
                <span className="min-w-0 basis-full font-medium text-fg sm:flex-1 sm:basis-auto">{c.name}</span>
                <span className="text-fg-secondary">{c.applicable} aplicáveis</span>
                <span className="text-success-soft-fg">{c.applicable - c.nonConforming} conformes</span>
                <span className={c.nonConforming > 0 ? "font-medium text-danger" : "text-fg-secondary"}>
                  {c.nonConforming} inconformes
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Tabs defaultValue="completo">
        <TabsList>
          <TabsTrigger value="completo">Checklist completo</TabsTrigger>
          <TabsTrigger value="inconformidades">Inconformidades ({nonConformingCount})</TabsTrigger>
          {corrections.length > 0 ? (
            <TabsTrigger value="correcoes">Correções ({corrections.length})</TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="completo" className="flex flex-col gap-4">
          {detail.clusters.length === 0 ? (
            <EmptyState
              size="sm"
              icon={<ListChecks />}
              title="Nenhuma pergunta aplicável"
              description="Nenhum cluster do formulário se aplicava a este veículo na data."
            />
          ) : (
            detail.clusters.map((c) => <ClusterTable key={c.clusterKey} cluster={c} />)
          )}
        </TabsContent>

        <TabsContent value="inconformidades">
          {nonConforming.length === 0 ? (
            <EmptyState
              size="sm"
              icon={<CheckCircle2 />}
              title="Nenhuma inconformidade"
              description="Todas as perguntas aplicáveis receberam a resposta conforme."
            />
          ) : (
            <div className="flex flex-col gap-4">
              {nonConforming.map((c) => (
                <section key={c.clusterKey} aria-label={`Inconformidades · ${c.name}`}>
                  <h4 className="mb-2 text-label font-semibold text-fg">
                    {c.name} <span className="font-normal text-fg-muted">· {c.answers.length}</span>
                  </h4>
                  <ul className="flex flex-col gap-2">
                    {c.answers.map((a) => (
                      <NonConformingItem key={a.questionKey} answer={a} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </TabsContent>

        {corrections.length > 0 ? (
          <TabsContent value="correcoes" className="flex flex-col gap-3">
            <p className="flex items-start gap-1.5 text-caption text-fg-secondary">
              <History className="mt-px size-3.5 shrink-0" aria-hidden />
              Cada correção guarda quem corrigiu, quando, o motivo e o valor anterior. Veículo, data, tipo,
              operação e BR não são corrigidos por este procedimento.
            </p>
            <CorrectionHistory corrections={corrections} />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}

function AnswerBadge({ answer }: { answer: ExecutionAnswer["answer"] }) {
  return (
    <Badge variant="neutral" appearance="outline" size="sm" className="tabular-nums">
      {ANSWER_LABEL[answer]}
    </Badge>
  );
}

function SituationBadge({ answer }: { answer: ExecutionAnswer }) {
  if (answer.isConforming) {
    return <Badge variant="success" appearance="soft" size="sm">Conforme</Badge>;
  }
  const critical = answer.criticality === "critica";
  return (
    <Badge variant={critical ? "danger" : "warning"} appearance="soft" size="sm">
      Inconforme{critical ? " · crítica" : ""}
    </Badge>
  );
}

function ConditionalLines({ value, className }: { value: ConditionalValue | null; className?: string }) {
  const entries = formatConditional(value);
  if (entries.length === 0) return null;
  return (
    <ul className={cn("flex flex-col gap-0.5", className)}>
      {entries.map((e) => (
        <li key={e.label} className="text-caption text-fg-secondary">
          <span className="font-medium">{e.label}:</span> {e.value}
        </li>
      ))}
    </ul>
  );
}

function NoteLine({ note }: { note: string | null }) {
  return note ? (
    <p className="text-caption italic text-fg-secondary">{note}</p>
  ) : (
    <p className="text-caption italic text-fg-muted">sem observação</p>
  );
}

function ClusterTable({ cluster }: { cluster: ExecutionCluster }) {
  return (
    <section aria-label={cluster.name} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-label font-semibold text-fg">{cluster.name}</h4>
        <span className="text-caption tabular-nums text-fg-muted">
          {cluster.applicable} aplicáveis · {cluster.nonConforming} inconformes
        </span>
      </div>
      <TableContainer>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pergunta</TableHead>
              <TableHead>Resposta</TableHead>
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cluster.answers.length === 0 ? (
              <TableEmpty colSpan={3} message="Nenhuma pergunta aplicável neste cluster." />
            ) : (
              cluster.answers.map((a) => (
                <TableRow key={a.questionKey} className={cn(!a.isConforming && "bg-danger-soft/30")}>
                  <TableCell className="py-2">
                    <p className="text-body-sm text-fg">
                      {a.text}
                      {a.corrected ? (
                        <Badge variant="info" appearance="soft" size="sm" className="ml-1.5 align-middle">
                          Corrigida
                        </Badge>
                      ) : null}
                    </p>
                    <ConditionalLines value={a.conditionalValue} className="mt-1" />
                    <NoteLine note={a.note} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <AnswerBadge answer={a.answer} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <SituationBadge answer={a} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </section>
  );
}

function NonConformingItem({ answer }: { answer: ExecutionAnswer }) {
  const critical = answer.criticality === "critica";
  return (
    <li
      className={cn(
        "flex flex-col gap-1 rounded-md border border-l-2 p-3",
        critical
          ? "border-danger/40 border-l-danger bg-danger-soft/40"
          : "border-warning/40 border-l-warning bg-warning-soft/40",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-body-sm font-medium text-fg">{answer.text}</p>
        {critical ? <Badge variant="danger" appearance="soft" size="sm">Crítica</Badge> : null}
        <Badge variant="neutral" appearance="outline" size="sm">
          Resposta: {ANSWER_LABEL[answer.answer]}
        </Badge>
      </div>
      <ConditionalLines value={answer.conditionalValue} />
      <NoteLine note={answer.note} />
    </li>
  );
}
