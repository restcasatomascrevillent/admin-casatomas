// Sonido corto (Web Audio, sin fichero) y notificación del sistema (Notification API).
// Los navegadores bloquean el audio hasta la primera interacción: el AudioContext se
// crea/reanuda con el primer toque o tecla y, si sigue bloqueado, simplemente no suena.

type ConstructorAudio = typeof AudioContext;

let contexto: AudioContext | null = null;

function constructorAudio(): ConstructorAudio | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: ConstructorAudio; webkitAudioContext?: ConstructorAudio };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function obtenerContexto(): AudioContext | null {
  if (contexto) return contexto;
  const Ctor = constructorAudio();
  if (!Ctor) return null;
  try {
    contexto = new Ctor();
  } catch {
    contexto = null;
  }
  return contexto;
}

/** Desbloquea el audio con la primera interacción. Devuelve la función que quita los oyentes. */
export function prepararDesbloqueoAudio(): () => void {
  if (typeof window === "undefined") return () => {};
  const quitar = () => {
    window.removeEventListener("pointerdown", desbloquear);
    window.removeEventListener("keydown", desbloquear);
  };
  function desbloquear() {
    const ctx = obtenerContexto();
    if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {});
    quitar();
  }
  window.addEventListener("pointerdown", desbloquear);
  window.addEventListener("keydown", desbloquear);
  return quitar;
}

/** «Ding-dong» corto. Devuelve si ha sonado (false si está silenciado o el navegador lo bloquea). */
export function sonarAviso(activo: boolean): boolean {
  if (!activo) return false;
  const ctx = obtenerContexto();
  if (!ctx) return false;
  if (ctx.state !== "running") {
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    return false;
  }
  try {
    const ahora = ctx.currentTime;
    [880, 660].forEach((frecuencia, i) => {
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = frecuencia;
      const inicio = ahora + i * 0.18;
      vol.gain.setValueAtTime(0.0001, inicio);
      vol.gain.exponentialRampToValueAtTime(0.25, inicio + 0.02);
      vol.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.3);
      osc.connect(vol);
      vol.connect(ctx.destination);
      osc.start(inicio);
      osc.stop(inicio + 0.32);
    });
    return true;
  } catch {
    return false;
  }
}

export type EstadoPermisoSistema = "no-disponible" | NotificationPermission;

export function permisoNotificaciones(): EstadoPermisoSistema {
  if (typeof window === "undefined" || !("Notification" in window)) return "no-disponible";
  return Notification.permission;
}

/** Solo desde el clic del botón «Activar avisos en este ordenador». */
export async function pedirPermisoNotificaciones(): Promise<EstadoPermisoSistema> {
  if (permisoNotificaciones() === "no-disponible") return "no-disponible";
  try {
    return await Notification.requestPermission();
  } catch {
    return permisoNotificaciones();
  }
}

/** Notificación del sistema: solo con permiso y si la pestaña no está a la vista. */
export function notificarSistema(titulo: string, texto: string, alTocar: () => void): void {
  if (permisoNotificaciones() !== "granted") return;
  if (typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus()) return;
  try {
    const n = new Notification(titulo, { body: texto, tag: `${titulo}-${texto}` });
    n.onclick = () => {
      window.focus();
      alTocar();
      n.close();
    };
  } catch {
    // Algunos navegadores móviles solo permiten notificaciones desde un service worker.
  }
}
