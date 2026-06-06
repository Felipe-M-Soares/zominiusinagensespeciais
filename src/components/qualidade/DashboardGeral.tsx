/**
 * DashboardGeral — Painel executivo unificado
 * KPIs de todos os módulos: Estoque, Comercial, Financeiro, Produção, Qualidade
 */
import { useState, useEffect, useCallback } from "react";
import { Package, ShoppingBag, TrendingUp, Factory, Shield, AlertTriangle, CheckCircle2, RefreshCw, Clock, Wrench, DollarSign, ArrowUpCircle, ArrowDownCircle, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

interface KPIs {
  estoque_intermediario_qty:number; estoque_expedicao_qty:number; estoque_critico:number;
  pedidos_pendentes:number; pedidos_prontos:number; pedidos_atrasados:number; faturamento_mes:number;
  contas_receber_abertas:number; contas_receber_vencidas:number; contas_pagar_abertas:number; contas_pagar_vencidas:number; contas_vencer_7d:number;
  oee_mes:number; apontamentos_hoje:number; pecas_produzidas_mes:number;
  devices_vencendo_anvisa:number; devices_anvisa_vencidos:number; certificados_vencendo:number; certificados_vencidos:number; ferramentas_alerta:number; recall_ativos:number;
}

function KpiCard({ icon:Icon, label, value, sub, color, alert }:{icon:React.ElementType;label:string;value:string;sub?:string;color:string;alert?:boolean}) {
  return (
    <div className={cn("rounded-2xl border p-4 space-y-2", alert?"border-red-500/30 bg-red-500/5":"border-border/40 bg-card")}>
      <div className="flex items-center justify-between">
        <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center bg-current/10")}>
          <Icon className={cn("h-4 w-4",color)} />
        </div>
        {alert&&<AlertTriangle className="h-4 w-4 text-red-500 animate-pulse"/>}
      </div>
      <div>
        <p className={cn("text-2xl font-black",alert?"text-red-600":color)}>{value}</p>
        <p className="text-[11px] text-muted-foreground font-medium">{label}</p>
        {sub&&<p className="text-[10px] text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

function Sec({icon:Icon,label,color}:{icon:React.ElementType;label:string;color:string}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className={cn("h-4 w-4",color)}/>
      <h3 className="text-sm font-semibold">{label}</h3>
      <div className="flex-1 h-px bg-border/40"/>
    </div>
  );
}

const BRL=(v:number)=>v.toLocaleString("pt-BR",{style:"currency",currency:"BRL",maximumFractionDigits:0});

export function DashboardGeral() {
  const [kpis,setKpis]=useState<KPIs|null>(null);
  const [loading,setLoading]=useState(true);
  const [updated,setUpdated]=useState<Date|null>(null);

  const load=useCallback(async()=>{
    setLoading(true);
    await supabase.rpc("atualizar_status_vencido");
    const{data}=await supabase.rpc("dashboard_gerencial");
    if(data){setKpis(data as KPIs);setUpdated(new Date());}
    setLoading(false);
  },[]);

  useEffect(()=>{load();},[load]);

  if(loading&&!kpis) return(
    <div className="flex items-center justify-center py-20 text-muted-foreground text-sm gap-2">
      <RefreshCw className="h-4 w-4 animate-spin"/>Carregando KPIs...
    </div>
  );
  if(!kpis) return null;

  const alerts=kpis.estoque_critico+kpis.pedidos_atrasados+kpis.contas_receber_vencidas+kpis.contas_pagar_vencidas+kpis.devices_anvisa_vencidos+kpis.certificados_vencidos+kpis.ferramentas_alerta+kpis.recall_ativos;

  return(
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-semibold">Dashboard Executivo</h2>
          <p className="text-[11px] text-muted-foreground">{updated?`Atualizado ${updated.toLocaleTimeString("pt-BR")}`:""}</p>
        </div>
        <div className="flex items-center gap-3">
          {alerts>0&&<span className="flex items-center gap-1.5 text-[12px] font-semibold text-red-600 bg-red-500/10 px-3 py-1 rounded-full"><AlertTriangle className="h-3.5 w-3.5"/>{alerts} alerta{alerts!==1?"s":""}</span>}
          <button onClick={load} disabled={loading} className="h-8 w-8 flex items-center justify-center rounded-lg border border-input hover:bg-muted/40 transition-colors">
            <RefreshCw className={cn("h-4 w-4 text-muted-foreground",loading&&"animate-spin")}/>
          </button>
        </div>
      </div>

      <div><Sec icon={Package} label="Estoque" color="text-blue-600"/>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <KpiCard icon={Package} label="Un. Intermediário" value={kpis.estoque_intermediario_qty.toLocaleString("pt-BR")} color="text-blue-600"/>
          <KpiCard icon={Package} label="Un. Expedição" value={kpis.estoque_expedicao_qty.toLocaleString("pt-BR")} color="text-green-600"/>
          <KpiCard icon={AlertTriangle} label="Estoque Crítico" value={String(kpis.estoque_critico)} alert={kpis.estoque_critico>0} color="text-red-600" sub={kpis.estoque_critico>0?"abaixo do mínimo":"tudo ok"}/>
        </div>
      </div>

      <div><Sec icon={ShoppingBag} label="Comercial" color="text-violet-600"/>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard icon={Clock} label="Pendentes" value={String(kpis.pedidos_pendentes)} color="text-violet-600"/>
          <KpiCard icon={CheckCircle2} label="Prontos" value={String(kpis.pedidos_prontos)} color="text-green-600"/>
          <KpiCard icon={AlertTriangle} label="Atrasados +7d" value={String(kpis.pedidos_atrasados)} alert={kpis.pedidos_atrasados>0} color="text-red-600"/>
          <KpiCard icon={TrendingUp} label="Faturamento Mês" value={BRL(kpis.faturamento_mes)} color="text-emerald-600"/>
        </div>
      </div>

      <div><Sec icon={DollarSign} label="Financeiro" color="text-emerald-600"/>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard icon={ArrowUpCircle} label="A Receber" value={BRL(kpis.contas_receber_abertas)} color="text-green-600"/>
          <KpiCard icon={AlertTriangle} label="Receber Vencido" value={BRL(kpis.contas_receber_vencidas)} alert={kpis.contas_receber_vencidas>0} color="text-red-600"/>
          <KpiCard icon={ArrowDownCircle} label="A Pagar" value={BRL(kpis.contas_pagar_abertas)} color="text-amber-600"/>
          <KpiCard icon={AlertTriangle} label="Pagar Vencido" value={BRL(kpis.contas_pagar_vencidas)} alert={kpis.contas_pagar_vencidas>0} color="text-red-600" sub={kpis.contas_vencer_7d>0?`${kpis.contas_vencer_7d} vencem em 7d`:undefined}/>
        </div>
      </div>

      <div><Sec icon={Factory} label="Produção" color="text-orange-600"/>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <KpiCard icon={Activity} label="OEE do Mês" value={kpis.oee_mes>0?`${kpis.oee_mes.toFixed(1)}%`:"—"} color={kpis.oee_mes>=85?"text-green-600":kpis.oee_mes>=65?"text-amber-600":"text-red-600"} alert={kpis.oee_mes>0&&kpis.oee_mes<65}/>
          <KpiCard icon={Factory} label="Apontamentos Hoje" value={String(kpis.apontamentos_hoje)} color="text-orange-600"/>
          <KpiCard icon={Package} label="Peças/Mês" value={kpis.pecas_produzidas_mes.toLocaleString("pt-BR")} color="text-blue-600"/>
        </div>
      </div>

      <div><Sec icon={Shield} label="Qualidade & ANVISA" color="text-teal-600"/>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <KpiCard icon={AlertTriangle} label="ANVISA Vencendo" value={String(kpis.devices_vencendo_anvisa)} color="text-amber-600" sub="90 dias" alert={kpis.devices_vencendo_anvisa>0}/>
          <KpiCard icon={AlertTriangle} label="ANVISA Vencidos" value={String(kpis.devices_anvisa_vencidos)} color="text-red-600" alert={kpis.devices_anvisa_vencidos>0}/>
          <KpiCard icon={Shield} label="Cert. Vencendo" value={String(kpis.certificados_vencendo)} color="text-amber-600" sub="90 dias" alert={kpis.certificados_vencendo>0}/>
          <KpiCard icon={AlertTriangle} label="Cert. Vencidos" value={String(kpis.certificados_vencidos)} color="text-red-600" alert={kpis.certificados_vencidos>0}/>
          <KpiCard icon={Wrench} label="Ferramentas Alerta" value={String(kpis.ferramentas_alerta)} color="text-orange-600" alert={kpis.ferramentas_alerta>0}/>
          <KpiCard icon={AlertTriangle} label="Recalls Ativos" value={String(kpis.recall_ativos)} color="text-red-600" alert={kpis.recall_ativos>0}/>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground text-center pb-2">KPIs em tempo real · Mês corrente</p>
    </div>
  );
}
