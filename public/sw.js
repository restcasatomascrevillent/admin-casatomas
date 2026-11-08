// Service worker mínimo del panel de gestión: hace la app instalable (PWA)
// y abre el panel aunque no haya red. Lo registra
// src/registrarServiceWorker.ts, solo en producción.
//
// Reglas:
//   - Solo GET del mismo origen. Supabase (*.supabase.co), /functions/,
//     /api/ y cualquier otro origen pasan directos a la red, sin tocarse.
//   - Navegaciones (HTML), desde el 07/11/2026 («Hoy» con poca cobertura):
//     primero la red, con un plazo de ESPERA_RED_MS. Cada navegación buena
//     guarda el index.html (y los /assets/* que pide, para que la copia nunca
//     apunte a ficheros que no estén) en la caché de ESTE build. Si la red
//     falla o tarda más del plazo, se sirve esa copia; /offline.html solo si
//     no hay copia. Un despliegue nuevo trae SW y caché nuevos, así que la
//     copia siempre es del mismo build que sus assets.
//   - Shell estático: /assets/* (con hash de Vite, inmutable), iconos,
//     manifest y la página offline: cache-first con relleno al vuelo.
//   - /modelos/* (modelo ONNX del recorte de fotos de vino) NO pasa por aquí:
//     lo guarda el propio worker en la caché «modelos-recorte-v1».
//
// Versionado: la caché lleva el id del build (`?v=` en la URL del SW). Cada
// despliegue instala un SW nuevo (skipWaiting + clients.claim) que borra las
// cachés anteriores.

const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
// «v2» (07/11/2026): la caché guarda también el index.html de las navegaciones.
const CACHE = `panel-casa-tomas-v2-${VERSION}`;
const OFFLINE_URL = "/offline.html";
// Clave de la copia del index.html (el mismo HTML sirve todas las rutas del panel).
const INDEX_CACHEADO = "/index.html";
// Lo que se espera a la red en una navegación antes de abrir con la copia.
const ESPERA_RED_MS = 4000;
const PRECACHE = [OFFLINE_URL, "/icon-192.png", "/manifest.webmanifest"];

// Avisos push «Vídeo listo» (Edge Function notificar-video). Si falta el
// fichero, el SW sigue funcionando sin avisos push.
try {
  importScripts("/sw-push.js");
} catch (_) {
  /* sin avisos push */
}

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

// El aviso de versión nueva pide activar ya el SW que esté esperando.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      // Solo las cachés del shell: «modelos-recorte-*» (modelo del recorte de
      // fotos de vino, ~47 MB) sobrevive a los despliegues.
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith("panel-casa-tomas-") && k !== CACHE).map((k) => caches.delete(k))),
      )
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

/** Respuesta sin nada guardado: /offline.html o, si tampoco está, una mínima. */
function paginaSinConexion() {
  return caches.match(OFFLINE_URL).then(
    (cached) =>
      cached ??
      new Response('<!doctype html><html lang="es"><meta charset="utf-8"><title>Sin conexión</title><h1>Sin conexión</h1>', {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
  );
}

/** ¿Es el index.html del panel? (no otra página .html, como la de captura de reels). */
function esIndexDelPanel(url, res) {
  const tipo = res.headers.get("Content-Type") || "";
  const ruta = url.pathname;
  // `basic`: mismo origen (`default` solo en respuestas construidas, como las de las pruebas).
  return res.ok && (res.type === "basic" || res.type === "default") && tipo.includes("text/html") && (!ruta.endsWith(".html") || ruta === "/index.html");
}

/** Guarda el index.html y los /assets/* que pide (los que falten). Nunca falla. */
function guardarIndex(res) {
  return caches
    .open(CACHE)
    .then(async (cache) => {
      const html = await res.clone().text();
      await cache.put(INDEX_CACHEADO, res);
      const assets = [...new Set(html.match(/\/assets\/[^"'\s)>]+/g) || [])];
      await Promise.all(assets.map((a) => cache.match(a).then((hit) => hit || cache.add(a).catch(() => {}))));
    })
    .catch(() => {});
}

/** Navegación: red con plazo; si falla o tarda, la copia del index; sin copia, /offline.html. */
function navegar(event, url) {
  const red = fetch(event.request);
  // La copia se guarda aparte (`waitUntil`, enganchado ANTES que la respuesta: el clon va antes de
  // que la página lea el cuerpo).
  event.waitUntil(
    red.then((res) => (esIndexDelPanel(url, res) ? guardarIndex(res.clone()) : undefined)).catch(() => {}),
  );
  let plazo;
  const caducado = new Promise((resolve) => {
    plazo = setTimeout(() => resolve(null), ESPERA_RED_MS);
  });
  return Promise.race([red.catch(() => null), caducado]).then(async (res) => {
    clearTimeout(plazo);
    if (res) return res;
    const copia = await caches.open(CACHE).then((c) => c.match(INDEX_CACHEADO)).catch(() => undefined);
    if (copia) return copia;
    // Sin copia: se sigue esperando a la red; si al final falla, la página offline.
    return red.catch(() => paginaSinConexion());
  });
}

// Notificación de «Vídeo listo» (cola de vídeos del plato, sin push): al
// tocarla se enfoca el panel y se le pide que navegue al plato (mensaje, para
// no recargar y perder otros vídeos en cola); si no hay ventana, se abre una.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const ruta = (event.notification.data && event.notification.data.url) || "/";
  const destino = new URL(ruta, self.location.origin);
  if (destino.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (ventanas) => {
      const panel = ventanas.find((v) => new URL(v.url).origin === self.location.origin);
      if (panel) {
        await panel.focus().catch(() => {});
        panel.postMessage({ tipo: "abrir-url", url: destino.pathname + destino.search });
        return;
      }
      await self.clients.openWindow(destino.href);
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Otros orígenes (Supabase, fuentes, etc.): no se tocan.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/functions/") || url.pathname.startsWith("/api/")) return;
  // /version.json siempre a red: es como el panel detecta versión nueva.
  if (url.pathname === "/version.json") return;

  if (req.mode === "navigate") {
    event.respondWith(navegar(event, url));
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
