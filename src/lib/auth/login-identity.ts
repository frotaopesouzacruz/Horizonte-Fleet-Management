/**
 * How a typed identifier becomes an account, and where a redirect may point.
 *
 * Kept free of "use server" and of any Supabase import so the server actions and
 * the route handlers can share one definition — the login form and the action
 * that answers it must never disagree about what was typed.
 */

/**
 * Tenant part of a matrícula login address. One organization today; when there
 * are several this has to be resolved per request (by host), because a matrícula
 * is unique only inside an organization and "140349" alone is ambiguous.
 */
export const LOGIN_NAMESPACE = process.env.HFM_LOGIN_NAMESPACE ?? "horizonte-logistica";

/**
 * Domain of a matrícula login address.
 *
 * Supabase Auth knows an account by an e-mail or a phone number and by nothing
 * else, so signing in with a matrícula needs an address. It defaults to the
 * `.invalid` TLD, which RFC 2606 §2 reserves precisely for names that must
 * never resolve: no MX record can exist under it, by accident or otherwise, so
 * the address is provably undeliverable without anyone configuring DNS.
 *
 * It is not a contact address and is never shown as one. `employees.corporate_email`
 * stays NULL for the 123 people who have no e-mail; nothing is invented there.
 * Point HFM_LOGIN_DOMAIN at a real subdomain only if you publish a null MX
 * (`MX 0 .`) and an SPF of `v=spf1 -all` on it first.
 */
export const LOGIN_DOMAIN = process.env.HFM_LOGIN_DOMAIN ?? `${LOGIN_NAMESPACE}.invalid`;

/**
 * An identifier is an e-mail when it contains `@`, and a matrícula otherwise.
 *
 * Routing on `@` rather than on "all digits": `employees_code_check` allows
 * `^[A-Za-z0-9][A-Za-z0-9._/-]{0,29}$`, so an alphanumeric matrícula is legal
 * and a digits-only test would misroute the first one created. Every one of the
 * 143 codes imported so far is numeric, so the two rules agree today and only
 * this one keeps agreeing tomorrow.
 */
export function isEmailIdentifier(identifier: string): boolean {
  return identifier.includes("@");
}

/**
 * The login address of a matrícula, or `null` when the code cannot be carried
 * in one safely.
 *
 * Deliberately refuses rather than sanitising. Folding `A.1` and `A-1` onto one
 * address would hand two people the same account, and that is not recoverable:
 * `organization_memberships.user_id` is immutable by trigger. Codes outside
 * `[a-z0-9]` are rejected so an administrator fixes the code instead. All 143
 * codes in the base today are six digits.
 */
export function loginEmailForCode(employeeCode: string): string | null {
  const code = employeeCode.trim().toLowerCase();
  if (!/^[a-z0-9]{1,30}$/.test(code)) return null;
  return `${code}@${LOGIN_DOMAIN}`;
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
