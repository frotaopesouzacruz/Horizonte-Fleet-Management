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

const INITIAL_STATE: ActionState = {};

/**
 * Password recovery. For an e-mail the answer is deliberately identical whether
 * or not the address has an account, so the screen cannot be used to enumerate
 * users; a matrícula is told plainly that its route is the manager, because a
 * matrícula has no mailbox and a link would never arrive.
 */
export function RecoverAccessView() {
  const [state, formAction, pending] = React.useActionState(requestPasswordReset, INITIAL_STATE);
  const [identifier, setIdentifier] = React.useState("");
  const [touched, setTouched] = React.useState(false);

  const identifierError =
    touched && identifier.trim().length === 0 ? "Informe sua matrícula ou e-mail." : undefined;
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
            Informe sua matrícula ou o e-mail corporativo cadastrado.
          </p>

          <form
            action={formAction}
            noValidate
            onSubmit={(event) => {
              setTouched(true);
              if (identifier.trim().length === 0) event.preventDefault();
            }}
            className="mt-7 flex flex-col gap-4"
          >
            {notice ? (
              <Alert variant="info">
                <AlertTitle>Próximo passo</AlertTitle>
                <AlertDescription>{notice}</AlertDescription>
              </Alert>
            ) : null}
            {state.error ? (
              <Alert variant="danger">
                <AlertTitle>Não foi possível enviar</AlertTitle>
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            ) : null}

            <FormField label="Matrícula ou e-mail" required error={identifierError}>
              <Input
                size="lg"
                type="text"
                name="identifier"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="140349"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
              />
            </FormField>

            <Button type="submit" size="lg" loading={pending} leadingIcon={<Send />}>
              {pending ? "Enviando…" : "Continuar"}
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
