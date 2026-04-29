/**
 * Comercial — Página exclusiva para vendedoras (e admins)
 *
 * Rota: /comercial
 * Acesso: role === "vendedora" | "admin"
 *
 * Fluxo:
 *  1. Vendedora seleciona ou cadastra cliente
 *  2. Visualiza peças disponíveis na expedição
 *  3. Cria pedido (nome do cliente + lote + quantidade)
 *  4. Peças ficam reservadas no estoque
 *  5. Admin/Estoque fatura o pedido → peças saem da expedição
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useStock, fetchAllMovements } from "@/hooks/useStock";
import type { AllMovement } from "@/hooks/useStock";
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
} from "lucide-react";
import { getStoredTheme, applyTheme } from "@/pages/Settings";
import { Logo } from "@/components/Logo";

// ─── Lote helpers (formato DDMMYYS-NN ou DDMMYYS-NN/A) ───────────────────────
const LOTE_REGEX = /^\d{7}-\d{2}([/][A-Za-z])?$/;
function formatLote(raw: string): string {
  let v = raw.toUpperCase().replace(/[^0-9\-/A-Z]/g, "");
  if (/^\d{8,}/.test(v)) v = v.slice(0, 7) + "-" + v.slice(7);
  return v.slice(0, 13);
}
function loteValido(lote: string) { return LOTE_REGEX.test(lote); }

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
  lote: string;
  quantidade: number;
  device_model: string;
  device_reference: string;
}

interface PedidoCompleto {
  id: string;
  cliente_id: string;
  cliente_nome: string;
  vendedora_nome: string | null;
  status: "pendente" | "faturado" | "cancelado";
  observacoes: string | null;
  created_at: string;
  faturado_em: string | null;
  itens: Array<{
    id: string;
    stock_item_id: string;
    lote: string;
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
    setSaving(true);
    try {
      let data: Cliente | null = null;
      if (inicial) {
        const { data: d, error } = await supabase
          .from("clientes")
          .update({ nome: nome.trim(), documento: documento || null, telefone: telefone || null, email: email || null, endereco: endereco || null, observacoes: obs || null })
          .eq("id", inicial.id).select().single();
        if (error) throw error;
        data = d as Cliente;
      } else {
        const { data: d, error } = await supabase
          .from("clientes")
          .insert({ nome: nome.trim(), documento: documento || null, telefone: telefone || null, email: email || null, endereco: endereco || null, observacoes: obs || null, created_by: user?.id })
          .select().single();
        if (error) throw error;
        data = d as Cliente;
      }
      toast.success(inicial ? "Cliente atualizado!" : "Cliente cadastrado!");
      onSuccess(data!);
    } catch {
      toast.error("Erro ao salvar cliente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-card border border-border/30 shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
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
            <Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome completo ou razão social" className="h-9 text-sm" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">CPF / CNPJ</label>
              <Input value={documento} onChange={e => setDocumento(e.target.value)} placeholder="000.000.000-00" className="h-9 text-sm" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Telefone</label>
              <Input value={telefone} onChange={e => setTelefone(e.target.value)} placeholder="(00) 00000-0000" className="h-9 text-sm" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">E-mail</label>
            <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="cliente@email.com" type="email" className="h-9 text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Endereço</label>
            <Input value={endereco} onChange={e => setEndereco(e.target.value)} placeholder="Rua, número, cidade..." className="h-9 text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Observações</label>
            <textarea value={obs} onChange={e => setObs(e.target.value)} placeholder="Informações adicionais..." className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none min-h-[60px] focus:outline-none focus:ring-2 focus:ring-ring" />
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

interface LoteDisponivel {
  lote: string;
  quantidade: number;
}

interface NovoPedidoModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  clienteFixo?: Cliente | null;
  expedicaoItems: ReturnType<typeof useStock>["items"];
}

function NovoPedidoModal({ open, onClose, onSuccess, clienteFixo, expedicaoItems }: NovoPedidoModalProps) {
  const { user } = useAuth();

  // Cliente
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [clienteId, setClienteId] = useState(clienteFixo?.id ?? "");
  const [clienteSearch, setClienteSearch] = useState(clienteFixo?.nome ?? "");
  const [showClienteDrop, setShowClienteDrop] = useState(false);
  const [novoClienteModal, setNovoClienteModal] = useState(false);

  // Busca de peça — igual ao estoque
  const [pecaSearch, setPecaSearch] = useState("");
  const [autocomplete, setAutocomplete] = useState<ReturnType<typeof useStock>["items"]>([]);
  const [showAutocomp, setShowAutocomp] = useState(false);
  const [selectedPeca, setSelectedPeca] = useState<ReturnType<typeof useStock>["items"][0] | null>(null);

  // Lotes disponíveis para a peça selecionada
  const [lotes, setLotes] = useState<LoteDisponivel[]>([]);
  const [lotesLoading, setLotesLoading] = useState(false);
  const [selectedLote, setSelectedLote] = useState<LoteDisponivel | null>(null);
  const [showLoteDrop, setShowLoteDrop] = useState(false);

  // Quantidade e lista do pedido
  const [qtd, setQtd] = useState(1);
  const [itens, setItens] = useState<PedidoItem[]>([]);
  const [obs, setObs] = useState("");
  const [saving, setSaving] = useState(false);

  const clienteDropRef = useRef<HTMLDivElement>(null);
  const pecaDropRef = useRef<HTMLDivElement>(null);
  const loteDropRef = useRef<HTMLDivElement>(null);
  const pecaInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset ao abrir
  useEffect(() => {
    if (!open) return;
    setClienteId(clienteFixo?.id ?? "");
    setClienteSearch(clienteFixo?.nome ?? "");
    setItens([]); setObs("");
    setPecaSearch(""); setAutocomplete([]); setShowAutocomp(false);
    setSelectedPeca(null); setLotes([]); setSelectedLote(null);
    setQtd(1);
    loadClientes();
  }, [open, clienteFixo]);

  async function loadClientes() {
    const { data } = await supabase.from("clientes").select("*").order("nome");
    setClientes((data as Cliente[]) ?? []);
  }

  // Fecha dropdowns ao clicar fora
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (clienteDropRef.current && !clienteDropRef.current.contains(e.target as Node)) setShowClienteDrop(false);
      if (pecaDropRef.current && !pecaDropRef.current.contains(e.target as Node)) setShowAutocomp(false);
      if (loteDropRef.current && !loteDropRef.current.contains(e.target as Node)) setShowLoteDrop(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // Autocomplete de peça — mostra todas disponíveis ao focar, filtra conforme digita
  function handlePecaInput(v: string) {
    setPecaSearch(v);
    setSelectedPeca(null);
    setSelectedLote(null);
    setLotes([]);
    setShowLoteDrop(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const q = v.trim().toLowerCase();
      const sugestoes = expedicaoItems.filter(i =>
        i.quantity > 0 && (
          !q ||
          i.device?.model?.toLowerCase().includes(q) ||
          i.device?.reference?.toLowerCase().includes(q) ||
          i.device?.udi_di?.toLowerCase().includes(q)
        )
      );
      // Deduplica por device_id
      const vistos = new Set<string>();
      const deduped = sugestoes.filter(i => {
        if (vistos.has(i.device_id)) return false;
        vistos.add(i.device_id); return true;
      }).slice(0, 20);
      setAutocomplete(deduped);
      setShowAutocomp(deduped.length > 0);
    }, 80);
  }

  function handlePecaFocus() {
    // Ao focar, mostra todas as peças disponíveis mesmo sem texto
    const sugestoes = expedicaoItems.filter(i => i.quantity > 0);
    const vistos = new Set<string>();
    const deduped = sugestoes.filter(i => {
      if (vistos.has(i.device_id)) return false;
      vistos.add(i.device_id); return true;
    }).slice(0, 20);
    setAutocomplete(deduped);
    setShowAutocomp(deduped.length > 0);
  }

  // Quando seleciona uma peça — busca os lotes disponíveis nos stock_movements da expedição
  async function handleSelectPeca(item: ReturnType<typeof useStock>["items"][0]) {
    setSelectedPeca(item);
    setPecaSearch(item.device?.model ?? "");
    setShowAutocomp(false);
    setSelectedLote(null);
    setLotes([]);
    setLotesLoading(true);
    try {
      // Busca movimentos de entrada da expedição para essa peça
      const { data: movs } = await supabase
        .from("stock_movements")
        .select("lote, quantity, type")
        .eq("stock_item_id", item.id)
        .not("lote", "is", null)
        .order("created_at", { ascending: false });

      if (!movs) { setLotes([]); return; }

      // Calcula saldo por lote (entradas - saídas)
      const saldos = new Map<string, number>();
      for (const m of movs as { lote: string; quantity: number; type: string }[]) {
        if (!m.lote) continue;
        const l = m.lote.toUpperCase();
        const atual = saldos.get(l) ?? 0;
        saldos.set(l, m.type === "entrada" ? atual + m.quantity : atual - m.quantity);
      }

      const lotesDisp: LoteDisponivel[] = [];
      for (const [lote, qtdSaldo] of saldos.entries()) {
        if (qtdSaldo > 0) lotesDisp.push({ lote, quantidade: qtdSaldo });
      }
      // Ordena do mais recente (alfabético descendente do lote)
      lotesDisp.sort((a, b) => b.lote.localeCompare(a.lote));
      setLotes(lotesDisp);
      if (lotesDisp.length > 0) setShowLoteDrop(true);
    } catch {
      toast.error("Erro ao buscar lotes.");
    } finally {
      setLotesLoading(false);
    }
  }

  function handleSelectLote(l: LoteDisponivel) {
    setSelectedLote(l);
    setShowLoteDrop(false);
    setQtd(1);
  }

  function addItem() {
    if (!selectedPeca || !selectedLote) return;
    const maxQtd = selectedLote.quantidade -
      itens.filter(i => i.stock_item_id === selectedPeca.id && i.lote === selectedLote.lote)
           .reduce((s, i) => s + i.quantidade, 0);
    if (qtd < 1 || qtd > maxQtd) {
      toast.error(`Disponível neste lote: ${maxQtd} un.`);
      return;
    }
    setItens(prev => [...prev, {
      stock_item_id: selectedPeca.id,
      lote: selectedLote.lote,
      quantidade: qtd,
      device_model: selectedPeca.device?.model ?? "",
      device_reference: selectedPeca.device?.reference ?? "",
    }]);
    // Reseta a seleção de peça para adicionar outra
    setSelectedPeca(null); setPecaSearch(""); setLotes([]); setSelectedLote(null); setQtd(1);
    setTimeout(() => pecaInputRef.current?.focus(), 50);
  }

  async function handleSave() {
    if (!clienteId) { toast.error("Selecione um cliente"); return; }
    if (itens.length === 0) { toast.error("Adicione ao menos uma peça"); return; }
    setSaving(true);
    try {
      const { data: profile } = await supabase.from("profiles").select("display_name").eq("user_id", user?.id).maybeSingle();
      const vendedoraNome = (profile as { display_name?: string } | null)?.display_name ?? user?.email ?? "Vendedora";
      const { data: pedido, error: pedidoErr } = await supabase
        .from("pedidos_comerciais")
        .insert({ cliente_id: clienteId, vendedora_id: user?.id, vendedora_nome: vendedoraNome, observacoes: obs || null })
        .select().single();
      if (pedidoErr) throw pedidoErr;
      const { error: itensErr } = await supabase.from("pedido_itens").insert(
        itens.map(i => ({ pedido_id: (pedido as { id: string }).id, stock_item_id: i.stock_item_id, lote: i.lote, quantidade: i.quantidade, quantidade_reservada: i.quantidade }))
      );
      if (itensErr) throw itensErr;
      toast.success("Pedido criado! Peças reservadas na expedição.");
      onSuccess();
    } catch {
      toast.error("Erro ao criar pedido.");
    } finally {
      setSaving(false);
    }
  }

  const clientesFiltrados = clientes.filter(c =>
    c.nome.toLowerCase().includes(clienteSearch.toLowerCase()) || (c.documento ?? "").includes(clienteSearch)
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-card border border-border/30 shadow-xl overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in slide-in-from-bottom-4 duration-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/30 shrink-0">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-violet-500" />
            <p className="text-sm font-semibold">Novo Pedido</p>
          </div>
          <button type="button" onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">

          {/* ── Cliente ── */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Cliente *</label>
            <div className="relative" ref={clienteDropRef}>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Buscar ou selecionar cliente..."
                    value={clienteSearch}
                    onChange={e => { setClienteSearch(e.target.value); setClienteId(""); setShowClienteDrop(true); }}
                    onFocus={() => setShowClienteDrop(true)}
                    className="pl-9 h-9 text-sm"
                  />
                </div>
                <button type="button" onClick={() => setNovoClienteModal(true)} className="h-9 w-9 flex items-center justify-center rounded-lg bg-violet-500/10 hover:bg-violet-500/20 text-violet-500 transition-colors shrink-0" title="Novo cliente">
                  <UserPlus className="h-3.5 w-3.5" />
                </button>
              </div>
              {showClienteDrop && clientesFiltrados.length > 0 && (
                <div className="absolute top-full mt-1 left-0 right-0 z-50 rounded-xl border border-border bg-card shadow-xl overflow-hidden max-h-44 overflow-y-auto">
                  {clientesFiltrados.map(c => (
                    <button key={c.id} type="button" onClick={() => { setClienteId(c.id); setClienteSearch(c.nome); setShowClienteDrop(false); }} className="w-full text-left px-4 py-2.5 hover:bg-muted/40 transition-colors border-b border-border/20 last:border-0">
                      <p className="text-sm font-medium">{c.nome}</p>
                      {c.documento && <p className="text-[11px] text-muted-foreground">{c.documento}</p>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {clienteId && <p className="text-[11px] text-violet-500 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Cliente selecionado</p>}
          </div>

          {/* ── Seleção de peça — estilo estoque ── */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Adicionar Peça da Expedição</label>
            <div className="rounded-xl border border-border/50 bg-muted/10 p-3 space-y-2.5">

              {/* Busca de modelo */}
              <div className="space-y-1">
                <p className="text-[10px] font-medium text-muted-foreground">1. Buscar peça</p>
                <div className="relative" ref={pecaDropRef}>
                  <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    ref={pecaInputRef}
                    type="text"
                    placeholder="Clique para ver peças disponíveis ou digite para buscar..."
                    value={pecaSearch}
                    onChange={e => handlePecaInput(e.target.value)}
                    onFocus={() => { if (!selectedPeca) handlePecaFocus(); }}
                    onKeyDown={e => { if (e.key === "Escape") setShowAutocomp(false); }}
                    className="w-full pl-9 pr-9 h-10 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring font-medium"
                  />
                  {pecaSearch && !selectedPeca && (
                    <button type="button" onClick={() => { setPecaSearch(""); setSelectedPeca(null); setLotes([]); setSelectedLote(null); setAutocomplete([]); setShowAutocomp(false); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {selectedPeca && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-violet-500" />
                    </div>
                  )}
                  {/* Autocomplete dropdown */}
                  {showAutocomp && autocomplete.length > 0 && (
                    <div className="absolute top-full mt-1 left-0 right-0 z-50 rounded-xl border border-border bg-card shadow-xl overflow-hidden max-h-52 overflow-y-auto">
                      {autocomplete.map(item => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleSelectPeca(item)}
                          className="w-full text-left px-4 py-2.5 hover:bg-muted/40 transition-colors border-b border-border/20 last:border-0"
                        >
                          <p className="text-[13px] font-semibold">{item.device?.model}</p>
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                            <span>{item.device?.reference}</span>
                            <span>·</span>
                            <span className="text-success font-medium">{item.quantity} un. disponível</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {showAutocomp && autocomplete.length === 0 && (
                    <div className="absolute top-full mt-1 left-0 right-0 z-50 rounded-xl border border-border bg-card shadow-xl p-3 text-center">
                      <p className="text-xs text-muted-foreground">Nenhuma peça disponível na expedição</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Seleção de lote */}
              {selectedPeca && (
                <div className="space-y-1">
                  <p className="text-[10px] font-medium text-muted-foreground">2. Selecionar lote</p>
                  <div className="relative" ref={loteDropRef}>
                    <button
                      type="button"
                      onClick={() => setShowLoteDrop(v => !v)}
                      disabled={lotesLoading}
                      className="w-full flex items-center justify-between gap-2 h-10 px-3 rounded-xl border border-input bg-background text-sm hover:bg-muted/20 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        {lotesLoading ? (
                          <span className="text-muted-foreground text-xs flex items-center gap-1.5">
                            <div className="h-3 w-3 border border-current border-t-transparent rounded-full animate-spin" /> Buscando lotes...
                          </span>
                        ) : selectedLote ? (
                          <span className="font-mono font-semibold text-foreground truncate">{selectedLote.lote}</span>
                        ) : lotes.length === 0 ? (
                          <span className="text-muted-foreground text-xs">Nenhum lote com saldo disponível</span>
                        ) : (
                          <span className="text-muted-foreground text-xs">Selecione o lote...</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {selectedLote && (
                          <span className="text-[10px] text-success font-medium bg-success/10 px-1.5 py-0.5 rounded-full">
                            {selectedLote.quantidade} disp.
                          </span>
                        )}
                        {!lotesLoading && lotes.length > 0 && (
                          <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", showLoteDrop && "rotate-180")} />
                        )}
                      </div>
                    </button>
                    {showLoteDrop && lotes.length > 0 && (
                      <div className="absolute top-full mt-1 left-0 right-0 z-50 rounded-xl border border-border bg-card shadow-xl overflow-hidden max-h-52 overflow-y-auto">
                        {lotes.map(l => (
                          <button
                            key={l.lote}
                            type="button"
                            onClick={() => handleSelectLote(l)}
                            className={cn(
                              "w-full flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors border-b border-border/20 last:border-0",
                              selectedLote?.lote === l.lote && "bg-violet-500/8"
                            )}
                          >
                            <div className="flex items-center gap-2">
                              {selectedLote?.lote === l.lote && <CheckCircle2 className="h-3 w-3 text-violet-500 shrink-0" />}
                              <span className="font-mono font-semibold text-[13px]">{l.lote}</span>
                            </div>
                            <span className="text-[11px] text-success font-medium bg-success/10 px-2 py-0.5 rounded-full shrink-0">
                              {l.quantidade} un.
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Quantidade */}
              {selectedLote && (
                <div className="space-y-1">
                  <p className="text-[10px] font-medium text-muted-foreground">3. Quantidade</p>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setQtd(q => Math.max(1, q - 1))} className="h-10 w-10 flex items-center justify-center rounded-xl border border-input bg-background hover:bg-muted/40 text-lg font-bold shrink-0 transition-colors">−</button>
                    <input
                      type="number"
                      min={1}
                      max={selectedLote.quantidade}
                      value={qtd}
                      onChange={e => setQtd(Math.max(1, Math.min(selectedLote.quantidade, parseInt(e.target.value) || 1)))}
                      className="flex-1 h-10 rounded-xl border border-input bg-background text-center text-base font-bold focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <button type="button" onClick={() => setQtd(q => Math.min(selectedLote.quantidade, q + 1))} className="h-10 w-10 flex items-center justify-center rounded-xl border border-input bg-background hover:bg-muted/40 text-lg font-bold shrink-0 transition-colors">+</button>
                    <span className="text-[11px] text-muted-foreground shrink-0">/ {selectedLote.quantidade}</span>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={addItem}
                disabled={!selectedPeca || !selectedLote || qtd < 1}
                className="w-full h-9 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" /> Adicionar ao pedido
              </button>
            </div>

            {/* Itens adicionados */}
            {itens.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] text-muted-foreground font-medium">{itens.length} item{itens.length > 1 ? "s" : ""} no pedido</p>
                <div className="space-y-1">
                  {itens.map((it, idx) => (
                    <div key={idx} className="flex items-center gap-2 rounded-lg bg-muted/20 border border-border/30 px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium truncate">{it.device_model}</p>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <Tag className="h-2.5 w-2.5" />
                          <span className="font-mono">{it.lote}</span>
                          <span>·</span>
                          <span>{it.quantidade} un.</span>
                        </div>
                      </div>
                      <button type="button" onClick={() => setItens(prev => prev.filter((_, i) => i !== idx))} className="h-6 w-6 flex items-center justify-center rounded-lg hover:bg-destructive/15 hover:text-destructive text-muted-foreground transition-colors">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Observações */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Observações</label>
            <textarea value={obs} onChange={e => setObs(e.target.value)} placeholder="Informações adicionais..." className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none min-h-[56px] focus:outline-none focus:ring-2 focus:ring-ring" />
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
}

function PedidoCard({ pedido, isAdmin, onFaturar, onCancelar }: PedidoCardProps) {
  const [expanded, setExpanded] = useState(false);
  const totalItens = pedido.itens.reduce((s, i) => s + i.quantidade, 0);
  const data = new Date(pedido.created_at).toLocaleDateString("pt-BR");
  const hora = new Date(pedido.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const statusColor = {
    pendente: "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/25",
    faturado: "text-success bg-success/8 border-success/25",
    cancelado: "text-muted-foreground bg-muted/20 border-border/40",
  }[pedido.status];

  const statusIcon = {
    pendente: <Clock className="h-2.5 w-2.5" />,
    faturado: <CheckCircle2 className="h-2.5 w-2.5" />,
    cancelado: <Ban className="h-2.5 w-2.5" />,
  }[pedido.status];

  const topBarColor = {
    pendente: "via-amber-500 opacity-70",
    faturado: "via-success opacity-60",
    cancelado: "via-muted-foreground/40 opacity-30",
  }[pedido.status];

  return (
    <div className="group relative rounded-2xl bg-card overflow-hidden transition-all duration-300 hover:-translate-y-0.5" style={{ boxShadow: "0 1px 2px hsl(var(--border) / 0.3), 0 4px 12px -2px hsl(var(--border) / 0.15), inset 0 1px 0 hsl(0 0% 100% / 0.06)" }}>
      <div className={cn("h-0.5 bg-gradient-to-r from-transparent to-transparent transition-opacity group-hover:opacity-100", topBarColor)} />
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <User className="h-3 w-3 text-violet-500 shrink-0" />
              <h3 className="text-[13px] font-semibold truncate">{pedido.cliente_nome}</h3>
            </div>
            <p className="text-[11px] text-muted-foreground/70">{pedido.vendedora_nome}</p>
          </div>
          <Badge variant="outline" className={cn("shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-lg flex items-center gap-1", statusColor)}>
            {statusIcon} {{ pendente: "Pendente", faturado: "Faturado", cancelado: "Cancelado" }[pedido.status]}
          </Badge>
        </div>

        <div className="flex items-center justify-between rounded-xl px-3 py-2 border bg-muted/20 border-border/30">
          <div className="flex items-center gap-1.5">
            <ShoppingBag className="h-3.5 w-3.5 text-violet-500" />
            <span className="text-[11px] font-medium text-muted-foreground">{pedido.itens.length} tipo{pedido.itens.length !== 1 ? "s" : ""} de peça</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[15px] font-bold tabular-nums">{totalItens}</span>
            <span className="text-[10px] text-muted-foreground">un.</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
          <Clock className="h-3 w-3" />
          <span>{data} às {hora}</span>
        </div>

        {expanded && (
          <div className="space-y-1.5 pt-1 border-t border-border/20">
            {pedido.itens.map(it => (
              <div key={it.id} className="flex items-center gap-2 rounded-lg bg-muted/20 px-3 py-1.5">
                <Package className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium truncate">{it.device_model}</p>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <Tag className="h-2.5 w-2.5" />
                    <span className="font-mono">{it.lote}</span>
                    <span>·</span>
                    <span>{it.quantidade} un.</span>
                  </div>
                </div>
              </div>
            ))}
            {pedido.observacoes && (
              <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground/70 px-1 pt-1">
                <FileText className="h-3 w-3 mt-0.5 shrink-0" />
                <span>{pedido.observacoes}</span>
              </div>
            )}
          </div>
        )}

        <div className="space-y-1.5 pt-1 border-t border-border/20">
          <button type="button" onClick={() => setExpanded(v => !v)} className="w-full flex items-center justify-center gap-1.5 h-7 rounded-lg bg-muted/30 hover:bg-muted/60 text-muted-foreground text-[10px] transition-colors">
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? "Ocultar peças" : "Ver peças"}
          </button>
          {pedido.status === "pendente" && isAdmin && (
            <div className="flex gap-1.5">
              <button type="button" onClick={() => onFaturar(pedido)} className="flex-1 h-8 rounded-lg bg-success/10 hover:bg-success/20 text-success text-[11px] font-medium transition-colors flex items-center justify-center gap-1.5">
                <Receipt className="h-3.5 w-3.5" /> Faturar
              </button>
              <button type="button" onClick={() => onCancelar(pedido)} className="h-8 w-8 flex items-center justify-center rounded-lg bg-muted/30 hover:bg-destructive/15 hover:text-destructive text-muted-foreground transition-colors" title="Cancelar">
                <Ban className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Faturar ───────────────────────────────────────────────────────────

interface FaturarModalProps {
  pedido: PedidoCompleto | null;
  onClose: () => void;
  onSuccess: () => void;
}

function FaturarModal({ pedido, onClose, onSuccess }: FaturarModalProps) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);

  if (!pedido) return null;

  async function handleFaturar() {
    if (!pedido) return;
    setSaving(true);
    try {
      const { error: pedErr } = await supabase.from("pedidos_comerciais").update({ status: "faturado", faturado_por: user?.id, faturado_em: new Date().toISOString() }).eq("id", pedido.id);
      if (pedErr) throw pedErr;

      for (const item of pedido.itens) {
        const { data: sd } = await supabase.from("stock_items").select("quantity").eq("id", item.stock_item_id).single();
        const novaQtd = Math.max(0, ((sd as { quantity: number } | null)?.quantity ?? 0) - item.quantidade);
        await supabase.from("stock_items").update({ quantity: novaQtd }).eq("id", item.stock_item_id);
        await supabase.from("stock_movements").insert({ stock_item_id: item.stock_item_id, type: "saida", quantity: item.quantidade, lote: item.lote, notes: `Pedido comercial — cliente: ${pedido.cliente_nome}`, user_display_name: "Comercial" });
      }

      toast.success("Pedido faturado! Peças retiradas da expedição.");
      onSuccess();
    } catch {
      toast.error("Erro ao faturar pedido.");
    } finally {
      setSaving(false);
    }
  }

  const total = pedido.itens.reduce((s, i) => s + i.quantidade, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-card border border-border/30 p-5 space-y-4 shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-200">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl bg-success/10 flex items-center justify-center shrink-0"><Receipt className="h-4 w-4 text-success" /></div>
          <div>
            <p className="text-sm font-semibold">Faturar Pedido?</p>
            <p className="text-[12px] text-muted-foreground mt-0.5">{pedido.cliente_nome}</p>
          </div>
        </div>
        <div className="rounded-xl bg-muted/20 border border-border/30 px-3 py-2.5">
          <p className="text-[12px] text-muted-foreground"><strong className="text-foreground">{total} unidade{total !== 1 ? "s" : ""}</strong> serão retiradas da expedição e o pedido marcado como <strong>faturado</strong>.</p>
          <p className="text-[11px] text-muted-foreground/70 mt-1">Esta ação não pode ser desfeita.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors">Cancelar</button>
          <button type="button" onClick={handleFaturar} disabled={saving} className="flex-1 h-9 rounded-xl bg-success text-success-foreground text-sm font-semibold hover:bg-success/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5">
            {saving ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Receipt className="h-3.5 w-3.5" />}
            Faturar
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
}

function ClienteCard({ cliente: c, isAdmin, onPedido, onEditar, onExcluir }: ClienteCardProps) {
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
          <button type="button" onClick={() => onEditar(c)} className="flex-1 h-7 flex items-center justify-center gap-1 rounded-lg bg-muted/30 hover:bg-muted/60 text-muted-foreground text-[10px] transition-colors">
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

// ─── Histórico Geral Comercial ────────────────────────────────────────────────

interface HistoricoGeralProps {
  open: boolean;
  onClose: () => void;
}

function HistoricoGeralModal({ open, onClose }: HistoricoGeralProps) {
  const [movements, setMovements] = useState<AllMovement[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (open) {
      setLoading(true);
      fetchAllMovements(100).then((data) => {
        if (!cancelled) {
          // Filtra apenas movimentos da expedição (comercial)
          const expMov = data.filter(m => m.fase === "expedicao");
          setMovements(expMov);
          setLoading(false);
        }
      }).catch(() => { if (!cancelled) setLoading(false); });
    } else {
      setMovements([]);
    }
    return () => { cancelled = true; };
  }, [open]);

  async function load() {
    setLoading(true);
    const data = await fetchAllMovements(100);
    setMovements(data.filter(m => m.fase === "expedicao"));
    setLoading(false);
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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-card border border-border/30 shadow-xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in slide-in-from-bottom-4 duration-200">
        {/* Header */}
        <div className="relative px-5 pt-5 pb-3 shrink-0">
          <div className="absolute inset-0 bg-gradient-to-b from-violet-500/5 to-transparent" />
          <div className="relative flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-violet-500" />
                <p className="text-sm font-semibold">Histórico Geral — Expedição</p>
              </div>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                Últimas {movements.length} movimentações da expedição
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
              Nenhuma movimentação registrada na expedição
            </div>
          )}
          {!loading && movements.map((mv) => {
            const { date, time } = fmtDate(mv.created_at);
            const isEntrada = mv.type === "entrada";
            return (
              <div
                key={mv.id}
                className={cn(
                  "flex items-start gap-3 px-3 py-2.5 rounded-xl border transition-colors",
                  isEntrada ? "bg-success/4 border-success/15" : "bg-violet-500/4 border-violet-500/15"
                )}
              >
                {isEntrada
                  ? <ArrowDownCircle className="h-4 w-4 mt-0.5 text-success shrink-0" />
                  : <ArrowUpCircle className="h-4 w-4 mt-0.5 text-violet-500 shrink-0" />}
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-[12px] font-semibold text-foreground leading-snug line-clamp-1">{mv.device_model}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">{mv.device_reference}</p>
                  {mv.lote && (
                    <p className="flex items-center gap-1 text-[11px] font-mono font-semibold text-violet-500/80">
                      <Tag className="h-2.5 w-2.5" />Lote {mv.lote}
                    </p>
                  )}
                  {mv.reason && <p className="text-[11px] text-muted-foreground line-clamp-1">{mv.reason}</p>}
                  {mv.user_display_name && (
                    <p className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
                      <User className="h-2.5 w-2.5" />{mv.user_display_name}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={cn("text-[13px] font-bold tabular-nums", isEntrada ? "text-success" : "text-violet-500")}>
                    {isEntrada ? "+" : "-"}{mv.quantity}
                    <span className="text-[10px] font-normal ml-0.5 opacity-70">un.</span>
                  </span>
                  <span className="text-[10px] text-muted-foreground">{date}</span>
                  <span className="text-[10px] text-muted-foreground/60">{time}</span>
                </div>
              </div>
            );
          })}
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
  // Filtra apenas faturados
  const faturados = pedidos.filter(p => p.status === "faturado");

  const totalPecasFaturadas = faturados.reduce((sum, p) => sum + p.itens.reduce((s, i) => s + i.quantidade, 0), 0);
  const totalPedidosFaturados = faturados.length;

  // Ranking vendedoras
  const rankingVendedoras: Record<string, number> = {};
  for (const p of faturados) {
    const nome = p.vendedora_nome ?? "—";
    rankingVendedoras[nome] = (rankingVendedoras[nome] ?? 0) + p.itens.reduce((s, i) => s + i.quantidade, 0);
  }
  const rankingVendList = Object.entries(rankingVendedoras)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Ranking clientes
  const rankingClientes: Record<string, number> = {};
  for (const p of faturados) {
    rankingClientes[p.cliente_nome] = (rankingClientes[p.cliente_nome] ?? 0) + p.itens.reduce((s, i) => s + i.quantidade, 0);
  }
  const rankingClientesList = Object.entries(rankingClientes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // PDF da vendedora atual
  function downloadPdfVendedora() {
    const meusPedidos = faturados.filter(p => p.vendedora_nome === currentUserName);
    if (meusPedidos.length === 0) { toast.error("Nenhum pedido faturado seu encontrado."); return; }

    // Agrupa por peça
    const pecas: Record<string, { model: string; ref: string; total: number }> = {};
    for (const p of meusPedidos) {
      for (const i of p.itens) {
        const key = i.stock_item_id;
        if (!pecas[key]) pecas[key] = { model: i.device_model ?? "—", ref: i.device_reference ?? "—", total: 0 };
        pecas[key].total += i.quantidade;
      }
    }
    const pecasList = Object.values(pecas).sort((a, b) => b.total - a.total);

    // Monta HTML para impressão
    const html = `
      <!DOCTYPE html><html><head><meta charset="UTF-8">
      <title>Relatório — ${currentUserName}</title>
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
      <h1>📊 Relatório de Vendas</h1>
      <p class="sub">Vendedora: <strong>${currentUserName}</strong> &nbsp;·&nbsp; Gerado em: ${new Date().toLocaleDateString("pt-BR")} ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
      <table>
        <thead><tr><th>#</th><th>Peça</th><th>Referência</th><th>Qtd. Vendida</th></tr></thead>
        <tbody>
          ${pecasList.map((p, i) => `<tr><td>${i + 1}</td><td>${p.model}</td><td>${p.ref}</td><td class="total">${p.total}</td></tr>`).join("")}
        </tbody>
      </table>
      <p class="footer">Total de ${meusPedidos.length} pedido(s) faturado(s) &nbsp;·&nbsp; ${pecasList.reduce((s, p) => s + p.total, 0)} peças no total</p>
      </body></html>
    `;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, "_blank");
    setTimeout(() => { w?.print(); URL.revokeObjectURL(url); }, 500);
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
            <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Peças Faturadas</p>
            <p className="text-2xl font-bold tabular-nums text-violet-600 dark:text-violet-400">{totalPecasFaturadas.toLocaleString("pt-BR")}</p>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">{totalPedidosFaturados} pedido(s)</p>
          </div>
        </div>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
            <Clock className="h-5 w-5 text-amber-500" />
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Pendentes</p>
            <p className="text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
              {pedidos.filter(p => p.status === "pendente").length}
            </p>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">aguardando faturamento</p>
          </div>
        </div>
      </div>

      {/* Ranking Vendedoras */}
      <div className="rounded-2xl border border-border/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-500" />
          <p className="text-sm font-semibold">Ranking de Vendedoras</p>
          <span className="text-[11px] text-muted-foreground/60">(peças faturadas)</span>
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

      {/* Ranking Clientes */}
      <div className="rounded-2xl border border-border/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-violet-500" />
          <p className="text-sm font-semibold">Clientes que Mais Compraram</p>
          <span className="text-[11px] text-muted-foreground/60">(peças)</span>
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
  const { signOut, isAdmin, role } = useAuth();

  const isVendedora = role === "vendedora";
  const canAccess = isAdmin || isVendedora;

  // Nome da usuária logada
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  useEffect(() => {
    if (!user?.id) return;
    supabase.from("profiles").select("display_name").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => setCurrentUserName((data as { display_name?: string } | null)?.display_name ?? user?.email ?? null));
  }, [user?.id]);

  // Tema
  const [isDark, setIsDark] = useState(() => {
    const theme = getStoredTheme();
    if (theme === "system") return window.matchMedia("(prefers-color-scheme: dark)").matches;
    return theme === "dark";
  });

  const toggleTheme = useCallback(() => {
    const next = !isDark;
    setIsDark(next);
    applyTheme(next ? "dark" : "light");
  }, [isDark]);

  // Sub-tabs
  type SubTab = "dashboard" | "pedidos" | "clientes";
  const [subTab, setSubTab] = useState<SubTab>("pedidos");
  const [historicoOpen, setHistoricoOpen] = useState(false);

  // Peças da expedição (para criar pedidos)
  const { items: allItems, loading: loadingStock } = useStock("");
  const expedicaoItems = allItems.filter(i => i.fase === "expedicao" && i.quantity > 0);

  // Pedidos
  const [pedidos, setPedidos] = useState<PedidoCompleto[]>([]);
  const [loadingPedidos, setLoadingPedidos] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState<"todos" | "pendente" | "faturado" | "cancelado">("todos");
  const [novoPedidoOpen, setNovoPedidoOpen] = useState(false);
  const [faturarPedido, setFaturarPedido] = useState<PedidoCompleto | null>(null);
  const [cancelarPedido, setCancelarPedido] = useState<PedidoCompleto | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [pedidoComCliente, setPedidoComCliente] = useState<Cliente | null>(null);

  // Clientes
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loadingClientes, setLoadingClientes] = useState(true);
  const [clienteSearch, setClienteSearch] = useState("");
  const [clienteModal, setClienteModal] = useState(false);
  const [editCliente, setEditCliente] = useState<Cliente | null>(null);
  const [deleteCliente, setDeleteCliente] = useState<Cliente | null>(null);
  const [deletingCliente, setDeletingCliente] = useState(false);

  const loadPedidos = useCallback(async () => {
    setLoadingPedidos(true);
    try {
      const { data: pedidosData } = await supabase
        .from("pedidos_comerciais")
        .select("*, clientes(nome)")
        .order("created_at", { ascending: false });

      if (!pedidosData) { setPedidos([]); return; }

      const pedidoIds = pedidosData.map((p: Record<string, unknown>) => p.id as string);
      const { data: itensData } = await supabase
        .from("pedido_itens")
        .select("*, stock_items(devices(model, reference))")
        .in("pedido_id", pedidoIds.length > 0 ? pedidoIds : ["none"]);

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
        return { id: p.id as string, cliente_id: p.cliente_id as string, cliente_nome: c?.nome as string ?? "—", vendedora_nome: p.vendedora_nome as string | null, status: p.status as PedidoCompleto["status"], observacoes: p.observacoes as string | null, created_at: p.created_at as string, faturado_em: p.faturado_em as string | null, itens: itensPorPedido.get(p.id as string) ?? [] };
      }));
    } catch {
      toast.error("Erro ao carregar pedidos.");
    } finally {
      setLoadingPedidos(false);
    }
  }, []);

  const loadClientes = useCallback(async () => {
    setLoadingClientes(true);
    const { data } = await supabase.from("clientes").select("*").order("nome");
    setClientes((data as Cliente[]) ?? []);
    setLoadingClientes(false);
  }, []);

  useEffect(() => { loadPedidos(); loadClientes(); }, [loadPedidos, loadClientes]);

  async function handleCancelar() {
    if (!cancelarPedido) return;
    setCancelando(true);
    const { error } = await supabase.from("pedidos_comerciais").update({ status: "cancelado" }).eq("id", cancelarPedido.id);
    setCancelando(false);
    if (error) { toast.error("Erro ao cancelar."); return; }
    toast.success("Pedido cancelado.");
    setCancelarPedido(null);
    loadPedidos();
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

  const pedidosFiltrados = pedidos.filter(p => filtroStatus === "todos" || p.status === filtroStatus);
  const pedidosPendentes = pedidos.filter(p => p.status === "pendente").length;
  const clientesFiltrados = clientes.filter(c =>
    c.nome.toLowerCase().includes(clienteSearch.toLowerCase()) ||
    (c.documento ?? "").includes(clienteSearch) ||
    (c.telefone ?? "").includes(clienteSearch)
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border/40">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {/* Vendedoras não têm acesso ao Index, Admin tem voltar */}
            {isAdmin && (
              <button
                type="button"
                onClick={() => navigate("/")}
                className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <Logo className="h-7 object-contain" />
            <div className="flex items-center gap-2 ml-1">
              <ShoppingBag className="h-4 w-4 text-violet-500" />
              <h1 className="text-sm font-semibold">Comercial</h1>
              {!loadingPedidos && pedidosPendentes > 0 && (
                <span className="flex items-center gap-0.5 bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  <Clock className="h-2.5 w-2.5" />
                  {pedidosPendentes}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Atalho para Estoque — só admin vê */}
            {isAdmin && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/estoque")}
                className="h-8 gap-1.5 text-xs hidden sm:flex"
              >
                <Boxes className="h-3.5 w-3.5" />
                Estoque
              </Button>
            )}
            {/* Toggle tema */}
            <button
              type="button"
              onClick={toggleTheme}
              className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors"
              title={isDark ? "Modo claro" : "Modo escuro"}
            >
              {isDark
                ? <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
                : <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              }
            </button>
            <Button
              variant="ghost"
              size="sm"
              onClick={signOut}
              className="h-8 gap-1.5 text-xs"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sair</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-4 space-y-4">
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

            {/* Sub-tabs */}
            <div className="flex items-center gap-1 bg-muted/30 rounded-xl p-1">
              {([
                { id: "dashboard" as SubTab, label: "Dashboard", icon: LayoutDashboard, badge: 0 },
                { id: "pedidos" as SubTab, label: "Pedidos", icon: ShoppingBag, badge: pedidosPendentes },
                { id: "clientes" as SubTab, label: "Clientes", icon: User, badge: 0 },
              ]).map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSubTab(tab.id)}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg text-[12px] font-medium transition-all",
                    subTab === tab.id
                      ? "bg-card text-violet-600 dark:text-violet-400 shadow-sm border border-border/40"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <tab.icon className="h-3.5 w-3.5" />
                  {tab.label}
                  {tab.badge > 0 && (
                    <span className="min-w-[16px] h-4 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 text-[9px] font-bold px-1 flex items-center justify-center">
                      {tab.badge}
                    </span>
                  )}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setHistoricoOpen(true)}
                className="flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg text-[12px] font-medium text-muted-foreground hover:text-foreground transition-all"
                title="Histórico Geral"
              >
                <History className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Histórico</span>
              </button>
            </div>

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
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1 flex-wrap">
                    {(["todos", "pendente", "faturado", "cancelado"] as const).map(s => (
                      <button key={s} type="button" onClick={() => setFiltroStatus(s)} className={cn("h-7 px-2.5 rounded-full text-[11px] font-medium border transition-colors", filtroStatus === s ? "bg-violet-600 text-white border-violet-600" : "bg-muted/30 text-muted-foreground border-border/50 hover:bg-muted/60")}>
                        {{ todos: "Todos", pendente: "⏳ Pendentes", faturado: "✅ Faturados", cancelado: "🚫 Cancelados" }[s]}
                      </button>
                    ))}
                  </div>
                  <Button size="sm" className="h-8 gap-1.5 text-xs rounded-lg bg-violet-600 hover:bg-violet-500 shrink-0" onClick={() => { setPedidoComCliente(null); setNovoPedidoOpen(true); }}>
                    <Plus className="h-3.5 w-3.5" /> Novo Pedido
                  </Button>
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
                      <PedidoCard key={p.id} pedido={p} isAdmin={isAdmin} onFaturar={setFaturarPedido} onCancelar={setCancelarPedido} />
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
                    <Input placeholder="Buscar cliente..." value={clienteSearch} onChange={e => setClienteSearch(e.target.value)} className="pl-9 h-9 text-sm" />
                    {clienteSearch && <button type="button" onClick={() => setClienteSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
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
                    <p className="text-muted-foreground font-medium">{clienteSearch ? "Nenhum cliente encontrado" : "Nenhum cliente cadastrado"}</p>
                    {!clienteSearch && (
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
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* ── Modais ── */}
      <NovoPedidoModal
        open={novoPedidoOpen}
        onClose={() => { setNovoPedidoOpen(false); setPedidoComCliente(null); }}
        onSuccess={() => { setNovoPedidoOpen(false); setPedidoComCliente(null); loadPedidos(); }}
        clienteFixo={pedidoComCliente}
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
        onSuccess={() => { setFaturarPedido(null); loadPedidos(); }}
      />

      {/* Cancelar pedido */}
      {cancelarPedido && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
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
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
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
    </div>
  );
}
