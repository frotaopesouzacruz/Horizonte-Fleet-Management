import { notFound } from "next/navigation";
import { PreviewBatches } from "./preview-batches";

/**
 * A importação sem teto de linhas, de ponta a ponta no navegador: a gaveta
 * real da Fidelização, a leitura real da planilha (XLSX e CSV) e o protocolo
 * real de envio em partes — só as rotinas do servidor são simuladas, para que
 * a tela abra sem sessão. Cada parte enviada, validada e gravada fica em
 * `window.__importBatches`, para a suíte conferir que nada se perdeu.
 *
 * Mesmo portão do design system: ausente de um build de produção normal.
 */
export const metadata = { title: "Preview · Importação em partes", robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

const enabled =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

export default function PreviewPage() {
  if (!enabled) notFound();
  return (
    <main className="p-6">
      <PreviewBatches />
    </main>
  );
}
