/**
 * ProdutosPanel — Cadastro de Produtos
 * ✓ Dados reais via Supabase (tabela produtos_producao)
 * ✓ Fallback offline com IndexedDB
 */

import { useState, useEffect, useCallback } from "react";
import { Plus, X, Search, Package, Edit2, Trash2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchInputWithBarcode } from "@/components/SearchInputWithBarcode";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { useTranslation } from "react-i18next";

type TipoMaterial = "aco_inox"|"aco_carbono"|"aluminio"|"latao"|"polimero"|"outro";

interface Produto {
  id: string; codigo: string; descricao: string;
  tempo_ciclo_seg: number; pecas_por_hora: number;
  tipo_material: TipoMaterial; lead_time_dias: number;
  dim_comprimento?: number; dim_largura?: number;
  dim_altura?: number; dim_diametro?: number;
  peso_gramas?: number; ativo: boolean;
  created_at?: string; updated_at?: string;
}

function buildMaterialLabel(t: (k: string) => string): Record<TipoMaterial,string> {
  return {
  aco_inox:t("produtosPanel.material.aco_inox"), aco_carbono:t("produtosPanel.material.aco_carbono"), aluminio:t("produtosPanel.material.aluminio"),
  latao:t("produtosPanel.material.latao"), polimero:t("produtosPanel.material.polimero"), outro:t("produtosPanel.material.outro"),
  };
}

function ProdutoModal({ open, produto, onClose, onSaved }: {
  open:boolean; produto?:Produto; onClose:()=>void; onSaved:(p:Produto)=>void;
}) {
  const { t } = useTranslation();
  const MATERIAL_LABEL = buildMaterialLabel(t);
  const { saveWithFallback } = useOfflineSync();
  const isEdit = !!produto;
  const [form, setForm] = useState({
    codigo:"", descricao:"", tempo_ciclo_seg:"", pecas_por_hora:"",
    tipo_material:"aco_carbono" as TipoMaterial, lead_time_dias:"",
    dim_comprimento:"", dim_largura:"", dim_altura:"", dim_diametro:"", peso_gramas:"",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm({
      codigo:produto?.codigo||"", descricao:produto?.descricao||"",
      tempo_ciclo_seg:String(produto?.tempo_ciclo_seg||""), pecas_por_hora:String(produto?.pecas_por_hora||""),
      tipo_material:produto?.tipo_material||"aco_carbono", lead_time_dias:String(produto?.lead_time_dias||""),
      dim_comprimento:String(produto?.dim_comprimento||""), dim_largura:String(produto?.dim_largura||""),
      dim_altura:String(produto?.dim_altura||""), dim_diametro:String(produto?.dim_diametro||""),
      peso_gramas:String(produto?.peso_gramas||""),
    });
  }, [open, produto]);

  if (!open) return null;

  async function save() {
    if (!form.codigo || !form.descricao || !form.tempo_ciclo_seg) { toast.error(t("produtosPanel.toastRequiredFields")); return; }
    setSaving(true);
    const id = produto?.id || crypto.randomUUID();
    const tempoCiclo = Number(form.tempo_ciclo_seg);
    const data: Produto = {
      id, codigo: form.codigo.toUpperCase(), descricao: form.descricao,
      tempo_ciclo_seg: tempoCiclo,
      pecas_por_hora: Number(form.pecas_por_hora) || Math.round(3600/tempoCiclo),
      tipo_material: form.tipo_material,
      lead_time_dias: Number(form.lead_time_dias)||0,
      dim_comprimento: form.dim_comprimento ? Number(form.dim_comprimento):undefined,
      dim_largura: form.dim_largura ? Number(form.dim_largura):undefined,
      dim_altura: form.dim_altura ? Number(form.dim_altura):undefined,
      dim_diametro: form.dim_diametro ? Number(form.dim_diametro):undefined,
      peso_gramas: form.peso_gramas ? Number(form.peso_gramas):undefined,
      ativo: produto?.ativo ?? true,
    };
    const { data:saved, error, savedOffline } = await saveWithFallback("produtos_producao","produtos_producao", isEdit?"UPDATE":"INSERT",data);
    setSaving(false);
    if (error) { toast.error(t("produtosPanel.toastSaveError")); return; }
    toast.success(savedOffline?t("produtosPanel.toastSavedOffline"): isEdit?t("produtosPanel.toastUpdated"):t("produtosPanel.toastCreated"));
    onSaved(saved||data); onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-card rounded-2xl border shadow-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{isEdit?t("produtosPanel.editProduct"):t("produtosPanel.newProduct")}</h3>
          <button onClick={onClose} aria-label={t("produtosPanel.close")}><X className="h-4 w-4"/></button>
        </div>
        <div className="space-y-3">
          <div><label className="text-xs font-medium text-muted-foreground mb-1 block">{t("produtosPanel.code")}</label><Input value={form.codigo} onChange={e=>setForm(p=>({...p,codigo:e.target.value}))} placeholder={t("produtosPanel.codePlaceholder")}/></div>
          <div><label className="text-xs font-medium text-muted-foreground mb-1 block">{t("produtosPanel.description")}</label><Input value={form.descricao} onChange={e=>setForm(p=>({...p,descricao:e.target.value}))} placeholder={t("produtosPanel.descriptionPlaceholder")}/></div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("produtosPanel.material_label")}</label>
            <select value={form.tipo_material} onChange={e=>setForm(p=>({...p,tipo_material:e.target.value as TipoMaterial}))}
              className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
              {(Object.entries(MATERIAL_LABEL)).map(([k,v])=><option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">{t("produtosPanel.cycleTime")}</label><Input type="number" value={form.tempo_ciclo_seg} onChange={e=>setForm(p=>({...p,tempo_ciclo_seg:e.target.value}))} placeholder="180"/></div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">{t("produtosPanel.piecesPerHour")}</label><Input type="number" value={form.pecas_por_hora} onChange={e=>setForm(p=>({...p,pecas_por_hora:e.target.value}))} placeholder={t("produtosPanel.piecesPerHourPlaceholder")}/></div>
          </div>
          <div><label className="text-xs font-medium text-muted-foreground mb-1 block">{t("produtosPanel.leadTime")}</label><Input type="number" value={form.lead_time_dias} onChange={e=>setForm(p=>({...p,lead_time_dias:e.target.value}))} placeholder="0"/></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">{t("produtosPanel.diameter")}</label><Input type="number" value={form.dim_diametro} onChange={e=>setForm(p=>({...p,dim_diametro:e.target.value}))}/></div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">{t("produtosPanel.length")}</label><Input type="number" value={form.dim_comprimento} onChange={e=>setForm(p=>({...p,dim_comprimento:e.target.value}))}/></div>
          </div>
          <div><label className="text-xs font-medium text-muted-foreground mb-1 block">{t("produtosPanel.weight")}</label><Input type="number" value={form.peso_gramas} onChange={e=>setForm(p=>({...p,peso_gramas:e.target.value}))}/></div>
        </div>
        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={saving}>{t("produtosPanel.cancel")}</Button>
          <Button className="flex-1" onClick={save} disabled={saving}>{saving?t("produtosPanel.saving"):t("produtosPanel.save")}</Button>
        </div>
      </div>
    </div>
  );
}

export function ProdutosPanel({ isAdmin, canWrite }: { isAdmin: boolean; canWrite?: boolean }) {
  const { t } = useTranslation();
  const MATERIAL_LABEL = buildMaterialLabel(t);
  const canEdit = canWrite ?? isAdmin;
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Produto|undefined>();
  const { saveWithFallback, loadWithFallback } = useOfflineSync();

  const load = useCallback(async () => {
    setLoading(true);
    const data = await loadWithFallback<Produto>("produtos_producao","produtos_producao");
    setProdutos(data.sort((a,b)=>a.codigo.localeCompare(b.codigo)));
    setLoading(false);
  },[loadWithFallback]);

  useEffect(()=>{load();},[load]);

  async function handleToggleAtivo(p:Produto) {
    const updated = {...p, ativo:!p.ativo};
    const {error,savedOffline} = await saveWithFallback("produtos_producao","produtos_producao","UPDATE",updated);
    if (error) { toast.error(t("produtosPanel.toastUpdateError")); return; }
    toast.success(savedOffline?t("produtosPanel.toastSavedOffline"):`${t("produtosPanel.productPrefix")} ${updated.ativo?t("produtosPanel.toastActivated"):t("produtosPanel.toastDeactivated")}`);
    setProdutos(prev=>prev.map(x=>x.id===p.id?updated:x));
  }

  async function handleDelete(id:string) {
    if (!confirm(t("produtosPanel.confirmRemoveProduct"))) return;
    await saveWithFallback("produtos_producao","produtos_producao","DELETE",{id} as Produto);
    setProdutos(prev=>prev.filter(p=>p.id!==id));
    toast.success(t("produtosPanel.toastRemoved"));
  }

  const filtered = produtos.filter(p=>!search||[p.codigo,p.descricao].some(v=>v.toLowerCase().includes(search.toLowerCase())));

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <SearchInputWithBarcode value={search} onChange={setSearch} onSearch={setSearch} placeholder={t("produtosPanel.searchPlaceholder")} height="h-9"/>
        </div>
        {canEdit && <Button size="sm" className="gap-1 h-9" onClick={()=>{setEditTarget(undefined);setModalOpen(true);}}><Plus className="h-4 w-4"/>{t("produtosPanel.newAbbrev")}</Button>}
        <Button size="sm" variant="outline" className="h-9 px-2" onClick={load} disabled={loading}><RefreshCw className={cn("h-4 w-4",loading&&"animate-spin")}/></Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2"><RefreshCw className="h-4 w-4 animate-spin"/>{t("produtosPanel.loading")}</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-sm gap-2">
          <Package className="h-8 w-8 opacity-30"/><p>{produtos.length===0?t("produtosPanel.noProductsRegistered"):t("produtosPanel.noResults")}</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map(p=>(
            <div key={p.id} className={cn("rounded-2xl border p-4 space-y-2 transition-all", p.ativo?"bg-card/60":"bg-muted/30 opacity-60")}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sm">{p.codigo}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{p.descricao}</p>
                  <p className="text-[10px] text-muted-foreground">{MATERIAL_LABEL[p.tipo_material]}</p>
                </div>
                <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", p.ativo?"bg-green-500/10 text-green-600":"bg-muted text-muted-foreground")}>
                  {p.ativo?t("produtosPanel.active"):t("produtosPanel.inactive")}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1 text-[11px] text-muted-foreground">
                <span>{t("produtosPanel.cycle")} <b className="text-foreground">{p.tempo_ciclo_seg}s</b></span>
                <span>{t("produtosPanel.piecesHourAbbrev")} <b className="text-foreground">{p.pecas_por_hora}</b></span>
                <span>{t("produtosPanel.leadAbbrev")} <b className="text-foreground">{p.lead_time_dias}d</b></span>
              </div>
              {canEdit && (
                <div className="flex items-center gap-2 pt-1 border-t border-border/30">
                  <button onClick={()=>handleToggleAtivo(p)} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">{p.ativo?t("produtosPanel.deactivate"):t("produtosPanel.activate")}</button>
                  <div className="flex-1"/>
                  <button onClick={()=>{setEditTarget(p);setModalOpen(true);}} aria-label={t("produtosPanel.editProductAria")} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/50"><Edit2 className="h-3.5 w-3.5"/></button>
                  {/* Excluir continua restrito a admin — política RLS prod_delete só permite admin */}
                  {isAdmin && (
                    <button onClick={()=>handleDelete(p.id)} aria-label={t("produtosPanel.deleteProductAria")} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-destructive/10 text-destructive"><Trash2 className="h-3.5 w-3.5"/></button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <ProdutoModal open={modalOpen} produto={editTarget} onClose={()=>setModalOpen(false)}
        onSaved={p=>{setProdutos(prev=>editTarget?prev.map(x=>x.id===p.id?p:x):[p,...prev]);}}/>
    </div>
  );
}
