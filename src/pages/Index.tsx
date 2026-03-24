import { useState, useCallback } from "react";
import { useDevices, useFilteredDevices, useDeviceOptions, type Filters } from "@/hooks/useDevices";
import { useAuth } from "@/hooks/useAuth";
import { SearchFilters } from "@/components/SearchFilters";
import { DeviceCard } from "@/components/DeviceCard";
import { DeviceDetail } from "@/components/DeviceDetail";
import type { Device } from "@/types/device";
import { Button } from "@/components/ui/button";
import { LogOut, Settings, Sun, Moon, Phone, BookOpen, ChevronDown } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Logo } from "@/components/Logo";
import { CatalogButton } from "@/components/CatalogButton";

const PAGE_SIZE = 60;

const Index = () => {
  const { devices, loading, error } = useDevices();
  const { signOut, isAdmin } = useAuth();
  const navigate = useNavigate();

  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));
  // FIX: Sincronizar com o sistema de tema da Settings.tsx.
  // Settings.tsx usa localStorage com valores "light" | "dark" | "system".
  // O toggle aqui deve respeitar esse mesmo sistema em vez de sobrescrever com "dark"/"light" diretamente.
  const toggleTheme = useCallback(() => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    // Grava no mesmo formato que Settings.tsx espera, sem interferir com a opção "system"
    const currentStored = localStorage.getItem("theme");
    if (currentStored !== "system") {
      localStorage.setItem("theme", next ? "dark" : "light");
    } else {
      // Se estava em "system", muda explicitamente para o tema selecionado
      localStorage.setItem("theme", next ? "dark" : "light");
    }
  }, [isDark]);

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>({ material: "", classification: "", sterile: "", single_use: "", exocad: "" });
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [activeLetter, setActiveLetter] = useState("");

  const filtered = useFilteredDevices(devices, search, filters, activeLetter);
  const options = useDeviceOptions(devices);

  const handleFilterChange = useCallback((key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setVisibleCount(PAGE_SIZE);
  }, []);

  const handleClear = useCallback(() => {
    setSearch("");
    setFilters({ material: "", classification: "", sterile: "", single_use: "", exocad: "" });
    setActiveLetter("");
    setVisibleCount(PAGE_SIZE);
  }, []);

  const handleSearchChange = useCallback((v: string) => {
    setSearch(v);
    setVisibleCount(PAGE_SIZE);
  }, []);

  const handleLetterSelect = useCallback((letter: string) => {
    setActiveLetter(letter);
    setVisibleCount(PAGE_SIZE);
  }, []);

  const visibleDevices = filtered.slice(0, visibleCount);
  const remaining = filtered.length - visibleCount;

  return (
    <div className="min-h-screen bg-background">
      {/* Modern header */}
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
              <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} className="h-8 px-2 sm:px-3 text-xs">
                <Settings className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">Admin</span>
              </Button>
            )}
            <CatalogButton />
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/manuals")} title="Manuais">
              <BookOpen className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/contacts")} title="Contatos">
              <Phone className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleTheme}>
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={signOut} className="h-8 px-2 sm:px-3 text-xs">
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
              resultCount={filtered.length}
              totalCount={devices.length}
              activeLetter={activeLetter}
              availableLetters={options.availableLetters}
              onLetterSelect={handleLetterSelect}
            />

            {filtered.length === 0 ? (
              <div className="text-center py-16 space-y-2">
                <p className="text-muted-foreground text-lg font-display">Nenhum dispositivo encontrado</p>
                <p className="text-muted-foreground text-sm">Tente ajustar os filtros ou a pesquisa</p>
              </div>
            ) : (
              <>
                <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {visibleDevices.map((device) => (
                    <DeviceCard key={device.udi_di} device={device} onClick={setSelectedDevice} />
                  ))}
                </div>

                {remaining > 0 && (
                  <div className="flex justify-center pt-2">
                    <Button
                      variant="outline"
                      onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                      className="gap-2"
                    >
                      <ChevronDown className="h-4 w-4" />
                      Carregar mais ({Math.min(PAGE_SIZE, remaining).toLocaleString("pt-BR")} de {remaining.toLocaleString("pt-BR")} restantes)
                    </Button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>

      <DeviceDetail device={selectedDevice} open={!!selectedDevice} onClose={() => setSelectedDevice(null)} />
    </div>
  );
};

export default Index;
