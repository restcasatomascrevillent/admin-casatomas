// ============================================================================
//  Logs web · huella estable de un error (para agrupar repeticiones)
// ----------------------------------------------------------------------------
//  La misma huella = la misma incidencia. Tiene que ser IGUAL para dos
//  repeticiones del mismo fallo aunque cambien:
//    · números, ids, comillas con datos ('x' de undefined), horas;
//    · el hash del fichero de Vite (index-B7x9Qa.js → index.js) y la
//      línea/columna (cada despliegue las mueve);
//    · la consulta de la URL.
//  …y DISTINTA si cambia el tipo de error, el mensaje normalizado, la función
//  donde salta o, para 404/recursos/peticiones, la ruta o el endpoint.
//  La calcula siempre el servidor: nunca se acepta una huella del navegador.
// ============================================================================

import { urlSinConsulta } from "./saneado.ts";

/**
 * Quita el hash de Vite de un nombre de fichero (`app-C0ct-iG8.js` → `app.js`).
 * El hash son 8 caracteres base64url, que PUEDEN llevar «-» y «_»: antes no se
 * contaba el guion y `app-C0ct-iG8.js` daba una huella nueva en cada despliegue
 * (incidencias duplicadas del mismo fallo; visto en la demo el 09/11/2026).
 */
export function quitarHashVite(texto: string): string {
  return texto.replace(/-[A-Za-z0-9_-]{8}(?=\.(?:m?js|css|avif|webp|png|jpe?g|gif|svg|woff2?)\b)/g, "");
}

/**
 * Fichero de una versión anterior que ya no existe tras publicar (el navegador
 * tenía abierta la web vieja). Todos estos mensajes son el MISMO problema, sea
 * cual sea el fichero o el tipo (excepción, promesa o pintado de React).
 */
export const PATRON_CHUNK_CADUCADO =
  /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|unable to preload css|chunkloaderror|loading (css )?chunk \S+ failed|'text\/html' is not a valid javascript mime type/i;

/**
 * Fallos de pg_cron que no dependen de la tarea sino de la base de datos
 * (no pudo arrancar ninguna): una sola incidencia para todas las tareas, no una
 * por tarea (el 08/11/2026 se abrieron 6 tickets por la misma caída).
 */
export const PATRON_CRON_PLATAFORMA =
  /job startup timeout|could not start background process|out of background worker slots|too many (clients|connections)|remaining connection slots are reserved|the database system is (starting up|shutting down|in recovery mode)/i;

/**
 * Nota que la web añade al final del mensaje de un error de carga cuando
 * decide recargar o no (web-casatomas, src/lib/recarga-por-version.ts,
 * MARCAS): « · recuperado: la pestaña se recargó sola con la versión nueva
 * (antes: v1.11.0 · build …)», « · sin conexión: no se recargó»… La decisión
 * va también en `accion`. Para la huella se quita: si no, cada build daría
 * una incidencia distinta del mismo fallo.
 */
export const NOTA_RECARGA =
  /\s*·\s*(?:recuperado: la pestaña se recargó sola|se recargó sola pero siguió|sin segunda recarga: se le pidió|no había versión nueva|sin conexión: no se recargó)[\s\S]*$/i;

export const quitarNotaRecarga = (mensaje: string | null | undefined): string | null | undefined =>
  typeof mensaje === "string" ? mensaje.replace(NOTA_RECARGA, "") : mensaje;

/** Mensaje normalizado: sin números, sin contenido entre comillas, sin URLs con consulta. */
export function normalizarMensaje(mensaje: string | null | undefined): string {
  if (!mensaje) return "";
  return mensaje
    .replace(/\bhttps?:\/\/[^\s"'<>()]+/gi, (u) => quitarHashVite(urlSinConsulta(u)))
    .replace(/(["'`])(?:(?!\1).){0,200}\1/g, "$1…$1")
    .replace(/\[(id|num|tel|token|email|oculto)\]/g, "#")
    .replace(/\b0x[0-9a-f]+\b/gi, "#")
    .replace(/\d+(\.\d+)?/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 300);
}

/**
 * Primer marco «propio» de la pila: fichero sin hash ni línea/columna y
 * nombre de la función. Se saltan los marcos de node_modules/extensiones.
 */
export function marcoPrincipal(pila: string | null | undefined): string {
  if (!pila) return "";
  for (const linea of pila.split("\n")) {
    const l = linea.trim();
    if (!l || /node_modules|chrome-extension|moz-extension|<anonymous>|native code/i.test(l)) continue;
    // Chrome: "at fn (https://x/assets/index-Ab12.js:1:234)"  ·  Firefox/Safari: "fn@https://x/assets/a.js:1:2"
    const m = /(?:at\s+([^\s(]+)\s+\()?((?:https?:\/\/[^\s)]+?|\/[^\s)]+?|[\w./-]+\.(?:m?[jt]sx?)))(?::\d+){0,2}\)?$/.exec(l)
      ?? /^([^@]*)@(.+?)(?::\d+){0,2}$/.exec(l);
    if (!m) continue;
    const funcion = (m[1] ?? "").replace(/^Object\./, "").slice(0, 80);
    let fichero = m[2] ?? "";
    fichero = urlSinConsulta(fichero).replace(/^https?:\/\/[^/]+/, "");
    fichero = quitarHashVite(fichero);
    if (!fichero) continue;
    return `${funcion}@${fichero}`;
  }
  return "";
}

/** Ruta como plantilla: los segmentos variables ya vienen como :id desde sanearRuta. */
const rutaPlantilla = (ruta: string | null | undefined): string => (ruta ?? "").toLowerCase();

export interface DatosHuella {
  tipo: string;
  fuente: string;
  mensaje?: string | null;
  pila?: string | null;
  ruta?: string | null;
  /** Endpoint (peticiones), recurso (imágenes/scripts), función o integración. */
  objetivo?: string | null;
  codigo?: string | number | null;
}

/** Texto canónico que se resume en la huella (exportado para las pruebas). */
export function textoHuella(datos: DatosHuella): string {
  const d = { ...datos, mensaje: quitarNotaRecarga(datos.mensaje) };
  const partes = [d.fuente, d.tipo];
  // Fichero caducado tras publicar: misma incidencia aunque cambien el fichero o el tipo.
  if (["error_js", "error_promesa", "error_react"].includes(d.tipo) && PATRON_CHUNK_CADUCADO.test(d.mensaje ?? "")) {
    return [d.fuente, "chunk_caducado"].join("|");
  }
  if (d.tipo === "error_integracion" && String(d.objetivo ?? "").startsWith("cron:") && PATRON_CRON_PLATAFORMA.test(d.mensaje ?? "")) {
    return [d.fuente, d.tipo, "cron:*", normalizarMensaje(d.mensaje)].join("|");
  }
  switch (d.tipo) {
    case "error_404":
      // Un 404 es «esta ruta no existe»: la ruta ES el problema.
      partes.push(rutaPlantilla(d.ruta));
      break;
    case "error_recurso":
      partes.push(quitarHashVite(urlSinConsulta(d.objetivo ?? "")));
      break;
    case "error_peticion":
      partes.push(String(d.objetivo ?? ""), String(d.codigo ?? ""));
      break;
    case "error_servidor":
    case "error_integracion":
    case "error_despliegue":
      partes.push(String(d.objetivo ?? ""), String(d.codigo ?? ""), normalizarMensaje(d.mensaje));
      break;
    default:
      partes.push(normalizarMensaje(d.mensaje), marcoPrincipal(d.pila));
      // Sin pila (Safari a veces), la ruta ayuda a no mezclar fallos distintos con el mismo mensaje genérico.
      if (!d.pila) partes.push(rutaPlantilla(d.ruta));
  }
  return partes.join("|");
}

async function sha256Hex(texto: string): Promise<string> {
  const datos = new TextEncoder().encode(texto);
  const resumen = await crypto.subtle.digest("SHA-256", datos);
  return Array.from(new Uint8Array(resumen), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Huella de 32 caracteres hexadecimales. */
export async function calcularHuella(d: DatosHuella): Promise<string> {
  return (await sha256Hex(textoHuella(d))).slice(0, 32);
}

/** HMAC-SHA256 en hexadecimal (límite por IP: nunca se guarda la IP). */
export async function hmacHex(clave: string, texto: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(clave), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(firma), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** UUID determinista (v4 de forma) a partir de un texto: eventos de recolectores sin duplicados. */
export async function uuidDeTexto(texto: string): Promise<string> {
  const h = await sha256Hex(texto);
  const v = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
  return v;
}
