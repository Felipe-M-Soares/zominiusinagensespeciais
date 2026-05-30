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
    <div className={cn("rounded-xl border overflow-hidden", cfg.border)}>
      <div className={cn("flex items-center gap-2 px-3 py-2", cfg.bg)}>
        <cfg.Icon className={cn("h-3.5 w-3.5 shrink-0", cfg.color)} />
        <span className={cn("text-[12px] font-semibold shrink-0", cfg.color)}>{cfg.label}</span>
        {fase.location && (
          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/60 shrink-0">
            <MapPin className="h-2.5 w-2.5" />{fase.location}
          </span>
        )}
        <div className="flex-1" />
        {fase.quantity_reserved > 0 && (
          <span className="text-[11px] font-semibold tabular-nums text-blue-500 shrink-0">
            {fase.quantity_reserved} res.
          </span>
        )}
        <span className={cn("text-[14px] font-bold tabular-nums shrink-0", cfg.color)}>
          {fase.quantity.toLocaleString("pt-BR")}
        </span>
        <span className="text-[10px] text-muted-foreground/60">un.</span>
      </div>
      {fase.lotes.length > 0 && (
        <div className="px-2 pb-2 pt-1 space-y-1 border-t border-border/20 bg-background/40">
          {fase.lotes.map(l => <LoteRow key={l.lote} lote={l} />)}
        </div>
      )}
    </div>
  );
}

// Card no mesmo tamanho e estilo dos cards de componentes
function PecaCard({ peca }: { peca: PecaResult }) {
  const totalQty = peca.fases.reduce((s, f) => s + f.quantity, 0);
  const totalLotes = peca.fases.reduce((s, f) => s + f.lotes.length, 0);

  return (
    <div
      className="group relative rounded-2xl bg-card overflow-hidden transition-all duration-300 hover:-translate-y-0.5"
      style={{
        boxShadow:
          "0 1px 2px hsl(var(--border) / 0.3), 0 4px 12px -2px hsl(var(--border) / 0.15), inset 0 1px 0 hsl(0 0% 100% / 0.06)",
      }}
    >
      {/* Accent bar igual ao DeviceCard */}
      <div className="h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent opacity-50 group-hover:opacity-100 transition-opacity" />

      <div className="p-4 space-y-3">
        {/* Header: nome + referência + badges */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <h3 className="text-[13px] font-semibold leading-snug text-foreground line-clamp-2">
              {peca.model}
            </h3>
            <p className="text-[11px] text-muted-foreground font-mono tracking-tight">{peca.reference}</p>
            {peca.internal_code && (
              <p className="text-[10px] text-muted-foreground/50">{peca.internal_code}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {peca.em_retrabalho && (
              <span className="flex items-center gap-1 text-[10px] font-medium text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                <Wrench className="h-2.5 w-2.5" />Retrabalho
              </span>
            )}
            {peca.tem_reservas && (
              <span className="flex items-center gap-1 text-[10px] font-medium text-blue-500 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full">
                <ShieldAlert className="h-2.5 w-2.5" />Reservado
              </span>
            )}
          </div>
        </div>

        {/* Resumo: total + locais + lotes */}
        <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground/70">
          <span className="flex items-center gap-1">
            <Package className="h-3 w-3 text-muted-foreground/50" />
            <span className="font-bold text-foreground">{totalQty.toLocaleString("pt-BR")}</span> un.
          </span>
          <span className="text-muted-foreground/30">·</span>
          <span className="flex items-center gap-1">
            <MapPin className="h-3 w-3 text-muted-foreground/50" />
            <span className="font-bold text-foreground">{peca.fases.length}</span>
            {peca.fases.length === 1 ? " local" : " locais"}
          </span>
          {totalLotes > 0 && (
            <>
              <span className="text-muted-foreground/30">·</span>
              <span className="flex items-center gap-1">
                <Tag className="h-3 w-3 text-muted-foreground/50" />
                <span className="font-bold text-foreground">{totalLotes}</span>
                {totalLotes === 1 ? " lote" : " lotes"}
              </span>
            </>
          )}
        </div>

        {/* Fases — separador + linhas compactas */}
        <div className="border-t border-border/20 pt-3 space-y-1.5">
          {peca.fases.length === 0 ? (
            <p className="text-[11px] text-muted-foreground/40 text-center py-2">
              Sem estoque ativo
            </p>
          ) : (
            peca.fases.map(fase => (
              <FaseRow key={`${fase.fase}-${fase.stock_item_id}`} fase={fase} />
            ))
          )}
        </div>
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
