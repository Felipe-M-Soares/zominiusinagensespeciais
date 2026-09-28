/**
 * Guia de uso — dentro do app (antes era só um PDF embutido).
 *
 *  - Busca instantânea sem acento (título, passos, dicas, FAQ e glossário).
 *  - "Só o que meu perfil usa": esconde tarefas de outros perfis (admin vê tudo).
 *  - Índice lateral no computador; cards de módulos no celular.
 *  - Tarefas expansíveis com âncora (#modulo-tarefa), "Abrir no sistema" e
 *    "Copiar link". O botão "Baixar PDF" baixa o mesmo conteúdo em PDF
 *    (public/guia-de-uso.pdf, gerado a partir de components/guia/conteudo.ts).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { BookOpen, Download, Search, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ROLE_LABELS, type AppRole } from "@/types/roles";
import {
  FAQ_GUIA, FLUXO_VENDA, GLOSSARIO_GUIA, PERFIS_GUIA, SECOES_GUIA, ancoraTarefa, type IconeGuia,
} from "@/components/guia/conteudo";
import { filtrarFaq, filtrarFluxo, filtrarGlossario, filtrarSecoes, termosBusca } from "@/components/guia/busca";
import {
  FaqBloco, FluxoVenda, GlossarioBloco, IconeSecao, PerfisBloco, SecaoCard,
} from "@/components/guia/GuiaBlocos";

const GUIA_PDF_PATH = "/guia-de-uso.pdf";
const PREF_PERFIL = "guia-so-meu-perfil";
const SUGESTOES = ["senha", "novo pedido", "lote", "registrar NF-e", "estorno", "extrato OFX", "recall", "OEE"];
/** Com até este número de resultados, a busca já abre as tarefas encontradas. */
const ABRIR_ATE = 6;

interface ItemIndice { id: string; titulo: string; icone: IconeGuia; qtd?: number }

function lerPref(): boolean {
  try { return localStorage.getItem(PREF_PERFIL) !== "0"; } catch { return true; }
}

export default function Guia() {
  const { role: roleAuth } = useAuth();
  const role = (roleAuth ?? null) as AppRole | null;
  const isAdmin = role === "admin";
  const location = useLocation();

  const [q, setQ] = useState("");
  const [soMeuPerfilPref, setSoMeuPerfilPref] = useState(lerPref);
  const soMeuPerfil = !isAdmin && !!role && soMeuPerfilPref;
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const [ativa, setAtiva] = useState<string>("inicio");
  const [pendente, setPendente] = useState<string | null>(null);
  const buscaRef = useRef<HTMLInputElement>(null);

  const setSoMeuPerfil = useCallback((v: boolean) => {
    setSoMeuPerfilPref(v);
    try { localStorage.setItem(PREF_PERFIL, v ? "1" : "0"); } catch { /* modo privado */ }
  }, []);

  const buscando = termosBusca(q).length > 0;
  const opts = useMemo(() => ({ q, role, soMeuPerfil }), [q, role, soMeuPerfil]);

  const secoes = useMemo(() => filtrarSecoes(SECOES_GUIA, opts), [opts]);
  const faq = useMemo(() => filtrarFaq(FAQ_GUIA, opts), [opts]);
  const glossario = useMemo(() => filtrarGlossario(GLOSSARIO_GUIA, q), [q]);
  const mostraFluxo = useMemo(() => filtrarFluxo(FLUXO_VENDA, q), [q]);
  const mostraPerfis = !buscando || termosBusca(q).every(t => "perfis perfil acesso quem ve modulos gerente admin".includes(t));
  const totalPorSecao = useMemo(() => {
    const semBusca = filtrarSecoes(SECOES_GUIA, { q: "", role, soMeuPerfil });
    return new Map(semBusca.map(s => [s.secao.id, s.tarefas.length]));
  }, [role, soMeuPerfil]);

  const inicio = secoes.find(s => s.secao.tipo === "geral");
  const modulos = secoes.filter(s => s.secao.tipo === "modulo");
  const qtdResultados = secoes.reduce((n, s) => n + s.tarefas.length, 0) + faq.length + glossario.length + (buscando && mostraFluxo ? 1 : 0);

  // Busca com poucos resultados: já abre as tarefas encontradas.
  useEffect(() => {
    if (!buscando) return;
    const todas = secoes.flatMap(s => s.tarefas.map(t => ancoraTarefa(s.secao.id, t.id)));
    const faqs = faq.map(p => `faq-${p.id}`);
    if (todas.length + faqs.length <= ABRIR_ATE) setAbertas(new Set([...todas, ...faqs]));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só quando o texto da busca muda
  }, [q]);

  const indice: ItemIndice[] = useMemo(() => {
    const itens: ItemIndice[] = [];
    if (inicio) itens.push({ id: "inicio", titulo: "Primeiros passos", icone: "inicio", qtd: inicio.tarefas.length });
    if (mostraPerfis) itens.push({ id: "perfis", titulo: "Perfis", icone: "perfis" });
    if (mostraFluxo) itens.push({ id: "fluxo", titulo: "Da venda à entrega", icone: "fluxo" });
    for (const m of modulos) itens.push({ id: m.secao.id, titulo: m.secao.titulo, icone: m.secao.icone, qtd: m.tarefas.length });
    if (faq.length) itens.push({ id: "faq", titulo: "Perguntas frequentes", icone: "faq", qtd: faq.length });
    if (glossario.length) itens.push({ id: "glossario", titulo: "Glossário", icone: "glossario", qtd: glossario.length });
    return itens;
  }, [inicio, modulos, faq.length, glossario.length, mostraFluxo, mostraPerfis]);

  // ── Navegação por âncora ───────────────────────────────────────────────────
  const rolarPara = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return false;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  }, []);

  const irPara = useCallback((ancora: string) => {
    if (ancora.includes("-") || ancora.startsWith("faq-")) setAbertas(prev => new Set(prev).add(ancora));
    try { window.history.replaceState(window.history.state, "", `#${ancora}`); } catch { /* ignora */ }
    setPendente(ancora);
  }, []);

  // Depois de renderizar (tarefa aberta), rola até ela. Se estiver escondida
  // pela busca ou pelo filtro de perfil, mostra tudo e tenta de novo.
  useEffect(() => {
    if (!pendente) return;
    const id = window.requestAnimationFrame(() => {
      if (rolarPara(pendente)) { setPendente(null); return; }
      if (q || soMeuPerfil) { setQ(""); setSoMeuPerfilPref(false); return; }
      setPendente(null);
    });
    return () => window.cancelAnimationFrame(id);
  }, [pendente, rolarPara, q, soMeuPerfil]);

  // Link com #âncora (ao abrir a página ou trocar o hash).
  useEffect(() => {
    const h = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (h) irPara(h);
  }, [location.hash, irPara]);

  const toggle = useCallback((ancora: string) => {
    setAbertas(prev => {
      const n = new Set(prev);
      if (n.has(ancora)) n.delete(ancora); else n.add(ancora);
      return n;
    });
  }, []);

  // Índice: destaca a seção visível.
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-secao]"));
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(entries => {
      const vis = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (vis[0]) setAtiva((vis[0].target as HTMLElement).dataset.secao ?? "inicio");
    }, { rootMargin: "-72px 0px -65% 0px" });
    els.forEach(e => obs.observe(e));
    return () => obs.disconnect();
  }, [indice]);

  const limpar = () => { setQ(""); setAbertas(new Set()); buscaRef.current?.focus(); };
  const nadaEncontrado = buscando && qtdResultados === 0 && !mostraPerfis;
  const roleLabel = role ? (ROLE_LABELS[role] ?? role).split(" (")[0] : null;

  return (
    <div className="flex flex-col min-h-full bg-transparent">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border/40">
        <div className="px-3 sm:px-4 h-12 sm:h-14 flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <BookOpen className="h-4 w-4 text-primary shrink-0" />
            <div className="min-w-0">
              <h1 className="text-sm font-semibold leading-tight">Guia de uso</h1>
              <p className="hidden sm:block text-[10px] text-muted-foreground leading-tight truncate">Passo a passo das tarefas do dia a dia, por módulo</p>
            </div>
          </div>
          <Button asChild size="sm" variant="outline" className="h-9 gap-1.5 rounded-xl shrink-0">
            <a href={GUIA_PDF_PATH} download="Guia-de-Uso-Zomini.pdf">
              <Download className="h-4 w-4" /><span>Baixar PDF</span>
            </a>
          </Button>
        </div>
      </header>

      <main className="flex-1">
        <div className="px-3 sm:px-4 py-4 max-w-6xl mx-auto w-full">
          {/* Busca + filtro de perfil */}
          <div className="rounded-2xl border bg-card p-3 sm:p-4 space-y-3">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                ref={buscaRef}
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Buscar: pedido, nota fiscal, lote, senha…"
                className="h-11 pl-9 pr-10 text-base sm:text-sm"
                aria-label="Buscar no guia"
                type="text"
                inputMode="search"
                enterKeyHint="search"
                autoComplete="off"
              />
              {q && (
                <button type="button" onClick={limpar} aria-label="Limpar busca"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 justify-between">
              {isAdmin ? (
                <p className="text-xs text-muted-foreground">Perfil <strong className="text-foreground">Admin</strong>: você vê o guia completo.</p>
              ) : role ? (
                <label className="flex items-center gap-2.5 min-h-[40px] cursor-pointer select-none">
                  <Switch checked={soMeuPerfil} onCheckedChange={setSoMeuPerfil} aria-label="Mostrar só o que meu perfil usa" />
                  <span className="text-sm">Mostrar só o que meu perfil usa <span className="text-muted-foreground">({roleLabel})</span></span>
                </label>
              ) : <span />}
              {!buscando ? (
                <div className="flex gap-1.5 overflow-x-auto scrollbar-none -mx-1 px-1 sm:mx-0 sm:px-0 sm:flex-wrap sm:justify-end">
                  {SUGESTOES.map(s => (
                    <button key={s} type="button" onClick={() => setQ(s)}
                      className="shrink-0 rounded-full border px-2.5 h-8 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors">
                      {s}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  {qtdResultados} resultado{qtdResultados !== 1 ? "s" : ""} para “{q.trim()}”
                  {soMeuPerfil && <> no seu perfil · <button type="button" className="text-primary font-medium hover:underline" onClick={() => setSoMeuPerfil(false)}>buscar em tudo</button></>}
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-6">
            {/* Índice (computador) */}
            <aside className="hidden lg:block">
              <nav aria-label="Índice do guia" className="sticky top-20 max-h-[calc(100dvh-7rem)] overflow-y-auto scrollbar-thin space-y-0.5 pb-4">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 pb-1">Neste guia</p>
                {indice.map(it => (
                  <button key={it.id} type="button" onClick={() => irPara(it.id)}
                    aria-current={ativa === it.id ? "true" : undefined}
                    className={cn(
                      "w-full h-9 px-3 rounded-xl flex items-center gap-2 text-sm text-left transition-colors",
                      ativa === it.id ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                    )}>
                    <span className="truncate flex-1">{it.titulo}</span>
                    {it.qtd != null && <span className="text-[11px] tabular-nums opacity-70">{it.qtd}</span>}
                  </button>
                ))}
              </nav>
            </aside>

            <div className="min-w-0 space-y-4">
              {/* Módulos em cards (celular/tablet) */}
              {!buscando && (
                <nav aria-label="Ir para" className="lg:hidden grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {indice.map(it => (
                    <button key={it.id} type="button" onClick={() => irPara(it.id)}
                      className="rounded-2xl border bg-card p-3 min-h-[68px] flex items-center gap-2.5 text-left hover:bg-muted/40 transition-colors">
                      <IconeSecao icone={it.icone} className="h-8 w-8" />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold leading-tight">{it.titulo}</span>
                        {it.qtd != null && <span className="block text-[11px] text-muted-foreground mt-0.5">{it.qtd} {it.id === "glossario" ? "termos" : it.id === "faq" ? "perguntas" : "tarefas"}</span>}
                      </span>
                    </button>
                  ))}
                </nav>
              )}

              {nadaEncontrado && (
                <div className="rounded-2xl border bg-card py-12 px-4 text-center">
                  <Search className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-40" />
                  <p className="text-sm font-medium">Nada encontrado para “{q.trim()}”</p>
                  <p className="text-xs text-muted-foreground mt-1">Tente outra palavra (ex.: “pedido”, “nota”, “lote”){soMeuPerfil ? " ou busque em todos os perfis" : ""}.</p>
                  <div className="flex flex-wrap justify-center gap-2 mt-4">
                    <Button variant="outline" className="h-10" onClick={limpar}>Limpar busca</Button>
                    {soMeuPerfil && <Button className="h-10" onClick={() => setSoMeuPerfil(false)}>Buscar em tudo</Button>}
                  </div>
                </div>
              )}

              {inicio && (
                <SecaoCard secao={inicio.secao} tarefas={inicio.tarefas} abertas={abertas} onToggle={toggle} role={role}
                  totalTarefas={totalPorSecao.get(inicio.secao.id) ?? inicio.tarefas.length} />
              )}
              {mostraPerfis && <PerfisBloco perfis={PERFIS_GUIA} role={role} />}
              {mostraFluxo && <FluxoVenda etapas={FLUXO_VENDA} role={role} onIr={irPara} />}
              {modulos.map(m => (
                <SecaoCard key={m.secao.id} secao={m.secao} tarefas={m.tarefas} abertas={abertas} onToggle={toggle} role={role}
                  totalTarefas={totalPorSecao.get(m.secao.id) ?? m.tarefas.length} />
              ))}
              {faq.length > 0 && <FaqBloco itens={faq} abertas={abertas} onToggle={toggle} onIr={irPara} />}
              {glossario.length > 0 && <GlossarioBloco termos={glossario} />}

              <p className="text-xs text-muted-foreground text-center py-4">
                Não achou o que procurava? Use <strong className="text-foreground">Reportar problema</strong> no menu (Ajuda) e conte o que precisa.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
