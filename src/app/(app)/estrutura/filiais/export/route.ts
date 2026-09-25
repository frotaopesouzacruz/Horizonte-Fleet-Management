import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database.types";
import { getSessionContext, hasPermission } from "@/lib/auth/session";
import { spreadsheetResponse } from "@/lib/admin/spreadsheet";
import { getBranchOperations, listBranches, type BranchFilters } from "@/lib/branches/queries";
import { formatCnpj, formatPostalCode } from "@/lib/branches/format";
import {
  BRANCH_EXPORT_HEADERS, BRANCH_EXPORT_KINDS, BRANCH_OPERATION_EXPORT_HEADERS, BRANCH_TEMPLATE_HEADERS,
  type BranchExportKind,
} from "@/lib/branches/import-columns";

/** Sem teto de linhas: a leitura vai página a página e o arquivo sai em fluxo. */
export const maxDuration = 60;

/**
 * Exportação de Filiais (Etapa 09, §61).
 *
 * `tipo`: todas | filtradas | selecionadas | operacoes | modelo; `format`:
 * xlsx | csv. As linhas vêm das mesmas views `security_invoker` que a tela
 * usa (`branch_directory`, `branch_operation_directory`), consultadas com o
 * cliente de quem exporta — o arquivo só pode conter o que a pessoa já
 * enxergava, inclusive nos contadores de colaboradores e veículos, que param
 * no escopo de operações dela (§64). Não é uma segunda porta para os dados.
 *
 * Toda exportação passa por `log_branch_export` ANTES do arquivo sair. Se o
 * registro falha, a resposta é 403 e nenhum byte é enviado: sem auditoria não
 * há exportação (§65).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

const blank = (value: string | null | undefined): string => value ?? "";


export async function GET(request: NextRequest) {
  return exportBranches(request.nextUrl.searchParams);
}

/**
 * A seleção vai no corpo, não na URL: um endereço tem tamanho máximo, uma
 * seleção de filiais não tem. Só aceita envio da própria aplicação.
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) {
    return NextResponse.json({ error: "Origem não permitida." }, { status: 403 });
  }
  const form = await request.formData();
  const params = new URLSearchParams();
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") params.append(key, value);
  }
  return exportBranches(params);
}

async function exportBranches(params: URLSearchParams) {
  const session = await getSessionContext();
  if (!session?.activeOrganization) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }
  const organizationId = session.activeOrganization.organizationId;
  const requested = params.get("tipo") ?? "todas";
  if (!BRANCH_EXPORT_KINDS.includes(requested as BranchExportKind)) {
    return NextResponse.json({ error: "Tipo de exportação inválido." }, { status: 400 });
  }
  const kind = requested as BranchExportKind;
  const format: "xlsx" | "csv" = params.get("format") === "csv" ? "csv" : "xlsx";

  const allowed =
    kind === "modelo"
      ? hasPermission(session, "branches.import") || hasPermission(session, "branches.export")
      : hasPermission(session, "branches.export");
  if (!allowed) {
    return NextResponse.json({ error: "Você não possui permissão para exportar filiais." }, { status: 403 });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  let headers: string[];
  let data: (string | number | null)[][];
  let sheetName: string;
  let fileName: string;
  let details: { [key: string]: Json } = {};

  if (kind === "modelo") {
    headers = BRANCH_TEMPLATE_HEADERS;
    data = [];
    sheetName = "Filiais";
    fileName = `modelo-importacao-filiais.${format}`;
  } else if (kind === "operacoes") {
    // A relação inteira, com o histórico: vínculos encerrados continuam sendo
    // fato (§27). Operações fora do escopo de quem exporta não aparecem — a
    // view faz join com `operations`, cuja RLS aplica o escopo.
    const [branches, links] = await Promise.all([
      listBranches(organizationId),
      getBranchOperations(organizationId),
    ]);
    const byId = new Map(branches.map((b) => [b.id, b]));
    const visible = links.filter((l) => byId.has(l.organizationUnitId));
    visible.sort((a, b) => {
      const ba = byId.get(a.organizationUnitId)!;
      const bb = byId.get(b.organizationUnitId)!;
      return (ba.code ?? "").localeCompare(bb.code ?? "", "pt-BR", { numeric: true })
        || a.operationName.localeCompare(b.operationName, "pt-BR")
        || a.effectiveFrom.localeCompare(b.effectiveFrom);
    });
    headers = BRANCH_OPERATION_EXPORT_HEADERS;
    data = visible.map((l) => {
      const b = byId.get(l.organizationUnitId)!;
      return [
        blank(b.code), b.name, b.status === "active" ? "Ativa" : "Inativa",
        blank(l.operationCode), l.operationName, l.operationStatus === "active" ? "Ativa" : "Inativa",
        formatDate(l.effectiveFrom), formatDate(l.effectiveTo), l.isCurrent ? "Sim" : "Não", l.vehicleCount,
      ];
    });
    sheetName = "Filiais x Operações";
    fileName = `filiais-operacoes-${stamp}.${format}`;
  } else {
    const filters: BranchFilters =
      kind === "filtradas"
        ? {
            q: params.get("q") ?? undefined,
            status: params.get("situacao") ?? undefined,
            operationId: params.get("operacao") ?? undefined,
            stateId: params.get("uf") ?? undefined,
            cityId: params.get("cidade") ?? undefined,
            withVehicles: params.get("frota") ?? undefined,
            withEmployees: params.get("colaboradores") ?? undefined,
          }
        : {};

    let branches = await listBranches(organizationId, filters);

    if (kind === "selecionadas") {
      const ids = (params.get("ids") ?? "").split(",").map((s) => s.trim()).filter((s) => UUID.test(s));
      if (ids.length === 0) {
        return NextResponse.json({ error: "Selecione ao menos uma filial." }, { status: 400 });
      }
      // Um id que a pessoa não enxerga simplesmente não está na lista — a
      // seleção nunca amplia o que a RLS já devolveu.
      const wanted = new Set(ids.map((id) => id.toLowerCase()));
      branches = branches.filter((b) => wanted.has(b.id.toLowerCase()));
      details = { selected: ids.length, found: branches.length };
    } else if (kind === "filtradas") {
      details = {
        filters: Object.fromEntries(
          Object.entries(filters).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== ""),
        ),
      };
    }

    const links = await getBranchOperations(organizationId);
    const current = new Map<string, string[]>();
    for (const l of links) {
      if (!l.isCurrent) continue;
      const names = current.get(l.organizationUnitId) ?? [];
      names.push(l.operationName);
      current.set(l.organizationUnitId, names);
    }

    headers = BRANCH_EXPORT_HEADERS;
    data = branches.map((b) => [
      blank(b.code), b.name, blank(b.legalName),
      b.documentNumber ? formatCnpj(b.documentNumber) : "",
      b.status === "active" ? "Ativa" : "Inativa",
      b.postalCode ? formatPostalCode(b.postalCode) : "",
      blank(b.stateUf), blank(b.cityName), blank(b.street), blank(b.streetNumber),
      blank(b.complement), blank(b.district),
      (current.get(b.id) ?? []).sort((x, y) => x.localeCompare(y, "pt-BR")).join("; "),
      blank(b.notes),
      b.employeeCount, b.vehicleCount, b.costCenterCount, formatDate(b.updatedAt),
    ]);
    sheetName = "Filiais";
    fileName = `filiais-${kind}-${stamp}.${format}`;
  }

  const supabase = await createClient();
  const { data: auditId, error: auditError } = await supabase.rpc("log_branch_export", {
    p_organization_id: organizationId,
    p_format: format,
    p_row_count: data.length,
    p_kind: kind,
    p_details: details,
  });
  // Sem registro não há exportação: a auditoria é parte do contrato, não um extra.
  if (auditError || !auditId) {
    return NextResponse.json(
      { error: "Não foi possível registrar a exportação na auditoria; nenhum arquivo foi gerado." },
      { status: 403 },
    );
  }

  return spreadsheetResponse({ format, fileName, sheetName, headers, rows: data });
}
