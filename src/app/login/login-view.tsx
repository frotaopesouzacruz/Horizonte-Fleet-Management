"use client";

import * as React from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { BrandLogo } from "@/components/brand/brand-logo";
import { BrandBackground } from "@/components/brand/brand-background";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { FormField } from "@/components/ui/form-field";
import { CheckboxField } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Login — visual foundation.
 *
 * Authentication is not wired yet: this stage establishes the layout, the brand
 * surfaces and every form state (idle, invalid, loading, error). The submit
 * handler validates locally and then reports that the session backend is not
 * connected. It never fakes a successful sign-in.
 */
export function LoginView() {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [touched, setTouched] = React.useState(false);

  const emailError = touched && !EMAIL_PATTERN.test(email) ? "Informe um e-mail válido." : undefined;
  const passwordError = touched && password.length < 6 ? "A senha deve ter ao menos 6 caracteres." : undefined;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    setError(null);
    if (!EMAIL_PATTERN.test(email) || password.length < 6) return;

    setLoading(true);
    try {
      // Supabase Auth is connected in a later stage.
      await new Promise((resolve) => setTimeout(resolve, 600));
      setError("A autenticação ainda não está conectada nesta versão do sistema.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      {/* ----------------------------------------------------------- form side */}
      <div className="flex flex-col bg-background">
        <header className="flex items-center justify-between px-6 py-5 sm:px-10">
          <BrandLogo height={30} />
          <ThemeToggle />
        </header>

        <main className="flex flex-1 items-center justify-center px-6 pb-10 sm:px-10">
          <div className="w-full max-w-sm">
            <h1 className="text-h1 font-semibold text-fg">Acessar o sistema</h1>
            <p className="mt-1.5 text-body-sm text-fg-secondary">
              Informe suas credenciais corporativas para entrar na plataforma.
            </p>

            <form onSubmit={handleSubmit} noValidate className="mt-7 flex flex-col gap-4">
              {error ? (
                <Alert variant="danger">
                  <AlertTitle>Não foi possível entrar</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              <FormField label="E-mail corporativo" required error={emailError}>
                <Input
                  size="lg"
                  type="email"
                  name="email"
                  autoComplete="username"
                  inputMode="email"
                  placeholder="nome@empresa.com.br"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </FormField>

              <FormField
                label="Senha"
                required
                error={passwordError}
                labelHint={
                  <a
                    href="/recuperar-acesso"
                    className="rounded-xs text-caption font-medium text-link hover:text-link-hover hover:underline"
                  >
                    Esqueci minha senha
                  </a>
                }
              >
                <PasswordInput
                  size="lg"
                  name="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </FormField>

              <CheckboxField defaultChecked label="Manter conectado neste dispositivo" />

              <Button type="submit" size="lg" loading={loading} trailingIcon={<ArrowRight />} className="mt-1">
                {loading ? "Entrando…" : "Entrar"}
              </Button>
            </form>

            <p className="mt-6 flex items-center gap-1.5 text-caption text-fg-muted">
              <ShieldCheck className="size-3.5" aria-hidden />
              Conexão segura. O acesso é registrado para fins de auditoria.
            </p>
          </div>
        </main>

        <footer className="px-6 pb-6 text-caption text-fg-muted sm:px-10">
          Horizonte Fleet Management · Operações Souza Cruz
        </footer>
      </div>

      {/* ------------------------------------------------- institutional side */}
      <aside className="relative hidden lg:block">
        <BrandBackground priority scrim="soft" position="center" />
        <div className="relative flex h-full flex-col justify-end p-10 xl:p-14">
          <div className="max-w-md">
            <span className="inline-flex items-center gap-2 rounded-xs bg-highlight-soft px-2 py-1 text-caption font-medium text-highlight-soft-fg">
              Plataforma corporativa
            </span>
            <h2 className="mt-4 text-display font-semibold text-fg">Gestão inteligente de frotas</h2>
            <p className="mt-3 text-body text-fg-secondary">
              Frota, manutenção, quilometragem e conformidade operacional em um único ecossistema, com governança e
              rastreabilidade de ponta a ponta.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}
