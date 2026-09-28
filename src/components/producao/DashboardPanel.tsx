/**
 * DashboardPanel — Desempenho → Mês.
 * OEE real do mês (resumo_mensal_producao) = Disponibilidade × Performance ×
 * Qualidade, produzido × planejado, desempenho por máquina e perdas
 * (paradas e refugo por tipo). Também mostra o andamento da meta de OEE do
 * semestre (calcular_oee sobre o semestre inteiro).
 */

import { useState, useEffect, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import {
  Activity, AlertTriangle, Clock, Target, BarChart2, CheckCircle2, Package, ShieldAlert, Gauge,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { untypedRpc } from "@/lib/untypedRpc";
import { META_SEMESTRE_CODIGO, periodoSemestre } from "@/components/producao/MetasPanel";
import {
  KpiCard, Secao, Carregando, Vazio, BotaoAtualizar, tomPct, TOM_TXT, TOM_BAR, COR, tooltipStyle, eixoTick, gradeCor,
  fmtInt, fmtPct1, fmtHorasCurto,
} from "@/components/producao/ProducaoUI";

// Anos do filtro: de 2024 até o ano seguinte ao atual.
const ANOS_DISPONIVEIS = Array.from({ length: new Date().getFullYear() - 2024 + 2 }, (_, i) => 2024 + i);
const MESES_LONGOS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

interface OEEData {
  hr_planejadas: number; hr_paradas: number; hr_disponiveis: number; disponibilidade: number;
  qtde_planejada: number; qtde_produzida: number; total_refugo: number;
  performance: number; qualidade: number; oee: number;
}
interface MaquinaData { maquina: string; hr_planejadas: number; qtde_produzida: number; qtde_planejada: number; total_apontamentos: number; }
interface ParadaData { tipo: string; total_horas: number; ocorrencias: number; }
interface RefugoData { tipo: string; total: number; ocorrencias: number; }
interface ResumoMensal {
  mes: number; ano: number; geral: OEEData;
  por_maquina: MaquinaData[]; paradas_por_tipo: ParadaData[]; refugos_por_tipo: RefugoData[];
}

const compacto = (v: number) => v >= 10000 ? `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`
  : v >= 1000 ? `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : String(Math.round(v));

/** Anel de OEE (SVG puro, legível em claro/escuro). */
function AnelOEE({ valor }: { valor: number }) {
  const r = 42, c = 2 * Math.PI * r, pct = Math.max(0, Math.min(100, valor));
  const tom = tomPct(valor);
  return (
    <div className="relative h-28 w-28 shrink-0">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="10" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={tom === "ok" ? COR.ok : tom === "atencao" ? COR.atencao : COR.ruim}
          strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(pct / 100) * c} ${c}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("text-2xl font-black tabular-nums leading-none", TOM_TXT[tom])}>{valor.toFixed(1).replace(".", ",")}%</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mt-0.5">OEE</span>
      </div>
    </div>
  );
}

function Componente({ label, valor, explica }: { label: string; valor: number; explica: string }) {
  const tom = tomPct(Math.min(100, valor));
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className={cn("text-base font-bold tabular-nums", TOM_TXT[tom])}>{fmtPct1(valor)}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full", TOM_BAR[tom])} style={{ width: `${Math.min(100, valor)}%` }} />
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{explica}</p>
    </div>
  );
}

/** Lista com barras horizontais (paradas/refugos) — lê bem no celular. */
function ListaBarras({ itens, cor, fmt }: { itens: { nome: string; valor: number; extra?: string }[]; cor: string; fmt: (v: number) => string }) {
  const max = Math.max(...itens.map(i => i.valor), 0) || 1;
  const total = itens.reduce((s, i) => s + i.valor, 0) || 1;
  return (
    <ul className="space-y-3">
      {itens.map(i => (
        <li key={i.nome} className="text-sm">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate">{i.nome}</span>
            <span className="shrink-0 tabular-nums"><strong>{fmt(i.valor)}</strong>
              <span className="text-xs text-muted-foreground"> · {Math.round((i.valor / total) * 100)}%{i.extra ? ` · ${i.extra}` : ""}</span></span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-muted overflow-hidden">
            <div className={cn("h-full rounded-full", cor)} style={{ width: `${(i.valor / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DashboardPanel() {
  const now = new Date();
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [ano, setAno] = useState(now.getFullYear());
  const [data, setData] = useState<ResumoMensal | null>(null);
  const [loading, setLoading] = useState(true);
  // Meta semestral de OEE (definida em Metas/Semestre, convenção 'SEMESTRE')
  const [semMeta, setSemMeta] = useState<{ sem: 1 | 2; alvo: number; real: number; pecas: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const sem: 1 | 2 = mes <= 6 ? 1 : 2;
    const per = periodoSemestre(sem, ano);
    const [{ data: res, error }, { data: meta }, { data: oeeSem }] = await Promise.all([
      untypedRpc("resumo_mensal_producao", { p_mes: mes, p_ano: ano }),
      supabase.from("metas_producao").select("meta_oee_pct")
        .eq("ano", ano).eq("mes", sem === 1 ? 1 : 7).eq("maquina_codigo", META_SEMESTRE_CODIGO).maybeSingle(),
      untypedRpc("calcular_oee", { p_data_ini: per.ini, p_data_fim: per.fim, p_maquina: null }),
    ]);
    // Só aceita a resposta no formato esperado (evita erro se a RPC vier vazia).
    const r = res as ResumoMensal | null;
    if (!error && r && r.geral && typeof r.geral.hr_planejadas === "number") setData(r);
    else setData(null);
    if (oeeSem) {
      // Meta do semestre é comparada com o OEE (paradas entram no cálculo). Sem meta salva: 85%.
      const o = oeeSem as { oee: number; qtde_produzida: number };
      setSemMeta({ sem, alvo: Number(meta?.meta_oee_pct) || 85, real: Number(o.oee) || 0, pecas: Number(o.qtde_produzida) || 0 });
    } else setSemMeta(null);
    setLoading(false);
  }, [mes, ano]);

  useEffect(() => { load(); }, [load]);

  function mudarMes(delta: number) {
    const d = new Date(ano, mes - 1 + delta, 1);
    if (!ANOS_DISPONIVEIS.includes(d.getFullYear())) return;
    setMes(d.getMonth() + 1); setAno(d.getFullYear());
  }

  const g = data?.geral;
  const temDados = !!g && g.hr_planejadas > 0;
  const pctPlano = g && g.qtde_planejada > 0 ? (g.qtde_produzida / g.qtde_planejada) * 100 : null;
  const pctRefugo = g && g.qtde_produzida + g.total_refugo > 0 ? (g.total_refugo / (g.qtde_produzida + g.total_refugo)) * 100 : 0;
  const maquinas = (data?.por_maquina ?? []).map(m => ({
    ...m, pct: m.qtde_planejada > 0 ? (m.qtde_produzida / m.qtde_planejada) * 100 : null,
  }));

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Período */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl border bg-card p-1">
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => mudarMes(-1)} aria-label="Mês anterior"><ChevronLeft className="h-4 w-4" /></Button>
          <select value={mes} onChange={e => setMes(Number(e.target.value))} aria-label="Mês"
            className="h-9 rounded-lg bg-transparent px-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-ring">
            {MESES_LONGOS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select value={ano} onChange={e => setAno(Number(e.target.value))} aria-label="Ano"
            className="h-9 rounded-lg bg-transparent px-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-ring">
            {ANOS_DISPONIVEIS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => mudarMes(1)} aria-label="Próximo mês"><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <BotaoAtualizar onClick={load} loading={loading} />
      </div>

      {/* Meta de OEE do semestre */}
      {!loading && semMeta && semMeta.alvo > 0 && (
        <div className={cn("rounded-2xl border p-4", semMeta.real >= semMeta.alvo ? "border-green-500/30 bg-green-500/5" : "border-amber-500/30 bg-amber-500/5")}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Target className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Meta de OEE do {semMeta.sem}º semestre</h3>
            <span className="ml-auto flex items-center gap-1 text-sm font-semibold">
              {semMeta.real >= semMeta.alvo
                ? <><CheckCircle2 className="h-4 w-4 text-green-600" /><span className="text-green-600">Atingida</span></>
                : <><AlertTriangle className="h-4 w-4 text-amber-600" /><span className="text-amber-600">Faltam {(semMeta.alvo - semMeta.real).toFixed(1).replace(".", ",")} pts</span></>}
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className={cn("text-2xl font-black tabular-nums", semMeta.real >= semMeta.alvo ? "text-green-600" : "text-amber-600")}>{fmtPct1(semMeta.real)}</span>
            <span className="text-xs text-muted-foreground">de {fmtPct1(semMeta.alvo)} · {fmtInt(semMeta.pecas)} peças no semestre</span>
          </div>
          <div className="mt-2 h-2.5 rounded-full bg-muted overflow-hidden">
            <div className={cn("h-full rounded-full", semMeta.real >= semMeta.alvo ? "bg-green-500" : "bg-amber-500")}
              style={{ width: `${Math.min(100, (semMeta.real / semMeta.alvo) * 100)}%` }} />
          </div>
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border bg-card"><Carregando texto="Calculando OEE..." /></div>
      ) : !temDados || !g ? (
        <div className="rounded-2xl border bg-card">
          <Vazio Icon={Activity} titulo={`Sem produção lançada em ${MESES_LONGOS[mes - 1].toLowerCase()} de ${ano}`}
            dica="Os números aparecem assim que houver lançamentos no Diário ou no Controle." />
        </div>
      ) : (
        <>
          {/* OEE e seus três componentes */}
          <section className="rounded-2xl border bg-card p-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
              <div className="flex items-center gap-4">
                <AnelOEE valor={g.oee} />
                <div className="sm:hidden min-w-0">
                  <p className="text-sm font-semibold">{MESES_LONGOS[mes - 1]} de {ano}</p>
                  <p className="text-xs text-muted-foreground">OEE = disponibilidade × performance × qualidade</p>
                </div>
              </div>
              <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 min-w-0">
                <Componente label="Disponibilidade" valor={g.disponibilidade} explica={`${fmtHorasCurto(g.hr_paradas)} parada de ${fmtHorasCurto(g.hr_planejadas)}`} />
                <Componente label="Performance" valor={g.performance} explica="ritmo real × ritmo esperado" />
                <Componente label="Qualidade" valor={g.qualidade} explica={`${fmtInt(g.total_refugo)} refugadas`} />
              </div>
            </div>
            <p className="hidden sm:block mt-3 text-xs text-muted-foreground">OEE = disponibilidade (tempo sem paradas) × performance (ritmo) × qualidade (peças boas). Acima de 85% é classe mundial.</p>
          </section>

          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label="Produzido" Icon={Package} value={fmtInt(g.qtde_produzida)}
              sub={pctPlano !== null ? `${fmtPct1(pctPlano)} de ${fmtInt(g.qtde_planejada)} planejadas` : "sem plano"}
              tom={pctPlano === null ? "neutro" : tomPct(pctPlano, 95, 80)}
              progresso={pctPlano !== null ? { pct: pctPlano } : null} />
            <KpiCard label="Horas trabalhadas" Icon={Clock} value={fmtHorasCurto(g.hr_planejadas)}
              sub={`${fmtHorasCurto(g.hr_disponiveis)} produzindo`} />
            <KpiCard label="Horas paradas" Icon={AlertTriangle} value={fmtHorasCurto(g.hr_paradas)}
              tom={g.hr_paradas > 0 ? "atencao" : "neutro"}
              sub={g.hr_planejadas > 0 ? `${fmtPct1((g.hr_paradas / g.hr_planejadas) * 100)} do tempo` : undefined} />
            <KpiCard label="Refugo" Icon={ShieldAlert} value={fmtInt(g.total_refugo)}
              tom={pctRefugo > 2 ? "ruim" : pctRefugo > 0.5 ? "atencao" : "neutro"}
              sub={`${fmtPct1(pctRefugo)} das peças`} />
          </div>

          {/* Por máquina */}
          {maquinas.length > 0 && (
            <Secao titulo="Produzido × planejado por máquina" Icon={BarChart2}
              sub="Barra colorida = produzido (verde ≥ 95% do plano, âmbar ≥ 80%, vermelho abaixo)">
              <div className="h-[260px] -ml-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={maquinas} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gradeCor} vertical={false} />
                    <XAxis dataKey="maquina" tick={eixoTick} axisLine={false} tickLine={false} interval={0} />
                    <YAxis tick={eixoTick} axisLine={false} tickLine={false} width={48} tickFormatter={compacto} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "hsl(var(--muted))" }}
                      formatter={(v: number, n: string) => [`${fmtInt(v)} pç`, n]} />
                    <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={9} />
                    <Bar dataKey="qtde_planejada" name="Planejado" fill={COR.plano} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="qtde_produzida" name="Produzido" fill={COR.primaria} radius={[4, 4, 0, 0]}
                      shape={(props: unknown) => {
                        const p = props as { x: number; y: number; width: number; height: number; payload: { pct: number | null } };
                        const t = p.payload.pct === null ? "neutro" : tomPct(p.payload.pct, 95, 80);
                        const fill = t === "ok" ? COR.ok : t === "atencao" ? COR.atencao : t === "ruim" ? COR.ruim : COR.primaria;
                        const h = Math.max(0, p.height), r = Math.min(4, p.width / 2, h);
                        return <path d={`M${p.x},${p.y + h} V${p.y + r} Q${p.x},${p.y} ${p.x + r},${p.y} H${p.x + p.width - r} Q${p.x + p.width},${p.y} ${p.x + p.width},${p.y + r} V${p.y + h} Z`} fill={fill} />;
                      }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {/* Números por máquina: lista no celular, tabela no desktop */}
              <ul className="md:hidden mt-3 divide-y border-t">
                {maquinas.map(m => (
                  <li key={m.maquina} className="py-2.5 flex items-center gap-3 text-sm">
                    <span className="font-semibold w-16 shrink-0">{m.maquina}</span>
                    <span className="flex-1 text-muted-foreground tabular-nums text-xs">{fmtInt(m.qtde_produzida)} / {fmtInt(m.qtde_planejada)} pç · {fmtHorasCurto(m.hr_planejadas)}</span>
                    <span className={cn("font-bold tabular-nums", m.pct === null ? "text-muted-foreground" : TOM_TXT[tomPct(m.pct, 95, 80)])}>{m.pct === null ? "—" : `${Math.round(m.pct)}%`}</span>
                  </li>
                ))}
              </ul>
              <table className="hidden md:table w-full mt-3 text-sm">
                <thead><tr className="text-left text-xs text-muted-foreground border-y bg-muted/40">
                  <th className="px-3 py-2 font-semibold">Máquina</th>
                  <th className="px-3 py-2 font-semibold text-right">Horas</th>
                  <th className="px-3 py-2 font-semibold text-right">Lançamentos</th>
                  <th className="px-3 py-2 font-semibold text-right">Planejado</th>
                  <th className="px-3 py-2 font-semibold text-right">Produzido</th>
                  <th className="px-3 py-2 font-semibold text-right">% do plano</th>
                </tr></thead>
                <tbody>
                  {maquinas.map(m => (
                    <tr key={m.maquina} className="border-b last:border-0">
                      <td className="px-3 py-2 font-semibold">{m.maquina}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtHorasCurto(m.hr_planejadas)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{m.total_apontamentos ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtInt(m.qtde_planejada)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtInt(m.qtde_produzida)}</td>
                      <td className={cn("px-3 py-2 text-right tabular-nums font-bold", m.pct === null ? "text-muted-foreground" : TOM_TXT[tomPct(m.pct, 95, 80)])}>{m.pct === null ? "—" : fmtPct1(m.pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Secao>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Secao titulo="Onde o tempo foi perdido" Icon={Clock} sub="Horas paradas por motivo">
              {(data?.paradas_por_tipo ?? []).length === 0
                ? <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma parada no mês. 👍</p>
                : <ListaBarras cor="bg-amber-500" fmt={fmtHorasCurto}
                    itens={data!.paradas_por_tipo.slice(0, 8).map(p => ({ nome: p.tipo, valor: Number(p.total_horas) || 0, extra: `${p.ocorrencias}×` }))} />}
            </Secao>
            <Secao titulo="Refugo por motivo" Icon={Gauge} sub="Peças perdidas">
              {(data?.refugos_por_tipo ?? []).length === 0
                ? <p className="py-6 text-center text-sm text-muted-foreground">Nenhum refugo no mês. 👍</p>
                : <ListaBarras cor="bg-red-500" fmt={v => `${fmtInt(v)} pç`}
                    itens={data!.refugos_por_tipo.map(r => ({ nome: r.tipo, valor: Number(r.total) || 0 }))} />}
            </Secao>
          </div>
        </>
      )}
    </div>
  );
}
