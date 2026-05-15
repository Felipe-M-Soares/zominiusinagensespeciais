/**
 * MateriaPrimaPanel — Controle de Matéria-Prima
 * Estoque, baixa automática, rastreabilidade, lotes, histórico, alertas
 */

import { useState } from "react";
import { Plus, X, Search, Boxes, AlertTriangle, TrendingDown, Package, ArrowDown, ArrowUp, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ── Tipos ──────────────────────────────────────────────────────────────────────

type MovimentoTipo = "entrada" | "saida" | "ajuste";

interface MateriaPrima {
  id: string;
  codigo: string;
  descricao: string;
  unidade: string;
  estoqueAtual: number;
  estoqueMinimo: number;
  estoqueMaximo: number;
  loteAtual?: string;
  fornecedor?: string;
  ultimaEntrada?: string;
  ultimaSaida?: string;
  localizacao?: string;
}

interface Movimento {
  id: string;
  materiaPrimaId: string;
  materiaPrimaDesc: string;
  tipo: MovimentoTipo;
  quantidade: number;
  lote?: string;
  operador: string;
  dataHora: Date;
  ordemProducao?: string;
  observacoes?: string;
}

const MOCK_MATERIAS: MateriaPrima[] = [
  { id: "1", codigo: "MP-001", descricao: "Aço Inox 316L Ø25mm", unidade: "m", estoqueAtual: 42.5, estoqueMinimo: 20, estoqueMaximo: 150, loteAtual: "LT-AÇO-001", fornecedor: "Aços Villares", ultimaEntrada: "2025-01-10", ultimaSaida: "2025-01-14", localizacao: "A1-01" },
  { id: "2", codigo: "MP-002", descricao: "Alumínio 6061 Ø80mm", unidade: "m", estoqueAtual: 8.2, estoqueMinimo: 15, estoqueMaximo: 80, loteAtual: "LT-ALU-002", fornecedor: "Alcoa", ultimaEntrada: "2025-01-08", ultimaSaida: "2025-01-13", localizacao: "A1-02" },
  { id: "3", codigo: "MP-003", descricao: "Latão C360 Ø40mm", unidade: "m", estoqueAtual: 35.0, estoqueMinimo: 10, estoqueMaximo: 60, loteAtual: "LT-LAT-001", fornecedor: "Cimetal", ultimaEntrada: "2025-01-12", ultimaSaida: "2025-01-14", localizacao: "A2-01" },
  { id: "4", codigo: "MP-004", descricao: "Aço Carbono 1045 Ch. 10mm", unidade: "kg", estoqueAtual: 0, estoqueMinimo: 50, estoqueMaximo: 300, fornecedor: "Gerdau", ultimaEntrada: "2024-12-20", localizacao: "A2-02" },
  { id: "5", codigo: "MP-005", descricao: "Óleo de Corte Sintético", unidade: "L", estoqueAtual: 85, estoqueMinimo: 30, estoqueMaximo: 200, loteAtual: "LT-OLE-001", fornecedor: "Quaker", ultimaEntrada: "2025-01-05", localizacao: "B1-01" },
];

const MOCK_MOVIMENTOS: Movimento[] = [
  { id: "1", materiaPrimaId: "1", materiaPrimaDesc: "Aço Inox 316L Ø25mm", tipo: "saida", quantidade: 2.5, lote: "LT-AÇO-001", operador: "João Silva", dataHora: new Date(Date.now() - 30 * 60000), ordemProducao: "OP-2025-001" },
  { id: "2", materiaPrimaId: "2", materiaPrimaDesc: "Alumínio 6061 Ø80mm", tipo: "entrada", quantidade: 20, lote: "LT-ALU-003", operador: "Admin", dataHora: new Date(Date.now() - 2 * 60 * 60000) },
  { id: "3", materiaPrimaId: "3", materiaPrimaDesc: "Latão C360 Ø40mm", tipo: "saida", quantidade: 1.2, lote: "LT-LAT-001", operador: "Carlos Lima", dataHora: new Date(Date.now() - 3 * 60 * 60000), ordemProducao: "OP-2025-002" },
];

// ── Modal Movimentação ────────────────────────────────────────────────────────

function MovimentoModal({ open, materias, onClose, onSaved }: {
  open: boolean; materias: MateriaPrima[]; onClose: () => void; onSaved: (m: Movimento, delta: number, mpId: string) => void;
}) {
  const [form, setForm] = useState({ materiaPrimaId: "", tipo: "saida" as MovimentoTipo, quantidade: "", lote: "", operador: "", ordemProducao: "", observacoes: "" });

  if (!open) return null;

  function save() {
    if (!form.materiaPrimaId || !form.quantidade || !form.operador) { toast.error("Preencha os campos obrigatórios"); return; }
    const mp = materias.find(m => m.id === form.materiaPrimaId)!;
    const qtd = Number(form.quantidade);
    if (form.tipo === "saida" && qtd > mp.estoqueAtual) { toast.error("Quantidade insuficiente em estoque!"); return; }
    const mov: Movimento = {
      id: Date.now().toString(),
      materiaPrimaId: form.materiaPrimaId,
      materiaPrimaDesc: mp.descricao,
      tipo: form.tipo,
      quantidade: qtd,
      lote: form.lote || mp.loteAtual,
      operador: form.operador,
      dataHora: new Date(),
      ordemProducao: form.ordemProducao || undefined,
      observacoes: form.observacoes || undefined,
    };
    const delta = form.tipo === "entrada" ? qtd : form.tipo === "saida" ? -qtd : 0;
    onSaved(mov, delta, form.materiaPrimaId);
    toast.success(`${form.tipo === "entrada" ? "Entrada" : "Saída"} registrada!`);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-background border rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
          <p className="text-sm font-semibold">Movimentar Matéria-Prima</p>
          <button onClick={onClose} className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-muted/40">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Matéria-Prima *</label>
            <select value={form.materiaPrimaId} onChange={e => setForm(f => ({ ...f, materiaPrimaId: e.target.value }))}
              className="w-full h-10 rounded-xl border border-input bg-card px-3 text-sm">
              <option value="">Selecione</option>
              {materias.map(m => <option key={m.id} value={m.id}>{m.codigo} – {m.descricao}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Tipo *</label>
              <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as MovimentoTipo }))}
                className="w-full h-10 rounded-xl border border-input bg-card px-3 text-sm">
                <option value="entrada">Entrada</option>
                <option value="saida">Saída / Consumo</option>
                <option value="ajuste">Ajuste de Inventário</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Quantidade ({materias.find(m => m.id === form.materiaPrimaId)?.unidade || "–"}) *
              </label>
              <Input type="number" min={0} step={0.01} placeholder="0.00" value={form.quantidade} onChange={e => setForm(f => ({ ...f, quantidade: e.target.value }))} className="rounded-xl" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Lote</label>
              <Input placeholder="Lote (auto)" value={form.lote} onChange={e => setForm(f => ({ ...f, lote: e.target.value }))} className="rounded-xl" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Operador *</label>
              <Input placeholder="Nome" value={form.operador} onChange={e => setForm(f => ({ ...f, operador: e.target.value }))} className="rounded-xl" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Ordem de Produção</label>
            <Input placeholder="OP-2025-001 (se consumo)" value={form.ordemProducao} onChange={e => setForm(f => ({ ...f, ordemProducao: e.target.value }))} className="rounded-xl" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Observações</label>
            <Input placeholder="..." value={form.observacoes} onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))} className="rounded-xl" />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-border/40 flex gap-3">
          <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1 rounded-xl" onClick={save}>Confirmar</Button>
        </div>
      </div>
    </div>
  );
}

// ── Card Matéria-Prima ────────────────────────────────────────────────────────

function MPCard({ mp }: { mp: MateriaPrima }) {
  const pct = Math.min((mp.estoqueAtual / mp.estoqueMaximo) * 100, 100);
  const abaixoMinimo = mp.estoqueAtual < mp.estoqueMinimo;
  const zerado = mp.estoqueAtual === 0;

  return (
    <div className={cn(
      "rounded-2xl border p-4 space-y-3 transition-all",
      zerado ? "bg-red-500/5 border-red-500/20" : abaixoMinimo ? "bg-amber-500/5 border-amber-500/20" : "bg-card/60 border-border/40"
    )}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-xs text-primary font-mono">{mp.codigo}</span>
            {mp.localizacao && (
              <span className="text-[9px] bg-muted/40 text-muted-foreground px-1.5 py-0.5 rounded-md">{mp.localizacao}</span>
            )}
          </div>
          <p className="text-xs font-medium mt-0.5">{mp.descricao}</p>
        </div>
        {(zerado || abaixoMinimo) && (
          <AlertTriangle className={cn("h-4 w-4 shrink-0", zerado ? "text-red-500" : "text-amber-500")} />
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className={cn("font-bold tabular-nums text-base", zerado ? "text-red-500" : abaixoMinimo ? "text-amber-500" : "text-foreground")}>
            {mp.estoqueAtual.toLocaleString("pt-BR")} {mp.unidade}
          </span>
          <span className="text-muted-foreground text-[11px]">
            Min: {mp.estoqueMinimo} · Max: {mp.estoqueMaximo}
          </span>
        </div>
        <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-500",
              zerado ? "bg-red-500" : abaixoMinimo ? "bg-amber-500" : "bg-green-500"
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
        {mp.loteAtual && <span>Lote: {mp.loteAtual}</span>}
        {mp.fornecedor && <span>{mp.fornecedor}</span>}
        {mp.ultimaEntrada && <span>Entrada: {mp.ultimaEntrada}</span>}
        {mp.ultimaSaida && <span>Saída: {mp.ultimaSaida}</span>}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function MateriaPrimaPanel() {
  const [materias, setMaterias] = useState<MateriaPrima[]>(MOCK_MATERIAS);
  const [movimentos, setMovimentos] = useState<Movimento[]>(MOCK_MOVIMENTOS);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"estoque" | "historico">("estoque");
  const [modalOpen, setModalOpen] = useState(false);

  const filtered = materias.filter(m => {
    const q = search.toLowerCase();
    return m.codigo.toLowerCase().includes(q) || m.descricao.toLowerCase().includes(q);
  });

  const abaixoMinimo = materias.filter(m => m.estoqueAtual < m.estoqueMinimo).length;

  function handleMovimento(mov: Movimento, delta: number, mpId: string) {
    setMovimentos(prev => [mov, ...prev]);
    setMaterias(prev => prev.map(m => m.id === mpId ? { ...m, estoqueAtual: Math.max(0, m.estoqueAtual + delta) } : m));
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Itens Cadastrados", value: materias.length, color: "text-primary", bg: "bg-primary/10", border: "border-primary/20" },
          { label: "Abaixo do Mínimo", value: abaixoMinimo, color: abaixoMinimo > 0 ? "text-amber-500" : "text-green-500", bg: abaixoMinimo > 0 ? "bg-amber-500/10" : "bg-green-500/10", border: abaixoMinimo > 0 ? "border-amber-500/20" : "border-green-500/20" },
          { label: "Zerados", value: materias.filter(m => m.estoqueAtual === 0).length, color: "text-red-500", bg: "bg-red-500/10", border: "border-red-500/20" },
        ].map(item => (
          <div key={item.label} className={cn("rounded-2xl border p-3 text-center", item.bg, item.border)}>
            <p className={cn("text-2xl font-bold tabular-nums", item.color)}>{item.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{item.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-muted/40 rounded-xl">
        {(["estoque", "historico"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn("flex-1 text-xs font-medium py-2 px-3 rounded-lg transition-all",
              tab === t ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {t === "estoque" ? "Estoque" : "Histórico de Movimentos"}
          </button>
        ))}
      </div>

      {tab === "estoque" && (
        <>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Buscar matéria-prima..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 rounded-xl text-sm h-9" />
            </div>
            <Button size="sm" className="h-9 rounded-xl shrink-0" onClick={() => setModalOpen(true)}>
              <RefreshCw className="h-4 w-4 mr-1" /> Movimentar
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {filtered.map(m => <MPCard key={m.id} mp={m} />)}
          </div>
        </>
      )}

      {tab === "historico" && (
        <div className="space-y-3">
          {movimentos.map(mov => {
            const isEntrada = mov.tipo === "entrada";
            return (
              <div key={mov.id} className="rounded-2xl border bg-card/60 p-4 flex items-start gap-3">
                <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center shrink-0",
                  isEntrada ? "bg-green-500/10" : "bg-red-500/10")}>
                  {isEntrada ? <ArrowDown className="h-4 w-4 text-green-500" /> : <ArrowUp className="h-4 w-4 text-red-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{mov.materiaPrimaDesc}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                    <span className="text-[11px] text-muted-foreground">{mov.operador}</span>
                    {mov.lote && <span className="text-[11px] text-muted-foreground">Lote: {mov.lote}</span>}
                    {mov.ordemProducao && <span className="text-[11px] text-muted-foreground">OP: {mov.ordemProducao}</span>}
                    <span className="text-[11px] text-muted-foreground">{mov.dataHora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                </div>
                <span className={cn("font-bold tabular-nums shrink-0", isEntrada ? "text-green-500" : "text-red-500")}>
                  {isEntrada ? "+" : "-"}{mov.quantidade.toLocaleString("pt-BR")}
                </span>
              </div>
            );
          })}
          {movimentos.length === 0 && (
            <div className="py-12 text-center">
              <Boxes className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Nenhum movimento registrado</p>
            </div>
          )}
        </div>
      )}

      <MovimentoModal open={modalOpen} materias={materias} onClose={() => setModalOpen(false)} onSaved={handleMovimento} />
    </div>
  );
}
