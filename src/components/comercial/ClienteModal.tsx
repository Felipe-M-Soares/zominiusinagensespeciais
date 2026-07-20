import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { User, X, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import type { Cliente } from "@/types/comercial";
import { useTranslation } from "react-i18next";

interface ClienteModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (cliente: Cliente) => void;
  inicial?: Cliente | null;
}

export function ClienteModal({ open, onClose, onSuccess, inicial }: ClienteModalProps) {
  const { t } = useTranslation();
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
  const [obs, setObs] = useState("");
  const [saving, setSaving] = useState(false);
  const [buscandoCep, setBuscandoCep] = useState(false);

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
      setObs(inicial?.observacoes ?? "");
    }
  }, [open, inicial]);

  async function buscarCep(cepVal: string) {
    const cepLimpo = cepVal.replace(/\D/g, "");
    if (cepLimpo.length !== 8) return;
    setBuscandoCep(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
      const data = await res.json();
      if (data.erro) { toast.error(t("clienteModal.toastCepNotFound")); return; }
      setLogradouro(data.logradouro ?? "");
      setBairro(data.bairro ?? "");
      setMunicipio(data.localidade ?? "");
      setUf(data.uf ?? "");
    } catch { toast.error(t("clienteModal.toastCepError")); }
    finally { setBuscandoCep(false); }
  }

  if (!open) return null;

  async function handleSave() {
    if (!nome.trim()) { toast.error(t("clienteModal.toastNameRequired")); return; }
    // FIX: validação de e-mail antes de persistir
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error(t("clienteModal.toastInvalidEmail")); return;
    }
    setSaving(true);
    try {
      // FIX: slice garante que nenhum campo ultrapasse o limite antes de chegar ao banco
      const enderecoMontado = [logradouro.trim(), numero.trim(), bairro.trim(), municipio.trim(), uf.trim()]
        .filter(Boolean).join(", ");
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
      toast.success(inicial ? t("clienteModal.toastUpdated") : t("clienteModal.toastCreated"));
      onSuccess(data!);
    } catch (_e) {
      toast.error(t("clienteModal.toastSaveError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-card border border-border/30 shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/30">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-violet-500" />
            <p className="text-sm font-semibold">{inicial ? t("clienteModal.editTitle") : t("clienteModal.newTitle")}</p>
          </div>
          <button type="button" onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 space-y-3 max-h-[65vh] overflow-y-auto">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{t("clienteModal.name")}</label>
            <Input value={nome} onChange={e => setNome(e.target.value)} placeholder={t("clienteModal.namePlaceholder")} className="h-9 text-sm" autoFocus maxLength={200} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">{t("clienteModal.taxId")}</label>
              <Input value={documento} onChange={e => setDocumento(e.target.value)} placeholder={t("clienteModal.taxIdPlaceholder")} className="h-9 text-sm" maxLength={20} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">{t("clienteModal.phone")}</label>
              <Input value={telefone} onChange={e => setTelefone(e.target.value)} placeholder={t("clienteModal.phonePlaceholder")} className="h-9 text-sm" maxLength={20} />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{t("clienteModal.email")}</label>
            <Input value={email} onChange={e => setEmail(e.target.value)} placeholder={t("clienteModal.emailPlaceholder")} type="email" className="h-9 text-sm" maxLength={200} />
          </div>
          {/* CEP com busca automática */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">{t("clienteModal.postalCode")}</label>
              <div className="relative">
                <Input
                  value={cep}
                  onChange={e => {
                    const v = e.target.value.replace(/\D/g,"").slice(0,8);
                    const fmt = v.length > 5 ? v.slice(0,5) + "-" + v.slice(5) : v;
                    setCep(fmt);
                    if (v.length === 8) buscarCep(v);
                  }}
                  placeholder={t("clienteModal.postalCodePlaceholder")}
                  className="h-9 text-sm pr-8"
                  maxLength={9}
                />
                {buscandoCep && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                )}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">{t("clienteModal.number")}</label>
              <Input value={numero} onChange={e => setNumero(e.target.value)} placeholder={t("clienteModal.numberPlaceholder")} className="h-9 text-sm" maxLength={20} />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{t("clienteModal.street")}</label>
            <Input value={logradouro} onChange={e => setLogradouro(e.target.value)} placeholder={t("clienteModal.streetPlaceholder")} className="h-9 text-sm" maxLength={200} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">{t("clienteModal.neighborhood")}</label>
              <Input value={bairro} onChange={e => setBairro(e.target.value)} placeholder={t("clienteModal.neighborhoodPlaceholder")} className="h-9 text-sm" maxLength={100} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">{t("clienteModal.city")}</label>
              <div className="flex gap-1.5">
                <Input value={municipio} onChange={e => setMunicipio(e.target.value)} placeholder={t("clienteModal.cityPlaceholder")} className="h-9 text-sm flex-1" maxLength={100} />
                <Input value={uf} onChange={e => setUf(e.target.value.toUpperCase().slice(0,2))} placeholder={t("clienteModal.statePlaceholder")} className="h-9 text-sm w-12 text-center" maxLength={2} />
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{t("clienteModal.notes")}</label>
            <textarea value={obs} onChange={e => setObs(e.target.value)} placeholder={t("clienteModal.notesPlaceholder")} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none min-h-[60px] focus:outline-none focus:ring-2 focus:ring-ring" maxLength={1000} />
          </div>
        </div>
        <div className="flex gap-2 p-5 pt-0">
          <button type="button" onClick={onClose} disabled={saving} className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors">{t("clienteModal.cancel")}</button>
          <button type="button" onClick={handleSave} disabled={saving || !nome.trim()} className="flex-1 h-9 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5">
            {saving ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {inicial ? t("clienteModal.save") : t("clienteModal.register")}
          </button>
        </div>
      </div>
    </div>
  );
}
