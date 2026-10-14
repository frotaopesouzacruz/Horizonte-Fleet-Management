import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound, LogOut } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { signOut } from "@/lib/auth/actions";
import { LOGIN_DOMAIN } from "@/lib/auth/login-identity";
import { PORTAL_KIND_LABEL } from "@/lib/auth/portal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageContent, PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = {
  title: "Meu perfil",
  description: "Quem você é no HFM e como entra.",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="text-body-sm text-fg">{children || "—"}</dd>
    </div>
  );
}

/**
 * Meu perfil — a conta, como ela entra e as duas ações que são só dela:
 * trocar a senha e sair. Nada aqui lê dado da operação.
 */
export default async function ProfilePage() {
  const session = await requireSession();
  const technical = session.email?.toLowerCase().endsWith(`@${LOGIN_DOMAIN}`) ?? false;
  const email = technical ? null : session.email;
  const code = session.portal.employeeCode;
  const byCode = technical || (!email && Boolean(code));

  return (
    <>
      <PageHeader eyebrow="Conta" title="Meu perfil" description="Quem você é no HFM e como entra." />
      <PageContent>
        <div className="flex w-full max-w-2xl flex-col gap-4" data-testid="perfil">
          <Card variant="outlined">
            <CardHeader>
              <CardTitle>Identificação</CardTitle>
              <CardDescription>Dados do seu cadastro. Para corrigir algo, fale com o seu gestor.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Nome">{session.fullName || session.displayName}</Field>
                <Field label="Matrícula">{code}</Field>
                {email ? <Field label="E-mail">{email}</Field> : null}
                <Field label="Perfil de acesso">{PORTAL_KIND_LABEL[session.portal.kind]}</Field>
                <Field label="Organização">{session.activeOrganization?.organizationName ?? "—"}</Field>
                <Field label="Entra com">{byCode ? "Matrícula e senha" : "E-mail e senha"}</Field>
              </dl>
            </CardContent>
          </Card>

          <Card variant="outlined">
            <CardHeader>
              <CardTitle>Senha</CardTitle>
              <CardDescription>
                {byCode
                  ? "A senha inicial são os 6 primeiros dígitos do seu CPF. Troque por uma só sua; se esquecer, o seu gestor redefine."
                  : "Troque a sua senha quando quiser. Se esquecer, use “Esqueci minha senha” na tela de entrada."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="secondary" leadingIcon={<KeyRound />}>
                <Link href="/definir-senha">Alterar senha</Link>
              </Button>
            </CardContent>
          </Card>

          <Card variant="outlined">
            <CardHeader>
              <CardTitle>Sessão</CardTitle>
              <CardDescription>Sair encerra o acesso neste aparelho.</CardDescription>
            </CardHeader>
            <CardContent>
              <form action={signOut}>
                <Button type="submit" variant="outline" leadingIcon={<LogOut />}>
                  Sair do HFM
                </Button>
              </form>
            </CardContent>
          </Card>
          <p className="text-caption text-fg-muted">HFM · v0.1</p>
        </div>
      </PageContent>
    </>
  );
}
