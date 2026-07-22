import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, PackageSearch, RefreshCw, X, ChevronDown, ChevronUp, CheckCircle2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Fornecedor { id:string; razao_social:string; }
interface MP { id:string; codigo:string; descricao:string; }
interface ItemForm { mp_id:string; descricao:string; quantidade:string; unidade:string; valor_unitario:string; }
interface PedidoCompra {
  id:string; fornecedor_nome:string; status:string; data_pedido:string;
  data_previsao:string|null; data_recebimento:string|null; valor_total:number;
  nota_fiscal_entrada:string|null; observacoes:string|null;
  pedido_compra_itens: { id:string; descricao:string; quantidade:number; unidade:string; valor_unitario:number; valor_total:number; quantidade_recebida:number; }[];
}

const STATUS_LABEL: Record<string,string> = { rascunho:"Rascunho", enviado:"Enviado", parcial:"Parcial", recebido:"Recebido", cancelado:"Cancelado" };
const STATUS_COLOR: Record<string,string> = { rascunho:"text-muted-foreground bg-muted/30", enviado:"text-blue-600 bg-blue-500/10", parcial:"text-amber-600 bg-amber-500/10", recebido:"text-green-600 bg-green-500/10", cancelado:"text-red-600 bg-red-500/10" };

function NovoPedidoModal({ onClose, onSaved }: { onClose:()=>void; onSaved:()=>void }) {
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [mps, setMPs] = useState<MP[]>([]);
  const [form, setForm] = useState({ fornecedor_id:"", fornecedor_nome:"", data_previsao:"", observacoes:"" });
  const [itens, setItens] = useState<ItemForm[]>([{ mp_id:"", descricao:"", quantidade:"", unidade:"m", valor_unitario:"" }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("fornecedores").select("id,razao_social").eq("ativo",true).order("razao_social"),
      supabase.from("materias_primas_producao").select("id,codigo,descricao").order("codigo"),
    ]).then(([{data:f},{data:m}]) => {
      if(f) setFornecedores(f as Fornecedor[]);
      if(m) setMPs(m as MP[]);
    });
  }, []);

  function addItem() { setItens(i => [...i, { mp_id:"", descricao:"", quantidade:"", unidade:"m", valor_unitario:"" }]); }
  function removeItem(i:number) { setItens(prev => prev.filter((_,idx) => idx !== i)); }
  function updateItem(i:number, k:string, v:string) { setItens(prev => prev.map((item,idx) => idx===i ? {...item,[k]:v} : item)); }

  const total = useMemo(() => itens.reduce((s,i) => s + (parseFloat(i.quantidade)||0)*(parseFloat(i.valor_unitario)||0), 0), [itens]);

  async function save() {
    if(!form.fornecedor_nome) { toast.error("Selecione o fornecedor"); return; }
    const validItens = itens.filter(i => i.descricao && parseFloat(i.quantidade)>0);
    if(validItens.length===0) { toast.error("Adicione pelo menos 1 item"); return; }
    setSaving(true);

    const { data: ped, error } = await supabase.from("pedidos_compra").insert({
      fornecedor_id: form.fornecedor_id || null,
      fornecedor_nome: form.fornecedor_nome,
      data_previsao: form.data_previsao || null,
      observacoes: form.observacoes || null,
      valor_total: total,
      status: "rascunho",
    }).select("id").single();

    if(error || !ped) { toast.error(error?.message || "Erro"); setSaving(false); return; }

    await supabase.from("pedido_compra_itens").insert(validItens.map(i => ({
      pedido_id: ped.id,
      materia_prima_id: i.mp_id || null,
      descricao: i.descricao,
      quantidade: parseFloat(i.quantidade),
      unidade: i.unidade,
      valor_unitario: parseFloat(i.valor_unitario)||0,
    })));

    setSaving(false);
    toast.success("Pedido de compra criado!");
    onSaved(); onClose();
  }

  const lbl = "text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block";
  const sel = "w-full h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full max-w-xl bg-card rounded-t-2xl sm:rounded-2xl border border-border/40 shadow-2xl flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/30 shrink-0">
          <h3 className="font-semibold text-sm">Novo Pedido de Compra</h3>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40"><X className="h-4 w-4"/></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={lbl}>Fornecedor</label>
              <select value={form.fornecedor_id} onChange={e => {
                const f = fornecedores.find(f=>f.id===e.target.value);
                setForm(p=>({...p, fornecedor_id:e.target.value, fornecedor_nome:f?.razao_social||""}));
              }} className={sel}>
                <option value="">Selecione ou digite...</option>
                {fornecedores.map(f=><option key={f.id} value={f.id}>{f.razao_social}</option>)}
              </select>
              {!form.fornecedor_id && <Input value={form.fornecedor_nome} onChange={e=>setForm(p=>({...p,fornecedor_nome:e.target.value}))} placeholder="Ou digite o nome do fornecedor" className="h-9 mt-1.5"/>}
            </div>
            <div><label className={lbl}>Previsão de Entrega</label><input type="date" value={form.data_previsao} onChange={e=>setForm(p=>({...p,data_previsao:e.target.value}))} className={sel}/></div>
          </div>

          {/* Itens */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={lbl + " mb-0"}>Itens do Pedido</label>
              <button onClick={addItem} className="text-[11px] text-primary hover:underline flex items-center gap-1"><Plus className="h-3 w-3"/>Adicionar item</button>
            </div>
            <div className="space-y-2">
              {itens.map((item,i)=>(
                <div key={i} className="rounded-xl border border-border/40 p-3 space-y-2">
                  <div>
                    <select value={item.mp_id} onChange={e=>{
                      const mp=mps.find(m=>m.id===e.target.value);
                      updateItem(i,"mp_id",e.target.value);
                      if(mp) updateItem(i,"descricao",`${mp.codigo} — ${mp.descricao}`);
                    }} className={sel}>
                      <option value="">Selecione a MP ou descreva manualmente</option>
                      {mps.map(m=><option key={m.id} value={m.id}>{m.codigo} — {m.descricao}</option>)}
                    </select>
                    <Input value={item.descricao} onChange={e=>updateItem(i,"descricao",e.target.value)} placeholder="Descrição do item" className="h-9 mt-1.5"/>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Input type="number" min="0" step="0.001" value={item.quantidade} onChange={e=>updateItem(i,"quantidade",e.target.value)} placeholder="Qtde" className="h-9"/>
                    <select value={item.unidade} onChange={e=>updateItem(i,"unidade",e.target.value)} className={sel}>
                      {["m","kg","un","pc","litro"].map(u=><option key={u}>{u}</option>)}
                    </select>
                    <Input type="number" min="0" step="0.01" value={item.valor_unitario} onChange={e=>updateItem(i,"valor_unitario",e.target.value)} placeholder="R$/un" className="h-9"/>
                  </div>
                  {itens.length>1 && <button onClick={()=>removeItem(i)} className="text-[10px] text-muted-foreground hover:text-destructive transition-colors">Remover item</button>}
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-2">
              <p className="text-sm font-bold">Total: {total.toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}</p>
            </div>
          </div>
        </div>
        <div className="flex gap-3 px-5 py-4 border-t border-border/30 shrink-0">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" onClick={save} disabled={saving}>{saving?"Salvando...":"Criar Pedido"}</Button>
        </div>
      </div>
    </div>
  );
}

export function PedidosCompraPanel() {
  const [pedidos, setPedidos] = useState<PedidoCompra[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [expanded, setExpanded] = useState<string|null>(null);

  const load = useCallback(async()=>{
    setLoading(true);
    const{data}=await supabase.from("pedidos_compra")
      .select("*, pedido_compra_itens(*)")
      .order("created_at",{ascending:false});
    if(data) setPedidos(data as PedidoCompra[]);
    setLoading(false);
  },[]);

  useEffect(()=>{load();},[load]);

  async function avancar(id:string, novoStatus:string) {
    await supabase.from("pedidos_compra").update({status:novoStatus, ...(novoStatus==="recebido"?{data_recebimento:new Date().toISOString().split("T")[0]}:{})}).eq("id",id);
    toast.success("Status atualizado!");
    load();
  }

  const nextStatus: Record<string,{s:string;label:string}> = {
    rascunho:{s:"enviado",label:"Marcar Enviado"},
    enviado: {s:"recebido",label:"Confirmar Recebimento"},
    parcial: {s:"recebido",label:"Confirmar Recebimento"},
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">{pedidos.length} pedido(s)</p>
        <div className="flex gap-2">
          <button onClick={load} className="h-8 w-8 flex items-center justify-center rounded-lg border border-input hover:bg-muted/40"><RefreshCw className={cn("h-4 w-4 text-muted-foreground",loading&&"animate-spin")}/></button>
          <Button size="sm" className="h-8 gap-1" onClick={()=>setModal(true)}><Plus className="h-3.5 w-3.5"/>Novo Pedido</Button>
        </div>
      </div>

      {loading&&pedidos.length===0 ? <div className="flex justify-center py-12 text-sm text-muted-foreground gap-2"><RefreshCw className="h-4 w-4 animate-spin"/>Carregando...</div>
      :pedidos.length===0 ? <div className="text-center py-12 text-muted-foreground text-sm"><PackageSearch className="h-8 w-8 mx-auto opacity-20 mb-2"/><p>Nenhum pedido de compra</p></div>
      :(
        <div className="space-y-2">
          {pedidos.map(p=>(
            <div key={p.id} className="rounded-2xl border border-border/40 bg-card overflow-hidden">
              <button className="w-full text-left px-4 py-3 flex items-center gap-3" onClick={()=>setExpanded(expanded===p.id?null:p.id)}>
                <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0"><Truck className="h-4 w-4 text-blue-600"/></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold truncate">{p.fornecedor_nome}</p>
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium",STATUS_COLOR[p.status])}>{STATUS_LABEL[p.status]}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{new Date(p.data_pedido+"T12:00:00").toLocaleDateString("pt-BR")} · {p.pedido_compra_itens?.length||0} itens · {(p.valor_total||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}</p>
                </div>
                {nextStatus[p.status] && (
                  <button onClick={e=>{e.stopPropagation();avancar(p.id,nextStatus[p.status].s);}} className="h-7 px-2 rounded-lg bg-green-500/10 text-green-600 text-[11px] font-medium hover:bg-green-500/20 transition-colors flex items-center gap-1 shrink-0">
                    <CheckCircle2 className="h-3.5 w-3.5"/>{nextStatus[p.status].label}
                  </button>
                )}
                {expanded===p.id?<ChevronUp className="h-4 w-4 text-muted-foreground shrink-0"/>:<ChevronDown className="h-4 w-4 text-muted-foreground shrink-0"/>}
              </button>
              {expanded===p.id && (
                <div className="border-t border-border/20 px-4 pb-4 pt-3 space-y-2">
                  {p.pedido_compra_itens?.map((item,i)=>(
                    <div key={i} className="flex items-center justify-between text-[12px] py-1 border-b border-border/10 last:border-0">
                      <span className="text-foreground truncate flex-1">{item.descricao}</span>
                      <span className="text-muted-foreground shrink-0 ml-2">{item.quantidade} {item.unidade}</span>
                      <span className="text-foreground font-medium shrink-0 ml-3">{item.valor_total?.toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}</span>
                    </div>
                  ))}
                  {p.data_previsao && <p className="text-[10px] text-muted-foreground">Previsão: {new Date(p.data_previsao+"T12:00:00").toLocaleDateString("pt-BR")}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {modal && <NovoPedidoModal onClose={()=>setModal(false)} onSaved={load}/>}
    </div>
  );
}
