/**
 * PlanejamentoPanel — Programação da produção (ordens de produção).
 *
 * Redesenho (set/2026), no formato usado por sistemas de PCP/APS:
 *  • sem turno: a ordem tem DIA e HORA de início e de fim — pode atravessar
 *    os dois turnos seguidos;
 *  • o fim previsto é sugerido automaticamente pela quantidade ÷ ritmo da peça
 *    (ritmo aprendido pelos lançamentos; se não houver, o do cadastro);
 *  • tabela com progresso real (peças apontadas no Diário/Controle para a
 *    mesma peça e máquina dentro do período), situação e atraso;
 *  • botões Iniciar / Concluir registram o início e o fim REAIS, que alimentam
 *    o indicador "cumprimento do prazo";
 *  • aviso de conflito quando duas ordens ocupam a mesma máquina no mesmo horário.
 */
import { temPapel } from "@/types/roles";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus, RefreshCw, CalendarClock, Play, CheckCircle2, Pencil, Trash2, AlertTriangle,
  Search, Loader2, Clock, XCircle, Factory, Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PecaCombobox, carregarPecasProducao, type PecaOption } from "@/components/producao/PecaCombobox";

type OPStatus = "planejada" | "em_producao" | "concluida" | "cancelada";
type Prioridade = "baixa" | "normal" | "alta" | "urgente";

interface Ordem {
  id: string; numero: string; produto: string; descricao_produto: string | null; maquina: string;
  quantidade: number; status: OPStatus; prioridade: Prioridade;
  inicio_previsto: string | null; fim_previsto: string | null;
  inicio_real: string | null; fim_real: string | null;
  data_inicio: string; data_fim: string; observacoes: string | null;
}
interface Maquina { codigo: string; nome: string; }

const STATUS: Record<OPStatus, { label: string; cls: string }> = {
  planejada:   { label: "Planejada",   cls: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30" },
  em_producao: { label: "Em produção", cls: "bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/30" },
  concluida:   { label: "Concluída",   cls: "bg-muted text-muted-foreground border-border" },
  cancelada:   { label: "Cancelada",   cls: "bg-muted text-muted-foreground border-border line-through" },
};
const PRIORIDADE: Record<Prioridade, { label: string; cls: string; peso: number }> = {
  urgente: { label: "Urgente", cls: "text-red-600 dark:text-red-400", peso: 0 },
  alta:    { label: "Alta",    cls: "text-amber-600 dark:text-amber-400", peso: 1 },
  normal:  { label: "Normal",  cls: "text-muted-foreground", peso: 2 },
  baixa:   { label: "Baixa",   cls: "text-muted-foreground/70", peso: 3 },
};
type Filtro = "abertas" | "atrasadas" | "concluidas" | "canceladas" | "todas";

// ── Datas ────────────────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, "0");
const isoDia = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoHora = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const juntar = (dia: string, hora: string) => (dia && hora ? new Date(`${dia}T${hora}:00`) : null);
function fmtDataHora(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${isoHora(d)}`;
}
function fmtDur(h: number) {
  if (!isFinite(h) || h <= 0) return "—";
  const tot = Math.round(h * 60), hh = Math.floor(tot / 60), mm = tot % 60;
  if (hh >= 48) return `${Math.floor(hh / 24)}d ${hh % 24}h`;
  return mm ? `${hh}h${pad(mm)}` : `${hh}h`;
}
const horasEntre = (a: string | null, b: string | null) => (a && b ? (new Date(b).getTime() - new Date(a).getTime()) / 3600000 : 0);

/** Situação calculada: atrasos contam a partir do horário previsto. */
function situacao(o: Ordem, agora = Date.now()) {
  const fimPrev = o.fim_previsto ? new Date(o.fim_previsto).getTime() : null;
  const iniPrev = o.inicio_previsto ? new Date(o.inicio_previsto).getTime() : null;
  if (o.status === "concluida" && o.fim_real && fimPrev) {
    const atraso = (new Date(o.fim_real).getTime() - fimPrev) / 3600000;
    return atraso > 0.25 ? { tipo: "atrasou" as const, horas: atraso } : { tipo: "no_prazo" as const, horas: 0 };
  }
  if (o.status === "cancelada" || o.status === "concluida") return { tipo: "ok" as const, horas: 0 };
  if (fimPrev && agora > fimPrev) return { tipo: "atrasada" as const, horas: (agora - fimPrev) / 3600000 };
  if (o.status === "planejada" && iniPrev && agora > iniPrev) return { tipo: "inicio_atrasado" as const, horas: (agora - iniPrev) / 3600000 };
  return { tipo: "ok" as const, horas: 0 };
}

// ── Formulário ───────────────────────────────────────────────────────────────

function OrdemDialog({ open, ordem, onClose, onSaved, maquinas, pecas, ritmos, ordens }: {
  open: boolean; ordem: Ordem | null; onClose: () => void; onSaved: () => void;
  maquinas: Maquina[]; pecas: PecaOption[]; ritmos: Map<string, { ph: number; amostras: number }>; ordens: Ordem[];
}) {
  const { user } = useAuth();
  const [peca, setPeca] = useState("");
  const [maquina, setMaquina] = useState("");
  const [qtd, setQtd] = useState("");
  const [diaIni, setDiaIni] = useState(""); const [horaIni, setHoraIni] = useState("");
  const [diaFim, setDiaFim] = useState(""); const [horaFim, setHoraFim] = useState("");
  const [fimManual, setFimManual] = useState(false);
  const [prioridade, setPrioridade] = useState<Prioridade>("normal");
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);

  // Próximo horário livre da máquina: depois da última ordem aberta dela (ou agora).
  const proximoLivre = useCallback((maq: string, ignorar?: string) => {
    const agora = new Date(); agora.setMinutes(agora.getMinutes() < 30 ? 30 : 60, 0, 0);
    const fins = ordens.filter(o => o.maquina === maq && o.id !== ignorar && (o.status === "planejada" || o.status === "em_producao") && o.fim_previsto)
      .map(o => new Date(o.fim_previsto!).getTime());
    return new Date(Math.max(agora.getTime(), ...fins));
  }, [ordens]);

  useEffect(() => {
    if (!open) return;
    setPeca(ordem?.produto ?? ""); setMaquina(ordem?.maquina ?? "");
    setQtd(ordem ? String(ordem.quantidade) : ""); setPrioridade(ordem?.prioridade ?? "normal");
    setObs(ordem?.observacoes ?? ""); setFimManual(!!ordem);
    const ini = ordem?.inicio_previsto ? new Date(ordem.inicio_previsto) : null;
    const fim = ordem?.fim_previsto ? new Date(ordem.fim_previsto) : null;
    setDiaIni(ini ? isoDia(ini) : ""); setHoraIni(ini ? isoHora(ini) : "");
    setDiaFim(fim ? isoDia(fim) : ""); setHoraFim(fim ? isoHora(fim) : "");
  }, [open, ordem]);

  // Ao escolher a máquina numa ordem nova, sugere o próximo horário livre dela.
  useEffect(() => {
    if (!open || ordem || !maquina) return;
    const d = proximoLivre(maquina);
    setDiaIni(isoDia(d)); setHoraIni(isoHora(d));
  }, [maquina, open, ordem, proximoLivre]);

  const ritmo = ritmos.get(`${peca}|${maquina}`) ?? ritmos.get(`${peca}|*`);
  const porHoraCad = pecas.find(p => p.codigo === peca)?.pecas_por_hora ?? 0;
  const usarAprendido = !!ritmo && (ritmo.amostras >= 3 || porHoraCad <= 0);
  const pph = usarAprendido ? ritmo!.ph : porHoraCad;
  const fonte = usarAprendido ? `histórico de ${ritmo!.amostras} lançamento${ritmo!.amostras > 1 ? "s" : ""}` : porHoraCad > 0 ? "cadastro da peça" : "";
  const qtdNum = parseInt(qtd) || 0;
  const horasEstimadas = pph > 0 && qtdNum > 0 ? qtdNum / pph : 0;
  const inicio = juntar(diaIni, horaIni);

  // Fim previsto automático = início + horas estimadas (máquina rodando direto, os 2 turnos).
  useEffect(() => {
    if (fimManual || !inicio || horasEstimadas <= 0) return;
    const f = new Date(inicio.getTime() + horasEstimadas * 3600000);
    setDiaFim(isoDia(f)); setHoraFim(isoHora(f));
  }, [fimManual, diaIni, horaIni, horasEstimadas]); // eslint-disable-line react-hooks/exhaustive-deps

  const fim = juntar(diaFim, horaFim);
  const conflitos = useMemo(() => {
    if (!inicio || !fim || !maquina) return [];
    return ordens.filter(o => o.maquina === maquina && o.id !== ordem?.id && (o.status === "planejada" || o.status === "em_producao")
      && o.inicio_previsto && o.fim_previsto
      && new Date(o.inicio_previsto) < fim && new Date(o.fim_previsto) > inicio);
  }, [inicio, fim, maquina, ordens, ordem]);

  async function salvar() {
    if (!navigator.onLine) { toast.error("O planejamento precisa de internet."); return; }
    if (!peca || !maquina || qtdNum <= 0 || !inicio || !fim) { toast.error("Preencha peça, máquina, quantidade, início e fim."); return; }
    if (fim <= inicio) { toast.error("O fim precisa ser depois do início."); return; }
    setSalvando(true);
    const base = {
      produto: peca, descricao_produto: pecas.find(p => p.codigo === peca)?.descricao ?? null, maquina,
      quantidade: qtdNum, prioridade, observacoes: obs.trim() || null, turno: "Dia inteiro",
      inicio_previsto: inicio.toISOString(), fim_previsto: fim.toISOString(),
      data_inicio: isoDia(inicio), data_fim: isoDia(fim),
      capacidade: pph > 0 ? Math.round(pph * 100) / 100 : null,
    };
    let erro: string | null = null;
    if (ordem) {
      const { error } = await supabase.from("ordens_planejamento").update(base).eq("id", ordem.id);
      if (error) erro = error.message;
    } else {
      // Número OP-AAAA-0001 sequencial no ano (tenta de novo se outro usuário pegar o mesmo número).
      const ano = new Date().getFullYear();
      for (let tentativa = 0; tentativa < 4; tentativa++) {
        const { data: ult } = await supabase.from("ordens_planejamento").select("numero")
          .like("numero", `OP-${ano}-%`).order("numero", { ascending: false }).limit(1);
        const n = (parseInt((ult?.[0]?.numero ?? "").split("-")[2] ?? "0") || 0) + 1 + tentativa;
        const { error } = await supabase.from("ordens_planejamento").insert({
          ...base, numero: `OP-${ano}-${String(n).padStart(4, "0")}`, status: "planejada", user_id: user?.id,
        });
        if (!error) { erro = null; break; }
        erro = error.message;
        if (error.code !== "23505") break; // só repete em número duplicado
      }
    }
    setSalvando(false);
    if (erro) { toast.error("Não foi possível salvar a ordem."); return; }
    toast.success(ordem ? "Ordem atualizada." : "Ordem criada.");
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{ordem ? `Editar ${ordem.numero}` : "Nova ordem de produção"}</DialogTitle>
          <DialogDescription>Informe o dia e a hora de início — o fim é calculado pelo ritmo da peça (dá para ajustar).</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Peça</label>
            <PecaCombobox pecas={pecas} value={peca} onChange={setPeca} placeholder="Buscar peça por nome, código ou referência..." />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Máquina</label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {maquinas.map(m => (
                <button key={m.codigo} type="button" onClick={() => setMaquina(m.codigo)} aria-pressed={maquina === m.codigo}
                  className={cn("rounded-xl border-2 px-2 py-2 text-left transition-all",
                    maquina === m.codigo ? "border-primary bg-primary/5" : "border-border hover:border-primary/40")}>
                  <span className="block text-sm font-bold">{m.codigo}</span>
                  <span className="block text-[11px] text-muted-foreground truncate">{m.nome}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quantidade</label>
              <Input type="number" min="1" inputMode="numeric" value={qtd} onChange={e => setQtd(e.target.value.replace(/\D/g, ""))}
                placeholder="peças" className="h-11 text-base font-semibold tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prioridade</label>
              <div className="flex rounded-xl border bg-muted/40 p-1">
                {(["baixa", "normal", "alta", "urgente"] as Prioridade[]).map(p => (
                  <button key={p} type="button" onClick={() => setPrioridade(p)} aria-pressed={prioridade === p}
                    className={cn("flex-1 h-9 rounded-lg text-xs font-medium", prioridade === p ? cn("bg-card shadow-sm", PRIORIDADE[p].cls) : "text-muted-foreground")}>
                    {PRIORIDADE[p].label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="h-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center">Início (dia e hora)</label>
              <div className="flex gap-2">
                <Input type="date" value={diaIni} onChange={e => setDiaIni(e.target.value)} className="h-11 flex-1 min-w-0" aria-label="Dia de início" />
                <Input type="time" value={horaIni} onChange={e => setHoraIni(e.target.value)} className="h-11 w-[7.25rem] shrink-0" aria-label="Hora de início" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2 h-5">
                Fim previsto (dia e hora)
                {fimManual && horasEstimadas > 0 && (
                  <button type="button" onClick={() => setFimManual(false)} className="normal-case tracking-normal font-medium text-primary hover:underline">recalcular</button>
                )}
              </label>
              <div className="flex gap-2">
                <Input type="date" value={diaFim} onChange={e => { setDiaFim(e.target.value); setFimManual(true); }} className="h-11 flex-1 min-w-0" aria-label="Dia do fim" />
                <Input type="time" value={horaFim} onChange={e => { setHoraFim(e.target.value); setFimManual(true); }} className="h-11 w-[7.25rem] shrink-0" aria-label="Hora do fim" />
              </div>
            </div>
          </div>

          <div className="rounded-xl border bg-muted/40 px-3 py-2.5 text-sm space-y-0.5">
            {horasEstimadas > 0 ? (
              <p><Target className="inline h-4 w-4 text-primary mr-1.5 -mt-0.5" />
                Tempo de máquina estimado: <strong>{fmtDur(horasEstimadas)}</strong>{" "}
                <span className="text-muted-foreground">({pph.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} pç/h · {fonte})</span></p>
            ) : (
              <p className="text-muted-foreground">{peca ? "Esta peça ainda não tem ritmo conhecido — informe o fim previsto." : "Escolha a peça e a quantidade para calcular o fim."}</p>
            )}
            {inicio && fim && fim > inicio && <p className="text-muted-foreground">Período da ordem: {fmtDur(horasEntre(inicio.toISOString(), fim.toISOString()))} (pode atravessar os dois turnos)</p>}
          </div>

          {conflitos.length > 0 && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm flex gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Conflito de horário em {maquina}</p>
                {conflitos.map(c => <p key={c.id} className="text-muted-foreground">{c.numero} · {c.produto} · {fmtDataHora(c.inicio_previsto)} → {fmtDataHora(c.fim_previsto)}</p>)}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Observações (opcional)</label>
            <textarea value={obs} onChange={e => setObs(e.target.value)} rows={2} maxLength={500}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Ex.: pedido do cliente X, material separado..." />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button className="h-11 gap-1.5" onClick={salvar} disabled={salvando}>
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {ordem ? "Salvar alterações" : "Criar ordem"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Painel ───────────────────────────────────────────────────────────────────

export function PlanejamentoPanel({ isAdmin }: { isAdmin: boolean }) {
  const { role } = useAuth();
  const podeEditar = temPapel(role, "producao");
  const [ordens, setOrdens] = useState<Ordem[]>([]);
  const [progresso, setProgresso] = useState<Map<string, number>>(new Map());
  const [maquinas, setMaquinas] = useState<Maquina[]>([]);
  const [pecas, setPecas] = useState<PecaOption[]>([]);
  const [ritmos, setRitmos] = useState<Map<string, { ph: number; amostras: number }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<Filtro>("abertas");
  const [maqFiltro, setMaqFiltro] = useState("");
  const [busca, setBusca] = useState("");
  const [dialog, setDialog] = useState<{ open: boolean; ordem: Ordem | null }>({ open: false, ordem: null });
  const [confirmarExcluir, setConfirmarExcluir] = useState<string | null>(null);
  const [agora, setAgora] = useState(Date.now());

  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 60000); return () => clearInterval(t); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const desde = new Date(); desde.setDate(desde.getDate() - 120);
    const [ordRes, progRes, maqRes, prodRes, tempoRes] = await Promise.all([
      supabase.from("ordens_planejamento")
        .select("id,numero,produto,descricao_produto,maquina,quantidade,status,prioridade,inicio_previsto,fim_previsto,inicio_real,fim_real,data_inicio,data_fim,observacoes")
        .or(`status.in.(planejada,em_producao),data_fim.gte.${isoDia(desde)}`)
        .order("inicio_previsto", { ascending: true }),
      supabase.from("ordens_planejamento_progresso").select("id,quantidade_produzida"),
      supabase.from("maquinas_producao").select("codigo,nome").order("codigo"),
      carregarPecasProducao(),
      supabase.from("tempo_peca_padrao").select("produto,maquina,pecas_hora,amostras"),
    ]);
    if (ordRes.error) toast.error("Não foi possível carregar o planejamento.");
    setOrdens((ordRes.data ?? []) as Ordem[]);
    setProgresso(new Map((progRes.data ?? []).map(p => [p.id as string, Number(p.quantidade_produzida) || 0])));
    setMaquinas((maqRes.data ?? []) as Maquina[]);
    setPecas(prodRes);
    const r = new Map<string, { ph: number; amostras: number }>();
    for (const t of tempoRes.data ?? []) if (t.pecas_hora && t.pecas_hora > 0) r.set(`${t.produto}|${t.maquina}`, { ph: Number(t.pecas_hora), amostras: t.amostras });
    setRitmos(r);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function mudarStatus(o: Ordem, status: OPStatus) {
    const patch: Partial<Ordem> = { status };
    if (status === "em_producao" && !o.inicio_real) patch.inicio_real = new Date().toISOString();
    if (status === "concluida") { patch.fim_real = new Date().toISOString(); if (!o.inicio_real) patch.inicio_real = o.inicio_previsto ?? patch.fim_real; }
    if (status === "planejada") { patch.inicio_real = null; patch.fim_real = null; }
    const { error } = await supabase.from("ordens_planejamento").update(patch).eq("id", o.id);
    if (error) { toast.error("Não foi possível atualizar a ordem."); return; }
    toast.success(status === "em_producao" ? `${o.numero} iniciada.` : status === "concluida" ? `${o.numero} concluída.` : status === "cancelada" ? `${o.numero} cancelada.` : `${o.numero} reaberta.`);
    load();
  }

  async function excluir(id: string) {
    const { error } = await supabase.from("ordens_planejamento").delete().eq("id", id);
    setConfirmarExcluir(null);
    if (error) { toast.error("Só administradores podem excluir ordens."); return; }
    toast.success("Ordem excluída."); load();
  }

  // ── Indicadores ──────────────────────────────────────────────────────────
  const abertas = ordens.filter(o => o.status === "planejada" || o.status === "em_producao");
  const atrasadas = abertas.filter(o => situacao(o, agora).tipo === "atrasada");
  const concluidas = ordens.filter(o => o.status === "concluida" && o.fim_real && o.fim_previsto);
  const noPrazo = concluidas.filter(o => situacao(o, agora).tipo === "no_prazo").length;
  const cumprimento = concluidas.length ? (noPrazo / concluidas.length) * 100 : null;

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return ordens.filter(o => {
      if (maqFiltro && o.maquina !== maqFiltro) return false;
      if (q && ![o.numero, o.produto, o.descricao_produto ?? "", o.maquina].some(v => v.toLowerCase().includes(q))) return false;
      const aberta = o.status === "planejada" || o.status === "em_producao";
      switch (filtro) {
        case "abertas": return aberta;
        case "atrasadas": return aberta && situacao(o, agora).tipo === "atrasada";
        case "concluidas": return o.status === "concluida";
        case "canceladas": return o.status === "cancelada";
        default: return true;
      }
    }).sort((a, b) => {
      const ea = a.status === "em_producao" ? 0 : 1, eb = b.status === "em_producao" ? 0 : 1;
      if (filtro === "abertas" && ea !== eb) return ea - eb;
      return (a.inicio_previsto ?? "").localeCompare(b.inicio_previsto ?? "") || PRIORIDADE[a.prioridade].peso - PRIORIDADE[b.prioridade].peso;
    });
  }, [ordens, filtro, maqFiltro, busca, agora]);

  // Conflitos entre ordens abertas da mesma máquina (para marcar na tabela).
  const emConflito = useMemo(() => {
    const s = new Set<string>();
    for (let i = 0; i < abertas.length; i++) for (let j = i + 1; j < abertas.length; j++) {
      const a = abertas[i], b = abertas[j];
      if (a.maquina !== b.maquina || !a.inicio_previsto || !a.fim_previsto || !b.inicio_previsto || !b.fim_previsto) continue;
      if (new Date(a.inicio_previsto) < new Date(b.fim_previsto) && new Date(b.inicio_previsto) < new Date(a.fim_previsto)) { s.add(a.id); s.add(b.id); }
    }
    return s;
  }, [abertas]);

  const filtros: { id: Filtro; label: string; n?: number }[] = [
    { id: "abertas", label: "Abertas", n: abertas.length },
    { id: "atrasadas", label: "Atrasadas", n: atrasadas.length },
    { id: "concluidas", label: "Concluídas" },
    { id: "canceladas", label: "Canceladas" },
    { id: "todas", label: "Todas" },
  ];

  const renderSituacao = (sit: ReturnType<typeof situacao>) => (
    <>
      {sit.tipo === "atrasada" && <p className="mt-0.5 text-[11px] font-semibold text-red-600 whitespace-nowrap">Atrasada {fmtDur(sit.horas)}</p>}
      {sit.tipo === "inicio_atrasado" && <p className="mt-0.5 text-[11px] font-semibold text-amber-600 whitespace-nowrap">Início atrasado {fmtDur(sit.horas)}</p>}
      {sit.tipo === "no_prazo" && <p className="mt-0.5 text-[11px] font-semibold text-green-600">No prazo</p>}
      {sit.tipo === "atrasou" && <p className="mt-0.5 text-[11px] font-semibold text-red-600 whitespace-nowrap">Atrasou {fmtDur(sit.horas)}</p>}
    </>
  );
  const renderAcoes = (o: Ordem, aberta: boolean, compacto = false) => (
    <div className={cn("flex items-center gap-1", compacto ? "flex-wrap" : "justify-end")}>
      {podeEditar && o.status === "planejada" && (
        <Button size="sm" variant="outline" className="h-9 gap-1" onClick={() => mudarStatus(o, "em_producao")}><Play className="h-3.5 w-3.5" />Iniciar</Button>
      )}
      {podeEditar && o.status === "em_producao" && (
        <Button size="sm" className="h-9 gap-1" onClick={() => mudarStatus(o, "concluida")}><CheckCircle2 className="h-3.5 w-3.5" />Concluir</Button>
      )}
      {podeEditar && (o.status === "concluida" || o.status === "cancelada") && (
        <Button size="sm" variant="ghost" className="h-9" onClick={() => mudarStatus(o, "planejada")}>Reabrir</Button>
      )}
      {podeEditar && aberta && (
        <>
          <Button size="icon" variant="ghost" className="h-9 w-9" aria-label={`Editar ${o.numero}`} onClick={() => setDialog({ open: true, ordem: o })}><Pencil className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" className="h-9 w-9 text-muted-foreground" aria-label={`Cancelar ${o.numero}`} title="Cancelar ordem" onClick={() => mudarStatus(o, "cancelada")}><XCircle className="h-4 w-4" /></Button>
        </>
      )}
      {isAdmin && (confirmarExcluir === o.id ? (
        <Button size="sm" variant="destructive" className="h-9" onClick={() => excluir(o.id)}>Confirmar</Button>
      ) : (
        <Button size="icon" variant="ghost" className="h-9 w-9 text-destructive" aria-label={`Excluir ${o.numero}`}
          onClick={() => { setConfirmarExcluir(o.id); setTimeout(() => setConfirmarExcluir(c => (c === o.id ? null : c)), 4000); }}>
          <Trash2 className="h-4 w-4" />
        </Button>
      ))}
    </div>
  );

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Indicadores */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { l: "Ordens abertas", v: String(abertas.length), Icon: CalendarClock, c: "text-foreground" },
          { l: "Em produção", v: String(abertas.filter(o => o.status === "em_producao").length), Icon: Factory, c: "text-green-600" },
          { l: "Atrasadas", v: String(atrasadas.length), Icon: AlertTriangle, c: atrasadas.length ? "text-red-600" : "text-foreground" },
          { l: "Entregues no prazo", v: cumprimento === null ? "—" : `${cumprimento.toFixed(0)}%`, Icon: Clock,
            c: cumprimento === null ? "text-muted-foreground" : cumprimento >= 90 ? "text-green-600" : cumprimento >= 75 ? "text-amber-600" : "text-red-600" },
        ].map(k => (
          <div key={k.l} className="rounded-2xl border bg-card p-4">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><k.Icon className="h-3.5 w-3.5" />{k.l}</p>
            <p className={cn("mt-1 text-2xl font-bold tabular-nums", k.c)}>{k.v}</p>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-xl border bg-muted/40 p-1" role="radiogroup" aria-label="Filtrar ordens">
          {filtros.map(f => (
            <button key={f.id} type="button" role="radio" aria-checked={filtro === f.id} onClick={() => setFiltro(f.id)}
              className={cn("h-9 px-3 rounded-lg text-sm font-medium flex items-center gap-1.5",
                filtro === f.id ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {f.label}
              {f.n !== undefined && f.n > 0 && <span className={cn("min-w-5 h-5 px-1 rounded-full text-[11px] font-bold flex items-center justify-center",
                f.id === "atrasadas" ? "bg-red-500/15 text-red-600" : "bg-primary/15 text-primary")}>{f.n}</span>}
            </button>
          ))}
        </div>
        <select value={maqFiltro} onChange={e => setMaqFiltro(e.target.value)} aria-label="Máquina" className="h-11 rounded-xl border border-input bg-background px-3 text-sm">
          <option value="">Todas as máquinas</option>
          {maquinas.map(m => <option key={m.codigo} value={m.codigo}>{m.codigo}</option>)}
        </select>
        <div className="relative flex-1 min-w-[10rem]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={e => setBusca(e.target.value)} placeholder="OP, peça ou máquina..." className="h-11 pl-9" />
        </div>
        <Button variant="outline" size="icon" className="h-11 w-11" onClick={load} disabled={loading} aria-label="Atualizar">
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
        {podeEditar && (
          <Button className="h-11 gap-1.5" onClick={() => setDialog({ open: true, ordem: null })}><Plus className="h-4 w-4" />Nova ordem</Button>
        )}
      </div>

      {/* Tabela */}
      <div className="rounded-2xl border bg-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando...</div>
        ) : lista.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <CalendarClock className="h-8 w-8 opacity-40" />
            <p>{ordens.length === 0 ? "Nenhuma ordem de produção ainda." : "Nenhuma ordem neste filtro."}</p>
            {podeEditar && ordens.length === 0 && <Button size="sm" className="mt-1 gap-1.5" onClick={() => setDialog({ open: true, ordem: null })}><Plus className="h-4 w-4" />Criar a primeira</Button>}
          </div>
        ) : (
          <>
          {/* Celular: cartões */}
          <ul className="md:hidden divide-y">
            {lista.map(o => {
              const prod = progresso.get(o.id) ?? 0;
              const pct = o.quantidade > 0 ? Math.min(100, (prod / o.quantidade) * 100) : 0;
              const sit = situacao(o, agora);
              const aberta = o.status === "planejada" || o.status === "em_producao";
              return (
                <li key={o.id} className={cn("p-4 space-y-2.5", sit.tipo === "atrasada" && "bg-red-500/[0.04]")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold tabular-nums">{o.numero} <span className={cn("text-[11px] font-medium", PRIORIDADE[o.prioridade].cls)}>· {PRIORIDADE[o.prioridade].label}</span></p>
                      <p className="text-sm"><strong>{o.produto}</strong> <span className="text-muted-foreground">em</span> <strong>{o.maquina}</strong>
                        {emConflito.has(o.id) && aberta && <AlertTriangle className="inline ml-1 h-3.5 w-3.5 text-amber-600" aria-label="Horário em conflito" />}</p>
                      {o.descricao_produto && <p className="text-xs text-muted-foreground truncate">{o.descricao_produto}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", STATUS[o.status].cls)}>{STATUS[o.status].label}</span>
                      {renderSituacao(sit)}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm tabular-nums"><strong>{prod.toLocaleString("pt-BR")}</strong> <span className="text-muted-foreground">/ {o.quantidade.toLocaleString("pt-BR")} peças</span></p>
                    <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className={cn("h-full rounded-full", pct >= 100 ? "bg-green-500" : "bg-primary")} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm tabular-nums">
                    <div><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Início</p>{fmtDataHora(o.inicio_real ?? o.inicio_previsto)}</div>
                    <div><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{o.fim_real ? "Fim" : "Fim previsto"}</p>{fmtDataHora(o.fim_real ?? o.fim_previsto)}</div>
                  </div>
                  {renderAcoes(o, aberta, true)}
                </li>
              );
            })}
          </ul>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm min-w-[980px]">
              <thead className="bg-muted/50">
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2.5 font-semibold">OP</th>
                  <th className="px-3 py-2.5 font-semibold">Peça</th>
                  <th className="px-3 py-2.5 font-semibold">Máquina</th>
                  <th className="px-3 py-2.5 font-semibold">Produzido / Planejado</th>
                  <th className="px-3 py-2.5 font-semibold">Início</th>
                  <th className="px-3 py-2.5 font-semibold">Fim previsto</th>
                  <th className="px-3 py-2.5 font-semibold">Situação</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {lista.map(o => {
                  const prod = progresso.get(o.id) ?? 0;
                  const pct = o.quantidade > 0 ? Math.min(100, (prod / o.quantidade) * 100) : 0;
                  const sit = situacao(o, agora);
                  const aberta = o.status === "planejada" || o.status === "em_producao";
                  return (
                    <tr key={o.id} className={cn("border-t align-middle", sit.tipo === "atrasada" && "bg-red-500/[0.04]")}>
                      <td className="px-3 py-2.5">
                        <p className="font-semibold tabular-nums whitespace-nowrap">{o.numero}</p>
                        <p className={cn("text-[11px] font-medium", PRIORIDADE[o.prioridade].cls)}>{PRIORIDADE[o.prioridade].label}</p>
                      </td>
                      <td className="px-3 py-2.5 max-w-[14rem]">
                        <p className="font-medium">{o.produto}</p>
                        {o.descricao_produto && <p className="text-xs text-muted-foreground truncate">{o.descricao_produto}</p>}
                        {o.observacoes && <p className="text-[11px] text-muted-foreground/80 truncate" title={o.observacoes}>“{o.observacoes}”</p>}
                      </td>
                      <td className="px-3 py-2.5 font-semibold">
                        {o.maquina}
                        {emConflito.has(o.id) && aberta && <span className="ml-1.5 inline-flex items-center text-amber-600" title="Horário em conflito com outra ordem desta máquina"><AlertTriangle className="h-3.5 w-3.5" /></span>}
                      </td>
                      <td className="px-3 py-2.5 min-w-[8.5rem]">
                        <p className="tabular-nums"><strong>{prod.toLocaleString("pt-BR")}</strong> <span className="text-muted-foreground">/ {o.quantidade.toLocaleString("pt-BR")}</span></p>
                        <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className={cn("h-full rounded-full", pct >= 100 ? "bg-green-500" : "bg-primary")} style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
                        {fmtDataHora(o.inicio_previsto)}
                        {o.inicio_real && <p className="text-[11px] text-muted-foreground">real {fmtDataHora(o.inicio_real)}</p>}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
                        {fmtDataHora(o.fim_previsto)}
                        {o.fim_real
                          ? <p className="text-[11px] text-muted-foreground">real {fmtDataHora(o.fim_real)}</p>
                          : <p className="text-[11px] text-muted-foreground">duração {fmtDur(horasEntre(o.inicio_previsto, o.fim_previsto))}</p>}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", STATUS[o.status].cls)}>{STATUS[o.status].label}</span>
                        {renderSituacao(sit)}
                      </td>
                      <td className="px-3 py-2.5">
                        {renderAcoes(o, aberta)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        O produzido vem dos lançamentos (Diário e Controle) da mesma peça e máquina dentro do período da ordem. “Iniciar” e “Concluir” registram os horários reais usados no indicador de prazo.
      </p>

      <OrdemDialog open={dialog.open} ordem={dialog.ordem} onClose={() => setDialog({ open: false, ordem: null })}
        onSaved={() => { setDialog({ open: false, ordem: null }); load(); }}
        maquinas={maquinas} pecas={pecas} ritmos={ritmos} ordens={ordens} />
    </div>
  );
}
