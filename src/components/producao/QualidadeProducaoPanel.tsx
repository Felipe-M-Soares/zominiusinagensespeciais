/**
 * QualidadeProducaoPanel — Controle de Refugo e Qualidade
 * ✓ Dados reais via Supabase (tabela refugos_producao)
 * ✓ Fallback offline com IndexedDB
 */

import { useState, useEffect, useCallback } from "react";
import { Plus, X, Search, ShieldAlert, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchInputWithBarcode } from "@/components/SearchInputWithBarcode";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";

type TipoDefeito = "dimensional"|"superficial"|"material"|"montagem"|"outro";
type Destinacao = "retrabalho"|"sucata"|"devolucao";

interface Refugo {
  id: string; produto: string; lote: string; maquina: string;
  operador: string; tipo_defeito: TipoDefeito; motivo: string;
  quantidade: number; destinacao: Destinacao;
  medicoes: {campo:string;nominal:number;medido:number;tolerancia:number}[];
  observacoes?: string; user_id?: string; created_at?: string;
}

function buildDefeitoLabel(t: (k: string) => string): Record<TipoDefeito,string> {
  return {
  dimensional:t("qualidadeProducaoPanel.defect.dimensional"), superficial:t("qualidadeProducaoPanel.defect.superficial"),
  material:t("qualidadeProducaoPanel.defect.material"), montagem:t("qualidadeProducaoPanel.defect.montagem"), outro:t("qualidadeProducaoPanel.defect.outro"),
  };
}
function buildDestinacaoLabel(t: (k: string) => string): Record<Destinacao,string> {
  return {
  retrabalho:t("qualidadeProducaoPanel.destination.retrabalho"), sucata:t("qualidadeProducaoPanel.destination.sucata"), devolucao:t("qualidadeProducaoPanel.destination.devolucao"),
  };
}
const DESTINACAO_COLOR: Record<Destinacao,string> = {
  retrabalho:"text-amber-600 bg-amber-500/10", sucata:"text-red-600 bg-red-500/10", devolucao:"text-blue-600 bg-blue-500/10",
};
function buildMotivosDefeito(t: (k: string, opts?: any) => any): string[] {
  return t("qualidadeProducaoPanel.motivos", { returnObjects: true }) as string[];
}
const CORES = ["#3b82f6","#ef4444","#f59e0b","#8b5cf6","#06b6d4"];

function NovoRefugoModal({open,onClose,onSaved,maquinas,produtos}:{
  open:boolean;onClose:()=>void;onSaved:(r:Refugo)=>void;maquinas:string[];produtos:string[];
}) {
  const { t } = useTranslation();
  const DEFEITO_LABEL = buildDefeitoLabel(t);
  const DESTINACAO_LABEL = buildDestinacaoLabel(t);
  const MOTIVOS_DEFEITO = buildMotivosDefeito(t);
  const {saveWithFallback}=useOfflineSync();
  const {user}=useAuth();
  const [form,setForm]=useState({
    produto:"",lote:"",maquina:"",operador:"",
    tipo_defeito:"dimensional" as TipoDefeito,motivo:"",
    quantidade:"",destinacao:"retrabalho" as Destinacao,observacoes:"",
  });
  const [medicoes,setMedicoes]=useState<{campo:string;nominal:string;medido:string;tolerancia:string}[]>([]);
  const [saving,setSaving]=useState(false);

  useEffect(()=>{
    if(open){
      setForm({produto:"",lote:"",maquina:"",operador:"",tipo_defeito:"dimensional",motivo:"",quantidade:"",destinacao:"retrabalho",observacoes:""});
      setMedicoes([]);
    }
  },[open]);

  if(!open) return null;

  async function save() {
    if(!form.produto||!form.maquina||!form.operador||!form.motivo||!form.quantidade){
      toast.error(t("qualidadeProducaoPanel.toastRequiredFields"));return;
    }
    setSaving(true);
    const id=crypto.randomUUID();
    const data:Refugo={
      id,produto:form.produto,lote:form.lote||`LOT-${Date.now()}`,
      maquina:form.maquina,operador:form.operador,tipo_defeito:form.tipo_defeito,
      motivo:form.motivo,quantidade:Number(form.quantidade),destinacao:form.destinacao,
      medicoes:medicoes.filter(m=>m.campo&&m.nominal&&m.medido).map(m=>({
        campo:m.campo,nominal:Number(m.nominal),medido:Number(m.medido),tolerancia:Number(m.tolerancia)||0,
      })),
      observacoes:form.observacoes||undefined,user_id:user?.id,created_at:new Date().toISOString(),
    };
    const {data:saved,error,savedOffline}=await saveWithFallback("refugos_producao","refugos","INSERT",data);
    setSaving(false);
    if(error){toast.error(t("qualidadeProducaoPanel.toastRegisterError"));return;}
    toast.success(savedOffline?t("qualidadeProducaoPanel.toastSavedOffline"):t("qualidadeProducaoPanel.toastRegistered"));
    onSaved(saved||data);onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-card rounded-2xl border shadow-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between"><h3 className="font-semibold">{t("qualidadeProducaoPanel.registerScrap")}</h3><button onClick={onClose} aria-label={t("qualidadeProducaoPanel.close")}><X className="h-4 w-4"/></button></div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("qualidadeProducaoPanel.product")}</label>
            {produtos.length>0
              ? <select value={form.produto} onChange={e=>setForm(p=>({...p,produto:e.target.value}))} className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm"><option value="">{t("qualidadeProducaoPanel.select")}</option>{produtos.map(p=><option key={p} value={p}>{p}</option>)}</select>
              : <Input value={form.produto} onChange={e=>setForm(p=>({...p,produto:e.target.value}))} placeholder={t("qualidadeProducaoPanel.productPlaceholder")}/>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">{t("qualidadeProducaoPanel.lot")}</label><Input value={form.lote} onChange={e=>setForm(p=>({...p,lote:e.target.value}))} placeholder={t("qualidadeProducaoPanel.optional")}/></div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("qualidadeProducaoPanel.machine")}</label>
              {maquinas.length>0
                ? <select value={form.maquina} onChange={e=>setForm(p=>({...p,maquina:e.target.value}))} className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm"><option value="">{t("qualidadeProducaoPanel.select")}</option>{maquinas.map(m=><option key={m} value={m}>{m}</option>)}</select>
                : <Input value={form.maquina} onChange={e=>setForm(p=>({...p,maquina:e.target.value}))} placeholder={t("qualidadeProducaoPanel.machinePlaceholder")}/>}
            </div>
          </div>
          <div><label className="text-xs font-medium text-muted-foreground mb-1 block">{t("qualidadeProducaoPanel.operator")}</label><Input value={form.operador} onChange={e=>setForm(p=>({...p,operador:e.target.value}))} placeholder={t("qualidadeProducaoPanel.operatorPlaceholder")}/></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("qualidadeProducaoPanel.defectType")}</label>
              <select value={form.tipo_defeito} onChange={e=>setForm(p=>({...p,tipo_defeito:e.target.value as TipoDefeito}))} className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
                {(Object.entries(DEFEITO_LABEL)).map(([k,v])=><option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">{t("qualidadeProducaoPanel.quantity")}</label><Input type="number" min="1" value={form.quantidade} onChange={e=>setForm(p=>({...p,quantidade:e.target.value}))}/></div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("qualidadeProducaoPanel.reason")}</label>
            <select value={form.motivo} onChange={e=>setForm(p=>({...p,motivo:e.target.value}))} className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
              <option value="">{t("qualidadeProducaoPanel.select")}</option>{MOTIVOS_DEFEITO.map(m=><option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("qualidadeProducaoPanel.destination_label")}</label>
            <div className="flex gap-2">
              {(["retrabalho","sucata","devolucao"] as Destinacao[]).map(d=>(
                <button key={d} onClick={()=>setForm(p=>({...p,destinacao:d}))}
                  className={cn("flex-1 h-9 rounded-lg border text-xs font-medium transition-colors",
                    form.destinacao===d?"border-primary bg-primary/10 text-primary":"border-input hover:bg-muted/30")}>
                  {DESTINACAO_LABEL[d]}
                </button>
              ))}
            </div>
          </div>
          {/* Medições */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-muted-foreground">{t("qualidadeProducaoPanel.dimensionalMeasurements")}</label>
              <button onClick={()=>setMedicoes(p=>[...p,{campo:"",nominal:"",medido:"",tolerancia:""}])} className="text-[11px] text-primary hover:underline">{t("qualidadeProducaoPanel.addMeasurement")}</button>
            </div>
            {medicoes.map((m,i)=>(
              <div key={i} className="grid grid-cols-4 gap-1 mb-2">
                <Input placeholder={t("qualidadeProducaoPanel.field")} value={m.campo} onChange={e=>{const n=[...medicoes];n[i]={...n[i],campo:e.target.value};setMedicoes(n);}} className="text-[11px] h-8"/>
                <Input placeholder={t("qualidadeProducaoPanel.nominal")} type="number" value={m.nominal} onChange={e=>{const n=[...medicoes];n[i]={...n[i],nominal:e.target.value};setMedicoes(n);}} className="text-[11px] h-8"/>
                <Input placeholder={t("qualidadeProducaoPanel.measured")} type="number" value={m.medido} onChange={e=>{const n=[...medicoes];n[i]={...n[i],medido:e.target.value};setMedicoes(n);}} className="text-[11px] h-8"/>
                <button onClick={()=>setMedicoes(p=>p.filter((_,j)=>j!==i))} aria-label={t("qualidadeProducaoPanel.removeMeasurement")} className="h-8 text-destructive hover:bg-destructive/10 rounded-lg"><X className="h-3 w-3 mx-auto"/></button>
              </div>
            ))}
          </div>
          <div><label className="text-xs font-medium text-muted-foreground mb-1 block">{t("qualidadeProducaoPanel.notes")}</label><Input value={form.observacoes} onChange={e=>setForm(p=>({...p,observacoes:e.target.value}))} placeholder={t("qualidadeProducaoPanel.optional")}/></div>
        </div>
        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={saving}>{t("qualidadeProducaoPanel.cancel")}</Button>
          <Button className="flex-1" onClick={save} disabled={saving}>{saving?t("qualidadeProducaoPanel.saving"):t("qualidadeProducaoPanel.register")}</Button>
        </div>
      </div>
    </div>
  );
}

export function QualidadeProducaoPanel() {
  const { t } = useTranslation();
  const DEFEITO_LABEL = buildDefeitoLabel(t);
  const DESTINACAO_LABEL = buildDestinacaoLabel(t);
  const [refugos,setRefugos]=useState<Refugo[]>([]);
  const [maquinas,setMaquinas]=useState<string[]>([]);
  const [produtos,setProdutos]=useState<string[]>([]);
  const [loading,setLoading]=useState(true);
  const [modalOpen,setModalOpen]=useState(false);
  const [search,setSearch]=useState("");
  const {loadWithFallback,saveWithFallback}=useOfflineSync();

  const load=useCallback(async()=>{
    setLoading(true);
    const data=await loadWithFallback<Refugo>("refugos_producao","refugos");
    setRefugos(data.sort((a,b)=>(b.created_at||"").localeCompare(a.created_at||"")));
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

  async function handleDelete(id:string){
    if(!confirm(t("qualidadeProducaoPanel.confirmRemoveRecord"))) return;
    await saveWithFallback("refugos_producao","refugos","DELETE",{id} as Refugo);
    setRefugos(prev=>prev.filter(r=>r.id!==id));
    toast.success(t("qualidadeProducaoPanel.toastRemoved"));
  }

  const filtered=refugos.filter(r=>!search||[r.produto,r.lote,r.maquina,r.operador,r.motivo].some(v=>v.toLowerCase().includes(search.toLowerCase())));
  const totalPerdas=refugos.reduce((s,r)=>s+r.quantidade,0);

  // Gráfico por tipo de defeito
  const defeitoCount:Record<string,number>={};
  refugos.forEach(r=>{defeitoCount[DEFEITO_LABEL[r.tipo_defeito]]=(defeitoCount[DEFEITO_LABEL[r.tipo_defeito]]||0)+r.quantidade;});
  const chartData=Object.entries(defeitoCount).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value);

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border bg-red-500/5 border-red-500/20 p-4 text-center"><p className="text-2xl font-bold text-red-600">{totalPerdas}</p><p className="text-[11px] text-muted-foreground">{t("qualidadeProducaoPanel.scrapedPieces")}</p></div>
        <div className="rounded-2xl border bg-amber-500/5 border-amber-500/20 p-4 text-center"><p className="text-2xl font-bold text-amber-600">{refugos.filter(r=>r.destinacao==="retrabalho").reduce((s,r)=>s+r.quantidade,0)}</p><p className="text-[11px] text-muted-foreground">{t("qualidadeProducaoPanel.rework")}</p></div>
        <div className="rounded-2xl border bg-card/60 p-4 text-center"><p className="text-2xl font-bold">{refugos.filter(r=>r.destinacao==="sucata").reduce((s,r)=>s+r.quantidade,0)}</p><p className="text-[11px] text-muted-foreground">{t("qualidadeProducaoPanel.scrap")}</p></div>
      </div>

      {chartData.length>0 && (
        <div className="rounded-2xl border bg-card/60 p-4">
          <p className="text-sm font-medium mb-3">{t("qualidadeProducaoPanel.scrapByDefectType")}</p>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={chartData} margin={{top:0,right:0,left:-20,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))"/>
              <XAxis dataKey="name" tick={{fontSize:9}}/>
              <YAxis tick={{fontSize:10}}/>
              <Tooltip/>
              <Bar dataKey="value" radius={[4,4,0,0]}>
                {chartData.map((_,i)=><Cell key={i} fill={CORES[i%CORES.length]}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="flex gap-2">
        <div className="relative flex-1"><SearchInputWithBarcode value={search} onChange={setSearch} onSearch={setSearch} placeholder={t("qualidadeProducaoPanel.searchPlaceholder")} height="h-9"/></div>
        <Button size="sm" className="gap-1 h-9" onClick={()=>setModalOpen(true)}><Plus className="h-4 w-4"/>{t("qualidadeProducaoPanel.register")}</Button>
        <Button size="sm" variant="outline" className="h-9 px-2" onClick={load} disabled={loading}><RefreshCw className={cn("h-4 w-4",loading&&"animate-spin")}/></Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2"><RefreshCw className="h-4 w-4 animate-spin"/>{t("qualidadeProducaoPanel.loading")}</div>
      ) : filtered.length===0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-sm gap-2">
          <ShieldAlert className="h-8 w-8 opacity-30"/><p>{refugos.length===0?t("qualidadeProducaoPanel.noScrapRegistered"):t("qualidadeProducaoPanel.noResults")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(r=>(
            <div key={r.id} className="rounded-2xl border bg-card/60 p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">{r.produto}</p>
                  <p className="text-[11px] text-muted-foreground">{r.maquina} · {r.operador}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium",DESTINACAO_COLOR[r.destinacao])}>{DESTINACAO_LABEL[r.destinacao]}</span>
                  <button onClick={()=>handleDelete(r.id)} aria-label={t("qualidadeProducaoPanel.deleteRecordAria")} className="h-6 w-6 flex items-center justify-center rounded-lg hover:bg-destructive/10 text-destructive"><Trash2 className="h-3 w-3"/></button>
                </div>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">{DEFEITO_LABEL[r.tipo_defeito]} · {r.motivo}</span>
                <span className="font-semibold text-red-600">{r.quantidade} {t("qualidadeProducaoPanel.pieceAbbrev")}</span>
              </div>
              {r.medicoes&&r.medicoes.length>0 && (
                <div className="bg-muted/30 rounded-lg p-2 space-y-1">
                  {r.medicoes.map((m,i)=>(
                    <div key={i} className="flex items-center justify-between text-[10px]">
                      <span className="text-muted-foreground">{m.campo}</span>
                      <span>{t("qualidadeProducaoPanel.nomAbbrev")} {m.nominal} · {t("qualidadeProducaoPanel.medAbbrev")} <b className={Math.abs(m.medido-m.nominal)>m.tolerancia?"text-red-500":"text-green-500"}>{m.medido}</b> · {t("qualidadeProducaoPanel.tolAbbrev")} ±{m.tolerancia}</span>
                    </div>
                  ))}
                </div>
              )}
              {r.observacoes && <p className="text-[11px] text-muted-foreground italic">{r.observacoes}</p>}
              <p className="text-[10px] text-muted-foreground">{r.created_at?new Date(r.created_at).toLocaleString(t("qualidadeProducaoPanel.localeCode")):""}</p>
            </div>
          ))}
        </div>
      )}

      <NovoRefugoModal open={modalOpen} onClose={()=>setModalOpen(false)} onSaved={r=>setRefugos(prev=>[r,...prev])} maquinas={maquinas} produtos={produtos}/>
    </div>
  );
}
