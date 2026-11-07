/**
 * «Instalar app» en el móvil (07/11/2026). El panel ya es instalable (manifest, iconos, service
 * worker); falta que el personal sepa hacerlo.
 *  · Android / Chrome / Edge: el navegador lanza `beforeinstallprompt` UNA vez, al cargar la página
 *    (antes de que exista el menú lateral, que va en un chunk perezoso). Por eso se escucha desde
 *    main.tsx con `escucharInstalacion()` y aquí se guarda el evento hasta que alguien pulse.
 *  · iPhone / iPad: Safari no tiene ese evento; solo se puede explicar el gesto (Compartir →
 *    «Añadir a pantalla de inicio»).
 *  · Ya instalada (`display-mode: standalone` o `navigator.standalone`): no se enseña nada.
 */

export type ModoInstalacion = "instalada" | "android" | "ios" | "no-disponible";

interface EventoInstalacion extends Event {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let eventoGuardado: EventoInstalacion | null = null;
let instaladaAhora = false;
let escuchando = false;
const oyentes = new Set<() => void>();

const avisar = () => oyentes.forEach((f) => f());

export function suscribirInstalacion(f: () => void): () => void {
  oyentes.add(f);
  return () => oyentes.delete(f);
}

export function estaInstalada(): boolean {
  if (instaladaAhora) return true;
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  } catch {
    /* navegador sin matchMedia */
  }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function esIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  // iPadOS se presenta como Mac: se distingue por la pantalla táctil.
  return /macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
}

export function modoInstalacion(): ModoInstalacion {
  if (estaInstalada()) return "instalada";
  if (eventoGuardado) return "android";
  if (esIOS()) return "ios";
  return "no-disponible";
}

/** Abre el diálogo del navegador. Devuelve si el usuario aceptó. */
export async function lanzarInstalacion(): Promise<boolean> {
  const evento = eventoGuardado;
  if (!evento) return false;
  // El evento solo sirve una vez.
  eventoGuardado = null;
  try {
    await evento.prompt();
    const eleccion = await evento.userChoice;
    const aceptada = eleccion?.outcome === "accepted";
    if (aceptada) instaladaAhora = true;
    return aceptada;
  } catch {
    return false;
  } finally {
    avisar();
  }
}

/** Llamar una vez al arrancar (main.tsx). */
export function escucharInstalacion(): void {
  if (escuchando || typeof window === "undefined") return;
  escuchando = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    // Sin esto Chrome enseña su propia barra; así el botón aparece donde el personal lo espera.
    e.preventDefault();
    eventoGuardado = e as EventoInstalacion;
    avisar();
  });
  window.addEventListener("appinstalled", () => {
    instaladaAhora = true;
    eventoGuardado = null;
    avisar();
  });
}

/** Solo pruebas. */
export function reiniciarInstalacion(): void {
  eventoGuardado = null;
  instaladaAhora = false;
  escuchando = false;
  oyentes.clear();
}
