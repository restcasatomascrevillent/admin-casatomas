import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ConfiguracionTurno } from "./useConfiguracionTurnos";
// ============================================================
// EL MOTOR NO VIVE AQUÍ.
// ------------------------------------------------------------
// La regla de negocio de "qué horas se ofrecen" está en
// `supabase/functions/_shared/disponibilidad.ts`, el MISMO fichero que
// importa la edge function `reservas-web`. Este hook solo LEE de Supabase
// y le pasa los datos al motor. Si hay que cambiar la regla, se cambia
// allí y cambia en los dos sitios a la vez.
//
// (Se importa SIN extensión: Vite/vitest resuelven `.ts` solos, mientras
// que Deno exige la extensión explícita. Es el mismo fichero.)
// ============================================================
import {
  calcularDisponibilidad,
  ahoraEnMadrid,
  HORA_CORTE_TURNO as CORTE_TURNO,
  ESTADOS_QUE_OCUPAN as ESTADOS_OCUPAN,
  turnoDeHora,
  horaAMinutos,
  minutosAHora,
  filtrarEspaciosPorMarca,
  sumarCapacidadPorMarca,
  esCaracteristicaPrivada,
  sinReservasEnSalasPrivadas,
  MARCA_POR_DEFECTO,
  type ConfiguracionTurnoInput,
  type ReservaOcupante,
  type ResultadoDisponibilidad,
  type HuecoCalculado,
} from "../../supabase/functions/_shared/disponibilidad";

// Reexportados para que el resto de `src/` (widgets del dashboard, Kanban,
// configuración de turnos...) filtre espacios/capacidad por negocio SIN
// tener que importar el módulo compartido con una ruta relativa distinta
// por cada profundidad de carpeta, y sin escribir una copia propia del
// criterio (bug de 2026-09-22 en `_shared/disponibilidad.ts`, sección
// "AFORO POR NEGOCIO"). Sesión 2026-09-23: se detectaron más sitios en el
// panel con el mismo patrón sin filtrar (ver comentario de arriba).
export {
  calcularDisponibilidad,
  ahoraEnMadrid,
  turnoDeHora,
  filtrarEspaciosPorMarca,
  sumarCapacidadPorMarca,
  MARCA_POR_DEFECTO,
  type ResultadoDisponibilidad,
  type HuecoCalculado,
};

/**
 * Aforo por negocio (marca) — bug de 2026-09-22.
 * ------------------------------------------------------------
 * `espacios_reserva` mezcla espacios de los dos negocios del grupo
 * (Comedor/Salón/Terraza = casa_tomas, "El Reservado" = touza, ver
 * `caracteristicas->>'marca'`). Todas las consultas de este fichero que
 * suman `capacidad_maxima` o cuentan ocupación de `reservas` para decidir
 * aforo filtran ahora por marca (por defecto `MARCA_POR_DEFECTO`, que es
 * lo único que necesita HOY el panel: sus pantallas de reservas son del
 * restaurante). Antes sumaban/contaban TODOS los espacios/reservas activos
 * sin mirar el negocio — el mismo bug que el trigger `trg_validar_capacidad`
 * (150 -> 170 al dar de alta "El Reservado"), solo que aquí afectaba a lo
 * que el panel MUESTRA, no a lo que la base de datos VALIDA. Ver
 * `_shared/disponibilidad.ts` (sección "AFORO POR NEGOCIO") y
 * `supabase/migrations/20260922190000_aforo_por_marca.sql`.
 */

/**
 * Hora que separa el turno de comida del de cena.
 *
 * Ya no se define aquí: se reexporta del módulo compartido, que a su vez
 * copia literalmente el `NEW.hora < '17:00:00'` del trigger
 * `trg_validar_capacidad`. Antes estaba escrita a mano en tres sitios.
 *
 * OJO con la incoherencia conocida: el trigger que rellena
 * `ocupacion_diaria.turno` usa `< '16:00'`, no `< '17:00'`. Este motor
 * NUNCA lee `ocupacion_diaria` ni `vista_ocupacion` (724 de sus 784 filas
 * están huérfanas): calcula siempre desde `reservas`, como el webhook
 * telefónico.
 */
export const HORA_CORTE_TURNO = CORTE_TURNO;

/** Estados que ocupan plaza. Mismo criterio que el trigger. */
const ESTADOS_QUE_OCUPAN = ESTADOS_OCUPAN as unknown as string[];

export interface DisponibilidadSala {
  fecha: string;
  hora: string;
  sala_id: string;
  sala: string;
  posicion_id: string | null;
  posicion: string | null;
  total_comensales: number;
  total_reservas: number;
  capacidad_maxima: number;
  capacidad_disponible: number;
  porcentaje_ocupacion: number;
}

export interface DisponibilidadHora {
  fecha: string;
  hora: string;
  salas: {
    sala_id: string;
    sala_nombre: string;
    capacidad_maxima: number;
    comensales_actuales: number;
    capacidad_disponible: number;
    porcentaje_ocupacion: number;
    /** Alias de `porcentaje_ocupacion`; antes no existía en el objeto devuelto. */
    porcentaje_ocupacion_sala: number;
  }[];
  capacidad_total_disponible: number;
  porcentaje_ocupacion_global: number;
  /** Alias/campos que ya leían los calendarios y que antes salían siempre a 0. */
  capacidad_disponible: number;
  capacidad_maxima: number;
  total_comensales: number;
  total_reservas: number;
  turno: "comida" | "cena";
}

export interface TurnoDinamico {
  hora: string;
  disponible: boolean;
  capacidadDisponible: number;
  capacidadMaxima: number;
  comensalesActuales: number;
  esTurnoSecundario: boolean;
  motivoApertura?: string;
  porcentajeOcupacion: number;
  /** NUEVO: 0 = hora en punto, 1 = media, 2 = cuarto… */
  nivel?: number;
  /** NUEVO: paso del nivel en minutos (60/30/15…). Sustituye al "+15" fijo. */
  minutosNivel?: number;
  etiquetaNivel?: string;
}

// ------------------------------------------------------------
// LECTURAS DE BASE DE DATOS
// ------------------------------------------------------------

interface DatosDelDia {
  configuraciones: ConfiguracionTurnoInput[];
  /** Las reservas vivas que CONSUMEN aforo: sin las de salas privadas (fuera de aforo, 2026-10-03). */
  reservas: ReservaOcupante[];
  /** Todas las vivas del día, también las de salas privadas (para el detalle por sala). */
  reservasTodas: ReservaOcupante[];
  /** Ids de las salas privadas activas de la marca. */
  salasPrivadas: string[];
  /** Capacidad del aforo: SIN las salas privadas (Casa Tomás = 150). */
  capacidadTotal: number;
  espacios: { id: string; nombre: string; capacidad_maxima: number; privada?: boolean }[];
}

/**
 * Los tres SELECT que necesita el motor para un día.
 *
 * Antes `generarTurnosDinamicos` hacía UNA consulta POR HUECO (N+1: con
 * comida + cena eran ~24 round-trips por render, y el doble porque hacía
 * dos pasadas). Ahora son 3 consultas fijas.
 *
 * `marca` (por defecto `MARCA_POR_DEFECTO`, "casa_tomas"): filtra tanto
 * `espacios_reserva` (por `caracteristicas->>'marca'`) como `reservas`
 * (columna `marca`, `NOT NULL DEFAULT 'casa_tomas'`) al negocio pedido —
 * ver la nota "Aforo por negocio" de la cabecera de este fichero.
 *
 * `excluirReservaId`: al EDITAR una reserva viva, que no cuente contra sí
 * misma (igual que hace el trigger: `id != NEW.id` en un UPDATE).
 */
async function leerDatosDelDia(
  fecha: string,
  marca: string = MARCA_POR_DEFECTO,
  excluirReservaId?: string | null,
): Promise<DatosDelDia> {
  const [turnosRes, espaciosRes, reservasRes] = await Promise.all([
    supabase.from("configuracion_turnos").select("*").eq("activo", true),
    supabase.from("espacios_reserva" as any).select("id, nombre, capacidad_maxima, caracteristicas").eq("activa", true),
    supabase
      .from("reservas" as any)
      .select("id, hora, numero_comensales, espacio_id")
      .eq("fecha", fecha)
      .eq("marca", marca)
      .in("estado", ESTADOS_QUE_OCUPAN),
  ]);

  if (turnosRes.error) throw turnosRes.error;
  if (espaciosRes.error) throw espaciosRes.error;
  if (reservasRes.error) throw reservasRes.error;

  const espaciosCrudos = ((espaciosRes.data ?? []) as any[]).map((e) => ({
    id: e.id as string,
    nombre: e.nombre as string,
    capacidad_maxima: Number(e.capacidad_maxima) || 0,
    marca: (e.caracteristicas?.marca as string | undefined) ?? null,
    // Sala privada (el Reservado): FUERA DE AFORO (2026-10-03), no suma capacidad ni consumen aforo sus reservas.
    privada: esCaracteristicaPrivada(e.caracteristicas),
  }));
  // Bug corregido 2026-09-22: antes esta lista (y por tanto `capacidadTotal`
  // más abajo) incluía TODOS los espacios activos sin mirar la marca — un
  // espacio de otro negocio ("El Reservado", touza) inflaba el aforo que
  // ve el panel del restaurante. Ver cabecera del fichero.
  const espaciosDeLaMarca = filtrarEspaciosPorMarca(espaciosCrudos, marca);
  const espacios = espaciosDeLaMarca.map(({ id, nombre, capacidad_maxima, privada }) => ({
    id,
    nombre,
    capacidad_maxima,
    privada,
  }));
  const salasPrivadas = espacios.filter((e) => e.privada).map((e) => e.id);

  const reservasVivas = ((reservasRes.data ?? []) as unknown as Array<ReservaOcupante & { id?: string }>).filter(
    (r) => !excluirReservaId || r.id !== excluirReservaId,
  );

  return {
    configuraciones: (turnosRes.data ?? []) as unknown as ConfiguracionTurnoInput[],
    reservas: sinReservasEnSalasPrivadas(reservasVivas, salasPrivadas),
    reservasTodas: reservasVivas,
    salasPrivadas,
    // `sumarCapacidadPorMarca` ya deja fuera las salas privadas.
    capacidadTotal: sumarCapacidadPorMarca(espaciosDeLaMarca, marca),
    espacios,
  };
}

/**
 * Disponibilidad ya calculada de un día, para el panel.
 *
 * El panel SÍ puede reservar para hoy (lo hace el personal por teléfono),
 * así que `permitirMismoDia: true` — al revés que la web.
 */
export const useDisponibilidadCalculada = (
  fecha: string,
  opciones?: { comensales?: number; espacioId?: string | null; marca?: string },
) => {
  const comensales = opciones?.comensales ?? 1;
  const espacioId = opciones?.espacioId ?? null;
  const marca = opciones?.marca ?? MARCA_POR_DEFECTO;

  return useQuery({
    queryKey: ["disponibilidad-calculada", fecha, comensales, espacioId, marca],
    queryFn: async (): Promise<ResultadoDisponibilidad> => {
      const datos = await leerDatosDelDia(fecha, marca);
      return calcularDisponibilidad({
        fecha,
        comensales,
        espacioId,
        configuraciones: datos.configuraciones,
        reservas: datos.reservas,
        capacidadTotal: datos.capacidadTotal,
        ahora: ahoraEnMadrid(),
        politica: { permitirMismoDia: true, minutosCorte: 0 },
      });
    },
    enabled: !!fecha,
  });
};

/**
 * Ocupación por hora de un día.
 *
 * Calculada desde `reservas`, NO desde `vista_ocupacion`. La vista tiene
 * 724 de 784 filas huérfanas (ocupación fantasma de reservas que ya no
 * existen) y su columna `turno` usa el corte de las 16:00 en vez del de
 * las 17:00 que aplica el trigger de aforo. Se mantiene la misma forma de
 * salida para no tocar los componentes que la consumen.
 */
export const useDisponibilidadPorFecha = (fecha: string, marca: string = MARCA_POR_DEFECTO) => {
  return useQuery({
    queryKey: ["disponibilidad", fecha, marca],
    queryFn: async () => {
      const datos = await leerDatosDelDia(fecha, marca);
      const resultado = calcularDisponibilidad({
        fecha,
        configuraciones: datos.configuraciones,
        reservas: datos.reservas,
        capacidadTotal: datos.capacidadTotal,
        ahora: null,
      });
      return resultado.ocupacion.map((o) => ({
        fecha,
        hora: o.hora,
        dia_semana: resultado.diaSemana,
        turno: o.turno,
        total_reservas: o.total_reservas,
        total_comensales: o.total_comensales,
        capacidad_maxima: resultado.aforo[o.turno].capacidad_maxima,
        capacidad_disponible: resultado.aforo[o.turno].disponible,
        porcentaje_ocupacion: resultado.aforo[o.turno].porcentaje,
        porcentaje_hora: o.porcentaje_hora,
      }));
    },
    enabled: !!fecha,
  });
};

/**
 * Detalle por hora y por espacio de un día.
 *
 * Cambios respecto a la versión anterior, todos aditivos:
 *   - Ya no recorre 8:00-23:30 a ciegas: devuelve las horas que el MOTOR
 *     decide ofrecer más las que tengan reservas (una hora fuera de turno
 *     con reservas seguía existiendo y antes se perdía).
 *   - Añade `fecha`, `capacidad_disponible`, `capacidad_maxima`,
 *     `total_comensales`, `total_reservas` y `porcentaje_ocupacion_sala`,
 *     que antes no existían en el objeto y salían siempre a 0 / vacío.
 */
export const useDisponibilidadDetalladaPorFecha = (fecha: string, marca: string = MARCA_POR_DEFECTO) => {
  return useQuery({
    queryKey: ["disponibilidad-detallada", fecha, marca],
    queryFn: async (): Promise<DisponibilidadHora[]> => {
      const datos = await leerDatosDelDia(fecha, marca);
      const resultado = calcularDisponibilidad({
        fecha,
        configuraciones: datos.configuraciones,
        reservas: datos.reservas,
        capacidadTotal: datos.capacidadTotal,
        ahora: null,
      });

      const comensalesPorEspacioYHora = new Map<string, number>();
      // Todas las vivas (también las del Reservado): el detalle por sala las enseña, aunque no cuenten en el aforo.
      for (const r of datos.reservasTodas) {
        const minutos = horaAMinutos(r.hora);
        if (minutos === null || !r.espacio_id) continue;
        const clave = `${minutosAHora(minutos)}|${r.espacio_id}`;
        comensalesPorEspacioYHora.set(
          clave,
          (comensalesPorEspacioYHora.get(clave) ?? 0) + (Number(r.numero_comensales) || 0),
        );
      }

      const horas = new Set<string>([
        ...resultado.huecos.map((h) => h.hora),
        ...resultado.ocupacion.map((o) => o.hora),
      ]);

      return Array.from(horas)
        .sort((a, b) => a.localeCompare(b))
        .map((hora) => {
          const turno = turnoDeHora(hora);
          const aforo = resultado.aforo[turno];
          const fila = resultado.ocupacion.find((o) => o.hora === hora);

          const salas = datos.espacios.map((espacio) => {
            const comensales = comensalesPorEspacioYHora.get(`${hora}|${espacio.id}`) ?? 0;
            const porcentaje =
              espacio.capacidad_maxima > 0 ? (comensales / espacio.capacidad_maxima) * 100 : 0;
            return {
              sala_id: espacio.id,
              sala_nombre: espacio.nombre,
              capacidad_maxima: espacio.capacidad_maxima,
              comensales_actuales: comensales,
              capacidad_disponible: Math.max(0, espacio.capacidad_maxima - comensales),
              porcentaje_ocupacion: porcentaje,
              porcentaje_ocupacion_sala: porcentaje,
            };
          });

          return {
            fecha,
            hora,
            turno,
            salas,
            capacidad_total_disponible: aforo.disponible,
            capacidad_disponible: aforo.disponible,
            capacidad_maxima: aforo.capacidad_maxima,
            total_comensales: fila?.total_comensales ?? 0,
            total_reservas: fila?.total_reservas ?? 0,
            porcentaje_ocupacion_global: aforo.porcentaje,
          };
        });
    },
    enabled: !!fecha,
  });
};

/**
 * Ocupación de un rango de fechas (vista de calendario).
 *
 * También sale de `reservas` en vez de `vista_ocupacion`, por lo mismo.
 */
export const useDisponibilidadRango = (
  fechaInicio: string,
  fechaFin: string,
  marca: string = MARCA_POR_DEFECTO,
) => {
  return useQuery({
    queryKey: ["disponibilidad-rango", fechaInicio, fechaFin, marca],
    queryFn: async () => {
      const [espaciosRes, reservasRes] = await Promise.all([
        supabase.from("espacios_reserva" as any).select("id, capacidad_maxima, caracteristicas").eq("activa", true),
        supabase
          .from("reservas" as any)
          .select("fecha, hora, numero_comensales, espacio_id")
          .gte("fecha", fechaInicio)
          .lte("fecha", fechaFin)
          .eq("marca", marca)
          .in("estado", ESTADOS_QUE_OCUPAN),
      ]);
      if (espaciosRes.error) throw espaciosRes.error;
      if (reservasRes.error) throw reservasRes.error;

      // Bug corregido 2026-09-22 (ver cabecera del fichero): antes sumaba
      // TODOS los espacios activos sin filtrar por marca.
      const espaciosDeLaMarca = filtrarEspaciosPorMarca(
        ((espaciosRes.data ?? []) as any[]).map((e) => ({
          id: e.id as string,
          capacidad_maxima: Number(e.capacidad_maxima) || 0,
          marca: (e.caracteristicas?.marca as string | undefined) ?? null,
          privada: esCaracteristicaPrivada(e.caracteristicas),
        })),
        marca,
      );
      // Sin las salas privadas (fuera de aforo): ni su capacidad ni sus reservas.
      const capacidadTotal = sumarCapacidadPorMarca(espaciosDeLaMarca, marca);
      const idsPrivadas = espaciosDeLaMarca.filter((e) => e.privada).map((e) => e.id);

      const acumulado = new Map<
        string,
        { fecha: string; hora: string; total_reservas: number; total_comensales: number }
      >();
      for (const r of sinReservasEnSalasPrivadas((reservasRes.data ?? []) as any[], idsPrivadas)) {
        const minutos = horaAMinutos(r.hora);
        if (minutos === null) continue;
        const hora = minutosAHora(minutos);
        const clave = `${r.fecha}|${hora}`;
        const actual =
          acumulado.get(clave) ?? { fecha: r.fecha as string, hora, total_reservas: 0, total_comensales: 0 };
        actual.total_reservas += 1;
        actual.total_comensales += Number(r.numero_comensales) || 0;
        acumulado.set(clave, actual);
      }

      return Array.from(acumulado.values())
        .map((f) => ({
          ...f,
          turno: turnoDeHora(f.hora),
          capacidad_maxima: capacidadTotal,
          porcentaje_ocupacion:
            capacidadTotal > 0 ? Math.round((f.total_comensales / capacidadTotal) * 100) : 0,
        }))
        .sort((a, b) => (a.fecha === b.fecha ? a.hora.localeCompare(b.hora) : a.fecha.localeCompare(b.fecha)));
    },
    enabled: !!fechaInicio && !!fechaFin,
  });
};

// ------------------------------------------------------------
// AFORO AL EDITAR — la regla del trigger en un UPDATE
// ------------------------------------------------------------
// `supabase/migrations/20260930212000_aforo_permite_ediciones_sin_subir_ocupacion.sql`
// (paso 0b de `validar_capacidad_reserva`): un UPDATE se rechaza solo si AÑADE
// ocupación a un turno que queda por encima del aforo. Si la reserva ya
// ocupaba plaza y se queda en el MISMO turno (mismo negocio, mismo día, mismo
// lado del corte de las 17:00) sin subir de comensales, pasa aunque el turno
// esté pasado de aforo (p. ej. tras desactivar una sala). Lo demás se comprueba
// como un alta. El motor compartido de NUEVAS reservas no cambia.

/**
 * La reserva tal como está GUARDADA antes de editarla (lo que el trigger ve
 * como OLD). `ReservaEditable` (`src/lib/reservas/edicionReserva.ts`) ya trae
 * estas columnas: se le puede pasar tal cual.
 */
export interface ReservaAnteriorAforo {
  id: string;
  /** Sala en la que está guardada (para saber si estaba en una sala privada, fuera de aforo). */
  espacio_id?: string | null;
  /** "yyyy-MM-dd" (lo que venga detrás, p. ej. "T00:00:00", se ignora). */
  fecha: string;
  /** "HH:MM" o "HH:MM:SS". */
  hora: string;
  numero_comensales: number;
  estado: string | null;
  marca?: string | null;
}

/** El cambio que se quiere guardar (lo que el trigger ve como NEW). */
export interface CambioAforo {
  fecha: string;
  hora: string;
  comensales: number;
  /** `undefined` = la de la reserva anterior; `null`/"" = Casa Tomás (el COALESCE del trigger). */
  marca?: string | null;
  /** `undefined`/`null` = el de la reserva anterior: editar los datos no cambia el estado. */
  estado?: string | null;
}

/**
 * Qué hace el trigger con un UPDATE:
 *   · "no_ocupa": el estado NUEVO no ocupa plaza (cancelada, completada,
 *     no_show) → no comprueba nada;
 *   · "no_suma": ya ocupaba plaza y sigue en el mismo turno sin subir de
 *     comensales → pasa aunque el turno esté por encima del aforo;
 *   · "suma": todo lo demás (sube comensales, cambia de turno, de día o de
 *     negocio, o pasa de no ocupar a ocupar) → comprueba el aforo como un alta.
 */
export type EfectoEdicionAforo = "no_ocupa" | "no_suma" | "suma";

const MINUTOS_DIA_AFORO = 24 * 60;
const FECHA_ISO_AFORO = /^\d{4}-\d{2}-\d{2}$/;

function ocupaPlaza(estado: string | null | undefined): boolean {
  return ESTADOS_QUE_OCUPAN.includes(estado ?? "");
}

/** El COALESCE(marca, 'casa_tomas') del trigger. */
function negocioDelAforo(marca: string | null | undefined): string {
  return typeof marca === "string" && marca.trim() ? marca.trim() : MARCA_POR_DEFECTO;
}

/** "yyyy-MM-dd", o `null` si no lo es (y entonces no se da por «mismo día»). */
function diaDelAforo(fecha: unknown): string | null {
  const dia = String(fecha ?? "").slice(0, 10);
  return FECHA_ISO_AFORO.test(dia) ? dia : null;
}

/**
 * Turno con el corte del trigger. Una hora ilegible, o de las 24:00 en
 * adelante (el motor compartido la pliega a la madrugada y la BD la clasifica
 * como cena), da `null`: no se da por «mismo turno» y se comprueba el aforo.
 */
function turnoDelAforo(hora: unknown): "comida" | "cena" | null {
  const minutos = horaAMinutos(hora);
  if (minutos === null || minutos >= MINUTOS_DIA_AFORO) return null;
  return turnoDeHora(minutos);
}

/**
 * La regla del trigger para un UPDATE, sin I/O. Ante la duda (un dato ilegible
 * o que falta) responde "suma", que es lo conservador: comprobar el aforo.
 */
export function efectoEdicionEnAforo(anterior: ReservaAnteriorAforo, cambio: CambioAforo): EfectoEdicionAforo {
  if (!ocupaPlaza(cambio.estado ?? anterior.estado)) return "no_ocupa";
  if (!ocupaPlaza(anterior.estado)) return "suma";

  const marcaNueva = cambio.marca === undefined ? anterior.marca : cambio.marca;
  const diaAnterior = diaDelAforo(anterior.fecha);
  const turnoAnterior = turnoDelAforo(anterior.hora);
  const mismoTurno =
    negocioDelAforo(anterior.marca) === negocioDelAforo(marcaNueva) &&
    diaAnterior !== null &&
    diaAnterior === diaDelAforo(cambio.fecha) &&
    turnoAnterior !== null &&
    turnoAnterior === turnoDelAforo(cambio.hora);

  const antes = Number(anterior.numero_comensales);
  const despues = Number(cambio.comensales);
  const noSube = Number.isFinite(antes) && Number.isFinite(despues) && despues <= antes;

  return mismoTurno && noSube ? "no_suma" : "suma";
}

export interface AforoTurno {
  disponible: boolean;
  capacidadMaxima: number;
  comensalesActuales: number;
  capacidadDisponible: number;
  esComida: boolean;
  mensaje: string;
  /**
   * Solo si se pasa la reserva ANTERIOR (edición): qué hará el trigger con el
   * cambio (`efectoEdicionEnAforo`). `undefined` en un alta o si solo llega el id.
   */
  efectoEdicion?: EfectoEdicionAforo;
}

/**
 * Verifica el aforo del turno (comida/cena) de una fecha.
 *
 * Replica la regla del trigger `trg_validar_capacidad`, pero ya NO la
 * reimplementa a mano: delega en el motor compartido, que es quien
 * conoce el corte de turno y los estados que ocupan.
 *
 * Sigue siendo una comprobación PREVIA para dar feedback en el formulario:
 * la autoridad es la base de datos, que además usa un advisory lock. El
 * INSERT puede fallar aunque esto diga que hay hueco, y es correcto.
 *
 * `reservaEditada` (opcional), al editar:
 *   · su id: no se cuenta contra sí misma (como hace el trigger, `id != NEW.id`)
 *     y se comprueba como un alta — lo de antes, para las llamadas que ya había;
 *   · la reserva anterior entera (`ReservaAnteriorAforo`): además se aplica la
 *     regla del UPDATE (`efectoEdicionEnAforo`): si el cambio no añade
 *     ocupación, `disponible` es `true` aunque el turno esté pasado de aforo,
 *     que es lo que hará la BD. El estado nuevo se da por igual al anterior
 *     (editar los datos no cambia el estado).
 */
export const verificarAforoTurno = async (
  fecha: string,
  hora: string,
  comensales: number,
  marca: string = MARCA_POR_DEFECTO,
  reservaEditada?: string | ReservaAnteriorAforo | null,
  /**
   * Sala a la que irá la reserva. Si es una sala privada (el Reservado) está FUERA DE
   * AFORO (2026-10-03): no consume aforo, así que nunca se rechaza por turno lleno
   * (solo por exclusividad, que decide la BD).
   */
  espacioDestinoId?: string | null,
): Promise<AforoTurno> => {
  const anterior = reservaEditada && typeof reservaEditada === "object" ? reservaEditada : null;
  const excluirReservaId = anterior ? anterior.id : (reservaEditada as string | null | undefined);
  const datos = await leerDatosDelDia(fecha, marca, excluirReservaId);
  const resultado = calcularDisponibilidad({
    fecha,
    comensales,
    configuraciones: datos.configuraciones,
    reservas: datos.reservas,
    capacidadTotal: datos.capacidadTotal,
    ahora: null,
  });

  const turno = turnoDeHora(hora);
  const aforo = resultado.aforo[turno];
  const esComida = turno === "comida";
  const destinoPrivado = !!espacioDestinoId && datos.salasPrivadas.includes(espacioDestinoId);
  // Sacar una reserva de una sala privada a una normal empieza a consumir aforo, aunque no suba comensales.
  const veniaDePrivada = !!anterior?.espacio_id && datos.salasPrivadas.includes(anterior.espacio_id);
  const efectoBase = anterior ? efectoEdicionEnAforo(anterior, { fecha, hora, comensales, marca }) : undefined;
  const efectoEdicion: EfectoEdicionAforo | undefined =
    efectoBase === "no_suma" && veniaDePrivada ? "suma" : efectoBase;
  const sinComprobar = efectoEdicion === "no_ocupa" || efectoEdicion === "no_suma";
  const disponible = destinoPrivado || sinComprobar || !aforo.completo;

  let mensaje: string;
  if (destinoPrivado) {
    mensaje =
      "Sala privada: está fuera de aforo (no cuenta en el aforo del turno). Solo admite una reserva por turno.";
  } else if (efectoEdicion === "no_ocupa") {
    mensaje = "Esta reserva no ocupa plaza (está cancelada o cerrada): el cambio no se comprueba contra el aforo.";
  } else if (efectoEdicion === "no_suma" && aforo.completo) {
    mensaje = `El turno de ${turno} ya está por encima del aforo (${aforo.ocupacion + Number(comensales)} de ${aforo.capacidad_maxima}), pero este cambio no suma comensales: se puede guardar.`;
  } else if (disponible) {
    mensaje = `Quedan ${aforo.disponible} plazas en el turno de ${turno} (${aforo.ocupacion}/${aforo.capacidad_maxima} ocupadas)`;
  } else {
    mensaje = `Aforo superado en el turno de ${turno}: quedan ${aforo.disponible} plazas de ${aforo.capacidad_maxima} y se piden ${comensales}`;
  }

  return {
    disponible,
    capacidadMaxima: aforo.capacidad_maxima,
    comensalesActuales: aforo.ocupacion,
    capacidadDisponible: aforo.disponible,
    esComida,
    mensaje,
    ...(efectoEdicion ? { efectoEdicion } : {}),
  };
};

// Hook para verificar disponibilidad específica por espacio (basado en capacidad)
export const verificarDisponibilidadSala = async (
  fecha: string,
  hora: string,
  salaId: string
) => {
  const { data: sala } = await supabase
    .from("espacios_reserva" as any)
    .select("capacidad_maxima, caracteristicas")
    .eq("id", salaId)
    .single() as any;

  if (!sala) {
    throw new Error("Sala/Espacio no encontrado");
  }

  // El aforo real lo decide el TURNO completo (es lo que valida el trigger),
  // no la ocupación de esa hora suelta en `ocupacion_diaria` — que además
  // está desincronizada. Se responde con el aforo del turno DEL NEGOCIO AL
  // QUE PERTENECE ESTA SALA (bug corregido 2026-09-22: antes se comprobaba
  // siempre contra el aforo global sin distinguir marca — una sala de otro
  // negocio habría comparado con un aforo que no era el suyo).
  const marcaSala = (sala.caracteristicas?.marca as string | undefined) ?? MARCA_POR_DEFECTO;
  const aforo = await verificarAforoTurno(fecha, hora, 1, marcaSala);
  return {
    disponible: aforo.capacidadDisponible > 0,
    capacidadDisponible: aforo.capacidadDisponible,
    capacidadMaxima: aforo.capacidadMaxima,
    comensalesActuales: aforo.comensalesActuales,
    mensaje:
      aforo.capacidadDisponible > 0
        ? `Hay capacidad para ${aforo.capacidadDisponible} comensales más`
        : "No hay capacidad disponible en este horario",
  };
};

/**
 * Genera los turnos ofrecidos de un día.
 *
 * Por dentro ya no hay lógica propia: la pone el motor compartido.
 *
 * `diaSemana` se ignora a propósito: se recalcula a partir de `fecha` con
 * aritmética UTC. El valor que llegaba venía de `fechaObj.getDay()`, que
 * depende de la zona horaria del proceso y podía devolver el día anterior.
 */
export const generarTurnosDinamicos = async (
  fecha: string,
  salaId: string | null,
  _diaSemana?: number,
  comensales = 1,
  marca: string = MARCA_POR_DEFECTO,
): Promise<TurnoDinamico[]> => {
  const datos = await leerDatosDelDia(fecha, marca);
  const resultado = calcularDisponibilidad({
    fecha,
    comensales,
    espacioId: salaId ?? null,
    configuraciones: datos.configuraciones,
    reservas: datos.reservas,
    capacidadTotal: datos.capacidadTotal,
    ahora: ahoraEnMadrid(),
    politica: { permitirMismoDia: true, minutosCorte: 0 },
  });

  return resultado.huecos.map((h) => ({
    hora: h.hora,
    disponible: h.ofrecido,
    capacidadDisponible: h.capacidad_disponible,
    capacidadMaxima: h.capacidad_maxima,
    comensalesActuales: h.comensales_hora,
    esTurnoSecundario: h.nivel > 0,
    motivoApertura: h.abierto_por
      ? `Alta demanda en ${h.abierto_por} (${h.abierto_con_porcentaje}%)`
      : undefined,
    porcentajeOcupacion: h.porcentaje_ocupacion,
    nivel: h.nivel,
    minutosNivel: h.minutos_nivel,
    etiquetaNivel: h.etiqueta_nivel,
  }));
};

/** Solo las horas reservables, en "HH:MM". */
export const obtenerHorasDisponibles = async (
  fecha: string,
  salaId: string | null,
  comensales = 1,
  marca: string = MARCA_POR_DEFECTO,
): Promise<string[]> => {
  const turnos = await generarTurnosDinamicos(fecha, salaId, undefined, comensales, marca);
  return turnos.filter((t) => t.disponible).map((t) => t.hora);
};

// Mantener compatibilidad con código existente (espacio)
export const verificarDisponibilidad = async (
  fecha: string,
  hora: string,
  espacioId: string,
  _posicionId: string | null = null
) => {
  return verificarDisponibilidadSala(fecha, hora, espacioId);
};

/** Reexportado por comodidad: el tipo de fila de `configuracion_turnos`. */
export type { ConfiguracionTurno };
