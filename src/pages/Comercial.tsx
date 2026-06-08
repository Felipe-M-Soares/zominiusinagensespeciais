/**
 * Comercial — Página exclusiva para vendedoras (e admins)
 *
 * Rota: /comercial
 * Acesso: role === "comercial" | "admin"
 *
 * Fluxo:
 *  1. Vendedora seleciona ou cadastra cliente
 *  2. Visualiza peças disponíveis na expedição
 *  3. Cria pedido (nome do cliente + lote + quantidade)
 *  4. Peças ficam reservadas no estoque
 *  5. Admin/Estoque fatura o pedido → peças saem da expedição
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { CardSkeleton } from "@/components/PageSkeleton";
import { useStock, fetchAllMovements } from "@/hooks/useStock";
import type { AllMovement } from "@/hooks/useStock";
import { useClickOutside } from "@/hooks/useClickOutside";
import { useDebounce } from "@/hooks/useDebounce";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ShoppingBag,
  UserPlus,
  User,
  Search,
  X,
  Plus,
  Trash2,
  CheckCircle2,
  PackageCheck,
  Clock,
  Package,
  Tag,
  ChevronDown,
  ChevronUp,
  FileText,
  Phone,
  Mail,
  MapPin,
  ShoppingCart,
  Receipt,
  Ban,
  Truck,
  ArrowLeft,
  LogOut,
  Boxes,
  ScanBarcode,
  LayoutDashboard,
  History,
  ArrowDownCircle,
  ArrowUpCircle,
  RefreshCw,
  Trophy,
  TrendingUp,
  Download,
  Bell,
  Minus,
  Copy,
  MessageSquare,
  Send,
  Star,
} from "lucide-react";
import { PageNav } from "@/components/PageNav";
import { SearchInputWithBarcode } from "@/components/SearchInputWithBarcode";
import { Logo } from "@/components/Logo";

import { formatLote, loteValido, displayLote } from "@/lib/lote";
import { criarPedidoComReserva } from "@/lib/pedidoUtils";
import { escHtml } from "@/lib/escHtml";


// ─── Audit log helper ─────────────────────────────────────────────────────────
async function logAudit(
  userId: string | undefined,
  userName: string | null | undefined,
  action: string,
  entityType: string,
  entityId: string,
  details?: Record<string, unknown>
) {
  try {
    await supabase.from("audit_log").insert({
      user_id: userId ?? null,
      user_name: userName ?? null,
      action,
      entity_type: entityType,
      entity_id: entityId,
      details: details ?? null,
    });
  } catch (_e) {
    // Falha silenciosa — não bloqueia ações críticas
  }
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Cliente {
  id: string;
  nome: string;
  documento: string | null;
  telefone: string | null;
  email: string | null;
  endereco: string | null;
  observacoes: string | null;
  created_at: string;
}

interface PedidoItem {
  stock_item_id: string;
  lote: string | null;
  quantidade: number;
  device_model: string;
  device_reference: string;
}

interface PedidoCompleto {
  id: string;
  cliente_id: string;
  cliente_nome: string;
  vendedora_nome: string | null;
  status: "pendente" | "separando" | "pronto" | "faturado" | "enviado" | "cancelado";
  observacoes: string | null;
  desconto_pct: number;
  prazo_entrega: string | null;
  created_at: string;
  faturado_em: string | null;
  itens: Array<{
    id: string;
    stock_item_id: string;
    lote: string | null;
    quantidade: number;
    quantidade_reservada: number;
    device_model?: string;
    device_reference?: string;
  }>;
}

// ─── Modal: Cliente ───────────────────────────────────────────────────────────

interface ClienteModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (cliente: Cliente) => void;
  inicial?: Cliente | null;
}

function ClienteModal({ open, onClose, onSuccess, inicial }: ClienteModalProps) {
  const { user } = useAuth();
  const [nome, setNome] = useState("");
  const [documento, setDocumento] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [endereco, setEndereco] = useState("");
  const [obs, setObs] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setNome(inicial?.nome ?? "");
      setDocumento(inicial?.documento ?? "");
      setTelefone(inicial?.telefone ?? "");
      setEmail(inicial?.email ?? "");
      setEndereco(inicial?.endereco ?? "");
      setObs(inicial?.observacoes ?? "");
    }
  }, [open, inicial]);

  if (!open) return null;

  async function handleSave() {
    if (!nome.trim()) { toast.error("Nome obrigatório"); return; }
    // FIX: validação de e-mail antes de persistir
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error("E-mail inválido."); return;
    }
    setSaving(true);
    try {
      // FIX: slice garante que nenhum campo ultrapasse o limite antes de chegar ao banco
      const payload = {
        nome:        nome.trim().slice(0, 200),
        documento:   documento.trim().slice(0, 20)  || null,
        telefone:    telefone.trim().slice(0, 20)   || null,
        email:       email.trim().slice(0, 200)     || null,
        endereco:    endereco.trim().slice(0, 300)  || null,
        observacoes: obs.trim().slice(0, 1000)      || null,
      };
      let data: Cliente | null = null;
      if (inicial) {
        const { data: d, error } = await supabase
          .from("clientes").update(payload).eq("id", inicial.id).select().single();
        if (error) throw error;
        data = d as Cliente;
      } else {
        const { data: d, error } = await supabase
          .from("clientes").insert({ ...payload, created_by: user?.id }).select().single();
        if (error) throw error;
        data = d as Cliente;
      }
      toast.success(inicial ? "Cliente atualizado!" : "Cliente cadastrado!");
      onSuccess(data!);
    } catch (_e) {
      toast.error("Erro ao salvar cliente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-card border border-border/30 shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/30">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-violet-500" />
            <p className="text-sm font-semibold">{inicial ? "Editar Cliente" : "Novo Cliente"}</p>
          </div>
          <button type="button" onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 space-y-3 max-h-[65vh] overflow-y-auto">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Nome *</label>
            <Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome completo ou razão social" className="h-9 text-sm" autoFocus maxLength={200} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">CPF / CNPJ</label>
              <Input value={documento} onChange={e => setDocumento(e.target.value)} placeholder="000.000.000-00" className="h-9 text-sm" maxLength={20} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Telefone</label>
              <Input value={telefone} onChange={e => setTelefone(e.target.value)} placeholder="(00) 00000-0000" className="h-9 text-sm" maxLength={20} />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">E-mail</label>
            <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="cliente@email.com" type="email" className="h-9 text-sm" maxLength={200} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Endereço</label>
            <Input value={endereco} onChange={e => setEndereco(e.target.value)} placeholder="Rua, número, cidade..." className="h-9 text-sm" maxLength={300} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Observações</label>
            <textarea value={obs} onChange={e => setObs(e.target.value)} placeholder="Informações adicionais..." className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none min-h-[60px] focus:outline-none focus:ring-2 focus:ring-ring" maxLength={1000} />
          </div>
        </div>
        <div className="flex gap-2 p-5 pt-0">
          <button type="button" onClick={onClose} disabled={saving} className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors">Cancelar</button>
          <button type="button" onClick={handleSave} disabled={saving || !nome.trim()} className="flex-1 h-9 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5">
            {saving ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {inicial ? "Salvar" : "Cadastrar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Novo Pedido ───────────────────────────────────────────────────────

// ─── Modal: Novo Pedido (simplificado — sem seleção de lote) ─────────────────

interface NovoPedidoModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  clienteFixo?: Cliente | null;
  expedicaoItems: ReturnType<typeof useStock>["items"];
  duplicarDe?: PedidoCompleto | null;
}

function NovoPedidoModal({ open, onClose, onSuccess, clienteFixo, expedicaoItems, duplicarDe }: NovoPedidoModalProps) {
  const { user } = useAuth();

  // Cliente
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [clienteId, setClienteId] = useState(clienteFixo?.id ?? "");
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
  const [desconto, setDesconto] = useState(0);
  const [itens, setItens] = useState<PedidoItem[]>([]);
  const [obs, setObs] = useState("");
  const [prazoEntrega, setPrazoEntrega] = useState("");
  const [favoritas, setFavoritas] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // Carrega favoritas do usuário atual
  useEffect(() => {
    supabase.from("peca_favoritas").select("device_id")
      .then(({ data, error }) => {
        if (error) return;
        setFavoritas(new Set((data ?? []).map((r: { device_id: string }) => r.device_id)));
      });
  }, [open]);

  async function toggleFavorita(deviceId: string) {
    const isFav = favoritas.has(deviceId);
    if (isFav) {
      await supabase.from("peca_favoritas").delete().eq("device_id", deviceId);
      setFavoritas(prev => { const n = new Set(prev); n.delete(deviceId); return n; });
    } else {
      await supabase.from("peca_favoritas").insert({ device_id: deviceId });
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
    if (duplicarDe) {
      setClienteId(duplicarDe.cliente_id);
      setClienteSearch(duplicarDe.cliente_nome);
      setDesconto(duplicarDe.desconto_pct);
      setObs(duplicarDe.observacoes ?? "");
      setItens(duplicarDe.itens.map(i => ({
        stock_item_id: i.stock_item_id,
        lote: i.lote ?? null,
        quantidade: i.quantidade,
        device_model: i.device_model ?? "",
        device_reference: i.device_reference ?? "",
      })));
    } else {
      setItens([]); setObs(""); setDesconto(0); setPrazoEntrega("");
    }
    setPecaSearch(""); setAutocomplete([]); setShowAutocomp(false);
    setSelectedPeca(null); setQtd(1);
    loadClientes();
  }, [open, clienteFixo, duplicarDe]);

  async function loadClientes() {
    const { data } = await supabase.from("clientes").select("*").order("nome");
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
    // se a peça já está no pedido, soma a quantidade em vez de criar linha duplicada.
    // Duplicatas causavam snapshot dobrado: dois pedido_itens com mesmo stock_item_id
    // → dois conjuntos de entradas de lote no snapshot → quantidades duplicadas na impressão.
    setItens(prev => {
      const idx = prev.findIndex(i => i.stock_item_id === selectedPeca!.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], quantidade: updated[idx].quantidade + qtd };
        return updated;
      }
      return [...prev, {
        stock_item_id: selectedPeca!.id,
        lote: "",
        quantidade: qtd,
        device_model: selectedPeca!.device?.model ?? "",
        device_reference: selectedPeca!.device?.reference ?? "",
      }];
    });
    setSelectedPeca(null); setPecaSearch(""); setQtd(1);
    setTimeout(() => pecaInputRef.current?.focus(), 50);
  }

  async function handleSave() {
    if (!clienteId) { toast.error("Selecione um cliente"); return; }
    if (itens.length === 0) { toast.error("Adicione ao menos uma peça"); return; }
    setSaving(true);
    try {
      const { data: profile } = await supabase.from("profiles").select("display_name").eq("user_id", user?.id).maybeSingle();
      const vendedoraNome = (profile as { display_name?: string } | null)?.display_name ?? user?.email ?? "Vendedora";
      // Cria o pedido

      // FIX: usa criarPedidoComReserva para garantir que reserve_stock
      // seja chamado e quantity_reserved seja incrementado corretamente no banco.
      // Antes: inseria pedido_itens com quantidade_reservada: 0 e nunca chamava reserve_stock.
      const result = await criarPedidoComReserva({
        clienteId,
        itens: itens.map(i => ({
          stock_item_id: i.stock_item_id,
          lote: i.lote || null,
          quantidade: i.quantidade,
          device_model: i.device_model,
        })),
        vendedoraId: user?.id,
        vendedoraNome,
        observacoes: obs || null,
        descontoPct: desconto,
        prazoEntrega: prazoEntrega || null,
      });

      if (!result.ok) {
        toast.error(result.error ?? "Erro ao criar pedido.");
        return;
      }

      toast.success("Pedido criado! O estoque irá separar os lotes.");
      onSuccess();
    } catch (_e) {
      toast.error("Erro ao criar pedido.");
    } finally {
      setSaving(false);
    }
  }

  const clientesFiltrados = clientes.filter(c => {
    const q = clienteSearch.trim().toLowerCase();
    return !q || c.nome.toLowerCase().includes(q) || (c.documento ?? "").toLowerCase().includes(q);
  });

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
              <p className="text-[13px] font-bold">Novo Pedido</p>
              <p className="text-[10px] text-muted-foreground">Preencha cliente, peças e desconto</p>
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
          </div>

          {/* ── Adicionar Peça ── */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Adicionar Peça</label>
            <div className="flex gap-2">
              <div className="relative flex-1" ref={pecaDropRef}>
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
                  <div className="absolute top-full mt-1 left-0 right-0 z-50 rounded-xl border border-border bg-card shadow-xl overflow-hidden max-h-52 overflow-y-auto">
                    {autocomplete.length === 0 ? (
                      <div className="px-4 py-3 text-center">
                        <p className="text-[12px] font-semibold text-muted-foreground">Nenhuma peça encontrada</p>
                        <p className="text-[10px] text-muted-foreground/60 mt-0.5">Verifique o nome ou o estoque disponível</p>
                      </div>
                    ) : autocomplete.map(i => (
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
                            <div className="shrink-0 text-right">
                              <span className={cn("text-[11px] font-bold px-1.5 py-0.5 rounded-lg",
                                dispRealCarrinho(i) > 0 ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400" : "bg-red-50 dark:bg-red-950/40 text-red-600")}>
                                {dispRealCarrinho(i)} un.
                              </span>
                            </div>
                          </div>
                        </button>
                        <button type="button" onClick={() => toggleFavorita(i.device_id)}
                          className="px-2 flex items-center text-muted-foreground/40 hover:text-amber-400 transition-colors"
                          title={favoritas.has(i.device_id) ? "Remover dos favoritos" : "Adicionar aos favoritos"}>
                          <Star className={cn("h-3.5 w-3.5", favoritas.has(i.device_id) && "fill-amber-400 text-amber-400")} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <input
                type="number"
                min={1}
                max={maxDisponivel || undefined}
                value={qtd}
                onChange={e => {
                  const v = Math.max(1, parseInt(e.target.value) || 1);
                  setQtd(maxDisponivel > 0 ? Math.min(v, maxDisponivel) : v);
                }}
                className="w-14 h-10 rounded-xl border border-border/50 bg-background text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30"
              />
              <button
                type="button"
                onClick={addItem}
                disabled={!selectedPeca || maxDisponivel === 0}
                className="h-10 px-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold disabled:opacity-40 transition-colors flex items-center gap-1.5"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            {selectedPeca && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-violet-500/8 border border-violet-500/20 text-[11px]">
                <Package className="h-3 w-3 text-violet-500 shrink-0" />
                <span className="text-violet-600 dark:text-violet-400 font-medium truncate">{selectedPeca.device?.model}</span>
                <span className={cn("ml-auto shrink-0 font-mono font-semibold", maxDisponivel === 0 ? "text-destructive" : "text-muted-foreground/60")}>
                  {maxDisponivel === 0 ? "sem estoque" : `máx. ${maxDisponivel} un.`}
                </span>
              </div>
            )}
          </div>

          {/* ── Lista de Itens ── */}
          {itens.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                Itens do Pedido ({itens.reduce((s, i) => s + i.quantidade, 0)} un.)
              </label>
              <div className="space-y-1">
                {itens.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/20 border border-border/30">
                    <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium truncate">{item.device_model}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{item.device_reference}</p>
                    </div>
                    <span className="text-[12px] font-bold shrink-0">{item.quantidade} un.</span>
                    <button type="button" onClick={() => setItens(prev => prev.filter((_, i) => i !== idx))} className="h-6 w-6 flex items-center justify-center rounded-lg hover:bg-destructive/15 hover:text-destructive text-muted-foreground transition-colors">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Desconto do Pedido ── */}
          <div className="space-y-2">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Desconto por Peça</label>
            <div className="flex items-center gap-2">
              <select
                value={![0,5,10,15,20,25,30,40,50].includes(desconto) && desconto > 0 ? "outro" : String(desconto)}
                onChange={e => {
                  if (e.target.value !== "outro") setDesconto(Number(e.target.value));
                }}
                className="flex-1 h-10 rounded-xl border border-border bg-background px-3 text-[13px] font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition-all [&>option]:bg-background [&>option]:text-foreground"
              >
                <option value="0">Sem desconto</option>
                <option value="5">5%</option>
                <option value="10">10%</option>
                <option value="15">15%</option>
                <option value="20">20%</option>
                <option value="25">25%</option>
                <option value="30">30%</option>
                <option value="40">40%</option>
                <option value="50">50%</option>
                <option value="outro">Outro...</option>
              </select>
              {(![0,5,10,15,20,25,30,40,50].includes(desconto) && desconto > 0) && (
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={desconto}
                  onChange={e => setDesconto(Math.min(99, Math.max(1, parseInt(e.target.value) || 1)))}
                  className="w-20 h-10 rounded-xl border border-emerald-500 bg-emerald-600 text-white text-center text-[13px] font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              )}
            </div>
            {desconto > 0 && (
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 px-1">
                <span className="h-4 w-4 rounded-full bg-emerald-500 flex items-center justify-center text-white text-[9px] font-black shrink-0">✓</span>
                {desconto}% aplicado individualmente em cada peça
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

        <div className="flex gap-2 p-5 border-t border-border/30 shrink-0">
          <button type="button" onClick={onClose} disabled={saving} className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors">Cancelar</button>
          <button type="button" onClick={handleSave} disabled={saving || !clienteId || itens.length === 0} className="flex-1 h-9 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5">
            {saving ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <ShoppingCart className="h-3.5 w-3.5" />}
            Criar Pedido
          </button>
        </div>
      </div>

      {novoClienteModal && (
        <ClienteModal open onClose={() => setNovoClienteModal(false)} onSuccess={(c) => { loadClientes(); setClienteId(c.id); setClienteSearch(c.nome); setNovoClienteModal(false); }} />
      )}
    </div>
  );
}


// ─── Card de Pedido ───────────────────────────────────────────────────────────

interface PedidoCardProps {
  pedido: PedidoCompleto;
  isAdmin: boolean;
  onFaturar: (p: PedidoCompleto) => void;
  onCancelar: (p: PedidoCompleto) => void;
  onAdicionarPeca: (p: PedidoCompleto) => void;
  onDuplicar: (p: PedidoCompleto) => void;
  onComentar: (p: PedidoCompleto) => void;
}

function PedidoCard({ pedido, isAdmin, onFaturar, onCancelar, onAdicionarPeca, onDuplicar, onComentar }: PedidoCardProps) {
  const [expanded, setExpanded] = useState(false);
  const totalItens = pedido.itens.reduce((s, i) => s + i.quantidade, 0);
  const temDesconto = pedido.desconto_pct > 0;

  const dtCriacao = new Date(pedido.created_at).toLocaleDateString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
  });
  const hrCriacao = new Date(pedido.created_at).toLocaleTimeString("pt-BR", {
    hour: "2-digit", minute: "2-digit",
  });
  const prazoFmt = pedido.prazo_entrega
    ? new Date(pedido.prazo_entrega + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" })
    : null;
  const prazoAtrasado = pedido.prazo_entrega && !(["cancelado","enviado","faturado"] as string[]).includes(pedido.status)
    && new Date(pedido.prazo_entrega) < new Date();

  // ── Paleta de status ──────────────────────────────────────────────────────
  const STATUS: Record<string, {
    accent: string;        // cor da barra lateral e badge
    badgeBg: string;       // fundo do badge
    badgeText: string;     // texto do badge
    badgeBorder: string;   // borda do badge
    label: string;
    icon: React.ReactNode;
    statusBtnBg: string;   // fundo do botão de estado
    statusBtnText: string;
    statusBtnBorder: string;
  }> = {
    pendente:  {
      accent: "#f59e0b",
      badgeBg: "bg-amber-50 dark:bg-amber-950/50",
      badgeText: "text-amber-700 dark:text-amber-300",
      badgeBorder: "border-amber-300 dark:border-amber-700",
      label: "Pendente",
      icon: <Clock className="h-3 w-3" />,
      statusBtnBg: "bg-amber-50 dark:bg-amber-950/30",
      statusBtnText: "text-amber-700 dark:text-amber-300",
      statusBtnBorder: "border-amber-200 dark:border-amber-800",
    },
    separando: {
      accent: "#3b82f6",
      badgeBg: "bg-blue-50 dark:bg-blue-950/50",
      badgeText: "text-blue-700 dark:text-blue-300",
      badgeBorder: "border-blue-300 dark:border-blue-700",
      label: "Separando",
      icon: <PackageCheck className="h-3 w-3" />,
      statusBtnBg: "bg-blue-50 dark:bg-blue-950/30",
      statusBtnText: "text-blue-700 dark:text-blue-300",
      statusBtnBorder: "border-blue-200 dark:border-blue-800",
    },
    pronto: {
      accent: "#10b981",
      badgeBg: "bg-emerald-50 dark:bg-emerald-950/50",
      badgeText: "text-emerald-700 dark:text-emerald-300",
      badgeBorder: "border-emerald-300 dark:border-emerald-700",
      label: "Pronto",
      icon: <CheckCircle2 className="h-3 w-3" />,
      statusBtnBg: "bg-emerald-50 dark:bg-emerald-950/30",
      statusBtnText: "text-emerald-700 dark:text-emerald-300",
      statusBtnBorder: "border-emerald-200 dark:border-emerald-800",
    },
    faturado: {
      accent: "#7c3aed",
      badgeBg: "bg-violet-50 dark:bg-violet-950/50",
      badgeText: "text-violet-700 dark:text-violet-300",
      badgeBorder: "border-violet-300 dark:border-violet-700",
      label: "Faturado",
      icon: <CheckCircle2 className="h-3 w-3" />,
      statusBtnBg: "bg-violet-50 dark:bg-violet-950/30",
      statusBtnText: "text-violet-700 dark:text-violet-300",
      statusBtnBorder: "border-violet-200 dark:border-violet-800",
    },
    enviado: {
      accent: "#14b8a6",
      badgeBg: "bg-teal-50 dark:bg-teal-950/50",
      badgeText: "text-teal-700 dark:text-teal-300",
      badgeBorder: "border-teal-300 dark:border-teal-700",
      label: "Enviado",
      icon: <Truck className="h-3 w-3" />,
      statusBtnBg: "bg-teal-50 dark:bg-teal-950/30",
      statusBtnText: "text-teal-700 dark:text-teal-300",
      statusBtnBorder: "border-teal-200 dark:border-teal-800",
    },
    cancelado: {
      accent: "#94a3b8",
      badgeBg: "bg-muted/40",
      badgeText: "text-muted-foreground",
      badgeBorder: "border-border",
      label: "Cancelado",
      icon: <Ban className="h-3 w-3" />,
      statusBtnBg: "bg-muted/30",
      statusBtnText: "text-muted-foreground",
      statusBtnBorder: "border-border",
    },
  };

  const s = STATUS[pedido.status] ?? STATUS["cancelado"];

  return (
    <div
      className="rounded-2xl bg-card overflow-hidden transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5"
      style={{
        border: "1px solid hsl(var(--border) / 0.5)",
        boxShadow: "0 1px 3px hsl(var(--border) / 0.2), 0 6px 16px -4px hsl(var(--border) / 0.12)",
      }}
    >
      {/* Barra lateral colorida por status */}
      <div className="flex">
        <div className="w-1 shrink-0 rounded-l-2xl" style={{ background: s.accent }} />

        <div className="flex-1 min-w-0 p-4 space-y-3">

          {/* ── Linha 1: Avatar cliente + nome + badge status ── */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              {/* Avatar com inicial */}
              <div
                className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0 text-white text-[13px] font-black"
                style={{ background: `linear-gradient(135deg, ${s.accent}cc, ${s.accent})` }}
              >
                {pedido.cliente_nome.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <h3 className="text-[14px] font-bold text-foreground leading-tight truncate">
                  {pedido.cliente_nome}
                </h3>
                {pedido.vendedora_nome && (
                  <p className="text-[10px] text-muted-foreground/70 leading-tight truncate">
                    por {pedido.vendedora_nome}
                  </p>
                )}
              </div>
            </div>

            {/* Badge status */}
            <span className={cn(
              "shrink-0 flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full border",
              s.badgeBg, s.badgeText, s.badgeBorder
            )}>
              {s.icon}
              {s.label}
            </span>
          </div>

          {/* ── Linha 2: Métricas (peças + desconto + data) ── */}
          <div className="flex items-center gap-2">
            {/* Qtd de peças */}
            <div className="flex-1 flex items-center gap-2 rounded-xl px-3 py-2 bg-muted/25 border border-border/50">
              <ShoppingBag className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-muted-foreground leading-none mb-0.5">
                  {pedido.itens.length} tipo{pedido.itens.length !== 1 ? "s" : ""}
                </p>
                <p className="text-[16px] font-black text-foreground leading-none tabular-nums">
                  {totalItens}
                  <span className="text-[10px] font-semibold text-muted-foreground ml-1">un.</span>
                </p>
              </div>
            </div>

            {/* Desconto — destaque se tiver */}
            {temDesconto ? (
              <div className="flex flex-col items-center justify-center rounded-xl px-3 py-2 border min-w-[54px]"
                style={{
                  background: "linear-gradient(135deg, #d1fae5, #a7f3d0)",
                  borderColor: "#6ee7b7",
                }}>
                <span className="text-[17px] font-black text-emerald-800 leading-none tabular-nums">
                  {pedido.desconto_pct}%
                </span>
                <span className="text-[8px] font-bold text-emerald-700 uppercase tracking-widest leading-none mt-0.5">
                  desc.
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-center rounded-xl px-3 py-2 bg-muted/20 border border-border/40 min-w-[54px]">
                <span className="text-[10px] font-medium text-muted-foreground/50">Sem desc.</span>
              </div>
            )}
          </div>

          {/* ── Linha 3: Data/hora ── */}
          <div className="flex items-center gap-1.5">
            <Clock className="h-2.5 w-2.5 text-muted-foreground/50 shrink-0" />
            <span className="text-[10px] text-muted-foreground/60">
              {dtCriacao} às {hrCriacao}
            </span>
            {prazoFmt && (
              <span className={cn(
                "text-[10px] font-semibold px-1.5 py-0.5 rounded-md border",
                prazoAtrasado
                  ? "bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800"
                  : "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800"
              )}>
                prazo: {prazoFmt}
              </span>
            )}
          </div>

          {/* ── Itens expandidos ── */}
          {expanded && (
            <div className="space-y-1.5 pt-1 border-t border-border/40">
              {pedido.itens.map((it, idx) => (
                <div key={it.id}
                  className="flex items-center gap-2.5 rounded-xl px-3 py-2 bg-muted/20 border border-border/40 group"
                >
                  <div
                    className="h-6 w-6 rounded-lg flex items-center justify-center shrink-0 text-[9px] font-black text-white"
                    style={{ background: s.accent + "cc" }}
                  >
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-foreground truncate leading-tight">
                      {it.device_model}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {displayLote(it.lote) && (
                        <span className="text-[9px] font-mono text-muted-foreground/60 bg-muted/40 rounded px-1">
                          {displayLote(it.lote)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="text-[13px] font-black tabular-nums" style={{ color: s.accent }}>
                      {it.quantidade}
                    </span>
                    <span className="text-[10px] text-muted-foreground ml-0.5">un.</span>
                  </div>
                </div>
              ))}
              {pedido.observacoes && (
                <div className="flex items-start gap-2 px-2 pt-1 pb-0.5">
                  <FileText className="h-3 w-3 mt-0.5 text-muted-foreground/50 shrink-0" />
                  <span className="text-[11px] text-muted-foreground/80 italic leading-relaxed">
                    {pedido.observacoes}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── Botão expandir ── */}
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="w-full flex items-center justify-center gap-1.5 h-7 rounded-xl text-[11px] font-semibold text-muted-foreground hover:bg-muted/40 transition-colors border border-border/40"
          >
            {expanded
              ? <><ChevronUp className="h-3 w-3" />Ocultar peças</>
              : <><ChevronDown className="h-3 w-3" />Ver {pedido.itens.length} peça{pedido.itens.length !== 1 ? "s" : ""}</>}
          </button>

          {/* ── Ações rápidas: comentar e duplicar ── */}
          <div className="flex gap-2">
            <button type="button" onClick={() => onComentar(pedido)}
              className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-xl text-[11px] font-medium text-muted-foreground hover:bg-muted/40 border border-border/40 transition-colors">
              <MessageSquare className="h-3 w-3" /> Comentários
            </button>
            <button type="button" onClick={() => onDuplicar(pedido)}
              className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-xl text-[11px] font-medium text-muted-foreground hover:bg-muted/40 border border-border/40 transition-colors">
              <Copy className="h-3 w-3" /> Duplicar
            </button>
          </div>

          {/* ── Botão adicionar peça (só pendente) ── */}
          {pedido.status === "pendente" && (
            <button
              type="button"
              onClick={() => onAdicionarPeca(pedido)}
              className="w-full flex items-center justify-center gap-1.5 h-8 rounded-xl text-[11px] font-semibold transition-colors"
              style={{
                background: "#ede9fe",
                color: "#6d28d9",
                border: "1px solid #c4b5fd",
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Adicionar peça
            </button>
          )}

          {/* ── Ações Admin (confirmar / cancelar) ── */}
          {pedido.status === "pendente" && isAdmin && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onFaturar(pedido)}
                className="flex-1 h-9 rounded-xl text-white text-[12px] font-bold transition-all flex items-center justify-center gap-1.5 active:scale-95"
                style={{
                  background: "linear-gradient(135deg, #7c3aed, #6d28d9)",
                  boxShadow: "0 2px 8px rgba(124,58,237,0.35)",
                }}
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Confirmar Pedido
              </button>
              <button
                type="button"
                onClick={() => onCancelar(pedido)}
                className="h-9 w-9 flex items-center justify-center rounded-xl text-muted-foreground hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-500 transition-colors border border-border"
                title="Cancelar pedido"
              >
                <Ban className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* ── Indicadores de estado (sem ação) ── */}
          {(["separando","pronto","faturado","enviado","cancelado"] as const).includes(
            pedido.status as "separando"|"pronto"|"faturado"|"enviado"|"cancelado"
          ) && (
            <div className={cn(
              "flex items-center justify-center gap-1.5 h-9 rounded-xl text-[11px] font-bold border",
              s.statusBtnBg, s.statusBtnText, s.statusBtnBorder
            )}>
              {pedido.status === "separando" && <><PackageCheck className="h-3.5 w-3.5" />Estoque sendo separado...</>}
              {pedido.status === "pronto"    && <><CheckCircle2 className="h-3.5 w-3.5" />Pronto — aguardando NF</>}
              {pedido.status === "faturado"  && <><CheckCircle2 className="h-3.5 w-3.5" />Nota fiscal emitida</>}
              {pedido.status === "enviado"   && <><Truck className="h-3.5 w-3.5" />Enviado ao cliente! 🎉</>}
              {pedido.status === "cancelado" && <><Ban className="h-3.5 w-3.5" />Pedido cancelado</>}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ─── Modal: Adicionar Peça ao Pedido Pendente ─────────────────────────────────

interface AdicionarPecaModalProps {
  pedido: PedidoCompleto | null;
  expedicaoItems: ReturnType<typeof useStock>["items"];
  onClose: () => void;
  onSuccess: () => void;
}

function AdicionarPecaModal({ pedido, expedicaoItems, onClose, onSuccess }: AdicionarPecaModalProps) {
  const [search, setSearch] = useState("");
  const [autocomplete, setAutocomplete] = useState<ReturnType<typeof useStock>["items"]>([]);
  const [showAutocomp, setShowAutocomp] = useState(false);
  const [selectedPeca, setSelectedPeca] = useState<ReturnType<typeof useStock>["items"][0] | null>(null);
  const [qtd, setQtd] = useState(1);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (pedido) { setSearch(""); setSelectedPeca(null); setQtd(1); setTimeout(() => inputRef.current?.focus(), 100); }
  }, [pedido]);

  // FIX: useClickOutside substitui document.addEventListener duplicado
  useClickOutside(dropRef, () => setShowAutocomp(false));

  // Calcula quantas unidades de cada stock_item já estão no pedido atual (ainda não reservadas)
  const jaNosPedido = (pedido?.itens ?? []).reduce<Record<string, number>>((acc, it) => {
    acc[it.stock_item_id] = (acc[it.stock_item_id] ?? 0) + it.quantidade;
    return acc;
  }, {});

  // Retorna o disponível real descontando o que já está no pedido pendente
  function dispReal(item: ReturnType<typeof useStock>["items"][0]) {
    const bruto = Math.max(0, item.quantity_available);
    const jaAdicionado = jaNosPedido[item.id] ?? 0;
    return Math.max(0, bruto - jaAdicionado);
  }

  // FIX: useDebounce substitui debounceRef inline
  const debouncedInput = useDebounce((v: string) => {
    const q = v.trim().toLowerCase();
    const vistos = new Set<string>();
    const deduped = expedicaoItems.filter(i => {
      if (!i.device?.model?.toLowerCase().includes(q) && q) return false;
      if (vistos.has(i.device_id)) return false;
      if (dispReal(i) <= 0) return false;
      vistos.add(i.device_id); return true;
    }).slice(0, 15);
    setAutocomplete(deduped); setShowAutocomp(deduped.length > 0);
  }, 80);

  function handleInput(v: string) {
    setSearch(v); setSelectedPeca(null);
    debouncedInput(v);
  }

  function handleFocus() {
    const vistos = new Set<string>();
    const deduped = expedicaoItems.filter(i => {
      if (vistos.has(i.device_id)) return false;
      if (dispReal(i) <= 0) return false; // oculta peças sem saldo real disponível
      vistos.add(i.device_id); return true;
    }).slice(0, 15);
    setAutocomplete(deduped); setShowAutocomp(deduped.length > 0);
  }

  // Disponível real = bruto da expedição − já no pedido pendente
  const maxDisponivel = selectedPeca ? dispReal(selectedPeca) : 0;

  async function handleAdd() {
    if (!pedido || !selectedPeca) return;
    if (qtd < 1 || qtd > maxDisponivel) { toast.error(`Disponível: ${maxDisponivel} un.`); return; }
    setSaving(true);
    const { error } = await supabase.from("pedido_itens").insert({
      pedido_id: pedido.id,
      stock_item_id: selectedPeca.id,
      lote: null,
      quantidade: qtd,
      quantidade_reservada: qtd,
    });
    if (error) { setSaving(false); toast.error("Erro ao adicionar peça."); return; }

    // FIX: chama reserve_stock para incrementar quantity_reserved no banco.
    // Antes: inseria com quantidade_reservada: 0 e nunca chamava reserve_stock.
    const { data: reserved, error: reserveErr } = await supabase.rpc("reserve_stock", {
      p_item_id: selectedPeca.id,
      p_qty: qtd,
    });
    const result = reserved as { ok?: boolean; error?: string } | null;
    if (reserveErr || result?.ok === false) {
      toast.error(result?.error ?? "Estoque insuficiente.");
      setSaving(false);
      return;
    }

    setSaving(false);
    toast.success(`${selectedPeca.device?.model} adicionada ao pedido!`);
    onSuccess();
    onClose();
  }

  if (!pedido) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-card border border-border/30 shadow-2xl flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-200" style={{ minHeight: 480 }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/30 shrink-0">
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-violet-500" />
            <p className="text-sm font-semibold">Adicionar Peça</p>
          </div>
          <button type="button" onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 flex-1 flex flex-col">
          {/* Info */}
          <div className="rounded-xl bg-violet-500/8 border border-violet-500/20 px-3 py-2.5 text-[12px] text-violet-700 dark:text-violet-400">
            Pedido de <strong>{pedido.cliente_nome}</strong> — ainda pendente, pode adicionar peças
          </div>

          {/* Busca com autocomplete — lista inline, não dropdown flutuante */}
          <div className="flex flex-col flex-1" ref={dropRef}>
            <div className="relative">
              <SearchInputWithBarcode
                value={search}
                onChange={v => handleInput(v)}
                onSearch={v => { handleInput(v); }}
                placeholder="Buscar peça por modelo ou bipe o código..."
                height="h-11"
                inputClass="bg-muted/20 text-[13px]"
              />
            </div>

            {/* Lista de resultados inline — sempre visível */}
            {showAutocomp && autocomplete.length > 0 && !selectedPeca && (
              <div className="mt-2 rounded-xl border border-border/30 bg-muted/10 overflow-hidden flex-1" style={{ maxHeight: 260, overflowY: 'auto' }}>
                {autocomplete.map((item, idx) => (
                  <button
                    key={item.id}
                    type="button"
                    onMouseDown={e => { e.preventDefault(); setSelectedPeca(item); setSearch(item.device?.model ?? ""); setShowAutocomp(false); setQtd(1); }}
                    className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-violet-500/8 text-left transition-colors ${idx > 0 ? 'border-t border-border/20' : ''}`}
                  >
                    <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium">{item.device?.model}</p>
                      <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{item.device?.reference}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[13px] font-bold text-emerald-500">{dispReal(item)}</p>
                      <p className="text-[10px] text-muted-foreground">disp.</p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Peça selecionada + quantidade */}
            {selectedPeca && (
              <div className="mt-3 rounded-xl border border-violet-500/25 bg-violet-500/5 px-4 py-4 space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-semibold">{selectedPeca.device?.model}</p>
                    <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{selectedPeca.device?.reference}</p>
                    <p className="text-[11px] text-emerald-500 mt-1 font-medium">
                      {maxDisponivel} disponíveis na expedição
                      {(jaNosPedido[selectedPeca!.id] ?? 0) > 0 && <span className="text-muted-foreground font-normal"> · {jaNosPedido[selectedPeca!.id]} já no pedido</span>}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setSelectedPeca(null); setSearch(""); setTimeout(() => inputRef.current?.focus(), 50); }}
                    className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2 shrink-0 mt-0.5"
                  >
                    trocar
                  </button>
                </div>
                <div className="flex items-center justify-center gap-5">
                  <button type="button" onClick={() => setQtd(q => Math.max(1, q - 1))} className="h-11 w-11 rounded-xl bg-muted/40 hover:bg-muted/70 flex items-center justify-center transition-colors text-lg font-bold">
                    <Minus className="h-5 w-5" />
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={maxDisponivel}
                    value={qtd}
                    onChange={e => setQtd(Math.max(1, Math.min(maxDisponivel, parseInt(e.target.value) || 1)))}
                    className="w-20 text-center text-[22px] font-bold bg-transparent border border-border/40 rounded-xl h-12 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                  />
                  <button type="button" onClick={() => setQtd(q => Math.min(maxDisponivel, q + 1))} className="h-11 w-11 rounded-xl bg-muted/40 hover:bg-muted/70 flex items-center justify-center transition-colors">
                    <Plus className="h-5 w-5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-3 shrink-0 border-t border-border/20 flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 h-11 rounded-xl border border-border/30 text-[13px] font-medium text-muted-foreground hover:bg-muted/30 transition-colors">
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!selectedPeca || saving}
            className="flex-1 h-11 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[13px] font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-2"
          >
            {saving ? <div className="h-4 w-4 border-2 border-white/60 border-t-transparent rounded-full animate-spin" /> : <Plus className="h-4 w-4" />}
            Adicionar ao Pedido
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Confirmar Pedido ──────────────────────────────────────────────────

interface FaturarModalProps {
  pedido: PedidoCompleto | null;
  onClose: () => void;
  onSuccess: () => void;
}

function FaturarModal({ pedido, onClose, onSuccess }: FaturarModalProps) {
  const [saving, setSaving] = useState(false);

  if (!pedido) return null;

  async function handleConfirmar() {
    if (!pedido) return;
    setSaving(true);
    try {
      // Apenas muda o status — a reserva já foi feita quando o pedido foi criado.
      // Chamar reserve_stock aqui causaria reserva dupla, inflando quantity_reserved
      // e fazendo quantity_available ficar negativo ou zerar todo o estoque ao marcar pronto.
      const { error } = await supabase
        .from("pedidos_comerciais")
        .update({ status: "separando" })
        .eq("id", pedido.id);
      if (error) throw error;

      toast.success("Pedido confirmado! Encaminhado para separação.");
      onSuccess();
    } catch (_e) {
      toast.error("Erro ao confirmar pedido.");
    } finally {
      setSaving(false);
    }
  }

  const total = pedido.itens.reduce((s, i) => s + i.quantidade, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-card border border-border/30 p-5 space-y-4 shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-200">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl bg-violet-500/10 flex items-center justify-center shrink-0">
            <CheckCircle2 className="h-4 w-4 text-violet-500" />
          </div>
          <div>
            <p className="text-sm font-semibold">Confirmar Pedido?</p>
            <p className="text-[12px] text-muted-foreground mt-0.5">{pedido.cliente_nome}</p>
          </div>
        </div>
        <div className="rounded-xl bg-muted/20 border border-border/30 px-3 py-2.5 space-y-1">
          <p className="text-[12px] text-muted-foreground">
            <strong className="text-foreground">{total} unidade{total !== 1 ? "s" : ""}</strong> serão encaminhadas ao estoque para separação.
          </p>
          <p className="text-[11px] text-muted-foreground/70">As peças já estão reservadas. O estoque irá separar os lotes e confirmar o envio.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors">Cancelar</button>
          <button type="button" onClick={handleConfirmar} disabled={saving} className="flex-1 h-9 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-500 transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5">
            {saving ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Confirmar Pedido
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Card de Cliente ──────────────────────────────────────────────────────────

interface ClienteCardProps {
  cliente: Cliente;
  isAdmin: boolean;
  onPedido: (c: Cliente) => void;
  onEditar: (c: Cliente) => void;
  onExcluir: (c: Cliente) => void;
  onHistorico?: (c: Cliente) => void;
}

function ClienteCard({ cliente: c, isAdmin, onPedido, onEditar, onExcluir, onHistorico }: ClienteCardProps) {
  return (
    <div className="group relative rounded-2xl bg-card overflow-hidden transition-all duration-300 hover:-translate-y-0.5" style={{ boxShadow: "0 1px 2px hsl(var(--border) / 0.3), 0 4px 12px -2px hsl(var(--border) / 0.15), inset 0 1px 0 hsl(0 0% 100% / 0.06)" }}>
      <div className="h-0.5 bg-gradient-to-r from-transparent via-violet-500 to-transparent opacity-50 group-hover:opacity-100 transition-opacity" />
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold truncate">{c.nome}</h3>
            {c.documento && <p className="text-[11px] text-muted-foreground/70 font-mono">{c.documento}</p>}
          </div>
          <div className="h-8 w-8 rounded-full bg-violet-500/10 flex items-center justify-center shrink-0">
            <User className="h-4 w-4 text-violet-500" />
          </div>
        </div>
        <div className="space-y-1">
          {c.telefone && <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70"><Phone className="h-3 w-3" /><span>{c.telefone}</span></div>}
          {c.email && <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70"><Mail className="h-3 w-3" /><span className="truncate">{c.email}</span></div>}
          {c.endereco && <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70"><MapPin className="h-3 w-3 shrink-0" /><span className="truncate">{c.endereco}</span></div>}
        </div>
        <div className="flex gap-1.5 pt-1 border-t border-border/20">
          <button type="button" onClick={() => onPedido(c)} className="flex-1 h-7 flex items-center justify-center gap-1 rounded-lg bg-violet-500/10 hover:bg-violet-500/20 text-violet-600 dark:text-violet-400 text-[10px] font-medium transition-colors">
            <ShoppingCart className="h-3 w-3" /> Pedido
          </button>
          <button type="button" onClick={() => onHistorico && onHistorico(c)} className="h-7 w-7 flex items-center justify-center rounded-lg bg-muted/30 hover:bg-muted/60 text-muted-foreground transition-colors" title="Histórico de compras">
            <History className="h-3 w-3" />
          </button>
          <button type="button" onClick={() => onEditar(c)} className="h-7 flex items-center justify-center px-2 rounded-lg bg-muted/30 hover:bg-muted/60 text-muted-foreground text-[10px] transition-colors">
            Editar
          </button>
          {isAdmin && (
            <button type="button" onClick={() => onExcluir(c)} className="h-7 w-7 flex items-center justify-center rounded-lg bg-muted/30 hover:bg-destructive/15 hover:text-destructive text-muted-foreground transition-colors">
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Histórico de compras do cliente ─────────────────────────────────────────

function HistoricoClienteModal({ clienteId, clientes, onClose }: {
  clienteId: string | null;
  clientes: Cliente[];
  onClose: () => void;
}) {
  const [pedidos, setPedidos] = useState<{ id: string; status: string; created_at: string; itens: { device_model?: string; quantidade: number }[] }[]>([]);
  const [loading, setLoading] = useState(false);
  const cliente = clientes.find(c => c.id === clienteId);

  useEffect(() => {
    if (!clienteId) return;
    setLoading(true);
    supabase
      .from("pedidos_comerciais")
      .select("id, status, created_at, pedido_itens(quantidade, stock_items(devices(model)))")
      .eq("cliente_id", clienteId)
      .order("created_at", { ascending: false })
      .limit(30)
      .then(({ data }) => {
        setPedidos((data ?? []).map((p: Record<string, unknown>) => ({
          id: p.id as string,
          status: p.status as string,
          created_at: p.created_at as string,
          itens: ((p.pedido_itens as Record<string,unknown>[]) ?? []).map((i: Record<string,unknown>) => ({
            device_model: ((i.stock_items as { devices?: { model?: string } } | null)?.devices?.model),
            quantidade: i.quantidade as number,
          })),
        })));
        setLoading(false);
      });
  }, [clienteId]);

  if (!clienteId) return null;

  const statusColors: Record<string, string> = {
    pendente: "bg-amber-500/10 text-amber-600",
    separando: "bg-blue-500/10 text-blue-600",
    pronto: "bg-emerald-500/10 text-emerald-600",
    faturado: "bg-violet-500/10 text-violet-600",
    enviado: "bg-green-500/10 text-green-600",
    cancelado: "bg-muted/30 text-muted-foreground",
  };
  const statusLabels: Record<string, string> = {
    pendente: "Pendente", separando: "Separando", pronto: "Pronto",
    faturado: "Faturado", enviado: "Enviado", cancelado: "Cancelado",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-card border border-border/30 shadow-xl overflow-hidden flex flex-col max-h-[90vh] sm:max-h-[85vh] animate-in fade-in slide-in-from-bottom-4 duration-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/20 shrink-0">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-violet-500" />
            <div>
              <p className="text-sm font-semibold">Histórico de Compras</p>
              <p className="text-[11px] text-muted-foreground">{cliente?.nome ?? "Cliente"}</p>
            </div>
          </div>
          <button type="button" onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading && <div className="flex items-center justify-center py-10"><div className="h-5 w-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>}
          {!loading && pedidos.length === 0 && (
            <div className="text-center py-10 text-sm text-muted-foreground">Nenhum pedido encontrado</div>
          )}
          {!loading && pedidos.map(p => {
            const totalItens = p.itens.reduce((s, i) => s + i.quantidade, 0);
            return (
              <div key={p.id} className="rounded-xl border border-border/20 bg-background/50 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground/70">
                    {new Date(p.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                  </span>
                  <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full", statusColors[p.status] ?? "bg-muted/20 text-muted-foreground")}>
                    {statusLabels[p.status] ?? p.status}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {p.itens.slice(0, 3).map((i, idx) => (
                    <div key={idx} className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground truncate">{i.device_model ?? "—"}</span>
                      <span className="font-semibold shrink-0 ml-2">{i.quantidade} un.</span>
                    </div>
                  ))}
                  {p.itens.length > 3 && <p className="text-[10px] text-muted-foreground/50">+{p.itens.length - 3} itens · {totalItens} un. total</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Comentários internos do pedido ──────────────────────────────────────────

interface Comentario {
  id: string;
  user_name: string;
  texto: string;
  created_at: string;
}

function ComentariosModal({ pedidoId, onClose }: { pedidoId: string | null; onClose: () => void }) {
  const { user } = useAuth();
  const [comentarios, setComentarios] = useState<Comentario[]>([]);
  const [texto, setTexto] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pedidoId) return;
    setLoading(true);
    supabase
      .from("pedido_comentarios")
      .select("id, user_name, texto, created_at")
      .eq("pedido_id", pedidoId)
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (!error) setComentarios((data ?? []) as Comentario[]);
        setLoading(false);
      });
  }, [pedidoId]);

  if (!pedidoId) return null;

  async function handleEnviar() {
    if (!texto.trim() || saving) return;
    setSaving(true);
    const { data: profile } = await supabase
      .from("profiles").select("display_name").eq("user_id", user?.id).maybeSingle();
    const userName = (profile as { display_name?: string } | null)?.display_name ?? user?.email ?? "Usuário";
    const { data, error } = await supabase.from("pedido_comentarios").insert({
      pedido_id: pedidoId,
      user_id: user?.id ?? null,
      user_name: userName,
      texto: texto.trim().slice(0, 2000),
    }).select("id, user_name, texto, created_at").single();
    setSaving(false);
    if (error) { toast.error("Erro ao enviar comentário."); return; }
    setComentarios(prev => [...prev, data as Comentario]);
    setTexto("");
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-card border border-border/30 shadow-xl flex flex-col max-h-[75vh] animate-in fade-in slide-in-from-bottom-4 duration-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/20 shrink-0">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-violet-500" />
            <p className="text-sm font-semibold">Comentários internos</p>
          </div>
          <button type="button" onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {loading && <div className="flex justify-center py-6"><div className="h-5 w-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>}
          {!loading && comentarios.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">Nenhum comentário ainda.</p>
          )}
          {comentarios.map(cm => (
            <div key={cm.id} className={cn(
              "rounded-xl px-3 py-2 max-w-[88%] text-[12px]",
              cm.user_name === user?.email
                ? "ml-auto bg-violet-500/10 border border-violet-500/20 text-violet-700 dark:text-violet-300"
                : "bg-muted/30 border border-border/20 text-foreground"
            )}>
              <p className="font-semibold text-[10px] text-muted-foreground mb-0.5">{cm.user_name}</p>
              <p className="leading-relaxed whitespace-pre-wrap">{cm.texto}</p>
              <p className="text-[9px] text-muted-foreground/60 mt-1 text-right">
                {new Date(cm.created_at).toLocaleString("pt-BR", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" })}
              </p>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <div className="flex gap-2 px-4 py-3 border-t border-border/20 shrink-0">
          <input type="text" value={texto} onChange={e => setTexto(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleEnviar(); } }}
            placeholder="Escreva um comentário..." maxLength={2000}
            className="flex-1 h-9 rounded-xl border border-border/50 bg-background text-[12px] px-3 focus:outline-none focus:ring-2 focus:ring-violet-500/30" />
          <button type="button" onClick={handleEnviar} disabled={!texto.trim() || saving}
            className="h-9 w-9 flex items-center justify-center rounded-xl bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-40">
            {saving ? <div className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Notificações Bell ───────────────────────────────────────────────────────

function NotificacoesBell({ userId }: { userId: string }) {
  const [notifs, setNotifs] = useState<{ id: string; titulo: string; mensagem: string | null; lida: boolean; created_at: string }[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("notificacoes")
      .select("id, titulo, mensagem, lida, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);
    setNotifs((data as typeof notifs) ?? []);
  }, [userId]);

  useEffect(() => { if (userId) load(); }, [load, userId]);

  // Realtime subscription — recebe notificação instantaneamente e mostra toast
  useEffect(() => {
    const channel = supabase
      .channel(`notif-${userId}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "notificacoes",
        filter: `user_id=eq.${userId}`
      }, (payload) => {
        const row = payload.new as { titulo?: string; mensagem?: string | null };
        load();
        toast(row.titulo ?? "Nova notificação", {
          description: row.mensagem ?? undefined,
          duration: 5000,
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, load]);

  // FIX: useClickOutside substitui document.addEventListener duplicado
  useClickOutside(ref, () => setOpen(false));

  async function marcarLidas() {
    const ids = notifs.filter(n => !n.lida).map(n => n.id);
    if (ids.length === 0) return;
    await supabase.from("notificacoes").update({ lida: true }).in("id", ids);
    setNotifs(prev => prev.map(n => ({ ...n, lida: true })));
  }

  const naoLidas = notifs.filter(n => !n.lida).length;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => { setOpen(v => !v); if (!open) marcarLidas(); }}
        className="relative h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors"
      >
        <Bell className="h-4 w-4" />
        {naoLidas > 0 && (
          <span className="absolute top-1 right-1 h-2.5 w-2.5 rounded-full bg-violet-500 border-2 border-background" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 rounded-2xl border border-border bg-card shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between">
            <span className="text-[12px] font-semibold">Notificações</span>
            {naoLidas > 0 && <span className="text-[10px] text-violet-500">{naoLidas} nova{naoLidas > 1 ? "s" : ""}</span>}
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-border/20">
            {notifs.length === 0 ? (
              <div className="py-8 text-center text-[12px] text-muted-foreground">Nenhuma notificação</div>
            ) : notifs.map(n => (
              <div key={n.id} className={cn("px-4 py-3 transition-colors", n.lida ? "" : "bg-violet-500/5")}>
                <div className="flex items-start gap-2">
                  {!n.lida && <span className="h-1.5 w-1.5 rounded-full bg-violet-500 shrink-0 mt-1.5" />}
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold">{n.titulo}</p>
                    {n.mensagem && <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{n.mensagem}</p>}
                    <p className="text-[10px] text-muted-foreground/50 mt-1">{new Date(n.created_at).toLocaleDateString("pt-BR")}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Histórico Geral Comercial ────────────────────────────────────────────────

interface HistoricoGeralProps {
  open: boolean;
  onClose: () => void;
}

function HistoricoGeralModal({ open, onClose }: HistoricoGeralProps) {
  const [movements, setMovements] = useState<AllMovement[]>([]);
  const [loading, setLoading] = useState(false);

  // Reasons que NÃO pertencem ao comercial (são do estoque interno)
  const INTERNAL_REASONS = [
    "Retrabalho concluído — recebido do Retrabalho",
    "Retrabalho concluído — enviado para Expedição",
    "Enviado para Retrabalho",
    "Recebido de Intermediário",
    "Rollback — falha ao criar item de retrabalho",
    "Rollback — falha ao criar item de expedição",
    "Rollback — falha ao registrar entrada na expedição",
    "Retirada",
  ];

  const isComercialMovement = useCallback((m: AllMovement) => {
    // Aceita expedicao ou fase não definida (item pode ter sido movido/deletado após)
    if (m.fase && m.fase !== "expedicao") return false;
    if (!m.reason) return false;
    if (INTERNAL_REASONS.some(r => m.reason?.startsWith(r))) return false;
    return true;
  // INTERNAL_REASONS is a static constant — safe to omit
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (open) {
      setLoading(true);
      // Filtra direto no banco por fase=expedicao para não depender do join
      fetchAllMovements(200, "expedicao").then((data) => {
        if (!cancelled) {
          setMovements(data.filter(isComercialMovement));
          setLoading(false);
        }
      }).catch(() => { if (!cancelled) setLoading(false); });
    } else {
      setMovements([]);
    }
    return () => { cancelled = true; };
  }, [open, isComercialMovement]);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchAllMovements(200, "expedicao");
      setMovements(data.filter(isComercialMovement));
    } catch (_e) {
      toast.error("Erro ao carregar histórico.");
    } finally {
      setLoading(false);
    }
  }

  function fmtDate(iso: string) {
    const d = new Date(iso);
    return {
      date: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }),
      time: d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    };
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-card border border-border/30 shadow-xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in slide-in-from-bottom-4 duration-200">
        {/* Header */}
        <div className="relative px-5 pt-5 pb-3 shrink-0">
          <div className="absolute inset-0 bg-gradient-to-b from-violet-500/5 to-transparent" />
          <div className="relative flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-violet-500" />
                <p className="text-sm font-semibold">Histórico Geral — Comercial</p>
              </div>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                Últimas movimentações do comercial (agrupadas por pedido)
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={load}
                disabled={loading}
                className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors"
                title="Atualizar"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="px-3 pb-4 overflow-y-auto flex-1 space-y-1">
          {loading && (
            <div className="flex items-center justify-center py-10">
              <div className="animate-spin h-5 w-5 border-2 border-violet-500 border-t-transparent rounded-full" />
            </div>
          )}
          {!loading && movements.length === 0 && (
            <div className="text-center py-12 text-sm text-muted-foreground">
              Nenhuma movimentação registrada no comercial
            </div>
          )}
          {!loading && (() => {
            // Agrupa movimentos pelo mesmo pedido (mesmo device + reason + usuário + data)
            // para não repetir uma linha por lote — mostra só nome da peça e total
            const grouped = new Map<string, {
              key: string;
              device_model: string;
              device_reference: string;
              type: string;
              quantity: number;
              user_display_name: string | null;
              created_at: string;
            }>();

            for (const mv of movements) {
              // Extrai cliente do reason (ex: "Pedido comercial — cliente: felipe (lote: ...)")
              const clienteMatch = mv.reason?.match(/cliente:\s*([^(]+)/i);
              const clienteNome = clienteMatch ? clienteMatch[1].trim() : (mv.reason ?? "");
              const key = `${mv.device_model}||${mv.type}||${clienteNome}||${mv.user_display_name}||${mv.created_at.slice(0, 16)}`;
              if (grouped.has(key)) {
                grouped.get(key)!.quantity += mv.quantity;
              } else {
                grouped.set(key, {
                  key,
                  device_model: mv.device_model ?? "",
                  device_reference: mv.device_reference ?? "",
                  type: mv.type,
                  quantity: mv.quantity,
                  user_display_name: mv.user_display_name ?? null,
                  created_at: mv.created_at,
                });
              }
            }

            return [...grouped.values()].map((g) => {
              const { date, time } = fmtDate(g.created_at);
              const isEntrada = g.type === "entrada";
              return (
                <div
                  key={g.key}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors",
                    isEntrada ? "bg-success/4 border-success/15" : "bg-violet-500/4 border-violet-500/15"
                  )}
                >
                  {isEntrada
                    ? <ArrowDownCircle className="h-4 w-4 text-success shrink-0" />
                    : <ArrowUpCircle className="h-4 w-4 text-violet-500 shrink-0" />}
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-[12px] font-semibold text-foreground leading-snug line-clamp-1">{g.device_model}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{g.device_reference}</p>
                    {g.user_display_name && (
                      <p className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
                        <User className="h-2.5 w-2.5" />{g.user_display_name}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={cn("text-[13px] font-bold tabular-nums", isEntrada ? "text-success" : "text-violet-500")}>
                      {isEntrada ? "+" : "-"}{g.quantity}
                      <span className="text-[10px] font-normal ml-0.5 opacity-70">un.</span>
                    </span>
                    <span className="text-[10px] text-muted-foreground">{date}</span>
                    <span className="text-[10px] text-muted-foreground/60">{time}</span>
                  </div>
                </div>
              );
            });
          })()}
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard Comercial ──────────────────────────────────────────────────────

interface DashboardComercialProps {
  pedidos: PedidoCompleto[];
  loading: boolean;
  currentUserName: string | null;
  isAdmin: boolean;
}

function DashboardComercial({ pedidos, loading, currentUserName, isAdmin }: DashboardComercialProps) {
  // Pedidos "confirmados" = qualquer status além de pendente e cancelado
  const CONFIRMADOS: PedidoCompleto["status"][] = ["separando", "pronto", "faturado", "enviado"];
  const confirmados = pedidos.filter(p => CONFIRMADOS.includes(p.status));

  // Para vendedoras: filtra apenas os próprios pedidos; admin vê todos
  const meusPedidos = isAdmin ? confirmados : confirmados.filter(p => p.vendedora_nome === currentUserName);

  const totalPedidosConfirmados = meusPedidos.length;
  const totalPecasConfirmadas = meusPedidos.reduce((sum, p) => sum + p.itens.reduce((s, i) => s + i.quantidade, 0), 0);

  // Ranking vendedoras — admin vê todos; vendedora só vê a si mesma (não faz sentido mostrar ranking)
  const rankingVendedoras: Record<string, number> = {};
  for (const p of confirmados) {
    const nome = p.vendedora_nome ?? "—";
    rankingVendedoras[nome] = (rankingVendedoras[nome] ?? 0) + p.itens.reduce((s, i) => s + i.quantidade, 0);
  }
  const rankingVendList = Object.entries(rankingVendedoras)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Ranking clientes — vendedora vê só os seus clientes; admin vê todos
  const pedidosParaRankingClientes = isAdmin ? confirmados : confirmados.filter(p => p.vendedora_nome === currentUserName);
  const rankingClientes: Record<string, number> = {};
  for (const p of pedidosParaRankingClientes) {
    rankingClientes[p.cliente_nome] = (rankingClientes[p.cliente_nome] ?? 0) + p.itens.reduce((s, i) => s + i.quantidade, 0);
  }
  const rankingClientesList = Object.entries(rankingClientes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // PDF da vendedora atual
  function downloadPdfVendedora() {
    const meusPdfPedidos = isAdmin
      ? confirmados.filter(p => p.vendedora_nome === currentUserName)
      : meusPedidos;
    if (meusPdfPedidos.length === 0) { toast.error("Nenhum pedido confirmado seu encontrado."); return; }

    // Agrupa por modelo de peça (device_model) — mais robusto que stock_item_id
    // pois pedidos faturados podem ter itens sem join de stock_items
    const pecas: Record<string, { model: string; ref: string; total: number }> = {};
    for (const p of meusPdfPedidos) {
      for (const i of p.itens) {
        const model = i.device_model?.trim() || "—";
        const ref   = i.device_reference?.trim() || "—";
        const key   = `${model}||${ref}`;
        if (!pecas[key]) pecas[key] = { model, ref, total: 0 };
        pecas[key].total += (i.quantidade ?? 0);
      }
    }
    const pecasList = Object.values(pecas)
      .filter(p => p.model !== "—" || p.total > 0)
      .sort((a, b) => b.total - a.total);

    // XSS: escape all user-supplied values before injecting into HTML blob
    const esc = escHtml;

    // Monta HTML para impressão
    const html = `
      <!DOCTYPE html><html><head><meta charset="UTF-8">
      <title>Relatório de Pedidos — ${esc(currentUserName ?? "")}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
        h1 { font-size: 18px; margin-bottom: 4px; }
        p.sub { font-size: 12px; color: #666; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { text-align: left; padding: 8px 10px; background: #f3f0ff; color: #5b21b6; border-bottom: 2px solid #ddd6fe; }
        td { padding: 7px 10px; border-bottom: 1px solid #eee; }
        tr:last-child td { border-bottom: none; }
        .total { font-weight: bold; font-size: 15px; color: #5b21b6; }
        .footer { margin-top: 20px; font-size: 11px; color: #999; }
      </style></head><body>
      <h1>📋 Relatório de Pedidos</h1>
      <p class="sub">Vendedora: <strong>${esc(currentUserName ?? "")}</strong> &nbsp;·&nbsp; Gerado em: ${new Date().toLocaleDateString("pt-BR")} ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
      ${pecasList.length > 0 ? `
      <table>
        <thead><tr><th>#</th><th>Peça</th><th>Referência</th><th>Qtd. Vendida</th></tr></thead>
        <tbody>
          ${pecasList.map((p, idx2) => `<tr><td>${idx2 + 1}</td><td>${esc(p.model)}</td><td>${esc(p.ref)}</td><td class="total">${p.total}</td></tr>`).join("")}
        </tbody>
      </table>` : `<p style="color:#888;font-size:13px">Detalhes das peças não disponíveis para este período.</p>`}
      <h2 style="font-size:14px;margin:20px 0 8px;color:#5b21b6">Pedidos</h2>
      <table>
        <thead><tr><th>#</th><th>Cliente</th><th>Status</th><th>Data</th><th>Peças</th></tr></thead>
        <tbody>
          ${meusPdfPedidos.map((p, idx2) => `<tr><td>${idx2 + 1}</td><td>${esc(p.cliente_nome)}</td><td>${esc(p.status)}</td><td>${new Date(p.created_at).toLocaleDateString("pt-BR")}</td><td>${p.itens.reduce((s,i) => s + i.quantidade, 0)}</td></tr>`).join("")}
        </tbody>
      </table>
      <p class="footer">Total de ${meusPdfPedidos.length} pedido(s) confirmado(s) &nbsp;·&nbsp; ${pecasList.reduce((s, p) => s + p.total, 0)} peças no total</p>
      </body></html>
    `;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, "_blank");
    if (!w) {
      URL.revokeObjectURL(url);
      toast.error("Popup bloqueado. Permita popups para imprimir.");
      return;
    }
    w.addEventListener("load", () => {
      w.print();
      URL.revokeObjectURL(url);
    }, { once: true });
  }

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-2xl border bg-muted/20 p-4 h-24 animate-pulse" />
        ))}
      </div>
    );
  }

  const maxVend = rankingVendList[0]?.[1] ?? 1;
  const maxCli = rankingClientesList[0]?.[1] ?? 1;

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4 flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl bg-violet-500/10 flex items-center justify-center shrink-0">
            <Package className="h-5 w-5 text-violet-500" />
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Pedidos Efetuados</p>
            <p className="text-2xl font-bold tabular-nums text-violet-600 dark:text-violet-400">{totalPedidosConfirmados.toLocaleString("pt-BR")}</p>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">confirmados pela vendedora</p>
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
            <Boxes className="h-5 w-5 text-emerald-500" />
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Total de Peças</p>
            <p className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{totalPecasConfirmadas.toLocaleString("pt-BR")}</p>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">nos pedidos confirmados</p>
          </div>
        </div>
      </div>

      {/* Ranking Vendedoras — só admin vê */}
      {isAdmin && (
      <div className="rounded-2xl border border-border/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-500" />
          <p className="text-sm font-semibold">Ranking de Vendedoras</p>
          <span className="text-[11px] text-muted-foreground/60">(peças em pedidos confirmados)</span>
        </div>
        {rankingVendList.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground/60">Nenhum dado disponível</div>
        ) : (
          <div className="divide-y divide-border/20">
            {rankingVendList.map(([nome, total], idx) => (
              <div key={nome} className="flex items-center gap-3 px-4 py-2.5">
                <span className={cn(
                  "h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0",
                  idx === 0 ? "bg-amber-400/20 text-amber-600" :
                  idx === 1 ? "bg-slate-300/20 text-slate-500" :
                  idx === 2 ? "bg-orange-300/20 text-orange-600" :
                  "bg-muted/40 text-muted-foreground"
                )}>{idx + 1}º</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[12px] font-medium truncate">{nome}</span>
                    <span className="text-[12px] font-bold text-violet-600 dark:text-violet-400 shrink-0 ml-2">{total} un.</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-violet-500 to-violet-400 transition-all"
                      style={{ width: `${Math.round((total / maxVend) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Ranking Clientes */}
      <div className="rounded-2xl border border-border/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-violet-500" />
          <p className="text-sm font-semibold">Clientes que Mais Compraram</p>
          <span className="text-[11px] text-muted-foreground/60">(peças em pedidos confirmados)</span>
        </div>
        {rankingClientesList.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground/60">Nenhum dado disponível</div>
        ) : (
          <div className="divide-y divide-border/20">
            {rankingClientesList.map(([nome, total], idx) => (
              <div key={nome} className="flex items-center gap-3 px-4 py-2.5">
                <span className={cn(
                  "h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0",
                  idx === 0 ? "bg-violet-500/20 text-violet-600" : "bg-muted/40 text-muted-foreground"
                )}>{idx + 1}º</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[12px] font-medium truncate">{nome}</span>
                    <span className="text-[12px] font-bold text-violet-600 dark:text-violet-400 shrink-0 ml-2">{total} un.</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-violet-400 to-violet-300 transition-all"
                      style={{ width: `${Math.round((total / maxCli) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Botão PDF da vendedora */}
      <button
        type="button"
        onClick={downloadPdfVendedora}
        className="w-full flex items-center justify-center gap-2 h-10 rounded-xl border border-violet-500/30 text-violet-600 dark:text-violet-400 text-sm font-medium hover:bg-violet-500/10 transition-colors"
      >
        <Download className="h-4 w-4" />
        Baixar meu relatório em PDF
      </button>
    </div>
  );
}

// ─── Página Principal ─────────────────────────────────────────────────────────

export default function Comercial() {
  const navigate = useNavigate();
  const { signOut, isAdmin, role, user } = useAuth();

  const isVendedora = role === "comercial";
  const canAccess = isAdmin || isVendedora;

  // Nome da usuária logada
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  const userEmail = user?.email ?? null;
  useEffect(() => {
    if (!user?.id) return;
    supabase.from("profiles").select("display_name").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => setCurrentUserName((data as { display_name?: string } | null)?.display_name ?? userEmail));
  }, [user?.id, userEmail]);

  // Tema

  // Sub-tabs
  type SubTab = "dashboard" | "pedidos" | "clientes" | "historico";
  const [subTab, setSubTab] = useState<SubTab>("pedidos");
  const [historicoOpen, setHistoricoOpen] = useState(false);

  // Peças da expedição (para criar pedidos)
  const { items: allItems, loading: loadingStock, refetch: refetchStock } = useStock("");
  const expedicaoItems = allItems.filter(i => i.fase === "expedicao");
  // allStockItems: todas as peças com estoque disponível (qualquer fase) para busca no modal
  const allStockItems = allItems.filter(i => i.quantity_available > 0);

  // Pedidos
  const [pedidos, setPedidos] = useState<PedidoCompleto[]>([]);
  const [loadingPedidos, setLoadingPedidos] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState<"todos" | "pendente" | "faturado" | "cancelado">("todos");
  const [novoPedidoOpen, setNovoPedidoOpen] = useState(false);
  const [faturarPedido, setFaturarPedido] = useState<PedidoCompleto | null>(null);
  const [cancelarPedido, setCancelarPedido] = useState<PedidoCompleto | null>(null);
  const [adicionarPecaPedido, setAdicionarPecaPedido] = useState<PedidoCompleto | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [pedidoComCliente, setPedidoComCliente] = useState<Cliente | null>(null);

  // Clientes
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loadingClientes, setLoadingClientes] = useState(true);
  const [clienteSearchFilter, setClienteSearchFilter] = useState(""); // só atualiza em debounce
  const clienteSearchRef = useRef<HTMLInputElement>(null);
  const clienteSearchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadPedidosAbortRef = useRef<AbortController | null>(null);
  const [clienteModal, setClienteModal] = useState(false);
  const [editCliente, setEditCliente] = useState<Cliente | null>(null);
  const [deleteCliente, setDeleteCliente] = useState<Cliente | null>(null);
  const [deletingCliente, setDeletingCliente] = useState(false);
  const [historicoClienteId, setHistoricoClienteId] = useState<string | null>(null);
  const [comentarioPedidoId, setComentarioPedidoId] = useState<string | null>(null);
  const [duplicandoPedido, setDuplicandoPedido] = useState<PedidoCompleto | null>(null);
  const [filtroDataInicio, setFiltroDataInicio] = useState("");
  const [filtroDataFim, setFiltroDataFim] = useState("");

  function handleDuplicar(pedido: PedidoCompleto) {
    setDuplicandoPedido(pedido);
    setNovoPedidoOpen(true);
  }

  const loadPedidos = useCallback(async () => {
    // Cancel any in-flight request before starting a new one
    loadPedidosAbortRef.current?.abort();
    const ctrl = new AbortController();
    loadPedidosAbortRef.current = ctrl;

    setLoadingPedidos(true);
    try {
      const { data: pedidosData } = await supabase
        .from("pedidos_comerciais")
        .select("*, clientes(nome)")
        .order("created_at", { ascending: false })
        .abortSignal(ctrl.signal);

      if (ctrl.signal.aborted) return;
      if (!pedidosData) { setPedidos([]); return; }

      const pedidoIds = pedidosData.map((p: Record<string, unknown>) => p.id as string);
      const { data: itensData } = await supabase
        .from("pedido_itens")
        .select("*, stock_items(devices(model, reference))")
        .in("pedido_id", pedidoIds.length > 0 ? pedidoIds : ["none"])
        .abortSignal(ctrl.signal);

      if (ctrl.signal.aborted) return;

      const itensPorPedido = new Map<string, PedidoCompleto["itens"]>();
      for (const it of (itensData ?? []) as Record<string, unknown>[]) {
        const pid = it.pedido_id as string;
        if (!itensPorPedido.has(pid)) itensPorPedido.set(pid, []);
        const si = it.stock_items as Record<string, unknown> | null;
        const dev = si?.devices as Record<string, unknown> | null;
        itensPorPedido.get(pid)!.push({ id: it.id as string, stock_item_id: it.stock_item_id as string, lote: it.lote as string, quantidade: it.quantidade as number, quantidade_reservada: it.quantidade_reservada as number, device_model: dev?.model as string | undefined, device_reference: dev?.reference as string | undefined });
      }

      setPedidos(pedidosData.map((p: Record<string, unknown>) => {
        const c = p.clientes as Record<string, unknown> | null;
        return { id: p.id as string, cliente_id: p.cliente_id as string, cliente_nome: c?.nome as string ?? "—", vendedora_nome: p.vendedora_nome as string | null, status: p.status as PedidoCompleto["status"], observacoes: p.observacoes as string | null, desconto_pct: (p.desconto_pct as number) ?? 0, prazo_entrega: (p.prazo_entrega as string | null) ?? null, created_at: p.created_at as string, faturado_em: p.faturado_em as string | null, itens: itensPorPedido.get(p.id as string) ?? [] };
      }));
    } catch (_e) {
      toast.error("Erro ao carregar pedidos.", {
        action: { label: "Tentar novamente", onClick: loadPedidos }
      });
    } finally {
      setLoadingPedidos(false);
    }
  }, []);

  const loadClientes = useCallback(async () => {
    setLoadingClientes(true);
    try {
      const { data, error } = await supabase.from("clientes").select("*").order("nome");
      if (error) { toast.error("Erro ao carregar clientes.", {
        action: { label: "Tentar novamente", onClick: loadClientes }
      }); return; }
      setClientes((data as Cliente[]) ?? []);
    } catch (_e) {
      toast.error("Erro ao carregar clientes.", {
        action: { label: "Tentar novamente", onClick: loadClientes }
      });
      setClientes([]);
    } finally {
      setLoadingClientes(false);
    }
  }, []);

  useEffect(() => { loadPedidos(); loadClientes(); }, [loadPedidos, loadClientes]);

  async function handleCancelar() {
    if (!cancelarPedido) return;
    setCancelando(true);
    try {
      // Use atomic RPC — cancels pedido + releases all reservations in one transaction
      const { error } = await supabase.rpc("cancel_pedido", { p_pedido_id: cancelarPedido.id });
      if (error) { toast.error("Erro ao cancelar."); return; }
      await logAudit(user?.id, currentUserName, "cancel_pedido", "pedido_comercial", cancelarPedido.id, { cliente: cancelarPedido.cliente_nome });
      toast.success("Pedido cancelado.");
      setCancelarPedido(null);
      loadPedidos();
      refetchStock();
    } catch (_e) {
      toast.error("Erro inesperado ao cancelar pedido.");
    } finally {
      setCancelando(false);
    }
  }

  async function handleDeleteCliente() {
    if (!deleteCliente) return;
    setDeletingCliente(true);
    // Admin pode apagar mesmo com pedidos vinculados — cancela pedidos primeiro
    if (isAdmin) {
      await supabase.from("pedido_itens").delete().in(
        "pedido_id",
        (await supabase.from("pedidos_comerciais").select("id").eq("cliente_id", deleteCliente.id)).data?.map((p: Record<string, unknown>) => p.id as string) ?? []
      );
      await supabase.from("pedidos_comerciais").delete().eq("cliente_id", deleteCliente.id);
    }
    const { error } = await supabase.from("clientes").delete().eq("id", deleteCliente.id);
    setDeletingCliente(false);
    if (error) { toast.error("Não foi possível excluir o cliente."); return; }
    toast.success("Cliente excluído.");
    setDeleteCliente(null);
    loadClientes();
  }

  const pedidosFiltrados = useMemo(() => pedidos.filter(p => {
    if (filtroStatus !== "todos" && p.status !== filtroStatus) return false;
    if (filtroDataInicio && p.created_at < filtroDataInicio) return false;
    if (filtroDataFim && p.created_at > filtroDataFim + "T23:59:59") return false;
    return true;
  }), [pedidos, filtroStatus, filtroDataInicio, filtroDataFim]);
  const pedidosPendentes  = useMemo(() => pedidos.filter(p => p.status === "pendente").length, [pedidos]);
  const pedidosAtrasados  = useMemo(() => pedidos.filter(p =>
    p.prazo_entrega && !["cancelado","enviado","faturado"].includes(p.status) &&
    new Date(p.prazo_entrega) < new Date()
  ).length, [pedidos]);
  const clientesFiltrados = useMemo(() => clientes.filter(c =>
    c.nome.toLowerCase().includes(clienteSearchFilter.toLowerCase()) ||
    (c.documento ?? "").includes(clienteSearchFilter) ||
    (c.telefone ?? "").includes(clienteSearchFilter)
  ), [clientes, clienteSearchFilter]);

  const COMERCIAL_TABS = [
    {
      id: "dashboard" as SubTab,
      label: "Dashboard",
      Icon: LayoutDashboard,
      activeColor: "text-primary",
      activeBg: "bg-primary/10",
      activeBorder: "border-primary/40",
      badgeBg: "bg-primary/15",
      badgeText: "text-primary",
    },
    {
      id: "pedidos" as SubTab,
      label: "Pedidos",
      Icon: ShoppingBag,
      badge: pedidosPendentes,
      activeColor: "text-amber-600 dark:text-amber-400",
      activeBg: "bg-amber-500/10",
      activeBorder: "border-amber-500/40",
      badgeBg: "bg-amber-500/15",
      badgeText: "text-amber-600 dark:text-amber-400",
    },
    {
      id: "clientes" as SubTab,
      label: "Clientes",
      Icon: User,
      activeColor: "text-violet-600 dark:text-violet-400",
      activeBg: "bg-violet-500/10",
      activeBorder: "border-violet-500/40",
      badgeBg: "bg-violet-500/15",
      badgeText: "text-violet-600 dark:text-violet-400",
    },
    {
      id: "historico" as SubTab,
      label: "Histórico",
      Icon: History,
      activeColor: "text-cyan-600 dark:text-cyan-400",
      activeBg: "bg-cyan-500/10",
      activeBorder: "border-cyan-500/40",
      badgeBg: "bg-cyan-500/15",
      badgeText: "text-cyan-600 dark:text-cyan-400",
    },
  ];

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border/40">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 h-12 sm:h-14 flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-4 w-4 text-violet-500" />
            <h1 className="text-sm font-semibold">Comercial</h1>
            {!loadingPedidos && pedidosPendentes > 0 && (
              <span className="flex items-center gap-0.5 bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                <Clock className="h-2.5 w-2.5" />
                {pedidosPendentes}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {user && <NotificacoesBell userId={user.id} />}
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto"><div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 space-y-4">
        {!canAccess ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            <ShoppingBag className="h-12 w-12 text-muted-foreground/20" />
            <p className="text-muted-foreground font-medium">Acesso restrito</p>
            <p className="text-sm text-muted-foreground/60">Esta área é exclusiva para vendedoras e administradores.</p>
          </div>
        ) : (
          <>
            {/* Info */}
            <div className="rounded-xl border bg-violet-500/5 border-violet-500/20 text-violet-700 dark:text-violet-300 px-4 py-3 text-[12px]">
              Cadastre clientes, visualize peças disponíveis na expedição e crie pedidos de venda. O estoque fatura e as peças saem automaticamente.
            </div>

            {/* Nav harmonizada */}
            <PageNav
              tabs={COMERCIAL_TABS}
              activeTab={subTab}
              onTabChange={(tab) => {
                if (tab === "historico") { setHistoricoOpen(true); return; }
                setSubTab(tab);
              }}
              loading={loadingPedidos}
            />

            {/* ── Aba Dashboard ── */}
            {subTab === "dashboard" && (
              <DashboardComercial
                pedidos={pedidos}
                loading={loadingPedidos}
                currentUserName={currentUserName}
                isAdmin={isAdmin}
              />
            )}

            {/* ── Aba Pedidos ── */}
            {subTab === "pedidos" && (
              <div className="space-y-3">
                <div className="flex flex-col gap-2">
                  {/* Linha 1: filtros de status */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {(["todos","pendente","faturado","cancelado"] as const).map(s => (
                      <button key={s} type="button" onClick={() => setFiltroStatus(s)}
                        className={cn("h-7 px-3 rounded-full text-[11px] font-semibold border transition-colors",
                          filtroStatus === s ? "bg-violet-600 text-white border-violet-600" : "bg-background text-muted-foreground border-border/50 hover:border-violet-400")}>
                        {s === "todos" ? "Todos" : s.charAt(0).toUpperCase() + s.slice(1)}
                      </button>
                    ))}
                  </div>
                  {/* Linha 2: filtros de data + botão novo pedido */}
                  <div className="flex items-center gap-1.5">
                    <input type="date" value={filtroDataInicio} onChange={e => setFiltroDataInicio(e.target.value)}
                      className="h-7 flex-1 min-w-0 rounded-lg border border-border/50 bg-background text-[11px] px-2 focus:outline-none focus:ring-1 focus:ring-violet-500/40" />
                    <span className="text-[10px] text-muted-foreground shrink-0">até</span>
                    <input type="date" value={filtroDataFim} onChange={e => setFiltroDataFim(e.target.value)}
                      className="h-7 flex-1 min-w-0 rounded-lg border border-border/50 bg-background text-[11px] px-2 focus:outline-none focus:ring-1 focus:ring-violet-500/40" />
                    {(filtroDataInicio || filtroDataFim) && (
                      <button type="button" onClick={() => { setFiltroDataInicio(""); setFiltroDataFim(""); }}
                        className="h-7 w-7 shrink-0 flex items-center justify-center rounded-lg hover:bg-muted/50 text-muted-foreground">
                        <X className="h-3 w-3" />
                      </button>
                    )}
                    <Button size="sm" className="h-7 gap-1.5 text-xs rounded-lg bg-violet-600 hover:bg-violet-500 shrink-0 ml-auto" onClick={() => { setPedidoComCliente(null); setNovoPedidoOpen(true); }}>
                      <Plus className="h-3.5 w-3.5" /> Novo
                    </Button>
                  </div>
                </div>

                {loadingPedidos ? (
                  <div className="flex items-center justify-center py-16"><div className="h-7 w-7 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>
                ) : pedidosFiltrados.length === 0 ? (
                  <div className="text-center py-16 space-y-2">
                    <ShoppingBag className="h-10 w-10 text-muted-foreground/30 mx-auto" />
                    <p className="text-muted-foreground font-medium">Nenhum pedido encontrado</p>
                    <button type="button" onClick={() => setNovoPedidoOpen(true)} className="mt-2 inline-flex items-center gap-1.5 h-8 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[12px] font-semibold transition-colors">
                      <Plus className="h-3.5 w-3.5" /> Criar primeiro pedido
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {pedidosFiltrados.map(p => (
                      <PedidoCard key={p.id} pedido={p} isAdmin={isAdmin} onFaturar={setFaturarPedido} onCancelar={setCancelarPedido} onAdicionarPeca={setAdicionarPecaPedido} onDuplicar={handleDuplicar} onComentar={p => setComentarioPedidoId(p.id)} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Aba Clientes ── */}
            {subTab === "clientes" && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <input
                      ref={clienteSearchRef}
                      type="text"
                      placeholder="Buscar cliente..."
                      defaultValue=""
                      onChange={e => {
                        if (clienteSearchDebounce.current) clearTimeout(clienteSearchDebounce.current);
                        const v = e.target.value;
                        clienteSearchDebounce.current = setTimeout(() => setClienteSearchFilter(v), 300);
                      }}
                      className="pl-9 pr-8 h-9 w-full text-sm rounded-md border border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    />
                    {clienteSearchFilter && (
                      <button type="button" onClick={() => { if (clienteSearchRef.current) clienteSearchRef.current.value = ""; setClienteSearchFilter(""); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <Button size="sm" className="h-9 gap-1.5 text-xs rounded-lg bg-violet-600 hover:bg-violet-500 shrink-0" onClick={() => { setEditCliente(null); setClienteModal(true); }}>
                    <UserPlus className="h-3.5 w-3.5" /> Novo
                  </Button>
                </div>

                {loadingClientes ? (
                  <div className="flex items-center justify-center py-16"><div className="h-7 w-7 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>
                ) : clientesFiltrados.length === 0 ? (
                  <div className="text-center py-16 space-y-2">
                    <User className="h-10 w-10 text-muted-foreground/30 mx-auto" />
                    <p className="text-muted-foreground font-medium">{clienteSearchFilter ? "Nenhum cliente encontrado" : "Nenhum cliente cadastrado"}</p>
                    {!clienteSearchFilter && (
                      <button type="button" onClick={() => { setEditCliente(null); setClienteModal(true); }} className="mt-2 inline-flex items-center gap-1.5 h-8 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[12px] font-semibold transition-colors">
                        <UserPlus className="h-3.5 w-3.5" /> Cadastrar primeiro cliente
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {clientesFiltrados.map(c => (
                      <ClienteCard
                        key={c.id}
                        cliente={c}
                        isAdmin={isAdmin}
                        onPedido={(cl) => { setPedidoComCliente(cl); setNovoPedidoOpen(true); setSubTab("pedidos"); }}
                        onEditar={(cl) => { setEditCliente(cl); setClienteModal(true); }}
                        onExcluir={setDeleteCliente}
                        onHistorico={(cl) => setHistoricoClienteId(cl.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
      </main>

      {/* ── Modais ── */}
      <NovoPedidoModal
        open={novoPedidoOpen}
        onClose={() => { setNovoPedidoOpen(false); setPedidoComCliente(null); setDuplicandoPedido(null); }}
        onSuccess={() => { setNovoPedidoOpen(false); setPedidoComCliente(null); setDuplicandoPedido(null); loadPedidos(); refetchStock(); }}
        clienteFixo={pedidoComCliente}
        duplicarDe={duplicandoPedido}
        expedicaoItems={expedicaoItems}
      />

      <ClienteModal
        open={clienteModal}
        onClose={() => { setClienteModal(false); setEditCliente(null); }}
        onSuccess={() => { setClienteModal(false); setEditCliente(null); loadClientes(); }}
        inicial={editCliente}
      />

      <FaturarModal
        pedido={faturarPedido}
        onClose={() => setFaturarPedido(null)}
        onSuccess={() => { setFaturarPedido(null); loadPedidos(); refetchStock(); }}
      />

      <AdicionarPecaModal
        pedido={adicionarPecaPedido}
        expedicaoItems={expedicaoItems}
        onClose={() => setAdicionarPecaPedido(null)}
        onSuccess={() => { setAdicionarPecaPedido(null); loadPedidos(); refetchStock(); }}
      />

      {/* Cancelar pedido */}
      {cancelarPedido && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-card border border-border/30 p-5 space-y-4 shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-200">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0"><Ban className="h-4 w-4 text-destructive" /></div>
              <div>
                <p className="text-sm font-semibold">Cancelar pedido?</p>
                <p className="text-[12px] text-muted-foreground mt-0.5">{cancelarPedido.cliente_nome}</p>
              </div>
            </div>
            <p className="text-[12px] text-muted-foreground">As peças reservadas voltarão a ficar disponíveis na expedição.</p>
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

      {/* Excluir cliente */}
      {deleteCliente && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-card border border-border/30 p-5 space-y-4 shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-200">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0"><Trash2 className="h-4 w-4 text-destructive" /></div>
              <div>
                <p className="text-sm font-semibold">Excluir cliente?</p>
                <p className="text-[12px] text-muted-foreground mt-0.5">{deleteCliente.nome}</p>
              </div>
            </div>
            <p className="text-[12px] text-muted-foreground">{isAdmin ? "Como admin, você pode excluir este cliente mesmo que tenha pedidos vinculados. Os pedidos também serão removidos." : "Clientes com pedidos vinculados não podem ser excluídos."}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setDeleteCliente(null)} disabled={deletingCliente} className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors">Cancelar</button>
              <button type="button" onClick={handleDeleteCliente} disabled={deletingCliente} className="flex-1 h-9 rounded-xl bg-destructive text-destructive-foreground text-sm font-semibold hover:bg-destructive/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5">
                {deletingCliente ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Histórico Geral */}
      <HistoricoGeralModal open={historicoOpen} onClose={() => setHistoricoOpen(false)} />
      <HistoricoClienteModal
        clienteId={historicoClienteId}
        clientes={clientes}
        onClose={() => setHistoricoClienteId(null)}
      />
      <ComentariosModal
        pedidoId={comentarioPedidoId}
        onClose={() => setComentarioPedidoId(null)}
      />
    </div>
  );
}
