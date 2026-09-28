/**
 * HistoricoDoItem — movimentações de uma peça (usado dentro do detalhe da peça).
 *
 * Movimentações são o histórico de rastreabilidade (ANVISA): NÃO são editadas
 * nem apagadas. Antes havia um botão que APAGAVA o movimento (RPC
 * cancel_movement). Agora a correção é feita com um novo lançamento de
 * ESTORNO (movimento contrário, mesmo lote e quantidade, com motivo
 * obrigatório e referência ao movimento original), preservando o histórico.
 */
import { useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, Loader2, RotateCcw, Tag, User } from "lucide-react";
import { useStockMovements, registerMovement, fetchLotesSummary } from "@/hooks/useStock";
import type { StockItem, StockMovement } from "@/hooks/useStock";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errorMessages";
import { cn } from "@/lib/utils";
import { fmtDataHora, fmtNum } from "./estoqueUi";

// Movimentos gerados automaticamente por transferências entre fases e por
// pedidos/NF: estornar só um lado deixaria as fases/pedidos inconsistentes.
const MOTIVOS_AUTOMATICOS = [
  /^Recebido de /i,
  /^Enviado para /i,
  /^Transfer/i,
  /^Retrabalho conclu/i,
  /^Rollback/i,
  /^Pedido comercial/i,
  /^Pedido /i,
  /^NF\s/i,
  /^Estorno/i,
];

const refDoMovimento = (id: string) => `[ref:${id.slice(0, 8)}]`;

export function podeEstornar(mv: StockMovement): boolean {
  const r = mv.reason ?? "";
  // Estornar uma saída = lançar uma ENTRADA, e o banco exige lote em toda
  // entrada (stock_movement_atomic). Saída sem lote não tem como ser estornada.
  if (mv.type === "saida" && !mv.lote?.trim()) return false;
  return !MOTIVOS_AUTOMATICOS.some(rx => rx.test(r));
}

interface Props {
  item: StockItem;
  podeEditar: boolean;
  onChanged: () => void;
}

export function HistoricoDoItem({ item, podeEditar, onChanged }: Props) {
  const { user } = useAuth();
  const displayName = (user?.user_metadata?.display_name as string | undefined) ?? user?.email ?? null;
  const { movements, loading, refetch } = useStockMovements(item.id, item.fase);
  const [estornando, setEstornando] = useState<StockMovement | null>(null);
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);

  const jaEstornados = new Set(
    movements
      .filter(m => (m.reason ?? "").startsWith("Estorno"))
      .map(m => (m.reason ?? "").match(/\[ref:([0-9a-f]{8})\]/i)?.[1])
      .filter(Boolean) as string[]
  );

  async function confirmarEstorno() {
    if (!estornando || motivo.trim().length < 3) return;
    setSalvando(true);
    const mv = estornando;
    const tipo = mv.type === "entrada" ? "saida" : "entrada";
    // Estorno de entrada com lote: o banco só confere o saldo TOTAL da peça.
    // Confere aqui o saldo livre DO LOTE (já descontadas as reservas de pedidos),
    // para não deixar o lote negativo nem tirar peça reservada.
    if (tipo === "saida" && mv.lote) {
      const lotes = await fetchLotesSummary(mv.stock_item_id, item.fase).catch(() => null);
      const saldoLote = lotes?.find(l => l.lote.toUpperCase() === mv.lote!.toUpperCase())?.saldo ?? 0;
      if (lotes && saldoLote < mv.quantity) {
        setSalvando(false);
        toast.error(`O lote ${mv.lote} tem só ${saldoLote} un. livres — não dá para estornar ${mv.quantity} un.`);
        return;
      }
    }
    const reason = `Estorno de ${mv.type === "entrada" ? "entrada" : "saída"} de ${fmtDataHora(mv.created_at)} — ${motivo.trim()} ${refDoMovimento(mv.id)}`;
    const r = await registerMovement(mv.stock_item_id, tipo, mv.quantity, reason, user?.id ?? null, displayName, mv.lote);
    setSalvando(false);
    if (!r.ok) { toast.error(r.error?.startsWith("Estoque insuficiente") ? "Saldo insuficiente para estornar esta entrada." : friendlyError(r.error, "Não foi possível registrar o estorno.")); return; }
    toast.success("Estorno registrado.", { description: `${tipo === "entrada" ? "+" : "−"}${mv.quantity} un.${mv.lote ? ` · Lote ${mv.lote}` : ""}` });
    setEstornando(null);
    setMotivo("");
    refetch();
    onChanged();
  }

  if (loading && movements.length === 0) {
    return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }
  if (movements.length === 0) {
    return <p className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">Nenhuma movimentação registrada.</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Últimas {movements.length} movimentações. O histórico não pode ser apagado — para corrigir um lançamento, use <strong>Estornar</strong> (gera um lançamento contrário).
      </p>
      <ul className="rounded-xl border divide-y overflow-hidden">
        {movements.map(mv => {
          const entrada = mv.type === "entrada";
          const ref = mv.id.slice(0, 8);
          const estornado = jaEstornados.has(ref);
          const aberto = estornando?.id === mv.id;
          return (
            <li key={mv.id} className={cn("px-3 py-2.5", estornado && "opacity-60")}>
              <div className="flex items-start gap-3">
                {entrada
                  ? <ArrowDownCircle className="h-5 w-5 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Entrada" />
                  : <ArrowUpCircle className="h-5 w-5 mt-0.5 shrink-0 text-red-600 dark:text-red-400" aria-label="Saída" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={cn("text-sm font-bold tabular-nums", entrada ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")}>
                      {entrada ? "+" : "−"}{fmtNum(mv.quantity)} un.
                    </span>
                    <span className="text-[11px] text-muted-foreground shrink-0">{fmtDataHora(mv.created_at)}</span>
                  </div>
                  {mv.lote && (
                    <p className="flex items-center gap-1 text-xs font-mono font-semibold mt-0.5"><Tag className="h-3 w-3 text-muted-foreground" />Lote {mv.lote}</p>
                  )}
                  {mv.reason && <p className="text-xs text-muted-foreground mt-0.5 break-words">{mv.reason}</p>}
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    {mv.user_display_name
                      ? <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><User className="h-3 w-3" />{mv.user_display_name}</p>
                      : <span />}
                    {estornado && <span className="text-[11px] font-medium text-muted-foreground">estornado</span>}
                    {podeEditar && !estornado && podeEstornar(mv) && !aberto && (
                      <button
                        type="button"
                        onClick={() => { setEstornando(mv); setMotivo(""); }}
                        className="inline-flex items-center gap-1 h-8 px-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />Estornar
                      </button>
                    )}
                  </div>
                  {aberto && (
                    <div className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
                      <p className="text-xs">
                        Será lançada uma <strong>{entrada ? "saída" : "entrada"}</strong> de <strong>{fmtNum(mv.quantity)} un.</strong>
                        {mv.lote ? <> no lote <strong className="font-mono">{mv.lote}</strong></> : null} para anular este movimento.
                      </p>
                      <Input
                        value={motivo}
                        onChange={e => setMotivo(e.target.value.slice(0, 200))}
                        placeholder="Motivo do estorno (obrigatório)"
                        className="h-11"
                        autoFocus
                        onKeyDown={e => { if (e.key === "Enter") confirmarEstorno(); }}
                      />
                      <div className="flex gap-2">
                        <Button variant="outline" className="flex-1 h-10" onClick={() => setEstornando(null)} disabled={salvando}>Voltar</Button>
                        <Button className="flex-1 h-10 gap-1.5" onClick={confirmarEstorno} disabled={salvando || motivo.trim().length < 3}>
                          {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}Estornar
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
