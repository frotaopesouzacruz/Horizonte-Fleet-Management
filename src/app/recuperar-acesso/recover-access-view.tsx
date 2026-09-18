"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Send } from "lucide-react";
import { requestPasswordReset, type ActionState } from "@/lib/auth/actions";
import { BrandLogo } from "@/components/brand/brand-logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INITIAL_STATE: ActionState = {};

/**
 * Password recovery. The answer is deliberately identical whether or not the
 * address has an account, so the screen cannot be used to enumerate users.
 */
export function RecoverAccessView() {
  const [state, formAction, pending] = React.useActionState(requestPasswordReset, INITIAL_STATE);
  const [email, setEmail] = React.useState("");
  const [touched, setTouched] = React.useState(false);

  const emailError = touched && !EMAIL_PATTERN.test(email) ? "Informe um e-mail válido." : undefined;
  const notice = state.notice;

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <BrandLogo height={46} />
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-6 pb-10 sm:px-10">
        <div className="w-full max-w-sm">
          <h1 className="text-h1 font-semibold text-fg">Recuperar acesso</h1>
          <p className="mt-1.5 text-body-sm text-fg-secondary">
            Informe o e-mail corporativo cadastrado. Você receberá um link para definir uma nova senha.
          </p>

          <form
            action={formAction}
            noValidate
            onSubmit={(event) => {
              setTouched(true);
              if (!EMAIL_PATTERN.test(email)) event.preventDefault();
            }}
            className="mt-7 flex flex-col gap-4"
          >
            {notice ? (
              <Alert variant="info">
                <AlertTitle>Verifique seu e-mail</AlertTitle>
                <AlertDescription>{notice}</AlertDescription>
              </Alert>
            ) : null}
            {state.error ? (
              <Alert variant="danger">
                <AlertTitle>Não foi possível enviar</AlertTitle>
                <AlertDescription>{state.error}</AlertDescription>
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

            <Button type="submit" size="lg" loading={pending} leadingIcon={<Send />}>
              {pending ? "Enviando…" : "Enviar link de recuperação"}
            </Button>
          </form>

          <Link
            href="/login"
            className="mt-6 inline-flex items-center gap-1.5 rounded-xs text-body-sm font-medium text-link hover:text-link-hover hover:underline"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Voltar para o acesso
          </Link>
        </div>
      </main>

      <footer className="px-6 pb-6 text-caption text-fg-muted sm:px-10">
        Horizonte Fleet Management · Operações Souza Cruz
      </footer>
    </div>
  );
}
