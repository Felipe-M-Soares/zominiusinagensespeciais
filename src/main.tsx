import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { getStoredTheme, applyTheme } from "./lib/theme";
import { initSentryEarly } from "./lib/logger";

// Inicializa o Sentry o quanto antes — registra os listeners globais de
// erro (window.onerror, unhandledrejection) desde o início do app, em vez
// de só depois do primeiro erro acontecer. Sem efeito se VITE_SENTRY_DSN
// não estiver configurado (não bloqueia nem atrasa o carregamento).
initSentryEarly();

// Aplica o tema salvo imediatamente ao montar o React (evita flash de tema errado)
applyTheme(getStoredTheme());

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error(
    '[App] Elemento #root não encontrado no DOM. Verifique o index.html.'
  );
}

createRoot(rootElement).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
