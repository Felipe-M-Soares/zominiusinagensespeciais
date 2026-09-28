/**
 * RecebimentoPanel — aba "Recebimento" do Estoque: chegada de materiais de
 * embalagem (etiqueta, envelope, sachê) por lote, e a baixa quando retirados.
 * Recebimentos ainda ATIVOS podem ser corrigidos (lote, tipo, quantidade,
 * descrição, fornecedor); retirados ficam só para consulta.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { displayLote } from "@/lib/lote";
import { CheckCircle2, Clock, Inbox, Loader2, PackagePlus, Pencil, Tag, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { RecebimentoMaterialModal, parseTipoMaterial, stripTipoPrefix, TIPO_MATERIAL_LABEL, TIPO_MATERIAL_ICON, type TipoMaterial } from "./RecebimentoMaterialModal";
import { SearchInputWithBarcode } from "@/components/SearchInputWithBarcode";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Chip, fmtDataHora, fmtNum } from "./estoqueUi";

export interface RecebimentoItem {
  id: string;
  lote: string;
  quantity: number;
  descricao: string;
  fornecedor: string | null;
  status: "ativo" | "retirado";
  user_id: string | null;
  user_display_name: string | null;
  retirado_por: string | null;
  retirado_em: string | null;
  created_at: string;
}

interface RecebimentoPanelProps {
  isAdmin: boolean;
}

export function RecebimentoPanel({ isAdmin }: RecebimentoPanelProps) {
  const { user } = useAuth();
  const displayName = (user?.user_metadata?.display_name as string | undefined) ?? user?.email ?? null;
  const [items, setItems] = useState<RecebimentoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAtivos, setShowAtivos] = useState<"todos" | "ativos" | "retirados">("ativos");
  const [filtroTipo, setFiltroTipo] = useState<"todos" | TipoMaterial>("todos");

  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<RecebimentoItem | null>(null);
  const [retirarItem, setRetirarItem] = useState<RecebimentoItem | null>(null);
  const [retirando, setRetirando] = useState(false);
  const [deleteItem, setDeleteItem] = useState<RecebimentoItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("recebimento_materiais")
      .select("*")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) toast.error("Erro ao carregar recebimentos. Verifique sua conexão.");
    else setItems((data ?? []) as RecebimentoItem[]);
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const filteredItems = useMemo(() => items.filter((item) => {
    if (showAtivos === "ativos" && item.status !== "ativo") return false;
    if (showAtivos === "retirados" && item.status !== "retirado") return false;
    if (filtroTipo !== "todos" && parseTipoMaterial(item.descricao) !== filtroTipo) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return (
        item.lote.toLowerCase().includes(q) ||
        item.descricao.toLowerCase().includes(q) ||
        !!item.fornecedor?.toLowerCase().includes(q) ||
        !!item.user_display_name?.toLowerCase().includes(q)
      );
    }
    return true;
  }), [items, showAtivos, filtroTipo, search]);

  const countPorTipo = (t: TipoMaterial) => items.filter((i) => parseTipoMaterial(i.descricao) === t).length;
  const countAtivos = items.filter((i) => i.status === "ativo").length;
  const countRetirados = items.filter((i) => i.status === "retirado").length;

  async function handleRetirar() {
    if (!retirarItem) return;
    setRetirando(true);
    const { error } = await supabase
      .from("recebimento_materiais")
      .update({ status: "retirado", retirado_por: displayName, retirado_em: new Date().toISOString() })
      .eq("id", retirarItem.id);
    setRetirando(false);
    if (error) { toast.error("Erro ao confirmar retirada. Tente novamente."); return; }
    toast.success("Retirada confirmada!", {
      description: `${retirarItem.quantity} un.${displayLote(retirarItem.lote) ? ` · Lote ${displayLote(retirarItem.lote)}` : ""}`,
    });
    setRetirarItem(null);
    fetchItems();
  }

  async function handleDelete() {
    if (!deleteItem) return;
    setDeleting(true);
    const { error } = await supabase.from("recebimento_materiais").delete().eq("id", deleteItem.id);
    setDeleting(false);
    if (error) { toast.error("Erro ao excluir recebimento. Tente novamente."); return; }
    toast.success("Recebimento excluído.");
    setDeleteItem(null);
    fetchItems();
  }

  return (
    <div className="space-y-3">
      {/* Resumo */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {([
          ["ativos", "Ativos", countAtivos, "text-cyan-700 dark:text-cyan-400"],
          ["retirados", "Retirados", countRetirados, "text-muted-foreground"],
          ["todos", "Todos", items.length, "text-foreground"],
        ] as const).map(([id, l, v, cls]) => (
          <button key={id} type="button" onClick={() => setShowAtivos(id)}
            className={cn("rounded-2xl border bg-card p-3 sm:p-4 text-left hover:bg-muted/40", showAtivos === id && "ring-2 ring-primary/40")}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{l}</p>
            <p className={cn("mt-1 text-xl sm:text-2xl font-bold tabular-nums", cls)}>{loading && items.length === 0 ? "—" : v}</p>
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <SearchInputWithBarcode
          className="flex-1 min-w-0"
          value={search}
          onChange={setSearch}
          onSearch={setSearch}
          placeholder="Lote, descrição ou fornecedor"
          height="h-11"
        />
        <Button className="h-11 gap-1.5 shrink-0 bg-cyan-600 hover:bg-cyan-700 text-white" onClick={() => setAddOpen(true)}>
          <PackagePlus className="h-4 w-4" /><span className="hidden sm:inline">Registrar recebimento</span><span className="sm:hidden">Registrar</span>
        </Button>
      </div>

      {/* Filtro por tipo */}
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none -mx-3 px-3 sm:mx-0 sm:px-0">
        <button type="button" onClick={() => setFiltroTipo("todos")}
          className={cn("h-9 shrink-0 rounded-full border px-3 text-sm font-medium", filtroTipo === "todos" ? "bg-foreground text-background border-foreground" : "bg-card text-muted-foreground hover:text-foreground")}>
          Todos os tipos
        </button>
        {(Object.keys(TIPO_MATERIAL_LABEL) as TipoMaterial[]).map((t) => {
          const Icon = TIPO_MATERIAL_ICON[t];
          return (
            <button key={t} type="button" onClick={() => setFiltroTipo(t)}
              className={cn("h-9 shrink-0 rounded-full border px-3 text-sm font-medium inline-flex items-center gap-1.5",
                filtroTipo === t ? "bg-foreground text-background border-foreground" : "bg-card text-muted-foreground hover:text-foreground")}>
              <Icon className="h-3.5 w-3.5" />{TIPO_MATERIAL_LABEL[t]}<span className="text-xs tabular-nums opacity-80">{countPorTipo(t)}</span>
            </button>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Registre a chegada de materiais de embalagem com lote, tipo e quantidade. Quando o material for usado, confirme a retirada.
      </p>

      {loading && items.length === 0 ? (
        <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card py-12 px-4 text-center space-y-2">
          <Inbox className="h-9 w-9 mx-auto text-muted-foreground/40" />
          <p className="font-medium">
            {search ? "Nenhum registro encontrado" : showAtivos === "ativos" ? "Nenhum material ativo no momento" : showAtivos === "retirados" ? "Nenhum material retirado ainda" : "Nenhum recebimento registrado"}
          </p>
          <p className="text-sm text-muted-foreground">{search ? "Tente outro termo de busca." : "Use “Registrar” para lançar a chegada de materiais."}</p>
          {!search && (
            <Button className="h-11 gap-1.5 mt-1 bg-cyan-600 hover:bg-cyan-700 text-white" onClick={() => setAddOpen(true)}>
              <PackagePlus className="h-4 w-4" />Registrar recebimento
            </Button>
          )}
        </div>
      ) : (
        <ul className="rounded-2xl border bg-card divide-y overflow-hidden">
          {filteredItems.map((item) => {
            const ativo = item.status === "ativo";
            const tipo = parseTipoMaterial(item.descricao);
            const TipoIcon = tipo ? TIPO_MATERIAL_ICON[tipo] : null;
            return (
              <li key={item.id} className={cn("p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4", !ativo && "opacity-75")}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {tipo && TipoIcon && <Chip className="bg-cyan-500/10 text-cyan-700 dark:text-cyan-400"><TipoIcon className="h-3 w-3" />{TIPO_MATERIAL_LABEL[tipo]}</Chip>}
                    <Chip className={ativo ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"}>{ativo ? "Ativo" : "Retirado"}</Chip>
                  </div>
                  <p className="mt-1 font-semibold leading-snug">{stripTipoPrefix(item.descricao)}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    {displayLote(item.lote) && <span className="inline-flex items-center gap-1 font-mono font-semibold text-foreground/80"><Tag className="h-3 w-3" />{displayLote(item.lote)}</span>}
                    {item.fornecedor && <span>{item.fornecedor}</span>}
                    <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{fmtDataHora(item.created_at)}{item.user_display_name ? ` · ${item.user_display_name}` : ""}</span>
                    {!ativo && item.retirado_por && (
                      <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />Retirado por {item.retirado_por}{item.retirado_em ? ` em ${new Date(item.retirado_em).toLocaleDateString("pt-BR")}` : ""}</span>
                    )}
                  </div>
                </div>
                <p className="text-lg font-bold tabular-nums sm:w-28 sm:text-right">{fmtNum(item.quantity)} <span className="text-xs font-normal text-muted-foreground">un.</span></p>
                <div className="flex gap-1.5 sm:w-auto sm:justify-end">
                  {ativo && (
                    <>
                      <Button className="h-10 gap-1.5 flex-1 sm:flex-none bg-cyan-600 hover:bg-cyan-700 text-white" onClick={() => setRetirarItem(item)}>
                        <CheckCircle2 className="h-4 w-4" />Confirmar retirada
                      </Button>
                      <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => setEditItem(item)} aria-label="Editar recebimento" title="Editar">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                  {isAdmin && (
                    <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 text-muted-foreground hover:text-red-600" onClick={() => setDeleteItem(item)} aria-label="Excluir recebimento" title="Excluir">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <RecebimentoMaterialModal
        open={addOpen || !!editItem}
        editar={editItem}
        onClose={() => { setAddOpen(false); setEditItem(null); }}
        onSuccess={fetchItems}
      />

      {/* Confirmar retirada */}
      <AlertDialog open={!!retirarItem} onOpenChange={(v) => { if (!v && !retirando) setRetirarItem(null); }}>
        <AlertDialogContent className="w-[calc(100vw-1.5rem)] rounded-2xl">
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-cyan-600" />Confirmar retirada do material?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p className="font-medium text-foreground">{retirarItem ? stripTipoPrefix(retirarItem.descricao) : ""}</p>
                <p className="font-mono text-xs">{displayLote(retirarItem?.lote) ? `Lote ${displayLote(retirarItem?.lote)} · ` : ""}{retirarItem?.quantity} un.</p>
                <p>O recebimento passa para <strong>Retirado</strong> e não pode ser reativado.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11" disabled={retirando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="h-11 bg-cyan-600 hover:bg-cyan-700 text-white" disabled={retirando}
              onClick={e => { e.preventDefault(); handleRetirar(); }}>
              {retirando && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}Confirmar retirada
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Excluir (admin) */}
      <AlertDialog open={!!deleteItem} onOpenChange={(v) => { if (!v && !deleting) setDeleteItem(null); }}>
        <AlertDialogContent className="w-[calc(100vw-1.5rem)] rounded-2xl">
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400"><Trash2 className="h-5 w-5" />Excluir recebimento?</AlertDialogTitle>
            <AlertDialogDescription>
              {displayLote(deleteItem?.lote) ? <>Lote <strong className="font-mono">{displayLote(deleteItem?.lote)}</strong> — </> : null}
              {deleteItem ? stripTipoPrefix(deleteItem.descricao) : ""}. Esta ação é irreversível.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11" disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={deleting}
              onClick={e => { e.preventDefault(); handleDelete(); }}>
              {deleting && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
