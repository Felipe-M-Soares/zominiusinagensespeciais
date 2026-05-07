import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tag, Package, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchLotesSummary } from "@/hooks/useStock";
import type { LoteSummary, StockItem } from "@/hooks/useStock";
import { cn } from "@/lib/utils";

interface Props {
  item: StockItem | null;
  open: boolean;
  onClose: () => void;
}

export function LotesPanel({ item, open, onClose }: Props) {
  const [lotes, setLotes] = useState<LoteSummary[]>([]);
  const [loading, setLoading] = useState(false);

  async function load(id: string) {
    setLoading(true);
    const data = await fetchLotesSummary(id);
    setLotes(data);
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    if (open && item) {
      setLoading(true);
      fetchLotesSummary(item.id).then((data) => {
        if (!cancelled) { setLotes(data); setLoading(false); }
      }).catch(() => { if (!cancelled) setLoading(false); });
    } else {
      setLotes([]);
    }
    return () => { cancelled = true; };
  }, [open, item]);

  if (!item) return null;

  // Apenas lotes com saldo positivo
  const activeLotes = lotes.filter((l) => l.saldo > 0);
  // Saldo total real = soma dos saldos dos lotes ativos
  const totalSaldo = activeLotes.reduce((s, l) => s + l.saldo, 0);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md p-0 rounded-2xl overflow-hidden border-border/30">
        {/* Header */}
        <div className="relative px-5 pt-5 pb-3">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent" />
          <div className="relative flex items-start justify-between">
            <div className="min-w-0 flex-1">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
                  <Tag className="h-4 w-4 text-primary" />
                  Lotes Registrados
                </DialogTitle>
              </DialogHeader>
              <p className="text-[12px] text-muted-foreground mt-0.5 line-clamp-1">
                {item.device.model}
              </p>
              <p className="text-[10px] text-muted-foreground/60 font-mono mt-0.5">
                {item.device.reference}
              </p>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 mt-0.5 shrink-0"
              onClick={() => load(item.id)} disabled={loading} title="Atualizar">
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Resumo: lotes ativos + total em estoque */}
        {!loading && activeLotes.length > 0 && (
          <div className="px-5 pb-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-muted/20 border border-border/30 px-3 py-2 text-center">
                <p className="text-[10px] text-muted-foreground">Lotes ativos</p>
                <p className="text-[15px] font-bold text-foreground">{activeLotes.length}</p>
              </div>
              <div className="rounded-xl bg-primary/8 border border-primary/20 px-3 py-2 text-center">
                <p className="text-[10px] text-primary/70">Total em estoque</p>
                <p className="text-[15px] font-bold text-primary">{totalSaldo}</p>
              </div>
            </div>
          </div>
        )}

        {/* Lista de lotes */}
        <div className="px-3 pb-4 max-h-[380px] overflow-y-auto space-y-1.5">
          {loading && (
            <div className="flex items-center justify-center py-10">
              <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          )}

          {!loading && activeLotes.length === 0 && (
            <div className="text-center py-10 space-y-1">
              <Tag className="h-8 w-8 text-muted-foreground/30 mx-auto" />
              <p className="text-sm text-muted-foreground">Nenhum lote com saldo ativo</p>
              <p className="text-[11px] text-muted-foreground/60">
                Os lotes aparecerão após registrar movimentos
              </p>
            </div>
          )}

          {activeLotes.map((l) => (
            <div key={l.lote}
              className="rounded-xl border bg-card border-border/40 px-3 py-2.5 transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                {/* Lote */}
                <div className="flex items-center gap-1.5 min-w-0">
                  <Tag className="h-3 w-3 text-primary/70 shrink-0" />
                  <span className="text-[13px] font-bold font-mono tracking-wider text-foreground truncate">
                    {l.lote}
                  </span>
                </div>

                {/* Quantidade em estoque */}
                <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg shrink-0 bg-primary/10 text-primary">
                  <Package className="h-3 w-3" />
                  <span className="text-[13px] font-bold tabular-nums">{l.saldo}</span>
                  <span className="text-[10px] opacity-70">un.</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
