import { useState, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, X, SlidersHorizontal, ScanBarcode, Loader2 } from "lucide-react";
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
  // Novas props para autocomplete e estado de busca
  suggestions?: string[];
  onSuggestionClick?: (suggestion: string) => void;
  isSearching?: boolean;
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
  suggestions = [],
  onSuggestionClick,
  isSearching = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [suggestionsVisible, setSuggestionsVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const hasFilters =
    search ||
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
    setSuggestionsVisible(true);
  }, []);

  const handleBlur = useCallback((e: React.FocusEvent) => {
    // Não fecha se o foco foi para uma sugestão
    if (suggestionsRef.current?.contains(e.relatedTarget as Node)) return;
    setSuggestionsVisible(false);
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      const pasted = e.clipboardData.getData("text").trim();
      onSearchChange(pasted);
      setSuggestionsVisible(true);
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
        const value = (e.currentTarget.value ?? "").trim();
        if (value) onSearchSubmit(value);
        setSuggestionsVisible(false);
        requestAnimationFrame(() => inputRef.current?.select());
      }
      if (e.key === "Escape") {
        setSuggestionsVisible(false);
      }
    },
    [onSearchSubmit]
  );

  const showSuggestions = suggestionsVisible && suggestions.length > 0 && search.trim().length >= 2;

  return (
    <div className="space-y-3">
      {/* Search row */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            ref={inputRef}
            placeholder="Bipe o código de barras ou pesquise aqui..."
            value={search}
            onChange={(e) => { onSearchChange(e.target.value); setSuggestionsVisible(true); }}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            className="pl-10 pr-10 h-10 sm:h-11 text-sm bg-card"
            autoComplete="off"
          />
          {/* Spinner de re-busca ou botão limpar */}
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            {isSearching ? (
              <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
            ) : search ? (
              <button
                type="button"
                aria-label="Limpar busca"
                onClick={() => {
                  onSearchChange("");
                  setSuggestionsVisible(false);
                  inputRef.current?.focus();
                }}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>

          {/* Dropdown de sugestões */}
          {showSuggestions && (
            <div
              ref={suggestionsRef}
              className="absolute top-full left-0 right-0 z-50 mt-1 rounded-xl border border-border/50 bg-card/98 backdrop-blur-sm shadow-lg overflow-hidden"
            >
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()} // evita blur antes do click
                  onClick={() => {
                    onSuggestionClick?.(s);
                    setSuggestionsVisible(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left hover:bg-primary/8 transition-colors border-b border-border/20 last:border-0"
                >
                  <Search className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                  <span className="truncate text-foreground">{s}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Botão pesquisa manual */}
        <Button
          type="button"
          variant="outline"
          size="icon"
          title="Pesquisar"
          aria-label="Pesquisar"
          className="h-10 w-10 sm:h-11 sm:w-11 shrink-0"
          onClick={() => {
            if (search.trim()) { onSearchSubmit(search.trim()); setSuggestionsVisible(false); }
          }}
        >
          <Search className="h-4 w-4" />
        </Button>

        {/* Filtros avançados */}
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
                onClick={onClear}
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


const LETTERS = "#ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

interface Props {
  search: string;
  onSearchChange: (v: string) => void;
  onSearchSubmit: (v: string) => void; // disparo imediato ao bipe (Enter)
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
  const inputRef = useRef<HTMLInputElement>(null);

  const hasFilters =
    search ||
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

  // Ao focar o campo, seleciona tudo — próximo bipe substitui automaticamente
  const handleFocus = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.select());
  }, []);

  // Ao colar, remove espaços iniciais/finais e seleciona o conteúdo
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      const pasted = e.clipboardData.getData("text").trim();
      onSearchChange(pasted);
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) el.setSelectionRange(0, pasted.length);
      });
    },
    [onSearchChange]
  );

  // Enter vindo do leitor de código de barras:
  // 1. Dispara busca imediata (sem debounce)
  // 2. Seleciona todo o texto — próximo bipe sobrescreve direto
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const value = (e.currentTarget.value ?? "").trim();
        if (value) onSearchSubmit(value);
        // Seleciona tudo para o próximo bipe
        requestAnimationFrame(() => inputRef.current?.select());
      }
    },
    [onSearchSubmit]
  );

  return (
    <div className="space-y-3">
      {/* Search row */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          {/* Ícone de leitor — visual, indica que o campo aceita bipagem */}
          <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            ref={inputRef}
            placeholder="Bipe o código de barras ou pesquise aqui..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onFocus={handleFocus}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            className="pl-10 pr-10 h-10 sm:h-11 text-sm bg-card"
          />
          {/* Botão limpar campo */}
          {search && (
            <button
              type="button"
              aria-label="Limpar busca"
              onClick={() => {
                onSearchChange("");
                inputRef.current?.focus();
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Botão pesquisa manual */}
        <Button
          type="button"
          variant="outline"
          size="icon"
          title="Pesquisar"
          aria-label="Pesquisar"
          className="h-10 w-10 sm:h-11 sm:w-11 shrink-0"
          onClick={() => {
            if (search.trim()) onSearchSubmit(search.trim());
          }}
        >
          <Search className="h-4 w-4" />
        </Button>

        {/* Filtros avançados */}
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
                onClick={onClear}
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
