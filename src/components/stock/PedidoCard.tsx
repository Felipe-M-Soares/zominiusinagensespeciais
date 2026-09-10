import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { escHtml } from "@/lib/escHtml";
import { detectarUF, adaptarCFOP as adaptarCFOPShared } from "@/lib/cfop";
import { fetchLotesDisponivelBatch } from "@/hooks/useStock";
import { displayLote } from "@/lib/lote";
import type { Pedido, PedidoItem, LoteDisponivel, LoteSelecao } from "@/components/stock/pedidosEstoqueTypes";
import {
  AlertTriangle, Ban, CheckCircle2, ChevronDown, ChevronUp, Clock,
  MapPin, Minus, Package, PackageCheck, Plus, Printer, RotateCcw,
  ShoppingBag, Tag, Trash2, Truck, User,
} from "lucide-react";

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
  if (status === "pendente") return "bg-amber-400 text-white border-amber-500 shadow-sm shadow-amber-400/30";
  if (status === "separando") return "bg-blue-500 text-white border-blue-600 shadow-sm shadow-blue-500/30";
  if (status === "pronto") return "bg-emerald-500 text-white border-emerald-600 shadow-sm shadow-emerald-500/30";
  if (status === "faturado") return "bg-violet-500 text-white border-violet-600 shadow-sm shadow-violet-500/30";
  if (status === "enviado") return "bg-sky-500 text-white border-sky-600 shadow-sm shadow-sky-500/30";
  if (status === "retorno") return "bg-orange-500 text-white border-orange-600 shadow-sm shadow-orange-500/30";
  return "bg-muted text-muted-foreground border-border";
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    pendente: "Pendente",
    separando: "Separando",
    pronto: "Pronto",
    faturado: "Faturado",
    enviado: "Enviado",
    cancelado: "Cancelado",
    retorno: "Retorno",
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

interface PedidoCardProps {
  pedido: Pedido;
  onExpandChange?: (pedidoId: string, expanded: boolean) => void;
  onIniciarSeparacao: (pedido: Pedido, lotesSelecionados: LoteSelecao, expIdByItem: Record<string, string>) => void;
  onSalvarSeparacao: (pedido: Pedido, lotesSelecionados: LoteSelecao, expIdByItem: Record<string, string>) => Promise<void>;
  onMarcarPronto: (pedido: Pedido, lotesSelecionados: LoteSelecao, expIdByItem: Record<string, string>) => void;
  onCancelar: (pedido: Pedido) => void;
  onEditarItem: (pedido: Pedido, item: PedidoItem) => void;
  onRetornar: (pedido: Pedido) => void;
  onRemoverItem: (pedido: Pedido, item: PedidoItem) => void;
  onEditarEndereco: (pedido: Pedido) => void;
  isAdmin: boolean;
}

export function PedidoCard({ pedido, onExpandChange, onIniciarSeparacao, onSalvarSeparacao, onMarcarPronto, onCancelar, onEditarItem, onRetornar, onRemoverItem, onEditarEndereco, isAdmin }: PedidoCardProps) {
  const [expanded, setExpanded] = useState(false);

  // Notifica o painel pai quando o card expande/recolhe
  // O pai usa isso para não recarregar via Realtime enquanto há separação em andamento
  useEffect(() => {
    onExpandChange?.(pedido.id, expanded);
    return () => { onExpandChange?.(pedido.id, false); };
  }, [expanded, pedido.id, onExpandChange]);

  // ── State ──────────────────────────────────────────────────────────────────
  // expId per item: the real expedição stock_item_id (may differ from pedido_item.stock_item_id)
  const [expIdByItem, setExpIdByItem] = useState<Record<string, string>>({});
  // available lotes per item (keyed by item.id)
  const [lotesDisp, setLotesDisp] = useState<Record<string, LoteDisponivel[]>>({});
  // user selection: { [item.id]: { [lote]: qty } }
  const [sel, setSel] = useState<LoteSelecao>({});
  // rascunho de digitação do campo de quantidade por lote — não afeta `sel` até o onBlur,
  // evita que o campo "feche" (lote desmarcado) a cada tecla apertada ao apagar para editar
  const [qtyRascunho, setQtyRascunho] = useState<Record<string, string>>({});
  function setQtyLoteRascunho(itemId: string, lote: string, value: string) {
    setQtyRascunho(prev => ({ ...prev, [`${itemId}::${lote}`]: value }));
  }
  const [loadingLotes, setLoadingLotes] = useState(false);
  const loadedRef = useRef(false);
  // Per-item confirmation (only relevant during "separando")
  // Keyed por stock_item_id (estável entre reloads) — não por item.id (pode mudar)
  const [confirmedItems, setConfirmedItems] = useState<Set<string>>(new Set());
  // Ref espelho: sobrevive ao reset do useEffect de carga (race condition com Realtime)
  const confirmedItemsRef = useRef<Set<string>>(new Set());
  const [savingItem, setSavingItem] = useState<string | null>(null);

  // Reseta loadedRef quando os itens do pedido mudam (peça removida ou adicionada)
  // para que o card recarregue os lotes com os dados corretos
  const itemCountRef = useRef(pedido.itens.length);
  if (pedido.itens.length !== itemCountRef.current) {
    itemCountRef.current = pedido.itens.length;
    loadedRef.current = false;
    // Limpa sel e confirmedItems pois os itens mudaram
    confirmedItemsRef.current = new Set();
  }

  const isSeparando = pedido.status === "separando";
  const isPendente  = pedido.status === "pendente";
  const totalItens  = pedido.itens.reduce((s, i) => s + i.quantidade, 0);

  // ── Load lotes on expand ───────────────────────────────────────────────────
  // loadedRef: impede recarga enquanto card está expandido e dados já foram buscados
  // NÃO resetamos loadedRef pelo Realtime — isso causava race condition com confirmedItems.
  // O Realtime atualiza apenas o sel via useEffect dedicado abaixo (sem resetar confirmações).

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
      // - separando: restore from lotes_separados snapshot (per expId)
      // - pendente:  auto-distribute FIFO by item.quantidade
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
  }, [expanded]); // Só roda na primeira expansão — Realtime tratado pelo useEffect abaixo

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
    const sel = totalSel(item.id);
    // Exige seleção completa — sem estoque ou seleção parcial trava o botão
    return sel === item.quantidade && sel > 0;
  });

  // All items confirmed (multi-item: each must be individually confirmed)
  const allItemsConfirmed = isSeparando && pedido.itens.length > 1
    ? pedido.itens.every(item => confirmedItems.has(item.stock_item_id))
    : true;

  // Marcar como Pronto só libera se TODOS os itens tiverem seleção completa
  const canMarcarPronto = isSeparando && pedido.itens.every(item => {
    // Multi-item: usa confirmedItems keyed por stock_item_id (estável entre reloads)
    if (pedido.itens.length > 1) return confirmedItems.has(item.stock_item_id);
    // Item único: verifica seleção de lotes
    const sel = totalSel(item.id);
    return sel === item.quantidade && sel > 0;
  });

  // Confirm a single item during separation: save snapshot and mark locally
  async function handleConfirmarItem(item: PedidoItem) {
    if (savingItem) return;
    setSavingItem(item.stock_item_id);
    try {
      // Build a merged snapshot including this item's selection
      const snapshotMap = new Map<string, { pedido_item_id: string; stock_item_id: string; lote: string; quantidade: number; device_model?: string }>();
      // Start from existing lotes_separados for OTHER items
      for (const ls of pedido.lotes_separados ?? []) {
        const ownerItem = pedido.itens.find(
          i => (expIdByItem[i.id] ?? i.stock_item_id) === ls.stock_item_id && i.id !== item.id
        );
        if (!ownerItem) continue; // skip entries belonging to this item (will be replaced)
        const key = `${ls.stock_item_id}||${ls.lote}`;
        const ex = snapshotMap.get(key);
        if (ex) ex.quantidade += ls.quantidade;
        else snapshotMap.set(key, { pedido_item_id: ownerItem.ids[0], stock_item_id: ls.stock_item_id, lote: ls.lote, quantidade: ls.quantidade, device_model: ls.device_model });
      }
      // Add this item's current selection
      const expId = expIdByItem[item.id] ?? item.stock_item_id;
      for (const [lote, qty] of Object.entries(sel[item.id] ?? {})) {
        if (qty <= 0) continue;
        const key = `${expId}||${lote}`;
        const ex = snapshotMap.get(key);
        if (ex) ex.quantidade += qty;
        else snapshotMap.set(key, { pedido_item_id: item.ids[0], stock_item_id: expId, lote, quantidade: qty, device_model: item.device_model });
      }
      const snapshot = [...snapshotMap.values()];
      const { error } = await supabase
        .from("pedidos_comerciais")
        .update({ lotes_separados: snapshot })
        .eq("id", pedido.id);
      if (error) { toast.error("Erro ao confirmar peça."); return; }
      // Atualiza ref PRIMEIRO (sobrevive ao reset do Realtime) depois o state
      confirmedItemsRef.current = new Set([...confirmedItemsRef.current, item.stock_item_id]);
      setConfirmedItems(new Set(confirmedItemsRef.current));
      toast.success(`${item.device_model} confirmada!`);
    } catch (_e) {
      toast.error("Erro ao confirmar peça.");
    } finally {
      setSavingItem(null);
    }
  }

  // ── Print ──────────────────────────────────────────────────────────────────
  async function handleImprimir() {
    const now = new Date().toLocaleDateString("pt-BR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
    const LOTE_PH = new Set(["a-definir","a definir","sem lote",""]);
    const printRows: { model?: string; reference?: string; lote: string; quantidade: number; stock_item_id?: string }[] = [];

    const hasSel = Object.keys(sel).length > 0;
    const hasSep = (pedido.lotes_separados ?? []).length > 0;

    if (hasSep) {
      // lotes_separados é sempre a fonte mais confiável — tem um entry por (stock_item, lote)
      const rowMap = new Map<string, { model?: string; reference?: string; lote: string; quantidade: number; stock_item_id?: string }>();
      for (const ls of pedido.lotes_separados!) {
        const item = pedido.itens.find(i => (expIdByItem[i.id] ?? i.stock_item_id) === ls.stock_item_id)
          ?? pedido.itens.find(i => i.device_model === ls.device_model);
        const key = `${ls.device_model}||${ls.lote}`;
        const ex = rowMap.get(key);
        if (ex) ex.quantidade += ls.quantidade;
        else rowMap.set(key, { model: ls.device_model ?? item?.device_model, reference: item?.device_reference, lote: ls.lote, quantidade: ls.quantidade, stock_item_id: item?.stock_item_id ?? ls.stock_item_id });
      }
      for (const row of rowMap.values()) printRows.push(row);
    } else if (hasSel) {
      // Seleção ativa na tela (pedido pendente ainda não iniciado)
      const rowMap = new Map<string, { model?: string; reference?: string; lote: string; quantidade: number; stock_item_id?: string }>();
      for (const item of pedido.itens) {
        for (const [lote, qty] of Object.entries(sel[item.id] ?? {})) {
          if (qty <= 0) continue;
          const key = `${item.device_model}||${lote}`;
          const ex = rowMap.get(key);
          if (ex) ex.quantidade += qty;
          else rowMap.set(key, { model: item.device_model, reference: item.device_reference, lote, quantidade: qty, stock_item_id: item.stock_item_id });
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
            printRows.push({ model: item.device_model, reference: item.device_reference, lote, quantidade: item.quantidade, stock_item_id: item.stock_item_id });
          }
        } else {
          printRows.push({ model: item.device_model, reference: item.device_reference, lote: "", quantidade: item.quantidade, stock_item_id: item.stock_item_id });
        }
      }
    }

    // ── Busca dados completos do pedido e cliente (antes de montar tableBody) ──
    const stockItemIdsParaDevice = [...new Set(pedido.itens.map(i => i.stock_item_id).filter(Boolean))];
    const [{ data: pedidoExtra }, { data: clienteData }, { data: itensPreco }, { data: stockItemsData }] = await Promise.all([
      supabase.from("pedidos_comerciais")
        .select("forma_pagamento, parcelas, endereco_entrega, usar_endereco_cliente, desconto_pct, frete")
        .eq("id", pedido.id).maybeSingle(),
      supabase.from("clientes")
        .select("documento, ie, telefone, email, logradouro, numero, bairro, municipio, uf, cep, c_mun, endereco")
        .eq("id", pedido.cliente_id).maybeSingle(),
      supabase.from("pedido_itens")
        .select("stock_item_id, quantidade, preco_unitario, valor_total")
        .eq("pedido_id", pedido.id),
      supabase.from("stock_items")
        .select("id, devices(ncm, cfop_padrao, ipi_pct, preco_venda, margem_minima_pct)")
        .in("id", stockItemIdsParaDevice),
    ]);

    type ClienteExtra = {
      documento?: string; ie?: string; telefone?: string; email?: string;
      logradouro?: string; numero?: string; bairro?: string; municipio?: string;
      uf?: string; cep?: string; c_mun?: string; endereco?: string;
    };
    type PedidoExtra = {
      forma_pagamento?: string; parcelas?: number; endereco_entrega?: string;
      usar_endereco_cliente?: boolean; desconto_pct?: number; frete?: number;
    };
    type DeviceExtra = { ncm?: string; cfop_padrao?: string; ipi_pct?: number; preco_venda?: number };
    type StockItemRow = { id: string; devices?: DeviceExtra | null };
    type ItemPreco = { stock_item_id: string; quantidade: number; preco_unitario?: number; valor_total?: number };

    const cl = clienteData as ClienteExtra | null;
    const ex = pedidoExtra as PedidoExtra | null;
    // Mapa direto stock_item_id → dados do device (via join stock_items → devices)
    const devByStockItem = new Map<string, DeviceExtra>(
      ((stockItemsData ?? []) as StockItemRow[]).map(si => [si.id, si.devices ?? {}])
    );
    const itemPrecoMap = new Map<string, ItemPreco>(
      ((itensPreco ?? []) as ItemPreco[]).map(i => [i.stock_item_id, i])
    );

    const endFormatado = cl?.logradouro
      ? `${cl.logradouro}${cl.numero ? ", " + cl.numero : ""}${cl.bairro ? " — " + cl.bairro : ""}${cl.municipio ? " — " + cl.municipio : ""}${cl.uf ? "/" + cl.uf : ""}${cl.cep ? " — CEP " + cl.cep : ""}`
      : (cl?.endereco ?? "");
    const enderecoEntrega = ex?.usar_endereco_cliente !== false
      ? endFormatado
      : (ex?.endereco_entrega ?? endFormatado);

    const fmtPagamento: Record<string, string> = {
      dinheiro: "A VISTA — Dinheiro", pix: "A VISTA — PIX", boleto: "Boleto",
      cartao_debito: "Cartão de Débito", cartao_credito: "Cartão de Crédito",
    };
    const pagamentoLabel = ex?.forma_pagamento
      ? fmtPagamento[ex.forma_pagamento] ?? ex.forma_pagamento
      : "A VISTA";
    // Parcelas em linha separada, sem traço
    const parcelasLabel = ["cartao_credito", "boleto"].includes(ex?.forma_pagamento ?? "") && (ex?.parcelas ?? 1) > 1
      ? `<br><span style="font-weight:400;font-size:10px">${ex?.parcelas}x</span>` : "";
    const desconto = ex?.desconto_pct ?? pedido.desconto_pct ?? 0;
    const frete = ex?.frete ?? 0;

    // ── CFOP por localidade: 5xxx (intraestadual) ou 6xxx (interestadual) ────────
    // UF da empresa emitente: SP. UF do cliente extraída do endereço.
    const UF_EMPRESA = "SP";
    const endCliente = cl?.logradouro
      ? `${cl?.municipio ?? ""} ${cl?.uf ?? ""}`.trim()
      : (cl?.endereco ?? enderecoEntrega ?? "");
    const ufCliente = cl?.uf ?? detectarUF(endCliente);
    const isInterestadual = ufCliente && ufCliente !== UF_EMPRESA;

    // Mapeia CFOP base: 5102 → 6102 se interestadual; 5405 → 6404; etc.
    function adaptarCFOP(cfopOriginal: string | null | undefined): string {
      return adaptarCFOPShared(cfopOriginal, ufCliente, UF_EMPRESA);
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
    let subtotalGeral = 0;
    for (const [, rows] of grouped) {
      rowIdx++;
      const first = rows[0];
      const tipoTotal = rows.reduce((s, r) => s + r.quantidade, 0);

      // Preço unitário — busca nos pedido_itens ou nos devices como fallback
      const itemPreco = itemPrecoMap.get(first.stock_item_id ?? "");
      const dev = devByStockItem.get(first.stock_item_id ?? "");
      // Se preco_unitario do pedido_item for 0 ou nulo, usa preco_venda do device
      const precoFromItem = itemPreco?.preco_unitario ?? 0;
      const precoUnit = precoFromItem > 0 ? precoFromItem : (dev?.preco_venda ?? 0);
      const precoComDesconto = desconto > 0 ? precoUnit * (1 - desconto / 100) : precoUnit;
      const valorTotal = precoComDesconto * tipoTotal;
      subtotalGeral += valorTotal;

      const ncm = dev?.ncm ?? "—";
      const cfop = adaptarCFOP(dev?.cfop_padrao);
      const ipiNum = dev?.ipi_pct ?? 0;
      const ipi = ipiNum > 0 ? ipiNum.toFixed(2).replace(".", ",") + "%" : "0,00%";

      const precoFmt = (v: number) => v > 0 ? "R$ " + v.toFixed(2).replace(".", ",") : "—";

      tableBody += `<tr>
        <td class="col-num">${rowIdx}</td>
        <td class="col-model">
          <span class="model-name">${escHtml(first.model ?? "")}</span>
          <span class="model-ref">${escHtml(first.reference ?? "")}</span>
          <span class="model-meta">NCM: ${ncm} &nbsp;|&nbsp; CFOP: ${cfop} &nbsp;|&nbsp; IPI: ${ipi}</span>
        </td>
        <td class="col-preco">${precoFmt(precoComDesconto)}</td>
        <td class="col-qty">${tipoTotal}</td>
        <td class="col-total">${precoFmt(valorTotal)}</td>
      </tr>`;
    }

    const totalPecas = printRows.reduce((s, r) => s + r.quantidade, 0);
    const totalTipos = grouped.size;
    const totalComFrete = subtotalGeral + frete;
    const fmtVal = (v: number) => "R$ " + v.toFixed(2).replace(".", ",");

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Pedido ${pedido.id.slice(0,8).toUpperCase()} — ${escHtml(pedido.cliente_nome)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; padding: 20px 24px; color: #111; font-size: 11px; }

    .empresa-header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 10px; border-bottom: 2px solid #111; margin-bottom: 10px; }
    .empresa-nome { font-size: 14px; font-weight: 800; text-transform: uppercase; }
    .empresa-info { font-size: 9.5px; color: #444; line-height: 1.7; margin-top: 2px; }
    .empresa-contato { text-align: right; font-size: 9.5px; color: #444; line-height: 1.7; }

    .pedido-info { display: flex; border: 1px solid #bbb; margin-bottom: 8px; }
    .pedido-info-col { flex: 1; padding: 5px 8px; border-right: 1px solid #bbb; font-size: 10px; }
    .pedido-info-col:last-child { border-right: none; }
    .pedido-info-label { font-size: 8px; text-transform: uppercase; color: #999; font-weight: 700; margin-bottom: 1px; }
    .pedido-info-val { font-weight: 700; color: #111; font-size: 11px; }

    .cliente-box { border: 1px solid #bbb; padding: 7px 10px; margin-bottom: 8px; font-size: 10px; line-height: 1.8; }
    .cliente-title { font-size: 8px; text-transform: uppercase; color: #999; font-weight: 700; margin-bottom: 4px; }
    .cliente-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 20px; }

    table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    th { text-align: left; padding: 6px 7px; background: #f0f0f0; border: 1px solid #bbb; font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; }
    td { padding: 5px 7px; border: 1px solid #ddd; vertical-align: top; font-size: 10px; }
    tr:nth-child(even) td { background: #fafafa; }
    .col-num { width: 22px; text-align: center; color: #999; }
    .col-model { width: 42%; }
    .col-preco { width: 80px; text-align: right; white-space: nowrap; }
    .col-qty { width: 45px; text-align: center; font-weight: 800; }
    .col-total { width: 90px; text-align: right; font-weight: 700; white-space: nowrap; }
    .model-name { display: block; font-weight: 700; font-size: 10.5px; }
    .model-ref { display: block; font-family: monospace; font-size: 8.5px; color: #888; }
    .model-meta { display: block; font-size: 8px; color: #aaa; margin-top: 2px; }

    .totais-box { border: 1px solid #bbb; margin-bottom: 14px; }
    .totais-row { display: flex; justify-content: space-between; padding: 5px 10px; border-bottom: 1px solid #eee; font-size: 10px; }
    .totais-row:last-child { border-bottom: none; font-weight: 800; font-size: 12px; background: #f5f5f5; }
    .totais-label { color: #666; }
    .totais-val { font-weight: 600; }

    .obs-box { background: #f9f9f9; border-left: 3px solid #999; padding: 5px 8px; margin-bottom: 8px; font-size: 10px; color: #555; }

    .assinaturas { display: flex; justify-content: space-between; margin-top: 36px; gap: 40px; }
    .assinatura { flex: 1; border-top: 1px solid #333; padding-top: 5px; text-align: center; font-size: 9.5px; color: #555; }

    @page { size: A4 portrait; margin: 15mm 15mm 15mm 15mm; }
    @media print { button { display: none } body { padding: 0 } }
  </style>
</head>
<body>

  <!-- Cabeçalho empresa -->
  <div class="empresa-header">
    <div>
      <div class="empresa-nome">Zomini Usinagens Especiais Ltda. ME</div>
      <div class="empresa-info">
        CNPJ: 00.000.000/0000-00 &nbsp;|&nbsp; IE: 000.000.000.000<br>
        Av. Fictícia, 1000 — Jardim Exemplo — Indaiatuba/SP — CEP 13.000-000
      </div>
    </div>
    <div class="empresa-contato">
      <strong>CONTATO:</strong><br>
      contato@zomini.com.br<br>
      www.zomini.com.br<br>
      (19) 00000-0000
    </div>
  </div>

  <!-- Info do pedido -->
  <div class="pedido-info">
    <div class="pedido-info-col">
      <div class="pedido-info-label">NRO. Pedido</div>
      <div class="pedido-info-val">${pedido.id.slice(0,8).toUpperCase()}</div>
    </div>
    <div class="pedido-info-col">
      <div class="pedido-info-label">Tipo</div>
      <div class="pedido-info-val">COMÉRCIO</div>
    </div>
    <div class="pedido-info-col">
      <div class="pedido-info-label">Status</div>
      <div class="pedido-info-val">${pedido.status.toUpperCase()}</div>
    </div>
    <div class="pedido-info-col">
      <div class="pedido-info-label">Data</div>
      <div class="pedido-info-val">${now}</div>
    </div>
    <div class="pedido-info-col">
      <div class="pedido-info-label">PGTO.</div>
      <div class="pedido-info-val">${pagamentoLabel}${parcelasLabel}</div>
    </div>
    ${desconto > 0 ? `<div class="pedido-info-col">
      <div class="pedido-info-label">Desconto</div>
      <div class="pedido-info-val">${desconto}%</div>
    </div>` : ""}
  </div>

  <!-- Vendedora -->
  <div style="font-size:10px; margin-bottom:4px; color:#555;">
    Vendedora: <strong style="color:#111">${escHtml(pedido.vendedora_nome ?? "—")}</strong>
    ${ufCliente ? ` &nbsp;|&nbsp; CFOP: <strong style="color:#111">${isInterestadual ? "6xxx (Interestadual — " + ufCliente + ")" : "5xxx (Intraestadual — SP)"}</strong>` : ""}
    ${pedido.prazo_entrega ? ` &nbsp;|&nbsp; Prazo de entrega: <strong style="color:#111">${new Date(pedido.prazo_entrega + "T12:00:00").toLocaleDateString("pt-BR")}</strong>` : ""}
  </div>

  <!-- Dados do cliente -->
  <div class="cliente-box">
    <div class="cliente-title">Destinatário</div>
    <div class="cliente-grid">
      <div>
        <strong style="font-size:11px">${escHtml(pedido.cliente_nome)}</strong><br>
        ${cl?.documento ? `CPF/CNPJ: ${escHtml(cl.documento)}<br>` : ""}
        ${cl?.ie ? `IE: ${escHtml(cl.ie)}<br>` : ""}
        ${cl?.c_mun ? `Cód. Município: ${escHtml(cl.c_mun)}<br>` : ""}
        ${enderecoEntrega ? `End.: ${escHtml(enderecoEntrega)}` : ""}
      </div>
      <div>
        ${cl?.telefone ? `Telefone: ${escHtml(cl.telefone)}<br>` : ""}
        ${cl?.email ? `E-mail: ${escHtml(cl.email)}<br>` : ""}
      </div>
    </div>
  </div>

  ${pedido.observacoes ? `<div class="obs-box"><strong>Obs:</strong> ${escHtml(pedido.observacoes)}</div>` : ""}

  <!-- Tabela de itens -->
  <table>
    <thead>
      <tr>
        <th class="col-num">#</th>
        <th class="col-model">Descrição / Item</th>
        <th class="col-preco" style="text-align:right">R$ Unit.</th>
        <th class="col-qty" style="text-align:center">Qtd.</th>
        <th class="col-total" style="text-align:right">Valor (R$)</th>
      </tr>
    </thead>
    <tbody>${tableBody}</tbody>
  </table>

  <!-- Totais -->
  <div class="totais-box">
    ${frete > 0 ? `<div class="totais-row"><span class="totais-label">Subtotal dos itens</span><span class="totais-val">${fmtVal(subtotalGeral)}</span></div>
    <div class="totais-row"><span class="totais-label">Frete</span><span class="totais-val">${fmtVal(frete)}</span></div>` : ""}
    <div class="totais-row">
      <span class="totais-label">VALOR TOTAL DOS ITENS${frete > 0 ? " + FRETE" : ""}</span>
      <span class="totais-val">${fmtVal(totalComFrete)}</span>
    </div>
  </div>

  <!-- Assinaturas -->
  <div class="assinaturas">
    <div class="assinatura">Zomini Usinagens Especiais Ltda. ME</div>
    <div class="assinatura">${escHtml(pedido.cliente_nome)}</div>
  </div>

</body>
</html>`;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.open(); w.document.write(html); w.document.close();
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
      "rounded-2xl border-2 overflow-hidden transition-all shadow-sm",
      isPendente   ? "border-amber-400/60 bg-amber-500/5 shadow-amber-400/10" :
      isSeparando  ? "border-blue-500/60 bg-blue-500/5 shadow-blue-500/10" :
      pedido.status === "pronto" ? "border-emerald-500/60 bg-emerald-500/5 shadow-emerald-500/10" :
      pedido.status === "retorno" ? "border-orange-500/60 bg-orange-500/5 shadow-orange-500/10" :
      "border-border bg-card"
    )}>
      {/* Header */}
      {/* Barra colorida de status no topo */}
      <div className={cn("h-1 w-full",
        isPendente   ? "bg-amber-400" :
        isSeparando  ? "bg-blue-500" :
        pedido.status === "pronto"   ? "bg-emerald-500" :
        pedido.status === "retorno"  ? "bg-orange-500" :
        "bg-border"
      )} />
      <button type="button" onClick={() => setExpanded(v => !v)}
        className="w-full text-left px-4 py-3 flex items-start gap-3">
        <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5",
          isPendente   ? "bg-amber-400 shadow-sm shadow-amber-400/40" :
          isSeparando  ? "bg-blue-500 shadow-sm shadow-blue-500/40" :
          pedido.status === "pronto"  ? "bg-emerald-500 shadow-sm shadow-emerald-500/40" :
          pedido.status === "retorno" ? "bg-orange-500 shadow-sm shadow-orange-500/40" :
          "bg-muted/50")}>
          <ShoppingBag className={cn("h-4 w-4",
            isPendente || isSeparando || pedido.status === "pronto" || pedido.status === "retorno"
              ? "text-white"
              : "text-muted-foreground")} />
        </div>
        <div className="flex-1 min-w-0">
          {/* Linha 1: cliente + status */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold truncate">{pedido.cliente_nome}</span>
            <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", statusColor(pedido.status))}>
              {statusLabel(pedido.status)}
            </span>
          </div>
          {/* Linha 2: número do pedido + vendedora */}
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <span className="flex items-center gap-1 text-[11px] font-mono font-semibold text-muted-foreground/80 bg-muted/30 px-1.5 py-0.5 rounded">
              #{pedido.id.slice(0, 8).toUpperCase()}
            </span>
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
          {/* Linha 3: local de entrega + prazo + observações */}
          {(() => {
            const localEntrega = pedido.endereco_entrega
              || (pedido.cliente_municipio
                ? `${pedido.cliente_municipio}${pedido.cliente_uf ? "/" + pedido.cliente_uf : ""}`
                : null);
            return (localEntrega || pedido.prazo_entrega || pedido.observacoes) ? (
              <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                {localEntrega && (
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground font-medium">
                    <MapPin className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate max-w-[180px]">{localEntrega}</span>
                  </span>
                )}
                {pedido.prazo_entrega && (
                  <span className="flex items-center gap-1 text-[11px] text-amber-600 font-medium">
                    <Clock className="h-2.5 w-2.5" />
                    {new Date(pedido.prazo_entrega).toLocaleDateString("pt-BR")}
                  </span>
                )}
                {pedido.observacoes && (
                  <span className="text-[11px] text-muted-foreground/70 italic truncate max-w-[180px]">
                    "{pedido.observacoes}"
                  </span>
                )}
              </div>
            ) : null;
          })()}
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
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="flex flex-col items-end">
                          <span className="text-[10px] text-muted-foreground/60 leading-none">pedido</span>
                          <span className="text-[13px] font-bold">{groupTotalPedido} un.</span>
                        </div>
                        {isSeparando && pedido.itens.length > 1 && (
                          <button
                            type="button"
                            onClick={() => onRemoverItem(pedido, firstItem)}
                            className="h-6 w-6 flex items-center justify-center rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive transition-colors"
                            title="Remover peça do pedido"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
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
                                          isSel ? "bg-blue-500/15 border-blue-500/50" : "bg-muted/20 border-border/20"
                                        )}
                                      >
                                        <button
                                          type="button"
                                          onClick={() => toggleLote(item.id, l.lote, l.quantity)}
                                          className={cn("h-4 w-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
                                            isSel ? "bg-blue-500 border-blue-500 shadow-sm shadow-blue-500/40" : "border-muted-foreground/40")}
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
                                              inputMode="numeric"
                                              min={1}
                                              max={l.quantity}
                                              value={qtyRascunho[`${item.id}::${l.lote}`] ?? (qtySel === 0 ? "" : String(qtySel))}
                                              onChange={(e) => {
                                                const raw = e.target.value;
                                                if (raw === "" || /^[0-9]+$/.test(raw)) setQtyLoteRascunho(item.id, l.lote, raw);
                                              }}
                                              onBlur={(e) => {
                                                const v = parseInt(e.target.value, 10);
                                                setQtyLote(item.id, l.lote, isNaN(v) ? 0 : v, l.quantity);
                                                setQtyRascunho(prev => { const n = { ...prev }; delete n[`${item.id}::${l.lote}`]; return n; });
                                              }}
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

                            {/* Separando: indicador de status da peça + botão confirmar */}
                            {isSeparando && pedido.itens.length > 1 && (() => {
                              const isItemOk = totalSel(item.id) === item.quantidade;
                              const isConfirmed = confirmedItems.has(item.stock_item_id);
                              const isSaving = savingItem === item.stock_item_id;
                              if (isConfirmed) {
                                return (
                                  <div className="flex items-center gap-2 mt-1 px-2 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25">
                                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                                    <span className="text-[11px] font-semibold text-emerald-600">Peça confirmada na separação</span>
                                  </div>
                                );
                              }
                              return (
                                <div className="flex items-center gap-2 mt-1">
                                  <div className={cn(
                                    "flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-[11px] font-medium",
                                    isItemOk
                                      ? "bg-amber-500/8 border-amber-500/25 text-amber-600"
                                      : "bg-destructive/8 border-destructive/25 text-destructive"
                                  )}>
                                    {isItemOk
                                      ? <><Package className="h-3 w-3 shrink-0" /> Lotes escolhidos — confirme abaixo</>
                                      : <><AlertTriangle className="h-3 w-3 shrink-0" /> Lotes não separados ainda</>
                                    }
                                  </div>
                                  {isItemOk && (
                                    <button
                                      type="button"
                                      onClick={() => handleConfirmarItem(item)}
                                      disabled={!!savingItem}
                                      className="h-8 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white text-[11px] font-bold transition-colors disabled:opacity-50 flex items-center gap-1.5 shrink-0"
                                    >
                                      {isSaving
                                        ? <div className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                        : <CheckCircle2 className="h-3 w-3" />
                                      }
                                      Confirmar
                                    </button>
                                  )}
                                </div>
                              );
                            })()}

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
                                    <div key={lote} className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/40">
                                      <Tag className="h-2.5 w-2.5 text-emerald-500 shrink-0" />
                                      <span className="text-[11px] font-mono font-bold text-emerald-600 tracking-wider">{lote}</span>
                                      <span className="text-[10px] text-emerald-600/70 font-medium">{qty} un.</span>
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

            {isPendente && (() => {
              // Calcula quantos itens ainda faltam seleção
              const itensFaltando = pedido.itens.filter(item => {
                const sel_item = totalSel(item.id);
                return sel_item < item.quantidade;
              });
              const itensSemEstoque = pedido.itens.filter(item => (lotesDisp[item.id] ?? []).length === 0);
              const btnLabel = itensSemEstoque.length > 0
                ? `Sem estoque (${itensSemEstoque.length} ${itensSemEstoque.length > 1 ? "itens" : "item"})`
                : itensFaltando.length > 0
                ? `Selecione as peças (${itensFaltando.length} pendente${itensFaltando.length > 1 ? "s" : ""})`
                : "Iniciar Separação";
              return (
              <button type="button"
                onClick={() => {
                  if (!canConfirmar) return;
                  onIniciarSeparacao(pedido, sel, expIdByItem);
                }}
                disabled={!canConfirmar || loadingLotes}
                className={cn(
                  "flex-1 h-9 rounded-xl text-[12px] font-semibold transition-colors flex items-center justify-center gap-1.5 disabled:pointer-events-none",
                  canConfirmar
                    ? "bg-blue-500 hover:bg-blue-600 text-white shadow-sm shadow-blue-500/30"
                    : "bg-destructive/10 text-destructive opacity-80 cursor-not-allowed"
                )}>
                <PackageCheck className="h-3.5 w-3.5" />
                {btnLabel}
              </button>
              );
            })()}

            {isSeparando && (() => {
              const multiPecas = pedido.itens.length > 1;
              const totalConfirmed = confirmedItems.size;
              const totalPecasTipos = pedido.itens.length;
              return (
                <div className="flex-1 flex flex-col gap-1.5">
                  {multiPecas && (
                    <div className="flex items-center justify-between px-2">
                      <span className="text-[10px] text-muted-foreground">
                        {totalConfirmed}/{totalPecasTipos} peças confirmadas
                      </span>
                      <div className="flex gap-1">
                        {pedido.itens.map(it => (
                          <div
                            key={it.id}
                            className={cn(
                              "h-1.5 w-4 rounded-full transition-colors",
                              confirmedItems.has(it.stock_item_id) ? "bg-emerald-500" : "bg-destructive/40"
                            )}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (!canMarcarPronto) return;
                      onMarcarPronto(pedido, sel, expIdByItem);
                    }}
                    disabled={!canMarcarPronto}
                    className={cn(
                      "w-full h-9 rounded-xl text-[12px] font-semibold transition-colors flex items-center justify-center gap-1.5 disabled:pointer-events-none",
                      canMarcarPronto
                        ? "bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm shadow-emerald-500/30"
                        : "bg-destructive/10 text-destructive opacity-80 cursor-not-allowed"
                    )}
                  >
                    {canMarcarPronto
                      ? <CheckCircle2 className="h-3.5 w-3.5" />
                      : <AlertTriangle className="h-3.5 w-3.5" />
                    }
                    {!canMarcarPronto
                      ? pedido.itens.length > 1
                        ? `Confirme todas as peças (${totalConfirmed}/${totalPecasTipos})`
                        : "Selecione os lotes antes de confirmar"
                      : "Marcar como Pronto"
                    }
                  </button>
                </div>
              );
            })()}

            {pedido.status === "pronto" && (
              <div className="flex-1 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-600 text-[12px] font-semibold flex items-center justify-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                Aguardando Nota Fiscal
              </div>
            )}

            {pedido.status === "enviado" && (
              <div className="flex-1 h-9 rounded-xl bg-sky-500/15 border border-sky-500/40 text-sky-600 text-[12px] font-semibold flex items-center justify-center gap-1.5">
                <Truck className="h-3.5 w-3.5 text-sky-500" />
                NF emitida — Pedido enviado
              </div>
            )}

            {/* Botão Retornar — disponível para separando e pronto */}
            {isSeparando && (
              <button type="button" onClick={() => onRetornar(pedido)}
                className="h-9 w-9 rounded-xl bg-orange-500/20 hover:bg-orange-500/30 text-orange-600 border border-orange-500/30 flex items-center justify-center transition-colors shrink-0"
                title="Retornar pedido ao comercial">
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}

            {/* Botão Editar Endereço */}
            {(isPendente || isSeparando) && (
              <button type="button" onClick={() => onEditarEndereco(pedido)}
                className="h-9 w-9 rounded-xl bg-muted/30 hover:bg-muted/60 text-muted-foreground flex items-center justify-center transition-colors shrink-0"
                title="Editar endereço de entrega">
                <MapPin className="h-3.5 w-3.5" />
              </button>
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
