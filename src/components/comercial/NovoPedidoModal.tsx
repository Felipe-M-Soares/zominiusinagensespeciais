/**
 * Novo pedido / editar pedido — tela única, no padrão "catálogo + carrinho"
 * usado pelos portais B2B e força de vendas (Bling, Omie, Mercos...):
 *
 *   1. Cliente   → busca por nome, CNPJ ou cidade; mostra alertas (títulos
 *                  vencidos, crédito de devolução, último pedido).
 *   2. Peças     → catálogo com busca e filtros "Já comprou" / "Favoritas";
 *                  preço e saldo na linha, botão + adiciona direto.
 *   3. Carrinho  → quantidade com +/−, desconto por peça limitado ao máximo
 *                  da tabela de preços, total sempre visível.
 *   4. Condições → pagamento em botões, parcelas, prazo, frete, entrega, obs.
 *
 * Regras de negócio preservadas: reserva de estoque (criar_pedido_venda /
 * editar_pedido_retorno, numa transação só), crédito de devolução, edição de pedido que voltou do
 * estoque e "repetir pedido".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, CalendarDays, Check, ChevronLeft, History, Loader2, Minus, Package, Plus, Search, ShoppingCart, Star, Trash2, Truck, User, UserPlus, Wallet, X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { temPapel } from "@/types/roles";
import { parseValor } from "@/lib/financeiro";
import { ClienteModal } from "@/components/comercial/ClienteModal";
import { carregarCatalogoVenda, filtrarCatalogo, type PecaCatalogo } from "@/lib/catalogoVenda";
import type { Cliente, PedidoItem, PedidoCompleto } from "@/types/comercial";


interface NovoPedidoModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  clienteFixo?: Cliente | null;
  duplicarDe?: PedidoCompleto | null;
  editarPedido?: PedidoCompleto | null;
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const soDig = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const PAGAMENTOS = [
  { id: "pix", label: "PIX" }, { id: "boleto", label: "Boleto" }, { id: "cartao_credito", label: "Cartão crédito" },
  { id: "cartao_debito", label: "Cartão débito" }, { id: "dinheiro", label: "Dinheiro" },
];
interface Preco { venda: number; descMax: number }
interface InfoCliente { vencido: number; credito: number; ultimoPedido: string | null; compradas: Map<string, number> }

export function NovoPedidoModal({ open, onClose, onSuccess, clienteFixo, duplicarDe, editarPedido }: NovoPedidoModalProps) {
  const { user, role } = useAuth();
  // Admin, financeiro e gerente podem passar do desconto máximo (o banco aplica a mesma regra).
  const liberaDesconto = temPapel(role, "financeiro");
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [buscaCliente, setBuscaCliente] = useState("");
  const [info, setInfo] = useState<InfoCliente | null>(null);
  const [novoCliente, setNovoCliente] = useState(false);

  const [precos, setPrecos] = useState<Map<string, Preco>>(new Map());
  const [catalogoBase, setCatalogoBase] = useState<PecaCatalogo[]>([]);
  const [carregandoPecas, setCarregandoPecas] = useState(false);
  const [favoritas, setFavoritas] = useState<Set<string>>(new Set());
  const [buscaPeca, setBuscaPeca] = useState("");
  const [filtro, setFiltro] = useState<"todas" | "compradas" | "favoritas">("todas");

  const [itens, setItens] = useState<PedidoItem[]>([]);
  const [formaPagamento, setFormaPagamento] = useState("");
  const [parcelas, setParcelas] = useState(1);
  const [prazoEntrega, setPrazoEntrega] = useState("");
  const [frete, setFrete] = useState("");
  const [usarEnderecoCliente, setUsarEnderecoCliente] = useState(true);
  const [enderecoEntrega, setEnderecoEntrega] = useState("");
  const [obs, setObs] = useState("");
  const [usarCredito, setUsarCredito] = useState(false);
  const [saving, setSaving] = useState(false);
  const [etapaMobile, setEtapaMobile] = useState<"montar" | "revisar">("montar");
  const buscaPecaRef = useRef<HTMLInputElement>(null);

  // ── Carga inicial ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    supabase.from("clientes").select("*").order("nome").then(({ data }) => setClientes((data as Cliente[]) ?? []));
    supabase.from("peca_favoritas").select("device_id").then(({ data }) => setFavoritas(new Set((data ?? []).map((r: { device_id: string }) => r.device_id))));
    setCarregandoPecas(true);
    carregarCatalogoVenda()
      .then(lista => {
        setCatalogoBase(lista);
        setPrecos(new Map(lista.map(p => [p.device_id, { venda: p.preco_venda, descMax: p.desconto_max_pct }])));
      })
      .catch(() => toast.error("Não foi possível carregar as peças."))
      .finally(() => setCarregandoPecas(false));
  }, [open]);

  // Reset / preenchimento ao abrir
  useEffect(() => {
    if (!open) return;
    const base = editarPedido ?? duplicarDe;
    setClienteId(base?.cliente_id ?? clienteFixo?.id ?? "");
    setBuscaCliente("");
    setItens(base ? base.itens.map(i => ({
      stock_item_id: i.stock_item_id, device_id: i.device_id, lote: editarPedido ? (i.lote ?? null) : null, quantidade: i.quantidade,
      device_model: i.device_model ?? "", device_reference: i.device_reference ?? "", preco_unitario: i.valor_unitario ?? 0, desconto_pct: 0,
    })) : []);
    setObs(editarPedido ? (editarPedido.observacoes?.replace(/^\[RETORNO\]\s*/, "") ?? "") : (duplicarDe?.observacoes ?? ""));
    setFormaPagamento(base?.forma_pagamento ?? ""); setParcelas(base?.parcelas ?? 1);
    setPrazoEntrega(editarPedido?.prazo_entrega ?? ""); setFrete(base?.frete ? String(base.frete).replace(".", ",") : "");
    setUsarEnderecoCliente(true); setEnderecoEntrega(""); setUsarCredito(false);
    setBuscaPeca(""); setFiltro("todas"); setEtapaMobile("montar");
    if (editarPedido) {
      supabase.from("pedidos_comerciais").select("endereco_entrega,usar_endereco_cliente").eq("id", editarPedido.id).maybeSingle()
        .then(({ data }) => {
          if (!data) return;
          setUsarEnderecoCliente(data.usar_endereco_cliente ?? true);
          setEnderecoEntrega(data.endereco_entrega ?? "");
        });
    }
  }, [open, clienteFixo, duplicarDe, editarPedido]);

  // Itens vindos de pedido salvo: separa preço de tabela e desconto (valor salvo é líquido)
  useEffect(() => {
    if (!open || precos.size === 0 || (!editarPedido && !duplicarDe)) return;
    setItens(prev => prev.map(i => {
      const tab = i.device_id ? precos.get(i.device_id)?.venda ?? 0 : 0;
      const liq = i.preco_unitario ?? 0;
      if (tab <= 0 || (i.desconto_pct ?? 0) > 0) return i;
      const desc = liq > 0 && liq < tab ? Math.round(((tab - liq) / tab) * 1000) / 10 : 0;
      const max = i.device_id ? precos.get(i.device_id)?.descMax ?? 0 : 0;
      if (desc > max) toast.info(`${i.device_model}: desconto ajustado para o máximo atual (${max}%).`);
      return { ...i, preco_unitario: tab, desconto_pct: Math.min(desc, max) };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, precos]);

  // Informações do cliente escolhido
  useEffect(() => {
    if (!clienteId) { setInfo(null); return; }
    let cancel = false;
    (async () => {
      const hoje = new Date(); const hojeIso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
      const [contas, pedidos] = await Promise.all([
        // títulos a receber em aberto + créditos de devolução (lançados como conta "a pagar" ao cliente)
        supabase.from("contas_financeiras").select("valor,categoria,status,tipo,data_vencimento,pedidos_comerciais!inner(cliente_id)")
          .in("status", ["aberto", "vencido"]).eq("pedidos_comerciais.cliente_id", clienteId),
        supabase.from("pedidos_comerciais").select("id,created_at,pedido_itens(quantidade,stock_items(device_id))")
          .eq("cliente_id", clienteId).neq("status", "cancelado").order("created_at", { ascending: false }).limit(20),
      ]);
      if (cancel) return;
      type C = { valor: number; categoria: string; tipo: string; data_vencimento: string };
      const cs = (contas.data ?? []) as unknown as C[];
      const compradas = new Map<string, number>();
      type P = { created_at: string; pedido_itens: { quantidade: number; stock_items: { device_id: string } | null }[] };
      const ps = (pedidos.data ?? []) as unknown as P[];
      for (const p of ps) for (const it of p.pedido_itens ?? []) {
        const d = it.stock_items?.device_id; if (d && !compradas.has(d)) compradas.set(d, it.quantidade);
      }
      setInfo({
        vencido: cs.filter(c => c.tipo === "receber" && c.categoria !== "credito_devolucao_cliente" && c.data_vencimento < hojeIso).reduce((s, c) => s + Number(c.valor), 0),
        credito: cs.filter(c => c.categoria === "credito_devolucao_cliente").reduce((s, c) => s + Number(c.valor), 0),
        ultimoPedido: ps.find(p => p.created_at)?.created_at ?? null,
        compradas,
      });
    })();
    return () => { cancel = true; };
  }, [clienteId]);

  const cliente = clientes.find(c => c.id === clienteId) ?? (clienteFixo?.id === clienteId ? clienteFixo : null);

  // ── Catálogo ───────────────────────────────────────────────────────────────
  const noCarrinho = useCallback((stockId: string) => itens.filter(i => i.stock_item_id === stockId).reduce((s, i) => s + i.quantidade, 0), [itens]);
  // Saldo que este pedido já tinha reservado (na edição, o banco libera antes de reservar de novo).
  const reservaPropria = useCallback((stockId: string | null) =>
    stockId && editarPedido ? editarPedido.itens.filter(i => i.stock_item_id === stockId).reduce((s, i) => s + i.quantidade, 0) : 0, [editarPedido]);
  const livre = useCallback((p: PecaCatalogo) => p.stock_item_id ? p.disponivel + reservaPropria(p.stock_item_id) : 0, [reservaPropria]);
  const catalogo = useMemo(() => {
    return filtrarCatalogo(catalogoBase, buscaPeca)
      .filter(i => filtro !== "compradas" || info?.compradas.has(i.device_id))
      .filter(i => filtro !== "favoritas" || favoritas.has(i.device_id))
      .sort((a, b) => Number(favoritas.has(b.device_id)) - Number(favoritas.has(a.device_id))
        || Number(livre(b) > 0) - Number(livre(a) > 0)
        || (a.model ?? "").localeCompare(b.model ?? ""))
      .slice(0, 200);
  }, [catalogoBase, buscaPeca, filtro, favoritas, info, livre]);

  function adicionar(i: PecaCatalogo, qtd = 1) {
    if (!i.stock_item_id) return;
    const disp = livre(i) - noCarrinho(i.stock_item_id);
    if (disp <= 0) { toast.error("Sem saldo disponível na expedição."); return; }
    const q = Math.min(qtd, disp);
    const sid = i.stock_item_id;
    setItens(prev => {
      const idx = prev.findIndex(x => x.stock_item_id === sid);
      if (idx >= 0) return prev.map((x, j) => j === idx ? { ...x, quantidade: x.quantidade + q } : x);
      return [...prev, {
        stock_item_id: sid, device_id: i.device_id, lote: "", quantidade: q,
        device_model: i.model ?? "", device_reference: i.reference ?? "",
        preco_unitario: precos.get(i.device_id)?.venda ?? 0, desconto_pct: 0,
      }];
    });
  }
  function mudarQtd(idx: number, q: number) {
    setItens(prev => prev.map((x, j) => {
      if (j !== idx) return x;
      const est = catalogoBase.find(e => e.stock_item_id === x.stock_item_id);
      const max = est ? livre(est) - (noCarrinho(x.stock_item_id) - x.quantidade) : x.quantidade;
      const nova = Math.max(1, Math.min(q || 1, Math.max(1, max)));
      if ((q || 1) > max) toast.error(`Disponível: ${max} un.`);
      return { ...x, quantidade: nova };
    }));
  }
  function mudarDesconto(idx: number, txt: string) {
    setItens(prev => prev.map((x, j) => {
      if (j !== idx) return x;
      const v = Math.max(0, Number(txt.replace(",", ".")) || 0);
      const max = liberaDesconto ? 100 : x.device_id ? precos.get(x.device_id)?.descMax ?? 0 : 0;
      if (v > max) toast.error(`Desconto máximo desta peça: ${max}%`, { id: `desc-${x.stock_item_id}` });
      return { ...x, desconto_pct: Math.min(v, max) };
    }));
  }
  async function toggleFavorita(deviceId: string) {
    if (!user?.id) return;
    if (favoritas.has(deviceId)) {
      await supabase.from("peca_favoritas").delete().eq("device_id", deviceId).eq("user_id", user.id);
      setFavoritas(p => { const n = new Set(p); n.delete(deviceId); return n; });
    } else {
      await supabase.from("peca_favoritas").insert({ device_id: deviceId, user_id: user.id });
      setFavoritas(p => new Set([...p, deviceId]));
    }
  }

  // ── Totais ────────────────────────────────────────────────────────────────
  const liquido = (i: PedidoItem) => Math.round((i.preco_unitario ?? 0) * (1 - (i.desconto_pct ?? 0) / 100) * 100) / 100;
  const subtotalBruto = itens.reduce((s, i) => s + (i.preco_unitario ?? 0) * i.quantidade, 0);
  const subtotal = itens.reduce((s, i) => s + liquido(i) * i.quantidade, 0);
  const freteNum = Math.max(0, parseValor(frete));
  const credito = usarCredito && info ? Math.min(info.credito, subtotal) : 0;
  const total = subtotal - credito + freteNum;
  const semPreco = itens.some(i => (i.preco_unitario ?? 0) <= 0);
  const pecas = itens.reduce((s, i) => s + i.quantidade, 0);

  async function salvar() {
    if (!clienteId) { toast.error("Escolha o cliente."); return; }
    if (!itens.length) { toast.error("Adicione ao menos uma peça."); return; }
    if (!user?.id) { toast.error("Sessão expirada. Entre de novo."); return; }
    setSaving(true);
    try {
      const endFinal = usarEnderecoCliente ? (cliente?.endereco ?? null) : (enderecoEntrega.trim() || null);
      const descMedio = subtotalBruto > 0 ? Math.round((1 - subtotal / subtotalBruto) * 1000) / 10 : 0;
      const parc = ["cartao_credito", "boleto"].includes(formaPagamento) ? parcelas : 1;

      if (editarPedido) {
        const { data, error } = await supabase.rpc("editar_pedido_retorno", {
          p_pedido_id: editarPedido.id,
          p_itens: itens.map(i => ({ stock_item_id: i.stock_item_id, lote: i.lote || "", quantidade: i.quantidade, valor_unitario: liquido(i) })),
          p_dados: {
            desconto_pct: Math.max(0, descMedio), frete: freteNum, observacoes: obs.trim(), prazo_entrega: prazoEntrega,
            forma_pagamento: formaPagamento, parcelas: parc, endereco_entrega: endFinal ?? "", usar_endereco_cliente: usarEnderecoCliente,
          },
        });
        const res = data as { ok?: boolean; error?: string } | null;
        if (error || !res?.ok) { toast.error(res?.error ?? "Não foi possível salvar o pedido."); return; }
        toast.success("Pedido atualizado e reenviado ao estoque.");
        onSuccess(); return;
      }

      // Tudo numa transação no banco: pedido, itens, reservas e crédito
      const { data, error } = await supabase.rpc("criar_pedido_venda", {
        p_cliente_id: clienteId,
        p_itens: itens.map(i => ({ stock_item_id: i.stock_item_id, lote: i.lote || "", quantidade: i.quantidade, valor_unitario: liquido(i) })),
        p_dados: {
          observacoes: obs.trim(), desconto_pct: Math.max(0, descMedio), frete: freteNum, prazo_entrega: prazoEntrega,
          forma_pagamento: formaPagamento, parcelas: parc, endereco_entrega: endFinal ?? "", usar_endereco_cliente: usarEnderecoCliente,
          credito,
        },
      });
      const r = data as { ok?: boolean; error?: string } | null;
      if (error || !r?.ok) { toast.error(r?.error ?? "Erro ao criar pedido."); return; }
      toast.success("Pedido criado! O estoque vai separar os lotes.");
      onSuccess();
    } catch {
      toast.error("Erro ao salvar o pedido.");
    } finally { setSaving(false); }
  }

  if (!open) return null;

  const clientesFiltrados = (() => {
    const q = norm(buscaCliente.trim()); const d = soDig(buscaCliente);
    if (!q) return clientes.slice(0, 8);
    return clientes.filter(c => norm(`${c.nome} ${c.municipio ?? ""}`).includes(q) || (d.length >= 3 && soDig(c.documento).includes(d))).slice(0, 12);
  })();

  // ── Blocos de tela ─────────────────────────────────────────────────────────
  const blocoCliente = (
    <section className="rounded-2xl border bg-card p-4 space-y-3">
      <h3 className="text-sm font-semibold flex items-center gap-2"><User className="h-4 w-4 text-primary" />Cliente</h3>
      {cliente ? (
        <div className="space-y-2">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold shrink-0">{cliente.nome.charAt(0).toUpperCase()}</div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold truncate">{cliente.nome}</p>
              <p className="text-xs text-muted-foreground truncate">{[cliente.documento, cliente.municipio && `${cliente.municipio}/${cliente.uf ?? ""}`].filter(Boolean).join(" · ") || "sem documento"}</p>
            </div>
            {!editarPedido && <Button variant="ghost" size="sm" onClick={() => setClienteId("")}>Trocar</Button>}
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {info && info.vencido > 0 && <span className="rounded-full bg-red-500/10 text-red-700 dark:text-red-400 px-2 py-0.5 font-medium inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{brl(info.vencido)} em atraso</span>}
            {info?.ultimoPedido && <span className="rounded-full bg-muted px-2 py-0.5 inline-flex items-center gap-1"><History className="h-3 w-3" />último pedido {new Date(info.ultimoPedido).toLocaleDateString("pt-BR")}</span>}
            {info && info.compradas.size > 0 && <span className="rounded-full bg-muted px-2 py-0.5">{info.compradas.size} peça(s) já compradas</span>}
          </div>
          {info && info.credito > 0 && (
            <label className="flex items-center gap-2 rounded-xl border border-orange-500/30 bg-orange-500/5 px-3 py-2 text-sm cursor-pointer">
              <input type="checkbox" checked={usarCredito} onChange={e => setUsarCredito(e.target.checked)} className="h-4 w-4" />
              <Wallet className="h-4 w-4 text-orange-600" />Usar crédito de devolução ({brl(info.credito)})
            </label>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus value={buscaCliente} onChange={e => setBuscaCliente(e.target.value)} placeholder="Nome, CNPJ/CPF ou cidade..." className="h-11 pl-9" />
          </div>
          <ul className="rounded-xl border divide-y max-h-64 overflow-y-auto">
            {clientesFiltrados.map(c => (
              <li key={c.id}><button type="button" onClick={() => { setClienteId(c.id); setBuscaCliente(""); }} className="w-full text-left px-3 py-2.5 hover:bg-muted">
                <p className="text-sm font-medium">{c.nome}</p><p className="text-xs text-muted-foreground">{[c.documento, c.municipio].filter(Boolean).join(" · ")}</p>
              </button></li>
            ))}
            {!clientesFiltrados.length && <li className="px-3 py-4 text-sm text-center text-muted-foreground">Nenhum cliente encontrado.</li>}
          </ul>
          <Button variant="outline" className="w-full h-10 gap-1.5" onClick={() => setNovoCliente(true)}><UserPlus className="h-4 w-4" />Cadastrar cliente novo</Button>
        </div>
      )}
    </section>
  );

  const blocoCatalogo = (
    <section className="rounded-2xl border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-2 flex-1"><Package className="h-4 w-4 text-primary" />Peças disponíveis</h3>
        <div className="flex gap-1 rounded-xl border bg-muted/40 p-1">
          {([["todas", "Todas"], ["compradas", "Já comprou"], ["favoritas", "Favoritas"]] as const).map(([id, l]) => (
            <button key={id} type="button" onClick={() => setFiltro(id)} disabled={id === "compradas" && !info?.compradas.size}
              className={cn("h-8 px-3 rounded-lg text-xs font-medium disabled:opacity-40", filtro === id ? "bg-card shadow-sm" : "text-muted-foreground")}>{l}</button>
          ))}
        </div>
      </div>
      <div className="relative">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input ref={buscaPecaRef} value={buscaPeca} onChange={e => setBuscaPeca(e.target.value)} placeholder="Buscar por nome, referência ou código..." className="h-11 pl-9" />
      </div>
      <ul className="divide-y rounded-xl border max-h-[26rem] overflow-y-auto">
        {catalogo.map(i => {
          const p = precos.get(i.device_id);
          const disp = livre(i) - noCarrinho(i.stock_item_id ?? "");
          const jaComprou = info?.compradas.get(i.device_id);
          return (
            <li key={i.device_id} className={cn("flex items-center gap-2 px-3 py-2.5", disp <= 0 && "bg-muted/30")}>
              <button type="button" onClick={() => toggleFavorita(i.device_id)} aria-label="Favorita" className="shrink-0 h-8 w-6 flex items-center justify-center">
                <Star className={cn("h-4 w-4", favoritas.has(i.device_id) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")} />
              </button>
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm font-medium truncate", disp <= 0 && "text-muted-foreground")}>{i.model}</p>
                <p className="text-xs text-muted-foreground truncate">{[i.reference, i.internal_code && i.internal_code !== i.reference ? i.internal_code : null].filter(Boolean).join(" · ")}{jaComprou ? ` · última compra: ${jaComprou} un.` : ""}</p>
              </div>
              <div className="text-right shrink-0 max-w-[45%]">
                <p className={cn("text-sm font-semibold tabular-nums", !p?.venda && "text-amber-600")}>{p?.venda ? brl(p.venda) : "sem preço"}</p>
                <p className={cn("text-xs", disp > 0 ? "text-muted-foreground" : "text-red-600")}>
                  {disp > 0 ? `${disp} disp.` : i.em_producao > 0 ? `sem saldo · ${i.em_producao} em produção` : "sem saldo na expedição"}
                </p>
              </div>
              <Button size="icon" className="h-10 w-10 shrink-0" disabled={disp <= 0} onClick={() => adicionar(i, jaComprou && !noCarrinho(i.stock_item_id ?? "") ? Math.min(jaComprou, disp) : 1)} aria-label={`Adicionar ${i.model}`}>
                <Plus className="h-4 w-4" />
              </Button>
            </li>
          );
        })}
        {!catalogo.length && <li className="px-3 py-8 text-sm text-center text-muted-foreground">
          {carregandoPecas ? "Carregando peças..." : !catalogoBase.length ? "Nenhuma peça cadastrada em Componentes." : filtro !== "todas" ? "Nenhuma peça neste filtro — toque em \"Todas\"." : "Nenhuma peça encontrada com esse nome, referência ou código."}
        </li>}
      </ul>
    </section>
  );

  const blocoCarrinho = (
    <section className="rounded-2xl border bg-card p-4 space-y-3">
      <h3 className="text-sm font-semibold flex items-center gap-2"><ShoppingCart className="h-4 w-4 text-primary" />Itens do pedido {pecas > 0 && <span className="text-muted-foreground font-normal">({pecas} peças)</span>}</h3>
      {!itens.length ? <p className="text-sm text-muted-foreground py-4 text-center">Toque em <strong>+</strong> nas peças para adicionar.</p> : (
        <ul className="divide-y">
          {itens.map((i, idx) => {
            const max = i.device_id ? precos.get(i.device_id)?.descMax ?? 0 : 0;
            return (
              <li key={`${i.stock_item_id}-${idx}`} className="py-2.5 space-y-1.5">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1"><p className="text-sm font-medium truncate">{i.device_model}</p><p className="text-xs text-muted-foreground">{i.device_reference} · {(i.preco_unitario ?? 0) > 0 ? `${brl(i.preco_unitario ?? 0)} un.` : "sem preço"}</p></div>
                  <p className="text-sm font-semibold tabular-nums">{brl(liquido(i) * i.quantidade)}</p>
                  <button type="button" onClick={() => setItens(p => p.filter((_, j) => j !== idx))} className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10" aria-label="Remover"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center rounded-xl border">
                    <button type="button" className="h-9 w-9 flex items-center justify-center" onClick={() => mudarQtd(idx, i.quantidade - 1)} aria-label="Menos"><Minus className="h-4 w-4" /></button>
                    <input value={i.quantidade} inputMode="numeric" onChange={e => mudarQtd(idx, Number(e.target.value.replace(/\D/g, "")))} className="w-12 h-9 text-center bg-transparent text-sm font-semibold tabular-nums focus:outline-none" aria-label="Quantidade" />
                    <button type="button" className="h-9 w-9 flex items-center justify-center" onClick={() => mudarQtd(idx, i.quantidade + 1)} aria-label="Mais"><Plus className="h-4 w-4" /></button>
                  </div>
                  {max > 0 ? (
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      desc.
                      <input value={i.desconto_pct ? String(i.desconto_pct).replace(".", ",") : ""} placeholder="0" inputMode="decimal"
                        onChange={e => mudarDesconto(idx, e.target.value)} className="w-14 h-9 rounded-xl border bg-background text-center text-sm focus:outline-none focus:ring-2 focus:ring-ring" aria-label="Desconto %" />
                      % <span className="text-[11px]">(máx. {max}%)</span>
                    </label>
                  ) : <span className="text-xs text-muted-foreground">sem desconto nesta peça</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  const blocoCondicoes = (
    <section className="rounded-2xl border bg-card p-4 space-y-4">
      <div className="space-y-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pagamento</span>
        <div className="flex flex-wrap gap-1.5">
          {PAGAMENTOS.map(p => (
            <button key={p.id} type="button" onClick={() => { setFormaPagamento(f => f === p.id ? "" : p.id); setParcelas(1); }}
              className={cn("h-9 px-3 rounded-full border text-sm", formaPagamento === p.id ? "border-primary bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted")}>{p.label}</button>
          ))}
        </div>
        {["cartao_credito", "boleto"].includes(formaPagamento) && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {[1, 2, 3, 4, 5, 6, 10, 12].map(n => (
              <button key={n} type="button" onClick={() => setParcelas(n)} className={cn("h-8 min-w-10 px-2 rounded-lg border text-sm", parcelas === n ? "border-primary bg-primary/10 text-primary font-medium" : "text-muted-foreground")}>{n === 1 ? "à vista" : `${n}x`}</button>
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />Prazo de entrega</span>
          <Input type="date" value={prazoEntrega} onChange={e => setPrazoEntrega(e.target.value)} className="h-11" /></label>
        <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1"><Truck className="h-3.5 w-3.5" />Frete (R$)</span>
          <Input value={frete} onChange={e => setFrete(e.target.value)} inputMode="decimal" placeholder="0,00" className="h-11" /></label>
      </div>
      <div className="space-y-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Entrega</span>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => setUsarEnderecoCliente(true)} className={cn("flex-1 h-9 rounded-xl border text-sm", usarEnderecoCliente ? "border-primary bg-primary/10 text-primary font-medium" : "text-muted-foreground")}>Endereço do cliente</button>
          <button type="button" onClick={() => setUsarEnderecoCliente(false)} className={cn("flex-1 h-9 rounded-xl border text-sm", !usarEnderecoCliente ? "border-primary bg-primary/10 text-primary font-medium" : "text-muted-foreground")}>Outro endereço</button>
        </div>
        {usarEnderecoCliente
          ? <p className="text-xs text-muted-foreground">{cliente?.endereco || "Cliente sem endereço cadastrado"}</p>
          : <Input value={enderecoEntrega} onChange={e => setEnderecoEntrega(e.target.value.slice(0, 300))} placeholder="Rua, número, bairro, cidade/UF" className="h-11" />}
      </div>
      <Textarea value={obs} onChange={e => setObs(e.target.value.slice(0, 1000))} rows={2} placeholder="Observações para o estoque / financeiro" />
    </section>
  );

  const botaoSalvar = (
    <Button className="w-full h-12 text-base gap-2" onClick={salvar} disabled={saving || !clienteId || !itens.length}>
      {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}{editarPedido ? "Salvar e reenviar ao estoque" : "Criar pedido"}
    </Button>
  );

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col animate-in fade-in duration-150" role="dialog" aria-modal="true" aria-label={editarPedido ? "Editar pedido" : "Novo pedido"}>
      <header className="h-14 shrink-0 border-b flex items-center gap-2 px-3 sm:px-5">
        {etapaMobile === "revisar"
          ? <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setEtapaMobile("montar")} aria-label="Voltar"><ChevronLeft className="h-5 w-5" /></Button>
          : null}
        <ShoppingCart className="h-5 w-5 text-primary hidden sm:block" />
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold leading-tight">{editarPedido ? "Editar pedido" : duplicarDe ? "Repetir pedido" : "Novo pedido"}</h2>
          <p className="text-xs text-muted-foreground truncate">{cliente?.nome ?? "Escolha o cliente e adicione as peças"}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} disabled={saving} aria-label="Fechar"><X className="h-5 w-5" /></Button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-3 sm:p-5 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className={cn("min-w-0 space-y-4", etapaMobile === "revisar" && "hidden lg:block")}>
            {blocoCliente}
            {(cliente || editarPedido) && blocoCatalogo}
          </div>
          <div className={cn("min-w-0 space-y-4", etapaMobile === "montar" && "hidden lg:block")}>
            {blocoCarrinho}
            {blocoCondicoes}
          </div>
        </div>
      </div>

      {/* Barra inferior: total sempre visível */}
      <div className="shrink-0 border-t bg-card">
        <div className="max-w-7xl mx-auto p-3 sm:px-5 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground">{pecas} peça{pecas !== 1 ? "s" : ""}{subtotalBruto > subtotal ? ` · descontos ${brl(subtotalBruto - subtotal)}` : ""}{credito > 0 ? ` · crédito ${brl(credito)}` : ""}{freteNum > 0 ? ` · frete ${brl(freteNum)}` : ""}</p>
            <p className="text-xl font-bold tabular-nums leading-tight">{brl(total)}</p>
            {semPreco && <p className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />Peça sem preço — avise o financeiro</p>}
          </div>
          {etapaMobile === "montar" && (
            <Button className="lg:hidden h-12 px-6" disabled={!clienteId || !itens.length} onClick={() => setEtapaMobile("revisar")}>Revisar pedido</Button>
          )}
          <div className={cn("sm:w-72", etapaMobile === "montar" ? "hidden lg:block" : "")}>{botaoSalvar}</div>
        </div>
      </div>

      {novoCliente && (
        <ClienteModal open onClose={() => setNovoCliente(false)}
          onSuccess={c => { setClientes(p => p.some(x => x.id === c.id) ? p : [...p, c].sort((a, b) => a.nome.localeCompare(b.nome))); setClienteId(c.id); setNovoCliente(false); setTimeout(() => buscaPecaRef.current?.focus(), 100); }} />
      )}
    </div>
  );
}
