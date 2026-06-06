import { useState, useCallback } from "react";
import { Search, RefreshCw, AlertTriangle, CheckCircle2, Package, ChevronDown, ChevronUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

interface RastrItem {
  id:string; lote:string; device_ref:string; device_model:string; udi_di:string|null;
  quantidade:number; cliente_nome:string; clinica:string|null; cirurgiao:string|null;
  data_envio:string; status_recall:string; observacoes:string|null;
  pedido_id:string;
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

  const buscar = useCallback(async () => {
    if(!search.trim()) return;
    setLoading(true);
    setSearched(true);
    const { data } = await supabase
      .from("rastreabilidade_pos_venda")
      .select("*")
      .or(`lote.ilike.%${search}%,device_ref.ilike.%${search}%,device_model.ilike.%${search}%,cliente_nome.ilike.%${search}%,udi_di.ilike.%${search}%`)
      .order("data_envio", { ascending: false })
      .limit(100);
    if(data) setResults(data as RastrItem[]);
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
              <button className="w-full text-left px-4 py-3 flex items-center gap-3" onClick={()=>setExpanded(expanded===r.id?null:r.id)}>
                <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center shrink-0",RECALL_COLOR[r.status_recall])}>
                  {r.status_recall==="normal"?<CheckCircle2 className="h-4 w-4"/>:<AlertTriangle className="h-4 w-4"/>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold font-mono">{r.lote}</p>
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium",RECALL_COLOR[r.status_recall])}>{r.status_recall.replace("_"," ")}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">{r.device_model} · {r.device_ref} · {r.quantidade} un. → {r.cliente_nome}</p>
                  <p className="text-[10px] text-muted-foreground">{new Date(r.data_envio+"T12:00:00").toLocaleDateString("pt-BR")}</p>
                </div>
                {expanded===r.id?<ChevronUp className="h-4 w-4 text-muted-foreground shrink-0"/>:<ChevronDown className="h-4 w-4 text-muted-foreground shrink-0"/>}
              </button>
              {expanded===r.id && (
                <div className="border-t border-border/20 px-4 pb-4 pt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-[11px]">
                    <div><p className="text-muted-foreground">Referência</p><p className="font-mono font-medium">{r.device_ref}</p></div>
                    <div><p className="text-muted-foreground">UDI-DI</p><p className="font-mono font-medium">{r.udi_di||"—"}</p></div>
                    <div><p className="text-muted-foreground">Quantidade</p><p className="font-medium">{r.quantidade} unidades</p></div>
                    <div><p className="text-muted-foreground">Data de Envio</p><p className="font-medium">{new Date(r.data_envio+"T12:00:00").toLocaleDateString("pt-BR")}</p></div>
                    {r.clinica&&<div><p className="text-muted-foreground">Clínica / Hospital</p><p className="font-medium">{r.clinica}</p></div>}
                    {r.cirurgiao&&<div><p className="text-muted-foreground">Cirurgião</p><p className="font-medium">{r.cirurgiao}</p></div>}
                  </div>
                  {/* Ações de recall */}
                  <div className="border-t border-border/20 pt-3">
                    <p className="text-[10px] text-muted-foreground mb-2">Atualizar status de recall:</p>
                    <div className="flex gap-2 flex-wrap">
                      {(["normal","alerta","recall_ativo","devolvido"] as const).map(s=>(
                        <button key={s} onClick={()=>updateRecall(r.id,s)}
                          className={cn("h-7 px-2 rounded-lg text-[11px] font-medium border transition-colors",
                            r.status_recall===s?"bg-primary text-primary-foreground border-primary":"border-input hover:bg-muted/40")}>
                          {s.replace("_"," ")}
                        </button>
                      ))}
                    </div>
                  </div>
                  {r.observacoes&&<p className="text-[11px] text-muted-foreground italic">{r.observacoes}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
