/**
 * LancamentoDiarioPanel — Aba "Diário" da Produção
 *
 * Fluxo único (antes eram 3 abas separadas — Produção/Setup/Situação —
 * unificadas aqui a pedido: quem é responsável pela produção cuida de 6
 * máquinas e precisa lançar rápido e sem se perder entre telas):
 *
 *  1. Escolhe a MÁQUINA num grid grande (6 botões, com status colorido —
 *     mais rápido de tocar que um dropdown).
 *  2. Escolhe o que está acontecendo: PRODUÇÃO ou SITUAÇÃO.
 *     - Produção: peça, material usado, quantidade, tempo. Grava via RPC
 *       `criar_apontamento_ppi51` (mesma dos outros painéis) — aparece
 *       automaticamente em Controle, Desempenho, Relatórios e no OEE.
 *     - Situação: código numerado (01 Refeição, 02 Café, ... — tabela
 *       `tipo_parada_producao`, a mesma do Controle). O código "SetUp" é
 *       só mais um código da lista — ao escolhê-lo, pede também qual peça
 *       vai ser produzida (mesma informação que antes ficava numa aba
 *       separada) e marca a máquina como "setup" até finalizar.
 *  3. Operador fica salvo no aparelho (localStorage) entre lançamentos —
 *     quem faz vários lançamentos seguidos não precisa redigitar o nome.
 *
 * Data e hora são sempre capturadas automaticamente no momento do envio.
 *
 * Gráficos do dia: distribuição do tempo (produção × cada situação, em %),
 * peças por máquina (com % de participação) e eficiência (produzido ÷
 * planejado). Tudo lido das mesmas tabelas das demais abas.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import {
  Zap, Coffee, RefreshCw, CheckCircle2, Clock,
  Package, Factory, Timer, TrendingUp, StopCircle, PlayCircle, User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOfflineSync } from "@/hooks/useOfflineSync";

// ── Tipos ────────────────────────────────────────────────────────────────────

interface Maquina    { id: string; codigo: string; nome: string; status: string; }
interface PecaOption { codigo: string; descricao: string; pecas_por_hora: number; origem: "producao" | "componente"; }
interface TipoParada { id: number; nome: string; categoria: string; }
interface MateriaPrima { id: string; codigo: string; descricao: string; lote_atual?: string | null; unidade: string; }

interface ApontamentoHoje {
  id: string; maquina_codigo: string | null; maquina: string; produto: string;
  quantidade: number; qtde_plan_disp: number; horas_planejadas: number;
  operador: string; created_at: string;
}

interface ParadaHoje {
  id: string; maquina: string; motivo: string; tipo: string;
  inicio: string; fim: string | null; duracao_min: number | null;
  operador: string; observacoes?: string | null; user_id?: string | null;
}

type Modo = "producao" | "situacao";

const CORES_PIZZA = ["#22c55e", "#ef4444", "#f59e0b", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#64748b", "#a855f7"];
const OPERADOR_STORAGE_KEY = "diario_producao_operador";

const lbl = "text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block";
const sel = "w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

const STATUS_MAQUINA: Record<string, { label: string; dot: string; text: string }> = {
  operando: { label: "Operando", dot: "bg-green-500", text: "text-green-700 dark:text-green-400" },
  setup: { label: "Em setup", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400" },
  parada: { label: "Parada", dot: "bg-red-500", text: "text-red-700 dark:text-red-400" },
  manutencao: { label: "Manutenção", dot: "bg-red-500", text: "text-red-700 dark:text-red-400" },
};

function turnoAtual(): string {
  const h = new Date().getHours();
  return h >= 6 && h < 14 ? "1º Turno" : h >= 14 && h < 22 ? "2º Turno" : "3º Turno";
}
function horaDecimal(d: Date): number {
  return +(d.getHours() + d.getMinutes() / 60).toFixed(4);
}
function fmtHora(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function minutosDecorridos(inicioIso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(inicioIso).getTime()) / 60000));
}

// ── Painel ───────────────────────────────────────────────────────────────────

export function LancamentoDiarioPanel() {
  const { user } = useAuth();
  const { saveWithFallback, saveRpcWithFallback, loadWithFallback } = useOfflineSync();

  // Cadastros (lidos das mesmas tabelas das outras abas)
  const [maquinas, setMaquinas]       = useState<Maquina[]>([]);
  const [pecas, setPecas]             = useState<PecaOption[]>([]);
  const [tiposParada, setTiposParada] = useState<TipoParada[]>([]);
  const [materias, setMaterias]       = useState<MateriaPrima[]>([]);

  // Dados do dia
  const [apontamentosHoje, setApontamentosHoje] = useState<ApontamentoHoje[]>([]);
  const [paradasHoje, setParadasHoje]           = useState<ParadaHoje[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);

  // ── Fluxo único: máquina + modo + um só formulário ─────────────────────────
  const [maquinaSel, setMaquinaSel] = useState("");
  const [modo, setModo] = useState<Modo>("producao");
  const [operador, setOperador] = useState(() => {
    try { return localStorage.getItem(OPERADOR_STORAGE_KEY) ?? ""; } catch { return ""; }
  });
  const [peca, setPeca] = useState("");
  const [materia, setMateria] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [tempoH, setTempoH] = useState("");
  const [tipoParadaId, setTipoParadaId] = useState("");
  const [obs, setObs] = useState("");

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
        .select("id,maquina_codigo,maquina,produto,quantidade,qtde_plan_disp,horas_planejadas,operador,created_at")
        .eq("data_apontamento", dia).order("created_at", { ascending: false }),
      supabase.from("paradas_producao")
        .select("id,maquina,motivo,tipo,inicio,fim,duracao_min,operador,observacoes,user_id")
        .gte("inicio", `${dia}T00:00:00`).order("inicio", { ascending: false }),
    ]);

    const maqOrdenadas = maqRes.sort((a, b) => a.codigo.localeCompare(b.codigo));
    setMaquinas(maqOrdenadas);

    // Peças = produtos de produção + componentes registrados (devices)
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

    // Se nenhuma máquina estava selecionada ainda, sugere a primeira —
    // menos um toque pra quem só cuida das 6 mesmas máquinas todo dia
    setMaquinaSel(prev => prev || maqOrdenadas[0]?.codigo || "");
    setLoading(false);
  }, [loadWithFallback]);

  useEffect(() => { load(); }, [load]);

  // Código "SetUp" dentro da lista de situações — ao escolher esse código
  // específico, pedimos também a peça (é a única situação em que isso
  // importa: o que vai ser produzido depois do setup).
  const tipoSetup = useMemo(
    () => tiposParada.find(t => t.nome.trim().toLowerCase() === "setup"),
    [tiposParada]
  );
  const isSetupSelecionado = tipoParadaId !== "" && Number(tipoParadaId) === tipoSetup?.id;

  function limparCamposEspecificos() {
    setPeca(""); setMateria(""); setQuantidade(""); setTempoH(""); setTipoParadaId(""); setObs("");
  }

  // ── Envio único — decide o destino conforme o modo escolhido ───────────────
  async function lancar() {
    if (!maquinaSel) { toast.error("Selecione a máquina"); return; }
    if (!operador.trim()) { toast.error("Informe o operador"); return; }

    if (modo === "producao") {
      await lancarProducao();
      return;
    }
    if (isSetupSelecionado) {
      await lancarSetup();
    } else {
      await lancarSituacaoComum();
    }
  }

  // Produção (RPC do PPI-51, data/hora automáticas)
  async function lancarProducao() {
    if (!peca || !quantidade) { toast.error("Preencha peça e quantidade"); return; }
    const pecaSel = pecas.find(p => p.codigo === peca);
    const mp   = materias.find(m => m.id === materia);
    const qtde = parseInt(quantidade) || 0;
    if (qtde <= 0) { toast.error("Quantidade deve ser maior que zero"); return; }

    const agora   = new Date();
    const fim     = horaDecimal(agora);
    const horas   = parseFloat(tempoH.replace(",", ".")) || 0;
    const inicio  = +(Math.max(0, fim - horas)).toFixed(4);
    const porHora = pecaSel?.pecas_por_hora ?? 0;
    const planDisp = horas > 0 && porHora > 0 ? +(porHora * horas).toFixed(2) : qtde;

    setSaving(true);
    const args = {
      p_data: hoje, p_turno: turnoAtual(),
      p_maquina: maquinaSel, p_equipamento: maquinaSel,
      p_produto: peca, p_descricao_produto: pecaSel?.descricao ?? peca,
      p_qtde_por_hora: porHora, p_horas_planejadas: horas, p_qtde_plan_disp: planDisp,
      p_qtde_produzida: qtde,
      p_horario_inicio: inicio, p_horario_fim: fim,
      p_cycle_time_min: qtde > 0 && horas > 0 ? +((horas * 60) / qtde).toFixed(4) : null,
      p_lead_time_horas: horas || null,
      p_lote: "", p_lote_mp: mp?.lote_atual ?? "", p_descricao_mp: mp?.descricao ?? "",
      p_comprimento_mm: null, p_consumo_mp_metros: null,
      p_operador: operador.trim(), p_paradas: [], p_refugos: [],
    };
    const preview = {
      seq_producao: 0, data_apontamento: hoje, turno: turnoAtual(),
      maquina: maquinaSel, maquina_codigo: maquinaSel,
      produto: peca, descricao_produto: pecaSel?.descricao,
      qtde_por_hora: porHora, horas_planejadas: horas, qtde_plan_disp: planDisp,
      quantidade: qtde, horario_inicio: inicio, horario_fim: fim,
      lote: "(pendente)", operador: operador.trim(), status: "concluido",
      created_at: agora.toISOString(),
    };
    const { ok, savedOffline } = await saveRpcWithFallback("criar_apontamento_ppi51", args, "apontamentos", preview);
    setSaving(false);
    if (!ok) { toast.error("Erro ao lançar produção"); return; }
    toast.success(savedOffline ? "Produção salva offline — sincroniza ao reconectar" : `Produção lançada às ${fmtHora(agora.toISOString())}`);
    limparCamposEspecificos();
    load();
  }

  // Situação = "SetUp" (grava parada + marca máquina em setup + guarda a peça)
  async function lancarSetup() {
    if (!peca) { toast.error("Selecione a peça que será produzida"); return; }
    const pecaSel = pecas.find(p => p.codigo === peca);
    setSaving(true);
    const agora = new Date().toISOString();
    const parada: ParadaHoje & { user_id?: string } = {
      id: crypto.randomUUID(),
      maquina: maquinaSel,
      motivo: `Setup — ${peca}${pecaSel ? ` (${pecaSel.descricao})` : ""}`,
      tipo: "planejada", inicio: agora, fim: null, duracao_min: null,
      operador: operador.trim(),
      observacoes: obs || `Preparação para produzir ${peca}`,
      user_id: user?.id,
    };
    const { error } = await saveWithFallback("paradas_producao", "paradas", "INSERT", parada);
    if (error) { setSaving(false); toast.error("Erro ao registrar setup"); return; }

    const maq = maquinas.find(m => m.codigo === maquinaSel);
    if (maq) {
      await supabase.from("maquinas_producao").update({ status: "setup" }).eq("id", maq.id);
      setMaquinas(prev => prev.map(m => m.id === maq.id ? { ...m, status: "setup" } : m));
    }
    setSaving(false);
    toast.success(`Setup iniciado às ${fmtHora(agora)}`);
    limparCamposEspecificos();
    setParadasHoje(prev => [parada, ...prev]);
  }

  // Situação comum (qualquer código exceto SetUp)
  async function lancarSituacaoComum() {
    if (!tipoParadaId) { toast.error("Selecione o código de situação"); return; }
    const tp = tiposParada.find(t => t.id === Number(tipoParadaId));
    if (!tp) return;
    setSaving(true);
    const agora = new Date().toISOString();
    const parada: ParadaHoje & { user_id?: string } = {
      id: crypto.randomUUID(),
      maquina: maquinaSel, motivo: tp.nome,
      tipo: tp.categoria === "operacional" || tp.categoria === "setup" ? "planejada" : "nao_planejada",
      inicio: agora, fim: null, duracao_min: null,
      operador: operador.trim(), observacoes: obs || null, user_id: user?.id,
    };
    const { error } = await saveWithFallback("paradas_producao", "paradas", "INSERT", parada);
    setSaving(false);
    if (error) { toast.error("Erro ao registrar situação"); return; }
    toast.success(`${tp.nome} iniciado às ${fmtHora(agora)}`);
    limparCamposEspecificos();
    setParadasHoje(prev => [parada, ...prev]);
  }

  // ── Finalizar situação/setup aberto (fim + duração automáticos) ────────────
  async function finalizar(p: ParadaHoje) {
    const fim = new Date().toISOString();
    const dur = minutosDecorridos(p.inicio);
    const atualizada = { ...p, fim, duracao_min: dur };
    const { error } = await saveWithFallback("paradas_producao", "paradas", "UPDATE", atualizada);
    if (error) { toast.error("Erro ao finalizar"); return; }

    if (p.motivo.startsWith("Setup")) {
      const maq = maquinas.find(m => m.codigo === p.maquina);
      if (maq && maq.status === "setup") {
        await supabase.from("maquinas_producao").update({ status: "operando" }).eq("id", maq.id);
        setMaquinas(prev => prev.map(m => m.id === maq.id ? { ...m, status: "operando" } : m));
      }
    }
    toast.success(`Finalizado — ${dur} min`);
    setParadasHoje(prev => prev.map(x => x.id === p.id ? atualizada : x));
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

  const abertas = paradasHoje.filter(p => !p.fim);
  const maquinaAtual = maquinas.find(m => m.codigo === maquinaSel);

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Cabeçalho do dia */}
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold">
          {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
        </p>
        <span className="text-[11px] text-muted-foreground">· {turnoAtual()}</span>
        <button onClick={load} disabled={loading}
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
          { Icon: Clock,      label: "Em aberto",   value: String(abertas.length),                    cor: abertas.length > 0 ? "text-amber-600" : "text-muted-foreground", bg: "bg-amber-500/5 border-amber-500/20" },
        ].map(k => (
          <div key={k.label} className={cn("rounded-2xl border p-3 space-y-1", k.bg)}>
            <div className="flex items-center gap-1.5">
              <k.Icon className={cn("h-3.5 w-3.5", k.cor)} />
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{k.label}</p>
            </div>
            <p className={cn("text-lg font-bold", k.cor)}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Lançamento — fluxo único */}
      <div className="rounded-2xl border bg-card p-4 space-y-4">
        {/* 1. Máquina — grid grande, um toque só */}
        <div>
          <label className={lbl}>Máquina *</label>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {maquinas.map(m => {
              const st = STATUS_MAQUINA[m.status] ?? STATUS_MAQUINA.operando;
              const ativa = maquinaSel === m.codigo;
              return (
                <button key={m.id} type="button" onClick={() => setMaquinaSel(m.codigo)}
                  className={cn("relative flex flex-col items-center justify-center gap-0.5 h-16 rounded-xl border-2 transition-colors",
                    ativa ? "border-primary bg-primary/5" : "border-input hover:bg-muted/30")}>
                  <span className="text-sm font-bold">{m.codigo}</span>
                  <span className="text-[9px] text-muted-foreground truncate max-w-full px-1">{m.nome}</span>
                  <span className="absolute top-1.5 right-1.5 flex items-center gap-1">
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

        {/* 2. O que está acontecendo */}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setModo("producao")}
            className={cn("flex items-center justify-center gap-1.5 h-10 rounded-xl border text-sm font-medium transition-colors",
              modo === "producao" ? "bg-green-500/10 border-green-500/40 text-green-700 dark:text-green-400" : "border-input hover:bg-muted/30 text-muted-foreground")}>
            <Zap className="h-4 w-4" /> Produção
          </button>
          <button type="button" onClick={() => setModo("situacao")}
            className={cn("flex items-center justify-center gap-1.5 h-10 rounded-xl border text-sm font-medium transition-colors",
              modo === "situacao" ? "bg-blue-500/10 border-blue-500/40 text-blue-700 dark:text-blue-400" : "border-input hover:bg-muted/30 text-muted-foreground")}>
            <Coffee className="h-4 w-4" /> Situação <span className="text-[9px] opacity-70">(inclui Setup)</span>
          </button>
        </div>

        {/* 3. Operador — sempre visível, fica salvo entre lançamentos */}
        <div>
          <label className={lbl}><User className="h-3 w-3 inline -mt-0.5 mr-1" />Operador *</label>
          <Input value={operador} onChange={e => setOperador(e.target.value)} className="h-10" placeholder="Nome do operador" />
        </div>

        {/* 4. Campos do modo escolhido */}
        {modo === "producao" ? (
          <div className="space-y-3">
            <div><label className={lbl}>Peça *</label>
              <select value={peca} onChange={e => setPeca(e.target.value)} className={sel}>
                <option value="">Selecione...</option>
                <optgroup label="Produtos de produção">
                  {pecas.filter(p => p.origem === "producao").map(p => <option key={p.codigo} value={p.codigo}>{p.codigo} — {p.descricao}</option>)}
                </optgroup>
                <optgroup label="Componentes registrados">
                  {pecas.filter(p => p.origem === "componente").map(p => <option key={p.codigo} value={p.codigo}>{p.codigo} — {p.descricao}</option>)}
                </optgroup>
              </select>
            </div>
            <div><label className={lbl}>Material usado</label>
              <select value={materia} onChange={e => setMateria(e.target.value)} className={sel}>
                <option value="">Nenhum / não informar</option>
                {materias.map(m => <option key={m.id} value={m.id}>{m.codigo} — {m.descricao}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>Quantidade *</label>
                <Input type="number" min="1" inputMode="numeric" value={quantidade}
                  onChange={e => setQuantidade(e.target.value)} className="h-10" placeholder="pç" />
              </div>
              <div><label className={lbl}>Tempo (h)</label>
                <Input type="number" min="0" step="0.25" inputMode="decimal" value={tempoH}
                  onChange={e => setTempoH(e.target.value)} className="h-10" placeholder="ex: 2.5" />
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div><label className={lbl}>Código de situação *</label>
              <select value={tipoParadaId} onChange={e => setTipoParadaId(e.target.value)} className={sel}>
                <option value="">Selecione...</option>
                {tiposParada.map(t => <option key={t.id} value={t.id}>{String(t.id).padStart(2, "0")} — {t.nome}</option>)}
              </select>
            </div>
            {isSetupSelecionado && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
                <label className={lbl}>Peça que será produzida *</label>
                <select value={peca} onChange={e => setPeca(e.target.value)} className={sel}>
                  <option value="">Selecione...</option>
                  <optgroup label="Produtos de produção">
                    {pecas.filter(p => p.origem === "producao").map(p => <option key={p.codigo} value={p.codigo}>{p.codigo} — {p.descricao}</option>)}
                  </optgroup>
                  <optgroup label="Componentes registrados">
                    {pecas.filter(p => p.origem === "componente").map(p => <option key={p.codigo} value={p.codigo}>{p.codigo} — {p.descricao}</option>)}
                  </optgroup>
                </select>
                <p className="text-[10px] text-amber-700 dark:text-amber-400">A máquina fica marcada como "Em setup" até você finalizar na lista abaixo</p>
              </div>
            )}
            <div><label className={lbl}>Observação</label>
              <Input value={obs} onChange={e => setObs(e.target.value)} className="h-10" placeholder="Opcional" />
            </div>
          </div>
        )}

        <Button className="w-full gap-1.5 h-11" onClick={lancar} disabled={saving}>
          <PlayCircle className="h-4 w-4" />
          {saving ? "Registrando..." : modo === "producao" ? "Lançar produção agora" : "Registrar situação agora"}
        </Button>
        <p className="text-[10px] text-muted-foreground text-center -mt-2">Data e hora são registradas automaticamente no momento do lançamento</p>
      </div>

      {/* Situações / setups em aberto */}
      {abertas.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-600" /> Em andamento agora
          </h3>
          {abertas.map(p => (
            <div key={p.id} className="rounded-xl border bg-card/70 p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{p.motivo}</p>
                <p className="text-[11px] text-muted-foreground">
                  {p.maquina} · {p.operador} · desde {fmtHora(p.inicio)} ({minutosDecorridos(p.inicio)} min)
                </p>
              </div>
              <Button size="sm" variant="outline" className="gap-1 h-8 shrink-0" onClick={() => finalizar(p)}>
                <StopCircle className="h-3.5 w-3.5" /> Finalizar
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Gráficos do dia */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Distribuição do tempo (%) */}
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

        {/* Peças por máquina (%) */}
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

      {/* Lançamentos do dia */}
      <div className="rounded-2xl border bg-card p-4 space-y-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-600" /> Lançamentos de hoje
        </h3>
        {apontamentosHoje.length === 0 ? (
          <p className="text-[12px] text-muted-foreground py-6 text-center">Nenhuma produção lançada hoje — use o formulário acima</p>
        ) : (
          <div className="space-y-2">
            {apontamentosHoje.slice(0, 20).map(a => (
              <div key={a.id} className="rounded-xl border bg-card/60 p-3 flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
                  <Package className="h-4 w-4 text-green-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{a.produto}</p>
                  <p className="text-[11px] text-muted-foreground">{a.maquina_codigo || a.maquina} · {a.operador}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-semibold text-sm text-green-600">{a.quantidade.toLocaleString("pt-BR")} pç</p>
                  <p className="text-[10px] text-muted-foreground">{fmtHora(a.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
