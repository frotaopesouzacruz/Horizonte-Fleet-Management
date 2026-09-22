"use client";

import * as React from "react";
import { Building2, MapPin, Truck, UserRound } from "lucide-react";
import {
  Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { LoadingState } from "@/components/feedback/loading-state";
import { loadLeadershipScopeSummary, type Result } from "@/lib/governance/actions";
import type { LeadershipScopeSummary } from "@/lib/governance/brs";
import { formatCompetence, type Competence } from "@/lib/governance/competence";

const number = new Intl.NumberFormat("pt-BR");

function formatDate(value: string | null): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  return d ? `${d}/${m}/${y}` : value;
}

/** De onde veio a regra que pôs esta BR sob a liderança — §43, dito e não só mostrado. */
const RULE_LABEL: Record<LeadershipScopeSummary["brs"][number]["scopeLevel"], string> = {
  br: "exceção do BR",
  city: "cidade",
  operation: "operação",
};

export type LeaderScopeLoader = (
  employeeId: string,
  competence: Competence,
) => Promise<Result<LeadershipScopeSummary>>;

export interface LeaderScopeDrawerProps {
  leader: { id: string; name: string; code: string | null } | null;
  competence: Competence;
  onClose: () => void;
  /** A prévia de desenvolvimento injeta dados fixos; a tela real usa a server action. */
  loader?: LeaderScopeLoader;
}

/**
 * O que esta liderança responde (§35).
 *
 * Uma liderança designada para uma cidade responde por todas as BRs daquela
 * cidade — menos as que têm exceção própria. A lista que vem do servidor já é
 * o resultado dessa precedência (exceção do BR → cidade → operação, §43),
 * resolvida na data-âncora da competência; a tela não recalcula nada, só diz
 * qual regra respondeu por cada BR.
 *
 * Carregado ao abrir e não junto com a tela: ninguém pergunta por todas as
 * lideranças ao mesmo tempo, e o resumo de cada uma custa uma consulta.
 */
export function LeaderScopeDrawer({
  leader,
  competence,
  onClose,
  loader = loadLeadershipScopeSummary,
}: LeaderScopeDrawerProps) {
  return (
    <Drawer open={Boolean(leader)} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent size="md">
        <DrawerHeader>
          <DrawerTitle>{leader ? leader.name : "Liderança"}</DrawerTitle>
          <DrawerDescription>
            {leader
              ? `${leader.code ? `Matrícula ${leader.code} · ` : ""}O que responde em ${formatCompetence(competence)}.`
              : null}
          </DrawerDescription>
        </DrawerHeader>

        {/* A pessoa e a competência são a chave do corpo: trocar qualquer uma
            remonta o painel em vez de mostrar o escopo anterior sob outro nome. */}
        {leader ? (
          <ScopeBody
            key={`${leader.id}:${competence.year}-${competence.month}`}
            employeeId={leader.id}
            competence={competence}
            loader={loader}
          />
        ) : null}

        <DrawerFooter>
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function ScopeBody({
  employeeId,
  competence,
  loader,
}: {
  employeeId: string;
  competence: Competence;
  loader: LeaderScopeLoader;
}) {
  const [summary, setSummary] = React.useState<LeadershipScopeSummary | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, startTransition] = React.useTransition();

  // Depende de ano e mês, não do objeto: uma nova identidade com os mesmos
  // valores não é motivo para consultar o servidor de novo.
  const { year, month } = competence;
  React.useEffect(() => {
    let cancelled = false;
    startTransition(async () => {
      const result = await loader(employeeId, { year, month });
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error ?? "Não foi possível carregar o escopo desta liderança.");
        return;
      }
      setSummary(result.data ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [employeeId, year, month, loader]);

  return (
    <DrawerBody className="flex flex-col gap-4">
      {error ? (
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {loading && !summary ? (
        <LoadingState variant="block" label="Carregando o escopo…" />
      ) : null}

      {summary ? (
        <>
          <dl className="grid grid-cols-3 gap-2" aria-label="Totais sob responsabilidade">
            <div className="rounded-md border border-border bg-surface px-3 py-2">
              <dt className="text-caption text-fg-muted">BRs</dt>
              <dd className="text-h3 font-semibold tabular-nums text-fg">
                {number.format(summary.brsTotal)}
              </dd>
            </div>
            <div className="rounded-md border border-border bg-surface px-3 py-2">
              <dt className="text-caption text-fg-muted">Veículos</dt>
              <dd className="text-h3 font-semibold tabular-nums text-fg">
                {number.format(summary.vehiclesTotal)}
              </dd>
            </div>
            <div className="rounded-md border border-border bg-surface px-3 py-2">
              <dt className="text-caption text-fg-muted">Motoristas</dt>
              <dd className="text-h3 font-semibold tabular-nums text-fg">
                {number.format(summary.driversTotal)}
              </dd>
            </div>
          </dl>

          <section aria-labelledby="scope-operations" className="flex flex-col gap-1.5">
            <h3 id="scope-operations" className="flex items-center gap-1.5 text-body-sm font-semibold text-fg">
              <Building2 aria-hidden className="size-4 text-fg-muted" />
              Operações
            </h3>
            {summary.operations.length === 0 ? (
              <p className="text-body-sm text-fg-muted">—</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {summary.operations.map((o) => (
                  <li key={o.operationId}>
                    <Badge variant="neutral" appearance="soft">{o.operationName}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="scope-cities" className="flex flex-col gap-1.5">
            <h3 id="scope-cities" className="flex items-center gap-1.5 text-body-sm font-semibold text-fg">
              <MapPin aria-hidden className="size-4 text-fg-muted" />
              Cidades
            </h3>
            {summary.cities.length === 0 ? (
              <p className="text-body-sm text-fg-muted">—</p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {summary.cities.map((c) => (
                  <li key={c.operationCityId} className="text-body-sm text-fg">
                    {c.cityName}/{c.stateUf}
                    <span className="text-fg-muted"> · {c.operationName}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="scope-brs" className="flex flex-col gap-1.5">
            <h3 id="scope-brs" className="flex items-center gap-1.5 text-body-sm font-semibold text-fg">
              <Truck aria-hidden className="size-4 text-fg-muted" />
              BRs
            </h3>
            <TableContainer>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Código</TableHead>
                    <TableHead>Operação</TableHead>
                    <TableHead>Cidade/UF</TableHead>
                    <TableHead>Origem da regra</TableHead>
                    <TableHead>Veículo</TableHead>
                    <TableHead>Motorista</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.brs.length === 0 ? (
                    <TableEmpty
                      colSpan={6}
                      icon={<UserRound />}
                      message={`Nenhuma BR sob esta liderança em ${formatCompetence(competence)}.`}
                    />
                  ) : (
                    summary.brs.map((br) => (
                      <TableRow key={br.id}>
                        <TableCell className="font-medium text-fg">{br.code}</TableCell>
                        <TableCell>{br.operationName}</TableCell>
                        <TableCell>
                          {br.cityName}/{br.stateUf}
                        </TableCell>
                        <TableCell>
                          <Badge variant={br.scopeLevel === "br" ? "primary" : "neutral"} appearance="soft" size="sm">
                            {RULE_LABEL[br.scopeLevel]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {br.licensePlate ?? br.fleetCode ? (
                            <>
                              <span className="text-fg">{br.licensePlate ?? br.fleetCode}</span>
                              {br.fleetCode && br.licensePlate && br.fleetCode !== br.licensePlate ? (
                                <span className="block text-caption text-fg-muted">frota {br.fleetCode}</span>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-fg-muted">Sem veículo</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {br.driverName ?? <span className="text-fg-muted">—</span>}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </section>

          {/* §43: a precedência fica dita — sem isso, uma BR listada sob a
              liderança da cidade pareceria uma designação direta que não existe. */}
          <p className="text-caption text-fg-muted">
            Resolvido em {formatDate(summary.anchorDate)} pela precedência exceção do BR → cidade →
            operação: a regra mais específica responde pela BR, e cada BR conta uma vez.
          </p>
        </>
      ) : null}
    </DrawerBody>
  );
}
