/**
 * PedidosEstoquePanel — Aba "Pedidos" dentro do Estoque
 *
 * Fluxo do estoque:
 *  1. Vê pedidos com status "pendente"
 *  2. Clica "Iniciar separação" → status vira "separando", peças ficam em reserva
 *  3. Escolhe lotes disponíveis na expedição para cada item
 *  4. Clica "Marcar como Pronto" → status vira "pronto", aguarda financeiro emitir NF
 */

import { useState, useEffect, useCallback, useRef, memo } from "react";
import { displayLote } from "@/lib/lote";
import {
  Package,
  Tag,
  User,
  Clock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Truck,
  X,
  RefreshCw,
  ShoppingBag,
  AlertTriangle,
  MapPin,
  DollarSign,
  ArrowRight,
  PackageCheck,
  Ban,
  Search,
  Archive,
  Minus,
  Plus,
  Printer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { fetchLotesDisponivelBatch } from "@/hooks/useStock";
import { useDebounce } from "@/hooks/useDebounce";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import { PrintButton } from "@/components/PrintButton";
import { escHtml } from "@/lib/escHtml";
import { SearchInputWithBarcode } from "@/components/SearchInputWithBarcode";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface LoteDisponivel {
  lote: string;
  quantity: number;
  stock_item_id: string;
}

interface PedidoItem {
  id: string;
  ids: string[]; // todos os ids de pedido_itens unificados
  stock_item_id: string;
  lote: string;
  quantidade: number;
  device_model?: string;
  device_reference?: string;
  lotes_disponiveis?: LoteDisponivel[];
  lote_escolhido?: string;
}

interface LoteSeparado {
  stock_item_id: string;
  lote: string;
  quantidade: number;
  device_model?: string;
}

interface Pedido {
  id: string;
  cliente_nome: string;
  vendedora_nome: string | null;
  vendedora_id: string | null;
  status: string;
  frete: number;
  observacoes: string | null;
  created_at: string;
  itens: PedidoItem[];
  lotes_separados: LoteSeparado[] | null;
  itens_raw: { stock_item_id: string; lote: string; quantidade: number; device_model?: string; device_reference?: string }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function statusColor(status: string) {
  if (status === "pendente") return "bg-amber-500/10 text-amber-600 border-amber-500/20";
  if (status === "separando") return "bg-blue-500/10 text-blue-600 border-blue-500/20";
  if (status === "pronto") return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
  if (status === "faturado") return "bg-violet-500/10 text-violet-600 border-violet-500/20";
  if (status === "enviado") return "bg-success/10 text-success border-success/20";
  return "bg-muted/30 text-muted-foreground border-border/30";
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    pendente: "Pendente",
    separando: "Separando",
    pronto: "Pronto",
    faturado: "Faturado",
    enviado: "Enviado",
    cancelado: "Cancelado",
  };
  return map[status] ?? status;
}

// ─── Card de Pedido ───────────────────────────────────────────────────────────

interface StockItemExpedicao {
  stock_item_id: string;
  quantity: number; // total na expedição
  quantity_reserved: number; // reservado em pedidos
  lotes: LoteDisponivel[];
  loading: boolean;
}

interface LoteSelecao {
  [itemId: string]: {
    [lote: string]: number;
  };
}

interface PedidoCardProps {
  pedido: Pedido;
  onIniciarSeparacao: (pedido: Pedido, lotesSelecionados: LoteSelecao, expIdByItem: Record<string, string>) => void;
  onSalvarSeparacao: (pedido: Pedido, lotesSelecionados: LoteSelecao, expIdByItem: Record<string, string>) => Promise<void>;
  onMarcarPronto: (pedido: Pedido, lotesSelecionados: LoteSelecao, expIdByItem: Record<string, string>) => void;
  onCancelar: (pedido: Pedido) => void;
  onEditarItem: (pedido: Pedido, item: PedidoItem) => void;
  isAdmin: boolean;
}

function PedidoCard({ pedido, onIniciarSeparacao, onSalvarSeparacao, onMarcarPronto, onCancelar, onEditarItem, isAdmin }: PedidoCardProps) {
  const [expanded, setExpanded] = useState(false);

  // ── State ──────────────────────────────────────────────────────────────────
  // expId per item: the real expedição stock_item_id (may differ from pedido_item.stock_item_id)
  const [expIdByItem, setExpIdByItem] = useState<Record<string, string>>({});
  // available lotes per item (keyed by item.id)
  const [lotesDisp, setLotesDisp] = useState<Record<string, LoteDisponivel[]>>({});
  // user selection: { [item.id]: { [lote]: qty } }
  const [sel, setSel] = useState<LoteSelecao>({});
  const [loadingLotes, setLoadingLotes] = useState(false);
  const loadedRef = useRef(false);

  const isSeparando = pedido.status === "separando";
  const isPendente  = pedido.status === "pendente";
  const totalItens  = pedido.itens.reduce((s, i) => s + i.quantidade, 0);

  // ── Load lotes on expand ───────────────────────────────────────────────────
  useEffect(() => {
    if (!expanded || loadedRef.current) return;
    loadedRef.current = true;
    setLoadingLotes(true);

    async function load() {
      // 1. Resolve expId for each item (intermediária → expedição if needed)
      const itemIds = pedido.itens.map(i => i.stock_item_id);
      const { data: siRows } = await supabase
        .from("stock_items")
        .select("id, device_id, quantity, quantity_reserved, fase")
        .in("id", itemIds);

      const siMap = new Map((siRows ?? []).map((r: Record<string,unknown>) => [r.id as string, r]));

      const nonExpDeviceIds = (siRows ?? [])
        .filter((r: Record<string,unknown>) => r.fase !== "expedicao")
        .map((r: Record<string,unknown>) => r.device_id as string);

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

      // Build expId map (item.id → real expedicao stock_item_id)
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

      // 2. Load available lotes for each expId (excludes this pedido's own reservations)
      const lotesMap = await fetchLotesDisponivelBatch([...new Set(expIds)], pedido.id);

      const newLotesDisp: Record<string, LoteDisponivel[]> = {};
      for (const item of pedido.itens) {
        const expId = newExpIdByItem[item.id];
        const saldos = lotesMap.get(expId) ?? {};
        const list: LoteDisponivel[] = Object.entries(saldos)
          .map(([lote, qty]) => ({ lote, quantity: Math.max(0, qty), stock_item_id: expId }))
          .filter(l => l.quantity > 0);
        newLotesDisp[item.id] = list;
      }
      setLotesDisp(newLotesDisp);

      // 3. Initialize selection:
      //    - separando: restore from lotes_separados snapshot (per expId)
      //    - pendente:  auto-distribute FIFO by item.quantidade
      const newSel: LoteSelecao = {};

      if (pedido.status === "separando" && (pedido.lotes_separados ?? []).length > 0) {
        // Build a map: expId → [{ lote, quantidade }] from snapshot
        // Each entry in lotes_separados is already deduplicated (one per expId+lote)
        const snapByExpId = new Map<string, { lote: string; quantidade: number }[]>();
        for (const ls of pedido.lotes_separados!) {
          if (!snapByExpId.has(ls.stock_item_id)) snapByExpId.set(ls.stock_item_id, []);
          const arr = snapByExpId.get(ls.stock_item_id)!;
          const ex = arr.find(x => x.lote === ls.lote);
          if (ex) ex.quantidade += ls.quantidade;
          else arr.push({ lote: ls.lote, quantidade: ls.quantidade });
        }
        // For each item, load its share from the snapshot
        // If multiple items share the same expId, split proportionally by item.quantidade
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
        // Pendente: FIFO distribution
        for (const item of pedido.itens) {
          const lotes = newLotesDisp[item.id] ?? [];
          const dist: Record<string, number> = {};
          let restante = item.quantidade;
          for (const l of lotes) {
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

    load();
  }, [expanded, pedido]); // isSeparando derived from pedido.status — pedido covers it

  // ── Helpers ────────────────────────────────────────────────────────────────
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
      else curr[lote] = Math.min(maxQty, (pedido.itens.find(i => i.id === itemId)?.quantidade ?? 1));
      return { ...prev, [itemId]: curr };
    });
  }

  // Build deduplicated snapshot: one entry per (expId, lote)
  function buildSnapshot(): { pedido_item_id: string; stock_item_id: string; lote: string; quantidade: number; device_model?: string }[] {
    const map = new Map<string, { pedido_item_id: string; stock_item_id: string; lote: string; quantidade: number; device_model?: string }>();
    for (const item of pedido.itens) {
      const expId = expIdByItem[item.id] ?? item.stock_item_id;
      for (const [lote, qty] of Object.entries(sel[item.id] ?? {})) {
        if (qty <= 0) continue;
        const key = `${expId}||${lote}`;
        const ex = map.get(key);
        if (ex) ex.quantidade += qty;
        else map.set(key, { pedido_item_id: item.ids[0], stock_item_id: expId, lote, quantidade: qty, device_model: item.device_model });
      }
    }
    return [...map.values()];
  }

  const canConfirmar = isPendente && !loadingLotes && pedido.itens.every(item => {
    const lotes = lotesDisp[item.id] ?? [];
    if (lotes.length === 0) return true;
    return totalSel(item.id) === item.quantidade;
  });

  // ── Print ──────────────────────────────────────────────────────────────────
  async function handleImprimir() {
    const now = new Date().toLocaleDateString("pt-BR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
    const LOTE_PH = new Set(["a-definir","a definir","sem lote",""]);
    const printRows: { model?: string; reference?: string; lote: string; quantidade: number }[] = [];

    const hasSel = Object.keys(sel).length > 0;
    const hasSep = (pedido.lotes_separados ?? []).length > 0;

    if (hasSep) {
      // lotes_separados é sempre a fonte mais confiável — tem um entry por (stock_item, lote)
      const rowMap = new Map<string, { model?: string; reference?: string; lote: string; quantidade: number }>();
      for (const ls of pedido.lotes_separados!) {
        const item = pedido.itens.find(i => (expIdByItem[i.id] ?? i.stock_item_id) === ls.stock_item_id)
          ?? pedido.itens.find(i => i.device_model === ls.device_model);
        const key = `${ls.device_model}||${ls.lote}`;
        const ex = rowMap.get(key);
        if (ex) ex.quantidade += ls.quantidade;
        else rowMap.set(key, { model: ls.device_model ?? item?.device_model, reference: item?.device_reference, lote: ls.lote, quantidade: ls.quantidade });
      }
      for (const row of rowMap.values()) printRows.push(row);
    } else if (hasSel) {
      // Seleção ativa na tela (pedido pendente ainda não iniciado)
      const rowMap = new Map<string, { model?: string; reference?: string; lote: string; quantidade: number }>();
      for (const item of pedido.itens) {
        for (const [lote, qty] of Object.entries(sel[item.id] ?? {})) {
          if (qty <= 0) continue;
          const key = `${item.device_model}||${lote}`;
          const ex = rowMap.get(key);
          if (ex) ex.quantidade += qty;
          else rowMap.set(key, { model: item.device_model, reference: item.device_reference, lote, quantidade: qty });
        }
      }
      for (const row of rowMap.values()) printRows.push(row);
    } else {
      const stockItemIds = [...new Set(pedido.itens_raw.map(r => r.stock_item_id))];
      const { data: movs } = await supabase
        .from("stock_movements")
        .select("stock_item_id, lote, type, quantity")
        .in("stock_item_id", stockItemIds)
        .neq("lote", null);

      const saldoMap = new Map<string, Map<string, number>>();
      for (const m of (movs ?? []) as { stock_item_id: string; lote: string; type: string; quantity: number }[]) {
        if (!m.lote || LOTE_PH.has(m.lote.trim().toLowerCase())) continue;
        const k = m.lote.toUpperCase();
        if (!saldoMap.has(m.stock_item_id)) saldoMap.set(m.stock_item_id, new Map());
        const lm = saldoMap.get(m.stock_item_id)!;
        lm.set(k, (lm.get(k) ?? 0) + (m.type === "entrada" ? m.quantity : -m.quantity));
      }

      for (const item of pedido.itens) {
        const lm = saldoMap.get(item.stock_item_id);
        const lotesComSaldo = lm ? [...lm.entries()].filter(([,s]) => s > 0).map(([l]) => l) : [];
        if (lotesComSaldo.length > 0) {
          for (const lote of lotesComSaldo) {
            printRows.push({ model: item.device_model, reference: item.device_reference, lote, quantidade: item.quantidade });
          }
        } else {
          printRows.push({ model: item.device_model, reference: item.device_reference, lote: "", quantidade: item.quantidade });
        }
      }
    }

    // ── Agrupa por tipo de peça (model + reference) para separadores na página ──
    const grouped = new Map<string, typeof printRows>();
    for (const row of printRows) {
      const key = `${row.model}|||${row.reference}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(row);
    }

    let rowIdx = 0;
    let tableBody = "";
    for (const [, rows] of grouped) {
      rowIdx++;
      const first = rows[0];
      const tipoTotal = rows.reduce((s, r) => s + r.quantidade, 0);

      // Lotes inline — todos os badges na mesma célula
      const lotesBadges = rows
        .filter(r => r.lote && !LOTE_PH.has(r.lote.toLowerCase()))
        .map(r => `<span class="lote-badge">${escHtml(r.lote)}</span>`)
        .join(" ");
      const lotesCell = lotesBadges || `<span class="lote-empty">—</span>`;

      tableBody += `<tr>
        <td class="col-num">${rowIdx}</td>
        <td class="col-model">
          <span class="model-name">${escHtml(first.model)}</span>
          <span class="model-ref">${escHtml(first.reference)}</span>
        </td>
        <td class="col-lotes">${lotesCell}</td>
        <td class="col-qty">${tipoTotal}</td>
      </tr>`;
    }

    const totalPecas = printRows.reduce((s, r) => s + r.quantidade, 0);
    const totalTipos = grouped.size;

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Pedido — ${escHtml(pedido.cliente_nome)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; padding: 24px 28px; color: #111; font-size: 13px; }
    .header { margin-bottom: 18px; border-bottom: 2px solid #ddd6fe; padding-bottom: 14px; }
    h1 { font-size: 20px; font-weight: 800; color: #3b0764; margin-bottom: 6px; }
    .meta { font-size: 12px; color: #555; display: flex; flex-wrap: wrap; gap: 12px; }
    .meta strong { color: #333; }
    .obs { font-size: 12px; color: #666; background: #f9f5ff; border-left: 3px solid #a78bfa; padding: 8px 12px; margin-bottom: 14px; border-radius: 0 6px 6px 0; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 8px 10px; background: #f3f0ff; color: #5b21b6; border-bottom: 2px solid #ddd6fe; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
    td { padding: 7px 10px; border-bottom: 1px solid #eee; vertical-align: middle; }
    tr:nth-child(even) td { background: #faf9ff; }
    .col-num { width: 28px; color: #bbb; font-size: 11px; }
    .col-model { width: 38%; }
    .col-lotes { }
    .col-qty { width: 80px; text-align: right; font-weight: 800; font-size: 15px; color: #3b0764; white-space: nowrap; }
    .model-name { display: block; font-weight: 600; font-size: 12px; color: #1a1a2e; }
    .model-ref { display: block; font-family: monospace; font-size: 10px; color: #888; margin-top: 1px; }
    .lote-badge { display: inline-block; background: #f3f0ff; color: #5b21b6; font-family: monospace; font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 4px; border: 1px solid #ddd6fe; margin: 1px 2px 1px 0; }
    .lote-empty { color: #bbb; font-size: 11px; }
    .footer { margin-top: 20px; padding-top: 12px; border-top: 1px solid #eee; display: flex; justify-content: space-between; font-size: 11px; color: #999; }
    .footer strong { color: #5b21b6; }
    @media print { button { display: none } body { padding: 16px } }
  </style>
</head>
<body>
  <div class="header">
    <h1>📦 Pedido</h1>
    <div class="meta">
      <span>Cliente: <strong>${escHtml(pedido.cliente_nome)}</strong></span>
      <span>Vendedora: <strong>${escHtml(pedido.vendedora_nome)}</strong></span>
      <span>Gerado em: <strong>${now}</strong></span>
    </div>
  </div>
  ${pedido.observacoes ? `<div class="obs">Obs: ${escHtml(pedido.observacoes)}</div>` : ""}
  <table>
    <thead>
      <tr>
        <th class="col-num">#</th>
        <th class="col-model">Peça</th>
        <th class="col-lotes">Lotes</th>
        <th class="col-qty" style="text-align:right">Qtd.</th>
      </tr>
    </thead>
    <tbody>${tableBody}</tbody>
  </table>
  <div class="footer">
    <span>Total: <strong>${totalPecas} peças</strong> em <strong>${totalTipos} tipo${totalTipos !== 1 ? "s" : ""}</strong></span>
    <span>Zomini Usinagens Especiais</span>
  </div>
</body>
</html>`;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.open(); w.document.write(html); w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 250);
  }

  // ── Agrupa itens por device para exibir nome/ref uma única vez ────────────
  const groupedItens: Array<{ key: string; items: typeof pedido.itens }> = [];
  {
    const seen = new Map<string, typeof pedido.itens>();
    for (const item of pedido.itens) {
      const k = `${item.device_model}|||${item.device_reference}`;
      if (!seen.has(k)) seen.set(k, []);
      seen.get(k)!.push(item);
    }
    for (const [key, items] of seen.entries()) {
      groupedItens.push({ key, items });
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={cn(
      "rounded-2xl border overflow-hidden transition-all",
      isPendente   ? "border-amber-500/25 bg-amber-500/3" :
      isSeparando  ? "border-blue-500/25 bg-blue-500/3" :
      pedido.status === "pronto" ? "border-emerald-500/25 bg-emerald-500/3" :
      "border-border/30 bg-card"
    )}>
      {/* Header */}
      <button type="button" onClick={() => setExpanded(v => !v)}
        className="w-full text-left px-4 py-3 flex items-start gap-3">
        <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5",
          isPendente ? "bg-amber-500/10" : isSeparando ? "bg-blue-500/10" : "bg-muted/30")}>
          <ShoppingBag className={cn("h-4 w-4",
            isPendente ? "text-amber-500" : isSeparando ? "text-blue-500" : "text-muted-foreground")} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold truncate">{pedido.cliente_nome}</span>
            <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", statusColor(pedido.status))}>
              {statusLabel(pedido.status)}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {pedido.vendedora_nome && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <User className="h-2.5 w-2.5" />{pedido.vendedora_nome}
              </span>
            )}
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Package className="h-2.5 w-2.5" />{totalItens} un.
            </span>
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground/60">
              <Clock className="h-2.5 w-2.5" />{fmtDate(pedido.created_at)} às {fmtTime(pedido.created_at)}
            </span>
          </div>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0 mt-2" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 mt-2" />}
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/20 pt-3">
          {loadingLotes && (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
            </div>
          )}

          {!loadingLotes && (
            <div className="space-y-2">
              {groupedItens.map(({ key: groupKey, items: groupItems }) => {
                const firstItem = groupItems[0];
                const showLotePicker = isPendente || isSeparando;
                const groupTotalPedido = groupItems.reduce((s, i) => s + i.quantidade, 0);

                return (
                  <div key={groupKey} className="rounded-xl border border-border/30 bg-background/50 overflow-hidden">
                    {/* Cabeçalho do grupo — nome e referência aparecem UMA VEZ */}
                    <div className="flex items-center gap-2 px-3 py-2 bg-muted/20 border-b border-border/20">
                      <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-semibold truncate">{firstItem.device_model}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{firstItem.device_reference}</p>
                      </div>
                      <div className="flex flex-col items-end shrink-0">
                        <span className="text-[10px] text-muted-foreground/60 leading-none">pedido</span>
                        <span className="text-[13px] font-bold">{groupTotalPedido} un.</span>
                      </div>
                    </div>

                    {/* Lotes do grupo */}
                    <div className="divide-y divide-border/10">
                      {groupItems.map((item) => {
                        const lotes = lotesDisp[item.id] ?? [];
                        const selTotal = totalSel(item.id);
                        const itemOk = selTotal === item.quantidade;

                        return (
                          <div
                            key={item.id}
                            className={cn(
                              "px-3 py-2.5 space-y-2.5 transition-colors",
                              lotes.length === 0 && showLotePicker
                                ? "bg-destructive/5"
                                : itemOk && showLotePicker
                                  ? "bg-emerald-500/5"
                                  : ""
                            )}
                          >
                            {/* Quantidade por lote quando há múltiplos */}
                            {groupItems.length > 1 && (
                              <div className="flex items-center gap-2">
                                <div className="flex items-center gap-2 shrink-0 ml-auto">
                                  <span className="text-[11px] text-muted-foreground/60">lote · {item.quantidade} un.</span>
                                  {isPendente && (
                                    <button
                                      type="button"
                                      title="Editar quantidade"
                                      onClick={(e) => { e.stopPropagation(); onEditarItem(pedido, item); }}
                                      className="h-6 w-6 flex items-center justify-center rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 transition-colors"
                                    >
                                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Para item único no grupo, mostra botão de editar */}
                            {groupItems.length === 1 && isPendente && (
                              <div className="flex justify-end -mt-1">
                                <button
                                  type="button"
                                  title="Editar quantidade"
                                  onClick={(e) => { e.stopPropagation(); onEditarItem(pedido, item); }}
                                  className="h-6 w-6 flex items-center justify-center rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 transition-colors"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                </button>
                              </div>
                            )}

                            {/* Lote picker (pendente or separando) */}
                            {showLotePicker && (
                              lotes.length === 0 ? (
                                <div className="flex items-center gap-1.5 text-[11px] text-destructive">
                                  <AlertTriangle className="h-3 w-3" />
                                  Sem estoque disponível na expedição
                                </div>
                              ) : (
                                <div className="space-y-1.5">
                                  <div className="flex items-center gap-1.5">
                                    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                                      Lotes — escolha o que será enviado
                                    </p>
                                    <span className={cn("ml-auto text-[10px] font-bold",
                                      itemOk ? "text-emerald-500" : selTotal > 0 ? "text-amber-500" : "text-muted-foreground")}>
                                      {selTotal}/{item.quantidade} selecionados
                                    </span>
                                  </div>
                                  {lotes.map((l) => {
                                    const isSel = !!(sel[item.id]?.[l.lote]);
                                    const qtySel = sel[item.id]?.[l.lote] ?? 0;
                                    return (
                                      <div
                                        key={l.lote}
                                        className={cn(
                                          "flex items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors",
                                          isSel ? "bg-blue-500/8 border-blue-500/30" : "bg-muted/20 border-border/20"
                                        )}
                                      >
                                        <button
                                          type="button"
                                          onClick={() => toggleLote(item.id, l.lote, l.quantity)}
                                          className={cn("h-4 w-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
                                            isSel ? "bg-blue-500 border-blue-500" : "border-muted-foreground/40")}
                                        >
                                          {isSel && <CheckCircle2 className="h-3 w-3 text-white" />}
                                        </button>
                                        <div className="flex-1 min-w-0">
                                          <p className="text-[11px] font-mono font-semibold">{l.lote}</p>
                                          <p className="text-[10px] text-muted-foreground">{l.quantity} disponíveis</p>
                                        </div>
                                        {isSel && (
                                          <div className="flex items-center gap-1 shrink-0">
                                            <button
                                              type="button"
                                              onClick={() => setQtyLote(item.id, l.lote, qtySel - 1, l.quantity)}
                                              className="h-6 w-6 rounded bg-muted/40 hover:bg-muted flex items-center justify-center text-muted-foreground"
                                            >
                                              <Minus className="h-3 w-3" />
                                            </button>
                                            <input
                                              type="number"
                                              min={1}
                                              max={l.quantity}
                                              value={qtySel}
                                              onChange={(e) => setQtyLote(item.id, l.lote, parseInt(e.target.value) || 0, l.quantity)}
                                              className="w-10 text-center text-[12px] font-bold bg-transparent border border-border/40 rounded h-6 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                            />
                                            <button
                                              type="button"
                                              onClick={() => setQtyLote(item.id, l.lote, qtySel + 1, l.quantity)}
                                              className="h-6 w-6 rounded bg-muted/40 hover:bg-muted flex items-center justify-center text-muted-foreground"
                                            >
                                              <Plus className="h-3 w-3" />
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                  {!itemOk && selTotal > 0 && (
                                    <p className="text-[11px] text-amber-600 flex items-center gap-1">
                                      <AlertTriangle className="h-3 w-3" />
                                      {selTotal < item.quantidade
                                        ? `Faltam ${item.quantidade - selTotal} un.`
                                        : `Excesso de ${selTotal - item.quantidade} un.`}
                                    </p>
                                  )}
                                </div>
                              )
                            )}

                            {/* Pronto: exibe lotes escolhidos */}
                            {pedido.status === "pronto" && (() => {
                              const entries = (pedido.lotes_separados ?? [])
                                .filter((ls) =>
                                  ls.stock_item_id === (expIdByItem[item.id] ?? item.stock_item_id) ||
                                  ls.device_model === item.device_model
                                );
                              if (entries.length === 0) return null;
                              const agg: Record<string, number> = {};
                              for (const ls of entries) agg[ls.lote] = (agg[ls.lote] ?? 0) + ls.quantidade;
                              return (
                                <div className="flex flex-wrap gap-1.5 pt-0.5">
                                  {Object.entries(agg).filter(([lote]) => displayLote(lote)).map(([lote, qty]) => (
                                    <div key={lote} className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-500/8 border border-emerald-500/20">
                                      <Tag className="h-2.5 w-2.5 text-emerald-500/70 shrink-0" />
                                      <span className="text-[11px] font-mono font-bold text-emerald-600 tracking-wider">{lote}</span>
                                      <span className="text-[10px] text-emerald-500/70">{qty} un.</span>
                                    </div>
                                  ))}
                                </div>
                              );
                            })()}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {pedido.observacoes && (
            <p className="text-[11px] text-muted-foreground italic px-1">"{pedido.observacoes}"</p>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={handleImprimir}
              className="h-9 w-9 rounded-xl bg-muted/30 hover:bg-muted/60 text-muted-foreground flex items-center justify-center transition-colors shrink-0"
              title="Imprimir pedido">
              <Printer className="h-3.5 w-3.5" />
            </button>

            {isPendente && (
              <button type="button"
                onClick={() => onIniciarSeparacao(pedido, sel, expIdByItem)}
                disabled={!canConfirmar || loadingLotes}
                className="flex-1 h-9 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 text-[12px] font-semibold transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none">
                <PackageCheck className="h-3.5 w-3.5" />
                Iniciar Separação
              </button>
            )}

            {isSeparando && (
              <button type="button" onClick={() => onMarcarPronto(pedido, sel, expIdByItem)}
                className="flex-1 h-9 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 text-[12px] font-semibold transition-colors flex items-center justify-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Marcar como Pronto
              </button>
            )}

            {pedido.status === "pronto" && (
              <div className="flex-1 h-9 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-emerald-600 text-[12px] font-medium flex items-center justify-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Aguardando Nota Fiscal
              </div>
            )}

            {(isPendente || isSeparando) && isAdmin && (
              <button type="button" onClick={() => onCancelar(pedido)}
                className="h-9 w-9 rounded-xl bg-destructive/5 hover:bg-destructive/15 text-destructive flex items-center justify-center transition-colors"
                title="Cancelar pedido">
                <Ban className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


// ─── Modal de Separação de Lotes ──────────────────────────────────────────────

interface SepararLotesModalProps {
  pedido: Pedido | null;
  onClose: () => void;
  onSuccess: () => void;
}

function SepararLotesModal({ pedido, onClose, onSuccess }: SepararLotesModalProps) {
  const { user } = useAuth();

  const [lotesSelecionados, setLotesSelecionados] = useState<Record<string, Record<string, number>>>({});
  const [lotesDisponiveis, setLotesDisponiveis] = useState<Record<string, LoteDisponivel[]>>({});
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

      // PERF-01: Batch query for all stock items
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

      // PERF-01: Single batch query for all lotes
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

  // Valida: todos os itens com estoque devem ter total selecionado === quantidade pedida
  const canConfirm = pedido.itens.every(item => {
    const disponiveis = lotesDisponiveis[item.id] ?? [];
    if (disponiveis.length === 0) return true; // sem estoque, deixa passar com aviso
    return totalSelecionado(item.id) === item.quantidade;
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
                                min={1}
                                max={l.quantity}
                                value={qtySelected}
                                onChange={e => setQtyLote(item.id, l.lote, parseInt(e.target.value) || 0, l.quantity)}
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

        <div className="px-5 pb-5 pt-3 border-t border-border/20">
          <button
            type="button"
            onClick={handleConfirmar}
            disabled={saving || loading || saved || !canConfirm}
            className="w-full h-10 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : saved ? <CheckCircle2 className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
            {saved ? "Confirmado!" : "Confirmar e Reservar Peças"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal Editar Quantidade de Item do Pedido Pendente ───────────────────────

interface EditarItemModalProps {
  pedido: Pedido | null;
  item: PedidoItem | null;
  onClose: () => void;
  onSuccess: () => void;
}

function EditarItemModal({ pedido, item, onClose, onSuccess }: EditarItemModalProps) {
  const [qtd, setQtd] = useState(1);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (item) setQtd(item.quantidade);
    else setQtd(1);
  }, [item]);

  async function handleSalvar() {
    if (!item || qtd < 1) return;
    setSaving(true);
    const count = item.ids.length;
    const base = Math.floor(qtd / count);
    const remainder = qtd % count;

    // Run all updates in parallel — independent rows, no ordering dependency
    const results = await Promise.all(
      item.ids.map((id, i) =>
        supabase.from("pedido_itens").update({ quantidade: base + (i < remainder ? 1 : 0) }).eq("id", id)
      )
    );
    setSaving(false);
    if (results.some(r => r.error)) { toast.error("Erro ao atualizar quantidade."); return; }
    toast.success("Quantidade atualizada!");
    onSuccess();
    onClose();
  }

  if (!pedido || !item) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-card border border-border/30 shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/30">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-amber-500" />
            <p className="text-sm font-semibold">Editar Quantidade</p>
          </div>
          <button type="button" onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Info da peça */}
          <div className="rounded-xl bg-muted/20 border border-border/20 px-4 py-3">
            <p className="text-[13px] font-semibold">{item.device_model}</p>
            <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{item.device_reference}</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">Pedido de {pedido.cliente_nome}</p>
          </div>

          {/* Quantidade */}
          <div className="space-y-2">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Nova quantidade</label>
            <div className="flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => setQtd(q => Math.max(1, q - 1))}
                className="h-10 w-10 rounded-xl bg-muted/30 hover:bg-muted/60 flex items-center justify-center transition-colors"
              >
                <Minus className="h-4 w-4" />
              </button>
              <input
                type="number"
                min={1}
                value={qtd}
                onChange={e => setQtd(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-20 text-center text-[22px] font-bold bg-transparent border border-border/40 rounded-xl h-12 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button
                type="button"
                onClick={() => setQtd(q => q + 1)}
                className="h-10 w-10 rounded-xl bg-muted/30 hover:bg-muted/60 flex items-center justify-center transition-colors"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            {qtd !== item.quantidade && (
              <p className="text-center text-[11px] text-muted-foreground">
                Era <strong>{item.quantidade}</strong> → ficará <strong>{qtd}</strong> un.
              </p>
            )}
          </div>

          {/* Botões */}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 h-10 rounded-xl border border-border/30 text-[12px] font-medium text-muted-foreground hover:bg-muted/30 transition-colors">
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSalvar}
              disabled={saving || qtd === item.quantidade}
              className="flex-1 h-10 rounded-xl bg-amber-500 hover:bg-amber-500/90 text-white text-[12px] font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-1.5"
            >
              {saving
                ? <div className="h-3.5 w-3.5 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />
                : null}
              Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SearchBar isolada (uncontrolled) ─────────────────────────────────────────

interface SearchBarPedidosProps {
  onSearch: (value: string) => void;
  onClear: () => void;
  hasValue: boolean;
}

const SearchBarPedidos = memo(function SearchBarPedidos({ onSearch, onClear }: SearchBarPedidosProps) {
  return (
    <div className="relative flex-1">
      <SearchInputWithBarcode
        placeholder="Bipe o código ou busque por cliente/vendedora..."
        onChange={(v) => onSearch(v.trim())}
        onSearch={(v) => onSearch(v.trim())}
        height="h-9"
      />
    </div>
  );
});

// ─── Painel Principal ─────────────────────────────────────────────────────────

interface PedidosEstoquePanelProps {
  isAdmin: boolean;
}

export function PedidosEstoquePanel({ isAdmin }: PedidosEstoquePanelProps) {
  const { user } = useAuth();
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroStatus] = useState<string>("separando_pronto");
  const [searchQuery, setSearchQuery] = useState("");
  const [hasSearch, setHasSearch] = useState(false);
  const [cancelarPedido, setCancelarPedido] = useState<Pedido | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [editarItem, setEditarItem] = useState<{ pedido: Pedido; item: PedidoItem } | null>(null);

  async function handleIniciarSeparacao(
    pedido: Pedido,
    lotesSelecionados: LoteSelecao,
    expIdByItem: Record<string, string>   // item.id → expedicao stock_item_id
  ) {
    if (!user) return;
    // DEDUP-FIX: merge entradas com mesmo (expId, lote) — evita dobrar quantidades
    // quando dois pedido_itens diferentes resolvem para o mesmo item de expedição.
    const snapshotMap = new Map<string, { pedido_item_id: string; stock_item_id: string; lote: string; quantidade: number; device_model?: string }>();
    for (const item of pedido.itens) {
      const sel = lotesSelecionados[item.id] ?? {};
      const expStockItemId = expIdByItem[item.id] ?? item.stock_item_id;
      for (const [lote, quantidade] of Object.entries(sel)) {
        const key = `${expStockItemId}||${lote}`;
        const existing = snapshotMap.get(key);
        if (existing) {
          existing.quantidade += quantidade;
        } else {
          snapshotMap.set(key, { pedido_item_id: item.ids[0], stock_item_id: expStockItemId, lote, quantidade, device_model: item.device_model });
        }
      }
    }
    const snapshot = [...snapshotMap.values()];
    try {
      // Atualiza o lote principal em cada pedido_item (lote com maior qty)
      const loteUpdates: { id: string; lote: string | null }[] = [];
      for (const item of pedido.itens) {
        const sel = lotesSelecionados[item.id] ?? {};
        const lotePrincipal = Object.entries(sel).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
        for (const pid of item.ids) loteUpdates.push({ id: pid, lote: lotePrincipal });
      }
      await Promise.all(loteUpdates.map(u => supabase.from("pedido_itens").update({ lote: u.lote }).eq("id", u.id)));

      const { error } = await supabase
        .from("pedidos_comerciais")
        .update({
          status: "separando",
          lotes_separados: snapshot,
          separado_por: user.id,
          separado_em: new Date().toISOString(),
        })
        .eq("id", pedido.id);
      if (error) { toast.error("Erro ao iniciar separação."); return; }
      toast.success("Separação iniciada! Peças reservadas.");
      loadPedidos();
    } catch (err) {
      toast.error("Erro inesperado ao iniciar separação.");
      logger.error("handleIniciarSeparacao:", err);
    }
  }

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
          created_at, lotes_separados, separado_em,
          clientes!inner(nome),
          pedido_itens(
            id, stock_item_id, lote, quantidade,
            stock_items!inner(
              stock_item_id:id,
              devices!inner(model, reference)
            )
          )
        `)
        .in("status", ["pendente", "separando", "pronto"])
        .order("created_at", { ascending: false })
        .abortSignal(ctrl.signal);

      if (ctrl.signal.aborted) return;
      if (error || !data) { return; }

      const mapped: Pedido[] = data.map((p: Record<string, unknown>) => ({
        id: p.id as string,
        cliente_nome: (p.clientes as { nome: string }).nome,
        vendedora_nome: p.vendedora_nome as string | null,
        vendedora_id: p.vendedora_id as string | null,
        status: p.status as string,
        frete: (p.frete as number) ?? 0,
        observacoes: p.observacoes as string | null,
        created_at: p.created_at as string,
        lotes_separados: (p.lotes_separados as LoteSeparado[] | null) ?? null,
        itens: (() => {
          const raw = ((p.pedido_itens as Record<string, unknown>[]) ?? []).map((i: Record<string, unknown>) => ({
            id: i.id as string,
            ids: [i.id as string],
            stock_item_id: i.stock_item_id as string,
            lote: i.lote as string,
            quantidade: i.quantidade as number,
            device_model: ((i.stock_items as { devices: { model: string; reference: string } } | null)?.devices?.model),
            device_reference: ((i.stock_items as { devices: { model: string; reference: string } } | null)?.devices?.reference),
          }));
          const merged: Record<string, typeof raw[0]> = {};
          for (const item of raw) {
            if (merged[item.stock_item_id]) {
              merged[item.stock_item_id].quantidade += item.quantidade;
              merged[item.stock_item_id].ids.push(item.id);
            } else {
              merged[item.stock_item_id] = { ...item };
            }
          }
          return Object.values(merged);
        })(),
        itens_raw: ((p.pedido_itens as Record<string, unknown>[]) ?? []).map((i: Record<string, unknown>) => ({
          stock_item_id: i.stock_item_id as string,
          lote: i.lote as string,
          quantidade: i.quantidade as number,
          device_model: ((i.stock_items as { devices: { model: string; reference: string } } | null)?.devices?.model),
          device_reference: ((i.stock_items as { devices: { model: string; reference: string } } | null)?.devices?.reference),
        })),
      }));

      setPedidos(mapped);
    } catch (err) {
      logger.error("loadPedidos:", err);
      toast.error("Erro ao carregar pedidos. Tente atualizar a página.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPedidos(); }, [loadPedidos]);


  const filtrados = pedidos.filter(p => {
    const matchStatus = p.status === "separando" || p.status === "pronto";
    if (!matchStatus) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.cliente_nome.toLowerCase().includes(q) ||
      (p.vendedora_nome ?? "").toLowerCase().includes(q)
    );
  });


  async function handleSalvarSeparacao(
    pedido: Pedido,
    lotesSelecionados: LoteSelecao,
    expIdByItem: Record<string, string>   // item.id → expedicao stock_item_id
  ) {
    if (!user) return;
    // DEDUP-FIX: merge entradas com mesmo (expId, lote)
    const snapshotMap = new Map<string, { pedido_item_id: string; stock_item_id: string; lote: string; quantidade: number; device_model?: string }>();
    for (const item of pedido.itens) {
      const sel = lotesSelecionados[item.id] ?? {};
      const expStockItemId = expIdByItem[item.id] ?? item.stock_item_id;
      for (const [lote, quantidade] of Object.entries(sel)) {
        const key = `${expStockItemId}||${lote}`;
        const existing = snapshotMap.get(key);
        if (existing) {
          existing.quantidade += quantidade;
        } else {
          snapshotMap.set(key, { pedido_item_id: item.ids[0], stock_item_id: expStockItemId, lote, quantidade, device_model: item.device_model });
        }
      }
    }
    const snapshot = [...snapshotMap.values()];
    try {
      // Salva o lote principal (maior qty) em cada pedido_item para rastreabilidade
      const updates: { id: string; lote: string | null }[] = [];
      for (const item of pedido.itens) {
        const sel = lotesSelecionados[item.id] ?? {};
        // Lote principal = o com maior quantidade selecionada
        const lotePrincipal = Object.entries(sel).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
        for (const itemId of item.ids) updates.push({ id: itemId, lote: lotePrincipal });
      }
      // Run updates in parallel — all independent rows
      const results = await Promise.all(
        updates.map(u => supabase.from("pedido_itens").update({ lote: u.lote }).eq("id", u.id))
      );
      const hasError = results.some(r => r.error);
      if (hasError) { toast.error("Erro ao salvar alguns lotes."); return; }

      const { error } = await supabase
        .from("pedidos_comerciais")
        .update({ lotes_separados: snapshot })
        .eq("id", pedido.id);
      if (error) { toast.error("Erro ao salvar lotes."); return; }
      toast.success("Lotes da separação salvos!");
      loadPedidos();
    } catch (err) {
      toast.error("Erro inesperado ao salvar lotes. Tente novamente.");
      logger.error("handleSalvarSeparacao:", err);
    }
  }

  async function handleMarcarPronto(
    pedido: Pedido,
    lotesSelecionados: LoteSelecao,
    expIdByItem: Record<string, string>
  ) {
    if (!user) return;
    try {
      // 1. Monta snapshot de lotes_separados a partir da seleção atual
      //    (mesma lógica do handleSalvarSeparacao — merge por expId+lote)
      const snapshotMap = new Map<string, { pedido_item_id: string; stock_item_id: string; lote: string; quantidade: number; device_model?: string }>();
      for (const item of pedido.itens) {
        const sel = lotesSelecionados[item.id] ?? {};
        const expStockItemId = expIdByItem[item.id] ?? item.stock_item_id;
        for (const [lote, quantidade] of Object.entries(sel)) {
          if (quantidade <= 0) continue;
          const key = `${expStockItemId}||${lote}`;
          const existing = snapshotMap.get(key);
          if (existing) {
            existing.quantidade += quantidade;
          } else {
            snapshotMap.set(key, {
              pedido_item_id: item.ids[0],
              stock_item_id: expStockItemId,
              lote,
              quantidade,
              device_model: item.device_model,
            });
          }
        }
      }
      const snapshot = [...snapshotMap.values()];

      // 2. Salva lotes_separados ANTES do RPC para que ele use os dados corretos
      if (snapshot.length > 0) {
        // Salva também o lote principal em cada pedido_item
        const updates: { id: string; lote: string | null }[] = [];
        for (const item of pedido.itens) {
          const sel = lotesSelecionados[item.id] ?? {};
          const lotePrincipal = Object.entries(sel).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
          for (const itemId of item.ids) updates.push({ id: itemId, lote: lotePrincipal });
        }
        await Promise.all(
          updates.map(u => supabase.from("pedido_itens").update({ lote: u.lote }).eq("id", u.id))
        );
        const { error: snapErr } = await supabase
          .from("pedidos_comerciais")
          .update({ lotes_separados: snapshot })
          .eq("id", pedido.id);
        if (snapErr) {
          toast.error("Erro ao salvar distribuição de lotes antes de concluir.");
          return;
        }
      }

      // 3. Chama RPC — agora ele lê lotes_separados e deduz corretamente
      const { data: result, error } = await supabase.rpc("marcar_pedido_pronto", {
        p_pedido_id: pedido.id,
        p_user_name: user.email ?? "Estoque",
      });

      if (error || (result as { error?: string })?.error) {
        toast.error("Erro ao marcar como pronto: " + (error?.message ?? (result as { error?: string })?.error));
        return;
      }

      toast.success("Pedido marcado como pronto! Peças retiradas por lote da expedição.");
      loadPedidos();
    } catch (err) {
      toast.error("Erro inesperado ao marcar pedido como pronto. Tente novamente.");
      logger.error("handleMarcarPronto:", err);
    }
  }

  async function handleCancelar() {
    if (!cancelarPedido) return;
    setCancelando(true);
    try {
      // Use atomic RPC — cancels pedido + releases all reservations in one transaction
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

  // ── Imprimir todos os pedidos do mês ──────────────────────────────────────
  function handleImprimirTodos() {
    const now = new Date();
    const nowStr = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const mesAtual = now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const LOTE_PH = new Set(["a-definir", "a definir", "sem lote", ""]);

    function escH(s?: string | null) {
      return (s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    }

    // Filtra pedidos do mês atual
    const pedidosDoMes = filtrados.filter(p => {
      const d = new Date(p.created_at);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });

    if (pedidosDoMes.length === 0) {
      const d = new Date(filtrados[0]?.created_at ?? now.toISOString());
      // Se não há nenhum do mês atual, imprime todos os visíveis
      // (pode ser que o filtro de status já restrinja)
    }

    const pedidosParaImprimir = pedidosDoMes.length > 0 ? pedidosDoMes : filtrados;

    let sections = "";
    let totalGeralPecas = 0;

    for (const pedido of pedidosParaImprimir) {
      const printRows: { model?: string; reference?: string; lote: string; quantidade: number }[] = [];

      if (pedido.lotes_separados && pedido.lotes_separados.length > 0) {
        const rowMap = new Map<string, { model?: string; reference?: string; lote: string; quantidade: number }>();
        for (const ls of pedido.lotes_separados) {
          const item = pedido.itens.find(i => i.stock_item_id === ls.stock_item_id)
            ?? pedido.itens.find(i => i.device_model === ls.device_model);
          const key = `${ls.device_model}||${ls.lote}`;
          const ex = rowMap.get(key);
          if (ex) ex.quantidade += ls.quantidade;
          else rowMap.set(key, { model: ls.device_model ?? item?.device_model, reference: item?.device_reference, lote: ls.lote, quantidade: ls.quantidade });
        }
        for (const row of rowMap.values()) printRows.push(row);
      } else {
        for (const item of pedido.itens) {
          if (item.lote && !LOTE_PH.has(item.lote.trim().toLowerCase())) {
            printRows.push({ model: item.device_model, reference: item.device_reference, lote: item.lote, quantidade: item.quantidade });
          } else {
            printRows.push({ model: item.device_model, reference: item.device_reference, lote: "", quantidade: item.quantidade });
          }
        }
      }

      const grouped = new Map<string, typeof printRows>();
      for (const row of printRows) {
        const key = `${row.model}|||${row.reference}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(row);
      }

      const statusLabel = pedido.status === "pronto" ? "✅ Pronto" : pedido.status === "separando" ? "🔄 Separando" : "⏳ Pendente";
      const statusColor = pedido.status === "pronto" ? "#166534" : pedido.status === "separando" ? "#1e40af" : "#92400e";
      const statusBg = pedido.status === "pronto" ? "#dcfce7" : pedido.status === "separando" ? "#dbeafe" : "#fef3c7";
      const dataPedido = new Date(pedido.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

      let tableRows = "";
      let idx = 0;
      for (const [, rows] of grouped) {
        idx++;
        const first = rows[0];
        const tipoTotal = rows.reduce((s, r) => s + r.quantidade, 0);
        const lotesBadges = rows
          .filter(r => r.lote && !LOTE_PH.has(r.lote.toLowerCase()))
          .map(r => `<span class="lote-badge">${escH(r.lote)}</span>`)
          .join(" ");
        const lotesCell = lotesBadges || `<span class="lote-empty">—</span>`;
        tableRows += `<tr>
          <td class="col-num">${idx}</td>
          <td class="col-model">
            <span class="model-name">${escH(first.model)}</span>
            <span class="model-ref">${escH(first.reference)}</span>
          </td>
          <td class="col-lotes">${lotesCell}</td>
          <td class="col-qty">${tipoTotal}</td>
        </tr>`;
      }

      const totalPecas = printRows.reduce((s, r) => s + r.quantidade, 0);
      totalGeralPecas += totalPecas;
      const totalTipos = grouped.size;

      sections += `
        <div class="pedido-section">
          <div class="pedido-header">
            <div class="pedido-header-main">
              <div class="pedido-title">${escH(pedido.cliente_nome)}</div>
              <div class="pedido-meta">
                Vendedora: <strong>${escH(pedido.vendedora_nome ?? "—")}</strong>
                &nbsp;·&nbsp; Data: <strong>${dataPedido}</strong>
                ${pedido.observacoes ? `&nbsp;·&nbsp; Obs: ${escH(pedido.observacoes)}` : ""}
              </div>
            </div>
            <span class="status-badge" style="background:${statusBg};color:${statusColor}">${statusLabel}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th class="col-num">#</th>
                <th class="col-model">Peça</th>
                <th class="col-lotes">Lotes</th>
                <th class="col-qty" style="text-align:right">Qtd.</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
          <div class="pedido-footer">
            <span>${totalPecas} peça${totalPecas !== 1 ? "s" : ""} · ${totalTipos} tipo${totalTipos !== 1 ? "s" : ""}</span>
          </div>
        </div>`;
    }

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Pedidos do Mês — ${mesAtual}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; padding: 24px 28px; color: #111; font-size: 13px; }
    .page-header { margin-bottom: 20px; border-bottom: 3px solid #ddd6fe; padding-bottom: 16px; }
    .page-header h1 { font-size: 22px; font-weight: 800; color: #3b0764; margin-bottom: 4px; }
    .page-header p { font-size: 12px; color: #666; }
    .pedido-section { margin-bottom: 24px; border: 1px solid #e8e4f7; border-radius: 10px; overflow: hidden; page-break-inside: avoid; }
    .pedido-header { background: #f3f0ff; padding: 10px 14px; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; border-bottom: 1px solid #ddd6fe; }
    .pedido-title { font-size: 14px; font-weight: 800; color: #3b0764; }
    .pedido-meta { font-size: 11px; color: #666; margin-top: 2px; }
    .status-badge { font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 20px; white-space: nowrap; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 7px 10px; background: #faf9ff; color: #5b21b6; border-bottom: 1px solid #ddd6fe; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
    td { padding: 6px 10px; border-bottom: 1px solid #f0eeff; vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    tr:nth-child(even) td { background: #faf9ff; }
    .col-num { width: 28px; color: #bbb; font-size: 11px; }
    .col-model { width: 38%; }
    .col-lotes { }
    .col-qty { width: 70px; text-align: right; font-weight: 800; font-size: 14px; color: #3b0764; white-space: nowrap; }
    .model-name { display: block; font-weight: 600; font-size: 12px; color: #1a1a2e; }
    .model-ref { display: block; font-family: monospace; font-size: 10px; color: #888; margin-top: 1px; }
    .lote-badge { display: inline-block; background: #f3f0ff; color: #5b21b6; font-family: monospace; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 4px; border: 1px solid #ddd6fe; margin: 1px 2px 1px 0; }
    .lote-empty { color: #bbb; font-size: 11px; }
    .pedido-footer { padding: 7px 14px; font-size: 11px; color: #888; background: #fafafa; border-top: 1px solid #f0eeff; }
    .page-footer { margin-top: 24px; padding-top: 12px; border-top: 2px solid #eee; display: flex; justify-content: space-between; font-size: 11px; color: #999; }
    @media print { button { display: none } body { padding: 16px } .pedido-section { page-break-inside: avoid; } }
  </style>
</head>
<body>
  <div class="page-header">
    <h1>📦 Pedidos — ${mesAtual}</h1>
    <p>Gerado em: ${nowStr} &nbsp;·&nbsp; ${pedidosParaImprimir.length} pedido${pedidosParaImprimir.length !== 1 ? "s" : ""} &nbsp;·&nbsp; ${totalGeralPecas} peças no total</p>
  </div>
  ${sections}
  <div class="page-footer">
    <span>Total: <strong>${totalGeralPecas} peças</strong> em <strong>${pedidosParaImprimir.length} pedido${pedidosParaImprimir.length !== 1 ? "s" : ""}</strong></span>
    <span>Zomini Usinagens Especiais</span>
  </div>
</body>
</html>`;

    const w = window.open("", "_blank");
    if (!w) return;
    w.document.open(); w.document.write(html); w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 250);
  }


  return (
    <div className="space-y-4">
      {/* Busca + Atualizar */}
      <div className="flex items-center gap-2">
        <SearchBarPedidos
          onSearch={v => { setSearchQuery(v); setHasSearch(!!v); }}
          onClear={() => { setSearchQuery(""); setHasSearch(false); }}
          hasValue={hasSearch}
        />
        <button
          type="button"
          onClick={loadPedidos}
          className="h-9 w-9 flex items-center justify-center rounded-full bg-muted/30 border border-border/40 text-muted-foreground hover:bg-muted/60 transition-colors shrink-0"
          title="Atualizar"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
        <button
          type="button"
          onClick={handleImprimirTodos}
          className="h-9 px-3 flex items-center gap-1.5 rounded-xl border border-border/40 bg-muted/30 text-muted-foreground hover:bg-muted/60 transition-colors shrink-0 text-sm no-print"
          title="Imprimir todos os pedidos do mês"
        >
          <Printer className="h-3.5 w-3.5" />
          Imprimir
        </button>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="rounded-2xl border p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-muted/40 animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-muted/40 rounded animate-pulse w-48" />
                  <div className="h-3 bg-muted/30 rounded animate-pulse w-32" />
                </div>
              </div>
              <div className="h-3 bg-muted/30 rounded animate-pulse w-full" />
              <div className="h-3 bg-muted/20 rounded animate-pulse w-3/4" />
            </div>
          ))}
        </div>
      ) : filtrados.length === 0 ? (
        <div className="text-center py-16 space-y-2">
          <ShoppingBag className="h-10 w-10 text-muted-foreground/30 mx-auto" />
          <p className="text-sm text-muted-foreground">Nenhum pedido encontrado</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtrados.map(pedido => (
            <PedidoCard
              key={pedido.id}
              pedido={pedido}
              onIniciarSeparacao={handleIniciarSeparacao}
              onSalvarSeparacao={handleSalvarSeparacao}
              onMarcarPronto={handleMarcarPronto}
              onCancelar={setCancelarPedido}
              onEditarItem={(pedido, item) => setEditarItem({ pedido, item })}
              isAdmin={isAdmin}
            />
          ))}
        </div>
      )}

      {/* Modal editar quantidade de item pendente */}
      <EditarItemModal
        pedido={editarItem?.pedido ?? null}
        item={editarItem?.item ?? null}
        onClose={() => setEditarItem(null)}
        onSuccess={loadPedidos}
      />

      {/* Cancelar pedido */}
      {cancelarPedido && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-card border border-border/30 p-5 space-y-4 shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-200">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
                <Ban className="h-4 w-4 text-destructive" />
              </div>
              <div>
                <p className="text-sm font-semibold">Cancelar pedido?</p>
                <p className="text-[12px] text-muted-foreground mt-0.5">{cancelarPedido.cliente_nome}</p>
              </div>
            </div>
            <p className="text-[12px] text-muted-foreground">As peças reservadas serão devolvidas ao estoque da expedição.</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setCancelarPedido(null)} disabled={cancelando} className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors">Voltar</button>
              <button type="button" onClick={handleCancelar} disabled={cancelando} className="flex-1 h-9 rounded-xl bg-destructive text-destructive-foreground text-sm font-semibold hover:bg-destructive/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5">
                {cancelando ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                Cancelar pedido
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
