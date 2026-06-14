/**
 * useKeyboardShortcuts — Atalhos de teclado globais
 *
 * Atalhos implementados:
 *  Ctrl+K / Cmd+K → foca na busca principal
 *  Escape          → fecha modais / limpa busca (via evento customizado)
 *  Ctrl+/          → abre painel de ajuda de atalhos
 *
 * Uso: chamar no AppShell para registrar globalmente.
 * Componentes individuais podem escutar "zomini:focus-search" para
 * integrar com o evento de busca.
 */
import { useEffect } from "react";

export function useKeyboardShortcuts() {
  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      const isCtrl = e.ctrlKey || e.metaKey;
      // Ignorar quando foco está em input/textarea/select
      const tag = (e.target as HTMLElement).tagName;
      const isInInput = ["INPUT", "TEXTAREA", "SELECT"].includes(tag);

      // Ctrl+K → focar busca
      if (isCtrl && e.key === "k") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("zomini:focus-search"));
        return;
      }

      // Escape → fechar modais / limpar busca (não interfere em inputs)
      if (e.key === "Escape" && !isInInput) {
        window.dispatchEvent(new CustomEvent("zomini:escape"));
        return;
      }

      // Ctrl+/ → mostrar atalhos
      if (isCtrl && e.key === "/") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("zomini:show-shortcuts"));
        return;
      }
    }

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, []);
}

/** Hook para escutar o evento de foco na busca */
export function useSearchFocusListener(onFocus: () => void) {
  useEffect(() => {
    window.addEventListener("zomini:focus-search", onFocus);
    return () => window.removeEventListener("zomini:focus-search", onFocus);
  }, [onFocus]);
}
