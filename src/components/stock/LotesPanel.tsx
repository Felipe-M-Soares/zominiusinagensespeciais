import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tag, TrendingUp, TrendingDown, Minus, RefreshCw } from "lucide-react";
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

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "2-digit",
    });
  }

  const activeLotes  = lotes.filter((l) => l.saldo > 0);
  const totalEntrada = activeLotes.reduce((s, l) => s + l.total_entrada, 0);
  const totalSaida   = activeLotes.reduce((s, l) => s + l.total_saida, 0);
  const activeLotesCount = activeLotes.length;

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

        {/* Resumo geral */}
        {!loading && lotes.length > 0 && (
          <div className="px-5 pb-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-muted/20 border border-border/30 px-3 py-2 text-center">
                <p className="text-[10px] text-muted-foreground">Lotes</p>
                <p className="text-[15px] font-bold text-foreground">{activeLotesCount}</p>
              </div>
              <div className="rounded-xl bg-success/8 border border-success/20 px-3 py-2 text-center">
                <p className="text-[10px] text-success/70">Entradas</p>
                <p className="text-[15px] font-bold text-success">{totalEntrada}</p>
              </div>
              <div className="rounded-xl bg-destructive/8 border border-destructive/20 px-3 py-2 text-center">
                <p className="text-[10px] text-destructive/70">Saídas</p>
                <p className="text-[15px] font-bold text-destructive">{totalSaida}</p>
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

          {!loading && lotes.length === 0 && (
            <div className="text-center py-10 space-y-1">
              <Tag className="h-8 w-8 text-muted-foreground/30 mx-auto" />
              <p className="text-sm text-muted-foreground">Nenhum lote com saldo ativo</p>
              <p className="text-[11px] text-muted-foreground/60">
                Os lotes aparecerão após registrar movimentos
              </p>
            </div>
          )}

          {lotes.filter((l) => l.saldo > 0).map((l) => {
            const isActive = true;
            const isZero   = false;
            return (
              <div key={l.lote}
                className={cn(
                  "rounded-xl border px-3 py-2.5 transition-colors",
                  isActive ? "bg-card border-border/40" : "bg-muted/10 border-border/20 opacity-70"
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  {/* Lote + data */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Tag className="h-3 w-3 text-primary/70 shrink-0" />
                      <span className="text-[13px] font-bold font-mono tracking-wider text-foreground">
                        {l.lote}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5 pl-4">
                      Último movimento: {fmtDate(l.last_movement)}
                    </p>
                  </div>

                  {/* Saldo */}
                  <div className={cn(
                    "flex items-center gap-1 px-2.5 py-1 rounded-lg shrink-0",
                    isActive ? "bg-success/10 text-success" :
                    isZero   ? "bg-muted/40 text-muted-foreground" :
                               "bg-destructive/10 text-destructive"
                  )}>
                    {isActive ? <TrendingUp  className="h-3 w-3" /> :
                     isZero   ? <Minus       className="h-3 w-3" /> :
                                <TrendingDown className="h-3 w-3" />}
                    <span className="text-[13px] font-bold tabular-nums">{l.saldo}</span>
                    <span className="text-[10px] opacity-70">un.</span>
                  </div>
                </div>

                {/* Barra de entradas vs saídas */}
                {l.total_entrada > 0 && (
                  <div className="mt-2 space-y-1">
                    <div className="flex h-1.5 rounded-full overflow-hidden bg-muted/30">
                      <div
                        className="bg-success/60 rounded-full transition-all"
                        style={{ width: `${Math.round((l.total_saida / l.total_entrada) * 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[9px] text-muted-foreground/50">
                      <span className="flex items-center gap-0.5">
                        <TrendingDown className="h-2 w-2 text-success" />
                        {l.total_entrada} entraram
                      </span>
                      <span className="flex items-center gap-0.5">
                        <TrendingUp className="h-2 w-2 text-destructive" />
                        {l.total_saida} saíram
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
