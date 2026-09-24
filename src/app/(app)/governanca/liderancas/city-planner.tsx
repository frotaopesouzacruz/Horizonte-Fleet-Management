"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MapPin, Pencil, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import { useConfirm } from "@/components/feedback/confirm-dialog";
import { NativeSelect } from "@/components/governance/selects";
import { setCityLeadership } from "@/lib/governance/actions";
import { formatCompetence, type Competence } from "@/lib/governance/competence";
import {
  anchorDate, competenceTense, filterPlanner, leaderAt,
  type CityLeadershipSaver, type LeadershipPlanner, type PlannerCity, type PlannerLeader, type PlannerOperation,
} from "@/lib/governance/leadership-planner-types";

const number = new Intl.NumberFormat("pt-BR");

function formatDate(value: string | null): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  return d ? `${d}/${m}/${y}` : value;
}

/** Véspera de uma data ISO, sem fuso: é aritmética de calendário. */
function dayBefore(value: string): string {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d - 1));
  return date.toISOString().slice(0, 10);
}

function period(leader: PlannerLeader): string {
  return leader.effectiveTo
    ? `${formatDate(leader.effectiveFrom)} a ${formatDate(leader.effectiveTo)}`
    : `desde ${formatDate(leader.effectiveFrom)} · em aberto`;
}

export interface CityPlannerProps {
  planner: LeadershipPlanner;
  competence: Competence;
  filters: { operationId?: string; stateId?: string; cityId?: string; employeeId?: string };
  /** `leadership.manage` + `leadership.assign`: escolher a liderança de uma cidade. */
  canPlan: boolean;
  /** `leadership.manage`: remover a liderança de uma cidade. */
  canRemove: boolean;
  /** `leadership.manage_historical_data`: planejar uma competência que já passou. */
  canManageHistorical: boolean;
  /** Abre a gaveta de vigência do vínculo (datas exatas, prévia de impacto). */
  onEdit?: (operation: PlannerOperation, city: PlannerCity, leader: PlannerLeader) => void;
  /** A prévia de desenvolvimento injeta a gravação; a tela real usa a server action. */
  saver?: CityLeadershipSaver;
}

interface PendingHistorical {
  operation: PlannerOperation;
  city: PlannerCity;
  employeeId: string | null;
  employeeName: string | null;
}

/**
 * Lideranças › Planejamento — Tipo de Operação → Cidades → liderança.
 *
 * O mesmo gesto do Planner de Lideranças do HFC: escolher a pessoa no seletor
 * da cidade grava; a lixeira remove. A diferença é o que fica registrado: a
 * escolha é um período em `leadership_assignments` — de hoje em diante na
 * competência corrente, do dia 1º numa futura — e a liderança anterior é
 * encerrada na véspera, não apagada. Uma competência que já passou é correção
 * histórica: pede o motivo e a permissão própria.
 */
export function CityPlanner({
  planner,
  competence,
  filters,
  canPlan,
  canRemove,
  canManageHistorical,
  onEdit,
  saver,
}: CityPlannerProps) {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [busyCity, setBusyCity] = React.useState<string | null>(null);
  const [historical, setHistorical] = React.useState<PendingHistorical | null>(null);

  const tense = competenceTense(planner);
  const day = anchorDate(planner);
  const operations = React.useMemo(() => filterPlanner(planner.operations, filters, day), [planner, filters, day]);
  const candidateIds = React.useMemo(() => new Set(planner.candidates.map((c) => c.id)), [planner.candidates]);
  const competenceLabel = formatCompetence(competence);
  const locked = tense === "past" && !canManageHistorical;

  /** A partir de quando a escolha vale, dito antes de gravar. */
  const startLabel =
    tense === "current" ? `a partir de hoje (${formatDate(planner.today)})` : `a partir de ${formatDate(planner.monthStart)}`;

  const save = async (
    city: PlannerCity,
    employeeId: string | null,
    reason: string | null,
  ): Promise<boolean> => {
    setBusyCity(city.operationCityId);
    try {
      const run = saver ?? setCityLeadership;
      const result = await run({ operationCityId: city.operationCityId, competence, employeeId, reason });
      if (!result.ok || !result.data) {
        toast({ title: result.error ?? "Não foi possível salvar a liderança da cidade.", variant: "danger" });
        return false;
      }
      const r = result.data;
      const place = `${r.cityName}/${r.uf}`;
      if (r.action === "unchanged") {
        toast({ title: `Nada mudou em ${place}.`, variant: "neutral" });
      } else if (r.action === "removed") {
        toast({
          title: `${place} sem liderança a partir de ${formatDate(r.effectiveFrom)}.`,
          description: r.previous?.employeeName
            ? `${r.previous.employeeName} continua registrado nos dias anteriores.`
            : undefined,
          variant: "success",
        });
      } else {
        toast({
          title: `${place}: ${r.employeeName ?? "liderança"} a partir de ${formatDate(r.effectiveFrom)}.`,
          description: [
            r.effectiveTo ? `Vale até ${formatDate(r.effectiveTo)}.` : "Vigência em aberto.",
            r.previous?.employeeName
              ? r.previous.action === "cancelled"
                ? `O planejamento anterior (${r.previous.employeeName}) foi cancelado.`
                : `${r.previous.employeeName} responde até ${formatDate(dayBefore(r.effectiveFrom))}.`
              : null,
            r.previous?.resumesFrom ? `A partir de ${formatDate(r.previous.resumesFrom)} volta a liderança anterior.` : null,
          ]
            .filter(Boolean)
            .join(" "),
          variant: "success",
        });
      }
      for (const warning of r.warnings) toast({ title: warning, variant: "warning" });
      router.refresh();
      return true;
    } finally {
      setBusyCity(null);
    }
  };

  const choose = (operation: PlannerOperation, city: PlannerCity, employeeId: string) => {
    if (!employeeId) return;
    if (tense === "past") {
      const name = planner.candidates.find((c) => c.id === employeeId)?.name ?? null;
      setHistorical({ operation, city, employeeId, employeeName: name });
      return;
    }
    void save(city, employeeId, null);
  };

  const remove = async (operation: PlannerOperation, city: PlannerCity, leader: PlannerLeader) => {
    if (tense === "past") {
      setHistorical({ operation, city, employeeId: null, employeeName: leader.employeeName });
      return;
    }
    const ok = await confirm({
      title: `Remover a liderança de ${city.cityName}/${city.uf}?`,
      description: `${leader.employeeName} deixa de responder pela cidade ${startLabel}. Os dias anteriores continuam registrados com ${leader.employeeName} — nada é apagado, e o perfil de acesso de ninguém muda.`,
      confirmLabel: "Remover",
      destructive: true,
    });
    if (ok) await save(city, null, null);
  };

  const places = operations.reduce((sum, op) => sum + op.cities.length, 0);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-1 py-3">
          <h2 className="text-body font-semibold text-fg">
            Tipos de Operação · Cidades — {competenceLabel}
          </h2>
          <p className="text-body-sm text-fg-secondary">
            {tense === "past"
              ? "Competência encerrada: trocar ou remover uma liderança aqui é correção histórica, com motivo, e vale só para este mês."
              : `Escolha a liderança de cada cidade. A escolha vale ${startLabel}; quem respondia antes fica registrado até a véspera.`}
          </p>
          {locked ? (
            <p className="text-caption text-fg-muted">
              Só quem pode corrigir dados históricos da liderança altera uma competência que já passou.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {operations.length === 0 || places === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-body-sm text-fg-muted">
            {planner.operations.length === 0
              ? "Nenhuma operação ativa com cidades no seu escopo."
              : "Nenhuma cidade corresponde aos filtros."}
          </CardContent>
        </Card>
      ) : (
        operations.map((operation) => {
          const withLeader = operation.cities.filter((c) => leaderAt(c, day)).length;
          return (
            <section
              key={operation.id}
              aria-labelledby={`op-${operation.id}`}
              className="overflow-hidden rounded-md border border-border bg-surface"
            >
              <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                <h3 id={`op-${operation.id}`} className="text-body font-semibold text-fg">
                  {operation.name}
                </h3>
                {operation.code ? (
                  <Badge variant="neutral" appearance="soft" size="sm" className="font-mono">
                    {operation.code}
                  </Badge>
                ) : null}
                <Badge variant="primary" appearance="soft" size="sm">
                  {operation.cities.length === 1 ? "1 cidade" : `${number.format(operation.cities.length)} cidades`}
                </Badge>
                <span className="ml-auto text-caption text-fg-muted">
                  {number.format(withLeader)} de {number.format(operation.cities.length)} com liderança
                </span>
              </header>

              <ul className="divide-y divide-border">
                {operation.cities.map((city) => {
                  const current = leaderAt(city, day);
                  const others = city.leaders.filter((l) => l.id !== current?.id);
                  const busy = busyCity === city.operationCityId;
                  const place = `${city.cityName}/${city.uf}`;
                  const outsideProfile = current && !candidateIds.has(current.employeeId);
                  return (
                    <li
                      key={city.operationCityId}
                      className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3"
                      data-testid="planner-city"
                    >
                      <div className="flex min-w-[10rem] flex-1 items-start gap-2 pt-1.5 sm:max-w-[16rem]">
                        <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-fg">{city.cityName}</p>
                          <p className="text-caption text-fg-muted">{city.uf}</p>
                        </div>
                      </div>

                      <div className="flex min-w-[14rem] flex-[2] flex-col gap-1">
                        <NativeSelect
                          fieldSize="sm"
                          aria-label={`Liderança de ${place}`}
                          value={current?.employeeId ?? ""}
                          disabled={!canPlan || locked || busy}
                          onChange={(e) => choose(operation, city, e.target.value)}
                        >
                          <option value="" disabled={Boolean(current)}>
                            Selecionar liderança
                          </option>
                          {current && outsideProfile ? (
                            <option value={current.employeeId}>
                              {current.employeeName}
                              {current.employeeCode ? ` · ${current.employeeCode}` : ""}
                              {current.employeeActive ? " (fora do perfil Liderança Operações)" : " (inativo)"}
                            </option>
                          ) : null}
                          {planner.candidates.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                              {c.code ? ` · ${c.code}` : ""}
                            </option>
                          ))}
                        </NativeSelect>
                        <p className="text-caption text-fg-muted">
                          {busy
                            ? "Salvando…"
                            : current
                              ? period(current)
                              : `Sem liderança em ${formatDate(day)}`}
                        </p>
                        {others.map((o) => (
                          <p key={o.id} className="flex items-center gap-1 text-caption text-fg-muted">
                            <span className="min-w-0">
                              {o.effectiveFrom > day ? "Depois" : "Antes"}: {o.employeeName} ({period(o)})
                            </span>
                            {onEdit && canRemove ? (
                              <IconButton
                                label={`Editar responsabilidade de ${o.employeeName}`}
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                onClick={() => onEdit(operation, city, o)}
                              >
                                <Pencil />
                              </IconButton>
                            ) : null}
                          </p>
                        ))}
                        {city.brExceptions > 0 ? (
                          <p className="text-caption text-fg-secondary">
                            {city.brExceptions === 1
                              ? "1 BR com liderança própria"
                              : `${number.format(city.brExceptions)} BRs com liderança própria`}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex shrink-0 items-center gap-1 pt-0.5">
                        {current && onEdit && canRemove ? (
                          <IconButton
                            label="Editar responsabilidade"
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => onEdit(operation, city, current)}
                          >
                            <Pencil />
                          </IconButton>
                        ) : null}
                        {current && canRemove && !locked ? (
                          <IconButton
                            label={`Remover liderança de ${place}`}
                            variant="ghost"
                            size="sm"
                            className="text-danger hover:text-danger"
                            disabled={busy}
                            onClick={() => void remove(operation, city, current)}
                          >
                            <Trash2 />
                          </IconButton>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}

      <HistoricalDialog
        key={historical ? `${historical.city.operationCityId}-${historical.employeeId ?? "x"}` : "none"}
        pending={historical}
        competenceLabel={competenceLabel}
        onCancel={() => setHistorical(null)}
        onConfirm={async (reason) => {
          if (!historical) return;
          const ok = await save(historical.city, historical.employeeId, reason);
          if (ok) setHistorical(null);
        }}
      />
    </div>
  );
}

/** Uma competência que já passou só muda com motivo — e a tela diz o que vai acontecer. */
function HistoricalDialog({
  pending,
  competenceLabel,
  onCancel,
  onConfirm,
}: {
  pending: PendingHistorical | null;
  competenceLabel: string;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [running, setRunning] = React.useState(false);
  if (!pending) return null;
  const place = `${pending.city.cityName}/${pending.city.uf}`;

  return (
    <Dialog open onOpenChange={(open) => (!open && !running ? onCancel() : undefined)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Correção histórica — {place}</DialogTitle>
          <DialogDescription>
            {pending.employeeId
              ? `${pending.employeeName ?? "A pessoa escolhida"} passa a responder por ${place} em ${competenceLabel}.`
              : `${place} fica sem liderança em ${competenceLabel}.`}{" "}
            A mudança vale só para essa competência; a liderança que vinha depois dela continua valendo.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          {error ? (
            <Alert variant="danger">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <FormField label="Motivo da correção" required>
            <Textarea
              value={reason}
              maxLength={500}
              rows={3}
              placeholder="Ex.: a liderança de agosto foi cadastrada com a pessoa errada."
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" disabled={running} onClick={onCancel}>
            Cancelar
          </Button>
          <Button
            loading={running}
            onClick={async () => {
              if (!reason.trim()) {
                setError("Informe o motivo da correção histórica.");
                return;
              }
              setError(null);
              setRunning(true);
              try {
                await onConfirm(reason.trim());
              } finally {
                setRunning(false);
              }
            }}
          >
            Confirmar correção
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
