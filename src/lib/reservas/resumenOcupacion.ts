// ============================================================================
// RESUMEN DE OCUPACIÓN DE HOY — lógica pura (sin I/O)
// ----------------------------------------------------------------------------
// Las cifras de la franja de la pestaña «Hoy» de Reservas: reservas, comensales,
// capacidad y ocupación. Solo Casa Tomás: Touza no admite reservas (decisión del
// dueño, 2026-10-01), así que las reservas y las salas de otro negocio que aún
// queden en la base de datos se ignoran con la regla común (`admiteReservas`).
// Antes este módulo (`resumenNegocios.ts`) daba un total de los dos negocios y
// un desglose por negocio.
//
// La capacidad es la suma de las salas activas de Casa Tomás SIN las salas
// privadas, igual que el trigger de aforo (150: el Reservado está FUERA DE AFORO,
// decisión del dueño del 2026-10-03), y las reservas de una sala privada no
// entran en ninguna cifra (ni reservas, ni comensales, ni %): se avisan aparte
// (`avisosSalasPrivadas`, en `salaPrivada.ts`). Estados que cuentan como "van a
// venir / han venido": pendiente, verificada, confirmada y completada (llegó).
// Ver useOcupacionHoy.ts.
// ============================================================================

import { admiteReservas, salaAdmiteReservas } from "./negocios";
import { capacidadDeAforo, idsSalasPrivadasActivas, reservasQueConsumenAforo } from "./salaPrivada";

export const ESTADOS_ACTIVOS_RESUMEN = ["pendiente", "verificada", "confirmada", "completada"] as const;

export interface ReservaResumen {
  estado: string;
  numero_comensales: number | null;
  marca?: string | null;
  /** Para dejar fuera las reservas de una sala privada (fuera de aforo). */
  espacio_id?: string | null;
}

export interface EspacioResumen {
  id?: string | null;
  capacidad_maxima: number | null;
  activa?: boolean | null;
  caracteristicas?: unknown;
}

export interface CifrasOcupacion {
  /** Reservas activas (pendiente/verificada/confirmada/completada). */
  totalReservas: number;
  totalComensales: number;
  reservasTodasEstados: number;
  reservasCanceladas: number;
  reservasConfirmadas: number;
  reservasPendientes: number;
  capacidadTotal: number;
  /** totalComensales / capacidadTotal, redondeado. */
  porcentajeTotal: number;
}

/** Cifras de hoy de Casa Tomás. Lo de otro negocio no cuenta (ver la cabecera). */
export function resumirOcupacion(
  reservas: readonly ReservaResumen[],
  espacios: readonly EspacioResumen[],
): CifrasOcupacion {
  const salasDeCasaTomas = espacios.filter((e) => e.activa !== false && salaAdmiteReservas(e));
  // Salas privadas: fuera de aforo. Ni su capacidad ni sus reservas entran en las cifras.
  const propias = reservasQueConsumenAforo(
    reservas.filter((r) => admiteReservas(r.marca)),
    idsSalasPrivadasActivas(salasDeCasaTomas),
  );
  const capacidadTotal = capacidadDeAforo(salasDeCasaTomas);
  const activas = propias.filter((r) => (ESTADOS_ACTIVOS_RESUMEN as readonly string[]).includes(r.estado));
  const totalComensales = activas.reduce((s, r) => s + (Number(r.numero_comensales) || 0), 0);
  return {
    totalReservas: activas.length,
    totalComensales,
    reservasTodasEstados: propias.length,
    reservasCanceladas: propias.filter((r) => r.estado === "cancelada").length,
    reservasConfirmadas: propias.filter((r) => r.estado === "confirmada").length,
    reservasPendientes: propias.filter((r) => r.estado === "pendiente").length,
    capacidadTotal,
    porcentajeTotal: capacidadTotal > 0 ? Math.round((totalComensales / capacidadTotal) * 100) : 0,
  };
}
