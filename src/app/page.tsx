import { redirect } from "next/navigation";
import { PORTAL_HOME } from "@/lib/auth/portal";

/** O Início decide a casa de cada perfil (o Dashboard para quem não tem portal). */
export default function IndexPage() {
  redirect(PORTAL_HOME);
}
