import { useState, useEffect, useCallback } from "react";
import { Target, Plus, RefreshCw, X, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Meta { id:string; mes:number; ano:number; maquina_codigo:string|null; meta_pecas:number; meta_oee_pct:number; meta_disponibilidade_pct:number; meta_qualidade_pct:number; }
interface OEEReal { oee:number; disponibilidade:number; performance:number; qualidade:number; qtde_produzida:number; }

const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

export function MetasPanel() {
  const now = new Date();
  const [mes, setMes] = useState(now.getMonth()+1);
  const [ano, setAno] = useState(now.getFullYear());
  const [metas, setMetas] = useState<Meta[]>([]);
  const [oeeReal, setOeeReal] = useState<OEEReal|null>(null);
  const [maquinas, setMaquinas] = useState<{codigo:string}[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ maquina_codigo:"", meta_pecas:"0", meta_oee_pct:"85", meta_disponibilidade_pct:"90", meta_qualidade_pct:"98" });

  const load = useCallback(async()=>{
    setLoading(true);
    const ini = `${ano}-${String(mes).padStart(2,"0")}-01`;
    const fim = new Date(ano,mes,0).toISOString().split("T")[0];
    const[{data:m},{data:oee},{data:maq}] = await Promise.all([
      supabase.from("metas_producao").select("*").eq("mes",mes).eq("ano",ano).order("maquina_codigo"),
      (supabase.rpc as any)("calcular_oee",{p_data_ini:ini,p_data_fim:fim,p_maquina:null}),
      supabase.from("maquinas_producao").select("codigo").order("codigo"),
    ]);
    if(m) setMetas(m as Meta[]);
    if(oee) setOeeReal(oee as OEEReal);
    if(maq) setMaquinas(maq);
    setLoading(false);
  },[mes,ano]);

  useEffect(()=>{load();},[load]);

  async function save() {
    const{error}=await supabase.from("metas_producao").upsert({
      mes, ano,
      maquina_codigo: form.maquina_codigo||null,
      meta_pecas: parseInt(form.meta_pecas)||0,
      meta_oee_pct: parseFloat(form.meta_oee_pct)||85,
      meta_disponibilidade_pct: parseFloat(form.meta_disponibilidade_pct)||90,
      meta_qualidade_pct: parseFloat(form.meta_qualidade_pct)||98,
    },{onConflict:"mes,ano,maquina_codigo"});
    if(error){toast.error(error.message);return;}
    toast.success("Meta salva!");
    setModal(false); load();
  }

  function gauge(real:number, meta:number) {
    const pct = meta>0 ? Math.min(100,Math.round(real/meta*100)) : 0;
    const ok = real>=meta;
    return { pct, ok, color: ok?"bg-green-500":"bg-red-500" };
  }

  const metaGeral = metas.find(m=>!m.maquina_codigo);
  const lbl="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block";
  const sel="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="flex items-center gap-2 flex-wrap">
        <select value={mes} onChange={e=>setMes(Number(e.target.value))} className="h-9 rounded-lg border border-input bg-background px-3 text-sm">
          {MESES.map((m,i)=><option key={i} value={i+1}>{m}</option>)}
        </select>
        <select value={ano} onChange={e=>setAno(Number(e.target.value))} className="h-9 rounded-lg border border-input bg-background px-3 text-sm">
          {[2024,2025,2026,2027].map(y=><option key={y}>{y}</option>)}
        </select>
        <button onClick={load} className="h-9 w-9 flex items-center justify-center rounded-lg border border-input hover:bg-muted/40"><RefreshCw className={cn("h-4 w-4 text-muted-foreground",loading&&"animate-spin")}/></button>
        <Button size="sm" className="h-9 gap-1 ml-auto" onClick={()=>setModal(true)}><Plus className="h-4 w-4"/>Definir Meta</Button>
      </div>

      {/* Comparativo geral */}
      {oeeReal && metaGeral && (
        <div className="rounded-2xl border border-border/40 bg-card p-4 space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Target className="h-4 w-4 text-primary"/>Realizado vs Meta — {MESES[mes-1]}/{ano}</h3>
          {[
            {label:"OEE",real:oeeReal.oee,meta:metaGeral.meta_oee_pct},
            {label:"Disponibilidade",real:oeeReal.disponibilidade,meta:metaGeral.meta_disponibilidade_pct},
            {label:"Qualidade",real:oeeReal.qualidade,meta:metaGeral.meta_qualidade_pct},
          ].map(({label,real,meta})=>{
            const g=gauge(real,meta);
            return (
              <div key={label} className="space-y-1">
                <div className="flex justify-between text-[12px]">
                  <span>{label}</span>
                  <div className="flex items-center gap-1.5">
                    <span className={g.ok?"text-green-600 font-bold":"text-red-600 font-bold"}>{real.toFixed(1)}%</span>
                    <span className="text-muted-foreground text-[10px]">/ meta {meta}%</span>
                    {g.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600"/> : <AlertTriangle className="h-3.5 w-3.5 text-red-500"/>}
                  </div>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className={cn("h-full rounded-full transition-all",g.color)} style={{width:`${g.pct}%`}}/>
                </div>
              </div>
            );
          })}
          {metaGeral.meta_pecas>0&&(
            <div className="space-y-1">
              <div className="flex justify-between text-[12px]">
                <span>Peças Produzidas</span>
                <span className={oeeReal.qtde_produzida>=metaGeral.meta_pecas?"text-green-600 font-bold":"text-red-600 font-bold"}>
                  {oeeReal.qtde_produzida.toLocaleString("pt-BR")} / {metaGeral.meta_pecas.toLocaleString("pt-BR")}
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className={cn("h-full rounded-full",oeeReal.qtde_produzida>=metaGeral.meta_pecas?"bg-green-500":"bg-red-500")} style={{width:`${Math.min(100,Math.round(oeeReal.qtde_produzida/metaGeral.meta_pecas*100))}%`}}/>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lista de metas */}
      {metas.length===0 && !loading && (
        <div className="text-center py-10 text-muted-foreground text-sm"><Target className="h-8 w-8 mx-auto opacity-20 mb-2"/><p>Nenhuma meta definida para {MESES[mes-1]}/{ano}</p></div>
      )}
      {metas.map(m=>(
        <div key={m.id} className="rounded-2xl border border-border/40 bg-card px-4 py-3">
          <p className="text-sm font-medium">{m.maquina_codigo?`Máquina ${m.maquina_codigo}`:"Geral"}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-[11px]">
            <div><p className="text-muted-foreground">Meta OEE</p><p className="font-bold">{m.meta_oee_pct}%</p></div>
            <div><p className="text-muted-foreground">Disponib.</p><p className="font-bold">{m.meta_disponibilidade_pct}%</p></div>
            <div><p className="text-muted-foreground">Qualidade</p><p className="font-bold">{m.meta_qualidade_pct}%</p></div>
            <div><p className="text-muted-foreground">Peças</p><p className="font-bold">{m.meta_pecas.toLocaleString("pt-BR")}</p></div>
          </div>
        </div>
      ))}

      {modal&&(
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
          <div className="w-full max-w-sm bg-card rounded-t-2xl sm:rounded-2xl border border-border/40 shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/30">
              <h3 className="font-semibold text-sm">Definir Meta — {MESES[mes-1]}/{ano}</h3>
              <button onClick={()=>setModal(false)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40"><X className="h-4 w-4"/></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div><label className={lbl}>Máquina (vazio = geral)</label>
                <select value={form.maquina_codigo} onChange={e=>setForm(f=>({...f,maquina_codigo:e.target.value}))} className={sel}>
                  <option value="">Geral (todas as máquinas)</option>
                  {maquinas.map(m=><option key={m.codigo} value={m.codigo}>{m.codigo}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={lbl}>Meta OEE %</label><Input type="number" min="0" max="100" step="0.1" value={form.meta_oee_pct} onChange={e=>setForm(f=>({...f,meta_oee_pct:e.target.value}))} className="h-9"/></div>
                <div><label className={lbl}>Disponib. %</label><Input type="number" min="0" max="100" step="0.1" value={form.meta_disponibilidade_pct} onChange={e=>setForm(f=>({...f,meta_disponibilidade_pct:e.target.value}))} className="h-9"/></div>
                <div><label className={lbl}>Qualidade %</label><Input type="number" min="0" max="100" step="0.1" value={form.meta_qualidade_pct} onChange={e=>setForm(f=>({...f,meta_qualidade_pct:e.target.value}))} className="h-9"/></div>
                <div><label className={lbl}>Meta Peças</label><Input type="number" min="0" value={form.meta_pecas} onChange={e=>setForm(f=>({...f,meta_pecas:e.target.value}))} className="h-9"/></div>
              </div>
            </div>
            <div className="flex gap-3 px-5 py-4 border-t border-border/30">
              <Button variant="outline" className="flex-1" onClick={()=>setModal(false)}>Cancelar</Button>
              <Button className="flex-1" onClick={save}>Salvar Meta</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
