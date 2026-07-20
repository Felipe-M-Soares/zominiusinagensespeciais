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

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { displayLote } from "@/lib/lote";
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
  History,
  ArrowDownCircle,
  ArrowUpCircle,
  RefreshCw,
  Trophy,
  TrendingUp,
  Download,
  LayoutDashboard,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import i18n from "@/i18n";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useDebounce } from "@/hooks/useDebounce";
import { useClickOutside } from "@/hooks/useClickOutside";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { validarEmail, validarDocumento } from "@/lib/validators";
import type { StockItem } from "@/hooks/useStock";
import { fetchAllMovements } from "@/hooks/useStock";
import type { AllMovement } from "@/hooks/useStock";
import { escHtml } from "@/lib/escHtml";
import { criarPedidoComReserva } from "@/lib/pedidoUtils";
import { SearchInputWithBarcode } from "@/components/SearchInputWithBarcode";

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
  const { t } = useTranslation();
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
    if (!nome.trim()) { toast.error(t("stockComercialPanel.toastNameRequired")); return; }
    // Validate document and email format before persisting
    if (documento && !validarDocumento(documento)) {
      toast.error(t("stockComercialPanel.toastInvalidTaxId"));
      return;
    }
    if (email && !validarEmail(email)) {
      toast.error(t("stockComercialPanel.toastInvalidEmail"));
      return;
    }
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
      toast.success(inicial ? t("stockComercialPanel.toastClientUpdated") : t("stockComercialPanel.toastClientCreated"));
      onSuccess(data!);
    } catch (e: unknown) {
      toast.error(t("stockComercialPanel.toastSaveClientError"));
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
            <p className="text-sm font-semibold">{inicial ? t("stockComercialPanel.editClient") : t("stockComercialPanel.newClient")}</p>
          </div>
          <button type="button" onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{t("stockComercialPanel.name")}</label>
            <Input value={nome} onChange={e => setNome(e.target.value)} placeholder={t("stockComercialPanel.namePlaceholder")} className="h-9 text-sm" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">{t("stockComercialPanel.taxId")}</label>
              <Input value={documento} onChange={e => setDocumento(e.target.value)} placeholder="000.000.000-00" className="h-9 text-sm" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">{t("stockComercialPanel.phone")}</label>
              <Input value={telefone} onChange={e => setTelefone(e.target.value)} placeholder="(00) 00000-0000" className="h-9 text-sm" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{t("stockComercialPanel.email")}</label>
            <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="cliente@email.com" className="h-9 text-sm" type="email" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{t("stockComercialPanel.address")}</label>
            <Input value={endereco} onChange={e => setEndereco(e.target.value)} placeholder={t("stockComercialPanel.address")} className="h-9 text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{t("stockComercialPanel.notes")}</label>
            <textarea
              value={obs}
              onChange={e => setObs(e.target.value)}
              placeholder={t("stockComercialPanel.notes")}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none min-h-[60px] focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
        <div className="flex gap-2 p-5 pt-0">
          <button type="button" onClick={onClose} className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors" disabled={saving}>
            {t("stockComercialPanel.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !nome.trim()}
            className="flex-1 h-9 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {saving ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {inicial ? t("stockComercialPanel.save") : t("stockComercialPanel.register")}
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
  const { t } = useTranslation();
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
    setQtd(1);
    loadClientes();
  }, [open, clienteFixo]);

  async function loadClientes() {
    const { data } = await supabase.from("clientes").select("*").order("nome");
    setClientes((data as Cliente[]) ?? []);
  }

  // FIX: useClickOutside substitui document.addEventListener duplicado
  useClickOutside(dropRef,    () => setShowClienteDrop(false));
  useClickOutside(pecaDropRef, () => setShowPecaDrop(false));

  const clientesFiltrados = clientes.filter(c =>
    c.nome.toLowerCase().includes(clienteSearch.toLowerCase()) ||
    (c.documento ?? "").includes(clienteSearch)
  );

  // Calcula quanto já foi adicionado ao pedido atual para cada stock_item
  const jaAdicionadoNoPedido = itens.reduce<Record<string, number>>((acc, i) => {
    acc[i.stock_item_id] = (acc[i.stock_item_id] ?? 0) + i.quantidade;
    return acc;
  }, {});

  // Filtra e exibe apenas peças com quantidade ainda disponível (descontando o que já está no pedido local)
  const expedicaoDisponiveis = expedicaoItems
    .map(i => {
      const dispBruto = i.quantity_available ?? Math.max(0, i.quantity - i.quantity_reserved);
      const jaAdicionado = jaAdicionadoNoPedido[i.id] ?? 0;
      return { ...i, _dispReal: dispBruto - jaAdicionado };
    })
    .filter(i =>
      i._dispReal > 0 &&
      (i.device?.model?.toLowerCase().includes(pecaSearch.toLowerCase()) ||
       i.device?.reference?.toLowerCase().includes(pecaSearch.toLowerCase()))
    );

  function addItem() {
    if (!selectedPeca || qtd < 1) return;
    const dispBruto = selectedPeca.quantity_available ?? Math.max(0, selectedPeca.quantity - selectedPeca.quantity_reserved);
    const jaAdicionado = jaAdicionadoNoPedido[selectedPeca.id] ?? 0;
    const dispReal = dispBruto - jaAdicionado;
    if (qtd > dispReal) {
      toast.error(dispReal <= 0 ? t("stockComercialPanel.toastNoStockForPiece") : t("stockComercialPanel.toastOnlyAvailable", { count: dispReal, plural: dispReal !== 1 ? "s" : "" }));
      return;
    }
    setItens(prev => [...prev, {
      stock_item_id: selectedPeca.id,
      lote: "", // lote será atribuído automaticamente (mais antigo primeiro) na separação
      quantidade: qtd,
      device_model: selectedPeca.device?.model ?? "",
      device_reference: selectedPeca.device?.reference ?? "",
    }]);
    setSelectedPeca(null);
    setPecaSearch("");
    setQtd(1);
  }

  async function handleSave() {
    if (!clienteId) { toast.error(t("stockComercialPanel.toastSelectClient")); return; }
    if (itens.length === 0) { toast.error(t("stockComercialPanel.toastAddAtLeastOne")); return; }
    if (!user?.id) { toast.error(t("stockComercialPanel.toastSessionExpired")); return; }
    setSaving(true);
    try {
      // FIX: Usa criarPedidoComReserva de pedidoUtils — elimina duplicação e
      // garante a mesma lógica atômica de reserva de estoque usada em Comercial.tsx.
      const { data: profile } = await supabase.from("profiles").select("display_name").eq("user_id", user.id).maybeSingle();
      const vendedoraNome = (profile as { display_name?: string } | null)?.display_name ?? user.email ?? t("stockComercialPanel.defaultSellerName");

      const result = await criarPedidoComReserva({
        clienteId,
        itens: itens.map(i => ({
          stock_item_id: i.stock_item_id,
          lote: null, // lote será definido pelo estoque na separação (mais antigo primeiro)
          quantidade: i.quantidade,
          device_model: i.device_model,
        })),
        vendedoraId: user.id,
        vendedoraNome,
        observacoes: obs || null,
      });

      if (!result.ok) {
        toast.error(result.error ?? t("stockComercialPanel.toastOrderCreateError"));
        return;
      }

      toast.success(t("stockComercialPanel.toastOrderCreated"));
      onSuccess();
    } catch (_e) {
      toast.error(t("stockComercialPanel.toastOrderCreateError"));
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
            <p className="text-sm font-semibold">{t("stockComercialPanel.newOrder")}</p>
          </div>
          <button type="button" onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Cliente */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("stockComercialPanel.client")}</label>
            <div className="relative" ref={dropRef}>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder={t("stockComercialPanel.searchClient")}
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
                  title={t("stockComercialPanel.newClientTitle")}
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
                <CheckCircle2 className="h-3 w-3" /> {t("stockComercialPanel.clientSelected")}
              </p>
            )}
          </div>

          {/* Seleção de peças */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("stockComercialPanel.addPiece")}</label>
            <div className="rounded-xl border border-border/50 bg-muted/10 p-3 space-y-2">
              {/* Busca de peça */}
              <div className="relative" ref={pecaDropRef}>
                <Package className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder={t("stockComercialPanel.searchPieceShipping")}
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
                          <span className="text-success font-semibold">{item._dispReal} disp.</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {showPecaDrop && pecaSearch && expedicaoDisponiveis.length === 0 && (
                  <div className="absolute top-full mt-1 left-0 right-0 z-50 rounded-xl border border-border bg-card shadow-xl p-3 text-center">
                    <p className="text-xs text-muted-foreground">{t("stockComercialPanel.noPieceAvailable")}</p>
                  </div>
                )}
              </div>

              {/* Quantidade */}
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground font-medium">
                  {t("stockComercialPanel.quantity")}
                  {selectedPeca && (() => {
                    const dispBruto = selectedPeca.quantity_available ?? Math.max(0, selectedPeca.quantity - selectedPeca.quantity_reserved);
                    const jaAd = jaAdicionadoNoPedido[selectedPeca.id] ?? 0;
                    const dispReal = dispBruto - jaAd;
                    return dispReal > 0 ? <span className="text-muted-foreground/60"> ({t("stockComercialPanel.maxAbbrev")} {dispReal})</span> : null;
                  })()}
                </label>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={selectedPeca ? Math.max(1, (selectedPeca.quantity_available ?? Math.max(0, selectedPeca.quantity - selectedPeca.quantity_reserved)) - (jaAdicionadoNoPedido[selectedPeca.id] ?? 0)) : undefined}
                  value={qtd === 0 ? "" : qtd}
                  onChange={e => {
                    const raw = e.target.value;
                    if (raw === "") { setQtd(0); return; } // permite apagar no celular sem forçar 1 de volta
                    const v = parseInt(raw, 10);
                    if (!isNaN(v)) setQtd(v);
                  }}
                  onBlur={() => {
                    const base = Math.max(1, qtd || 1);
                    if (selectedPeca) {
                      const dispBruto = selectedPeca.quantity_available ?? Math.max(0, selectedPeca.quantity - selectedPeca.quantity_reserved);
                      const jaAd = jaAdicionadoNoPedido[selectedPeca.id] ?? 0;
                      const dispReal = dispBruto - jaAd;
                      setQtd(Math.min(base, Math.max(1, dispReal)));
                    } else {
                      setQtd(base);
                    }
                  }}
                  className="h-8 text-xs"
                />
              </div>

              <button
                type="button"
                onClick={addItem}
                disabled={!selectedPeca || qtd < 1}
                className="w-full h-8 rounded-lg bg-violet-500/10 hover:bg-violet-500/20 text-violet-600 dark:text-violet-400 text-xs font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" /> {t("stockComercialPanel.addToOrder")}
              </button>
            </div>

            {/* Lista de itens adicionados */}
            {itens.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] text-muted-foreground font-medium">{t("stockComercialPanel.itemsInOrder", { count: itens.length, plural: itens.length > 1 ? "s" : "" })}</p>
                <div className="space-y-1">
                  {itens.map((it, idx) => (
                    <div key={idx} className="flex items-center gap-2 rounded-lg bg-muted/20 border border-border/30 px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium truncate">{it.device_model}</p>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span>{it.quantidade} {t("stockComercialPanel.units")}</span>
                          <span>·</span>
                          <span className="text-muted-foreground/50 italic">{t("stockComercialPanel.lotAssignedLater")}</span>
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
            <label className="text-xs font-medium text-muted-foreground">{t("stockComercialPanel.notes")}</label>
            <textarea
              value={obs}
              onChange={e => setObs(e.target.value)}
              placeholder={t("stockComercialPanel.notes")}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none min-h-[60px] focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 p-5 border-t border-border/30 shrink-0">
          <button type="button" onClick={onClose} className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors" disabled={saving}>
            {t("stockComercialPanel.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !clienteId || itens.length === 0}
            className="flex-1 h-9 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {saving ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <ShoppingCart className="h-3.5 w-3.5" />}
            {t("stockComercialPanel.createOrder")}
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
  isConfirmado: boolean;
  onConfirmar: (pedidoId: string) => void;
}

function PedidoCard({ pedido, isAdmin, onFaturar, onCancelar, isConfirmado, onConfirmar }: PedidoCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const statusConfig = {
    pendente:  { badge: "bg-amber-500/12 text-amber-600 border-amber-500/25",  accent: "from-amber-500",   icon: <Clock className="h-3 w-3" />,        label: t("stockComercialPanel.statusPending")  },
    faturado:  { badge: "bg-emerald-500/12 text-emerald-600 border-emerald-500/25", accent: "from-emerald-500", icon: <CheckCircle2 className="h-3 w-3" />, label: t("stockComercialPanel.statusInvoiced")  },
    cancelado: { badge: "bg-muted/30 text-muted-foreground border-border/30",  accent: "from-border/60",  icon: <Ban className="h-3 w-3" />,          label: t("stockComercialPanel.statusCancelled") },
  }[pedido.status] ?? {
    badge: "bg-muted/30 text-muted-foreground border-border/30", accent: "from-border/60", icon: null, label: pedido.status,
  };

  const totalItens = pedido.itens.reduce((s, i) => s + i.quantidade, 0);
  const data = new Date(pedido.created_at).toLocaleDateString(t("stockComercialPanel.localeCode"), { day: "2-digit", month: "2-digit", year: "2-digit" });
  const hora = new Date(pedido.created_at).toLocaleTimeString(t("stockComercialPanel.localeCode"), { hour: "2-digit", minute: "2-digit" });

  return (
    <div className={cn(
      "relative rounded-2xl bg-card border overflow-hidden transition-all duration-200 hover:shadow-md",
      pedido.status === "pendente"  ? "border-amber-500/25"   :
      pedido.status === "faturado"  ? "border-emerald-500/25" :
      pedido.status === "cancelado" ? "border-border/20 opacity-60" :
      "border-border/30"
    )}>
      {/* Accent bar */}
      <div className={cn("h-0.5 bg-gradient-to-r to-transparent", statusConfig.accent)} />

      <div className="p-3.5 space-y-3">
        {/* Header: avatar + nome + badge */}
        <div className="flex items-start gap-2.5">
          <div className={cn(
            "h-8 w-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5",
            pedido.status === "pendente"  ? "bg-amber-500/10"   :
            pedido.status === "faturado"  ? "bg-emerald-500/10" :
            "bg-muted/30"
          )}>
            <User className={cn("h-3.5 w-3.5",
              pedido.status === "pendente"  ? "text-amber-500"   :
              pedido.status === "faturado"  ? "text-emerald-500" :
              "text-muted-foreground"
            )} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold truncate leading-tight">{pedido.cliente_nome}</p>
            {pedido.vendedora_nome && (
              <p className="text-[11px] text-muted-foreground/60 truncate mt-0.5">{pedido.vendedora_nome}</p>
            )}
          </div>
          <span className={cn("shrink-0 text-[10px] font-semibold px-2 py-1 rounded-lg border flex items-center gap-1 leading-none", statusConfig.badge)}>
            {statusConfig.icon}{statusConfig.label}
          </span>
        </div>

        {/* Metrics row */}
        <div className="flex items-center gap-2">
          <div className="flex-1 rounded-xl bg-muted/20 border border-border/20 px-3 py-2 flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted-foreground/70 flex items-center gap-1">
              <Package className="h-3 w-3 shrink-0" />
              {pedido.itens.length} {t("stockComercialPanel.type", { plural: pedido.itens.length !== 1 ? "s" : "" })}
            </span>
            <div className="flex items-baseline gap-0.5">
              <span className="text-[20px] font-bold tabular-nums leading-none text-violet-600 dark:text-violet-400">{totalItens}</span>
              <span className="text-[10px] text-muted-foreground/50">{t("stockComercialPanel.units")}</span>
            </div>
          </div>
        </div>

        {/* Data + hora */}
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
          <Clock className="h-3 w-3 shrink-0" />
          <span>{data} às {hora}</span>
        </div>

        {/* Itens expandidos */}
        {expanded && (
          <div className="space-y-1.5 pt-2 border-t border-border/15 animate-in fade-in slide-in-from-top-1 duration-150">
            <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">{t("stockComercialPanel.orderItemsTitle")}</p>
            {pedido.itens.map(it => (
              <div key={it.id} className="flex items-center gap-2 rounded-xl bg-muted/20 border border-border/15 px-3 py-2">
                <div className="h-6 w-6 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                  <Package className="h-3 w-3 text-violet-500/70" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold truncate leading-tight">{it.device_model}</p>
                  <p className="text-[10px] text-muted-foreground/50 font-mono">{it.device_reference}</p>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-[14px] font-bold tabular-nums">{it.quantidade}</span>
                  <span className="text-[10px] text-muted-foreground/50 ml-0.5">{t("stockComercialPanel.units")}</span>
                </div>
              </div>
            ))}
            {pedido.observacoes && (
              <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground/70 bg-violet-500/5 border border-violet-500/15 rounded-xl px-3 py-2">
                <FileText className="h-3 w-3 mt-0.5 shrink-0 text-violet-500/50" />
                <span className="italic">{pedido.observacoes}</span>
              </div>
            )}
          </div>
        )}

        {/* Ações */}
        <div className="space-y-1.5 pt-0.5 border-t border-border/15">
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="w-full flex items-center justify-center gap-1.5 h-7 rounded-xl bg-muted/20 hover:bg-muted/40 text-muted-foreground text-[11px] font-medium transition-colors"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? t("stockComercialPanel.hide") : t("stockComercialPanel.viewPieces", { count: pedido.itens.length, plural: pedido.itens.length !== 1 ? "s" : "" })}
          </button>

          {pedido.status === "pendente" && isAdmin && (
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => { if (isConfirmado) return; onConfirmar(pedido.id); onFaturar(pedido); }}
                disabled={isConfirmado}
                className="flex-1 h-8 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:pointer-events-none border border-emerald-500/20"
              >
                {isConfirmado ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Receipt className="h-3.5 w-3.5" />}
                {isConfirmado ? t("stockComercialPanel.confirmed") : t("stockComercialPanel.invoice")}
              </button>
              <button
                type="button"
                onClick={() => onCancelar(pedido)}
                className="h-8 w-8 flex items-center justify-center rounded-xl bg-muted/20 hover:bg-destructive/15 hover:text-destructive text-muted-foreground transition-colors border border-border/20"
                title={t("stockComercialPanel.cancelOrderTitle")}
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
  const { t } = useTranslation();
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  if (!pedido) return null;

  async function handleFaturar() {
    if (!pedido || submittingRef.current) return;
    submittingRef.current = true;
    setSaving(true);
    try {
      // Marcar pedido como faturado — estoque já foi descontado ao "Marcar como Pronto"
      const { error: pedErr } = await supabase
        .from("pedidos_comerciais")
        .update({ status: "faturado", faturado_por: user?.id, faturado_em: new Date().toISOString() })
        .eq("id", pedido.id);
      if (pedErr) throw pedErr;

      toast.success(t("stockComercialPanel.toastInvoiced"));
      onSuccess();
    } catch (_e) {
      toast.error(t("stockComercialPanel.toastInvoiceError"));
    } finally {
      submittingRef.current = false;
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
            <p className="text-sm font-semibold">{t("stockComercialPanel.invoiceOrderTitle")}</p>
            <p className="text-[12px] text-muted-foreground mt-0.5">{pedido.cliente_nome}</p>
          </div>
        </div>
        <div className="rounded-xl bg-muted/20 border border-border/30 px-3 py-2.5 space-y-1">
          <p className="text-[12px] text-muted-foreground">
            <strong className="text-foreground">{totalItens} {t("stockComercialPanel.units")}</strong> {t("stockComercialPanel.invoiceDesc1")} <strong>{t("stockComercialPanel.invoiceDesc1Strong")}</strong>.
          </p>
          <p className="text-[11px] text-muted-foreground/70">{t("stockComercialPanel.cannotUndo")}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors" onClick={onClose} disabled={saving}>
            {t("stockComercialPanel.cancel")}
          </button>
          <button
            type="button"
            className="flex-1 h-9 rounded-xl bg-success text-success-foreground text-sm font-semibold hover:bg-success/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5"
            onClick={handleFaturar}
            disabled={saving}
          >
            {saving ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Receipt className="h-3.5 w-3.5" />}
            {t("stockComercialPanel.invoice")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard Comercial ──────────────────────────────────────────────────────

interface ComercialDashboardProps {
  pedidos: PedidoCompleto[];
  loading: boolean;
  currentUserName: string | null;
  isAdmin: boolean;
}

function ComercialDashboard({ pedidos, loading, currentUserName, isAdmin }: ComercialDashboardProps) {
  const { t } = useTranslation();
  const faturados = pedidos.filter(p => p.status === "faturado");
  const totalPecas = faturados.reduce((sum, p) => sum + p.itens.reduce((s, i) => s + i.quantidade, 0), 0);
  const totalPendentes = pedidos.filter(p => p.status === "pendente").length;

  const rankingVend: Record<string, number> = {};
  for (const p of faturados) {
    const nome = p.vendedora_nome ?? "—";
    rankingVend[nome] = (rankingVend[nome] ?? 0) + p.itens.reduce((s, i) => s + i.quantidade, 0);
  }
  const rankingVendList = Object.entries(rankingVend).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const rankingCli: Record<string, number> = {};
  for (const p of faturados) {
    rankingCli[p.cliente_nome] = (rankingCli[p.cliente_nome] ?? 0) + p.itens.reduce((s, i) => s + i.quantidade, 0);
  }
  const rankingCliList = Object.entries(rankingCli).sort((a, b) => b[1] - a[1]).slice(0, 5);

  function downloadPdfVendedora() {
    const meusPedidos = faturados.filter(p => p.vendedora_nome === currentUserName);
    if (meusPedidos.length === 0) { toast.error(t("stockComercialPanel.toastNoInvoicedOrder")); return; }
    const pecas: Record<string, { model: string; ref: string; total: number }> = {};
    for (const p of meusPedidos) {
      for (const i of p.itens) {
        const key = i.stock_item_id;
        if (!pecas[key]) pecas[key] = { model: i.device_model ?? "—", ref: i.device_reference ?? "—", total: 0 };
        pecas[key].total += i.quantidade;
      }
    }
    const pecasList = Object.values(pecas).sort((a, b) => b.total - a.total);
    // XSS: escape all user-supplied values injected into the HTML blob
    const esc = escHtml;
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${t("stockComercialPanel.salesReportTitle")} — ${esc(currentUserName ?? "")}</title>
    <style>body{font-family:Arial,sans-serif;padding:24px;color:#111}h1{font-size:18px;margin-bottom:4px}p.sub{font-size:12px;color:#666;margin-bottom:20px}table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;padding:8px 10px;background:#f3f0ff;color:#5b21b6;border-bottom:2px solid #ddd6fe}td{padding:7px 10px;border-bottom:1px solid #eee}.total{font-weight:bold;font-size:15px;color:#5b21b6}.footer{margin-top:20px;font-size:11px;color:#999}</style></head><body>
    <h1>📊 ${t("stockComercialPanel.salesReportTitle")}</h1>
    <p class="sub">${t("stockComercialPanel.seller")} <strong>${esc(currentUserName ?? "")}</strong> &nbsp;·&nbsp; ${t("stockComercialPanel.generatedOn")} ${new Date().toLocaleDateString(t("stockComercialPanel.localeCode"))} ${new Date().toLocaleTimeString(t("stockComercialPanel.localeCode"), { hour: "2-digit", minute: "2-digit" })}</p>
    <table><thead><tr><th>#</th><th>${t("stockComercialPanel.piece")}</th><th>${t("stockComercialPanel.reference")}</th><th>${t("stockComercialPanel.qtySold")}</th></tr></thead><tbody>
    ${pecasList.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.model)}</td><td>${esc(p.ref)}</td><td class="total">${p.total}</td></tr>`).join("")}
    </tbody></table>
    <p class="footer">${t("stockComercialPanel.totalOrders")} ${meusPedidos.length} ${t("stockComercialPanel.orderWord")} &nbsp;·&nbsp; ${pecasList.reduce((s, p) => s + p.total, 0)} ${t("stockComercialPanel.piecesInTotal")}</p>
    </body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, "_blank");
    if (!w) {
      URL.revokeObjectURL(url);
      toast.error(t("stockComercialPanel.toastPopupBlocked"));
      return;
    }
    w.addEventListener("load", () => {
      w.print();
      URL.revokeObjectURL(url);
    }, { once: true });
  }

  if (loading) return (
    <div className="grid grid-cols-2 gap-3">
      {[...Array(4)].map((_, i) => <div key={i} className="rounded-2xl border bg-muted/20 p-4 h-24 animate-pulse" />)}
    </div>
  );

  const maxVend = rankingVendList[0]?.[1] ?? 1;
  const maxCli = rankingCliList[0]?.[1] ?? 1;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4 flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl bg-violet-500/10 flex items-center justify-center shrink-0">
            <Package className="h-5 w-5 text-violet-500" />
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">{t("stockComercialPanel.invoicedPieces")}</p>
            <p className="text-2xl font-bold tabular-nums text-violet-600 dark:text-violet-400">{totalPecas.toLocaleString(t("stockComercialPanel.localeCode"))}</p>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">{faturados.length} {t("stockComercialPanel.ordersSuffix")}</p>
          </div>
        </div>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
            <Clock className="h-5 w-5 text-amber-500" />
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">{t("stockComercialPanel.pending")}</p>
            <p className="text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">{totalPendentes}</p>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">{t("stockComercialPanel.awaitingInvoice")}</p>
          </div>
        </div>
      </div>

      {/* Ranking Vendedoras */}
      <div className="rounded-2xl border border-border/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-500" />
          <p className="text-sm font-semibold">{t("stockComercialPanel.topSellersRanking")}</p>
          <span className="text-[11px] text-muted-foreground/60">{t("stockComercialPanel.invoicedPiecesSuffix")}</span>
        </div>
        {rankingVendList.length === 0
          ? <div className="py-8 text-center text-sm text-muted-foreground/60">{t("stockComercialPanel.noDataAvailable")}</div>
          : <div className="divide-y divide-border/20">
              {rankingVendList.map(([nome, total], idx) => (
                <div key={nome} className="flex items-center gap-3 px-4 py-2.5">
                  <span className={cn("h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0",
                    idx === 0 ? "bg-amber-400/20 text-amber-600" : idx === 1 ? "bg-slate-300/20 text-slate-500" : idx === 2 ? "bg-orange-300/20 text-orange-600" : "bg-muted/40 text-muted-foreground"
                  )}>{idx + 1}º</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[12px] font-medium truncate">{nome}</span>
                      <span className="text-[12px] font-bold text-violet-600 dark:text-violet-400 shrink-0 ml-2">{total} un.</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-violet-400 transition-all" style={{ width: `${Math.round((total / maxVend) * 100)}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
        }
      </div>

      {/* Ranking Clientes */}
      <div className="rounded-2xl border border-border/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-violet-500" />
          <p className="text-sm font-semibold">{t("stockComercialPanel.topClients")}</p>
          <span className="text-[11px] text-muted-foreground/60">{t("stockComercialPanel.piecesSuffix")}</span>
        </div>
        {rankingCliList.length === 0
          ? <div className="py-8 text-center text-sm text-muted-foreground/60">{t("stockComercialPanel.noDataAvailable")}</div>
          : <div className="divide-y divide-border/20">
              {rankingCliList.map(([nome, total], idx) => (
                <div key={nome} className="flex items-center gap-3 px-4 py-2.5">
                  <span className={cn("h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0",
                    idx === 0 ? "bg-violet-500/20 text-violet-600" : "bg-muted/40 text-muted-foreground"
                  )}>{idx + 1}º</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[12px] font-medium truncate">{nome}</span>
                      <span className="text-[12px] font-bold text-violet-600 dark:text-violet-400 shrink-0 ml-2">{total} un.</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-violet-300 transition-all" style={{ width: `${Math.round((total / maxCli) * 100)}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
        }
      </div>

      {/* PDF pessoal */}
      <button
        type="button"
        onClick={downloadPdfVendedora}
        className="w-full flex items-center justify-center gap-2 h-10 rounded-xl border border-violet-500/30 text-violet-600 dark:text-violet-400 text-sm font-medium hover:bg-violet-500/10 transition-colors"
      >
        <Download className="h-4 w-4" />
        {t("stockComercialPanel.downloadMyPdfReport")}
      </button>
    </div>
  );
}

// ─── Histórico Geral Comercial (modal) ───────────────────────────────────────

function HistoricoGeralComercial({ open, onClose, currentUserName, isAdmin }: { open: boolean; onClose: () => void; currentUserName: string | null; isAdmin: boolean }) {
  const { t } = useTranslation();
  const [movements, setMovements] = useState<AllMovement[]>([]);
  const [loading, setLoading] = useState(false);

  const loadMovements = useCallback(async (cancelled: { v: boolean }) => {
    setLoading(true);
    try {
      const data = await fetchAllMovements(200);
      // Filtra apenas expedição; se não for admin, filtra também pelo nome da vendedora
      const filtered = data.filter(m => {
        if (m.fase !== "expedicao") return false;
        if (isAdmin) return true;
        // vendedora vê apenas movimentos relacionados aos seus pedidos (registrados com seu nome)
        return m.user_display_name === currentUserName;
      });
      if (!cancelled.v) { setMovements(filtered); setLoading(false); }
    } catch (_e) {
      if (!cancelled.v) setLoading(false);
    }
  }, [currentUserName, isAdmin]);

  useEffect(() => {
    const cancelled = { v: false };
    if (open) {
      loadMovements(cancelled);
    } else setMovements([]);
    return () => { cancelled.v = true; };
  }, [open, loadMovements]);

  function fmtDate(iso: string) {
    const d = new Date(iso);
    return { date: d.toLocaleDateString(t("stockComercialPanel.localeCode"), { day: "2-digit", month: "2-digit", year: "2-digit" }), time: d.toLocaleTimeString(t("stockComercialPanel.localeCode"), { hour: "2-digit", minute: "2-digit" }) };
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-card border border-border/30 shadow-xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in slide-in-from-bottom-4 duration-200">
        <div className="relative px-5 pt-5 pb-3 shrink-0">
          <div className="absolute inset-0 bg-gradient-to-b from-violet-500/5 to-transparent" />
          <div className="relative flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-violet-500" />
                <p className="text-sm font-semibold">{t("stockComercialPanel.generalHistoryShipping")}</p>
              </div>
              <p className="text-[12px] text-muted-foreground mt-0.5">{t("stockComercialPanel.latestMovements", { count: movements.length })}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => loadMovements({ v: false })} disabled={loading} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors">
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              </button>
              <button type="button" onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
        <div className="px-3 pb-4 overflow-y-auto flex-1 space-y-1">
          {loading && <div className="flex items-center justify-center py-10"><div className="animate-spin h-5 w-5 border-2 border-violet-500 border-t-transparent rounded-full" /></div>}
          {!loading && movements.length === 0 && <div className="text-center py-12 text-sm text-muted-foreground">{t("stockComercialPanel.noMovementShipping")}</div>}
          {!loading && movements.map(mv => {
            const { date, time } = fmtDate(mv.created_at);
            const isEntrada = mv.type === "entrada";
            return (
              <div key={mv.id} className={cn("flex items-start gap-3 px-3 py-2.5 rounded-xl border transition-colors", isEntrada ? "bg-success/4 border-success/15" : "bg-violet-500/4 border-violet-500/15")}>
                {isEntrada ? <ArrowDownCircle className="h-4 w-4 mt-0.5 text-success shrink-0" /> : <ArrowUpCircle className="h-4 w-4 mt-0.5 text-violet-500 shrink-0" />}
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-[12px] font-semibold leading-snug line-clamp-1">{mv.device_model}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">{mv.device_reference}</p>
                  {displayLote(mv.lote) && <p className="flex items-center gap-1 text-[11px] font-mono font-semibold text-violet-500/80"><Tag className="h-2.5 w-2.5" />{t("stockComercialPanel.lotLabel")} {displayLote(mv.lote)}</p>}
                  {mv.reason && <p className="text-[11px] text-muted-foreground line-clamp-1">{mv.reason}</p>}
                  {mv.user_display_name && <p className="flex items-center gap-1 text-[10px] text-muted-foreground/60"><User className="h-2.5 w-2.5" />{mv.user_display_name}</p>}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={cn("text-[13px] font-bold tabular-nums", isEntrada ? "text-success" : "text-violet-500")}>{isEntrada ? "+" : "-"}{mv.quantity}<span className="text-[10px] font-normal ml-0.5 opacity-70">{t("stockComercialPanel.units")}</span></span>
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

// ─── Painel Principal ─────────────────────────────────────────────────────────

interface ComercialPanelProps {
  isAdmin: boolean;
  isVendedora: boolean;
  expedicaoItems: StockItem[];
}

// ─── Export Excel do Mês — vendedora atual ───────────────────────────────────
async function exportExcelMesVendedora(userId: string | undefined, vendedoraNome: string | null, isAdmin: boolean) {
  const ExcelJS = (await import("exceljs")).default;
  const now = new Date();
  const mesAtual = now.getMonth(); // 0-based
  const anoAtual = now.getFullYear();
  const inicioMes = new Date(anoAtual, mesAtual, 1).toISOString();
  const fimMes    = new Date(anoAtual, mesAtual + 1, 0, 23, 59, 59).toISOString();
  const nomeMes   = now.toLocaleDateString(i18n.t("stockComercialPanel.localeCode"), { month: "long", year: "numeric" });

  let query = supabase
    .from("pedidos_comerciais")
    .select("*, clientes(nome)")
    .gte("created_at", inicioMes)
    .lte("created_at", fimMes)
    .order("created_at", { ascending: false });

  // Vendedoras vêem apenas seus pedidos; admins vêem todos mas com contexto de nome
  if (!isAdmin && userId) {
    query = query.eq("vendedora_id", userId);
  }

  const { data: pedidosData, error } = await query;
  if (error || !pedidosData) { toast.error(i18n.t("stockComercialPanel.toastMonthOrdersError")); return; }

  const pedidoIds = pedidosData.map((p: Record<string, unknown>) => p.id as string);

  const { data: itensData } = pedidoIds.length > 0
    ? await supabase
      .from("pedido_itens")
      .select("*, stock_items!pedido_itens_stock_item_id_fkey(devices!stock_items_device_id_fkey(model, reference))")
      .in("pedido_id", pedidoIds)
    : { data: [] };

  const statusLabel: Record<string, string> = {
    pendente: i18n.t("stockComercialPanel.statusPending"),
    faturado: i18n.t("stockComercialPanel.statusInvoiced"),
    cancelado: i18n.t("stockComercialPanel.statusCancelled"),
  };

  const wb = new ExcelJS.Workbook();
  wb.creator = vendedoraNome ?? i18n.t("stockComercialPanel.excelSystemDefault");
  wb.created = now;

  // ─── Aba Pedidos do Mês ──────────────────────────────────────────────────────
  const wsPedidos = wb.addWorksheet(i18n.t("stockComercialPanel.excelSheetOrdersMonth"));
  const pedidosKeys = [i18n.t("stockComercialPanel.excelOrderId"), i18n.t("stockComercialPanel.excelClient"), i18n.t("stockComercialPanel.excelSeller"), i18n.t("stockComercialPanel.excelStatus"), i18n.t("stockComercialPanel.excelNotes"), i18n.t("stockComercialPanel.excelCreatedAt"), i18n.t("stockComercialPanel.excelInvoicedAt")];
  const pedidosCols = [12, 28, 20, 12, 30, 14, 14];
  wsPedidos.columns = pedidosKeys.map((h, i) => ({ header: h, key: h, width: pedidosCols[i] }));

  // Cabeçalho estilizado
  wsPedidos.getRow(1).eachCell((cell) => {
    cell.font      = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 };
    cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4C1D95" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  wsPedidos.getRow(1).height = 18;
  wsPedidos.views = [{ state: "frozen", ySplit: 1 }];

  pedidosData.forEach((p: Record<string, unknown>, rowIdx: number) => {
    const c = p.clientes as Record<string, unknown> | null;
    const row: Record<string, unknown> = {
      [pedidosKeys[0]]: String(p.id).slice(0, 8).toUpperCase(),
      [pedidosKeys[1]]: String(c?.nome ?? "—"),
      [pedidosKeys[2]]: String(p.vendedora_nome ?? "—"),
      [pedidosKeys[3]]: statusLabel[p.status as string] ?? String(p.status),
      [pedidosKeys[4]]: String(p.observacoes ?? ""),
      [pedidosKeys[5]]: p.created_at ? new Date(p.created_at as string).toLocaleDateString(i18n.t("stockComercialPanel.localeCode")) : "",
      [pedidosKeys[6]]: p.faturado_em ? new Date(p.faturado_em as string).toLocaleDateString(i18n.t("stockComercialPanel.localeCode")) : "",
    };
    const exRow = wsPedidos.addRow(row);
    const isEven = rowIdx % 2 === 0;
    exRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = pedidosKeys[colNumber - 1];
      const status = row[pedidosKeys[3]];
      let bgArgb = isEven ? "FFF5F0FF" : "FFFFFFFF";
      let fgArgb = "FF222222";
      let bold   = false;
      if (key === pedidosKeys[3]) {
        if (status === statusLabel.pendente)  { bgArgb = "FFFFF7E0"; fgArgb = "FFB45309"; bold = true; }
        if (status === statusLabel.faturado)  { bgArgb = "FFEAFFEA"; fgArgb = "FF166534"; bold = true; }
        if (status === statusLabel.cancelado) { bgArgb = "FFFFEAEA"; fgArgb = "FFCC0000"; bold = true; }
      }
      cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: bgArgb } };
      cell.font      = { name: "Arial", size: 10, color: { argb: fgArgb }, bold };
      cell.alignment = { horizontal: "left", vertical: "middle" };
      cell.border    = { bottom: { style: "thin", color: { argb: "FFE0E0E0" } }, right: { style: "thin", color: { argb: "FFE0E0E0" } } };
    });
  });

  // ─── Aba Itens ──────────────────────────────────────────────────────────────
  const wsItens = wb.addWorksheet(i18n.t("stockComercialPanel.excelSheetItems"));
  const itensKeys = [i18n.t("stockComercialPanel.excelOrderId"), i18n.t("stockComercialPanel.excelClient"), i18n.t("stockComercialPanel.excelModel"), i18n.t("stockComercialPanel.excelReference"), i18n.t("stockComercialPanel.excelLot"), i18n.t("stockComercialPanel.excelQuantity"), i18n.t("stockComercialPanel.excelOrderStatus")];
  const itensCols = [12, 24, 36, 18, 14, 12, 14];
  wsItens.columns = itensKeys.map((h, i) => ({ header: h, key: h, width: itensCols[i] }));
  wsItens.getRow(1).eachCell((cell) => {
    cell.font      = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 };
    cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4C1D95" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  wsItens.getRow(1).height = 18;
  wsItens.views = [{ state: "frozen", ySplit: 1 }];

  (itensData ?? []).forEach((it: Record<string, unknown>, rowIdx: number) => {
    const stockItem = it.stock_items as Record<string, unknown> | null;
    const device    = stockItem?.devices as Record<string, unknown> | null;
    const pedido    = pedidosData.find((p: Record<string, unknown>) => p.id === it.pedido_id) as Record<string, unknown> | undefined;
    const cliente   = pedido?.clientes as Record<string, unknown> | null;
    const row: Record<string, unknown> = {
      [itensKeys[0]]: String(it.pedido_id).slice(0, 8).toUpperCase(),
      [itensKeys[1]]: String(cliente?.nome ?? "—"),
      [itensKeys[2]]: String(device?.model ?? "—"),
      [itensKeys[3]]: String(device?.reference ?? "—"),
      [itensKeys[4]]: String(it.lote ?? ""),
      [itensKeys[5]]: Number(it.quantidade ?? 0),
      [itensKeys[6]]: statusLabel[pedido?.status as string ?? ""] ?? String(pedido?.status ?? ""),
    };
    const exRow = wsItens.addRow(row);
    const isEven = rowIdx % 2 === 0;
    exRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = itensKeys[colNumber - 1];
      const isNum = key === itensKeys[5];
      cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: isEven ? "FFF5F0FF" : "FFFFFFFF" } };
      cell.font      = { name: "Arial", size: 10, color: { argb: "FF222222" }, bold: isNum };
      cell.alignment = { horizontal: isNum ? "center" : "left", vertical: "middle" };
      cell.border    = { bottom: { style: "thin", color: { argb: "FFE0E0E0" } }, right: { style: "thin", color: { argb: "FFE0E0E0" } } };
    });
  });

  // ─── Aba Resumo ─────────────────────────────────────────────────────────────
  const total      = pedidosData.length;
  const pendentes  = pedidosData.filter((p: Record<string, unknown>) => p.status === "pendente").length;
  const faturados  = pedidosData.filter((p: Record<string, unknown>) => p.status === "faturado").length;
  const cancelados = pedidosData.filter((p: Record<string, unknown>) => p.status === "cancelado").length;
  const totalPecas = (itensData ?? []).reduce((s: number, i: Record<string, unknown>) => s + Number(i.quantidade ?? 0), 0);

  const wsResumo = wb.addWorksheet(i18n.t("stockComercialPanel.excelSheetSummary"));
  const kIndicador = i18n.t("stockComercialPanel.excelIndicator");
  const kValor = i18n.t("stockComercialPanel.excelValue");
  wsResumo.columns = [{ header: kIndicador, key: "Indicador", width: 34 }, { header: kValor, key: "Valor", width: 22 }];
  wsResumo.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4C1D95" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  [
    { Indicador: i18n.t("stockComercialPanel.excelSellerLabel"),          Valor: vendedoraNome ?? "—" },
    { Indicador: i18n.t("stockComercialPanel.excelPeriod"),            Valor: nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1) },
    { Indicador: i18n.t("stockComercialPanel.excelTotalOrders"),   Valor: total },
    { Indicador: i18n.t("stockComercialPanel.excelPendingOrders"),  Valor: pendentes },
    { Indicador: i18n.t("stockComercialPanel.excelInvoicedOrders"),  Valor: faturados },
    { Indicador: i18n.t("stockComercialPanel.excelCancelledOrders"), Valor: cancelados },
    { Indicador: i18n.t("stockComercialPanel.excelTotalPieces"),     Valor: totalPecas },
    { Indicador: i18n.t("stockComercialPanel.excelExportDate"), Valor: now.toLocaleString(i18n.t("stockComercialPanel.localeCode")) },
  ].forEach((r, rowIdx) => {
    const exRow = wsResumo.addRow(r);
    exRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: rowIdx % 2 === 0 ? "FFF5F0FF" : "FFFFFFFF" } };
      cell.font      = { name: "Arial", size: 10, color: { argb: "FF222222" } };
      cell.alignment = { horizontal: "left", vertical: "middle" };
      cell.border    = { bottom: { style: "thin", color: { argb: "FFE0E0E0" } } };
    });
  });

  const mes2d = String(mesAtual + 1).padStart(2, "0");
  const buf   = await wb.xlsx.writeBuffer();
  const blob  = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement("a");
  a.href      = url;
  a.download  = `pedidos-${mes2d}-${anoAtual}${vendedoraNome ? `-${vendedoraNome.replace(/\s+/g, "_")}` : ""}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success(i18n.t("stockComercialPanel.toastMonthExportSuccess", { count: total, plural: total !== 1 ? "s" : "", month: nomeMes }));
}

// ─── Export Excel Comercial ──────────────────────────────────────────────────
async function exportExcelComercial() {
  const ExcelJS = (await import("exceljs")).default;
  const { data: pedidosData, error } = await supabase
    .from("pedidos_comerciais")
    .select("*, clientes(nome)")
    .order("created_at", { ascending: false });

  if (error || !pedidosData) {
    toast.error(i18n.t("stockComercialPanel.toastMonthOrdersError"));
    return;
  }

  const pedidoIds = pedidosData.map((p: Record<string, unknown>) => p.id as string);

  const { data: itensData } = pedidoIds.length > 0
    ? await supabase
      .from("pedido_itens")
      .select("*, stock_items!pedido_itens_stock_item_id_fkey(devices!stock_items_device_id_fkey(model, reference))")
      .in("pedido_id", pedidoIds)
    : { data: [] };

  const statusLabel: Record<string, string> = {
    pendente: i18n.t("stockComercialPanel.statusPending"),
    faturado: i18n.t("stockComercialPanel.statusInvoiced"),
    cancelado: i18n.t("stockComercialPanel.statusCancelled"),
  };

  const pedidosKeys = [i18n.t("stockComercialPanel.excelOrderId"), i18n.t("stockComercialPanel.excelClient"), i18n.t("stockComercialPanel.excelSeller"), i18n.t("stockComercialPanel.excelStatus"), i18n.t("stockComercialPanel.excelNotes"), i18n.t("stockComercialPanel.excelCreatedAt"), i18n.t("stockComercialPanel.excelInvoicedAt")];
  const itensKeys = [i18n.t("stockComercialPanel.excelOrderId"), i18n.t("stockComercialPanel.excelClient"), i18n.t("stockComercialPanel.excelModel"), i18n.t("stockComercialPanel.excelReference"), i18n.t("stockComercialPanel.excelLot"), i18n.t("stockComercialPanel.excelQuantity"), i18n.t("stockComercialPanel.excelOrderStatus")];

  // Aba 1: Pedidos
  const pedidosRows = pedidosData.map((p: Record<string, unknown>) => {
    const c = p.clientes as Record<string, unknown> | null;
    return {
      [pedidosKeys[0]]: String(p.id).slice(0, 8).toUpperCase(),
      [pedidosKeys[1]]: String(c?.nome ?? "—"),
      [pedidosKeys[2]]: String(p.vendedora_nome ?? "—"),
      [pedidosKeys[3]]: statusLabel[p.status as string] ?? String(p.status),
      [pedidosKeys[4]]: String(p.observacoes ?? ""),
      [pedidosKeys[5]]: p.created_at ? new Date(p.created_at as string).toLocaleDateString(i18n.t("stockComercialPanel.localeCode")) : "",
      [pedidosKeys[6]]: p.faturado_em ? new Date(p.faturado_em as string).toLocaleDateString(i18n.t("stockComercialPanel.localeCode")) : "",
    };
  });

  // Aba 2: Itens dos Pedidos
  const itensRows = (itensData ?? []).map((it: Record<string, unknown>) => {
    const stockItem = it.stock_items as Record<string, unknown> | null;
    const device = stockItem?.devices as Record<string, unknown> | null;
    const pedido = pedidosData.find((p: Record<string, unknown>) => p.id === it.pedido_id) as Record<string, unknown> | undefined;
    const cliente = pedido?.clientes as Record<string, unknown> | null;
    return {
      [itensKeys[0]]: String(it.pedido_id).slice(0, 8).toUpperCase(),
      [itensKeys[1]]: String(cliente?.nome ?? "—"),
      [itensKeys[2]]: String(device?.model ?? "—"),
      [itensKeys[3]]: String(device?.reference ?? "—"),
      [itensKeys[4]]: String(it.lote ?? ""),
      [itensKeys[5]]: Number(it.quantidade ?? 0),
      [itensKeys[6]]: statusLabel[pedido?.status as string ?? ""] ?? String(pedido?.status ?? ""),
    };
  });

  const wb = new ExcelJS.Workbook();

  // ─── Aba Pedidos ────────────────────────────────────────────────────────────
  const wsPedidos = wb.addWorksheet(i18n.t("stockComercialPanel.excelSheetOrders"));
  const pedidosCols = [12, 28, 20, 12, 30, 14, 14];
  wsPedidos.columns = pedidosKeys.map((h, i) => ({ header: h, key: h, width: pedidosCols[i] }));
  wsPedidos.getRow(1).eachCell((cell) => {
    cell.font      = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 };
    cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4C1D95" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  wsPedidos.getRow(1).height = 18;
  wsPedidos.views = [{ state: "frozen", ySplit: 1 }];

  pedidosRows.forEach((row, rowIdx) => {
    const exRow = wsPedidos.addRow(row);
    const isEven = rowIdx % 2 === 0;
    exRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = pedidosKeys[colNumber - 1];
      const status = row[pedidosKeys[3]];
      let bgArgb = isEven ? "FFF5F0FF" : "FFFFFFFF";
      let fgArgb = "FF222222";
      let bold   = false;
      if (key === pedidosKeys[3]) {
        if (status === statusLabel.pendente)  { bgArgb = "FFFFF7E0"; fgArgb = "FFB45309"; bold = true; }
        if (status === statusLabel.faturado)  { bgArgb = "FFEAFFEA"; fgArgb = "FF166534"; bold = true; }
        if (status === statusLabel.cancelado) { bgArgb = "FFFFEAEA"; fgArgb = "FFCC0000"; bold = true; }
      }
      cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: bgArgb } };
      cell.font      = { name: "Arial", size: 10, color: { argb: fgArgb }, bold };
      cell.alignment = { horizontal: "left", vertical: "middle" };
      cell.border    = { bottom: { style: "thin", color: { argb: "FFE0E0E0" } }, right: { style: "thin", color: { argb: "FFE0E0E0" } } };
    });
  });

  // ─── Aba Itens ──────────────────────────────────────────────────────────────
  const wsItens = wb.addWorksheet(i18n.t("stockComercialPanel.excelSheetItems"));
  const itensCols = [12, 24, 36, 18, 14, 12, 14];
  wsItens.columns = itensKeys.map((h, i) => ({ header: h, key: h, width: itensCols[i] }));
  wsItens.getRow(1).eachCell((cell) => {
    cell.font      = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 };
    cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4C1D95" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  wsItens.getRow(1).height = 18;
  wsItens.views = [{ state: "frozen", ySplit: 1 }];

  itensRows.forEach((row, rowIdx) => {
    const exRow = wsItens.addRow(row);
    const isEven = rowIdx % 2 === 0;
    exRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = itensKeys[colNumber - 1];
      const isNum = key === itensKeys[5];
      cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: isEven ? "FFF5F0FF" : "FFFFFFFF" } };
      cell.font      = { name: "Arial", size: 10, color: { argb: "FF222222" }, bold: isNum };
      cell.alignment = { horizontal: isNum ? "center" : "left", vertical: "middle" };
      cell.border    = { bottom: { style: "thin", color: { argb: "FFE0E0E0" } }, right: { style: "thin", color: { argb: "FFE0E0E0" } } };
    });
  });

  // ─── Aba Resumo ─────────────────────────────────────────────────────────────
  const total = pedidosData.length;
  const pendentes  = pedidosData.filter((p: Record<string, unknown>) => p.status === "pendente").length;
  const faturados  = pedidosData.filter((p: Record<string, unknown>) => p.status === "faturado").length;
  const cancelados = pedidosData.filter((p: Record<string, unknown>) => p.status === "cancelado").length;

  const wsResumo = wb.addWorksheet(i18n.t("stockComercialPanel.excelSheetSummary"));
  const kIndicador = i18n.t("stockComercialPanel.excelIndicator");
  const kValor = i18n.t("stockComercialPanel.excelValue");
  wsResumo.columns = [{ header: kIndicador, key: "Indicador", width: 30 }, { header: kValor, key: "Valor", width: 20 }];
  [
    { Indicador: i18n.t("stockComercialPanel.excelTotalOrders"),   Valor: total },
    { Indicador: i18n.t("stockComercialPanel.excelPendingOrders"),  Valor: pendentes },
    { Indicador: i18n.t("stockComercialPanel.excelInvoicedOrders"),  Valor: faturados },
    { Indicador: i18n.t("stockComercialPanel.excelCancelledOrders"), Valor: cancelados },
    { Indicador: i18n.t("stockComercialPanel.excelTotalItems"),     Valor: (itensData ?? []).length },
    { Indicador: i18n.t("stockComercialPanel.excelExportDate"), Valor: new Date().toLocaleString(i18n.t("stockComercialPanel.localeCode")) },
  ].forEach((r) => wsResumo.addRow(r));

  // Gera buffer e dispara download
  const buf  = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `comercial-${new Date().toLocaleDateString(i18n.t("stockComercialPanel.localeCode")).replace(/\//g, "-")}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success(i18n.t("stockComercialPanel.toastComercialExportSuccess", { count: total, plural: total !== 1 ? "s" : "" }));
}

export function ComercialPanel({ isAdmin, isVendedora, expedicaoItems }: ComercialPanelProps) {
  const { t } = useTranslation();
  const { role, user } = useAuth();
  const canAccess = isAdmin || isVendedora;

  // Nome da usuária logada
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  const userEmail = user?.email ?? null;
  useEffect(() => {
    if (!user?.id) return;
    supabase.from("profiles").select("display_name").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => setCurrentUserName((data as { display_name?: string } | null)?.display_name ?? userEmail));
  }, [user?.id, userEmail]);

  // Tabs internas
  type SubTab = "dashboard" | "pedidos" | "clientes";
  const [subTab, setSubTab] = useState<SubTab>("pedidos");
  const [historicoOpen, setHistoricoOpen] = useState(false);

  // Pedidos
  const [pedidos, setPedidos] = useState<PedidoCompleto[]>([]);
  const [loadingPedidos, setLoadingPedidos] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState<"todos" | "pendente" | "faturado" | "cancelado">("todos");
  const [novoPedidoOpen, setNovoPedidoOpen] = useState(false);
  const [faturarPedido, setFaturarPedido] = useState<PedidoCompleto | null>(null);
  const [cancelarPedido, setCancelarPedido] = useState<PedidoCompleto | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [confirmadosIds, setConfirmadosIds] = useState<Set<string>>(new Set());

  // Clientes
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loadingClientes, setLoadingClientes] = useState(true);
  const [clienteModal, setClienteModal] = useState(false);
  const [editCliente, setEditCliente] = useState<Cliente | null>(null);
  const [deleteCliente, setDeleteCliente] = useState<Cliente | null>(null);
  const [deletingCliente, setDeletingCliente] = useState(false);
  const [clienteSearchFilter, setClienteSearchFilter] = useState("");
  const clienteSearchRef = useRef<HTMLInputElement>(null);
  const clienteSearchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pedidoComCliente, setPedidoComCliente] = useState<Cliente | null>(null);

  const loadPedidosAbortRef = useRef<AbortController | null>(null);
  const loadPedidos = useCallback(async () => {
    // Cancel any in-flight request before starting a new one
    loadPedidosAbortRef.current?.abort();
    const ctrl = new AbortController();
    loadPedidosAbortRef.current = ctrl;

    setLoadingPedidos(true);
    try {
      // Isolamento: vendedoras vêem apenas seus pedidos; admins vêem todos
      // A RLS do banco já filtra, mas filtramos também no cliente para garantir consistência
      let query = supabase
        .from("pedidos_comerciais")
        .select("*, clientes(nome)")
        .order("created_at", { ascending: false })
        .abortSignal(ctrl.signal);

      if (!isAdmin && user?.id) {
        query = query.eq("vendedora_id", user.id);
      }

      const { data: pedidosData } = await query;

      if (ctrl.signal.aborted) return;
      if (!pedidosData) { setPedidos([]); return; }

      const pedidoIds = pedidosData.map((p: Record<string, unknown>) => p.id as string);

      const { data: itensData } = pedidoIds.length > 0
        ? await supabase
          .from("pedido_itens")
          .select("*, stock_items!pedido_itens_stock_item_id_fkey(devices!stock_items_device_id_fkey(model, reference))")
          .in("pedido_id", pedidoIds)
          .abortSignal(ctrl.signal)
        : { data: [] };

      if (ctrl.signal.aborted) return;

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
    } catch (_e) {
      toast.error(t("stockComercialPanel.toastLoadOrdersError"));
    } finally {
      setLoadingPedidos(false);
    }
  }, [isAdmin, user?.id]);

  const loadClientes = useCallback(async () => {
    setLoadingClientes(true);
    try {
      // Isolamento: vendedoras vêem apenas clientes que elas criaram; admins vêem todos
      let query = supabase.from("clientes").select("*").order("nome");
      if (!isAdmin && user?.id) {
        query = query.eq("created_by", user.id);
      }
      const { data, error } = await query;
      if (error) throw error;
      setClientes((data as Cliente[]) ?? []);
    } catch (_e) {
      toast.error(t("stockComercialPanel.toastLoadClientsError"));
      setClientes([]);
    } finally {
      setLoadingClientes(false);
    }
  }, [isAdmin, user?.id]);

  useEffect(() => { loadPedidos(); loadClientes(); }, [loadPedidos, loadClientes]);

  // useMemo must be called before any early returns (rules of hooks)
  const pedidosFiltrados = useMemo(
    () => pedidos.filter(p => filtroStatus === "todos" || p.status === filtroStatus),
    [pedidos, filtroStatus]
  );
  const clientesFiltrados = useMemo(
    () => clientes.filter(c =>
      c.nome.toLowerCase().includes(clienteSearchFilter.toLowerCase()) ||
      (c.documento ?? "").includes(clienteSearchFilter) ||
      (c.telefone ?? "").includes(clienteSearchFilter)
    ),
    [clientes, clienteSearchFilter]
  );

  if (!canAccess) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
        <ShoppingBag className="h-10 w-10 text-muted-foreground/30" />
        <p className="text-muted-foreground font-medium">{t("stockComercialPanel.accessRestrictedTitle")}</p>
        <p className="text-sm text-muted-foreground/60">{t("stockComercialPanel.accessRestrictedDesc")}</p>
      </div>
    );
  }

  const pedidosPendentes = pedidos.filter(p => p.status === "pendente").length;

  async function handleCancelar() {
    if (!cancelarPedido) return;
    setCancelando(true);
    try {
      // Use atomic RPC to cancel pedido + release reservations in one transaction
      const { error } = await supabase.rpc("cancel_pedido", { p_pedido_id: cancelarPedido.id });
      if (error) { toast.error(t("stockComercialPanel.toastCancelError")); return; }
      toast.success(t("stockComercialPanel.toastOrderCancelled"));
      setCancelarPedido(null);
      loadPedidos();
    } catch (_e) {
      toast.error(t("stockComercialPanel.toastUnexpectedCancelError"));
    } finally {
      setCancelando(false);
    }
  }

  async function handleDeleteCliente() {
    if (!deleteCliente) return;
    setDeletingCliente(true);
    if (isAdmin) {
      const { data: peds } = await supabase.from("pedidos_comerciais").select("id").eq("cliente_id", deleteCliente.id);
      const ids = (peds ?? []).map((p: Record<string, unknown>) => p.id as string);
      if (ids.length > 0) {
        await supabase.from("pedido_itens").delete().in("pedido_id", ids);
        await supabase.from("pedidos_comerciais").delete().eq("cliente_id", deleteCliente.id);
      }
    }
    const { error } = await supabase.from("clientes").delete().eq("id", deleteCliente.id);
    setDeletingCliente(false);
    if (error) { toast.error(t("stockComercialPanel.toastDeleteClientError")); return; }
    toast.success(t("stockComercialPanel.toastClientDeleted"));
    setDeleteCliente(null);
    loadClientes();
  }

  return (
    <div className="space-y-4">
      {/* Info banner */}
      <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3 flex items-center gap-3">
        <div className="h-8 w-8 rounded-xl bg-violet-500/10 flex items-center justify-center shrink-0">
          <ShoppingBag className="h-4 w-4 text-violet-500" />
        </div>
        <p className="text-[12px] text-violet-600 dark:text-violet-400 leading-relaxed">
          {t("stockComercialPanel.infoBanner")}
        </p>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-1.5 rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm p-1.5">
        {([
          { id: "dashboard", label: t("stockComercialPanel.tabDashboard"), icon: LayoutDashboard, badge: 0 },
          { id: "pedidos",   label: t("stockComercialPanel.tabOrders"),   icon: ShoppingBag,    badge: pedidosPendentes },
          { id: "clientes",  label: t("stockComercialPanel.tabClients"),  icon: User,           badge: 0 },
        ] as const).map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSubTab(tab.id)}
            className={cn(
              "relative flex flex-1 flex-col items-center justify-center gap-1 py-2 px-1 rounded-xl border transition-all duration-200",
              subTab === tab.id
                ? "bg-violet-500/10 border-violet-500/40"
                : "border-transparent hover:bg-muted/30"
            )}
          >
            {tab.badge > 0 && (
              <span className={cn(
                "absolute top-1 right-1 min-w-[14px] h-[14px] rounded-full text-[9px] font-bold flex items-center justify-center px-[3px] leading-none",
                subTab === tab.id ? "bg-amber-500/20 text-amber-500" : "bg-muted/60 text-muted-foreground"
              )}>
                {tab.badge}
              </span>
            )}
            <tab.icon className={cn("h-[18px] w-[18px] transition-colors",
              subTab === tab.id ? "text-violet-500 scale-110" : "text-muted-foreground"
            )} />
            <span className={cn("text-[9px] font-medium leading-tight hidden sm:block",
              subTab === tab.id ? "text-violet-500" : "text-muted-foreground"
            )}>
              {tab.label}
            </span>
          </button>
        ))}
        <div className="w-px h-8 bg-border/30 mx-0.5" />
        <button
          type="button"
          onClick={() => setHistoricoOpen(true)}
          className="flex flex-col items-center justify-center gap-1 py-2 px-3 rounded-xl border border-transparent hover:bg-muted/30 transition-colors"
          title={t("stockComercialPanel.historyTitle")}
        >
          <History className="h-[18px] w-[18px] text-muted-foreground" />
          <span className="text-[9px] font-medium text-muted-foreground hidden sm:block">{t("stockComercialPanel.history")}</span>
        </button>
        <button
          type="button"
          onClick={() => exportExcelMesVendedora(user?.id, currentUserName, isAdmin)}
          className="flex flex-col items-center justify-center gap-1 py-2 px-3 rounded-xl border border-transparent hover:bg-emerald-500/10 transition-colors"
          title={t("stockComercialPanel.exportMonthOrders")}
        >
          <Download className="h-[18px] w-[18px] text-emerald-600 dark:text-emerald-400" />
          <span className="text-[9px] font-medium text-emerald-600 dark:text-emerald-400 hidden sm:block">{t("stockComercialPanel.excel")}</span>
        </button>
      </div>

      {/* ── Aba Dashboard ── */}
      {subTab === "dashboard" && (
        <ComercialDashboard
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
            {/* Filtro status */}
            <div className="flex items-center gap-1 flex-wrap">
              {([
                { value: "todos",     label: t("stockComercialPanel.filterAll")      },
                { value: "pendente",  label: t("stockComercialPanel.filterPending")  },
                { value: "faturado",  label: t("stockComercialPanel.filterInvoiced")  },
                { value: "cancelado", label: t("stockComercialPanel.filterCancelled") },
              ] as const).map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setFiltroStatus(opt.value)}
                  className={cn(
                    "h-7 px-3 rounded-lg text-[11px] font-medium border transition-colors",
                    filtroStatus === opt.value
                      ? "bg-violet-600 text-white border-violet-600"
                      : "bg-muted/20 text-muted-foreground border-border/40 hover:bg-muted/50"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => exportExcelComercial()}
                className="h-8 px-3 flex items-center gap-1.5 rounded-xl border border-border/40 text-muted-foreground text-[11px] font-medium hover:bg-muted/30 transition-colors"
              >
                <Download className="h-3.5 w-3.5" /> {t("stockComercialPanel.excel")}
              </button>
              <button
                type="button"
                className="h-8 px-3 flex items-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-semibold transition-colors"
                onClick={() => setNovoPedidoOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" /> {t("stockComercialPanel.newOrder")}
              </button>
            </div>
          </div>

          {loadingPedidos ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-7 w-7 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : pedidosFiltrados.length === 0 ? (
            <div className="text-center py-16 space-y-2">
              <ShoppingBag className="h-10 w-10 text-muted-foreground/30 mx-auto" />
              <p className="text-muted-foreground font-medium">{t("stockComercialPanel.noOrderFound")}</p>
              <button
                type="button"
                onClick={() => setNovoPedidoOpen(true)}
                className="mt-2 inline-flex items-center gap-1.5 h-8 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[12px] font-semibold transition-colors"
              >
                <Plus className="h-3.5 w-3.5" /> {t("stockComercialPanel.createFirstOrder")}
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
                  isConfirmado={confirmadosIds.has(p.id)}
                  onConfirmar={id => setConfirmadosIds(prev => new Set([...prev, id]))}
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
              <SearchInputWithBarcode
                value={clienteSearchFilter}
                onChange={setClienteSearchFilter}
                onSearch={setClienteSearchFilter}
                placeholder={t("stockComercialPanel.searchOrScanClient")}
                height="h-9"
              />
            </div>
            <button
              type="button"
              className="h-9 px-3 flex items-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-semibold transition-colors shrink-0"
              onClick={() => { setEditCliente(null); setClienteModal(true); }}
            >
              <UserPlus className="h-3.5 w-3.5" /> {t("stockComercialPanel.newAbbrev")}
            </button>
          </div>

          {loadingClientes ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-7 w-7 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : clientesFiltrados.length === 0 ? (
            <div className="text-center py-16 space-y-2">
              <User className="h-10 w-10 text-muted-foreground/30 mx-auto" />
              <p className="text-muted-foreground font-medium">{clienteSearchFilter ? t("stockComercialPanel.noClientFound") : t("stockComercialPanel.noClientRegistered")}</p>
              {!clienteSearchFilter && (
                <button
                  type="button"
                  onClick={() => { setEditCliente(null); setClienteModal(true); }}
                  className="mt-2 inline-flex items-center gap-1.5 h-8 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[12px] font-semibold transition-colors"
                >
                  <UserPlus className="h-3.5 w-3.5" /> {t("stockComercialPanel.registerFirstClient")}
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {clientesFiltrados.map(c => (
                <div
                  key={c.id}
                  className="relative rounded-2xl bg-card border border-border/20 overflow-hidden transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 hover:border-violet-500/30"
                >
                  <div className="h-[3px] bg-gradient-to-r from-violet-500 to-transparent opacity-60" />
                  <div className="p-4 space-y-3">
                    {/* Header */}
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-violet-500/10 flex items-center justify-center shrink-0">
                        <User className="h-5 w-5 text-violet-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-[13px] font-bold truncate leading-tight">{c.nome}</h3>
                        {c.documento && <p className="text-[11px] text-muted-foreground/60 font-mono truncate">{c.documento}</p>}
                      </div>
                    </div>

                    {/* Contatos */}
                    {(c.telefone || c.email || c.endereco) && (
                      <div className="space-y-1.5 rounded-xl bg-muted/20 border border-border/15 px-3 py-2.5">
                        {c.telefone && (
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground/70">
                            <Phone className="h-3 w-3 shrink-0 text-muted-foreground/40" /><span>{c.telefone}</span>
                          </div>
                        )}
                        {c.email && (
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground/70">
                            <Mail className="h-3 w-3 shrink-0 text-muted-foreground/40" /><span className="truncate">{c.email}</span>
                          </div>
                        )}
                        {c.endereco && (
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground/70">
                            <MapPin className="h-3 w-3 shrink-0 text-muted-foreground/40" /><span className="truncate">{c.endereco}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Ações */}
                    <div className="flex gap-1.5 pt-0.5 border-t border-border/15">
                      <button
                        type="button"
                        onClick={() => { setPedidoComCliente(c); setNovoPedidoOpen(true); setSubTab("pedidos"); }}
                        className="flex-1 h-8 flex items-center justify-center gap-1.5 rounded-xl bg-violet-500/10 hover:bg-violet-500/20 text-violet-600 dark:text-violet-400 text-[11px] font-semibold transition-colors"
                      >
                        <ShoppingCart className="h-3 w-3" /> {t("stockComercialPanel.orderAction")}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setEditCliente(c); setClienteModal(true); }}
                        className="flex-1 h-8 flex items-center justify-center rounded-xl bg-muted/25 hover:bg-muted/50 text-muted-foreground text-[11px] font-medium transition-colors"
                      >
                        {t("stockComercialPanel.edit")}
                      </button>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => setDeleteCliente(c)}
                          className="h-8 w-8 flex items-center justify-center rounded-xl bg-muted/25 hover:bg-destructive/15 hover:text-destructive text-muted-foreground transition-colors"
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
                <p className="text-sm font-semibold">{t("stockComercialPanel.cancelOrderConfirmTitle")}</p>
                <p className="text-[12px] text-muted-foreground mt-0.5">{cancelarPedido.cliente_nome}</p>
              </div>
            </div>
            <p className="text-[12px] text-muted-foreground">{t("stockComercialPanel.cancelOrderConfirmDesc")}</p>
            <div className="flex gap-2">
              <button type="button" className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors" onClick={() => setCancelarPedido(null)} disabled={cancelando}>
                {t("stockComercialPanel.back")}
              </button>
              <button
                type="button"
                className="flex-1 h-9 rounded-xl bg-destructive text-destructive-foreground text-sm font-semibold hover:bg-destructive/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5"
                onClick={handleCancelar}
                disabled={cancelando}
              >
                {cancelando ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                {t("stockComercialPanel.cancelOrderAction")}
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
                <p className="text-sm font-semibold">{t("stockComercialPanel.deleteClientConfirmTitle")}</p>
                <p className="text-[12px] text-muted-foreground mt-0.5">{deleteCliente.nome}</p>
              </div>
            </div>
            <p className="text-[12px] text-muted-foreground">{isAdmin ? t("stockComercialPanel.deleteClientAdminDesc") : t("stockComercialPanel.deleteClientUserDesc")}</p>
            <div className="flex gap-2">
              <button type="button" className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors" onClick={() => setDeleteCliente(null)} disabled={deletingCliente}>
                {t("stockComercialPanel.cancel")}
              </button>
              <button
                type="button"
                className="flex-1 h-9 rounded-xl bg-destructive text-destructive-foreground text-sm font-semibold hover:bg-destructive/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5"
                onClick={handleDeleteCliente}
                disabled={deletingCliente}
              >
                {deletingCliente ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                {t("stockComercialPanel.delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Histórico Geral Expedição */}
      <HistoricoGeralComercial open={historicoOpen} onClose={() => setHistoricoOpen(false)} currentUserName={currentUserName} isAdmin={isAdmin} />
    </div>
  );
}
