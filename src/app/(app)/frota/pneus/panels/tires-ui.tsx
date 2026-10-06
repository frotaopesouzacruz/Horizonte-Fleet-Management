"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { useToast } from "@/components/feedback/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { KpiCard, type KpiCardProps } from "@/components/ui/kpi-card";
import { Pagination } from "@/components/ui/pagination";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Download } from "lucide-react";
import type { Result } from "@/lib/tires/actions";
import { TIRES_BASE_PATH, type TiresTone } from "@/lib/tires/types";
import { tiresFiltersQuery } from "@/lib/tires/url";
import type { TiresPanelContext } from "../shared";

/**
 * Peças comuns dos painéis da Gestão de Pneus: links reais entre abas (abrem
 * em nova aba, copiam o endereço), indicadores com destino, seções, paginação
 * e sub-abas pela URL, diálogo de motivo e os estados de erro/vazio.
 */

// ---------------------------------------------------------------------------
// Links e estado na URL
// ---------------------------------------------------------------------------
export interface TiresNavLink {
  href: string;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}

/**
 * Link de verdade que, no clique simples, navega pela transição da tela — com
 * o `pending` e o `aria-busy` de sempre. Sempre zera a página.
 */
export function useTiresLink(ctx: TiresPanelContext) {
  const params = useSearchParams();
  const pathname = usePathname();
  const { navigate } = ctx;
  return React.useCallback(
    (patch: Record<string, string | null>): TiresNavLink => {
      const full: Record<string, string | null> = { pagina: null, ...patch };
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(full)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      return {
        href: qs ? `${pathname}?${qs}` : pathname,
        onClick: (event) => {
          if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            return;
          }
          event.preventDefault();
          navigate(full);
        },
      };
    },
    [params, pathname, navigate],
  );
}

/**
 * Estado de exibição (gaveta aberta, agrupamento) na URL, sem nova consulta ao
 * servidor: o histórico do navegador, que o roteador acompanha.
 */
export function useViewParam(key: string): [string | null, (value: string | null) => void] {
  const params = useSearchParams();
  const pathname = usePathname();
  const value = params.get(key);
  const set = React.useCallback(
    (v: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (v == null || v === "") next.delete(key);
      else next.set(key, v);
      const qs = next.toString();
      window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
    },
    [params, pathname, key],
  );
  return [value, set];
}

/** Página atual (1-based) a partir dos parâmetros crus. */
export function currentPage(ctx: TiresPanelContext, key = "pagina"): number {
  const n = Number(ctx.params[key] ?? "1");
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/** Paginação no servidor: a página vive na URL (`pagina`). */
export function TiresPagination({
  ctx, total, limit, label, testId,
}: {
  ctx: TiresPanelContext;
  total: number;
  limit: number;
  label?: string;
  testId?: string;
}) {
  if (total <= 0) return null;
  return (
    <Pagination
      page={currentPage(ctx)}
      pageSize={limit}
      total={total}
      disabled={ctx.pending}
      label={label}
      onPageChange={(page) => ctx.navigate({ pagina: page > 1 ? String(page) : null })}
      data-testid={testId}
    />
  );
}

/** Sub-abas de um painel (`?sub=`); a troca zera a página. */
export function SubTabs<T extends string>({
  ctx, value, items, label, testIdPrefix,
}: {
  ctx: TiresPanelContext;
  value: T;
  items: { value: T; label: string }[];
  label: string;
  testIdPrefix: string;
}) {
  return (
    <Tabs appearance="container" value={value} onValueChange={(v) => ctx.navigate({ sub: v, pagina: null })} className="gap-0">
      <TabsList aria-label={label}>
        {items.map((it) => (
          <TabsTrigger key={it.value} value={it.value} data-testid={`${testIdPrefix}-${it.value}`}>
            {it.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

// ---------------------------------------------------------------------------
// Blocos
// ---------------------------------------------------------------------------
export function Section({
  title, description, actions, children, testId, className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
  className?: string;
}) {
  const headingId = React.useId();
  return (
    <section aria-labelledby={headingId} className={cn("flex min-w-0 flex-col gap-3", className)} data-testid={testId}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={headingId} className="text-h4 font-semibold text-fg">{title}</h2>
          {description ? <p className="max-w-[90ch] text-caption text-fg-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

const INTERACTIVE_KPI = cn(
  "cursor-pointer",
  "after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:bg-hover-overlay after:opacity-0",
  "after:transition-opacity after:duration-(--duration-base) group-hover:after:opacity-100",
);

export type TiresKpiProps = Omit<KpiCardProps, "size"> & {
  /** Chave estável: vira `data-testid="tires-kpi-<chave>"`. */
  kpi: string;
  /** Leva à visão que explica o número. */
  nav?: TiresNavLink | null;
  /** Para leitor de tela: para onde o link leva. */
  destination?: string;
};

/**
 * Um indicador. Os rótulos reservam duas linhas, para que os números da
 * fileira fiquem na mesma linha de base qualquer que seja o tamanho do nome.
 */
export function TiresKpi({ kpi, nav, destination, label, className, ...card }: TiresKpiProps) {
  const testId = `tires-kpi-${kpi}`;
  const body = (
    <KpiCard
      size="compact"
      label={<span className="block min-h-9 leading-snug">{label}</span>}
      className={cn("h-full justify-start", nav && INTERACTIVE_KPI, className)}
      data-testid={nav ? undefined : testId}
      {...card}
    />
  );
  if (!nav) return body;
  return (
    <a href={nav.href} onClick={nav.onClick} className="group block h-full rounded-lg hfm-focus-ring" data-testid={testId}>
      {body}
      {destination ? <span className="sr-only">. {destination}</span> : null}
    </a>
  );
}

/** Erro de carga de um painel: a tela segue de pé, o painel diz o que faltou. */
export function PanelError({ ctx, title, testId }: { ctx: TiresPanelContext; title: string; testId: string }) {
  return (
    <ErrorState
      variant="panel"
      title={title}
      description={ctx.error ?? undefined}
      onRetry={ctx.refresh}
      retryLabel="Tentar de novo"
      retrying={ctx.pending}
      data-testid={testId}
    />
  );
}

export function PanelEmpty({
  icon, title, description, testId, action, secondaryAction,
}: {
  icon: React.ReactNode;
  title: string;
  description: React.ReactNode;
  testId: string;
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
}) {
  return (
    <EmptyState
      variant="panel"
      icon={icon}
      title={title}
      description={description}
      action={action}
      secondaryAction={secondaryAction}
      data-testid={testId}
    />
  );
}

/** "VA174 · SNU9C19" — código de frota e placa, o que existir. */
export const vehicleName = (fleetCode: string | null | undefined, plate: string | null | undefined) =>
  [fleetCode, plate].filter((v, i, a) => Boolean(v) && a.indexOf(v) === i).join(" · ") || "—";

/** Placa como link para a Base geral filtrada pelo veículo (pneus montados por posição). */
export function PlateLink({ vehicleId, plate, fleetCode, testId, className }: {
  vehicleId: string | null | undefined;
  plate: string | null | undefined;
  fleetCode?: string | null;
  testId?: string;
  className?: string;
}) {
  const text = (
    <>
      {plate ?? fleetCode ?? "—"}
      {plate && fleetCode ? <span className="ml-1 font-normal text-fg-muted">· {fleetCode}</span> : null}
    </>
  );
  if (!vehicleId) return <span className={cn("font-semibold text-fg tabular-nums", className)}>{text}</span>;
  return (
    <Link
      href={`${TIRES_BASE_PATH}?aba=base&veiculo=${vehicleId}`}
      className={cn("rounded-xs font-semibold text-fg tabular-nums underline-offset-2 hover:text-primary hover:underline hfm-focus-ring", className)}
      data-testid={testId}
      onClick={(e) => e.stopPropagation()}
    >
      {text}
      <span className="sr-only"> — ver os pneus do veículo</span>
    </Link>
  );
}

/** Nº Fogo como link para a ficha 360° do pneu (texto exatamente como no Rodopar). */
export function FireLink({ tireId, fireNumber, testId, className }: {
  tireId: string | null | undefined;
  fireNumber: string | null | undefined;
  testId?: string;
  className?: string;
}) {
  if (!tireId) return <span className={cn("font-semibold tabular-nums text-fg", className)}>{fireNumber ?? "—"}</span>;
  return (
    <Link
      href={`${TIRES_BASE_PATH}/${tireId}`}
      className={cn("rounded-xs font-semibold text-fg tabular-nums underline-offset-2 hover:text-primary hover:underline hfm-focus-ring", className)}
      data-testid={testId}
      onClick={(e) => e.stopPropagation()}
    >
      {fireNumber ?? "—"}
      <span className="sr-only"> — abrir a ficha do pneu</span>
    </Link>
  );
}

/** Botão de exportação (XLSX) com os mesmos filtros da tela; só com `tires.export`. */
export function ExportButton({ ctx, kind, extra, label = "Exportar XLSX", testId }: {
  ctx: TiresPanelContext;
  kind: "base" | "medicao" | "calibragem" | "cronograma" | "vistorias" | "historico" | "qualidade";
  extra?: Record<string, string | null | undefined>;
  label?: string;
  testId?: string;
}) {
  if (!ctx.perms.export) return null;
  const qs = tiresFiltersQuery(ctx.filters, extra ?? {});
  return (
    <Button asChild variant="secondary" size="sm">
      <a href={`${TIRES_BASE_PATH}/exportar/${kind}${qs ? `?${qs}` : ""}`} data-testid={testId ?? `tires-export-${kind}`} download>
        <Download aria-hidden />
        {label}
      </a>
    </Button>
  );
}

/** Singular/plural pela quantidade. */
export const plural = (n: number | null | undefined, one: string, many: string) => (n === 1 ? one : many);

/** Cor de gráfico do tom (tokens do kit). */
export function chartColorOf(tone: TiresTone | string | null | undefined): string {
  switch (tone) {
    case "success":
      return "var(--chart-success)";
    case "warning":
      return "var(--chart-warning)";
    case "danger":
      return "var(--chart-danger)";
    case "info":
      return "var(--chart-brand-secondary)";
    case "progress":
      return "var(--progress)";
    case "pending":
      return "var(--chart-future)";
    default:
      return "var(--chart-neutral)";
  }
}

/** Horas em pt-BR ("18,5 h"). */
export const fmtHours = (v: number | null | undefined) =>
  v == null ? "—" : `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(v)} h`;

/** Rótulo + valor numa grade de fatos (ficha, gaveta). */
export function Fact({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="min-w-0 text-body-sm text-fg">{children ?? "—"}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diálogo de motivo (retornar, rejeitar, desvincular)
// ---------------------------------------------------------------------------
export const REASON_MIN = 5;

export interface ReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** Executa a ação com o motivo; o diálogo fecha só em sucesso. */
  onConfirm: (reason: string) => Promise<Result<unknown>>;
  /** Mensagem do toast de sucesso. */
  successTitle: string;
  onDone?: () => void;
  testId?: string;
}

/** Pede um motivo (≥ 5 caracteres) antes de uma ação que precisa de trilha. */
export function ReasonDialog({
  open, onOpenChange, title, description, confirmLabel, destructive = false, onConfirm, successTitle, onDone, testId,
}: ReasonDialogProps) {
  const [busy, setBusy] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={(o) => (busy ? undefined : onOpenChange(o))}>
      {/* O formulário só existe enquanto o diálogo está aberto: fechar e reabrir começa do zero. */}
      {open ? (
        <ReasonForm
          title={title}
          description={description}
          confirmLabel={confirmLabel}
          destructive={destructive}
          busy={busy}
          setBusy={setBusy}
          onCancel={() => onOpenChange(false)}
          onConfirm={onConfirm}
          successTitle={successTitle}
          onDone={() => {
            onOpenChange(false);
            onDone?.();
          }}
          testId={testId}
        />
      ) : null}
    </Dialog>
  );
}

function ReasonForm({
  title, description, confirmLabel, destructive, busy, setBusy, onCancel, onConfirm, successTitle, onDone, testId,
}: Pick<ReasonDialogProps, "title" | "description" | "confirmLabel" | "onConfirm" | "successTitle" | "testId"> & {
  destructive: boolean;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [reason, setReason] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const trimmed = reason.trim();
  const error = touched && trimmed.length < REASON_MIN ? `Informe um motivo com pelo menos ${REASON_MIN} caracteres.` : undefined;

  const submit = async () => {
    setTouched(true);
    if (trimmed.length < REASON_MIN) return;
    setBusy(true);
    let r: Result<unknown>;
    try {
      r = await onConfirm(trimmed);
    } finally {
      setBusy(false);
    }
    if (!r.ok) {
      toast({ title: "Não foi possível concluir", description: r.error, variant: "danger" });
      return;
    }
    toast({ title: successTitle, variant: "success" });
    onDone();
  };

  return (
    <DialogContent size="sm" data-testid={testId}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
      </DialogHeader>
      <DialogBody>
        <FormField label="Motivo" required error={error} helperText={`Fica na trilha de auditoria. Mínimo de ${REASON_MIN} caracteres.`}>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            rows={3}
            autoFocus
            disabled={busy}
            data-testid={testId ? `${testId}-reason` : undefined}
          />
        </FormField>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button
          variant={destructive ? "danger" : "primary"}
          onClick={submit}
          loading={busy}
          disabled={trimmed.length < REASON_MIN}
          data-testid={testId ? `${testId}-confirm` : undefined}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
