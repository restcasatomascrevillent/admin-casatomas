/**
 * Notificaciones del sistema para la cola de vídeos (sin servidor push):
 * `registration.showNotification` del service worker del panel (public/sw.js,
 * que al tocarla abre/enfoca el panel en el plato) y, si no hay SW (dev),
 * `new Notification`. El permiso se pide al empezar el primer vídeo, nunca
 * antes. Sin permiso: nada (el provider ya enseña un toast siempre).
 */

export function notificacionesSoportadas(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** Pide permiso solo si aún no se ha decidido. Llamar desde un gesto del usuario. */
export function pedirPermisoNotificaciones(): void {
  if (!notificacionesSoportadas() || Notification.permission !== "default") return;
  try {
    void Promise.resolve(Notification.requestPermission()).catch(() => undefined);
  } catch {
    /* Safari antiguo: requestPermission con callback; se ignora */
  }
}

/** Primer fotograma → JPEG pequeño en data: URL (icono/imagen de la notificación). */
export async function posterParaNotificacion(poster: Blob | undefined, ancho = 480): Promise<string | undefined> {
  if (!poster || typeof createImageBitmap !== "function") return undefined;
  try {
    const bmp = await createImageBitmap(poster);
    const escala = Math.min(1, ancho / bmp.width);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * escala));
    c.height = Math.max(1, Math.round(bmp.height * escala));
    c.getContext("2d")?.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    const url = c.toDataURL("image/jpeg", 0.75);
    c.width = c.height = 0;
    return url;
  } catch {
    return undefined;
  }
}

export interface DatosNotificacion {
  titulo: string;
  cuerpo: string;
  /** Ruta del panel que se abre al tocarla. */
  url: string;
  imagen?: string;
  tag?: string;
}

/** true si se ha mostrado. `alTocarSinSw` solo se usa con `new Notification` (sin service worker). */
export async function mostrarNotificacion(d: DatosNotificacion, alTocarSinSw?: (url: string) => void): Promise<boolean> {
  if (!notificacionesSoportadas() || Notification.permission !== "granted") return false;
  const opciones = {
    body: d.cuerpo,
    icon: d.imagen ?? "/icon-192.png",
    badge: "/icon-192.png",
    image: d.imagen,
    tag: d.tag,
    data: { url: d.url },
  } as NotificationOptions;
  try {
    const registro = await navigator.serviceWorker?.getRegistration();
    if (registro) {
      await registro.showNotification(d.titulo, opciones);
      return true;
    }
  } catch {
    /* sin SW: notificación directa */
  }
  try {
    const n = new Notification(d.titulo, opciones);
    n.onclick = () => {
      window.focus();
      alTocarSinSw?.(d.url);
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}
