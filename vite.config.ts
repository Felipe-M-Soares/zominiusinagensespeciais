import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => ({
  root: ".",
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          // Supabase SDK — carregado em todas as páginas autenticadas
          if (id.includes("node_modules/@supabase")) return "supabase";

          // React core + router — crítico, mas pequeno
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/react-router-dom/") ||
            id.includes("node_modules/scheduler/")
          ) return "vendor";

          // Radix UI + Shadcn — UI components grandes
          if (id.includes("node_modules/@radix-ui")) return "ui";

          // Recharts — só usado no DashboardPanel de Produção
          if (id.includes("node_modules/recharts") ||
              id.includes("node_modules/d3-") ||
              id.includes("node_modules/victory-vendor")) return "charts";

          // Tanstack Query — usado em todas as páginas
          if (id.includes("node_modules/@tanstack")) return "query";

          // ExcelJS é lazy (dynamic import) — ficará em chunk separado automático
          // Não precisa de entrada aqui; o Vite cria chunk on-demand.
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // injectRegister: 'script' evita o uso de blob: URLs para registrar o SW
      // o padrão 'auto' gera um inline script com blob: que é bloqueado pelo CSP
      injectRegister: "script",
      includeAssets: [
        "favicon.ico",
        "favicon.png",
        "favicon-16x16.png",
        "favicon-32x32.png",
        "apple-touch-icon.png",
        "android-chrome-192x192.png",
        "android-chrome-512x512.png",
      ],
      manifest: {
        name: "Concept Usinagens Especiais",
        short_name: "Concept",
        description: "Base de dados de dispositivos médicos - Conformidade ANVISA",
        theme_color: "#0a0a0a",
        background_color: "#0a0a0a",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/~oauth/, /^\/api\//],
        // SECURITY: API do Supabase usa autenticação por sessão — cachear respostas
        // no service worker vazaria dados entre usuários em dispositivos compartilhados.
        // O React Query já faz cache em memória com escopo de sessão (staleTime 5min).
        runtimeCaching: [],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
