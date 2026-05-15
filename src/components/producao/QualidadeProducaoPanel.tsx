/**
 * QualidadeProducaoPanel — Controle de Refugo e Qualidade
 * Registro de defeitos, motivos, upload de fotos, controle dimensional, relatórios, índice de perdas
 */

import { useState, useRef } from "react";
import { Plus, X, Search, ShieldAlert, Camera, Upload, ChevronRight, Image } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

// ── Tipos ──────────────────────────────────────────────────────────────────────

type TipoDefeito = "dimensional" | "superficial" | "material" | "montagem" | "outro";
type DestinacaoRefugo = "retrabalho" | "sucata" | "devolucao";

interface Refugo {
  id: string;
  produto: string;
  lote: string;
  maquina: string;
  operador: string;
  tipoDefeito: TipoDefeito;
  motivo: string;
  quantidade: number;
  destinacao: DestinacaoRefugo;
  dataHora: Date;
  fotos: string[]; // URLs simulados
  medicoes?: { campo: string; nominal: number; medido: number; tolerancia: number }[];
  observacoes?: string;
}

const DEFEITO_LABEL: Record<TipoDefeito, string> = {
  dimensional: "Dimensional", superficial: "Superficial / Acabamento",
  material: "Problema de Material", montagem: "Erro de Montagem", outro: "Outro",
};

const DESTINACAO_LABEL: Record<DestinacaoRefugo, string> = {
  retrabalho: "Retrabalho", sucata: "Sucata", devolucao: "Devolução ao Fornec.",
};

const MOTIVOS_DEFEITO = [
  "Fora de tolerância", "Arranhão / Risco", "Quebra de ferramenta",
  "Material com defeito", "Setup incorreto", "Desgaste de ferramenta",
  "Erro de medição", "Vibração / Trepidação", "Contaminação",
];

const MOCK_REFUGOS: Refugo[] = [
  { id: "1", produto: "PÇ-001 Eixo", lote: "LOT-2025-001", maquina: "CNC-01", operador: "João Silva",
    tipoDefeito: "dimensional", motivo: "Fora de tolerância", quantidade: 3, destinacao: "retrabalho",
    dataHora: new Date(Date.now() - 60 * 60000), fotos: [],
    medicoes: [{ campo: "Diâmetro", nominal: 25.00, medido: 25.08, tolerancia: 0.05 }] },
  { id: "2", produto: "PÇ-002 Flange", lote: "LOT-2025-002", maquina: "TORNO-01", operador: "Maria Santos",
    tipoDefeito: "superficial", motivo: "Arranhão / Risco", quantidade: 2, destinacao: "sucata",
    dataHora: new Date(Date.now() - 3 * 60 * 60000), fotos: [] },
  { id: "3", produto: "PÇ-003 Tampa", lote: "LOT-2025-003", maquina: "CNC-02", operador: "Carlos Lima",
    tipoDefeito: "material", motivo: "Material com defeito", quantidade: 10, destinacao: "devolucao",
    dataHora: new Date(Date.now() - 5 * 60 * 60000), fotos: [] },
];

// ── Modal Novo Refugo ─────────────────────────────────────────────────────────

function NovoRefugoModal({ open, onClose, onSaved }: {
  open: boolean; onClose: () => void; onSaved: (r: Refugo) => void;
}) {
  const [form, setForm] = useState({
    produto: "", lote: "", maquina: "", operador: "",
    tipoDefeito: "dimensional" as TipoDefeito, motivo: "",
    quantidade: "", destinacao: "retrabalho" as DestinacaoRefugo, observacoes: "",
  });
  const [medicoes, setMedicoes] = useState<{ campo: string; nominal: string; medido: string; tolerancia: string }[]>([]);

  if (!open) return null;

  function addMedicao() {
    setMedicoes(prev => [...prev, { campo: "", nominal: "", medido: "", tolerancia: "" }]);
  }

  function save() {
    if (!form.produto || !form.maquina || !form.operador || !form.quantidade || !form.motivo) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }
    const r: Refugo = {
      id: Date.now().toString(),
      produto: form.produto, lote: form.lote, maquina: form.maquina, operador: form.operador,
      tipoDefeito: form.tipoDefeito, motivo: form.motivo,
      quantidade: Number(form.quantidade), destinacao: form.destinacao,
      dataHora: new Date(), fotos: [],
      medicoes: medicoes.filter(m => m.campo).map(m => ({
        campo: m.campo, nominal: Number(m.nominal), medido: Number(m.medido), tolerancia: Number(m.tolerancia),
      })),
      observacoes: form.observacoes || undefined,
    };
    onSaved(r);
    toast.success("Refugo registrado!");
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-background border rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-orange-500" />
            <p className="text-sm font-semibold">Registrar Refugo</p>
          </div>
          <button onClick={onClose} className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-muted/40">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Produto *</label>
              <Input placeholder="PÇ-001" value={form.produto} onChange={e => setForm(f => ({ ...f, produto: e.target.value }))} className="rounded-xl" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Lote</label>
              <Input placeholder="LOT-001" value={form.lote} onChange={e => setForm(f => ({ ...f, lote: e.target.value }))} className="rounded-xl" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Máquina *</label>
              <Input placeholder="CNC-01" value={form.maquina} onChange={e => setForm(f => ({ ...f, maquina: e.target.value }))} className="rounded-xl" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Operador *</label>
              <Input placeholder="Nome" value={form.operador} onChange={e => setForm(f => ({ ...f, operador: e.target.value }))} className="rounded-xl" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Tipo de Defeito</label>
              <select value={form.tipoDefeito} onChange={e => setForm(f => ({ ...f, tipoDefeito: e.target.value as TipoDefeito }))}
                className="w-full h-10 rounded-xl border border-input bg-card px-3 text-sm">
                {(Object.keys(DEFEITO_LABEL) as TipoDefeito[]).map(k => (
                  <option key={k} value={k}>{DEFEITO_LABEL[k]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Quantidade *</label>
              <Input type="number" min={1} placeholder="0" value={form.quantidade} onChange={e => setForm(f => ({ ...f, quantidade: e.target.value }))} className="rounded-xl" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Motivo *</label>
            <select value={form.motivo} onChange={e => setForm(f => ({ ...f, motivo: e.target.value }))}
              className="w-full h-10 rounded-xl border border-input bg-card px-3 text-sm">
              <option value="">Selecione o motivo</option>
              {MOTIVOS_DEFEITO.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Destinação</label>
            <select value={form.destinacao} onChange={e => setForm(f => ({ ...f, destinacao: e.target.value as DestinacaoRefugo }))}
              className="w-full h-10 rounded-xl border border-input bg-card px-3 text-sm">
              {(Object.keys(DESTINACAO_LABEL) as DestinacaoRefugo[]).map(k => (
                <option key={k} value={k}>{DESTINACAO_LABEL[k]}</option>
              ))}
            </select>
          </div>

          {/* Medições dimensionais */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground">Medições Dimensionais</p>
              <button onClick={addMedicao} className="text-[11px] text-primary hover:underline">+ Adicionar</button>
            </div>
            {medicoes.map((m, i) => (
              <div key={i} className="grid grid-cols-4 gap-2 mb-2">
                {[
                  { key: "campo", ph: "Campo" },
                  { key: "nominal", ph: "Nominal" },
                  { key: "medido", ph: "Medido" },
                  { key: "tolerancia", ph: "Tol." },
                ].map(f => (
                  <Input key={f.key} placeholder={f.ph} value={(m as Record<string, string>)[f.key]}
                    onChange={e => setMedicoes(prev => prev.map((x, j) => j === i ? { ...x, [f.key]: e.target.value } : x))}
                    className="rounded-xl text-xs h-8"
                  />
                ))}
              </div>
            ))}
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Observações</label>
            <Input placeholder="Observações adicionais..." value={form.observacoes} onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))} className="rounded-xl" />
          </div>

          {/* Foto placeholder */}
          <div className="rounded-xl border-2 border-dashed border-border/60 p-4 text-center">
            <Camera className="h-6 w-6 text-muted-foreground/40 mx-auto mb-1" />
            <p className="text-[11px] text-muted-foreground">Toque para adicionar foto (em breve)</p>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-border/40 flex gap-3">
          <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1 rounded-xl bg-orange-500 hover:bg-orange-600" onClick={save}>Registrar</Button>
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function QualidadeProducaoPanel() {
  const [refugos, setRefugos] = useState<Refugo[]>(MOCK_REFUGOS);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  const filtered = refugos.filter(r => {
    const q = search.toLowerCase();
    return r.produto.toLowerCase().includes(q) || r.maquina.toLowerCase().includes(q) || r.motivo.toLowerCase().includes(q);
  });

  const totalRefugo = refugos.reduce((s, r) => s + r.quantidade, 0);
  const totalPecas = 3000; // mockado
  const indice = ((totalRefugo / totalPecas) * 100).toFixed(2);

  // Dados por tipo de defeito
  const porTipo = (Object.keys(DEFEITO_LABEL) as TipoDefeito[]).map(k => ({
    name: DEFEITO_LABEL[k].split(" ")[0],
    value: refugos.filter(r => r.tipoDefeito === k).reduce((s, r) => s + r.quantidade, 0),
    color: { dimensional: "#3b82f6", superficial: "#f59e0b", material: "#ef4444", montagem: "#8b5cf6", outro: "#6b7280" }[k],
  })).filter(d => d.value > 0);

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total Refugo", value: `${totalRefugo}pç`, color: "text-red-500", bg: "bg-red-500/10", border: "border-red-500/20" },
          { label: "Índice de Refugo", value: `${indice}%`, color: Number(indice) < 1 ? "text-green-500" : "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20" },
          { label: "Ocorrências Hoje", value: refugos.length, color: "text-primary", bg: "bg-primary/10", border: "border-primary/20" },
        ].map(item => (
          <div key={item.label} className={cn("rounded-2xl border p-3 text-center", item.bg, item.border)}>
            <p className={cn("text-xl font-bold tabular-nums", item.color)}>{item.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{item.label}</p>
          </div>
        ))}
      </div>

      {/* Gráfico */}
      {porTipo.length > 0 && (
        <div className="rounded-2xl border bg-card/60 p-4">
          <h3 className="text-sm font-semibold mb-3">Refugo por Tipo de Defeito</h3>
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={porTipo} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]} name="Peças">
                  {porTipo.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Filtros e novo */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Buscar produto, máquina ou motivo..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 rounded-xl text-sm h-9" />
        </div>
        <Button size="sm" className="h-9 rounded-xl bg-orange-500 hover:bg-orange-600 shrink-0" onClick={() => setModalOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Registrar
        </Button>
      </div>

      {/* Lista */}
      <div className="space-y-3">
        {filtered.map(r => (
          <div key={r.id} className="rounded-2xl border bg-card/60 p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-sm">{r.produto}</p>
                <p className="text-[11px] text-muted-foreground">Lote: {r.lote || "–"} · {r.maquina} · {r.operador}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-red-500 font-bold text-lg tabular-nums">{r.quantidade}pç</span>
                <span className="text-[10px] text-muted-foreground">{r.dataHora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-500 font-medium">
                {DEFEITO_LABEL[r.tipoDefeito]}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted/40 text-muted-foreground">
                {r.motivo}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500">
                {DESTINACAO_LABEL[r.destinacao]}
              </span>
            </div>
            {r.medicoes && r.medicoes.length > 0 && (
              <div className="rounded-xl bg-muted/20 p-3 space-y-1.5">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Medições</p>
                {r.medicoes.map((m, i) => {
                  const fora = Math.abs(m.medido - m.nominal) > m.tolerancia;
                  return (
                    <div key={i} className="flex items-center justify-between text-[11px]">
                      <span className="font-medium">{m.campo}</span>
                      <span className={cn("tabular-nums font-mono", fora ? "text-red-500" : "text-green-500")}>
                        {m.medido.toFixed(2)} <span className="text-muted-foreground">(±{m.tolerancia})</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="py-12 text-center">
            <ShieldAlert className="h-8 w-8 text-green-500/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Nenhum refugo registrado</p>
          </div>
        )}
      </div>

      <NovoRefugoModal open={modalOpen} onClose={() => setModalOpen(false)} onSaved={r => setRefugos(p => [r, ...p])} />
    </div>
  );
}
