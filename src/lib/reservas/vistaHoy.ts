// ============================================================================
// PESTAÑA «HOY»: DOS VISTAS (Kanban | Plano) — reglas puras compartidas
// ----------------------------------------------------------------------------
// Petición del dueño (06/10/2026), mirando «Hoy»: «montar aquí DOS VISTAS: una de
// kanban y luego montar la vista con los planos del local».
//
// El bloque de arriba de «Hoy» (cifras, aviso del Reservado, «Disponibilidad por
// cuartos de hora», buscador y «Todo el día / Comida / Cena») es UNO para las dos
// vistas: el buscador y el turno filtran igual el kanban y el plano. Esa regla de
// filtrado vive aquí (`coincideFiltroHoy`) para que las dos vistas no puedan
// divergir. También la elección de vista y de sala, que se recuerdan en ESTE
// navegador (localStorage); si el almacenamiento falla (modo privado, bloqueado)
// simplemente no se recuerdan.
// ============================================================================

import { horaAMinutos, turnoDeHora } from "../../../supabase/functions/_shared/disponibilidad";
import { COLUMNAS_FUERA } from "./sentarFuera";

/**
 * Columnas de `reservas` que pide «Hoy» (kanban, plano y vista de móvil), en vez de `select("*")`
 * (07/11/2026, «Hoy» ligera con poca cobertura). Son las que leen las tarjetas (`ReservaCard`), el plano
 * (`VistaPlanoHoy`, `MapaSalaServicio`), el móvil (`VistaHoyMovil`) y las acciones de servicio (parche
 * optimista de `estado`/`llegada_at`/`salida_at`). El editor de una reserva relee la fila entera por id
 * (`EditarReservaDialog`), así que aquí no hace falta nada más. `llegada_at` y `salida_at` ya se piden
 * por nombre en `useReservasServicioDia`: las dos migraciones están en todos los proyectos.
 */
export const COLUMNAS_RESERVAS_HOY =
  "id, nombre, telefono, email, fecha, hora, numero_comensales, estado, espacio_id, importante, en_blacklist, notas_cliente, marca, llegada_at, salida_at, mesa_fijada, menu_del_dia";

/**
 * Las de arriba MÁS las de «Sentar fuera» (`fuera_lugar`, `fuera_mesa`, `fuera_espacio_previo_id`; migración
 * 20261122171500). Solo las pide la consulta principal de Hoy (`consultaReservasHoy`), que si aún no existen
 * relee con `COLUMNAS_RESERVAS_HOY` (así publicar el panel antes que la migración no tumba Hoy).
 */
export const COLUMNAS_RESERVAS_HOY_CON_FUERA = `${COLUMNAS_RESERVAS_HOY}, ${COLUMNAS_FUERA}`;

/** Las dos vistas de «Hoy». Por defecto, el kanban (la de siempre). */
export type ModoVistaHoy = "kanban" | "plano";
export const VISTA_HOY_POR_DEFECTO: ModoVistaHoy = "kanban";

/** El filtro de turno del bloque de arriba («Todo el día / Comida / Cena»). */
export type FiltroTurnoHoy = "todo" | "comida" | "cena";

/** Claves de este navegador (mismo estilo que `reservas:timeline-estados:abierto`). */
export const CLAVE_VISTA_HOY = "reservas:hoy:vista";
export const CLAVE_SALA_PLANO_HOY = "reservas:hoy:sala-plano";

/**
 * Suelo del bloque de la vista Plano, en px: el MISMO que el del kanban
 * (`ALTURA_MINIMA_KANBAN`, GestorReservasKanban.tsx), por las mismas cuentas: lo de
 * encima de «Hoy» es alto y en la ventana del dueño (1280×711 a 150 %) quedan ~313 px.
 * Por debajo, el bloque no encoge más y solo entonces la página hace scroll.
 */
export const ALTURA_MINIMA_PLANO_HOY = 280;

/**
 * En el móvil (< 768 px) el plano va a lo ancho y lo que le sobra de alto no lo agranda: lo que manda es
 * que quepa la sala ENTERA a su ancho (con 280 px quedaban mesas de 11 px, ilegibles). 360 px = pestañas
 * de sala + un plano de ~240 px (lo justo para una sala de 14×9 m a 350 px de ancho) + la barra «Por
 * sentar». Lo de encima de «Hoy» ya no cabe en un móvil: la página baja un poco, una sola vez.
 */
export const ALTURA_MINIMA_PLANO_HOY_MOVIL = 360;

export function esModoVistaHoy(valor: unknown): valor is ModoVistaHoy {
  return valor === "kanban" || valor === "plano";
}

/** La vista recordada en este navegador; sin nada (o sin almacenamiento), el kanban. */
export function leerVistaHoy(): ModoVistaHoy {
  try {
    const guardada = window.localStorage.getItem(CLAVE_VISTA_HOY);
    return esModoVistaHoy(guardada) ? guardada : VISTA_HOY_POR_DEFECTO;
  } catch {
    return VISTA_HOY_POR_DEFECTO;
  }
}

export function guardarVistaHoy(vista: ModoVistaHoy): void {
  try {
    window.localStorage.setItem(CLAVE_VISTA_HOY, vista);
  } catch {
    // Sin almacenamiento: la próxima vez se abre en el kanban.
  }
}

/** La sala que se miraba en el plano (id de `espacios_reserva`), o `null`. */
export function leerSalaPlanoHoy(): string | null {
  try {
    return window.localStorage.getItem(CLAVE_SALA_PLANO_HOY) || null;
  } catch {
    return null;
  }
}

export function guardarSalaPlanoHoy(salaId: string): void {
  try {
    window.localStorage.setItem(CLAVE_SALA_PLANO_HOY, salaId);
  } catch {
    // Sin almacenamiento: se vuelve a la primera sala.
  }
}

/** Lo mínimo de una reserva que mira el filtro. */
export interface ReservaFiltrable {
  hora: string;
  nombre?: string | null;
  email?: string | null;
  telefono?: string | null;
}

/**
 * ¿Pasa la reserva el filtro del bloque de arriba? La regla de siempre del kanban:
 * el turno por la hora (corte de las 17:00, `turnoDeHora`) y el texto en nombre o
 * email (sin mayúsculas) o en el teléfono tal cual.
 */
export function coincideFiltroHoy(
  reserva: ReservaFiltrable,
  { busqueda, filtroTurno }: { busqueda: string; filtroTurno: FiltroTurnoHoy },
): boolean {
  if (filtroTurno !== "todo" && turnoDeHora(reserva.hora) !== filtroTurno) return false;
  const q = busqueda.toLowerCase().trim();
  if (!q) return true;
  return (
    (reserva.nombre || "").toLowerCase().includes(q) ||
    (reserva.email || "").toLowerCase().includes(q) ||
    (reserva.telefono || "").includes(q)
  );
}

/**
 * El turno que pinta el plano. Un plano no puede enseñar la comida y la cena a la
 * vez (una mesa tiene una reserva a las 14:00 y otra a las 21:30): con «Todo el día»
 * se pinta el turno EN CURSO, el que importa para el servicio. Con «Comida» o «Cena»,
 * ese.
 */
export function turnoDelPlano(filtroTurno: FiltroTurnoHoy, ahora: Date): "comida" | "cena" {
  if (filtroTurno === "comida" || filtroTurno === "cena") return filtroTurno;
  return turnoDeHora(ahora.getHours() * 60 + ahora.getMinutes());
}

/**
 * Turno de hora fija EN CURSO (jueves de tapas por la noche: 20:30 y 22:00,
 * `configuracion_turnos.horas_fijas`): el último que ya empezó o, antes del
 * primero, el primero. Solo los de ese servicio. `null` en un día normal.
 */
export function turnoFijoEnCurso(
  horasFijas: readonly string[] | null | undefined,
  turno: "comida" | "cena",
  ahora: Date,
): { numero: number; hora: string; total: number } | null {
  const delServicio = (horasFijas ?? [])
    .map((h) => ({ h: String(h).slice(0, 5), m: horaAMinutos(h) }))
    .filter((x): x is { h: string; m: number } => x.m !== null && turnoDeHora(x.m) === turno)
    .sort((a, b) => a.m - b.m);
  if (delServicio.length === 0) return null;
  const minutos = ahora.getHours() * 60 + ahora.getMinutes();
  let indice = 0;
  delServicio.forEach((x, i) => {
    if (x.m <= minutos) indice = i;
  });
  return { numero: indice + 1, hora: delServicio[indice].h, total: delServicio.length };
}

/** «2.º turno (22:00)»: el turno fijo en curso, para la etiqueta del plano. */
export function textoTurnoFijo(t: { numero: number; hora: string }): string {
  return `${t.numero}.${t.numero === 1 ? "er" : "º"} turno (${t.hora})`;
}

/**
 * ¿Ese turno de HOY ya ha terminado? (10/11/2026, «tocar una mesa en turno es para sentar»). Solo la comida
 * puede estar cerrada: a partir de la hora de la cena (`turnoDelPlano("todo")`) ya no se sienta a nadie en
 * la comida. La cena no se cierra en el día (la tablet sigue en «Hoy» hasta medianoche).
 */
export function turnoYaCerrado(turno: "comida" | "cena", ahora: Date): boolean {
  return turno === "comida" && turnoDelPlano("todo", ahora) === "cena";
}

/**
 * Tiempo corto para dentro de una mesa del plano: «14:00» (por llegar), «+12 min»
 * (retraso) o «45 min» / «1 h 50» (sentada). `null` si no hay nada que contar.
 */
export function tiempoCortoMesa(
  estado: "libre" | "reservada" | "retrasada" | "ocupada" | "por_liberar",
  minutos: number | null,
  hora: string | null | undefined,
): string | null {
  if (estado === "libre") return null;
  if (estado === "reservada") return hora ? String(hora).slice(0, 5) : null;
  if (minutos == null) return null;
  if (estado === "retrasada") return `+${Math.max(0, minutos)} min`;
  const m = Math.max(0, minutos);
  if (m < 60) return `${m} min`;
  const resto = m % 60;
  return `${Math.floor(m / 60)} h${resto ? ` ${String(resto).padStart(2, "0")}` : ""}`;
}

/** «Lucía Ortega Marín» → «Lucía O.»: lo que cabe en el cartel de una mesa. */
export function nombreCartelMesa(nombre: string | null | undefined): string {
  const partes = (nombre ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "Sin nombre";
  return partes.length === 1 ? partes[0] : `${partes[0]} ${partes[1].charAt(0).toUpperCase()}.`;
}
