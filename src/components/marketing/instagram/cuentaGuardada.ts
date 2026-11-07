/**
 * Cuenta de Instagram recordada en el navegador para el indicador «● @cuenta»
 * de la barra (docs/instagram-rendimiento.md). Antes el indicador llamaba a
 * instagram-estado en cada carga de /instagram, y esa función pregunta a Meta
 * varias veces (debug_token, perfil, cuota, páginas…): 2-5 s de «Comprobando…».
 *
 * Ahora el indicador NO llama a nadie: pinta lo último que se comprobó (lo
 * guarda cada comprobación completa: la del diálogo «Conexión con Instagram»
 * o su botón «Comprobar»). Solo se guarda lo que el indicador necesita (si
 * está bien, @usuario e id por marca): nunca secretos ni detalles.
 *
 * localStorage (y no sessionStorage) para que sobreviva a cerrar la pestaña en
 * la tablet; pasados CADUCIDAD_CUENTA_MS se sigue enseñando el @usuario, pero
 * con el punto gris («sin comprobar hace rato») hasta la próxima comprobación.
 * Sin almacenamiento (modo privado, jsdom sin él…) todo sigue funcionando.
 */
import type { MarcaId } from "@/lib/instagram";
import type { RespuestaEstado } from "./api";

export const CLAVE_CUENTA_GUARDADA = "instagram:cuenta";
/** Pasado este tiempo, el punto pasa a gris (el @usuario se sigue viendo). */
export const CADUCIDAD_CUENTA_MS = 45 * 60_000;
const VERSION = 1;

export interface CuentaGuardada {
  v: typeof VERSION;
  /** Cuándo se comprobó (ms). */
  en: number;
  ok: boolean;
  cuenta: { id: string | null; username: string } | null;
  cuentasPorMarca: Array<{ marca: MarcaId; username: string | null; igUserId: string | null }>;
}

type Almacen = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function almacenPorDefecto(): Almacen | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Lo justo para el indicador, a partir de una comprobación completa. */
export function resumirEstado(e: RespuestaEstado, ahora = Date.now()): CuentaGuardada {
  return {
    v: VERSION,
    en: ahora,
    ok: e.ok,
    cuenta: e.cuenta ? { id: e.cuenta.id ?? null, username: e.cuenta.username } : null,
    cuentasPorMarca: e.cuentasPorMarca.map((c) => ({ marca: c.marca, username: c.username, igUserId: c.igUserId })),
  };
}

export function guardarCuenta(e: RespuestaEstado | null, almacen: Almacen | null = almacenPorDefecto(), ahora = Date.now()): void {
  if (!almacen) return;
  try {
    if (!e) almacen.removeItem(CLAVE_CUENTA_GUARDADA);
    else almacen.setItem(CLAVE_CUENTA_GUARDADA, JSON.stringify(resumirEstado(e, ahora)));
  } catch {
    /* almacenamiento lleno o bloqueado: solo en memoria */
  }
}

function valida(x: unknown): x is CuentaGuardada {
  if (!x || typeof x !== "object") return false;
  const o = x as Partial<CuentaGuardada>;
  return o.v === VERSION && typeof o.en === "number" && typeof o.ok === "boolean" && Array.isArray(o.cuentasPorMarca);
}

/** La cuenta guardada y si sigue vigente (null si no hay o está estropeada). */
export function leerCuentaGuardada(
  ahora = Date.now(),
  almacen: Almacen | null = almacenPorDefecto(),
): { cuenta: CuentaGuardada; vigente: boolean } | null {
  if (!almacen) return null;
  try {
    const crudo = almacen.getItem(CLAVE_CUENTA_GUARDADA);
    if (!crudo) return null;
    const x: unknown = JSON.parse(crudo);
    if (!valida(x)) return null;
    return { cuenta: x, vigente: ahora - x.en >= 0 && ahora - x.en < CADUCIDAD_CUENTA_MS };
  } catch {
    return null;
  }
}

/**
 * Id de Instagram de la cuenta de una marca (o de la general con «todas»),
 * según la última comprobación; null si no se sabe. Lo usa el Estudio para
 * elegir las métricas cuando hay más de una cuenta.
 */
export function igUserIdGuardado(marca: MarcaId | null, guardada: CuentaGuardada | null | undefined): string | null {
  if (!guardada) return null;
  const propia = marca ? guardada.cuentasPorMarca.find((c) => c.marca === marca)?.igUserId : null;
  return propia ?? guardada.cuenta?.id ?? null;
}
