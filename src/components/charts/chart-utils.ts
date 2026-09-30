/**
 * Utilidades de desenho do kit de gráficos do HFM.
 *
 * Os gráficos são SVG desenhados à mão (sem biblioteca): cada marca é medida em
 * pixels reais do cartão, então o texto do eixo tem sempre o tamanho do token e
 * nunca "estica" junto com o desenho. Aqui ficam só funções puras — escala,
 * caminhos com canto arredondado e formatação pt-BR.
 */

const nf = new Intl.NumberFormat("pt-BR");
const pct1 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

export const chartFormat = {
  int: (v: number) => nf.format(v),
  pct: (v: number) => `${pct1.format(v)}%`,
  pctAxis: (v: number) => `${nf.format(v)}%`,
  compact: (v: number) => (Math.abs(v) >= 10_000 ? compact.format(v) : nf.format(v)),
};

/** Eixo "redondo": passo 1·2·2,5·5·10 × 10ⁿ, topo cobrindo o máximo. */
export function niceScale(min: number, max: number, ticks = 4, integer = false): { min: number; max: number; step: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, step: 0.25 };
  if (max <= min) max = min + (integer ? ticks : 1);
  const raw = (max - min) / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  let step = nice * mag;
  if (integer) step = Math.max(1, Math.ceil(step));
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  return { min: lo, max: hi, step };
}

export function ticksOf(scale: { min: number; max: number; step: number }): number[] {
  const out: number[] = [];
  // Soma com arredondamento: 0,1 + 0,2 não pode virar 0,30000000000000004 no eixo.
  for (let t = scale.min; t <= scale.max + scale.step / 1000; t += scale.step) out.push(Math.round(t * 1e6) / 1e6);
  return out;
}

/**
 * Domínio para percentuais em linha: não começa obrigatoriamente em zero (uma
 * linha não mede área), mas sempre mostra a meta e nunca passa de 0–100.
 */
export function percentDomain(values: (number | null | undefined)[], target?: number | null): [number, number] {
  const present = values.filter((v): v is number => v != null);
  if (target != null) present.push(target);
  if (present.length === 0) return [0, 100];
  const lo = Math.min(...present);
  const hi = Math.max(...present);
  const min = Math.max(0, Math.floor((lo - 6) / 10) * 10);
  const max = Math.min(100, Math.ceil((hi + 2) / 10) * 10);
  return [min, Math.max(max, min + 10)];
}

/** Coluna com topo arredondado e base reta na linha de base. */
export function columnPath(x: number, top: number, base: number, w: number, r = 4): string {
  const rr = Math.max(0, Math.min(r, base - top, w / 2));
  return `M${x},${base} V${top + rr} a${rr},${rr} 0 0 1 ${rr},${-rr} h${w - 2 * rr} a${rr},${rr} 0 0 1 ${rr},${rr} V${base} Z`;
}

/** Barra horizontal com ponta arredondada e base reta no eixo. */
export function barPath(x0: number, cy: number, w: number, h: number, r = 4): string {
  const rr = Math.max(0, Math.min(r, w, h / 2));
  const straight = Math.max(0, w - rr);
  return `M${x0},${cy - h / 2} h${straight} a${rr},${rr} 0 0 1 ${rr},${rr} v${h - 2 * rr} a${rr},${rr} 0 0 1 ${-rr},${rr} h${-straight} Z`;
}

export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

/** Largura aproximada do texto em px para Montserrat — só para decidir onde cabe um rótulo. */
export function approxTextWidth(text: string, fontSize = 11): number {
  return text.length * fontSize * 0.58;
}

/** Linha poligonal por segmentos contínuos (quebra onde o valor é nulo). */
export function segmentsOf(points: ({ x: number; y: number } | null)[]): { x: number; y: number }[][] {
  const out: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  for (const p of points) {
    if (p) current.push(p);
    else if (current.length) {
      out.push(current);
      current = [];
    }
  }
  if (current.length) out.push(current);
  return out;
}

export function linePath(seg: { x: number; y: number }[]): string {
  return seg.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
}
