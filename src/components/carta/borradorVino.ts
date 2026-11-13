/**
 * Vino a medias del formulario «Añadir vino» (13/11/2026, «he hecho una foto
 * de un vino con el iPhone y me ha echado»): en cuanto la IA lee la etiqueta,
 * la foto (la reducida, en el móvil) y lo que leyó se guardan en el propio
 * navegador (IndexedDB). Si la página se recarga antes de guardar la ficha, al
 * volver a «Añadir vino» se ofrece recuperarlo sin pagar otra lectura.
 *
 *   · Un solo borrador (el último). Caduca a las VIDA_BORRADOR_MS.
 *   · Se borra al guardar la ficha, al quitar la foto o al pulsar «Descartar».
 *   · Nunca rompe el formulario: sin IndexedDB (Safari privado, sin espacio)
 *     simplemente no hay borrador.
 */
import type { DatosVinoFoto } from "./leerVinoFoto";

export interface BorradorVino {
  foto: Blob;
  nombreFoto: string;
  datos: DatosVinoFoto;
  guardadoEn: number;
}

/** Un borrador más viejo que esto ya no se ofrece. */
export const VIDA_BORRADOR_MS = 3 * 60 * 60 * 1000;

/** Dónde se guarda (IndexedDB en el navegador; otro en las pruebas). */
export interface AlmacenBorradorVino {
  leer(): Promise<BorradorVino | null>;
  guardar(b: BorradorVino): Promise<void>;
  borrar(): Promise<void>;
}

const BD = "panel-borradores";
const TABLA = "vino";
const CLAVE = "actual";

function abrir(): Promise<IDBDatabase> {
  return new Promise((ok, ko) => {
    const p = indexedDB.open(BD, 1);
    p.onupgradeneeded = () => {
      if (!p.result.objectStoreNames.contains(TABLA)) p.result.createObjectStore(TABLA);
    };
    p.onsuccess = () => ok(p.result);
    p.onerror = () => ko(p.error ?? new Error("No se pudo abrir el almacén de borradores"));
    p.onblocked = () => ko(new Error("Almacén de borradores bloqueado"));
  });
}

async function operar<T>(modo: IDBTransactionMode, fn: (t: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const bd = await abrir();
  try {
    return await new Promise<T | undefined>((ok, ko) => {
      const tx = bd.transaction(TABLA, modo);
      const r = fn(tx.objectStore(TABLA));
      tx.oncomplete = () => ok(r ? r.result : undefined);
      tx.onerror = () => ko(tx.error ?? new Error("Error del almacén de borradores"));
      tx.onabort = () => ko(tx.error ?? new Error("Almacén de borradores: operación cancelada (¿sin espacio?)"));
    });
  } finally {
    bd.close();
  }
}

function almacenIndexedDB(): AlmacenBorradorVino | null {
  if (typeof indexedDB === "undefined") return null;
  return {
    leer: async () => (await operar<BorradorVino>("readonly", (t) => t.get(CLAVE))) ?? null,
    guardar: async (b) => {
      await operar("readwrite", (t) => {
        t.put(b, CLAVE);
      });
    },
    borrar: async () => {
      await operar("readwrite", (t) => {
        t.delete(CLAVE);
      });
    },
  };
}

const porDefecto = (almacen?: AlmacenBorradorVino | null) => (almacen === undefined ? almacenIndexedDB() : almacen);

/** Guarda la foto y lo leído. Nunca lanza. */
export async function guardarBorradorVino(
  b: Omit<BorradorVino, "guardadoEn">,
  opts: { almacen?: AlmacenBorradorVino | null; ahora?: number } = {},
): Promise<void> {
  try {
    await porDefecto(opts.almacen)?.guardar({ ...b, guardadoEn: opts.ahora ?? Date.now() });
  } catch (e) {
    console.warn("[borrador-vino] no se pudo guardar", e);
  }
}

/** El borrador vigente, o null (si caducó, se borra). Nunca lanza. */
export async function leerBorradorVino(opts: { almacen?: AlmacenBorradorVino | null; ahora?: number } = {}): Promise<BorradorVino | null> {
  const almacen = porDefecto(opts.almacen);
  try {
    const b = (await almacen?.leer()) ?? null;
    if (!b || !(b.foto instanceof Blob) || typeof b.guardadoEn !== "number" || !b.datos) return null;
    if ((opts.ahora ?? Date.now()) - b.guardadoEn > VIDA_BORRADOR_MS) {
      await almacen?.borrar();
      return null;
    }
    return b;
  } catch (e) {
    console.warn("[borrador-vino] no se pudo leer", e);
    return null;
  }
}

/** Borra el borrador. Nunca lanza. */
export async function borrarBorradorVino(opts: { almacen?: AlmacenBorradorVino | null } = {}): Promise<void> {
  try {
    await porDefecto(opts.almacen)?.borrar();
  } catch (e) {
    console.warn("[borrador-vino] no se pudo borrar", e);
  }
}

/** «hace 5 min», «hace 1 h». */
export function haceCuantoBorrador(guardadoEn: number, ahora = Date.now()): string {
  const min = Math.max(0, Math.round((ahora - guardadoEn) / 60000));
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  return `hace ${Math.round(min / 60)} h`;
}
