/**
 * Ayudas para procesos largos en el navegador (vídeo del plato): que el móvil
 * no apague la pantalla y saber si la pestaña ha pasado a segundo plano.
 */

type Sentinela = { released: boolean; release(): Promise<void> };
type WakeLockApi = { request(tipo: "screen"): Promise<Sentinela> };

/**
 * Pide Wake Lock de pantalla (si el navegador lo tiene) y lo vuelve a pedir
 * al volver a la pestaña (el navegador lo suelta al ocultarla). Devuelve la
 * función para soltarlo. Sin soporte o sin permiso no hace nada.
 */
export async function mantenerPantallaEncendida(): Promise<() => void> {
  const api = typeof navigator !== "undefined" ? (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock : undefined;
  if (!api?.request || typeof document === "undefined") return () => undefined;
  let sentinela: Sentinela | null = null;
  let activo = true;
  const pedir = async () => {
    if (!activo || document.visibilityState !== "visible") return;
    try {
      sentinela = await api.request("screen");
      if (!activo) void sentinela.release().catch(() => undefined);
    } catch {
      /* sin permiso / batería baja: se sigue sin él */
    }
  };
  const alCambiar = () => {
    if (document.visibilityState === "visible" && (!sentinela || sentinela.released)) void pedir();
  };
  document.addEventListener("visibilitychange", alCambiar);
  await pedir();
  return () => {
    activo = false;
    document.removeEventListener("visibilitychange", alCambiar);
    void sentinela?.release().catch(() => undefined);
    sentinela = null;
  };
}

/**
 * Vigila si la pestaña se oculta mientras dura un proceso. `alVolver` se llama
 * cada vez que vuelve a verse tras haberse ocultado.
 */
export function vigilarSegundoPlano(alVolver?: () => void): { seOculto: () => boolean; parar: () => void } {
  if (typeof document === "undefined") return { seOculto: () => false, parar: () => undefined };
  let oculto = document.visibilityState === "hidden";
  let estaOculta = oculto;
  const alCambiar = () => {
    if (document.visibilityState === "hidden") {
      oculto = true;
      estaOculta = true;
    } else if (estaOculta) {
      estaOculta = false;
      alVolver?.();
    }
  };
  document.addEventListener("visibilitychange", alCambiar);
  return { seOculto: () => oculto, parar: () => document.removeEventListener("visibilitychange", alCambiar) };
}

/** Espera a que la pestaña esté visible (resuelve ya si lo está). Se corta con `signal`. */
export function esperarVisible(signal?: AbortSignal): Promise<void> {
  if (typeof document === "undefined" || document.visibilityState !== "hidden") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const fin = () => {
      document.removeEventListener("visibilitychange", alCambiar);
      signal?.removeEventListener("abort", alAbortar);
    };
    const alCambiar = () => {
      if (document.visibilityState !== "hidden") {
        fin();
        resolve();
      }
    };
    const alAbortar = () => {
      fin();
      reject(new DOMException("Cancelado", "AbortError"));
    };
    document.addEventListener("visibilitychange", alCambiar);
    signal?.addEventListener("abort", alAbortar, { once: true });
  });
}
