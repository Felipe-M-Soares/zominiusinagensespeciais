import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatBRL as fmtCurrency } from "@/lib/format";
import {
  CheckCircle2, Edit3, Landmark, Link, Loader2, PlusCircle,
  TestTube2, Trash2, Wallet, X,
} from "lucide-react";

interface ContaBancaria {
  id: string;
  banco: string;
  agencia: string;
  conta: string;
  tipo: "corrente" | "poupanca" | "pagamentos";
  saldo_atual: number;
  webhook_url: string | null;
  integracao_ativa: boolean;
  // token_api (texto puro) substituído por referência ao Vault — o valor
  // real nunca trafega num SELECT normal, só via RPC dedicada.
  token_api_secret_id: string | null;
  envio_automatico_nf: boolean;
  created_at: string;
}

const BANCOS_BR = [
  "Bradesco", "Itaú", "Santander", "Banco do Brasil", "Caixa Econômica",
  "Nubank", "Inter", "C6 Bank", "BTG Pactual", "Sicoob", "Sicredi", "Outro",
];

export function PainelBancos() {
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
    const { data } = await supabase.from("financeiro_contas_bancarias").select("id, banco, agencia, conta, tipo, saldo_atual, webhook_url, integracao_ativa, token_api_secret_id, envio_automatico_nf, created_at").order("created_at");
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

      {/* Configuração de ambiente fiscal e SEFAZ agora fica na aba "NF-e /
          SEFAZ" (ver <SefazConfigPanel/> mais abaixo neste arquivo) — estava
          aqui em Bancos antes, o que não fazia muito sentido: é config de
          emissão de nota fiscal, não de conta bancária. */}

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
