/**
 * Rótulos comuns do Relatório Gerencial (planilha e versão imprimível).
 */
import { KM_BAND, KM_OUTLIER, KM_QUADRANT } from "@/lib/km/types";

export const REPORT_TITLE = "Relatório Gerencial de KM Rodado";

export const COHORT_LEVEL: Record<string, string> = {
  N1: "N1 · tipo, subcategoria e modelo",
  N2: "N2 · tipo e subcategoria",
  N3: "N3 · tipo",
};

export const CONFIDENCE_LABEL: Record<string, string> = {
  high: "Alta",
  medium: "Média",
  low: "Baixa",
  none: "Sem base",
};

export const TONE_LABEL: Record<string, string> = {
  success: "Positivo",
  warning: "Atenção",
  danger: "Crítico",
  info: "Informativo",
  neutral: "Informativo",
};

export const bandLabel = (code: string | null | undefined) => (code ? (KM_BAND[code]?.label ?? code) : "—");
export const quadrantLabel = (code: string | null | undefined) => (code ? (KM_QUADRANT[code]?.label ?? code) : "—");
export const outlierLabel = (code: string | null | undefined) => (code ? (KM_OUTLIER[code] ?? code) : "");

export const PARITY_NOTE =
  "Mesmo conjunto de dados da tela, com os mesmos filtros e o mesmo escopo de acesso. Valores fixos, calculados pelo banco no momento da geração.";
export const NO_READING_NOTE =
  "Sem leitura não é 0 km: dias sem informação confiável de hodômetro ficam fora das somas e médias, e a cobertura mostra quanto do período foi medido.";
export const OUTLIER_NOTE =
  "“Ponto para análise” sinaliza rodagem fora do padrão da coorte técnica (tipo, subcategoria e modelo). Não é erro: é um caso a examinar.";
