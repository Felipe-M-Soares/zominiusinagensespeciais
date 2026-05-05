import { useEffect, type RefObject } from "react";

/**
 * Fecha um dropdown/popover quando o clique ocorre fora do elemento referenciado.
 * Substitui o padrão inline duplicado 6× no projeto:
 *   document.addEventListener("mousedown", h) + removeEventListener no cleanup.
 *
 * Também cobre touchstart para melhor suporte mobile.
 */
export function useClickOutside<T extends HTMLElement>(
  ref: RefObject<T>,
  onClickOutside: () => void
): void {
  useEffect(() => {
    const handler = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClickOutside();
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [ref, onClickOutside]);
}
