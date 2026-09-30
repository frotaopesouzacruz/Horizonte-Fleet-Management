import { StabilityDashboard } from "@/app/(app)/governanca/fidelizacao/stability-dashboard";
import type { FidelizationStability } from "@/lib/governance/brs";

/**
 * O Dashboard de Estabilidade com um mês fixo, no formato exato que
 * `fidelization_stability` devolve. Os números foram escolhidos para que cada
 * cartão possa ser conferido por valor — e para que a distinção da §42 fique
 * visível: 3 mobilizações explícitas (2 substituições + 1 inversão), 16 trocas
 * inferidas à parte, e 96,6% = 1 − 3/88.
 */
const STABILITY: FidelizationStability = {
  competence: "2026-09",
  anchorDate: "2026-09-21",
  periodStart: "2026-09-01",
  periodEnd: "2026-09-30",
  brsTotal: 88,
  brsWithVehicle: 88,
  brsWithVehicleNow: 88,
  brsWithoutVehicleNow: 0,
  brsWithDriver: 0,
  brsWithoutDriver: 88,
  brsWithLeader: 88,
  // 2 substituições + 1 inversão registradas, mais 16 trocas inferidas em 8 pares
  // (8 inversões) em 10 BRs: 11 mobilizações, 13 BRs com troca.
  vehicleSubstitutions: 2,
  vehicleInversions: 9,
  mobilizations: 11,
  explicitSubstitutions: 2,
  explicitInversions: 1,
  explicitMobilizations: 3,
  inferredSubstitutions: 0,
  inferredInversions: 8,
  vehicleChangeLinks: 20,
  brsWithVehicleChange: 13,
  inferredVehicleChanges: 16,
  driverChanges: 0,
  brsWithDriverChange: 0,
  fleetStabilityPct: 85.2,
  driverStabilityPct: null,
  leadershipCoveragePct: 100,
  byOperation: [
    { key: "op-1", label: "Last Mille MG", sublabel: null, brs: 62, withVehicle: 62, mobilizations: 10, brsWithChange: 11, stabilityPct: 82.3 },
    { key: "op-2", label: "Redespacho - Belém", sublabel: null, brs: 26, withVehicle: 26, mobilizations: 1, brsWithChange: 2, stabilityPct: 92.3 },
  ],
  byCity: [
    { key: "Last Mille MG:3118601", label: "Contagem/MG", sublabel: "Last Mille MG", brs: 62, withVehicle: 62, mobilizations: 10, brsWithChange: 11, stabilityPct: 82.3 },
    { key: "Redespacho - Belém:1501402", label: "Belém/PA", sublabel: "Redespacho - Belém", brs: 26, withVehicle: 26, mobilizations: 1, brsWithChange: 2, stabilityPct: 92.3 },
  ],
  byLeader: [
    { key: "emp-1", label: "Marcos Vinícius Andrade", sublabel: null, brs: 62, withVehicle: 62, mobilizations: 10, brsWithChange: 11, stabilityPct: 82.3 },
    { key: "emp-2", label: "Walace Rodrigues Santos", sublabel: null, brs: 26, withVehicle: 26, mobilizations: 1, brsWithChange: 2, stabilityPct: 92.3 },
  ],
  brsRegistered: 90,
  vehiclesFidelized: 91,
  driversFidelized: 12,
  byState: [
    { key: "MG", label: "MG", sublabel: null, brs: 62, withVehicle: 62, mobilizations: 10, brsWithChange: 11, stabilityPct: 82.3 },
    { key: "PA", label: "PA", sublabel: null, brs: 26, withVehicle: 26, mobilizations: 1, brsWithChange: 2, stabilityPct: 92.3 },
  ],
  byVehicleType: [
    { key: "t-van", label: "Van", sublabel: null, brs: 80, withVehicle: 80, mobilizations: 11, brsWithChange: 13, stabilityPct: 83.8 },
    { key: "t-truck", label: "Caminhão 3/4", sublabel: null, brs: 8, withVehicle: 8, mobilizations: 0, brsWithChange: 0, stabilityPct: 100 },
  ],
};

export function PreviewStability() {
  return <StabilityDashboard stability={STABILITY} competence={{ year: 2026, month: 9 }} substitutionsAndInversions={3} />;
}
