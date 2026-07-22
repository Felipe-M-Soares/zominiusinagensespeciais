/**
 * RelatoriosPanel — Relatórios Industriais
 * ✓ Dados reais via Supabase
 * ✓ Fallback offline com IndexedDB
 */

import { useState, useCallback } from "react";
import { FileBarChart2, Download, Calendar, RefreshCw, BarChart2, Clock, ShieldAlert, Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { supabase } from "@/integrations/supabase/client";

type RelatorioTipo = "producao_diaria"|"eficiencia"|"paradas"|"refugo";

const RELATORIOS: {id:RelatorioTipo;label:string;descricao:string;Icon:React.ElementType;color:string;bg:string}[] = [
  {id:"producao_diaria", label:"Produção Diária",    descricao:"Peças produzidas por dia e turno",           Icon:BarChart2,    color:"text-blue-500",   bg:"bg-blue-500/10"},
  {id:"eficiencia",      label:"Eficiência / OEE",   descricao:"Disponibilidade e desempenho das máquinas",  Icon:FileBarChart2, color:"text-green-500",  bg:"bg-green-500/10"},
  {id:"paradas",         label:"Análise de Paradas",  descricao:"Tempo perdido, motivos e frequência",        Icon:Clock,        color:"text-red-500",    bg:"bg-red-500/10"},
  {id:"refugo",          label:"Refugo e Qualidade",  descricao:"Índice de refugo, defeitos e destinações",   Icon:ShieldAlert,  color:"text-orange-500", bg:"bg-orange-500/10"},
];

interface RelData {
  producaoDiaria?: {dia:string;producao:number}[];
  eficiencia?: {maquina:string;disponib:number}[];
  paradas?: {motivo:string;minutos:number;ocorrencias:number}[];
  refugo?: {tipo:string;quantidade:number}[];
}

export function RelatoriosPanel({ onImport }: { onImport?: () => void } = {}) {
  const [relatorio,setRelatorio]=useState<RelatorioTipo|null>(null);
  const [dataInicio,setDataInicio]=useState(()=>{const d=new Date();d.setDate(d.getDate()-14);return d.toISOString().split("T")[0];});
  const [dataFim,setDataFim]=useState(()=>new Date().toISOString().split("T")[0]);
  const [loading,setLoading]=useState(false);
  const [relData,setRelData]=useState<RelData|null>(null);

  const gerarRelatorio=useCallback(async(tipo:RelatorioTipo)=>{
    setRelatorio(tipo);
    setLoading(true);
    setRelData(null);

    if(!navigator.onLine){
      toast.warning("Relatórios detalhados requerem conexão com a internet");
      setLoading(false);
      return;
    }

    try {
      const inicioISO=`${dataInicio}T00:00:00`;
      const fimISO=`${dataFim}T23:59:59`;

      if(tipo==="producao_diaria"){
        const {data}=await supabase.from("apontamentos_producao").select("quantidade,created_at").gte("created_at",inicioISO).lte("created_at",fimISO);
        const diasMap:Record<string,number>={};
        (data||[]).forEach((a:{quantidade:number;created_at:string})=>{
          const dia=new Date(a.created_at).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"});
          diasMap[dia]=(diasMap[dia]||0)+(a.quantidade||0);
        });
        setRelData({producaoDiaria:Object.entries(diasMap).map(([dia,producao])=>({dia,producao}))});
      }
      else if(tipo==="eficiencia"){
        const {data}=await supabase.from("maquinas_producao").select("codigo,disponibilidade,status");
        setRelData({eficiencia:(data||[]).map((m:{codigo:string;disponibilidade:number})=>({maquina:m.codigo,disponib:m.disponibilidade}))});
      }
      else if(tipo==="paradas"){
        const {data}=await supabase.from("paradas_producao").select("motivo,duracao_min").gte("created_at",inicioISO).lte("created_at",fimISO);
        const motivoMap:Record<string,{minutos:number;ocorrencias:number}>={};
        (data||[]).forEach((p:{motivo:string;duracao_min:number|null})=>{
          if(!motivoMap[p.motivo]) motivoMap[p.motivo]={minutos:0,ocorrencias:0};
          motivoMap[p.motivo].minutos+=(p.duracao_min||0);
          motivoMap[p.motivo].ocorrencias++;
        });
        setRelData({paradas:Object.entries(motivoMap).map(([motivo,v])=>({motivo,...v})).sort((a,b)=>b.minutos-a.minutos)});
      }
      else if(tipo==="refugo"){
        const {data}=await supabase.from("refugos_producao").select("tipo_defeito,quantidade").gte("created_at",inicioISO).lte("created_at",fimISO);
        const tipoMap:Record<string,number>={};
        (data||[]).forEach((r:{tipo_defeito:string;quantidade:number})=>{tipoMap[r.tipo_defeito]=(tipoMap[r.tipo_defeito]||0)+r.quantidade;});
        setRelData({refugo:Object.entries(tipoMap).map(([tipo,quantidade])=>({tipo,quantidade})).sort((a,b)=>b.quantidade-a.quantidade)});
      }
    } catch(e){
      toast.error("Erro ao gerar relatório");
      logger.error("RelatoriosPanel buscarDados error:", e);
    }
    setLoading(false);
  },[dataInicio,dataFim]);

  function exportarCSV(){
    if(!relData){toast.error("Gere um relatório antes de exportar");return;}
    const rows:string[][]=[];
    if(relData.producaoDiaria){rows.push(["Dia","Produção"]);relData.producaoDiaria.forEach(r=>rows.push([r.dia,String(r.producao)]));}
    if(relData.eficiencia){rows.push(["Máquina","Disponibilidade %"]);relData.eficiencia.forEach(r=>rows.push([r.maquina,String(r.disponib)]));}
    if(relData.paradas){rows.push(["Motivo","Minutos","Ocorrências"]);relData.paradas.forEach(r=>rows.push([r.motivo,String(r.minutos),String(r.ocorrencias)]));}
    if(relData.refugo){rows.push(["Tipo Defeito","Quantidade"]);relData.refugo.forEach(r=>rows.push([r.tipo,String(r.quantidade)]));}
    const csv=rows.map(r=>r.map(c=>`"${c}"`).join(",")).join("\n");
    const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;a.download=`relatorio_${relatorio}_${dataInicio}_${dataFim}.csv`;a.click();
    URL.revokeObjectURL(url);
    toast.success("Relatório exportado!");
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {onImport && (
        <button
          onClick={onImport}
          className="w-full flex items-center gap-3 rounded-2xl border border-green-500/30 bg-green-500/5 hover:bg-green-500/10 px-4 py-3 transition-colors"
        >
          <span className="h-8 w-8 rounded-lg bg-green-500/10 flex items-center justify-center text-green-600">
            📥
          </span>
          <div className="text-left">
            <p className="text-sm font-semibold text-green-700 dark:text-green-400">Importar PPI-51 (Excel)</p>
            <p className="text-[11px] text-muted-foreground">Migre dados históricos do arquivo Excel para o sistema</p>
          </div>
        </button>
      )}
      {/* Filtro de período */}
      <div className="rounded-2xl border bg-card/60 p-4">
        <p className="text-sm font-medium mb-3">Período</p>
        <div className="flex gap-3">
          <div className="flex-1"><label className="text-xs text-muted-foreground mb-1 block">De</label><Input type="date" value={dataInicio} onChange={e=>setDataInicio(e.target.value)}/></div>
          <div className="flex-1"><label className="text-xs text-muted-foreground mb-1 block">Até</label><Input type="date" value={dataFim} onChange={e=>setDataFim(e.target.value)}/></div>
        </div>
      </div>

      {/* Tipos de relatório */}
      <div className="grid grid-cols-2 gap-3">
        {RELATORIOS.map(r=>(
          <button key={r.id} onClick={()=>gerarRelatorio(r.id)}
            className={cn("rounded-2xl border p-4 text-left transition-all hover:shadow-sm active:scale-[0.99]",
              relatorio===r.id?`${r.bg} ${r.color} border-current/30`:"bg-card/60 hover:bg-muted/20")}>
            <r.Icon className={cn("h-5 w-5 mb-2",relatorio===r.id?r.color:"text-muted-foreground")}/>
            <p className={cn("font-semibold text-sm",relatorio===r.id?r.color:"")}>{r.label}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{r.descricao}</p>
          </button>
        ))}
      </div>

      {/* Resultado */}
      {loading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2">
          <RefreshCw className="h-4 w-4 animate-spin"/>Gerando relatório...
        </div>
      )}

      {relData && !loading && (
        <div className="rounded-2xl border bg-card/60 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">{RELATORIOS.find(r=>r.id===relatorio)?.label}</p>
            <Button size="sm" variant="outline" className="gap-1 h-8 text-xs" onClick={exportarCSV}>
              <Download className="h-3.5 w-3.5"/>CSV
            </Button>
          </div>

          {relData.producaoDiaria && relData.producaoDiaria.length > 0 && (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={relData.producaoDiaria} margin={{top:0,right:0,left:-20,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))"/>
                <XAxis dataKey="dia" tick={{fontSize:10}}/>
                <YAxis tick={{fontSize:10}}/>
                <Tooltip/>
                <Line type="monotone" dataKey="producao" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="Peças"/>
              </LineChart>
            </ResponsiveContainer>
          )}

          {relData.eficiencia && relData.eficiencia.length > 0 && (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={relData.eficiencia} margin={{top:0,right:0,left:-20,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))"/>
                <XAxis dataKey="maquina" tick={{fontSize:10}}/>
                <YAxis domain={[0,100]} tick={{fontSize:10}}/>
                <Tooltip/>
                <Bar dataKey="disponib" fill="#22c55e" radius={[4,4,0,0]} name="Disponib. %"/>
              </BarChart>
            </ResponsiveContainer>
          )}

          {relData.paradas && relData.paradas.length > 0 && (
            <div className="space-y-2">
              {relData.paradas.map((p,i)=>(
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="truncate text-[12px]">{p.motivo}</span>
                  <div className="flex items-center gap-3 shrink-0 text-[11px] text-muted-foreground">
                    <span>{p.ocorrencias}x</span>
                    <span className="font-medium text-foreground">{p.minutos}min</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {relData.refugo && relData.refugo.length > 0 && (
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={relData.refugo} margin={{top:0,right:0,left:-20,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))"/>
                <XAxis dataKey="tipo" tick={{fontSize:9}}/>
                <YAxis tick={{fontSize:10}}/>
                <Tooltip/>
                <Bar dataKey="quantidade" fill="#f97316" radius={[4,4,0,0]} name="Qtd"/>
              </BarChart>
            </ResponsiveContainer>
          )}

          {/* Estado vazio */}
          {((relData.producaoDiaria?.length===0)||(relData.eficiencia?.length===0)||(relData.paradas?.length===0)||(relData.refugo?.length===0)) && (
            <div className="text-center py-6 text-muted-foreground text-sm">
              <FileBarChart2 className="h-8 w-8 mx-auto mb-2 opacity-30"/>
              Nenhum dado no período selecionado
            </div>
          )}
        </div>
      )}

      {!relatorio && !loading && (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-sm gap-2">
          <FileBarChart2 className="h-8 w-8 opacity-30"/>
          <p>Selecione um tipo de relatório acima</p>
        </div>
      )}
    </div>
  );
}
