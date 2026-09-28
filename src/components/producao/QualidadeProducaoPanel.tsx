/**
 * QualidadeProducaoPanel — Aba "Refugo": ficha de peças refugadas.
 * ✓ Supabase (refugos_producao) com fallback offline (IndexedDB)
 * ✓ Ficha com medições dimensionais (nominal × medido × tolerância)
 * ✓ Correção por quem registrou ou pela produção (RLS ref_update);
 *   exclusão só admin (RLS ref_delete).
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, ShieldAlert, Trash2, Pencil, Loader2, CheckCircle2, Recycle, Ban, Undo2, X, Ruler } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { SearchInputWithBarcode } from "@/components/SearchInputWithBarcode";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { temPapel } from "@/types/roles";
import { PecaCombobox, type PecaOption } from "@/components/producao/PecaCombobox";
import { KpiCard, Secao, Carregando, Vazio, BotaoAtualizar, Confirmar, Campo, Segmentado, selCls, fmtInt } from "@/components/producao/ProducaoUI";

type TipoDefeito = "dimensional" | "superficial" | "material" | "montagem" | "outro";
type Destinacao = "retrabalho" | "sucata" | "devolucao";
interface Medicao { campo: string; nominal: number; medido: number; tolerancia: number; }

interface Refugo {
  id: string; produto: string; lote: string; maquina: string;
  operador: string; tipo_defeito: TipoDefeito; motivo: string;
  quantidade: number; destinacao: Destinacao;
  medicoes: Medicao[];
  observacoes?: string | null; user_id?: string | null; created_at?: string;
}

const DEFEITO_LABEL: Record<TipoDefeito, string> = {
  dimensional: "Dimensional", superficial: "Superficial / Acabamento",
  material: "Problema de Material", montagem: "Erro de Montagem", outro: "Outro",
};
const DESTINACAO_LABEL: Record<Destinacao, string> = { retrabalho: "Retrabalho", sucata: "Sucata", devolucao: "Devolução ao Fornec." };
const DESTINACAO_COLOR: Record<Destinacao, string> = {
  retrabalho: "text-amber-700 dark:text-amber-400 bg-amber-500/10", sucata: "text-red-700 dark:text-red-400 bg-red-500/10", devolucao: "text-blue-700 dark:text-blue-400 bg-blue-500/10",
};
const MOTIVOS_DEFEITO = [
  "Fora de tolerância", "Arranhão / Risco", "Quebra de ferramenta",
  "Material com defeito", "Setup incorreto", "Desgaste de ferramenta",
  "Erro de medição", "Vibração / Trepidação", "Contaminação",
];
const OPERADOR_KEY = "diario_producao_operador";
const lerOperador = () => { try { return localStorage.getItem(OPERADOR_KEY) ?? ""; } catch { return ""; } };
const gravarOperador = (v: string) => { try { localStorage.setItem(OPERADOR_KEY, v); } catch { /* sem armazenamento */ } };
const dec = (s: string) => s.replace(/[^\d.,-]/g, "").replace(",", ".");
type Periodo = "7d" | "30d" | "todas";

const foraTol = (m: Medicao) => Math.abs(m.medido - m.nominal) > (m.tolerancia || 0);

function RefugoDialog({ open, refugo, onClose, onSaved, maquinas, pecas }: {
  open: boolean; refugo: Refugo | null; onClose: () => void; onSaved: (r: Refugo) => void; maquinas: string[]; pecas: PecaOption[];
}) {
  const { saveWithFallback } = useOfflineSync();
  const { user } = useAuth();
  const vazio = { produto: "", lote: "", maquina: "", operador: "", tipo_defeito: "dimensional" as TipoDefeito, motivo: "", quantidade: "", destinacao: "retrabalho" as Destinacao, observacoes: "" };
  const [form, setForm] = useState(vazio);
  const [pecaCod, setPecaCod] = useState("");
  const [medicoes, setMedicoes] = useState<{ campo: string; nominal: string; medido: string; tolerancia: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (refugo) {
      setForm({ produto: refugo.produto, lote: refugo.lote, maquina: refugo.maquina, operador: refugo.operador, tipo_defeito: refugo.tipo_defeito,
        motivo: refugo.motivo, quantidade: String(refugo.quantidade), destinacao: refugo.destinacao, observacoes: refugo.observacoes ?? "" });
      const cod = pecas.find(p => refugo.produto === p.codigo || refugo.produto.startsWith(`${p.codigo} `))?.codigo ?? "";
      setPecaCod(cod);
      setMedicoes((refugo.medicoes ?? []).map(m => ({ campo: m.campo, nominal: String(m.nominal), medido: String(m.medido), tolerancia: String(m.tolerancia ?? "") })));
    } else {
      setForm({ ...vazio, operador: lerOperador() });
      setPecaCod("");
      setMedicoes([]);
    }
  }, [open, refugo]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof typeof form, v: string) => setForm(p => ({ ...p, [k]: v }));
  const qtd = parseInt(form.quantidade) || 0;
  const escolherPeca = (cod: string) => {
    setPecaCod(cod);
    const p = pecas.find(x => x.codigo === cod);
    // Mesmo formato que já era gravado: "CÓDIGO descrição".
    if (p) set("produto", `${p.codigo} ${p.descricao}`);
  };

  async function save() {
    if (!form.produto.trim() || !form.maquina || !form.operador.trim() || !form.motivo || qtd <= 0) {
      toast.error("Preencha peça, máquina, operador, motivo e quantidade."); return;
    }
    setSaving(true);
    const data: Refugo = {
      id: refugo?.id ?? crypto.randomUUID(), produto: form.produto.trim(), lote: form.lote.trim() || refugo?.lote || `LOT-${Date.now()}`,
      maquina: form.maquina, operador: form.operador.trim(), tipo_defeito: form.tipo_defeito,
      motivo: form.motivo, quantidade: qtd, destinacao: form.destinacao,
      medicoes: medicoes.filter(m => m.campo && m.nominal && m.medido).map(m => ({
        campo: m.campo, nominal: Number(m.nominal), medido: Number(m.medido), tolerancia: Number(m.tolerancia) || 0,
      })),
      observacoes: form.observacoes.trim() || undefined,
      user_id: refugo ? refugo.user_id : user?.id, created_at: refugo?.created_at ?? new Date().toISOString(),
    };
    const { data: saved, error, savedOffline } = await saveWithFallback("refugos_producao", "refugos", refugo ? "UPDATE" : "INSERT", data);
    setSaving(false);
    if (error) { toast.error("Não foi possível salvar o refugo."); return; }
    gravarOperador(form.operador.trim());
    toast.success(savedOffline ? "Sem internet — salvo no aparelho." : refugo ? "Refugo corrigido." : "Refugo registrado.");
    onSaved(saved || data); onClose();
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{refugo ? "Corrigir refugo" : "Registrar refugo"}</DialogTitle>
          <DialogDescription>Peças perdidas ou para retrabalho, com o motivo e as medições (se houver).</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Campo label="Peça *">
            {pecas.length > 0 ? (
              <>
                <PecaCombobox pecas={pecas} value={pecaCod} onChange={escolherPeca} placeholder="Buscar peça por código ou nome..." />
                {!pecaCod && form.produto && <p className="text-xs text-muted-foreground mt-1">Atual: {form.produto}</p>}
              </>
            ) : <Input value={form.produto} onChange={e => set("produto", e.target.value)} placeholder="Código e nome da peça" className="h-11" />}
          </Campo>
          <Campo label="Máquina *">
            {maquinas.length > 0 ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {maquinas.map(m => (
                  <button key={m} type="button" onClick={() => set("maquina", m)} aria-pressed={form.maquina === m}
                    className={cn("h-11 rounded-xl border-2 text-sm font-bold transition-colors", form.maquina === m ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/40")}>{m}</button>
                ))}
              </div>
            ) : <Input value={form.maquina} onChange={e => set("maquina", e.target.value)} placeholder="Máquina" className="h-11" />}
          </Campo>
          <Campo label="Quantidade refugada *">
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="icon" className="h-12 w-12 text-lg" onClick={() => set("quantidade", String(Math.max(0, qtd - 1)))} aria-label="Menos">−</Button>
              <Input inputMode="numeric" value={form.quantidade} onChange={e => set("quantidade", e.target.value.replace(/\D/g, ""))} placeholder="0"
                className="h-12 flex-1 text-center text-xl font-bold tabular-nums" aria-label="Quantidade" />
              <Button type="button" variant="outline" size="icon" className="h-12 w-12 text-lg" onClick={() => set("quantidade", String(qtd + 1))} aria-label="Mais">+</Button>
            </div>
          </Campo>
          <Campo label="Motivo *">
            <div className="grid grid-cols-2 gap-2">
              {MOTIVOS_DEFEITO.map(m => (
                <button key={m} type="button" onClick={() => set("motivo", m)} aria-pressed={form.motivo === m}
                  className={cn("min-h-[2.75rem] rounded-xl border-2 px-3 py-1.5 text-left text-sm font-medium leading-tight transition-colors",
                    form.motivo === m ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/40")}>{m}</button>
              ))}
            </div>
          </Campo>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Campo label="Tipo de defeito">
              <select value={form.tipo_defeito} onChange={e => set("tipo_defeito", e.target.value)} className={selCls}>
                {Object.entries(DEFEITO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Campo>
            <Campo label="Lote (opcional)"><Input value={form.lote} onChange={e => set("lote", e.target.value)} className="h-11" /></Campo>
          </div>
          <Campo label="Destino">
            <Segmentado cheio ariaLabel="Destino das peças" valor={form.destinacao} onChange={d => set("destinacao", d)}
              opcoes={[{ v: "retrabalho", l: "Retrabalho" }, { v: "sucata", l: "Sucata" }, { v: "devolucao", l: "Devolução" }]} />
          </Campo>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><Ruler className="h-3.5 w-3.5" />Medições</span>
              <Button type="button" size="sm" variant="ghost" className="h-9 gap-1" onClick={() => setMedicoes(p => [...p, { campo: "", nominal: "", medido: "", tolerancia: "" }])}><Plus className="h-4 w-4" />Adicionar</Button>
            </div>
            {medicoes.map((m, i) => {
              const upd = (k: keyof typeof m, v: string) => setMedicoes(prev => prev.map((x, j) => j === i ? { ...x, [k]: v } : x));
              const fora = m.nominal && m.medido && Math.abs(Number(m.medido) - Number(m.nominal)) > (Number(m.tolerancia) || 0);
              return (
                <div key={i} className={cn("rounded-xl border p-2 grid grid-cols-[1fr_auto] gap-2", fora && "border-red-500/40 bg-red-500/5")}>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <Input placeholder="Cota (ex.: Ø)" value={m.campo} onChange={e => upd("campo", e.target.value)} className="h-11 col-span-2 sm:col-span-1" aria-label="Cota" />
                    <Input placeholder="Nominal" inputMode="decimal" value={m.nominal} onChange={e => upd("nominal", dec(e.target.value))} className="h-11 tabular-nums" aria-label="Nominal" />
                    <Input placeholder="Medido" inputMode="decimal" value={m.medido} onChange={e => upd("medido", dec(e.target.value))} className={cn("h-11 tabular-nums", fora && "text-red-600 font-semibold")} aria-label="Medido" />
                    <Input placeholder="± Tol." inputMode="decimal" value={m.tolerancia} onChange={e => upd("tolerancia", dec(e.target.value))} className="h-11 tabular-nums col-span-2 sm:col-span-1" aria-label="Tolerância" />
                  </div>
                  <Button type="button" variant="ghost" size="icon" className="h-11 w-11 text-muted-foreground hover:text-destructive" aria-label="Remover medição"
                    onClick={() => setMedicoes(p => p.filter((_, j) => j !== i))}><X className="h-4 w-4" /></Button>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Campo label="Operador *"><Input value={form.operador} onChange={e => set("operador", e.target.value)} placeholder="Seu nome" className="h-11" autoComplete="name" /></Campo>
            <Campo label="Observação"><Input value={form.observacoes} onChange={e => set("observacoes", e.target.value)} placeholder="Opcional" className="h-11" /></Campo>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button className="h-11 gap-1.5" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {refugo ? "Salvar correção" : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function QualidadeProducaoPanel() {
  const { user, role, isAdmin } = useAuth();
  const gestor = temPapel(role, "producao");
  const [refugos, setRefugos] = useState<Refugo[]>([]);
  const [maquinas, setMaquinas] = useState<string[]>([]);
  const [pecas, setPecas] = useState<PecaOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<{ open: boolean; refugo: Refugo | null }>({ open: false, refugo: null });
  const [excluir, setExcluir] = useState<Refugo | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const [search, setSearch] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>("30d");
  const { loadWithFallback, saveWithFallback } = useOfflineSync();

  const load = useCallback(async () => {
    setLoading(true);
    const data = await loadWithFallback<Refugo>("refugos_producao", "refugos");
    setRefugos([...data].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")));
    if (navigator.onLine) {
      const [{ data: maq }, { data: prod }] = await Promise.all([
        supabase.from("maquinas_producao").select("codigo").order("codigo"),
        supabase.from("produtos_producao").select("codigo,descricao,pecas_por_hora").eq("ativo", true).order("codigo"),
      ]);
      if (maq) setMaquinas(maq.map((m: { codigo: string }) => m.codigo));
      if (prod) setPecas(prod.map(p => ({ codigo: p.codigo, descricao: p.descricao, pecas_por_hora: p.pecas_por_hora ?? 0, origem: "producao" as const })));
    }
    setLoading(false);
  }, [loadWithFallback]);

  useEffect(() => { load(); }, [load]);

  async function confirmarExclusao() {
    if (!excluir) return;
    setExcluindo(true);
    const { error } = await saveWithFallback("refugos_producao", "refugos", "DELETE", { id: excluir.id } as Refugo);
    setExcluindo(false);
    if (error) { toast.error("Não foi possível remover o registro."); return; }
    setRefugos(prev => prev.filter(r => r.id !== excluir.id));
    toast.success("Registro removido.");
    setExcluir(null);
  }

  const desde = useMemo(() => {
    if (periodo === "todas") return "";
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (periodo === "7d" ? 6 : 29));
    return d.toISOString();
  }, [periodo]);
  const doPeriodo = refugos.filter(r => !desde || (r.created_at ?? "") >= desde);
  const q = search.trim().toLowerCase();
  const filtered = doPeriodo.filter(r => !q || [r.produto, r.lote, r.maquina, r.operador, r.motivo].some(v => (v ?? "").toLowerCase().includes(q)));
  const soma = (f: (r: Refugo) => boolean) => doPeriodo.filter(f).reduce((s, r) => s + (r.quantidade || 0), 0);
  const total = soma(() => true);

  const porMotivo = useMemo(() => {
    const m = new Map<string, number>();
    doPeriodo.forEach(r => m.set(r.motivo, (m.get(r.motivo) ?? 0) + (r.quantidade || 0)));
    return [...m.entries()].map(([nome, v]) => ({ nome, v })).sort((a, b) => b.v - a.v).slice(0, 6);
  }, [doPeriodo]);
  const porDefeito = useMemo(() => {
    const m = new Map<string, number>();
    doPeriodo.forEach(r => { const k = DEFEITO_LABEL[r.tipo_defeito] ?? r.tipo_defeito; m.set(k, (m.get(k) ?? 0) + (r.quantidade || 0)); });
    return [...m.entries()].map(([nome, v]) => ({ nome, v })).sort((a, b) => b.v - a.v);
  }, [doPeriodo]);

  const podeEditar = (r: Refugo) => gestor || (!!user && r.user_id === user.id);
  const quando = (iso?: string) => iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
  const Barras = ({ itens, cor }: { itens: { nome: string; v: number }[]; cor: string }) => {
    const max = itens[0]?.v || 1;
    return itens.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">Nenhum refugo no período. 👍</p> : (
      <ul className="space-y-3">
        {itens.map(i => (
          <li key={i.nome} className="text-sm">
            <div className="flex justify-between gap-2"><span className="truncate">{i.nome}</span><strong className="tabular-nums shrink-0">{fmtInt(i.v)} pç</strong></div>
            <div className="mt-1 h-2 rounded-full bg-muted overflow-hidden"><div className={cn("h-full rounded-full", cor)} style={{ width: `${(i.v / max) * 100}%` }} /></div>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="flex flex-wrap items-center gap-2">
        <Button className="h-12 sm:h-11 flex-1 sm:flex-none gap-2 text-base sm:text-sm" onClick={() => setDialog({ open: true, refugo: null })}>
          <Plus className="h-5 w-5 sm:h-4 sm:w-4" />Registrar refugo
        </Button>
        <BotaoAtualizar onClick={load} loading={loading} className="h-12 w-12 sm:h-11 sm:w-11" />
        <Segmentado className="w-full sm:w-auto sm:ml-auto" cheio ariaLabel="Período" valor={periodo} onChange={setPeriodo}
          opcoes={[{ v: "7d", l: "7 dias" }, { v: "30d", l: "30 dias" }, { v: "todas", l: "Tudo" }]} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Peças refugadas" Icon={ShieldAlert} value={fmtInt(total)} tom={total ? "ruim" : "ok"} sub={`${doPeriodo.length} registro${doPeriodo.length === 1 ? "" : "s"}`} />
        <KpiCard label="Retrabalho" Icon={Recycle} value={fmtInt(soma(r => r.destinacao === "retrabalho"))} tom="atencao" sub="podem voltar à linha" />
        <KpiCard label="Sucata" Icon={Ban} value={fmtInt(soma(r => r.destinacao === "sucata"))} tom={soma(r => r.destinacao === "sucata") ? "ruim" : "neutro"} sub="perda definitiva" />
        <KpiCard label="Devolução" Icon={Undo2} value={fmtInt(soma(r => r.destinacao === "devolucao"))} sub="ao fornecedor" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem] gap-4 items-start">
        <section className="rounded-2xl border bg-card min-w-0">
          <div className="p-3 border-b">
            <SearchInputWithBarcode value={search} onChange={setSearch} onSearch={setSearch} placeholder="Bipe ou busque peça, lote, máquina, motivo..." height="h-11" />
          </div>
          {loading ? <Carregando /> : filtered.length === 0 ? (
            <Vazio Icon={ShieldAlert} titulo={refugos.length === 0 ? "Nenhum refugo registrado" : "Nenhum refugo no período/busca"}
              dica="Registre as peças perdidas para acompanhar os motivos e a qualidade." />
          ) : (
            <>
              <ul className="md:hidden divide-y">
                {filtered.map(r => (
                  <li key={r.id} className="px-4 py-3 space-y-1.5">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate">{r.produto}</p>
                        <p className="text-xs text-muted-foreground">{r.maquina} · {r.operador} · {quando(r.created_at)}</p>
                      </div>
                      <p className="font-bold text-red-600 tabular-nums shrink-0">{fmtInt(r.quantidade)} pç</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", DESTINACAO_COLOR[r.destinacao])}>{DESTINACAO_LABEL[r.destinacao]}</span>
                      <span className="text-xs text-muted-foreground">{r.motivo} · {DEFEITO_LABEL[r.tipo_defeito]}</span>
                      <div className="ml-auto flex -mr-2">
                        {podeEditar(r) && <Button size="icon" variant="ghost" className="h-10 w-10" aria-label="Corrigir refugo" onClick={() => setDialog({ open: true, refugo: r })}><Pencil className="h-4 w-4" /></Button>}
                        {isAdmin && <Button size="icon" variant="ghost" className="h-10 w-10 text-destructive" aria-label="Excluir refugo" onClick={() => setExcluir(r)}><Trash2 className="h-4 w-4" /></Button>}
                      </div>
                    </div>
                    {r.medicoes?.length > 0 && (
                      <div className="rounded-xl bg-muted/40 px-3 py-2 space-y-0.5">
                        {r.medicoes.map((m, i) => (
                          <p key={i} className="text-xs flex justify-between gap-2"><span className="text-muted-foreground">{m.campo}</span>
                            <span className="tabular-nums">{m.nominal} ± {m.tolerancia} → <b className={foraTol(m) ? "text-red-600" : "text-green-600"}>{m.medido}</b></span></p>
                        ))}
                      </div>
                    )}
                    {r.observacoes && <p className="text-xs text-muted-foreground italic">“{r.observacoes}”</p>}
                  </li>
                ))}
              </ul>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50"><tr className="text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2.5 font-semibold">Quando</th><th className="px-3 py-2.5 font-semibold">Peça / lote</th>
                    <th className="px-3 py-2.5 font-semibold">Máquina</th><th className="px-3 py-2.5 font-semibold">Motivo</th>
                    <th className="px-3 py-2.5 font-semibold">Destino</th><th className="px-3 py-2.5 font-semibold text-right">Qtd</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Ações</th>
                  </tr></thead>
                  <tbody>
                    {filtered.map(r => (
                      <tr key={r.id} className="border-t align-top">
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums text-muted-foreground">{quando(r.created_at)}</td>
                        <td className="px-3 py-2 max-w-[16rem]"><p className="font-medium truncate">{r.produto}</p><p className="text-xs text-muted-foreground font-mono truncate">{r.lote}</p>
                          {r.medicoes?.length > 0 && <p className="text-xs"><span className={r.medicoes.some(foraTol) ? "text-red-600" : "text-muted-foreground"}>{r.medicoes.length} medição(ões){r.medicoes.some(foraTol) ? " · fora de tolerância" : ""}</span></p>}</td>
                        <td className="px-3 py-2"><p className="font-semibold">{r.maquina}</p><p className="text-xs text-muted-foreground">{r.operador}</p></td>
                        <td className="px-3 py-2"><p>{r.motivo}</p><p className="text-xs text-muted-foreground">{DEFEITO_LABEL[r.tipo_defeito]}</p></td>
                        <td className="px-3 py-2"><span className={cn("rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", DESTINACAO_COLOR[r.destinacao])}>{DESTINACAO_LABEL[r.destinacao]}</span></td>
                        <td className="px-3 py-2 text-right font-bold text-red-600 tabular-nums">{fmtInt(r.quantidade)}</td>
                        <td className="px-3 py-1.5"><div className="flex justify-end gap-1">
                          {podeEditar(r) && <Button size="icon" variant="ghost" className="h-9 w-9" aria-label="Corrigir refugo" onClick={() => setDialog({ open: true, refugo: r })}><Pencil className="h-4 w-4" /></Button>}
                          {isAdmin && <Button size="icon" variant="ghost" className="h-9 w-9 text-destructive" aria-label="Excluir refugo" onClick={() => setExcluir(r)}><Trash2 className="h-4 w-4" /></Button>}
                        </div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
        <div className="space-y-4">
          <Secao titulo="Principais motivos" Icon={ShieldAlert}><Barras itens={porMotivo} cor="bg-red-500" /></Secao>
          <Secao titulo="Por tipo de defeito" Icon={Ruler}><Barras itens={porDefeito} cor="bg-orange-500" /></Secao>
        </div>
      </div>

      <RefugoDialog open={dialog.open} refugo={dialog.refugo} maquinas={maquinas} pecas={pecas}
        onClose={() => setDialog({ open: false, refugo: null })}
        onSaved={r => setRefugos(prev => dialog.refugo ? prev.map(x => x.id === r.id ? r : x) : [r, ...prev])} />
      <Confirmar aberto={!!excluir} titulo="Excluir este registro de refugo?" carregando={excluindo}
        descricao={excluir ? `${excluir.quantidade} pç de ${excluir.produto}.` : undefined}
        onConfirmar={confirmarExclusao} onCancelar={() => setExcluir(null)} />
    </div>
  );
}
