import { useState, useEffect, useCallback } from "react";
import { displayLote } from "@/lib/lote";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowDownCircle, ArrowUpCircle, History, User, RefreshCw, Tag, Truck, Package, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllMovements } from "@/hooks/useStock";
import type { AllMovement, StockFase } from "@/hooks/useStock";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  fase?: StockFase; // quando passado, filtra apenas esse setor
}

const FASE_LABELS: Record<StockFase, { label: string; Icon: React.ElementType }> = {
  intermediaria: { label: "Intermediária", Icon: Package },
  expedicao: { label: "Expedição", Icon: Truck },
  retrabalho: { label: "Retrabalho", Icon: Wrench },
};

export function AllMovementsModal({ open, onClose, fase }: Props) {
  const [movements, setMovements] = useState<AllMovement[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filtroInicio, setFiltroInicio] = useState("");
  const [filtroFim, setFiltroFim] = useState("");

  // Exclui movimentos originados pelo Financeiro ou pelo Comercial (pedidos)
  const filterStockOnly = useCallback((data: AllMovement[]) => {
    return data.filter((m) => {
      if (m.user_display_name === "Financeiro") return false;
      if (m.reason?.startsWith("Pedido comercial")) return false;
      if (m.reason?.startsWith("NF ")) return false;
      return fase ? m.fase === fase : true;
    });
  }, [fase]);

  async function load() {
    setLoading(true);
    const data = await fetchAllMovements(100, fase);
    setMovements(filterStockOnly(data));
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    if (open) {
      setLoading(true);
      fetchAllMovements(100, fase).then((data) => {
        if (!cancelled) {
          setMovements(filterStockOnly(data));
          setLoading(false);
        }
      }).catch(() => { if (!cancelled) setLoading(false); });
    } else {
      setMovements([]);
    }
    return () => { cancelled = true; };
  }, [open, fase, filterStockOnly]);

  // Realtime: recarrega histórico geral quando qualquer movimento é inserido
  useEffect(() => {
    if (!open) return;
    const channel = supabase
      .channel(`all-movements-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "stock_movements" },
        () => { load(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fase]);

  const movimentosFiltrados = movements.filter(m => {
    if (search && !((m.device_model ?? "").toLowerCase().includes(search.toLowerCase()) || (m.lote ?? "").toLowerCase().includes(search.toLowerCase()))) return false;
    if (filtroInicio && m.created_at < filtroInicio) return false;
    if (filtroFim && m.created_at > filtroFim + "T23:59:59") return false;
    return true;
  });

  function fmtDate(iso: string) {
    const d = new Date(iso);
    return {
      date: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }),
      time: d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    };
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg p-0 rounded-2xl overflow-hidden border-border/30">
        {/* Header */}
        <div className="relative px-5 pt-5 pb-3">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent" />
          <div className="relative flex items-start justify-between">
            <div>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
                  <History className="h-4 w-4 text-primary" />
                  {fase ? `Histórico do Estoque — ${FASE_LABELS[fase].label}` : "Histórico do Estoque"}
                </DialogTitle>
              </DialogHeader>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                {movimentosFiltrados.length} movimentações
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 mt-0.5"
              onClick={load}
              disabled={loading}
              title="Atualizar"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 px-4 pb-3 border-b border-border/20">
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar peça, lote..." className="flex-1 min-w-[120px] h-8 rounded-lg border border-border/50 bg-background text-[11px] px-3 focus:outline-none focus:ring-1 focus:ring-violet-500/30" />
          <input type="date" value={filtroInicio} onChange={e => setFiltroInicio(e.target.value)} className="h-8 rounded-lg border border-border/50 bg-background text-[11px] px-2" />
          <span className="text-[10px] text-muted-foreground self-center">–</span>
          <input type="date" value={filtroFim} onChange={e => setFiltroFim(e.target.value)} className="h-8 rounded-lg border border-border/50 bg-background text-[11px] px-2" />
          {(search || filtroInicio || filtroFim) && <button type="button" onClick={() => { setSearch(""); setFiltroInicio(""); setFiltroFim(""); }} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted/50 text-muted-foreground"><X className="h-3.5 w-3.5" /></button>}
        </div>
        <div className="px-3 pb-4 max-h-[500px] overflow-y-auto space-y-1">
          {loading && (
            <div className="flex items-center justify-center py-10">
              <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          )}

          {!loading && movimentosFiltrados.length === 0 && (
            <div className="text-center py-12 text-sm text-muted-foreground">
              Nenhuma movimentação registrada
            </div>
          )}

          {!loading && movimentosFiltrados.map((mv) => {
            const { date, time } = fmtDate(mv.created_at);
            return (
              <div
                key={mv.id}
                className={cn(
                  "flex items-start gap-3 px-3 py-2.5 rounded-xl border transition-colors",
                  mv.type === "entrada"
                    ? "bg-success/4 border-success/15"
                    : "bg-destructive/4 border-destructive/15"
                )}
              >
                {/* Ícone */}
                {mv.type === "entrada"
                  ? <ArrowDownCircle className="h-4 w-4 mt-0.5 text-success shrink-0" />
                  : <ArrowUpCircle   className="h-4 w-4 mt-0.5 text-destructive shrink-0" />}

                {/* Conteúdo */}
                <div className="min-w-0 flex-1 space-y-0.5">
                  {/* Peça */}
                  <p className="text-[12px] font-semibold text-foreground leading-snug line-clamp-1">
                    {mv.device_model}
                  </p>
                  <p className="text-[10px] text-muted-foreground font-mono">{mv.device_reference}</p>

                  {/* Lote */}
                  {displayLote(mv.lote) && (
                    <p className="flex items-center gap-1 text-[11px] font-mono font-semibold text-primary/80">
                      <Tag className="h-2.5 w-2.5" />Lote {displayLote(mv.lote)}
                    </p>
                  )}

                  {/* Motivo */}
                  {mv.reason && (
                    <p className="text-[11px] text-muted-foreground line-clamp-1">{mv.reason}</p>
                  )}

                  {/* Usuário */}
                  {mv.user_display_name && (
                    <p className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
                      <User className="h-2.5 w-2.5" />
                      {mv.user_display_name}
                    </p>
                  )}
                </div>

                {/* Quantidade + data/hora */}
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={cn(
                    "text-[13px] font-bold tabular-nums",
                    mv.type === "entrada" ? "text-success" : "text-destructive"
                  )}>
                    {mv.type === "entrada" ? "+" : "-"}{mv.quantity}
                    <span className="text-[10px] font-normal ml-0.5 opacity-70">un.</span>
                  </span>
                  <span className="text-[10px] text-muted-foreground">{date}</span>
                  <span className="text-[10px] text-muted-foreground/60">{time}</span>
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
