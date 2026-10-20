/** Fechas civiles de Casa Tomás: el cheque vale durante todo su último día. */
export function hoyMadrid(ahora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora);
}

/** Solo para ejemplos; la fecha definitiva siempre la asigna PostgreSQL al emitir. */
export function calcularCaducidad(meses = 12, ahora = new Date()): string {
  meses = Number.isInteger(meses) && meses >= 1 && meses <= 120 ? meses : 12;
  const [ano, mes, dia] = hoyMadrid(ahora).split("-").map(Number);
  const destino = new Date(Date.UTC(ano, mes - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0)).getUTCDate();
  destino.setUTCDate(Math.min(dia, ultimo));
  return destino.toISOString().slice(0, 10);
}

export function fechaCaducidad(fecha?: string | null): string {
  return fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha.split("-").reverse().join("/") : "—";
}

export function estadoCaducidad(fecha?: string | null, hoy = hoyMadrid()) {
  const diferencia = fecha ? Math.round((Date.parse(fecha + "T00:00:00Z") - Date.parse(hoy + "T00:00:00Z")) / 86400000) : NaN;
  const dias = Number.isFinite(diferencia) ? Math.max(0, diferencia) : null;
  const caducado = Number.isFinite(diferencia) && diferencia < 0;
  return { caducado, dias, texto: caducado ? "Caducado" : dias === null ? "Sin fecha de caducidad" : dias === 0 ? "Caduca hoy" : dias === 1 ? "Queda 1 día" : `Quedan ${dias} días` };
}
