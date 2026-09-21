import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/design-system/theme/theme-provider";
import { ToastProvider } from "@/components/feedback/toast";
import { ConfirmProvider } from "@/components/feedback/confirm-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";

export const metadata: Metadata = {
  title: {
    default: "Horizonte Fleet Management",
    template: "%s · Horizonte Fleet Management",
  },
  description: "Plataforma corporativa de gestão de frota.",
  /**
   * O símbolo oficial da Horizonte, sobre o azul institucional. Gerado a partir
   * do lockup oficial por `scripts/brand-icons.mjs` — a marca não é redesenhada
   * em lugar nenhum, só recortada da faixa do símbolo e redimensionada.
   *
   * Não há SVG porque não existe vetor oficial no projeto, e embrulhar um PNG
   * dentro de um `<svg>` para chamá-lo de vetorial seria mentira sem ganho:
   * o .ico já carrega 16, 32 e 48 px, que é o que os navegadores pedem.
   */
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
    ],
    shortcut: "/favicon.ico",
    apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Browser chrome colour: the only place a literal is unavoidable (the meta
  // tag cannot read a CSS variable). Mirrors --background in each theme.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f4f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1426" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the theme class is applied on <html> before hydration
    <html lang="pt-BR" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ThemeProvider>
          <TooltipProvider>
            <ToastProvider>
              <ConfirmProvider>{children}</ConfirmProvider>
            </ToastProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
