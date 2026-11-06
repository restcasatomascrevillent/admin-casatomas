/**
 * Líneas de <EstadoLectura /> (PartesTarjetaCarta): lo que dicen los interruptores de una tarjeta
 * de la carta, en texto, para quien solo tiene «Ver» (06/11/2026).
 */
export interface LineaEstado {
  texto: string;
  /** «apagado» en rojo (no sale en la web), «aviso» en ámbar (falta el origen del vino). */
  tono?: "normal" | "apagado" | "aviso";
}

/** «Activo (se publica en la web)» / «Despublicado (no sale en la web)», como el interruptor. */
export const lineaActivado = (activado: boolean | null | undefined) =>
  activado === false
    ? { texto: "Despublicado (no sale en la web)", tono: "apagado" as const }
    : { texto: "Activo (se publica en la web)" };

/** «Casa Tomás: sí · Touza: no» (bebidas y cócteles). */
export const lineaCartas = (restaurante: boolean | null | undefined, touza: boolean | null | undefined) => ({
  texto: `Casa Tomás: ${restaurante ? "sí" : "no"} · Touza: ${touza ? "sí" : "no"}`,
});

/** Solo si la foto se ve grande en la carta de la web. */
export const lineaFotoExpandida = (imagenUrl: string | null | undefined, expanded: boolean | null | undefined) =>
  Boolean(imagenUrl?.trim()) && expanded === true && { texto: "Foto expandida en la carta web" };
