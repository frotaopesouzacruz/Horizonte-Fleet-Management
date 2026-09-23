"use client";

import * as React from "react";
import { ChevronDown, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/feedback/toast";

export interface LeadershipExportMenuProps {
  /** Query string da tela (competência e filtros), sem o formato. */
  query: string;
  /** Linhas que a tela mostra — o arquivo terá as mesmas. */
  rowCount: number;
}

/** "liderancas-setembro-2026.xlsx", lido do cabeçalho da resposta. */
function fileNameOf(response: Response, fallback: string): string {
  const header = response.headers.get("Content-Disposition") ?? "";
  const match = /filename="?([^";]+)"?/i.exec(header);
  return match?.[1] ?? fallback;
}

/**
 * Exportar, quando autorizado (Etapa 08 §20).
 *
 * O arquivo sai da rota `/governanca/liderancas/export` com a query da tela, e
 * não de uma URL aberta pelo navegador: se a rota recusar (sem permissão,
 * sessão expirada, auditoria indisponível), a pessoa lê o motivo aqui, num
 * aviso, em vez de cair numa página de erro em JSON.
 */
export function LeadershipExportMenu({ query, rowCount }: LeadershipExportMenuProps) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);

  const download = async (format: "xlsx" | "csv") => {
    setBusy(true);
    try {
      const params = new URLSearchParams(query);
      params.set("format", format);
      const response = await fetch(`/governanca/liderancas/export?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        toast({ title: body?.error ?? "Não foi possível exportar as lideranças.", variant: "danger" });
        return;
      }
      // Sessão expirada: o proxy redireciona para o login, e o fetch segue o
      // redirecionamento — o que chega é a página de login, não uma planilha.
      if (response.redirected || (response.headers.get("Content-Type") ?? "").includes("text/html")) {
        toast({ title: "Sua sessão expirou. Entre novamente para exportar.", variant: "danger" });
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileNameOf(response, `liderancas.${format}`);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({
        title: "Exportação concluída.",
        description: `${rowCount} vínculo(s), com os filtros da tela. A exportação ficou registrada na auditoria.`,
        variant: "success",
      });
    } catch {
      toast({ title: "Não foi possível exportar as lideranças. Verifique a conexão e tente de novo.", variant: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" leadingIcon={<Download />} trailingIcon={<ChevronDown />} loading={busy}>
          Exportar
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Lideranças com os filtros da tela</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void download("xlsx")}>Planilha (XLSX)</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void download("csv")}>Texto separado (CSV)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
