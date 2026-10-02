"use client";

import * as React from "react";
import { FileSpreadsheet, HeartPulse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { KmQualityLastBatch, KmQualityStale } from "@/lib/km/quality";
import { byCode, fmtInt, formatDate, KM_FRESHNESS } from "@/lib/km/types";
import { ToneBadge } from "../analysis/shared";

/**
 * Frotas desatualizadas (faixa e dias sem leitura), saúde do hodômetro e o
 * último lote consolidado. Faixas e saúde vêm classificadas da rotina.
 */
const HEALTH = [
  { code: "healthy", label: "Saudável", tone: "success", hint: "Atualizado, sem regressão nem divergência, cobertura ≥ 70%" },
  { code: "attention", label: "Atenção", tone: "warning", hint: "2+ dias sem leitura, 1 regressão, divergência ou cobertura < 70%" },
  { code: "critical", label: "Crítico", tone: "danger", hint: "7+ dias sem leitura, 2+ regressões ou cobertura < 30%" },
  { code: "no_data", label: "Sem dados", tone: "neutral", hint: "Nunca teve leitura" },
] as const;

const stamp = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
};

export function OdometerHealth({ health }: { health: Record<string, number> | null | undefined }) {
  return (
    <Panel
      title="Saúde do hodômetro"
      meta="frotas no recorte"
      actions={<HeartPulse className="size-4 text-fg-muted" aria-hidden />}
      data-testid="km-qualidade-saude"
    >
      <ul className="flex flex-col gap-2.5">
        {HEALTH.map((h) => (
          <li key={h.code} className="flex items-start justify-between gap-3">
            <span className="flex min-w-0 flex-col gap-0.5">
              <ToneBadge tone={h.tone}>{h.label}</ToneBadge>
              <span className="text-caption text-fg-muted">{h.hint}</span>
            </span>
            <span className="text-h3 font-semibold text-fg tabular-nums" data-testid={`km-qualidade-saude-${h.code}`}>
              {fmtInt(byCode(health ?? null, h.code) ?? 0)}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function LastBatch({
  batch, onOpen,
}: {
  batch: KmQualityLastBatch | null | undefined;
  onOpen?: (id: string) => void;
}) {
  return (
    <Panel
      title="Último lote consolidado"
      actions={<FileSpreadsheet className="size-4 text-fg-muted" aria-hidden />}
      data-testid="km-qualidade-ultimo-lote"
      footer={
        batch && onOpen ? (
          <Button size="sm" variant="ghost" onClick={() => onOpen(batch.id)} data-testid="km-qualidade-abrir-lote">
            Ver o lote
          </Button>
        ) : undefined
      }
    >
      {batch ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-body-sm">
          <div className="col-span-2 flex min-w-0 flex-col">
            <dt className="text-caption text-fg-muted">Arquivo</dt>
            <dd className="truncate font-medium text-fg" title={batch.fileName ?? undefined}>{batch.fileName ?? "—"}</dd>
          </div>
          <div className="col-span-2 flex flex-col">
            <dt className="text-caption text-fg-muted">Processado em</dt>
            <dd className="text-fg tabular-nums">{stamp(batch.processedAt)}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-caption text-fg-muted">Criadas</dt>
            <dd className="font-semibold text-fg tabular-nums">{fmtInt(batch.createdRows)}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-caption text-fg-muted">Atualizadas</dt>
            <dd className="font-semibold text-fg tabular-nums">{fmtInt(batch.updatedRows)}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-caption text-fg-muted">Com alerta</dt>
            <dd className="font-semibold text-fg tabular-nums">{fmtInt(batch.warningRows)}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-caption text-fg-muted">Com erro</dt>
            <dd className="font-semibold text-fg tabular-nums">{fmtInt(batch.errorRows)}</dd>
          </div>
        </dl>
      ) : (
        <p className="text-body-sm text-fg-muted">Nenhum lote de KM consolidado ainda.</p>
      )}
    </Panel>
  );
}

export function StaleFleets({ stale }: { stale: KmQualityStale[] }) {
  return (
    <section id="km-qualidade-desatualizadas" aria-labelledby="km-qualidade-desatualizadas-titulo" className="flex scroll-mt-24 flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="km-qualidade-desatualizadas-titulo" className="text-h4 font-semibold text-fg">
          Frotas desatualizadas <span className="font-normal text-fg-muted">({fmtInt(stale.length)})</span>
        </h3>
        <p className="text-caption text-fg-muted">Dias sem leitura contados até ontem. Mais antigas primeiro.</p>
      </div>
      <TableContainer stickyHeader maxHeight={420}>
        <Table className="min-w-[720px]" data-testid="km-qualidade-desatualizadas">
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Placa</TableHead>
              <TableHead className="w-28">Frota</TableHead>
              <TableHead className="w-40">Modelo</TableHead>
              <TableHead className="w-32">Última leitura</TableHead>
              <TableHead numeric>Dias sem leitura</TableHead>
              <TableHead className="w-44">Faixa</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stale.length === 0 ? (
              <TableEmpty colSpan={6} message="Todas as frotas do recorte têm leitura recente." />
            ) : (
              stale.map((s) => {
                const bucket = KM_FRESHNESS.find((b) => b.key === s.bucket);
                return (
                  <TableRow key={s.vehicleId} data-testid="km-qualidade-desatualizada">
                    <TableCell className="font-medium">{s.plate}</TableCell>
                    <TableCell className="text-fg-secondary">{s.fleetCode ?? "—"}</TableCell>
                    <TableCell truncate title={s.model ?? undefined} className="max-w-40">{s.model ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{s.lastReadingDate ? formatDate(s.lastReadingDate) : "Nunca"}</TableCell>
                    <TableCell numeric>{s.missingDays == null ? "—" : fmtInt(s.missingDays)}</TableCell>
                    <TableCell>
                      <ToneBadge tone={bucket?.tone ?? "neutral"}>{bucket?.label ?? s.bucket}</ToneBadge>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </section>
  );
}
