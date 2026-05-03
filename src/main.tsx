import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { getStoredTheme, applyTheme } from "./pages/Settings.tsx";

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
