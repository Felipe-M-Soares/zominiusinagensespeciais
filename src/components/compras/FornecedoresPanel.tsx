import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, Search, RefreshCw, Building2, X, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Fornecedor {
  id:string; razao_social:string; nome_fantasia:string|null; cnpj:string|null;
  telefone:string|null; email:string|null; contato:string|null; cidade:string|null;
  uf:string|null; categoria:string; prazo_entrega_dias:number; ativo:boolean;
}

const CATS = ["materia_prima","servico","embalagem","ferramental","outros"];

function FornModal({item,onClose,onSaved}:{item:Fornecedor|null;onClose:()=>void;onSaved:()=>void}) {
  const [form,setForm] = useState({
    razao_social:item?.razao_social||"", nome_fantasia:item?.nome_fantasia||"",
    cnpj:item?.cnpj||"", telefone:item?.telefone||"", email:item?.email||"",
    contato:item?.contato||"", cidade:item?.cidade||"", uf:item?.uf||"",
    categoria:item?.categoria||"materia_prima", prazo_entrega_dias:String(item?.prazo_entrega_dias||0),
  });
  const [saving,setSaving] = useState(false);

  async function save() {
    if(!form.razao_social){toast.error("Razão social obrigatória");return;}
    setSaving(true);
    const payload = {...form, prazo_entrega_dias:parseInt(form.prazo_entrega_dias)||0};
    const{error}=item
      ? await supabase.from("fornecedores").update(payload).eq("id",item.id)
      : await supabase.from("fornecedores").insert(payload);
    setSaving(false);
    if(error){toast.error(error.message);return;}
    toast.success(item?"Fornecedor atualizado!":"Fornecedor cadastrado!");
    onSaved(); onClose();
  }

  const lbl = "text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block";
  const sel = "w-full h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
  const f = (k:string)=>({value:(form as Record<string,string>)[k],onChange:(e:React.ChangeEvent<HTMLInputElement>)=>setForm(p=>({...p,[k]:e.target.value}))});

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full max-w-lg bg-card rounded-t-2xl sm:rounded-2xl border border-border/40 shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/30 shrink-0">
          <h3 className="font-semibold text-sm">{item?"Editar":"Novo"} Fornecedor</h3>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40"><X className="h-4 w-4"/></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div><label className={lbl}>Razão Social *</label><Input {...f("razao_social")} className="h-9"/></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Nome Fantasia</label><Input {...f("nome_fantasia")} className="h-9"/></div>
            <div><label className={lbl}>CNPJ</label><Input {...f("cnpj")} placeholder="00.000.000/0001-00" className="h-9"/></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Telefone</label><Input {...f("telefone")} className="h-9"/></div>
            <div><label className={lbl}>Email</label><Input {...f("email")} type="email" className="h-9"/></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Contato</label><Input {...f("contato")} className="h-9"/></div>
            <div><label className={lbl}>Categoria</label>
              <select value={form.categoria} onChange={e=>setForm(p=>({...p,categoria:e.target.value}))} className={sel}>
                {CATS.map(c=><option key={c} value={c}>{c.replace("_"," ")}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2"><label className={lbl}>Cidade</label><Input {...f("cidade")} className="h-9"/></div>
            <div><label className={lbl}>UF</label><Input {...f("uf")} maxLength={2} className="h-9"/></div>
          </div>
          <div><label className={lbl}>Prazo de Entrega (dias)</label><Input type="number" min="0" {...f("prazo_entrega_dias")} className="h-9"/></div>
        </div>
        <div className="flex gap-3 px-5 py-4 border-t border-border/30 shrink-0">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" onClick={save} disabled={saving}>{saving?"Salvando...":"Salvar"}</Button>
        </div>
      </div>
    </div>
  );
}

export function FornecedoresPanel() {
  const [items,setItems] = useState<Fornecedor[]>([]);
  const [loading,setLoading] = useState(true);
  const [search,setSearch] = useState("");
  const [modal,setModal] = useState<Fornecedor|null|"novo">(null);

  const load = useCallback(async()=>{
    setLoading(true);
    const{data}=await supabase.from("fornecedores").select("*").eq("ativo",true).order("razao_social");
    if(data) setItems(data as Fornecedor[]);
    setLoading(false);
  },[]);

  useEffect(()=>{load();},[load]);

  const filtered = useMemo(()=>items.filter(f=>
    !search||[f.razao_social,f.nome_fantasia||"",f.cnpj||"",f.contato||""].some(v=>v.toLowerCase().includes(search.toLowerCase()))
  ),[items,search]);

  async function excluir(id:string) {
    await supabase.from("fornecedores").update({ativo:false}).eq("id",id);
    load();
    toast.success("Fornecedor removido");
  }

  const catColor = (c:string) => c==="materia_prima"?"text-blue-600 bg-blue-500/10":c==="ferramental"?"text-orange-600 bg-orange-500/10":c==="servico"?"text-purple-600 bg-purple-500/10":"text-muted-foreground bg-muted/20";

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
          <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar fornecedor..." className="pl-9 h-9"/>
        </div>
        <Button size="sm" className="h-9 gap-1" onClick={()=>setModal("novo")}><Plus className="h-4 w-4"/>Novo</Button>
        <button onClick={load} className="h-9 w-9 flex items-center justify-center rounded-lg border border-input hover:bg-muted/40"><RefreshCw className={cn("h-4 w-4 text-muted-foreground",loading&&"animate-spin")}/></button>
      </div>

      {loading&&items.length===0?(
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2"><RefreshCw className="h-4 w-4 animate-spin"/>Carregando...</div>
      ):filtered.length===0?(
        <div className="text-center py-12 text-muted-foreground text-sm"><Building2 className="h-8 w-8 mx-auto opacity-20 mb-2"/><p>Nenhum fornecedor encontrado</p></div>
      ):(
        <div className="space-y-2">
          {filtered.map(f=>(
            <div key={f.id} className="rounded-2xl border border-border/40 bg-card px-4 py-3 flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Building2 className="h-4 w-4 text-primary"/>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{f.razao_social}</p>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
                  {f.nome_fantasia&&<span>{f.nome_fantasia}</span>}
                  {f.cnpj&&<span>{f.cnpj}</span>}
                  {f.telefone&&<span>{f.telefone}</span>}
                  {f.cidade&&<span>{f.cidade}/{f.uf}</span>}
                  {f.prazo_entrega_dias>0&&<span>{f.prazo_entrega_dias}d prazo</span>}
                  <span className={cn("px-1.5 py-0.5 rounded-full font-medium",catColor(f.categoria))}>{f.categoria.replace("_"," ")}</span>
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={()=>setModal(f)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors"><Pencil className="h-3.5 w-3.5"/></button>
                <button onClick={()=>excluir(f.id)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="h-3.5 w-3.5"/></button>
              </div>
            </div>
          ))}
        </div>
      )}
      {modal&&<FornModal item={modal==="novo"?null:modal} onClose={()=>setModal(null)} onSaved={load}/>}
    </div>
  );
}
