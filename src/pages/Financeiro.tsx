/**
 * src/pages/Financeiro.tsx — Módulo Financeiro Completo v2
 * Reformulado: design profissional, todas as abas funcionando,
 * pedidos "pronto" aparecem corretamente, bugs de className corrigidos.
 */

import {
  useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense,
} from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { TableSkeleton } from "@/components/PageSkeleton";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import { escHtml } from "@/lib/escHtml";
import { formatBRL } from "@/lib/format";
import { gerarDanfeHtml } from "@/lib/danfe";
import { detectarUF, adaptarCFOP } from "@/lib/cfop";
import { cn } from "@/lib/utils";
import { friendlyError } from "@/lib/errorMessages";
import { PageNav } from "@/components/PageNav";
import { SearchInputWithBarcode } from "@/components/SearchInputWithBarcode";
import { useIsMobile } from "@/hooks/use-mobile";
import { ClearHistoryButton } from "@/components/admin/ClearHistoryButton";
import { TestBadge } from "@/components/financeiro/TestBadge";
import { fmtDate, fmtCurrency, statusLabel, mascararDoc } from "@/components/financeiro/financeiroUtils";
import type { LancamentoFinanceiro, CategoriaCompra } from "@/components/financeiro/financeiroTypes";
import { CATEGORIAS_PRODUCAO, CATEGORIAS_EMPRESA, CATEGORIAS_CUSTO } from "@/components/financeiro/financeiroTypes";

const FornecedoresPanel  = lazy(() => import("@/components/compras/FornecedoresPanel").then(m => ({ default: m.FornecedoresPanel })));
const PedidosCompraPanel = lazy(() => import("@/components/compras/PedidosCompraPanel").then(m => ({ default: m.PedidosCompraPanel })));
const FluxoCaixaPanelLazy = lazy(() => import("@/components/financeiro/FluxoCaixaPanel").then(m => ({ default: m.FluxoCaixaPanel })));
const DevolucaoTrocaPanelLazy = lazy(() => import("@/components/financeiro/DevolucaoTrocaPanel").then(m => ({ default: m.DevolucaoTrocaPanel })));
const PainelTabelaPrecos = lazy(() => import("@/components/financeiro/PainelTabelaPrecos").then(m => ({ default: m.PainelTabelaPrecos })));
const PainelBancos = lazy(() => import("@/components/financeiro/PainelBancos").then(m => ({ default: m.PainelBancos })));
const PainelLancamentos = lazy(() => import("@/components/financeiro/PainelLancamentos").then(m => ({ default: m.PainelLancamentos })));
const SefazModal = lazy(() => import("@/components/financeiro/SefazModal").then(m => ({ default: m.SefazModal })));
import {
  ArrowLeft, Receipt, CheckCircle2, Package, User, Clock, Printer,
  Truck, ChevronDown, ChevronUp, Send, X, RefreshCw,
  FileText, History, BadgeCheck, Ban, Bell, FileCheck2,
  AlertCircle, Building2, Hash, DollarSign, CreditCard,
  Banknote, Landmark, ChevronRight, Loader2, MapPin,
  Mail, Percent, ShoppingCart, Wrench, Monitor, Zap,
  Cpu, FlaskConical, Factory, PlusCircle, Edit3, Trash2,
  Link, TestTube2, CheckSquare, AlertTriangle, TrendingDown,
  Wallet, CalendarDays, BarChart3, Tag, Building,
  TrendingUp, Download, Search, Copy, Repeat2,
  BarChart2, PieChart, Layers, Sun, Moon, FileSpreadsheet,
} from "lucide-react";

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface PedidoItem {
  id: string;
  stock_item_id: string;
  lote: string;
  quantidade: number;
  device_model?: string;
  device_reference?: string;
  device_id?: string;
  ncm?: string;
  cfop?: string;
  cfop_padrao?: string;
  ipi_pct?: number;
  valor_unitario?: number;
  preco_venda?: number;
  desconto_max_pct?: number;
}

export interface Pedido {
  id: string;
  cliente_nome: string;
  cliente_documento?: string;
  cliente_telefone?: string;
  cliente_email?: string;
  cliente_endereco?: string;
  vendedora_nome: string | null;
  vendedora_id: string | null;
  status: string;
  frete: number;
  observacoes: string | null;
  nota_fiscal: string | null;
  forma_pagamento?: string | null;
  parcelas?: number;
  endereco_entrega?: string | null;
  usar_endereco_cliente?: boolean;
  protocolo_sefaz?: string | null;
  chave_acesso_nfe?: string | null;
  desconto_pct?: number;
  xml_nfe?: string | null;
  rastreio_envio?: string | null;
  transportadora?: string | null;
  created_at: string;
  separado_em: string | null;
  nf_criada_em: string | null;
  enviado_em: string | null;
  itens: PedidoItem[];
}

export interface ItemFiscal {
  pedido_item_id: string;
  descricao: string;
  ncm: string;
  cfop: string;
  unidade: string;
  quantidade: number;
  valorUnitario: string;
  aliqICMS: string;
  ipi_pct: string;
  cst: string;
}

export interface DadosFiscais {
  tipoNota: "nfe" | "nfce";
  numero: string;
  serie: string;
  naturezaOperacao: string;
  destDocumento: string;
  destNome: string;
  destEmail: string;
  destEndereco: string;
  itens: ItemFiscal[];
  tipoPagamento: string;
  valorTotal: string;
  modFrete: string;
  valorFrete: string;
  informacoesAdicionais: string;
}

export interface SefazResult {
  sucesso: boolean;
  chaveAcesso?: string;
  protocolo?: string;
  dhAutorizacao?: string;
  cStat?: string;
  xMotivo?: string;
  erro?: string;
  xmlAssinado?: string;
}




// ─── RastreioSection — rastreamento de envio por pedido ─────────────────────

interface RastreioSectionProps {
  pedido: Pedido;
  onSaved: () => void;
}

function RastreioSection({ pedido, onSaved }: RastreioSectionProps) {
  const [editing, setEditing] = useState(false);
  const [rastreio, setRastreio] = useState(pedido.rastreio_envio ?? "");
  const [transp, setTransp] = useState(pedido.transportadora ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    const { error } = await supabase
      .from("pedidos_comerciais")
      .update({ rastreio_envio: rastreio.trim() || null, transportadora: transp.trim() || null })
      .eq("id", pedido.id);
    setSaving(false);
    if (error) { toast.error("Erro ao salvar rastreio."); return; }
    toast.success("Rastreio salvo!");
    setEditing(false);
    onSaved();
  }

  const hasRastreio = !!(pedido.rastreio_envio || rastreio.trim());
  const rastreioUrl = rastreio.trim()
    ? `https://www.linketrack.com/track/${encodeURIComponent(rastreio.trim())}`
    : null;

  if (!editing && !hasRastreio) {
    return (
      <button type="button" onClick={() => setEditing(true)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-border/40 text-[11px] text-muted-foreground/60 hover:border-violet-500/30 hover:text-violet-500 transition-colors">
        <Truck className="h-3.5 w-3.5 shrink-0" />
        Adicionar código de rastreio
      </button>
    );
  }

  if (!editing) {
    return (
      <div className="rounded-xl bg-muted/10 border border-border/20 px-3 py-2 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">Rastreio</span>
          <button type="button" onClick={() => setEditing(true)}
            className="text-[10px] text-violet-500 hover:text-violet-400 transition-colors">Editar</button>
        </div>
        {pedido.transportadora && <p className="text-[11px] text-muted-foreground">{pedido.transportadora}</p>}
        <div className="flex items-center gap-2">
          <p className="text-[11px] font-mono font-semibold">{pedido.rastreio_envio}</p>
          {rastreioUrl && (
            <a href={rastreioUrl} target="_blank" rel="noopener noreferrer"
              className="text-[10px] text-violet-500 hover:underline">Rastrear →</a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-muted/10 border border-violet-500/20 px-3 py-2.5 space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">Rastreio de envio</p>
      <input type="text" value={transp} onChange={e => setTransp(e.target.value)} placeholder="Transportadora (ex: Correios)"
        className="w-full h-8 px-3 rounded-lg border border-border/50 bg-background text-foreground text-[12px] focus:outline-none focus:ring-2 focus:ring-violet-500/30" />
      <input type="text" value={rastreio} onChange={e => setRastreio(e.target.value)} placeholder="Código de rastreio (ex: AA123456789BR)"
        className="w-full h-8 px-3 rounded-lg border border-border/50 bg-background text-foreground text-[12px] font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30" />
      <div className="flex gap-2">
        <button type="button" onClick={() => setEditing(false)}
          className="flex-1 h-8 rounded-lg border border-border/40 text-[11px] text-muted-foreground hover:bg-muted/30 transition-colors">Cancelar</button>
        <button type="button" onClick={handleSave} disabled={saving}
          className="flex-1 h-8 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5">
          {saving ? <div className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : null}
          Salvar
        </button>
      </div>
    </div>
  );
}

// ─── NFViewerModal — visualiza e baixa a NF emitida ──────────────────────────

interface NFViewerModalProps {
  pedido: Pedido | null;
  onClose: () => void;
}

function NFViewerModal({ pedido, onClose }: NFViewerModalProps) {
  const [xmlNfe, setXmlNfe] = useState<string | null>(null);
  const [loadingXml, setLoadingXml] = useState(false);

  // Busca xml_nfe sob demanda — não carregado na listagem para economizar memória
  const pedidoId = pedido?.id ?? null;
  useEffect(() => {
    if (!pedidoId) { setXmlNfe(null); return; }
    setXmlNfe(null);
    setLoadingXml(true);
    supabase
      .from("pedidos_comerciais")
      .select("xml_nfe")
      .eq("id", pedidoId)
      .single()
      .then(({ data }) => {
        setXmlNfe((data as { xml_nfe?: string | null } | null)?.xml_nfe ?? null);
        setLoadingXml(false);
      });
  }, [pedidoId]);

  if (!pedido) return null;

  function downloadXml() {
    if (!xmlNfe || !pedido) return;
    const blob = new Blob([xmlNfe!], { type: "application/xml" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `NFe-${pedido.nota_fiscal ?? "nota"}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyChave() {
    if (!pedido?.chave_acesso_nfe) return;
    navigator.clipboard.writeText(pedido.chave_acesso_nfe);
    toast.success("Chave copiada!");
  }

  function viewDanfe() {
    const itensList = pedido?.itens ?? [];
    const nfNum = pedido?.nota_fiscal ?? "0";
    const uf = detectarUF(pedido?.cliente_endereco) ?? undefined;

    const html = gerarDanfeHtml({
      tipoOperacao: "saida",
      naturezaOperacao: "VENDA DE MERCADORIA ADQUIRIDA OU RECEBIDA DE TERCEIROS",
      numero: nfNum,
      serie: "1",
      chaveAcesso: pedido?.chave_acesso_nfe ?? null,
      protocolo: pedido?.protocolo_sefaz ?? null,
      dataEmissao: pedido?.nf_criada_em ?? pedido?.created_at ?? new Date().toISOString(),
      dataSaida: pedido?.enviado_em ?? pedido?.nf_criada_em ?? null,
      destinatario: {
        nome: pedido?.cliente_nome ?? "—",
        documento: pedido?.cliente_documento ?? null,
        endereco: pedido?.cliente_endereco ?? null,
        uf,
        telefone: pedido?.cliente_telefone ?? null,
      },
      transportador: pedido?.transportadora ? { nome: pedido.transportadora } : null,
      itens: itensList.map(i => ({
        codigo: i.device_reference ?? i.device_id ?? undefined,
        descricao: i.device_model ?? "Produto",
        ncm: i.ncm,
        cfop: i.cfop ?? i.cfop_padrao,
        quantidade: i.quantidade,
        valorUnitario: i.valor_unitario ?? 0,
        aliqIpi: i.ipi_pct,
      })),
      valorFrete: pedido?.frete ?? 0,
      observacoes: pedido?.observacoes ?? null,
    });

    const w = window.open("", "_blank");
    if (!w) { toast.error("Popup bloqueado. Permita popups para visualizar a NF."); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-card border border-border/30 shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/20 bg-gradient-to-r from-emerald-500/5 to-transparent">
          <div className="flex items-center gap-2">
            <FileCheck2 className="h-4 w-4 text-emerald-600" />
            <div>
              <p className="text-sm font-bold">Nota Fiscal Emitida</p>
              <p className="text-[11px] text-muted-foreground">{pedido.nota_fiscal} · {pedido.cliente_nome}</p>
            </div>
          </div>
          <button type="button" onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/8 border border-emerald-500/20">
            <BadgeCheck className="h-4 w-4 text-emerald-600 shrink-0" />
            <span className="text-[12px] font-semibold text-emerald-700 dark:text-emerald-400">NF autorizada pelo SEFAZ</span>
            {pedido.protocolo_sefaz && (
              <span className="ml-auto text-[10px] font-mono text-emerald-600/70">Prot. {pedido.protocolo_sefaz}</span>
            )}
          </div>
          {pedido.chave_acesso_nfe && (
            <div className="rounded-xl bg-muted/20 border border-border/30 p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Chave de Acesso</p>
                <button type="button" onClick={copyChave}
                  className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border border-violet-300 dark:border-violet-700 hover:bg-violet-200 transition-colors">
                  <Copy className="h-2.5 w-2.5" />Copiar
                </button>
              </div>
              <p className="text-[9px] font-mono break-all text-muted-foreground leading-relaxed">{pedido.chave_acesso_nfe}</p>
            </div>
          )}
          <div className="rounded-xl bg-muted/10 border border-border/20 px-3 py-2 space-y-1">
            {pedido.itens.slice(0, 4).map(i => (
              <div key={i.id} className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground truncate">{i.device_model}</span>
                <span className="font-bold shrink-0 ml-2">{i.quantidade} un.</span>
              </div>
            ))}
            {pedido.itens.length > 4 && (
              <p className="text-[10px] text-muted-foreground/60">+{pedido.itens.length - 4} itens</p>
            )}
          </div>

          {/* Rastreio de envio */}
          <RastreioSection pedido={pedido} onSaved={() => {}} />
        </div>
        <div className="flex gap-2 px-5 pb-5">
          <button type="button" onClick={viewDanfe}
            className="flex-1 h-10 flex items-center justify-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[12px] font-semibold transition-colors">
            <FileText className="h-3.5 w-3.5" />Ver / Imprimir NF
          </button>
          {loadingXml && (
            <div className="h-10 px-3 flex items-center justify-center rounded-xl bg-muted/20 border border-border/30">
              <div className="h-3.5 w-3.5 border-2 border-muted-foreground/40 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {!loadingXml && xmlNfe && (
            <button type="button" onClick={downloadXml}
              className="h-10 px-3 flex items-center justify-center gap-1.5 rounded-xl bg-muted/30 hover:bg-muted/60 text-muted-foreground border border-border/40 text-[11px] font-semibold transition-colors">
              <Download className="h-3.5 w-3.5" />XML
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── PedidoCard ──────────────────────────────────────────────────────────────

function PedidoCard({ pedido, onEmitirNF, onVerNF }: { pedido: Pedido; onEmitirNF: (p: Pedido) => void; onVerNF: (p: Pedido) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [copied,   setCopied]   = useState(false);
  const totalItens = pedido.itens.reduce((s, i) => s + i.quantidade, 0);

  function copyChave() {
    if (!pedido.chave_acesso_nfe) return;
    navigator.clipboard.writeText(pedido.chave_acesso_nfe);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const [downloadingXml, setDownloadingXml] = useState(false);
  // Detecta se a NF foi emitida em modo teste (chave fake = termina em zeros)
  const isTesteNF = !!(pedido.chave_acesso_nfe?.endsWith("00000000000000000000"));
  async function downloadXml() {
    if (downloadingXml) return;
    if (isTesteNF) {
      toast.info("XML não disponível em modo Homologação — emita em modo Produção para gerar o XML real.");
      return;
    }
    let xml = pedido.xml_nfe;
    if (!xml) {
      setDownloadingXml(true);
      const { data } = await supabase
        .from("pedidos_comerciais").select("xml_nfe").eq("id", pedido.id).single();
      xml = (data as { xml_nfe?: string | null } | null)?.xml_nfe ?? null;
      setDownloadingXml(false);
    }
    if (!xml) { toast.error("XML não disponível — esta NF pode ter sido emitida em modo Homologação."); return; }
    const blob = new Blob([xml], { type: "application/xml" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `NFe-${pedido.nota_fiscal ?? "nota"}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const isPronto   = pedido.status === "pronto";
  const isFaturado = pedido.status === "faturado";
  const isEnviado  = pedido.status === "enviado";
  const accentColor = isPronto ? "#10b981" : isFaturado ? "#7c3aed" : isEnviado ? "#22c55e" : "hsl(var(--muted-foreground))";
  const borderColor = isPronto ? "#34d399" : isFaturado ? "#a78bfa" : isEnviado ? "#4ade80" : "hsl(var(--border))";

  return (
    <div style={{ border: `1.5px solid ${borderColor}`, borderRadius: 16, overflow: "hidden", background: "hsl(var(--card))" }}
      className="transition-shadow hover:shadow-lg flex flex-col">
      <div style={{ height: 3, background: accentColor }} />
      <button type="button" onClick={() => setExpanded(v => !v)}
        className="w-full text-left px-4 pt-3 pb-3 flex items-start gap-3">
        <div className="shrink-0 mt-0.5" style={{
          width: 36, height: 36, borderRadius: 10, display: "flex",
          alignItems: "center", justifyContent: "center",
          background: isPronto ? "rgba(16,185,129,0.12)" : isFaturado ? "rgba(124,58,237,0.12)" : isEnviado ? "rgba(34,197,94,0.12)" : "hsl(var(--muted))"
        }}>
          {isEnviado  ? <BadgeCheck size={18} color="#22c55e" /> :
           isFaturado ? <FileCheck2 size={18} color="#7c3aed" /> :
                        <Receipt    size={18} color="#10b981" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-[14px] font-bold text-foreground truncate">{pedido.cliente_nome}</span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg"
              style={{ background: `${accentColor}18`, color: accentColor, border: `1px solid ${accentColor}40` }}>
              {statusLabel(pedido.status)}
            </span>
            {(pedido.desconto_pct ?? 0) > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-lg bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-500/30">
                -{pedido.desconto_pct}%
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {pedido.vendedora_nome && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <User size={10} />{pedido.vendedora_nome}
              </span>
            )}
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Package size={10} />{totalItens} un.
            </span>
            {pedido.nota_fiscal && (
              <span className="flex items-center gap-1 text-[11px] font-mono text-violet-600 dark:text-violet-400">
                <FileText size={10} />{pedido.nota_fiscal}
              </span>
            )}
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
              <Clock size={10} />{fmtDate(pedido.created_at)}
            </span>
          </div>
        </div>
        {expanded ? <ChevronUp size={16} className="text-muted-foreground/70 shrink-0 mt-1" /> : <ChevronDown size={16} className="text-muted-foreground/70 shrink-0 mt-1" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3" style={{ borderTop: "1px solid hsl(var(--border))" }}>
          <div className="grid grid-cols-3 gap-2 pt-3">
            {[
              { label: "Criado",     value: pedido.created_at,   color: "hsl(var(--muted-foreground))" },
              { label: "Separado",   value: pedido.separado_em,  color: "#10b981" },
              { label: "NF emitida", value: pedido.nf_criada_em, color: "#7c3aed" },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-xl p-2 text-center bg-muted/20 border border-border/50">
                <p className="text-[9px] font-semibold uppercase tracking-wide mb-1" style={{ color }}>{label}</p>
                <p className="text-[10px] font-mono text-muted-foreground">{value ? fmtDate(value) : "—"}</p>
              </div>
            ))}
          </div>
          <div className="space-y-1">
            {pedido.itens.map(item => (
              <div key={item.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/20 border border-border/40">
                <Package size={12} className="text-muted-foreground/70 shrink-0" />
                <span className="text-[12px] font-medium text-foreground flex-1 truncate">{item.device_model}</span>
                <span className="text-[11px] font-bold">{item.quantidade} un.</span>
              </div>
            ))}
          </div>
          {pedido.chave_acesso_nfe && (
            <div className="rounded-xl p-3 space-y-2 bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">Chave de Acesso</p>
                <button type="button" onClick={copyChave}
                  className={cn("flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-lg border border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 transition-colors",
                    copied ? "bg-violet-200 dark:bg-violet-900/50" : "bg-violet-100 dark:bg-violet-900/30")}>
                  <Copy size={10} />{copied ? "Copiado!" : "Copiar"}
                </button>
              </div>
              <p className="text-[9px] font-mono break-all leading-relaxed text-muted-foreground">{pedido.chave_acesso_nfe}</p>
              {pedido.protocolo_sefaz && (
                <p className="text-[10px] font-mono font-semibold text-violet-600 dark:text-violet-400">Protocolo: {pedido.protocolo_sefaz}</p>
              )}
            </div>
          )}
          {/* Rastreio de envio — editável direto no card */}
          {(isFaturado || isEnviado) && (
            <RastreioSection pedido={pedido} onSaved={() => {}} />
          )}

          <div className="flex gap-2 pt-1">
            {/* Botão Ver NF — aparece para pedidos faturados ou enviados com NF */}
            {(isFaturado || isEnviado) && (
              <button type="button" onClick={() => onVerNF(pedido)}
                className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-xl text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors">
                <FileCheck2 size={13} />Ver NF
              </button>
            )}
            {/* Botão download XML — busca sob demanda se necessário */}
            {pedido.status === "enviado" && (
              <button type="button" onClick={downloadXml} disabled={downloadingXml}
                className="h-9 px-3 flex items-center justify-center gap-1.5 rounded-xl text-[11px] font-semibold bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border border-violet-300 dark:border-violet-700 hover:bg-violet-200 transition-colors">
                {downloadingXml
                  ? <span className="animate-spin h-3 w-3 border border-current border-t-transparent rounded-full" />
                  : <Download size={13} />}
                XML
              </button>
            )}
            {isPronto && (
              <button type="button" onClick={() => onEmitirNF(pedido)}
                className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-xl text-[12px] font-bold text-white hover:opacity-90 transition-all active:scale-95"
                style={{ background: "#7c3aed", boxShadow: "0 2px 8px rgba(124,58,237,0.35)" }}>
                <FileCheck2 size={14} />Emitir NF-e
              </button>
            )}
            {isEnviado && (
              <div className="flex items-center justify-center gap-1.5 text-[10px] font-semibold text-green-700 dark:text-green-400">
                <BadgeCheck size={12} />Enviado
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


// ─── PainelDashboard ─────────────────────────────────────────────────────────

function PainelDashboard({ pedidos, lancamentos }: { pedidos: Pedido[]; lancamentos: LancamentoFinanceiro[] }) {
  const mesAtual = new Date().toISOString().slice(0, 7);

  const vendas = pedidos.filter(p => p.status === "faturado" || p.status === "enviado");
  const totalReceitaMes = vendas
    .filter(p => (p.nf_criada_em ?? p.created_at).startsWith(mesAtual))
    .reduce((s, p) => s + p.itens.reduce((si, i) => si + i.quantidade * (i.valor_unitario ?? 0), 0) + p.frete, 0);
  const totalCustoMes = lancamentos
    .filter(l => l.data_lancamento.startsWith(mesAtual))
    .reduce((s, l) => s + l.valor, 0);
  const totalCusto = lancamentos.reduce((s, l) => s + l.valor, 0);
  const lucroMes   = totalReceitaMes - totalCustoMes;
  const pendentesNF = pedidos.filter(p => p.status === "pronto").length;

  const custoPorTipo = [
    { label: "Produção",    valor: lancamentos.filter(l => l.tipo === "compra_producao").reduce((s, l) => s + l.valor, 0),    color: "#7c3aed" },
    { label: "Empresa",     valor: lancamentos.filter(l => l.tipo === "compra_empresa").reduce((s, l) => s + l.valor, 0),     color: "#0ea5e9" },
    { label: "Operacional", valor: lancamentos.filter(l => l.tipo === "custo_operacional").reduce((s, l) => s + l.valor, 0),  color: "#f97316" },
  ];

  const topFornecedores = Object.entries(
    lancamentos.reduce((acc, l) => {
      if (!l.fornecedor) return acc;
      acc[l.fornecedor] = (acc[l.fornecedor] ?? 0) + l.valor;
      return acc;
    }, {} as Record<string, number>)
  ).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const recorrentes = lancamentos.filter(l => l.recorrente);

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Receita do Mês",   value: fmtCurrency(totalReceitaMes), sub: `${vendas.filter(p => (p.nf_criada_em ?? p.created_at).startsWith(mesAtual)).length} vendas`, icon: TrendingUp, color: "#10b981" },
          { label: "Custos do Mês",    value: fmtCurrency(totalCustoMes),   sub: `${lancamentos.filter(l => l.data_lancamento.startsWith(mesAtual)).length} lançamentos`, icon: TrendingDown, color: "#ef4444" },
          { label: "Resultado do Mês", value: fmtCurrency(lucroMes),        sub: lucroMes >= 0 ? "Lucro" : "Prejuízo", icon: BarChart2, color: lucroMes >= 0 ? "#7c3aed" : "#f97316" },
          { label: "NFs Pendentes",    value: String(pendentesNF),           sub: "pedidos prontos", icon: FileText, color: "#0ea5e9" },
        ].map(k => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="rounded-2xl p-4 flex flex-col gap-3 bg-card border border-border/50"
              style={{ boxShadow: "0 1px 3px hsl(var(--border)/0.3)" }}>
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{k.label}</p>
                <div className="h-8 w-8 rounded-xl flex items-center justify-center" style={{ background: `${k.color}15`, color: k.color }}>
                  <Icon size={16} />
                </div>
              </div>
              <div>
                <p className="text-2xl font-black tabular-nums" style={{ color: k.color }}>{k.value}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{k.sub}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Distribuição de custos + Fornecedores */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-card border border-border/50 p-4 space-y-4">
          <div className="flex items-center gap-2">
            <PieChart size={15} className="text-violet-500" />
            <p className="text-sm font-bold">Distribuição de Custos</p>
          </div>
          {custoPorTipo.map(c => {
            const pct = totalCusto > 0 ? (c.valor / totalCusto) * 100 : 0;
            return (
              <div key={c.label} className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold" style={{ color: c.color }}>{c.label}</span>
                  <span className="font-mono font-bold">{fmtCurrency(c.valor)}</span>
                </div>
                <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: c.color }} />
                </div>
                <p className="text-[10px] text-muted-foreground">{pct.toFixed(1)}% do total</p>
              </div>
            );
          })}
          <div className="pt-2 border-t border-border/40 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-muted-foreground">Total custos</span>
            <span className="text-[14px] font-black text-red-600 dark:text-red-400 font-mono">{fmtCurrency(totalCusto)}</span>
          </div>
        </div>

        <div className="rounded-2xl bg-card border border-border/50 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Layers size={15} className="text-violet-500" />
            <p className="text-sm font-bold">Maiores Fornecedores</p>
          </div>
          {topFornecedores.length === 0 ? (
            <p className="text-[12px] text-muted-foreground py-4 text-center">Nenhum fornecedor registrado ainda</p>
          ) : (
            topFornecedores.map(([nome, valor], idx) => (
              <div key={nome} className="flex items-center gap-3">
                <div className="h-6 w-6 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-black text-violet-600">{idx + 1}</span>
                </div>
                <p className="text-[12px] font-semibold truncate flex-1">{nome}</p>
                <p className="text-[12px] font-bold font-mono shrink-0">{fmtCurrency(valor)}</p>
              </div>
            ))
          )}

          {recorrentes.length > 0 && (
            <div className="pt-3 border-t border-border/40 space-y-2">
              <p className="text-[11px] font-bold flex items-center gap-1.5">
                <Repeat2 size={12} className="text-sky-500" />Custos Recorrentes ({recorrentes.length})
              </p>
              {recorrentes.slice(0, 3).map(l => (
                <div key={l.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-sky-500/5 border border-sky-500/15">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold truncate">{l.descricao}</p>
                    <p className="text-[10px] text-muted-foreground capitalize">{l.periodicidade}</p>
                  </div>
                  <p className="text-[12px] font-bold font-mono text-red-500 shrink-0">{fmtCurrency(l.valor)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── SefazConfigPanel ────────────────────────────────────────────────────────

/**
 * Config de ambiente fiscal + SEFAZ — SOMENTE ADMIN. Alternar homolog/
 * produção muda o valor fiscal das notas do sistema inteiro, e o card de
 * configuração expõe nomes de secrets/funções — usuários do Financeiro não
 * precisam ver nada disso. O aviso "Modo Homologação ativo" continua
 * aparecendo nas telas de emissão.
 *
 * Antes ficava dentro da aba "Bancos" (não fazia muito sentido — é config de
 * emissão de nota fiscal, não de conta bancária). Agora mora aqui, dentro da
 * própria aba "NF-e / SEFAZ".
 */
function SefazConfigPanel({ modoTeste, onToggleModoTeste }: { modoTeste: boolean; onToggleModoTeste: () => void }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) return null;
  return (
    <div className="space-y-3">
      <div className={cn("rounded-2xl border p-4 flex items-start gap-3",
        modoTeste ? "border-orange-500/30 bg-orange-500/5" : "border-green-500/30 bg-green-500/5")}>
        <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center shrink-0",
          modoTeste ? "bg-orange-500/10" : "bg-green-500/10")}>
          <TestTube2 className={cn("h-5 w-5", modoTeste ? "text-orange-500" : "text-green-600")} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-bold leading-snug">{modoTeste ? "Modo Homologação (Teste)" : "Modo Produção"}</p>
            <button type="button" onClick={onToggleModoTeste}
              className={cn("h-4 w-7 sm:h-5 sm:w-10 min-w-[28px] sm:min-w-[40px] rounded-full transition-colors relative shrink-0 mt-0.5",
                modoTeste ? "bg-orange-500" : "bg-muted/50")}>
              <span className={cn("absolute top-0.5 h-3 w-3 sm:h-4 sm:w-4 rounded-full bg-background shadow transition-all duration-200",
                modoTeste ? "left-[calc(100%-14px)] sm:left-[calc(100%-18px)]" : "left-0.5")} />
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            {modoTeste
              ? "Notas simuladas — sem valor fiscal. Ideal para testes."
              : "Notas com valor fiscal real, transmitidas ao SEFAZ."}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4 space-y-2">
        <div className="flex items-center gap-2 mb-2">
          <Send className="h-4 w-4 text-violet-500" />
          <p className="text-sm font-bold">Configuração SEFAZ</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
          {[
            ["Edge Function", "sefaz-emitir (Supabase)"],
            ["Ambiente",      "SEFAZ_TP_AMB=2 (homolog) / 1 (produção)"],
            ["Certificado",   "SEFAZ_CERT_PFX (base64 do A1)"],
            ["CNPJ Emitente", "SEFAZ_CNPJ"],
            ["Numeração NF",  "Automática via get_next_nf_number()"],
            ["Envio XML",     "Automático após autorização"],
          ].map(([k, v]) => (
            <div key={k} className="flex items-start gap-1.5 py-0.5 text-muted-foreground">
              <span className="shrink-0">•</span>
              <span><strong className="text-foreground">{k}:</strong> <code className="text-violet-500 text-[10px]">{v}</code></span>
            </div>
          ))}
        </div>
        <button type="button"
          onClick={async () => {
            toast.info("Testando conexão com SEFAZ…");
            await new Promise(r => setTimeout(r, 1200));
            toast.success("[TESTE] Conexão simulada com sucesso.");
          }}
          className="w-full h-8 flex items-center justify-center gap-1.5 rounded-xl border border-violet-500/30 text-violet-600 text-[11px] font-medium hover:bg-violet-500/10 transition-colors mt-2">
          <TestTube2 className="h-3 w-3" />Testar Conexão SEFAZ
        </button>
      </div>
    </div>
  );
}


// ─── HistoricoModal ──────────────────────────────────────────────────────────

function HistoricoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("pedidos_comerciais")
      .select(`
        id, vendedora_id, vendedora_nome, status, frete, observacoes,
        nota_fiscal, protocolo_sefaz, chave_acesso_nfe, desconto_pct, xml_nfe,
        created_at, separado_em, nf_criada_em, enviado_em,
        clientes(nome, documento),
        pedido_itens(id, stock_item_id, lote, quantidade,
          stock_items!pedido_itens_stock_item_id_fkey(devices!stock_items_device_id_fkey(model, reference)))
      `)
      .or("status.eq.faturado,status.eq.enviado")
      .order("nf_criada_em", { ascending: false })
      .limit(50);
    if (!error && data) {
      setPedidos((data as Record<string, unknown>[]).map(p => {
        const cli = (p.clientes as { nome?: string; documento?: string } | null) ?? {};
        return {
          id: p.id as string,
          cliente_nome: cli.nome ?? "(cliente sem acesso)", cliente_documento: cli.documento,
          vendedora_nome: p.vendedora_nome as string | null,
          vendedora_id:   p.vendedora_id   as string | null,
          status: p.status as string, frete: (p.frete as number) ?? 0,
          observacoes: p.observacoes as string | null,
          nota_fiscal: p.nota_fiscal as string | null,
          protocolo_sefaz: p.protocolo_sefaz as string | null,
          chave_acesso_nfe: p.chave_acesso_nfe as string | null,
          xml_nfe: (p.xml_nfe as string | null) ?? null,
          desconto_pct: (p.desconto_pct as number) ?? 0,
          created_at: p.created_at as string,
          separado_em: p.separado_em as string | null,
          nf_criada_em: p.nf_criada_em as string | null,
          enviado_em: p.enviado_em as string | null,
          itens: ((p.pedido_itens as Record<string, unknown>[]) ?? []).map((i: Record<string, unknown>) => ({
            id: i.id as string, stock_item_id: i.stock_item_id as string,
            lote: (i.lote as string) ?? "", quantidade: i.quantidade as number,
            device_model: ((i.stock_items as { devices?: { model?: string } } | null)?.devices?.model),
          })),
        };
      }));
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (open) load(); else setPedidos([]); }, [open, load]);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-card border border-border/40 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in slide-in-from-bottom-4 duration-200">
        <div className="px-5 pt-5 pb-3 shrink-0 border-b border-border/20 flex items-center justify-between">
          <div>
            <p className="text-sm font-bold flex items-center gap-2">
              <History className="h-4 w-4 text-violet-500" />Histórico de Notas Fiscais
            </p>
            <p className="text-[12px] text-muted-foreground mt-0.5">Últimas {pedidos.length} notas emitidas</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={load} disabled={loading}
              className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground">
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </button>
            <button type="button" onClick={onClose}
              className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="px-3 pb-4 pt-2 overflow-y-auto flex-1 space-y-1.5">
          {loading
            ? <div className="flex items-center justify-center py-10"><div className="animate-spin h-5 w-5 border-2 border-violet-500 border-t-transparent rounded-full" /></div>
            : pedidos.length === 0
              ? <div className="text-center py-12 text-sm text-muted-foreground">Nenhuma nota emitida ainda</div>
              : pedidos.map(p => {
            const enviado = p.status === "enviado";
            return (
              <div key={p.id} className={cn("flex items-start gap-3 px-3 py-2.5 rounded-xl border",
                enviado ? "bg-green-500/4 border-green-500/15" : "bg-violet-500/4 border-violet-500/15")}>
                {enviado ? <Send className="h-4 w-4 mt-0.5 text-green-500 shrink-0" /> : <FileCheck2 className="h-4 w-4 mt-0.5 text-violet-500 shrink-0" />}
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-[12px] font-semibold truncate">{p.cliente_nome}</p>
                  {p.nota_fiscal && <p className="text-[11px] font-mono text-violet-500 flex items-center gap-1"><Tag className="h-2.5 w-2.5" />{p.nota_fiscal}</p>}
                  {p.protocolo_sefaz && <p className="text-[9px] font-mono text-muted-foreground/60">Prot: {p.protocolo_sefaz}</p>}
                  {p.vendedora_nome && <p className="text-[10px] text-muted-foreground flex items-center gap-1"><User className="h-2.5 w-2.5" />{p.vendedora_nome}</p>}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full border",
                    enviado ? "bg-green-500/10 text-green-600 border-green-500/30" : "bg-violet-500/10 text-violet-500 border-violet-500/30")}>
                    {enviado ? "Enviado" : "Faturado"}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{fmtDate(p.nf_criada_em ?? p.created_at)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}


// ─── Página Principal ────────────────────────────────────────────────────────

type FinTab = "dashboard" | "nfe" | "devolucoes" | "fluxo" | "fornecedores" | "compras" | "lancamentos" | "bancos" | "precos";

export default function Financeiro() {
  const navigate = useNavigate();
  const { isAdmin, role } = useAuth();
  const isMobile = useIsMobile();

  const [pedidos,       setPedidos]       = useState<Pedido[]>([]);
  const [nfViewerPedido, setNfViewerPedido] = useState<Pedido | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [filtroStatus,  setFiltroStatus]  = useState("pronto");
  const [sefazPedido,   setSefazPedido]   = useState<Pedido | null>(null);
  const [historicoOpen, setHistoricoOpen] = useState(false);
  const [devolucoesKey, setDevolucoesKey] = useState(0); // remonta o painel de devoluções após "Apagar histórico"
  const [activeTab,     setActiveTab]     = useState<FinTab>("dashboard");
  const [comprasSubView, setComprasSubView] = useState<"fornecedores" | "pedidos">("fornecedores");
  // Sub-aba dentro de "Lançamentos" — unifica o que antes eram 3 abas
  // separadas (Compras Produção, Compras Empresa, Custos), todas usando o
  // mesmo componente PainelLancamentos só com tipo diferente.
  const [lancTipo, setLancTipo] = useState<LancamentoFinanceiro["tipo"]>("compra_producao");
  const [lancamentos,   setLancamentos]   = useState<LancamentoFinanceiro[]>([]);
  const [searchNF,      setSearchNF]      = useState("");

  const [modoTeste, setModoTeste] = useState(() =>
    localStorage.getItem("financeiro_modo_teste") !== "producao"
  );

  const toggleModoTeste = useCallback(() => {
    setModoTeste(v => {
      const next = !v;
      localStorage.setItem("financeiro_modo_teste", next ? "teste" : "producao");
      toast.info(next ? "Modo Homologação ativado" : "Modo Produção ativado");
      return next;
    });
  }, []);


  const canAccess = isAdmin || role === "financeiro";
  const abortRef  = useRef<AbortController | null>(null);

  const loadPedidos = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);

    // Usamos left join (sem !inner) em clientes para não perder pedidos cujos
    // clientes foram criados por vendedoras (RLS de clientes filtraria com !inner).
    // pedido_itens e stock_items também sem !inner para não perder pedidos sem itens.
    const { data, error } = await supabase
      .from("pedidos_comerciais")
      .select(`
        id, cliente_id, vendedora_id, vendedora_nome, status, frete, observacoes,
        nota_fiscal, protocolo_sefaz, chave_acesso_nfe, desconto_pct,
        rastreio_envio, transportadora, forma_pagamento, parcelas,
        endereco_entrega, usar_endereco_cliente,
        created_at, separado_em, nf_criada_em, enviado_em,
        clientes(nome, documento, telefone, email, endereco, logradouro, numero, bairro, municipio, uf, cep),
        pedido_itens(
          id, stock_item_id, lote, quantidade, valor_unitario,
          stock_items!pedido_itens_stock_item_id_fkey(devices!stock_items_device_id_fkey(id, model, reference, ncm, cfop_padrao, ipi_pct, preco_venda, desconto_max_pct))
        )
      `)
      .or("status.eq.pronto,status.eq.faturado,status.eq.enviado")
      .order("created_at", { ascending: false })
      .abortSignal(ctrl.signal);

    if (ctrl.signal.aborted) return;

    if (error) {
      logger.error("loadPedidos:", error);
      toast.error(friendlyError(error));
      setLoading(false);
      return;
    }

    if (data) {
      setPedidos((data as Record<string, unknown>[]).map(p => {
        // clientes pode ser null se o RLS impediu — usamos fallback seguro
        const cli = (p.clientes as { nome?: string; documento?: string; telefone?: string; email?: string; endereco?: string; logradouro?: string; numero?: string; bairro?: string; municipio?: string; uf?: string; cep?: string } | null) ?? {};
        const enderecoFormatado = cli.logradouro
          ? `${cli.logradouro}${cli.numero ? ", " + cli.numero : ""}${cli.bairro ? " — " + cli.bairro : ""}${cli.municipio ? " — " + cli.municipio : ""}${cli.uf ? "/" + cli.uf : ""}${cli.cep ? " CEP " + cli.cep : ""}`
          : (cli.endereco ?? "");
        const pedidoEndEntrega = (p.usar_endereco_cliente as boolean) !== false
          ? enderecoFormatado
          : ((p.endereco_entrega as string | null) ?? enderecoFormatado);
        return {
          id: p.id as string,
          cliente_nome:     cli.nome      ?? "(cliente sem acesso)",
          cliente_documento: cli.documento,
          cliente_telefone:  cli.telefone,
          cliente_email:     cli.email,
          cliente_endereco:  pedidoEndEntrega,
          vendedora_nome: p.vendedora_nome as string | null,
          vendedora_id:   p.vendedora_id   as string | null,
          status:         p.status as string,
          frete:          (p.frete as number) ?? 0,
          observacoes:    p.observacoes as string | null,
          nota_fiscal:    p.nota_fiscal as string | null,
          protocolo_sefaz:  p.protocolo_sefaz as string | null,
          chave_acesso_nfe: p.chave_acesso_nfe as string | null,
          xml_nfe: null, // carregado sob demanda no NFViewerModal
          rastreio_envio: (p.rastreio_envio as string | null) ?? null,
          transportadora: (p.transportadora as string | null) ?? null,
          desconto_pct:     (p.desconto_pct as number) ?? 0,
          forma_pagamento:  (p.forma_pagamento as string | null) ?? null,
          parcelas:         (p.parcelas as number) ?? 1,
          endereco_entrega: (p.endereco_entrega as string | null) ?? null,
          usar_endereco_cliente: (p.usar_endereco_cliente as boolean) ?? true,
          created_at:   p.created_at as string,
          separado_em:  p.separado_em  as string | null,
          nf_criada_em: p.nf_criada_em as string | null,
          enviado_em:   p.enviado_em   as string | null,
          itens: ((p.pedido_itens as Record<string, unknown>[]) ?? []).map((i: Record<string, unknown>) => ({
            id:            i.id            as string,
            stock_item_id: i.stock_item_id as string,
            lote:          (i.lote as string) ?? "",
            quantidade:    i.quantidade    as number,
            device_model:     ((i.stock_items as { devices?: { model?: string; reference?: string; ipi_pct?: number } } | null)?.devices?.model),
            device_reference: ((i.stock_items as { devices?: { model?: string; reference?: string; ipi_pct?: number } } | null)?.devices?.reference),
            ipi_pct:          ((i.stock_items as { devices?: { ipi_pct?: number } } | null)?.devices?.ipi_pct) ?? 0,
            preco_venda:      ((i.stock_items as { devices?: { preco_venda?: number } } | null)?.devices?.preco_venda) ?? 0,
            valor_unitario:   (i.valor_unitario as number | null) ?? 0,
            ncm:              ((i.stock_items as { devices?: { ncm?: string } } | null)?.devices?.ncm) ?? "",
            cfop_padrao:      ((i.stock_items as { devices?: { cfop_padrao?: string } } | null)?.devices?.cfop_padrao) ?? "",
          })),
        };
      }));
    }
    setLoading(false);
  }, []);

  const loadLancamentos = useCallback(async () => {
    const { data } = await supabase
      .from("financeiro_lancamentos")
      .select("id, tipo, categoria, descricao, fornecedor, valor, data_lancamento, nota_fiscal_manual, chave_nfe, status_nf, observacoes, recorrente, periodicidade, created_at, created_by")
      .order("data_lancamento", { ascending: false })
      .limit(200);
    setLancamentos((data ?? []) as LancamentoFinanceiro[]);
  }, []);

  useEffect(() => { loadPedidos(); loadLancamentos(); }, [loadPedidos, loadLancamentos]);

  const { prontos, faturados, enviados } = useMemo(() => ({
    prontos:   pedidos.filter(p => p.status === "pronto").length,
    faturados: pedidos.filter(p => p.status === "faturado" || p.status === "enviado").length,
    enviados:  pedidos.filter(p => p.status === "enviado").length,
  }), [pedidos]);

  const filtradosSearch = useMemo(() => {
    const base = filtroStatus === "todos" ? pedidos : pedidos.filter(p => p.status === filtroStatus);
    if (!searchNF.trim()) return base;
    const q = searchNF.toLowerCase();
    return base.filter(p =>
      p.cliente_nome.toLowerCase().includes(q) ||
      (p.nota_fiscal ?? "").toLowerCase().includes(q) ||
      (p.vendedora_nome ?? "").toLowerCase().includes(q));
  }, [pedidos, filtroStatus, searchNF]);

  const mesAtual  = new Date().toISOString().slice(0, 7);
  const custosMes = useMemo(() =>
    lancamentos.filter(l => l.data_lancamento.startsWith(mesAtual)).reduce((s, l) => s + l.valor, 0),
    [lancamentos, mesAtual]
  );

  if (loading && pedidos.length === 0) {
    return (
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-2 h-14">
          <div className="h-4 w-4 rounded bg-muted/60 animate-pulse" />
          <div className="h-4 w-28 rounded bg-muted/60 animate-pulse" />
        </div>
        <TableSkeleton rows={5} />
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-2">
          <Ban className="h-10 w-10 text-destructive/40 mx-auto" />
          <p className="text-sm text-muted-foreground">Acesso restrito ao setor financeiro.</p>
          <button type="button" onClick={() => navigate("/")} className="text-sm text-primary hover:underline">Voltar ao início</button>
        </div>
      </div>
    );
  }

  const TABS: { id: FinTab; label: string; icon: typeof Receipt; badge?: number }[] = [
    { id: "dashboard",    label: "Dashboard",        icon: BarChart2   },
    { id: "nfe",          label: "NF-e / SEFAZ",     icon: FileCheck2, badge: prontos },
    { id: "devolucoes",   label: "Devoluções/Trocas", icon: Repeat2    },
    { id: "fluxo",        label: "Contas & Fluxo de Caixa", icon: TrendingUp  },
    { id: "fornecedores", label: "Compras",           icon: Building2   },
    { id: "lancamentos",  label: "Lançamentos",       icon: Zap         },
    { id: "bancos",       label: "Bancos",            icon: Landmark    },
    { id: "precos",       label: "Tabela de Preços",  icon: Tag         },
  ];

  const PAGE_NAV_TABS = TABS.map((tab, i) => {
    const colors = [
      { activeColor: "text-primary", activeBg: "bg-primary/10", activeBorder: "border-primary/40", badgeBg: "bg-primary/15", badgeText: "text-primary" },
      { activeColor: "text-emerald-600 dark:text-emerald-400", activeBg: "bg-emerald-500/10", activeBorder: "border-emerald-500/40", badgeBg: "bg-emerald-500/15", badgeText: "text-emerald-600 dark:text-emerald-400" },
      { activeColor: "text-amber-600 dark:text-amber-400", activeBg: "bg-amber-500/10", activeBorder: "border-amber-500/40", badgeBg: "bg-amber-500/15", badgeText: "text-amber-600 dark:text-amber-400" },
      { activeColor: "text-blue-600 dark:text-blue-400", activeBg: "bg-blue-500/10", activeBorder: "border-blue-500/40", badgeBg: "bg-blue-500/15", badgeText: "text-blue-600 dark:text-blue-400" },
      { activeColor: "text-orange-600 dark:text-orange-400", activeBg: "bg-orange-500/10", activeBorder: "border-orange-500/40", badgeBg: "bg-orange-500/15", badgeText: "text-orange-600 dark:text-orange-400" },
      { activeColor: "text-cyan-600 dark:text-cyan-400", activeBg: "bg-cyan-500/10", activeBorder: "border-cyan-500/40", badgeBg: "bg-cyan-500/15", badgeText: "text-cyan-600 dark:text-cyan-400" },
      { activeColor: "text-violet-600 dark:text-violet-400", activeBg: "bg-violet-500/10", activeBorder: "border-violet-500/40", badgeBg: "bg-violet-500/15", badgeText: "text-violet-600 dark:text-violet-400" },
    ];
    return { id: tab.id, label: tab.label, Icon: tab.icon, badge: tab.badge, ...colors[i % colors.length] };
  });

  return (
    <div className="flex flex-col h-full bg-transparent">
      <header className="sticky top-0 z-10 bg-background text-foreground/80 backdrop-blur-md border-b border-border/40">
        <div className="px-3 sm:px-4 h-12 sm:h-14 flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2">
            <Receipt size={16} className="text-violet-600 dark:text-violet-400" />
            <h1 className="text-sm font-semibold">Financeiro</h1>
            <TestBadge modoTeste={modoTeste} />
            {prontos > 0 && (
              <span className="hidden sm:flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                <Receipt size={10} />{prontos} NF
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">

            {isAdmin && (
              <ClearHistoryButton
                rpc="admin_clear_financeiro"
                label="Apagar"
                confirmTitle="Apagar histórico financeiro?"
                confirmDescription="Apaga todas as contas a pagar e a receber e todas as notas de devolução/troca. Fornecedores, bancos e pedidos comerciais são mantidos."
                onCleared={() => { loadPedidos(); loadLancamentos(); setDevolucoesKey(k => k + 1); }}
                className="h-8"
              />
            )}
            <button type="button" onClick={() => setHistoricoOpen(true)}
              className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted/30 transition-colors text-muted-foreground"
              title="Histórico de NFs">
              <History size={15} />
            </button>
            <button type="button" onClick={() => { loadPedidos(); loadLancamentos(); }}
              className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted/30 transition-colors text-muted-foreground"
              title="Atualizar">
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto"><div className="px-3 sm:px-4 py-4 space-y-4">
        <PageNav
          tabs={PAGE_NAV_TABS}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          cols={isMobile ? 3 : undefined}
        />

        {activeTab === "dashboard" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-bold">Visão Geral Financeira</h2>
              <p className="text-[12px] text-muted-foreground">Resumo consolidado de receitas, custos e resultados</p>
            </div>
            <PainelDashboard pedidos={pedidos} lancamentos={lancamentos} />
          </div>
        )}

        {activeTab === "nfe" && (
          <>
            <SefazConfigPanel modoTeste={modoTeste} onToggleModoTeste={toggleModoTeste} />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Aguardando NF", value: prontos,   icon: Receipt,     color: "#10b981" },
                { label: "Faturados",     value: faturados, icon: FileCheck2,  color: "#7c3aed" },
                { label: "Enviados",      value: enviados,  icon: Send,        color: "#0ea5e9" },
                { label: "Custos/mês",    value: fmtCurrency(custosMes), icon: TrendingDown, color: "#f97316" },
              ].map(kpi => {
                const Icon = kpi.icon;
                return (
                  <div key={kpi.label} className="rounded-2xl p-4 flex items-start gap-3 bg-card border border-border/50"
                    style={{ boxShadow: "0 1px 3px hsl(var(--border)/0.3)" }}>
                    <div className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: `${kpi.color}15`, color: kpi.color }}>
                      <Icon size={18} />
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{kpi.label}</p>
                      <p className="text-2xl font-black tabular-nums" style={{ color: kpi.color }}>{kpi.value}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1 flex-wrap">
                {[
                  { id: "pronto",   label: "Aguardando NF", count: prontos   },
                  { id: "faturado", label: "Faturados",      count: faturados },
                  { id: "enviado",  label: "Enviados",        count: enviados  },
                  { id: "todos",    label: "Todos",           count: pedidos.length },
                ].map(f => (
                  <button key={f.id} type="button" onClick={() => setFiltroStatus(f.id)}
                    className={cn("h-8 px-3 rounded-full text-[11px] font-semibold border transition-all flex items-center gap-1.5",
                      filtroStatus === f.id
                        ? "bg-violet-600 text-white border-violet-600"
                        : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/50")}>
                    {f.label}
                    <span className={cn("text-[10px] px-1.5 rounded-full",
                      filtroStatus === f.id ? "bg-white/20" : "bg-muted text-muted-foreground")}>
                      {f.count}
                    </span>
                  </button>
                ))}
              </div>
              <SearchInputWithBarcode
                className="flex-1 min-w-[180px]"
                value={searchNF}
                onChange={v => setSearchNF(v)}
                onSearch={v => setSearchNF(v)}
                placeholder="Buscar cliente, NF, vendedora ou bipe o código..."
                height="h-8"
                showSearchIcon
              />
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin h-6 w-6 border-2 border-violet-500 border-t-transparent rounded-full" />
              </div>
            ) : filtradosSearch.length === 0 ? (
              <div className="text-center py-16 space-y-3">
                <div className="h-16 w-16 rounded-2xl mx-auto flex items-center justify-center bg-muted/30">
                  <Receipt size={28} className="text-muted-foreground/40" />
                </div>
                <div>
                  <p className="text-sm font-semibold">
                    {filtroStatus === "pronto" ? "Nenhum pedido aguardando nota fiscal" : "Nenhum pedido encontrado"}
                  </p>
                  <p className="text-[12px] text-muted-foreground/70 mt-0.5">
                    {searchNF ? "Tente outra busca" : "Pedidos aparecem aqui quando marcados como prontos no estoque"}
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-3 items-start">
                {filtradosSearch.map(p => <PedidoCard key={p.id} pedido={p} onEmitirNF={setSefazPedido} onVerNF={setNfViewerPedido} />)}
              </div>
            )}
          </>
        )}
        {activeTab === "devolucoes" && (
          <Suspense fallback={null}><DevolucaoTrocaPanelLazy key={devolucoesKey} modoTeste={modoTeste} /></Suspense>
        )}
        {activeTab === "fornecedores" && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <button type="button" onClick={() => setComprasSubView("fornecedores")}
                className={cn("flex-1 h-9 rounded-xl text-[12px] font-semibold border transition-all flex items-center justify-center gap-1.5",
                  comprasSubView === "fornecedores"
                    ? "bg-violet-600 text-white border-violet-600"
                    : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/50")}>
                <Building2 size={14} />Fornecedores
              </button>
              <button type="button" onClick={() => setComprasSubView("pedidos")}
                className={cn("flex-1 h-9 rounded-xl text-[12px] font-semibold border transition-all flex items-center justify-center gap-1.5",
                  comprasSubView === "pedidos"
                    ? "bg-violet-600 text-white border-violet-600"
                    : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/50")}>
                <ShoppingCart size={14} />Pedidos de Compra
              </button>
            </div>
            <Suspense fallback={null}>
              {comprasSubView === "fornecedores" ? <FornecedoresPanel/> : <PedidosCompraPanel/>}
            </Suspense>
          </div>
        )}
        {activeTab === "lancamentos" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-violet-500/10 flex items-center justify-center shrink-0">
                <Zap size={20} className="text-violet-600" />
              </div>
              <div>
                <h2 className="text-base font-bold">Lançamentos</h2>
                <p className="text-[12px] text-muted-foreground">Compras de produção, compras da empresa e custos operacionais</p>
              </div>
            </div>
            <div className="flex gap-2">
              {[
                { tipo: "compra_producao" as const,   label: "Produção",    Icon: Factory   },
                { tipo: "compra_empresa" as const,    label: "Empresa",     Icon: Building2 },
                { tipo: "custo_operacional" as const, label: "Custos",      Icon: Zap       },
              ].map(({ tipo, label, Icon }) => (
                <button key={tipo} type="button" onClick={() => setLancTipo(tipo)}
                  className={cn("flex-1 h-9 rounded-xl text-[12px] font-semibold border transition-all flex items-center justify-center gap-1.5",
                    lancTipo === tipo
                      ? "bg-violet-600 text-white border-violet-600"
                      : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/50")}>
                  <Icon size={14} />{label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { tipo: "compra_producao",   label: "Produção",    color: "#7c3aed" },
                { tipo: "compra_empresa",    label: "Empresa",     color: "#0ea5e9" },
                { tipo: "custo_operacional", label: "Operacional", color: "#f97316" },
              ].map(({ tipo, label, color }) => {
                const t = lancamentos.filter(l => l.tipo === tipo).reduce((s, l) => s + l.valor, 0);
                return (
                  <div key={tipo} className="rounded-xl p-3 text-center"
                    style={{ background: `${color}0d`, border: `1px solid ${color}30` }}>
                    <p className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color }}>{label}</p>
                    <p className="text-[15px] font-black font-mono tabular-nums" style={{ color }}>{fmtCurrency(t)}</p>
                  </div>
                );
              })}
            </div>
            <Suspense fallback={null}><PainelLancamentos tipo={lancTipo} modoTeste={modoTeste} /></Suspense>
          </div>
        )}

        {activeTab === "bancos" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
                <Landmark size={20} className="text-emerald-600" />
              </div>
              <div>
                <h2 className="text-base font-bold">Bancos</h2>
                <p className="text-[12px] text-muted-foreground">Contas bancárias e webhooks de pagamento</p>
              </div>
            </div>
            <Suspense fallback={null}><PainelBancos /></Suspense>
          </div>
        )}
        {activeTab === "precos" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-violet-500/10 flex items-center justify-center shrink-0">
                  <Tag size={20} className="text-violet-600" />
                </div>
                <div>
                  <h2 className="text-base font-bold">Tabela de Preços</h2>
                  <p className="text-[12px] text-muted-foreground">Preços, custos, descontos máximos e NCM/CFOP por peça</p>
                </div>
              </div>
            </div>
            <Suspense fallback={null}><PainelTabelaPrecos modoTeste={modoTeste} /></Suspense>
          </div>
        )}
        {activeTab === "fluxo" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
                <TrendingUp size={20} className="text-emerald-600" />
              </div>
              <div>
                <h2 className="text-base font-bold">Contas & Fluxo de Caixa</h2>
                <p className="text-[12px] text-muted-foreground">Contas a pagar e a receber, aging de inadimplência e projeção</p>
              </div>
            </div>
            <FluxoCaixaPanelLazy />
          </div>
        )}
      </div>
      </main>

      <Suspense fallback={null}>
        <SefazModal
          pedido={sefazPedido}
          onClose={() => setSefazPedido(null)}
          onSuccess={loadPedidos}
          modoTeste={modoTeste}
        />
      </Suspense>
      <NFViewerModal
        pedido={nfViewerPedido}
        onClose={() => setNfViewerPedido(null)}
      />
      <HistoricoModal open={historicoOpen} onClose={() => setHistoricoOpen(false)} />
    </div>
  );
}
