import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// FIX: O operador ! suprime o erro de TypeScript mas causa crash silencioso em produção
// se o elemento root não for encontrado. Verificamos explicitamente antes de montar.
const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error(
    '[App] Elemento #root não encontrado no DOM. Verifique o index.html.'
  );
}

createRoot(rootElement).render(<App />);
