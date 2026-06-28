/**
 * Utilitários de tema — extraídos para um módulo próprio para evitar que
 * imports estáticos de getStoredTheme/applyTheme forcem o carregamento de
 * código adicional em todas as páginas que só precisam alternar tema
 * (ex: AppShell.tsx, usado em toda a aplicação).
 */

export type Theme = "light" | "dark" | "system";

export const VALID_THEMES = new Set<Theme>(["light", "dark", "system"]);

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem("theme");
  if (stored && VALID_THEMES.has(stored as Theme)) {
    return stored as Theme;
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
  localStorage.setItem("theme", theme);
}
