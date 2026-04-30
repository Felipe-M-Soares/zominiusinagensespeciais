/**
 * PedidosEstoquePanel — Aba "Pedidos" dentro do Estoque
 *
 * Fluxo do estoque:
 *  1. Vê pedidos com status "pendente"
 *  2. Clica "Iniciar separação" → status vira "separando", peças ficam em reserva
 *  3. Escolhe lotes disponíveis na expedição para cada item
 *  4. Clica "Marcar como Pronto" → status vira "pronto", aguarda financeiro emitir NF
 */

import { useState, useEffect, useCallback } from "react";
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

interface PedidoCardProps {
  pedido: Pedido;
  onIniciarSeparacao: (pedido: Pedido) => void;
  onMarcarPronto: (pedido: Pedido) => void;
  onCancelar: (pedido: Pedido) => void;
  isAdmin: boolean;
}

function PedidoCard({ pedido, onIniciarSeparacao, onMarcarPronto, onCancelar, isAdmin }: PedidoCardProps) {
  const [expanded, setExpanded] = useState(false);
  const totalItens = pedido.itens.reduce((s, i) => s + i.quantidade, 0);

  return (
    <div className={cn(
      "rounded-2xl border overflow-hidden transition-all",
      pedido.status === "pendente" ? "border-amber-500/25 bg-amber-500/3" :
      pedido.status === "separando" ? "border-blue-500/25 bg-blue-500/3" :
      pedido.status === "pronto" ? "border-emerald-500/25 bg-emerald-500/3" :
      "border-border/30 bg-card"
    )}>
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full text-left px-4 py-3 flex items-start gap-3"
      >
        <div className="h-9 w-9 rounded-xl bg-muted/30 flex items-center justify-center shrink-0 mt-0.5">
          <ShoppingBag className="h-4 w-4 text-muted-foreground" />
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
            {pedido.frete > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Truck className="h-2.5 w-2.5" />R$ {pedido.frete.toFixed(2)}
              </span>
            )}
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
          {/* Itens */}
          <div className="space-y-1.5">
            {pedido.itens.map(item => (
              <div key={item.id} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-background/60 border border-border/20">
                <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium truncate">{item.device_model}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">{item.device_reference}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {item.lote && (
                    <span className="flex items-center gap-1 text-[10px] font-mono text-violet-500">
                      <Tag className="h-2.5 w-2.5" />{item.lote}
                    </span>
                  )}
                  <span className="text-[12px] font-bold text-foreground">{item.quantidade} un.</span>
                </div>
              </div>
            ))}
          </div>

          {pedido.observacoes && (
            <p className="text-[11px] text-muted-foreground italic px-1">"{pedido.observacoes}"</p>
          )}

          {/* Ações */}
          <div className="flex gap-2 pt-1">
            {pedido.status === "pendente" && (
              <button
                type="button"
                onClick={() => onIniciarSeparacao(pedido)}
                className="flex-1 h-9 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 text-[12px] font-semibold transition-colors flex items-center justify-center gap-1.5"
              >
                <PackageCheck className="h-3.5 w-3.5" />
                Iniciar Separação
              </button>
            )}
            {pedido.status === "separando" && (
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
            {(pedido.status === "pendente" || pedido.status === "separando") && isAdmin && (
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
  const [lotesEscolhidos, setLotesEscolhidos] = useState<Record<string, string>>({});
  const [lotesDisponiveis, setLotesDisponiveis] = useState<Record<string, LoteDisponivel[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!pedido) return;
    setLoading(true);

    async function loadLotes() {
      if (!pedido) return;
      const result: Record<string, LoteDisponivel[]> = {};

      for (const item of pedido.itens) {
        // 1. Descobre o device_id a partir do stock_item do pedido
        const { data: siData } = await supabase
          .from("stock_items")
          .select("device_id, quantity, fase")
          .eq("id", item.stock_item_id)
          .single();

        if (!siData) { result[item.id] = []; continue; }

        // 2. Se o item já é da expedição, usa ele; senão busca o da expedição
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

        // 3. Busca movimentos do stock_item de expedição com lote preenchido
        const { data: movs } = await supabase
          .from("stock_movements")
          .select("lote, quantity, type")
          .eq("stock_item_id", expedicaoItemId)
          .not("lote", "is", null)
          .order("created_at", { ascending: false });

        // 4. Calcula saldo por lote (entradas - saídas)
        const saldos: Record<string, number> = {};
        for (const mv of (movs ?? [])) {
          if (!mv.lote) continue;
          saldos[mv.lote] = (saldos[mv.lote] ?? 0) + (mv.type === "entrada" ? mv.quantity : -mv.quantity);
        }

        // 5. Se não houver movimentos com lote, usa a quantidade total do item
        const lotesList = Object.entries(saldos)
          .filter(([, qty]) => qty > 0)
          .map(([lote, quantity]) => ({ lote, quantity, stock_item_id: expedicaoItemId }));

        // Fallback: sem lotes registrados, mostra o saldo total como lote "Sem lote"
        if (lotesList.length === 0) {
          const { data: expItem2 } = await supabase
            .from("stock_items")
            .select("quantity")
            .eq("id", expedicaoItemId)
            .single();
          const qty = (expItem2 as { quantity: number } | null)?.quantity ?? 0;
          if (qty > 0) {
            lotesList.push({ lote: "Sem lote", quantity: qty, stock_item_id: expedicaoItemId });
          }
        }

        result[item.id] = lotesList;
      }

      setLotesDisponiveis(result);
      // Pre-seleciona o primeiro lote disponível para cada item
      const inicial: Record<string, string> = {};
      for (const item of pedido.itens) {
        const lotes = result[item.id];
        if (lotes && lotes.length > 0) inicial[item.id] = lotes[0].lote;
      }
      setLotesEscolhidos(inicial);
      setLoading(false);
    }

    loadLotes();
  }, [pedido]);

  async function handleConfirmar() {
    if (!pedido || !user) return;
    setSaving(true);

    // Monta snapshot dos lotes escolhidos
    const snapshot = pedido.itens.map(item => ({
      pedido_item_id: item.id,
      stock_item_id: item.stock_item_id,
      lote: lotesEscolhidos[item.id] ?? item.lote,
      quantidade: item.quantidade,
      device_model: item.device_model,
    }));

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

    // Reserva as quantidades em cada stock_item da expedição
    for (const item of pedido.itens) {
      // Determina o stock_item de expedição correto
      const { data: si } = await supabase
        .from("stock_items")
        .select("id, quantity_reserved, device_id, fase")
        .eq("id", item.stock_item_id)
        .single();

      let expItemId = item.stock_item_id;
      let currentReserved = (si as { quantity_reserved: number } | null)?.quantity_reserved ?? 0;

      if (si && (si as { fase: string }).fase !== "expedicao") {
        // Busca o item de expedição pelo device_id
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
        .update({ quantity_reserved: currentReserved + item.quantidade })
        .eq("id", expItemId);
    }

    setSaving(false);
    toast.success("Separação iniciada! Peças reservadas.");
    onClose();
    onSuccess();
  }

  if (!pedido) return null;

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
            const loteAtual = lotesEscolhidos[item.id];
            const loteInfo = disponiveis.find(l => l.lote === loteAtual);
            const semEstoque = disponiveis.length === 0;

            return (
              <div key={item.id} className={cn(
                "rounded-xl border p-3 space-y-2",
                semEstoque ? "border-destructive/30 bg-destructive/5" : "border-border/30 bg-background/60"
              )}>
                <div className="flex items-start gap-2">
                  <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold truncate">{item.device_model}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{item.device_reference}</p>
                  </div>
                  <span className="text-[12px] font-bold text-foreground shrink-0">{item.quantidade} un.</span>
                </div>

                {semEstoque ? (
                  <div className="flex items-center gap-1.5 text-[11px] text-destructive">
                    <AlertTriangle className="h-3 w-3" />
                    Sem estoque disponível na expedição
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Escolher lote</p>
                    <div className="flex flex-wrap gap-1.5">
                      {disponiveis.map(l => (
                        <button
                          key={l.lote}
                          type="button"
                          onClick={() => setLotesEscolhidos(prev => ({ ...prev, [item.id]: l.lote }))}
                          className={cn(
                            "flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors",
                            l.lote === loteAtual
                              ? "bg-blue-500/15 border-blue-500/40 text-blue-600"
                              : "bg-muted/30 border-border/30 text-muted-foreground hover:bg-muted/60"
                          )}
                        >
                          <Tag className="h-2.5 w-2.5" />
                          {l.lote}
                          <span className="opacity-60">({l.quantity} un.)</span>
                        </button>
                      ))}
                    </div>
                    {loteInfo && loteInfo.quantity < item.quantidade && (
                      <p className="text-[11px] text-amber-600 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Lote tem {loteInfo.quantity} un., pedido pede {item.quantidade}
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
            disabled={saving || loading}
            className="w-full h-10 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            Confirmar e Reservar Peças
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Painel Principal ─────────────────────────────────────────────────────────

interface PedidosEstoquePanelProps {
  isAdmin: boolean;
}

export function PedidosEstoquePanel({ isAdmin }: PedidosEstoquePanelProps) {
  const { user } = useAuth();
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState<string>("ativos");
  const [separarPedido, setSepararPedido] = useState<Pedido | null>(null);
  const [cancelarPedido, setCancelarPedido] = useState<Pedido | null>(null);
  const [cancelando, setCancelando] = useState(false);

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
      itens: ((p.pedido_itens as Record<string, unknown>[]) ?? []).map((i: Record<string, unknown>) => ({
        id: i.id as string,
        stock_item_id: i.stock_item_id as string,
        lote: i.lote as string,
        quantidade: i.quantidade as number,
        device_model: ((i.stock_items as { devices: { model: string; reference: string } } | null)?.devices?.model),
        device_reference: ((i.stock_items as { devices: { model: string; reference: string } } | null)?.devices?.reference),
      })),
    }));

    setPedidos(mapped);
    setLoading(false);
  }, []);

  useEffect(() => { loadPedidos(); }, [loadPedidos]);

  const statusAtivos = ["pendente", "separando", "pronto"];
  const filtrados = pedidos.filter(p => {
    if (filtroStatus === "ativos") return statusAtivos.includes(p.status);
    if (filtroStatus === "historico") return !statusAtivos.includes(p.status);
    return p.status === filtroStatus;
  });

  const pendentes = pedidos.filter(p => p.status === "pendente").length;
  const separando = pedidos.filter(p => p.status === "separando").length;
  const prontos = pedidos.filter(p => p.status === "pronto").length;

  async function handleMarcarPronto(pedido: Pedido) {
    if (!user) return;
    const { error } = await supabase
      .from("pedidos_comerciais")
      .update({ status: "pronto" })
      .eq("id", pedido.id);

    if (error) { toast.error("Erro ao marcar como pronto."); return; }
    toast.success("Pedido marcado como pronto! Aguardando nota fiscal.");
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
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Pendentes", value: pendentes, color: "text-amber-600", bg: "bg-amber-500/8 border-amber-500/20" },
          { label: "Separando", value: separando, color: "text-blue-600", bg: "bg-blue-500/8 border-blue-500/20" },
          { label: "Prontos", value: prontos, color: "text-emerald-600", bg: "bg-emerald-500/8 border-emerald-500/20" },
        ].map(k => (
          <div key={k.label} className={cn("rounded-xl border p-3 text-center", k.bg)}>
            <p className={cn("text-xl font-bold tabular-nums", k.color)}>{k.value}</p>
            <p className="text-[10px] text-muted-foreground">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {[
          { id: "ativos", label: "Ativos" },
          { id: "pendente", label: "Pendentes" },
          { id: "separando", label: "Separando" },
          { id: "pronto", label: "Prontos" },
          { id: "historico", label: "Histórico" },
        ].map(f => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFiltroStatus(f.id)}
            className={cn(
              "h-7 px-3 rounded-full text-[11px] font-medium border transition-colors",
              filtroStatus === f.id
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted/30 border-border/40 text-muted-foreground hover:bg-muted/60"
            )}
          >
            {f.label}
          </button>
        ))}
        <button
          type="button"
          onClick={loadPedidos}
          className="h-7 w-7 flex items-center justify-center rounded-full bg-muted/30 border border-border/40 text-muted-foreground hover:bg-muted/60 transition-colors ml-auto"
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
              onIniciarSeparacao={setSepararPedido}
              onMarcarPronto={handleMarcarPronto}
              onCancelar={setCancelarPedido}
              isAdmin={isAdmin}
            />
          ))}
        </div>
      )}

      {/* Modal separação de lotes */}
      <SepararLotesModal
        pedido={separarPedido}
        onClose={() => setSepararPedido(null)}
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
