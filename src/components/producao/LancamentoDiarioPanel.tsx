/**
 * LancamentoDiarioPanel — Aba "Diário" da Produção
 * Layout direto para lançamento do dia-a-dia do chão de fábrica, sem o
 * formulário completo em 3 passos do Controle (PPI-51). Três lançamentos
 * rápidos, todos com data/hora capturadas automaticamente no momento do
 * registro:
 *
 *  1. PRODUÇÃO — máquina, peça (produtos de produção OU componentes já
 *     registrados em `devices`), matéria-prima usada e quantidade.
 *     Grava via RPC `criar_apontamento_ppi51` (mesma dos outros painéis),
 *     então o lançamento aparece automaticamente em Controle, Desempenho,
 *     Relatórios e entra no cálculo de OEE — nada duplicado.
 *  2. SETUP — registra que a máquina está em setup para produzir
 *     determinada peça. Grava em `paradas_producao` (aparece na aba
 *     Paradas) e muda o status da máquina para "setup" até finalizar.
 *  3. SITUAÇÃO — códigos de situação (Refeição/almoço, janta, Café,
 *     Troca p/ quebra de ferramenta, etc — tabela `tipo_parada_producao`,
 *     a mesma usada no Controle). Grava em `paradas_producao` com início
 *     automático; o botão "Finalizar" fecha com hora e duração automáticas.
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
  Zap, Wrench, Coffee, RefreshCw, CheckCircle2, Clock,
  Package, Factory, Timer, TrendingUp, StopCircle, PlayCircle,
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

type Lancamento = "producao" | "setup" | "situacao";

const CORES_PIZZA = ["#22c55e", "#ef4444", "#f59e0b", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#64748b", "#a855f7"];

const lbl = "text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block";
const sel = "w-full h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

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

  const [tipo, setTipo] = useState<Lancamento>("producao");

  // Formulários rápidos
  const [fProd, setFProd] = useState({ maquina: "", peca: "", materia: "", quantidade: "", tempo_h: "", operador: "" });
  const [fSetup, setFSetup] = useState({ maquina: "", peca: "", operador: "", obs: "" });
  const [fSit, setFSit] = useState({ maquina: "", tipo_parada: "", operador: "", obs: "" });

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

    setMaquinas(maqRes.sort((a, b) => a.codigo.localeCompare(b.codigo)));

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
    setLoading(false);
  }, [loadWithFallback]);

  useEffect(() => { load(); }, [load]);

  // ── Lançamento de PRODUÇÃO (data/hora automáticas, via RPC do PPI-51) ──────
  async function lancarProducao() {
    if (!fProd.maquina || !fProd.peca || !fProd.quantidade || !fProd.operador) {
      toast.error("Preencha máquina, peça, quantidade e operador"); return;
    }
    const peca = pecas.find(p => p.codigo === fProd.peca);
    const mp   = materias.find(m => m.id === fProd.materia);
    const qtde = parseInt(fProd.quantidade) || 0;
    if (qtde <= 0) { toast.error("Quantidade deve ser maior que zero"); return; }

    const agora   = new Date();
    const fim     = horaDecimal(agora);
    const horas   = parseFloat(fProd.tempo_h.replace(",", ".")) || 0;
    const inicio  = +(Math.max(0, fim - horas)).toFixed(4);
    const porHora = peca?.pecas_por_hora ?? 0;
    const planDisp = horas > 0 && porHora > 0 ? +(porHora * horas).toFixed(2) : qtde;

    setSaving(true);
    const args = {
      p_data: hoje, p_turno: turnoAtual(),
      p_maquina: fProd.maquina, p_equipamento: fProd.maquina,
      p_produto: fProd.peca, p_descricao_produto: peca?.descricao ?? fProd.peca,
      p_qtde_por_hora: porHora, p_horas_planejadas: horas, p_qtde_plan_disp: planDisp,
      p_qtde_produzida: qtde,
      p_horario_inicio: inicio, p_horario_fim: fim,
      p_cycle_time_min: qtde > 0 && horas > 0 ? +((horas * 60) / qtde).toFixed(4) : null,
      p_lead_time_horas: horas || null,
      p_lote: "", p_lote_mp: mp?.lote_atual ?? "", p_descricao_mp: mp?.descricao ?? "",
      p_comprimento_mm: null, p_consumo_mp_metros: null,
      p_operador: fProd.operador, p_paradas: [], p_refugos: [],
    };
    const preview = {
      seq_producao: 0, data_apontamento: hoje, turno: turnoAtual(),
      maquina: fProd.maquina, maquina_codigo: fProd.maquina,
      produto: fProd.peca, descricao_produto: peca?.descricao,
      qtde_por_hora: porHora, horas_planejadas: horas, qtde_plan_disp: planDisp,
      quantidade: qtde, horario_inicio: inicio, horario_fim: fim,
      lote: "(pendente)", operador: fProd.operador, status: "concluido",
      created_at: agora.toISOString(),
    };
    const { ok, savedOffline } = await saveRpcWithFallback("criar_apontamento_ppi51", args, "apontamentos", preview);
    setSaving(false);
    if (!ok) { toast.error("Erro ao lançar produção"); return; }
    toast.success(savedOffline ? "Produção salva offline — sincroniza ao reconectar" : `Produção lançada às ${fmtHora(agora.toISOString())}`);
    setFProd(f => ({ ...f, peca: "", materia: "", quantidade: "", tempo_h: "" }));
    load();
  }

  // ── Lançamento de SETUP ────────────────────────────────────────────────────
  async function lancarSetup() {
    if (!fSetup.maquina || !fSetup.peca || !fSetup.operador) {
      toast.error("Preencha máquina, peça e operador"); return;
    }
    const peca = pecas.find(p => p.codigo === fSetup.peca);
    setSaving(true);
    const agora = new Date().toISOString();
    const parada: ParadaHoje & { user_id?: string } = {
      id: crypto.randomUUID(),
      maquina: fSetup.maquina,
      motivo: `Setup — ${fSetup.peca}${peca ? ` (${peca.descricao})` : ""}`,
      tipo: "planejada", inicio: agora, fim: null, duracao_min: null,
      operador: fSetup.operador,
      observacoes: fSetup.obs || `Preparação para produzir ${fSetup.peca}`,
      user_id: user?.id,
    };
    const { error } = await saveWithFallback("paradas_producao", "paradas", "INSERT", parada);
    if (error) { setSaving(false); toast.error("Erro ao registrar setup"); return; }

    // Integra com Cadastros/Máquinas: sinaliza a máquina em setup
    const maq = maquinas.find(m => m.codigo === fSetup.maquina);
    if (maq) {
      await supabase.from("maquinas_producao").update({ status: "setup" }).eq("id", maq.id);
      setMaquinas(prev => prev.map(m => m.id === maq.id ? { ...m, status: "setup" } : m));
    }
    setSaving(false);
    toast.success(`Setup iniciado às ${fmtHora(agora)}`);
    setFSetup({ maquina: "", peca: "", operador: fSetup.operador, obs: "" });
    setParadasHoje(prev => [parada, ...prev]);
  }

  // ── Lançamento de SITUAÇÃO (código de situação) ────────────────────────────
  async function lancarSituacao() {
    if (!fSit.maquina || !fSit.tipo_parada || !fSit.operador) {
      toast.error("Preencha máquina, situação e operador"); return;
    }
    const tp = tiposParada.find(t => t.id === Number(fSit.tipo_parada));
    if (!tp) return;
    setSaving(true);
    const agora = new Date().toISOString();
    const parada: ParadaHoje & { user_id?: string } = {
      id: crypto.randomUUID(),
      maquina: fSit.maquina, motivo: tp.nome,
      tipo: tp.categoria === "operacional" || tp.categoria === "setup" ? "planejada" : "nao_planejada",
      inicio: agora, fim: null, duracao_min: null,
      operador: fSit.operador, observacoes: fSit.obs || null, user_id: user?.id,
    };
    const { error } = await saveWithFallback("paradas_producao", "paradas", "INSERT", parada);
    setSaving(false);
    if (error) { toast.error("Erro ao registrar situação"); return; }
    toast.success(`${tp.nome} iniciado às ${fmtHora(agora)}`);
    setFSit({ maquina: "", tipo_parada: "", operador: fSit.operador, obs: "" });
    setParadasHoje(prev => [parada, ...prev]);
  }

  // ── Finalizar situação/setup aberto (fim + duração automáticos) ────────────
  async function finalizar(p: ParadaHoje) {
    const fim = new Date().toISOString();
    const dur = minutosDecorridos(p.inicio);
    const atualizada = { ...p, fim, duracao_min: dur };
    const { error } = await saveWithFallback("paradas_producao", "paradas", "UPDATE", atualizada);
    if (error) { toast.error("Erro ao finalizar"); return; }

    // Se era setup, devolve a máquina para "operando"
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

    // Tempo por situação (paradas encerradas + em andamento até agora)
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

    // Peças por máquina (com % de participação)
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

  const cardTipo = [
    { id: "producao" as const, label: "Produção", Icon: Zap,    cor: "text-green-600",  bg: "bg-green-500/10 border-green-500/40" },
    { id: "setup"    as const, label: "Setup",    Icon: Wrench, cor: "text-amber-600",  bg: "bg-amber-500/10 border-amber-500/40" },
    { id: "situacao" as const, label: "Situação", Icon: Coffee, cor: "text-blue-600",   bg: "bg-blue-500/10 border-blue-500/40" },
  ];

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

      {/* Lançamento rápido */}
      <div className="rounded-2xl border bg-card p-4 space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {cardTipo.map(t => (
            <button key={t.id} onClick={() => setTipo(t.id)}
              className={cn("flex items-center justify-center gap-1.5 h-10 rounded-xl border text-sm font-medium transition-colors",
                tipo === t.id ? cn(t.bg, t.cor) : "border-input hover:bg-muted/30 text-muted-foreground")}>
              <t.Icon className="h-4 w-4" />{t.label}
            </button>
          ))}
        </div>

        {tipo === "producao" && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className={lbl}>Máquina *</label>
                <select value={fProd.maquina} onChange={e => setFProd(f => ({ ...f, maquina: e.target.value }))} className={sel}>
                  <option value="">Selecione...</option>
                  {maquinas.map(m => <option key={m.id} value={m.codigo}>{m.codigo} — {m.nome}</option>)}
                </select>
              </div>
              <div><label className={lbl}>Peça *</label>
                <select value={fProd.peca} onChange={e => setFProd(f => ({ ...f, peca: e.target.value }))} className={sel}>
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
                <select value={fProd.materia} onChange={e => setFProd(f => ({ ...f, materia: e.target.value }))} className={sel}>
                  <option value="">Nenhum / não informar</option>
                  {materias.map(m => <option key={m.id} value={m.id}>{m.codigo} — {m.descricao}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={lbl}>Quantidade *</label>
                  <Input type="number" min="1" inputMode="numeric" value={fProd.quantidade}
                    onChange={e => setFProd(f => ({ ...f, quantidade: e.target.value }))} className="h-9" placeholder="pç" />
                </div>
                <div><label className={lbl}>Tempo (h)</label>
                  <Input type="number" min="0" step="0.25" inputMode="decimal" value={fProd.tempo_h}
                    onChange={e => setFProd(f => ({ ...f, tempo_h: e.target.value }))} className="h-9" placeholder="ex: 2.5" />
                </div>
              </div>
              <div className="sm:col-span-2"><label className={lbl}>Operador *</label>
                <Input value={fProd.operador} onChange={e => setFProd(f => ({ ...f, operador: e.target.value }))} className="h-9" placeholder="Nome do operador" />
              </div>
            </div>
            <Button className="w-full gap-1.5" onClick={lancarProducao} disabled={saving}>
              <Zap className="h-4 w-4" />{saving ? "Lançando..." : "Lançar produção agora"}
            </Button>
            <p className="text-[10px] text-muted-foreground text-center">Data e hora são registradas automaticamente no momento do lançamento</p>
          </div>
        )}

        {tipo === "setup" && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className={lbl}>Máquina *</label>
                <select value={fSetup.maquina} onChange={e => setFSetup(f => ({ ...f, maquina: e.target.value }))} className={sel}>
                  <option value="">Selecione...</option>
                  {maquinas.map(m => <option key={m.id} value={m.codigo}>{m.codigo} — {m.nome}{m.status === "setup" ? " (em setup)" : ""}</option>)}
                </select>
              </div>
              <div><label className={lbl}>Peça que será produzida *</label>
                <select value={fSetup.peca} onChange={e => setFSetup(f => ({ ...f, peca: e.target.value }))} className={sel}>
                  <option value="">Selecione...</option>
                  <optgroup label="Produtos de produção">
                    {pecas.filter(p => p.origem === "producao").map(p => <option key={p.codigo} value={p.codigo}>{p.codigo} — {p.descricao}</option>)}
                  </optgroup>
                  <optgroup label="Componentes registrados">
                    {pecas.filter(p => p.origem === "componente").map(p => <option key={p.codigo} value={p.codigo}>{p.codigo} — {p.descricao}</option>)}
                  </optgroup>
                </select>
              </div>
              <div><label className={lbl}>Operador *</label>
                <Input value={fSetup.operador} onChange={e => setFSetup(f => ({ ...f, operador: e.target.value }))} className="h-9" placeholder="Nome do operador" />
              </div>
              <div><label className={lbl}>Observação</label>
                <Input value={fSetup.obs} onChange={e => setFSetup(f => ({ ...f, obs: e.target.value }))} className="h-9" placeholder="Opcional" />
              </div>
            </div>
            <Button className="w-full gap-1.5" onClick={lancarSetup} disabled={saving}>
              <PlayCircle className="h-4 w-4" />{saving ? "Registrando..." : "Iniciar setup agora"}
            </Button>
            <p className="text-[10px] text-muted-foreground text-center">A máquina fica marcada como "setup" até você finalizar na lista abaixo</p>
          </div>
        )}

        {tipo === "situacao" && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className={lbl}>Máquina *</label>
                <select value={fSit.maquina} onChange={e => setFSit(f => ({ ...f, maquina: e.target.value }))} className={sel}>
                  <option value="">Selecione...</option>
                  {maquinas.map(m => <option key={m.id} value={m.codigo}>{m.codigo} — {m.nome}</option>)}
                </select>
              </div>
              <div><label className={lbl}>Código de situação *</label>
                <select value={fSit.tipo_parada} onChange={e => setFSit(f => ({ ...f, tipo_parada: e.target.value }))} className={sel}>
                  <option value="">Selecione...</option>
                  {tiposParada.map(t => <option key={t.id} value={t.id}>{String(t.id).padStart(2, "0")} — {t.nome}</option>)}
                </select>
              </div>
              <div><label className={lbl}>Operador *</label>
                <Input value={fSit.operador} onChange={e => setFSit(f => ({ ...f, operador: e.target.value }))} className="h-9" placeholder="Nome do operador" />
              </div>
              <div><label className={lbl}>Observação</label>
                <Input value={fSit.obs} onChange={e => setFSit(f => ({ ...f, obs: e.target.value }))} className="h-9" placeholder="Opcional" />
              </div>
            </div>
            <Button className="w-full gap-1.5" onClick={lancarSituacao} disabled={saving}>
              <PlayCircle className="h-4 w-4" />{saving ? "Registrando..." : "Iniciar situação agora"}
            </Button>
            <p className="text-[10px] text-muted-foreground text-center">Início registrado automaticamente — finalize na lista abaixo para fechar o tempo</p>
          </div>
        )}
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
