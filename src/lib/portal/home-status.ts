import type { StatusTone } from "@/components/ui/status-badge";
import type { HomeCapabilities } from "@/lib/home/resolver";
import { appPermission } from "@/lib/home/resolver";
import type { HomeApp, PendingInspection, TodayAction } from "@/lib/portal/types";

/**
 * Home do Operacional: os estados de uma ação do dia e as regras que os
 * derivam do status oficial do Motor de Aderência e das vistorias.
 *
 * Puro (sem servidor, sem React): a tela, a prévia e os testes decidem o
 * mesmo. Nunca por cor sozinha — cada estado tem rótulo e ícone.
 */

export type ActionState = "pendente" | "em_andamento" | "concluido" | "retornado" | "vencido" | "dispensado";

export const ACTION_STATE: Record<ActionState, { label: string; tone: StatusTone }> = {
  pendente: { label: "Pendente", tone: "pending" },
  em_andamento: { label: "Em andamento", tone: "progress" },
  concluido: { label: "Concluído", tone: "success" },
  retornado: { label: "Retornado", tone: "warning" },
  vencido: { label: "Vencido", tone: "danger" },
  dispensado: { label: "Dispensado", tone: "neutral" },
};

/** Ordem em que as ações aparecem: o que exige a pessoa primeiro. */
const STATE_ORDER: Record<ActionState, number> = {
  vencido: 0,
  retornado: 1,
  pendente: 2,
  em_andamento: 3,
  concluido: 4,
  dispensado: 5,
};

const EXCLUSION_LABEL: Record<string, string> = {
  MANUTENCAO: "Veículo em manutenção",
  SEM_ROTA: "Sem rota no dia",
  EM_VIAGEM: "Em viagem",
  FROTA_RESERVA: "Frota reserva",
  RESERVA: "Frota reserva",
  FROTA_NAO_ATIVA: "Frota não ativa",
  OUTROS: "Dispensa aprovada",
};

export interface DayActionItem {
  key: string;
  kind: "checklist" | "mtsr" | "tires";
  state: ActionState;
  /** "Checklist de saída", "Vistoria MTSR"… */
  title: string;
  /** Placa · BR · prazo, ou o motivo da dispensa/devolução. */
  detail: string;
  licensePlate: string | null;
  /** Para onde o botão leva; null quando não há o que fazer. */
  href: string | null;
  cta: string | null;
}

const CONTEXT_LABEL = { saida: "Checklist de saída", retorno: "Checklist de retorno" } as const;

function timeBr(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}

export function actionState(action: TodayAction, now: string, actions: TodayAction[]): ActionState {
  if (action.excluded) return "dispensado";
  if (action.done) return "concluido";
  if (action.status === "RETORNO_PENDENTE") {
    const departure = actions.find(
      (a) => a.journey === action.journey && a.context === "saida" && a.vehicleId === action.vehicleId,
    );
    return departure?.done ? "em_andamento" : "pendente";
  }
  if (action.status === "NAO_FEZ_CHECKLIST") {
    const deadline = action.deadlineAt ? Date.parse(action.deadlineAt) : Number.NaN;
    const current = Date.parse(now);
    if (!Number.isNaN(deadline) && !Number.isNaN(current) && deadline < current) return "vencido";
    return "pendente";
  }
  return "pendente";
}

/**
 * As ações do dia, na ordem do que exige a pessoa: obrigações oficiais de
 * hoje e vistorias devolvidas ao campo.
 */
export function buildDayActions(
  actions: TodayAction[] | null,
  pending: PendingInspection[],
  can: HomeCapabilities,
  now: string,
): DayActionItem[] {
  const items: DayActionItem[] = [];
  for (const a of actions ?? []) {
    const state = actionState(a, now, actions ?? []);
    const where = [a.licensePlate, a.brCode ? `BR ${a.brCode}` : null].filter(Boolean).join(" · ");
    const deadline = timeBr(a.deadlineAt);
    const detail =
      state === "dispensado"
        ? `${EXCLUSION_LABEL[a.status] ?? "Dispensado"}${where ? ` · ${where}` : ""}`
        : state === "concluido"
          ? where || "Checklist enviado"
          : [where, deadline ? `até ${deadline}` : null].filter(Boolean).join(" · ");
    const actionable = state === "pendente" || state === "vencido" || state === "em_andamento";
    items.push({
      key: a.obligationId || `${a.context}-${a.journey}-${a.vehicleId ?? ""}`,
      kind: "checklist",
      state,
      title: CONTEXT_LABEL[a.context],
      detail,
      licensePlate: a.licensePlate,
      href: actionable && can.checklistExecute ? "/aplicativos/check-list-frota" : null,
      cta: actionable && can.checklistExecute ? (state === "em_andamento" ? "Fazer retorno" : "Iniciar") : null,
    });
  }
  for (const p of pending) {
    const canRedo = p.kind === "mtsr" ? can.mtsrExecute : can.tiresExecute;
    items.push({
      key: `${p.kind}-${p.id}`,
      kind: p.kind,
      state: "retornado",
      title: p.kind === "mtsr" ? "Vistoria MTSR devolvida" : "Vistoria de pneus devolvida",
      detail: [p.licensePlate, p.reason ? p.reason : "Nova verificação em campo"].filter(Boolean).join(" · "),
      licensePlate: p.licensePlate,
      href: canRedo ? (p.kind === "mtsr" ? "/aplicativos/vistoria-mtsr" : "/aplicativos/vistoria-pneus") : null,
      cta: canRedo ? "Refazer" : null,
    });
  }
  return items.sort((x, y) => STATE_ORDER[x.state] - STATE_ORDER[y.state]);
}

/** Só o que a pessoa ainda precisa resolver (nada concluído ou dispensado). */
export function openActions(items: DayActionItem[]): DayActionItem[] {
  return items.filter((i) => i.state !== "concluido" && i.state !== "dispensado");
}

/* -------------------------------------------------------------------------- */
/* Aplicativos                                                                */
/* -------------------------------------------------------------------------- */

export interface HomeAppCard {
  code: string;
  href: string;
  name: string;
  description: string;
  tone: "primary" | "info" | "highlight";
}

const APP_META: Record<string, Omit<HomeAppCard, "code">> = {
  checklist_frota: {
    href: "/aplicativos/check-list-frota",
    name: "Check List de Frota",
    description: "Saída e retorno de rota",
    tone: "primary",
  },
  vistoria_mtsr: {
    href: "/aplicativos/vistoria-mtsr",
    name: "Vistoria MTSR",
    description: "Componentes de segurança",
    tone: "highlight",
  },
  vistoria_pneus: {
    href: "/aplicativos/vistoria-pneus",
    name: "Vistoria de Pneus",
    description: "Sulco e calibragem",
    tone: "info",
  },
};

const APP_ORDER = ["checklist_frota", "vistoria_mtsr", "vistoria_pneus"];

/**
 * Os aplicativos que a pessoa vê: só os que a permissão libera E que estão
 * habilitados para a operação do vínculo. Sem o catálogo (a leitura falhou
 * ou a conta não tem vínculo), vale a permissão sozinha — nunca um app a
 * mais, e nunca um botão para onde a pessoa não pode ir.
 */
export function visibleApps(apps: HomeApp[] | null, can: HomeCapabilities): HomeAppCard[] {
  if (!can.apps) return [];
  const catalog = apps && apps.length ? apps : APP_ORDER.map((code) => ({ code, slug: "", name: "", enabled: null }));
  return catalog
    .filter((app) => APP_META[app.code] && app.enabled !== false)
    .filter((app) => {
      const permission = appPermission(app.code);
      return permission ? permissionHeld(permission, can) : false;
    })
    .sort((a, b) => APP_ORDER.indexOf(a.code) - APP_ORDER.indexOf(b.code))
    .map((app) => ({ code: app.code, ...APP_META[app.code] }));
}

function permissionHeld(permission: string, can: HomeCapabilities): boolean {
  switch (permission) {
    case "applications.checklist_fleet.execute":
      return can.checklistExecute;
    case "applications.mtsr.execute":
      return can.mtsrExecute;
    case "applications.tires.execute":
      return can.tiresExecute;
    default:
      return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Rótulos                                                                    */
/* -------------------------------------------------------------------------- */

export const INSPECTION_STATUS_LABEL: Record<string, { label: string; tone: StatusTone }> = {
  submitted: { label: "Enviado", tone: "success" },
  pendente_validacao: { label: "Aguardando validação", tone: "pending" },
  validada: { label: "Validada", tone: "success" },
  retornada: { label: "Retornada", tone: "warning" },
  rejeitada: { label: "Rejeitada", tone: "danger" },
  pendente_revisao: { label: "Aguardando revisão", tone: "pending" },
  pendente_rodopar: { label: "Aguardando Rodopar", tone: "pending" },
  sincronizado_rodopar: { label: "Sincronizada", tone: "success" },
  retornar_divergencia: { label: "Retornada", tone: "warning" },
  substituida: { label: "Substituída", tone: "neutral" },
};

export const MAINTENANCE_STATUS_LABEL: Record<string, { label: string; tone: StatusTone }> = {
  to_schedule: { label: "Manutenção a agendar", tone: "pending" },
  scheduled: { label: "Manutenção agendada", tone: "info" },
  in_progress: { label: "Em manutenção", tone: "progress" },
};

export const VEHICLE_STATUS_LABEL: Record<string, { label: string; tone: StatusTone }> = {
  active: { label: "Ativo", tone: "success" },
  inactive: { label: "Inativo", tone: "neutral" },
  maintenance: { label: "Em manutenção", tone: "progress" },
};

export function dateBr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d ? `${d}/${m}/${y}` : iso;
}

export function dateTimeBr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return dateBr(iso);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}

/** "terça-feira, 13 de outubro" para a saudação compacta. */
export function longDateBr(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const text = d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return text.charAt(0).toUpperCase() + text.slice(1);
}
