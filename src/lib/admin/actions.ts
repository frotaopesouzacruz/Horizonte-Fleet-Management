"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, canProvisionAccess } from "@/lib/supabase/admin";
import { requireOrganization } from "@/lib/auth/session";
import { siteOrigin } from "@/lib/auth/actions";
import { loginEmailForCode } from "@/lib/auth/login-identity";

const MODULE_PATH = "/administracao/usuarios";
const PROFILES_PATH = "/administracao/perfis";

export interface Result<T = undefined> {
  ok: boolean;
  error?: string;
  warning?: string;
  data?: T;
}

/**
 * Database errors are written for engineers. The ones we raise ourselves are
 * written for the person using the product, so those pass through unchanged and
 * everything else becomes one honest sentence.
 */
function toMessage(error: { message?: string; code?: string } | null, fallback: string): string {
  const message = error?.message ?? "";
  if (!message) return fallback;
  if (/^[A-ZÀ-Ú]/.test(message) && !message.includes("violates") && !message.includes("relation")) return message;
  if (error?.code === "42501" || message.includes("insufficient_privilege") || message.includes("permission")) {
    return "Você não possui permissão para esta ação.";
  }
  if (error?.code === "23505") return "Já existe um registro com estes dados.";
  return fallback;
}

function optional(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

/* -------------------------------------------------------------------------- */
/* Employee record                                                            */
/* -------------------------------------------------------------------------- */

export async function saveEmployee(formData: FormData): Promise<Result<{ id: string }>> {
  const id = optional(formData, "id");
  const { organization } = await requireOrganization(id ? "users.update" : "users.create");
  const supabase = await createClient();

  const payload = {
    id,
    employee_code: optional(formData, "employee_code"),
    full_name: optional(formData, "full_name"),
    corporate_email: optional(formData, "corporate_email")?.toLowerCase() ?? null,
    employment_status: optional(formData, "employment_status") ?? "active",
    admission_date: optional(formData, "admission_date"),
    termination_date: optional(formData, "termination_date"),
    notes: optional(formData, "notes"),
    private: {
      cpf: optional(formData, "cpf"),
      birth_date: optional(formData, "birth_date"),
    },
    assignment: {
      job_position_id: optional(formData, "job_position_id"),
      employment_area_id: optional(formData, "employment_area_id"),
      operation_id: optional(formData, "operation_id"),
      organization_unit_id: optional(formData, "organization_unit_id"),
      work_location_id: optional(formData, "work_location_id"),
      business_profile_id: optional(formData, "business_profile_id"),
      manager_employee_id: optional(formData, "manager_employee_id"),
    },
    license: optional(formData, "license_category")
      ? {
          category: optional(formData, "license_category"),
          license_number: optional(formData, "license_number"),
          expiration_date: optional(formData, "license_expiration_date"),
          first_license_date: optional(formData, "license_first_date"),
          points: optional(formData, "license_points"),
        }
      : null,
  };

  if (!payload.employee_code) return { ok: false, error: "Informe a matrícula." };
  if (!payload.full_name) return { ok: false, error: "Informe o nome completo." };

  const { data, error } = await supabase.rpc("save_employee", {
    p_organization_id: organization.organizationId,
    p_payload: payload,
  });

  if (error) return { ok: false, error: toMessage(error, "Não foi possível salvar o colaborador.") };

  revalidatePath(MODULE_PATH);
  return { ok: true, data: { id: data as string } };
}

export async function archiveEmployee(employeeId: string, suspendAccess: boolean): Promise<Result> {
  await requireOrganization("users.archive");
  const supabase = await createClient();

  const { error } = await supabase.rpc("archive_employee", {
    p_employee_id: employeeId,
    p_suspend_access: suspendAccess,
  });
  if (error) return { ok: false, error: toMessage(error, "Não foi possível inativar o colaborador.") };

  revalidatePath(MODULE_PATH);
  return { ok: true };
}

export async function restoreEmployee(employeeId: string): Promise<Result> {
  await requireOrganization("users.archive");
  const supabase = await createClient();

  const { error } = await supabase.rpc("restore_employee", { p_employee_id: employeeId });
  if (error) return { ok: false, error: toMessage(error, "Não foi possível reativar o colaborador.") };

  revalidatePath(MODULE_PATH);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* HFM access                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Finds or creates the auth user for an address.
 *
 * The administrator never sees or chooses a password. With a service-role key
 * the Admin API sends a proper invitation; without one the account is created
 * with a random secret nobody holds and the person sets their own through the
 * recovery e-mail. Either way the password only ever exists inside Supabase Auth.
 */
async function ensureAuthUser(email: string, fullName: string): Promise<{ userId: string; invited: boolean; warning?: string }> {
  const origin = await siteOrigin();
  const redirectTo = `${origin}/auth/confirm?next=/definir-senha`;

  if (canProvisionAccess()) {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { full_name: fullName },
    });

    if (!error && data.user) return { userId: data.user.id, invited: true };

    // Already registered: reuse the account instead of failing the grant.
    const existing = await findUserByEmail(email);
    if (existing) return { userId: existing, invited: false };
    throw new Error(error?.message ?? "Não foi possível criar a conta de acesso.");
  }

  // No Admin API in this environment. Sign the account up with a secret that is
  // generated, used once and discarded, then send the e-mail that lets the
  // person choose their own.
  const supabase = await createClient();
  const secret = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  const { data, error } = await supabase.auth.signUp({
    email,
    password: secret,
    options: { emailRedirectTo: redirectTo, data: { full_name: fullName } },
  });

  if (error || !data.user) {
    throw new Error(
      "Não foi possível criar a conta de acesso. Configure SUPABASE_SERVICE_ROLE_KEY para habilitar o convite pela API de administração.",
    );
  }

  await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  return {
    userId: data.user.id,
    invited: true,
    warning:
      "Conta criada sem a API de administração: o colaborador receberá um e-mail de definição de senha. Configure SUPABASE_SERVICE_ROLE_KEY para usar o convite oficial.",
  };
}

async function findUserByEmail(email: string): Promise<string | null> {
  if (!canProvisionAccess()) return null;
  const admin = createAdminClient();
  // listUsers has no server-side e-mail filter; the first pages are enough for
  // the "invite hit an existing account" case.
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data.users.length) return null;
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

/**
 * Creates the account of someone who signs in with the matrícula.
 *
 * There is no mailbox to invite, so the account is created already confirmed,
 * with the initial password the database derived from the CPF (its first six
 * digits). The password is never logged or returned to the browser: the
 * administrator already knows the rule and the person changes it after signing
 * in. If the address already has an account (a grant that was removed and is
 * being given again), that account is reused and its password set back to the
 * initial one.
 */
async function ensureEmployeeCodeUser(
  employeeCode: string,
  fullName: string,
  initialPassword: string | null,
): Promise<{ userId: string; warning?: string }> {
  const email = loginEmailForCode(employeeCode);
  if (!email) {
    throw new Error(
      "A matrícula contém caracteres que não formam um login (use só letras e números). Corrija a matrícula antes de conceder o acesso.",
    );
  }
  if (!initialPassword) {
    throw new Error("Não foi possível obter a senha inicial (6 primeiros dígitos do CPF). Verifique o CPF do colaborador.");
  }
  if (!canProvisionAccess()) {
    throw new Error(
      "O acesso por matrícula precisa da API de administração do Supabase. Configure SUPABASE_SERVICE_ROLE_KEY neste ambiente.",
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: initialPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName, employee_code: employeeCode, login_method: "employee_code" },
  });
  if (!error && data.user) return { userId: data.user.id };

  if (error && isAlreadyRegistered(error)) {
    const existing = await findUserByEmail(email);
    if (existing) {
      const reset = await admin.auth.admin.updateUserById(existing, { password: initialPassword, email_confirm: true });
      if (reset.error) throw new Error(describeAuthError(reset.error, "A conta já existia e a senha inicial não pôde ser redefinida."));
      return {
        userId: existing,
        warning: "A conta de login já existia: a senha voltou a ser a inicial (6 primeiros dígitos do CPF).",
      };
    }
  }
  throw new Error(describeAuthError(error, "Não foi possível criar a conta de acesso."));
}

function isAlreadyRegistered(error: { code?: string; message: string }): boolean {
  return error.code === "email_exists" || /already (been )?registered|already exists/i.test(error.message);
}

/**
 * Auth API errors are in English and about policy. The one an administrator
 * can actually run into here is the password policy refusing six digits, and
 * that one needs to say what to change.
 */
function describeAuthError(error: { code?: string; message: string } | null, fallback: string): string {
  const message = error?.message ?? "";
  if (/password/i.test(message) && /(weak|short|at least|characters|requirement|strength|length)/i.test(message)) {
    return "A política de senhas do Supabase Auth não aceita os 6 dígitos do CPF como senha inicial (mínimo de caracteres ou complexidade). Ajuste a política em Authentication › Settings ou conceda o acesso por e-mail.";
  }
  return message ? `${fallback} (${message})` : fallback;
}

export async function grantAccess(
  employeeId: string,
  roleIds: string[],
  operationIds: string[],
): Promise<Result> {
  await requireOrganization("users.manage_access");
  const supabase = await createClient();

  // Everything that can be validated before an account exists is validated
  // first, so provisioning cannot leave an auth user without a membership. The
  // answer also says how this person signs in: by e-mail (invitation) or by
  // matrícula (no e-mail; the initial password comes from the CPF).
  const { data: prepared, error: prepareError } = await supabase
    .rpc("prepare_employee_access_v2", {
      p_employee_id: employeeId,
      p_role_ids: roleIds,
      p_operation_ids: operationIds,
    })
    .maybeSingle();

  if (prepareError) return { ok: false, error: toMessage(prepareError, "Não foi possível validar a concessão de acesso.") };
  if (!prepared) return { ok: false, error: "Não foi possível validar a concessão de acesso." };

  const byCode = prepared.login_method === "employee_code";
  if (!byCode && !prepared.email) return { ok: false, error: "Este colaborador não possui e-mail corporativo." };

  let userId = prepared.account_user_id;
  let warning: string | undefined;

  if (!userId) {
    try {
      const created = byCode
        ? await ensureEmployeeCodeUser(prepared.employee_code, prepared.full_name, prepared.initial_password)
        : await ensureAuthUser(prepared.email, prepared.email.split("@")[0]);
      userId = created.userId;
      warning = created.warning;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Não foi possível criar a conta de acesso." };
    }
  }

  const { error } = await supabase.rpc("grant_employee_access_v2", {
    p_employee_id: employeeId,
    p_user_id: userId,
    p_role_ids: roleIds,
    p_operation_ids: operationIds,
  });

  if (error) return { ok: false, error: toMessage(error, "Não foi possível conceder o acesso.") };

  revalidatePath(MODULE_PATH);
  return { ok: true, warning };
}

export async function resendInvite(employeeId: string): Promise<Result> {
  await requireOrganization("users.invite");
  const supabase = await createClient();

  const { data } = await supabase
    .from("employee_directory")
    .select("corporate_email, access_status, login_method")
    .eq("id", employeeId)
    .maybeSingle();

  if (data?.login_method === "employee_code") {
    return { ok: false, error: "Este colaborador entra por matrícula: não há convite por e-mail. Use “Redefinir senha inicial”." };
  }
  if (!data?.corporate_email) return { ok: false, error: "Este colaborador não possui e-mail corporativo." };

  const origin = await siteOrigin();
  const { error } = await supabase.auth.resetPasswordForEmail(data.corporate_email, {
    redirectTo: `${origin}/auth/confirm?next=/definir-senha`,
  });
  if (error) return { ok: false, error: "Não foi possível reenviar o convite." };

  return { ok: true };
}

/**
 * Puts the password of a matrícula account back to the initial one.
 *
 * Someone who signs in with the matrícula has no mailbox for a recovery link,
 * so this is how a forgotten password is recovered: the manager asks for it
 * here, the database records who asked (`user.initial_password_issued`) and
 * the Auth Admin API applies the first six digits of the CPF again. Nothing is
 * shown or sent; the person signs in and changes it.
 */
export async function resetEmployeeCodePassword(employeeId: string): Promise<Result> {
  await requireOrganization("users.manage_access");
  if (!canProvisionAccess()) {
    return {
      ok: false,
      error: "A redefinição precisa da API de administração do Supabase. Configure SUPABASE_SERVICE_ROLE_KEY neste ambiente.",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("employee_code_initial_password", { p_employee_id: employeeId }).maybeSingle();
  if (error) return { ok: false, error: toMessage(error, "Não foi possível redefinir a senha inicial.") };
  if (!data?.account_user_id || !data.initial_password) return { ok: false, error: "Não foi possível redefinir a senha inicial." };

  const admin = createAdminClient();
  const { error: authError } = await admin.auth.admin.updateUserById(data.account_user_id, {
    password: data.initial_password,
    email_confirm: true,
  });
  if (authError) return { ok: false, error: describeAuthError(authError, "A senha inicial não pôde ser aplicada.") };

  revalidatePath(MODULE_PATH);
  return { ok: true };
}

export async function setAccessStatus(employeeId: string, status: "active" | "suspended" | "removed"): Promise<Result> {
  await requireOrganization("users.manage_access");
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_employee_access_status", {
    p_employee_id: employeeId,
    p_status: status,
  });
  if (error) return { ok: false, error: toMessage(error, "Não foi possível alterar o status de acesso.") };

  revalidatePath(MODULE_PATH);
  return { ok: true };
}

/**
 * Changes the HFM access profile of one account.
 *
 * The reason is not decoration: a profile change is the single most consequential
 * edit in the product, and the database refuses the call without one. Nothing
 * else in the system may reach `membership_roles` — not an import, not an
 * integration, not a direct write — so this function and its sibling in the
 * Perfis screen are the whole of it.
 */
export async function setRoles(membershipId: string, roleIds: string[], reason: string): Promise<Result> {
  await requireOrganization("users.manage_roles");
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_membership_roles", {
    p_membership_id: membershipId,
    p_role_ids: roleIds,
    p_reason: reason,
  });
  if (error) return { ok: false, error: toMessage(error, "Não foi possível alterar o perfil de acesso.") };

  revalidatePath(MODULE_PATH);
  revalidatePath(PROFILES_PATH);
  return { ok: true };
}

export async function setOperationScopes(membershipId: string, operationIds: string[]): Promise<Result> {
  await requireOrganization("users.manage_operation_scope");
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_membership_operation_scopes", {
    p_membership_id: membershipId,
    p_operation_ids: operationIds,
  });
  if (error) return { ok: false, error: toMessage(error, "Não foi possível alterar as operações permitidas.") };

  revalidatePath(MODULE_PATH);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Bulk actions                                                               */
/* -------------------------------------------------------------------------- */

/**
 * What a bulk access change did to each selected person, as the database
 * classified them. Only `applied` changed; every other count stayed as it was,
 * for the reason its name gives.
 */
export interface BulkAccessOutcome {
  applied: number;
  already: number;
  noAccount: number;
  self: number;
  removed: number;
  invited: number;
  archived: number;
  notFound: number;
  blocked: number;
  changed: number;
}

/**
 * Suspends or reactivates HFM access for a selection in one database call.
 *
 * The database decides who can change (only accounts in the right state) and
 * reports everyone else by reason, so "nobody had an account" reads as an
 * explanation, not as a failure.
 */
export async function bulkSetAccessStatus(
  employeeIds: string[],
  status: "active" | "suspended",
): Promise<Result<BulkAccessOutcome>> {
  const { organization } = await requireOrganization("users.bulk_manage");
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("bulk_set_employee_access_status", {
    p_organization_id: organization.organizationId,
    p_employee_ids: employeeIds,
    p_status: status,
  });
  if (error) return { ok: false, error: toMessage(error, "Não foi possível alterar o acesso dos colaboradores selecionados.") };

  const counts = (data ?? {}) as Record<string, unknown>;
  const count = (key: string) => Number(counts[key] ?? 0) || 0;

  revalidatePath(MODULE_PATH);
  return {
    ok: true,
    data: {
      applied: count("applied"),
      already: count("already"),
      noAccount: count("no_account"),
      self: count("self"),
      removed: count("removed"),
      invited: count("invited"),
      archived: count("archived"),
      notFound: count("not_found"),
      blocked: count("blocked"),
      changed: count("changed"),
    },
  };
}

export async function bulkArchive(employeeIds: string[], suspendAccess: boolean): Promise<Result<{ applied: number; failed: number }>> {
  await requireOrganization("users.bulk_manage");
  const supabase = await createClient();

  let applied = 0;
  let failed = 0;
  for (const employeeId of employeeIds) {
    const { error } = await supabase.rpc("archive_employee", {
      p_employee_id: employeeId,
      p_suspend_access: suspendAccess,
    });
    if (error) failed++;
    else applied++;
  }

  revalidatePath(MODULE_PATH);
  return { ok: failed === 0, data: { applied, failed }, error: failed ? `${failed} registro(s) não puderam ser inativados.` : undefined };
}
