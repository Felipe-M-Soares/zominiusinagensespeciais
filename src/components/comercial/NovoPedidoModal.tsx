import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useStock } from "@/hooks/useStock";
import { useClickOutside } from "@/hooks/useClickOutside";
import { useDebounce } from "@/hooks/useDebounce";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  User, Search, X, Plus, ShoppingCart, Package, Receipt, Truck, Star, AlertCircle, ChevronDown,
} from "lucide-react";
import { criarPedidoComReserva } from "@/lib/pedidoUtils";
import { ClienteModal } from "@/components/comercial/ClienteModal";
import type { Cliente, PedidoItem, PedidoCompleto } from "@/types/comercial";

interface NovoPedidoModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  clienteFixo?: Cliente | null;
  expedicaoItems: ReturnType<typeof useStock>["items"];
  duplicarDe?: PedidoCompleto | null;
  editarPedido?: PedidoCompleto | null; // modo edição (pedido em retorno)
}

export function NovoPedidoModal({ open, onClose, onSuccess, clienteFixo, expedicaoItems, duplicarDe, editarPedido }: NovoPedidoModalProps) {
  const { user } = useAuth();

  // Cliente
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [clienteId, setClienteId] = useState(clienteFixo?.id ?? "");
  const [saldoCliente, setSaldoCliente] = useState(0);
  const [usarCredito, setUsarCredito] = useState(false);
  const [valorCreditoAplicado, setValorCreditoAplicado] = useState("");

  // Crédito em aberto do cliente por devoluções aprovadas — pra vendedora
  // saber, na hora de montar o pedido, que o cliente já tem saldo a favor.
  useEffect(() => {
    if (!clienteId) { setSaldoCliente(0); return; }
    let cancelled = false;
    supabase
      .from("contas_financeiras")
      .select("valor, pedidos_comerciais!inner(cliente_id)")
      .eq("categoria", "credito_devolucao_cliente")
      .eq("status", "aberto")
      .eq("pedidos_comerciais.cliente_id", clienteId)
      .then(({ data }) => {
        if (cancelled) return;
        const total = (data ?? []).reduce((s, r) => s + (Number(r.valor) || 0), 0);
        setSaldoCliente(total);
      });
    return () => { cancelled = true; };
  }, [clienteId]);
  const [clienteSearch, setClienteSearch] = useState(clienteFixo?.nome ?? "");
  const [showClienteDrop, setShowClienteDrop] = useState(false);
  const [novoClienteModal, setNovoClienteModal] = useState(false);

  // Busca de peça — por nome, sem lotes
  const [pecaSearch, setPecaSearch] = useState("");
  const [autocomplete, setAutocomplete] = useState<ReturnType<typeof useStock>["items"]>([]);
  const [showAutocomp, setShowAutocomp] = useState(false);
  const [selectedPeca, setSelectedPeca] = useState<ReturnType<typeof useStock>["items"][0] | null>(null);

  // Lista do pedido e obs
  const [qtd, setQtd] = useState(1);
  const [descontoItemAtual, setDescontoItemAtual] = useState(0); // desconto da peça que está sendo adicionada agora
  const [itens, setItens] = useState<PedidoItem[]>([]);
  const [obs, setObs] = useState("");
  const [prazoEntrega, setPrazoEntrega] = useState("");
  const [favoritas, setFavoritas] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [formaPagamento, setFormaPagamento] = useState("");
  const [parcelas, setParcelas] = useState(1);
  const [enderecoEntrega, setEnderecoEntrega] = useState("");
  const [frete, setFrete] = useState(0);
  const [usarEnderecoCliente, setUsarEnderecoCliente] = useState(true);
  const [precoMap, setPrecoMap] = useState<Record<string, number>>({});
  const [resumoOpen, setResumoOpen] = useState(false); // popup com o total do pedido
  const [mostrarOpcoes, setMostrarOpcoes] = useState(false); // pagamento/endereço/frete/obs recolhidos por padrão — deixa o fluxo principal (cliente → peças) mais rápido

  // Carrega favoritas do usuário atual
  useEffect(() => {
    supabase.from("peca_favoritas").select("device_id")
      .then(({ data, error }) => {
        if (error) return;
        setFavoritas(new Set((data ?? []).map((r: { device_id: string }) => r.device_id)));
      });
  }, [open]);

  async function toggleFavorita(deviceId: string) {
    if (!user?.id) return;
    const isFav = favoritas.has(deviceId);
    if (isFav) {
      await supabase.from("peca_favoritas").delete().eq("device_id", deviceId).eq("user_id", user.id);
      setFavoritas(prev => { const n = new Set(prev); n.delete(deviceId); return n; });
    } else {
      await supabase.from("peca_favoritas").insert({ device_id: deviceId, user_id: user.id });
      setFavoritas(prev => new Set([...prev, deviceId]));
    }
  }

  const clienteDropRef = useRef<HTMLDivElement>(null);
  const pecaDropRef = useRef<HTMLDivElement>(null);
  const pecaInputRef = useRef<HTMLInputElement>(null);

  // FIX: useClickOutside substitui o padrão document.addEventListener duplicado
  useClickOutside(clienteDropRef, () => setShowClienteDrop(false));
  useClickOutside(pecaDropRef,    () => setShowAutocomp(false));

  // Reset ao abrir
  useEffect(() => {
    if (!open) return;
    setClienteId(clienteFixo?.id ?? "");
    setClienteSearch(clienteFixo?.nome ?? "");
    if (editarPedido) {
      setClienteId(editarPedido.cliente_id);
      setClienteSearch(editarPedido.cliente_nome);
      setObs(editarPedido.observacoes?.replace(/^\[RETORNO\]\s*/, "") ?? "");
      setItens(editarPedido.itens.map(i => ({
        stock_item_id: i.stock_item_id,
        device_id: i.device_id,
        lote: i.lote ?? null,
        quantidade: i.quantidade,
        device_model: i.device_model ?? "",
        device_reference: i.device_reference ?? "",
        preco_unitario: i.valor_unitario ?? 0, // recalculado em efeito separado quando precoMap carregar
        desconto_pct: 0,
      })));
      // Carrega forma pagamento e endereço do pedido existente
      supabase.from("pedidos_comerciais")
        .select("forma_pagamento, parcelas, prazo_entrega, endereco_entrega, usar_endereco_cliente")
        .eq("id", editarPedido.id)
        .maybeSingle()
        .then(({ data }) => {
          const d = data as { forma_pagamento?: string; parcelas?: number; prazo_entrega?: string; endereco_entrega?: string; usar_endereco_cliente?: boolean } | null;
          if (!d) return;
          setFormaPagamento(d.forma_pagamento ?? "");
          setParcelas(d.parcelas ?? 1);
          setPrazoEntrega(d.prazo_entrega ?? "");
          setEnderecoEntrega(d.endereco_entrega ?? "");
          setUsarEnderecoCliente(d.usar_endereco_cliente ?? true);
          setFrete((d as { frete?: number }).frete ?? 0);
        });
    } else if (duplicarDe) {
      setClienteId(duplicarDe.cliente_id);
      setClienteSearch(duplicarDe.cliente_nome);
      setObs(duplicarDe.observacoes ?? "");
      setItens(duplicarDe.itens.map(i => ({
        stock_item_id: i.stock_item_id,
        device_id: i.device_id,
        lote: i.lote ?? null,
        quantidade: i.quantidade,
        device_model: i.device_model ?? "",
        device_reference: i.device_reference ?? "",
        preco_unitario: i.valor_unitario ?? 0,
        desconto_pct: 0,
      })));
    } else {
      setItens([]); setObs(""); setPrazoEntrega("");
      setFormaPagamento(""); setParcelas(1); setEnderecoEntrega(""); setUsarEnderecoCliente(true); setFrete(0);
    }
    setPecaSearch(""); setAutocomplete([]); setShowAutocomp(false);
    setSelectedPeca(null); setQtd(1); setDescontoItemAtual(0); setResumoOpen(false);
    setMostrarOpcoes(!!editarPedido); // editando: abre já mostrando pagamento/endereço/frete pra revisão
    loadClientes();
    loadPrecos();
  }, [open, clienteFixo, duplicarDe]);

  // Quando precoMap carrega (após abrir em modo edição/duplicação), recalcula o desconto
  // individual de cada item comparando o preço líquido salvo com o preço de tabela atual.
  useEffect(() => {
    if (!open) return;
    if (!editarPedido && !duplicarDe) return;
    if (Object.keys(precoMap).length === 0) return;
    setItens(prev => prev.map(item => {
      const precoTabela = item.device_id ? (precoMap[item.device_id] ?? 0) : 0;
      const precoLiquidoSalvo = item.preco_unitario ?? 0;
      if (precoTabela <= 0) return { ...item, preco_unitario: precoLiquidoSalvo, desconto_pct: 0 };
      const descontoCalc = precoLiquidoSalvo > 0 && precoLiquidoSalvo < precoTabela
        ? Math.round(((precoTabela - precoLiquidoSalvo) / precoTabela) * 1000) / 10
        : 0;
      return { ...item, preco_unitario: precoTabela, desconto_pct: descontoCalc };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, precoMap]);

  async function loadPrecos() {
    const PAGE = 1000;
    const map: Record<string, number> = {};
    let from = 0;
    let keepGoing = true;
    while (keepGoing) {
      const { data, error } = await supabase
        .from("devices")
        .select("id, preco_venda")
        .range(from, from + PAGE - 1);
      if (error) {
        toast.error("Não foi possível carregar os preços das peças.");
        return;
      }
      (data as { id: string; preco_venda: number | null }[] ?? []).forEach(r => {
        map[r.id] = r.preco_venda ?? 0;
      });
      keepGoing = (data?.length ?? 0) === PAGE;
      from += PAGE;
    }
    setPrecoMap(map);
  }

  async function loadClientes() {
    const { data } = await supabase.from("clientes").select("id, nome, documento, telefone, email, endereco, observacoes, created_at, cep, logradouro, numero, bairro, municipio, uf").order("nome");
    setClientes((data as Cliente[]) ?? []);
  }

  // FIX: useDebounce substitui o padrão debounceRef inline duplicado
  const debouncedPecaSearch = useDebounce((v: string) => {
    const q = v.trim().toLowerCase();
    const sugestoes = expedicaoItems.filter(i =>
      !q ||
      i.device?.model?.toLowerCase().includes(q) ||
      i.device?.reference?.toLowerCase().includes(q) ||
      i.device?.internal_code?.toLowerCase().includes(q)
    );
    const vistos = new Set<string>();
    const deduped = sugestoes.filter(i => {
      if (vistos.has(i.device_id)) return false;
      if (Math.max(0, i.quantity_available - itens.filter(it => it.stock_item_id === i.id).reduce((s, it) => s + it.quantidade, 0)) <= 0) return false;
      vistos.add(i.device_id); return true;
    }).slice(0, 20);
    setAutocomplete(deduped);
    // Mantém o dropdown aberto mesmo sem resultados para mostrar "Nenhuma peça encontrada"
    if (showAutocomp || q) setShowAutocomp(true);
  }, 80);

  // Autocomplete de peça — filtra apenas por NOME (device.model), não mostra lotes
  function handlePecaInput(v: string) {
    setPecaSearch(v);
    setSelectedPeca(null);
    debouncedPecaSearch(v);
  }

  // Disponível real descontando o que já está no carrinho local (itens ainda não salvos)
  function dispRealCarrinho(item: ReturnType<typeof useStock>["items"][0]) {
    return Math.max(0, item.quantity_available - qtdJaNoCarrinho(item.id));
  }

  function buildSugestoes(q: string, items: typeof expedicaoItems) {
    const lista = q
      ? items.filter(i =>
          i.device?.model?.toLowerCase().includes(q) ||
          i.device?.reference?.toLowerCase().includes(q) ||
          i.device?.internal_code?.toLowerCase().includes(q)
        )
      : items;
    const vistos = new Set<string>();
    return lista.filter(i => {
      if (vistos.has(i.device_id)) return false;
      if (dispRealCarrinho(i) <= 0) return false; // oculta peças sem saldo real
      vistos.add(i.device_id); return true;
    }).slice(0, 20);
  }

  function handlePecaFocus() {
    const q = pecaSearch.trim().toLowerCase();
    const deduped = buildSugestoes(q, expedicaoItems);
    setAutocomplete(deduped);
    // Mostra o dropdown mesmo vazio — o JSX exibe "Nenhuma peça" se lista vazia
    setShowAutocomp(true);
  }

  function handleSelectPeca(item: ReturnType<typeof useStock>["items"][0]) {
    setSelectedPeca(item);
    setPecaSearch(item.device?.model ?? "");
    setShowAutocomp(false);
    setQtd(1);
    setDescontoItemAtual(0);
  }

  // Quantidade já no carrinho para essa peça
  function qtdJaNoCarrinho(stockItemId: string) {
    return itens.filter(i => i.stock_item_id === stockItemId).reduce((s, i) => s + i.quantidade, 0);
  }

  // Máximo disponível = qty na expedição - já no carrinho
  const maxDisponivel = selectedPeca ? dispRealCarrinho(selectedPeca) : 0;

  function addItem() {
    if (!selectedPeca) return;
    if (qtd < 1) { toast.error("Quantidade inválida"); return; }
    if (qtd > maxDisponivel) {
      toast.error(`Disponível na expedição: ${maxDisponivel} un.`);
      return;
    }
    const preco = precoMap[selectedPeca.device_id] ?? 0;
    const descontoArred = Math.round(descontoItemAtual * 10) / 10;
    // se a peça já está no pedido COM O MESMO DESCONTO, soma a quantidade em vez de criar linha
    // duplicada. Peças com desconto diferente ficam em linhas separadas, pois cada linha vira
    // um preço líquido diferente em pedido_itens.valor_unitario.
    setItens(prev => {
      const idx = prev.findIndex(i =>
        i.stock_item_id === selectedPeca!.id && (i.desconto_pct ?? 0) === descontoArred
      );
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], quantidade: updated[idx].quantidade + qtd };
        return updated;
      }
      return [...prev, {
        stock_item_id: selectedPeca!.id,
        device_id: selectedPeca!.device_id,
        lote: "",
        quantidade: qtd,
        device_model: selectedPeca!.device?.model ?? "",
        device_reference: selectedPeca!.device?.reference ?? "",
        preco_unitario: preco,
        desconto_pct: descontoArred,
      }];
    });
    setSelectedPeca(null); setPecaSearch(""); setQtd(1); setDescontoItemAtual(0);
    setTimeout(() => pecaInputRef.current?.focus(), 50);
  }

  // Preço líquido de um item (preço de tabela com o desconto daquela peça já aplicado)
  function precoLiquido(item: PedidoItem): number {
    const base = item.preco_unitario ?? 0;
    const desc = item.desconto_pct ?? 0;
    return Math.max(0, base * (1 - desc / 100));
  }

  // Desconto médio ponderado pelo valor — usado apenas para preencher pedidos_comerciais.desconto_pct
  // (mantém o card do pedido e relatórios antigos funcionando, mesmo com desconto por peça)
  function descontoMedioPonderado(): number {
    const totalBruto = itens.reduce((s, i) => s + (i.preco_unitario ?? 0) * i.quantidade, 0);
    if (totalBruto <= 0) return 0;
    const totalDesconto = itens.reduce((s, i) => s + (i.preco_unitario ?? 0) * i.quantidade * ((i.desconto_pct ?? 0) / 100), 0);
    return Math.round((totalDesconto / totalBruto) * 1000) / 10;
  }

  async function handleSave() {
    if (!clienteId) { toast.error("Selecione um cliente"); return; }
    if (itens.length === 0) { toast.error("Adicione ao menos uma peça"); return; }
    if (!user?.id) { toast.error("Sessão expirada. Faça login novamente."); return; }
    setSaving(true);
    try {
      const clienteSelecionado = clientes.find(c => c.id === clienteId);
      const endFinal = usarEnderecoCliente
        ? (clienteSelecionado?.endereco ?? null)
        : (enderecoEntrega.trim() || null);
      const descontoMedio = descontoMedioPonderado();

      // ── Modo edição (pedido em retorno) ──────────────────────────────────
      if (editarPedido) {
        // 1. Cancela todas as reservas antigas via cancel_pedido (libera estoque)
        await supabase.rpc("cancel_pedido", { p_pedido_id: editarPedido.id });

        // 2. Remove itens antigos
        await supabase.from("pedido_itens").delete().eq("pedido_id", editarPedido.id);

        // 3. Insere novos itens — valor_unitario já vem líquido (com o desconto da peça aplicado)
        const novosItens = itens.map(i => ({
          pedido_id: editarPedido.id,
          stock_item_id: i.stock_item_id,
          lote: i.lote || null,
          quantidade: i.quantidade,
          quantidade_reservada: i.quantidade,
          valor_unitario: precoLiquido(i),
        }));
        const { error: insErr } = await supabase.from("pedido_itens").insert(novosItens);
        if (insErr) throw insErr;

        // 4. Reserva o novo estoque
        // FIX: usa reserve_stock(p_item_id, p_qty) — versão que checa estoque
        // disponível de fato e retorna ok:false se insuficiente. A assinatura
        // reserve_stock(p_pedido_id, p_items) é um overload mais antigo que usa
        // LEAST() e NUNCA falha, mesmo sem estoque — silenciosamente truncava
        // a reserva sem avisar o vendedor.
        let estoqueInsuficiente: string | null = null;
        for (const i of itens) {
          const { data: reserved, error: reserveErr } = await supabase.rpc("reserve_stock", {
            p_item_id: i.stock_item_id,
            p_qty: i.quantidade,
          });
          const result = reserved as { ok?: boolean; error?: string } | null;
          if (reserveErr || result?.ok === false) {
            estoqueInsuficiente = result?.error ?? `Estoque insuficiente para ${i.device_model ?? i.stock_item_id}`;
            break;
          }
        }
        if (estoqueInsuficiente) {
          toast.error(estoqueInsuficiente);
          return;
        }

        // 5. Atualiza cabeçalho do pedido e volta para pendente
        const { error: updErr } = await supabase.from("pedidos_comerciais").update({
          cliente_id: clienteId,
          status: "pendente",
          desconto_pct: descontoMedio,
          frete: frete > 0 ? frete : 0,
          observacoes: obs || null,
          prazo_entrega: prazoEntrega || null,
          forma_pagamento: formaPagamento || null,
          parcelas: ["cartao_credito", "boleto"].includes(formaPagamento) ? parcelas : 1,
          endereco_entrega: endFinal,
          usar_endereco_cliente: usarEnderecoCliente,
        }).eq("id", editarPedido.id);
        if (updErr) throw updErr;

        toast.success("Pedido atualizado e reenviado ao estoque!");
        onSuccess();
        return;
      }

      // ── Modo criação normal ───────────────────────────────────────────────
      const { data: profile } = await supabase.from("profiles").select("display_name").eq("user_id", user.id).maybeSingle();
      const vendedoraNome = (profile as { display_name?: string } | null)?.display_name ?? user.email ?? "Vendedora";

      // Crédito de devolução aplicado (se a vendedora marcou a opção): reduz
      // proporcionalmente o valor líquido de cada item, e o total efetivo
      // (pra pedidos_comerciais.desconto_pct, usado em relatórios).
      const subtotalLiquidoAtual = itens.reduce((s, i) => s + precoLiquido(i) * i.quantidade, 0);
      const subtotalBrutoAtual = itens.reduce((s, i) => s + (i.preco_unitario ?? 0) * i.quantidade, 0);
      const creditoValor = usarCredito
        ? Math.max(0, Math.min(parseFloat(valorCreditoAplicado.replace(",", ".")) || 0, saldoCliente, subtotalLiquidoAtual))
        : 0;
      const fatorCredito = creditoValor > 0 && subtotalLiquidoAtual > 0 ? Math.max(0, 1 - creditoValor / subtotalLiquidoAtual) : 1;
      const descontoComCredito = subtotalBrutoAtual > 0
        ? Math.round((1 - (subtotalLiquidoAtual * fatorCredito) / subtotalBrutoAtual) * 1000) / 10
        : descontoMedio;

      const result = await criarPedidoComReserva({
        clienteId,
        itens: itens.map(i => ({
          stock_item_id: i.stock_item_id,
          lote: i.lote || null,
          quantidade: i.quantidade,
          device_model: i.device_model,
          valorUnitarioLiquido: precoLiquido(i) * fatorCredito,
        })),
        vendedoraId: user.id,
        vendedoraNome,
        observacoes: creditoValor > 0
          ? `${obs ? obs + " — " : ""}Crédito de devolução aplicado: ${creditoValor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`
          : (obs || null),
        descontoPct: creditoValor > 0 ? descontoComCredito : descontoMedio,
        frete: frete > 0 ? frete : 0,
        prazoEntrega: prazoEntrega || null,
        formaPagamento: formaPagamento || null,
        parcelas: ["cartao_credito", "boleto"].includes(formaPagamento) ? parcelas : 1,
        enderecoEntrega: endFinal,
        usarEnderecoCliente,
      });

      if (!result.ok) {
        toast.error(result.error ?? "Erro ao criar pedido.");
        return;
      }

      if (creditoValor > 0) {
        const { data: consumo } = await (supabase.rpc as any)("consumir_credito_cliente", {
          p_cliente_id: clienteId, p_valor: creditoValor, p_pedido_id: result.pedidoId ?? null,
        });
        const r = consumo as { ok?: boolean; error?: string } | null;
        if (!r?.ok) {
          toast.error(`Pedido criado, mas houve um problema ao consumir o crédito: ${r?.error ?? "erro desconhecido"} — avise o financeiro.`);
        }
      }

      toast.success(creditoValor > 0
        ? `Pedido criado com ${creditoValor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} de crédito aplicado!`
        : "Pedido criado! O estoque irá separar os lotes.");
      onSuccess();
    } catch (_e) {
      toast.error("Erro ao salvar pedido.");
    } finally {
      setSaving(false);
    }
  }

  const clientesFiltrados = clientes.filter(c => {
    const q = clienteSearch.trim().toLowerCase();
    return !q || c.nome.toLowerCase().includes(q) || (c.documento ?? "").toLowerCase().includes(q);
  });

  // Totais do pedido — usados no botão fixo e no popup de resumo
  const subtotalBruto = itens.reduce((s, i) => s + (i.preco_unitario ?? 0) * i.quantidade, 0);
  const subtotalLiquido = itens.reduce((s, i) => s + precoLiquido(i) * i.quantidade, 0);
  const totalDescontoValor = Math.max(0, subtotalBruto - subtotalLiquido);
  const totalGeral = subtotalLiquido + (frete > 0 ? frete : 0);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-t-2xl sm:rounded-2xl bg-card border border-border/30 shadow-xl overflow-hidden flex flex-col max-h-[95vh] sm:max-h-[92vh] animate-in fade-in slide-in-from-bottom-4 duration-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/30 shrink-0 bg-gradient-to-r from-violet-500/5 to-transparent">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-violet-500/10 flex items-center justify-center">
              <ShoppingCart className="h-4 w-4 text-violet-500" />
            </div>
            <div>
              <p className="text-[13px] font-bold">{editarPedido ? "Editar Pedido" : "Novo Pedido"}</p>
              <p className="text-[10px] text-muted-foreground">{editarPedido ? "Altere peças, desconto, pagamento ou endereço" : "Escolha o cliente e vá adicionando as peças"}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">

          {/* ── Cliente ── */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Cliente *</label>
            <div className="relative" ref={clienteDropRef}>
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={clienteSearch}
                onChange={e => { setClienteSearch(e.target.value); setClienteId(""); setShowClienteDrop(true); }}
                onFocus={() => setShowClienteDrop(true)}
                placeholder="Buscar cliente..."
                className="w-full h-10 pl-9 pr-4 rounded-xl border border-border/50 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50"
              />
              {showClienteDrop && (clientesFiltrados.length > 0 || clientes.length > 0) && (
                <div className="absolute top-full mt-1 left-0 right-0 z-50 rounded-xl border border-border bg-card shadow-xl overflow-hidden max-h-40 overflow-y-auto">
                  {(clienteSearch.trim() ? clientesFiltrados : clientes).slice(0, 10).map(c => (
                    <button key={c.id} type="button" onClick={() => { setClienteId(c.id); setClienteSearch(c.nome); setShowClienteDrop(false); }} className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted/40 transition-colors border-b border-border/20 last:border-0">
                      <p className="font-medium text-[13px]">{c.nome}</p>
                      {c.documento && <p className="text-[11px] text-muted-foreground">{c.documento}</p>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" onClick={() => setNovoClienteModal(true)} className="flex items-center gap-1.5 text-[11px] text-violet-500 hover:text-violet-400 transition-colors">
              <Plus className="h-3 w-3" /> Cadastrar novo cliente
            </button>
            {clienteId && saldoCliente > 0 && (
              <div className="rounded-lg border border-orange-500/25 bg-orange-500/10 px-2.5 py-2 space-y-1.5">
                <label className="flex items-center gap-2 text-[11.5px] font-semibold text-orange-700 dark:text-orange-400 cursor-pointer select-none">
                  <input type="checkbox" checked={usarCredito}
                    onChange={e => {
                      setUsarCredito(e.target.checked);
                      if (e.target.checked && !valorCreditoAplicado) setValorCreditoAplicado(saldoCliente.toFixed(2));
                    }}
                    className="h-3.5 w-3.5 rounded border-orange-400" />
                  💰 Cliente tem {saldoCliente.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} de crédito — usar neste pedido?
                </label>
                {usarCredito && (
                  <input type="number" min={0} max={saldoCliente} step="0.01" value={valorCreditoAplicado}
                    onChange={e => setValorCreditoAplicado(e.target.value)}
                    className="w-full h-8 rounded-lg border border-orange-400/40 bg-background px-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-orange-500/30"
                    placeholder="Valor a abater" />
                )}
              </div>
            )}
          </div>

          {/* ── Adicionar Peça ── */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Adicionar Peça</label>
            <div className="relative" ref={pecaDropRef}>
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                ref={pecaInputRef}
                type="text"
                value={pecaSearch}
                onChange={e => handlePecaInput(e.target.value)}
                onFocus={handlePecaFocus}
                placeholder="Buscar por nome da peça..."
                className="w-full h-10 pl-9 pr-4 rounded-xl border border-border/50 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50"
              />
              {showAutocomp && (
                <div className="absolute top-full mt-1 left-0 right-0 z-50 rounded-xl border border-border bg-card shadow-xl overflow-hidden max-h-60 overflow-y-auto">
                  {autocomplete.length === 0 ? (
                    <div className="px-4 py-3 text-center">
                      <p className="text-[12px] font-semibold text-muted-foreground">Nenhuma peça encontrada</p>
                      <p className="text-[10px] text-muted-foreground/60 mt-0.5">Verifique o nome ou o estoque disponível</p>
                    </div>
                  ) : autocomplete.map(i => {
                    const precoRef = precoMap[i.device_id] ?? 0;
                    return (
                      <div key={i.id} className="flex items-stretch border-b border-border/10 last:border-0 hover:bg-muted/40 transition-colors">
                        <button type="button" onClick={() => handleSelectPeca(i)} className="flex-1 text-left px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1">
                                {favoritas.has(i.device_id) && <Star className="h-2.5 w-2.5 text-amber-400 fill-amber-400 shrink-0" />}
                                <p className="text-[12px] font-semibold text-foreground truncate">{i.device?.model}</p>
                              </div>
                              <p className="text-[10px] text-muted-foreground/70 font-mono">{i.device?.reference}</p>
                            </div>
                            <div className="shrink-0 text-right space-y-0.5">
                              <span className={cn("text-[11px] font-bold px-1.5 py-0.5 rounded-lg block",
                                dispRealCarrinho(i) > 0 ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400" : "bg-red-50 dark:bg-red-950/40 text-red-600")}>
                                {dispRealCarrinho(i)} un.
                              </span>
                              {precoRef > 0 ? (
                                <span className="text-[11px] font-bold text-violet-600 dark:text-violet-400 block">
                                  R$ {precoRef.toFixed(2).replace(".", ",")}
                                </span>
                              ) : (
                                <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 block">
                                  sem preço
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                        <button type="button" onClick={() => toggleFavorita(i.device_id)}
                          className="px-2 flex items-center text-muted-foreground/40 hover:text-amber-400 transition-colors"
                          title={favoritas.has(i.device_id) ? "Remover dos favoritos" : "Adicionar aos favoritos"}>
                          <Star className={cn("h-3.5 w-3.5", favoritas.has(i.device_id) && "fill-amber-400 text-amber-400")} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Peça selecionada: preço, quantidade, desconto e preview do valor final */}
            {selectedPeca && (
              <div className="rounded-xl border border-violet-500/25 bg-violet-500/[0.04] p-3 space-y-2.5">
                <div className="flex items-center gap-2 text-[12px]">
                  <Package className="h-3.5 w-3.5 text-violet-500 shrink-0" />
                  <span className="font-semibold text-violet-700 dark:text-violet-400 truncate flex-1">{selectedPeca.device?.model}</span>
                  <span className={cn("shrink-0 font-mono font-semibold text-[11px]", maxDisponivel === 0 ? "text-destructive" : "text-muted-foreground/70")}>
                    {maxDisponivel === 0 ? "sem estoque" : `máx. ${maxDisponivel} un.`}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] font-medium text-muted-foreground">Qtd.</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={maxDisponivel || undefined}
                      value={qtd === 0 ? "" : qtd}
                      onChange={e => {
                        const raw = e.target.value;
                        if (raw === "") { setQtd(0); return; } // permite apagar no celular sem forçar 1 de volta
                        const v = parseInt(raw, 10);
                        if (!isNaN(v)) setQtd(v);
                      }}
                      onBlur={() => {
                        const v = Math.max(1, qtd || 1);
                        setQtd(maxDisponivel > 0 ? Math.min(v, maxDisponivel) : v);
                      }}
                      className="w-full h-9 rounded-lg border border-border/50 bg-background text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-medium text-muted-foreground">Preço un.</label>
                    <div className={cn(
                      "h-9 rounded-lg border flex items-center justify-center text-[13px] font-bold",
                      (precoMap[selectedPeca.device_id] ?? 0) > 0
                        ? "border-border/40 bg-muted/30 text-foreground"
                        : "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                    )}>
                      {(precoMap[selectedPeca.device_id] ?? 0) > 0
                        ? `R$ ${(precoMap[selectedPeca.device_id] ?? 0).toFixed(2).replace(".", ",")}`
                        : "sem preço"}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-medium text-muted-foreground">Desconto %</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0"
                      value={descontoItemAtual === 0 ? "" : String(descontoItemAtual).replace(".", ",")}
                      onChange={e => {
                        const raw = e.target.value.replace(",", ".");
                        if (raw === "") { setDescontoItemAtual(0); return; }
                        const v = parseFloat(raw);
                        if (!isNaN(v)) setDescontoItemAtual(Math.max(0, v));
                      }}
                      className="w-full h-9 rounded-lg border border-border/50 bg-background text-sm text-center font-mono font-bold text-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                  </div>
                </div>

                {/* Preview: preço com desconto já calculado para passar ao cliente */}
                <div className="flex items-center justify-between rounded-lg bg-card border border-border/40 px-3 py-2">
                  <span className="text-[11px] text-muted-foreground">
                    {qtd}x com {descontoItemAtual > 0 ? `${String(descontoItemAtual).replace(".", ",")}% off` : "preço de tabela"}
                  </span>
                  <span className="text-[14px] font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                    R$ {((precoMap[selectedPeca.device_id] ?? 0) * qtd * (1 - descontoItemAtual / 100)).toFixed(2).replace(".", ",")}
                  </span>
                </div>

                {(precoMap[selectedPeca.device_id] ?? 0) === 0 && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1.5 px-1">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    Esta peça não tem preço de venda cadastrado. Peça ao financeiro para cadastrar na Tabela de Preços.
                  </p>
                )}

                <button
                  type="button"
                  onClick={addItem}
                  disabled={maxDisponivel === 0 || qtd < 1}
                  className="w-full h-9 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5"
                >
                  <Plus className="h-4 w-4" /> Adicionar ao pedido
                </button>
              </div>
            )}
          </div>

          {/* ── Lista de Itens ── */}
          {itens.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                  Itens do Pedido ({itens.reduce((s, i) => s + i.quantidade, 0)} un.)
                </label>
                <button
                  type="button"
                  onClick={() => setResumoOpen(true)}
                  className="flex items-center gap-1 text-[11px] font-semibold text-violet-600 dark:text-violet-400 hover:text-violet-500 transition-colors"
                >
                  <Receipt className="h-3 w-3" /> Ver total do pedido
                </button>
              </div>
              <div className="space-y-1">
                {itens.map((item, idx) => {
                  const liquidoUnit = (item.preco_unitario ?? 0) * (1 - (item.desconto_pct ?? 0) / 100);
                  return (
                    <div key={idx} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/20 border border-border/30">
                      <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium truncate">{item.device_model}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <p className="text-[10px] text-muted-foreground font-mono">{item.device_reference}</p>
                          {(item.desconto_pct ?? 0) > 0 && (
                            <span className="text-[9px] font-bold text-emerald-600 bg-emerald-500/10 rounded px-1">
                              -{String(item.desconto_pct).replace(".", ",")}%
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-[12px] font-bold block">{item.quantidade} un.</span>
                        {(item.preco_unitario ?? 0) > 0 ? (
                          <span className="text-[10px] text-emerald-600 font-semibold">R$ {(liquidoUnit * item.quantidade).toFixed(2).replace(".", ",")}</span>
                        ) : null}
                      </div>
                      <button type="button" onClick={() => setItens(prev => prev.filter((_, i) => i !== idx))} className="h-6 w-6 flex items-center justify-center rounded-lg hover:bg-destructive/15 hover:text-destructive text-muted-foreground transition-colors">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Mais opções (pagamento, endereço, frete, observações) ──
               Recolhido por padrão — a maioria dos pedidos usa os padrões
               (endereço do cliente, sem frete). Mostra só um resumo em chips
               quando tem algo preenchido, sem precisar abrir pra conferir. */}
          <div className="rounded-xl border border-border/40 overflow-hidden">
            <button
              type="button"
              onClick={() => setMostrarOpcoes(v => !v)}
              className="w-full flex items-center justify-between px-3.5 py-2.5 text-left hover:bg-muted/20 transition-colors"
            >
              <span className="text-[12px] font-semibold text-muted-foreground">
                Pagamento, entrega e observações
              </span>
              <div className="flex items-center gap-1.5">
                {!mostrarOpcoes && (
                  <div className="flex items-center gap-1 flex-wrap justify-end">
                    {formaPagamento && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 font-medium">
                        {formaPagamento === "cartao_credito" ? `${parcelas}x` : formaPagamento.replace("_", " ")}
                      </span>
                    )}
                    {!usarEnderecoCliente && enderecoEntrega && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium">outro endereço</span>
                    )}
                    {frete > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium">frete R$ {frete.toFixed(0)}</span>
                    )}
                    {obs.trim() && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">obs.</span>
                    )}
                  </div>
                )}
                <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0", mostrarOpcoes && "rotate-180")} />
              </div>
            </button>

            {mostrarOpcoes && (
              <div className="p-3.5 pt-1 space-y-4 border-t border-border/30">

          {/* ── Forma de Pagamento ── */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Forma de Pagamento</label>
            <select
              value={formaPagamento}
              onChange={e => { setFormaPagamento(e.target.value); setParcelas(1); }}
              className="w-full h-10 rounded-xl border border-border bg-background px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-violet-500/30"
            >
              <option value="">Não informado</option>
              <option value="dinheiro">Dinheiro</option>
              <option value="pix">PIX</option>
              <option value="boleto">Boleto</option>
              <option value="cartao_debito">Cartão de Débito</option>
              <option value="cartao_credito">Cartão de Crédito</option>
            </select>
            {["cartao_credito", "boleto"].includes(formaPagamento) && (
              <div className="flex items-center gap-2 mt-2">
                <label className="text-[11px] text-muted-foreground shrink-0">Parcelas:</label>
                <select
                  value={parcelas}
                  onChange={e => setParcelas(Number(e.target.value))}
                  className="flex-1 h-9 rounded-xl border border-border bg-background px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                >
                  {[1,2,3,4,5,6,7,8,9,10,11,12].map(n => (
                    <option key={n} value={n}>{n}x {n === 1 ? "(à vista)" : "sem juros"}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* ── Endereço de Entrega ── */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Endereço de Entrega</label>
            <div className="flex items-center gap-2 mb-2">
              <button
                type="button"
                onClick={() => setUsarEnderecoCliente(true)}
                className={`flex-1 h-8 rounded-xl text-[12px] font-medium border transition-colors ${usarEnderecoCliente ? "bg-violet-600 text-white border-violet-600" : "border-border text-muted-foreground hover:bg-muted/30"}`}
              >
                Endereço do cliente
              </button>
              <button
                type="button"
                onClick={() => setUsarEnderecoCliente(false)}
                className={`flex-1 h-8 rounded-xl text-[12px] font-medium border transition-colors ${!usarEnderecoCliente ? "bg-violet-600 text-white border-violet-600" : "border-border text-muted-foreground hover:bg-muted/30"}`}
              >
                Outro endereço
              </button>
            </div>
            {usarEnderecoCliente ? (
              <p className="text-[12px] text-muted-foreground px-1">
                {clientes.find(c => c.id === clienteId)?.endereco || "Cliente sem endereço cadastrado"}
              </p>
            ) : (
              <input
                type="text"
                value={enderecoEntrega}
                onChange={e => setEnderecoEntrega(e.target.value)}
                placeholder="Rua, número, cidade..."
                maxLength={300}
                className="w-full h-10 rounded-xl border border-border/50 bg-background text-sm px-3 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
              />
            )}
          </div>

          {/* ── Frete ── */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Frete (R$)</label>
            <div className="relative flex items-center">
              <span className="absolute left-3 text-[13px] font-medium text-muted-foreground pointer-events-none">R$</span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={frete === 0 ? "" : frete}
                onChange={e => {
                  const v = parseFloat(e.target.value);
                  setFrete(isNaN(v) || v < 0 ? 0 : v);
                }}
                placeholder="0,00"
                className="w-full h-10 rounded-xl border border-border bg-background pl-9 pr-4 text-[14px] font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50 transition-all"
              />
            </div>
            {frete > 0 && (
              <p className="text-[11px] text-violet-600 dark:text-violet-400 flex items-center gap-1.5 px-1">
                <Truck className="h-3.5 w-3.5 shrink-0" />
                Frete de R$ {frete.toFixed(2).replace(".", ",")} será adicionado ao pedido
              </p>
            )}
          </div>

          {/* ── Observações ── */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Observações</label>
            <textarea
              value={obs}
              onChange={e => setObs(e.target.value)}
              placeholder="Informações adicionais para o estoque..."
              rows={2}
              className="w-full rounded-xl border border-border/50 bg-background text-sm px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50"
            />
          </div>

              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 p-5 border-t border-border/30 shrink-0">
          <button type="button" onClick={onClose} disabled={saving} className="h-9 px-3 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors">Cancelar</button>
          {itens.length > 0 && (
            <button
              type="button"
              onClick={() => setResumoOpen(true)}
              className="h-9 px-3 rounded-xl border border-violet-500/40 text-violet-600 dark:text-violet-400 bg-violet-500/8 hover:bg-violet-500/15 text-sm font-semibold transition-colors flex items-center gap-1.5 shrink-0"
              title="Ver o total do pedido"
            >
              <Receipt className="h-3.5 w-3.5" />
              <span className="tabular-nums">R$ {totalGeral.toFixed(2).replace(".", ",")}</span>
            </button>
          )}
          <button type="button" onClick={handleSave} disabled={saving || !clienteId || itens.length === 0} className="flex-1 h-9 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5">
            {saving ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <ShoppingCart className="h-3.5 w-3.5" />}
            {editarPedido ? "Salvar e Reenviar" : "Criar Pedido"}
          </button>
        </div>
      </div>

      {/* ── Popup: Resumo do Pedido (subtotal, desconto, frete, total) ── */}
      {resumoOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={() => setResumoOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-card border border-border/40 shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/30 bg-gradient-to-r from-violet-500/8 to-transparent">
              <div className="flex items-center gap-2">
                <Receipt className="h-4 w-4 text-violet-500" />
                <p className="text-[13px] font-bold">Resumo do Pedido</p>
              </div>
              <button type="button" onClick={() => setResumoOpen(false)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-3 max-h-[60vh] overflow-y-auto">
              {itens.length === 0 ? (
                <p className="text-[12px] text-muted-foreground text-center py-4">Nenhuma peça adicionada ainda.</p>
              ) : (
                <div className="space-y-2">
                  {itens.map((item, idx) => {
                    const liquidoUnit = (item.preco_unitario ?? 0) * (1 - (item.desconto_pct ?? 0) / 100);
                    return (
                      <div key={idx} className="flex items-center justify-between gap-2 text-[12px]">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{item.device_model}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {item.quantidade} un. × R$ {(item.preco_unitario ?? 0).toFixed(2).replace(".", ",")}
                            {(item.desconto_pct ?? 0) > 0 && ` · -${String(item.desconto_pct).replace(".", ",")}%`}
                          </p>
                        </div>
                        <span className="font-bold shrink-0 tabular-nums">R$ {(liquidoUnit * item.quantidade).toFixed(2).replace(".", ",")}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="border-t border-border/30 pt-3 space-y-1.5">
                <div className="flex items-center justify-between text-[12px] text-muted-foreground">
                  <span>Subtotal (preço de tabela)</span>
                  <span className="tabular-nums">R$ {subtotalBruto.toFixed(2).replace(".", ",")}</span>
                </div>
                {totalDescontoValor > 0 && (
                  <div className="flex items-center justify-between text-[12px] text-emerald-600 dark:text-emerald-400">
                    <span>Descontos aplicados</span>
                    <span className="tabular-nums">- R$ {totalDescontoValor.toFixed(2).replace(".", ",")}</span>
                  </div>
                )}
                {frete > 0 && (
                  <div className="flex items-center justify-between text-[12px] text-violet-600 dark:text-violet-400">
                    <span>Frete</span>
                    <span className="tabular-nums">+ R$ {frete.toFixed(2).replace(".", ",")}</span>
                  </div>
                )}
                <div className="flex items-center justify-between pt-2 border-t border-border/30">
                  <span className="text-[13px] font-bold">Total a cobrar</span>
                  <span className="text-[20px] font-black text-violet-600 dark:text-violet-400 tabular-nums">
                    R$ {totalGeral.toFixed(2).replace(".", ",")}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-border/30">
              <button type="button" onClick={() => setResumoOpen(false)} className="w-full h-9 rounded-xl bg-muted/40 hover:bg-muted/60 text-sm font-semibold transition-colors">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {novoClienteModal && (
        <ClienteModal open onClose={() => setNovoClienteModal(false)} onSuccess={(c) => { loadClientes(); setClienteId(c.id); setClienteSearch(c.nome); setNovoClienteModal(false); }} />
      )}
    </div>
  );
}
