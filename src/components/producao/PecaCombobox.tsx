/**
 * PecaCombobox — seletor de peça com busca (código ou descrição).
 * Usado no Diário e no Planejamento.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

export interface PecaOption { codigo: string; descricao: string; pecas_por_hora: number; origem: "producao" | "componente"; referencia?: string | null; }

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Carrega as peças para os seletores da Produção: cadastro de produção +
 * TODOS os componentes cadastrados em "Componentes" (devices), buscáveis por
 * código interno, nome (modelo) ou referência. Pagina além do limite de 1000
 * linhas da API.
 */
export async function carregarPecasProducao(): Promise<PecaOption[]> {
  const [prodRes, devs] = await Promise.all([
    supabase.from("produtos_producao").select("codigo,descricao,pecas_por_hora").eq("ativo", true).order("codigo"),
    (async () => {
      const out: { internal_code: string | null; model: string | null; reference: string | null }[] = [];
      for (let de = 0; de < 20000; de += 1000) {
        const { data, error } = await supabase.from("devices").select("internal_code,model,reference")
          .eq("ativo", true).order("model").range(de, de + 999);
        if (error || !data?.length) break;
        out.push(...data);
        if (data.length < 1000) break;
      }
      return out;
    })(),
  ]);
  const porCodigo = new Map<string, PecaOption>();
  for (const p of prodRes.data ?? []) {
    porCodigo.set(p.codigo, { codigo: p.codigo, descricao: p.descricao, pecas_por_hora: p.pecas_por_hora ?? 0, origem: "producao" });
  }
  for (const d of devs) {
    const codigo = (d.internal_code || d.reference || "").trim();
    if (!codigo) continue;
    const existente = porCodigo.get(codigo);
    if (existente) { existente.referencia ??= d.reference; continue; }
    porCodigo.set(codigo, { codigo, descricao: (d.model ?? "").trim() || codigo, pecas_por_hora: 0, origem: "componente",
      referencia: d.reference && d.reference !== codigo ? d.reference : null });
  }
  return [...porCodigo.values()].sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true }));
}

/** Seletor de peça com busca (para quando a peça não está nos atalhos). */
export function PecaCombobox({ pecas, value, onChange, placeholder }: {
  pecas: PecaOption[]; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca]   = useState("");
  const boxRef   = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selecionada = pecas.find(p => p.codigo === value);

  const filtradas = useMemo(() => {
    const termos = norm(busca.trim()).split(/\s+/).filter(Boolean);
    const base = termos.length
      ? pecas.filter(p => { const alvo = norm(`${p.codigo} ${p.descricao} ${p.referencia ?? ""}`); return termos.every(t => alvo.includes(t)); })
      : pecas;
    return base.slice(0, 100);
  }, [busca, pecas]);

  useEffect(() => {
    if (!aberto) return;
    inputRef.current?.focus();
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [aberto]);

  const escolher = (codigo: string) => { onChange(codigo); setAberto(false); setBusca(""); };

  return (
    <div ref={boxRef} className="relative">
      <button type="button" onClick={() => setAberto(a => !a)}
        className="w-full h-12 rounded-xl border border-input bg-background px-3.5 text-left text-sm flex items-center gap-2 hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring">
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        {selecionada ? (
          <span className="flex-1 truncate"><span className="font-semibold">{selecionada.codigo}</span>
            <span className="text-muted-foreground"> — {selecionada.descricao}</span></span>
        ) : (
          <span className="flex-1 truncate text-muted-foreground">{placeholder ?? "Buscar peça por nome, código ou referência..."}</span>
        )}
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground shrink-0 transition-transform", aberto && "rotate-180")} />
      </button>
      {aberto && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-border bg-popover shadow-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 border-b border-border/60">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <input ref={inputRef} value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="Nome, código ou referência..."
              className="w-full h-11 bg-transparent text-sm focus:outline-none" />
          </div>
          <div className="max-h-72 overflow-y-auto overscroll-contain py-1">
            {filtradas.length === 0 && (
              <p className="px-3 py-4 text-sm text-muted-foreground text-center">Nenhuma peça encontrada para "{busca}"</p>
            )}
            {filtradas.map(p => (
              <button key={p.codigo} type="button" onClick={() => escolher(p.codigo)}
                className={cn("w-full text-left px-3 py-2.5 text-sm hover:bg-muted flex items-center gap-2", p.codigo === value && "bg-primary/10")}>
                <span className="font-semibold shrink-0">{p.codigo}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-muted-foreground truncate">{p.descricao}</span>
                  {p.referencia && <span className="block text-[11px] text-muted-foreground/80 truncate">Ref. {p.referencia}</span>}
                </span>
                {p.pecas_por_hora > 0 && <span className="ml-auto text-xs text-muted-foreground shrink-0">{p.pecas_por_hora} pç/h</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

