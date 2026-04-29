/**
 * ComercialPanel — Aba Comercial
 *
 * Acessível apenas para vendedoras (e admins).
 * Fluxo:
 *  1. Vendedora seleciona/cria cliente
 *  2. Visualiza peças disponíveis na expedição (prontas para venda)
 *  3. Cria pedido selecionando peças + lote + quantidade
 *  4. As peças ficam "reservadas" no estoque
 *  5. Estoque fatura o pedido → peças saem da expedição
 */

import { useState, useEffect, useCallback, useRef } from "react";
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
  AlertTriangle,
  ShoppingCart,
  Truck,
  Receipt,
  Ban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import type { StockItem } from "@/hooks/useStock";
import * as XLSX from "xlsx";
import { Download } from "lucide-react";

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

// ─── Modal: Cadastrar / Editar Cliente ───────────────────────────────────────

interface ClienteModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (cliente: Cliente) => void;
  inicial?: Cliente | null;
}

function ClienteModal({ open, onClose, onSuccess, inicial }: ClienteModalProps) {
  const { user } = useAuth();
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [documento, setDocumento] = useState(inicial?.documento ?? "");
  const [telefone, setTelefone] = useState(inicial?.telefone ?? "");
  const [email, setEmail] = useState(inicial?.email ?? "");
  const [endereco, setEndereco] = useState(inicial?.endereco ?? "");
  const [obs, setObs] = useState(inicial?.observacoes ?? "");
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
          .eq("id", inicial.id)
          .select()
          .single();
        if (error) throw error;
        data = d as Cliente;
      } else {
        const { data: d, error } = await supabase
          .from("clientes")
          .insert({ nome: nome.trim(), documento: documento || null, telefone: telefone || null, email: email || null, endereco: endereco || null, observacoes: obs || null, created_by: user?.id })
          .select()
          .single();
        if (error) throw error;
        data = d as Cliente;
      }
      toast.success(inicial ? "Cliente atualizado!" : "Cliente cadastrado!");
      onSuccess(data!);
    } catch (e: unknown) {
      toast.error("Erro ao salvar cliente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-card border border-border/30 shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/30">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-violet-500" />
            <p className="text-sm font-semibold">{inicial ? "Editar Cliente" : "Novo Cliente"}</p>
          </div>
          <button type="button" onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Nome *</label>
            <Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome do cliente" className="h-9 text-sm" autoFocus />
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
            <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="cliente@email.com" className="h-9 text-sm" type="email" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Endereço</label>
            <Input value={endereco} onChange={e => setEndereco(e.target.value)} placeholder="Rua, número, cidade..." className="h-9 text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Observações</label>
            <textarea
              value={obs}
              onChange={e => setObs(e.target.value)}
              placeholder="Informações adicionais..."
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none min-h-[60px] focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
        <div className="flex gap-2 p-5 pt-0">
          <button type="button" onClick={onClose} className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors" disabled={saving}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !nome.trim()}
            className="flex-1 h-9 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {saving ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {inicial ? "Salvar" : "Cadastrar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Criar Pedido ──────────────────────────────────────────────────────

interface NovoPedidoModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  clienteFixo?: Cliente | null;
  expedicaoItems: StockItem[];
}

function NovoPedidoModal({ open, onClose, onSuccess, clienteFixo, expedicaoItems }: NovoPedidoModalProps) {
  const { user } = useAuth();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [clienteId, setClienteId] = useState(clienteFixo?.id ?? "");
  const [clienteSearch, setClienteSearch] = useState(clienteFixo?.nome ?? "");
  const [showClienteDrop, setShowClienteDrop] = useState(false);
  const [obs, setObs] = useState("");
  const [itens, setItens] = useState<PedidoItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [clienteModal, setClienteModal] = useState(false);

  // Seleção de peças
  const [pecaSearch, setPecaSearch] = useState("");
  const [showPecaDrop, setShowPecaDrop] = useState(false);
  const [selectedPeca, setSelectedPeca] = useState<StockItem | null>(null);
  const [lote, setLote] = useState("");
  const [qtd, setQtd] = useState(1);

  const dropRef = useRef<HTMLDivElement>(null);
  const pecaDropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setClienteId(clienteFixo?.id ?? "");
    setClienteSearch(clienteFixo?.nome ?? "");
    setItens([]);
    setObs("");
    setPecaSearch("");
    setSelectedPeca(null);
    setLote("");
    setQtd(1);
    loadClientes();
  }, [open, clienteFixo]);

  async function loadClientes() {
    const { data } = await supabase.from("clientes").select("*").order("nome");
    setClientes((data as Cliente[]) ?? []);
  }

  // Fechar dropdowns ao clicar fora
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setShowClienteDrop(false);
      if (pecaDropRef.current && !pecaDropRef.current.contains(e.target as Node)) setShowPecaDrop(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const clientesFiltrados = clientes.filter(c =>
    c.nome.toLowerCase().includes(clienteSearch.toLowerCase()) ||
    (c.documento ?? "").includes(clienteSearch)
  );

  const expedicaoDisponiveis = expedicaoItems.filter(i =>
    i.quantity > 0 &&
    (i.device?.model?.toLowerCase().includes(pecaSearch.toLowerCase()) ||
     i.device?.reference?.toLowerCase().includes(pecaSearch.toLowerCase()))
  );

  function addItem() {
    if (!selectedPeca || !lote.trim() || qtd < 1) return;
    const disponivel = selectedPeca.quantity;
    const jaReservado = itens.filter(i => i.stock_item_id === selectedPeca.id).reduce((s, i) => s + i.quantidade, 0);
    if (qtd > (disponivel - jaReservado)) {
      toast.error(`Apenas ${disponivel - jaReservado} unidades disponíveis`);
      return;
    }
    setItens(prev => [...prev, {
      stock_item_id: selectedPeca.id,
      lote: lote.trim(),
      quantidade: qtd,
      device_model: selectedPeca.device?.model ?? "",
      device_reference: selectedPeca.device?.reference ?? "",
    }]);
    setSelectedPeca(null);
    setPecaSearch("");
    setLote("");
    setQtd(1);
  }

  async function handleSave() {
    if (!clienteId) { toast.error("Selecione um cliente"); return; }
    if (itens.length === 0) { toast.error("Adicione ao menos uma peça"); return; }
    setSaving(true);
    try {
      // Pegar nome do usuário para registrar
      const { data: profile } = await supabase.from("profiles").select("display_name").eq("user_id", user?.id).maybeSingle();
      const vendedoraNome = (profile as { display_name?: string } | null)?.display_name ?? user?.email ?? "Vendedora";

      const { data: pedido, error: pedidoErr } = await supabase
        .from("pedidos_comerciais")
        .insert({ cliente_id: clienteId, vendedora_id: user?.id, vendedora_nome: vendedoraNome, observacoes: obs || null })
        .select()
        .single();

      if (pedidoErr) throw pedidoErr;

      const pedidoId = (pedido as { id: string }).id;

      const itensInsert = itens.map(i => ({
        pedido_id: pedidoId,
        stock_item_id: i.stock_item_id,
        lote: i.lote,
        quantidade: i.quantidade,
        quantidade_reservada: i.quantidade,
      }));

      const { error: itensErr } = await supabase.from("pedido_itens").insert(itensInsert);
      if (itensErr) throw itensErr;

      toast.success("Pedido criado! Peças reservadas na expedição.");
      onSuccess();
    } catch {
      toast.error("Erro ao criar pedido.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-card border border-border/30 shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
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
          {/* Cliente */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Cliente *</label>
            <div className="relative" ref={dropRef}>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Buscar cliente..."
                    value={clienteSearch}
                    onChange={e => { setClienteSearch(e.target.value); setClienteId(""); setShowClienteDrop(true); }}
                    onFocus={() => setShowClienteDrop(true)}
                    className="pl-9 h-9 text-sm"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setClienteModal(true)}
                  className="h-9 w-9 flex items-center justify-center rounded-lg bg-violet-500/10 hover:bg-violet-500/20 text-violet-500 transition-colors shrink-0"
                  title="Novo cliente"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                </button>
              </div>
              {showClienteDrop && clientesFiltrados.length > 0 && (
                <div className="absolute top-full mt-1 left-0 right-0 z-50 rounded-xl border border-border bg-card shadow-xl overflow-hidden max-h-48 overflow-y-auto">
                  {clientesFiltrados.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => { setClienteId(c.id); setClienteSearch(c.nome); setShowClienteDrop(false); }}
                      className="w-full text-left px-4 py-2.5 hover:bg-muted/40 transition-colors border-b border-border/20 last:border-0"
                    >
                      <p className="text-sm font-medium">{c.nome}</p>
                      {c.documento && <p className="text-[11px] text-muted-foreground">{c.documento}</p>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {clienteId && (
              <p className="text-[11px] text-violet-500 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Cliente selecionado
              </p>
            )}
          </div>

          {/* Seleção de peças */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Adicionar Peça</label>
            <div className="rounded-xl border border-border/50 bg-muted/10 p-3 space-y-2">
              {/* Busca de peça */}
              <div className="relative" ref={pecaDropRef}>
                <Package className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Buscar peça na expedição..."
                  value={pecaSearch}
                  onChange={e => { setPecaSearch(e.target.value); setShowPecaDrop(true); setSelectedPeca(null); }}
                  onFocus={() => setShowPecaDrop(true)}
                  className="pl-9 h-9 text-sm"
                />
                {selectedPeca && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  </div>
                )}
                {showPecaDrop && pecaSearch && expedicaoDisponiveis.length > 0 && (
                  <div className="absolute top-full mt-1 left-0 right-0 z-50 rounded-xl border border-border bg-card shadow-xl overflow-hidden max-h-48 overflow-y-auto">
                    {expedicaoDisponiveis.map(item => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => { setSelectedPeca(item); setPecaSearch(item.device?.model ?? ""); setShowPecaDrop(false); }}
                        className="w-full text-left px-4 py-2.5 hover:bg-muted/40 transition-colors border-b border-border/20 last:border-0"
                      >
                        <p className="text-sm font-medium">{item.device?.model}</p>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span>{item.device?.reference}</span>
                          <span className="text-success font-semibold">{item.quantity} disp.</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {showPecaDrop && pecaSearch && expedicaoDisponiveis.length === 0 && (
                  <div className="absolute top-full mt-1 left-0 right-0 z-50 rounded-xl border border-border bg-card shadow-xl p-3 text-center">
                    <p className="text-xs text-muted-foreground">Nenhuma peça disponível</p>
                  </div>
                )}
              </div>

              {/* Lote e quantidade */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground font-medium">Lote</label>
                  <div className="relative">
                    <Tag className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                    <Input value={lote} onChange={e => setLote(formatLote(e.target.value))} placeholder="0101261-01" className="pl-7 h-8 text-xs font-mono" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground font-medium">Quantidade</label>
                  <Input type="number" min={1} value={qtd} onChange={e => setQtd(Math.max(1, parseInt(e.target.value) || 1))} className="h-8 text-xs" />
                </div>
              </div>

              <button
                type="button"
                onClick={addItem}
                disabled={!selectedPeca || !lote.trim() || qtd < 1}
                className="w-full h-8 rounded-lg bg-violet-500/10 hover:bg-violet-500/20 text-violet-600 dark:text-violet-400 text-xs font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" /> Adicionar ao pedido
              </button>
            </div>

            {/* Lista de itens adicionados */}
            {itens.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] text-muted-foreground font-medium">{itens.length} item{itens.length > 1 ? "s" : ""} no pedido</p>
                <div className="space-y-1">
                  {itens.map((it, idx) => (
                    <div key={idx} className="flex items-center gap-2 rounded-lg bg-muted/20 border border-border/30 px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium truncate">{it.device_model}</p>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span className="font-mono">{it.lote}</span>
                          <span>·</span>
                          <span>{it.quantidade} un.</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setItens(prev => prev.filter((_, i) => i !== idx))}
                        className="h-6 w-6 flex items-center justify-center rounded-lg hover:bg-destructive/15 hover:text-destructive text-muted-foreground transition-colors shrink-0"
                      >
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
            <textarea
              value={obs}
              onChange={e => setObs(e.target.value)}
              placeholder="Informações adicionais sobre o pedido..."
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none min-h-[60px] focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 p-5 border-t border-border/30 shrink-0">
          <button type="button" onClick={onClose} className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors" disabled={saving}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !clienteId || itens.length === 0}
            className="flex-1 h-9 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {saving ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <ShoppingCart className="h-3.5 w-3.5" />}
            Criar Pedido
          </button>
        </div>
      </div>

      {clienteModal && (
        <ClienteModal
          open
          onClose={() => setClienteModal(false)}
          onSuccess={(c) => { loadClientes(); setClienteId(c.id); setClienteSearch(c.nome); setClienteModal(false); }}
        />
      )}
    </div>
  );
}

// ─── Card de Pedido ───────────────────────────────────────────────────────────

interface PedidoCardProps {
  pedido: PedidoCompleto;
  isAdmin: boolean;
  onFaturar: (pedido: PedidoCompleto) => void;
  onCancelar: (pedido: PedidoCompleto) => void;
  onRefresh: () => void;
}

function PedidoCard({ pedido, isAdmin, onFaturar, onCancelar }: PedidoCardProps) {
  const [expanded, setExpanded] = useState(false);

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

  const statusLabel = { pendente: "Pendente", faturado: "Faturado", cancelado: "Cancelado" }[pedido.status];

  const totalItens = pedido.itens.reduce((s, i) => s + i.quantidade, 0);
  const data = new Date(pedido.created_at).toLocaleDateString("pt-BR");
  const hora = new Date(pedido.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div
      className="group relative rounded-2xl bg-card overflow-hidden transition-all duration-300 hover:-translate-y-0.5"
      style={{ boxShadow: "0 1px 2px hsl(var(--border) / 0.3), 0 4px 12px -2px hsl(var(--border) / 0.15), inset 0 1px 0 hsl(0 0% 100% / 0.06)" }}
    >
      <div className={cn(
        "h-0.5 bg-gradient-to-r from-transparent to-transparent transition-opacity group-hover:opacity-100",
        pedido.status === "pendente" ? "via-amber-500 opacity-70" :
        pedido.status === "faturado" ? "via-success opacity-60" : "via-muted-foreground/40 opacity-30"
      )} />

      <div className="p-4 space-y-3">
        {/* Cabeçalho */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <User className="h-3 w-3 text-violet-500 shrink-0" />
              <h3 className="text-[13px] font-semibold truncate">{pedido.cliente_nome}</h3>
            </div>
            <p className="text-[11px] text-muted-foreground/70">{pedido.vendedora_nome}</p>
          </div>
          <Badge variant="outline" className={cn("shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-lg flex items-center gap-1", statusColor)}>
            {statusIcon} {statusLabel}
          </Badge>
        </div>

        {/* Resumo */}
        <div className="flex items-center justify-between rounded-xl px-3 py-2 border bg-muted/20 border-border/30">
          <div className="flex items-center gap-1.5">
            <ShoppingBag className="h-3.5 w-3.5 text-violet-500" />
            <span className="text-[11px] font-medium text-muted-foreground">{pedido.itens.length} tipo{pedido.itens.length !== 1 ? "s" : ""} de peça</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[15px] font-bold tabular-nums text-foreground">{totalItens}</span>
            <span className="text-[10px] text-muted-foreground">un.</span>
          </div>
        </div>

        {/* Data */}
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
          <Clock className="h-3 w-3" />
          <span>{data} às {hora}</span>
        </div>

        {/* Itens expandidos */}
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

        {/* Botões */}
        <div className="space-y-1.5 pt-1 border-t border-border/20">
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="w-full flex items-center justify-center gap-1.5 h-7 rounded-lg bg-muted/30 hover:bg-muted/60 text-muted-foreground text-[10px] transition-colors"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? "Ocultar peças" : "Ver peças"}
          </button>

          {pedido.status === "pendente" && isAdmin && (
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => onFaturar(pedido)}
                className="flex-1 h-8 rounded-lg bg-success/10 hover:bg-success/20 text-success text-[11px] font-medium transition-colors flex items-center justify-center gap-1.5"
              >
                <Receipt className="h-3.5 w-3.5" /> Faturar
              </button>
              <button
                type="button"
                onClick={() => onCancelar(pedido)}
                className="h-8 w-8 flex items-center justify-center rounded-lg bg-muted/30 hover:bg-destructive/15 hover:text-destructive text-muted-foreground transition-colors"
                title="Cancelar pedido"
              >
                <Ban className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Confirmar Faturamento ─────────────────────────────────────────────

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
      // 1. Marcar pedido como faturado
      const { error: pedErr } = await supabase
        .from("pedidos_comerciais")
        .update({ status: "faturado", faturado_por: user?.id, faturado_em: new Date().toISOString() })
        .eq("id", pedido.id);
      if (pedErr) throw pedErr;

      // 2. Para cada item: registrar saída na expedição
      for (const item of pedido.itens) {
        // Buscar qtd atual
        const { data: stockData } = await supabase
          .from("stock_items")
          .select("quantity")
          .eq("id", item.stock_item_id)
          .single();

        const qtdAtual = (stockData as { quantity: number } | null)?.quantity ?? 0;
        const novaQtd = Math.max(0, qtdAtual - item.quantidade);

        // Atualizar quantity
        await supabase.from("stock_items").update({ quantity: novaQtd }).eq("id", item.stock_item_id);

        // Registrar movimento
        await supabase.from("stock_movements").insert({
          stock_item_id: item.stock_item_id,
          type: "saida",
          quantity: item.quantidade,
          lote: item.lote,
          notes: `Pedido comercial #${pedido.id.slice(0, 8)} — cliente: ${pedido.cliente_nome}`,
          user_display_name: "Estoque",
        });
      }

      toast.success("Pedido faturado! Peças retiradas da expedição.");
      onSuccess();
    } catch {
      toast.error("Erro ao faturar pedido.");
    } finally {
      setSaving(false);
    }
  }

  const totalItens = pedido.itens.reduce((s, i) => s + i.quantidade, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-card border border-border/30 p-5 space-y-4 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl bg-success/10 flex items-center justify-center shrink-0">
            <Receipt className="h-4 w-4 text-success" />
          </div>
          <div>
            <p className="text-sm font-semibold">Faturar Pedido?</p>
            <p className="text-[12px] text-muted-foreground mt-0.5">{pedido.cliente_nome}</p>
          </div>
        </div>
        <div className="rounded-xl bg-muted/20 border border-border/30 px-3 py-2.5 space-y-1">
          <p className="text-[12px] text-muted-foreground">
            <strong className="text-foreground">{totalItens} unidade{totalItens !== 1 ? "s" : ""}</strong> serão retiradas da expedição e o pedido será marcado como <strong>faturado</strong>.
          </p>
          <p className="text-[11px] text-muted-foreground/70">Esta ação não pode ser desfeita.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button
            type="button"
            className="flex-1 h-9 rounded-xl bg-success text-success-foreground text-sm font-semibold hover:bg-success/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5"
            onClick={handleFaturar}
            disabled={saving}
          >
            {saving ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Receipt className="h-3.5 w-3.5" />}
            Faturar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Painel Principal ─────────────────────────────────────────────────────────

interface ComercialPanelProps {
  isAdmin: boolean;
  isVendedora: boolean;
  expedicaoItems: StockItem[];
}

// ─── Export Excel Comercial ──────────────────────────────────────────────────
async function exportExcelComercial() {
  const { data: pedidosData, error } = await supabase
    .from("pedidos_comerciais")
    .select("*, clientes(nome)")
    .order("created_at", { ascending: false });

  if (error || !pedidosData) {
    const { toast: t } = await import("sonner");
    t.error("Erro ao buscar dados dos pedidos.");
    return;
  }

  const pedidoIds = pedidosData.map((p: Record<string, unknown>) => p.id as string);

  const { data: itensData } = await supabase
    .from("pedido_itens")
    .select("*, stock_items(devices(model, reference))")
    .in("pedido_id", pedidoIds.length > 0 ? pedidoIds : ["none"]);

  const statusLabel: Record<string, string> = {
    pendente: "Pendente",
    faturado: "Faturado",
    cancelado: "Cancelado",
  };

  // Aba 1: Pedidos
  const pedidosRows = pedidosData.map((p: Record<string, unknown>) => {
    const c = p.clientes as Record<string, unknown> | null;
    return {
      "Pedido ID":     String(p.id).slice(0, 8).toUpperCase(),
      "Cliente":       String(c?.nome ?? "—"),
      "Vendedora":     String(p.vendedora_nome ?? "—"),
      "Status":        statusLabel[p.status as string] ?? String(p.status),
      "Observações":   String(p.observacoes ?? ""),
      "Criado em":     p.created_at ? new Date(p.created_at as string).toLocaleDateString("pt-BR") : "",
      "Faturado em":   p.faturado_em ? new Date(p.faturado_em as string).toLocaleDateString("pt-BR") : "",
    };
  });

  // Aba 2: Itens dos Pedidos
  const itensRows = (itensData ?? []).map((it: Record<string, unknown>) => {
    const stockItem = it.stock_items as Record<string, unknown> | null;
    const device = stockItem?.devices as Record<string, unknown> | null;
    const pedido = pedidosData.find((p: Record<string, unknown>) => p.id === it.pedido_id) as Record<string, unknown> | undefined;
    const cliente = pedido?.clientes as Record<string, unknown> | null;
    return {
      "Pedido ID":    String(it.pedido_id).slice(0, 8).toUpperCase(),
      "Cliente":      String(cliente?.nome ?? "—"),
      "Modelo":       String(device?.model ?? "—"),
      "Referência":   String(device?.reference ?? "—"),
      "Lote":         String(it.lote ?? ""),
      "Quantidade":   Number(it.quantidade ?? 0),
      "Status Pedido": statusLabel[pedido?.status as string ?? ""] ?? String(pedido?.status ?? ""),
    };
  });

  const wb = XLSX.utils.book_new();

  // Aba Pedidos
  const wsPedidos = XLSX.utils.json_to_sheet(pedidosRows.length > 0 ? pedidosRows : [{ "Pedido ID": "", "Cliente": "", "Vendedora": "", "Status": "", "Observações": "", "Criado em": "", "Faturado em": "" }]);
  wsPedidos["!cols"] = [{ wch: 12 }, { wch: 28 }, { wch: 20 }, { wch: 12 }, { wch: 30 }, { wch: 14 }, { wch: 14 }];
  wsPedidos["!freeze"] = { xSplit: 0, ySplit: 1 };
  const pedidosKeys = ["Pedido ID","Cliente","Vendedora","Status","Observações","Criado em","Faturado em"];
  pedidosKeys.forEach((_, colIdx) => {
    const cellAddr = XLSX.utils.encode_cell({ r: 0, c: colIdx });
    if (!wsPedidos[cellAddr]) return;
    wsPedidos[cellAddr].s = {
      font: { bold: true, color: { rgb: "FFFFFF" }, name: "Arial", sz: 10 },
      fill: { fgColor: { rgb: "4C1D95" }, patternType: "solid" },
      alignment: { horizontal: "center", vertical: "center" },
    };
  });
  pedidosRows.forEach((row, rowIdx) => {
    const isEven = rowIdx % 2 === 0;
    pedidosKeys.forEach((key, colIdx) => {
      const cellAddr = XLSX.utils.encode_cell({ r: rowIdx + 1, c: colIdx });
      if (!wsPedidos[cellAddr]) return;
      const status = row["Status"];
      let fill = isEven ? "F5F0FF" : "FFFFFF";
      let fontColor = "222222";
      if (key === "Status") {
        if (status === "Pendente") { fill = "FFF7E0"; fontColor = "B45309"; }
        if (status === "Faturado") { fill = "EAFFEA"; fontColor = "166534"; }
        if (status === "Cancelado") { fill = "FFEAEA"; fontColor = "CC0000"; }
      }
      wsPedidos[cellAddr].s = {
        font: { name: "Arial", sz: 10, color: { rgb: fontColor }, bold: key === "Status" },
        fill: { fgColor: { rgb: fill }, patternType: "solid" },
        alignment: { horizontal: "left", vertical: "center" },
        border: { bottom: { style: "thin", color: { rgb: "E0E0E0" } }, right: { style: "thin", color: { rgb: "E0E0E0" } } },
      };
    });
  });
  XLSX.utils.book_append_sheet(wb, wsPedidos, "Pedidos");

  // Aba Itens
  const wsItens = XLSX.utils.json_to_sheet(itensRows.length > 0 ? itensRows : [{ "Pedido ID": "", "Cliente": "", "Modelo": "", "Referência": "", "Lote": "", "Quantidade": 0, "Status Pedido": "" }]);
  wsItens["!cols"] = [{ wch: 12 }, { wch: 24 }, { wch: 36 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 14 }];
  wsItens["!freeze"] = { xSplit: 0, ySplit: 1 };
  const itensKeys = ["Pedido ID","Cliente","Modelo","Referência","Lote","Quantidade","Status Pedido"];
  itensKeys.forEach((_, colIdx) => {
    const cellAddr = XLSX.utils.encode_cell({ r: 0, c: colIdx });
    if (!wsItens[cellAddr]) return;
    wsItens[cellAddr].s = {
      font: { bold: true, color: { rgb: "FFFFFF" }, name: "Arial", sz: 10 },
      fill: { fgColor: { rgb: "4C1D95" }, patternType: "solid" },
      alignment: { horizontal: "center", vertical: "center" },
    };
  });
  itensRows.forEach((row, rowIdx) => {
    const isEven = rowIdx % 2 === 0;
    itensKeys.forEach((key, colIdx) => {
      const cellAddr = XLSX.utils.encode_cell({ r: rowIdx + 1, c: colIdx });
      if (!wsItens[cellAddr]) return;
      wsItens[cellAddr].s = {
        font: { name: "Arial", sz: 10, color: { rgb: "222222" }, bold: key === "Quantidade" },
        fill: { fgColor: { rgb: isEven ? "F5F0FF" : "FFFFFF" }, patternType: "solid" },
        alignment: { horizontal: key === "Quantidade" ? "center" : "left", vertical: "center" },
        border: { bottom: { style: "thin", color: { rgb: "E0E0E0" } }, right: { style: "thin", color: { rgb: "E0E0E0" } } },
      };
    });
  });
  XLSX.utils.book_append_sheet(wb, wsItens, "Itens dos Pedidos");

  // Aba Resumo
  const total = pedidosData.length;
  const pendentes = pedidosData.filter((p: Record<string, unknown>) => p.status === "pendente").length;
  const faturados = pedidosData.filter((p: Record<string, unknown>) => p.status === "faturado").length;
  const cancelados = pedidosData.filter((p: Record<string, unknown>) => p.status === "cancelado").length;
  const summaryData = [
    { "Indicador": "Total de pedidos",    "Valor": total },
    { "Indicador": "Pedidos pendentes",   "Valor": pendentes },
    { "Indicador": "Pedidos faturados",   "Valor": faturados },
    { "Indicador": "Pedidos cancelados",  "Valor": cancelados },
    { "Indicador": "Total de itens",      "Valor": (itensData ?? []).length },
    { "Indicador": "Data de exportação",  "Valor": new Date().toLocaleString("pt-BR") },
  ];
  const wsResumo = XLSX.utils.json_to_sheet(summaryData);
  wsResumo["!cols"] = [{ wch: 30 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, wsResumo, "Resumo");

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array", cellStyles: true });
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `comercial-${new Date().toLocaleDateString("pt-BR").replace(/\//g, "-")}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
  const { toast: t } = await import("sonner");
  t.success(`${total} pedido${total !== 1 ? "s" : ""} exportado${total !== 1 ? "s" : ""} para Excel (.xlsx).`);
}

export function ComercialPanel({ isAdmin, isVendedora, expedicaoItems }: ComercialPanelProps) {
  const { role } = useAuth();
  const canAccess = isAdmin || isVendedora;

  // Tabs internas
  type SubTab = "pedidos" | "clientes";
  const [subTab, setSubTab] = useState<SubTab>("pedidos");

  // Pedidos
  const [pedidos, setPedidos] = useState<PedidoCompleto[]>([]);
  const [loadingPedidos, setLoadingPedidos] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState<"todos" | "pendente" | "faturado" | "cancelado">("todos");
  const [novoPedidoOpen, setNovoPedidoOpen] = useState(false);
  const [faturarPedido, setFaturarPedido] = useState<PedidoCompleto | null>(null);
  const [cancelarPedido, setCancelarPedido] = useState<PedidoCompleto | null>(null);
  const [cancelando, setCancelando] = useState(false);

  // Clientes
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loadingClientes, setLoadingClientes] = useState(true);
  const [clienteModal, setClienteModal] = useState(false);
  const [editCliente, setEditCliente] = useState<Cliente | null>(null);
  const [deleteCliente, setDeleteCliente] = useState<Cliente | null>(null);
  const [deletingCliente, setDeletingCliente] = useState(false);
  const [clienteSearch, setClienteSearch] = useState("");
  const [pedidoComCliente, setPedidoComCliente] = useState<Cliente | null>(null);

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
        const stockItem = it.stock_items as Record<string, unknown> | null;
        const device = stockItem?.devices as Record<string, unknown> | null;
        itensPorPedido.get(pid)!.push({
          id: it.id as string,
          stock_item_id: it.stock_item_id as string,
          lote: it.lote as string,
          quantidade: it.quantidade as number,
          quantidade_reservada: it.quantidade_reservada as number,
          device_model: device?.model as string | undefined,
          device_reference: device?.reference as string | undefined,
        });
      }

      const mapped: PedidoCompleto[] = pedidosData.map((p: Record<string, unknown>) => {
        const c = p.clientes as Record<string, unknown> | null;
        return {
          id: p.id as string,
          cliente_id: p.cliente_id as string,
          cliente_nome: c?.nome as string ?? "—",
          vendedora_nome: p.vendedora_nome as string | null,
          status: p.status as PedidoCompleto["status"],
          observacoes: p.observacoes as string | null,
          created_at: p.created_at as string,
          faturado_em: p.faturado_em as string | null,
          itens: itensPorPedido.get(p.id as string) ?? [],
        };
      });

      setPedidos(mapped);
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

  if (!canAccess) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
        <ShoppingBag className="h-10 w-10 text-muted-foreground/30" />
        <p className="text-muted-foreground font-medium">Acesso restrito</p>
        <p className="text-sm text-muted-foreground/60">Esta área é exclusiva para vendedoras.</p>
      </div>
    );
  }

  const pedidosFiltrados = pedidos.filter(p => filtroStatus === "todos" || p.status === filtroStatus);
  const clientesFiltrados = clientes.filter(c =>
    c.nome.toLowerCase().includes(clienteSearch.toLowerCase()) ||
    (c.documento ?? "").includes(clienteSearch) ||
    (c.telefone ?? "").includes(clienteSearch)
  );

  const pedidosPendentes = pedidos.filter(p => p.status === "pendente").length;

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
    const { error } = await supabase.from("clientes").delete().eq("id", deleteCliente.id);
    setDeletingCliente(false);
    if (error) { toast.error("Erro ao excluir. Pode haver pedidos vinculados."); return; }
    toast.success("Cliente excluído.");
    setDeleteCliente(null);
    loadClientes();
  }

  return (
    <div className="space-y-4">
      {/* Info */}
      <div className="rounded-xl border bg-violet-500/5 border-violet-500/20 text-violet-600 dark:text-violet-400 px-4 py-3 text-[12px]">
        Área comercial — cadastre clientes, visualize peças disponíveis na expedição e registre pedidos. O estoque fatura e as peças saem automaticamente.
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 bg-muted/30 rounded-xl p-1">
        {([
          { id: "pedidos", label: "Pedidos", icon: ShoppingBag, badge: pedidosPendentes },
          { id: "clientes", label: "Clientes", icon: User, badge: 0 },
        ] as const).map(tab => (
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
      </div>

      {/* ── Aba Pedidos ── */}
      {subTab === "pedidos" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            {/* Filtro status */}
            <div className="flex items-center gap-1 flex-wrap">
              {([
                { value: "todos", label: "Todos" },
                { value: "pendente", label: "⏳ Pendentes" },
                { value: "faturado", label: "✅ Faturados" },
                { value: "cancelado", label: "🚫 Cancelados" },
              ] as const).map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setFiltroStatus(opt.value)}
                  className={cn(
                    "h-7 px-2.5 rounded-full text-[11px] font-medium border transition-colors",
                    filtroStatus === opt.value
                      ? "bg-violet-600 text-white border-violet-600"
                      : "bg-muted/30 text-muted-foreground border-border/50 hover:bg-muted/60"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs rounded-lg border-violet-500/30 text-violet-600 dark:text-violet-400 hover:bg-violet-500/10"
                onClick={() => exportExcelComercial()}
              >
                <Download className="h-3.5 w-3.5" /> Excel
              </Button>
              <Button
                size="sm"
                className="h-8 gap-1.5 text-xs rounded-lg bg-violet-600 hover:bg-violet-500"
                onClick={() => setNovoPedidoOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" /> Novo Pedido
              </Button>
            </div>
          </div>

          {loadingPedidos ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-7 w-7 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : pedidosFiltrados.length === 0 ? (
            <div className="text-center py-16 space-y-2">
              <ShoppingBag className="h-10 w-10 text-muted-foreground/30 mx-auto" />
              <p className="text-muted-foreground font-medium">Nenhum pedido encontrado</p>
              <button
                type="button"
                onClick={() => setNovoPedidoOpen(true)}
                className="mt-2 inline-flex items-center gap-1.5 h-8 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[12px] font-semibold transition-colors"
              >
                <Plus className="h-3.5 w-3.5" /> Criar primeiro pedido
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {pedidosFiltrados.map(p => (
                <PedidoCard
                  key={p.id}
                  pedido={p}
                  isAdmin={isAdmin}
                  onFaturar={setFaturarPedido}
                  onCancelar={setCancelarPedido}
                  onRefresh={loadPedidos}
                />
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
              <Input
                placeholder="Buscar cliente..."
                value={clienteSearch}
                onChange={e => setClienteSearch(e.target.value)}
                className="pl-9 h-9 text-sm"
              />
              {clienteSearch && (
                <button type="button" onClick={() => setClienteSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <Button size="sm" className="h-9 gap-1.5 text-xs rounded-lg bg-violet-600 hover:bg-violet-500 shrink-0" onClick={() => { setEditCliente(null); setClienteModal(true); }}>
              <UserPlus className="h-3.5 w-3.5" /> Novo
            </Button>
          </div>

          {loadingClientes ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-7 w-7 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : clientesFiltrados.length === 0 ? (
            <div className="text-center py-16 space-y-2">
              <User className="h-10 w-10 text-muted-foreground/30 mx-auto" />
              <p className="text-muted-foreground font-medium">{clienteSearch ? "Nenhum cliente encontrado" : "Nenhum cliente cadastrado"}</p>
              {!clienteSearch && (
                <button
                  type="button"
                  onClick={() => { setEditCliente(null); setClienteModal(true); }}
                  className="mt-2 inline-flex items-center gap-1.5 h-8 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[12px] font-semibold transition-colors"
                >
                  <UserPlus className="h-3.5 w-3.5" /> Cadastrar primeiro cliente
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {clientesFiltrados.map(c => (
                <div
                  key={c.id}
                  className="group relative rounded-2xl bg-card overflow-hidden transition-all duration-300 hover:-translate-y-0.5"
                  style={{ boxShadow: "0 1px 2px hsl(var(--border) / 0.3), 0 4px 12px -2px hsl(var(--border) / 0.15), inset 0 1px 0 hsl(0 0% 100% / 0.06)" }}
                >
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
                      {c.telefone && (
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
                          <Phone className="h-3 w-3" /><span>{c.telefone}</span>
                        </div>
                      )}
                      {c.email && (
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
                          <Mail className="h-3 w-3" /><span className="truncate">{c.email}</span>
                        </div>
                      )}
                      {c.endereco && (
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
                          <MapPin className="h-3 w-3 shrink-0" /><span className="truncate">{c.endereco}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1.5 pt-1 border-t border-border/20">
                      <button
                        type="button"
                        onClick={() => { setPedidoComCliente(c); setNovoPedidoOpen(true); setSubTab("pedidos"); }}
                        className="flex-1 h-7 flex items-center justify-center gap-1 rounded-lg bg-violet-500/10 hover:bg-violet-500/20 text-violet-600 dark:text-violet-400 text-[10px] font-medium transition-colors"
                      >
                        <ShoppingCart className="h-3 w-3" /> Pedido
                      </button>
                      <button
                        type="button"
                        onClick={() => { setEditCliente(c); setClienteModal(true); }}
                        className="flex-1 h-7 flex items-center justify-center gap-1 rounded-lg bg-muted/30 hover:bg-muted/60 text-muted-foreground text-[10px] transition-colors"
                      >
                        Editar
                      </button>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => setDeleteCliente(c)}
                          className="h-7 w-7 flex items-center justify-center rounded-lg bg-muted/30 hover:bg-destructive/15 hover:text-destructive text-muted-foreground transition-colors"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
          <div className="w-full max-w-sm rounded-2xl bg-card border border-border/30 p-5 space-y-4 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
                <Ban className="h-4 w-4 text-destructive" />
              </div>
              <div>
                <p className="text-sm font-semibold">Cancelar pedido?</p>
                <p className="text-[12px] text-muted-foreground mt-0.5">{cancelarPedido.cliente_nome}</p>
              </div>
            </div>
            <p className="text-[12px] text-muted-foreground">As peças reservadas voltarão a ficar disponíveis na expedição.</p>
            <div className="flex gap-2">
              <button type="button" className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors" onClick={() => setCancelarPedido(null)} disabled={cancelando}>
                Voltar
              </button>
              <button
                type="button"
                className="flex-1 h-9 rounded-xl bg-destructive text-destructive-foreground text-sm font-semibold hover:bg-destructive/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5"
                onClick={handleCancelar}
                disabled={cancelando}
              >
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
          <div className="w-full max-w-sm rounded-2xl bg-card border border-border/30 p-5 space-y-4 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
                <Trash2 className="h-4 w-4 text-destructive" />
              </div>
              <div>
                <p className="text-sm font-semibold">Excluir cliente?</p>
                <p className="text-[12px] text-muted-foreground mt-0.5">{deleteCliente.nome}</p>
              </div>
            </div>
            <p className="text-[12px] text-muted-foreground">Clientes com pedidos vinculados não podem ser excluídos.</p>
            <div className="flex gap-2">
              <button type="button" className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors" onClick={() => setDeleteCliente(null)} disabled={deletingCliente}>
                Cancelar
              </button>
              <button
                type="button"
                className="flex-1 h-9 rounded-xl bg-destructive text-destructive-foreground text-sm font-semibold hover:bg-destructive/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5"
                onClick={handleDeleteCliente}
                disabled={deletingCliente}
              >
                {deletingCliente ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
