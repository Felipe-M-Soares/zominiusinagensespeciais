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
  ChevronDown, ChevronUp, MapPin, ShieldAlert, Clock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { sanitizeQuery } from "@/lib/sanitize";
import { useDebounce } from "@/hooks/useDebounce";
import { useClickOutside } from "@/hooks/useClickOutside";
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
    fases: fases.filter(f => f.quantity > 0 || f.lotes.length > 0),
    em_retrabalho: fases.some(f => f.fase === "retrabalho" && f.quantity > 0),
    tem_reservas: fases.some(f => f.quantity_reserved > 0),
  };
}

async function searchPecas(query: string): Promise<{ suggestions: Suggestion[]; results: PecaResult[] }> {
  const q = sanitizeQuery(query);
  if (!q || q.length < 2) return { suggestions: [], results: [] };

  // Detecta busca por lote: contém padrão com traço numérico
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
      .in("stock_item_id", itemIds).not("lote", "is", null).order("created_at", { ascending: false }).limit(2000);

    const lotesByItem = buildLoteMap(movData ?? []);
    const results: PecaResult[] = devRows.map(dev => buildResult(dev, stockItems.filter(s => s.device_id === dev.id), lotesByItem));
    return {
      suggestions: devRows.map(d => ({ device_id: d.id, model: d.model, reference: d.reference })),
      results: results.filter(r => r.fases.length > 0),
    };
  }

  // 1. Busca devices que casam com a query
  const { data: devData } = await supabase
    .from("devices")
    .select("id, model, reference, internal_code")
    .or(`model.ilike.%${q}%,reference.ilike.%${q}%,internal_code.ilike.%${q}%`)
    .limit(20);

  if (!devData || devData.length === 0) return { suggestions: [], results: [] };

  const suggestions: Suggestion[] = (devData as { id: string; model: string; reference: string }[]).map(d => ({
    device_id: d.id,
    model: d.model,
    reference: d.reference,
  }));

  // Para até 5 resultados, busca detalhes completos
  const topDevices = (devData as { id: string; model: string; reference: string; internal_code: string | null }[]).slice(0, 5);
  const deviceIds = topDevices.map(d => d.id);

  // 2. Busca todos os stock_items para esses devices
  const { data: stockData } = await supabase
    .from("stock_items")
    .select("id, device_id, quantity, quantity_reserved, location, fase")
    .in("device_id", deviceIds);

  if (!stockData || stockData.length === 0) {
    return { suggestions, results: [] };
  }

  const stockItems = stockData as {
    id: string; device_id: string; quantity: number;
    quantity_reserved: number; location: string | null; fase: StockFase;
  }[];

  const allItemIds = stockItems.map(s => s.id);

  // 3. Busca lotes com saldo (movimentações agrupadas por lote)
  const PAGE_SIZE = 1000;
  const loteMov: { stock_item_id: string; lote: string; type: string; quantity: number; created_at: string }[] = [];
  let page = 0;
  while (true) {
    const { data: movData } = await supabase
      .from("stock_movements")
      .select("stock_item_id, lote, type, quantity, created_at")
      .in("stock_item_id", allItemIds)
      .not("lote", "is", null)
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (!movData || movData.length === 0) break;
    loteMov.push(...(movData as typeof loteMov));
    if (movData.length < PAGE_SIZE) break;
    page++;
  }

  // Agrupa lotes por stock_item_id
  const lotesByItem = new Map<string, Map<string, { saldo: number; last_movement: string }>>();
  for (const m of loteMov) {
    if (!m.lote) continue;
    if (!lotesByItem.has(m.stock_item_id)) lotesByItem.set(m.stock_item_id, new Map());
    const loteMap = lotesByItem.get(m.stock_item_id)!;
    const key = m.lote.toUpperCase();
    const existing = loteMap.get(key);
    const delta = m.type === "entrada" ? m.quantity : -m.quantity;
    loteMap.set(key, {
      saldo: (existing?.saldo ?? 0) + delta,
      last_movement: existing?.last_movement ?? m.created_at,
    });
  }

  // 4. Monta resultados por device
  const results: PecaResult[] = topDevices.map(dev => {
    const devItems = stockItems.filter(s => s.device_id === dev.id);

    const fases: FaseInfo[] = devItems.map(item => {
      const lotesMap = lotesByItem.get(item.id);
      const lotes: LoteInfo[] = lotesMap
        ? Array.from(lotesMap.entries())
          .filter(([, v]) => v.saldo > 0)
          .map(([lote, v]) => ({ lote, saldo: v.saldo, last_movement: v.last_movement }))
          .sort((a, b) => b.saldo - a.saldo)
        : [];

      return {
        fase: item.fase,
        stock_item_id: item.id,
        quantity: item.quantity,
        quantity_reserved: item.quantity_reserved,
        quantity_available: item.quantity - item.quantity_reserved,
        location: item.location,
        lotes,
      };
    });

    const em_retrabalho = fases.some(f => f.fase === "retrabalho" && f.quantity > 0);
    const tem_reservas = fases.some(f => f.quantity_reserved > 0);

    return {
      device_id: dev.id,
      model: dev.model,
      reference: dev.reference,
      internal_code: dev.internal_code,
      fases: fases.filter(f => f.quantity > 0 || f.lotes.length > 0),
      em_retrabalho,
      tem_reservas,
    };
  });

  // Remove peças sem estoque ativo em nenhuma fase
  const activeResults = results.filter(r => r.fases.length > 0);

  return { suggestions, results: activeResults };
}

// ── Sub-componentes ────────────────────────────────────────────────────────────

function LoteRow({ lote }: { lote: LoteInfo }) {
  return (
    <div className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
      <div className="flex items-center gap-2">
        <Tag className="h-3 w-3 text-muted-foreground/60 shrink-0" />
        <span className="text-[12px] font-mono font-medium text-foreground/80">{lote.lote}</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
          <Clock className="h-2.5 w-2.5" />
          {new Date(lote.last_movement).toLocaleDateString("pt-BR")}
        </div>
        <span className="text-[12px] font-bold tabular-nums text-foreground">
          {lote.saldo} un.
        </span>
      </div>
    </div>
  );
}

function FaseCard({ fase }: { fase: FaseInfo }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = FASE_CONFIG[fase.fase];

  return (
    <div className={cn("rounded-xl border overflow-hidden", cfg.border)}>
      <div className={cn("flex items-center justify-between px-3 py-2.5", cfg.bg)}>
        <div className="flex items-center gap-2">
          <cfg.Icon className={cn("h-3.5 w-3.5", cfg.color)} />
          <span className={cn("text-[12px] font-semibold", cfg.color)}>{cfg.label}</span>
          {fase.location && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
              <MapPin className="h-2.5 w-2.5" />
              {fase.location}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className={cn("text-[15px] font-bold tabular-nums leading-none", cfg.color)}>{fase.quantity.toLocaleString("pt-BR")}</p>
            <p className="text-[9px] text-muted-foreground/60 leading-tight">total</p>
          </div>
          {fase.quantity_reserved > 0 && (
            <div className="text-right">
              <p className="text-[13px] font-bold tabular-nums leading-none text-blue-500">{fase.quantity_reserved.toLocaleString("pt-BR")}</p>
              <p className="text-[9px] text-muted-foreground/60 leading-tight">reservado</p>
            </div>
          )}
          {fase.lotes.length > 0 && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground/70 hover:text-foreground transition-colors ml-1"
            >
              <Tag className="h-3 w-3" />
              <span>{fase.lotes.length}</span>
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          )}
        </div>
      </div>

      {expanded && fase.lotes.length > 0 && (
        <div className="p-2 space-y-1 border-t border-border/30 bg-background/50">
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide font-medium px-1 mb-1.5">
            Lotes com saldo
          </p>
          {fase.lotes.map(lote => (
            <LoteRow key={lote.lote} lote={lote} />
          ))}
        </div>
      )}
    </div>
  );
}

function PecaCard({ peca }: { peca: PecaResult }) {
  const totalQty = peca.fases.reduce((s, f) => s + f.quantity, 0);
  const totalLotes = peca.fases.reduce((s, f) => s + f.lotes.length, 0);

  return (
    <div className="rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm">
      {/* Header da peça */}
      <div className="px-4 py-3 border-b border-border/30 bg-muted/10">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[14px] font-semibold truncate">{peca.model}</p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-[11px] text-muted-foreground/70 font-mono">{peca.reference}</span>
              {peca.internal_code && (
                <span className="text-[10px] text-muted-foreground/50 bg-muted/40 px-1.5 py-0.5 rounded">
                  {peca.internal_code}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {peca.em_retrabalho && (
              <span className="flex items-center gap-1 text-[10px] font-medium text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                <Wrench className="h-2.5 w-2.5" />
                Retrabalho
              </span>
            )}
            {peca.tem_reservas && (
              <span className="flex items-center gap-1 text-[10px] font-medium text-blue-500 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full">
                <ShieldAlert className="h-2.5 w-2.5" />
                Reservado
              </span>
            )}
          </div>
        </div>

        {/* Resumo global */}
        <div className="flex items-center gap-3 mt-2">
          <div className="flex items-center gap-1.5">
            <Package className="h-3 w-3 text-muted-foreground/60" />
            <span className="text-[11px] text-muted-foreground/70">
              <span className="font-bold text-foreground">{totalQty.toLocaleString("pt-BR")}</span> un. no total
            </span>
          </div>
          <span className="text-muted-foreground/30">·</span>
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3 w-3 text-muted-foreground/60" />
            <span className="text-[11px] text-muted-foreground/70">
              <span className="font-bold text-foreground">{peca.fases.length}</span>{" "}
              {peca.fases.length === 1 ? "local" : "locais"}
            </span>
          </div>
          {totalLotes > 0 && (
            <>
              <span className="text-muted-foreground/30">·</span>
              <div className="flex items-center gap-1.5">
                <Tag className="h-3 w-3 text-muted-foreground/60" />
                <span className="text-[11px] text-muted-foreground/70">
                  <span className="font-bold text-foreground">{totalLotes}</span>{" "}
                  {totalLotes === 1 ? "lote" : "lotes"}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Fases */}
      <div className="p-3 space-y-2">
        {peca.fases.length === 0 ? (
          <div className="py-4 text-center text-[12px] text-muted-foreground/50">
            Sem estoque ativo para esta peça
          </div>
        ) : (
          peca.fases.map(fase => (
            <FaseCard key={`${fase.fase}-${fase.stock_item_id}`} fase={fase} />
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
          <div className="space-y-3">
            <p className="text-[11px] text-muted-foreground/60 px-0.5">
              {results.length} {results.length === 1 ? "resultado" : "resultados"} para{" "}
              <span className="font-medium text-foreground/70">"{query}"</span>
            </p>
            {results.map(peca => (
              <PecaCard key={peca.device_id} peca={peca} />
            ))}
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
