import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext, hasPermission } from "@/lib/auth/session";
import { listAccessProfiles, getPermissionMatrix } from "@/lib/admin/access-profiles";
import { buildWorkbook, buildCsv } from "@/lib/admin/spreadsheet";

/**
 * Exports the permission matrix.
 *
 * One row per permission, one column per official profile, plus the official
 * default alongside what this organization actually grants — the two questions
 * an auditor asks are "who can do this" and "is that the standard", and a file
 * that answers only the first sends them back to the screen.
 *
 * `roles.view` is enough: this describes profiles, not people. It is read
 * through the caller's own RLS, so a profile they cannot see is a profile the
 * file does not contain.
 */
export async function GET(request: NextRequest) {
  const session = await getSessionContext();
  if (!session?.activeOrganization) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }
  if (!hasPermission(session, "roles.view")) {
    return NextResponse.json({ error: "Sem permissão para exportar a matriz." }, { status: 403 });
  }

  const organizationId = session.activeOrganization.organizationId;
  const format = request.nextUrl.searchParams.get("format") === "csv" ? "csv" : "xlsx";

  const [profiles, matrix] = await Promise.all([
    listAccessProfiles(organizationId),
    getPermissionMatrix(organizationId),
  ]);

  const headers = [
    "Módulo",
    "Recurso",
    "Permissão",
    "Código",
    "Reservada ao Administrador",
    ...profiles.map((profile) => profile.name),
    "Padrão oficial",
  ];

  const rows = matrix.map((permission) => [
    permission.module,
    permission.code.split(".")[0] ?? "",
    permission.name,
    permission.code,
    permission.reserved ? "Sim" : "Não",
    ...profiles.map((profile) => {
      const granted = permission.grantedCodes.includes(profile.code);
      const isDefault = permission.defaultCodes.includes(profile.code);
      if (granted && isDefault) return "Sim";
      if (granted) return "Sim (fora do padrão)";
      if (isDefault) return "Não (removida do padrão)";
      return "Não";
    }),
    permission.defaultCodes.join(", "),
  ]);

  const stamp = new Date().toISOString().slice(0, 10);
  const fileName = `hfm-matriz-permissoes-${stamp}.${format}`;

  const body =
    format === "csv"
      ? buildCsv(headers, rows)
      : await buildWorkbook("Matriz de permissões", headers, rows);

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type":
        format === "csv"
          ? "text/csv; charset=utf-8"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
