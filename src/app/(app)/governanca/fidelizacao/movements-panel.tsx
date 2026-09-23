"use client";

import * as React from "react";
import { ArrowRight, History, Link2, ListFilter, ScanSearch, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { Pagination } from "@/components/ui/pagination";
import { SearchField } from "@/components/ui/search-field";
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { NativeSelect } from "@/components/governance/selects";
import type { MovementRow, MovementsPage, MovementType } from "@/lib/governance/fidelization-central";

/* ------------------------------------------------------------------ tipos */

type MovementSubject = "vehicle" | "driver" | "any";

interface MovementTypeMeta {
  label: string;
  subject: MovementSubject;
  /** Tom semântico do selo: troca = informação, saída = atenção/neutro, entrada = sucesso. */
  tone: BadgeVariant;
}

/**
 * Os rótulos repetem `MOVEMENT_TYPES` de `fidelization-central.ts` palavra por
 * palavra. Aquele módulo é `server-only` — um componente cliente não pode
 * importar valores dele, só tipos — e o `Record<MovementType, …>` garante que
 * um tipo novo no banco não passe por aqui sem rótulo.
 */
export const MOVEMENT_TYPE_META: Record<MovementType, MovementTypeMeta> = {
  first_allocation: { label: "Primeira alocação", subject: "vehicle", tone: "success" },
  vehicle_allocation: { label: "Alocação de veículo", subject: "vehicle", tone: "accent" },
  vehicle_substitution: { label: "Substituição de veículo", subject: "vehicle", tone: "info" },
  vehicle_inversion: { label: "Inversão de placas", subject: "vehicle", tone: "primary" },
  vehicle_removal: { label: "Remoção de veículo", subject: "vehicle", tone: "warning" },
  vehicle_return: { label: "Retorno de veículo", subject: "vehicle", tone: "success" },
  vehicle_end: { label: "Encerramento de vínculo", subject: "vehicle", tone: "neutral" },
  driver_allocation: { label: "Vinculação de motorista", subject: "driver", tone: "accent" },
  driver_substitution: { label: "Substituição de motorista", subject: "driver", tone: "info" },
  driver_end: { label: "Encerramento do motorista", subject: "driver", tone: "neutral" },
  administrative_correction: { label: "Correção administrativa", subject: "any", tone: "warning" },
  cancellation: { label: "Cancelamento de planejamento", subject: "any", tone: "neutral" },
};

const TYPE_ORDER = Object.keys(MOVEMENT_TYPE_META) as MovementType[];

const TYPE_GROUPS: { label: string; subject: MovementSubject }[] = [
  { label: "Veículo", subject: "vehicle" },
  { label: "Motorista", subject: "driver" },
  { label: "Ambos", subject: "any" },
];

function typeMeta(type: string): MovementTypeMeta {
  return MOVEMENT_TYPE_META[type as MovementType] ?? { label: type, subject: "any", tone: "neutral" };
}

/** A origem com nome: quem (ou o quê) gravou o evento. */
export const MOVEMENT_ORIGIN_LABEL: Record<string, string> = {
  user: "Usuário",
  import: "Importação",
  replication: "Replicação",
  system: "Rotina",
  reconstructed: "Reconstruído",
};

const ROLE_LABEL: Record<string, string> = { primary: "Principal", secondary: "Secundário" };

/**
 * Cores das marcas "mesma operação". Vêm da paleta de gráficos porque ela já
 * foi validada para se distinguir entre si nos dois temas; a cor só liga
 * visualmente as linhas — o texto "Mesma operação" é que carrega o sentido.
 */
const LINK_COLORS = ["bg-chart-1", "bg-chart-3", "bg-chart-5", "bg-chart-2", "bg-chart-4"] as const;

/* -------------------------------------------------------------- formatação */

const number = new Intl.NumberFormat("pt-BR");

function formatDate(value: string | null): string {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-");
  return d ? `${d}/${m}/${y}` : value;
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ------------------------------------------------------------------ props */

export interface MovementsPanelFilters {
  dateFrom?: string;
  dateTo?: string;
  movementType?: string;
  subject?: string;
  vehicle?: string;
  driver?: string;
}

export interface MovementsPanelProps {
  movements: MovementsPage | null;
  filters: MovementsPanelFilters;
  competenceLabel: string;
  onNavigate: (patch: Record<string, string | null>) => void;
  pending: boolean;
  /**
   * Lideranças para o filtro (§45). O parâmetro é o mesmo `lideranca` dos
   * planners: escolher aqui recorta também o Planner de Frotas, e vice-versa.
   * Sem a lista, o filtro não aparece.
   */
  leaders?: { id: string; name: string }[];
  leaderEmployeeId?: string;
}

interface LinkMark {
  color: string;
  position: number;
  size: number;
}

/**
 * Eventos que nasceram na mesma transação (as duas linhas de uma inversão, uma
 * substituição e o motorista que a acompanhou) compartilham `correlationKey`.
 * A marca só aparece quando a página tem mais de um evento da mesma chave — um
 * evento sozinho não tem com quem se ligar.
 */
function linkMarks(rows: MovementRow[]): Map<string, LinkMark> {
  const byKey = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.correlationKey) continue;
    const ids = byKey.get(row.correlationKey) ?? [];
    ids.push(row.id);
    byKey.set(row.correlationKey, ids);
  }
  const marks = new Map<string, LinkMark>();
  let colorIndex = 0;
  for (const ids of byKey.values()) {
    if (ids.length < 2) continue;
    const color = LINK_COLORS[colorIndex % LINK_COLORS.length];
    colorIndex += 1;
    ids.forEach((id, index) => marks.set(id, { color, position: index + 1, size: ids.length }));
  }
  return marks;
}

/**
 * Histórico de Mobilizações (Etapa 15, §41–§45).
 *
 * Cada alteração efetiva de veículo ou motorista numa BR é um evento imutável,
 * gravado com a liderança vigente na data, a origem e quem registrou. A tela só
 * lê: corrigir um evento é registrar outro, nunca editar este. Os filtros de
 * operação, estado, cidade e liderança são os do cabeçalho da página e chegam
 * aplicados pelo servidor; os daqui ficam na URL com o prefixo `mov_`.
 */
export function MovementsPanel({
  movements,
  filters,
  competenceLabel,
  onNavigate,
  pending,
  leaders,
  leaderEmployeeId,
}: MovementsPanelProps) {
  const setFilter = (patch: Record<string, string | null>) => onNavigate({ ...patch, mov_pagina: null });

  const activeType = filters.movementType ?? "";
  const withLeaders = Boolean(leaders && leaders.length > 0);
  const hasFilters = Boolean(
    filters.dateFrom ||
      filters.dateTo ||
      filters.movementType ||
      filters.subject ||
      filters.vehicle ||
      filters.driver ||
      (withLeaders && leaderEmployeeId),
  );
  const clearFilters = () =>
    setFilter({
      mov_de: null,
      mov_ate: null,
      mov_tipo: null,
      mov_assunto: null,
      mov_veiculo: null,
      mov_motorista: null,
      ...(withLeaders ? { lideranca: null } : {}),
    });

  return (
    <section aria-label="Histórico de mobilizações" className="flex min-w-0 flex-col gap-4">
      <Card>
        <CardHeader
          title="Histórico de mobilizações"
          description="Cada troca de veículo ou motorista numa BR é um evento imutável, com a liderança vigente na data, a origem e quem registrou. Correções entram como novos eventos — nenhum é editado."
        />
        <CardContent className="flex flex-col gap-3">
          <div
            className={cn(
              "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3",
              withLeaders ? "lg:grid-cols-4 2xl:grid-cols-7" : "2xl:grid-cols-6",
            )}
          >
            <FilterField id="mov-de" label="De">
              <DateInput
                id="mov-de"
                size="sm"
                value={filters.dateFrom ?? ""}
                max={filters.dateTo || undefined}
                disabled={pending}
                onChange={(e) => setFilter({ mov_de: e.target.value || null })}
              />
            </FilterField>
            <FilterField id="mov-ate" label="Até">
              <DateInput
                id="mov-ate"
                size="sm"
                value={filters.dateTo ?? ""}
                min={filters.dateFrom || undefined}
                disabled={pending}
                onChange={(e) => setFilter({ mov_ate: e.target.value || null })}
              />
            </FilterField>
            <FilterField id="mov-tipo" label="Tipo de movimentação">
              <NativeSelect
                id="mov-tipo"
                fieldSize="sm"
                value={activeType}
                disabled={pending}
                onChange={(e) => setFilter({ mov_tipo: e.target.value || null })}
              >
                <option value="">Todos os tipos</option>
                {TYPE_GROUPS.map((group) => (
                  <optgroup key={group.subject} label={group.label}>
                    {TYPE_ORDER.filter((t) => MOVEMENT_TYPE_META[t].subject === group.subject).map((t) => (
                      <option key={t} value={t}>
                        {MOVEMENT_TYPE_META[t].label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </NativeSelect>
            </FilterField>
            <FilterField id="mov-assunto" label="Assunto">
              <NativeSelect
                id="mov-assunto"
                fieldSize="sm"
                value={filters.subject ?? ""}
                disabled={pending}
                onChange={(e) => setFilter({ mov_assunto: e.target.value || null })}
              >
                <option value="">Veículo e motorista</option>
                <option value="vehicle">Veículo</option>
                <option value="driver">Motorista</option>
              </NativeSelect>
            </FilterField>
            <FilterField id="mov-veiculo" label="Placa ou frota">
              <CommitSearch
                key={`veiculo-${filters.vehicle ?? ""}`}
                id="mov-veiculo"
                label="Placa ou frota"
                placeholder="Ex.: FR-0142 ou SNO1J56"
                value={filters.vehicle ?? ""}
                disabled={pending}
                onCommit={(v) => setFilter({ mov_veiculo: v })}
              />
            </FilterField>
            <FilterField id="mov-motorista" label="Motorista">
              <CommitSearch
                key={`motorista-${filters.driver ?? ""}`}
                id="mov-motorista"
                label="Motorista"
                placeholder="Nome ou matrícula"
                value={filters.driver ?? ""}
                disabled={pending}
                onCommit={(v) => setFilter({ mov_motorista: v })}
              />
            </FilterField>
            {withLeaders ? (
              <FilterField id="mov-lideranca" label="Liderança na data">
                <NativeSelect
                  id="mov-lideranca"
                  fieldSize="sm"
                  value={leaderEmployeeId ?? ""}
                  disabled={pending}
                  onChange={(e) => setFilter({ lideranca: e.target.value || null })}
                >
                  <option value="">Todas as lideranças</option>
                  {leaders?.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </NativeSelect>
              </FilterField>
            ) : null}
          </div>

          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="flex min-w-0 items-start gap-1.5 text-caption text-fg-muted">
              <ListFilter aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Operação, estado e cidade seguem os filtros do topo da página e já estão aplicados. Sem “De” e
                “Até”, a lista mostra a competência em tela ({competenceLabel}); com eles, a data efetiva do
                evento. Placa, frota e motorista valem ao pressionar Enter.
              </span>
            </p>
            {hasFilters ? (
              <Button variant="ghost" size="sm" leadingIcon={<X />} onClick={clearFilters} disabled={pending}>
                Limpar filtros
              </Button>
            ) : null}
          </div>

          {movements ? (
            <TypeChips
              counts={movements.counts}
              total={movements.total}
              active={activeType}
              disabled={pending}
              onSelect={(type) => setFilter({ mov_tipo: type })}
            />
          ) : null}

          {movements && movements.reconstructed > 0 ? (
            <Alert variant="info" icon={<History />}>
              <AlertTitle>
                {number.format(movements.reconstructed)}{" "}
                {movements.reconstructed === 1 ? "evento reconstruído" : "eventos reconstruídos"} a partir dos vínculos
              </AlertTitle>
              <AlertDescription>
                Os eventos anteriores à Central de Fidelização (Etapa 15) foram reconstruídos a partir dos vínculos
                de veículo e motorista já gravados e levam o selo “Reconstruído”: data, BR e recursos vêm do vínculo;
                motivo e responsável podem faltar. “Inferida” marca uma troca de titular observada nos vínculos sem
                uma substituição registrada.
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {movements === null ? (
        <Alert variant="danger">
          <AlertTitle>Não foi possível carregar o histórico</AlertTitle>
          <AlertDescription>
            As movimentações não puderam ser lidas agora. Os planners continuam disponíveis; tente recarregar a
            página em instantes.
          </AlertDescription>
        </Alert>
      ) : movements.rows.length === 0 ? (
        <EmptyState
          variant="panel"
          size="sm"
          icon={<ScanSearch />}
          title="Nenhuma movimentação encontrada"
          description={
            hasFilters
              ? "Nenhum evento corresponde ao período e aos filtros escolhidos. Ajuste as datas ou o tipo, ou limpe os filtros."
              : "Nenhuma troca de veículo ou motorista foi registrada no recorte atual."
          }
          action={
            hasFilters ? (
              <Button variant="secondary" size="sm" onClick={clearFilters} disabled={pending}>
                Limpar filtros
              </Button>
            ) : undefined
          }
        />
      ) : (
        <MovementsResults movements={movements} pending={pending} onNavigate={onNavigate} />
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- filtros */

function FilterField({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-caption text-fg-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Busca que só navega ao confirmar (Enter, sair do campo ou limpar): navegar a
 * cada tecla refaria a consulta do servidor para cada letra digitada.
 */
function CommitSearch({
  id,
  label,
  placeholder,
  value,
  disabled,
  onCommit,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  disabled: boolean;
  onCommit: (value: string | null) => void;
}) {
  const [draft, setDraft] = React.useState(value);
  const commit = (next: string) => {
    const trimmed = next.trim();
    if (trimmed !== value) onCommit(trimmed || null);
  };
  return (
    <SearchField
      id={id}
      size="sm"
      aria-label={label}
      placeholder={placeholder}
      value={draft}
      disabled={disabled}
      onValueChange={setDraft}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit(draft);
        }
      }}
      onBlur={() => commit(draft)}
      onClear={() => commit("")}
    />
  );
}

/**
 * Uma contagem por tipo, do recorte inteiro (não só da página). Clicar num tipo
 * filtra por ele; clicar de novo, ou em "Todos os tipos", tira o filtro.
 */
function TypeChips({
  counts,
  total,
  active,
  disabled,
  onSelect,
}: {
  counts: MovementsPage["counts"];
  total: number;
  active: string;
  disabled: boolean;
  onSelect: (type: string | null) => void;
}) {
  const present = TYPE_ORDER.filter((t) => (counts[t] ?? 0) > 0 || t === active);
  if (present.length === 0 && !active) return null;

  return (
    <div role="group" aria-label="Movimentações por tipo" className="flex flex-wrap gap-1.5">
      <ChipButton pressed={!active} disabled={disabled} onClick={() => onSelect(null)}>
        Todos os tipos
        <span className="tabular-nums text-fg-muted">{number.format(total)}</span>
      </ChipButton>
      {present.map((type) => {
        const meta = MOVEMENT_TYPE_META[type];
        const pressed = active === type;
        return (
          <ChipButton
            key={type}
            pressed={pressed}
            disabled={disabled}
            onClick={() => onSelect(pressed ? null : type)}
          >
            <Badge variant={meta.tone} size="sm" dot className="pointer-events-none">
              {meta.label}
            </Badge>
            <span className="tabular-nums text-fg-secondary">{number.format(counts[type] ?? 0)}</span>
          </ChipButton>
        );
      })}
    </div>
  );
}

function ChipButton({
  pressed,
  disabled,
  onClick,
  children,
}: {
  pressed: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 max-w-full items-center gap-1.5 rounded-sm border px-2 text-caption font-medium hfm-transition hfm-focus-ring",
        "disabled:pointer-events-none disabled:opacity-55",
        pressed
          ? "border-primary bg-primary-soft text-primary-soft-fg"
          : "border-border bg-surface text-fg-secondary hover:border-border-strong hover:bg-hover-overlay",
      )}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------- resultado */

function MovementsResults({
  movements,
  pending,
  onNavigate,
}: {
  movements: MovementsPage;
  pending: boolean;
  onNavigate: (patch: Record<string, string | null>) => void;
}) {
  const marks = React.useMemo(() => linkMarks(movements.rows), [movements.rows]);

  return (
    <div aria-busy={pending || undefined} className={cn("flex min-w-0 flex-col gap-3", pending && "opacity-60")}>
      {/* ---------------------------------------------------- desktop (xl+)
          Sete colunas cabem na área de conteúdo a partir de 1280px porque a
          liderança mora sob a posição e o registro sob a origem; abaixo disso,
          cartões — uma tabela de eventos rolando de lado esconde justamente
          quem registrou. */}
      <TableContainer className="hidden xl:block">
        <Table aria-label="Movimentações">
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead className="whitespace-normal">Posição e liderança na data</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Veículo</TableHead>
              <TableHead>Motorista</TableHead>
              <TableHead>Motivo</TableHead>
              <TableHead>Origem e registro</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {movements.rows.map((row) => {
              const mark = marks.get(row.id);
              return (
                <TableRow key={row.id} data-correlation={mark ? row.correlationKey : undefined} className="h-auto">
                  <TableCell className="relative py-2.5 align-top whitespace-nowrap tabular-nums">
                    {mark ? <LinkStripe mark={mark} /> : null}
                    {formatDate(row.effectiveDate)}
                  </TableCell>
                  <TableCell className="min-w-[9rem] py-2.5 align-top">
                    <Position row={row} withLeader />
                  </TableCell>
                  <TableCell className="min-w-[9rem] py-2.5 align-top">
                    <TypeCell row={row} mark={mark} wrap />
                  </TableCell>
                  <TableCell className="py-2.5 align-top">
                    <VehicleChange row={row} />
                  </TableCell>
                  <TableCell className="min-w-[8rem] py-2.5 align-top">
                    <DriverChange row={row} />
                  </TableCell>
                  <TableCell className="min-w-[9rem] py-2.5 align-top">
                    <Reason row={row} />
                  </TableCell>
                  <TableCell className="py-2.5 align-top">
                    <Origin row={row} withRecordedAt />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {/* ------------------------------------------------- cartões (< xl) */}
      <ul aria-label="Movimentações" className="flex flex-col gap-2 xl:hidden">
        {movements.rows.map((row) => {
          const mark = marks.get(row.id);
          return (
            <li
              key={row.id}
              data-correlation={mark ? row.correlationKey : undefined}
              className="relative overflow-hidden rounded-md border border-border bg-surface p-3 pl-4"
            >
              {mark ? <LinkStripe mark={mark} /> : null}
              <div className="flex flex-wrap items-start justify-between gap-2">
                <TypeCell row={row} mark={mark} />
                <span className="text-body-sm font-medium tabular-nums text-fg">{formatDate(row.effectiveDate)}</span>
              </div>
              <div className="mt-2">
                <Position row={row} />
              </div>
              <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2.5 text-body-sm sm:grid-cols-2">
                <CardItem label="Liderança na data">
                  {row.leaderName ?? <span className="text-fg-muted">Sem liderança</span>}
                </CardItem>
                <CardItem label="Motivo">
                  <Reason row={row} />
                </CardItem>
                <CardItem label="Veículo">
                  <VehicleChange row={row} />
                </CardItem>
                <CardItem label="Motorista">
                  <DriverChange row={row} />
                </CardItem>
                <CardItem label="Origem e responsável">
                  <Origin row={row} />
                </CardItem>
                <CardItem label="Registrado em">
                  <span className="tabular-nums text-fg-secondary">{formatDateTime(row.recordedAt)}</span>
                </CardItem>
              </dl>
            </li>
          );
        })}
      </ul>

      <Pagination
        label="Paginação das movimentações"
        page={movements.page}
        pageSize={movements.pageSize}
        total={movements.total}
        disabled={pending}
        onPageChange={(next) => onNavigate({ mov_pagina: next <= 1 ? null : String(next) })}
      />
    </div>
  );
}

function CardItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="min-w-0 text-fg">{children}</dd>
    </div>
  );
}

function LinkStripe({ mark }: { mark: LinkMark }) {
  return <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", mark.color)} />;
}

function Position({ row, withLeader = false }: { row: MovementRow; withLeader?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="font-medium whitespace-nowrap text-fg">{row.brCode}</span>
      <span className="text-caption text-fg-muted">
        {row.operationName} · {row.cityName}/{row.stateUf}
      </span>
      {withLeader ? (
        <span className={cn("mt-1 text-caption", row.leaderName ? "text-fg-secondary" : "text-fg-muted")}>
          <span className="sr-only">Liderança na data: </span>
          {row.leaderName ?? "Sem liderança"}
        </span>
      ) : null}
    </div>
  );
}

function TypeCell({ row, mark, wrap = false }: { row: MovementRow; mark: LinkMark | undefined; wrap?: boolean }) {
  const meta = typeMeta(row.movementType);
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <Badge
        variant={meta.tone}
        data-movement-type={row.movementType}
        className={wrap ? "h-auto min-h-6 py-0.5 text-left whitespace-normal" : undefined}
      >
        {meta.label}
      </Badge>
      {row.isInferred || row.origin === "reconstructed" || mark ? (
        <div className="flex flex-wrap gap-1">
          {row.isInferred ? (
            <Badge
              variant="warning"
              appearance="outline"
              size="sm"
              title="Troca de titular observada nos vínculos sem uma substituição registrada"
            >
              inferida
            </Badge>
          ) : null}
          {row.origin === "reconstructed" ? (
            <Badge
              variant="neutral"
              appearance="outline"
              size="sm"
              icon={<History />}
              title="Evento anterior à Etapa 15, reconstruído a partir dos vínculos"
            >
              Reconstruído
            </Badge>
          ) : null}
          {mark ? (
            <Badge
              variant="neutral"
              appearance="outline"
              size="sm"
              icon={<Link2 />}
              title="Registrado na mesma operação que outro evento desta página"
            >
              Mesma operação
              <span className="tabular-nums text-fg-muted">
                {mark.position}/{mark.size}
              </span>
            </Badge>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface Side {
  label: string;
  detail: string | null;
}

/**
 * Anterior → novo em duas linhas: os nomes na primeira, os detalhes (placa,
 * matrícula) na segunda, na mesma ordem. Um lado só diz se o recurso entrou ou
 * saiu, que é o que o tipo sozinho nem sempre deixa claro.
 */
function Change({ before, after, extra }: { before: Side | null; after: Side | null; extra?: string | null }) {
  if (!before && !after) return <span className="text-fg-muted">—</span>;

  if (before && after) {
    const details = before.detail || after.detail ? `${before.detail ?? "—"} → ${after.detail ?? "—"}` : null;
    return (
      <span className="flex min-w-0 flex-col">
        <span className="flex flex-wrap items-center gap-x-1">
          <span className="text-fg-secondary">{before.label}</span>
          <ArrowRight aria-hidden className="size-3.5 shrink-0 text-fg-muted" />
          <span className="sr-only">para</span>
          <span className="font-medium text-fg">{after.label}</span>
        </span>
        {details || extra ? (
          <span className="text-caption text-fg-muted">{[details, extra].filter(Boolean).join(" · ")}</span>
        ) : null}
      </span>
    );
  }

  const only = (before ?? after) as Side;
  const caption = [only.detail, before ? "saiu" : "entrou", extra].filter(Boolean).join(" · ");
  return (
    <span className="flex min-w-0 flex-col">
      <span className={cn("font-medium", before ? "text-fg-secondary" : "text-fg")}>{only.label}</span>
      <span className="text-caption text-fg-muted">{caption}</span>
    </span>
  );
}

function vehicleOf(label: string | null, plate: string | null): Side | null {
  if (!label && !plate) return null;
  const main = label ?? plate ?? "—";
  return { label: main, detail: plate && plate !== main ? plate : null };
}

function VehicleChange({ row }: { row: MovementRow }) {
  return (
    <Change
      before={vehicleOf(row.previousVehicleLabel, row.previousPlate)}
      after={vehicleOf(row.newVehicleLabel, row.newPlate)}
    />
  );
}

function DriverChange({ row }: { row: MovementRow }) {
  const person = (name: string | null, code: string | null): Side | null =>
    name ? { label: name, detail: code ? `Mat. ${code}` : null } : null;
  const role = row.driverRole ? ROLE_LABEL[row.driverRole] ?? row.driverRole : null;
  return (
    <Change
      before={person(row.previousDriverName, row.previousDriverCode)}
      after={person(row.newDriverName, row.newDriverCode)}
      extra={role}
    />
  );
}

function Reason({ row }: { row: MovementRow }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className={cn("break-words", row.reason ? "text-fg-secondary" : "text-fg-muted")}>{row.reason ?? "—"}</span>
      {row.notes ? <span className="break-words text-caption text-fg-muted">Obs.: {row.notes}</span> : null}
    </span>
  );
}

function Origin({ row, withRecordedAt = false }: { row: MovementRow; withRecordedAt?: boolean }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="text-fg-secondary">{MOVEMENT_ORIGIN_LABEL[row.origin] ?? row.origin}</span>
      <span className={cn("text-caption", row.actorName ? "text-fg" : "text-fg-muted")}>
        <span className="sr-only">Responsável: </span>
        {row.actorName ?? "—"}
      </span>
      {withRecordedAt ? (
        <span className="text-caption tabular-nums text-fg-muted">
          <span className="sr-only">Registrado em </span>
          {formatDateTime(row.recordedAt)}
        </span>
      ) : null}
    </span>
  );
}
