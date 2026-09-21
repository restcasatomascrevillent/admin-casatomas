// ============================================================================
// HORA DE MADRID — mismo problema que resuelve reservas-web/index.ts:114-125
// ============================================================================
// Deno Deploy (como Vercel) corre en UTC. `reservas.fecha`/`reservas.hora`
// son hora local de Madrid sin zona. Para saber si "ya pasó" una reserva
// (piezas 3 y 4) hace falta el instante UTC real, no un parseo ingenuo que
// trataría "21:00" como si fuera UTC.
//
// Misma técnica que reservas-web (documentada allí como correcta): formatear
// un instante de referencia en el huso de Madrid, comparar contra su propia
// representación UTC para obtener el offset del momento (cubre el cambio de
// hora de verano/invierno sin tabla de fechas), y aplicar ese offset.
// Reimplementada aquí de forma independiente — no se importa nada de
// reservas-web (otro agente, ver cabecera de tokens.ts).
// ============================================================================

/** Convierte fecha+hora "de pared" en Madrid (como se guardan en `reservas`)
 * al instante UTC real que representan. */
export function instanteMadridAFechaUtc(fechaIso: string, horaIso: string): Date {
  const horaCorta = (horaIso || "00:00").slice(0, 5);
  const refUtc = new Date(`${fechaIso}T${horaCorta}:00.000Z`);
  const comoMadridTexto = refUtc.toLocaleString("sv-SE", { timeZone: "Europe/Madrid" });
  const comoMadridEnUtc = new Date(comoMadridTexto.replace(" ", "T") + "Z");
  const offsetMs = refUtc.getTime() - comoMadridEnUtc.getTime();
  return new Date(refUtc.getTime() + offsetMs);
}

/** La fecha (YYYY-MM-DD) de "hoy" tal y como la vería alguien en Madrid,
 * independientemente de que el runtime esté en UTC. */
export function hoyEnMadridIso(): string {
  const texto = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Madrid" });
  return texto.split(" ")[0];
}

export function ahoraIso(): string {
  return new Date().toISOString();
}
