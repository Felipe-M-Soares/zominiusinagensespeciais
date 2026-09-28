/**
 * ControlePanel — Apontamento detalhado (formulário PPI-51).
 * Campos: data, turno, máquina, peça, qtde/hora, horas planejadas, horários,
 * paradas múltiplas, refugos múltiplos, matéria-prima + lote MP + consumo.
 *
 * Funciona offline: o apontamento vai para a fila (saveRpcWithFallback) e
 * pode ser editado/cancelado enquanto não sincroniza; o formulário guarda
 * rascunho automático. Apontamentos já sincronizados são corrigidos pela
 * RPC editar_apontamento_producao (mesmo diálogo do Diário).
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Plus, X, ClipboardList, RefreshCw, WifiOff, ChevronDown, ChevronLeft, ChevronRight, Clock, Trash2,
  CheckCircle2, Factory, Pencil, AlertTriangle, FileSpreadsheet, Loader2, Package, Gauge, Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { useAuth } from "@/hooks/useAuth";
import { temPapel } from "@/types/roles";
import { PecaCombobox, carregarPecasProducao, type PecaOption } from "@/components/producao/PecaCombobox";
import { EditarApontamentoDialog, type ApontamentoHoje } from "@/components/producao/LancamentoDiarioPanel";
import {
  KpiCard, Carregando, Vazio, BotaoAtualizar, Confirmar, Campo, selCls, tomPct, TOM_TXT, fmtInt, hojeISO, isoDiaLocal,
} from "@/components/producao/ProducaoUI";

// ── Tipos ────────────────────────────────────────────────────────────────────

interface Maquina   { id: string; codigo: string; nome: string; }
interface Produto   { id: string; codigo: string; descricao: string; pecas_por_hora: number; }
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
  user_id?: string | null;
  /** true quando o apontamento foi salvo offline e ainda aguarda
   * sincronização real com o servidor — seq/lote ainda são provisórios. */
  __pendingSync?: boolean;
  created_at: string;
}

const TURNOS = ["1º Turno", "2º Turno", "3º Turno"];

// Converte horas decimais para HH:MM (ex: 15.25 → "15:15")
function horasParaHHMM(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// Converte HH:MM para horas decimais (ex: "15:15" → 15.25)
function hhmmParaHoras(s: string): number {
  const [hh, mm] = s.split(":").map(Number);
  return (hh || 0) + (mm || 0) / 60;
}

const decimal = (v: string) => v.replace(/[^\d.,]/g, "").replace(",", ".");
const fmtDataLonga = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });

const formVazio = () => ({
  data: hojeISO(),
  turno: "1º Turno", maquina: "", produto: "",
  qtde_por_hora: "", horas_planejadas: "", qtde_plan_disp: "",
  qtde_produzida: "", horario_inicio: "06:00", horario_fim: "15:00",
  operador: "", lote_mp: "", descricao_mp: "", comprimento_mm: "",
  consumo_mp_metros: "", lote: "",
});

// ── Modal de Novo Apontamento ─────────────────────────────────────────────────

function NovoApontamentoModal({
  open, onClose, onSaved, maquinas, produtos, pecas, tiposParada, tiposRefugo, materiasPrimas,
  saveRpcWithFallback, updatePendingApontamento, getEditDataForPending, editandoLocalId,
  saveDraft, loadDraft, clearDraft,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  maquinas: Maquina[];
  produtos: Produto[];
  pecas: PecaOption[];
  tiposParada: TipoParada[];
  tiposRefugo: TipoRefugo[];
  materiasPrimas: MateriaPrima[];
  saveRpcWithFallback: ReturnType<typeof useOfflineSync>["saveRpcWithFallback"];
  updatePendingApontamento: ReturnType<typeof useOfflineSync>["updatePendingApontamento"];
  getEditDataForPending: ReturnType<typeof useOfflineSync>["getEditDataForPending"];
  saveDraft: ReturnType<typeof useOfflineSync>["saveDraft"];
  loadDraft: ReturnType<typeof useOfflineSync>["loadDraft"];
  clearDraft: ReturnType<typeof useOfflineSync>["clearDraft"];
  /** Quando definido, o modal abre em modo edição de um apontamento ainda
   * pendente (não sincronizado), identificado pelo id local (__pendingSync). */
  editandoLocalId?: string | null;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(formVazio);
  const [paradas, setParadas] = useState<ItemParada[]>([]);
  const [refugos, setRefugos] = useState<ItemRefugo[]>([]);
  /** Peça para a qual o ritmo (qtde/hora) já foi sugerido/restaurado. */
  const ritmoSugeridoPara = useRef<string>("");

  useEffect(() => {
    if (!open) {
      ritmoSugeridoPara.current = "";
      setStep(1);
      setForm(formVazio());
      setParadas([]);
      setRefugos([]);
    }
  }, [open]);

  // Ao abrir para um NOVO apontamento, tenta restaurar o rascunho salvo
  // automaticamente (protege contra queda de energia/aba fechada).
  useEffect(() => {
    if (!open || editandoLocalId) return;
    (async () => {
      const draft = await loadDraft();
      if (!draft) return;
      const d = draft.data as ReturnType<typeof formVazio> & { __paradas?: ItemParada[]; __refugos?: ItemRefugo[] };
      if (d.qtde_por_hora) ritmoSugeridoPara.current = d.produto;
      setForm({
        data: d.data, turno: d.turno, maquina: d.maquina, produto: d.produto,
        qtde_por_hora: d.qtde_por_hora, horas_planejadas: d.horas_planejadas,
        qtde_plan_disp: d.qtde_plan_disp, qtde_produzida: d.qtde_produzida,
        horario_inicio: d.horario_inicio, horario_fim: d.horario_fim,
        operador: d.operador, lote_mp: d.lote_mp, descricao_mp: d.descricao_mp,
        comprimento_mm: d.comprimento_mm, consumo_mp_metros: d.consumo_mp_metros, lote: d.lote,
      });
      if (d.__paradas) setParadas(d.__paradas);
      if (d.__refugos) setRefugos(d.__refugos);
      toast.info("Rascunho recuperado — continuando de onde você parou.", { duration: 4000 });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editandoLocalId]);

  // Rascunho automático (debounce) — só para novo apontamento.
  useEffect(() => {
    if (!open || editandoLocalId) return;
    const algoPreenchido = form.maquina || form.produto || form.operador || form.qtde_produzida;
    if (!algoPreenchido) return;
    const timer = setTimeout(() => {
      saveDraft({ ...form, __paradas: paradas, __refugos: refugos });
    }, 800);
    return () => clearTimeout(timer);
  }, [open, editandoLocalId, form, paradas, refugos, saveDraft]);

  // Edição de apontamento pendente: usa os argumentos RPC completos da fila.
  useEffect(() => {
    if (!open || !editandoLocalId) return;
    (async () => {
      const args = await getEditDataForPending(editandoLocalId);
      if (!args) {
        toast.error("Não foi possível carregar os dados deste apontamento para edição.");
        onClose();
        return;
      }
      const a = args as Record<string, unknown>;
      if (a.p_qtde_por_hora != null) ritmoSugeridoPara.current = String(a.p_produto ?? "");
      setForm({
        data: String(a.p_data ?? hojeISO()),
        turno: String(a.p_turno ?? "1º Turno"),
        maquina: String(a.p_maquina ?? ""),
        produto: String(a.p_produto ?? ""),
        qtde_por_hora: a.p_qtde_por_hora != null ? String(a.p_qtde_por_hora) : "",
        horas_planejadas: a.p_horas_planejadas != null ? String(a.p_horas_planejadas) : "",
        qtde_plan_disp: a.p_qtde_plan_disp != null ? String(a.p_qtde_plan_disp) : "",
        qtde_produzida: a.p_qtde_produzida != null ? String(a.p_qtde_produzida) : "",
        horario_inicio: typeof a.p_horario_inicio === "number" ? horasParaHHMM(a.p_horario_inicio) : "06:00",
        horario_fim: typeof a.p_horario_fim === "number" ? horasParaHHMM(a.p_horario_fim) : "15:00",
        operador: String(a.p_operador ?? ""),
        lote_mp: String(a.p_lote_mp ?? ""),
        descricao_mp: String(a.p_descricao_mp ?? ""),
        comprimento_mm: a.p_comprimento_mm != null ? String(a.p_comprimento_mm) : "",
        consumo_mp_metros: a.p_consumo_mp_metros != null ? String(a.p_consumo_mp_metros) : "",
        lote: String(a.p_lote ?? ""),
      });
      try {
        setParadas(a.p_paradas ? JSON.parse(String(a.p_paradas)) : []);
        setRefugos(a.p_refugos ? JSON.parse(String(a.p_refugos)) : []);
      } catch {
        setParadas([]);
        setRefugos([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editandoLocalId]);

  // Ritmo (qtde/hora) sugerido ao escolher a peça — só quando a peça MUDA.
  // Antes rodava também ao restaurar o rascunho / abrir um pendente para
  // edição (e quando as listas terminavam de carregar), sobrescrevendo o
  // ritmo que o operador tinha digitado.
  useEffect(() => {
    if (!form.produto || form.produto === ritmoSugeridoPara.current) return;
    const ph = produtos.find(p => p.codigo === form.produto)?.pecas_por_hora
      ?? pecas.find(p => p.codigo === form.produto)?.pecas_por_hora;
    if (!ph) return;
    ritmoSugeridoPara.current = form.produto;
    setForm(f => ({ ...f, qtde_por_hora: String(ph) }));
  }, [form.produto, produtos, pecas]);

  const qtdePrevista = useMemo(() => {
    const qh = parseFloat(form.qtde_por_hora) || 0;
    const hp = parseFloat(form.horas_planejadas) || 0;
    return Math.round(qh * hp);
  }, [form.qtde_por_hora, form.horas_planejadas]);

  const totalHrsParadas = useMemo(() => paradas.reduce((s, p) => s + (p.duracao_horas || 0), 0), [paradas]);
  const tempoDisponivel = useMemo(() => Math.max(0, (parseFloat(form.horas_planejadas) || 0) - totalHrsParadas), [form.horas_planejadas, totalHrsParadas]);
  const totalRefugos = useMemo(() => refugos.reduce((s, r) => s + (r.quantidade || 0), 0), [refugos]);

  function setF(k: keyof ReturnType<typeof formVazio>, v: string) {
    setForm(f => ({ ...f, [k]: v }));
  }

  function addParada(tp: TipoParada) {
    setParadas(p => [...p, { tipo_id: tp.id, tipo_nome: tp.nome, duracao_horas: 0 }]);
  }
  function setParadaMin(idx: number, min: number) {
    setParadas(p => p.map((item, i) => i === idx ? { ...item, duracao_horas: min / 60 } : item));
  }
  function removeParada(idx: number) {
    setParadas(p => p.filter((_, i) => i !== idx));
  }
  const qtdRefugo = (tipoId: number) => refugos.filter(r => r.tipo_id === tipoId).reduce((s, r) => s + (r.quantidade || 0), 0);
  function setRefugoQtd(tr: TipoRefugo, qtd: number) {
    setRefugos(r => {
      const outros = r.filter(x => x.tipo_id !== tr.id);
      return qtd > 0 ? [...outros, { tipo_id: tr.id, tipo_nome: tr.nome, quantidade: qtd }] : outros;
    });
  }

  const faltando = [!form.maquina && "máquina", !form.produto && "peça", !form.qtde_produzida && "quantidade produzida", !form.operador.trim() && "operador"].filter(Boolean) as string[];

  async function handleSave() {
    if (faltando.length) {
      toast.error(`Preencha: ${faltando.join(", ")}.`);
      setStep(1);
      return;
    }
    if (form.data > hojeISO()) { toast.error("Data do apontamento não pode ser no futuro."); return; }
    if (parseInt(form.qtde_produzida) < 0) { toast.error("Quantidade produzida não pode ser negativa."); return; }
    setSaving(true);
    try {
      const prod = produtos.find(p => p.codigo === form.produto);
      const descricao = prod?.descricao || pecas.find(p => p.codigo === form.produto)?.descricao || "";
      const rpcArgs = {
        p_data:               form.data,
        p_turno:              form.turno,
        p_maquina:            form.maquina,
        p_equipamento:        maquinas.find(m => m.codigo === form.maquina)?.nome || "",
        p_produto:            form.produto,
        p_descricao_produto:  descricao,
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
        p_operador:           form.operador.trim(),
        p_paradas:            JSON.stringify(paradas.filter(p => p.duracao_horas > 0)),
        p_refugos:            JSON.stringify(refugos.filter(r => r.quantidade > 0)),
      };

      // Preview local: usado só se salvar offline (seq/lote reais só existem
      // depois que o servidor confirma).
      const localPreview: Apontamento = {
        id: "",
        seq_producao: 0,
        data_apontamento: form.data,
        turno: form.turno,
        maquina_codigo: form.maquina,
        produto: form.produto,
        descricao_produto: descricao,
        qtde_por_hora: parseFloat(form.qtde_por_hora) || 0,
        horas_planejadas: parseFloat(form.horas_planejadas) || 0,
        qtde_prevista: qtdePrevista,
        qtde_plan_disp: parseFloat(form.qtde_plan_disp) || qtdePrevista,
        quantidade: parseInt(form.qtde_produzida) || 0,
        horario_inicio: hhmmParaHoras(form.horario_inicio),
        horario_fim: hhmmParaHoras(form.horario_fim),
        lote: form.lote || "(gerado ao sincronizar)",
        lote_mp: form.lote_mp,
        descricao_mp: form.descricao_mp,
        consumo_mp_metros: parseFloat(form.consumo_mp_metros) || undefined,
        operador: form.operador.trim(),
        status: "concluido",
        created_at: new Date().toISOString(),
      };

      const result = editandoLocalId
        ? await updatePendingApontamento(editandoLocalId, "apontamentos", rpcArgs, localPreview as unknown as Record<string, unknown>)
        : await saveRpcWithFallback("criar_apontamento_ppi51", rpcArgs, "apontamentos", localPreview as unknown as Record<string, unknown>);

      if (!result.ok) { toast.error(result.error ?? "Erro ao salvar apontamento."); return; }

      if (editandoLocalId) toast.success("Apontamento pendente atualizado.");
      else if ("savedOffline" in result && result.savedOffline) toast.warning("Sem conexão — apontamento salvo no aparelho e será enviado ao reconectar.", { duration: 5000 });
      else toast.success("Apontamento registrado!");
      if (!editandoLocalId) await clearDraft();
      onSaved();
      onClose();
    } catch (e: unknown) {
      toast.error("Erro ao salvar: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  }

  // Fechamento manual descarta o rascunho (decisão deliberada do operador).
  async function handleFecharManual() {
    if (!editandoLocalId) await clearDraft();
    onClose();
  }

  if (!open) return null;

  const efic = qtdePrevista > 0 && form.qtde_produzida ? Math.round((parseInt(form.qtde_produzida) / (parseFloat(form.qtde_plan_disp) || qtdePrevista)) * 100) : null;
  const passos = [
    { n: 1 as const, label: "Produção", extra: form.qtde_produzida ? `${form.qtde_produzida} pç` : "" },
    { n: 2 as const, label: "Paradas", extra: paradas.length ? `${paradas.length}` : "" },
    { n: 3 as const, label: "Refugo", extra: totalRefugos ? `${totalRefugos}` : "" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true" aria-labelledby="novo-ap-titulo">
      <div className="w-full max-w-2xl bg-card sm:rounded-2xl rounded-t-2xl border shadow-2xl flex flex-col h-[100dvh] sm:h-auto sm:max-h-[92vh]">

        {/* Cabeçalho */}
        <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-3 border-b shrink-0">
          <div className="min-w-0">
            <h3 id="novo-ap-titulo" className="font-semibold">{editandoLocalId ? "Editar apontamento pendente" : "Novo apontamento"}</h3>
            <p className="text-xs text-muted-foreground">Formulário completo (PPI-51)</p>
          </div>
          <Button variant="ghost" size="icon" className="h-10 w-10" onClick={handleFecharManual} aria-label="Fechar"><X className="h-5 w-5" /></Button>
        </div>

        {/* Etapas */}
        <div className="grid grid-cols-3 gap-1 px-3 sm:px-5 py-2 border-b shrink-0" role="tablist" aria-label="Etapas">
          {passos.map(s => (
            <button key={s.n} type="button" role="tab" aria-selected={step === s.n} onClick={() => setStep(s.n)}
              className={cn("h-11 rounded-xl text-sm font-medium flex items-center justify-center gap-1.5 transition-colors min-w-0",
                step === s.n ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/60")}>
              <span className={cn("h-5 w-5 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0", step === s.n ? "bg-white/25" : "bg-muted")}>{s.n}</span>
              <span className="truncate">{s.label}</span>
              {s.extra && <span className={cn("hidden sm:inline text-[11px] rounded-full px-1.5", step === s.n ? "bg-white/20" : "bg-muted")}>{s.extra}</span>}
            </button>
          ))}
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-4">
          {step === 1 && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Campo label="Data"><Input type="date" value={form.data} max={hojeISO()} onChange={e => setF("data", e.target.value)} className="h-11" /></Campo>
                <Campo label="Turno">
                  <select value={form.turno} onChange={e => setF("turno", e.target.value)} className={selCls}>
                    {TURNOS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Campo>
              </div>

              <Campo label="Máquina *">
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {maquinas.map(m => (
                    <button key={m.codigo} type="button" onClick={() => setF("maquina", m.codigo)} aria-pressed={form.maquina === m.codigo}
                      className={cn("rounded-xl border-2 px-2 py-2 text-left transition-colors min-w-0",
                        form.maquina === m.codigo ? "border-primary bg-primary/10" : "border-border hover:border-primary/40")}>
                      <span className="block text-sm font-bold">{m.codigo}</span>
                      <span className="block text-[11px] text-muted-foreground truncate">{m.nome}</span>
                    </button>
                  ))}
                </div>
              </Campo>

              <Campo label="Peça *">
                <PecaCombobox pecas={pecas} value={form.produto} onChange={v => setF("produto", v)} placeholder="Buscar peça por nome, código ou referência..." />
              </Campo>

              <Campo label="Operador *">
                <Input value={form.operador} onChange={e => setF("operador", e.target.value)} placeholder="Nome do operador" className="h-11" autoComplete="name" />
              </Campo>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Campo label="Peças/hora">
                  <Input inputMode="decimal" value={form.qtde_por_hora} onChange={e => setF("qtde_por_hora", decimal(e.target.value))} placeholder="Ex: 22" className="h-11 tabular-nums" />
                </Campo>
                <Campo label="Horas planejadas">
                  <Input inputMode="decimal" value={form.horas_planejadas} onChange={e => setF("horas_planejadas", decimal(e.target.value))} placeholder="Ex: 9" className="h-11 tabular-nums" />
                </Campo>
                <Campo label="Previsto" className="col-span-2 sm:col-span-1">
                  <div className="h-11 rounded-xl border bg-muted/40 px-3 flex items-center text-sm font-semibold tabular-nums">{fmtInt(qtdePrevista)} pç</div>
                </Campo>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Campo label="Produzidas (boas) *">
                  <Input inputMode="numeric" value={form.qtde_produzida} onChange={e => setF("qtde_produzida", e.target.value.replace(/\D/g, ""))} placeholder="Ex: 188"
                    className={cn("h-12 text-lg font-bold tabular-nums", form.qtde_produzida && "border-primary")} />
                </Campo>
                <Campo label="Plan. disponível" dica="vazio = previsto">
                  <Input inputMode="numeric" value={form.qtde_plan_disp} onChange={e => setF("qtde_plan_disp", e.target.value.replace(/\D/g, ""))} placeholder={String(qtdePrevista)} className="h-12 tabular-nums" />
                </Campo>
              </div>
              {efic !== null && isFinite(efic) && (
                <p className="rounded-xl bg-muted/40 px-3 py-2 text-sm">
                  Eficiência: <strong className={TOM_TXT[tomPct(efic, 95, 80)]}>{efic}%</strong> <span className="text-muted-foreground">do planejado</span>
                </p>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Campo label="Início"><Input type="time" value={form.horario_inicio} onChange={e => setF("horario_inicio", e.target.value)} className="h-11" /></Campo>
                <Campo label="Fim"><Input type="time" value={form.horario_fim} onChange={e => setF("horario_fim", e.target.value)} className="h-11" /></Campo>
              </div>

              <details className="rounded-xl border group" open={!!(form.descricao_mp || form.lote_mp || form.consumo_mp_metros || form.lote)}>
                <summary className="flex items-center gap-2 px-3 h-11 cursor-pointer select-none text-sm font-semibold list-none">
                  <Layers className="h-4 w-4 text-muted-foreground" /> Matéria-prima e lote <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
                  <ChevronDown className="h-4 w-4 ml-auto transition-transform group-open:rotate-180" />
                </summary>
                <div className="px-3 pb-3 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Campo label="Matéria-prima">
                      <select value={form.descricao_mp} onChange={e => {
                        const mp = materiasPrimas.find(m => m.descricao === e.target.value);
                        setForm(f => ({ ...f, descricao_mp: e.target.value, lote_mp: f.lote_mp || mp?.lote_atual || "" }));
                      }} className={selCls}>
                        <option value="">Selecione...</option>
                        {materiasPrimas.map(m => <option key={m.codigo} value={m.descricao}>{m.descricao}</option>)}
                      </select>
                    </Campo>
                    <Campo label="Lote MP"><Input value={form.lote_mp} onChange={e => setF("lote_mp", e.target.value)} placeholder="Ex: 160426-01" className="h-11" /></Campo>
                    <Campo label="Comprimento da peça (mm)"><Input inputMode="decimal" value={form.comprimento_mm} onChange={e => setF("comprimento_mm", decimal(e.target.value))} placeholder="Ex: 11,0" className="h-11 tabular-nums" /></Campo>
                    <Campo label="Consumo MP (metros)"><Input inputMode="decimal" value={form.consumo_mp_metros} onChange={e => setF("consumo_mp_metros", decimal(e.target.value))} placeholder="Ex: 20,68" className="h-11 tabular-nums" /></Campo>
                  </div>
                  <Campo label="Lote da produção" dica="Deixe vazio para o sistema gerar."><Input value={form.lote} onChange={e => setF("lote", e.target.value)} className="h-11" /></Campo>
                </div>
              </details>
            </>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-muted/40 px-2 py-2"><p className="text-[11px] text-muted-foreground">Planejadas</p><p className="font-bold tabular-nums">{parseFloat(form.horas_planejadas) || 0} h</p></div>
                <div className="rounded-xl bg-muted/40 px-2 py-2"><p className="text-[11px] text-muted-foreground">Paradas</p><p className="font-bold tabular-nums text-amber-600">{totalHrsParadas.toFixed(2).replace(".", ",")} h</p></div>
                <div className="rounded-xl bg-muted/40 px-2 py-2"><p className="text-[11px] text-muted-foreground">Disponível</p><p className="font-bold tabular-nums text-green-600">{tempoDisponivel.toFixed(2).replace(".", ",")} h</p></div>
              </div>

              {paradas.length > 0 && (
                <ul className="rounded-xl border divide-y">
                  {paradas.map((p, idx) => (
                    <li key={idx} className="flex items-center gap-2 px-3 py-2">
                      <span className="flex-1 text-sm font-medium truncate">{p.tipo_nome}</span>
                      <Input inputMode="numeric" aria-label={`Minutos de ${p.tipo_nome}`} value={p.duracao_horas ? String(Math.round(p.duracao_horas * 60)) : ""}
                        onChange={e => setParadaMin(idx, parseInt(e.target.value.replace(/\D/g, "")) || 0)} placeholder="min" className="h-11 w-20 text-center text-base font-semibold tabular-nums" autoFocus={!p.duracao_horas} />
                      <span className="text-xs text-muted-foreground">min</span>
                      <Button variant="ghost" size="icon" className="h-10 w-10 text-muted-foreground hover:text-destructive" onClick={() => removeParada(idx)} aria-label="Remover parada"><Trash2 className="h-4 w-4" /></Button>
                    </li>
                  ))}
                </ul>
              )}

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{paradas.length ? "Adicionar outra parada" : "Toque no motivo para adicionar"}</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {tiposParada.map(t => (
                    <button key={t.id} type="button" onClick={() => addParada(t)}
                      className="min-h-[2.75rem] rounded-xl border-2 border-dashed px-3 py-1.5 text-left text-sm font-medium leading-tight hover:border-primary/50 hover:bg-primary/5 flex items-center gap-1.5">
                      <Plus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />{t.nome}
                    </button>
                  ))}
                </div>
                {tiposParada.length === 0 && <p className="text-sm text-muted-foreground">Tipos de parada indisponíveis (sem conexão).</p>}
              </div>
              {paradas.length === 0 && <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />Se não houve paradas, pode seguir.</p>}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <p className="rounded-xl bg-muted/40 px-3 py-2 text-sm">
                Produzidas: <strong>{form.qtde_produzida || "—"}</strong> · Refugo: <strong className="text-red-600">{totalRefugos}</strong>
                {form.qtde_produzida && totalRefugos > 0 && <span className="text-muted-foreground"> ({((totalRefugos / (parseInt(form.qtde_produzida) + totalRefugos)) * 100).toFixed(1).replace(".", ",")}%)</span>}
              </p>
              {tiposRefugo.length === 0 ? <p className="text-sm text-muted-foreground">Tipos de refugo indisponíveis (sem conexão).</p> : (
                <ul className="rounded-xl border divide-y">
                  {tiposRefugo.map(t => {
                    const q = qtdRefugo(t.id);
                    return (
                      <li key={t.id} className="flex items-center gap-2 px-3 py-2">
                        <span className={cn("flex-1 text-sm truncate", q > 0 && "font-semibold")}>{t.nome}</span>
                        <Button variant="outline" size="icon" className="h-11 w-11" onClick={() => setRefugoQtd(t, Math.max(0, q - 1))} aria-label={`Menos ${t.nome}`} disabled={q <= 0}>−</Button>
                        <Input inputMode="numeric" aria-label={`Refugo ${t.nome}`} value={q || ""} placeholder="0"
                          onChange={e => setRefugoQtd(t, parseInt(e.target.value.replace(/\D/g, "")) || 0)} className="h-11 w-16 text-center text-base font-semibold tabular-nums" />
                        <Button variant="outline" size="icon" className="h-11 w-11" onClick={() => setRefugoQtd(t, q + 1)} aria-label={`Mais ${t.nome}`}>+</Button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {totalRefugos === 0 && <p className="text-xs text-muted-foreground flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-green-600" />Sem refugo? É só registrar.</p>}
            </div>
          )}
        </div>

        {/* Rodapé fixo */}
        <div className="flex items-center gap-2 px-4 sm:px-5 py-3 border-t shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button variant="outline" className="h-12 sm:h-11 gap-1" onClick={() => step > 1 ? setStep((step - 1) as 1 | 2 | 3) : handleFecharManual()}>
            {step > 1 ? <ChevronLeft className="h-4 w-4" /> : null}{step > 1 ? "Voltar" : "Cancelar"}
          </Button>
          <div className="flex-1" />
          {step < 3 && (
            <Button variant={step === 1 && faltando.length === 0 ? "outline" : "default"} className="h-12 sm:h-11 gap-1" onClick={() => setStep((step + 1) as 1 | 2 | 3)}>
              Próximo <ChevronRight className="h-4 w-4" />
            </Button>
          )}
          {(step === 3 || faltando.length === 0) && (
            <Button onClick={handleSave} disabled={saving} className="h-12 sm:h-11 gap-1.5 bg-green-600 hover:bg-green-500 text-white">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {saving ? "Salvando..." : "Registrar"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Detalhes de um apontamento (expandido) ────────────────────────────────────

function Detalhes({ ap }: { ap: Apontamento }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-xs">
        <div><p className="text-muted-foreground">Lote</p><p className="font-medium font-mono break-all">{ap.lote}</p></div>
        <div><p className="text-muted-foreground">Operador</p><p className="font-medium">{ap.operador}</p></div>
        <div><p className="text-muted-foreground">Peças/hora</p><p className="font-medium tabular-nums">{ap.qtde_por_hora}</p></div>
        <div><p className="text-muted-foreground">Horas plan.</p><p className="font-medium tabular-nums">{ap.horas_planejadas}h</p></div>
        <div><p className="text-muted-foreground">Previsto</p><p className="font-medium tabular-nums">{fmtInt(ap.qtde_prevista ?? 0)} pç</p></div>
        <div><p className="text-muted-foreground">Plan. disp.</p><p className="font-medium tabular-nums">{fmtInt(ap.qtde_plan_disp ?? 0)} pç</p></div>
        <div><p className="text-muted-foreground">Horário</p><p className="font-medium tabular-nums">{horasParaHHMM(ap.horario_inicio)} – {horasParaHHMM(ap.horario_fim)}</p></div>
        {ap.descricao_produto && <div><p className="text-muted-foreground">Peça</p><p className="font-medium truncate">{ap.descricao_produto}</p></div>}
      </div>
      {ap.descricao_mp && (
        <div className="rounded-xl bg-muted/40 px-3 py-2 text-xs">
          <p className="text-muted-foreground">Matéria-prima</p>
          <p className="font-medium">{ap.descricao_mp}</p>
          <div className="flex flex-wrap gap-x-4 text-muted-foreground">
            {ap.lote_mp && <span>Lote MP: <span className="font-mono text-foreground">{ap.lote_mp}</span></span>}
            {ap.consumo_mp_metros ? <span>Consumo: {ap.consumo_mp_metros.toLocaleString("pt-BR")} m</span> : null}
          </div>
        </div>
      )}
    </div>
  );
}

const efic = (ap: Apontamento) => ap.qtde_plan_disp > 0 ? Math.round(ap.quantidade / ap.qtde_plan_disp * 100) : null;
const ChipEfic = ({ v }: { v: number | null }) => v === null ? <span className="text-muted-foreground">—</span> : (
  <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold tabular-nums",
    v >= 95 ? "bg-green-500/10 text-green-700 dark:text-green-400" : v >= 80 ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-red-500/10 text-red-700 dark:text-red-400")}>{v}%</span>
);
const ChipPendente = () => (
  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400 whitespace-nowrap">
    <WifiOff className="h-3 w-3" />Não sincronizado
  </span>
);

// ── Panel principal ────────────────────────────────────────────────────────────

export function ControlePanel({ onImport }: { onImport?: () => void } = {}) {
  const { user, role } = useAuth();
  const gestor = temPapel(role, "producao");
  const [apontamentos, setApontamentos] = useState<Apontamento[]>([]);
  const [maquinas, setMaquinas]         = useState<Maquina[]>([]);
  const [produtos, setProdutos]         = useState<Produto[]>([]);
  const [pecasExtra, setPecasExtra]     = useState<PecaOption[] | null>(null);
  const [tiposParada, setTiposParada]   = useState<TipoParada[]>([]);
  const [tiposRefugo, setTiposRefugo]   = useState<TipoRefugo[]>([]);
  const [materiasPrimas, setMateriasPrimas] = useState<MateriaPrima[]>([]);
  const [loading, setLoading]           = useState(true);
  const [modalOpen, setModalOpen]       = useState(false);
  const [editandoLocalId, setEditandoLocalId] = useState<string | null>(null);
  const [corrigir, setCorrigir]         = useState<ApontamentoHoje | null>(null);
  const [cancelar, setCancelar]         = useState<Apontamento | null>(null);
  const [aberto, setAberto]             = useState<string | null>(null);
  const [filtroData, setFiltroData]     = useState(hojeISO);
  const { isOnline, pendingCount, oldestPendingDays, storageWarning, syncing, loadWithFallback, saveRpcWithFallback, updatePendingApontamento, getEditDataForPending, cancelPendingApontamento, saveDraft, loadDraft, clearDraft } = useOfflineSync();

  const load = useCallback(async () => {
    setLoading(true);
    // Máquinas e peças usam loadWithFallback — o formulário precisa delas
    // mesmo offline. Tipos de parada/refugo/MP vêm direto (mudam pouco).
    const [maqData, prodData, tpR, trR, mpR] = await Promise.all([
      loadWithFallback<Maquina>("maquinas_producao", "maquinas", (q) => q.select("id,codigo,nome").order("codigo") as never),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      loadWithFallback<Produto>("produtos_producao", "produtos_producao", (q: any) => q.select("id,codigo,descricao,pecas_por_hora").eq("ativo", true).order("codigo")),
      supabase.from("tipo_parada_producao").select("id,nome,categoria").eq("ativo", true).order("id"),
      supabase.from("tipo_refugo_producao").select("id,nome").eq("ativo", true).order("id"),
      supabase.from("materias_primas_producao").select("codigo,descricao,lote_atual").order("codigo"),
    ]);
    setMaquinas([...maqData].sort((a, b) => a.codigo.localeCompare(b.codigo)));
    setProdutos(prodData);
    if (tpR.data) setTiposParada(tpR.data as TipoParada[]);
    if (trR.data) setTiposRefugo(trR.data as TipoRefugo[]);
    if (mpR.data) setMateriasPrimas(mpR.data as MateriaPrima[]);

    // Apontamentos do dia: online do servidor; offline, cache + fila pendente.
    if (navigator.onLine) {
      const apR = await supabase.from("apontamentos_producao")
        .select("id,seq_producao,data_apontamento,turno,maquina_codigo,produto,descricao_produto,qtde_por_hora,horas_planejadas,qtde_prevista,qtde_plan_disp,quantidade,horario_inicio,horario_fim,lote,lote_mp,descricao_mp,consumo_mp_metros,operador,status,created_at,user_id")
        .eq("data_apontamento", filtroData)
        .order("seq_producao", { ascending: false });
      if (apR.data) setApontamentos(apR.data as Apontamento[]);
      else if (apR.error) toast.error("Não foi possível carregar os apontamentos.");
    } else {
      const cached = await loadWithFallback<Apontamento>("apontamentos_producao", "apontamentos");
      setApontamentos(cached.filter(a => a.data_apontamento === filtroData));
    }
    setLoading(false);
  }, [filtroData, loadWithFallback]);

  useEffect(() => { load(); }, [load]);

  // Peças do cadastro de Componentes (busca por nome/referência) — só online.
  useEffect(() => {
    if (!navigator.onLine || pecasExtra) return;
    carregarPecasProducao().then(setPecasExtra).catch(() => setPecasExtra([]));
  }, [pecasExtra]);

  const pecas: PecaOption[] = useMemo(() => {
    const base = produtos.map(p => ({ codigo: p.codigo, descricao: p.descricao, pecas_por_hora: p.pecas_por_hora ?? 0, origem: "producao" as const }));
    if (!pecasExtra?.length) return base;
    const cods = new Set(pecasExtra.map(p => p.codigo));
    return [...pecasExtra, ...base.filter(b => !cods.has(b.codigo))];
  }, [produtos, pecasExtra]);

  const kpis = useMemo(() => ({
    totalProduzido: apontamentos.reduce((s, a) => s + (a.quantidade || 0), 0),
    totalPrevisto:  apontamentos.reduce((s, a) => s + (a.qtde_plan_disp || 0), 0),
    totalAps:       apontamentos.length,
    maquinasAtivas: new Set(apontamentos.map(a => a.maquina_codigo)).size,
    horas:          apontamentos.reduce((s, a) => s + (Number(a.horas_planejadas) || 0), 0),
  }), [apontamentos]);
  const eficiencia = kpis.totalPrevisto > 0 ? Math.round(kpis.totalProduzido / kpis.totalPrevisto * 100) : null;

  function mudarDia(delta: number) {
    const d = new Date(`${filtroData}T12:00:00`); d.setDate(d.getDate() + delta);
    const iso = isoDiaLocal(d);
    if (iso > hojeISO()) return;
    setFiltroData(iso);
  }

  const podeCorrigir = (ap: Apontamento) => !ap.__pendingSync && (gestor || (!!user && ap.user_id === user.id));
  function abrirCorrecao(ap: Apontamento) {
    if (!isOnline) { toast.error("Sem internet — a correção precisa de conexão."); return; }
    setCorrigir({
      id: ap.id, maquina_codigo: ap.maquina_codigo, maquina: ap.maquina_codigo, produto: ap.produto,
      quantidade: ap.quantidade, qtde_plan_disp: ap.qtde_plan_disp, horas_planejadas: ap.horas_planejadas,
      turno: ap.turno, operador: ap.operador, created_at: ap.created_at,
    });
  }
  function editarPendente(ap: Apontamento) { setEditandoLocalId(ap.id); setModalOpen(true); }

  async function confirmarCancelamento() {
    if (!cancelar) return;
    const r = await cancelPendingApontamento(cancelar.id, "apontamentos");
    setCancelar(null);
    if (!r.ok) { toast.error(r.error ?? "Erro ao cancelar."); return; }
    toast.success("Apontamento pendente cancelado.");
    load();
  }

  const acoes = (ap: Apontamento, compacto = false) => (
    <div className={cn("flex items-center gap-1", compacto ? "" : "justify-end")}>
      {ap.__pendingSync ? (
        <>
          <Button size="sm" variant="outline" className="h-10 gap-1.5 border-amber-500/40 text-amber-700 dark:text-amber-400" onClick={() => editarPendente(ap)}><Pencil className="h-4 w-4" />Editar</Button>
          <Button size="sm" variant="outline" className="h-10 gap-1.5 border-red-500/40 text-red-700 dark:text-red-400" onClick={() => setCancelar(ap)}><Trash2 className="h-4 w-4" />Cancelar</Button>
        </>
      ) : podeCorrigir(ap) ? (
        <Button size={compacto ? "sm" : "icon"} variant={compacto ? "outline" : "ghost"} className={compacto ? "h-10 gap-1.5" : "h-9 w-9"} onClick={() => abrirCorrecao(ap)} aria-label={`Corrigir apontamento ${ap.seq_producao}`}>
          <Pencil className="h-4 w-4" />{compacto && "Corrigir"}
        </Button>
      ) : null}
    </div>
  );

  const ehHoje = filtroData === hojeISO();

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <p className="text-xs text-muted-foreground">
        <strong className="text-foreground">Apontamento detalhado</strong> por máquina, peça e turno (planilha PPI-51), com paradas, refugo e matéria-prima. Para o lançamento rápido de fim de turno use a aba <strong className="text-foreground">Diário</strong>.
      </p>

      {/* Dia + ações */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl border bg-card p-1">
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => mudarDia(-1)} aria-label="Dia anterior"><ChevronLeft className="h-4 w-4" /></Button>
          <label className="relative">
            <span className="sr-only">Data</span>
            <input type="date" value={filtroData} max={hojeISO()} onChange={e => e.target.value && setFiltroData(e.target.value)}
              className="h-9 rounded-lg bg-transparent px-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-ring" />
          </label>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => mudarDia(1)} disabled={ehHoje} aria-label="Próximo dia"><ChevronRight className="h-4 w-4" /></Button>
        </div>
        {!ehHoje && <Button variant="ghost" className="h-11" onClick={() => setFiltroData(hojeISO())}>Hoje</Button>}
        <BotaoAtualizar onClick={load} loading={loading} />
        <div className="flex gap-2 w-full sm:w-auto sm:ml-auto">
          {onImport && (
            <Button variant="outline" className="h-11 gap-1.5 flex-1 sm:flex-none" onClick={onImport}>
              <FileSpreadsheet className="h-4 w-4 text-green-600" /> Importar Excel
            </Button>
          )}
          <Button className="h-11 gap-1.5 flex-1 sm:flex-none" onClick={() => { setEditandoLocalId(null); setModalOpen(true); }}>
            <Plus className="h-4 w-4" /> Novo apontamento
          </Button>
        </div>
      </div>

      {/* Avisos de sincronização */}
      {(!isOnline || pendingCount > 0 || (oldestPendingDays !== null && oldestPendingDays >= 2) || storageWarning?.isCritical) && (
        <div className="flex flex-wrap gap-2">
          {!isOnline && (
            <span className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
              <WifiOff className="h-3.5 w-3.5" /> Sem internet — salvando no aparelho
            </span>
          )}
          {isOnline && pendingCount > 0 && (
            <span className="flex items-center gap-1.5 rounded-full bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-700 dark:text-blue-400">
              <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
              {syncing ? "Sincronizando..." : `${pendingCount} pendente(s) de envio`}
            </span>
          )}
          {oldestPendingDays !== null && oldestPendingDays >= 2 && (
            <span className="flex items-center gap-1.5 rounded-full bg-red-500/10 px-3 py-1 text-xs font-medium text-red-700 dark:text-red-400">
              <AlertTriangle className="h-3.5 w-3.5" /> Há {oldestPendingDays} dia{oldestPendingDays > 1 ? "s" : ""} sem sincronizar — conecte à internet
            </span>
          )}
          {storageWarning?.isCritical && (
            <span className="flex items-center gap-1.5 rounded-full bg-red-500/10 px-3 py-1 text-xs font-medium text-red-700 dark:text-red-400"
              title="Armazenamento local quase cheio — sincronize os apontamentos pendentes em breve.">
              <AlertTriangle className="h-3.5 w-3.5" /> Armazenamento do aparelho quase cheio ({Math.round(storageWarning.usageRatio * 100)}%)
            </span>
          )}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Produzido" Icon={Package} value={fmtInt(kpis.totalProduzido)}
          sub={kpis.totalPrevisto ? `de ${fmtInt(kpis.totalPrevisto)} planejadas` : "sem plano"}
          progresso={kpis.totalPrevisto ? { pct: (kpis.totalProduzido / kpis.totalPrevisto) * 100, tom: eficiencia !== null ? tomPct(eficiencia, 95, 80) : "neutro" } : null} />
        <KpiCard label="Eficiência" Icon={Gauge} value={eficiencia !== null ? `${eficiencia}%` : "—"}
          tom={eficiencia !== null ? tomPct(eficiencia, 95, 80) : "neutro"} sub="produzido ÷ planejado" />
        <KpiCard label="Apontamentos" Icon={ClipboardList} value={kpis.totalAps} sub={`${kpis.horas.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h lançadas`} />
        <KpiCard label="Máquinas" Icon={Factory} value={kpis.maquinasAtivas} sub={`de ${maquinas.length} com lançamento`} />
      </div>

      {/* Lista */}
      <section className="rounded-2xl border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm flex-1 capitalize">{ehHoje ? "Hoje" : fmtDataLonga(filtroData)}</h3>
          <span className="text-xs text-muted-foreground">{apontamentos.length} apontamento{apontamentos.length === 1 ? "" : "s"}</span>
        </div>
        {loading ? <Carregando /> : apontamentos.length === 0 ? (
          <Vazio Icon={ClipboardList} titulo="Nenhum apontamento nesta data"
            dica="Registre a produção de cada máquina com o formulário completo."
            acao={<Button className="h-11 gap-1.5" onClick={() => { setEditandoLocalId(null); setModalOpen(true); }}><Plus className="h-4 w-4" />Novo apontamento</Button>} />
        ) : (
          <>
            {/* Celular: cartões */}
            <ul className="md:hidden divide-y">
              {apontamentos.map(ap => {
                const exp = aberto === ap.id;
                return (
                  <li key={ap.id} className={cn(ap.__pendingSync && "bg-amber-500/[0.04]")}>
                    <button type="button" className="w-full text-left px-4 py-3 flex items-start gap-3" onClick={() => setAberto(exp ? null : ap.id)} aria-expanded={exp}>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm"><span className="font-mono text-xs text-muted-foreground">{ap.__pendingSync ? "#—" : `#${ap.seq_producao}`}</span>{" "}
                          <strong>{ap.maquina_codigo}</strong> · <strong>{ap.produto}</strong></p>
                        <p className="text-xs text-muted-foreground truncate">{ap.turno} · {horasParaHHMM(ap.horario_inicio)}–{horasParaHHMM(ap.horario_fim)} · {ap.operador}</p>
                        {ap.__pendingSync && <div className="mt-1"><ChipPendente /></div>}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-bold tabular-nums">{fmtInt(ap.quantidade)} <span className="text-xs font-normal text-muted-foreground">pç</span></p>
                        <ChipEfic v={efic(ap)} />
                      </div>
                      <ChevronDown className={cn("h-4 w-4 mt-1 text-muted-foreground shrink-0 transition-transform", exp && "rotate-180")} />
                    </button>
                    {exp && (
                      <div className="px-4 pb-4 space-y-3">
                        <Detalhes ap={ap} />
                        {acoes(ap, true)}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {/* Desktop: tabela */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2.5 font-semibold">#</th>
                    <th className="px-3 py-2.5 font-semibold">Máquina</th>
                    <th className="px-3 py-2.5 font-semibold">Peça</th>
                    <th className="px-3 py-2.5 font-semibold">Turno / horário</th>
                    <th className="px-3 py-2.5 font-semibold">Operador</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Produzido</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Planejado</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Efic.</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {apontamentos.map(ap => {
                    const exp = aberto === ap.id;
                    return [
                      <tr key={ap.id} className={cn("border-t cursor-pointer hover:bg-muted/30", ap.__pendingSync && "bg-amber-500/[0.04]", exp && "bg-muted/30")}
                        onClick={() => setAberto(exp ? null : ap.id)}>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground whitespace-nowrap">
                          <ChevronDown className={cn("inline h-3.5 w-3.5 mr-1 transition-transform", exp && "rotate-180")} />
                          {ap.__pendingSync ? "—" : ap.seq_producao}
                        </td>
                        <td className="px-3 py-2 font-semibold">{ap.maquina_codigo}</td>
                        <td className="px-3 py-2 max-w-[16rem]">
                          <p className="font-medium">{ap.produto}</p>
                          {ap.descricao_produto && <p className="text-xs text-muted-foreground truncate">{ap.descricao_produto}</p>}
                          {ap.__pendingSync && <ChipPendente />}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{ap.turno}<p className="text-xs text-muted-foreground tabular-nums">{horasParaHHMM(ap.horario_inicio)}–{horasParaHHMM(ap.horario_fim)}</p></td>
                        <td className="px-3 py-2 text-muted-foreground">{ap.operador}</td>
                        <td className="px-3 py-2 text-right font-bold tabular-nums">{fmtInt(ap.quantidade)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtInt(ap.qtde_plan_disp ?? 0)}</td>
                        <td className="px-3 py-2 text-right"><ChipEfic v={efic(ap)} /></td>
                        <td className="px-3 py-1.5" onClick={e => e.stopPropagation()}>{acoes(ap)}</td>
                      </tr>,
                      exp && (
                        <tr key={`${ap.id}-d`} className="bg-muted/20"><td colSpan={9} className="px-4 py-3"><Detalhes ap={ap} /></td></tr>
                      ),
                    ];
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <NovoApontamentoModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditandoLocalId(null); }}
        onSaved={() => { setModalOpen(false); setEditandoLocalId(null); load(); }}
        maquinas={maquinas}
        produtos={produtos}
        pecas={pecas}
        tiposParada={tiposParada}
        tiposRefugo={tiposRefugo}
        materiasPrimas={materiasPrimas}
        saveRpcWithFallback={saveRpcWithFallback}
        updatePendingApontamento={updatePendingApontamento}
        getEditDataForPending={getEditDataForPending}
        saveDraft={saveDraft}
        loadDraft={loadDraft}
        clearDraft={clearDraft}
        editandoLocalId={editandoLocalId}
      />
      <EditarApontamentoDialog apontamento={corrigir} onClose={() => setCorrigir(null)} onSaved={() => { setCorrigir(null); load(); }}
        maquinas={maquinas.map(m => ({ ...m, status: "" }))} pecas={pecas} tiposParada={tiposParada} tiposRefugo={tiposRefugo} />
      <Confirmar aberto={!!cancelar} titulo="Cancelar apontamento pendente?" acao="Cancelar apontamento"
        descricao="Ele ainda não foi enviado ao servidor. Os dados digitados serão perdidos."
        onConfirmar={confirmarCancelamento} onCancelar={() => setCancelar(null)} />
    </div>
  );
}
