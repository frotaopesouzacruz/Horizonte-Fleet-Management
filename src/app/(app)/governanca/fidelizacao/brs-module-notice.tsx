import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";

export interface BrsModuleNoticeProps {
  /** Rota do módulo BRs, já com os filtros em tela para a pessoa não os refazer. */
  href: string;
}

/**
 * O cadastro de BRs saiu daqui (Etapa 13.1, §38).
 *
 * O Planner de Locais e BRs continua sendo o lugar de consultar e planejar a
 * posição; criar, editar, importar e inativar BRs passou a acontecer no módulo
 * Governança › BRs. O aviso fica acima do planner, e não só no menu, porque
 * quem chegava aqui para cadastrar precisa saber para onde ir sem procurar.
 */
export function BrsModuleNotice({ href }: BrsModuleNoticeProps) {
  return (
    <Alert
      variant="info"
      action={
        <Button asChild variant="outline" size="sm">
          <Link href={href}>
            Abrir módulo BRs
            <ExternalLink aria-hidden />
          </Link>
        </Button>
      }
    >
      <AlertTitle>O cadastro de BRs mudou de lugar</AlertTitle>
      <AlertDescription>
        Criar, editar, importar e inativar BRs agora acontece no módulo Governança › BRs. Aqui a
        posição é consultada e planejada.
      </AlertDescription>
    </Alert>
  );
}
