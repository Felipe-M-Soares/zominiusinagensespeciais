import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useStock } from "@/hooks/useStock";
import type { StockItem } from "@/hooks/useStock";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  ArrowDownCircle,
  ArrowUpCircle,
  ChevronDown,
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
  Menu,
  Shield,
  Activity,
  Globe,
  Truck,
  PackageCheck,
  Filter,
  LayoutDashboard,
  Wrench,
} from "lucide-react";
import { MovementModal } from "@/components/stock/MovementModal";
import { StockHistoryPanel } from "@/components/stock/StockHistoryPanel";
import { AddToStockModal } from "@/components/stock/AddToStockModal";
import { StockListModal } from "@/components/stock/StockListModal";
import { LotesPanel } from "@/components/stock/LotesPanel";
import { StockCsvImport } from "@/components/stock/StockCsvImport";
import { AllMovementsModal } from "@/components/stock/AllMovementsModal";
import { BackupPanel } from "@/components/stock/BackupPanel";
import { TransferirExpedicaoModal } from "@/components/stock/TransferirExpedicaoModal";
import { RetrabalhoModal } from "@/components/stock/RetrabalhoModal";
import { StockDashboard } from "@/components/stock/StockDashboard";
import { supabase } from "@/integrations/supabase/client";
import { deleteStockItem, fetchLotesSummary, fetchLotesSummaryBatch } from "@/hooks/useStock";
import type { LoteSummary } from "@/hooks/useStock";
import { cn } from "@/lib/utils";
import { countryFlag } from "@/components/DeviceCard";

// ─── Card de Intermediária ────────────────────────────────────────────────────

interface IntermediaryCardProps {
  item: StockItem;
  onEntrada: (item: StockItem) => void;
  onTransfer: (item: StockItem) => void;
  onHistory: (item: StockItem) => void;
  onDelete: (item: StockItem) => void;
  onLotes: (item: StockItem) => void;
  loteCount: number;
  isAdmin: boolean;
}

function IntermediaryCard({
  item, onEntrada, onTransfer, onHistory, onDelete, onLotes, loteCount, isAdmin,
}: IntermediaryCardProps) {
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
      <div className={cn(
        "h-0.5 bg-gradient-to-r from-transparent to-transparent transition-opacity group-hover:opacity-100",
        isEmpty ? "via-destructive opacity-80" : isLow ? "via-warning opacity-70" : "via-primary opacity-50"
      )} />

      <div className="p-4 space-y-3">
        {/* Cabeçalho */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <h3 className="text-[13px] font-semibold leading-snug text-foreground line-clamp-2">{d.model}</h3>
            <p className="text-[11px] text-muted-foreground font-mono tracking-tight">{d.reference}</p>
          </div>
          <Badge variant="outline" className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 border-primary/25 text-primary/80 bg-primary/5 rounded-lg">
            {d.classification_code}
          </Badge>
        </div>

        {d.brand_name && <p className="text-[11px] text-muted-foreground/70 truncate -mt-1">{d.brand_name}</p>}

        {/* Badges */}
        <div className="flex flex-wrap gap-1 -mt-1">
          {d.sterile && (
            <span className="inline-flex items-center gap-1 rounded-full bg-success/8 px-2 py-0.5 text-[10px] font-medium text-success">
              <Shield className="h-2.5 w-2.5" /> Estéril
            </span>
          )}
          {d.single_use && (
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/12 px-2 py-0.5 text-[10px] font-medium text-orange-500">
              <Package className="h-2.5 w-2.5" /> Uso único
            </span>
          )}
          {d.implantable && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/8 px-2 py-0.5 text-[10px] font-medium text-primary">
              <Activity className="h-2.5 w-2.5" /> Implantável
            </span>
          )}
        </div>

        {/* Quantidade */}
        <div className={cn(
          "flex items-center justify-between rounded-xl px-3 py-2 border",
          isEmpty ? "bg-destructive/8 border-destructive/25" : isLow ? "bg-warning/8 border-warning/25" : "bg-muted/20 border-border/30"
        )}>
          <div className="flex items-center gap-1.5">
            <Package className={cn("h-3.5 w-3.5", isEmpty ? "text-destructive" : isLow ? "text-warning" : "text-muted-foreground")} />
            <span className="text-[11px] font-medium text-muted-foreground">Intermediário</span>
          </div>
          <div className="flex items-center gap-1.5">
            {isEmpty && <AlertTriangle className="h-3 w-3 text-destructive" />}
            {isLow && !isEmpty && <TrendingDown className="h-3 w-3 text-warning" />}
            <span className={cn("text-[15px] font-bold tabular-nums", isEmpty ? "text-destructive" : isLow ? "text-warning" : "text-foreground")}>
              {item.quantity}
            </span>
            <span className="text-[10px] text-muted-foreground">un.</span>
          </div>
        </div>

        {/* Lotes */}
        {loteCount > 0 && (
          <button
            type="button"
            onClick={() => onLotes(item)}
            className="flex items-center gap-1.5 text-[11px] text-primary/70 hover:text-primary transition-colors -mt-1"
          >
            <Tag className="h-3 w-3" />
            <span className="font-medium">{loteCount} lote{loteCount > 1 ? "s" : ""}</span>
            <span className="text-muted-foreground/40">→</span>
          </button>
        )}

        {/* Min e localização */}
        <div className="flex items-center justify-between text-[10px] text-muted-foreground/60">
          <span>Mín: {item.min_quantity} un.</span>
          {item.location && <span className="truncate ml-2">📍 {item.location}</span>}
        </div>

        <div className="flex items-center justify-between text-[10px] text-muted-foreground/60 pt-1 border-t border-border/20">
          <span className="font-mono truncate">{d.anvisa_registration || d.udi_di}</span>
          {d.manufacturer_country && (
            <span className="flex items-center gap-0.5 shrink-0 ml-2" title={d.manufacturer_country}>
              <span>{countryFlag(d.manufacturer_country)}</span>
            </span>
          )}
        </div>

        {/* Botões */}
        <div className="space-y-1.5 pt-1 border-t border-border/20">
          <button
            type="button"
            onClick={() => onEntrada(item)}
            className="w-full flex items-center justify-center gap-1.5 h-8 rounded-lg bg-primary/8 hover:bg-primary/15 text-primary text-[11px] font-medium transition-colors"
          >
            <ArrowDownCircle className="h-3.5 w-3.5" />
            Registrar Entrada
          </button>
          <button
            type="button"
            onClick={() => onTransfer(item)}
            disabled={item.quantity === 0}
            className="w-full flex items-center justify-center gap-1.5 h-8 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-500 text-[11px] font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            <Truck className="h-3.5 w-3.5" />
            Mover para Expedição
          </button>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => onHistory(item)}
              className="flex-1 h-7 flex items-center justify-center gap-1 rounded-lg bg-muted/30 hover:bg-muted/60 text-muted-foreground text-[10px] transition-colors"
              title="Histórico"
            >
              <Clock className="h-3 w-3" /> Histórico
            </button>
            <button
              type="button"
              onClick={() => onLotes(item)}
              className="flex-1 h-7 flex items-center justify-center gap-1 rounded-lg bg-muted/30 hover:bg-primary/10 hover:text-primary text-muted-foreground text-[10px] transition-colors"
              title="Lotes"
            >
              <Tag className="h-3 w-3" /> Lotes
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => onDelete(item)}
                className="h-7 w-7 flex items-center justify-center rounded-lg bg-muted/30 hover:bg-destructive/15 hover:text-destructive text-muted-foreground transition-colors"
                title="Remover"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Card de Expedição ────────────────────────────────────────────────────────

interface ExpedicaoCardProps {
  item: StockItem;
  onSaida: (item: StockItem) => void;
  onHistory: (item: StockItem) => void;
  onDelete: (item: StockItem) => void;
  onLotes: (item: StockItem) => void;
  onRetrabalho: (item: StockItem) => void;
  loteCount: number;
  isAdmin: boolean;
}

function ExpedicaoCard({
  item, onSaida, onHistory, onDelete, onLotes, onRetrabalho, loteCount, isAdmin,
}: ExpedicaoCardProps) {
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
      <div className={cn(
        "h-0.5 bg-gradient-to-r from-transparent to-transparent transition-opacity group-hover:opacity-100",
        isEmpty ? "via-destructive opacity-80" : isLow ? "via-warning opacity-70" : "via-success opacity-50"
      )} />

      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <h3 className="text-[13px] font-semibold leading-snug text-foreground line-clamp-2">{d.model}</h3>
            <p className="text-[11px] text-muted-foreground font-mono tracking-tight">{d.reference}</p>
          </div>
          <Badge variant="outline" className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 border-success/25 text-success/80 bg-success/5 rounded-lg">
            {d.classification_code}
          </Badge>
        </div>

        {d.brand_name && <p className="text-[11px] text-muted-foreground/70 truncate -mt-1">{d.brand_name}</p>}

        <div className="flex flex-wrap gap-1 -mt-1">
          {d.sterile && (
            <span className="inline-flex items-center gap-1 rounded-full bg-success/8 px-2 py-0.5 text-[10px] font-medium text-success">
              <Shield className="h-2.5 w-2.5" /> Estéril
            </span>
          )}
          {d.single_use && (
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/12 px-2 py-0.5 text-[10px] font-medium text-orange-500">
              <Package className="h-2.5 w-2.5" /> Uso único
            </span>
          )}
          {d.implantable && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/8 px-2 py-0.5 text-[10px] font-medium text-primary">
              <Activity className="h-2.5 w-2.5" /> Implantável
            </span>
          )}
        </div>

        <div className={cn(
          "flex items-center justify-between rounded-xl px-3 py-2 border",
          isEmpty ? "bg-destructive/8 border-destructive/25" : isLow ? "bg-warning/8 border-warning/25" : "bg-success/8 border-success/25"
        )}>
          <div className="flex items-center gap-1.5">
            <PackageCheck className={cn("h-3.5 w-3.5", isEmpty ? "text-destructive" : isLow ? "text-warning" : "text-success")} />
            <span className="text-[11px] font-medium text-muted-foreground">Expedição</span>
          </div>
          <div className="flex items-center gap-1.5">
            {isEmpty && <AlertTriangle className="h-3 w-3 text-destructive" />}
            {isLow && !isEmpty && <TrendingDown className="h-3 w-3 text-warning" />}
            <span className={cn("text-[15px] font-bold tabular-nums", isEmpty ? "text-destructive" : isLow ? "text-warning" : "text-success")}>
              {item.quantity}
            </span>
            <span className="text-[10px] text-muted-foreground">un.</span>
          </div>
        </div>

        {loteCount > 0 && (
          <button
            type="button"
            onClick={() => onLotes(item)}
            className="flex items-center gap-1.5 text-[11px] text-success/70 hover:text-success transition-colors -mt-1"
          >
            <Tag className="h-3 w-3" />
            <span className="font-medium">{loteCount} lote{loteCount > 1 ? "s" : ""} prontos</span>
            <span className="text-muted-foreground/40">→</span>
          </button>
        )}

        <div className="flex items-center justify-between text-[10px] text-muted-foreground/60">
          <span>Mín: {item.min_quantity} un.</span>
          {item.location && <span className="truncate ml-2">📍 {item.location}</span>}
        </div>

        <div className="flex items-center justify-between text-[10px] text-muted-foreground/60 pt-1 border-t border-border/20">
          <span className="font-mono truncate">{d.anvisa_registration || d.udi_di}</span>
          {d.manufacturer_country && (
            <span className="flex items-center gap-0.5 shrink-0 ml-2" title={d.manufacturer_country}>
              <span>{countryFlag(d.manufacturer_country)}</span>
            </span>
          )}
        </div>

        <div className="space-y-1.5 pt-1 border-t border-border/20">
          <button
            type="button"
            onClick={() => onSaida(item)}
            disabled={item.quantity === 0}
            className="w-full flex items-center justify-center gap-1.5 h-8 rounded-lg bg-success/10 hover:bg-success/20 text-success text-[11px] font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            <ArrowUpCircle className="h-3.5 w-3.5" />
            Retirada / Venda
          </button>
          <button
            type="button"
            onClick={() => onRetrabalho(item)}
            disabled={item.quantity === 0}
            className="w-full flex items-center justify-center gap-1.5 h-8 rounded-lg bg-orange-500/10 hover:bg-orange-500/20 text-orange-500 text-[11px] font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            <Wrench className="h-3.5 w-3.5" />
            Retrabalho
          </button>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => onHistory(item)}
              className="flex-1 h-7 flex items-center justify-center gap-1 rounded-lg bg-muted/30 hover:bg-muted/60 text-muted-foreground text-[10px] transition-colors"
            >
              <Clock className="h-3 w-3" /> Histórico
            </button>
            <button
              type="button"
              onClick={() => onLotes(item)}
              className="flex-1 h-7 flex items-center justify-center gap-1 rounded-lg bg-muted/30 hover:bg-success/10 hover:text-success text-muted-foreground text-[10px] transition-colors"
            >
              <Tag className="h-3 w-3" /> Lotes
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => onDelete(item)}
                className="h-7 w-7 flex items-center justify-center rounded-lg bg-muted/30 hover:bg-destructive/15 hover:text-destructive text-muted-foreground transition-colors"
                title="Remover"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

type FilterStatus = "all" | "ok" | "baixo" | "zerado";
type ActiveView = "dashboard" | "intermediaria" | "expedicao";

// Itens com qty=0 SÃO exibidos — novos devices importados começam com 0
const HIDE_EMPTY_INTERMEDIARIA = false;

export default function Estoque() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  // ── Estado principal ──────────────────────────────────────────────────────
  const [activeView, setActiveView] = useState<ActiveView>("dashboard");
  const [search, setSearch] = useState("");
  const [querySearch, setQuerySearch] = useState("");

  // Filtros
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [filterLocation, setFilterLocation] = useState("");
  const [filterBrand, setFilterBrand] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  // Autocomplete
  const [autocompleteItems, setAutocompleteItems] = useState<string[]>([]);
  const [showAutocomplete, setShowAutocomplete] = useState(false);

  // Alertas
  const [showLowStockAlert, setShowLowStockAlert] = useState(false);

  // Menu admin
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);

  // Modais e painéis
  const [movementState, setMovementState] = useState<{
    item: StockItem;
    type: "entrada" | "saida";
    lockedType: "entrada" | "saida";
  } | null>(null);
  const [historyItem, setHistoryItem] = useState<StockItem | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [allMovOpen, setAllMovOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [deleteItem, setDeleteItem] = useState<StockItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [lotesItem, setLotesItem] = useState<StockItem | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteAllTyped, setDeleteAllTyped] = useState("");
  const [deletingAll, setDeletingAll] = useState(false);
  const [transferItem, setTransferItem] = useState<StockItem | null>(null);
  const [retrabalhoItem, setRetrabalhoItem] = useState<StockItem | null>(null);
  const [lotesSummary, setLotesSummary] = useState<Map<string, number>>(new Map());

  // Paginação
  const ITEMS_PER_PAGE = 60;
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_PAGE);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autocompleteRef = useRef<HTMLDivElement>(null);
  const alertShownRef = useRef(false);
  const adminMenuRef = useRef<HTMLDivElement>(null);

  // ── Dados do servidor ─────────────────────────────────────────────────────
  const { items: allItems, totalCount, loading, error, refetch } = useStock(querySearch);

  // Derivados dos dados (não são hooks — apenas cálculos puros)
  const intermediariaItemsAll = allItems.filter((i) => i.fase === "intermediaria");
  const intermediariaItems = HIDE_EMPTY_INTERMEDIARIA
    ? intermediariaItemsAll.filter((i) => i.quantity > 0)
    : intermediariaItemsAll;
  const expedicaoItems = allItems.filter((i) => i.fase === "expedicao");

  // ── useMemo ───────────────────────────────────────────────────────────────

  // Items da aba ativa, com filtros aplicados
  const rawItems = useMemo(() => {
    if (activeView === "expedicao") return expedicaoItems;
    if (activeView === "intermediaria") return intermediariaItems;
    return []; // dashboard — rawItems não é usado nessa view
  }, [activeView, expedicaoItems, intermediariaItems]);

  const filteredItems = useMemo(() => rawItems.filter(item => {
    if (!item.device) return false; // item órfão sem device associado
    if (filterStatus === "ok" && !(item.quantity > item.min_quantity)) return false;
    if (filterStatus === "baixo" && !(item.quantity > 0 && item.quantity <= item.min_quantity)) return false;
    if (filterStatus === "zerado" && item.quantity !== 0) return false;
    if (filterLocation && !item.location?.toLowerCase().includes(filterLocation.toLowerCase())) return false;
    if (filterBrand && !item.device.brand_name?.toLowerCase().includes(filterBrand.toLowerCase())) return false;
    return true;
  }), [rawItems, filterStatus, filterLocation, filterBrand]);

  // ── useEffect ─────────────────────────────────────────────────────────────

  // Alerta de estoque baixo — aparece só ao carregar pela primeira vez
  useEffect(() => {
    if (!loading && !alertShownRef.current && allItems.length > 0) {
      const hasLow = allItems.some(i => i.quantity > 0 && i.quantity <= i.min_quantity);
      const hasEmpty = allItems.some(i => i.quantity === 0);
      if (hasLow || hasEmpty) {
        alertShownRef.current = true;
        setShowLowStockAlert(true);
        const t = setTimeout(() => setShowLowStockAlert(false), 6000);
        return () => clearTimeout(t);
      }
    }
  }, [loading, allItems]);

  // Autocomplete: busca sugestões de modelo
  useEffect(() => {
    if (!search.trim() || search.trim().length < 2) {
      setAutocompleteItems([]);
      setShowAutocomplete(false);
      return;
    }
    const timer = setTimeout(async () => {
      const q = search.trim().toLowerCase();
      const sourceItems = filteredItems.length > 0 ? filteredItems : allItems;
      const suggestions = sourceItems
        .filter(i => i.device?.model)
        .map(i => i.device.model)
        .filter((m, idx, arr) => m.toLowerCase().includes(q) && arr.indexOf(m) === idx)
        .slice(0, 6);
      setAutocompleteItems(suggestions);
      setShowAutocomplete(suggestions.length > 0);
    }, 150);
    return () => clearTimeout(timer);
  }, [search, allItems, filteredItems]);

  // Fecha autocomplete ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (autocompleteRef.current && !autocompleteRef.current.contains(e.target as Node)) {
        setShowAutocomplete(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Fecha menu admin ao clicar fora
  useEffect(() => {
    if (!adminMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (adminMenuRef.current && !adminMenuRef.current.contains(e.target as Node)) {
        setAdminMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [adminMenuOpen]);

  const hasSearch = !!querySearch.trim();
  const hasActiveFilters = filterStatus !== "all" || !!filterLocation || !!filterBrand;

  const handleSearchChange = useCallback((v: string) => {
    setSearch(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!v.trim()) {
      setQuerySearch("");
      setVisibleCount(ITEMS_PER_PAGE);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setQuerySearch(v.trim());
      setVisibleCount(ITEMS_PER_PAGE);
    }, 400);
  }, []);

  function handleSearchSubmit(v: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setQuerySearch(v);
    setVisibleCount(ITEMS_PER_PAGE);
    setShowAutocomplete(false);
  }

  function handleSelectSuggestion(suggestion: string) {
    setSearch(suggestion);
    setQuerySearch(suggestion);
    setShowAutocomplete(false);
    setVisibleCount(ITEMS_PER_PAGE);
  }

  // Stats da aba atual (filtrados)
  const statsLow = filteredItems.filter((i) => i.quantity > 0 && i.quantity <= i.min_quantity).length;
  const statsOk = filteredItems.filter((i) => i.quantity > i.min_quantity).length;
  const statsEmpty = filteredItems.filter((i) => i.quantity === 0).length;

  // Alerta global de estoque baixo (badge no header)
  const globalLowCount = allItems.filter(i => i.quantity > 0 && i.quantity <= i.min_quantity).length;
  // Zerados no intermediário — na expedição é normal ter zero após saídas
  const globalEmptyCount = allItems.filter(i => i.quantity === 0 && i.fase === "intermediaria").length;
  const totalAlertCount = globalLowCount + globalEmptyCount;

  const hasMore = visibleCount < filteredItems.length;
  const pagedItems = useMemo(
    () => filteredItems.slice(0, visibleCount),
    [filteredItems, visibleCount]
  );

  // IDs dos itens visíveis — string estabilizada para evitar re-render infinito
  const pagedItemIds = useMemo(
    () => pagedItems.map((i) => i.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pagedItems.map((i) => i.id).join(",")]
  );

  // Busca contagem de lotes em UMA única query batch (evita N requests simultâneas)
  useEffect(() => {
    if (pagedItemIds.length === 0) { setLotesSummary(new Map()); return; }
    let cancelled = false;
    fetchLotesSummaryBatch(pagedItemIds).then((result) => {
      if (!cancelled) setLotesSummary(result);
    });
    return () => { cancelled = true; };
  }, [pagedItemIds]);

  async function handleDeleteAll() {
    setDeletingAll(true);
    const { toast: t } = await import("sonner");
    const { error } = await supabase.from("stock_items").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    setDeletingAll(false);
    if (error) {
      t.error("Erro ao excluir estoque.");
    } else {
      t.success("Todo o estoque foi excluído.");
      setDeleteAllOpen(false);
      setDeleteAllTyped("");
      refetch();
    }
  }

  const activeTab = activeView === "expedicao" ? "expedicao" : "intermediaria";

  return (
    <div className="min-h-screen bg-background">
      {/* Banner de alerta — aparece ao entrar e desaparece */}
      {showLowStockAlert && (
        <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between gap-3 bg-warning/90 text-warning-foreground px-4 py-2.5 text-sm font-medium shadow-lg">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              {globalEmptyCount > 0 && `${globalEmptyCount} item(s) zerado(s)`}
              {globalEmptyCount > 0 && globalLowCount > 0 && " e "}
              {globalLowCount > 0 && `${globalLowCount} item(s) com estoque baixo`}
            </span>
          </div>
          <button type="button" onClick={() => setShowLowStockAlert(false)} className="text-warning-foreground/70 hover:text-warning-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border/40">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate("/")}
              className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2">
              <Boxes className="h-4 w-4 text-primary" />
              <h1 className="text-sm font-semibold">Estoque</h1>
              {/* Badge de alerta no header */}
              {!loading && totalAlertCount > 0 && (
                <span className="flex items-center gap-0.5 bg-warning/15 text-warning border border-warning/30 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  <AlertTriangle className="h-2.5 w-2.5" />
                  {totalAlertCount}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {isAdmin && (
              <>
                <div className="hidden sm:flex items-center gap-1.5">
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs rounded-lg" onClick={() => setListOpen(true)}>
                    <List className="h-3.5 w-3.5" /> Lista
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs rounded-lg" onClick={() => setAllMovOpen(true)}>
                    <History className="h-3.5 w-3.5" /> Histórico
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs rounded-lg" onClick={() => setBackupOpen(true)}>
                    <DatabaseBackup className="h-3.5 w-3.5" /> Backup
                  </Button>
                  <Button size="sm" className="h-8 gap-1.5 text-xs rounded-lg" onClick={() => setAddOpen(true)}>
                    <Plus className="h-3.5 w-3.5" /> Adicionar
                  </Button>
                </div>
                <div className="relative sm:hidden" ref={adminMenuRef}>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 w-8 p-0 rounded-lg"
                    onClick={() => setAdminMenuOpen((v) => !v)}
                  >
                    <Menu className="h-4 w-4" />
                  </Button>
                  {adminMenuOpen && (
                    <div className="absolute right-0 top-full mt-1 w-48 rounded-xl border border-border bg-card shadow-xl z-50 overflow-hidden">
                      {[
                        { label: "Adicionar Peça", icon: Plus, action: () => setAddOpen(true) },
                        { label: "Lista de Estoque", icon: List, action: () => setListOpen(true) },
                        { label: "Histórico Geral", icon: History, action: () => setAllMovOpen(true) },
                        { label: "Importar CSV", icon: ScanBarcode, action: () => setCsvOpen(true) },
                        { label: "Backup", icon: DatabaseBackup, action: () => setBackupOpen(true) },
                        { label: "Excluir Todo Estoque", icon: Trash2, action: () => setDeleteAllOpen(true), danger: true },
                      ].map(({ label, icon: Icon, action, danger }) => (
                        <button
                          key={label}
                          type="button"
                          className={cn(
                            "w-full flex items-center gap-2 px-3 py-2.5 text-[13px] hover:bg-accent/50 transition-colors border-b border-border/30 last:border-0",
                            danger ? "text-destructive" : "text-foreground"
                          )}
                          onClick={() => { action(); setAdminMenuOpen(false); }}
                        >
                          <Icon className="h-3.5 w-3.5" /> {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-4 space-y-4">

        {/* Tabs de navegação: Dashboard / Intermediário / Expedição */}
        <div className="flex items-stretch gap-2">
          <button
            type="button"
            onClick={() => setActiveView("dashboard")}
            className={cn(
              "flex items-center justify-center gap-1.5 h-10 px-4 rounded-xl border text-sm font-medium transition-all",
              activeView === "dashboard"
                ? "bg-primary/10 border-primary/40 text-primary"
                : "bg-background border-border text-muted-foreground hover:bg-muted/30"
            )}
          >
            <LayoutDashboard className="h-4 w-4" />
            <span className="hidden sm:inline">Dashboard</span>
          </button>
          <button
            type="button"
            onClick={() => { setActiveView("intermediaria"); setVisibleCount(ITEMS_PER_PAGE); }}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 h-10 rounded-xl border text-sm font-medium transition-all",
              activeView === "intermediaria"
                ? "bg-primary/10 border-primary/40 text-primary"
                : "bg-background border-border text-muted-foreground hover:bg-muted/30"
            )}
          >
            <Package className="h-4 w-4" />
            <span>Intermediário</span>
            {!loading && (
              <span className={cn(
                "text-[11px] font-bold px-1.5 py-0.5 rounded-full",
                activeView === "intermediaria" ? "bg-primary/15 text-primary" : "bg-muted/50 text-muted-foreground"
              )}>
                {intermediariaItems.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => { setActiveView("expedicao"); setVisibleCount(ITEMS_PER_PAGE); }}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 h-10 rounded-xl border text-sm font-medium transition-all",
              activeView === "expedicao"
                ? "bg-success/10 border-success/40 text-success"
                : "bg-background border-border text-muted-foreground hover:bg-muted/30"
            )}
          >
            <Truck className="h-4 w-4" />
            <span>Expedição</span>
            {!loading && (
              <span className={cn(
                "text-[11px] font-bold px-1.5 py-0.5 rounded-full",
                activeView === "expedicao" ? "bg-success/15 text-success" : "bg-muted/50 text-muted-foreground"
              )}>
                {expedicaoItems.length}
              </span>
            )}
          </button>
        </div>

        {/* Dashboard View */}
        {activeView === "dashboard" && (
          <StockDashboard items={allItems} loading={loading} />
        )}

        {/* Busca + Filtros — apenas nas abas de lista */}
        {activeView !== "dashboard" && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <div className="relative flex-1" ref={autocompleteRef}>
                <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  ref={inputRef}
                  placeholder="Buscar por modelo, referência, UDI ou lote..."
                  value={search}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  onFocus={() => { if (autocompleteItems.length > 0) setShowAutocomplete(true); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleSearchSubmit((e.target as HTMLInputElement).value.trim());
                      requestAnimationFrame(() => inputRef.current?.select());
                    }
                    if (e.key === "Escape") setShowAutocomplete(false);
                  }}
                  className="pl-10 pr-10 h-11 text-sm bg-card"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => { setSearch(""); setQuerySearch(""); setShowAutocomplete(false); inputRef.current?.focus(); }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                {/* Autocomplete dropdown */}
                {showAutocomplete && autocompleteItems.length > 0 && (
                  <div className="absolute top-full mt-1 left-0 right-0 z-50 rounded-xl border border-border bg-card shadow-xl overflow-hidden">
                    {autocompleteItems.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => handleSelectSuggestion(s)}
                        className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted/40 transition-colors border-b border-border/20 last:border-0"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
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
              {/* Botão de filtros */}
              <Button
                type="button"
                variant={hasActiveFilters ? "default" : "outline"}
                size="icon"
                className="h-11 w-11 shrink-0 relative"
                onClick={() => setShowFilters(v => !v)}
                title="Filtros"
              >
                <Filter className="h-4 w-4" />
                {hasActiveFilters && (
                  <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-destructive" />
                )}
              </Button>
            </div>

            {/* Painel de filtros */}
            {showFilters && (
              <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Filtros</p>
                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={() => { setFilterStatus("all"); setFilterLocation(""); setFilterBrand(""); }}
                      className="text-[11px] text-destructive hover:underline"
                    >
                      Limpar filtros
                    </button>
                  )}
                </div>

                {/* Status */}
                <div className="space-y-1.5">
                  <p className="text-[11px] text-muted-foreground font-medium">Status</p>
                  <div className="flex flex-wrap gap-1.5">
                    {([
                      { value: "all", label: "Todos" },
                      { value: "ok", label: "✅ OK" },
                      { value: "baixo", label: "⚠️ Baixo" },
                      { value: "zerado", label: "🔴 Zerado" },
                    ] as { value: FilterStatus; label: string }[]).map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setFilterStatus(opt.value)}
                        className={cn(
                          "h-7 px-3 rounded-full text-[11px] font-medium border transition-colors",
                          filterStatus === opt.value
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-muted/30 text-muted-foreground border-border/50 hover:bg-muted/60"
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Localização */}
                <div className="space-y-1.5">
                  <p className="text-[11px] text-muted-foreground font-medium">Localização</p>
                  <Input
                    placeholder="Filtrar por localização..."
                    value={filterLocation}
                    onChange={e => setFilterLocation(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>

                {/* Marca */}
                <div className="space-y-1.5">
                  <p className="text-[11px] text-muted-foreground font-medium">Marca</p>
                  <Input
                    placeholder="Filtrar por marca..."
                    value={filterBrand}
                    onChange={e => setFilterBrand(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
              </div>
            )}

            {/^\d{6}/.test(search.trim()) && (
              <p className="text-[11px] text-primary/70 flex items-center gap-1.5">
                <Tag className="h-3 w-3" />
                Pesquisando por lote — formato: <span className="font-mono font-semibold">DDMMAA-TT</span>
              </p>
            )}

            {hasSearch && !loading && (intermediariaItems.length > 0 || expedicaoItems.length > 0) && (
              <div className="flex flex-wrap gap-2 text-[11px]">
                {intermediariaItems.length > 0 && (
                  <span className="flex items-center gap-1 bg-primary/8 text-primary px-2 py-0.5 rounded-full font-medium">
                    <Package className="h-3 w-3" />
                    {intermediariaItems.length} em Intermediário
                  </span>
                )}
                {expedicaoItems.length > 0 && (
                  <span className="flex items-center gap-1 bg-success/8 text-success px-2 py-0.5 rounded-full font-medium">
                    <Truck className="h-3 w-3" />
                    {expedicaoItems.length} em Expedição
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Descrição da aba */}
        {activeView !== "dashboard" && (
          <div className={cn(
            "rounded-xl border px-4 py-3 text-[12px]",
            activeView === "intermediaria"
              ? "bg-primary/5 border-primary/20 text-primary/80"
              : "bg-success/5 border-success/20 text-success/80"
          )}>
            {activeView === "intermediaria"
              ? "Peças desenbaladas recebidas no estoque. Registre a entrada por lote e mova para Expedição após embalar."
              : "Peças embaladas e prontas para retirada ou venda. Registre a saída aqui."}
          </div>
        )}

        {/* Resumo */}
        {activeView !== "dashboard" && !loading && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-muted-foreground">
              {filteredItems.length} peça{filteredItems.length !== 1 ? "s" : ""} em {activeView === "intermediaria" ? "intermediário" : "expedição"}
              {hasActiveFilters && <span className="text-primary/70"> (filtrado)</span>}
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
            {activeView === "intermediaria" && statsEmpty > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-destructive font-medium">
                <AlertTriangle className="h-3 w-3" /> {statsEmpty} vazio
              </span>
            )}
          </div>
        )}

        {/* Loading / Erro / Vazio */}
        {activeView !== "dashboard" && loading && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
            <p className="text-sm text-muted-foreground">Carregando estoque...</p>
          </div>
        )}

        {activeView !== "dashboard" && !loading && error && (
          <div className="text-center py-20 text-destructive text-sm">{error}</div>
        )}

        {activeView !== "dashboard" && !loading && !error && filteredItems.length === 0 && (
          <div className="text-center py-20 space-y-3">
            {activeView === "intermediaria"
              ? <Package className="h-10 w-10 text-muted-foreground/40 mx-auto" />
              : <Truck className="h-10 w-10 text-muted-foreground/40 mx-auto" />}
            <p className="text-muted-foreground font-medium">
              {querySearch || hasActiveFilters
                ? "Nenhuma peça encontrada"
                : activeView === "intermediaria"
                  ? "Nenhuma peça no intermediário"
                  : "Nenhuma peça na expedição"}
            </p>
            <p className="text-sm text-muted-foreground/60">
              {querySearch
                ? "Tente outro termo de busca"
                : hasActiveFilters
                  ? "Tente remover alguns filtros"
                  : activeView === "intermediaria"
                    ? "Adicione peças ao estoque e registre a entrada por lote"
                    : "Mova peças da aba Intermediário para cá após embalar"}
            </p>
            {isAdmin && !querySearch && !hasActiveFilters && activeView === "intermediaria" && (
              <Button className="mt-2 gap-1.5 rounded-xl" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" /> Adicionar primeira peça
              </Button>
            )}
          </div>
        )}

        {/* Grid de cards */}
        {activeView !== "dashboard" && !loading && !error && filteredItems.length > 0 && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {pagedItems.map((item) =>
                activeView === "intermediaria" ? (
                  <IntermediaryCard
                    key={item.id}
                    item={item}
                    onEntrada={(i) => setMovementState({ item: i, type: "entrada", lockedType: "entrada" })}
                    onTransfer={setTransferItem}
                    onHistory={setHistoryItem}
                    onDelete={setDeleteItem}
                    onLotes={setLotesItem}
                    loteCount={lotesSummary.get(item.id) ?? 0}
                    isAdmin={isAdmin}
                  />
                ) : (
                  <ExpedicaoCard
                    key={item.id}
                    item={item}
                    onSaida={(i) => setMovementState({ item: i, type: "saida", lockedType: "saida" })}
                    onHistory={setHistoryItem}
                    onDelete={setDeleteItem}
                    onLotes={setLotesItem}
                    onRetrabalho={setRetrabalhoItem}
                    loteCount={lotesSummary.get(item.id) ?? 0}
                    isAdmin={isAdmin}
                  />
                )
              )}
            </div>

            {/* Carregar mais */}
            {hasMore && (
              <div className="flex justify-center pt-2 pb-4">
                <Button
                  variant="outline"
                  onClick={() => setVisibleCount((c) => c + ITEMS_PER_PAGE)}
                  className="gap-2"
                >
                  <ChevronDown className="h-4 w-4" />
                  Carregar mais ({(filteredItems.length - visibleCount).toLocaleString("pt-BR")} restantes)
                </Button>
              </div>
            )}
          </>
        )}
      </main>

      {/* ─── Modais ──────────────────────────────────────────────────────────── */}

      <MovementModal
        item={movementState?.item ?? null}
        open={!!movementState}
        initialType={movementState?.type ?? "entrada"}
        lockedType={movementState?.lockedType}
        onClose={() => setMovementState(null)}
        onSuccess={refetch}
      />

      <TransferirExpedicaoModal
        item={transferItem}
        open={!!transferItem}
        onClose={() => setTransferItem(null)}
        onSuccess={refetch}
      />

      <RetrabalhoModal
        item={retrabalhoItem}
        open={!!retrabalhoItem}
        onClose={() => setRetrabalhoItem(null)}
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
        items={allItems}
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

      <StockCsvImport
        open={csvOpen}
        onClose={() => setCsvOpen(false)}
        onSuccess={refetch}
      />

      {/* Excluir todo o estoque */}
      <AlertDialog
        open={deleteAllOpen}
        onOpenChange={(v) => { if (!v) { setDeleteAllOpen(false); setDeleteAllTyped(""); } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-4 w-4" /> Excluir todo o estoque?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                Isso irá remover <strong>todas as peças</strong> do estoque (intermediário + expedição) e <strong>todo o histórico</strong>. Ação irreversível.
              </span>
              <span className="block text-xs text-muted-foreground">💡 Faça um Backup antes de continuar.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1 space-y-1.5">
            <p className="text-sm text-muted-foreground">
              Digite <strong className="text-destructive font-mono">EXCLUIR</strong> para confirmar:
            </p>
            <Input
              value={deleteAllTyped}
              onChange={(e) => setDeleteAllTyped(e.target.value)}
              placeholder="EXCLUIR"
              className="font-mono"
              disabled={deletingAll}
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingAll} onClick={() => setDeleteAllTyped("")}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAll}
              disabled={deletingAll || deleteAllTyped !== "EXCLUIR"}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingAll ? "Excluindo..." : "Excluir tudo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                  Fase: {deleteItem.fase === "intermediaria" ? "Intermediário" : "Expedição"}
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
