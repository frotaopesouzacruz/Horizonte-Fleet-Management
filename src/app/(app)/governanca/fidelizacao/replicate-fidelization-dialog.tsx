"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Calculator, CopyCheck } from "lucide-react";
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
import {
  replicateFidelizationCompetence,
  type FidelizationReplicationPreview,
  type FidelizationReplicationRow,
} from "@/lib/governance/actions";
import { formatCompetence, type Competence } from "@/lib/governance/competence";

const number = new Intl.NumberFormat("pt-BR");

/** O que cada situação da prévia significa, com a cor que a §58 pede: nada ignorado passa em silêncio. */
const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  new: { label: "Novo", tone: "success" },
  kept: { label: "Preservado", tone: "neutral" },
  conflict: { label: "Conflito", tone: "danger" },
  skipped_inactive_br: { label: "Ignorado", tone: "warning" },
  skipped_inactive_vehicle: { label: "Ignorado", tone: "warning" },
  skipped_inactive_driver: { label: "Ignorado", tone: "warning" },
};

function statusOf(value: string | null) {
  return value ? STATUS[value] ?? { label: value, tone: "neutral" as StatusTone } : null;
}

export interface ReplicateFidelizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  competence: Competence;
  operations: { id: string; name: string; status: string }[];
  /** Sem `fidelization.change_driver`, os motoristas ficam de fora — a chave nem abre. */
  canChangeDriver: boolean;
}

/**
 * Replicar competência da fidelização (§37, CA16).
 *
 * A prévia e a execução são a mesma rotina, chamada duas vezes — uma com
 * `dryRun` e uma sem. Uma consulta separada para "contar o que aconteceria"
 * seria uma segunda implementação da mesma regra, e no dia em que as duas
 * divergissem a pessoa confirmaria uma coisa e receberia outra.
 *
 * O destino nunca é sobrescrito: o que já está planejado lá é preservado, o
 * veículo já usado em outra BR é conflito, e só o que não existe é novo.
 */
export function ReplicateFidelizationDialog({
  open,
  onOpenChange,
  competence,
  operations,
  canChangeDriver,
}: ReplicateFidelizationDialogProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [running, startTransition] = React.useTransition();

  const nextMonth = React.useMemo(() => {
    const index = competence.year * 12 + competence.month; // já é +1
    return { year: Math.floor(index / 12), month: (index % 12) + 1 };
  }, [competence]);

  const [from, setFrom] = React.useState<Competence>(competence);
  const [to, setTo] = React.useState<Competence>(nextMonth);
  const [operationId, setOperationId] = React.useState("");
  const [includeDrivers, setIncludeDrivers] = React.useState(canChangeDriver);
  const [error, setError] = React.useState<string | null>(null);
  /** Qual dos dois botões está esperando o servidor — só ele mostra o spinner. */
  const [phase, setPhase] = React.useState<"preview" | "run" | null>(null);

  // A prévia carrega as entradas para as quais foi calculada. Comparar é o que
  // a invalida quando algo muda — confirmar uma contagem feita para outros
  // meses é exatamente o erro que a prévia existe para evitar.
  const [computed, setComputed] = React.useState<
    { key: string; data: FidelizationReplicationPreview } | null
  >(null);
  const inputKey = `${from.year}-${from.month}|${to.year}-${to.month}|${operationId}|${includeDrivers}`;
  const preview = computed?.key === inputKey ? computed.data : null;

  const sameMonth = from.year === to.year && from.month === to.month;
  const nothingToDo = preview ? preview.vehicles.new === 0 && preview.drivers.new === 0 : false;

  const run = (dryRun: boolean) => {
    setError(null);
    if (sameMonth) {
      setError("Origem e destino são a mesma competência — não há o que replicar.");
      return;
    }
    setPhase(dryRun ? "preview" : "run");
    startTransition(async () => {
      const result = await replicateFidelizationCompetence({
        from,
        to,
        operationId: operationId || null,
        includeDrivers,
        dryRun,
      });

      if (!result.ok) {
        setError(result.error ?? "Não foi possível replicar a fidelização.");
        return;
      }

      if (dryRun) {
        setComputed(result.data ? { key: inputKey, data: result.data } : null);
        return;
      }

      const v = result.data?.vehicles;
      const d = result.data?.drivers;
      toast({
        title: `Replicação concluída: ${number.format(v?.new ?? 0)} veículo(s) novo(s), ${number.format(v?.kept ?? 0)} preservado(s), ${number.format(v?.conflicts ?? 0)} conflito(s)` +
          (includeDrivers
            ? `; motoristas: ${number.format(d?.new ?? 0)} novo(s), ${number.format(d?.kept ?? 0)} preservado(s).`
            : "."),
        variant: "success",
      });
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Replicar competência</DialogTitle>
          <DialogDescription>
            Copia os veículos fidelizados — e, se quiser, os motoristas — de uma competência para
            outra. O destino nunca é sobrescrito: o que já está planejado lá é preservado.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          {error ? (
            <Alert variant="danger">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
            <FormField label="Origem" id="replicate-fid-from">
              <CompetencePicker value={from} onChange={setFrom} disabled={running} />
            </FormField>
            <ArrowRight aria-hidden className="mb-2.5 hidden size-4 shrink-0 text-fg-muted sm:block" />
            <FormField label="Destino" id="replicate-fid-to">
              <CompetencePicker value={to} onChange={setTo} disabled={running} />
            </FormField>
          </div>

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
                ? "Copia também o motorista principal de cada vínculo, quando o veículo entrar como novo ou já estiver preservado no destino."
                : "Exige a permissão de alterar motoristas. Só os veículos serão replicados."
            }
            checked={includeDrivers}
            disabled={running || !canChangeDriver}
            onCheckedChange={setIncludeDrivers}
            className="rounded-md border border-border bg-surface px-3"
          />

          {preview ? (
            <>
              <Alert variant={preview.vehicles.conflicts > 0 ? "warning" : "info"} icon={<CopyCheck />}>
                <AlertTitle>
                  Prévia de {formatCompetence(from)} para {formatCompetence(to)}
                </AlertTitle>
                <AlertDescription>
                  <span className="block">
                    Veículos: <strong>{number.format(preview.vehicles.new)}</strong> novos ·{" "}
                    <strong>{number.format(preview.vehicles.kept)}</strong> preservados ·{" "}
                    <strong>{number.format(preview.vehicles.conflicts)}</strong> conflitos ·{" "}
                    <strong>{number.format(preview.vehicles.skipped)}</strong> ignorados
                  </span>
                  {includeDrivers ? (
                    <span className="block">
                      Motoristas: <strong>{number.format(preview.drivers.new)}</strong> novos ·{" "}
                      <strong>{number.format(preview.drivers.kept)}</strong> preservados ·{" "}
                      <strong>{number.format(preview.drivers.conflicts)}</strong> conflitos ·{" "}
                      <strong>{number.format(preview.drivers.skipped)}</strong> ignorados
                    </span>
                  ) : null}
                  {nothingToDo ? (
                    <span className="mt-2 block">
                      Nada a fazer: o destino já reflete a origem. Executar de novo não muda nada.
                    </span>
                  ) : null}
                </AlertDescription>
              </Alert>

              <TableContainer stickyHeader maxHeight={280}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>BR</TableHead>
                      <TableHead>Veículo</TableHead>
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
                        message="Nenhum vínculo na competência de origem para este recorte."
                      />
                    ) : (
                      preview.rows.map((row) => (
                        <PreviewRow key={`${row.brId}:${row.vehicleId}`} row={row} withDrivers={includeDrivers} />
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={running}>
            Cancelar
          </Button>
          <Button
            variant="secondary"
            leadingIcon={<Calculator />}
            onClick={() => run(true)}
            loading={running && phase === "preview"}
            disabled={running}
          >
            Calcular prévia
          </Button>
          {/* Só habilita com uma prévia calculada para exatamente estas
              entradas: mudar o mês depois da prévia volta a exigir outra. */}
          <Button
            leadingIcon={<CopyCheck />}
            onClick={() => run(false)}
            loading={running && phase === "run"}
            disabled={!preview || nothingToDo || running}
          >
            Replicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
