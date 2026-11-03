/**
 * Recorte de fotos de la carta en el MÓVIL (incluido iPhone), sin Replicate
 * (decisión del dueño, 02-11-2026). Lógica pura + localStorage (testeable).
 *
 *   - PC (recorteNavegadorSeguro): como siempre, recorta en el formulario.
 *   - Móvil/tablet: el formulario NO recorta. Al guardar, la ficha se guarda
 *     con la foto ORIGINAL y, después, el móvil intenta recortarla en el
 *     navegador con el mismo modelo/pipeline del PC (recorteEnSegundoPlano.ts).
 *     Antes de empezar deja en localStorage la «marca de recorte en curso» y
 *     la va refrescando (latido). Si la pestaña muere (iOS la mata por
 *     memoria), al volver a abrir el panel la marca sigue ahí con un latido
 *     viejo: este dispositivo queda marcado como «no recorta en el navegador»
 *     (se recuerda) y la foto se queda guardada sin recortar.
 *   - Móvil ya marcado: ni lo intenta; guarda la foto normal.
 *
 * Solo se marca por MEMORIA (03-11-2026, iPhone de un amigo del dueño): la
 * marca guarda si la página estaba VISIBLE en el último latido. Si murió
 * estando oculta (el usuario salió del panel e iOS la congeló/tiró) no se
 * marca: solo se manda la foto al ordenador y se avisa «saliste del panel».
 * Los fallos de red/descarga tampoco marcan. El aviso dice la causa real
 * (causaFallo/motivoFallo) y queda en console.warn.
 */

export const CLAVE_EN_CURSO = "panel.recorte.enCurso.v1";
export const CLAVE_NO_NAVEGADOR = "panel.recorte.noNavegador.v1";
/** Cada cuánto refresca la marca la pestaña que está recortando. */
export const MS_LATIDO = 4_000;
/** Sin latido desde hace esto (y de otra pestaña), la pestaña que recortaba murió. */
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
  /** ¿Estaba la página visible en el último latido? (sin el campo: marcas antiguas, se trata como visible). */
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

type OpcionesMarca = { almacen?: Almacen | null; ahora?: number; pestana?: string; visible?: boolean };

export function marcarRecorteEnCurso(d: DatosRecorte, opts: OpcionesMarca = {}): boolean {
  const almacen = opts.almacen === undefined ? almacenLocal() : opts.almacen;
  const ahora = opts.ahora ?? Date.now();
  const marca: MarcaRecorte = { ...d, pestana: opts.pestana ?? ID_PESTANA, desde: ahora, latido: ahora, visible: opts.visible ?? paginaVisible() };
  try {
    almacen?.setItem(CLAVE_EN_CURSO, JSON.stringify(marca));
    return !!almacen;
  } catch {
    return false;
  }
}

export function leerMarcaRecorte(almacen: Almacen | null = almacenLocal()): MarcaRecorte | null {
  try {
    const crudo = almacen?.getItem(CLAVE_EN_CURSO);
    if (!crudo) return null;
    const m = JSON.parse(crudo) as MarcaRecorte;
    if (!m || typeof m.registroId !== "string" || typeof m.rutaOriginal !== "string" || typeof m.latido !== "number") return null;
    return m;
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
    /* sin almacén: nada */
  }
}

export function quitarMarcaRecorte(almacen: Almacen | null = almacenLocal()): void {
  try {
    almacen?.removeItem(CLAVE_EN_CURSO);
  } catch {
    /* nada */
  }
}

/**
 * ¿La pestaña que dejó la marca murió a medias? Sí si la marca es de OTRA
 * carga de página y no late desde hace MS_MARCA_MUERTA.
 */
export function marcaHuerfana(m: MarcaRecorte, ahora = Date.now(), pestana = ID_PESTANA): boolean {
  return m.pestana !== pestana && ahora - m.latido > MS_MARCA_MUERTA;
}

export interface MarcaNoNavegador {
  desde: number;
  motivo: string;
}

export function dispositivoNoRecorta(almacen: Almacen | null = almacenLocal()): MarcaNoNavegador | null {
  try {
    const crudo = almacen?.getItem(CLAVE_NO_NAVEGADOR);
    if (!crudo) return null;
    const m = JSON.parse(crudo) as MarcaNoNavegador;
    return typeof m?.desde === "number" ? m : null;
  } catch {
    return null;
  }
}

export function marcarDispositivoNoRecorta(motivo: string, almacen: Almacen | null = almacenLocal(), ahora = Date.now()): void {
  try {
    almacen?.setItem(CLAVE_NO_NAVEGADOR, JSON.stringify({ desde: ahora, motivo } satisfies MarcaNoNavegador));
  } catch {
    /* nada */
  }
}

export function olvidarDispositivoNoRecorta(almacen: Almacen | null = almacenLocal()): void {
  try {
    almacen?.removeItem(CLAVE_NO_NAVEGADOR);
  } catch {
    /* nada */
  }
}

/**
 * Dónde se recorta la foto que se acaba de elegir:
 *   - "formulario": en el propio formulario, antes de guardar (PC).
 *   - "movil": se guarda la original y luego se recorta en este móvil.
 *   - "sin-recorte": este móvil no puede (marcado, o sin Worker/WebAssembly):
 *     se guarda la original y se recorta luego desde otro dispositivo.
 */
export type DestinoRecorte = "formulario" | "movil" | "sin-recorte";

export function decidirRecorte(h: { seguro: boolean; disponible: boolean; noRecorta: boolean }): DestinoRecorte {
  if (h.seguro) return "formulario";
  if (!h.disponible || h.noRecorta) return "sin-recorte";
  return "movil";
}

/** ¿El error parece de falta de memoria? (entonces el dispositivo queda marcado). */
export function esFaltaDeMemoria(e: unknown): boolean {
  const err = e as { name?: string; message?: string } | null;
  if (!err) return false;
  if (err.name === "RangeError") return true;
  return /out of memory|memory|memoria|allocation|bad_alloc|std::bad_alloc/i.test(err.message ?? "");
}

/** Por qué no se pudo recortar en el móvil. Solo "memoria" marca el dispositivo. */
export type CausaFallo = "descarga" | "memoria" | "oculta" | "otro";

const RE_RED = /failed to fetch|load failed|networkerror|network connection|fetch(ing)? .*fail|conexi[oó]n|err_internet|err_network/i;

/**
 * Causa de un fallo del recorte en el móvil. `seOculto`: la página pasó a
 * segundo plano mientras recortaba (un fallo de memoria entonces no cuenta:
 * iOS aprieta a las páginas ocultas).
 */
export function causaFallo(e: unknown, opts: { seOculto?: boolean } = {}): CausaFallo {
  const err = e as { name?: string; message?: string } | null;
  if (err?.name === "ErrorDescargaModelo" || RE_RED.test(err?.message ?? "")) return "descarga";
  if (esFaltaDeMemoria(e)) return opts.seOculto ? "oculta" : "memoria";
  return "otro";
}

/** Mensaje corto (para el aviso). */
export function mensajeCorto(e: unknown, max = 90): string {
  const err = e as { name?: string; message?: string } | null;
  const t = (err?.message || String(e ?? "")).replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Frase con la causa real para el aviso al usuario (diagnóstico con el iPhone). */
export function motivoFallo(causa: CausaFallo, e?: unknown): string {
  const detalle = e === undefined ? "" : mensajeCorto(e);
  const entre = detalle ? ` (${detalle})` : "";
  switch (causa) {
    case "descarga":
      return `No se pudo descargar el recortador${entre}. Revisa la conexión.`;
    case "memoria":
      return `Este móvil se quedó sin memoria al quitar el fondo${entre}.`;
    case "oculta":
      return "Saliste del panel mientras le quitaba el fondo.";
    default:
      return `No se pudo quitar el fondo${entre}.`;
  }
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
