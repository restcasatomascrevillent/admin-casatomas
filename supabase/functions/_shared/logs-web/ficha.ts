// ============================================================================
//  Logs web · ficha en llano de una incidencia (formato elegido por el dueño)
// ----------------------------------------------------------------------------
//      Fallo del admin · Panel › Facturas
//      La clasificación automática de productos tardó demasiado y se cortó.
//      Qué pasó: … · A quién afecta: … · ¿Se arregla solo? … · Qué hacer: …
//      ▸ Detalle técnico (plegado)
//
//  Cabecera (origen con su ámbito y zona), título en llano, «qué pasó» genérico
//  con el catálogo, «a quién afecta» de lo que no es del navegador y «¿se
//  arregla solo?». Lo comparten el panel (DetalleIncidencia, lista) y el
//  ticket de Linear, así los textos son los mismos en los dos sitios.
//  Lo fijo (catálogo de funciones y tareas + causa conocida) manda; la IA, si
//  la hay, la añade quien llama como complemento marcado.
//  Reglas de sencillo.ts: aquí no entra texto libre de los logs, solo cifras,
//  nombres del catálogo y proveedores de la lista fija de origen.ts.
//  Sin Deno ni imports remotos.
// ============================================================================

import { ambitoDeError, nombreOrigen, type Ambito } from "./ambito.ts";
import { causaConocida, type CausaConocida } from "./causas.ts";
import { funcionDeError, funcionSencilla, type FuncionConocida } from "./funciones.ts";
import { NOMBRE_ORIGEN, PROVEEDORES, type OrigenVisible } from "./origen.ts";
import { conMayuscula, listaTareas, queFalloGenerico, tareasDe, vecesSencillo, zonaDePagina, type TareaSencilla } from "./sencillo.ts";

export interface DatosFicha {
  tipo: string;
  fuente: string;
  proyecto?: string | null;
  mensaje?: string | null;
  pila?: string | null;
  /** Objetivo de la muestra más reciente (o el del título «mensaje · objetivo»). */
  objetivo?: string | null;
  propiedades?: Record<string, unknown> | null;
  /** Tareas programadas de las muestras. */
  tareas?: string[] | null;
  rutas?: Array<{ ruta: string }>;
  /** Origen ya resuelto (el guardado o el calculado). */
  origen: OrigenVisible;
  proveedor?: string | null;
  ocurrencias: number;
  ocurrencias_24h: number;
  /** Ocurrencias de «versión antigua» que NO se arreglaron al recargar (20261129143000). */
  repetidas_tras_recargar?: number;
  /** La causa conocida, si quien llama ya la tiene (con los mismos datos). */
  causa?: CausaConocida | null;
}

export interface FichaSencilla {
  ambito: Ambito;
  /** «Fallo del admin», «Servicio externo · OpenAI», «Conexión del visitante»… */
  nombreOrigen: string;
  /** «Panel › Facturas», «Web › Reservas»; null si no se sabe. */
  zona: string | null;
  /** «Fallo del admin · Panel › Facturas». */
  cabecera: string;
  /** Título en llano; null si no se puede construir con el catálogo y la causa (entonces se enseña el técnico). */
  titulo: string | null;
  funcion: FuncionConocida | null;
  tareas: TareaSencilla[];
  causa: CausaConocida | null;
  /** «Qué pasó» cuando no hay causa conocida ni explicación de la IA. */
  quePasoGenerico: string;
  /** «A quién afecta» con cifras de lo que no es del navegador; null en el navegador (lo cuenta quien llama, con las sesiones). */
  aQuienAfecta: string | null;
  /** «¿Se arregla solo?»; null si no se sabe decir. */
  seArregla: string | null;
}

const PROVEEDORES_CONOCIDOS = new Set<string>([...PROVEEDORES.map((p) => p.nombre), "Supabase"]);
/** Solo los proveedores de la lista fija (un host de un recurso viene de los logs y no entra en el texto llano). */
const proveedorConocido = (p: string | null | undefined) => (p && PROVEEDORES_CONOCIDOS.has(p) ? p : null);

function zonaDe(d: DatosFicha, ambito: Ambito, funcion: FuncionConocida | null, tareas: TareaSencilla[]): string | null {
  if (d.fuente === "navegador") {
    if (ambito === "admin") return "Panel";
    return funcion?.ambito === "web" ? funcion.zona : zonaDePagina(d.rutas?.[0]?.ruta);
  }
  if (d.fuente === "hosting") return ambito === "admin" ? "Panel › Publicación" : "Web › Publicación";
  if (funcion) return funcion.zona;
  if (d.fuente === "integracion") {
    const zonas = new Set(tareas.map((t) => t.zona).filter((z): z is string => !!z));
    return zonas.size === 1 ? [...zonas][0] : "Panel › Tareas automáticas";
  }
  return null;
}

function tituloDe(d: DatosFicha, ambito: Ambito, funcion: FuncionConocida | null, tareas: TareaSencilla[], causa: CausaConocida | null, proveedor: string | null): string | null {
  if (causa?.sencillo.titulo) return causa.sencillo.titulo;
  if (d.fuente === "navegador") return d.origen === "externo" && proveedor ? `Falló un servicio de fuera en la web: ${proveedor}.` : null;
  if (funcion) return `${conMayuscula(funcion.nombre)} ${d.origen === "externo" ? `falló por un problema de ${proveedor ?? "un servicio de fuera"}` : "falló"}.`;
  if (d.fuente === "hosting") return `La publicación ${ambito === "admin" ? "del panel" : "de la web"} en Vercel falló.`;
  const conocidas = tareas.filter((t) => t.conocida);
  if (d.fuente === "integracion" && conocidas.length) {
    return tareas.length > 1 ? `Fallaron ${tareas.length} tareas automáticas.` : `Falló la tarea automática que ${conocidas[0].que}.`;
  }
  return null;
}

function aQuienAfectaDe(d: DatosFicha, ambito: Ambito, funcion: FuncionConocida | null, tareas: TareaSencilla[]): string | null {
  if (d.fuente === "navegador") return null;
  const veces = vecesSencillo(d.ocurrencias, d.ocurrencias_24h);
  if (funcion) return `${conMayuscula(funcion.afecta)}. ${veces}`;
  if (d.fuente === "hosting") {
    return `${ambito === "admin" ? "A nadie de fuera: el panel sigue con la versión anterior" : "A nadie mientras tanto: la web sigue con la versión anterior"} hasta que se publique bien. ${veces}`;
  }
  if (tareas.length) {
    const consecuencia = tareas.find((t) => t.consecuencia)?.consecuencia;
    if (consecuencia) return `Lo que se nota: ${consecuencia}. ${veces}`;
    if (tareas.every((t) => t.conocida)) return `No se nota nada: es una tarea de mantenimiento. ${veces}`;
    return `No le sale a un cliente en pantalla: es una tarea automática. ${veces}`;
  }
  return `No le sale a un cliente en pantalla: es del servidor. ${veces}`;
}

function seArreglaDe(d: DatosFicha, funcion: FuncionConocida | null, tareas: TareaSencilla[], causa: CausaConocida | null, proveedor: string | null): string | null {
  if (causa?.id === "chunk_caducado" && (d.repetidas_tras_recargar ?? 0) > 0) {
    return "No siempre: casi siempre se recarga sola, pero alguna vez siguió fallando después de recargar (eso sí hay que revisarlo).";
  }
  if (causa?.sencillo.seArregla) return causa.sencillo.seArregla;
  if (d.fuente === "navegador") return null;
  if (d.fuente === "hosting") return "No: hay que corregirlo y volver a publicar.";
  const luego = d.origen === "externo"
    ? `en cuanto ${proveedor ?? "el servicio de fuera"} vuelva a responder bien, funcionará`
    : "si el fallo es del código, seguirá fallando hasta que se corrija";
  if (funcion?.reintento) return `${conMayuscula(funcion.reintento)}; ${luego}.`;
  if (funcion?.repetir) return `No se reintenta sola: ${funcion.repetir}.`;
  const cada = tareas.find((t) => t.cada)?.cada;
  if (cada) return `La tarea se vuelve a lanzar sola ${cada}; ${luego}.`;
  return funcion ? "No consta que se reintente sola." : null;
}

/** La ficha en llano de una incidencia (o de un evento suelto). */
export function fichaSencilla(d: DatosFicha): FichaSencilla {
  const ambito = ambitoDeError(d);
  const funcion = funcionSencilla(funcionDeError(d));
  const tareas = listaTareas(tareasDe(d));
  const causa = d.causa !== undefined ? d.causa : causaConocida(d);
  const proveedor = proveedorConocido(d.proveedor);
  const nombre = d.origen === "externo" && proveedor ? `${NOMBRE_ORIGEN.externo} · ${proveedor}` : nombreOrigen(d.origen, ambito);
  const zona = zonaDe(d, ambito, funcion, tareas);
  let quePasoGenerico: string;
  if (d.fuente === "hosting") quePasoGenerico = `Falló la publicación ${ambito === "admin" ? "del panel" : "de la web"} en Vercel: lo nuevo no se ha publicado.`;
  else if (d.fuente !== "navegador" && funcion) quePasoGenerico = `Falló ${funcion.nombre}: es la función que ${funcion.hace}.`;
  else quePasoGenerico = queFalloGenerico({ tipo: d.tipo, fuente: d.fuente, rutas: d.rutas, objetivo: d.objetivo, tareas: tareas.map((t) => t.nombre), propiedades: d.propiedades });
  return {
    ambito,
    nombreOrigen: nombre,
    zona,
    cabecera: `${nombre}${zona ? ` · ${zona}` : ""}`,
    titulo: tituloDe(d, ambito, funcion, tareas, causa, proveedor),
    funcion,
    tareas,
    causa,
    quePasoGenerico,
    aQuienAfecta: aQuienAfectaDe(d, ambito, funcion, tareas),
    seArregla: seArreglaDe(d, funcion, tareas, causa, proveedor),
  };
}
