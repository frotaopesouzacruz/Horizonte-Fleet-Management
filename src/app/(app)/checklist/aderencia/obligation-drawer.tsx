"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, ShieldAlert, ThumbsDown, ThumbsUp } from "lucide-react";
import {
  Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CheckboxField } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { Skeleton } from "@/components/feedback/skeleton";
import { NativeSelect } from "@/components/governance/selects";
import { useToast } from "@/components/feedback/toast";
import {
  decideRequest, loadObligationDetail, overrideStatus, requestExclusion,
} from "@/lib/adherence/actions";
import type { AdherenceOptions, ObligationDetail } from "@/lib/adherence/queries";
import { CONTEXT_LABEL, formatDateBr, formatDateTimeBr, statusMeta } from "./status";
import type { AdherencePerms } from "./adherence-view";

export interface ObligationDrawerProps {
  obligationId: string | null;
  onOpenChange: (open: boolean) => void;
  options: AdherenceOptions;
  perms: AdherencePerms;
  onChanged: () => void;
  onNavigateSibling: (id: string) => void;
}

type Mode = "idle" | "request" | "override" | "reject";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-caption text-fg-muted">{label}</span>
      <span className="text-body-sm text-fg">{children ?? "—"}</span>
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  fidelization: "Fidelização (posição/BR)",
  allocation: "Alocação operacional",
  import: "Importação",
};

/**
 * O detalhe da célula (§48): veículo, data, contexto, de onde veio a
 * obrigação, a execução vinculada, as justificativas e o histórico. As ações
 * aparecem conforme a permissão e o estado — e nenhuma delas cria execução:
 * solicitar e decidir mexem na justificativa; corrigir é a exceção
 * autorizada da §32, com justificativa obrigatória e marcada na auditoria.
 */
export function ObligationDrawer({ obligationId, onOpenChange, options, perms, onChanged, onNavigateSibling }: ObligationDrawerProps) {
  return (
    <Drawer open={Boolean(obligationId)} onOpenChange={onOpenChange}>
      <DrawerContent size="lg">
        {obligationId ? (
          // A chave remonta o corpo a cada obrigação: estado novo, sem efeito
          // de reset e sem o primeiro quadro mostrando o detalhe anterior.
          <ObligationBody key={obligationId} obligationId={obligationId} onOpenChange={onOpenChange}
            options={options} perms={perms} onChanged={onChanged} onNavigateSibling={onNavigateSibling} />
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}

function ObligationBody({ obligationId, onOpenChange, options, perms, onChanged, onNavigateSibling }: ObligationDrawerProps & { obligationId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [detail, setDetail] = React.useState<ObligationDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<Mode>("idle");
  const [reasonCode, setReasonCode] = React.useState("");
  const [justification, setJustification] = React.useState("");
  const [evidence, setEvidence] = React.useState("");
  const [inherit, setInherit] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [busy, startTransition] = React.useTransition();
  const loading = detail === null && error === null;

  const load = React.useCallback(() => {
    startTransition(async () => {
      const result = await loadObligationDetail(obligationId);
      if (result.ok && result.data) { setDetail(result.data); setError(null); }
      else { setDetail(null); setError(result.error ?? "Não foi possível carregar."); }
    });
  }, [obligationId]);

  React.useEffect(() => { load(); }, [load]);

  const done = () => { router.refresh(); onChanged(); setMode("idle"); load(); };

  const reasons = options.reasons.filter(
    (r) => r.isActive && (detail?.context === "retorno" ? r.appliesToReturn : r.appliesToDeparture),
  );
  const chosen = reasons.find((r) => r.code === reasonCode);
  const pendingReq = detail?.requests.find((r) => r.status === "pending") ?? null;
  const past = detail ? detail.operationalDate <= options.today : false;
  const canRequest = Boolean(detail && perms.request && !detail.isDone && !detail.isExcluded && !detail.hasPendingRequest && past);
  const canOverride = Boolean(detail && perms.override && !detail.isDone && !detail.isExcluded && !detail.hasPendingRequest && past);

  const submitRequest = () => startTransition(async () => {
    if (!detail) return;
    const result = await requestExclusion({ obligationId: detail.id, reasonCode, justification, evidenceReference: evidence || null, inheritToReturn: inherit });
    if (result.ok) {
      toast({ title: result.data?.inheritedId ? "Solicitação registrada para saída e retorno." : "Solicitação registrada. Aguarda decisão.", variant: "success" });
      done();
    } else toast({ title: result.error ?? "Não foi possível registrar.", variant: "danger" });
  });

  const submitOverride = () => startTransition(async () => {
    if (!detail) return;
    const result = await overrideStatus({ obligationId: detail.id, reasonCode, justification });
    if (result.ok) { toast({ title: "Correção administrativa aplicada e auditada.", variant: "success" }); done(); }
    else toast({ title: result.error ?? "Não foi possível corrigir.", variant: "danger" });
  });

  const decide = (decision: "approve" | "reject") => startTransition(async () => {
    if (!pendingReq) return;
    const result = await decideRequest({ requestId: pendingReq.id, decision, note: note || null });
    if (result.ok) { toast({ title: decision === "approve" ? "Solicitação aprovada." : "Solicitação rejeitada.", variant: "success" }); done(); }
    else toast({ title: result.error ?? "Não foi possível decidir.", variant: "danger" });
  });

  const meta = detail ? statusMeta(detail.statusCode) : null;

  return (
    <>
        <DrawerHeader>
          <DrawerTitle>
            {detail ? `${detail.fleetCode ?? "—"} · ${detail.licensePlate ?? ""}` : "Obrigação"}
          </DrawerTitle>
          <DrawerDescription>
            {detail ? `${CONTEXT_LABEL[detail.context]} · ${formatDateBr(detail.operationalDate)}` : "Carregando…"}
          </DrawerDescription>
        </DrawerHeader>

        <DrawerBody className="flex flex-col gap-4">
          {loading ? (
            <div className="flex flex-col gap-3"><Skeleton className="h-6 w-40" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
          ) : null}
          {error ? <Alert variant="danger"><AlertDescription>{error}</AlertDescription></Alert> : null}

          {detail && meta ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={meta.tone}>{detail.statusLabel || meta.label}</StatusBadge>
                {detail.isProvisional ? <Badge variant="warning">Dia vigente: ainda pode ser regularizado</Badge> : null}
                {detail.hasPendingRequest ? <Badge variant="warning">Justificativa pendente</Badge> : null}
                {detail.isExcluded ? <Badge variant="info">Fora do denominador</Badge> : null}
                {detail.isDue && !detail.isDone ? <Badge variant="neutral">No denominador</Badge> : null}
                {detail.detectedCondition ? <Badge variant="neutral">Condição detectada: {statusMeta(detail.detectedCondition).label}</Badge> : null}
              </div>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <Fact label="Operação">{detail.operationName}</Fact>
                <Fact label="Cidade">{detail.cityName ? `${detail.cityName}${detail.stateUf ? `/${detail.stateUf}` : ""}` : null}</Fact>
                <Fact label="BR">{detail.brCode}</Fact>
                <Fact label="Filial">{detail.branchName}</Fact>
                <Fact label="Liderança na data">{detail.leaderName}</Fact>
                <Fact label="Tipo de equipamento">{detail.vehicleTypeName}</Fact>
                <Fact label="Fonte da obrigação">{SOURCE_LABEL[detail.source] ?? detail.source}</Fact>
                <Fact label="Regra de elegibilidade">{detail.ruleName ? `${detail.ruleName}${detail.ruleVersion ? ` · v${detail.ruleVersion}` : ""}` : null}</Fact>
                <Fact label="Janela">{formatDateTimeBr(detail.expectedAt)} → {formatDateTimeBr(detail.deadlineAt)}</Fact>
              </div>

              <section className="rounded-md border border-border p-3">
                <h4 className="mb-2 text-label font-semibold text-fg">Execução</h4>
                {detail.execution ? (
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                    <Fact label="Enviado em">{formatDateTimeBr(detail.execution.submittedAt)}</Fact>
                    <Fact label="Colaborador">{detail.execution.employeeName}</Fact>
                    <Fact label="Versão do checklist">{detail.execution.versionLabel}</Fact>
                    <Fact label="Perguntas aplicáveis">{detail.execution.applicableQuestions}</Fact>
                    <Fact label="Conformes / inconformes">{detail.execution.conforming} / {detail.execution.nonConforming}{detail.execution.criticalNonConforming > 0 ? ` (${detail.execution.criticalNonConforming} críticas)` : ""}</Fact>
                    <Fact label="Conciliação">{detail.execution.matchSource === "trigger" ? "No envio (gatilho)" : detail.execution.matchSource}</Fact>
                  </div>
                ) : (
                  <p className="text-body-sm text-fg-muted">Nenhuma execução válida conciliada. A ausência do registro não elimina a obrigação (§17).</p>
                )}
                {detail.otherExecutions.length > 0 ? (
                  <p className="mt-2 text-caption text-fg-muted">
                    {detail.otherExecutions.length} outra(s) execução(ões) recebida(s) para esta obrigação, registradas como duplicidade e não contadas.
                  </p>
                ) : null}
              </section>

              {detail.sibling ? (
                <Button variant="link" leadingIcon={<ArrowLeftRight />} onClick={() => onNavigateSibling(detail.sibling!.id)} className="self-start">
                  Ver {detail.sibling.context === "saida" ? "a saída" : "o retorno"} do mesmo dia · {statusMeta(detail.sibling.status).label}
                </Button>
              ) : null}

              <section className="rounded-md border border-border p-3">
                <h4 className="mb-2 text-label font-semibold text-fg">Justificativas e decisões</h4>
                {detail.requests.length === 0 ? (
                  <p className="text-body-sm text-fg-muted">Nenhuma solicitação para esta obrigação.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {detail.requests.map((r) => (
                      <li key={r.id} className="rounded-sm border border-border bg-surface-secondary p-2 text-body-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge size="sm" status={r.status === "approved" ? "success" : r.status === "rejected" ? "danger" : r.status === "pending" ? "warning" : "neutral"}>
                            {r.status === "approved" ? "Aprovada" : r.status === "rejected" ? "Rejeitada" : r.status === "pending" ? "Pendente" : "Cancelada"}
                          </StatusBadge>
                          <span className="font-medium text-fg">{r.reasonName}</span>
                          {r.isOverride ? <Badge variant="highlight">Correção administrativa</Badge> : null}
                          {r.source === "inherited" ? <Badge variant="neutral">Herdada da saída</Badge> : null}
                          {r.source === "import" ? <Badge variant="neutral">Importação</Badge> : null}
                        </div>
                        <p className="mt-1 text-fg">{r.justification}</p>
                        {r.evidenceReference ? <p className="text-caption text-fg-muted">Evidência: {r.evidenceReference}</p> : null}
                        <p className="text-caption text-fg-muted">
                          Solicitada por {r.requestedByName ?? "—"} em {formatDateTimeBr(r.requestedAt)}
                          {r.decidedAt ? ` · decidida por ${r.decidedByName ?? "—"} em ${formatDateTimeBr(r.decidedAt)}` : ""}
                          {r.decisionNote ? ` · "${r.decisionNote}"` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {pendingReq && perms.approve ? (
                <section className="rounded-md border border-warning/40 bg-warning-soft/40 p-3">
                  <h4 className="mb-2 text-label font-semibold text-fg">Decidir a solicitação pendente</h4>
                  <FormField label="Observação" helperText="Obrigatória na rejeição." id="drawer-decision-note">
                    <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                  </FormField>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" leadingIcon={<ThumbsUp />} onClick={() => decide("approve")} disabled={busy}>Aprovar</Button>
                    <Button size="sm" variant="danger" leadingIcon={<ThumbsDown />} onClick={() => decide("reject")} disabled={busy || !note.trim()}>Rejeitar</Button>
                  </div>
                  <p className="mt-2 text-caption text-fg-muted">Quem pediu não decide a própria solicitação; o banco recusa.</p>
                </section>
              ) : null}

              {mode === "request" ? (
                <section className="rounded-md border border-border p-3">
                  <h4 className="mb-2 text-label font-semibold text-fg">Solicitar justificativa ou expurgo</h4>
                  <div className="flex flex-col gap-3">
                    <FormField label="Motivo" required id="drawer-reason">
                      <NativeSelect value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
                        <option value="">Escolha…</option>
                        {reasons.map((r) => (
                          <option key={r.code} value={r.code}>{r.name}{r.effect === "none" ? " (só registra)" : r.effect === "count_done" ? " (conta como feito, com evidência)" : ""}</option>
                        ))}
                      </NativeSelect>
                    </FormField>
                    {chosen?.description ? <p className="text-caption text-fg-muted">{chosen.description}</p> : null}
                    <FormField label="Justificativa" required id="drawer-justification" helperText="Mínimo de 5 caracteres. Fica no histórico.">
                      <Textarea rows={3} value={justification} onChange={(e) => setJustification(e.target.value)} />
                    </FormField>
                    <FormField label="Referência de evidência" required={Boolean(chosen?.requiresEvidence)} id="drawer-evidence" helperText="OS, chamado, documento ou roteiro. Sem anexos: a referência é conferida na fonte.">
                      <Input value={evidence} onChange={(e) => setEvidence(e.target.value)} />
                    </FormField>
                    {detail.context === "saida" && chosen?.inheritsToReturn && detail.sibling ? (
                      <CheckboxField label="Aplicar também ao retorno do mesmo dia" description="Só quando o retorno também está sem execução e sem solicitação." checked={inherit} onCheckedChange={(v) => setInherit(v === true)} />
                    ) : null}
                  </div>
                </section>
              ) : null}

              {mode === "override" ? (
                <section className="rounded-md border border-danger/40 p-3">
                  <h4 className="mb-2 text-label font-semibold text-fg">Correção administrativa</h4>
                  <Alert variant="warning"><AlertDescription>Exceção autorizada: cria e aprova na mesma ação, com justificativa obrigatória e marcação na auditoria. Não registra checklist como feito — isso exige evidência e aprovação por outra pessoa.</AlertDescription></Alert>
                  <div className="mt-3 flex flex-col gap-3">
                    <FormField label="Motivo" required id="drawer-override-reason">
                      <NativeSelect value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
                        <option value="">Escolha…</option>
                        {reasons.filter((r) => r.effect !== "count_done").map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                      </NativeSelect>
                    </FormField>
                    <FormField label="Justificativa" required id="drawer-override-just" helperText="Mínimo de 10 caracteres.">
                      <Textarea rows={3} value={justification} onChange={(e) => setJustification(e.target.value)} />
                    </FormField>
                  </div>
                </section>
              ) : null}
            </>
          ) : null}
        </DrawerBody>

        <DrawerFooter className="flex flex-wrap justify-end gap-2">
          {mode === "idle" ? (
            <>
              {canOverride ? <Button variant="outline" leadingIcon={<ShieldAlert />} onClick={() => { setMode("override"); setReasonCode(""); setJustification(""); }}>Correção administrativa</Button> : null}
              {canRequest ? <Button onClick={() => { setMode("request"); setReasonCode(""); setJustification(""); }}>Solicitar justificativa</Button> : null}
              <Button variant="secondary" onClick={() => onOpenChange(false)}>Fechar</Button>
            </>
          ) : mode === "request" ? (
            <>
              <Button variant="secondary" onClick={() => setMode("idle")} disabled={busy}>Voltar</Button>
              <Button onClick={submitRequest} disabled={busy || !reasonCode || justification.trim().length < 5 || (Boolean(chosen?.requiresEvidence) && !evidence.trim())}>Enviar solicitação</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setMode("idle")} disabled={busy}>Voltar</Button>
              <Button variant="danger" onClick={submitOverride} disabled={busy || !reasonCode || justification.trim().length < 10}>Aplicar correção</Button>
            </>
          )}
        </DrawerFooter>
    </>
  );
}
