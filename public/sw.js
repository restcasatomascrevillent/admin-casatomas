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
//   - /modelos/* (modelo ONNX del recorte de fotos de vino) NO pasa por aquí:
//     lo guarda el propio worker en la caché «modelos-recorte-v1».
//
// Versionado: la caché lleva el id del build (`?v=` en la URL del SW). Cada
// despliegue instala un SW nuevo (skipWaiting + clients.claim) que borra las
// cachés anteriores.

const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE = `panel-casa-tomas-${VERSION}`;
const OFFLINE_URL = "/offline.html";
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
