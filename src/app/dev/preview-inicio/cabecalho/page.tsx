import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PATHNAME_HEADER } from "@/lib/auth/portal";

/**
 * Mostra o caminho que o middleware encaminhou à página (`x-hfm-pathname`).
 *
 * É nele que a trava do portal confia (`requireSession`). Esta rota existe
 * para o teste provar duas coisas sem precisar de sessão: o cabeçalho chega
 * preenchido e um valor mandado pelo cliente é sobrescrito pelo caminho
 * real. Mesmo portão do design system: ausente de um build de produção.
 */
export const dynamic = "force-dynamic";

const enabled =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

export default async function PathnameHeaderPreview() {
  if (!enabled) notFound();
  const pathname = (await headers()).get(PATHNAME_HEADER);
  return (
    <main className="p-6">
      <p data-testid="pathname">{pathname ?? "(ausente)"}</p>
    </main>
  );
}
