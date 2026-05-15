/**
 * ParadasPanel — Controle de Paradas Industriais
 * Registro, motivos, cronômetro automático, planejadas/não planejadas, indicadores
 */

import { useState, useEffect, useRef } from "react";
import { Plus, X, OctagonPause, Play, Clock, AlertTriangle, CheckCircle2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";

// ── Tipos ──────────────────────────────────────────────────────────────────────

type TipoParada = "planejada" | "nao_planejada";

interface Parada {
  id: string;
  maquina: string;
  motivo: string;
  tipo: TipoParada;
  inicio: Date;
  fim?: Date;
  duracao?: number; // minutos
  operador: string;
  observacoes?: string;
}

const MOTIVOS_PARADA = [
  "Manutenção Preventiva", "Manutenção Corretiva", "Falta de Material",
  "Setup / Troca de Ferramenta", "Falta de Operador", "Energia Elétrica",
  "Problema de Qualidade", "Reunião / Treinamento", "Refeição/Descanso", "Outro",
];

const CORES_MOTIVOS = ["#3b82f6", "#ef4444", "#f59e0b", "#8b5cf6", "#06b6d4", "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16"];

const MOCK_PARADAS: Parada[] = [
  { id: "1", maquina: "TORNO-01", motivo: "Manutenção Corretiva", tipo: "nao_planejada",
    inicio: new Date(Date.now() - 45 * 60000), operador: "João Silva", observacoes: "Rolamento danificado" },
  { id: "2", maquina: "CNC-01", motivo: "Setup / Troca de Ferramenta", tipo: "planejada",
    inicio: new Date(Date.now() - 120 * 60000), fim: new Date(Date.now() - 90 * 60000), duracao: 30, operador: "Maria Santos" },
  { id: "3", maquina: "TORNO-02", motivo: "Falta de Material", tipo: "nao_planejada",
    inicio: new Date(Date.now() - 200 * 60000), fim: new Date(Date.now() - 180 * 60000), duracao: 20, operador: "Carlos Lima" },
];

// ── Cronômetro ────────────────────────────────────────────────────────────────

function useCronometro(inicio?: Date) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!inicio) return;
    const update = () => setElapsed(Math.floor((Date.now() - inicio.getTime()) / 1000));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [inicio]);
  return elapsed;
}

function formatTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}h ${m.toString().padStart(2, "0")}m`
    : `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

// ── Card Parada ───────────────────────────────────────────────────────────────

function ParadaCard({ parada, onConcluir }: { parada: Parada; onConcluir: (id: string) => void }) {
  const elapsed = useCronometro(!parada.fim ? parada.inicio : undefined);
  const isAtiva = !parada.fim;

  return (
    <div className={cn(
      "rounded-2xl border p-4 space-y-3 transition-all",
      isAtiva && parada.tipo === "nao_planejada" ? "bg-red-500/5 border-red-500/20" :
      isAtiva ? "bg-amber-500/5 border-amber-500/20" : "bg-card/60 border-border/40 opacity-75"
    )}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-primary">{parada.maquina}</span>
            <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full",
              parada.tipo === "planejada" ? "bg-blue-500/10 text-blue-500" : "bg-red-500/10 text-red-500")}>
              {parada.tipo === "planejada" ? "Planejada" : "Não Planejada"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{parada.motivo}</p>
        </div>
        {isAtiva ? (
          <div className="flex flex-col items-end">
            <span className="text-red-500 font-bold text-lg tabular-nums">{formatTime(elapsed)}</span>
            <span className="text-[9px] text-muted-foreground">em andamento</span>
          </div>
        ) : (
          <div className="flex flex-col items-end">
            <span className="text-muted-foreground font-medium text-sm tabular-nums">{parada.duracao}min</span>
            <span className="text-[9px] text-muted-foreground">concluída</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {parada.inicio.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          {parada.fim && ` → ${parada.fim.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`}
        </span>
        <span>{parada.operador}</span>
      </div>

      {parada.observacoes && (
        <p className="text-[11px] text-muted-foreground bg-muted/30 rounded-lg px-3 py-2">{parada.observacoes}</p>
      )}

      {isAtiva && (
        <Button size="sm" variant="outline"
          className="w-full rounded-xl text-xs h-8 border-green-500/30 text-green-600 hover:bg-green-500/10"
          onClick={() => onConcluir(parada.id)}
        >
          <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
          Registrar Retomada
        </Button>
      )}
    </div>
  );
}

// ── Modal Nova Parada ─────────────────────────────────────────────────────────

function NovaParadaModal({ open, onClose, onSaved }: {
  open: boolean; onClose: () => void; onSaved: (p: Parada) => void;
}) {
  const [form, setForm] = useState({ maquina: "", motivo: "", tipo: "nao_planejada" as TipoParada, operador: "", observacoes: "" });
  if (!open) return null;

  function save() {
    if (!form.maquina || !form.motivo || !form.operador) { toast.error("Preencha os campos obrigatórios"); return; }
    onSaved({ id: Date.now().toString(), maquina: form.maquina, motivo: form.motivo, tipo: form.tipo, inicio: new Date(), operador: form.operador, observacoes: form.observacoes || undefined });
    toast.success("Parada registrada!");
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-background border rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
          <div className="flex items-center gap-2">
            <OctagonPause className="h-4 w-4 text-red-500" />
            <p className="text-sm font-semibold">Registrar Parada</p>
          </div>
          <button onClick={onClose} className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-muted/40">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Máquina *</label>
              <Input placeholder="CNC-01" value={form.maquina} onChange={e => setForm(f => ({ ...f, maquina: e.target.value }))} className="rounded-xl" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Tipo *</label>
              <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as TipoParada }))}
                className="w-full h-10 rounded-xl border border-input bg-card px-3 text-sm">
                <option value="nao_planejada">Não Planejada</option>
                <option value="planejada">Planejada</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Motivo *</label>
            <select value={form.motivo} onChange={e => setForm(f => ({ ...f, motivo: e.target.value }))}
              className="w-full h-10 rounded-xl border border-input bg-card px-3 text-sm">
              <option value="">Selecione o motivo</option>
              {MOTIVOS_PARADA.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Operador *</label>
            <Input placeholder="Nome do operador" value={form.operador} onChange={e => setForm(f => ({ ...f, operador: e.target.value }))} className="rounded-xl" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Observações</label>
            <Input placeholder="Descrição adicional..." value={form.observacoes} onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))} className="rounded-xl" />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-border/40 flex gap-3">
          <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1 rounded-xl bg-red-500 hover:bg-red-600" onClick={save}>Iniciar Parada</Button>
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function ParadasPanel() {
  const [paradas, setParadas] = useState<Parada[]>(MOCK_PARADAS);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  const filtered = paradas.filter(p => {
    const q = search.toLowerCase();
    return p.maquina.toLowerCase().includes(q) || p.motivo.toLowerCase().includes(q) || p.operador.toLowerCase().includes(q);
  });

  function concluir(id: string) {
    setParadas(prev => prev.map(p => {
      if (p.id !== id || p.fim) return p;
      const fim = new Date();
      const duracao = Math.round((fim.getTime() - p.inicio.getTime()) / 60000);
      return { ...p, fim, duracao };
    }));
    toast.success("Parada encerrada!");
  }

  // Dados para gráfico de motivos
  const motivoCounts = MOTIVOS_PARADA.map((m, i) => ({
    name: m.length > 20 ? m.substring(0, 18) + "…" : m,
    value: paradas.filter(p => p.motivo === m && p.fim).length,
    color: CORES_MOTIVOS[i],
  })).filter(m => m.value > 0);

  const ativas = paradas.filter(p => !p.fim).length;
  const totalMinutos = paradas.filter(p => p.duracao).reduce((s, p) => s + (p.duracao || 0), 0);

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Paradas Ativas", value: ativas, color: ativas > 0 ? "text-red-500" : "text-green-500", bg: ativas > 0 ? "bg-red-500/10" : "bg-green-500/10", border: ativas > 0 ? "border-red-500/20" : "border-green-500/20" },
          { label: "Total Hoje", value: paradas.length, color: "text-primary", bg: "bg-primary/10", border: "border-primary/20" },
          { label: "Tempo Perdido", value: `${totalMinutos}min`, color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20" },
        ].map(item => (
          <div key={item.label} className={cn("rounded-2xl border p-3 text-center", item.bg, item.border)}>
            <p className={cn("text-xl font-bold tabular-nums", item.color)}>{item.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{item.label}</p>
          </div>
        ))}
      </div>

      {/* Gráfico de motivos */}
      {motivoCounts.length > 0 && (
        <div className="rounded-2xl border bg-card/60 p-4">
          <h3 className="text-sm font-semibold mb-3">Paradas por Motivo (Concluídas)</h3>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={motivoCounts} dataKey="value" cx="35%" cy="50%" outerRadius={70} label={false}>
                  {motivoCounts.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Legend layout="vertical" align="right" verticalAlign="middle"
                  formatter={(value) => <span className="text-[10px] text-muted-foreground">{value}</span>}
                />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Filtros e nova parada */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Buscar máquina ou motivo..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 rounded-xl text-sm h-9" />
        </div>
        <Button size="sm" className="h-9 rounded-xl bg-red-500 hover:bg-red-600 shrink-0" onClick={() => setModalOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Registrar Parada
        </Button>
      </div>

      {/* Lista */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="py-12 text-center">
            <CheckCircle2 className="h-8 w-8 text-green-500/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Nenhuma parada encontrada</p>
          </div>
        ) : (
          filtered.map(p => <ParadaCard key={p.id} parada={p} onConcluir={concluir} />)
        )}
      </div>

      <NovaParadaModal open={modalOpen} onClose={() => setModalOpen(false)} onSaved={p => setParadas(prev => [p, ...prev])} />
    </div>
  );
}
