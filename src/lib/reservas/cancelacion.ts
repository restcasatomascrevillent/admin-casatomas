// ============================================================================
// QUIÉN CANCELÓ UNA RESERVA (16/11/2026, petición del dueño: «que se muestre
// quién ha cancelado cada reserva, cliente o restaurante, y que las canceladas
// aparezcan en el panel»).
// ----------------------------------------------------------------------------
// Lo guarda la BASE DE DATOS (migración 20261205100200_reservas_cancelada_por):
// un trigger apunta `cancelada_por` ('cliente' | 'restaurante') y `cancelada_at`
// al pasar a «cancelada», venga de donde venga (Lista, ficha, enlace de la web,
// correo, bot). El panel solo LEE: nunca escribe estas columnas.
//
// Las reservas canceladas antes de la migración no tienen autor ni hora: se
// enseñan como «Cancelada», sin más. Y si la migración aún no está aplicada en
// un proyecto, las lecturas se repiten sin las columnas (`leerConCancelacion`):
// la Lista sigue funcionando, solo que sin decir quién canceló.
// ============================================================================
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { ESTADO_CANCELADA } from "./estadosReserva";

export type QuienCancelo = "cliente" | "restaurante";

/** Las dos columnas, para añadir a un `select` con columnas escritas a mano. */
export const COLUMNAS_CANCELACION = "cancelada_por, cancelada_at";

export interface DatosCancelacion {
  estado: string;
  cancelada_por?: string | null;
  cancelada_at?: string | null;
}

/** Quién canceló, o `null` si la reserva no está cancelada o no consta. */
export function quienCancelo(reserva: DatosCancelacion): QuienCancelo | null {
  if (reserva.estado !== ESTADO_CANCELADA) return null;
  return reserva.cancelada_por === "cliente" || reserva.cancelada_por === "restaurante" ? reserva.cancelada_por : null;
}

const ETIQUETA: Record<QuienCancelo, string> = {
  cliente: "Cancelada por el cliente",
  restaurante: "Cancelada por el restaurante",
};

const fechaDe = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * «Cancelada por el cliente · 14/11 18:20» (las filas de la Lista). Sin autor: «Cancelada · 14/11 18:20»;
 * sin hora, solo la primera parte. `null` si la reserva no está cancelada.
 */
export function textoCanceladaCorto(reserva: DatosCancelacion): string | null {
  if (reserva.estado !== ESTADO_CANCELADA) return null;
  const quien = quienCancelo(reserva);
  const cuando = fechaDe(reserva.cancelada_at);
  return [quien ? ETIQUETA[quien] : "Cancelada", cuando ? format(cuando, "dd/MM HH:mm") : null].filter(Boolean).join(" · ");
}

/**
 * «Cancelada por el restaurante el sábado 14 nov 2026 a las 18:20» (la ficha). Sin autor ni hora (canceladas de
 * antes de guardarse el dato): «No consta quién la canceló». `null` si la reserva no está cancelada.
 */
export function textoCanceladaLargo(reserva: DatosCancelacion): string | null {
  if (reserva.estado !== ESTADO_CANCELADA) return null;
  const quien = quienCancelo(reserva);
  const cuando = fechaDe(reserva.cancelada_at);
  const fecha = cuando ? ` el ${format(cuando, "EEEE d MMM yyyy 'a las' HH:mm", { locale: es }).replace(".", "")}` : "";
  if (!quien) return cuando ? `Cancelada${fecha} · no consta quién la canceló` : "No consta quién la canceló";
  return `${ETIQUETA[quien]}${fecha}`;
}

/** ¿El error es que `reservas` aún no tiene las columnas de cancelación (migración sin aplicar)? */
export function esErrorColumnaCancelacionFaltante(error: unknown): boolean {
  const e = (error ?? {}) as { code?: string; message?: string };
  const codigo = String(e.code ?? "");
  // 42703: columna inexistente (Postgres). PGRST204: columna que PostgREST no conoce.
  return (codigo === "42703" || codigo === "PGRST204") && /cancelada_(por|at)/.test(String(e.message ?? ""));
}

/** Tras el primer fallo por columnas ausentes no se vuelven a pedir en esta sesión (una petición menos cada vez). */
let columnasAusentes = false;

/**
 * Lanza `consulta` pidiendo las columnas de cancelación y, si el proyecto aún no las tiene, la repite sin
 * ellas. `consulta` recibe las columnas extra a añadir al `select` ("" la segunda vez).
 */
export async function leerConCancelacion<T>(
  consulta: (columnasExtra: string) => PromiseLike<{ data: T | null; error: unknown }>,
): Promise<{ data: T | null; error: unknown }> {
  if (!columnasAusentes) {
    const primera = await consulta(`, ${COLUMNAS_CANCELACION}`);
    if (!primera.error || !esErrorColumnaCancelacionFaltante(primera.error)) return primera;
    columnasAusentes = true;
  }
  return consulta("");
}

/** Solo para tests. */
export function __resetColumnasCancelacionParaTests(): void {
  columnasAusentes = false;
}

/** Las canceladas de un día, por hora y nombre: la sección «Canceladas» de cada hoja de la Lista. */
export function canceladasDelDia<R extends { estado: string; hora: string; nombre?: string | null }>(
  reservas: readonly R[] | null | undefined,
): R[] {
  return (reservas ?? [])
    .filter((r) => r.estado === ESTADO_CANCELADA)
    .sort(
      (a, b) =>
        String(a.hora).slice(0, 5).localeCompare(String(b.hora).slice(0, 5)) || (a.nombre ?? "").localeCompare(b.nombre ?? "", "es"),
    );
}
