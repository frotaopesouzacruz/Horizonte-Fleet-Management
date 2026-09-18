"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_ORG_COOKIE, getSessionContext } from "@/lib/auth/session";

export interface ActionState {
  error?: string;
  notice?: string;
}

/** Absolute origin of the current deployment, for e-mail redirect links. */
export async function siteOrigin() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const proto = headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Sign in with corporate credentials.
 *
 * Failures are reported with one generic message on purpose: telling the caller
 * whether the e-mail exists would turn the form into an account oracle.
 */
export async function signIn(_state: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/dashboard");

  if (!email || !password) return { error: "Informe e-mail e senha." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    if (error.message.toLowerCase().includes("email not confirmed")) {
      return { error: "Conta ainda não ativada. Utilize o link enviado por e-mail para definir sua senha." };
    }
    return { error: "E-mail ou senha inválidos." };
  }

  redirect(next.startsWith("/") ? next : "/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const cookieStore = await cookies();
  cookieStore.delete(ACTIVE_ORG_COOKIE);
  redirect("/login");
}

/** Always answers the same way, whether or not the e-mail has an account. */
export async function requestPasswordReset(_state: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { error: "Informe um e-mail válido." };

  const supabase = await createClient();
  const origin = await siteOrigin();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/confirm?next=/definir-senha`,
  });

  return {
    notice:
      "Se houver uma conta com este e-mail, enviamos um link para definir uma nova senha. Verifique também a caixa de spam.",
  };
}

/** Sets the password of the currently authenticated (invited or recovering) user. */
export async function setPassword(_state: ActionState, formData: FormData): Promise<ActionState> {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("password_confirmation") ?? "");

  if (password.length < 10) return { error: "A senha deve ter ao menos 10 caracteres." };
  if (password !== confirmation) return { error: "As senhas não coincidem." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Link expirado ou inválido. Solicite um novo e-mail de acesso." };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "Não foi possível definir a senha. Tente novamente." };

  redirect("/dashboard");
}

/** Switches the active organization, accepting only the caller's own memberships. */
export async function switchOrganization(organizationId: string) {
  const session = await getSessionContext();
  if (!session) redirect("/login");

  const allowed = session.memberships.some((m) => m.organizationId === organizationId);
  if (!allowed) return;

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}
