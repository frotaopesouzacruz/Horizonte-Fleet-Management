"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCheck, CircleCheckBig, History, Info, RotateCcw, Undo2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { ErrorState } from "@/components/feedback/error-state";
import { useToast } from "@/components/feedback/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { FormField } from "@/components/ui/form-field";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { transitionTireInspection, type Result } from "@/lib/tires/actions";
import {
  DIVERGENCE_LABEL, DIVERGENCE_TONE, fmtInt, fmtMm, fmtNum, formatDate, formatStamp, INSPECTION_STATUS_LABEL, INSPECTION_STATUS_TONE,
  LAYOUT_SOURCE_LABEL, modernTerms, SYNC_LABEL, SYNC_TONE,
  type DivergenceType, type InspectionStatus, type TireInspectionDetail, type TireInspectionItem,
} from "@/lib/tires/types";
import type { TiresPanelContext } from "../shared";
import { Fact, FireLink, PlateLink, plural, ReasonDialog } from "./tires-ui";

/**
 * Gaveta de uma vistoria recebida (`?vistoria=<id>`, lida no servidor).
 *
 * Mostra cada posição com a leitura de campo ao lado da referência oficial
 * congelada no envio e as divergências calculadas pelo banco. As decisões
 * oferecidas são exatamente as que a rotina devolve em `transitions` (com
 * `canReview`); `tire_inspection_transition` confere permissão, escopo e
 * regra de estado e grava a trilha. Nada aqui altera a base oficial (Rodopar).
 */
export function InspectionDrawer({
  openId, loading, detail, detailError, onClose, onOpen, ctx,
}: {
  /** Vistoria pedida (pela URL ou pelo clique ainda em trânsito). */
  openId: string | null;
  /** O servidor ainda não devolveu a vistoria pedida. */
  loading: boolean;
  detail: TireInspectionDetail | null;
  detailError: string | null;
  onClose: () => void;
  onOpen: (id: string) => void;
  ctx: TiresPanelContext;
}) {
  // Fechando, a gaveta mantém o conteúdo até a animação de saída terminar.
  const shownId = openId ?? detail?.id ?? null;
  const ready = detail && detail.id === shownId && !loading ? detail : null;

  let body: React.ReactNode;
  if (ready) body = <DrawerInner key={ready.id} d={ready} ctx={ctx} onClose={onClose} onOpen={onOpen} />;
  else if (loading || !openId) body = <DrawerLoading />;
  else if (detailError) {
    body = (
      <>
        <DrawerHeader>
          <DrawerTitle>Vistoria</DrawerTitle>
          <DrawerDescription>A leitura da vistoria falhou.</DrawerDescription>
        </DrawerHeader>
        <DrawerBody>
          <ErrorState
            variant="panel"
            title="Não foi possível abrir a vistoria."
            description={detailError}
            onRetry={ctx.refresh}
            retryLabel="Tentar de novo"
            retrying={ctx.pending}
            data-testid="tires-inspection-drawer-error"
          />
        </DrawerBody>
        <DrawerFooter>
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
        </DrawerFooter>
      </>
    );
  } else {
    body = (
      <>
        <DrawerHeader>
          <DrawerTitle>Vistoria não encontrada</DrawerTitle>
          <DrawerDescription>O link aponta para uma vistoria que não existe ou está fora do seu escopo.</DrawerDescription>
        </DrawerHeader>
        <DrawerBody>
          <p className="text-body-sm text-fg-secondary" data-testid="tires-inspection-drawer-missing">
            Confira o link ou abra a vistoria pela fila. O escopo segue as operações e os veículos do seu perfil.
          </p>
        </DrawerBody>
        <DrawerFooter>
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
        </DrawerFooter>
      </>
    );
  }

  return (
    <Drawer open={Boolean(openId)} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DrawerContent
        size="xl"
        data-testid="tires-inspection-drawer"
        aria-busy={loading || undefined}
        // O foco vai para a gaveta, não para a primeira decisão: Enter logo ao abrir não aciona nada.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
      >
        {body}
      </DrawerContent>
    </Drawer>
  );
}

function DrawerLoading() {
  return (
    <>
      <DrawerHeader>
        <DrawerTitle>Vistoria</DrawerTitle>
        <DrawerDescription>Carregando a vistoria…</DrawerDescription>
      </DrawerHeader>
      <DrawerBody className="flex flex-col gap-4" data-testid="tires-inspection-drawer-loading">
        <span role="status" className="sr-only">Carregando a vistoria…</span>
        <span className="hfm-skeleton h-16 w-full" aria-hidden />
        <span className="hfm-skeleton h-28 w-full" aria-hidden />
        <span className="hfm-skeleton h-40 w-full" aria-hidden />
        <span className="hfm-skeleton h-40 w-full" aria-hidden />
      </DrawerBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// Decisões
// ---------------------------------------------------------------------------
type Decision = {
  to: InspectionStatus;
  label: string;
  variant: "primary" | "outline" | "secondary";
  icon: React.ReactNode;
  /** Motivo obrigatório (≥ 5 caracteres, regra da rotina). */
  required: boolean;
  title: (protocol: string) => string;
  description: React.ReactNode;
  confirmLabel: string;
  success: string;
  testId: string;
};

const DECISIONS: Partial<Record<InspectionStatus, Decision>> = {
  pendente_rodopar: {
    to: "pendente_rodopar",
    label: "Aprovar — aguardar lançamento no Rodopar",
    variant: "primary",
    icon: <CheckCheck />,
    required: false,
    title: (p) => `Aprovar a vistoria ${p}?`,
    description:
      "As leituras foram conferidas e devem ser lançadas no Rodopar. A base geral de pneus NÃO muda agora: a próxima sincronização do Rodopar concilia cada posição e a vistoria passa a sincronizada quando os valores chegarem.",
    confirmLabel: "Aprovar",
    success: "Vistoria aprovada — aguardando lançamento no Rodopar",
    testId: "tires-inspection-approve",
  },
  retornar_divergencia: {
    to: "retornar_divergencia",
    label: "Retornar para nova medição",
    variant: "outline",
    icon: <RotateCcw />,
    required: true,
    title: (p) => `Retornar a vistoria ${p} para nova medição?`,
    description:
      "A vistoria volta ao campo com o motivo e a liderança responsável pela operação é alertada. Uma nova medição do veículo substitui esta. Nada muda na base oficial (Rodopar).",
    confirmLabel: "Retornar para nova medição",
    success: "Vistoria retornada para nova medição — liderança alertada",
    testId: "tires-inspection-return",
  },
  sincronizado_rodopar: {
    to: "sincronizado_rodopar",
    label: "Confirmar lançamento no Rodopar (manual)",
    variant: "secondary",
    icon: <CircleCheckBig />,
    required: true,
    title: (p) => `Confirmar manualmente o lançamento da vistoria ${p}?`,
    description: (
      <>
        A sincronização normal é <strong>automática</strong>: a próxima sincronização do Rodopar confere cada posição e encerra a vistoria. Use a
        confirmação manual só como exceção, quando o lançamento já foi verificado no Rodopar por outro meio. Informe como o lançamento foi
        confirmado — fica na trilha de auditoria.
      </>
    ),
    confirmLabel: "Confirmar lançamento",
    success: "Lançamento no Rodopar confirmado manualmente",
    testId: "tires-inspection-sync",
  },
  pendente_revisao: {
    to: "pendente_revisao",
    label: "Reabrir revisão",
    variant: "secondary",
    icon: <Undo2 />,
    required: false,
    title: (p) => `Reabrir a revisão da vistoria ${p}?`,
    description: "A vistoria volta para a fila de revisão com as mesmas leituras, para uma nova decisão.",
    confirmLabel: "Reabrir revisão",
    success: "Revisão reaberta",
    testId: "tires-inspection-reopen",
  },
};

/** Decisão para uma transição que a rotina devolva e esta tela ainda não conheça. */
const genericDecision = (to: InspectionStatus): Decision => ({
  to,
  label: `Mover para “${INSPECTION_STATUS_LABEL[to] ?? to}”`,
  variant: "secondary",
  icon: <Undo2 />,
  required: false,
  title: (p) => `Mover a vistoria ${p} para “${INSPECTION_STATUS_LABEL[to] ?? to}”?`,
  description: "A mudança de situação fica registrada na trilha da vistoria.",
  confirmLabel: "Confirmar",
  success: `Vistoria movida para “${INSPECTION_STATUS_LABEL[to] ?? to}”`,
  testId: `tires-inspection-to-${to}`,
});

const SOURCE_LABEL: Record<string, string> = { user: "Usuário", import: "Sincronização Rodopar", system: "Sistema" };

// ---------------------------------------------------------------------------
// Conteúdo
// ---------------------------------------------------------------------------
function DrawerInner({
  d, ctx, onClose, onOpen,
}: {
  d: TireInspectionDetail;
  ctx: TiresPanelContext;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const [decision, setDecision] = React.useState<Decision | null>(null);
  const decisions = d.canReview ? d.transitions.map((to) => DECISIONS[to] ?? genericDecision(to)) : [];
  const back = decisions.filter((x) => x.to === "retornar_divergencia");
  const forward = decisions.filter((x) => x.to !== "retornar_divergencia");

  const place = [d.cityNameSnapshot, d.stateUfSnapshot].filter(Boolean).join("/");
  const sync = syncSummary(d.syncResult);
  const divergentItems = d.items.filter((it) => it.hasDivergence);
  const byType = new Map<DivergenceType, number>();
  for (const it of d.items) for (const div of it.divergences) byType.set(div.type, (byType.get(div.type) ?? 0) + 1);

  return (
    <>
      <DrawerHeader>
        <div className="flex flex-wrap items-center gap-2">
          <DrawerTitle className="tabular-nums">Vistoria {d.protocol}</DrawerTitle>
          <StatusBadge status={INSPECTION_STATUS_TONE[d.status]} size="sm" data-testid="tires-inspection-drawer-status">
            {INSPECTION_STATUS_LABEL[d.status]}
          </StatusBadge>
          {d.persistentDivergence ? <StatusBadge status="danger" size="sm" withIcon>Divergência persistente</StatusBadge> : null}
        </div>
        <DrawerDescription>
          {[d.licensePlateSnapshot, d.fleetCodeSnapshot, d.vehicleTypeNameSnapshot].filter(Boolean).join(" · ")} ·{" "}
          {fmtInt(d.positionsMeasured)} de {fmtInt(d.positionsExpected)} {plural(d.positionsExpected, "posição medida", "posições medidas")} ·{" "}
          {fmtInt(d.positionsDivergent)} {plural(d.positionsDivergent, "divergente", "divergentes")}
        </DrawerDescription>
      </DrawerHeader>

      <DrawerBody className="flex flex-col gap-6">
        <Alert variant="info" icon={<Info />} data-testid="tires-inspection-blind-note">
          <AlertTitle>Leitura cega de campo</AlertTitle>
          <AlertDescription>
            A vistoria não altera a base oficial (Rodopar); a conciliação acontece na próxima sincronização do Rodopar.
          </AlertDescription>
        </Alert>

        {/* Contexto congelado no envio */}
        <section aria-labelledby="tires-insp-ctx" className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h3 id="tires-insp-ctx" className="text-h4 font-semibold text-fg">Contexto da vistoria</h3>
            <p className="text-caption text-fg-muted">Operação, local e liderança congelados no envio, como estavam na data da vistoria.</p>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Fact label="Veículo">
              <PlateLink vehicleId={d.vehicleId} plate={d.licensePlateSnapshot} fleetCode={d.fleetCodeSnapshot} />
            </Fact>
            <Fact label="Tipo de equipamento">{d.vehicleTypeNameSnapshot ?? "—"}</Fact>
            <Fact label="Operação">{d.operationNameSnapshot ?? "—"}</Fact>
            <Fact label="Cidade/UF">{place || "—"}</Fact>
            <Fact label="BR">{d.brCodeSnapshot ?? "—"}</Fact>
            <Fact label="Filial">{d.unitNameSnapshot ?? "—"}</Fact>
            <Fact label="Liderança">{d.leaderNameSnapshot ?? "—"}</Fact>
            <Fact label="Vistoriador">
              <span className="break-words">{d.inspectorNameSnapshot || "—"}</span>
              {d.inspectorCodeSnapshot ? <span className="text-fg-muted"> ({d.inspectorCodeSnapshot})</span> : null}
            </Fact>
            <Fact label="Data da vistoria">{formatDate(d.inspectionDate)}</Fact>
            {d.startedAt ? <Fact label="Iniciada em">{formatStamp(d.startedAt)}</Fact> : null}
            <Fact label="Realizada em">{formatStamp(d.inspectedAt)}</Fact>
            <Fact label="Enviada em">{formatStamp(d.submittedAt)}</Fact>
            <Fact label="Dados de referência">
              {d.referenceSnapshotDate ? `Rodopar de ${formatDate(d.referenceSnapshotDate)}` : "Sem dados oficiais"}
            </Fact>
            <Fact label="Origem do layout">{LAYOUT_SOURCE_LABEL[d.layoutSource] ?? d.layoutSource}</Fact>
          </dl>
          {d.generalObservation ? (
            <p className="rounded-md bg-surface-secondary px-3 py-2 text-body-sm text-fg-secondary" data-testid="tires-inspection-general-observation">
              <span className="font-medium text-fg">Observação geral do vistoriador: </span>
              {d.generalObservation}
            </p>
          ) : null}
        </section>

        {/* Revisão e conciliação */}
        {d.reviewedAt || d.approvedAt || d.syncedAt || d.lastReconciledAt || sync ? (
          <section aria-labelledby="tires-insp-review" className="flex flex-col gap-3">
            <h3 id="tires-insp-review" className="text-h4 font-semibold text-fg">Revisão e conciliação</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              {d.reviewedAt ? <Fact label="Última decisão">{formatStamp(d.reviewedAt)}</Fact> : null}
              {d.reviewedAt ? <Fact label="Decidida por"><span className="break-words">{d.reviewedByName ?? "—"}</span></Fact> : null}
              {d.approvedAt ? <Fact label="Aprovada em">{formatStamp(d.approvedAt)}</Fact> : null}
              {d.syncedAt ? <Fact label="Sincronizada em">{formatStamp(d.syncedAt)}</Fact> : null}
              {d.lastReconciledAt ? <Fact label="Última conciliação">{formatStamp(d.lastReconciledAt)}</Fact> : null}
              {d.syncedBatchId && ctx.perms.import ? (
                <Fact label="Lote que sincronizou">
                  <Link
                    href={`${ctx.basePath}?aba=sincronizacao&lote=${d.syncedBatchId}`}
                    className="rounded-xs text-link underline-offset-2 hover:underline hfm-focus-ring"
                  >
                    Abrir o lote
                  </Link>
                </Fact>
              ) : null}
              {d.reviewNote ? <Fact label="Motivo da última decisão" className="col-span-2 sm:col-span-3">{d.reviewNote}</Fact> : null}
              {sync ? <Fact label="Resultado da conciliação" className="col-span-2 sm:col-span-3">{sync}</Fact> : null}
            </dl>
          </section>
        ) : null}

        {/* Mãe e filhas */}
        {d.parentInspectionId || d.children.length > 0 ? (
          <section aria-labelledby="tires-insp-family" className="flex flex-col gap-2" data-testid="tires-inspection-family">
            <h3 id="tires-insp-family" className="text-h4 font-semibold text-fg">Medições relacionadas</h3>
            {d.parentInspectionId ? (
              <p className="text-body-sm text-fg-secondary">
                Esta vistoria é a nova medição de uma vistoria retornada por divergência.{" "}
                <button
                  type="button"
                  onClick={() => onOpen(d.parentInspectionId as string)}
                  className="rounded-xs font-medium text-link underline-offset-2 hover:underline hfm-focus-ring"
                  data-testid="tires-inspection-parent"
                >
                  Abrir a vistoria de origem
                </button>
              </p>
            ) : null}
            {d.children.length > 0 ? (
              <>
                <p className="text-body-sm text-fg-secondary">Refeita pela nova medição:</p>
                <ul className="flex flex-col gap-1.5">
                  {d.children.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2 text-body-sm">
                      <button
                        type="button"
                        onClick={() => onOpen(c.id)}
                        className="rounded-xs font-semibold text-fg tabular-nums underline-offset-2 hover:text-primary hover:underline hfm-focus-ring"
                        data-testid="tires-inspection-child"
                      >
                        {c.protocol}
                      </button>
                      <StatusBadge status={INSPECTION_STATUS_TONE[c.status]} size="sm">{INSPECTION_STATUS_LABEL[c.status]}</StatusBadge>
                      <span className="text-caption text-fg-muted">enviada {formatStamp(c.submittedAt)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        ) : null}

        {/* Itens por posição */}
        <section aria-labelledby="tires-insp-items" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h3 id="tires-insp-items" className="text-h4 font-semibold text-fg">Posições: leitura × referência Rodopar</h3>
            <p className="text-caption text-fg-muted">
              Referência oficial congelada no envio (dados de {formatDate(d.referenceSnapshotDate)}). Divergências calculadas pelo banco com as
              tolerâncias vigentes. Sulcos em mm.
            </p>
          </div>
          {byType.size > 0 ? (
            <ul className="flex flex-wrap gap-1.5" aria-label="Divergências por tipo" data-testid="tires-inspection-divergence-summary">
              {[...byType.entries()].map(([type, n]) => (
                <li key={type}>
                  <StatusBadge status={DIVERGENCE_TONE[type] ?? "neutral"} size="sm">
                    {DIVERGENCE_LABEL[type] ?? type} · {fmtInt(n)} {plural(n, "posição", "posições")}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body-sm text-fg-secondary">Nenhuma divergência: as leituras batem com a referência oficial.</p>
          )}
          {divergentItems.length > 0 && divergentItems.length < d.items.length ? (
            <p className="text-caption text-fg-muted">
              {fmtInt(divergentItems.length)} de {fmtInt(d.items.length)} posições com divergência (destacadas).
            </p>
          ) : null}
          <ul className="flex flex-col gap-2.5">
            {d.items.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </ul>
        </section>

        {/* Histórico */}
        <section aria-labelledby="tires-insp-history" className="flex flex-col gap-2">
          <h3 id="tires-insp-history" className="flex items-center gap-1.5 text-h4 font-semibold text-fg">
            <History className="size-4 text-fg-muted" aria-hidden />
            Histórico de situações
          </h3>
          {d.history.length === 0 ? (
            <p className="text-body-sm text-fg-muted">Nenhuma transição registrada.</p>
          ) : (
            <ol className="flex flex-col gap-3 border-l border-border pl-4" data-testid="tires-inspection-history">
              {d.history.map((h) => (
                <li key={h.id} className="relative text-body-sm">
                  <span aria-hidden className="absolute -left-[1.3rem] top-1.5 size-2 rounded-full bg-primary" />
                  <div className="flex flex-wrap items-center gap-1.5">
                    {h.fromStatus ? (
                      <>
                        <span className="text-fg-secondary">{INSPECTION_STATUS_LABEL[h.fromStatus] ?? h.fromStatus}</span>
                        <span aria-hidden className="text-fg-muted">→</span>
                        <span className="sr-only">para</span>
                      </>
                    ) : (
                      <span className="text-fg-secondary">Envio:</span>
                    )}
                    <StatusBadge status={INSPECTION_STATUS_TONE[h.toStatus] ?? "neutral"} size="sm">
                      {INSPECTION_STATUS_LABEL[h.toStatus] ?? h.toStatus}
                    </StatusBadge>
                  </div>
                  <p className="mt-0.5 text-caption text-fg-muted">
                    {formatStamp(h.createdAt)} · {SOURCE_LABEL[h.source] ?? h.source}
                    {h.actorName ? ` · ${h.actorName}` : ""}
                  </p>
                  {h.reason ? <p className="mt-0.5 text-fg-secondary">{h.reason}</p> : null}
                </li>
              ))}
            </ol>
          )}
        </section>
      </DrawerBody>

      {/* No celular: avançar, retornar e, por último, fechar; na tela larga, retornar à esquerda. */}
      <DrawerFooter className="flex-col sm:flex-row sm:justify-between">
        <div className="contents sm:flex sm:gap-2">
          {back.map((x) => (
            <Button
              key={x.to}
              variant={x.variant}
              leadingIcon={x.icon}
              onClick={() => setDecision(x)}
              disabled={ctx.pending}
              className="order-2 sm:order-none"
              data-testid={x.testId}
            >
              {x.label}
            </Button>
          ))}
        </div>
        <div className="contents sm:flex sm:gap-2">
          <Button variant="ghost" onClick={onClose} className="order-3 sm:order-none">Fechar</Button>
          {forward.map((x) => (
            <Button
              key={x.to}
              variant={x.variant}
              leadingIcon={x.icon}
              onClick={() => setDecision(x)}
              disabled={ctx.pending}
              className="order-1 sm:order-none"
              data-testid={x.testId}
            >
              {x.label}
            </Button>
          ))}
        </div>
      </DrawerFooter>
      {decisions.length === 0 && d.canReview ? (
        <p className="sr-only">Esta vistoria não aceita nova decisão na situação atual.</p>
      ) : null}

      {decision?.required ? (
        <ReasonDialog
          open
          onOpenChange={(o) => (!o ? setDecision(null) : undefined)}
          title={decision.title(d.protocol)}
          description={decision.description}
          confirmLabel={decision.confirmLabel}
          destructive={decision.to === "retornar_divergencia"}
          successTitle={decision.success}
          onConfirm={(reason) => transitionTireInspection(d.id, decision.to, reason) as Promise<Result<unknown>>}
          onDone={ctx.refresh}
          testId={`${decision.testId}-dialog`}
        />
      ) : null}
      {decision && !decision.required ? (
        <NoteDialog
          decision={decision}
          protocol={d.protocol}
          onCancel={() => setDecision(null)}
          onConfirm={(note) => transitionTireInspection(d.id, decision.to, note) as Promise<Result<unknown>>}
          onDone={() => {
            setDecision(null);
            ctx.refresh();
          }}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Uma posição: leitura × referência
// ---------------------------------------------------------------------------
const FIRE_FLAGS: DivergenceType[] = ["PNEU_DIFERENTE", "POSICAO_NAO_ENCONTRADA"];

function ItemCard({ item }: { item: TireInspectionItem }) {
  const types = new Set(item.divergences.map((x) => x.type));
  const fireFlag = FIRE_FLAGS.some((t) => types.has(t));
  const psiFlag = types.has("PSI_DIVERGENTE");
  // Sulcos apontados pelo banco no detalhe da divergência ("S1: … · S4: …").
  const treadFlags = new Set<number>();
  for (const div of item.divergences) {
    if (div.type !== "SULCO_DIVERGENTE") continue;
    for (const m of div.detail.matchAll(/S([1-4])\s*:/g)) treadFlags.add(Number(m[1]));
  }
  const read = [item.tread1, item.tread2, item.tread3, item.tread4];
  const ref = [item.refTread1, item.refTread2, item.refTread3, item.refTread4];
  const flagged = "bg-danger-soft font-semibold text-danger-soft-fg";

  return (
    <li
      className={cn(
        "flex flex-col gap-2.5 rounded-lg border bg-surface-raised p-3",
        item.hasDivergence ? "border-danger/40 shadow-[inset_3px_0_0_var(--danger)]" : "border-border",
      )}
      data-testid="tires-inspection-item"
      data-divergent={item.hasDivergence || undefined}
      data-sync={item.syncStatus}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="font-semibold text-fg">{item.positionLabelSnapshot ?? item.positionCode}</span>
          <span className="text-caption text-fg-muted tabular-nums">Posição {item.positionCode}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-caption text-fg-muted">Conciliação:</span>
          <StatusBadge status={SYNC_TONE[item.syncStatus] ?? "neutral"} size="sm" data-testid="tires-inspection-item-sync">
            {SYNC_LABEL[item.syncStatus] ?? item.syncStatus}
          </StatusBadge>
        </div>
      </div>

      {item.measured ? (
        <>
          {/* No celular o Nº Fogo sai da tabela para os sulcos e o PSI caberem sem rolagem. */}
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-body-sm sm:hidden" data-testid="tires-inspection-item-fire">
            <span>
              <span className="text-fg-muted">Nº Fogo lido </span>
              <span className={cn("rounded-xs px-1 font-semibold tabular-nums text-fg", fireFlag && flagged)}>{item.fireNumberRead ?? "—"}</span>
            </span>
            <span>
              <span className="text-fg-muted">Rodopar </span>
              {item.expectedFireNumber ? <FireLink tireId={item.expectedTireId} fireNumber={item.expectedFireNumber} /> : <span className="text-fg-muted">—</span>}
            </span>
          </p>
          <div className="overflow-x-auto rounded-md border border-border-subtle">
            <table className="w-full border-collapse text-caption sm:text-body-sm">
              <caption className="sr-only">Leitura de campo e referência oficial da posição {item.positionCode}</caption>
              <thead>
                <tr className="bg-surface-secondary text-caption text-fg-muted">
                  <th scope="col" className="px-1 py-1.5 sm:px-2 text-left font-medium"><span className="sr-only">Origem</span></th>
                  <th scope="col" className="hidden px-2 py-1.5 text-left font-medium sm:table-cell">Nº Fogo</th>
                  <th scope="col" className="px-1 py-1.5 sm:px-2 text-right font-medium">S1</th>
                  <th scope="col" className="px-1 py-1.5 sm:px-2 text-right font-medium">S2</th>
                  <th scope="col" className="px-1 py-1.5 sm:px-2 text-right font-medium">S3</th>
                  <th scope="col" className="px-1 py-1.5 sm:px-2 text-right font-medium">S4</th>
                  <th scope="col" className="px-1 py-1.5 sm:px-2 text-right font-medium">PSI</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                <tr className="border-t border-border-subtle">
                  <th scope="row" className="px-1 py-1.5 sm:px-2 text-left text-caption font-medium text-fg-secondary">Leitura</th>
                  <td className={cn("hidden px-2 py-1.5 font-medium text-fg sm:table-cell", fireFlag && flagged)}>{item.fireNumberRead ?? "—"}</td>
                  {read.map((v, i) => (
                    <td key={i} className={cn("px-1 py-1.5 sm:px-2 text-right text-fg", treadFlags.has(i + 1) && flagged)}>{fmtNum(v)}</td>
                  ))}
                  <td className={cn("px-1 py-1.5 sm:px-2 text-right text-fg", psiFlag && flagged)}>{fmtNum(item.psiRead)}</td>
                </tr>
                <tr className="border-t border-border-subtle">
                  <th scope="row" className="px-1 py-1.5 sm:px-2 text-left text-caption font-medium text-fg-secondary">Rodopar</th>
                  <td className="hidden px-2 py-1.5 sm:table-cell">
                    {item.expectedFireNumber ? (
                      <FireLink tireId={item.expectedTireId} fireNumber={item.expectedFireNumber} className="font-medium" />
                    ) : (
                      <span className="text-fg-muted">—</span>
                    )}
                  </td>
                  {ref.map((v, i) => (
                    <td key={i} className="px-1 py-1.5 sm:px-2 text-right text-fg-secondary">{fmtNum(v)}</td>
                  ))}
                  <td className="px-1 py-1.5 sm:px-2 text-right text-fg-secondary">{fmtNum(item.refPsi)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="rounded-md bg-surface-secondary px-3 py-2 text-body-sm text-fg-secondary">
          Posição não medida pelo vistoriador.
          {item.expectedFireNumber ? (
            <>
              {" "}Referência oficial: Nº Fogo <FireLink tireId={item.expectedTireId} fireNumber={item.expectedFireNumber} />
              {item.refTreadMin != null ? `, sulco mínimo ${fmtMm(item.refTreadMin)}` : ""}.
            </>
          ) : null}
        </p>
      )}

      {item.measured && (item.refTreadMin != null || item.refMeasurementDate || item.refCalibrationDate) ? (
        <p className="text-caption text-fg-muted">
          {[
            item.refTreadMin != null ? `Sulco mínimo oficial ${fmtMm(item.refTreadMin)}` : null,
            item.refMeasurementDate ? `medição oficial em ${formatDate(item.refMeasurementDate)}` : null,
            item.refCalibrationDate ? `calibragem oficial em ${formatDate(item.refCalibrationDate)}` : null,
          ].filter(Boolean).join(" · ")}
        </p>
      ) : null}

      {item.divergences.length > 0 ? (
        <ul className="flex flex-col gap-1.5" aria-label={`Divergências da posição ${item.positionCode}`}>
          {item.divergences.map((div, i) => (
            <li key={`${div.type}-${i}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-body-sm" data-testid="tires-inspection-divergence" data-type={div.type}>
              <StatusBadge status={DIVERGENCE_TONE[div.type] ?? "neutral"} size="sm" className="shrink-0">
                {DIVERGENCE_LABEL[div.type] ?? div.type}
              </StatusBadge>
              <span className="min-w-0 text-fg-secondary">{modernTerms(div.detail)}</span>
            </li>
          ))}
        </ul>
      ) : item.measured ? (
        <p className="text-caption text-success-soft-fg">Leitura dentro das tolerâncias da referência oficial.</p>
      ) : null}

      {item.observation ? (
        <p className="text-body-sm text-fg-secondary">
          <span className="font-medium text-fg">Observação: </span>
          {item.observation}
        </p>
      ) : null}
      {item.syncNote ? <p className="text-caption text-fg-muted">Conciliação: {modernTerms(item.syncNote)}</p> : null}
    </li>
  );
}

/** Resultado da conciliação (`sync_result`) em texto. */
function syncSummary(r: Record<string, unknown> | null | undefined): string | null {
  if (!r || Object.keys(r).length === 0) return null;
  const n = (k: string) => (typeof r[k] === "number" ? (r[k] as number) : null);
  if (r.manual === true) {
    const note = typeof r.note === "string" && r.note ? `: ${r.note}` : ".";
    return `Lançamento confirmado manualmente${note}`;
  }
  const parts: string[] = [];
  if (typeof r.referenceDate === "string") parts.push(`Dados Rodopar de ${formatDate(r.referenceDate)}`);
  const synced = n("synced");
  const persistent = n("persistent");
  const pending = n("pending");
  if (synced != null) parts.push(`${fmtInt(synced)} ${plural(synced, "posição confirmada", "posições confirmadas")}`);
  if (persistent != null) parts.push(`${fmtInt(persistent)} com divergência persistente`);
  if (pending != null) parts.push(`${fmtInt(pending)} aguardando lançamento`);
  return parts.length ? parts.join(" · ") : null;
}

// ---------------------------------------------------------------------------
// Diálogo de decisão com observação opcional
// ---------------------------------------------------------------------------
function NoteDialog({
  decision, protocol, onCancel, onConfirm, onDone,
}: {
  decision: Decision;
  protocol: string;
  onCancel: () => void;
  onConfirm: (note: string | null) => Promise<Result<unknown>>;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const tooLong = note.trim().length > 1000;

  const submit = async () => {
    if (tooLong) return;
    setBusy(true);
    let r: Result<unknown>;
    try {
      r = await onConfirm(note.trim() || null);
    } finally {
      setBusy(false);
    }
    if (!r.ok) {
      toast({ title: "Não foi possível concluir", description: r.error, variant: "danger" });
      return;
    }
    toast({ title: decision.success, variant: "success" });
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => (!o && !busy ? onCancel() : undefined)}>
      <DialogContent size="sm" data-testid={`${decision.testId}-dialog`}>
        <DialogHeader>
          <DialogTitle>{decision.title(protocol)}</DialogTitle>
          <DialogDescription>{decision.description}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FormField
            label="Observação"
            labelHint="Opcional"
            error={tooLong ? "Use no máximo 1.000 caracteres." : undefined}
            helperText="Fica na trilha da vistoria."
          >
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              autoFocus
              disabled={busy}
              data-testid={`${decision.testId}-note`}
            />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>Cancelar</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={tooLong} data-testid={`${decision.testId}-confirm`}>
            {decision.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
