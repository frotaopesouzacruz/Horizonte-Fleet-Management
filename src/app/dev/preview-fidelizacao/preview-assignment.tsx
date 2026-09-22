"use client";

import * as React from "react";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AssignmentDrawer } from "@/app/(app)/governanca/fidelizacao/assignment-drawer";
import type { FidelizationRow } from "@/lib/governance/queries";

/**
 * A gaveta de planejamento de uma posição com um vínculo PLANEJADO e já
 * iniciado: é o estado em que as três ações de situação — confirmar, registrar
 * execução e cancelar — ficam todas disponíveis. As ações chamam o servidor,
 * que aqui não existe; o que a prévia permite verificar é o que a tela oferece
 * e o que ela exige antes de chamar.
 */
const HISTORY: FidelizationRow[] = [
  {
    id: "as-1",
    operationBrId: "br-1",
    brCode: "BR0024706",
    operationId: "op-1",
    operationName: "Last Mille MG",
    stateUf: "MG",
    cityName: "Contagem",
    vehicleId: "veh-1",
    fleetCode: "FR-0142",
    licensePlate: "SNO1J56",
    vehicleTypeName: "Van",
    vehicleMakeName: "Renault",
    vehicleModelName: "Master",
    vehicleRole: "primary",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    status: "planned",
    source: "import",
    reason: null,
    endReason: null,
    replacesAssignmentId: null,
    isCurrent: true,
    updatedAt: null,
  },
];

export function PreviewAssignment() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="secondary" leadingIcon={<CalendarDays />} onClick={() => setOpen(true)}>
        Planejamento (prévia)
      </Button>
      <AssignmentDrawer
        key={String(open)}
        open={open}
        onOpenChange={setOpen}
        br={{ id: "br-1", code: "BR0024706", cityName: "Contagem", stateUf: "MG", operationName: "Last Mille MG" }}
        competence={{ year: 2026, month: 9 }}
        history={HISTORY}
        canPlan
        canChangeVehicle
        canChangeDriver
      />
    </>
  );
}
