"use client";

import * as React from "react";
import { MapPin, Pencil, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { NativeSelect } from "@/components/governance/selects";
import { AxleDiagram } from "@/components/tires/axle-diagram";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { SwitchField } from "@/components/ui/switch";
import {
  Table, TableActionCell, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { saveTirePosition, type PositionInput } from "@/lib/tires/actions";
import { AXLE_LABEL, fmtInt, formatDate, SIDE_LABEL, SLOT_LABEL, type AxleGroup, type TirePosition, type TiresCatalog } from "@/lib/tires/types";
import { PanelEmpty } from "../tires-ui";
import { axleTitle, numberError, positionKey, toAxle, useParamAction } from "./param-ui";

/**
 * Parâmetros → Posições. Dicionário dos códigos de posição do Rodopar
 * (EDE, ETDI4, ESTEP1…): rótulo, eixo, lado e rodado. O diagrama de eixos é
 * montado só com estes atributos — um código novo aparece no desenho sem
 * mudança de código.
 */
const SIDES = ["left", "right", "center"] as const;
const SLOTS = ["single", "outer", "inner"] as const;
const GROUPS: AxleGroup[] = ["front", "rear", "spare", "other"];

export function PositionsSection({ catalog, canManage, onDone }: { catalog: TiresCatalog; canManage: boolean; onDone: () => void }) {
  const [editing, setEditing] = React.useState<{ position: TirePosition | null; presetCode?: string } | null>(null);
  const positions = React.useMemo(
    () => [...catalog.positions].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code)),
    [catalog.positions],
  );
  const active = positions.filter((p) => p.isActive);
  const observed = React.useMemo(() => new Map(catalog.observedPositions.map((o) => [o.code, o.tires])), [catalog.observedPositions]);
  const layoutsByCode = React.useMemo(() => {
    const m = new Map<string, string[]>();
    for (const l of catalog.layouts) for (const c of l.positionCodes) m.set(c, [...(m.get(c) ?? []), l.name]);
    return m;
  }, [catalog.layouts]);
  const unknown = catalog.observedPositions.filter((o) => !positions.some((p) => p.code === o.code));
  const inactiveInUse = positions.filter((p) => !p.isActive && (observed.get(p.code) ?? 0) > 0);
  const byCode = new Map(positions.map((p) => [p.code, p]));

  return (
    <div className="flex flex-col gap-4" data-testid="tires-param-positions">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[100ch] text-body-sm text-fg-muted">
          {fmtInt(positions.length)} {positions.length === 1 ? "posição" : "posições"} · {fmtInt(active.length)} ativas. Grupo e índice do eixo, lado e rodado
          (simples, externo ou interno) desenham o esquema do veículo na base, na vistoria e nos layouts.
        </p>
        {canManage ? (
          <Button size="sm" variant="primary" leadingIcon={<Plus />} onClick={() => setEditing({ position: null })} data-testid="tires-position-new">
            Nova posição
          </Button>
        ) : null}
      </div>

      {unknown.length > 0 ? (
        <Alert variant="warning" data-testid="tires-position-unknown">
          <AlertTitle>
            {fmtInt(unknown.length)} {unknown.length === 1 ? "código de posição da fotografia sem cadastro" : "códigos de posição da fotografia sem cadastro"}
          </AlertTitle>
          <AlertDescription>
            <span className="block">Sem cadastro, a posição não entra no diagrama nem nas regras por eixo.</span>
            <span className="mt-1 flex flex-wrap gap-2">
              {unknown.map((u) =>
                canManage ? (
                  <Button key={u.code} size="sm" variant="secondary" onClick={() => setEditing({ position: null, presetCode: u.code })} data-testid="tires-position-unknown-add">
                    Cadastrar {u.code} ({fmtInt(u.tires)} {u.tires === 1 ? "pneu" : "pneus"})
                  </Button>
                ) : (
                  <span key={u.code} className="font-mono">
                    {u.code} ({fmtInt(u.tires)})
                  </span>
                ),
              )}
            </span>
          </AlertDescription>
        </Alert>
      ) : null}
      {inactiveInUse.length > 0 ? (
        <Alert variant="warning" data-testid="tires-position-inactive-in-use">
          <AlertDescription>
            Posições inativas com pneus na fotografia: {inactiveInUse.map((p) => `${p.code} (${fmtInt(observed.get(p.code))})`).join(", ")}.
          </AlertDescription>
        </Alert>
      ) : null}

      {positions.length === 0 ? (
        <PanelEmpty icon={<MapPin />} title="Nenhuma posição cadastrada" description="Cadastre os códigos de posição usados no Rodopar para desenhar os eixos." testId="tires-position-empty" />
      ) : (
        <>
          <Card data-testid="tires-position-diagram">
            <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex min-w-0 max-w-[48ch] flex-col gap-2">
                <h3 className="text-card-title font-semibold text-fg">Esquema com todas as posições ativas</h3>
                <p className="text-body-sm text-fg-muted">
                  Desenhado só com o dicionário: eixos da frente para trás, rodado duplo com externo por fora, estepe e posições de centro à parte. O número em
                  cada pneu é a quantidade de pneus nessa posição na fotografia{catalog.latestReferenceDate ? ` de ${formatDate(catalog.latestReferenceDate)}` : ""}.
                </p>
                {canManage ? <p className="text-body-sm text-fg-muted">Toque num pneu para editar a posição.</p> : null}
                <dl className="mt-1 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4 lg:grid-cols-2">
                  {[
                    { label: "Posições ativas", value: active.length },
                    { label: "Inativas", value: positions.length - active.length },
                    { label: "Eixos", value: new Set(active.filter((x) => x.axleGroup === "front" || x.axleGroup === "rear").map((x) => `${x.axleGroup}:${x.axleIndex}`)).size },
                    { label: "Códigos sem cadastro", value: unknown.length },
                  ].map((f) => (
                    <div key={f.label} className="flex flex-col">
                      <dt className="text-caption text-fg-muted">{f.label}</dt>
                      <dd className="text-h4 font-semibold text-fg tabular-nums">{fmtInt(f.value)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className="flex min-w-0 justify-center overflow-x-auto lg:flex-1">
                {active.length ? (
                  <AxleDiagram
                    positions={active.map(toAxle)}
                    label="Todas as posições ativas"
                    state={(a) => {
                      const n = observed.get(a.code);
                      return { caption: n == null ? "—" : fmtInt(n), srText: n == null ? "sem pneus na fotografia" : `${fmtInt(n)} pneus na fotografia` };
                    }}
                    onSelect={canManage ? (code) => setEditing({ position: byCode.get(code) ?? null }) : undefined}
                    testIdPrefix="tires-position-tire"
                  />
                ) : (
                  <p className="text-body-sm text-fg-muted">Nenhuma posição ativa.</p>
                )}
              </div>
            </div>
          </Card>
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead numeric>Ordem</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>Rótulo</TableHead>
                  <TableHead>Eixo</TableHead>
                  <TableHead>Lado · rodado</TableHead>
                  <TableHead numeric>Pneus na fotografia</TableHead>
                  <TableHead numeric>Layouts</TableHead>
                  <TableHead>Situação</TableHead>
                  {canManage ? <TableHead><span className="sr-only">Ações</span></TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {positions.map((p) => {
                  const inLayouts = layoutsByCode.get(p.code) ?? [];
                  return (
                    <TableRow key={p.id} className={cn(!p.isActive && "text-fg-secondary")} data-testid="tires-position-row" data-code={p.code}>
                      <TableCell numeric>{fmtInt(p.sortOrder)}</TableCell>
                      <TableCell className="font-mono font-semibold text-fg">
                        {p.code}
                        {p.aliases.length ? <span className="block font-sans text-caption font-normal text-fg-muted">também: {p.aliases.join(", ")}</span> : null}
                      </TableCell>
                      <TableCell className="min-w-[13rem]">{p.label}</TableCell>
                      <TableCell className="whitespace-nowrap">{axleTitle(p.axleGroup, p.axleIndex)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {SIDE_LABEL[p.side] ?? p.side} · {SLOT_LABEL[p.slot] ?? p.slot}
                      </TableCell>
                      <TableCell numeric>{observed.has(p.code) ? fmtInt(observed.get(p.code)) : "—"}</TableCell>
                      <TableCell numeric title={inLayouts.join(", ") || undefined}>{fmtInt(inLayouts.length)}</TableCell>
                      <TableCell>
                        <StatusBadge status={p.isActive ? "success" : "neutral"} size="sm">{p.isActive ? "Ativa" : "Inativa"}</StatusBadge>
                      </TableCell>
                      {canManage ? (
                        <TableActionCell>
                          <Button size="sm" variant="ghost" leadingIcon={<Pencil />} onClick={() => setEditing({ position: p })} data-testid="tires-position-edit">
                            Editar
                          </Button>
                        </TableActionCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}

      {editing ? (
        <PositionDialog
          key={editing.position?.id ?? `new:${editing.presetCode ?? ""}`}
          position={editing.position}
          presetCode={editing.presetCode}
          catalog={catalog}
          layoutsByCode={layoutsByCode}
          observed={observed}
          onClose={() => setEditing(null)}
          onDone={onDone}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diálogo da posição
// ---------------------------------------------------------------------------
interface PositionForm {
  code: string;
  label: string;
  axleGroup: AxleGroup;
  axleIndex: string;
  side: PositionInput["side"];
  slot: PositionInput["slot"];
  sortOrder: string;
  isActive: boolean;
}

function PositionDialog({
  position, presetCode, catalog, layoutsByCode, observed, onClose, onDone,
}: {
  position: TirePosition | null;
  presetCode?: string;
  catalog: TiresCatalog;
  layoutsByCode: Map<string, string[]>;
  observed: Map<string, number>;
  onClose: () => void;
  onDone: () => void;
}) {
  const nextOrder = catalog.positions.reduce((m, p) => Math.max(m, p.sortOrder), 0) + 1;
  const [form, setForm] = React.useState<PositionForm>(() => ({
    code: position?.code ?? presetCode ?? "",
    label: position?.label ?? "",
    axleGroup: position?.axleGroup ?? "rear",
    axleIndex: String(position?.axleIndex ?? 1),
    side: position?.side ?? "left",
    slot: position?.slot ?? "single",
    sortOrder: String(position?.sortOrder ?? nextOrder),
    isActive: position?.isActive ?? true,
  }));
  const [submitted, setSubmitted] = React.useState(false);
  const { busy, run } = useParamAction(onDone);
  const saving = busy === "position";
  const set = <K extends keyof PositionForm>(key: K, value: PositionForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const code = positionKey(form.code) ?? "";
  const errors: Partial<Record<keyof PositionForm, string>> = {};
  if (!position) {
    if (!code) errors.code = "Informe o código.";
    else if (code.length > 12) errors.code = "Até 12 letras e números.";
    else if (catalog.positions.some((p) => p.code === code)) errors.code = `A posição ${code} já existe — edite-a na lista.`;
  }
  const label = form.label.trim();
  if (!label) errors.label = "Informe o rótulo.";
  else if (label.length > 60) errors.label = "Até 60 caracteres.";
  const idxErr = numberError(form.axleIndex, { integer: true, min: 1, max: 9 });
  if (idxErr) errors.axleIndex = idxErr;
  const orderErr = numberError(form.sortOrder, { integer: true, min: 0, max: 9999 });
  if (orderErr) errors.sortOrder = orderErr;
  const hasErrors = Object.keys(errors).length > 0;
  const show = (k: keyof PositionForm) => (submitted || (k !== "code" && k !== "label") || form[k] !== "" ? errors[k] : undefined);

  const inLayouts = position ? layoutsByCode.get(position.code) ?? [] : [];
  const tiresHere = position ? observed.get(position.code) ?? 0 : 0;
  const deactivating = position?.isActive && !form.isActive;

  // Pré-visualização: as posições ativas com esta já alterada (ou incluída).
  const preview = React.useMemo(() => {
    const draft: TirePosition = {
      id: position?.id ?? "draft",
      code: code || "NOVA",
      label: label || "Nova posição",
      axleGroup: form.axleGroup,
      axleIndex: Number(form.axleIndex) || 1,
      side: form.side,
      slot: form.slot,
      sortOrder: Number(form.sortOrder) || 0,
      aliases: [],
      isActive: form.isActive,
    };
    const others = catalog.positions.filter((p) => p.isActive && p.code !== position?.code && p.code !== draft.code);
    return [...others, ...(form.isActive ? [draft] : [])].map(toAxle);
  }, [catalog.positions, position, code, label, form.axleGroup, form.axleIndex, form.side, form.slot, form.sortOrder, form.isActive]);

  const submit = async () => {
    setSubmitted(true);
    if (hasErrors) return;
    const ok = await run(
      "position",
      () =>
        saveTirePosition({
          code: position?.code ?? code,
          label,
          axleGroup: form.axleGroup,
          axleIndex: Number(form.axleIndex),
          side: form.side,
          slot: form.slot,
          sortOrder: Number(form.sortOrder),
          isActive: form.isActive,
        }),
      { success: position ? `Posição ${position.code} atualizada` : `Posição ${code} criada`, failure: "Não foi possível salvar a posição" },
    );
    if (ok) onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => (!o && !saving ? onClose() : undefined)}>
      <DialogContent size="xl" data-testid="tires-position-dialog">
        <DialogHeader>
          <DialogTitle>{position ? `Editar posição ${position.code}` : "Nova posição"}</DialogTitle>
          <DialogDescription>
            O código é o mesmo da coluna Posição do Rodopar e não muda depois de criado. Eixo, lado e rodado definem onde o pneu aparece no esquema.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_auto]">
            <fieldset className="flex min-w-0 flex-col gap-4" disabled={saving}>
              <legend className="sr-only">Dados da posição</legend>
              <FormGrid columns={2}>
                <FormField label="Código" required error={show("code")} helperText={position ? "Não editável." : "Letras e números, até 12 (ex.: ETDI4)."}>
                  <Input
                    value={position ? position.code : form.code}
                    onChange={(e) => set("code", e.target.value.toUpperCase())}
                    readOnly={Boolean(position)}
                    autoComplete="off"
                    className="font-mono uppercase"
                    autoFocus={!position}
                    data-testid="tires-position-code"
                  />
                </FormField>
                <FormField label="Rótulo" required error={show("label")}>
                  <Input value={form.label} onChange={(e) => set("label", e.target.value)} placeholder="Ex.: Traseiro direito interno (eixo 4)" data-testid="tires-position-label" />
                </FormField>
                <FormField label="Grupo do eixo" required>
                  <NativeSelect value={form.axleGroup} onChange={(e) => set("axleGroup", e.target.value as AxleGroup)} data-testid="tires-position-group">
                    {GROUPS.map((g) => (
                      <option key={g} value={g}>{AXLE_LABEL[g]}</option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField label="Índice do eixo" required error={show("axleIndex")} helperText="1 a 9, da frente para trás.">
                  <Input value={form.axleIndex} onChange={(e) => set("axleIndex", e.target.value)} inputMode="numeric" autoComplete="off" data-testid="tires-position-index" />
                </FormField>
                <FormField label="Lado" required helperText="Centro (ou grupo Estepe/Outro) fica fora dos eixos no esquema.">
                  <NativeSelect value={form.side} onChange={(e) => set("side", e.target.value as PositionForm["side"])} data-testid="tires-position-side">
                    {SIDES.map((s) => (
                      <option key={s} value={s}>{SIDE_LABEL[s]}</option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField label="Rodado" required helperText="Externo/interno = rodado duplo.">
                  <NativeSelect value={form.slot} onChange={(e) => set("slot", e.target.value as PositionForm["slot"])} data-testid="tires-position-slot">
                    {SLOTS.map((s) => (
                      <option key={s} value={s}>{SLOT_LABEL[s]}</option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField label="Ordem" required error={show("sortOrder")} helperText="Ordem nas listas e na vistoria.">
                  <Input value={form.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} inputMode="numeric" autoComplete="off" data-testid="tires-position-order" />
                </FormField>
              </FormGrid>
              <SwitchField
                label="Ativa"
                description="Inativa sai do esquema, dos layouts novos e das regras por posição (o histórico fica)."
                checked={form.isActive}
                onCheckedChange={(v) => set("isActive", v)}
                className="rounded-md border border-border"
                data-testid="tires-position-active"
              />
              {deactivating && (inLayouts.length > 0 || tiresHere > 0) ? (
                <Alert variant="warning" data-testid="tires-position-deactivate-warning">
                  <AlertDescription>
                    {inLayouts.length > 0
                      ? `Está em ${fmtInt(inLayouts.length)} ${inLayouts.length === 1 ? "layout" : "layouts"} (${inLayouts.join(", ")}): esses layouts só poderão ser salvos de novo sem ela. `
                      : ""}
                    {tiresHere > 0 ? `${fmtInt(tiresHere)} ${tiresHere === 1 ? "pneu está" : "pneus estão"} nesta posição na fotografia.` : ""}
                  </AlertDescription>
                </Alert>
              ) : null}
            </fieldset>
            <div className="flex flex-col items-center gap-2 md:border-l md:border-border md:pl-5" data-testid="tires-position-preview">
              <span className="text-caption font-semibold text-fg-muted">Pré-visualização</span>
              {preview.length ? (
                <AxleDiagram positions={preview} selected={form.isActive ? code || "NOVA" : null} label="Pré-visualização das posições ativas" testIdPrefix="tires-position-preview-tire" />
              ) : (
                <p className="text-caption text-fg-muted">Nenhuma posição ativa.</p>
              )}
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" onClick={() => void submit()} loading={saving} data-testid="tires-position-save">
            {position ? "Salvar posição" : "Criar posição"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
