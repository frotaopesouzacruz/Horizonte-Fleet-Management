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
const FIELD_LABEL = "text-caption font-semibold uppercase tracking-[0.1em] text-fg-secondary";

/**
 * The four corner ticks that frame the card.
 *
 * Deliberately faint and short: on the reference screen they read as a bracket
 * around the card, not as a gold frame. A thicker rule at full length competes
 * with the logo, which is the only thing on this card that should carry brand.
 */
function CornerTicks() {
  const corners = [
    "left-0 top-0 border-l border-t rounded-tl-md",
    "right-0 top-0 border-r border-t rounded-tr-md",
    "left-0 bottom-0 border-b border-l rounded-bl-md",
    "right-0 bottom-0 border-b border-r rounded-br-md",
  ];
  return (
    <>
      {corners.map((corner) => (
        <span
          key={corner}
          aria-hidden
          className={`pointer-events-none absolute size-4 border-highlight/70 ${corner}`}
        />
      ))}
    </>
  );
}

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
      {time ?? " "}
    </span>
  );
}

/**
 * Login against Supabase Auth.
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
    <div className="hfm-theme-transition relative grid min-h-dvh grid-cols-1 lg:grid-cols-[minmax(0,40fr)_minmax(0,60fr)]">
      {/* The switch floats above the grid: the institutional column is hidden
          below `lg`, so anchoring it there would lose it on a phone. */}
      <div className="absolute right-4 top-4 z-10 rounded-full border border-border/50 bg-surface/70 backdrop-blur-sm sm:right-6 sm:top-6">
        <ThemeSwitch />
      </div>

      {/* ----------------------------------------------------------- form side */}
      {/* Not a flat fill: a soft pool of `surface` at the top and a darker seam
          on the inner edge give the column depth and let it meet the photograph
          instead of butting against it. Both stops are tokens, so the effect
          inverts with the theme on its own. */}
      <div className="relative flex flex-col justify-center overflow-hidden bg-background px-6 py-10 sm:px-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(115%_75%_at_50%_-10%,var(--color-surface)_0%,transparent_62%)] opacity-70"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-linear-to-r from-transparent to-surface-tertiary/45"
        />

        <main className="relative mx-auto w-full max-w-[25rem]">
          <div className="relative rounded-lg border border-border bg-surface px-7 py-7 shadow-md sm:px-8">
            <CornerTicks />

            <div className="flex flex-col items-center text-center">
              <BrandLogo height={44} />
              <h1 className="mt-3.5 text-h3 font-semibold text-fg">
                Horizonte <span className="text-highlight-soft-fg">Fleet Management</span>
              </h1>
              <p className="mt-0.5 text-caption font-medium uppercase tracking-[0.16em] text-fg-muted">
                Operações Souza Cruz
              </p>
            </div>

            <form
              action={formAction}
              noValidate
              onSubmit={(event) => {
                setTouched(true);
                if (identifier.trim().length === 0 || password.length === 0) event.preventDefault();
              }}
              className="mt-6 flex flex-col gap-3.5"
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
                variant="highlight"
                loading={pending}
                trailingIcon={<ArrowRight />}
                className="mt-1 w-full"
              >
                {pending ? "Entrando…" : "Acessar Sistema"}
              </Button>
            </form>

            {/* The audit notice used to be a paragraph of its own below the card.
                It says the same thing folded in here, and costs no height. */}
            <div className="mt-5 flex items-center justify-between gap-3 border-t border-border-subtle pt-3.5 text-caption text-fg-muted">
              <span className="flex min-w-0 items-center gap-1.5">
                <ShieldCheck className="size-3.5 shrink-0 text-highlight-soft-fg" aria-hidden />
                <span className="truncate">Conexão segura · acesso auditado</span>
              </span>
              <LocalClock />
            </div>
          </div>
        </main>
      </div>

      <InstitutionalPanel />
    </div>
  );
}
