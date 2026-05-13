import { useState, useEffect, useCallback } from "react";
import { displayLote } from "@/lib/lote";
import {
  PackagePlus,
  Tag,
  Package,
  Clock,
  CheckCircle2,
  Inbox,
  Trash2,
  FileText,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { RecebimentoMaterialModal } from "./RecebimentoMaterialModal";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ─── Tipos ────────────────────────────────────────────────────────────────────
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

// ─── Card de Recebimento ──────────────────────────────────────────────────────
interface RecebimentoCardProps {
  item: RecebimentoItem;
  onRetirar: (item: RecebimentoItem) => void;
  onDelete: (item: RecebimentoItem) => void;
  isAdmin: boolean;
}

function RecebimentoCard({ item, onRetirar, onDelete, isAdmin }: RecebimentoCardProps) {
  const isAtivo = item.status === "ativo";

  return (
    <div
      className={cn(
        "group relative rounded-2xl bg-card overflow-hidden transition-all duration-300 hover:-translate-y-0.5",
      )}
      style={{
        boxShadow:
          "0 1px 2px hsl(var(--border) / 0.3), 0 4px 12px -2px hsl(var(--border) / 0.15), inset 0 1px 0 hsl(0 0% 100% / 0.06)",
      }}
    >
      <div className={cn(
        "h-0.5 bg-gradient-to-r from-transparent to-transparent transition-opacity group-hover:opacity-100",
        isAtivo ? "via-cyan-500 opacity-60" : "via-muted-foreground/40 opacity-30"
      )} />

      <div className="p-4 space-y-3">
        {/* Cabeçalho */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <h3 className="text-[13px] font-semibold leading-snug text-foreground line-clamp-2">
              {item.descricao}
            </h3>
            {item.fornecedor && (
              <p className="text-[11px] text-muted-foreground/70 truncate">{item.fornecedor}</p>
            )}
          </div>
          <Badge
            variant="outline"
            className={cn(
              "shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-lg",
              isAtivo
                ? "border-cyan-500/25 text-cyan-600 bg-cyan-500/5 dark:text-cyan-400"
                : "border-border/40 text-muted-foreground bg-muted/20"
            )}
          >
            {isAtivo ? "Ativo" : "Retirado"}
          </Badge>
        </div>

        {/* Lote */}
        {displayLote(item.lote) && (
          <div className="flex items-center gap-1.5 text-[11px]">
            <Tag className={cn("h-3 w-3", isAtivo ? "text-cyan-500" : "text-muted-foreground/50")} />
            <span className={cn("font-mono font-semibold tracking-widest", isAtivo ? "text-cyan-600 dark:text-cyan-400" : "text-muted-foreground")}>
              {displayLote(item.lote)}
            </span>
          </div>
        )}

        {/* Quantidade */}
        <div className={cn(
          "flex items-center justify-between rounded-xl px-3 py-2 border",
          isAtivo ? "bg-cyan-500/8 border-cyan-500/25" : "bg-muted/20 border-border/30"
        )}>
          <div className="flex items-center gap-1.5">
            <Package className={cn("h-3.5 w-3.5", isAtivo ? "text-cyan-500" : "text-muted-foreground/50")} />
            <span className="text-[11px] font-medium text-muted-foreground">Quantidade</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={cn("text-[15px] font-bold tabular-nums", isAtivo ? "text-cyan-600 dark:text-cyan-400" : "text-muted-foreground")}>
              {item.quantity}
            </span>
            <span className="text-[10px] text-muted-foreground">un.</span>
          </div>
        </div>

        {/* Info de retirada */}
        {!isAtivo && item.retirado_por && (
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
            <CheckCircle2 className="h-3 w-3" />
            <span>Retirado por <span className="font-medium">{item.retirado_por}</span></span>
            {item.retirado_em && (
              <span>· {new Date(item.retirado_em).toLocaleDateString("pt-BR")}</span>
            )}
          </div>
        )}

        {/* Rodapé: quem recebeu + data */}
        <div className="flex items-center justify-between text-[10px] text-muted-foreground/50 pt-1 border-t border-border/20">
          <div className="flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" />
            <span>{new Date(item.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
          </div>
          {item.user_display_name && (
            <span className="truncate ml-2">{item.user_display_name}</span>
          )}
        </div>

        {/* Botões */}
        <div className="space-y-1.5 pt-1 border-t border-border/20">
          {isAtivo && (
            <button
              type="button"
              onClick={() => onRetirar(item)}
              className="w-full flex items-center justify-center gap-1.5 h-8 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 text-[11px] font-medium transition-colors"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Confirmar Retirada
            </button>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={() => onDelete(item)}
              className="w-full flex items-center justify-center gap-1 h-7 rounded-lg bg-muted/30 hover:bg-destructive/15 hover:text-destructive text-muted-foreground text-[10px] transition-colors"
            >
              <Trash2 className="h-3 w-3" /> Excluir
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Modal de Confirmação de Retirada ─────────────────────────────────────────
interface RetiradaModalProps {
  item: RecebimentoItem | null;
  onClose: () => void;
  onSuccess: () => void;
}

function RetiradaModal({ item, onClose, onSuccess }: RetiradaModalProps) {
  const { user } = useAuth();
  const displayName: string | null =
    (user?.user_metadata?.display_name as string) ?? user?.email ?? null;
  const [loading, setLoading] = useState(false);

  async function handleConfirmar() {
    if (!item) return;
    setLoading(true);
    const { error } = await supabase
      .from("recebimento_materiais")
      .update({
        status: "retirado",
        retirado_por: displayName,
        retirado_em: new Date().toISOString(),
      })
      .eq("id", item.id);
    setLoading(false);
    if (error) {
      toast.error("Erro ao confirmar retirada. Tente novamente.");
    } else {
      toast.success("Retirada confirmada!", {
        description: `${item.quantity} un.${displayLote(item.lote) ? ` · Lote ${displayLote(item.lote)}` : ""}`,
      });
      onSuccess();
      onClose();
    }
  }

  if (!item) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-card border border-border/30 p-5 space-y-4 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl bg-cyan-500/10 flex items-center justify-center shrink-0">
            <CheckCircle2 className="h-4 w-4 text-cyan-500" />
          </div>
          <div>
            <p className="text-sm font-semibold">Confirmar retirada do material?</p>
            <p className="text-[12px] text-muted-foreground mt-0.5 line-clamp-2">
              {item.descricao}
            </p>
            <p className="text-[11px] font-mono text-cyan-600 dark:text-cyan-400 mt-0.5">
              {displayLote(item.lote) ? `Lote ${displayLote(item.lote)} · ` : ""}{item.quantity} un.
            </p>
          </div>
        </div>
        <p className="text-[12px] text-muted-foreground">
          Ao confirmar, este recebimento será marcado como <strong>Retirado</strong> e não poderá ser reativado.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors"
            onClick={onClose}
            disabled={loading}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="flex-1 h-9 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5"
            onClick={handleConfirmar}
            disabled={loading}
          >
            {loading
              ? <span className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin inline-block" />
              : <CheckCircle2 className="h-3.5 w-3.5" />}
            Confirmar Retirada
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Painel principal ─────────────────────────────────────────────────────────
interface RecebimentoPanelProps {
  isAdmin: boolean;
}

export function RecebimentoPanel({ isAdmin }: RecebimentoPanelProps) {
  const [items, setItems] = useState<RecebimentoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAtivos, setShowAtivos] = useState<"todos" | "ativos" | "retirados">("ativos");

  const [addOpen, setAddOpen] = useState(false);
  const [retirarItem, setRetirarItem] = useState<RecebimentoItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<RecebimentoItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("recebimento_materiais")
      .select("*")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast.error("Erro ao carregar recebimentos. Verifique sua conexão.");
    } else {
      setItems((data ?? []) as RecebimentoItem[]);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const filteredItems = items.filter((item) => {
    if (showAtivos === "ativos" && item.status !== "ativo") return false;
    if (showAtivos === "retirados" && item.status !== "retirado") return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return (
        item.lote.toLowerCase().includes(q) ||
        item.descricao.toLowerCase().includes(q) ||
        item.fornecedor?.toLowerCase().includes(q) ||
        item.user_display_name?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const countAtivos = items.filter((i) => i.status === "ativo").length;
  const countRetirados = items.filter((i) => i.status === "retirado").length;

  async function handleDelete() {
    if (!deleteItem) return;
    setDeleting(true);
    const { error } = await supabase
      .from("recebimento_materiais")
      .delete()
      .eq("id", deleteItem.id);
    setDeleting(false);
    if (error) {
      toast.error("Erro ao excluir recebimento. Tente novamente.");
    } else {
      toast.success("Recebimento excluído.");
      setDeleteItem(null);
      fetchItems();
    }
  }

  return (
    <div className="space-y-4">
      {/* Barra de ações */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1 rounded-xl border border-border bg-muted/20 p-1 w-full sm:w-auto overflow-x-auto">
          {([
            { value: "ativos", label: "Ativos", count: countAtivos },
            { value: "retirados", label: "Retirados", count: countRetirados },
            { value: "todos", label: "Todos", count: items.length },
          ] as const).map(({ value, label, count }) => (
            <button
              key={value}
              type="button"
              onClick={() => setShowAtivos(value)}
              className={cn(
                "flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12px] font-medium transition-all whitespace-nowrap flex-1 justify-center sm:flex-none sm:justify-start",
                showAtivos === value
                  ? value === "ativos"
                    ? "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400"
                    : "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
              <span className={cn(
                "text-[10px] font-bold px-1 py-0.5 rounded-full",
                showAtivos === value
                  ? value === "ativos" ? "bg-cyan-500/20 text-cyan-600 dark:text-cyan-400" : "bg-primary/15 text-primary"
                  : "bg-muted/50 text-muted-foreground"
              )}>
                {count}
              </span>
            </button>
          ))}
        </div>

        <Button
          size="sm"
          className="h-9 gap-1.5 text-xs rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white w-full sm:w-auto shrink-0"
          onClick={() => setAddOpen(true)}
        >
          <PackagePlus className="h-3.5 w-3.5" /> Registrar Recebimento
        </Button>
      </div>

      {/* Busca */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Buscar por lote, descrição, fornecedor..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 pr-10 h-11 text-sm bg-card"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Descrição da aba */}
      <div className="rounded-xl border px-4 py-3 text-[12px] bg-cyan-500/5 border-cyan-500/20 text-cyan-700 dark:text-cyan-300">
        Registre a chegada de materiais informando o lote, a quantidade e a descrição. Quando o material for retirado, confirme a baixa aqui.
      </div>

      {/* Resumo */}
      {!loading && (
        <p className="text-xs text-muted-foreground">
          {filteredItems.length} registro{filteredItems.length !== 1 ? "s" : ""}
          {search && <span className="text-primary/70"> (filtrado)</span>}
        </p>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="animate-spin h-8 w-8 border-2 border-cyan-500 border-t-transparent rounded-full" />
          <p className="text-sm text-muted-foreground">Carregando recebimentos...</p>
        </div>
      )}

      {/* Vazio */}
      {!loading && filteredItems.length === 0 && (
        <div className="text-center py-20 space-y-3">
          <Inbox className="h-10 w-10 text-muted-foreground/40 mx-auto" />
          <p className="text-muted-foreground font-medium">
            {search ? "Nenhum registro encontrado" : showAtivos === "ativos" ? "Nenhum material ativo no momento" : showAtivos === "retirados" ? "Nenhum material retirado ainda" : "Nenhum recebimento registrado"}
          </p>
          <p className="text-sm text-muted-foreground/60">
            {search ? "Tente outro termo de busca" : "Use o botão acima para registrar a chegada de materiais"}
          </p>
          {!search && (
            <Button
              className="mt-2 gap-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white"
              onClick={() => setAddOpen(true)}
            >
              <PackagePlus className="h-4 w-4" /> Registrar primeiro recebimento
            </Button>
          )}
        </div>
      )}

      {/* Grid de cards */}
      {!loading && filteredItems.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filteredItems.map((item) => (
            <RecebimentoCard
              key={item.id}
              item={item}
              onRetirar={setRetirarItem}
              onDelete={setDeleteItem}
              isAdmin={isAdmin}
            />
          ))}
        </div>
      )}

      {/* Modal de novo recebimento */}
      <RecebimentoMaterialModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSuccess={fetchItems}
      />

      {/* Modal de retirada */}
      {retirarItem && (
        <RetiradaModal
          item={retirarItem}
          onClose={() => setRetirarItem(null)}
          onSuccess={fetchItems}
        />
      )}

      {/* Confirmação de exclusão */}
      <AlertDialog
        open={!!deleteItem}
        onOpenChange={(v) => { if (!v) setDeleteItem(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-4 w-4" /> Excluir recebimento?
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span className="block">
                Excluir o registro{displayLote(deleteItem?.lote) ? <> do lote <strong className="font-mono">{displayLote(deleteItem?.lote)}</strong></> : ""} — {deleteItem?.descricao}?
              </span>
              <span className="block mt-1 text-xs text-muted-foreground">Esta ação é irreversível.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
