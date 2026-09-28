/**
 * Catálogo de venda — todas as peças cadastradas (Componentes) com o saldo
 * real na expedição, direto do banco (RPC `catalogo_venda`).
 * Usado pelo novo pedido e por "Adicionar peça".
 */
import { supabase } from "@/integrations/supabase/client";

export interface PecaCatalogo {
  device_id: string;
  model: string;
  reference: string;
  internal_code: string | null;
  preco_venda: number;
  desconto_max_pct: number;
  unidade: string | null;
  /** Item da expedição com mais saldo (é o que vai para o pedido). Null = nunca entrou na expedição. */
  stock_item_id: string | null;
  /** Saldo livre (sem reservas) desse item da expedição. */
  disponivel: number;
  /** Saldo livre somando todos os itens de expedição da peça. */
  disponivel_total: number;
  /** Quantidade ainda na intermediária/retrabalho (a caminho). */
  em_producao: number;
}

export async function carregarCatalogoVenda(): Promise<PecaCatalogo[]> {
  const { data, error } = await supabase.rpc("catalogo_venda");
  if (error) throw error;
  return ((data ?? []) as unknown as PecaCatalogo[]).map(p => ({
    ...p,
    preco_venda: Number(p.preco_venda ?? 0),
    desconto_max_pct: Number(p.desconto_max_pct ?? 0),
    disponivel: Number(p.disponivel ?? 0),
    disponivel_total: Number(p.disponivel_total ?? 0),
    em_producao: Number(p.em_producao ?? 0),
  }));
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Busca por nome, referência ou código — várias palavras, sem acento, em qualquer ordem. */
export function filtrarCatalogo<T extends Pick<PecaCatalogo, "model" | "reference" | "internal_code">>(lista: T[], busca: string): T[] {
  const termos = semAcento(busca.trim()).split(/\s+/).filter(Boolean);
  if (!termos.length) return lista;
  return lista.filter(p => {
    const alvo = semAcento(`${p.model ?? ""} ${p.reference ?? ""} ${p.internal_code ?? ""}`);
    return termos.every(t => alvo.includes(t));
  });
}
