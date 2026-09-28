/**
 * Componentes (Base ANVISA) — catálogo dos dispositivos cadastrados.
 * Busca por nome/referência/UDI (aceita leitor de código de barras) e filtros
 * por material, classe, esterilidade, uso único, Exocad e letra inicial.
 */
import { useState, useCallback } from "react";
import { useDevices, useDeviceOptions, type Filters } from "@/hooks/useDevices";
import { DeviceCard } from "@/components/DeviceCard";
import { DeviceDetail } from "@/components/DeviceDetail";
import type { Device } from "@/types/device";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronDown, Cpu, Loader2, SlidersHorizontal, X as XIcon } from "lucide-react";
import { CatalogButton } from "@/components/CatalogButton";
import { ManuaisButton } from "@/components/ManuaisButton";
import { SearchInputWithBarcode } from "@/components/SearchInputWithBarcode";
import { cn } from "@/lib/utils";

const LETTERS = "#ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const EMPTY_FILTERS: Filters = Object.freeze({ material: "", classification: "", sterile: "", single_use: "", exocad: "" }) as Filters;

const Index = () => {
  const [querySearch, setQuerySearch] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [activeLetter, setActiveLetter] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const activeFilterCount = [filters.material, filters.classification, filters.sterile, filters.single_use, filters.exocad, activeLetter].filter(Boolean).length;

  const { devices, totalCount, loading, loadingMore, error, loadMore, hasMore } =
    useDevices(querySearch, filters, activeLetter);

  const options = useDeviceOptions();

  const handleClearSearch = useCallback(() => setQuerySearch(""), []);

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
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border/40 shrink-0">
        <div className="px-3 sm:px-4 h-12 sm:h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Cpu className="h-4 w-4 text-primary shrink-0" />
            <div className="min-w-0">
              <h1 className="text-sm font-semibold leading-tight">Componentes</h1>
              <p className="hidden sm:block text-[10px] text-muted-foreground leading-tight">Base ANVISA — dispositivos médicos cadastrados</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ManuaisButton />
            <CatalogButton />
          </div>
        </div>
      </header>
      <div className="px-3 sm:px-4 pt-4 pb-3 shrink-0">
        <div className="flex gap-2">
          <SearchInputWithBarcode
            className="flex-1 min-w-0"
            value={querySearch}
            onChange={v => setQuerySearch(v.trim())}
            onSearch={v => setQuerySearch(v.trim())}
            placeholder="Bipe o código ou busque nome, referência, UDI"
            height="h-11"
            debounceMs={400}
          />
          <Button type="button" variant={showFilters || activeFilterCount > 0 ? "default" : "outline"}
            className="h-11 gap-1.5 shrink-0 px-3 relative" onClick={() => setShowFilters(v => !v)} aria-expanded={showFilters}>
            <SlidersHorizontal className="h-4 w-4" /><span className="hidden sm:inline">Filtros</span>
            {activeFilterCount > 0 && (
              <span className="min-w-[18px] h-[18px] rounded-full bg-background/90 text-foreground text-[10px] font-bold inline-flex items-center justify-center px-1">{activeFilterCount}</span>
            )}
          </Button>
        </div>
      </div>

      {showFilters && (
        <div className="mx-3 sm:mx-4 mb-3 rounded-2xl border bg-card p-3 sm:p-4 space-y-4 animate-in slide-in-from-top-2 duration-200 shrink-0">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            <Select value={filters.material || "all"} onValueChange={v => handleFilterChange("material", v === "all" ? "" : v)}>
              <SelectTrigger className="bg-background text-sm h-11 rounded-xl"><SelectValue placeholder="Material" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os materiais</SelectItem>
                {options.materials.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.classification || "all"} onValueChange={v => handleFilterChange("classification", v === "all" ? "" : v)}>
              <SelectTrigger className="bg-background text-sm h-11 rounded-xl"><SelectValue placeholder="Classificação" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as classes</SelectItem>
                {options.classifications.map(c => <SelectItem key={c} value={c}>Classe {c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.sterile || "all"} onValueChange={v => handleFilterChange("sterile", v === "all" ? "" : v)}>
              <SelectTrigger className="bg-background text-sm h-11 rounded-xl"><SelectValue placeholder="Esterilidade" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="true">Estéril</SelectItem>
                <SelectItem value="false">Não Estéril</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.single_use || "all"} onValueChange={v => handleFilterChange("single_use", v === "all" ? "" : v)}>
              <SelectTrigger className="bg-background text-sm h-11 rounded-xl"><SelectValue placeholder="Uso" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os usos</SelectItem>
                <SelectItem value="true">Uso único</SelectItem>
                <SelectItem value="false">Reutilizável</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.exocad || "all"} onValueChange={v => handleFilterChange("exocad", v === "all" ? "" : v)}>
              <SelectTrigger className="bg-background text-sm h-11 rounded-xl"><SelectValue placeholder="Exocad" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos Exocad</SelectItem>
                {options.exocadOptions.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-2 font-medium">Filtrar por letra inicial</p>
            <div className="flex flex-wrap gap-1">
              <button onClick={() => handleLetterSelect("")} className={cn("h-9 px-3 rounded-lg text-xs font-medium transition-colors", activeLetter === "" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-accent border border-border")}>Todos</button>
              {LETTERS.filter(l => options.availableLetters.has(l)).map(letter => (
                <button key={letter} onClick={() => handleLetterSelect(letter)} className={cn("h-9 w-9 rounded-lg text-xs font-medium transition-colors", activeLetter === letter ? "bg-primary text-primary-foreground" : "bg-background text-foreground hover:bg-accent border border-border")}>{letter}</button>
              ))}
            </div>
          </div>
          {(filters.material || filters.classification || filters.sterile || filters.single_use || filters.exocad || activeLetter) && (
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={handleClear} className="gap-1 text-muted-foreground h-10">
                <XIcon className="h-3.5 w-3.5" /> Limpar filtros
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="px-3 sm:px-4 pb-2 shrink-0">
        <p className="text-xs text-muted-foreground">
          {loading ? "Buscando..." : devices.length === totalCount
            ? `${totalCount.toLocaleString("pt-BR")} componentes`
            : `${devices.length.toLocaleString("pt-BR")} de ${totalCount.toLocaleString("pt-BR")} componentes`}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-3 sm:px-4 pb-4">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />Carregando componentes...
          </div>
        ) : error ? (
          <div className="text-center py-20 text-destructive text-sm">{error}</div>
        ) : devices.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-card py-12 px-4 text-center space-y-2">
            <p className="font-medium">Nenhum componente encontrado</p>
            <p className="text-muted-foreground text-sm">Tente outro termo ou remova filtros.</p>
            {(querySearch || activeFilterCount > 0) && <Button variant="outline" className="h-10 mt-1" onClick={handleClear}>Limpar busca e filtros</Button>}
          </div>
        ) : (
          <>
            <div className="grid gap-2 sm:gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {devices.map((device) => (
                <DeviceCard key={device.udi_di} device={device} onClick={setSelectedDevice} />
              ))}
            </div>
            {hasMore && (
              <div className="flex justify-center pt-4 pb-2">
                <Button variant="outline" onClick={loadMore} disabled={loadingMore} className="h-11 gap-2">
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
