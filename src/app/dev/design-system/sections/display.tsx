"use client";

import * as React from "react";
import { Gauge, MoreHorizontal, Truck, Wrench } from "lucide-react";
import { Specimen } from "../design-system-view";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, StatusDot } from "@/components/ui/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Panel } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarGroup } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { KpiCard } from "@/components/ui/kpi-card";
import { Pagination } from "@/components/ui/pagination";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { FilterBar, FilterChip, FilterBarClear } from "@/components/ui/filter-bar";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TableActionCell,
} from "@/components/ui/table";
import { IconButton } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Sample rows: illustrative data for this internal page only. */
const rows = [
  { id: "1", code: "HFM-0142", plate: "RQK2F18", model: "Fiat Fiorino", unit: "São Paulo", km: 128430, status: "success" as const, statusLabel: "Em operação" },
  { id: "2", code: "HFM-0143", plate: "SBT5H09", model: "Mercedes Sprinter", unit: "Campinas", km: 96210, status: "warning" as const, statusLabel: "Em manutenção" },
  { id: "3", code: "HFM-0144", plate: "PWQ7J34", model: "Volvo VM 270", unit: "Rio de Janeiro", km: 341902, status: "danger" as const, statusLabel: "Parado" },
  { id: "4", code: "HFM-0145", plate: "MZX1B62", model: "Renault Master", unit: "São Paulo", km: 54180, status: "neutral" as const, statusLabel: "Inativo" },
];

const nf = new Intl.NumberFormat("pt-BR");

export function DisplaySection() {
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [sort, setSort] = React.useState<"asc" | "desc" | null>("asc");

  return (
    <div className="flex flex-col gap-8">
      <Specimen title="Trilha de navegação">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/dashboard">Início</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="/frota">Frota</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>HFM-0142</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </Specimen>

      <Specimen title="Rótulos" description="Caixa normal, raio pequeno, sem uppercase decorativo.">
        <Badge variant="neutral">Neutro</Badge>
        <Badge variant="primary">Primário</Badge>
        <Badge variant="accent">Dados</Badge>
        <Badge variant="highlight">Destaque</Badge>
        <Badge variant="success">Sucesso</Badge>
        <Badge variant="warning">Atenção</Badge>
        <Badge variant="danger">Crítico</Badge>
        <Badge variant="info">Informação</Badge>
        <Badge variant="primary" appearance="solid">
          Sólido
        </Badge>
        <Badge variant="neutral" appearance="outline">
          Outline
        </Badge>
      </Specimen>

      <Specimen title="Status operacional" description="Nunca dependem só da cor: há ponto ou ícone e sempre um rótulo.">
        <StatusBadge status="success">Em operação</StatusBadge>
        <StatusBadge status="warning">Em manutenção</StatusBadge>
        <StatusBadge status="danger">Vencido</StatusBadge>
        <StatusBadge status="info">Agendado</StatusBadge>
        <StatusBadge status="pending">Pendente</StatusBadge>
        <StatusBadge status="progress">Em andamento</StatusBadge>
        <StatusBadge status="neutral">Inativo</StatusBadge>
        <span className="flex items-center gap-1.5 text-body-sm text-fg-secondary">
          <StatusDot status="success" /> ponto isolado
        </span>
      </Specimen>

      <Specimen title="Indicadores" className="grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Frota ativa" value={412} unit="veículos" trend={{ value: 2.4, direction: "up" }} period="vs. mês anterior" icon={<Truck />} />
        <KpiCard label="Em manutenção" value={18} trend={{ value: 5.1, direction: "up", positiveIsGood: false }} period="vs. mês anterior" icon={<Wrench />} status="warning" />
        <KpiCard label="Disponibilidade" value="96,2" unit="%" trend={{ value: 0.4, direction: "up" }} period="últimos 30 dias" icon={<Gauge />} status="success" />
        <KpiCard label="Custo por km" value="R$ 1,84" trend={{ value: 0, direction: "flat" }} period="estável" loading={false} />
      </Specimen>

      <Specimen title="Cartões e painéis" className="grid w-full gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Cartão padrão</CardTitle>
            <CardDescription>Separado por borda, sem sombra.</CardDescription>
          </CardHeader>
          <CardContent className="text-body-sm text-fg-secondary">
            Usado com parcimônia: agrupa conteúdo relacionado, não envolve tudo.
          </CardContent>
        </Card>
        <Card variant="elevated">
          <CardHeader>
            <CardTitle>Elevado</CardTitle>
            <CardDescription>Sombra discreta para resumos flutuantes.</CardDescription>
          </CardHeader>
          <CardContent className="text-body-sm text-fg-secondary">Reservado a poucos casos.</CardContent>
        </Card>
        <Panel title="Painel" meta="4 registros" padding="sm" actions={<IconButton label="Mais opções" size="sm"><MoreHorizontal /></IconButton>}>
          <p className="text-body-sm text-fg-secondary">
            Contêiner de seção com barra de cabeçalho compacta, para tabelas e listas.
          </p>
        </Panel>
      </Specimen>

      <Specimen title="Pessoas">
        <Avatar size="sm">
          <AvatarFallback>MA</AvatarFallback>
        </Avatar>
        <Avatar>
          <AvatarFallback>RS</AvatarFallback>
        </Avatar>
        <Avatar size="lg">
          <AvatarFallback>JP</AvatarFallback>
        </Avatar>
        <AvatarGroup max={3}>
          <Avatar>
            <AvatarFallback>MA</AvatarFallback>
          </Avatar>
          <Avatar>
            <AvatarFallback>RS</AvatarFallback>
          </Avatar>
          <Avatar>
            <AvatarFallback>JP</AvatarFallback>
          </Avatar>
          <Avatar>
            <AvatarFallback>LC</AvatarFallback>
          </Avatar>
          <Avatar>
            <AvatarFallback>TF</AvatarFallback>
          </Avatar>
        </AvatarGroup>
        <Separator orientation="vertical" className="h-10" />
        <Separator label="ou" className="w-40" />
      </Specimen>

      <Specimen title="Tabela de dados" className="w-full">
        <div className="flex w-full flex-col gap-2">
          <FilterBar
            start={
              <>
                <FilterChip label="Unidade" value="São Paulo" onRemove={() => undefined} />
                <FilterChip label="Status" value="Em operação" onRemove={() => undefined} />
                <FilterBarClear onClear={() => undefined} />
              </>
            }
          />
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead sortable sortDirection={sort} onSort={() => setSort(sort === "asc" ? "desc" : "asc")}>
                    Código
                  </TableHead>
                  <TableHead>Placa</TableHead>
                  <TableHead>Modelo</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead numeric>Hodômetro</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium text-fg">{row.code}</TableCell>
                    <TableCell className="font-mono">{row.plate}</TableCell>
                    <TableCell>{row.model}</TableCell>
                    <TableCell>{row.unit}</TableCell>
                    <TableCell numeric>{nf.format(row.km)} km</TableCell>
                    <TableCell>
                      <StatusBadge status={row.status}>{row.statusLabel}</StatusBadge>
                    </TableCell>
                    <TableActionCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton label={`Ações de ${row.code}`} size="sm">
                            <MoreHorizontal />
                          </IconButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem>Abrir ficha</DropdownMenuItem>
                          <DropdownMenuItem>Registrar quilometragem</DropdownMenuItem>
                          <DropdownMenuItem destructive>Arquivar</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableActionCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={1240}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </div>
      </Specimen>
    </div>
  );
}
