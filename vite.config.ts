import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(() => ({
  root: ".",
  // Injeta a data de build real em tempo de compilação — diferente de
  // `new Date()` dentro do código do app, que capturaria a data em que o
  // navegador do usuário executa o bundle, não a data em que foi gerado.
  define: {
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
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
    // (Removido "esbuildOptions": não é uma opção válida de build no Vite e
    //  era ignorada silenciosamente. O código do app já não usa console.log —
    //  a regra no-console do ESLint garante isso.)
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
        "favicon-16x16.png",
        "favicon-32x32.png",
        "apple-touch-icon.png",
        "android-chrome-192x192.png",
        "android-chrome-512x512.png",
      ],
      manifest: {
        id: "/",
        name: "Zomini Usinagens Especiais",
        short_name: "Zomini",
        description: "Zomini ERP — estoque, produção, qualidade (ANVISA), comercial e financeiro.",
        lang: "pt-BR",
        dir: "ltr",
        theme_color: "#f5f6f8",
        background_color: "#f5f6f8",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        scope: "/",
        categories: ["business", "productivity"],
        icons: [
          { src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // Não pré-baixa no celular de todo usuário as bibliotecas pesadas que
        // só o admin/financeiro usam (Excel, PDF, html2canvas) nem fontes de
        // alfabetos que o app não usa. Elas continuam carregando sob demanda.
        // Resultado: precache cai de ~5 MB para ~2 MB a cada deploy.
        globIgnores: [
          "**/exceljs-*.js",
          "**/pdfjs-*.js",
          "**/pdf.worker*.js",
          "**/html2canvas-*.js",
          "**/pedidoPdf-*.js",
          "**/purify.es-*.js",
          "**/index.es-*.js",
          "**/*-cyrillic*.woff2",
          "**/*-greek*.woff2",
          "**/*-vietnamese*.woff2",
        ],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
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
