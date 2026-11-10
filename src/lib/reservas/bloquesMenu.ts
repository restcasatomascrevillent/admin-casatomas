// ============================================================================
// «HOY»: LA COMIDA DE MARTES A JUEVES, POR MENÚ DEL DÍA / CARTA (10/11/2026)
// ----------------------------------------------------------------------------
// Petición del dueño: en la comida de martes a jueves (los días de menú del día),
// dentro de «Por llegar» y de «Sentadas», las reservas van en tres bloques:
// «Menú del día» (`menu_del_dia = true`), «Carta» (`false`) y «Resto» (sin dato),
// cada uno con su total de personas y ordenado por hora. La cena y los otros días,
// como siempre (una sola lista por hora). Con «Todo el día», las de la cena van
// detrás en su propio bloque «Cena», sin partir.
// ============================================================================

import { turnoDeHora } from "../../../supabase/functions/_shared/disponibilidad";
import type { FiltroTurnoHoy } from "./vistaHoy";

export type ClaveBloqueMenu = "menu" | "carta" | "resto" | "cena";

export interface BloqueMenu<F> {
  clave: ClaveBloqueMenu;
  titulo: string;
  filas: F[];
  /** Personas del bloque. */
  pax: number;
}

interface FilaConReserva {
  reserva: { hora: string; numero_comensales: number; menu_del_dia?: boolean | null };
}

const TITULOS: Record<ClaveBloqueMenu, string> = {
  menu: "Menú del día",
  carta: "Carta",
  resto: "Resto",
  cena: "Cena",
};

/** Martes, miércoles o jueves (los días con menú del día). `fecha` en `AAAA-MM-DD`. */
export function esDiaDeMenu(fecha: string): boolean {
  const d = new Date(`${fecha}T12:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const dia = d.getDay();
  return dia >= 2 && dia <= 4;
}

/**
 * Los bloques de una lista de filas (ya filtradas por turno y buscador), o `null` si esa lista va como siempre:
 * otro día que no sea de martes a jueves, el filtro «Cena», o ninguna reserva de comida. Los bloques vacíos no
 * salen. Dentro de cada bloque, por hora (y, a igual hora, en el orden en que llegaron).
 */
export function agruparPorMenu<F extends FilaConReserva>(
  filas: readonly F[],
  { fecha, filtroTurno }: { fecha: string; filtroTurno: FiltroTurnoHoy },
): BloqueMenu<F>[] | null {
  if (filtroTurno === "cena" || !esDiaDeMenu(fecha)) return null;
  const porClave: Record<ClaveBloqueMenu, F[]> = { menu: [], carta: [], resto: [], cena: [] };
  for (const f of filas) {
    if (turnoDeHora(f.reserva.hora) === "cena") porClave.cena.push(f);
    else if (f.reserva.menu_del_dia === true) porClave.menu.push(f);
    else if (f.reserva.menu_del_dia === false) porClave.carta.push(f);
    else porClave.resto.push(f);
  }
  if (porClave.menu.length + porClave.carta.length + porClave.resto.length === 0) return null;
  const porHora = (lista: F[]) =>
    lista
      .map((f, i) => ({ f, i }))
      .sort((a, b) => a.f.reserva.hora.localeCompare(b.f.reserva.hora) || a.i - b.i)
      .map((x) => x.f);
  return (["menu", "carta", "resto", "cena"] as const)
    .filter((clave) => porClave[clave].length > 0)
    .map((clave) => ({
      clave,
      titulo: TITULOS[clave],
      filas: porHora(porClave[clave]),
      pax: porClave[clave].reduce((s, f) => s + (f.reserva.numero_comensales || 0), 0),
    }));
}
