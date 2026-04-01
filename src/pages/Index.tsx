import { useState, useCallback, useRef, useEffect } from "react";
import { useDevices, useDeviceOptions, type Filters } from "@/hooks/useDevices";
import { useAuth } from "@/hooks/useAuth";
import { SearchFilters } from "@/components/SearchFilters";
import { DeviceCard } from "@/components/DeviceCard";
import { DeviceDetail } from "@/components/DeviceDetail";
import type { Device } from "@/types/device";
import { Button } from "@/components/ui/button";
import { LogOut, Settings, Sun, Moon, Phone, BookOpen, ChevronDown, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Logo } from "@/components/Logo";
import { CatalogButton } from "@/components/CatalogButton";

const EMPTY_FILTERS: Filters = { material: "", classification: "", sterile: "", single_use: "", exocad: "" };

const Index = () => {
  const { signOut, isAdmin } = useAuth();
  const navigate = useNavigate();

  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  );
  const toggleTheme = useCallback(() => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }, [isDark]);

  // Estado bruto (digitação instantânea na UI)
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [activeLetter, setActiveLetter] = useState("");

  // Estado debounced (enviado ao hook de dados)
  const [querySearch, setQuerySearch] = useState("");
  const [queryFilters, setQueryFilters] = useState<Filters>(EMPTY_FILTERS);
  const [queryLetter, setQueryLetter] = useState("");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerDebounce = useCallback(
    (s: string, f: Filters, l: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setQuerySearch(s);
        setQueryFilters(f);
        setQueryLetter(l);
      }, 350);
    },
    []
  );

  const handleSearchChange = useCallback(
    (v: string) => {
      setSearch(v);
      triggerDebounce(v, filters, activeLetter);
    },
    [filters, activeLetter, triggerDebounce]
  );

  const handleFilterChange = useCallback(
    (key: string, value: string) => {
      setFilters((prev) => {
        const next = { ...prev, [key]: value };
        triggerDebounce(search, next, activeLetter);
        return next;
      });
    },
    [search, activeLetter, triggerDebounce]
  );

  const handleLetterSelect = useCallback(
    (letter: string) => {
      setActiveLetter(letter);
      triggerDebounce(search, filters, letter);
    },
    [search, filters, triggerDebounce]
  );

  const handleClear = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearch("");
    setFilters(EMPTY_FILTERS);
    setActiveLetter("");
    setQuerySearch("");
    setQueryFilters(EMPTY_FILTERS);
    setQueryLetter("");
  }, []);

  // Cleanup debounce on unmount
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);

  const { devices, totalCount, loading, loadingMore, error, loadMore, hasMore } =
    useDevices(querySearch, queryFilters, queryLetter);

  const options = useDeviceOptions();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/50 bg-card/80 backdrop-blur-md sticky top-0 z-10">
        <div className="container mx-auto px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Logo className="h-8 sm:h-10 object-contain shrink-0" />
            <div className="hidden sm:block h-6 w-px bg-border" />
            <p className="text-xs text-muted-foreground hidden sm:block">
              Base de dados ANVISA
            </p>
          </div>
          <nav className="flex items-center gap-0.5">
            {isAdmin && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/admin")}
                className="h-8 px-2 sm:px-3 text-xs"
              >
                <Settings className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">Admin</span>
              </Button>
            )}
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
              onClick={() => navigate("/contacts")}
              title="Contatos"
            >
              <Phone className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleTheme}>
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={signOut}
              className="h-8 px-2 sm:px-3 text-xs"
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
              search={search}
              onSearchChange={handleSearchChange}
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
