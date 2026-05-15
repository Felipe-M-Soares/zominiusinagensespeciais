/**
 * ControlePanel — Controle de Produção
 * Apontamento em tempo real, registro por lote/turno/operador, histórico
 */

import { useState, useEffect, useRef } from "react";
import {
  Plus, X, Search, Clock, User2, Package, Hash,
  CheckCircle2, PlayCircle, ClipboardList, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ── Tipos ──────────────────────────────────────────────────────────────────────

type Turno = "1º Turno" | "2º Turno" | "3º Turno";

interface Apontamento {
  id: string;
  produto: string;
  lote: string;
  maquina: string;
  operador: string;
  turno: Turno;
  quantidade: number;
  inicio: string;
  fim?: string;
  status: "em_andamento" | "concluido";
}

const TURNOS: Turno[] = ["1º Turno", "2º Turno", "3º Turno"];
const MAQUINAS_MOCK = ["CNC-01", "CNC-02", "TORNO-01", "TORNO-02", "FRESA-01"];
const PRODUTOS_MOCK = ["PÇ-001 Eixo", "PÇ-002 Flange", "PÇ-003 Tampa", "PÇ-004 Bucha"];

function gerarMockApontamentos(): Apontamento[] {
  return [
    {
      id: "AP-001", produto: "PÇ-001 Eixo", lote: "LOT-2025-001",
      maquina: "CNC-01", operador: "João Silva", turno: "1º Turno",
      quantidade: 342, inicio: "06:00", status: "em_andamento",
    },
    {
      id: "AP-002", produto: "PÇ-002 Flange", lote: "LOT-2025-002",
      maquina: "TORNO-01", operador: "Maria Santos", turno: "1º Turno",
      quantidade: 215, inicio: "06:10", status: "em_andamento",
    },
    {
      id: "AP-003", produto: "PÇ-003 Tampa", lote: "LOT-2025-003",
      maquina: "CNC-02", operador: "Carlos Lima", turno: "3º Turno",
      quantidade: 890, inicio: "22:00", fim: "06:00", status: "concluido",
    },
  ];
}

// ── Modal Novo Apontamento ─────────────────────────────────────────────────────

function NovoApontamentoModal({ open, onClose, onSaved }: {
  open: boolean; onClose: () => void; onSaved: (a: Apontamento) => void;
}) {
  const [form, setForm] = useState({
    produto: "", lote: "", maquina: "", operador: "", turno: "1º Turno" as Turno, quantidade: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm({ produto: "", lote: "", maquina: "", operador: "", turno: "1º Turno", quantidade: "" });
  }, [open]);

  if (!open) return null;

  async function handleSave() {
    if (!form.produto || !form.maquina || !form.operador || !form.quantidade) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }
    setSaving(true);
    await new Promise(r => setTimeout(r, 600));
    const novo: Apontamento = {
      id: `AP-${Date.now()}`,
      produto: form.produto, lote: form.lote || `LOT-${Date.now()}`,
      maquina: form.maquina, operador: form.operador, turno: form.turno,
      quantidade: Number(form.quantidade),
      inicio: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      status: "em_andamento",
    };
    onSaved(novo);
    toast.success("Apontamento registrado!");
    setSaving(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
          <div className="flex items-center gap-2">
            <PlayCircle className="h-4 w-4 text-green-500" />
            <p className="text-sm font-semibold">Novo Apontamento</p>
          </div>
          <button onClick={onClose} className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-muted/40">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Produto *</label>
            <select
              value={form.produto}
              onChange={e => setForm(f => ({ ...f, produto: e.target.value }))}
              className="w-full h-10 rounded-xl border border-input bg-card px-3 text-sm"
            >
              <option value="">Selecione o produto</option>
              {PRODUTOS_MOCK.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Lote de Produção</label>
            <Input placeholder="Ex: LOT-2025-001 (auto-gerado se vazio)"
              value={form.lote} onChange={e => setForm(f => ({ ...f, lote: e.target.value }))}
              className="rounded-xl"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Máquina *</label>
              <select
                value={form.maquina}
                onChange={e => setForm(f => ({ ...f, maquina: e.target.value }))}
                className="w-full h-10 rounded-xl border border-input bg-card px-3 text-sm"
              >
                <option value="">Selecionar</option>
                {MAQUINAS_MOCK.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Turno *</label>
              <select
                value={form.turno}
                onChange={e => setForm(f => ({ ...f, turno: e.target.value as Turno }))}
                className="w-full h-10 rounded-xl border border-input bg-card px-3 text-sm"
              >
                {TURNOS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Operador *</label>
            <Input placeholder="Nome do operador"
              value={form.operador} onChange={e => setForm(f => ({ ...f, operador: e.target.value }))}
              className="rounded-xl"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Quantidade Produzida *</label>
            <Input type="number" min={1} placeholder="0"
              value={form.quantidade} onChange={e => setForm(f => ({ ...f, quantidade: e.target.value }))}
              className="rounded-xl"
            />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-border/40 flex gap-3">
          <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button className="flex-1 rounded-xl" onClick={handleSave} disabled={saving}>
            {saving ? "Salvando..." : "Registrar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Card de Apontamento ────────────────────────────────────────────────────────

function ApontamentoCard({ ap, onConcluir }: { ap: Apontamento; onConcluir: (id: string) => void }) {
  return (
    <div className={cn(
      "rounded-2xl border p-4 space-y-3 transition-all",
      ap.status === "em_andamento" ? "bg-green-500/5 border-green-500/20" : "bg-card/60 border-border/40 opacity-70"
    )}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-sm">{ap.produto}</p>
          <p className="text-[11px] text-muted-foreground">{ap.id} · Lote: {ap.lote}</p>
        </div>
        <Badge variant={ap.status === "em_andamento" ? "default" : "secondary"} className="shrink-0 text-[10px]">
          {ap.status === "em_andamento" ? "Em andamento" : "Concluído"}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {[
          { icon: Package, label: ap.maquina },
          { icon: User2, label: ap.operador },
          { icon: Clock, label: `${ap.turno} · ${ap.inicio}${ap.fim ? ` – ${ap.fim}` : ""}` },
          { icon: Hash, label: `${ap.quantidade.toLocaleString("pt-BR")} peças` },
        ].map((item, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <item.icon className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-[11px] text-muted-foreground truncate">{item.label}</span>
          </div>
        ))}
      </div>

      {ap.status === "em_andamento" && (
        <Button
          size="sm" variant="outline"
          className="w-full rounded-xl text-xs h-8 border-green-500/30 text-green-600 hover:bg-green-500/10"
          onClick={() => onConcluir(ap.id)}
        >
          <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
          Concluir Apontamento
        </Button>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function ControlePanel({ isAdmin: _isAdmin }: { isAdmin: boolean }) {
  const [apontamentos, setApontamentos] = useState<Apontamento[]>(gerarMockApontamentos());
  const [search, setSearch] = useState("");
  const [filtroTurno, setFiltroTurno] = useState<string>("todos");
  const [modalOpen, setModalOpen] = useState(false);

  const filtered = apontamentos.filter(a => {
    const q = search.toLowerCase();
    const matchSearch = a.produto.toLowerCase().includes(q) || a.operador.toLowerCase().includes(q) || a.lote.toLowerCase().includes(q);
    const matchTurno = filtroTurno === "todos" || a.turno === filtroTurno;
    return matchSearch && matchTurno;
  });

  function concluir(id: string) {
    setApontamentos(prev => prev.map(a =>
      a.id === id ? { ...a, status: "concluido", fim: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) } : a
    ));
    toast.success("Apontamento concluído!");
  }

  const emAndamento = apontamentos.filter(a => a.status === "em_andamento").length;

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Resumo */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Em Andamento", value: emAndamento, color: "text-green-500" },
          { label: "Concluídos Hoje", value: apontamentos.filter(a => a.status === "concluido").length, color: "text-blue-500" },
          { label: "Total Peças", value: apontamentos.reduce((s, a) => s + a.quantidade, 0).toLocaleString("pt-BR"), color: "text-primary" },
        ].map(item => (
          <div key={item.label} className="rounded-2xl border bg-card/60 p-3 text-center">
            <p className={cn("text-xl font-bold tabular-nums", item.color)}>{item.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{item.label}</p>
          </div>
        ))}
      </div>

      {/* Barra de ação */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar produto, operador ou lote..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="pl-9 rounded-xl text-sm h-9"
          />
        </div>
        <select
          value={filtroTurno}
          onChange={e => setFiltroTurno(e.target.value)}
          className="h-9 rounded-xl border border-input bg-card px-3 text-sm"
        >
          <option value="todos">Todos os turnos</option>
          {TURNOS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <Button size="sm" className="h-9 rounded-xl shrink-0" onClick={() => setModalOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Novo
        </Button>
      </div>

      {/* Lista */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center">
          <ClipboardList className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Nenhum apontamento encontrado</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(ap => (
            <ApontamentoCard key={ap.id} ap={ap} onConcluir={concluir} />
          ))}
        </div>
      )}

      <NovoApontamentoModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={a => setApontamentos(prev => [a, ...prev])}
      />
    </div>
  );
}
