import type { Metadata } from "next";
import { requireOrganization } from "@/lib/auth/session";
import {
  getFidelizationIndicators,
  getGovernanceOptions,
  getOperationalHierarchy,
  listDriverPlans,
  listFidelizationHistory,
  listOperationBrs,
  type FidelizationIndicators,
  type HierarchyOperation,
} from "@/lib/governance/queries";
import {
  getBrPlannerIndicators,
  listBrPlannerRows,
  listLeadershipOptions,
  type BrPlannerIndicators,
  type BrPlannerRow,
} from "@/lib/governance/br-planner";
import { getFidelizationStability, type FidelizationStability } from "@/lib/governance/brs";
import {
  getPlannerMatrix,
  listFidelizationImportHistory,
  listMovements,
  listVehicleTypeOptions,
  type FidelizationImportBatch,
  type MovementsPage,
  type PlannerMatrix,
} from "@/lib/governance/fidelization-central";
import { monthEnd, monthStart, parseCompetence } from "@/lib/governance/competence";
import { FidelizationView } from "./fidelization-view";

export const metadata: Metadata = {
  title: "Central de Fidelização",
  description: "Planejamento das BRs por veículo e motorista, por competência, com o histórico de mobilizações.",
};

/** Tamanho de página do Histórico de Mobilizações. */
const MOVEMENTS_PAGE_SIZE = 50;

type SearchParams = Record<string, string | string[] | undefined>;

const first = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
};

/**
 * Governança Operacional → Fidelização (Central de Fidelização, Etapa 15).
 *
 * A rota confere `fidelization.view` no servidor e toda consulta roda com o
 * cliente da própria pessoa — é o escopo de operação dela que decide quais
 * BRs, veículos, motoristas e eventos voltam, não esta página.
 */
export default async function FidelizationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { session, organization } = await requireOrganization("fidelization.view");

  const competence = parseCompetence(first(params, "ano"), first(params, "mes"));
  const filters = {
    operationId: first(params, "operacao"),
    stateId: first(params, "uf"),
    cityId: first(params, "cidade"),
    brId: first(params, "br"),
  };

  /**
   * Os filtros próprios do Planner de Locais e BRs (§25). Somam-se ao recorte
   * da tela — operação, estado e cidade —, não o substituem: quem filtra por
   * "sem veículo" continua olhando a operação que escolheu no cabeçalho.
   */
  const plannerFilters = {
    ...filters,
    q: first(params, "q"),
    status: first(params, "situacao"),
    leaderEmployeeId: first(params, "lideranca"),
    vehicle: first(params, "veiculo"),
    driver: first(params, "motorista"),
  };

  /**
   * Os filtros do Planner de Frotas (§25). Busca, liderança e situação somam-se
   * ao recorte do cabeçalho. `q` e `lideranca` têm o mesmo sentido no Planner de
   * Locais e por isso são compartilhados; a placa digitada é `placa`, porque
   * `veiculo` já quer dizer "com / sem veículo" no Planner de Locais.
   */
  const fleetFilters = {
    ...filters,
    q: first(params, "q"),
    leaderEmployeeId: first(params, "lideranca"),
    vehicle: first(params, "placa"),
    vehicleTypeId: first(params, "tipo_equipamento"),
    situation: first(params, "alocacao"),
  };

  /**
   * Histórico de Mobilizações (§45). Sem "De" e "Até", o histórico mostra a
   * competência em tela — a mesma que as outras áreas mostram. Operação,
   * estado, cidade e liderança vêm do cabeçalho e do planner.
   */
  const movementFilters = {
    dateFrom: first(params, "mov_de"),
    dateTo: first(params, "mov_ate"),
    movementType: first(params, "mov_tipo"),
    subject: first(params, "mov_assunto"),
    vehicle: first(params, "mov_veiculo"),
    driver: first(params, "mov_motorista"),
  };
  const movementPage = Math.max(1, Number(first(params, "mov_pagina") ?? "1") || 1);
  const movementRange =
    movementFilters.dateFrom || movementFilters.dateTo
      ? { dateFrom: movementFilters.dateFrom, dateTo: movementFilters.dateTo }
      : { dateFrom: monthStart(competence), dateTo: monthEnd(competence) };

  const orgId = organization.organizationId;
  const has = (code: string) => session.isPlatformAdmin || session.permissions.includes(code);
  const canImport = has("fidelization.import");
  const canAudit = has("fidelization.audit");

  const [
    brs,
    history,
    driverPlans,
    options,
    hierarchy,
    indicators,
    plannerRows,
    plannerIndicators,
    leaders,
    stability,
    matrix,
    vehicleTypes,
    movements,
    importHistory,
  ] = await Promise.all([
    listOperationBrs(orgId, {
      operationId: filters.operationId,
      stateId: filters.stateId,
      cityId: filters.cityId,
    }),
    listFidelizationHistory(orgId, competence, filters),
    listDriverPlans(orgId, competence, filters),
    getGovernanceOptions(orgId),
    // Perder um painel nunca é motivo para perder a página inteira.
    getOperationalHierarchy(orgId, filters.operationId).catch(() => [] as HierarchyOperation[]),
    getFidelizationIndicators(orgId, competence, filters).catch(
      () => null as FidelizationIndicators | null,
    ),
    listBrPlannerRows(orgId, competence, plannerFilters).catch(() => [] as BrPlannerRow[]),
    getBrPlannerIndicators(orgId, competence, plannerFilters).catch(
      () => null as BrPlannerIndicators | null,
    ),
    listLeadershipOptions(orgId).catch(() => [] as { id: string; name: string }[]),
    // §39: o Dashboard de Estabilidade segue o recorte da tela — operação,
    // estado e cidade — e nunca a BR isolada, que é filtro do planner.
    getFidelizationStability(orgId, competence, {
      operationId: filters.operationId,
      stateId: filters.stateId,
      cityId: filters.cityId,
    }).catch(() => null as FidelizationStability | null),
    getPlannerMatrix(orgId, competence, fleetFilters).catch(() => null as PlannerMatrix | null),
    listVehicleTypeOptions(orgId).catch(() => [] as { id: string; name: string }[]),
    listMovements(
      orgId,
      {
        ...movementFilters,
        ...movementRange,
        operationId: filters.operationId,
        stateId: filters.stateId,
        cityId: filters.cityId,
        brId: filters.brId,
        leaderEmployeeId: fleetFilters.leaderEmployeeId,
      },
      movementPage,
      MOVEMENTS_PAGE_SIZE,
    ).catch(() => null as MovementsPage | null),
    canImport || canAudit
      ? listFidelizationImportHistory(orgId, 20).catch(() => [] as FidelizationImportBatch[])
      : Promise.resolve([] as FidelizationImportBatch[]),
  ]);

  return (
    <FidelizationView
      brs={brs}
      history={history}
      driverPlans={driverPlans}
      hierarchy={hierarchy}
      indicators={indicators}
      stability={stability}
      plannerRows={plannerRows}
      plannerIndicators={plannerIndicators}
      leaders={leaders}
      competence={competence}
      operations={options.operations}
      coverage={options.coverage}
      filters={plannerFilters}
      matrix={matrix}
      fleetFilters={fleetFilters}
      vehicleTypes={vehicleTypes}
      movements={movements}
      movementFilters={movementFilters}
      importHistory={importHistory}
      canPlan={has("fidelization.plan")}
      canChangeVehicle={has("fidelization.change_vehicle")}
      canChangeDriver={has("fidelization.change_driver")}
      canImport={canImport}
      canAudit={canAudit}
      canExport={has("fidelization.export")}
      canManageHistorical={has("fidelization.manage_historical_data")}
    />
  );
}
