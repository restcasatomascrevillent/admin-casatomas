/**
 * Reintentos con espera creciente pensados para la red del móvil: si se va la
 * cobertura (navigator.onLine === false) no se gastan intentos, se espera a
 * que vuelva (evento «online») y se sigue. Solo se reintentan los fallos de
 * red o del servidor (5xx, 408, 429); un error de validación o de permisos se
 * devuelve a la primera.
 */
import { ErrorInstagram } from "@/components/marketing/instagram/api";
import { ErrorIA } from "@/components/instagram/ia/api";

export class Cancelado extends Error {
  constructor() {
    super("Cancelado");
    this.name = "Cancelado";
  }
}

/** Error con estado HTTP (opcional) y si merece la pena reintentarlo. */
export class ErrorReintentable extends Error {
  constructor(
    mensaje: string,
    readonly reintentable: boolean,
    readonly estado?: number,
  ) {
    super(mensaje);
    this.name = "ErrorReintentable";
  }
}

const ESTADOS_REINTENTABLES = new Set([408, 425, 429, 500, 502, 503, 504]);

/** ¿Fallo de red o del servidor que puede salir bien al reintentar? */
export function esErrorReintentable(e: unknown): boolean {
  if (e instanceof Cancelado) return false;
  if (e instanceof ErrorReintentable) return e.reintentable;
  if (e instanceof ErrorInstagram) return e.tipo === "red" || (e.estado !== undefined && ESTADOS_REINTENTABLES.has(e.estado));
  // La cuota de IA (429) NO se reintenta: es justo lo que no hay que gastar.
  if (e instanceof ErrorIA) return e.tipo === "red" || (e.tipo === "servidor" && e.estado !== undefined && e.estado >= 500);
  // fetch lanza TypeError («Failed to fetch», «Load failed» en Safari) si no hay red.
  if (e instanceof TypeError) return true;
  const estado = (e as { status?: unknown; statusCode?: unknown })?.status ?? (e as { statusCode?: unknown })?.statusCode;
  const n = typeof estado === "string" ? Number(estado) : estado;
  return typeof n === "number" && ESTADOS_REINTENTABLES.has(n);
}

export function enLinea(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/** Espera al evento «online» (o hasta `maxMs`, por si el navegador no avisa). */
export function esperarConexion(signal?: AbortSignal, maxMs = 30_000, hayRed: () => boolean = enLinea): Promise<void> {
  if (hayRed() || typeof window === "undefined") return Promise.resolve();
  return new Promise((ok, ko) => {
    const fin = () => {
      window.removeEventListener("online", alVolver);
      signal?.removeEventListener("abort", alCancelar);
      clearTimeout(t);
    };
    const alVolver = () => {
      fin();
      ok();
    };
    const alCancelar = () => {
      fin();
      ko(new Cancelado());
    };
    const t = setTimeout(alVolver, maxMs);
    window.addEventListener("online", alVolver);
    signal?.addEventListener("abort", alCancelar);
  });
}

export function dormir(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((ok, ko) => {
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", alCancelar);
      ok();
    }, ms);
    const alCancelar = () => {
      clearTimeout(t);
      ko(new Cancelado());
    };
    signal?.addEventListener("abort", alCancelar);
  });
}

export interface OpcionesReintento {
  /** Intentos en total (con cobertura). Por defecto 4. */
  intentos?: number;
  /** Primera espera; luego se dobla (1 s, 2 s, 4 s…). */
  esperaBaseMs?: number;
  esperaMaxMs?: number;
  signal?: AbortSignal;
  reintentable?: (e: unknown) => boolean;
  alReintentar?: (info: { intento: number; error: unknown; sinConexion: boolean }) => void;
  /** Inyectables para las pruebas. */
  dormir?: (ms: number, signal?: AbortSignal) => Promise<void>;
  enLinea?: () => boolean;
  esperarConexion?: (signal?: AbortSignal) => Promise<void>;
}

/**
 * Ejecuta `fn` y la repite si falla por la red. Sin cobertura no cuenta el
 * intento: espera a que vuelva (como mucho 20 veces, para no quedarse colgado).
 */
export async function conReintentos<T>(fn: (intento: number) => Promise<T>, o: OpcionesReintento = {}): Promise<T> {
  const intentos = Math.max(1, o.intentos ?? 4);
  const base = o.esperaBaseMs ?? 1000;
  const max = o.esperaMaxMs ?? 15_000;
  const esperar = o.dormir ?? dormir;
  const hayRed = o.enLinea ?? enLinea;
  const aguardarRed = o.esperarConexion ?? ((signal?: AbortSignal) => esperarConexion(signal, 30_000, hayRed));
  const reintentable = o.reintentable ?? esErrorReintentable;
  let fallos = 0;
  let esperasSinRed = 0;
  for (let intento = 1; ; intento++) {
    if (o.signal?.aborted) throw new Cancelado();
    try {
      return await fn(intento);
    } catch (e) {
      if (o.signal?.aborted) throw new Cancelado();
      if (!reintentable(e)) throw e;
      const sinConexion = !hayRed();
      if (sinConexion && esperasSinRed < 20) {
        esperasSinRed++;
        o.alReintentar?.({ intento, error: e, sinConexion: true });
        await aguardarRed(o.signal);
        continue;
      }
      fallos++;
      if (fallos >= intentos) throw e;
      o.alReintentar?.({ intento, error: e, sinConexion: false });
      await esperar(Math.min(max, base * 2 ** (fallos - 1)), o.signal);
    }
  }
}
