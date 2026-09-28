/**
 * FornecedoresPanel — cadastro de fornecedores (usado em Processos › Fornecedores).
 * Remover = desativar (ativo=false); o histórico de compras continua ligado ao fornecedor.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { Building2, Loader2, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { friendlyError } from "@/lib/errorMessages";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Fornecedor {
  id: string; razao_social: string; nome_fantasia: string | null; cnpj: string | null;
  telefone: string | null; email: string | null; contato: string | null; cidade: string | null;
  uf: string | null; categoria: string; prazo_entrega_dias: number; ativo: boolean;
}

const CATS: [string, string][] = [
  ["materia_prima", "Matéria-prima"], ["servico", "Serviço"], ["embalagem", "Embalagem"],
  ["ferramental", "Ferramental"], ["outros", "Outros"],
];
const catLabel = (c: string) => CATS.find(x => x[0] === c)?.[1] ?? c.replace("_", " ");
const catColor = (c: string) =>
  c === "materia_prima" ? "text-blue-700 bg-blue-500/10 dark:text-blue-300"
  : c === "ferramental" ? "text-orange-700 bg-orange-500/10 dark:text-orange-300"
  : c === "servico" ? "text-purple-700 bg-purple-500/10 dark:text-purple-300"
  : c === "embalagem" ? "text-cyan-700 bg-cyan-500/10 dark:text-cyan-300"
  : "text-muted-foreground bg-muted";

const LBL = "text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const SEL = "h-11 w-full rounded-xl border border-input bg-background px-3 text-sm";

function FornDialog({ item, onClose, onSaved }: { item: Fornecedor | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    razao_social: item?.razao_social || "", nome_fantasia: item?.nome_fantasia || "",
    cnpj: item?.cnpj || "", telefone: item?.telefone || "", email: item?.email || "",
    contato: item?.contato || "", cidade: item?.cidade || "", uf: item?.uf || "",
    categoria: item?.categoria || "materia_prima", prazo_entrega_dias: String(item?.prazo_entrega_dias || 0),
  });
  const [saving, setSaving] = useState(false);
  const f = (k: keyof typeof form) => ({ value: form[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value })) });

  async function save() {
    if (!form.razao_social.trim()) { toast.error("Informe a razão social."); return; }
    setSaving(true);
    const payload = { ...form, razao_social: form.razao_social.trim(), uf: form.uf.toUpperCase(), prazo_entrega_dias: parseInt(form.prazo_entrega_dias) || 0 };
    const { error } = item
      ? await supabase.from("fornecedores").update(payload).eq("id", item.id)
      : await supabase.from("fornecedores").insert(payload);
    setSaving(false);
    if (error) { toast.error(friendlyError(error, "Não foi possível salvar o fornecedor.")); return; }
    toast.success(item ? "Fornecedor atualizado." : "Fornecedor cadastrado.");
    onSaved(); onClose();
  }

  return (
    <Dialog open onOpenChange={v => { if (!v && !saving) onClose(); }}>
      <DialogContent className="max-w-lg w-[calc(100vw-1.5rem)] max-h-[90vh] overflow-y-auto rounded-2xl">
        <DialogHeader className="text-left"><DialogTitle>{item ? "Editar fornecedor" : "Novo fornecedor"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1.5"><span className={LBL}>Razão social *</span><Input {...f("razao_social")} className="h-11" /></label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block space-y-1.5"><span className={LBL}>Nome fantasia</span><Input {...f("nome_fantasia")} className="h-11" /></label>
            <label className="block space-y-1.5"><span className={LBL}>CNPJ</span><Input {...f("cnpj")} placeholder="00.000.000/0001-00" inputMode="numeric" className="h-11" /></label>
            <label className="block space-y-1.5"><span className={LBL}>Telefone</span><Input {...f("telefone")} inputMode="tel" className="h-11" /></label>
            <label className="block space-y-1.5"><span className={LBL}>E-mail</span><Input {...f("email")} type="email" className="h-11" /></label>
            <label className="block space-y-1.5"><span className={LBL}>Contato</span><Input {...f("contato")} className="h-11" /></label>
            <label className="block space-y-1.5"><span className={LBL}>Categoria</span>
              <select value={form.categoria} onChange={e => setForm(p => ({ ...p, categoria: e.target.value }))} className={SEL}>
                {CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-[1fr_5rem] gap-3">
            <label className="block space-y-1.5"><span className={LBL}>Cidade</span><Input {...f("cidade")} className="h-11" /></label>
            <label className="block space-y-1.5"><span className={LBL}>UF</span><Input {...f("uf")} maxLength={2} className="h-11 uppercase" /></label>
          </div>
          <label className="block space-y-1.5"><span className={LBL}>Prazo de entrega (dias)</span><Input type="number" min="0" inputMode="numeric" {...f("prazo_entrega_dias")} className="h-11" /></label>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button className="h-11 gap-1.5" onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FornecedoresPanel() {
  const [items, setItems] = useState<Fornecedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<Fornecedor | null | "novo">(null);
  const [remover, setRemover] = useState<Fornecedor | null>(null);
  const [removendo, setRemovendo] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("fornecedores").select("*").eq("ativo", true).order("razao_social");
    if (error) toast.error(friendlyError(error, "Não foi possível carregar os fornecedores."));
    if (data) setItems(data as Fornecedor[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter(f => !q || [f.razao_social, f.nome_fantasia || "", f.cnpj || "", f.contato || "", f.cidade || ""].some(v => v.toLowerCase().includes(q)));
  }, [items, search]);

  async function confirmarRemocao() {
    if (!remover) return;
    setRemovendo(true);
    const { error } = await supabase.from("fornecedores").update({ ativo: false }).eq("id", remover.id);
    setRemovendo(false);
    if (error) { toast.error(friendlyError(error, "Não foi possível remover o fornecedor.")); return; }
    toast.success("Fornecedor removido.");
    setRemover(null);
    load();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Nome, CNPJ, contato ou cidade..." className="pl-9 h-11" />
        </div>
        <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={load} disabled={loading} aria-label="Atualizar">
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
        <Button className="h-11 gap-1.5 shrink-0" onClick={() => setModal("novo")}><Plus className="h-4 w-4" /><span className="hidden sm:inline">Novo fornecedor</span><span className="sm:hidden">Novo</span></Button>
      </div>

      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2"><Loader2 className="h-4 w-4 animate-spin" />Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card py-12 px-4 text-center space-y-2">
          <Building2 className="h-9 w-9 mx-auto text-muted-foreground/40" />
          <p className="font-medium">{search ? "Nenhum fornecedor encontrado" : "Nenhum fornecedor cadastrado"}</p>
          {!search && <Button className="h-11 gap-1.5 mt-1" onClick={() => setModal("novo")}><Plus className="h-4 w-4" />Cadastrar fornecedor</Button>}
        </div>
      ) : (
        <ul className="rounded-2xl border bg-card divide-y overflow-hidden">
          {filtered.map(f => (
            <li key={f.id} className="p-3 sm:px-4 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="font-semibold truncate">{f.razao_social}</p>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", catColor(f.categoria))}>{catLabel(f.categoria)}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 break-words">
                  {[f.nome_fantasia, f.cnpj, f.contato, f.telefone, f.cidade ? `${f.cidade}${f.uf ? "/" + f.uf : ""}` : null, f.prazo_entrega_dias > 0 ? `prazo ${f.prazo_entrega_dias} dias` : null].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="flex gap-1 shrink-0">
                <Button variant="ghost" size="icon" className="h-10 w-10" onClick={() => setModal(f)} aria-label="Editar fornecedor"><Pencil className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" className="h-10 w-10 text-muted-foreground hover:text-red-600" onClick={() => setRemover(f)} aria-label="Remover fornecedor"><Trash2 className="h-4 w-4" /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {modal && <FornDialog item={modal === "novo" ? null : modal} onClose={() => setModal(null)} onSaved={load} />}

      <AlertDialog open={!!remover} onOpenChange={v => { if (!v && !removendo) setRemover(null); }}>
        <AlertDialogContent className="w-[calc(100vw-1.5rem)] rounded-2xl">
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle>Remover fornecedor?</AlertDialogTitle>
            <AlertDialogDescription>
              {remover?.razao_social} deixa de aparecer nas listas. Pedidos de compra antigos continuam com o nome dele.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11" disabled={removendo}>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={removendo}
              onClick={e => { e.preventDefault(); confirmarRemocao(); }}>
              {removendo && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
