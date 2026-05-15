/**
 * DashboardPanel — Dashboard Industrial em Tempo Real
 * OEE, meta x realizado, eficiência por máquina, refugo, ranking, turnos
 */

import { useState, useEffect, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, RadialBarChart, RadialBar, Cell,
} from "recharts";
import {
  Activity, TrendingUp, AlertTriangle, Clock, Zap, Award,
  RefreshCw, ChevronUp, ChevronDown, Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Mock data (substituir por Supabase) ───────────────────────────────────────

function gerarDadosTurno() {
  return [
    { turno: "1º Turno", meta: 1200, realizado: Math.floor(Math.random() * 300 + 900), eficiencia: 0 },
    { turno: "2º Turno", meta: 1100, realizado: Math.floor(Math.random() * 300 + 800), eficiencia: 0 },
    { turno: "3º Turno", meta: 900,  realizado: Math.floor(Math.random() * 250 + 600), eficiencia: 0 },
  ].map(t => ({ ...t, eficiencia: Math.round((t.realizado / t.meta) * 100) }));
}

function gerarRankingMaquinas() {
  return [
    { maquina: "CNC-01", oee: Math.round(Math.random() * 20 + 72), status: "ok" },
    { maquina: "CNC-02", oee: Math.round(Math.random() * 15 + 65), status: "ok" },
    { maquina: "TORNO-01", oee: Math.round(Math.random() * 10 + 55), status: "alerta" },
    { maquina: "FRESA-01", oee: Math.round(Math.random() * 20 + 70), status: "ok" },
    { maquina: "TORNO-02", oee: Math.round(Math.random() * 10 + 40), status: "parado" },
  ].sort((a, b) => b.oee - a.oee);
}

const producaoHora = Array.from({ length: 8 }, (_, i) => ({
  hora: `${(6 + i).toString().padStart(2, "0")}:00`,
  producao: Math.floor(Math.random() * 80 + 100),
  meta: 150,
}));

// ── KPI Card ──────────────────────────────────────────────────────────────────

interface KpiProps {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
  bg: string;
  border: string;
  trend?: "up" | "down" | "neutral";
}

function KpiCard({ icon: Icon, label, value, sub, color, bg, border, trend }: KpiProps) {
  const TrendIcon = trend === "up" ? ChevronUp : trend === "down" ? ChevronDown : Minus;
  const trendColor = trend === "up" ? "text-green-500" : trend === "down" ? "text-red-500" : "text-muted-foreground";
  return (
    <div className={cn("rounded-2xl border p-4 flex items-start gap-3", bg, border)}>
      <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center shrink-0", bg)}>
        <Icon className={cn("h-5 w-5", color)} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
        <div className="flex items-end gap-1">
          <p className={cn("text-2xl font-bold tabular-nums", color)}>{value}</p>
          {trend && <TrendIcon className={cn("h-4 w-4 mb-1", trendColor)} />}
        </div>
        {sub && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── OEE Gauge ─────────────────────────────────────────────────────────────────

function OeeGauge({ value }: { value: number }) {
  const color = value >= 75 ? "#22c55e" : value >= 55 ? "#f59e0b" : "#ef4444";
  const data = [{ value, fill: color }, { value: 100 - value, fill: "transparent" }];
  return (
    <div className="flex flex-col items-center">
      <div className="relative h-32 w-32">
        <RadialBarChart
          width={128} height={128}
          innerRadius={44} outerRadius={60}
          data={data} startAngle={90} endAngle={-270}
        >
          <RadialBar dataKey="value" cornerRadius={6} background={{ fill: "var(--muted)" }}>
            {data.map((entry, idx) => <Cell key={idx} fill={entry.fill} />)}
          </RadialBar>
        </RadialBarChart>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tabular-nums" style={{ color }}>{value}%</span>
          <span className="text-[9px] text-muted-foreground font-medium uppercase tracking-wide">OEE</span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        {value >= 75 ? "✅ Ótimo" : value >= 55 ? "⚠️ Moderado" : "🔴 Crítico"}
      </p>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function DashboardPanel() {
  const [turnos, setTurnos] = useState(gerarDadosTurno());
  const [ranking, setRanking] = useState(gerarRankingMaquinas());
  const [oee] = useState(Math.round(Math.random() * 25 + 60));
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [tempoParado] = useState(Math.floor(Math.random() * 60 + 10));
  const [totalRefugo] = useState(Math.floor(Math.random() * 50 + 15));
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setTurnos(gerarDadosTurno());
      setRanking(gerarRankingMaquinas());
      setLastUpdate(new Date());
    }, 15000);
    return () => clearInterval(intervalRef.current);
  }, []);

  const totalMeta = turnos.reduce((s, t) => s + t.meta, 0);
  const totalRealizado = turnos.reduce((s, t) => s + t.realizado, 0);
  const efGeral = Math.round((totalRealizado / totalMeta) * 100);

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-sm">Dashboard Industrial</h2>
          <p className="text-[11px] text-muted-foreground">
            Atualizado às {lastUpdate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </p>
        </div>
        <button
          onClick={() => { setTurnos(gerarDadosTurno()); setRanking(gerarRankingMaquinas()); setLastUpdate(new Date()); }}
          className="h-8 w-8 rounded-xl flex items-center justify-center hover:bg-muted/40 transition-colors"
          title="Atualizar dados"
        >
          <RefreshCw className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          icon={TrendingUp} label="Produção Total" value={totalRealizado.toLocaleString("pt-BR")}
          sub={`Meta: ${totalMeta.toLocaleString("pt-BR")}`}
          color="text-green-600 dark:text-green-400" bg="bg-green-500/10" border="border-green-500/20"
          trend={totalRealizado >= totalMeta ? "up" : "down"}
        />
        <KpiCard
          icon={Zap} label="Eficiência Geral" value={`${efGeral}%`}
          sub="Meta: 85%"
          color="text-blue-600 dark:text-blue-400" bg="bg-blue-500/10" border="border-blue-500/20"
          trend={efGeral >= 85 ? "up" : "neutral"}
        />
        <KpiCard
          icon={Clock} label="Tempo Parado" value={`${tempoParado}min`}
          sub="Último turno"
          color="text-red-600 dark:text-red-400" bg="bg-red-500/10" border="border-red-500/20"
          trend="down"
        />
        <KpiCard
          icon={AlertTriangle} label="Refugo" value={`${totalRefugo}pç`}
          sub={`${((totalRefugo / totalRealizado) * 100).toFixed(1)}% do total`}
          color="text-amber-600 dark:text-amber-400" bg="bg-amber-500/10" border="border-amber-500/20"
          trend={totalRefugo < 30 ? "up" : "down"}
        />
      </div>

      {/* OEE + Ranking */}
      <div className="grid gap-3 sm:grid-cols-2">
        {/* OEE */}
        <div className="rounded-2xl border bg-card/60 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">OEE Geral</h3>
          </div>
          <div className="flex justify-center">
            <OeeGauge value={oee} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Disponib.", value: `${Math.round(oee * 1.1)}%`, color: "text-green-500" },
              { label: "Desempenho", value: `${Math.round(oee * 0.95)}%`, color: "text-blue-500" },
              { label: "Qualidade", value: `${Math.round(oee * 1.05)}%`, color: "text-amber-500" },
            ].map(item => (
              <div key={item.label} className="rounded-xl bg-muted/30 p-2">
                <p className={cn("text-sm font-bold tabular-nums", item.color)}>{item.value}</p>
                <p className="text-[10px] text-muted-foreground">{item.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Ranking de Máquinas */}
        <div className="rounded-2xl border bg-card/60 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Award className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold">Ranking de Máquinas (OEE)</h3>
          </div>
          <div className="space-y-2">
            {ranking.map((m, idx) => (
              <div key={m.maquina} className="flex items-center gap-3">
                <span className={cn(
                  "text-[10px] font-bold w-5 text-center",
                  idx === 0 ? "text-amber-500" : idx === 1 ? "text-slate-400" : idx === 2 ? "text-orange-600" : "text-muted-foreground"
                )}>
                  {idx + 1}º
                </span>
                <span className="text-xs font-medium w-20 truncate">{m.maquina}</span>
                <div className="flex-1 h-2 rounded-full bg-muted/40 overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all duration-500",
                      m.status === "ok" ? "bg-green-500" : m.status === "alerta" ? "bg-amber-500" : "bg-red-500"
                    )}
                    style={{ width: `${m.oee}%` }}
                  />
                </div>
                <span className={cn("text-xs font-bold tabular-nums w-10 text-right",
                  m.status === "ok" ? "text-green-500" : m.status === "alerta" ? "text-amber-500" : "text-red-500"
                )}>
                  {m.oee}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Produção por Turno */}
      <div className="rounded-2xl border bg-card/60 p-4">
        <h3 className="text-sm font-semibold mb-3">Meta × Realizado por Turno</h3>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={turnos} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
              <XAxis dataKey="turno" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }}
              />
              <Bar dataKey="meta" fill="var(--muted)" radius={[4, 4, 0, 0]} name="Meta" />
              <Bar dataKey="realizado" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Realizado" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Produção por Hora */}
      <div className="rounded-2xl border bg-card/60 p-4">
        <h3 className="text-sm font-semibold mb-3">Produção por Hora (Turno Atual)</h3>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={producaoHora} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
              <XAxis dataKey="hora" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip
                contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }}
              />
              <Line type="monotone" dataKey="meta" stroke="#94a3b8" strokeDasharray="5 5" dot={false} name="Meta/h" />
              <Line type="monotone" dataKey="producao" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} name="Produção" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
