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
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";

const INITIAL_STATE: ActionState = {};

/** Uppercase, letter-spaced field label, as on the reference screen. */
const FIELD_LABEL = "text-caption font-semibold uppercase tracking-[0.12em] text-fg-secondary";

/**
 * The four corner ticks that frame the card. Decorative only — they carry the
 * brand gold into the composition without competing with the logo.
 */
function CornerTicks() {
  const corners = [
    "left-0 top-0 border-l-2 border-t-2 rounded-tl-md",
    "right-0 top-0 border-r-2 border-t-2 rounded-tr-md",
    "left-0 bottom-0 border-b-2 border-l-2 rounded-bl-md",
    "right-0 bottom-0 border-b-2 border-r-2 rounded-br-md",
  ];
  return (
    <>
      {corners.map((corner) => (
        <span key={corner} aria-hidden className={`pointer-events-none absolute size-5 border-highlight ${corner}`} />
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
 * One identifier field takes either a matrícula or an e-mail — 124 of the 144
 * imported employees have no e-mail at all, so an e-mail-only form would lock
 * most of the base out. Which of the two was typed is decided server-side.
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
    <div className="relative grid min-h-dvh grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] xl:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)]">
      {/* The toggle floats above the grid: the institutional column is hidden
          below `lg`, so anchoring it there would lose it on a phone. */}
      <div className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>

      {/* ----------------------------------------------------------- form side */}
      <div className="flex flex-col justify-center bg-background px-6 py-10 sm:px-10">
        <main className="mx-auto w-full max-w-[26rem]">
          <div className="relative rounded-lg border border-border bg-surface p-7 shadow-md sm:p-9">
            <CornerTicks />

            <div className="flex flex-col items-center text-center">
              <BrandLogo height={52} />
              <h1 className="mt-5 text-h2 font-semibold text-fg">
                Horizonte <span className="text-highlight">Fleet Management</span>
              </h1>
              <p className="mt-1 text-caption font-medium uppercase tracking-[0.18em] text-fg-muted">
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
              className="mt-8 flex flex-col gap-5"
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

              <FormField
                label="Senha"
                labelClassName={FIELD_LABEL}
                error={passwordError}
                helperText="No primeiro acesso, use a senha temporária entregue pelo seu gestor."
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

              <Button
                type="submit"
                variant="highlight"
                size="lg"
                loading={pending}
                trailingIcon={<ArrowRight />}
                className="w-full"
              >
                {pending ? "Entrando…" : "Acessar Sistema"}
              </Button>

              <a
                href="/recuperar-acesso"
                className="rounded-xs text-center text-caption font-medium text-link hover:text-link-hover hover:underline"
              >
                Esqueci minha senha
              </a>
            </form>

            <div className="mt-7 flex items-center justify-between border-t border-border-subtle pt-4 text-caption text-fg-muted">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="size-3.5 text-highlight" aria-hidden />
                Conexão segura
              </span>
              <LocalClock />
            </div>
          </div>

          <p className="mt-6 text-center text-caption text-fg-muted">
            O acesso é registrado para fins de auditoria.
          </p>
        </main>
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
