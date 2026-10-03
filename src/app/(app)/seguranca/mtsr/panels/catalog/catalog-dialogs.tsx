"use client";

import * as React from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/cn";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { RadioField, RadioGroup } from "@/components/ui/radio-group";
import { SearchField } from "@/components/ui/search-field";
import { SwitchField } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/governance/selects";
import { saveComponent, saveComponentServices, saveComponentSources } from "@/lib/mtsr/actions";
import {
  CRITICALITY_LABEL, fmtInt, sourceTypeLabel, VERIFICATION_MODE_LABEL, type MtsrComponent, type MtsrComponentService,
  type MtsrComponentSource, type MtsrServiceOption, type MtsrSource, type VerificationMode,
} from "@/lib/mtsr/types";

/**
 * Diálogos dos Cadastros do MTSR: componente, serviços do componente e fontes
 * do componente. Cada um pede só o que a rotina do banco precisa; a validação
 * de verdade (código único, regras de prioridade) é dela.
 */

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------
type BaseCriticality = MtsrComponent["baseCriticality"];
const BASE_CRITICALITIES: BaseCriticality[] = ["critica", "alta", "media"];

interface ComponentForm {
  name: string;
  description: string;
  verificationMode: VerificationMode;
  baseCriticality: BaseCriticality;
  priority: string;
  sortOrder: string;
  isActive: boolean;
  contextLabel: string;
  evidenceRequiredWhenOk: boolean;
  evidenceRequiredWhenNok: boolean;
  observationRequiredWhenNok: boolean;
  aliases: string;
}

function initialComponent(c: MtsrComponent | null, nextOrder: number): ComponentForm {
  return {
    name: c?.name ?? "",
    description: c?.description ?? "",
    verificationMode: c?.verificationMode ?? "field",
    baseCriticality: c?.baseCriticality ?? "alta",
    priority: c ? String(c.priority) : String(nextOrder),
    sortOrder: c ? String(c.sortOrder) : String(nextOrder),
    isActive: c?.isActive ?? true,
    contextLabel: c?.contextLabel ?? "",
    evidenceRequiredWhenOk: c?.evidenceRequiredWhenOk ?? false,
    evidenceRequiredWhenNok: c?.evidenceRequiredWhenNok ?? true,
    observationRequiredWhenNok: c?.observationRequiredWhenNok ?? true,
    aliases: c?.aliases.join(", ") ?? "",
  };
}

const parseAliases = (raw: string) => [...new Set(raw.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean))];

export function ComponentDialog({
  open, onOpenChange, component, nextOrder, onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Nulo = novo componente. */
  component: MtsrComponent | null;
  /** Ordem/prioridade sugerida para um componente novo (último + 1). */
  nextOrder: number;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = React.useState<ComponentForm>(() => initialComponent(component, nextOrder));
  const [touched, setTouched] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const set = <K extends keyof ComponentForm>(key: K, value: ComponentForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const nameError = touched && form.name.trim().length < 2 ? "Informe o nome do componente." : undefined;
  const priorityError = touched && !(Number.isInteger(Number(form.priority)) && Number(form.priority) >= 1) ? "Inteiro a partir de 1." : undefined;
  const orderError = touched && !(Number.isInteger(Number(form.sortOrder)) && Number(form.sortOrder) >= 0) ? "Inteiro a partir de 0." : undefined;

  const submit = async () => {
    setTouched(true);
    if (nameError || priorityError || orderError || form.name.trim().length < 2) return;
    setBusy(true);
    const r = await saveComponent({
      id: component?.id ?? null,
      name: form.name.trim(),
      description: form.description.trim() || null,
      verificationMode: form.verificationMode,
      baseCriticality: form.baseCriticality,
      priority: Number(form.priority),
      sortOrder: Number(form.sortOrder),
      isActive: form.isActive,
      contextLabel: form.contextLabel.trim() || null,
      evidenceRequiredWhenOk: form.evidenceRequiredWhenOk,
      evidenceRequiredWhenNok: form.evidenceRequiredWhenNok,
      observationRequiredWhenNok: form.observationRequiredWhenNok,
      aliases: parseAliases(form.aliases),
    });
    setBusy(false);
    if (!r.ok) {
      toast({ title: "Não foi possível salvar o componente", description: r.error, variant: "danger" });
      return;
    }
    toast({ title: component ? `Componente ${form.name.trim()} atualizado` : `Componente ${form.name.trim()} criado`, variant: "success" });
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (busy ? undefined : onOpenChange(o))}>
      <DialogContent size="lg" data-testid="mtsr-component-dialog">
        <DialogHeader>
          <DialogTitle>{component ? `Editar ${component.name}` : "Novo componente MTSR"}</DialogTitle>
          <DialogDescription>
            {component ? `Código ${component.code}. ` : ""}
            Componente de campo entra na vistoria do app; componente de backoffice tem estado vindo de fonte externa, importação ou atualização manual.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <FormGrid columns={2}>
            <FormField label="Nome" required error={nameError} className="sm:col-span-2">
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} disabled={busy} autoFocus data-testid="mtsr-component-name" />
            </FormField>
            <FormField label="Descrição" labelHint="Opcional" className="sm:col-span-2">
              <Textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} disabled={busy} />
            </FormField>
            <FormField label="Modo de verificação" required>
              <RadioGroup value={form.verificationMode} onValueChange={(v) => set("verificationMode", v as VerificationMode)} disabled={busy}>
                <RadioField value="field" label={VERIFICATION_MODE_LABEL.field} description="Inspetor marca OK/NOK no app; validar a vistoria aplica o estado." />
                <RadioField value="backoffice" label={VERIFICATION_MODE_LABEL.backoffice} description="Estado vem de fonte externa, importação ou atualização manual do backoffice." />
              </RadioGroup>
            </FormField>
            <div className="flex flex-col gap-4">
              <FormField label="Criticidade base" required helperText="Criticidade do veículo quando este componente está NOK.">
                <NativeSelect value={form.baseCriticality} onChange={(e) => set("baseCriticality", e.target.value as BaseCriticality)} disabled={busy}>
                  {BASE_CRITICALITIES.map((c) => (
                    <option key={c} value={c}>{CRITICALITY_LABEL[c]}</option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField label="Rótulo de contexto" labelHint="Opcional" helperText="Ex.: CFTV — aparece junto ao nome no app e nos relatórios.">
                <Input value={form.contextLabel} onChange={(e) => set("contextLabel", e.target.value)} disabled={busy} />
              </FormField>
            </div>
            <FormField label="Prioridade" required error={priorityError} helperText="Menor número = componente principal primeiro (desempate da criticidade).">
              <Input type="number" min={1} step={1} inputMode="numeric" value={form.priority} onChange={(e) => set("priority", e.target.value)} disabled={busy} />
            </FormField>
            <FormField label="Ordem de exibição" required error={orderError} helperText="Posição na matriz e no app.">
              <Input type="number" min={0} step={1} inputMode="numeric" value={form.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} disabled={busy} />
            </FormField>
            <FormField label="Apelidos" labelHint="Opcional" helperText="Separados por vírgula. Usados para reconhecer o componente em planilhas e leituras externas." className="sm:col-span-2">
              <Input value={form.aliases} onChange={(e) => set("aliases", e.target.value)} disabled={busy} placeholder="Ex.: camera, cftv, câmera" />
            </FormField>
          </FormGrid>
          <div className="flex flex-col divide-y divide-border-subtle rounded-md border border-border">
            <SwitchField label="Ativo" description="Inativo sai da vistoria, da matriz e dos indicadores (o histórico fica)." checked={form.isActive} onCheckedChange={(v) => set("isActive", v)} disabled={busy} data-testid="mtsr-component-active" />
            <SwitchField label="Evidência obrigatória em OK" description="Exige foto no app quando o item é marcado OK." checked={form.evidenceRequiredWhenOk} onCheckedChange={(v) => set("evidenceRequiredWhenOk", v)} disabled={busy} />
            <SwitchField label="Evidência obrigatória em NOK" description="Exige foto no app quando o item é marcado NOK." checked={form.evidenceRequiredWhenNok} onCheckedChange={(v) => set("evidenceRequiredWhenNok", v)} disabled={busy} />
            <SwitchField label="Observação obrigatória em NOK" description="Exige texto no app quando o item é marcado NOK." checked={form.observationRequiredWhenNok} onCheckedChange={(v) => set("observationRequiredWhenNok", v)} disabled={busy} />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button variant="primary" onClick={submit} loading={busy} data-testid="mtsr-component-save">{component ? "Salvar" : "Criar componente"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Serviços do componente
// ---------------------------------------------------------------------------
const normalize = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function ServicesDialog({
  open, onOpenChange, component, current, services, onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  component: MtsrComponent;
  current: MtsrComponentService[];
  services: MtsrServiceOption[];
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [search, setSearch] = React.useState("");
  const [selected, setSelected] = React.useState<Map<string, boolean>>(
    () => new Map(current.filter((s) => s.isActive).map((s) => [s.serviceId, s.isDefault])),
  );
  const [busy, setBusy] = React.useState(false);

  const q = normalize(search);
  const visible = React.useMemo(
    () =>
      services
        .filter((s) => !q || normalize(`${s.name} ${s.clusterName ?? ""}`).includes(q))
        .sort((a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id)) || (a.clusterName ?? "").localeCompare(b.clusterName ?? "", "pt-BR") || a.name.localeCompare(b.name, "pt-BR")),
    [services, q, selected],
  );

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (on) next.set(id, next.size === 0);
      else next.delete(id);
      return next;
    });
  const setDefault = (id: string) =>
    setSelected((prev) => {
      const next = new Map<string, boolean>();
      for (const [k] of prev) next.set(k, k === id);
      return next;
    });

  const submit = async () => {
    setBusy(true);
    const r = await saveComponentServices(component.id, [...selected.entries()].map(([serviceId, isDefault]) => ({ serviceId, isDefault })));
    setBusy(false);
    if (!r.ok) {
      toast({ title: "Não foi possível salvar os serviços", description: r.error, variant: "danger" });
      return;
    }
    toast({ title: `Serviços de ${component.name} salvos`, description: `${fmtInt(selected.size)} ${selected.size === 1 ? "serviço mapeado" : "serviços mapeados"}.`, variant: "success" });
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (busy ? undefined : onOpenChange(o))}>
      <DialogContent size="lg" data-testid="mtsr-services-dialog">
        <DialogHeader>
          <DialogTitle>Serviços de {component.name}</DialogTitle>
          <DialogDescription>
            Serviços do catálogo corporativo de Manutenção que tratam este componente. O serviço padrão é o proposto ao abrir manutenção a partir de um NOK.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <SearchField size="sm" value={search} onValueChange={setSearch} placeholder="Nome do serviço ou cluster" aria-label="Buscar serviço" />
          {selected.size === 0 ? (
            <Alert variant="warning" className="py-2">
              <AlertDescription>Sem serviço mapeado, abrir manutenção a partir deste componente exigirá escolher o serviço a cada vez.</AlertDescription>
            </Alert>
          ) : null}
          {visible.length === 0 ? (
            <p className="py-6 text-center text-body-sm text-fg-muted">{services.length === 0 ? "Nenhum serviço ativo no catálogo de Manutenção." : `Nenhum serviço com “${search.trim()}”.`}</p>
          ) : (
            <ul className="max-h-[50vh] divide-y divide-border-subtle overflow-auto rounded-md border border-border">
              {visible.map((s) => {
                const on = selected.has(s.id);
                const isDefault = selected.get(s.id) === true;
                return (
                  <li key={s.id} className="flex items-center gap-2 pr-2" data-testid="mtsr-service-option" data-selected={on || undefined}>
                    <CheckboxField
                      className="flex-1"
                      label={s.name}
                      description={[s.clusterName, s.criticality ? `criticidade ${s.criticality}` : null].filter(Boolean).join(" · ") || undefined}
                      checked={on}
                      onCheckedChange={(v) => toggle(s.id, v === true)}
                      disabled={busy}
                    />
                    {on ? (
                      <Button
                        size="sm"
                        variant={isDefault ? "secondary" : "ghost"}
                        onClick={() => setDefault(s.id)}
                        disabled={busy || isDefault}
                        aria-pressed={isDefault}
                        aria-label={isDefault ? `${s.name} é o serviço padrão` : `Tornar ${s.name} o serviço padrão`}
                        className={cn(isDefault && "text-highlight-soft-fg")}
                      >
                        <Star aria-hidden className={cn(isDefault && "fill-current")} />
                        {isDefault ? "Padrão" : "Tornar padrão"}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button variant="primary" onClick={submit} loading={busy} data-testid="mtsr-services-save">Salvar serviços</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Fontes do componente
// ---------------------------------------------------------------------------
type SourceLinkState = { linked: boolean; isEnabled: boolean; priority: string };

export function SourcesDialog({
  open, onOpenChange, component, sources, current, onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  component: MtsrComponent;
  sources: MtsrSource[];
  current: MtsrComponentSource[];
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [state, setState] = React.useState<Record<string, SourceLinkState>>(() => {
    const out: Record<string, SourceLinkState> = {};
    for (const s of sources) {
      const cur = current.find((c) => c.sourceId === s.id);
      out[s.id] = cur ? { linked: true, isEnabled: cur.isEnabled, priority: String(cur.priority) } : { linked: false, isEnabled: true, priority: String(s.priority) };
    }
    return out;
  });
  const [busy, setBusy] = React.useState(false);
  const [touched, setTouched] = React.useState(false);
  const patch = (id: string, p: Partial<SourceLinkState>) => setState((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }));
  const invalid = sources.some((s) => state[s.id].linked && !(Number.isInteger(Number(state[s.id].priority)) && Number(state[s.id].priority) >= 1));

  const submit = async () => {
    setTouched(true);
    if (invalid) return;
    setBusy(true);
    const links = sources.filter((s) => state[s.id].linked).map((s) => ({ sourceId: s.id, priority: Number(state[s.id].priority), isEnabled: state[s.id].isEnabled }));
    const r = await saveComponentSources(component.id, links);
    setBusy(false);
    if (!r.ok) {
      toast({ title: "Não foi possível salvar as fontes", description: r.error, variant: "danger" });
      return;
    }
    toast({ title: `Fontes de ${component.name} salvas`, description: `${fmtInt(links.length)} ${links.length === 1 ? "fonte vinculada" : "fontes vinculadas"}.`, variant: "success" });
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (busy ? undefined : onOpenChange(o))}>
      <DialogContent size="lg" data-testid="mtsr-sources-dialog">
        <DialogHeader>
          <DialogTitle>Fontes de {component.name}</DialogTitle>
          <DialogDescription>
            Quais fontes podem informar este componente e com que prioridade (menor número = maior prioridade). Fonte sem adaptador nesta versão fica
            listada, mas só receberá eventos quando o conector existir.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ul className="divide-y divide-border-subtle rounded-md border border-border">
            {sources.map((s) => {
              const st = state[s.id];
              const prioError = touched && st.linked && !(Number.isInteger(Number(st.priority)) && Number(st.priority) >= 1) ? "Inteiro a partir de 1." : undefined;
              return (
                <li key={s.id} className="flex flex-wrap items-start gap-3 px-2 py-2" data-testid="mtsr-source-link" data-code={s.code}>
                  <CheckboxField
                    className="min-w-[14rem] flex-1"
                    label={s.name}
                    description={`${sourceTypeLabel(s.sourceType)}${s.isAvailable ? "" : " · sem adaptador nesta versão"}`}
                    checked={st.linked}
                    onCheckedChange={(v) => patch(s.id, { linked: v === true })}
                    disabled={busy}
                  />
                  {st.linked ? (
                    <div className="flex items-end gap-3">
                      <FormField label="Prioridade" error={prioError} className="w-28">
                        <Input size="sm" type="number" min={1} step={1} inputMode="numeric" value={st.priority} onChange={(e) => patch(s.id, { priority: e.target.value })} disabled={busy} />
                      </FormField>
                      <SwitchField label="Habilitada" checked={st.isEnabled} onCheckedChange={(v) => patch(s.id, { isEnabled: v })} disabled={busy} size="sm" className="min-h-0 py-1" />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button variant="primary" onClick={submit} loading={busy} data-testid="mtsr-sources-save">Salvar fontes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
