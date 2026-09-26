/**
 * TempoPecaPanel — Desempenho → Tempo de peça.
 *
 * O tempo de cada peça é aprendido SOZINHO pelo sistema a cada lançamento
 * (tempo produtivo ÷ peças boas, tabela tempo_peca_padrao / view
 * tempo_peca_mensal). Aqui a gestão compara: o mês escolhido × o mês
 * anterior, o tempo padrão (mediana dos últimos 30 lançamentos) e o melhor
 * tempo já registrado — por peça e, opcionalmente, por máquina.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, TrendingDown, TrendingUp, Minus, Search, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { fmtCiclo, fmtNum, MESES_CURTOS } from "@/lib/semestre";

interface Linha {
  produto: string; descricao: string;
  atual: number | null; anterior: number | null; variacao: number | null;
  padrao: number | null; melhor: number | null; amostras: number; pecasMes: number;
}

function isoMes(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; }

export function TempoPecaPanel() {
  const hoje = new Date();
  const [mesRef, setMesRef] = useState(isoMes(hoje));
  const [maquina, setMaquina] = useState("*");
  const [maquinas, setMaquinas] = useState<string[]>([]);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");

  const opcoesMes = useMemo(() => Array.from({ length: 18 }, (_, i) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    return { v: isoMes(d), l: `${MESES_CURTOS[d.getMonth()]}/${d.getFullYear()}` };
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  const mesAnterior = useMemo(() => {
    const d = new Date(`${mesRef}T12:00:00`); d.setMonth(d.getMonth() - 1); return isoMes(d);
  }, [mesRef]);

  const load = useCallback(async () => {
    setLoading(true);
    let qMes = supabase.from("tempo_peca_mensal").select("produto,descricao_produto,maquina_codigo,mes,pecas,horas_produtivas")
      .in("mes", [mesRef, mesAnterior]);
    if (maquina !== "*") qMes = qMes.eq("maquina_codigo", maquina);
    const [mesRes, padRes, maqRes] = await Promise.all([
      qMes,
      supabase.from("tempo_peca_padrao").select("produto,maquina,ciclo_mediana_min,melhor_ciclo_min,amostras").eq("maquina", maquina),
      supabase.from("tempo_peca_padrao").select("maquina").neq("maquina", "*"),
    ]);
    setMaquinas([...new Set((maqRes.data ?? []).map(m => m.maquina))].sort());

    const agg = new Map<string, { desc: string; atual: { p: number; h: number }; ant: { p: number; h: number } }>();
    for (const r of mesRes.data ?? []) {
      if (!r.produto) continue;
      const a = agg.get(r.produto) ?? { desc: r.descricao_produto ?? "", atual: { p: 0, h: 0 }, ant: { p: 0, h: 0 } };
      const alvo = r.mes === mesRef ? a.atual : a.ant;
      alvo.p += Number(r.pecas) || 0; alvo.h += Number(r.horas_produtivas) || 0;
      if (!a.desc && r.descricao_produto) a.desc = r.descricao_produto;
      agg.set(r.produto, a);
    }
    const pad = new Map((padRes.data ?? []).map(p => [p.produto, p]));
    const produtos = new Set([...agg.keys()]);
    const out: Linha[] = [...produtos].map(prod => {
      const a = agg.get(prod)!;
      const atual = a.atual.p > 0 ? a.atual.h * 60 / a.atual.p : null;
      const anterior = a.ant.p > 0 ? a.ant.h * 60 / a.ant.p : null;
      const p = pad.get(prod);
      return {
        produto: prod, descricao: a.desc,
        atual, anterior,
        variacao: atual && anterior ? ((atual - anterior) / anterior) * 100 : null,
        padrao: p?.ciclo_mediana_min != null ? Number(p.ciclo_mediana_min) : null,
        melhor: p?.melhor_ciclo_min != null ? Number(p.melhor_ciclo_min) : null,
        amostras: p?.amostras ?? 0,
        pecasMes: a.atual.p,
      };
    }).sort((x, y) => y.pecasMes - x.pecasMes || x.produto.localeCompare(y.produto));
    setLinhas(out);
    setLoading(false);
  }, [mesRef, mesAnterior, maquina]);

  useEffect(() => { load(); }, [load]);

  const filtradas = linhas.filter(l => !busca.trim() ||
    l.produto.toLowerCase().includes(busca.toLowerCase()) || l.descricao.toLowerCase().includes(busca.toLowerCase()));
  const comparaveis = filtradas.filter(l => l.variacao !== null);
  const maisRapidas = comparaveis.filter(l => l.variacao! < -2).length;
  const maisLentas = comparaveis.filter(l => l.variacao! > 2).length;
  const labelMes = (iso: string) => { const d = new Date(`${iso}T12:00:00`); return `${MESES_CURTOS[d.getMonth()]}/${d.getFullYear()}`; };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-primary/5 border-primary/20 px-4 py-3 flex gap-2.5 text-sm">
        <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <p>O tempo de cada peça é calculado <strong>automaticamente</strong> a cada lançamento (tempo produtivo ÷ peças boas) — ninguém precisa informar. Quanto mais lançamentos, mais preciso fica o padrão.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={mesRef} onChange={e => setMesRef(e.target.value)} aria-label="Mês" className="h-11 rounded-xl border border-input bg-background px-3 text-sm">
          {opcoesMes.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
        <select value={maquina} onChange={e => setMaquina(e.target.value)} aria-label="Máquina" className="h-11 rounded-xl border border-input bg-background px-3 text-sm">
          <option value="*">Todas as máquinas</option>
          {maquinas.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <div className="relative flex-1 min-w-[12rem] max-w-sm">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar peça..." className="h-11 pl-9" />
        </div>
        <Button variant="outline" size="icon" className="h-11 w-11" onClick={load} disabled={loading} aria-label="Atualizar">
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border bg-card p-4"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Peças no mês</p><p className="text-2xl font-bold tabular-nums mt-1">{filtradas.filter(l => l.pecasMes > 0).length}</p></div>
        <div className="rounded-2xl border bg-card p-4"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Mais rápidas</p><p className="text-2xl font-bold tabular-nums mt-1 text-green-600">{maisRapidas}</p></div>
        <div className="rounded-2xl border bg-card p-4"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Mais lentas</p><p className="text-2xl font-bold tabular-nums mt-1 text-red-600">{maisLentas}</p></div>
      </div>

      <div className="rounded-2xl border bg-card p-4 overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Calculando...</div>
        ) : filtradas.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">Nenhuma peça produzida em {labelMes(mesRef)} ou {labelMes(mesAnterior)}.</p>
        ) : (
          <table className="w-full text-sm min-w-[720px]">
            <thead><tr className="text-left text-xs text-muted-foreground border-b">
              <th className="py-2 font-medium">Peça</th>
              <th className="py-2 font-medium text-right">{labelMes(mesAnterior)}</th>
              <th className="py-2 font-medium text-right">{labelMes(mesRef)}</th>
              <th className="py-2 font-medium text-right">Variação</th>
              <th className="py-2 font-medium text-right">Tempo padrão</th>
              <th className="py-2 font-medium text-right">Melhor</th>
              <th className="py-2 font-medium text-right">Peças no mês</th>
            </tr></thead>
            <tbody>
              {filtradas.map(l => {
                const v = l.variacao;
                const Icone = v === null ? Minus : v < -2 ? TrendingDown : v > 2 ? TrendingUp : Minus;
                return (
                  <tr key={l.produto} className="border-b last:border-0">
                    <td className="py-2.5"><span className="font-semibold">{l.produto}</span><span className="block text-xs text-muted-foreground truncate max-w-[16rem]">{l.descricao}</span></td>
                    <td className="py-2.5 text-right tabular-nums text-muted-foreground">{l.anterior ? fmtCiclo(l.anterior) : "—"}</td>
                    <td className="py-2.5 text-right tabular-nums font-medium">{l.atual ? fmtCiclo(l.atual) : "—"}</td>
                    <td className={cn("py-2.5 text-right tabular-nums font-semibold",
                      v === null ? "text-muted-foreground" : v < -2 ? "text-green-600" : v > 2 ? "text-red-600" : "text-muted-foreground")}>
                      <span className="inline-flex items-center gap-1 justify-end">
                        <Icone className="h-3.5 w-3.5" />
                        {v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1).replace(".", ",")}%`}
                      </span>
                      {v !== null && <span className="block text-[11px] font-normal">{v < -2 ? "mais rápida" : v > 2 ? "mais lenta" : "estável"}</span>}
                    </td>
                    <td className="py-2.5 text-right tabular-nums">{l.padrao ? fmtCiclo(l.padrao) : "—"}
                      {l.amostras > 0 && <span className="block text-[11px] text-muted-foreground">{l.amostras} lanç.</span>}</td>
                    <td className="py-2.5 text-right tabular-nums text-green-700 dark:text-green-400">{l.melhor ? fmtCiclo(l.melhor) : "—"}</td>
                    <td className="py-2.5 text-right tabular-nums">{fmtNum(l.pecasMes)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Tempo padrão = mediana dos últimos 30 lançamentos da peça (ignora lançamentos fora da curva). É ele que o Diário usa para calcular o "esperado" quando a peça tem histórico.
      </p>
    </div>
  );
}
