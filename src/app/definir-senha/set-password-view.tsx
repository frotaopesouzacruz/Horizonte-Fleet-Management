"use client";

import * as React from "react";
import { KeyRound } from "lucide-react";
import { setPassword, type ActionState } from "@/lib/auth/actions";
import { BrandLogo } from "@/components/brand/brand-logo";
import { ThemeSwitch } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { FormField } from "@/components/ui/form-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";

const INITIAL_STATE: ActionState = {};
const MIN_LENGTH = 10;

/** Finishes an invitation or a recovery: the user chooses their own password. */
export function SetPasswordView({ email }: { email: string | null }) {
  const [state, formAction, pending] = React.useActionState(setPassword, INITIAL_STATE);
  const [password, setPasswordValue] = React.useState("");
  const [confirmation, setConfirmation] = React.useState("");
  const [touched, setTouched] = React.useState(false);

  const tooShort = touched && password.length < MIN_LENGTH;
  const mismatch = touched && confirmation.length > 0 && confirmation !== password;

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <BrandLogo height={46} />
        <ThemeSwitch />
      </header>

      <main className="flex flex-1 items-center justify-center px-6 pb-10 sm:px-10">
        <div className="w-full max-w-sm">
          <h1 className="text-h1 font-semibold text-fg">Definir senha</h1>
          <p className="mt-1.5 text-body-sm text-fg-secondary">
            {email ? (
              <>
                Crie a senha de acesso para <span className="font-medium text-fg">{email}</span>.
              </>
            ) : (
              "Crie a senha de acesso da sua conta."
            )}
          </p>

          <form
            action={formAction}
            noValidate
            onSubmit={(event) => {
              setTouched(true);
              if (password.length < MIN_LENGTH || password !== confirmation) event.preventDefault();
            }}
            className="mt-7 flex flex-col gap-4"
          >
            {state.error ? (
              <Alert variant="danger">
                <AlertTitle>Não foi possível definir a senha</AlertTitle>
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            ) : null}

            <FormField
              label="Nova senha"
              required
              error={tooShort ? `A senha deve ter ao menos ${MIN_LENGTH} caracteres.` : undefined}
              helperText={`Mínimo de ${MIN_LENGTH} caracteres. Use uma senha exclusiva desta plataforma.`}
            >
              <PasswordInput
                size="lg"
                name="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPasswordValue(event.target.value)}
              />
            </FormField>

            <FormField
              label="Confirmar senha"
              required
              error={mismatch ? "As senhas não coincidem." : undefined}
            >
              <PasswordInput
                size="lg"
                name="password_confirmation"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </FormField>

            <Button type="submit" size="lg" loading={pending} leadingIcon={<KeyRound />}>
              {pending ? "Salvando…" : "Definir senha e entrar"}
            </Button>
          </form>
        </div>
      </main>

      <footer className="px-6 pb-6 text-caption text-fg-muted sm:px-10">
        Horizonte Fleet Management · Operações Souza Cruz
      </footer>
    </div>
  );
}
