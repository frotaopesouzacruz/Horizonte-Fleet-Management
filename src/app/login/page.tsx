import type { Metadata } from "next";
import { LoginView } from "./login-view";

export const metadata: Metadata = {
  title: "Acessar",
  description: "Acesso à plataforma Horizonte Fleet Management.",
};

const LINK_ERRORS: Record<string, string> = {
  "link-invalido": "O link utilizado não é válido. Solicite um novo e-mail de acesso.",
  "link-expirado": "O link expirou ou já foi utilizado. Solicite um novo e-mail de acesso.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; erro?: string }>;
}) {
  const params = await searchParams;
  const next = params.next && params.next.startsWith("/") ? params.next : undefined;
  return <LoginView next={next} linkError={params.erro ? LINK_ERRORS[params.erro] : undefined} />;
}
