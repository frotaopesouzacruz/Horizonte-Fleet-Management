import Link from "next/link";
import { Building2, MapPin, Network, Users } from "lucide-react";
import type { OperationSummary, WorkLocationRow } from "@/lib/organization/queries";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const number = new Intl.NumberFormat("pt-BR");

export interface OperationsViewProps {
  operations: OperationSummary[];
  locations: WorkLocationRow[];
}

/**
 * Operações, as rendered.
 *
 * Kept apart from the route so the screen is a function of its data: the page
 * decides who may see it and fetches, this decides what it looks like. Nothing
 * here is a client component — none of it is interactive yet.
 */
export function OperationsView({ operations, locations }: OperationsViewProps) {
  const employees = operations.reduce((sum, o) => sum + o.employeeCount, 0);
  const withAccess = operations.reduce((sum, o) => sum + o.accessCount, 0);
  const unresolved = locations.filter((l) => l.cityId === null);
  const states = new Set(locations.map((l) => l.uf).filter(Boolean));

  return (
    <>
      <PageHeader
        title="Operações"
        description="Cada operação reúne pessoas, locais de trabalho e, em breve, a frota alocada a ela."
      />

      <PageContent className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Operações" value={number.format(operations.length)} icon={<Network />} />
          <KpiCard label="Colaboradores" value={number.format(employees)} icon={<Users />} />
          <KpiCard
            label="Com acesso ao sistema"
            value={number.format(withAccess)}
            icon={<Building2 />}
            period={`de ${number.format(employees)} colaboradores`}
          />
          <KpiCard
            label="Locais de trabalho"
            value={number.format(locations.length)}
            icon={<MapPin />}
            period={states.size > 0 ? `em ${number.format(states.size)} UF` : undefined}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Operações</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <TableContainer className="rounded-none border-0 border-t">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Operação</TableHead>
                    <TableHead numeric>Colaboradores</TableHead>
                    <TableHead numeric>Com acesso</TableHead>
                    <TableHead numeric>Locais</TableHead>
                    <TableHead>Situação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {operations.map((operation) => (
                    <TableRow key={operation.id}>
                      <TableCell className="font-medium text-fg">{operation.name}</TableCell>
                      <TableCell numeric>{number.format(operation.employeeCount)}</TableCell>
                      <TableCell numeric>
                        {operation.accessCount === 0 ? (
                          <span className="text-fg-muted">—</span>
                        ) : (
                          number.format(operation.accessCount)
                        )}
                      </TableCell>
                      <TableCell numeric>{number.format(operation.locationCount)}</TableCell>
                      <TableCell>
                        <Badge variant={operation.status === "active" ? "success" : "neutral"} appearance="soft" dot>
                          {operation.status === "active" ? "Ativa" : operation.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Locais de trabalho</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {unresolved.length > 0 ? (
              <p className="border-t border-border px-4 py-3 text-body-sm text-fg-secondary">
                {unresolved.length === 1
                  ? "Um local ainda não tem município definido"
                  : `${unresolved.length} locais ainda não têm município definido`}
                {": o nome cadastrado corresponde a mais de um município brasileiro. "}
                Confirme qual é o correto em{" "}
                <Link href="/organizacao/estados" className="text-link underline hover:text-link-hover">
                  Estados e cidades
                </Link>
                .
              </p>
            ) : null}
            <TableContainer className="rounded-none border-0 border-t">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Local</TableHead>
                    <TableHead>Município</TableHead>
                    <TableHead>UF</TableHead>
                    <TableHead numeric>Código IBGE</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {locations.map((location) => (
                    <TableRow key={location.id}>
                      <TableCell className="font-medium text-fg">{location.name}</TableCell>
                      <TableCell>
                        {location.cityName ?? (
                          <Badge variant="warning" appearance="soft">
                            a definir
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{location.uf ?? <span className="text-fg-muted">—</span>}</TableCell>
                      <TableCell numeric className="font-mono text-caption">
                        {location.cityId ?? <span className="text-fg-muted">—</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      </PageContent>
    </>
  );
}
