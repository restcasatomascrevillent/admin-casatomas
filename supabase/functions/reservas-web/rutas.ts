// ============================================================================
// RUTAS DE reservas-web — tabla de rutas + guarda del secreto compartido
// ============================================================================
// Módulo PURO (cero imports), igual que `plantillas.ts`: se separa del
// `serve(...)` de index.ts para poder probar con vitest qué rutas existen sin
// arrastrar los imports `https://...` que Node no resuelve.
//
// 2026-09-30 — SE RETIRA `POST /notificar-estado`. Mandaba el correo
// "Estado de reserva" (confirma asistencia / sin disponibilidad) a CUALQUIER
// reserva cuyo id se le pasara, y su única guarda era `checkSharedSecret`,
// que deja pasar todo cuando `RESERVAS_WEB_SHARED_SECRET` no está definido
// (y en producción no lo está). O sea: ruta pública que manda correos en
// nombre del restaurante. No tenía llamadores en ninguno de los 4 repos
// (`notify-reservation-change` se repuntó a `emails-reserva/notificar`), y
// el 2026-09-29 entre 19:12 y 19:17 salieron 7 correos "Estado de reserva"
// sin explicación. Ahora esa ruta responde 404 como cualquier otra
// desconocida. Si algún día hace falta volver a mandar ese correo, el sitio
// es `emails-reserva/notificar` (falla CERRADO sin su secreto), no aquí.
// ============================================================================

export type RutaReservasWeb =
  | "disponibilidad"
  | "crear"
  | "cierres"
  | "confirmar"
  | "cancelar"
  | "cancelar/ejecutar";

/** Única fuente de verdad de las rutas que atiende la función. Todas son
 * PÚBLICAS: las dos POST las llama el navegador desde casa-tomas-story /
 * touza-restaurant-website, y las tres GET son enlaces de correo que se
 * autentican con su propio token HMAC (`verifyReservaToken` en index.ts). */
export const RUTAS_RESERVAS_WEB: ReadonlyArray<{ metodo: "GET" | "POST"; ruta: RutaReservasWeb }> = [
  { metodo: "POST", ruta: "disponibilidad" },
  { metodo: "POST", ruta: "crear" },
  { metodo: "POST", ruta: "cierres" },
  { metodo: "GET", ruta: "confirmar" },
  { metodo: "GET", ruta: "cancelar" },
  { metodo: "GET", ruta: "cancelar/ejecutar" },
];

/** Parte de la URL detrás de `reservas-web/` (o el path entero si no
 * aparece ese segmento), sin barras de sobra. Mismo cálculo que hacía el
 * router de index.ts; se devuelve también para el cuerpo del 404. */
export function rutaDelPath(pathname: string): string {
  const segmentos = pathname.split("/").filter(Boolean);
  const idx = segmentos.indexOf("reservas-web");
  return (idx === -1 ? segmentos : segmentos.slice(idx + 1)).join("/");
}

/** Qué ruta atiende una petición, o `null` -> 404. */
export function resolverRuta(metodo: string, pathname: string): RutaReservasWeb | null {
  const ruta = rutaDelPath(pathname);
  const encontrada = RUTAS_RESERVAS_WEB.find((r) => r.metodo === metodo && r.ruta === ruta);
  return encontrada ? encontrada.ruta : null;
}

/** Guarda OPCIONAL de `/disponibilidad` y `/crear`.
 *
 * Falla ABIERTO a propósito, y así debe seguir: esas dos rutas las llama el
 * navegador, que NO manda `x-webhook-secret` (un secreto metido en un bundle
 * público no es secreto; ver docs/DESPLIEGUE.md). Si fallara cerrado con el
 * secreto sin definir —como está en producción— las reservas web darían 401.
 *
 * Por eso esta guarda NUNCA debe proteger una ruta con efectos que no deban
 * ser públicos (mandar correos a terceros, mutar reservas ajenas...). Esa fue
 * justo la falla de `/notificar-estado`. Una ruta así necesita una guarda que
 * falle CERRADO, como `comprobarSecretoCompartido` de emails-reserva. */
export function secretoCompartidoValido(secretoConfigurado: string, cabecera: string | null): boolean {
  if (!secretoConfigurado) return true;
  return cabecera === secretoConfigurado;
}
