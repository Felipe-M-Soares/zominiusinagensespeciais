/**
 * SearchInputWithBarcode — campo de busca com ícone de leitor de código de barras.
 * Drop-in para qualquer barra de busca do sistema.
 * Funciona com bipe/teclado; câmera foi removida de todas as telas.
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
import { cn } from "@/lib/utils";

/**
 * Leitores de código de barras configurados pra ler GS1-128/DataMatrix
 * costumam devolver o código já com o AI (Application Identifier) GS1 na
 * frente — ex: "(01)07891234567895" ou, dependendo do leitor/etiqueta,
 * mais Application Identifiers colados em seguida (validade, lote, série):
 * "(01)07891234567895(17)251231(10)LOTE123".
 *
 * O AI "01" = GTIN e tem tamanho FIXO de 14 dígitos, então dá pra extrair
 * exatamente o GTIN e ignorar o resto (validade/lote/série não interessam
 * pra busca por referência/GTIN). Cobre tanto a forma com parênteses quanto
 * a forma "crua" que alguns leitores mandam sem parênteses (só "01" + 14
 * dígitos, ancorado no início/fim da string pra não cortar por engano um
 * código que só começa com "01" por coincidência).
 */
export function extractGs1Gtin(raw: string): string {
  const trimmed = raw.trim();
  const comParenteses = trimmed.match(/^\(01\)(\d{14})/);
  if (comParenteses) return comParenteses[1];
  const semParenteses = trimmed.match(/^01(\d{14})$/);
  if (semParenteses) return semParenteses[1];
  return trimmed;
}

interface Props {
  value?: string;
  onChange?: (v: string) => void;
  onSearch?: (v: string) => void;
  onFocus?: () => void;
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
  onFocus,
  placeholder = "Bipe o código de barras ou pesquise aqui...",
  className,
  inputClass,
  height = "h-9",
  autoFocus = false,
  debounceMs = 300,
  showSearchIcon = false,
}: Props) {
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
    const limpo = extractGs1Gtin(v);
    setLocalValue(limpo);
    emit(limpo);
    if (!limpo.trim()) onSearch?.("");
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
      onSearch?.(extractGs1Gtin(localValue));
    }
    if (e.key === "Escape") handleClear();
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
          onFocus={onFocus}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className={cn(
            "w-full rounded-xl border border-border bg-background text-sm",
            "pl-9 pr-10",
            "placeholder:text-muted-foreground/60",
            "focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/40",
            "transition-all",
            height,
            inputClass,
          )}
        />

        {/* Right side: clear button */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
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
        </div>
      </div>
    </>
  );
}
