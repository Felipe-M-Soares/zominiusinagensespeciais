/**
 * LancamentoDiarioPanel — Aba "Diário" da Produção
 *
 * Lançamento de fim de turno, ancorado nos dois turnos fixos da empresa:
 *   1º Turno — 06:00 às 15:30 (9,5h)
 *   2º Turno — 15:31 à 01:30 do dia seguinte (≈9,98h)
 *
 * Ao escolher o turno, a duração total já é conhecida — não precisa mais
 * digitar "quantas horas rodou". As situações (Setup, Almoço, Manutenção...)
 * ficam dentro do mesmo bloco de produção (não são um item separado) e o
 * tempo produtivo é sempre calculado automaticamente subtraindo as situações
 * do turno, ao vivo, conforme você vai adicionando.
 *
 * Tudo numa janela só: lançamento do dia, gráficos, e os demonstrativos
 * semanal e mensal ficam na mesma tela, sem abas separadas.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import {
  Zap, Coffee, RefreshCw, CheckCircle2, Clock,
  Package, Factory, Timer, TrendingUp, Plus, X, ListPlus, User, Loader2,
  CalendarDays, CalendarRange, Gauge, Search, ChevronDown, Target,
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
  return 2; // cobre 15:31–24:00 e 00:00–01:30; o intervalo 01:30–06:00 cai no 2º por padrão
}
function fmtTurnoHorario(t: Turno): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(t.inicioH)}:${p(t.inicioM)} às ${p(t.fimH)}:${p(t.fimM)}${t.id === 2 ? " (dia seg.)" : ""}`;
}

// ── Tipos ────────────────────────────────────────────────────────────────────

interface Maquina    { id: string; codigo: string; nome: string; status: string; }
interface PecaOption { codigo: string; descricao: string; pecas_por_hora: number; origem: "producao" | "componente"; }
interface TipoParada { id: number; nome: string; categoria: string; }
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
interface SituacaoEmbutida { id: string; tipoParadaId: string; horas: string; pecaSetup?: string; }
interface Bloco {
  id: string; maquina: string; turno: 1 | 2;
  peca?: string; materiaId?: string; quantidade?: string; horas?: string;
  situacoes: SituacaoEmbutida[];
}

interface OeePeriodo { disponibilidade: number; performance: number; qualidade: number; oee: number; qtde_produzida: number; hr_planejadas: number; }

const CORES_PIZZA = ["#22c55e", "#ef4444", "#f59e0b", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#64748b", "#a855f7"];
const OPERADOR_STORAGE_KEY = "diario_producao_operador";

const lbl = "text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block";
const sel = "w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-shadow";

/** Numerinho de etapa — guia visual do fluxo de preenchimento */
function Step({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center justify-center h-[18px] w-[18px] rounded-full bg-primary/15 text-primary text-[10px] font-bold mr-1.5 align-middle">
      {n}
    </span>
  );
}

/**
 * PecaCombobox — seletor de peça COM BUSCA.
 * Substitui os <select> gigantes: com centenas de códigos, achar a peça
 * rolando a lista era o maior atrito da tela. Agora é digitar 2-3 letras.
 */
function PecaCombobox({ pecas, value, onChange, noneLabel }: {
  pecas: PecaOption[]; value: string; onChange: (v: string) => void; noneLabel?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca]   = useState("");
  const boxRef   = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selecionada = pecas.find(p => p.codigo === value);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const base = q
      ? pecas.filter(p => p.codigo.toLowerCase().includes(q) || p.descricao.toLowerCase().includes(q))
      : pecas;
    return base.slice(0, 80); // nunca renderiza a lista inteira de uma vez
  }, [busca, pecas]);

  useEffect(() => {
    if (!aberto) return;
    inputRef.current?.focus();
    const h = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [aberto]);

  const escolher = (codigo: string) => { onChange(codigo); setAberto(false); setBusca(""); };

  const grupos: Array<{ titulo: string; itens: PecaOption[] }> = [
    { titulo: "Produtos de produção",     itens: filtradas.filter(p => p.origem === "producao") },
    { titulo: "Componentes registrados",  itens: filtradas.filter(p => p.origem === "componente") },
  ];

  return (
    <div ref={boxRef} className="relative">
      <button type="button" onClick={() => setAberto(a => !a)}
        className={cn(sel, "flex items-center gap-2 text-left")}>
        {selecionada ? (
          <span className="flex-1 truncate">
            <span className="font-semibold">{selecionada.codigo}</span>
            <span className="text-muted-foreground"> — {selecionada.descricao}</span>
          </span>
        ) : (
          <span className="flex-1 truncate text-muted-foreground">{noneLabel ?? "Selecionar peça..."}</span>
        )}
        {value && (
          <span role="button" tabIndex={0} className="text-muted-foreground hover:text-red-500 shrink-0"
            onClick={e => { e.stopPropagation(); escolher(""); }}
            onKeyDown={e => { if (e.key === "Enter") { e.stopPropagation(); escolher(""); } }}>
            <X className="h-3.5 w-3.5" />
          </span>
        )}
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground shrink-0 transition-transform", aberto && "rotate-180")} />
      </button>

      {aberto && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-border bg-card shadow-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 border-b border-border/40">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input ref={inputRef} value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="Digite o código ou a descrição..."
              className="w-full h-9 bg-transparent text-sm focus:outline-none" />
          </div>
          <div className="max-h-60 overflow-y-auto overscroll-contain">
            {noneLabel && !busca && (
              <button type="button" onClick={() => escolher("")}
                className="w-full text-left px-3 py-2 text-[12.5px] text-muted-foreground hover:bg-muted/40">
                {noneLabel}
              </button>
            )}
            {filtradas.length === 0 && (
              <p className="px-3 py-4 text-[12px] text-muted-foreground text-center">Nenhuma peça encontrada para "{busca}"</p>
            )}
            {grupos.map(g => g.itens.length > 0 && (
              <div key={g.titulo}>
                <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground/70 sticky top-0 bg-card">{g.titulo}</p>
                {g.itens.map(p => (
                  <button key={p.codigo} type="button" onClick={() => escolher(p.codigo)}
                    className={cn("w-full text-left px-3 py-2 text-[12.5px] hover:bg-muted/40 flex items-center gap-2",
                      p.codigo === value && "bg-primary/5")}>
                    <span className="font-semibold shrink-0">{p.codigo}</span>
                    <span className="text-muted-foreground truncate">{p.descricao}</span>
                    {p.pecas_por_hora > 0 && (
                      <span className="ml-auto text-[10px] text-muted-foreground/70 shrink-0">{p.pecas_por_hora} pç/h</span>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const STATUS_MAQUINA: Record<string, { label: string; dot: string; text: string }> = {
  operando: { label: "Operando", dot: "bg-green-500", text: "text-green-700 dark:text-green-400" },
  setup: { label: "Em setup", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400" },
  parada: { label: "Parada", dot: "bg-red-500", text: "text-red-700 dark:text-red-400" },
  manutencao: { label: "Manutenção", dot: "bg-red-500", text: "text-red-700 dark:text-red-400" },
};

function fmtHora(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function minutosDecorridos(inicioIso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(inicioIso).getTime()) / 60000));
}
function horaNum(s: string): number {
  return parseFloat((s || "0").replace(",", ".")) || 0;
}
function inicioSemanaISO(): string {
  const d = new Date();
  const dow = d.getDay(); // 0=domingo
  const diffSegunda = dow === 0 ? 6 : dow - 1;
  d.setDate(d.getDate() - diffSegunda);
  return d.toISOString().split("T")[0];
}
function OeeCor(v: number): string {
  return v >= 85 ? "text-green-600" : v >= 65 ? "text-amber-600" : "text-red-600";
}
function OeeBg(v: number): string {
  return v >= 85 ? "bg-green-500" : v >= 65 ? "bg-amber-500" : "bg-red-500";
}

// ── Painel ───────────────────────────────────────────────────────────────────

export function LancamentoDiarioPanel() {
  const { user } = useAuth();
  const { saveWithFallback, saveRpcWithFallback, loadWithFallback } = useOfflineSync();

  const [maquinas, setMaquinas]       = useState<Maquina[]>([]);
  const [pecas, setPecas]             = useState<PecaOption[]>([]);
  const [tiposParada, setTiposParada] = useState<TipoParada[]>([]);
  const [materias, setMaterias]       = useState<MateriaPrima[]>([]);

  const [apontamentosHoje, setApontamentosHoje] = useState<ApontamentoHoje[]>([]);
  const [paradasHoje, setParadasHoje]           = useState<ParadaHoje[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);

  const [oeeSemana, setOeeSemana] = useState<OeePeriodo | null>(null);
  const [oeeMes, setOeeMes]       = useState<OeePeriodo | null>(null);
  const [loadingResumos, setLoadingResumos] = useState(true);

  // ── Montagem do bloco atual ──────────────────────────────────────────────
  const [maquinaSel, setMaquinaSel] = useState("");
  const [turnoSel, setTurnoSel] = useState<1 | 2>(turnoAtual());
  const [operador, setOperador] = useState(() => {
    try { return localStorage.getItem(OPERADOR_STORAGE_KEY) ?? ""; } catch { return ""; }
  });
  const [peca, setPeca] = useState("");
  const [materia, setMateria] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [horas, setHoras] = useState("");
  const [horasEditadoManual, setHorasEditadoManual] = useState(false);
  const [situacoesTemp, setSituacoesTemp] = useState<SituacaoEmbutida[]>([]);
  const [novaSituacaoTipo, setNovaSituacaoTipo] = useState("");
  const [novaSituacaoHoras, setNovaSituacaoHoras] = useState("");
  const [novaSituacaoPeca, setNovaSituacaoPeca] = useState("");

  const [blocos, setBlocos] = useState<Bloco[]>([]);

  useEffect(() => {
    try { localStorage.setItem(OPERADOR_STORAGE_KEY, operador); } catch { /* ignore */ }
  }, [operador]);

  const hoje = new Date().toISOString().split("T")[0];

  const load = useCallback(async () => {
    setLoading(true);
    const dia = new Date().toISOString().split("T")[0];
    const [maqRes, prodRes, devRes, tpRes, mpRes, apRes, parRes] = await Promise.all([
      loadWithFallback<Maquina>("maquinas_producao", "maquinas"),
      supabase.from("produtos_producao").select("codigo,descricao,pecas_por_hora").eq("ativo", true).order("codigo"),
      supabase.from("devices").select("internal_code,model,reference").eq("ativo", true).order("internal_code"),
      supabase.from("tipo_parada_producao").select("id,nome,categoria").eq("ativo", true).order("id"),
      loadWithFallback<MateriaPrima>("materias_primas_producao", "materias_primas"),
      supabase.from("apontamentos_producao")
        .select("id,maquina_codigo,maquina,produto,quantidade,qtde_plan_disp,horas_planejadas,turno,operador,created_at")
        .eq("data_apontamento", dia).order("created_at", { ascending: false }),
      supabase.from("paradas_producao")
        .select("id,maquina,motivo,tipo,inicio,fim,duracao_min,operador,observacoes,user_id")
        .gte("inicio", `${dia}T00:00:00`).order("inicio", { ascending: false }),
    ]);

    const maqOrdenadas = maqRes.sort((a, b) => a.codigo.localeCompare(b.codigo));
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
    setMaterias(mpRes.sort((a, b) => a.codigo.localeCompare(b.codigo)));
    if (apRes.data) setApontamentosHoje(apRes.data as ApontamentoHoje[]);
    if (parRes.data) setParadasHoje(parRes.data as ParadaHoje[]);

    setMaquinaSel(prev => prev || maqOrdenadas[0]?.codigo || "");
    setLoading(false);
  }, [loadWithFallback]);

  const loadResumos = useCallback(async () => {
    setLoadingResumos(true);
    const hojeD = new Date();
    const iniSemana = inicioSemanaISO();
    const mes = hojeD.getMonth() + 1, ano = hojeD.getFullYear();
    try {
      const [{ data: semana }, { data: mensal }] = await Promise.all([
        (supabase.rpc as any)("calcular_oee", { p_data_ini: iniSemana, p_data_fim: hoje, p_maquina: null }),
        (supabase.rpc as any)("resumo_mensal_producao", { p_mes: mes, p_ano: ano }),
      ]);
      if (semana) setOeeSemana(semana as OeePeriodo);
      const geral = (mensal as { geral?: OeePeriodo } | null)?.geral;
      if (geral) setOeeMes(geral);
    } catch { /* silencioso — resumo é complementar */ }
    setLoadingResumos(false);
  }, [hoje]);

  useEffect(() => { load(); loadResumos(); }, [load, loadResumos]);

  const tipoSetup = useMemo(
    () => tiposParada.find(t => t.nome.trim().toLowerCase() === "setup"),
    [tiposParada]
  );
  const novaSituacaoEhSetup = novaSituacaoTipo !== "" && Number(novaSituacaoTipo) === tipoSetup?.id;
  const turnoAtualDef = TURNOS.find(t => t.id === turnoSel)!;

  // ── Alocação do turno selecionado, pra máquina selecionada ─────────────────
  // Quanto já foi lançado (salvo hoje + na lista pendente) nesse turno, pra
  // mostrar quanto tempo ainda resta e sugerir automaticamente as horas do
  // próximo bloco — é isso que elimina ter que digitar "horas totais" do zero.
  const alocacaoTurno = useMemo(() => {
    const turnoLabel = turnoAtualDef.label;
    const jaSalvo = apontamentosHoje
      .filter(a => (a.maquina_codigo || a.maquina) === maquinaSel && a.turno === turnoLabel)
      .reduce((s, a) => s + (Number(a.horas_planejadas) || 0), 0);
    const jaPendente = blocos
      .filter(b => b.maquina === maquinaSel && b.turno === turnoSel)
      .reduce((s, b) => {
        if (b.peca) return s + horaNum(b.horas ?? "0");
        return s + b.situacoes.reduce((ss, x) => ss + horaNum(x.horas), 0);
      }, 0);
    const usado = jaSalvo + jaPendente;
    const disponivel = Math.max(0, turnoAtualDef.duracaoH - usado);
    return { jaSalvo, jaPendente, usado, disponivel, total: turnoAtualDef.duracaoH };
  }, [apontamentosHoje, blocos, maquinaSel, turnoSel, turnoAtualDef]);

  // Sugere automaticamente as horas do bloco atual = tempo disponível no
  // turno, a não ser que o usuário já tenha editado manualmente esse campo
  useEffect(() => {
    if (!horasEditadoManual && peca) {
      setHoras(alocacaoTurno.disponivel > 0 ? alocacaoTurno.disponivel.toFixed(2).replace(/\.?0+$/, "") || "0" : "");
    }
  }, [alocacaoTurno.disponivel, peca, horasEditadoManual]);

  // Tempo produtivo do bloco atual = horas do bloco − situações já
  // adicionadas nele — calculado ao vivo, sem precisar de conta manual
  const horasSituacoesTemp = situacoesTemp.reduce((s, x) => s + horaNum(x.horas), 0);
  const horasProdutivasBloco = Math.max(0, horaNum(horas) - horasSituacoesTemp);

  function limparMiniFormSituacao() {
    setNovaSituacaoTipo(""); setNovaSituacaoHoras(""); setNovaSituacaoPeca("");
  }
  function limparBlocoAtual() {
    setPeca(""); setMateria(""); setQuantidade(""); setHoras(""); setHorasEditadoManual(false); setSituacoesTemp([]);
    limparMiniFormSituacao();
  }

  function adicionarSituacaoAoBloco() {
    if (!novaSituacaoTipo) { toast.error("Selecione o código de situação"); return; }
    const h = horaNum(novaSituacaoHoras);
    if (h <= 0) { toast.error("Informe as horas dessa situação"); return; }
    if (novaSituacaoEhSetup && !novaSituacaoPeca) { toast.error("Selecione a peça que será produzida depois do setup"); return; }
    setSituacoesTemp(prev => [...prev, {
      id: crypto.randomUUID(), tipoParadaId: novaSituacaoTipo, horas: novaSituacaoHoras,
      pecaSetup: novaSituacaoEhSetup ? novaSituacaoPeca : undefined,
    }]);
    limparMiniFormSituacao();
  }
  function removerSituacaoDoBloco(id: string) {
    setSituacoesTemp(prev => prev.filter(s => s.id !== id));
  }

  function adicionarBloco() {
    if (!maquinaSel) { toast.error("Selecione a máquina"); return; }
    const temProducao = !!peca;
    if (temProducao) {
      if (!quantidade || parseInt(quantidade) <= 0) { toast.error("Informe a quantidade produzida"); return; }
      const h = horaNum(horas);
      if (h <= 0) { toast.error("Informe as horas do bloco"); return; }
      if (horasSituacoesTemp > h) { toast.error("As situações somadas não podem passar das horas do bloco"); return; }
    } else if (situacoesTemp.length === 0) {
      toast.error("Sem peça selecionada, adicione ao menos uma situação (o período foi só parada)");
      return;
    }

    const bloco: Bloco = {
      id: crypto.randomUUID(), maquina: maquinaSel, turno: turnoSel,
      peca: temProducao ? peca : undefined,
      materiaId: temProducao ? (materia || undefined) : undefined,
      quantidade: temProducao ? quantidade : undefined,
      horas: temProducao ? horas : undefined,
      situacoes: situacoesTemp,
    };
    setBlocos(prev => [...prev, bloco]);
    limparBlocoAtual();
    toast.success("Bloco adicionado à lista");
  }

  function removerBloco(id: string) {
    setBlocos(prev => prev.filter(b => b.id !== id));
  }

  // ── Salva tudo o que está na lista, de uma vez ──────────────────────────────
  async function salvarTudo() {
    if (blocos.length === 0) { toast.error("Adicione ao menos um bloco à lista"); return; }
    if (!operador.trim()) { toast.error("Informe o operador"); return; }

    setSaving(true);
    const falharam: Bloco[] = [];

    for (const bloco of blocos) {
      const turnoDef = TURNOS.find(t => t.id === bloco.turno)!;
      const agora = new Date();
      // Horário fixo do turno vira o horário do lançamento (início/fim reais
      // do turno), em vez de calcular pra trás a partir de "agora"
      const inicioDec = turnoDef.inicioH + turnoDef.inicioM / 60;
      const fimDec = turnoDef.fimH + turnoDef.fimM / 60;
      const hBloco = bloco.peca
        ? horaNum(bloco.horas ?? "0")
        : bloco.situacoes.reduce((s, x) => s + horaNum(x.horas), 0);

      try {
        if (bloco.peca) {
          const pecaSel = pecas.find(pc => pc.codigo === bloco.peca);
          const mp = materias.find(m => m.id === bloco.materiaId);
          const qtde = parseInt(bloco.quantidade ?? "0") || 0;
          const porHora = pecaSel?.pecas_por_hora ?? 0;
          const horasSituacoes = bloco.situacoes.reduce((s, x) => s + horaNum(x.horas), 0);
          const horasProdutivas = Math.max(0, hBloco - horasSituacoes);
          const planDisp = horasProdutivas > 0 && porHora > 0 ? +(porHora * horasProdutivas).toFixed(2) : qtde;

          const pParadas = bloco.situacoes.map(s => {
            const tp = tiposParada.find(t => t.id === Number(s.tipoParadaId));
            return {
              tipo_id: Number(s.tipoParadaId),
              tipo_nome: tp?.id === tipoSetup?.id ? `Setup — ${s.pecaSetup}` : (tp?.nome ?? "Situação"),
              duracao_horas: horaNum(s.horas),
            };
          });

          const args = {
            p_data: hoje, p_turno: turnoDef.label,
            p_maquina: bloco.maquina, p_equipamento: bloco.maquina,
            p_produto: bloco.peca, p_descricao_produto: pecaSel?.descricao ?? bloco.peca,
            p_qtde_por_hora: porHora, p_horas_planejadas: hBloco, p_qtde_plan_disp: planDisp,
            p_qtde_produzida: qtde,
            p_horario_inicio: +inicioDec.toFixed(4), p_horario_fim: +fimDec.toFixed(4),
            p_cycle_time_min: qtde > 0 && horasProdutivas > 0 ? +((horasProdutivas * 60) / qtde).toFixed(4) : null,
            p_lead_time_horas: hBloco || null,
            p_lote: "", p_lote_mp: mp?.lote_atual ?? "", p_descricao_mp: mp?.descricao ?? "",
            p_comprimento_mm: null, p_consumo_mp_metros: null,
            p_operador: operador.trim(), p_paradas: pParadas, p_refugos: [],
          };
          const preview = {
            seq_producao: 0, data_apontamento: hoje, turno: turnoDef.label,
            maquina: bloco.maquina, maquina_codigo: bloco.maquina,
            produto: bloco.peca, descricao_produto: pecaSel?.descricao,
            qtde_por_hora: porHora, horas_planejadas: hBloco, qtde_plan_disp: planDisp,
            quantidade: qtde, horario_inicio: inicioDec, horario_fim: fimDec,
            lote: "(pendente)", operador: operador.trim(), status: "concluido",
            created_at: agora.toISOString(),
          };
          const { ok } = await saveRpcWithFallback("criar_apontamento_ppi51", args, "apontamentos", preview);
          if (!ok) throw new Error("Falha ao gravar produção");
        } else {
          let fimSituacao = new Date(agora);
          for (let j = bloco.situacoes.length - 1; j >= 0; j--) {
            const s = bloco.situacoes[j];
            const hs = horaNum(s.horas);
            const inicioSituacao = new Date(fimSituacao.getTime() - hs * 3600000);
            const tp = tiposParada.find(t => t.id === Number(s.tipoParadaId));
            const ehSetup = tp?.id === tipoSetup?.id;
            const motivo = ehSetup ? `Setup — ${s.pecaSetup}` : (tp?.nome ?? "Situação");
            const parada = {
              id: crypto.randomUUID(), maquina: bloco.maquina, motivo,
              tipo: tp?.categoria === "operacional" || tp?.categoria === "setup" ? "planejada" : "nao_planejada",
              inicio: inicioSituacao.toISOString(), fim: fimSituacao.toISOString(), duracao_min: Math.round(hs * 60),
              operador: operador.trim(),
              observacoes: ehSetup ? `Preparação para produzir ${s.pecaSetup}` : null,
              user_id: user?.id,
            };
            const { error } = await saveWithFallback("paradas_producao", "paradas", "INSERT", parada);
            if (error) throw new Error("Falha ao gravar situação");
            fimSituacao = inicioSituacao;
          }
        }
      } catch {
        falharam.push(bloco);
      }
    }

    setSaving(false);
    const totalSalvos = blocos.length - falharam.length;
    if (falharam.length === 0) {
      toast.success(`${totalSalvos} lançamento${totalSalvos !== 1 ? "s" : ""} salvo${totalSalvos !== 1 ? "s" : ""} com sucesso!`);
      setBlocos([]);
    } else {
      toast.error(`${totalSalvos} salvos, ${falharam.length} falharam — continuam na lista pra tentar de novo`);
      setBlocos(falharam);
    }
    load();
    loadResumos();
  }

  // ── Agregações do dia para os gráficos ─────────────────────────────────────
  const resumo = useMemo(() => {
    const horasProducao = apontamentosHoje.reduce((s, a) => s + (Number(a.horas_planejadas) || 0), 0);
    const totalPecas    = apontamentosHoje.reduce((s, a) => s + (a.quantidade || 0), 0);
    const totalPlan     = apontamentosHoje.reduce((s, a) => s + (Number(a.qtde_plan_disp) || 0), 0);
    const eficiencia    = totalPlan > 0 ? (totalPecas / totalPlan) * 100 : 0;

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

    return { horasProducao, totalPecas, totalPlan, eficiencia, pizzaTempo, barMaquinas };
  }, [apontamentosHoje, paradasHoje]);

  const maquinaAtual = maquinas.find(m => m.codigo === maquinaSel);

  const blocosPorMaquina = useMemo(() => {
    const g = new Map<string, Bloco[]>();
    for (const b of blocos) g.set(b.maquina, [...(g.get(b.maquina) ?? []), b]);
    return [...g.entries()];
  }, [blocos]);

  function descricaoBloco(b: Bloco): string {
    const turnoTxt = TURNOS.find(t => t.id === b.turno)!.label;
    if (b.peca) {
      const pecaSel = pecas.find(pc => pc.codigo === b.peca);
      const sits = b.situacoes.length > 0 ? ` + ${b.situacoes.length} situação(ões)` : "";
      return `${turnoTxt} · ${b.peca}${pecaSel ? ` (${pecaSel.descricao})` : ""} · ${b.quantidade} pç · ${b.horas}h${sits}`;
    }
    return `${turnoTxt} · ` + b.situacoes.map(s => {
      const tp = tiposParada.find(t => t.id === Number(s.tipoParadaId));
      const ehSetup = tp?.id === tipoSetup?.id;
      return `${ehSetup ? `Setup (${s.pecaSetup})` : tp?.nome ?? "Situação"} · ${s.horas}h`;
    }).join(", ");
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Explica a diferença pra Controle — as duas telas registram
          apontamento de produção, mas servem pra fluxos diferentes. */}
      <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-3 py-2 flex items-start gap-2">
        <Zap className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          <strong className="text-foreground">Lançamento rápido de turno</strong> — você escolhe o turno e a duração já é calculada. Precisa registrar por máquina/hora, com paradas e refugos detalhados (igual à planilha PPI-51)? Use a aba <strong className="text-foreground">Controle</strong>.
        </p>
      </div>

      {/* Cabeçalho do dia */}
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold">
          {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
        </p>
        <span className="text-[11px] text-muted-foreground">· {TURNOS.find(t => t.id === turnoAtual())?.label} em curso</span>
        <button onClick={() => { load(); loadResumos(); }} disabled={loading}
          className="ml-auto h-9 w-9 flex items-center justify-center rounded-lg border border-input hover:bg-muted/40 transition-colors">
          <RefreshCw className={cn("h-4 w-4 text-muted-foreground", loading && "animate-spin")} />
        </button>
      </div>

      {/* KPIs do dia */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { Icon: Package,    label: "Peças hoje",  value: resumo.totalPecas.toLocaleString("pt-BR"), cor: "text-green-600",  bg: "bg-green-500/5 border-green-500/20" },
          { Icon: Timer,      label: "Hr produção", value: `${resumo.horasProducao.toFixed(1)}h`,     cor: "text-blue-600",   bg: "bg-blue-500/5 border-blue-500/20" },
          { Icon: TrendingUp, label: "Eficiência",  value: `${resumo.eficiencia.toFixed(1)}%`,        cor: resumo.eficiencia >= 95 ? "text-green-600" : resumo.eficiencia >= 80 ? "text-amber-600" : "text-red-600", bg: "bg-purple-500/5 border-purple-500/20" },
          { Icon: ListPlus,   label: "Na lista",    value: String(blocos.length),                     cor: blocos.length > 0 ? "text-blue-600" : "text-muted-foreground", bg: "bg-blue-500/5 border-blue-500/20" },
        ].map(k => (
          <div key={k.label} className={cn("rounded-2xl border p-3.5 space-y-1 transition-shadow hover:shadow-sm", k.bg)}>
            <div className="flex items-center gap-1.5">
              <k.Icon className={cn("h-3.5 w-3.5", k.cor)} />
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">{k.label}</p>
            </div>
            <p className={cn("text-xl font-bold tabular-nums", k.cor)}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Montagem do bloco */}
      <div className="rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border/40 bg-muted/20">
          <h3 className="text-[13px] font-bold flex items-center gap-2">
            <ListPlus className="h-4 w-4 text-primary" /> Novo lançamento
          </h3>
        </div>

        <div className="p-5 space-y-5">
          {/* Máquina */}
          <div>
            <label className={lbl}><Step n={1} />Máquina *</label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {maquinas.map(m => {
                const st = STATUS_MAQUINA[m.status] ?? STATUS_MAQUINA.operando;
                const ativa = maquinaSel === m.codigo;
                const qtdNaLista = blocos.filter(b => b.maquina === m.codigo).length;
                return (
                  <button key={m.id} type="button" onClick={() => setMaquinaSel(m.codigo)}
                    className={cn("relative flex flex-col items-center justify-center gap-0.5 h-16 rounded-xl border-2 transition-all",
                      ativa ? "border-primary bg-primary/5 shadow-sm" : "border-input hover:border-primary/30 hover:bg-muted/30")}>
                    <span className="text-sm font-bold">{m.codigo}</span>
                    <span className="text-[9px] text-muted-foreground truncate max-w-full px-1">{m.nome}</span>
                    <span className="absolute top-1.5 right-1.5 flex items-center gap-1">
                      {qtdNaLista > 0 && <span className="text-[9px] font-bold text-blue-600 bg-blue-500/15 rounded-full h-3.5 w-3.5 flex items-center justify-center">{qtdNaLista}</span>}
                      <span className={cn("h-1.5 w-1.5 rounded-full", st.dot)} />
                    </span>
                  </button>
                );
              })}
            </div>
            {maquinaAtual && (
              <p className={cn("text-[11px] mt-1.5 font-medium", STATUS_MAQUINA[maquinaAtual.status]?.text)}>
                {maquinaAtual.codigo} — {STATUS_MAQUINA[maquinaAtual.status]?.label ?? maquinaAtual.status}
              </p>
            )}
          </div>

          {/* Operador */}
          <div>
            <label className={lbl}><Step n={2} /><User className="h-3 w-3 inline -mt-0.5 mr-1" />Operador *</label>
            <Input value={operador} onChange={e => setOperador(e.target.value)} className="h-10" placeholder="Nome do operador" />
          </div>

          {/* Turno — duração fixa, cálculo automático */}
          <div>
            <label className={lbl}><Step n={3} />Turno *</label>
            <div className="grid grid-cols-2 gap-2">
              {TURNOS.map(t => (
                <button key={t.id} type="button" onClick={() => setTurnoSel(t.id)}
                  className={cn("rounded-xl border-2 p-3 text-left transition-all",
                    turnoSel === t.id ? "border-primary bg-primary/5" : "border-input hover:border-primary/30")}>
                  <p className="text-[12px] font-bold">{t.label}</p>
                  <p className="text-[10.5px] text-muted-foreground">{fmtTurnoHorario(t)}</p>
                  <p className="text-[10px] text-muted-foreground/70">{t.duracaoH.toFixed(2).replace(/\.?0+$/, "")}h de duração</p>
                </button>
              ))}
            </div>
            {/* Barra de alocação do turno pra máquina selecionada */}
            <div className="mt-2.5 rounded-xl border border-border/40 bg-muted/10 p-3 space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Alocado neste turno — {maquinaSel || "—"}</span>
                <span className="font-semibold">{alocacaoTurno.usado.toFixed(2).replace(/\.?0+$/, "")}h / {alocacaoTurno.total.toFixed(2).replace(/\.?0+$/, "")}h</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className={cn("h-full rounded-full transition-all", alocacaoTurno.usado > alocacaoTurno.total ? "bg-red-500" : "bg-primary")}
                  style={{ width: `${Math.min(100, (alocacaoTurno.usado / alocacaoTurno.total) * 100)}%` }} />
              </div>
              <p className="text-[10px] text-muted-foreground">
                {alocacaoTurno.disponivel > 0
                  ? `${alocacaoTurno.disponivel.toFixed(2).replace(/\.?0+$/, "")}h ainda disponíveis neste turno`
                  : "Turno totalmente alocado"}
              </p>
            </div>
          </div>

          {/* Produção */}
          <div className="rounded-xl border border-border/60 p-3.5 space-y-3">
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <Step n={4} /><Zap className="h-3.5 w-3.5 text-green-600" /> Produção neste bloco <span className="font-normal normal-case text-muted-foreground/70">(deixe em "Nenhuma" se foi só parada)</span>
            </p>
            <div><label className={lbl}>Peça</label>
              <PecaCombobox pecas={pecas} value={peca} onChange={setPeca}
                noneLabel="Nenhuma — período só com situação/parada" />
            </div>
            {peca && (
              <>
                <div><label className={lbl}>Material usado</label>
                  <select value={materia} onChange={e => setMateria(e.target.value)} className={sel}>
                    <option value="">Nenhum / não informar</option>
                    {materias.map(m => <option key={m.id} value={m.id}>{m.codigo} — {m.descricao}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={lbl}>Quantidade produzida *</label>
                    <Input type="number" min="1" inputMode="numeric" value={quantidade}
                      onChange={e => setQuantidade(e.target.value)} className="h-10" placeholder="pç" />
                  </div>
                  <div><label className={lbl}>Horas do bloco * <span className="normal-case font-normal text-muted-foreground/70">(sugerido)</span></label>
                    <Input type="number" min="0" step="0.25" inputMode="decimal" value={horas}
                      onChange={e => { setHoras(e.target.value); setHorasEditadoManual(true); }} className="h-10" placeholder="ex: 5" />
                  </div>
                </div>
                {/* Meta ao vivo: quanto essa peça deveria render no tempo produtivo.
                    O operador confere na hora se a quantidade digitada faz sentido. */}
                {(() => {
                  const pecaSelInfo = pecas.find(pc => pc.codigo === peca);
                  const porHora = pecaSelInfo?.pecas_por_hora ?? 0;
                  if (porHora <= 0 || horasProdutivasBloco <= 0) return null;
                  const esperado = Math.round(porHora * horasProdutivasBloco);
                  const qtdeNum = parseInt(quantidade) || 0;
                  const efic = esperado > 0 && qtdeNum > 0 ? (qtdeNum / esperado) * 100 : null;
                  return (
                    <div className="flex items-center justify-between rounded-lg bg-muted/20 border border-border/40 px-3 py-2">
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                        <Target className="h-3 w-3" /> Esperado p/ {horasProdutivasBloco.toFixed(2).replace(/\.?0+$/, "")}h produtivas ({porHora} pç/h)
                      </span>
                      <span className="text-[12.5px] font-bold tabular-nums">
                        ≈ {esperado.toLocaleString("pt-BR")} pç
                        {efic !== null && (
                          <span className={cn("ml-2 text-[11px] font-semibold",
                            efic >= 95 ? "text-green-600" : efic >= 80 ? "text-amber-600" : "text-red-600")}>
                            ({efic.toFixed(0)}%)
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })()}
              </>
            )}
          </div>

          {/* Situações — dentro do mesmo bloco, cálculo automático */}
          <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-3.5 space-y-3">
            <p className="text-[11px] font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wide flex items-center gap-1.5">
              <Step n={5} /><Coffee className="h-3.5 w-3.5" /> Situações dentro deste bloco <span className="font-normal normal-case text-blue-700/70 dark:text-blue-400/70">(Setup, Almoço, Manutenção...)</span>
            </p>

            {situacoesTemp.length > 0 && (
              <div className="space-y-1.5">
                {situacoesTemp.map(s => {
                  const tp = tiposParada.find(t => t.id === Number(s.tipoParadaId));
                  const ehSetup = tp?.id === tipoSetup?.id;
                  return (
                    <div key={s.id} className="flex items-center gap-2 text-[12px] bg-card/70 rounded-lg px-2.5 py-1.5">
                      <span className="flex-1 truncate">{ehSetup ? `Setup — peça ${s.pecaSetup}` : tp?.nome}</span>
                      <span className="font-semibold shrink-0">{s.horas}h</span>
                      <button type="button" onClick={() => removerSituacaoDoBloco(s.id)} className="text-muted-foreground hover:text-red-500 shrink-0">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <select value={novaSituacaoTipo} onChange={e => setNovaSituacaoTipo(e.target.value)} className={cn(sel, "h-9")}>
                <option value="">Código de situação...</option>
                {tiposParada.map(t => <option key={t.id} value={t.id}>{String(t.id).padStart(2, "0")} — {t.nome}</option>)}
              </select>
              <Input type="number" min="0" step="0.25" inputMode="decimal" value={novaSituacaoHoras}
                onChange={e => setNovaSituacaoHoras(e.target.value)} className="h-9" placeholder="Horas" />
            </div>
            {novaSituacaoEhSetup && (
              <PecaCombobox pecas={pecas} value={novaSituacaoPeca} onChange={setNovaSituacaoPeca}
                noneLabel="Peça que será produzida depois do setup..." />
            )}
            <Button type="button" variant="outline" size="sm" className="w-full gap-1.5 h-9" onClick={adicionarSituacaoAoBloco}>
              <Plus className="h-3.5 w-3.5" /> Adicionar situação a este bloco
            </Button>

            {/* Cálculo automático — sem conta manual */}
            {peca && (
              <div className="flex items-center justify-between rounded-lg bg-card/80 border border-border/40 px-3 py-2">
                <span className="text-[11px] text-muted-foreground">Tempo produtivo (calculado automaticamente)</span>
                <span className={cn("text-[13px] font-bold tabular-nums", horasProdutivasBloco > 0 ? "text-green-600" : "text-muted-foreground")}>
                  {horaNum(horas).toFixed(2).replace(/\.?0+$/, "")}h − {horasSituacoesTemp.toFixed(2).replace(/\.?0+$/, "")}h = {horasProdutivasBloco.toFixed(2).replace(/\.?0+$/, "")}h
                </span>
              </div>
            )}
          </div>

          <Button className="w-full gap-1.5 h-11" variant="outline" onClick={adicionarBloco} disabled={saving}>
            <Plus className="h-4 w-4" /> Adicionar bloco à lista
          </Button>
        </div>
      </div>

      {/* Lista da sessão */}
      {blocos.length > 0 && (
        <div className="rounded-2xl border border-blue-500/30 bg-blue-500/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <ListPlus className="h-4 w-4 text-blue-600" /> Lançamentos prontos pra salvar
            </h3>
            <span className="text-[11px] text-muted-foreground">{blocos.length} bloco{blocos.length !== 1 ? "s" : ""}</span>
          </div>

          <div className="space-y-3">
            {blocosPorMaquina.map(([maquina, itens]) => (
              <div key={maquina} className="rounded-xl border bg-card/70 p-3 space-y-1.5">
                <p className="text-[11px] font-bold text-muted-foreground">{maquina}</p>
                {itens.map(b => (
                  <div key={b.id} className="flex items-center gap-2 text-[12px]">
                    <span className={cn("h-5 w-5 rounded flex items-center justify-center shrink-0",
                      b.peca ? "bg-green-500/10 text-green-600" : "bg-blue-500/10 text-blue-600")}>
                      {b.peca ? <Zap className="h-3 w-3" /> : <Coffee className="h-3 w-3" />}
                    </span>
                    <span className="flex-1 truncate">{descricaoBloco(b)}</span>
                    <button type="button" onClick={() => removerBloco(b.id)} className="text-muted-foreground hover:text-red-500 shrink-0">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <Button className="w-full gap-1.5 h-11" onClick={salvarTudo} disabled={saving}>
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvando...</> : <><CheckCircle2 className="h-4 w-4" /> Salvar todos os lançamentos de hoje ({blocos.length})</>}
          </Button>
        </div>
      )}

      {/* Gráficos do dia */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border bg-card p-4 space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" /> Distribuição do tempo — hoje
          </h3>
          {resumo.pizzaTempo.length === 0 ? (
            <p className="text-[12px] text-muted-foreground py-8 text-center">Sem lançamentos hoje ainda</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={resumo.pizzaTempo} dataKey="horas" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2}>
                    {resumo.pizzaTempo.map((d, i) => (
                      <Cell key={i} fill={d.name === "Produção" ? "#22c55e" : CORES_PIZZA[(i + 1) % CORES_PIZZA.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number, _n, item) => [`${v.toFixed(2)}h (${(item?.payload as { pct: number })?.pct}%)`, item?.payload?.name]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {resumo.pizzaTempo.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-1.5 text-[11px]">
                    <span className="h-2.5 w-2.5 rounded-sm shrink-0"
                      style={{ background: d.name === "Produção" ? "#22c55e" : CORES_PIZZA[(i + 1) % CORES_PIZZA.length] }} />
                    <span className="truncate">{d.name}</span>
                    <span className="ml-auto font-semibold shrink-0">{d.pct}%</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="rounded-2xl border bg-card p-4 space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Factory className="h-4 w-4 text-primary" /> Peças por máquina — hoje
          </h3>
          {resumo.barMaquinas.length === 0 ? (
            <p className="text-[12px] text-muted-foreground py-8 text-center">Nenhuma peça lançada hoje</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={resumo.barMaquinas} margin={{ top: 0, right: 0, left: -25, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="maquina" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number, _n, item) => [`${v.toLocaleString("pt-BR")} pç (${(item?.payload as { pct: number })?.pct}%)`, "Produzido"]}
                />
                <Bar dataKey="qtde" radius={[4, 4, 0, 0]}>
                  {resumo.barMaquinas.map((_, i) => <Cell key={i} fill={CORES_PIZZA[i % CORES_PIZZA.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Demonstrativos — mesma tela, sem aba separada */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ResumoPeriodoCard
          titulo="Demonstrativo da Semana" Icon={CalendarDays}
          subtitulo={`Desde segunda-feira até hoje`}
          dado={oeeSemana} loading={loadingResumos}
        />
        <ResumoPeriodoCard
          titulo="Demonstrativo do Mês" Icon={CalendarRange}
          subtitulo={new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
          dado={oeeMes} loading={loadingResumos}
        />
      </div>

      {/* Lançamentos do dia já salvos */}
      <div className="rounded-2xl border bg-card p-4 space-y-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-600" /> Lançamentos de hoje (já salvos)
        </h3>
        {apontamentosHoje.length === 0 ? (
          <p className="text-[12px] text-muted-foreground py-6 text-center">Nenhuma produção salva hoje ainda — monte a lista acima e salve</p>
        ) : (
          <div className="space-y-2">
            {apontamentosHoje.slice(0, 20).map(a => (
              <div key={a.id} className="rounded-xl border bg-card/60 p-3 flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
                  <Package className="h-4 w-4 text-green-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{a.produto}</p>
                  <p className="text-[11px] text-muted-foreground">{a.maquina_codigo || a.maquina} · {a.turno} · {a.operador}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-semibold text-sm text-green-600">{a.quantidade.toLocaleString("pt-BR")} pç</p>
                  <p className="text-[10px] text-muted-foreground tabular-nums">
                    {Number(a.horas_planejadas) > 0 && `${Number(a.horas_planejadas).toFixed(2).replace(/\.?0+$/, "")}h · `}{fmtHora(a.created_at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Barra fixa de salvamento — acompanha a rolagem quando há blocos na lista */}
      {blocos.length > 0 && (
        <div className="sticky bottom-3 z-20 pt-1">
          <div className="rounded-2xl border border-primary/30 bg-card/95 backdrop-blur shadow-lg px-4 py-3 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold truncate">
                {blocos.length} bloco{blocos.length !== 1 ? "s" : ""} na lista
              </p>
              <p className="text-[10.5px] text-muted-foreground truncate">
                {[...new Set(blocos.map(b => b.maquina))].join(", ")}
              </p>
            </div>
            <Button className="gap-1.5 h-10 shrink-0" onClick={salvarTudo} disabled={saving}>
              {saving
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvando...</>
                : <><CheckCircle2 className="h-4 w-4" /> Salvar tudo ({blocos.length})</>}
            </Button>
          </div>
        </div>
      )}
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
        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h3 className="text-[13px] font-bold">{titulo}</h3>
          <p className="text-[10.5px] text-muted-foreground capitalize">{subtitulo}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground text-[12px] gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Calculando...
        </div>
      ) : !dado || dado.hr_planejadas === 0 ? (
        <p className="text-[12px] text-muted-foreground py-6 text-center">Sem lançamentos neste período</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-xl bg-muted/20 p-2.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Peças produzidas</p>
              <p className="text-lg font-bold">{dado.qtde_produzida.toLocaleString("pt-BR")}</p>
            </div>
            <div className="rounded-xl bg-muted/20 p-2.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1"><Gauge className="h-3 w-3" />OEE</p>
              <p className={cn("text-lg font-bold", OeeCor(dado.oee))}>{dado.oee.toFixed(1)}%</p>
            </div>
          </div>
          <div className="space-y-2">
            {[
              { label: "Disponibilidade", v: dado.disponibilidade },
              { label: "Performance", v: dado.performance },
              { label: "Qualidade", v: dado.qualidade },
            ].map(f => (
              <div key={f.label} className="space-y-0.5">
                <div className="flex items-center justify-between text-[11px]">
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
