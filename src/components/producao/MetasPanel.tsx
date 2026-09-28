/**
 * MetasPanel — Desempenho → Metas.
 * Metas do mês (geral e por máquina: OEE, disponibilidade, qualidade e peças)
 * comparadas com o realizado (calcular_oee), e a meta de OEE do semestre.
 * Quem é admin/produção/gerente cria, altera e exclui metas (RLS metas_write).
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { Target, Plus, CheckCircle2, AlertTriangle, Pencil, Trash2, Loader2, ChevronLeft, ChevronRight, Factory } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { untypedRpc } from "@/lib/untypedRpc";
import { friendlyError } from "@/lib/errorMessages";
import { useAuth } from "@/hooks/useAuth";
import { temPapel } from "@/types/roles";
import {
  Secao, Carregando, Vazio, BotaoAtualizar, BarraMeta, Segmentado, Confirmar, Campo, selCls, fmtInt, fmtPct1,
  TOM_TXT, tomPct,
} from "@/components/producao/ProducaoUI";

// Anos do filtro: de 2024 até o ano seguinte ao atual.
const ANOS_DISPONIVEIS = Array.from({ length: new Date().getFullYear() - 2024 + 2 }, (_, i) => 2024 + i);
const MESES_LONGOS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

interface Meta { id: string; mes: number; ano: number; maquina_codigo: string | null; meta_pecas: number; meta_oee_pct: number; meta_disponibilidade_pct: number; meta_qualidade_pct: number; }
interface OEEReal { oee: number; disponibilidade: number; performance: number; qualidade: number; qtde_produzida: number; }

/**
 * Meta SEMESTRAL de OEE — armazenada na mesma tabela metas_producao (sem
 * migration nova), usando a convenção:
 *   maquina_codigo = 'SEMESTRE'  e  mes = 1 (1º sem) ou 7 (2º sem).
 * O campo meta_oee_pct guarda a meta de OEE do semestre (padrão 85%).
 * A UNIQUE(mes, ano, maquina_codigo) do banco garante 1 meta por semestre/ano.
 */
export const META_SEMESTRE_CODIGO = "SEMESTRE";
export function periodoSemestre(sem: 1 | 2, ano: number) {
  return sem === 1
    ? { ini: `${ano}-01-01`, fim: `${ano}-06-30` }
    : { ini: `${ano}-07-01`, fim: `${ano}-12-31` };
}

const num = (v: unknown) => Number(v) || 0;
const lerOee = (o: unknown): OEEReal | null => {
  if (!o || typeof o !== "object") return null;
  const x = o as Record<string, unknown>;
  return { oee: num(x.oee), disponibilidade: num(x.disponibilidade), performance: num(x.performance), qualidade: num(x.qualidade), qtde_produzida: num(x.qtde_produzida) };
};
const pctValido = (s: string) => { const v = parseFloat(s.replace(",", ".")); return v > 0 && v <= 100 ? v : null; };

// ── Diálogo de meta do mês ───────────────────────────────────────────────────
function MetaDialog({ open, meta, mes, ano, maquinas, metas, onClose, onSaved }: {
  open: boolean; meta: Meta | null; mes: number; ano: number; maquinas: string[]; metas: Meta[];
  onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({ maquina_codigo: "", meta_pecas: "", meta_oee_pct: "85", meta_disponibilidade_pct: "90", meta_qualidade_pct: "98" });
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(meta ? {
      maquina_codigo: meta.maquina_codigo ?? "", meta_pecas: meta.meta_pecas ? String(meta.meta_pecas) : "",
      meta_oee_pct: String(meta.meta_oee_pct), meta_disponibilidade_pct: String(meta.meta_disponibilidade_pct), meta_qualidade_pct: String(meta.meta_qualidade_pct),
    } : { maquina_codigo: "", meta_pecas: "", meta_oee_pct: "85", meta_disponibilidade_pct: "90", meta_qualidade_pct: "98" });
  }, [open, meta]);

  // Se já existe meta para a máquina escolhida no mês, a gravação atualiza essa (sem duplicar).
  const existente = meta ?? metas.find(m => (m.maquina_codigo ?? "") === form.maquina_codigo) ?? null;
  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));

  async function salvar() {
    const oee = pctValido(form.meta_oee_pct), disp = pctValido(form.meta_disponibilidade_pct), qual = pctValido(form.meta_qualidade_pct);
    if (oee === null || disp === null || qual === null) { toast.error("As metas em % precisam estar entre 1 e 100."); return; }
    setSalvando(true);
    const campos = {
      meta_pecas: parseInt(form.meta_pecas) || 0, meta_oee_pct: oee, meta_disponibilidade_pct: disp, meta_qualidade_pct: qual,
    };
    const { error } = existente
      ? await supabase.from("metas_producao").update(campos).eq("id", existente.id)
      : await supabase.from("metas_producao").insert({ mes, ano, maquina_codigo: form.maquina_codigo || null, ...campos });
    setSalvando(false);
    if (error) { toast.error(friendlyError(error, "Não foi possível salvar a meta.")); return; }
    toast.success("Meta salva.");
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{meta ? "Alterar meta" : "Nova meta"} — {MESES_LONGOS[mes - 1]}/{ano}</DialogTitle>
          <DialogDescription>Deixe “Geral” para valer para a fábrica toda, ou escolha uma máquina.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Campo label="Para">
            <select value={form.maquina_codigo} onChange={e => set("maquina_codigo", e.target.value)} className={selCls} disabled={!!meta}>
              <option value="">Geral (todas as máquinas)</option>
              {maquinas.map(m => <option key={m} value={m}>Máquina {m}</option>)}
            </select>
          </Campo>
          {!meta && existente && (
            <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">Já existe meta para {form.maquina_codigo ? `a máquina ${form.maquina_codigo}` : "a fábrica"} neste mês — ela será substituída.</p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Campo label="OEE (%)"><Input inputMode="decimal" value={form.meta_oee_pct} onChange={e => set("meta_oee_pct", e.target.value)} className="h-11 text-base tabular-nums" /></Campo>
            <Campo label="Disponibilidade (%)"><Input inputMode="decimal" value={form.meta_disponibilidade_pct} onChange={e => set("meta_disponibilidade_pct", e.target.value)} className="h-11 text-base tabular-nums" /></Campo>
            <Campo label="Qualidade (%)"><Input inputMode="decimal" value={form.meta_qualidade_pct} onChange={e => set("meta_qualidade_pct", e.target.value)} className="h-11 text-base tabular-nums" /></Campo>
            <Campo label="Peças no mês"><Input inputMode="numeric" value={form.meta_pecas} onChange={e => set("meta_pecas", e.target.value.replace(/\D/g, ""))} placeholder="opcional" className="h-11 text-base tabular-nums" /></Campo>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button className="h-11 gap-1.5" onClick={salvar} disabled={salvando}>
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Salvar meta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MetasPanel() {
  const { role } = useAuth();
  const podeEditar = temPapel(role, "producao");
  const now = new Date();
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [ano, setAno] = useState(now.getFullYear());
  const [metas, setMetas] = useState<Meta[]>([]);
  const [oeeReal, setOeeReal] = useState<OEEReal | null>(null);
  const [realMaq, setRealMaq] = useState<Map<string, OEEReal>>(new Map());
  const [maquinas, setMaquinas] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<{ open: boolean; meta: Meta | null }>({ open: false, meta: null });
  const [excluir, setExcluir] = useState<Meta | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  // ── Meta semestral ───────────────────────────────────────────────────────
  const semAtual: 1 | 2 = now.getMonth() + 1 <= 6 ? 1 : 2;
  const [semestre, setSemestre] = useState<1 | 2>(semAtual);
  const [metaSemestre, setMetaSemestre] = useState<Meta | null>(null);
  const [realSemestre, setRealSemestre] = useState<OEEReal | null>(null);
  const [metaSemInput, setMetaSemInput] = useState("85");
  const [salvandoSem, setSalvandoSem] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const ini = `${ano}-${String(mes).padStart(2, "0")}-01`;
    const fim = `${ano}-${String(mes).padStart(2, "0")}-${String(new Date(ano, mes, 0).getDate()).padStart(2, "0")}`;
    const per = periodoSemestre(semestre, ano);
    const [{ data: m }, { data: oee }, { data: maq }, { data: ms }, { data: oeeSem }] = await Promise.all([
      supabase.from("metas_producao").select("*").eq("mes", mes).eq("ano", ano).order("maquina_codigo"),
      untypedRpc("calcular_oee", { p_data_ini: ini, p_data_fim: fim, p_maquina: null }),
      supabase.from("maquinas_producao").select("codigo").order("codigo"),
      supabase.from("metas_producao").select("*").eq("ano", ano).eq("mes", semestre === 1 ? 1 : 7).eq("maquina_codigo", META_SEMESTRE_CODIGO).maybeSingle(),
      untypedRpc("calcular_oee", { p_data_ini: per.ini, p_data_fim: per.fim, p_maquina: null }),
    ]);
    // A linha 'SEMESTRE' é uma convenção interna — não aparece na lista mensal.
    const doMes = ((m ?? []) as Meta[]).filter(x => x.maquina_codigo !== META_SEMESTRE_CODIGO);
    setMetas(doMes);
    setOeeReal(lerOee(oee));
    setMaquinas(((maq ?? []) as { codigo: string }[]).map(x => x.codigo));
    setMetaSemestre((ms as Meta | null) ?? null);
    if (ms) setMetaSemInput(String((ms as Meta).meta_oee_pct));
    setRealSemestre(lerOee(oeeSem));
    // Realizado por máquina, só para as máquinas que têm meta.
    const comMaq = doMes.filter(x => x.maquina_codigo).map(x => x.maquina_codigo!) ;
    const reais = await Promise.all(comMaq.map(c => untypedRpc("calcular_oee", { p_data_ini: ini, p_data_fim: fim, p_maquina: c })));
    const mapa = new Map<string, OEEReal>();
    comMaq.forEach((c, i) => { const r = lerOee(reais[i].data); if (r) mapa.set(c, r); });
    setRealMaq(mapa);
    setLoading(false);
  }, [mes, ano, semestre]);

  useEffect(() => { load(); }, [load]);

  async function salvarMetaSemestre() {
    const pct = pctValido(metaSemInput);
    if (pct === null) { toast.error("Informe uma porcentagem entre 1 e 100."); return; }
    setSalvandoSem(true);
    const { error } = await supabase.from("metas_producao").upsert({
      mes: semestre === 1 ? 1 : 7, ano, maquina_codigo: META_SEMESTRE_CODIGO,
      meta_pecas: 0, meta_oee_pct: pct, meta_disponibilidade_pct: pct, meta_qualidade_pct: pct,
    }, { onConflict: "mes,ano,maquina_codigo" });
    setSalvandoSem(false);
    if (error) { toast.error(friendlyError(error, "Não foi possível salvar a meta.")); return; }
    toast.success(`Meta do ${semestre}º semestre/${ano} salva: ${pct}%`);
    load();
  }

  async function confirmarExclusao() {
    if (!excluir) return;
    setExcluindo(true);
    const { error } = await supabase.from("metas_producao").delete().eq("id", excluir.id);
    setExcluindo(false);
    if (error) { toast.error(friendlyError(error, "Não foi possível excluir a meta.")); return; }
    toast.success("Meta excluída.");
    setExcluir(null); load();
  }

  function mudarMes(delta: number) {
    const d = new Date(ano, mes - 1 + delta, 1);
    if (!ANOS_DISPONIVEIS.includes(d.getFullYear())) return;
    setMes(d.getMonth() + 1); setAno(d.getFullYear());
  }

  const metaGeral = metas.find(m => !m.maquina_codigo);
  const metasOrdenadas = useMemo(() => [...metas].sort((a, b) => (a.maquina_codigo ?? "").localeCompare(b.maquina_codigo ?? "")), [metas]);
  const nomeMes = `${MESES_LONGOS[mes - 1]}/${ano}`;

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Período + ação */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl border bg-card p-1">
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => mudarMes(-1)} aria-label="Mês anterior"><ChevronLeft className="h-4 w-4" /></Button>
          <select value={mes} onChange={e => setMes(Number(e.target.value))} aria-label="Mês" className="h-9 rounded-lg bg-transparent px-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-ring">
            {MESES_LONGOS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select value={ano} onChange={e => setAno(Number(e.target.value))} aria-label="Ano" className="h-9 rounded-lg bg-transparent px-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-ring">
            {ANOS_DISPONIVEIS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => mudarMes(1)} aria-label="Próximo mês"><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <BotaoAtualizar onClick={load} loading={loading} />
        {podeEditar && (
          <Button className="h-11 gap-1.5 ml-auto" onClick={() => setDialog({ open: true, meta: null })}><Plus className="h-4 w-4" />Nova meta</Button>
        )}
      </div>

      {loading ? (
        <div className="rounded-2xl border bg-card"><Carregando /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Realizado × meta do mês (geral) */}
            <Secao titulo={`Realizado × meta — ${nomeMes}`} Icon={Target}
              acao={metaGeral && podeEditar ? <Button size="sm" variant="ghost" className="h-9" onClick={() => setDialog({ open: true, meta: metaGeral })}><Pencil className="h-4 w-4 mr-1" />Alterar</Button> : undefined}>
              {!oeeReal ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Sem produção lançada neste mês.</p>
              ) : metaGeral ? (
                <div className="space-y-4">
                  <BarraMeta label="OEE" real={oeeReal.oee} meta={metaGeral.meta_oee_pct} />
                  <BarraMeta label="Disponibilidade" real={oeeReal.disponibilidade} meta={metaGeral.meta_disponibilidade_pct} />
                  <BarraMeta label="Qualidade" real={oeeReal.qualidade} meta={metaGeral.meta_qualidade_pct} />
                  {metaGeral.meta_pecas > 0 && <BarraMeta label="Peças produzidas" real={oeeReal.qtde_produzida} meta={metaGeral.meta_pecas} fmt={fmtInt} />}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[{ l: "OEE", v: oeeReal.oee }, { l: "Disponib.", v: oeeReal.disponibilidade }, { l: "Qualidade", v: oeeReal.qualidade }].map(k => (
                      <div key={k.l} className="rounded-xl bg-muted/40 px-2 py-2">
                        <p className="text-[11px] text-muted-foreground">{k.l}</p>
                        <p className={cn("text-lg font-bold tabular-nums", TOM_TXT[tomPct(k.v)])}>{fmtPct1(k.v)}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-sm text-muted-foreground">Ainda não há meta geral para {nomeMes}.</p>
                  {podeEditar && <Button variant="outline" className="h-11 w-full gap-1.5" onClick={() => setDialog({ open: true, meta: null })}><Plus className="h-4 w-4" />Definir meta do mês</Button>}
                </div>
              )}
            </Secao>

            {/* Meta de OEE do semestre */}
            <Secao titulo="Meta de OEE do semestre" Icon={Target}
              acao={<Segmentado ariaLabel="Semestre" valor={semestre} onChange={setSemestre} opcoes={[{ v: 1, l: "1º" }, { v: 2, l: "2º" }]} />}>
              <div className="space-y-4">
                {(() => {
                  const real = realSemestre?.oee ?? 0;
                  const alvo = metaSemestre?.meta_oee_pct ?? 0;
                  return alvo > 0 ? (
                    <BarraMeta label={`OEE real (${semestre}º sem/${ano})`} real={real} meta={alvo}
                      dica={realSemestre ? `${fmtInt(realSemestre.qtde_produzida)} peças no período · todas as máquinas` : undefined} />
                  ) : (
                    <p className="text-sm text-muted-foreground">Nenhuma meta para o {semestre}º semestre de {ano}{podeEditar ? " — defina abaixo." : "."}</p>
                  );
                })()}
                {podeEditar && (
                  <form className="flex items-end gap-2" onSubmit={e => { e.preventDefault(); salvarMetaSemestre(); }}>
                    <Campo label="Meta de OEE (%)" className="flex-1">
                      <Input inputMode="decimal" value={metaSemInput} onChange={e => setMetaSemInput(e.target.value)} className="h-11 text-base tabular-nums" />
                    </Campo>
                    <Button type="submit" className="h-11" disabled={salvandoSem}>
                      {salvandoSem ? <Loader2 className="h-4 w-4 animate-spin" /> : metaSemestre ? "Atualizar" : "Definir"}
                    </Button>
                  </form>
                )}
              </div>
            </Secao>
          </div>

          {/* Todas as metas do mês */}
          <section className="rounded-2xl border bg-card">
            <div className="px-4 py-3 border-b flex items-center gap-2">
              <Factory className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm flex-1">Metas de {nomeMes}</h3>
              <span className="text-xs text-muted-foreground">{metas.length} meta{metas.length === 1 ? "" : "s"}</span>
            </div>
            {metas.length === 0 ? (
              <Vazio Icon={Target} titulo={`Nenhuma meta para ${nomeMes}`} dica="Defina a meta geral da fábrica e, se quiser, uma para cada máquina."
                acao={podeEditar ? <Button className="h-11 gap-1.5" onClick={() => setDialog({ open: true, meta: null })}><Plus className="h-4 w-4" />Nova meta</Button> : undefined} />
            ) : (
              <ul className="divide-y">
                {metasOrdenadas.map(m => {
                  const real = m.maquina_codigo ? realMaq.get(m.maquina_codigo) : oeeReal;
                  const ok = real ? real.oee >= m.meta_oee_pct : null;
                  return (
                    <li key={m.id} className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                      <div className="min-w-[8rem] flex-1">
                        <p className="text-sm font-semibold">{m.maquina_codigo ? `Máquina ${m.maquina_codigo}` : "Geral (fábrica)"}</p>
                        {real ? (
                          <p className={cn("text-xs font-medium flex items-center gap-1", ok ? TOM_TXT.ok : TOM_TXT.ruim)}>
                            {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                            OEE real {fmtPct1(real.oee)}
                          </p>
                        ) : <p className="text-xs text-muted-foreground">sem produção no mês</p>}
                      </div>
                      <div className="grid grid-cols-4 gap-3 text-center sm:text-right text-sm tabular-nums order-last sm:order-none w-full sm:w-auto">
                        <div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">OEE</p><p className="font-bold">{fmtPct1(m.meta_oee_pct)}</p></div>
                        <div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Disp.</p><p className="font-bold">{fmtPct1(m.meta_disponibilidade_pct)}</p></div>
                        <div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Qual.</p><p className="font-bold">{fmtPct1(m.meta_qualidade_pct)}</p></div>
                        <div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Peças</p><p className="font-bold">{m.meta_pecas ? fmtInt(m.meta_pecas) : "—"}</p></div>
                      </div>
                      {podeEditar && (
                        <div className="flex items-center gap-1 shrink-0">
                          <Button size="icon" variant="ghost" className="h-10 w-10" aria-label="Alterar meta" onClick={() => setDialog({ open: true, meta: m })}><Pencil className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" className="h-10 w-10 text-destructive" aria-label="Excluir meta" onClick={() => setExcluir(m)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      <MetaDialog open={dialog.open} meta={dialog.meta} mes={mes} ano={ano} maquinas={maquinas} metas={metas}
        onClose={() => setDialog({ open: false, meta: null })}
        onSaved={() => { setDialog({ open: false, meta: null }); load(); }} />
      <Confirmar aberto={!!excluir} titulo="Excluir meta?" carregando={excluindo}
        descricao={excluir ? `A meta ${excluir.maquina_codigo ? `da máquina ${excluir.maquina_codigo}` : "geral"} de ${nomeMes} será apagada.` : undefined}
        onConfirmar={confirmarExclusao} onCancelar={() => setExcluir(null)} />
    </div>
  );
}
