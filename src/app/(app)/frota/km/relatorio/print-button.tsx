"use client";

import * as React from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * "Salvar como PDF": abre a impressão do navegador (que oferece salvar em
 * PDF). Durante a impressão o tema escuro sai de cena — papel é claro — e
 * volta logo depois.
 */
export function PrintButton() {
  React.useEffect(() => {
    let hadDark = false;
    const before = () => {
      const root = document.documentElement;
      hadDark = root.classList.contains("dark");
      if (hadDark) root.classList.remove("dark");
    };
    const after = () => {
      if (hadDark) document.documentElement.classList.add("dark");
      hadDark = false;
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  return (
    <Button leadingIcon={<Printer aria-hidden />} onClick={() => window.print()} data-testid="km-relatorio-print">
      Salvar como PDF
    </Button>
  );
}
