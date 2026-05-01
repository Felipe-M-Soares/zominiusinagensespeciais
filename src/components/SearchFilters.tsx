import { useState, useRef, useCallback, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, X, SlidersHorizontal, ScanBarcode } from "lucide-react";
import { cn } from "@/lib/utils";

const LETTERS = "#ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

interface Props {
  search: string;
  onSearchChange: (v: string) => void;
  onSearchSubmit: (v: string) => void;
  materials: string[];
  classifications: string[];
  exocadOptions: string[];
  filters: { material: string; classification: string; sterile: string; single_use: string; exocad: string };
  onFilterChange: (key: string, value: string) => void;
  onClear: () => void;
  resultCount: number;
  totalCount: number;
  activeLetter: string;
  availableLetters: Set<string>;
  onLetterSelect: (letter: string) => void;
}

export function SearchFilters({
  search,
  onSearchChange,
  onSearchSubmit,
  materials,
  classifications,
  exocadOptions,
  filters,
  onFilterChange,
  onClear,
  resultCount,
  totalCount,
  activeLetter,
  availableLetters,
  onLetterSelect,
}: Props) {
  const [open, setOpen] = useState(false);

  // Input CONTROLADO com estado local — evita perda de foco e travamento
  const [localSearch, setLocalSearch] = useState(search);

  // Sincroniza com o pai APENAS quando o pai reseta externamente (ex: "Limpar tudo")
  // Usa ref para não sobrescrever o que o usuário está digitando
  const prevSearchRef = useRef(search);
  useEffect(() => {
    if (search !== prevSearchRef.current) {
      prevSearchRef.current = search;
      setLocalSearch(search);
    }
  }, [search]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasFilters =
    localSearch ||
    filters.material ||
    filters.classification ||
    filters.sterile ||
    filters.single_use ||
    filters.exocad ||
    activeLetter;

  const activeFilterCount = [
    filters.material,
    filters.classification,
    filters.sterile,
    filters.single_use,
    filters.exocad,
    activeLetter,
  ].filter(Boolean).length;

  const handleFocus = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.select());
  }, []);

  // Debounce ÚNICO aqui — o pai não adiciona debounce adicional
  const handleChange = useCallback(
    (v: string) => {
      setLocalSearch(v);
      prevSearchRef.current = v;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!v.trim()) {
        onSearchChange("");
        return;
      }
      debounceRef.current = setTimeout(() => onSearchChange(v), 400);
    },
    [onSearchChange]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      const pasted = e.clipboardData.getData("text").trim();
      setLocalSearch(pasted);
      prevSearchRef.current = pasted;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      onSearchChange(pasted);
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) el.setSelectionRange(0, pasted.length);
      });
    },
    [onSearchChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const value = localSearch.trim();
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (value) onSearchSubmit(value);
        requestAnimationFrame(() => inputRef.current?.select());
      }
    },
    [localSearch, onSearchSubmit]
  );

  const handleClearInput = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setLocalSearch("");
    prevSearchRef.current = "";
    onSearchChange("");
    inputRef.current?.focus();
  }, [onSearchChange]);

  const handleClearAll = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setLocalSearch("");
    prevSearchRef.current = "";
    onClear();
  }, [onClear]);

  return (
    <div className="space-y-3">
      {/* Search row */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Bipe o código de barras ou pesquise aqui..."
            value={localSearch}
            onChange={(e) => handleChange(e.target.value)}
            onFocus={handleFocus}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            className="flex h-10 sm:h-11 w-full rounded-md border border-input bg-card px-3 py-2 pl-10 pr-10 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
          {localSearch && (
            <button
              type="button"
              aria-label="Limpar busca"
              onClick={handleClearInput}
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
          title="Pesquisar"
          aria-label="Pesquisar"
          className="h-10 w-10 sm:h-11 sm:w-11 shrink-0"
          onClick={() => {
            const v = localSearch.trim();
            if (debounceRef.current) clearTimeout(debounceRef.current);
            if (v) onSearchSubmit(v);
          }}
        >
          <Search className="h-4 w-4" />
        </Button>

        <Button
          variant={open ? "default" : "outline"}
          size="icon"
          className="h-10 w-10 sm:h-11 sm:w-11 shrink-0 relative"
          onClick={() => setOpen(!open)}
          aria-label="Filtros avançados"
        >
          <SlidersHorizontal className="h-4 w-4" />
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-destructive-foreground text-[10px] flex items-center justify-center font-bold">
              {activeFilterCount}
            </span>
          )}
        </Button>
      </div>

      {/* Collapsible filters panel */}
      {open && (
        <div className="rounded-lg border border-border bg-card p-3 sm:p-4 space-y-4 animate-in slide-in-from-top-2 duration-200">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
            <Select
              value={filters.material || "all"}
              onValueChange={(v) => onFilterChange("material", v === "all" ? "" : v)}
            >
              <SelectTrigger className="bg-background text-xs sm:text-sm h-9">
                <SelectValue placeholder="Material" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os materiais</SelectItem>
                {materials.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.classification || "all"}
              onValueChange={(v) => onFilterChange("classification", v === "all" ? "" : v)}
            >
              <SelectTrigger className="bg-background text-xs sm:text-sm h-9">
                <SelectValue placeholder="Classificação" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as classes</SelectItem>
                {classifications.map((c) => (
                  <SelectItem key={c} value={c}>Classe {c}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.sterile || "all"}
              onValueChange={(v) => onFilterChange("sterile", v === "all" ? "" : v)}
            >
              <SelectTrigger className="bg-background text-xs sm:text-sm h-9">
                <SelectValue placeholder="Esterilidade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="true">Estéril</SelectItem>
                <SelectItem value="false">Não Estéril</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filters.single_use || "all"}
              onValueChange={(v) => onFilterChange("single_use", v === "all" ? "" : v)}
            >
              <SelectTrigger className="bg-background text-xs sm:text-sm h-9">
                <SelectValue placeholder="Uso" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os usos</SelectItem>
                <SelectItem value="true">Uso único</SelectItem>
                <SelectItem value="false">Reutilizável</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filters.exocad || "all"}
              onValueChange={(v) => onFilterChange("exocad", v === "all" ? "" : v)}
            >
              <SelectTrigger className="bg-background text-xs sm:text-sm h-9">
                <SelectValue placeholder="Exocad" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos Exocad</SelectItem>
                {exocadOptions.map((e) => (
                  <SelectItem key={e} value={e}>{e}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Letter navigation */}
          <div>
            <p className="text-xs text-muted-foreground mb-2 font-medium">Filtrar por letra inicial</p>
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => onLetterSelect("")}
                className={cn(
                  "h-7 px-2 rounded text-[11px] font-medium transition-colors",
                  activeLetter === ""
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-accent border border-border"
                )}
              >
                Todos
              </button>
              {LETTERS.filter((l) => availableLetters.has(l)).map((letter) => (
                <button
                  key={letter}
                  onClick={() => onLetterSelect(letter)}
                  className={cn(
                    "h-7 w-7 rounded text-[11px] font-medium transition-colors",
                    activeLetter === letter
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-foreground hover:bg-accent border border-border"
                  )}
                >
                  {letter}
                </button>
              ))}
            </div>
          </div>

          {hasFilters && (
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearAll}
                className="gap-1 text-muted-foreground text-xs h-8"
              >
                <X className="h-3.5 w-3.5" /> Limpar todos os filtros
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Result count */}
      <p className="text-xs sm:text-sm text-muted-foreground">
        {resultCount === totalCount
          ? `${totalCount.toLocaleString("pt-BR")} dispositivos cadastrados`
          : `${resultCount.toLocaleString("pt-BR")} de ${totalCount.toLocaleString("pt-BR")} dispositivos`}
      </p>
    </div>
  );
}
