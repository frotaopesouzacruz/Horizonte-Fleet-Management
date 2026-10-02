"use client";

import * as React from "react";
import {
  CalendarDays, ClipboardCheck, Database, ExternalLink, FileSpreadsheet, FileText, PieChart, Repeat, ShieldOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterChip } from "@/components/ui/filter-bar";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { kmFiltersQuery } from "@/lib/km/url";
import type { KmPanelContext } from "../shared";
import { ReportCard } from "./reports/report-card";
import { kmFilterSummary, kmRequestedPeriodLabel } from "../relatorio/filter-summary";

/**
 * Gestão de KM → Relatórios.
 *
 * Um cartão por relatório, sempre com os filtros vigentes da tela: o arquivo
 * é o mesmo conjunto de dados que a pessoa vê (as rotas chamam as mesmas
 * rotinas, com os mesmos filtros e escopo). Exportar exige `km.export`, e cada
 * arquivo gerado fica registrado na auditoria.
 */
export function ReportsPanel({ data, ctx }: { data: null | null; ctx: KmPanelContext }) {
  void data;
  const { perms, filters, basePath } = ctx;
  const summary = React.useMemo(() => kmFilterSummary(filters, ctx.options), [filters, ctx.options]);

  if (!perms.export) {
    return (
      <EmptyState
        icon={<ShieldOff />}
        title="Sem permissão para exportar"
        description="Os relatórios de KM exigem a permissão de exportação (km.export). Peça acesso ao administrador."
        data-testid="km-relatorios-no-permission"
      />
    );
  }

  const query = kmFiltersQuery(filters);
  const exportHref = (kind: string, extra: Record<string, string> = {}) => {
    const qs = kmFiltersQuery(filters, extra);
    return `${basePath}/export/${kind}${qs ? `?${qs}` : ""}`;
  };
  const printHref = `${basePath}/relatorio${query ? `?${query}` : ""}`;
  const rotationQs = kmFiltersQuery(filters, { aba: "rodizio", sub: "planos" });
  const rotationHref = `${basePath}?${rotationQs}`;

  return (
    <div className="flex flex-col gap-5" data-testid="km-relatorios">
      {ctx.error ? <ErrorState title="Não foi possível carregar os relatórios" description={ctx.error} onRetry={ctx.refresh} /> : null}

      <section
        aria-labelledby="km-relatorios-filtros"
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4 shadow-card"
        data-testid="km-relatorios-filters"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id="km-relatorios-filtros" className="text-card-title font-semibold text-fg">Filtros vigentes</h2>
            <p className="text-body-sm text-fg-muted">Ajuste os filtros no topo da tela; todos os arquivos abaixo seguem esta seleção.</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-xs bg-primary-soft px-2 py-1 text-caption font-medium text-primary-soft-fg">
            <CalendarDays aria-hidden className="size-3.5" />
            {kmRequestedPeriodLabel(filters)}
          </span>
        </div>
        {summary.length === 0 ? (
          <p className="text-body-sm text-fg-secondary">Nenhum filtro além do período: todas as frotas visíveis para você.</p>
        ) : (
          <ul aria-label="Filtros ativos" className="flex flex-wrap gap-1.5">
            {summary.map((s) => (
              <li key={s.key}>
                <FilterChip label={s.label} value={s.value} />
              </li>
            ))}
          </ul>
        )}
        <Alert variant="info" className="py-2">
          <AlertDescription>Os arquivos usam o mesmo conjunto de dados da tela, com os filtros acima.</AlertDescription>
        </Alert>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ReportCard
          testId="km-relatorios-gerencial"
          icon={<PieChart />}
          title="Relatório Gerencial"
          description="Leitura executiva do período: indicadores, operação, localização, coortes técnicas e veículos."
          contents={[
            "Resumo com KPIs, período, dia de referência e leitura gerencial",
            "KM por operação e por localização",
            "Estatística das coortes e dispersão por veículo",
            "Faixa, quadrante, pontos para análise, projeções e preventiva",
          ]}
          note={
            !perms.dashboard || !perms.analysis
              ? "Seu perfil não tem a Visão geral ou a Análise gerencial: o arquivo sai só com as partes que você pode ver."
              : "A versão para PDF abre em nova aba, pronta para imprimir ou salvar."
          }
          actions={
            <>
              <Button asChild size="sm">
                <a href={exportHref("gerencial")} download data-testid="km-relatorios-gerencial-xlsx">
                  <FileSpreadsheet aria-hidden />
                  Excel
                </a>
              </Button>
              <Button asChild size="sm" variant="secondary">
                <a href={printHref} target="_blank" rel="noopener noreferrer" data-testid="km-relatorios-gerencial-pdf">
                  <FileText aria-hidden />
                  PDF
                  <ExternalLink aria-hidden />
                  <span className="sr-only">(abre em nova aba)</span>
                </a>
              </Button>
            </>
          }
        />

        <ReportCard
          testId="km-relatorios-controle"
          icon={<CalendarDays />}
          title="Controle Mensal"
          description="Planner mês/dia em planilha: um veículo por linha, um dia por coluna."
          contents={[
            "KM validado por dia e total do mês por veículo",
            "Dias sem leitura sem valor (não é 0 km)",
            "Mesma competência e filtros do Planner mês/dia",
          ]}
          actions={
            <Button asChild size="sm">
              <a href={exportHref("controle-mensal")} download data-testid="km-relatorios-controle-xlsx">
                <FileSpreadsheet aria-hidden />
                Excel
              </a>
            </Button>
          }
        />

        <ReportCard
          testId="km-relatorios-base"
          icon={<Database />}
          title="Base Consolidada"
          description="Todas as leituras do período, uma linha por veículo e dia, sem limite de linhas."
          contents={[
            "Hodômetros inicial e final, KM informado, calculado e validado",
            "Situação, alertas e indicação de correção manual",
            "Operação, UF, cidade, BR, liderança e origem do contexto",
          ]}
          note="CSV com separador “;” e acentuação compatível com o Excel."
          actions={
            <>
              <Button asChild size="sm">
                <a href={exportHref("base", { format: "xlsx" })} download data-testid="km-relatorios-base-xlsx">
                  <FileSpreadsheet aria-hidden />
                  XLSX
                </a>
              </Button>
              <Button asChild size="sm" variant="secondary">
                <a href={exportHref("base", { format: "csv" })} download data-testid="km-relatorios-base-csv">
                  <FileText aria-hidden />
                  CSV
                </a>
              </Button>
            </>
          }
        />

        <ReportCard
          testId="km-relatorios-rodizio"
          icon={<Repeat />}
          title="Plano de Rodízio"
          description="O arquivo sai de um plano salvo, com as trocas, a prioridade e a situação de cada item."
          contents={[
            "Abra o plano salvo em Plano de rodízio › Planos",
            "Exporte a partir do próprio plano: trocas, prioridade e situação de cada item",
            "Os filtros desta tela não alteram um plano já salvo",
          ]}
          note={perms.rotationView ? undefined : "Seu perfil não tem acesso ao Plano de rodízio."}
          actions={
            perms.rotationView ? (
              <Button asChild size="sm" variant="secondary">
                <a
                  href={rotationHref}
                  onClick={(e) => {
                    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                    e.preventDefault();
                    ctx.navigate({ aba: "rodizio", sub: "planos", item: null, plano: null, lote: null });
                  }}
                  data-testid="km-relatorios-rodizio-link"
                >
                  <Repeat aria-hidden />
                  Abrir planos salvos
                </a>
              </Button>
            ) : null
          }
        />

        <ReportCard
          testId="km-relatorios-qualidade"
          icon={<ClipboardCheck />}
          title="Qualidade de Dados"
          description="Score de qualidade e seus componentes, indicadores, ocorrências e frotas desatualizadas."
          contents={[
            "Score (cobertura, consistência e atualização) e saúde dos hodômetros",
            "Indicadores de leitura e último lote importado",
            "Ocorrências do período e frotas desatualizadas",
          ]}
          note={perms.quality ? undefined : "Seu perfil não tem a Qualidade de dados (km.view_quality)."}
          actions={
            perms.quality ? (
              <Button asChild size="sm">
                <a href={exportHref("qualidade")} download data-testid="km-relatorios-qualidade-xlsx">
                  <FileSpreadsheet aria-hidden />
                  Excel
                </a>
              </Button>
            ) : null
          }
        />
      </div>

      <p className="text-caption text-fg-muted">
        O download começa quando o arquivo fica pronto. Cada arquivo gerado é registrado na auditoria com o tipo, o formato,
        a quantidade de linhas e os filtros usados.
      </p>
    </div>
  );
}
