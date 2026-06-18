import { useRef, useCallback } from "react";

/**
 * Retorna uma versão debounced da função `fn`.
 * PERF FIX: usa useRef para guardar fn — evita recriar o callback a cada render
 * (o problema anterior: fn como dep do useCallback causava loop infinito porque
 * arrow functions inline têm referência nova a cada render).
 */
export function useDebounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  delayMs: number
): (...args: Parameters<T>) => void {
  const fnRef = useRef<T>(fn);
  fnRef.current = fn; // sempre atualizado, sem ser dep do useCallback

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  return useCallback(
    (...args: Parameters<T>) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => fnRef.current(...args), delayMs);
    },
    [delayMs] // delayMs é estável (número literal) — callback nunca recriado
  );
}
