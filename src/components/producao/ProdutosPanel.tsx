/**
 * ProdutosPanel — Cadastro de peças da produção (produtos_producao).
 * ✓ Supabase com fallback offline (IndexedDB)
 * ✓ Mostra o ritmo REAL aprendido pelos lançamentos (tempo_peca_padrao) ao
 *   lado do cadastrado, com atalho para usar o real no cadastro.
 * Escrita: admin/produção/gerente (RLS prod_insert/prod_update); exclusão só admin.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, Package, Pencil, Trash2, Loader2, CheckCircle2, TrendingUp, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { SearchInputWithBarcode } from "@/components/SearchInputWithBarcode";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { supabase } from "@/integrations/supabase/client";
import { Carregando, Vazio, BotaoAtualizar, Confirmar, Campo, Segmentado, selCls } from "@/components/producao/ProducaoUI";

type TipoMaterial = "aco_inox" | "aco_carbono" | "aluminio" | "latao" | "polimero" | "outro";

interface Produto {
  id: string; codigo: string; descricao: string;
  tempo_ciclo_seg: number; pecas_por_hora: number;
  tipo_material: TipoMaterial; lead_time_dias: number;
  dim_comprimento?: number; dim_largura?: number;
  dim_altura?: number; dim_diametro?: number;
  peso_gramas?: number; ativo: boolean;
  created_at?: string; updated_at?: string;
}
interface Ritmo { ph: number; amostras: number; }

const MATERIAL_LABEL: Record<TipoMaterial, string> = {
  aco_inox: "Aço Inox", aco_carbono: "Aço Carbono", aluminio: "Alumínio",
  latao: "Latão", polimero: "Polímero", outro: "Outro",
};
const num = (s: string) => s.replace(/[^\d.,]/g, "").replace(",", ".");
const fmtPh = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

function ProdutoDialog({ open, produto, ritmo, onClose, onSaved }: {
  open: boolean; produto?: Produto; ritmo?: Ritmo; onClose: () => void; onSaved: (p: Produto) => void;
}) {
  const { saveWithFallback } = useOfflineSync();
  const isEdit = !!produto;
  const vazio = { codigo: "", descricao: "", tempo_ciclo_seg: "", pecas_por_hora: "", tipo_material: "aco_carbono" as TipoMaterial, lead_time_dias: "", dim_comprimento: "", dim_largura: "", dim_altura: "", dim_diametro: "", peso_gramas: "" };
  const [form, setForm] = useState(vazio);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const s = (v?: number) => (v ? String(v) : "");
    setForm(produto ? {
      codigo: produto.codigo, descricao: produto.descricao, tempo_ciclo_seg: s(produto.tempo_ciclo_seg), pecas_por_hora: s(produto.pecas_por_hora),
      tipo_material: produto.tipo_material || "aco_carbono", lead_time_dias: s(produto.lead_time_dias),
      dim_comprimento: s(produto.dim_comprimento), dim_largura: s(produto.dim_largura), dim_altura: s(produto.dim_altura),
      dim_diametro: s(produto.dim_diametro), peso_gramas: s(produto.peso_gramas),
    } : vazio);
  }, [open, produto]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof typeof form, v: string) => setForm(p => ({ ...p, [k]: v }));
  // Ciclo e peças/hora andam juntos: preencher um sugere o outro.
  const setCiclo = (v: string) => setForm(p => ({ ...p, tempo_ciclo_seg: v, pecas_por_hora: Number(v) > 0 ? String(Math.round(3600 / Number(v))) : p.pecas_por_hora }));
  const setPh = (v: string) => setForm(p => ({ ...p, pecas_por_hora: v, tempo_ciclo_seg: Number(v) > 0 ? String(Math.round(3600 / Number(v))) : p.tempo_ciclo_seg }));

  async function save() {
    if (!form.codigo.trim() || !form.descricao.trim() || !(Number(form.tempo_ciclo_seg) > 0)) { toast.error("Código, descrição e tempo de ciclo são obrigatórios."); return; }
    setSaving(true);
    const tempoCiclo = Number(form.tempo_ciclo_seg);
    const opt = (v: string) => (v ? Number(v) : undefined);
    const data: Produto = {
      id: produto?.id || crypto.randomUUID(), codigo: form.codigo.trim().toUpperCase(), descricao: form.descricao.trim(),
      tempo_ciclo_seg: tempoCiclo,
      pecas_por_hora: Number(form.pecas_por_hora) || Math.round(3600 / tempoCiclo),
      tipo_material: form.tipo_material,
      lead_time_dias: Number(form.lead_time_dias) || 0,
      dim_comprimento: opt(form.dim_comprimento), dim_largura: opt(form.dim_largura),
      dim_altura: opt(form.dim_altura), dim_diametro: opt(form.dim_diametro), peso_gramas: opt(form.peso_gramas),
      ativo: produto?.ativo ?? true,
    };
    const { data: saved, error, savedOffline } = await saveWithFallback("produtos_producao", "produtos_producao", isEdit ? "UPDATE" : "INSERT", data);
    setSaving(false);
    if (error) { toast.error("Não foi possível salvar a peça."); return; }
    toast.success(savedOffline ? "Sem internet — salvo no aparelho." : isEdit ? "Peça atualizada." : "Peça cadastrada.");
    onSaved(saved || data); onClose();
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Editar ${produto?.codigo}` : "Nova peça"}</DialogTitle>
          <DialogDescription>O ritmo (peças/hora) é usado para calcular o planejado e a performance.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-3">
            <Campo label="Código *"><Input value={form.codigo} onChange={e => set("codigo", e.target.value)} placeholder="CP-1020" className="h-11 uppercase" /></Campo>
            <Campo label="Descrição *"><Input value={form.descricao} onChange={e => set("descricao", e.target.value)} placeholder="Parafuso cortical 2.0" className="h-11" /></Campo>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Tempo de ciclo (s) *"><Input inputMode="decimal" value={form.tempo_ciclo_seg} onChange={e => setCiclo(num(e.target.value))} placeholder="60" className="h-11 tabular-nums" /></Campo>
            <Campo label="Peças/hora"><Input inputMode="decimal" value={form.pecas_por_hora} onChange={e => setPh(num(e.target.value))} placeholder="auto" className="h-11 tabular-nums" /></Campo>
          </div>
          {ritmo && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm flex flex-wrap items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <span className="flex-1 min-w-[12rem]">Ritmo real: <strong>{fmtPh(ritmo.ph)} pç/h</strong> <span className="text-muted-foreground">({ritmo.amostras} lançamentos)</span></span>
              <Button type="button" size="sm" variant="outline" className="h-9" onClick={() => setPh(String(Math.round(ritmo.ph * 10) / 10))}>Usar este</Button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Material">
              <select value={form.tipo_material} onChange={e => set("tipo_material", e.target.value)} className={selCls}>
                {Object.entries(MATERIAL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Campo>
            <Campo label="Lead time (dias)"><Input inputMode="numeric" value={form.lead_time_dias} onChange={e => set("lead_time_dias", e.target.value.replace(/\D/g, ""))} placeholder="0" className="h-11 tabular-nums" /></Campo>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Campo label="Diâmetro (mm)"><Input inputMode="decimal" value={form.dim_diametro} onChange={e => set("dim_diametro", num(e.target.value))} className="h-11 tabular-nums" /></Campo>
            <Campo label="Compr. (mm)"><Input inputMode="decimal" value={form.dim_comprimento} onChange={e => set("dim_comprimento", num(e.target.value))} className="h-11 tabular-nums" /></Campo>
            <Campo label="Peso (g)"><Input inputMode="decimal" value={form.peso_gramas} onChange={e => set("peso_gramas", num(e.target.value))} className="h-11 tabular-nums" /></Campo>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button className="h-11 gap-1.5" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProdutosPanel({ isAdmin, canWrite }: { isAdmin: boolean; canWrite?: boolean }) {
  const canEdit = canWrite ?? isAdmin;
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [ritmos, setRitmos] = useState<Map<string, Ritmo>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filtro, setFiltro] = useState<"ativos" | "inativos" | "todos">("ativos");
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Produto | undefined>();
  const [excluir, setExcluir] = useState<Produto | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const { saveWithFallback, loadWithFallback } = useOfflineSync();

  const load = useCallback(async () => {
    setLoading(true);
    const [data, tempos] = await Promise.all([
      loadWithFallback<Produto>("produtos_producao", "produtos_producao"),
      navigator.onLine ? supabase.from("tempo_peca_padrao").select("produto,pecas_hora,amostras").eq("maquina", "*") : Promise.resolve({ data: null }),
    ]);
    setProdutos([...data].sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true })));
    const r = new Map<string, Ritmo>();
    for (const t of (tempos.data ?? []) as { produto: string; pecas_hora: number | null; amostras: number }[]) {
      if (t.pecas_hora && t.pecas_hora > 0) r.set(t.produto, { ph: Number(t.pecas_hora), amostras: t.amostras });
    }
    setRitmos(r);
    setLoading(false);
  }, [loadWithFallback]);

  useEffect(() => { load(); }, [load]);

  async function handleToggleAtivo(p: Produto) {
    const updated = { ...p, ativo: !p.ativo };
    const { error, savedOffline } = await saveWithFallback("produtos_producao", "produtos_producao", "UPDATE", updated);
    if (error) { toast.error("Não foi possível atualizar."); return; }
    toast.success(savedOffline ? "Sem internet — salvo no aparelho." : `${p.codigo} ${updated.ativo ? "ativada" : "desativada"}.`);
    setProdutos(prev => prev.map(x => x.id === p.id ? updated : x));
  }

  async function confirmarExclusao() {
    if (!excluir) return;
    setExcluindo(true);
    const { error } = await saveWithFallback("produtos_producao", "produtos_producao", "DELETE", { id: excluir.id } as Produto);
    setExcluindo(false);
    if (error) { toast.error("Não foi possível remover a peça."); return; }
    setProdutos(prev => prev.filter(p => p.id !== excluir.id));
    toast.success("Peça removida.");
    setExcluir(null);
  }

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => produtos.filter(p =>
    (filtro === "todos" || (filtro === "ativos" ? p.ativo : !p.ativo)) &&
    (!q || [p.codigo, p.descricao].some(v => (v ?? "").toLowerCase().includes(q)))), [produtos, filtro, q]);
  const nAtivos = produtos.filter(p => p.ativo).length;

  const ritmoCell = (p: Produto) => {
    const r = ritmos.get(p.codigo);
    if (!r) return <span className="text-muted-foreground">—</span>;
    const dif = p.pecas_por_hora > 0 ? ((r.ph - p.pecas_por_hora) / p.pecas_por_hora) * 100 : 0;
    return (
      <span className="tabular-nums">
        {fmtPh(r.ph)}
        {Math.abs(dif) >= 10 && <span className={cn("ml-1 text-xs font-semibold", dif > 0 ? "text-green-600" : "text-red-600")}>{dif > 0 ? "+" : ""}{Math.round(dif)}%</span>}
      </span>
    );
  };
  const abrir = (p?: Produto) => { setEditTarget(p); setModalOpen(true); };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="flex flex-wrap gap-2">
        <SearchInputWithBarcode className="flex-1 min-w-[12rem]" value={search} onChange={setSearch} onSearch={setSearch} placeholder="Bipe ou busque código ou descrição..." height="h-11" />
        <BotaoAtualizar onClick={load} loading={loading} />
        {canEdit && <Button className="h-11 gap-1.5" onClick={() => abrir()}><Plus className="h-4 w-4" />Nova peça</Button>}
      </div>
      <Segmentado ariaLabel="Filtrar peças" valor={filtro} onChange={setFiltro} className="w-full sm:w-fit" cheio
        opcoes={[{ v: "ativos", l: "Ativas", n: nAtivos }, { v: "inativos", l: "Inativas", n: produtos.length - nAtivos }, { v: "todos", l: "Todas" }]} />

      <section className="rounded-2xl border bg-card overflow-hidden">
        {loading ? <Carregando /> : filtered.length === 0 ? (
          <Vazio Icon={Package} titulo={produtos.length === 0 ? "Nenhuma peça cadastrada" : "Nenhuma peça encontrada"}
            dica={produtos.length === 0 ? "As peças de Componentes também aparecem nos lançamentos; cadastre aqui para definir o ritmo (peças/hora)." : "Limpe a busca ou troque o filtro."}
            acao={canEdit && produtos.length === 0 ? <Button className="h-11 gap-1.5" onClick={() => abrir()}><Plus className="h-4 w-4" />Cadastrar peça</Button> : undefined} />
        ) : (
          <>
            <ul className="md:hidden divide-y">
              {filtered.map(p => (
                <li key={p.id} className={cn("px-4 py-3 flex items-start gap-3", !p.ativo && "opacity-60")}>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{p.codigo} {!p.ativo && <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Inativa</span>}</p>
                    <p className="text-sm text-muted-foreground truncate">{p.descricao}</p>
                    <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                      Cadastro <strong className="text-foreground">{fmtPh(p.pecas_por_hora)} pç/h</strong> · real {ritmoCell(p)} · ciclo {p.tempo_ciclo_seg}s · {MATERIAL_LABEL[p.tipo_material] ?? p.tipo_material}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex -mr-2 shrink-0">
                      <Button size="icon" variant="ghost" className="h-10 w-10" aria-label={`Editar ${p.codigo}`} onClick={() => abrir(p)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="h-10 w-10" aria-label={p.ativo ? `Desativar ${p.codigo}` : `Ativar ${p.codigo}`} title={p.ativo ? "Desativar" : "Ativar"} onClick={() => handleToggleAtivo(p)}><Power className={cn("h-4 w-4", p.ativo ? "text-green-600" : "text-muted-foreground")} /></Button>
                      {isAdmin && <Button size="icon" variant="ghost" className="h-10 w-10 text-destructive" aria-label={`Excluir ${p.codigo}`} onClick={() => setExcluir(p)}><Trash2 className="h-4 w-4" /></Button>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50"><tr className="text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2.5 font-semibold">Peça</th><th className="px-3 py-2.5 font-semibold">Material</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Ciclo</th><th className="px-3 py-2.5 font-semibold text-right">Pç/h cadastro</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Pç/h real</th><th className="px-3 py-2.5 font-semibold text-right">Lead time</th>
                  <th className="px-3 py-2.5 font-semibold">Situação</th><th className="px-3 py-2.5 font-semibold text-right">Ações</th>
                </tr></thead>
                <tbody>
                  {filtered.map(p => (
                    <tr key={p.id} className={cn("border-t", !p.ativo && "opacity-60")}>
                      <td className="px-3 py-2"><p className="font-semibold">{p.codigo}</p><p className="text-xs text-muted-foreground truncate max-w-[18rem]">{p.descricao}</p></td>
                      <td className="px-3 py-2 text-muted-foreground">{MATERIAL_LABEL[p.tipo_material] ?? p.tipo_material}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.tempo_ciclo_seg}s</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtPh(p.pecas_por_hora)}</td>
                      <td className="px-3 py-2 text-right">{ritmoCell(p)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.lead_time_dias ? `${p.lead_time_dias} d` : "—"}</td>
                      <td className="px-3 py-2">
                        {canEdit ? (
                          <button type="button" onClick={() => handleToggleAtivo(p)} className={cn("rounded-full px-2 py-0.5 text-xs font-medium", p.ativo ? "bg-green-500/10 text-green-700 dark:text-green-400" : "bg-muted text-muted-foreground")} title="Clique para ativar/desativar">
                            {p.ativo ? "Ativa" : "Inativa"}
                          </button>
                        ) : <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", p.ativo ? "bg-green-500/10 text-green-700 dark:text-green-400" : "bg-muted text-muted-foreground")}>{p.ativo ? "Ativa" : "Inativa"}</span>}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex justify-end gap-1">
                          {canEdit && <Button size="icon" variant="ghost" className="h-9 w-9" aria-label={`Editar ${p.codigo}`} onClick={() => abrir(p)}><Pencil className="h-4 w-4" /></Button>}
                          {/* Excluir: RLS prod_delete permite só admin */}
                          {isAdmin && <Button size="icon" variant="ghost" className="h-9 w-9 text-destructive" aria-label={`Excluir ${p.codigo}`} onClick={() => setExcluir(p)}><Trash2 className="h-4 w-4" /></Button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
      <p className="text-xs text-muted-foreground">“Pç/h real” é aprendido pelos lançamentos (mediana). Diferença grande do cadastro distorce a performance — ajuste o cadastro.</p>

      <ProdutoDialog open={modalOpen} produto={editTarget} ritmo={editTarget ? ritmos.get(editTarget.codigo) : undefined} onClose={() => setModalOpen(false)}
        onSaved={p => setProdutos(prev => (editTarget ? prev.map(x => x.id === p.id ? p : x) : [...prev, p]).sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true })))} />
      <Confirmar aberto={!!excluir} titulo={`Remover ${excluir?.codigo ?? "peça"}?`} carregando={excluindo}
        descricao="Prefira “desativar” se a peça já tem lançamentos — ela some das listas mas o histórico continua completo."
        onConfirmar={confirmarExclusao} onCancelar={() => setExcluir(null)} />
    </div>
  );
}
