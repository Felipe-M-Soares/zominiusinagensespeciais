/**
 * FornecedoresPanel — Gestão de Fornecedores (Módulo MRP)
 * Cadastro, listagem, edição e avaliação de fornecedores.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Building2, Plus, Search, Star, Phone, Mail, MapPin,
  Clock, Edit2, Trash2, X, CheckCircle2, ChevronDown, ChevronUp,
  Package,
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

interface Fornecedor {
  id: string;
  nome: string;
  cnpj: string | null;
  contato: string | null;
  telefone: string | null;
  email: string | null;
  endereco: string | null;
  lead_time_dias: number;
  avaliacao: number | null;
  ativo: boolean;
  observacoes: string | null;
  created_at: string;
}

const EMPTY: Partial<Fornecedor> = {
  nome: "", cnpj: "", contato: "", telefone: "", email: "",
  endereco: "", lead_time_dias: 7, avaliacao: null, observacoes: "", ativo: true,
};

// ── StarRating ────────────────────────────────────────────────────────────────
function StarRating({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" onClick={() => onChange(n)}
          className="transition-transform hover:scale-110 active:scale-95">
          <Star className={cn("h-5 w-5", n <= (value ?? 0)
            ? "fill-amber-400 text-amber-400"
            : "text-muted-foreground/30")} />
        </button>
      ))}
    </div>
  );
}

// ── FornecedorModal ───────────────────────────────────────────────────────────
interface ModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editing: Fornecedor | null;
}

function FornecedorModal({ open, onClose, onSaved, editing }: ModalProps) {
  const { user } = useAuth();
  const [form, setForm] = useState<Partial<Fornecedor>>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(editing ?? EMPTY);
  }, [editing, open]);

  if (!open) return null;

  const set = (k: keyof Fornecedor, v: unknown) =>
    setForm(f => ({ ...f, [k]: v }));

  async function handleSave() {
    if (!form.nome?.trim()) { toast.error("Nome é obrigatório"); return; }
    setSaving(true);
    try {
      const payload = {
        nome: form.nome!.trim(),
        cnpj: form.cnpj || null,
        contato: form.contato || null,
        telefone: form.telefone || null,
        email: form.email || null,
        endereco: form.endereco || null,
        lead_time_dias: form.lead_time_dias ?? 7,
        avaliacao: form.avaliacao ?? null,
        observacoes: form.observacoes || null,
        ativo: form.ativo ?? true,
      };
      if (editing) {
        const { error } = await supabase.from("fornecedores").update(payload).eq("id", editing.id);
        if (error) throw error;
        toast.success("Fornecedor atualizado!");
      } else {
        const { error } = await supabase.from("fornecedores")
          .insert({ ...payload, created_by: user?.id });
        if (error) throw error;
        toast.success("Fornecedor cadastrado!");
      }
      onSaved();
      onClose();
    } catch { toast.error("Erro ao salvar fornecedor."); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}>
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40 sticky top-0 bg-background z-10">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            <p className="font-semibold text-sm">{editing ? "Editar Fornecedor" : "Novo Fornecedor"}</p>
          </div>
          <button onClick={onClose} className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-muted/40 transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Nome */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Nome *</label>
            <Input value={form.nome ?? ""} onChange={e => set("nome", e.target.value)}
              placeholder="Nome do fornecedor" className="h-9" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">CNPJ</label>
              <Input value={form.cnpj ?? ""} onChange={e => set("cnpj", e.target.value)}
                placeholder="00.000.000/0001-00" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Lead Time (dias)</label>
              <Input type="number" min={0} value={form.lead_time_dias ?? 7}
                onChange={e => set("lead_time_dias", parseInt(e.target.value) || 0)}
                className="h-9" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Contato</label>
              <Input value={form.contato ?? ""} onChange={e => set("contato", e.target.value)}
                placeholder="Nome do contato" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Telefone</label>
              <Input value={form.telefone ?? ""} onChange={e => set("telefone", e.target.value)}
                placeholder="(11) 99999-9999" className="h-9" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">E-mail</label>
            <Input type="email" value={form.email ?? ""} onChange={e => set("email", e.target.value)}
              placeholder="contato@fornecedor.com" className="h-9" />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Endereço</label>
            <Input value={form.endereco ?? ""} onChange={e => set("endereco", e.target.value)}
              placeholder="Rua, número, cidade/UF" className="h-9" />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Avaliação</label>
            <StarRating value={form.avaliacao ?? null} onChange={v => set("avaliacao", v)} />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Observações</label>
            <textarea value={form.observacoes ?? ""} onChange={e => set("observacoes", e.target.value)}
              className="w-full h-20 rounded-xl border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Condições comerciais, prazo padrão, etc." />
          </div>

          <div className="flex items-center gap-2">
            <button type="button" onClick={() => set("ativo", !form.ativo)}
              className={cn("h-5 w-9 rounded-full transition-colors relative",
                form.ativo ? "bg-primary" : "bg-muted")}>
              <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                form.ativo ? "translate-x-4" : "translate-x-0.5")} />
            </button>
            <span className="text-sm text-muted-foreground">Fornecedor ativo</span>
          </div>
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-border/40">
          <Button variant="outline" onClick={onClose} className="flex-1 h-9">Cancelar</Button>
          <Button onClick={handleSave} disabled={saving} className="flex-1 h-9">
            {saving ? "Salvando..." : editing ? "Atualizar" : "Cadastrar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── FornecedorCard ────────────────────────────────────────────────────────────
function FornecedorCard({ f, isAdmin, onEdit, onDelete }: {
  f: Fornecedor; isAdmin: boolean;
  onEdit: (f: Fornecedor) => void;
  onDelete: (f: Fornecedor) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn("rounded-2xl border bg-card/80 overflow-hidden transition-all",
      !f.ativo && "opacity-60")}>
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Building2 className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-sm truncate">{f.nome}</p>
            {!f.ativo && <Badge variant="outline" className="text-[10px] shrink-0">Inativo</Badge>}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {f.avaliacao && (
              <div className="flex">
                {[1,2,3,4,5].map(n => (
                  <Star key={n} className={cn("h-3 w-3",
                    n <= f.avaliacao! ? "fill-amber-400 text-amber-400" : "text-muted/30")} />
                ))}
              </div>
            )}
            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />{f.lead_time_dias}d lead
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isAdmin && (
            <>
              <button onClick={() => onEdit(f)}
                className="h-7 w-7 rounded-lg hover:bg-muted/40 flex items-center justify-center transition-colors">
                <Edit2 className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              <button onClick={() => onDelete(f)}
                className="h-7 w-7 rounded-lg hover:bg-destructive/10 flex items-center justify-center transition-colors">
                <Trash2 className="h-3.5 w-3.5 text-destructive/70" />
              </button>
            </>
          )}
          <button onClick={() => setExpanded(e => !e)}
            className="h-7 w-7 rounded-lg hover:bg-muted/40 flex items-center justify-center transition-colors">
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t border-border/20 space-y-2 animate-in slide-in-from-top-1 duration-150">
          {f.cnpj && (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <Package className="h-3.5 w-3.5 shrink-0" />
              <span>CNPJ: {f.cnpj}</span>
            </div>
          )}
          {f.contato && (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span>{f.contato}</span>
            </div>
          )}
          {f.telefone && (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <Phone className="h-3.5 w-3.5 shrink-0" />
              <span>{f.telefone}</span>
            </div>
          )}
          {f.email && (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <Mail className="h-3.5 w-3.5 shrink-0" />
              <span>{f.email}</span>
            </div>
          )}
          {f.endereco && (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span>{f.endereco}</span>
            </div>
          )}
          {f.observacoes && (
            <p className="text-[12px] text-muted-foreground/70 italic mt-1">{f.observacoes}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────
export function FornecedoresPanel({ isAdmin }: { isAdmin: boolean }) {
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Fornecedor | null>(null);
  const [showInativos, setShowInativos] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("fornecedores")
      .select("*").order("nome");
    setFornecedores((data ?? []) as Fornecedor[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(f: Fornecedor) {
    if (!confirm(`Remover "${f.nome}"?`)) return;
    const { error } = await supabase.from("fornecedores").delete().eq("id", f.id);
    if (error) { toast.error("Erro ao remover."); return; }
    toast.success("Fornecedor removido.");
    load();
  }

  const filtered = fornecedores.filter(f => {
    if (!showInativos && !f.ativo) return false;
    const q = search.toLowerCase();
    return !q || f.nome.toLowerCase().includes(q)
      || (f.cnpj ?? "").includes(q)
      || (f.contato ?? "").toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary" />
          <h2 className="font-semibold text-sm">Fornecedores</h2>
          <Badge variant="outline" className="text-[10px]">
            {filtered.length}
          </Badge>
        </div>
        {isAdmin && (
          <Button size="sm" className="h-8 gap-1.5" onClick={() => { setEditing(null); setModalOpen(true); }}>
            <Plus className="h-3.5 w-3.5" /> Novo
          </Button>
        )}
      </div>

      {/* Busca + Filtros */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome, CNPJ ou contato..."
            className="pl-9 h-9 text-sm" />
        </div>
        <button onClick={() => setShowInativos(s => !s)}
          className={cn("px-3 h-9 rounded-xl border text-xs font-medium transition-colors",
            showInativos ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/40")}>
          + Inativos
        </button>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-2xl border p-4 flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed py-16 text-center space-y-2">
          <Building2 className="h-8 w-8 text-muted-foreground/30 mx-auto" />
          <p className="text-sm text-muted-foreground/60">
            {search ? "Nenhum fornecedor encontrado" : "Nenhum fornecedor cadastrado"}
          </p>
          {isAdmin && !search && (
            <Button size="sm" variant="outline" className="mt-2" onClick={() => setModalOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Cadastrar fornecedor
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(f => (
            <FornecedorCard key={f.id} f={f} isAdmin={isAdmin}
              onEdit={f => { setEditing(f); setModalOpen(true); }}
              onDelete={handleDelete} />
          ))}
        </div>
      )}

      <FornecedorModal open={modalOpen} onClose={() => setModalOpen(false)}
        onSaved={load} editing={editing} />
    </div>
  );
}
