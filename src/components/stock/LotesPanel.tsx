/**
 * LotesDoItem — lotes com saldo de uma peça (usado dentro do detalhe da peça).
 *
 * Mantém a lógica do antigo LotesPanel:
 *  - Expedição: busca ao vivo quantidade e reservas (pedidos pendentes/separando)
 *    e reconcilia os saldos por lote (FIFO) com o disponível real.
 *  - Retrabalho: se não houver movimentos com lote, mostra o lote gravado em
 *    notes ("lote:XXXX | ...") como referência.
 *  - Intermediário: mostra entradas/saídas por lote.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchLotesSummary } from "@/hooks/useStock";
import type { LoteSummary, StockItem } from "@/hooks/useStock";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { fmtDataHora, fmtNum } from "./estoqueUi";

async function carregarAoVivo(id: string): Promise<{ qty: number | null; reserved: number }> {
  const { data: si } = await supabase.from("stock_items").select("quantity").eq("id", id).maybeSingle();
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
  return { qty: (si as { quantity: number } | null)?.quantity ?? null, reserved };
}

function reconciliar(lotes: LoteSummary[], disponivel: number): LoteSummary[] {
  const soma = lotes.reduce((s, l) => s + l.saldo, 0);
  if (soma === disponivel) return lotes;
  // Redistribui do lote mais antigo para o mais novo, limitado ao saldo bruto de cada um
  const ordenados = [...lotes].sort((a, b) => a.last_movement.localeCompare(b.last_movement));
  let restante = disponivel;
  return ordenados
    .map(l => {
      const bruto = l.total_entrada - l.total_saida;
      const atribuir = Math.min(bruto, Math.max(0, restante));
      restante = Math.max(0, restante - atribuir);
      return { ...l, saldo: atribuir };
    })
    .filter(l => l.saldo > 0);
}

interface Props {
  item: StockItem;
  /** Chamado quando os valores ao vivo da expedição chegam (para o cabeçalho do detalhe). */
  onAoVivo?: (v: { qty: number; reserved: number }) => void;
}

export function LotesDoItem({ item, onAoVivo }: Props) {
  const [lotes, setLotes] = useState<LoteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [aoVivo, setAoVivo] = useState<{ qty: number | null; reserved: number } | null>(null);
  const isExpedicao = item.fase === "expedicao";
  const onAoVivoRef = useRef(onAoVivo);
  onAoVivoRef.current = onAoVivo;

  const load = useCallback(async (cancelado?: () => boolean) => {
    setLoading(true);
    try {
      const [data, live] = await Promise.all([
        fetchLotesSummary(item.id, item.fase),
        isExpedicao ? carregarAoVivo(item.id) : Promise.resolve(null),
      ]);
      if (cancelado?.()) return;
      setLotes(data);
      setAoVivo(live);
      if (live) onAoVivoRef.current?.({ qty: live.qty ?? item.quantity, reserved: live.reserved });
    } finally {
      if (!cancelado?.()) setLoading(false);
    }
  }, [item.id, item.fase, item.quantity, isExpedicao]);

  useEffect(() => {
    let cancel = false;
    load(() => cancel);
    return () => { cancel = true; };
  }, [load]);

  let lista = lotes.filter(l => l.saldo > 0);
  if (isExpedicao && aoVivo && lotes.length > 0) {
    const qty = aoVivo.qty ?? item.quantity;
    lista = reconciliar(lotes, Math.max(0, qty - aoVivo.reserved));
  }
  const totalEntrada = lotes.reduce((s, l) => s + l.total_entrada, 0);
  const totalSaida = lotes.reduce((s, l) => s + l.total_saida, 0);
  const loteNotas = item.fase === "retrabalho" ? (item.notes ?? "").match(/lote:([^\s|]+)/i)?.[1]?.toUpperCase() ?? null : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {loading ? "Carregando lotes..." : `${lista.length} lote${lista.length !== 1 ? "s" : ""} com saldo`}
          {isExpedicao && !loading && <span className="block text-xs">Saldos já descontam o que está reservado em pedidos.</span>}
        </p>
        <Button variant="outline" size="sm" className="h-9 gap-1.5 shrink-0" onClick={() => load()} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />Atualizar
        </Button>
      </div>

      {item.fase === "intermediaria" && !loading && lotes.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border bg-emerald-500/5 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Entraram</p>
            <p className="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{fmtNum(totalEntrada)}</p>
          </div>
          <div className="rounded-xl border bg-red-500/5 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Saíram</p>
            <p className="text-lg font-bold tabular-nums text-red-600 dark:text-red-400">{fmtNum(totalSaida)}</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : lista.length === 0 ? (
        <div className="rounded-xl border border-dashed py-8 text-center space-y-1">
          <Tag className="h-6 w-6 mx-auto text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">Nenhum lote com saldo.</p>
          {loteNotas
            ? <p className="text-xs text-muted-foreground">Lote registrado no envio para retrabalho: <span className="font-mono font-semibold">{loteNotas}</span></p>
            : <p className="text-xs text-muted-foreground">Os lotes aparecem aqui depois de registrar uma entrada.</p>}
        </div>
      ) : (
        <ul className="rounded-xl border divide-y overflow-hidden">
          {lista.map(l => {
            const pctSaiu = l.total_entrada > 0 ? Math.min(100, Math.round((l.total_saida / l.total_entrada) * 100)) : 0;
            return (
              <li key={l.lote} className="px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-base font-bold tracking-wider break-all">{l.lote}</p>
                    <p className="text-[11px] text-muted-foreground">Último movimento {fmtDataHora(l.last_movement)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-bold tabular-nums leading-none">{fmtNum(l.saldo)}</p>
                    <p className="text-[11px] text-muted-foreground">un.</p>
                  </div>
                </div>
                {item.fase === "intermediaria" && l.total_entrada > 0 && (
                  <div className="mt-2">
                    <div className="h-1.5 rounded-full bg-emerald-500/40 overflow-hidden flex justify-end">
                      <div className="h-full bg-red-400/70" style={{ width: `${pctSaiu}%` }} />
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">{fmtNum(l.total_entrada)} entraram · {fmtNum(l.total_saida)} saíram</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
