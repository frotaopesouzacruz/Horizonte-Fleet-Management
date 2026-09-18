"use client";

import * as React from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { signIn, type ActionState } from "@/lib/auth/actions";
import { BrandLogo } from "@/components/brand/brand-logo";
import { InstitutionalPanel } from "@/app/login/institutional-panel";
import { ThemeSwitch } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { FormField } from "@/components/ui/form-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";

const INITIAL_STATE: ActionState = {};

/** Uppercase, letter-spaced field label. */
const FIELD_LABEL = "text-overline font-semibold uppercase text-fg-secondary";

/**
 * Local time, as on the reference screen.
 *
 * Rendered empty on the server and until the first client tick: the server's
 * clock is UTC and the visitor's is not, so painting a time during SSR
 * guarantees a hydration mismatch. `suppressHydrationWarning` is not enough —
 * the value has to genuinely not exist until the browser owns it.
 */
function LocalClock() {
  const [time, setTime] = React.useState<string | null>(null);

  React.useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString("pt-BR", { hour12: false }));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <span className="font-mono tabular-nums" suppressHydrationWarning>
      {time ?? " "}
    </span>
  );
}

/**
 * Login against Supabase Auth.
 *
 * Split screen, weighted to the artwork: the form needs about 400px of usable
 * width and nothing more, so giving it 40% of a 1920px monitor spent 370px on
 * empty margin and took the same 370px away from the photograph. The form
 * column is a fixed measure that stops growing; the institutional column takes
 * whatever is left, which on a wide screen is roughly three quarters.
 *
 * One identifier field takes either a matrícula or an e-mail, because the two
 * halves of the base are identified differently: the Operacional profile signs
 * in with the matrícula (123 of the 143 employees, none of whom has an e-mail)
 * and every other profile with the registered corporate e-mail. Which one was
 * typed is decided server-side, by the presence of `@`.
 *
 * Client-side validation only decides when the form is worth submitting; the
 * answer always comes from the server, and a failure is reported with a single
 * generic message so the screen cannot be used to probe which accounts exist.
 */
export function LoginView({ next, linkError }: { next?: string; linkError?: string }) {
  const [state, formAction, pending] = React.useActionState(signIn, INITIAL_STATE);
  const [identifier, setIdentifier] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [touched, setTouched] = React.useState(false);

  const identifierError = touched && identifier.trim().length === 0 ? "Informe sua matrícula ou e-mail." : undefined;
  const passwordError = touched && password.length === 0 ? "Informe sua senha." : undefined;
  const error = state.error ?? linkError;

  return (
    <div className="hfm-theme-transition relative grid min-h-dvh grid-cols-1 lg:grid-cols-[26rem_minmax(0,1fr)] xl:grid-cols-[28rem_minmax(0,1fr)] 2xl:grid-cols-[32rem_minmax(0,1fr)]">
      {/* The switch floats above the grid: the institutional column is hidden
          below `lg`, so anchoring it there would lose it on a phone. */}
      <div className="absolute top-4 right-4 z-10 rounded-full border border-border/50 bg-surface/70 backdrop-blur-sm sm:top-6 sm:right-6">
        <ThemeSwitch />
      </div>

      {/* ----------------------------------------------------------- form side */}
      {/* Not a flat fill: a soft pool of `surface` at the top and a darker seam
          on the inner edge give the column depth and let it meet the photograph
          instead of butting against it. Both stops are tokens, so the effect
          inverts with the theme on its own. */}
      <div className="relative flex flex-col justify-center overflow-hidden bg-background px-6 py-10 sm:px-10 lg:px-8 xl:px-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(115%_70%_at_50%_-10%,var(--color-surface)_0%,transparent_60%)] opacity-70"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 hidden w-16 bg-linear-to-r from-transparent to-surface-tertiary/40 lg:block"
        />

        <main className="relative mx-auto flex w-full max-w-[25rem] flex-col">
          <header className="flex flex-col items-start">
            <BrandLogo height={42} />
            <h1 className="mt-7 text-h1 font-semibold text-fg">Bem-vindo ao Horizonte</h1>
            <p className="mt-1.5 text-body-sm text-fg-secondary">
              Acesse sua conta para continuar. Use sua matrícula ou o e-mail corporativo.
            </p>
          </header>

          <form
            action={formAction}
            noValidate
            onSubmit={(event) => {
              setTouched(true);
              if (identifier.trim().length === 0 || password.length === 0) event.preventDefault();
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

            <FormField label="Matrícula ou e-mail" labelClassName={FIELD_LABEL} error={identifierError}>
              <Input
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

            {/* Recovery rides on the label row rather than below the button.
                The route, the handler and the flow are untouched — it simply
                stops being the element that decides how tall this card is. */}
            <FormField
              label="Senha"
              labelClassName={FIELD_LABEL}
              error={passwordError}
              helperText="No primeiro acesso, use a senha temporária entregue pelo seu gestor."
              labelHint={
                <a
                  href="/recuperar-acesso"
                  className="rounded-xs text-caption text-fg-muted hover:text-link-hover hover:underline"
                >
                  Esqueci minha senha
                </a>
              }
            >
              <PasswordInput
                name="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </FormField>

            <Button
              type="submit"
              size="lg"
              variant="highlight"
              loading={pending}
              trailingIcon={<ArrowRight />}
              className="mt-1 w-full"
            >
              {pending ? "Entrando…" : "Entrar"}
            </Button>
          </form>

          <div className="mt-8 flex items-center justify-between gap-3 border-t border-border-subtle pt-4 text-caption text-fg-muted">
            <span className="flex min-w-0 items-center gap-1.5">
              <ShieldCheck className="size-3.5 shrink-0 text-highlight-soft-fg" aria-hidden />
              <span className="truncate">Conexão segura · acesso auditado</span>
            </span>
            <LocalClock />
          </div>
        </main>
      </div>

      <InstitutionalPanel />
    </div>
  );
}
