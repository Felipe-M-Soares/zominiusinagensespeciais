import { useEffect } from "react";

/**
 * Permite confirmar um modal apertando Enter, além do clique no mouse —
 * mesmo handler, só mais um jeito de disparar.
 *
 * - Só fica ativo enquanto `open` for true (não captura Enter da página por
 *   trás do modal).
 * - Ignora Enter dentro de <textarea> — não interrompe quebra de linha em
 *   campos de observação/comentário.
 * - Respeita `disabled` (ex: modal "digite EXCLUIR para confirmar" com o
 *   texto ainda errado, ou uma ação já em andamento) — mesma trava que o
 *   botão físico já tem, Enter não pula essa validação.
 *
 * Uso:
 *   useConfirmEnter(confirmOpen, handleConfirmar, digitado !== "EXCLUIR");
 */
export function useConfirmEnter(open: boolean, onConfirm: () => void, disabled = false) {
  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      if (e.key !== "Enter") return;
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "TEXTAREA") return;
      if (disabled) return;
      e.preventDefault();
      onConfirm();
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onConfirm, disabled]);
}
