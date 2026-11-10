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

/** Lo mínimo de una reserva para repartirla en bloques de la comida. */
export interface ReservaConMenu {
  estado: string;
  numero_comensales: number | null;
  menu_del_dia?: boolean | null;
}

export type ClaveBloqueComida = "menu" | "carta" | "resto";

export interface BloqueComida<R extends ReservaConMenu> {
  clave: ClaveBloqueComida;
  etiqueta: string;
  reservas: R[];
  /** Personas que cuentan (sin «No vino»). */
  pax: number;
}

const ETIQUETA_BLOQUE: Record<ClaveBloqueComida, string> = { menu: "Menú del día", carta: "Carta", resto: "Resto" };

/** ¿"yyyy-MM-dd" cae de martes a jueves? */
export function esDiaDeMenuDelDia(fecha: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!m) return false;
  const dia = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay();
  return dia >= 2 && dia <= 4;
}

/**
 * La COMIDA de martes a jueves en el libro (10/11/2026, petición del dueño), en tres bloques: «Menú del día»
 * (`menu_del_dia = true`), «Carta» (`false`) y «Resto» (sin ese dato —reservas antiguas— o «No vino»).
 * Conserva el orden que traigan (por hora) y no devuelve bloques vacíos. Otro día: `null` (va como siempre).
 */
export function bloquesComidaMenuDelDia<R extends ReservaConMenu>(fecha: string, reservas: readonly R[]): BloqueComida<R>[] | null {
  if (!esDiaDeMenuDelDia(fecha)) return null;
  const claveDe = (r: R): ClaveBloqueComida =>
    r.estado === "no_show" || r.menu_del_dia == null ? "resto" : r.menu_del_dia ? "menu" : "carta";
  return (["menu", "carta", "resto"] as const)
    .map((clave) => {
      const del = reservas.filter((r) => claveDe(r) === clave);
      const pax = del
        .filter((r) => r.estado !== "no_show")
        .reduce((s, r) => s + Math.max(0, Number(r.numero_comensales) || 0), 0);
      return { clave, etiqueta: ETIQUETA_BLOQUE[clave], reservas: del, pax };
    })
    .filter((b) => b.reservas.length > 0);
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
