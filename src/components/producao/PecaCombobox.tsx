/**
 * PecaCombobox — seletor de peça com busca (código ou descrição).
 * Usado no Diário e no Planejamento.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PecaOption { codigo: string; descricao: string; pecas_por_hora: number; origem: "producao" | "componente"; }

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
    const q = busca.trim().toLowerCase();
    const base = q ? pecas.filter(p => p.codigo.toLowerCase().includes(q) || p.descricao.toLowerCase().includes(q)) : pecas;
    return base.slice(0, 80);
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
          <span className="flex-1 truncate text-muted-foreground">{placeholder ?? "Buscar outra peça pelo código ou nome..."}</span>
        )}
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground shrink-0 transition-transform", aberto && "rotate-180")} />
      </button>
      {aberto && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-border bg-popover shadow-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 border-b border-border/60">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <input ref={inputRef} value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="Digite o código ou a descrição..."
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
                <span className="text-muted-foreground truncate">{p.descricao}</span>
                {p.pecas_por_hora > 0 && <span className="ml-auto text-xs text-muted-foreground shrink-0">{p.pecas_por_hora} pç/h</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

