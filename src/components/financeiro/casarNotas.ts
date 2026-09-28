/**
 * Casamento automático de XMLs de NF-e com pedidos prontos para faturar:
 * mesmo CPF/CNPJ do destinatário e mesmo valor total (tolerância de 5 centavos).
 * Cada pedido só recebe uma nota.
 */
export interface NotaParaCasar { chave: string; valor: number; destinatarioDoc: string | null; finalidade: string | null }
export interface PedidoParaCasar { id: string; doc: string; total: number; criadoEm: string }
export type Confianca = "exata" | "so_cliente" | "nenhuma" | "devolucao";
export interface Casamento { chave: string; pedidoId: string | null; confianca: Confianca; candidatos: string[] }

const dig = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
export const TOLERANCIA = 0.05;

export function casarNotas(notas: NotaParaCasar[], pedidos: PedidoParaCasar[]): Casamento[] {
  const usados = new Set<string>();
  const res = new Map<string, Casamento>();
  const info = notas.map(n => {
    const doc = dig(n.destinatarioDoc);
    const doCliente = doc ? pedidos.filter(p => dig(p.doc) === doc) : [];
    const exatos = doCliente.filter(p => Math.abs(p.total - n.valor) <= TOLERANCIA);
    return { n, doCliente, exatos };
  });
  // Primeiro as notas com valor exato (as de menos opções escolhem antes), depois as só por cliente.
  const ordem = [...info].sort((a, b) =>
    (a.exatos.length ? 0 : 1) - (b.exatos.length ? 0 : 1) || a.exatos.length - b.exatos.length || a.doCliente.length - b.doCliente.length);
  for (const { n, doCliente, exatos } of ordem) {
    const candidatos = doCliente.map(p => p.id);
    if (n.finalidade === "4") { res.set(n.chave, { chave: n.chave, pedidoId: null, confianca: "devolucao", candidatos: [] }); continue; }
    const pegar = (l: PedidoParaCasar[]) => [...l].sort((a, b) => Math.abs(a.total - n.valor) - Math.abs(b.total - n.valor) || a.criadoEm.localeCompare(b.criadoEm)).find(p => !usados.has(p.id));
    const exato = pegar(exatos);
    if (exato) { usados.add(exato.id); res.set(n.chave, { chave: n.chave, pedidoId: exato.id, confianca: "exata", candidatos }); continue; }
    const aprox = pegar(doCliente);
    if (aprox) { usados.add(aprox.id); res.set(n.chave, { chave: n.chave, pedidoId: aprox.id, confianca: "so_cliente", candidatos }); continue; }
    res.set(n.chave, { chave: n.chave, pedidoId: null, confianca: "nenhuma", candidatos });
  }
  return notas.map(n => res.get(n.chave)!);
}
