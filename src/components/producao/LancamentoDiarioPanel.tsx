/**
 * LancamentoDiarioPanel — Aba "Diário" da Produção (lançamento rápido de turno)
 *
 * Redesenho (set/2026), no modelo usado por sistemas de apontamento de chão de
 * fábrica (Nomus "apontamento simplificado", Evocon, MachineMetrics):
 *   • um lançamento = uma máquina num turno, salvo na hora (sem "lista de
 *     blocos" intermediária que confundia o operador);
 *   • tudo por BOTÕES grandes — máquina, "produziu / só parou", peça recente,
 *     motivo de parada e duração — digitação só da quantidade;
 *   • operador e turno lembrados; ao salvar, já pula para a próxima máquina
 *     ainda sem lançamento ("salvar e manter", como no Nomus);
 *   • cálculo automático e visível: turno − paradas = tempo produtivo → peças
 *     esperadas e eficiência, antes de salvar.
 *
 * Lançamento por DIA (sem turno): cada máquina soma até 24h no dia. Dá para
 * lançar em outra data (ex.: ontem) e corrigir/excluir lançamentos já salvos.
 *
 * Registro por máquina/hora com todos os detalhes (planilha PPI-51) continua
 * na aba Controle.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import {
  RefreshCw, CheckCircle2, Clock, Package, Factory, Timer, TrendingUp, User, Loader2,
  CalendarDays, CalendarRange, Gauge, ChevronDown, Target, Minus, Plus, Hammer,
  PauseCircle, Wrench, Coffee, Settings2, AlertTriangle, ChevronRight, Pencil, Trash2,
  BarChart3, Boxes, Ruler,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PecaCombobox, carregarPecasProducao, type PecaOption } from "@/components/producao/PecaCombobox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import {
  calcularConsumo, metrosParaBarras, pecasPossiveis, pesoBarraKg,
  fmtMetros, fmtBarras, fmtKg, type BarraInfo,
} from "@/lib/barra";

// ── Lançamento diário ────────────────────────────────────────────────────────

const TURNO_DIA = "Dia inteiro";
const HORAS_DIA = 24;
/** Período de trabalho da fábrica (06:00 → 01:30 do dia seguinte). Quando a
 *  máquina "só ficou parada", a parada ocupa esse período inteiro (menos o
 *  que já tiver sido lançado para ela no dia). */
const JORNADA_H = 19.5;
const JORNADA_INICIO_H = 6;
/** A partir de quantos lançamentos o tempo aprendido passa a valer mais que o cadastro. */
const MIN_AMOSTRAS_APRENDIDO = 3;
/** Seletor de tempo: horas (0–24) + minutos (0–59), para valores quebrados como 9h15 ou 9h10. */
const OPCOES_H = Array.from({ length: HORAS_DIA + 1 }, (_, i) => i);
const OPCOES_MIN = Array.from({ length: 60 }, (_, i) => i);

/** Dois seletores lado a lado (horas e minutos). Valor em horas decimais; "" = não escolhido. */
function HorasMinutosSelect({ value, onChange, max = HORAS_DIA, ariaLabel, destaque = false }: {
  value: string; onChange: (v: string) => void; max?: number; ariaLabel: string; destaque?: boolean;
}) {
  const total = value === "" ? null : Math.round((parseFloat(value) || 0) * 60);
  const h = total === null ? "" : String(Math.floor(total / 60));
  const m = total === null ? "" : String(total % 60);
  const maxMin = Math.round(max * 60);
  const emitir = (hh: string, mm: string) => {
    if (hh === "" && mm === "") { onChange(""); return; }
    let t = (parseInt(hh) || 0) * 60 + (parseInt(mm) || 0);
    if (t > maxMin) t = maxMin;
    onChange(t === 0 ? "" : String(t / 60));
  };
  const cls = cn("h-12 rounded-xl border-2 bg-background px-3 text-base font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-ring",
    destaque ? "border-primary" : "border-input");
  return (
    <div className="flex items-center gap-2" role="group" aria-label={ariaLabel}>
      <select value={h} onChange={e => emitir(e.target.value, m === "" ? "0" : m)} aria-label="Horas" className={cn(cls, "w-24")}>
        <option value="">--</option>
        {OPCOES_H.map(x => <option key={x} value={x} disabled={x * 60 > maxMin}>{x}</option>)}
      </select>
      <span className="text-sm font-medium text-muted-foreground">h</span>
      <select value={m} onChange={e => emitir(h === "" ? "0" : h, e.target.value)} aria-label="Minutos" className={cn(cls, "w-24")}>
        <option value="">--</option>
        {OPCOES_MIN.map(x => <option key={x} value={x} disabled={(parseInt(h) || 0) * 60 + x > maxMin}>{String(x).padStart(2, "0")}</option>)}
      </select>
      <span className="text-sm font-medium text-muted-foreground">min</span>
    </div>
  );
}

// ── Tipos ────────────────────────────────────────────────────────────────────

interface Maquina    { id: string; codigo: string; nome: string; status: string; }
interface TipoParada { id: number; nome: string; categoria: string; }
interface TipoRefugo { id: number; nome: string; }
interface MateriaPrima extends BarraInfo {
  id: string; codigo: string; descricao: string; lote_atual?: string | null; unidade: string;
  estoque_atual: number; estoque_minimo: number; estoque_conferido_em?: string | null;
}
/** Barra que cada peça usa e quanto gasta por peça (tabela peca_materia_prima). */
interface VinculoBarra { produto: string; materia_prima_id: string; comprimento_peca_mm: number | null; corte_mm: number; }

export interface ApontamentoHoje {
  id: string; maquina_codigo: string | null; maquina: string; produto: string;
  quantidade: number; qtde_plan_disp: number; horas_planejadas: number; turno: string;
  operador: string; created_at: string;
  seq_producao?: number | null; qtde_por_hora?: number | null;
  descricao_mp?: string | null; consumo_mp_metros?: number | null; baixa_mp_metros?: number | null;
}
interface ParadaHoje {
  id: string; maquina: string; motivo: string; tipo: string;
  inicio: string; fim: string | null; duracao_min: number | null;
  operador: string; observacoes?: string | null; user_id?: string | null;
}
/** Parada escolhida no formulário (motivo + duração em minutos). */
interface ParadaForm { id: string; tipoId: number; minutos: number; pecaSetup?: string; }

interface OeePeriodo { disponibilidade: number; performance: number; qualidade: number; oee: number; qtde_produzida: number; hr_planejadas: number; }

type Modo = "produziu" | "parada";

const CORES_PIZZA = ["#22c55e", "#ef4444", "#f59e0b", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#64748b", "#a855f7"];
const OPERADOR_STORAGE_KEY = "diario_producao_operador";
const TURNO_STORAGE_KEY = "diario_producao_turno";
/** Turnos aceitos pelo banco (apontamentos_producao_turno_check), como na planilha PP-51. */
const TURNOS = [
  { v: TURNO_DIA,  l: "Dia" },
  { v: "1º Turno", l: "1º" },
  { v: "2º Turno", l: "2º" },
  { v: "3º Turno", l: "3º" },
] as const;
const decimal = (s: string) => s.replace(/[^\d.,]/g, "").replace(",", ".");
/** numeric do Postgres pode chegar como texto. */
const normMP = (m: MateriaPrima): MateriaPrima => ({
  ...m, estoque_atual: Number(m.estoque_atual) || 0, estoque_minimo: Number(m.estoque_minimo) || 0,
  peso_barra_kg: m.peso_barra_kg != null ? Number(m.peso_barra_kg) : null,
  comprimento_barra_m: Number(m.comprimento_barra_m) || 3, sobra_barra_mm: Number(m.sobra_barra_mm) || 0,
  diametro_mm: m.diametro_mm != null ? Number(m.diametro_mm) : null,
});
const ULTIMA_PECA_KEY = "diario_producao_ultima_peca"; // { [maquina]: codigo }
const DURACOES_MIN = [10, 15, 30, 45, 60, 90, 120];

const STATUS_MAQUINA: Record<string, { label: string; dot: string }> = {
  operando:   { label: "Operando",   dot: "bg-green-500" },
  setup:      { label: "Em setup",   dot: "bg-amber-500" },
  parada:     { label: "Parada",     dot: "bg-red-500" },
  manutencao: { label: "Manutenção", dot: "bg-red-500" },
};

/** Ícone/cor por categoria do código de parada — reconhecimento visual rápido. */
function estiloParada(categoria: string, nome: string) {
  const n = nome.toLowerCase();
  if (categoria === "setup")       return { Icon: Settings2, cor: "text-amber-700 dark:text-amber-400", bg: "bg-amber-500/10 border-amber-500/30" };
  if (categoria === "manutencao")  return { Icon: Wrench,    cor: "text-red-700 dark:text-red-400",     bg: "bg-red-500/10 border-red-500/30" };
  if (n.includes("refei") || n.includes("café") || n.includes("cafe"))
                                   return { Icon: Coffee,    cor: "text-sky-700 dark:text-sky-400",     bg: "bg-sky-500/10 border-sky-500/30" };
  if (categoria === "operacional") return { Icon: PauseCircle, cor: "text-sky-700 dark:text-sky-400",   bg: "bg-sky-500/10 border-sky-500/30" };
  return { Icon: AlertTriangle, cor: "text-slate-700 dark:text-slate-300", bg: "bg-slate-500/10 border-slate-500/30" };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtH(h: number): string {
  const hh = Math.floor(h + 1e-9);
  const mm = Math.round((h - hh) * 60);
  if (hh === 0) return `${mm}min`;
  return mm === 0 ? `${hh}h` : `${hh}h${String(mm).padStart(2, "0")}`;
}
function fmtMin(min: number): string { return fmtH(min / 60); }
function fmtHora(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function minutosDecorridos(inicioIso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(inicioIso).getTime()) / 60000));
}
/** Data local (antes usava UTC, que "virava o dia" às 21:00 em Brasília). */
function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function hojeLocalISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function inicioSemanaISO(): string {
  const d = new Date();
  const dow = d.getDay();
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function OeeCor(v: number): string {
  return v >= 85 ? "text-green-600" : v >= 65 ? "text-amber-600" : "text-red-600";
}
function OeeBg(v: number): string {
  return v >= 85 ? "bg-green-500" : v >= 65 ? "bg-amber-500" : "bg-red-500";
}
function lerUltimasPecas(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(ULTIMA_PECA_KEY) ?? "{}"); } catch { return {}; }
}

/** Cabeçalho numerado de cada etapa. */
function Etapa({ n, titulo, dica, children, done }: {
  n: number; titulo: string; dica?: string; children: React.ReactNode; done?: boolean;
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-baseline gap-2">
        <span className={cn(
          "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
          done ? "bg-green-600 text-white" : "bg-primary text-primary-foreground",
        )}>
          {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : n}
        </span>
        <h4 className="text-[15px] font-semibold">{titulo}</h4>
        {dica && <span className="text-xs text-muted-foreground">{dica}</span>}
      </div>
      <div className="pl-0 sm:pl-8">{children}</div>
    </section>
  );
}

// ── Painel ───────────────────────────────────────────────────────────────────

export function LancamentoDiarioPanel() {
  const { user } = useAuth();
  const { saveWithFallback, saveRpcWithFallback, loadWithFallback } = useOfflineSync();

  // Cadastros
  const [maquinas, setMaquinas]       = useState<Maquina[]>([]);
  const [pecas, setPecas]             = useState<PecaOption[]>([]);
  const [tiposParada, setTiposParada] = useState<TipoParada[]>([]);
  const [tiposRefugo, setTiposRefugo] = useState<TipoRefugo[]>([]);
  const [materias, setMaterias]       = useState<MateriaPrima[]>([]);

  // Dados do dia
  const [apontamentosHoje, setApontamentosHoje] = useState<ApontamentoHoje[]>([]);
  const [paradasHoje, setParadasHoje]           = useState<ParadaHoje[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [oeeSemana, setOeeSemana] = useState<OeePeriodo | null>(null);
  const [oeeMes, setOeeMes]       = useState<OeePeriodo | null>(null);
  const [loadingResumos, setLoadingResumos] = useState(true);
  const [mostrarResumo, setMostrarResumo]   = useState(false);

  // Formulário
  const [operador, setOperador] = useState(() => {
    try { return localStorage.getItem(OPERADOR_STORAGE_KEY) ?? ""; } catch { return ""; }
  });
  const [editandoOperador, setEditandoOperador] = useState(() => {
    try { return !localStorage.getItem(OPERADOR_STORAGE_KEY); } catch { return true; }
  });
  const [dataRef, setDataRef]       = useState(hojeLocalISO()); // dia do lançamento
  const [maquinaSel, setMaquinaSel] = useState("");
  const [modo, setModo]             = useState<Modo>("produziu");
  const [peca, setPeca]             = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [horasSel, setHorasSel]     = useState(""); // horas trabalhadas (seletor 0h30–24h)
  const [editando, setEditando]     = useState<ApontamentoHoje | null>(null);
  const [motivoDia, setMotivoDia]   = useState<number | null>(null); // "só ficou parada": motivo único
  const [tempos, setTempos]         = useState<Map<string, { pecasHora: number; amostras: number }>>(new Map());
  const [editandoParada, setEditandoParada] = useState<ParadaHoje | null>(null);
  const [paradas, setParadas]       = useState<ParadaForm[]>([]);
  const [paradaAberta, setParadaAberta] = useState<number | null>(null); // tipo sendo escolhida a duração
  const [minCustom, setMinCustom]   = useState("");
  const [pecaSetup, setPecaSetup]   = useState("");
  const [refugos, setRefugos]       = useState<Record<number, number>>({});
  const [mostrarRefugo, setMostrarRefugo] = useState(false);
  const [materia, setMateria]       = useState("");
  const [vinculos, setVinculos]     = useState<Map<string, VinculoBarra>>(new Map());
  const [mmPeca, setMmPeca]         = useState("");   // comprimento da peça (mm)
  const [corteMm, setCorteMm]       = useState("");   // largura do bedame / corte (mm)
  const [loteMp, setLoteMp]         = useState("");
  const [lembrarBarra, setLembrarBarra] = useState(true);
  const [ritmoManual, setRitmoManual]   = useState(""); // Qtde/hora digitada (vazio = automático)
  const [turno, setTurno] = useState<string>(() => {
    try { const t = localStorage.getItem(TURNO_STORAGE_KEY); return TURNOS.some(x => x.v === t) ? t! : TURNO_DIA; } catch { return TURNO_DIA; }
  });

  const qtdRef = useRef<HTMLInputElement>(null);
  const hoje = dataRef;
  const ehHoje = dataRef === hojeLocalISO();

  useEffect(() => {
    try { localStorage.setItem(OPERADOR_STORAGE_KEY, operador); } catch { /* modo privado */ }
  }, [operador]);
  useEffect(() => {
    try { localStorage.setItem(TURNO_STORAGE_KEY, turno); } catch { /* modo privado */ }
  }, [turno]);

  const load = useCallback(async () => {
    setLoading(true);
    const dia = dataRef;
    const diaSeguinte = (() => { const d = new Date(`${dia}T12:00:00`); d.setDate(d.getDate() + 1); return isoLocal(d); })();
    const [maqRes, pecasRes, tpRes, trRes, mpRes, apRes, parRes, tempoRes, vincRes] = await Promise.all([
      loadWithFallback<Maquina>("maquinas_producao", "maquinas"),
      carregarPecasProducao(),
      supabase.from("tipo_parada_producao").select("id,nome,categoria").eq("ativo", true).order("id"),
      supabase.from("tipo_refugo_producao").select("id,nome").order("id"),
      loadWithFallback<MateriaPrima>("materias_primas_producao", "materias_primas"),
      supabase.from("apontamentos_producao")
        .select("id,seq_producao,maquina_codigo,maquina,produto,quantidade,qtde_plan_disp,qtde_por_hora,horas_planejadas,turno,operador,created_at,descricao_mp,consumo_mp_metros,baixa_mp_metros")
        .eq("data_apontamento", dia).order("created_at", { ascending: false }),
      supabase.from("paradas_producao")
        .select("id,maquina,motivo,tipo,inicio,fim,duracao_min,operador,observacoes,user_id")
        .gte("inicio", `${dia}T00:00:00`).lt("inicio", `${diaSeguinte}T00:00:00`).order("inicio", { ascending: false }),
      supabase.from("tempo_peca_padrao").select("produto,maquina,pecas_hora,amostras"),
      supabase.from("peca_materia_prima").select("produto,materia_prima_id,comprimento_peca_mm,corte_mm"),
    ]);
    setVinculos(new Map((vincRes.data ?? []).map(v => [v.produto, {
      ...v, comprimento_peca_mm: v.comprimento_peca_mm != null ? Number(v.comprimento_peca_mm) : null, corte_mm: Number(v.corte_mm) || 0,
    }])));
    const mt = new Map<string, { pecasHora: number; amostras: number }>();
    for (const t of tempoRes.data ?? []) {
      if (t.pecas_hora && t.pecas_hora > 0) mt.set(`${t.produto}|${t.maquina}`, { pecasHora: Number(t.pecas_hora), amostras: t.amostras });
    }
    setTempos(mt);

    const maqOrdenadas = [...maqRes].sort((a, b) => a.codigo.localeCompare(b.codigo));
    setMaquinas(maqOrdenadas);

    setPecas(pecasRes);

    if (tpRes.data) setTiposParada(tpRes.data as TipoParada[]);
    if (trRes.data) setTiposRefugo(trRes.data as TipoRefugo[]);
    setMaterias(mpRes.map(normMP).sort((a, b) => a.codigo.localeCompare(b.codigo)));
    setApontamentosHoje((apRes.data ?? []) as ApontamentoHoje[]);
    setParadasHoje((parRes.data ?? []) as ParadaHoje[]);
    setLoading(false);
  }, [loadWithFallback, dataRef]);

  const loadResumos = useCallback(async () => {
    setLoadingResumos(true);
    const d = new Date();
    try {
      const [{ data: semana }, { data: mensal }] = await Promise.all([
        supabase.rpc("calcular_oee", { p_data_ini: inicioSemanaISO(), p_data_fim: hojeLocalISO() }),
        supabase.rpc("resumo_mensal_producao", { p_mes: d.getMonth() + 1, p_ano: d.getFullYear() }),
      ]);
      if (semana) setOeeSemana(semana as unknown as OeePeriodo);
      const geral = (mensal as unknown as { geral?: OeePeriodo } | null)?.geral;
      if (geral) setOeeMes(geral);
    } catch { /* resumo é complementar */ }
    setLoadingResumos(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (mostrarResumo) loadResumos(); }, [mostrarResumo, loadResumos]);

  const tipoSetup = useMemo(() => tiposParada.find(t => t.nome.trim().toLowerCase() === "setup"), [tiposParada]);

  // Horas já lançadas por máquina no dia — mostra o que falta das 24h.
  const horasLancadas = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of apontamentosHoje) {
      const k = a.maquina_codigo || a.maquina;
      m.set(k, (m.get(k) ?? 0) + (Number(a.horas_planejadas) || 0));
    }
    return m;
  }, [apontamentosHoje]);

  const restanteMaquina = useCallback(
    (cod: string) => Math.max(0, HORAS_DIA - (horasLancadas.get(cod) ?? 0)),
    [horasLancadas]
  );

  // Máquina já tem algum lançamento (produção ou parada) no dia?
  const jaLancada = useCallback(
    (cod: string) => (horasLancadas.get(cod) ?? 0) > 0 || paradasHoje.some(p => p.maquina === cod),
    [horasLancadas, paradasHoje]
  );

  // Seleciona automaticamente a primeira máquina ainda sem lançamento.
  useEffect(() => {
    if (maquinaSel || maquinas.length === 0) return;
    const pendente = maquinas.find(m => !jaLancada(m.codigo));
    setMaquinaSel((pendente ?? maquinas[0]).codigo);
  }, [maquinas, maquinaSel, jaLancada]);

  // Peças sugeridas: a última usada nesta máquina + as mais lançadas hoje.
  const pecasSugeridas = useMemo(() => {
    const ult = lerUltimasPecas()[maquinaSel];
    const cont = new Map<string, number>();
    for (const a of apontamentosHoje) cont.set(a.produto, (cont.get(a.produto) ?? 0) + 1);
    const cods = [ult, ...[...cont.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)]
      .filter((c): c is string => !!c);
    return [...new Set(cods)].map(c => pecas.find(p => p.codigo === c)).filter((p): p is PecaOption => !!p).slice(0, 6);
  }, [maquinaSel, apontamentosHoje, pecas]);

  // Ao escolher a peça, já traz a barra e o comprimento que ela usa.
  useEffect(() => {
    setRitmoManual("");
    const v = peca ? vinculos.get(peca) : undefined;
    if (!v) { setMateria(""); setMmPeca(""); setCorteMm(""); setLoteMp(""); return; }
    setMateria(v.materia_prima_id);
    setMmPeca(v.comprimento_peca_mm ? String(v.comprimento_peca_mm) : "");
    setCorteMm(v.corte_mm ? String(v.corte_mm) : "");
  }, [peca, vinculos]);
  useEffect(() => {
    setLoteMp(materias.find(m => m.id === materia)?.lote_atual ?? "");
  }, [materia, materias]);

  // Ao trocar de máquina, pré-seleciona a última peça feita nela.
  useEffect(() => {
    if (!maquinaSel) return;
    const ult = lerUltimasPecas()[maquinaSel];
    setPeca(ult && pecas.some(p => p.codigo === ult) ? ult : "");
  }, [maquinaSel, pecas]);

  // ── Cálculos ao vivo ─────────────────────────────────────────────────────
  const restante      = maquinaSel ? restanteMaquina(maquinaSel) : HORAS_DIA;
  const horasPeriodo  = parseFloat(horasSel) || 0;
  const passaDoDia    = horasPeriodo > restante + 1e-6;
  const minParadas    = paradas.reduce((s, p) => s + p.minutos, 0);
  const horasParadas  = minParadas / 60;
  const horasProdutivas = Math.max(0, horasPeriodo - horasParadas);
  const pecaInfo      = pecas.find(p => p.codigo === peca);
  // Ritmo esperado da peça: o sistema aprende sozinho com os lançamentos
  // (tempo_peca_padrao). Com histórico suficiente, o aprendido vale mais que o
  // cadastro; sem histórico, usa o cadastro; sem nenhum dos dois, não há meta.
  const aprendido     = tempos.get(`${peca}|${maquinaSel}`) ?? tempos.get(`${peca}|*`);
  const porHoraCad    = pecaInfo?.pecas_por_hora ?? 0;
  const usarAprendido = !!aprendido && (aprendido.amostras >= MIN_AMOSTRAS_APRENDIDO || porHoraCad <= 0);
  const porHoraAuto   = usarAprendido ? aprendido!.pecasHora : porHoraCad;
  const ritmoDigitado = parseFloat(ritmoManual) || 0;
  const porHora       = ritmoDigitado > 0 ? ritmoDigitado : porHoraAuto;
  const fontePorHora  = ritmoDigitado > 0 ? "digitado" : usarAprendido ? `histórico de ${aprendido!.amostras} lançamento${aprendido!.amostras > 1 ? "s" : ""}` : porHoraCad > 0 ? "cadastro" : "";
  // Planilha PP-51: Qtde Planejada = Horas Planejadas × Qtde/Hora (sem descontar paradas).
  const qtdePlanejada = porHora > 0 ? Math.round(porHora * horasPeriodo) : 0;
  const esperado      = porHora > 0 ? Math.round(porHora * horasProdutivas) : 0;
  const qtdNum        = parseInt(quantidade) || 0;
  const totalRefugo   = Object.values(refugos).reduce((s, v) => s + v, 0);
  const eficiencia    = esperado > 0 && qtdNum > 0 ? (qtdNum / esperado) * 100 : null;

  // Barra: (boas + refugo) × (comprimento + corte) → metros, barras e kg.
  const mpSel      = materias.find(m => m.id === materia);
  const mmPorPeca  = (parseFloat(mmPeca) || 0) + (parseFloat(corteMm) || 0);
  const consumo    = calcularConsumo({ pecasBoas: qtdNum, pecasRefugo: totalRefugo, mmPorPeca, mp: mpSel });
  const temConsumo = !!mpSel && mmPorPeca > 0 && consumo.pecas > 0;
  // Lançamento com data anterior à última contagem não mexe no saldo (regra do banco).
  const baixaNoSaldo = !!mpSel && (!mpSel.estoque_conferido_em || dataRef >= mpSel.estoque_conferido_em);
  const saldoDepois  = mpSel ? mpSel.estoque_atual - (temConsumo && baixaNoSaldo ? consumo.baixa : 0) : 0;
  const vinculoAtual = peca ? vinculos.get(peca) : undefined;
  const vinculoMudou = !!mpSel && !!peca && (
    !vinculoAtual || vinculoAtual.materia_prima_id !== mpSel.id
    || (vinculoAtual.comprimento_peca_mm ?? 0) !== (parseFloat(mmPeca) || 0)
    || (vinculoAtual.corte_mm ?? 0) !== (parseFloat(corteMm) || 0));
  const paradasExcedem = modo === "produziu" && horasParadas > horasPeriodo + 1e-6;

  // "Só ficou parada": ocupa o período de trabalho inteiro que ainda não foi lançado.
  const lancadoMaquinaDia = maquinaSel
    ? (horasLancadas.get(maquinaSel) ?? 0) + paradasHoje.filter(p => p.maquina === maquinaSel).reduce((s, p) => s + (p.duracao_min ?? 0) / 60, 0)
    : 0;
  const horasParadaDia = Math.max(0, JORNADA_H - lancadoMaquinaDia);

  const pronto =
    !!operador.trim() && !!maquinaSel &&
    (modo === "produziu" ? !!peca && qtdNum > 0 && horasPeriodo > 0 && !paradasExcedem && !passaDoDia : motivoDia !== null && horasParadaDia > 0);

  const faltando: string[] = [];
  if (!operador.trim()) faltando.push("operador");
  if (!maquinaSel) faltando.push("máquina");
  if (modo === "produziu") {
    if (!peca) faltando.push("peça");
    if (qtdNum <= 0) faltando.push("quantidade");
    if (horasPeriodo <= 0) faltando.push("horas");
  } else if (motivoDia === null) faltando.push("motivo da parada");
  else if (horasParadaDia <= 0) faltando.push("período (a máquina já tem o dia todo lançado)");

  // ── Paradas ──────────────────────────────────────────────────────────────
  function adicionarParada(tipoId: number, minutos: number) {
    if (minutos <= 0) return;
    if (tipoId === tipoSetup?.id && !pecaSetup && !peca) {
      toast.error("Escolha a peça do setup");
      return;
    }
    setParadas(prev => [...prev, {
      id: crypto.randomUUID(), tipoId, minutos,
      pecaSetup: tipoId === tipoSetup?.id ? (pecaSetup || peca) : undefined,
    }]);
    setParadaAberta(null); setMinCustom(""); setPecaSetup("");
  }

  function limparFormulario() {
    setQuantidade(""); setHorasSel(""); setParadas([]); setParadaAberta(null);
    setMinCustom(""); setPecaSetup(""); setRefugos({}); setMostrarRefugo(false); setRitmoManual("");
    setModo("produziu"); setMotivoDia(null);
    // A barra da peça volta sozinha pelo vínculo (recarregado no load()).
  }

  // ── Salvar ───────────────────────────────────────────────────────────────
  async function salvar() {
    if (!pronto) { toast.error(`Falta: ${faltando.join(", ")}`); return; }
    setSaving(true);
    // Em outra data, as paradas avulsas terminam às 23:59 daquele dia.
    const agora = ehHoje ? new Date() : new Date(`${dataRef}T23:59:00`);
    const inicioDec = 0;
    const fimDec    = HORAS_DIA;
    const op = operador.trim();

    try {
      if (modo === "produziu") {
        const mp = mpSel;
        const planDisp = horasProdutivas > 0 && porHora > 0 ? +(porHora * horasProdutivas).toFixed(2) : qtdNum;
        const pParadas = paradas.map(p => {
          const tp = tiposParada.find(t => t.id === p.tipoId);
          return {
            tipo_id: p.tipoId,
            tipo_nome: p.tipoId === tipoSetup?.id ? `Setup — ${p.pecaSetup}` : (tp?.nome ?? "Parada"),
            duracao_horas: +(p.minutos / 60).toFixed(4),
          };
        });
        const pRefugos = Object.entries(refugos)
          .filter(([, q]) => q > 0)
          .map(([id, q]) => ({ tipo_id: Number(id), tipo_nome: tiposRefugo.find(t => t.id === Number(id))?.nome ?? "Refugo", quantidade: q }));

        const args = {
          p_data: hoje, p_turno: turno,
          p_maquina: maquinaSel, p_equipamento: maquinaSel,
          p_produto: peca, p_descricao_produto: pecaInfo?.descricao ?? peca,
          p_qtde_por_hora: porHora, p_horas_planejadas: +horasPeriodo.toFixed(4), p_qtde_plan_disp: planDisp,
          p_qtde_produzida: qtdNum,
          p_horario_inicio: +inicioDec.toFixed(4), p_horario_fim: +fimDec.toFixed(4),
          p_cycle_time_min: qtdNum > 0 && horasProdutivas > 0 ? +((horasProdutivas * 60) / qtdNum).toFixed(4) : null,
          p_lead_time_horas: horasPeriodo || null,
          p_lote: "", p_lote_mp: mp ? (loteMp.trim() || mp.lote_atual || "") : "", p_descricao_mp: mp?.descricao ?? "",
          // Consumo já inclui as peças refugadas; o banco soma a ponta de barra e dá baixa no saldo.
          p_comprimento_mm: mp && mmPorPeca > 0 ? +mmPorPeca.toFixed(3) : null,
          p_consumo_mp_metros: mp && temConsumo ? consumo.metros : null,
          p_operador: op, p_paradas: pParadas, p_refugos: pRefugos,
        };
        const preview = {
          seq_producao: 0, data_apontamento: hoje, turno,
          maquina: maquinaSel, maquina_codigo: maquinaSel,
          produto: peca, descricao_produto: pecaInfo?.descricao,
          qtde_por_hora: porHora, horas_planejadas: horasPeriodo, qtde_plan_disp: planDisp,
          quantidade: qtdNum, horario_inicio: inicioDec, horario_fim: fimDec,
          lote: "(pendente)", operador: op, status: "concluido", created_at: agora.toISOString(),
        };
        const { ok } = await saveRpcWithFallback("criar_apontamento_ppi51", args, "apontamentos", preview);
        if (!ok) throw new Error("Falha ao gravar produção");
        // "Lembrar para esta peça": grava qual barra e quantos mm ela gasta.
        if (lembrarBarra && mp && vinculoMudou && navigator.onLine) {
          const { error: vErr } = await supabase.from("peca_materia_prima").upsert({
            produto: peca, materia_prima_id: mp.id,
            comprimento_peca_mm: parseFloat(mmPeca) > 0 ? parseFloat(mmPeca) : null,
            corte_mm: parseFloat(corteMm) || 0, updated_by: user?.id ?? null,
          });
          if (vErr) toast.warning("Lançamento salvo, mas não foi possível lembrar a barra desta peça (permissão).");
        }
        try {
          const ult = lerUltimasPecas(); ult[maquinaSel] = peca;
          localStorage.setItem(ULTIMA_PECA_KEY, JSON.stringify(ult));
        } catch { /* modo privado */ }
      } else {
        // Só parada: uma parada cobrindo o período de trabalho do dia.
        const tp = tiposParada.find(t => t.id === motivoDia);
        const ehSetup = motivoDia === tipoSetup?.id;
        const pecaDoSetup = pecaSetup || peca;
        const inicio = new Date(`${dataRef}T${String(JORNADA_INICIO_H).padStart(2, "0")}:00:00`);
        inicio.setMinutes(inicio.getMinutes() + Math.round((JORNADA_H - horasParadaDia) * 60));
        const minutos = Math.round(horasParadaDia * 60);
        const fim = new Date(inicio.getTime() + minutos * 60000);
        const { error } = await saveWithFallback("paradas_producao", "paradas", "INSERT", {
          id: crypto.randomUUID(), maquina: maquinaSel,
          motivo: ehSetup && pecaDoSetup ? `Setup — ${pecaDoSetup}` : (tp?.nome ?? "Parada"),
          tipo: tp?.categoria === "operacional" || tp?.categoria === "setup" ? "planejada" : "nao_planejada",
          inicio: inicio.toISOString(), fim: fim.toISOString(), duracao_min: minutos,
          operador: op, observacoes: "Máquina parada o período todo (lançamento do Diário)",
          user_id: user?.id,
        });
        if (error) throw new Error("Falha ao gravar parada");
      }

      toast.success(`${maquinaSel} lançada${modo === "produziu" ? ` — ${qtdNum} pç` : ""}`, {
        description: modo === "produziu" && temConsumo && mpSel
          ? `Barra ${mpSel.codigo}: −${fmtMetros(consumo.baixa)} (${fmtBarras(consumo.barras)})${baixaNoSaldo ? ` · saldo ${fmtMetros(saldoDepois)}` : ""}`
          : undefined,
      });
      // "Salvar e seguir": vai para a próxima máquina ainda sem lançamento no dia.
      const idx = maquinas.findIndex(m => m.codigo === maquinaSel);
      const ordem = [...maquinas.slice(idx + 1), ...maquinas.slice(0, idx)];
      const proxima = ordem.find(m => !jaLancada(m.codigo) && m.codigo !== maquinaSel);
      limparFormulario();
      if (proxima) setMaquinaSel(proxima.codigo);
      await load();
      requestAnimationFrame(() => document.getElementById("diario-topo")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch {
      toast.error("Não foi possível salvar. Verifique a conexão e tente de novo.");
    } finally {
      setSaving(false);
    }
  }

  // ── Resumo do dia ────────────────────────────────────────────────────────
  const resumo = useMemo(() => {
    const horasProducao = apontamentosHoje.reduce((s, a) => s + (Number(a.horas_planejadas) || 0), 0);
    const totalPecas    = apontamentosHoje.reduce((s, a) => s + (a.quantidade || 0), 0);
    const totalPlan     = apontamentosHoje.reduce((s, a) => s + (Number(a.qtde_plan_disp) || 0), 0);
    const eficienciaDia = totalPlan > 0 ? (totalPecas / totalPlan) * 100 : 0;

    const porMotivo = new Map<string, number>();
    for (const p of paradasHoje) {
      const min = p.duracao_min ?? minutosDecorridos(p.inicio);
      const chave = p.motivo.startsWith("Setup") ? "Setup" : p.motivo;
      porMotivo.set(chave, (porMotivo.get(chave) ?? 0) + min / 60);
    }
    const tempoTotal = horasProducao + [...porMotivo.values()].reduce((s, v) => s + v, 0);
    const pizzaTempo = [
      ...(horasProducao > 0 ? [{ name: "Produção", horas: +horasProducao.toFixed(2) }] : []),
      ...[...porMotivo.entries()].map(([name, h]) => ({ name, horas: +h.toFixed(2) })),
    ].map(d => ({ ...d, pct: tempoTotal > 0 ? +((d.horas / tempoTotal) * 100).toFixed(1) : 0 }));

    const porMaquina = new Map<string, number>();
    for (const a of apontamentosHoje) {
      const m = a.maquina_codigo || a.maquina;
      porMaquina.set(m, (porMaquina.get(m) ?? 0) + (a.quantidade || 0));
    }
    const barMaquinas = [...porMaquina.entries()]
      .map(([maquina, qtde]) => ({ maquina, qtde, pct: totalPecas > 0 ? +((qtde / totalPecas) * 100).toFixed(1) : 0 }))
      .sort((a, b) => b.qtde - a.qtde);

    return { horasProducao, totalPecas, eficienciaDia, pizzaTempo, barMaquinas };
  }, [apontamentosHoje, paradasHoje]);

  const maquinasLancadas = maquinas.filter(m => jaLancada(m.codigo)).length;
  const lancadosMaquina = apontamentosHoje.filter(a => (a.maquina_codigo || a.maquina) === maquinaSel);
  const ontemISO = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return isoLocal(d); })();
  const dataLabel = (() => {
    const t = new Date(`${dataRef}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
    return t.charAt(0).toUpperCase() + t.slice(1);
  })();

  // ── UI ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 animate-in fade-in duration-200" id="diario-topo">
      {/* Barra do dia: data, operador, progresso */}
      <div className="rounded-2xl border bg-card shadow-xs p-3 sm:p-4 flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Factory className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{dataLabel}</p>
            <p className="text-xs text-muted-foreground">
              {maquinasLancadas} de {maquinas.length} máquinas com lançamento no dia
            </p>
          </div>
        </div>

        {/* Data do lançamento */}
        <div className="flex items-center gap-2 lg:ml-auto">
          <div className="flex rounded-xl border bg-muted/40 p-1" role="radiogroup" aria-label="Dia do lançamento">
            {[{ v: hojeLocalISO(), l: "Hoje" }, { v: ontemISO, l: "Ontem" }].map(o => (
              <button key={o.l} type="button" role="radio" aria-checked={dataRef === o.v}
                onClick={() => { setDataRef(o.v); setMaquinaSel(""); }}
                className={cn("h-10 px-4 rounded-lg text-sm font-medium transition-colors",
                  dataRef === o.v ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {o.l}
              </button>
            ))}
          </div>
          <Input type="date" value={dataRef} max={hojeLocalISO()} aria-label="Outra data"
            onChange={e => { if (e.target.value) { setDataRef(e.target.value); setMaquinaSel(""); } }}
            className="h-11 w-[9.5rem]" />
        </div>

        {/* Turno (como na planilha PP-51) — lembrado no aparelho */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Turno</span>
          <div className="flex rounded-xl border bg-muted/40 p-1" role="radiogroup" aria-label="Turno do lançamento">
            {TURNOS.map(t => (
              <button key={t.v} type="button" role="radio" aria-checked={turno === t.v} title={t.v}
                onClick={() => setTurno(t.v)}
                className={cn("h-10 min-w-[2.75rem] px-3 rounded-lg text-sm font-medium transition-colors",
                  turno === t.v ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {t.l}
              </button>
            ))}
          </div>
        </div>

        {/* Operador (lembrado) */}
        {editandoOperador ? (
          <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); if (operador.trim()) setEditandoOperador(false); }}>
            <div className="relative flex-1 lg:w-56">
              <User className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input autoFocus value={operador} onChange={e => setOperador(e.target.value)}
                placeholder="Seu nome (operador)" className="h-10 pl-9" aria-label="Nome do operador" />
            </div>
            <Button type="submit" size="sm" className="h-10" disabled={!operador.trim()}>OK</Button>
          </form>
        ) : (
          <button type="button" onClick={() => setEditandoOperador(true)}
            className="flex items-center gap-2 h-10 px-3 rounded-xl border hover:bg-muted text-sm">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium truncate max-w-[10rem]">{operador}</span>
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4 items-start">
        {/* ── Formulário ─────────────────────────────────────────────── */}
        <div className="rounded-2xl border bg-card shadow-xs p-4 sm:p-5 space-y-6">
          {/* 1. Máquina */}
          <Etapa n={1} titulo="Máquina" dica="toque para escolher" done={!!maquinaSel}>
            {loading && maquinas.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4"><Loader2 className="h-4 w-4 animate-spin" /> Carregando máquinas...</div>
            ) : maquinas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma máquina cadastrada — cadastre em Produção → Cadastros.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {maquinas.map(m => {
                  const st = STATUS_MAQUINA[m.status] ?? STATUS_MAQUINA.operando;
                  const lanc = horasLancadas.get(m.codigo) ?? 0;
                  const pct = Math.min(100, (lanc / HORAS_DIA) * 100);
                  const completa = jaLancada(m.codigo);
                  const ativa = maquinaSel === m.codigo;
                  return (
                    <button key={m.id} type="button" onClick={() => { setMaquinaSel(m.codigo); setHorasSel(""); setParadas([]); }}
                      aria-pressed={ativa}
                      className={cn("relative rounded-xl border-2 p-2.5 text-left transition-all min-h-[76px]",
                        ativa ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:border-primary/40",
                        completa && !ativa && "opacity-70")}>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[15px] font-bold">{m.codigo}</span>
                        {completa
                          ? <CheckCircle2 className="h-4 w-4 text-green-600" aria-label="Já lançada no dia" />
                          : <span className={cn("h-2 w-2 rounded-full", st.dot)} title={st.label} />}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{m.nome}</p>
                      <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
                        <div className={cn("h-full rounded-full", completa ? "bg-green-500" : "bg-primary")} style={{ width: `${pct}%` }} />
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                        {lanc > 0 ? `${fmtH(lanc)} lançadas` : completa ? "Só paradas" : "Sem lançamento"}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </Etapa>

          {/* 2. O que aconteceu */}
          <Etapa n={2} titulo="O que aconteceu na máquina?">
            <div className="grid grid-cols-2 gap-2">
              {([
                { id: "produziu", Icon: Hammer, t: "Produziu peças", d: "com ou sem paradas no meio" },
                { id: "parada",   Icon: PauseCircle, t: "Só ficou parada", d: "não produziu nada" },
              ] as const).map(o => (
                <button key={o.id} type="button" onClick={() => setModo(o.id)} aria-pressed={modo === o.id}
                  className={cn("rounded-xl border-2 p-3 text-left flex items-start gap-3 transition-all",
                    modo === o.id ? (o.id === "produziu" ? "border-green-600 bg-green-500/5" : "border-amber-500 bg-amber-500/5") : "border-border hover:border-primary/40")}>
                  <o.Icon className={cn("h-6 w-6 shrink-0 mt-0.5", modo === o.id ? (o.id === "produziu" ? "text-green-600" : "text-amber-600") : "text-muted-foreground")} />
                  <span>
                    <span className="block text-sm font-semibold">{o.t}</span>
                    <span className="block text-xs text-muted-foreground">{o.d}</span>
                  </span>
                </button>
              ))}
            </div>
          </Etapa>

          {modo === "produziu" && (
            <>
              {/* 3. Peça */}
              <Etapa n={3} titulo="Qual peça?" done={!!peca}>
                <div className="space-y-2">
                  {pecasSugeridas.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {pecasSugeridas.map(p => (
                        <button key={p.codigo} type="button" onClick={() => { setPeca(p.codigo); qtdRef.current?.focus(); }}
                          aria-pressed={peca === p.codigo}
                          className={cn("rounded-xl border-2 px-3 py-2 text-left max-w-full transition-all",
                            peca === p.codigo ? "border-primary bg-primary/5" : "border-border hover:border-primary/40")}>
                          <span className="block text-sm font-semibold">{p.codigo}</span>
                          <span className="block text-xs text-muted-foreground truncate max-w-[14rem]">{p.descricao}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <PecaCombobox pecas={pecas} value={pecasSugeridas.some(p => p.codigo === peca) ? "" : peca} onChange={setPeca} />
                  {pecaInfo && (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{pecaInfo.codigo}</span> · {pecaInfo.descricao} · UM: PC
                    </p>
                  )}
                </div>
              </Etapa>

              {/* 4. Quantidade */}
              <Etapa n={4} titulo="Quantas peças boas?" done={qtdNum > 0}>
                <div className="flex items-stretch gap-2 max-w-md">
                  <Button type="button" variant="outline" className="h-14 w-14 shrink-0" aria-label="Diminuir 1"
                    onClick={() => setQuantidade(q => String(Math.max(0, (parseInt(q) || 0) - 1)))}>
                    <Minus className="h-5 w-5" />
                  </Button>
                  <Input ref={qtdRef} type="number" min="0" inputMode="numeric" value={quantidade}
                    onChange={e => setQuantidade(e.target.value.replace(/\D/g, ""))}
                    placeholder="0" aria-label="Quantidade produzida"
                    className="h-14 text-center text-2xl font-bold tabular-nums" />
                  <Button type="button" variant="outline" className="h-14 w-14 shrink-0" aria-label="Aumentar 1"
                    onClick={() => setQuantidade(q => String((parseInt(q) || 0) + 1))}>
                    <Plus className="h-5 w-5" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {[10, 50, 100].map(n => (
                    <button key={n} type="button" onClick={() => setQuantidade(q => String((parseInt(q) || 0) + n))}
                      className="h-9 px-3 rounded-lg border text-sm font-medium hover:bg-muted">+{n}</button>
                  ))}
                  {esperado > 0 && (
                    <button type="button" onClick={() => setQuantidade(String(esperado))}
                      className="h-9 px-3 rounded-lg border border-primary/30 bg-primary/5 text-primary text-sm font-medium hover:bg-primary/10">
                      Usar esperado ({esperado})
                    </button>
                  )}
                </div>
              </Etapa>

              {/* 5. Tempo */}
              <Etapa n={5} titulo="Quantas horas a máquina trabalhou?" dica="no dia, incluindo as paradas" done={horasPeriodo > 0}>
                <HorasMinutosSelect value={horasSel} onChange={setHorasSel} max={restante}
                  ariaLabel="Horas trabalhadas no dia" destaque={!!horasSel} />
                {horasPeriodo > 0 && <p className="mt-1.5 text-sm font-medium">= {fmtH(horasPeriodo)}</p>}
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <label className="space-y-1">
                    <span className="block text-xs font-medium text-muted-foreground">Qtde / hora (ritmo)</span>
                    <Input inputMode="decimal" value={ritmoManual} onChange={e => setRitmoManual(decimal(e.target.value))}
                      placeholder={porHoraAuto > 0 ? porHoraAuto.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : "pç/h"}
                      aria-label="Quantidade por hora" className="h-11 w-28 tabular-nums" />
                  </label>
                  <div className="text-xs text-muted-foreground pb-1 space-y-0.5">
                    {porHora > 0
                      ? <p>{porHora.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} pç/h · {fontePorHora}{ritmoDigitado > 0 && porHoraAuto > 0 ? ` (sugerido ${porHoraAuto.toLocaleString("pt-BR", { maximumFractionDigits: 1 })})` : ""}</p>
                      : <p>Sem ritmo cadastrado — digite a Qtde/hora para calcular o planejado.</p>}
                    {qtdePlanejada > 0 && <p>Qtde planejada: <strong className="text-foreground tabular-nums">{qtdePlanejada.toLocaleString("pt-BR")} pç</strong> ({fmtH(horasPeriodo)} × ritmo)</p>}
                  </div>
                </div>
                {restante < HORAS_DIA && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Já lançado nesta máquina no dia: {fmtH(HORAS_DIA - restante)} · disponível: {fmtH(restante)}
                  </p>
                )}
              </Etapa>
            </>
          )}

          {/* Só ficou parada: escolhe o motivo — o tempo é o período todo */}
          {modo === "parada" && (
            <Etapa n={3} titulo="Por que ficou parada?" dica="toque no motivo — o tempo é o período todo" done={motivoDia !== null}>
              <div className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                  {tiposParada.map(t => {
                    const est = estiloParada(t.categoria, t.nome);
                    const sel = motivoDia === t.id;
                    return (
                      <button key={t.id} type="button" onClick={() => setMotivoDia(sel ? null : t.id)} aria-pressed={sel}
                        className={cn("flex items-center gap-2 rounded-xl border-2 px-3 min-h-[52px] text-left text-sm font-medium transition-all",
                          sel ? cn(est.bg, "border-current", est.cor) : "border-border hover:border-primary/40")}>
                        {sel ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <est.Icon className={cn("h-4 w-4 shrink-0", est.cor)} />}
                        <span className="leading-tight">{t.nome}</span>
                      </button>
                    );
                  })}
                </div>
                {motivoDia !== null && motivoDia === tipoSetup?.id && (
                  <div className="space-y-1 max-w-lg">
                    <p className="text-xs text-muted-foreground">Setup para qual peça? (opcional)</p>
                    <PecaCombobox pecas={pecas} value={pecaSetup} onChange={setPecaSetup} placeholder="Peça que será produzida depois do setup..." />
                  </div>
                )}
                <p className={cn("text-sm rounded-xl border px-3 py-2",
                  horasParadaDia > 0 ? "bg-muted/40" : "border-destructive/30 bg-destructive/5 text-destructive")}>
                  {horasParadaDia > 0
                    ? <>Será registrada <strong>{fmtH(horasParadaDia)}</strong> de parada — período de trabalho do dia{lancadoMaquinaDia > 0 ? ` menos ${fmtH(lancadoMaquinaDia)} já lançadas` : ""}.</>
                    : "Esta máquina já tem o período de trabalho do dia todo lançado."}
                </p>
              </div>
            </Etapa>
          )}

          {/* Paradas (dentro de um período produtivo) */}
          {modo === "produziu" && <Etapa n={modo === "produziu" ? 6 : 3}
            titulo={modo === "produziu" ? "Teve parada?" : "Por que ficou parada?"}
            dica={modo === "produziu" ? "opcional — toque no motivo" : "toque no motivo e na duração"}
            done={paradas.length > 0}>
            <div className="space-y-3">
              {paradas.length > 0 && (
                <ul className="space-y-1.5">
                  {paradas.map(p => {
                    const tp = tiposParada.find(t => t.id === p.tipoId);
                    const est = estiloParada(tp?.categoria ?? "", tp?.nome ?? "");
                    return (
                      <li key={p.id} className={cn("flex items-center gap-2.5 rounded-xl border px-3 py-2", est.bg)}>
                        <est.Icon className={cn("h-4 w-4 shrink-0", est.cor)} />
                        <span className="flex-1 text-sm font-medium truncate">
                          {tp?.nome}{p.pecaSetup ? ` — ${p.pecaSetup}` : ""}
                        </span>
                        <span className="text-sm font-semibold tabular-nums">{fmtMin(p.minutos)}</span>
                        <button type="button" onClick={() => setParadas(prev => prev.filter(x => x.id !== p.id))}
                          aria-label="Remover parada" className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                {tiposParada.map(t => {
                  const est = estiloParada(t.categoria, t.nome);
                  const aberta = paradaAberta === t.id;
                  return (
                    <button key={t.id} type="button" onClick={() => { setParadaAberta(aberta ? null : t.id); setMinCustom(""); }}
                      aria-expanded={aberta}
                      className={cn("flex items-center gap-2 rounded-xl border-2 px-3 min-h-[48px] text-left text-sm font-medium transition-all",
                        aberta ? cn(est.bg, "border-current", est.cor) : "border-border hover:border-primary/40")}>
                      <est.Icon className={cn("h-4 w-4 shrink-0", est.cor)} />
                      <span className="leading-tight">{t.nome}</span>
                    </button>
                  );
                })}
              </div>

              {paradaAberta !== null && (() => {
                const tp = tiposParada.find(t => t.id === paradaAberta);
                const ehSetup = paradaAberta === tipoSetup?.id;
                return (
                  <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-3 space-y-3 animate-in fade-in slide-in-from-top-1 duration-150">
                    <p className="text-sm font-semibold">Quanto tempo de {tp?.nome}?</p>
                    {ehSetup && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Setup para qual peça?</p>
                        <PecaCombobox pecas={pecas} value={pecaSetup || peca} onChange={setPecaSetup} placeholder="Peça que será produzida depois do setup..." />
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {DURACOES_MIN.map(min => (
                        <button key={min} type="button" onClick={() => adicionarParada(paradaAberta, min)}
                          className="h-11 min-w-[64px] px-3 rounded-xl border-2 border-border bg-card text-sm font-semibold hover:border-primary hover:text-primary">
                          {fmtMin(min)}
                        </button>
                      ))}
                      <form className="flex items-center gap-1.5" onSubmit={e => { e.preventDefault(); adicionarParada(paradaAberta, parseInt(minCustom) || 0); }}>
                        <Input type="number" min="1" inputMode="numeric" value={minCustom} onChange={e => setMinCustom(e.target.value)}
                          placeholder="min" aria-label="Minutos" className="h-11 w-20" />
                        <Button type="submit" variant="secondary" className="h-11" disabled={!(parseInt(minCustom) > 0)}>OK</Button>
                      </form>
                    </div>
                  </div>
                );
              })()}
              {paradasExcedem && (
                <p className="text-sm text-destructive flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" />
                  As paradas ({fmtH(horasParadas)}) passam do tempo informado ({fmtH(horasPeriodo)}).</p>
              )}
            </div>
          </Etapa>}

          {/* Barra (matéria-prima) — gasto calculado por metro */}
          {modo === "produziu" && (
            <Etapa n={7} titulo="Barra usada" dica="o gasto é calculado e baixado do estoque" done={temConsumo}>
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_7rem_6rem] gap-2">
                  <label className="space-y-1 min-w-0">
                    <span className="block text-xs font-medium text-muted-foreground">Matéria-prima (barra)</span>
                    <select value={materia} onChange={e => setMateria(e.target.value)} aria-label="Matéria-prima"
                      className="w-full h-11 rounded-xl border border-input bg-background px-3 text-sm">
                      <option value="">Não informar</option>
                      {materias.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.codigo} — {m.descricao} ({fmtBarras(metrosParaBarras(m.estoque_atual, m))})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="block text-xs font-medium text-muted-foreground">Compr. peça (mm)</span>
                    <Input inputMode="decimal" value={mmPeca} onChange={e => setMmPeca(decimal(e.target.value))} disabled={!materia}
                      placeholder="Ex.: 11" aria-label="Comprimento da peça em mm" className="h-11 tabular-nums" />
                  </label>
                  <label className="space-y-1">
                    <span className="block text-xs font-medium text-muted-foreground">Corte (mm)</span>
                    <Input inputMode="decimal" value={corteMm} onChange={e => setCorteMm(decimal(e.target.value))} disabled={!materia}
                      placeholder="Ex.: 1,5" aria-label="Largura do corte em mm" className="h-11 tabular-nums" />
                  </label>
                </div>

                {mpSel && (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <label className="space-y-1">
                        <span className="block text-xs font-medium text-muted-foreground">Lote da barra</span>
                        <Input value={loteMp} onChange={e => setLoteMp(e.target.value)} placeholder={mpSel.lote_atual || "opcional"} className="h-11" aria-label="Lote da matéria-prima" />
                      </label>
                      {peca && (
                        <label className="flex items-center gap-2 text-sm h-11 sm:mt-5 cursor-pointer select-none rounded-xl border px-3">
                          <input type="checkbox" checked={lembrarBarra} onChange={e => setLembrarBarra(e.target.checked)} className="h-5 w-5 rounded border-input" />
                          <span className="truncate">{vinculoAtual && !vinculoMudou ? `Barra lembrada para ${peca}` : `Lembrar para ${peca}`}</span>
                        </label>
                      )}
                    </div>

                    <div className={cn("rounded-xl border px-3 py-2.5 text-sm space-y-1",
                      !temConsumo ? "bg-muted/40"
                        : saldoDepois < 0 ? "border-destructive/40 bg-destructive/5"
                        : saldoDepois <= mpSel.estoque_minimo ? "border-amber-500/40 bg-amber-500/5" : "bg-muted/40")}>
                      {!temConsumo ? (
                        <p className="text-muted-foreground flex items-center gap-1.5"><Ruler className="h-4 w-4" />
                          {mmPorPeca <= 0 ? "Informe o comprimento da peça para calcular o gasto de barra." : "Informe a quantidade para calcular o gasto."}</p>
                      ) : (
                        <>
                          <p className="flex flex-wrap items-baseline gap-x-2">
                            <span className="text-muted-foreground">Gasto:</span>
                            <strong className="tabular-nums">{fmtMetros(consumo.baixa)}</strong>
                            <span className="text-muted-foreground tabular-nums">≈ {fmtBarras(consumo.barras)}{consumo.kg != null ? ` ≈ ${fmtKg(consumo.kg)}${consumo.kgEstimado ? " (estimado)" : ""}` : ""}</span>
                          </p>
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {consumo.pecas.toLocaleString("pt-BR")} pç{totalRefugo > 0 ? ` (${qtdNum} boas + ${totalRefugo} refugo)` : ""} × {mmPorPeca.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mm
                            {consumo.baixa > consumo.metros ? ` + ponta de barra (${Number(mpSel.sobra_barra_mm)} mm/barra)` : ""}
                          </p>
                          {baixaNoSaldo ? (
                            <p className={cn("tabular-nums", saldoDepois < 0 ? "text-destructive font-semibold" : saldoDepois <= mpSel.estoque_minimo ? "text-amber-700 dark:text-amber-400 font-semibold" : "")}>
                              Saldo depois: {fmtMetros(saldoDepois)} ≈ {fmtBarras(metrosParaBarras(Math.max(0, saldoDepois), mpSel))}
                              {saldoDepois < 0 ? " — o estoque registrado não cobre este gasto, confira o saldo"
                                : saldoDepois <= mpSel.estoque_minimo ? " — abaixo do mínimo, peça barra" : ""}
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground">Data anterior à última contagem desta barra — não altera o saldo.</p>
                          )}
                          {baixaNoSaldo && saldoDepois > 0 && mmPorPeca > 0 && (
                            <p className="text-xs text-muted-foreground">Dá para mais ~{pecasPossiveis(saldoDepois, mmPorPeca, mpSel).toLocaleString("pt-BR")} peças desta com o saldo.</p>
                          )}
                          {!pesoBarraKg(mpSel) && (
                            <p className="text-xs text-muted-foreground">Peso da barra {mpSel.codigo} ainda não pesado — cadastre em Mat.-Prima para converter o pedido em kg.</p>
                          )}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            </Etapa>
          )}

          {/* Opcional: refugo */}
          {modo === "produziu" && (
            <div className="space-y-2 sm:pl-8">
              <button type="button" onClick={() => setMostrarRefugo(v => !v)}
                className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
                <ChevronRight className={cn("h-4 w-4 transition-transform", mostrarRefugo && "rotate-90")} />
                Refugo {totalRefugo > 0 && <span className="text-destructive">· {totalRefugo} pç refugadas</span>}
              </button>
              {mostrarRefugo && (
                <div className="rounded-xl border p-3 space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Peças refugadas</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {tiposRefugo.map(t => (
                        <div key={t.id} className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5">
                          <span className="flex-1 text-sm truncate">{t.nome}</span>
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Menos ${t.nome}`}
                            onClick={() => setRefugos(r => ({ ...r, [t.id]: Math.max(0, (r[t.id] ?? 0) - 1) }))}><Minus className="h-4 w-4" /></Button>
                          <input type="number" min="0" inputMode="numeric" value={refugos[t.id] ?? 0}
                            onChange={e => setRefugos(r => ({ ...r, [t.id]: Math.max(0, parseInt(e.target.value) || 0) }))}
                            aria-label={`Quantidade ${t.nome}`}
                            className="w-12 h-8 text-center text-sm font-semibold tabular-nums rounded-md border bg-background" />
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Mais ${t.nome}`}
                            onClick={() => setRefugos(r => ({ ...r, [t.id]: (r[t.id] ?? 0) + 1 }))}><Plus className="h-4 w-4" /></Button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Resumo + salvar (fica visível ao lado no desktop) ───────── */}
        <aside className="xl:sticky xl:top-4 space-y-3">
          <div className="rounded-2xl border bg-card shadow-sm p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Resumo do lançamento</p>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Máquina</dt><dd className="font-semibold">{maquinaSel || "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Dia</dt><dd className="font-medium">{new Date(`${dataRef}T12:00:00`).toLocaleDateString("pt-BR")}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Turno</dt><dd className="font-medium">{turno}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Operador</dt><dd className="font-medium truncate">{operador || "—"}</dd></div>
              {modo === "produziu" ? (
                <>
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Peça</dt><dd className="font-semibold truncate">{peca || "—"}</dd></div>
                  <div className="border-t my-2" />
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Tempo</dt><dd className="tabular-nums">{fmtH(horasPeriodo)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">− Paradas</dt><dd className="tabular-nums">{fmtH(horasParadas)}</dd></div>
                  <div className="flex justify-between gap-3 font-semibold"><dt>= Produtivo</dt><dd className="tabular-nums text-green-600">{fmtH(horasProdutivas)}</dd></div>
                  {qtdePlanejada > 0 && (
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Qtde planejada</dt><dd className="tabular-nums">{qtdePlanejada.toLocaleString("pt-BR")} pç</dd></div>
                  )}
                  {esperado > 0 && (
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground flex items-center gap-1"><Target className="h-3.5 w-3.5" />Esperado</dt>
                      <dd className="tabular-nums text-right">{esperado.toLocaleString("pt-BR")} pç
                        <span className="block text-[11px] text-muted-foreground">{porHora.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} pç/h · {fontePorHora}</span></dd></div>
                  )}
                  <div className="flex justify-between gap-3 items-baseline"><dt className="text-muted-foreground">Produzido</dt>
                    <dd className="text-xl font-bold tabular-nums">{qtdNum.toLocaleString("pt-BR")} pç</dd></div>
                  {totalRefugo > 0 && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Refugo</dt><dd className="tabular-nums text-destructive">{totalRefugo} pç</dd></div>}
                  {temConsumo && mpSel && (
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground flex items-center gap-1"><Boxes className="h-3.5 w-3.5" />Barra {mpSel.codigo}</dt>
                      <dd className="tabular-nums text-right">{fmtMetros(consumo.baixa)}
                        <span className="block text-[11px] text-muted-foreground">{fmtBarras(consumo.barras)}</span></dd></div>
                  )}
                  {eficiencia !== null && (
                    <div className={cn("rounded-lg px-3 py-2 text-center text-sm font-semibold",
                      eficiencia >= 95 ? "bg-green-500/10 text-green-700 dark:text-green-400" : eficiencia >= 80 ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-red-500/10 text-red-700 dark:text-red-400")}>
                      Eficiência {eficiencia.toFixed(0)}%
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Motivo</dt>
                    <dd className="font-semibold truncate">{tiposParada.find(t => t.id === motivoDia)?.nome ?? "—"}</dd></div>
                  <div className="flex justify-between gap-3 font-semibold border-t pt-2"><dt>Tempo parado</dt><dd className="tabular-nums text-amber-600">{fmtH(horasParadaDia)}</dd></div>
                </>
              )}
            </dl>

            <Button className="hidden xl:flex w-full h-14 text-base gap-2" onClick={salvar} disabled={saving || !pronto}>
              {saving ? <><Loader2 className="h-5 w-5 animate-spin" /> Salvando...</> : <><CheckCircle2 className="h-5 w-5" /> Salvar lançamento</>}
            </Button>
            {!pronto && faltando.length > 0 && (
              <p className="text-xs text-muted-foreground text-center">Falta: {faltando.join(", ")}</p>
            )}
            {pronto && <p className="text-xs text-muted-foreground text-center">Depois de salvar, já abre a próxima máquina.</p>}
          </div>

          {lancadosMaquina.length > 0 && (
            <div className="rounded-2xl border bg-card p-3 space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Já lançado em {maquinaSel} no dia</p>
              {lancadosMaquina.map(a => (
                <div key={a.id} className="flex items-center justify-between text-sm">
                  <span className="truncate">{a.produto} · {a.operador}</span>
                  <span className="tabular-nums font-medium shrink-0">{a.quantidade} pç · {fmtH(Number(a.horas_planejadas) || 0)}</span>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>

      {/* KPIs do dia */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { Icon: Package,    label: "Peças no dia",   value: resumo.totalPecas.toLocaleString("pt-BR"), cor: "text-green-600" },
          { Icon: Timer,      label: "Horas produção", value: fmtH(resumo.horasProducao),              cor: "text-blue-600" },
          { Icon: TrendingUp, label: "Eficiência",   value: `${resumo.eficienciaDia.toFixed(0)}%`,     cor: resumo.eficienciaDia >= 95 ? "text-green-600" : resumo.eficienciaDia >= 80 ? "text-amber-600" : "text-red-600" },
          { Icon: Factory,    label: "Máquinas lançadas", value: `${maquinasLancadas}/${maquinas.length}`, cor: "text-foreground" },
        ].map(k => (
          <div key={k.label} className="rounded-2xl border bg-card p-3.5">
            <div className="flex items-center gap-1.5">
              <k.Icon className={cn("h-3.5 w-3.5", k.cor)} />
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">{k.label}</p>
            </div>
            <p className={cn("text-xl font-bold tabular-nums mt-1", k.cor)}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Lançamentos de hoje */}
      <div className="rounded-2xl border bg-card p-4 space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-600" /> Lançados no dia</h3>
          <span className="text-xs text-muted-foreground hidden sm:inline">toque no lápis para corrigir</span>
          <button onClick={() => load()} disabled={loading} aria-label="Atualizar"
            className="ml-auto h-9 w-9 flex items-center justify-center rounded-lg border hover:bg-muted">
            <RefreshCw className={cn("h-4 w-4 text-muted-foreground", loading && "animate-spin")} />
          </button>
        </div>
        {apontamentosHoje.length === 0 && paradasHoje.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Nada lançado neste dia.</p>
        ) : (
          <div className="divide-y">
            {apontamentosHoje.slice(0, 30).map(a => (
              <div key={a.id} className="py-2.5 flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0"><Package className="h-4 w-4 text-green-600" /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {a.seq_producao ? <span className="text-muted-foreground font-normal tabular-nums">nº {a.seq_producao} · </span> : null}
                    {a.maquina_codigo || a.maquina} · {a.produto}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {a.turno} · {a.operador} · {fmtHora(a.created_at)}
                    {Number(a.consumo_mp_metros) > 0 && <> · <Boxes className="inline h-3 w-3 -mt-0.5" /> {fmtMetros(Number(a.baixa_mp_metros) || Number(a.consumo_mp_metros))} de barra</>}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-semibold text-sm text-green-600 tabular-nums">{a.quantidade.toLocaleString("pt-BR")} pç</p>
                  <p className="text-xs text-muted-foreground tabular-nums">{fmtH(Number(a.horas_planejadas) || 0)}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" aria-label="Corrigir lançamento" onClick={() => setEditando(a)}>
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {paradasHoje.slice(0, 15).map(p => (
              <div key={p.id} className="py-2.5 flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0"><PauseCircle className="h-4 w-4 text-amber-600" /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{p.maquina} · {p.motivo}</p>
                  <p className="text-xs text-muted-foreground">{p.operador} · {fmtHora(p.inicio)}</p>
                </div>
                <p className="text-sm font-semibold text-amber-600 tabular-nums shrink-0">{fmtMin(p.duracao_min ?? minutosDecorridos(p.inicio))}</p>
                <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" aria-label="Corrigir parada" onClick={() => setEditandoParada(p)}>
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Gráficos e demonstrativos — recolhidos para não poluir a tela do operador */}
      <button type="button" onClick={() => setMostrarResumo(v => !v)} aria-expanded={mostrarResumo}
        className="w-full flex items-center gap-2 rounded-2xl border bg-card px-4 py-3 text-sm font-semibold hover:bg-muted/50">
        <BarChart3 className="h-4 w-4 text-primary" /> Gráficos do dia e demonstrativos (semana / mês)
        <ChevronDown className={cn("h-4 w-4 ml-auto transition-transform", mostrarResumo && "rotate-180")} />
      </button>

      {mostrarResumo && (
        <div className="space-y-4 animate-in fade-in duration-150">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl border bg-card p-4 space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-2"><Clock className="h-4 w-4 text-primary" /> Distribuição do tempo — hoje</h3>
              {resumo.pizzaTempo.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Sem lançamentos hoje ainda</p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie data={resumo.pizzaTempo} dataKey="horas" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2}>
                        {resumo.pizzaTempo.map((d, i) => (
                          <Cell key={i} fill={d.name === "Produção" ? "#22c55e" : CORES_PIZZA[(i + 1) % CORES_PIZZA.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                        formatter={(v: number, _n, item) => [`${v.toFixed(2)}h (${(item?.payload as { pct: number })?.pct}%)`, item?.payload?.name]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                    {resumo.pizzaTempo.map((d, i) => (
                      <div key={d.name} className="flex items-center gap-1.5 text-xs">
                        <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: d.name === "Produção" ? "#22c55e" : CORES_PIZZA[(i + 1) % CORES_PIZZA.length] }} />
                        <span className="truncate">{d.name}</span>
                        <span className="ml-auto font-semibold shrink-0">{d.pct}%</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="rounded-2xl border bg-card p-4 space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-2"><Factory className="h-4 w-4 text-primary" /> Peças por máquina — hoje</h3>
              {resumo.barMaquinas.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Nenhuma peça lançada hoje</p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={resumo.barMaquinas} margin={{ top: 0, right: 0, left: -25, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="maquina" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                      formatter={(v: number, _n, item) => [`${v.toLocaleString("pt-BR")} pç (${(item?.payload as { pct: number })?.pct}%)`, "Produzido"]} />
                    <Bar dataKey="qtde" radius={[4, 4, 0, 0]}>
                      {resumo.barMaquinas.map((_, i) => <Cell key={i} fill={CORES_PIZZA[i % CORES_PIZZA.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ResumoPeriodoCard titulo="Demonstrativo da Semana" Icon={CalendarDays} subtitulo="Desde segunda-feira até hoje" dado={oeeSemana} loading={loadingResumos} />
            <ResumoPeriodoCard titulo="Demonstrativo do Mês" Icon={CalendarRange}
              subtitulo={new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" })} dado={oeeMes} loading={loadingResumos} />
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center">
        Precisa lançar hora a hora, com horário inicial/final e medições (planilha PPI-51)? Use a aba <strong className="text-foreground">Controle</strong>.
      </p>

      <EditarApontamentoDialog
        apontamento={editando} onClose={() => setEditando(null)} onSaved={() => { setEditando(null); load(); }}
        maquinas={maquinas} pecas={pecas} tiposParada={tiposParada} tiposRefugo={tiposRefugo} />
      <EditarParadaDialog
        parada={editandoParada} onClose={() => setEditandoParada(null)} onSaved={() => { setEditandoParada(null); load(); }}
        maquinas={maquinas} tiposParada={tiposParada} />

      {/* Barra fixa de salvar no celular */}
      <div className="xl:hidden sticky bottom-2 z-20">
        <div className="rounded-2xl border bg-card/95 backdrop-blur shadow-lg px-3 py-2.5 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate">
              {maquinaSel || "—"}{modo === "produziu" ? ` · ${peca || "sem peça"} · ${qtdNum} pç` : ` · parada ${fmtH(horasParadaDia)}`}
            </p>
            <p className="text-xs text-muted-foreground truncate">{pronto ? "Pronto para salvar" : `Falta: ${faltando.join(", ")}`}</p>
          </div>
          <Button className="h-12 px-5 gap-1.5 shrink-0" onClick={salvar} disabled={saving || !pronto}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Salvar
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Card de demonstrativo (semana/mês) ───────────────────────────────────────

function ResumoPeriodoCard({ titulo, subtitulo, Icon, dado, loading }: {
  titulo: string; subtitulo: string; Icon: React.ElementType; dado: OeePeriodo | null; loading: boolean;
}) {
  return (
    <div className="rounded-2xl border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center"><Icon className="h-4 w-4 text-primary" /></div>
        <div>
          <h3 className="text-[13px] font-bold">{titulo}</h3>
          <p className="text-xs text-muted-foreground capitalize">{subtitulo}</p>
        </div>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground text-sm gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Calculando...</div>
      ) : !dado || !dado.hr_planejadas ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Sem lançamentos neste período</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-xl bg-muted/40 p-2.5">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Peças produzidas</p>
              <p className="text-lg font-bold tabular-nums">{(dado.qtde_produzida ?? 0).toLocaleString("pt-BR")}</p>
            </div>
            <div className="rounded-xl bg-muted/40 p-2.5">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide flex items-center gap-1"><Gauge className="h-3 w-3" />OEE</p>
              <p className={cn("text-lg font-bold tabular-nums", OeeCor(dado.oee ?? 0))}>{(dado.oee ?? 0).toFixed(1)}%</p>
            </div>
          </div>
          <div className="space-y-2">
            {[
              { label: "Disponibilidade", v: dado.disponibilidade ?? 0 },
              { label: "Performance", v: dado.performance ?? 0 },
              { label: "Qualidade", v: dado.qualidade ?? 0 },
            ].map(f => (
              <div key={f.label} className="space-y-0.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{f.label}</span>
                  <span className={cn("font-semibold", OeeCor(f.v))}>{f.v.toFixed(1)}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className={cn("h-full rounded-full", OeeBg(f.v))} style={{ width: `${Math.min(100, f.v)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Correção de lançamentos ──────────────────────────────────────────────────

const selCls = "w-full h-11 rounded-xl border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
const lblCls = "text-xs font-semibold text-muted-foreground uppercase tracking-wide";

interface ParadaEdit { id: string; tipoId: number; nome: string; horas: number; }

/** Botão de excluir em dois toques (sem pop-up de confirmação do navegador). */
function BotaoExcluir({ onConfirm, disabled }: { onConfirm: () => void; disabled?: boolean }) {
  const [armado, setArmado] = useState(false);
  useEffect(() => { if (!armado) return; const t = setTimeout(() => setArmado(false), 4000); return () => clearTimeout(t); }, [armado]);
  return (
    <Button type="button" variant={armado ? "destructive" : "outline"} disabled={disabled}
      className={cn("h-11 gap-1.5", !armado && "text-destructive border-destructive/40 hover:bg-destructive/10")}
      onClick={() => (armado ? onConfirm() : setArmado(true))}>
      <Trash2 className="h-4 w-4" /> {armado ? "Toque de novo para excluir" : "Excluir"}
    </Button>
  );
}

/** Também usado pela aba Controle para corrigir apontamentos já sincronizados. */
export function EditarApontamentoDialog({ apontamento, onClose, onSaved, maquinas, pecas, tiposParada, tiposRefugo }: {
  apontamento: ApontamentoHoje | null; onClose: () => void; onSaved: () => void;
  maquinas: Maquina[]; pecas: PecaOption[]; tiposParada: TipoParada[]; tiposRefugo: TipoRefugo[];
}) {
  const [maquina, setMaquina] = useState("");
  const [peca, setPeca] = useState("");
  const [qtd, setQtd] = useState("");
  const [horas, setHoras] = useState("");
  const [operador, setOperador] = useState("");
  const [paradas, setParadas] = useState<ParadaEdit[]>([]);
  const [refugos, setRefugos] = useState<Record<number, number>>({});
  const [novaTipo, setNovaTipo] = useState("");
  const [novaMin, setNovaMin] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [turno, setTurno] = useState<string>(TURNO_DIA);
  const [ritmo, setRitmo] = useState("");
  const [materias, setMaterias] = useState<MateriaPrima[]>([]);
  const [materiaId, setMateriaId] = useState("");
  const [mmPeca, setMmPeca] = useState("");

  useEffect(() => {
    if (!apontamento) return;
    setMaquina(apontamento.maquina_codigo || apontamento.maquina);
    setPeca(apontamento.produto);
    setQtd(String(apontamento.quantidade ?? 0));
    setHoras(String(Number(apontamento.horas_planejadas) || ""));
    setOperador(apontamento.operador ?? "");
    setNovaTipo(""); setNovaMin("");
    setCarregando(true);
    setTurno(apontamento.turno || TURNO_DIA);
    Promise.all([
      supabase.from("apontamento_paradas").select("id,tipo_parada_id,tipo_parada_nome,duracao_horas").eq("apontamento_id", apontamento.id),
      supabase.from("apontamento_refugos").select("tipo_refugo_id,quantidade").eq("apontamento_id", apontamento.id),
      supabase.from("apontamentos_producao").select("turno,qtde_por_hora,materia_prima_id,comprimento_mm").eq("id", apontamento.id).maybeSingle(),
      supabase.from("materias_primas_producao").select("*").order("codigo"),
    ]).then(([pr, rr, ar, mr]) => {
      const ap = ar.data;
      if (ap) {
        setTurno(ap.turno || TURNO_DIA);
        setRitmo(Number(ap.qtde_por_hora) > 0 ? String(Number(ap.qtde_por_hora)) : "");
        setMateriaId(ap.materia_prima_id ?? "");
        setMmPeca(Number(ap.comprimento_mm) > 0 ? String(Number(ap.comprimento_mm)) : "");
      }
      setMaterias(((mr.data ?? []) as MateriaPrima[]).map(normMP));
      setParadas((pr.data ?? []).map(p => ({ id: p.id, tipoId: p.tipo_parada_id, nome: p.tipo_parada_nome, horas: Number(p.duracao_horas) || 0 })));
      const r: Record<number, number> = {};
      for (const x of rr.data ?? []) r[x.tipo_refugo_id] = (r[x.tipo_refugo_id] ?? 0) + (x.quantidade ?? 0);
      setRefugos(r);
    }).finally(() => setCarregando(false));
  }, [apontamento]);

  const horasNum = parseFloat(horas) || 0;
  const horasParadas = paradas.reduce((s, p) => s + p.horas, 0);
  const pecaInfo = pecas.find(p => p.codigo === peca);
  const totalRefugo = Object.values(refugos).reduce((s, v) => s + v, 0);
  const mpSel = materias.find(m => m.id === materiaId);
  const consumo = calcularConsumo({ pecasBoas: parseInt(qtd) || 0, pecasRefugo: totalRefugo, mmPorPeca: parseFloat(mmPeca) || 0, mp: mpSel });

  async function salvar() {
    if (!apontamento) return;
    if (!navigator.onLine) { toast.error("Sem internet — a correção precisa de conexão."); return; }
    if (!peca || !maquina || !operador.trim() || horasNum <= 0) { toast.error("Preencha máquina, peça, horas e operador."); return; }
    if (horasParadas > horasNum) { toast.error("As paradas passam das horas do lançamento."); return; }
    setSalvando(true);
    const { data, error } = await supabase.rpc("editar_apontamento_producao", {
      p_id: apontamento.id, p_maquina: maquina, p_produto: peca,
      p_descricao_produto: pecaInfo?.descricao ?? peca,
      // Mantém o ritmo do lançamento (antes trocava pelo do cadastro, que pode ser 0).
      p_qtde_por_hora: parseFloat(ritmo) > 0 ? parseFloat(ritmo) : (pecaInfo?.pecas_por_hora ?? 0),
      p_horas_planejadas: horasNum, p_qtde_produzida: parseInt(qtd) || 0, p_operador: operador.trim(),
      p_paradas: paradas.map(p => ({ tipo_id: p.tipoId, tipo_nome: p.nome, duracao_horas: +p.horas.toFixed(4) })),
      p_refugos: Object.entries(refugos).filter(([, q]) => q > 0)
        .map(([id, q]) => ({ tipo_id: Number(id), tipo_nome: tiposRefugo.find(t => t.id === Number(id))?.nome ?? "Refugo", quantidade: q })),
      p_materia_prima_id: materiaId || null,
      p_comprimento_mm: materiaId && parseFloat(mmPeca) > 0 ? parseFloat(mmPeca) : null,
      p_turno: turno,
    });
    setSalvando(false);
    const res = data as { ok?: boolean; error?: string } | null;
    if (error || !res?.ok) { toast.error(res?.error ?? "Não foi possível salvar a correção."); return; }
    toast.success("Lançamento corrigido.");
    onSaved();
  }

  async function excluir() {
    if (!apontamento) return;
    setSalvando(true);
    const { data, error } = await supabase.rpc("excluir_lancamento_producao", { p_tipo: "apontamento", p_id: apontamento.id });
    setSalvando(false);
    const res = data as { ok?: boolean; error?: string } | null;
    if (error || !res?.ok) { toast.error(res?.error ?? "Não foi possível excluir."); return; }
    toast.success("Lançamento excluído.");
    onSaved();
  }

  function addParada() {
    const tp = tiposParada.find(t => t.id === Number(novaTipo));
    const min = parseInt(novaMin) || 0;
    if (!tp || min <= 0) return;
    setParadas(prev => [...prev, { id: crypto.randomUUID(), tipoId: tp.id, nome: tp.nome, horas: min / 60 }]);
    setNovaTipo(""); setNovaMin("");
  }

  return (
    <Dialog open={!!apontamento} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Corrigir lançamento</DialogTitle>
          <DialogDescription>
            {apontamento && `Lançado às ${fmtHora(apontamento.created_at)} por ${apontamento.operador}. A correção fica registrada no histórico.`}
          </DialogDescription>
        </DialogHeader>

        {carregando ? (
          <div className="flex items-center gap-2 py-10 justify-center text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><label className={lblCls}>Máquina</label>
                <select value={maquina} onChange={e => setMaquina(e.target.value)} className={selCls}>
                  {!maquinas.some(m => m.codigo === maquina) && maquina && <option value={maquina}>{maquina}</option>}
                  {maquinas.map(m => <option key={m.id} value={m.codigo}>{m.codigo} — {m.nome}</option>)}
                </select>
              </div>
              <div className="space-y-1.5"><label className={lblCls}>Operador</label>
                <Input value={operador} onChange={e => setOperador(e.target.value)} className="h-11" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><label className={lblCls}>Turno</label>
                <select value={turno} onChange={e => setTurno(e.target.value)} className={selCls}>
                  {TURNOS.map(t => <option key={t.v} value={t.v}>{t.v}</option>)}
                </select>
              </div>
              <div className="space-y-1.5"><label className={lblCls}>Qtde / hora</label>
                <Input inputMode="decimal" value={ritmo} onChange={e => setRitmo(decimal(e.target.value))} placeholder="pç/h" className="h-11 tabular-nums" />
              </div>
            </div>
            <div className="space-y-1.5"><label className={lblCls}>Peça</label>
              <PecaCombobox pecas={pecas} value={peca} onChange={v => v && setPeca(v)} placeholder="Buscar peça..." />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
              <div className="space-y-1.5"><label className={lblCls}>Peças boas</label>
                <Input type="number" min="0" inputMode="numeric" value={qtd} onChange={e => setQtd(e.target.value.replace(/\D/g, ""))} className="h-11 text-lg font-semibold tabular-nums" />
              </div>
              <div className="space-y-1.5"><label className={lblCls}>Horas trabalhadas</label>
                <HorasMinutosSelect value={horas} onChange={setHoras} ariaLabel="Horas trabalhadas" destaque={!!horas} />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className={lblCls}>Barra (matéria-prima)</label>
              <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] gap-2">
                <select value={materiaId} onChange={e => setMateriaId(e.target.value)} className={selCls} aria-label="Matéria-prima">
                  <option value="">Não informar</option>
                  {materias.map(m => <option key={m.id} value={m.id}>{m.codigo} — {m.descricao}</option>)}
                </select>
                <Input inputMode="decimal" value={mmPeca} onChange={e => setMmPeca(decimal(e.target.value))} disabled={!materiaId}
                  placeholder="mm/peça" aria-label="Milímetros de barra por peça (com corte)" className="h-11 tabular-nums" />
              </div>
              {mpSel && consumo.metros > 0 && (
                <p className="text-xs text-muted-foreground tabular-nums">
                  Gasto: {fmtMetros(consumo.baixa)} ≈ {fmtBarras(consumo.barras)} — o estoque é ajustado pela diferença.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className={lblCls}>Paradas ({fmtH(horasParadas)})</label>
              {paradas.map(p => (
                <div key={p.id} className="flex items-center gap-2 rounded-lg border px-3 py-1.5">
                  <span className="flex-1 text-sm truncate">{p.nome}</span>
                  <select value={Math.round(p.horas * 60)} aria-label={`Duração de ${p.nome}`}
                    onChange={e => setParadas(prev => prev.map(x => x.id === p.id ? { ...x, horas: Number(e.target.value) / 60 } : x))}
                    className="h-9 rounded-md border bg-background px-2 text-sm">
                    {[...new Set([Math.round(p.horas * 60), ...DURACOES_MIN, 180, 240, 300, 360, 480])].sort((a, b) => a - b)
                      .map(m => <option key={m} value={m}>{fmtMin(m)}</option>)}
                  </select>
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label="Remover parada"
                    onClick={() => setParadas(prev => prev.filter(x => x.id !== p.id))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              <div className="flex gap-2">
                <select value={novaTipo} onChange={e => setNovaTipo(e.target.value)} className={cn(selCls, "h-10 flex-1")} aria-label="Motivo da nova parada">
                  <option value="">+ Adicionar parada…</option>
                  {tiposParada.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
                </select>
                <select value={novaMin} onChange={e => setNovaMin(e.target.value)} className="h-10 rounded-xl border bg-background px-2 text-sm" aria-label="Duração da nova parada">
                  <option value="">Duração</option>
                  {[...DURACOES_MIN, 180, 240, 300, 360, 480].map(m => <option key={m} value={m}>{fmtMin(m)}</option>)}
                </select>
                <Button type="button" variant="secondary" className="h-10" onClick={addParada} disabled={!novaTipo || !novaMin}>OK</Button>
              </div>
            </div>

            {tiposRefugo.length > 0 && (
              <div className="space-y-2">
                <label className={lblCls}>Refugo</label>
                <div className="grid grid-cols-2 gap-2">
                  {tiposRefugo.map(t => (
                    <div key={t.id} className="flex items-center gap-2 rounded-lg border px-2.5 py-1">
                      <span className="flex-1 text-sm truncate">{t.nome}</span>
                      <input type="number" min="0" inputMode="numeric" value={refugos[t.id] ?? 0} aria-label={`Refugo ${t.nome}`}
                        onChange={e => setRefugos(r => ({ ...r, [t.id]: Math.max(0, parseInt(e.target.value) || 0) }))}
                        className="w-14 h-8 text-center text-sm rounded-md border bg-background tabular-nums" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <BotaoExcluir onConfirm={excluir} disabled={salvando || carregando} />
          <div className="flex gap-2">
            <Button variant="outline" className="h-11" onClick={onClose} disabled={salvando}>Cancelar</Button>
            <Button className="h-11 gap-1.5" onClick={salvar} disabled={salvando || carregando}>
              {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Salvar correção
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditarParadaDialog({ parada, onClose, onSaved, maquinas, tiposParada }: {
  parada: ParadaHoje | null; onClose: () => void; onSaved: () => void;
  maquinas: Maquina[]; tiposParada: TipoParada[];
}) {
  const [maquina, setMaquina] = useState("");
  const [motivo, setMotivo] = useState("");
  const [minutos, setMinutos] = useState(0);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!parada) return;
    setMaquina(parada.maquina);
    setMotivo(parada.motivo);
    setMinutos(parada.duracao_min ?? minutosDecorridos(parada.inicio));
  }, [parada]);

  const opcoesMin = [...new Set([minutos, ...DURACOES_MIN, 180, 240, 300, 360, 480, 600, 720])].filter(m => m > 0).sort((a, b) => a - b);

  async function salvar() {
    if (!parada) return;
    if (!navigator.onLine) { toast.error("Sem internet — a correção precisa de conexão."); return; }
    setSalvando(true);
    const tp = tiposParada.find(t => t.nome === motivo);
    const fim = new Date(new Date(parada.inicio).getTime() + minutos * 60000).toISOString();
    const { error } = await supabase.from("paradas_producao").update({
      maquina, motivo, duracao_min: minutos, fim,
      ...(tp ? { tipo: tp.categoria === "operacional" || tp.categoria === "setup" ? "planejada" : "nao_planejada" } : {}),
    }).eq("id", parada.id);
    setSalvando(false);
    if (error) { toast.error("Não foi possível salvar a correção."); return; }
    toast.success("Parada corrigida.");
    onSaved();
  }

  async function excluir() {
    if (!parada) return;
    setSalvando(true);
    const { data, error } = await supabase.rpc("excluir_lancamento_producao", { p_tipo: "parada", p_id: parada.id });
    setSalvando(false);
    const res = data as { ok?: boolean; error?: string } | null;
    if (error || !res?.ok) { toast.error(res?.error ?? "Não foi possível excluir."); return; }
    toast.success("Parada excluída.");
    onSaved();
  }

  return (
    <Dialog open={!!parada} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Corrigir parada</DialogTitle>
          <DialogDescription>{parada && `Registrada às ${fmtHora(parada.inicio)} por ${parada.operador}.`}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><label className={lblCls}>Máquina</label>
            <select value={maquina} onChange={e => setMaquina(e.target.value)} className={selCls}>
              {!maquinas.some(m => m.codigo === maquina) && maquina && <option value={maquina}>{maquina}</option>}
              {maquinas.map(m => <option key={m.id} value={m.codigo}>{m.codigo} — {m.nome}</option>)}
            </select>
          </div>
          <div className="space-y-1.5"><label className={lblCls}>Motivo</label>
            <select value={motivo} onChange={e => setMotivo(e.target.value)} className={selCls}>
              {!tiposParada.some(t => t.nome === motivo) && <option value={motivo}>{motivo}</option>}
              {tiposParada.map(t => <option key={t.id} value={t.nome}>{t.nome}</option>)}
            </select>
          </div>
          <div className="space-y-1.5"><label className={lblCls}>Duração</label>
            <select value={minutos} onChange={e => setMinutos(Number(e.target.value))} className={selCls}>
              {opcoesMin.map(m => <option key={m} value={m}>{fmtMin(m)}</option>)}
            </select>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <BotaoExcluir onConfirm={excluir} disabled={salvando} />
          <div className="flex gap-2">
            <Button variant="outline" className="h-11" onClick={onClose} disabled={salvando}>Cancelar</Button>
            <Button className="h-11 gap-1.5" onClick={salvar} disabled={salvando}>
              {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Salvar correção
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
