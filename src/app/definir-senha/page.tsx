import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LOGIN_DOMAIN } from "@/lib/auth/login-identity";
import { SetPasswordView } from "./set-password-view";

export const metadata: Metadata = {
  title: "Definir senha",
  robots: { index: false, follow: false },
};

export default async function SetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Reached only with a valid session created by the e-mail link.
  if (!user) redirect("/login?erro=link-expirado");

  // Quem entra por matrícula tem um endereço técnico que não é de ninguém:
  // a tela não o mostra.
  const technical = user.email?.toLowerCase().endsWith(`@${LOGIN_DOMAIN}`) ?? false;
  return <SetPasswordView email={technical ? null : (user.email ?? null)} />;
}
