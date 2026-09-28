/**
 * PedidosEstoquePanel — aba "Pedidos" do Estoque (separação dos pedidos do Comercial).
 *
 * Etapas (o que o estoque vê):
 *  1. Separar  — pedido confirmado pelo Comercial chega como "separando", com as
 *                peças já reservadas. O estoque escolhe os lotes de cada peça
 *                (sugestão automática: lotes mais antigos primeiro). Com mais de
 *                uma peça, cada uma é confirmada individualmente.
 *  2. Pronto   — "Marcar como pronto" baixa as peças da expedição por lote
 *                (RPC marcar_pedido_pronto) e o pedido aguarda a nota fiscal.
 *  3. Faturado/Enviado — feito pelo Financeiro ao emitir a NF (só acompanhamento).
 *
 * Também: retornar ao Comercial, remover peça, editar endereço, cancelar (admin)
 * e impressão (pedido individual e relatório do mês).
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useConfirmEnter } from "@/hooks/useConfirmEnter";
import { displayLote } from "@/lib/lote";
import {
  AlertTriangle, Ban, Check, CheckCircle2, ChevronDown, Clock, Loader2, MapPin, Minus, Package,
  Plus, Printer, RefreshCw, RotateCcw, ShoppingBag, Tag, Trash2, Truck, User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { fetchLotesDisponivelBatch } from "@/hooks/useStock";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SearchInputWithBarcode } from "@/components/SearchInputWithBarcode";
import { imprimirPedido, imprimirPedidosDoMes } from "./pedidosImpressao";
import type { LoteDisponivel, LoteSelecao, LoteSeparado, Pedido, PedidoItem } from "./pedidosTipos";
import { Chip, DIALOG_CLS } from "./estoqueUi";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

const STATUS_CFG: Record<string, { label: string; chip: string; barra: string }> = {
  separando: { label: "Separar",   chip: "bg-blue-500/15 text-blue-700 dark:text-blue-300",        barra: "bg-blue-500" },
  pronto:    { label: "Pronto",    chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", barra: "bg-emerald-500" },
  faturado:  { label: "Faturado",  chip: "bg-violet-500/15 text-violet-700 dark:text-violet-300",   barra: "bg-violet-500" },
  enviado:   { label: "Enviado",   chip: "bg-sky-500/15 text-sky-700 dark:text-sky-300",            barra: "bg-sky-500" },
  retorno:   { label: "Retornado", chip: "bg-orange-500/15 text-orange-700 dark:text-orange-300",   barra: "bg-orange-500" },
};

const ETAPAS = ["Separar", "Pronto", "Faturado", "Enviado"] as const;
const ETAPA_IDX: Record<string, number> = { separando: 0, pronto: 1, faturado: 2, enviado: 3 };

/** Barra de etapas: Separar → Pronto → Faturado → Enviado */
function Etapas({ status }: { status: string }) {
  if (status === "retorno") {
    return (
      <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-orange-700 dark:text-orange-300">
        <RotateCcw className="h-3.5 w-3.5" />Devolvido ao Comercial para revisão
      </p>
    );
  }
  const atual = ETAPA_IDX[status] ?? 0;
  return (
    <ol className="mt-2.5 grid grid-cols-4 gap-1" aria-label="Etapas do pedido">
      {ETAPAS.map((e, i) => (
        <li key={e} className="min-w-0" aria-current={i === atual ? "step" : undefined}>
          <div className={cn("h-1.5 rounded-full", i < atual ? "bg-emerald-500" : i === atual ? (STATUS_CFG[status]?.barra ?? "bg-primary") : "bg-muted")} />
          <p className={cn("mt-1 text-[11px] truncate", i === atual ? "font-semibold text-foreground" : "text-muted-foreground")}>{e}</p>
        </li>
      ))}
    </ol>
  );
}

// ─── Card de Pedido ───────────────────────────────────────────────────────────

interface PedidoCardProps {
  pedido: Pedido;
  onExpandChange?: (pedidoId: string, expanded: boolean) => void;
  onMarcarPronto: (pedido: Pedido, lotesSelecionados: LoteSelecao, expIdByItem: Record<string, string>) => Promise<void>;
  onCancelar: (pedido: Pedido) => void;
  onRetornar: (pedido: Pedido) => void;
  onRemoverItem: (pedido: Pedido, item: PedidoItem) => void;
  onEditarEndereco: (pedido: Pedido) => void;
  isAdmin: boolean;
}

function PedidoCard({ pedido, onExpandChange, onMarcarPronto, onCancelar, onRetornar, onRemoverItem, onEditarEndereco, isAdmin }: PedidoCardProps) {
  const [expanded, setExpanded] = useState(false);

  // O painel pai não recarrega via Realtime enquanto há separação aberta neste card
  useEffect(() => {
    onExpandChange?.(pedido.id, expanded);
    return () => { onExpandChange?.(pedido.id, false); };
  }, [expanded, pedido.id, onExpandChange]);

  // expId por item: o stock_item real da expedição (pode diferir de pedido_item.stock_item_id)
  const [expIdByItem, setExpIdByItem] = useState<Record<string, string>>({});
  const [lotesDisp, setLotesDisp] = useState<Record<string, LoteDisponivel[]>>({});
  const [sel, setSel] = useState<LoteSelecao>({});
  // Rascunho do campo de quantidade por lote — só vira seleção no onBlur, para
  // o lote não ser desmarcado a cada tecla ao apagar e redigitar.
  const [qtyRascunho, setQtyRascunho] = useState<Record<string, string>>({});
  const [loadingLotes, setLoadingLotes] = useState(false);
  const loadedRef = useRef(false);
  // Confirmação por peça (pedidos com mais de uma peça) — por stock_item_id (estável entre recargas)
  const [confirmedItems, setConfirmedItems] = useState<Set<string>>(new Set());
  const confirmedItemsRef = useRef<Set<string>>(new Set());
  const [savingItem, setSavingItem] = useState<string | null>(null);
  const [concluindo, setConcluindo] = useState(false);
  const [imprimindo, setImprimindo] = useState(false);

  // Se o pedido ganhou/perdeu peças, recarrega os lotes na próxima expansão
  const itemCountRef = useRef(pedido.itens.length);
  if (pedido.itens.length !== itemCountRef.current) {
    itemCountRef.current = pedido.itens.length;
    loadedRef.current = false;
    confirmedItemsRef.current = new Set();
  }

  const isSeparando = pedido.status === "separando";
  const totalItens = pedido.itens.reduce((s, i) => s + i.quantidade, 0);
  const multiPecas = pedido.itens.length > 1;

  // ── Carrega lotes ao expandir ────────────────────────────────────────────
  useEffect(() => {
    if (!expanded || loadedRef.current) return;
    loadedRef.current = true;
    setLoadingLotes(true);

    async function load() {
      // 1. Resolve o item de expedição de cada peça (intermediária → expedição se preciso)
      const itemIds = pedido.itens.map(i => i.stock_item_id);
      const { data: siRows } = await supabase
        .from("stock_items")
        .select("id, device_id, quantity, quantity_reserved, fase")
        .in("id", itemIds);
      const siMap = new Map((siRows ?? []).map((r: Record<string, unknown>) => [r.id as string, r]));
      const nonExpDeviceIds = (siRows ?? [])
        .filter((r: Record<string, unknown>) => r.fase !== "expedicao")
        .map((r: Record<string, unknown>) => r.device_id as string);

      const expMap = new Map<string, { id: string; quantity: number; quantity_reserved: number }>();
      if (nonExpDeviceIds.length > 0) {
        const { data: expRows } = await supabase
          .from("stock_items")
          .select("id, device_id, quantity, quantity_reserved")
          .in("device_id", nonExpDeviceIds)
          .eq("fase", "expedicao");
        for (const r of (expRows ?? []) as { id: string; device_id: string; quantity: number; quantity_reserved: number }[]) {
          expMap.set(r.device_id, r);
        }
      }

      const newExpIdByItem: Record<string, string> = {};
      const expIds: string[] = [];
      for (const item of pedido.itens) {
        const si = siMap.get(item.stock_item_id) as { device_id: string; fase: string } | undefined;
        let expId = item.stock_item_id;
        if (si && si.fase !== "expedicao") {
          const exp = expMap.get(si.device_id);
          if (exp) expId = exp.id;
        }
        newExpIdByItem[item.id] = expId;
        expIds.push(expId);
      }
      setExpIdByItem(newExpIdByItem);

      // 2. Lotes disponíveis de cada item (desconsidera as reservas deste próprio pedido)
      const lotesMap = await fetchLotesDisponivelBatch([...new Set(expIds)], pedido.id);
      const newLotesDisp: Record<string, LoteDisponivel[]> = {};
      for (const item of pedido.itens) {
        const expId = newExpIdByItem[item.id];
        const saldos = lotesMap.get(expId) ?? {};
        newLotesDisp[item.id] = Object.entries(saldos)
          .map(([lote, qty]) => ({ lote, quantity: Math.max(0, qty), stock_item_id: expId }))
          .filter(l => l.quantity > 0);
      }
      setLotesDisp(newLotesDisp);

      // 3. Seleção inicial: restaura o que já foi separado (lotes_separados) ou sugere FIFO
      const newSel: LoteSelecao = {};
      if (pedido.status === "separando" && (pedido.lotes_separados ?? []).length > 0) {
        const snapByExpId = new Map<string, { lote: string; quantidade: number }[]>();
        for (const ls of pedido.lotes_separados!) {
          if (!snapByExpId.has(ls.stock_item_id)) snapByExpId.set(ls.stock_item_id, []);
          const arr = snapByExpId.get(ls.stock_item_id)!;
          const ex = arr.find(x => x.lote === ls.lote);
          if (ex) ex.quantidade += ls.quantidade;
          else arr.push({ lote: ls.lote, quantidade: ls.quantidade });
        }
        // Se mais de um item aponta para o mesmo expId, divide proporcionalmente
        const expIdItemMap = new Map<string, PedidoItem[]>();
        for (const item of pedido.itens) {
          const expId = newExpIdByItem[item.id];
          if (!expIdItemMap.has(expId)) expIdItemMap.set(expId, []);
          expIdItemMap.get(expId)!.push(item);
        }
        for (const item of pedido.itens) {
          const expId = newExpIdByItem[item.id];
          const snapEntries = snapByExpId.get(expId) ?? [];
          const siblings = expIdItemMap.get(expId) ?? [item];
          const totalSiblingQty = siblings.reduce((s, i) => s + i.quantidade, 0);
          const ratio = totalSiblingQty > 0 ? item.quantidade / totalSiblingQty : 1;
          const dist: Record<string, number> = {};
          for (const s of snapEntries) {
            const q = Math.round(s.quantidade * ratio);
            if (q > 0) dist[s.lote] = q;
          }
          newSel[item.id] = dist;
        }
      } else {
        for (const item of pedido.itens) {
          const dist: Record<string, number> = {};
          let restante = item.quantidade;
          for (const l of newLotesDisp[item.id] ?? []) {
            if (restante <= 0) break;
            const usar = Math.min(l.quantity, restante);
            dist[l.lote] = usar;
            restante -= usar;
          }
          newSel[item.id] = dist;
        }
      }
      setSel(newSel);
      setLoadingLotes(false);
    }

    load().catch(err => { logger.error("PedidoCard load:", err); setLoadingLotes(false); toast.error("Não foi possível carregar os lotes deste pedido."); });
    // Intencional: só roda na primeira expansão; atualizações do pedido chegam pelo Realtime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  // ── Seleção ─────────────────────────────────────────────────────────────
  function totalSel(itemId: string) {
    return Object.values(sel[itemId] ?? {}).reduce((s, q) => s + q, 0);
  }
  function setQtyLote(itemId: string, lote: string, qty: number, maxQty: number) {
    setSel(prev => {
      const curr = { ...(prev[itemId] ?? {}) };
      if (qty <= 0) delete curr[lote];
      else curr[lote] = Math.min(qty, maxQty);
      return { ...prev, [itemId]: curr };
    });
  }
  function toggleLote(itemId: string, lote: string, maxQty: number) {
    setSel(prev => {
      const curr = { ...(prev[itemId] ?? {}) };
      if (curr[lote]) delete curr[lote];
      else {
        const falta = Math.max(1, (pedido.itens.find(i => i.id === itemId)?.quantidade ?? 1) - Object.values(curr).reduce((s, q) => s + q, 0));
        curr[lote] = Math.min(maxQty, falta);
      }
      return { ...prev, [itemId]: curr };
    });
  }

  // Pronto só libera com todas as peças completas (multi-peça: cada uma confirmada)
  const canMarcarPronto = isSeparando && !loadingLotes && pedido.itens.every(item => {
    if (multiPecas) return confirmedItems.has(item.stock_item_id);
    const s = totalSel(item.id);
    return s === item.quantidade && s > 0;
  });

  // Confirma uma peça durante a separação: grava o snapshot de lotes e marca localmente
  async function handleConfirmarItem(item: PedidoItem) {
    if (savingItem) return;
    setSavingItem(item.stock_item_id);
    try {
      const snapshotMap = new Map<string, { pedido_item_id: string; stock_item_id: string; lote: string; quantidade: number; device_model?: string }>();
      for (const ls of pedido.lotes_separados ?? []) {
        const ownerItem = pedido.itens.find(
          i => (expIdByItem[i.id] ?? i.stock_item_id) === ls.stock_item_id && i.id !== item.id
        );
        if (!ownerItem) continue; // entradas desta peça serão substituídas
        const key = `${ls.stock_item_id}||${ls.lote}`;
        const ex = snapshotMap.get(key);
        if (ex) ex.quantidade += ls.quantidade;
        else snapshotMap.set(key, { pedido_item_id: ownerItem.ids[0], stock_item_id: ls.stock_item_id, lote: ls.lote, quantidade: ls.quantidade, device_model: ls.device_model });
      }
      const expId = expIdByItem[item.id] ?? item.stock_item_id;
      for (const [lote, qty] of Object.entries(sel[item.id] ?? {})) {
        if (qty <= 0) continue;
        const key = `${expId}||${lote}`;
        const ex = snapshotMap.get(key);
        if (ex) ex.quantidade += qty;
        else snapshotMap.set(key, { pedido_item_id: item.ids[0], stock_item_id: expId, lote, quantidade: qty, device_model: item.device_model });
      }
      const { error } = await supabase
        .from("pedidos_comerciais")
        .update({ lotes_separados: [...snapshotMap.values()] })
        .eq("id", pedido.id);
      if (error) { toast.error("Erro ao confirmar peça."); return; }
      confirmedItemsRef.current = new Set([...confirmedItemsRef.current, item.stock_item_id]);
      setConfirmedItems(new Set(confirmedItemsRef.current));
      toast.success(`${item.device_model ?? "Peça"} confirmada.`);
    } catch (_e) {
      toast.error("Erro ao confirmar peça.");
    } finally {
      setSavingItem(null);
    }
  }

  async function concluir() {
    if (!canMarcarPronto || concluindo) return;
    setConcluindo(true);
    try { await onMarcarPronto(pedido, sel, expIdByItem); } finally { setConcluindo(false); }
  }

  async function imprimir() {
    setImprimindo(true);
    try { await imprimirPedido(pedido, sel, expIdByItem); }
    catch (err) { logger.error("imprimirPedido:", err); toast.error("Não foi possível gerar a impressão."); }
    finally { setImprimindo(false); }
  }

  // ── Agrupa itens por peça para mostrar nome/ref uma vez ─────────────────
  const groupedItens = useMemo(() => {
    const seen = new Map<string, PedidoItem[]>();
    for (const item of pedido.itens) {
      const k = `${item.device_model}|||${item.device_reference}`;
      if (!seen.has(k)) seen.set(k, []);
      seen.get(k)!.push(item);
    }
    return [...seen.entries()].map(([key, items]) => ({ key, items }));
  }, [pedido.itens]);

  const cfg = STATUS_CFG[pedido.status] ?? { label: pedido.status, chip: "bg-muted text-muted-foreground", barra: "bg-muted" };
  const localEntrega = pedido.endereco_entrega
    || (pedido.cliente_municipio ? `${pedido.cliente_municipio}${pedido.cliente_uf ? "/" + pedido.cliente_uf : ""}` : null);
  const prazoAtrasado = !!pedido.prazo_entrega && isSeparando && new Date(pedido.prazo_entrega + "T23:59:59") < new Date();
  const totalConfirmed = pedido.itens.filter(i => confirmedItems.has(i.stock_item_id)).length;

  return (
    <li className={cn("rounded-2xl border bg-card overflow-hidden", isSeparando && "border-blue-500/40", expanded && "shadow-sm")}>
      <button type="button" onClick={() => setExpanded(v => !v)} aria-expanded={expanded}
        className="w-full text-left p-4 flex items-start gap-3 hover:bg-muted/30">
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold leading-snug line-clamp-2">{pedido.cliente_nome}</p>
            <Chip className={cn(cfg.chip, "shrink-0")}>{cfg.label}</Chip>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span className="font-mono font-semibold text-foreground/80">#{pedido.id.slice(0, 8).toUpperCase()}</span>
            <span className="inline-flex items-center gap-1"><Package className="h-3 w-3" />{totalItens} un. · {pedido.itens.length} peça{pedido.itens.length !== 1 ? "s" : ""}</span>
            {pedido.vendedora_nome && <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />{pedido.vendedora_nome}</span>}
            <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{fmtDate(pedido.created_at)} {fmtTime(pedido.created_at)}</span>
          </div>
          {(localEntrega || pedido.prazo_entrega) && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
              {localEntrega && <span className="inline-flex items-center gap-1 text-muted-foreground min-w-0"><MapPin className="h-3 w-3 shrink-0" /><span className="truncate max-w-[16rem]">{localEntrega}</span></span>}
              {pedido.prazo_entrega && (
                <span className={cn("inline-flex items-center gap-1 font-medium", prazoAtrasado ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-400")}>
                  <Clock className="h-3 w-3" />Entrega {new Date(pedido.prazo_entrega + "T12:00:00").toLocaleDateString("pt-BR")}{prazoAtrasado ? " (atrasado)" : ""}
                </span>
              )}
            </div>
          )}
          <Etapas status={pedido.status} />
        </div>
        <ChevronDown className={cn("h-5 w-5 text-muted-foreground shrink-0 mt-0.5 transition-transform", expanded && "rotate-180")} />
      </button>

      {expanded && (
        <div className="border-t px-3 sm:px-4 py-4 space-y-3">
          {pedido.observacoes && (
            <p className="rounded-xl bg-muted/50 px-3 py-2 text-sm"><span className="font-medium">Obs.:</span> {pedido.observacoes}</p>
          )}

          {isSeparando && !loadingLotes && (
            <p className="text-xs text-muted-foreground">
              Marque os lotes que vão sair e ajuste as quantidades. Sugerimos os lotes mais antigos primeiro.
              {multiPecas && " Confirme cada peça e depois marque o pedido como pronto."}
            </p>
          )}

          {loadingLotes ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando lotes...</div>
          ) : (
            <div className="space-y-3">
              {groupedItens.map(({ key: groupKey, items: groupItems }) => {
                const firstItem = groupItems[0];
                const groupTotal = groupItems.reduce((s, i) => s + i.quantidade, 0);
                return (
                  <section key={groupKey} className="rounded-xl border overflow-hidden">
                    <header className="flex items-center gap-2 px-3 py-2.5 bg-muted/40 border-b">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold leading-snug">{firstItem.device_model}</p>
                        <p className="text-xs text-muted-foreground font-mono">{firstItem.device_reference}</p>
                      </div>
                      <span className="text-sm font-bold tabular-nums shrink-0">{groupTotal} un.</span>
                      {isSeparando && multiPecas && (
                        <Button size="icon" variant="ghost" className="h-9 w-9 text-red-600 hover:text-red-700 hover:bg-red-500/10 shrink-0"
                          onClick={() => onRemoverItem(pedido, firstItem)} title="Remover peça do pedido" aria-label="Remover peça do pedido">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </header>

                    <div className="divide-y">
                      {groupItems.map(item => {
                        const lotes = lotesDisp[item.id] ?? [];
                        const selTotal = totalSel(item.id);
                        const itemOk = selTotal === item.quantidade;
                        const isConfirmed = confirmedItems.has(item.stock_item_id);
                        return (
                          <div key={item.id} className="p-3 space-y-2">
                            {groupItems.length > 1 && <p className="text-xs text-muted-foreground">Item: {item.quantidade} un.</p>}

                            {isSeparando && (
                              lotes.length === 0 ? (
                                <p className="flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
                                  <AlertTriangle className="h-4 w-4 shrink-0" />Sem saldo desta peça na expedição.
                                </p>
                              ) : (
                                <>
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Lotes na expedição</p>
                                    <Chip className={itemOk ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : selTotal > 0 ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-muted text-muted-foreground"}>
                                      {selTotal}/{item.quantidade} separadas
                                    </Chip>
                                  </div>
                                  <ul className="space-y-1.5">
                                    {lotes.map(l => {
                                      const qtySel = sel[item.id]?.[l.lote] ?? 0;
                                      const isSel = qtySel > 0;
                                      const rk = `${item.id}::${l.lote}`;
                                      return (
                                        <li key={l.lote} className={cn("flex items-center gap-2 rounded-xl border pl-1 pr-2 min-h-[52px]", isSel ? "border-blue-500/50 bg-blue-500/10" : "bg-background")}>
                                          <button type="button" onClick={() => toggleLote(item.id, l.lote, l.quantity)} disabled={isConfirmed}
                                            className="flex-1 min-w-0 flex items-center gap-3 py-2 pl-2 text-left disabled:opacity-70" aria-pressed={isSel}>
                                            <span className={cn("h-6 w-6 rounded-md border-2 flex items-center justify-center shrink-0", isSel ? "bg-blue-600 border-blue-600 text-white" : "border-muted-foreground/40")}>
                                              {isSel && <Check className="h-4 w-4" />}
                                            </span>
                                            <span className="min-w-0">
                                              <span className="block font-mono text-[15px] font-bold tracking-wide break-all">{l.lote}</span>
                                              <span className="block text-xs text-muted-foreground">{l.quantity} disponíveis</span>
                                            </span>
                                          </button>
                                          {isSel && !isConfirmed && (
                                            <div className="flex items-center gap-1 shrink-0">
                                              <button type="button" onClick={() => setQtyLote(item.id, l.lote, qtySel - 1, l.quantity)}
                                                className="h-9 w-9 rounded-lg border bg-card flex items-center justify-center hover:bg-muted" aria-label="Diminuir">
                                                <Minus className="h-4 w-4" />
                                              </button>
                                              <input
                                                type="text" inputMode="numeric" aria-label={`Quantidade do lote ${l.lote}`}
                                                value={qtyRascunho[rk] ?? String(qtySel)}
                                                onChange={e => { const raw = e.target.value; if (raw === "" || /^[0-9]+$/.test(raw)) setQtyRascunho(p => ({ ...p, [rk]: raw })); }}
                                                onBlur={e => {
                                                  const v = parseInt(e.target.value, 10);
                                                  setQtyLote(item.id, l.lote, isNaN(v) ? 0 : v, l.quantity);
                                                  setQtyRascunho(p => { const n = { ...p }; delete n[rk]; return n; });
                                                }}
                                                className="w-14 h-9 rounded-lg border bg-background text-center text-sm font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                                              />
                                              <button type="button" onClick={() => setQtyLote(item.id, l.lote, qtySel + 1, l.quantity)}
                                                className="h-9 w-9 rounded-lg border bg-card flex items-center justify-center hover:bg-muted" aria-label="Aumentar">
                                                <Plus className="h-4 w-4" />
                                              </button>
                                            </div>
                                          )}
                                          {isSel && isConfirmed && <span className="text-sm font-bold tabular-nums shrink-0 pr-1">{qtySel} un.</span>}
                                        </li>
                                      );
                                    })}
                                  </ul>
                                  {!itemOk && selTotal > 0 && (
                                    <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                                      <AlertTriangle className="h-3.5 w-3.5" />
                                      {selTotal < item.quantidade ? `Faltam ${item.quantidade - selTotal} un.` : `Passou ${selTotal - item.quantidade} un. do pedido`}
                                    </p>
                                  )}
                                </>
                              )
                            )}

                            {/* Confirmação por peça (pedido com várias peças) */}
                            {isSeparando && multiPecas && lotes.length > 0 && (
                              isConfirmed ? (
                                <p className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                                  <CheckCircle2 className="h-4 w-4" />Peça confirmada na separação
                                </p>
                              ) : (
                                <Button className="w-full h-10 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                                  disabled={!itemOk || !!savingItem} onClick={() => handleConfirmarItem(item)}>
                                  {savingItem === item.stock_item_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                  {itemOk ? "Confirmar esta peça" : "Escolha os lotes para confirmar"}
                                </Button>
                              )
                            )}

                            {/* Pronto em diante: lotes que saíram */}
                            {!isSeparando && (() => {
                              const entries = (pedido.lotes_separados ?? []).filter(ls =>
                                ls.stock_item_id === (expIdByItem[item.id] ?? item.stock_item_id) || ls.device_model === item.device_model);
                              const agg: Record<string, number> = {};
                              for (const ls of entries) agg[ls.lote] = (agg[ls.lote] ?? 0) + ls.quantidade;
                              const lista = Object.entries(agg).filter(([lote]) => displayLote(lote));
                              if (lista.length === 0) return <p className="text-xs text-muted-foreground">Lotes ainda não definidos.</p>;
                              return (
                                <div className="flex flex-wrap gap-1.5">
                                  {lista.map(([lote, qty]) => (
                                    <span key={lote} className="inline-flex items-center gap-1.5 rounded-lg border bg-muted/40 px-2.5 py-1.5">
                                      <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                                      <span className="font-mono text-sm font-bold tracking-wide">{lote}</span>
                                      <span className="text-xs text-muted-foreground">{qty} un.</span>
                                    </span>
                                  ))}
                                </div>
                              );
                            })()}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {/* Situação / ação principal */}
          {isSeparando && (
            <div className="space-y-2 pt-1">
              {multiPecas && (
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{totalConfirmed}/{pedido.itens.length} peças confirmadas</span>
                  <span className="flex gap-1">
                    {pedido.itens.map(it => (
                      <span key={it.id} className={cn("h-1.5 w-5 rounded-full", confirmedItems.has(it.stock_item_id) ? "bg-emerald-500" : "bg-muted-foreground/25")} />
                    ))}
                  </span>
                </div>
              )}
              <Button className="w-full h-12 gap-2 text-base bg-emerald-600 hover:bg-emerald-700 text-white" disabled={!canMarcarPronto || concluindo} onClick={concluir}>
                {concluindo ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                {canMarcarPronto ? "Marcar como pronto" : multiPecas ? `Confirme todas as peças (${totalConfirmed}/${pedido.itens.length})` : "Escolha os lotes para concluir"}
              </Button>
              <p className="text-[11px] text-muted-foreground text-center">Ao marcar como pronto, as peças saem da expedição pelos lotes escolhidos.</p>
            </div>
          )}
          {pedido.status === "pronto" && (
            <p className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-3 text-sm font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />Separado. Aguardando a nota fiscal do Financeiro.
            </p>
          )}
          {pedido.status === "faturado" && (
            <p className="flex items-center gap-2 rounded-xl bg-violet-500/10 px-3 py-3 text-sm font-medium text-violet-700 dark:text-violet-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />Nota fiscal emitida. Aguardando envio.
            </p>
          )}
          {pedido.status === "enviado" && (
            <p className="flex items-center gap-2 rounded-xl bg-sky-500/10 px-3 py-3 text-sm font-medium text-sky-700 dark:text-sky-300">
              <Truck className="h-4 w-4 shrink-0" />NF emitida — pedido enviado.
            </p>
          )}
          {pedido.status === "retorno" && (
            <p className="flex items-center gap-2 rounded-xl bg-orange-500/10 px-3 py-3 text-sm font-medium text-orange-700 dark:text-orange-300">
              <RotateCcw className="h-4 w-4 shrink-0" />Com o Comercial para revisão. As reservas continuam valendo.
            </p>
          )}

          {/* Ações secundárias */}
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
            <Button variant="outline" className="h-10 gap-1.5" onClick={imprimir} disabled={imprimindo}>
              {imprimindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}Imprimir
            </Button>
            {isSeparando && (
              <>
                <Button variant="outline" className="h-10 gap-1.5" onClick={() => onEditarEndereco(pedido)}><MapPin className="h-4 w-4" />Endereço</Button>
                <Button variant="outline" className="h-10 gap-1.5 text-orange-700 dark:text-orange-400" onClick={() => onRetornar(pedido)}><RotateCcw className="h-4 w-4" />Devolver ao Comercial</Button>
                {isAdmin && (
                  <Button variant="outline" className="h-10 gap-1.5 text-red-600 dark:text-red-400" onClick={() => onCancelar(pedido)}><Ban className="h-4 w-4" />Cancelar pedido</Button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

// ─── Devolver pedido ao Comercial ─────────────────────────────────────────────

function RetornarPedidoDialog({ pedido, onClose, onSuccess }: { pedido: Pedido | null; onClose: () => void; onSuccess: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (pedido) setMotivo(""); }, [pedido]);

  async function handleRetornar() {
    if (!pedido) return;
    setSaving(true);
    try {
      // Status "retorno" — as reservas continuam valendo
      const { error } = await supabase
        .from("pedidos_comerciais")
        .update({ status: "retorno", observacoes: motivo.trim() ? ("[RETORNO] " + motivo.trim()) : null })
        .eq("id", pedido.id);
      if (error) throw error;
      if (pedido.vendedora_id) {
        await supabase.from("notificacoes").insert({
          user_id: pedido.vendedora_id,
          pedido_id: pedido.id,
          tipo: "pedido_retornado",
          titulo: "Pedido retornado ao comercial",
          mensagem: `O pedido de ${pedido.cliente_nome} foi retornado pelo estoque para revisão.${motivo.trim() ? " Motivo: " + motivo.trim() : ""}`,
        });
      }
      toast.success("Pedido devolvido ao Comercial. Reservas mantidas.");
      onSuccess();
      onClose();
    } catch (_e) {
      toast.error("Erro ao devolver o pedido.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!pedido} onOpenChange={v => { if (!v && !saving) onClose(); }}>
      <DialogContent className={cn(DIALOG_CLS, "max-w-md")}>
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-2"><RotateCcw className="h-5 w-5 text-orange-500" />Devolver ao Comercial?</DialogTitle>
          <DialogDescription>{pedido?.cliente_nome}</DialogDescription>
        </DialogHeader>
        <p className="rounded-xl bg-orange-500/10 px-3 py-2.5 text-sm text-orange-800 dark:text-orange-300">
          As peças continuam reservadas. O pedido fica como <strong>Retornado</strong> até o Comercial revisar. A vendedora é avisada.
        </p>
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Motivo (opcional)</span>
          <Textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={3} maxLength={500}
            placeholder="Ex.: quantidade errada, peça sem lote disponível..." />
        </label>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={onClose} disabled={saving}>Voltar</Button>
          <Button className="h-11 gap-1.5 bg-orange-600 hover:bg-orange-700 text-white" onClick={handleRetornar} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}Devolver
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Remover peça do pedido ───────────────────────────────────────────────────

function RemoverItemDialog({ pedido, item, onClose, onSuccess }: { pedido: Pedido | null; item: PedidoItem | null; onClose: () => void; onSuccess: () => void }) {
  const [saving, setSaving] = useState(false);
  useConfirmEnter(!!(pedido && item), handleRemover, saving);

  async function handleRemover() {
    if (!pedido || !item) return;
    setSaving(true);
    try {
      // RPC atômica por item — libera a reserva e devolve à expedição o que já tinha sido separado
      for (const id of item.ids) {
        const { data, error } = await supabase.rpc("remove_pedido_item", { p_pedido_item_id: id });
        const result = data as { ok?: boolean; error?: string } | null;
        if (error || result?.ok === false) throw new Error(result?.error ?? error?.message ?? "Erro ao remover item.");
      }
      const { data: itensRestantes } = await supabase
        .from("pedido_itens")
        .select("quantidade, preco_unitario")
        .eq("pedido_id", pedido.id);
      const novoTotal = (itensRestantes ?? []).reduce((s: number, i: { quantidade: number; preco_unitario: number | null }) => s + (i.quantidade * (i.preco_unitario ?? 0)), 0);
      const descontoLabel = (pedido.desconto_pct ?? 0) > 0 ? ` (com ${pedido.desconto_pct}% desc.)` : "";
      const totalFmt = novoTotal > 0 ? "R$ " + (novoTotal * (1 - (pedido.desconto_pct ?? 0) / 100)).toFixed(2).replace(".", ",") : null;
      if (pedido.vendedora_id) {
        await supabase.from("notificacoes").insert({
          user_id: pedido.vendedora_id,
          pedido_id: pedido.id,
          tipo: "peca_removida",
          titulo: "Peça removida do pedido pelo estoque",
          mensagem: `A peça "${item.device_model}" (${item.quantidade} un.) foi removida do pedido de ${pedido.cliente_nome} pelo estoque.${totalFmt ? ` Novo valor do pedido: ${totalFmt}${descontoLabel}.` : ""}`,
        });
      }
      toast.success(`${item.device_model ?? "Peça"} removida do pedido.`);
      onSuccess();
      onClose();
    } catch (_e) {
      toast.error("Erro ao remover peça.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AlertDialog open={!!(pedido && item)} onOpenChange={v => { if (!v && !saving) onClose(); }}>
      <AlertDialogContent className="w-[calc(100vw-1.5rem)] rounded-2xl">
        <AlertDialogHeader className="text-left">
          <AlertDialogTitle className="flex items-center gap-2"><Trash2 className="h-5 w-5 text-red-500" />Remover peça do pedido?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p><span className="font-medium text-foreground">{item?.device_model}</span> <span className="font-mono">{item?.device_reference}</span></p>
              <p>{item?.quantidade} un. serão liberadas da reserva. O Comercial ({pedido?.cliente_nome}) será avisado com o novo valor.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11" disabled={saving}>Voltar</AlertDialogCancel>
          <AlertDialogAction className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={saving}
            onClick={e => { e.preventDefault(); handleRemover(); }}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}Remover peça
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Editar endereço de entrega ───────────────────────────────────────────────

function EditarEnderecoDialog({ pedido, onClose, onSuccess }: { pedido: Pedido | null; onClose: () => void; onSuccess: () => void }) {
  const [endereco, setEndereco] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!pedido) return;
    setEndereco("");
    supabase
      .from("pedidos_comerciais")
      .select("endereco_entrega, usar_endereco_cliente")
      .eq("id", pedido.id)
      .maybeSingle()
      .then(({ data }) => setEndereco((data as { endereco_entrega?: string } | null)?.endereco_entrega ?? ""));
  }, [pedido]);

  async function handleSalvar() {
    if (!pedido) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("pedidos_comerciais")
        .update({ endereco_entrega: endereco.trim() || null, usar_endereco_cliente: !endereco.trim() })
        .eq("id", pedido.id);
      if (error) throw error;
      toast.success("Endereço de entrega atualizado.");
      onSuccess();
      onClose();
    } catch (_e) {
      toast.error("Erro ao salvar endereço.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!pedido} onOpenChange={v => { if (!v && !saving) onClose(); }}>
      <DialogContent className={cn(DIALOG_CLS, "max-w-md")}>
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-2"><MapPin className="h-5 w-5 text-blue-500" />Endereço de entrega</DialogTitle>
          <DialogDescription>{pedido?.cliente_nome}</DialogDescription>
        </DialogHeader>
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Endereço</span>
          <Textarea value={endereco} onChange={e => setEndereco(e.target.value)} rows={3} maxLength={400}
            placeholder="Rua, número, bairro, cidade/UF, CEP..." />
          <span className="block text-xs text-muted-foreground">Deixe em branco para usar o endereço do cadastro do cliente.</span>
        </label>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={onClose} disabled={saving}>Voltar</Button>
          <Button className="h-11 gap-1.5" onClick={handleSalvar} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Painel principal ─────────────────────────────────────────────────────────

type FiltroStatus = "separando" | "pronto" | "enviado" | "retorno" | "todos";
const STATUS_VISIVEIS = ["separando", "pronto", "faturado", "enviado", "retorno"];

interface PedidosEstoquePanelProps {
  isAdmin: boolean;
}

export function PedidosEstoquePanel({ isAdmin }: PedidosEstoquePanelProps) {
  const { user } = useAuth();
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filtro, setFiltro] = useState<FiltroStatus | null>(null);
  const [cancelarPedido, setCancelarPedido] = useState<Pedido | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [retornarPedido, setRetornarPedido] = useState<Pedido | null>(null);
  const [removerItem, setRemoverItem] = useState<{ pedido: Pedido; item: PedidoItem } | null>(null);
  const [editarEndereco, setEditarEndereco] = useState<Pedido | null>(null);
  const [imprimindo, setImprimindo] = useState(false);

  const loadAbortRef = useRef<AbortController | null>(null);
  const loadPedidos = useCallback(async () => {
    loadAbortRef.current?.abort();
    const ctrl = new AbortController();
    loadAbortRef.current = ctrl;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("pedidos_comerciais")
        .select(`
          id, cliente_id, vendedora_id, vendedora_nome, status, frete, observacoes,
          created_at, lotes_separados, separado_em, desconto_pct, prazo_entrega,
          endereco_entrega, usar_endereco_cliente,
          clientes!inner(nome, municipio, uf, telefone, endereco),
          pedido_itens(
            id, stock_item_id, lote, quantidade,
            stock_items!inner(
              id,
              devices!inner(model, reference)
            )
          )
        `)
        .in("status", STATUS_VISIVEIS)
        .order("created_at", { ascending: false })
        .abortSignal(ctrl.signal);

      if (ctrl.signal.aborted) return;
      if (error || !data) { if (error) toast.error("Erro ao carregar pedidos. Tente atualizar."); return; }

      type Cli = { nome: string; municipio?: string | null; uf?: string | null; telefone?: string | null; endereco?: string | null };
      type Dev = { devices: { model: string; reference: string } } | null;
      const mapped: Pedido[] = data.map((p: Record<string, unknown>) => {
        const cli = p.clientes as Cli;
        const rawItens = (p.pedido_itens as Record<string, unknown>[]) ?? [];
        const raw = rawItens.map(i => ({
          id: i.id as string,
          ids: [i.id as string],
          stock_item_id: i.stock_item_id as string,
          lote: i.lote as string,
          quantidade: i.quantidade as number,
          device_model: (i.stock_items as Dev)?.devices?.model,
          device_reference: (i.stock_items as Dev)?.devices?.reference,
        }));
        // Une linhas da mesma peça (mesmo stock_item) num item só
        const merged: Record<string, typeof raw[0]> = {};
        for (const item of raw) {
          if (merged[item.stock_item_id]) {
            merged[item.stock_item_id].quantidade += item.quantidade;
            merged[item.stock_item_id].ids.push(item.id);
          } else {
            merged[item.stock_item_id] = { ...item, ids: [...item.ids] };
          }
        }
        return {
          id: p.id as string,
          cliente_id: p.cliente_id as string,
          cliente_nome: cli.nome,
          cliente_municipio: cli.municipio ?? null,
          cliente_uf: cli.uf ?? null,
          cliente_telefone: cli.telefone ?? null,
          endereco_entrega: (p.usar_endereco_cliente !== false ? null : (p.endereco_entrega as string | null)) ?? null,
          vendedora_nome: p.vendedora_nome as string | null,
          vendedora_id: p.vendedora_id as string | null,
          status: p.status as string,
          frete: (p.frete as number) ?? 0,
          observacoes: p.observacoes as string | null,
          created_at: p.created_at as string,
          desconto_pct: (p.desconto_pct as number) ?? 0,
          prazo_entrega: (p.prazo_entrega as string | null) ?? null,
          lotes_separados: (p.lotes_separados as LoteSeparado[] | null) ?? null,
          itens: Object.values(merged),
          itens_raw: raw.map(({ stock_item_id, lote, quantidade, device_model, device_reference }) => ({ stock_item_id, lote, quantidade, device_model, device_reference })),
        };
      });
      setPedidos(mapped);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      logger.error("loadPedidos:", err);
      toast.error("Erro ao carregar pedidos. Tente atualizar a página.");
    } finally {
      if (loadAbortRef.current === ctrl) setLoading(false);
    }
  }, []);

  useEffect(() => { loadPedidos(); }, [loadPedidos]);

  // IDs de pedidos com card aberto — Realtime não recarrega enquanto a separação está em andamento
  const expandedPedidosRef = useRef<Set<string>>(new Set());
  const onExpandChange = useCallback((id: string, exp: boolean) => {
    if (exp) expandedPedidosRef.current.add(id);
    else expandedPedidosRef.current.delete(id);
  }, []);

  // Realtime: mudança de status recarrega sempre; mudança só de lotes_separados
  // num pedido aberto é ignorada (é a própria separação em andamento).
  useEffect(() => {
    const channel = supabase
      .channel(`pedidos-estoque-${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "pedidos_comerciais" }, (payload) => {
        const changedId = (payload.new as { id?: string })?.id ?? (payload.old as { id?: string })?.id;
        const oldStatus = (payload.old as { status?: string })?.status;
        const newStatus = (payload.new as { status?: string })?.status;
        if (oldStatus && newStatus && oldStatus !== newStatus) { loadPedidos(); return; }
        if (changedId && expandedPedidosRef.current.has(changedId)) return;
        loadPedidos();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadPedidos]);

  const contagem = useMemo(() => ({
    separando: pedidos.filter(p => p.status === "separando").length,
    pronto: pedidos.filter(p => p.status === "pronto").length,
    enviado: pedidos.filter(p => p.status === "faturado" || p.status === "enviado").length,
    retorno: pedidos.filter(p => p.status === "retorno").length,
    todos: pedidos.length,
  }), [pedidos]);

  // Filtro inicial: "Separar" se houver pedido esperando, senão "Todos"
  const filtroAtual: FiltroStatus = filtro ?? (loading && pedidos.length === 0 ? "separando" : contagem.separando > 0 ? "separando" : "todos");

  const filtrados = useMemo(() => {
    const q = searchQuery.trim().toLowerCase().replace(/^#/, "");
    return pedidos.filter(p => {
      if (filtroAtual === "enviado" ? !(p.status === "faturado" || p.status === "enviado") : filtroAtual !== "todos" && p.status !== filtroAtual) return false;
      if (!q) return true;
      return p.cliente_nome.toLowerCase().includes(q)
        || (p.vendedora_nome ?? "").toLowerCase().includes(q)
        || p.id.toLowerCase().startsWith(q);
    });
  }, [pedidos, filtroAtual, searchQuery]);

  const handleMarcarPronto = useCallback(async (
    pedido: Pedido,
    lotesSelecionados: LoteSelecao,
    expIdByItem: Record<string, string>
  ) => {
    if (!user) return;
    try {
      // 1. Snapshot de lotes_separados a partir da seleção atual (une expId+lote)
      const snapshotMap = new Map<string, { pedido_item_id: string; stock_item_id: string; lote: string; quantidade: number; device_model?: string }>();
      for (const item of pedido.itens) {
        const sel = lotesSelecionados[item.id] ?? {};
        const expStockItemId = expIdByItem[item.id] ?? item.stock_item_id;
        for (const [lote, quantidade] of Object.entries(sel)) {
          if (quantidade <= 0) continue;
          const key = `${expStockItemId}||${lote}`;
          const existing = snapshotMap.get(key);
          if (existing) existing.quantidade += quantidade;
          else snapshotMap.set(key, { pedido_item_id: item.ids[0], stock_item_id: expStockItemId, lote, quantidade, device_model: item.device_model });
        }
      }
      const snapshot = [...snapshotMap.values()];

      // 2. Grava lotes_separados (e o lote principal de cada item) ANTES da RPC
      if (snapshot.length > 0) {
        const updates: { id: string; lote: string | null }[] = [];
        for (const item of pedido.itens) {
          const sel = lotesSelecionados[item.id] ?? {};
          const lotePrincipal = Object.entries(sel).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
          for (const itemId of item.ids) updates.push({ id: itemId, lote: lotePrincipal });
        }
        await Promise.all(updates.map(u => supabase.from("pedido_itens").update({ lote: u.lote }).eq("id", u.id)));
        const { error: snapErr } = await supabase.from("pedidos_comerciais").update({ lotes_separados: snapshot }).eq("id", pedido.id);
        if (snapErr) { toast.error("Erro ao salvar os lotes escolhidos. Nada foi baixado."); return; }
      }

      // 3. RPC baixa da expedição pelos lotes_separados
      const { data: result, error } = await supabase.rpc("marcar_pedido_pronto", {
        p_pedido_id: pedido.id,
        p_user_name: user.email ?? "Estoque",
      });
      if (error || (result as { error?: string })?.error) {
        toast.error("Erro ao marcar como pronto: " + (error?.message ?? (result as { error?: string })?.error));
        return;
      }
      toast.success("Pedido pronto! Peças baixadas da expedição por lote.");
      loadPedidos();
    } catch (err) {
      toast.error("Erro inesperado ao marcar pedido como pronto. Tente novamente.");
      logger.error("handleMarcarPronto:", err);
    }
  }, [user, loadPedidos]);

  async function handleCancelar() {
    if (!cancelarPedido) return;
    setCancelando(true);
    try {
      // RPC atômica — cancela o pedido e libera todas as reservas
      const { error } = await supabase.rpc("cancel_pedido", { p_pedido_id: cancelarPedido.id });
      if (error) { toast.error("Erro ao cancelar."); return; }
      toast.success("Pedido cancelado. Reservas liberadas.");
      setCancelarPedido(null);
      loadPedidos();
    } catch (err) {
      toast.error("Erro inesperado ao cancelar pedido. Tente novamente.");
      logger.error("handleCancelar:", err);
    } finally {
      setCancelando(false);
    }
  }

  async function imprimirMes() {
    setImprimindo(true);
    try { await imprimirPedidosDoMes(filtrados); }
    catch (err) { logger.error("imprimirPedidosDoMes:", err); toast.error("Não foi possível gerar a impressão."); }
    finally { setImprimindo(false); }
  }

  useConfirmEnter(!!cancelarPedido, handleCancelar, cancelando);

  const FILTROS: [FiltroStatus, string][] = [
    ["separando", "Separar"],
    ["pronto", "Prontos"],
    ["enviado", "Faturados/enviados"],
    ["retorno", "Devolvidos"],
    ["todos", "Todos"],
  ];

  return (
    <div className="space-y-3">
      {/* Resumo das etapas (clicável) */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {([
          ["separando", "Para separar", contagem.separando, "text-blue-600 dark:text-blue-400", ShoppingBag],
          ["pronto", "Aguard. NF", contagem.pronto, "text-emerald-600 dark:text-emerald-400", CheckCircle2],
          ["enviado", "Faturados", contagem.enviado, "text-sky-600 dark:text-sky-400", Truck],
        ] as [FiltroStatus, string, number, string, React.ElementType][]).map(([id, l, v, cls, Icon]) => (
          <button key={id} type="button" onClick={() => setFiltro(id)}
            className={cn("rounded-2xl border bg-card p-3 sm:p-4 text-left hover:bg-muted/40", filtroAtual === id && "ring-2 ring-primary/40")}>
            <div className="flex items-center justify-between gap-1">
              <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide text-muted-foreground leading-tight truncate">{l}</p>
              <Icon className={cn("h-4 w-4 shrink-0 hidden sm:block", cls)} />
            </div>
            <p className={cn("mt-1 text-xl sm:text-2xl font-bold tabular-nums", v > 0 ? cls : "")}>{loading && pedidos.length === 0 ? "—" : v}</p>
          </button>
        ))}
      </div>

      {/* Busca + ações */}
      <div className="flex gap-2">
        <SearchInputWithBarcode
          className="flex-1 min-w-0"
          placeholder="Cliente, vendedora ou nº do pedido"
          onChange={v => setSearchQuery(v.trim())}
          onSearch={v => setSearchQuery(v.trim())}
          height="h-11"
        />
        <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={loadPedidos} disabled={loading} aria-label="Atualizar">
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
        <Button variant="outline" className="h-11 gap-1.5 shrink-0 px-3" onClick={imprimirMes} disabled={imprimindo || filtrados.length === 0} title="Imprimir os pedidos do mês (da lista atual)">
          {imprimindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}<span className="hidden sm:inline">Imprimir mês</span>
        </Button>
      </div>

      {/* Filtro por etapa */}
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none -mx-3 px-3 sm:mx-0 sm:px-0" role="tablist" aria-label="Etapa do pedido">
        {FILTROS.map(([id, l]) => (
          <button key={id} type="button" role="tab" aria-selected={filtroAtual === id} onClick={() => setFiltro(id)}
            className={cn("h-9 shrink-0 rounded-full border px-3 text-sm font-medium inline-flex items-center gap-1.5",
              filtroAtual === id ? "bg-foreground text-background border-foreground" : "bg-card text-muted-foreground hover:text-foreground")}>
            {l}<span className="text-xs tabular-nums opacity-80">{contagem[id]}</span>
          </button>
        ))}
      </div>

      {/* Lista */}
      {loading && pedidos.length === 0 ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="rounded-2xl border bg-card p-4 space-y-3">
              <div className="h-4 bg-muted rounded animate-pulse w-48" />
              <div className="h-3 bg-muted/70 rounded animate-pulse w-64" />
              <div className="h-1.5 bg-muted/70 rounded animate-pulse w-full" />
            </div>
          ))}
        </div>
      ) : filtrados.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card py-12 px-4 text-center space-y-2">
          <ShoppingBag className="h-9 w-9 mx-auto text-muted-foreground/40" />
          <p className="font-medium">{searchQuery ? "Nenhum pedido encontrado" : filtroAtual === "separando" ? "Nenhum pedido para separar" : "Nenhum pedido nesta etapa"}</p>
          <p className="text-sm text-muted-foreground">
            {searchQuery ? "Tente outro nome ou número." : filtroAtual === "separando" ? "Quando o Comercial confirmar um pedido, ele aparece aqui para separar." : "Escolha outra etapa acima."}
          </p>
          {filtroAtual !== "todos" && <Button variant="outline" className="h-10 mt-1" onClick={() => setFiltro("todos")}>Ver todos</Button>}
        </div>
      ) : (
        <ul className="space-y-2">
          {filtrados.map(pedido => (
            <PedidoCard
              key={pedido.id}
              pedido={pedido}
              onExpandChange={onExpandChange}
              onMarcarPronto={handleMarcarPronto}
              onCancelar={setCancelarPedido}
              onRetornar={setRetornarPedido}
              onRemoverItem={(p, item) => setRemoverItem({ pedido: p, item })}
              onEditarEndereco={setEditarEndereco}
              isAdmin={isAdmin}
            />
          ))}
        </ul>
      )}

      <RetornarPedidoDialog pedido={retornarPedido} onClose={() => setRetornarPedido(null)} onSuccess={loadPedidos} />
      <RemoverItemDialog pedido={removerItem?.pedido ?? null} item={removerItem?.item ?? null} onClose={() => setRemoverItem(null)} onSuccess={loadPedidos} />
      <EditarEnderecoDialog pedido={editarEndereco} onClose={() => setEditarEndereco(null)} onSuccess={loadPedidos} />

      <AlertDialog open={!!cancelarPedido} onOpenChange={v => { if (!v && !cancelando) setCancelarPedido(null); }}>
        <AlertDialogContent className="w-[calc(100vw-1.5rem)] rounded-2xl">
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle className="flex items-center gap-2"><Ban className="h-5 w-5 text-red-500" />Cancelar pedido?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelarPedido?.cliente_nome} — as peças reservadas voltam para o estoque da expedição.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11" disabled={cancelando}>Voltar</AlertDialogCancel>
            <AlertDialogAction className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={cancelando}
              onClick={e => { e.preventDefault(); handleCancelar(); }}>
              {cancelando && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}Cancelar pedido
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
