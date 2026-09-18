/**
 * How a typed identifier is interpreted, and where a redirect may point.
 *
 * Kept free of "use server" and of any Supabase import so both the client
 * components and the server actions can share one definition — the login form
 * and the action that answers it must never disagree about what was typed.
 */

/**
 * An identifier is an e-mail when it contains `@`, and a matrícula otherwise.
 *
 * Routing on `@` rather than on "all digits": `employees_code_check` allows
 * `^[A-Za-z0-9][A-Za-z0-9._/-]{0,29}$`, so an alphanumeric matrícula is legal
 * and a digits-only test would silently misroute it the day one is created.
 * Every one of the 143 codes imported so far is numeric, so the two rules agree
 * today and only this one keeps agreeing tomorrow.
 */
export function isEmailIdentifier(identifier: string): boolean {
  return identifier.includes("@");
}

/**
 * A redirect target that cannot leave this origin.
 *
 * `startsWith("/")` is not enough: `//evil.com` and `/\evil.com` also start
 * with a slash and browsers resolve both as protocol-relative URLs to another
 * host, which turns any `?next=` into an open redirect — the classic way to
 * make a phishing link look like it points at the real product.
 */
export function safeNext(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
