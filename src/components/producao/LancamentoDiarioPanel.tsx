/**
 * LancamentoDiarioPanel — Aba "Diário" da Produção
 *
 * Lançamento de fim de turno: quem é responsável pela produção lança tudo o
 * que aconteceu no dia de uma vez só, em todas as 6 máquinas. Produção e
 * Situação NÃO são mais dois itens separados — situação é um detalhe DE
 * DENTRO do próprio lançamento de produção (exatamente como o assistente
 * completo do Controle já fazia: um apontamento carrega junto as paradas que
 * aconteceram durante aquele período). Isso usa o parâmetro `p_paradas` que
 * a RPC `criar_apontamento_ppi51` já aceitava, mas que esta tela nunca tinha
 * usado.
 *
 * Como funciona um bloco de lançamento:
 *  - Escolhe a MÁQUINA.
 *  - Se rodou alguma peça nesse período: escolhe a peça, quantidade e as
 *    horas TOTAIS do período (ex: 5h).
 *  - Dentro desse mesmo bloco, pode adicionar 0+ "situações" que aconteceram
 *    durante esse período (ex: 1h de Setup, 30min de Almoço) — elas ficam
 *    junto do mesmo lançamento, não em outro lugar.
 *  - Se o período foi só parada, sem nenhuma peça produzida (ex: máquina
 *    quebrada o dia todo), deixa a peça em branco — nesse caso a(s)
 *    situação(ões) são gravadas direto, sem precisar de uma peça-mãe.
 *  - Adiciona quantos blocos precisar, pra quantas máquinas precisar, e no
 *    final salva tudo de uma vez.
 *
 * A hora de início/fim de cada bloco é calculada automaticamente pra trás a
 * partir de agora, empilhando as durações de cada máquina na ordem em que
 * foram adicionadas (o mais recente termina agora).
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import {
  Zap, Coffee, RefreshCw, CheckCircle2, Clock,
  Package, Factory, Timer, TrendingUp, Plus, X, ListPlus, User, Loader2,
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

// Uma situação embutida dentro de um bloco (produção ou, se o bloco não tem
// peça, uma situação "solta")
interface SituacaoEmbutida {
  id: string; tipoParadaId: string; horas: string; pecaSetup?: string;
}

// Um bloco de lançamento ainda não salvo, esperando na lista da sessão
interface Bloco {
  id: string; maquina: string;
  peca?: string; materiaId?: string; quantidade?: string; horas?: string; // presentes só se houve produção
  situacoes: SituacaoEmbutida[];
}

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

  const [maquinas, setMaquinas]       = useState<Maquina[]>([]);
  const [pecas, setPecas]             = useState<PecaOption[]>([]);
  const [tiposParada, setTiposParada] = useState<TipoParada[]>([]);
  const [materias, setMaterias]       = useState<MateriaPrima[]>([]);

  const [apontamentosHoje, setApontamentosHoje] = useState<ApontamentoHoje[]>([]);
  const [paradasHoje, setParadasHoje]           = useState<ParadaHoje[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);

  // ── Montagem do bloco atual (ainda não adicionado à lista) ──────────────────
  const [maquinaSel, setMaquinaSel] = useState("");
  const [operador, setOperador] = useState(() => {
    try { return localStorage.getItem(OPERADOR_STORAGE_KEY) ?? ""; } catch { return ""; }
  });
  const [peca, setPeca] = useState("");
  const [materia, setMateria] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [horas, setHoras] = useState("");
  const [situacoesTemp, setSituacoesTemp] = useState<SituacaoEmbutida[]>([]);
  // mini-form pra adicionar UMA situação dentro do bloco atual
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
        .select("id,maquina_codigo,maquina,produto,quantidade,qtde_plan_disp,horas_planejadas,operador,created_at")
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

  useEffect(() => { load(); }, [load]);

  const tipoSetup = useMemo(
    () => tiposParada.find(t => t.nome.trim().toLowerCase() === "setup"),
    [tiposParada]
  );
  const novaSituacaoEhSetup = novaSituacaoTipo !== "" && Number(novaSituacaoTipo) === tipoSetup?.id;

  function limparMiniFormSituacao() {
    setNovaSituacaoTipo(""); setNovaSituacaoHoras(""); setNovaSituacaoPeca("");
  }
  function limparBlocoAtual() {
    setPeca(""); setMateria(""); setQuantidade(""); setHoras(""); setSituacoesTemp([]);
    limparMiniFormSituacao();
  }

  function adicionarSituacaoAoBloco() {
    if (!novaSituacaoTipo) { toast.error("Selecione o código de situação"); return; }
    const h = parseFloat(novaSituacaoHoras.replace(",", ".")) || 0;
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

  // ── Adiciona o bloco montado à lista da sessão ──────────────────────────────
  function adicionarBloco() {
    if (!maquinaSel) { toast.error("Selecione a máquina"); return; }
    const temProducao = !!peca;
    if (temProducao) {
      if (!quantidade || parseInt(quantidade) <= 0) { toast.error("Informe a quantidade produzida"); return; }
      const h = parseFloat(horas.replace(",", ".")) || 0;
      if (h <= 0) { toast.error("Informe as horas totais do período"); return; }
      const horasSituacoes = situacoesTemp.reduce((s, x) => s + (parseFloat(x.horas.replace(",", ".")) || 0), 0);
      if (horasSituacoes > h) { toast.error("As situações somadas não podem passar das horas totais do período"); return; }
    } else if (situacoesTemp.length === 0) {
      toast.error("Sem peça selecionada, adicione ao menos uma situação (o período foi só parada)");
      return;
    }

    const bloco: Bloco = {
      id: crypto.randomUUID(), maquina: maquinaSel,
      peca: temProducao ? peca : undefined,
      materiaId: temProducao ? (materia || undefined) : undefined,
      quantidade: temProducao ? quantidade : undefined,
      horas: temProducao ? horas : undefined,
      situacoes: situacoesTemp,
    };
    setBlocos(prev => [...prev, bloco]);
    limparBlocoAtual();
    toast.success("Bloco adicionado à lista — continue lançando ou salve quando terminar");
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
    const agora = new Date();

    const porMaquina = new Map<string, Bloco[]>();
    for (const b of blocos) porMaquina.set(b.maquina, [...(porMaquina.get(b.maquina) ?? []), b]);

    for (const [maquina, itens] of porMaquina) {
      let fimAtual = agora;
      for (let i = itens.length - 1; i >= 0; i--) {
        const bloco = itens[i];
        // Duração desse bloco no tempo: se tem produção, usa as horas totais
        // digitadas; se é só situação (sem peça), soma as situações.
        const hBloco = bloco.peca
          ? (parseFloat((bloco.horas ?? "0").replace(",", ".")) || 0)
          : bloco.situacoes.reduce((s, x) => s + (parseFloat(x.horas.replace(",", ".")) || 0), 0);
        const inicioDate = new Date(fimAtual.getTime() - hBloco * 3600000);
        const fimDate = fimAtual;
        fimAtual = inicioDate;

        try {
          if (bloco.peca) {
            const pecaSel = pecas.find(pc => pc.codigo === bloco.peca);
            const mp = materias.find(m => m.id === bloco.materiaId);
            const qtde = parseInt(bloco.quantidade ?? "0") || 0;
            const porHora = pecaSel?.pecas_por_hora ?? 0;
            const horasSituacoes = bloco.situacoes.reduce((s, x) => s + (parseFloat(x.horas.replace(",", ".")) || 0), 0);
            const horasProdutivas = Math.max(0, hBloco - horasSituacoes);
            const planDisp = horasProdutivas > 0 && porHora > 0 ? +(porHora * horasProdutivas).toFixed(2) : qtde;

            const pParadas = bloco.situacoes.map(s => {
              const tp = tiposParada.find(t => t.id === Number(s.tipoParadaId));
              return {
                tipo_id: Number(s.tipoParadaId),
                tipo_nome: tp?.id === tipoSetup?.id ? `Setup — ${s.pecaSetup}` : (tp?.nome ?? "Situação"),
                duracao_horas: parseFloat(s.horas.replace(",", ".")) || 0,
              };
            });

            const args = {
              p_data: hoje, p_turno: turnoAtual(),
              p_maquina: maquina, p_equipamento: maquina,
              p_produto: bloco.peca, p_descricao_produto: pecaSel?.descricao ?? bloco.peca,
              p_qtde_por_hora: porHora, p_horas_planejadas: hBloco, p_qtde_plan_disp: planDisp,
              p_qtde_produzida: qtde,
              p_horario_inicio: horaDecimal(inicioDate), p_horario_fim: horaDecimal(fimDate),
              p_cycle_time_min: qtde > 0 && horasProdutivas > 0 ? +((horasProdutivas * 60) / qtde).toFixed(4) : null,
              p_lead_time_horas: hBloco || null,
              p_lote: "", p_lote_mp: mp?.lote_atual ?? "", p_descricao_mp: mp?.descricao ?? "",
              p_comprimento_mm: null, p_consumo_mp_metros: null,
              p_operador: operador.trim(), p_paradas: pParadas, p_refugos: [],
            };
            const preview = {
              seq_producao: 0, data_apontamento: hoje, turno: turnoAtual(),
              maquina, maquina_codigo: maquina,
              produto: bloco.peca, descricao_produto: pecaSel?.descricao,
              qtde_por_hora: porHora, horas_planejadas: hBloco, qtde_plan_disp: planDisp,
              quantidade: qtde, horario_inicio: horaDecimal(inicioDate), horario_fim: horaDecimal(fimDate),
              lote: "(pendente)", operador: operador.trim(), status: "concluido",
              created_at: fimDate.toISOString(),
            };
            const { ok } = await saveRpcWithFallback("criar_apontamento_ppi51", args, "apontamentos", preview);
            if (!ok) throw new Error("Falha ao gravar produção");
          } else {
            // Bloco sem produção: cada situação é gravada direto (não tem
            // apontamento-mãe pra pendurar em apontamento_paradas)
            let fimSituacao = fimDate;
            for (let j = bloco.situacoes.length - 1; j >= 0; j--) {
              const s = bloco.situacoes[j];
              const hs = parseFloat(s.horas.replace(",", ".")) || 0;
              const inicioSituacao = new Date(fimSituacao.getTime() - hs * 3600000);
              const tp = tiposParada.find(t => t.id === Number(s.tipoParadaId));
              const ehSetup = tp?.id === tipoSetup?.id;
              const motivo = ehSetup ? `Setup — ${s.pecaSetup}` : (tp?.nome ?? "Situação");
              const parada = {
                id: crypto.randomUUID(), maquina, motivo,
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
  }

  // ── Agregações do dia para os gráficos (só do que já foi salvo) ────────────
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
  const horasSituacoesTemp = situacoesTemp.reduce((s, x) => s + (parseFloat(x.horas.replace(",", ".")) || 0), 0);

  const blocosPorMaquina = useMemo(() => {
    const g = new Map<string, Bloco[]>();
    for (const b of blocos) g.set(b.maquina, [...(g.get(b.maquina) ?? []), b]);
    return [...g.entries()];
  }, [blocos]);

  function descricaoBloco(b: Bloco): string {
    if (b.peca) {
      const pecaSel = pecas.find(pc => pc.codigo === b.peca);
      const sits = b.situacoes.length > 0 ? ` + ${b.situacoes.length} situação(ões)` : "";
      return `Produção — ${b.peca}${pecaSel ? ` (${pecaSel.descricao})` : ""} · ${b.quantidade} pç · ${b.horas}h${sits}`;
    }
    return b.situacoes.map(s => {
      const tp = tiposParada.find(t => t.id === Number(s.tipoParadaId));
      const ehSetup = tp?.id === tipoSetup?.id;
      return `${ehSetup ? `Setup (${s.pecaSetup})` : tp?.nome ?? "Situação"} · ${s.horas}h`;
    }).join(", ");
  }

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

      <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 px-3 py-2 text-[11.5px] text-blue-800 dark:text-blue-300">
        Lançamento de fim de turno: monte a lista com tudo que aconteceu no dia — a situação (setup, almoço, manutenção...) fica dentro do próprio bloco de produção, não separado. Salve tudo de uma vez no final.
      </div>

      {/* KPIs do dia (do que já foi salvo) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { Icon: Package,    label: "Peças hoje",  value: resumo.totalPecas.toLocaleString("pt-BR"), cor: "text-green-600",  bg: "bg-green-500/5 border-green-500/20" },
          { Icon: Timer,      label: "Hr produção", value: `${resumo.horasProducao.toFixed(1)}h`,     cor: "text-blue-600",   bg: "bg-blue-500/5 border-blue-500/20" },
          { Icon: TrendingUp, label: "Eficiência",  value: `${resumo.eficiencia.toFixed(1)}%`,        cor: resumo.eficiencia >= 95 ? "text-green-600" : resumo.eficiencia >= 80 ? "text-amber-600" : "text-red-600", bg: "bg-purple-500/5 border-purple-500/20" },
          { Icon: ListPlus,   label: "Na lista",    value: String(blocos.length),                     cor: blocos.length > 0 ? "text-blue-600" : "text-muted-foreground", bg: "bg-blue-500/5 border-blue-500/20" },
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

      {/* Montagem do bloco */}
      <div className="rounded-2xl border bg-card p-4 space-y-4">
        <div>
          <label className={lbl}>Máquina *</label>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {maquinas.map(m => {
              const st = STATUS_MAQUINA[m.status] ?? STATUS_MAQUINA.operando;
              const ativa = maquinaSel === m.codigo;
              const qtdNaLista = blocos.filter(b => b.maquina === m.codigo).length;
              return (
                <button key={m.id} type="button" onClick={() => setMaquinaSel(m.codigo)}
                  className={cn("relative flex flex-col items-center justify-center gap-0.5 h-16 rounded-xl border-2 transition-colors",
                    ativa ? "border-primary bg-primary/5" : "border-input hover:bg-muted/30")}>
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

        <div>
          <label className={lbl}><User className="h-3 w-3 inline -mt-0.5 mr-1" />Operador *</label>
          <Input value={operador} onChange={e => setOperador(e.target.value)} className="h-10" placeholder="Nome do operador" />
        </div>

        <div className="rounded-xl border border-border/60 p-3 space-y-3">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-green-600" /> Produção neste período <span className="font-normal normal-case text-muted-foreground/70">(deixe em branco se foi só parada)</span>
          </p>
          <div><label className={lbl}>Peça</label>
            <select value={peca} onChange={e => setPeca(e.target.value)} className={sel}>
              <option value="">Nenhuma — período só com situação/parada</option>
              <optgroup label="Produtos de produção">
                {pecas.filter(p => p.origem === "producao").map(p => <option key={p.codigo} value={p.codigo}>{p.codigo} — {p.descricao}</option>)}
              </optgroup>
              <optgroup label="Componentes registrados">
                {pecas.filter(p => p.origem === "componente").map(p => <option key={p.codigo} value={p.codigo}>{p.codigo} — {p.descricao}</option>)}
              </optgroup>
            </select>
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
                <div><label className={lbl}>Horas totais do período *</label>
                  <Input type="number" min="0" step="0.25" inputMode="decimal" value={horas}
                    onChange={e => setHoras(e.target.value)} className="h-10" placeholder="ex: 5" />
                </div>
              </div>
            </>
          )}
        </div>

        <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-3 space-y-3">
          <p className="text-[11px] font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wide flex items-center gap-1.5">
            <Coffee className="h-3.5 w-3.5" /> Situações dentro desse período <span className="font-normal normal-case text-blue-700/70 dark:text-blue-400/70">(Setup, Almoço, Manutenção...)</span>
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
              {peca && <p className="text-[10px] text-muted-foreground">{horasSituacoesTemp.toFixed(2)}h de situação, dentro das {horas || "?"}h totais do período</p>}
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
            <select value={novaSituacaoPeca} onChange={e => setNovaSituacaoPeca(e.target.value)} className={cn(sel, "h-9")}>
              <option value="">Peça que será produzida depois do setup...</option>
              <optgroup label="Produtos de produção">
                {pecas.filter(p => p.origem === "producao").map(p => <option key={p.codigo} value={p.codigo}>{p.codigo} — {p.descricao}</option>)}
              </optgroup>
              <optgroup label="Componentes registrados">
                {pecas.filter(p => p.origem === "componente").map(p => <option key={p.codigo} value={p.codigo}>{p.codigo} — {p.descricao}</option>)}
              </optgroup>
            </select>
          )}
          <Button type="button" variant="outline" size="sm" className="w-full gap-1.5 h-9" onClick={adicionarSituacaoAoBloco}>
            <Plus className="h-3.5 w-3.5" /> Adicionar situação a este bloco
          </Button>
        </div>

        <Button className="w-full gap-1.5 h-11" variant="outline" onClick={adicionarBloco} disabled={saving}>
          <Plus className="h-4 w-4" /> Adicionar bloco à lista
        </Button>
      </div>

      {/* Lista da sessão — tudo que ainda não foi salvo */}
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
