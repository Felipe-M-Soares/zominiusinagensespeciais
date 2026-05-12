/**
 * src/pages/Financeiro.tsx
 *
 * Módulo Financeiro — Emissão NF-e / NFC-e via SEFAZ
 * Mantém 100% do design e mecânica do projeto original.
 *
 * Fluxo:
 *  Pedido "pronto" → financeiro clica "Emitir NF" → wizard 5 passos →
 *  Edge Function sefaz-emitir → protocolo salvo → status "enviado" →
 *  vendedora notificada
 */

import {
  useState, useEffect, useCallback, useRef,
} from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { getStoredTheme, applyTheme } from "@/pages/Settings";
import {
  ArrowLeft, Receipt, CheckCircle2, Package, User, Clock,
  Truck, Tag, ChevronDown, ChevronUp, Send, X, RefreshCw,
  FileText, History, BadgeCheck, Ban, Bell, FileCheck2,
  AlertCircle, Building2, Hash, DollarSign, CreditCard,
  Banknote, Landmark, ChevronRight, Info, Loader2, MapPin,
  Mail, Percent,
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
}

// ─── Constantes ────────────────────────────────────────────────────────────

const TIPOS_PAGAMENTO = [
  { valor: "01", label: "Dinheiro",         icon: Banknote   },
  { valor: "03", label: "Cartão Crédito",   icon: CreditCard },
  { valor: "04", label: "Cartão Débito",    icon: CreditCard },
  { valor: "17", label: "PIX",              icon: DollarSign },
  { valor: "15", label: "Boleto",           icon: Landmark   },
  { valor: "99", label: "Outros",           icon: DollarSign },
];

const MOD_FRETE = [
  { valor: "9", label: "Sem frete"                         },
  { valor: "0", label: "Por conta do emitente (CIF)"       },
  { valor: "1", label: "Por conta do destinatário (FOB)"   },
  { valor: "2", label: "Por conta de terceiros"            },
];

const STEP_LABELS = ["Tipo NF", "Destinatário", "Itens Fiscais", "Pagamento", "Revisar"];

// ─── Helpers ───────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
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
  if (s === "enviado")  return "bg-success/10     text-success     border-success/20";
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

function initDados(pedido: Pedido): DadosFiscais {
  return {
    tipoNota: "nfe",
    numero: "",
    serie: "1",
    naturezaOperacao: "VENDA DE MERCADORIA",
    destDocumento: pedido.cliente_documento ?? "",
    destNome:      pedido.cliente_nome ?? "",
    destEmail:     pedido.cliente_email ?? "",
    destEndereco:  pedido.cliente_endereco ?? "",
    itens: pedido.itens.map(item => ({
      pedido_item_id: item.id,
      descricao:      item.device_model ?? "Produto",
      ncm:            item.ncm  ?? "90213990",   // NCM implantes dentários
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
            {i + 1 < step
              ? <CheckCircle2 className="h-3.5 w-3.5" />
              : <span>{i + 1}</span>}
          </div>
          <span className={cn(
            "text-[9px] ml-1 font-medium hidden sm:block shrink-0",
            i + 1 === step ? "text-violet-600" : "text-muted-foreground/60"
          )}>
            {labels[i]}
          </span>
          {i < total - 1 && (
            <div className={cn(
              "h-px flex-1 mx-1.5 transition-colors duration-300",
              i + 1 < step ? "bg-violet-500" : "bg-border/40"
            )} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Modal SEFAZ (wizard 5 passos) ─────────────────────────────────────────

function SefazModal({
  pedido, onClose, onSuccess,
}: { pedido: Pedido | null; onClose: () => void; onSuccess: () => void }) {
  const { user } = useAuth();
  const [step,       setStep]       = useState(1);
  const [saving,     setSaving]     = useState(false);
  const [lastResult, setLastResult] = useState<SefazResult | null>(null);
  const [dados,      setDados]      = useState<DadosFiscais | null>(null);
  const submitting = useRef(false);

  // Inicializa/reseta ao abrir
  useEffect(() => {
    if (pedido) {
      setStep(1);
      setLastResult(null);
      setDados(initDados(pedido));
    } else {
      setDados(null);
    }
  }, [pedido]);

  // Recalcula total quando itens ou frete mudam
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
      parseFloat(it.valorUnitario) > 0
    );
    if (step === 4) return !!dados.tipoPagamento;
    return true;
  }

  async function handleEmitir() {
    if (!pedido || !user || !dados) return;
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setLastResult(null);

    try {
      // 1. Chama Edge Function sefaz-emitir
      const { data, error } = await supabase.functions.invoke("sefaz-emitir", {
        body: { pedidoId: pedido.id, dadosFiscais: dados },
      });

      if (error) throw new Error(error.message);

      const result = data as SefazResult;
      setLastResult(result);

      if (!result.sucesso) {
        const msg = result.xMotivo
          ? `SEFAZ cStat ${result.cStat}: ${result.xMotivo}`
          : result.erro ?? "Nota rejeitada pelo SEFAZ";
        toast.error(msg, { duration: 8000 });
        return;
      }

      // 2. Persiste resultado atomicamente
      const nfLabel = `${dados.tipoNota.toUpperCase()}-${dados.numero.padStart(9,"0")}`;
      const { data: rpc, error: rpcErr } = await supabase.rpc("faturar_pedido_sefaz", {
        p_pedido_id:      pedido.id,
        p_nf:             nfLabel,
        p_chave_acesso:   result.chaveAcesso ?? "",
        p_protocolo:      result.protocolo   ?? "",
        p_dh_autorizacao: result.dhAutorizacao ?? new Date().toISOString(),
        p_user_id:        user.id,
        p_user_name:      "Financeiro",
      } as Record<string, unknown>);

      if (rpcErr) {
        toast.error(`NF autorizada, mas erro ao salvar: ${rpcErr.message}`);
        logger.error("faturar_pedido_sefaz:", rpcErr);
        return;
      }

      const rpcData = rpc as { error?: string } | null;
      if (rpcData?.error) {
        toast.error(`Erro ao salvar: ${rpcData.error}`);
        return;
      }

      // 3. Notifica vendedora
      if (pedido.vendedora_id) {
        await supabase.from("notificacoes").insert({
          user_id:   pedido.vendedora_id,
          pedido_id: pedido.id,
          tipo:      "pedido_enviado",
          titulo:    "Pedido faturado e enviado! 🚚",
          mensagem:  `${pedido.cliente_nome} — ${nfLabel} — Prot. ${result.protocolo}`,
        }).then(({ error: ne }) => {
          if (ne) logger.warn("Erro ao criar notificação:", ne.message);
        });
      }

      toast.success(`✅ ${dados.tipoNota.toUpperCase()} autorizada! Protocolo ${result.protocolo}`, { duration: 6000 });
      onClose();
      onSuccess();

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      toast.error(`Erro ao emitir NF: ${msg}`);
      logger.error("SefazModal handleEmitir:", err);
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  const totalItens = pedido.itens.reduce((s, i) => s + i.quantidade, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-card border border-border/30 shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in slide-in-from-bottom-4 duration-200">

        {/* Cabeçalho */}
        <div className="px-5 pt-5 pb-3 border-b border-border/20 shrink-0 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileCheck2 className="h-4 w-4 text-violet-500" />
              <span className="text-sm font-semibold">
                Emissão {dados.tipoNota === "nfce" ? "NFC-e" : "NF-e"} — SEFAZ
              </span>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-orange-500/40 bg-orange-500/8 text-orange-500">
                Homologação
              </span>
            </div>
            <button
              type="button" onClick={onClose} disabled={saving}
              className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground disabled:opacity-40"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Resumo do pedido */}
          <div className="flex items-center gap-3 rounded-xl border border-border/30 bg-muted/15 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold truncate">{pedido.cliente_nome}</p>
              <p className="text-[10px] text-muted-foreground">
                {totalItens} un. · Frete R$ {pedido.frete.toFixed(2)}
              </p>
            </div>
            <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0", statusColor(pedido.status))}>
              {statusLabel(pedido.status)}
            </span>
          </div>

          <StepBar step={step} total={5} labels={STEP_LABELS} />
        </div>

        {/* Conteúdo */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {/* ── PASSO 1: Tipo e Número ── */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tipo e Identificação</p>

              <div className="grid grid-cols-2 gap-2">
                {(["nfe", "nfce"] as const).map(tipo => (
                  <button key={tipo} type="button"
                    onClick={() => upd("tipoNota", tipo)}
                    className={cn(
                      "rounded-xl border p-3 text-left transition-all",
                      dados.tipoNota === tipo
                        ? "border-violet-500/50 bg-violet-500/10 ring-1 ring-violet-500/30"
                        : "border-border/40 bg-muted/15 hover:bg-muted/35"
                    )}
                  >
                    <p className="text-[13px] font-bold">{tipo === "nfe" ? "NF-e" : "NFC-e"}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {tipo === "nfe" ? "Modelo 55 · B2B" : "Modelo 65 · Consumidor"}
                    </p>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2 space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                    Número da NF *
                  </label>
                  <div className="relative">
                    <Hash className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                    <input
                      autoFocus type="text" inputMode="numeric"
                      value={dados.numero}
                      onChange={e => upd("numero", e.target.value.replace(/\D/g,"").slice(0,9))}
                      placeholder="000000001"
                      className="w-full h-9 rounded-xl border border-border/50 bg-background pl-7 pr-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Série</label>
                  <input type="text" inputMode="numeric"
                    value={dados.serie}
                    onChange={e => upd("serie", e.target.value.replace(/\D/g,"").slice(0,3))}
                    placeholder="1"
                    className="w-full h-9 rounded-xl border border-border/50 bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  Natureza da Operação *
                </label>
                <input type="text"
                  value={dados.naturezaOperacao}
                  onChange={e => upd("naturezaOperacao", e.target.value.slice(0,60).toUpperCase())}
                  placeholder="VENDA DE MERCADORIA"
                  className="w-full h-9 rounded-xl border border-border/50 bg-background px-3 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50"
                />
              </div>

              <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 flex items-start gap-2">
                <Info className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Notas emitidas em <strong>Homologação</strong> não têm valor fiscal.
                  Para produção, altere <code className="text-violet-500">SEFAZ_TP_AMB=1</code> nos secrets da Edge Function.
                </p>
              </div>
            </div>
          )}

          {/* ── PASSO 2: Destinatário ── */}
          {step === 2 && (
            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Dados do Destinatário</p>

              <div className="space-y-1">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  Nome / Razão Social *
                </label>
                <div className="relative">
                  <Building2 className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <input autoFocus type="text"
                    value={dados.destNome}
                    onChange={e => upd("destNome", e.target.value.slice(0,60).toUpperCase())}
                    placeholder="RAZÃO SOCIAL OU NOME COMPLETO"
                    className="w-full h-9 rounded-xl border border-border/50 bg-background pl-7 pr-3 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  CPF / CNPJ
                </label>
                <input type="text" inputMode="numeric"
                  value={dados.destDocumento}
                  onChange={e => upd("destDocumento", e.target.value.replace(/\D/g,"").slice(0,14))}
                  placeholder="000.000.000-00 ou 00.000.000/0000-00"
                  className="w-full h-9 rounded-xl border border-border/50 bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50"
                />
                {dados.destDocumento.length > 0 && (
                  <p className="text-[10px] text-muted-foreground pl-1">
                    {mascararDoc(dados.destDocumento)}
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                  <Mail className="h-2.5 w-2.5" />E-mail
                </label>
                <input type="email"
                  value={dados.destEmail}
                  onChange={e => upd("destEmail", e.target.value.slice(0,60))}
                  placeholder="cliente@email.com"
                  className="w-full h-9 rounded-xl border border-border/50 bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                  <MapPin className="h-2.5 w-2.5" />Endereço
                </label>
                <input type="text"
                  value={dados.destEndereco}
                  onChange={e => upd("destEndereco", e.target.value.slice(0,100))}
                  placeholder="Rua, número, bairro, cidade — UF, CEP"
                  className="w-full h-9 rounded-xl border border-border/50 bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50"
                />
              </div>

              {dados.tipoNota === "nfce" && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 flex items-start gap-2">
                  <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Na <strong>NFC-e</strong> o destinatário é opcional. Sem CPF, a nota sairá para consumidor não identificado.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── PASSO 3: Itens Fiscais ── */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Dados Fiscais por Item ({dados.itens.length})
              </p>

              {dados.itens.map((item, idx) => {
                const vTotal = item.quantidade * (parseFloat(item.valorUnitario) || 0);
                const ncmOk  = item.ncm.replace(/\D/g,"").length >= 8;
                const cfopOk = item.cfop.replace(/\D/g,"").length >= 4;
                const vlrOk  = parseFloat(item.valorUnitario) > 0;
                return (
                  <div key={item.pedido_item_id}
                    className={cn(
                      "rounded-xl border p-3 space-y-2.5 transition-colors",
                      ncmOk && cfopOk && vlrOk ? "border-border/30 bg-muted/10" : "border-amber-500/30 bg-amber-500/4"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <div className="h-6 w-6 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                        <Package className="h-3 w-3 text-violet-500" />
                      </div>
                      <p className="text-[11px] font-semibold truncate flex-1">{item.descricao}</p>
                      <span className="text-[10px] text-muted-foreground shrink-0">{item.quantidade} un.</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide">
                          NCM (8 dígitos) *
                        </label>
                        <input type="text" inputMode="numeric"
                          value={item.ncm}
                          onChange={e => updItem(idx, "ncm", e.target.value.replace(/\D/g,"").slice(0,8))}
                          placeholder="90213990"
                          className={cn(
                            "w-full h-8 rounded-lg border bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-violet-500/40",
                            ncmOk ? "border-border/50" : "border-amber-500/60 bg-amber-500/4"
                          )}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide">
                          CFOP (4 dígitos) *
                        </label>
                        <input type="text" inputMode="numeric"
                          value={item.cfop}
                          onChange={e => updItem(idx, "cfop", e.target.value.replace(/\D/g,"").slice(0,4))}
                          placeholder="5102"
                          className={cn(
                            "w-full h-8 rounded-lg border bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-violet-500/40",
                            cfopOk ? "border-border/50" : "border-amber-500/60 bg-amber-500/4"
                          )}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <label className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide">
                          Vlr. Unit. *
                        </label>
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground">R$</span>
                          <input type="number" min="0" step="0.01"
                            value={item.valorUnitario}
                            onChange={e => updItem(idx, "valorUnitario", e.target.value)}
                            className={cn(
                              "w-full h-8 rounded-lg border bg-background pl-5 pr-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-violet-500/40",
                              vlrOk ? "border-border/50" : "border-amber-500/60 bg-amber-500/4"
                            )}
                          />
                        </div>
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
                        <select
                          value={item.cst}
                          onChange={e => updItem(idx, "cst", e.target.value)}
                          className="w-full h-8 rounded-lg border border-border/50 bg-background px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                        >
                          <option value="00">00 — Tributado</option>
                          <option value="20">20 — Red. BC</option>
                          <option value="40">40 — Isento</option>
                          <option value="41">41 — Não trib.</option>
                          <option value="60">60 — ICMS-ST</option>
                        </select>
                      </div>
                    </div>

                    {vTotal > 0 && (
                      <div className="text-right text-[10px] font-mono font-semibold text-violet-500">
                        = R$ {vTotal.toFixed(2)}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Frete */}
              <div className="flex items-center justify-between rounded-xl border border-border/30 bg-background/60 px-3 py-2">
                <span className="text-[11px] text-muted-foreground">Frete (R$)</span>
                <input type="number" min="0" step="0.01"
                  value={dados.valorFrete}
                  onChange={e => upd("valorFrete", e.target.value)}
                  className="w-24 h-7 rounded-lg border border-border/50 bg-background px-2 text-xs font-mono text-right focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                />
              </div>

              {/* Total geral */}
              <div className="flex items-center justify-between rounded-xl border border-violet-500/25 bg-violet-500/8 px-3 py-2.5">
                <span className="text-[13px] font-semibold">Total NF</span>
                <span className="text-[15px] font-bold text-violet-600 font-mono">
                  R$ {dados.valorTotal}
                </span>
              </div>
            </div>
          )}

          {/* ── PASSO 4: Pagamento e Frete ── */}
          {step === 4 && (
            <div className="space-y-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Pagamento e Transporte
              </p>

              <div className="space-y-2">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  Forma de Pagamento *
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {TIPOS_PAGAMENTO.map(tp => {
                    const Icon = tp.icon;
                    return (
                      <button key={tp.valor} type="button"
                        onClick={() => upd("tipoPagamento", tp.valor)}
                        className={cn(
                          "flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-all",
                          dados.tipoPagamento === tp.valor
                            ? "border-violet-500/50 bg-violet-500/10 ring-1 ring-violet-500/20"
                            : "border-border/40 bg-muted/15 hover:bg-muted/35"
                        )}
                      >
                        <Icon className={cn("h-3.5 w-3.5 shrink-0",
                          dados.tipoPagamento === tp.valor ? "text-violet-500" : "text-muted-foreground"
                        )} />
                        <span className="text-[11px] font-medium">{tp.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  Modalidade do Frete
                </label>
                <div className="space-y-1.5">
                  {MOD_FRETE.map(mf => (
                    <button key={mf.valor} type="button"
                      onClick={() => upd("modFrete", mf.valor)}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-all",
                        dados.modFrete === mf.valor
                          ? "border-violet-500/50 bg-violet-500/10"
                          : "border-border/30 bg-muted/10 hover:bg-muted/30"
                      )}
                    >
                      <Truck className={cn("h-3 w-3 shrink-0",
                        dados.modFrete === mf.valor ? "text-violet-500" : "text-muted-foreground"
                      )} />
                      <span className="text-[11px]">{mf.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  Informações Adicionais
                </label>
                <textarea
                  value={dados.informacoesAdicionais}
                  onChange={e => upd("informacoesAdicionais", e.target.value.slice(0,500))}
                  placeholder="Pedido nº ..., referência ..., prazo de entrega ..."
                  rows={3}
                  className="w-full rounded-xl border border-border/50 bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500/30 resize-none"
                />
                <p className="text-[9px] text-muted-foreground text-right">
                  {dados.informacoesAdicionais.length}/500
                </p>
              </div>
            </div>
          )}

          {/* ── PASSO 5: Revisão ── */}
          {step === 5 && (
            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Revisão — confirme antes de emitir
              </p>

              {/* Nota */}
              <div className="rounded-xl border border-border/30 bg-muted/10 p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-bold">
                    {dados.tipoNota === "nfe" ? "NF-e" : "NFC-e"} — Série {dados.serie} — Nº {dados.numero.padStart(9,"0")}
                  </span>
                  <span className="text-[9px] font-bold border border-orange-500/30 bg-orange-500/8 text-orange-500 px-1.5 py-0.5 rounded-full">
                    Homologação
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground">{dados.naturezaOperacao}</p>
              </div>

              {/* Destinatário */}
              <div className="rounded-xl border border-border/30 bg-muted/10 p-3 space-y-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                  <User className="h-2.5 w-2.5" />Destinatário
                </p>
                <p className="text-[13px] font-semibold">{dados.destNome}</p>
                {dados.destDocumento && (
                  <p className="text-[10px] text-muted-foreground font-mono">{mascararDoc(dados.destDocumento)}</p>
                )}
                {dados.destEmail && (
                  <p className="text-[10px] text-muted-foreground">{dados.destEmail}</p>
                )}
              </div>

              {/* Itens + totais */}
              <div className="rounded-xl border border-border/30 bg-muted/10 p-3 space-y-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                  <Package className="h-2.5 w-2.5" />Itens ({dados.itens.length})
                </p>
                {dados.itens.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between text-[11px]">
                    <span className="truncate flex-1 mr-2 text-foreground">{item.descricao}</span>
                    <span className="font-mono text-muted-foreground shrink-0">
                      {item.quantidade}× R$ {parseFloat(item.valorUnitario).toFixed(2)}
                    </span>
                  </div>
                ))}
                <div className="border-t border-border/30 pt-1 flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">Frete</span>
                  <span className="font-mono text-muted-foreground">
                    R$ {parseFloat(dados.valorFrete || "0").toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-bold">Total</span>
                  <span className="text-[15px] font-bold text-violet-600 font-mono">
                    R$ {dados.valorTotal}
                  </span>
                </div>
              </div>

              {/* Pagamento */}
              <div className="rounded-xl border border-border/30 bg-muted/10 px-3 py-2 flex items-center justify-between">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Pagamento</span>
                <span className="text-[12px] font-semibold">
                  {TIPOS_PAGAMENTO.find(t => t.valor === dados.tipoPagamento)?.label}
                </span>
              </div>

              {/* Notificação vendedora */}
              {pedido.vendedora_nome && (
                <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-3 py-2.5 flex items-start gap-2">
                  <Bell className="h-3.5 w-3.5 text-violet-500 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-muted-foreground">
                    <strong>{pedido.vendedora_nome}</strong> receberá notificação ao autorizar.
                  </p>
                </div>
              )}

              {/* Resultado SEFAZ de tentativa anterior */}
              {lastResult && !lastResult.sucesso && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 flex items-start gap-2">
                  <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] font-semibold text-destructive">
                      SEFAZ rejeitou — cStat {lastResult.cStat}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{lastResult.xMotivo}</p>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Rodapé */}
        <div className="px-5 pb-5 pt-3 border-t border-border/20 shrink-0">
          <div className="flex items-center gap-2">
            {step > 1 && (
              <button type="button" onClick={() => setStep(s => s - 1)} disabled={saving}
                className="h-10 px-4 rounded-xl border border-border/50 text-sm font-medium text-muted-foreground hover:bg-muted/40 transition-colors disabled:opacity-40"
              >
                Voltar
              </button>
            )}

            {step < 5 ? (
              <button type="button" onClick={() => setStep(s => s + 1)} disabled={!canAdvance()}
                className="flex-1 h-10 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-35 flex items-center justify-center gap-1.5"
              >
                Próximo <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button type="button" onClick={handleEmitir} disabled={saving}
                className="flex-1 h-10 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />Enviando ao SEFAZ…</>
                ) : (
                  <><FileCheck2 className="h-4 w-4" />Emitir {dados.tipoNota === "nfce" ? "NFC-e" : "NF-e"}</>
                )}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

// ─── Card de Pedido ────────────────────────────────────────────────────────

function PedidoCard({
  pedido, onEmitirNF,
}: { pedido: Pedido; onEmitirNF: (p: Pedido) => void }) {
  const [expanded, setExpanded] = useState(false);
  const totalItens = pedido.itens.reduce((s, i) => s + i.quantidade, 0);

  return (
    <div className={cn(
      "rounded-2xl border overflow-hidden transition-colors",
      pedido.status === "pronto"   ? "border-emerald-500/25 bg-emerald-500/3" :
      pedido.status === "faturado" ? "border-violet-500/25  bg-violet-500/3"  :
      pedido.status === "enviado"  ? "border-success/20     bg-success/3"     :
      "border-border/30 bg-card"
    )}>
      <button type="button" onClick={() => setExpanded(v => !v)}
        className="w-full text-left px-4 py-3 flex items-start gap-3"
      >
        <div className="h-9 w-9 rounded-xl bg-muted/30 flex items-center justify-center shrink-0 mt-0.5">
          {pedido.status === "enviado"
            ? <BadgeCheck className="h-4 w-4 text-success" />
            : <Receipt className="h-4 w-4 text-muted-foreground" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold truncate">{pedido.cliente_nome}</span>
            <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", statusColor(pedido.status))}>
              {statusLabel(pedido.status)}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {pedido.vendedora_nome && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <User className="h-2.5 w-2.5" />{pedido.vendedora_nome}
              </span>
            )}
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Package className="h-2.5 w-2.5" />{totalItens} un.
            </span>
            {pedido.frete > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Truck className="h-2.5 w-2.5" />R$ {pedido.frete.toFixed(2)}
              </span>
            )}
            {pedido.nota_fiscal && (
              <span className="flex items-center gap-1 text-[11px] text-violet-500 font-mono">
                <FileText className="h-2.5 w-2.5" />{pedido.nota_fiscal}
              </span>
            )}
          </div>
        </div>
        {expanded
          ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0 mt-2" />
          : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 mt-2" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/20 pt-3">
          {/* Timeline */}
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3" />Criado: {fmtDate(pedido.created_at)}
            </p>
            {pedido.separado_em && (
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />Separado: {fmtDate(pedido.separado_em)}
              </p>
            )}
            {pedido.nf_criada_em && (
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Receipt className="h-3 w-3 text-violet-500" />NF emitida: {fmtDate(pedido.nf_criada_em)}
              </p>
            )}
            {pedido.enviado_em && (
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Send className="h-3 w-3 text-success" />Enviado: {fmtDate(pedido.enviado_em)}
              </p>
            )}
          </div>

          {/* Chave de acesso + protocolo */}
          {pedido.chave_acesso_nfe && (
            <div className="rounded-lg border border-border/30 bg-background/60 px-2.5 py-2 space-y-1">
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">
                Chave de Acesso NF-e
              </p>
              <p className="text-[9px] font-mono text-foreground break-all leading-relaxed">
                {pedido.chave_acesso_nfe}
              </p>
              {pedido.protocolo_sefaz && (
                <p className="text-[9px] text-violet-500 font-mono">
                  Protocolo: {pedido.protocolo_sefaz}
                </p>
              )}
            </div>
          )}

          {/* Itens */}
          <div className="space-y-1">
            {pedido.itens.map(item => (
              <div key={item.id}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background/60 border border-border/20"
              >
                <Package className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-[12px] flex-1 truncate">{item.device_model}</span>
                <span className="flex items-center gap-1 text-[10px] text-violet-500 font-mono shrink-0">
                  <Tag className="h-2.5 w-2.5" />{item.lote}
                </span>
                <span className="text-[12px] font-bold shrink-0">{item.quantidade} un.</span>
              </div>
            ))}
          </div>

          {pedido.observacoes && (
            <p className="text-[11px] text-muted-foreground italic">"{pedido.observacoes}"</p>
          )}

          {pedido.status === "pronto" && (
            <button type="button" onClick={() => onEmitirNF(pedido)}
              className="w-full h-9 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[12px] font-semibold transition-colors flex items-center justify-center gap-1.5"
            >
              <FileCheck2 className="h-3.5 w-3.5" />
              Emitir Nota Fiscal (SEFAZ)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Modal Histórico ───────────────────────────────────────────────────────

function HistoricoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("pedidos_comerciais")
      .select(`
        id, vendedora_id, vendedora_nome, status, frete, observacoes,
        nota_fiscal, protocolo_sefaz, chave_acesso_nfe,
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
          cliente_nome:     cli.nome,
          cliente_documento: cli.documento,
          vendedora_nome:   p.vendedora_nome as string | null,
          vendedora_id:     p.vendedora_id   as string | null,
          status:           p.status         as string,
          frete:            (p.frete          as number) ?? 0,
          observacoes:      p.observacoes     as string | null,
          nota_fiscal:      p.nota_fiscal     as string | null,
          protocolo_sefaz:  p.protocolo_sefaz as string | null,
          chave_acesso_nfe: p.chave_acesso_nfe as string | null,
          created_at:       p.created_at      as string,
          separado_em:      p.separado_em     as string | null,
          nf_criada_em:     p.nf_criada_em    as string | null,
          enviado_em:       p.enviado_em       as string | null,
          itens: ((p.pedido_itens as Record<string, unknown>[]) ?? []).map((i: Record<string, unknown>) => ({
            id:           i.id as string,
            stock_item_id: i.stock_item_id as string,
            lote:          i.lote           as string,
            quantidade:    i.quantidade     as number,
            device_model:  ((i.stock_items as { devices: { model: string } } | null)?.devices?.model),
          })),
        };
      }));
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (open) load(); else setPedidos([]); }, [open, load]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-card border border-border/30 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in slide-in-from-bottom-4 duration-200">

        <div className="relative px-5 pt-5 pb-3 shrink-0 border-b border-border/20">
          <div className="absolute inset-0 bg-gradient-to-b from-violet-500/5 to-transparent" />
          <div className="relative flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-violet-500" />
                <p className="text-sm font-semibold">Histórico SEFAZ</p>
              </div>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                Últimas {pedidos.length} notas emitidas
              </p>
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
          {loading && (
            <div className="flex items-center justify-center py-10">
              <div className="animate-spin h-5 w-5 border-2 border-violet-500 border-t-transparent rounded-full" />
            </div>
          )}
          {!loading && pedidos.length === 0 && (
            <div className="text-center py-12 text-sm text-muted-foreground">
              Nenhuma nota emitida ainda
            </div>
          )}
          {!loading && pedidos.map(p => {
            const enviado = p.status === "enviado";
            return (
              <div key={p.id} className={cn(
                "flex items-start gap-3 px-3 py-2.5 rounded-xl border transition-colors",
                enviado ? "bg-success/4 border-success/15" : "bg-violet-500/4 border-violet-500/15"
              )}>
                {enviado
                  ? <Send className="h-4 w-4 mt-0.5 text-success shrink-0" />
                  : <FileCheck2 className="h-4 w-4 mt-0.5 text-violet-500 shrink-0" />}
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-[12px] font-semibold truncate">{p.cliente_nome}</p>
                  {p.nota_fiscal && (
                    <p className="text-[11px] font-mono text-violet-500 flex items-center gap-1">
                      <Tag className="h-2.5 w-2.5" />{p.nota_fiscal}
                    </p>
                  )}
                  {p.protocolo_sefaz && (
                    <p className="text-[9px] font-mono text-muted-foreground/60">Prot: {p.protocolo_sefaz}</p>
                  )}
                  {p.vendedora_nome && (
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <User className="h-2.5 w-2.5" />{p.vendedora_nome}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={cn(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded-full border",
                    enviado
                      ? "bg-success/10 text-success border-success/30"
                      : "bg-violet-500/10 text-violet-500 border-violet-500/30"
                  )}>
                    {enviado ? "Enviado" : "Faturado"}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {fmtDate(p.nf_criada_em ?? p.created_at)}
                  </span>
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

export default function Financeiro() {
  const navigate   = useNavigate();
  const { isAdmin, role } = useAuth();

  const [pedidos,       setPedidos]       = useState<Pedido[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [filtroStatus,  setFiltroStatus]  = useState("pronto");
  const [sefazPedido,   setSefazPedido]   = useState<Pedido | null>(null);
  const [historicoOpen, setHistoricoOpen] = useState(false);

  const [isDark, setIsDark] = useState(() => {
    const t = getStoredTheme();
    return t === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : t === "dark";
  });

  const toggleTheme = useCallback(() => {
    setIsDark(v => { applyTheme(!v ? "dark" : "light"); return !v; });
  }, []);

  const canAccess = isAdmin || role === "financeiro";

  const abortRef = useRef<AbortController | null>(null);

  const loadPedidos = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);

    const { data, error } = await supabase
      .from("pedidos_comerciais")
      .select(`
        id, vendedora_id, vendedora_nome, status, frete, observacoes,
        nota_fiscal, protocolo_sefaz, chave_acesso_nfe,
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
        const cli = p.clientes as {
          nome: string; documento?: string; telefone?: string; email?: string; endereco?: string;
        };
        return {
          id: p.id as string,
          cliente_nome:      cli.nome,
          cliente_documento: cli.documento,
          cliente_telefone:  cli.telefone,
          cliente_email:     cli.email,
          cliente_endereco:  cli.endereco,
          vendedora_nome:    p.vendedora_nome    as string | null,
          vendedora_id:      p.vendedora_id      as string | null,
          status:            p.status            as string,
          frete:             (p.frete            as number) ?? 0,
          observacoes:       p.observacoes       as string | null,
          nota_fiscal:       p.nota_fiscal       as string | null,
          protocolo_sefaz:   p.protocolo_sefaz   as string | null,
          chave_acesso_nfe:  p.chave_acesso_nfe  as string | null,
          created_at:        p.created_at        as string,
          separado_em:       p.separado_em       as string | null,
          nf_criada_em:      p.nf_criada_em      as string | null,
          enviado_em:        p.enviado_em        as string | null,
          itens: ((p.pedido_itens as Record<string, unknown>[]) ?? []).map((i: Record<string, unknown>) => ({
            id:            i.id             as string,
            stock_item_id: i.stock_item_id  as string,
            lote:          i.lote           as string,
            quantidade:    i.quantidade     as number,
            device_model:  ((i.stock_items as { devices: { model: string; reference: string } } | null)?.devices?.model),
            device_reference: ((i.stock_items as { devices: { model: string; reference: string } } | null)?.devices?.reference),
          })),
        };
      }));
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadPedidos(); }, [loadPedidos]);

  const filtrados = filtroStatus === "todos"
    ? pedidos
    : pedidos.filter(p => p.status === filtroStatus);

  const prontos  = pedidos.filter(p => p.status === "pronto").length;
  const enviados = pedidos.filter(p => p.status === "enviado").length;

  if (!canAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-2">
          <Ban className="h-10 w-10 text-destructive/40 mx-auto" />
          <p className="text-sm text-muted-foreground">Acesso restrito ao setor financeiro.</p>
          <button type="button" onClick={() => navigate("/")}
            className="text-sm text-primary hover:underline">
            Voltar ao início
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border/40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => navigate("/")}
              className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-violet-500" />
              <h1 className="text-sm font-semibold">Financeiro</h1>
              <span className="hidden sm:block text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-orange-500/30 bg-orange-500/8 text-orange-500">
                SEFAZ
              </span>
            </div>
            {prontos > 0 && (
              <span className="flex items-center gap-0.5 bg-emerald-500/15 text-emerald-600 border border-emerald-500/30 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {prontos} pronto{prontos > 1 ? "s" : ""}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button type="button" onClick={toggleTheme}
              className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors"
              title={isDark ? "Modo claro" : "Modo escuro"}>
              {isDark
                ? <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
                : <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>}
            </button>
            <button type="button" onClick={() => setHistoricoOpen(true)}
              className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors"
              title="Histórico de NFs">
              <History className="h-4 w-4" />
            </button>
            <button type="button" onClick={loadPedidos}
              className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors">
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 space-y-4">

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 flex items-start gap-3">
            <div className="h-9 w-9 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
                Aguardando NF
              </p>
              <p className="text-2xl font-bold tabular-nums text-emerald-600">{prontos}</p>
            </div>
          </div>
          <div className="rounded-2xl border border-success/20 bg-success/5 p-4 flex items-start gap-3">
            <div className="h-9 w-9 rounded-xl bg-success/10 flex items-center justify-center shrink-0">
              <Send className="h-5 w-5 text-success" />
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
                Enviados
              </p>
              <p className="text-2xl font-bold tabular-nums text-success">{enviados}</p>
            </div>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {[
            { id: "pronto",  label: "Aguardando NF" },
            { id: "enviado", label: "Enviados"       },
            { id: "todos",   label: "Todos"          },
          ].map(f => (
            <button key={f.id} type="button"
              onClick={() => setFiltroStatus(f.id)}
              className={cn(
                "h-7 px-3 rounded-full text-[11px] font-medium border transition-colors",
                filtroStatus === f.id
                  ? "bg-violet-600 text-white border-violet-600"
                  : "bg-muted/30 border-border/40 text-muted-foreground hover:bg-muted/60"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Lista */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin h-6 w-6 border-2 border-violet-500 border-t-transparent rounded-full" />
          </div>
        ) : filtrados.length === 0 ? (
          <div className="text-center py-16 space-y-2">
            <Receipt className="h-10 w-10 text-muted-foreground/30 mx-auto" />
            <p className="text-sm text-muted-foreground">
              {filtroStatus === "pronto"
                ? "Nenhum pedido aguardando nota fiscal"
                : "Nenhum pedido encontrado"}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtrados.map(p => (
              <PedidoCard key={p.id} pedido={p} onEmitirNF={setSefazPedido} />
            ))}
          </div>
        )}
      </main>

      <SefazModal
        pedido={sefazPedido}
        onClose={() => setSefazPedido(null)}
        onSuccess={loadPedidos}
      />
      <HistoricoModal open={historicoOpen} onClose={() => setHistoricoOpen(false)} />
    </div>
  );
}
