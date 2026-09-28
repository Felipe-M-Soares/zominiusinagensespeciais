/**
 * Leitura de extrato bancário OFX (padrão dos bancos brasileiros — v1 SGML e
 * v2 XML) e sugestão de conciliação com as contas em aberto.
 */

export interface TransacaoOfx {
  fitid: string;
  data: string;      // AAAA-MM-DD
  valor: number;     // positivo = entrada, negativo = saída
  descricao: string;
}

export interface ExtratoOfx {
  banco: string | null;
  conta: string | null;
  transacoes: TransacaoOfx[];
}

/** Decodifica o arquivo respeitando o CHARSET do cabeçalho (bancos BR usam muito o 1252). */
export function decodificarOfx(buf: ArrayBuffer): string {
  const inicio = new TextDecoder("latin1").decode(buf.slice(0, 600));
  const latin = /CHARSET:\s*(1252|ISO-8859-1|8859)/i.test(inicio) || /encoding="(windows-1252|iso-8859-1)"/i.test(inicio);
  if (latin) return new TextDecoder("windows-1252").decode(buf);
  const utf = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  // Se aparecerem caracteres de substituição, era 1252 sem declarar.
  return utf.includes("�") ? new TextDecoder("windows-1252").decode(buf) : utf;
}

function campo(bloco: string, tag: string): string {
  // Funciona com <TAG>valor</TAG> (v2) e <TAG>valor (v1, sem fechamento).
  const m = bloco.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, "i"));
  return (m?.[1] ?? "").trim();
}

function dataOfx(v: string): string | null {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function valorOfx(v: string): number {
  const t = v.replace(/\s/g, "");
  // Alguns bancos mandam "1.234,56"; o padrão é "1234.56".
  const n = /,\d{1,2}$/.test(t) ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

const entidades = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

export function lerOfx(texto: string): ExtratoOfx {
  const corpo = texto.slice(Math.max(0, texto.search(/<OFX>/i)));
  const transacoes: TransacaoOfx[] = [];
  const blocos = corpo.split(/<STMTTRN>/i).slice(1);
  const vistos = new Set<string>();
  for (const b0 of blocos) {
    const b = b0.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0];
    const data = dataOfx(campo(b, "DTPOSTED"));
    const valor = valorOfx(campo(b, "TRNAMT"));
    if (!data || !Number.isFinite(valor) || valor === 0) continue;
    const descricao = entidades([campo(b, "NAME"), campo(b, "MEMO")].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" · ")) || campo(b, "TRNTYPE");
    let fitid = campo(b, "FITID") || `${data}|${valor}|${descricao}`;
    // Alguns bancos repetem FITID no mesmo arquivo — diferencia sem perder a transação.
    while (vistos.has(fitid)) fitid += "+";
    vistos.add(fitid);
    transacoes.push({ fitid, data, valor, descricao });
  }
  return { banco: campo(corpo, "BANKID") || campo(corpo, "ORG") || null, conta: campo(corpo, "ACCTID") || null, transacoes };
}

export interface ContaAberta {
  id: string; tipo: "pagar" | "receber"; valor: number; data_vencimento: string; nome: string; descricao: string;
}

const diasEntre = (a: string, b: string) => Math.abs(new Date(`${a}T12:00:00`).getTime() - new Date(`${b}T12:00:00`).getTime()) / 86400000;

/** Contas compatíveis com a transação: mesmo sentido, mesmo valor (±1 centavo), vencimento até 45 dias de distância — as mais próximas primeiro. */
export function candidatas(t: TransacaoOfx, contas: ContaAberta[]): ContaAberta[] {
  const tipo = t.valor > 0 ? "receber" : "pagar";
  const v = Math.abs(t.valor);
  return contas
    .filter(c => c.tipo === tipo && Math.abs(c.valor - v) <= 0.01 && diasEntre(c.data_vencimento, t.data) <= 45)
    .sort((a, b) => diasEntre(a.data_vencimento, t.data) - diasEntre(b.data_vencimento, t.data));
}

/** Sugere uma conta por transação, sem usar a mesma conta duas vezes (as transações de valor mais raro escolhem primeiro). */
export function sugerirConciliacao(transacoes: TransacaoOfx[], contas: ContaAberta[]): Record<string, string | null> {
  const cands = transacoes.map(t => ({ t, c: candidatas(t, contas) }));
  const ordem = [...cands].sort((a, b) => a.c.length - b.c.length || a.t.data.localeCompare(b.t.data));
  const usadas = new Set<string>();
  const r: Record<string, string | null> = {};
  for (const { t, c } of ordem) {
    const escolha = c.find(x => !usadas.has(x.id)) ?? null;
    if (escolha) usadas.add(escolha.id);
    r[t.fitid] = escolha?.id ?? null;
  }
  return r;
}
