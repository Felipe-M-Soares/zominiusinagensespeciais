/**
 * StockGlobalSearch — Barra de pesquisa global do estoque
 *
 * Permite pesquisar qualquer peça e exibe:
 *  - Em quais fases/locais ela existe (intermediária, expedição, retrabalho)
 *  - Quantidade total e disponível (descontando reservas) em cada fase
 *  - Lotes com saldo > 0 (lote, saldo, última movimentação)
 *  - Indicadores de retrabalho e reservas ativas
 */

import { useState, memo } from "react";
import {
  Search, Package, Truck, Wrench, Tag, AlertCircle,
  MapPin, ShieldAlert,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { sanitizeQuery } from "@/lib/sanitize";
import { useDebounce } from "@/hooks/useDebounce";
import { cn } from "@/lib/utils";
import type { StockFase } from "@/hooks/useStock";
import { SearchInputWithBarcode } from "@/components/SearchInputWithBarcode";

// ── Tipos ──────────────────────────────────────────────────────────────────────

interface LoteInfo {
  lote: string;
  saldo: number;
  last_movement: string;
}

interface FaseInfo {
  fase: StockFase;
  stock_item_id: string;
  quantity: number;
  quantity_reserved: number;
  quantity_available: number;
  location: string | null;
  lotes: LoteInfo[];
}

interface PecaResult {
  device_id: string;
  model: string;
  reference: string;
  internal_code: string | null;
  fases: FaseInfo[];
  em_retrabalho: boolean;
  tem_reservas: boolean;
}

interface Suggestion {
  device_id: string;
  model: string;
  reference: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const FASE_CONFIG: Record<StockFase, { label: string; Icon: React.ElementType; color: string; bg: string; border: string }> = {
  intermediaria: {
    label: "Intermediário",
    Icon: Package,
    color: "text-primary",
    bg: "bg-primary/10",
    border: "border-primary/30",
  },
  expedicao: {
    label: "Expedição",
    Icon: Truck,
    color: "text-green-500",
    bg: "bg-green-500/10",
    border: "border-green-500/30",
  },
  retrabalho: {
    label: "Retrabalho",
    Icon: Wrench,
    color: "text-amber-500",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
  },
};

// ─── Helpers de busca ────────────────────────────────────────────────────────

function buildLoteMap(movData: unknown[]): Map<string, Map<string, { saldo: number; last_movement: string }>> {
  const map = new Map<string, Map<string, { saldo: number; last_movement: string }>>();
  for (const m of movData as { stock_item_id: string; lote: string; type: string; quantity: number; created_at: string }[]) {
    if (!m.lote) continue;
    if (!map.has(m.stock_item_id)) map.set(m.stock_item_id, new Map());
    const lm = map.get(m.stock_item_id)!;
    const key = m.lote.toUpperCase();
    const ex = lm.get(key);
    lm.set(key, { saldo: (ex?.saldo ?? 0) + (m.type === "entrada" ? m.quantity : -m.quantity), last_movement: ex?.last_movement ?? m.created_at });
  }
  return map;
}

function buildResult(
  dev: { id: string; model: string; reference: string; internal_code: string | null },
  devItems: { id: string; device_id: string; quantity: number; quantity_reserved: number; location: string | null; fase: StockFase }[],
  lotesByItem: Map<string, Map<string, { saldo: number; last_movement: string }>>
): PecaResult {
  const fases: FaseInfo[] = devItems.map(item => {
    const lm = lotesByItem.get(item.id);
    const lotes: LoteInfo[] = lm
      ? Array.from(lm.entries()).filter(([, v]) => v.saldo > 0)
        .map(([lote, v]) => ({ lote, saldo: v.saldo, last_movement: v.last_movement })).sort((a, b) => b.saldo - a.saldo)
      : [];
    return { fase: item.fase, stock_item_id: item.id, quantity: item.quantity, quantity_reserved: item.quantity_reserved, quantity_available: item.quantity - item.quantity_reserved, location: item.location, lotes };
  });
  return {
    device_id: dev.id, model: dev.model, reference: dev.reference, internal_code: dev.internal_code,
    fases, // todas as fases — filtragem feita no sort/display
    em_retrabalho: fases.some(f => f.fase === "retrabalho" && f.quantity > 0),
    tem_reservas: fases.some(f => f.quantity_reserved > 0),
  };
}

function totalQty(p: PecaResult): number { return p.fases.reduce((s, f) => s + f.quantity, 0); }

async function searchPecas(query: string): Promise<{ suggestions: Suggestion[]; results: PecaResult[] }> {
  const q = sanitizeQuery(query);
  if (!q || q.length < 2) return { suggestions: [], results: [] };

  // ── Detecta busca por lote ────────────────────────────────────────────────
  const isLoteSearch = /\d{2,6}-\d{0,2}/.test(q);

  if (isLoteSearch) {
    const { data: loteMov } = await supabase.from("stock_movements")
      .select("stock_item_id, lote").ilike("lote", `%${q}%`).limit(200);
    if (!loteMov || loteMov.length === 0) return { suggestions: [], results: [] };
    const itemIds = [...new Set((loteMov as { stock_item_id: string }[]).map(m => m.stock_item_id))];
    const { data: stockFromLote } = await supabase.from("stock_items")
      .select("id, device_id, quantity, quantity_reserved, location, fase").in("id", itemIds);
    if (!stockFromLote || stockFromLote.length === 0) return { suggestions: [], results: [] };
    const devIds = [...new Set((stockFromLote as { device_id: string }[]).map(s => s.device_id))];
    const { data: devFromLote } = await supabase.from("devices")
      .select("id, model, reference, internal_code").in("id", devIds);
    if (!devFromLote) return { suggestions: [], results: [] };
    const devRows = devFromLote as { id: string; model: string; reference: string; internal_code: string | null }[];
    const stockItems = stockFromLote as { id: string; device_id: string; quantity: number; quantity_reserved: number; location: string | null; fase: StockFase }[];
    const { data: movData } = await supabase.from("stock_movements")
      .select("stock_item_id, lote, type, quantity, created_at")
      .in("stock_item_id", itemIds).not("lote", "is", null).limit(2000);
    const lotesByItem = buildLoteMap(movData ?? []);
    const results = devRows
      .map(dev => buildResult(dev, stockItems.filter(s => s.device_id === dev.id), lotesByItem))
      .sort((a, b) => totalQty(b) - totalQty(a));
    return {
      suggestions: devRows.map(d => ({ device_id: d.id, model: d.model, reference: d.reference })),
      results,
    };
  }

  // ── Busca por nome: 2 etapas para garantir que peças com estoque aparecem ─
  // Etapa 1: devices que batem com a busca E têm stock_items com qty > 0
  const { data: stockComQty } = await supabase.from("stock_items")
    .select("id, device_id, quantity, quantity_reserved, location, fase")
    .gt("quantity", 0);

  const devIdsComQty = new Set(
    (stockComQty ?? []).map((s: { device_id: string }) => s.device_id)
  );

  // Busca devices pelo nome (sem limite restrito)
  const { data: devData } = await supabase.from("devices")
    .select("id, model, reference, internal_code")
    .or(`model.ilike.%${q}%,reference.ilike.%${q}%,internal_code.ilike.%${q}%`)
    .limit(200);
  if (!devData || devData.length === 0) return { suggestions: [], results: [] };

  const allDevs = devData as { id: string; model: string; reference: string; internal_code: string | null }[];

  // Ordena: primeiro os que TÊM estoque, depois os sem
  const devsOrdenados = [
    ...allDevs.filter(d => devIdsComQty.has(d.id)),
    ...allDevs.filter(d => !devIdsComQty.has(d.id)),
  ];

  // Busca stock_items para todos os devices encontrados
  const { data: stockData } = await supabase.from("stock_items")
    .select("id, device_id, quantity, quantity_reserved, location, fase")
    .in("device_id", devsOrdenados.map(d => d.id))
    .limit(2000);

  const stockItems = (stockData ?? []) as { id: string; device_id: string; quantity: number; quantity_reserved: number; location: string | null; fase: StockFase }[];

  // Busca movimentos de lote
  const { data: movData } = await supabase.from("stock_movements")
    .select("stock_item_id, lote, type, quantity, created_at")
    .in("stock_item_id", stockItems.map(s => s.id))
    .not("lote", "is", null).limit(3000);
  const lotesByItem = buildLoteMap(movData ?? []);

  const results = devsOrdenados
    .map(dev => buildResult(dev, stockItems.filter(s => s.device_id === dev.id), lotesByItem))
    .sort((a, b) => totalQty(b) - totalQty(a));

  return {
    suggestions: allDevs.map(d => ({ device_id: d.id, model: d.model, reference: d.reference })),
    results,
  };
}


// ── Sub-componentes ────────────────────────────────────────────────────────────

// Linha de lote inline dentro de cada fase
function LoteRow({ lote }: { lote: LoteInfo }) {
  return (
    <div className="flex items-center justify-between py-1 px-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
      <div className="flex items-center gap-1.5">
        <Tag className="h-2.5 w-2.5 text-muted-foreground/50 shrink-0" />
        <span className="text-[11px] font-mono font-medium">{lote.lote}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground/50">
          {new Date(lote.last_movement).toLocaleDateString("pt-BR")}
        </span>
        <span className="text-[11px] font-bold tabular-nums">{lote.saldo} un.</span>
      </div>
    </div>
  );
}

// Linha compacta de fase — lotes ficam inline abaixo se tiver
function FaseRow({ fase }: { fase: FaseInfo }) {
  const cfg = FASE_CONFIG[fase.fase];
  return (
    <div className={cn("rounded-lg border overflow-hidden", cfg.border)}>
      <div className={cn("flex items-center gap-1.5 px-2 py-1.5", cfg.bg)}>
        <cfg.Icon className={cn("h-3 w-3 shrink-0", cfg.color)} />
        <span className={cn("text-[11px] font-semibold shrink-0", cfg.color)}>{cfg.label}</span>
        {fase.location && (
          <span className="text-[10px] text-muted-foreground/50 shrink-0 truncate">· {fase.location}</span>
        )}
        {/* lotes inline */}
        {fase.lotes.length > 0 && (
          <div className="flex-1 flex flex-wrap gap-1 min-w-0 overflow-hidden">
            {fase.lotes.map(l => (
              <span key={l.lote} className="flex items-center gap-0.5 text-[9px] font-mono bg-background/60 border border-border/30 px-1 py-0.5 rounded">
                {l.lote} <span className="text-muted-foreground/60 font-sans">{l.saldo}</span>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1 shrink-0 ml-auto">
          {fase.quantity_reserved > 0 && (
            <span className="text-[10px] font-semibold tabular-nums text-blue-500">{fase.quantity_reserved}r</span>
          )}
          <span className={cn("text-[12px] font-bold tabular-nums", cfg.color)}>{fase.quantity.toLocaleString("pt-BR")}</span>
          <span className="text-[9px] text-muted-foreground/50">un.</span>
        </div>
      </div>
    </div>
  );
}

// Card no mesmo tamanho e estilo dos cards de componentes
function PecaCard({ peca }: { peca: PecaResult }) {
  const totalQty = peca.fases.reduce((s, f) => s + f.quantity, 0);
  return (
    <div className="rounded-xl border border-border/40 bg-card overflow-hidden hover:border-border/70 transition-colors">
      {/* Header compacto */}
      <div className="px-3 py-2.5 flex items-center gap-2 border-b border-border/20 bg-muted/10">
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold truncate leading-tight">{peca.model}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className="text-[10px] text-muted-foreground/60 font-mono">{peca.reference}</span>
            {peca.em_retrabalho && (
              <span className="text-[9px] font-medium text-amber-500 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full">Retrab.</span>
            )}
            {peca.tem_reservas && (
              <span className="text-[9px] font-medium text-blue-500 bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 rounded-full">Reserv.</span>
            )}
          </div>
        </div>
        <span className="text-[13px] font-bold tabular-nums text-foreground shrink-0">{totalQty.toLocaleString("pt-BR")}<span className="text-[9px] font-normal text-muted-foreground/60 ml-0.5">un.</span></span>
      </div>
      {/* Fases compactas */}
      <div className="px-2 py-1.5 space-y-1">
        {peca.fases.length === 0 ? (
          <p className="text-[10px] text-muted-foreground/40 text-center py-1.5">Sem estoque ativo</p>
        ) : (
          peca.fases.map(fase => (
            <FaseRow key={`${fase.fase}-${fase.stock_item_id}`} fase={fase} />
          ))
        )}
      </div>
    </div>
  );
}

// ── Componente principal ───────────────────────────────────────────────────────

interface StockGlobalSearchProps {
  className?: string;
}

export const StockGlobalSearch = memo(function StockGlobalSearch({ className }: StockGlobalSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PecaResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Busca automática com debounce — sem botão nem dropdown de sugestões
  const debouncedSearch = useDebounce(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || trimmed.length < 2) { setResults([]); setSearched(false); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const { results: res } = await searchPecas(trimmed);
      setResults(res); setSearched(true);
    } catch { setError("Erro ao pesquisar. Tente novamente."); }
    finally { setLoading(false); }
  }, 400);

  function handleChange(v: string) {
    setQuery(v);
    if (!v.trim()) { setResults([]); setSearched(false); setError(null); return; }
    setLoading(true);
    debouncedSearch(v);
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="relative">
        <SearchInputWithBarcode
          value={query}
          onChange={v => handleChange(v)}
          onSearch={v => { setQuery(v); debouncedSearch(v); }}
          placeholder="Modelo, referência, lote (ex: 010125-01) ou código..."
          height="h-10 sm:h-11"
        />
        {loading && (
          <div className="absolute right-10 top-1/2 -translate-y-1/2">
            <span className="h-3.5 w-3.5 rounded-full border-2 border-primary/30 border-t-primary animate-spin block" />
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
          <p className="text-[13px] text-destructive">{error}</p>
        </div>
      )}

      {searched && !loading && !error && (
        results.length === 0 ? (
          <div className="rounded-2xl border border-border/30 bg-muted/10 py-10 text-center">
            <Package className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-[13px] text-muted-foreground/60">
              Nenhuma peça encontrada para <span className="font-medium text-foreground/60">"{query}"</span>
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-[10px] text-muted-foreground/50 px-0.5">
              {results.length} {results.length === 1 ? "resultado" : "resultados"} para{" "}
              <span className="font-medium text-foreground/60">"{query}"</span>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {results.map(peca => (
                <PecaCard key={peca.device_id} peca={peca} />
              ))}
            </div>
          </div>
        )
      )}

      {!searched && !loading && !query && (
        <p className="text-[11px] text-muted-foreground/50 text-center py-1">
          Digite o nome, referência, lote ou código da peça
        </p>
      )}
    </div>
  );
});
