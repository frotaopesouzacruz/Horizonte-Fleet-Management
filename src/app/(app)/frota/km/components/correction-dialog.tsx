"use client";

/**
 * Correção manual auditada de uma leitura diária (km_correct_reading).
 * Esqueleto do contrato — a implementação é da aba Qualidade de dados.
 */
export interface KmCorrectionTarget {
  readingId: string;
  plate: string;
  day: string;
  odometerStart: number | null;
  odometerEnd: number | null;
  /** Valores originais da fonte (nunca apagados). */
  odometerStartImported?: number | null;
  odometerEndImported?: number | null;
  kmInformed?: number | null;
  status?: string | null;
  alerts?: string[] | null;
}

export interface KmCorrectionDialogProps {
  target: KmCorrectionTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Chamado depois de gravar (a tela relê). */
  onDone?: () => void;
  /** Permite "Marcar como analisada" (km_review_reading) além da correção. */
  allowReview?: boolean;
}

export function KmCorrectionDialog(props: KmCorrectionDialogProps) {
  void props;
  return null;
}
