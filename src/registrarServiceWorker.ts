/**
 * Registro del service worker (public/sw.js) para que el panel sea instalable
 * como app (PWA) desde Chrome.
 *
 * Solo en producción: en `npm run dev` un SW interferiría con el HMR de Vite.
 * La versión del build va en la URL del SW (`?v=`): al cambiar en cada
 * despliegue, el navegador instala el SW nuevo, que tira la caché anterior.
 */
export function registrarServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`/sw.js?v=${encodeURIComponent(__BUILD_ID__)}`, { scope: "/" })
      .then((registro) => {
        // La tablet puede pasar días con la app abierta: al volver a primer
        // plano se comprueba si hay versión nueva.
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") registro.update().catch(() => {});
        });
      })
      .catch(() => {
        // Sin SW el panel funciona igual; solo deja de ser instalable.
      });
  });
}
