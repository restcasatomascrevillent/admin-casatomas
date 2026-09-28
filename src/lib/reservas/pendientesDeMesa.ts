// ============================================================================
// PENDIENTES DE MESA — lo que queda por sentar HOY, agrupado por sala
// ----------------------------------------------------------------------------
// Alimenta la franja "Pendientes de mesa" de la pestaña Hoy (`VistaHoy.tsx`).
// Responde a UNA pregunta: de las reservas del día, ¿cuáles siguen SIN mesa, y
// en qué sala hay que entrar para dársela?
//
// Es un módulo PURO a propósito (sin React, sin Supabase, sin `new Date()`):
// la franja no puede permitirse equivocarse en silencio —si se deja fuera una
// reserva, nadie la sienta— y esto se testea sin montar media pantalla.
//
// ----------------------------------------------------------------------------
// QUÉ CUENTA COMO "PENDIENTE" (y por qué no hay una cuarta lista de estados)
// ----------------------------------------------------------------------------
// Se reutiliza `ocupaEspacio` de `./servicioSala`, que ES exactamente
// `ESTADOS_QUE_OCUPAN` (pendiente / verificada / confirmada, la lista del
// trigger de aforo, en `supabase/functions/_shared/disponibilidad.ts`) MÁS
// `ESTADO_LLEGADA` ('completada'). No se copia la lista aquí: el día que el
// negocio añada un estado, esta franja se entera sola.
//
// Se incluye 'completada' (el cliente YA llegó) a propósito, aunque la
// tentación sea "si ya llegó, ya está resuelto": si llegó y sigue sin mesa
// registrada, es justo cuando MÁS urge dársela —el modo servicio pinta la mesa
// como ocupada a partir de la asignación, así que sin ella la sala miente—.
// Esconderla sería esconder trabajo pendiente real.
//
// Quedan fuera 'cancelada' y 'no_show' (ninguna de las dos pasa por
// `ocupaEspacio`): ahí ya no hay nadie a quien sentar.
// ============================================================================

import { ocupaEspacio } from "./servicioSala";

/** Lo mínimo que hace falta de una reserva para decidir si está pendiente. */
export interface ReservaPendienteMesa {
  id: string;
  nombre: string | null;
  hora: string;
  numero_comensales: number;
  estado: string;
  espacio_id: string | null;
}

/** Un bloque de la franja: una sala (o el cajón "sin sala") y lo que le falta. */
export interface GrupoPendientes {
  /** `null` = reservas que todavía no están repartidas por salas. */
  espacioId: string | null;
  /**
   * `null` cuando no se sabe el nombre: o es el grupo "sin sala", o la reserva
   * apunta a una sala que no está en la lista recibida (dato huérfano). En el
   * segundo caso el salto al plano SIGUE siendo posible —se abre por id—, así
   * que la reserva no se tira: solo se queda sin nombre en la cabecera.
   */
  nombreSala: string | null;
  reservas: ReservaPendienteMesa[];
}

/** `asignaciones_mesa` → ids de las reservas que YA tienen al menos una mesa. */
export function idsReservasConMesa(
  asignaciones: readonly { reserva_id?: string | null }[] | null | undefined,
): Set<string> {
  const ids = new Set<string>();
  for (const a of asignaciones ?? []) {
    if (a?.reserva_id) ids.add(a.reserva_id);
  }
  return ids;
}

/**
 * Reservas SIN mesa, agrupadas por sala y listas para pintar.
 *
 * Orden, de arriba abajo:
 *   1. las salas en el MISMO orden en que llegan en `salas` (quien las pide
 *      manda: `useEspaciosReserva` las trae por nombre, así que el orden de la
 *      franja coincide con el del resto del panel);
 *   2. las salas huérfanas (un `espacio_id` que no está en `salas`), por orden
 *      de aparición;
 *   3. el grupo "sin sala", SIEMPRE el último: es el menos accionable de los
 *      tres —desde ahí no se puede abrir ningún plano, primero hay que darle
 *      sala con «Gestionar»—, así que no debe robarle el sitio a lo que sí se
 *      puede resolver de un clic.
 *
 * Dentro de cada grupo, por hora (y a igualdad, por nombre e id: dos renders
 * seguidos tienen que pintar lo mismo).
 *
 * Nunca devuelve grupos vacíos: una sala sin pendientes no aparece, y si no
 * queda nada pendiente el resultado es `[]` y la franja entera desaparece.
 */
export function agruparPendientesDeMesa(
  reservas: readonly ReservaPendienteMesa[],
  reservaIdsConMesa: ReadonlySet<string>,
  salas: readonly { id: string; nombre: string }[],
): GrupoPendientes[] {
  const conMesa = reservaIdsConMesa ?? new Set<string>();

  // Reparto por sala conservando el orden de entrada, que es el que decide el
  // desempate de los grupos huérfanos.
  const porSala = new Map<string | null, ReservaPendienteMesa[]>();
  for (const r of reservas ?? []) {
    if (!r?.id) continue;
    if (!ocupaEspacio(String(r.estado ?? ""))) continue;
    if (conMesa.has(r.id)) continue;

    const clave = r.espacio_id ?? null;
    const actual = porSala.get(clave);
    if (actual) actual.push(r);
    else porSala.set(clave, [r]);
  }

  const grupos: GrupoPendientes[] = [];

  // 1) Salas conocidas, en el orden en que vienen.
  for (const sala of salas ?? []) {
    if (!sala?.id) continue;
    const enSala = porSala.get(sala.id);
    if (!enSala?.length) continue;
    grupos.push({ espacioId: sala.id, nombreSala: sala.nombre ?? null, reservas: ordenarPorHora(enSala) });
    porSala.delete(sala.id);
  }

  // 2) Salas huérfanas: sin nombre, pero con salto (el plano abre por id).
  for (const [espacioId, enSala] of porSala) {
    if (espacioId == null || !enSala.length) continue;
    grupos.push({ espacioId, nombreSala: null, reservas: ordenarPorHora(enSala) });
  }

  // 3) Sin sala, al final.
  const sinSala = porSala.get(null);
  if (sinSala?.length) {
    grupos.push({ espacioId: null, nombreSala: null, reservas: ordenarPorHora(sinSala) });
  }

  return grupos;
}

/** Cuántas reservas suman todos los grupos (el contador de la cabecera). */
export function contarPendientes(grupos: readonly GrupoPendientes[]): number {
  return (grupos ?? []).reduce((total, g) => total + (g?.reservas?.length ?? 0), 0);
}

/**
 * Por hora ascendente. `hora` viene como "HH:MM" o "HH:MM:SS" (según de dónde
 * salga el select), y las dos formas van con ceros a la izquierda, así que
 * comparar como texto da el mismo orden que comparar minutos.
 */
function ordenarPorHora(reservas: readonly ReservaPendienteMesa[]): ReservaPendienteMesa[] {
  return [...reservas].sort(
    (a, b) =>
      String(a.hora ?? "").localeCompare(String(b.hora ?? "")) ||
      String(a.nombre ?? "").localeCompare(String(b.nombre ?? "")) ||
      String(a.id).localeCompare(String(b.id)),
  );
}
