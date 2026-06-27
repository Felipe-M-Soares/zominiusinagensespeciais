import { useState, useCallback } from "react";
import { Search, RefreshCw, AlertTriangle, CheckCircle2, Package, ChevronDown, ChevronUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { sanitizeQuery } from "@/lib/sanitize";

interface RastrItem {
  id:string; lote:string; device_ref:string; device_model:string; udi_di:string|null;
  quantidade:number; cliente_nome:string; clinica:string|null; cirurgiao:string|null;
  paciente_codigo:string|null;
  data_envio:string; status_recall:string; observacoes:string|null;
  pedido_id:string; cliente_id:string|null;
}

interface ClienteInfo {
  telefone:string|null; email:string|null; documento:string|null; endereco:string|null;
}

const RECALL_COLOR: Record<string,string> = {
  normal:"text-green-600 bg-green-500/10", alerta:"text-amber-600 bg-amber-500/10",
  recall_ativo:"text-red-600 bg-red-500/10 animate-pulse", devolvido:"text-muted-foreground bg-muted/20"
};

export function RastreabilidadePanel() {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<RastrItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [expanded, setExpanded] = useState<string|null>(null);
  const [clienteInfo, setClienteInfo] = useState<Record<string,ClienteInfo>>({});

  const buscar = useCallback(async () => {
    if(!search.trim()) return;
    setLoading(true);
    setSearched(true);
    const q = sanitizeQuery(search);
    const { data, error } = await supabase
      .from("rastreabilidade_pos_venda")
      .select("*")
      .or(`lote.ilike.%${q}%,device_ref.ilike.%${q}%,device_model.ilike.%${q}%,cliente_nome.ilike.%${q}%,udi_di.ilike.%${q}%`)
      .order("data_envio", { ascending: false })
      .limit(100);
    if(error){ setResults([]); }
    else if(data) {
      setResults(data as RastrItem[]);
      // Busca dados de contato dos clientes para informação de recall
      const clienteIds = [...new Set((data as RastrItem[]).filter(r=>r.cliente_id).map(r=>r.cliente_id!))];
      if(clienteIds.length > 0) {
        const { data: clientes } = await supabase
          .from("clientes")
          .select("id,telefone,email,documento,endereco")
          .in("id", clienteIds);
        if(clientes) {
          const map: Record<string,ClienteInfo> = {};
          clientes.forEach((cl: ClienteInfo & {id:string}) => { map[cl.id] = cl; });
          setClienteInfo(map);
        }
      }
    }
    setLoading(false);
  }, [search]);

  async function updateRecall(id:string, status:string) {
    await supabase.from("rastreabilidade_pos_venda").update({status_recall:status}).eq("id",id);
    buscar();
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div>
        <p className="text-sm font-semibold mb-1">Busca de Rastreabilidade</p>
        <p className="text-[11px] text-muted-foreground mb-3">
          Busque por lote, referência, modelo, UDI-DI ou cliente para rastrear destino dos produtos
        </p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
            <Input
              value={search}
              onChange={e=>setSearch(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&buscar()}
              placeholder="Lote, referência, modelo, UDI-DI ou cliente..."
              className="pl-9 h-9"
            />
          </div>
          <button
            onClick={buscar}
            disabled={loading||!search.trim()}
            className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {loading?<RefreshCw className="h-4 w-4 animate-spin"/>:<Search className="h-4 w-4"/>}
            Buscar
          </button>
        </div>
      </div>

      {searched && !loading && results.length === 0 && (
        <div className="text-center py-10 text-muted-foreground text-sm">
          <Package className="h-8 w-8 mx-auto opacity-20 mb-2"/>
          <p>Nenhum resultado para "{search}"</p>
          <p className="text-[10px] mt-1">Os registros são criados automaticamente quando um pedido é marcado como "Enviado"</p>
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">{results.length} registro(s) encontrado(s)</p>
          {results.map(r=>(
            <div key={r.id} className={cn("rounded-2xl border overflow-hidden",
              r.status_recall==="recall_ativo"?"border-red-500/30 bg-red-500/5":
              r.status_recall==="alerta"?"border-amber-500/30 bg-amber-500/5":
              "border-border/40 bg-card")}>
              {/* Header compacto */}
              <div className="px-3 py-2.5 flex items-center gap-2 cursor-pointer" onClick={()=>setExpanded(expanded===r.id?null:r.id)}>
                <span className={cn("h-2 w-2 rounded-full shrink-0",
                  r.status_recall==="normal"?"bg-green-500":
                  r.status_recall==="alerta"?"bg-amber-500":
                  r.status_recall==="recall_ativo"?"bg-red-500 animate-pulse":"bg-muted-foreground")}/>
                <p className="text-[12px] font-mono font-semibold">{r.lote}</p>
                <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium",RECALL_COLOR[r.status_recall])}>{r.status_recall.replace("_"," ")}</span>
                <span className="text-[11px] text-muted-foreground truncate flex-1">· {r.device_ref} · {r.quantidade}un → {r.cliente_nome}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">{new Date(r.data_envio+"T12:00:00").toLocaleDateString("pt-BR")}</span>
                {expanded===r.id?<ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0"/>:<ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0"/>}
              </div>
              {expanded===r.id && (() => {
                const cli = r.cliente_id ? clienteInfo[r.cliente_id] : null;
                return (
                <div className="border-t border-border/20 px-3 pb-3 pt-2.5 space-y-2.5">
                  {/* Produto */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                    <div><p className="text-muted-foreground">Referência</p><p className="font-mono font-medium">{r.device_ref}</p></div>
                    <div><p className="text-muted-foreground">UDI-DI</p><p className="font-mono">{r.udi_di||"—"}</p></div>
                    <div><p className="text-muted-foreground">Quantidade</p><p className="font-medium">{r.quantidade} un.</p></div>
                    <div><p className="text-muted-foreground">Envio</p><p className="font-medium">{new Date(r.data_envio+"T12:00:00").toLocaleDateString("pt-BR")}</p></div>
                  </div>
                  {/* Cliente — info de recall */}
                  <div className="rounded-lg bg-muted/20 px-3 py-2 space-y-1.5">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Contato para Recall</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                      <div><p className="text-muted-foreground">Cliente</p><p className="font-medium">{r.cliente_nome}</p></div>
                      {cli?.telefone&&<div><p className="text-muted-foreground">Telefone</p><p className="font-medium">{cli.telefone}</p></div>}
                      {cli?.email&&<div><p className="text-muted-foreground">E-mail</p><p className="font-medium truncate">{cli.email}</p></div>}
                      {cli?.documento&&<div><p className="text-muted-foreground">CNPJ/CPF</p><p className="font-mono">{cli.documento}</p></div>}
                      {r.clinica&&<div><p className="text-muted-foreground">Clínica</p><p className="font-medium">{r.clinica}</p></div>}
                      {r.cirurgiao&&<div><p className="text-muted-foreground">Cirurgião</p><p className="font-medium">{r.cirurgiao}</p></div>}
                    </div>
                  </div>
                  {/* Status recall */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-[10px] text-muted-foreground">Status:</p>
                    {(["normal","alerta","recall_ativo","devolvido"] as const).map(s=>(
                      <button key={s} onClick={()=>updateRecall(r.id,s)}
                        className={cn("h-6 px-2 rounded-lg text-[10px] font-medium border transition-colors",
                          r.status_recall===s?"bg-primary text-primary-foreground border-primary":"border-input hover:bg-muted/40")}>
                        {s.replace("_"," ")}
                      </button>
                    ))}
                  </div>
                  {r.observacoes&&<p className="text-[10px] text-muted-foreground italic">{r.observacoes}</p>}
                </div>
                );
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
