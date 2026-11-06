/**
 * Borrador del asistente móvil guardado EN EL MÓVIL (IndexedDB) hasta
 * publicar: si se va la cobertura, se cierra la pestaña o el sistema mata el
 * navegador, las fotos (ya convertidas a JPEG) y el texto siguen ahí al
 * volver. Sin IndexedDB (modo privado antiguo, pruebas) se guarda en memoria.
 * Nada sale del dispositivo por aquí.
 */
import type { MarcaId } from "@/lib/instagram";
import type { RespuestaMontar } from "@/lib/instagram/montar";
import type { TonoIA } from "@/components/instagram/ia/api";
import type { FotoMovil } from "./estado";

export type PasoMovil = "fotos" | "montaje" | "publicar";

/** Foto tal como se guarda (sin la URL de la miniatura, que se rehace al leer). */
export type FotoGuardada = Omit<FotoMovil, "vista"> & { vistaCarta?: string | null };

export interface BorradorMovil {
  version: 1;
  marca: MarcaId;
  indicacion: string;
  tono: TonoIA;
  fotos: FotoGuardada[];
  montaje: RespuestaMontar | null;
  /** Firma de las fotos e indicación con las que se montó. */
  firmaMontaje: string | null;
  caption: string;
  paso: PasoMovil;
  guardadoEn: number;
}

export interface Almacen {
  leer(): Promise<BorradorMovil | null>;
  guardar(b: BorradorMovil): Promise<void>;
  borrar(): Promise<void>;
}

/** Un borrador de más de 7 días ya no se ofrece. */
export const VIDA_BORRADOR_MS = 7 * 24 * 60 * 60 * 1000;

function vigente(b: BorradorMovil | null | undefined, ahora = Date.now()): BorradorMovil | null {
  if (!b || b.version !== 1 || !Array.isArray(b.fotos)) return null;
  return ahora - (b.guardadoEn ?? 0) > VIDA_BORRADOR_MS ? null : b;
}

export function crearAlmacenMemoria(): Almacen {
  let actual: BorradorMovil | null = null;
  return {
    leer: async () => vigente(actual),
    guardar: async (b) => {
      actual = b;
    },
    borrar: async () => {
      actual = null;
    },
  };
}

const BD = "instagram-movil";
const TABLA = "borrador";
const CLAVE = "actual";

function abrir(): Promise<IDBDatabase> {
  return new Promise((ok, ko) => {
    const p = indexedDB.open(BD, 1);
    p.onupgradeneeded = () => {
      if (!p.result.objectStoreNames.contains(TABLA)) p.result.createObjectStore(TABLA);
    };
    p.onsuccess = () => ok(p.result);
    p.onerror = () => ko(p.error ?? new Error("No se pudo abrir el almacén del móvil"));
    p.onblocked = () => ko(new Error("Almacén del móvil bloqueado"));
  });
}

async function operar<T>(modo: IDBTransactionMode, fn: (t: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const bd = await abrir();
  try {
    return await new Promise<T | undefined>((ok, ko) => {
      const tx = bd.transaction(TABLA, modo);
      const r = fn(tx.objectStore(TABLA));
      tx.oncomplete = () => ok(r ? r.result : undefined);
      tx.onerror = () => ko(tx.error ?? new Error("Error del almacén del móvil"));
      tx.onabort = () => ko(tx.error ?? new Error("Almacén del móvil: operación cancelada (¿sin espacio?)"));
    });
  } finally {
    bd.close();
  }
}

/** Almacén en IndexedDB, o null si el navegador no lo tiene. */
export function crearAlmacenIndexedDB(): Almacen | null {
  if (typeof indexedDB === "undefined") return null;
  return {
    leer: async () => vigente((await operar<BorradorMovil>("readonly", (t) => t.get(CLAVE))) ?? null),
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

/**
 * IndexedDB con respaldo en memoria: si una escritura falla (cuota llena,
 * Safari privado), el borrador sigue en memoria mientras la página esté abierta.
 */
export function almacenPorDefecto(): Almacen {
  const memoria = crearAlmacenMemoria();
  const idb = crearAlmacenIndexedDB();
  if (!idb) return memoria;
  return {
    leer: async () => {
      try {
        return (await idb.leer()) ?? (await memoria.leer());
      } catch {
        return memoria.leer();
      }
    },
    guardar: async (b) => {
      await memoria.guardar(b);
      try {
        await idb.guardar(b);
      } catch {
        /* queda en memoria */
      }
    },
    borrar: async () => {
      await memoria.borrar();
      try {
        await idb.borrar();
      } catch {
        /* nada */
      }
    },
  };
}
