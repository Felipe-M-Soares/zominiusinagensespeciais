import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { friendlyError } from "@/lib/errorMessages";
import { detectarUF, adaptarCFOP } from "@/lib/cfop";
import { sugerirNcmParaPeca } from "@/lib/ncmSuggest";
import { TestBadge } from "@/components/financeiro/TestBadge";
import { statusLabel, mascararDoc } from "@/components/financeiro/financeiroUtils";
import type { Pedido, ItemFiscal, DadosFiscais, SefazResult } from "@/pages/Financeiro";
import {
  AlertCircle, AlertTriangle, Banknote, Building2, CheckCircle2, CheckSquare,
  ChevronRight, CreditCard, FileCheck2, Hash, Landmark, Loader2,
  Mail, MapPin, Package, X, Zap,
} from "lucide-react";

// ─── Constantes (assistente de emissão SEFAZ) ─────────────────────────────────

const STEP_LABELS = ["Identificação", "Destinatário", "Itens", "Pagamento", "Revisão"];

const TIPOS_PAGAMENTO: { valor: string; label: string; icon: typeof Package }[] = [
  { valor: "01", label: "Dinheiro",        icon: Banknote   },
  { valor: "17", label: "PIX",             icon: Zap        },
  { valor: "15", label: "Boleto Bancário", icon: Landmark   },
  { valor: "04", label: "Cartão de Débito",  icon: CreditCard },
  { valor: "03", label: "Cartão de Crédito", icon: CreditCard },
];

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

export function SefazModal({
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
                    ? <><strong>Homologação</strong>: nota simulada sem valor fiscal. Altere no topo desta aba (NF-e / SEFAZ).</>
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
