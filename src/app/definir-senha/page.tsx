import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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

  return <SetPasswordView email={user.email ?? null} />;
}
