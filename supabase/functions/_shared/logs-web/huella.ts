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

/** Mensaje normalizado: sin números, sin contenido entre comillas, sin URLs con consulta. */
export function normalizarMensaje(mensaje: string | null | undefined): string {
  if (!mensaje) return "";
  return mensaje
    .replace(/\bhttps?:\/\/[^\s"'<>()]+/gi, (u) => urlSinConsulta(u).replace(/-[A-Za-z0-9_]{6,12}(\.(m?js|css))/g, "$1"))
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
    fichero = fichero.replace(/-[A-Za-z0-9_]{6,12}(\.(m?js|css))$/, "$1");
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
export function textoHuella(d: DatosHuella): string {
  const partes = [d.fuente, d.tipo];
  switch (d.tipo) {
    case "error_404":
      // Un 404 es «esta ruta no existe»: la ruta ES el problema.
      partes.push(rutaPlantilla(d.ruta));
      break;
    case "error_recurso":
      partes.push(urlSinConsulta(d.objetivo ?? "").replace(/-[A-Za-z0-9_]{6,12}(\.(m?js|css))$/, "$1"));
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
