// «Pregúntale a la IA» a pantalla completa (Facturas › Análisis, 06/11/2026).
//
// Ruta propia dentro del panel, `/facturas/ia?c=<id de la conversación>`, para
// poder abrirla también en otra pestaña del navegador (ctrl/cmd-clic o «Abrir
// en pestaña nueva») o compartirla. En la MISMA pestaña la página de Facturas
// no se desmonta al cambiar entre `/facturas` y `/facturas/ia`: la conversación
// en curso (también una respuesta que aún no ha llegado o lo escrito en la caja)
// sigue tal cual. En otra pestaña se carga de la base de datos con `?c=`.

/** La ruta del chat a pantalla completa. */
export const RUTA_IA_COMPLETA = "/facturas/ia";
/** Parámetro de la URL con el id de la conversación abierta. */
export const PARAM_CONVERSACION = "c";

/** Lo que guarda la navegación al ir a pantalla completa desde Análisis: a qué URL se vuelve. */
export interface EstadoPantallaCompleta {
  volverA: string;
}

/** `/facturas/ia?c=<id>` (sin `?c=` si aún no hay conversación). */
export function enlacePantallaCompleta(conversacionId?: string | null): string {
  return conversacionId ? `${RUTA_IA_COMPLETA}?${PARAM_CONVERSACION}=${encodeURIComponent(conversacionId)}` : RUTA_IA_COMPLETA;
}

/** ¿Es el chat a pantalla completa? */
export const esRutaIaCompleta = (pathname: string) => pathname.replace(/\/+$/, "") === RUTA_IA_COMPLETA;

/** La URL de Análisis a la que se vuelve (la de antes, si vino de ahí; si no, Análisis a secas). */
export function destinoVolver(estado: unknown): string {
  const v = (estado as Partial<EstadoPantallaCompleta> | null)?.volverA;
  return typeof v === "string" && v.startsWith("/facturas") && !esRutaIaCompleta(v.split("?")[0]) ? v : "/facturas?tab=chat";
}

/** ¿Es un clic que el navegador debe llevar a otra pestaña o ventana (ctrl/cmd, mayúsculas, rueda)? */
export const esClicDeNuevaPestana = (e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) =>
  e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
