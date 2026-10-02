import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireOrganization } from "@/lib/auth/session";
import { getKmFilterOptions } from "@/lib/km/options";
import { kmFiltersQuery, parseKmFilters, type SearchParamsLike } from "@/lib/km/url";
import { ErrorState } from "@/components/feedback/error-state";
import { kmFilterSummary, kmResolvedPeriodLabel } from "./filter-summary";
import { REPORT_TITLE } from "./labels";
import { loadManagementReport } from "./report-data";
import { ReportDocument } from "./report-document";
import { PrintButton } from "./print-button";
import { logKmExport, stampText } from "./export-log";

export const metadata: Metadata = {
  title: REPORT_TITLE,
  description: "Versão imprimível do Relatório Gerencial de KM Rodado, com os filtros da tela.",
};

/**
 * Gestão de KM → Relatório Gerencial, versão para PDF.
 *
 * Mesmos dados da planilha (`km_overview` + `km_analysis`, filtros da URL,
 * cliente da própria pessoa). Abrir a página é exportar: o registro em
 * `log_km_export` vem antes do conteúdo; sem registro, não há relatório.
 */
const PRINT_CSS = `
@page { size: A4 portrait; margin: 12mm 10mm; }
@media print {
  html, body { background: var(--surface-raised) !important; }
  body aside, div:has(> #main) > header, [data-km-print-hide] { display: none !important; }
  div:has(> #main) { padding-left: 0 !important; min-height: 0 !important; }
  #main > * { padding: 0 !important; max-width: none !important; }
  [data-km-report] { max-width: none !important; margin: 0 !important; padding: 0 !important; border: 0 !important; box-shadow: none !important; border-radius: 0 !important; }
  [data-km-report] thead { display: table-header-group; }
  [data-km-report] tr { break-inside: avoid; }
  [data-km-report] * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

export default async function KmReportPage({ searchParams }: { searchParams: Promise<SearchParamsLike> }) {
  const params = await searchParams;
  const { session, organization } = await requireOrganization("km.export");
  const orgId = organization.organizationId;
  const filters = parseKmFilters(params);
  const query = kmFiltersQuery(filters, { aba: "relatorios" });
  const backHref = `/frota/km?${query}`;

  const [report, options] = await Promise.all([
    loadManagementReport(orgId, filters),
    getKmFilterOptions(orgId).catch(() => null),
  ]);

  let failure: string | null = null;
  if (!report.overview && !report.analysis) {
    failure = report.errors.join(" · ") || "Não foi possível ler os dados do relatório gerencial.";
  } else {
    const rowCount = report.analysis ? report.analysis.vehicles.length : (report.overview?.kpis.vehicles ?? 0);
    const auditError = await logKmExport(orgId, "gerencial", "pdf", rowCount, report.payload);
    if (auditError) failure = "Não foi possível registrar a exportação na auditoria. O relatório não foi gerado.";
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:px-6 sm:py-5">
      <style>{PRINT_CSS}</style>
      <div
        data-km-print-hide
        className="mx-auto flex w-full max-w-[210mm] flex-wrap items-center justify-between gap-2"
        data-testid="km-relatorio-toolbar"
      >
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 rounded-sm text-body-sm font-medium text-fg-secondary hover:text-fg hfm-focus-ring"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Voltar à Gestão de KM
        </Link>
        {failure ? null : <PrintButton />}
      </div>

      {failure ? (
        <div className="mx-auto w-full max-w-[210mm]">
          <ErrorState title="Relatório indisponível" description={failure} data-testid="km-relatorio-error" />
        </div>
      ) : (
        <ReportDocument
          report={report}
          periodText={kmResolvedPeriodLabel(report.period)}
          filters={kmFilterSummary(filters, options)}
          generatedAt={stampText(new Date())}
          responsible={session.displayName}
          organizationName={organization.organizationName}
        />
      )}
    </div>
  );
}
