"use client";

import * as React from "react";
import { AlertCircle, LayoutGrid, Pencil, Plus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { AxleDiagram } from "@/components/tires/axle-diagram";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CheckboxField } from "@/components/ui/checkbox";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { SwitchField } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { saveTireLayout } from "@/lib/tires/actions";
import { fmtInt, type TireLayout, type TirePosition, type TiresCatalog } from "@/lib/tires/types";
import { PanelEmpty } from "../tires-ui";
import { groupByAxle, toAxle, useParamAction } from "./param-ui";

/**
 * Parâmetros → Layouts. Conjunto de posições esperadas de uma configuração de
 * eixos. O desenho vem do dicionário de posições; o layout só diz quais
 * posições existem. Tipo de equipamento e veículo apontam para um layout em
 * “Vínculos”.
 */
export function LayoutsSection({ catalog, canManage, onDone }: { catalog: TiresCatalog; canManage: boolean; onDone: () => void }) {
  const [editing, setEditing] = React.useState<{ layout: TireLayout | null } | null>(null);
  const byCode = React.useMemo(() => new Map(catalog.positions.map((p) => [p.code, p])), [catalog.positions]);
  const layouts = [...catalog.layouts].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name, "pt-BR"));

  return (
    <div className="flex flex-col gap-4" data-testid="tires-param-layouts">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[100ch] text-body-sm text-fg-muted">
          {fmtInt(layouts.length)} {layouts.length === 1 ? "layout" : "layouts"}. O layout define quais posições o veículo tem: a vistoria pede exatamente essas
          posições e a Auditoria dos dados aponta posição sem pneu ou pneu fora do layout.
        </p>
        {canManage ? (
          <Button size="sm" variant="primary" leadingIcon={<Plus />} onClick={() => setEditing({ layout: null })} data-testid="tires-layout-new">
            Novo layout
          </Button>
        ) : null}
      </div>

      {layouts.length === 0 ? (
        <PanelEmpty
          icon={<LayoutGrid />}
          title="Nenhum layout cadastrado"
          description="Sem layout, o veículo usa as posições em que há pneus nos dados atuais."
          testId="tires-layout-empty"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {layouts.map((l) => {
            const known = l.positionCodes.map((c) => byCode.get(c)).filter((p): p is TirePosition => Boolean(p));
            const missing = l.positionCodes.filter((c) => !byCode.has(c));
            const inactive = known.filter((p) => !p.isActive);
            return (
              <Card key={l.id} data-testid="tires-layout-card" data-code={l.code} className={l.isActive ? undefined : "opacity-80"}>
                <CardHeader
                  title={l.name}
                  description={<span className="font-mono text-caption">{l.code}</span>}
                  actions={
                    canManage ? (
                      <Button size="sm" variant="ghost" leadingIcon={<Pencil />} onClick={() => setEditing({ layout: l })} data-testid="tires-layout-edit">
                        Editar
                      </Button>
                    ) : null
                  }
                />
                <CardContent className="flex flex-1 flex-col gap-3">
                  {l.description ? <p className="text-body-sm text-fg-secondary">{l.description}</p> : null}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={l.isActive ? "success" : "neutral"} size="sm">{l.isActive ? "Ativo" : "Inativo"}</StatusBadge>
                    <Badge variant="neutral" size="sm">
                      {fmtInt(l.positionCodes.length)} {l.positionCodes.length === 1 ? "posição" : "posições"}
                    </Badge>
                    <Badge variant="neutral" size="sm" title="Veículos com este layout definido como exceção">
                      {fmtInt(l.vehicles)} {l.vehicles === 1 ? "veículo com layout próprio" : "veículos com layout próprio"}
                    </Badge>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-caption text-fg-muted">Padrão dos tipos de equipamento</span>
                    {l.vehicleTypes.length ? (
                      <span className="flex flex-wrap gap-1">
                        {l.vehicleTypes.map((t) => (
                          <Badge key={t.id} variant="info" size="sm">{t.name}</Badge>
                        ))}
                      </span>
                    ) : (
                      <span className="text-body-sm text-fg-muted">Nenhum tipo usa este layout como padrão.</span>
                    )}
                  </div>
                  {missing.length || inactive.length ? (
                    <Alert variant="warning" className="py-2">
                      <AlertDescription>
                        {missing.length ? `Fora do dicionário: ${missing.join(", ")}. ` : ""}
                        {inactive.length ? `Posições inativas: ${inactive.map((p) => p.code).join(", ")} — retire-as para salvar o layout de novo.` : ""}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  <div className="flex justify-center overflow-x-auto pt-1">
                    <AxleDiagram positions={known.map(toAxle)} label={`Esquema do layout ${l.name}`} testIdPrefix={`tires-layout-${l.code}-tire`} />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {editing ? (
        <LayoutDialog key={editing.layout?.id ?? "new"} layout={editing.layout} catalog={catalog} onClose={() => setEditing(null)} onDone={onDone} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diálogo do layout
// ---------------------------------------------------------------------------
const CODE_RE = /^[a-z][a-z0-9_]{1,39}$/;
const MAX_POSITIONS = 40;

const slugify = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+$/, "")
    .slice(0, 40);

function LayoutDialog({ layout, catalog, onClose, onDone }: { layout: TireLayout | null; catalog: TiresCatalog; onClose: () => void; onDone: () => void }) {
  const [name, setName] = React.useState(layout?.name ?? "");
  const [code, setCode] = React.useState(layout?.code ?? "");
  const [codeEdited, setCodeEdited] = React.useState(Boolean(layout));
  const [description, setDescription] = React.useState(layout?.description ?? "");
  const [isActive, setIsActive] = React.useState(layout?.isActive ?? true);
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(layout?.positionCodes ?? []));
  const [submitted, setSubmitted] = React.useState(false);
  const { busy, run } = useParamAction(onDone);
  const saving = busy === "layout";

  const byCode = React.useMemo(() => new Map(catalog.positions.map((p) => [p.code, p])), [catalog.positions]);
  // Posições oferecidas: as ativas e as que o layout já tem (mesmo inativas, para poder tirá-las).
  const offered = catalog.positions.filter((p) => p.isActive || selected.has(p.code));
  const groups = groupByAxle(offered);
  const effectiveCode = layout ? layout.code : codeEdited ? code.trim() : slugify(name);

  const errors: { name?: string; code?: string; positions?: string; description?: string } = {};
  if (!name.trim()) errors.name = "Informe o nome.";
  else if (name.trim().length > 80) errors.name = "Até 80 caracteres.";
  if (!layout) {
    if (!effectiveCode) errors.code = "Informe o código.";
    else if (!CODE_RE.test(effectiveCode)) errors.code = "Comece com letra; só letras minúsculas, números e _ (2 a 40).";
    else if (catalog.layouts.some((l) => l.code === effectiveCode)) errors.code = "Já existe um layout com este código.";
  }
  const selectedCodes = [...selected];
  const missing = selectedCodes.filter((c) => !byCode.has(c));
  const inactive = selectedCodes.filter((c) => byCode.get(c) && !byCode.get(c)!.isActive);
  if (selected.size === 0) errors.positions = "Selecione ao menos uma posição.";
  else if (selected.size > MAX_POSITIONS) errors.positions = `No máximo ${MAX_POSITIONS} posições.`;
  else if (missing.length || inactive.length) errors.positions = `Retire as posições ${[...missing, ...inactive].join(", ")}: só posições ativas do dicionário entram num layout.`;
  const hasErrors = Object.keys(errors).length > 0;

  const toggle = (c: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(c);
      else next.delete(c);
      return next;
    });
  const setGroup = (codes: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of codes) {
        if (on) next.add(c);
        else next.delete(c);
      }
      return next;
    });

  const preview = selectedCodes
    .map((c) => byCode.get(c))
    .filter((p): p is TirePosition => Boolean(p))
    .map(toAxle);

  const submit = async () => {
    setSubmitted(true);
    if (hasErrors) return;
    // Mantém a ordem do dicionário (eixo a eixo) no cadastro.
    const ordered = catalog.positions.filter((p) => selected.has(p.code)).sort((a, b) => a.sortOrder - b.sortOrder).map((p) => p.code);
    const ok = await run(
      "layout",
      () =>
        saveTireLayout({
          id: layout?.id ?? null,
          code: effectiveCode,
          name: name.trim(),
          description: description.trim() || null,
          positionCodes: ordered,
          isActive,
        }),
      { success: layout ? `Layout ${name.trim()} atualizado` : `Layout ${name.trim()} criado`, failure: "Não foi possível salvar o layout" },
    );
    if (ok) onClose();
  };

  const vehiclesWithIt = layout ? layout.vehicles + layout.vehicleTypes.length : 0;

  return (
    <Dialog open onOpenChange={(o) => (!o && !saving ? onClose() : undefined)}>
      <DialogContent size="xl" data-testid="tires-layout-dialog">
        <DialogHeader>
          <DialogTitle>{layout ? `Editar layout ${layout.name}` : "Novo layout de eixos"}</DialogTitle>
          <DialogDescription>
            Marque as posições que o veículo tem. O esquema ao vivo é desenhado a partir do dicionário de posições.
            {layout && vehiclesWithIt > 0
              ? ` Em uso por ${fmtInt(layout.vehicleTypes.length)} ${layout.vehicleTypes.length === 1 ? "tipo" : "tipos"} e ${fmtInt(layout.vehicles)} ${layout.vehicles === 1 ? "veículo" : "veículos"} com layout próprio: a mudança vale para eles.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_auto]">
            <fieldset className="flex min-w-0 flex-col gap-4" disabled={saving}>
              <legend className="sr-only">Dados do layout</legend>
              <FormGrid columns={2}>
                <FormField label="Nome" required error={submitted || name ? errors.name : undefined}>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Caminhão · 2 eixos traseiros duplos + estepe" autoFocus={!layout} data-testid="tires-layout-name" />
                </FormField>
                <FormField
                  label="Código"
                  required
                  error={layout ? undefined : submitted || codeEdited || name ? errors.code : undefined}
                  helperText={layout ? "Não editável." : "Gerado a partir do nome; pode ajustar."}
                >
                  <Input
                    value={layout ? layout.code : effectiveCode}
                    onChange={(e) => {
                      setCodeEdited(true);
                      setCode(e.target.value.toLowerCase());
                    }}
                    readOnly={Boolean(layout)}
                    autoComplete="off"
                    className="font-mono"
                    data-testid="tires-layout-code"
                  />
                </FormField>
              </FormGrid>
              <FormField label="Descrição" labelHint="Opcional">
                <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} data-testid="tires-layout-description" />
              </FormField>
              <SwitchField
                label="Ativo"
                description="Layout inativo deixa de ser oferecido nos vínculos (o que já usa continua até ser trocado)."
                checked={isActive}
                onCheckedChange={setIsActive}
                className="rounded-md border border-border"
                data-testid="tires-layout-active"
              />
              <div className="flex flex-col gap-2" role="group" aria-labelledby="tires-layout-positions-label">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span id="tires-layout-positions-label" className="text-body-sm font-semibold text-fg">
                    Posições <span className="text-danger" aria-hidden>*</span>
                  </span>
                  <span className="text-caption text-fg-muted" aria-live="polite">
                    {fmtInt(selected.size)} {selected.size === 1 ? "selecionada" : "selecionadas"}
                  </span>
                </div>
                {(submitted || selected.size > 0) && errors.positions ? (
                  <p role="alert" className="flex items-start gap-1.5 text-helper text-danger" data-testid="tires-layout-positions-error">
                    <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
                    {errors.positions}
                  </p>
                ) : null}
                {groups.length === 0 ? (
                  <p className="text-body-sm text-fg-muted">Nenhuma posição ativa no dicionário. Cadastre posições primeiro.</p>
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {groups.map((g) => {
                      const codes = g.positions.map((p) => p.code);
                      const all = codes.every((c) => selected.has(c));
                      return (
                        <div key={g.key} className="rounded-md border border-border" data-testid="tires-layout-group">
                          <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-2.5 py-1.5">
                            <span className="whitespace-nowrap text-caption font-semibold text-fg-secondary">{g.title}</span>
                            <Button
                              size="sm"
                              variant="link"
                              className="h-auto text-caption"
                              onClick={() => setGroup(codes, !all)}
                              disabled={saving}
                              aria-label={`${all ? "Desmarcar" : "Marcar"} todas as posições de ${g.title}`}
                            >
                              {all ? "Limpar" : "Marcar todas"}
                            </Button>
                          </div>
                          <div className="flex flex-col px-1 py-1">
                            {g.positions.map((p) => (
                              <CheckboxField
                                key={p.code}
                                label={
                                  <span>
                                    <span className="font-mono">{p.code}</span>
                                    {p.isActive ? null : <span className="ml-1 text-caption text-danger">(inativa)</span>}
                                  </span>
                                }
                                description={p.label}
                                checked={selected.has(p.code)}
                                onCheckedChange={(v) => toggle(p.code, v === true)}
                                disabled={saving}
                                className="py-1.5"
                                data-testid={`tires-layout-pos-${p.code}`}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {missing.length ? (
                  <Alert
                    variant="warning"
                    className="py-2"
                    action={
                      <Button size="sm" variant="secondary" onClick={() => setGroup(missing, false)} disabled={saving}>
                        Retirar do layout
                      </Button>
                    }
                  >
                    <AlertDescription>Códigos fora do dicionário de posições: {missing.join(", ")}.</AlertDescription>
                  </Alert>
                ) : null}
              </div>
            </fieldset>
            <div className="flex flex-col items-center gap-2 md:sticky md:top-0 md:self-start md:border-l md:border-border md:pl-5" data-testid="tires-layout-preview">
              <span className="text-caption font-semibold text-fg-muted">Esquema ao vivo</span>
              {preview.length ? (
                <AxleDiagram positions={preview} label="Esquema do layout em edição" testIdPrefix="tires-layout-preview-tire" />
              ) : (
                <p className="max-w-[12rem] text-center text-caption text-fg-muted">Marque posições para ver o esquema.</p>
              )}
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" onClick={() => void submit()} loading={saving} data-testid="tires-layout-save">
            {layout ? "Salvar layout" : "Criar layout"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
