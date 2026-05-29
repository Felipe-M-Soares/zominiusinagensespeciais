/**
 * MateriaPrimaPanel — Controle de Matéria-Prima
 * ✓ Dados reais via Supabase (tabelas materias_primas_producao + movimentos_mp_producao)
 * ✓ Fallback offline com IndexedDB
 */

import { useState, useEffect, useCallback } from "react";
import { Plus, X, Search, Boxes, AlertTriangle, ArrowDown, ArrowUp, RefreshCw, Edit2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchInputWithBarcode } from "@/components/SearchInputWithBarcode";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

type MovimentoTipo = "entrada"|"saida"|"ajuste";

interface MateriaPrima {
  id: string; codigo: string; descricao: string;
  unidade: string; estoque_atual: number;
  estoque_minimo: number; estoque_maximo: number;
  lote_atual?: string; fornecedor?: string;
  ultima_entrada?: string; ultima_saida?: string;
  localizacao?: string; created_at?: string; updated_at?: string;
}

interface Movimento {
  id: string; materia_prima_id: string; materia_prima_desc: string;
  tipo: MovimentoTipo; quantidade: number; lote?: string;
  operador: string; ordem_producao?: string; observacoes?: string;
  user_id?: string; created_at?: string;
}

function MovimentoModal({open,materias,onClose,onSaved}:{open:boolean;materias:MateriaPrima[];onClose:()=>void;onSaved:(m:Movimento,delta:number,mpId:string)=>void}) {
  const [form,setForm]=useState({materia_prima_id:"",tipo:"saida" as MovimentoTipo,quantidade:"",lote:"",operador:"",ordem_producao:"",observacoes:""});
  const [saving,setSaving]=useState(false);
  const {saveWithFallback}=useOfflineSync();
  const {user}=useAuth();
  useEffect(()=>{if(open)setForm({materia_prima_id:"",tipo:"saida",quantidade:"",lote:"",operador:"",ordem_producao:"",observacoes:""});},[open]);
  if(!open) return null;

  async function save() {
    if(!form.materia_prima_id||!form.quantidade||!form.operador){toast.error("Preencha os campos obrigatórios");return;}
    const mp=materias.find(m=>m.id===form.materia_prima_id)!;
    const qtd=Number(form.quantidade);
    if(form.tipo==="saida"&&qtd>mp.estoque_atual){toast.error("Quantidade insuficiente em estoque!");return;}
    setSaving(true);
    const id=crypto.randomUUID();
    const mov:Movimento={id,materia_prima_id:form.materia_prima_id,materia_prima_desc:mp.descricao,
      tipo:form.tipo,quantidade:qtd,lote:form.lote||mp.lote_atual,operador:form.operador,
      ordem_producao:form.ordem_producao||undefined,observacoes:form.observacoes||undefined,
      user_id:user?.id,created_at:new Date().toISOString()};
    const {error,savedOffline}=await saveWithFallback("movimentos_mp_producao","movimentos_mp","INSERT",mov);
    if(error){setSaving(false);toast.error("Erro ao registrar movimento");return;}

    // Atualiza estoque
    const delta=form.tipo==="saida"?-qtd:form.tipo==="entrada"?qtd:0;
    const mpUpdated={...mp,estoque_atual:mp.estoque_atual+delta,
      ultima_entrada:form.tipo==="entrada"?new Date().toISOString().split("T")[0]:mp.ultima_entrada,
      ultima_saida:form.tipo==="saida"?new Date().toISOString().split("T")[0]:mp.ultima_saida,
      lote_atual:form.lote||mp.lote_atual};
    await saveWithFallback("materias_primas_producao","materias_primas","UPDATE",mpUpdated);

    setSaving(false);
    toast.success(savedOffline?"Salvo offline":"Movimento registrado!");
    onSaved(mov,delta,mp.id);onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-card rounded-2xl border shadow-xl p-5 space-y-4">
        <div className="flex items-center justify-between"><h3 className="font-semibold">Movimentação de MP</h3><button onClick={onClose} aria-label="Fechar"><X className="h-4 w-4"/></button></div>
        <div className="space-y-3">
          <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Matéria-Prima *</label>
            <select value={form.materia_prima_id} onChange={e=>setForm(p=>({...p,materia_prima_id:e.target.value}))} className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
              <option value="">Selecione...</option>{materias.map(m=><option key={m.id} value={m.id}>{m.codigo} — {m.descricao}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            {(["entrada","saida","ajuste"] as MovimentoTipo[]).map(t=>(
              <button key={t} onClick={()=>setForm(p=>({...p,tipo:t}))}
                className={cn("flex-1 h-9 rounded-lg border text-sm transition-colors capitalize",form.tipo===t?"border-primary bg-primary/10 text-primary":"border-input hover:bg-muted/30")}>
                {t==="entrada"?"Entrada":t==="saida"?"Saída":"Ajuste"}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Quantidade *</label><Input type="number" min="0.001" step="0.001" value={form.quantidade} onChange={e=>setForm(p=>({...p,quantidade:e.target.value}))}/></div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Lote</label><Input value={form.lote} onChange={e=>setForm(p=>({...p,lote:e.target.value}))} placeholder="Opcional"/></div>
          </div>
          <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Operador *</label><Input value={form.operador} onChange={e=>setForm(p=>({...p,operador:e.target.value}))} placeholder="Nome do operador"/></div>
          <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Ordem de produção</label><Input value={form.ordem_producao} onChange={e=>setForm(p=>({...p,ordem_producao:e.target.value}))} placeholder="Opcional"/></div>
        </div>
        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button className="flex-1" onClick={save} disabled={saving}>{saving?"Salvando...":"Registrar"}</Button>
        </div>
      </div>
    </div>
  );
}

export function MateriaPrimaPanel() {
  const [materias,setMaterias]=useState<MateriaPrima[]>([]);
  const [movimentos,setMovimentos]=useState<Movimento[]>([]);
  const [loading,setLoading]=useState(true);
  const [modalOpen,setModalOpen]=useState(false);
  const [search,setSearch]=useState("");
  const [aba,setAba]=useState<"estoque"|"movimentos">("estoque");
  const {loadWithFallback}=useOfflineSync();

  const load=useCallback(async()=>{
    setLoading(true);
    const [mats,movs]=await Promise.all([
      loadWithFallback<MateriaPrima>("materias_primas_producao","materias_primas"),
      loadWithFallback<Movimento>("movimentos_mp_producao","movimentos_mp"),
    ]);
    setMaterias(mats.sort((a,b)=>a.codigo.localeCompare(b.codigo)));
    setMovimentos(movs.sort((a,b)=>(b.created_at||"").localeCompare(a.created_at||"")));
    setLoading(false);
  },[loadWithFallback]);

  useEffect(()=>{load();},[load]);

  function handleSaved(mov:Movimento,delta:number,mpId:string) {
    setMovimentos(prev=>[mov,...prev]);
    setMaterias(prev=>prev.map(m=>m.id===mpId?{...m,estoque_atual:m.estoque_atual+delta}:m));
  }

  const alerta=materias.filter(m=>m.estoque_atual<=m.estoque_minimo);
  const filtered=materias.filter(m=>!search||[m.codigo,m.descricao,m.fornecedor||""].some(v=>v.toLowerCase().includes(search.toLowerCase())));

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {alerta.length>0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0"/>
          <p className="text-sm text-amber-700 dark:text-amber-400"><b>{alerta.length}</b> matéria{alerta.length>1?"s-primas":"-prima"} abaixo do estoque mínimo</p>
        </div>
      )}

      <div className="flex border rounded-xl overflow-hidden">
        {(["estoque","movimentos"] as const).map(t=>(
          <button key={t} onClick={()=>setAba(t)}
            className={cn("flex-1 py-2 text-sm font-medium transition-colors",aba===t?"bg-primary text-primary-foreground":"hover:bg-muted/40")}>
            {t==="estoque"?"Estoque":"Movimentos"}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1"><SearchInputWithBarcode value={search} onChange={setSearch} onSearch={setSearch} placeholder="Bipe o código ou busque material..." height="h-9"/></div>
        <Button size="sm" className="gap-1 h-9" onClick={()=>setModalOpen(true)}><Plus className="h-4 w-4"/>Movimentar</Button>
        <Button size="sm" variant="outline" className="h-9 px-2" onClick={load} disabled={loading}><RefreshCw className={cn("h-4 w-4",loading&&"animate-spin")}/></Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2"><RefreshCw className="h-4 w-4 animate-spin"/>Carregando...</div>
      ) : aba==="estoque" ? (
        filtered.length===0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-sm gap-2">
            <Boxes className="h-8 w-8 opacity-30"/><p>{materias.length===0?"Nenhuma matéria-prima cadastrada":"Nenhum resultado"}</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {filtered.map(m=>{
              const pct=Math.min(100,(m.estoque_atual/Math.max(m.estoque_maximo,1))*100);
              const abaixo=m.estoque_atual<=m.estoque_minimo;
              return (
                <div key={m.id} className={cn("rounded-2xl border p-4 space-y-3",abaixo?"bg-amber-500/5 border-amber-500/20":"bg-card/60")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm">{m.codigo}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{m.descricao}</p>
                      {m.fornecedor&&<p className="text-[10px] text-muted-foreground">{m.fornecedor}</p>}
                    </div>
                    {abaixo&&<AlertTriangle className="h-4 w-4 text-amber-500 shrink-0"/>}
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span className="font-medium">{m.estoque_atual} {m.unidade}</span>
                      <span className="text-muted-foreground">Mín: {m.estoque_minimo} / Máx: {m.estoque_maximo}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className={cn("h-full rounded-full transition-all",abaixo?"bg-amber-500":"bg-green-500")} style={{width:`${pct}%`}}/>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    {m.lote_atual&&<span>Lote: {m.lote_atual}</span>}
                    {m.localizacao&&<span>📍 {m.localizacao}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        movimentos.length===0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-sm gap-2">
            <ArrowDown className="h-8 w-8 opacity-30"/><p>Nenhum movimento registrado</p>
          </div>
        ) : (
          <div className="space-y-2">
            {movimentos.slice(0,30).map(mov=>(
              <div key={mov.id} className="rounded-xl border bg-card/60 p-3 flex items-center gap-3">
                <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
                  mov.tipo==="entrada"?"bg-green-500/10":mov.tipo==="saida"?"bg-red-500/10":"bg-blue-500/10")}>
                  {mov.tipo==="entrada"?<ArrowDown className="h-4 w-4 text-green-500"/>:<ArrowUp className="h-4 w-4 text-red-500"/>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{mov.materia_prima_desc}</p>
                  <p className="text-[11px] text-muted-foreground">{mov.operador}{mov.ordem_producao?` · ${mov.ordem_producao}`:""}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className={cn("font-semibold text-sm",mov.tipo==="entrada"?"text-green-600":"text-red-600")}>
                    {mov.tipo==="entrada"?"+":"-"}{mov.quantidade}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{mov.created_at?new Date(mov.created_at).toLocaleDateString("pt-BR"):""}</p>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      <MovimentoModal open={modalOpen} materias={materias} onClose={()=>setModalOpen(false)} onSaved={handleSaved}/>
    </div>
  );
}
