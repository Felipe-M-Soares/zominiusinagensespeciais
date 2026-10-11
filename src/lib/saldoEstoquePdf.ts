/**
 * saldoEstoquePdf — leitura do relatório "SALDO DE ESTOQUE" (ERP antigo, PDF).
 *
 * Estrutura do relatório (uma peça pode ter vários endereços e lotes):
 *
 *   ANCM - ANALOGO CM                                  ← grupo (ignorado)
 *   000044 - ANALOGO CM NC Ø3.5 ST                     ← código ERP + nome da peça
 *       ENDERECO: EXP - PRODUTO ACABADO                ← EXP = expedição, INT = intermediário
 *        20171107151544167  2303172-11  NC Ø3.5 ST  ATIVO 01/04/2017 18/02/2025 UN  1  1  0
 *        └ nº UAR (17 dígitos) · lote · referência · situação · validade · últ. mov. · unid · QTD · RESERVA · SALDO
 *
 * Só EXP e INT viram estoque no app; os demais endereços (ferramentas, uso e
 * consumo, recebimento, produção...) são contados e ignorados.
 *
 * Funções puras (sem pdfjs) para poderem ser testadas; o componente só
 * transforma cada página em linhas de texto e chama `lerLinhasSaldo`.
 */

export type FaseSaldo = "intermediaria" | "expedicao";

export interface LoteSaldo {
  lote: string;
  /** Quantidade física (coluna QTD). */
  qtd: number;
  /** Reservado no ERP antigo (coluna RESERVA). */
  reserva: number;
  /** QTD − RESERVA (coluna SALDO). */
  saldo: number;
}

export interface PecaSaldo {
  codigoErp: string;
  nome: string;
  /** Referência do lote mais recente (as antigas costumam ser só "Ø4.5 AT"). */
  referencia: string;
  referencias: string[];
  fases: Partial<Record<FaseSaldo, LoteSaldo[]>>;
}

export interface ResultadoSaldo {
  pecas: PecaSaldo[];
  /** Peças que só aparecem em outros endereços (ferramentas, consumo...). */
  pecasIgnoradas: number;
  /** Endereços ignorados → nº de lotes. */
  enderecosIgnorados: Record<string, number>;
  /** Lotes de EXP/INT sem número de lote (não dá para dar entrada). */
  lotesSemNumero: { codigoErp: string; nome: string; quantidade: number }[];
}

// ── Linhas de texto de uma página (pdfjs) ────────────────────────────────────

export interface ItemTexto { str: string; transform: number[] }

/** Agrupa os pedaços de texto pela altura (y) e devolve as linhas, de cima para baixo. */
export function linhasDaPagina(itens: ItemTexto[]): string[] {
  const porY: { y: number; itens: ItemTexto[] }[] = [];
  for (const it of itens) {
    if (!it.str.trim()) continue;
    const y = it.transform[5];
    const grupo = porY.find(g => Math.abs(g.y - y) <= 2.5);
    if (grupo) grupo.itens.push(it); else porY.push({ y, itens: [it] });
  }
  return porY
    .sort((a, b) => b.y - a.y)
    .map(g => g.itens.sort((a, b) => a.transform[4] - b.transform[4]).map(i => i.str.trim()).join(" ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

// ── Interpretação ────────────────────────────────────────────────────────────

const RE_ITEM     = /^\s*(\d{6})\s*-\s*(.+?)\s*$/;
const RE_ENDERECO = /ENDERE[CÇ]O\s*:\s*(.*)$/i;
const RE_LOTE     = /^\s*(\d{17})\s+(.*)$/;
const RE_FIM      = /\s(\S+)\s+(-?[\d.,]+)\s+(-?[\d.,]+)\s+(-?[\d.,]+)\s*$/;
const RE_DATA     = /\s*\b\d{2}\/\d{2}\/\d{4}\b/g;
const RE_SITUACAO = /\s*(INATIVO|ATIVO|BLOQUEADO|VENCIDO)\s*$/i;
const RE_NUM_LOTE = /^\d{3,}[0-9A-Za-z\-/.]*$/;

/** "4.995" → 4995 · "1,5" → 1.5 (formato brasileiro). */
export function numeroBR(s: string): number {
  const v = parseFloat(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(v) ? v : 0;
}

function faseDoEndereco(endereco: string): FaseSaldo | null {
  const cod = endereco.split(" - ")[0].trim().toUpperCase();
  if (cod === "EXP") return "expedicao";
  if (cod === "INT") return "intermediaria";
  return null;
}

interface PecaTmp {
  codigoErp: string; nome: string;
  refs: Map<string, string>;             // referência → UAR mais recente
  fases: Map<FaseSaldo, Map<string, LoteSaldo>>;
  emOutroEndereco: boolean;
}

export function lerLinhasSaldo(linhas: string[]): ResultadoSaldo {
  const pecas = new Map<string, PecaTmp>();
  const enderecosIgnorados: Record<string, number> = {};
  const lotesSemNumero: ResultadoSaldo["lotesSemNumero"] = [];
  let atual: PecaTmp | null = null;
  let fase: FaseSaldo | null = null;
  let endereco = "";

  for (const linha of linhas) {
    const mItem = linha.match(RE_ITEM);
    if (mItem) {
      const codigo = mItem[1];
      atual = pecas.get(codigo) ?? { codigoErp: codigo, nome: mItem[2].trim(), refs: new Map(), fases: new Map(), emOutroEndereco: false };
      pecas.set(codigo, atual);
      fase = null; endereco = "";
      continue;
    }
    const mEnd = linha.match(RE_ENDERECO);
    if (mEnd) { endereco = mEnd[1].trim(); fase = faseDoEndereco(endereco); continue; }

    const mLote = linha.match(RE_LOTE);
    if (!mLote || !atual) continue;
    const uar = mLote[1];
    const resto = " " + mLote[2];
    const mFim = resto.match(RE_FIM);
    if (!mFim) continue;
    const qtd = Math.round(numeroBR(mFim[2]));
    const reserva = Math.round(numeroBR(mFim[3]));
    const saldo = Math.round(numeroBR(mFim[4]));

    if (!fase) {
      atual.emOutroEndereco = true;
      const chave = endereco || "(sem endereço)";
      enderecosIgnorados[chave] = (enderecosIgnorados[chave] ?? 0) + 1;
      continue;
    }

    // "lote referência ATIVO dd/mm/aaaa dd/mm/aaaa" → tira datas e situação
    let cabeca = resto.slice(0, resto.length - mFim[0].length).replace(RE_DATA, " ").trim();
    cabeca = cabeca.replace(RE_SITUACAO, "").replace(/ATIVO$/i, "").trim();
    const tokens = cabeca.split(/\s+/).filter(Boolean);
    const lote = tokens.length && RE_NUM_LOTE.test(tokens[0]) ? tokens.shift()! : "";
    const referencia = tokens.join(" ").trim();

    if (referencia) {
      const ant = atual.refs.get(referencia);
      if (!ant || uar > ant) atual.refs.set(referencia, uar);
    }
    // A peça entra no cadastro mesmo que o lote não tenha número.
    const lotes = atual.fases.get(fase) ?? new Map<string, LoteSaldo>();
    atual.fases.set(fase, lotes);
    if (!lote) {
      lotesSemNumero.push({ codigoErp: atual.codigoErp, nome: atual.nome, quantidade: saldo });
      continue;
    }
    const l = lotes.get(lote) ?? { lote, qtd: 0, reserva: 0, saldo: 0 };
    l.qtd += qtd; l.reserva += reserva; l.saldo += saldo;
    lotes.set(lote, l);
  }

  const lista: PecaSaldo[] = [];
  let pecasIgnoradas = 0;
  for (const p of pecas.values()) {
    if (p.fases.size === 0) { pecasIgnoradas++; continue; }
    const refsOrdenadas = [...p.refs.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([r]) => r);
    const fases: PecaSaldo["fases"] = {};
    for (const [f, lotes] of p.fases) fases[f] = [...lotes.values()];
    lista.push({ codigoErp: p.codigoErp, nome: p.nome, referencia: refsOrdenadas[0] ?? "", referencias: refsOrdenadas, fases });
  }
  return { pecas: lista, pecasIgnoradas, enderecosIgnorados, lotesSemNumero };
}

/** Resumo para a pré-visualização. */
export function resumoSaldo(pecas: PecaSaldo[], usarQtdTotal: boolean) {
  let lotes = 0, unidades = 0, lotesInter = 0, lotesExp = 0, comSaldo = 0;
  for (const p of pecas) {
    let temSaldo = false;
    for (const [f, ls] of Object.entries(p.fases) as [FaseSaldo, LoteSaldo[]][]) {
      for (const l of ls) {
        const q = usarQtdTotal ? l.qtd : l.saldo;
        if (q > 0) { lotes++; unidades += q; temSaldo = true; if (f === "intermediaria") lotesInter++; else lotesExp++; }
      }
    }
    if (temSaldo) comSaldo++;
  }
  return { pecas: pecas.length, comSaldo, lotes, lotesInter, lotesExp, unidades };
}
