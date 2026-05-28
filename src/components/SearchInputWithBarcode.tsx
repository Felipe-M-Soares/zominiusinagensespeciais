/**
 * SearchInputWithBarcode — campo de busca com botão de câmera/scanner.
 * Drop-in para qualquer barra de busca do sistema.
 *
 * Props:
 *  value       — valor controlado externamente (opcional)
 *  onChange    — chamado a cada keystroke
 *  onSearch    — chamado ao pressionar Enter ou ao detectar código de barras
 *  placeholder — texto do placeholder (padrão: "Bipe o código ou pesquise aqui...")
 *  className   — classes extras no wrapper
 *  inputClass  — classes extras no input
 *  height      — altura do input (padrão: "h-9")
 *  autoFocus   — foca automaticamente
 *  debounceMs  — delay debounce em ms (padrão: 300)
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { ScanBarcode, X, Search } from "lucide-react";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { cn } from "@/lib/utils";

interface Props {
  value?: string;
  onChange?: (v: string) => void;
  onSearch?: (v: string) => void;
  placeholder?: string;
  className?: string;
  inputClass?: string;
  height?: string;
  autoFocus?: boolean;
  debounceMs?: number;
  showSearchIcon?: boolean;
}

export function SearchInputWithBarcode({
  value,
  onChange,
  onSearch,
  placeholder = "Bipe o código de barras ou pesquise aqui...",
  className,
  inputClass,
  height = "h-9",
  autoFocus = false,
  debounceMs = 300,
  showSearchIcon = false,
}: Props) {
  const [scannerOpen, setScannerOpen] = useState(false);
  const [localValue, setLocalValue] = useState(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync external value → local
  useEffect(() => {
    if (value !== undefined) setLocalValue(value);
  }, [value]);

  const emit = useCallback((v: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onChange?.(v);
    }, debounceMs);
  }, [onChange, debounceMs]);

  function handleChange(v: string) {
    setLocalValue(v);
    emit(v);
    if (!v.trim()) onSearch?.("");
  }

  function handleClear() {
    setLocalValue("");
    onChange?.("");
    onSearch?.("");
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      onSearch?.(localValue.trim());
    }
    if (e.key === "Escape") handleClear();
  }

  function handleDetected(code: string) {
    setLocalValue(code);
    onChange?.(code);
    onSearch?.(code);
    // Auto-focus input after scan so user sees result
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  const hasValue = localValue.trim().length > 0;

  return (
    <>
      <div className={cn("relative flex items-center", className)}>
        {/* Left icon: search or barcode */}
        {showSearchIcon ? (
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        ) : (
          <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        )}

        <input
          ref={inputRef}
          type="text"
          value={localValue}
          onChange={e => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className={cn(
            "w-full rounded-xl border border-border bg-background text-sm",
            "pl-9 pr-16",
            "placeholder:text-muted-foreground/60",
            "focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/40",
            "transition-all",
            height,
            inputClass,
          )}
        />

        {/* Right side: clear + camera button */}
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {hasValue && (
            <button
              type="button"
              onClick={handleClear}
              aria-label="Limpar busca"
              className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            aria-label="Escanear código de barras"
            title="Abrir câmera para escanear código de barras"
            className={cn(
              "h-7 w-7 flex items-center justify-center rounded-lg transition-all",
              "text-violet-600 hover:bg-violet-500/10 border border-violet-500/20",
              "active:scale-95",
            )}
          >
            <ScanBarcode className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <BarcodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={handleDetected}
      />
    </>
  );
}
