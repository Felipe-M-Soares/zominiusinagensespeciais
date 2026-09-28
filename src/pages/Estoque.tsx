/**
 * Estoque — 6 abas: Visão geral · Intermediário · Expedição · Retrabalho ·
 * Recebimento · Pedidos (separação dos pedidos do Comercial).
 *
 * Fluxo das peças: Intermediário (entrada por lote) → Expedição (embalada,
 * pronta p/ venda) ⇄ Retrabalho. Pedidos do Comercial são separados por lote
 * na aba Pedidos (Separar → Pronto → Faturado/Enviado).
 *
 * Tocar numa peça abre o detalhe (lotes, movimentações e ajustes de mínimo,
 * localização e observações). Movimentações não são apagadas: correções são
 * feitas por estorno/ajuste (rastreabilidade ANVISA).
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle, Boxes, ChevronDown, FileSpreadsheet, FileText, History, List, Loader2, MoreVertical,
  PackageCheck, Plus, SlidersHorizontal, Tag, Trash2, X,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useConfirmEnter } from "@/hooks/useConfirmEnter";
import { useStock, deleteStockItem } from "@/hooks/useStock";
import type { StockFase, StockItem } from "@/hooks/useStock";
import { temPapel } from "@/types/roles";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageSkeleton } from "@/components/PageSkeleton";
import { SearchInputWithBarcode } from "@/components/SearchInputWithBarcode";
import { StockNav, type ActiveView } from "@/components/stock/StockNav";
import { ListaItensEstoque } from "@/components/stock/ListaItensEstoque";
import { ItemEstoqueDialog, type AbaDetalhe } from "@/components/stock/ItemEstoqueDialog";
import { EscolherItemDialog, EstoqueBaixoDialog, LIMITE_EXPEDICAO_BAIXA } from "@/components/stock/EstoqueDialogs";
import { zerarSaldoPorAjuste } from "@/components/stock/acoesEstoque";
import { FASE_CFG, abaixoDoMinimo, fmtNum, situacaoItem, type Situacao } from "@/components/stock/estoqueUi";
import { friendlyError } from "@/lib/errorMessages";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// Lazy: modais e painéis pesados só carregam quando abertos/acessados
const MovementModal           = lazy(() => import("@/components/stock/MovementModal").then(m => ({ default: m.MovementModal })));
const AddToStockModal         = lazy(() => import("@/components/stock/AddToStockModal").then(m => ({ default: m.AddToStockModal })));
const StockListModal          = lazy(() => import("@/components/stock/StockListModal").then(m => ({ default: m.StockListModal })));
const IntermediaryLotesModal  = lazy(() => import("@/components/stock/IntermediaryLotesModal").then(m => ({ default: m.IntermediaryLotesModal })));
const StockCsvImport          = lazy(() => import("@/components/stock/StockCsvImport").then(m => ({ default: m.StockCsvImport })));
const ExcelStockImport        = lazy(() => import("@/components/stock/ExcelStockImport").then(m => ({ default: m.ExcelStockImport })));
const AllMovementsModal       = lazy(() => import("@/components/stock/AllMovementsModal").then(m => ({ default: m.AllMovementsModal })));
const TransferirExpedicaoModal= lazy(() => import("@/components/stock/TransferirExpedicaoModal").then(m => ({ default: m.TransferirExpedicaoModal })));
const RetrabalhoModal         = lazy(() => import("@/components/stock/RetrabalhoModal").then(m => ({ default: m.RetrabalhoModal })));
const ConcluirRetrabalhoModal = lazy(() => import("@/components/stock/ConcluirRetrabalhoModal").then(m => ({ default: m.ConcluirRetrabalhoModal })));
const StockDashboard          = lazy(() => import("@/components/stock/StockDashboard").then(m => ({ default: m.StockDashboard })));
const RecebimentoPanel        = lazy(() => import("@/components/stock/RecebimentoPanel").then(m => ({ default: m.RecebimentoPanel })));
const PedidosEstoquePanel     = lazy(() => import("@/components/stock/PedidosEstoquePanel").then(m => ({ default: m.PedidosEstoquePanel })));

const ABAS: ActiveView[] = ["dashboard", "intermediaria", "expedicao", "retrabalho", "recebimento", "pedidos"];
const FASES: ActiveView[] = ["intermediaria", "expedicao", "retrabalho"];
type FiltroSituacao = "todos" | Situacao;
const ITENS_POR_PAGINA = 60;

const Carregando = () => <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

export default function Estoque() {
  const { isAdmin, role, user } = useAuth();
  const podeEditar = temPapel(role, "estoque");
  const displayName = (user?.user_metadata?.display_name as string | undefined) ?? user?.email ?? null;

  // ── Aba (na URL, como no Financeiro — voltar/atualizar mantém a aba) ─────────
  const [params, setParams] = useSearchParams();
  const abaUrl = params.get("aba") as ActiveView | null;
  const activeView: ActiveView = abaUrl && ABAS.includes(abaUrl) ? abaUrl : "dashboard";
  const ehFase = FASES.includes(activeView);
  const fase = (ehFase ? activeView : "expedicao") as StockFase;

  // ── Busca e filtros ──────────────────────────────────────────────────────
  const [querySearch, setQuerySearch] = useState("");
  const [filtroSituacao, setFiltroSituacao] = useState<FiltroSituacao>("todos");
  const [filterLocation, setFilterLocation] = useState("");
  const [filterBrand, setFilterBrand] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [visibleCount, setVisibleCount] = useState(ITENS_POR_PAGINA);

  const irPara = useCallback((v: ActiveView) => {
    setParams(p => { const n = new URLSearchParams(p); n.set("aba", v); return n; }, { replace: true });
    setVisibleCount(ITENS_POR_PAGINA);
    setFiltroSituacao("todos");
    setQuerySearch("");
  }, [setParams]);

  // ── Dados ────────────────────────────────────────────────────────────────
  const { items: allItems, loteMap, qtyByFase, loading, error, refetch } = useStock(querySearch);

  // Pedidos aguardando separação (badge da aba) — Realtime para atualizar sem refresh
  const [pedidosParaSeparar, setPedidosParaSeparar] = useState(0);
  const loadPedidosPendentes = useCallback(async () => {
    const { count } = await supabase
      .from("pedidos_comerciais")
      .select("id", { count: "exact", head: true })
      .eq("status", "separando");
    setPedidosParaSeparar(count ?? 0);
  }, []);
  useEffect(() => { loadPedidosPendentes(); }, [loadPedidosPendentes]);
  useEffect(() => {
    const channel = supabase
      .channel(`estoque-badge-${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "pedidos_comerciais" }, () => { loadPedidosPendentes(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadPedidosPendentes]);

  // ── Modais ───────────────────────────────────────────────────────────────
  const [detalhe, setDetalhe] = useState<{ item: StockItem; aba: AbaDetalhe } | null>(null);
  const [movementState, setMovementState] = useState<{ item: StockItem; type: "entrada" | "saida" } | null>(null);
  const [transferItem, setTransferItem] = useState<StockItem | null>(null);
  const [retrabalhoItem, setRetrabalhoItem] = useState<StockItem | null>(null);
  const [concluirItem, setConcluirItem] = useState<StockItem | null>(null);
  const [escolher, setEscolher] = useState<"entrada" | "saida" | "transferir" | null>(null);
  const [baixoOpen, setBaixoOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [intermediaryLotesOpen, setIntermediaryLotesOpen] = useState(false);
  const [allMovOpen, setAllMovOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [excelImportOpen, setExcelImportOpen] = useState(false);
  const [resetItem, setResetItem] = useState<StockItem | null>(null);
  const [resetting, setResetting] = useState(false);
  const [deleteItem, setDeleteItem] = useState<StockItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [clearHistConfirm, setClearHistConfirm] = useState(false);
  const [clearingHist, setClearingHist] = useState(false);

  // Mantém o detalhe aberto sincronizado com o dado recarregado (ex.: após salvar ajuste)
  useEffect(() => {
    if (!detalhe) return;
    const atualizado = allItems.find(i => i.id === detalhe.item.id);
    if (atualizado && atualizado !== detalhe.item) setDetalhe(d => d ? { ...d, item: atualizado } : d);
  }, [allItems]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derivados ────────────────────────────────────────────────────────────
  const porFase = useMemo(() => ({
    intermediaria: allItems.filter(i => i.fase === "intermediaria"),
    expedicao: allItems.filter(i => i.fase === "expedicao"),
    retrabalho: allItems.filter(i => i.fase === "retrabalho" && i.quantity > 0),
  }), [allItems]);

  const faseItems = useMemo(() => (ehFase ? porFase[fase] : []), [ehFase, porFase, fase]);
  const baseFiltrada = useMemo(() => faseItems.filter(item => {
    if (!item.device) return false;
    if (filterLocation && !item.location?.toLowerCase().includes(filterLocation.toLowerCase())) return false;
    if (filterBrand && !item.device.brand_name?.toLowerCase().includes(filterBrand.toLowerCase())) return false;
    return true;
  }), [faseItems, filterLocation, filterBrand]);
  const contagem = useMemo(() => {
    const c = { todos: baseFiltrada.length, ok: 0, baixo: 0, zerado: 0 };
    for (const i of baseFiltrada) c[situacaoItem(i)]++;
    return c;
  }, [baseFiltrada]);
  const filteredItems = useMemo(
    () => filtroSituacao === "todos" ? baseFiltrada : baseFiltrada.filter(i => situacaoItem(i) === filtroSituacao),
    [baseFiltrada, filtroSituacao]
  );
  const pagedItems = useMemo(() => filteredItems.slice(0, visibleCount), [filteredItems, visibleCount]);
  const totalUnidades = filteredItems.reduce((s, i) => s + i.quantity, 0);
  const abaixoMinCount = useMemo(() => allItems.filter(abaixoDoMinimo).length, [allItems]);
  const filtrosExtras = !!filterLocation || !!filterBrand;
  const hasSearch = !!querySearch.trim();

  // ── Alerta em tempo real: expedição ficou baixa ────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel(`estoque-lowstock-${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "stock_items" }, (payload) => {
        const u = payload.new as { quantity?: number; fase?: string };
        if (u.fase === "expedicao" && typeof u.quantity === "number" && u.quantity > 0 && u.quantity < LIMITE_EXPEDICAO_BAIXA) {
          toast.warning(`Estoque baixo na expedição (${u.quantity} un.)`, {
            duration: 5000, action: { label: "Ver", onClick: () => setBaixoOpen(true) },
          });
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Aviso único por sessão quando há peças abaixo do mínimo
  const avisouRef = useRef(false);
  useEffect(() => {
    if (avisouRef.current || loading || abaixoMinCount === 0) return;
    avisouRef.current = true;
    toast.warning(`${abaixoMinCount} peça${abaixoMinCount > 1 ? "s" : ""} abaixo do estoque mínimo.`, {
      duration: 6000, action: { label: "Ver", onClick: () => setBaixoOpen(true) },
    });
  }, [loading, abaixoMinCount]);

  // ── Callbacks estáveis ───────────────────────────────────────────────────
  const abrir = useCallback((i: StockItem, aba: AbaDetalhe = "lotes") => setDetalhe({ item: i, aba }), []);
  const onEntrada = useCallback((i: StockItem) => setMovementState({ item: i, type: "entrada" }), []);
  const onSaida = useCallback((i: StockItem) => setMovementState({ item: i, type: "saida" }), []);
  const onTransferir = useCallback((i: StockItem) => setTransferItem(i), []);
  const onRetrabalho = useCallback((i: StockItem) => setRetrabalhoItem(i), []);
  const onConcluir = useCallback((i: StockItem) => setConcluirItem(i), []);
  const acoesItem = useMemo(() => ({
    onEntrada, onSaida, onTransferir, onRetrabalho, onConcluir,
    onZerar: (i: StockItem) => setResetItem(i),
    onRemover: (i: StockItem) => setDeleteItem(i),
  }), [onEntrada, onSaida, onTransferir, onRetrabalho, onConcluir]);

  const escolherCfg = escolher === "entrada"
    ? { titulo: "Registrar entrada", descricao: "Escolha a peça do Intermediário que está chegando.", itens: porFase.intermediaria, acao: onEntrada }
    : escolher === "transferir"
    ? { titulo: "Mover para Expedição", descricao: "Escolha a peça do Intermediário que já foi embalada.", itens: porFase.intermediaria.filter(i => i.quantity > 0), acao: onTransferir }
    : { titulo: "Registrar retirada", descricao: "Escolha a peça da Expedição que vai sair.", itens: porFase.expedicao.filter(i => i.quantity > 0), acao: onSaida };

  // ── Ações de administrador ───────────────────────────────────────────────
  async function clearAllHistory() {
    setClearingHist(true);
    try {
      // NÃO apaga rastreabilidade_pos_venda (dados de recall ANVISA) — usa as
      // RPCs admin_clear_* (admin-only, com auditoria).
      const { data: comercialData, error: eComercial } = await supabase.rpc("admin_clear_comercial");
      const comercialResult = comercialData as { ok?: boolean; error?: string } | null;
      if (eComercial || comercialResult?.ok === false) throw new Error(comercialResult?.error ?? eComercial?.message ?? "Erro ao apagar pedidos comerciais.");
      const { data: movData, error: eMov } = await supabase.rpc("admin_clear_stock_movements");
      const movResult = movData as { ok?: boolean; error?: string } | null;
      if (eMov || movResult?.ok === false) throw new Error(movResult?.error ?? eMov?.message ?? "Erro ao apagar movimentações de estoque.");
      // Zera quantidades mas MANTÉM os stock_items (peças cadastradas ficam com qty=0)
      const { error: e4 } = await supabase.from("stock_items").update({ quantity: 0, quantity_reserved: 0 }).neq("id", "00000000-0000-0000-0000-000000000000");
      if (e4) throw e4;
      toast.success("Histórico apagado. Peças cadastradas e validações ANVISA mantidas, com saldo zerado.");
      setClearHistConfirm(false);
      refetch();
    } catch (err: unknown) {
      toast.error(friendlyError(err, "Erro ao apagar histórico."));
    } finally {
      setClearingHist(false);
    }
  }

  async function handleResetItem() {
    if (!resetItem) return;
    setResetting(true);
    const r = await zerarSaldoPorAjuste(resetItem, user?.id ?? null, displayName);
    setResetting(false);
    if (!r.ok) { toast.error(r.error ?? "Não foi possível zerar o saldo."); return; }
    toast.success("Saldo zerado por ajuste. O histórico foi mantido.");
    setResetItem(null);
    refetch();
  }

  async function handleDeleteItemConfirm() {
    if (!deleteItem) return;
    setDeleting(true);
    const result = await deleteStockItem(deleteItem.id);
    setDeleting(false);
    if (result.ok) {
      toast.success("Peça removida do estoque.", { description: deleteItem.device.model });
      setDeleteItem(null);
      refetch();
    } else {
      toast.error(result.error ?? "Erro ao remover peça. Tente novamente.");
    }
  }

  useConfirmEnter(!!resetItem, handleResetItem, resetting);
  useConfirmEnter(clearHistConfirm, clearAllHistory, clearingHist);
  useConfirmEnter(!!deleteItem, handleDeleteItemConfirm, deleting);

  if (loading && allItems.length === 0 && !hasSearch) return <PageSkeleton />;

  const cfgFase = ehFase ? FASE_CFG[fase] : null;

  return (
    <div className="flex flex-col h-full bg-transparent">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border/40">
        <div className="px-3 sm:px-4 h-12 sm:h-14 flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Boxes className="h-4 w-4 text-primary shrink-0" />
            <div className="min-w-0">
              <h1 className="text-sm font-semibold leading-tight">Estoque</h1>
              <p className="hidden sm:block text-[10px] text-muted-foreground leading-tight">Intermediário, expedição, retrabalho, recebimento e separação de pedidos</p>
            </div>
            {abaixoMinCount > 0 && (
              <button type="button" onClick={() => setBaixoOpen(true)}
                className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400 hover:bg-amber-500/25">
                <AlertTriangle className="h-3 w-3" />{abaixoMinCount}<span className="hidden sm:inline"> abaixo do mínimo</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" className="h-9 gap-1.5" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" /><span className="hidden sm:inline">Adicionar peça</span><span className="sm:hidden">Peça</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="outline" className="h-9 w-9" aria-label="Mais opções"><MoreVertical className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuItem className="h-10 gap-2" onClick={() => setListOpen(true)}><List className="h-4 w-4" />Lista para imprimir</DropdownMenuItem>
                <DropdownMenuItem className="h-10 gap-2" onClick={() => setIntermediaryLotesOpen(true)}><Tag className="h-4 w-4" />Lotes do intermediário</DropdownMenuItem>
                <DropdownMenuItem className="h-10 gap-2" onClick={() => setAllMovOpen(true)}><History className="h-4 w-4" />Todas as movimentações</DropdownMenuItem>
                {isAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="h-10 gap-2" onClick={() => setExcelImportOpen(true)}><FileSpreadsheet className="h-4 w-4" />Importar Excel / PDF</DropdownMenuItem>
                    <DropdownMenuItem className="h-10 gap-2" onClick={() => setCsvOpen(true)}><FileText className="h-4 w-4" />Importar CSV</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="h-10 gap-2 text-red-600 focus:text-red-600" onClick={() => setClearHistConfirm(true)}><Trash2 className="h-4 w-4" />Apagar histórico…</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="px-3 sm:px-4 py-4 space-y-4">
          <StockNav
            activeView={activeView}
            onViewChange={(v) => { irPara(v); refetch(); }}
            loading={loading}
            pedidosPendentes={pedidosParaSeparar}
            qtyByFase={qtyByFase}
          />

          <Suspense fallback={<Carregando />}>
            {activeView === "dashboard" && (
              <StockDashboard
                items={allItems}
                qtyByFase={qtyByFase}
                loteMap={loteMap}
                loading={loading}
                pedidosParaSeparar={pedidosParaSeparar}
                onIrPara={irPara}
                onEstoqueBaixo={() => setBaixoOpen(true)}
                onAcaoRapida={setEscolher}
                onAbrirItem={abrir}
              />
            )}
            {activeView === "recebimento" && <RecebimentoPanel isAdmin={isAdmin} />}
            {activeView === "pedidos" && <PedidosEstoquePanel isAdmin={isAdmin} />}
          </Suspense>

          {ehFase && cfgFase && (
            <div className="space-y-3">
              {/* Busca + filtros */}
              <div className="flex gap-2">
                <SearchInputWithBarcode
                  className="flex-1 min-w-0"
                  value={querySearch}
                  onChange={v => { setQuerySearch(v.trim()); setVisibleCount(ITENS_POR_PAGINA); }}
                  onSearch={v => { setQuerySearch(v.trim()); setVisibleCount(ITENS_POR_PAGINA); }}
                  placeholder="Bipe ou busque modelo, referência, UDI ou lote"
                  height="h-11"
                />
                <Button type="button" variant={filtrosExtras ? "default" : "outline"} className="h-11 gap-1.5 shrink-0 px-3"
                  onClick={() => setShowFilters(v => !v)} aria-expanded={showFilters} aria-label="Mais filtros">
                  <SlidersHorizontal className="h-4 w-4" /><span className="hidden sm:inline">Filtros</span>
                </Button>
              </div>

              {showFilters && (
                <div className="rounded-2xl border bg-card p-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end">
                  <label className="block space-y-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Localização</span>
                    <Input value={filterLocation} onChange={e => setFilterLocation(e.target.value)} placeholder="Ex.: B3" className="h-11" />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Marca</span>
                    <Input value={filterBrand} onChange={e => setFilterBrand(e.target.value)} placeholder="Ex.: Zomini" className="h-11" />
                  </label>
                  <Button variant="ghost" className="h-11 gap-1" disabled={!filtrosExtras} onClick={() => { setFilterLocation(""); setFilterBrand(""); }}>
                    <X className="h-4 w-4" />Limpar
                  </Button>
                </div>
              )}

              {/* Situação (chips) */}
              <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none -mx-3 px-3 sm:mx-0 sm:px-0" role="tablist" aria-label="Situação do saldo">
                {([
                  ["todos", "Todas"],
                  ["ok", "OK"],
                  ["baixo", "Baixo"],
                  ["zerado", "Zerado"],
                ] as [FiltroSituacao, string][]).map(([id, l]) => (
                  <button key={id} type="button" role="tab" aria-selected={filtroSituacao === id}
                    onClick={() => { setFiltroSituacao(id); setVisibleCount(ITENS_POR_PAGINA); }}
                    className={cn(
                      "h-9 shrink-0 rounded-full border px-3 text-sm font-medium inline-flex items-center gap-1.5",
                      filtroSituacao === id ? "bg-foreground text-background border-foreground" : "bg-card text-muted-foreground hover:text-foreground"
                    )}>
                    {l}<span className={cn("text-xs tabular-nums", filtroSituacao === id ? "opacity-80" : "")}>{contagem[id]}</span>
                  </button>
                ))}
                <span className="ml-auto hidden sm:block shrink-0 text-xs text-muted-foreground pl-2">
                  {fmtNum(totalUnidades)} un. em {fmtNum(filteredItems.length)} peça{filteredItems.length !== 1 ? "s" : ""}
                </span>
              </div>

              <p className="text-xs text-muted-foreground">
                <span className="sm:hidden font-medium text-foreground">{fmtNum(totalUnidades)} un. em {fmtNum(filteredItems.length)} peça{filteredItems.length !== 1 ? "s" : ""}. </span>
                {cfgFase.descricao}
                {/^\d{6}/.test(querySearch) && <> Buscando por lote (formato <span className="font-mono">DDMMAA-TT</span>).</>}
              </p>

              {loading ? (
                <Carregando />
              ) : error ? (
                <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-center space-y-3">
                  <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                  <Button variant="outline" className="h-10" onClick={refetch}>Tentar de novo</Button>
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="rounded-2xl border border-dashed bg-card py-12 px-4 text-center space-y-2">
                  <cfgFase.Icon className="h-9 w-9 mx-auto text-muted-foreground/40" />
                  <p className="font-medium">
                    {hasSearch || filtrosExtras || filtroSituacao !== "todos" ? "Nenhuma peça encontrada" : `Nenhuma peça em ${cfgFase.label.toLowerCase()}`}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {hasSearch ? "Tente outro termo de busca." :
                      filtrosExtras || filtroSituacao !== "todos" ? "Remova alguns filtros para ver mais peças." :
                      fase === "intermediaria" ? "Adicione peças ao estoque e registre a entrada por lote." :
                      fase === "retrabalho" ? "Peças enviadas para retrabalho aparecem aqui." :
                      "Mova peças do Intermediário para cá depois de embalar."}
                  </p>
                  {!hasSearch && !filtrosExtras && filtroSituacao === "todos" && fase === "intermediaria" && (
                    <Button className="h-11 gap-1.5 mt-2" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" />Adicionar peça</Button>
                  )}
                  {(filtrosExtras || filtroSituacao !== "todos") && (
                    <Button variant="outline" className="h-10 mt-2" onClick={() => { setFilterLocation(""); setFilterBrand(""); setFiltroSituacao("todos"); }}>Limpar filtros</Button>
                  )}
                </div>
              ) : (
                <>
                  <ListaItensEstoque
                    fase={fase}
                    items={pagedItems}
                    loteMap={loteMap}
                    onAbrir={abrir}
                    onEntrada={onEntrada}
                    onSaida={onSaida}
                    onTransferir={onTransferir}
                    onRetrabalho={onRetrabalho}
                    onConcluir={onConcluir}
                  />
                  {visibleCount < filteredItems.length && (
                    <div className="flex justify-center pt-1 pb-2">
                      <Button variant="outline" className="h-11 gap-2" onClick={() => setVisibleCount(c => c + ITENS_POR_PAGINA)}>
                        <ChevronDown className="h-4 w-4" />Carregar mais ({fmtNum(filteredItems.length - visibleCount)} restantes)
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </main>

      {/* ─── Detalhe + diálogos ─────────────────────────────────────────────── */}
      <ItemEstoqueDialog
        item={detalhe?.item ?? null}
        abaInicial={detalhe?.aba}
        onClose={() => setDetalhe(null)}
        onChanged={refetch}
        acoes={acoesItem}
        isAdmin={isAdmin}
        podeEditar={podeEditar}
      />
      <EscolherItemDialog
        open={!!escolher}
        titulo={escolherCfg.titulo}
        descricao={escolherCfg.descricao}
        itens={escolherCfg.itens}
        onClose={() => setEscolher(null)}
        onEscolher={(i) => { const acao = escolherCfg.acao; setEscolher(null); acao(i); }}
      />
      <EstoqueBaixoDialog open={baixoOpen} itens={allItems} onClose={() => setBaixoOpen(false)} onAbrir={(i) => abrir(i, "ajustes")} />

      <Suspense fallback={null}>
        <MovementModal
          item={movementState?.item ?? null}
          open={!!movementState}
          initialType={movementState?.type ?? "entrada"}
          lockedType={movementState?.type}
          onClose={() => setMovementState(null)}
          onSuccess={refetch}
        />
        <TransferirExpedicaoModal item={transferItem} open={!!transferItem} onClose={() => setTransferItem(null)} onSuccess={refetch} />
        <RetrabalhoModal item={retrabalhoItem} open={!!retrabalhoItem} onClose={() => setRetrabalhoItem(null)} onSuccess={refetch} />
        <ConcluirRetrabalhoModal item={concluirItem} open={!!concluirItem} onClose={() => setConcluirItem(null)} onSuccess={refetch} />
        {addOpen && <AddToStockModal open={addOpen} onClose={() => setAddOpen(false)} onSuccess={refetch} />}
        {listOpen && <StockListModal open={listOpen} onClose={() => setListOpen(false)} items={allItems} />}
        {allMovOpen && (
          <AllMovementsModal open={allMovOpen} onClose={() => setAllMovOpen(false)} fase={ehFase ? fase : undefined} />
        )}
        {intermediaryLotesOpen && <IntermediaryLotesModal open={intermediaryLotesOpen} onClose={() => setIntermediaryLotesOpen(false)} />}
        {csvOpen && <StockCsvImport open={csvOpen} onClose={() => setCsvOpen(false)} onSuccess={refetch} />}
        {excelImportOpen && <ExcelStockImport open={excelImportOpen} onClose={() => setExcelImportOpen(false)} onSuccess={refetch} />}
      </Suspense>

      {/* Zerar saldo (por ajuste) */}
      <AlertDialog open={!!resetItem} onOpenChange={v => { if (!v && !resetting) setResetItem(null); }}>
        <AlertDialogContent className="w-[calc(100vw-1.5rem)] rounded-2xl">
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle className="flex items-center gap-2"><PackageCheck className="h-5 w-5 text-amber-500" />Zerar o saldo desta peça?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p className="font-medium text-foreground">{resetItem?.device.model} · {resetItem ? FASE_CFG[resetItem.fase].label : ""}</p>
                <p>Serão lançadas <strong>saídas de ajuste</strong> para cada lote com saldo, deixando a peça com 0 un. O histórico de movimentações <strong>é mantido</strong> (rastreabilidade) e pode ser estornado depois.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting} className="h-11">Cancelar</AlertDialogCancel>
            <AlertDialogAction className="h-11 bg-amber-600 hover:bg-amber-700 text-white" disabled={resetting}
              onClick={e => { e.preventDefault(); handleResetItem(); }}>
              {resetting && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}Zerar saldo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Remover peça do estoque */}
      <AlertDialog open={!!deleteItem} onOpenChange={v => { if (!v && !deleting) setDeleteItem(null); }}>
        <AlertDialogContent className="w-[calc(100vw-1.5rem)] rounded-2xl">
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400"><Trash2 className="h-5 w-5" />Remover do estoque?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p className="font-medium text-foreground">{deleteItem?.device.model} · {deleteItem ? FASE_CFG[deleteItem.fase].label : ""}</p>
                <p>A peça sai do estoque desta fase junto com seu histórico. Use só para cadastros feitos por engano — para acertar saldo, prefira “Zerar saldo”.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} className="h-11">Cancelar</AlertDialogCancel>
            <AlertDialogAction className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={deleting}
              onClick={e => { e.preventDefault(); handleDeleteItemConfirm(); }}>
              {deleting && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Apagar todo o histórico (admin) */}
      <AlertDialog open={clearHistConfirm} onOpenChange={v => { if (!v && !clearingHist) setClearHistConfirm(false); }}>
        <AlertDialogContent className="w-[calc(100vw-1.5rem)] rounded-2xl">
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400"><AlertTriangle className="h-5 w-5" />Apagar todo o histórico?</AlertDialogTitle>
            <AlertDialogDescription>
              Apaga <strong>todas as movimentações</strong> e os <strong>pedidos comerciais</strong>, e zera o saldo de todas as peças.
              As peças cadastradas e a rastreabilidade/validação ANVISA pós-venda <strong>são mantidas</strong>. Não pode ser desfeito — faça um backup antes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearingHist} className="h-11">Cancelar</AlertDialogCancel>
            <AlertDialogAction className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={clearingHist}
              onClick={e => { e.preventDefault(); clearAllHistory(); }}>
              {clearingHist && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}Apagar tudo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
