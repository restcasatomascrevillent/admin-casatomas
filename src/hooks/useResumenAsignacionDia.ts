import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  esGradoAsignacion,
  esTurno,
  ETIQUETA_SIN_SALA,
  gradoDeReserva,
  resumenDia,
  resumenPorEspacio,
  turnoDeHora,
  type GradoAsignacion,
  type ResumenDia,
  type ResumenEspacio,
  type Turno,
} from "@/lib/reservas/asignacionMesas";
import { admiteReservas, normalizarMarca } from "@/lib/reservas/negocios";

// ============================================================================
// CÓMO VA EL CIERRE DE UN DÍA — una fila por reserva + agregados
// ----------------------------------------------------------------------------
// Lee la vista `vista_asignacion_dia` (una fila por reserva NO cancelada, con
// sus mesas ya contadas en SQL) y de ahí saca tres cosas:
//   · `filas`      → el detalle, para listas y para el plano.
//   · `resumen`    → cuántas van por grado y qué % del día está cerrado a nivel
//                    de mesa.
//   · `porEspacio` → el mismo recuento sala por sala, "lo que tiene y lo que le
//                    falta", más el grupo aparte `sinSala`.
//
// Los tres grados (`sin_sala` → `sin_mesa` → `con_mesa`) son ETAPAS, no
// errores: una reserva con sala y sin mesa es lo normal hasta que el encargado
// baja al detalle de mesa. Este hook MIDE, no valida.
//
// Todo el cálculo vive en `src/lib/reservas/asignacionMesas.ts` (puro y
// testeado): aquí solo se lee, se normaliza y se agrega.
//
// Solo Casa Tomás (decisión del dueño, 2026-10-01: Touza no admite reservas):
// las filas de otro negocio que queden en la vista se descartan aquí con
// `admiteReservas`, así que no salen ni en las cifras ni en las salas del día.
//
// OJO, DE DÓNDE SALE ESA MARCA. `vista_asignacion_dia.marca` NO es
// `reservas.marca`: es la marca de la SALA cuando la reserva tiene sala
// (`caracteristicas->>'marca'` del espacio) y la de la reserva solo cuando aún
// no tiene sala (migración 20260926140000_asignaciones_mesa_sin_solapes.sql).
// Este hook (y con él el panel del día del Calendario) y la pestaña «Próximas
// reservas» (PanelAsignacion, que lee la misma vista con
// `useReservasPorAsignar`) filtran por ESA marca; el kanban, la Lista, la
// casilla del mes del Calendario, la pestaña «Hoy» y el Dashboard filtran por
// `reservas.marca`. Hoy coinciden en el 100 % de los casos (el 2026-10-01: 0
// reservas de 1.241 con una marca distinta de la de su sala), pero si algún día
// difirieran, una reserva de una marca sentada en una sala de la otra saldría en
// unas pantallas y en otras no. La solución de fondo (que la vista exponga
// `reservas.marca` y se filtre por ella) es de la fase de base de datos.
// ============================================================================

/** Prefijo de caché. Las mutaciones de mesas invalidan por aquí. */
export const CLAVE_RESUMEN_ASIGNACION_DIA = "resumen-asignacion-dia";

/** Una fila de `vista_asignacion_dia`, ya saneada. */
export interface FilaAsignacionDia {
  reserva_id: string;
  fecha: string;
  /** 'HH:MM:SS' tal como lo devuelve el `time` de Postgres. */
  hora: string;
  turno: Turno;
  nombre: string;
  numero_comensales: number;
  estado: string;
  /** Negocio (normalizado, nunca vacío). Solo llegan filas de Casa Tomás. */
  marca: string;
  espacio_id: string | null;
  espacio_nombre: string | null;
  mesas_asignadas: number;
  plazas_asignadas: number;
  mesas_nombres: string[];
  grado: GradoAsignacion;
}

// Reexportados para que la interfaz no tenga que importar de dos sitios.
export type { GradoAsignacion, ResumenDia, ResumenEspacio, Turno };

/** Desglose de una sala. Reexportado para que la interfaz no importe dos sitios. */
export type ResumenEspacioDia = ResumenEspacio;
export type ResumenAsignacionDia = ResumenDia;

export interface DatosResumenAsignacionDia {
  filas: FilaAsignacionDia[];
  resumen: ResumenDia;
  /** Una entrada por sala con reservas ese día, ordenadas por nombre. */
  porEspacio: ResumenEspacioDia[];
  /** Grupo aparte de las reservas que todavía no tienen sala. */
  sinSala: ResumenEspacioDia;
}

export interface OpcionesResumenAsignacionDia {
  /** Solo comida o solo cena. Sin pasarlo, el día entero. */
  turno?: Turno;
  /** Montar el hook sin lanzar la consulta (reglas de los hooks de React). */
  enabled?: boolean;
  /**
   * Relectura periódica de respaldo mientras no llega realtime (`REFRESCO_PERIODICO` de
   * realtimeCanal.ts: cada minuto, solo con la pestaña a la vista). La pide el panel del día
   * del Calendario.
   */
  refresco?: { refetchInterval: number | false; refetchIntervalInBackground?: boolean };
}

const RESUMEN_VACIO: DatosResumenAsignacionDia = {
  filas: [],
  resumen: { total: 0, sinSala: 0, sinMesa: 0, conMesa: 0, porcentajeCerrado: 0 },
  porEspacio: [],
  sinSala: {
    espacio_id: null,
    espacio_nombre: ETIQUETA_SIN_SALA,
    total: 0,
    sinMesa: 0,
    conMesa: 0,
    comensales: 0,
    porcentajeCerrado: 0,
  },
};

/**
 * Estado del cierre de mesas de UN día.
 *
 * Devuelve lo de `useQuery` más `filas`, `resumen`, `porEspacio` y `sinSala` ya
 * calculados (nunca `undefined`: con la consulta aún en vuelo salen vacíos, así
 * la interfaz no tiene que defenderse de nulos en cada render).
 *
 * `turno` filtra EN SERVIDOR (es columna de la vista) y viaja en la clave de
 * caché, para que cambiar de turno no reutilice el recuento del otro.
 */
export function useResumenAsignacionDia(fecha: string, opciones?: OpcionesResumenAsignacionDia) {
  const turno = esTurno(opciones?.turno) ? opciones?.turno : undefined;

  const query = useQuery({
    ...opciones?.refresco,
    queryKey: [CLAVE_RESUMEN_ASIGNACION_DIA, fecha, turno ?? null],
    enabled: !!fecha && (opciones?.enabled ?? true),
    queryFn: async (): Promise<FilaAsignacionDia[]> => {
      let consulta = supabase
        .from("vista_asignacion_dia")
        .select("*")
        .eq("fecha", fecha)
        .order("hora", { ascending: true });

      if (turno) consulta = consulta.eq("turno", turno);

      const { data, error } = await consulta;
      if (error) throw error;

      // `f.marca` es la de la vista: la de la SALA si la reserva tiene sala (ver
      // la cabecera: no es `reservas.marca`, que es por la que filtran el kanban,
      // la Lista, la casilla del mes, «Hoy» y el Dashboard).
      return ((data ?? []) as Record<string, unknown>[])
        .filter(Boolean)
        .map(normalizarFila)
        .filter((f) => admiteReservas(f.marca));
    },
  });

  const datos = useMemo<DatosResumenAsignacionDia>(() => {
    const filas = query.data;
    if (!filas || filas.length === 0) return RESUMEN_VACIO;
    const { porEspacio, sinSala } = resumenPorEspacio(filas);
    return { filas, resumen: resumenDia(filas), porEspacio, sinSala };
  }, [query.data]);

  return { ...query, ...datos };
}

/**
 * Las columnas de una vista llegan TODAS como nullable en los tipos generados, y
 * `grado`/`turno` como `text`. Se sanean aquí para que la interfaz reciba
 * siempre valores válidos:
 *   · `turno` y `grado` se recalculan con la lógica pura si la vista trae algo
 *     que no es de la lista (vista antigua, dato roto). Nunca se inventan: la
 *     regla es la misma que la del SQL.
 *   · `mesas_nombres` nunca es null (un `text[]` vacío puede llegar como null y
 *     un `.map` sobre null tumba la pantalla).
 */
function normalizarFila(fila: Record<string, unknown>): FilaAsignacionDia {
  const hora = String(fila.hora ?? "");
  const espacioId = fila.espacio_id ? String(fila.espacio_id) : null;
  const mesasAsignadas = entero(fila.mesas_asignadas);

  return {
    reserva_id: String(fila.reserva_id ?? ""),
    fecha: String(fila.fecha ?? ""),
    hora,
    turno: esTurno(fila.turno) ? fila.turno : turnoDeHora(hora),
    nombre: String(fila.nombre ?? ""),
    numero_comensales: entero(fila.numero_comensales),
    estado: String(fila.estado ?? ""),
    marca: normalizarMarca(fila.marca as string | null),
    espacio_id: espacioId,
    espacio_nombre: fila.espacio_nombre ? String(fila.espacio_nombre) : null,
    mesas_asignadas: mesasAsignadas,
    plazas_asignadas: entero(fila.plazas_asignadas),
    mesas_nombres: Array.isArray(fila.mesas_nombres) ? (fila.mesas_nombres as string[]).filter(Boolean) : [],
    grado: esGradoAsignacion(fila.grado)
      ? fila.grado
      : gradoDeReserva({ espacio_id: espacioId, mesas_asignadas: mesasAsignadas }),
  };
}

const entero = (valor: unknown): number => {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};
