import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, Wrench, AlertTriangle, RefreshCw, X, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Ferramenta { id:string; codigo:string; descricao:string; tipo:string; maquina_codigo:string|null; vida_util_pecas:number; pecas_produzidas:number; status:string; ultima_troca:string|null; custo_unitario:number|null; }

const TIPOS=["broca","inserto","pastilha","fresa","alargador","outros"];

function pct(f:Ferramenta):number {
  if(f.vida_util_pecas<=0) return 0;
  return Math.min(100,Math.round(f.pecas_produzidas/f.vida_util_pecas*100));
}

export function FerramentasPanel() {
  const [items,setItems]=useState<Ferramenta[]>([]);
  const [loading,setLoading]=useState(true);
  const [modal,setModal]=useState(false);
  const [form,setForm]=useState({codigo:"",descricao:"",tipo:"broca",maquina_codigo:"",vida_util_pecas:"0",custo_unitario:""});
  const [maquinas,setMaquinas]=useState<{codigo:string;nome:string}[]>([]);

  const load=useCallback(async()=>{
    setLoading(true);
    // Atualiza status baseado em % de uso antes de carregar
    await supabase.rpc("atualizar_status_ferramentas").catch(() => null);
    const[{data:f},{data:m}]=await Promise.all([
      supabase.from("ferramentas_cnc").select("*").order("status").order("codigo"),
      supabase.from("maquinas_producao").select("codigo,nome").order("codigo"),
    ]);
    if(f) setItems(f as Ferramenta[]);
    if(m) setMaquinas(m);
    setLoading(false);
  },[]);

  useEffect(()=>{load();},[load]);

  async function save() {
    if(!form.codigo||!form.descricao){toast.error("Código e descrição obrigatórios");return;}
    const{error}=await supabase.from("ferramentas_cnc").insert({
      ...form, vida_util_pecas:parseInt(form.vida_util_pecas)||0,
      custo_unitario:form.custo_unitario?parseFloat(form.custo_unitario):null,
      maquina_codigo:form.maquina_codigo||null,
    });
    if(error){toast.error(error.message);return;}
    toast.success("Ferramenta cadastrada!");
    setModal(false); load();
  }

  async function trocar(id:string) {
    await supabase.from("ferramentas_cnc").update({pecas_produzidas:0,status:"ativo",ultima_troca:new Date().toISOString().split("T")[0]}).eq("id",id);
    toast.success("Troca registrada!");
    load();
  }

  const statusColor=(s:string)=>s==="substituir"?"text-red-600 bg-red-500/10":s==="alerta"?"text-amber-600 bg-amber-500/10":s==="ativo"?"text-green-600 bg-green-500/10":"text-muted-foreground bg-muted/20";

  const lbl="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block";
  const sel="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">{items.filter(f=>f.status==="alerta"||f.status==="substituir").length} ferramentas precisam de atenção</p>
        <div className="flex gap-2">
          <button onClick={load} className="h-8 w-8 flex items-center justify-center rounded-lg border border-input hover:bg-muted/40"><RefreshCw className={cn("h-4 w-4 text-muted-foreground",loading&&"animate-spin")}/></button>
          <Button size="sm" className="h-8 gap-1" onClick={()=>setModal(true)}><Plus className="h-3.5 w-3.5"/>Cadastrar</Button>
        </div>
      </div>

      <div className="space-y-2">
        {loading&&items.length===0?<div className="flex justify-center py-10 text-muted-foreground text-sm gap-2"><RefreshCw className="h-4 w-4 animate-spin"/>Carregando...</div>
        :items.length===0?<div className="text-center py-10 text-muted-foreground text-sm"><Wrench className="h-8 w-8 mx-auto opacity-20 mb-2"/><p>Nenhuma ferramenta cadastrada</p></div>
        :items.map(f=>{
          const p=pct(f);
          return (
            <div key={f.id} className={cn("rounded-2xl border px-4 py-3 space-y-2",f.status==="substituir"?"border-red-500/20 bg-red-500/5":f.status==="alerta"?"border-amber-500/20 bg-amber-500/5":"border-border/40 bg-card")}>
              <div className="flex items-center gap-3">
                <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center shrink-0",statusColor(f.status))}>
                  <Wrench className="h-4 w-4"/>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{f.codigo}</p>
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium",statusColor(f.status))}>{f.status}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{f.descricao} · {f.tipo}{f.maquina_codigo&&` · ${f.maquina_codigo}`}</p>
                </div>
                {(f.status==="alerta"||f.status==="substituir")&&(
                  <button onClick={()=>trocar(f.id)} className="h-7 px-2 flex items-center gap-1 rounded-lg bg-green-500/10 text-green-600 text-[11px] font-medium hover:bg-green-500/20 transition-colors">
                    <CheckCircle2 className="h-3.5 w-3.5"/>Trocar
                  </button>
                )}
              </div>
              {f.vida_util_pecas>0&&(
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>{f.pecas_produzidas.toLocaleString("pt-BR")} / {f.vida_util_pecas.toLocaleString("pt-BR")} peças</span>
                    <span>{p}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all",p>=90?"bg-red-500":p>=70?"bg-amber-500":"bg-green-500")} style={{width:`${p}%`}}/>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {modal&&(
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
          <div className="w-full max-w-md bg-card rounded-t-2xl sm:rounded-2xl border border-border/40 shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/30">
              <h3 className="font-semibold text-sm">Nova Ferramenta</h3>
              <button onClick={()=>setModal(false)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40"><X className="h-4 w-4"/></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className={lbl}>Código *</label><Input value={form.codigo} onChange={e=>setForm(f=>({...f,codigo:e.target.value}))} className="h-9"/></div>
                <div><label className={lbl}>Tipo</label><select value={form.tipo} onChange={e=>setForm(f=>({...f,tipo:e.target.value}))} className={sel}>{TIPOS.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
              </div>
              <div><label className={lbl}>Descrição *</label><Input value={form.descricao} onChange={e=>setForm(f=>({...f,descricao:e.target.value}))} className="h-9"/></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={lbl}>Máquina</label>
                  <select value={form.maquina_codigo} onChange={e=>setForm(f=>({...f,maquina_codigo:e.target.value}))} className={sel}>
                    <option value="">Todas</option>
                    {maquinas.map(m=><option key={m.codigo} value={m.codigo}>{m.codigo} — {m.nome}</option>)}
                  </select>
                </div>
                <div><label className={lbl}>Vida Útil (peças)</label><Input type="number" min="0" value={form.vida_util_pecas} onChange={e=>setForm(f=>({...f,vida_util_pecas:e.target.value}))} className="h-9"/></div>
              </div>
            </div>
            <div className="flex gap-3 px-5 py-4 border-t border-border/30">
              <Button variant="outline" className="flex-1" onClick={()=>setModal(false)}>Cancelar</Button>
              <Button className="flex-1" onClick={save}>Cadastrar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
