"use client";

import * as React from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowDown,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  EyeOff,
  History,
  Plus,
  RotateCcw,
  Send,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { StatusBadge, statusTone, type StatusTone } from "@/components/ui/status-badge";
import { Progress } from "@/components/feedback/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { useConfirm } from "@/components/feedback/confirm-dialog";
import { useToast } from "@/components/feedback/toast";
import { AxleDiagram, buildAxleRows, type AxleTireState } from "@/components/tires/axle-diagram";
import type { Result, TireAppSubmitInput } from "@/lib/tires/app-actions";
import {
  fmtInt,
  formatStamp,
  plural,
  type TireAppContext,
  type TireAppPositions,
  type TireAppSubmitResult,
  type TirePositionInfo,
} from "@/lib/tires/types";
import {
  checkReading,
  clearDraft,
  createDraft,
  draftHasContent,
  emptyReading,
  measuredCount,
  normalizeFire,
  parseDecimal,
  readDraft,
  saveDraft,
  TREAD_FIELDS,
  typeDecimal,
  typeFire,
  type DraftVehicle,
  type Reading,
  type ReadingCheck,
  type ReadingField,
  type ReadingState,
  type TireDraft,
} from "./draft";

/**
 * O executor da Vistoria de Pneus: (rascunho salvo?) → medição → revisão →
 * envio → protocolo.
 *
 * LEITURA CEGA: do servidor chegam só o veículo e as posições a verificar
 * (`tire_inspection_positions`). Nenhum Nº Fogo esperado, sulco, PSI, data ou
 * situação da fotografia oficial passa por aqui — nem antes, nem durante, nem
 * depois do envio. A comparação é feita no banco, e a vistoria não altera a
 * fotografia oficial: segue para revisão e é conciliada com o próximo Rodopar.
 *
 * O diagrama de eixos vem do dicionário de posições (`AxleDiagram`), e a
 * navegação "Anterior/Próxima" segue a ordem dele (`buildAxleRows`). As
 * leituras ficam em rascunho no aparelho a cada tecla; o envio reutiliza a
 * mesma `clientSubmissionId` em todas as tentativas.
 */
export interface RunnerParent {
  id: string;
  protocol: string;
  reviewNote: string | null;
  reviewedAt: string | null;
}

export interface RunnerStart {
  vehicleId: string;
  /** O que já se sabe do veículo (cartão da lista), para o cabeçalho enquanto carrega. */
  vehicle?: DraftVehicle | null;
  /** Vistoria retornada que esta medição refaz (vinda de "Minhas vistorias"). */
  parent?: RunnerParent | null;
  /** Veio de "Continuar" um rascunho: retoma sem perguntar. */
  resume?: boolean;
}

export interface RunnerLoaders {
  positions: (vehicleId: string) => Promise<Result<TireAppPositions>>;
  submit: (input: TireAppSubmitInput) => Promise<Result<TireAppSubmitResult>>;
}

export interface TireRunnerProps {
  start: RunnerStart;
  context: TireAppContext;
  /** Escopo do rascunho (id do usuário). */
  scope: string;
  loaders: RunnerLoaders;
  /** Sair sem enviar (o rascunho fica salvo). */
  onBack: () => void;
  /** Depois do protocolo: nova vistoria ou minhas vistorias. */
  onDone: (to: "vehicles" | "history") => void;
}

type Phase = "resume" | "measure" | "review" | "done";
/** Depois de focar: rolar até o cartão da posição, ao topo, ou deixar o navegador trazer o campo. */
type FocusScroll = "anchor" | "top" | "element";

const NETWORK_ERROR = "Não foi possível falar com o servidor. Verifique a conexão e tente de novo.";

const STATE_LABEL: Record<ReadingState, string> = {
  complete: "Completa",
  partial: "Parcial",
  invalid: "Com erro",
  empty: "Pendente",
};
const STATE_TONE: Record<ReadingState, StatusTone> = {
  complete: "success",
  partial: "warning",
  invalid: "danger",
  empty: "neutral",
};

const FIELD_ID: Record<ReadingField, string> = {
  fire: "tires-app-field-fire",
  t1: "tires-app-field-t1",
  t2: "tires-app-field-t2",
  t3: "tires-app-field-t3",
  t4: "tires-app-field-t4",
  psi: "tires-app-field-psi",
  obs: "tires-app-field-obs",
};
const ENTER_NEXT: Partial<Record<ReadingField, ReadingField>> = { fire: "t1", t1: "t2", t2: "t3", t3: "t4", t4: "psi" };

function vehicleFrom(data: TireAppPositions): DraftVehicle {
  const v = data.vehicle;
  return {
    id: v.id,
    licensePlate: v.licensePlate,
    fleetCode: v.fleetCode,
    vehicleTypeName: v.vehicleTypeName,
    operationName: v.operationName,
    cityName: v.cityName,
    stateUf: v.stateUf,
  };
}

/** A posição que a pessoa deve ver primeiro: a última aberta, ou a primeira ainda sem leitura. */
function firstOpen(draft: TireDraft, order: string[]): string | null {
  if (draft.current && order.includes(draft.current)) return draft.current;
  return order.find((code) => !checkReadingLoose(draft.readings[code])) ?? order[0] ?? null;
}
const checkReadingLoose = (r: Reading | undefined) => !!r && [r.fire, r.t1, r.t2, r.t3, r.t4, r.psi].some((v) => v.trim() !== "");

/** Ajusta um rascunho às posições atuais do veículo (layouts mudam) e à vistoria retornada vigente. */
function reconcile(stored: TireDraft, data: TireAppPositions, parentId: string | null, order: string[]): { draft: TireDraft; dropped: string[] } {
  const valid = new Set(order);
  const readings: Record<string, Reading> = {};
  const dropped: string[] = [];
  for (const [code, reading] of Object.entries(stored.readings)) {
    if (valid.has(code)) readings[code] = { ...emptyReading(), ...reading };
    else if (checkReadingLoose(reading) || reading.obs.trim()) dropped.push(code);
  }
  const draft: TireDraft = { ...stored, vehicle: vehicleFrom(data), parentInspectionId: parentId, readings };
  return { draft: { ...draft, current: firstOpen(draft, order) }, dropped };
}

function diagramOrder(positions: TirePositionInfo[]): string[] {
  const { axles, extras } = buildAxleRows(positions);
  return [...axles.flatMap((row) => [...row.left, ...row.right]), ...extras].map((p) => p.code);
}

function vehicleLine(v: DraftVehicle | null | undefined): string {
  if (!v) return "";
  return [v.licensePlate, v.fleetCode ? `Frota ${v.fleetCode}` : null, v.vehicleTypeName].filter(Boolean).join(" · ");
}
function placeLine(v: DraftVehicle | null | undefined): string {
  if (!v) return "";
  const place = [v.cityName, v.stateUf].filter(Boolean).join("/");
  return [v.operationName, place].filter(Boolean).join(" · ");
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function TireRunner({ start, context, scope, loaders, onBack, onDone }: TireRunnerProps) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const limits = context.limits;

  const [attempt, setAttempt] = React.useState(0);
  const loadKey = `${start.vehicleId}\u0000${attempt}`;
  const [loaded, setLoaded] = React.useState<{ key: string; data?: TireAppPositions; order?: string[]; error?: string } | null>(null);
  const [draft, setDraft] = React.useState<TireDraft | null>(null);
  const [offer, setOffer] = React.useState<TireDraft | null>(null);
  const [dropped, setDropped] = React.useState<string[]>([]);
  const [phase, setPhase] = React.useState<Phase>("measure");
  const [touched, setTouched] = React.useState<Record<string, true>>({});
  const [revealed, setRevealed] = React.useState<Record<string, true>>({});
  const [sending, setSending] = React.useState(false);
  const [sendError, setSendError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ data: TireAppSubmitResult; lostEdits: boolean } | null>(null);
  const [focusRequest, setFocusRequest] = React.useState<{ id: string; scroll: FocusScroll; seq: number } | null>(null);
  // No celular o diagrama vem antes do formulário: enquanto o formulário não
  // está na tela, a ação principal do rodapé leva até ele (em vez de pular a posição).
  const formRef = React.useRef<HTMLElement | null>(null);
  const [formVisible, setFormVisible] = React.useState(true);

  const requestFocus = React.useCallback((id: string, scroll: FocusScroll) => {
    setFocusRequest((previous) => ({ id, scroll, seq: (previous?.seq ?? 0) + 1 }));
  }, []);

  // Posições do veículo (cegas) e, com elas, o rascunho: novo, retomado ou oferecido.
  React.useEffect(() => {
    let active = true;
    loaders.positions(start.vehicleId).then(
      (r) => {
        if (!active) return;
        if (!r.ok || !r.data) {
          setLoaded({ key: loadKey, error: r.error ?? "Não foi possível montar o diagrama do veículo." });
          return;
        }
        const data = r.data;
        const order = diagramOrder(data.positions);
        setLoaded({ key: loadKey, data, order });
        const parentId = start.parent?.id ?? data.returnedInspection?.id ?? null;
        const stored = readDraft(scope, start.vehicleId);
        if (stored && !start.resume) {
          setOffer(stored);
          setPhase("resume");
          setFocusRequest({ id: "tires-app-runner-heading", scroll: "top", seq: 1 });
          return;
        }
        if (stored) {
          const next = reconcile(stored, data, parentId, order);
          setDraft(next.draft);
          setDropped(next.dropped);
        } else {
          const fresh = createDraft(vehicleFrom(data), parentId);
          setDraft({ ...fresh, current: order[0] ?? null });
        }
        setPhase("measure");
        setFocusRequest({ id: "tires-app-runner-heading", scroll: "top", seq: 1 });
      },
      () => {
        if (active) setLoaded({ key: loadKey, error: NETWORK_ERROR });
      },
    );
    return () => {
      active = false;
    };
  }, [loaders, loadKey, scope, start.vehicleId, start.parent?.id, start.resume]);

  // Foco e rolagem pedidos pelas transições (etapa, posição, campo).
  React.useEffect(() => {
    if (!focusRequest) return;
    const el = document.getElementById(focusRequest.id);
    if (!el) return;
    if (focusRequest.scroll === "element") {
      el.focus();
      return;
    }
    el.focus({ preventScroll: true });
    if (focusRequest.scroll === "anchor") {
      const target = el.closest<HTMLElement>("[data-scroll-anchor]") ?? el;
      target.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
    } else {
      window.scrollTo({ top: 0 });
    }
  }, [focusRequest]);

  // O rascunho acompanha cada alteração até o protocolo chegar.
  React.useEffect(() => {
    if (!draft || phase === "done") return;
    if (draftHasContent(draft) || draft.lastAttemptAt) saveDraft(scope, draft);
    else if (readDraft(scope, draft.vehicle.id)?.clientSubmissionId === draft.clientSubmissionId) clearDraft(scope, draft.vehicle.id);
  }, [draft, phase, scope]);

  const measuring = phase === "measure" && !!draft;
  React.useEffect(() => {
    const el = formRef.current;
    if (!measuring || !el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setFormVisible(entry.isIntersecting && entry.intersectionRect.height >= 140),
      { rootMargin: "-120px 0px -96px 0px", threshold: [0, 0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1] },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [measuring]);

  const isLoading = loaded?.key !== loadKey;
  const data = !isLoading ? loaded?.data : undefined;
  const order = React.useMemo(() => (!isLoading ? (loaded?.order ?? []) : []), [isLoading, loaded]);
  const positionsByCode = React.useMemo(() => new Map((data?.positions ?? []).map((p) => [p.code, p])), [data]);
  const vehicle: DraftVehicle | null = data ? vehicleFrom(data) : (start.vehicle ?? null);
  const plate = vehicle?.licensePlate ?? "…";
  const parent: RunnerParent | null =
    start.parent ??
    (data?.returnedInspection
      ? {
          id: data.returnedInspection.id,
          protocol: data.returnedInspection.protocol,
          reviewNote: data.returnedInspection.reviewNote,
          reviewedAt: data.returnedInspection.reviewedAt,
        }
      : null);

  const readings = draft?.readings;
  const checks = React.useMemo(() => {
    const out: Record<string, ReadingCheck> = {};
    for (const code of order) out[code] = checkReading(readings?.[code], limits);
    return out;
  }, [order, readings, limits]);

  const stats = React.useMemo(() => {
    let complete = 0;
    let partial = 0;
    let invalid = 0;
    let measured = 0;
    let withContent = 0;
    for (const code of order) {
      const c = checks[code];
      if (c.measured) measured += 1;
      if (c.hasContent) withContent += 1;
      if (c.state === "complete") complete += 1;
      if (c.state === "partial") partial += 1;
      if (c.state === "invalid") invalid += 1;
    }
    return { complete, partial, invalid, measured, withContent, total: order.length };
  }, [order, checks]);

  const current = draft?.current && positionsByCode.has(draft.current) ? draft.current : (order[0] ?? null);
  const currentIndex = current ? order.indexOf(current) : -1;

  // ---------------------------------------------------------------- edição
  const updateField = (code: string, field: ReadingField, value: string) => {
    const now = new Date().toISOString();
    setDraft((d) => {
      if (!d) return d;
      const prev = d.readings[code] ?? emptyReading();
      if (prev[field] === value) return d;
      return {
        ...d,
        readings: { ...d.readings, [code]: { ...prev, [field]: value } },
        updatedAt: now,
        editedAfterAttempt: d.lastAttemptAt ? true : d.editedAfterAttempt,
      };
    });
  };

  const clearPosition = (code: string) => {
    const now = new Date().toISOString();
    setDraft((d) => {
      if (!d) return d;
      const readingsNext = { ...d.readings };
      delete readingsNext[code];
      return { ...d, readings: readingsNext, updatedAt: now, editedAfterAttempt: d.lastAttemptAt ? true : d.editedAfterAttempt };
    });
    setTouched((t) => Object.fromEntries(Object.entries(t).filter(([k]) => !k.startsWith(`${code}.`))));
    setRevealed((r) => {
      const next = { ...r };
      delete next[code];
      return next;
    });
    requestFocus(FIELD_ID.fire, "element");
  };

  const setGeneralObservation = (value: string) => {
    const now = new Date().toISOString();
    setDraft((d) => (d ? { ...d, generalObservation: value, updatedAt: now } : d));
  };

  const goTo = (code: string, focus: "heading" | "fire" = "heading") => {
    if (current && current !== code && checks[current]?.state === "invalid") setRevealed((r) => ({ ...r, [current]: true }));
    // Foco síncrono no mesmo campo (o formulário não remonta): o teclado do celular continua aberto.
    if (focus === "fire") document.getElementById(FIELD_ID.fire)?.focus({ preventScroll: true });
    setDraft((d) => (d ? { ...d, current: code } : d));
    requestFocus(focus === "fire" ? FIELD_ID.fire : "tires-app-position-heading", "anchor");
  };

  const openReview = () => {
    if (current && checks[current]?.state === "invalid") setRevealed((r) => ({ ...r, [current]: true }));
    setSendError(null);
    setPhase("review");
    requestFocus("tires-app-runner-heading", "top");
  };

  /** Avança na ordem do diagrama; com leitura inválida, mostra os erros e fica. */
  const step = (direction: 1 | -1, focus: "heading" | "fire" = "heading") => {
    if (!current) return;
    const check = checks[current];
    if (direction === 1 && check?.state === "invalid") {
      setRevealed((r) => ({ ...r, [current]: true }));
      const firstBad = (Object.keys(FIELD_ID) as ReadingField[]).find((f) => check.errors[f]);
      requestFocus(firstBad ? FIELD_ID[firstBad] : "tires-app-position-heading", "element");
      return;
    }
    const next = order[currentIndex + direction];
    if (next) goTo(next, focus);
    else if (direction === 1) openReview();
  };

  const backToMeasure = (code?: string) => {
    setPhase("measure");
    if (code) {
      setDraft((d) => (d ? { ...d, current: code } : d));
      setRevealed((r) => ({ ...r, [code]: true }));
      requestFocus("tires-app-position-heading", "anchor");
    } else {
      requestFocus("tires-app-runner-heading", "top");
    }
  };

  const toForm = () => {
    document.getElementById(FIELD_ID.fire)?.focus({ preventScroll: true });
    requestFocus(FIELD_ID.fire, "anchor");
  };

  const leave = () => {
    if (draft && draftHasContent(draft)) {
      toast({ title: "Rascunho salvo neste aparelho", description: `As leituras de ${draft.vehicle.licensePlate} continuam aqui até o envio.`, variant: "info" });
    }
    onBack();
  };

  // ---------------------------------------------------------------- rascunho oferecido
  const resumeOffer = () => {
    if (!offer || !data) return;
    const parentId = start.parent?.id ?? data.returnedInspection?.id ?? null;
    const next = reconcile(offer, data, parentId, order);
    setDraft(next.draft);
    setDropped(next.dropped);
    setOffer(null);
    setPhase("measure");
    requestFocus("tires-app-runner-heading", "top");
  };

  const discardOffer = async () => {
    if (!offer || !data) return;
    const n = measuredCount(offer);
    const ok = await confirm({
      title: "Descartar o rascunho?",
      description: offer.lastAttemptAt
        ? `As leituras de ${fmtInt(n)} ${plural(n, "posição", "posições")} serão apagadas deste aparelho. Um envio deste rascunho já foi tentado: se ele chegou ao servidor, começar do zero pode gerar uma segunda vistoria.`
        : `As leituras de ${fmtInt(n)} ${plural(n, "posição", "posições")} serão apagadas deste aparelho. Nada foi enviado.`,
      confirmLabel: "Descartar e começar",
      cancelLabel: "Manter",
      destructive: true,
    });
    if (!ok) return;
    clearDraft(scope, offer.vehicle.id);
    const parentId = start.parent?.id ?? data.returnedInspection?.id ?? null;
    const fresh = createDraft(vehicleFrom(data), parentId);
    setDraft({ ...fresh, current: order[0] ?? null });
    setOffer(null);
    setDropped([]);
    setPhase("measure");
    requestFocus("tires-app-runner-heading", "top");
  };

  // ---------------------------------------------------------------- envio
  const send = async () => {
    if (!draft || sending) return;
    if (stats.invalid > 0 || stats.measured === 0) return;
    const attemptAt = new Date().toISOString();
    const lostEditsIfDuplicate = draft.lastAttemptAt !== null && draft.editedAfterAttempt;
    const attemptDraft: TireDraft = { ...draft, lastAttemptAt: attemptAt, editedAfterAttempt: false };
    // Antes da rede: se a resposta se perder, o rascunho já sabe que houve tentativa.
    saveDraft(scope, attemptDraft);
    setDraft(attemptDraft);
    setSending(true);
    setSendError(null);
    const input: TireAppSubmitInput = {
      clientSubmissionId: attemptDraft.clientSubmissionId,
      vehicleId: attemptDraft.vehicle.id,
      parentInspectionId: attemptDraft.parentInspectionId,
      startedAt: attemptDraft.startedAt,
      inspectedAt: draft.updatedAt,
      generalObservation: attemptDraft.generalObservation.trim() || null,
      items: order
        .filter((code) => checks[code]?.hasContent)
        .map((code) => {
          const r = attemptDraft.readings[code] ?? emptyReading();
          return {
            positionCode: code,
            fireNumberRead: normalizeFire(r.fire) || null,
            tread1: r.t1.trim() || null,
            tread2: r.t2.trim() || null,
            tread3: r.t3.trim() || null,
            tread4: r.t4.trim() || null,
            psiRead: r.psi.trim() || null,
            observation: r.obs.trim() || null,
          };
        }),
    };
    let response: Result<TireAppSubmitResult>;
    try {
      response = await loaders.submit(input);
    } catch {
      response = { ok: false, error: NETWORK_ERROR };
    }
    setSending(false);
    if (!response.ok || !response.data) {
      setSendError(response.error ?? "Não foi possível enviar a vistoria.");
      requestFocus("tires-app-send-error", "element");
      return;
    }
    // Só agora o rascunho pode sair: o banco confirmou com protocolo.
    clearDraft(scope, attemptDraft.vehicle.id);
    setResult({ data: response.data, lostEdits: response.data.duplicate && lostEditsIfDuplicate });
    setPhase("done");
    requestFocus("tires-app-runner-heading", "top");
  };

  // ======================================================================
  if (isLoading || !loaded) {
    return (
      <Screen>
        <AppBar label={`Medição · ${plate}`} onBack={onBack} />
        <LoadingState variant="block" label="Montando o diagrama do veículo…" />
      </Screen>
    );
  }

  if (loaded.error || !data) {
    return (
      <Screen>
        <AppBar label={`Medição · ${plate}`} onBack={onBack} />
        <ErrorState
          title="Não foi possível abrir a vistoria deste veículo."
          description={loaded.error}
          onRetry={() => setAttempt((n) => n + 1)}
          action={
            <Button variant="secondary" onClick={onBack}>
              Escolher outro veículo
            </Button>
          }
        />
      </Screen>
    );
  }

  if (order.length === 0) {
    return (
      <Screen>
        <AppBar label={`Medição · ${plate}`} onBack={onBack} />
        <EmptyState
          variant="panel"
          icon={<ClipboardCheck />}
          title="Nenhuma posição para verificar"
          description="Este veículo não tem layout de eixos cadastrado nem pneus em uso na fotografia oficial. Fale com a equipe de Gestão de Pneus."
          action={
            <Button variant="secondary" onClick={onBack}>
              Escolher outro veículo
            </Button>
          }
        />
      </Screen>
    );
  }

  // ------------------------------------------------------------- rascunho
  if (phase === "resume" && offer) {
    const n = measuredCount(offer);
    return (
      <Screen>
        <AppBar label={`Rascunho · ${plate}`} onBack={onBack} />
        <section className="flex flex-col gap-3 rounded-lg border border-warning-border bg-warning-soft p-4 shadow-card" data-testid="tires-app-resume">
          <div>
            <p className="text-caption text-warning-soft-fg">{vehicleLine(vehicle)}</p>
            <h2 id="tires-app-runner-heading" tabIndex={-1} className="text-h3 font-semibold text-fg outline-none">
              Há um rascunho deste veículo
            </h2>
            <p className="mt-1 text-body-sm text-fg-secondary">
              Iniciado em {formatStamp(offer.startedAt)} · última alteração em {formatStamp(offer.updatedAt)}. {fmtInt(n)} de {fmtInt(order.length)}{" "}
              {plural(order.length, "posição", "posições")} com leitura, salvas só neste aparelho.
            </p>
          </div>
          {offer.lastAttemptAt ? (
            <Alert variant="info">
              <AlertDescription>
                Um envio deste rascunho foi tentado em {formatStamp(offer.lastAttemptAt)}. Se ele chegou ao servidor, enviar de novo devolve o mesmo protocolo,
                sem duplicar a vistoria.
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2">
            <Button size="lg" className="h-12" leadingIcon={<RotateCcw />} onClick={resumeOffer} data-testid="tires-app-resume-continue">
              Retomar rascunho
            </Button>
            <Button size="lg" variant="outline" className="h-12" leadingIcon={<Trash2 />} onClick={() => void discardOffer()} data-testid="tires-app-resume-discard">
              Descartar e começar
            </Button>
          </div>
        </section>
      </Screen>
    );
  }

  if (!draft) return null;

  // ---------------------------------------------------------------- protocolo
  if (phase === "done" && result) {
    const r = result.data;
    return (
      <Screen>
        <div className="flex flex-col items-center gap-3 rounded-lg border border-success-border bg-success-soft px-4 py-6 text-center shadow-card sm:p-6" data-testid="tires-app-done">
          <span className="flex size-16 items-center justify-center rounded-full bg-success text-success-fg">
            <CheckCircle2 className="size-9" aria-hidden />
          </span>
          <div className="flex flex-col gap-1">
            <h2 id="tires-app-runner-heading" tabIndex={-1} className="text-h3 font-semibold text-fg outline-none">
              {r.duplicate ? "Vistoria já recebida" : "Vistoria enviada"}
            </h2>
            <p className="text-caption uppercase tracking-wide text-fg-muted">Protocolo</p>
            <p className="break-all font-mono text-h2 font-semibold tracking-wide text-fg" data-testid="tires-app-protocol">
              {r.protocol}
            </p>
            <p className="text-caption text-fg-muted">
              {draft.vehicle.licensePlate} · {formatStamp(r.submittedAt)}
            </p>
          </div>
          <div className="w-full rounded-lg border border-border bg-surface-raised px-3 py-3 shadow-card">
            <p className="text-h2 font-semibold tabular-nums text-fg" data-testid="tires-app-done-measured">
              {fmtInt(r.positionsMeasured)} <span className="text-body font-normal text-fg-muted">de {fmtInt(r.positionsExpected)}</span>
            </p>
            <p className="text-caption font-medium text-fg-muted">posições medidas</p>
          </div>
          {r.duplicate ? (
            <p className="text-caption text-fg-secondary">
              Este envio já havia chegado antes; o protocolo é o mesmo e nada foi duplicado.
              {result.lostEdits ? " As alterações feitas depois da primeira tentativa não entraram nesta vistoria." : ""}
            </p>
          ) : null}
          <div className="flex flex-col gap-2 text-left text-body-sm text-fg-secondary">
            <p className="flex items-start gap-2">
              <EyeOff className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span>As leituras serão comparadas pela equipe com a base oficial; você não verá a comparação.</span>
            </p>
            <p className="flex items-start gap-2">
              <ClipboardCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span>A vistoria não altera a fotografia oficial: segue para revisão e é conciliada com o próximo Rodopar.</span>
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button size="lg" className="h-14" leadingIcon={<Plus />} onClick={() => onDone("vehicles")} data-testid="tires-app-done-new">
            Nova vistoria
          </Button>
          <Button size="lg" variant="secondary" className="h-14" leadingIcon={<History />} onClick={() => onDone("history")} data-testid="tires-app-done-history">
            Minhas vistorias
          </Button>
        </div>
      </Screen>
    );
  }

  // ---------------------------------------------------------------- revisão
  if (phase === "review") {
    const unmeasured = order.filter((code) => !checks[code]?.measured);
    const invalid = order.filter((code) => checks[code]?.state === "invalid");
    const obsLength = draft.generalObservation.length;
    const canSend = stats.invalid === 0 && stats.measured > 0 && !sending;
    return (
      <Screen>
        <AppBar label={`Revisão · ${plate}`} onBack={() => backToMeasure()} backLabel="Voltar à medição" measured={stats.measured} total={stats.total} />
        <header className="flex flex-col gap-1">
          <p className="text-caption text-fg-muted">{vehicleLine(vehicle)}</p>
          <h2 id="tires-app-runner-heading" tabIndex={-1} className="text-h3 font-semibold text-fg outline-none">
            Revisar e enviar
          </h2>
          <p className="text-body-sm text-fg-secondary">Confira as suas leituras. Você ainda pode voltar e corrigir qualquer posição.</p>
        </header>

        {sendError ? (
          <Alert variant="danger" id="tires-app-send-error" tabIndex={-1} className="outline-none" data-testid="tires-app-send-error">
            <AlertTitle>Não foi possível enviar</AlertTitle>
            <AlertDescription>
              <p>{sendError}</p>
              <p className="mt-1">As leituras continuam salvas neste aparelho. Tentar de novo usa o mesmo identificador de envio: não haverá vistoria duplicada.</p>
            </AlertDescription>
          </Alert>
        ) : null}

        {invalid.length > 0 ? (
          <Alert variant="danger" data-testid="tires-app-review-invalid">
            <AlertTitle>
              {fmtInt(invalid.length)} {plural(invalid.length, "posição precisa", "posições precisam")} de correção
            </AlertTitle>
            <AlertDescription>
              <p>Há valores fora do formato ou acima dos limites técnicos. Corrija antes de enviar.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {invalid.map((code) => (
                  <Button key={code} size="sm" variant="outline" onClick={() => backToMeasure(code)}>
                    Corrigir {code}
                  </Button>
                ))}
              </div>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid grid-cols-3 gap-2" data-testid="tires-app-review-stats">
          <Stat label="Medidas" value={`${fmtInt(stats.measured)}/${fmtInt(stats.total)}`} tone={stats.measured === stats.total ? "success" : "neutral"} />
          <Stat label={plural(stats.partial, "Parcial", "Parciais")} value={fmtInt(stats.partial)} tone={stats.partial > 0 ? "warning" : "neutral"} />
          <Stat label="Não medidas" value={fmtInt(unmeasured.length)} tone={unmeasured.length > 0 ? "warning" : "neutral"} />
        </div>

        {stats.measured === 0 ? (
          <Alert variant="warning" data-testid="tires-app-review-empty">
            <AlertTitle>Nenhuma posição medida</AlertTitle>
            <AlertDescription>Meça ao menos uma posição (Nº Fogo, sulco ou PSI) antes de enviar.</AlertDescription>
          </Alert>
        ) : unmeasured.length > 0 ? (
          <Alert variant="warning" data-testid="tires-app-review-incomplete">
            <AlertTitle>Medição incompleta</AlertTitle>
            <AlertDescription>
              {fmtInt(unmeasured.length)} {plural(unmeasured.length, "posição ficou", "posições ficaram")} sem leitura: {unmeasured.join(", ")}. Você pode enviar
              assim mesmo — {plural(unmeasured.length, "ela será registrada", "elas serão registradas")} como não {plural(unmeasured.length, "medida", "medidas")}.
            </AlertDescription>
          </Alert>
        ) : null}

        <section className="overflow-hidden rounded-lg border border-border bg-surface-raised shadow-card" aria-labelledby="tires-app-review-list">
          <h3 id="tires-app-review-list" className="border-b border-border bg-surface-secondary px-4 py-2 text-caption font-semibold uppercase tracking-wide text-fg-muted">
            Suas leituras por posição
          </h3>
          <ul className="divide-y divide-border">
            {order.map((code) => {
              const r = draft.readings[code];
              const c = checks[code];
              const p = positionsByCode.get(code);
              return (
                <li key={code} data-testid={`tires-app-review-${code}`} data-state={c.state}>
                  <button
                    type="button"
                    onClick={() => backToMeasure(code)}
                    className="flex min-h-14 w-full items-start gap-3 px-4 py-3 text-left hfm-transition hover:bg-hover-overlay hfm-focus-ring"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-mono text-body-sm font-semibold text-fg">{code}</span>
                        <span className="min-w-0 text-body-sm text-fg-secondary">{p?.label ?? code}</span>
                      </span>
                      <span className="mt-0.5 block text-caption text-fg-muted">{c.measured ? readingSummary(r) : "Não medida"}</span>
                      {r?.obs.trim() ? <span className="mt-0.5 block text-caption text-fg-secondary">Obs.: {r.obs.trim()}</span> : null}
                    </span>
                    <StatusBadge status={STATE_TONE[c.state]} size="sm" className="shrink-0">
                      {STATE_LABEL[c.state]}
                    </StatusBadge>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <FormField
          id="tires-app-general-observation"
          label="Observação geral"
          labelHint={`Opcional · ${fmtInt(obsLength)}/1.000`}
          helperText="Algo sobre a vistoria como um todo (clima, acesso ao veículo, posição que não pôde ser medida)."
        >
          <Textarea
            autoResize
            minRows={2}
            maxLength={1000}
            className="text-h3"
            value={draft.generalObservation}
            disabled={sending}
            onChange={(e) => setGeneralObservation(e.target.value)}
            data-testid="tires-app-general-observation"
          />
        </FormField>

        <Alert variant="info" icon={<EyeOff />}>
          <AlertDescription>
            Leitura cega: depois do envio, a equipe compara as suas leituras com a base oficial. A vistoria não altera a fotografia oficial — segue para
            revisão e é conciliada com o próximo Rodopar.
          </AlertDescription>
        </Alert>

        <Footer>
          <Button size="lg" variant="secondary" className="h-12" leadingIcon={<ArrowLeft />} onClick={() => backToMeasure()} disabled={sending}>
            Voltar
          </Button>
          <Button
            size="lg"
            className="h-12 flex-1"
            leadingIcon={<Send />}
            onClick={() => void send()}
            loading={sending}
            disabled={!canSend && !sending}
            data-testid="tires-app-submit"
          >
            {sending ? "Enviando…" : "Enviar vistoria"}
          </Button>
        </Footer>
      </Screen>
    );
  }

  // ---------------------------------------------------------------- medição
  const position = current ? positionsByCode.get(current) : undefined;
  const reading = (current && draft.readings[current]) || emptyReading();
  const check = current ? checks[current] : undefined;
  const showError = (field: ReadingField) => !!current && !!check?.errors[field] && (!!revealed[current] || !!touched[`${current}.${field}`]);
  const markTouched = (field: ReadingField) => {
    if (current) setTouched((t) => (t[`${current}.${field}`] ? t : { ...t, [`${current}.${field}`]: true }));
  };
  const onEnter = (field: ReadingField) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const next = ENTER_NEXT[field];
    if (next) document.getElementById(FIELD_ID[next])?.focus();
    else step(1, "fire");
  };
  const treadErrors = TREAD_FIELDS.flatMap((f, i) => (showError(f) ? [`S${i + 1}: ${check?.errors[f]}`] : []));
  const isLast = currentIndex === order.length - 1;

  const tireState = (p: { code: string }): AxleTireState => {
    const s = checks[p.code]?.state ?? "empty";
    if (s === "complete") return { tone: "success", caption: "✓", srText: "medida completa" };
    if (s === "partial") return { tone: "warning", caption: "Parcial", srText: "medida parcial" };
    if (s === "invalid") return { tone: "danger", caption: "Erro", srText: "leitura com erro, a corrigir" };
    return { tone: null, srText: "pendente" };
  };

  return (
    <Screen wide>
      <AppBar label={`Medição · ${plate}`} onBack={leave} backLabel="Sair (o rascunho fica salvo)" measured={stats.measured} total={stats.total} />
      <header className="flex flex-col gap-1">
        <p className="text-caption text-fg-muted">
          {vehicleLine(vehicle)}
          {placeLine(vehicle) ? <span className="block">{placeLine(vehicle)}</span> : null}
        </p>
        <h2 id="tires-app-runner-heading" tabIndex={-1} className="text-h3 font-semibold text-fg outline-none">
          Medição dos pneus
        </h2>
        <p className="text-body-sm text-fg-secondary">Toque num pneu ou siga a ordem. Registre exatamente o que ler no pneu.</p>
      </header>

      {parent ? (
        <Alert variant="warning" data-testid="tires-app-returned-note">
          <AlertTitle>Nova medição da vistoria {parent.protocol}</AlertTitle>
          <AlertDescription>
            <p>
              <span className="font-semibold">Nota do revisor:</span> {parent.reviewNote?.trim() || "sem nota registrada."}
            </p>
            {parent.reviewedAt ? <p className="mt-1 text-caption">Retornada em {formatStamp(parent.reviewedAt)}.</p> : null}
            <p className="mt-1">Meça o veículo de novo; esta medição substitui a anterior.</p>
          </AlertDescription>
        </Alert>
      ) : null}

      {dropped.length > 0 ? (
        <Alert variant="neutral" onDismiss={() => setDropped([])} dismissLabel="Entendi">
          <AlertDescription>
            {plural(dropped.length, "A posição", "As posições")} {dropped.join(", ")} do rascunho não {plural(dropped.length, "faz", "fazem")} mais parte deste
            veículo e {plural(dropped.length, "foi ignorada", "foram ignoradas")}.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-4 md:grid md:grid-cols-[minmax(0,auto)_minmax(0,1fr)] md:items-start md:gap-6">
        <section
          aria-labelledby="tires-app-diagram-title"
          className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-3 shadow-card md:sticky md:top-[calc(var(--topbar-height)_+_4.5rem)]"
          data-testid="tires-app-diagram"
        >
          <div className="flex min-w-0 flex-col px-1">
            <h3 id="tires-app-diagram-title" className="text-body-sm font-semibold text-fg">
              Posições do veículo
            </h3>
            {data.layout.name ? <span className="text-caption text-fg-muted">{data.layout.name}</span> : null}
          </div>
          <AxleDiagram
            positions={data.positions}
            state={tireState}
            selected={current}
            onSelect={(code) => goTo(code)}
            label={`Posições de ${plate}: toque para medir`}
            testIdPrefix="tires-app-tire"
          />
          <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-caption text-fg-muted" aria-label="Legenda">
            {(["complete", "partial", "invalid", "empty"] as ReadingState[]).map((s) => (
              <li key={s} className="flex items-center gap-1.5">
                <span aria-hidden className={cn("inline-block size-3 rounded-sm border-2", s === "empty" ? "border-border bg-surface-sunken" : statusTone(STATE_TONE[s]).softClassName)} />
                {s === "complete" ? "✓ Completa" : STATE_LABEL[s]}
              </li>
            ))}
          </ul>
        </section>

        {position && current ? (
          <section
            ref={formRef}
            data-scroll-anchor
            aria-labelledby="tires-app-position-heading"
            className="flex scroll-mt-36 flex-col gap-4 rounded-lg border border-border bg-surface-raised p-4 shadow-card"
            data-testid="tires-app-position"
            data-position={current}
          >
            <div className="flex items-start gap-3">
              <span className="flex h-10 min-w-12 shrink-0 items-center justify-center rounded-md bg-primary-soft px-2 font-mono text-body-sm font-semibold text-primary-soft-fg">
                {current}
              </span>
              <div className="min-w-0 flex-1">
                <h3 id="tires-app-position-heading" tabIndex={-1} className="text-body font-semibold text-fg outline-none">
                  {position.label}
                </h3>
                <p className="text-caption text-fg-muted">
                  Posição {fmtInt(currentIndex + 1)} de {fmtInt(order.length)}
                </p>
              </div>
              <StatusBadge status={STATE_TONE[check?.state ?? "empty"]} size="sm" className="shrink-0" data-testid="tires-app-position-state">
                {STATE_LABEL[check?.state ?? "empty"]}
              </StatusBadge>
            </div>

            <FormField
              id={FIELD_ID.fire}
              label="Nº Fogo lido"
              helperText="Como gravado no pneu, com zeros à esquerda."
              error={showError("fire") ? check?.errors.fire : undefined}
            >
              <Input
                size="lg"
                className="font-mono text-h2 tracking-wide"
                inputMode="text"
                autoCapitalize="characters"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="next"
                maxLength={30}
                value={reading.fire}
                onChange={(e) => updateField(current, "fire", typeFire(e.target.value))}
                onBlur={() => markTouched("fire")}
                onKeyDown={onEnter("fire")}
                data-testid="tires-app-input-fire"
              />
            </FormField>

            <fieldset className="flex min-w-0 flex-col gap-1.5">
              <legend className="mb-1.5 text-label font-medium text-fg">
                Sulco <span className="font-normal text-fg-muted">(mm, de 0 a {fmtInt(limits.maxTreadMm)})</span>
              </legend>
              <div className="grid grid-cols-4 gap-2">
                {TREAD_FIELDS.map((f, i) => (
                  <div key={f} className="flex min-w-0 flex-col gap-1">
                    <label htmlFor={FIELD_ID[f]} className="text-center text-caption font-medium text-fg-muted">
                      S{i + 1}
                    </label>
                    <Input
                      id={FIELD_ID[f]}
                      size="lg"
                      className="px-1 text-center text-h3 tabular-nums"
                      inputMode="decimal"
                      autoComplete="off"
                      enterKeyHint="next"
                      placeholder="0,0"
                      aria-invalid={showError(f) || undefined}
                      aria-describedby={showError(f) ? "tires-app-tread-error" : undefined}
                      value={reading[f]}
                      onChange={(e) => updateField(current, f, typeDecimal(e.target.value))}
                      onBlur={() => markTouched(f)}
                      onKeyDown={onEnter(f)}
                      data-testid={`tires-app-input-${f}`}
                    />
                  </div>
                ))}
              </div>
              {treadErrors.length > 0 ? (
                <p id="tires-app-tread-error" role="alert" className="flex items-start gap-1.5 text-helper text-danger">
                  <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                  <span>{treadErrors.join(" · ")}</span>
                </p>
              ) : null}
            </fieldset>

            <FormField
              id={FIELD_ID.psi}
              label="Pressão"
              labelHint={`PSI, de 0 a ${fmtInt(limits.maxPsi)}`}
              error={showError("psi") ? check?.errors.psi : undefined}
            >
              <Input
                size="lg"
                className="text-h3 tabular-nums"
                inputMode="decimal"
                autoComplete="off"
                enterKeyHint={isLast ? "done" : "next"}
                placeholder="Ex.: 110"
                trailingAddon="PSI"
                value={reading.psi}
                onChange={(e) => updateField(current, "psi", typeDecimal(e.target.value))}
                onBlur={() => markTouched("psi")}
                onKeyDown={onEnter("psi")}
                data-testid="tires-app-input-psi"
              />
            </FormField>

            <FormField id={FIELD_ID.obs} label="Observação da posição" labelHint="Opcional" error={showError("obs") ? check?.errors.obs : undefined}>
              <Textarea
                autoResize
                minRows={1}
                maxLength={500}
                className="text-h3"
                placeholder="Ex.: pneu inacessível, válvula danificada."
                value={reading.obs}
                onChange={(e) => updateField(current, "obs", e.target.value)}
                onBlur={() => markTouched("obs")}
                data-testid="tires-app-input-obs"
              />
            </FormField>

            {check?.hasContent ? (
              <div className="flex justify-end">
                <Button variant="ghost" size="sm" className="h-11" leadingIcon={<Trash2 />} onClick={() => clearPosition(current)}>
                  Limpar esta posição
                </Button>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>

      <Button
        variant="outline"
        size="lg"
        className="h-12 w-full md:ml-auto md:w-auto"
        trailingIcon={<ClipboardCheck />}
        onClick={openReview}
        data-testid="tires-app-review"
      >
        Revisar e enviar ({fmtInt(stats.measured)} de {fmtInt(stats.total)} medidas)
      </Button>

      <Footer>
        <Button
          size="lg"
          variant="secondary"
          className="h-12 px-3"
          leadingIcon={<ArrowLeft />}
          onClick={() => step(-1)}
          disabled={currentIndex <= 0}
          data-testid="tires-app-prev"
        >
          Anterior
        </Button>
        {!formVisible ? (
          <Button size="lg" className="h-12 flex-1" trailingIcon={<ArrowDown />} onClick={toForm} data-testid="tires-app-to-form">
            Medir {current}
          </Button>
        ) : isLast ? (
          <Button size="lg" className="h-12 flex-1" trailingIcon={<ClipboardCheck />} onClick={() => step(1)} data-testid="tires-app-next">
            Revisar envio
          </Button>
        ) : (
          <Button size="lg" className="h-12 flex-1" trailingIcon={<ArrowRight />} onClick={() => step(1)} data-testid="tires-app-next">
            Próxima posição
          </Button>
        )}
      </Footer>
    </Screen>
  );
}

/* -------------------------------------------------------------------------- */

const nfTyped = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
/** Número digitado mostrado em pt-BR ("10.2" → "10,2"); vazio → "—". */
function typed(value: string): string {
  const n = parseDecimal(value);
  if (n === null) return "—";
  return Number.isNaN(n) ? value : nfTyped.format(n);
}

function readingSummary(r: Reading | undefined): string {
  if (!r) return "Não medida";
  const parts: string[] = [];
  parts.push(`Fogo ${normalizeFire(r.fire) || "—"}`);
  const treads = TREAD_FIELDS.map((f) => typed(r[f]));
  parts.push(`Sulcos ${treads.join(" / ")} mm`);
  parts.push(`${typed(r.psi)} PSI`);
  return parts.join(" · ");
}

/** Coluna de uma etapa: estreita (celular) e, na medição, larga o bastante para diagrama + formulário. */
export function Screen({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return <div className={cn("mx-auto flex w-full flex-col gap-4", wide ? "max-w-md md:max-w-4xl" : "max-w-md")}>{children}</div>;
}

/** Barra fixa do aplicativo: voltar, rótulo e (quando há) o andamento da medição. */
export function AppBar({
  label,
  onBack,
  backLabel = "Voltar",
  measured,
  total,
}: {
  label: string;
  onBack: () => void;
  backLabel?: string;
  measured?: number;
  total?: number;
}) {
  const pct = total ? Math.round(((measured ?? 0) / total) * 100) : null;
  return (
    <div
      className="sticky top-(--topbar-height) z-10 -mx-4 flex items-center gap-2 border-b border-border bg-surface-raised/95 px-3 py-2 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:shadow-card"
      data-testid="tires-app-bar"
    >
      <button
        type="button"
        onClick={onBack}
        aria-label={backLabel}
        title={backLabel}
        className="flex size-11 shrink-0 items-center justify-center rounded-md text-fg-secondary hfm-transition hover:bg-hover-overlay hfm-focus-ring"
        data-testid="tires-app-back"
      >
        <ArrowLeft className="size-5" aria-hidden />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 text-caption">
          <span className="truncate font-semibold text-fg">{label}</span>
          {pct !== null ? (
            <span className="shrink-0 tabular-nums text-fg-muted" data-testid="tires-app-progress">
              {fmtInt(measured ?? 0)} de {fmtInt(total ?? 0)} medidas
            </span>
          ) : null}
        </div>
        {pct !== null ? <Progress value={pct} className="mt-1" srLabel="Posições medidas" /> : null}
      </div>
    </div>
  );
}

/** Ações da etapa, fixas no rodapé em telas pequenas. */
function Footer({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 flex gap-2 border-t border-border bg-surface-raised/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:pb-3 sm:shadow-card">
      {children}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "success" | "warning" | "neutral" }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface-raised px-2 py-3 text-center shadow-card">
      <p className={cn("text-h3 font-semibold tabular-nums", tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-fg")}>{value}</p>
      <p className="truncate text-caption font-medium text-fg-muted">{label}</p>
    </div>
  );
}
