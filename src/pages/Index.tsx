import { useState, useCallback, memo, useRef } from "react";
import { useDevices, useDeviceOptions, type Filters } from "@/hooks/useDevices";
import { useDebounce } from "@/hooks/useDebounce";
import { useClickOutside } from "@/hooks/useClickOutside";
import { useAuth } from "@/hooks/useAuth";
import { DeviceCard } from "@/components/DeviceCard";
import { DeviceDetail } from "@/components/DeviceDetail";
import type { Device } from "@/types/device";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LogOut, Settings, BookOpen, ChevronDown, Loader2, Boxes, ShoppingBag, Receipt, Menu, X as XIcon, Search, SlidersHorizontal, ScanBarcode, ClipboardList } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { CatalogButton } from "@/components/CatalogButton";
import { getStoredTheme, applyTheme } from "@/pages/Settings";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const LETTERS = "#ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const EMPTY_FILTERS: Filters = Object.freeze({ material: "", classification: "", sterile: "", single_use: "", exocad: "" }) as Filters;

// ── SearchBar — copiado literalmente do Estoque ───────────────────────────────
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
  onSearch, onClear, hasValue: _hasValue, suggestions, showSuggestions, onSelectSuggestion, onCloseSuggestions
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
        className="flex h-10 sm:h-11 w-full rounded-md border border-input bg-card px-3 py-2 pl-10 pr-10 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
  const { signOut, isAdmin } = useAuth();
  const navigate = useNavigate();

  const [isDark, setIsDark] = useState(() => {
    const theme = getStoredTheme();
    if (theme === "system") return window.matchMedia("(prefers-color-scheme: dark)").matches;
    return theme === "dark";
  });

  const toggleTheme = useCallback(() => {
    const next = !isDark;
    setIsDark(next);
    applyTheme(next ? "dark" : "light");
  }, [isDark]);

  // Igual ao Estoque: search = valor visual (autocomplete), querySearch = vai ao banco
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
    setShowAutocomplete(false);
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearch("");
    setQuerySearch("");
    setShowAutocomplete(false);
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

  const [menuOpen, setMenuOpen] = useState(false);

  // Fecha menu ao navegar
  const handleAdminNav = useCallback((path: string) => {
    setMenuOpen(false);
    navigate(path);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-transparent">
      <header className="border-b border-border/50 bg-card/80 backdrop-blur-md sticky top-0 z-10">
        <div className="container mx-auto px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <p className="text-xs text-muted-foreground hidden sm:block">
              Base de dados ANVISA
            </p>
          </div>
          <nav className="flex items-center gap-0.5">
            {/* Itens sempre visíveis (web e mobile) */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/estoque")}
              className="h-8 px-2 sm:px-3 text-xs"
              title="Controle de Estoque"
            >
              <Boxes className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Estoque</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/comercial")}
              className="h-8 px-2 sm:px-3 text-xs"
              title="Comercial"
            >
              <ShoppingBag className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Comercial</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/financeiro")}
              className="h-8 px-2 sm:px-3 text-xs"
              title="Financeiro"
            >
              <Receipt className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Financeiro</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/producao")}
              className="h-8 px-2 sm:px-3 text-xs"
              title="Produção Industrial"
            >
              <ClipboardList className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Produção</span>
            </Button>
            <CatalogButton />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => navigate("/manuals")}
              title="Manuais"
            >
              <BookOpen className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={toggleTheme}
              title={isDark ? "Modo claro" : "Modo escuro"}
            >
              {isDark
                ? <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
                : <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              }
            </Button>

            {/* Admin: botão direto no desktop, hambúrguer no mobile */}
            {isAdmin && (
              <>
                {/* Desktop: botão Admin visível normalmente */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate("/admin")}
                  className="hidden sm:flex h-8 px-3 text-xs"
                >
                  <Settings className="h-4 w-4 mr-1" />
                  Admin
                </Button>

                {/* Mobile: botão hambúrguer */}
                <div className="relative sm:hidden">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setMenuOpen((v) => !v)}
                    title="Menu admin"
                    aria-expanded={menuOpen}
                  >
                    {menuOpen
                      ? <XIcon className="h-4 w-4" />
                      : <Menu className="h-4 w-4" />
                    }
                  </Button>

                  {menuOpen && (
                    <>
                      {/* Overlay para fechar ao clicar fora */}
                      <div
                        className="fixed inset-0 z-20"
                        onClick={() => setMenuOpen(false)}
                      />
                      {/* Dropdown menu */}
                      <div className="absolute right-0 top-full mt-1 z-30 min-w-[160px] rounded-xl border border-border/50 bg-card/95 backdrop-blur-md shadow-lg py-1 overflow-hidden">
                        <button
                          type="button"
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-foreground hover:bg-muted/50 transition-colors"
                          onClick={() => handleAdminNav("/admin")}
                        >
                          <Settings className="h-3.5 w-3.5 text-primary" />
                          Admin
                        </button>
                        <div className="border-t border-border/30 my-1" />
                        <button
                          type="button"
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-foreground hover:bg-muted/50 transition-colors"
                          onClick={() => { setMenuOpen(false); signOut(); }}
                        >
                          <LogOut className="h-3.5 w-3.5 text-muted-foreground" />
                          Sair
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}

            {/* Sair: visível no desktop ou quando não é admin (mobile) */}
            <Button
              variant="ghost"
              size="sm"
              onClick={signOut}
              className={isAdmin ? "hidden sm:flex h-8 px-3 text-xs" : "h-8 px-2 text-xs"}
            >
              <LogOut className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Sair</span>
            </Button>
          </nav>
        </div>
      </header>

      <main className="container mx-auto px-4 py-5 space-y-5">

        {/* Busca e filtros — SEMPRE montados, fora do condicional de loading */}
        <div className="space-y-3">
          <div className="flex gap-2">
            <SearchBar
              onSearch={handleSearchChange}
              onClear={handleClearSearch}
              hasValue={!!search}
              suggestions={autocompleteItems}
              showSuggestions={showAutocomplete}
              onSelectSuggestion={handleSelectSuggestion}
              onCloseSuggestions={() => setShowAutocomplete(false)}
            />
            <Button type="button" variant="outline" size="icon" className="h-10 w-10 sm:h-11 sm:w-11 shrink-0"
              onClick={() => search.trim() && handleSelectSuggestion(search.trim())}>
              <Search className="h-4 w-4" />
            </Button>
            <Button type="button" variant={showFilters ? "default" : "outline"} size="icon"
              className="h-10 w-10 sm:h-11 sm:w-11 shrink-0 relative"
              onClick={() => setShowFilters(v => !v)}>
              <SlidersHorizontal className="h-4 w-4" />
              {activeFilterCount > 0 && (
                <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-destructive-foreground text-[10px] flex items-center justify-center font-bold">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </div>

          {showFilters && (
            <div className="rounded-lg border border-border bg-card p-3 sm:p-4 space-y-4 animate-in slide-in-from-top-2 duration-200">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
                <Select value={filters.material || "all"} onValueChange={v => handleFilterChange("material", v === "all" ? "" : v)}>
                  <SelectTrigger className="bg-background text-xs sm:text-sm h-9"><SelectValue placeholder="Material" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os materiais</SelectItem>
                    {options.materials.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={filters.classification || "all"} onValueChange={v => handleFilterChange("classification", v === "all" ? "" : v)}>
                  <SelectTrigger className="bg-background text-xs sm:text-sm h-9"><SelectValue placeholder="Classificação" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as classes</SelectItem>
                    {options.classifications.map(c => <SelectItem key={c} value={c}>Classe {c}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={filters.sterile || "all"} onValueChange={v => handleFilterChange("sterile", v === "all" ? "" : v)}>
                  <SelectTrigger className="bg-background text-xs sm:text-sm h-9"><SelectValue placeholder="Esterilidade" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="true">Estéril</SelectItem>
                    <SelectItem value="false">Não Estéril</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filters.single_use || "all"} onValueChange={v => handleFilterChange("single_use", v === "all" ? "" : v)}>
                  <SelectTrigger className="bg-background text-xs sm:text-sm h-9"><SelectValue placeholder="Uso" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os usos</SelectItem>
                    <SelectItem value="true">Uso único</SelectItem>
                    <SelectItem value="false">Reutilizável</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filters.exocad || "all"} onValueChange={v => handleFilterChange("exocad", v === "all" ? "" : v)}>
                  <SelectTrigger className="bg-background text-xs sm:text-sm h-9"><SelectValue placeholder="Exocad" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos Exocad</SelectItem>
                    {options.exocadOptions.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-2 font-medium">Filtrar por letra inicial</p>
                <div className="flex flex-wrap gap-1">
                  <button onClick={() => handleLetterSelect("")} className={cn("h-7 px-2 rounded text-[11px] font-medium transition-colors", activeLetter === "" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-accent border border-border")}>Todos</button>
                  {LETTERS.filter(l => options.availableLetters.has(l)).map(letter => (
                    <button key={letter} onClick={() => handleLetterSelect(letter)} className={cn("h-7 w-7 rounded text-[11px] font-medium transition-colors", activeLetter === letter ? "bg-primary text-primary-foreground" : "bg-background text-foreground hover:bg-accent border border-border")}>{letter}</button>
                  ))}
                </div>
              </div>
              {(filters.material || filters.classification || filters.sterile || filters.single_use || filters.exocad || activeLetter) && (
                <div className="flex justify-end">
                  <Button variant="ghost" size="sm" onClick={handleClear} className="gap-1 text-muted-foreground text-xs h-8">
                    <XIcon className="h-3.5 w-3.5" /> Limpar todos os filtros
                  </Button>
                </div>
              )}
            </div>
          )}

          <p className="text-xs sm:text-sm text-muted-foreground">
            {devices.length === totalCount
              ? `${totalCount.toLocaleString("pt-BR")} dispositivos cadastrados`
              : `${devices.length.toLocaleString("pt-BR")} de ${totalCount.toLocaleString("pt-BR")} dispositivos`}
          </p>
        </div>

        {/* Conteúdo condicional — loading, erro, ou lista */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
            <p className="text-sm text-muted-foreground">Carregando dispositivos...</p>
          </div>
        ) : error ? (
          <div className="text-center py-20 text-destructive">{error}</div>
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
              <div className="flex justify-center pt-2">
                <Button variant="outline" onClick={loadMore} disabled={loadingMore} className="gap-2">
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
      </main>

      <DeviceDetail
        device={selectedDevice}
        open={!!selectedDevice}
        onClose={() => setSelectedDevice(null)}
      />
    </div>
  );
};

export default Index;
