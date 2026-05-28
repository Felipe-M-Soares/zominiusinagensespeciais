/**
 * PlanejamentoPanel — Planejamento de Produção
 * ✓ Dados reais via Supabase (tabela ordens_planejamento)
 * ✓ Fallback offline com IndexedDB
 */

import { useState, useEffect, useCallback } from "react";
import { Plus, X, CalendarClock, Factory, Search, RefreshCw, Edit2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

type OPStatus = "planejada"|"em_producao"|"concluida"|"cancelada";
type Prioridade = "baixa"|"normal"|"alta"|"urgente";

interface OrdemPlanejamento {
  id: string; numero: string; produto: string; maquina: string;
  turno: string; quantidade: number; data_inicio: string; data_fim: string;
  status: OPStatus; prioridade: Prioridade; capacidade: number;
  user_id?: string; created_at?: string; updated_at?: string;
}

const STATUS_CFG: Record<OPStatus,{label:string;color:string;bg:string}> = {
  planejada:   {label:"Planejada",   color:"text-blue-500",     bg:"bg-blue-500/10"},
  em_producao: {label:"Em Produção", color:"text-green-500",    bg:"bg-green-500/10"},
  concluida:   {label:"Concluída",   color:"text-primary",      bg:"bg-primary/10"},
  cancelada:   {label:"Cancelada",   color:"text-destructive",  bg:"bg-destructive/10"},
};
const PRIO_CFG: Record<Prioridade,{label:string;color:string}> = {
  baixa:   {label:"Baixa",   color:"text-muted-foreground"},
  normal:  {label:"Normal",  color:"text-blue-500"},
  alta:    {label:"Alta",    color:"text-amber-500"},
  urgente: {label:"Urgente", color:"text-destructive"},
};
const TURNOS = ["1º Turno","2º Turno","3º Turno"];

function OPModal({open,op,onClose,onSaved,maquinas,produtos}:{
  open:boolean; op?:OrdemPlanejamento; onClose:()=>void; onSaved:(o:OrdemPlanejamento)=>void;
  maquinas:string[]; produtos:string[];
}) {
  const {saveWithFallback}=useOfflineSync();
  const {user}=useAuth();
  const isEdit=!!op;
  const [form,setForm]=useState({
    produto:"",maquina:"",turno:"1º Turno",quantidade:"",
    data_inicio:"",data_fim:"",prioridade:"normal" as Prioridade,capacidade:"70",
  });
  const [saving,setSaving]=useState(false);

  useEffect(()=>{
    if(open) setForm({
      produto:op?.produto||"",maquina:op?.maquina||"",turno:op?.turno||"1º Turno",
      quantidade:String(op?.quantidade||""),data_inicio:op?.data_inicio||"",data_fim:op?.data_fim||"",
      prioridade:op?.prioridade||"normal",capacidade:String(op?.capacidade||"70"),
    });
  },[open,op]);

  if(!open) return null;

  async function save() {
    if(!form.produto||!form.maquina||!form.quantidade||!form.data_inicio||!form.data_fim){
      toast.error("Preencha todos os campos obrigatórios"); return;
    }
    setSaving(true);
    const id=op?.id||crypto.randomUUID();
    const numero=op?.numero||`OP-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
    const data:OrdemPlanejamento={
      id,numero,produto:form.produto,maquina:form.maquina,turno:form.turno,
      quantidade:Number(form.quantidade),data_inicio:form.data_inicio,data_fim:form.data_fim,
      status:op?.status||"planejada",prioridade:form.prioridade,
      capacidade:Number(form.capacidade)||70,user_id:user?.id,
    };
    const {data:saved,error,savedOffline}=await saveWithFallback(
      "ordens_planejamento","ordens_planejamento",isEdit?"UPDATE":"INSERT",data
    );
    setSaving(false);
    if(error){toast.error("Erro ao salvar OP");return;}
    toast.success(savedOffline?"Salvo offline":isEdit?"OP atualizada!":"OP criada!");
    onSaved(saved||data); onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-card rounded-xl border shadow-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{isEdit?"Editar OP":"Nova Ordem de Produção"}</h3>
          <button onClick={onClose} aria-label="Fechar"><X className="h-4 w-4"/></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Produto *</label>
            {produtos.length>0
              ? <select value={form.produto} onChange={e=>setForm(p=>({...p,produto:e.target.value}))} className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm"><option value="">Selecione...</option>{produtos.map(p=><option key={p} value={p}>{p}</option>)}</select>
              : <Input value={form.produto} onChange={e=>setForm(p=>({...p,produto:e.target.value}))} placeholder="Produto"/>}
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Máquina *</label>
            {maquinas.length>0
              ? <select value={form.maquina} onChange={e=>setForm(p=>({...p,maquina:e.target.value}))} className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm"><option value="">Selecione...</option>{maquinas.map(m=><option key={m} value={m}>{m}</option>)}</select>
              : <Input value={form.maquina} onChange={e=>setForm(p=>({...p,maquina:e.target.value}))} placeholder="Máquina"/>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Turno</label>
              <select value={form.turno} onChange={e=>setForm(p=>({...p,turno:e.target.value}))} className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
                {TURNOS.map(t=><option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Quantidade *</label><Input type="number" value={form.quantidade} onChange={e=>setForm(p=>({...p,quantidade:e.target.value}))} placeholder="0"/></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Início *</label><Input type="date" value={form.data_inicio} onChange={e=>setForm(p=>({...p,data_inicio:e.target.value}))}/></div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Fim *</label><Input type="date" value={form.data_fim} onChange={e=>setForm(p=>({...p,data_fim:e.target.value}))}/></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Prioridade</label>
              <select value={form.prioridade} onChange={e=>setForm(p=>({...p,prioridade:e.target.value as Prioridade}))} className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
                {(Object.entries(PRIO_CFG)).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Capacidade (%)</label><Input type="number" min="0" max="100" value={form.capacidade} onChange={e=>setForm(p=>({...p,capacidade:e.target.value}))}/></div>
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button className="flex-1" onClick={save} disabled={saving}>{saving?"Salvando...":"Salvar"}</Button>
        </div>
      </div>
    </div>
  );
}

export function PlanejamentoPanel({ isAdmin }: { isAdmin: boolean }) {
  const [ops,setOps]=useState<OrdemPlanejamento[]>([]);
  const [maquinas,setMaquinas]=useState<string[]>([]);
  const [produtos,setProdutos]=useState<string[]>([]);
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState("");
  const [filtroStatus,setFiltroStatus]=useState<"todos"|OPStatus>("todos");
  const [modalOpen,setModalOpen]=useState(false);
  const [editTarget,setEditTarget]=useState<OrdemPlanejamento|undefined>();
  const {loadWithFallback,saveWithFallback}=useOfflineSync();

  const load=useCallback(async()=>{
    setLoading(true);
    const data=await loadWithFallback<OrdemPlanejamento>("ordens_planejamento","ordens_planejamento");
    setOps(data.sort((a,b)=>b.data_inicio.localeCompare(a.data_inicio)));
    if(navigator.onLine){
      const [{data:maq},{data:prod}]=await Promise.all([
        supabase.from("maquinas_producao").select("codigo").order("codigo"),
        supabase.from("produtos_producao").select("codigo,descricao").eq("ativo",true).order("codigo"),
      ]);
      if(maq) setMaquinas(maq.map((m:{codigo:string})=>m.codigo));
      if(prod) setProdutos(prod.map((p:{codigo:string;descricao:string})=>`${p.codigo} ${p.descricao}`));
    }
    setLoading(false);
  },[loadWithFallback]);

  useEffect(()=>{load();},[load]);

  async function handleStatusChange(id:string,status:OPStatus){
    const op=ops.find(o=>o.id===id);if(!op) return;
    const updated={...op,status};
    const {error,savedOffline}=await saveWithFallback("ordens_planejamento","ordens_planejamento","UPDATE",updated);
    if(error){toast.error("Erro ao atualizar status");return;}
    toast.success(savedOffline?"Salvo offline":"Status atualizado!");
    setOps(prev=>prev.map(o=>o.id===id?updated:o));
  }

  async function handleDelete(id:string){
    if(!confirm("Remover esta OP?")) return;
    await saveWithFallback("ordens_planejamento","ordens_planejamento","DELETE",{id} as OrdemPlanejamento);
    setOps(prev=>prev.filter(o=>o.id!==id));
    toast.success("OP removida");
  }

  const filtered=ops.filter(o=>{
    const matchSearch=!search||[o.numero,o.produto,o.maquina].some(v=>v.toLowerCase().includes(search.toLowerCase()));
    const matchStatus=filtroStatus==="todos"||o.status===filtroStatus;
    return matchSearch&&matchStatus;
  });

  // Dados de carga por máquina para gráfico
  const cargaMap:Record<string,number>={};
  ops.filter(o=>o.status==="em_producao"||o.status==="planejada").forEach(o=>{cargaMap[o.maquina]=Math.max(cargaMap[o.maquina]||0,o.capacidade);});
  const cargaData=Object.entries(cargaMap).map(([maquina,carga])=>({maquina,carga}));

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {cargaData.length>0 && (
        <div className="rounded-xl border bg-card/60 p-4">
          <p className="text-sm font-medium mb-3">Carga por Máquina (%)</p>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={cargaData} margin={{top:0,right:0,left:-20,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))"/>
              <XAxis dataKey="maquina" tick={{fontSize:10}}/>
              <YAxis domain={[0,100]} tick={{fontSize:10}}/>
              <Tooltip/>
              <Bar dataKey="carga" fill="hsl(var(--primary))" radius={[4,4,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="flex gap-2">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"/><Input className="pl-8 h-9 text-sm" placeholder="Buscar OP..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <select value={filtroStatus} onChange={e=>setFiltroStatus(e.target.value as typeof filtroStatus)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm">
          <option value="todos">Todos</option>
          {(Object.keys(STATUS_CFG) as OPStatus[]).map(s=><option key={s} value={s}>{STATUS_CFG[s].label}</option>)}
        </select>
        <Button size="sm" className="gap-1 h-9" onClick={()=>{setEditTarget(undefined);setModalOpen(true);}}><Plus className="h-4 w-4"/>Nova OP</Button>
        <Button size="sm" variant="outline" className="h-9 px-2" onClick={load} disabled={loading}><RefreshCw className={cn("h-4 w-4",loading&&"animate-spin")}/></Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2"><RefreshCw className="h-4 w-4 animate-spin"/>Carregando...</div>
      ) : filtered.length===0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-sm gap-2">
          <CalendarClock className="h-8 w-8 opacity-30"/><p>{ops.length===0?"Nenhuma ordem criada":"Nenhum resultado"}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(op=>{
            const sc=STATUS_CFG[op.status];
            const pc=PRIO_CFG[op.prioridade];
            return (
              <div key={op.id} className="rounded-xl border bg-card/60 p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm">{op.numero}</p>
                      <span className={cn("text-[10px] font-medium",pc.color)}>{pc.label}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">{op.produto}</p>
                    <p className="text-[10px] text-muted-foreground">{op.maquina} · {op.turno}</p>
                  </div>
                  <Badge variant="outline" className={cn("text-[10px] shrink-0",sc.color)}>{sc.label}</Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <div><span className="text-muted-foreground">Qtd:</span> <b>{op.quantidade.toLocaleString("pt-BR")}</b></div>
                  <div><span className="text-muted-foreground">Início:</span> <b>{new Date(op.data_inicio+"T00:00:00").toLocaleDateString("pt-BR")}</b></div>
                  <div><span className="text-muted-foreground">Fim:</span> <b>{new Date(op.data_fim+"T00:00:00").toLocaleDateString("pt-BR")}</b></div>
                </div>
                <div>
                  <div className="flex justify-between text-[10px] text-muted-foreground mb-1"><span>Capacidade utilizada</span><span>{op.capacidade}%</span></div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className={cn("h-full rounded-full",op.capacidade>=90?"bg-red-500":op.capacidade>=70?"bg-amber-500":"bg-green-500")} style={{width:`${op.capacidade}%`}}/></div>
                </div>
                <div className="flex items-center gap-2 pt-1 border-t border-border">
                  <select value={op.status} onChange={e=>handleStatusChange(op.id,e.target.value as OPStatus)}
                    className="flex-1 h-7 rounded-lg border border-input bg-background px-2 text-[11px]">
                    {(Object.keys(STATUS_CFG) as OPStatus[]).map(s=><option key={s} value={s}>{STATUS_CFG[s].label}</option>)}
                  </select>
                  {isAdmin && <>
                    <button onClick={()=>{setEditTarget(op);setModalOpen(true);}} aria-label="Editar operação" className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/50"><Edit2 className="h-3.5 w-3.5"/></button>
                    <button onClick={()=>handleDelete(op.id)} aria-label="Excluir operação" className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-destructive/10 text-destructive"><Trash2 className="h-3.5 w-3.5"/></button>
                  </>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <OPModal open={modalOpen} op={editTarget} onClose={()=>setModalOpen(false)}
        onSaved={o=>{setOps(prev=>editTarget?prev.map(x=>x.id===o.id?o:x):[o,...prev]);}}
        maquinas={maquinas} produtos={produtos}/>
    </div>
  );
}
