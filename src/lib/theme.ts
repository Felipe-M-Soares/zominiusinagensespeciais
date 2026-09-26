/**
 * Tema (claro/escuro/sistema) — fonte única de verdade.
 *
 * - `getStoredTheme()` / `applyTheme()` mantêm a API antiga.
 * - `useTheme()` expõe o tema resolvido para componentes (ex: Toaster, que
 *   antes lia de `next-themes` sem ThemeProvider e ficava sempre em "system").
 * - Em "system", acompanha a troca de tema do sistema operacional ao vivo.
 *
 * O padrão (sem nada salvo) é "light" — o mesmo usado pelo script inline do
 * index.html, para não haver "flash" de tema errado ao abrir o app.
 */
import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const VALID_THEMES = new Set<Theme>(["light", "dark", "system"]);
const STORAGE_KEY = "theme";
const DEFAULT_THEME: Theme = "light";

const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }

function safeGet(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function safeSet(v: string) {
  try { localStorage.setItem(STORAGE_KEY, v); } catch { /* modo privado */ }
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  const stored = safeGet();
  return stored && VALID_THEMES.has(stored as Theme) ? (stored as Theme) : DEFAULT_THEME;
}

export function resolveTheme(theme: Theme = getStoredTheme()): ResolvedTheme {
  if (theme === "system") return systemPrefersDark() ? "dark" : "light";
  return theme;
}

export function applyTheme(theme: Theme) {
  if (typeof window === "undefined") return;
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  // Atualiza a cor da barra do navegador/PWA junto com o tema.
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", resolved === "dark" ? "#0f1115" : "#f5f6f8");
  safeSet(theme);
  emit();
}

// Em modo "system", segue o SO em tempo real.
if (typeof window !== "undefined" && window.matchMedia) {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    if (getStoredTheme() === "system") applyTheme("system");
  });
  // Sincroniza entre abas abertas.
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) applyTheme(getStoredTheme());
  });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Hook reativo: devolve o tema escolhido e o efetivamente aplicado. */
export function useTheme(): { theme: Theme; resolvedTheme: ResolvedTheme; setTheme: (t: Theme) => void } {
  const theme = useSyncExternalStore(subscribe, getStoredTheme, () => DEFAULT_THEME);
  const resolvedTheme = useSyncExternalStore(subscribe, () => resolveTheme(), () => "light" as ResolvedTheme);
  return { theme, resolvedTheme, setTheme: applyTheme };
}
