// ============================================================================
// TURNOS DE HORA FIJA en «Reservas › Configuración › Turnos» (20261122200100)
// ----------------------------------------------------------------------------
// Jueves de tapas por la noche: dos turnos, 20:30 y 22:00. Se escriben en el
// periodo como texto («20:30, 22:00») y se guardan en
// `configuracion_turnos.horas_fijas` (time[]). Vacío = horas por la escalera.
// ============================================================================

import { horasFijasDeConfig, minutosAHora } from "../../../supabase/functions/_shared/disponibilidad";

/** Lo guardado («["20:30:00","22:00:00"]») → «20:30, 22:00». Vacío si no hay. */
export function textoHorasFijas(horas: unknown): string {
  return (horasFijasDeConfig({ horas_fijas: horas }) ?? []).map(minutosAHora).join(", ");
}

/**
 * «20:30, 22:00» → `["20:30","22:00"]`; vacío → `null` (escalera). `{ error }`
 * si algo no es una hora o pasan de 12 (el CHECK de la base de datos).
 */
export function leerHorasFijasTexto(texto: string | null | undefined): { horas: string[] | null } | { error: string } {
  const trozos = String(texto ?? "")
    .split(/[,;\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (trozos.length === 0) return { horas: null };
  const vistas = new Set<string>();
  for (const t of trozos) {
    const m = /^(\d{1,2})[:.h](\d{2})$/.exec(t);
    const h = m ? Number(m[1]) : NaN;
    const min = m ? Number(m[2]) : NaN;
    if (!m || h > 23 || min > 59) return { error: `«${t}» no es una hora (escribe, por ejemplo, 20:30, 22:00)` };
    vistas.add(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
  }
  if (vistas.size > 12) return { error: "Como mucho 12 turnos fijos por periodo" };
  return { horas: Array.from(vistas).sort() };
}
