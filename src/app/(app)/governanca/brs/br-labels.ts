/**
 * Rótulos e formatadores do módulo BRs.
 *
 * Um lugar só para os textos que a listagem, os cartões e a gaveta de detalhe
 * repetem: a origem de um vínculo, o nível que respondeu pela liderança, a
 * situação de um planejamento. Dois mapas iguais em dois arquivos seriam dois
 * mapas livres para divergir.
 */

export const number = new Intl.NumberFormat("pt-BR");

const dateTimeParts = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
});

/** Data ISO (ou timestamp) → dd/mm/aaaa. Sem valor vira travessão, nunca string vazia. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-");
  return d ? `${d}/${m}/${y}` : value;
}

/**
 * Timestamp → dd/mm/aaaa hh:mm, montado das partes para não depender do
 * separador que cada versão do ICU escolhe entre data e hora.
 */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const part: Record<string, string> = {};
  for (const p of dateTimeParts.formatToParts(date)) if (p.type !== "literal") part[p.type] = p.value;
  return `${part.day}/${part.month}/${part.year} ${part.hour}:${part.minute}`;
}

/** "01/09/2026 — em aberto": a vigência de um vínculo, com o fim dito mesmo quando não há. */
export function formatPeriod(start: string | null | undefined, end: string | null | undefined): string {
  return `${formatDate(start)} — ${end ? formatDate(end) : "em aberto"}`;
}

/** De onde veio a liderança — §43, para a tela poder dizer e não só mostrar. */
export const LEADER_SCOPE_LABEL: Record<string, string> = {
  br: "exceção do BR",
  city: "cidade",
  operation: "operação",
};

/** Origem de um vínculo de veículo (`fidelization_assignments.source`). */
export const SOURCE_LABEL: Record<string, string> = {
  manual: "Manual",
  import: "Importação",
  substitution: "Substituição",
  inversion: "Inversão",
  replication: "Replicação",
};

export const ASSIGNMENT_STATUS_LABEL: Record<string, string> = {
  planned: "Planejado",
  confirmed: "Confirmado",
  executed: "Executado",
  cancelled: "Cancelado",
};

export const ASSIGNMENT_STATUS_TONE: Record<string, "info" | "success" | "neutral"> = {
  planned: "info",
  confirmed: "success",
  executed: "success",
  cancelled: "neutral",
};

/** Tipo de movimentação (§29): o que aconteceu com o veículo da posição. */
export const MOVEMENT_KIND_LABEL: Record<string, string> = {
  substitution: "Substituição",
  inversion: "Inversão",
  import: "Importação",
};

export const LEADERSHIP_STATUS_LABEL: Record<string, string> = {
  active: "Ativa",
  ended: "Encerrada",
  cancelled: "Cancelada",
};

export const RESPONSIBILITY_LABEL: Record<string, string> = {
  principal: "Principal",
  substitute: "Substituta",
  support: "Apoio",
};

export const DRIVER_ROLE_LABEL: Record<string, string> = {
  primary: "Principal",
  secondary: "Secundário",
};

export const VEHICLE_ROLE_LABEL: Record<string, string> = {
  primary: "Titular",
  support: "Apoio",
};

/** Placa em destaque, frota como complemento — e só quando os dois diferem. */
export function vehicleLabel(licensePlate: string | null, fleetCode: string | null): string {
  if (!licensePlate && !fleetCode) return "—";
  if (licensePlate && fleetCode && licensePlate !== fleetCode) return `${licensePlate} · frota ${fleetCode}`;
  return licensePlate ?? fleetCode ?? "—";
}
