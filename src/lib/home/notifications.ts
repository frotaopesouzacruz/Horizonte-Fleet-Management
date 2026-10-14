"use server";

import { getSessionContext } from "@/lib/auth/session";
import { resolveHome } from "@/lib/home/resolver";
import { buildDayActions, openActions } from "@/lib/portal/home-status";
import { competenceOf, mondayOf, operationalToday } from "@/lib/portal/clock";
import { getLeadershipHome, getOperationalHome } from "@/lib/portal/queries";
import { loadLeadershipBlocks } from "@/lib/portal/leadership-data";
import { buildPriorities } from "@/lib/portal/leadership";

export type NotificationKind = "acao" | "alerta" | "informacao";

export interface NotificationItem {
  key: string;
  kind: NotificationKind;
  title: string;
  description: string;
  href: string | null;
}

export type NotificationsResult = { ok: true; items: NotificationItem[] } | { ok: false; error: string };

/**
 * Central de notificações — derivada, nunca inventada: o que a Home de cada
 * perfil já sabe, no formato Ação / Alerta / Informação.
 *
 *   Operacional: as ações de hoje em aberto (vencidas e devolvidas são
 *   alerta; pendentes, ação) e a manutenção agendada do seu veículo.
 *   Liderança: as Prioridades da operação (crítico = alerta, alto = ação,
 *   médio = informação).
 *
 * Lida só quando o sino é aberto. Quem não tem portal não recebe nada por
 * aqui ainda.
 */
export async function loadMyNotifications(): Promise<NotificationsResult> {
  const session = await getSessionContext();
  if (!session?.activeOrganization) return { ok: true, items: [] };
  const org = session.activeOrganization.organizationId;
  const kind = session.portal.kind;
  const resolved = resolveHome({ portal: kind, permissions: session.permissions, isPlatformAdmin: session.isPlatformAdmin });

  try {
    if (kind === "operational") {
      if (!resolved.can.ownChecklists) return { ok: true, items: [] };
      const today = operationalToday();
      const home = await getOperationalHome(org, competenceOf(today));
      const items: NotificationItem[] = openActions(
        buildDayActions(home.todayActions, home.pending, resolved.can, new Date().toISOString()),
      ).map((a) => ({
        key: a.key,
        kind: a.state === "vencido" || a.state === "retornado" ? "alerta" : "acao",
        title: a.title,
        description: a.detail,
        href: a.href,
      }));
      if (home.vehicle?.maintenance && home.vehicle.maintenance.status !== "to_schedule") {
        const m = home.vehicle.maintenance;
        items.push({
          key: `mnt-${m.id}`,
          kind: "informacao",
          title: m.status === "in_progress" ? "Seu veículo está em manutenção" : "Manutenção agendada para o seu veículo",
          description: [home.vehicle.licensePlate, m.code, m.scheduledDate ? `em ${m.scheduledDate.split("-").reverse().join("/")}` : null]
            .filter(Boolean)
            .join(" · "),
          href: null,
        });
      }
      return { ok: true, items };
    }

    if (kind === "leadership") {
      const home = await getLeadershipHome(org);
      const leaderId = home.employee && home.scope.responsibilities.length > 0 ? home.employee.id : null;
      const blocks = await loadLeadershipBlocks(org, resolved.can, {
        today: home.today,
        weekFrom: home.weekFrom || mondayOf(home.today),
        leaderId,
      });
      const priorities = buildPriorities(blocks, home.team, leaderId ? `?lideranca=${leaderId}` : "");
      return {
        ok: true,
        items: priorities.items.map((p) => ({
          key: p.key,
          kind: p.severity === "critical" ? "alerta" : p.severity === "high" ? "acao" : "informacao",
          title: p.title,
          description: p.description,
          href: p.href,
        })),
      };
    }

    return { ok: true, items: [] };
  } catch (error) {
    console.error("notifications", error instanceof Error ? error.message : error);
    return { ok: false, error: "Não foi possível carregar as notificações. Tente novamente." };
  }
}
