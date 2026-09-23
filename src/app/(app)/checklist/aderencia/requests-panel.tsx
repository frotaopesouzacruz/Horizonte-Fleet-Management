"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Clock, Eye, ListChecks, ThumbsDown, ThumbsUp, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { SearchField } from "@/components/ui/search-field";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { NativeSelect } from "@/components/governance/selects";
import { useToast } from "@/components/feedback/toast";
import { useConfirm } from "@/components/feedback/confirm-dialog";
import { cancelRequest, decideRequest } from "@/lib/adherence/actions";
import type { AdherenceOptions, ChecklistContext, RequestRow, RequestsPage } from "@/lib/adherence/queries";
import { CONTEXT_LABEL, formatDateBr, formatDateTimeBr, formatInt, statusMeta } from "./status";
import type { AdherencePerms, Navigate } from "./adherence-view";
import { BulkDecisionDialog, type BulkDecision } from "./bulk-decision-dialog";

const REQUEST_STATUS: Record<RequestRow["status"], { label: string; tone: "warning" | "success" | "danger" | "neutral" }> = {
  pending: { label: "Pendente", tone: "warning" },
  approved: { label: "Aprovada", tone: "success" },
  rejected: { label: "Rejeitada", tone: "danger" },
  cancelled: { label: "Cancelada", tone: "neutral" },
};

const EFFECT_LABEL: Record<string, string> = {
  exclude: "expurgo",
  count_done: "conta como feito",
  none: "sem efeito no indicador",
};

// ---------------------------------------------------------------------------
// Decisão (§31): aprovar, rejeitar ou reclassificar — nunca a própria (§32)
// ---------------------------------------------------------------------------
export interface DecisionDialogProps {
  request: RequestRow | null;
  options: AdherenceOptions;
  onOpenChange: (open: boolean) => void;
  onDecided: () => void;
}

export function DecisionDialog({ request, options, onOpenChange, onDecided }: DecisionDialogProps) {
  return (
    <Dialog open={Boolean(request)} onOpenChange={onOpenChange}>
      <DialogContent>
        {request ? (
          // A chave remonta o formulário a cada solicitação: estado novo sem
          // efeito de reset, e sem o primeiro quadro mostrando a decisão anterior.
          <DecisionForm key={request.id} request={request} options={options} onOpenChange={onOpenChange} onDecided={onDecided} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DecisionForm({ request, options, onOpenChange, onDecided }: DecisionDialogProps & { request: RequestRow }) {
  const { toast } = useToast();
  const [decision, setDecision] = React.useState<"approve" | "reject" | "reclassify">("approve");
  const [note, setNote] = React.useState("");
  const [newReason, setNewReason] = React.useState("");
  const [busy, startTransition] = React.useTransition();

  const reasons = options.reasons.filter(
    (r) => r.isActive && (request.context === "retorno" ? r.appliesToReturn : r.appliesToDeparture),
  );

  const submit = () => {
    startTransition(async () => {
      const result = await decideRequest({
        requestId: request.id, decision, note: note || null,
        newReasonCode: decision === "reclassify" ? newReason || null : null,
      });
      if (result.ok) {
        toast({
          title: decision === "reject" ? "Solicitação rejeitada." : "Solicitação aprovada.",
          variant: "success",
        });
        onOpenChange(false);
        onDecided();
      } else {
        toast({ title: result.error ?? "Não foi possível registrar a decisão.", variant: "danger" });
      }
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Decidir solicitação</DialogTitle>
        <DialogDescription>
          {`${request.fleetCode ?? "—"} ${request.licensePlate ?? ""} · ${formatDateBr(request.operationalDate)} · ${CONTEXT_LABEL[request.context]} · motivo ${request.reasonName}`}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4">
        <blockquote className="rounded-md border border-border bg-surface-secondary p-3 text-body-sm text-fg">
          {request.justification}
          {request.evidenceReference ? (
            <span className="mt-1 block text-caption text-fg-muted">Evidência: {request.evidenceReference}</span>
          ) : null}
          <span className="mt-1 block text-caption text-fg-muted">
            Solicitado por {request.requestedByName ?? "—"} em {formatDateTimeBr(request.requestedAt)}
          </span>
        </blockquote>
        <FormField label="Decisão" id="decision-kind">
          <NativeSelect value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)}>
            <option value="approve">Aprovar com o motivo solicitado</option>
            <option value="reclassify">Aprovar reclassificando o motivo</option>
            <option value="reject">Rejeitar</option>
          </NativeSelect>
        </FormField>
        {decision === "reclassify" ? (
          <FormField label="Novo motivo" required id="decision-reason">
            <NativeSelect value={newReason} onChange={(e) => setNewReason(e.target.value)}>
              <option value="">Escolha…</option>
              {reasons.map((r) => (
                <option key={r.code} value={r.code}>{r.name} · {EFFECT_LABEL[r.effect]}</option>
              ))}
            </NativeSelect>
          </FormField>
        ) : null}
        <FormField
          label="Observação"
          required={decision === "reject"}
          helperText={decision === "reject" ? "Obrigatória na rejeição: quem pediu precisa saber por quê." : "Fica no histórico da decisão."}
          id="decision-note"
        >
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </FormField>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
        <Button
          variant={decision === "reject" ? "danger" : "primary"}
          onClick={submit}
          disabled={busy || (decision === "reject" && !note.trim()) || (decision === "reclassify" && !newReason)}
        >
          {decision === "reject" ? "Rejeitar" : "Aprovar"}
        </Button>
      </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------------------
// Expurgos (§51)
// ---------------------------------------------------------------------------
export interface RequestsPanelProps {
  requests: RequestsPage | null;
  filters: { status?: string; reasonCode?: string; q?: string };
  options: AdherenceOptions;
  perms: AdherencePerms;
  navigate: Navigate;
  pending: boolean;
  onSelect: (obligationId: string) => void;
  onChanged: () => void;
}

export function RequestsPanel({ requests, filters, options, perms, navigate, pending, onSelect, onChanged }: RequestsPanelProps) {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [deciding, setDeciding] = React.useState<RequestRow | null>(null);
  const [, startTransition] = React.useTransition();

  // Seleção para decisão em lote (§57). Só quem aprova seleciona, e só linhas
  // pendentes entram: a seleção é derivada da página atual, então um id que
  // deixou de ser pendente (decidido, cancelado, filtrado) sai sozinho — sem
  // efeito para "limpar" nada.
  const [selectedIds, setSelectedIds] = React.useState<ReadonlySet<string>>(() => new Set());
  const [bulk, setBulk] = React.useState<BulkDecision | null>(null);
  const rows = requests?.rows ?? [];
  const selectable = perms.approve;
  const pendingRows = selectable ? rows.filter((r) => r.status === "pending") : [];
  const selectedRows = pendingRows.filter((r) => selectedIds.has(r.id));
  const selectedCount = selectedRows.length;
  const allPendingSelected = pendingRows.length > 0 && selectedCount === pendingRows.length;
  const selectedContexts = Array.from(new Set<ChecklistContext>(selectedRows.map((r) => r.context)));

  const toggleRow = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };
  const toggleAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(pendingRows.map((r) => r.id)) : new Set());
  };
  const clearSelection = () => setSelectedIds(new Set());

  const cancel = async (row: RequestRow) => {
    const ok = await confirm({
      title: "Cancelar a solicitação?",
      description: "A obrigação volta a não ter justificativa pendente. O registro fica no histórico como cancelado.",
      confirmLabel: "Cancelar solicitação",
      destructive: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await cancelRequest({ requestId: row.id });
      if (result.ok) { toast({ title: "Solicitação cancelada.", variant: "success" }); router.refresh(); onChanged(); }
      else toast({ title: result.error ?? "Não foi possível cancelar.", variant: "danger" });
    });
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-caption text-fg-muted">Situação</span>
            <NativeSelect fieldSize="sm" aria-label="Situação da solicitação" value={filters.status ?? ""}
              disabled={pending} onChange={(e) => navigate({ sol_status: e.target.value || null })} className="min-w-[9rem]">
              <option value="">Todas</option>
              <option value="pending">Pendentes</option>
              <option value="approved">Aprovadas</option>
              <option value="rejected">Rejeitadas</option>
              <option value="cancelled">Canceladas</option>
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-caption text-fg-muted">Motivo</span>
            <NativeSelect fieldSize="sm" aria-label="Motivo" value={filters.reasonCode ?? ""}
              disabled={pending} onChange={(e) => navigate({ sol_motivo: e.target.value || null })} className="min-w-[11rem]">
              <option value="">Todos</option>
              {options.reasons.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
            </NativeSelect>
          </div>
          <div className="flex min-w-[12rem] flex-col gap-1">
            <span className="text-caption text-fg-muted">Frota ou placa</span>
            <SearchField size="sm" aria-label="Buscar solicitação por frota ou placa" defaultValue={filters.q ?? ""}
              onKeyDown={(e) => { if (e.key === "Enter") navigate({ sol_q: (e.target as HTMLInputElement).value.trim() || null }); }}
              onClear={() => navigate({ sol_q: null })} />
          </div>
          <p className="ml-auto text-caption text-fg-muted">
            {requests ? `${formatInt(requests.total)} solicitação(ões) na competência e no recorte` : "Solicitações indisponíveis"}
          </p>
        </div>

        {selectable ? (
          // Barra de lote (§57): os botões só ligam com seleção, e cada um abre
          // o diálogo com prévia obrigatória — nada é decidido daqui direto.
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-secondary px-3 py-2" role="group" aria-label="Decisão em lote">
            <ListChecks className="size-4 text-fg-muted" aria-hidden />
            <span className="text-body-sm text-fg" aria-live="polite">
              {selectedCount === 1 ? "1 selecionada" : `${selectedCount} selecionadas`}
            </span>
            <span className="text-fg-muted" aria-hidden>·</span>
            <Button size="sm" variant="ghost" onClick={clearSelection} disabled={selectedCount === 0}>Limpar</Button>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" leadingIcon={<ThumbsUp />} disabled={selectedCount === 0} onClick={() => setBulk("approve")}>
                Aprovar em lote
              </Button>
              <Button size="sm" variant="secondary" leadingIcon={<ThumbsDown />} disabled={selectedCount === 0} onClick={() => setBulk("reject")}>
                Rejeitar em lote
              </Button>
              <Button size="sm" variant="secondary" disabled={selectedCount === 0} onClick={() => setBulk("reclassify")}>
                Reclassificar em lote
              </Button>
            </div>
          </div>
        ) : null}

        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                {selectable ? (
                  <TableHead className="w-8">
                    <Checkbox
                      aria-label="Selecionar todas as pendentes da página"
                      checked={allPendingSelected ? true : selectedCount > 0 ? "indeterminate" : false}
                      disabled={pendingRows.length === 0}
                      onCheckedChange={(checked) => toggleAll(checked === true)}
                    />
                  </TableHead>
                ) : null}
                <TableHead>Data</TableHead>
                <TableHead>Veículo</TableHead>
                <TableHead>Operação · Cidade · BR</TableHead>
                <TableHead>Liderança</TableHead>
                <TableHead>Contexto</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Solicitante</TableHead>
                <TableHead>Espera</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableEmpty colSpan={selectable ? 11 : 10} message="Nenhuma solicitação para os filtros escolhidos." />
              ) : rows.map((r) => {
                const st = REQUEST_STATUS[r.status];
                const isPending = r.status === "pending";
                return (
                  <TableRow key={r.id} data-state={selectable && isPending && selectedIds.has(r.id) ? "selected" : undefined}>
                    {selectable ? (
                      <TableCell>
                        {isPending ? (
                          <Checkbox
                            aria-label={`Selecionar solicitação ${r.fleetCode ?? r.licensePlate ?? r.id} de ${formatDateBr(r.operationalDate)}`}
                            checked={selectedIds.has(r.id)}
                            onCheckedChange={(checked) => toggleRow(r.id, checked === true)}
                          />
                        ) : null}
                      </TableCell>
                    ) : null}
                    <TableCell className="tabular-nums">{formatDateBr(r.operationalDate)}</TableCell>
                    <TableCell><span className="font-medium text-fg">{r.fleetCode ?? "—"}</span> <span className="text-fg-muted">{r.licensePlate ?? ""}</span></TableCell>
                    <TableCell className="text-fg-muted">{[r.operationName, r.cityName, r.brCode].filter(Boolean).join(" · ")}</TableCell>
                    <TableCell className="text-fg-muted">{r.leaderName ?? "—"}</TableCell>
                    <TableCell>{r.context === "saida" ? "Saída" : "Retorno"}</TableCell>
                    <TableCell>
                      <span className="text-fg">{r.reasonName}</span>
                      <span className="block text-caption text-fg-muted">{EFFECT_LABEL[r.reasonEffect] ?? r.reasonEffect}{r.isOverride ? " · correção administrativa" : ""}</span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={st.tone} size="sm">{st.label}</StatusBadge>
                      {r.status === "approved" && r.obligationStatus ? (
                        <span className="block text-caption text-fg-muted">{statusMeta(r.obligationStatus).label}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      {r.requestedByName ?? "—"}
                      <span className="block text-caption">{formatDateTimeBr(r.requestedAt)}</span>
                    </TableCell>
                    <TableCell className="tabular-nums text-fg-muted">{r.waitHours.toLocaleString("pt-BR")} h</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {r.status === "pending" && perms.approve ? (
                          <Button size="sm" variant="secondary" leadingIcon={<ThumbsUp />} onClick={() => setDeciding(r)}>Decidir</Button>
                        ) : null}
                        {r.status === "pending" ? (
                          <Button size="sm" variant="ghost" leadingIcon={<XCircle />} onClick={() => void cancel(r)} aria-label="Cancelar solicitação">Cancelar</Button>
                        ) : null}
                        <Button size="sm" variant="ghost" leadingIcon={<Eye />} onClick={() => onSelect(r.obligationId)} aria-label="Ver obrigação">Obrigação</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>

      <DecisionDialog request={deciding} options={options} onOpenChange={(open) => { if (!open) setDeciding(null); }}
        onDecided={() => { router.refresh(); onChanged(); }} />

      {selectable ? (
        <BulkDecisionDialog
          open={bulk !== null}
          decision={bulk ?? "approve"}
          requestIds={selectedRows.map((r) => r.id)}
          contexts={selectedContexts}
          options={options}
          onOpenChange={(open) => { if (!open) setBulk(null); }}
          onDone={() => { clearSelection(); router.refresh(); onChanged(); }}
        />
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Solicitações (§52): visão gerencial do que as lideranças pediram
// ---------------------------------------------------------------------------
export function RequestsOverviewPanel({ requests, onSelect }: { requests: RequestsPage | null; onSelect: (id: string) => void }) {
  if (!requests) {
    return <Card><CardContent className="p-4 text-body-sm text-fg-muted">Solicitações indisponíveis no momento.</CardContent></Card>;
  }
  const s = requests.stats;
  const pendingRows = requests.rows.filter((r) => r.status === "pending");
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Pendentes" value={formatInt(s.pending)} period="aguardando decisão" icon={<Clock />} />
        <KpiCard label="Aprovadas" value={formatInt(s.approved)} icon={<ThumbsUp />} />
        <KpiCard label="Rejeitadas" value={formatInt(s.rejected)} icon={<ThumbsDown />} />
        <KpiCard label="Tempo médio de espera" value={s.avgWaitHours.toLocaleString("pt-BR")} unit="h" period="da solicitação à decisão" icon={<Clock />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {[{ title: "Por operação", rows: s.byOperation }, { title: "Por liderança", rows: s.byLeader }].map((block) => (
          <Card key={block.title}>
            <CardContent className="p-4">
              <h3 className="mb-3 text-h4 font-semibold text-fg">{block.title}</h3>
              <TableContainer>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{block.title.replace("Por ", "")}</TableHead>
                      <TableHead className="text-right">Solicitações</TableHead>
                      <TableHead className="text-right">Pendentes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {block.rows.length === 0 ? (
                      <TableEmpty colSpan={3} message="Sem solicitações no recorte." />
                    ) : block.rows.map((g) => (
                      <TableRow key={g.key || g.label}>
                        <TableCell className="font-medium text-fg">{g.label}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatInt(g.total)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {g.pending > 0 ? <Badge variant="warning">{formatInt(g.pending)}</Badge> : formatInt(0)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-4">
          <h3 className="mb-3 text-h4 font-semibold text-fg">Pendentes de decisão</h3>
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Veículo</TableHead>
                  <TableHead>Operação · Cidade</TableHead>
                  <TableHead>Liderança</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Espera</TableHead>
                  <TableHead aria-hidden />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingRows.length === 0 ? (
                  <TableEmpty colSpan={7} message="Nenhuma solicitação pendente no recorte." />
                ) : pendingRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="tabular-nums">{formatDateBr(r.operationalDate)} · {r.context === "saida" ? "Saída" : "Retorno"}</TableCell>
                    <TableCell><span className="font-medium text-fg">{r.fleetCode ?? "—"}</span> <span className="text-fg-muted">{r.licensePlate ?? ""}</span></TableCell>
                    <TableCell className="text-fg-muted">{[r.operationName, r.cityName].filter(Boolean).join(" · ")}</TableCell>
                    <TableCell className="text-fg-muted">{r.leaderName ?? "—"}</TableCell>
                    <TableCell>{r.reasonName}</TableCell>
                    <TableCell className="tabular-nums text-fg-muted">{r.waitHours.toLocaleString("pt-BR")} h</TableCell>
                    <TableCell className="text-right"><Button size="sm" variant="ghost" leadingIcon={<Eye />} onClick={() => onSelect(r.obligationId)}>Obrigação</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    </div>
  );
}
