import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tag, TrendingUp, TrendingDown, Minus, RefreshCw, PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchLotesSummary } from "@/hooks/useStock";
import type { LoteSummary, StockItem } from "@/hooks/useStock";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  item: StockItem | null;
  open: boolean;
  onClose: () => void;
}

export function LotesPanel({ item, open, onClose }: Props) {
  const [lotes, setLotes] = useState<LoteSummary[]>([]);
  const [loading, setLoading] = useState(false);
  // valores ao vivo buscados do banco ao abrir o painel, evitando
  // exibir o quantity_available stale que vem das props (calculado no mount).
  const [liveReserved, setLiveReserved] = useState<number | null>(null);
  const [liveQty, setLiveQty] = useState<number | null>(null);

  const isExpedicao = item?.fase === "expedicao";

  async function load(id: string) {
    setLoading(true);
    const [lotesData] = await Promise.all([
      fetchLotesSummary(id, item?.fase),
      isExpedicao ? refreshLive(id) : Promise.resolve(),
    ]);
    setLotes(lotesData);
    setLoading(false);
  }

  // Busca do banco a reserva real e quantidade total ao vivo
  async function refreshLive(id: string) {
    const { data: si } = await supabase
      .from("stock_items")
      .select("quantity")
      .eq("id", id)
      .maybeSingle();

    const { data: pedidosAtivos } = await supabase
      .from("pedidos_comerciais")
      .select("id")
      .in("status", ["pendente", "separando"]);

    const pedidoIds = (pedidosAtivos ?? []).map((p: { id: string }) => p.id);
    let reserved = 0;
    if (pedidoIds.length > 0) {
      const { data: pi } = await supabase
        .from("pedido_itens")
        .select("quantidade")
        .eq("stock_item_id", id)
        .in("pedido_id", pedidoIds);
      reserved = (pi ?? []).reduce((s: number, r: { quantidade: number }) => s + r.quantidade, 0);
    }
    setLiveReserved(reserved);
    setLiveQty((si as { quantity: number } | null)?.quantity ?? null);
  }

  useEffect(() => {
    let cancelled = false;
    if (open && item) {
      setLoading(true);
      setLiveReserved(null);
      setLiveQty(null);
      Promise.all([
        fetchLotesSummary(item.id, item.fase),
        isExpedicao ? refreshLive(item.id) : Promise.resolve(undefined),
      ]).then(([data]) => {
        if (!cancelled) { setLotes(data); setLoading(false); }
      }).catch(() => { if (!cancelled) setLoading(false); });
    } else {
      setLotes([]);
      setLiveReserved(null);
      setLiveQty(null);
    }
    return () => { cancelled = true; };
  }, [open, item, isExpedicao]);

  // ── Reconcilia saldos dos lotes com o reserved autoritativo de refreshLive ──
  // fetchLotesSummary pode falhar em descontar reservas corretamente em casos
  // com múltiplos stock_item_ids por device. refreshLive usa uma query direta
  // e simples que sempre retorna o reserved correto.
  // Quando há discrepância, redistribui FIFO para garantir que os cards
  // mostrem a quantidade exata disponível em cada lote.
  const lotesReconciliados: LoteSummary[] = (() => {
    if (!isExpedicao || liveReserved === null || lotes.length === 0) return lotes;

    const qty      = liveQty !== null ? liveQty : item?.quantity ?? 0;
    const reserved = liveReserved;
    const available = Math.max(0, qty - reserved);

    // Soma dos saldos calculados pela função
    const somaLotes = lotes.reduce((s, l) => s + l.saldo, 0);

    // Se já batem, não precisa ajustar
    if (somaLotes === available) return lotes;

    // Redistribui FIFO — ordena do mais antigo (last_movement mais cedo) para mais novo
    // e aplica o total disponível real distribuindo do primeiro ao último
    const ordenados = [...lotes].sort((a, b) => a.last_movement.localeCompare(b.last_movement));
    let restante = available;
    const ajustados = ordenados.map(l => {
      // Cada lote recebe no máximo seu saldo bruto (total_entrada - total_saida)
      const bruto = l.total_entrada - l.total_saida;
      const atribuir = Math.min(bruto, Math.max(0, restante));
      restante = Math.max(0, restante - atribuir);
      return { ...l, saldo: atribuir };
    });

    return ajustados.filter(l => l.saldo > 0);
  })();

  if (!item) return null;

  // ── Expedição: mostra nome, lotes com saldo e quantidade total ───────────
  if (isExpedicao) {
    // usa valores ao vivo (refreshLive) quando disponíveis;
    // cai back nos props enquanto o fetch ainda está em curso.
    const qty = liveQty !== null ? liveQty : item.quantity;
    const reserved = liveReserved !== null ? liveReserved : item.quantity_reserved;
    const available = Math.max(0, qty - reserved);
    const isEmpty = available === 0;
    const isLow = available > 0 && available <= item.min_quantity;
    const activeLotesExp = lotesReconciliados;

    return (
      <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent className="max-w-md p-0 rounded-2xl overflow-hidden border-border/30">
          {/* Header */}
          <div className="relative px-5 pt-5 pb-3">
            <div className="absolute inset-0 bg-gradient-to-b from-success/5 to-transparent" />
            <div className="relative flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
                    <PackageCheck className="h-4 w-4 text-success" />
                    Estoque — Expedição
                  </DialogTitle>
                </DialogHeader>
                <p className="text-[12px] text-muted-foreground mt-0.5 line-clamp-2">
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

          {/* Quantidade disponível */}
          <div className="px-5 pb-3 space-y-3">
            <div className={cn(
              "rounded-2xl border px-5 py-4 flex items-center justify-between",
              isEmpty ? "bg-destructive/8 border-destructive/25"
              : isLow  ? "bg-warning/8 border-warning/25"
                       : "bg-success/8 border-success/25"
            )}>
              <div className="space-y-0.5">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                  Disponível em estoque
                </p>
                <p className="text-[10px] text-muted-foreground/50">
                  Descontando reservas de pedidos
                </p>
              </div>
              <div className="text-right">
                <p className={cn(
                  "text-3xl font-bold tabular-nums",
                  isEmpty ? "text-destructive" : isLow ? "text-warning" : "text-success"
                )}>
                  {available}
                </p>
                <p className="text-[10px] text-muted-foreground/60">unidades</p>
              </div>
            </div>

            {(liveReserved !== null ? liveReserved : item.quantity_reserved) > 0 && (
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-3 flex items-center justify-between">
                <p className="text-[11px] text-muted-foreground">Reservado (pedidos)</p>
                <div className="flex items-center gap-1">
                  <span className="text-[15px] font-bold text-amber-500 tabular-nums">{liveReserved !== null ? liveReserved : item.quantity_reserved}</span>
                  <span className="text-[10px] text-muted-foreground/60">un.</span>
                </div>
              </div>
            )}

            {qty !== available && (
              <div className="rounded-xl border border-border/30 bg-muted/10 px-4 py-3 flex items-center justify-between">
                <p className="text-[11px] text-muted-foreground">Total em expedição</p>
                <div className="flex items-center gap-1">
                  <span className="text-[15px] font-bold text-foreground tabular-nums">{liveQty !== null ? liveQty : item.quantity}</span>
                  <span className="text-[10px] text-muted-foreground/60">un.</span>
                </div>
              </div>
            )}
          </div>

          {/* Lista de lotes da expedição */}
          <div className="px-3 pb-4 max-h-[280px] overflow-y-auto space-y-1.5">
            {loading && (
              <div className="flex items-center justify-center py-6">
                <div className="animate-spin h-5 w-5 border-2 border-success border-t-transparent rounded-full" />
              </div>
            )}

            {!loading && activeLotesExp.length === 0 && (
              <div className="text-center py-6 space-y-1">
                <Tag className="h-6 w-6 text-muted-foreground/30 mx-auto" />
                <p className="text-[11px] text-muted-foreground">Nenhum lote com saldo ativo</p>
              </div>
            )}

            {!loading && activeLotesExp.map((l) => (
              <div key={l.lote}
                className="rounded-xl border border-border/40 bg-card px-3 py-2.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Tag className="h-3 w-3 text-success/70 shrink-0" />
                      <span className="text-[13px] font-bold font-mono tracking-wider text-foreground">
                        {l.lote}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg shrink-0 bg-success/10 text-success">
                    <TrendingUp className="h-3 w-3" />
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

  // ── Retrabalho: mostra nome, lote e quantidade com lista de lotes ─────────
  if (item.fase === "retrabalho") {
    const qty = item.quantity;
    const isEmpty = qty === 0;
    const activeLotesRet = lotes.filter((l) => l.saldo > 0);
    // Extrai lote do campo notes (formato: "lote:XXXX | ...") como fallback de exibição
    const loteRetrabalho = (() => {
      const match = (item.notes ?? "").match(/lote:([^\s|]+)/i);
      return match ? match[1].toUpperCase() : null;
    })();

    return (
      <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent className="max-w-md p-0 rounded-2xl overflow-hidden border-border/30">
          {/* Header */}
          <div className="relative px-5 pt-5 pb-3">
            <div className="absolute inset-0 bg-gradient-to-b from-orange-500/5 to-transparent" />
            <div className="relative flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
                    <Tag className="h-4 w-4 text-orange-500" />
                    Estoque — Retrabalho
                  </DialogTitle>
                </DialogHeader>
                <p className="text-[12px] text-muted-foreground mt-0.5 line-clamp-2">
                  {item.device.model}
                </p>
                <p className="text-[10px] text-muted-foreground/60 font-mono mt-0.5">
                  {item.device.reference}
                </p>
                {loteRetrabalho && activeLotesRet.length === 0 && (
                  <div className="flex items-center gap-1 mt-1">
                    <Tag className="h-3 w-3 text-orange-500/70 shrink-0" />
                    <span className="text-[11px] font-bold font-mono tracking-wider text-orange-500/80">
                      {loteRetrabalho}
                    </span>
                  </div>
                )}
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7 mt-0.5 shrink-0"
                onClick={() => load(item.id)} disabled={loading} title="Atualizar">
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              </Button>
            </div>
          </div>

          {/* Quantidade em retrabalho */}
          <div className="px-5 pb-3 space-y-3">
            <div className={cn(
              "rounded-2xl border px-5 py-4 flex items-center justify-between",
              isEmpty ? "bg-destructive/8 border-destructive/25" : "bg-orange-500/8 border-orange-500/25"
            )}>
              <div className="space-y-0.5">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                  Em retrabalho
                </p>
                <p className="text-[10px] text-muted-foreground/50">
                  Aguardando conclusão
                </p>
              </div>
              <div className="text-right">
                <p className={cn(
                  "text-3xl font-bold tabular-nums",
                  isEmpty ? "text-destructive" : "text-orange-500"
                )}>
                  {qty}
                </p>
                <p className="text-[10px] text-muted-foreground/60">unidades</p>
              </div>
            </div>
          </div>

          {/* Lista de lotes do retrabalho */}
          <div className="px-3 pb-4 max-h-[240px] overflow-y-auto space-y-1.5">
            {loading && (
              <div className="flex items-center justify-center py-6">
                <div className="animate-spin h-5 w-5 border-2 border-orange-500 border-t-transparent rounded-full" />
              </div>
            )}

            {!loading && activeLotesRet.length === 0 && (
              <div className="text-center py-4 space-y-1">
                <Tag className="h-6 w-6 text-muted-foreground/30 mx-auto" />
                <p className="text-[11px] text-muted-foreground">Nenhum lote com saldo ativo</p>
              </div>
            )}

            {!loading && activeLotesRet.map((l) => (
              <div key={l.lote}
                className="rounded-xl border border-border/40 bg-card px-3 py-2.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Tag className="h-3 w-3 text-orange-500/70 shrink-0" />
                      <span className="text-[13px] font-bold font-mono tracking-wider text-foreground">
                        {l.lote}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg shrink-0 bg-orange-500/10 text-orange-500">
                    <TrendingUp className="h-3 w-3" />
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

  // ── Intermediário / Retrabalho: comportamento original com lotes ──────────
  const activeLotes  = lotes.filter((l) => l.saldo > 0);
  const totalEntrada = lotes.reduce((s, l) => s + l.total_entrada, 0);
  const totalSaida   = lotes.reduce((s, l) => s + l.total_saida, 0);
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
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Tag className="h-3 w-3 text-primary/70 shrink-0" />
                      <span className="text-[13px] font-bold font-mono tracking-wider text-foreground">
                        {l.lote}
                      </span>
                    </div>
                  </div>

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

                {l.total_entrada > 0 && (
                  <div className="mt-2 space-y-1">
                    <div className="flex h-1.5 rounded-full overflow-hidden bg-muted/30">
                      <div
                        className="bg-success/60 rounded-full transition-all"
                        style={{ width: `${Math.round(((l.total_entrada - l.total_saida) / l.total_entrada) * 100)}%` }}
                      />
                      <div
                        className="bg-destructive/40 rounded-full transition-all"
                        style={{ width: `${Math.round((l.total_saida / l.total_entrada) * 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[9px] text-muted-foreground/50">
                      <span className="flex items-center gap-0.5">
                        <TrendingUp className="h-2 w-2 text-success" />
                        {l.total_entrada} entraram
                      </span>
                      <span className="flex items-center gap-0.5">
                        <TrendingDown className="h-2 w-2 text-destructive" />
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
