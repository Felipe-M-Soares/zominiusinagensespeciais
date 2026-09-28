/**
 * RelatoriosPanel — Desempenho → Relatórios.
 * Período livre + 4 relatórios (produção por dia, disponibilidade das
 * máquinas, paradas e refugo) com gráfico legível no celular e exportação CSV.
 */

import { useState, useCallback, useEffect } from "react";
import { FileBarChart2, Download, BarChart2, Clock, ShieldAlert, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Carregando, Vazio, Campo, COR, tooltipStyle, eixoTick, gradeCor, fmtInt, fmtHorasCurto, hojeISO, isoDiaLocal } from "@/components/producao/ProducaoUI";

type RelatorioTipo = "producao_diaria" | "eficiencia" | "paradas" | "refugo";

const RELATORIOS: { id: RelatorioTipo; label: string; descricao: string; Icon: React.ElementType }[] = [
  { id: "producao_diaria", label: "Produção por dia", descricao: "Peças boas lançadas em cada dia", Icon: BarChart2 },
  { id: "eficiencia",      label: "Disponibilidade", descricao: "Disponibilidade cadastrada de cada máquina", Icon: Gauge },
  { id: "paradas",         label: "Paradas",         descricao: "Tempo perdido e frequência por motivo", Icon: Clock },
  { id: "refugo",          label: "Refugo",          descricao: "Peças refugadas por tipo de defeito", Icon: ShieldAlert },
];

interface RelData {
  producaoDiaria?: { dia: string; producao: number }[];
  eficiencia?: { maquina: string; disponib: number }[];
  paradas?: { motivo: string; minutos: number; ocorrencias: number }[];
  refugo?: { tipo: string; quantidade: number }[];
}

const diasAtras = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return isoDiaLocal(d); };

export function RelatoriosPanel() {
  const [relatorio, setRelatorio] = useState<RelatorioTipo>("producao_diaria");
  const [dataInicio, setDataInicio] = useState(() => diasAtras(14));
  const [dataFim, setDataFim] = useState(hojeISO);
  const [loading, setLoading] = useState(false);
  const [relData, setRelData] = useState<RelData | null>(null);

  const gerarRelatorio = useCallback(async (tipo: RelatorioTipo) => {
    setRelatorio(tipo);
    setLoading(true);
    setRelData(null);
    if (!navigator.onLine) { toast.warning("Relatórios precisam de internet."); setLoading(false); return; }
    try {
      const inicioISO = new Date(`${dataInicio}T00:00:00`).toISOString();
      const fimISO = new Date(`${dataFim}T23:59:59`).toISOString();
      if (tipo === "producao_diaria") {
        // Agrupa pelo dia DO LANÇAMENTO (data_apontamento), não pelo dia em que foi digitado.
        const { data } = await supabase.from("apontamentos_producao").select("quantidade,data_apontamento").gte("data_apontamento", dataInicio).lte("data_apontamento", dataFim);
        const dias: Record<string, number> = {};
        (data || []).forEach((a: { quantidade: number; data_apontamento: string }) => { dias[a.data_apontamento] = (dias[a.data_apontamento] || 0) + (a.quantidade || 0); });
        setRelData({ producaoDiaria: Object.keys(dias).sort().map(k => ({ dia: `${k.slice(8, 10)}/${k.slice(5, 7)}`, producao: dias[k] })) });
      } else if (tipo === "eficiencia") {
        const { data } = await supabase.from("maquinas_producao").select("codigo,disponibilidade,status");
        setRelData({ eficiencia: (data || []).map((m: { codigo: string; disponibilidade: number }) => ({ maquina: m.codigo, disponib: Number(m.disponibilidade) || 0 })).sort((a, b) => a.maquina.localeCompare(b.maquina)) });
      } else if (tipo === "paradas") {
        const { data } = await supabase.from("paradas_producao").select("motivo,duracao_min").gte("created_at", inicioISO).lte("created_at", fimISO);
        const map: Record<string, { minutos: number; ocorrencias: number }> = {};
        (data || []).forEach((p: { motivo: string; duracao_min: number | null }) => {
          if (p.motivo?.startsWith("Produzindo")) return; // cronômetro interno do Diário, não é parada
          map[p.motivo] ??= { minutos: 0, ocorrencias: 0 };
          map[p.motivo].minutos += p.duracao_min || 0; map[p.motivo].ocorrencias++;
        });
        setRelData({ paradas: Object.entries(map).map(([motivo, v]) => ({ motivo, ...v })).sort((a, b) => b.minutos - a.minutos) });
      } else {
        const { data } = await supabase.from("refugos_producao").select("tipo_defeito,quantidade").gte("created_at", inicioISO).lte("created_at", fimISO);
        const map: Record<string, number> = {};
        (data || []).forEach((r: { tipo_defeito: string; quantidade: number }) => { map[r.tipo_defeito] = (map[r.tipo_defeito] || 0) + r.quantidade; });
        setRelData({ refugo: Object.entries(map).map(([t, quantidade]) => ({ tipo: t, quantidade })).sort((a, b) => b.quantidade - a.quantidade) });
      }
    } catch (e) {
      toast.error("Erro ao gerar relatório.");
      logger.error("RelatoriosPanel buscarDados error:", e);
    }
    setLoading(false);
  }, [dataInicio, dataFim]);

  useEffect(() => { gerarRelatorio(relatorio); }, [dataInicio, dataFim]); // eslint-disable-line react-hooks/exhaustive-deps

  function exportarCSV() {
    if (!relData) { toast.error("Gere um relatório antes de exportar."); return; }
    const rows: string[][] = [];
    if (relData.producaoDiaria) { rows.push(["Dia", "Produção"]); relData.producaoDiaria.forEach(r => rows.push([r.dia, String(r.producao)])); }
    if (relData.eficiencia) { rows.push(["Máquina", "Disponibilidade %"]); relData.eficiencia.forEach(r => rows.push([r.maquina, String(r.disponib)])); }
    if (relData.paradas) { rows.push(["Motivo", "Minutos", "Ocorrências"]); relData.paradas.forEach(r => rows.push([r.motivo, String(r.minutos), String(r.ocorrencias)])); }
    if (relData.refugo) { rows.push(["Tipo Defeito", "Quantidade"]); relData.refugo.forEach(r => rows.push([r.tipo, String(r.quantidade)])); }
    const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `relatorio_${relatorio}_${dataInicio}_${dataFim}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success("Relatório exportado.");
  }

  const vazio = !!relData && ((relData.producaoDiaria?.length === 0) || (relData.eficiencia?.length === 0) || (relData.paradas?.length === 0) || (relData.refugo?.length === 0));
  const atalhos = [{ l: "7 dias", n: 6 }, { l: "15 dias", n: 14 }, { l: "30 dias", n: 29 }, { l: "90 dias", n: 89 }];
  const listaBarras = (itens: { nome: string; v: number; extra?: string }[], cor: string, fmt: (v: number) => string) => {
    const max = itens[0]?.v || 1;
    return (
      <ul className="space-y-3">
        {itens.map(i => (
          <li key={i.nome} className="text-sm">
            <div className="flex justify-between gap-2"><span className="truncate">{i.nome}</span>
              <span className="shrink-0 tabular-nums"><strong>{fmt(i.v)}</strong>{i.extra && <span className="text-xs text-muted-foreground"> · {i.extra}</span>}</span></div>
            <div className="mt-1 h-2 rounded-full bg-muted overflow-hidden"><div className={cn("h-full rounded-full", cor)} style={{ width: `${(i.v / max) * 100}%` }} /></div>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Período */}
      <section className="rounded-2xl border bg-card p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <Campo label="De"><Input type="date" value={dataInicio} max={dataFim} onChange={e => e.target.value && setDataInicio(e.target.value)} className="h-11" /></Campo>
          <Campo label="Até"><Input type="date" value={dataFim} min={dataInicio} onChange={e => e.target.value && setDataFim(e.target.value)} className="h-11" /></Campo>
        </div>
        <div className="flex flex-wrap gap-2">
          {atalhos.map(a => (
            <Button key={a.l} size="sm" variant={dataInicio === diasAtras(a.n) && dataFim === hojeISO() ? "secondary" : "outline"} className="h-9"
              onClick={() => { setDataInicio(diasAtras(a.n)); setDataFim(hojeISO()); }}>{a.l}</Button>
          ))}
        </div>
      </section>

      {/* Tipos */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {RELATORIOS.map(r => (
          <button key={r.id} type="button" onClick={() => gerarRelatorio(r.id)} aria-pressed={relatorio === r.id}
            className={cn("rounded-2xl border bg-card p-3.5 text-left transition hover:border-primary/40",
              relatorio === r.id && "border-primary ring-1 ring-primary/30 bg-primary/5")}>
            <r.Icon className={cn("h-5 w-5 mb-1.5", relatorio === r.id ? "text-primary" : "text-muted-foreground")} />
            <p className="font-semibold text-sm">{r.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{r.descricao}</p>
          </button>
        ))}
      </div>

      {/* Resultado */}
      <section className="rounded-2xl border bg-card">
        <div className="px-4 py-3 border-b flex items-center gap-2">
          <FileBarChart2 className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm flex-1">{RELATORIOS.find(r => r.id === relatorio)?.label}</h3>
          <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={exportarCSV} disabled={!relData || vazio}><Download className="h-4 w-4" />CSV</Button>
        </div>
        <div className="p-4">
          {loading ? <Carregando texto="Gerando relatório..." /> : !relData ? (
            <Vazio Icon={FileBarChart2} titulo="Escolha um relatório" />
          ) : vazio ? (
            <Vazio Icon={FileBarChart2} titulo="Nenhum dado no período" dica="Amplie o período ou escolha outro relatório." />
          ) : (
            <>
              {relData.producaoDiaria && (
                <>
                  <p className="mb-2 text-sm text-muted-foreground">Total: <strong className="text-foreground">{fmtInt(relData.producaoDiaria.reduce((s, d) => s + d.producao, 0))} peças</strong> · média {fmtInt(relData.producaoDiaria.reduce((s, d) => s + d.producao, 0) / relData.producaoDiaria.length)}/dia</p>
                  <div className="h-[260px] -ml-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={relData.producaoDiaria} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={gradeCor} vertical={false} />
                        <XAxis dataKey="dia" tick={eixoTick} axisLine={false} tickLine={false} minTickGap={8} />
                        <YAxis tick={eixoTick} axisLine={false} tickLine={false} width={44} />
                        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "hsl(var(--muted))" }} formatter={(v: number) => [`${fmtInt(v)} pç`, "Produzido"]} />
                        <Bar dataKey="producao" name="Peças" fill={COR.primaria} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
              {relData.eficiencia && listaBarras(relData.eficiencia.map(e => ({ nome: e.maquina, v: e.disponib })), "bg-green-500", v => `${v}%`)}
              {relData.paradas && listaBarras(relData.paradas.map(p => ({ nome: p.motivo, v: p.minutos, extra: `${p.ocorrencias}×` })), "bg-amber-500", v => fmtHorasCurto(v / 60))}
              {relData.refugo && listaBarras(relData.refugo.map(r => ({ nome: r.tipo, v: r.quantidade })), "bg-red-500", v => `${fmtInt(v)} pç`)}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
