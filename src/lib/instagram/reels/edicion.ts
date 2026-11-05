/**
 * Operaciones puras de edición de un reel (las usa EditorReel y se prueban
 * sin DOM). Nunca mutan: devuelven un reel nuevo.
 */
import { calcularTiempos } from "./motor.js";
import { escenaNueva } from "./bases.js";
import { LIMITES_REEL, type CierreReel, type EscenaReel, type ReelPieza } from "./esquema.js";

/** id nuevo que no choca con los del reel («e3», «e4»…). */
export function idEscenaNuevo(reel: ReelPieza): string {
  const usados = new Set(reel.escenas.map((e) => e.id));
  let n = reel.escenas.length + 1;
  while (usados.has(`e${n}`)) n++;
  return `e${n}`;
}

export const puedeAnadirEscena = (reel: ReelPieza) => reel.escenas.length < LIMITES_REEL.escenasMax;
export const puedeQuitarEscena = (reel: ReelPieza) => reel.escenas.length > LIMITES_REEL.escenasMin;

/** Añade una escena después de `despues` (por defecto, al final). */
export function anadirEscena(reel: ReelPieza, despues = reel.escenas.length - 1, escena?: EscenaReel): ReelPieza {
  if (!puedeAnadirEscena(reel)) return reel;
  const nueva = escena ?? escenaNueva(idEscenaNuevo(reel), reel.escenas.length + 1);
  const escenas = [...reel.escenas];
  escenas.splice(Math.min(Math.max(despues + 1, 0), escenas.length), 0, nueva);
  return { ...reel, escenas };
}

/** Quita la escena `indice` (siempre queda al menos una). */
export function quitarEscena(reel: ReelPieza, indice: number): ReelPieza {
  if (!puedeQuitarEscena(reel) || indice < 0 || indice >= reel.escenas.length) return reel;
  return { ...reel, escenas: reel.escenas.filter((_, i) => i !== indice) };
}

/** Mueve la escena de `desde` a `hasta`. */
export function moverEscena(reel: ReelPieza, desde: number, hasta: number): ReelPieza {
  const n = reel.escenas.length;
  if (desde === hasta || desde < 0 || hasta < 0 || desde >= n || hasta >= n) return reel;
  const escenas = [...reel.escenas];
  const [e] = escenas.splice(desde, 1);
  escenas.splice(hasta, 0, e);
  return { ...reel, escenas };
}

/** Cambia campos de una escena. */
export function cambiarEscena(reel: ReelPieza, indice: number, cambios: Partial<EscenaReel>): ReelPieza {
  return { ...reel, escenas: reel.escenas.map((e, i) => (i === indice ? limpiar({ ...e, ...cambios }) : e)) };
}

/** Cambia campos del cierre. */
export function cambiarCierre(reel: ReelPieza, cambios: Partial<CierreReel>): ReelPieza {
  return { ...reel, cierre: limpiar({ ...reel.cierre, ...cambios }) };
}

/** Instante en que empieza la escena `indice` (o el cierre si indice = nº de escenas). */
export function inicioDeEscena(reel: ReelPieza, indice: number): number {
  const t = calcularTiempos(reel);
  return indice >= reel.escenas.length ? t.inicioCierre : (t.tramos[indice]?.[0] ?? 0);
}

/** Quita las claves undefined (el esquema es estricto y JSON no las guarda). */
function limpiar<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}
