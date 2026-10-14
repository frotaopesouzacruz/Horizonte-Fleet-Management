import type { Competence } from "@/lib/governance/competence";

/**
 * O dia operacional em São Paulo — o relógio do servidor, nunca o do
 * navegador (o HFC usa UTC e, depois das 21h, "hoje" já é amanhã).
 */
export function operationalToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

export function competenceOf(iso: string): Competence {
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) };
}

/** Segunda-feira da semana de uma data ISO. */
export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

/** O dia anterior de uma data ISO. */
export function dayBefore(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
