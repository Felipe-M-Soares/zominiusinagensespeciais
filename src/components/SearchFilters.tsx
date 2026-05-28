// CODE-01 FIX: Substituído padrão debounceRef inline (que era copiado do Estoque)
// pelo hook useDebounce compartilhado.
// CODE-04 FIX: Substituído document.addEventListener("mousedown") pelo useClickOutside.
import { useState, useRef, memo } from "react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { X, SlidersHorizontal } from "lucide-react";
import { SearchInputWithBarcode } from "@/components/SearchInputWithBarcode";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import { useClickOutside } from "@/hooks/useClickOutside";

const LETTERS = "#ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

// ── SearchBar isolado — não propaga re-renders ao pai a cada tecla ─────────────
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

  // CODE-01 FIX: useDebounce substitui debounceRef inline
  const debouncedSearch = useDebounce((v: string) => onSearch(v), 400);

  // CODE-04 FIX: useClickOutside substitui document.addEventListener
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
        <button type="button" onClick={handleClear} aria-label="Limpar busca" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
          <X className="h-3.5 w-3.5" />
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

// ── SearchFilters principal ────────────────────────────────────────────────────
interface Props {
  onSearchChange: (v: string) => void;
  onSearchSubmit: (v: string) => void;
  hasValue: boolean;
  suggestions?: string[];
  showSuggestions?: boolean;
  onSelectSuggestion?: (s: string) => void;
  onCloseSuggestions?: () => void;
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
  onSearchChange, onSearchSubmit, hasValue,
  suggestions = [], showSuggestions = false,
  onSelectSuggestion, onCloseSuggestions,
  materials, classifications, exocadOptions,
  filters, onFilterChange, onClear,
  resultCount, totalCount,
  activeLetter, availableLetters, onLetterSelect,
}: Props) {
  const [open, setOpen] = useState(false);

  const activeFilterCount = [
    filters.material, filters.classification, filters.sterile,
    filters.single_use, filters.exocad, activeLetter,
  ].filter(Boolean).length;

  const hasFilters = filters.material || filters.classification || filters.sterile ||
    filters.single_use || filters.exocad || activeLetter;

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <SearchInputWithBarcode
          className="flex-1"
          onChange={v => onSearchChange(v)}
          onSearch={v => { onSearchChange(v); onSearchSubmit(v); }}
          height="h-10 sm:h-11"
        />

        <Button variant={open ? "default" : "outline"} size="icon"
          className="h-10 w-10 sm:h-11 sm:w-11 shrink-0 relative"
          onClick={() => setOpen(!open)} aria-label="Filtros avançados"
        >
          <SlidersHorizontal className="h-4 w-4" />
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-destructive-foreground text-[10px] flex items-center justify-center font-bold">
              {activeFilterCount}
            </span>
          )}
        </Button>
      </div>

      {open && (
        <div className="rounded-lg border border-border bg-card p-3 sm:p-4 space-y-4 animate-in slide-in-from-top-2 duration-200">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
            <Select value={filters.material || "all"} onValueChange={v => onFilterChange("material", v === "all" ? "" : v)}>
              <SelectTrigger className="bg-background text-xs sm:text-sm h-9"><SelectValue placeholder="Material" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os materiais</SelectItem>
                {materials.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.classification || "all"} onValueChange={v => onFilterChange("classification", v === "all" ? "" : v)}>
              <SelectTrigger className="bg-background text-xs sm:text-sm h-9"><SelectValue placeholder="Classificação" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as classes</SelectItem>
                {classifications.map(c => <SelectItem key={c} value={c}>Classe {c}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.sterile || "all"} onValueChange={v => onFilterChange("sterile", v === "all" ? "" : v)}>
              <SelectTrigger className="bg-background text-xs sm:text-sm h-9"><SelectValue placeholder="Esterilidade" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="true">Estéril</SelectItem>
                <SelectItem value="false">Não Estéril</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filters.single_use || "all"} onValueChange={v => onFilterChange("single_use", v === "all" ? "" : v)}>
              <SelectTrigger className="bg-background text-xs sm:text-sm h-9"><SelectValue placeholder="Uso" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os usos</SelectItem>
                <SelectItem value="true">Uso único</SelectItem>
                <SelectItem value="false">Reutilizável</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filters.exocad || "all"} onValueChange={v => onFilterChange("exocad", v === "all" ? "" : v)}>
              <SelectTrigger className="bg-background text-xs sm:text-sm h-9"><SelectValue placeholder="Exocad" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos Exocad</SelectItem>
                {exocadOptions.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-2 font-medium">Filtrar por letra inicial</p>
            <div className="flex flex-wrap gap-1">
              <button onClick={() => onLetterSelect("")}
                className={cn("h-7 px-2 rounded text-[11px] font-medium transition-colors",
                  activeLetter === "" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-accent border border-border"
                )}>Todos</button>
              {LETTERS.filter(l => availableLetters.has(l)).map(letter => (
                <button key={letter} onClick={() => onLetterSelect(letter)}
                  className={cn("h-7 w-7 rounded text-[11px] font-medium transition-colors",
                    activeLetter === letter ? "bg-primary text-primary-foreground" : "bg-background text-foreground hover:bg-accent border border-border"
                  )}>{letter}</button>
              ))}
            </div>
          </div>

          {hasFilters && (
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={onClear} className="gap-1 text-muted-foreground text-xs h-8">
                <X className="h-3.5 w-3.5" /> Limpar todos os filtros
              </Button>
            </div>
          )}
        </div>
      )}

      <p className="text-xs sm:text-sm text-muted-foreground">
        {resultCount === totalCount
          ? `${totalCount.toLocaleString("pt-BR")} dispositivos cadastrados`
          : `${resultCount.toLocaleString("pt-BR")} de ${totalCount.toLocaleString("pt-BR")} dispositivos`}
      </p>
    </div>
  );
}
