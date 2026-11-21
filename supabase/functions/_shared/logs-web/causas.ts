// ============================================================================
//  Logs web · causas conocidas
// ----------------------------------------------------------------------------
//  Fallos que ya se han visto y diagnosticado (informe del 10/11/2026,
//  docs/INFORME-LOGS-2026-11-10.md). Si una incidencia encaja, el ticket y el
//  panel lo dicen con la explicación y qué hacer, en vez de dejarlo solo a las
//  hipótesis de la IA (que, sin este contexto, especulaba: «problemas de red
//  entre Vercel y Supabase» para un fallo de pg_cron).
//
//  Es un HECHO de catálogo, no una hipótesis: solo se usa cuando el patrón
//  coincide literalmente. Lo comparten las funciones edge (ticket, IA) y el
//  panel (detalle de la incidencia): sin Deno ni imports remotos.
// ============================================================================

import { PATRON_CHUNK_CADUCADO, PATRON_CRON_PLATAFORMA } from "./huella.ts";
import { ACCION_DOM_AJENO, ACCION_PAGINA_TRADUCIDA, ACCION_RECUPERADA_AL_REINTENTAR, PATRON_HIDRATACION } from "./origen.ts";
import { conMayuscula, listaTareas, tareasDe, type TareaSencilla } from "./sencillo.ts";
import { funcionDeError, funcionSencilla } from "./funciones.ts";

/** La misma causa dicha para el dueño (sin jerga): qué pasa y qué hacer. */
export interface CausaSencilla {
  quePasa: string;
  queHacer: string;
  /** Título en llano de la incidencia («La clasificación automática de productos tardó demasiado y se cortó.»). */
  titulo?: string;
  /** «¿Se arregla solo?» (si la causa lo sabe decir). */
  seArregla?: string;
}

export interface CausaConocida {
  id: string;
  titulo: string;
  /** Qué está pasando, en una o dos frases (para quien lo arregla). */
  explicacion: string;
  /** Qué hacer (en orden; para quien lo arregla). */
  acciones: string[];
  /** Si se puede ignorar cuando es aislado (pocas sesiones). */
  ruidoSiAislado: boolean;
  /** Para el dueño: texto fijo en lenguaje llano. */
  sencillo: CausaSencilla;
}

export interface DatosCausa {
  tipo: string;
  fuente?: string | null;
  mensaje?: string | null;
  pila?: string | null;
  objetivo?: string | null;
  propiedades?: Record<string, unknown> | null;
  /** Tareas programadas afectadas (de las muestras), para nombrarlas en sencillo. */
  tareas?: string[] | null;
  /**
   * `accion` de UNA ocurrencia (solo al mirar eventos sueltos). En los errores de
   * carga, la web dice qué decidió: recuperado_tras_recarga, recarga_sin_efecto,
   * aviso_version_nueva, sin_version_nueva o sin_conexion (recarga-por-version.ts).
   * En una imagen de la web, recuperada_al_reintentar o sin_conexion
   * (actividad/imagen-fallida.ts); en un error de hidratación, pagina_traducida
   * (pagina-traducida.ts) o dom_ajeno (dom-ajeno.ts).
   */
  accion?: string | null;
}

interface Regla extends Omit<CausaConocida, "sencillo"> {
  coincide: (d: DatosCausa) => boolean;
  sencillo: (d: DatosCausa) => CausaSencilla;
}

/** «La tarea que retoma la lectura de facturas atascadas no arrancó a tiempo; las facturas pueden tardar más en leerse». */
function cronSencillo(tareas: TareaSencilla[]): string {
  const conocidas = tareas.filter((t) => t.conocida);
  if (!tareas.length) return "Una tarea automática no arrancó a tiempo";
  if (tareas.length === 1) {
    const t = tareas[0];
    return t.conocida ? `La tarea que ${t.que} no arrancó a tiempo${t.consecuencia ? `; ${t.consecuencia}` : ""}` : "Una tarea automática no arrancó a tiempo";
  }
  const principal = conocidas[0];
  if (!principal) return `${tareas.length} tareas automáticas no arrancaron a tiempo`;
  return `${tareas.length} tareas automáticas no arrancaron a tiempo (entre ellas, la que ${principal.que})${principal.consecuencia ? `; ${principal.consecuencia}` : ""}`;
}

/** «La tarea que …» / «N tareas automáticas …» como sujeto de un título (sin la parte de la consecuencia). */
function sujetoTareas(tareas: TareaSencilla[]): { texto: string; varias: boolean } {
  const conocidas = tareas.filter((t) => t.conocida);
  if (tareas.length > 1) return { texto: `${tareas.length} tareas automáticas`, varias: true };
  if (conocidas.length === 1) return { texto: `la tarea que ${conocidas[0].que}`, varias: false };
  return { texto: "una tarea automática", varias: false };
}

/** La base de datos canceló la consulta por tiempo (Postgres: statement_timeout / lock_timeout). */
export const PATRON_BD_TIEMPO = /canceling statement due to (?:statement|lock) timeout|statement[ _]timeout|lock[ _]timeout/i;

/** Quién falla, en llano y con el catálogo: la función, la tarea o «una operación del servidor». */
function quienFalla(d: DatosCausa): { sujeto: string; carga: string | null; seArregla: string } {
  const f = funcionSencilla(funcionDeError({ tipo: d.tipo, fuente: d.fuente, objetivo: d.objetivo, mensaje: d.mensaje }));
  if (f) {
    const seArregla = f.reintento
      ? `Sí: ${f.reintento} y no se pierde nada.`
      : f.repetir ? `No se reintenta sola: ${f.repetir}.` : "No consta que se reintente sola: si era algo importante, avisa al técnico.";
    return { sujeto: f.nombre, carga: f.carga ?? null, seArregla };
  }
  const t = listaTareas(tareasDe(d)).find((x) => x.conocida);
  if (t) return { sujeto: `la tarea que ${t.que}`, carga: null, seArregla: t.cada ? `Sí: la tarea se vuelve a lanzar sola ${t.cada} y no se pierde nada.` : "Sí: la tarea se vuelve a lanzar sola en su siguiente turno." };
  return { sujeto: "una operación del servidor", carga: null, seArregla: "No consta que se reintente sola: si se repite, avisa al técnico." };
}

const txt = (d: DatosCausa) => `${d.mensaje ?? ""}\n${d.pila ?? ""}`;
const esAssetDeDespliegue = (url: string) => /\/assets\/[^/?#]+-[A-Za-z0-9_-]{8}\.(?:m?js|css)(?:$|[?#])/.test(url);

const REGLAS: Regla[] = [
  {
    id: "hidratacion_pagina_traducida",
    titulo: "El traductor del navegador cambió la página antes de que React la hidratara",
    explicacion:
      "La página estaba traducida por el navegador (Chrome, Edge): el traductor cambia cada texto por <font>…</font> y, si lo hace antes de que React hidrate una sección (las de abajo se hidratan cuando el navegador está ocioso), el HTML ya no es el que React esperaba (#425, #418, #422). React lo recupera solo volviendo a pintar esa sección y el traductor la vuelve a traducir. No es un fallo de la web ni tiene arreglo en React (facebook/react#11538).",
    acciones: ["Nada: lo provoca el traductor del navegador del visitante."],
    ruidoSiAislado: true,
    sencillo: () => ({
      quePasa: "El visitante tenía la página traducida por su navegador y la página se volvió a dibujar al cargar. No es un fallo de la web: se ve y funciona bien.",
      queHacer: "Nada: lo provoca el traductor del navegador del visitante.",
      titulo: "El traductor del navegador hizo que la página se dibujara dos veces.",
      seArregla: "Sí: la página se vuelve a dibujar sola, ya traducida.",
    }),
    coincide: (d) => d.accion === ACCION_PAGINA_TRADUCIDA && PATRON_HIDRATACION.test(txt(d)),
  },
  {
    id: "hidratacion_dom_ajeno",
    titulo: "Algo del navegador cambió la página antes de que React la hidratara",
    explicacion:
      "Mientras cargaba, algo que no es la web (un traductor sin rastro conocido como el de Safari, una extensión o el propio navegador) cambió el HTML que React aún no había reclamado; la web lo ve con un vigilante en los primeros segundos y dice qué cambió en `componente`. React lo recupera solo volviendo a pintar esa parte. No es un fallo de la web.",
    acciones: ["Nada: lo provoca el navegador del visitante. Si `componente` muestra un texto nuestro cambiado por otro idioma, era un traductor."],
    ruidoSiAislado: true,
    sencillo: () => ({
      quePasa: "El navegador del visitante cambió la página mientras cargaba (un traductor o una extensión) y la página se volvió a dibujar. No es un fallo de la web: se ve y funciona bien.",
      queHacer: "Nada: lo provoca el navegador del visitante.",
      titulo: "El navegador del visitante cambió la página mientras cargaba.",
      seArregla: "Sí: la página se vuelve a dibujar sola.",
    }),
    coincide: (d) => d.accion === ACCION_DOM_AJENO && PATRON_HIDRATACION.test(txt(d)),
  },
  {
    id: "imagen_recuperada_al_reintentar",
    titulo: "Una imagen no cargó a la primera y sí al volver a pedirla",
    explicacion:
      "La imagen está en la web, pero la primera petición falló (normalmente, la conexión del visitante se cortó un momento). La web la vuelve a pedir una vez y, al cargar, la repinta: el visitante la ve. No es un fallo de la web.",
    acciones: ["Nada si son casos sueltos. Si fueran muchas sesiones a la vez, mirar el estado de Vercel."],
    ruidoSiAislado: true,
    sencillo: () => ({
      quePasa: "Una imagen no cargó a la primera porque la conexión del visitante falló un momento; la web la volvió a pedir y se vio bien.",
      queHacer: "Nada: es la conexión del visitante.",
      titulo: "Una imagen tardó en cargar por la conexión del visitante.",
      seArregla: "Sí: la web la vuelve a pedir sola.",
    }),
    coincide: (d) => d.tipo === "error_recurso" && d.accion === ACCION_RECUPERADA_AL_REINTENTAR,
  },
  {
    id: "carga_sin_conexion",
    titulo: "El visitante se quedó sin conexión mientras cargaba la página",
    explicacion: "Falló la carga de una parte de la web y el navegador estaba sin conexión: la web no recarga en ese caso. No es un fallo de la web.",
    acciones: ["Nada: es la red del visitante."],
    ruidoSiAislado: true,
    sencillo: () => ({
      quePasa: "El visitante se quedó sin conexión mientras cargaba la página. No es un fallo de la web.",
      queHacer: "Nada: es la conexión del visitante.",
      titulo: "El visitante se quedó sin conexión mientras cargaba la página.",
      seArregla: "Sí, en cuanto el visitante recupera la conexión.",
    }),
    coincide: (d) => d.accion === "sin_conexion",
  },
  {
    id: "carga_sin_version_nueva",
    titulo: "Falló la carga de una parte de la web sin que hubiera una versión nueva",
    explicacion:
      "La web no pudo cargar un fichero (JS/CSS) y comprobó que no había una publicación nueva, así que no recargó: o falló la red del visitante o falta de verdad un fichero en la versión publicada.",
    acciones: [
      "Si se repite en varias sesiones, comprobar que el fichero existe en el despliegue actual de Vercel y volver a publicar.",
      "Si son casos sueltos, es la red del visitante.",
    ],
    ruidoSiAislado: true,
    sencillo: () => ({
      quePasa: "Una parte de la web no se pudo cargar y no era por una publicación: o falló la conexión del visitante o falta un fichero en la web publicada.",
      queHacer: "Si se repite en varias personas, avisa al técnico. Si son casos sueltos, es la conexión del visitante.",
      titulo: "Una parte de la web no se pudo cargar.",
    }),
    coincide: (d) => d.accion === "sin_version_nueva",
  },
  {
    id: "chunk_caducado",
    titulo: "Fichero de una versión anterior de la web (tras publicar)",
    explicacion:
      "El visitante tenía abierta la web antes de una publicación y, al navegar, su navegador pidió un fichero (JS/CSS) de la versión vieja que ya no existe. No es un fallo del código de la página que nombra el error.",
    acciones: [
      "En la web pública: escuchar `vite:preloadError` (y los errores de import dinámico) y recargar la página una sola vez, guardando un aviso en sessionStorage para no entrar en bucle.",
      "Si aparece justo después de publicar y luego para, es esperado: se puede marcar resuelta.",
    ],
    ruidoSiAislado: true,
    sencillo: () => ({
      quePasa: "La página tenía una versión antigua abierta justo cuando publicamos; se recarga sola.",
      queHacer: "Nada: es normal justo después de publicar. Solo hay que avisar al técnico si sale «se repite tras recargar».",
      titulo: "Página antigua abierta justo cuando publicamos.",
      seArregla: "Sí: la página se recarga sola con la versión nueva.",
    }),
    coincide: (d) =>
      (["error_js", "error_promesa", "error_react"].includes(d.tipo) && PATRON_CHUNK_CADUCADO.test(txt(d)))
      || (d.tipo === "error_recurso" && esAssetDeDespliegue(String(d.objetivo ?? ""))),
  },
  {
    id: "cron_plataforma",
    titulo: "pg_cron no pudo arrancar las tareas (base de datos saturada o en mantenimiento)",
    explicacion:
      "«job startup timeout» lo da pg_cron cuando no consigue abrir la conexión para lanzar la tarea a tiempo: falla a la vez en todas las tareas, no por culpa de ninguna. Suele coincidir con la base de datos saturada (conexiones o CPU), una migración o restauración larga, o un mantenimiento de Supabase.",
    acciones: [
      "Mirar en Supabase › Reports la CPU y las conexiones de esa franja, y el estado de Supabase (status.supabase.com).",
      "Si se repite: espaciar las tareas más frecuentes (reanudar-trabajos-ocr va cada minuto) o activar cron.use_background_workers.",
      "Las tareas se vuelven a lanzar solas en el siguiente turno: comprobar que no queda trabajo atascado (OCR, Instagram, emails).",
    ],
    ruidoSiAislado: false,
    sencillo: (d) => {
      const tareas = listaTareas(tareasDe(d));
      const s = sujetoTareas(tareas);
      const cada = tareas.length === 1 ? tareas[0].cada : null;
      return {
        quePasa: `${cronSencillo(tareas)}. No es culpa de la tarea: en ese momento la base de datos estaba saturada o en mantenimiento.`,
        queHacer: "Nada si no se repite: se vuelve a lanzar sola en unos minutos. Si pasa a menudo, avisa al técnico (habría que espaciar las tareas o revisar la base de datos).",
        titulo: `${conMayuscula(s.texto)} no ${s.varias ? "arrancaron" : "arrancó"} a tiempo.`,
        seArregla: cada ? `Sí: la tarea se vuelve a lanzar sola ${cada}.` : "Sí: cada tarea se vuelve a lanzar sola en su siguiente turno.",
      };
    },
    coincide: (d) => d.tipo === "error_integracion" && PATRON_CRON_PLATAFORMA.test(d.mensaje ?? ""),
  },
  {
    id: "bd_tiempo_agotado",
    titulo: "La base de datos canceló la operación por tardar demasiado (statement_timeout / lock_timeout)",
    explicacion:
      "Postgres cancela una consulta cuando pasa de statement_timeout o espera un bloqueo más de lock_timeout («canceling statement due to statement/lock timeout»). Suele coincidir con la base de datos muy cargada (muchas escrituras a la vez, otra operación larga bloqueando las mismas filas) o con una consulta que se ha vuelto lenta.",
    acciones: [
      "Si es suelto y la función o la tarea se reintenta sola, nada: no se pierde trabajo.",
      "Si se repite: mirar en Supabase › Reports la CPU, las conexiones y las consultas lentas de esa franja, y revisar la consulta o RPC nombrada en el mensaje (índices, lotes más pequeños o menos trabajo por llamada).",
    ],
    ruidoSiAislado: false,
    sencillo: (d) => {
      const q = quienFalla(d);
      return {
        quePasa: `La base de datos iba muy cargada y ${q.sujeto} tardó más de lo permitido, así que se canceló.${q.carga ? ` ${conMayuscula(q.carga)}.` : ""}`,
        queHacer: "Nada si es suelto. Si se repite, avisa al técnico.",
        titulo: `${conMayuscula(q.sujeto)} tardó demasiado y se cortó.`,
        seArregla: q.seArregla,
      };
    },
    coincide: (d) => (d.tipo === "error_servidor" || d.tipo === "error_integracion") && PATRON_BD_TIEMPO.test(txt(d)),
  },
  {
    id: "react_hidratacion",
    titulo: "React no pudo «hidratar» el HTML pre-renderizado (errores #418/#423/#425)",
    explicacion:
      "El HTML que se sirve ya pintado no coincide con lo que React pinta en el navegador (fechas u horas, textos que dependen del idioma o de datos que llegan después, o algo que cambió la página antes de hidratar: un traductor o el navegador convirtiendo cifras en teléfonos). React lo vuelve a pintar entero: la página funciona, pero tarda más.",
    acciones: [
      "Mirar el origen de las ocurrencias: las que vienen con la página traducida por el navegador (`pagina_traducida`) son «Navegador o extensión» y no hay que hacer nada con ellas.",
      "Reproducir con la versión sin minificar (`npm run dev`) para ver el aviso completo y el componente.",
      "Mover a un useEffect lo que dependa del navegador (fecha actual, localStorage, idioma) o renderizarlo solo en cliente.",
    ],
    ruidoSiAislado: false,
    sencillo: () => ({
      quePasa: "La página se dibuja dos veces al cargar (lo que llega ya preparado no coincide con lo que pinta el navegador). Funciona, pero tarda un poco más.",
      queHacer: "No es urgente: avisa al técnico para que lo corrija cuando pueda.",
      titulo: "La página se dibuja dos veces al cargar.",
      seArregla: "No, pero la página funciona: solo tarda un poco más.",
    }),
    coincide: (d) => /minified react error #(418|423|425)\b|hydrat/i.test(txt(d)),
  },
  {
    id: "peticion_sin_respuesta",
    titulo: "Petición sin respuesta (estado 0)",
    explicacion:
      "El navegador no llegó a recibir respuesta: suele ser la red del visitante, que cerró o cambió de página mientras cargaba, o un bot. Solo es un problema si se repite en muchas sesiones o a la vez en todos (entonces es el servidor).",
    acciones: [
      "Si afecta a pocas sesiones, ignorarla.",
      "Si son muchas a la vez: revisar el estado de Supabase y los logs de la función o tabla nombrada.",
    ],
    ruidoSiAislado: true,
    sencillo: () => ({
      quePasa: "La web pidió datos al servidor y no llegó respuesta. Casi siempre es la conexión del visitante (se quedó sin cobertura o cambió de página mientras cargaba).",
      queHacer: "Nada si son pocos casos. Si salen muchos a la vez, el problema es del servidor: avisa al técnico.",
      titulo: "La web pidió datos al servidor y no le llegó respuesta.",
      seArregla: "Normalmente sí: casi siempre es la conexión del visitante.",
    }),
    coincide: (d) => d.tipo === "error_peticion" && (Number(d.propiedades?.status) === 0 || /^sin respuesta/i.test(d.mensaje ?? "")),
  },
  {
    id: "dns_host_inexistente",
    titulo: "Una función llama a un servidor que ya no existe",
    explicacion:
      "La función intenta conectar con un dominio que no resuelve (DNS): suele ser una URL fija de un proyecto antiguo de Supabase o de un servicio dado de baja.",
    acciones: [
      "Buscar la URL en el código de la función y sustituirla por la variable de entorno correspondiente, o retirar la llamada.",
    ],
    ruidoSiAislado: false,
    sencillo: (d) => {
      const f = funcionSencilla(funcionDeError({ tipo: d.tipo, fuente: d.fuente, objetivo: d.objetivo, mensaje: d.mensaje }));
      return {
        quePasa: "Una función del servidor intenta conectar con una dirección que ya no existe (un servicio antiguo dado de baja).",
        queHacer: "Avisa al técnico: hay que cambiar esa dirección o quitar la llamada.",
        titulo: `${conMayuscula(f?.nombre ?? "una función del servidor")} intentó conectar con una dirección que ya no existe.`,
        seArregla: "No: seguirá fallando hasta que el técnico lo corrija.",
      };
    },
    coincide: (d) => /dns error|failed to lookup address|ENOTFOUND|name or service not known/i.test(txt(d)),
  },
  {
    id: "falta_secreto",
    titulo: "Falta un secreto o una clave en el servidor",
    explicacion: "La función se ejecutó sin una variable de entorno (secreto) que necesita y respondió con error.",
    acciones: [
      "Comprobar en Supabase › Edge Functions › Secrets que el secreto nombrado existe en este entorno.",
      "Si es una petición sin firma (bots o sondeos), se puede ignorar.",
    ],
    ruidoSiAislado: false,
    sencillo: (d) => {
      const f = funcionSencilla(funcionDeError({ tipo: d.tipo, fuente: d.fuente, objetivo: d.objetivo, mensaje: d.mensaje }));
      return {
        quePasa: "A una función del servidor le falta una clave para funcionar.",
        queHacer: "Avisa al técnico para que añada la clave que falta en Supabase. Si son robots probando la función sin firma, se puede ignorar.",
        titulo: `${conMayuscula(f?.nombre ?? "una función del servidor")} no pudo funcionar: falta una clave en el servidor.`,
        seArregla: "No: seguirá fallando hasta que el técnico lo corrija.",
      };
    },
    coincide: (d) => /falta_secreto|falta (el )?secreto|falta firma|missing (secret|api key)/i.test(txt(d)),
  },
];

/** Causa conocida que encaja con la incidencia o el evento, o null. */
export function causaConocida(d: DatosCausa): CausaConocida | null {
  const r = REGLAS.find((x) => {
    try {
      return x.coincide(d);
    } catch {
      return false;
    }
  });
  if (!r) return null;
  const { coincide: _c, sencillo, ...causa } = r;
  let textoSencillo: CausaSencilla;
  try {
    textoSencillo = sencillo(d);
  } catch {
    textoSencillo = { quePasa: causa.explicacion, queHacer: causa.acciones[0] ?? "" };
  }
  return { ...causa, sencillo: textoSencillo };
}

export const IDS_CAUSAS = REGLAS.map((r) => r.id);
