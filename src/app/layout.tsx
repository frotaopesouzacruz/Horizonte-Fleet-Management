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
  icons: { icon: "/brand/favicon.svg" },
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
