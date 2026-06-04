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
    // Inline assets < 4KB como base64 (evita request extra para ícones pequenos)
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 800,
    // Minificação agressiva com esbuild (padrão do Vite)
    minify: "esbuild",
    // Remove console.* em produção automaticamente
    esbuildOptions: {
      drop: ["console", "debugger"],
      pure: ["console.log", "console.debug", "console.info"],
    },
    // CSS code splitting para carregar só o CSS necessário
    cssCodeSplit: true,
    // Melhor target para browsers modernos
    target: "es2020",
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          // pdfjs — biblioteca enorme (~3MB), só usada no ExcelStockImport (lazy)
          if (id.includes("pdfjs-dist")) return "pdfjs";

          // ExcelJS — pesado, só usado em ExcelStockImport e BackupPanel (lazy)
          if (id.includes("exceljs") || id.includes("node_modules/exceljs")) return "exceljs";

          // Recharts + D3 — só usados em DashboardPanel de Produção (lazy)
          if (id.includes("node_modules/recharts") ||
              id.includes("node_modules/d3-") ||
              id.includes("node_modules/victory-vendor")) return "charts";

          // Supabase SDK — carregado em todas as páginas autenticadas
          if (id.includes("node_modules/@supabase")) return "supabase";

          // Tanstack Query — usado em todas as páginas
          if (id.includes("node_modules/@tanstack")) return "query";

          // Radix UI + Shadcn — UI components
          if (id.includes("node_modules/@radix-ui")) return "ui";

          // React core + router
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/react-router-dom/") ||
            id.includes("node_modules/scheduler/")
          ) return "vendor";
        },
      },
    },
  },
  optimizeDeps: {
    // Pré-bundling no dev server — evita cascata de requests no primeiro load
    include: [
      "@supabase/supabase-js",
      "@tanstack/react-query",
      "react",
      "react-dom",
      "react-router-dom",
      "lucide-react",
      "sonner",
      "clsx",
      "tailwind-merge",
    ],
    // pdfjs tem worker próprio — excluir do pré-bundling evita erros de worker
    exclude: ["pdfjs-dist"],
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
