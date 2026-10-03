"use client";

import * as React from "react";
import Link from "next/link";
import {
  Activity, AlertOctagon, Camera, ClipboardCheck, Database, HeartPulse, Layers, Plug, RefreshCw, SignalZero, Smartphone,
  Truck, Wrench,
} from "lucide-react";
import { InsightCard, InsightList, type InsightTone } from "@/components/feedback/insight-card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtInt, formatDate, formatStamp, type MtsrHealth } from "@/lib/mtsr/types";
import type { MtsrPanelContext } from "../shared";
import { MtsrKpi, PanelEmpty, PanelError, plural, Section, useMtsrLink } from "./mtsr-ui";

/**
 * MTSR → Saúde e cobertura: o que falta para a matriz ser confiável.
 *
 * `mtsr_health` conta buracos (veículos sem leitura, células sem leitura,
 * componentes sem serviço ou sem fonte) e filas (revalidação, validação, NOK
 * sem manutenção). As recomendações são deduzidas desses números — nada é
 * inventado.
 */
export function HealthPanel({ data, ctx }: { data: MtsrHealth | null; ctx: MtsrPanelContext }) {
  const link = useMtsrLink(ctx);
  if (ctx.error) return <PanelError ctx={ctx} title="Não foi possível carregar a saúde do MTSR." testId="mtsr-saude-error" />;
  if (!data) {
    return <PanelEmpty icon={<HeartPulse />} title="Sem dados de saúde" description="A rotina não devolveu o diagnóstico. Recarregue a página." testId="mtsr-saude-empty" />;
  }
  const h = data;
  const conf = (patch: Record<string, string | null>) => (ctx.perms.conformity ? link({ aba: "conformidade", ...patch }) : null);
  const unavailableSources = h.sources.filter((s) => !s.isAvailable);
  const insights = recommendations(h);

  return (
    <div className="flex flex-col gap-6" data-testid="mtsr-health">
      <p className="text-body-sm text-fg-muted">Diagnóstico de {formatDate(h.today)} sobre toda a organização (os filtros da tela não se aplicam aqui).</p>

      <Section title="Cobertura da frota" testId="mtsr-health-coverage" description="Frota ativa que ainda não tem leitura: cada célula sem leitura é um componente de um veículo sem estado oficial.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <MtsrKpi kpi="health-frota-ativa" label="Frota ativa" value={fmtInt(h.vehiclesActive)} icon={<Truck />} status="primary" />
          <MtsrKpi kpi="health-sem-leitura" label="Sem nenhuma leitura" value={fmtInt(h.vehiclesWithoutAnyStatus)} status={h.vehiclesWithoutAnyStatus > 0 ? "warning" : "success"} icon={<SignalZero />}
            period="veículos ativos sem estado em nenhum componente" nav={conf({ conformidade: "sem_informacao" })} destination="Abrir a Conformidade filtrada por sem informação" />
          <MtsrKpi kpi="health-sem-vistoria" label="Sem vistoria válida" value={fmtInt(h.vehiclesWithoutInspection)} status={h.vehiclesWithoutInspection > 0 ? "warning" : "success"} icon={<ClipboardCheck />}
            period="prazo pendente" nav={conf({ prazo: "pendente" })} destination="Abrir a Conformidade filtrada por prazo pendente" />
          <MtsrKpi kpi="health-celulas-campo" label="Células de campo sem leitura" value={fmtInt(h.fieldCellsMissing)} status={h.fieldCellsMissing > 0 ? "warning" : "success"} icon={<Layers />} period="veículo × componente de vistoria" />
          <MtsrKpi kpi="health-celulas-backoffice" label="Células de backoffice sem leitura" value={fmtInt(h.backofficeCellsMissing)} status={h.backofficeCellsMissing > 0 ? "warning" : "success"} icon={<Database />} period="veículo × componente de backoffice" />
        </div>
      </Section>

      <Section title="Filas" testId="mtsr-health-queues" description="O que está esperando alguém: revalidação depois da manutenção, validação de vistoria e NOK sem manutenção aberta.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <MtsrKpi kpi="health-aguardando" label="Aguardando revalidação" value={fmtInt(h.awaitingRevalidation)} status={h.awaitingOverSla > 0 ? "danger" : h.awaitingRevalidation > 0 ? "warning" : "success"} icon={<RefreshCw />}
            period={`${fmtInt(h.awaitingOverSla)} acima do SLA`} nav={conf({ revalidacao: "1" })} destination="Abrir a Conformidade filtrada por aguardando revalidação" />
          <MtsrKpi kpi="health-vistorias-pendentes" label="Vistorias pendentes" value={fmtInt(h.pendingInspections)} status={h.pendingOverSla > 0 ? "danger" : h.pendingInspections > 0 ? "warning" : "success"} icon={<ClipboardCheck />}
            period={`${fmtInt(h.pendingOverSla)} acima do SLA`} nav={ctx.perms.review ? link({ aba: "vistorias" }) : null} destination="Abrir as Vistorias recebidas" />
          <MtsrKpi kpi="health-nok-sem-manutencao" label="NOK sem manutenção" value={fmtInt(h.nokWithoutMaintenance)} status={h.nokWithoutMaintenance > 0 ? "danger" : "success"} icon={<AlertOctagon />}
            period="componentes NOK sem vínculo ativo" nav={conf({ conformidade: "nao_conforme" })} destination="Abrir a Conformidade filtrada por não conformes" />
        </div>
      </Section>

      <Section title="Configuração e ingestão" testId="mtsr-health-config" description="Cadastros que faltam para o fluxo fechar e a qualidade do que chegou nos últimos 30 dias.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <MtsrKpi kpi="health-sem-servico" label="Componentes sem serviço mapeado" value={fmtInt(h.componentsWithoutService)} status={h.componentsWithoutService > 0 ? "warning" : "success"} icon={<Wrench />}
            period="abrir manutenção exigirá escolher o serviço" nav={ctx.perms.componentManage ? link({ aba: "cadastros", sub: "servicos" }) : null} destination="Abrir Cadastros › Serviços" />
          <MtsrKpi kpi="health-sem-fonte" label="Backoffice sem fonte disponível" value={fmtInt(h.componentsWithoutSource)} status={h.componentsWithoutSource > 0 ? "warning" : "success"} icon={<Plug />}
            period="só importação ou backoffice manual" nav={ctx.perms.ingestionManage ? link({ aba: "cadastros", sub: "fontes" }) : null} destination="Abrir Cadastros › Fontes" />
          <MtsrKpi kpi="health-evidencias" label="Evidências vivas" value={fmtInt(h.evidenceLive)} icon={<Camera />} period={`${fmtInt(h.evidencePurged)} expurgadas pela retenção`} />
          <MtsrKpi kpi="health-ingestao-rejeitada" label="Ingestão rejeitada (30 d)" value={fmtInt(h.ingestionRejected30d)} status={h.ingestionRejected30d > 0 ? "warning" : undefined} icon={<Activity />}
            period={`${fmtInt(h.ingestionConflict30d)} em conflito`} nav={link({ aba: "ingestao", sub: "eventos", resultado: "rejected" })} destination="Abrir os eventos rejeitados" />
          <MtsrKpi kpi="health-app-operacoes" label="Operações com o app" value={fmtInt(h.appEnabledOperations)} status={h.appEnabledOperations === 0 ? "danger" : undefined} icon={<Smartphone />}
            period="Vistoria MTSR habilitada" />
          <MtsrKpi kpi="health-app-tipos" label="Tipos com o app" value={fmtInt(h.appEnabledVehicleTypes)} status={h.appEnabledVehicleTypes === 0 ? "danger" : undefined} icon={<Smartphone />}
            period="tipos de equipamento habilitados" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="secondary">
            <Link href="/organizacao/operacoes">Operações › aba Aplicativos</Link>
          </Button>
          <Button asChild size="sm" variant="secondary">
            <Link href="/frota/tipos-equipamento">Tipos de equipamento › aba Aplicativos</Link>
          </Button>
        </div>
      </Section>

      <Section title="Fontes" testId="mtsr-health-sources" description={unavailableSources.length ? `${fmtInt(unavailableSources.length)} ${plural(unavailableSources.length, "fonte sem adaptador", "fontes sem adaptador")} nesta versão.` : "Todas as fontes cadastradas têm adaptador."}>
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fonte</TableHead>
                <TableHead>Disponibilidade</TableHead>
                <TableHead>Habilitada</TableHead>
                <TableHead>Último evento</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {h.sources.map((s) => (
                <TableRow key={s.code} className="h-10" data-testid="mtsr-health-source" data-code={s.code}>
                  <TableCell className="font-medium text-fg">{s.name}</TableCell>
                  <TableCell><StatusBadge status={s.isAvailable ? "success" : "neutral"} size="sm">{s.isAvailable ? "Disponível" : "Indisponível"}</StatusBadge></TableCell>
                  <TableCell><StatusBadge status={s.isEnabled ? "info" : "neutral"} size="sm">{s.isEnabled ? "Sim" : "Não"}</StatusBadge></TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums text-fg-secondary">{s.lastEventAt ? formatStamp(s.lastEventAt) : "Nenhum"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Section>

      <Section title="Recomendações" testId="mtsr-health-insights" description="Deduzidas só dos números acima.">
        <InsightList>
          {insights.map((i) => (
            <InsightCard key={i.key} tone={i.tone} title={i.title} data-testid="mtsr-health-insight">
              {i.text}
            </InsightCard>
          ))}
        </InsightList>
      </Section>
    </div>
  );
}

function recommendations(h: MtsrHealth): { key: string; tone: InsightTone; title: string; text: string }[] {
  const out: { key: string; tone: InsightTone; title: string; text: string }[] = [];
  const n = fmtInt;
  if (h.appEnabledOperations === 0 || h.appEnabledVehicleTypes === 0) {
    out.push({
      key: "app",
      tone: "danger",
      title: "O app Vistoria MTSR não alcança a frota",
      text:
        h.appEnabledOperations === 0 && h.appEnabledVehicleTypes === 0
          ? "Nenhuma operação e nenhum tipo de equipamento têm o aplicativo habilitado: ninguém consegue enviar vistoria. Habilite na aba Aplicativos das operações e dos tipos."
          : h.appEnabledOperations === 0
            ? "Nenhuma operação tem o aplicativo habilitado. Habilite na aba Aplicativos de cada operação."
            : "Nenhum tipo de equipamento tem o aplicativo habilitado. Habilite na aba Aplicativos de cada tipo.",
    });
  }
  if (h.nokWithoutMaintenance > 0) {
    out.push({ key: "nok", tone: "danger", title: `${n(h.nokWithoutMaintenance)} ${plural(h.nokWithoutMaintenance, "componente NOK sem manutenção", "componentes NOK sem manutenção")}`, text: "Abra ou vincule uma manutenção a partir da ficha do veículo ou da vistoria: NOK sem manutenção não tem caminho para voltar a OK." });
  }
  if (h.pendingOverSla > 0) {
    out.push({ key: "sla-review", tone: "warning", title: `${n(h.pendingOverSla)} ${plural(h.pendingOverSla, "vistoria pendente acima do SLA", "vistorias pendentes acima do SLA")}`, text: "Enquanto não validadas, os itens não viram estado oficial e o prazo do veículo não avança." });
  } else if (h.pendingInspections > 0) {
    out.push({ key: "review", tone: "info", title: `${n(h.pendingInspections)} ${plural(h.pendingInspections, "vistoria aguardando validação", "vistorias aguardando validação")}`, text: "Dentro do SLA. Valide para que os itens virem estado oficial." });
  }
  if (h.awaitingOverSla > 0) {
    out.push({ key: "sla-reval", tone: "warning", title: `${n(h.awaitingOverSla)} ${plural(h.awaitingOverSla, "componente aguardando revalidação acima do SLA", "componentes aguardando revalidação acima do SLA")}`, text: "A manutenção foi concluída, mas o componente continua com o estado anterior até nova vistoria ou leitura. Programe a vistoria." });
  }
  if (h.vehiclesWithoutAnyStatus > 0) {
    out.push({ key: "no-status", tone: "warning", title: `${n(h.vehiclesWithoutAnyStatus)} ${plural(h.vehiclesWithoutAnyStatus, "veículo ativo sem nenhuma leitura", "veículos ativos sem nenhuma leitura")}`, text: "Não entram na conformidade (nem como conformes nem como não conformes). Uma vistoria no app, uma importação ou uma atualização de backoffice cria o primeiro estado." });
  }
  if (h.backofficeCellsMissing > 0) {
    out.push({ key: "backoffice", tone: "info", title: `${n(h.backofficeCellsMissing)} ${plural(h.backofficeCellsMissing, "célula de backoffice sem leitura", "células de backoffice sem leitura")}`, text: "Componentes de backoffice não entram na vistoria de campo: só a importação ou a atualização manual do backoffice preenchem essas células." });
  }
  if (h.fieldCellsMissing > 0) {
    out.push({ key: "field", tone: "info", title: `${n(h.fieldCellsMissing)} ${plural(h.fieldCellsMissing, "célula de campo sem leitura", "células de campo sem leitura")}`, text: "Componentes de vistoria ainda sem leitura em algum veículo: a próxima vistoria validada preenche." });
  }
  if (h.componentsWithoutService > 0) {
    out.push({ key: "service", tone: "warning", title: `${n(h.componentsWithoutService)} ${plural(h.componentsWithoutService, "componente sem serviço mapeado", "componentes sem serviço mapeado")}`, text: "Sem serviço padrão, abrir manutenção a partir do NOK exige escolher o serviço a cada vez. Mapeie em Cadastros › Serviços." });
  }
  if (h.componentsWithoutSource > 0) {
    out.push({ key: "source", tone: "warning", title: `${n(h.componentsWithoutSource)} ${plural(h.componentsWithoutSource, "componente de backoffice sem fonte disponível", "componentes de backoffice sem fonte disponível")}`, text: "Nenhuma fonte com adaptador alimenta esses componentes: o estado só entra por importação ou backoffice manual." });
  }
  if (h.ingestionRejected30d > 0 || h.ingestionConflict30d > 0) {
    out.push({ key: "ingestion", tone: "info", title: `${n(h.ingestionRejected30d)} rejeitados e ${n(h.ingestionConflict30d)} conflitos em 30 dias`, text: "Veja os motivos em Ingestão › Eventos: placa ou componente não reconhecidos, status desconhecido, data futura ou fontes divergentes na mesma data." });
  }
  if (out.length === 0) {
    out.push({ key: "ok", tone: "success", title: "Nada a destacar", text: "Toda a frota ativa tem leitura, não há filas acima do SLA, nem NOK sem manutenção, e os cadastros estão completos." });
  }
  return out;
}
