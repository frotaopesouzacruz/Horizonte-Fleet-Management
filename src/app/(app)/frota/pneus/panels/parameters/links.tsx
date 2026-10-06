"use client";

import * as React from "react";
import { Link2, Loader2, Plus, Replace, Undo2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import { NativeSelect } from "@/components/governance/selects";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { SearchField } from "@/components/ui/search-field";
import {
  Table, TableActionCell, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { setVehicleTireLayout, setVehicleTypeTireLayout } from "@/lib/tires/actions";
import { fmtInt, formatStamp, type TireFilterOptions, type TireLayout, type TiresCatalog } from "@/lib/tires/types";
import { PanelEmpty, REASON_MIN, ReasonDialog, vehicleName } from "../tires-ui";
import { normalizeText, useParamAction } from "./param-ui";

/**
 * Parâmetros → Vínculos. Qual layout cada tipo de equipamento usa por padrão
 * e as exceções por veículo (com motivo). Sem layout, o veículo usa as
 * posições em que há pneus na fotografia (inferido).
 */
const NONE = "";
const REASON_MAX = 300;

type VehicleLayoutRow = TiresCatalog["vehicleLayouts"][number];

export function LinksSection({
  catalog, canManage, vehicles, onDone,
}: {
  catalog: TiresCatalog;
  canManage: boolean;
  /** Veículos das opções da tela (null quando a leitura falhou). */
  vehicles: TireFilterOptions["vehicles"] | null;
  onDone: () => void;
}) {
  const layoutsById = React.useMemo(() => new Map(catalog.layouts.map((l) => [l.id, l])), [catalog.layouts]);
  const exceptions = catalog.vehicleLayouts.filter((v) => v.layoutId != null);
  const reverted = catalog.vehicleLayouts.length - exceptions.length;
  const activeLayouts = catalog.layouts.filter((l) => l.isActive);
  const [exceptionDialog, setExceptionDialog] = React.useState<{ row: VehicleLayoutRow | null } | null>(null);
  const [removing, setRemoving] = React.useState<VehicleLayoutRow | null>(null);

  return (
    <div className="flex flex-col gap-5" data-testid="tires-param-links">
      <TypeLayouts catalog={catalog} canManage={canManage} layoutsById={layoutsById} onDone={onDone} />

      <Card data-testid="tires-links-vehicles">
        <CardHeader
          className="flex-col sm:flex-row"
          title="Exceções por veículo"
          description="Veículo com configuração de eixos diferente do padrão do seu tipo. A exceção vale sobre o padrão do tipo; removê-la volta ao padrão."
          actions={
            canManage ? (
              <Button
                size="sm"
                variant="primary"
                leadingIcon={<Plus />}
                onClick={() => setExceptionDialog({ row: null })}
                disabled={!vehicles || activeLayouts.length === 0}
                title={!vehicles ? "A lista de veículos não pôde ser lida." : activeLayouts.length === 0 ? "Cadastre um layout ativo primeiro." : undefined}
                data-testid="tires-links-vehicle-add"
              >
                Adicionar exceção
              </Button>
            ) : null
          }
        />
        <CardContent className="flex flex-col gap-3 px-0 pb-0">
          {canManage && !vehicles ? (
            <div className="px-4">
              <Alert variant="warning" className="py-2">
                <AlertDescription>A lista de veículos não pôde ser lida agora; recarregue a página para adicionar exceções.</AlertDescription>
              </Alert>
            </div>
          ) : null}
          {exceptions.length === 0 ? (
            <div className="px-4 pb-4">
              <PanelEmpty
                icon={<Link2 />}
                title="Nenhuma exceção por veículo"
                description="Todos os veículos usam o layout padrão do seu tipo de equipamento (ou as posições da fotografia, quando o tipo não tem layout)."
                testId="tires-links-vehicles-empty"
              />
            </div>
          ) : (
            <TableContainer className="rounded-t-none border-x-0 border-b-0 shadow-none">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Veículo</TableHead>
                    <TableHead>Layout</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead>Atualizado em</TableHead>
                    {canManage ? <TableHead><span className="sr-only">Ações</span></TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exceptions.map((v) => {
                    const l = v.layoutId ? layoutsById.get(v.layoutId) : null;
                    return (
                      <TableRow key={v.vehicleId} className="align-top" data-testid="tires-links-vehicle-row">
                        <TableCell className="whitespace-nowrap py-2 font-semibold tabular-nums">{vehicleName(v.fleetCode, v.licensePlate)}</TableCell>
                        <TableCell className="py-2">
                          {l ? l.name : "Layout não encontrado"}
                          {l && !l.isActive ? <span className="block text-caption text-warning-soft-fg">Layout inativo</span> : null}
                        </TableCell>
                        <TableCell className="min-w-[14rem] max-w-[28rem] py-2 text-body-sm text-fg-secondary">{v.reason ?? "—"}</TableCell>
                        <TableCell className="whitespace-nowrap py-2 tabular-nums text-fg-secondary">{formatStamp(v.updatedAt)}</TableCell>
                        {canManage ? (
                          <TableActionCell className="py-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              leadingIcon={<Replace />}
                              onClick={() => setExceptionDialog({ row: v })}
                              disabled={activeLayouts.length === 0}
                              data-testid="tires-links-vehicle-change"
                            >
                              Trocar
                            </Button>
                            <Button size="sm" variant="ghost" leadingIcon={<Undo2 />} onClick={() => setRemoving(v)} data-testid="tires-links-vehicle-remove">
                              Remover
                            </Button>
                          </TableActionCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
          {reverted > 0 ? (
            <p className="px-4 pb-3 text-caption text-fg-muted">
              {fmtInt(reverted)} {reverted === 1 ? "veículo voltou" : "veículos voltaram"} ao padrão do tipo depois de ter exceção; o histórico fica na trilha de auditoria.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {exceptionDialog ? (
        <ExceptionDialog
          key={exceptionDialog.row?.vehicleId ?? "new"}
          row={exceptionDialog.row}
          vehicles={vehicles ?? []}
          exceptions={exceptions}
          layouts={activeLayouts}
          layoutsById={layoutsById}
          onClose={() => setExceptionDialog(null)}
          onDone={onDone}
        />
      ) : null}
      <ReasonDialog
        open={removing != null}
        onOpenChange={(o) => (!o ? setRemoving(null) : undefined)}
        title={`Remover a exceção de ${removing ? vehicleName(removing.fleetCode, removing.licensePlate) : ""}`}
        description="O veículo volta a usar o layout padrão do seu tipo de equipamento (ou as posições da fotografia, se o tipo não tiver layout)."
        confirmLabel="Remover exceção"
        destructive
        onConfirm={(reason) => setVehicleTireLayout(removing!.vehicleId, null, reason)}
        successTitle="Exceção removida"
        onDone={onDone}
        testId="tires-links-remove-dialog"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Padrão por tipo de equipamento
// ---------------------------------------------------------------------------
function TypeLayouts({
  catalog, canManage, layoutsById, onDone,
}: {
  catalog: TiresCatalog;
  canManage: boolean;
  layoutsById: Map<string, TireLayout>;
  onDone: () => void;
}) {
  const { busy, run } = useParamAction(onDone);
  // Escolha otimista: vale até a tela recarregar com o valor do banco.
  const [pending, setPending] = React.useState<Record<string, { base: string; value: string }>>({});
  const rows = catalog.vehicleTypeLayouts;

  const change = async (typeId: string, typeName: string, base: string, value: string) => {
    setPending((p) => ({ ...p, [typeId]: { base, value } }));
    const layoutName = value ? layoutsById.get(value)?.name : null;
    const ok = await run(`type:${typeId}`, () => setVehicleTypeTireLayout(typeId, value || null), {
      success: `Layout padrão de ${typeName} atualizado`,
      successDescription: layoutName ? `Agora: ${layoutName}.` : "Agora sem layout: posições inferidas da fotografia.",
      failure: "Não foi possível vincular o layout ao tipo",
    });
    if (!ok) {
      setPending((p) => {
        const next = { ...p };
        delete next[typeId];
        return next;
      });
    }
  };

  return (
    <Card data-testid="tires-links-types">
      <CardHeader
        title="Layout padrão por tipo de equipamento"
        description="Usado pela vistoria e pela qualidade para saber quais posições o veículo tem. “Sem layout” = posições inferidas da fotografia (onde há pneu montado)."
      />
      <CardContent className="px-0 pb-0">
        {rows.length === 0 ? (
          <p className="px-4 pb-4 text-body-sm text-fg-muted">Nenhum tipo de equipamento com veículos cadastrados.</p>
        ) : (
          <TableContainer className="rounded-t-none border-x-0 border-b-0 shadow-none">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo de equipamento</TableHead>
                  <TableHead>Layout padrão</TableHead>
                  <TableHead numeric>Posições</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => {
                  const base = t.layoutId ?? NONE;
                  const p = pending[t.vehicleTypeId];
                  const value = p && p.base === base ? p.value : base;
                  const layout = value ? layoutsById.get(value) : null;
                  const rowBusy = busy === `type:${t.vehicleTypeId}`;
                  // Ativos + o atual (mesmo inativo, para não sumir da lista).
                  const options = catalog.layouts.filter((l) => l.isActive || l.id === base);
                  return (
                    <TableRow key={t.vehicleTypeId} data-testid="tires-links-type-row">
                      <TableCell className="font-medium text-fg">{t.vehicleTypeName}</TableCell>
                      <TableCell className="min-w-[16rem] py-1.5">
                        {canManage ? (
                          <span className="flex max-w-md items-center gap-2">
                            <NativeSelect
                              fieldSize="sm"
                              value={value}
                              onChange={(e) => void change(t.vehicleTypeId, t.vehicleTypeName, base, e.target.value)}
                              disabled={rowBusy}
                              aria-label={`Layout padrão de ${t.vehicleTypeName}`}
                              data-testid="tires-links-type-select"
                            >
                              <option value={NONE}>Sem layout — inferido da fotografia</option>
                              {options.map((l) => (
                                <option key={l.id} value={l.id}>
                                  {l.name}
                                  {l.isActive ? "" : " (inativo)"}
                                </option>
                              ))}
                            </NativeSelect>
                            {rowBusy ? <Loader2 className="size-4 shrink-0 animate-spin text-fg-muted" aria-label="Salvando" /> : null}
                          </span>
                        ) : layout ? (
                          layout.name
                        ) : (
                          <span className="text-fg-muted">Sem layout — inferido da fotografia</span>
                        )}
                      </TableCell>
                      <TableCell numeric>{layout ? fmtInt(layout.positionCodes.length) : "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Exceção por veículo
// ---------------------------------------------------------------------------
const MAX_OPTIONS = 200;

function ExceptionDialog({
  row, vehicles, exceptions, layouts, layoutsById, onClose, onDone,
}: {
  row: VehicleLayoutRow | null;
  vehicles: TireFilterOptions["vehicles"];
  exceptions: VehicleLayoutRow[];
  layouts: TireLayout[];
  layoutsById: Map<string, TireLayout>;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [search, setSearch] = React.useState("");
  const [vehicleId, setVehicleId] = React.useState(row?.vehicleId ?? "");
  const [layoutId, setLayoutId] = React.useState(row?.layoutId && layouts.some((l) => l.id === row.layoutId) ? row.layoutId : "");
  const [reason, setReason] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const q = normalizeText(search);
  const matches = React.useMemo(
    () =>
      vehicles
        .filter((v) => !q || normalizeText(`${v.plate ?? ""} ${v.fleet ?? ""}`).includes(q))
        .sort((a, b) => (a.fleet ?? a.plate ?? "").localeCompare(b.fleet ?? b.plate ?? "", "pt-BR", { numeric: true })),
    [vehicles, q],
  );
  const shownOptions = matches.slice(0, MAX_OPTIONS);
  const selectedVehicle = vehicles.find((v) => v.id === vehicleId);
  const existing = exceptions.find((e) => e.vehicleId === vehicleId);
  const existingLayout = existing?.layoutId ? layoutsById.get(existing.layoutId) : null;

  const trimmed = reason.trim();
  const errors: { vehicle?: string; layout?: string; reason?: string } = {};
  if (!vehicleId) errors.vehicle = "Escolha o veículo.";
  if (!layoutId) errors.layout = "Escolha o layout.";
  else if (existing && existing.layoutId === layoutId) errors.layout = "O veículo já usa este layout.";
  if (trimmed.length < REASON_MIN) errors.reason = `Informe o motivo (mínimo de ${REASON_MIN} caracteres).`;
  else if (trimmed.length > REASON_MAX) errors.reason = `No máximo ${REASON_MAX} caracteres.`;
  const hasErrors = Object.keys(errors).length > 0;

  const submit = async () => {
    setSubmitted(true);
    if (hasErrors) return;
    setBusy(true);
    try {
      const r = await setVehicleTireLayout(vehicleId, layoutId, trimmed);
      if (!r.ok) {
        toast({ title: "Não foi possível definir o layout do veículo", description: r.error, variant: "danger" });
        return;
      }
      const name = selectedVehicle ? vehicleName(selectedVehicle.fleet, selectedVehicle.plate) : row ? vehicleName(row.fleetCode, row.licensePlate) : "veículo";
      toast({ title: `Layout de ${name} definido`, description: layoutsById.get(layoutId)?.name, variant: "success" });
      onClose();
      onDone();
    } catch {
      toast({ title: "Falha de comunicação com o servidor", description: "Tente de novo.", variant: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => (!o && !busy ? onClose() : undefined)}>
      <DialogContent size="md" data-testid="tires-links-exception-dialog">
        <DialogHeader>
          <DialogTitle>{row ? `Trocar o layout de ${vehicleName(row.fleetCode, row.licensePlate)}` : "Nova exceção por veículo"}</DialogTitle>
          <DialogDescription>A exceção vale sobre o layout padrão do tipo de equipamento. O motivo fica na trilha de auditoria.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-4" disabled={busy}>
            <legend className="sr-only">Exceção</legend>
            {row ? (
              <p className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-body-sm">
                <span className="font-semibold tabular-nums text-fg">{vehicleName(row.fleetCode, row.licensePlate)}</span>
                <span className="block text-caption text-fg-muted">Layout atual: {existingLayout?.name ?? "—"}</span>
              </p>
            ) : (
              <>
                <FormField label="Buscar veículo" helperText={`${fmtInt(matches.length)} ${matches.length === 1 ? "veículo encontrado" : "veículos encontrados"}${matches.length > MAX_OPTIONS ? ` — mostrando ${MAX_OPTIONS}; refine a busca` : ""}.`}>
                  <SearchField size="sm" value={search} onValueChange={setSearch} placeholder="Placa ou frota" data-testid="tires-links-vehicle-search" />
                </FormField>
                <FormField label="Veículo" required error={submitted ? errors.vehicle : undefined}>
                  <NativeSelect value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} data-testid="tires-links-vehicle-select">
                    <option value="">{shownOptions.length ? "Escolha…" : "Nenhum veículo com essa busca"}</option>
                    {selectedVehicle && !shownOptions.includes(selectedVehicle) ? (
                      <option value={selectedVehicle.id}>{vehicleName(selectedVehicle.fleet, selectedVehicle.plate)}</option>
                    ) : null}
                    {shownOptions.map((v) => (
                      <option key={v.id} value={v.id}>{vehicleName(v.fleet, v.plate)}</option>
                    ))}
                  </NativeSelect>
                </FormField>
                {existing ? (
                  <Alert variant="info" className="py-2">
                    <AlertDescription>Este veículo já tem exceção ({existingLayout?.name ?? "layout não encontrado"}); salvar substitui.</AlertDescription>
                  </Alert>
                ) : null}
              </>
            )}
            <FormField label="Layout" required error={submitted || layoutId ? errors.layout : undefined}>
              <NativeSelect value={layoutId} onChange={(e) => setLayoutId(e.target.value)} data-testid="tires-links-layout-select">
                <option value="">Escolha…</option>
                {layouts.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({fmtInt(l.positionCodes.length)} posições)
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField
              label="Motivo"
              required
              error={submitted ? errors.reason : undefined}
              helperText={`Por que este veículo foge do padrão do tipo (ex.: 3º eixo instalado). Mínimo de ${REASON_MIN} caracteres.`}
            >
              <Textarea rows={3} value={reason} maxLength={REASON_MAX} onChange={(e) => setReason(e.target.value)} data-testid="tires-links-reason" />
            </FormField>
          </fieldset>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} data-testid="tires-links-exception-save">
            {row ? "Trocar layout" : "Adicionar exceção"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
