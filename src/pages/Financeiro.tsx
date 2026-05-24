/**
 * src/pages/Financeiro.tsx — Módulo Financeiro Completo
 *
 * Abas:
 *  1. NF-e / SEFAZ        — emissão automática e manual de notas fiscais de venda
 *  2. Compras / Produção   — máquinas, matéria-prima, equipamentos, insumos
 *  3. Compras / Empresa    — mobiliário, TI, materiais de escritório, ativos
 *  4. Custos Operacionais  — energia, aluguel, serviços recorrentes
 *  5. Bancos & Integração  — contas bancárias, webhooks, envio automático de NFs
 *
 * Número de NF gerado automaticamente (sequencial via RPC get_next_nf_number).
 * Toggle "Ambiente de Teste" em todas as seções — sem valor fiscal em homologação.
 */

import {
  useState, useEffect, useCallback, useRef, useMemo,
} from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { TableSkeleton } from "@/components/PageSkeleton";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { getStoredTheme, applyTheme } from "@/lib/theme";
import {
  ArrowLeft, Receipt, CheckCircle2, Package, User, Clock,
  Truck, ChevronDown, ChevronUp, Send, X, RefreshCw,
  FileText, History, BadgeCheck, Ban, Bell, FileCheck2,
  AlertCircle, Building2, Hash, DollarSign, CreditCard,
  Banknote, Landmark, ChevronRight, Info, Loader2, MapPin,
  Mail, Percent, ShoppingCart, Wrench, Monitor, Zap,
  Cpu, FlaskConical, Factory, PlusCircle, Edit3, Trash2,
  Link, TestTube2, CheckSquare, AlertTriangle, TrendingDown,
  Wallet, CalendarDays, BarChart3, Tag, Building,
} from "lucide-react";

// ─── Tipos ─────────────────────────────────────────────────────────────────

interface PedidoItem {
  id: string;
  stock_item_id: string;
  lote: string;
  quantidade: number;
  device_model?: string;
  device_reference?: string;
  ncm?: string;
  cfop?: string;
  valor_unitario?: number;
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
  protocolo_sefaz?: string | null;
  chave_acesso_nfe?: string | null;
  desconto_pct?: number;
  xml_nfe?: string | null;
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
  token_api: string | null;
  envio_automatico_nf: boolean;
  created_at: string;
}

// ─── Constantes ────────────────────────────────────────────────────────────

const TIPOS_PAGAMENTO = [
  { valor: "01", label: "Dinheiro",       icon: Banknote   },
  { valor: "03", label: "Cartão Crédito", icon: CreditCard },
  { valor: "04", label: "Cartão Débito",  icon: CreditCard },
  { valor: "17", label: "PIX",            icon: DollarSign },
  { valor: "15", label: "Boleto",         icon: Landmark   },
  { valor: "99", label: "Outros",         icon: DollarSign },
];

const MOD_FRETE = [
  { valor: "9", label: "Sem frete"                       },
  { valor: "0", label: "Por conta do emitente (CIF)"     },
  { valor: "1", label: "Por conta do destinatário (FOB)" },
  { valor: "2", label: "Por conta de terceiros"          },
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

// ─── Helpers ───────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtCurrency(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function statusLabel(s: string) {
  const m: Record<string, string> = {
    pendente: "Pendente", separando: "Separando", pronto: "Pronto",
    faturado: "Faturado", enviado: "Enviado",     cancelado: "Cancelado",
  };
  return m[s] ?? s;
}

function statusColor(s: string) {
  if (s === "pronto")   return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
  if (s === "faturado") return "bg-violet-500/10  text-violet-600  border-violet-500/20";
  if (s === "enviado")  return "bg-green-500/10   text-green-600   border-green-500/20";
  return "bg-muted/30 text-muted-foreground border-border/30";
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
  return {
    tipoNota: "nfe",
    numero,
    serie: "1",
    naturezaOperacao: "VENDA DE MERCADORIA",
    destDocumento: pedido.cliente_documento ?? "",
    destNome:      pedido.cliente_nome ?? "",
    destEmail:     pedido.cliente_email ?? "",
    destEndereco:  pedido.cliente_endereco ?? "",
    itens: pedido.itens.map(item => ({
      pedido_item_id: item.id,
      descricao:      item.device_model ?? "Produto",
      ncm:            item.ncm  ?? "90213990",
      cfop:           item.cfop ?? "5102",
      unidade: "UN",
      quantidade:     item.quantidade,
      valorUnitario:  (item.valor_unitario ?? 0).toFixed(2),
      aliqICMS: "12.00",
      cst: "00",
    })),
    tipoPagamento: "01",
    valorTotal:    "0.00",
    modFrete:      "9",
    valorFrete:    (pedido.frete ?? 0).toFixed(2),
    informacoesAdicionais: pedido.observacoes ?? "",
  };
}

// ─── Step Indicator ────────────────────────────────────────────────────────

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

// ─── Badge Modo Teste ──────────────────────────────────────────────────────

function TestBadge({ modoTeste }: { modoTeste: boolean }) {
  return (
    <span className={cn(
      "text-[9px] font-bold px-1.5 py-0.5 rounded-full border shrink-0",
      modoTeste
        ? "border-orange-500/40 bg-orange-500/8 text-orange-500"
        : "border-green-500/40 bg-green-500/8 text-green-600"
    )}>
      {modoTeste ? "Homologação" : "Produção"}
    </span>
  );
}

// ─── Modal SEFAZ ───────────────────────────────────────────────────────────

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
      supabase.rpc("get_next_nf_number", { p_serie: "1", p_tipo: "nfe" })
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
          chaveAcesso: "35" + Date.now() + "00000000000000000000000000000000",
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
        } as Record<string, unknown>);
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
      } as Record<string, unknown>);

      if (rpcErr) { toast.error(`NF autorizada, mas erro ao salvar: ${rpcErr.message}`); return; }
      const rpcData = rpc as { error?: string } | null;
      if (rpcData?.error) { toast.error(`Erro: ${rpcData.error}`); return; }

      if (pedido.vendedora_id) {
        await supabase.from("notificacoes").insert({
          user_id: pedido.vendedora_id, pedido_id: pedido.id, tipo: "pedido_enviado",
          titulo: "Pedido faturado e enviado! 🚚",
          mensagem: `${pedido.cliente_nome} — ${nfLabel} — Prot. ${result.protocolo}`,
        });
      }

      toast.success(`✅ ${dados.tipoNota.toUpperCase()} autorizada! Protocolo ${result.protocolo}`, { duration: 6000 });
      onClose(); onSuccess();
    } catch (err) {
      toast.error(`Erro ao emitir NF: ${err instanceof Error ? err.message : "Erro desconhecido"}`);
      logger.error("SefazModal:", err);
    } finally { submitting.current = false; setSaving(false); }
  }

  const totalItens = pedido.itens.reduce((s, i) => s + i.quantidade, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-card border border-border/30 shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in slide-in-from-bottom-4 duration-200">

        <div className="px-5 pt-5 pb-3 border-b border-border/20 shrink-0 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileCheck2 className="h-4 w-4 text-violet-500" />
              <span className="text-sm font-semibold">Emissão {dados.tipoNota === "nfce" ? "NFC-e" : "NF-e"} — SEFAZ</span>
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
            <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0", statusColor(pedido.status))}>
              {statusLabel(pedido.status)}
            </span>
          </div>
          <StepBar step={step} total={5} labels={STEP_LABELS} />
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {/* PASSO 1 — Tipo e Identificação */}
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
                      className="w-full h-9 rounded-xl border border-border/50 bg-background pl-7 pr-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50"
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
                    className="w-full h-9 rounded-xl border border-border/50 bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Natureza da Operação *</label>
                <input type="text"
                  value={dados.naturezaOperacao}
                  onChange={e => upd("naturezaOperacao", e.target.value.slice(0,60).toUpperCase())}
                  placeholder="VENDA DE MERCADORIA"
                  className="w-full h-9 rounded-xl border border-border/50 bg-background px-3 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                />
              </div>
              <div className={cn("rounded-xl border p-3 flex items-start gap-2",
                modoTeste ? "border-orange-500/20 bg-orange-500/5" : "border-green-500/20 bg-green-500/5")}>
                {modoTeste
                  ? <AlertTriangle className="h-3.5 w-3.5 text-orange-500 shrink-0 mt-0.5" />
                  : <CheckSquare className="h-3.5 w-3.5 text-green-600 shrink-0 mt-0.5" />}
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  {modoTeste
                    ? <>Modo <strong>Homologação</strong>: nota simulada sem valor fiscal. Altere em <strong>Bancos & Integração</strong>.</>
                    : <>Modo <strong>Produção</strong>: esta nota terá valor fiscal real e será transmitida ao SEFAZ.</>}
                </p>
              </div>
            </div>
          )}

          {/* PASSO 2 — Destinatário */}
          {step === 2 && (
            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Dados do Destinatário</p>
              {[
                { key: "destNome" as const,      label: "Nome / Razão Social *", icon: Building2, placeholder: "RAZÃO SOCIAL", upper: true  },
                { key: "destDocumento" as const, label: "CPF / CNPJ",            icon: Hash,      placeholder: "000.000.000-00", upper: false },
                { key: "destEmail" as const,     label: "E-mail",                icon: Mail,      placeholder: "cliente@email.com", upper: false },
                { key: "destEndereco" as const,  label: "Endereço",              icon: MapPin,    placeholder: "Rua, nº, bairro, cidade — UF", upper: false },
              ].map(f => (
                <div key={f.key} className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                    <f.icon className="h-2.5 w-2.5" />{f.label}
                  </label>
                  <input type="text"
                    value={dados[f.key] as string}
                    onChange={e => upd(f.key, f.upper ? e.target.value.toUpperCase().slice(0,60) : e.target.value.slice(0,60))}
                    placeholder={f.placeholder}
                    className="w-full h-9 rounded-xl border border-border/50 bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                  />
                  {f.key === "destDocumento" && dados.destDocumento.length > 0 && (
                    <p className="text-[10px] text-muted-foreground pl-1">{mascararDoc(dados.destDocumento)}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* PASSO 3 — Itens Fiscais */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Dados Fiscais por Item ({dados.itens.length})
                </p>
              </div>

              {/* Banner de desconto da vendedora */}
              {(pedido?.desconto_pct ?? 0) > 0 && (
                <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-emerald-500/8 border border-emerald-500/25">
                  <div className="flex items-center gap-2">
                    <Percent className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                      Vendedora informou <strong>{pedido!.desconto_pct}% de desconto</strong> em cada peça
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const pct = pedido!.desconto_pct ?? 0;
                      setDados(prev => {
                        if (!prev) return prev;
                        return {
                          ...prev,
                          itens: prev.itens.map(it => {
                            const vOrig = parseFloat(it.valorUnitario) || 0;
                            if (vOrig <= 0) return it;
                            const vDesc = vOrig * (1 - pct / 100);
                            return { ...it, valorUnitario: vDesc.toFixed(2) };
                          }),
                        };
                      });
                    }}
                    className="shrink-0 h-7 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold transition-colors"
                  >
                    Aplicar desconto
                  </button>
                </div>
              )}

              {dados.itens.map((item, idx) => {
                const vOrig  = parseFloat(item.valorUnitario) || 0;
                const pct    = pedido?.desconto_pct ?? 0;
                const vDesc  = pct > 0 && vOrig > 0 ? vOrig * (1 - pct / 100) : null;
                const vTotal = item.quantidade * vOrig;
                const ncmOk  = item.ncm.replace(/\D/g,"").length >= 8;
                const cfopOk = item.cfop.replace(/\D/g,"").length >= 4;
                const vlrOk  = vOrig > 0;
                return (
                  <div key={item.pedido_item_id}
                    className={cn("rounded-xl border p-3 space-y-2.5 transition-colors",
                      ncmOk && cfopOk && vlrOk ? "border-border/30 bg-muted/10" : "border-amber-500/30 bg-amber-500/4")}>
                    <div className="flex items-center gap-2">
                      <div className="h-6 w-6 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                        <Package className="h-3 w-3 text-violet-500" />
                      </div>
                      <p className="text-[11px] font-semibold truncate flex-1">{item.descricao}</p>
                      <span className="text-[10px] text-muted-foreground shrink-0">{item.quantidade} un.</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { key: "ncm"  as const, label: "NCM (8 dígitos) *", ph: "90213990", maxLen: 8, ok: ncmOk  },
                        { key: "cfop" as const, label: "CFOP (4 dígitos) *", ph: "5102",    maxLen: 4, ok: cfopOk },
                      ].map(f => (
                        <div key={f.key} className="space-y-1">
                          <label className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide">{f.label}</label>
                          <input type="text" inputMode="numeric"
                            value={item[f.key]}
                            onChange={e => updItem(idx, f.key, e.target.value.replace(/\D/g,"").slice(0, f.maxLen))}
                            placeholder={f.ph}
                            className={cn("w-full h-8 rounded-lg border bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-violet-500/40",
                              f.ok ? "border-border/50" : "border-amber-500/60 bg-amber-500/4")}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <label className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide">Vlr. Unit. *</label>
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground">R$</span>
                          <input type="number" min="0" step="0.01"
                            value={item.valorUnitario}
                            onChange={e => updItem(idx, "valorUnitario", e.target.value)}
                            className={cn("w-full h-8 rounded-lg border bg-background pl-5 pr-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-violet-500/40",
                              vlrOk ? "border-border/50" : "border-amber-500/60 bg-amber-500/4")}
                          />
                        </div>
                        {vDesc !== null && (
                          <p className="text-[9px] text-emerald-600 dark:text-emerald-400 font-mono">
                            com {pct}% desc → R$ {vDesc.toFixed(2)}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-0.5">
                          <Percent className="h-2 w-2" />ICMS %
                        </label>
                        <input type="number" min="0" max="100" step="0.01"
                          value={item.aliqICMS}
                          onChange={e => updItem(idx, "aliqICMS", e.target.value)}
                          className="w-full h-8 rounded-lg border border-border/50 bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide">CST</label>
                        <select value={item.cst} onChange={e => updItem(idx, "cst", e.target.value)}
                          className="w-full h-8 rounded-lg border border-border/50 bg-background px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-500/40">
                          <option value="00">00 — Tributado</option>
                          <option value="20">20 — Red. BC</option>
                          <option value="40">40 — Isento</option>
                          <option value="41">41 — Não trib.</option>
                          <option value="60">60 — ICMS-ST</option>
                        </select>
                      </div>
                    </div>
                    {vTotal > 0 && (
                      <div className="text-right text-[10px] font-mono font-semibold text-violet-500">= R$ {vTotal.toFixed(2)}</div>
                    )}
                  </div>
                );
              })}
              <div className="flex items-center justify-between rounded-xl border border-border/30 bg-background/60 px-3 py-2">
                <span className="text-[11px] text-muted-foreground">Frete (R$)</span>
                <input type="number" min="0" step="0.01"
                  value={dados.valorFrete} onChange={e => upd("valorFrete", e.target.value)}
                  className="w-24 h-7 rounded-lg border border-border/50 bg-background px-2 text-xs font-mono text-right focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-violet-500/25 bg-violet-500/8 px-3 py-2.5">
                <span className="text-[13px] font-semibold">Total NF</span>
                <span className="text-[15px] font-bold text-violet-600 font-mono">R$ {dados.valorTotal}</span>
              </div>
            </div>
          )}

          {/* PASSO 4 — Pagamento */}
          {step === 4 && (
            <div className="space-y-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pagamento e Transporte</p>
              <div className="space-y-2">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Forma de Pagamento *</label>
                <div className="grid grid-cols-2 gap-2">
                  {TIPOS_PAGAMENTO.map(tp => {
                    const Icon = tp.icon;
                    return (
                      <button key={tp.valor} type="button" onClick={() => upd("tipoPagamento", tp.valor)}
                        className={cn("flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-all",
                          dados.tipoPagamento === tp.valor
                            ? "border-violet-500/50 bg-violet-500/10 ring-1 ring-violet-500/20"
                            : "border-border/40 bg-muted/15 hover:bg-muted/35")}>
                        <Icon className={cn("h-3.5 w-3.5 shrink-0", dados.tipoPagamento === tp.valor ? "text-violet-500" : "text-muted-foreground")} />
                        <span className="text-[11px] font-medium">{tp.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Modalidade do Frete</label>
                <div className="space-y-1.5">
                  {MOD_FRETE.map(mf => (
                    <button key={mf.valor} type="button" onClick={() => upd("modFrete", mf.valor)}
                      className={cn("w-full flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-all",
                        dados.modFrete === mf.valor
                          ? "border-violet-500/50 bg-violet-500/10"
                          : "border-border/30 bg-muted/10 hover:bg-muted/30")}>
                      <Truck className={cn("h-3 w-3 shrink-0", dados.modFrete === mf.valor ? "text-violet-500" : "text-muted-foreground")} />
                      <span className="text-[11px]">{mf.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Informações Adicionais</label>
                <textarea
                  value={dados.informacoesAdicionais}
                  onChange={e => upd("informacoesAdicionais", e.target.value.slice(0,500))}
                  placeholder="Pedido nº ..., referência ..., prazo de entrega ..."
                  rows={3}
                  className="w-full rounded-xl border border-border/50 bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500/30 resize-none"
                />
                <p className="text-[9px] text-muted-foreground text-right">{dados.informacoesAdicionais.length}/500</p>
              </div>
            </div>
          )}

          {/* PASSO 5 — Revisão */}
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
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                  <User className="h-2.5 w-2.5" />Destinatário
                </p>
                <p className="text-[13px] font-semibold">{dados.destNome}</p>
                {dados.destDocumento && <p className="text-[10px] text-muted-foreground font-mono">{mascararDoc(dados.destDocumento)}</p>}
                {dados.destEmail && <p className="text-[10px] text-muted-foreground">{dados.destEmail}</p>}
              </div>
              <div className="rounded-xl border border-border/30 bg-muted/10 p-3 space-y-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                  <Package className="h-2.5 w-2.5" />Itens ({dados.itens.length})
                </p>
                {dados.itens.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between text-[11px]">
                    <span className="truncate flex-1 mr-2">{item.descricao}</span>
                    <span className="font-mono text-muted-foreground shrink-0">
                      {item.quantidade}× R$ {parseFloat(item.valorUnitario).toFixed(2)}
                    </span>
                  </div>
                ))}
                <div className="border-t border-border/30 pt-1 flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">Frete</span>
                  <span className="font-mono text-muted-foreground">R$ {parseFloat(dados.valorFrete || "0").toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-bold">Total</span>
                  <span className="text-[15px] font-bold text-violet-600 font-mono">R$ {dados.valorTotal}</span>
                </div>
              </div>
              <div className="rounded-xl border border-border/30 bg-muted/10 px-3 py-2 flex items-center justify-between">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Pagamento</span>
                <span className="text-[12px] font-semibold">
                  {TIPOS_PAGAMENTO.find(t => t.valor === dados.tipoPagamento)?.label}
                </span>
              </div>
              {pedido.vendedora_nome && (
                <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-3 py-2.5 flex items-start gap-2">
                  <Bell className="h-3.5 w-3.5 text-violet-500 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-muted-foreground">
                    <strong>{pedido.vendedora_nome}</strong> receberá notificação ao autorizar.
                  </p>
                </div>
              )}
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

// ─── Card de Pedido ────────────────────────────────────────────────────────

function PedidoCard({ pedido, onEmitirNF }: { pedido: Pedido; onEmitirNF: (p: Pedido) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [copied,   setCopied]   = useState(false);
  const totalItens = pedido.itens.reduce((s, i) => s + i.quantidade, 0);

  function copyChave() {
    if (!pedido.chave_acesso_nfe) return;
    navigator.clipboard.writeText(pedido.chave_acesso_nfe);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadXml() {
    const blob = new Blob([pedido.xml_nfe!], { type: "application/xml" });
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

  const cardBorder = isPronto   ? "1.5px solid #34d399" :
                     isFaturado ? "1.5px solid #a78bfa" :
                     isEnviado  ? "1.5px solid #4ade80" :
                                  "1.5px solid #e2e8f0";

  const barColor   = isPronto   ? "#10b981" :
                     isFaturado ? "#7c3aed" :
                     isEnviado  ? "#22c55e" : "#94a3b8";

  const badgeStyle = isPronto
    ? { background: "#f0fdf4", color: "#15803d",  border: "1px solid #86efac" }
    : isFaturado
    ? { background: "#f5f3ff", color: "#6d28d9",  border: "1px solid #c4b5fd" }
    : isEnviado
    ? { background: "#f0fdf4", color: "#166534",  border: "1px solid #4ade80" }
    : { background: "#f1f5f9", color: "#64748b",  border: "1px solid #cbd5e1" };

  return (
    <div style={{ border: cardBorder, boxShadow: "0 2px 8px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.05)", borderRadius: "16px", overflow: "hidden", background: "white" }}
      className="dark:bg-card transition-shadow hover:shadow-lg flex flex-col">

      {/* Linha de status colorida */}
      <div style={{ height: "3px", background: barColor, width: "100%" }} />

      {/* Header clicável */}
      <button type="button" onClick={() => setExpanded(v => !v)}
        className="w-full text-left px-4 pt-3 pb-3 flex items-start gap-3">

        {/* Ícone status */}
        <div className="shrink-0 mt-0.5" style={{
          width: 36, height: 36, borderRadius: 10, display: "flex",
          alignItems: "center", justifyContent: "center",
          background: isPronto ? "#dcfce7" : isFaturado ? "#ede9fe" : isEnviado ? "#dcfce7" : "#f1f5f9"
        }}>
          {isEnviado  ? <BadgeCheck size={18} color="#22c55e" /> :
           isFaturado ? <FileCheck2 size={18} color="#7c3aed" /> :
                        <Receipt    size={18} color="#10b981" />}
        </div>

        <div className="flex-1 min-w-0">
          {/* Cliente + status */}
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-[14px] font-bold text-gray-900 dark:text-foreground truncate">{pedido.cliente_nome}</span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg" style={badgeStyle}>
              {statusLabel(pedido.status)}
            </span>
            {(pedido.desconto_pct ?? 0) > 0 && (
              <span style={{ background: "#f0fdf4", color: "#15803d", border: "1px solid #86efac" }}
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-lg">
                -{pedido.desconto_pct}%
              </span>
            )}
          </div>

          {/* Metadados */}
          <div className="flex items-center gap-3 flex-wrap">
            {pedido.vendedora_nome && (
              <span className="flex items-center gap-1 text-[11px] text-gray-500">
                <User size={10} />{pedido.vendedora_nome}
              </span>
            )}
            <span className="flex items-center gap-1 text-[11px] text-gray-500">
              <Package size={10} />{totalItens} un. · {pedido.itens.length} tipo{pedido.itens.length !== 1 ? "s" : ""}
            </span>
            {pedido.nota_fiscal && (
              <span className="flex items-center gap-1 text-[11px] font-mono" style={{ color: "#7c3aed" }}>
                <FileText size={10} />{pedido.nota_fiscal}
              </span>
            )}
            <span className="flex items-center gap-1 text-[10px] text-gray-400">
              <Clock size={10} />{fmtDate(pedido.created_at)}
            </span>
          </div>
        </div>

        {expanded
          ? <ChevronUp size={16} className="text-gray-400 shrink-0 mt-1" />
          : <ChevronDown size={16} className="text-gray-400 shrink-0 mt-1" />}
      </button>

      {/* Expandido */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3" style={{ borderTop: "1px solid #f1f5f9" }}>

          {/* Timeline de datas */}
          <div className="grid grid-cols-3 gap-2 pt-3">
            {[
              { label: "Criado",   value: pedido.created_at,  icon: <Clock size={10} />,        color: "#64748b" },
              { label: "Separado", value: pedido.separado_em, icon: <CheckCircle2 size={10} />,  color: "#10b981" },
              { label: "NF emitida",value: pedido.nf_criada_em,icon: <Receipt size={10} />,     color: "#7c3aed" },
            ].map(({ label, value, icon, color }) => (
              <div key={label} className="rounded-xl p-2 text-center" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                <div className="flex items-center justify-center gap-1 mb-1" style={{ color }}>
                  {icon}
                  <span className="text-[9px] font-semibold uppercase tracking-wide">{label}</span>
                </div>
                <p className="text-[10px] font-mono text-gray-600">{value ? fmtDate(value) : "—"}</p>
              </div>
            ))}
          </div>

          {/* Cliente info */}
          {(pedido.cliente_documento || pedido.cliente_telefone || pedido.cliente_email) && (
            <div className="rounded-xl p-3 space-y-1.5" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Dados do Cliente</p>
              {pedido.cliente_documento && (
                <p className="text-[11px] text-gray-700 font-mono">{mascararDoc(pedido.cliente_documento)}</p>
              )}
              {pedido.cliente_telefone && (
                <p className="flex items-center gap-1 text-[11px] text-gray-600">
                  <MapPin size={10} />{pedido.cliente_telefone}
                </p>
              )}
              {pedido.cliente_email && (
                <p className="flex items-center gap-1 text-[11px] text-gray-600">
                  <Mail size={10} />{pedido.cliente_email}
                </p>
              )}
            </div>
          )}

          {/* Itens */}
          <div className="space-y-1">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Itens do Pedido</p>
            {pedido.itens.map(item => (
              <div key={item.id} className="flex items-center gap-2 px-3 py-2 rounded-lg"
                style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                <Package size={12} className="text-gray-400 shrink-0" />
                <span className="text-[12px] font-medium text-gray-800 flex-1 truncate">{item.device_model}</span>
                <span className="text-[11px] font-bold text-gray-700">{item.quantidade} un.</span>
              </div>
            ))}
          </div>

          {/* Chave de acesso SEFAZ */}
          {pedido.chave_acesso_nfe && (
            <div className="rounded-xl p-3 space-y-2" style={{ background: "#faf5ff", border: "1px solid #e9d5ff" }}>
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "#7c3aed" }}>Chave de Acesso NF-e</p>
                <button type="button" onClick={copyChave}
                  className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-lg transition-colors"
                  style={{ background: copied ? "#ede9fe" : "#f5f3ff", color: "#7c3aed", border: "1px solid #c4b5fd" }}>
                  <Copy size={10} />{copied ? "Copiado!" : "Copiar"}
                </button>
              </div>
              <p className="text-[9px] font-mono break-all leading-relaxed text-gray-600">{pedido.chave_acesso_nfe}</p>
              {pedido.protocolo_sefaz && (
                <p className="text-[10px] font-mono font-semibold" style={{ color: "#7c3aed" }}>
                  Protocolo: {pedido.protocolo_sefaz}
                </p>
              )}
            </div>
          )}

          {/* Desconto */}
          {(pedido.desconto_pct ?? 0) > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
              style={{ background: "#f0fdf4", border: "1px solid #86efac" }}>
              <Percent size={12} color="#15803d" />
              <span className="text-[11px] font-semibold" style={{ color: "#15803d" }}>
                {pedido.desconto_pct}% de desconto aplicado em todas as peças
              </span>
            </div>
          )}

          {/* Observações */}
          {pedido.observacoes && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-xl" style={{ background: "#fffbeb", border: "1px solid #fde68a" }}>
              <FileText size={12} className="mt-0.5 shrink-0" color="#d97706" />
              <p className="text-[11px] text-amber-800 italic">{pedido.observacoes}</p>
            </div>
          )}

          {/* Ações */}
          <div className="flex gap-2 pt-1">
            {pedido.xml_nfe && (
              <button type="button" onClick={downloadXml}
                className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-xl text-[11px] font-semibold transition-colors"
                style={{ background: "#f5f3ff", color: "#6d28d9", border: "1px solid #c4b5fd" }}>
                <Download size={13} />XML NF-e
              </button>
            )}
            {isPronto && (
              <button type="button" onClick={() => onEmitirNF(pedido)}
                className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-xl text-[12px] font-bold text-white transition-colors"
                style={{ background: "#7c3aed", boxShadow: "0 2px 8px rgba(124,58,237,0.35)" }}>
                <FileCheck2 size={14} />Emitir NF-e
              </button>
            )}
            {isEnviado && (
              <div className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-xl text-[11px] font-semibold"
                style={{ background: "#f0fdf4", color: "#166534", border: "1px solid #86efac" }}>
                <BadgeCheck size={14} />NF emitida e enviada
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Modal de Lançamento Financeiro ───────────────────────────────────────

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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-card border border-border/30 shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in slide-in-from-bottom-4 duration-200">

        <div className="px-5 pt-5 pb-3 border-b border-border/20 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-violet-500" />
            <span className="text-sm font-semibold">{inicial ? "Editar" : "Novo"} {tipoLabel}</span>
            <TestBadge modoTeste={modoTeste} />
          </div>
          <button type="button" onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {/* Categoria */}
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

          {/* Descrição + Fornecedor */}
          {[
            { label: "Descrição *", val: descricao, set: setDescricao, placeholder: "Ex: Compressor industrial, conta de luz..." },
            { label: "Fornecedor / Empresa", val: fornecedor, set: setFornecedor, placeholder: "Nome do fornecedor" },
          ].map(f => (
            <div key={f.label} className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{f.label}</label>
              <input type="text" value={f.val} onChange={e => f.set(e.target.value.slice(0,120))}
                placeholder={f.placeholder}
                className="w-full h-9 rounded-xl border border-border/50 bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30"
              />
            </div>
          ))}

          {/* Valor + Data */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Valor (R$) *</label>
              <input type="number" min="0" step="0.01" value={valor} onChange={e => setValor(e.target.value)}
                placeholder="0,00"
                className="w-full h-9 rounded-xl border border-border/50 bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <CalendarDays className="h-2.5 w-2.5" />Data
              </label>
              <input type="date" value={data} onChange={e => setData(e.target.value)}
                className="w-full h-9 rounded-xl border border-border/50 bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30"
              />
            </div>
          </div>

          {/* Nota Fiscal */}
          <div className="space-y-2">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <FileText className="h-2.5 w-2.5" />Nota Fiscal
            </label>
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
                  className="w-full h-8 rounded-xl border border-border/50 bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                />
                <input type="text" value={chaveNfe} onChange={e => setChaveNfe(e.target.value.replace(/\D/g,"").slice(0,44))}
                  placeholder="Chave de acesso NF-e 44 dígitos (opcional)"
                  className="w-full h-8 rounded-xl border border-border/50 bg-background px-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                />
              </div>
            )}
          </div>

          {/* Recorrência — apenas custos */}
          {tipo === "custo_operacional" && (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setRecorrente(v => !v)}
                  className={cn("h-5 w-9 rounded-full transition-colors relative shrink-0",
                    recorrente ? "bg-violet-500" : "bg-muted/50")}>
                  <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all",
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

          {/* Observações */}
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Observações</label>
            <textarea value={obs} onChange={e => setObs(e.target.value.slice(0,300))}
              placeholder="Informações adicionais..." rows={2}
              className="w-full rounded-xl border border-border/50 bg-background px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/30"
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

// ─── Painel de Lançamentos ─────────────────────────────────────────────────

function PainelLancamentos({ tipo, modoTeste }: { tipo: LancamentoFinanceiro["tipo"]; modoTeste: boolean }) {
  const [itens,     setItens]     = useState<LancamentoFinanceiro[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem,  setEditItem]  = useState<LancamentoFinanceiro | null>(null);
  const [delItem,   setDelItem]   = useState<LancamentoFinanceiro | null>(null);
  const [deleting,  setDeleting]  = useState(false);
  const [search,    setSearch]    = useState("");
  const [filtroNF,  setFiltroNF]  = useState<"todos" | LancamentoFinanceiro["status_nf"]>("todos");
  const [showRecorr,setShowRecorr]= useState(false);

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

  const totalMes   = useMemo(() => itens.filter(i => i.data_lancamento.startsWith(mesAtualStr)).reduce((s, i) => s + i.valor, 0), [itens, mesAtualStr]);
  const total      = itens.reduce((s, i) => s + i.valor, 0);
  const totalRecorr= itens.filter(i => i.recorrente).reduce((s, i) => s + i.valor, 0);
  const semNF      = itens.filter(i => i.status_nf === "sem_nf" || i.status_nf === "pendente").length;

  const allCats = [...CATEGORIAS_PRODUCAO, ...CATEGORIAS_EMPRESA, ...CATEGORIAS_CUSTO];

  const itensFiltrados = useMemo(() => itens.filter(i => {
    const matchSearch = !search.trim() ||
      i.descricao.toLowerCase().includes(search.toLowerCase()) ||
      (i.fornecedor ?? "").toLowerCase().includes(search.toLowerCase());
    const matchNF     = filtroNF === "todos" || i.status_nf === filtroNF;
    const matchRecorr = !showRecorr || i.recorrente;
    return matchSearch && matchNF && matchRecorr;
  }), [itens, search, filtroNF, showRecorr]);

  const nfMeta: Record<LancamentoFinanceiro["status_nf"], { bg: string; color: string; border: string; label: string }> = {
    sem_nf:     { bg: "#f1f5f9", color: "#64748b", border: "#cbd5e1", label: "Sem NF"       },
    manual:     { bg: "#f5f3ff", color: "#6d28d9", border: "#c4b5fd", label: "NF Manual"    },
    pendente:   { bg: "#fffbeb", color: "#d97706", border: "#fde68a", label: "NF Pendente"  },
    autorizada: { bg: "#f0fdf4", color: "#15803d", border: "#86efac", label: "NF Autorizada"},
  };

  return (
    <div className="space-y-4">

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Este Mês",   value: fmtCurrency(totalMes),   icon: <CalendarDays size={16} />, bg: "#fff7ed", border: "#fdba74", color: "#c2410c" },
          { label: "Total Geral",value: fmtCurrency(total),       icon: <BarChart3 size={16} />,   bg: "#f8fafc", border: "#cbd5e1", color: "#475569" },
          { label: "Recorrentes",value: fmtCurrency(totalRecorr), icon: <Repeat2 size={16} />,     bg: "#f5f3ff", border: "#c4b5fd", color: "#6d28d9" },
          { label: "Sem NF",     value: `${semNF} lançamentos`,   icon: <AlertTriangle size={16} />,bg: semNF > 0 ? "#fffbeb" : "#f0fdf4", border: semNF > 0 ? "#fde68a" : "#86efac", color: semNF > 0 ? "#d97706" : "#15803d" },
        ].map(k => (
          <div key={k.label} className="rounded-xl p-3 flex items-center gap-3"
            style={{ background: k.bg, border: `1px solid ${k.border}` }}>
            <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: "white", color: k.color, boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
              {k.icon}
            </div>
            <div className="min-w-0">
              <p className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: k.color }}>{k.label}</p>
              <p className="text-[13px] font-black truncate" style={{ color: k.color }}>{k.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={() => { setEditItem(null); setModalOpen(true); }}
          className="h-9 px-4 flex items-center gap-1.5 rounded-xl text-[12px] font-bold text-white transition-colors"
          style={{ background: "#7c3aed", boxShadow: "0 2px 8px rgba(124,58,237,0.3)" }}>
          <PlusCircle size={14} />Novo lançamento
        </button>

        <div className="relative flex-1 min-w-[160px]">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Buscar descrição ou fornecedor…"
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full h-9 pl-8 pr-3 rounded-xl text-[12px] focus:outline-none focus:ring-2 focus:ring-violet-400"
            style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }} />
        </div>

        <select value={filtroNF} onChange={e => setFiltroNF(e.target.value as typeof filtroNF)}
          className="h-9 rounded-xl px-3 text-[12px] font-medium focus:outline-none focus:ring-2 focus:ring-violet-400"
          style={{ background: "#f8fafc", border: "1px solid #e2e8f0", color: "#475569" }}>
          <option value="todos">Todas NFs</option>
          <option value="sem_nf">Sem NF</option>
          <option value="manual">NF Manual</option>
          <option value="pendente">NF Pendente</option>
          <option value="autorizada">NF Autorizada</option>
        </select>

        <button type="button" onClick={() => setShowRecorr(v => !v)}
          className="h-9 px-3 flex items-center gap-1.5 rounded-xl text-[11px] font-semibold transition-colors"
          style={showRecorr
            ? { background: "#ede9fe", color: "#6d28d9", border: "1px solid #c4b5fd" }
            : { background: "#f8fafc", color: "#64748b", border: "1px solid #e2e8f0" }}>
          <Repeat2 size={13} />Recorrentes
        </button>

        <button type="button" onClick={load} disabled={loading}
          className="h-9 w-9 flex items-center justify-center rounded-xl transition-colors"
          style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
          <RefreshCw size={13} color="#64748b" className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Results count */}
      {!loading && itens.length > 0 && (
        <p className="text-[11px] text-gray-400">
          {itensFiltrados.length} de {itens.length} lançamentos
          {search && ` · "${search}"`}
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin h-6 w-6 border-2 border-violet-500 border-t-transparent rounded-full" />
        </div>
      ) : itensFiltrados.length === 0 ? (
        <div className="text-center py-14 space-y-3">
          <div className="h-16 w-16 rounded-2xl mx-auto flex items-center justify-center" style={{ background: "#f1f5f9" }}>
            <ShoppingCart size={28} color="#94a3b8" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-700">
              {itens.length === 0 ? "Nenhum lançamento registrado" : "Nenhum resultado para o filtro"}
            </p>
            <p className="text-[12px] text-gray-400 mt-0.5">
              {itens.length === 0 ? "Clique em 'Novo lançamento' para começar" : "Limpe os filtros para ver todos"}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {itensFiltrados.map(item => {
            const CatIcon = allCats.find(cat => cat.valor === item.categoria)?.icon ?? Package;
            const catLabel = allCats.find(cat => cat.valor === item.categoria)?.label ?? item.categoria;
            const nf = nfMeta[item.status_nf];
            const isMesAtual = item.data_lancamento.startsWith(mesAtualStr);
            return (
              <div key={item.id} className="rounded-xl overflow-hidden flex flex-col transition-shadow hover:shadow-md"
                style={{ border: "1.5px solid #e2e8f0", background: "white", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>

                {/* Topo colorido: mês atual = laranja, antigo = cinza */}
                <div style={{ height: 3, background: isMesAtual ? "#f97316" : "#cbd5e1" }} />

                <div className="p-3 flex-1 space-y-2">
                  {/* Ícone + valor */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: "#f5f3ff" }}>
                        <CatIcon size={15} color="#7c3aed" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[12px] font-bold text-gray-900 truncate">{item.descricao}</p>
                        <p className="text-[10px] text-gray-400">{catLabel}</p>
                      </div>
                    </div>
                    <p className="text-[14px] font-black shrink-0" style={{ color: "#dc2626", fontFamily: "monospace" }}>
                      {fmtCurrency(item.valor)}
                    </p>
                  </div>

                  {/* Metadados */}
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-lg"
                      style={{ background: nf.bg, color: nf.color, border: `1px solid ${nf.border}` }}>
                      {nf.label}
                    </span>
                    {item.recorrente && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-lg flex items-center gap-1"
                        style={{ background: "#f5f3ff", color: "#6d28d9", border: "1px solid #c4b5fd" }}>
                        <Repeat2 size={9} />{item.periodicidade}
                      </span>
                    )}
                    {isMesAtual && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-lg"
                        style={{ background: "#fff7ed", color: "#c2410c", border: "1px solid #fdba74" }}>
                        mês atual
                      </span>
                    )}
                  </div>

                  {/* Fornecedor + data */}
                  <div className="flex items-center justify-between text-[10px] text-gray-400">
                    <span>{item.fornecedor ?? "—"}</span>
                    <span className="font-mono">
                      {new Date(item.data_lancamento + "T12:00:00").toLocaleDateString("pt-BR")}
                    </span>
                  </div>

                  {/* NF info */}
                  {(item.nota_fiscal_manual || item.chave_nfe) && (
                    <div className="rounded-lg px-2 py-1.5" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                      {item.nota_fiscal_manual && (
                        <p className="text-[10px] font-mono text-gray-600">NF: {item.nota_fiscal_manual}</p>
                      )}
                      {item.chave_nfe && (
                        <p className="text-[9px] font-mono text-gray-400 truncate">Chave: {item.chave_nfe.slice(0, 20)}…</p>
                      )}
                    </div>
                  )}

                  {/* Obs */}
                  {item.observacoes && (
                    <p className="text-[10px] text-gray-500 italic line-clamp-2">{item.observacoes}</p>
                  )}
                </div>

                {/* Footer de ações */}
                <div className="flex" style={{ borderTop: "1px solid #f1f5f9" }}>
                  <button type="button" onClick={() => { setEditItem(item); setModalOpen(true); }}
                    className="flex-1 h-8 flex items-center justify-center gap-1.5 text-[11px] font-semibold transition-colors hover:bg-violet-50 text-gray-500 hover:text-violet-700">
                    <Edit3 size={11} />Editar
                  </button>
                  <div style={{ width: 1, background: "#f1f5f9" }} />
                  <button type="button" onClick={() => setDelItem(item)}
                    className="flex-1 h-8 flex items-center justify-center gap-1.5 text-[11px] font-semibold transition-colors hover:bg-red-50 text-gray-400 hover:text-red-600">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-card p-5 space-y-4 shadow-2xl"
            style={{ border: "1.5px solid #e2e8f0" }}>
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "#fef2f2" }}>
                <Trash2 size={18} color="#dc2626" />
              </div>
              <div>
                <p className="text-[14px] font-bold text-gray-900">Excluir lançamento?</p>
                <p className="text-[12px] text-gray-500 mt-0.5">{delItem.descricao}</p>
                <p className="text-[13px] font-bold mt-1" style={{ color: "#dc2626" }}>{fmtCurrency(delItem.valor)}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setDelItem(null)} disabled={deleting}
                className="flex-1 h-9 rounded-xl text-sm font-semibold transition-colors"
                style={{ border: "1px solid #e2e8f0", color: "#64748b" }}>
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

// ─── Painel Bancos & Integração ────────────────────────────────────────────

function PainelBancos({ modoTeste, onToggleModoTeste }: { modoTeste: boolean; onToggleModoTeste: () => void }) {
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
      setToken(c.token_api ?? ""); setEnvioAuto(c.envio_automatico_nf); setIntegAtiva(c.integracao_ativa);
    } else {
      setEditConta(null); setBanco(BANCOS_BR[0]); setAgencia(""); setContaNum("");
      setTipoConta("corrente"); setSaldo(""); setWebhook(""); setToken("");
      setEnvioAuto(false); setIntegAtiva(false);
    }
    setModalOpen(true);
  }

  async function handleSaveConta() {
    if (!banco || !agencia || !contaNum) { toast.error("Banco, agência e conta são obrigatórios."); return; }
    setSaving(true);
    const payload = {
      banco, agencia, conta: contaNum, tipo: tipoConta,
      saldo_atual: parseFloat(saldo) || 0,
      webhook_url: webhook.trim() || null, token_api: token.trim() || null,
      envio_automatico_nf: envioAuto, integracao_ativa: integAtiva,
    };
    try {
      let err;
      if (editConta) {
        ({ error: err } = await supabase.from("financeiro_contas_bancarias").update(payload).eq("id", editConta.id));
      } else {
        ({ error: err } = await supabase.from("financeiro_contas_bancarias").insert(payload));
      }
      if (err) throw err;
      toast.success(editConta ? "Conta atualizada!" : "Conta cadastrada!");
      setModalOpen(false); load();
    } catch { toast.error("Erro ao salvar conta."); }
    finally { setSaving(false); }
  }

  async function testarWebhook(c: ContaBancaria) {
    if (!c.webhook_url) { toast.error("Configure o webhook antes de testar."); return; }
    toast.info("Enviando requisição de teste…");
    try {
      const res = await fetch(c.webhook_url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(c.token_api ? { Authorization: `Bearer ${c.token_api}` } : {}) },
        body: JSON.stringify({ evento: "teste", banco: c.banco, timestamp: new Date().toISOString() }),
      });
      if (res.ok) toast.success(`Webhook OK — HTTP ${res.status}`);
      else toast.error(`Webhook retornou HTTP ${res.status}`);
    } catch { toast.error("Falha ao conectar com o webhook."); }
  }

  return (
    <div className="space-y-4">

      {/* Toggle Modo Teste */}
      <div className={cn("rounded-xl border p-4 flex items-start gap-3",
        modoTeste ? "border-orange-500/30 bg-orange-500/5" : "border-green-500/30 bg-green-500/5")}>
        <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center shrink-0",
          modoTeste ? "bg-orange-500/10" : "bg-green-500/10")}>
          <TestTube2 className={cn("h-5 w-5", modoTeste ? "text-orange-500" : "text-green-600")} />
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">{modoTeste ? "Modo Homologação (Teste)" : "Modo Produção"}</p>
            <button type="button" onClick={onToggleModoTeste}
              className={cn("h-5 w-10 rounded-full transition-colors relative shrink-0",
                modoTeste ? "bg-orange-500" : "bg-green-500")}>
              <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all",
                modoTeste ? "left-0.5" : "left-[calc(100%-18px)]")} />
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            {modoTeste
              ? "Notas simuladas — sem valor fiscal. Ideal para testes e desenvolvimento."
              : "Notas com valor fiscal real, transmitidas ao SEFAZ. Revise todas as configurações antes."}
          </p>
          {!modoTeste && (
            <p className="text-[10px] text-green-600 font-semibold mt-1 flex items-center gap-1">
              <CheckSquare className="h-3 w-3" />Configure SEFAZ_TP_AMB=1 nos secrets da Edge Function para produção.
            </p>
          )}
        </div>
      </div>

      {/* Configuração SEFAZ */}
      <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 text-violet-500" />
          <p className="text-sm font-semibold">Configuração SEFAZ</p>
        </div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          {[
            ["Edge Function", "sefaz-emitir (Supabase)"],
            ["Ambiente",      "SEFAZ_TP_AMB=2 (homologação) ou 1 (produção)"],
            ["Certificado",   "SEFAZ_CERT_PFX (base64 do A1)"],
            ["CNPJ Emitente", "SEFAZ_CNPJ"],
            ["Numeração",     "Sequencial automático via get_next_nf_number()"],
          ].map(([k, v]) => (
            <p key={k}>• <strong>{k}:</strong> <code className="text-violet-500">{v}</code></p>
          ))}
        </div>
        <button type="button"
          onClick={async () => {
            toast.info("Testando conexão com SEFAZ…");
            await new Promise(r => setTimeout(r, 1200));
            toast.success("[TESTE] Conexão com SEFAZ simulada com sucesso.");
          }}
          className="w-full h-8 flex items-center justify-center gap-1.5 rounded-xl border border-violet-500/30 text-violet-600 text-[11px] font-medium hover:bg-violet-500/10 transition-colors mt-1">
          <TestTube2 className="h-3 w-3" />Testar Conexão SEFAZ
        </button>
      </div>

      {/* Contas Bancárias */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[12px] font-semibold flex items-center gap-1.5">
            <Wallet className="h-3.5 w-3.5 text-violet-500" />Contas Bancárias
          </p>
          <button type="button" onClick={() => abrirModal()}
            className="h-7 px-3 flex items-center gap-1 rounded-lg bg-violet-600 text-white text-[10px] font-semibold hover:bg-violet-500 transition-colors">
            <PlusCircle className="h-3 w-3" />Nova conta
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin h-5 w-5 border-2 border-violet-500 border-t-transparent rounded-full" />
          </div>
        ) : contas.length === 0 ? (
          <div className="text-center py-8 space-y-2">
            <Landmark className="h-8 w-8 text-muted-foreground/30 mx-auto" />
            <p className="text-sm text-muted-foreground">Nenhuma conta cadastrada</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {contas.map(c => (
              <div key={c.id} className="rounded-xl border border-border/30 bg-card p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-semibold">{c.banco}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">
                      Ag {c.agencia} · {c.conta} · {c.tipo === "corrente" ? "C/C" : c.tipo === "poupanca" ? "Poupança" : "Pgtos"}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[13px] font-bold">{fmtCurrency(c.saldo_atual)}</p>
                    <div className="flex items-center gap-1 mt-0.5 justify-end">
                      {c.integracao_ativa && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 border border-green-500/20">Integrado</span>
                      )}
                      {c.envio_automatico_nf && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-600 border border-violet-500/20">NF Auto</span>
                      )}
                    </div>
                  </div>
                </div>
                {c.webhook_url && (
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Link className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate font-mono">{c.webhook_url}</span>
                  </div>
                )}
                <div className="flex gap-1">
                  <button type="button" onClick={() => abrirModal(c)}
                    className="flex-1 h-7 flex items-center justify-center gap-1 rounded-lg bg-muted/30 hover:bg-muted/60 text-[10px] text-muted-foreground transition-colors">
                    <Edit3 className="h-2.5 w-2.5" />Editar
                  </button>
                  <button type="button" onClick={() => testarWebhook(c)}
                    className="flex-1 h-7 flex items-center justify-center gap-1 rounded-lg bg-violet-500/10 hover:bg-violet-500/20 text-[10px] text-violet-600 transition-colors">
                    <TestTube2 className="h-2.5 w-2.5" />Testar Webhook
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal Conta */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-card border border-border/30 shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in slide-in-from-bottom-4 duration-200">
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
                  className="w-full h-9 rounded-xl border border-border/50 bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30">
                  {BANCOS_BR.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Agência *</label>
                  <input type="text" value={agencia} onChange={e => setAgencia(e.target.value.slice(0,10))} placeholder="0000-0"
                    className="w-full h-9 rounded-xl border border-border/50 bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Conta *</label>
                  <input type="text" value={contaNum} onChange={e => setContaNum(e.target.value.slice(0,20))} placeholder="00000-0"
                    className="w-full h-9 rounded-xl border border-border/50 bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30" />
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
                  className="w-full h-9 rounded-xl border border-border/50 bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30" />
              </div>
              <div className="border-t border-border/20 pt-3 space-y-3">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                  <Link className="h-2.5 w-2.5" />Integração Bancária
                </p>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Webhook URL</label>
                  <input type="url" value={webhook} onChange={e => setWebhook(e.target.value.slice(0,300))}
                    placeholder="https://api.banco.com.br/webhooks/nf"
                    className="w-full h-9 rounded-xl border border-border/50 bg-background px-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Token / Bearer API</label>
                  <input type="password" value={token} onChange={e => setToken(e.target.value.slice(0,300))}
                    placeholder="Bearer token ou chave API"
                    className="w-full h-9 rounded-xl border border-border/50 bg-background px-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30" />
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
                        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all",
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

// ─── Histórico NF Modal ────────────────────────────────────────────────────

function HistoricoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("pedidos_comerciais")
      .select(`
        id, vendedora_id, vendedora_nome, status, frete, observacoes,
        nota_fiscal, protocolo_sefaz, chave_acesso_nfe, xml_nfe, desconto_pct,
        created_at, separado_em, nf_criada_em, enviado_em,
        clientes!inner(nome, documento),
        pedido_itens(id, stock_item_id, lote, quantidade,
          stock_items!inner(devices!inner(model, reference)))
      `)
      .in("status", ["faturado", "enviado"])
      .order("nf_criada_em", { ascending: false })
      .limit(50);

    if (!error && data) {
      setPedidos((data as Record<string, unknown>[]).map(p => {
        const cli = p.clientes as { nome: string; documento?: string };
        return {
          id: p.id as string,
          cliente_nome: cli.nome, cliente_documento: cli.documento,
          vendedora_nome: p.vendedora_nome as string | null,
          vendedora_id:   p.vendedora_id   as string | null,
          status: p.status as string, frete: (p.frete as number) ?? 0,
          observacoes: p.observacoes as string | null,
          nota_fiscal: p.nota_fiscal as string | null,
          protocolo_sefaz: p.protocolo_sefaz as string | null,
          chave_acesso_nfe: p.chave_acesso_nfe as string | null,
          xml_nfe: p.xml_nfe as string | null,
          desconto_pct: (p.desconto_pct as number) ?? 0,
          created_at: p.created_at as string,
          separado_em: p.separado_em as string | null,
          nf_criada_em: p.nf_criada_em as string | null,
          enviado_em: p.enviado_em as string | null,
          itens: ((p.pedido_itens as Record<string, unknown>[]) ?? []).map((i: Record<string, unknown>) => ({
            id: i.id as string, stock_item_id: i.stock_item_id as string,
            lote: i.lote as string, quantidade: i.quantidade as number,
            device_model: ((i.stock_items as { devices: { model: string } } | null)?.devices?.model),
          })),
        };
      }));
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (open) load(); else setPedidos([]); }, [open, load]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-card border border-border/30 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in slide-in-from-bottom-4 duration-200">
        <div className="relative px-5 pt-5 pb-3 shrink-0 border-b border-border/20">
          <div className="absolute inset-0 bg-gradient-to-b from-violet-500/5 to-transparent" />
          <div className="relative flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold flex items-center gap-2">
                <History className="h-4 w-4 text-violet-500" />Histórico SEFAZ
              </p>
              <p className="text-[12px] text-muted-foreground mt-0.5">Últimas {pedidos.length} notas</p>
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
        </div>
        <div className="px-3 pb-4 pt-2 overflow-y-auto flex-1 space-y-1">
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

// ─── Página Principal ──────────────────────────────────────────────────────

type FinTab = "nfe" | "compras_producao" | "compras_empresa" | "custos" | "bancos";

export default function Financeiro() {
  const navigate = useNavigate();
  const { isAdmin, role } = useAuth();

  const [pedidos,       setPedidos]       = useState<Pedido[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [filtroStatus,  setFiltroStatus]  = useState("pronto");
  const [sefazPedido,   setSefazPedido]   = useState<Pedido | null>(null);
  const [historicoOpen, setHistoricoOpen] = useState(false);
  const [activeTab,     setActiveTab]     = useState<FinTab>("nfe");
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

  const [isDark, setIsDark] = useState(() => {
    const t = getStoredTheme();
    return t === "system" ? window.matchMedia("(prefers-color-scheme: dark)").matches : t === "dark";
  });

  const toggleTheme = useCallback(() => {
    setIsDark(v => { applyTheme(!v ? "dark" : "light"); return !v; });
  }, []);

  const canAccess = isAdmin || role === "financeiro";
  const abortRef  = useRef<AbortController | null>(null);

  const loadPedidos = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);

    const { data, error } = await supabase
      .from("pedidos_comerciais")
      .select(`
        id, vendedora_id, vendedora_nome, status, frete, observacoes,
        nota_fiscal, protocolo_sefaz, chave_acesso_nfe, xml_nfe, desconto_pct,
        created_at, separado_em, nf_criada_em, enviado_em,
        clientes!inner(nome, documento, telefone, email, endereco),
        pedido_itens(
          id, stock_item_id, lote, quantidade,
          stock_items!inner(devices!inner(model, reference))
        )
      `)
      .in("status", ["pronto", "faturado", "enviado"])
      .order("created_at", { ascending: false })
      .abortSignal(ctrl.signal);

    if (ctrl.signal.aborted) return;
    if (!error && data) {
      setPedidos((data as Record<string, unknown>[]).map(p => {
        const cli = p.clientes as { nome: string; documento?: string; telefone?: string; email?: string; endereco?: string };
        return {
          id: p.id as string,
          cliente_nome: cli.nome, cliente_documento: cli.documento,
          cliente_telefone: cli.telefone, cliente_email: cli.email, cliente_endereco: cli.endereco,
          vendedora_nome: p.vendedora_nome as string | null,
          vendedora_id:   p.vendedora_id   as string | null,
          status: p.status as string, frete: (p.frete as number) ?? 0,
          observacoes: p.observacoes as string | null,
          nota_fiscal: p.nota_fiscal as string | null,
          protocolo_sefaz: p.protocolo_sefaz as string | null,
          chave_acesso_nfe: p.chave_acesso_nfe as string | null,
          xml_nfe: p.xml_nfe as string | null,
          desconto_pct: (p.desconto_pct as number) ?? 0,
          created_at: p.created_at as string,
          separado_em: p.separado_em as string | null,
          nf_criada_em: p.nf_criada_em as string | null,
          enviado_em: p.enviado_em as string | null,
          itens: ((p.pedido_itens as Record<string, unknown>[]) ?? []).map((i: Record<string, unknown>) => ({
            id: i.id as string, stock_item_id: i.stock_item_id as string,
            lote: i.lote as string, quantidade: i.quantidade as number,
            desconto_pct: (i.desconto_pct as number) ?? 0,
            device_model: ((i.stock_items as { devices: { model: string; reference: string } } | null)?.devices?.model),
            device_reference: ((i.stock_items as { devices: { model: string; reference: string } } | null)?.devices?.reference),
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

  // KPIs calculados
  const filtrados = filtroStatus === "todos" ? pedidos : pedidos.filter(p => p.status === filtroStatus);
  const filtradosSearch = searchNF.trim()
    ? filtrados.filter(p =>
        p.cliente_nome.toLowerCase().includes(searchNF.toLowerCase()) ||
        (p.nota_fiscal ?? "").toLowerCase().includes(searchNF.toLowerCase()) ||
        (p.vendedora_nome ?? "").toLowerCase().includes(searchNF.toLowerCase())
      )
    : filtrados;
  const prontos   = pedidos.filter(p => p.status === "pronto").length;
  const faturados = pedidos.filter(p => p.status === "faturado").length;
  const enviados  = pedidos.filter(p => p.status === "enviado").length;

  // Totais financeiros
  const totalReceita = useMemo(() =>
    pedidos.filter(p => p.status === "faturado" || p.status === "enviado")
      .reduce((s, p) => s + p.itens.reduce((si, i) => si + i.quantidade, 0), 0),
    [pedidos]
  );
  const totalCustos = useMemo(() =>
    lancamentos.reduce((s, l) => s + l.valor, 0),
    [lancamentos]
  );
  const receitaEstimada = useMemo(() =>
    pedidos.filter(p => p.status === "faturado" || p.status === "enviado").length,
    [pedidos]
  );
  const mesAtual = new Date().toISOString().slice(0, 7);
  const custosMes = useMemo(() =>
    lancamentos.filter(l => l.data_lancamento.startsWith(mesAtual)).reduce((s, l) => s + l.valor, 0),
    [lancamentos, mesAtual]
  );

  // Loading skeleton — evita tela em branco na primeira carga
  if (loading && pedidos.length === 0) {
    return (
      <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
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
    { id: "nfe",              label: "NF-e / SEFAZ",    icon: FileCheck2, badge: prontos },
    { id: "compras_producao", label: "Compras Produção", icon: Factory      },
    { id: "compras_empresa",  label: "Compras Empresa",  icon: Building2    },
    { id: "custos",           label: "Custos",           icon: Zap          },
    { id: "bancos",           label: "Bancos",           icon: Landmark     },
  ];

  return (
    <div className="min-h-screen" style={{ background: "#f8fafc" }}>
      <header className="sticky top-0 z-30 bg-white dark:bg-background border-b"
        style={{ borderColor: "#e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => navigate("/")}
              className="h-8 w-8 flex items-center justify-center rounded-lg transition-colors"
              style={{ border: "1px solid #e2e8f0" }}>
              <ArrowLeft size={15} color="#64748b" />
            </button>
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg flex items-center justify-center" style={{ background: "#f5f3ff" }}>
                <Receipt size={15} color="#7c3aed" />
              </div>
              <div>
                <h1 className="text-[13px] font-bold text-gray-900 dark:text-foreground leading-tight">Financeiro</h1>
                <p className="text-[10px] text-gray-400 leading-tight">Sistema de gestão fiscal</p>
              </div>
              <TestBadge modoTeste={modoTeste} />
            </div>
            {prontos > 0 && (
              <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: "#f0fdf4", color: "#15803d", border: "1px solid #86efac" }}>
                {prontos} aguardando NF
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={toggleTheme}
              className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors">
              {isDark
                ? <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
                : <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>}
            </button>
            <button type="button" onClick={() => setHistoricoOpen(true)}
              className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
              title="Histórico SEFAZ">
              <History size={15} color="#64748b" />
            </button>
            <button type="button" onClick={() => { loadPedidos(); loadLancamentos(); }}
              className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
              title="Atualizar dados">
              <RefreshCw size={15} color="#64748b" className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="max-w-7xl mx-auto px-4 pb-0">
          <div className="flex items-center gap-0 overflow-x-auto border-t" style={{ scrollbarWidth: "none", borderColor: "#f1f5f9" }}>
            {TABS.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
                  className="flex items-center gap-1.5 h-10 px-4 text-[11px] font-semibold whitespace-nowrap transition-all shrink-0 relative"
                  style={{
                    color: isActive ? "#7c3aed" : "#64748b",
                    borderBottom: isActive ? "2px solid #7c3aed" : "2px solid transparent",
                    marginBottom: "-1px",
                  }}>
                  <Icon size={13} />
                  {tab.label}
                  {tab.badge && tab.badge > 0 ? (
                    <span className="min-w-[16px] h-4 rounded-full text-[9px] font-bold px-1 flex items-center justify-center"
                      style={isActive
                        ? { background: "#ede9fe", color: "#7c3aed" }
                        : { background: "#dcfce7", color: "#15803d" }}>
                      {tab.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-5 space-y-5">

        {/* ─── NF-e / SEFAZ ─────────────────────────────────── */}
        {activeTab === "nfe" && (
          <>
            {/* KPI strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Aguardando NF", value: prontos,   icon: <Receipt size={18} />,      bg: "#f0fdf4", border: "#86efac", color: "#15803d" },
                { label: "Faturados",     value: faturados, icon: <FileCheck2 size={18} />,   bg: "#f5f3ff", border: "#c4b5fd", color: "#6d28d9" },
                { label: "Enviados",      value: enviados,  icon: <Send size={18} />,          bg: "#f0f9ff", border: "#7dd3fc", color: "#0369a1" },
                { label: "Custos/mês",    value: fmtCurrency(custosMes), icon: <TrendingDown size={18} />, bg: "#fff7ed", border: "#fdba74", color: "#c2410c", isText: true },
              ].map(kpi => (
                <div key={kpi.label} className="rounded-2xl p-4 flex items-start gap-3"
                  style={{ background: kpi.bg, border: `1.5px solid ${kpi.border}` }}>
                  <div className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: "white", color: kpi.color, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                    {kpi.icon}
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: kpi.color }}>{kpi.label}</p>
                    <p className="text-2xl font-black tabular-nums" style={{ color: kpi.color }}>{kpi.value}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Filtros + busca */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1 flex-wrap">
                {[
                  { id: "pronto",  label: "Aguardando NF", count: prontos },
                  { id: "faturado",label: "Faturados",      count: faturados },
                  { id: "enviado", label: "Enviados",        count: enviados },
                  { id: "todos",   label: "Todos",           count: pedidos.length },
                ].map(f => (
                  <button key={f.id} type="button" onClick={() => setFiltroStatus(f.id)}
                    className="h-8 px-3 rounded-xl text-[11px] font-semibold border transition-all flex items-center gap-1.5"
                    style={filtroStatus === f.id
                      ? { background: "#7c3aed", color: "white", border: "1px solid #7c3aed" }
                      : { background: "#f8fafc", color: "#64748b", border: "1px solid #e2e8f0" }}>
                    {f.label}
                    <span className="text-[10px] px-1 rounded-md"
                      style={filtroStatus === f.id
                        ? { background: "rgba(255,255,255,0.2)" }
                        : { background: "#e2e8f0" }}>
                      {f.count}
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex-1 min-w-[180px] relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar cliente, NF ou vendedora…"
                  value={searchNF}
                  onChange={e => setSearchNF(e.target.value)}
                  className="w-full h-8 pl-8 pr-3 rounded-xl text-[12px] focus:outline-none focus:ring-2"
                  style={{ background: "#f8fafc", border: "1px solid #e2e8f0", focusRingColor: "#7c3aed" }}
                />
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin h-6 w-6 border-2 border-violet-500 border-t-transparent rounded-full" />
              </div>
            ) : filtradosSearch.length === 0 ? (
              <div className="text-center py-16 space-y-3">
                <div className="h-16 w-16 rounded-2xl mx-auto flex items-center justify-center" style={{ background: "#f1f5f9" }}>
                  <Receipt size={28} color="#94a3b8" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-700">
                    {filtroStatus === "pronto" ? "Nenhum pedido aguardando nota fiscal" : "Nenhum pedido encontrado"}
                  </p>
                  <p className="text-[12px] text-gray-400 mt-0.5">
                    {searchNF ? "Tente outra busca" : "Os pedidos aparecem aqui quando marcados como prontos no estoque"}
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {filtradosSearch.map(p => <PedidoCard key={p.id} pedido={p} onEmitirNF={setSefazPedido} />)}
              </div>
            )}
          </>
        )}

        {/* ─── Compras Produção ─────────────────────────────── */}
        {activeTab === "compras_producao" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-gray-900 dark:text-foreground flex items-center gap-2">
                  <Factory size={18} color="#7c3aed" />Compras — Produção
                </h2>
                <p className="text-[12px] text-gray-500 mt-0.5">
                  Máquinas, matérias-primas, insumos e materiais de produção
                </p>
              </div>
            </div>
            <PainelLancamentos tipo="compra_producao" modoTeste={modoTeste} />
          </div>
        )}

        {/* ─── Compras Empresa ─────────────────────────────── */}
        {activeTab === "compras_empresa" && (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-bold text-gray-900 dark:text-foreground flex items-center gap-2">
                <Building2 size={18} color="#7c3aed" />Compras — Empresa
              </h2>
              <p className="text-[12px] text-gray-500 mt-0.5">
                Computadores, mobiliário, materiais de escritório e ativos permanentes
              </p>
            </div>
            <PainelLancamentos tipo="compra_empresa" modoTeste={modoTeste} />
          </div>
        )}

        {/* ─── Custos Operacionais ─────────────────────────── */}
        {activeTab === "custos" && (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-bold text-gray-900 dark:text-foreground flex items-center gap-2">
                <Zap size={18} color="#7c3aed" />Custos Operacionais
              </h2>
              <p className="text-[12px] text-gray-500 mt-0.5">
                Energia, aluguel, serviços recorrentes e custos fixos e variáveis
              </p>
            </div>
            {/* KPI de custos do mês */}
            <div className="grid grid-cols-3 gap-3">
              {["compra_producao","compra_empresa","custo_operacional"].map((tipo, i) => {
                const labels = ["Produção", "Empresa", "Operacional"];
                const colors = ["#7c3aed","#0369a1","#c2410c"];
                const bgs    = ["#f5f3ff","#f0f9ff","#fff7ed"];
                const borders= ["#c4b5fd","#7dd3fc","#fdba74"];
                const total  = lancamentos.filter(l => l.tipo === tipo).reduce((s, l) => s + l.valor, 0);
                return (
                  <div key={tipo} className="rounded-xl p-3 text-center" style={{ background: bgs[i], border: `1px solid ${borders[i]}` }}>
                    <p className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: colors[i] }}>{labels[i]}</p>
                    <p className="text-[15px] font-black" style={{ color: colors[i] }}>{fmtCurrency(total)}</p>
                  </div>
                );
              })}
            </div>
            <PainelLancamentos tipo="custo_operacional" modoTeste={modoTeste} />
          </div>
        )}

        {/* ─── Bancos & Integração ─────────────────────────── */}
        {activeTab === "bancos" && (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-bold text-gray-900 dark:text-foreground flex items-center gap-2">
                <Landmark size={18} color="#7c3aed" />Bancos & Integração SEFAZ
              </h2>
              <p className="text-[12px] text-gray-500 mt-0.5">
                Contas bancárias, webhooks e configuração do ambiente SEFAZ
              </p>
            </div>
            <PainelBancos modoTeste={modoTeste} onToggleModoTeste={toggleModoTeste} />
          </div>
        )}
      </main>

      <SefazModal
        pedido={sefazPedido}
        onClose={() => setSefazPedido(null)}
        onSuccess={loadPedidos}
        modoTeste={modoTeste}
      />
      <HistoricoModal open={historicoOpen} onClose={() => setHistoricoOpen(false)} />
    </div>
  );
}
