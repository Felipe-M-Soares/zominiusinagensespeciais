/**
 * DashboardPanel — Dashboard Industrial em Tempo Real
 * ✓ Dados reais via Supabase (agrega apontamentos, paradas, refugos, máquinas)
 * ✓ Fallback offline com IndexedDB
 * ✓ Auto-refresh a cada 60 segundos
 */

import { useState, useEffect, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import { Activity, TrendingUp, AlertTriangle, Clock, Zap, Award, RefreshCw, WifiOff } from "lucide-react";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { dbGetAll } from "@/lib/offlineDB";

interface KpiProps {
  icon: React.ElementType; label: string; value: string | number;
  sub?: string; color: string; bg: string;
}

function KpiCard({ icon: Icon, label, value, sub, color, bg }: KpiProps) {
  return (
    <div className={cn("rounded-xl border p-4 space-y-2", bg)}>
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4", color)} />
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
      </div>
      <p className={cn("text-2xl font-bold", color)}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

interface DashData {
  emAndamento: number;
  totalHoje: number;
  paradasAtivas: number;
  refugosHoje: number;
  maquinasOperando: number;
  maquinasTotal: number;
  turnoData: { turno: string; realizado: number }[];
  paradasPorHora: { hora: string; minutos: number }[];
}

async function fetchDashData(): Promise<DashData> {
  const hoje = new Date();
  hoje.setHours(0,0,0,0);
  const hojeStr = hoje.toISOString();

  if (navigator.onLine) {
    try {
      const [
        { data: apontamentos },
        { data: paradas },
        { data: refugos },
        { data: maquinas },
      ] = await Promise.all([
        supabase.from("apontamentos_producao").select("status,turno,quantidade,created_at").gte("created_at",hojeStr),
        supabase.from("paradas_producao").select("fim,inicio,duracao_min").gte("created_at",hojeStr),
        supabase.from("refugos_producao").select("quantidade").gte("created_at",hojeStr),
        supabase.from("maquinas_producao").select("status"),
      ]);

      const ap = apontamentos || [];
      const par = paradas || [];
      const ref = refugos || [];
      const maq = maquinas || [];

      const emAndamento = ap.filter((a: {status:string}) => a.status === "em_andamento").length;
      const totalHoje = ap.reduce((s: number, a: {quantidade:number}) => s + (a.quantidade||0), 0);
      const paradasAtivas = par.filter((p: {fim:string|null}) => !p.fim).length;
      const refugosHoje = ref.reduce((s: number, r: {quantidade:number}) => s + (r.quantidade||0), 0);
      const maquinasOperando = maq.filter((m: {status:string}) => m.status === "operando").length;
      const maquinasTotal = maq.length;

      // Produção por turno hoje
      const turnoMap: Record<string,number> = {};
      ap.forEach((a: {turno:string;quantidade:number}) => {
        turnoMap[a.turno] = (turnoMap[a.turno]||0) + (a.quantidade||0);
      });
      const turnoData = ["1º Turno","2º Turno","3º Turno"].map(t => ({
        turno: t.replace("º ","T"), realizado: turnoMap[t]||0,
      }));

      // Paradas por hora (últimas 8h)
      const horasMap: Record<string,number> = {};
      par.forEach((p: {inicio:string;duracao_min:number|null}) => {
        const h = new Date(p.inicio).getHours();
        const label = `${h.toString().padStart(2,"0")}:00`;
        horasMap[label] = (horasMap[label]||0) + (p.duracao_min||0);
      });
      const paradasPorHora = Object.entries(horasMap).slice(-8).map(([hora,minutos])=>({hora,minutos}));

      return { emAndamento, totalHoje, paradasAtivas, refugosHoje, maquinasOperando, maquinasTotal, turnoData, paradasPorHora };
    } catch (e) {
      logger.error("DashboardPanel fetch error:", e);
    }
  }

  // Offline fallback
  const [ap, par, ref, maq] = await Promise.all([
    dbGetAll<{status:string;turno:string;quantidade:number}>("apontamentos"),
    dbGetAll<{fim?:string}>("paradas"),
    dbGetAll<{quantidade:number}>("refugos"),
    dbGetAll<{status:string}>("maquinas"),
  ]);

  return {
    emAndamento: ap.filter(a=>a.status==="em_andamento").length,
    totalHoje: ap.reduce((s,a)=>s+(a.quantidade||0),0),
    paradasAtivas: par.filter(p=>!p.fim).length,
    refugosHoje: ref.reduce((s,r)=>s+(r.quantidade||0),0),
    maquinasOperando: maq.filter(m=>m.status==="operando").length,
    maquinasTotal: maq.length,
    turnoData: ["1º Turno","2º Turno","3º Turno"].map(t=>({turno:t.replace("º ","T"),realizado:0})),
    paradasPorHora: [],
  };
}

export function DashboardPanel() {
  const [data, setData] = useState<DashData|null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date|null>(null);
  const isOnline = navigator.onLine;

  const load = useCallback(async () => {
    setLoading(true);
    const d = await fetchDashData();
    setData(d);
    setLastUpdate(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
        <RefreshCw className="h-4 w-4 animate-spin"/>Carregando dashboard...
      </div>
    );
  }

  const d = data!;
  const oeeSimulado = d.maquinasTotal > 0 ? Math.round((d.maquinasOperando/d.maquinasTotal)*100) : 0;

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-sm">Dashboard Industrial</h2>
          {lastUpdate && <p className="text-[11px] text-muted-foreground">Atualizado às {lastUpdate.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</p>}
        </div>
        <div className="flex items-center gap-2">
          {!isOnline && <div className="flex items-center gap-1 text-[11px] text-amber-600"><WifiOff className="h-3 w-3"/>Offline</div>}
          <button onClick={load} disabled={loading} className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-muted/40 transition-colors">
            <RefreshCw className={cn("h-4 w-4",loading&&"animate-spin")}/>
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3">
        <KpiCard icon={Activity} label="Apontamentos ativos" value={d.emAndamento} color="text-green-600 dark:text-green-400" bg="bg-green-500/5 border-green-500/20"/>
        <KpiCard icon={TrendingUp} label="Peças hoje" value={d.totalHoje.toLocaleString("pt-BR")} color="text-blue-600 dark:text-blue-400" bg="bg-blue-500/5 border-blue-500/20"/>
        <KpiCard icon={AlertTriangle} label="Paradas ativas" value={d.paradasAtivas} color="text-red-600 dark:text-red-400" bg="bg-red-500/5 border-red-500/20"/>
        <KpiCard icon={Zap} label="Refugos hoje" value={d.refugosHoje} color="text-orange-600 dark:text-orange-400" bg="bg-orange-500/5 border-orange-500/20"/>
      </div>

      {/* Disponibilidade máquinas */}
      <div className="rounded-xl border bg-card/60 p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium">Disponibilidade de Máquinas</p>
          <span className={cn("text-sm font-bold",oeeSimulado>=80?"text-green-600":oeeSimulado>=60?"text-amber-600":"text-red-600")}>{oeeSimulado}%</span>
        </div>
        <div className="h-3 rounded-full bg-muted overflow-hidden">
          <div className={cn("h-full rounded-full transition-all",oeeSimulado>=80?"bg-green-500":oeeSimulado>=60?"bg-amber-500":"bg-red-500")} style={{width:`${oeeSimulado}%`}}/>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">{d.maquinasOperando} de {d.maquinasTotal} máquinas operando</p>
      </div>

      {/* Produção por turno */}
      {d.turnoData.some(t=>t.realizado>0) && (
        <div className="rounded-xl border bg-card/60 p-4">
          <p className="text-sm font-medium mb-3">Produção por Turno (hoje)</p>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={d.turnoData} margin={{top:0,right:0,left:-20,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))"/>
              <XAxis dataKey="turno" tick={{fontSize:11}}/>
              <YAxis tick={{fontSize:10}}/>
              <Tooltip/>
              <Bar dataKey="realizado" fill="hsl(var(--primary))" radius={[4,4,0,0]} name="Realizado"/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Paradas por hora */}
      {d.paradasPorHora.length > 0 && (
        <div className="rounded-xl border bg-card/60 p-4">
          <p className="text-sm font-medium mb-3">Minutos parados por hora (hoje)</p>
          <ResponsiveContainer width="100%" height={100}>
            <LineChart data={d.paradasPorHora} margin={{top:0,right:0,left:-20,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))"/>
              <XAxis dataKey="hora" tick={{fontSize:10}}/>
              <YAxis tick={{fontSize:10}}/>
              <Tooltip/>
              <Line type="monotone" dataKey="minutos" stroke="#ef4444" strokeWidth={2} dot={false} name="Min parados"/>
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Estado vazio */}
      {d.emAndamento===0 && d.totalHoje===0 && d.maquinasTotal===0 && (
        <div className="rounded-xl border bg-muted/30 p-6 text-center">
          <Award className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40"/>
          <p className="text-sm text-muted-foreground">Nenhum dado ainda</p>
          <p className="text-[11px] text-muted-foreground mt-1">Cadastre máquinas e registre apontamentos para ver o dashboard em tempo real</p>
        </div>
      )}
    </div>
  );
}
