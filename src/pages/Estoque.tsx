import { useState, useCallback, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useStock } from "@/hooks/useStock";
import type { StockItem } from "@/hooks/useStock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  ArrowDownCircle,
  ArrowUpCircle,
  Clock,
  Plus,
  ScanBarcode,
  Search,
  X,
  Package,
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  Boxes,
  List,
  Trash2,
  History,
  DatabaseBackup,
  Tag,
} from "lucide-react";
import { MovementModal } from "@/components/stock/MovementModal";
import { StockHistoryPanel } from "@/components/stock/StockHistoryPanel";
import { AddToStockModal } from "@/components/stock/AddToStockModal";
import { StockListModal } from "@/components/stock/StockListModal";
import { LotesPanel } from "@/components/stock/LotesPanel";
import { AllMovementsModal } from "@/components/stock/AllMovementsModal";
import { BackupPanel } from "@/components/stock/BackupPanel";
import { deleteStockItem, fetchLotesSummary } from "@/hooks/useStock";
import type { LoteSummary } from "@/hooks/useStock";
import { cn } from "@/lib/utils";

// ─── Componente de card de item do estoque ────────────────────────────────────

interface StockCardProps {
  item: StockItem;
  onMovement: (item: StockItem, type: "entrada" | "saida") => void;
  onHistory: (item: StockItem) => void;
  onDelete: (item: StockItem) => void;
  onLotes: (item: StockItem) => void;
  loteCount: number;
}

function StockCard({ item, onMovement, onHistory, onDelete, onLotes, loteCount }: StockCardProps) {
  const d = item.device;
  const isLow = item.quantity > 0 && item.quantity <= item.min_quantity;
  const isEmpty = item.quantity === 0;

  return (
    <div
      className="group relative rounded-2xl bg-card overflow-hidden transition-all duration-300 hover:-translate-y-0.5"
      style={{
        boxShadow:
          "0 1px 2px hsl(var(--border) / 0.3), 0 4px 12px -2px hsl(var(--border) / 0.15), inset 0 1px 0 hsl(0 0% 100% / 0.06)",
      }}
    >
      {/* Top accent bar — vermelho se zerado, amarelo se baixo, verde normal */}
      <div
        className={cn(
          "h-0.5 bg-gradient-to-r from-transparent to-transparent transition-opacity group-hover:opacity-100",
          isEmpty
            ? "via-destructive opacity-80"
            : isLow
            ? "via-warning opacity-70"
            : "via-success opacity-50"
        )}
      />

      <div className="p-4 space-y-3">
        {/* Cabeçalho */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <h3 className="text-[13px] font-semibold leading-snug text-foreground line-clamp-2">
              {d.model}
            </h3>
            <p className="text-[11px] text-muted-foreground font-mono tracking-tight">{d.reference}</p>
          </div>
          <Badge
            variant="outline"
            className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 border-primary/25 text-primary/80 bg-primary/5 rounded-lg"
          >
            {d.classification_code}
          </Badge>
        </div>

        {/* UDI */}
        <p className="text-[10px] text-muted-foreground/60 font-mono truncate -mt-1">
          {d.udi_di}
        </p>

        {/* Quantidade — destaque visual */}
        <div
          className={cn(
            "flex items-center justify-between rounded-xl px-3 py-2 border",
            isEmpty
              ? "bg-destructive/8 border-destructive/25"
              : isLow
              ? "bg-warning/8 border-warning/25"
              : "bg-success/8 border-success/25"
          )}
        >
          <div className="flex items-center gap-1.5">
            <Package
              className={cn(
                "h-3.5 w-3.5",
                isEmpty ? "text-destructive" : isLow ? "text-warning" : "text-success"
              )}
            />
            <span className="text-[11px] font-medium text-muted-foreground">Estoque</span>
          </div>
          <div className="flex items-center gap-1.5">
            {isEmpty && <AlertTriangle className="h-3 w-3 text-destructive" />}
            {isLow && !isEmpty && <TrendingDown className="h-3 w-3 text-warning" />}
            <span
              className={cn(
                "text-[15px] font-bold tabular-nums",
                isEmpty ? "text-destructive" : isLow ? "text-warning" : "text-foreground"
              )}
            >
              {item.quantity}
            </span>
            <span className="text-[10px] text-muted-foreground">un.</span>
          </div>
        </div>

        {/* Lotes registrados */}
        {loteCount > 0 && (
          <button
            type="button"
            onClick={() => onLotes(item)}
            className="flex items-center gap-1.5 text-[11px] text-primary/70 hover:text-primary transition-colors -mt-1"
          >
            <Tag className="h-3 w-3" />
            <span className="font-medium">{loteCount} lote{loteCount > 1 ? "s" : ""} registrado{loteCount > 1 ? "s" : ""}</span>
            <span className="text-muted-foreground/40">→</span>
          </button>
        )}

        {/* Min e localização */}
        <div className="flex items-center justify-between text-[10px] text-muted-foreground/60">
          <span>Mín: {item.min_quantity} un.</span>
          {item.location && (
            <span className="truncate ml-2">📍 {item.location}</span>
          )}
        </div>

        {/* Botões de ação */}
        <div className="flex gap-1.5 pt-1 border-t border-border/20">
          <button
            type="button"
            onClick={() => onMovement(item, "entrada")}
            className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg bg-primary/8 hover:bg-primary/15 text-primary text-[11px] font-medium transition-colors"
          >
            <ArrowDownCircle className="h-3.5 w-3.5" />
            Entrada
          </button>
          <button
            type="button"
            onClick={() => onMovement(item, "saida")}
            className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg bg-destructive/8 hover:bg-destructive/15 text-destructive text-[11px] font-medium transition-colors"
          >
            <ArrowUpCircle className="h-3.5 w-3.5" />
            Saída
          </button>
          <button
            type="button"
            onClick={() => onHistory(item)}
            className="h-8 w-8 flex items-center justify-center rounded-lg bg-muted/30 hover:bg-muted/60 text-muted-foreground transition-colors"
            title="Histórico"
          >
            <Clock className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onLotes(item)}
            className="h-8 w-8 flex items-center justify-center rounded-lg bg-muted/30 hover:bg-primary/10 hover:text-primary text-muted-foreground transition-colors"
            title="Lotes"
          >
            <Tag className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(item)}
            className="h-8 w-8 flex items-center justify-center rounded-lg bg-muted/30 hover:bg-destructive/15 hover:text-destructive text-muted-foreground transition-colors"
            title="Remover peça do estoque"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function Estoque() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  // Pesquisa
  const [search, setSearch] = useState("");
  const [querySearch, setQuerySearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Modais
  const [movementState, setMovementState] = useState<{ item: StockItem; type: "entrada" | "saida" } | null>(null);
  const [historyItem, setHistoryItem] = useState<StockItem | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [allMovOpen, setAllMovOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [deleteItem, setDeleteItem] = useState<StockItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [lotesItem, setLotesItem] = useState<StockItem | null>(null);

  const { items, totalCount, loading, error, refetch } = useStock(querySearch);
  const [lotesSummary, setLotesSummary] = useState<Map<string, number>>(new Map());

  // Carrega contagem de lotes para cada item
  useEffect(() => {
    if (items.length === 0) { setLotesSummary(new Map()); return; }
    (async () => {
      const entries = await Promise.all(
        items.map(async (item) => {
          const lotes = await fetchLotesSummary(item.id);
          return [item.id, lotes.length] as [string, number];
        })
      );
      setLotesSummary(new Map(entries));
    })();
  }, [items]);

  const handleSearchChange = useCallback((v: string) => {
    setSearch(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setQuerySearch(v), 350);
  }, []);

  const handleSearchSubmit = useCallback((v: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearch(v);
    setQuerySearch(v);
  }, []);

  const handleFocus = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.select());
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      const pasted = e.clipboardData.getData("text").trim();
      handleSearchChange(pasted);
      requestAnimationFrame(() => inputRef.current?.setSelectionRange(0, pasted.length));
    },
    [handleSearchChange]
  );

  // Resumo do estoque
  const statsEmpty = items.filter((i) => i.quantity === 0).length;
  const statsLow = items.filter((i) => i.quantity > 0 && i.quantity <= i.min_quantity).length;
  const statsOk = items.filter((i) => i.quantity > i.min_quantity).length;

  return (
    <div className="min-h-screen bg-background">
      {/* Header — mesmo estilo da tela principal */}
      <header className="border-b border-border/50 bg-card/80 backdrop-blur-md sticky top-0 z-10">
        <div className="container mx-auto px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => navigate("/")}
              title="Voltar"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-1.5">
              <Boxes className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold text-foreground">Controle de Estoque</p>
            </div>
          </div>
          <nav className="flex items-center gap-1">
              <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 px-3 text-xs rounded-xl"
              onClick={() => setAllMovOpen(true)}
            >
              <History className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Histórico</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 px-3 text-xs rounded-xl"
              onClick={() => setListOpen(true)}
            >
              <List className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Lista</span>
            </Button>
            {isAdmin && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 px-3 text-xs rounded-xl"
                onClick={() => setBackupOpen(true)}
                title="Backup do estoque"
              >
                <DatabaseBackup className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Backup</span>
              </Button>
            )}
            {isAdmin && (
              <Button
                size="sm"
                className="h-8 gap-1.5 px-3 text-xs rounded-xl"
                onClick={() => setAddOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Adicionar Peça</span>
              </Button>
            )}
          </nav>
        </div>
      </header>

      <main className="container mx-auto px-4 py-5 space-y-5">
        {/* Barra de pesquisa */}
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                ref={inputRef}
                placeholder="Bipe o código de barras ou pesquise aqui..."
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                onFocus={handleFocus}
                onPaste={handlePaste}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleSearchSubmit((e.target as HTMLInputElement).value.trim());
                    requestAnimationFrame(() => inputRef.current?.select());
                  }
                }}
                className="pl-10 pr-10 h-11 text-sm bg-card"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => { setSearch(""); setQuerySearch(""); inputRef.current?.focus(); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-11 w-11 shrink-0"
              onClick={() => search.trim() && handleSearchSubmit(search.trim())}
            >
              <Search className="h-4 w-4" />
            </Button>
          </div>

          {/* Dica de busca por lote */}
          {/^\d{6}/.test(search.trim()) && (
            <p className="text-[11px] text-primary/70 flex items-center gap-1.5">
              <Tag className="h-3 w-3" />
              Pesquisando por lote — formato: <span className="font-mono font-semibold">DDMMAA-TT</span> ou <span className="font-mono font-semibold">DDMMAA-TT/A</span>
            </p>
          )}

          {/* Resumo */}
          {!loading && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs text-muted-foreground">
                {items.length === totalCount
                  ? `${totalCount} peça${totalCount !== 1 ? "s" : ""} no estoque`
                  : `${items.length} de ${totalCount} peças`}
              </p>
              {statsOk > 0 && (
                <span className="flex items-center gap-1 text-[11px] text-success font-medium">
                  <TrendingUp className="h-3 w-3" /> {statsOk} ok
                </span>
              )}
              {statsLow > 0 && (
                <span className="flex items-center gap-1 text-[11px] text-warning font-medium">
                  <TrendingDown className="h-3 w-3" /> {statsLow} baixo
                </span>
              )}
              {statsEmpty > 0 && (
                <span className="flex items-center gap-1 text-[11px] text-destructive font-medium">
                  <AlertTriangle className="h-3 w-3" /> {statsEmpty} zerado
                </span>
              )}
            </div>
          )}
        </div>

        {/* Estados de carregamento / erro / vazio */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
            <p className="text-sm text-muted-foreground">Carregando estoque...</p>
          </div>
        )}

        {!loading && error && (
          <div className="text-center py-20 text-destructive text-sm">{error}</div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="text-center py-20 space-y-3">
            <Boxes className="h-10 w-10 text-muted-foreground/40 mx-auto" />
            <p className="text-muted-foreground font-display font-medium">
              {querySearch ? "Nenhuma peça encontrada" : "Estoque vazio"}
            </p>
            <p className="text-sm text-muted-foreground/60">
              {querySearch
                ? "Tente outro termo de busca"
                : "Adicione peças ao estoque usando o botão acima"}
            </p>
            {isAdmin && !querySearch && (
              <Button
                className="mt-2 gap-1.5 rounded-xl"
                onClick={() => setAddOpen(true)}
              >
                <Plus className="h-4 w-4" /> Adicionar primeira peça
              </Button>
            )}
          </div>
        )}

        {/* Grid de cards */}
        {!loading && !error && items.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {items.map((item) => (
              <StockCard
                key={item.id}
                item={item}
                onMovement={(item, type) => setMovementState({ item, type })}
                onHistory={setHistoryItem}
                onDelete={setDeleteItem}
                onLotes={setLotesItem}
                loteCount={lotesSummary.get(item.id) ?? 0}
              />
            ))}
          </div>
        )}
      </main>

      {/* Modais */}
      <MovementModal
        item={movementState?.item ?? null}
        open={!!movementState}
        initialType={movementState?.type ?? "entrada"}
        onClose={() => setMovementState(null)}
        onSuccess={refetch}
      />
      <StockHistoryPanel
        item={historyItem}
        open={!!historyItem}
        onClose={() => setHistoryItem(null)}
        onSuccess={refetch}
      />
      <AddToStockModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSuccess={refetch}
      />
      <StockListModal
        open={listOpen}
        onClose={() => setListOpen(false)}
        items={items}
      />
      <AllMovementsModal
        open={allMovOpen}
        onClose={() => setAllMovOpen(false)}
      />
      <BackupPanel
        open={backupOpen}
        onClose={() => setBackupOpen(false)}
      />
      <LotesPanel
        item={lotesItem}
        open={!!lotesItem}
        onClose={() => setLotesItem(null)}
      />
      {/* Confirmação de exclusão de peça */}
      {deleteItem && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-card border border-border/30 p-5 space-y-4 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
                <Trash2 className="h-4 w-4 text-destructive" />
              </div>
              <div>
                <p className="text-sm font-semibold">Remover do estoque?</p>
                <p className="text-[12px] text-muted-foreground mt-0.5 line-clamp-2">
                  {deleteItem.device.model}
                </p>
                <p className="text-[11px] text-destructive/80 mt-1">
                  Todo o histórico de movimentos será apagado.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 h-10 rounded-xl border border-border text-sm font-medium hover:bg-muted/30 transition-colors"
                onClick={() => setDeleteItem(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="flex-1 h-10 rounded-xl bg-destructive text-destructive-foreground text-sm font-semibold hover:bg-destructive/90 transition-colors flex items-center justify-center gap-2"
                disabled={deleting}
                onClick={async () => {
                  if (!deleteItem) return;
                  setDeleting(true);
                  const { toast: t } = await import("sonner");
                  const result = await deleteStockItem(deleteItem.id);
                  setDeleting(false);
                  if (result.ok) {
                    t.success("Peça removida do estoque.", { description: deleteItem.device.model });
                    setDeleteItem(null);
                    refetch();
                  } else {
                    t.error(result.error ?? "Erro ao remover peça.");
                  }
                }}
              >
                {deleting
                  ? <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  : <Trash2 className="h-4 w-4" />}
                Remover
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
