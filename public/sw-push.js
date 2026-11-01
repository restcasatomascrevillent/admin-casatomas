// Avisos push del panel («Vídeo listo: <plato>»). Lo carga public/sw.js con
// importScripts("/sw-push.js"). Va en un fichero aparte para poder probarlo
// (src/components/carta/potente/__tests__/swPush.test.ts) sin el resto del SW.
//
// Carga que manda la Edge Function notificar-video (JSON):
//   { titulo, cuerpo, imagen?, url, tag, trabajo_id, plato_id, estado }
// El clic lo atiende el «notificationclick» de public/sw.js (el mismo de las
// notificaciones locales de la cola de vídeos): lee `data.url`, enfoca el
// panel y le pide que abra el plato, o abre una ventana nueva.

/* global self */

function cargaPush(event) {
  let datos = {};
  try {
    datos = event.data ? event.data.json() : {};
  } catch (_) {
    try {
      datos = { cuerpo: event.data ? event.data.text() : "" };
    } catch (__) {
      datos = {};
    }
  }
  return datos || {};
}

// Solo rutas del propio panel (nada de abrir orígenes ajenos desde una carga).
function urlSegura(url) {
  try {
    const u = new URL(url || "/", self.location.origin);
    return u.origin === self.location.origin ? u.href : self.location.origin + "/";
  } catch (_) {
    return self.location.origin + "/";
  }
}

self.addEventListener("push", (event) => {
  const d = cargaPush(event);
  const titulo = d.titulo || "Panel Casa Tomás";
  const opciones = {
    body: d.cuerpo || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: d.tag || "panel",
    renotify: true,
    data: { url: urlSegura(d.url), trabajo_id: d.trabajo_id || null, plato_id: d.plato_id || null },
  };
  if (d.imagen) opciones.image = d.imagen;
  event.waitUntil(self.registration.showNotification(titulo, opciones));
});
