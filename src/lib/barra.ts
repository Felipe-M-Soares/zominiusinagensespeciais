/**
 * barra — conversões de matéria-prima em barra.
 *
 * A barra é comprada por PESO (kg, como vem na nota) e gasta em BARRAS de 3 m
 * (o operador informa quantas barras gastou no lançamento). O peso de cada
 * diâmetro é medido na balança e cadastrado em `peso_barra_kg`; com ele a
 * nota em kg vira nº de barras. O saldo do estoque é guardado em metros
 * (barras × 3 m) e mostrado em barras e kg.
 *
 * Enquanto o peso não foi medido, `pesoTeoricoBarraKg` dá uma estimativa pela
 * densidade do material (só referência — não substitui a balança).
 */

export interface BarraInfo {
  descricao: string;
  diametro_mm?: number | null;
  comprimento_barra_m?: number | null;
  peso_barra_kg?: number | null;
}

export const COMPRIMENTO_BARRA_PADRAO_M = 3;

/** Densidade aproximada (g/cm³) pela descrição do material. */
export function densidadeMaterial(descricao: string): number | null {
  const d = descricao.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  if (d.includes("TITANIO") || /\bTI\b/.test(d) || d.includes("F136")) return 4.43;
  if (d.includes("CROMO") || d.includes("COBALTO") || d.includes("CRCO") || d.includes("F1537")) return 8.3;
  if (d.includes("INOX") || d.includes("303") || d.includes("316")) return 8.0;
  if (d.includes("POLIACETAL") || d.includes("POM") || d.includes("DELRIN")) return 1.41;
  if (d.includes("PEEK")) return 1.31;
  if (d.includes("ALUMINIO")) return 2.7;
  if (d.includes("LATAO")) return 8.5;
  if (d.includes("ACO")) return 7.85;
  return null;
}

/** Diâmetro a partir da descrição ("... Ø9,53" → 9.53), quando não cadastrado. */
export function diametroDaDescricao(descricao: string): number | null {
  const m = descricao.match(/[ØøΦ]\s*(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const v = parseFloat(m[1].replace(",", "."));
  return v > 0 ? v : null;
}

export function comprimentoBarraM(mp: BarraInfo): number {
  const c = Number(mp.comprimento_barra_m);
  return c > 0 ? c : COMPRIMENTO_BARRA_PADRAO_M;
}

/** Peso teórico de uma barra (kg) = área × comprimento × densidade. */
export function pesoTeoricoBarraKg(mp: BarraInfo): number | null {
  const d = Number(mp.diametro_mm) || diametroDaDescricao(mp.descricao);
  const rho = densidadeMaterial(mp.descricao);
  if (!d || !rho) return null;
  const areaMm2 = (Math.PI / 4) * d * d;
  // mm² × 1000 mm/m × g/cm³ ÷ 1000 (mm³→cm³) = g/m → ÷ 1000 = kg/m
  return ((areaMm2 * rho) / 1000) * comprimentoBarraM(mp);
}

/** Peso medido (cadastrado) da barra, ou null se ainda não foi pesada. */
export function pesoBarraKg(mp: BarraInfo): number | null {
  const p = Number(mp.peso_barra_kg);
  return p > 0 ? p : null;
}

/** Nota em kg → nº de barras (null = peso da barra ainda não cadastrado). */
export function kgParaBarras(kg: number, mp: BarraInfo): number | null {
  const p = pesoBarraKg(mp);
  return p ? kg / p : null;
}
export function barrasParaKg(barras: number, mp: BarraInfo, aceitarTeorico = false): number | null {
  const p = pesoBarraKg(mp) ?? (aceitarTeorico ? pesoTeoricoBarraKg(mp) : null);
  return p ? barras * p : null;
}
export function barrasParaMetros(barras: number, mp: BarraInfo): number {
  return barras * comprimentoBarraM(mp);
}
export function metrosParaBarras(m: number, mp: BarraInfo): number {
  return m / comprimentoBarraM(mp);
}
export function kgParaMetros(kg: number, mp: BarraInfo): number | null {
  const b = kgParaBarras(kg, mp);
  return b == null ? null : barrasParaMetros(b, mp);
}
export function metrosParaKg(m: number, mp: BarraInfo, aceitarTeorico = false): number | null {
  return barrasParaKg(metrosParaBarras(m, mp), mp, aceitarTeorico);
}

/** Rendimento do lançamento: peças boas por barra gasta. */
export function pecasPorBarra(pecas: number, barras: number): number | null {
  return barras > 0 && pecas > 0 ? pecas / barras : null;
}

const nf = (v: number, max = 2) => v.toLocaleString("pt-BR", { maximumFractionDigits: max });

export function fmtMetros(m: number): string { return `${nf(m, 2)} m`; }
export function fmtBarras(b: number): string {
  const v = Math.round(b * 10) / 10;
  return `${nf(v, 1)} barra${Math.abs(v) === 1 ? "" : "s"}`;
}
export function fmtKg(kg: number): string { return `${nf(kg, kg < 10 ? 3 : 1)} kg`; }
