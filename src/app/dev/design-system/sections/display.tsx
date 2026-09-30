"use client";

import * as React from "react";
import { Gauge, MoreHorizontal, Truck, Wrench } from "lucide-react";
import { Specimen } from "../design-system-view";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, StatusDot } from "@/components/ui/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Panel } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarGroup } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { KpiCard, MetricStrip, TrendIndicator } from "@/components/ui/kpi-card";
import { ChartCard, ChartLegend, ColumnChart, HBarChart, TrendChart, chartFormat } from "@/components/charts";
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

      <Specimen title="Indicadores · semântica da variação e sparkline" className="grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Aderência atual" value="88,89%" status="warning" icon={<Gauge />}
          trend={{ value: "+2,30 p.p.", direction: "up", goodWhen: "up", comparison: "vs. agosto" }}
          sparkline={[89.4, null, 91.4, 94.1, 87.2, 93.5, 92.6, 86.6, 88.9]} sparklineTarget={90} />
        <KpiCard label="Meta" value="90,00%" status="highlight" icon={<Gauge />}
          trend={{ value: "-1,11 p.p.", direction: "down", goodWhen: "up", comparison: "abaixo da meta" }} />
        <KpiCard label="Não realizados" value={21} status="danger" icon={<Wrench />}
          trend={{ value: "-4", direction: "down", goodWhen: "down", comparison: "vs. agosto" }}
          sparkline={[18, 0, 15, 10, 22, 11, 13, 22, 21]} />
        <KpiCard label="Obrigações previstas" value={1204} icon={<Truck />}
          trend={{ value: "+36", direction: "up", goodWhen: "neutral", comparison: "vs. agosto" }} />
      </Specimen>

      <Specimen title="Faixa de apoio (segundo nível)" className="w-full">
        <MetricStrip items={[
          { key: "a", label: "Obrigações previstas", value: "156", hint: "48 planejadas (futuras)" },
          { key: "b", label: "Checklists realizados", value: "8" },
          { key: "c", label: "Justificativas pendentes", value: "1", hint: "continuam no denominador" },
          { key: "d", label: "Realizados / devidas", value: "8 / 9", hint: "numerador / denominador" },
        ]} />
      </Specimen>

      <Specimen title="Variação em tabela" className="flex flex-wrap items-center gap-3">
        <TrendIndicator trend={{ value: "+3,1%", direction: "up", goodWhen: "up" }} />
        <TrendIndicator trend={{ value: "+3,1%", direction: "up", goodWhen: "down" }} />
        <TrendIndicator trend={{ value: "0", direction: "flat" }} />
        <TrendIndicator size="sm" trend={{ value: "-12", direction: "down", goodWhen: "down" }} />
      </Specimen>

      <Specimen title="Gráficos HFM · linha com meta, colunas e ranking" className="grid w-full gap-4 xl:grid-cols-2">
        <ChartCard title="Tendência da aderência" description="Saída de rota · 2026"
          legend={<ChartLegend items={[
            { key: "a", label: "Aderência", color: "var(--chart-brand-primary)", shape: "line" },
            { key: "m", label: "Meta 90%", color: "var(--chart-target)", shape: "dashed" },
            { key: "b", label: "Abaixo da meta", color: "var(--chart-danger)", shape: "dot" },
          ]} />}
          insight="4 de 8 meses abaixo da meta: jan, mai, ago, set.">
          <TrendChart
            ariaLabel="Exemplo de tendência"
            target={90}
            format={chartFormat.pct}
            axisFormat={chartFormat.pctAxis}
            points={["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"].map((label, i) => {
              const v = [89.4, null, 91.4, 94.1, 87.2, 93.5, 92.6, 86.6, 88.9][i] ?? null;
              return {
                key: label, label, value: v, future: i > 8, current: i === 8,
                tooltip: { title: `${label}/2026`, rows: [{ label: "Aderência", value: v == null ? "—" : chartFormat.pct(v), emphasis: true }] },
              };
            })}
          />
        </ChartCard>
        <ChartCard title="Volume mensal por tipo" description="Colunas empilhadas com total escrito"
          legend={<ChartLegend items={[
            { key: "p", label: "Preventiva", color: "var(--chart-brand-primary)" },
            { key: "c", label: "Corretiva", color: "var(--chart-accent)" },
            { key: "d", label: "Preditiva", color: "var(--chart-brand-secondary)" },
          ]} />}>
          <ColumnChart
            ariaLabel="Exemplo de colunas"
            format={chartFormat.int}
            items={["abr", "mai", "jun", "jul", "ago", "set"].map((label, i) => {
              const p = [42, 51, 38, 47, 55, 49][i];
              const c = [18, 22, 30, 19, 16, 21][i];
              const d = [4, 6, 3, 5, 7, 6][i];
              return {
                key: label, label, value: p + c + d, current: i === 5,
                segments: [
                  { key: "p", value: p, color: "var(--chart-brand-primary)" },
                  { key: "c", value: c, color: "var(--chart-accent)" },
                  { key: "d", value: d, color: "var(--chart-brand-secondary)" },
                ],
                tooltip: { title: `${label}/2026`, rows: [{ label: "Total", value: String(p + c + d), emphasis: true }] },
              };
            })}
          />
        </ChartCard>
        <ChartCard title="Ranking por operação" description="Barras horizontais com meta" className="xl:col-span-2">
          <HBarChart
            ariaLabel="Exemplo de ranking"
            kind="percent"
            target={90}
            format={chartFormat.pct}
            items={[
              { key: "a", label: "Redespacho - Belém/PA", value: 100, detail: "· 2/2" },
              { key: "b", label: "Merchandising", value: 85.7, detail: "· 6/7", color: "var(--chart-danger)" },
              { key: "c", label: "Last Mille MG", value: 83.3, detail: "· 5/6", color: "var(--chart-danger)" },
            ]}
          />
        </ChartCard>
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
