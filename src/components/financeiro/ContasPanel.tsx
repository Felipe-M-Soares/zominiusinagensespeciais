import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, CheckCircle2, AlertTriangle, Clock, RefreshCw, DollarSign, ArrowUpCircle, ArrowDownCircle, X, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Conta {
  id: string; tipo: "pagar"|"receber"; descricao: string; valor: number;
  data_emissao: string; data_vencimento: string; data_pagamento: string|null;
  status: string; categoria: string; nota_fiscal: string|null; observacoes: string|null;
}

const CATS = ["venda","compra","salario","aluguel","servico","imposto","outros"];
const BRL = (v:number) => v.toLocaleString("pt-BR",{style:"currency",currency:"BRL"});

function NovaConta({onClose,onSaved}:{onClose:()=>void;onSaved:()=>void}) {
  const [form,setForm] = useState({ tipo:"receber", descricao:"", valor:"", data_vencimento:"", categoria:"venda", nota_fiscal:"", observacoes:"" });
  const [saving,setSaving] = useState(false);

  async function save() {
    if(!form.descricao||!form.valor||!form.data_vencimento){toast.error("Preencha descrição, valor e vencimento");return;}
    if(parseFloat(form.valor)<=0){toast.error("Valor deve ser positivo");return;}
    setSaving(true);
    const{error}=await supabase.from("contas_financeiras").insert({
      tipo:form.tipo, descricao:form.descricao, valor:parseFloat(form.valor),
      data_vencimento:form.data_vencimento, categoria:form.categoria,
      nota_fiscal:form.nota_fiscal||null, observacoes:form.observacoes||null,
      status:"aberto",
    });
    setSaving(false);
    if(error){toast.error(error.message);return;}
    toast.success("Conta registrada!");
    onSaved(); onClose();
  }

  const lbl = "text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block";
  const inp = "w-full h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full max-w-md bg-card rounded-t-2xl sm:rounded-2xl border border-border/40 shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/30">
          <h3 className="font-semibold text-sm">Nova Conta</h3>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40"><X className="h-4 w-4"/></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {(["receber","pagar"] as const).map(t=>(
              <button key={t} onClick={()=>setForm(f=>({...f,tipo:t}))}
                className={cn("h-9 rounded-lg border text-sm font-medium transition-colors",
                  form.tipo===t?(t==="receber"?"bg-green-500 text-white border-green-500":"bg-red-500 text-white border-red-500"):"border-input hover:bg-muted/40")}>
                {t==="receber"?"A Receber":"A Pagar"}
              </button>
            ))}
          </div>
          <div><label className={lbl}>Descrição *</label><Input value={form.descricao} onChange={e=>setForm(f=>({...f,descricao:e.target.value}))} className="h-9"/></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Valor *</label><Input type="number" min="0.01" step="0.01" value={form.valor} onChange={e=>setForm(f=>({...f,valor:e.target.value}))} placeholder="0,00" className="h-9"/></div>
            <div><label className={lbl}>Vencimento *</label><input type="date" value={form.data_vencimento} onChange={e=>setForm(f=>({...f,data_vencimento:e.target.value}))} className={inp}/></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Categoria</label>
              <select value={form.categoria} onChange={e=>setForm(f=>({...f,categoria:e.target.value}))} className={inp}>
                {CATS.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div><label className={lbl}>Nota Fiscal</label><Input value={form.nota_fiscal} onChange={e=>setForm(f=>({...f,nota_fiscal:e.target.value}))} placeholder="NF-e opcional" className="h-9"/></div>
          </div>
        </div>
        <div className="flex gap-3 px-5 py-4 border-t border-border/30">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" onClick={save} disabled={saving}>{saving?"Salvando...":"Registrar"}</Button>
        </div>
      </div>
    </div>
  );
}

export function ContasPanel() {
  const [contas,setContas] = useState<Conta[]>([]);
  const [loading,setLoading] = useState(true);
  const [filtro,setFiltro] = useState<"todos"|"pagar"|"receber">("todos");
  const [status,setStatus] = useState<"todos"|"aberto"|"vencido"|"pago">("todos");
  const [modal,setModal] = useState(false);

  const load = useCallback(async()=>{
    setLoading(true);
    await supabase.rpc("atualizar_status_vencido");
    const{data}=await supabase.from("contas_financeiras").select("*").order("data_vencimento");
    if(data) setContas(data as Conta[]);
    setLoading(false);
  },[]);

  useEffect(()=>{load();},[load]);

  async function baixar(id:string) {
    const{error}=await supabase.from("contas_financeiras").update({status:"pago",data_pagamento:new Date().toISOString().split("T")[0]}).eq("id",id);
    if(error){toast.error(error.message);return;}
    toast.success("Baixa registrada!");
    load();
  }

  async function excluir(id:string) {
    await supabase.from("contas_financeiras").delete().eq("id",id);
    load();
  }

  const filtered = useMemo(()=>contas.filter(c=>
    (filtro==="todos"||c.tipo===filtro) &&
    (status==="todos"||c.status===status)
  ),[contas,filtro,status]);

  const totais = useMemo(()=>({
    receber: contas.filter(c=>c.tipo==="receber"&&c.status==="aberto").reduce((s,c)=>s+c.valor,0),
    pagar:   contas.filter(c=>c.tipo==="pagar"&&c.status==="aberto").reduce((s,c)=>s+c.valor,0),
    vencido: contas.filter(c=>c.status==="vencido").reduce((s,c)=>s+c.valor,0),
  }),[contas]);

  const statusColor = (s:string) => s==="pago"?"text-green-600 bg-green-500/10":s==="vencido"?"text-red-600 bg-red-500/10":s==="aberto"?"text-blue-600 bg-blue-500/10":"text-muted-foreground bg-muted/30";

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Totais */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-green-500/20 bg-green-500/5 p-3">
          <div className="flex items-center gap-1.5"><ArrowUpCircle className="h-3.5 w-3.5 text-green-600"/><p className="text-[10px] text-muted-foreground uppercase">A Receber</p></div>
          <p className="text-lg font-bold text-green-600">{BRL(totais.receber)}</p>
        </div>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3">
          <div className="flex items-center gap-1.5"><ArrowDownCircle className="h-3.5 w-3.5 text-amber-600"/><p className="text-[10px] text-muted-foreground uppercase">A Pagar</p></div>
          <p className="text-lg font-bold text-amber-600">{BRL(totais.pagar)}</p>
        </div>
        <div className={cn("rounded-2xl border p-3",totais.vencido>0?"border-red-500/20 bg-red-500/5":"border-border/40 bg-card")}>
          <div className="flex items-center gap-1.5"><AlertTriangle className={cn("h-3.5 w-3.5",totais.vencido>0?"text-red-600":"text-muted-foreground")}/><p className="text-[10px] text-muted-foreground uppercase">Vencidos</p></div>
          <p className={cn("text-lg font-bold",totais.vencido>0?"text-red-600":"text-foreground")}>{BRL(totais.vencido)}</p>
        </div>
      </div>

      {/* Filtros + botão */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["todos","receber","pagar"] as const).map(f=>(
          <button key={f} onClick={()=>setFiltro(f)}
            className={cn("h-8 px-3 rounded-lg text-[12px] font-medium border transition-colors",filtro===f?"bg-primary text-primary-foreground border-primary":"border-input hover:bg-muted/40")}>
            {f==="todos"?"Todos":f==="receber"?"A Receber":"A Pagar"}
          </button>
        ))}
        <div className="w-px h-5 bg-border/40"/>
        {(["todos","aberto","vencido","pago"] as const).map(s=>(
          <button key={s} onClick={()=>setStatus(s)}
            className={cn("h-8 px-3 rounded-lg text-[12px] font-medium border transition-colors",status===s?"bg-primary text-primary-foreground border-primary":"border-input hover:bg-muted/40")}>
            {s==="todos"?"Todos":s.charAt(0).toUpperCase()+s.slice(1)}
          </button>
        ))}
        <Button size="sm" className="ml-auto h-8 gap-1" onClick={()=>setModal(true)}><Plus className="h-3.5 w-3.5"/>Nova Conta</Button>
        <button onClick={load} className="h-8 w-8 flex items-center justify-center rounded-lg border border-input hover:bg-muted/40"><RefreshCw className={cn("h-4 w-4 text-muted-foreground",loading&&"animate-spin")}/></button>
      </div>

      {/* Lista */}
      {loading&&contas.length===0?(
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2"><RefreshCw className="h-4 w-4 animate-spin"/>Carregando...</div>
      ):filtered.length===0?(
        <div className="text-center py-12 text-muted-foreground text-sm"><DollarSign className="h-8 w-8 mx-auto opacity-20 mb-2"/><p>Nenhuma conta encontrada</p></div>
      ):(
        <div className="space-y-2">
          {filtered.map(c=>(
            <div key={c.id} className={cn("rounded-2xl border px-4 py-3 flex items-center gap-3",c.status==="vencido"?"border-red-500/20 bg-red-500/5":c.status==="pago"?"border-border/20 opacity-60":"border-border/40 bg-card")}>
              <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center shrink-0",c.tipo==="receber"?"bg-green-500/10":"bg-amber-500/10")}>
                {c.tipo==="receber"?<ArrowUpCircle className="h-4 w-4 text-green-600"/>:<ArrowDownCircle className="h-4 w-4 text-amber-600"/>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{c.descricao}</p>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
                  <span>Venc: {new Date(c.data_vencimento+"T12:00:00").toLocaleDateString("pt-BR")}</span>
                  {c.nota_fiscal&&<span>NF: {c.nota_fiscal}</span>}
                  <span className={cn("px-1.5 py-0.5 rounded-full font-medium",statusColor(c.status))}>{c.status}</span>
                </div>
              </div>
              <p className={cn("text-sm font-bold shrink-0",c.tipo==="receber"?"text-green-600":"text-amber-600")}>{BRL(c.valor)}</p>
              <div className="flex gap-1 shrink-0">
                {c.status!=="pago"&&<button onClick={()=>baixar(c.id)} title="Registrar baixa" className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-green-500/10 text-muted-foreground hover:text-green-600 transition-colors"><CheckCircle2 className="h-3.5 w-3.5"/></button>}
                <button onClick={()=>excluir(c.id)} title="Excluir" className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="h-3.5 w-3.5"/></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal&&<NovaConta onClose={()=>setModal(false)} onSaved={load}/>}
    </div>
  );
}
