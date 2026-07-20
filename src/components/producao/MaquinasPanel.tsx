/**
 * MaquinasPanel — Cadastro e Gestão de Máquinas
 * ✓ Dados reais via Supabase (tabela maquinas_producao)
 * ✓ Fallback offline com IndexedDB
 */

import { useState, useEffect, useCallback } from "react";
import { Plus, X, Search, Settings2, Wrench, CheckCircle2, AlertTriangle, XCircle, Filter, RefreshCw, Edit2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchInputWithBarcode } from "@/components/SearchInputWithBarcode";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { useTranslation } from "react-i18next";

type StatusMaquina = "operando"|"parada"|"manutencao"|"setup";
type SetorMaquina = "usinagem"|"montagem"|"acabamento"|"estamparia"|"soldagem";

interface Maquina {
  id: string; codigo: string; nome: string;
  setor: SetorMaquina; status: StatusMaquina;
  disponibilidade: number;
  ultima_manutencao?: string; proxima_manutencao?: string;
  horimetro?: number; fabricante?: string; modelo?: string;
  created_at?: string; updated_at?: string;
}

function buildStatusCfg(t: (k: string) => string): Record<StatusMaquina,{label:string;color:string;bg:string;Icon:React.ElementType}> {
  return {
  operando:   {label:t("maquinasPanel.status.operando"),   color:"text-green-500", bg:"bg-green-500/10",  Icon:CheckCircle2},
  parada:     {label:t("maquinasPanel.status.parada"),     color:"text-red-500",   bg:"bg-red-500/10",    Icon:XCircle},
  manutencao: {label:t("maquinasPanel.status.manutencao"), color:"text-amber-500", bg:"bg-amber-500/10",  Icon:Wrench},
  setup:      {label:t("maquinasPanel.status.setup"),      color:"text-blue-500",  bg:"bg-blue-500/10",   Icon:Settings2},
  };
}
const SETORES: SetorMaquina[] = ["usinagem","montagem","acabamento","estamparia","soldagem"];
function buildSetorLabel(t: (k: string) => string): Record<SetorMaquina,string> {
  return {usinagem:t("maquinasPanel.setor.usinagem"),montagem:t("maquinasPanel.setor.montagem"),acabamento:t("maquinasPanel.setor.acabamento"),estamparia:t("maquinasPanel.setor.estamparia"),soldagem:t("maquinasPanel.setor.soldagem")};
}

function MaquinaModal({ open, maquina, onClose, onSaved }: {
  open:boolean; maquina?:Maquina; onClose:()=>void; onSaved:(m:Maquina)=>void;
}) {
  const { t } = useTranslation();
  const SETOR_LABEL = buildSetorLabel(t);
  const [form, setForm] = useState({ codigo:"", nome:"", setor:"usinagem" as SetorMaquina, fabricante:"", modelo:"", horimetro:"", ultima_manutencao:"", proxima_manutencao:"" });
  const [saving, setSaving] = useState(false);
  const { saveWithFallback } = useOfflineSync();
  const isEdit = !!maquina;

  useEffect(() => {
    if (open) setForm({
      codigo: maquina?.codigo||"", nome: maquina?.nome||"",
      setor: maquina?.setor||"usinagem", fabricante: maquina?.fabricante||"",
      modelo: maquina?.modelo||"", horimetro: String(maquina?.horimetro||""),
      ultima_manutencao: maquina?.ultima_manutencao||"", proxima_manutencao: maquina?.proxima_manutencao||"",
    });
  }, [open, maquina]);

  if (!open) return null;

  async function save() {
    if (!form.codigo || !form.nome) { toast.error(t("maquinasPanel.toastCodeNameRequired")); return; }
    setSaving(true);
    const id = maquina?.id || crypto.randomUUID();
    const data: Maquina = {
      id, codigo: form.codigo.toUpperCase(), nome: form.nome,
      setor: form.setor, status: maquina?.status||"operando",
      disponibilidade: maquina?.disponibilidade||100,
      fabricante: form.fabricante||undefined, modelo: form.modelo||undefined,
      horimetro: form.horimetro ? Number(form.horimetro) : undefined,
      ultima_manutencao: form.ultima_manutencao||undefined,
      proxima_manutencao: form.proxima_manutencao||undefined,
    };
    const { data:saved, error, savedOffline } = await saveWithFallback(
      "maquinas_producao", "maquinas", isEdit ? "UPDATE" : "INSERT", data
    );
    setSaving(false);
    if (error) { toast.error(t("maquinasPanel.toastSaveError")); return; }
    toast.success(savedOffline ? t("maquinasPanel.toastSavedOffline") : isEdit ? t("maquinasPanel.toastUpdated") : t("maquinasPanel.toastCreated"));
    onSaved(saved||data); onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-card rounded-2xl border shadow-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{isEdit?t("maquinasPanel.editMachine"):t("maquinasPanel.newMachine")}</h3>
          <button onClick={onClose} aria-label={t("maquinasPanel.close")}><X className="h-4 w-4"/></button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">{t("maquinasPanel.code")}</label><Input value={form.codigo} onChange={e=>setForm(p=>({...p,codigo:e.target.value}))} placeholder={t("maquinasPanel.codePlaceholder")}/></div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">{t("maquinasPanel.sector")}</label>
              <select value={form.setor} onChange={e=>setForm(p=>({...p,setor:e.target.value as SetorMaquina}))} className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
                {SETORES.map(s=><option key={s} value={s}>{SETOR_LABEL[s]}</option>)}
              </select>
            </div>
          </div>
          <div><label className="text-xs font-medium text-muted-foreground mb-1 block">{t("maquinasPanel.name")}</label><Input value={form.nome} onChange={e=>setForm(p=>({...p,nome:e.target.value}))} placeholder={t("maquinasPanel.namePlaceholder")}/></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">{t("maquinasPanel.manufacturer")}</label><Input value={form.fabricante} onChange={e=>setForm(p=>({...p,fabricante:e.target.value}))} placeholder={t("maquinasPanel.manufacturerPlaceholder")}/></div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">{t("maquinasPanel.model")}</label><Input value={form.modelo} onChange={e=>setForm(p=>({...p,modelo:e.target.value}))} placeholder={t("maquinasPanel.modelPlaceholder")}/></div>
          </div>
          <div><label className="text-xs font-medium text-muted-foreground mb-1 block">{t("maquinasPanel.hourmeter")}</label><Input type="number" value={form.horimetro} onChange={e=>setForm(p=>({...p,horimetro:e.target.value}))} placeholder="0"/></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">{t("maquinasPanel.lastMaintenance")}</label><Input type="date" value={form.ultima_manutencao} onChange={e=>setForm(p=>({...p,ultima_manutencao:e.target.value}))}/></div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">{t("maquinasPanel.nextMaintenance")}</label><Input type="date" value={form.proxima_manutencao} onChange={e=>setForm(p=>({...p,proxima_manutencao:e.target.value}))}/></div>
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={saving}>{t("maquinasPanel.cancel")}</Button>
          <Button className="flex-1" onClick={save} disabled={saving}>{saving?t("maquinasPanel.saving"):t("maquinasPanel.save")}</Button>
        </div>
      </div>
    </div>
  );
}

export function MaquinasPanel({ isAdmin, canWrite }: { isAdmin: boolean; canWrite?: boolean }) {
  const { t } = useTranslation();
  const STATUS_CFG = buildStatusCfg(t);
  const SETOR_LABEL = buildSetorLabel(t);
  const canEdit = canWrite ?? isAdmin;
  const [maquinas, setMaquinas] = useState<Maquina[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<"todos"|StatusMaquina>("todos");
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Maquina|undefined>();
  const { saveWithFallback, loadWithFallback } = useOfflineSync();

  const load = useCallback(async () => {
    setLoading(true);
    const data = await loadWithFallback<Maquina>("maquinas_producao", "maquinas");
    setMaquinas(data.sort((a,b)=>a.codigo.localeCompare(b.codigo)));
    setLoading(false);
  }, [loadWithFallback]);

  useEffect(() => { load(); }, [load]);

  async function handleStatusChange(id:string, status:StatusMaquina) {
    const maq = maquinas.find(m=>m.id===id);
    if (!maq) return;
    const updated = {...maq, status};
    const { error, savedOffline } = await saveWithFallback("maquinas_producao","maquinas","UPDATE",updated);
    if (error) { toast.error(t("maquinasPanel.toastStatusUpdateError")); return; }
    toast.success(savedOffline?t("maquinasPanel.toastSavedOffline"):t("maquinasPanel.toastStatusUpdated"));
    setMaquinas(prev=>prev.map(m=>m.id===id?updated:m));
  }

  async function handleDelete(id:string) {
    if (!confirm(t("maquinasPanel.confirmRemoveMachine"))) return;
    const { error } = await saveWithFallback("maquinas_producao","maquinas","DELETE",{id} as Maquina);
    if (error) { toast.error(t("maquinasPanel.toastRemoveError")); return; }
    setMaquinas(prev=>prev.filter(m=>m.id!==id));
    toast.success(t("maquinasPanel.toastRemoved"));
  }

  const filtered = maquinas.filter(m => {
    const matchSearch = !search || [m.codigo,m.nome,m.fabricante||""].some(v=>v.toLowerCase().includes(search.toLowerCase()));
    const matchStatus = filtroStatus==="todos" || m.status===filtroStatus;
    return matchSearch && matchStatus;
  });

  const counts = { operando:0, parada:0, manutencao:0, setup:0 };
  maquinas.forEach(m => counts[m.status]++);

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="grid grid-cols-4 gap-2">
        {(Object.entries(STATUS_CFG) as [StatusMaquina,typeof STATUS_CFG[StatusMaquina]][]).map(([k,cfg])=>(
          <div key={k} className={cn("rounded-xl border p-3 text-center", cfg.bg)}>
            <p className={cn("text-lg font-bold", cfg.color)}>{counts[k]}</p>
            <p className="text-[10px] text-muted-foreground">{cfg.label}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <SearchInputWithBarcode value={search} onChange={setSearch} onSearch={setSearch} placeholder={t("maquinasPanel.searchPlaceholder")} height="h-9"/>
        </div>
        <select value={filtroStatus} onChange={e=>setFiltroStatus(e.target.value as typeof filtroStatus)}
          className="h-9 rounded-lg border border-input bg-background px-3 text-sm">
          <option value="todos">{t("maquinasPanel.all")}</option>
          {(Object.keys(STATUS_CFG) as StatusMaquina[]).map(s=><option key={s} value={s}>{STATUS_CFG[s].label}</option>)}
        </select>
        {canEdit && <Button size="sm" className="gap-1 h-9" onClick={()=>{setEditTarget(undefined);setModalOpen(true);}}><Plus className="h-4 w-4"/>{t("maquinasPanel.newAbbrev")}</Button>}
        <Button size="sm" variant="outline" className="h-9 px-2" onClick={load} disabled={loading}><RefreshCw className={cn("h-4 w-4",loading&&"animate-spin")}/></Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2"><RefreshCw className="h-4 w-4 animate-spin"/>{t("maquinasPanel.loading")}</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-sm gap-2">
          <Settings2 className="h-8 w-8 opacity-30"/><p>{maquinas.length===0?t("maquinasPanel.noMachinesRegistered"):t("maquinasPanel.noResultsFound")}</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map(m => {
            const cfg = STATUS_CFG[m.status];
            return (
              <div key={m.id} className={cn("rounded-2xl border p-4 space-y-3 transition-all", cfg.bg, "border-border/40")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm">{m.codigo}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{m.nome}</p>
                    {m.fabricante && <p className="text-[10px] text-muted-foreground">{m.fabricante}{m.modelo?` · ${m.modelo}`:""}</p>}
                  </div>
                  <Badge variant="outline" className={cn("text-[10px] shrink-0 gap-1", cfg.color)}>
                    <cfg.Icon className="h-2.5 w-2.5"/>{cfg.label}
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{t("maquinasPanel.availability")} <b className="text-foreground">{m.disponibilidade}%</b></span>
                  {m.horimetro !== undefined && <span>{t("maquinasPanel.hourmeterLabel")} <b className="text-foreground">{m.horimetro}h</b></span>}
                  <span>{SETOR_LABEL[m.setor]}</span>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-2 pt-1 border-t border-border/30">
                    <select value={m.status} onChange={e=>handleStatusChange(m.id,e.target.value as StatusMaquina)}
                      className="flex-1 h-7 rounded-lg border border-input bg-background px-2 text-[11px]">
                      {(Object.keys(STATUS_CFG) as StatusMaquina[]).map(s=><option key={s} value={s}>{STATUS_CFG[s].label}</option>)}
                    </select>
                    <button onClick={()=>{setEditTarget(m);setModalOpen(true);}} aria-label={t("maquinasPanel.editMachineAria")} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/50"><Edit2 className="h-3.5 w-3.5"/></button>
                    {/* Excluir continua restrito a admin — política RLS maq_delete só permite admin */}
                    {isAdmin && (
                      <button onClick={()=>handleDelete(m.id)} aria-label={t("maquinasPanel.deleteMachineAria")} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-destructive/10 text-destructive"><Trash2 className="h-3.5 w-3.5"/></button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <MaquinaModal open={modalOpen} maquina={editTarget} onClose={()=>setModalOpen(false)}
        onSaved={m=>{setMaquinas(prev=>editTarget?prev.map(x=>x.id===m.id?m:x):[m,...prev]);}}/>
    </div>
  );
}
