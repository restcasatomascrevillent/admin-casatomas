// «Menú del día»: solo de martes a jueves y en la comida (antes de las 17:00).
// Puro, sin I/O. La casilla del formulario manual solo sale si esto es verdad.

/** Hora (minutos desde medianoche) a partir de la cual ya no hay menú del día. */
const LIMITE_MINUTOS = 17 * 60;

/** ¿Esa fecha (local) y hora ("HH:MM" o "HH:MM:SS") admiten marcar «Menú del día»? */
export function admiteMenuDelDia(fecha: Date | null | undefined, hora: string | null | undefined): boolean {
  if (!fecha || !hora) return false;
  const dia = fecha.getDay(); // 0 domingo … 2 martes, 3 miércoles, 4 jueves
  if (dia < 2 || dia > 4) return false;
  const m = /^(\d{1,2}):(\d{2})/.exec(hora);
  if (!m) return false;
  return Number(m[1]) * 60 + Number(m[2]) < LIMITE_MINUTOS;
}
