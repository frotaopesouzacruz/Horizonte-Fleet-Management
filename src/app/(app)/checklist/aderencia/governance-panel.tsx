"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Play, Search, Target } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { CheckboxField } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/ui/status-badge";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import {
  Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { NativeSelect } from "@/components/governance/selects";
import { useToast } from "@/components/feedback/toast";
import { useConfirm } from "@/components/feedback/confirm-dialog";
import {
  reconcilePeriod, resolveInconsistency, saveReason, saveRule, setTarget, type ReconcileStats,
} from "@/lib/adherence/actions";
import type { AdherenceOptions } from "@/lib/adherence/queries";
import { monthEnd, monthStart, type Competence } from "@/lib/governance/competence";
import { formatDateBr, formatDateTimeBr, formatInt, formatPct } from "./status";
import type { AdherencePerms } from "./adherence-view";

const KIND_LABEL: Record<string, string> = {
  daily: "Rotina diária", reconcile: "Reconciliação", outbox: "Outbox", import: "Importação", on_demand: "Sob demanda",
};
const INCONSISTENCY_LABEL: Record<string, string> = {
  execution_without_obligation: "Execução sem obrigação",
  duplicate_execution: "Execução duplicada",
  planning_conflict: "Conflito de planejamento",
  execution_after_exclusion: "Execução após expurgo aprovado",
  import_unknown_status: "Status desconhecido na importação",
  import_unknown_vehicle: "Veículo desconhecido na importação",
  other: "Outra",
};
const WEEKDAYS = [[1, "Seg"], [2, "Ter"], [3, "Qua"], [4, "Qui"], [5, "Sex"], [6, "Sáb"], [7, "Dom"]] as const;

export interface GovernancePanelProps {
  options: AdherenceOptions;
  operations: { id: string; name: string; status: string }[];
  perms: AdherencePerms;
  today: string;
  competence: Competence;
  onChanged: () => void;
  /** Seção de importação, injetada para a prévia não depender dela. */
  importSection?: React.ReactNode;
}

/**
 * Importação e reconciliação (§39, §40, §54–§56) e os parâmetros do motor
 * (§26, §28, §36). Nada aqui reprocessa sem prévia e sem motivo, e nada aqui
 * muda um Perfil de Acesso.
 */
export function GovernancePanel({ options, operations, perms, today, competence, onChanged, importSection }: GovernancePanelProps) {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [busy, startTransition] = React.useTransition();

  // ---------------------------------------------------------------- reconcile
  const [from, setFrom] = React.useState(monthStart(competence));
  const [to, setTo] = React.useState(today < monthEnd(competence) ? today : monthEnd(competence));
  const [op, setOp] = React.useState("");
  const [ctx, setCtx] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [preview, setPreview] = React.useState<ReconcileStats | null>(null);

  const runPreview = () => startTransition(async () => {
    const result = await reconcilePeriod({ dateFrom: from, dateTo: to, operationId: op || null, context: (ctx || null) as "saida" | "retorno" | null, reason: reason || null, preview: true });
    if (result.ok && result.data) setPreview(result.data);
    else toast({ title: result.error ?? "Não foi possível calcular a prévia.", variant: "danger" });
  });

  const apply = async () => {
    if (!preview) return;
    const ok = await confirm({
      title: "Aplicar a reconciliação?",
      description: `Serão criadas ${formatInt(preview.create)} obrigações, reativadas ${formatInt(preview.reactivate)} e aposentadas ${formatInt(preview.retireCandidates)} (${formatInt(preview.protectedCount)} protegidas por execução ou decisão ficam como estão). Nada é apagado; a rodada fica registrada com o motivo.`,
      confirmLabel: "Reconciliar",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await reconcilePeriod({ dateFrom: from, dateTo: to, operationId: op || null, context: (ctx || null) as "saida" | "retorno" | null, reason, preview: false });
      if (result.ok && result.data) {
        toast({ title: `Período reconciliado: ${formatInt(result.data.create)} criadas, ${formatInt(result.data.retire)} aposentadas, ${formatInt(result.data.executionsRematched)} execuções conciliadas.`, variant: "success" });
        setPreview(null); setReason(""); router.refresh(); onChanged();
      } else toast({ title: result.error ?? "Não foi possível reconciliar.", variant: "danger" });
    });
  };

  // ------------------------------------------------------------------ target
  const [targetOp, setTargetOp] = React.useState("");
  const [targetCtx, setTargetCtx] = React.useState("");
  const [targetPct, setTargetPct] = React.useState("");
  const [targetFrom, setTargetFrom] = React.useState(today);
  const saveTarget = () => startTransition(async () => {
    const result = await setTarget({ operationId: targetOp || null, context: (targetCtx || null) as "saida" | "retorno" | null, targetPct: Number(targetPct.replace(",", ".")), validFrom: targetFrom });
    if (result.ok) { toast({ title: "Meta salva.", variant: "success" }); setTargetPct(""); router.refresh(); onChanged(); }
    else toast({ title: result.error ?? "Não foi possível salvar a meta.", variant: "danger" });
  });

  // ------------------------------------------------------------------- rules
  const [ruleName, setRuleName] = React.useState("");
  const [ruleOp, setRuleOp] = React.useState("");
  const [ruleType, setRuleType] = React.useState("");
  const [ruleStatus, setRuleStatus] = React.useState("");
  const [ruleRequires, setRuleRequires] = React.useState(true);
  const [ruleDep, setRuleDep] = React.useState(true);
  const [ruleRet, setRuleRet] = React.useState(true);
  const [ruleDays, setRuleDays] = React.useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [ruleFrom, setRuleFrom] = React.useState(today);
  const vehicleTypes = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of options.rules) if (r.vehicleTypeId && r.vehicleTypeName) seen.set(r.vehicleTypeId, r.vehicleTypeName);
    return [...seen.entries()];
  }, [options.rules]);

  const createRule = () => startTransition(async () => {
    const result = await saveRule({
      name: ruleName, operation_id: ruleOp || null, vehicle_type_id: ruleType || null, vehicle_status: ruleStatus || null,
      requires_checklist: ruleRequires, applies_to_departure: ruleDep, applies_to_return: ruleRet, weekdays: ruleDays, valid_from: ruleFrom, priority: 50,
    });
    if (result.ok) { toast({ title: "Regra criada. Vale a partir da vigência informada; o passado não muda.", variant: "success" }); setRuleName(""); router.refresh(); onChanged(); }
    else toast({ title: result.error ?? "Não foi possível criar a regra.", variant: "danger" });
  });

  const toggleRule = (id: string, active: boolean) => startTransition(async () => {
    const result = await saveRule({ id, is_active: active });
    if (result.ok) { router.refresh(); onChanged(); }
    else toast({ title: result.error ?? "Não foi possível alterar a regra.", variant: "danger" });
  });

  const toggleReason = (id: string, active: boolean) => startTransition(async () => {
    const result = await saveReason({ id, is_active: active });
    if (result.ok) { router.refresh(); onChanged(); }
    else toast({ title: result.error ?? "Não foi possível alterar o motivo.", variant: "danger" });
  });

  const resolve = (id: string, status: "resolved" | "dismissed") => startTransition(async () => {
    const result = await resolveInconsistency({ id, status });
    if (result.ok) { toast({ title: status === "resolved" ? "Inconsistência resolvida." : "Inconsistência descartada.", variant: "success" }); router.refresh(); onChanged(); }
    else toast({ title: result.error ?? "Não foi possível tratar a inconsistência.", variant: "danger" });
  });

  return (
    <div className="flex flex-col gap-5">
      {importSection}

      {perms.reconcile ? (
        <Card>
          <CardContent className="flex flex-col gap-4 p-4">
            <div>
              <h3 className="text-h4 font-semibold text-fg">Reconciliar período</h3>
              <p className="text-caption text-fg-muted">
                Recalcula as obrigações do período a partir do planejamento vigente em cada data e concilia execuções ainda sem vínculo. Sempre com prévia; aplicar exige motivo. Obrigações com execução ou decisão nunca são aposentadas.
              </p>
            </div>
            <FormGrid className="grid gap-3 md:grid-cols-4">
              <FormField label="De" id="rec-from"><DateInput size="sm" value={from} onChange={(e) => setFrom(e.target.value)} /></FormField>
              <FormField label="Até" id="rec-to"><DateInput size="sm" value={to} onChange={(e) => setTo(e.target.value)} /></FormField>
              <FormField label="Operação" id="rec-op">
                <NativeSelect fieldSize="sm" value={op} onChange={(e) => setOp(e.target.value)}>
                  <option value="">Todas</option>
                  {operations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </NativeSelect>
              </FormField>
              <FormField label="Contexto" id="rec-ctx">
                <NativeSelect fieldSize="sm" value={ctx} onChange={(e) => setCtx(e.target.value)}>
                  <option value="">Saída e retorno</option>
                  <option value="saida">Saída</option>
                  <option value="retorno">Retorno</option>
                </NativeSelect>
              </FormField>
            </FormGrid>
            <FormField label="Motivo da reconciliação" required helperText="Obrigatório para aplicar. Fica registrado na rodada e em cada obrigação aposentada." id="rec-reason">
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </FormField>
            {preview ? (
              <Alert variant="info">
                <AlertDescription>
                  Prévia {formatDateBr(preview.dateFrom)} a {formatDateBr(preview.dateTo)}: {formatInt(preview.expected)} obrigações esperadas · {formatInt(preview.create)} a criar · {formatInt(preview.reactivate)} a reativar · {formatInt(preview.unchanged)} inalteradas · {formatInt(preview.retireCandidates)} a aposentar · {formatInt(preview.protectedCount)} protegidas · {formatInt(preview.planningConflicts)} conflitos de planejamento · {formatInt(preview.executionsToRematch)} execuções a conciliar.
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" leadingIcon={<Search />} onClick={runPreview} disabled={busy}>Prévia do impacto</Button>
              <Button leadingIcon={<Play />} onClick={() => void apply()} disabled={busy || !preview || reason.trim().length < 5}>Aplicar reconciliação</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {perms.manageTargets ? (
        <Card>
          <CardContent className="flex flex-col gap-4 p-4">
            <div>
              <h3 className="text-h4 font-semibold text-fg">Metas de aderência</h3>
              <p className="text-caption text-fg-muted">Organização › operação › contexto: a mais específica vence. Não há meta implícita: sem meta cadastrada, a tela mostra &ldquo;Não definida&rdquo;.</p>
            </div>
            <FormGrid className="grid gap-3 md:grid-cols-5">
              <FormField label="Operação" id="target-op">
                <NativeSelect fieldSize="sm" value={targetOp} onChange={(e) => setTargetOp(e.target.value)}>
                  <option value="">Toda a organização</option>
                  {operations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </NativeSelect>
              </FormField>
              <FormField label="Contexto" id="target-ctx">
                <NativeSelect fieldSize="sm" value={targetCtx} onChange={(e) => setTargetCtx(e.target.value)}>
                  <option value="">Saída e retorno</option>
                  <option value="saida">Saída</option>
                  <option value="retorno">Retorno</option>
                </NativeSelect>
              </FormField>
              <FormField label="Meta (%)" required id="target-pct"><Input size="sm" inputMode="decimal" value={targetPct} onChange={(e) => setTargetPct(e.target.value)} placeholder="90" /></FormField>
              <FormField label="Vigente desde" id="target-from"><DateInput size="sm" value={targetFrom} onChange={(e) => setTargetFrom(e.target.value)} /></FormField>
              <div className="flex items-end"><Button leadingIcon={<Target />} onClick={saveTarget} disabled={busy || !targetPct}>Salvar meta</Button></div>
            </FormGrid>
            <TableContainer>
              <Table>
                <TableHeader><TableRow><TableHead>Escopo</TableHead><TableHead>Contexto</TableHead><TableHead className="text-right">Meta</TableHead><TableHead>Vigência</TableHead></TableRow></TableHeader>
                <TableBody>
                  {options.targets.length === 0 ? <TableEmpty colSpan={4} message="Nenhuma meta cadastrada." /> : options.targets.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>{t.operationName ?? "Toda a organização"}</TableCell>
                      <TableCell>{t.context === "saida" ? "Saída" : t.context === "retorno" ? "Retorno" : "Saída e retorno"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPct(t.targetPct)}</TableCell>
                      <TableCell className="text-fg-muted">{formatDateBr(t.validFrom)} → {t.validTo ? formatDateBr(t.validTo) : "em aberto"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="flex flex-col gap-4 p-4">
          <div>
            <h3 className="text-h4 font-semibold text-fg">Elegibilidade</h3>
            <p className="text-caption text-fg-muted">Quem deve checklist, em que contexto e em que dias — por id de operação, tipo e situação, nunca por nome. A regra mais específica vence; cada alteração sobe a versão e vale da vigência em diante (§26).</p>
          </div>
          <TableContainer>
            <Table>
              <TableHeader><TableRow><TableHead>Regra</TableHead><TableHead>Escopo</TableHead><TableHead>Obrigação</TableHead><TableHead>Dias</TableHead><TableHead>Vigência</TableHead><TableHead>Versão</TableHead><TableHead>Ativa</TableHead></TableRow></TableHeader>
              <TableBody>
                {options.rules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell><span className="font-medium text-fg">{r.name}</span>{r.description ? <span className="block max-w-md text-caption text-fg-muted">{r.description}</span> : null}</TableCell>
                    <TableCell className="text-fg-muted">{[r.operationName ?? "todas as operações", r.vehicleTypeName ?? "todos os tipos", r.vehicleStatus ? `situação ${r.vehicleStatus}` : "qualquer situação"].join(" · ")}</TableCell>
                    <TableCell>
                      <StatusBadge status={r.requiresChecklist ? "success" : "neutral"} size="sm">{r.requiresChecklist ? "Exige" : "Isenta"}</StatusBadge>
                      <span className="block text-caption text-fg-muted">{[r.appliesToDeparture ? "saída" : null, r.appliesToReturn ? "retorno" : null].filter(Boolean).join(" e ")}</span>
                    </TableCell>
                    <TableCell className="text-caption text-fg-muted">{r.weekdays.length === 7 ? "todos" : r.weekdays.map((d) => WEEKDAYS.find((w) => w[0] === d)?.[1]).join(", ")}</TableCell>
                    <TableCell className="text-caption text-fg-muted">{formatDateBr(r.validFrom)} → {r.validTo ? formatDateBr(r.validTo) : "aberta"}</TableCell>
                    <TableCell className="tabular-nums">v{r.version}</TableCell>
                    <TableCell>
                      <Switch checked={r.isActive} disabled={!perms.manageRules || busy} onCheckedChange={(v) => toggleRule(r.id, v)} aria-label={`Regra ${r.name} ativa`} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {perms.manageRules ? (
            <div className="rounded-md border border-border p-3">
              <h4 className="mb-3 text-label font-semibold text-fg">Nova regra</h4>
              <FormGrid className="grid gap-3 md:grid-cols-3">
                <FormField label="Nome" required id="rule-name"><Input size="sm" value={ruleName} onChange={(e) => setRuleName(e.target.value)} /></FormField>
                <FormField label="Operação" id="rule-op">
                  <NativeSelect fieldSize="sm" value={ruleOp} onChange={(e) => setRuleOp(e.target.value)}>
                    <option value="">Todas</option>
                    {operations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </NativeSelect>
                </FormField>
                <FormField label="Tipo de equipamento" id="rule-type" helperText="Os tipos listados são os já referenciados por alguma regra.">
                  <NativeSelect fieldSize="sm" value={ruleType} onChange={(e) => setRuleType(e.target.value)}>
                    <option value="">Todos</option>
                    {vehicleTypes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                  </NativeSelect>
                </FormField>
                <FormField label="Situação do veículo na data" id="rule-status">
                  <NativeSelect fieldSize="sm" value={ruleStatus} onChange={(e) => setRuleStatus(e.target.value)}>
                    <option value="">Qualquer</option>
                    <option value="active">Ativo</option>
                    <option value="maintenance">Em manutenção</option>
                    <option value="inactive">Inativo</option>
                  </NativeSelect>
                </FormField>
                <FormField label="Vigente desde" id="rule-from"><DateInput size="sm" value={ruleFrom} onChange={(e) => setRuleFrom(e.target.value)} /></FormField>
                <div className="flex flex-col gap-2 pt-1">
                  <CheckboxField label="Exige checklist" checked={ruleRequires} onCheckedChange={(v) => setRuleRequires(v === true)} />
                  <CheckboxField label="Aplica à saída" checked={ruleDep} onCheckedChange={(v) => setRuleDep(v === true)} />
                  <CheckboxField label="Aplica ao retorno" checked={ruleRet} onCheckedChange={(v) => setRuleRet(v === true)} />
                </div>
              </FormGrid>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className="text-caption text-fg-muted">Dias:</span>
                {WEEKDAYS.map(([d, label]) => (
                  <CheckboxField key={d} label={label} checked={ruleDays.includes(d)}
                    onCheckedChange={(v) => setRuleDays((prev) => (v === true ? [...new Set([...prev, d])].sort() : prev.filter((x) => x !== d)))} />
                ))}
                <Button className="ml-auto" size="sm" onClick={createRule} disabled={busy || ruleName.trim().length < 3 || ruleDays.length === 0}>Criar regra</Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4 p-4">
          <div>
            <h3 className="text-h4 font-semibold text-fg">Motivos de expurgo</h3>
            <p className="text-caption text-fg-muted">Nem todo motivo exclui: o efeito de cada um é explícito, e a aprovação copia o efeito para a decisão — mudar o motivo depois não reclassifica o passado.</p>
          </div>
          <TableContainer>
            <Table>
              <TableHeader><TableRow><TableHead>Código</TableHead><TableHead>Motivo</TableHead><TableHead>Efeito na aprovação</TableHead><TableHead>Evidência</TableHead><TableHead>Contextos</TableHead><TableHead>Ativo</TableHead></TableRow></TableHeader>
              <TableBody>
                {options.reasons.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-caption">{r.code}</TableCell>
                    <TableCell><span className="font-medium text-fg">{r.name}</span>{r.description ? <span className="block max-w-md text-caption text-fg-muted">{r.description}</span> : null}</TableCell>
                    <TableCell>
                      <StatusBadge status={r.effect === "exclude" ? "info" : r.effect === "count_done" ? "success" : "neutral"} size="sm">
                        {r.effect === "exclude" ? "Expurga do denominador" : r.effect === "count_done" ? "Conta como feito" : "Só registra"}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-fg-muted">{r.requiresEvidence ? "Obrigatória" : "Opcional"}</TableCell>
                    <TableCell className="text-caption text-fg-muted">{[r.appliesToDeparture ? "saída" : null, r.appliesToReturn ? "retorno" : null].filter(Boolean).join(" e ")}{r.inheritsToReturn ? " · herda para o retorno" : ""}</TableCell>
                    <TableCell><Switch checked={r.isActive} disabled={!perms.manageRules || busy} onCheckedChange={(v) => toggleReason(r.id, v)} aria-label={`Motivo ${r.name} ativo`} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {perms.viewAudit || perms.reconcile ? (
        <Card>
          <CardContent className="flex flex-col gap-4 p-4">
            <div>
              <h3 className="text-h4 font-semibold text-fg">Inconsistências abertas</h3>
              <p className="text-caption text-fg-muted">O que o motor não decidiu sozinho: execução sem obrigação, duplicidade, conflito entre fidelização e alocação, execução após expurgo. Sem decisão automática (§21, §25).</p>
            </div>
            <TableContainer>
              <Table>
                <TableHeader><TableRow><TableHead>Tipo</TableHead><TableHead>Veículo</TableHead><TableHead>Data</TableHead><TableHead>Registrada em</TableHead>{perms.reconcile ? <TableHead className="text-right">Ações</TableHead> : null}</TableRow></TableHeader>
                <TableBody>
                  {options.inconsistencies.length === 0 ? <TableEmpty colSpan={5} message="Nenhuma inconsistência aberta." /> : options.inconsistencies.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>{INCONSISTENCY_LABEL[i.kind] ?? i.kind}</TableCell>
                      <TableCell className="text-fg-muted">{i.fleetCode ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{formatDateBr(i.operationalDate)}{i.context ? ` · ${i.context === "saida" ? "Saída" : "Retorno"}` : ""}</TableCell>
                      <TableCell className="text-caption text-fg-muted">{formatDateTimeBr(i.createdAt)}</TableCell>
                      {perms.reconcile ? (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="secondary" leadingIcon={<CheckCheck />} onClick={() => resolve(i.id, "resolved")} disabled={busy}>Resolvida</Button>
                            <Button size="sm" variant="ghost" onClick={() => resolve(i.id, "dismissed")} disabled={busy}>Descartar</Button>
                          </div>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      ) : null}

      {perms.viewAudit || perms.reconcile ? (
        <Card>
          <CardContent className="flex flex-col gap-4 p-4">
            <div>
              <h3 className="text-h4 font-semibold text-fg">Rodadas de processamento</h3>
              <p className="text-caption text-fg-muted">A rotina roda no banco a cada 15 minutos, independentemente de alguém abrir esta página. Cada rodada registra o que criou, reativou e aposentou.</p>
            </div>
            <TableContainer>
              <Table>
                <TableHeader><TableRow><TableHead>Tipo</TableHead><TableHead>Período</TableHead><TableHead>Situação</TableHead><TableHead>Resultado</TableHead><TableHead>Quando</TableHead><TableHead>Quem</TableHead></TableRow></TableHeader>
                <TableBody>
                  {options.runs.length === 0 ? <TableEmpty colSpan={6} message="Nenhuma rodada registrada ainda." /> : options.runs.map((r) => {
                    const st = r.stats as Record<string, unknown>;
                    const cur = (st.current ?? st) as Record<string, unknown>;
                    const ob = (st.outbox ?? {}) as Record<string, unknown>;
                    return (
                      <TableRow key={r.id}>
                        <TableCell>{KIND_LABEL[r.kind] ?? r.kind}{r.reason ? <span className="block max-w-xs truncate text-caption text-fg-muted" title={r.reason}>{r.reason}</span> : null}</TableCell>
                        <TableCell className="tabular-nums text-fg-muted">{formatDateBr(r.dateFrom)} → {formatDateBr(r.dateTo)}</TableCell>
                        <TableCell><StatusBadge status={r.status === "completed" ? "success" : r.status === "failed" ? "danger" : "pending"} size="sm">{r.status === "completed" ? "Concluída" : r.status === "failed" ? "Falhou" : "Em execução"}</StatusBadge></TableCell>
                        <TableCell className="text-caption text-fg-muted">
                          {r.errorMessage ? r.errorMessage : `${formatInt(Number(cur.create ?? 0))} criadas · ${formatInt(Number(cur.reactivate ?? 0))} reativadas · ${formatInt(Number(cur.retire ?? 0))} aposentadas · ${formatInt(Number(ob.processed ?? 0))} eventos`}
                        </TableCell>
                        <TableCell className="text-caption text-fg-muted">{formatDateTimeBr(r.startedAt)}</TableCell>
                        <TableCell className="text-caption text-fg-muted">{r.requestedByName ?? "Rotina"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
