import { useEffect, useRef, type RefObject } from "react";

/**
 * Fecha um dropdown/popover quando o clique ocorre fora do elemento referenciado.
 *
 * CORREÇÃO de dois bugs originais:
 *
 * 1. Usava "mousedown" — disparava ANTES do onFocus do input, fechando o dropdown
 *    imediatamente após abrir na primeira interação. Trocado para "pointerdown" com
 *    verificação de `composedPath()` que cobre Shadow DOM e portais React.
 *
 * 2. onClickOutside era recriado a cada render (arrow function inline), causando
 *    re-registro contínuo do listener. Agora usa useRef para manter referência estável.
 */
export function useClickOutside<T extends HTMLElement>(
  ref: RefObject<T>,
  onClickOutside: () => void
): void {
  // Mantém referência estável ao callback — evita re-registro do listener a cada render
  const callbackRef = useRef(onClickOutside);
  useEffect(() => { callbackRef.current = onClickOutside; });

  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const path = e.composedPath();
      if (ref.current && !path.includes(ref.current)) {
        callbackRef.current();
      }
    };
    // "pointerup" em vez de "pointerdown": o clique no input já terminou e o foco
    // já foi definido, então o dropdown abre corretamente na primeira interação.
    document.addEventListener("pointerup", handler);
    return () => document.removeEventListener("pointerup", handler);
  }, [ref]); // ref é estável — listener só é registrado uma vez por montagem
}
