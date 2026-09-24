// ============================================================================
// RESUMEN DE OCUPACIÓN POR NEGOCIO — lógica pura (sin I/O)
// ----------------------------------------------------------------------------
// Cifras de "Reservas de hoy" y del dashboard: un total del grupo y el
// desglose por negocio (Casa Tomás / Touza · El Reservado). Criterio
// (decisión 2026-09-24): el total suma los dos negocios; la ocupación (%)
// se da POR NEGOCIO contra su propio aforo — un porcentaje "global" que
// mezclara las 150 plazas del restaurante con las 20 de El Reservado no
// significa nada para ninguno de los dos. El total solo lleva un % agregado
// informativo (comensales / suma de aforos).
//
// Estados que cuentan como "van a venir / han venido": pendiente, verificada,
// confirmada y completada (llegó). Ver useOcupacionHoy.ts.
// ============================================================================

import { agruparPorNegocio, marcaDeEspacio, marcaDeReserva, MARCA_POR_DEFECTO, type NegocioPanel } from "./negocios";

export const ESTADOS_ACTIVOS_RESUMEN = ["pendiente", "verificada", "confirmada", "completada"] as const;

export interface ReservaResumen {
  estado: string;
  numero_comensales: number | null;
  marca?: string | null;
}

export interface EspacioResumen {
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

export interface CifrasNegocio extends CifrasOcupacion {
  negocio: NegocioPanel;
}

function cifras(reservas: readonly ReservaResumen[], capacidadTotal: number): CifrasOcupacion {
  const activas = reservas.filter((r) => (ESTADOS_ACTIVOS_RESUMEN as readonly string[]).includes(r.estado));
  const totalComensales = activas.reduce((s, r) => s + (Number(r.numero_comensales) || 0), 0);
  return {
    totalReservas: activas.length,
    totalComensales,
    reservasTodasEstados: reservas.length,
    reservasCanceladas: reservas.filter((r) => r.estado === "cancelada").length,
    reservasConfirmadas: reservas.filter((r) => r.estado === "confirmada").length,
    reservasPendientes: reservas.filter((r) => r.estado === "pendiente").length,
    capacidadTotal,
    porcentajeTotal: capacidadTotal > 0 ? Math.round((totalComensales / capacidadTotal) * 100) : 0,
  };
}

/**
 * Total del grupo + una fila por negocio. Casa Tomás siempre aparece; otro
 * negocio, si tiene espacios activos o reservas ese día.
 */
export function resumirOcupacionPorNegocio(
  reservas: readonly ReservaResumen[],
  espacios: readonly EspacioResumen[],
): CifrasOcupacion & { porNegocio: CifrasNegocio[] } {
  const activos = espacios.filter((e) => e.activa !== false);
  const porEspacio = agruparPorNegocio(activos, (e) => marcaDeEspacio(e), [MARCA_POR_DEFECTO]);
  const porReserva = agruparPorNegocio(reservas, (r) => marcaDeReserva(r));
  const marcas = agruparPorNegocio(
    [...porEspacio.map((g) => g.negocio.marca), ...porReserva.map((g) => g.negocio.marca)],
    (m) => m,
  );
  const porNegocio: CifrasNegocio[] = marcas.map(({ negocio }) => {
    const capacidad = (porEspacio.find((g) => g.negocio.marca === negocio.marca)?.items ?? []).reduce(
      (s, e) => s + (Number(e.capacidad_maxima) || 0),
      0,
    );
    return {
      negocio,
      ...cifras(porReserva.find((g) => g.negocio.marca === negocio.marca)?.items ?? [], capacidad),
    };
  });
  const capacidadGrupo = porNegocio.reduce((s, n) => s + n.capacidadTotal, 0);
  return { ...cifras(reservas, capacidadGrupo), porNegocio };
}
