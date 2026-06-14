/**
 * Utilitários de tema — extraídos de pages/Settings.tsx para evitar que
 * imports estáticos de getStoredTheme/applyTheme forcem o carregamento do
 * bundle completo da página Settings (que é lazy) em todas as outras páginas.
 */

export type Theme = "light" | "dark" | "system";

export const VALID_THEMES = new Set<Theme>(["light", "dark", "system"]);

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const stored = localStorage.getItem("theme");
    if (stored && VALID_THEMES.has(stored as Theme)) {
      return stored as Theme;
    }
  } catch {
    // localStorage indisponível (modo privado Firefox, WebView restrito, etc.)
  }
  return "light";
}

export function applyTheme(theme: Theme) {
  if (typeof window === "undefined") return;
  const root = document.documentElement;
  if (theme === "system") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.classList.toggle("dark", prefersDark);
  } else {
    root.classList.toggle("dark", theme === "dark");
  }
  try {
    localStorage.setItem("theme", theme);
  } catch {
    // localStorage indisponível — preferência não salva, não é crítico
  }
}
