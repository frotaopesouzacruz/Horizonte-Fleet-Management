"use client";

import * as React from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { signIn, type ActionState } from "@/lib/auth/actions";
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

const INITIAL_STATE: ActionState = {};

/**
 * Login against Supabase Auth.
 *
 * Client-side validation only decides when the form is worth submitting; the
 * answer always comes from the server, and a failure is reported with a single
 * generic message so the screen cannot be used to probe which e-mails exist.
 */
export function LoginView({ next, linkError }: { next?: string; linkError?: string }) {
  const [state, formAction, pending] = React.useActionState(signIn, INITIAL_STATE);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [touched, setTouched] = React.useState(false);

  const emailError = touched && !EMAIL_PATTERN.test(email) ? "Informe um e-mail válido." : undefined;
  const passwordError = touched && password.length < 6 ? "Informe sua senha." : undefined;
  const error = state.error ?? linkError;

  return (
    <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] xl:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)]">
      {/* ----------------------------------------------------------- form side */}
      <div className="flex flex-col bg-background">
        <header className="flex items-center justify-between px-6 py-5 sm:px-10">
          <BrandLogo height={46} />
          <ThemeToggle />
        </header>

        <main className="flex flex-1 items-center justify-center px-6 pb-10 sm:px-10">
          <div className="w-full max-w-sm">
            <h1 className="text-h1 font-semibold text-fg">Acessar o sistema</h1>
            <p className="mt-1.5 text-body-sm text-fg-secondary">
              Informe suas credenciais corporativas para entrar na plataforma.
            </p>

            <form
              action={formAction}
              noValidate
              onSubmit={(event) => {
                setTouched(true);
                if (!EMAIL_PATTERN.test(email) || password.length < 6) event.preventDefault();
              }}
              className="mt-7 flex flex-col gap-4"
            >
              <input type="hidden" name="next" value={next ?? "/dashboard"} />
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

              <CheckboxField defaultChecked name="remember" label="Manter conectado neste dispositivo" />

              <Button type="submit" size="lg" loading={pending} trailingIcon={<ArrowRight />} className="mt-1">
                {pending ? "Entrando…" : "Entrar"}
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
      {/* The official artwork is a composed scene that carries its own captions,
          so nothing is layered on top of it: no scrim, no competing headline. */}
      <div aria-hidden className="relative hidden lg:block">
        {/* Anchored right: the scene's left third is empty studio floor, and the
            capability panel at its right edge is the part worth keeping when the
            column is narrower than the photograph. */}
        <BrandBackground scrim="none" position="right center" />
      </div>
    </div>
  );
}
