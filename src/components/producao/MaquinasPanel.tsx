/**
 * MaquinasPanel — Cadastro e Gestão de Máquinas
 * Status operacional, disponibilidade, histórico de manutenção, setores
 */

import { useState } from "react";
import { Plus, X, Search, Settings2, Wrench, CheckCircle2, AlertTriangle, XCircle, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ── Tipos ──────────────────────────────────────────────────────────────────────

type StatusMaquina = "operando" | "parada" | "manutencao" | "setup";
type SetorMaquina = "usinagem" | "montagem" | "acabamento" | "estamparia" | "soldagem";

interface Maquina {
  id: string;
  codigo: string;
  nome: string;
  setor: SetorMaquina;
  status: StatusMaquina;
  disponibilidade: number; // %
  ultimaManutencao: string;
  proximaManutencao: string;
  horimetro: number;
  fabricante?: string;
  modelo?: string;
}

const STATUS_CFG: Record<StatusMaquina, { label: string; color: string; bg: string; Icon: React.ElementType }> = {
  operando:    { label: "Operando",    color: "text-green-500",      bg: "bg-green-500/10",      Icon: CheckCircle2 },
  parada:      { label: "Parada",      color: "text-red-500",        bg: "bg-red-500/10",        Icon: XCircle },
  manutencao:  { label: "Manutenção",  color: "text-amber-500",      bg: "bg-amber-500/10",      Icon: Wrench },
  setup:       { label: "Setup",       color: "text-blue-500",       bg: "bg-blue-500/10",       Icon: Settings2 },
};

const SETORES: SetorMaquina[] = ["usinagem", "montagem", "acabamento", "estamparia", "soldagem"];
const SETOR_LABEL: Record<SetorMaquina, string> = {
  usinagem: "Usinagem", montagem: "Montagem", acabamento: "Acabamento",
  estamparia: "Estamparia", soldagem: "Soldagem",
};

const MOCK_MAQUINAS: Maquina[] = [
  { id: "1", codigo: "CNC-01", nome: "Centro de Usinagem CNC", setor: "usinagem",
    status: "operando", disponibilidade: 91, ultimaManutencao: "2025-01-05",
    proximaManutencao: "2025-04-05", horimetro: 12450, fabricante: "Romi", modelo: "D800" },
  { id: "2", codigo: "CNC-02", nome: "Centro de Usinagem CNC 2", setor: "usinagem",
    status: "operando", disponibilidade: 85, ultimaManutencao: "2024-12-20",
    proximaManutencao: "2025-03-20", horimetro: 9870, fabricante: "Romi", modelo: "D600" },
  { id: "3", codigo: "TORNO-01", nome: "Torno CNC Paralelo", setor: "usinagem",
    status: "manutencao", disponibilidade: 62, ultimaManutencao: "2025-01-10",
    proximaManutencao: "2025-01-17", horimetro: 18200, fabricante: "Romi", modelo: "C420" },
  { id: "4", codigo: "TORNO-02", nome: "Torno CNC Universal", setor: "usinagem",
    status: "parada", disponibilidade: 40, ultimaManutencao: "2024-11-15",
    proximaManutencao: "2025-02-15", horimetro: 22100 },
  { id: "5", codigo: "FRESA-01", nome: "Fresadora Vertical", setor: "usinagem",
    status: "operando", disponibilidade: 78, ultimaManutencao: "2025-01-08",
    proximaManutencao: "2025-04-08", horimetro: 7650, fabricante: "Induma" },
  { id: "6", codigo: "SOLD-01", nome: "Robô de Soldagem MIG", setor: "soldagem",
    status: "setup", disponibilidade: 88, ultimaManutencao: "2025-01-12",
    proximaManutencao: "2025-07-12", horimetro: 3200, fabricante: "Lincoln Electric" },
];

// ── Modal Nova Máquina ─────────────────────────────────────────────────────────

function NovaMaquinaModal({ open, onClose, onSaved }: {
  open: boolean; onClose: () => void; onSaved: (m: Maquina) => void;
}) {
  const [form, setForm] = useState({
    codigo: "", nome: "", setor: "usinagem" as SetorMaquina,
    fabricante: "", modelo: "",
  });

  if (!open) return null;

  function save() {
    if (!form.codigo || !form.nome) { toast.error("Código e nome são obrigatórios"); return; }
    const nova: Maquina = {
      id: Date.now().toString(), codigo: form.codigo, nome: form.nome,
      setor: form.setor, status: "parada", disponibilidade: 0,
      ultimaManutencao: new Date().toISOString().split("T")[0],
      proximaManutencao: "", horimetro: 0,
      fabricante: form.fabricante || undefined, modelo: form.modelo || undefined,
    };
    onSaved(nova);
    toast.success("Máquina cadastrada!");
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-background border rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
          <p className="text-sm font-semibold">Nova Máquina</p>
          <button onClick={onClose} className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-muted/40">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Código *</label>
              <Input placeholder="CNC-03" value={form.codigo} onChange={e => setForm(f => ({ ...f, codigo: e.target.value }))} className="rounded-xl" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Setor</label>
              <select value={form.setor} onChange={e => setForm(f => ({ ...f, setor: e.target.value as SetorMaquina }))}
                className="w-full h-10 rounded-xl border border-input bg-card px-3 text-sm">
                {SETORES.map(s => <option key={s} value={s}>{SETOR_LABEL[s]}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Nome / Descrição *</label>
            <Input placeholder="Ex: Centro de Usinagem Vertical" value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} className="rounded-xl" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Fabricante</label>
              <Input placeholder="Ex: Romi" value={form.fabricante} onChange={e => setForm(f => ({ ...f, fabricante: e.target.value }))} className="rounded-xl" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Modelo</label>
              <Input placeholder="Ex: D800" value={form.modelo} onChange={e => setForm(f => ({ ...f, modelo: e.target.value }))} className="rounded-xl" />
            </div>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-border/40 flex gap-3">
          <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1 rounded-xl" onClick={save}>Cadastrar</Button>
        </div>
      </div>
    </div>
  );
}

// ── Card Máquina ──────────────────────────────────────────────────────────────

function MaquinaCard({ maquina, isAdmin, onChangeStatus }: {
  maquina: Maquina; isAdmin: boolean; onChangeStatus: (id: string, s: StatusMaquina) => void;
}) {
  const sc = STATUS_CFG[maquina.status];
  const [showHistory, setShowHistory] = useState(false);

  return (
    <div className="rounded-2xl border bg-card/60 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-primary">{maquina.codigo}</span>
            <span className="text-[10px] text-muted-foreground bg-muted/40 px-2 py-0.5 rounded-full">
              {SETOR_LABEL[maquina.setor]}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{maquina.nome}</p>
        </div>
        <div className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-medium", sc.color, sc.bg)}>
          <sc.Icon className="h-3 w-3" />
          {sc.label}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <div>
          <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Disponibilidade</p>
          <div className="flex items-center gap-2 mt-0.5">
            <div className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
              <div
                className={cn("h-full rounded-full",
                  maquina.disponibilidade >= 80 ? "bg-green-500" : maquina.disponibilidade >= 60 ? "bg-amber-500" : "bg-red-500"
                )}
                style={{ width: `${maquina.disponibilidade}%` }}
              />
            </div>
            <span className="text-xs font-bold tabular-nums">{maquina.disponibilidade}%</span>
          </div>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Horímetro</p>
          <p className="text-xs font-medium mt-0.5">{maquina.horimetro.toLocaleString("pt-BR")}h</p>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Última Manutenção</p>
          <p className="text-xs font-medium mt-0.5">{maquina.ultimaManutencao}</p>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Próxima Manutenção</p>
          <p className={cn("text-xs font-medium mt-0.5", !maquina.proximaManutencao && "text-muted-foreground/50")}>
            {maquina.proximaManutencao || "Não agendada"}
          </p>
        </div>
        {maquina.fabricante && (
          <div className="col-span-2">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Fabricante / Modelo</p>
            <p className="text-xs font-medium mt-0.5">{maquina.fabricante}{maquina.modelo ? ` · ${maquina.modelo}` : ""}</p>
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="flex gap-2 pt-1">
          {(Object.keys(STATUS_CFG) as StatusMaquina[]).map(s => (
            <button
              key={s}
              onClick={() => onChangeStatus(maquina.id, s)}
              disabled={maquina.status === s}
              className={cn(
                "flex-1 h-7 rounded-lg text-[10px] font-medium transition-all",
                maquina.status === s
                  ? cn(STATUS_CFG[s].color, STATUS_CFG[s].bg, "opacity-100")
                  : "bg-muted/30 text-muted-foreground hover:bg-muted/60"
              )}
            >
              {STATUS_CFG[s].label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function MaquinasPanel({ isAdmin }: { isAdmin: boolean }) {
  const [maquinas, setMaquinas] = useState<Maquina[]>(MOCK_MAQUINAS);
  const [search, setSearch] = useState("");
  const [filtroSetor, setFiltroSetor] = useState<string>("todos");
  const [filtroStatus, setFiltroStatus] = useState<string>("todos");
  const [modalOpen, setModalOpen] = useState(false);

  const filtered = maquinas.filter(m => {
    const q = search.toLowerCase();
    const matchSearch = m.codigo.toLowerCase().includes(q) || m.nome.toLowerCase().includes(q);
    const matchSetor = filtroSetor === "todos" || m.setor === filtroSetor;
    const matchStatus = filtroStatus === "todos" || m.status === filtroStatus;
    return matchSearch && matchSetor && matchStatus;
  });

  function changeStatus(id: string, status: StatusMaquina) {
    setMaquinas(prev => prev.map(m => m.id === id ? { ...m, status } : m));
    toast.success(`Status atualizado: ${STATUS_CFG[status].label}`);
  }

  const counts = {
    operando: maquinas.filter(m => m.status === "operando").length,
    parada: maquinas.filter(m => m.status === "parada").length,
    manutencao: maquinas.filter(m => m.status === "manutencao").length,
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Resumo */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Operando", value: counts.operando, color: "text-green-500", bg: "bg-green-500/10", border: "border-green-500/20" },
          { label: "Em Manutenção", value: counts.manutencao, color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20" },
          { label: "Paradas", value: counts.parada, color: "text-red-500", bg: "bg-red-500/10", border: "border-red-500/20" },
        ].map(item => (
          <div key={item.label} className={cn("rounded-2xl border p-3 text-center", item.bg, item.border)}>
            <p className={cn("text-2xl font-bold tabular-nums", item.color)}>{item.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{item.label}</p>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-32">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Buscar máquina..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 rounded-xl text-sm h-9" />
        </div>
        <select value={filtroSetor} onChange={e => setFiltroSetor(e.target.value)}
          className="h-9 rounded-xl border border-input bg-card px-3 text-sm">
          <option value="todos">Todos os setores</option>
          {SETORES.map(s => <option key={s} value={s}>{SETOR_LABEL[s]}</option>)}
        </select>
        <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}
          className="h-9 rounded-xl border border-input bg-card px-3 text-sm">
          <option value="todos">Todos os status</option>
          {(Object.keys(STATUS_CFG) as StatusMaquina[]).map(s => (
            <option key={s} value={s}>{STATUS_CFG[s].label}</option>
          ))}
        </select>
        {isAdmin && (
          <Button size="sm" className="h-9 rounded-xl shrink-0" onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Nova
          </Button>
        )}
      </div>

      {/* Grid */}
      <div className="grid gap-3 sm:grid-cols-2">
        {filtered.map(m => (
          <MaquinaCard key={m.id} maquina={m} isAdmin={isAdmin} onChangeStatus={changeStatus} />
        ))}
        {filtered.length === 0 && (
          <div className="col-span-2 py-12 text-center">
            <Settings2 className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Nenhuma máquina encontrada</p>
          </div>
        )}
      </div>

      <NovaMaquinaModal open={modalOpen} onClose={() => setModalOpen(false)} onSaved={m => setMaquinas(p => [m, ...p])} />
    </div>
  );
}
