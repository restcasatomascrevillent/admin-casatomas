/**
 * Recorte de fotos de la carta en el MÓVIL (Android, iPhone, iPad). Lógica
 * pura + localStorage (testeable).
 *
 * Decisión del dueño (03-11-2026): en el móvil se recorta IGUAL que en el
 * portátil, en el propio formulario, en cuanto se pone la foto (sticker y
 * fondo a la vista antes de guardar). quitarFondoMovil.ts:
 *   1. en el navegador del móvil, con el mismo modelo del PC;
 *   2. si falla (memoria, descarga, error) → en el SERVIDOR
 *      (`/api/recortar-foto`, mismo modelo, con tope de gasto), también
 *      desde el formulario;
 *   3. si el servidor falla o hay tope → se guarda la foto normal y se crea un
 *      trabajo para un ordenador (recorteEnOrdenador.ts), con el motivo.
 *
 * Mientras el móvil recorta queda una marca en localStorage que la pestaña
 * refresca (latido) con si la página se ve. Si la pestaña muere (el sistema la
 * cierra por memoria), al volver a abrir el panel la marca sigue ahí sin
 * latir: el móvil queda marcado (`movilSinLocal`) y las siguientes fotos van
 * directas al servidor.
 */

/** Marca «el móvil está recortando en el formulario». */
export const CLAVE_EN_CURSO = "panel.recorte.formulario.v1";
/** Cada cuánto refresca la marca la pestaña que está recortando. */
export const MS_LATIDO = 4_000;
/** Sin latido desde hace esto (y de otra pestaña), la pestaña que recortaba murió. */
export const MS_MARCA_MUERTA = 15_000;

export type TablaFoto = "Platos" | "Vinos" | "Bebidas" | "Cocteles";

/** Lo necesario para recortar una foto YA guardada en una ficha (trabajo para un ordenador). */
export interface DatosRecorte {
  tabla: TablaFoto;
  registroId: string;
  nombre: string | null;
  /** Ruta de la foto original en el bucket de la tabla (`<id>.<ext>`). */
  rutaOriginal: string;
  /** Fondo elegido (NombreTema). */
  tema: string;
}

export interface MarcaRecorte {
  pestana: string;
  desde: number;
  latido: number;
  /** ¿Se veía la página en el último latido? (iOS/Android tiran las páginas ocultas sin que sea falta de memoria). */
  visible?: boolean;
}

/** ¿Se ve la página ahora? (sin document: sí). */
export function paginaVisible(): boolean {
  try {
    return typeof document === "undefined" || document.visibilityState !== "hidden";
  } catch {
    return true;
  }
}

export type Almacen = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function almacenLocal(): Almacen | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** Id de ESTA carga de página (una pestaña recargada es otra «pestaña»). */
export const ID_PESTANA = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

type OpcionesMarca = { almacen?: Almacen | null; ahora?: number; pestana?: string; visible?: boolean };

export function marcarRecorteEnCurso(opts: OpcionesMarca = {}): void {
  const almacen = opts.almacen === undefined ? almacenLocal() : opts.almacen;
  const ahora = opts.ahora ?? Date.now();
  const marca: MarcaRecorte = { pestana: opts.pestana ?? ID_PESTANA, desde: ahora, latido: ahora, visible: opts.visible ?? paginaVisible() };
  try {
    almacen?.setItem(CLAVE_EN_CURSO, JSON.stringify(marca));
  } catch {
    /* sin almacén: nada */
  }
}

export function leerMarcaRecorte(almacen: Almacen | null = almacenLocal()): MarcaRecorte | null {
  try {
    const m = JSON.parse(almacen?.getItem(CLAVE_EN_CURSO) ?? "null") as MarcaRecorte | null;
    return m && typeof m.pestana === "string" && typeof m.latido === "number" ? m : null;
  } catch {
    return null;
  }
}

/** Refresca el latido (y si la página se ve) si la marca es de esta pestaña. */
export function latirMarcaRecorte(opts: OpcionesMarca = {}): void {
  const almacen = opts.almacen === undefined ? almacenLocal() : opts.almacen;
  const m = leerMarcaRecorte(almacen);
  if (!m || m.pestana !== (opts.pestana ?? ID_PESTANA)) return;
  try {
    almacen?.setItem(CLAVE_EN_CURSO, JSON.stringify({ ...m, latido: opts.ahora ?? Date.now(), visible: opts.visible ?? paginaVisible() }));
  } catch {
    /* nada */
  }
}

export function quitarMarcaRecorte(almacen: Almacen | null = almacenLocal()): void {
  try {
    almacen?.removeItem(CLAVE_EN_CURSO);
  } catch {
    /* nada */
  }
}

/** ¿La pestaña que dejó la marca murió a medias? (otra carga de página, sin latido desde hace MS_MARCA_MUERTA). */
export function marcaHuerfana(m: MarcaRecorte, ahora = Date.now(), pestana = ID_PESTANA): boolean {
  return m.pestana !== pestana && ahora - m.latido > MS_MARCA_MUERTA;
}

/** Móvil que se quedó sin memoria recortando: las fotos van directas al servidor. */
export const CLAVE_SIN_LOCAL = "panel.recorte.noNavegador.v1";

export interface MarcaSinLocal {
  desde: number;
  motivo: string;
}

export function movilSinLocal(almacen: Almacen | null = almacenLocal()): MarcaSinLocal | null {
  try {
    const m = JSON.parse(almacen?.getItem(CLAVE_SIN_LOCAL) ?? "null") as MarcaSinLocal | null;
    return typeof m?.desde === "number" ? m : null;
  } catch {
    return null;
  }
}

export function marcarMovilSinLocal(motivo: string, almacen: Almacen | null = almacenLocal(), ahora = Date.now()): void {
  try {
    almacen?.setItem(CLAVE_SIN_LOCAL, JSON.stringify({ desde: ahora, motivo } satisfies MarcaSinLocal));
  } catch {
    /* nada */
  }
}

export function olvidarMovilSinLocal(almacen: Almacen | null = almacenLocal()): void {
  try {
    almacen?.removeItem(CLAVE_SIN_LOCAL);
  } catch {
    /* nada */
  }
}

/** ¿El error parece de falta de memoria? */
export function esFaltaDeMemoria(e: unknown): boolean {
  const err = e as { name?: string; message?: string } | null;
  if (!err) return false;
  if (err.name === "RangeError") return true;
  return /out of memory|memory|memoria|allocation|bad_alloc/i.test(err.message ?? "");
}

/**
 * Por qué no se pudo quitar el fondo en el servidor:
 *   sesion: no aceptó la sesión (401); permiso: sin permiso de carta (403);
 *   sin-producto: el modelo no encontró nada (422); tiempo: no respondió a tiempo;
 *   tope: se alcanzó el tope de gasto de recortes en el servidor (429);
 *   red: no se pudo conectar; servidor: error del servidor (5xx/otros); otro: el resto.
 */
export type CausaFallo = "sesion" | "permiso" | "sin-producto" | "tiempo" | "tope" | "red" | "servidor" | "otro";

const RE_RED = /failed to fetch|load failed|networkerror|network connection|fetch(ing)? .*fail|conexi[oó]n|err_internet|err_network/i;

export function causaFallo(e: unknown): CausaFallo {
  const err = e as { causa?: CausaFallo; name?: string; message?: string } | null;
  if (err?.causa) return err.causa;
  if (RE_RED.test(err?.message ?? "")) return "red";
  return "otro";
}

/** Mensaje corto (para el aviso). */
export function mensajeCorto(e: unknown, max = 90): string {
  const err = e as { name?: string; message?: string } | null;
  const t = (err?.message || String(e ?? "")).replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Frase con la causa real para el aviso al usuario. */
export function motivoFallo(e: unknown): string {
  const detalle = e === undefined ? "" : mensajeCorto(e);
  const entre = detalle ? ` (${detalle})` : "";
  switch (causaFallo(e)) {
    case "sesion":
      return "El servidor no aceptó tu sesión (puede haber caducado).";
    case "permiso":
      return "Tu usuario no tiene permiso para cambiar fotos de la carta.";
    case "sin-producto":
      return "No se encontró el producto en la foto.";
    case "tiempo":
      return "El servidor tardó demasiado en quitar el fondo.";
    case "tope":
      return `${detalle || "Se ha alcanzado el tope mensual de recortes en el servidor"}.`;
    case "red":
      return `No se pudo conectar con el servidor${entre}. Revisa la conexión.`;
    case "servidor":
      return `El servidor no pudo quitar el fondo${entre}.`;
    default:
      return `No se pudo quitar el fondo${entre}.`;
  }
}

/**
 * ¿Merece la pena mandar la foto a un ordenador? No si el modelo ya dijo que
 * no hay producto (el ordenador usa el mismo) ni si el usuario no tiene permiso.
 */
export function vaAOrdenador(e: unknown): boolean {
  const c = causaFallo(e);
  return c !== "sin-producto" && c !== "permiso";
}

/** Tabla → bucket y encuadre de la foto de carta. */
export const BUCKET_TABLA: Record<TablaFoto, "platos" | "vinos" | "bebidas" | "cocteles"> = {
  Platos: "platos",
  Vinos: "vinos",
  Bebidas: "bebidas",
  Cocteles: "cocteles",
};
export const TIPO_TABLA: Record<TablaFoto, "plato" | "vino" | "bebida"> = {
  Platos: "plato",
  Vinos: "vino",
  Bebidas: "bebida",
  Cocteles: "bebida",
};
export const CLAVE_CONSULTA_TABLA: Record<TablaFoto, string> = {
  Platos: "platos",
  Vinos: "vinos",
  Bebidas: "bebidas",
  Cocteles: "cocteles",
};
