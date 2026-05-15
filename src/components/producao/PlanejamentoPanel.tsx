/**
 * PlanejamentoPanel — Planejamento de Produção
 * Ordens de produção, planejamento por máquina, carga, turnos, previsão
 */

import { useState } from "react";
import { Plus, X, CalendarClock, Factory, Layers, ChevronDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

// ── Tipos ──────────────────────────────────────────────────────────────────────

type OPStatus = "planejada" | "em_producao" | "concluida" | "cancelada";
type Prioridade = "baixa" | "normal" | "alta" | "urgente";

interface OrdemPlanejamento {
  id: string;
  numero: string;
  produto: string;
  maquina: string;
  turno: string;
  quantidade: number;
  dataInicio: string;
  dataFim: string;
  status: OPStatus;
  prioridade: Prioridade;
  capacidade: number; // % da capacidade
}

const STATUS_CFG: Record<OPStatus, { label: string; color: string; bg: string }> = {
  planejada:   { label: "Planejada",    color: "text-blue-500",       bg: "bg-blue-500/10" },
  em_producao: { label: "Em Produção",  color: "text-green-500",      bg: "bg-green-500/10" },
  concluida:   { label: "Concluída",    color: "text-primary",        bg: "bg-primary/10" },
  cancelada:   { label: "Cancelada",    color: "text-destructive",    bg: "bg-destructive/10" },
};

const PRIO_CFG: Record<Prioridade, { label: string; color: string }> = {
  baixa:   { label: "Baixa",   color: "text-muted-foreground" },
  normal:  { label: "Normal",  color: "text-blue-500" },
  alta:    { label: "Alta",    color: "text-amber-500" },
  urgente: { label: "Urgente", color: "text-destructive" },
};

const MOCK_OPS: OrdemPlanejamento[] = [
  { id: "1", numero: "OP-2025-001", produto: "PÇ-001 Eixo", maquina: "CNC-01", turno: "1º Turno",
    quantidade: 500, dataInicio: "2025-01-15", dataFim: "2025-01-17", status: "em_producao", prioridade: "alta", capacidade: 85 },
  { id: "2", numero: "OP-2025-002", produto: "PÇ-002 Flange", maquina: "TORNO-01", turno: "2º Turno",
    quantidade: 300, dataInicio: "2025-01-16", dataFim: "2025-01-18", status: "planejada", prioridade: "normal", capacidade: 70 },
  { id: "3", numero: "OP-2025-003", produto: "PÇ-003 Tampa", maquina: "CNC-02", turno: "1º Turno",
    quantidade: 800, dataInicio: "2025-01-14", dataFim: "2025-01-16", status: "concluida", prioridade: "urgente", capacidade: 95 },
  { id: "4", numero: "OP-2025-004", produto: "PÇ-004 Bucha", maquina: "FRESA-01", turno: "3º Turno",
    quantidade: 200, dataInicio: "2025-01-18", dataFim: "2025-01-20", status: "planejada", prioridade: "baixa", capacidade: 45 },
];

const cargaData = [
  { maquina: "CNC-01", carga: 85 },
  { maquina: "CNC-02", carga: 60 },
  { maquina: "TORNO-01", carga: 70 },
  { maquina: "TORNO-02", carga: 30 },
  { maquina: "FRESA-01", carga: 45 },
];

// ── Modal Nova OP ─────────────────────────────────────────────────────────────

function NovaOPModal({ open, onClose, onSaved }: {
  open: boolean; onClose: () => void; onSaved: (op: OrdemPlanejamento) => void;
}) {
  const [form, setForm] = useState({
    produto: "", maquina: "", turno: "1º Turno", quantidade: "",
    dataInicio: "", dataFim: "", prioridade: "normal" as Prioridade,
  });

  if (!open) return null;

  function save() {
    if (!form.produto || !form.maquina || !form.quantidade || !form.dataInicio || !form.dataFim) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }
    const nova: OrdemPlanejamento = {
      id: Date.now().toString(),
      numero: `OP-${Date.now()}`,
      produto: form.produto, maquina: form.maquina, turno: form.turno,
      quantidade: Number(form.quantidade), dataInicio: form.dataInicio, dataFim: form.dataFim,
      status: "planejada", prioridade: form.prioridade, capacidade: Math.floor(Math.random() * 40 + 50),
    };
    onSaved(nova);
    toast.success("Ordem de produção criada!");
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-background border rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
          <p className="text-sm font-semibold">Nova Ordem de Produção</p>
          <button onClick={onClose} className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-muted/40">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3 max-h-[65vh] overflow-y-auto">
          {[
            { label: "Produto *", key: "produto", placeholder: "Ex: PÇ-001 Eixo" },
            { label: "Máquina *", key: "maquina", placeholder: "Ex: CNC-01" },
            { label: "Quantidade *", key: "quantidade", placeholder: "0", type: "number" },
          ].map(f => (
            <div key={f.key}>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">{f.label}</label>
              <Input type={f.type || "text"} placeholder={f.placeholder}
                value={(form as Record<string, string>)[f.key]}
                onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                className="rounded-xl"
              />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Turno</label>
              <select value={form.turno} onChange={e => setForm(f => ({ ...f, turno: e.target.value }))}
                className="w-full h-10 rounded-xl border border-input bg-card px-3 text-sm">
                {["1º Turno", "2º Turno", "3º Turno"].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Prioridade</label>
              <select value={form.prioridade} onChange={e => setForm(f => ({ ...f, prioridade: e.target.value as Prioridade }))}
                className="w-full h-10 rounded-xl border border-input bg-card px-3 text-sm">
                {(["baixa", "normal", "alta", "urgente"] as Prioridade[]).map(p => <option key={p} value={p}>{PRIO_CFG[p].label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Início *</label>
              <Input type="date" value={form.dataInicio} onChange={e => setForm(f => ({ ...f, dataInicio: e.target.value }))} className="rounded-xl" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Previsão Fim *</label>
              <Input type="date" value={form.dataFim} onChange={e => setForm(f => ({ ...f, dataFim: e.target.value }))} className="rounded-xl" />
            </div>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-border/40 flex gap-3">
          <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1 rounded-xl" onClick={save}>Criar Ordem</Button>
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function PlanejamentoPanel({ isAdmin: _isAdmin }: { isAdmin: boolean }) {
  const [ops, setOps] = useState<OrdemPlanejamento[]>(MOCK_OPS);
  const [search, setSearch] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<string>("todos");
  const [modalOpen, setModalOpen] = useState(false);

  const filtered = ops.filter(op => {
    const q = search.toLowerCase();
    const matchSearch = op.numero.toLowerCase().includes(q) || op.produto.toLowerCase().includes(q) || op.maquina.toLowerCase().includes(q);
    const matchStatus = filtroStatus === "todos" || op.status === filtroStatus;
    return matchSearch && matchStatus;
  });

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Carga por Máquina */}
      <div className="rounded-2xl border bg-card/60 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Layers className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Distribuição de Carga por Máquina</h3>
        </div>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={cargaData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
              <XAxis dataKey="maquina" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} unit="%" />
              <Tooltip
                contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }}
                formatter={(v) => [`${v}%`, "Carga"]}
              />
              <Bar dataKey="carga" radius={[6, 6, 0, 0]}
                fill="none"
                label={false}
              >
                {cargaData.map((entry, idx) => (
                  <rect key={idx} fill={entry.carga > 80 ? "#ef4444" : entry.carga > 60 ? "#f59e0b" : "#3b82f6"} />
                ))}
              </Bar>
              <Bar dataKey="carga" radius={[6, 6, 0, 0]}
                fill="#3b82f6"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Filtros e nova OP */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Buscar ordem, produto ou máquina..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="pl-9 rounded-xl text-sm h-9"
          />
        </div>
        <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}
          className="h-9 rounded-xl border border-input bg-card px-3 text-sm">
          <option value="todos">Todos</option>
          {(Object.keys(STATUS_CFG) as OPStatus[]).map(s => (
            <option key={s} value={s}>{STATUS_CFG[s].label}</option>
          ))}
        </select>
        <Button size="sm" className="h-9 rounded-xl shrink-0" onClick={() => setModalOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Nova OP
        </Button>
      </div>

      {/* Lista de OPs */}
      <div className="space-y-3">
        {filtered.map(op => {
          const sc = STATUS_CFG[op.status];
          const pc = PRIO_CFG[op.prioridade];
          return (
            <div key={op.id} className="rounded-2xl border bg-card/60 p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-sm">{op.numero}</p>
                  <p className="text-[11px] text-muted-foreground">{op.produto}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={cn("text-[10px] font-bold", pc.color)}>{pc.label}</span>
                  <Badge className={cn("text-[10px]", sc.color, sc.bg, "border-0")}>
                    {sc.label}
                  </Badge>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {[
                  { label: "Máquina", value: op.maquina },
                  { label: "Turno", value: op.turno },
                  { label: "Quantidade", value: `${op.quantidade.toLocaleString("pt-BR")} pç` },
                  { label: "Período", value: `${op.dataInicio} → ${op.dataFim}` },
                ].map(item => (
                  <div key={item.label}>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{item.label}</p>
                    <p className="text-xs font-medium">{item.value}</p>
                  </div>
                ))}
              </div>
              <div>
                <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                  <span>Capacidade alocada</span>
                  <span>{op.capacidade}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
                  <div
                    className={cn("h-full rounded-full", op.capacidade > 80 ? "bg-red-500" : op.capacidade > 60 ? "bg-amber-500" : "bg-blue-500")}
                    style={{ width: `${op.capacidade}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="py-12 text-center">
            <CalendarClock className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Nenhuma ordem encontrada</p>
          </div>
        )}
      </div>

      <NovaOPModal open={modalOpen} onClose={() => setModalOpen(false)} onSaved={op => setOps(p => [op, ...p])} />
    </div>
  );
}
