/**
 * SemestralPanel — Desempenho → Semestre.
 * Visão consolidada do semestre (OEE, produção, máquinas, perdas) e botão
 * para baixar a apresentação (.pptx) usada na reunião mestra.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { Download, Loader2, RefreshCw, Target, CheckCircle2, AlertTriangle, Presentation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { carregarSemestre, semestreAtual, salvarMetaSemestre, fmtCiclo, fmtHoras, fmtNum, fmtPct, type DadosSemestre } from "@/lib/semestre";
import { Input } from "@/components/ui/input";

const ANOS = Array.from({ length: new Date().getFullYear() - 2024 + 1 }, (_, i) => 2024 + i);
const tooltipStyle = { background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 };
const eixo = { fontSize: 12, fill: "hsl(var(--muted-foreground))" };

function corOee(v: number) {
  return v >= 85 ? "text-green-600" : v >= 65 ? "text-amber-600" : "text-red-600";
}

export function SemestralPanel() {
  const atual = semestreAtual();
  const [semestre, setSemestre] = useState<1 | 2>(atual.semestre);
  const [ano, setAno] = useState(atual.ano);
  const [dados, setDados] = useState<DadosSemestre | null>(null);
  const [loading, setLoading] = useState(true);
  const [gerando, setGerando] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setDados(await carregarSemestre(semestre, ano)); }
    catch { toast.error("Não foi possível carregar o semestre."); setDados(null); }
    finally { setLoading(false); }
  }, [semestre, ano]);

  useEffect(() => { load(); }, [load]);

  async function baixar() {
    if (!dados) return;
    setGerando(true);
    try {
      const { gerarApresentacaoSemestre } = await import("@/lib/semestrePptx");
      await gerarApresentacaoSemestre(dados);
      toast.success("Apresentação baixada.");
    } catch {
      toast.error("Não foi possível gerar a apresentação.");
    } finally {
      setGerando(false);
    }
  }

  const g = dados?.geral;
  const temDados = !!dados && dados.meses.some(m => m.temDados);
  // Meses sem lançamento ficam vazios no gráfico (não "despencam" para zero).
  const serie = (dados?.meses ?? []).map(m => m.temDados ? m : {
    ...m, oee: null, disponibilidade: null, qualidade: null, performance: null, qtde_produzida: null, qtde_planejada: null,
  });

  return (
    <div className="space-y-4">
      {/* Filtros + download */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border bg-muted/40 p-1" role="radiogroup" aria-label="Semestre">
          {([1, 2] as const).map(s => (
            <button key={s} type="button" role="radio" aria-checked={semestre === s} onClick={() => setSemestre(s)}
              className={cn("h-9 px-4 rounded-lg text-sm font-medium", semestre === s ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {s}º semestre
            </button>
          ))}
        </div>
        <select value={ano} onChange={e => setAno(Number(e.target.value))} aria-label="Ano"
          className="h-11 rounded-xl border border-input bg-background px-3 text-sm">
          {ANOS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <Button variant="outline" size="icon" className="h-11 w-11" onClick={load} disabled={loading} aria-label="Atualizar">
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
        <Button className="h-11 gap-2 w-full sm:w-auto sm:ml-auto" onClick={baixar} disabled={!dados || loading || gerando}>
          {gerando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Presentation className="h-4 w-4" />}
          Baixar apresentação<span className="hidden sm:inline"> (PowerPoint)</span>
          <Download className="h-4 w-4 opacity-70" />
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando semestre...</div>
      ) : !dados || !g ? (
        <p className="py-20 text-center text-sm text-muted-foreground">Não foi possível carregar os dados.</p>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { l: "OEE do semestre", v: fmtPct(g.oee), c: corOee(g.oee) },
              { l: "Disponibilidade", v: fmtPct(g.disponibilidade), c: corOee(g.disponibilidade) },
              { l: "Performance", v: fmtPct(g.performance), c: corOee(Math.min(100, g.performance)) },
              { l: "Qualidade", v: fmtPct(g.qualidade), c: corOee(g.qualidade) },
              { l: "Peças produzidas", v: fmtNum(g.qtde_produzida) },
              { l: "Peças planejadas", v: fmtNum(g.qtde_planejada) },
              { l: "Refugo", v: `${fmtNum(g.total_refugo)} pç` },
              { l: "Horas paradas", v: fmtHoras(g.hr_paradas) },
            ].map(k => (
              <div key={k.l} className="rounded-2xl border bg-card p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{k.l}</p>
                <p className={cn("mt-1 text-2xl font-bold tabular-nums", k.c)}>{k.v}</p>
              </div>
            ))}
          </div>

          <MetaSemestre dados={dados} onSalva={load} />

          {!temDados ? (
            <p className="rounded-2xl border bg-card py-16 text-center text-sm text-muted-foreground">Sem lançamentos neste semestre.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-2xl border bg-card p-4">
                  <h3 className="text-sm font-semibold mb-3">OEE mês a mês (%)</h3>
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={serie} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={eixo} axisLine={false} tickLine={false} />
                      <YAxis tick={eixo} axisLine={false} tickLine={false} width={36} domain={[0, 100]} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [fmtPct(v), n]} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line type="monotone" dataKey="oee" name="OEE" stroke="hsl(var(--chart-1))" strokeWidth={2.5} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                      <Line type="monotone" dataKey="disponibilidade" name="Disponibilidade" stroke="hsl(var(--chart-4))" strokeWidth={2} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="qualidade" name="Qualidade" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="rounded-2xl border bg-card p-4">
                  <h3 className="text-sm font-semibold mb-3">Peças produzidas × planejadas</h3>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={serie} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barGap={2}>
                      <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={eixo} axisLine={false} tickLine={false} />
                      <YAxis tick={eixo} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : String(v)} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [`${fmtNum(v)} pç`, n]} cursor={{ fill: "hsl(var(--muted))" }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="qtde_produzida" name="Produzido" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="qtde_planejada" name="Planejado" fill="hsl(var(--muted-foreground) / 0.35)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-2xl border bg-card p-4 overflow-x-auto">
                  <h3 className="text-sm font-semibold mb-3">Por máquina</h3>
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-muted-foreground border-b">
                      <th className="py-2 font-medium">Máquina</th><th className="py-2 font-medium text-right">Horas</th>
                      <th className="py-2 font-medium text-right">Produzido</th><th className="py-2 font-medium text-right">Planejado</th>
                      <th className="py-2 font-medium text-right">Perf.</th></tr></thead>
                    <tbody>
                      {dados.maquinas.map(m => (
                        <tr key={m.maquina} className="border-b last:border-0">
                          <td className="py-2 font-semibold">{m.maquina}</td>
                          <td className="py-2 text-right tabular-nums">{fmtHoras(m.horas)}</td>
                          <td className="py-2 text-right tabular-nums">{fmtNum(m.produzido)}</td>
                          <td className="py-2 text-right tabular-nums">{fmtNum(m.planejado)}</td>
                          <td className={cn("py-2 text-right tabular-nums font-semibold", corOee(Math.min(100, m.performance)))}>{fmtPct(m.performance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="rounded-2xl border bg-card p-4">
                  <h3 className="text-sm font-semibold mb-3">Principais paradas (horas)</h3>
                  {dados.paradas.length === 0 ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma parada registrada.</p>
                  ) : (
                    <ul className="space-y-2">
                      {dados.paradas.slice(0, 8).map(p => {
                        const max = dados.paradas[0].valor || 1;
                        return (
                          <li key={p.tipo} className="text-sm">
                            <div className="flex justify-between gap-2"><span className="truncate">{p.tipo}</span>
                              <span className="tabular-nums font-semibold shrink-0">{fmtHoras(p.valor)}</span></div>
                            <div className="mt-1 h-2 rounded-full bg-muted overflow-hidden">
                              <div className="h-full rounded-full bg-amber-500" style={{ width: `${(p.valor / max) * 100}%` }} />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border bg-card p-4">
                <h3 className="text-sm font-semibold mb-3">Detalhamento mensal</h3>
                <ul className="md:hidden divide-y -mx-4 border-t">
                  {dados.meses.map(m => (
                    <li key={m.mes} className="px-4 py-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold">{m.label}</span>
                        {m.temDados ? <span className={cn("font-bold tabular-nums", corOee(m.oee))}>OEE {fmtPct(m.oee)}</span> : <span className="text-xs text-muted-foreground">sem lançamentos</span>}
                      </div>
                      {m.temDados && (
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {fmtNum(m.qtde_produzida)} pç · disp {fmtPct(m.disponibilidade)} · perf {fmtPct(m.performance)} · qual {fmtPct(m.qualidade)} · {fmtHoras(m.hr_paradas)} paradas · {fmtNum(m.total_refugo)} refugo
                        </p>
                      )}
                    </li>
                  ))}
                  <li className="px-4 py-2.5 bg-muted/40">
                    <div className="flex items-baseline justify-between gap-2"><span className="font-semibold">Semestre</span><span className={cn("font-bold tabular-nums", corOee(g.oee))}>OEE {fmtPct(g.oee)}</span></div>
                    <p className="text-xs text-muted-foreground tabular-nums">{fmtNum(g.qtde_produzida)} pç · {fmtHoras(g.hr_planejadas)} trabalhadas · {fmtHoras(g.hr_paradas)} paradas · {fmtNum(g.total_refugo)} refugo</p>
                  </li>
                </ul>
                <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead><tr className="text-left text-xs text-muted-foreground border-b">
                    {["Mês", "Horas", "Paradas", "Disp.", "Perf.", "Qual.", "OEE", "Produzido", "Refugo"].map((h, i) => (
                      <th key={h} className={cn("py-2 font-medium", i > 0 && "text-right")}>{h}</th>))}
                  </tr></thead>
                  <tbody>
                    {dados.meses.map(m => (
                      <tr key={m.mes} className="border-b">
                        <td className="py-2 font-medium">{m.label}</td>
                        {m.temDados ? (
                          <>
                            <td className="py-2 text-right tabular-nums">{fmtHoras(m.hr_planejadas)}</td>
                            <td className="py-2 text-right tabular-nums">{fmtHoras(m.hr_paradas)}</td>
                            <td className="py-2 text-right tabular-nums">{fmtPct(m.disponibilidade)}</td>
                            <td className="py-2 text-right tabular-nums">{fmtPct(m.performance)}</td>
                            <td className="py-2 text-right tabular-nums">{fmtPct(m.qualidade)}</td>
                            <td className={cn("py-2 text-right tabular-nums font-semibold", corOee(m.oee))}>{fmtPct(m.oee)}</td>
                            <td className="py-2 text-right tabular-nums">{fmtNum(m.qtde_produzida)}</td>
                            <td className="py-2 text-right tabular-nums">{fmtNum(m.total_refugo)}</td>
                          </>
                        ) : <td colSpan={8} className="py-2 text-right text-muted-foreground">sem lançamentos</td>}
                      </tr>
                    ))}
                    <tr className="font-semibold bg-muted/40">
                      <td className="py-2">Semestre</td>
                      <td className="py-2 text-right tabular-nums">{fmtHoras(g.hr_planejadas)}</td>
                      <td className="py-2 text-right tabular-nums">{fmtHoras(g.hr_paradas)}</td>
                      <td className="py-2 text-right tabular-nums">{fmtPct(g.disponibilidade)}</td>
                      <td className="py-2 text-right tabular-nums">{fmtPct(g.performance)}</td>
                      <td className="py-2 text-right tabular-nums">{fmtPct(g.qualidade)}</td>
                      <td className={cn("py-2 text-right tabular-nums", corOee(g.oee))}>{fmtPct(g.oee)}</td>
                      <td className="py-2 text-right tabular-nums">{fmtNum(g.qtde_produzida)}</td>
                      <td className="py-2 text-right tabular-nums">{fmtNum(g.total_refugo)}</td>
                    </tr>
                  </tbody>
                </table>
                </div>
              </div>
              {dados.tempos.length > 0 && (
                <div className="rounded-2xl border bg-card p-4 md:overflow-x-auto">
                  <h3 className="text-sm font-semibold">Tempo por peça no semestre</h3>
                  <p className="text-xs text-muted-foreground mb-3">Calculado automaticamente a cada lançamento (tempo produtivo ÷ peças). Compara o primeiro e o último mês em que a peça rodou.</p>
                  <ul className="md:hidden divide-y -mx-4 border-t">
                    {dados.tempos.slice(0, 15).map(t => (
                      <li key={t.produto} className="px-4 py-2.5 flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold truncate">{t.produto} <span className="font-normal text-muted-foreground">{t.descricao}</span></p>
                          <p className="text-xs text-muted-foreground tabular-nums">{fmtCiclo(t.cicloIni)} ({t.mesIni}) → {fmtCiclo(t.cicloFim)} ({t.mesFim}) · {fmtNum(t.pecas)} pç</p>
                        </div>
                        <span className={cn("text-sm font-bold tabular-nums shrink-0", t.variacaoPct < -2 ? "text-green-600" : t.variacaoPct > 2 ? "text-red-600" : "text-muted-foreground")}>
                          {t.mesIni === t.mesFim ? "—" : `${t.variacaoPct > 0 ? "+" : ""}${t.variacaoPct.toFixed(1).replace(".", ",")}%`}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <table className="hidden md:table w-full text-sm min-w-[560px]">
                    <thead><tr className="text-left text-xs text-muted-foreground border-b">
                      <th className="py-2 font-medium">Peça</th><th className="py-2 font-medium text-right">Início</th>
                      <th className="py-2 font-medium text-right">Agora</th><th className="py-2 font-medium text-right">Variação</th>
                      <th className="py-2 font-medium text-right">Peças</th></tr></thead>
                    <tbody>
                      {dados.tempos.slice(0, 15).map(t => (
                        <tr key={t.produto} className="border-b last:border-0">
                          <td className="py-2"><span className="font-semibold">{t.produto}</span> <span className="text-muted-foreground">{t.descricao}</span></td>
                          <td className="py-2 text-right tabular-nums">{fmtCiclo(t.cicloIni)} <span className="text-xs text-muted-foreground">{t.mesIni}</span></td>
                          <td className="py-2 text-right tabular-nums">{fmtCiclo(t.cicloFim)} <span className="text-xs text-muted-foreground">{t.mesFim}</span></td>
                          <td className={cn("py-2 text-right tabular-nums font-semibold",
                            t.variacaoPct < -2 ? "text-green-600" : t.variacaoPct > 2 ? "text-red-600" : "text-muted-foreground")}>
                            {t.mesIni === t.mesFim ? "—" : `${t.variacaoPct > 0 ? "+" : ""}${t.variacaoPct.toFixed(1).replace(".", ",")}%`}
                          </td>
                          <td className="py-2 text-right tabular-nums">{fmtNum(t.pecas)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-muted-foreground">Variação negativa (verde) = a peça passou a ser feita mais rápido.</p>
                </div>
              )}

              {g.performance > 100 && (
                <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600" />
                  Performance acima de 100% indica que a capacidade (peças/hora) cadastrada em Produção → Cadastros está abaixo do real para alguma peça.
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Meta de OEE do semestre: editável, padrão 85%, com o impacto das paradas. */
function MetaSemestre({ dados, onSalva }: { dados: DadosSemestre; onSalva: () => void }) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(String(dados.metaOee));
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { setValor(String(dados.metaOee)); }, [dados.metaOee]);

  const g = dados.geral;
  const meta = dados.metaOee;
  const atingiu = g.oee >= meta;
  const perdaParadas = Math.max(0, dados.oeeSemParadas - g.oee);
  const falta = Math.max(0, meta - g.oee);
  const pct = Math.min(100, meta > 0 ? (g.oee / meta) * 100 : 0);

  async function salvar() {
    const v = parseFloat(valor.replace(",", "."));
    if (!(v > 0 && v <= 100)) { toast.error("Informe uma meta entre 1 e 100%."); return; }
    setSalvando(true);
    const { error } = await salvarMetaSemestre(dados.semestre, dados.ano, v);
    setSalvando(false);
    if (error) { toast.error("Não foi possível salvar a meta."); return; }
    toast.success("Meta do semestre salva.");
    setEditando(false);
    onSalva();
  }

  return (
    <div className={cn("rounded-2xl border p-4 space-y-3", atingiu ? "border-green-500/30 bg-green-500/5" : "border-amber-500/30 bg-amber-500/5")}>
      <div className="flex flex-wrap items-center gap-2">
        <Target className="h-5 w-5 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Meta de OEE do {dados.semestre}º semestre</h3>
        {!dados.metaDefinida && <span className="text-xs text-muted-foreground">(padrão)</span>}
        {editando ? (
          <form className="flex items-center gap-2 w-full sm:w-auto sm:ml-auto" onSubmit={e => { e.preventDefault(); salvar(); }}>
            <Input inputMode="decimal" value={valor} onChange={e => setValor(e.target.value)} className="h-11 w-24 text-base" aria-label="Meta de OEE (%)" autoFocus />
            <span className="text-sm">%</span>
            <Button type="submit" size="sm" className="h-11" disabled={salvando}>{salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}</Button>
            <Button type="button" size="sm" variant="ghost" className="h-11" onClick={() => setEditando(false)}>Cancelar</Button>
          </form>
        ) : (
          <Button size="sm" variant="outline" className="h-10 ml-auto" onClick={() => setEditando(true)}>Alterar meta</Button>
        )}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={cn("text-3xl font-bold tabular-nums", atingiu ? "text-green-600" : "text-amber-600")}>{fmtPct(g.oee)}</span>
        <span className="text-sm text-muted-foreground">de {fmtPct(meta)} de meta</span>
        {atingiu
          ? <span className="flex items-center gap-1 text-sm font-semibold text-green-600"><CheckCircle2 className="h-4 w-4" />Meta atingida</span>
          : <span className="flex items-center gap-1 text-sm font-semibold text-amber-600"><AlertTriangle className="h-4 w-4" />Faltam {falta.toFixed(1).replace(".", ",")} pontos</span>}
      </div>
      <div className="h-2.5 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full", atingiu ? "bg-green-500" : "bg-amber-500")} style={{ width: `${pct}%` }} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
        <div className="rounded-xl bg-card/70 border px-3 py-2">
          <p className="text-xs text-muted-foreground">Horas paradas</p>
          <p className="font-semibold tabular-nums">{fmtHoras(g.hr_paradas)} <span className="text-xs text-muted-foreground font-normal">de {fmtHoras(g.hr_planejadas)}</span></p>
        </div>
        <div className="rounded-xl bg-card/70 border px-3 py-2">
          <p className="text-xs text-muted-foreground">OEE sem as paradas</p>
          <p className="font-semibold tabular-nums">{fmtPct(dados.oeeSemParadas)}</p>
        </div>
        <div className="rounded-xl bg-card/70 border px-3 py-2">
          <p className="text-xs text-muted-foreground">Paradas custaram</p>
          <p className="font-semibold tabular-nums text-amber-600">{perdaParadas.toFixed(1).replace(".", ",")} pontos de OEE</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">OEE = disponibilidade (tempo sem paradas) × performance (ritmo) × qualidade (peças boas).</p>
    </div>
  );
}
