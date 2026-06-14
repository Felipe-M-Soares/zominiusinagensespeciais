/**
 * sw.js — Service Worker de desenvolvimento
 *
 * ATENÇÃO: Este arquivo é servido em DESENVOLVIMENTO (npm run dev).
 * Em PRODUÇÃO (npm run build), o Workbox gera um sw.js completo automaticamente
 * via vite-plugin-pwa, sobrescrevendo este arquivo no build.
 *
 * Não adicione lógica de cache permanente aqui — use workbox.runtimeCaching no
 * vite.config.ts para configurar cache de produção.
 *
 * A versão de cache usa um timestamp de build para garantir atualização automática.
 * Em dev, usamos a data atual para evitar cache obsoleto durante o desenvolvimento.
 */

const CACHE_VERSION = "zomini-dev-" + new Date().toISOString().slice(0, 10);
const PRECACHE = ["/", "/index.html"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_VERSION && k.startsWith("zomini-"))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);

  // Nunca cacheia chamadas Supabase/API — dados autenticados nunca devem ir para cache SW
  if (url.hostname.includes("supabase") || url.pathname.startsWith("/api")) return;

  // Em desenvolvimento, prioriza rede (evita cache obsoleto de assets em HMR)
  // O Workbox em produção tem estratégia mais sofisticada (stale-while-revalidate)
  e.respondWith(
    fetch(e.request).catch(() =>
      caches.match(e.request)
    )
  );
});
