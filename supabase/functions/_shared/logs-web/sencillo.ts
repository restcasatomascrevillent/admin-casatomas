// ============================================================================
//  Logs web · explicación en sencillo (para quien no es técnico)
// ----------------------------------------------------------------------------
//  Frases cortas en español llano a partir de los DATOS de una incidencia:
//  qué pasa, a quién afecta, desde cuándo y qué hacer. Las usa el ticket de
//  Linear (arriba del todo, antes de los detalles técnicos).
//
//  Aquí no entra ningún texto de los logs (mensajes, pilas, rutas
//  desconocidas): solo cifras, fechas y nombres conocidos. Lo que venga de los
//  logs lo añade quien llama, con su propio escapado (en el ticket, como
//  código). Sin Deno ni imports remotos: lo comparten funciones y panel.
// ============================================================================

export interface DatosSencillos {
  tipo: string;
  fuente: string;
  gravedad: string;
  ocurrencias: number;
  ocurrencias_24h: number;
  sesiones_afectadas: number;
  primera_vez: string;
  ultima_vez: string;
  rutas: Array<{ ruta: string; n: number }>;
  version_primera: string | null;
  version_ultima: string | null;
  reabierta_veces: number;
}

/** Qué es cada tipo de error, dicho en llano (sin el detalle concreto). */
export const TIPO_SENCILLO: Record<string, string> = {
  error_js: "un fallo en el código de la página",
  error_promesa: "un fallo en el código de la página (una operación que no terminó bien)",
  error_recurso: "una imagen, un estilo o un fichero de la página no cargó",
  error_peticion: "la web pidió datos al servidor y no obtuvo respuesta (o recibió un error)",
  error_react: "una parte de la página no se pudo mostrar",
  error_404: "alguien abrió una dirección de la web que no existe",
  error_servidor: "una función del servidor falló",
  error_integracion: "una tarea automática o la conexión con otro servicio falló",
  error_despliegue: "una publicación de la web en Vercel falló",
};

const PAGINAS: Array<[RegExp, string]> = [
  [/^\/?$/, "la portada"],
  [/^\/carta\/vinos/, "la carta de vinos"],
  [/^\/carta\/bebidas/, "la carta de bebidas"],
  [/^\/carta\/[^/]+/, "una sección de la carta"],
  [/^\/carta\/?$/, "la carta"],
  [/^\/reserva\/respuesta/, "la respuesta a una reserva"],
  [/^\/reservas?/, "la página de reservas"],
  [/^\/regala/, "la página de cheques regalo"],
  [/^\/tienda/, "la tienda"],
  [/^\/contacto/, "contacto y horarios"],
  [/^\/el-restaurante/, "la página del restaurante"],
  [/^\/touza/, "la página de Touza"],
  [/^\/newsletter/, "la baja de la newsletter"],
  [/^\/super-admin|^\/panel|^\/admin/, "el panel"],
];

/** Nombre llano de una página conocida de la web («/carta/vinos» → «la carta de vinos»), o null. */
export function nombrePagina(ruta: string | null | undefined): string | null {
  if (ruta === null || ruta === undefined) return null;
  const sinIdioma = ruta.replace(/^\/(en|fr)(?=\/|$)/, "") || "/";
  const limpia = sinIdioma.split(/[?#]/)[0];
  for (const [re, nombre] of PAGINAS) if (re.test(limpia)) return nombre;
  return null;
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

export const esDeNavegador = (fuente: string) => fuente === "navegador";

/** «A quién afecta», solo con cifras (sin textos de los logs). */
export function aQuienAfectaSencillo(i: DatosSencillos): string {
  if (!esDeNavegador(i.fuente)) {
    return `No le sale a un cliente en pantalla: es del servidor. Ha pasado ${plural(i.ocurrencias, "vez", "veces")} (${i.ocurrencias_24h} en las últimas 24 h).`;
  }
  if (i.sesiones_afectadas === 0) return "A nadie de verdad: solo lo han provocado robots o pruebas automáticas.";
  const hoy = i.ocurrencias_24h > 0 ? `${plural(i.ocurrencias_24h, "vez", "veces")} en las últimas 24 h` : "ninguna vez en las últimas 24 h";
  const critico = i.gravedad === "critico" ? " Es grave: puede impedir reservar o pagar." : "";
  return `A ${plural(i.sesiones_afectadas, "visitante", "visitantes")} (${plural(i.ocurrencias, "vez", "veces")} en total; ${hoy}).${critico}`;
}

/** «Desde cuándo»: primera y última vez, versión y reapariciones. */
export function desdeCuandoSencillo(i: DatosSencillos, fecha: (iso: string) => string): string {
  const version = i.version_primera ? ` (versión ${i.version_primera}${i.version_ultima && i.version_ultima !== i.version_primera ? `; sigue en la ${i.version_ultima}` : ""})` : "";
  const reabierta = i.reabierta_veces > 0 ? ` Volvió ${plural(i.reabierta_veces, "vez", "veces")} después de darse por resuelta.` : "";
  return `Desde el ${fecha(i.primera_vez)}${version}. La última vez, el ${fecha(i.ultima_vez)}.${reabierta}`;
}

/** «Qué hacer» cuando no hay una causa conocida ni propuesta de la IA. */
export function queHacerPorDefecto(i: DatosSencillos): string {
  if (i.tipo === "error_404") return "Revisar si algún enlace (de la web, Google o una campaña) apunta a esa dirección y corregirlo o redirigirlo.";
  if (i.tipo === "error_despliegue") return "Abrir el despliegue en Vercel, leer por qué falló la publicación y volver a publicar cuando esté corregido.";
  if (!esDeNavegador(i.fuente)) return "Revisar los registros de esa función o tarea a la hora indicada y corregir la causa; luego marcar la incidencia como resuelta.";
  return "Reproducirlo con los pasos de abajo, corregirlo y, cuando se publique el arreglo, marcar la incidencia como resuelta (si vuelve, se reabre sola).";
}

/** Primera letra en mayúscula. */
export const conMayuscula = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);
