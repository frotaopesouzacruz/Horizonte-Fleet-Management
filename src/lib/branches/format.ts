/**
 * Formatting shared by the server queries and the client forms.
 *
 * Pure, no server imports: the mask is applied when the CNPJ is shown and
 * stripped when it is sent, and both sides need exactly the same two functions.
 * A second implementation on the client is how "12.345.678/0001-95" ends up
 * stored with dots in it.
 */

/** Digits only. What the database stores and what search compares against. */
export function normalizeDocument(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits === "" ? null : digits;
}

/** 12.345.678/0001-95 — applied on display only (§15). */
export function formatCnpj(value: string | null | undefined): string {
  const d = normalizeDocument(value);
  if (!d) return "—";
  if (d.length !== 14) return d;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Progressive mask for an input being typed. */
export function maskCnpjInput(value: string): string {
  const d = (value ?? "").replace(/\D/g, "").slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/**
 * The check digits, mirrored from `private.is_valid_cnpj`.
 *
 * The database is the authority and refuses an invalid CNPJ regardless. This
 * exists so the form can say so while the person is still looking at the field,
 * instead of after a round trip.
 */
export function isValidCnpj(value: string | null | undefined): boolean {
  const d = normalizeDocument(value);
  if (!d || d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;

  for (const pass of [0, 1]) {
    const weights = pass === 0
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < weights.length; i += 1) sum += Number(d[i]) * weights[i];
    const rest = sum % 11;
    const check = rest < 2 ? 0 : 11 - rest;
    if (check !== Number(d[12 + pass])) return false;
  }
  return true;
}

export function formatPostalCode(value: string | null | undefined): string {
  const d = (value ?? "").replace(/\D/g, "");
  if (d.length !== 8) return d || "—";
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

export function maskPostalInput(value: string): string {
  const d = (value ?? "").replace(/\D/g, "").slice(0, 8);
  return d.length <= 5 ? d : `${d.slice(0, 5)}-${d.slice(5)}`;
}

/** "Rua X, 120 — Centro, Contagem/MG" — only the parts that exist. */
export function formatAddress(parts: {
  street?: string | null;
  streetNumber?: string | null;
  district?: string | null;
  cityName?: string | null;
  stateUf?: string | null;
}): string {
  const line = [parts.street, parts.streetNumber].filter(Boolean).join(", ");
  const place = [parts.cityName, parts.stateUf].filter(Boolean).join("/");
  const middle = [line, parts.district].filter(Boolean).join(" — ");
  return [middle, place].filter(Boolean).join(", ") || "—";
}
