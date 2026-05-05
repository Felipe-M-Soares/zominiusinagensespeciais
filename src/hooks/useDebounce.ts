import { useRef, useCallback } from "react";

/**
 * Retorna uma versão debounced da função `fn`.
 * Substitui o padrão inline de debounceRef + clearTimeout + setTimeout
 * que estava duplicado em SearchFilters, AdminDevices e NovoPedidoModal.
 */
export function useDebounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  delayMs: number
): (...args: Parameters<T>) => void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  return useCallback(
    (...args: Parameters<T>) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => fn(...args), delayMs);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fn, delayMs]
  );
}
