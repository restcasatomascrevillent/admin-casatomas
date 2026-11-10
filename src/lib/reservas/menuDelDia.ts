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

// ---------------------------------------------------------------------------
// «Menú del día» o «Carta» (dueño, 10/11/2026): de martes a jueves en la
// COMIDA cada reserva es una de las dos (`reservas.menu_del_dia`: true = menú,
// false = carta). Es un dato para organizar el servicio:
//   · Menú del día → solo Comedor o Terraza.
//   · Carta        → Salón, Comedor o Terraza.
// Fuera de martes-jueves comida no hay elección (y `menu_del_dia` = false).
// ---------------------------------------------------------------------------

export type ServicioComida = "menu_del_dia" | "carta";

/** "2026-11-17" → esa fecha a mediodía local (evita el desfase UTC de `new Date("2026-11-17")`). */
function fechaLocal(fecha: Date | string | null | undefined): Date | null {
  if (!fecha) return null;
  if (fecha instanceof Date) return Number.isNaN(fecha.getTime()) ? null : fecha;
  const d = new Date(`${String(fecha).slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** ¿Ese día y hora piden elegir «Menú del día» o «Carta»? (martes a jueves, comida). */
export function eligeMenuOCarta(fecha: Date | string | null | undefined, hora: string | null | undefined): boolean {
  return admiteMenuDelDia(fechaLocal(fecha), hora);
}

/** Lo que es una reserva en ese servicio; `null` fuera de martes-jueves comida (sin regla de sala). */
export function servicioComidaDeReserva(r: {
  fecha: Date | string | null | undefined;
  hora: string | null | undefined;
  menu_del_dia?: boolean | null;
}): ServicioComida | null {
  if (!eligeMenuOCarta(r.fecha, r.hora)) return null;
  return r.menu_del_dia ? "menu_del_dia" : "carta";
}

const SALAS_MENU_DEL_DIA = /comedor|terraza/i;
const SALAS_CARTA = /sal[oó]n|comedor|terraza/i;

/** ¿Esa sala (por nombre) vale para ese servicio? Sin servicio (`null`), cualquiera. */
export function salaAdmiteServicio(nombreSala: string | null | undefined, servicio: ServicioComida | null | undefined): boolean {
  if (!servicio) return true;
  const nombre = nombreSala ?? "";
  return (servicio === "menu_del_dia" ? SALAS_MENU_DEL_DIA : SALAS_CARTA).test(nombre);
}

/** «Comedor o Terraza» / «Salón, Comedor o Terraza». */
export function textoSalasDeServicio(servicio: ServicioComida): string {
  return servicio === "menu_del_dia" ? "Comedor o Terraza" : "Salón, Comedor o Terraza";
}
