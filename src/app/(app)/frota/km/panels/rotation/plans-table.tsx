"use client";

import * as React from "react";
import { ClipboardList, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table, TableActionCell, TableBody, TableCaption, TableCell, TableContainer, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/empty-state";
import type { KmRotationPlanRow } from "@/lib/km/rotation";
import { fmtInt, fmtPct } from "@/lib/km/types";
import { formatStamp, period } from "./format";
import { RotationStatusBadge } from "./ui";

/** Sub-aba "Planos salvos": um plano por linha, como `km_rotation_plans_list` devolveu. */
export function PlansTable({ plans, onOpen }: { plans: KmRotationPlanRow[]; onOpen: (id: string) => void }) {
  if (plans.length === 0) {
    return (
      <EmptyState
        variant="panel"
        icon={<ClipboardList aria-hidden />}
        title="Nenhum plano de rodízio salvo."
        description="Na sub-aba Sugestões, selecione as trocas e use “Adicionar ao plano” para criar o primeiro."
        data-testid="km-rodizio-plans-empty"
      />
    );
  }
  return (
    <TableContainer data-testid="km-rodizio-plans">
      <Table className="min-w-[68rem]">
        <TableCaption className="sr-only">Planos de rodízio salvos</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Código</TableHead>
            <TableHead>Nome</TableHead>
            <TableHead>Criado em</TableHead>
            <TableHead>Período analisado</TableHead>
            <TableHead numeric>Rodízios</TableHead>
            <TableHead numeric>Executados</TableHead>
            <TableHead>Status</TableHead>
            <TableHead numeric>Redução média</TableHead>
            <TableHead>Criado por</TableHead>
            <TableHead>
              <span className="sr-only">Abrir</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {plans.map((p) => (
            <TableRow key={p.id} data-testid="km-rodizio-plan-row">
              <TableHead scope="row" className="font-medium text-fg">
                {p.code}
              </TableHead>
              <TableCell className="max-w-[18rem]">
                <span className="line-clamp-2 break-words">{p.name}</span>
              </TableCell>
              <TableCell className="whitespace-nowrap">{formatStamp(p.createdAt)}</TableCell>
              <TableCell className="whitespace-nowrap">
                {period(p.periodFrom, p.periodTo)}
                <span className="block text-caption text-fg-muted">horizonte de {fmtInt(p.horizonDays)} dias</span>
              </TableCell>
              <TableCell numeric>{fmtInt(p.items)}</TableCell>
              <TableCell numeric>{fmtInt(p.executed)}</TableCell>
              <TableCell>
                <RotationStatusBadge status={p.status} size="sm" />
              </TableCell>
              <TableCell numeric>{fmtPct(p.avgReductionPct)}</TableCell>
              <TableCell className="max-w-[14rem] truncate">{p.createdByName ?? "—"}</TableCell>
              <TableActionCell>
                <Button
                  size="sm"
                  variant="outline"
                  leadingIcon={<FolderOpen aria-hidden />}
                  onClick={() => onOpen(p.id)}
                  aria-label={`Abrir o plano ${p.code} — ${p.name}`}
                  data-testid="km-rodizio-plan-open"
                >
                  Abrir
                </Button>
              </TableActionCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
