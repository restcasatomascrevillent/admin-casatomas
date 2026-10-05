// ============================================================================
// PLANO DE SALA — lo que necesita SOLO esta pantalla
// ----------------------------------------------------------------------------
// Aquí NO vive la lógica compartida de asignación de mesas. Esa está en
// `@/lib/reservas/asignacionMesas` (turnos, grados, ajuste de capacidad,
// mensajes de error del RPC, choque de mesa) y en `@/hooks/useAsignacionesMesa`
// (lectura y escritura). Este fichero solo:
//
//   · reexporta lo del contrato que usa `PlanoEspacio2D.tsx`, para no repartir
//     diez imports por el componente;
//   · añade lo que es propio del plano y de nadie más: el filtro de turno con
//     la opción "todo el día", el agrupado de asignaciones por reserva, las
//     plazas que suman unas mesas, el resumen de cierre del día tal como se
//     pinta en la barra, los helpers de fecha del selector y la consulta de
//     reservas de UNA sala en UN día.
//
// El corte de turno de las 17:00 y los prefijos de error (`MESA_OCUPADA:` …)
// NO se repiten aquí: se importan. Tener dos copias es garantía de que el día
// que alguien cambie una, la otra mienta.
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  gradoDeReserva,
  resumenDia,
  turnoDeHora,
  type Turno,
} from "@/lib/reservas/asignacionMesas";
import { seSolapan, type Franja } from "@/lib/reservas/ocupacionMesa";

// Reexportado por comodidad del componente: la implementación vive en
// `@/lib/reservas/asignacionMesas`, aquí solo se pasa la pelota.
export type { AjusteCapacidad, GradoAsignacion, Turno } from "@/lib/reservas/asignacionMesas";
export {
  ajusteCapacidad,
  gradoDeReserva,
  mensajeErrorAsignacion,
  mesaOcupadaPor,
  turnoDeHora,
} from "@/lib/reservas/asignacionMesas";

// ─── Filtro de turno (con "todo el día", que es solo de esta pantalla) ───────

/**
 * Lo que puede tener elegido la barra de trabajo. `"dia"` NO es un turno del
 * negocio: es "no filtres", y por eso no está en `Turno` ni puede llegar a la
 * base de datos.
 */
export type FiltroTurno = Turno | "dia";

export const OPCIONES_TURNO: ReadonlyArray<{
  valor: FiltroTurno;
  etiqueta: string;
  detalle: string;
}> = [
  { valor: "comida", etiqueta: "Comida", detalle: "Servicio de mediodía (antes de las 17:00)" },
  { valor: "cena", etiqueta: "Cena", detalle: "Servicio de noche (desde las 17:00)" },
  { valor: "dia", etiqueta: "Todo el día", detalle: "Los dos servicios a la vez" },
];

export function esFiltroTurno(valor: unknown): valor is FiltroTurno {
  return valor === "comida" || valor === "cena" || valor === "dia";
}

/** El turno que hay que pedirle al hook de asignaciones: `"dia"` no filtra. */
export function turnoParaConsulta(filtro: FiltroTurno): Turno | undefined {
  return filtro === "dia" ? undefined : filtro;
}

/** ¿Entra esta hora en el filtro elegido? Usa el corte compartido (17:00). */
export function horaEnFiltro(hora: string, filtro: FiltroTurno): boolean {
  if (filtro === "dia") return true;
  return turnoDeHora(hora) === filtro;
}

export function etiquetaFiltroTurno(filtro: FiltroTurno): string {
  return OPCIONES_TURNO.find((o) => o.valor === filtro)?.etiqueta ?? "Todo el día";
}

// ─── Mesas de cada reserva ───────────────────────────────────────────────────

/**
 * Agrupa asignaciones por reserva conservando el orden de entrada: la primera
 * mesa de cada grupo es la que lleva el cartel con el nombre en el plano, y
 * tiene que ser siempre la misma entre renders.
 */
export function agruparPorReserva<T extends { reserva_id: string }>(
  asignaciones: readonly T[],
): Map<string, T[]> {
  const mapa = new Map<string, T[]>();
  for (const a of asignaciones ?? []) {
    if (!a) continue;
    const actual = mapa.get(a.reserva_id);
    if (actual) actual.push(a);
    else mapa.set(a.reserva_id, [a]);
  }
  return mapa;
}

/**
 * Plazas que suman unas mesas. Es lo que hace visible que "la 4 + la 5 hacen
 * 6". Una mesa que no esté en el mapa (borrada, de otra sala) suma 0: mejor
 * quedarse corto que inventarse plazas que no existen.
 */
export function plazasDeMesas(
  mesaIds: readonly string[],
  mesasPorId: ReadonlyMap<string, { capacidad: number }>,
): number {
  return (mesaIds ?? []).reduce((total, id) => {
    const capacidad = Number(mesasPorId.get(id)?.capacidad);
    return total + (Number.isFinite(capacidad) && capacidad > 0 ? capacidad : 0);
  }, 0);
}

/** "Mesa 4 + Mesa 5" — para hablar de mesas juntas en una sola línea. */
export function nombreMesasJuntas(nombres: readonly string[]): string {
  return (nombres ?? []).filter(Boolean).join(" + ");
}

// ─── Estado de cierre del día ────────────────────────────────────────────────

export interface ResumenCierreDia {
  /** Reservas del día + turno + sala (canceladas fuera). */
  total: number;
  /** Ya tienen al menos una mesa. */
  conMesa: number;
  /**
   * Todavía no tienen mesa. NO es un error: es "pendiente de mesa".
   *
   * Suma `sinMesa` + `sinSala` para que los dos contadores siempre cuadren con
   * `total`. En esta pantalla no debería haber ninguna `sinSala` (la consulta
   * filtra por `espacio_id`), pero si un dato roto llega sin sala, sigue siendo
   * trabajo pendiente y no puede desaparecer de la cuenta.
   */
  pendientesMesa: number;
  comensales: number;
  comensalesConMesa: number;
  /** 0..100. Lo calcula `resumenDia`, que nunca da un 100% falso. */
  porcentaje: number;
  /** El servicio está cerrado del todo. */
  cerrado: boolean;
}

/**
 * Cuántas reservas del servicio ya tienen mesa y cuántas siguen pendientes.
 *
 * El recuento por grado lo hace `resumenDia` del módulo compartido (misma
 * definición de grado que el calendario, y sus guardas contra porcentajes que
 * mienten); aquí solo se suman los comensales, que no son lógica de nadie más.
 */
export function resumenCierreDia(
  reservas: readonly { id: string; numero_comensales?: number | null; espacio_id?: string | null }[],
  mesasPorReserva: ReadonlyMap<string, unknown[]>,
): ResumenCierreDia {
  const lista = (reservas ?? []).filter(Boolean);

  const filas = lista.map((r) => ({
    grado: gradoDeReserva({
      espacio_id: r.espacio_id ?? null,
      mesas_asignadas: mesasPorReserva.get(r.id)?.length ?? 0,
    }),
  }));

  const base = resumenDia(filas);

  let comensales = 0;
  let comensalesConMesa = 0;
  for (const r of lista) {
    const pax = Number(r.numero_comensales);
    const seguro = Number.isFinite(pax) && pax > 0 ? pax : 0;
    comensales += seguro;
    if ((mesasPorReserva.get(r.id)?.length ?? 0) > 0) comensalesConMesa += seguro;
  }

  return {
    total: base.total,
    conMesa: base.conMesa,
    pendientesMesa: base.sinMesa + base.sinSala,
    comensales,
    comensalesConMesa,
    porcentaje: base.porcentajeCerrado,
    cerrado: base.total > 0 && base.conMesa === base.total,
  };
}

// ─── Fechas del selector ─────────────────────────────────────────────────────

/** Hoy en local, `YYYY-MM-DD`. No `toISOString()`: en Madrid desplaza el día. */
export function hoyLocal(): string {
  return new Date().toLocaleDateString("sv-SE");
}

/** ¿Es un `YYYY-MM-DD` de calendario real? (protege el `?fecha=` de la URL) */
export function esFechaISO(valor: unknown): valor is string {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const [a, m, d] = valor.split("-").map(Number);
  const fecha = new Date(a, m - 1, d);
  return fecha.getFullYear() === a && fecha.getMonth() === m - 1 && fecha.getDate() === d;
}

/** `YYYY-MM-DD` → Date local (a mediodía no hace falta: sin horas no hay salto). */
export function fechaISOaDate(iso: string): Date {
  const [a, m, d] = String(iso ?? "").split("-").map(Number);
  return new Date(a || 1970, (m || 1) - 1, d || 1);
}

/** Date → `YYYY-MM-DD` local. */
export function dateAFechaISO(fecha: Date): string {
  return fecha.toLocaleDateString("sv-SE");
}

// ─── Reservas de una sala en un día ──────────────────────────────────────────

/** Reserva tal como la necesita el plano. */
export interface ReservaSala {
  id: string;
  nombre: string;
  hora: string;
  numero_comensales: number;
  estado: string;
  telefono?: string | null;
  espacio_id: string | null;
  notas_cliente?: string | null;
  importante?: boolean | null;
}

/**
 * Reservas de UNA sala en UN día (canceladas fuera), ordenadas por hora.
 *
 * Filtra por `espacio_id` A PROPÓSITO: el plano de una sala solo reparte SUS
 * mesas, así que solo debe enseñar las reservas que ya tienen esa sala. Las
 * reservas todavía sin sala son trabajo del kanban (grado 1), no de aquí — y
 * antes esta pantalla traía las de TODAS las salas del negocio, así que el
 * plano del Comedor ofrecía reservas del Salón.
 *
 * `"reservas" as any`: `espacio_id` y `notas_cliente` no están en los tipos
 * generados, y con `select("*")` TypeScript revienta con "Type instantiation is
 * excessively deep" al inferir el builder. Mismo recurso que `useOcupacionHoy.ts`
 * y `useDisponibilidad.ts`. Las columnas van enumeradas (no `*`) para que se vea
 * exactamente de qué depende el plano.
 */
export function useReservasDeSala(espacioId?: string, fecha?: string) {
  return useQuery({
    queryKey: ["reservas_sala_dia", espacioId, fecha],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reservas" as any)
        .select("id, nombre, hora, numero_comensales, estado, telefono, espacio_id, notas_cliente, importante")
        .eq("fecha", fecha)
        .eq("espacio_id", espacioId)
        .neq("estado", "cancelada")
        .order("hora");

      if (error) throw error;
      return (data ?? []) as unknown as ReservaSala[];
    },
    enabled: !!espacioId && !!fecha,
  });
}

// ─── Reparto automático ──────────────────────────────────────────────────────

/** Lo mínimo que hace falta de una mesa para repartir. */
export interface MesaDisponible {
  id: string;
  nombre: string;
  capacidad: number;
}

export interface PropuestaAsignacion {
  reserva: ReservaSala;
  /** Mesas propuestas, ya ordenadas por nombre para que el texto sea estable. */
  mesaIds: string[];
  /** Suma de plazas de esas mesas. Siempre >= numero_comensales. */
  plazas: number;
}

export interface DistribucionPropuesta {
  propuestas: PropuestaAsignacion[];
  /** Reservas para las que no quedan mesas que las cubran. NO es un error. */
  sinHueco: ReservaSala[];
}

/**
 * Reparte mesas entre las reservas que aún no tienen ninguna.
 *
 * ES UNA FUNCIÓN PURA: no escribe nada. Devuelve una propuesta que el
 * componente aplica llamando al RPC `asignar_mesas_reserva`, el MISMO camino
 * que la asignación manual. Antes esto lo hacía una Edge Function que insertaba
 * directamente en `asignaciones_mesa` (ver el comentario de
 * `handleCalcularDistribucion` en PlanoEspacio2D.tsx).
 *
 * OCUPACIÓN POR TIEMPO (05/10/2026): con `franjaDe`, una mesa se puede dar a
 * VARIAS reservas si sus franjas [hora, hora + tiempo de ocupación) no se
 * pisan — las ya sentadas (`ocupaciones`) y las que va proponiendo el propio
 * reparto. Sin `franjaDe` cada reserva ocupa la mesa todo el día (una reserva
 * por mesa, el comportamiento de antes). `mesasLibres` son las mesas
 * CANDIDATAS (activas y que se ofrecen); quién está libre a cada hora lo
 * decide esta función.
 *
 * CRITERIOS, y por qué:
 *
 *  - **Los grupos grandes primero.** Si primero se sientan los pequeños, la
 *    mesa de 10 acaba con una pareja y el grupo de 10 se queda sin sitio. Al
 *    revés no pasa: lo grande solo cabe donde cabe.
 *  - **Para una sola mesa, la más justa que valga** (best fit): sentar a 2 en
 *    la de 10 desperdicia el plano. Se elige la de menor capacidad que llegue.
 *  - **Si no hay ninguna que llegue, se juntan mesas**, de mayor a menor para
 *    usar las menos posibles, con un tope (`maxMesasPorReserva`, 3 por
 *    defecto): juntar cuatro mesas para un grupo es algo que decide una
 *    persona mirando la sala, no un reparto automático.
 *  - **Nunca toca a quien ya tiene mesa.** El reparto solo rellena lo que está
 *    pendiente: el trabajo manual del encargado no se pisa.
 *  - **Determinista.** A igualdad de capacidad manda el nombre de la mesa, y a
 *    igualdad de comensales la hora. Dos pulsaciones seguidas con los mismos
 *    datos proponen lo mismo.
 */
export function calcularDistribucionMesas(params: {
  reservas: readonly ReservaSala[];
  mesasLibres: readonly MesaDisponible[];
  maxMesasPorReserva?: number;
  /** Franja de cada reserva. Sin ella (o si devuelve null), la reserva ocupa la mesa todo el día. */
  franjaDe?: (reserva: ReservaSala) => Franja | null;
  /** Lo que ya está sentado (de otras reservas), para no pisarlo. */
  ocupaciones?: ReadonlyArray<{ mesa_id: string; franja: Franja }>;
}): DistribucionPropuesta {
  const tope = Math.max(1, params.maxMesasPorReserva ?? 3);

  const candidatas = [...(params.reservas ?? [])]
    .filter((r) => r && Number(r.numero_comensales) > 0)
    .sort(
      (a, b) =>
        b.numero_comensales - a.numero_comensales ||
        String(a.hora).localeCompare(String(b.hora)) ||
        String(a.id).localeCompare(String(b.id)),
    );

  // Mesas candidatas, de menor a mayor capacidad.
  const mesas = [...(params.mesasLibres ?? [])]
    .filter((m) => m && Number(m.capacidad) > 0)
    .sort((a, b) => a.capacidad - b.capacidad || String(a.nombre).localeCompare(String(b.nombre)));

  // Franjas ocupadas por mesa: lo ya sentado + lo que se va proponiendo.
  const ocupadas = new Map<string, Franja[]>();
  for (const o of params.ocupaciones ?? []) {
    if (!o?.mesa_id || !o.franja) continue;
    const lista = ocupadas.get(o.mesa_id) ?? [];
    lista.push(o.franja);
    ocupadas.set(o.mesa_id, lista);
  }
  const libreEn = (mesaId: string, franja: Franja) =>
    !(ocupadas.get(mesaId) ?? []).some((otra) => seSolapan(otra, franja));
  const ocupar = (mesaId: string, franja: Franja) => {
    const lista = ocupadas.get(mesaId) ?? [];
    lista.push(franja);
    ocupadas.set(mesaId, lista);
  };

  const propuestas: PropuestaAsignacion[] = [];
  const sinHueco: ReservaSala[] = [];

  const ordenarPorNombre = (ms: MesaDisponible[]) =>
    [...ms].sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));

  for (const reserva of candidatas) {
    const faltan = reserva.numero_comensales;
    const franja = params.franjaDe?.(reserva) ?? TODO_EL_DIA;
    const libres = mesas.filter((m) => libreEn(m.id, franja));

    // 1) La mesa más justa que llegue ella sola.
    const justa = libres.find((m) => m.capacidad >= faltan);
    if (justa) {
      ocupar(justa.id, franja);
      propuestas.push({ reserva, mesaIds: [justa.id], plazas: justa.capacidad });
      continue;
    }

    // 2) Juntar: de mayor a menor, las menos posibles, hasta el tope.
    const grandesPrimero = [...libres].reverse();
    const elegidas: MesaDisponible[] = [];
    let suma = 0;
    for (const mesa of grandesPrimero) {
      if (elegidas.length >= tope || suma >= faltan) break;
      elegidas.push(mesa);
      suma += mesa.capacidad;
    }

    if (suma >= faltan && elegidas.length > 0) {
      for (const mesa of elegidas) ocupar(mesa.id, franja);
      const orden = ordenarPorNombre(elegidas);
      propuestas.push({ reserva, mesaIds: orden.map((m) => m.id), plazas: suma });
      continue;
    }

    // 3) No cabe: se queda pendiente de mesa, que es un estado legítimo.
    sinHueco.push(reserva);
  }

  return { propuestas, sinHueco };
}

/** Sin franja: la reserva ocupa la mesa todo el día (una reserva por mesa). */
const TODO_EL_DIA: Franja = { inicio: Number.NEGATIVE_INFINITY, fin: Number.POSITIVE_INFINITY };
