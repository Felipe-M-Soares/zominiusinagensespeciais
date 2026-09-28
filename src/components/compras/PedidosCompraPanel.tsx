import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, PackageSearch, RefreshCw, ChevronDown, CheckCircle2, Truck, Loader2, Ban, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { friendlyError } from "@/lib/errorMessages";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Fornecedor { id:string; razao_social:string; }
// Item de catálogo do seletor — pode vir de matérias-primas (contexto Financeiro)
// ou de ferramentas_cnc (contexto Processos: brocas, fresas, insertos...)
interface CatalogoItem { id:string; codigo:string; descricao:string; custo_unitario?:number|null; }

/** Contexto do painel: define QUAL catálogo o seletor de itens mostra */
export type CompraContexto = "materiais" | "ferramentas";
interface ItemForm { mp_id:string; descricao:string; quantidade:string; unidade:string; valor_unitario:string; }
interface PedidoCompra {
  id:string; fornecedor_nome:string; status:string; data_pedido:string;
  data_previsao:string|null; data_recebimento:string|null; valor_total:number;
  nota_fiscal_entrada:string|null; observacoes:string|null;
  pedido_compra_itens: { id:string; descricao:string; quantidade:number; unidade:string; valor_unitario:number; valor_total:number; quantidade_recebida:number; }[];
}

const STATUS_LABEL: Record<string,string> = { rascunho:"Rascunho", enviado:"Enviado", parcial:"Parcial", recebido:"Recebido", cancelado:"Cancelado" };
const STATUS_COLOR: Record<string,string> = { rascunho:"text-muted-foreground bg-muted/30", enviado:"text-blue-600 bg-blue-500/10", parcial:"text-amber-600 bg-amber-500/10", recebido:"text-green-600 bg-green-500/10", cancelado:"text-red-600 bg-red-500/10" };

function NovoPedidoModal({ onClose, onSaved, contexto }: { onClose:()=>void; onSaved:()=>void; contexto:CompraContexto }) {
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [mps, setMPs] = useState<CatalogoItem[]>([]);
  const [form, setForm] = useState({ fornecedor_id:"", fornecedor_nome:"", data_previsao:"", observacoes:"" });
  // Ferramentas são compradas por unidade; matéria-prima por metro (padrão antigo)
  const unidadePadrao = contexto === "ferramentas" ? "un" : "m";
  const [itens, setItens] = useState<ItemForm[]>([{ mp_id:"", descricao:"", quantidade:"", unidade:unidadePadrao, valor_unitario:"" }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const catalogo = contexto === "ferramentas"
      // Processos: brocas, fresas, insertos, pastilhas, alargadores...
      ? supabase.from("ferramentas_cnc").select("id,codigo,descricao,tipo,custo_unitario").order("codigo")
          .then(({ data }) => (data ?? []).map(f => ({
            id: f.id, codigo: f.codigo,
            descricao: `${f.descricao}${f.tipo ? ` (${f.tipo})` : ""}`,
            custo_unitario: f.custo_unitario,
          })))
      // Financeiro: matérias-primas
      : supabase.from("materias_primas_producao").select("id,codigo,descricao").order("codigo")
          .then(({ data }) => (data ?? []) as CatalogoItem[]);

    Promise.all([
      supabase.from("fornecedores").select("id,razao_social").eq("ativo",true).order("razao_social"),
      catalogo,
    ]).then(([{data:f}, itensCatalogo]) => {
      if(f) setFornecedores(f as Fornecedor[]);
      setMPs(itensCatalogo);
    });
  }, [contexto]);

  function addItem() { setItens(i => [...i, { mp_id:"", descricao:"", quantidade:"", unidade:unidadePadrao, valor_unitario:"" }]); }
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

    if(error || !ped) { toast.error(friendlyError(error, "Não foi possível criar o pedido.")); setSaving(false); return; }

    const { error: eItens } = await supabase.from("pedido_compra_itens").insert(validItens.map(i => ({
      pedido_id: ped.id,
      // FK aponta para materias_primas_producao — só vincula nesse contexto;
      // ferramentas ficam registradas pela descrição (código + nome + tipo)
      materia_prima_id: contexto === "materiais" ? (i.mp_id || null) : null,
      descricao: i.descricao,
      quantidade: parseFloat(i.quantidade),
      unidade: i.unidade,
      valor_unitario: parseFloat(i.valor_unitario)||0,
    })));

    setSaving(false);
    if (eItens) { toast.error(friendlyError(eItens, "Pedido criado, mas houve erro ao gravar os itens. Confira o pedido.")); onSaved(); onClose(); return; }
    toast.success("Pedido de compra criado!");
    onSaved(); onClose();
  }

  const lbl = "text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block";
  const sel = "w-full h-11 rounded-xl border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <Dialog open onOpenChange={v => { if (!v && !saving) onClose(); }}>
      <DialogContent className="max-w-xl w-[calc(100vw-1.5rem)] max-h-[92vh] overflow-y-auto rounded-2xl">
        <DialogHeader className="text-left"><DialogTitle>Novo pedido de compra</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className={lbl}>Fornecedor</label>
              <select value={form.fornecedor_id} onChange={e => {
                const f = fornecedores.find(f=>f.id===e.target.value);
                setForm(p=>({...p, fornecedor_id:e.target.value, fornecedor_nome:f?.razao_social||""}));
              }} className={sel}>
                <option value="">Selecione ou digite...</option>
                {fornecedores.map(f=><option key={f.id} value={f.id}>{f.razao_social}</option>)}
              </select>
              {!form.fornecedor_id && <Input value={form.fornecedor_nome} onChange={e=>setForm(p=>({...p,fornecedor_nome:e.target.value}))} placeholder="Ou digite o nome do fornecedor" className="h-11 mt-1.5"/>}
            </div>
            <div><label className={lbl}>Previsão de Entrega</label><input type="date" value={form.data_previsao} onChange={e=>setForm(p=>({...p,data_previsao:e.target.value}))} className={sel}/></div>
          </div>

          {/* Itens */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={lbl + " mb-0"}>Itens do Pedido</label>
              <Button type="button" variant="ghost" size="sm" onClick={addItem} className="h-9 gap-1 text-primary"><Plus className="h-4 w-4"/>Adicionar item</Button>
            </div>
            <div className="space-y-2">
              {itens.map((item,i)=>(
                <div key={i} className="rounded-xl border border-border/40 p-3 space-y-2">
                  <div>
                    <select value={item.mp_id} onChange={e=>{
                      const mp=mps.find(m=>m.id===e.target.value);
                      updateItem(i,"mp_id",e.target.value);
                      if(mp) {
                        updateItem(i,"descricao",`${mp.codigo} — ${mp.descricao}`);
                        // Ferramenta com custo cadastrado já sugere o valor unitário
                        if(mp.custo_unitario != null && mp.custo_unitario > 0) updateItem(i,"valor_unitario",String(mp.custo_unitario));
                      }
                    }} className={sel}>
                      <option value="">{contexto === "ferramentas" ? "Selecione a ferramenta (broca, fresa...) ou descreva manualmente" : "Selecione a MP ou descreva manualmente"}</option>
                      {mps.map(m=><option key={m.id} value={m.id}>{m.codigo} — {m.descricao}</option>)}
                    </select>
                    <Input value={item.descricao} onChange={e=>updateItem(i,"descricao",e.target.value)} placeholder="Descrição do item" className="h-11 mt-1.5"/>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Input type="number" min="0" step="0.001" value={item.quantidade} onChange={e=>updateItem(i,"quantidade",e.target.value)} placeholder="Qtde" className="h-11"/>
                    <select value={item.unidade} onChange={e=>updateItem(i,"unidade",e.target.value)} className={sel}>
                      {["m","kg","un","pc","litro"].map(u=><option key={u}>{u}</option>)}
                    </select>
                    <Input type="number" min="0" step="0.01" value={item.valor_unitario} onChange={e=>updateItem(i,"valor_unitario",e.target.value)} placeholder="R$/un" className="h-11"/>
                  </div>
                  {itens.length>1 && <button type="button" onClick={()=>removeItem(i)} className="h-8 text-xs text-muted-foreground hover:text-destructive transition-colors">Remover item</button>}
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-2">
              <p className="text-sm font-bold">Total: {total.toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}</p>
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button className="h-11 gap-1.5" onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}Criar pedido</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Filtro = "abertos" | "recebido" | "cancelado" | "todos";

export function PedidosCompraPanel({ contexto = "materiais" }: { contexto?: CompraContexto } = {}) {
  const [pedidos, setPedidos] = useState<PedidoCompra[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [expanded, setExpanded] = useState<string|null>(null);
  const [filtro, setFiltro] = useState<Filtro>("abertos");
  const [busca, setBusca] = useState("");
  const [receber, setReceber] = useState<PedidoCompra | null>(null);
  const [nfEntrada, setNfEntrada] = useState("");
  const [cancelar, setCancelar] = useState<PedidoCompra | null>(null);
  const [salvando, setSalvando] = useState(false);

  const load = useCallback(async()=>{
    setLoading(true);
    const{data,error}=await supabase.from("pedidos_compra")
      .select("*, pedido_compra_itens(*)")
      .order("created_at",{ascending:false});
    if (error) toast.error(friendlyError(error, "Não foi possível carregar os pedidos de compra."));
    if(data) setPedidos(data as PedidoCompra[]);
    setLoading(false);
  },[]);

  useEffect(()=>{load();},[load]);

  async function atualizar(id: string, patch: { status: string; data_recebimento?: string; nota_fiscal_entrada?: string }, msg: string) {
    setSalvando(true);
    const { error } = await supabase.from("pedidos_compra").update(patch).eq("id", id);
    setSalvando(false);
    if (error) { toast.error(friendlyError(error, "Não foi possível atualizar o pedido.")); return false; }
    toast.success(msg);
    load();
    return true;
  }

  const contagem = useMemo(() => ({
    abertos: pedidos.filter(p => ["rascunho","enviado","parcial"].includes(p.status)).length,
    recebido: pedidos.filter(p => p.status === "recebido").length,
    cancelado: pedidos.filter(p => p.status === "cancelado").length,
    todos: pedidos.length,
  }), [pedidos]);

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return pedidos.filter(p => {
      if (filtro === "abertos" && !["rascunho","enviado","parcial"].includes(p.status)) return false;
      if ((filtro === "recebido" || filtro === "cancelado") && p.status !== filtro) return false;
      if (!q) return true;
      return p.fornecedor_nome.toLowerCase().includes(q)
        || (p.nota_fiscal_entrada ?? "").toLowerCase().includes(q)
        || (p.pedido_compra_itens ?? []).some(i => i.descricao.toLowerCase().includes(q));
    });
  }, [pedidos, filtro, busca]);

  const brl = (v: number) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Fornecedor, item ou NF..." className="pl-9 h-11" />
        </div>
        <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={load} disabled={loading} aria-label="Atualizar">
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
        <Button className="h-11 gap-1.5 shrink-0" onClick={()=>setModal(true)}><Plus className="h-4 w-4"/><span className="hidden sm:inline">Novo pedido</span><span className="sm:hidden">Novo</span></Button>
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none -mx-3 px-3 sm:mx-0 sm:px-0" role="tablist">
        {([["abertos","Em aberto"],["recebido","Recebidos"],["cancelado","Cancelados"],["todos","Todos"]] as [Filtro,string][]).map(([id,l]) => (
          <button key={id} type="button" role="tab" aria-selected={filtro===id} onClick={()=>setFiltro(id)}
            className={cn("h-9 shrink-0 rounded-full border px-3 text-sm font-medium inline-flex items-center gap-1.5",
              filtro===id ? "bg-foreground text-background border-foreground" : "bg-card text-muted-foreground hover:text-foreground")}>
            {l}<span className="text-xs tabular-nums opacity-80">{contagem[id]}</span>
          </button>
        ))}
      </div>

      {loading&&pedidos.length===0 ? <div className="flex justify-center py-16 text-sm text-muted-foreground gap-2"><Loader2 className="h-4 w-4 animate-spin"/>Carregando...</div>
      :lista.length===0 ? (
        <div className="rounded-2xl border border-dashed bg-card py-12 px-4 text-center space-y-2">
          <PackageSearch className="h-9 w-9 mx-auto text-muted-foreground/40"/>
          <p className="font-medium">{pedidos.length === 0 ? "Nenhum pedido de compra" : "Nenhum pedido neste filtro"}</p>
          {pedidos.length === 0 && <Button className="h-11 gap-1.5 mt-1" onClick={()=>setModal(true)}><Plus className="h-4 w-4"/>Criar pedido de compra</Button>}
        </div>
      ):(
        <ul className="space-y-2">
          {lista.map(p=>{
            const aberto = expanded===p.id;
            const prox = nextStatus[p.status];
            return (
            <li key={p.id} className="rounded-2xl border bg-card overflow-hidden">
              <button type="button" className="w-full text-left p-3 sm:px-4 flex items-center gap-3 hover:bg-muted/30" onClick={()=>setExpanded(aberto?null:p.id)} aria-expanded={aberto}>
                <div className="h-9 w-9 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0"><Truck className="h-4 w-4 text-blue-600"/></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold truncate">{p.fornecedor_nome}</p>
                    <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium",STATUS_COLOR[p.status])}>{STATUS_LABEL[p.status] ?? p.status}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{new Date(p.data_pedido+"T12:00:00").toLocaleDateString("pt-BR")} · {p.pedido_compra_itens?.length||0} itens · {brl(p.valor_total)}{p.nota_fiscal_entrada ? ` · NF ${p.nota_fiscal_entrada}` : ""}</p>
                </div>
                <ChevronDown className={cn("h-4 w-4 text-muted-foreground shrink-0 transition-transform", aberto && "rotate-180")}/>
              </button>
              {aberto && (
                <div className="border-t px-3 sm:px-4 py-3 space-y-3">
                  <ul className="divide-y rounded-xl border">
                    {p.pedido_compra_itens?.map((item,i)=>(
                      <li key={i} className="flex items-center justify-between gap-2 text-sm px-3 py-2">
                        <span className="min-w-0 flex-1 break-words">{item.descricao}</span>
                        <span className="text-muted-foreground shrink-0">{item.quantidade} {item.unidade}</span>
                        <span className="font-medium shrink-0 w-24 text-right">{brl(item.valor_total)}</span>
                      </li>
                    ))}
                  </ul>
                  {(p.data_previsao || p.data_recebimento || p.observacoes) && (
                    <p className="text-xs text-muted-foreground">
                      {[p.data_previsao ? `Previsão: ${new Date(p.data_previsao+"T12:00:00").toLocaleDateString("pt-BR")}` : null,
                        p.data_recebimento ? `Recebido em ${new Date(p.data_recebimento+"T12:00:00").toLocaleDateString("pt-BR")}` : null,
                        p.observacoes].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  <div className="grid grid-cols-2 sm:flex gap-2">
                    {prox && (
                      <Button className="h-10 gap-1.5" disabled={salvando} onClick={() => {
                        if (prox.s === "recebido") { setNfEntrada(p.nota_fiscal_entrada ?? ""); setReceber(p); }
                        else atualizar(p.id, { status: prox.s }, "Pedido marcado como enviado.");
                      }}>
                        <CheckCircle2 className="h-4 w-4"/>{prox.label}
                      </Button>
                    )}
                    {["rascunho","enviado"].includes(p.status) && (
                      <Button variant="outline" className="h-10 gap-1.5 text-red-600 dark:text-red-400" onClick={() => setCancelar(p)}><Ban className="h-4 w-4"/>Cancelar</Button>
                    )}
                  </div>
                </div>
              )}
            </li>
          );})}
        </ul>
      )}
      {modal && <NovoPedidoModal contexto={contexto} onClose={()=>setModal(false)} onSaved={load}/>}

      {/* Confirmar recebimento (com NF de entrada opcional) */}
      <Dialog open={!!receber} onOpenChange={v => { if (!v && !salvando) setReceber(null); }}>
        <DialogContent className="max-w-md w-[calc(100vw-1.5rem)] rounded-2xl">
          <DialogHeader className="text-left">
            <DialogTitle>Confirmar recebimento</DialogTitle>
            <DialogDescription>{receber?.fornecedor_nome} · {brl(receber?.valor_total ?? 0)}</DialogDescription>
          </DialogHeader>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nº da NF de entrada (opcional)</span>
            <Input value={nfEntrada} onChange={e => setNfEntrada(e.target.value.slice(0, 60))} className="h-11" inputMode="numeric" />
          </label>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-11" onClick={() => setReceber(null)} disabled={salvando}>Voltar</Button>
            <Button className="h-11 gap-1.5" disabled={salvando} onClick={async () => {
              if (!receber) return;
              const ok = await atualizar(receber.id, { status: "recebido", data_recebimento: new Date().toISOString().split("T")[0], ...(nfEntrada.trim() ? { nota_fiscal_entrada: nfEntrada.trim() } : {}) }, "Recebimento confirmado.");
              if (ok) setReceber(null);
            }}>{salvando && <Loader2 className="h-4 w-4 animate-spin"/>}Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancelar pedido */}
      <Dialog open={!!cancelar} onOpenChange={v => { if (!v && !salvando) setCancelar(null); }}>
        <DialogContent className="max-w-md w-[calc(100vw-1.5rem)] rounded-2xl">
          <DialogHeader className="text-left">
            <DialogTitle>Cancelar pedido de compra?</DialogTitle>
            <DialogDescription>{cancelar?.fornecedor_nome} — o pedido fica registrado como cancelado.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-11" onClick={() => setCancelar(null)} disabled={salvando}>Voltar</Button>
            <Button className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={salvando} onClick={async () => {
              if (!cancelar) return;
              const ok = await atualizar(cancelar.id, { status: "cancelado" }, "Pedido cancelado.");
              if (ok) setCancelar(null);
            }}>{salvando && <Loader2 className="h-4 w-4 animate-spin mr-1.5"/>}Cancelar pedido</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const nextStatus: Record<string,{s:string;label:string}> = {
  rascunho:{s:"enviado",label:"Marcar enviado"},
  enviado: {s:"recebido",label:"Confirmar recebimento"},
  parcial: {s:"recebido",label:"Confirmar recebimento"},
};
