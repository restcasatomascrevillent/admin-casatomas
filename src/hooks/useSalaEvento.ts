import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { turnoDeHora } from "../../supabase/functions/_shared/disponibilidad";

// «Evento: sala entera» (09/11/2026, migración 20261119100000). Una fila de
// `salas_cerradas_servicio` CON `reserva_id` = esa reserva (el evento) se queda
// la sala entera ese día y turno:
//   - el aforo de ese turno pierde la capacidad de la sala y el evento no cuenta;
//   - ninguna otra reserva puede entrar en ella (lo rechaza la base de datos);
//   - Organizar no coloca a nadie allí, y Hoy y el Calendario la enseñan como
//     «Evento: <nombre>».
// El cierre sigue a la reserva sola (trigger en la BD): si se cancela, pasa a
// «No vino» o se borra, la sala se abre; si cambia de día, hora o sala, se mueve.
// Las filas SIN `reserva_id` son el interruptor «Sala cerrada» de Organizar
// (`useSalaCerradaServicio`): no cambian el aforo.

/** Misma raíz que `useSalaCerradaServicio`: invalidarla refresca las dos. */
export const CLAVE_SALAS_CERRADAS = "salas_cerradas_servicio";

export interface SalaCerradaEvento {
  espacio_id: string;
  fecha: string;
  turno: "comida" | "cena";
  reserva_id: string;
  motivo: string | null;
}

// La tabla no está en los tipos generados.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tabla = () => supabase.from(CLAVE_SALAS_CERRADAS as any) as any;

const COLUMNAS = "espacio_id, fecha, turno, reserva_id, motivo";

function soloEventos(filas: unknown): SalaCerradaEvento[] {
  return ((Array.isArray(filas) ? filas : []) as Array<Partial<SalaCerradaEvento> | null>)
    .filter((f): f is SalaCerradaEvento => !!f?.reserva_id && !!f.espacio_id && (f.turno === "comida" || f.turno === "cena"))
    .map((f) => ({ ...f, fecha: String(f.fecha).slice(0, 10) }));
}

/** El cierre por evento de UNA reserva (o null). Si la migración no está aplicada, null. */
export function useSalaEventoDeReserva(reservaId: string | null | undefined) {
  return useQuery({
    queryKey: [CLAVE_SALAS_CERRADAS, "evento-reserva", reservaId],
    enabled: !!reservaId,
    queryFn: async (): Promise<SalaCerradaEvento | null> => {
      const { data, error } = await tabla().select(COLUMNAS).eq("reserva_id", reservaId);
      if (error) return null;
      return soloEventos(data)[0] ?? null;
    },
  });
}

/** Salas cerradas por un evento entre dos fechas (`YYYY-MM-DD`, ambas incluidas). Vacío si falla. */
export function useSalasEvento(desde: string | null, hasta: string | null = desde) {
  return useQuery({
    queryKey: [CLAVE_SALAS_CERRADAS, "eventos", desde, hasta],
    enabled: !!desde && !!hasta,
    queryFn: async (): Promise<SalaCerradaEvento[]> => {
      const { data, error } = await tabla().select(COLUMNAS).gte("fecha", desde).lte("fecha", hasta);
      if (error) return [];
      return soloEventos(data);
    },
  });
}

/** Mapa sala → evento de ESE turno (para pintar «Evento: <nombre>» y para Organizar). */
export function eventosDelTurno(
  eventos: readonly SalaCerradaEvento[] | null | undefined,
  fecha: string,
  turno: "comida" | "cena",
): Map<string, SalaCerradaEvento> {
  const mapa = new Map<string, SalaCerradaEvento>();
  for (const e of eventos ?? []) if (e.fecha === fecha && e.turno === turno) mapa.set(e.espacio_id, e);
  return mapa;
}

/** «Evento: Boda García». */
export function textoEvento(e: Pick<SalaCerradaEvento, "motivo"> | null | undefined): string {
  const nombre = e?.motivo?.trim();
  return nombre ? `Evento: ${nombre}` : "Evento";
}

/** ¿Es el rechazo de la BD por entrar en una sala cerrada por un evento? */
export function esErrorSalaEvento(error: unknown): boolean {
  const msg = String((error as { message?: unknown } | null)?.message ?? "");
  return /cerrada por un evento/i.test(msg);
}

/** Mensaje en español para un fallo al poner o quitar el cierre por evento. */
export function mensajeErrorSalaEvento(error: unknown): string {
  const e = (error ?? {}) as { code?: string; message?: string };
  const msg = String(e.message ?? "");
  if (e.code === "42703" || e.code === "PGRST204" || (/reserva_id/.test(msg) && /column|columna/i.test(msg))) {
    return "Falta aplicar en la base de datos la migración del evento con la sala entera.";
  }
  if (e.code === "42501" || /row-level security|permission denied/i.test(msg)) {
    return "No tienes permiso para cerrar salas: hace falta «Editar» en Reservas.";
  }
  // Los de la BD ya vienen en español y dicen qué pasa (sala con otras reservas, aforo…).
  if (/sala|aforo|evento|reserva/i.test(msg)) return msg;
  return `No se ha podido guardar el evento: ${msg || "error desconocido"}`;
}

/**
 * Pone o quita el cierre por evento de una reserva. Con `ocupa` y sala: upsert
 * (una sala cerrada desde Organizar pasa a ser del evento). Sin `ocupa` o sin
 * sala: borra el de esa reserva. Devuelve el mensaje de error o null.
 */
export async function guardarSalaEvento(p: {
  reservaId: string;
  ocupa: boolean;
  espacioId: string | null;
  fecha: string;
  hora: string;
  motivo: string;
}): Promise<string | null> {
  try {
    if (!p.ocupa || !p.espacioId) {
      const { error } = await tabla().delete().eq("reserva_id", p.reservaId);
      return error ? mensajeErrorSalaEvento(error) : null;
    }
    const { data, error } = await tabla()
      .upsert(
        {
          espacio_id: p.espacioId,
          fecha: p.fecha.slice(0, 10),
          turno: turnoDeHora(p.hora),
          reserva_id: p.reservaId,
          motivo: p.motivo.trim() || null,
        },
        { onConflict: "espacio_id,fecha,turno" },
      )
      .select("reserva_id");
    if (error) return mensajeErrorSalaEvento(error);
    // Con RLS, una escritura denegada no da error: devuelve 0 filas.
    if (!data || (data as unknown[]).length === 0) return mensajeErrorSalaEvento({ code: "42501" });
    return null;
  } catch (e) {
    return mensajeErrorSalaEvento(e);
  }
}
