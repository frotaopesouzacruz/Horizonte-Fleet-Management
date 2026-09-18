"use client";

import * as React from "react";
import { FileText, Plus } from "lucide-react";
import { Specimen } from "../design-system-view";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { Skeleton, SkeletonCard, SkeletonKpi, SkeletonTableRows, SkeletonText } from "@/components/feedback/skeleton";
import { Table, TableContainer } from "@/components/ui/table";
import { LoadingState } from "@/components/feedback/loading-state";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { Progress } from "@/components/feedback/progress";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { useToast } from "@/components/feedback/toast";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";

export function FeedbackSection() {
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  return (
    <div className="flex flex-col gap-8">
      <Specimen title="Avisos" className="flex w-full max-w-3xl flex-col gap-2">
        <Alert variant="info">
          <AlertTitle>Importação agendada</AlertTitle>
          <AlertDescription>O arquivo será processado na próxima janela de sincronização.</AlertDescription>
        </Alert>
        <Alert variant="success">
          <AlertTitle>Checklist concluído</AlertTitle>
          <AlertDescription>Todos os itens obrigatórios foram respondidos.</AlertDescription>
        </Alert>
        <Alert variant="warning">
          <AlertTitle>3 documentos vencem em 15 dias</AlertTitle>
          <AlertDescription>Renove o licenciamento para manter os veículos disponíveis.</AlertDescription>
        </Alert>
        <Alert variant="danger">
          <AlertTitle>Não foi possível sincronizar a telemetria</AlertTitle>
          <AlertDescription>A última leitura é de 6 horas atrás. Verifique a integração.</AlertDescription>
        </Alert>
      </Specimen>

      <Specimen title="Notificações">
        <Button variant="outline" onClick={() => toast({ title: "Veículo salvo", description: "HFM-0142 foi atualizado.", variant: "success" })}>
          Sucesso
        </Button>
        <Button variant="outline" onClick={() => toast({ title: "Revise a quilometragem", description: "O valor informado é menor que o último registro.", variant: "warning" })}>
          Atenção
        </Button>
        <Button variant="outline" onClick={() => toast({ title: "Falha ao salvar", description: "Tente novamente em instantes.", variant: "danger", action: { label: "Tentar novamente", onClick: () => undefined } })}>
          Erro com ação
        </Button>
      </Specimen>

      <Specimen title="Progresso" className="flex w-full max-w-md flex-col gap-4">
        <Progress value={72} label="Importação de veículos" showValue />
        <Progress value={38} tone="warning" size="sm" />
        <Progress indeterminate label="Sincronizando" />
      </Specimen>

      <Specimen title="Carregamento" className="flex w-full flex-col gap-4">
        <div className="flex flex-wrap items-center gap-6">
          <LoadingState variant="inline" label="Carregando veículos…" />
          <div className="w-64 rounded-md border border-border bg-surface p-4">
            <LoadingState variant="block" label="Consultando telemetria…" />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SkeletonKpi />
          <SkeletonKpi />
          <SkeletonCard />
          <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4">
            <SkeletonText lines={3} />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
        <TableContainer>
          <Table>
            <SkeletonTableRows rows={3} cols={5} />
          </Table>
        </TableContainer>
      </Specimen>

      <Specimen title="Estados vazios e de erro" className="grid w-full gap-3 lg:grid-cols-2">
        <EmptyState
          variant="panel"
          icon={<FileText />}
          title="Nenhum veículo cadastrado"
          description="Os veículos aparecem aqui assim que forem registrados ou importados de uma planilha."
          action={<Button leadingIcon={<Plus />}>Cadastrar veículo</Button>}
          secondaryAction={<Button variant="ghost">Importar planilha</Button>}
        />
        <ErrorState
          variant="panel"
          title="Não foi possível carregar os veículos."
          description="Verifique sua conexão e tente novamente. Se persistir, acione o suporte."
          onRetry={() => undefined}
          details="GET /rest/v1/vehicles → 503 Service Unavailable"
        />
      </Specimen>

      <Specimen title="Camadas sobrepostas">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">Abrir modal</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Transferir veículo de unidade</DialogTitle>
              <DialogDescription>A transferência é registrada no histórico e na auditoria.</DialogDescription>
            </DialogHeader>
            <DialogBody className="text-body-sm text-fg-secondary">
              O veículo HFM-0142 passará da unidade São Paulo para Campinas. Os registros históricos permanecem
              vinculados à unidade de origem.
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost">Cancelar</Button>
              <Button>Confirmar transferência</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Drawer>
          <DrawerTrigger asChild>
            <Button variant="outline">Abrir drawer</Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Ficha do veículo</DrawerTitle>
              <DrawerDescription>HFM-0142 · RQK2F18</DrawerDescription>
            </DrawerHeader>
            <DrawerBody className="text-body-sm text-fg-secondary">
              Painel lateral para detalhes e filtros, sem tirar o usuário do contexto da lista.
            </DrawerBody>
            <DrawerFooter>
              <Button variant="ghost">Fechar</Button>
              <Button>Editar</Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>

        <Button variant="danger" onClick={() => setConfirmOpen(true)}>
          Confirmar exclusão
        </Button>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          destructive
          title="Arquivar veículo HFM-0142?"
          description="O veículo deixa de aparecer nas listas operacionais. O histórico é preservado e a ação pode ser revertida por quem tem permissão."
          confirmLabel="Arquivar"
          onConfirm={() => undefined}
        />
      </Specimen>
    </div>
  );
}
