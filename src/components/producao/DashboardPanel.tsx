/**
 * DashboardPanel — OEE Real baseado nos dados do PPI-51
 * Disponibilidade × Performance × Qualidade por mês/máquina
 */

import { useState, useEffect, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Cell,
} from "recharts";
import { Activity, TrendingUp, AlertTriangle, Clock, Zap, Award, RefreshCw, Target, BarChart2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";

interface OEEData {
  hr_planejadas: number;
  hr_paradas: number;
  hr_disponiveis: number;
  disponibilidade: number;
  qtde_planejada: number;
  qtde_produzida: number;
  total_refugo: number;
  performance: number;
  qualidade: number;
  oee: number;
}

interface MaquinaData {
  maquina: string;
  hr_planejadas: number;
  qtde_produzida: number;
  qtde_planejada: number;
  total_apontamentos: number;
}

interface ParadaData { tipo: string; total_horas: number; ocorrencias: number; }
interface RefugoData { tipo: string; total: number; ocorrencias: number; }

interface ResumoMensal {
  mes: number; ano: number;
  geral: OEEData;
  por_maquina: MaquinaData[];
  paradas_por_tipo: ParadaData[];
  refugos_por_tipo: RefugoData[];
}

function GaugeOEE({ value, label, color }: { value: number; label: string; color: string }) {
  const angle = (value / 100) * 180 - 90;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-24 h-14 overflow-hidden">
        <svg viewBox="0 0 100 55" className="w-full h-full">
          <path d="M10 50 A 40 40 0 0 1 90 50" fill="none" stroke="hsl(var(--border))" strokeWidth="8" strokeLinecap="round" />
          <path
            d="M10 50 A 40 40 0 0 1 90 50"
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${value * 1.257} 200`}
          />
          <line
            x1="50" y1="50"
            x2={50 + 28 * Math.cos((angle - 90) * Math.PI / 180)}
            y2={50 + 28 * Math.sin((angle - 90) * Math.PI / 180)}
            stroke={color} strokeWidth="2" strokeLinecap="round"
          />
          <circle cx="50" cy="50" r="3" fill={color} />
        </svg>
      </div>
      <p className="text-xl font-black" style={{ color }}>{value.toFixed(1)}%</p>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
    </div>
  );
}

export function DashboardPanel() {
  const { t } = useTranslation();
  const now = new Date();
  const [mes, setMes]     = useState(now.getMonth() + 1);
  const [ano, setAno]     = useState(now.getFullYear());
  const [data, setData]   = useState<ResumoMensal | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: res, error } = await (supabase.rpc as any)("resumo_mensal_producao", {
      p_mes: mes, p_ano: ano,
    });
    if (!error && res) setData(res as ResumoMensal);
    setLoading(false);
  }, [mes, ano]);

  useEffect(() => { load(); }, [load]);

  const meses = t("dashboardPanel.months", { returnObjects: true }) as string[];

  const oeeColor = (v: number) =>
    v >= 85 ? "#22c55e" : v >= 65 ? "#f59e0b" : "#ef4444";

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Filtro período */}
      <div className="flex items-center gap-2 flex-wrap">
        <select value={mes} onChange={e => setMes(Number(e.target.value))}
          className="h-9 rounded-lg border border-input bg-background px-3 text-sm">
          {meses.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
        </select>
        <select value={ano} onChange={e => setAno(Number(e.target.value))}
          className="h-9 rounded-lg border border-input bg-background px-3 text-sm">
          {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <button onClick={load} disabled={loading}
          className="h-9 w-9 flex items-center justify-center rounded-lg border border-input hover:bg-muted/40 transition-colors">
          <RefreshCw className={cn("h-4 w-4 text-muted-foreground", loading && "animate-spin")} />
        </button>
        <span className="text-[11px] text-muted-foreground ml-1">
          {meses[mes-1]}/{ano}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
          <RefreshCw className="h-4 w-4 animate-spin" /> {t("dashboardPanel.calculatingOee")}
        </div>
      ) : !data || data.geral.hr_planejadas === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Activity className="h-10 w-10 mx-auto opacity-20 mb-2" />
          <p className="text-sm">{t("dashboardPanel.noDataPeriod")}</p>
          <p className="text-[11px]">{t("dashboardPanel.registerEntriesHint")}</p>
        </div>
      ) : (
        <>
          {/* OEE Gauges */}
          <div className="rounded-2xl border bg-card p-4">
            <div className="flex items-center gap-2 mb-4">
              <Target className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">OEE — {meses[mes-1]}/{ano}</h3>
              <span className={cn(
                "ml-auto text-2xl font-black",
                `text-[${oeeColor(data.geral.oee)}]`
              )} style={{ color: oeeColor(data.geral.oee) }}>
                {data.geral.oee.toFixed(1)}%
              </span>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <GaugeOEE value={data.geral.disponibilidade} label={t("dashboardPanel.gaugeAvailability")} color="#3b82f6" />
              <GaugeOEE value={data.geral.performance}     label={t("dashboardPanel.gaugePerformance")}     color="#8b5cf6" />
              <GaugeOEE value={data.geral.qualidade}       label={t("dashboardPanel.gaugeQuality")}       color="#22c55e" />
            </div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { icon: Clock,        label: t("dashboardPanel.hrPlanned"),  value: `${data.geral.hr_planejadas.toFixed(1)}h`,  color: "text-blue-600",   bg: "bg-blue-500/5 border-blue-500/20" },
              { icon: AlertTriangle,label: t("dashboardPanel.hrStopped"),     value: `${data.geral.hr_paradas.toFixed(1)}h`,    color: "text-red-600",    bg: "bg-red-500/5 border-red-500/20" },
              { icon: Zap,          label: t("dashboardPanel.hrAvailable"), value: `${data.geral.hr_disponiveis.toFixed(1)}h`, color: "text-green-600",  bg: "bg-green-500/5 border-green-500/20" },
              { icon: TrendingUp,   label: t("dashboardPanel.qtyPlanned"), value: data.geral.qtde_planejada.toLocaleString(t("dashboardPanel.localeCode")) + " " + t("dashboardPanel.pieceAbbrev"), color: "text-purple-600", bg: "bg-purple-500/5 border-purple-500/20" },
              { icon: Award,        label: t("dashboardPanel.qtyProduced"), value: data.geral.qtde_produzida.toLocaleString(t("dashboardPanel.localeCode")) + " " + t("dashboardPanel.pieceAbbrev"), color: "text-green-600",  bg: "bg-green-500/5 border-green-500/20" },
              { icon: AlertTriangle,label: t("dashboardPanel.totalScrap"),   value: data.geral.total_refugo.toLocaleString(t("dashboardPanel.localeCode")) + " " + t("dashboardPanel.pieceAbbrev"), color: "text-orange-600", bg: "bg-orange-500/5 border-orange-500/20" },
            ].map(k => (
              <div key={k.label} className={cn("rounded-2xl border p-3 space-y-1", k.bg)}>
                <div className="flex items-center gap-1.5">
                  <k.icon className={cn("h-3.5 w-3.5", k.color)} />
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{k.label}</p>
                </div>
                <p className={cn("text-lg font-bold", k.color)}>{k.value}</p>
              </div>
            ))}
          </div>

          {/* Performance por máquina */}
          {data.por_maquina && data.por_maquina.length > 0 && (
            <div className="rounded-2xl border bg-card p-4 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-primary" /> {t("dashboardPanel.performanceByMachine")}
              </h3>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={data.por_maquina} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="maquina" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                    formatter={(v: number, name: string) => [v.toLocaleString(t("dashboardPanel.localeCode")), name === "qtde_produzida" ? t("dashboardPanel.produced") : t("dashboardPanel.planned")]}
                  />
                  <Bar dataKey="qtde_planejada" fill="hsl(var(--muted))" radius={[4,4,0,0]} name={t("dashboardPanel.planned")} />
                  <Bar dataKey="qtde_produzida" radius={[4,4,0,0]} name={t("dashboardPanel.produced")}>
                    {data.por_maquina.map((m, i) => {
                      const eff = m.qtde_planejada > 0 ? m.qtde_produzida / m.qtde_planejada : 0;
                      return <Cell key={i} fill={eff >= 0.95 ? "#22c55e" : eff >= 0.80 ? "#f59e0b" : "#ef4444"} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Paradas por tipo */}
          {data.paradas_por_tipo && data.paradas_por_tipo.length > 0 && (
            <div className="rounded-2xl border bg-card p-4 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Clock className="h-4 w-4 text-red-500" /> {t("dashboardPanel.stopsByType")}
              </h3>
              <div className="space-y-2">
                {data.paradas_por_tipo.slice(0, 8).map((p, i) => {
                  const maxH = Math.max(...data.paradas_por_tipo.map(x => x.total_horas));
                  const pct  = maxH > 0 ? (p.total_horas / maxH) * 100 : 0;
                  return (
                    <div key={i} className="space-y-0.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-foreground truncate max-w-[60%]">{p.tipo}</span>
                        <span className="text-muted-foreground shrink-0">{p.total_horas.toFixed(2)}h · {p.ocorrencias}×</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-red-500/60 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Refugos por tipo */}
          {data.refugos_por_tipo && data.refugos_por_tipo.length > 0 && (
            <div className="rounded-2xl border bg-card p-4 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-orange-500" /> {t("dashboardPanel.scrapByType")}
              </h3>
              <div className="space-y-2">
                {data.refugos_por_tipo.map((r, i) => {
                  const maxQ = Math.max(...data.refugos_por_tipo.map(x => x.total));
                  const pct  = maxQ > 0 ? (r.total / maxQ) * 100 : 0;
                  return (
                    <div key={i} className="space-y-0.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-foreground">{r.tipo}</span>
                        <span className="text-muted-foreground">{r.total.toLocaleString(t("dashboardPanel.localeCode"))} {t("dashboardPanel.pieceAbbrev")}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-orange-500/60 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
