/**
 * BOMPanel — Bill of Materials (Estrutura de Produto)
 * Cadastro e visualização da estrutura de componentes por produto.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Layers, Plus, Search, Trash2, Edit2, X, ChevronDown,
  Package, DollarSign, Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface Device { id: string; model: string; }
interface Fornecedor { id: string; nome: string; }

interface BOMItem {
  id: string;
  componente: string;
  quantidade: number;
  unidade: string;
  fornecedor_id: string | null;
  fornecedor_nome?: string;
  custo_unitario: number | null;
  observacoes: string | null;
  ordem: number;
}

interface BOMHeader {
  id: string;
  device_id: string;
  device_model?: string;
  versao: string;
  descricao: string | null;
  ativo: boolean;
  items: BOMItem[];
}

const UNIDADES = ["un", "kg", "g", "m", "m²", "m³", "L", "ml", "pç", "cx", "rolo"];

// ── BOM Item Row ──────────────────────────────────────────────────────────────
function BOMItemRow({ item, isAdmin, onDelete, fornecedores }: {
  item: BOMItem; isAdmin: boolean;
  onDelete: (id: string) => void;
  fornecedores: Fornecedor[];
}) {
  const forn = fornecedores.find(f => f.id === item.fornecedor_id);
  const custo = item.custo_unitario != null
    ? (item.custo_unitario * item.quantidade).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : null;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/10 transition-colors group">
      <span className="text-[11px] text-muted-foreground/50 w-4 tabular-nums shrink-0">{item.ordem}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium truncate">{item.componente}</p>
        {item.observacoes && (
          <p className="text-[10px] text-muted-foreground/60 truncate italic">{item.observacoes}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0 text-[12px]">
        <span className="font-mono font-semibold">{item.quantidade}</span>
        <span className="text-muted-foreground">{item.unidade}</span>
      </div>
      {forn && (
        <div className="hidden sm:flex items-center gap-1 text-[11px] text-muted-foreground/70 shrink-0">
          <Building2 className="h-3 w-3 shrink-0" />
          <span className="truncate max-w-[80px]">{forn.nome}</span>
        </div>
      )}
      {custo && (
        <span className="text-[11px] font-medium text-success shrink-0">{custo}</span>
      )}
      {isAdmin && (
        <button onClick={() => onDelete(item.id)}
          className="opacity-0 group-hover:opacity-100 h-6 w-6 rounded-lg hover:bg-destructive/10 flex items-center justify-center transition-all">
          <Trash2 className="h-3.5 w-3.5 text-destructive/70" />
        </button>
      )}
    </div>
  );
}

// ── AddItemModal ──────────────────────────────────────────────────────────────
function AddItemModal({ open, bomId, onClose, onSaved, fornecedores, nextOrdem }: {
  open: boolean; bomId: string; onClose: () => void; onSaved: () => void;
  fornecedores: Fornecedor[]; nextOrdem: number;
}) {
  const [form, setForm] = useState({
    componente: "", quantidade: 1, unidade: "un",
    fornecedor_id: "", custo_unitario: "", observacoes: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm({ componente: "", quantidade: 1, unidade: "un", fornecedor_id: "", custo_unitario: "", observacoes: "" });
  }, [open]);

  if (!open) return null;

  async function handleSave() {
    if (!form.componente.trim()) { toast.error("Nome do componente obrigatório"); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from("bom_items").insert({
        bom_id: bomId,
        componente: form.componente.trim(),
        quantidade: form.quantidade,
        unidade: form.unidade,
        fornecedor_id: form.fornecedor_id || null,
        custo_unitario: form.custo_unitario ? parseFloat(form.custo_unitario) : null,
        observacoes: form.observacoes || null,
        ordem: nextOrdem,
      });
      if (error) throw error;
      toast.success("Componente adicionado!");
      onSaved();
      onClose();
    } catch { toast.error("Erro ao adicionar componente."); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}>
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
          <p className="font-semibold text-sm">Adicionar Componente</p>
          <button onClick={onClose} className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-muted/40 transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Componente / Matéria-Prima *</label>
            <Input value={form.componente} onChange={e => setForm(f => ({ ...f, componente: e.target.value }))}
              placeholder="ex: Alumínio 6061-T6, Parafuso M6x20..." className="h-9" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Quantidade</label>
              <Input type="number" min={0} step="0.001" value={form.quantidade}
                onChange={e => setForm(f => ({ ...f, quantidade: parseFloat(e.target.value) || 1 }))}
                className="h-9" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Unidade</label>
              <div className="relative">
                <select value={form.unidade} onChange={e => setForm(f => ({ ...f, unidade: e.target.value }))}
                  className="w-full h-9 pr-8 pl-3 rounded-xl border border-input bg-background text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-ring">
                  {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Fornecedor</label>
              <div className="relative">
                <select value={form.fornecedor_id} onChange={e => setForm(f => ({ ...f, fornecedor_id: e.target.value }))}
                  className="w-full h-9 pr-8 pl-3 rounded-xl border border-input bg-background text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="">Nenhum</option>
                  {fornecedores.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Custo Unit. (R$)</label>
              <Input type="number" min={0} step="0.01" value={form.custo_unitario}
                onChange={e => setForm(f => ({ ...f, custo_unitario: e.target.value }))}
                placeholder="0,00" className="h-9" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Observações</label>
            <Input value={form.observacoes} onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))}
              placeholder="Especificação, tolerância, etc." className="h-9" />
          </div>
        </div>
        <div className="flex gap-2 px-5 py-4 border-t border-border/40">
          <Button variant="outline" onClick={onClose} className="flex-1 h-9">Cancelar</Button>
          <Button onClick={handleSave} disabled={saving} className="flex-1 h-9">
            {saving ? "Salvando..." : "Adicionar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── BOM Card ──────────────────────────────────────────────────────────────────
function BOMCard({ bom, isAdmin, onRefresh, fornecedores }: {
  bom: BOMHeader; isAdmin: boolean; onRefresh: () => void; fornecedores: Fornecedor[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const totalCusto = bom.items.reduce((s, i) =>
    s + (i.custo_unitario != null ? i.custo_unitario * i.quantidade : 0), 0);

  async function deleteItem(id: string) {
    const { error } = await supabase.from("bom_items").delete().eq("id", id);
    if (error) { toast.error("Erro ao remover."); return; }
    toast.success("Componente removido.");
    onRefresh();
  }

  return (
    <div className="rounded-2xl border bg-card/80 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={() => setExpanded(e => !e)}>
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Layers className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-sm truncate">{bom.device_model}</p>
            <Badge variant="outline" className="text-[10px] shrink-0">v{bom.versao}</Badge>
            {!bom.ativo && <Badge variant="outline" className="text-[10px] shrink-0">Inativo</Badge>}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Package className="h-3 w-3" />{bom.items.length} componentes
            </span>
            {totalCusto > 0 && (
              <span className="flex items-center gap-1">
                <DollarSign className="h-3 w-3" />
                {totalCusto.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              </span>
            )}
          </div>
        </div>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform shrink-0",
          expanded && "rotate-180")} />
      </div>

      {/* Expanded items */}
      {expanded && (
        <div className="border-t border-border/20 animate-in slide-in-from-top-1 duration-150">
          {bom.items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground/60">
              Nenhum componente cadastrado
            </p>
          ) : (
            <div className="divide-y divide-border/20">
              {bom.items.map(item => (
                <BOMItemRow key={item.id} item={item} isAdmin={isAdmin}
                  onDelete={deleteItem} fornecedores={fornecedores} />
              ))}
            </div>
          )}
          {isAdmin && (
            <div className="px-4 py-3 border-t border-border/20">
              <Button size="sm" variant="outline" className="h-8 gap-1.5 w-full"
                onClick={() => setAddOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Adicionar Componente
              </Button>
            </div>
          )}
        </div>
      )}

      <AddItemModal open={addOpen} bomId={bom.id} onClose={() => setAddOpen(false)}
        onSaved={onRefresh} fornecedores={fornecedores} nextOrdem={bom.items.length + 1} />
    </div>
  );
}

// ── NovoBOMModal ──────────────────────────────────────────────────────────────
function NovoBOMModal({ open, onClose, onSaved, devices }: {
  open: boolean; onClose: () => void; onSaved: () => void; devices: Device[];
}) {
  const { user } = useAuth();
  const [form, setForm] = useState({ device_id: "", versao: "1.0", descricao: "" });
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  async function handleSave() {
    if (!form.device_id) { toast.error("Selecione o produto"); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from("bom_headers").insert({
        device_id: form.device_id, versao: form.versao || "1.0",
        descricao: form.descricao || null, created_by: user?.id,
      });
      if (error) throw error;
      toast.success("BOM criado!");
      onSaved(); onClose();
    } catch { toast.error("Erro ao criar BOM."); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}>
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
          <p className="font-semibold text-sm flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" /> Nova Estrutura de Produto
          </p>
          <button onClick={onClose} className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-muted/40">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Produto *</label>
            <div className="relative">
              <select value={form.device_id} onChange={e => setForm(f => ({ ...f, device_id: e.target.value }))}
                className="w-full h-9 pr-8 pl-3 rounded-xl border border-input bg-background text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="">Selecione...</option>
                {devices.map(d => <option key={d.id} value={d.id}>{d.model}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Versão</label>
              <Input value={form.versao} onChange={e => setForm(f => ({ ...f, versao: e.target.value }))}
                placeholder="1.0" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Descrição</label>
              <Input value={form.descricao} onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                placeholder="Revisão inicial..." className="h-9" />
            </div>
          </div>
        </div>
        <div className="flex gap-2 px-5 py-4 border-t border-border/40">
          <Button variant="outline" onClick={onClose} className="flex-1 h-9">Cancelar</Button>
          <Button onClick={handleSave} disabled={saving} className="flex-1 h-9">
            {saving ? "Criando..." : "Criar BOM"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────
export function BOMPanel({ isAdmin }: { isAdmin: boolean }) {
  const [boms, setBoms] = useState<BOMHeader[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: bomData }, { data: devData }, { data: fornData }, { data: itemData }] = await Promise.all([
      supabase.from("bom_headers").select("*").order("created_at", { ascending: false }),
      supabase.from("devices").select("id, model").order("model"),
      supabase.from("fornecedores").select("id, nome").eq("ativo", true).order("nome"),
      supabase.from("bom_items").select("*").order("ordem"),
    ]);
    const devMap = new Map((devData ?? []).map((d: Device) => [d.id, d.model]));
    const itemsByBom = new Map<string, BOMItem[]>();
    for (const item of (itemData ?? []) as BOMItem[]) {
      const list = itemsByBom.get(item.bom_id as unknown as string) ?? [];
      list.push(item);
      itemsByBom.set(item.bom_id as unknown as string, list);
    }
    const enriched = (bomData ?? []).map((b: BOMHeader) => ({
      ...b,
      device_model: devMap.get(b.device_id) ?? b.device_id,
      items: itemsByBom.get(b.id) ?? [],
    }));
    setBoms(enriched as BOMHeader[]);
    setDevices((devData ?? []) as Device[]);
    setFornecedores((fornData ?? []) as Fornecedor[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = boms.filter(b => {
    const q = search.toLowerCase();
    return !q || (b.device_model ?? "").toLowerCase().includes(q)
      || b.versao.includes(q);
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <h2 className="font-semibold text-sm">Estrutura de Produto (BOM)</h2>
          <Badge variant="outline" className="text-[10px]">{filtered.length}</Badge>
        </div>
        {isAdmin && (
          <Button size="sm" className="h-8 gap-1.5" onClick={() => setModalOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Novo BOM
          </Button>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por produto..." className="pl-9 h-9 text-sm" />
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="rounded-2xl border p-4 flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed py-16 text-center space-y-2">
          <Layers className="h-8 w-8 text-muted-foreground/30 mx-auto" />
          <p className="text-sm text-muted-foreground/60">
            {search ? "Nenhum BOM encontrado" : "Nenhuma estrutura de produto cadastrada"}
          </p>
          {isAdmin && !search && (
            <Button size="sm" variant="outline" className="mt-2" onClick={() => setModalOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Criar primeiro BOM
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(bom => (
            <BOMCard key={bom.id} bom={bom} isAdmin={isAdmin}
              onRefresh={load} fornecedores={fornecedores} />
          ))}
        </div>
      )}

      <NovoBOMModal open={modalOpen} onClose={() => setModalOpen(false)} onSaved={load} devices={devices} />
    </div>
  );
}
