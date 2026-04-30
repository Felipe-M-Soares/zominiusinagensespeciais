/**
 * Financeiro — Página para emitir nota fiscal e enviar pedido ao cliente
 *
 * Fluxo:
 *  1. Lista pedidos com status "pronto" (estoque separou)
 *  2. Financeiro preenche o número da NF e clica "Emitir e Enviar"
 *  3. Pedido vai para "faturado" → "enviado"
 *  4. Vendedora recebe notificação interna
 */

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Receipt,
  CheckCircle2,
  Package,
  User,
  Clock,
  Truck,
  Tag,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Send,
  X,
  ShoppingBag,
  RefreshCw,
  FileText,
  History,
  BadgeCheck,
  Ban,
  Bell,
} from "lucide-react";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface PedidoItem {
  id: string;
  stock_item_id: string;
  lote: string;
  quantidade: number;
  device_model?: string;
  device_reference?: string;
}

interface Pedido {
  id: string;
  cliente_nome: string;
  vendedora_nome: string | null;
  vendedora_id: string | null;
  status: string;
  frete: number;
  observacoes: string | null;
  nota_fiscal: string | null;
  created_at: string;
  separado_em: string | null;
  nf_criada_em: string | null;
  enviado_em: string | null;
  itens: PedidoItem[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function statusLabel(s: string) {
  const m: Record<string, string> = { pendente: "Pendente", separando: "Separando", pronto: "Pronto", faturado: "Faturado", enviado: "Enviado", cancelado: "Cancelado" };
  return m[s] ?? s;
}

function statusColor(s: string) {
  if (s === "pronto") return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
  if (s === "faturado") return "bg-violet-500/10 text-violet-600 border-violet-500/20";
  if (s === "enviado") return "bg-success/10 text-success border-success/20";
  return "bg-muted/30 text-muted-foreground border-border/30";
}

// ─── Modal de Emissão de NF ───────────────────────────────────────────────────

interface EmitirNFModalProps {
  pedido: Pedido | null;
  onClose: () => void;
  onSuccess: () => void;
}

function EmitirNFModal({ pedido, onClose, onSuccess }: EmitirNFModalProps) {
  const { user } = useAuth();
  const [nf, setNf] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (pedido) setNf(""); }, [pedido]);

  async function handleEmitir() {
    if (!pedido || !user || !nf.trim()) return;
    setSaving(true);

    // 1. Atualiza pedido: pronto → enviado + NF
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("pedidos_comerciais")
      .update({
        status: "enviado",
        nota_fiscal: nf.trim(),
        nf_criada_por: user.id,
        nf_criada_em: now,
        faturado_por: user.id,
        faturado_em: now,
        enviado_em: now,
      })
      .eq("id", pedido.id);

    if (error) { toast.error("Erro ao emitir nota fiscal."); setSaving(false); return; }

    // 2. Dá baixa no estoque e libera reservas
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

      await supabase
        .from("stock_items")
        .update({
          quantity: Math.max(0, currentQty - item.quantidade),
          quantity_reserved: Math.max(0, currentReserved - item.quantidade),
        })
        .eq("id", expItemId);

      await supabase.from("stock_movements").insert({
        stock_item_id: expItemId,
        type: "saida",
        quantity: item.quantidade,
        lote: item.lote,
        reason: `NF ${nf.trim()} — ${pedido.cliente_nome}`,
        user_id: user.id,
        user_display_name: "Financeiro",
      });
    }

    // 3. Notificação para a vendedora
    if (pedido.vendedora_id) {
      await supabase.from("notificacoes").insert({
        user_id: pedido.vendedora_id,
        pedido_id: pedido.id,
        tipo: "pedido_enviado",
        titulo: "Pedido enviado! 🚚",
        mensagem: `O pedido de ${pedido.cliente_nome} foi faturado (NF ${nf.trim()}) e enviado.`,
      });
    }

    setSaving(false);
    toast.success("Nota fiscal emitida e pedido enviado!");
    onClose();
    onSuccess();
  }

  if (!pedido) return null;
  const totalItens = pedido.itens.reduce((s, i) => s + i.quantidade, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-card border border-border/30 shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
        <div className="px-5 pt-5 pb-3 border-b border-border/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-violet-500" />
              <p className="text-sm font-semibold">Emitir Nota Fiscal</p>
            </div>
            <button type="button" onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Resumo do pedido */}
          <div className="rounded-xl border border-border/30 bg-muted/20 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold">{pedido.cliente_nome}</span>
              <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", statusColor(pedido.status))}>
                {statusLabel(pedido.status)}
              </span>
            </div>
            {pedido.vendedora_nome && (
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <User className="h-2.5 w-2.5" />{pedido.vendedora_nome}
              </p>
            )}
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1"><Package className="h-2.5 w-2.5" />{totalItens} un.</span>
              {pedido.frete > 0 && <span className="flex items-center gap-1"><Truck className="h-2.5 w-2.5" />Frete R$ {pedido.frete.toFixed(2)}</span>}
            </div>
          </div>

          {/* Itens */}
          <div className="space-y-1">
            {pedido.itens.map(item => (
              <div key={item.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background/60 border border-border/20">
                <Package className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-[12px] flex-1 truncate">{item.device_model}</span>
                <span className="flex items-center gap-1 text-[10px] text-violet-500 font-mono shrink-0">
                  <Tag className="h-2.5 w-2.5" />{item.lote}
                </span>
                <span className="text-[12px] font-bold shrink-0">{item.quantidade} un.</span>
              </div>
            ))}
          </div>

          {/* Campo NF */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              Número / Código da Nota Fiscal *
            </label>
            <input
              type="text"
              value={nf}
              onChange={e => setNf(e.target.value)}
              placeholder="Ex.: 123456 ou NF-2024-001"
              className="w-full h-10 rounded-xl border border-border/50 bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50"
              autoFocus
              onKeyDown={e => e.key === "Enter" && nf.trim() && handleEmitir()}
            />
          </div>

          <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3 text-[11px] text-muted-foreground flex items-start gap-2">
            <Bell className="h-3.5 w-3.5 text-violet-500 shrink-0 mt-0.5" />
            A vendedora <strong>{pedido.vendedora_nome ?? "—"}</strong> receberá uma notificação de que o pedido foi enviado.
          </div>
        </div>

        <div className="px-5 pb-5">
          <button
            type="button"
            onClick={handleEmitir}
            disabled={saving || !nf.trim()}
            className="w-full h-10 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Send className="h-4 w-4" />}
            Emitir NF e Enviar Pedido
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Card de Pedido ───────────────────────────────────────────────────────────

interface PedidoCardProps {
  pedido: Pedido;
  onEmitirNF: (pedido: Pedido) => void;
}

function PedidoCard({ pedido, onEmitirNF }: PedidoCardProps) {
  const [expanded, setExpanded] = useState(false);
  const totalItens = pedido.itens.reduce((s, i) => s + i.quantidade, 0);

  return (
    <div className={cn(
      "rounded-2xl border overflow-hidden",
      pedido.status === "pronto" ? "border-emerald-500/25 bg-emerald-500/3" :
      pedido.status === "faturado" ? "border-violet-500/25 bg-violet-500/3" :
      pedido.status === "enviado" ? "border-success/20 bg-success/3" :
      "border-border/30 bg-card"
    )}>
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full text-left px-4 py-3 flex items-start gap-3"
      >
        <div className="h-9 w-9 rounded-xl bg-muted/30 flex items-center justify-center shrink-0 mt-0.5">
          {pedido.status === "enviado" ? <BadgeCheck className="h-4 w-4 text-success" /> : <Receipt className="h-4 w-4 text-muted-foreground" />}
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
            {pedido.nota_fiscal && (
              <span className="flex items-center gap-1 text-[11px] text-violet-500 font-mono">
                <FileText className="h-2.5 w-2.5" />NF {pedido.nota_fiscal}
              </span>
            )}
          </div>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0 mt-2" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 mt-2" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/20 pt-3">
          {/* Timeline */}
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p className="flex items-center gap-1.5"><Clock className="h-3 w-3" />Criado: {fmtDate(pedido.created_at)}</p>
            {pedido.separado_em && <p className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-emerald-500" />Separado: {fmtDate(pedido.separado_em)}</p>}
            {pedido.nf_criada_em && <p className="flex items-center gap-1.5"><Receipt className="h-3 w-3 text-violet-500" />NF emitida: {fmtDate(pedido.nf_criada_em)}</p>}
            {pedido.enviado_em && <p className="flex items-center gap-1.5"><Send className="h-3 w-3 text-success" />Enviado: {fmtDate(pedido.enviado_em)}</p>}
          </div>

          {/* Itens */}
          <div className="space-y-1">
            {pedido.itens.map(item => (
              <div key={item.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background/60 border border-border/20">
                <Package className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-[12px] flex-1 truncate">{item.device_model}</span>
                <span className="flex items-center gap-1 text-[10px] text-violet-500 font-mono shrink-0">
                  <Tag className="h-2.5 w-2.5" />{item.lote}
                </span>
                <span className="text-[12px] font-bold shrink-0">{item.quantidade} un.</span>
              </div>
            ))}
          </div>

          {pedido.observacoes && <p className="text-[11px] text-muted-foreground italic">"{pedido.observacoes}"</p>}

          {pedido.status === "pronto" && (
            <button
              type="button"
              onClick={() => onEmitirNF(pedido)}
              className="w-full h-9 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[12px] font-semibold transition-colors flex items-center justify-center gap-1.5"
            >
              <Receipt className="h-3.5 w-3.5" />
              Emitir Nota Fiscal e Enviar
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Página Principal ─────────────────────────────────────────────────────────

export default function Financeiro() {
  const navigate = useNavigate();
  const { isAdmin, role } = useAuth();
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState("pronto");
  const [emitirNFPedido, setEmitirNFPedido] = useState<Pedido | null>(null);

  // Só admin ou financeiro pode acessar
  const canAccess = isAdmin || role === "financeiro";

  const loadPedidos = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("pedidos_comerciais")
      .select(`
        id, vendedora_id, vendedora_nome, status, frete, observacoes,
        nota_fiscal, created_at, separado_em, nf_criada_em, enviado_em,
        clientes!inner(nome),
        pedido_itens(
          id, stock_item_id, lote, quantidade,
          stock_items!inner(
            devices!inner(model, reference)
          )
        )
      `)
      .order("created_at", { ascending: false });

    if (error || !data) { setLoading(false); return; }

    const mapped: Pedido[] = (data as Record<string, unknown>[]).map(p => ({
      id: p.id as string,
      cliente_nome: (p.clientes as { nome: string }).nome,
      vendedora_nome: p.vendedora_nome as string | null,
      vendedora_id: p.vendedora_id as string | null,
      status: p.status as string,
      frete: (p.frete as number) ?? 0,
      observacoes: p.observacoes as string | null,
      nota_fiscal: p.nota_fiscal as string | null,
      created_at: p.created_at as string,
      separado_em: p.separado_em as string | null,
      nf_criada_em: p.nf_criada_em as string | null,
      enviado_em: p.enviado_em as string | null,
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

  const filtrados = pedidos.filter(p =>
    filtroStatus === "todos" ? true : p.status === filtroStatus
  );

  const prontos = pedidos.filter(p => p.status === "pronto").length;
  const enviados = pedidos.filter(p => p.status === "enviado").length;

  if (!canAccess) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-2">
          <Ban className="h-10 w-10 text-destructive/40 mx-auto" />
          <p className="text-sm text-muted-foreground">Acesso restrito ao financeiro.</p>
          <button type="button" onClick={() => navigate("/")} className="text-sm text-primary hover:underline">Voltar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border/40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => navigate("/")} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-violet-500" />
              <h1 className="text-sm font-semibold">Financeiro</h1>
            </div>
            {prontos > 0 && (
              <span className="flex items-center gap-0.5 bg-emerald-500/15 text-emerald-600 border border-emerald-500/30 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {prontos} pronto{prontos > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <button type="button" onClick={loadPedidos} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 flex items-start gap-3">
            <div className="h-9 w-9 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Aguardando NF</p>
              <p className="text-2xl font-bold tabular-nums text-emerald-600">{prontos}</p>
            </div>
          </div>
          <div className="rounded-2xl border border-success/20 bg-success/5 p-4 flex items-start gap-3">
            <div className="h-9 w-9 rounded-xl bg-success/10 flex items-center justify-center shrink-0">
              <Send className="h-5 w-5 text-success" />
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Enviados (total)</p>
              <p className="text-2xl font-bold tabular-nums text-success">{enviados}</p>
            </div>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {[
            { id: "pronto", label: "Aguardando NF" },
            { id: "enviado", label: "Enviados" },
            { id: "todos", label: "Todos" },
          ].map(f => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFiltroStatus(f.id)}
              className={cn(
                "h-7 px-3 rounded-full text-[11px] font-medium border transition-colors",
                filtroStatus === f.id
                  ? "bg-violet-600 text-white border-violet-600"
                  : "bg-muted/30 border-border/40 text-muted-foreground hover:bg-muted/60"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Lista */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin h-6 w-6 border-2 border-violet-500 border-t-transparent rounded-full" />
          </div>
        ) : filtrados.length === 0 ? (
          <div className="text-center py-16 space-y-2">
            <Receipt className="h-10 w-10 text-muted-foreground/30 mx-auto" />
            <p className="text-sm text-muted-foreground">
              {filtroStatus === "pronto" ? "Nenhum pedido aguardando nota fiscal" : "Nenhum pedido encontrado"}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtrados.map(p => (
              <PedidoCard key={p.id} pedido={p} onEmitirNF={setEmitirNFPedido} />
            ))}
          </div>
        )}
      </main>

      <EmitirNFModal pedido={emitirNFPedido} onClose={() => setEmitirNFPedido(null)} onSuccess={loadPedidos} />
    </div>
  );
}
