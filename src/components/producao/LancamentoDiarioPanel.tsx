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
 * Turnos fixos da empresa:
 *   1º Turno — 06:00 às 15:30 (9,5h)
 *   2º Turno — 15:31 à 01:30 do dia seguinte (≈9,98h)
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
  CalendarDays, CalendarRange, Gauge, Search, ChevronDown, Target, Minus, Plus, Hammer,
  PauseCircle, Wrench, Coffee, Settings2, AlertTriangle, ChevronRight, Pencil, Trash2,
  BarChart3, Sun, Moon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOfflineSync } from "@/hooks/useOfflineSync";

// ── Turnos fixos ─────────────────────────────────────────────────────────────

interface Turno { id: 1 | 2; label: string; inicioH: number; inicioM: number; fimH: number; fimM: number; duracaoH: number; }
const TURNOS: Turno[] = [
  { id: 1, label: "1º Turno", inicioH: 6,  inicioM: 0,  fimH: 15, fimM: 30, duracaoH: 9.5 },
  { id: 2, label: "2º Turno", inicioH: 15, inicioM: 31, fimH: 1,  fimM: 30, duracaoH: +(9 + 59 / 60).toFixed(4) },
];
function turnoAtual(): 1 | 2 {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  if (h >= 6 && h < 15.5167) return 1;
  return 2; // 15:31–24:00 e 00:00–06:00 (fim do 2º turno)
}
function fmtTurnoHorario(t: Turno): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(t.inicioH)}:${p(t.inicioM)}–${p(t.fimH)}:${p(t.fimM)}`;
}

// ── Tipos ────────────────────────────────────────────────────────────────────

interface Maquina    { id: string; codigo: string; nome: string; status: string; }
interface PecaOption { codigo: string; descricao: string; pecas_por_hora: number; origem: "producao" | "componente"; }
interface TipoParada { id: number; nome: string; categoria: string; }
interface TipoRefugo { id: number; nome: string; }
interface MateriaPrima { id: string; codigo: string; descricao: string; lote_atual?: string | null; unidade: string; }

interface ApontamentoHoje {
  id: string; maquina_codigo: string | null; maquina: string; produto: string;
  quantidade: number; qtde_plan_disp: number; horas_planejadas: number; turno: string;
  operador: string; created_at: string;
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
/**
 * Data de referência do lançamento. Entre 00:00 e 06:00 ainda é o 2º turno
 * do dia ANTERIOR — sem isso, o fim do 2º turno caía no dia seguinte.
 * (Antes usava a data UTC, que já "virava o dia" às 21:00 no horário de Brasília.)
 */
function hojeLocalISO(): string {
  const d = new Date();
  if (d.getHours() < 6) d.setDate(d.getDate() - 1);
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

/** Seletor de peça com busca (para quando a peça não está nos atalhos). */
function PecaCombobox({ pecas, value, onChange, placeholder }: {
  pecas: PecaOption[]; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca]   = useState("");
  const boxRef   = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selecionada = pecas.find(p => p.codigo === value);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const base = q ? pecas.filter(p => p.codigo.toLowerCase().includes(q) || p.descricao.toLowerCase().includes(q)) : pecas;
    return base.slice(0, 80);
  }, [busca, pecas]);

  useEffect(() => {
    if (!aberto) return;
    inputRef.current?.focus();
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [aberto]);

  const escolher = (codigo: string) => { onChange(codigo); setAberto(false); setBusca(""); };

  return (
    <div ref={boxRef} className="relative">
      <button type="button" onClick={() => setAberto(a => !a)}
        className="w-full h-12 rounded-xl border border-input bg-background px-3.5 text-left text-sm flex items-center gap-2 hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring">
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        {selecionada ? (
          <span className="flex-1 truncate"><span className="font-semibold">{selecionada.codigo}</span>
            <span className="text-muted-foreground"> — {selecionada.descricao}</span></span>
        ) : (
          <span className="flex-1 truncate text-muted-foreground">{placeholder ?? "Buscar outra peça pelo código ou nome..."}</span>
        )}
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground shrink-0 transition-transform", aberto && "rotate-180")} />
      </button>
      {aberto && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-border bg-popover shadow-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 border-b border-border/60">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <input ref={inputRef} value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="Digite o código ou a descrição..."
              className="w-full h-11 bg-transparent text-sm focus:outline-none" />
          </div>
          <div className="max-h-72 overflow-y-auto overscroll-contain py-1">
            {filtradas.length === 0 && (
              <p className="px-3 py-4 text-sm text-muted-foreground text-center">Nenhuma peça encontrada para "{busca}"</p>
            )}
            {filtradas.map(p => (
              <button key={p.codigo} type="button" onClick={() => escolher(p.codigo)}
                className={cn("w-full text-left px-3 py-2.5 text-sm hover:bg-muted flex items-center gap-2", p.codigo === value && "bg-primary/10")}>
                <span className="font-semibold shrink-0">{p.codigo}</span>
                <span className="text-muted-foreground truncate">{p.descricao}</span>
                {p.pecas_por_hora > 0 && <span className="ml-auto text-xs text-muted-foreground shrink-0">{p.pecas_por_hora} pç/h</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
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
  const [turnoSel, setTurnoSel]     = useState<1 | 2>(turnoAtual());
  const [maquinaSel, setMaquinaSel] = useState("");
  const [modo, setModo]             = useState<Modo>("produziu");
  const [peca, setPeca]             = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [horasCustom, setHorasCustom] = useState<string | null>(null); // null = turno/restante
  const [paradas, setParadas]       = useState<ParadaForm[]>([]);
  const [paradaAberta, setParadaAberta] = useState<number | null>(null); // tipo sendo escolhida a duração
  const [minCustom, setMinCustom]   = useState("");
  const [pecaSetup, setPecaSetup]   = useState("");
  const [refugos, setRefugos]       = useState<Record<number, number>>({});
  const [mostrarRefugo, setMostrarRefugo] = useState(false);
  const [materia, setMateria]       = useState("");

  const qtdRef = useRef<HTMLInputElement>(null);
  const hoje = hojeLocalISO();

  useEffect(() => {
    try { localStorage.setItem(OPERADOR_STORAGE_KEY, operador); } catch { /* modo privado */ }
  }, [operador]);

  const load = useCallback(async () => {
    setLoading(true);
    const dia = hojeLocalISO();
    const [maqRes, prodRes, devRes, tpRes, trRes, mpRes, apRes, parRes] = await Promise.all([
      loadWithFallback<Maquina>("maquinas_producao", "maquinas"),
      supabase.from("produtos_producao").select("codigo,descricao,pecas_por_hora").eq("ativo", true).order("codigo"),
      supabase.from("devices").select("internal_code,model,reference").eq("ativo", true).order("internal_code"),
      supabase.from("tipo_parada_producao").select("id,nome,categoria").eq("ativo", true).order("id"),
      supabase.from("tipo_refugo_producao").select("id,nome").order("id"),
      loadWithFallback<MateriaPrima>("materias_primas_producao", "materias_primas"),
      supabase.from("apontamentos_producao")
        .select("id,maquina_codigo,maquina,produto,quantidade,qtde_plan_disp,horas_planejadas,turno,operador,created_at")
        .eq("data_apontamento", dia).order("created_at", { ascending: false }),
      supabase.from("paradas_producao")
        .select("id,maquina,motivo,tipo,inicio,fim,duracao_min,operador,observacoes,user_id")
        .gte("inicio", `${dia}T00:00:00`).order("inicio", { ascending: false }),
    ]);

    const maqOrdenadas = [...maqRes].sort((a, b) => a.codigo.localeCompare(b.codigo));
    setMaquinas(maqOrdenadas);

    const doProducao: PecaOption[] = (prodRes.data ?? []).map(p => ({
      codigo: p.codigo, descricao: p.descricao, pecas_por_hora: p.pecas_por_hora ?? 0, origem: "producao",
    }));
    const codigosProd = new Set(doProducao.map(p => p.codigo));
    const componentes: PecaOption[] = (devRes.data ?? [])
      .filter((d): d is typeof d & { internal_code: string } => !!d.internal_code && !codigosProd.has(d.internal_code))
      .map(d => ({ codigo: d.internal_code, descricao: `${d.model ?? ""} ${d.reference ?? ""}`.trim(), pecas_por_hora: 0, origem: "componente" }));
    setPecas([...doProducao, ...componentes]);

    if (tpRes.data) setTiposParada(tpRes.data as TipoParada[]);
    if (trRes.data) setTiposRefugo(trRes.data as TipoRefugo[]);
    setMaterias([...mpRes].sort((a, b) => a.codigo.localeCompare(b.codigo)));
    if (apRes.data) setApontamentosHoje(apRes.data as ApontamentoHoje[]);
    if (parRes.data) setParadasHoje(parRes.data as ParadaHoje[]);
    setLoading(false);
  }, [loadWithFallback]);

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

  const turnoDef  = TURNOS.find(t => t.id === turnoSel)!;
  const tipoSetup = useMemo(() => tiposParada.find(t => t.nome.trim().toLowerCase() === "setup"), [tiposParada]);

  // Horas já lançadas por máquina neste turno (hoje) — mostra o que falta.
  const horasLancadas = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of apontamentosHoje) {
      if (a.turno !== turnoDef.label) continue;
      const k = a.maquina_codigo || a.maquina;
      m.set(k, (m.get(k) ?? 0) + (Number(a.horas_planejadas) || 0));
    }
    return m;
  }, [apontamentosHoje, turnoDef.label]);

  const restanteMaquina = useCallback(
    (cod: string) => Math.max(0, turnoDef.duracaoH - (horasLancadas.get(cod) ?? 0)),
    [horasLancadas, turnoDef.duracaoH]
  );

  // Seleciona automaticamente a primeira máquina ainda sem lançamento.
  useEffect(() => {
    if (maquinaSel || maquinas.length === 0) return;
    const pendente = maquinas.find(m => restanteMaquina(m.codigo) > 0.01);
    setMaquinaSel((pendente ?? maquinas[0]).codigo);
  }, [maquinas, maquinaSel, restanteMaquina]);

  // Peças sugeridas: a última usada nesta máquina + as mais lançadas hoje.
  const pecasSugeridas = useMemo(() => {
    const ult = lerUltimasPecas()[maquinaSel];
    const cont = new Map<string, number>();
    for (const a of apontamentosHoje) cont.set(a.produto, (cont.get(a.produto) ?? 0) + 1);
    const cods = [ult, ...[...cont.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)]
      .filter((c): c is string => !!c);
    return [...new Set(cods)].map(c => pecas.find(p => p.codigo === c)).filter((p): p is PecaOption => !!p).slice(0, 6);
  }, [maquinaSel, apontamentosHoje, pecas]);

  // Ao trocar de máquina, pré-seleciona a última peça feita nela.
  useEffect(() => {
    if (!maquinaSel) return;
    const ult = lerUltimasPecas()[maquinaSel];
    setPeca(ult && pecas.some(p => p.codigo === ult) ? ult : "");
  }, [maquinaSel, pecas]);

  // ── Cálculos ao vivo ─────────────────────────────────────────────────────
  const restante      = maquinaSel ? restanteMaquina(maquinaSel) : turnoDef.duracaoH;
  const horasPeriodo  = horasCustom !== null ? (parseFloat(horasCustom.replace(",", ".")) || 0) : restante;
  const minParadas    = paradas.reduce((s, p) => s + p.minutos, 0);
  const horasParadas  = minParadas / 60;
  const horasProdutivas = Math.max(0, horasPeriodo - horasParadas);
  const pecaInfo      = pecas.find(p => p.codigo === peca);
  const porHora       = pecaInfo?.pecas_por_hora ?? 0;
  const esperado      = porHora > 0 ? Math.round(porHora * horasProdutivas) : 0;
  const qtdNum        = parseInt(quantidade) || 0;
  const totalRefugo   = Object.values(refugos).reduce((s, v) => s + v, 0);
  const eficiencia    = esperado > 0 && qtdNum > 0 ? (qtdNum / esperado) * 100 : null;
  const paradasExcedem = modo === "produziu" && horasParadas > horasPeriodo + 1e-6;

  const pronto =
    !!operador.trim() && !!maquinaSel &&
    (modo === "produziu" ? !!peca && qtdNum > 0 && horasPeriodo > 0 && !paradasExcedem : paradas.length > 0);

  const faltando: string[] = [];
  if (!operador.trim()) faltando.push("operador");
  if (!maquinaSel) faltando.push("máquina");
  if (modo === "produziu") {
    if (!peca) faltando.push("peça");
    if (qtdNum <= 0) faltando.push("quantidade");
  } else if (paradas.length === 0) faltando.push("motivo da parada");

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
    setQuantidade(""); setHorasCustom(null); setParadas([]); setParadaAberta(null);
    setMinCustom(""); setPecaSetup(""); setRefugos({}); setMostrarRefugo(false); setMateria("");
    setModo("produziu");
  }

  // ── Salvar ───────────────────────────────────────────────────────────────
  async function salvar() {
    if (!pronto) { toast.error(`Falta: ${faltando.join(", ")}`); return; }
    setSaving(true);
    const agora = new Date();
    const inicioDec = turnoDef.inicioH + turnoDef.inicioM / 60;
    const fimDec    = turnoDef.fimH + turnoDef.fimM / 60;
    const op = operador.trim();

    try {
      if (modo === "produziu") {
        const mp = materias.find(m => m.id === materia);
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
          p_data: hoje, p_turno: turnoDef.label,
          p_maquina: maquinaSel, p_equipamento: maquinaSel,
          p_produto: peca, p_descricao_produto: pecaInfo?.descricao ?? peca,
          p_qtde_por_hora: porHora, p_horas_planejadas: +horasPeriodo.toFixed(4), p_qtde_plan_disp: planDisp,
          p_qtde_produzida: qtdNum,
          p_horario_inicio: +inicioDec.toFixed(4), p_horario_fim: +fimDec.toFixed(4),
          p_cycle_time_min: qtdNum > 0 && horasProdutivas > 0 ? +((horasProdutivas * 60) / qtdNum).toFixed(4) : null,
          p_lead_time_horas: horasPeriodo || null,
          p_lote: "", p_lote_mp: mp?.lote_atual ?? "", p_descricao_mp: mp?.descricao ?? "",
          p_comprimento_mm: null, p_consumo_mp_metros: null,
          p_operador: op, p_paradas: pParadas, p_refugos: pRefugos,
        };
        const preview = {
          seq_producao: 0, data_apontamento: hoje, turno: turnoDef.label,
          maquina: maquinaSel, maquina_codigo: maquinaSel,
          produto: peca, descricao_produto: pecaInfo?.descricao,
          qtde_por_hora: porHora, horas_planejadas: horasPeriodo, qtde_plan_disp: planDisp,
          quantidade: qtdNum, horario_inicio: inicioDec, horario_fim: fimDec,
          lote: "(pendente)", operador: op, status: "concluido", created_at: agora.toISOString(),
        };
        const { ok } = await saveRpcWithFallback("criar_apontamento_ppi51", args, "apontamentos", preview);
        if (!ok) throw new Error("Falha ao gravar produção");
        try {
          const ult = lerUltimasPecas(); ult[maquinaSel] = peca;
          localStorage.setItem(ULTIMA_PECA_KEY, JSON.stringify(ult));
        } catch { /* modo privado */ }
      } else {
        // Só parada: grava cada motivo em paradas_producao, encadeando os horários.
        let fim = new Date(agora);
        for (let j = paradas.length - 1; j >= 0; j--) {
          const p = paradas[j];
          const inicio = new Date(fim.getTime() - p.minutos * 60000);
          const tp = tiposParada.find(t => t.id === p.tipoId);
          const ehSetup = p.tipoId === tipoSetup?.id;
          const { error } = await saveWithFallback("paradas_producao", "paradas", "INSERT", {
            id: crypto.randomUUID(), maquina: maquinaSel,
            motivo: ehSetup ? `Setup — ${p.pecaSetup}` : (tp?.nome ?? "Parada"),
            tipo: tp?.categoria === "operacional" || tp?.categoria === "setup" ? "planejada" : "nao_planejada",
            inicio: inicio.toISOString(), fim: fim.toISOString(), duracao_min: p.minutos,
            operador: op, observacoes: ehSetup ? `Preparação para produzir ${p.pecaSetup}` : null,
            user_id: user?.id,
          });
          if (error) throw new Error("Falha ao gravar parada");
          fim = inicio;
        }
      }

      toast.success(`${maquinaSel} lançada${modo === "produziu" ? ` — ${qtdNum} pç` : ""}`);
      // "Salvar e seguir": vai para a próxima máquina ainda sem lançamento no turno.
      const idx = maquinas.findIndex(m => m.codigo === maquinaSel);
      const ordem = [...maquinas.slice(idx + 1), ...maquinas.slice(0, idx)];
      const proxima = ordem.find(m => restanteMaquina(m.codigo) > 0.01 && m.codigo !== maquinaSel);
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

  const maquinasLancadas = maquinas.filter(m => restanteMaquina(m.codigo) <= 0.01).length;
  const lancadosMaquina = apontamentosHoje.filter(a => (a.maquina_codigo || a.maquina) === maquinaSel && a.turno === turnoDef.label);

  // ── UI ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 animate-in fade-in duration-200" id="diario-topo">
      {/* Barra do turno: data, turno, operador, progresso */}
      <div className="rounded-2xl border bg-card shadow-xs p-3 sm:p-4 flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Factory className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold capitalize truncate">
              {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
            </p>
            <p className="text-xs text-muted-foreground">
              {maquinasLancadas} de {maquinas.length} máquinas lançadas no {turnoDef.label}
            </p>
          </div>
        </div>

        {/* Turno (segmentado) */}
        <div className="flex rounded-xl border bg-muted/40 p-1 lg:ml-auto" role="radiogroup" aria-label="Turno">
          {TURNOS.map(t => (
            <button key={t.id} type="button" role="radio" aria-checked={turnoSel === t.id}
              onClick={() => { setTurnoSel(t.id); setMaquinaSel(""); setHorasCustom(null); }}
              className={cn("flex-1 lg:flex-none flex items-center justify-center gap-1.5 h-10 px-4 rounded-lg text-sm font-medium transition-colors",
                turnoSel === t.id ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {t.id === 1 ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {t.label}
              <span className="hidden sm:inline text-xs text-muted-foreground font-normal">{fmtTurnoHorario(t)}</span>
            </button>
          ))}
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
                  const pct = Math.min(100, (lanc / turnoDef.duracaoH) * 100);
                  const completa = restanteMaquina(m.codigo) <= 0.01;
                  const ativa = maquinaSel === m.codigo;
                  return (
                    <button key={m.id} type="button" onClick={() => { setMaquinaSel(m.codigo); setHorasCustom(null); setParadas([]); }}
                      aria-pressed={ativa}
                      className={cn("relative rounded-xl border-2 p-2.5 text-left transition-all min-h-[76px]",
                        ativa ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:border-primary/40",
                        completa && !ativa && "opacity-70")}>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[15px] font-bold">{m.codigo}</span>
                        {completa
                          ? <CheckCircle2 className="h-4 w-4 text-green-600" aria-label="Turno lançado" />
                          : <span className={cn("h-2 w-2 rounded-full", st.dot)} title={st.label} />}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{m.nome}</p>
                      <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
                        <div className={cn("h-full rounded-full", completa ? "bg-green-500" : "bg-primary")} style={{ width: `${pct}%` }} />
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                        {completa ? "Turno completo" : lanc > 0 ? `${fmtH(lanc)} de ${fmtH(turnoDef.duracaoH)}` : "Sem lançamento"}
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
              <Etapa n={5} titulo="Quanto tempo?" dica="já vem preenchido com o que falta do turno">
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setHorasCustom(null)} aria-pressed={horasCustom === null}
                    className={cn("h-11 px-4 rounded-xl border-2 text-sm font-medium",
                      horasCustom === null ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/40")}>
                    {restante >= turnoDef.duracaoH - 0.01 ? "Turno inteiro" : "Restante do turno"} · {fmtH(restante)}
                  </button>
                  <div className={cn("flex items-center gap-2 h-11 px-3 rounded-xl border-2",
                    horasCustom !== null ? "border-primary bg-primary/5" : "border-border")}>
                    <span className="text-sm text-muted-foreground">Outro:</span>
                    <Input type="number" min="0" step="0.25" inputMode="decimal" value={horasCustom ?? ""}
                      onChange={e => setHorasCustom(e.target.value)} onFocus={() => setHorasCustom(v => v ?? "")}
                      placeholder="horas" aria-label="Horas trabalhadas"
                      className="h-8 w-20 border-0 bg-transparent px-1 text-sm focus-visible:ring-0" />
                    <span className="text-sm text-muted-foreground">h</span>
                  </div>
                </div>
              </Etapa>
            </>
          )}

          {/* Paradas */}
          <Etapa n={modo === "produziu" ? 6 : 3}
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
          </Etapa>

          {/* Opcionais: refugo e matéria-prima */}
          {modo === "produziu" && (
            <div className="space-y-2 sm:pl-8">
              <button type="button" onClick={() => setMostrarRefugo(v => !v)}
                className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
                <ChevronRight className={cn("h-4 w-4 transition-transform", mostrarRefugo && "rotate-90")} />
                Refugo e material {totalRefugo > 0 && <span className="text-destructive">· {totalRefugo} pç refugadas</span>}
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
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Matéria-prima usada</p>
                    <select value={materia} onChange={e => setMateria(e.target.value)}
                      className="w-full h-11 rounded-xl border border-input bg-background px-3 text-sm">
                      <option value="">Não informar</option>
                      {materias.map(m => <option key={m.id} value={m.id}>{m.codigo} — {m.descricao}</option>)}
                    </select>
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
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Turno</dt><dd className="font-medium">{turnoDef.label}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Operador</dt><dd className="font-medium truncate">{operador || "—"}</dd></div>
              {modo === "produziu" ? (
                <>
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Peça</dt><dd className="font-semibold truncate">{peca || "—"}</dd></div>
                  <div className="border-t my-2" />
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Tempo</dt><dd className="tabular-nums">{fmtH(horasPeriodo)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">− Paradas</dt><dd className="tabular-nums">{fmtH(horasParadas)}</dd></div>
                  <div className="flex justify-between gap-3 font-semibold"><dt>= Produtivo</dt><dd className="tabular-nums text-green-600">{fmtH(horasProdutivas)}</dd></div>
                  {esperado > 0 && (
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground flex items-center gap-1"><Target className="h-3.5 w-3.5" />Esperado</dt>
                      <dd className="tabular-nums">{esperado.toLocaleString("pt-BR")} pç <span className="text-xs text-muted-foreground">({porHora}/h)</span></dd></div>
                  )}
                  <div className="flex justify-between gap-3 items-baseline"><dt className="text-muted-foreground">Produzido</dt>
                    <dd className="text-xl font-bold tabular-nums">{qtdNum.toLocaleString("pt-BR")} pç</dd></div>
                  {totalRefugo > 0 && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Refugo</dt><dd className="tabular-nums text-destructive">{totalRefugo} pç</dd></div>}
                  {eficiencia !== null && (
                    <div className={cn("rounded-lg px-3 py-2 text-center text-sm font-semibold",
                      eficiencia >= 95 ? "bg-green-500/10 text-green-700 dark:text-green-400" : eficiencia >= 80 ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-red-500/10 text-red-700 dark:text-red-400")}>
                      Eficiência {eficiencia.toFixed(0)}%
                    </div>
                  )}
                </>
              ) : (
                <div className="flex justify-between gap-3 font-semibold border-t pt-2"><dt>Tempo parado</dt><dd className="tabular-nums text-amber-600">{fmtH(horasParadas)}</dd></div>
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
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Já lançado em {maquinaSel} · {turnoDef.label}</p>
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
          { Icon: Package,    label: "Peças hoje",   value: resumo.totalPecas.toLocaleString("pt-BR"), cor: "text-green-600" },
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
          <h3 className="text-sm font-semibold flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-600" /> Lançados hoje</h3>
          <button onClick={() => load()} disabled={loading} aria-label="Atualizar"
            className="ml-auto h-9 w-9 flex items-center justify-center rounded-lg border hover:bg-muted">
            <RefreshCw className={cn("h-4 w-4 text-muted-foreground", loading && "animate-spin")} />
          </button>
        </div>
        {apontamentosHoje.length === 0 && paradasHoje.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Nada lançado hoje ainda.</p>
        ) : (
          <div className="divide-y">
            {apontamentosHoje.slice(0, 30).map(a => (
              <div key={a.id} className="py-2.5 flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0"><Package className="h-4 w-4 text-green-600" /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{a.maquina_codigo || a.maquina} · {a.produto}</p>
                  <p className="text-xs text-muted-foreground">{a.turno} · {a.operador} · {fmtHora(a.created_at)}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-semibold text-sm text-green-600 tabular-nums">{a.quantidade.toLocaleString("pt-BR")} pç</p>
                  <p className="text-xs text-muted-foreground tabular-nums">{fmtH(Number(a.horas_planejadas) || 0)}</p>
                </div>
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
        Precisa lançar hora a hora, com lote e medições (planilha PPI-51)? Use a aba <strong className="text-foreground">Controle</strong>.
      </p>

      {/* Barra fixa de salvar no celular */}
      <div className="xl:hidden sticky bottom-2 z-20">
        <div className="rounded-2xl border bg-card/95 backdrop-blur shadow-lg px-3 py-2.5 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate">
              {maquinaSel || "—"}{modo === "produziu" ? ` · ${peca || "sem peça"} · ${qtdNum} pç` : ` · parada ${fmtH(horasParadas)}`}
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
