"use client";

import * as React from "react";
import { Info, RefreshCw, ScanSearch } from "lucide-react";
import { useToast } from "@/components/feedback/toast";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { rescanTireAudit } from "@/lib/tires/actions";
import { fmtInt, formatDate, formatStamp, plural, type TiresAuditCenter } from "@/lib/tires/types";
import type { TiresPanelContext } from "../../shared";
import { Fact } from "../tires-ui";
import { AuditRules } from "./audit-rules";
import { SCAN_STATUS_LABEL, SCAN_TRIGGER_LABEL, TID, type AuditScan } from "./audit-common";

/**
 * Cabeçalho da Central: a última varredura (quando, por quê, o que mudou), o
 * catálogo de regras e — para quem importa dados ou gere os parâmetros — a
 * varredura sob demanda (`tire_audit_rescan`).
 */
export function AuditHeader({ data, ctx }: { data: TiresAuditCenter; ctx: TiresPanelContext }) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const scan = data.lastScan as AuditScan | null;
  const canRescan = ctx.perms.import || ctx.perms.parameters;

  const rescan = async () => {
    setBusy(true);
    try {
      const r = await rescanTireAudit();
      if (!r.ok) {
        toast({ title: "Não foi possível reexecutar a auditoria", description: r.error, variant: "danger" });
        return;
      }
      const d = r.data;
      toast({
        title: "Auditoria reexecutada",
        description: d
          ? `${fmtInt(d.opened)} ${plural(d.opened, "achado novo", "achados novos")} · ${fmtInt(d.resolved)} ${plural(d.resolved, "resolvido", "resolvidos")} · ${fmtInt(d.openTotal)} ${plural(d.openTotal, "aberto", "abertos")} no total.`
          : undefined,
        variant: "success",
      });
      ctx.refresh();
    } catch {
      toast({ title: "Não foi possível reexecutar a auditoria", description: "A conexão com o servidor caiu. Tente de novo.", variant: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby={`${TID}-scan-title`}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4 shadow-card"
      data-testid={`${TID}-scan`}
      data-status={scan?.status}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-interactive text-fg-secondary" aria-hidden>
            <ScanSearch className="size-4" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id={`${TID}-scan-title`} className="flex flex-wrap items-center gap-2 text-h4 font-semibold text-fg">
              Última varredura
              {scan ? (
                <StatusBadge
                  status={scan.status === "concluida" ? "success" : scan.status === "falhou" ? "danger" : "progress"}
                  size="sm"
                >
                  {SCAN_STATUS_LABEL[scan.status] ?? scan.status}
                </StatusBadge>
              ) : null}
            </h2>
            <p className="text-caption text-fg-muted">
              {scan
                ? `${formatStamp(scan.finishedAt ?? scan.startedAt)} · ${SCAN_TRIGGER_LABEL[scan.trigger] ?? scan.trigger}${scan.requestedByName ? ` · ${scan.requestedByName}` : ""}`
                : "Nenhuma varredura registrada ainda: a primeira roda na próxima confirmação dos dados ou na agenda diária."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AuditRules rules={data.rules} ctx={ctx} activeRule={data.filters.rule} />
          {canRescan ? (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<RefreshCw />}
              loading={busy}
              disabled={ctx.pending || scan?.status === "em_andamento"}
              onClick={() => void rescan()}
              data-testid={`${TID}-rescan`}
            >
              {busy ? "Reexecutando…" : "Reexecutar auditoria"}
            </Button>
          ) : null}
        </div>
      </div>

      {scan ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-6">
          <Fact label="Dados avaliados">{scan.referenceDate ? `dados de ${formatDate(scan.referenceDate)}` : "—"}</Fact>
          <Fact label="Gatilho">{SCAN_TRIGGER_LABEL[scan.trigger] ?? scan.trigger}</Fact>
          <Fact label="Abertos após a varredura">
            <span className="font-semibold tabular-nums">{fmtInt(scan.openTotal)}</span>
          </Fact>
          <Fact label="Novos">
            <span className="tabular-nums">{fmtInt(scan.opened)}</span>
          </Fact>
          <Fact label="Resolvidos">
            <span className="tabular-nums">{fmtInt(scan.resolved)}</span>
          </Fact>
          <Fact label="Reabertos">
            <span className="tabular-nums">{scan.reopened == null ? "—" : fmtInt(scan.reopened)}</span>
          </Fact>
        </dl>
      ) : null}

      {scan?.status === "falhou" && scan.errorMessage ? (
        <p className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-body-sm text-danger-soft-fg" role="alert">
          A última varredura falhou: {scan.errorMessage}
        </p>
      ) : null}

      <p className="flex items-start gap-2 border-t border-border pt-3 text-caption text-fg-muted" data-testid={`${TID}-note`}>
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          A auditoria não corrige nada: ela identifica e acompanha. A correção é feita na origem — planilha/Rodopar, Cadastro de Frotas ou
          Parâmetros — e a próxima varredura (na confirmação dos dados, na agenda diária ou sob demanda) resolve o achado.
        </span>
      </p>
    </section>
  );
}
