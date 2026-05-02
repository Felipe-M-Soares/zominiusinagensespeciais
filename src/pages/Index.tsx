import { useState, useCallback, useEffect, useRef } from "react";
import { useDevices, useDeviceOptions, type Filters } from "@/hooks/useDevices";
import { useAuth } from "@/hooks/useAuth";
import { SearchFilters } from "@/components/SearchFilters";
import { DeviceCard } from "@/components/DeviceCard";
import { DeviceDetail } from "@/components/DeviceDetail";
import type { Device } from "@/types/device";
import { Button } from "@/components/ui/button";
import { LogOut, Settings, BookOpen, ChevronDown, Loader2, Boxes, ShoppingBag, Receipt, Menu, X as XIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { CatalogButton } from "@/components/CatalogButton";
import { getStoredTheme, applyTheme } from "@/pages/Settings";
import { supabase } from "@/integrations/supabase/client";

const EMPTY_FILTERS: Filters = Object.freeze({ material: "", classification: "", sterile: "", single_use: "", exocad: "" }) as Filters;

const Index = () => {
  const { signOut, isAdmin } = useAuth();
  const navigate = useNavigate();

  // FIX TEMA: usa a mesma lógica de Settings (applyTheme/getStoredTheme) para que
  // o toggle do Index e a página de Settings fiquem sincronizados.
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

  // `querySearch` = valor que dispara a query no banco (atualiza com debounce ou Enter)
  // O valor visual do input é controlado internamente pelo SearchFilters
  const [querySearch, setQuerySearch] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [activeLetter, setActiveLetter] = useState("");

  // Autocomplete
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const autocompleteRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { devices, totalCount, loading, loadingMore, error, loadMore, hasMore } =
    useDevices(querySearch, filters, activeLetter);

  const options = useDeviceOptions();

  // Debounce no pai — atualiza querySearch após parar de digitar
  const handleSearchChange = useCallback((v: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!v.trim()) {
      setQuerySearch("");
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setQuerySearch(v.trim());
    }, 350);
  }, []);

  // Enter ou botão lupa — disparo imediato
  const handleSearchSubmit = useCallback((v: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setQuerySearch(v);
    setShowSuggestions(false);
  }, []);

  // Selecionar sugestão
  const handleSelectSuggestion = useCallback((s: string) => {
    setQuerySearch(s);
    setSuggestions([]);
    setShowSuggestions(false);
  }, []);

  const handleFilterChange = useCallback((key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleLetterSelect = useCallback((letter: string) => {
    setActiveLetter(letter);
  }, []);

  const handleClear = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setQuerySearch("");
    setSuggestions([]);
    setShowSuggestions(false);
    setFilters(EMPTY_FILTERS);
    setActiveLetter("");
  }, []);

  // Gera sugestões a partir dos devices já carregados (baseado no querySearch)
  useEffect(() => {
    if (!querySearch.trim() || querySearch.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const q = querySearch.trim().toLowerCase();
    const seen = new Set<string>();
    const result: string[] = [];
    for (const d of devices) {
      const model = d.model;
      if (model && model.toLowerCase().includes(q) && !seen.has(model)) {
        seen.add(model);
        result.push(model);
        if (result.length >= 6) break;
      }
    }
    setSuggestions(result);
    setShowSuggestions(result.length > 0);
  }, [querySearch, devices]);

  // Fecha autocomplete ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (autocompleteRef.current && !autocompleteRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);

  const [menuOpen, setMenuOpen] = useState(false);

  // Fecha menu ao navegar
  const handleAdminNav = useCallback((path: string) => {
    setMenuOpen(false);
    navigate(path);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background">
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
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
            <p className="text-sm text-muted-foreground">Carregando dispositivos...</p>
          </div>
        ) : error ? (
          <div className="text-center py-20 text-destructive">{error}</div>
        ) : (
          <>
            <SearchFilters
              autocompleteRef={autocompleteRef}
              search={querySearch}
              onSearchChange={handleSearchChange}
              onSearchSubmit={handleSearchSubmit}
              suggestions={suggestions}
              showSuggestions={showSuggestions}
              onSelectSuggestion={handleSelectSuggestion}
              onCloseSuggestions={() => setShowSuggestions(false)}
              materials={options.materials}
              classifications={options.classifications}
              exocadOptions={options.exocadOptions}
              filters={filters}
              onFilterChange={handleFilterChange}
              onClear={handleClear}
              resultCount={devices.length}
              totalCount={totalCount}
              activeLetter={activeLetter}
              availableLetters={options.availableLetters}
              onLetterSelect={handleLetterSelect}
            />

            {devices.length === 0 ? (
              <div className="text-center py-16 space-y-2">
                <p className="text-muted-foreground text-lg font-display">
                  Nenhum dispositivo encontrado
                </p>
                <p className="text-muted-foreground text-sm">
                  Tente ajustar os filtros ou a pesquisa
                </p>
              </div>
            ) : (
              <>
                <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {devices.map((device) => (
                    <DeviceCard
                      key={device.udi_di}
                      device={device}
                      onClick={setSelectedDevice}
                    />
                  ))}
                </div>

                {hasMore && (
                  <div className="flex justify-center pt-2">
                    <Button
                      variant="outline"
                      onClick={loadMore}
                      disabled={loadingMore}
                      className="gap-2"
                    >
                      {loadingMore ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Carregando...
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-4 w-4" />
                          Carregar mais (
                          {(totalCount - devices.length).toLocaleString("pt-BR")} restantes)
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </>
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
