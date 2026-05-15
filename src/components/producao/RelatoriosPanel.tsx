/**
 * RelatoriosPanel — Relatórios Industriais
 * Produção diária/mensal, eficiência, paradas, refugo, exportação PDF/Excel, filtros avançados
 */

import { useState } from "react";
import { FileBarChart2, Download, Filter, Calendar, FileText, FileSpreadsheet, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, Cell,
} from "recharts";

// ── Mock data ──────────────────────────────────────────────────────────────────

const producaoDiaria = Array.from({ length: 14 }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - (13 - i));
  return {
    dia: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    produzido: Math.floor(Math.random() * 800 + 1000),
    meta: 1200,
    refugo: Math.floor(Math.random() * 30 + 5),
  };
});

const eficienciaMensal = [
  { mes: "Jul", oee: 72, disponib: 88, desempenho: 84, qualidade: 97 },
  { mes: "Ago", oee: 75, disponib: 90, desempenho: 85, qualidade: 98 },
  { mes: "Set", oee: 68, disponib: 85, desempenho: 82, qualidade: 97 },
  { mes: "Out", oee: 79, disponib: 92, desempenho: 88, qualidade: 97 },
  { mes: "Nov", oee: 81, disponib: 93, desempenho: 89, qualidade: 98 },
  { mes: "Dez", oee: 77, disponib: 91, desempenho: 86, qualidade: 98 },
  { mes: "Jan", oee: 83, disponib: 94, desempenho: 90, qualidade: 98 },
];

const paradasPorMotivo = [
  { motivo: "Manutenção Corretiva", minutos: 245, ocorrencias: 8 },
  { motivo: "Setup / Ferramental", minutos: 180, ocorrencias: 12 },
  { motivo: "Falta de Material", minutos: 95, ocorrencias: 3 },
  { motivo: "Manutenção Preventiva", minutos: 120, ocorrencias: 4 },
  { motivo: "Outros", minutos: 60, ocorrencias: 5 },
];

const consumoMP = [
  { material: "Aço Inox 316L", consumo: 42.5, unidade: "m" },
  { material: "Alumínio 6061", consumo: 18.2, unidade: "m" },
  { material: "Latão C360", consumo: 12.8, unidade: "m" },
  { material: "Óleo Corte", consumo: 35, unidade: "L" },
];

// ── Tipos de relatório ────────────────────────────────────────────────────────

type RelatorioTipo = "producao_diaria" | "producao_mensal" | "eficiencia" | "paradas" | "refugo" | "consumo_mp";

const RELATORIOS: { id: RelatorioTipo; label: string; descricao: string; icon: React.ElementType; color: string; bg: string }[] = [
  { id: "producao_diaria", label: "Produção Diária", descricao: "Meta × realizado por dia e turno", icon: Calendar, color: "text-blue-500", bg: "bg-blue-500/10" },
  { id: "producao_mensal", label: "Produção Mensal", descricao: "Consolidado mensal por produto e máquina", icon: FileBarChart2, color: "text-green-500", bg: "bg-green-500/10" },
  { id: "eficiencia", label: "Eficiência / OEE", descricao: "OEE, disponibilidade, desempenho e qualidade", icon: Filter, color: "text-purple-500", bg: "bg-purple-500/10" },
  { id: "paradas", label: "Análise de Paradas", descricao: "Pareto de paradas, tempo perdido e motivos", icon: FileText, color: "text-red-500", bg: "bg-red-500/10" },
  { id: "refugo", label: "Refugo e Qualidade", descricao: "Índice de refugo, defeitos e destinações", icon: FileText, color: "text-orange-500", bg: "bg-orange-500/10" },
  { id: "consumo_mp", label: "Consumo de MP", descricao: "Consumo de matéria-prima por período e produto", icon: FileSpreadsheet, color: "text-teal-500", bg: "bg-teal-500/10" },
];

// ── Main ──────────────────────────────────────────────────────────────────────

export function RelatoriosPanel({ isAdmin: _isAdmin }: { isAdmin: boolean }) {
  const [relatorio, setRelatorio] = useState<RelatorioTipo | null>(null);
  const [dataInicio, setDataInicio] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 14);
    return d.toISOString().split("T")[0];
  });
  const [dataFim, setDataFim] = useState(() => new Date().toISOString().split("T")[0]);
  const [filtroMaquina, setFiltroMaquina] = useState("todas");
  const [filtroProduto, setFiltroProduto] = useState("todos");

  function exportar(formato: "pdf" | "excel") {
    toast.success(`Exportando relatório em ${formato.toUpperCase()}… (em breve conectará ao backend)`);
  }

  if (!relatorio) {
    return (
      <div className="space-y-4 animate-in fade-in duration-200">
        <div className="rounded-2xl border bg-card/60 p-4">
          <div className="flex items-center gap-2 mb-1">
            <FileBarChart2 className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-sm">Central de Relatórios</h2>
          </div>
          <p className="text-xs text-muted-foreground">Selecione o tipo de relatório para visualizar e exportar</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {RELATORIOS.map(r => (
            <button key={r.id} onClick={() => setRelatorio(r.id)}
              className={cn("rounded-2xl border p-4 text-left flex items-start gap-3 transition-all hover:shadow-sm active:scale-[0.99]", r.bg, "border-current/20")}>
              <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center shrink-0", r.bg)}>
                <r.icon className={cn("h-4 w-4", r.color)} />
              </div>
              <div>
                <p className={cn("font-semibold text-sm", r.color)}>{r.label}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{r.descricao}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const rel = RELATORIOS.find(r => r.id === relatorio)!;

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Header do relatório */}
      <div className="flex items-center justify-between">
        <button onClick={() => setRelatorio(null)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          ← <span>Relatórios</span>
        </button>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-8 rounded-xl text-xs gap-1.5" onClick={() => exportar("excel")}>
            <FileSpreadsheet className="h-3.5 w-3.5 text-green-600" /> Excel
          </Button>
          <Button size="sm" variant="outline" className="h-8 rounded-xl text-xs gap-1.5" onClick={() => exportar("pdf")}>
            <FileText className="h-3.5 w-3.5 text-red-500" /> PDF
          </Button>
        </div>
      </div>

      <div className={cn("rounded-2xl border p-4", rel.bg)}>
        <div className="flex items-center gap-2">
          <rel.icon className={cn("h-4 w-4", rel.color)} />
          <h2 className={cn("font-semibold text-sm", rel.color)}>{rel.label}</h2>
        </div>
      </div>

      {/* Filtros */}
      <div className="rounded-2xl border bg-card/60 p-4 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Filtros</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-muted-foreground mb-1 block">Data Início</label>
            <Input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} className="rounded-xl text-sm h-9" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground mb-1 block">Data Fim</label>
            <Input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)} className="rounded-xl text-sm h-9" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-muted-foreground mb-1 block">Máquina</label>
            <select value={filtroMaquina} onChange={e => setFiltroMaquina(e.target.value)}
              className="w-full h-9 rounded-xl border border-input bg-card px-3 text-sm">
              <option value="todas">Todas</option>
              {["CNC-01", "CNC-02", "TORNO-01", "TORNO-02", "FRESA-01"].map(m => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground mb-1 block">Produto</label>
            <select value={filtroProduto} onChange={e => setFiltroProduto(e.target.value)}
              className="w-full h-9 rounded-xl border border-input bg-card px-3 text-sm">
              <option value="todos">Todos</option>
              {["PÇ-001 Eixo", "PÇ-002 Flange", "PÇ-003 Tampa"].map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Conteúdo do relatório */}

      {/* Produção Diária */}
      {relatorio === "producao_diaria" && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Total Produzido", value: producaoDiaria.reduce((s, d) => s + d.produzido, 0).toLocaleString("pt-BR") + " pç", color: "text-green-500" },
              { label: "Atingimento Médio", value: `${Math.round(producaoDiaria.reduce((s, d) => s + (d.produzido / d.meta) * 100, 0) / producaoDiaria.length)}%`, color: "text-blue-500" },
              { label: "Total Refugo", value: producaoDiaria.reduce((s, d) => s + d.refugo, 0) + " pç", color: "text-red-500" },
            ].map(i => (
              <div key={i.label} className="rounded-2xl border bg-card/60 p-3 text-center">
                <p className={cn("text-lg font-bold tabular-nums", i.color)}>{i.value}</p>
                <p className="text-[10px] text-muted-foreground">{i.label}</p>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border bg-card/60 p-4">
            <h3 className="text-sm font-semibold mb-3">Meta × Realizado (últimos 14 dias)</h3>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={producaoDiaria} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
                  <XAxis dataKey="dia" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 9 }} />
                  <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="meta" name="Meta" fill="var(--muted)" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="produzido" name="Produzido" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          {/* Tabela */}
          <div className="rounded-2xl border bg-card/60 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    {["Data", "Meta", "Produzido", "Atingimento", "Refugo"].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {producaoDiaria.map((d, i) => {
                    const ating = Math.round((d.produzido / d.meta) * 100);
                    return (
                      <tr key={i} className="hover:bg-muted/10 transition-colors">
                        <td className="px-4 py-2.5 text-xs font-medium">{d.dia}</td>
                        <td className="px-4 py-2.5 text-xs tabular-nums text-muted-foreground">{d.meta.toLocaleString("pt-BR")}</td>
                        <td className="px-4 py-2.5 text-xs tabular-nums font-medium">{d.produzido.toLocaleString("pt-BR")}</td>
                        <td className="px-4 py-2.5">
                          <span className={cn("text-xs font-bold tabular-nums", ating >= 100 ? "text-green-500" : ating >= 90 ? "text-blue-500" : "text-amber-500")}>
                            {ating}%
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs tabular-nums text-red-500">{d.refugo}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* OEE / Eficiência */}
      {relatorio === "eficiencia" && (
        <div className="space-y-4">
          <div className="rounded-2xl border bg-card/60 p-4">
            <h3 className="text-sm font-semibold mb-3">OEE Mensal</h3>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={eficienciaMensal} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
                  <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} domain={[60, 100]} unit="%" />
                  <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 11 }} formatter={(v) => [`${v}%`]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="oee" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name="OEE" />
                  <Line type="monotone" dataKey="disponib" stroke="#22c55e" strokeWidth={1.5} dot={{ r: 2 }} name="Disponibilidade" strokeDasharray="4 2" />
                  <Line type="monotone" dataKey="desempenho" stroke="#f59e0b" strokeWidth={1.5} dot={{ r: 2 }} name="Desempenho" strokeDasharray="4 2" />
                  <Line type="monotone" dataKey="qualidade" stroke="#8b5cf6" strokeWidth={1.5} dot={{ r: 2 }} name="Qualidade" strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Paradas */}
      {relatorio === "paradas" && (
        <div className="space-y-4">
          <div className="rounded-2xl border bg-card/60 p-4">
            <h3 className="text-sm font-semibold mb-3">Pareto de Paradas (minutos)</h3>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={paradasPorMotivo.sort((a, b) => b.minutos - a.minutos)} layout="vertical" margin={{ top: 0, right: 20, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.4} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 9 }} />
                  <YAxis type="category" dataKey="motivo" tick={{ fontSize: 9 }} width={110} />
                  <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 11 }} formatter={(v) => [`${v} min`]} />
                  <Bar dataKey="minutos" fill="#ef4444" radius={[0, 4, 4, 0]} name="Minutos" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-2xl border bg-card/60 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-muted/20">
                  {["Motivo", "Ocorrências", "Tempo Total", "Média/Ocorrência"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {paradasPorMotivo.map((p, i) => (
                  <tr key={i} className="hover:bg-muted/10 transition-colors">
                    <td className="px-4 py-2.5 text-xs font-medium">{p.motivo}</td>
                    <td className="px-4 py-2.5 text-xs tabular-nums">{p.ocorrencias}</td>
                    <td className="px-4 py-2.5 text-xs tabular-nums">{p.minutos}min</td>
                    <td className="px-4 py-2.5 text-xs tabular-nums">{Math.round(p.minutos / p.ocorrencias)}min</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Consumo MP */}
      {relatorio === "consumo_mp" && (
        <div className="rounded-2xl border bg-card/60 overflow-hidden">
          <div className="px-4 py-3 border-b border-border/40 bg-muted/20">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Consumo por Material</p>
          </div>
          <div className="divide-y divide-border/30">
            {consumoMP.map((c, i) => (
              <div key={i} className="px-4 py-3 flex items-center justify-between">
                <p className="text-sm font-medium">{c.material}</p>
                <p className="text-sm font-bold tabular-nums text-primary">{c.consumo} {c.unidade}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Placeholder para outros relatórios */}
      {(relatorio === "producao_mensal" || relatorio === "refugo") && (
        <div className="rounded-2xl border bg-card/60 p-8 text-center">
          <FileBarChart2 className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground">Relatório em desenvolvimento</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Os dados serão carregados do backend Supabase</p>
          <Button variant="outline" className="mt-4 rounded-xl text-xs" onClick={() => exportar("pdf")}>
            <Download className="h-3.5 w-3.5 mr-1.5" /> Exportar quando disponível
          </Button>
        </div>
      )}
    </div>
  );
}
