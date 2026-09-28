/**
 * MaquinasPanel — Cadastro e situação das máquinas.
 * ✓ Supabase (maquinas_producao) com fallback offline (IndexedDB)
 * ✓ Troca rápida de situação (operando / parada / manutenção / setup)
 * ✓ Aviso de manutenção vencida ou próxima
 * Escrita: admin/produção/gerente (RLS maq_insert/maq_update); exclusão só admin.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, Settings2, Wrench, CheckCircle2, XCircle, Pencil, Trash2, Loader2, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { SearchInputWithBarcode } from "@/components/SearchInputWithBarcode";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { KpiCard, Carregando, Vazio, BotaoAtualizar, Confirmar, Campo, selCls, hojeISO } from "@/components/producao/ProducaoUI";

type StatusMaquina = "operando" | "parada" | "manutencao" | "setup";
type SetorMaquina = "usinagem" | "montagem" | "acabamento" | "estamparia" | "soldagem";

interface Maquina {
  id: string; codigo: string; nome: string;
  setor: SetorMaquina; status: StatusMaquina;
  disponibilidade: number;
  ultima_manutencao?: string; proxima_manutencao?: string;
  horimetro?: number; fabricante?: string; modelo?: string;
  created_at?: string; updated_at?: string;
}

const STATUS_CFG: Record<StatusMaquina, { label: string; chip: string; dot: string; Icon: React.ElementType }> = {
  operando:   { label: "Operando",   chip: "bg-green-500/10 text-green-700 dark:text-green-400", dot: "bg-green-500", Icon: CheckCircle2 },
  parada:     { label: "Parada",     chip: "bg-red-500/10 text-red-700 dark:text-red-400",       dot: "bg-red-500",   Icon: XCircle },
  manutencao: { label: "Manutenção", chip: "bg-amber-500/10 text-amber-700 dark:text-amber-400", dot: "bg-amber-500", Icon: Wrench },
  setup:      { label: "Setup",      chip: "bg-blue-500/10 text-blue-700 dark:text-blue-400",    dot: "bg-blue-500",  Icon: Settings2 },
};
const STATUS_LISTA = Object.keys(STATUS_CFG) as StatusMaquina[];
const SETORES: SetorMaquina[] = ["usinagem", "montagem", "acabamento", "estamparia", "soldagem"];
const SETOR_LABEL: Record<SetorMaquina, string> = { usinagem: "Usinagem", montagem: "Montagem", acabamento: "Acabamento", estamparia: "Estamparia", soldagem: "Soldagem" };

const fmtData = (iso?: string) => iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—";
function situacaoManut(m: Maquina): "vencida" | "proxima" | null {
  if (!m.proxima_manutencao) return null;
  const hoje = hojeISO();
  if (m.proxima_manutencao.slice(0, 10) < hoje) return "vencida";
  const em7 = new Date(); em7.setDate(em7.getDate() + 7);
  return new Date(`${m.proxima_manutencao.slice(0, 10)}T12:00:00`) <= em7 ? "proxima" : null;
}

const StatusChip = ({ s }: { s: StatusMaquina }) => {
  const c = STATUS_CFG[s] ?? STATUS_CFG.operando;
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", c.chip)}><c.Icon className="h-3 w-3" />{c.label}</span>;
};
const ManutChip = ({ m }: { m: Maquina }) => {
  const s = situacaoManut(m);
  if (!s) return null;
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
    s === "vencida" ? "bg-red-500/10 text-red-700 dark:text-red-400" : "bg-amber-500/10 text-amber-700 dark:text-amber-400")}>
    <CalendarClock className="h-3 w-3" />{s === "vencida" ? "Manutenção vencida" : "Manutenção em breve"}</span>;
};

function MaquinaDialog({ open, maquina, onClose, onSaved }: {
  open: boolean; maquina?: Maquina; onClose: () => void; onSaved: (m: Maquina) => void;
}) {
  const [form, setForm] = useState({ codigo: "", nome: "", setor: "usinagem" as SetorMaquina, fabricante: "", modelo: "", horimetro: "", ultima_manutencao: "", proxima_manutencao: "" });
  const [saving, setSaving] = useState(false);
  const { saveWithFallback } = useOfflineSync();
  const isEdit = !!maquina;

  useEffect(() => {
    if (open) setForm({
      codigo: maquina?.codigo || "", nome: maquina?.nome || "",
      setor: maquina?.setor || "usinagem", fabricante: maquina?.fabricante || "",
      modelo: maquina?.modelo || "", horimetro: maquina?.horimetro != null ? String(maquina.horimetro) : "",
      ultima_manutencao: maquina?.ultima_manutencao?.slice(0, 10) || "", proxima_manutencao: maquina?.proxima_manutencao?.slice(0, 10) || "",
    });
  }, [open, maquina]);

  async function save() {
    if (!form.codigo.trim() || !form.nome.trim()) { toast.error("Código e nome são obrigatórios."); return; }
    setSaving(true);
    const data: Maquina = {
      id: maquina?.id || crypto.randomUUID(), codigo: form.codigo.trim().toUpperCase(), nome: form.nome.trim(),
      setor: form.setor, status: maquina?.status || "operando",
      disponibilidade: maquina?.disponibilidade || 100,
      fabricante: form.fabricante.trim() || undefined, modelo: form.modelo.trim() || undefined,
      horimetro: form.horimetro ? Number(form.horimetro) : undefined,
      ultima_manutencao: form.ultima_manutencao || undefined,
      proxima_manutencao: form.proxima_manutencao || undefined,
    };
    const { data: saved, error, savedOffline } = await saveWithFallback("maquinas_producao", "maquinas", isEdit ? "UPDATE" : "INSERT", data);
    setSaving(false);
    if (error) { toast.error("Não foi possível salvar a máquina."); return; }
    toast.success(savedOffline ? "Sem internet — salvo no aparelho." : isEdit ? "Máquina atualizada." : "Máquina cadastrada.");
    onSaved(saved || data); onClose();
  }

  const set = (k: keyof typeof form, v: string) => setForm(p => ({ ...p, [k]: v }));
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Editar ${maquina?.codigo}` : "Nova máquina"}</DialogTitle>
          <DialogDescription>O código aparece nos lançamentos, no planejamento e nos gráficos.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Código *"><Input value={form.codigo} onChange={e => set("codigo", e.target.value)} placeholder="MQ001" className="h-11 uppercase" /></Campo>
            <Campo label="Setor">
              <select value={form.setor} onChange={e => set("setor", e.target.value)} className={selCls}>
                {SETORES.map(s => <option key={s} value={s}>{SETOR_LABEL[s]}</option>)}
              </select>
            </Campo>
          </div>
          <Campo label="Nome *"><Input value={form.nome} onChange={e => set("nome", e.target.value)} placeholder="Ex.: Torno CNC 16CSBIII" className="h-11" /></Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Fabricante"><Input value={form.fabricante} onChange={e => set("fabricante", e.target.value)} placeholder="Ex.: Romi" className="h-11" /></Campo>
            <Campo label="Modelo"><Input value={form.modelo} onChange={e => set("modelo", e.target.value)} placeholder="Ex.: D800" className="h-11" /></Campo>
          </div>
          <Campo label="Horímetro (h)"><Input inputMode="numeric" value={form.horimetro} onChange={e => set("horimetro", e.target.value.replace(/[^\d]/g, ""))} placeholder="0" className="h-11 tabular-nums" /></Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Última manutenção"><Input type="date" value={form.ultima_manutencao} onChange={e => set("ultima_manutencao", e.target.value)} className="h-11" /></Campo>
            <Campo label="Próxima manutenção"><Input type="date" value={form.proxima_manutencao} onChange={e => set("proxima_manutencao", e.target.value)} className="h-11" /></Campo>
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

export function MaquinasPanel({ isAdmin, canWrite }: { isAdmin: boolean; canWrite?: boolean }) {
  const canEdit = canWrite ?? isAdmin;
  const [maquinas, setMaquinas] = useState<Maquina[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<"todos" | StatusMaquina>("todos");
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Maquina | undefined>();
  const [excluir, setExcluir] = useState<Maquina | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const { saveWithFallback, loadWithFallback } = useOfflineSync();

  const load = useCallback(async () => {
    setLoading(true);
    const data = await loadWithFallback<Maquina>("maquinas_producao", "maquinas");
    setMaquinas([...data].sort((a, b) => a.codigo.localeCompare(b.codigo)));
    setLoading(false);
  }, [loadWithFallback]);

  useEffect(() => { load(); }, [load]);

  async function handleStatusChange(m: Maquina, status: StatusMaquina) {
    if (m.status === status) return;
    const updated = { ...m, status };
    setMaquinas(prev => prev.map(x => x.id === m.id ? updated : x));
    const { error, savedOffline } = await saveWithFallback("maquinas_producao", "maquinas", "UPDATE", updated);
    if (error) { toast.error("Não foi possível mudar a situação."); setMaquinas(prev => prev.map(x => x.id === m.id ? m : x)); return; }
    toast.success(savedOffline ? "Sem internet — salvo no aparelho." : `${m.codigo}: ${STATUS_CFG[status].label}.`);
  }

  async function confirmarExclusao() {
    if (!excluir) return;
    setExcluindo(true);
    const { error } = await saveWithFallback("maquinas_producao", "maquinas", "DELETE", { id: excluir.id } as Maquina);
    setExcluindo(false);
    if (error) { toast.error("Não foi possível remover a máquina."); return; }
    setMaquinas(prev => prev.filter(m => m.id !== excluir.id));
    toast.success("Máquina removida.");
    setExcluir(null);
  }

  const q = search.trim().toLowerCase();
  const filtered = maquinas.filter(m =>
    (!q || [m.codigo, m.nome, m.fabricante || "", m.modelo || ""].some(v => v.toLowerCase().includes(q))) &&
    (filtroStatus === "todos" || m.status === filtroStatus));
  const counts = useMemo(() => {
    const c: Record<StatusMaquina, number> = { operando: 0, parada: 0, manutencao: 0, setup: 0 };
    maquinas.forEach(m => { if (c[m.status] !== undefined) c[m.status]++; });
    return c;
  }, [maquinas]);
  const manutVencidas = maquinas.filter(m => situacaoManut(m) === "vencida").length;

  const seletorStatus = (m: Maquina, grande = false) => (
    <div className={cn("grid grid-cols-4 gap-1 rounded-xl border bg-muted/40 p-1", grande ? "w-full" : "w-[21rem]")} role="radiogroup" aria-label={`Situação de ${m.codigo}`}>
      {STATUS_LISTA.map(s => (
        <button key={s} type="button" role="radio" aria-checked={m.status === s} onClick={() => handleStatusChange(m, s)}
          className={cn("rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-colors", grande ? "h-10" : "h-8",
            m.status === s ? cn("bg-card shadow-sm", STATUS_CFG[s].chip) : "text-muted-foreground hover:text-foreground")}>
          <span className={cn("h-2 w-2 rounded-full shrink-0", STATUS_CFG[s].dot)} />{STATUS_CFG[s].label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {STATUS_LISTA.map(s => (
          <KpiCard key={s} label={STATUS_CFG[s].label} Icon={STATUS_CFG[s].Icon} value={counts[s]}
            tom={s === "operando" ? "ok" : s === "parada" && counts[s] ? "ruim" : s === "manutencao" && counts[s] ? "atencao" : "neutro"}
            ativo={filtroStatus === s} onClick={() => setFiltroStatus(f => f === s ? "todos" : s)}
            sub={filtroStatus === s ? "toque para ver todas" : s === "manutencao" && manutVencidas ? `${manutVencidas} com manutenção vencida` : undefined}
            subTom={s === "manutencao" && manutVencidas && filtroStatus !== s ? "ruim" : undefined} />
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <SearchInputWithBarcode className="flex-1 min-w-[12rem]" value={search} onChange={setSearch} onSearch={setSearch} placeholder="Bipe ou busque código, nome, fabricante..." height="h-11" />
        <BotaoAtualizar onClick={load} loading={loading} />
        {canEdit && <Button className="h-11 gap-1.5" onClick={() => { setEditTarget(undefined); setModalOpen(true); }}><Plus className="h-4 w-4" />Nova máquina</Button>}
      </div>

      <section className="rounded-2xl border bg-card overflow-hidden">
        {loading ? <Carregando /> : filtered.length === 0 ? (
          <Vazio Icon={Settings2} titulo={maquinas.length === 0 ? "Nenhuma máquina cadastrada" : "Nenhuma máquina encontrada"}
            dica={maquinas.length === 0 ? "Cadastre as máquinas para usá-las nos lançamentos e no planejamento." : "Limpe a busca ou o filtro de situação."}
            acao={canEdit && maquinas.length === 0 ? <Button className="h-11 gap-1.5" onClick={() => { setEditTarget(undefined); setModalOpen(true); }}><Plus className="h-4 w-4" />Cadastrar máquina</Button> : undefined} />
        ) : (
          <>
            <ul className="md:hidden divide-y">
              {filtered.map(m => (
                <li key={m.id} className="p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <span className={cn("mt-1.5 h-2.5 w-2.5 rounded-full shrink-0", (STATUS_CFG[m.status] ?? STATUS_CFG.operando).dot)} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{m.codigo} <span className="font-normal text-muted-foreground">· {SETOR_LABEL[m.setor] ?? m.setor}</span></p>
                      <p className="text-sm text-muted-foreground truncate">{m.nome}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">{!canEdit && <StatusChip s={m.status} />}<ManutChip m={m} /></div>
                    </div>
                    <div className="flex -mr-2 shrink-0">
                      {canEdit && <Button size="icon" variant="ghost" className="h-10 w-10" aria-label={`Editar ${m.codigo}`} onClick={() => { setEditTarget(m); setModalOpen(true); }}><Pencil className="h-4 w-4" /></Button>}
                      {isAdmin && <Button size="icon" variant="ghost" className="h-10 w-10 text-destructive" aria-label={`Excluir ${m.codigo}`} onClick={() => setExcluir(m)}><Trash2 className="h-4 w-4" /></Button>}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div><p className="text-muted-foreground">Fabricante</p><p className="font-medium truncate">{m.fabricante ? `${m.fabricante}${m.modelo ? ` ${m.modelo}` : ""}` : "—"}</p></div>
                    <div><p className="text-muted-foreground">Horímetro</p><p className="font-medium tabular-nums">{m.horimetro != null ? `${m.horimetro.toLocaleString("pt-BR")} h` : "—"}</p></div>
                    <div><p className="text-muted-foreground">Próx. manut.</p><p className="font-medium tabular-nums">{fmtData(m.proxima_manutencao)}</p></div>
                  </div>
                  {canEdit && seletorStatus(m, true)}
                </li>
              ))}
            </ul>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50"><tr className="text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2.5 font-semibold">Máquina</th><th className="px-3 py-2.5 font-semibold">Setor</th>
                  <th className="px-3 py-2.5 font-semibold">Fabricante / modelo</th><th className="px-3 py-2.5 font-semibold text-right">Horímetro</th>
                  <th className="px-3 py-2.5 font-semibold">Manutenção</th><th className="px-3 py-2.5 font-semibold">Situação</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Ações</th>
                </tr></thead>
                <tbody>
                  {filtered.map(m => (
                    <tr key={m.id} className="border-t align-middle">
                      <td className="px-3 py-2.5"><p className="font-semibold">{m.codigo}</p><p className="text-xs text-muted-foreground truncate max-w-[14rem]">{m.nome}</p></td>
                      <td className="px-3 py-2.5">{SETOR_LABEL[m.setor] ?? m.setor}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{m.fabricante ? `${m.fabricante}${m.modelo ? ` · ${m.modelo}` : ""}` : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{m.horimetro != null ? `${m.horimetro.toLocaleString("pt-BR")} h` : "—"}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <p className="text-xs text-muted-foreground">última {fmtData(m.ultima_manutencao)}</p>
                        <p className="text-xs">próxima <strong className="tabular-nums">{fmtData(m.proxima_manutencao)}</strong></p>
                        <ManutChip m={m} />
                      </td>
                      <td className="px-3 py-2.5">{canEdit ? seletorStatus(m) : <StatusChip s={m.status} />}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-1">
                          {canEdit && <Button size="icon" variant="ghost" className="h-9 w-9" aria-label={`Editar ${m.codigo}`} onClick={() => { setEditTarget(m); setModalOpen(true); }}><Pencil className="h-4 w-4" /></Button>}
                          {/* Excluir: RLS maq_delete permite só admin */}
                          {isAdmin && <Button size="icon" variant="ghost" className="h-9 w-9 text-destructive" aria-label={`Excluir ${m.codigo}`} onClick={() => setExcluir(m)}><Trash2 className="h-4 w-4" /></Button>}
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

      <MaquinaDialog open={modalOpen} maquina={editTarget} onClose={() => setModalOpen(false)}
        onSaved={m => setMaquinas(prev => (editTarget ? prev.map(x => x.id === m.id ? m : x) : [...prev, m]).sort((a, b) => a.codigo.localeCompare(b.codigo)))} />
      <Confirmar aberto={!!excluir} titulo={`Remover ${excluir?.codigo ?? "máquina"}?`} carregando={excluindo}
        descricao="Os lançamentos antigos continuam com o código da máquina, mas ela sai das listas de escolha."
        onConfirmar={confirmarExclusao} onCancelar={() => setExcluir(null)} />
    </div>
  );
}
