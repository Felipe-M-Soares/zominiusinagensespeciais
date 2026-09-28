/**
 * Filtros do Guia: por perfil ("só o que meu perfil usa") e busca instantânea
 * sem acento. Funções puras — usadas pela tela e pelos testes.
 */
import { temPapel, type AppRole } from "@/types/roles";
import {
  normalizarBusca, perfisDaTarefa,
  type EtapaFluxo, type PerguntaFAQ, type SecaoGuia, type TarefaGuia, type TermoGlossario,
} from "./conteudo";

/** O perfil usa esse item? Lista vazia = todos. Admin vê tudo; gerente, tudo menos o que é só de admin. */
export function perfilUsa(role: AppRole | null | undefined, perfis: AppRole[] | undefined): boolean {
  if (!perfis || perfis.length === 0) return true;
  if (role === "admin") return true;
  return temPapel(role, ...perfis);
}

/** Palavras da busca, já normalizadas. */
export function termosBusca(q: string): string[] {
  return normalizarBusca(q).split(/\s+/).map(t => t.trim()).filter(Boolean);
}

function contemTodos(texto: string, termos: string[]): boolean {
  if (termos.length === 0) return true;
  const n = normalizarBusca(texto);
  return termos.every(t => n.includes(t));
}

export function textoTarefa(secao: SecaoGuia, t: TarefaGuia): string {
  return [secao.titulo, t.titulo, t.palavras ?? "", t.resumo ?? "", ...t.passos, ...(t.dicas ?? []), ...(t.atencao ?? [])].join(" ");
}

export interface SecaoFiltrada {
  secao: SecaoGuia;
  tarefas: TarefaGuia[];
}

/**
 * Seções e tarefas visíveis.
 * - soMeuPerfil: esconde tarefas/seções de outros perfis.
 * - q: todas as palavras precisam aparecer (título, passos, dicas...). Um termo
 *   que bate no título da seção mostra a seção inteira.
 */
export function filtrarSecoes(
  secoes: SecaoGuia[], opts: { q: string; role: AppRole | null | undefined; soMeuPerfil: boolean },
): SecaoFiltrada[] {
  const termos = termosBusca(opts.q);
  const out: SecaoFiltrada[] = [];
  for (const secao of secoes) {
    if (opts.soMeuPerfil && secao.perfis && !perfilUsa(opts.role, secao.perfis)) continue;
    const tarefas = secao.tarefas
      .filter(t => (!opts.soMeuPerfil || perfilUsa(opts.role, perfisDaTarefa(secao, t))) && contemTodos(textoTarefa(secao, t), termos))
      // Na busca, quem tem as palavras no título vem primeiro (ordem original no resto).
      .map((t, i) => ({ t, i, titulo: termos.length > 0 && contemTodos(`${t.titulo} ${t.palavras ?? ""}`, termos) ? 0 : 1 }))
      .sort((a, b) => a.titulo - b.titulo || a.i - b.i)
      .map(x => x.t);
    if (tarefas.length > 0) out.push({ secao, tarefas });
  }
  return out;
}

export function filtrarFaq(faq: PerguntaFAQ[], opts: { q: string; role: AppRole | null | undefined; soMeuPerfil: boolean }): PerguntaFAQ[] {
  const termos = termosBusca(opts.q);
  return faq.filter(p => (!opts.soMeuPerfil || perfilUsa(opts.role, p.perfis)) && contemTodos(`${p.pergunta} ${p.resposta.join(" ")}`, termos));
}

export function filtrarGlossario(termos: TermoGlossario[], q: string): TermoGlossario[] {
  const tt = termosBusca(q);
  return termos.filter(g => contemTodos(`${g.termo} ${g.definicao}`, tt));
}

export function filtrarFluxo(etapas: EtapaFluxo[], q: string): boolean {
  const tt = termosBusca(q);
  if (tt.length === 0) return true;
  return contemTodos(`da venda a entrega fluxo ${etapas.map(e => `${e.quem} ${e.titulo} ${e.texto} ${e.situacao ?? ""}`).join(" ")}`, tt);
}
