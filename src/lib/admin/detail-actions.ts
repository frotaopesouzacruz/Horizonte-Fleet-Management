"use server";

import { requireOrganization } from "@/lib/auth/session";
import { getEmployeeDetail, getEmployeeHistory, type EmployeeDetail } from "./queries";

export interface EmployeeDetailPayload extends EmployeeDetail {
  history: Awaited<ReturnType<typeof getEmployeeHistory>>;
}

/** Loads one employee for the detail drawer, re-checking the permission server-side. */
export async function loadEmployeeDetail(employeeId: string): Promise<EmployeeDetailPayload | null> {
  const { organization } = await requireOrganization("users.view");

  const detail = await getEmployeeDetail(organization.organizationId, employeeId);
  if (!detail) return null;

  const history = detail.permissions.includes("users.audit_view")
    ? await getEmployeeHistory(organization.organizationId, employeeId)
    : [];

  return { ...detail, history };
}
