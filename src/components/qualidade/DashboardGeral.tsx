/**
 * DashboardGeral — Painel executivo unificado
 * KPIs de todos os módulos: Estoque, Comercial, Financeiro, Produção, Qualidade
 *
 * v2: além dos KPIs numéricos (mantidos como estavam — nenhum dado removido),
 * acrescenta uma camada visual de gráficos (recharts, já usado no resto do
 * app) para leitura executiva mais rápida: tendência de faturamento e OEE
 * nos últimos 6 meses, distribuição do estoque por fase, Receber×Pagar e
 * um raio-x dos alertas por área. As séries de 6 meses são calculadas no
 * cliente a partir das mesmas tabelas/RPCs já existentes (pedidos_comerciais
 * + pedido_itens, e a RPC calcular_oee chamada uma vez por mês) — nenhuma
 * tabela, coluna ou RPC nova.
 */
import { useState, useEffect, useCallback } from "react";
import {
  Package, ShoppingBag, TrendingUp, TrendingDown, Factory, Shield, AlertTriangle,
  CheckCircle2, RefreshCw, Clock, Wrench, DollarSign, ArrowUpCircle, ArrowDownCircle,
  Activity, HeartPulse, HardDrive, Database, LayoutDashboard, Sparkles,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, LineChart, Line, ReferenceLine, Legend,
} from "recharts";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/format";

interface SaudeSistema {
  ok: boolean;
  last_backup: string | null;
  backup_schedule: string | null;
  last_apontamento: string | null;
  audit_log_count: number;
  audit_log_oldest: string | null;
  cron_jobs: { jobname: string; schedule: string; active: boolean }[];
  checked_at: string;
}

interface KPIs {
  estoque_intermediario_qty:number; estoque_expedicao_qty:number; estoque_critico:number;
  pedidos_pendentes:number; pedidos_prontos:number; pedidos_atrasados:number; faturamento_mes:number;
  contas_receber_abertas:number; contas_receber_vencidas:number; contas_pagar_abertas:number; contas_pagar_vencidas:number; contas_vencer_7d:number;
  oee_mes:number; apontamentos_hoje:number; pecas_produzidas_mes:number;
  devices_vencendo_anvisa:number; devices_anvisa_vencidos:number; certificados_vencendo:number; certificados_vencidos:number; ferramentas_alerta:number; recall_ativos:number;
}

interface MesSerie { mes: string; valor: number; }

const CHART_TOOLTIP_STYLE = { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 12, boxShadow: "0 4px 16px -4px rgba(0,0,0,0.15)" };
const AXIS_TICK = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };

function KpiCard({ icon:Icon, label, value, sub, color, alert }:{icon:React.ElementType;label:string;value:string;sub?:string;color:string;alert?:boolean}) {
  return (
    <div className={cn(
      "rounded-2xl border p-4 space-y-2 transition-shadow hover:shadow-md",
      alert ? "border-red-500/30 bg-red-500/5" : "border-border/40 bg-card"
    )}>
      <div className="flex items-center justify-between">
        <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center bg-current/10")}>
          <Icon className={cn("h-4 w-4",color)} />
        </div>
        {alert&&<AlertTriangle className="h-4 w-4 text-red-500 animate-pulse"/>}
      </div>
      <div>
        <p className={cn("text-2xl font-black tabular-nums",alert?"text-red-600":color)}>{value}</p>
        <p className="text-[11px] text-muted-foreground font-medium">{label}</p>
        {sub&&<p className="text-[10px] text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

// ── Card de estatística "hero" — números grandes no topo do dashboard ────────
function HeroStat({ icon:Icon, label, value, accent, trend }:{icon:React.ElementType;label:string;value:string;accent:string;trend?:{ up:boolean; label:string }}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border/30 bg-card p-4 sm:p-5">
      <div className={cn("absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-[0.07]", accent)} style={{ background: "currentColor" }} />
      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
          <p className={cn("text-2xl sm:text-[28px] font-black tabular-nums mt-1 truncate", accent)}>{value}</p>
          {trend && (
            <p className={cn("text-[10px] font-semibold flex items-center gap-1 mt-1", trend.up ? "text-emerald-600" : "text-red-600")}>
              {trend.up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {trend.label}
            </p>
          )}
        </div>
        <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center shrink-0 bg-current/10", accent)}>
          <Icon className={cn("h-5 w-5", accent)} />
        </div>
      </div>
    </div>
  );
}

// ── Card genérico para envolver cada gráfico com título + descrição ─────────
function ChartCard({ icon:Icon, title, sub, color, children }:{icon:React.ElementType;title:string;sub?:string;color:string;children:React.ReactNode}) {
  return (
    <div className="rounded-2xl border border-border/40 bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className={cn("h-7 w-7 rounded-lg flex items-center justify-center bg-current/10", color)}>
          <Icon className={cn("h-3.5 w-3.5", color)} />
        </div>
        <div>
          <h4 className="text-[12.5px] font-semibold leading-tight">{title}</h4>
          {sub && <p className="text-[10px] text-muted-foreground leading-tight">{sub}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function Sec({icon:Icon,label,color}:{icon:React.ElementType;label:string;color:string}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className={cn("h-1.5 w-1.5 rounded-full", color)} style={{ background: "currentColor" }} />
      <Icon className={cn("h-4 w-4",color)}/>
      <h3 className="text-sm font-semibold">{label}</h3>
      <div className="flex-1 h-px bg-border/40"/>
    </div>
  );
}

const BRL=(v:number)=>v.toLocaleString("pt-BR",{style:"currency",currency:"BRL",maximumFractionDigits:0});

/** Formata "há quanto tempo" de forma legível, para a seção de saúde do sistema. */
function tempoRelativo(iso: string | null): string {
  if (!iso) return "nunca";
  const diffMs = Date.now() - new Date(iso).getTime();
  const horas = diffMs / (1000 * 60 * 60);
  if (horas < 1) return "há poucos minutos";
  if (horas < 24) return `há ${Math.floor(horas)}h`;
  const dias = Math.floor(horas / 24);
  return `há ${dias} dia${dias > 1 ? "s" : ""}`;
}

const MESES_ABREV = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

/** Últimos N meses (mais antigo → mais recente), cada um com início/fim do período. */
function ultimosMeses(n: number): { ini: Date; fim: Date; label: string }[] {
  const out: { ini: Date; fim: Date; label: string }[] = [];
  const hoje = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const ref = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    const ini = new Date(ref.getFullYear(), ref.getMonth(), 1);
    const fimMes = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
    const fim = fimMes > hoje ? hoje : fimMes;
    out.push({ ini, fim, label: `${MESES_ABREV[ref.getMonth()]}/${String(ref.getFullYear()).slice(2)}` });
  }
  return out;
}
function toISODate(d: Date): string { return d.toISOString().split("T")[0]; }

export function DashboardGeral() {
  const [kpis,setKpis]=useState<KPIs|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [updated,setUpdated]=useState<Date|null>(null);
  const [saude, setSaude] = useState<SaudeSistema | null>(null);

  const [faturamentoSerie, setFaturamentoSerie] = useState<MesSerie[]>([]);
  const [oeeSerie, setOeeSerie] = useState<MesSerie[]>([]);
  const [seriesLoading, setSeriesLoading] = useState(true);

  const loadSaude = useCallback(async () => {
    // Evita spam de 404 no console em ambientes onde a migration
    // obter_saude_sistema ainda não foi aplicada.
    // Para ativar o card de saúde, defina VITE_ENABLE_SYSTEM_HEALTH=true.
    if (import.meta.env.VITE_ENABLE_SYSTEM_HEALTH !== "true") {
      setSaude(null);
      return;
    }

    const { data, error } = await supabase.rpc("obter_saude_sistema");
    if (error) {
      setSaude(null);
      return;
    }
    const s = data as SaudeSistema | null;
    setSaude(s?.ok ? s : null);
  }, []);

  // ── Séries de 6 meses para os gráficos de tendência ──────────────────────
  // Faturamento: soma de pedido_itens (qtd × valor unit.) + frete, de pedidos
  // faturado/enviado, agrupado por mês do nf_criada_em — mesma regra usada
  // pela RPC dashboard_gerencial para o mês corrente, só que aqui buscamos
  // os pedidos dos últimos 6 meses de uma vez e agrupamos no cliente.
  const loadSeries = useCallback(async () => {
    setSeriesLoading(true);
    const periodo = ultimosMeses(6);
    const inicioTudo = toISODate(periodo[0].ini);

    try {
      const { data: pedidos } = await supabase
        .from("pedidos_comerciais")
        .select("nf_criada_em, frete, pedido_itens(quantidade, valor_unitario)")
        .in("status", ["faturado", "enviado"])
        .gte("nf_criada_em", inicioTudo);

      const faturamentoPorMes = new Map<string, number>(periodo.map(p => [p.label, 0]));
      for (const p of (pedidos ?? []) as Record<string, unknown>[]) {
        const nfData = p.nf_criada_em as string | null;
        if (!nfData) continue;
        const d = new Date(nfData);
        const label = `${MESES_ABREV[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;
        if (!faturamentoPorMes.has(label)) continue;
        const itens = (p.pedido_itens as { quantidade:number; valor_unitario:number }[]) ?? [];
        const totalItens = itens.reduce((s, i) => s + (i.quantidade||0) * (i.valor_unitario||0), 0);
        faturamentoPorMes.set(label, (faturamentoPorMes.get(label) ?? 0) + totalItens + (Number(p.frete)||0));
      }
      setFaturamentoSerie(periodo.map(p => ({ mes: p.label, valor: faturamentoPorMes.get(p.label) ?? 0 })));
    } catch {
      setFaturamentoSerie([]);
    }

    try {
      const oeeResultados = await Promise.all(periodo.map(p =>
        (supabase.rpc as any)("calcular_oee", { p_data_ini: toISODate(p.ini), p_data_fim: toISODate(p.fim), p_maquina: null })
      ));
      setOeeSerie(periodo.map((p, i) => ({ mes: p.label, valor: (oeeResultados[i]?.data as { oee?: number } | null)?.oee ?? 0 })));
    } catch {
      setOeeSerie([]);
    }

    setSeriesLoading(false);
  }, []);

  const load=useCallback(async()=>{
    setLoading(true);
    setError(null);
    try { await (supabase.rpc as any)("atualizar_status_vencido"); } catch { /* silencioso */ }
    try {
      const { data, error: rpcErr } = await (supabase.rpc as any)("dashboard_gerencial");
      if (rpcErr) {
        setError(rpcErr.message ?? JSON.stringify(rpcErr));
      } else if (data) {
        // Preenche campos ausentes com 0 para não quebrar a UI
        const safe: KPIs = {
          estoque_intermediario_qty: 0, estoque_expedicao_qty: 0, estoque_critico: 0,
          pedidos_pendentes: 0, pedidos_prontos: 0, pedidos_atrasados: 0, faturamento_mes: 0,
          contas_receber_abertas: 0, contas_receber_vencidas: 0,
          contas_pagar_abertas: 0, contas_pagar_vencidas: 0, contas_vencer_7d: 0,
          oee_mes: 0, apontamentos_hoje: 0, pecas_produzidas_mes: 0,
          devices_vencendo_anvisa: 0, devices_anvisa_vencidos: 0,
          certificados_vencendo: 0, certificados_vencidos: 0,
          ferramentas_alerta: 0, recall_ativos: 0,
          ...data,
        };
        setKpis(safe);
        setUpdated(new Date());
      }
    } catch (e: any) {
      setError(e?.message ?? "Erro desconhecido ao carregar KPIs");
    }
    setLoading(false);
  },[]);

  useEffect(()=>{load(); loadSaude(); loadSeries();},[load, loadSaude, loadSeries]);

  // Auto-refresh a cada 5 minutos
  useEffect(()=>{
    const id = setInterval(() => { load(); loadSaude(); loadSeries(); }, 5 * 60 * 1000);
    return () => clearInterval(id);
  },[load, loadSaude, loadSeries]);

  if(loading&&!kpis) return(
    <div className="flex items-center justify-center py-20 text-muted-foreground text-sm gap-2">
      <RefreshCw className="h-4 w-4 animate-spin"/>Carregando KPIs...
    </div>
  );
  if(error) return(
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center px-4">
      <AlertTriangle className="h-10 w-10 text-amber-500 opacity-60"/>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">Dashboard indisponível</p>
        <p className="text-[11px] text-muted-foreground max-w-sm">
          A função <code className="bg-muted px-1 rounded font-mono">dashboard_gerencial</code> retornou um erro.
          Confirme se as migrations do banco estão atualizadas (<code className="bg-muted px-1 rounded font-mono">supabase db push</code>) e veja o detalhe do erro abaixo.
        </p>
      </div>
      <div className="w-full max-w-sm rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-left">
        <p className="text-[10px] font-semibold text-destructive/70 uppercase tracking-wide mb-1">Erro do banco</p>
        <p className="text-[11px] text-destructive font-mono break-all">{error}</p>
      </div>
      <button onClick={load} className="h-8 px-4 rounded-lg bg-muted hover:bg-muted/80 text-sm transition-colors">
        Tentar novamente
      </button>
    </div>
  );
  if(!kpis) return null;

  const alerts=kpis.estoque_critico+kpis.pedidos_atrasados+kpis.contas_receber_vencidas+kpis.contas_pagar_vencidas+kpis.devices_anvisa_vencidos+kpis.certificados_vencidos+kpis.ferramentas_alerta+kpis.recall_ativos;

  // Tendência de faturamento: mês corrente vs. mês anterior (para a seta no hero)
  const faturamentoTrend = (() => {
    if (faturamentoSerie.length < 2) return undefined;
    const atual = faturamentoSerie[faturamentoSerie.length - 1].valor;
    const anterior = faturamentoSerie[faturamentoSerie.length - 2].valor;
    if (anterior <= 0) return undefined;
    const pct = ((atual - anterior) / anterior) * 100;
    return { up: pct >= 0, label: `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}% vs. mês anterior` };
  })();

  const estoqueDist = [
    { name: "Intermediário", value: kpis.estoque_intermediario_qty, color: "#3b82f6" },
    { name: "Expedição",     value: kpis.estoque_expedicao_qty,     color: "#22c55e" },
  ].filter(d => d.value > 0);

  const receberPagarData = [
    { grupo: "A Receber", Aberto: kpis.contas_receber_abertas, Vencido: kpis.contas_receber_vencidas },
    { grupo: "A Pagar",   Aberto: kpis.contas_pagar_abertas,   Vencido: kpis.contas_pagar_vencidas },
  ];

  const alertasPorArea = [
    { area: "Estoque crítico", valor: kpis.estoque_critico },
    { area: "Pedidos atrasados", valor: kpis.pedidos_atrasados },
    { area: "ANVISA vencidos", valor: kpis.devices_anvisa_vencidos },
    { area: "Certificados vencidos", valor: kpis.certificados_vencidos },
    { area: "Ferramentas alerta", valor: kpis.ferramentas_alerta },
    { area: "Recalls ativos", valor: kpis.recall_ativos },
  ].filter(a => a.valor > 0).sort((a,b) => b.valor - a.valor);

  const oeeCor = kpis.oee_mes>=85?"#22c55e":kpis.oee_mes>=65?"#f59e0b":"#ef4444";

  return(
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header executivo */}
      <div className="relative overflow-hidden rounded-2xl border border-border/30 bg-gradient-to-br from-primary/[0.06] via-card to-card p-4 sm:p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <LayoutDashboard className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-[15px] font-bold leading-tight flex items-center gap-1.5">
                Dashboard Executivo <Sparkles className="h-3.5 w-3.5 text-primary/60" />
              </h2>
              <p className="text-[11px] text-muted-foreground">{updated?`Atualizado às ${updated.toLocaleTimeString("pt-BR")}`:""} · dados em tempo real</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {alerts>0
              ? <span className="flex items-center gap-1.5 text-[12px] font-semibold text-red-600 bg-red-500/10 px-3 py-1.5 rounded-full"><AlertTriangle className="h-3.5 w-3.5"/>{alerts} alerta{alerts!==1?"s":""} ativo{alerts!==1?"s":""}</span>
              : <span className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-600 bg-emerald-500/10 px-3 py-1.5 rounded-full"><CheckCircle2 className="h-3.5 w-3.5"/>Tudo em dia</span>}
            <button onClick={() => { load(); loadSeries(); }} disabled={loading} className="h-9 w-9 flex items-center justify-center rounded-xl border border-input hover:bg-muted/40 transition-colors bg-card">
              <RefreshCw className={cn("h-4 w-4 text-muted-foreground",loading&&"animate-spin")}/>
            </button>
          </div>
        </div>
      </div>

      {/* Hero stats — os 4 números que mais importam, em destaque */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <HeroStat icon={TrendingUp} label="Faturamento do mês" value={BRL(kpis.faturamento_mes)} accent="text-emerald-600" trend={faturamentoTrend} />
        <HeroStat icon={Activity} label="OEE do mês" value={kpis.oee_mes>0?`${kpis.oee_mes.toFixed(1)}%`:"—"} accent={kpis.oee_mes>=85?"text-emerald-600":kpis.oee_mes>=65?"text-amber-600":"text-red-600"} />
        <HeroStat icon={ShoppingBag} label="Pedidos em aberto" value={String(kpis.pedidos_pendentes + kpis.pedidos_prontos)} accent="text-violet-600" />
        <HeroStat icon={AlertTriangle} label="Alertas ativos" value={String(alerts)} accent={alerts>0?"text-red-600":"text-emerald-600"} />
      </div>

      {/* Gráficos executivos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ChartCard icon={TrendingUp} title="Faturamento — últimos 6 meses" sub="Pedidos faturados + enviados" color="text-emerald-600">
          {seriesLoading ? (
            <div className="h-[180px] flex items-center justify-center text-muted-foreground/50 text-[11px]"><RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5"/>Calculando...</div>
          ) : faturamentoSerie.every(f => f.valor === 0) ? (
            <div className="h-[180px] flex items-center justify-center text-muted-foreground/50 text-[11px]">Sem faturamento no período</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={faturamentoSerie} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="mes" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v: number) => [formatBRL(v), "Faturamento"]} />
                <Bar dataKey="valor" name="Faturamento" fill="#22c55e" radius={[6,6,0,0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard icon={Activity} title="OEE — últimos 6 meses" sub="Meta de referência: 85%" color="text-orange-600">
          {seriesLoading ? (
            <div className="h-[180px] flex items-center justify-center text-muted-foreground/50 text-[11px]"><RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5"/>Calculando...</div>
          ) : oeeSerie.every(o => o.valor === 0) ? (
            <div className="h-[180px] flex items-center justify-center text-muted-foreground/50 text-[11px]">Sem apontamentos no período</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={oeeSerie} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="mes" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v: number) => [`${v.toFixed(1)}%`, "OEE"]} />
                <ReferenceLine y={85} stroke="#22c55e" strokeDasharray="4 4" strokeOpacity={0.5} />
                <Line type="monotone" dataKey="valor" name="OEE" stroke={oeeCor} strokeWidth={2.5} dot={{ r: 3.5, fill: oeeCor }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard icon={Package} title="Estoque por fase" sub="Unidades em Intermediário × Expedição" color="text-blue-600">
          {estoqueDist.length === 0 ? (
            <div className="h-[180px] flex items-center justify-center text-muted-foreground/50 text-[11px]">Sem estoque registrado</div>
          ) : (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="55%" height={160}>
                <PieChart>
                  <Pie data={estoqueDist} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={3}>
                    {estoqueDist.map((d,i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v: number) => v.toLocaleString("pt-BR")} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 flex-1">
                {estoqueDist.map(d => {
                  const total = estoqueDist.reduce((s,x) => s+x.value, 0);
                  const pct = total > 0 ? (d.value/total*100).toFixed(0) : "0";
                  return (
                    <div key={d.name} className="flex items-center gap-2 text-[11px]">
                      <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: d.color }} />
                      <span className="text-muted-foreground truncate flex-1">{d.name}</span>
                      <span className="font-bold">{d.value.toLocaleString("pt-BR")}</span>
                      <span className="text-muted-foreground/60 text-[10px] w-8 text-right">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </ChartCard>

        <ChartCard icon={DollarSign} title="Receber × Pagar" sub="Valores em aberto e vencidos" color="text-emerald-600">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={receberPagarData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="grupo" tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v: number) => formatBRL(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Aberto" fill="#3b82f6" radius={[6,6,0,0]} maxBarSize={36} />
              <Bar dataKey="Vencido" fill="#ef4444" radius={[6,6,0,0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {alertasPorArea.length > 0 && (
          <ChartCard icon={AlertTriangle} title="Alertas por área" sub="Onde a atenção é mais urgente agora" color="text-red-600">
            <ResponsiveContainer width="100%" height={Math.max(140, alertasPorArea.length * 32)}>
              <BarChart data={alertasPorArea} layout="vertical" margin={{ top: 0, right: 16, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="area" tick={{ ...AXIS_TICK, fontSize: 10.5 }} axisLine={false} tickLine={false} width={120} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Bar dataKey="valor" name="Ocorrências" fill="#ef4444" radius={[0,6,6,0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        )}
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

      {saude && (
        <div>
          <Sec icon={HeartPulse} label="Saúde do Sistema" color="text-pink-600"/>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard
              icon={HardDrive}
              label="Último Backup"
              value={tempoRelativo(saude.last_backup)}
              color={!saude.last_backup ? "text-red-600" : "text-green-600"}
              alert={!saude.last_backup || (Date.now() - new Date(saude.last_backup).getTime()) > 4*24*60*60*1000}
              sub={saude.backup_schedule ?? undefined}
            />
            <KpiCard
              icon={Factory}
              label="Último Apontamento"
              value={tempoRelativo(saude.last_apontamento)}
              color="text-blue-600"
            />
            <KpiCard
              icon={Database}
              label="Registros de Auditoria"
              value={saude.audit_log_count.toLocaleString("pt-BR")}
              color="text-violet-600"
              sub={saude.audit_log_oldest ? `desde ${tempoRelativo(saude.audit_log_oldest)}` : undefined}
            />
            <KpiCard
              icon={saude.cron_jobs.length >= 2 ? CheckCircle2 : AlertTriangle}
              label="Rotinas Automáticas"
              value={`${saude.cron_jobs.filter(j => j.active).length}/2 ativas`}
              color={saude.cron_jobs.length >= 2 ? "text-green-600" : "text-amber-600"}
              alert={saude.cron_jobs.length < 2}
              sub={saude.cron_jobs.length < 2 ? "habilite pg_cron no painel" : "backup + limpeza de logs"}
            />
          </div>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground text-center pb-2">KPIs em tempo real · Mês corrente · Tendências dos últimos 6 meses</p>
    </div>
  );
}
