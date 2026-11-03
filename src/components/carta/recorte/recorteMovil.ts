/**
 * Recorte de fotos de la carta en el MÓVIL (incluido iPhone). Lógica pura +
 * localStorage (testeable).
 *
 *   - PC (recorteNavegadorSeguro): como siempre, recorta en el formulario con
 *     el modelo en el navegador.
 *   - Móvil/tablet (Android, iPhone, iPad): la ficha se guarda con la foto
 *     ORIGINAL y, después (recorteEnSegundoPlano.ts):
 *       1. se intenta quitar el fondo EN EL MÓVIL, con el mismo modelo del PC;
 *       2. si falla (memoria, descarga, error) → el SERVIDOR
 *          (`/api/recortar-foto`, mismo modelo, con tope de gasto);
 *       3. si el servidor falla, no responde o hay tope → trabajo para un
 *          ordenador (recorteEnOrdenador.ts), con el motivo.
 *     Un móvil que se queda sin memoria recortando queda marcado
 *     (`movilSinLocal`) y las siguientes fotos van directas al servidor.
 *
 * Mientras un recorte está en marcha queda una marca en localStorage (una por
 * ficha) que la pestaña refresca (latido) con la fase (local / servidor) y si
 * la página se ve. Si el panel se cierra a medias, al volver a abrirlo la marca
 * sigue ahí sin latir: esa foto se manda al servidor (y, si murió recortando
 * en el móvil a la vista, el móvil queda marcado: fue la memoria).
 */

export const CLAVE_EN_CURSO = "panel.recorte.enCurso.v1";
/** Cada cuánto refresca sus marcas la pestaña que está recortando. */
export const MS_LATIDO = 4_000;
/** Sin latido desde hace esto (y de otra pestaña), la pestaña que recortaba ya no está. */
export const MS_MARCA_MUERTA = 15_000;

/** Evento de ventana cuando una ficha cambia de foto fuera de un formulario (GestorRecortes invalida la caché). */
export const EVENTO_FOTO_RECORTADA = "carta:foto-recortada";

export type TablaFoto = "Platos" | "Vinos" | "Bebidas" | "Cocteles";

/** Lo necesario para recortar una foto YA guardada en una ficha (y para retomarla). */
export interface DatosRecorte {
  tabla: TablaFoto;
  registroId: string;
  nombre: string | null;
  /** Ruta de la foto original en el bucket de la tabla (`<id>.<ext>`). */
  rutaOriginal: string;
  /** Fondo elegido (NombreTema). */
  tema: string;
}

export interface MarcaRecorte extends DatosRecorte {
  pestana: string;
  desde: number;
  latido: number;
  /** Dónde se estaba quitando el fondo en el último latido. */
  fase?: "local" | "servidor";
  /** ¿Se veía la página en el último latido? (iOS tira las páginas ocultas sin que sea falta de memoria). */
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

/** Id de ESTA carga de página (una pestaña recargada por iOS es otra «pestaña»). */
export const ID_PESTANA = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

type OpcionesMarca = { almacen?: Almacen | null; ahora?: number; pestana?: string };

function esMarca(m: unknown): m is MarcaRecorte {
  const x = m as MarcaRecorte | null;
  return !!x && typeof x.registroId === "string" && typeof x.rutaOriginal === "string" && typeof x.latido === "number";
}

/** Marcas de recortes en curso (también lee el formato antiguo de una sola marca). */
export function leerMarcasRecorte(almacen: Almacen | null = almacenLocal()): MarcaRecorte[] {
  try {
    const crudo = almacen?.getItem(CLAVE_EN_CURSO);
    if (!crudo) return [];
    const v = JSON.parse(crudo) as unknown;
    return (Array.isArray(v) ? v : [v]).filter(esMarca);
  } catch {
    return [];
  }
}

function guardarMarcas(marcas: MarcaRecorte[], almacen: Almacen | null): boolean {
  try {
    if (!almacen) return false;
    if (marcas.length) almacen.setItem(CLAVE_EN_CURSO, JSON.stringify(marcas));
    else almacen.removeItem(CLAVE_EN_CURSO);
    return true;
  } catch {
    return false;
  }
}

export function marcarRecorteEnCurso(d: DatosRecorte, opts: OpcionesMarca = {}): boolean {
  const almacen = opts.almacen === undefined ? almacenLocal() : opts.almacen;
  const ahora = opts.ahora ?? Date.now();
  const { tabla, registroId, nombre, rutaOriginal, tema } = d;
  const marca: MarcaRecorte = { tabla, registroId, nombre, rutaOriginal, tema, pestana: opts.pestana ?? ID_PESTANA, desde: ahora, latido: ahora };
  const resto = leerMarcasRecorte(almacen).filter((m) => !(m.tabla === d.tabla && m.registroId === d.registroId));
  return guardarMarcas([...resto, marca], almacen);
}

/** Refresca el latido (y si la página se ve) de las marcas de esta pestaña. */
export function latirMarcasRecorte(opts: OpcionesMarca & { visible?: boolean } = {}): void {
  const almacen = opts.almacen === undefined ? almacenLocal() : opts.almacen;
  const pestana = opts.pestana ?? ID_PESTANA;
  const marcas = leerMarcasRecorte(almacen);
  if (!marcas.some((m) => m.pestana === pestana)) return;
  const ahora = opts.ahora ?? Date.now();
  const visible = opts.visible ?? paginaVisible();
  guardarMarcas(
    marcas.map((m) => (m.pestana === pestana ? { ...m, latido: ahora, visible } : m)),
    almacen,
  );
}

/** Anota en qué fase está el recorte de esa ficha (local → servidor). */
export function faseMarcaRecorte(d: Pick<DatosRecorte, "tabla" | "registroId">, fase: "local" | "servidor", almacen: Almacen | null = almacenLocal()): void {
  guardarMarcas(
    leerMarcasRecorte(almacen).map((m) => (m.tabla === d.tabla && m.registroId === d.registroId ? { ...m, fase, latido: Date.now(), visible: paginaVisible() } : m)),
    almacen,
  );
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

export function quitarMarcaRecorte(d: Pick<DatosRecorte, "tabla" | "registroId">, almacen: Almacen | null = almacenLocal()): void {
  guardarMarcas(
    leerMarcasRecorte(almacen).filter((m) => !(m.tabla === d.tabla && m.registroId === d.registroId)),
    almacen,
  );
}

/**
 * ¿La pestaña que dejó la marca ya no está? Sí si la marca es de OTRA carga
 * de página y no late desde hace MS_MARCA_MUERTA.
 */
export function marcaHuerfana(m: MarcaRecorte, ahora = Date.now(), pestana = ID_PESTANA): boolean {
  return m.pestana !== pestana && ahora - m.latido > MS_MARCA_MUERTA;
}

/** Datos de la ficha de una marca (sin los campos de control). */
export function datosDeMarca(m: MarcaRecorte): DatosRecorte {
  const { tabla, registroId, nombre, rutaOriginal, tema } = m;
  return { tabla, registroId, nombre, rutaOriginal, tema };
}

/** Dónde se quita el fondo de la foto que se acaba de elegir: en el formulario (PC) o tras guardar (móvil: local → servidor → ordenador). */
export type DestinoRecorte = "formulario" | "movil";

/**
 * Por qué no se pudo poner el fondo en el móvil:
 *   sesion: el servidor no aceptó la sesión (401); permiso: sin permiso de carta (403);
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
      return "El servidor no encontró el producto en la foto.";
    case "tiempo":
      return "El servidor tardó demasiado en quitar el fondo.";
    case "tope":
      return `${detalle || "Se ha alcanzado el tope mensual de recortes en el servidor"}.`;
    case "red":
      return `No se pudo conectar con el servidor${entre}. Revisa la conexión.`;
    case "servidor":
      return `El servidor no pudo quitar el fondo${entre}.`;
    default:
      return `No se pudo poner el fondo de carta${entre}.`;
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
