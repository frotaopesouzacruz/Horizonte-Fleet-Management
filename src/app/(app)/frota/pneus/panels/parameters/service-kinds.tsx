"use client";

import * as React from "react";
import { Loader2, Plus, Wrench } from "lucide-react";
import { useToast } from "@/components/feedback/toast";
import { NativeSelect } from "@/components/governance/selects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { RadioField, RadioGroup } from "@/components/ui/radio-group";
import { SearchField } from "@/components/ui/search-field";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch, SwitchField } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { saveTireServiceKind } from "@/lib/tires/actions";
import { fmtInt, SERVICE_KIND_LABEL, type ServiceKind, type TiresCatalog } from "@/lib/tires/types";
import { PanelEmpty } from "../tires-ui";
import { normalizeText, useParamAction } from "./param-ui";

/**
 * Parâmetros → Serviços da Manutenção. Quais serviços do catálogo corporativo
 * da Gestão de Manutenção a Gestão de Pneus reconhece como alinhamento,
 * balanceamento, ambos ou serviço de pneu (aba Serviços → Alinhamento e
 * balanceamento lê as OS desses serviços).
 */
const KINDS = Object.keys(SERVICE_KIND_LABEL) as ServiceKind[];

type KindRow = TiresCatalog["serviceKinds"][number];

export function ServiceKindsSection({ catalog, canManage, onDone }: { catalog: TiresCatalog; canManage: boolean; onDone: () => void }) {
  const { busy, run } = useParamAction(onDone);
  const [pending, setPending] = React.useState<Record<string, { base: string; kind: ServiceKind; isActive: boolean }>>({});
  const [adding, setAdding] = React.useState(false);
  const rows = catalog.serviceKinds;
  const mapped = new Set(rows.map((r) => r.serviceId));
  const available = catalog.services.filter((s) => !mapped.has(s.id));

  const counts = KINDS.map((k) => ({ kind: k, n: rows.filter((r) => r.kind === k && r.isActive).length }));

  const save = async (row: KindRow, kind: ServiceKind, isActive: boolean) => {
    const base = `${row.kind}:${row.isActive}`;
    setPending((p) => ({ ...p, [row.serviceId]: { base, kind, isActive } }));
    const ok = await run(`svc:${row.serviceId}`, () => saveTireServiceKind(row.serviceId, kind, isActive), {
      success: `${row.serviceName} atualizado`,
      successDescription: `${SERVICE_KIND_LABEL[kind]} · ${isActive ? "ativo" : "inativo"}.`,
      failure: "Não foi possível salvar o vínculo do serviço",
    });
    if (!ok) {
      setPending((p) => {
        const next = { ...p };
        delete next[row.serviceId];
        return next;
      });
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="tires-param-services">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex w-full min-w-0 max-w-[100ch] flex-col gap-2 sm:w-auto sm:flex-1">
          <p className="text-body-sm text-fg-muted">
            Serviços do catálogo da Gestão de Manutenção que a Gestão de Pneus reconhece. As ordens de serviço com estes serviços aparecem em Serviços →
            Alinhamento e balanceamento; inativo deixa de ser considerado (o histórico fica).
          </p>
          <div className="flex flex-wrap gap-1.5" aria-label="Serviços ativos por tipo">
            {counts.map((c) => (
              <Badge key={c.kind} variant="neutral" size="sm">
                {SERVICE_KIND_LABEL[c.kind]}: {fmtInt(c.n)}
              </Badge>
            ))}
          </div>
        </div>
        {canManage ? (
          <Button
            size="sm"
            variant="primary"
            leadingIcon={<Plus />}
            onClick={() => setAdding(true)}
            disabled={available.length === 0}
            title={available.length === 0 ? "Todos os serviços ativos do catálogo já estão mapeados." : undefined}
            data-testid="tires-service-add"
          >
            Adicionar serviço
          </Button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <PanelEmpty
          icon={<Wrench />}
          title="Nenhum serviço mapeado"
          description="Sem mapeamento, alinhamentos e balanceamentos feitos pela Manutenção não aparecem na Gestão de Pneus."
          testId="tires-service-empty"
        />
      ) : (
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Serviço</TableHead>
                <TableHead>Cluster</TableHead>
                <TableHead>Usado como</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const p = pending[r.serviceId];
                const base = `${r.kind}:${r.isActive}`;
                const kind = p && p.base === base ? p.kind : r.kind;
                const isActive = p && p.base === base ? p.isActive : r.isActive;
                const rowBusy = busy === `svc:${r.serviceId}`;
                return (
                  <TableRow key={r.serviceId} className={isActive ? undefined : "text-fg-secondary"} data-testid="tires-service-row">
                    <TableCell className="min-w-[14rem] font-medium text-fg">{r.serviceName}</TableCell>
                    <TableCell className="text-fg-secondary">{r.clusterName ?? "—"}</TableCell>
                    <TableCell className="w-[18rem] min-w-[14rem] py-1.5">
                      {canManage ? (
                        <NativeSelect
                          fieldSize="sm"
                          value={kind}
                          onChange={(e) => void save(r, e.target.value as ServiceKind, isActive)}
                          disabled={rowBusy}
                          aria-label={`Tipo de ${r.serviceName}`}
                          data-testid="tires-service-kind"
                        >
                          {KINDS.map((k) => (
                            <option key={k} value={k}>{SERVICE_KIND_LABEL[k]}</option>
                          ))}
                        </NativeSelect>
                      ) : (
                        SERVICE_KIND_LABEL[r.kind] ?? r.kind
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {canManage ? (
                        <span className="flex items-center gap-2">
                          <Switch
                            checked={isActive}
                            onCheckedChange={(v) => void save(r, kind, v)}
                            disabled={rowBusy}
                            aria-label={`${r.serviceName} ativo`}
                            data-testid="tires-service-active"
                          />
                          <span className="text-body-sm">{isActive ? "Ativo" : "Inativo"}</span>
                          {rowBusy ? <Loader2 className="size-4 animate-spin text-fg-muted" aria-label="Salvando" /> : null}
                        </span>
                      ) : (
                        <StatusBadge status={r.isActive ? "success" : "neutral"} size="sm">{r.isActive ? "Ativo" : "Inativo"}</StatusBadge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {adding ? <AddServiceDialog services={available} onClose={() => setAdding(false)} onDone={onDone} /> : null}
    </div>
  );
}

function AddServiceDialog({
  services, onClose, onDone,
}: {
  services: TiresCatalog["services"];
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [search, setSearch] = React.useState("");
  const [serviceId, setServiceId] = React.useState("");
  const [kind, setKind] = React.useState<ServiceKind | "">("");
  const [isActive, setIsActive] = React.useState(true);
  const [submitted, setSubmitted] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const q = normalizeText(search);
  const visible = services.filter((s) => !q || normalizeText(`${s.name} ${s.clusterName ?? ""}`).includes(q));
  const chosen = services.find((s) => s.id === serviceId);
  const errors = { service: serviceId ? undefined : "Escolha o serviço.", kind: kind ? undefined : "Escolha como o serviço é usado." };

  const submit = async () => {
    setSubmitted(true);
    if (!serviceId || !kind) return;
    setBusy(true);
    try {
      const r = await saveTireServiceKind(serviceId, kind, isActive);
      if (!r.ok) {
        toast({ title: "Não foi possível mapear o serviço", description: r.error, variant: "danger" });
        return;
      }
      toast({ title: `${chosen?.name ?? "Serviço"} mapeado`, description: SERVICE_KIND_LABEL[kind], variant: "success" });
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
      <DialogContent size="lg" data-testid="tires-service-dialog">
        <DialogHeader>
          <DialogTitle>Mapear serviço da Manutenção</DialogTitle>
          <DialogDescription>Escolha um serviço ativo do catálogo da Gestão de Manutenção ainda não mapeado e diga como a Gestão de Pneus deve tratá-lo.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <fieldset className="flex min-w-0 flex-col gap-3" disabled={busy}>
            <legend className="mb-1 text-body-sm font-semibold text-fg">
              Serviço <span className="text-danger" aria-hidden>*</span>
            </legend>
            <SearchField size="sm" value={search} onValueChange={setSearch} placeholder="Nome do serviço ou cluster" aria-label="Buscar serviço" data-testid="tires-service-search" />
            {visible.length === 0 ? (
              <p className="py-6 text-center text-body-sm text-fg-muted">{services.length === 0 ? "Todos os serviços já estão mapeados." : `Nenhum serviço com “${search.trim()}”.`}</p>
            ) : (
              <RadioGroup
                value={serviceId}
                onValueChange={setServiceId}
                aria-label="Serviço"
                className="max-h-[40vh] gap-0 divide-y divide-border-subtle overflow-auto rounded-md border border-border"
              >
                {visible.map((s) => (
                  <RadioField key={s.id} value={s.id} label={s.name} description={s.clusterName ?? undefined} className="rounded-none px-2.5" data-testid="tires-service-option" />
                ))}
              </RadioGroup>
            )}
            {submitted && errors.service ? <p role="alert" className="text-helper text-danger">{errors.service}</p> : null}
          </fieldset>
          <fieldset className="flex flex-col gap-4" disabled={busy}>
            <legend className="sr-only">Uso na Gestão de Pneus</legend>
            <FormField label="Usado como" required error={submitted ? errors.kind : undefined} className="sm:max-w-sm">
              <NativeSelect value={kind} onChange={(e) => setKind(e.target.value as ServiceKind)} data-testid="tires-service-new-kind">
                <option value="">Escolha…</option>
                {KINDS.map((k) => (
                  <option key={k} value={k}>{SERVICE_KIND_LABEL[k]}</option>
                ))}
              </NativeSelect>
            </FormField>
            <SwitchField label="Ativo" description="Inativo fica cadastrado, mas não é considerado." checked={isActive} onCheckedChange={setIsActive} className="rounded-md border border-border" />
          </fieldset>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} data-testid="tires-service-save">
            Mapear serviço
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
