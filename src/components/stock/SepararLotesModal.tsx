import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { fetchLotesDisponivelBatch } from "@/hooks/useStock";
import type { Pedido, LoteDisponivel } from "@/components/stock/pedidosEstoqueTypes";
import {
  AlertTriangle, ArrowRight, CheckCircle2, Minus, Package, PackageCheck, Plus, X,
} from "lucide-react";

/**
 * SepararLotesModal — NÃO ESTÁ EM USO em nenhuma tela do app (verificado:
 * nenhum componente importa/renderiza este modal). Foi encontrado assim
 * durante uma auditoria de código e extraído para seu próprio arquivo em
 * vez de removido, já que só quem conhece o histórico do projeto pode saber
 * se era um recurso planejado para ser reativado ou se foi substituído por
 * outra tela (ex.: a seleção de lotes hoje embutida diretamente no
 * PedidoCard). Se confirmado que não é mais necessário, este arquivo pode
 * ser removido com segurança — nada mais no projeto depende dele.
 */

interface SepararLotesModalProps {
  pedido: Pedido | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function SepararLotesModal({ pedido, onClose, onSuccess }: SepararLotesModalProps) {
  const { user } = useAuth();

  const [lotesSelecionados, setLotesSelecionados] = useState<Record<string, Record<string, number>>>({});
  const [lotesDisponiveis, setLotesDisponiveis] = useState<Record<string, LoteDisponivel[]>>({});
  // rascunho de digitação do campo de quantidade por lote — não afeta a seleção real até o onBlur,
  // evita que o campo "feche" (lote desmarcado) a cada tecla apertada ao apagar para editar
  const [qtyRascunho, setQtyRascunho] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!pedido) return;
    setLoading(true);
    setSaved(false);

    async function loadLotes() {
      if (!pedido) return;
      const itemIds = pedido.itens.map(i => i.stock_item_id);

      // Batch query for all stock items
      const { data: siRows } = await supabase
        .from("stock_items")
        .select("id, device_id, quantity, fase")
        .in("id", itemIds);

      const siMap = new Map((siRows ?? []).map((r: Record<string, unknown>) => [r.id as string, r]));

      const nonExpDeviceIds = (siRows ?? [])
        .filter((r: Record<string, unknown>) => r.fase !== "expedicao")
        .map((r: Record<string, unknown>) => r.device_id as string);

      const expMap = new Map<string, { id: string; quantity: number }>();
      if (nonExpDeviceIds.length > 0) {
        const { data: expRows } = await supabase
          .from("stock_items")
          .select("id, device_id, quantity")
          .in("device_id", nonExpDeviceIds)
          .eq("fase", "expedicao");
        for (const r of (expRows ?? []) as { id: string; device_id: string; quantity: number }[]) {
          expMap.set(r.device_id, { id: r.id, quantity: r.quantity });
        }
      }

      const expedicaoIdByItem: Record<string, string> = {};
      const expedicaoIds: string[] = [];
      for (const item of pedido.itens) {
        const si = siMap.get(item.stock_item_id) as { device_id: string; fase: string } | undefined;
        if (!si) { expedicaoIdByItem[item.id] = item.stock_item_id; continue; }
        if (si.fase === "expedicao") {
          expedicaoIdByItem[item.id] = item.stock_item_id;
          expedicaoIds.push(item.stock_item_id);
        } else {
          const exp = expMap.get(si.device_id);
          expedicaoIdByItem[item.id] = exp?.id ?? item.stock_item_id;
          if (exp) expedicaoIds.push(exp.id);
        }
      }

      // Single batch query for all lotes
      // Passa pedido.id para excluir as próprias reservas do pedido — o separador
      // vê o saldo disponível para outros pedidos + o que já reservou para este.
      const lotesMap = await fetchLotesDisponivelBatch([...new Set(expedicaoIds)], pedido.id);

      const result: Record<string, LoteDisponivel[]> = {};
      for (const item of pedido.itens) {
        const expId = expedicaoIdByItem[item.id] ?? item.stock_item_id;
        const saldos = lotesMap.get(expId) ?? {};

        const lotesList: LoteDisponivel[] = Object.entries(saldos)
          .map(([lote, qty]) => ({ lote, quantity: Math.max(0, qty), stock_item_id: expId }))
          .filter(l => l.quantity > 0);

        if (lotesList.length === 0) {
          const si = siMap.get(expId) as { quantity?: number } | undefined;
          const qty = si?.quantity ?? 0;
          if (qty > 0) lotesList.push({ lote: "Sem lote", quantity: qty, stock_item_id: expId });
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
    if (!pedido || !user || submittingRef.current) return;
    submittingRef.current = true;
    setSaving(true);

    // Snapshot: one entry per (expId, lote) — deduped to avoid doubled quantities
    const snapMap = new Map<string, { pedido_item_id: string; stock_item_id: string; lote: string; quantidade: number; device_model?: string }>();
    for (const item of pedido.itens) {
      const itemSel = lotesSelecionados[item.id] ?? {};
      // expId = real expedição stock_item_id (first available lote carries the correct id)
      const expStockItemId = (lotesDisponiveis[item.id]?.[0]?.stock_item_id) ?? item.stock_item_id;
      for (const [lote, quantidade] of Object.entries(itemSel)) {
        if (quantidade <= 0) continue;
        const key = `${expStockItemId}||${lote}`;
        const ex = snapMap.get(key);
        if (ex) ex.quantidade += quantidade;
        else snapMap.set(key, { pedido_item_id: item.ids[0], stock_item_id: expStockItemId, lote, quantidade, device_model: item.device_model });
      }
    }
    const snapshot = [...snapMap.values()];

    const { error } = await supabase
      .from("pedidos_comerciais")
      .update({
        status: "separando",
        lotes_separados: snapshot,
        separado_por: user.id,
        separado_em: new Date().toISOString(),
      })
      .eq("id", pedido.id);

    if (error) { submittingRef.current = false; setSaving(false); toast.error("Erro ao iniciar separação."); return; }

    setSaving(false);
    submittingRef.current = false;
    setSaved(true);
    toast.success("Separação iniciada! Peças reservadas.");
    onClose();
    onSuccess();
  }

  if (!pedido) return null;

  // Valida: todos os itens devem ter seleção completa — sem estoque ou parcial BLOQUEIA
  const canConfirm = pedido.itens.every(item => {
    const sel = totalSelecionado(item.id);
    return sel === item.quantidade && sel > 0;
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
                                inputMode="numeric"
                                min={1}
                                max={l.quantity}
                                value={qtyRascunho[`${item.id}::${l.lote}`] ?? (qtySelected === 0 ? "" : String(qtySelected))}
                                onChange={e => {
                                  const raw = e.target.value;
                                  if (raw === "" || /^[0-9]+$/.test(raw)) {
                                    setQtyRascunho(prev => ({ ...prev, [`${item.id}::${l.lote}`]: raw }));
                                  }
                                }}
                                onBlur={e => {
                                  const v = parseInt(e.target.value, 10);
                                  setQtyLote(item.id, l.lote, isNaN(v) ? 0 : v, l.quantity);
                                  setQtyRascunho(prev => { const n = { ...prev }; delete n[`${item.id}::${l.lote}`]; return n; });
                                }}
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

        <div className="px-5 pb-5 pt-3 border-t border-border/20 space-y-2">
          {/* Mensagem de itens faltando */}
          {!canConfirm && !saving && !saved && (() => {
            const faltando = pedido.itens.filter(item => {
              const sel = totalSelecionado(item.id);
              return sel < item.quantidade || sel === 0;
            });
            return (
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 space-y-0.5">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Não é possível confirmar — itens incompletos:
                </div>
                {faltando.map(item => {
                  const sel = totalSelecionado(item.id);
                  const semEstoque = (lotesDisponiveis[item.id] ?? []).length === 0;
                  return (
                    <p key={item.id} className="text-[11px] text-destructive/80 pl-5">
                      • {item.device_model}: {semEstoque
                        ? "sem estoque na expedição"
                        : `faltam ${item.quantidade - sel} un.`}
                    </p>
                  );
                })}
              </div>
            );
          })()}
          <button
            type="button"
            onClick={handleConfirmar}
            disabled={saving || loading || saved || !canConfirm}
            className={cn(
              "w-full h-10 rounded-xl text-white text-sm font-semibold transition-all flex items-center justify-center gap-2",
              saving || saved ? "bg-blue-600 opacity-70" :
              canConfirm ? "bg-blue-600 hover:bg-blue-500" :
              "bg-destructive/80 cursor-not-allowed opacity-90"
            )}
          >
            {saving ? <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : saved ? <CheckCircle2 className="h-4 w-4" /> : canConfirm ? <ArrowRight className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            {saved ? "Confirmado!" : canConfirm ? "Confirmar e Reservar Peças" : "Peças insuficientes"}
          </button>
        </div>
      </div>
    </div>
  );
}
