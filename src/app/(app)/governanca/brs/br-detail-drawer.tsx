"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarDays, History, Pencil, UserCog } from "lucide-react";
import {
  Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { KpiCard } from "@/components/ui/kpi-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { LoadingState } from "@/components/feedback/loading-state";
import type { BrFormValue } from "@/components/governance/brs/br-form-drawer";
import { loadBrDetail } from "@/lib/governance/actions";
import type { BrDetail, OperationalContext } from "@/lib/governance/brs";
import { formatCompetence, type Competence } from "@/lib/governance/competence";
import {
  ASSIGNMENT_STATUS_LABEL, LEADER_SCOPE_LABEL, SOURCE_LABEL, formatDate, formatDateTime, formatPeriod, number,
} from "./br-labels";
import {
  DriverHistoryTable, LeadershipHistoryTable, MovementsTable, VehicleHistoryTable,
} from "./br-detail-history";

export interface BrDetailDrawerProps {
  brId: string | null;
  competence: Competence;
  onClose: () => void;
  canPlan: boolean;
  canManageBrs: boolean;
  /** Recebe o valor completo do cadastro — observações e `updatedAt` inclusos — para o formulário. */
  onEdit?: (value: BrFormValue) => void;
}

/* ------------------------------------------------------------------ helpers */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="text-body-sm text-fg">{children ?? <span className="text-fg-muted">—</span>}</dd>
    </div>
  );
}

const text = (value: string | null | undefined) =>
  value ? value : <span className="text-fg-muted">—</span>;

/** Um bloco do contexto na data-âncora: título, o que vale, e a ausência dita por extenso. */
function ContextBlock({
  title, empty, children,
}: { title: string; empty?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-surface p-3">
      <span className="text-caption font-medium text-fg-secondary">{title}</span>
      {children ?? <span className="text-body-sm text-fg-muted">{empty}</span>}
    </div>
  );
}

/**
 * §45/§47: o que valia nesta posição na data-âncora — o mesmo serviço de
 * contexto que Aderência e Check List consomem. Cada recurso ausente é dito
 * por extenso: "Sem veículo na data" é uma informação, um traço não é.
 */
function ContextSection({
  context, anchorDate, competence, canPlan, planHref,
}: {
  context: OperationalContext | null;
  anchorDate: string;
  competence: Competence;
  canPlan: boolean;
  planHref: string;
}) {
  const vehicle = context?.vehicle ?? null;
  const driver = context?.driver ?? null;
  const leadership = context?.leadership ?? null;
  const unit = context?.unit ?? null;

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-body-sm font-semibold text-fg">
        Contexto em {formatDate(anchorDate)}
        <span className="ml-1.5 font-normal text-fg-muted">— a data que representa {formatCompetence(competence)}</span>
      </h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <ContextBlock title="Veículo" empty="Sem veículo na data">
          {vehicle ? (
            <>
              <span className="text-body-sm font-medium text-fg">
                {vehicle.licensePlate ?? vehicle.fleetCode ?? "—"}
                {vehicle.fleetCode && vehicle.fleetCode !== vehicle.licensePlate ? (
                  <span className="font-normal text-fg-muted"> · frota {vehicle.fleetCode}</span>
                ) : null}
              </span>
              <span className="text-caption text-fg-secondary">
                {vehicle.vehicleTypeName ?? "Tipo não informado"} · {formatPeriod(vehicle.effectiveFrom, vehicle.effectiveTo)}
              </span>
              <span className="flex flex-wrap items-center gap-1.5 text-caption text-fg-muted">
                <Badge variant="neutral" size="sm">{SOURCE_LABEL[vehicle.source] ?? vehicle.source}</Badge>
                <span>{ASSIGNMENT_STATUS_LABEL[vehicle.status] ?? vehicle.status}</span>
                {context?.origins.vehicle ? <span>· origem: {context.origins.vehicle}</span> : null}
              </span>
            </>
          ) : undefined}
        </ContextBlock>

        <ContextBlock title="Motorista" empty="Sem motorista">
          {driver ? (
            <>
              <span className="text-body-sm font-medium text-fg">{driver.name}</span>
              <span className="text-caption text-fg-secondary">
                {driver.employeeCode ? `Matrícula ${driver.employeeCode} · ` : ""}
                {formatPeriod(driver.effectiveFrom, driver.effectiveTo)}
              </span>
            </>
          ) : undefined}
        </ContextBlock>

        <ContextBlock title="Liderança" empty="Sem liderança definida">
          {leadership ? (
            <>
              <span className="text-body-sm font-medium text-fg">{leadership.name}</span>
              {/* §43: a regra que respondeu fica dita — exceção do BR, cidade ou operação. */}
              <span className="text-caption text-fg-secondary">
                Regra: {leadership.rule || LEADER_SCOPE_LABEL[leadership.scopeLevel]}
              </span>
              <span className="text-caption text-fg-muted">
                {formatPeriod(leadership.effectiveFrom, leadership.effectiveTo)}
              </span>
            </>
          ) : undefined}
        </ContextBlock>

        <ContextBlock title="Filial" empty="Sem filial vinculada">
          {unit ? (
            <span className="text-body-sm font-medium text-fg">
              {unit.code ? <span className="font-normal text-fg-muted">{unit.code} · </span> : null}
              {unit.name}
            </span>
          ) : undefined}
        </ContextBlock>
      </div>
      {!vehicle && canPlan ? (
        <p className="text-caption text-fg-muted">
          A posição está vaga nesta data.{" "}
          <Link href={planHref} className="text-primary-soft-fg underline-offset-2 hover:underline">
            Planejar um veículo na Fidelização
          </Link>
          .
        </p>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------- drawer */

/**
 * Detalhe completo de uma BR na competência (§29): dados cadastrais, contexto
 * na data-âncora, as lideranças que a alcançam, os veículos e motoristas que
 * passaram por ela, as movimentações com o ator real e os indicadores do mês.
 *
 * Carregado ao abrir, não junto com a tela: 50 posições × cinco históricos
 * seria a consulta mais cara do módulo para responder uma pergunta que se faz
 * uma de cada vez.
 */
export function BrDetailDrawer({
  brId, competence, onClose, canPlan, canManageBrs, onEdit,
}: BrDetailDrawerProps) {
  return (
    <Drawer open={Boolean(brId)} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent size="xl">
        {/* A identidade da BR e a competência são a chave do conteúdo: trocar
            de posição ou de mês remonta o painel em vez de mostrar o detalhe
            anterior sob outro título. */}
        {brId ? (
          <DetailContent
            key={`${brId}:${competence.year}-${competence.month}`}
            brId={brId}
            competence={competence}
            canPlan={canPlan}
            canManageBrs={canManageBrs}
            onEdit={onEdit}
          />
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}

function DetailContent({
  brId, competence, canPlan, canManageBrs, onEdit,
}: Omit<BrDetailDrawerProps, "brId" | "onClose"> & { brId: string }) {
  const [detail, setDetail] = React.useState<BrDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, startTransition] = React.useTransition();
  const { year, month } = competence;

  React.useEffect(() => {
    let cancelled = false;
    startTransition(async () => {
      try {
        const result = await loadBrDetail(brId, { year, month });
        if (cancelled) return;
        if (result.ok && result.data) setDetail(result.data);
        else setError(result.error ?? "Não foi possível carregar o detalhe desta BR.");
      } catch {
        // Uma leitura acionada por clique nunca derruba a tela: sem sessão ou
        // sem banco, o painel diz isso e fica de pé.
        if (!cancelled) setError("Não foi possível carregar o detalhe desta BR.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [brId, year, month]);

  const br = detail?.br ?? null;
  const ind = detail?.indicators ?? null;

  const fidelizationHref = br
    ? `/governanca/fidelizacao?br=${encodeURIComponent(br.id)}&operacao=${encodeURIComponent(br.operationId)}&uf=${br.stateId}&cidade=${br.cityId}&ano=${year}&mes=${month}`
    : "/governanca/fidelizacao";
  const leadershipHref = br
    ? `/governanca/liderancas?operacao=${encodeURIComponent(br.operationId)}&ano=${year}&mes=${month}`
    : "/governanca/liderancas";
  // A trilha da BR: cada troca de veículo ou motorista, com quem registrou e a
  // liderança na data, no Histórico de Mobilizações da Central (Etapa 15).
  const movementsHref = br ? `${fidelizationHref}&aba=historico` : "/governanca/fidelizacao?aba=historico";

  return (
    <>
      <DrawerHeader>
        <div className="flex flex-wrap items-center gap-2">
          <DrawerTitle>{br ? `BR ${br.code}` : "Detalhe da BR"}</DrawerTitle>
          {br ? (
            <StatusBadge status={br.status === "active" ? "success" : "neutral"}>
              {br.status === "active" ? "Ativa" : "Inativa"}
            </StatusBadge>
          ) : null}
        </div>
        <DrawerDescription>
          {br
            ? [br.description, `${br.operationName} · ${br.cityName}/${br.stateUf}`].filter(Boolean).join(" — ")
            : "A posição operacional, o que a ocupa na competência e tudo o que já passou por ela."}
        </DrawerDescription>
      </DrawerHeader>

      <DrawerBody className="flex flex-col gap-4">
        {loading && !detail && !error ? (
          <LoadingState variant="block" label="Carregando o detalhe da BR…" />
        ) : null}

        {error ? (
          <Alert variant="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {detail && br ? (
          <Tabs defaultValue="dados">
            <TabsList>
              <TabsTrigger value="dados">Dados</TabsTrigger>
              <TabsTrigger value="lideranca" count={detail.leadershipHistory.length}>Liderança</TabsTrigger>
              <TabsTrigger value="veiculos" count={detail.vehicleHistory.length}>Veículos</TabsTrigger>
              <TabsTrigger value="motoristas" count={detail.driverHistory.length}>Motoristas</TabsTrigger>
              <TabsTrigger value="movimentacoes" count={detail.movements.length}>Movimentações</TabsTrigger>
              <TabsTrigger value="indicadores">Indicadores</TabsTrigger>
            </TabsList>

            {/* ------------------------------------------------------ dados */}
            <TabsContent value="dados" className="flex flex-col gap-5">
              <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                <Field label="Código">{br.code}</Field>
                <Field label="Descrição">{text(br.description)}</Field>
                <Field label="Situação">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={br.status === "active" ? "success" : "neutral"}>
                      {br.status === "active" ? "Ativa" : "Inativa"}
                    </StatusBadge>
                    {br.statusReason ? <span className="text-caption text-fg-muted">{br.statusReason}</span> : null}
                  </span>
                </Field>
                <Field label="Observações">{text(br.notes)}</Field>
                <Field label="Operação">
                  {br.operationCode ? <span className="text-fg-muted">{br.operationCode} · </span> : null}
                  {br.operationName}
                </Field>
                <Field label="Estado">{br.stateUf}</Field>
                <Field label="Cidade">{br.cityName}</Field>
                <Field label="Criado em">
                  <span className="tabular-nums">{formatDateTime(br.createdAt)}</span>
                </Field>
                <Field label="Atualizado em">
                  <span className="tabular-nums">{formatDateTime(br.updatedAt)}</span>
                </Field>
              </dl>

              <ContextSection
                context={detail.context}
                anchorDate={detail.anchorDate}
                competence={competence}
                canPlan={canPlan}
                planHref={fidelizationHref}
              />
            </TabsContent>

            {/* -------------------------------------------------- históricos */}
            <TabsContent value="lideranca">
              <LeadershipHistoryTable rows={detail.leadershipHistory} />
            </TabsContent>
            <TabsContent value="veiculos">
              <VehicleHistoryTable rows={detail.vehicleHistory} />
            </TabsContent>
            <TabsContent value="motoristas">
              <DriverHistoryTable rows={detail.driverHistory} />
            </TabsContent>
            <TabsContent value="movimentacoes">
              <MovementsTable rows={detail.movements} />
            </TabsContent>

            {/* ------------------------------------------------- indicadores */}
            <TabsContent value="indicadores" className="flex flex-col gap-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <KpiCard
                  size="compact"
                  label="Dias com veículo"
                  value={number.format(ind?.daysWithVehicle ?? 0)}
                  period={`de ${number.format(ind?.daysInPeriod ?? 0)} dias em ${formatCompetence(competence)}`}
                />
                <KpiCard
                  size="compact"
                  label="Substituições de veículo"
                  value={number.format(ind?.vehicleSwapsInPeriod ?? 0)}
                  period={formatCompetence(competence)}
                />
                <KpiCard
                  size="compact"
                  label="Trocas de motorista"
                  value={number.format(ind?.driverChangesInPeriod ?? 0)}
                  period={formatCompetence(competence)}
                />
                <KpiCard
                  size="compact"
                  label="Checklists no período"
                  value={number.format(ind?.checklistsInPeriod ?? 0)}
                  period={formatCompetence(competence)}
                />
                <KpiCard
                  size="compact"
                  label="Aderência"
                  value={`${number.format(ind?.adherenceDoneInPeriod ?? 0)} de ${number.format(ind?.adherenceExpectedInPeriod ?? 0)}`}
                  period="checklists feitos de esperados"
                />
              </div>
              <p className="text-caption text-fg-muted">
                Indicadores da competência {formatCompetence(competence)}, contados sobre os vínculos desta
                posição — nunca sobre a placa, que pode ter estado em outra BR no mesmo mês.
              </p>
            </TabsContent>
          </Tabs>
        ) : null}
      </DrawerBody>

      <DrawerFooter className="sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild variant="secondary" size="sm">
            <Link href={fidelizationHref}>
              <CalendarDays aria-hidden />
              Abrir na Fidelização
            </Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link href={movementsHref}>
              <History aria-hidden />
              Histórico de mobilizações
            </Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link href={leadershipHref}>
              <UserCog aria-hidden />
              Ver lideranças
            </Link>
          </Button>
        </div>
        {canManageBrs && onEdit && br ? (
          <Button
            size="sm"
            leadingIcon={<Pencil />}
            onClick={() =>
              onEdit({
                id: br.id,
                operationId: br.operationId,
                operationCityId: br.operationCityId,
                code: br.code,
                description: br.description,
                notes: br.notes,
                updatedAt: br.updatedAt,
              })
            }
          >
            Editar
          </Button>
        ) : null}
      </DrawerFooter>
    </>
  );
}
