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
import { useConfirmEnter } from "@/hooks/useConfirmEnter";
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
  RotateCcw,
  Pencil,
  Trash2,
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
import { detectarUF, adaptarCFOP as adaptarCFOPShared } from "@/lib/cfop";
import { SearchInputWithBarcode } from "@/components/SearchInputWithBarcode";
import type { LoteDisponivel, PedidoItem, LoteSeparado, Pedido, LoteSelecao } from "@/components/stock/pedidosEstoqueTypes";
import { PedidoCard } from "@/components/stock/PedidoCard";
import { EditarItemModal } from "@/components/stock/EditarItemModal";
import { RetornarPedidoModal } from "@/components/stock/RetornarPedidoModal";
import { RemoverItemModal } from "@/components/stock/RemoverItemModal";
import { EditarEnderecoModal } from "@/components/stock/EditarEnderecoModal";

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
  const [retornarPedido, setRetornarPedido] = useState<Pedido | null>(null);
  const [removerItem, setRemoverItem] = useState<{ pedido: Pedido; item: PedidoItem } | null>(null);
  const [editarEndereco, setEditarEndereco] = useState<Pedido | null>(null);

  async function handleIniciarSeparacao(
    pedido: Pedido,
    lotesSelecionados: LoteSelecao,
    expIdByItem: Record<string, string>   // item.id → expedicao stock_item_id
  ) {
    if (!user) return;
    // merge entradas com mesmo (expId, lote) — evita dobrar quantidades
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
        .in("status", ["pendente", "separando", "pronto", "retorno", "enviado", "faturado"])
        .order("created_at", { ascending: false })
        .abortSignal(ctrl.signal);

      if (ctrl.signal.aborted) return;
      if (error || !data) { return; }

      const mapped: Pedido[] = data.map((p: Record<string, unknown>) => ({
        id: p.id as string,
        cliente_id: p.cliente_id as string,
        cliente_nome: (p.clientes as { nome: string; municipio?: string; uf?: string; telefone?: string; endereco?: string }).nome,
        cliente_municipio: (p.clientes as { municipio?: string | null }).municipio ?? null,
        cliente_uf: (p.clientes as { uf?: string | null }).uf ?? null,
        cliente_telefone: (p.clientes as { telefone?: string | null }).telefone ?? null,
        endereco_entrega: (p.usar_endereco_cliente !== false
          ? null  // usa endereço do cliente (município/UF já mapeados)
          : (p.endereco_entrega as string | null)) ?? null,
        vendedora_nome: p.vendedora_nome as string | null,
        vendedora_id: p.vendedora_id as string | null,
        status: p.status as string,
        frete: (p.frete as number) ?? 0,
        observacoes: p.observacoes as string | null,
        created_at: p.created_at as string,
        desconto_pct: (p.desconto_pct as number) ?? 0,
        prazo_entrega: (p.prazo_entrega as string | null) ?? null,
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

  // IDs de pedidos com card expandido — Realtime não recarrega enquanto card aberto
  const expandedPedidosRef = useRef<Set<string>>(new Set());

  // Realtime: recarrega lista de pedidos quando pedidos_comerciais muda.
  // Bloqueia reload APENAS quando o pedido está expandido E só mudou lotes_separados
  // (confirmação de lote em andamento). Mudanças de status (pronto, retorno, etc.)
  // sempre recarregam — em todas as contas, independente do card estar aberto.
  useEffect(() => {
    const channel = supabase
      .channel(`pedidos-estoque-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pedidos_comerciais" },
        (payload) => {
          const changedId = (payload.new as { id?: string })?.id ?? (payload.old as { id?: string })?.id;
          const oldStatus = (payload.old as { status?: string })?.status;
          const newStatus = (payload.new as { status?: string })?.status;
          const statusChanged = oldStatus && newStatus && oldStatus !== newStatus;

          // Se mudou o status (pronto, retorno, cancelado…), recarrega SEMPRE
          // para que todas as contas vejam a mudança imediatamente
          if (statusChanged) { loadPedidos(); return; }

          // Só bloqueia o reload se o card está expandido E só mudou lotes_separados
          // (confirmação individual de lote em progresso na mesma conta)
          if (changedId && expandedPedidosRef.current.has(changedId)) return;

          loadPedidos();
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadPedidos]);


  const filtrados = pedidos.filter(p => {
    const matchStatus = ["separando", "pronto", "faturado", "enviado", "retorno"].includes(p.status);
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
    // merge entradas com mesmo (expId, lote)
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
      // (mesma lógica do handleSalvarSeparacao — merge por expId+lote)
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
  async function handleImprimirTodos() {
    const now = new Date();
    const nowStr = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const mesAtual = now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const LOTE_PH = new Set(["a-definir", "a definir", "sem lote", ""]);

    function escH(s?: string | null) {
      return (s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    }
    function fmtBRL(v: number) {
      return "R$ " + v.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    }

    // Filtra pedidos do mês atual
    const pedidosDoMes = filtrados.filter(p => {
      const d = new Date(p.created_at);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    const pedidosParaImprimir = pedidosDoMes.length > 0 ? pedidosDoMes : filtrados;

    // ── Busca dados extras em batch ────────────────────────────────────────────
    const ids = pedidosParaImprimir.map(p => p.id);
    const clienteIds = [...new Set(pedidosParaImprimir.map(p => p.cliente_id))];
    const stockIds = [...new Set(pedidosParaImprimir.flatMap(p => p.itens.map(i => i.stock_item_id)))];

    const [exRes, clRes, devRes, itensPrecoRes] = await Promise.all([
      supabase.from("pedidos_comerciais")
        .select("id, forma_pagamento, parcelas, endereco_entrega, usar_endereco_cliente, desconto_pct, frete")
        .in("id", ids),
      supabase.from("clientes")
        .select("id, documento, email, telefone, logradouro, numero, bairro, municipio, uf, cep, endereco")
        .in("id", clienteIds),
      supabase.from("stock_items")
        .select("id, devices(id, model, reference, ncm, cfop_padrao, ipi_pct, preco_venda)")
        .in("id", stockIds),
      supabase.from("pedido_itens")
        .select("pedido_id, stock_item_id, quantidade, preco_unitario")
        .in("pedido_id", ids),
    ]);

    type ExtraRow = { id: string; forma_pagamento?: string | null; parcelas?: number | null; endereco_entrega?: string | null; usar_endereco_cliente?: boolean | null; desconto_pct?: number; frete?: number };
    type ClienteRow = { id: string; documento?: string | null; email?: string | null; telefone?: string | null; logradouro?: string | null; numero?: string | null; bairro?: string | null; municipio?: string | null; uf?: string | null; cep?: string | null; endereco?: string | null };
    type DevRow = { id: string; devices?: { model?: string; reference?: string; preco_venda?: number } };
    type ItemPrecoRow = { pedido_id: string; stock_item_id: string; quantidade: number; preco_unitario?: number };

    const extraMap = new Map<string, ExtraRow>((exRes.data ?? []).map((r: ExtraRow) => [r.id, r]));
    const clienteMap = new Map<string, ClienteRow>((clRes.data ?? []).map((r: ClienteRow) => [r.id, r]));
    const devMap = new Map<string, DevRow>((devRes.data ?? []).map((r: DevRow) => [r.id, r]));
    const itemPrecoMap = new Map<string, ItemPrecoRow[]>();
    for (const ip of (itensPrecoRes.data ?? []) as ItemPrecoRow[]) {
      if (!itemPrecoMap.has(ip.pedido_id)) itemPrecoMap.set(ip.pedido_id, []);
      itemPrecoMap.get(ip.pedido_id)!.push(ip);
    }

    const fmtPgto: Record<string, string> = {
      dinheiro: "Dinheiro", pix: "PIX", boleto: "Boleto",
      cartao_debito: "Cartão Débito", cartao_credito: "Cartão Crédito",
    };

    let sections = "";
    let totalGeralPecas = 0;
    let totalGeralValor = 0;

    for (const pedido of pedidosParaImprimir) {
      const ex = extraMap.get(pedido.id);
      const cl = clienteMap.get(pedido.cliente_id);
      const itensPreco = itemPrecoMap.get(pedido.id) ?? [];
      const desconto = ex?.desconto_pct ?? pedido.desconto_pct ?? 0;
      const frete = ex?.frete ?? 0;

      // Endereço de entrega
      const endCl = cl?.logradouro
        ? `${cl.logradouro}${cl.numero ? ", " + cl.numero : ""}${cl.bairro ? " — " + cl.bairro : ""}${cl.municipio ? " — " + cl.municipio : ""}${cl.uf ? "/" + cl.uf : ""}${cl.cep ? " — CEP " + cl.cep : ""}`
        : (cl?.endereco ?? "");
      const enderecoEntrega = ex?.usar_endereco_cliente === false && ex?.endereco_entrega
        ? ex.endereco_entrega : endCl;

      // Pagamento
      const pgtoLabel = ex?.forma_pagamento ? fmtPgto[ex.forma_pagamento] ?? ex.forma_pagamento : "—";
      const parcelasLabel = ["cartao_credito", "boleto"].includes(ex?.forma_pagamento ?? "") && (ex?.parcelas ?? 1) > 1
        ? ` ${ex?.parcelas}x` : "";

      const printRows: { model?: string; reference?: string; lote: string; quantidade: number; precoUnit: number }[] = [];

      if (pedido.lotes_separados && pedido.lotes_separados.length > 0) {
        const rowMap = new Map<string, { model?: string; reference?: string; lote: string; quantidade: number; precoUnit: number }>();
        for (const ls of pedido.lotes_separados) {
          const item = pedido.itens.find(i => i.stock_item_id === ls.stock_item_id)
            ?? pedido.itens.find(i => i.device_model === ls.device_model);
          const ip = itensPreco.find(i => i.stock_item_id === ls.stock_item_id);
          const dev = devMap.get(ls.stock_item_id ?? "");
          const precoUnit = (ip?.preco_unitario ?? 0) > 0
            ? (ip!.preco_unitario! * (1 - desconto / 100))
            : ((dev?.devices?.preco_venda ?? 0) * (1 - desconto / 100));
          const key = `${ls.device_model}||${ls.lote}`;
          const ex2 = rowMap.get(key);
          if (ex2) ex2.quantidade += ls.quantidade;
          else rowMap.set(key, { model: ls.device_model ?? item?.device_model, reference: item?.device_reference, lote: ls.lote, quantidade: ls.quantidade, precoUnit });
        }
        for (const row of rowMap.values()) printRows.push(row);
      } else {
        for (const item of pedido.itens) {
          const ip = itensPreco.find(i => i.stock_item_id === item.stock_item_id);
          const dev = devMap.get(item.stock_item_id ?? "");
          const precoUnit = (ip?.preco_unitario ?? 0) > 0
            ? (ip!.preco_unitario! * (1 - desconto / 100))
            : ((dev?.devices?.preco_venda ?? 0) * (1 - desconto / 100));
          const lote = item.lote && !LOTE_PH.has(item.lote.trim().toLowerCase()) ? item.lote : "";
          printRows.push({ model: item.device_model, reference: item.device_reference, lote, quantidade: item.quantidade, precoUnit });
        }
      }

      const grouped = new Map<string, typeof printRows>();
      for (const row of printRows) {
        const key = `${row.model}|||${row.reference}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(row);
      }

      const statusLabel = pedido.status === "pronto" ? "Pronto" : pedido.status === "separando" ? "Separando" : pedido.status === "enviado" ? "Enviado" : "Pendente";
      const statusColor = pedido.status === "pronto" ? "#166534" : pedido.status === "separando" ? "#1e40af" : pedido.status === "enviado" ? "#0369a1" : "#92400e";
      const statusBg = pedido.status === "pronto" ? "#dcfce7" : pedido.status === "separando" ? "#dbeafe" : pedido.status === "enviado" ? "#e0f2fe" : "#fef3c7";
      const dataPedido = new Date(pedido.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

      let subtotal = 0;
      let tableRows = "";
      let idx = 0;
      for (const [, rows] of grouped) {
        idx++;
        const first = rows[0];
        const tipoTotal = rows.reduce((s, r) => s + r.quantidade, 0);
        const itemSubtotal = first.precoUnit * tipoTotal;
        subtotal += itemSubtotal;
        const lotesBadges = rows
          .filter(r => r.lote && !LOTE_PH.has(r.lote.toLowerCase()))
          .map(r => `<span class="lote-badge">${escH(r.lote)}</span>`)
          .join(" ");
        const lotesCell = lotesBadges || `<span class="lote-empty">—</span>`;
        const precoCell = first.precoUnit > 0
          ? `<span class="preco-unit">${fmtBRL(first.precoUnit)}</span>`
          : `<span class="lote-empty">—</span>`;
        const totalCell = itemSubtotal > 0 ? fmtBRL(itemSubtotal) : "—";
        tableRows += `<tr>
          <td class="col-num">${idx}</td>
          <td class="col-model">
            <span class="model-name">${escH(first.model)}</span>
            <span class="model-ref">${escH(first.reference)}</span>
          </td>
          <td class="col-lotes">${lotesCell}</td>
          <td class="col-preco">${precoCell}</td>
          <td class="col-qty-n">${tipoTotal}</td>
          <td class="col-total">${totalCell}</td>
        </tr>`;
      }

      const totalComFrete = subtotal + frete;
      totalGeralValor += totalComFrete;
      const totalPecas = printRows.reduce((s, r) => s + r.quantidade, 0);
      totalGeralPecas += totalPecas;
      const totalTipos = grouped.size;

      const totaisHtml = `
        <div class="totais-bloco">
          ${desconto > 0 ? `<div class="totais-row"><span class="totais-lbl">Desconto aplicado</span><span class="totais-val desc">${desconto}% por peça</span></div>` : ""}
          ${frete > 0 ? `<div class="totais-row"><span class="totais-lbl">Subtotal</span><span class="totais-val">${fmtBRL(subtotal)}</span></div>
          <div class="totais-row"><span class="totais-lbl">Frete</span><span class="totais-val">${fmtBRL(frete)}</span></div>` : ""}
          <div class="totais-row total-final"><span class="totais-lbl">TOTAL DO PEDIDO</span><span class="totais-val">${fmtBRL(totalComFrete)}</span></div>
        </div>`;

      sections += `
        <div class="pedido-section">
          <div class="pedido-header">
            <div class="pedido-header-left">
              <div class="pedido-client">${escH(pedido.cliente_nome)}</div>
              <div class="pedido-meta">
                ${cl?.documento ? `<span>CPF/CNPJ: <strong>${escH(cl.documento)}</strong></span> &nbsp;·&nbsp;` : ""}
                ${cl?.telefone ? `<span>Tel: <strong>${escH(cl.telefone)}</strong></span> &nbsp;·&nbsp;` : ""}
                ${cl?.email ? `<span>Email: <strong>${escH(cl.email)}</strong></span>` : ""}
              </div>
              ${enderecoEntrega ? `<div class="pedido-meta" style="margin-top:2px">📍 ${escH(enderecoEntrega)}</div>` : ""}
              <div class="pedido-meta" style="margin-top:2px">
                Vendedora: <strong>${escH(pedido.vendedora_nome ?? "—")}</strong>
                &nbsp;·&nbsp; Data: <strong>${dataPedido}</strong>
                &nbsp;·&nbsp; ${escH(pgtoLabel)}${parcelasLabel ? " · " + parcelasLabel : ""}
                ${pedido.observacoes ? `&nbsp;·&nbsp; Obs: ${escH(pedido.observacoes)}` : ""}
              </div>
            </div>
            <span class="status-badge" style="background:${statusBg};color:${statusColor};border-color:${statusColor}40">${statusLabel}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th class="col-num">#</th>
                <th class="col-model">Peça</th>
                <th class="col-lotes">Lotes</th>
                <th class="col-preco" style="text-align:right">Unit. c/ desc.</th>
                <th class="col-qty-n" style="text-align:right">Qtd.</th>
                <th class="col-total" style="text-align:right">Total</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
          ${totaisHtml}
          <div class="pedido-footer">
            ${totalPecas} peça${totalPecas !== 1 ? "s" : ""} · ${totalTipos} tipo${totalTipos !== 1 ? "s" : ""}
          </div>
        </div>`;
    }

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Pedidos — ${mesAtual}</title>
  <style>
    @page { size: A4 portrait; margin: 14mm 14mm 14mm 14mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; background: #fff; color: #111; font-size: 12px; }

    /* ── Cabeçalho da empresa (igual ao pedido individual) ── */
    .company-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6mm; padding-bottom: 4mm; border-bottom: 3px solid #111; }
    .company-name { font-size: 17px; font-weight: 900; letter-spacing: -0.02em; text-transform: uppercase; color: #111; }
    .company-sub { font-size: 9px; color: #555; margin-top: 2px; }
    .company-contact { text-align: right; font-size: 9px; color: #444; line-height: 1.6; }
    .company-contact strong { display: block; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #111; margin-bottom: 1px; }

    /* ── Info bar do relatório ── */
    .report-bar { background: #f5f5f5; border: 1px solid #ddd; border-radius: 6px; padding: 6px 10px; margin-bottom: 5mm; display: flex; gap: 18px; align-items: center; }
    .report-bar-item { font-size: 9px; color: #666; }
    .report-bar-item strong { font-size: 12px; font-weight: 800; color: #111; display: block; }

    /* ── Seção de cada pedido ── */
    .pedido-section { margin-bottom: 6mm; border: 1px solid #ccc; border-radius: 4px; overflow: hidden; page-break-inside: avoid; }

    /* cabeçalho do pedido — idêntico ao individual */
    .pedido-header { background: #f9f9f9; border-bottom: 1.5px solid #ddd; padding: 5px 10px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .pedido-header-left { display: flex; flex-direction: column; gap: 1px; }
    .pedido-client { font-size: 14px; font-weight: 800; color: #111; }
    .pedido-meta { font-size: 9px; color: #777; }
    .pedido-meta strong { color: #333; }
    .status-badge { font-size: 9px; font-weight: 700; padding: 2px 8px; border-radius: 20px; white-space: nowrap; border: 1px solid; }

    /* ── Tabela de itens ── */
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 4px 8px; font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #555; background: #fafafa; border-bottom: 1px solid #e0e0e0; }
    th.col-qty { text-align: right; }
    td { padding: 5px 8px; border-bottom: 1px solid #efefef; vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    .col-num { width: 20px; color: #bbb; font-size: 10px; }
    .col-model { width: 30%; }
    .col-lotes { width: 22%; }
    .col-preco { width: 80px; text-align: right; }
    .col-qty-n { width: 40px; text-align: right; font-weight: 800; font-size: 12px; color: #111; }
    .col-total { width: 80px; text-align: right; font-weight: 700; font-size: 11px; color: #111; }
    .model-name { display: block; font-weight: 700; font-size: 11px; }
    .model-ref { display: block; font-family: monospace; font-size: 9px; color: #888; margin-top: 1px; }
    .preco-unit { font-size: 10px; color: #444; }
    .lote-badge { display: inline-block; background: #f0f0ff; color: #4c1d95; font-family: monospace; font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 3px; border: 1px solid #d4d0ee; margin: 1px 2px 1px 0; }
    .lote-empty { color: #ccc; font-size: 10px; }
    .totais-bloco { padding: 5px 10px; background: #f9f9f9; border-top: 1px solid #e0e0e0; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
    .totais-row { display: flex; gap: 16px; align-items: baseline; }
    .totais-lbl { font-size: 9px; color: #888; text-transform: uppercase; letter-spacing: 0.04em; }
    .totais-val { font-size: 11px; font-weight: 700; color: #111; min-width: 80px; text-align: right; }
    .totais-val.desc { color: #16a34a; }
    .total-final .totais-lbl { font-weight: 700; color: #333; font-size: 10px; }
    .total-final .totais-val { font-size: 13px; font-weight: 900; color: #111; }
    .pedido-footer { padding: 4px 10px; background: #fafafa; border-top: 1px solid #eee; font-size: 9px; color: #999; }

    /* ── Rodapé geral ── */
    .page-footer { margin-top: 6mm; padding-top: 3mm; border-top: 1.5px solid #ddd; display: flex; justify-content: space-between; font-size: 10px; color: #555; }

    @media print { button { display: none } }
  </style>
</head>
<body>

  <!-- Cabeçalho empresa -->
  <div class="company-header">
    <div>
      <div class="company-name">Zomini Usinagens Especiais Ltda. ME</div>
      <div class="company-sub">CNPJ: 00.000.000/0000-00 &nbsp;|&nbsp; IE: 000.000.000.000</div>
      <div class="company-sub">Av. Fictícia, 1000 — Jardim Exemplo — Indaiatuba/SP — CEP 13.000-000</div>
    </div>
    <div class="company-contact">
      <strong>Contato:</strong>
      contato@zomini.com.br<br>
      www.zomini.com.br<br>
      (19) 00000-0000
    </div>
  </div>

  <!-- Barra de resumo do relatório -->
  <div class="report-bar">
    <div class="report-bar-item"><strong>${pedidosParaImprimir.length}</strong>pedido${pedidosParaImprimir.length !== 1 ? "s" : ""}</div>
    <div class="report-bar-item"><strong>${totalGeralPecas}</strong>peças no total</div>
    <div class="report-bar-item"><strong>${mesAtual}</strong>período</div>
    <div class="report-bar-item" style="margin-left:auto">Gerado em: ${nowStr}</div>
  </div>

  ${sections}

  <div class="page-footer">
    <span>Total: <strong>${totalGeralPecas} peças</strong> em <strong>${pedidosParaImprimir.length} pedido${pedidosParaImprimir.length !== 1 ? "s" : ""}</strong> &nbsp;·&nbsp; Valor total: <strong>${fmtBRL(totalGeralValor)}</strong></span>
    <span>Zomini Usinagens Especiais Ltda. ME</span>
  </div>

  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`;

    const w = window.open("", "_blank");
    if (!w) return;
    w.document.open(); w.document.write(html); w.document.close();
  }

  useConfirmEnter(!!cancelarPedido, handleCancelar, cancelando);

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
              onExpandChange={(id, exp) => {
                if (exp) expandedPedidosRef.current.add(id);
                else expandedPedidosRef.current.delete(id);
              }}
              onIniciarSeparacao={handleIniciarSeparacao}
              onSalvarSeparacao={handleSalvarSeparacao}
              onMarcarPronto={handleMarcarPronto}
              onCancelar={setCancelarPedido}
              onEditarItem={(pedido, item) => setEditarItem({ pedido, item })}
              onRetornar={setRetornarPedido}
              onRemoverItem={(pedido, item) => setRemoverItem({ pedido, item })}
              onEditarEndereco={setEditarEndereco}
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

      {/* Retornar pedido */}
      <RetornarPedidoModal
        pedido={retornarPedido}
        onClose={() => setRetornarPedido(null)}
        onSuccess={loadPedidos}
      />

      {/* Remover item */}
      <RemoverItemModal
        pedido={removerItem?.pedido ?? null}
        item={removerItem?.item ?? null}
        onClose={() => setRemoverItem(null)}
        onSuccess={loadPedidos}
      />

      {/* Editar endereço */}
      <EditarEnderecoModal
        pedido={editarEndereco}
        onClose={() => setEditarEndereco(null)}
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
