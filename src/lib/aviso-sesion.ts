/**
 * Aviso de «sesión caducada» que se enseña en la pantalla de entrada.
 *
 * Cuando la sesión deja de valer sin que el usuario la cierre (el token no se
 * pudo renovar, la sesión se cerró en el servidor…), el panel vuelve al login.
 * Antes se decía «Tu acceso al panel ha sido bloqueado», que asustaba al dueño:
 * el bloqueo solo se anuncia con una señal explícita (aviso en tiempo real de
 * `user_access_status` o el código `user_banned` de Auth). Todo lo demás es una
 * sesión caducada y se dice así.
 *
 * El aviso vive en memoria y en `sessionStorage` (por si la pestaña se recarga
 * al volver al login). Si el almacenamiento no está disponible, sigue en memoria.
 */
import { useSyncExternalStore } from "react";

export const MENSAJE_SESION_CADUCADA = "Tu sesión ha caducado. Vuelve a entrar.";

const CLAVE = "panel:sesion-caducada";
const oyentes = new Set<() => void>();

function leerAlmacenado(): boolean {
  try {
    return window.sessionStorage.getItem(CLAVE) === "1";
  } catch {
    return false;
  }
}

let caducada = typeof window !== "undefined" && leerAlmacenado();

function publicar(valor: boolean) {
  caducada = valor;
  try {
    if (valor) window.sessionStorage.setItem(CLAVE, "1");
    else window.sessionStorage.removeItem(CLAVE);
  } catch {
    /* sin almacenamiento: basta con la memoria */
  }
  oyentes.forEach((oyente) => oyente());
}

/** La sesión terminó sin que el usuario la cerrara ni haya un bloqueo explícito. */
export function marcarSesionCaducada() {
  if (!caducada) publicar(true);
}

/** Al entrar de nuevo, cerrar sesión a mano o por un bloqueo explícito. */
export function limpiarAvisoSesionCaducada() {
  if (caducada) publicar(false);
}

export function sesionCaducada(): boolean {
  return caducada;
}

function suscribir(oyente: () => void) {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}

/** Para la pantalla de entrada: `true` mientras haya que enseñar el aviso. */
export function useAvisoSesionCaducada(): boolean {
  return useSyncExternalStore(suscribir, sesionCaducada, () => false);
}
