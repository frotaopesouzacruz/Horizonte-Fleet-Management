"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CopyCheck, RefreshCw } from "lucide-react";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { SwitchField } from "@/components/ui/switch";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import {
  Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import { CompetencePicker } from "@/components/governance/competence-picker";
import { NativeSelect } from "@/components/governance/selects";
import { cn } from "@/lib/cn";
import {
  replicateFidelizationCompetence,
  type FidelizationReplicationPreview,
  type FidelizationReplicationRow,
  type Result,
} from "@/lib/governance/actions";
import { currentCompetence as clientCompetence, formatCompetence, type Competence } from "@/lib/governance/competence";
import {
  compareCompetence,
  formatDateTimeBr,
  isHistoricalCompetence,
  lastDayLabel,
  parseCompetenceKey,
  shiftCompetence,
} from "@/lib/governance/fidelization-competence";

const number = new Intl.NumberFormat("pt-BR");

/** O que cada situação da prévia significa, com a cor que a §58 pede: nada ignorado passa em silêncio. */
const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  new: { label: "Nova", tone: "success" },
  kept: { label: "Já existe", tone: "neutral" },
  conflict: { label: "Conflito", tone: "danger" },
  skipped_inactive_br: { label: "Ignorada", tone: "warning" },
  skipped_inactive_vehicle: { label: "Ignorada", tone: "warning" },
  skipped_inactive_driver: { label: "Ignorado", tone: "warning" },
};

function statusOf(value: string | null) {
  return value ? STATUS[value] ?? { label: value, tone: "neutral" as StatusTone } : null;
}

export interface ReplicateInput {
  from: Competence;
  to: Competence;
  operationId?: string | null;
  includeDrivers: boolean;
  dryRun: boolean;
}

export type ReplicateRunner = (input: ReplicateInput) => Promise<Result<FidelizationReplicationPreview>>;

export interface ReplicateFidelizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A competência em tela. */
  competence: Competence;
  /** O mês corrente no fuso da operação ("2026-10"), lido do servidor; sem ele, o relógio do navegador. */
  currentCompetence?: string | null;
  operations: { id: string; name: string; status: string }[];
  /** Sem `fidelization.change_driver`, os motoristas ficam de fora — a chave nem abre. */
  canChangeDriver: boolean;
  /** Com a competência de destino já em andamento, incluir placas desde o dia 1º é correção histórica. */
  canManageHistorical?: boolean;
  /** Só para as prévias de desenvolvimento: substitui a rotina do servidor. */
  runner?: ReplicateRunner;
}

/**
 * Replicar competência (§37, CA16) — competência mensal contínua.
 *
 * A posição vigente no ÚLTIMO dia da origem vira a posição inicial do destino,
 * em vínculos mensais novos. É a mesma rotina da replicação automática do dia
 * 1º (o motor do banco é um só), com a mesma prévia: novas, já existentes,
 * conflitos e ignoradas. O destino nunca é sobrescrito e nada se duplica: se
 * a competência de destino já foi criada, a tela diz quando, por quem e de
 * que jeito, e só oferece complementar as placas que faltam.
 *
 * A prévia e a execução são a mesma chamada, uma com `dryRun` e uma sem: uma
 * consulta separada para "contar o que aconteceria" seria uma segunda
 * implementação da regra.
 */
export function ReplicateFidelizationDialog({
  open,
  onOpenChange,
  competence,
  currentCompetence,
  operations,
  canChangeDriver,
  canManageHistorical = true,
  runner = replicateFidelizationCompetence,
}: ReplicateFidelizationDialogProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [running, startRun] = React.useTransition();
  const [previewing, startPreview] = React.useTransition();

  // Destino padrão: o mês corrente — ou o mês em tela, quando é um mês futuro
  // que se está planejando. Origem: o mês anterior ao destino.
  const current = React.useMemo(
    () => parseCompetenceKey(currentCompetence) ?? clientCompetence(),
    [currentCompetence],
  );
  const initialTo =
    compareCompetence(competence, current) > 0 && !isHistoricalCompetence(competence) ? competence : current;

  const [to, setTo] = React.useState<Competence>(initialTo);
  const [from, setFrom] = React.useState<Competence>(() => shiftCompetence(initialTo, -1));
  const [fromTouched, setFromTouched] = React.useState(false);
  const [operationId, setOperationId] = React.useState("");
  const [includeDrivers, setIncludeDrivers] = React.useState(canChangeDriver);
  const [runError, setRunError] = React.useState<string | null>(null);

  const inputKey = `${from.year}-${from.month}|${to.year}-${to.month}|${operationId}|${includeDrivers}`;
  const [computed, setComputed] = React.useState<{ key: string; data: FidelizationReplicationPreview } | null>(null);
  const [previewError, setPreviewError] = React.useState<{ key: string; message: string } | null>(null);
  const [refresh, setRefresh] = React.useState(0);

  const invalid = (() => {
    if (compareCompetence(to, from) <= 0) return "A competência de destino precisa ser posterior à de origem.";
    if (isHistoricalCompetence(from) || isHistoricalCompetence(to)) {
      return "Competências de 2024 e 2025 são históricas (somente consulta) e não entram na replicação.";
    }
    return null;
  })();

  // A prévia é calculada sozinha ao abrir e a cada mudança de origem, destino,
  // operação ou motoristas: "placas encontradas" e o destino já criado
  // aparecem antes de qualquer clique.
  React.useEffect(() => {
    if (!open || invalid) return;
    let cancelled = false;
    const key = inputKey;
    startPreview(async () => {
      const result = await runner({ from, to, operationId: operationId || null, includeDrivers, dryRun: true });
      if (cancelled) return;
      if (!result.ok) {
        setPreviewError({ key, message: result.error ?? "Não foi possível calcular a prévia." });
        return;
      }
      setPreviewError(null);
      setComputed(result.data ? { key, data: result.data } : null);
    });
    return () => {
      cancelled = true;
    };
  }, [open, invalid, inputKey, from, to, operationId, includeDrivers, runner, refresh]);

  const preview = computed?.key === inputKey ? computed.data : null;
  const error = runError ?? (previewError?.key === inputKey ? previewError.message : null);
  const newPlates = preview?.vehicles.new ?? 0;
  const newDrivers = includeDrivers ? preview?.drivers.new ?? 0 : 0;
  const nothingToDo = preview ? newPlates === 0 && newDrivers === 0 : true;
  const alreadyCreated = preview?.alreadyCreated ?? false;
  const destinationStarted = compareCompetence(to, current) === 0 && new Date().getDate() > 1;

  const plural = (n: number, one: string, many: string) => `${number.format(n)} ${n === 1 ? one : many}`;
  const confirmLabel = alreadyCreated
    ? `Complementar (${plural(newPlates, "placa", "placas")})`
    : `Replicar (${plural(newPlates, "placa", "placas")})`;

  const onChangeTo = (value: Competence) => {
    setRunError(null);
    setTo(value);
    if (!fromTouched) setFrom(shiftCompetence(value, -1));
  };

  const run = () => {
    setRunError(null);
    startRun(async () => {
      const result = await runner({ from, to, operationId: operationId || null, includeDrivers, dryRun: false });
      if (!result.ok) {
        setRunError(result.error ?? "Não foi possível replicar a fidelização.");
        return;
      }
      const v = result.data?.vehicles;
      const d = result.data?.drivers;
      toast({
        title:
          `${alreadyCreated ? "Complementação" : "Replicação"} de ${formatCompetence(to)} concluída: ` +
          `${plural(v?.new ?? 0, "placa nova", "placas novas")}, ${plural(v?.kept ?? 0, "já existente", "já existentes")}, ` +
          `${plural(v?.conflicts ?? 0, "conflito", "conflitos")}` +
          (includeDrivers ? `; motoristas: ${plural(d?.new ?? 0, "novo", "novos")}.` : "."),
        variant: "success",
      });
      onOpenChange(false);
      router.refresh();
    });
  };

  const byStatus = (status: "new" | "kept" | "conflict" | "skipped") =>
    (preview?.rows ?? []).filter((r) => (status === "skipped" ? r.status.startsWith("skipped") : r.status === status));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Replicar competência</DialogTitle>
          <DialogDescription>
            A posição vigente no último dia da competência de origem vira a posição inicial da competência de
            destino, em vínculos mensais novos. Nada é sobrescrito nem duplicado: só entram as placas que ainda
            não estão no destino. Lideranças não são alteradas.
          </DialogDescription>
        </DialogHeader>

        {/* Nenhum bloco encolhe: o corpo do diálogo rola, e um filho com
            overflow escondido seria espremido até sumir. */}
        <DialogBody className="flex flex-col gap-4 [&>*]:shrink-0">
          {error ? (
            <Alert variant="danger">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
            <FormField label="Origem" id="replicate-fid-from">
              <CompetencePicker
                value={from}
                onChange={(v) => {
                  setRunError(null);
                  setFromTouched(true);
                  setFrom(v);
                }}
                disabled={running}
              />
            </FormField>
            <ArrowRight aria-hidden className="mb-2.5 hidden size-4 shrink-0 text-fg-muted sm:block" />
            <FormField label="Destino" id="replicate-fid-to">
              <CompetencePicker value={to} onChange={onChangeTo} disabled={running} />
            </FormField>
          </div>

          <dl
            className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border-subtle sm:grid-cols-4"
            data-testid="replicate-facts"
          >
            <Fact label="Competência de origem" value={formatCompetence(from)} />
            <Fact label="Data de referência" value={lastDayLabel(from)} hint="Último dia da origem" />
            <Fact label="Competência de destino" value={formatCompetence(to)} />
            <Fact
              label="Placas encontradas"
              value={invalid ? "—" : preview ? number.format(preview.platesFound) : previewing ? "…" : "—"}
              hint="Vigentes na data de referência"
            />
          </dl>

          {invalid ? (
            <Alert variant="warning">
              <AlertDescription>{invalid}</AlertDescription>
            </Alert>
          ) : preview ? (
            alreadyCreated ? (
              <Alert variant="warning" data-testid="replicate-already-created">
                <AlertTitle>
                  A competência {formatCompetence(to)} já foi criada
                  {preview.destination?.createdAt ? ` em ${formatDateTimeBr(preview.destination.createdAt)}` : ""}
                  {` por ${preview.destination?.createdByName ?? (preview.destination?.origin === "auto_replication" ? "Rotina automática" : "Sistema")}`}
                  {preview.destination?.originLabel ? ` (${preview.destination.originLabel})` : ""}.
                </AlertTitle>
                <AlertDescription>
                  Nenhum registro será duplicado.{" "}
                  {newPlates > 0
                    ? `Só as placas que ainda não estão no destino podem ser complementadas: ${plural(newPlates, "placa", "placas")}.`
                    : "Todas as placas da origem já estão no destino (ou em conflito): não há o que complementar."}
                </AlertDescription>
              </Alert>
            ) : (
              <Alert variant="info" data-testid="replicate-not-created">
                <AlertDescription>
                  {formatCompetence(to)} ainda não foi criada. Ao confirmar, ela nasce da posição de{" "}
                  {lastDayLabel(from)} como <strong>Replicação manual</strong>
                  {preview.status === "confirmed" ? ", com os vínculos confirmados (mês corrente)." : ", com os vínculos planejados."}
                </AlertDescription>
              </Alert>
            )
          ) : null}

          {preview && destinationStarted && newPlates > 0 && !canManageHistorical ? (
            <Alert variant="warning">
              <AlertDescription>
                {formatCompetence(to)} já começou: incluir placas desde o dia 1º é correção histórica e exige a
                permissão &quot;Corrigir dados históricos da fidelização&quot;.
              </AlertDescription>
            </Alert>
          ) : null}

          <FormField
            label="Operação"
            id="replicate-fid-operation"
            labelHint="Opcional"
            helperText="Em branco, replica todas as operações do seu escopo."
          >
            <NativeSelect
              id="replicate-fid-operation"
              value={operationId}
              disabled={running}
              onChange={(e) => setOperationId(e.target.value)}
            >
              <option value="">Todas as operações</option>
              {operations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>

          <SwitchField
            id="replicate-fid-drivers"
            label="Incluir motoristas"
            description={
              canChangeDriver
                ? "Copia também o motorista principal de cada placa, quando ela entra como nova ou já existe no destino sem motorista."
                : "Exige a permissão de alterar motoristas. Só os veículos serão replicados."
            }
            checked={includeDrivers}
            disabled={running || !canChangeDriver}
            onCheckedChange={setIncludeDrivers}
            className="rounded-md border border-border bg-surface px-3"
          />

          {preview ? (
            <section aria-label="Prévia da replicação" className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="replicate-breakdown">
                <Bucket label="Novas" tone="success" rows={byStatus("new")} count={preview.vehicles.new} />
                <Bucket label="Já existentes" tone="neutral" rows={byStatus("kept")} count={preview.vehicles.kept} />
                <Bucket label="Conflitos" tone="danger" rows={byStatus("conflict")} count={preview.vehicles.conflicts} />
                <Bucket label="Ignoradas" tone="warning" rows={byStatus("skipped")} count={preview.vehicles.skipped} />
              </div>
              {includeDrivers ? (
                <p className="text-body-sm text-fg-secondary">
                  Motoristas: <strong>{number.format(preview.drivers.new)}</strong> novos ·{" "}
                  <strong>{number.format(preview.drivers.kept)}</strong> já existentes ·{" "}
                  <strong>{number.format(preview.drivers.conflicts)}</strong> conflitos ·{" "}
                  <strong>{number.format(preview.drivers.skipped)}</strong> ignorados
                </p>
              ) : null}

              <TableContainer stickyHeader maxHeight={260}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>BR</TableHead>
                      <TableHead>Placa</TableHead>
                      <TableHead>Situação</TableHead>
                      <TableHead>Observação</TableHead>
                      {includeDrivers ? <TableHead>Motorista</TableHead> : null}
                      {includeDrivers ? <TableHead>Situação</TableHead> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.rows.length === 0 ? (
                      <TableEmpty
                        colSpan={includeDrivers ? 6 : 4}
                        message={`Nenhuma placa vigente em ${lastDayLabel(from)} neste recorte.`}
                      />
                    ) : (
                      preview.rows.map((row) => (
                        <PreviewRow key={`${row.brId}:${row.vehicleId}`} row={row} withDrivers={includeDrivers} />
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </section>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={running}>
            Cancelar
          </Button>
          <Button
            variant="secondary"
            leadingIcon={<RefreshCw />}
            onClick={() => {
              setRunError(null);
              setRefresh((n) => n + 1);
            }}
            loading={previewing && !running}
            disabled={running || Boolean(invalid)}
          >
            Atualizar prévia
          </Button>
          {/* Só habilita com uma prévia calculada para exatamente estas
              entradas: mudar o mês depois da prévia volta a exigir outra. */}
          <Button
            leadingIcon={<CopyCheck />}
            onClick={run}
            loading={running}
            disabled={!preview || nothingToDo || running || previewing || Boolean(invalid)}
            data-testid="replicate-confirm"
          >
            {preview ? confirmLabel : "Replicar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Fact({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 bg-surface-raised px-3 py-2">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="text-body font-semibold tabular-nums text-fg">{value}</dd>
      {hint ? <dd className="text-caption text-fg-muted">{hint}</dd> : null}
    </div>
  );
}

/** Um balde da prévia: quantas placas e as primeiras, para conferir com o que se espera. */
function Bucket({
  label,
  tone,
  rows,
  count,
}: {
  label: string;
  tone: StatusTone;
  rows: FidelizationReplicationRow[];
  count: number;
}) {
  const examples = rows.slice(0, 3).map((r) => r.licensePlate ?? r.fleetCode ?? "—");
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-md border px-3 py-2",
        count > 0 && tone === "danger" ? "border-danger/40" : "border-border",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <StatusBadge status={tone} size="sm">{label}</StatusBadge>
        <span className="text-h3 font-semibold tabular-nums text-fg">{number.format(count)}</span>
      </span>
      <span className="truncate text-caption text-fg-muted" title={examples.join(", ")}>
        {examples.length ? `${examples.join(", ")}${count > examples.length ? "…" : ""}` : "—"}
      </span>
    </div>
  );
}

function PreviewRow({ row, withDrivers }: { row: FidelizationReplicationRow; withDrivers: boolean }) {
  const vehicle = statusOf(row.status);
  const driver = statusOf(row.driverStatus);
  return (
    <TableRow>
      <TableCell className="font-medium text-fg">{row.brCode}</TableCell>
      <TableCell>
        {row.licensePlate ?? row.fleetCode ?? "—"}
        {row.fleetCode && row.licensePlate && row.fleetCode !== row.licensePlate ? (
          <span className="block text-caption text-fg-muted">frota {row.fleetCode}</span>
        ) : null}
      </TableCell>
      <TableCell>
        {vehicle ? <StatusBadge status={vehicle.tone}>{vehicle.label}</StatusBadge> : "—"}
      </TableCell>
      <TableCell className="text-body-sm text-fg-secondary">{row.note ?? "—"}</TableCell>
      {withDrivers ? (
        <TableCell>{row.driverName ?? <span className="text-fg-muted">—</span>}</TableCell>
      ) : null}
      {withDrivers ? (
        <TableCell>
          {driver ? (
            <>
              <StatusBadge status={driver.tone}>{driver.label}</StatusBadge>
              {row.driverNote ? (
                <span className="block text-caption text-fg-muted">{row.driverNote}</span>
              ) : null}
            </>
          ) : (
            <span className="text-fg-muted">—</span>
          )}
        </TableCell>
      ) : null}
    </TableRow>
  );
}
