import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext, hasPermission } from "@/lib/auth/session";
import { listEmployeesForExport, type DirectoryFilters, type SortKey } from "@/lib/admin/queries";
import { buildWorkbook, buildCsv } from "@/lib/admin/spreadsheet";
import { EMPLOYMENT_STATUS_LABELS, ACCESS_STATUS_LABELS, QLP_TEMPLATE_HEADERS } from "@/lib/admin/qlp";

/** Column sets. "QLP" reproduces the 19 columns of the source file exactly. */
const HFM_HEADERS = [
  "Matrícula", "Nome", "Situação", "Admissão", "Cargo", "Código do cargo", "Área", "Operação",
  "Perfil organizacional", "Localidade", "Filial", "Líder imediato", "E-mail corporativo",
  "Acesso HFM", "Perfis de acesso", "Operações permitidas", "CNH categoria", "CNH validade",
];

const SENSITIVE_HEADERS = ["CPF", "Data de nascimento", "CNH número", "CNH 1ª habilitação", "CNH pontuação"];

function formatDate(value: string | null): string {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

/**
 * Exports the current list.
 *
 * Restricted columns are opt-in, gated by users.export_sensitive, and fetched
 * separately: without the permission the query simply returns nothing, so the
 * file cannot leak what the caller may not read. Every export is audited.
 */
export async function GET(request: NextRequest) {
  const session = await getSessionContext();
  if (!session?.activeOrganization) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }
  if (!hasPermission(session, "users.export")) {
    return NextResponse.json({ error: "Sem permissão para exportar." }, { status: 403 });
  }

  const organizationId = session.activeOrganization.organizationId;
  const params = request.nextUrl.searchParams;
  const format = params.get("format") === "csv" ? "csv" : "xlsx";
  const layout = params.get("layout") === "qlp" ? "qlp" : params.get("layout") === "template" ? "template" : "hfm";
  const wantsSensitive = params.get("sensitive") === "1";

  if (wantsSensitive && !hasPermission(session, "users.export_sensitive")) {
    return NextResponse.json({ error: "Sem permissão para exportar dados sensíveis." }, { status: 403 });
  }

  // Empty file with the supported columns: the import template.
  if (layout === "template") {
    const buffer =
      format === "csv"
        ? buildCsv(QLP_TEMPLATE_HEADERS, [])
        : await buildWorkbook("QLP", QLP_TEMPLATE_HEADERS, []);
    return fileResponse(buffer, `modelo-importacao-usuarios.${format}`, format);
  }

  const filters: DirectoryFilters = {
    q: params.get("q") ?? undefined,
    status: params.get("status") ?? undefined,
    area: params.get("area") ?? undefined,
    operation: params.get("operation") ?? undefined,
    profile: params.get("profile") ?? undefined,
    location: params.get("location") ?? undefined,
    unit: params.get("unit") ?? undefined,
    manager: params.get("manager") ?? undefined,
    access: params.get("access") ?? undefined,
    archived: params.get("archived") === "1",
    sort: (params.get("sort") as SortKey | null) ?? undefined,
    dir: params.get("dir") === "desc" ? "desc" : "asc",
  };

  const rows = await listEmployeesForExport(organizationId, filters);

  // Restricted values live in their own table behind their own policy.
  const sensitiveById = new Map<string, { cpf: string | null; birth_date: string | null }>();
  const licenseById = new Map<string, { license_number: string | null; first_license_date: string | null; points: number | null }>();

  if (wantsSensitive && rows.length) {
    const supabase = await createClient();
    const ids = rows.map((r) => r.id).filter((id): id is string => Boolean(id));

    for (let i = 0; i < ids.length; i += 500) {
      const slice = ids.slice(i, i + 500);
      const [priv, lic] = await Promise.all([
        supabase.from("employee_private_data").select("employee_id, cpf, birth_date").in("employee_id", slice),
        supabase
          .from("driver_licenses")
          .select("employee_id, license_number, first_license_date, points")
          .in("employee_id", slice)
          .is("deleted_at", null),
      ]);
      for (const row of priv.data ?? []) sensitiveById.set(row.employee_id, row);
      for (const row of lic.data ?? []) licenseById.set(row.employee_id, row);
    }
  }

  const headers =
    layout === "qlp"
      ? QLP_TEMPLATE_HEADERS
      : wantsSensitive
        ? [...HFM_HEADERS, ...SENSITIVE_HEADERS]
        : HFM_HEADERS;

  const data = rows.map((row) => {
    const priv = sensitiveById.get(row.id ?? "");
    const lic = licenseById.get(row.id ?? "");

    if (layout === "qlp") {
      return [
        row.full_name ?? "",
        row.employee_code ?? "",
        wantsSensitive ? (priv?.cpf ?? "") : "",
        EMPLOYMENT_STATUS_LABELS[row.employment_status ?? ""] ?? row.employment_status ?? "",
        formatDate(row.admission_date),
        row.job_position_code ? `${row.job_position_code} - ${row.job_position_name ?? ""}` : (row.job_position_name ?? ""),
        row.employment_area_name ?? "",
        row.operation_name ?? "",
        row.business_profile_name ?? "",
        row.work_location_name ?? "",
        row.organization_unit_code
          ? `${row.organization_unit_code} - ${row.organization_unit_name ?? ""}`
          : (row.organization_unit_name ?? ""),
        row.manager_name ?? "",
        row.corporate_email ?? "",
        row.license_category ?? "",
        wantsSensitive ? (lic?.license_number ?? "") : "",
        formatDate(row.license_expiration_date),
        wantsSensitive ? formatDate(lic?.first_license_date ?? null) : "",
        wantsSensitive ? (lic?.points ?? "") : "",
        wantsSensitive ? formatDate(priv?.birth_date ?? null) : "",
      ];
    }

    const base = [
      row.employee_code ?? "",
      row.full_name ?? "",
      EMPLOYMENT_STATUS_LABELS[row.employment_status ?? ""] ?? row.employment_status ?? "",
      formatDate(row.admission_date),
      row.job_position_name ?? "",
      row.job_position_code ?? "",
      row.employment_area_name ?? "",
      row.operation_name ?? "",
      row.business_profile_name ?? "",
      row.work_location_name ?? "",
      row.organization_unit_name ?? "",
      row.manager_name ?? "",
      row.corporate_email ?? "",
      ACCESS_STATUS_LABELS[row.access_status ?? "none"] ?? row.access_status ?? "",
      (row.access_role_names ?? []).join(", "),
      row.access_all_operations ? "Todas" : String(row.access_operation_count ?? 0),
      row.license_category ?? "",
      formatDate(row.license_expiration_date),
    ];

    return wantsSensitive
      ? [
          ...base,
          priv?.cpf ?? "",
          formatDate(priv?.birth_date ?? null),
          lic?.license_number ?? "",
          formatDate(lic?.first_license_date ?? null),
          lic?.points ?? "",
        ]
      : base;
  });

  const supabase = await createClient();
  await supabase.rpc("log_user_export", {
    p_organization_id: organizationId,
    p_format: `${layout}:${format}`,
    p_row_count: rows.length,
    p_with_sensitive: wantsSensitive,
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const name = `usuarios-${layout}-${stamp}.${format}`;
  const buffer =
    format === "csv" ? buildCsv(headers, data) : await buildWorkbook("Usuários", headers, data);

  return fileResponse(buffer, name, format);
}

function fileResponse(buffer: Buffer, fileName: string, format: "csv" | "xlsx") {
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type":
        format === "csv"
          ? "text/csv; charset=utf-8"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${fileName}"`,
      "cache-control": "no-store",
    },
  });
}
