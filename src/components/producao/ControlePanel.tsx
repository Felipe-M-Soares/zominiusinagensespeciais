/**
 * ControlePanel — Controle de Produção PPI-51
 * Formulário completo equivalente ao Excel PPI-51 da empresa.
 * Campos: produto, máquina, turno, qtde/hora, horas planejadas,
 *         horários, cycle time, paradas múltiplas, refugos múltiplos,
 *         matéria-prima + lote MP + consumo.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plus, X, ClipboardList, RefreshCw, WifiOff, ChevronDown,
  ChevronUp, Package, Clock, Trash2, CheckCircle2, Factory,
  AlertTriangle, BarChart2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

// ── Tipos ────────────────────────────────────────────────────────────────────

interface Maquina   { codigo: string; nome: string; }
interface Produto   { codigo: string; descricao: string; pecas_por_hora: number; }
interface TipoParada { id: number; nome: string; categoria: string; }
interface TipoRefugo { id: number; nome: string; }
interface MateriaPrima { codigo: string; descricao: string; lote_atual?: string; }

interface ItemParada   { tipo_id: number; tipo_nome: string; duracao_horas: number; }
interface ItemRefugo   { tipo_id: number; tipo_nome: string; quantidade: number; }

interface Apontamento {
  id: string;
  seq_producao: number;
  data_apontamento: string;
  turno: string;
  maquina_codigo: string;
  produto: string;
  descricao_produto?: string;
  qtde_por_hora: number;
  horas_planejadas: number;
  qtde_prevista: number;
  qtde_plan_disp: number;
  quantidade: number;
  horario_inicio: number;
  horario_fim: number;
  lote: string;
  lote_mp?: string;
  descricao_mp?: string;
  consumo_mp_metros?: number;
  operador: string;
  status: string;
  created_at: string;
}

const TURNOS = ["1º Turno", "2º Turno", "3º Turno"];

// Converte horas decimais para HH:MM (ex: 15.25 → "15:15")
function horasParaHHMM(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
}

// Converte HH:MM para horas decimais (ex: "15:15" → 15.25)
function hhmmParaHoras(s: string): number {
  const [hh, mm] = s.split(":").map(Number);
  return (hh || 0) + (mm || 0) / 60;
}

// ── Modal de Novo Apontamento ─────────────────────────────────────────────────

function NovoApontamentoModal({
  open, onClose, onSaved, maquinas, produtos, tiposParada, tiposRefugo, materiasPrimas,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  maquinas: Maquina[];
  produtos: Produto[];
  tiposParada: TipoParada[];
  tiposRefugo: TipoRefugo[];
  materiasPrimas: MateriaPrima[];
}) {
  const { user } = useAuth();
  const [step, setStep] = useState<1|2|3>(1);
  const [saving, setSaving] = useState(false);

  // Step 1 — dados principais
  const [form, setForm] = useState({
    data: new Date().toISOString().split("T")[0],
    turno: "1º Turno",
    maquina: "",
    produto: "",
    qtde_por_hora: "",
    horas_planejadas: "",
    qtde_plan_disp: "",
    qtde_produzida: "",
    horario_inicio: "06:00",
    horario_fim: "15:00",
    operador: "",
    lote_mp: "",
    descricao_mp: "",
    comprimento_mm: "",
    consumo_mp_metros: "",
    lote: "",
  });

  // Step 2 — paradas
  const [paradas, setParadas] = useState<ItemParada[]>([]);

  // Step 3 — refugos
  const [refugos, setRefugos] = useState<ItemRefugo[]>([]);

  useEffect(() => {
    if (!open) {
      setStep(1);
      setForm({
        data: new Date().toISOString().split("T")[0],
        turno: "1º Turno", maquina: "", produto: "",
        qtde_por_hora: "", horas_planejadas: "", qtde_plan_disp: "",
        qtde_produzida: "", horario_inicio: "06:00", horario_fim: "15:00",
        operador: "", lote_mp: "", descricao_mp: "", comprimento_mm: "",
        consumo_mp_metros: "", lote: "",
      });
      setParadas([]);
      setRefugos([]);
    }
  }, [open]);

  // Preenche campos automaticamente ao selecionar produto
  useEffect(() => {
    const prod = produtos.find(p => p.codigo === form.produto);
    if (prod) {
      setForm(f => ({ ...f, qtde_por_hora: String(prod.pecas_por_hora || "") }));
    }
  }, [form.produto, produtos]);

  // Qtde prevista calculada
  const qtdePrevista = useMemo(() => {
    const qh = parseFloat(form.qtde_por_hora) || 0;
    const hp = parseFloat(form.horas_planejadas) || 0;
    return Math.round(qh * hp);
  }, [form.qtde_por_hora, form.horas_planejadas]);

  // Total horas paradas
  const totalHrsParadas = useMemo(() =>
    paradas.reduce((s, p) => s + (p.duracao_horas || 0), 0), [paradas]);

  // Tempo disponível
  const tempoDisponivel = useMemo(() =>
    Math.max(0, (parseFloat(form.horas_planejadas) || 0) - totalHrsParadas),
    [form.horas_planejadas, totalHrsParadas]);

  // Total refugos
  const totalRefugos = useMemo(() =>
    refugos.reduce((s, r) => s + (r.quantidade || 0), 0), [refugos]);

  function setF(k: string, v: string) {
    setForm(f => ({ ...f, [k]: v }));
  }

  function addParada() {
    if (tiposParada.length === 0) return;
    const tp = tiposParada[0];
    setParadas(p => [...p, { tipo_id: tp.id, tipo_nome: tp.nome, duracao_horas: 0 }]);
  }

  function updateParada(idx: number, field: keyof ItemParada, val: string | number) {
    setParadas(p => p.map((item, i) => i === idx ? { ...item, [field]: val } : item));
  }

  function removeParada(idx: number) {
    setParadas(p => p.filter((_, i) => i !== idx));
  }

  function addRefugo() {
    if (tiposRefugo.length === 0) return;
    const tr = tiposRefugo[0];
    setRefugos(r => [...r, { tipo_id: tr.id, tipo_nome: tr.nome, quantidade: 0 }]);
  }

  function updateRefugo(idx: number, field: keyof ItemRefugo, val: string | number) {
    setRefugos(r => r.map((item, i) => i === idx ? { ...item, [field]: val } : item));
  }

  function removeRefugo(idx: number) {
    setRefugos(r => r.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    if (!form.maquina || !form.produto || !form.qtde_produzida || !form.operador) {
      toast.error("Preencha: máquina, produto, quantidade produzida e operador");
      return;
    }
    // Impede data futura — apontamento deve ser de hoje ou passado
    if (form.data > new Date().toISOString().split("T")[0]) {
      toast.error("Data do apontamento não pode ser no futuro.");
      return;
    }
    // Impede quantidade negativa
    if (parseInt(form.qtde_produzida) < 0) {
      toast.error("Quantidade produzida não pode ser negativa.");
      return;
    }
    setSaving(true);
    try {
      const prod = produtos.find(p => p.codigo === form.produto);
      const { data, error } = await supabase.rpc("criar_apontamento_ppi51", {
        p_data:               form.data,
        p_turno:              form.turno,
        p_maquina:            form.maquina,
        p_equipamento:        maquinas.find(m => m.codigo === form.maquina)?.nome || "",
        p_produto:            form.produto,
        p_descricao_produto:  prod?.descricao || "",
        p_qtde_por_hora:      parseFloat(form.qtde_por_hora) || 0,
        p_horas_planejadas:   parseFloat(form.horas_planejadas) || 0,
        p_qtde_plan_disp:     parseFloat(form.qtde_plan_disp) || qtdePrevista,
        p_qtde_produzida:     parseInt(form.qtde_produzida) || 0,
        p_horario_inicio:     hhmmParaHoras(form.horario_inicio),
        p_horario_fim:        hhmmParaHoras(form.horario_fim),
        p_cycle_time_min:     parseFloat(form.qtde_por_hora) > 0 ? 60 / parseFloat(form.qtde_por_hora) : null,
        p_lead_time_horas:    parseFloat(form.horas_planejadas) ? parseFloat(form.horas_planejadas) * 60 : null,
        p_lote:               form.lote,
        p_lote_mp:            form.lote_mp,
        p_descricao_mp:       form.descricao_mp,
        p_comprimento_mm:     parseFloat(form.comprimento_mm) || null,
        p_consumo_mp_metros:  parseFloat(form.consumo_mp_metros) || null,
        p_operador:           form.operador,
        p_paradas:            JSON.stringify(paradas.filter(p => p.duracao_horas > 0)),
        p_refugos:            JSON.stringify(refugos.filter(r => r.quantidade > 0)),
      });
      if (error) throw error;
      toast.success(`Apontamento Nº${(data as { seq: number }).seq} registrado!`);
      onSaved();
      onClose();
    } catch (e: unknown) {
      toast.error("Erro ao salvar: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const labelCls = "text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block";
  const inputCls = "w-full h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full max-w-2xl bg-card rounded-t-2xl sm:rounded-2xl border border-border/40 shadow-2xl flex flex-col max-h-[96vh] sm:max-h-[92vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/30 shrink-0">
          <div>
            <h3 className="font-semibold text-sm">Novo Apontamento de Produção</h3>
            <p className="text-[11px] text-muted-foreground">Equivalente ao formulário PPI-51</p>
          </div>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Steps indicator */}
        <div className="flex items-center gap-0 px-5 py-3 border-b border-border/20 shrink-0 overflow-x-auto scrollbar-none">
          {[
            { n: 1, label: "Produção" },
            { n: 2, label: "Paradas" },
            { n: 3, label: "Refugos" },
          ].map(s => (
            <button
              key={s.n}
              onClick={() => setStep(s.n as 1|2|3)}
              className={cn(
                "flex items-center gap-2 px-4 py-1.5 rounded-lg text-[12px] font-medium transition-colors shrink-0",
                step === s.n
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted/40"
              )}
            >
              <span className={cn(
                "h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold",
                step === s.n ? "bg-white/20" : "bg-muted"
              )}>{s.n}</span>
              {s.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* STEP 1: Dados principais */}
          {step === 1 && (
            <>
              {/* Linha: Data + Turno */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Data *</label>
                  <input type="date" value={form.data} onChange={e => setF("data", e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Turno *</label>
                  <select value={form.turno} onChange={e => setF("turno", e.target.value)} className={inputCls}>
                    {TURNOS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              {/* Linha: Máquina + Operador */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Máquina *</label>
                  <select value={form.maquina} onChange={e => setF("maquina", e.target.value)} className={inputCls}>
                    <option value="">Selecione...</option>
                    {maquinas.map(m => (
                      <option key={m.codigo} value={m.codigo}>{m.codigo} — {m.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Operador *</label>
                  <Input value={form.operador} onChange={e => setF("operador", e.target.value)} placeholder="Nome do operador" className="h-9" />
                </div>
              </div>

              {/* Produto */}
              <div>
                <label className={labelCls}>Produto *</label>
                <select value={form.produto} onChange={e => setF("produto", e.target.value)} className={inputCls}>
                  <option value="">Selecione...</option>
                  {produtos.map(p => (
                    <option key={p.codigo} value={p.codigo}>{p.codigo} — {p.descricao}</option>
                  ))}
                </select>
              </div>

              {/* Linha: Qtde/Hora + Horas Planejadas + Qtde Prevista */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>Qtde/Hora</label>
                  <Input type="number" min="0" value={form.qtde_por_hora} onChange={e => setF("qtde_por_hora", e.target.value)} placeholder="Ex: 22" className="h-9" />
                </div>
                <div>
                  <label className={labelCls}>Horas Planejadas</label>
                  <Input type="number" min="0" step="0.25" value={form.horas_planejadas} onChange={e => setF("horas_planejadas", e.target.value)} placeholder="Ex: 9" className="h-9" />
                </div>
                <div>
                  <label className={labelCls}>Qtde Prevista</label>
                  <div className="h-9 rounded-lg border bg-muted/30 px-3 flex items-center text-sm font-medium text-muted-foreground">
                    {qtdePrevista.toLocaleString("pt-BR")} pç
                  </div>
                </div>
              </div>

              {/* Linha: Qtde Plan Disp + Qtde Produzida */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Qtde Plan. Disponível</label>
                  <Input type="number" min="0" value={form.qtde_plan_disp} onChange={e => setF("qtde_plan_disp", e.target.value)} placeholder={String(qtdePrevista)} className="h-9" />
                </div>
                <div>
                  <label className={labelCls}>Qtde Produzida *</label>
                  <Input type="number" min="0" value={form.qtde_produzida} onChange={e => setF("qtde_produzida", e.target.value)} placeholder="Ex: 188" className="h-9" />
                </div>
              </div>

              {/* Linha: Horário Início + Fim */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Horário Início</label>
                  <Input type="time" value={form.horario_inicio} onChange={e => setF("horario_inicio", e.target.value)} className="h-9" />
                </div>
                <div>
                  <label className={labelCls}>Horário Fim</label>
                  <Input type="time" value={form.horario_fim} onChange={e => setF("horario_fim", e.target.value)} className="h-9" />
                </div>
              </div>

              {/* Separador MP */}
              <div className="border-t border-border/30 pt-3">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">Matéria-Prima</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Matéria-Prima</label>
                    <select value={form.descricao_mp} onChange={e => setF("descricao_mp", e.target.value)} className={inputCls}>
                      <option value="">Selecione...</option>
                      {materiasPrimas.map(m => (
                        <option key={m.codigo} value={m.descricao}>{m.descricao}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Lote MP</label>
                    <Input value={form.lote_mp} onChange={e => setF("lote_mp", e.target.value)} placeholder="Ex: 160426-01" className="h-9" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className={labelCls}>Comprimento do Produto (mm)</label>
                    <Input type="number" min="0" step="0.01" value={form.comprimento_mm} onChange={e => setF("comprimento_mm", e.target.value)} placeholder="Ex: 11.0" className="h-9" />
                  </div>
                  <div>
                    <label className={labelCls}>Consumo MP (metros)</label>
                    <Input type="number" min="0" step="0.01" value={form.consumo_mp_metros} onChange={e => setF("consumo_mp_metros", e.target.value)} placeholder="Ex: 2068" className="h-9" />
                  </div>
                </div>
              </div>
            </>
          )}

          {/* STEP 2: Paradas */}
          {step === 2 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Horas de Parada</p>
                  <p className="text-[11px] text-muted-foreground">
                    Horas planejadas: {form.horas_planejadas || "—"} ·
                    Total paradas: {totalHrsParadas.toFixed(2)}h ·
                    Disponível: <span className="text-green-600 font-medium">{tempoDisponivel.toFixed(2)}h</span>
                  </p>
                </div>
                <Button size="sm" variant="outline" className="gap-1 h-8 text-xs" onClick={addParada}>
                  <Plus className="h-3.5 w-3.5" /> Adicionar
                </Button>
              </div>

              {paradas.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  <Clock className="h-8 w-8 mx-auto opacity-20 mb-2" />
                  <p>Nenhuma parada registrada</p>
                  <p className="text-[11px]">Se não houve paradas, deixe em branco</p>
                </div>
              )}

              {paradas.map((p, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_120px_32px] gap-2 items-start">
                  <div>
                    <select
                      value={p.tipo_id}
                      onChange={e => {
                        const tp = tiposParada.find(t => t.id === parseInt(e.target.value));
                        if (tp) updateParada(idx, "tipo_id", tp.id);
                        if (tp) updateParada(idx, "tipo_nome", tp.nome);
                      }}
                      className={inputCls}
                    >
                      {tiposParada.map(t => (
                        <option key={t.id} value={t.id}>{t.nome}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Input
                      type="number" min="0" step="0.25"
                      value={p.duracao_horas || ""}
                      onChange={e => updateParada(idx, "duracao_horas", parseFloat(e.target.value) || 0)}
                      placeholder="Horas"
                      className="h-9"
                    />
                  </div>
                  <button onClick={() => removeParada(idx)}
                    className="h-9 w-8 flex items-center justify-center rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* STEP 3: Refugos */}
          {step === 3 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Refugos</p>
                  <p className="text-[11px] text-muted-foreground">
                    Qtde produzida: {form.qtde_produzida || "—"} ·
                    Total refugo: <span className="text-red-500 font-medium">{totalRefugos}</span>
                    {form.qtde_produzida && totalRefugos > 0 &&
                      ` (${(totalRefugos / parseInt(form.qtde_produzida) * 100).toFixed(1)}%)`}
                  </p>
                </div>
                <Button size="sm" variant="outline" className="gap-1 h-8 text-xs" onClick={addRefugo}>
                  <Plus className="h-3.5 w-3.5" /> Adicionar
                </Button>
              </div>

              {refugos.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  <CheckCircle2 className="h-8 w-8 mx-auto opacity-20 mb-2 text-green-500" />
                  <p>Nenhum refugo registrado</p>
                  <p className="text-[11px]">Se não houve refugo, deixe em branco</p>
                </div>
              )}

              {refugos.map((r, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_100px_32px] gap-2 items-start">
                  <select
                    value={r.tipo_id}
                    onChange={e => {
                      const tr = tiposRefugo.find(t => t.id === parseInt(e.target.value));
                      if (tr) updateRefugo(idx, "tipo_id", tr.id);
                      if (tr) updateRefugo(idx, "tipo_nome", tr.nome);
                    }}
                    className={inputCls}
                  >
                    {tiposRefugo.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
                  </select>
                  <Input
                    type="number" min="0"
                    value={r.quantidade || ""}
                    onChange={e => updateRefugo(idx, "quantidade", parseInt(e.target.value) || 0)}
                    placeholder="Qtde"
                    className="h-9"
                  />
                  <button onClick={() => removeRefugo(idx)}
                    className="h-9 w-8 flex items-center justify-center rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border/30 shrink-0">
          <Button variant="outline" onClick={() => step > 1 ? setStep((step - 1) as 1|2|3) : onClose()} className="gap-1">
            {step > 1 ? <ChevronUp className="h-4 w-4" /> : <X className="h-4 w-4" />}
            {step > 1 ? "Voltar" : "Cancelar"}
          </Button>
          <div className="flex gap-2">
            {step < 3 && (
              <Button onClick={() => setStep((step + 1) as 1|2|3)} className="gap-1">
                Próximo <ChevronDown className="h-4 w-4" />
              </Button>
            )}
            {step === 3 && (
              <Button onClick={handleSave} disabled={saving} className="gap-1 bg-green-600 hover:bg-green-500">
                <CheckCircle2 className="h-4 w-4" />
                {saving ? "Salvando..." : "Registrar Apontamento"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Card de apontamento ────────────────────────────────────────────────────────

function ApontamentoCard({ ap }: { ap: Apontamento }) {
  const [expanded, setExpanded] = useState(false);
  const eff = ap.qtde_plan_disp > 0
    ? Math.round(ap.quantidade / ap.qtde_plan_disp * 100)
    : null;

  return (
    <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
      <button
        className="w-full text-left px-4 py-3 flex items-start gap-3"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="h-8 w-8 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
          <Factory className="h-4 w-4 text-green-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-mono text-muted-foreground">#{ap.seq_producao}</span>
            <span className="text-sm font-semibold truncate">{ap.produto}</span>
            {eff !== null && (
              <span className={cn(
                "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                eff >= 95 ? "bg-green-500/10 text-green-600" :
                eff >= 80 ? "bg-amber-500/10 text-amber-600" :
                "bg-red-500/10 text-red-600"
              )}>{eff}%</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground flex-wrap">
            <span>{ap.maquina_codigo}</span>
            <span>{ap.turno}</span>
            <span>{new Date(ap.data_apontamento).toLocaleDateString("pt-BR")}</span>
            <span className="font-medium text-foreground">
              {ap.quantidade.toLocaleString("pt-BR")} pç produzidas
            </span>
          </div>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/20 pt-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
            <div><p className="text-muted-foreground">Lote</p><p className="font-medium font-mono">{ap.lote}</p></div>
            <div><p className="text-muted-foreground">Operador</p><p className="font-medium">{ap.operador}</p></div>
            <div><p className="text-muted-foreground">Qtde/Hora</p><p className="font-medium">{ap.qtde_por_hora}</p></div>
            <div><p className="text-muted-foreground">Horas Plan.</p><p className="font-medium">{ap.horas_planejadas}h</p></div>
            <div><p className="text-muted-foreground">Qtde Prevista</p><p className="font-medium">{ap.qtde_prevista?.toLocaleString("pt-BR")} pç</p></div>
            <div><p className="text-muted-foreground">Plan. Disp.</p><p className="font-medium">{ap.qtde_plan_disp?.toLocaleString("pt-BR")} pç</p></div>
            <div><p className="text-muted-foreground">Início</p><p className="font-medium">{horasParaHHMM(ap.horario_inicio)}</p></div>
            <div><p className="text-muted-foreground">Fim</p><p className="font-medium">{horasParaHHMM(ap.horario_fim)}</p></div>
          </div>
          {ap.descricao_mp && (
            <div className="rounded-lg bg-muted/20 px-3 py-2 text-[11px] space-y-1">
              <p className="text-muted-foreground">Matéria-Prima</p>
              <p className="font-medium">{ap.descricao_mp}</p>
              <div className="flex gap-4 text-muted-foreground">
                {ap.lote_mp && <span>Lote MP: <span className="font-mono text-foreground">{ap.lote_mp}</span></span>}
                {ap.consumo_mp_metros && <span>Consumo: {ap.consumo_mp_metros.toLocaleString("pt-BR")} m</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Panel principal ────────────────────────────────────────────────────────────

export function ControlePanel() {
  const [apontamentos, setApontamentos] = useState<Apontamento[]>([]);
  const [maquinas, setMaquinas]         = useState<Maquina[]>([]);
  const [produtos, setProdutos]         = useState<Produto[]>([]);
  const [tiposParada, setTiposParada]   = useState<TipoParada[]>([]);
  const [tiposRefugo, setTiposRefugo]   = useState<TipoRefugo[]>([]);
  const [materiasPrimas, setMateriasPrimas] = useState<MateriaPrima[]>([]);
  const [loading, setLoading]           = useState(true);
  const [modalOpen, setModalOpen]       = useState(false);
  const [filtroData, setFiltroData]     = useState(new Date().toISOString().split("T")[0]);

  const load = useCallback(async () => {
    setLoading(true);
    const [maqR, prodR, tpR, trR, mpR, apR] = await Promise.all([
      supabase.from("maquinas_producao").select("codigo,nome").order("codigo"),
      supabase.from("produtos_producao").select("codigo,descricao,pecas_por_hora").eq("ativo", true).order("codigo"),
      supabase.from("tipo_parada_producao").select("id,nome,categoria").eq("ativo", true).order("id"),
      supabase.from("tipo_refugo_producao").select("id,nome").eq("ativo", true).order("id"),
      supabase.from("materias_primas_producao").select("codigo,descricao,lote_atual").order("codigo"),
      supabase.from("apontamentos_producao")
        .select("id,seq_producao,data_apontamento,turno,maquina_codigo,produto,descricao_produto,qtde_por_hora,horas_planejadas,qtde_prevista,qtde_plan_disp,quantidade,horario_inicio,horario_fim,lote,lote_mp,descricao_mp,consumo_mp_metros,operador,status,created_at")
        .eq("data_apontamento", filtroData)
        .order("seq_producao", { ascending: false }),
    ]);
    if (maqR.data) setMaquinas(maqR.data as Maquina[]);
    if (prodR.data) setProdutos(prodR.data as Produto[]);
    if (tpR.data) setTiposParada(tpR.data as TipoParada[]);
    if (trR.data) setTiposRefugo(trR.data as TipoRefugo[]);
    if (mpR.data) setMateriasPrimas(mpR.data as MateriaPrima[]);
    if (apR.data) setApontamentos(apR.data as Apontamento[]);
    setLoading(false);
  }, [filtroData]);

  useEffect(() => { load(); }, [load]);

  // KPIs do dia
  const kpis = useMemo(() => ({
    totalProduzido: apontamentos.reduce((s, a) => s + a.quantidade, 0),
    totalPrevisto:  apontamentos.reduce((s, a) => s + (a.qtde_plan_disp || 0), 0),
    totalAps:       apontamentos.length,
    maquinasAtivas: new Set(apontamentos.map(a => a.maquina_codigo)).size,
  }), [apontamentos]);

  const eficiencia = kpis.totalPrevisto > 0
    ? Math.round(kpis.totalProduzido / kpis.totalPrevisto * 100)
    : null;

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Header com data */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="date"
          value={filtroData}
          onChange={e => setFiltroData(e.target.value)}
          className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <span className="text-[11px] text-muted-foreground">
          {apontamentos.length} apontamento(s)
        </span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" className="h-9 px-2" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
          <Button size="sm" className="gap-1 h-9" onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" /> Novo Apontamento
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Peças Produzidas", value: kpis.totalProduzido.toLocaleString("pt-BR"), color: "text-green-600", bg: "bg-green-500/5 border-green-500/20" },
          { label: "Peças Previstas", value: kpis.totalPrevisto.toLocaleString("pt-BR"), color: "text-blue-600", bg: "bg-blue-500/5 border-blue-500/20" },
          { label: "Eficiência", value: eficiencia !== null ? `${eficiencia}%` : "—", color: eficiencia !== null ? (eficiencia >= 95 ? "text-green-600" : eficiencia >= 80 ? "text-amber-600" : "text-red-600") : "text-muted-foreground", bg: "bg-card border-border/40" },
          { label: "Máquinas Ativas", value: String(kpis.maquinasAtivas), color: "text-purple-600", bg: "bg-purple-500/5 border-purple-500/20" },
        ].map(k => (
          <div key={k.label} className={cn("rounded-2xl border p-3 space-y-1", k.bg)}>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{k.label}</p>
            <p className={cn("text-xl font-bold", k.color)}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2">
          <RefreshCw className="h-4 w-4 animate-spin" /> Carregando...
        </div>
      ) : apontamentos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-sm gap-2">
          <ClipboardList className="h-8 w-8 opacity-30" />
          <p>Nenhum apontamento nesta data</p>
          <p className="text-[11px]">Clique em "Novo Apontamento" para registrar</p>
        </div>
      ) : (
        <div className="space-y-2">
          {apontamentos.map(ap => <ApontamentoCard key={ap.id} ap={ap} />)}
        </div>
      )}

      <NovoApontamentoModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => { setModalOpen(false); load(); }}
        maquinas={maquinas}
        produtos={produtos}
        tiposParada={tiposParada}
        tiposRefugo={tiposRefugo}
        materiasPrimas={materiasPrimas}
      />
    </div>
  );
}
