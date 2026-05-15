import { useState, useCallback, memo, useRef } from "react";
import { useDevices, useDeviceOptions, type Filters } from "@/hooks/useDevices";
import { useDebounce } from "@/hooks/useDebounce";
import { useClickOutside } from "@/hooks/useClickOutside";
import { DeviceCard } from "@/components/DeviceCard";
import { DeviceDetail } from "@/components/DeviceDetail";
import type { Device } from "@/types/device";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronDown, Loader2, Search, SlidersHorizontal, ScanBarcode, X as XIcon } from "lucide-react";
import { CatalogButton } from "@/components/CatalogButton";
import { cn } from "@/lib/utils";

const LETTERS = "#ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const EMPTY_FILTERS: Filters = Object.freeze({ material: "", classification: "", sterile: "", single_use: "", exocad: "" }) as Filters;

interface SearchBarProps {
  onSearch: (value: string) => void;
  onClear: () => void;
  hasValue: boolean;
  suggestions: string[];
  showSuggestions: boolean;
  onSelectSuggestion: (s: string) => void;
  onCloseSuggestions: () => void;
}

const SearchBar = memo(function SearchBar({
  onSearch, onClear, suggestions, showSuggestions, onSelectSuggestion, onCloseSuggestions
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [localHasValue, setLocalHasValue] = useState(false);
  const debouncedSearch = useDebounce((v: string) => onSearch(v), 400);
  useClickOutside(containerRef, onCloseSuggestions);

  function handleChange(v: string) {
    setLocalHasValue(!!v.trim());
    if (!v.trim()) { onClear(); return; }
    debouncedSearch(v.trim());
  }

  function handleClear() {
    if (inputRef.current) inputRef.current.value = "";
    setLocalHasValue(false);
    onClear();
  }

  return (
    <div className="relative flex-1" ref={containerRef}>
      <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        placeholder="Bipe o código de barras ou pesquise aqui..."
        onChange={e => handleChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") {
            const v = (e.target as HTMLInputElement).value.trim();
            onSearch(v);
            onCloseSuggestions();
            requestAnimationFrame(() => inputRef.current?.select());
          }
          if (e.key === "Escape") onCloseSuggestions();
        }}
        className="flex h-10 w-full rounded-lg border border-input bg-card px-3 py-2 pl-10 pr-10 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-shadow"
      />
      {localHasValue && (
        <button type="button" onClick={handleClear} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
          <XIcon className="h-3.5 w-3.5" />
        </button>
      )}
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute top-full mt-1 left-0 right-0 z-50 rounded-xl border border-border bg-card shadow-xl overflow-hidden">
          {suggestions.map(s => (
            <button key={s} type="button"
              onMouseDown={e => { e.preventDefault(); if (inputRef.current) inputRef.current.value = s; onSelectSuggestion(s); }}
              className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted/60 transition-colors border-b border-border/30 last:border-0"
            >{s}</button>
          ))}
        </div>
      )}
    </div>
  );
});

const Index = () => {
  const [search, setSearch] = useState("");
  const [querySearch, setQuerySearch] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [activeLetter, setActiveLetter] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [autocompleteItems] = useState<string[]>([]);
  const [showAutocomplete] = useState(false);

  const activeFilterCount = [filters.material, filters.classification, filters.sterile, filters.single_use, filters.exocad, activeLetter].filter(Boolean).length;

  const { devices, totalCount, loading, loadingMore, error, loadMore, hasMore } =
    useDevices(querySearch, filters, activeLetter);

  const options = useDeviceOptions();

  const handleSearchChange = useCallback((v: string) => {
    setSearch(v);
    setQuerySearch(v);
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearch("");
    setQuerySearch("");
  }, []);

  const handleSelectSuggestion = useCallback((suggestion: string) => {
    setSearch(suggestion);
    setQuerySearch(suggestion);
  }, []);

  const handleFilterChange = useCallback((key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleLetterSelect = useCallback((letter: string) => {
    setActiveLetter(letter);
  }, []);

  const handleClear = useCallback(() => {
    handleClearSearch();
    setFilters(EMPTY_FILTERS);
    setActiveLetter("");
  }, [handleClearSearch]);

  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 sm:px-6 pt-5 pb-4 border-b border-border/50 bg-card/40 backdrop-blur-sm shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg font-bold font-display text-foreground">Base ANVISA</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Dispositivos médicos cadastrados</p>
          </div>
          <CatalogButton />
        </div>
        <div className="flex gap-2">
          <SearchBar
            onSearch={handleSearchChange}
            onClear={handleClearSearch}
            hasValue={!!search}
            suggestions={autocompleteItems}
            showSuggestions={showAutocomplete}
            onSelectSuggestion={handleSelectSuggestion}
            onCloseSuggestions={() => {}}
          />
          <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0 rounded-lg"
            onClick={() => search.trim() && handleSelectSuggestion(search.trim())}>
            <Search className="h-4 w-4" />
          </Button>
          <Button type="button" variant={showFilters ? "default" : "outline"} size="icon"
            className="h-10 w-10 shrink-0 relative rounded-lg"
            onClick={() => setShowFilters(v => !v)}>
            <SlidersHorizontal className="h-4 w-4" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-destructive-foreground text-[10px] flex items-center justify-center font-bold">
                {activeFilterCount}
              </span>
            )}
          </Button>
        </div>
      </div>

      {showFilters && (
        <div className="border-b border-border/50 bg-card/60 px-4 sm:px-6 py-4 space-y-4 animate-in slide-in-from-top-2 duration-200 shrink-0">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            <Select value={filters.material || "all"} onValueChange={v => handleFilterChange("material", v === "all" ? "" : v)}>
              <SelectTrigger className="bg-background text-xs h-9 rounded-lg"><SelectValue placeholder="Material" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os materiais</SelectItem>
                {options.materials.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.classification || "all"} onValueChange={v => handleFilterChange("classification", v === "all" ? "" : v)}>
              <SelectTrigger className="bg-background text-xs h-9 rounded-lg"><SelectValue placeholder="Classificação" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as classes</SelectItem>
                {options.classifications.map(c => <SelectItem key={c} value={c}>Classe {c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.sterile || "all"} onValueChange={v => handleFilterChange("sterile", v === "all" ? "" : v)}>
              <SelectTrigger className="bg-background text-xs h-9 rounded-lg"><SelectValue placeholder="Esterilidade" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="true">Estéril</SelectItem>
                <SelectItem value="false">Não Estéril</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.single_use || "all"} onValueChange={v => handleFilterChange("single_use", v === "all" ? "" : v)}>
              <SelectTrigger className="bg-background text-xs h-9 rounded-lg"><SelectValue placeholder="Uso" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os usos</SelectItem>
                <SelectItem value="true">Uso único</SelectItem>
                <SelectItem value="false">Reutilizável</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.exocad || "all"} onValueChange={v => handleFilterChange("exocad", v === "all" ? "" : v)}>
              <SelectTrigger className="bg-background text-xs h-9 rounded-lg"><SelectValue placeholder="Exocad" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos Exocad</SelectItem>
                {options.exocadOptions.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-2 font-medium">Filtrar por letra inicial</p>
            <div className="flex flex-wrap gap-1">
              <button onClick={() => handleLetterSelect("")} className={cn("h-7 px-2 rounded-md text-[11px] font-medium transition-colors", activeLetter === "" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-accent border border-border")}>Todos</button>
              {LETTERS.filter(l => options.availableLetters.has(l)).map(letter => (
                <button key={letter} onClick={() => handleLetterSelect(letter)} className={cn("h-7 w-7 rounded-md text-[11px] font-medium transition-colors", activeLetter === letter ? "bg-primary text-primary-foreground" : "bg-background text-foreground hover:bg-accent border border-border")}>{letter}</button>
              ))}
            </div>
          </div>
          {(filters.material || filters.classification || filters.sterile || filters.single_use || filters.exocad || activeLetter) && (
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={handleClear} className="gap-1 text-muted-foreground text-xs h-8">
                <XIcon className="h-3.5 w-3.5" /> Limpar filtros
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="px-4 sm:px-6 py-2 bg-background/50 border-b border-border/30 shrink-0">
        <p className="text-xs text-muted-foreground">
          {loading ? "Buscando..." : devices.length === totalCount
            ? `${totalCount.toLocaleString("pt-BR")} dispositivos`
            : `${devices.length.toLocaleString("pt-BR")} de ${totalCount.toLocaleString("pt-BR")} dispositivos`}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
            <p className="text-sm text-muted-foreground">Carregando dispositivos...</p>
          </div>
        ) : error ? (
          <div className="text-center py-20 text-destructive text-sm">{error}</div>
        ) : devices.length === 0 ? (
          <div className="text-center py-16 space-y-2">
            <p className="text-muted-foreground text-lg font-display">Nenhum dispositivo encontrado</p>
            <p className="text-muted-foreground text-sm">Tente ajustar os filtros ou a pesquisa</p>
          </div>
        ) : (
          <>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {devices.map((device) => (
                <DeviceCard key={device.udi_di} device={device} onClick={setSelectedDevice} />
              ))}
            </div>
            {hasMore && (
              <div className="flex justify-center pt-4 pb-2">
                <Button variant="outline" onClick={loadMore} disabled={loadingMore} className="gap-2 rounded-lg">
                  {loadingMore ? (
                    <><Loader2 className="h-4 w-4 animate-spin" />Carregando...</>
                  ) : (
                    <><ChevronDown className="h-4 w-4" />Carregar mais ({(totalCount - devices.length).toLocaleString("pt-BR")} restantes)</>
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <DeviceDetail
        device={selectedDevice}
        open={!!selectedDevice}
        onClose={() => setSelectedDevice(null)}
      />
    </div>
  );
};

export default Index;
