"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Send } from "lucide-react";
import { BrandLogo } from "@/components/brand/brand-logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Password recovery — visual foundation, same posture as the login screen:
 * the layout and every state exist, the delivery backend does not yet.
 */
export function RecoverAccessView() {
  const [email, setEmail] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  const emailError = touched && !EMAIL_PATTERN.test(email) ? "Informe um e-mail válido." : undefined;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    setNotice(null);
    if (!EMAIL_PATTERN.test(email)) return;

    setLoading(true);
    try {
      // Supabase Auth recovery is connected in a later stage.
      await new Promise((resolve) => setTimeout(resolve, 500));
      setNotice("O envio de e-mail de recuperação ainda não está conectado nesta versão do sistema.");
    } finally {
      setLoading(false);
    }
  }

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

          <form onSubmit={handleSubmit} noValidate className="mt-7 flex flex-col gap-4">
            {notice ? (
              <Alert variant="info">
                <AlertTitle>Recuperação indisponível</AlertTitle>
                <AlertDescription>{notice}</AlertDescription>
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

            <Button type="submit" size="lg" loading={loading} leadingIcon={<Send />}>
              {loading ? "Enviando…" : "Enviar link de recuperação"}
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
