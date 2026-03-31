import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";

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
