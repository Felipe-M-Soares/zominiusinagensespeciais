import { useState, useEffect, useCallback } from "react";
import { Plus, Shield, AlertTriangle, RefreshCw, X, Upload, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Cert { id:string; nome:string; tipo:string; numero:string|null; orgao_emissor:string|null; data_emissao:string|null; data_validade:string|null; arquivo_url:string|null; status:string; alerta_dias:number; observacoes:string|null; }

const TIPOS=["iso","anvisa","inmetro","laudo","certificado","outros"];

function diasRestantes(validade:string|null):number|null {
  if(!validade) return null;
  return Math.ceil((new Date(validade).getTime()-Date.now())/(1000*60*60*24));
}

function statusAuto(c:Cert):string {
  const d=diasRestantes(c.data_validade);
  if(d===null) return "valido";
  if(d<0) return "vencido";
  if(d<=c.alerta_dias) return "vencendo";
  return "valido";
}

const statusStyle=(s:string)=>s==="vencido"?"text-red-600 bg-red-500/10 border-red-500/20":s==="vencendo"?"text-amber-600 bg-amber-500/10 border-amber-500/20":"text-green-600 bg-green-500/10 border-green-500/20";

export function CertificadosPanel() {
  const [items,setItems]=useState<Cert[]>([]);
  const [loading,setLoading]=useState(true);
  const [modal,setModal]=useState(false);
  const [form,setForm]=useState({nome:"",tipo:"iso",numero:"",orgao_emissor:"",data_emissao:"",data_validade:"",alerta_dias:"90",observacoes:""});
  const [file,setFile]=useState<File|null>(null);
  const [saving,setSaving]=useState(false);

  const load=useCallback(async()=>{
    setLoading(true);
    const{data}=await supabase.from("certificados").select("*").order("data_validade");
    if(data) setItems(data as Cert[]);
    setLoading(false);
  },[]);

  useEffect(()=>{load();},[load]);

  async function save() {
    if(!form.nome){toast.error("Nome obrigatório");return;}
    setSaving(true);
    let arquivo_url:string|null=null;

    if(file) {
      const path=`${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
      const{error:upErr}=await supabase.storage.from("certificados").upload(path,file,{upsert:true});
      if(!upErr){
        const{data:urlData}=supabase.storage.from("certificados").getPublicUrl(path);
        arquivo_url=urlData.publicUrl;
      }
    }

    const{error}=await supabase.from("certificados").insert({
      nome:form.nome, tipo:form.tipo, numero:form.numero||null,
      orgao_emissor:form.orgao_emissor||null,
      data_emissao:form.data_emissao||null, data_validade:form.data_validade||null,
      alerta_dias:parseInt(form.alerta_dias)||90,
      observacoes:form.observacoes||null, arquivo_url,
      status:"valido",
    });
    setSaving(false);
    if(error){toast.error(error.message);return;}
    toast.success("Certificado cadastrado!");
    setModal(false); load();
  }

  const lbl="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block";
  const sel="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] text-muted-foreground">
            {items.filter(c=>statusAuto(c)==="vencido").length} vencidos ·{" "}
            {items.filter(c=>statusAuto(c)==="vencendo").length} vencendo em breve
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="h-8 w-8 flex items-center justify-center rounded-lg border border-input hover:bg-muted/40"><RefreshCw className={cn("h-4 w-4 text-muted-foreground",loading&&"animate-spin")}/></button>
          <Button size="sm" className="h-8 gap-1" onClick={()=>setModal(true)}><Plus className="h-3.5 w-3.5"/>Cadastrar</Button>
        </div>
      </div>

      <div className="space-y-2">
        {loading&&items.length===0?<div className="flex justify-center py-10 text-muted-foreground text-sm gap-2"><RefreshCw className="h-4 w-4 animate-spin"/>Carregando...</div>
        :items.length===0?<div className="text-center py-10 text-muted-foreground text-sm"><Shield className="h-8 w-8 mx-auto opacity-20 mb-2"/><p>Nenhum certificado cadastrado</p></div>
        :items.map(c=>{
          const s=statusAuto(c);
          const d=diasRestantes(c.data_validade);
          return(
            <div key={c.id} className={cn("rounded-2xl border px-4 py-3",statusStyle(s))}>
              <div className="flex items-center gap-3">
                <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center shrink-0",statusStyle(s))}>
                  {s==="vencido"||s==="vencendo"?<AlertTriangle className="h-4 w-4"/>:<Shield className="h-4 w-4"/>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold truncate">{c.nome}</p>
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium",statusStyle(s))}>{s}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap mt-0.5">
                    {c.orgao_emissor&&<span>{c.orgao_emissor}</span>}
                    {c.numero&&<span>Nº {c.numero}</span>}
                    {c.data_validade&&<span>Vence: {new Date(c.data_validade+"T12:00:00").toLocaleDateString("pt-BR")}</span>}
                    {d!==null&&d>=0&&<span className="font-medium">({d} dias)</span>}
                    {d!==null&&d<0&&<span className="font-medium text-red-600">({Math.abs(d)} dias vencido)</span>}
                  </div>
                </div>
                {c.arquivo_url&&(
                  <a href={c.arquivo_url} target="_blank" rel="noopener noreferrer" className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors">
                    <ExternalLink className="h-3.5 w-3.5"/>
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {modal&&(
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
          <div className="w-full max-w-md bg-card rounded-t-2xl sm:rounded-2xl border border-border/40 shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/30 shrink-0">
              <h3 className="font-semibold text-sm">Novo Certificado</h3>
              <button onClick={()=>setModal(false)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40"><X className="h-4 w-4"/></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              <div><label className={lbl}>Nome *</label><Input value={form.nome} onChange={e=>setForm(f=>({...f,nome:e.target.value}))} className="h-9"/></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={lbl}>Tipo</label><select value={form.tipo} onChange={e=>setForm(f=>({...f,tipo:e.target.value}))} className={sel}>{TIPOS.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
                <div><label className={lbl}>Número</label><Input value={form.numero} onChange={e=>setForm(f=>({...f,numero:e.target.value}))} className="h-9"/></div>
              </div>
              <div><label className={lbl}>Órgão Emissor</label><Input value={form.orgao_emissor} onChange={e=>setForm(f=>({...f,orgao_emissor:e.target.value}))} className="h-9"/></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={lbl}>Data Emissão</label><input type="date" value={form.data_emissao} onChange={e=>setForm(f=>({...f,data_emissao:e.target.value}))} className={sel}/></div>
                <div><label className={lbl}>Data Validade</label><input type="date" value={form.data_validade} onChange={e=>setForm(f=>({...f,data_validade:e.target.value}))} className={sel}/></div>
              </div>
              <div><label className={lbl}>Alertar com antecedência (dias)</label><Input type="number" min="1" value={form.alerta_dias} onChange={e=>setForm(f=>({...f,alerta_dias:e.target.value}))} className="h-9"/></div>
              <div>
                <label className={lbl}>Arquivo (PDF/imagem)</label>
                <label className="flex items-center gap-2 h-9 rounded-lg border border-input bg-background px-3 text-sm cursor-pointer hover:bg-muted/20 transition-colors">
                  <Upload className="h-4 w-4 text-muted-foreground"/>
                  <span className="text-muted-foreground">{file?file.name:"Selecionar arquivo..."}</span>
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" onChange={e=>{if(e.target.files?.[0]) setFile(e.target.files[0]);}}/>
                </label>
              </div>
            </div>
            <div className="flex gap-3 px-5 py-4 border-t border-border/30 shrink-0">
              <Button variant="outline" className="flex-1" onClick={()=>setModal(false)}>Cancelar</Button>
              <Button className="flex-1" onClick={save} disabled={saving}>{saving?"Salvando...":"Cadastrar"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
