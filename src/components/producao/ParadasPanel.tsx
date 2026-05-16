/**
 * ParadasPanel — Controle de Paradas Industriais
 * ✓ Dados reais via Supabase (tabela paradas_producao)
 * ✓ Fallback offline com IndexedDB
 * ✓ Cronômetro automático para paradas ativas
 */

import { useState, useEffect, useCallback } from "react";
import { Plus, X, OctagonPause, Clock, AlertTriangle, CheckCircle2, Search, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

type TipoParada = "planejada"|"nao_planejada";

interface Parada {
  id: string; maquina: string; motivo: string;
  tipo: TipoParada; inicio: string; fim?: string;
  duracao_min?: number; operador: string;
  observacoes?: string; user_id?: string; created_at?: string;
}

const MOTIVOS_PARADA = [
  "Manutenção Preventiva","Manutenção Corretiva","Falta de Material",
  "Setup / Troca de Ferramenta","Falta de Operador","Energia Elétrica",
  "Problema de Qualidade","Reunião / Treinamento","Refeição/Descanso","Outro",
];
const CORES = ["#3b82f6","#ef4444","#f59e0b","#8b5cf6","#06b6d4","#ec4899","#14b8a6","#f97316","#6366f1","#84cc16"];

function useCronometro(inicio?: string) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!inicio) return;
    const t = new Date(inicio).getTime();
    const update = () => setElapsed(Math.floor((Date.now()-t)/1000));
    update(); const id = setInterval(update,1000); return ()=>clearInterval(id);
  },[inicio]);
  return elapsed;
}

function fmt(s:number){const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;return h>0?`${h}h ${m.toString().padStart(2,"0")}m`:`${m.toString().padStart(2,"0")}:${sec.toString().padStart(2,"0")}`;}

function ParadaCard({parada,maquinas,onConcluir}:{parada:Parada;maquinas:string[];onConcluir:(id:string)=>void}) {
  const isAtiva = !parada.fim;
  const elapsed = useCronometro(isAtiva ? parada.inicio : undefined);
  return (
    <div className={cn("rounded-2xl border p-4 space-y-3 transition-all",
      isAtiva&&parada.tipo==="nao_planejada"?"bg-red-500/5 border-red-500/20":
      isAtiva?"bg-amber-500/5 border-amber-500/20":"bg-card/60 border-border/40 opacity-75")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm">{parada.maquina}</p>
          <p className="text-[11px] text-muted-foreground">{parada.motivo}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium",
            parada.tipo==="nao_planejada"?"bg-red-500/10 text-red-600":"bg-amber-500/10 text-amber-600")}>
            {parada.tipo==="nao_planejada"?"Não planejada":"Planejada"}
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{parada.operador}</span>
        <div className="flex items-center gap-1">
          <Clock className="h-3 w-3"/>
          {isAtiva ? <span className="font-mono font-medium text-foreground">{fmt(elapsed)}</span>
                   : <span>{parada.duracao_min}min</span>}
        </div>
      </div>
      {parada.observacoes && <p className="text-[11px] text-muted-foreground italic">{parada.observacoes}</p>}
      {isAtiva && (
        <Button size="sm" variant="outline" className="w-full h-7 text-[11px] gap-1" onClick={()=>onConcluir(parada.id)}>
          <CheckCircle2 className="h-3 w-3"/>Encerrar parada
        </Button>
      )}
    </div>
  );
}

function NovaParadaModal({open,onClose,onSaved,maquinas}:{open:boolean;onClose:()=>void;onSaved:(p:Parada)=>void;maquinas:string[]}) {
  const [form,setForm]=useState({maquina:"",motivo:"",tipo:"nao_planejada" as TipoParada,operador:"",observacoes:""});
  const [saving,setSaving]=useState(false);
  const {saveWithFallback}=useOfflineSync();
  const {user}=useAuth();
  useEffect(()=>{if(open)setForm({maquina:"",motivo:"",tipo:"nao_planejada",operador:"",observacoes:""});},[open]);
  if(!open) return null;

  async function save() {
    if(!form.maquina||!form.motivo||!form.operador){toast.error("Preencha os campos obrigatórios");return;}
    setSaving(true);
    const id=crypto.randomUUID();
    const data:Parada={id,maquina:form.maquina,motivo:form.motivo,tipo:form.tipo,
      inicio:new Date().toISOString(),operador:form.operador,observacoes:form.observacoes||undefined,user_id:user?.id,created_at:new Date().toISOString()};
    const {data:saved,error,savedOffline}=await saveWithFallback("paradas_producao","paradas","INSERT",data);
    setSaving(false);
    if(error){toast.error("Erro ao registrar parada");return;}
    toast.success(savedOffline?"Parada registrada offline":"Parada registrada!");
    onSaved(saved||data);onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-card rounded-2xl border shadow-xl p-5 space-y-4">
        <div className="flex items-center justify-between"><h3 className="font-semibold">Registrar Parada</h3><button onClick={onClose}><X className="h-4 w-4"/></button></div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Máquina *</label>
            {maquinas.length>0?(
              <select value={form.maquina} onChange={e=>setForm(p=>({...p,maquina:e.target.value}))} className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
                <option value="">Selecione...</option>{maquinas.map(m=><option key={m} value={m}>{m}</option>)}
              </select>
            ):<Input value={form.maquina} onChange={e=>setForm(p=>({...p,maquina:e.target.value}))} placeholder="Ex: CNC-01"/>}
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Motivo *</label>
            <select value={form.motivo} onChange={e=>setForm(p=>({...p,motivo:e.target.value}))} className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
              <option value="">Selecione...</option>{MOTIVOS_PARADA.map(m=><option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Tipo</label>
            <div className="flex gap-2">
              {(["planejada","nao_planejada"] as TipoParada[]).map(t=>(
                <button key={t} onClick={()=>setForm(p=>({...p,tipo:t}))}
                  className={cn("flex-1 h-9 rounded-lg border text-sm transition-colors",
                    form.tipo===t?"border-primary bg-primary/10 text-primary":"border-input hover:bg-muted/30")}>
                  {t==="planejada"?"Planejada":"Não planejada"}
                </button>
              ))}
            </div>
          </div>
          <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Operador *</label><Input value={form.operador} onChange={e=>setForm(p=>({...p,operador:e.target.value}))} placeholder="Nome do operador"/></div>
          <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Observações</label><Input value={form.observacoes} onChange={e=>setForm(p=>({...p,observacoes:e.target.value}))} placeholder="Opcional"/></div>
        </div>
        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button className="flex-1" onClick={save} disabled={saving}>{saving?"Salvando...":"Registrar"}</Button>
        </div>
      </div>
    </div>
  );
}

export function ParadasPanel() {
  const [paradas,setParadas]=useState<Parada[]>([]);
  const [maquinas,setMaquinas]=useState<string[]>([]);
  const [loading,setLoading]=useState(true);
  const [modalOpen,setModalOpen]=useState(false);
  const [search,setSearch]=useState("");
  const {loadWithFallback,saveWithFallback}=useOfflineSync();


  const load=useCallback(async()=>{
    setLoading(true);
    const data=await loadWithFallback<Parada>("paradas_producao","paradas");
    setParadas(data.sort((a,b)=>b.inicio.localeCompare(a.inicio)));
    if(navigator.onLine){
      const {data:maq}=await supabase.from("maquinas_producao").select("codigo").order("codigo");
      if(maq) setMaquinas(maq.map((m:{codigo:string})=>m.codigo));
    }
    setLoading(false);
  },[loadWithFallback]);

  useEffect(()=>{load();},[load]);

  async function handleConcluir(id:string) {
    const p=paradas.find(x=>x.id===id);if(!p) return;
    const fim=new Date().toISOString();
    const duracao_min=Math.round((new Date(fim).getTime()-new Date(p.inicio).getTime())/60000);
    const updated={...p,fim,duracao_min};
    const {error,savedOffline}=await saveWithFallback("paradas_producao","paradas","UPDATE",updated);
    if(error){toast.error("Erro ao encerrar parada");return;}
    toast.success(savedOffline?"Salvo offline":"Parada encerrada!");
    setParadas(prev=>prev.map(x=>x.id===id?updated:x));
  }

  const ativas=paradas.filter(p=>!p.fim);
  const filtered=paradas.filter(p=>!search||[p.maquina,p.motivo,p.operador].some(v=>v.toLowerCase().includes(search.toLowerCase())));

  // Dados para gráfico
  const motivosCount: Record<string,number>={};
  paradas.forEach(p=>{motivosCount[p.motivo]=(motivosCount[p.motivo]||0)+1;});
  const pieData=Object.entries(motivosCount).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value).slice(0,5);

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border bg-red-500/5 border-red-500/20 p-4 text-center"><p className="text-2xl font-bold text-red-600">{ativas.filter(p=>p.tipo==="nao_planejada").length}</p><p className="text-[11px] text-muted-foreground">Não planejadas ativas</p></div>
        <div className="rounded-2xl border bg-amber-500/5 border-amber-500/20 p-4 text-center"><p className="text-2xl font-bold text-amber-600">{ativas.length}</p><p className="text-[11px] text-muted-foreground">Total ativas</p></div>
        <div className="rounded-2xl border bg-card/60 p-4 text-center"><p className="text-2xl font-bold">{paradas.filter(p=>p.duracao_min).reduce((s,p)=>s+(p.duracao_min||0),0)}</p><p className="text-[11px] text-muted-foreground">Min parados hoje</p></div>
      </div>

      {pieData.length>0 && (
        <div className="rounded-2xl border bg-card/60 p-4">
          <p className="text-sm font-medium mb-3">Paradas por motivo</p>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart><Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value">
              {pieData.map((_,i)=><Cell key={i} fill={CORES[i%CORES.length]}/>)}
            </Pie><Tooltip/><Legend iconSize={10} wrapperStyle={{fontSize:"11px"}}/></PieChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="flex gap-2">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"/><Input className="pl-8 h-9 text-sm" placeholder="Buscar parada..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <Button size="sm" className="gap-1 h-9" onClick={()=>setModalOpen(true)}><Plus className="h-4 w-4"/>Registrar</Button>
        <Button size="sm" variant="outline" className="h-9 px-2" onClick={load} disabled={loading}><RefreshCw className={cn("h-4 w-4",loading&&"animate-spin")}/></Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2"><RefreshCw className="h-4 w-4 animate-spin"/>Carregando...</div>
      ) : filtered.length===0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-sm gap-2">
          <OctagonPause className="h-8 w-8 opacity-30"/><p>{paradas.length===0?"Nenhuma parada registrada":"Nenhum resultado"}</p>
        </div>
      ) : (
        <div className="space-y-3">{filtered.map(p=><ParadaCard key={p.id} parada={p} maquinas={maquinas} onConcluir={handleConcluir}/>)}</div>
      )}

      <NovaParadaModal open={modalOpen} onClose={()=>setModalOpen(false)} onSaved={p=>setParadas(prev=>[p,...prev])} maquinas={maquinas}/>
    </div>
  );
}
