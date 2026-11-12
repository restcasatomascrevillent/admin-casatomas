import { format } from "date-fns";
import { es } from "date-fns/locale";

// ============================================================================
// Cuándo y por dónde se hizo una reserva (12/11/2026, petición del dueño:
// «cuando reserven por la web o se añada nueva reserva a mano se tiene que
// quedar con la hora y el día que lo hicieron y mostrar esa info»). La BD ya
// lo guarda sola: `reservas.created_at` (por defecto `now()`, web y a mano) y
// `canal`. Aquí solo se escribe para enseñarlo.
// ============================================================================

const CANAL: Record<string, string> = { telefono: "Teléfono", web: "Web", manual: "A mano", presencial: "En local" };

const fecha = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** «Hecha el miércoles 11 nov 2026 a las 13:30 · Web» (la ficha). */
export function textoCreada(reserva: { created_at?: string | null; canal?: string | null }): string | null {
  const d = fecha(reserva.created_at);
  if (!d) return null;
  const canal = reserva.canal ? CANAL[reserva.canal] ?? reserva.canal : null;
  return `Hecha el ${format(d, "EEEE d MMM yyyy 'a las' HH:mm", { locale: es }).replace(".", "")}${canal ? ` · ${canal}` : ""}`;
}

/** «hecha 11/11 13:30» (las filas de la Lista y de «Pendientes»). */
export function textoCreadaCorta(reserva: { created_at?: string | null }): string | null {
  const d = fecha(reserva.created_at);
  return d ? `hecha ${format(d, "dd/MM HH:mm")}` : null;
}
