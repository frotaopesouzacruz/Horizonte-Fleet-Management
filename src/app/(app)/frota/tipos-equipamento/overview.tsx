"use client";

import * as React from "react";
import { CheckCircle2, Layers, Shapes, Truck, XCircle } from "lucide-react";
import { KpiCard } from "@/components/ui/kpi-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import type { EquipmentTypeSummary } from "@/lib/equipment/queries";

/**
 * The indicator row of Tipos de Equipamento.
 *
 * Five numbers, all counted by one aggregate in the database. "Veículos
 * vinculados" is the one that matters most: it is the answer to "what does
 * touching this catalogue actually affect", and the whole module exists because
 * the previous system never computed it.
 */

const numberFormat = new Intl.NumberFormat("pt-BR");

const GRID = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5";

function kpiLabel(text: string) {
  return <span className="block min-h-11 leading-snug">{text}</span>;
}

function shareOf(value: number, total: number): string | undefined {
  if (total <= 0) return undefined;
  return `${Math.round((value / total) * 100)}% do total`;
}

export function OverviewCards({ summary }: { summary: EquipmentTypeSummary }) {
  return (
    <div className={GRID}>
      <KpiCard
        className="min-h-28 justify-start"
        label={kpiLabel("Total de tipos")}
        value={summary.total}
        period="Catálogo base e tipos da organização"
        icon={<Shapes aria-hidden />}
      />
      <KpiCard
        className="min-h-28 justify-start"
        status="success"
        label={kpiLabel("Tipos ativos")}
        value={summary.active}
        period={shareOf(summary.active, summary.total)}
        icon={<CheckCircle2 aria-hidden />}
      />
      {/* Inativo aqui é o tipo, não o veículo: um tipo inativo continua
          classificando os veículos que já classificava (§10). */}
      <KpiCard
        className="min-h-28 justify-start"
        label={kpiLabel("Tipos inativos")}
        value={summary.inactive}
        period={summary.inactive > 0 ? "Fora de novos cadastros" : "Nenhum tipo inativo"}
        icon={<XCircle aria-hidden />}
      />
      <KpiCard
        className="min-h-28 justify-start"
        label={kpiLabel("Subcategorias ativas")}
        value={summary.subcategoriesActive}
        icon={<Layers aria-hidden />}
      />
      <KpiCard
        className="min-h-28 justify-start"
        label={kpiLabel("Veículos vinculados")}
        value={summary.vehiclesLinked}
        period={
          summary.vehiclesWithoutSubcategory > 0
            ? `${numberFormat.format(summary.vehiclesWithoutSubcategory)} sem subcategoria`
            : "Todos com subcategoria definida"
        }
        icon={<Truck aria-hidden />}
      />
    </div>
  );
}

export function OverviewSkeleton() {
  return (
    <div className={GRID}>
      {Array.from({ length: 5 }, (_, index) => (
        <KpiCard
          key={index}
          className="min-h-28 justify-start"
          loading
          loadingLabel="Carregando indicadores…"
          label=""
          value=""
        />
      ))}
    </div>
  );
}

export function OverviewError() {
  return (
    <Alert variant="warning">
      <AlertTitle>Não foi possível carregar os indicadores</AlertTitle>
      <AlertDescription>A lista de tipos abaixo continua disponível.</AlertDescription>
    </Alert>
  );
}
