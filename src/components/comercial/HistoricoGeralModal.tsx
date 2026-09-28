import { useState, useEffect, useCallback } from "react";
import { fetchAllMovements } from "@/hooks/useStock";
import type { AllMovement } from "@/hooks/useStock";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { History, X, RefreshCw, ArrowDownCircle, ArrowUpCircle, User } from "lucide-react";
import { ClearHistoryButton } from "@/components/admin/ClearHistoryButton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface HistoricoGeralProps {
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
}

export function HistoricoGeralModal({ open, onClose, isAdmin }: HistoricoGeralProps) {
  const [movements, setMovements] = useState<AllMovement[]>([]);
  const [loading, setLoading] = useState(false);

  // Reasons que NÃO pertencem ao comercial (são do estoque interno)
  const INTERNAL_REASONS = [
    "Retrabalho concluído — recebido do Retrabalho",
    "Retrabalho concluído — enviado para Expedição",
    "Enviado para Retrabalho",
    "Recebido de Intermediário",
    "Rollback — falha ao criar item de retrabalho",
    "Rollback — falha ao criar item de expedição",
    "Rollback — falha ao registrar entrada na expedição",
    "Retirada",
  ];

  const isComercialMovement = useCallback((m: AllMovement) => {
    // Aceita expedicao ou fase não definida (item pode ter sido movido/deletado após)
    if (m.fase && m.fase !== "expedicao") return false;
    if (!m.reason) return false;
    if (INTERNAL_REASONS.some(r => m.reason?.startsWith(r))) return false;
    return true;
  // INTERNAL_REASONS is a static constant — safe to omit
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (open) {
      setLoading(true);
      // Filtra direto no banco por fase=expedicao para não depender do join
      fetchAllMovements(200, "expedicao").then((data) => {
        if (!cancelled) {
          setMovements(data.filter(isComercialMovement));
          setLoading(false);
        }
      }).catch(() => { if (!cancelled) setLoading(false); });
    } else {
      setMovements([]);
    }
    return () => { cancelled = true; };
  }, [open, isComercialMovement]);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchAllMovements(200, "expedicao");
      setMovements(data.filter(isComercialMovement));
    } catch (_e) {
      toast.error("Erro ao carregar histórico.");
    } finally {
      setLoading(false);
    }
  }

  function fmtDate(iso: string) {
    const d = new Date(iso);
    return {
      date: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }),
      time: d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    };
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg p-0 gap-0 max-h-[90vh] flex flex-col overflow-hidden [&>button:last-child]:hidden">
        {/* Header */}
        <div className="px-5 pt-5 pb-3 shrink-0 border-b">
          <div className="flex items-start justify-between gap-2">
            <DialogHeader className="text-left space-y-0.5 min-w-0">
              <DialogTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4 text-primary" />Movimentações da expedição</DialogTitle>
              <DialogDescription>Entradas e saídas ligadas aos pedidos (últimas 200)</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-1 shrink-0">
              {isAdmin && (
                <ClearHistoryButton
                  rpc="admin_clear_comercial"
                  label="Apagar"
                  confirmTitle="Apagar histórico comercial?"
                  confirmDescription="Apaga todos os pedidos e itens comerciais. O estoque e os cadastros de peças são mantidos."
                  onCleared={load}
                  className="h-7 px-2"
                />
              )}
              <button
                type="button"
                onClick={load}
                disabled={loading}
                className="h-10 w-10 flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground transition-colors"
                title="Atualizar" aria-label="Atualizar"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="h-10 w-10 flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground transition-colors"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="px-3 py-3 overflow-y-auto flex-1 space-y-1">
          {loading && (
            <div className="flex items-center justify-center py-10">
              <div className="animate-spin h-5 w-5 border-2 border-violet-500 border-t-transparent rounded-full" />
            </div>
          )}
          {!loading && movements.length === 0 && (
            <div className="text-center py-12 text-sm text-muted-foreground">
              Nenhuma movimentação registrada no comercial
            </div>
          )}
          {!loading && (() => {
            // Agrupa movimentos pelo mesmo pedido (mesmo device + reason + usuário + data)
            // para não repetir uma linha por lote — mostra só nome da peça e total
            const grouped = new Map<string, {
              key: string;
              device_model: string;
              device_reference: string;
              type: string;
              quantity: number;
              user_display_name: string | null;
              created_at: string;
            }>();

            for (const mv of movements) {
              // Extrai cliente do reason (ex: "Pedido comercial — cliente: felipe (lote: ...)")
              const clienteMatch = mv.reason?.match(/cliente:\s*([^(]+)/i);
              const clienteNome = clienteMatch ? clienteMatch[1].trim() : (mv.reason ?? "");
              const key = `${mv.device_model}||${mv.type}||${clienteNome}||${mv.user_display_name}||${mv.created_at.slice(0, 16)}`;
              if (grouped.has(key)) {
                grouped.get(key)!.quantity += mv.quantity;
              } else {
                grouped.set(key, {
                  key,
                  device_model: mv.device_model ?? "",
                  device_reference: mv.device_reference ?? "",
                  type: mv.type,
                  quantity: mv.quantity,
                  user_display_name: mv.user_display_name ?? null,
                  created_at: mv.created_at,
                });
              }
            }

            return [...grouped.values()].map((g) => {
              const { date, time } = fmtDate(g.created_at);
              const isEntrada = g.type === "entrada";
              return (
                <div
                  key={g.key}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors",
                    isEntrada ? "bg-success/4 border-success/15" : "bg-violet-500/4 border-violet-500/15"
                  )}
                >
                  {isEntrada
                    ? <ArrowDownCircle className="h-4 w-4 text-success shrink-0" />
                    : <ArrowUpCircle className="h-4 w-4 text-violet-500 shrink-0" />}
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-[12px] font-semibold text-foreground leading-snug line-clamp-1">{g.device_model}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{g.device_reference}</p>
                    {g.user_display_name && (
                      <p className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
                        <User className="h-2.5 w-2.5" />{g.user_display_name}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={cn("text-[13px] font-bold tabular-nums", isEntrada ? "text-success" : "text-violet-500")}>
                      {isEntrada ? "+" : "-"}{g.quantity}
                      <span className="text-[10px] font-normal ml-0.5 opacity-70">un.</span>
                    </span>
                    <span className="text-[10px] text-muted-foreground">{date}</span>
                    <span className="text-[10px] text-muted-foreground/60">{time}</span>
                  </div>
                </div>
              );
            });
          })()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
