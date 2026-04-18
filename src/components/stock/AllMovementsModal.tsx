import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowDownCircle, ArrowUpCircle, History, User, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchAllMovements } from "@/hooks/useStock";
import type { AllMovement } from "@/hooks/useStock";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AllMovementsModal({ open, onClose }: Props) {
  const [movements, setMovements] = useState<AllMovement[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const data = await fetchAllMovements(100);
    setMovements(data);
    setLoading(false);
  }

  useEffect(() => {
    if (open) load();
    else setMovements([]);
  }, [open]);

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
                  Histórico Geral
                </DialogTitle>
              </DialogHeader>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                Últimas {movements.length} movimentações do estoque
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

        <div className="px-3 pb-4 max-h-[500px] overflow-y-auto space-y-1">
          {loading && (
            <div className="flex items-center justify-center py-10">
              <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          )}

          {!loading && movements.length === 0 && (
            <div className="text-center py-12 text-sm text-muted-foreground">
              Nenhuma movimentação registrada
            </div>
          )}

          {!loading && movements.map((mv) => {
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
