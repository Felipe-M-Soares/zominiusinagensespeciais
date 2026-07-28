/**
 * MateriaPrimaPanel — Controle de Matéria-Prima
 * ✓ Dados reais via Supabase (tabelas materias_primas_producao + movimentos_mp_producao)
 * ✓ Fallback offline com IndexedDB
 */

import { useState, useEffect, useCallback } from "react";
import { Plus, X, Search, Boxes, AlertTriangle, ArrowDown, ArrowUp, RefreshCw, Edit2, Trash2, ShoppingCart, Truck, CheckCircle2 } from "lucide-react";
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

// ── Pedido de barras (usa as tabelas existentes pedidos_compra +
//    pedido_compra_itens da migration 20260034 — mesmas do módulo Compras,
//    então o pedido criado aqui aparece lá também) ──────────────────────────
interface PedidoItemForm { materia_prima_id: string; quantidade: string; valor_unitario: string; }
interface PedidoBarras {
  id: string; fornecedor_nome: string; status: string;
  data_pedido: string; data_previsao: string | null; valor_total: number;
  observacoes: string | null; created_at: string;
  itens: { id: string; descricao: string; quantidade: number; unidade: string; quantidade_recebida: number }[];
}

const STATUS_PEDIDO: Record<string, { label: string; cls: string }> = {
  rascunho:  { label: "Rascunho",  cls: "bg-muted text-muted-foreground" },
  enviado:   { label: "Enviado",   cls: "bg-blue-500/15 text-blue-600" },
  parcial:   { label: "Parcial",   cls: "bg-amber-500/15 text-amber-600" },
  recebido:  { label: "Recebido",  cls: "bg-green-500/15 text-green-600" },
  cancelado: { label: "Cancelado", cls: "bg-red-500/15 text-red-600" },
};

function PedidoBarrasModal({ open, materias, onClose, onSaved }: {
  open: boolean; materias: MateriaPrima[]; onClose: () => void; onSaved: () => void;
}) {
  const [fornecedores, setFornecedores] = useState<{ id: string; razao_social: string }[]>([]);
  const [form, setForm] = useState({ fornecedor: "", data_previsao: "", observacoes: "", enviar: true });
  const [itens, setItens] = useState<PedidoItemForm[]>([{ materia_prima_id: "", quantidade: "", valor_unitario: "" }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({ fornecedor: "", data_previsao: "", observacoes: "", enviar: true });
    setItens([{ materia_prima_id: "", quantidade: "", valor_unitario: "" }]);
    supabase.from("fornecedores").select("id,razao_social").order("razao_social")
      .then(({ data }) => setFornecedores(data ?? []));
  }, [open]);

  if (!open) return null;

  const setItem = (i: number, patch: Partial<PedidoItemForm>) =>
    setItens(prev => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it));

  async function save() {
    const validos = itens.filter(it => it.materia_prima_id && Number(it.quantidade) > 0);
    if (!form.fornecedor.trim()) { toast.error("Informe o fornecedor"); return; }
    if (validos.length === 0) { toast.error("Adicione ao menos uma barra com quantidade"); return; }
    setSaving(true);

    const valorTotal = validos.reduce((s, it) => s + (Number(it.quantidade) || 0) * (Number(it.valor_unitario) || 0), 0);
    const { data: pedido, error } = await supabase.from("pedidos_compra").insert({
      fornecedor_nome: form.fornecedor.trim(),
      status: form.enviar ? "enviado" : "rascunho",
      data_previsao: form.data_previsao || null,
      valor_total: +valorTotal.toFixed(2),
      observacoes: form.observacoes ? `[Pedido de barras — Produção] ${form.observacoes}` : "[Pedido de barras — Produção]",
    }).select("id").single();

    if (error || !pedido) {
      setSaving(false);
      toast.error(error?.message?.includes("policy")
        ? "Seu perfil não tem permissão para criar pedidos de compra — verifique se a policy pc_write no banco já inclui a role 'producao'"
        : "Erro ao criar pedido");
      return;
    }

    const linhas = validos.map(it => {
      const mp = materias.find(m => m.id === it.materia_prima_id)!;
      return {
        pedido_id: pedido.id,
        materia_prima_id: mp.id,
        descricao: `${mp.codigo} — ${mp.descricao}`,
        quantidade: Number(it.quantidade),
        unidade: mp.unidade || "m",
        valor_unitario: Number(it.valor_unitario) || 0,
      };
    });
    const { error: errItens } = await supabase.from("pedido_compra_itens").insert(linhas);
    setSaving(false);
    if (errItens) { toast.error("Pedido criado, mas houve erro ao salvar os itens"); return; }
    toast.success("Pedido de barras registrado!");
    onSaved(); onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-card rounded-2xl border shadow-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2"><ShoppingCart className="h-4 w-4 text-primary"/>Pedido de barras</h3>
          <button onClick={onClose} aria-label="Fechar"><X className="h-4 w-4"/></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Fornecedor *</label>
            <Input list="fornecedores-mp" value={form.fornecedor}
              onChange={e=>setForm(p=>({...p,fornecedor:e.target.value}))}
              placeholder="Digite ou escolha um fornecedor"/>
            <datalist id="fornecedores-mp">
              {fornecedores.map(f=><option key={f.id} value={f.razao_social}/>)}
            </datalist>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Previsão de entrega</label>
              <Input type="date" value={form.data_previsao} onChange={e=>setForm(p=>({...p,data_previsao:e.target.value}))}/>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm h-9 cursor-pointer select-none">
                <input type="checkbox" checked={form.enviar} onChange={e=>setForm(p=>({...p,enviar:e.target.checked}))} className="h-4 w-4 rounded border-input"/>
                Marcar como enviado
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground block">Barras do pedido *</label>
            {itens.map((it,i)=>(
              <div key={i} className="flex gap-2 items-start">
                <select value={it.materia_prima_id} onChange={e=>setItem(i,{materia_prima_id:e.target.value})}
                  className="flex-1 h-9 rounded-lg border border-input bg-background px-2 text-sm min-w-0">
                  <option value="">Material...</option>
                  {materias.map(m=><option key={m.id} value={m.id}>{m.codigo} — {m.descricao}</option>)}
                </select>
                <Input type="number" min="0.001" step="0.001" value={it.quantidade}
                  onChange={e=>setItem(i,{quantidade:e.target.value})}
                  placeholder="Qtd (m)" className="w-24 h-9"/>
                <Input type="number" min="0" step="0.01" value={it.valor_unitario}
                  onChange={e=>setItem(i,{valor_unitario:e.target.value})}
                  placeholder="R$/un" className="w-24 h-9"/>
                {itens.length>1&&(
                  <button onClick={()=>setItens(prev=>prev.filter((_,idx)=>idx!==i))}
                    className="h-9 w-8 flex items-center justify-center text-muted-foreground hover:text-red-500 shrink-0">
                    <Trash2 className="h-4 w-4"/>
                  </button>
                )}
              </div>
            ))}
            <Button size="sm" variant="outline" className="gap-1 h-8"
              onClick={()=>setItens(prev=>[...prev,{materia_prima_id:"",quantidade:"",valor_unitario:""}])}>
              <Plus className="h-3.5 w-3.5"/>Adicionar barra
            </Button>
          </div>

          <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Observações</label>
            <Input value={form.observacoes} onChange={e=>setForm(p=>({...p,observacoes:e.target.value}))} placeholder="Ex: bitola, norma, urgência..."/>
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button className="flex-1" onClick={save} disabled={saving}>{saving?"Salvando...":"Registrar pedido"}</Button>
        </div>
      </div>
    </div>
  );
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
  const [pedidos,setPedidos]=useState<PedidoBarras[]>([]);
  const [loading,setLoading]=useState(true);
  const [modalOpen,setModalOpen]=useState(false);
  const [pedidoModalOpen,setPedidoModalOpen]=useState(false);
  const [search,setSearch]=useState("");
  const [aba,setAba]=useState<"estoque"|"movimentos"|"pedidos">("estoque");
  const {loadWithFallback}=useOfflineSync();

  const loadPedidos=useCallback(async()=>{
    // Pedidos de barras = pedidos_compra cujos itens apontam para
    // materias_primas_producao (mesma tabela do módulo Compras)
    const {data}=await supabase.from("pedidos_compra")
      .select("id,fornecedor_nome,status,data_pedido,data_previsao,valor_total,observacoes,created_at,pedido_compra_itens(id,descricao,quantidade,unidade,quantidade_recebida,materia_prima_id)")
      .order("created_at",{ascending:false}).limit(50);
    if(!data){setPedidos([]);return;}
    const soBarras=data
      .filter(p=>(p.pedido_compra_itens??[]).some((it:{materia_prima_id:string|null})=>it.materia_prima_id))
      .map(p=>({
        id:p.id,fornecedor_nome:p.fornecedor_nome,status:p.status,
        data_pedido:p.data_pedido,data_previsao:p.data_previsao,
        valor_total:Number(p.valor_total)||0,observacoes:p.observacoes,created_at:p.created_at,
        itens:(p.pedido_compra_itens??[]).map((it:{id:string;descricao:string;quantidade:number;unidade:string;quantidade_recebida:number})=>({
          id:it.id,descricao:it.descricao,quantidade:Number(it.quantidade)||0,
          unidade:it.unidade,quantidade_recebida:Number(it.quantidade_recebida)||0,
        })),
      }));
    setPedidos(soBarras);
  },[]);

  const load=useCallback(async()=>{
    setLoading(true);
    const [mats,movs]=await Promise.all([
      loadWithFallback<MateriaPrima>("materias_primas_producao","materias_primas"),
      loadWithFallback<Movimento>("movimentos_mp_producao","movimentos_mp"),
      loadPedidos(),
    ]);
    setMaterias(mats.sort((a,b)=>a.codigo.localeCompare(b.codigo)));
    setMovimentos(movs.sort((a,b)=>(b.created_at||"").localeCompare(a.created_at||"")));
    setLoading(false);
  },[loadWithFallback,loadPedidos]);

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
        {(["estoque","movimentos","pedidos"] as const).map(t=>(
          <button key={t} onClick={()=>setAba(t)}
            className={cn("flex-1 py-2 text-sm font-medium transition-colors",aba===t?"bg-primary text-primary-foreground":"hover:bg-muted/40")}>
            {t==="estoque"?"Estoque":t==="movimentos"?"Movimentos":"Pedidos"}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1"><SearchInputWithBarcode value={search} onChange={setSearch} onSearch={setSearch} placeholder="Bipe o código ou busque material..." height="h-9"/></div>
        {aba==="pedidos"
          ? <Button size="sm" className="gap-1 h-9" onClick={()=>setPedidoModalOpen(true)}><ShoppingCart className="h-4 w-4"/>Pedir barras</Button>
          : <Button size="sm" className="gap-1 h-9" onClick={()=>setModalOpen(true)}><Plus className="h-4 w-4"/>Movimentar</Button>}
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
      ) : aba==="pedidos" ? (
        pedidos.length===0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-sm gap-2">
            <ShoppingCart className="h-8 w-8 opacity-30"/><p>Nenhum pedido de barras registrado</p>
            <Button size="sm" variant="outline" className="gap-1 mt-1" onClick={()=>setPedidoModalOpen(true)}><Plus className="h-3.5 w-3.5"/>Fazer primeiro pedido</Button>
          </div>
        ) : (
          <div className="space-y-3">
            {pedidos
              .filter(p=>!search||[p.fornecedor_nome,...p.itens.map(i=>i.descricao)].some(v=>v.toLowerCase().includes(search.toLowerCase())))
              .map(p=>{
                const st=STATUS_PEDIDO[p.status]??STATUS_PEDIDO.rascunho;
                const recebidoTotal=p.itens.every(i=>i.quantidade_recebida>=i.quantidade);
                return (
                  <div key={p.id} className="rounded-2xl border bg-card/60 p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{p.fornecedor_nome}</p>
                        <p className="text-[11px] text-muted-foreground">
                          Pedido em {new Date(p.data_pedido+"T00:00:00").toLocaleDateString("pt-BR")}
                          {p.data_previsao&&<> · <Truck className="inline h-3 w-3 -mt-0.5"/> previsão {new Date(p.data_previsao+"T00:00:00").toLocaleDateString("pt-BR")}</>}
                        </p>
                      </div>
                      <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0",st.cls)}>{st.label}</span>
                    </div>
                    <div className="space-y-1">
                      {p.itens.map(it=>(
                        <div key={it.id} className="flex items-center gap-2 text-[12px]">
                          {it.quantidade_recebida>=it.quantidade
                            ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0"/>
                            : <span className="h-3.5 w-3.5 rounded-full border border-muted-foreground/40 shrink-0"/>}
                          <span className="truncate flex-1">{it.descricao}</span>
                          <span className="text-muted-foreground shrink-0">
                            {it.quantidade_recebida>0?`${it.quantidade_recebida}/`:""}{it.quantidade} {it.unidade}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
                      <span>{p.itens.length} {p.itens.length===1?"item":"itens"}{recebidoTotal&&p.status!=="recebido"?" · tudo recebido":""}</span>
                      {p.valor_total>0&&<span className="font-semibold text-foreground">R$ {p.valor_total.toLocaleString("pt-BR",{minimumFractionDigits:2})}</span>}
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
      <PedidoBarrasModal open={pedidoModalOpen} materias={materias} onClose={()=>setPedidoModalOpen(false)} onSaved={loadPedidos}/>
    </div>
  );
}
