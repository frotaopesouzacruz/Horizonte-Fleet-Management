"use client";

import * as React from "react";
import { ArrowRight, History, Truck, UserCog, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type {
  BrDriverRow, BrLeadershipHistoryRow, BrMovementRow, BrVehicleRow,
} from "@/lib/governance/brs";
import {
  ASSIGNMENT_STATUS_LABEL, ASSIGNMENT_STATUS_TONE, DRIVER_ROLE_LABEL, LEADERSHIP_STATUS_LABEL,
  LEADER_SCOPE_LABEL, MOVEMENT_KIND_LABEL, RESPONSIBILITY_LABEL, SOURCE_LABEL, VEHICLE_ROLE_LABEL,
  formatDate, formatDateTime, formatPeriod, vehicleLabel,
} from "./br-labels";

/**
 * As quatro tabelas de histórico da gaveta de detalhe (§29). Cada linha é um
 * fato que aconteceu com a posição — quem respondeu por ela, qual placa a
 * ocupou, quem dirigiu, o que mudou — e nenhuma reescreve a anterior. A
 * competência escolhe o que se vê nos indicadores, não o que existe aqui.
 */

const cell = (value: string | null | undefined) =>
  value ? <span className="block truncate" title={value}>{value}</span> : <span className="text-fg-muted">—</span>;

/* ------------------------------------------------------------- lideranças */

export function LeadershipHistoryTable({ rows }: { rows: BrLeadershipHistoryRow[] }) {
  return (
    <TableContainer>
      <Table layout="fixed" style={{ minWidth: 760 }}>
        <TableHeader>
          <TableRow>
            <TableHead style={{ width: 200 }}>Nome</TableHead>
            <TableHead style={{ width: 130 }}>Nível</TableHead>
            <TableHead style={{ width: 100 }}>Tipo</TableHead>
            <TableHead style={{ width: 200 }}>Vigência</TableHead>
            <TableHead style={{ width: 100 }}>Situação</TableHead>
            <TableHead style={{ width: 200 }}>Notas</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableEmpty colSpan={6} icon={<UserCog />} message="Nenhuma liderança alcança esta posição." />
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{cell(row.employeeName)}</TableCell>
                {/* §43: o nível diz por que esta pessoa responde — exceção do BR, cidade ou operação. */}
                <TableCell>
                  <Badge variant={row.scopeLevel === "br" ? "accent" : "neutral"}>
                    {LEADER_SCOPE_LABEL[row.scopeLevel] ?? row.scopeLevel}
                  </Badge>
                </TableCell>
                <TableCell>{RESPONSIBILITY_LABEL[row.responsibilityType] ?? row.responsibilityType}</TableCell>
                <TableCell className="tabular-nums">{formatPeriod(row.effectiveFrom, row.effectiveTo)}</TableCell>
                <TableCell>
                  <StatusBadge status={row.status === "active" ? "success" : "neutral"}>
                    {LEADERSHIP_STATUS_LABEL[row.status] ?? row.status}
                  </StatusBadge>
                </TableCell>
                <TableCell>{cell(row.notes)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/* --------------------------------------------------------------- veículos */

export function VehicleHistoryTable({ rows }: { rows: BrVehicleRow[] }) {
  return (
    <TableContainer>
      <Table layout="fixed" style={{ minWidth: 900 }}>
        <TableHeader>
          <TableRow>
            <TableHead style={{ width: 170 }}>Placa / frota</TableHead>
            <TableHead style={{ width: 90 }}>Papel</TableHead>
            <TableHead style={{ width: 200 }}>Período</TableHead>
            <TableHead style={{ width: 110 }}>Situação</TableHead>
            <TableHead style={{ width: 110 }}>Origem</TableHead>
            <TableHead style={{ width: 180 }}>Motivo</TableHead>
            <TableHead style={{ width: 180 }}>Motivo do encerramento</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableEmpty colSpan={7} icon={<Truck />} message="Nenhum veículo passou por esta posição." />
          ) : (
            rows.map((row) => (
              <TableRow key={row.assignmentId}>
                <TableCell>
                  <span className="block truncate font-medium text-fg">{row.licensePlate ?? row.fleetCode ?? "—"}</span>
                  {row.fleetCode && row.fleetCode !== row.licensePlate ? (
                    <span className="block text-caption text-fg-muted">frota {row.fleetCode}</span>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Badge variant={row.vehicleRole === "primary" ? "primary" : "neutral"}>
                    {VEHICLE_ROLE_LABEL[row.vehicleRole]}
                  </Badge>
                </TableCell>
                <TableCell className="tabular-nums">{formatPeriod(row.startDate, row.endDate)}</TableCell>
                <TableCell>
                  <StatusBadge status={ASSIGNMENT_STATUS_TONE[row.status] ?? "neutral"}>
                    {ASSIGNMENT_STATUS_LABEL[row.status] ?? row.status}
                  </StatusBadge>
                </TableCell>
                <TableCell>{SOURCE_LABEL[row.source] ?? row.source}</TableCell>
                <TableCell>{cell(row.reason)}</TableCell>
                <TableCell>{cell(row.endReason)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/* ------------------------------------------------------------- motoristas */

export function DriverHistoryTable({ rows }: { rows: BrDriverRow[] }) {
  return (
    <TableContainer>
      <Table layout="fixed" style={{ minWidth: 860 }}>
        <TableHeader>
          <TableRow>
            <TableHead style={{ width: 200 }}>Colaborador</TableHead>
            <TableHead style={{ width: 100 }}>Papel</TableHead>
            <TableHead style={{ width: 150 }}>Veículo</TableHead>
            <TableHead style={{ width: 200 }}>Período</TableHead>
            <TableHead style={{ width: 110 }}>Situação</TableHead>
            <TableHead style={{ width: 200 }}>Motivo / encerramento</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableEmpty colSpan={6} icon={<UserRound />} message="Nenhum motorista foi planejado nesta posição." />
          ) : (
            rows.map((row) => (
              <TableRow key={row.driverId}>
                <TableCell>
                  <span className="block truncate font-medium text-fg" title={row.employeeName}>{row.employeeName}</span>
                  {row.employeeCode ? (
                    <span className="block text-caption text-fg-muted">Matrícula {row.employeeCode}</span>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Badge variant={row.driverRole === "primary" ? "primary" : "neutral"}>
                    {DRIVER_ROLE_LABEL[row.driverRole] ?? row.driverRole}
                  </Badge>
                </TableCell>
                <TableCell>{cell(vehicleLabel(row.licensePlate, row.fleetCode))}</TableCell>
                <TableCell className="tabular-nums">{formatPeriod(row.startDate, row.endDate)}</TableCell>
                <TableCell>
                  <StatusBadge status={ASSIGNMENT_STATUS_TONE[row.status] ?? "neutral"}>
                    {ASSIGNMENT_STATUS_LABEL[row.status] ?? row.status}
                  </StatusBadge>
                </TableCell>
                <TableCell>
                  {row.reason || row.endReason ? (
                    <>
                      {row.reason ? <span className="block truncate" title={row.reason}>{row.reason}</span> : null}
                      {row.endReason ? (
                        <span className="block truncate text-caption text-fg-muted" title={row.endReason}>
                          Encerrado: {row.endReason}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-fg-muted">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/* ---------------------------------------------------------- movimentações */

/** Quem registrou vem do perfil (o ator real), nunca de um nome digitado. */
export function MovementsTable({ rows }: { rows: BrMovementRow[] }) {
  return (
    <TableContainer>
      <Table layout="fixed" style={{ minWidth: 860 }}>
        <TableHeader>
          <TableRow>
            <TableHead style={{ width: 110 }}>Vigência</TableHead>
            <TableHead style={{ width: 120 }}>Tipo</TableHead>
            <TableHead style={{ width: 240 }}>Veículo anterior → novo</TableHead>
            <TableHead style={{ width: 200 }}>Motivo</TableHead>
            <TableHead style={{ width: 220 }}>Registrado por</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableEmpty
              colSpan={5}
              icon={<History />}
              message="Nenhuma substituição, inversão ou importação nesta posição."
            />
          ) : (
            rows.map((row) => (
              <TableRow key={row.assignmentId}>
                <TableCell className="tabular-nums">{formatDate(row.effectiveFrom)}</TableCell>
                <TableCell>
                  <Badge variant={row.kind === "inversion" ? "accent" : "info"}>
                    {MOVEMENT_KIND_LABEL[row.kind] ?? row.kind}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 truncate text-fg-secondary">
                      {row.previousVehicleId ? vehicleLabel(row.previousLicensePlate, row.previousFleetCode) : "sem veículo"}
                    </span>
                    <ArrowRight className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
                    <span className="min-w-0 truncate font-medium text-fg">
                      {vehicleLabel(row.newLicensePlate, row.newFleetCode)}
                    </span>
                  </span>
                </TableCell>
                <TableCell>{cell(row.reason)}</TableCell>
                <TableCell>
                  <span className="block truncate">{row.actorName ?? <span className="text-fg-muted">—</span>}</span>
                  <span className="block text-caption tabular-nums text-fg-muted">
                    em {formatDateTime(row.createdAt)}
                  </span>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
