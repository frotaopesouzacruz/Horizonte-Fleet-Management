"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/feedback/error-state";

/**
 * Limite de erro das páginas autenticadas.
 *
 * Sem ele, qualquer consulta que falhe no servidor derruba a página inteira na
 * tela genérica do Next ("This page couldn't load"), sem menu e sem saída.
 * Aqui o menu e o topo continuam, a pessoa lê o que aconteceu em português e
 * pode tentar de novo. O identificador (`digest`) é o que o suporte procura
 * nos logs — a mensagem técnica do servidor não chega ao navegador.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [retrying, startRetry] = React.useTransition();

  React.useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      variant="page"
      title="Não foi possível carregar esta página."
      description="Uma consulta não respondeu a tempo ou foi recusada. Tente novamente; se continuar, informe o código abaixo ao suporte."
      onRetry={() =>
        startRetry(() => {
          router.refresh();
          reset();
        })
      }
      retrying={retrying}
      details={error.digest ? `Código: ${error.digest}` : undefined}
      detailsLabel="Código para o suporte"
    />
  );
}
