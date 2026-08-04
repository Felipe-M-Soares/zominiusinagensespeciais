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

const FornecedoresPanel  = lazy(() => import("@/components/compras/FornecedoresPanel").then(m => ({ default: m.FornecedoresPanel })));
const PedidosCompraPanel = lazy(() => import("@/components/compras/PedidosCompraPanel").then(m => ({ default: m.PedidosCompraPanel })));
const FluxoCaixaPanelLazy = lazy(() => import("@/components/financeiro/FluxoCaixaPanel").then(m => ({ default: m.FluxoCaixaPanel })));
const DevolucaoTrocaPanelLazy = lazy(() => import("@/components/financeiro/DevolucaoTrocaPanel").then(m => ({ default: m.DevolucaoTrocaPanel })));
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

interface Pedido {
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

interface ItemFiscal {
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

interface DadosFiscais {
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

interface SefazResult {
  sucesso: boolean;
  chaveAcesso?: string;
  protocolo?: string;
  dhAutorizacao?: string;
  cStat?: string;
  xMotivo?: string;
  erro?: string;
  xmlAssinado?: string;
}

type CategoriaCompra =
  | "maquina" | "materia_prima" | "equipamento" | "insumo_producao"
  | "computador" | "mobiliario" | "material_escritorio" | "ativo_empresa"
  | "energia" | "aluguel" | "servico" | "manutencao" | "outro";

interface LancamentoFinanceiro {
  id: string;
  tipo: "compra_producao" | "compra_empresa" | "custo_operacional";
  categoria: CategoriaCompra;
  descricao: string;
  fornecedor: string | null;
  valor: number;
  data_lancamento: string;
  nota_fiscal_manual: string | null;
  chave_nfe: string | null;
  status_nf: "sem_nf" | "manual" | "autorizada" | "pendente";
  observacoes: string | null;
  recorrente: boolean;
  periodicidade: "mensal" | "bimestral" | "trimestral" | "anual" | null;
  created_at: string;
  created_by: string | null;
}

interface ContaBancaria {
  id: string;
  banco: string;
  agencia: string;
  conta: string;
  tipo: "corrente" | "poupanca" | "pagamentos";
  saldo_atual: number;
  webhook_url: string | null;
  integracao_ativa: boolean;
  // FIX: token_api (plain text) substituído por referência ao Vault — o
  // valor real nunca trafega num SELECT * normal, só via RPC dedicada.
  token_api_secret_id: string | null;
  envio_automatico_nf: boolean;
  created_at: string;
}

// ─── Constantes ──────────────────────────────────────────────────────────────

const TIPOS_PAGAMENTO = [
  { valor: "01", label: "Dinheiro",       icon: Banknote   },
  { valor: "03", label: "Cartão Crédito", icon: CreditCard },
  { valor: "04", label: "Cartão Débito",  icon: CreditCard },
  { valor: "17", label: "PIX",            icon: DollarSign },
  { valor: "15", label: "Boleto",         icon: Landmark   },
  { valor: "99", label: "Outros",         icon: DollarSign },
];

const STEP_LABELS = ["Tipo NF", "Destinatário", "Itens Fiscais", "Pagamento", "Revisar"];

const CATEGORIAS_PRODUCAO: { valor: CategoriaCompra; label: string; icon: typeof Package }[] = [
  { valor: "maquina",         label: "Máquina / Equip. Produção", icon: Factory      },
  { valor: "materia_prima",   label: "Matéria-Prima",             icon: FlaskConical },
  { valor: "insumo_producao", label: "Insumo de Produção",        icon: Cpu          },
  { valor: "manutencao",      label: "Manutenção",                icon: Wrench       },
];

const CATEGORIAS_EMPRESA: { valor: CategoriaCompra; label: string; icon: typeof Package }[] = [
  { valor: "computador",          label: "Computador / TI",        icon: Monitor   },
  { valor: "mobiliario",          label: "Mobiliário",             icon: Building  },
  { valor: "material_escritorio", label: "Material de Escritório", icon: FileText  },
  { valor: "ativo_empresa",       label: "Ativo Permanente",       icon: Building2 },
  { valor: "outro",               label: "Outros",                 icon: Package   },
];

const CATEGORIAS_CUSTO: { valor: CategoriaCompra; label: string; icon: typeof Package }[] = [
  { valor: "energia",    label: "Energia Elétrica",  icon: Zap        },
  { valor: "aluguel",    label: "Aluguel / Locação",  icon: Building   },
  { valor: "servico",    label: "Serviço / Software", icon: Monitor    },
  { valor: "manutencao", label: "Manutenção Geral",   icon: Wrench     },
  { valor: "outro",      label: "Outros Custos",      icon: DollarSign },
];

const BANCOS_BR = [
  "Bradesco", "Itaú", "Santander", "Banco do Brasil", "Caixa Econômica",
  "Nubank", "Inter", "C6 Bank", "BTG Pactual", "Sicoob", "Sicredi", "Outro",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtCurrency(v: number) {
  return formatBRL(v);
}

function statusLabel(s: string) {
  const m: Record<string, string> = {
    pendente: "Pendente", separando: "Separando", pronto: "Pronto",
    faturado: "Faturado", enviado: "Enviado", cancelado: "Cancelado",
  };
  return m[s] ?? s;
}

function mascararDoc(doc: string) {
  const n = doc.replace(/\D/g, "");
  if (n.length === 11) return n.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (n.length === 14) return n.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return doc;
}

function calcTotal(itens: ItemFiscal[], frete: number): number {
  return itens.reduce((a, i) => a + i.quantidade * (parseFloat(i.valorUnitario) || 0), 0) + frete;
}

function initDados(pedido: Pedido, numero: string): DadosFiscais {
  const desconto = pedido.desconto_pct ?? 0;
  return {
    tipoNota: "nfe",
    numero,
    serie: "1",
    naturezaOperacao: "VENDA DE MERCADORIA",
    destDocumento: pedido.cliente_documento ?? "",
    destNome:      pedido.cliente_nome ?? "",
    destEmail:     pedido.cliente_email ?? "",
    // Usa endereço de entrega do pedido (pode ter sido editado pelo estoque)
    destEndereco:  pedido.cliente_endereco ?? "",
    itens: pedido.itens.map(item => {
      // Desconto por peça é aplicado no momento da criação do pedido (vendedora define
      // o desconto individual de cada item). Por isso valor_unitario salvo no item já
      // vem líquido (com desconto) e tem prioridade.
      // Fallback (pedidos antigos sem valor_unitario salvo): preco_venda de tabela × desconto_pct do pedido.
      const temValorItemSalvo = (item.valor_unitario ?? 0) > 0;
      const precoFinal = temValorItemSalvo
        ? item.valor_unitario!
        : (() => {
            const precoBase = (item.preco_venda ?? 0) > 0 ? item.preco_venda! : 0;
            return desconto > 0 ? precoBase * (1 - desconto / 100) : precoBase;
          })();
      // Detecta se cliente é de outro estado (interestadual = CFOP 6xxx)
      const ufCliente = detectarUF(pedido.cliente_endereco);
      function adaptCFOP(c?: string | null) {
        return adaptarCFOP(c, ufCliente);
      }

      return {
        pedido_item_id: item.id,
        descricao:      item.device_model ?? "Produto",
        ncm:            item.ncm ?? "90213990",
        cfop:           adaptCFOP(item.cfop_padrao ?? item.cfop),
        unidade: "UN",
        quantidade:     item.quantidade,
        valorUnitario:  precoFinal.toFixed(2),
        aliqICMS: "12.00",
        ipi_pct: (item.ipi_pct ?? 0).toFixed(2),
        cst: "00",
      };
    }),
    tipoPagamento: (() => {
      const m: Record<string, string> = {
        dinheiro: "01", pix: "17", boleto: "15",
        cartao_debito: "04", cartao_credito: "03",
      };
      return m[pedido.forma_pagamento ?? ""] ?? "01";
    })(),
    valorTotal:    "0.00",
    modFrete:      "9",
    valorFrete:    (pedido.frete ?? 0).toFixed(2),
    informacoesAdicionais: [
      pedido.observacoes,
      desconto > 0 ? `Desconto de ${desconto}% aplicado individualmente em cada peça.` : "",
      pedido.parcelas && pedido.parcelas > 1 ? `Parcelado em ${pedido.parcelas}x.` : "",
    ].filter(Boolean).join(" | "),
  };
}

// ─── StepBar ─────────────────────────────────────────────────────────────────

function StepBar({ step, total, labels }: { step: number; total: number; labels: string[] }) {
  return (
    <div className="flex items-center gap-0.5 w-full">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className="flex items-center flex-1 last:flex-none">
          <div className={cn(
            "h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold border shrink-0 transition-all duration-200",
            i + 1 < step  ? "bg-violet-600 border-violet-600 text-white" :
            i + 1 === step ? "bg-violet-500/15 border-violet-500 text-violet-600" :
                             "bg-muted/30 border-border/40 text-muted-foreground"
          )}>
            {i + 1 < step ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span>{i + 1}</span>}
          </div>
          <span className={cn("text-[9px] ml-1 font-medium hidden sm:block shrink-0",
            i + 1 === step ? "text-violet-600" : "text-muted-foreground/60")}>
            {labels[i]}
          </span>
          {i < total - 1 && (
            <div className={cn("h-px flex-1 mx-1.5 transition-colors duration-300",
              i + 1 < step ? "bg-violet-500" : "bg-border/40")} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── TestBadge ───────────────────────────────────────────────────────────────

function TestBadge({ modoTeste }: { modoTeste: boolean }) {
  if (!modoTeste) return null; // Produção é o padrão — não precisa de badge
  return (
    <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-orange-500/40 bg-orange-500/8 text-orange-500 leading-none shrink-0 whitespace-nowrap">
      Homo
    </span>
  );
}


// ─── Helper: notifica vendedora + todos os admins sobre pedido enviado ──────────
async function notificarPedidoEnviado(
  pedido: Pedido,
  nfLabel: string,
  protocolo: string
): Promise<void> {
  try {
    const { data: admins } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");

    const destinatarios = new Set<string>();
    if (pedido.vendedora_id) destinatarios.add(pedido.vendedora_id);
    for (const a of (admins ?? []) as { user_id: string }[]) destinatarios.add(a.user_id);

    const notifs = [...destinatarios].map(uid => ({
      user_id: uid,
      pedido_id: pedido.id,
      tipo: "pedido_enviado",
      titulo: "Pedido faturado e enviado! 🚚",
      mensagem: `${pedido.cliente_nome} — ${nfLabel}${protocolo ? ` — Prot. ${protocolo}` : ""}`,
    }));
    if (notifs.length > 0) {
      await supabase.from("notificacoes").insert(notifs);
    }
  } catch (_e) {
    // Falha silenciosa — NF já emitida, não bloqueia o fluxo
  }
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

// ─── SefazModal ──────────────────────────────────────────────────────────────

function SefazModal({
  pedido, onClose, onSuccess, modoTeste,
}: { pedido: Pedido | null; onClose: () => void; onSuccess: () => void; modoTeste: boolean }) {
  const { user } = useAuth();
  const [step,       setStep]       = useState(1);
  const [saving,     setSaving]     = useState(false);
  const [lastResult, setLastResult] = useState<SefazResult | null>(null);
  const [dados,      setDados]      = useState<DadosFiscais | null>(null);
  const [loadingNum, setLoadingNum] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    if (pedido) {
      setStep(1); setLastResult(null); setLoadingNum(true);
      supabase.rpc("peek_next_nf_number", { p_serie: "1", p_tipo: "nfe" })
        .then(({ data, error }) => {
          const num = error ? "" : String(data ?? "").padStart(9, "0");
          setDados(initDados(pedido, num));
          setLoadingNum(false);
        });
    } else { setDados(null); }
  }, [pedido]);

  useEffect(() => {
    if (!dados) return;
    const total = calcTotal(dados.itens, parseFloat(dados.valorFrete) || 0);
    setDados(prev => prev ? { ...prev, valorTotal: total.toFixed(2) } : prev);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dados?.itens, dados?.valorFrete]);

  if (!pedido || !dados) return null;

  function upd<K extends keyof DadosFiscais>(k: K, v: DadosFiscais[K]) {
    setDados(prev => prev ? { ...prev, [k]: v } : prev);
  }
  function updItem(idx: number, k: keyof ItemFiscal, v: string | number) {
    setDados(prev => {
      if (!prev) return prev;
      const itens = prev.itens.map((it, i) => i === idx ? { ...it, [k]: v } : it);
      return { ...prev, itens };
    });
  }

  function canAdvance(): boolean {
    if (!dados) return false;
    if (step === 1) return dados.numero.trim().length > 0 && dados.naturezaOperacao.trim().length > 0;
    if (step === 2) return dados.destNome.trim().length > 0;
    if (step === 3) return dados.itens.every(it =>
      it.ncm.replace(/\D/g,"").length >= 8 &&
      it.cfop.replace(/\D/g,"").length >= 4 &&
      parseFloat(it.valorUnitario) > 0);
    if (step === 4) return !!dados.tipoPagamento;
    return true;
  }

  async function handleEmitir() {
    if (!pedido || !user || !dados) return;
    if (submitting.current) return;
    submitting.current = true; setSaving(true); setLastResult(null);
    try {
      if (modoTeste) {
        await new Promise(r => setTimeout(r, 1800));
        const fake: SefazResult = {
          sucesso: true,
          chaveAcesso: ("35" + Date.now() + "0".repeat(40)).slice(0, 44),
          protocolo: "141" + Date.now(),
          dhAutorizacao: new Date().toISOString(),
          cStat: "100", xMotivo: "Autorizado o uso da NF-e",
        };
        setLastResult(fake);
        const nfLabel = `${dados.tipoNota.toUpperCase()}-${dados.numero.padStart(9, "0")}`;
        await supabase.rpc("faturar_pedido_sefaz", {
          p_pedido_id: pedido.id, p_nf: nfLabel,
          p_chave_acesso: fake.chaveAcesso ?? "", p_protocolo: fake.protocolo ?? "",
          p_dh_autorizacao: fake.dhAutorizacao ?? new Date().toISOString(),
          p_user_id: user.id, p_user_name: "Financeiro",
        });
        await supabase.from("pedidos_comerciais").update({ status: "enviado" }).eq("id", pedido.id);
        // Notifica vendedora + admins mesmo no modo teste
        await notificarPedidoEnviado(pedido, nfLabel, fake.protocolo ?? "");
        toast.success(`[TESTE] NF-e simulada! Protocolo ${fake.protocolo}`, { duration: 5000 });
        onClose(); onSuccess(); return;
      }
      const { data, error } = await supabase.functions.invoke("sefaz-emitir", {
        body: { pedidoId: pedido.id, dadosFiscais: dados, modoTeste },
      });
      if (error) throw new Error(error.message);
      const result = data as SefazResult;
      setLastResult(result);
      if (!result.sucesso) {
        toast.error(result.xMotivo
          ? `SEFAZ cStat ${result.cStat}: ${result.xMotivo}`
          : result.erro ?? "Nota rejeitada pelo SEFAZ", { duration: 8000 });
        return;
      }
      const nfLabel = `${dados.tipoNota.toUpperCase()}-${dados.numero.padStart(9,"0")}`;
      const { data: rpc, error: rpcErr } = await supabase.rpc("faturar_pedido_sefaz", {
        p_pedido_id: pedido.id, p_nf: nfLabel,
        p_chave_acesso: result.chaveAcesso ?? "", p_protocolo: result.protocolo ?? "",
        p_dh_autorizacao: result.dhAutorizacao ?? new Date().toISOString(),
        p_user_id: user.id, p_user_name: "Financeiro",
        p_xml_nfe: result.xmlAssinado ?? null,
      });
      if (rpcErr) { toast.error(`NF autorizada, mas erro ao salvar: ${rpcErr.message}`); return; }
      const rpcData = rpc as { error?: string } | null;
      if (rpcData?.error) { toast.error(`Erro: ${rpcData.error}`); return; }
      await supabase.from("pedidos_comerciais").update({ status: "enviado" }).eq("id", pedido.id);
      // Notifica vendedora + admins
      await notificarPedidoEnviado(pedido, nfLabel, result.protocolo ?? "");
      toast.success(`✅ ${dados.tipoNota.toUpperCase()} autorizada! Protocolo ${result.protocolo}`, { duration: 6000 });
      onClose(); onSuccess();
    } catch (err) {
      toast.error(`Erro ao emitir NF: ${friendlyError(err)}`);
      logger.error("SefazModal:", err);
    } finally { submitting.current = false; setSaving(false); }
  }

  const totalItens = pedido.itens.reduce((s, i) => s + i.quantidade, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-t-2xl sm:rounded-2xl bg-card border border-border/40 shadow-2xl overflow-hidden flex flex-col max-h-[94vh] sm:max-h-[92vh] animate-in fade-in slide-in-from-bottom-4 duration-200">
        <div className="px-5 pt-5 pb-3 border-b border-border/20 shrink-0 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-violet-500/15 flex items-center justify-center">
                <FileCheck2 className="h-4 w-4 text-violet-500" />
              </div>
              <span className="text-sm font-semibold">
                Emissão {dados.tipoNota === "nfce" ? "NFC-e" : "NF-e"} — SEFAZ
              </span>
              <TestBadge modoTeste={modoTeste} />
            </div>
            <button type="button" onClick={onClose} disabled={saving}
              className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground disabled:opacity-40">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-border/30 bg-muted/15 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold truncate">{pedido.cliente_nome}</p>
              <p className="text-[10px] text-muted-foreground">{totalItens} un. · Frete R$ {pedido.frete.toFixed(2)}</p>
            </div>
            <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border",
              pedido.status === "pronto"   ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" :
              pedido.status === "enviado" ? "bg-sky-500/10 text-sky-600 border-sky-500/20" :
              "bg-muted/30 text-muted-foreground border-border/30")}>
              {statusLabel(pedido.status)}
            </span>
          </div>
          <StepBar step={step} total={5} labels={STEP_LABELS} />
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* STEP 1 */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tipo e Identificação</p>
              <div className="grid grid-cols-2 gap-2">
                {(["nfe", "nfce"] as const).map(tipo => (
                  <button key={tipo} type="button" onClick={() => upd("tipoNota", tipo)}
                    className={cn("rounded-xl border p-3 text-left transition-all",
                      dados.tipoNota === tipo
                        ? "border-violet-500/50 bg-violet-500/10 ring-1 ring-violet-500/30"
                        : "border-border/40 bg-muted/15 hover:bg-muted/35")}>
                    <p className="text-[13px] font-bold">{tipo === "nfe" ? "NF-e" : "NFC-e"}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {tipo === "nfe" ? "Modelo 55 · B2B" : "Modelo 65 · Consumidor"}
                    </p>
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2 space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                    Número da NF * {loadingNum && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                  </label>
                  <div className="relative">
                    <Hash className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                    <input autoFocus type="text" inputMode="numeric"
                      value={dados.numero}
                      onChange={e => upd("numero", e.target.value.replace(/\D/g,"").slice(0,9))}
                      placeholder="000000001"
                      className="w-full h-9 rounded-xl border border-border/50 bg-background text-foreground pl-7 pr-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50"
                    />
                  </div>
                  <p className="text-[9px] text-muted-foreground/60 pl-1">Preenchido automaticamente (sequencial)</p>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Série</label>
                  <input type="text" inputMode="numeric"
                    value={dados.serie}
                    onChange={e => upd("serie", e.target.value.replace(/\D/g,"").slice(0,3))}
                    placeholder="1"
                    className="w-full h-9 rounded-xl border border-border/50 bg-background text-foreground px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Natureza da Operação *</label>
                <input type="text"
                  value={dados.naturezaOperacao}
                  onChange={e => upd("naturezaOperacao", e.target.value.slice(0,60).toUpperCase())}
                  placeholder="VENDA DE MERCADORIA"
                  className="w-full h-9 rounded-xl border border-border/50 bg-background text-foreground px-3 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                />
              </div>
              <div className={cn("rounded-xl border p-3 flex items-start gap-2",
                modoTeste ? "border-orange-500/20 bg-orange-500/5" : "border-green-500/20 bg-green-500/5")}>
                {modoTeste
                  ? <AlertTriangle className="h-3.5 w-3.5 text-orange-500 shrink-0 mt-0.5" />
                  : <CheckSquare className="h-3.5 w-3.5 text-green-600 shrink-0 mt-0.5" />}
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  {modoTeste
                    ? <><strong>Homologação</strong>: nota simulada sem valor fiscal. Altere em <strong>Bancos &amp; Integração</strong>.</>
                    : <><strong>Produção</strong>: esta nota terá valor fiscal real e será transmitida ao SEFAZ.</>}
                </p>
              </div>
            </div>
          )}

          {/* STEP 2 */}
          {step === 2 && (
            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Dados do Destinatário</p>

              {/* Endereço de entrega do pedido */}
              {pedido.cliente_endereco && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-blue-500/8 border border-blue-500/20">
                  <MapPin className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">Endereço de entrega do pedido</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 break-words">{pedido.cliente_endereco}</p>
                  </div>
                </div>
              )}

              {[
                { key: "destNome" as const,      label: "Nome / Razão Social *", icon: Building2, placeholder: "RAZÃO SOCIAL", upper: true  },
                { key: "destDocumento" as const, label: "CPF / CNPJ",            icon: Hash,      placeholder: "000.000.000-00", upper: false },
                { key: "destEmail" as const,     label: "E-mail",                icon: Mail,      placeholder: "cliente@email.com", upper: false },
                { key: "destEndereco" as const,  label: "Endereço de Entrega",    icon: MapPin,    placeholder: "Rua, nº, bairro, cidade — UF", upper: false },
              ].map(f => (
                <div key={f.key} className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                    <f.icon className="h-2.5 w-2.5" />{f.label}
                  </label>
                  <input type="text"
                    value={dados[f.key] as string}
                    onChange={e => upd(f.key, f.upper ? e.target.value.toUpperCase().slice(0,60) : e.target.value.slice(0,60))}
                    placeholder={f.placeholder}
                    className="w-full h-9 rounded-xl border border-border/50 bg-background text-foreground px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                  />
                  {f.key === "destDocumento" && dados.destDocumento.length > 0 && (
                    <p className="text-[10px] text-muted-foreground pl-1">{mascararDoc(dados.destDocumento)}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* STEP 3 */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Dados Fiscais por Item ({dados.itens.length})
              </p>
              {(pedido?.desconto_pct ?? 0) > 0 && (
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-emerald-500/8 border border-emerald-500/25">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                  <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                    Desconto de <strong>{pedido!.desconto_pct}%</strong> já aplicado automaticamente em cada peça
                  </p>
                </div>
              )}
              {dados.itens.map((item, idx) => {
                const vOrig  = parseFloat(item.valorUnitario) || 0;
                const ncmOk  = item.ncm.replace(/\D/g,"").length >= 8;
                const cfopOk = item.cfop.replace(/\D/g,"").length >= 4;
                const vlrOk  = vOrig > 0;
                return (
                  <div key={item.pedido_item_id}
                    className={cn("rounded-xl border p-3 space-y-2.5",
                      ncmOk && cfopOk && vlrOk ? "border-border/30 bg-muted/10" : "border-amber-500/30 bg-amber-500/10")}>
                    <div className="flex items-center gap-2">
                      <div className="h-6 w-6 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                        <Package className="h-3 w-3 text-violet-500" />
                      </div>
                      <p className="text-[11px] font-semibold truncate flex-1">{item.descricao}</p>
                      <span className="text-[10px] text-muted-foreground shrink-0">{item.quantidade} un.</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide">NCM (8 díg.) *</label>
                        <input type="text" inputMode="numeric"
                          value={item.ncm}
                          onChange={e => updItem(idx, "ncm", e.target.value.replace(/\D/g,"").slice(0, 8))}
                          placeholder="90213990"
                          className={cn("w-full h-8 rounded-lg border bg-background text-foreground px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-violet-500/40",
                            ncmOk ? "border-border/50" : "border-amber-500/60 bg-amber-500/10")}
                        />
                        <button type="button"
                          onClick={async () => {
                            const sug = await sugerirNcmParaPeca(item.pedido_item_id, item.descricao, "");
                            if (sug) { updItem(idx, "ncm", sug.ncm); updItem(idx, "ipi_pct", String(sug.ipi)); toast.success(`NCM ${sug.ncm} — ${sug.desc}`); }
                            else toast.info("Não foi possível sugerir NCM. Preencha manualmente.");
                          }}
                          className="w-full h-6 rounded-lg bg-violet-500/10 hover:bg-violet-500/20 text-violet-600 text-[9px] font-semibold transition-colors flex items-center justify-center gap-1">
                          <Zap size={9} />Sugerir NCM
                        </button>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide">CFOP (4 díg.) *</label>
                        <input type="text" inputMode="numeric"
                          value={item.cfop}
                          onChange={e => updItem(idx, "cfop", e.target.value.replace(/\D/g,"").slice(0, 4))}
                          placeholder="5102"
                          className={cn("w-full h-8 rounded-lg border bg-background text-foreground px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-violet-500/40",
                            cfopOk ? "border-border/50" : "border-amber-500/60 bg-amber-500/10")}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <label className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide">Vlr. Unit. *</label>
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground">R$</span>
                          <input type="number" min="0" step="0.01"
                            value={item.valorUnitario}
                            onChange={e => updItem(idx, "valorUnitario", e.target.value)}
                            className={cn("w-full h-8 rounded-lg border bg-background text-foreground pl-5 pr-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-violet-500/40",
                              vlrOk ? "border-border/50" : "border-amber-500/60 bg-amber-500/10")}
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide">ICMS %</label>
                        <input type="number" min="0" max="100" step="0.01"
                          value={item.aliqICMS}
                          onChange={e => updItem(idx, "ipi_pct", e.target.value)}
                          className="w-full h-8 rounded-lg border border-border/50 bg-background text-foreground px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide">CST</label>
                        <select value={item.cst} onChange={e => updItem(idx, "cst", e.target.value)}
                          className="w-full h-8 rounded-lg border border-border/50 bg-background text-foreground px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-500/40">
                          <option value="00">00 — Tributado</option>
                          <option value="20">20 — Red. BC</option>
                          <option value="40">40 — Isento</option>
                          <option value="41">41 — Não trib.</option>
                          <option value="60">60 — ICMS-ST</option>
                        </select>
                      </div>
                    </div>
                    {vOrig > 0 && (
                      <div className="text-right text-[10px] font-mono font-semibold text-violet-500">
                        = R$ {(item.quantidade * vOrig).toFixed(2)}
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="flex items-center justify-between rounded-xl border border-border/30 bg-background text-foreground/60 px-3 py-2">
                <span className="text-[11px] text-muted-foreground">Frete (R$)</span>
                <input type="number" min="0" step="0.01"
                  value={dados.valorFrete} onChange={e => upd("valorFrete", e.target.value)}
                  className="w-24 h-7 rounded-lg border border-border/50 bg-background text-foreground px-2 text-xs font-mono text-right focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-violet-500/25 bg-violet-500/8 px-3 py-2.5">
                <span className="text-[13px] font-semibold">Total NF</span>
                <span className="text-[15px] font-bold text-violet-600 font-mono">R$ {dados.valorTotal}</span>
              </div>
            </div>
          )}

          {/* STEP 4 — somente leitura, dados vêm do pedido */}
          {step === 4 && (
            <div className="space-y-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pagamento e Transporte</p>

              {/* Forma de pagamento — somente leitura */}
              <div className="space-y-2">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Forma de Pagamento</label>
                <div className="grid grid-cols-2 gap-2">
                  {TIPOS_PAGAMENTO.map(tp => {
                    const Icon = tp.icon;
                    const ativo = dados.tipoPagamento === tp.valor;
                    return (
                      <div key={tp.valor}
                        className={cn("flex items-center gap-2 px-3 py-2.5 rounded-xl border",
                          ativo
                            ? "border-violet-500/50 bg-violet-500/10 ring-1 ring-violet-500/20"
                            : "border-border/20 bg-muted/5 opacity-40")}>
                        <Icon className={cn("h-3.5 w-3.5 shrink-0", ativo ? "text-violet-500" : "text-muted-foreground")} />
                        <span className={cn("text-[11px] font-medium", ativo ? "text-foreground" : "text-muted-foreground")}>{tp.label}</span>
                        {ativo && <CheckCircle2 className="h-3 w-3 text-violet-500 ml-auto shrink-0" />}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Frete — somente leitura */}
              <div className="space-y-2">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Frete</label>
                <div className="flex items-center justify-between rounded-xl border border-border/30 bg-muted/10 px-4 py-3">
                  <span className="text-[12px] text-muted-foreground">Valor do Frete</span>
                  <span className="text-[14px] font-bold font-mono">
                    {parseFloat(dados.valorFrete) > 0
                      ? `R$ ${parseFloat(dados.valorFrete).toFixed(2).replace(".", ",")}`
                      : <span className="text-muted-foreground font-normal text-[12px]">Sem frete</span>}
                  </span>
                </div>
              </div>

              {/* Parcelas — se houver */}
              {(pedido?.parcelas ?? 1) > 1 && (
                <div className="flex items-center justify-between rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3">
                  <span className="text-[12px] text-muted-foreground">Parcelamento</span>
                  <span className="text-[13px] font-bold text-violet-600">{pedido!.parcelas}x sem juros</span>
                </div>
              )}

              {/* Informações adicionais — ainda editável */}
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Informações Adicionais</label>
                <textarea
                  value={dados.informacoesAdicionais}
                  onChange={e => upd("informacoesAdicionais", e.target.value.slice(0,500))}
                  placeholder="Observações adicionais para a NF..."
                  rows={3}
                  className="w-full rounded-xl border border-border/50 bg-background text-foreground px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500/30 resize-none"
                />
                <p className="text-[9px] text-muted-foreground text-right">{dados.informacoesAdicionais.length}/500</p>
              </div>
            </div>
          )}

          {/* STEP 5 */}
          {step === 5 && (
            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Revisão — confirme antes de emitir</p>
              <div className="rounded-xl border border-border/30 bg-muted/10 p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-bold">
                    {dados.tipoNota === "nfe" ? "NF-e" : "NFC-e"} — Série {dados.serie} — Nº {dados.numero.padStart(9,"0")}
                  </span>
                  <TestBadge modoTeste={modoTeste} />
                </div>
                <p className="text-[10px] text-muted-foreground">{dados.naturezaOperacao}</p>
              </div>
              <div className="rounded-xl border border-border/30 bg-muted/10 p-3 space-y-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Destinatário</p>
                <p className="text-[13px] font-semibold">{dados.destNome}</p>
                {dados.destDocumento && <p className="text-[10px] text-muted-foreground font-mono">{mascararDoc(dados.destDocumento)}</p>}
                {dados.destEndereco && (
                  <p className="text-[11px] text-muted-foreground flex items-start gap-1 mt-1">
                    <MapPin className="h-3 w-3 shrink-0 mt-0.5 text-muted-foreground/60" />
                    {dados.destEndereco}
                  </p>
                )}
              </div>

              {/* Resumo financeiro */}
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3 space-y-1.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Resumo Financeiro</p>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">Forma de pagamento</span>
                  <span className="font-semibold">{TIPOS_PAGAMENTO.find(t => t.valor === dados.tipoPagamento)?.label ?? dados.tipoPagamento}</span>
                </div>
                {(pedido?.desconto_pct ?? 0) > 0 && (
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">Desconto aplicado</span>
                    <span className="font-semibold text-emerald-600">{pedido!.desconto_pct}% por peça</span>
                  </div>
                )}
                {(pedido?.parcelas ?? 1) > 1 && (
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">Parcelamento</span>
                    <span className="font-semibold">{pedido!.parcelas}x sem juros</span>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-border/30 bg-muted/10 p-3 space-y-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Itens ({dados.itens.length})</p>
                {dados.itens.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between text-[11px]">
                    <span className="truncate flex-1 mr-2">{item.descricao}</span>
                    <span className="font-mono text-muted-foreground shrink-0">
                      {item.quantidade}× R$ {parseFloat(item.valorUnitario).toFixed(2)}
                    </span>
                  </div>
                ))}
                <div className="border-t border-border/30 pt-1 flex items-center justify-between">
                  <span className="text-[13px] font-bold">Total</span>
                  <span className="text-[15px] font-bold text-violet-600 font-mono">R$ {dados.valorTotal}</span>
                </div>
              </div>
              {lastResult && !lastResult.sucesso && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 flex items-start gap-2">
                  <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] font-semibold text-destructive">SEFAZ rejeitou — cStat {lastResult.cStat}</p>
                    <p className="text-[10px] text-muted-foreground">{lastResult.xMotivo}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 pb-5 pt-3 border-t border-border/20 shrink-0">
          <div className="flex items-center gap-2">
            {step > 1 && (
              <button type="button" onClick={() => setStep(s => s - 1)} disabled={saving}
                className="h-10 px-4 rounded-xl border border-border/50 text-sm font-medium text-muted-foreground hover:bg-muted/40 disabled:opacity-40">
                Voltar
              </button>
            )}
            {step < 5 ? (
              <button type="button" onClick={() => setStep(s => s + 1)} disabled={!canAdvance()}
                className="flex-1 h-10 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-35 flex items-center justify-center gap-1.5">
                Próximo <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button type="button" onClick={handleEmitir} disabled={saving}
                className="flex-1 h-10 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
                {saving
                  ? <><Loader2 className="h-4 w-4 animate-spin" />Enviando…</>
                  : <><FileCheck2 className="h-4 w-4" />{modoTeste ? "[TESTE] Simular Emissão" : `Emitir ${dados.tipoNota === "nfce" ? "NFC-e" : "NF-e"}`}</>}
              </button>
            )}
          </div>
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

// ─── LancamentoModal ─────────────────────────────────────────────────────────

interface LancModalProps {
  open: boolean; tipo: LancamentoFinanceiro["tipo"];
  onClose: () => void; onSuccess: () => void;
  inicial?: LancamentoFinanceiro | null; modoTeste: boolean;
}

function LancamentoModal({ open, tipo, onClose, onSuccess, inicial, modoTeste }: LancModalProps) {
  const { user } = useAuth();
  const categorias = tipo === "compra_producao" ? CATEGORIAS_PRODUCAO
                   : tipo === "compra_empresa"  ? CATEGORIAS_EMPRESA
                   :                              CATEGORIAS_CUSTO;

  const [categoria,     setCategoria]     = useState<CategoriaCompra>(categorias[0].valor);
  const [descricao,     setDescricao]     = useState("");
  const [fornecedor,    setFornecedor]    = useState("");
  const [valor,         setValor]         = useState("");
  const [data,          setData]          = useState(new Date().toISOString().slice(0, 10));
  const [nfManual,      setNfManual]      = useState("");
  const [chaveNfe,      setChaveNfe]      = useState("");
  const [statusNf,      setStatusNf]      = useState<LancamentoFinanceiro["status_nf"]>("sem_nf");
  const [obs,           setObs]           = useState("");
  const [recorrente,    setRecorrente]    = useState(false);
  const [periodicidade, setPeriodicidade] = useState<NonNullable<LancamentoFinanceiro["periodicidade"]>>("mensal");
  const [saving,        setSaving]        = useState(false);

  useEffect(() => {
    if (!open) return;
    if (inicial) {
      setCategoria(inicial.categoria); setDescricao(inicial.descricao);
      setFornecedor(inicial.fornecedor ?? ""); setValor(inicial.valor.toFixed(2));
      setData(inicial.data_lancamento.slice(0,10)); setNfManual(inicial.nota_fiscal_manual ?? "");
      setChaveNfe(inicial.chave_nfe ?? ""); setStatusNf(inicial.status_nf);
      setObs(inicial.observacoes ?? ""); setRecorrente(inicial.recorrente);
      setPeriodicidade(inicial.periodicidade ?? "mensal");
    } else {
      setCategoria(categorias[0].valor); setDescricao(""); setFornecedor(""); setValor("");
      setData(new Date().toISOString().slice(0,10)); setNfManual(""); setChaveNfe("");
      setStatusNf("sem_nf"); setObs(""); setRecorrente(false); setPeriodicidade("mensal");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, inicial]);

  if (!open) return null;

  async function handleSave() {
    if (!descricao.trim()) { toast.error("Descrição obrigatória"); return; }
    if (!valor || parseFloat(valor) <= 0) { toast.error("Informe o valor"); return; }
    setSaving(true);
    const payload = {
      tipo, categoria, descricao: descricao.trim(),
      fornecedor: fornecedor.trim() || null,
      valor: parseFloat(valor), data_lancamento: data,
      nota_fiscal_manual: nfManual.trim() || null,
      chave_nfe: chaveNfe.trim() || null,
      status_nf: statusNf, observacoes: obs.trim() || null,
      recorrente, periodicidade: recorrente ? periodicidade : null,
      created_by: user?.id ?? null, modo_teste: modoTeste,
    };
    try {
      let err;
      if (inicial) {
        ({ error: err } = await supabase.from("financeiro_lancamentos").update(payload).eq("id", inicial.id));
      } else {
        ({ error: err } = await supabase.from("financeiro_lancamentos").insert(payload));
      }
      if (err) throw err;
      toast.success(inicial ? "Lançamento atualizado!" : "Lançamento registrado!");
      onSuccess();
    } catch (e) {
      toast.error("Erro ao salvar lançamento.");
      logger.error("LancamentoModal:", e);
    } finally { setSaving(false); }
  }

  const tipoLabel = tipo === "compra_producao" ? "Compra — Produção"
                  : tipo === "compra_empresa"  ? "Compra — Empresa"
                  :                              "Custo Operacional";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-card border border-border/40 shadow-2xl overflow-hidden flex flex-col max-h-[94vh] sm:max-h-[92vh] animate-in fade-in slide-in-from-bottom-4 duration-200">
        <div className="px-5 pt-5 pb-3 border-b border-border/20 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-violet-500/15 flex items-center justify-center">
              <ShoppingCart className="h-4 w-4 text-violet-500" />
            </div>
            <span className="text-sm font-semibold">{inicial ? "Editar" : "Novo"} {tipoLabel}</span>
            <TestBadge modoTeste={modoTeste} />
          </div>
          <button type="button" onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          <div className="space-y-2">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Categoria *</label>
            <div className="grid grid-cols-2 gap-1.5">
              {categorias.map(cat => {
                const Icon = cat.icon;
                return (
                  <button key={cat.valor} type="button" onClick={() => setCategoria(cat.valor)}
                    className={cn("flex items-center gap-2 px-2.5 py-2 rounded-xl border text-left transition-all",
                      categoria === cat.valor
                        ? "border-violet-500/50 bg-violet-500/10"
                        : "border-border/30 bg-muted/10 hover:bg-muted/30")}>
                    <Icon className={cn("h-3.5 w-3.5 shrink-0", categoria === cat.valor ? "text-violet-500" : "text-muted-foreground")} />
                    <span className="text-[10px] font-medium leading-tight">{cat.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {[
            { label: "Descrição *", val: descricao, set: setDescricao, placeholder: "Ex: Compressor industrial, conta de luz..." },
            { label: "Fornecedor / Empresa", val: fornecedor, set: setFornecedor, placeholder: "Nome do fornecedor" },
          ].map(f => (
            <div key={f.label} className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{f.label}</label>
              <input type="text" value={f.val} onChange={e => f.set(e.target.value.slice(0,120))}
                placeholder={f.placeholder}
                className="w-full h-9 rounded-xl border border-border/50 bg-background text-foreground px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30"
              />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Valor (R$) *</label>
              <input type="number" min="0" step="0.01" value={valor} onChange={e => setValor(e.target.value)}
                placeholder="0,00"
                className="w-full h-9 rounded-xl border border-border/50 bg-background text-foreground px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <CalendarDays className="h-2.5 w-2.5" />Data
              </label>
              <input type="date" value={data} onChange={e => setData(e.target.value)}
                className="w-full h-9 rounded-xl border border-border/50 bg-background text-foreground px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Status da Nota Fiscal</label>
            <div className="flex gap-1.5">
              {(["sem_nf", "manual", "pendente"] as const).map(s => (
                <button key={s} type="button" onClick={() => setStatusNf(s)}
                  className={cn("flex-1 h-8 rounded-lg border text-[10px] font-medium transition-all",
                    statusNf === s
                      ? "border-violet-500/50 bg-violet-500/10 text-violet-600"
                      : "border-border/30 bg-muted/10 text-muted-foreground")}>
                  {s === "sem_nf" ? "Sem NF" : s === "manual" ? "Manual" : "Pendente"}
                </button>
              ))}
            </div>
            {statusNf === "manual" && (
              <div className="space-y-2">
                <input type="text" value={nfManual} onChange={e => setNfManual(e.target.value.slice(0,60))}
                  placeholder="Número da NF (ex: NF-0001)"
                  className="w-full h-8 rounded-xl border border-border/50 bg-background text-foreground px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                />
                <input type="text" value={chaveNfe} onChange={e => setChaveNfe(e.target.value.replace(/\D/g,"").slice(0,44))}
                  placeholder="Chave de acesso NF-e 44 dígitos (opcional)"
                  className="w-full h-8 rounded-xl border border-border/50 bg-background text-foreground px-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                />
              </div>
            )}
          </div>
          {tipo === "custo_operacional" && (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setRecorrente(v => !v)}
                  className={cn("h-5 w-9 rounded-full transition-colors relative shrink-0",
                    recorrente ? "bg-violet-500" : "bg-muted/50")}>
                  <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-background text-foreground shadow transition-all",
                    recorrente ? "left-[calc(100%-18px)]" : "left-0.5")} />
                </button>
                <span className="text-[11px] font-medium">Custo recorrente</span>
              </div>
              {recorrente && (
                <div className="grid grid-cols-4 gap-1.5">
                  {(["mensal", "bimestral", "trimestral", "anual"] as const).map(p => (
                    <button key={p} type="button" onClick={() => setPeriodicidade(p)}
                      className={cn("h-7 rounded-lg border text-[9px] font-medium transition-all",
                        periodicidade === p
                          ? "border-violet-500/50 bg-violet-500/10 text-violet-600"
                          : "border-border/30 bg-muted/10 text-muted-foreground")}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Observações</label>
            <textarea value={obs} onChange={e => setObs(e.target.value.slice(0,300))}
              placeholder="Informações adicionais..." rows={2}
              className="w-full rounded-xl border border-border/50 bg-background text-foreground px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/30"
            />
          </div>
        </div>
        <div className="px-5 pb-5 pt-3 border-t border-border/20 shrink-0 flex gap-2">
          <button type="button" onClick={onClose}
            className="h-10 px-4 rounded-xl border border-border/50 text-sm font-medium text-muted-foreground hover:bg-muted/40">
            Cancelar
          </button>
          <button type="button" onClick={handleSave} disabled={saving}
            className="flex-1 h-10 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {inicial ? "Salvar alterações" : "Registrar lançamento"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── PainelLancamentos ───────────────────────────────────────────────────────

function PainelLancamentos({ tipo, modoTeste }: { tipo: LancamentoFinanceiro["tipo"]; modoTeste: boolean }) {
  const [itens,      setItens]      = useState<LancamentoFinanceiro[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [modalOpen,  setModalOpen]  = useState(false);
  const [editItem,   setEditItem]   = useState<LancamentoFinanceiro | null>(null);
  const [delItem,    setDelItem]    = useState<LancamentoFinanceiro | null>(null);
  const [deleting,   setDeleting]   = useState(false);
  const [search,     setSearch]     = useState("");
  const [filtroNF,   setFiltroNF]   = useState<"todos" | LancamentoFinanceiro["status_nf"]>("todos");
  const [showRecorr, setShowRecorr] = useState(false);
  const [filtroDataInicio, setFiltroDataInicio] = useState("");
  const [filtroDataFim, setFiltroDataFim] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("financeiro_lancamentos")
      .select("*").eq("tipo", tipo).order("data_lancamento", { ascending: false });
    if (!error) setItens((data ?? []) as LancamentoFinanceiro[]);
    setLoading(false);
  }, [tipo]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete() {
    if (!delItem) return;
    setDeleting(true);
    const { error } = await supabase.from("financeiro_lancamentos").delete().eq("id", delItem.id);
    setDeleting(false);
    if (error) { toast.error("Erro ao excluir."); return; }
    toast.success("Lançamento excluído."); setDelItem(null); load();
  }

  const now = new Date();
  const mesAtualStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const totalMes    = useMemo(() => itens.filter(i => i.data_lancamento.startsWith(mesAtualStr)).reduce((s, i) => s + i.valor, 0), [itens, mesAtualStr]);
  const total       = itens.reduce((s, i) => s + i.valor, 0);
  const totalRecorr = itens.filter(i => i.recorrente).reduce((s, i) => s + i.valor, 0);
  const semNF       = itens.filter(i => i.status_nf === "sem_nf" || i.status_nf === "pendente").length;
  const allCats     = [...CATEGORIAS_PRODUCAO, ...CATEGORIAS_EMPRESA, ...CATEGORIAS_CUSTO];

  const itensFiltrados = useMemo(() => itens.filter(i => {
    const matchSearch = !search.trim() ||
      i.descricao.toLowerCase().includes(search.toLowerCase()) ||
      (i.fornecedor ?? "").toLowerCase().includes(search.toLowerCase());
    const matchNF     = filtroNF === "todos" || i.status_nf === filtroNF;
    const matchRecorr = !showRecorr || i.recorrente;
    const matchInicio = !filtroDataInicio || i.data_lancamento >= filtroDataInicio;
    const matchFim    = !filtroDataFim    || i.data_lancamento <= filtroDataFim;
    return matchSearch && matchNF && matchRecorr && matchInicio && matchFim;
  }), [itens, search, filtroNF, showRecorr, filtroDataInicio, filtroDataFim]);

  const nfColors: Record<LancamentoFinanceiro["status_nf"], { label: string; cls: string }> = {
    sem_nf:     { label: "Sem NF",        cls: "bg-muted/50 text-muted-foreground border-border/40" },
    manual:     { label: "NF Manual",     cls: "bg-violet-500/10 text-violet-600 border-violet-500/20" },
    pendente:   { label: "NF Pendente",   cls: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
    autorizada: { label: "NF Autorizada", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
  };

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Este Mês",    value: fmtCurrency(totalMes),   icon: CalendarDays,   color: "#f97316" },
          { label: "Total Geral", value: fmtCurrency(total),       icon: BarChart3,      color: "#7c3aed" },
          { label: "Recorrentes", value: fmtCurrency(totalRecorr), icon: Repeat2,        color: "#0ea5e9" },
          { label: "Sem NF",      value: String(semNF),            icon: AlertTriangle,  color: semNF > 0 ? "#d97706" : "#10b981" },
        ].map(k => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="rounded-xl p-3 flex items-center gap-3 bg-card border border-border/50 hover:border-border transition-colors">
              <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${k.color}15`, color: k.color }}>
                <Icon size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{k.label}</p>
                <p className="text-[14px] font-black truncate tabular-nums" style={{ color: k.color }}>{k.value}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={() => { setEditItem(null); setModalOpen(true); }}
          className="h-9 px-4 flex items-center gap-1.5 rounded-xl text-[12px] font-bold text-white transition-all hover:opacity-90 active:scale-95"
          style={{ background: "linear-gradient(135deg,#7c3aed,#6d28d9)", boxShadow: "0 2px 8px rgba(124,58,237,0.3)" }}>
          <PlusCircle size={14} />Novo lançamento
        </button>
        <SearchInputWithBarcode
          className="flex-1 min-w-[160px]"
          value={search}
          onChange={v => setSearch(v)}
          onSearch={v => setSearch(v)}
          placeholder="Buscar descrição, fornecedor ou bipe o código..."
          height="h-9"
          showSearchIcon
        />
        <select value={filtroNF} onChange={e => setFiltroNF(e.target.value as typeof filtroNF)}
          className="h-9 rounded-xl px-3 text-[12px] font-medium bg-muted/30 border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/30">
          <option value="todos">Todas NFs</option>
          <option value="sem_nf">Sem NF</option>
          <option value="manual">NF Manual</option>
          <option value="pendente">NF Pendente</option>
          <option value="autorizada">NF Autorizada</option>
        </select>
        <button type="button" onClick={() => setShowRecorr(v => !v)}
          className={cn("h-9 px-3 flex items-center gap-1.5 rounded-xl text-[11px] font-semibold border transition-all",
            showRecorr
              ? "bg-violet-500/15 border-violet-500/40 text-violet-600"
              : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/50")}>
          <Repeat2 size={13} />Recorrentes
        </button>
        <input type="date" value={filtroDataInicio} onChange={e => setFiltroDataInicio(e.target.value)}
          title="Data início"
          className="h-9 rounded-xl border border-border/50 bg-background text-foreground text-[11px] px-2 focus:outline-none focus:ring-2 focus:ring-violet-500/30" />
        <span className="text-[10px] text-muted-foreground">–</span>
        <input type="date" value={filtroDataFim} onChange={e => setFiltroDataFim(e.target.value)}
          title="Data fim"
          className="h-9 rounded-xl border border-border/50 bg-background text-foreground text-[11px] px-2 focus:outline-none focus:ring-2 focus:ring-violet-500/30" />
        {(filtroDataInicio || filtroDataFim) && (
          <button type="button" onClick={() => { setFiltroDataInicio(""); setFiltroDataFim(""); }}
            className="h-9 w-9 flex items-center justify-center rounded-xl hover:bg-muted/50 text-muted-foreground transition-colors" title="Limpar período">
            <X size={13} />
          </button>
        )}
        <button type="button" onClick={load} disabled={loading}
          className="h-9 w-9 flex items-center justify-center rounded-xl bg-muted/30 border border-border hover:bg-muted/50 transition-colors">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {!loading && itens.length > 0 && (
        <p className="text-[11px] text-muted-foreground/70">
          {itensFiltrados.length} de {itens.length} lançamentos{search && ` · "${search}"`}
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin h-6 w-6 border-2 border-violet-500 border-t-transparent rounded-full" />
        </div>
      ) : itensFiltrados.length === 0 ? (
        <div className="text-center py-14 space-y-3">
          <div className="h-16 w-16 rounded-2xl mx-auto flex items-center justify-center bg-muted/30">
            <ShoppingCart size={28} className="text-muted-foreground/40" />
          </div>
          <div>
            <p className="text-sm font-semibold">
              {itens.length === 0 ? "Nenhum lançamento registrado" : "Nenhum resultado para o filtro"}
            </p>
            <p className="text-[12px] text-muted-foreground/70 mt-0.5">
              {itens.length === 0 ? "Clique em 'Novo lançamento' para começar" : "Limpe os filtros para ver todos"}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {itensFiltrados.map(item => {
            const CatIcon  = allCats.find(c => c.valor === item.categoria)?.icon ?? Package;
            const catLabel = allCats.find(c => c.valor === item.categoria)?.label ?? item.categoria;
            const nf       = nfColors[item.status_nf];
            const isMes    = item.data_lancamento.startsWith(mesAtualStr);
            return (
              <div key={item.id} className="rounded-xl overflow-hidden flex flex-col bg-card border border-border/50 hover:border-border hover:shadow-md transition-all">
                <div style={{ height: 3, background: isMes ? "#f97316" : "hsl(var(--border))" }} />
                <div className="p-3 flex-1 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                        <CatIcon size={15} className="text-violet-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[12px] font-bold text-foreground truncate">{item.descricao}</p>
                        <p className="text-[10px] text-muted-foreground/70">{catLabel}</p>
                      </div>
                    </div>
                    <p className="text-[14px] font-black shrink-0 text-red-600 dark:text-red-400 font-mono tabular-nums">
                      {fmtCurrency(item.valor)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-lg border", nf.cls)}>{nf.label}</span>
                    {item.recorrente && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-lg flex items-center gap-1 bg-sky-500/10 text-sky-600 border border-sky-500/20">
                        <Repeat2 size={9} />{item.periodicidade}
                      </span>
                    )}
                    {isMes && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-orange-500/10 text-orange-600 border border-orange-500/20">mês atual</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground/70">
                    <span className="truncate">{item.fornecedor ?? "—"}</span>
                    <span className="font-mono shrink-0 ml-2">{new Date(item.data_lancamento + "T12:00:00").toLocaleDateString("pt-BR")}</span>
                  </div>
                  {(item.nota_fiscal_manual || item.chave_nfe) && (
                    <div className="rounded-lg px-2 py-1.5 bg-muted/30 border border-border/40">
                      {item.nota_fiscal_manual && <p className="text-[10px] font-mono text-muted-foreground">NF: {item.nota_fiscal_manual}</p>}
                      {item.chave_nfe && <p className="text-[9px] font-mono text-muted-foreground/70 truncate">Chave: {item.chave_nfe.slice(0, 20)}…</p>}
                    </div>
                  )}
                  {item.observacoes && <p className="text-[10px] text-muted-foreground italic line-clamp-2">{item.observacoes}</p>}
                </div>
                <div className="flex" style={{ borderTop: "1px solid hsl(var(--border))" }}>
                  <button type="button" onClick={() => { setEditItem(item); setModalOpen(true); }}
                    className="flex-1 h-8 flex items-center justify-center gap-1.5 text-[11px] font-semibold text-muted-foreground hover:bg-violet-500/8 hover:text-violet-700 transition-colors">
                    <Edit3 size={11} />Editar
                  </button>
                  <div style={{ width: 1, background: "hsl(var(--border))" }} />
                  <button type="button" onClick={() => setDelItem(item)}
                    className="flex-1 h-8 flex items-center justify-center gap-1.5 text-[11px] font-semibold text-muted-foreground/70 hover:bg-red-500/8 hover:text-red-600 transition-colors">
                    <Trash2 size={11} />Excluir
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <LancamentoModal
        open={modalOpen} tipo={tipo} inicial={editItem} modoTeste={modoTeste}
        onClose={() => { setModalOpen(false); setEditItem(null); }}
        onSuccess={() => { setModalOpen(false); setEditItem(null); load(); }}
      />

      {delItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-card border border-border/40 p-5 space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-red-100 dark:bg-red-950/40 flex items-center justify-center shrink-0">
                <Trash2 size={18} className="text-red-600" />
              </div>
              <div>
                <p className="text-[14px] font-bold">Excluir lançamento?</p>
                <p className="text-[12px] text-muted-foreground mt-0.5">{delItem.descricao}</p>
                <p className="text-[13px] font-bold mt-1 text-red-500">{fmtCurrency(delItem.valor)}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setDelItem(null)} disabled={deleting}
                className="flex-1 h-9 rounded-xl border border-border/50 text-sm font-semibold text-muted-foreground hover:bg-muted/40 transition-colors">
                Cancelar
              </button>
              <button type="button" onClick={handleDelete} disabled={deleting}
                className="flex-1 h-9 rounded-xl text-white text-sm font-bold transition-colors flex items-center justify-center gap-1.5"
                style={{ background: "#dc2626" }}>
                {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Excluir
              </button>
            </div>
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

// ─── PainelBancos ────────────────────────────────────────────────────────────

function PainelBancos({ modoTeste, onToggleModoTeste }: { modoTeste: boolean; onToggleModoTeste: () => void }) {
  const { isAdmin } = useAuth();
  const [contas,    setContas]    = useState<ContaBancaria[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editConta, setEditConta] = useState<ContaBancaria | null>(null);
  const [saving,    setSaving]    = useState(false);

  const [banco,     setBanco]     = useState(BANCOS_BR[0]);
  const [agencia,   setAgencia]   = useState("");
  const [contaNum,  setContaNum]  = useState("");
  const [tipoConta, setTipoConta] = useState<ContaBancaria["tipo"]>("corrente");
  const [saldo,     setSaldo]     = useState("");
  const [webhook,   setWebhook]   = useState("");
  const [token,     setToken]     = useState("");
  const [envioAuto, setEnvioAuto] = useState(false);
  const [integAtiva,setIntegAtiva]= useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("financeiro_contas_bancarias").select("*").order("created_at");
    setContas((data ?? []) as ContaBancaria[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function abrirModal(c?: ContaBancaria) {
    if (c) {
      setEditConta(c); setBanco(c.banco); setAgencia(c.agencia); setContaNum(c.conta);
      setTipoConta(c.tipo); setSaldo(c.saldo_atual.toFixed(2)); setWebhook(c.webhook_url ?? "");
      // FIX: o token nunca é trazido em texto puro pela listagem — o campo
      // fica em branco; se o usuário não digitar nada, mantém o token atual.
      setToken(""); setEnvioAuto(c.envio_automatico_nf); setIntegAtiva(c.integracao_ativa);
    } else {
      setEditConta(null); setBanco(BANCOS_BR[0]); setAgencia(""); setContaNum("");
      setTipoConta("corrente"); setSaldo(""); setWebhook(""); setToken("");
      setEnvioAuto(false); setIntegAtiva(false);
    }
    setModalOpen(true);
  }

  async function handleSaveConta() {
    if (!banco || !agencia || !contaNum) { toast.error("Banco, agência e conta são obrigatórios."); return; }
    // valida webhook URL antes de salvar
    if (webhook.trim() && !isWebhookUrlSafe(webhook.trim())) {
      toast.error("URL do webhook inválida. Use HTTPS com domínio público.");
      return;
    }
    setSaving(true);
    // FIX: token_api removido do payload — nunca mais gravado em texto puro
    // direto na tabela. Vai pela RPC set_conta_bancaria_token() abaixo.
    const payload = {
      banco, agencia, conta: contaNum, tipo: tipoConta,
      saldo_atual: parseFloat(saldo) || 0,
      webhook_url: webhook.trim() || null,
      envio_automatico_nf: envioAuto, integracao_ativa: integAtiva,
    };
    try {
      let err;
      let contaId = editConta?.id;
      if (editConta) {
        ({ error: err } = await supabase.from("financeiro_contas_bancarias").update(payload).eq("id", editConta.id));
      } else {
        const { data: inserted, error: insErr } = await supabase
          .from("financeiro_contas_bancarias").insert(payload).select("id").single();
        err = insErr;
        contaId = (inserted as { id: string } | null)?.id;
      }
      if (err) throw err;

      // Só atualiza o token se o usuário digitou algo no campo — campo vazio
      // significa "manter o token atual", não "remover".
      if (token.trim() && contaId) {
        const { data: tokenResult, error: tokenErr } = await supabase.rpc("set_conta_bancaria_token", {
          p_conta_id: contaId, p_token: token.trim(),
        });
        const tr = tokenResult as { ok?: boolean; error?: string } | null;
        if (tokenErr || tr?.ok === false) {
          toast.error(tr?.error ?? "Conta salva, mas falhou ao salvar o token.");
          setModalOpen(false); load();
          return;
        }
      }

      toast.success(editConta ? "Conta atualizada!" : "Conta cadastrada!");
      setModalOpen(false); load();
    } catch { toast.error("Erro ao salvar conta."); }
    finally { setSaving(false); }
  }

  // valida que a URL é HTTPS e não aponta para IPs privados/loopback
  function isWebhookUrlSafe(url: string): boolean {
    try {
      const u = new URL(url);
      if (u.protocol !== "https:") return false;
      const h = u.hostname.toLowerCase();
      // IPv4 privados / loopback
      if (h === "localhost" || h === "0.0.0.0" || h.endsWith(".local")) return false;
      if (/^127\./.test(h) || /^10\./.test(h) || /^169\.254\./.test(h)) return false;
      if (/^192\.168\./.test(h)) return false;
      if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(h)) return false;
      // IPv6 loopback e link-local
      if (h === "::1" || h === "[::1]" || h.startsWith("fe80")) return false;
      // Cloud metadata endpoints (AWS, GCP, Azure)
      if (h === "169.254.169.254" || h === "metadata.google.internal") return false;
      if (h === "100.100.100.200") return false; // Alibaba Cloud
      // Sem IP direto — exige domínio (previne bypass via DNS rebinding)
      if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return false;
      return true;
    } catch { return false; }
  }

  async function testarWebhook(c: ContaBancaria) {
    if (!c.webhook_url) { toast.error("Configure o webhook antes de testar."); return; }
    if (!isWebhookUrlSafe(c.webhook_url)) {
      toast.error("URL inválida. Use HTTPS com domínio público (não IPs internos ou localhost).");
      return;
    }
    toast.info("Enviando requisição de teste…");
    try {
      // FIX: o token não vem mais no objeto da conta (nunca trafega em
      // texto puro pela listagem) — busca via RPC só neste momento, quando
      // o próprio usuário pediu para testar.
      let authHeader: Record<string, string> = {};
      if (c.token_api_secret_id) {
        const { data: tok, error: tokErr } = await supabase.rpc("get_conta_bancaria_token", { p_conta_id: c.id });
        if (tokErr) { toast.error("Não foi possível recuperar o token configurado."); return; }
        if (tok) authHeader = { Authorization: `Bearer ${tok}` };
      }
      const res = await fetch(c.webhook_url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ evento: "teste", banco: c.banco, timestamp: new Date().toISOString() }),
      });
      if (res.ok) toast.success(`Webhook OK — HTTP ${res.status}`);
      else toast.error(`Webhook retornou HTTP ${res.status}`);
    } catch { toast.error("Falha ao conectar com o webhook."); }
  }

  async function excluirConta(id: string) {
    if (!window.confirm("Excluir esta conta bancária? Esta ação não pode ser desfeita.")) return;
    const { error } = await supabase.from("financeiro_contas_bancarias").delete().eq("id", id);
    if (error) { toast.error("Erro ao excluir conta."); return; }
    toast.success("Conta excluída.");
    load();
  }

  const saldoTotal = contas.reduce((s, c) => s + c.saldo_atual, 0);

  return (
    <div className="space-y-4">
      {contas.length > 0 && (
        <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/5 to-violet-500/10 p-4 flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-violet-500/15 flex items-center justify-center shrink-0">
            <Wallet size={24} className="text-violet-600" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Saldo Total em Caixa</p>
            <p className="text-2xl font-black text-violet-600 font-mono tabular-nums">{fmtCurrency(saldoTotal)}</p>
            <p className="text-[11px] text-muted-foreground">{contas.length} conta{contas.length > 1 ? "s" : ""} cadastrada{contas.length > 1 ? "s" : ""}</p>
          </div>
        </div>
      )}

      {/* Toggle de ambiente fiscal e configuração SEFAZ: SOMENTE ADMIN.
          Alternar homolog/produção muda o valor fiscal das notas do sistema
          inteiro, e o card de configuração expõe nomes de secrets/funções —
          usuários do Financeiro não precisam ver nada disso. O aviso "Modo
          Homologação ativo" continua aparecendo nas telas de emissão. */}
      {isAdmin && (
      <>
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
      </>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-bold flex items-center gap-1.5">
            <Landmark className="h-4 w-4 text-violet-500" />Contas Bancárias
          </p>
          <button type="button" onClick={() => abrirModal()}
            className="h-8 px-3 flex items-center gap-1 rounded-xl text-[11px] font-bold text-white hover:opacity-90 transition-all"
            style={{ background: "#7c3aed" }}>
            <PlusCircle className="h-3.5 w-3.5" />Nova conta
          </button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-8"><div className="animate-spin h-5 w-5 border-2 border-violet-500 border-t-transparent rounded-full" /></div>
        ) : contas.length === 0 ? (
          <div className="text-center py-8 space-y-2">
            <Landmark className="h-10 w-10 text-muted-foreground/20 mx-auto" />
            <p className="text-sm text-muted-foreground">Nenhuma conta cadastrada</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {contas.map(c => (
              <div key={c.id} className="rounded-xl border border-border/50 bg-card p-4 space-y-3 hover:border-border hover:shadow-sm transition-all">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[14px] font-bold">{c.banco}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">Ag {c.agencia} · {c.conta}</p>
                    <p className="text-[10px] text-muted-foreground capitalize">{c.tipo === "corrente" ? "Conta Corrente" : c.tipo === "poupanca" ? "Poupança" : "Pagamentos"}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[16px] font-black font-mono tabular-nums">{fmtCurrency(c.saldo_atual)}</p>
                    <div className="flex items-center gap-1 mt-1 justify-end">
                      {c.integracao_ativa && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 border border-green-500/20">Integrado</span>}
                      {c.envio_automatico_nf && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-600 border border-violet-500/20">NF Auto</span>}
                    </div>
                  </div>
                </div>
                {c.webhook_url && (
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/20 rounded-lg px-2 py-1">
                    <Link className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate font-mono">{c.webhook_url}</span>
                  </div>
                )}
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => abrirModal(c)}
                    className="flex-1 h-7 flex items-center justify-center gap-1 rounded-lg bg-muted/30 hover:bg-muted/60 text-[10px] text-muted-foreground transition-colors">
                    <Edit3 className="h-2.5 w-2.5" />Editar
                  </button>
                  <button type="button" onClick={() => testarWebhook(c)}
                    className="flex-1 h-7 flex items-center justify-center gap-1 rounded-lg bg-violet-500/10 hover:bg-violet-500/20 text-[10px] text-violet-600 transition-colors">
                    <TestTube2 className="h-2.5 w-2.5" />Testar Webhook
                  </button>
                  {isAdmin && (
                    <button type="button" onClick={() => excluirConta(c.id)}
                      className="h-7 w-7 flex items-center justify-center rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive transition-colors"
                      title="Excluir conta (admin)">
                      <Trash2 className="h-2.5 w-2.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-card border border-border/40 shadow-2xl overflow-hidden flex flex-col max-h-[94vh] sm:max-h-[92vh] animate-in fade-in slide-in-from-bottom-4 duration-200">
            <div className="px-5 pt-5 pb-3 border-b border-border/20 shrink-0 flex items-center justify-between">
              <p className="text-sm font-semibold flex items-center gap-2">
                <Landmark className="h-4 w-4 text-violet-500" />{editConta ? "Editar" : "Nova"} Conta Bancária
              </p>
              <button type="button" onClick={() => setModalOpen(false)}
                className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Banco *</label>
                <select value={banco} onChange={e => setBanco(e.target.value)}
                  className="w-full h-9 rounded-xl border border-border/50 bg-background text-foreground px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30">
                  {BANCOS_BR.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Agência *</label>
                  <input type="text" value={agencia} onChange={e => setAgencia(e.target.value.slice(0,10))} placeholder="0000-0"
                    className="w-full h-9 rounded-xl border border-border/50 bg-background text-foreground px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Conta *</label>
                  <input type="text" value={contaNum} onChange={e => setContaNum(e.target.value.slice(0,20))} placeholder="00000-0"
                    className="w-full h-9 rounded-xl border border-border/50 bg-background text-foreground px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(["corrente", "poupanca", "pagamentos"] as const).map(t => (
                  <button key={t} type="button" onClick={() => setTipoConta(t)}
                    className={cn("h-8 rounded-xl border text-[10px] font-medium transition-all",
                      tipoConta === t ? "border-violet-500/50 bg-violet-500/10 text-violet-600" : "border-border/30 bg-muted/10 text-muted-foreground")}>
                    {t === "corrente" ? "Corrente" : t === "poupanca" ? "Poupança" : "Pagamentos"}
                  </button>
                ))}
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Saldo Atual (R$)</label>
                <input type="number" step="0.01" value={saldo} onChange={e => setSaldo(e.target.value)} placeholder="0,00"
                  className="w-full h-9 rounded-xl border border-border/50 bg-background text-foreground px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30" />
              </div>
              <div className="border-t border-border/20 pt-3 space-y-3">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                  <Link className="h-2.5 w-2.5" />Integração Bancária
                </p>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Webhook URL</label>
                  <input type="url" value={webhook} onChange={e => setWebhook(e.target.value.slice(0,300))}
                    placeholder="https://api.banco.com.br/webhooks/nf"
                    className="w-full h-9 rounded-xl border border-border/50 bg-background text-foreground px-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Token / Bearer API</label>
                  <input type="password" value={token} onChange={e => setToken(e.target.value.slice(0,300))}
                    placeholder={editConta?.token_api_secret_id ? "•••••••• já configurado — deixe em branco para manter" : "Bearer token ou chave API"}
                    className="w-full h-9 rounded-xl border border-border/50 bg-background text-foreground px-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30" />
                  {editConta?.token_api_secret_id && (
                    <p className="text-[10px] text-muted-foreground/70">Armazenado de forma criptografada. Digite um novo valor para substituir.</p>
                  )}
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                  {[
                    { label: "Integração ativa",      val: integAtiva, set: setIntegAtiva },
                    { label: "Envio automático de NF", val: envioAuto,  set: setEnvioAuto },
                  ].map(f => (
                    <div key={f.label} className="flex items-center gap-2">
                      <button type="button" onClick={() => f.set((v: boolean) => !v)}
                        className={cn("h-5 w-9 rounded-full transition-colors relative shrink-0",
                          f.val ? "bg-violet-500" : "bg-muted/50")}>
                        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-background text-foreground shadow transition-all",
                          f.val ? "left-[calc(100%-18px)]" : "left-0.5")} />
                      </button>
                      <span className="text-[10px] font-medium">{f.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="px-5 pb-5 pt-3 border-t border-border/20 shrink-0 flex gap-2">
              <button type="button" onClick={() => setModalOpen(false)}
                className="h-10 px-4 rounded-xl border border-border/50 text-sm font-medium text-muted-foreground hover:bg-muted/40">Cancelar</button>
              <button type="button" onClick={handleSaveConta} disabled={saving}
                className="flex-1 h-10 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {editConta ? "Salvar" : "Cadastrar"}
              </button>
            </div>
          </div>
        </div>
      )}
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


// ─── PainelTabelaPrecos ───────────────────────────────────────────────────────

interface DevicePreco {
  id: string;
  model: string;
  reference: string;
  internal_code: string;
  ncm: string;
  cfop_padrao: string;
  ipi_pct: number;
  unidade: string;
  preco_custo: number;
  preco_venda: number;
  desconto_max_pct: number;
  margem_minima_pct: number;
  ativo: boolean;
  observacoes_preco: string | null;
}

// ─── NCM auto-suggest ─────────────────────────────────────────────────────────
// Tabela TIPI simplificada para dispositivos médico-odontológicos.
// Complementa o trigger do banco com lógica client-side baseada no nome/ref.
const NCM_RULES: { pattern: RegExp; ncm: string; desc: string; ipi: number }[] = [
  // Implantes e fixadores
  { pattern: /implant|fixture|parafus.*titan|screw.*impl/i,    ncm: "90212910", desc: "Implante dental / parafuso", ipi: 0 },
  // Pilares e próteses
  { pattern: /pilar|abutment|pr[oó]tese|coroa|crown/i,         ncm: "90213990", desc: "Prótese / componente protético", ipi: 0 },
  // Instrumentos / brocas / fresas
  { pattern: /broca|fresa|drill|bur|instrumen|tool|kit\s/i,    ncm: "90184990", desc: "Instrumento odontológico", ipi: 0 },
  // Componentes de conexão / transfer / análogo
  { pattern: /transfer|analog|análog|captur|impression/i,      ncm: "90213990", desc: "Componente de moldagem/transferência", ipi: 0 },
  // Torquímetro / chaves
  { pattern: /torqu|chave|ratchet|wrench|driver/i,             ncm: "90183990", desc: "Instrumento cirúrgico/odontológico", ipi: 0 },
  // Membranas / enxertos
  { pattern: /membran|enxert|graft|colog[eê]n|collagen/i,      ncm: "30059099", desc: "Material de enxerto / membrana", ipi: 0 },
  // Biomateriais / osso sintético
  { pattern: /biomateri|osso|bone|oss[eé]o|xeno|alo|allogen/i, ncm: "30059099", desc: "Biomaterial / substituto ósseo", ipi: 0 },
  // Parafusos em geral (não implante)
  { pattern: /parafuso|screw/i,                                 ncm: "90213990", desc: "Parafuso protético", ipi: 0 },
  // Cicatrizadores / caps / cover
  { pattern: /cicatriz|healing|cover\s*screw|tap|tampa/i,      ncm: "90213990", desc: "Cicatrizador / cap", ipi: 0 },
  // Componentes de munhão / UCLA
  { pattern: /ucla|munhão|munhao|calcinável|calcinable/i,       ncm: "90213990", desc: "Componente UCLA / calcinável", ipi: 0 },
];

async function sugerirNcmParaPeca(deviceId: string, model: string, reference: string): Promise<{ ncm: string; desc: string; ipi: number } | null> {
  // 1. Tenta o RPC do banco (usa risk_class, implantable, body_region, classification_code)
  try {
    const { data } = await supabase.rpc("resolve_ncm_device_by_id", { p_device_id: deviceId });
    if (data && typeof data === "string" && data.length >= 8) {
      return { ncm: data.replace(/\./g, ""), desc: "Sugerido pelo banco (classificação)", ipi: 0 };
    }
  } catch (_) { /* fallback para client-side */ }

  // 2. Client-side por palavras-chave no nome + referência
  const texto = `${model} ${reference}`;
  for (const rule of NCM_RULES) {
    if (rule.pattern.test(texto)) {
      return { ncm: rule.ncm, desc: rule.desc, ipi: rule.ipi };
    }
  }
  return null;
}

function PainelTabelaPrecos({ modoTeste }: { modoTeste: boolean }) {
  const { isAdmin } = useAuth();
  const [devices,    setDevices]    = useState<DevicePreco[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState<string | null>(null);
  const [search,     setSearch]     = useState("");
  const [editRow,    setEditRow]    = useState<string | null>(null);
  const [editData,   setEditData]   = useState<Partial<DevicePreco>>({});
  const [showInativ, setShowInativ] = useState(false);
  const [sortKey,    setSortKey]    = useState<keyof DevicePreco>("model");
  const [sortAsc,    setSortAsc]    = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    // Busca todas as peças com paginação (sem limite padrão do Supabase de 1000)
    const PAGE = 1000;
    let all: DevicePreco[] = [];
    let from = 0;
    let keepGoing = true;
    while (keepGoing) {
      const { data, error } = await supabase
        .from("devices")
        .select("id, model, reference, internal_code, ncm, cfop_padrao, ipi_pct, unidade, preco_custo, preco_venda, desconto_max_pct, margem_minima_pct, ativo, observacoes_preco")
        .order("model")
        .range(from, from + PAGE - 1);
      if (error) { toast.error(friendlyError(error)); break; }
      all = all.concat((data ?? []) as DevicePreco[]);
      keepGoing = (data?.length ?? 0) === PAGE;
      from += PAGE;
    }
    setDevices(all);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function limparPrecos() {
    if (!window.confirm("Zerar TODOS os preços de custo e venda? Esta ação não pode ser desfeita.")) return;
    const { error } = await supabase.from("devices").update({ preco_custo: 0, preco_venda: 0 }).neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) { toast.error("Erro ao limpar preços."); return; }
    toast.success("Todos os preços foram zerados.");
    load();
  }

  async function preencherPrecosTeste() {
    if (!window.confirm("Preencher preços fictícios para teste em TODAS as peças (sobrescreve preços existentes)?")) return;
    // Um único UPDATE com valor fixo para todas as peças — sem loop, sem timeout
    const custo = 45.00;
    const venda = 120.00;
    const { error } = await supabase
      .from("devices")
      .update({ preco_custo: custo, preco_venda: venda })
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) { toast.error("Erro ao preencher preços: " + error.message); return; }
    toast.success("Todas as peças receberam custo R$45,00 e venda R$120,00 para teste.");
    load();
  }

  function exportExcel() {
    // Gera CSV detalhado e dispara download (funciona sem lib externa)
    const headers = [
      "Modelo", "Referência", "Cód. Interno", "NCM", "CFOP", "IPI (%)",
      "Unidade", "Preço Custo (R$)", "Preço Venda (R$)",
      "Margem Real (%)", "Desconto Máx (%)", "Margem Mín (%)",
      "Ativo", "Observações"
    ];
    const BOM = "\uFEFF"; // UTF-8 BOM para Excel reconhecer acentos
    const rows = filtered.map(d => {
      const margem = d.preco_venda > 0
        ? ((d.preco_venda - d.preco_custo) / d.preco_venda * 100).toFixed(2)
        : "0.00";
      return [
        d.model, d.reference, d.internal_code, d.ncm, d.cfop_padrao, String(d.ipi_pct ?? 0),
        d.unidade,
        d.preco_custo.toFixed(2).replace(".", ","),
        d.preco_venda.toFixed(2).replace(".", ","),
        margem.replace(".", ","),
        String(d.desconto_max_pct),
        String(d.margem_minima_pct),
        d.ativo ? "Sim" : "Não",
        d.observacoes_preco ?? "",
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(";");
    });
    const csv = BOM + [headers.map(h => `"${h}"`).join(";"), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `tabela-precos-zomini-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Planilha exportada! ${filtered.length} peças.`);
  }

  function printTabelaPrecos() {
    const esc = escHtml;
    const rows = filtered.map(d => {
      const margem = d.preco_venda > 0
        ? ((d.preco_venda - d.preco_custo) / d.preco_venda * 100).toFixed(1) + "%"
        : "—";
      return `<tr>
        <td>${esc(d.model)}</td>
        <td>${esc(d.reference)}</td>
        <td>${esc(d.ncm)}</td>
        <td style="text-align:right">R$ ${d.preco_custo.toFixed(2).replace(".",",")}</td>
        <td style="text-align:right">R$ ${d.preco_venda.toFixed(2).replace(".",",")}</td>
        <td style="text-align:center">${margem}</td>
        <td style="text-align:center">${d.desconto_max_pct}%</td>
        <td style="text-align:center">${d.ativo ? "Ativo" : "Inativo"}</td>
      </tr>`;
    }).join("");
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Tabela de Preços — Zomini</title>
    <style>
      body{font-family:Arial,sans-serif;font-size:11px;padding:16px;color:#111}
      h1{font-size:16px;font-weight:700;margin-bottom:4px}
      p.sub{font-size:10px;color:#666;margin-bottom:12px}
      table{width:100%;border-collapse:collapse}
      th{background:#f3f0ff;color:#5b21b6;font-size:9px;text-transform:uppercase;padding:6px 8px;border-bottom:2px solid #ddd6fe;text-align:left}
      td{padding:5px 8px;border-bottom:1px solid #f0eeff;font-size:10px;vertical-align:top}
      tr:nth-child(even) td{background:#faf9ff}
      @media print{body{padding:8px}button{display:none}}
    </style></head>
    <body>
    <h1>Tabela de Preços — Zomini Usinagens Especiais</h1>
    <p class="sub">Gerado em ${new Date().toLocaleString("pt-BR")} · ${filtered.length} peças</p>
    <table><thead><tr>
      <th>Modelo</th><th>Referência</th><th>NCM</th>
      <th style="text-align:right">Custo</th><th style="text-align:right">Venda</th>
      <th style="text-align:center">Margem</th><th style="text-align:center">Desc. Máx</th><th style="text-align:center">Status</th>
    </tr></thead><tbody>${rows}</tbody></table>
    <script>window.print();</script>
    </body></html>`;
    const w = window.open("", "_blank");
    if (!w) { toast.error("Popup bloqueado. Permita popups para imprimir."); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  function startEdit(d: DevicePreco) {
    setEditRow(d.id);
    setEditData({
      preco_custo: d.preco_custo, preco_venda: d.preco_venda,
      desconto_max_pct: d.desconto_max_pct, margem_minima_pct: d.margem_minima_pct,
      ncm: d.ncm, cfop_padrao: d.cfop_padrao, ipi_pct: d.ipi_pct, unidade: d.unidade,
      ativo: d.ativo, observacoes_preco: d.observacoes_preco ?? "",
    });
  }

  async function saveEdit(id: string) {
    if (!editData) return;
    setSaving(id);
    const payload = {
      preco_custo:       editData.preco_custo       ?? 0,
      preco_venda:       editData.preco_venda        ?? 0,
      desconto_max_pct:  editData.desconto_max_pct   ?? 0,
      margem_minima_pct: editData.margem_minima_pct  ?? 0,
      ncm:               editData.ncm               ?? "90213990",
      cfop_padrao:       editData.cfop_padrao        ?? "5102",
      ipi_pct:           editData.ipi_pct            ?? 0,
      unidade:           editData.unidade            ?? "UN",
      ativo:             editData.ativo              ?? true,
      observacoes_preco: editData.observacoes_preco  || null,
    };
    const { error } = await supabase.from("devices").update(payload).eq("id", id);
    setSaving(null);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success("Preço atualizado!");
    setEditRow(null);
    setDevices(prev => prev.map(d => d.id === id ? { ...d, ...payload } : d));
  }

  function cancelEdit() { setEditRow(null); setEditData({}); }

  function toggleSort(k: keyof DevicePreco) {
    if (sortKey === k) setSortAsc(v => !v);
    else { setSortKey(k); setSortAsc(true); }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return devices
      .filter(d => (showInativ || d.ativo) && (
        !q ||
        d.model.toLowerCase().includes(q) ||
        d.reference.toLowerCase().includes(q) ||
        d.internal_code.toLowerCase().includes(q) ||
        d.ncm.includes(q)
      ))
      .sort((a, b) => {
        const va = a[sortKey]; const vb = b[sortKey];
        const cmp = typeof va === "string"
          ? (va as string).localeCompare(vb as string)
          : (va as number) - (vb as number);
        return sortAsc ? cmp : -cmp;
      });
  }, [devices, search, showInativ, sortKey, sortAsc]);

  const totalCusto  = filtered.reduce((s, d) => s + d.preco_custo, 0);
  const totalVenda  = filtered.reduce((s, d) => s + d.preco_venda, 0);
  const semPreco    = filtered.filter(d => d.preco_venda <= 0).length;
  const margemMedia = filtered.length > 0
    ? filtered.reduce((s, d) => {
        if (d.preco_venda <= 0) return s;
        return s + ((d.preco_venda - d.preco_custo) / d.preco_venda) * 100;
      }, 0) / filtered.filter(d => d.preco_venda > 0).length
    : 0;

  function SortBtn({ col, label }: { col: keyof DevicePreco; label: string }) {
    const active = sortKey === col;
    return (
      <button type="button" onClick={() => toggleSort(col)}
        className={cn("flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide transition-colors whitespace-nowrap",
          active ? "text-violet-600" : "text-muted-foreground hover:text-foreground")}>
        {label}
        {active ? (sortAsc ? <ChevronUp size={10} /> : <ChevronDown size={10} />) : null}
      </button>
    );
  }

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Preço Médio Venda", value: filtered.length > 0 ? fmtCurrency(totalVenda / filtered.length) : "—", icon: Tag,          color: "#7c3aed" },
          { label: "Custo Médio",       value: filtered.length > 0 ? fmtCurrency(totalCusto / filtered.length) : "—", icon: TrendingDown,  color: "#ef4444" },
          { label: "Margem Média",      value: `${margemMedia.toFixed(1)}%`,                                             icon: Percent,       color: margemMedia >= 20 ? "#10b981" : "#f97316" },
          { label: "Sem Preço",         value: String(semPreco),                                                          icon: AlertTriangle, color: semPreco > 0 ? "#d97706" : "#10b981" },
        ].map(k => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="rounded-2xl p-4 flex items-center gap-3 bg-card border border-border/50">
              <div className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: `${k.color}15`, color: k.color }}>
                <Icon size={18} />
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{k.label}</p>
                <p className="text-[17px] font-black tabular-nums" style={{ color: k.color }}>{k.value}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <SearchInputWithBarcode
          className="flex-1 min-w-[180px]"
          value={search}
          onChange={v => setSearch(v)}
          onSearch={v => setSearch(v)}
          placeholder="Buscar por modelo, referência, NCM ou bipe o código..."
          height="h-9"
          showSearchIcon
        />
        <button type="button" onClick={() => setShowInativ(v => !v)}
          className={cn("h-9 px-3 flex items-center gap-1.5 rounded-xl text-[11px] font-semibold border transition-all",
            showInativ ? "bg-violet-500/15 border-violet-500/40 text-violet-600" : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/50")}>
          <Package size={13} />Inativos
        </button>
        <button type="button" onClick={load} disabled={loading}
          className="h-9 w-9 flex items-center justify-center rounded-xl bg-muted/30 border border-border hover:bg-muted/50 transition-colors">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
        <span className="text-[11px] text-muted-foreground/70">{filtered.length} peças</span>
        <button type="button" onClick={exportExcel} disabled={filtered.length === 0}
          className="h-9 px-3 flex items-center gap-1.5 rounded-xl text-[11px] font-bold border border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/8 hover:bg-emerald-500/15 transition-colors disabled:opacity-40">
          <FileSpreadsheet size={14} />Exportar Excel
        </button>
        <button type="button" onClick={printTabelaPrecos} disabled={filtered.length === 0}
          className="h-9 px-3 flex items-center gap-1.5 rounded-xl text-[11px] font-bold border border-violet-500/40 text-violet-700 dark:text-violet-400 bg-violet-500/8 hover:bg-violet-500/15 transition-colors disabled:opacity-40">
          <Printer size={14} />Imprimir PDF
        </button>
        {isAdmin && (
          <>
            <button type="button" onClick={preencherPrecosTeste}
              className="h-9 px-3 flex items-center gap-1.5 rounded-xl text-[11px] font-bold border border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/8 hover:bg-amber-500/15 transition-colors">
              <Tag size={14} />Preços Teste
            </button>
            <button type="button" onClick={limparPrecos}
              className="h-9 px-3 flex items-center gap-1.5 rounded-xl text-[11px] font-bold border border-destructive/40 text-destructive bg-destructive/5 hover:bg-destructive/10 transition-colors">
              <Trash2 size={14} />Zerar Tudo
            </button>
          </>
        )}
      </div>

      {/* Tabela */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin h-6 w-6 border-2 border-violet-500 border-t-transparent rounded-full" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-14 space-y-2">
          <Tag size={32} className="text-muted-foreground/20 mx-auto" />
          <p className="text-sm text-muted-foreground">Nenhuma peça encontrada</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
          {/* Cabeçalho */}
          <div className="grid gap-2 px-4 py-2.5 bg-muted/30 border-b border-border/40"
            style={{ gridTemplateColumns: "1fr 100px 100px 70px 70px 60px 50px 100px" }}>
            <SortBtn col="model"       label="Modelo / Referência" />
            <SortBtn col="preco_custo" label="Custo (R$)" />
            <SortBtn col="preco_venda" label="Venda (R$)" />
            <SortBtn col="ncm"         label="NCM" />
            <SortBtn col="cfop_padrao" label="CFOP" />
            <SortBtn col="ipi_pct"     label="IPI %" />
            <SortBtn col="ativo"       label="Ativo" />
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Ações</span>
          </div>

          {/* Linhas */}
          <div className="divide-y divide-border/30">
            {filtered.map(d => {
              const isEdit = editRow === d.id;
              const isSav  = saving  === d.id;
              const margem = d.preco_venda > 0
                ? ((d.preco_venda - d.preco_custo) / d.preco_venda * 100)
                : 0;
              const margemOk = d.preco_venda > 0 && margem >= d.margem_minima_pct;

              return (
                <div key={d.id}
                  className={cn("grid gap-2 px-4 py-2 items-center transition-colors",
                    isEdit ? "bg-violet-500/5 border-l-2 border-violet-500" : "hover:bg-muted/20",
                    !d.ativo && "opacity-50")}
                  style={{ gridTemplateColumns: "1fr 100px 100px 70px 70px 60px 50px 100px" }}>

                  {/* Modelo */}
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold truncate">{d.model}</p>
                    <p className="text-[10px] text-muted-foreground/70 truncate">{d.reference} · {d.internal_code}</p>
                    {isEdit && editData.observacoes_preco !== undefined && (
                      <input type="text"
                        value={editData.observacoes_preco ?? ""}
                        onChange={e => setEditData(prev => ({ ...prev, observacoes_preco: e.target.value.slice(0,120) }))}
                        placeholder="Observação (opcional)"
                        className="mt-1 w-full h-6 rounded-lg border border-border/50 bg-background text-foreground px-2 text-[10px] focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                      />
                    )}
                  </div>

                  {/* Preço Custo */}
                  {isEdit ? (
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground">R$</span>
                      <input type="number" min="0" step="0.01"
                        value={editData.preco_custo ?? ""}
                        onChange={e => setEditData(prev => ({ ...prev, preco_custo: parseFloat(e.target.value) || 0 }))}
                        className="w-full h-8 rounded-lg border border-border/50 bg-background text-foreground pl-5 pr-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                      />
                    </div>
                  ) : (
                    <p className="text-[12px] font-mono tabular-nums text-muted-foreground">{fmtCurrency(d.preco_custo)}</p>
                  )}

                  {/* Preço Venda */}
                  {isEdit ? (
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground">R$</span>
                      <input type="number" min="0" step="0.01"
                        value={editData.preco_venda ?? ""}
                        onChange={e => setEditData(prev => ({ ...prev, preco_venda: parseFloat(e.target.value) || 0 }))}
                        className={cn("w-full h-8 rounded-lg border bg-background text-foreground pl-5 pr-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-violet-500/40",
                          (editData.preco_venda ?? 0) > 0 ? "border-border/50" : "border-amber-500/60")}
                      />
                    </div>
                  ) : (
                    <p className={cn("text-[12px] font-bold font-mono tabular-nums",
                      d.preco_venda > 0 ? "text-violet-600" : "text-amber-500")}>
                      {d.preco_venda > 0 ? fmtCurrency(d.preco_venda) : "—"}
                    </p>
                  )}


                  {/* NCM */}
                  {isEdit ? (
                    <div className="space-y-1">
                      <input type="text" inputMode="numeric"
                        value={editData.ncm ?? ""}
                        onChange={e => setEditData(prev => ({ ...prev, ncm: e.target.value.replace(/\D/g,"").slice(0,8) }))}
                        className="w-full h-8 rounded-lg border border-border/50 bg-background text-foreground px-2 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          const sugestao = await sugerirNcmParaPeca(d.id, d.model, d.reference);
                          if (sugestao) {
                            setEditData(prev => ({ ...prev, ncm: sugestao.ncm, ipi_pct: sugestao.ipi }));
                            toast.success(`NCM ${sugestao.ncm} — ${sugestao.desc}`);
                          } else {
                            toast.info("Não foi possível sugerir NCM automaticamente. Preencha manualmente.");
                          }
                        }}
                        className="w-full h-6 rounded-lg bg-violet-500/10 hover:bg-violet-500/20 text-violet-600 text-[9px] font-semibold transition-colors flex items-center justify-center gap-1"
                      >
                        <Zap size={9} />Sugerir NCM
                      </button>
                    </div>
                  ) : (
                    <p className="text-[10px] font-mono text-muted-foreground">{d.ncm || "—"}</p>
                  )}

                  {/* CFOP */}
                  {isEdit ? (
                    <input type="text" inputMode="numeric"
                      value={editData.cfop_padrao ?? ""}
                      onChange={e => setEditData(prev => ({ ...prev, cfop_padrao: e.target.value.replace(/\D/g,"").slice(0,4) }))}
                      className="w-full h-8 rounded-lg border border-border/50 bg-background text-foreground px-2 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                    />
                  ) : (
                    <p className="text-[10px] font-mono text-muted-foreground">{d.cfop_padrao || "—"}</p>
                  )}

                  {/* IPI % */}
                  {isEdit ? (
                    <div className="flex items-center gap-1">
                      <input type="number" min="0" max="100" step="0.01"
                        value={editData.ipi_pct ?? 0}
                        onChange={e => setEditData(prev => ({ ...prev, ipi_pct: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)) }))}
                        className="w-full h-8 rounded-lg border border-border/50 bg-background text-foreground px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                      />
                      <span className="text-[10px] text-muted-foreground shrink-0">%</span>
                    </div>
                  ) : (
                    <span className={cn("text-[11px] font-bold px-1.5 py-0.5 rounded-lg border",
                      (d.ipi_pct ?? 0) > 0
                        ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                        : "bg-muted/30 text-muted-foreground border-border/30")}>
                      {(d.ipi_pct ?? 0) > 0 ? `${d.ipi_pct}%` : "0%"}
                    </span>
                  )}


                  {/* Ativo */}
                  {isEdit ? (
                    <button type="button" onClick={() => setEditData(prev => ({ ...prev, ativo: !prev.ativo }))}
                      className={cn("h-5 w-9 rounded-full transition-colors relative shrink-0",
                        editData.ativo ? "bg-violet-500" : "bg-muted/50")}>
                      <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-background text-foreground shadow transition-all",
                        editData.ativo ? "left-[calc(100%-18px)]" : "left-0.5")} />
                    </button>
                  ) : (
                    <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full border",
                      d.ativo
                        ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                        : "bg-muted/30 text-muted-foreground border-border/30")}>
                      {d.ativo ? "Sim" : "Não"}
                    </span>
                  )}

                  {/* Ações */}
                  {isEdit ? (
                    <div className="flex gap-1">
                      <button type="button" onClick={() => saveEdit(d.id)} disabled={isSav}
                        className="flex-1 h-7 flex items-center justify-center rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50">
                        {isSav ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                      </button>
                      <button type="button" onClick={cancelEdit}
                        className="h-7 w-7 flex items-center justify-center rounded-lg bg-muted/40 hover:bg-muted/70 text-muted-foreground transition-colors">
                        <X size={11} />
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => startEdit(d)}
                      className="h-7 px-2.5 flex items-center gap-1 rounded-lg bg-muted/30 hover:bg-violet-500/10 hover:text-violet-600 text-muted-foreground text-[10px] font-semibold transition-colors">
                      <Edit3 size={11} />Editar
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Rodapé totais */}
          <div className="grid gap-2 px-4 py-2.5 bg-muted/20 border-t border-border/40 font-bold"
            style={{ gridTemplateColumns: "1fr 100px 100px 70px 70px 60px 50px 100px" }}>
            <p className="text-[11px] text-muted-foreground">{filtered.length} peças</p>
            <p className="text-[11px] font-mono text-muted-foreground">{fmtCurrency(totalCusto / (filtered.length || 1))}</p>
            <p className="text-[11px] font-mono text-violet-600">{fmtCurrency(totalVenda / (filtered.length || 1))}</p>
            <p className="text-[11px] text-muted-foreground col-span-5">← médias por peça</p>
          </div>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 flex items-start gap-2">
          <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground">
            Os preços e descontos definidos aqui são usados como referência na emissão de notas fiscais.
            O desconto máx. por peça é aplicado <strong className="text-foreground">individualmente em cada item</strong>, não no total do pedido.
            {modoTeste && <span className="text-orange-500 font-semibold"> · Modo Homologação ativo.</span>}
          </p>
        </div>
      )}
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
      .select("*")
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
    { id: "fluxo",        label: "Fluxo de Caixa",   icon: TrendingUp  },
    { id: "fornecedores", label: "Fornecedores",      icon: Building2   },
    { id: "compras",      label: "Pedidos Compra",    icon: ShoppingCart},
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
          <Suspense fallback={null}><FornecedoresPanel/></Suspense>
        )}
        {activeTab === "compras" && (
          <Suspense fallback={null}><PedidosCompraPanel/></Suspense>
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
            <PainelLancamentos tipo={lancTipo} modoTeste={modoTeste} />
          </div>
        )}

        {activeTab === "bancos" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
                <Landmark size={20} className="text-emerald-600" />
              </div>
              <div>
                <h2 className="text-base font-bold">Bancos &amp; Integração SEFAZ</h2>
                <p className="text-[12px] text-muted-foreground">Contas bancárias, webhooks e ambiente de emissão fiscal</p>
              </div>
            </div>
            <PainelBancos modoTeste={modoTeste} onToggleModoTeste={toggleModoTeste} />
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
            <PainelTabelaPrecos modoTeste={modoTeste} />
          </div>
        )}
        {activeTab === "fluxo" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
                <TrendingUp size={20} className="text-emerald-600" />
              </div>
              <div>
                <h2 className="text-base font-bold">Fluxo de Caixa</h2>
                <p className="text-[12px] text-muted-foreground">Análise de entradas/saídas, aging de inadimplência e projeção</p>
              </div>
            </div>
            <FluxoCaixaPanelLazy />
          </div>
        )}
      </div>
      </main>

      <SefazModal
        pedido={sefazPedido}
        onClose={() => setSefazPedido(null)}
        onSuccess={loadPedidos}
        modoTeste={modoTeste}
      />
      <NFViewerModal
        pedido={nfViewerPedido}
        onClose={() => setNfViewerPedido(null)}
      />
      <HistoricoModal open={historicoOpen} onClose={() => setHistoricoOpen(false)} />
    </div>
  );
}
