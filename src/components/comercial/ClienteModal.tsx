import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { User, X, CheckCircle2, Search, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import type { Cliente } from "@/types/comercial";
import { buscarCep as consultarCep, buscarCnpj, buscarCodigoIbge, formatarDocumento, formatarTelefone, somenteDigitos } from "@/lib/brasilApi";
import { validarDocumento } from "@/lib/validators";

interface ClienteModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (cliente: Cliente) => void;
  inicial?: Cliente | null;
}

export function ClienteModal({ open, onClose, onSuccess, inicial }: ClienteModalProps) {
  const { user } = useAuth();
  const [nome, setNome] = useState("");
  const [documento, setDocumento] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [cep, setCep] = useState("");
  const [logradouro, setLogradouro] = useState("");
  const [numero, setNumero] = useState("");
  const [bairro, setBairro] = useState("");
  const [municipio, setMunicipio] = useState("");
  const [uf, setUf] = useState("");
  const [cMun, setCMun] = useState(""); // código IBGE da cidade (NF-e)
  const [obs, setObs] = useState("");
  const [ie, setIe] = useState("");
  // Base de clientes para evitar cadastro duplicado (mesmo CPF/CNPJ ou nome igual/parecido)
  const [existentes, setExistentes] = useState<Cliente[]>([]);
  const [saving, setSaving] = useState(false);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);

  useEffect(() => {
    if (open) {
      setNome(inicial?.nome ?? "");
      setDocumento(inicial?.documento ?? "");
      setTelefone(inicial?.telefone ?? "");
      setEmail(inicial?.email ?? "");
      // Desmonta o endereço existente nos campos separados
      const end = inicial?.endereco ?? "";
      setCep(inicial?.cep ?? "");
      setLogradouro(inicial?.logradouro ?? end);
      setNumero(inicial?.numero ?? "");
      setBairro(inicial?.bairro ?? "");
      setMunicipio(inicial?.municipio ?? "");
      setUf(inicial?.uf ?? "");
      setCMun(inicial?.c_mun ?? "");
      setObs(inicial?.observacoes ?? "");
      setIe((inicial as (Cliente & { ie?: string | null }) | null | undefined)?.ie ?? "");
      supabase.from("clientes").select("id,nome,documento,municipio,uf,telefone,email,endereco,observacoes,created_at")
        .then(({ data }) => setExistentes((data as Cliente[]) ?? []));
    }
  }, [open, inicial]);

  const normNome = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(ltda|me|epp|eireli|s a|sa|cia|clinica|consultorio|dr|dra)\b/g, " ").replace(/\s+/g, " ").trim();
  const duplicados = useMemo(() => {
    const doc = somenteDigitos(documento);
    const outros = existentes.filter(c => c.id !== inicial?.id);
    const docMudou = doc !== somenteDigitos(inicial?.documento ?? "");
    const mesmoDoc = docMudou && (doc.length === 11 || doc.length === 14) ? outros.filter(c => somenteDigitos(c.documento ?? "") === doc) : [];
    const n = normNome(nome);
    const parecidos = n.length >= 4 && (!inicial || normNome(inicial.nome) !== n) ? outros.filter(c => !mesmoDoc.includes(c) && (normNome(c.nome) === n || (n.length >= 8 && normNome(c.nome).includes(n)))).slice(0, 3) : [];
    return { mesmoDoc, parecidos };
  }, [documento, nome, existentes, inicial]);

  async function buscarCep(cepVal: string) {
    const cepLimpo = cepVal.replace(/\D/g, "");
    if (cepLimpo.length !== 8) return;
    setBuscandoCep(true);
    try {
      const end = await consultarCep(cepLimpo);
      if (!end) { toast.error("CEP não encontrado."); return; }
      setLogradouro(end.logradouro);
      setBairro(end.bairro);
      setMunicipio(end.municipio);
      setUf(end.uf);
      setCMun(end.ibge ?? "");
    } finally { setBuscandoCep(false); }
  }

  /** Preenche o cadastro com os dados públicos do CNPJ (Receita Federal via BrasilAPI). */
  async function preencherPorCnpj() {
    const d = somenteDigitos(documento);
    if (d.length !== 14) { toast.error("Informe um CNPJ com 14 dígitos."); return; }
    if (!validarDocumento(d)) { toast.error("CNPJ inválido — confira os dígitos."); return; }
    setBuscandoCnpj(true);
    try {
      const r = await buscarCnpj(d);
      if (!r) { toast.error("Não foi possível consultar esse CNPJ agora."); return; }
      // Só preenche o que está vazio — nunca sobrescreve o que o usuário digitou.
      if (!nome.trim()) setNome(r.razaoSocial);
      if (!telefone.trim() && r.telefone) setTelefone(r.telefone);
      if (!email.trim() && r.email) setEmail(r.email);
      if (!cep.trim() && r.cep) setCep(r.cep.length === 8 ? `${r.cep.slice(0, 5)}-${r.cep.slice(5)}` : r.cep);
      if (!logradouro.trim() && r.logradouro) setLogradouro(r.logradouro);
      if (!numero.trim() && r.numero) setNumero(r.numero);
      if (!bairro.trim() && r.bairro) setBairro(r.bairro);
      if (!municipio.trim() && r.municipio) { setMunicipio(r.municipio); setCMun(r.ibge ?? ""); }
      if (!uf.trim() && r.uf) setUf(r.uf);
      if (r.situacao && r.situacao.toUpperCase() !== "ATIVA") {
        toast.warning(`Atenção: situação cadastral do CNPJ é "${r.situacao}".`, { duration: 8000 });
      } else {
        toast.success("Dados do CNPJ preenchidos.");
      }
    } finally { setBuscandoCnpj(false); }
  }

  if (!open) return null;

  async function handleSave() {
    if (!nome.trim()) { toast.error("Nome obrigatório"); return; }
    if (duplicados.mesmoDoc.length) { toast.error(`Este CPF/CNPJ já está cadastrado: ${duplicados.mesmoDoc[0].nome}`); return; }
    if (documento.trim() && !validarDocumento(documento)) {
      toast.error("CPF/CNPJ inválido — confira os dígitos."); return;
    }
    // FIX: validação de e-mail antes de persistir
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error("E-mail inválido."); return;
    }
    setSaving(true);
    try {
      // FIX: slice garante que nenhum campo ultrapasse o limite antes de chegar ao banco
      const enderecoMontado = [logradouro.trim(), numero.trim(), bairro.trim(), municipio.trim(), uf.trim()]
        .filter(Boolean).join(", ");
      // Código IBGE da cidade: vem do CEP; se a cidade foi digitada à mão, tenta achar pelo nome.
      let codMun = /^\d{7}$/.test(cMun) ? cMun : "";
      if (!codMun && municipio.trim() && uf.trim().length === 2) codMun = (await buscarCodigoIbge(municipio, uf).catch(() => null)) ?? "";
      const payload = {
        nome:        nome.trim().slice(0, 200),
        documento:   documento.trim().slice(0, 20)  || null,
        telefone:    telefone.trim().slice(0, 20)   || null,
        email:       email.trim().slice(0, 200)     || null,
        cep:         cep.replace(/\D/g, "").slice(0, 9) || null,
        logradouro:  logradouro.trim().slice(0, 200) || null,
        numero:      numero.trim().slice(0, 20)      || null,
        bairro:      bairro.trim().slice(0, 100)     || null,
        municipio:   municipio.trim().slice(0, 100)  || null,
        uf:          uf.trim().slice(0, 2).toUpperCase() || null,
        endereco:    enderecoMontado.slice(0, 300)   || null,
        observacoes: obs.trim().slice(0, 1000)       || null,
        ie:          ie.trim().toUpperCase().slice(0, 20) || null,
        c_mun:       codMun || null,
      };
      let data: Cliente | null = null;
      if (inicial) {
        const { data: d, error } = await supabase
          .from("clientes").update(payload).eq("id", inicial.id).select().single();
        if (error) throw error;
        data = d as Cliente;
      } else {
        const { data: d, error } = await supabase
          .from("clientes").insert({ ...payload, created_by: user?.id }).select().single();
        if (error) throw error;
        data = d as Cliente;
      }
      toast.success(inicial ? "Cliente atualizado!" : "Cliente cadastrado!");
      onSuccess(data!);
    } catch (e) {
      const msg = (e as { code?: string; message?: string })?.code === "23505" ? (e as { message?: string }).message : null;
      toast.error(msg ?? "Erro ao salvar cliente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm"
      onKeyDown={e => { if (e.key === "Escape" && !saving) { e.stopPropagation(); onClose(); } }}>
      <div role="dialog" aria-modal="true" aria-labelledby="cliente-modal-titulo"
        className="w-full sm:max-w-lg max-h-[94vh] sm:max-h-[90vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-card border shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <User className="h-4 w-4 text-primary shrink-0" />
            <p id="cliente-modal-titulo" className="font-semibold truncate">{inicial ? "Editar cliente" : "Novo cliente"}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="h-10 w-10 -mr-2 flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 space-y-3 flex-1 overflow-y-auto">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Identificação</p>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Nome *</label>
            <Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome completo ou razão social" className="h-11 text-sm" autoFocus maxLength={200} />
          </div>
          <div className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">CPF / CNPJ {somenteDigitos(documento).length === 14 && <span className="font-normal">(lupa preenche pela Receita)</span>}</label>
              <div className="relative">
                <Input
                  value={documento}
                  onChange={e => setDocumento(formatarDocumento(e.target.value))}
                  placeholder="CPF ou CNPJ"
                  inputMode="numeric"
                  className="h-11 text-sm pr-9"
                  maxLength={18}
                  aria-invalid={!!documento && somenteDigitos(documento).length >= 11 && !validarDocumento(documento)}
                />
                {somenteDigitos(documento).length === 14 && (
                  <button
                    type="button"
                    onClick={preencherPorCnpj}
                    disabled={buscandoCnpj}
                    title="Buscar dados do CNPJ na Receita"
                    aria-label="Buscar dados do CNPJ"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 flex items-center justify-center rounded-md text-primary hover:bg-primary/10 disabled:opacity-50"
                  >
                    {buscandoCnpj
                      ? <div className="h-3.5 w-3.5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                      : <Search className="h-3.5 w-3.5" />}
                  </button>
                )}
              </div>
              {!!documento && somenteDigitos(documento).length >= 11 && !validarDocumento(documento) && (
                <p className="text-[11px] text-destructive">Documento inválido</p>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Telefone</label>
              <Input value={telefone} onChange={e => setTelefone(formatarTelefone(e.target.value))} placeholder="(00) 00000-0000" inputMode="tel" className="h-11 text-sm" maxLength={20} />
            </div>
          </div>
          {(duplicados.mesmoDoc.length > 0 || duplicados.parecidos.length > 0) && (
            <div className={cn("rounded-xl border px-3 py-2.5 space-y-2 text-sm", duplicados.mesmoDoc.length ? "border-red-500/40 bg-red-500/5" : "border-amber-500/40 bg-amber-500/5")}>
              <p className="font-medium flex items-center gap-1.5">
                <AlertTriangle className={cn("h-4 w-4", duplicados.mesmoDoc.length ? "text-red-600" : "text-amber-600")} />
                {duplicados.mesmoDoc.length ? "Este CPF/CNPJ já está cadastrado" : "Já existe cliente com nome parecido"}
              </p>
              {[...duplicados.mesmoDoc, ...duplicados.parecidos].map(c => (
                <div key={c.id} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1"><p className="truncate">{c.nome}</p><p className="text-xs text-muted-foreground">{[c.documento, c.municipio].filter(Boolean).join(" · ")}</p></div>
                  {!inicial && <button type="button" onClick={() => onSuccess(c)} className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold shrink-0">Usar este</button>}
                </div>
              ))}
            </div>
          )}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Inscrição estadual</label>
            <Input value={ie} onChange={e => setIe(e.target.value)} placeholder="Número, ISENTO ou vazio (consumidor)" className="h-11 text-sm" maxLength={20} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">E-mail</label>
            <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="cliente@email.com" type="email" className="h-11 text-sm" maxLength={200} />
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground pt-2">Endereço (usado na NF-e)</p>
          {/* CEP com busca automática */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">CEP</label>
              <div className="relative">
                <Input
                  value={cep}
                  onChange={e => {
                    const v = e.target.value.replace(/\D/g,"").slice(0,8);
                    const fmt = v.length > 5 ? v.slice(0,5) + "-" + v.slice(5) : v;
                    setCep(fmt);
                    if (v.length === 8) buscarCep(v);
                  }}
                  placeholder="00000-000"
                  className="h-11 text-sm pr-8"
                  maxLength={9}
                />
                {buscandoCep && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                )}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Número</label>
              <Input value={numero} onChange={e => setNumero(e.target.value)} placeholder="123" className="h-11 text-sm" maxLength={20} />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Logradouro</label>
            <Input value={logradouro} onChange={e => setLogradouro(e.target.value)} placeholder="Rua, Av..." className="h-11 text-sm" maxLength={200} />
          </div>
          <div className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Bairro</label>
              <Input value={bairro} onChange={e => setBairro(e.target.value)} placeholder="Bairro" className="h-11 text-sm" maxLength={100} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Cidade / UF</label>
              <div className="flex gap-1.5">
                <Input value={municipio} onChange={e => { setMunicipio(e.target.value); setCMun(""); }} placeholder="Cidade" className="h-11 text-sm flex-1" maxLength={100} />
                <Input value={uf} onChange={e => { setUf(e.target.value.toUpperCase().slice(0,2)); setCMun(""); }} placeholder="UF" className="h-11 text-sm w-14 text-center" maxLength={2} />
              </div>
            </div>
          </div>
          <div className="space-y-1 pt-1">
            <label className="text-xs font-medium text-muted-foreground">Observações</label>
            <textarea value={obs} onChange={e => setObs(e.target.value)} placeholder="Informações adicionais..." className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none min-h-[72px] focus:outline-none focus:ring-2 focus:ring-ring" maxLength={1000} />
          </div>
        </div>
        <div className="flex gap-2 px-5 py-3 border-t shrink-0 bg-card">
          <button type="button" onClick={onClose} disabled={saving} className="flex-1 h-11 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-colors">Cancelar</button>
          <button type="button" onClick={handleSave} disabled={saving || !nome.trim() || duplicados.mesmoDoc.length > 0} className="flex-1 h-11 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5">
            {saving ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {inicial ? "Salvar" : "Cadastrar"}
          </button>
        </div>
      </div>
    </div>
  );
}
