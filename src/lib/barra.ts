/**
 * barra — conversões de matéria-prima em barra.
 *
 * A barra é comprada por PESO (kg) e consumida por METRO. Toda barra tem
 * 3 m (configurável por material); o peso de cada diâmetro é medido na
 * balança e cadastrado em `peso_barra_kg`. O saldo do estoque é sempre em
 * metros — barras e kg são apenas conversões para exibição/entrada.
 *
 * Enquanto o peso não foi medido, `pesoTeoricoBarraKg` dá uma estimativa pela
 * densidade do material (serve de referência, não substitui a balança).
 */

export interface BarraInfo {
  descricao: string;
  diametro_mm?: number | null;
  comprimento_barra_m?: number | null;
  peso_barra_kg?: number | null;
  sobra_barra_mm?: number | null;
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
  const kgPorMetro = (areaMm2 * rho) / 1000;
  return kgPorMetro * comprimentoBarraM(mp);
}

/** Peso medido (cadastrado) da barra, ou null se ainda não foi pesada. */
export function pesoBarraKg(mp: BarraInfo): number | null {
  const p = Number(mp.peso_barra_kg);
  return p > 0 ? p : null;
}

/** kg por metro — usa o peso medido; com `aceitarTeorico`, cai na estimativa. */
export function kgPorMetro(mp: BarraInfo, aceitarTeorico = false): number | null {
  const peso = pesoBarraKg(mp) ?? (aceitarTeorico ? pesoTeoricoBarraKg(mp) : null);
  return peso ? peso / comprimentoBarraM(mp) : null;
}

export function kgParaMetros(kg: number, mp: BarraInfo): number | null {
  const kpm = kgPorMetro(mp);
  return kpm ? kg / kpm : null;
}
export function metrosParaKg(m: number, mp: BarraInfo, aceitarTeorico = false): number | null {
  const kpm = kgPorMetro(mp, aceitarTeorico);
  return kpm ? m * kpm : null;
}
export function metrosParaBarras(m: number, mp: BarraInfo): number {
  return m / comprimentoBarraM(mp);
}

/** Fator da ponta que sobra em cada barra (ex.: 3 m com 150 mm de sobra → 1,0526). */
export function fatorSobra(mp: BarraInfo): number {
  const c = comprimentoBarraM(mp) * 1000;
  const s = Math.max(0, Number(mp.sobra_barra_mm) || 0);
  return s > 0 && s < c ? c / (c - s) : 1;
}

/**
 * Consumo de um lançamento.
 * Peças boas + refugadas gastam barra: metros = peças × (comprimento + corte).
 * `baixa` inclui a ponta de barra — é o que sai do estoque (igual ao banco).
 */
export function calcularConsumo(params: {
  pecasBoas: number; pecasRefugo: number; mmPorPeca: number; mp?: BarraInfo | null;
}) {
  const pecas = Math.max(0, params.pecasBoas) + Math.max(0, params.pecasRefugo);
  const mm = Math.max(0, params.mmPorPeca);
  const metros = Math.round(((pecas * mm) / 1000) * 1000) / 1000;
  const baixa = params.mp ? Math.round(metros * fatorSobra(params.mp) * 1000) / 1000 : metros;
  return {
    pecas,
    metros,
    baixa,
    barras: params.mp ? metrosParaBarras(baixa, params.mp) : baixa / COMPRIMENTO_BARRA_PADRAO_M,
    kg: params.mp ? metrosParaKg(baixa, params.mp, true) : null,
    kgEstimado: !!params.mp && !pesoBarraKg(params.mp),
  };
}

/** Peças que ainda dá para fazer com o saldo (desconta a ponta). */
export function pecasPossiveis(saldoMetros: number, mmPorPeca: number, mp: BarraInfo): number {
  if (mmPorPeca <= 0 || saldoMetros <= 0) return 0;
  return Math.floor((saldoMetros / fatorSobra(mp)) * 1000 / mmPorPeca);
}

const nf = (v: number, max = 2) => v.toLocaleString("pt-BR", { maximumFractionDigits: max });

export function fmtMetros(m: number): string { return `${nf(m, 2)} m`; }
export function fmtBarras(b: number): string {
  const v = Math.round(b * 10) / 10;
  return `${nf(v, 1)} barra${Math.abs(v) === 1 ? "" : "s"}`;
}
export function fmtKg(kg: number): string { return `${nf(kg, kg < 10 ? 3 : 1)} kg`; }
