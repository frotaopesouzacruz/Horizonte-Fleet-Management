import type {
  CityLeadershipInput, CityLeadershipResult, LeadershipPlanner, PlannerLeader,
} from "@/lib/governance/leadership-planner-types";
import { leaderAt } from "@/lib/governance/leadership-planner-types";

/**
 * Matriz fixa do Planejamento de Lideranças (Setembro/2026, "hoje" 23/09) —
 * a forma exata do que `leadership_city_planner` devolve: tipos de operação,
 * cidades com UF, a liderança de cada cidade no mês e as pessoas do perfil
 * Liderança Operações.
 *
 * Os casos que a tela precisa distinguir estão todos aqui: cidade com
 * liderança em aberto (Contagem), cidade cuja liderança só começa depois de
 * hoje (Belo Horizonte), cidade cuja liderança terminou no meio do mês
 * (Belém) e uma liderança fora do perfil (Uberlândia).
 */
export const PLANNER_TODAY = "2026-09-23";

const leader = (over: Partial<PlannerLeader> & Pick<PlannerLeader, "id" | "employeeId" | "employeeName">): PlannerLeader => ({
  employeeCode: null,
  employeeActive: true,
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  status: "active",
  notes: null,
  updatedAt: "2026-09-01T12:00:00Z",
  ...over,
});

export function plannerFixture(tense: "current" | "past" = "current"): LeadershipPlanner {
  const past = tense === "past";
  return {
    competence: past ? "2026-08" : "2026-09",
    monthStart: past ? "2026-08-01" : "2026-09-01",
    monthEnd: past ? "2026-08-31" : "2026-09-30",
    today: PLANNER_TODAY,
    candidates: [
      { id: "emp-1", name: "Daniela Ferreira Lima", code: "10234" },
      { id: "emp-5", name: "Marco Vieira dos Santos", code: "140538" },
      { id: "emp-6", name: "Paulo Henrique Martins", code: "10555" },
      { id: "emp-2", name: "Walace Rodrigues Santos", code: "10418" },
    ],
    operations: [
      {
        id: "op-1",
        name: "Last Mille MG",
        code: "OP-00004",
        cities: [
          {
            operationCityId: "oc-2", cityId: 3106200, stateId: 31, cityName: "Belo Horizonte", uf: "MG", brExceptions: 0,
            leaders: past
              ? []
              : [leader({ id: "la-5", employeeId: "emp-6", employeeName: "Paulo Henrique Martins", employeeCode: "10555", effectiveFrom: "2026-09-25", effectiveTo: "2026-09-30" })],
          },
          {
            operationCityId: "oc-1", cityId: 3118601, stateId: 31, cityName: "Contagem", uf: "MG", brExceptions: 1,
            leaders: [leader({ id: "la-1", employeeId: "emp-1", employeeName: "Daniela Ferreira Lima", employeeCode: "10234", effectiveFrom: "2026-07-01" })],
          },
        ],
      },
      {
        id: "op-3",
        name: "Merchandising",
        code: "OP-00005",
        cities: [
          {
            operationCityId: "oc-4", cityId: 3170206, stateId: 31, cityName: "Uberlândia", uf: "MG", brExceptions: 0,
            leaders: [leader({ id: "la-7", employeeId: "emp-7", employeeName: "Rogério Batista Nunes", employeeCode: "10901" })],
          },
        ],
      },
      {
        id: "op-2",
        name: "Redespacho - Belém/Pa",
        code: "OP-00007",
        cities: [
          {
            operationCityId: "oc-3", cityId: 1501402, stateId: 15, cityName: "Belém", uf: "PA", brExceptions: 0,
            leaders: [leader({ id: "la-4", employeeId: "emp-4", employeeName: "Renata Alves Moreira", employeeCode: "10077", effectiveFrom: "2026-08-01", effectiveTo: "2026-09-10", status: "ended" })],
          },
        ],
      },
    ],
  };
}

declare global {
  interface Window {
    __cityLeadershipSaves?: CityLeadershipInput[];
  }
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (value: string, days: number) => {
  const [y, m, d] = value.split("-").map(Number);
  return iso(new Date(Date.UTC(y, m - 1, d + days)));
};

/**
 * A gravação da prévia: guarda o que recebeu em `window.__cityLeadershipSaves`
 * e aplica à matriz em memória a mesma regra da rotina — de hoje na competência
 * corrente, o mês inteiro (com motivo) numa passada; a anterior termina na
 * véspera.
 */
export function applyCityLeadership(
  planner: LeadershipPlanner,
  input: CityLeadershipInput,
): { planner: LeadershipPlanner; result: { ok: boolean; error?: string; data?: CityLeadershipResult } } {
  window.__cityLeadershipSaves = [...(window.__cityLeadershipSaves ?? []), input];
  const past = planner.monthEnd < planner.today;
  if (past && !input.reason) {
    return {
      planner,
      result: { ok: false, error: "Informe o motivo da correção histórica: a alteração muda a liderança de dias que já passaram." },
    };
  }
  const from = past ? planner.monthStart : planner.monthStart > planner.today ? planner.monthStart : planner.today;
  let result: CityLeadershipResult | null = null;

  const operations = planner.operations.map((op) => ({
    ...op,
    cities: op.cities.map((city) => {
      if (city.operationCityId !== input.operationCityId) return city;
      const current = leaderAt(city, from);
      const person = planner.candidates.find((c) => c.id === input.employeeId) ?? null;
      if (current && current.employeeId === input.employeeId) {
        result = {
          action: "unchanged", employeeName: current.employeeName, cityName: city.cityName, uf: city.uf,
          effectiveFrom: current.effectiveFrom, effectiveTo: current.effectiveTo, previous: null, retroactive: false, warnings: [],
        };
        return city;
      }
      const cancelled = current ? current.effectiveFrom >= from : false;
      let leaders = city.leaders.flatMap((l) => {
        if (!current || l.id !== current.id) return [l];
        return cancelled ? [] : [{ ...l, effectiveTo: addDays(from, -1) }];
      });
      if (person) {
        leaders = [
          ...leaders,
          {
            id: `novo-${city.operationCityId}-${person.id}`,
            employeeId: person.id,
            employeeName: person.name,
            employeeCode: person.code,
            employeeActive: true,
            effectiveFrom: from,
            effectiveTo: past ? planner.monthEnd : current ? current.effectiveTo : planner.monthEnd,
            status: "active" as const,
            notes: null,
            updatedAt: null,
          },
        ].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
      }
      result = {
        action: person ? (current ? "replaced" : "assigned") : "removed",
        employeeName: person?.name ?? null,
        cityName: city.cityName,
        uf: city.uf,
        effectiveFrom: from,
        effectiveTo: person ? (past ? planner.monthEnd : current ? current.effectiveTo : planner.monthEnd) : null,
        previous: current
          ? {
              employeeName: current.employeeName,
              action: cancelled ? "cancelled" : "ended",
              resumesFrom: past && (!current.effectiveTo || current.effectiveTo > planner.monthEnd) ? addDays(planner.monthEnd, 1) : null,
            }
          : null,
        retroactive: from < planner.today,
        warnings: [],
      };
      return { ...city, leaders };
    }),
  }));

  return {
    planner: { ...planner, operations },
    result: result ? { ok: true, data: result } : { ok: false, error: "Cidade não encontrada." },
  };
}
