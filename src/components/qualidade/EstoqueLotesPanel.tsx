/**
 * Lotes no estoque — onde está cada peça/lote dentro da fábrica.
 *  • "Onde está": busca por modelo, referência, lote, UDI-DI ou nº ANVISA
 *    (aceita leitor de código de barras). Sem busca, mostra o que está retido
 *    no Retrabalho agora (peças que voltaram ou aguardam decisão).
 *  • "Movimentações": histórico de entradas/saídas com lote e responsável.
 */
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowDownCircle, ArrowUpCircle, Hash, History, Package, RefreshCw, Search, ShieldCheck, Tag, Truck, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDebounce } from "@/hooks/useDebounce";
import { sanitizeQuery } from "@/lib/sanitize";
import { fetchAllMovements, type AllMovement, type StockFase } from "@/hooks/useStock";
import { SearchInputWithBarcode } from "@/components/SearchInputWithBarcode";
import { ClearHistoryButton } from "@/components/admin/ClearHistoryButton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CampoBusca, Chip, ListaSkeleton, SELECT_CLS, Segmentado, Vazio, fmtDiaHora } from "./shared";

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface LoteInfo { lote: string; saldo: number; last_movement: string }
interface FaseInfo {
  fase: StockFase; stock_item_id: string;
  quantity: number; quantity_reserved: number; quantity_available: number;
  location: string | null; lotes: LoteInfo[];
}
interface PecaResult {
  device_id: string; model: string; reference: string;
  internal_code: string | null; udi_di: string | null;
  anvisa_registration: string | null; classification_code: string | null;
  fases: FaseInfo[]; em_retrabalho: boolean; tem_reservas: boolean;
}
type DevRow = { id: string; model: string; reference: string; internal_code: string | null; udi_di: string | null; anvisa_registration: string | null; classification_code: string | null };
type StockRow = { id: string; device_id: string; quantity: number; quantity_reserved: number; location: string | null; fase: StockFase };

const FASE_CONFIG: Record<StockFase, { label: string; Icon: React.ElementType; color: string; bg: string; border: string }> = {
  intermediaria: { label: "Intermediário", Icon: Package, color: "text-violet-600 dark:text-violet-400",  bg: "bg-violet-500/10",  border: "border-violet-500/30" },
  expedicao:     { label: "Expedição",     Icon: Truck,   color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
  retrabalho:    { label: "Retrabalho",    Icon: Wrench,  color: "text-amber-600 dark:text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/30" },
};

const DEV_COLS = "id, model, reference, internal_code, udi_di, anvisa_registration, classification_code";

// ─── Montagem dos resultados ─────────────────────────────────────────────────

function buildLotesByItem(movData: unknown[]): Map<string, Map<string, { saldo: number; last_movement: string }>> {
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

function buildPecaResult(dev: DevRow, devItems: StockRow[], lotesByItem: ReturnType<typeof buildLotesByItem>): PecaResult {
  // Agrupa por fase: unifica múltiplos stock_items da mesma fase em uma linha
  const faseMap = new Map<StockFase, FaseInfo>();
  for (const item of devItems) {
    const lm = lotesByItem.get(item.id);
    const itemLotes: LoteInfo[] = lm
      ? Array.from(lm.entries()).filter(([, v]) => v.saldo > 0).map(([lote, v]) => ({ lote, saldo: v.saldo, last_movement: v.last_movement }))
      : [];
    const ex = faseMap.get(item.fase);
    if (ex) {
      const merged = new Map(ex.lotes.map(l => [l.lote, l]));
      for (const l of itemLotes) {
        const e = merged.get(l.lote);
        merged.set(l.lote, e ? { ...e, saldo: e.saldo + l.saldo } : l);
      }
      faseMap.set(item.fase, {
        ...ex,
        quantity: ex.quantity + item.quantity,
        quantity_reserved: ex.quantity_reserved + item.quantity_reserved,
        quantity_available: ex.quantity_available + (item.quantity - item.quantity_reserved),
        lotes: Array.from(merged.values()).sort((a, b) => b.saldo - a.saldo),
      });
    } else {
      faseMap.set(item.fase, {
        fase: item.fase, stock_item_id: item.id,
        quantity: item.quantity, quantity_reserved: item.quantity_reserved,
        quantity_available: item.quantity - item.quantity_reserved,
        location: item.location, lotes: itemLotes.sort((a, b) => b.saldo - a.saldo),
      });
    }
  }
  const ORDEM: StockFase[] = ["retrabalho", "intermediaria", "expedicao"];
  const fases = ORDEM.filter(f => faseMap.has(f)).map(f => faseMap.get(f)!);
  return {
    device_id: dev.id, model: dev.model, reference: dev.reference, internal_code: dev.internal_code,
    udi_di: dev.udi_di, anvisa_registration: dev.anvisa_registration, classification_code: dev.classification_code,
    fases,
    em_retrabalho: fases.some(f => f.fase === "retrabalho" && f.quantity > 0),
    tem_reservas: fases.some(f => f.quantity_reserved > 0),
  };
}

const totalQty = (p: PecaResult) => p.fases.reduce((s, f) => s + f.quantity, 0);

async function lotesDosItens(itemIds: string[]) {
  if (itemIds.length === 0) return buildLotesByItem([]);
  const { data } = await supabase.from("stock_movements")
    .select("stock_item_id, lote, type, quantity, created_at")
    .in("stock_item_id", itemIds).not("lote", "is", null).order("created_at", { ascending: false }).limit(2000);
  return buildLotesByItem(data ?? []);
}

async function searchPecas(query: string): Promise<PecaResult[]> {
  const q = sanitizeQuery(query);
  if (!q || q.length < 2) return [];

  // Busca por lote: padrão DDMMYY-NN ou parcial com traço
  if (/\d{2,6}-\d{0,2}/.test(q)) {
    const { data: loteMov } = await supabase.from("stock_movements").select("stock_item_id, lote").ilike("lote", `%${q}%`).limit(200);
    if (!loteMov?.length) return [];
    const itemIds = [...new Set((loteMov as { stock_item_id: string }[]).map(m => m.stock_item_id))];
    const { data: stock } = await supabase.from("stock_items").select("id, device_id, quantity, quantity_reserved, location, fase").in("id", itemIds);
    if (!stock?.length) return [];
    const stockItems = stock as StockRow[];
    const devIds = [...new Set(stockItems.map(s => s.device_id))];
    const { data: devs } = await supabase.from("devices").select(DEV_COLS).in("id", devIds);
    if (!devs) return [];
    const lotesByItem = await lotesDosItens(itemIds);
    return (devs as DevRow[])
      .map(dev => buildPecaResult(dev, stockItems.filter(s => s.device_id === dev.id), lotesByItem))
      .filter(p => totalQty(p) > 0)
      .sort((a, b) => totalQty(b) - totalQty(a));
  }

  const { data: devData } = await supabase.from("devices").select(DEV_COLS)
    .or(`model.ilike.%${q}%,reference.ilike.%${q}%,internal_code.ilike.%${q}%,udi_di.ilike.%${q}%,anvisa_registration.ilike.%${q}%`)
    .limit(200);
  if (!devData?.length) return [];
  const devs = devData as DevRow[];
  const { data: stockData } = await supabase.from("stock_items")
    .select("id, device_id, quantity, quantity_reserved, location, fase")
    .in("device_id", devs.map(d => d.id)).limit(2000);
  if (!stockData?.length) return [];
  const stockItems = stockData as StockRow[];
  const lotesByItem = await lotesDosItens(stockItems.map(s => s.id));
  return devs
    .map(dev => buildPecaResult(dev, stockItems.filter(s => s.device_id === dev.id), lotesByItem))
    .filter(p => totalQty(p) > 0)
    .sort((a, b) => totalQty(b) - totalQty(a));
}

async function listarRetrabalho(): Promise<PecaResult[]> {
  const { data: stock } = await supabase.from("stock_items")
    .select("id, device_id, quantity, quantity_reserved, location, fase")
    .eq("fase", "retrabalho").gt("quantity", 0).limit(500);
  if (!stock?.length) return [];
  const stockItems = stock as StockRow[];
  const { data: devs } = await supabase.from("devices").select(DEV_COLS).in("id", [...new Set(stockItems.map(s => s.device_id))]);
  if (!devs) return [];
  const lotesByItem = await lotesDosItens(stockItems.map(s => s.id));
  return (devs as DevRow[])
    .map(dev => buildPecaResult(dev, stockItems.filter(s => s.device_id === dev.id), lotesByItem))
    .filter(p => totalQty(p) > 0)
    .sort((a, b) => totalQty(b) - totalQty(a));
}

// ─── Cartões ─────────────────────────────────────────────────────────────────

function FaseLinha({ fase }: { fase: FaseInfo }) {
  const cfg = FASE_CONFIG[fase.fase] ?? FASE_CONFIG.intermediaria;
  return (
    <div className={cn("rounded-xl border px-3 py-2 space-y-1.5", cfg.border, cfg.bg)}>
      <div className="flex items-center gap-2">
        <cfg.Icon className={cn("h-4 w-4 shrink-0", cfg.color)} />
        <span className={cn("text-sm font-semibold", cfg.color)}>{cfg.label}</span>
        {fase.location && <span className="text-xs text-muted-foreground truncate">· {fase.location}</span>}
        <span className="ml-auto flex items-baseline gap-1.5 shrink-0">
          {fase.quantity_reserved > 0 && <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 tabular-nums" title="Reservadas para pedidos">{fase.quantity_reserved} reserv.</span>}
          <span className={cn("text-base font-bold tabular-nums", cfg.color)}>{fase.quantity.toLocaleString("pt-BR")}</span>
          <span className="text-xs text-muted-foreground">un.</span>
        </span>
      </div>
      {fase.lotes.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {fase.lotes.map(l => (
            <span key={l.lote} className="inline-flex items-center gap-1 text-xs font-mono bg-background/70 border px-1.5 py-0.5 rounded-md">
              <Tag className="h-3 w-3 text-muted-foreground" />{l.lote}<span className="text-muted-foreground">· {l.saldo}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function PecaCard({ peca }: { peca: PecaResult }) {
  return (
    <div className="rounded-2xl border bg-card p-4 space-y-3 min-w-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight truncate">{peca.model}</p>
          <p className="text-xs text-muted-foreground font-mono truncate">{peca.reference}</p>
        </div>
        <p className="text-lg font-bold tabular-nums shrink-0">{totalQty(peca).toLocaleString("pt-BR")}<span className="text-xs font-normal text-muted-foreground ml-0.5">un.</span></p>
      </div>
      {(peca.udi_di || peca.anvisa_registration || peca.em_retrabalho || peca.tem_reservas) && (
        <div className="flex flex-wrap gap-1.5">
          {peca.udi_di && <Chip tom="roxo" className="font-mono"><Hash className="h-3 w-3" />{peca.udi_di}</Chip>}
          {peca.anvisa_registration && <Chip tom="info"><ShieldCheck className="h-3 w-3" />{peca.anvisa_registration}</Chip>}
          {peca.em_retrabalho && <Chip tom="atencao"><Wrench className="h-3 w-3" />Em retrabalho</Chip>}
          {peca.tem_reservas && <Chip tom="info">Com reservas</Chip>}
        </div>
      )}
      <div className="space-y-1.5">
        {peca.fases.map(f => <FaseLinha key={`${f.fase}-${f.stock_item_id}`} fase={f} />)}
      </div>
    </div>
  );
}

// ─── Painel ──────────────────────────────────────────────────────────────────

type Visao = "onde" | "movimentos";

export const EstoqueLotesPanel = memo(function EstoqueLotesPanel({ filtroInicial }: { filtroInicial?: string | null }) {
  const [visao, setVisao] = useState<Visao>(filtroInicial === "movimentos" ? "movimentos" : "onde");
  return (
    <div className="space-y-4">
      <Segmentado<Visao> valor={visao} onChange={setVisao} className="w-full sm:w-auto sm:inline-flex"
        opcoes={[{ id: "onde", label: "Onde está o lote" }, { id: "movimentos", label: "Movimentações" }]} />
      {visao === "onde" ? <OndeEsta /> : <Movimentacoes />}
    </div>
  );
});

function OndeEsta() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PecaResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retidas, setRetidas] = useState<PecaResult[] | null>(null);

  const carregarRetidas = useCallback(() => {
    setRetidas(null);
    listarRetrabalho().then(setRetidas).catch(() => setRetidas([]));
  }, []);
  useEffect(() => { carregarRetidas(); }, [carregarRetidas]);

  const debouncedSearch = useDebounce(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || trimmed.length < 2) { setResults([]); setSearched(false); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      setResults(await searchPecas(trimmed)); setSearched(true);
    } catch { setError("Não foi possível pesquisar agora. Tente de novo."); }
    finally { setLoading(false); }
  }, 400);

  function handleChange(v: string) {
    setQuery(v);
    if (!v.trim()) { setResults([]); setSearched(false); setError(null); setLoading(false); return; }
    setLoading(true);
    debouncedSearch(v);
  }

  const semBusca = !query.trim();
  const retidasTotal = useMemo(() => (retidas ?? []).reduce((s, p) => s + totalQty(p), 0), [retidas]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <SearchInputWithBarcode value={query} onChange={handleChange} onSearch={v => { setQuery(v); setLoading(true); debouncedSearch(v); }}
          placeholder="Modelo, referência, lote (ex: 010125-01), UDI-DI ou nº ANVISA..." height="h-11" />
        {loading && <span className="absolute right-11 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {!semBusca && searched && !loading && !error && (
        results.length === 0 ? (
          <div className="rounded-2xl border bg-card">
            <Vazio Icon={Package} titulo="Nenhuma peça com saldo encontrada" dica="Confira o lote ou a referência. Lotes já totalmente vendidos aparecem na aba Pós-venda." />
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{results.length} peça{results.length !== 1 ? "s" : ""} com saldo</p>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {results.map(p => <PecaCard key={p.device_id} peca={p} />)}
            </div>
          </div>
        )
      )}

      {semBusca && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold flex-1">Retidas no retrabalho agora</h3>
            {retidas && retidas.length > 0 && <Chip tom="atencao">{retidasTotal.toLocaleString("pt-BR")} un.</Chip>}
            <Button variant="ghost" size="icon" className="h-10 w-10" onClick={carregarRetidas} aria-label="Atualizar retidas">
              <RefreshCw className={cn("h-4 w-4", retidas === null && "animate-spin")} />
            </Button>
          </div>
          {retidas === null ? (
            <div className="rounded-2xl border bg-card"><ListaSkeleton linhas={3} /></div>
          ) : retidas.length === 0 ? (
            <div className="rounded-2xl border bg-card">
              <Vazio Icon={Search} titulo="Nada retido no retrabalho" dica="Digite acima o lote, a referência ou bipe o código para ver onde está cada peça." />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {retidas.map(p => <PecaCard key={p.device_id} peca={p} />)}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Movimentacoes() {
  const { isAdmin } = useAuth();
  const [movements, setMovements] = useState<AllMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [faseFilter, setFaseFilter] = useState<"all" | StockFase>("all");
  const [tipoFilter, setTipoFilter] = useState<"all" | "entrada" | "saida">("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(50);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMovements(await fetchAllMovements(limit, faseFilter === "all" ? undefined : faseFilter));
    } catch { setMovements([]); }
    finally { setLoading(false); }
  }, [limit, faseFilter]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return movements.filter(m => {
      if (faseFilter !== "all" && m.fase !== faseFilter) return false;
      if (tipoFilter !== "all" && m.type !== tipoFilter) return false;
      if (!q) return true;
      return `${m.device_model} ${m.device_reference} ${m.lote ?? ""} ${m.reason ?? ""} ${m.user_display_name ?? ""}`.toLowerCase().includes(q);
    });
  }, [movements, faseFilter, tipoFilter, search]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <CampoBusca value={search} onChange={setSearch} placeholder="Peça, lote, motivo ou pessoa..." />
        <select value={faseFilter} onChange={e => setFaseFilter(e.target.value as typeof faseFilter)} aria-label="Fase" className={cn(SELECT_CLS, "w-auto flex-1 sm:flex-none")}>
          <option value="all">Todas as fases</option>
          <option value="intermediaria">Intermediário</option>
          <option value="expedicao">Expedição</option>
          <option value="retrabalho">Retrabalho</option>
        </select>
        <select value={tipoFilter} onChange={e => setTipoFilter(e.target.value as typeof tipoFilter)} aria-label="Tipo" className={cn(SELECT_CLS, "w-auto flex-1 sm:flex-none")}>
          <option value="all">Entradas e saídas</option>
          <option value="entrada">Só entradas</option>
          <option value="saida">Só saídas</option>
        </select>
        <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={load} disabled={loading} aria-label="Atualizar">
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
        {isAdmin && (
          <ClearHistoryButton rpc="admin_clear_stock_movements"
            confirmTitle="Apagar histórico de movimentações?"
            confirmDescription="Apaga todo o histórico de entradas e saídas de estoque. As quantidades atuais e as peças cadastradas são mantidas."
            onCleared={load} />
        )}
      </div>

      <div className="rounded-2xl border bg-card overflow-hidden">
        {loading && movements.length === 0 ? <ListaSkeleton linhas={6} /> : filtered.length === 0 ? (
          <Vazio Icon={History} titulo="Nenhuma movimentação encontrada" dica="Troque os filtros ou limpe a busca." />
        ) : (
          <ul className="divide-y">
            {filtered.map(m => {
              const entrada = m.type === "entrada";
              const cfg = FASE_CONFIG[m.fase] ?? FASE_CONFIG.intermediaria;
              return (
                <li key={m.id} className="px-4 py-3 flex items-start sm:items-center gap-3">
                  <span className={cn("h-9 w-9 rounded-xl flex items-center justify-center shrink-0", entrada ? "bg-violet-500/10" : "bg-amber-500/10")}>
                    {entrada ? <ArrowDownCircle className="h-4 w-4 text-violet-500" /> : <ArrowUpCircle className="h-4 w-4 text-amber-500" />}
                  </span>
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-sm font-medium truncate">{m.device_model}</p>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium", cfg.color, cfg.bg, cfg.border)}>
                        <cfg.Icon className="h-3 w-3" />{cfg.label}
                      </span>
                      {m.lote && <span className="inline-flex items-center gap-1 font-mono bg-muted px-1.5 py-0.5 rounded-md"><Tag className="h-3 w-3" />{m.lote}</span>}
                      <span>{m.user_display_name ?? "—"}</span>
                    </div>
                    {m.reason && <p className="text-xs text-muted-foreground line-clamp-2">{m.reason}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className={cn("text-base font-bold tabular-nums", entrada ? "text-violet-600 dark:text-violet-400" : "text-amber-600 dark:text-amber-400")}>{entrada ? "+" : "−"}{m.quantity}</p>
                    <p className="text-[11px] text-muted-foreground whitespace-nowrap">{fmtDiaHora(m.created_at)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {!loading && movements.length === limit && (
          <div className="p-3 border-t">
            <Button variant="outline" className="w-full h-11" onClick={() => setLimit(l => l + 50)}>Carregar mais</Button>
          </div>
        )}
        {!loading && filtered.length > 0 && <div className="px-4 py-2 border-t bg-muted/30 text-xs text-muted-foreground">{filtered.length} movimentações exibidas</div>}
      </div>
    </div>
  );
}
