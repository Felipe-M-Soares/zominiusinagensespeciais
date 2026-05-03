/**
 * PedidosEstoquePanel — Aba "Pedidos" dentro do Estoque
 *
 * Fluxo do estoque:
 *  1. Vê pedidos com status "pendente"
 *  2. Clica "Iniciar separação" → status vira "separando", peças ficam em reserva
 *  3. Escolhe lotes disponíveis na expedição para cada item
 *  4. Clica "Marcar como Pronto" → status vira "pronto", aguarda financeiro emitir NF
 */

import { useState, useEffect, useCallback, useRef, memo } from "react";
import {
  Package,
  Tag,
  User,
  Clock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Truck,
  X,
  RefreshCw,
  ShoppingBag,
  AlertTriangle,
  MapPin,
  DollarSign,
  ArrowRight,
  PackageCheck,
  Ban,
  Search,
  Archive,
  Minus,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface LoteDisponivel {
  lote: string;
  quantity: number;
  stock_item_id: string;
}

interface PedidoItem {
  id: string;
  ids: string[]; // todos os ids de pedido_itens unificados
  stock_item_id: string;
  lote: string;
  quantidade: number;
  device_model?: string;
  device_reference?: string;
  lotes_disponiveis?: LoteDisponivel[];
  lote_escolhido?: string;
}

interface Pedido {
  id: string;
  cliente_nome: string;
  vendedora_nome: string | null;
  vendedora_id: string | null;
  status: string;
  frete: number;
  observacoes: string | null;
  created_at: string;
  itens: PedidoItem[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function statusColor(status: string) {
  if (status === "pendente") return "bg-amber-500/10 text-amber-600 border-amber-500/20";
  if (status === "separando") return "bg-blue-500/10 text-blue-600 border-blue-500/20";
  if (status === "pronto") return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
  if (status === "faturado") return "bg-violet-500/10 text-violet-600 border-violet-500/20";
  if (status === "enviado") return "bg-success/10 text-success border-success/20";
  return "bg-muted/30 text-muted-foreground border-border/30";
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    pendente: "Pendente",
    separando: "Separando",
    pronto: "Pronto",
    faturado: "Faturado",
    enviado: "Enviado",
    cancelado: "Cancelado",
  };
  return map[status] ?? status;
}

// ─── Card de Pedido ───────────────────────────────────────────────────────────

interface StockItemExpedicao {
  stock_item_id: string;
  quantity: number; // total na expedição
  lotes: LoteDisponivel[];
  loading: boolean;
}

interface LoteSelecao {
  [itemId: string]: {
    [lote: string]: number;
  };
}

interface PedidoCardProps {
  pedido: Pedido;
  onIniciarSeparacao: (pedido: Pedido, lotesSelecionados: LoteSelecao) => void;
  onSalvarSeparacao: (pedido: Pedido, lotesSelecionados: LoteSelecao) => Promise<void>;
  onMarcarPronto: (pedido: Pedido) => void;
  onCancelar: (pedido: Pedido) => void;
  onEditarItem: (pedido: Pedido, item: PedidoItem) => void;
  isAdmin: boolean;
}

function PedidoCard({ pedido, onIniciarSeparacao, onSalvarSeparacao, onMarcarPronto, onCancelar, onEditarItem, isAdmin }: PedidoCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [expedicaoData, setExpedicaoData] = useState<Record<string, StockItemExpedicao>>({});
  const [lotesSel, setLotesSel] = useState<LoteSelecao>({});
  const [loadingLotes, setLoadingLotes] = useState(false);
  const [salvandoSep, setSalvandoSep] = useState(false);
  const loadedRef = useRef(false);

  const totalItens = pedido.itens.reduce((s, i) => s + i.quantidade, 0);
  const isSeparando = pedido.status === "separando";
  const isPendente = pedido.status === "pendente";

  // Carrega dados da expedição ao expandir (uma vez por card)
  useEffect(() => {
    if (!expanded || loadedRef.current) return;
    loadedRef.current = true;
    setLoadingLotes(true);

    async function load() {
      const result: Record<string, StockItemExpedicao> = {};
      const inicialSel: LoteSelecao = {};

      for (const item of pedido.itens) {
        const { data: siData } = await supabase
          .from("stock_items")
          .select("device_id, quantity, fase")
          .eq("id", item.stock_item_id)
          .single();

        let expedicaoItemId = item.stock_item_id;
        let expQty = (siData as { quantity: number } | null)?.quantity ?? 0;

        if (siData && (siData as { fase: string }).fase !== "expedicao") {
          const { data: expItem } = await supabase
            .from("stock_items")
            .select("id, quantity")
            .eq("device_id", (siData as { device_id: string }).device_id)
            .eq("fase", "expedicao")
            .single();
          if (expItem) {
            expedicaoItemId = (expItem as { id: string }).id;
            expQty = (expItem as { quantity: number }).quantity ?? 0;
          }
        }

        // Calcular saldo por lote via movimentos
        const { data: movs } = await supabase
          .from("stock_movements")
          .select("lote, quantity, type")
          .eq("stock_item_id", expedicaoItemId)
          .not("lote", "is", null)
          .order("created_at", { ascending: false });

        const saldos: Record<string, number> = {};
        for (const mv of (movs ?? [])) {
          if (!mv.lote) continue;
          saldos[mv.lote] = (saldos[mv.lote] ?? 0) + (mv.type === "entrada" ? mv.quantity : -mv.quantity);
        }

        let lotesList: LoteDisponivel[] = Object.entries(saldos)
          .filter(([, qty]) => qty > 0)
          .map(([lote, quantity]) => ({ lote, quantity, stock_item_id: expedicaoItemId }));

        if (lotesList.length === 0 && expQty > 0) {
          lotesList = [{ lote: "Sem lote", quantity: expQty, stock_item_id: expedicaoItemId }];
        }

        result[item.id] = { stock_item_id: expedicaoItemId, quantity: expQty, lotes: lotesList, loading: false };

        // Pré-seleciona distribuindo quantidade pedida entre lotes disponíveis
        const dist: Record<string, number> = {};
        let restante = item.quantidade;
        for (const l of lotesList) {
          if (restante <= 0) break;
          const usar = Math.min(l.quantity, restante);
          dist[l.lote] = usar;
          restante -= usar;
        }
        inicialSel[item.id] = dist;
      }

      setExpedicaoData(result);
      setLotesSel(inicialSel);
      setLoadingLotes(false);
    }

    load();
  }, [expanded, pedido]);

  function setQtyLote(itemId: string, lote: string, qty: number, maxQty: number) {
    setLotesSel(prev => {
      const atual = { ...(prev[itemId] ?? {}) };
      if (qty <= 0) { delete atual[lote]; }
      else { atual[lote] = Math.min(qty, maxQty); }
      return { ...prev, [itemId]: atual };
    });
  }

  function toggleLote(itemId: string, lote: string, maxQty: number) {
    setLotesSel(prev => {
      const atual = { ...(prev[itemId] ?? {}) };
      if (atual[lote]) { delete atual[lote]; }
      else { atual[lote] = Math.min(1, maxQty); }
      return { ...prev, [itemId]: atual };
    });
  }

  function totalSel(itemId: string) {
    return Object.values(lotesSel[itemId] ?? {}).reduce((s, q) => s + q, 0);
  }

  const canConfirmar = isPendente && pedido.itens.every(item => {
    const exp = expedicaoData[item.id];
    if (!exp || exp.lotes.length === 0) return true;
    return totalSel(item.id) === item.quantidade;
  });

  const canSalvarSep = isSeparando && !loadingLotes && pedido.itens.every(item => {
    const exp = expedicaoData[item.id];
    if (!exp || exp.lotes.length === 0) return true;
    return totalSel(item.id) === item.quantidade;
  });

  return (
    <div className={cn(
      "rounded-2xl border overflow-hidden transition-all",
      isPendente    ? "border-amber-500/25 bg-amber-500/3" :
      isSeparando   ? "border-blue-500/25 bg-blue-500/3" :
      pedido.status === "pronto" ? "border-emerald-500/25 bg-emerald-500/3" :
      "border-border/30 bg-card"
    )}>
      {/* Header — sempre visível */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full text-left px-4 py-3 flex items-start gap-3"
      >
        <div className={cn(
          "h-9 w-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5",
          isPendente ? "bg-amber-500/10" : isSeparando ? "bg-blue-500/10" : "bg-muted/30"
        )}>
          <ShoppingBag className={cn(
            "h-4 w-4",
            isPendente ? "text-amber-500" : isSeparando ? "text-blue-500" : "text-muted-foreground"
          )} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold truncate">{pedido.cliente_nome}</span>
            <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", statusColor(pedido.status))}>
              {statusLabel(pedido.status)}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {pedido.vendedora_nome && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <User className="h-2.5 w-2.5" />{pedido.vendedora_nome}
              </span>
            )}
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Package className="h-2.5 w-2.5" />{totalItens} un.
            </span>
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground/60">
              <Clock className="h-2.5 w-2.5" />{fmtDate(pedido.created_at)}
            </span>
          </div>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0 mt-2" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 mt-2" />}
      </button>

      {/* Expandido */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/20 pt-3">

          {/* Lista de peças do pedido */}
          <div className="space-y-2">
            {loadingLotes && (
              <div className="flex items-center justify-center py-4">
                <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
              </div>
            )}

            {!loadingLotes && pedido.itens.map(item => {
              const exp = expedicaoData[item.id];
              const totalNaExpedicao = exp?.quantity ?? 0;
              const lotes = exp?.lotes ?? [];
              const semEstoque = lotes.length === 0;
              const selTotal = totalSel(item.id);
              const itemOk = selTotal === item.quantidade;

              return (
                <div
                  key={item.id}
                  className={cn(
                    "rounded-xl border p-3 space-y-2.5 transition-colors",
                    semEstoque && isPendente
                      ? "border-destructive/30 bg-destructive/5"
                      : itemOk && isPendente
                        ? "border-emerald-500/25 bg-emerald-500/4"
                        : "border-border/30 bg-background/50"
                  )}
                >
                  {/* Cabeçalho da peça */}
                  <div className="flex items-start gap-2">
                    <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-semibold truncate">{item.device_model}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{item.device_reference}</p>
                    </div>

                    {/* Qtd pedida / total na expedição */}
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Pedido */}
                      <div className="flex flex-col items-end">
                        <span className="text-[10px] text-muted-foreground/60 leading-none">pedido</span>
                        <span className="text-[13px] font-bold text-foreground">{item.quantidade} un.</span>
                      </div>
                      {/* Separador */}
                      <ArrowRight className="h-3 w-3 text-muted-foreground/40" />
                      {/* Na expedição */}
                      <div className="flex flex-col items-end">
                        <span className="text-[10px] text-muted-foreground/60 leading-none">expedição</span>
                        <span className={cn(
                          "text-[13px] font-bold",
                          totalNaExpedicao === 0 ? "text-destructive" :
                          totalNaExpedicao < item.quantidade ? "text-amber-500" :
                          "text-emerald-500"
                        )}>{totalNaExpedicao} un.</span>
                      </div>

                      {/* Editar qty (pendente) */}
                      {isPendente && (
                        <button
                          type="button"
                          title="Editar quantidade"
                          onClick={e => { e.stopPropagation(); onEditarItem(pedido, item); }}
                          className="h-6 w-6 flex items-center justify-center rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 transition-colors ml-1"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Seleção de lotes — só mostra em pedidos pendentes */}
                  {isPendente && (
                    <>
                      {semEstoque ? (
                        <div className="flex items-center gap-1.5 text-[11px] text-destructive">
                          <AlertTriangle className="h-3 w-3" />
                          Sem estoque disponível na expedição
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Lotes disponíveis</p>
                            <span className={cn(
                              "ml-auto text-[10px] font-bold",
                              itemOk ? "text-emerald-500" : selTotal > 0 ? "text-amber-500" : "text-muted-foreground"
                            )}>
                              {selTotal}/{item.quantidade} selecionados
                            </span>
                          </div>
                          {lotes.map(l => {
                            const isSel = !!(lotesSel[item.id]?.[l.lote]);
                            const qtySel = lotesSel[item.id]?.[l.lote] ?? 0;
                            return (
                              <div
                                key={l.lote}
                                className={cn(
                                  "flex items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors",
                                  isSel ? "bg-blue-500/8 border-blue-500/30" : "bg-muted/20 border-border/20"
                                )}
                              >
                                <button
                                  type="button"
                                  onClick={() => toggleLote(item.id, l.lote, l.quantity)}
                                  className={cn(
                                    "h-4 w-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
                                    isSel ? "bg-blue-500 border-blue-500" : "border-muted-foreground/40"
                                  )}
                                >
                                  {isSel && <CheckCircle2 className="h-3 w-3 text-white" />}
                                </button>
                                <div className="flex-1 min-w-0">
                                  <p className="text-[11px] font-mono font-semibold">{l.lote}</p>
                                  <p className="text-[10px] text-muted-foreground">{l.quantity} disponíveis</p>
                                </div>
                                {isSel && (
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => setQtyLote(item.id, l.lote, qtySel - 1, l.quantity)}
                                      className="h-6 w-6 rounded bg-muted/40 hover:bg-muted flex items-center justify-center text-muted-foreground"
                                    >
                                      <Minus className="h-3 w-3" />
                                    </button>
                                    <input
                                      type="number"
                                      min={1}
                                      max={l.quantity}
                                      value={qtySel}
                                      onChange={e => setQtyLote(item.id, l.lote, parseInt(e.target.value) || 0, l.quantity)}
                                      className="w-10 text-center text-[12px] font-bold bg-transparent border border-border/40 rounded h-6 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => setQtyLote(item.id, l.lote, qtySel + 1, l.quantity)}
                                      className="h-6 w-6 rounded bg-muted/40 hover:bg-muted flex items-center justify-center text-muted-foreground"
                                    >
                                      <Plus className="h-3 w-3" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {!itemOk && selTotal > 0 && (
                            <p className="text-[11px] text-amber-600 flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              {selTotal < item.quantidade
                                ? `Faltam ${item.quantidade - selTotal} un.`
                                : `Excesso de ${selTotal - item.quantidade} un.`}
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {/* Status separando: mesma UI de seleção de lotes, editável */}
                  {isSeparando && (
                    <>
                      {lotes.length === 0 ? (
                        <div className="flex items-center gap-1.5 text-[11px] text-destructive">
                          <AlertTriangle className="h-3 w-3" />
                          Sem estoque disponível na expedição
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Lotes — escolha o que será enviado</p>
                            <span className={cn(
                              "ml-auto text-[10px] font-bold",
                              selTotal === item.quantidade ? "text-blue-500" : selTotal > 0 ? "text-amber-500" : "text-muted-foreground"
                            )}>
                              {selTotal}/{item.quantidade} selecionados
                            </span>
                          </div>
                          {lotes.map(l => {
                            const isSel = !!(lotesSel[item.id]?.[l.lote]);
                            const qtySel = lotesSel[item.id]?.[l.lote] ?? 0;
                            return (
                              <div
                                key={l.lote}
                                className={cn(
                                  "flex items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors",
                                  isSel ? "bg-blue-500/8 border-blue-500/30" : "bg-muted/20 border-border/20"
                                )}
                              >
                                <button
                                  type="button"
                                  onClick={() => toggleLote(item.id, l.lote, l.quantity)}
                                  className={cn(
                                    "h-4 w-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
                                    isSel ? "bg-blue-500 border-blue-500" : "border-muted-foreground/40"
                                  )}
                                >
                                  {isSel && <CheckCircle2 className="h-3 w-3 text-white" />}
                                </button>
                                <div className="flex-1 min-w-0">
                                  <p className="text-[11px] font-mono font-semibold">{l.lote}</p>
                                  <p className="text-[10px] text-muted-foreground">{l.quantity} disponíveis</p>
                                </div>
                                {isSel && (
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => setQtyLote(item.id, l.lote, qtySel - 1, l.quantity)}
                                      className="h-6 w-6 rounded bg-muted/40 hover:bg-muted flex items-center justify-center text-muted-foreground"
                                    >
                                      <Minus className="h-3 w-3" />
                                    </button>
                                    <input
                                      type="number"
                                      min={1}
                                      max={l.quantity}
                                      value={qtySel}
                                      onChange={e => setQtyLote(item.id, l.lote, parseInt(e.target.value) || 0, l.quantity)}
                                      className="w-10 text-center text-[12px] font-bold bg-transparent border border-border/40 rounded h-6 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => setQtyLote(item.id, l.lote, qtySel + 1, l.quantity)}
                                      className="h-6 w-6 rounded bg-muted/40 hover:bg-muted flex items-center justify-center text-muted-foreground"
                                    >
                                      <Plus className="h-3 w-3" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {selTotal !== item.quantidade && selTotal > 0 && (
                            <p className="text-[11px] text-amber-600 flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              {selTotal < item.quantidade
                                ? `Faltam ${item.quantidade - selTotal} un.`
                                : `Excesso de ${selTotal - item.quantidade} un.`}
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {pedido.observacoes && (
            <p className="text-[11px] text-muted-foreground italic px-1">"{pedido.observacoes}"</p>
          )}

          {/* Ações */}
          <div className="flex gap-2 pt-1">
            {isPendente && (
              <button
                type="button"
                onClick={() => onIniciarSeparacao(pedido, lotesSel)}
                disabled={!canConfirmar || loadingLotes}
                className="flex-1 h-9 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 text-[12px] font-semibold transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none"
              >
                <PackageCheck className="h-3.5 w-3.5" />
                Iniciar Separação
              </button>
            )}
            {isSeparando && (
              <button
                type="button"
                onClick={() => onMarcarPronto(pedido)}
                className="flex-1 h-9 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 text-[12px] font-semibold transition-colors flex items-center justify-center gap-1.5"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Marcar como Pronto
              </button>
            )}
            {pedido.status === "pronto" && (
              <div className="flex-1 h-9 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-emerald-600 text-[12px] font-medium flex items-center justify-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Aguardando Nota Fiscal
              </div>
            )}
            {(isPendente || isSeparando) && isAdmin && (
              <button
                type="button"
                onClick={() => onCancelar(pedido)}
                className="h-9 w-9 rounded-xl bg-destructive/5 hover:bg-destructive/15 text-destructive flex items-center justify-center transition-colors"
                title="Cancelar pedido"
              >
                <Ban className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Modal de Separação de Lotes ──────────────────────────────────────────────

interface SepararLotesModalProps {
  pedido: Pedido | null;
  onClose: () => void;
  onSuccess: () => void;
}

function SepararLotesModal({ pedido, onClose, onSuccess }: SepararLotesModalProps) {
  const { user } = useAuth();

  // Para cada item do pedido: mapa de lote → quantidade escolhida
  const [lotesSelecionados, setLotesSelecionados] = useState<Record<string, Record<string, number>>>({});
  const [lotesDisponiveis, setLotesDisponiveis] = useState<Record<string, LoteDisponivel[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!pedido) return;
    setLoading(true);
    setSaved(false);

    async function loadLotes() {
      if (!pedido) return;
      const result: Record<string, LoteDisponivel[]> = {};

      for (const item of pedido.itens) {
        const { data: siData } = await supabase
          .from("stock_items")
          .select("device_id, quantity, fase")
          .eq("id", item.stock_item_id)
          .single();

        if (!siData) { result[item.id] = []; continue; }

        let expedicaoItemId = item.stock_item_id;
        if ((siData as { fase: string }).fase !== "expedicao") {
          const { data: expItem } = await supabase
            .from("stock_items")
            .select("id, quantity")
            .eq("device_id", (siData as { device_id: string }).device_id)
            .eq("fase", "expedicao")
            .single();
          if (!expItem) { result[item.id] = []; continue; }
          expedicaoItemId = (expItem as { id: string }).id;
        }

        const { data: movs } = await supabase
          .from("stock_movements")
          .select("lote, quantity, type")
          .eq("stock_item_id", expedicaoItemId)
          .not("lote", "is", null)
          .order("created_at", { ascending: false });

        const saldos: Record<string, number> = {};
        for (const mv of (movs ?? [])) {
          if (!mv.lote) continue;
          saldos[mv.lote] = (saldos[mv.lote] ?? 0) + (mv.type === "entrada" ? mv.quantity : -mv.quantity);
        }

        const lotesList = Object.entries(saldos)
          .filter(([, qty]) => qty > 0)
          .map(([lote, quantity]) => ({ lote, quantity, stock_item_id: expedicaoItemId }));

        if (lotesList.length === 0) {
          const { data: expItem2 } = await supabase
            .from("stock_items")
            .select("quantity")
            .eq("id", expedicaoItemId)
            .single();
          const qty = (expItem2 as { quantity: number } | null)?.quantity ?? 0;
          if (qty > 0) lotesList.push({ lote: "Sem lote", quantity: qty, stock_item_id: expedicaoItemId });
        }

        result[item.id] = lotesList;
      }

      setLotesDisponiveis(result);

      // Pré-seleciona: distribui a quantidade pedida entre os lotes disponíveis
      const inicial: Record<string, Record<string, number>> = {};
      for (const item of pedido.itens) {
        const lotes = result[item.id] ?? [];
        const dist: Record<string, number> = {};
        let restante = item.quantidade;
        for (const l of lotes) {
          if (restante <= 0) break;
          const usar = Math.min(l.quantity, restante);
          dist[l.lote] = usar;
          restante -= usar;
        }
        inicial[item.id] = dist;
      }
      setLotesSelecionados(inicial);
      setLoading(false);
    }

    loadLotes();
  }, [pedido]);

  function setQtyLote(itemId: string, lote: string, qty: number, maxQty: number) {
    setLotesSelecionados(prev => {
      const atual = { ...(prev[itemId] ?? {}) };
      if (qty <= 0) {
        delete atual[lote];
      } else {
        atual[lote] = Math.min(qty, maxQty);
      }
      return { ...prev, [itemId]: atual };
    });
  }

  function toggleLote(itemId: string, lote: string, maxQty: number) {
    setLotesSelecionados(prev => {
      const atual = { ...(prev[itemId] ?? {}) };
      if (atual[lote]) {
        delete atual[lote];
      } else {
        atual[lote] = Math.min(1, maxQty);
      }
      return { ...prev, [itemId]: atual };
    });
  }

  function totalSelecionado(itemId: string) {
    return Object.values(lotesSelecionados[itemId] ?? {}).reduce((s, q) => s + q, 0);
  }

  async function handleConfirmar() {
    if (!pedido || !user) return;
    setSaving(true);

    // Snapshot com todos os lotes e quantidades escolhidas
    const snapshot = pedido.itens.flatMap(item => {
      const sel = lotesSelecionados[item.id] ?? {};
      return Object.entries(sel).flatMap(([lote, quantidade]) =>
        item.ids.map(pid => ({
          pedido_item_id: pid,
          stock_item_id: item.stock_item_id,
          lote,
          quantidade: quantidade / item.ids.length,
          device_model: item.device_model,
        }))
      );
    });

    const { error } = await supabase
      .from("pedidos_comerciais")
      .update({
        status: "separando",
        lotes_separados: snapshot,
        separado_por: user.id,
        separado_em: new Date().toISOString(),
      })
      .eq("id", pedido.id);

    if (error) { setSaving(false); toast.error("Erro ao iniciar separação."); return; }

    setSaving(false);
    setSaved(true);
    toast.success("Separação iniciada! Peças reservadas.");
    onClose();
    onSuccess();
  }

  if (!pedido) return null;

  // Valida: todos os itens com estoque devem ter total selecionado === quantidade pedida
  const canConfirm = pedido.itens.every(item => {
    const disponiveis = lotesDisponiveis[item.id] ?? [];
    if (disponiveis.length === 0) return true; // sem estoque, deixa passar com aviso
    return totalSelecionado(item.id) === item.quantidade;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-card border border-border/30 shadow-xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in slide-in-from-bottom-4 duration-200">
        <div className="px-5 pt-5 pb-3 border-b border-border/20">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <PackageCheck className="h-4 w-4 text-blue-500" />
                <p className="text-sm font-semibold">Separar Lotes</p>
              </div>
              <p className="text-[12px] text-muted-foreground mt-0.5">{pedido.cliente_nome}</p>
            </div>
            <button type="button" onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full" />
            </div>
          ) : pedido.itens.map(item => {
            const disponiveis = lotesDisponiveis[item.id] ?? [];
            const sel = lotesSelecionados[item.id] ?? {};
            const total = totalSelecionado(item.id);
            const semEstoque = disponiveis.length === 0;
            const ok = total === item.quantidade;

            return (
              <div key={item.id} className={cn(
                "rounded-xl border p-3 space-y-2.5",
                semEstoque ? "border-destructive/30 bg-destructive/5"
                  : ok ? "border-success/30 bg-success/5"
                  : "border-border/30 bg-background/60"
              )}>
                {/* Cabeçalho do item */}
                <div className="flex items-start gap-2">
                  <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold truncate">{item.device_model}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{item.device_reference}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className={cn("text-[12px] font-bold", ok ? "text-success" : total > 0 ? "text-amber-500" : "text-muted-foreground")}>
                      {total}
                    </span>
                    <span className="text-[10px] text-muted-foreground">/ {item.quantidade} un.</span>
                  </div>
                </div>

                {semEstoque ? (
                  <div className="flex items-center gap-1.5 text-[11px] text-destructive">
                    <AlertTriangle className="h-3 w-3" />
                    Sem estoque disponível na expedição
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Lotes disponíveis</p>
                    {disponiveis.map(l => {
                      const isSelected = !!sel[l.lote];
                      const qtySelected = sel[l.lote] ?? 0;
                      return (
                        <div key={l.lote} className={cn(
                          "flex items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors",
                          isSelected ? "bg-blue-500/8 border-blue-500/30" : "bg-muted/20 border-border/20"
                        )}>
                          {/* Toggle lote */}
                          <button
                            type="button"
                            onClick={() => toggleLote(item.id, l.lote, l.quantity)}
                            className={cn(
                              "h-4 w-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
                              isSelected ? "bg-blue-500 border-blue-500" : "border-muted-foreground/40"
                            )}
                          >
                            {isSelected && <CheckCircle2 className="h-3 w-3 text-white" />}
                          </button>

                          {/* Nome do lote + saldo */}
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-mono font-semibold text-foreground">{l.lote}</p>
                            <p className="text-[10px] text-muted-foreground">{l.quantity} disponíveis</p>
                          </div>

                          {/* Input de quantidade */}
                          {isSelected && (
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => setQtyLote(item.id, l.lote, qtySelected - 1, l.quantity)}
                                className="h-6 w-6 rounded bg-muted/40 hover:bg-muted flex items-center justify-center text-muted-foreground"
                              >
                                <Minus className="h-3 w-3" />
                              </button>
                              <input
                                type="number"
                                min={1}
                                max={l.quantity}
                                value={qtySelected}
                                onChange={e => setQtyLote(item.id, l.lote, parseInt(e.target.value) || 0, l.quantity)}
                                className="w-10 text-center text-[12px] font-bold bg-transparent border border-border/40 rounded h-6 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                              <button
                                type="button"
                                onClick={() => setQtyLote(item.id, l.lote, qtySelected + 1, l.quantity)}
                                className="h-6 w-6 rounded bg-muted/40 hover:bg-muted flex items-center justify-center text-muted-foreground"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {!ok && total > 0 && (
                      <p className="text-[11px] text-amber-600 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        {total < item.quantidade
                          ? `Faltam ${item.quantidade - total} un. para completar o pedido`
                          : `Excesso de ${total - item.quantidade} un.`}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="px-5 pb-5 pt-3 border-t border-border/20">
          <button
            type="button"
            onClick={handleConfirmar}
            disabled={saving || loading || saved || !canConfirm}
            className="w-full h-10 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : saved ? <CheckCircle2 className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
            {saved ? "Confirmado!" : "Confirmar e Reservar Peças"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal Editar Quantidade de Item do Pedido Pendente ───────────────────────

interface EditarItemModalProps {
  pedido: Pedido | null;
  item: PedidoItem | null;
  onClose: () => void;
  onSuccess: () => void;
}

function EditarItemModal({ pedido, item, onClose, onSuccess }: EditarItemModalProps) {
  const [qtd, setQtd] = useState(1);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (item) setQtd(item.quantidade);
    else setQtd(1);
  }, [item]);

  async function handleSalvar() {
    if (!item || qtd < 1) return;
    setSaving(true);
    // Se há múltiplos itens unificados, distribuímos a nova quantidade entre eles
    const count = item.ids.length;
    const base = Math.floor(qtd / count);
    const remainder = qtd % count;
    let hasError = false;
    for (let i = 0; i < item.ids.length; i++) {
      const novaQtd = base + (i < remainder ? 1 : 0);
      const { error } = await supabase
        .from("pedido_itens")
        .update({ quantidade: novaQtd })
        .eq("id", item.ids[i]);
      if (error) { hasError = true; break; }
    }
    setSaving(false);
    if (hasError) { toast.error("Erro ao atualizar quantidade."); return; }
    toast.success("Quantidade atualizada!");
    onSuccess();
    onClose();
  }

  if (!pedido || !item) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-card border border-border/30 shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/30">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-amber-500" />
            <p className="text-sm font-semibold">Editar Quantidade</p>
          </div>
          <button type="button" onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Info da peça */}
          <div className="rounded-xl bg-muted/20 border border-border/20 px-4 py-3">
            <p className="text-[13px] font-semibold">{item.device_model}</p>
            <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{item.device_reference}</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">Pedido de {pedido.cliente_nome}</p>
          </div>

          {/* Quantidade */}
          <div className="space-y-2">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Nova quantidade</label>
            <div className="flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => setQtd(q => Math.max(1, q - 1))}
                className="h-10 w-10 rounded-xl bg-muted/30 hover:bg-muted/60 flex items-center justify-center transition-colors"
              >
                <Minus className="h-4 w-4" />
              </button>
              <input
                type="number"
                min={1}
                value={qtd}
                onChange={e => setQtd(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-20 text-center text-[22px] font-bold bg-transparent border border-border/40 rounded-xl h-12 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button
                type="button"
                onClick={() => setQtd(q => q + 1)}
                className="h-10 w-10 rounded-xl bg-muted/30 hover:bg-muted/60 flex items-center justify-center transition-colors"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            {qtd !== item.quantidade && (
              <p className="text-center text-[11px] text-muted-foreground">
                Era <strong>{item.quantidade}</strong> → ficará <strong>{qtd}</strong> un.
              </p>
            )}
          </div>

          {/* Botões */}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 h-10 rounded-xl border border-border/30 text-[12px] font-medium text-muted-foreground hover:bg-muted/30 transition-colors">
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSalvar}
              disabled={saving || qtd === item.quantidade}
              className="flex-1 h-10 rounded-xl bg-amber-500 hover:bg-amber-500/90 text-white text-[12px] font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-1.5"
            >
              {saving
                ? <div className="h-3.5 w-3.5 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />
                : null}
              Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SearchBar isolada (uncontrolled) ─────────────────────────────────────────

interface SearchBarPedidosProps {
  onSearch: (value: string) => void;
  onClear: () => void;
  hasValue: boolean;
}

const SearchBarPedidos = memo(function SearchBarPedidos({ onSearch, onClear, hasValue }: SearchBarPedidosProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onSearch(v.trim()), 300);
  }

  function handleClear() {
    if (inputRef.current) inputRef.current.value = "";
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onClear();
  }

  return (
    <div className="relative flex-1">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      <input
        ref={inputRef}
        defaultValue=""
        type="text"
        placeholder="Buscar por cliente ou vendedora..."
        onChange={handleChange}
        className="flex h-9 w-full rounded-xl border border-input bg-background px-3 py-2 pl-9 pr-8 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      />
      {hasValue && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
});

// ─── Painel Principal ─────────────────────────────────────────────────────────

interface PedidosEstoquePanelProps {
  isAdmin: boolean;
}

export function PedidosEstoquePanel({ isAdmin }: PedidosEstoquePanelProps) {
  const { user } = useAuth();
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroStatus] = useState<string>("separando_pronto");
  const [searchQuery, setSearchQuery] = useState("");
  const [hasSearch, setHasSearch] = useState(false);
  const [cancelarPedido, setCancelarPedido] = useState<Pedido | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [editarItem, setEditarItem] = useState<{ pedido: Pedido; item: PedidoItem } | null>(null);

  async function handleIniciarSeparacao(pedido: Pedido, lotesSelecionados: LoteSelecao) {
    if (!user) return;
    const snapshot = pedido.itens.flatMap(item => {
      const sel = lotesSelecionados[item.id] ?? {};
      return Object.entries(sel).flatMap(([lote, quantidade]) =>
        item.ids.map(pid => ({
          pedido_item_id: pid,
          stock_item_id: item.stock_item_id,
          lote,
          quantidade: quantidade / item.ids.length, // distribui proporcionalmente
          device_model: item.device_model,
        }))
      );
    });
    const { error } = await supabase
      .from("pedidos_comerciais")
      .update({
        status: "separando",
        lotes_separados: snapshot,
        separado_por: user.id,
        separado_em: new Date().toISOString(),
      })
      .eq("id", pedido.id);
    if (error) { toast.error("Erro ao iniciar separação."); return; }
    toast.success("Separação iniciada! Peças reservadas.");
    loadPedidos();
  }

  const loadPedidos = useCallback(async () => {
    setLoading(true);
    const query = supabase
      .from("pedidos_comerciais")
      .select(`
        id, cliente_id, vendedora_id, vendedora_nome, status, frete, observacoes,
        created_at, lotes_separados, separado_em,
        clientes!inner(nome),
        pedido_itens(
          id, stock_item_id, lote, quantidade,
          stock_items!inner(
            stock_item_id:id,
            devices!inner(model, reference)
          )
        )
      `)
      .order("created_at", { ascending: false });

    const { data, error } = await query;

    if (error || !data) { setLoading(false); return; }

    const mapped: Pedido[] = data.map((p: Record<string, unknown>) => ({
      id: p.id as string,
      cliente_nome: (p.clientes as { nome: string }).nome,
      vendedora_nome: p.vendedora_nome as string | null,
      vendedora_id: p.vendedora_id as string | null,
      status: p.status as string,
      frete: (p.frete as number) ?? 0,
      observacoes: p.observacoes as string | null,
      created_at: p.created_at as string,
      itens: (() => {
        const raw = ((p.pedido_itens as Record<string, unknown>[]) ?? []).map((i: Record<string, unknown>) => ({
          id: i.id as string,
          ids: [i.id as string],
          stock_item_id: i.stock_item_id as string,
          lote: i.lote as string,
          quantidade: i.quantidade as number,
          device_model: ((i.stock_items as { devices: { model: string; reference: string } } | null)?.devices?.model),
          device_reference: ((i.stock_items as { devices: { model: string; reference: string } } | null)?.devices?.reference),
        }));
        // Unifica itens com o mesmo stock_item_id somando quantidades
        const merged: Record<string, typeof raw[0]> = {};
        for (const item of raw) {
          if (merged[item.stock_item_id]) {
            merged[item.stock_item_id].quantidade += item.quantidade;
            merged[item.stock_item_id].ids.push(item.id);
          } else {
            merged[item.stock_item_id] = { ...item };
          }
        }
        return Object.values(merged);
      })(),
    }));

    setPedidos(mapped);
    setLoading(false);
  }, []);

  useEffect(() => { loadPedidos(); }, [loadPedidos]);


  const filtrados = pedidos.filter(p => {
    const matchStatus = p.status === "separando" || p.status === "pronto";
    if (!matchStatus) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.cliente_nome.toLowerCase().includes(q) ||
      (p.vendedora_nome ?? "").toLowerCase().includes(q)
    );
  });


  async function handleSalvarSeparacao(pedido: Pedido, lotesSelecionados: LoteSelecao) {
    if (!user) return;
    const snapshot = pedido.itens.flatMap(item => {
      const sel = lotesSelecionados[item.id] ?? {};
      return Object.entries(sel).flatMap(([lote, quantidade]) =>
        item.ids.map(pid => ({
          pedido_item_id: pid,
          stock_item_id: item.stock_item_id,
          lote,
          quantidade: quantidade / item.ids.length,
          device_model: item.device_model,
        }))
      );
    });
    // Atualiza lote em cada pedido_item (incluindo duplicatas unificadas)
    for (const item of pedido.itens) {
      const sel = lotesSelecionados[item.id] ?? {};
      const lotePrincipal = Object.keys(sel)[0] ?? null;
      for (const itemId of item.ids) {
        await supabase.from("pedido_itens").update({ lote: lotePrincipal }).eq("id", itemId);
      }
    }
    const { error } = await supabase
      .from("pedidos_comerciais")
      .update({ lotes_separados: snapshot })
      .eq("id", pedido.id);
    if (error) { toast.error("Erro ao salvar lotes."); return; }
    toast.success("Lotes da separação salvos!");
    loadPedidos();
  }

  async function handleMarcarPronto(pedido: Pedido) {
    if (!user) return;

    // Retirar peças da expedição e liberar reserva
    for (const item of pedido.itens) {
      const { data: si } = await supabase
        .from("stock_items")
        .select("id, quantity, quantity_reserved, device_id, fase")
        .eq("id", item.stock_item_id)
        .single();

      let expItemId = item.stock_item_id;
      let currentQty = (si as { quantity: number } | null)?.quantity ?? 0;
      let currentReserved = (si as { quantity_reserved: number } | null)?.quantity_reserved ?? 0;

      if (si && (si as { fase: string }).fase !== "expedicao") {
        const { data: expSi } = await supabase
          .from("stock_items")
          .select("id, quantity, quantity_reserved")
          .eq("device_id", (si as { device_id: string }).device_id)
          .eq("fase", "expedicao")
          .single();
        if (expSi) {
          expItemId = (expSi as { id: string }).id;
          currentQty = (expSi as { quantity: number }).quantity ?? 0;
          currentReserved = (expSi as { quantity_reserved: number }).quantity_reserved ?? 0;
        }
      }

      const novaQtd = Math.max(0, currentQty - item.quantidade);
      const novaReserva = Math.max(0, currentReserved - item.quantidade);

      await supabase.from("stock_items").update({
        quantity: novaQtd,
        quantity_reserved: novaReserva,
      }).eq("id", expItemId);

      // Registrar saída
      await supabase.from("stock_movements").insert({
        stock_item_id: expItemId,
        type: "saida",
        quantity: item.quantidade,
        lote: item.lote ?? null,
        reason: `Pedido comercial — cliente: ${pedido.cliente_nome} (separação concluída)`,
        user_display_name: pedido.vendedora_nome ?? "Estoque",
      });
    }

    const { error } = await supabase
      .from("pedidos_comerciais")
      .update({ status: "pronto" })
      .eq("id", pedido.id);

    if (error) { toast.error("Erro ao marcar como pronto."); return; }
    toast.success("Pedido marcado como pronto! Peças retiradas da expedição.");
    loadPedidos();
  }

  async function handleCancelar() {
    if (!cancelarPedido) return;
    setCancelando(true);

    // Se estava separando, libera as reservas
    if (cancelarPedido.status === "separando") {
      for (const item of cancelarPedido.itens) {
        const { data: si } = await supabase
          .from("stock_items")
          .select("id, quantity_reserved, device_id, fase")
          .eq("id", item.stock_item_id)
          .single();

        let expItemId = item.stock_item_id;
        let currentReserved = (si as { quantity_reserved: number } | null)?.quantity_reserved ?? 0;

        if (si && (si as { fase: string }).fase !== "expedicao") {
          const { data: expSi } = await supabase
            .from("stock_items")
            .select("id, quantity_reserved")
            .eq("device_id", (si as { device_id: string }).device_id)
            .eq("fase", "expedicao")
            .single();
          if (expSi) {
            expItemId = (expSi as { id: string }).id;
            currentReserved = (expSi as { quantity_reserved: number }).quantity_reserved ?? 0;
          }
        }

        await supabase
          .from("stock_items")
          .update({ quantity_reserved: Math.max(0, currentReserved - item.quantidade) })
          .eq("id", expItemId);
      }
    }

    const { error } = await supabase
      .from("pedidos_comerciais")
      .update({ status: "cancelado" })
      .eq("id", cancelarPedido.id);
    setCancelando(false);
    if (error) { toast.error("Erro ao cancelar."); return; }
    toast.success("Pedido cancelado. Reservas liberadas.");
    setCancelarPedido(null);
    loadPedidos();
  }

  return (
    <div className="space-y-4">
      {/* Busca + Atualizar */}
      <div className="flex items-center gap-2">
        <SearchBarPedidos
          onSearch={v => { setSearchQuery(v); setHasSearch(!!v); }}
          onClear={() => { setSearchQuery(""); setHasSearch(false); }}
          hasValue={hasSearch}
        />
        <button
          type="button"
          onClick={loadPedidos}
          className="h-9 w-9 flex items-center justify-center rounded-full bg-muted/30 border border-border/40 text-muted-foreground hover:bg-muted/60 transition-colors shrink-0"
          title="Atualizar"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : filtrados.length === 0 ? (
        <div className="text-center py-16 space-y-2">
          <ShoppingBag className="h-10 w-10 text-muted-foreground/30 mx-auto" />
          <p className="text-sm text-muted-foreground">Nenhum pedido encontrado</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtrados.map(pedido => (
            <PedidoCard
              key={pedido.id}
              pedido={pedido}
              onIniciarSeparacao={handleIniciarSeparacao}
              onSalvarSeparacao={handleSalvarSeparacao}
              onMarcarPronto={handleMarcarPronto}
              onCancelar={setCancelarPedido}
              onEditarItem={(pedido, item) => setEditarItem({ pedido, item })}
              isAdmin={isAdmin}
            />
          ))}
        </div>
      )}

      {/* Modal editar quantidade de item pendente */}
      <EditarItemModal
        pedido={editarItem?.pedido ?? null}
        item={editarItem?.item ?? null}
        onClose={() => setEditarItem(null)}
        onSuccess={loadPedidos}
      />

      {/* Cancelar pedido */}
      {cancelarPedido && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-card border border-border/30 p-5 space-y-4 shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-200">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
                <Ban className="h-4 w-4 text-destructive" />
              </div>
              <div>
                <p className="text-sm font-semibold">Cancelar pedido?</p>
                <p className="text-[12px] text-muted-foreground mt-0.5">{cancelarPedido.cliente_nome}</p>
              </div>
            </div>
            <p className="text-[12px] text-muted-foreground">As peças reservadas serão devolvidas ao estoque da expedição.</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setCancelarPedido(null)} disabled={cancelando} className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors">Voltar</button>
              <button type="button" onClick={handleCancelar} disabled={cancelando} className="flex-1 h-9 rounded-xl bg-destructive text-destructive-foreground text-sm font-semibold hover:bg-destructive/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5">
                {cancelando ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                Cancelar pedido
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
