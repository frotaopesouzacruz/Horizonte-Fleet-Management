"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, History, Smartphone } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { DateInput } from "@/components/ui/date-input";
import { FormField, FormGrid } from "@/components/ui/form-field";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { Spinner } from "@/components/feedback/spinner";
import { useToast } from "@/components/feedback/toast";
import type { ApplicationLinks, LinkHistoryEntry } from "@/lib/applications/links-queries";
import {
  loadApplicationLinks, loadLinkHistory, setOperationLink, setVehicleTypeLink,
} from "@/lib/applications/links-actions";

const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

function formatDate(value: string | null): string {
  if (!value) return "";
  const [y, m, d] = value.slice(0, 10).split("-");
  return d ? `${d}/${m}/${y}` : value;
}

/**
 * Em que lado o painel está sendo lido:
 *   · operation        — cadastro de uma operação: lista os aplicativos
 *   · vehicle_type     — cadastro de um tipo de equipamento: lista os aplicativos
 *   · app-operations   — gerenciador do aplicativo: lista as operações
 *   · app-vehicle-types— gerenciador do aplicativo: lista os tipos
 *
 * Os quatro leem e gravam a MESMA fonte (§26). O painel nunca guarda lista
 * própria: o que aparece é o que `application_links_overview` devolveu.
 */
export type LinksPanelMode = "operation" | "vehicle_type" | "app-operations" | "app-vehicle-types";

interface Row {
  key: string;
  appId: string;
  targetId: string;
  name: string;
  meta: string | null;
  inactive: boolean;
  linked: boolean;
  isEnabled: boolean;
  inForce: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  updatedAt: string | null;
}

export interface ApplicationLinksPanelProps {
  mode: LinksPanelMode;
  /** id da operação, do tipo ou do aplicativo, conforme o modo. */
  targetId: string;
  /** Dados já carregados no servidor. Sem eles, o painel carrega sozinho. */
  links?: ApplicationLinks;
  canManage: boolean;
  canViewHistory?: boolean;
  title?: string;
  description?: string;
  /** Injeção para a prévia sem sessão. */
  loader?: () => Promise<{ ok: boolean; error?: string; data?: ApplicationLinks }>;
  className?: string;
}

function buildRows(mode: LinksPanelMode, targetId: string, links: ApplicationLinks): Row[] {
  if (mode === "operation" || mode === "vehicle_type") {
    return links.apps
      .filter((app) => app.isActive)
      .map((app) => {
        const link =
          mode === "operation"
            ? links.operationLinks.find((l) => l.appId === app.id && l.operationId === targetId)
            : links.typeLinks.find((l) => l.appId === app.id && l.vehicleTypeId === targetId);
        return {
          key: app.id,
          appId: app.id,
          targetId,
          name: app.name,
          meta: app.code,
          inactive: false,
          linked: Boolean(link),
          isEnabled: link?.isEnabled ?? false,
          inForce: link?.inForce ?? false,
          effectiveFrom: link?.effectiveFrom ?? null,
          effectiveTo: link?.effectiveTo ?? null,
          updatedAt: link?.updatedAt ?? null,
        };
      });
  }
  if (mode === "app-operations") {
    return links.operations.map((op) => {
      const link = links.operationLinks.find((l) => l.appId === targetId && l.operationId === op.id);
      return {
        key: op.id,
        appId: targetId,
        targetId: op.id,
        name: op.name,
        meta: op.code,
        inactive: op.status !== "active",
        linked: Boolean(link),
        isEnabled: link?.isEnabled ?? false,
        inForce: link?.inForce ?? false,
        effectiveFrom: link?.effectiveFrom ?? null,
        effectiveTo: link?.effectiveTo ?? null,
        updatedAt: link?.updatedAt ?? null,
      };
    });
  }
  return links.vehicleTypes.map((type) => {
    const link = links.typeLinks.find((l) => l.appId === targetId && l.vehicleTypeId === type.id);
    return {
      key: type.id,
      appId: targetId,
      targetId: type.id,
      name: type.name,
      meta: type.scope === "global" ? "catálogo base" : type.code,
      inactive: !type.isActive,
      linked: Boolean(link),
      isEnabled: link?.isEnabled ?? false,
      inForce: link?.inForce ?? false,
      effectiveFrom: link?.effectiveFrom ?? null,
      effectiveTo: link?.effectiveTo ?? null,
      updatedAt: link?.updatedAt ?? null,
    };
  });
}

export function ApplicationLinksPanel(props: ApplicationLinksPanelProps) {
  // Chaveado pelo alvo: trocar de operação ou de tipo zera o estado local.
  return <PanelBody key={`${props.mode}:${props.targetId}`} {...props} />;
}

function PanelBody({
  mode, targetId, links: initial, canManage, canViewHistory = false, title, description, loader, className,
}: ApplicationLinksPanelProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [links, setLinks] = React.useState<ApplicationLinks | null>(initial ?? null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [vigencia, setVigencia] = React.useState<Row | null>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);

  const filters = React.useMemo(
    () =>
      mode === "operation"
        ? { operationId: targetId }
        : mode === "vehicle_type"
          ? { vehicleTypeId: targetId }
          : { appId: targetId },
    [mode, targetId],
  );

  const reload = React.useCallback(async () => {
    const result = loader ? await loader() : await loadApplicationLinks(filters);
    if (result.ok && result.data) {
      setLinks(result.data);
      setLoadError(null);
    } else {
      setLoadError(result.error ?? "Não foi possível carregar os vínculos.");
    }
  }, [filters, loader]);

  React.useEffect(() => {
    if (initial) return;
    let cancelled = false;
    const run = async () => {
      const result = loader ? await loader() : await loadApplicationLinks(filters);
      if (cancelled) return;
      if (result.ok && result.data) setLinks(result.data);
      else setLoadError(result.error ?? "Não foi possível carregar os vínculos.");
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [initial, filters, loader]);

  const rows = React.useMemo(() => (links ? buildRows(mode, targetId, links) : []), [links, mode, targetId]);

  const save = async (row: Row, next: { isEnabled: boolean; effectiveFrom?: string | null; effectiveTo?: string | null }) => {
    setBusyKey(row.key);
    const payload = {
      appId: row.appId,
      isEnabled: next.isEnabled,
      effectiveFrom: next.effectiveFrom === undefined ? row.effectiveFrom : next.effectiveFrom,
      effectiveTo: next.effectiveTo === undefined ? row.effectiveTo : next.effectiveTo,
    };
    const result =
      mode === "operation" || mode === "app-operations"
        ? await setOperationLink({ ...payload, operationId: row.targetId })
        : await setVehicleTypeLink({ ...payload, vehicleTypeId: row.targetId });
    setBusyKey(null);
    if (!result.ok) {
      toast({ title: result.error ?? "Não foi possível alterar o vínculo.", variant: "danger" });
      return false;
    }
    toast({
      title: next.isEnabled ? `${row.name}: aplicativo habilitado.` : `${row.name}: aplicativo desabilitado.`,
      variant: "success",
    });
    await reload();
    router.refresh();
    return true;
  };

  const heading = title ?? (mode === "app-operations" ? "Operações habilitadas" : mode === "app-vehicle-types" ? "Tipos de equipamento habilitados" : "Aplicativos habilitados");
  const explain =
    description ??
    (mode === "operation"
      ? "Quais aplicativos esta operação pode utilizar. Sem vínculo, o aplicativo não aparece para ela."
      : mode === "vehicle_type"
        ? "Quais aplicativos os veículos deste tipo podem utilizar. Sem vínculo, os veículos não aparecem no aplicativo."
        : mode === "app-operations"
          ? "Só as operações habilitadas aparecem na seleção do aplicativo. Uma operação nova nasce desabilitada."
          : "Só veículos de tipos habilitados aparecem no aplicativo. Um tipo novo nasce desabilitado.");

  return (
    <section className={cn("flex flex-col gap-3", className)} aria-label={heading}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-h4 font-semibold text-fg">
            <Smartphone className="size-4 text-fg-muted" aria-hidden />
            {heading}
          </h3>
          <p className="text-body-sm text-fg-secondary">{explain}</p>
        </div>
        {canViewHistory ? (
          <Button variant="ghost" size="sm" leadingIcon={<History />} onClick={() => setHistoryOpen(true)}>
            Histórico
          </Button>
        ) : null}
      </div>

      {loadError ? (
        <Alert variant="danger">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}

      {!links && !loadError ? (
        <p className="flex items-center gap-2 py-4 text-body-sm text-fg-muted">
          <Spinner size="sm" /> Carregando vínculos…
        </p>
      ) : null}

      {links && rows.length === 0 ? (
        <EmptyState
          icon={<Smartphone />}
          title={mode === "operation" || mode === "vehicle_type" ? "Nenhum aplicativo cadastrado" : "Nada para vincular"}
          description="Só aplicativos, operações e tipos realmente cadastrados aparecem aqui — nenhum registro é inventado."
        />
      ) : null}

      {rows.length > 0 ? (
        <ul className="flex flex-col gap-2" data-testid="application-links">
          {rows.map((row) => {
            const on = row.linked && row.isEnabled;
            const outOfForce = on && !row.inForce;
            return (
              <li
                key={row.key}
                className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-body-sm font-medium text-fg">
                    <span className="truncate">{row.name}</span>
                    {row.meta ? <span className="font-mono text-caption text-fg-muted">{row.meta}</span> : null}
                    {row.inactive ? (
                      <Badge variant="neutral" appearance="soft" size="sm">Inativo</Badge>
                    ) : null}
                    {outOfForce ? (
                      <Badge variant="warning" appearance="soft" size="sm">Fora da vigência</Badge>
                    ) : on ? (
                      <Badge variant="success" appearance="soft" size="sm">Habilitado</Badge>
                    ) : (
                      <Badge variant="neutral" appearance="soft" size="sm">Desabilitado</Badge>
                    )}
                  </p>
                  <p className="text-caption text-fg-muted">
                    {row.effectiveFrom || row.effectiveTo
                      ? `Vigência ${row.effectiveFrom ? `de ${formatDate(row.effectiveFrom)}` : ""}${row.effectiveTo ? ` até ${formatDate(row.effectiveTo)}` : " em aberto"}`
                      : row.linked
                        ? "Sem vigência definida"
                        : "Nunca vinculado"}
                    {row.updatedAt ? ` · alterado em ${dateTime.format(new Date(row.updatedAt))}` : ""}
                  </p>
                </div>
                {canManage ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    leadingIcon={<CalendarRange />}
                    onClick={() => setVigencia(row)}
                    disabled={busyKey === row.key}
                  >
                    Vigência
                  </Button>
                ) : null}
                <Switch
                  checked={on}
                  disabled={!canManage || busyKey === row.key}
                  aria-label={`${on ? "Desabilitar" : "Habilitar"} ${row.name}`}
                  onCheckedChange={(checked) => void save(row, { isEnabled: Boolean(checked) })}
                />
              </li>
            );
          })}
        </ul>
      ) : null}

      {!canManage && rows.length > 0 ? (
        <p className="text-caption text-fg-muted">
          Você pode consultar os vínculos, mas não alterá-los.
        </p>
      ) : null}

      <VigenciaDialog
        row={vigencia}
        onOpenChange={(open) => {
          if (!open) setVigencia(null);
        }}
        onSave={async (from, to) => {
          if (!vigencia) return false;
          const ok = await save(vigencia, { isEnabled: vigencia.linked ? vigencia.isEnabled : true, effectiveFrom: from, effectiveTo: to });
          if (ok) setVigencia(null);
          return ok;
        }}
      />

      <HistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        filters={filters}
        rows={rows}
        mode={mode}
        links={links}
      />
    </section>
  );
}

function VigenciaDialog({
  row, onOpenChange, onSave,
}: {
  row: Row | null;
  onOpenChange: (open: boolean) => void;
  onSave: (from: string | null, to: string | null) => Promise<boolean>;
}) {
  return (
    <Dialog open={Boolean(row)} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        {row ? <VigenciaForm key={row.key} row={row} onSave={onSave} onCancel={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function VigenciaForm({
  row, onSave, onCancel,
}: {
  row: Row;
  onSave: (from: string | null, to: string | null) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [from, setFrom] = React.useState(row.effectiveFrom ?? "");
  const [to, setTo] = React.useState(row.effectiveTo ?? "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async () => {
    if (from && to && to < from) {
      setError("A vigência final não pode ser anterior à inicial.");
      return;
    }
    setSaving(true);
    const ok = await onSave(from || null, to || null);
    setSaving(false);
    if (!ok) setError("Não foi possível salvar a vigência.");
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Vigência do vínculo</DialogTitle>
        <DialogDescription>
          {row.name}. Fora da vigência, o vínculo não vale mesmo estando habilitado — é assim que uma
          autorização temporária termina sozinha, sem apagar o histórico.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-3">
        {error ? (
          <Alert variant="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <FormGrid>
          <FormField label="Início" id={`vig-from-${row.key}`} helperText="Vazio: desde sempre.">
            <DateInput id={`vig-from-${row.key}`} value={from} onChange={(e) => setFrom(e.target.value)} />
          </FormField>
          <FormField label="Fim" id={`vig-to-${row.key}`} helperText="Vazio: em aberto.">
            <DateInput id={`vig-to-${row.key}`} value={to} onChange={(e) => setTo(e.target.value)} />
          </FormField>
        </FormGrid>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>Cancelar</Button>
        <Button onClick={submit} loading={saving}>Salvar vigência</Button>
      </DialogFooter>
    </>
  );
}

function HistoryDialog({
  open, onOpenChange, filters, rows, mode, links,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: { appId?: string; operationId?: string; vehicleTypeId?: string };
  rows: Row[];
  mode: LinksPanelMode;
  links: ApplicationLinks | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Histórico de alterações</DialogTitle>
          <DialogDescription>
            Trilha oficial de auditoria: quem habilitou ou desabilitou, quando, e o valor anterior.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {open ? <HistoryList filters={filters} rows={rows} mode={mode} links={links} /> : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function HistoryList({
  filters, rows, mode, links,
}: {
  filters: { appId?: string; operationId?: string; vehicleTypeId?: string };
  rows: Row[];
  mode: LinksPanelMode;
  links: ApplicationLinks | null;
}) {
  const [entries, setEntries] = React.useState<LinkHistoryEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const result = await loadLinkHistory({ ...filters, limit: 100 });
      if (cancelled) return;
      if (result.ok && result.data) setEntries(result.data);
      else setError(result.error ?? "Não foi possível carregar o histórico.");
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [filters]);

  const nameOf = (entry: LinkHistoryEntry): string => {
    if (mode === "operation" || mode === "vehicle_type") {
      return links?.apps.find((a) => a.id === entry.appId)?.name ?? rows.find((r) => r.appId === entry.appId)?.name ?? "Aplicativo";
    }
    if (entry.kind === "operation") {
      return links?.operations.find((o) => o.id === entry.operationId)?.name ?? "Operação";
    }
    return links?.vehicleTypes.find((t) => t.id === entry.vehicleTypeId)?.name ?? "Tipo de equipamento";
  };

  if (error) {
    return (
      <Alert variant="danger">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!entries) {
    return (
      <p className="flex items-center gap-2 py-4 text-body-sm text-fg-muted">
        <Spinner size="sm" /> Carregando histórico…
      </p>
    );
  }
  if (entries.length === 0) {
    return <p className="py-4 text-body-sm text-fg-muted">Nenhuma alteração registrada.</p>;
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {entries.map((entry) => {
        const before = entry.before?.isEnabled;
        const after = entry.after?.isEnabled;
        const label =
          entry.action === "DELETE"
            ? "vínculo removido"
            : entry.action === "INSERT"
              ? after ? "habilitado" : "vinculado desabilitado"
              : before !== after
                ? after ? "habilitado" : "desabilitado"
                : "vigência alterada";
        return (
          <li key={entry.id} className="flex flex-col gap-0.5 py-2">
            <p className="text-body-sm text-fg">
              <span className="font-medium">{nameOf(entry)}</span> · {label}
            </p>
            <p className="text-caption text-fg-muted">
              {dateTime.format(new Date(entry.createdAt))}
              {entry.userName ? ` · ${entry.userName}` : " · sistema"}
              {entry.before || entry.after
                ? ` · antes: ${entry.before ? (entry.before.isEnabled ? "habilitado" : "desabilitado") : "sem vínculo"}; depois: ${entry.after ? (entry.after.isEnabled ? "habilitado" : "desabilitado") : "sem vínculo"}`
                : ""}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
