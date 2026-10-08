// Service worker mínimo del panel de gestión: hace la app instalable (PWA)
// y sirve una página offline si no hay red. Lo registra
// src/registrarServiceWorker.ts, solo en producción.
//
// Reglas:
//   - Solo GET del mismo origen. Supabase (*.supabase.co), /functions/,
//     /api/ y cualquier otro origen pasan directos a la red, sin tocarse.
//   - Navegaciones (HTML): solo red; si falla, /offline.html. El HTML no se
//     guarda, así un despliegue nuevo se ve en la siguiente carga.
//   - Shell estático: /assets/* (con hash de Vite, inmutable), iconos,
//     manifest y la página offline: cache-first con relleno al vuelo.
//
// Versionado: la caché lleva el id del build (`?v=` en la URL del SW). Cada
// despliegue instala un SW nuevo (skipWaiting + clients.claim) que borra las
// cachés anteriores.

const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE = `panel-casa-tomas-${VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icon-192.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        PRECACHE.map((asset) =>
          cache.add(asset).catch(() => {
            if (asset === OFFLINE_URL) throw new Error("offline page missing");
          }),
        ),
      ),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isNoStore(res) {
  const cc = res.headers.get("Cache-Control");
  return typeof cc === "string" && cc.toLowerCase().includes("no-store");
}

function isCacheableAsset(url) {
  return (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icon-") ||
    url.pathname === "/apple-touch-icon.png" ||
    url.pathname === "/favicon.ico" ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === OFFLINE_URL
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Otros orígenes (Supabase, fuentes, etc.): no se tocan.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/functions/") || url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(OFFLINE_URL).then(
          (cached) =>
            cached ??
            new Response(
              '<!doctype html><html lang="es"><meta charset="utf-8"><title>Sin conexión</title><h1>Sin conexión</h1>',
              { headers: { "Content-Type": "text/html; charset=utf-8" } },
            ),
        ),
      ),
    );
    return;
  }

  if (isCacheableAsset(url)) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ??
          fetch(req).then((res) => {
            if (res.ok && res.type === "basic" && !isNoStore(res)) {
              const copy = res.clone();
              caches
                .open(CACHE)
                .then((c) => c.put(req, copy))
                .catch(() => {});
            }
            return res;
          }),
      ),
    );
  }
});
