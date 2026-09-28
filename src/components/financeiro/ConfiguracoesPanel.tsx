/**
 * Configurações do Financeiro:
 *  • Dados fiscais da empresa (emitente) e padrões da NF-e;
 *  • Emissor de NF-e (Focus NFe) — ativado colando o token (só admin);
 *  • Contas bancárias.
 */
import { useCallback, useEffect, useState } from "react";
import { Building2, CheckCircle2, ExternalLink, KeyRound, Landmark, Loader2, Pencil, Plus, Power, Search, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { friendlyError } from "@/lib/errorMessages";
import { buscarCep, buscarCnpj } from "@/lib/brasilApi";
import { cnpjValido, parseValor } from "@/lib/financeiro";
import type { EmissorStatus } from "./fiscal";

interface Config {
  razao_social: string; nome_fantasia: string; cnpj: string; ie: string; im: string; crt: string;
  logradouro: string; numero: string; complemento: string; bairro: string; municipio: string; c_mun: string; uf: string; cep: string;
  telefone: string; email: string; ambiente: string; serie_nfe: string; natureza_padrao: string;
  cfop_dentro_uf: string; cfop_fora_uf: string; prazo_padrao_dias: string; aliquota_icms_interna: string;
  pis_aliquota: string; cofins_aliquota: string; info_complementar: string;
}
const VAZIO: Config = {
  razao_social: "", nome_fantasia: "", cnpj: "", ie: "", im: "", crt: "", logradouro: "", numero: "", complemento: "", bairro: "",
  municipio: "", c_mun: "", uf: "SP", cep: "", telefone: "", email: "", ambiente: "2", serie_nfe: "1",
  natureza_padrao: "Venda de produção do estabelecimento", cfop_dentro_uf: "5101", cfop_fora_uf: "6101", prazo_padrao_dias: "30",
  aliquota_icms_interna: "18", pis_aliquota: "0,65", cofins_aliquota: "3,00", info_complementar: "",
};
const CRT: Record<string, string> = { "1": "Simples Nacional", "4": "MEI", "2": "Simples — excesso de sublimite", "3": "Regime normal (Lucro Presumido/Real)" };

export function ConfiguracoesPanel({ emissor, onEmissorMudou }: { emissor: EmissorStatus; onEmissorMudou: () => void }) {
  return (
    <div className="space-y-6">
      <EmissorCard emissor={emissor} onMudou={onEmissorMudou} />
      <DadosFiscais onSalvo={onEmissorMudou} />
      <Bancos />
    </div>
  );
}

function EmissorCard({ emissor, onMudou }: { emissor: EmissorStatus; onMudou: () => void }) {
  const { isAdmin } = useAuth();
  const [aberto, setAberto] = useState(false);
  const [token, setToken] = useState("");
  const [salvando, setSalvando] = useState(false);
  async function gravar(valor: string | null) {
    setSalvando(true);
    const { data, error } = await supabase.rpc("set_fiscal_token", { p_token: valor });
    setSalvando(false);
    const r = data as unknown as { ok: boolean; error?: string } | null;
    if (error || !r?.ok) { toast.error(r?.error ?? friendlyError(error)); return; }
    toast.success(valor ? "Token guardado com segurança." : "Emissor desativado.");
    setToken(""); setAberto(false); onMudou();
  }
  return (
    <section className={cn("rounded-2xl border p-5 space-y-3", emissor.ativo ? "border-green-500/30 bg-green-500/5" : "bg-card")}>
      <div className="flex flex-wrap items-start gap-3">
        <div className={cn("h-11 w-11 rounded-xl flex items-center justify-center", emissor.ativo ? "bg-green-500/15 text-green-700" : "bg-primary/10 text-primary")}><ShieldCheck className="h-6 w-6" /></div>
        <div className="flex-1 min-w-[14rem]">
          <h3 className="font-semibold">Emissor de NF-e</h3>
          <p className="text-sm text-muted-foreground">
            {emissor.ativo
              ? `Ativo em ${emissor.ambiente === 1 ? "PRODUÇÃO" : "HOMOLOGAÇÃO (notas sem valor fiscal)"} — emissão, cancelamento, carta de correção e inutilização direto pelo sistema.`
              : "Desativado. O sistema funciona normalmente registrando as notas emitidas em outro emissor. Para emitir por aqui, contrate um emissor (Focus NFe) e ative abaixo."}
          </p>
          {!emissor.ativo && emissor.faltando.length > 0 && <p className="text-xs text-muted-foreground mt-1">Falta: {emissor.faltando.join(", ")}.</p>}
        </div>
        {isAdmin && (emissor.ativo
          ? <Button variant="outline" className="gap-1.5" onClick={() => gravar(null)} disabled={salvando}><Power className="h-4 w-4" />Desativar</Button>
          : <Button className="gap-1.5" onClick={() => setAberto(true)}><KeyRound className="h-4 w-4" />Ativar emissor</Button>)}
      </div>
      {!isAdmin && !emissor.ativo && <p className="text-xs text-muted-foreground">Somente o administrador pode ativar o emissor.</p>}
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Ativar emissor de NF-e</DialogTitle>
            <DialogDescription>Passo a passo (uma vez só):</DialogDescription>
          </DialogHeader>
          <ol className="list-decimal pl-5 space-y-1.5 text-sm">
            <li>Crie a conta no <a className="text-primary underline inline-flex items-center gap-0.5" href="https://focusnfe.com.br" target="_blank" rel="noopener noreferrer">Focus NFe<ExternalLink className="h-3 w-3" /></a>, cadastre a empresa e envie o <strong>certificado digital A1</strong> no painel deles.</li>
            <li>Preencha aqui os <strong>Dados fiscais da empresa</strong> (CNPJ, IE, regime) — abaixo.</li>
            <li>Comece em <strong>Homologação</strong> (ambiente de testes) e cole o token de homologação.</li>
            <li>Emita uma nota de teste. Depois troque o ambiente para Produção e cole o token de produção.</li>
          </ol>
          <Input type="password" value={token} onChange={e => setToken(e.target.value.trim())} placeholder="Cole o token do emissor" className="h-11 font-mono" autoComplete="off" />
          <p className="text-xs text-muted-foreground">O token fica criptografado no cofre do banco (Vault) — ninguém consegue vê-lo depois, nem pelo sistema.</p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAberto(false)}>Cancelar</Button>
            <Button onClick={() => gravar(token)} disabled={salvando || token.length < 10} className="gap-1.5">{salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Ativar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function DadosFiscais({ onSalvo }: { onSalvo: () => void }) {
  const [c, setC] = useState<Config>(VAZIO);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const set = (k: keyof Config, v: string) => setC(p => ({ ...p, [k]: v }));

  useEffect(() => {
    supabase.from("fiscal_config").select("*").eq("id", 1).maybeSingle().then(({ data }) => {
      if (data) {
        const d = data as unknown as Record<string, unknown>;
        const out = { ...VAZIO };
        (Object.keys(VAZIO) as (keyof Config)[]).forEach(k => {
          const v = d[k];
          if (v != null) out[k] = typeof v === "number" && ["pis_aliquota", "cofins_aliquota", "aliquota_icms_interna"].includes(k) ? String(v).replace(".", ",") : String(v);
        });
        setC(out);
      }
      setLoading(false);
    });
  }, []);

  async function preencherCnpj() {
    if (!cnpjValido(c.cnpj)) { toast.error("CNPJ inválido."); return; }
    setBuscando(true);
    const d = await buscarCnpj(c.cnpj).catch(() => null);
    setBuscando(false);
    if (!d) { toast.error("Não encontrei esse CNPJ."); return; }
    setC(p => ({ ...p, razao_social: d.razaoSocial || p.razao_social, nome_fantasia: d.nomeFantasia ?? p.nome_fantasia,
      logradouro: d.logradouro || p.logradouro, numero: d.numero || p.numero, complemento: d.complemento || p.complemento,
      bairro: d.bairro || p.bairro, municipio: d.municipio || p.municipio, uf: d.uf || p.uf, c_mun: d.ibge || p.c_mun,
      cep: (d.cep || p.cep).replace(/\D/g, ""), telefone: d.telefone ?? p.telefone, email: d.email ?? p.email }));
    toast.success("Dados da Receita preenchidos — confira.");
  }
  async function preencherCep() {
    const e = await buscarCep(c.cep).catch(() => null);
    if (e) setC(p => ({ ...p, logradouro: p.logradouro || e.logradouro, bairro: p.bairro || e.bairro, municipio: e.municipio, uf: e.uf, c_mun: e.ibge || p.c_mun }));
  }

  async function salvar() {
    const cnpj = c.cnpj.replace(/\D/g, "");
    if (cnpj && !cnpjValido(cnpj)) { toast.error("CNPJ inválido."); return; }
    if (c.c_mun && !/^\d{7}$/.test(c.c_mun)) { toast.error("Código IBGE do município deve ter 7 números."); return; }
    setSalvando(true);
    const { error } = await supabase.from("fiscal_config").update({
      razao_social: c.razao_social.trim() || null, nome_fantasia: c.nome_fantasia.trim() || null, cnpj: cnpj || null,
      ie: c.ie.replace(/[^\dA-Za-z]/g, "") || null, im: c.im.trim() || null, crt: c.crt ? Number(c.crt) : null,
      logradouro: c.logradouro.trim() || null, numero: c.numero.trim() || null, complemento: c.complemento.trim() || null,
      bairro: c.bairro.trim() || null, municipio: c.municipio.trim() || null, c_mun: c.c_mun || null, uf: (c.uf || "SP").toUpperCase(),
      cep: c.cep.replace(/\D/g, "") || null, telefone: c.telefone.trim() || null, email: c.email.trim() || null,
      ambiente: Number(c.ambiente) === 1 ? 1 : 2, serie_nfe: c.serie_nfe.replace(/\D/g, "") || "1",
      natureza_padrao: c.natureza_padrao.trim() || "Venda de produção do estabelecimento",
      cfop_dentro_uf: c.cfop_dentro_uf, cfop_fora_uf: c.cfop_fora_uf, prazo_padrao_dias: Math.max(0, Math.min(365, Number(c.prazo_padrao_dias) || 30)),
      aliquota_icms_interna: parseValor(c.aliquota_icms_interna), pis_aliquota: parseValor(c.pis_aliquota), cofins_aliquota: parseValor(c.cofins_aliquota),
      info_complementar: c.info_complementar.trim() || null,
    }).eq("id", 1);
    setSalvando(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success("Dados fiscais salvos."); onSalvo();
  }

  const campo = (k: keyof Config, label: string, cls = "", props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className={cn("block space-y-1.5", cls)}>
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <Input value={c[k]} onChange={e => set(k, e.target.value)} className="h-11" {...props} />
    </label>
  );
  if (loading) return <div className="rounded-2xl border bg-card p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  return (
    <section className="rounded-2xl border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2"><Building2 className="h-5 w-5 text-primary" /><h3 className="font-semibold">Dados fiscais da empresa</h3></div>
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
        <label className="block space-y-1.5 col-span-2 sm:col-span-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">CNPJ</span>
          <div className="flex gap-1.5"><Input value={c.cnpj} onChange={e => set("cnpj", e.target.value)} inputMode="numeric" className="h-11" />
            <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={preencherCnpj} disabled={buscando} title="Buscar na Receita" aria-label="Buscar CNPJ">{buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}</Button></div>
        </label>
        {campo("razao_social", "Razão social", "col-span-2 sm:col-span-4")}
        {campo("nome_fantasia", "Nome fantasia", "col-span-2 sm:col-span-2")}
        {campo("ie", "Inscrição estadual", "col-span-1 sm:col-span-2")}
        {campo("im", "Inscrição municipal", "col-span-1 sm:col-span-2")}
        <label className="block space-y-1.5 col-span-2 sm:col-span-6">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Regime tributário (CRT) — confirme com o contador</span>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(CRT).map(([k, l]) => (
              <button key={k} type="button" onClick={() => set("crt", k)}
                className={cn("h-10 px-3 rounded-xl border text-sm", c.crt === k ? "border-primary bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted")}>{l}</button>
            ))}
          </div>
        </label>
        <label className="block space-y-1.5 col-span-1 sm:col-span-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">CEP</span>
          <Input value={c.cep} onChange={e => set("cep", e.target.value)} onBlur={preencherCep} inputMode="numeric" className="h-11" />
        </label>
        {campo("logradouro", "Rua", "col-span-1 sm:col-span-3")}
        {campo("numero", "Número", "col-span-1 sm:col-span-1")}
        {campo("complemento", "Complemento", "col-span-1 sm:col-span-1")}
        {campo("bairro", "Bairro", "col-span-1 sm:col-span-2")}
        {campo("municipio", "Cidade", "col-span-1 sm:col-span-2")}
        {campo("uf", "UF", "col-span-1 sm:col-span-1", { maxLength: 2 })}
        {campo("c_mun", "Cód. IBGE cidade", "col-span-1 sm:col-span-1", { inputMode: "numeric", maxLength: 7 })}
        {campo("telefone", "Telefone", "col-span-1 sm:col-span-3")}
        {campo("email", "E-mail fiscal", "col-span-1 sm:col-span-3", { type: "email" })}
      </div>
      <div className="border-t pt-4 grid grid-cols-2 sm:grid-cols-6 gap-3">
        <label className="block space-y-1.5 col-span-2 sm:col-span-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ambiente do emissor</span>
          <div className="flex gap-1.5">
            {[["2", "Homologação (teste)"], ["1", "Produção"]].map(([k, l]) => (
              <button key={k} type="button" onClick={() => set("ambiente", k)}
                className={cn("h-11 flex-1 rounded-xl border text-sm", c.ambiente === k ? (k === "1" ? "border-green-600 bg-green-600/10 text-green-700 font-medium" : "border-primary bg-primary/10 text-primary font-medium") : "text-muted-foreground")}>{l}</button>
            ))}
          </div>
        </label>
        {campo("serie_nfe", "Série da NF-e", "col-span-1", { inputMode: "numeric", maxLength: 3 })}
        {campo("prazo_padrao_dias", "Prazo de recebimento (dias)", "col-span-1 sm:col-span-3", { inputMode: "numeric" })}
        {campo("natureza_padrao", "Natureza da operação padrão", "col-span-2 sm:col-span-4")}
        {campo("cfop_dentro_uf", "CFOP no estado", "col-span-1", { inputMode: "numeric", maxLength: 4 })}
        {campo("cfop_fora_uf", "CFOP fora do estado", "col-span-1", { inputMode: "numeric", maxLength: 4 })}
        {c.crt === "3" && <>
          {campo("aliquota_icms_interna", "ICMS interno (%)", "col-span-1 sm:col-span-2", { inputMode: "decimal" })}
          {campo("pis_aliquota", "PIS (%)", "col-span-1 sm:col-span-2", { inputMode: "decimal" })}
          {campo("cofins_aliquota", "COFINS (%)", "col-span-2 sm:col-span-2", { inputMode: "decimal" })}
        </>}
        {campo("info_complementar", "Texto padrão nas informações complementares", "col-span-2 sm:col-span-6", { placeholder: "Ex.: Documento emitido por ME/EPP optante pelo Simples Nacional..." })}
      </div>
      {c.crt === "3" && <p className="text-xs rounded-xl bg-amber-500/10 text-amber-800 dark:text-amber-300 px-3 py-2">Regime normal: desde 03/08/2026 a NF-e deve informar IBS/CBS (Reforma Tributária — ano de teste, sem cobrança). A SEFAZ ainda não rejeita a falta desses campos; combine com o contador a classificação (cClassTrib) dos dispositivos médicos antes de ativar em produção.</p>}
      <div className="flex justify-end"><Button onClick={salvar} disabled={salvando} className="gap-1.5 h-11">{salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Salvar dados fiscais</Button></div>
    </section>
  );
}

interface Banco { id: string; banco: string; agencia: string; conta: string; tipo: string; saldo_atual: number; pix_chave: string | null }
const BANCOS = ["Banco do Brasil", "Bradesco", "Caixa", "Itaú", "Santander", "Inter", "Nubank", "C6 Bank", "BTG Pactual", "Sicoob", "Sicredi", "Outro"];

function Bancos() {
  const { isAdmin } = useAuth();
  const [lista, setLista] = useState<Banco[]>([]);
  const [editar, setEditar] = useState<Banco | "novo" | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase.from("financeiro_contas_bancarias").select("id,banco,agencia,conta,tipo,saldo_atual,pix_chave").order("banco");
    setLista(((data ?? []) as unknown as Banco[]).map(b => ({ ...b, saldo_atual: Number(b.saldo_atual) })));
  }, []);
  useEffect(() => { load(); }, [load]);
  async function excluir(b: Banco) {
    const { count } = await supabase.from("contas_financeiras").select("id", { count: "exact", head: true }).eq("banco_id", b.id);
    if ((count ?? 0) > 0) { toast.error("Há pagamentos registrados nesta conta — não pode ser excluída."); return; }
    const { error } = await supabase.from("financeiro_contas_bancarias").delete().eq("id", b.id);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success("Conta excluída."); load();
  }
  return (
    <section className="rounded-2xl border bg-card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Landmark className="h-5 w-5 text-primary" /><h3 className="font-semibold flex-1">Contas bancárias</h3>
        <Button size="sm" className="gap-1.5" onClick={() => setEditar("novo")}><Plus className="h-4 w-4" />Nova conta</Button>
      </div>
      {lista.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma conta cadastrada. Cadastre para registrar em qual banco cada pagamento entrou/saiu.</p> : (
        <ul className="divide-y">
          {lista.map(b => (
            <li key={b.id} className="py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0"><p className="font-medium">{b.banco}</p><p className="text-xs text-muted-foreground">Ag. {b.agencia} · C/C {b.conta}{b.pix_chave ? ` · PIX ${b.pix_chave}` : ""}</p></div>
              <p className="tabular-nums font-semibold">{formatBRL(b.saldo_atual)}</p>
              <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => setEditar(b)} aria-label="Editar"><Pencil className="h-4 w-4" /></Button>
              {isAdmin && <Button size="icon" variant="ghost" className="h-9 w-9 text-destructive" onClick={() => excluir(b)} aria-label="Excluir"><Trash2 className="h-4 w-4" /></Button>}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">Saldo informado manualmente (conciliação automática por extrato/Open Finance não está ativa).</p>
      {editar && <BancoDialog banco={editar === "novo" ? null : editar} onClose={() => setEditar(null)} onFeito={() => { setEditar(null); load(); }} />}
    </section>
  );
}

function BancoDialog({ banco, onClose, onFeito }: { banco: Banco | null; onClose: () => void; onFeito: () => void }) {
  const [f, setF] = useState({ banco: banco?.banco ?? BANCOS[0], agencia: banco?.agencia ?? "", conta: banco?.conta ?? "", tipo: banco?.tipo ?? "corrente",
    saldo: banco ? String(banco.saldo_atual).replace(".", ",") : "", pix: banco?.pix_chave ?? "" });
  const [salvando, setSalvando] = useState(false);
  async function salvar() {
    if (!f.agencia.trim() || !f.conta.trim()) { toast.error("Informe agência e conta."); return; }
    const payload = { banco: f.banco, agencia: f.agencia.trim(), conta: f.conta.trim(), tipo: f.tipo, saldo_atual: parseValor(f.saldo), pix_chave: f.pix.trim() || null };
    setSalvando(true);
    const { error } = banco
      ? await supabase.from("financeiro_contas_bancarias").update(payload).eq("id", banco.id)
      : await supabase.from("financeiro_contas_bancarias").insert(payload);
    setSalvando(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success("Conta salva."); onFeito();
  }
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{banco ? "Editar conta bancária" : "Nova conta bancária"}</DialogTitle></DialogHeader>
        <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Banco</span>
          <select value={f.banco} onChange={e => setF(p => ({ ...p, banco: e.target.value }))} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm">{BANCOS.map(b => <option key={b}>{b}</option>)}</select></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agência</span><Input value={f.agencia} onChange={e => setF(p => ({ ...p, agencia: e.target.value.slice(0, 10) }))} className="h-11" /></label>
          <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conta</span><Input value={f.conta} onChange={e => setF(p => ({ ...p, conta: e.target.value.slice(0, 20) }))} className="h-11" /></label>
          <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Saldo atual (R$)</span><Input value={f.saldo} onChange={e => setF(p => ({ ...p, saldo: e.target.value }))} inputMode="decimal" className="h-11" /></label>
          <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Chave PIX</span><Input value={f.pix} onChange={e => setF(p => ({ ...p, pix: e.target.value.slice(0, 80) }))} className="h-11" /></label>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>{salvando && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

