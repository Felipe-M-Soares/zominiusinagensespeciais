/**
 * ParadasPanel — Paradas de máquina em tempo real.
 * ✓ Registro rápido (botões grandes: máquina → motivo → tipo) com
 *   cronômetro ao vivo até o operador tocar em "Encerrar".
 * ✓ Dados via Supabase (paradas_producao) com fallback offline (IndexedDB).
 * ✓ Período (hoje / 7 / 30 dias / todas), motivos que mais pararam a fábrica.
 * ✓ Correção e exclusão de paradas (dono do registro ou admin/produção —
 *   RLS par_update e RPC excluir_lancamento_producao).
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, OctagonPause, Clock, CheckCircle2, Pencil, Loader2, Timer, AlertTriangle, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchInputWithBarcode } from "@/components/SearchInputWithBarcode";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { temPapel } from "@/types/roles";
import {
  KpiCard, Secao, Carregando, Vazio, BotaoAtualizar, Segmentado, Confirmar, Campo, selCls, fmtHorasCurto,
} from "@/components/producao/ProducaoUI";

type TipoParada = "planejada" | "nao_planejada";

interface Parada {
  id: string; maquina: string; motivo: string;
  tipo: TipoParada; inicio: string; fim?: string | null;
  duracao_min?: number | null; operador: string;
  observacoes?: string | null; user_id?: string | null; created_at?: string;
}

const MOTIVOS_PARADA = [
  "Manutenção Preventiva", "Manutenção Corretiva", "Falta de Material",
  "Setup / Troca de Ferramenta", "Falta de Operador", "Energia Elétrica",
  "Problema de Qualidade", "Reunião / Treinamento", "Refeição/Descanso", "Outro",
];
/** Mesma chave usada pelo Diário para lembrar o operador (preferência de UI). */
const OPERADOR_KEY = "diario_producao_operador";
type Periodo = "hoje" | "7d" | "30d" | "todas";

function lerOperador() { try { return localStorage.getItem(OPERADOR_KEY) ?? ""; } catch { return ""; } }
function gravarOperador(v: string) { try { localStorage.setItem(OPERADOR_KEY, v); } catch { /* sem armazenamento */ } }

function useAgora(ativo: boolean) {
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => {
    if (!ativo) return;
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ativo]);
  return agora;
}

function fmtCrono(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
const fmtQuando = (iso: string) => {
  const d = new Date(iso), hoje = new Date();
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === hoje.toDateString() ? `hoje ${hora}` : `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${hora}`;
};
const minutosDa = (p: Parada, agora: number) => p.fim ? (p.duracao_min ?? 0) : Math.max(0, Math.round((agora - new Date(p.inicio).getTime()) / 60000));

const TipoChip = ({ tipo }: { tipo: TipoParada }) => (
  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
    tipo === "nao_planejada" ? "bg-red-500/10 text-red-700 dark:text-red-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300")}>
    {tipo === "nao_planejada" ? "Não planejada" : "Planejada"}
  </span>
);

// ── Cartão de parada ATIVA (cronômetro + encerrar) ───────────────────────────
function ParadaAtiva({ parada, onEncerrar, encerrando }: { parada: Parada; onEncerrar: () => void; encerrando: boolean }) {
  const agora = useAgora(true);
  const seg = Math.max(0, Math.floor((agora - new Date(parada.inicio).getTime()) / 1000));
  return (
    <li className={cn("rounded-2xl border p-4 space-y-3",
      parada.tipo === "nao_planejada" ? "border-red-500/30 bg-red-500/5" : "border-amber-500/30 bg-amber-500/5")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-bold leading-tight">{parada.maquina}</p>
          <p className="text-sm">{parada.motivo}</p>
          <p className="text-xs text-muted-foreground">{parada.operador} · desde {fmtQuando(parada.inicio)}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-mono text-2xl font-bold tabular-nums leading-none">{fmtCrono(seg)}</p>
          <div className="mt-1.5"><TipoChip tipo={parada.tipo} /></div>
        </div>
      </div>
      {parada.observacoes && <p className="text-xs text-muted-foreground italic">“{parada.observacoes}”</p>}
      <Button className="w-full h-12 text-base gap-2 bg-green-600 hover:bg-green-500 text-white" onClick={onEncerrar} disabled={encerrando}>
        {encerrando ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />} Máquina voltou — encerrar parada
      </Button>
    </li>
  );
}

// ── Nova parada (poucos toques) ──────────────────────────────────────────────
function NovaParadaDialog({ open, onClose, onSaved, maquinas, maquinasParadas }: {
  open: boolean; onClose: () => void; onSaved: (p: Parada) => void; maquinas: string[]; maquinasParadas: Set<string>;
}) {
  const [form, setForm] = useState({ maquina: "", motivo: "", tipo: "nao_planejada" as TipoParada, operador: "", observacoes: "" });
  const [saving, setSaving] = useState(false);
  const { saveWithFallback } = useOfflineSync();
  const { user } = useAuth();
  useEffect(() => { if (open) setForm({ maquina: "", motivo: "", tipo: "nao_planejada", operador: lerOperador(), observacoes: "" }); }, [open]);

  async function save() {
    if (!form.maquina || !form.motivo || !form.operador.trim()) { toast.error("Escolha a máquina, o motivo e informe o operador."); return; }
    setSaving(true);
    const agora = new Date().toISOString();
    const data: Parada = {
      id: crypto.randomUUID(), maquina: form.maquina, motivo: form.motivo, tipo: form.tipo,
      inicio: agora, operador: form.operador.trim(), observacoes: form.observacoes.trim() || undefined, user_id: user?.id, created_at: agora,
    };
    const { data: saved, error, savedOffline } = await saveWithFallback("paradas_producao", "paradas", "INSERT", data);
    setSaving(false);
    if (error) { toast.error("Não foi possível registrar a parada."); return; }
    gravarOperador(form.operador.trim());
    toast.success(savedOffline ? "Sem internet — parada salva no aparelho e enviada ao reconectar." : `Parada da ${form.maquina} iniciada.`);
    onSaved(saved || data); onClose();
  }

  const escolher = (m: string) => {
    // "Refeição" e "Reunião" costumam ser planejadas; o resto, não.
    const planejada = /Refeição|Reunião|Preventiva/.test(m);
    setForm(p => ({ ...p, motivo: m, tipo: planejada ? "planejada" : "nao_planejada" }));
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Registrar parada</DialogTitle>
          <DialogDescription>O cronômetro começa agora. Toque em “encerrar” quando a máquina voltar.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Campo label="Máquina">
            {maquinas.length > 0 ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {maquinas.map(m => {
                  const parada = maquinasParadas.has(m);
                  return (
                    <button key={m} type="button" onClick={() => setForm(p => ({ ...p, maquina: m }))} aria-pressed={form.maquina === m}
                      className={cn("h-12 rounded-xl border-2 px-2 text-sm font-bold transition-colors relative",
                        form.maquina === m ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/40")}>
                      {m}
                      {parada && <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500" title="Já está parada" />}
                    </button>
                  );
                })}
              </div>
            ) : <Input value={form.maquina} onChange={e => setForm(p => ({ ...p, maquina: e.target.value }))} placeholder="Ex: CNC-01" className="h-11" />}
          </Campo>
          <Campo label="Motivo">
            <div className="grid grid-cols-2 gap-2">
              {MOTIVOS_PARADA.map(m => (
                <button key={m} type="button" onClick={() => escolher(m)} aria-pressed={form.motivo === m}
                  className={cn("min-h-[2.75rem] rounded-xl border-2 px-3 py-1.5 text-left text-sm font-medium leading-tight transition-colors",
                    form.motivo === m ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/40")}>
                  {m}
                </button>
              ))}
            </div>
          </Campo>
          <Campo label="Tipo">
            <Segmentado cheio ariaLabel="Tipo de parada" valor={form.tipo} onChange={t => setForm(p => ({ ...p, tipo: t }))}
              opcoes={[{ v: "nao_planejada", l: "Não planejada" }, { v: "planejada", l: "Planejada" }]} />
          </Campo>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Campo label="Operador"><Input value={form.operador} onChange={e => setForm(p => ({ ...p, operador: e.target.value }))} placeholder="Seu nome" className="h-11" autoComplete="name" /></Campo>
            <Campo label="Observação (opcional)"><Input value={form.observacoes} onChange={e => setForm(p => ({ ...p, observacoes: e.target.value }))} placeholder="Ex.: aguardando peça" className="h-11" /></Campo>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button className="h-11 gap-1.5" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Timer className="h-4 w-4" />} Iniciar parada
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Corrigir parada ──────────────────────────────────────────────────────────
const DURACOES = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480, 600, 720];

function EditarParadaDialog({ parada, maquinas, podeExcluir, onClose, onSaved }: {
  parada: Parada | null; maquinas: string[]; podeExcluir: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({ maquina: "", motivo: "", tipo: "nao_planejada" as TipoParada, minutos: 0, operador: "", observacoes: "", ativa: false });
  const [salvando, setSalvando] = useState(false);
  const [confirmar, setConfirmar] = useState(false);

  useEffect(() => {
    if (!parada) return;
    setForm({
      maquina: parada.maquina, motivo: parada.motivo, tipo: parada.tipo, operador: parada.operador, observacoes: parada.observacoes ?? "",
      minutos: parada.fim ? (parada.duracao_min ?? 0) : 0, ativa: !parada.fim,
    });
  }, [parada]);

  const opcoesMin = [...new Set([form.minutos, ...DURACOES])].filter(m => m > 0).sort((a, b) => a - b);

  async function salvar() {
    if (!parada) return;
    if (!navigator.onLine) { toast.error("Sem internet — a correção precisa de conexão."); return; }
    if (!form.operador.trim()) { toast.error("Informe o operador."); return; }
    setSalvando(true);
    const patch: { maquina: string; motivo: string; tipo: TipoParada; operador: string; observacoes: string | null; duracao_min?: number; fim?: string } = {
      maquina: form.maquina, motivo: form.motivo, tipo: form.tipo, operador: form.operador.trim(), observacoes: form.observacoes.trim() || null,
    };
    if (!form.ativa && form.minutos > 0) {
      patch.duracao_min = form.minutos;
      patch.fim = new Date(new Date(parada.inicio).getTime() + form.minutos * 60000).toISOString();
    }
    const { error } = await supabase.from("paradas_producao").update(patch).eq("id", parada.id);
    setSalvando(false);
    if (error) { toast.error("Não foi possível salvar — só quem registrou ou a produção pode corrigir."); return; }
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
    setConfirmar(false);
    onSaved();
  }

  return (
    <>
      <Dialog open={!!parada} onOpenChange={o => { if (!o) onClose(); }}>
        <DialogContent className="max-w-md max-h-[92dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Corrigir parada</DialogTitle>
            <DialogDescription>{parada && `Iniciada ${fmtQuando(parada.inicio)} por ${parada.operador}.`}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Máquina">
                <select value={form.maquina} onChange={e => setForm(f => ({ ...f, maquina: e.target.value }))} className={selCls}>
                  {!maquinas.includes(form.maquina) && <option value={form.maquina}>{form.maquina}</option>}
                  {maquinas.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </Campo>
              <Campo label="Duração">
                {form.ativa ? <div className="h-11 rounded-xl border bg-muted/40 px-3 flex items-center text-sm text-muted-foreground">em andamento</div> : (
                  <select value={form.minutos} onChange={e => setForm(f => ({ ...f, minutos: Number(e.target.value) }))} className={selCls}>
                    {opcoesMin.map(m => <option key={m} value={m}>{fmtHorasCurto(m / 60)}</option>)}
                  </select>
                )}
              </Campo>
            </div>
            <Campo label="Motivo">
              <select value={form.motivo} onChange={e => setForm(f => ({ ...f, motivo: e.target.value }))} className={selCls}>
                {!MOTIVOS_PARADA.includes(form.motivo) && <option value={form.motivo}>{form.motivo}</option>}
                {MOTIVOS_PARADA.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </Campo>
            <Campo label="Tipo">
              <Segmentado cheio ariaLabel="Tipo de parada" valor={form.tipo} onChange={t => setForm(f => ({ ...f, tipo: t }))}
                opcoes={[{ v: "nao_planejada", l: "Não planejada" }, { v: "planejada", l: "Planejada" }]} />
            </Campo>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Campo label="Operador"><Input value={form.operador} onChange={e => setForm(f => ({ ...f, operador: e.target.value }))} className="h-11" /></Campo>
              <Campo label="Observação"><Input value={form.observacoes} onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))} className="h-11" /></Campo>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {podeExcluir ? (
              <Button variant="outline" className="h-11 text-destructive border-destructive/40 hover:bg-destructive/10" onClick={() => setConfirmar(true)} disabled={salvando}>Excluir</Button>
            ) : <span />}
            <div className="flex flex-col-reverse sm:flex-row gap-2">
              <Button variant="outline" className="h-11" onClick={onClose} disabled={salvando}>Cancelar</Button>
              <Button className="h-11 gap-1.5" onClick={salvar} disabled={salvando}>
                {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Salvar correção
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Confirmar aberto={confirmar} titulo="Excluir esta parada?" carregando={salvando}
        descricao="Ela deixa de contar no tempo parado e no OEE." onConfirmar={excluir} onCancelar={() => setConfirmar(false)} />
    </>
  );
}

// ── Painel ───────────────────────────────────────────────────────────────────
export function ParadasPanel() {
  const { user, role } = useAuth();
  const gestor = temPapel(role, "producao");
  const [paradas, setParadas] = useState<Parada[]>([]);
  const [maquinas, setMaquinas] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editar, setEditar] = useState<Parada | null>(null);
  const [encerrando, setEncerrando] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>("hoje");
  const [maqFiltro, setMaqFiltro] = useState("");
  const { loadWithFallback, saveWithFallback } = useOfflineSync();
  const agora = useAgora(true);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await loadWithFallback<Parada>("paradas_producao", "paradas");
    // Entradas "Produzindo — ..." são o cronômetro interno de produção do
    // Diário, não uma parada real — não entram aqui.
    setParadas(data.filter(p => !p.motivo?.startsWith("Produzindo")).sort((a, b) => b.inicio.localeCompare(a.inicio)));
    if (navigator.onLine) {
      const { data: maq } = await supabase.from("maquinas_producao").select("codigo").order("codigo");
      if (maq) setMaquinas(maq.map((m: { codigo: string }) => m.codigo));
    } else {
      setMaquinas(prev => prev.length ? prev : [...new Set(data.map(p => p.maquina))].sort());
    }
    setLoading(false);
  }, [loadWithFallback]);

  useEffect(() => { load(); }, [load]);

  async function encerrar(p: Parada) {
    setEncerrando(p.id);
    const fim = new Date().toISOString();
    const duracao_min = Math.max(1, Math.round((new Date(fim).getTime() - new Date(p.inicio).getTime()) / 60000));
    const updated = { ...p, fim, duracao_min };
    const { error, savedOffline } = await saveWithFallback("paradas_producao", "paradas", "UPDATE", updated);
    setEncerrando(null);
    if (error) { toast.error("Não foi possível encerrar a parada."); return; }
    toast.success(savedOffline ? "Sem internet — encerramento salvo no aparelho." : `${p.maquina} voltou a produzir (${fmtHorasCurto(duracao_min / 60)} parada).`);
    setParadas(prev => prev.map(x => x.id === p.id ? updated : x));
  }

  const ativas = paradas.filter(p => !p.fim);
  const maquinasParadas = useMemo(() => new Set(ativas.map(p => p.maquina)), [ativas]);

  const desde = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    if (periodo === "7d") d.setDate(d.getDate() - 6);
    else if (periodo === "30d") d.setDate(d.getDate() - 29);
    else if (periodo === "todas") return 0;
    return d.getTime();
  }, [periodo]);

  const doPeriodo = useMemo(() => paradas.filter(p => new Date(p.inicio).getTime() >= desde && (!maqFiltro || p.maquina === maqFiltro)), [paradas, desde, maqFiltro]);
  const q = search.trim().toLowerCase();
  const historico = doPeriodo.filter(p => p.fim && (!q || [p.maquina, p.motivo, p.operador, p.observacoes ?? ""].some(v => v.toLowerCase().includes(q))));

  const minPeriodo = doPeriodo.reduce((s, p) => s + minutosDa(p, agora), 0);
  const minNaoPlan = doPeriodo.filter(p => p.tipo === "nao_planejada").reduce((s, p) => s + minutosDa(p, agora), 0);
  const porMotivo = useMemo(() => {
    const m = new Map<string, { min: number; n: number }>();
    for (const p of doPeriodo) { const x = m.get(p.motivo) ?? { min: 0, n: 0 }; x.min += minutosDa(p, agora); x.n++; m.set(p.motivo, x); }
    return [...m.entries()].map(([motivo, v]) => ({ motivo, ...v })).sort((a, b) => b.min - a.min).slice(0, 6);
  }, [doPeriodo, agora]);
  const maxMotivo = porMotivo[0]?.min || 1;

  const podeMexer = (p: Parada) => gestor || (!!user && p.user_id === user.id);
  const rotuloPeriodo = periodo === "hoje" ? "hoje" : periodo === "7d" ? "em 7 dias" : periodo === "30d" ? "em 30 dias" : "no total";

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Ação principal — grande no celular */}
      <div className="flex flex-wrap items-center gap-2">
        <Button className="h-12 sm:h-11 flex-1 sm:flex-none gap-2 text-base sm:text-sm bg-red-600 hover:bg-red-500 text-white" onClick={() => setModalOpen(true)}>
          <Plus className="h-5 w-5 sm:h-4 sm:w-4" />Registrar parada
        </Button>
        <BotaoAtualizar onClick={load} loading={loading} className="h-12 w-12 sm:h-11 sm:w-11" />
        <Segmentado className="w-full sm:w-auto sm:ml-auto overflow-x-auto" cheio ariaLabel="Período" valor={periodo} onChange={setPeriodo}
          opcoes={[{ v: "hoje", l: "Hoje" }, { v: "7d", l: "7 dias" }, { v: "30d", l: "30 dias" }, { v: "todas", l: "Todas" }]} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Paradas agora" Icon={OctagonPause} value={ativas.length} tom={ativas.length ? "ruim" : "ok"}
          sub={ativas.length ? `${ativas.filter(p => p.tipo === "nao_planejada").length} não planejada(s)` : "todas produzindo"} />
        <KpiCard label={`Tempo parado ${rotuloPeriodo}`} Icon={Clock} value={fmtHorasCurto(minPeriodo / 60)} tom={minPeriodo ? "atencao" : "neutro"}
          sub={`${doPeriodo.length} parada${doPeriodo.length === 1 ? "" : "s"}`} />
        <KpiCard label="Não planejado" Icon={AlertTriangle} value={fmtHorasCurto(minNaoPlan / 60)} tom={minNaoPlan ? "ruim" : "neutro"}
          sub={minPeriodo ? `${Math.round((minNaoPlan / minPeriodo) * 100)}% do tempo parado` : "—"} />
        <KpiCard label="Maior motivo" Icon={History} value={<span className="text-base sm:text-lg leading-tight block truncate">{porMotivo[0]?.motivo ?? "—"}</span>}
          sub={porMotivo[0] ? `${fmtHorasCurto(porMotivo[0].min / 60)} · ${porMotivo[0].n}×` : "sem paradas"} />
      </div>

      {/* Paradas em andamento */}
      {!loading && ativas.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />Em andamento</h3>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {ativas.map(p => <ParadaAtiva key={p.id} parada={p} onEncerrar={() => encerrar(p)} encerrando={encerrando === p.id} />)}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem] gap-4 items-start">
        {/* Histórico */}
        <section className="rounded-2xl border bg-card min-w-0 lg:order-1">
          <div className="p-3 border-b flex flex-wrap gap-2">
            <SearchInputWithBarcode className="flex-1 min-w-[10rem]" value={search} onChange={setSearch} onSearch={setSearch}
              placeholder="Bipe ou busque máquina, motivo, operador..." height="h-11" />
            <select value={maqFiltro} onChange={e => setMaqFiltro(e.target.value)} aria-label="Máquina" className={cn(selCls, "w-auto")}>
              <option value="">Todas as máquinas</option>
              {maquinas.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          {loading ? <Carregando /> : historico.length === 0 ? (
            <Vazio Icon={OctagonPause} titulo={paradas.length === 0 ? "Nenhuma parada registrada" : `Nenhuma parada encerrada ${rotuloPeriodo}`}
              dica={paradas.length === 0 ? "Quando uma máquina parar, toque em “Registrar parada”." : "Troque o período ou a busca para ver outras paradas."} />
          ) : (
            <>
              <ul className="md:hidden divide-y">
                {historico.map(p => (
                  <li key={p.id} className="px-4 py-3 flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm"><strong>{p.maquina}</strong> · {p.motivo}</p>
                      <p className="text-xs text-muted-foreground">{fmtQuando(p.inicio)} · {p.operador}</p>
                      {p.observacoes && <p className="text-xs text-muted-foreground italic truncate">“{p.observacoes}”</p>}
                    </div>
                    <div className="text-right shrink-0 space-y-1">
                      <p className="font-bold tabular-nums">{fmtHorasCurto((p.duracao_min ?? 0) / 60)}</p>
                      <TipoChip tipo={p.tipo} />
                    </div>
                    {podeMexer(p) && <Button size="icon" variant="ghost" className="h-10 w-10 -mr-2 shrink-0" aria-label="Corrigir parada" onClick={() => setEditar(p)}><Pencil className="h-4 w-4" /></Button>}
                  </li>
                ))}
              </ul>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50"><tr className="text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2.5 font-semibold">Início</th><th className="px-3 py-2.5 font-semibold">Máquina</th>
                    <th className="px-3 py-2.5 font-semibold">Motivo</th><th className="px-3 py-2.5 font-semibold">Tipo</th>
                    <th className="px-3 py-2.5 font-semibold">Operador</th><th className="px-3 py-2.5 font-semibold text-right">Duração</th>
                    <th className="px-3 py-2.5 w-12" />
                  </tr></thead>
                  <tbody>
                    {historico.map(p => (
                      <tr key={p.id} className="border-t">
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums">{fmtQuando(p.inicio)}</td>
                        <td className="px-3 py-2 font-semibold">{p.maquina}</td>
                        <td className="px-3 py-2 max-w-[16rem]"><p className="truncate">{p.motivo}</p>{p.observacoes && <p className="text-xs text-muted-foreground truncate">“{p.observacoes}”</p>}</td>
                        <td className="px-3 py-2"><TipoChip tipo={p.tipo} /></td>
                        <td className="px-3 py-2 text-muted-foreground">{p.operador}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmtHorasCurto((p.duracao_min ?? 0) / 60)}</td>
                        <td className="px-1 py-1">{podeMexer(p) && <Button size="icon" variant="ghost" className="h-9 w-9" aria-label="Corrigir parada" onClick={() => setEditar(p)}><Pencil className="h-4 w-4" /></Button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        {/* Motivos */}
        <Secao titulo={`Motivos ${rotuloPeriodo}`} Icon={Clock} className="lg:order-2">
          {porMotivo.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">Nenhuma parada no período. 👍</p> : (
            <ul className="space-y-3">
              {porMotivo.map(m => (
                <li key={m.motivo} className="text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate">{m.motivo}</span>
                    <span className="shrink-0 tabular-nums"><strong>{fmtHorasCurto(m.min / 60)}</strong><span className="text-xs text-muted-foreground"> · {m.n}×</span></span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-amber-500" style={{ width: `${(m.min / maxMotivo) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </Secao>
      </div>

      <NovaParadaDialog open={modalOpen} onClose={() => setModalOpen(false)} onSaved={p => setParadas(prev => [p, ...prev])}
        maquinas={maquinas} maquinasParadas={maquinasParadas} />
      <EditarParadaDialog parada={editar} maquinas={maquinas} podeExcluir={!!editar && podeMexer(editar)}
        onClose={() => setEditar(null)} onSaved={() => { setEditar(null); load(); }} />
    </div>
  );
}
