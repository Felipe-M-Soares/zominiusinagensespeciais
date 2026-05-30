/**
 * Qualidade — Rastreabilidade, Registro ANVISA e GTIN
 *
 * Abas:
 *  • Rastreamento  — busca de peças (igual ao StockGlobalSearch, mas com foco em qualidade)
 *  • Registro ANVISA — formulário de registro/consulta na ANVISA
 *  • GTIN          — gerador e consulta de códigos GTIN-13/GTIN-14
 *  • Histórico     — movimentações do estoque para controle de qualidade
 */

import { useState, useEffect, useCallback, useRef, memo } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  ShieldCheck, Search, Tag, History, ClipboardList,
  Package, Truck, Wrench, MapPin, Clock, ChevronDown, ChevronUp,
  ShieldAlert, AlertCircle, CheckCircle2, Copy, RefreshCw,
  ArrowDownCircle, ArrowUpCircle, ExternalLink, FileText,
  Hash, Barcode, Globe, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { sanitizeQuery } from "@/lib/sanitize";
import { useDebounce } from "@/hooks/useDebounce";
import { useClickOutside } from "@/hooks/useClickOutside";
import { SearchInputWithBarcode } from "@/components/SearchInputWithBarcode";
import { PageNav } from "@/components/PageNav";
import type { PageNavTab } from "@/components/PageNav";
import type { StockFase, AllMovement } from "@/hooks/useStock";
import { fetchAllMovements } from "@/hooks/useStock";
import { toast } from "sonner";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type QualidadeView = "rastreamento" | "anvisa" | "gtin" | "historico";

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
  udi_di: string | null;
  anvisa_registration: string | null;
  classification_code: string | null;
  fases: FaseInfo[];
  em_retrabalho: boolean;
  tem_reservas: boolean;
}

interface Suggestion {
  device_id: string;
  model: string;
  reference: string;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const FASE_CONFIG: Record<StockFase, {
  label: string; Icon: React.ElementType;
  color: string; bg: string; border: string;
}> = {
  intermediaria: { label: "Intermediário", Icon: Package, color: "text-violet-500", bg: "bg-violet-500/10", border: "border-violet-500/30" },
  expedicao:     { label: "Expedição",     Icon: Truck,   color: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
  retrabalho:    { label: "Retrabalho",    Icon: Wrench,  color: "text-amber-500",   bg: "bg-amber-500/10",   border: "border-amber-500/30"   },
};

const TABS: PageNavTab<QualidadeView>[] = [
  { id: "rastreamento", label: "Rastreamento", Icon: Search,       activeColor: "text-violet-500",  activeBg: "bg-violet-500/10",  activeBorder: "border-violet-500/40" },
  { id: "anvisa",       label: "ANVISA",       Icon: ShieldCheck,  activeColor: "text-blue-500",    activeBg: "bg-blue-500/10",    activeBorder: "border-blue-500/40"   },
  { id: "gtin",         label: "GTIN",         Icon: Barcode,      activeColor: "text-emerald-500", activeBg: "bg-emerald-500/10", activeBorder: "border-emerald-500/40"},
  { id: "historico",    label: "Histórico",    Icon: History,      activeColor: "text-amber-500",   activeBg: "bg-amber-500/10",   activeBorder: "border-amber-500/40"  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

async function searchPecasQualidade(query: string): Promise<{ suggestions: Suggestion[]; results: PecaResult[] }> {
  const q = sanitizeQuery(query);
  if (!q || q.length < 2) return { suggestions: [], results: [] };

  const { data: devData } = await supabase
    .from("devices")
    .select("id, model, reference, internal_code, udi_di, anvisa_registration, classification_code")
    .or(`model.ilike.%${q}%,reference.ilike.%${q}%,internal_code.ilike.%${q}%,udi_di.ilike.%${q}%,anvisa_registration.ilike.%${q}%`)
    .limit(20);

  if (!devData || devData.length === 0) return { suggestions: [], results: [] };

  type DevRow = { id: string; model: string; reference: string; internal_code: string | null; udi_di: string | null; anvisa_registration: string | null; classification_code: string | null };
  const devRows = devData as DevRow[];

  const suggestions: Suggestion[] = devRows.map(d => ({ device_id: d.id, model: d.model, reference: d.reference }));
  const topDevices = devRows.slice(0, 5);
  const deviceIds = topDevices.map(d => d.id);

  const { data: stockData } = await supabase
    .from("stock_items")
    .select("id, device_id, quantity, quantity_reserved, location, fase")
    .in("device_id", deviceIds);

  if (!stockData || stockData.length === 0) return { suggestions, results: [] };

  type StockRow = { id: string; device_id: string; quantity: number; quantity_reserved: number; location: string | null; fase: StockFase };
  const stockItems = stockData as StockRow[];
  const allItemIds = stockItems.map(s => s.id);

  const { data: movData } = await supabase
    .from("stock_movements")
    .select("stock_item_id, lote, type, quantity, created_at")
    .in("stock_item_id", allItemIds)
    .not("lote", "is", null)
    .order("created_at", { ascending: false })
    .limit(2000);

  const lotesByItem = new Map<string, Map<string, { saldo: number; last_movement: string }>>();
  for (const m of (movData ?? []) as { stock_item_id: string; lote: string; type: string; quantity: number; created_at: string }[]) {
    if (!m.lote) continue;
    if (!lotesByItem.has(m.stock_item_id)) lotesByItem.set(m.stock_item_id, new Map());
    const lm = lotesByItem.get(m.stock_item_id)!;
    const key = m.lote.toUpperCase();
    const ex = lm.get(key);
    lm.set(key, {
      saldo: (ex?.saldo ?? 0) + (m.type === "entrada" ? m.quantity : -m.quantity),
      last_movement: ex?.last_movement ?? m.created_at,
    });
  }

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
      return { fase: item.fase, stock_item_id: item.id, quantity: item.quantity, quantity_reserved: item.quantity_reserved, quantity_available: item.quantity - item.quantity_reserved, location: item.location, lotes };
    });
    return {
      device_id: dev.id, model: dev.model, reference: dev.reference,
      internal_code: dev.internal_code, udi_di: dev.udi_di,
      anvisa_registration: dev.anvisa_registration,
      classification_code: dev.classification_code,
      fases: fases.filter(f => f.quantity > 0 || f.lotes.length > 0),
      em_retrabalho: fases.some(f => f.fase === "retrabalho" && f.quantity > 0),
      tem_reservas: fases.some(f => f.quantity_reserved > 0),
    };
  });

  return { suggestions, results: results.filter(r => r.fases.length > 0) };
}

// ─── Sub-componentes de Rastreamento ─────────────────────────────────────────

function LoteRow({ lote }: { lote: LoteInfo }) {
  return (
    <div className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
      <div className="flex items-center gap-2">
        <Tag className="h-3 w-3 text-muted-foreground/60 shrink-0" />
        <span className="text-[12px] font-mono font-medium">{lote.lote}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
          <Clock className="h-2.5 w-2.5" />{fmtDate(lote.last_movement)}
        </span>
        <span className="text-[12px] font-bold tabular-nums">{lote.saldo} un.</span>
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
              <MapPin className="h-2.5 w-2.5" />{fase.location}
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
              <p className="text-[13px] font-bold tabular-nums leading-none text-blue-500">{fase.quantity_reserved}</p>
              <p className="text-[9px] text-muted-foreground/60 leading-tight">reservado</p>
            </div>
          )}
          {fase.lotes.length > 0 && (
            <button onClick={() => setExpanded(v => !v)} className="flex items-center gap-1 text-[10px] text-muted-foreground/70 hover:text-foreground transition-colors ml-1">
              <Tag className="h-3 w-3" /><span>{fase.lotes.length}</span>
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          )}
        </div>
      </div>
      {expanded && fase.lotes.length > 0 && (
        <div className="p-2 space-y-1 border-t border-border/30 bg-background/50">
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide font-medium px-1 mb-1.5">Lotes com saldo</p>
          {fase.lotes.map(lote => <LoteRow key={lote.lote} lote={lote} />)}
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
      <div className="px-4 py-3 border-b border-border/30 bg-muted/10">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[14px] font-semibold truncate">{peca.model}</p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-[11px] text-muted-foreground/70 font-mono">{peca.reference}</span>
              {peca.internal_code && (
                <span className="text-[10px] text-muted-foreground/50 bg-muted/40 px-1.5 py-0.5 rounded">{peca.internal_code}</span>
              )}
            </div>
            {/* Dados regulatórios */}
            <div className="flex flex-wrap gap-2 mt-2">
              {peca.udi_di && (
                <span className="flex items-center gap-1 text-[10px] bg-violet-500/8 text-violet-600 border border-violet-500/20 px-2 py-0.5 rounded-full font-mono">
                  <Hash className="h-2.5 w-2.5" />UDI-DI: {peca.udi_di}
                </span>
              )}
              {peca.anvisa_registration && (
                <span className="flex items-center gap-1 text-[10px] bg-blue-500/8 text-blue-600 border border-blue-500/20 px-2 py-0.5 rounded-full">
                  <ShieldCheck className="h-2.5 w-2.5" />ANVISA: {peca.anvisa_registration}
                </span>
              )}
              {peca.classification_code && (
                <span className="flex items-center gap-1 text-[10px] bg-emerald-500/8 text-emerald-600 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                  <ClipboardList className="h-2.5 w-2.5" />Classe: {peca.classification_code}
                </span>
              )}
            </div>
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
        <div className="flex items-center gap-3 mt-2">
          <span className="text-[11px] text-muted-foreground/70">
            <span className="font-bold text-foreground">{totalQty.toLocaleString("pt-BR")}</span> un. · {" "}
            <span className="font-bold text-foreground">{peca.fases.length}</span> {peca.fases.length === 1 ? "local" : "locais"}
            {totalLotes > 0 && <> · <span className="font-bold text-foreground">{totalLotes}</span> lotes</>}
          </span>
        </div>
      </div>
      <div className="p-3 space-y-2">
        {peca.fases.map(fase => <FaseCard key={`${fase.fase}-${fase.stock_item_id}`} fase={fase} />)}
      </div>
    </div>
  );
}

// ─── Aba: Rastreamento ────────────────────────────────────────────────────────

const RastreamentoPanel = memo(function RastreamentoPanel() {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [results, setResults] = useState<PecaResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useClickOutside(containerRef, () => setShowSuggestions(false));

  const doSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || trimmed.length < 2) { setResults([]); setSearched(false); return; }
    setLoading(true); setError(null);
    try {
      const { suggestions: sugs, results: res } = await searchPecasQualidade(trimmed);
      setSuggestions(sugs); setResults(res); setSearched(true);
    } catch { setError("Erro ao pesquisar. Tente novamente."); }
    finally { setLoading(false); }
  }, []);

  const debouncedSug = useDebounce(async (q: string) => {
    if (!q.trim() || q.trim().length < 2) { setSuggestions([]); setShowSuggestions(false); return; }
    const { data } = await supabase.from("devices").select("id, model, reference")
      .or(`model.ilike.%${sanitizeQuery(q)}%,reference.ilike.%${sanitizeQuery(q)}%`).limit(6);
    setSuggestions((data ?? []) as Suggestion[]);
    setShowSuggestions(true);
  }, 300);

  function handleChange(v: string) {
    setQuery(v);
    if (!v.trim()) { setSuggestions([]); setResults([]); setSearched(false); setShowSuggestions(false); return; }
    debouncedSug(v);
  }

  function handleSelectSuggestion(s: Suggestion) {
    setQuery(s.model);
    setShowSuggestions(false);
    doSearch(s.model);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
          <Search className="h-4 w-4 text-violet-500" />
          <p className="text-sm font-semibold">Rastreamento de Peças</p>
          <span className="text-[10px] text-muted-foreground/50 ml-auto">Localização · Lotes · Reservas · Dados ANVISA</span>
        </div>
        <div className="p-4 space-y-3">
          <div className="relative" ref={containerRef}>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <SearchInputWithBarcode
                  value={query}
                  onChange={v => handleChange(v)}
                  onSearch={v => { handleChange(v); setTimeout(() => doSearch(v), 50); }}
                  placeholder="Bipe o código ou pesquise por modelo, referência, UDI-DI, ANVISA..."
                  height="h-10"
                />
              </div>
              <button type="button" onClick={() => doSearch(query)} disabled={!query.trim() || loading}
                className="h-10 px-4 rounded-xl bg-violet-600 text-white text-sm font-medium transition-all hover:bg-violet-500 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed shrink-0">
                {loading
                  ? <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />Buscando</span>
                  : "Buscar"
                }
              </button>
            </div>
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute top-full mt-1.5 left-0 right-0 z-50 rounded-xl border border-border bg-card shadow-xl overflow-hidden">
                {suggestions.map(s => (
                  <button key={s.device_id} type="button"
                    onMouseDown={e => { e.preventDefault(); handleSelectSuggestion(s); }}
                    className="w-full text-left px-4 py-2.5 hover:bg-muted/60 transition-colors border-b border-border/30 last:border-0 flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium truncate">{s.model}</span>
                    <span className="text-[11px] text-muted-foreground/60 font-mono shrink-0">{s.reference}</span>
                  </button>
                ))}
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
                <p className="text-[13px] text-muted-foreground/60">Nenhuma peça encontrada para <span className="font-medium text-foreground/60">"{query}"</span></p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-[11px] text-muted-foreground/60 px-0.5">
                  {results.length} {results.length === 1 ? "resultado" : "resultados"} para{" "}
                  <span className="font-medium text-foreground/70">"{query}"</span>
                </p>
                {results.map(peca => <PecaCard key={peca.device_id} peca={peca} />)}
              </div>
            )
          )}

          {!searched && !loading && (
            <p className="text-[11px] text-muted-foreground/50 text-center py-2">
              Pesquise por modelo, referência, UDI-DI ou número de registro ANVISA
            </p>
          )}
        </div>
      </div>
    </div>
  );
});

// ─── Aba: Registro ANVISA ─────────────────────────────────────────────────────

interface AnvisaDevice {
  id: string;
  model: string;
  reference: string;
  udi_di: string | null;
  anvisa_registration: string | null;
  classification_code: string | null;
  risk_class: string | null;
  brand_name: string | null;
  manufacturer_country: string | null;
  sterile: boolean;
  single_use: boolean;
  implantable: boolean;
}

const AnvisaPanel = memo(function AnvisaPanel() {
  const { isAdmin } = useAuth();
  const [devices, setDevices] = useState<AnvisaDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<AnvisaDevice>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadDevices();
  }, []);

  async function loadDevices() {
    setLoading(true);
    const { data } = await supabase
      .from("devices")
      .select("id, model, reference, udi_di, anvisa_registration, classification_code, risk_class, brand_name, manufacturer_country, sterile, single_use, implantable")
      .order("model");
    setDevices((data ?? []) as AnvisaDevice[]);
    setLoading(false);
  }

  const filtered = devices.filter(d => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      d.model.toLowerCase().includes(q) ||
      (d.reference ?? "").toLowerCase().includes(q) ||
      (d.anvisa_registration ?? "").toLowerCase().includes(q) ||
      (d.udi_di ?? "").toLowerCase().includes(q)
    );
  });

  function startEdit(d: AnvisaDevice) {
    setEditingId(d.id);
    setEditData({ udi_di: d.udi_di ?? "", anvisa_registration: d.anvisa_registration ?? "", classification_code: d.classification_code ?? "", risk_class: d.risk_class ?? "" });
  }

  async function saveEdit() {
    if (!editingId) return;
    setSaving(true);
    const { error } = await supabase.from("devices").update({
      udi_di: editData.udi_di || null,
      anvisa_registration: editData.anvisa_registration || null,
      classification_code: editData.classification_code || null,
      risk_class: editData.risk_class || null,
    }).eq("id", editingId);
    setSaving(false);
    if (error) { toast.error("Erro ao salvar."); return; }
    toast.success("Dados ANVISA atualizados!");
    setEditingId(null);
    loadDevices();
  }

  // Contagens de completude
  const totalComAnvisa = devices.filter(d => d.anvisa_registration).length;
  const totalComUDI    = devices.filter(d => d.udi_di).length;
  const totalSemDados  = devices.filter(d => !d.anvisa_registration && !d.udi_di).length;

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Registrados ANVISA", value: totalComAnvisa, color: "text-emerald-500", bg: "bg-emerald-500/8", border: "border-emerald-500/20", Icon: ShieldCheck },
          { label: "Com UDI-DI",         value: totalComUDI,    color: "text-blue-500",    bg: "bg-blue-500/8",    border: "border-blue-500/20",    Icon: Hash },
          { label: "Sem dados regulat.", value: totalSemDados,  color: "text-amber-500",   bg: "bg-amber-500/8",   border: "border-amber-500/20",   Icon: AlertCircle },
        ].map(kpi => (
          <div key={kpi.label} className={cn("rounded-2xl border p-3 flex items-center gap-3", kpi.bg, kpi.border)}>
            <div className={cn("h-8 w-8 rounded-xl flex items-center justify-center shrink-0", kpi.bg)}>
              <kpi.Icon className={cn("h-4 w-4", kpi.color)} />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide leading-tight">{kpi.label}</p>
              <p className={cn("text-xl font-bold tabular-nums", kpi.color)}>{kpi.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabela */}
      <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border/30 flex items-center gap-3">
          <ShieldCheck className="h-4 w-4 text-blue-500" />
          <p className="text-sm font-semibold">Registro e Dados Regulatórios</p>
          <div className="ml-auto w-52">
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Filtrar peças..."
              className="w-full h-8 rounded-lg border border-border/50 bg-background px-3 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>
          {isAdmin && (
            <button onClick={loadDevices} className="h-8 w-8 rounded-lg border border-border/40 flex items-center justify-center hover:bg-muted/40 transition-colors text-muted-foreground">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {loading ? (
          <div className="p-4 space-y-2">
            {[...Array(5)].map((_, i) => <div key={i} className="h-12 rounded-xl bg-muted/30 animate-pulse" />)}
          </div>
        ) : (
          <div className="divide-y divide-border/20">
            {filtered.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground/60">Nenhuma peça encontrada</div>
            ) : filtered.map(d => (
              <div key={d.id} className="px-4 py-3 hover:bg-muted/10 transition-colors">
                {editingId === d.id ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[13px] font-semibold">{d.model}</p>
                      <div className="flex gap-2">
                        <button onClick={() => setEditingId(null)} className="h-7 px-3 rounded-lg border border-border text-[11px] hover:bg-muted/40 transition-colors">Cancelar</button>
                        <button onClick={saveEdit} disabled={saving} className="h-7 px-3 rounded-lg bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-500 transition-colors disabled:opacity-50">
                          {saving ? "Salvando..." : "Salvar"}
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { key: "udi_di",              label: "UDI-DI" },
                        { key: "anvisa_registration", label: "Registro ANVISA" },
                        { key: "classification_code", label: "Código de Classe" },
                        { key: "risk_class",          label: "Classe de Risco" },
                      ].map(field => (
                        <div key={field.key}>
                          <label className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">{field.label}</label>
                          <input
                            value={(editData as Record<string, string>)[field.key] ?? ""}
                            onChange={e => setEditData(prev => ({ ...prev, [field.key]: e.target.value }))}
                            className="w-full h-8 rounded-lg border border-border/50 bg-background px-2.5 text-[12px] mt-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium truncate">{d.model}</p>
                      <p className="text-[10px] text-muted-foreground/60 font-mono">{d.reference}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      {d.anvisa_registration ? (
                        <span className="flex items-center gap-1 text-[10px] bg-emerald-500/8 text-emerald-600 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                          <CheckCircle2 className="h-2.5 w-2.5" />{d.anvisa_registration}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/40 bg-muted/30 px-2 py-0.5 rounded-full border border-border/30">Sem registro</span>
                      )}
                      {d.udi_di && (
                        <span className="flex items-center gap-1 text-[10px] bg-blue-500/8 text-blue-600 border border-blue-500/20 px-2 py-0.5 rounded-full font-mono">
                          <Hash className="h-2.5 w-2.5" />{d.udi_di}
                        </span>
                      )}
                      {d.classification_code && (
                        <span className="text-[10px] text-violet-600 bg-violet-500/8 border border-violet-500/20 px-2 py-0.5 rounded-full">{d.classification_code}</span>
                      )}
                    </div>
                    {isAdmin && (
                      <button onClick={() => startEdit(d)}
                        className="h-7 px-3 rounded-lg border border-border/40 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors shrink-0 ml-2">
                        Editar
                      </button>
                    )}
                    {d.anvisa_registration && (
                      <a href={`https://consultas.anvisa.gov.br/#/produtos/${d.anvisa_registration}`}
                        target="_blank" rel="noopener noreferrer"
                        className="h-7 w-7 rounded-lg border border-border/40 flex items-center justify-center text-muted-foreground hover:text-blue-500 hover:border-blue-500/40 transition-colors shrink-0"
                        title="Consultar no portal ANVISA">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

// ─── Aba: GTIN ────────────────────────────────────────────────────────────────

function calcGTIN13Digit(digits12: string): string {
  const d = digits12.split("").map(Number);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += d[i] * (i % 2 === 0 ? 1 : 3);
  const check = (10 - (sum % 10)) % 10;
  return String(check);
}

function formatGTIN(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 14);
  if (d.length <= 8)  return d;
  if (d.length <= 12) return d.replace(/(\d{1})(\d{5})(\d+)/, "$1 $2 $3");
  if (d.length === 13) return d.replace(/(\d{1})(\d{6})(\d{5})(\d{1})/, "$1 $2 $3 $4");
  return d.replace(/(\d{1})(\d{6})(\d{6})(\d{1})/, "$1 $2 $3 $4");
}

const GtinPanel = memo(function GtinPanel() {
  const { isAdmin } = useAuth();
  const [prefix, setPrefix]   = useState("789");
  const [company, setCompany] = useState("");
  const [product, setProduct] = useState("");
  const [generated, setGenerated] = useState<string | null>(null);
  const [manualGtin, setManualGtin] = useState("");
  const [validateResult, setValidateResult] = useState<{ valid: boolean; message: string } | null>(null);

  // Dispositivos com UDI-DI para mostrar GTIN gerado
  const [devices, setDevices] = useState<{ id: string; model: string; udi_di: string | null }[]>([]);
  useEffect(() => {
    supabase.from("devices").select("id, model, udi_di").order("model").then(({ data }) => {
      setDevices((data ?? []).filter((d: { udi_di: string | null }) => d.udi_di));
    });
  }, []);

  function generateGTIN() {
    const base = `${prefix}${company.padEnd(4, "0").slice(0, 4)}${product.padEnd(5, "0").slice(0, 5)}`;
    if (base.length !== 12) { toast.error("Verifique os campos — total deve ser 12 dígitos antes do check."); return; }
    const check = calcGTIN13Digit(base);
    setGenerated(`${base}${check}`);
  }

  function validateGTIN() {
    const raw = manualGtin.replace(/\D/g, "");
    if (raw.length !== 13 && raw.length !== 14) {
      setValidateResult({ valid: false, message: "GTIN deve ter 13 ou 14 dígitos." }); return;
    }
    const body = raw.slice(0, -1);
    const check = raw.slice(-1);
    const expected = calcGTIN13Digit(body.padStart(12, "0").slice(0, 12));
    setValidateResult(check === expected
      ? { valid: true,  message: `GTIN-${raw.length} válido. Dígito verificador: ${expected}` }
      : { valid: false, message: `GTIN inválido. Esperado dígito verificador: ${expected}, encontrado: ${check}` }
    );
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => toast.success("Copiado!"));
  }

  return (
    <div className="space-y-4">
      {/* Gerador */}
      <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
          <Barcode className="h-4 w-4 text-emerald-500" />
          <p className="text-sm font-semibold">Gerador de GTIN-13</p>
        </div>
        <div className="p-4 space-y-4">
          <p className="text-[12px] text-muted-foreground/70">
            Estrutura: <span className="font-mono">PPP CCCC PPPPP D</span> — Prefixo país (3) + empresa (4) + produto (5) + verificador (1)
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Prefixo país (GS1)</label>
              <input value={prefix} onChange={e => setPrefix(e.target.value.replace(/\D/g, "").slice(0, 3))}
                maxLength={3} placeholder="789"
                className="w-full h-9 rounded-xl border border-border/50 bg-background px-3 text-[13px] font-mono mt-1 focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
              <p className="text-[9px] text-muted-foreground/50 mt-0.5">Brasil: 789 ou 790</p>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Código empresa (4 dígitos)</label>
              <input value={company} onChange={e => setCompany(e.target.value.replace(/\D/g, "").slice(0, 4))}
                maxLength={4} placeholder="0001"
                className="w-full h-9 rounded-xl border border-border/50 bg-background px-3 text-[13px] font-mono mt-1 focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Código produto (5 dígitos)</label>
              <input value={product} onChange={e => setProduct(e.target.value.replace(/\D/g, "").slice(0, 5))}
                maxLength={5} placeholder="00001"
                className="w-full h-9 rounded-xl border border-border/50 bg-background px-3 text-[13px] font-mono mt-1 focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
            </div>
          </div>
          <button onClick={generateGTIN}
            className="w-full h-10 rounded-xl bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-500 transition-colors active:scale-[0.99]">
            Gerar GTIN-13
          </button>
          {generated && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-4 py-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] text-emerald-600 font-medium uppercase tracking-wide">GTIN-13 gerado</p>
                <p className="text-[22px] font-mono font-bold text-emerald-600 tracking-widest">{formatGTIN(generated)}</p>
                <p className="text-[10px] text-muted-foreground/60 font-mono mt-0.5">{generated}</p>
              </div>
              <button onClick={() => copyToClipboard(generated)}
                className="h-9 w-9 rounded-xl border border-emerald-500/30 flex items-center justify-center text-emerald-600 hover:bg-emerald-500/15 transition-colors shrink-0">
                <Copy className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Validador */}
      <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-blue-500" />
          <p className="text-sm font-semibold">Validador de GTIN</p>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex gap-2">
            <input value={manualGtin} onChange={e => { setManualGtin(e.target.value.replace(/\D/g, "")); setValidateResult(null); }}
              maxLength={14} placeholder="Digite o GTIN-13 ou GTIN-14..."
              className="flex-1 h-10 rounded-xl border border-border/50 bg-background px-3 text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            <button onClick={validateGTIN} disabled={manualGtin.length < 8}
              className="h-10 px-4 rounded-xl bg-blue-600 text-white font-medium text-sm hover:bg-blue-500 transition-colors disabled:opacity-40">
              Validar
            </button>
          </div>
          {validateResult && (
            <div className={cn(
              "flex items-start gap-2 rounded-xl border px-4 py-3",
              validateResult.valid
                ? "border-emerald-500/30 bg-emerald-500/8 text-emerald-600"
                : "border-destructive/30 bg-destructive/8 text-destructive"
            )}>
              {validateResult.valid
                ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                : <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />}
              <p className="text-[13px] font-medium">{validateResult.message}</p>
            </div>
          )}
        </div>
      </div>

      {/* Dispositivos com UDI-DI cadastrado */}
      {devices.length > 0 && (
        <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
            <Hash className="h-4 w-4 text-violet-500" />
            <p className="text-sm font-semibold">Peças com UDI-DI Cadastrado</p>
            <span className="ml-auto text-[10px] text-muted-foreground/50">{devices.length} peças</span>
          </div>
          <div className="divide-y divide-border/20 max-h-72 overflow-y-auto">
            {devices.map(d => (
              <div key={d.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/10 transition-colors">
                <p className="text-[13px] font-medium truncate flex-1 pr-4">{d.model}</p>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] font-mono text-violet-600 bg-violet-500/8 border border-violet-500/20 px-2 py-0.5 rounded-full">{d.udi_di}</span>
                  <button onClick={() => copyToClipboard(d.udi_di!)}
                    className="h-6 w-6 rounded-lg border border-border/40 flex items-center justify-center text-muted-foreground hover:text-violet-500 hover:border-violet-500/40 transition-colors">
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

// ─── Aba: Histórico ───────────────────────────────────────────────────────────

const HistoricoPanel = memo(function HistoricoPanel() {
  const [movements, setMovements] = useState<AllMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [faseFilter, setFaseFilter] = useState<"all" | "intermediaria" | "expedicao" | "retrabalho">("all");
  const [tipoFilter, setTipoFilter] = useState<"all" | "entrada" | "saida">("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(50);

  const loadMovements = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAllMovements(limit, faseFilter === "all" ? undefined : faseFilter as StockFase);
      setMovements(data);
    } catch { setMovements([]); }
    finally { setLoading(false); }
  }, [limit, faseFilter]);

  useEffect(() => { loadMovements(); }, [loadMovements]);

  const filtered = movements.filter(m => {
    if (tipoFilter !== "all" && m.type !== tipoFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        m.device_model.toLowerCase().includes(q) ||
        m.device_reference.toLowerCase().includes(q) ||
        (m.lote ?? "").toLowerCase().includes(q) ||
        (m.reason ?? "").toLowerCase().includes(q) ||
        (m.user_display_name ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border/30 flex items-center gap-3 flex-wrap">
          <History className="h-4 w-4 text-amber-500 shrink-0" />
          <p className="text-sm font-semibold">Histórico de Movimentações</p>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            {/* Busca */}
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Filtrar..."
              className="h-8 w-36 rounded-lg border border-border/50 bg-background px-3 text-[12px] focus:outline-none focus:ring-2 focus:ring-amber-500/30" />
            {/* Fase */}
            <select value={faseFilter} onChange={e => setFaseFilter(e.target.value as typeof faseFilter)}
              className="h-8 rounded-lg border border-border/50 bg-background px-2 text-[12px] focus:outline-none">
              <option value="all">Todas as fases</option>
              <option value="intermediaria">Intermediário</option>
              <option value="expedicao">Expedição</option>
              <option value="retrabalho">Retrabalho</option>
            </select>
            {/* Tipo */}
            <select value={tipoFilter} onChange={e => setTipoFilter(e.target.value as typeof tipoFilter)}
              className="h-8 rounded-lg border border-border/50 bg-background px-2 text-[12px] focus:outline-none">
              <option value="all">Entrada e Saída</option>
              <option value="entrada">Entradas</option>
              <option value="saida">Saídas</option>
            </select>
            <button onClick={loadMovements} className="h-8 w-8 rounded-lg border border-border/40 flex items-center justify-center text-muted-foreground hover:bg-muted/40 transition-colors">
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-4 space-y-2">
            {[...Array(6)].map((_, i) => <div key={i} className="h-12 rounded-xl bg-muted/30 animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground/60">Nenhuma movimentação encontrada</div>
        ) : (
          <div className="divide-y divide-border/20">
            {filtered.map(m => {
              const isEntrada = m.type === "entrada";
              const faseCfg = FASE_CONFIG[m.fase] ?? FASE_CONFIG.intermediaria;
              return (
                <div key={m.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/10 transition-colors">
                  <div className={cn("h-7 w-7 rounded-lg flex items-center justify-center shrink-0",
                    isEntrada ? "bg-violet-500/10" : "bg-amber-500/10")}>
                    {isEntrada
                      ? <ArrowDownCircle className="h-3.5 w-3.5 text-violet-500" />
                      : <ArrowUpCircle   className="h-3.5 w-3.5 text-amber-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium truncate">{m.device_model}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[10px] text-muted-foreground/60">{m.user_display_name ?? "—"}</span>
                      {m.lote && (
                        <span className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground/70 bg-muted/40 px-1.5 py-0.5 rounded">
                          <Tag className="h-2.5 w-2.5" />{m.lote}
                        </span>
                      )}
                      {m.reason && (
                        <span className="text-[10px] text-muted-foreground/50 truncate max-w-[160px]">{m.reason}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={cn("flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border", faseCfg.color, faseCfg.bg, faseCfg.border)}>
                      <faseCfg.Icon className="h-2.5 w-2.5" />{faseCfg.label}
                    </span>
                    <div className="text-right">
                      <p className={cn("text-[13px] font-bold tabular-nums", isEntrada ? "text-violet-500" : "text-amber-500")}>
                        {isEntrada ? "+" : "−"}{m.quantity}
                      </p>
                      <p className="text-[9px] text-muted-foreground/50">{fmtDateTime(m.created_at)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Carregar mais */}
        {!loading && filtered.length > 0 && movements.length === limit && (
          <div className="px-4 py-3 border-t border-border/20">
            <button onClick={() => setLimit(l => l + 50)}
              className="w-full h-9 rounded-xl border border-border/40 text-[12px] text-muted-foreground hover:bg-muted/30 transition-colors">
              Carregar mais movimentações
            </button>
          </div>
        )}

        {!loading && (
          <div className="px-4 py-2 border-t border-border/20 bg-muted/10">
            <p className="text-[10px] text-muted-foreground/50">
              {filtered.length} {filtered.length === 1 ? "movimentação" : "movimentações"} exibidas
            </p>
          </div>
        )}
      </div>
    </div>
  );
});

// ─── Página principal ─────────────────────────────────────────────────────────

export default function Qualidade() {
  const [activeView, setActiveView] = useState<QualidadeView>("rastreamento");

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-border/40 bg-card/60 backdrop-blur-sm">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-9 w-9 rounded-xl bg-violet-500/10 flex items-center justify-center shrink-0">
            <ShieldCheck className="h-5 w-5 text-violet-500" />
          </div>
          <div>
            <h1 className="text-[15px] font-bold leading-tight">Qualidade</h1>
            <p className="text-[11px] text-muted-foreground/60">Rastreabilidade · ANVISA · GTIN · Histórico</p>
          </div>
        </div>
        <PageNav tabs={TABS} activeTab={activeView} onTabChange={setActiveView} />
      </div>

      {/* Conteúdo */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeView === "rastreamento" && <RastreamentoPanel />}
        {activeView === "anvisa"       && <AnvisaPanel />}
        {activeView === "gtin"         && <GtinPanel />}
        {activeView === "historico"    && <HistoricoPanel />}
      </div>
    </div>
  );
}
