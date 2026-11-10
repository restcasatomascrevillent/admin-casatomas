// ============================================================================
// ESCRIBIR UNA RESERVA — el único `UPDATE reservas … WHERE id` de las acciones.
// ----------------------------------------------------------------------------
// Lo usan el ejecutor de acciones (`useAccionesServicioReserva`: estado, sala, estrella,
// verificar, cancelar…) y el cambio de sala del panel «Asignación»
// (`useCambiarSalaReserva`). Antes cada escritor tenía su propio `update` con sus
// propias comprobaciones, y cuatro de ellos no pedían la fila de vuelta.
//
// 1. PIDE LA FILA DE VUELTA (`.select("id")`). Con RLS, una escritura denegada NO da
//    error: devuelve 0 filas. Sin mirarlo, la pantalla dice «hecho» sin haberlo
//    guardado (y, en las acciones que avisan al cliente, el correo sale igualmente).
//
// 2. ESCRITURA CONDICIONADA AL ESTADO DE PARTIDA (`desdeEstados` → `.in("estado", …)`).
//    Es la versión en BD de la regla de `accionesDisponibles`: no se cancela una reserva
//    que ya llegó, no se le da «Ha llegado» a una cancelada… aunque la pantalla
//    —que puede llevar un rato sin refrescar— todavía lo ofrezca. Mismo patrón que
//    `useAccionesModoServicio` (`.is("salida_at", null)`): la condición va DENTRO del
//    UPDATE, no «leer, decidir en JS, escribir», que tiene ventana de carrera. Si la
//    reserva ya no está en uno de esos estados, el UPDATE afecta 0 filas y se avisa.
//
// 3. SI NO TOCA NINGUNA FILA, RELEE EL ESTADO para decir QUÉ pasó. Con 0 filas desde fuera
//    no se distingue «la RLS no te deja», «ya no existe» y «otra persona la cambió antes».
//    La última es la habitual cuando la tarjeta lleva un rato sin refrescar (el kanban y
//    la lista no tienen realtime), y merece un aviso propio —«ya ha cambiado de estado
//    (ahora está «Verificada»)»— en vez de una frase con las tres causas. La relectura es
//    un SELECT de una columna y solo se hace en ese fallo; si también falla, se queda la
//    frase con las tres causas (nunca esconde el fallo original).
//
// 4. `llegada_at` es OPCIONAL: si la migración 20260923_reservas_llegada.sql no está
//    aplicada, el primer UPDATE que la incluya falla con «columna inexistente»; se
//    recuerda y se reintenta sin ella (con los mismos filtros).
// ============================================================================

import { marcarCambioPropio } from "./cambiosPropios";
import { supabase } from "@/integrations/supabase/client";
import { etiquetaEstadoReserva } from "./estadosReserva";
import { esErrorColumnaLlegadaInexistente } from "./servicioSala";

/** Columnas de `reservas` que escriben las acciones. */
export interface CambiosReserva {
  estado?: string;
  hora?: string;
  espacio_id?: string | null;
  /** Solo existe si la migración 20260923_reservas_llegada.sql está aplicada. */
  llegada_at?: string | null;
  importante?: boolean;
  /** «Sentar fuera» (20261122171500): dónde, mesa o nota, y la sala de antes (ver `sentarFuera.ts`). */
  fuera_lugar?: string | null;
  fuera_mesa?: string | null;
  fuera_espacio_previo_id?: string | null;
}

// null = aún no se sabe; se descubre en el primer UPDATE que la incluya.
let columnaLlegadaDisponible: boolean | null = null;
/** Solo para tests. */
export function __resetColumnaLlegadaParaTests() {
  columnaLlegadaDisponible = null;
}

/**
 * Por qué una escritura no ha tocado ninguna fila:
 *   · `estado_cambiado`: la reserva existe pero ya NO está en un estado válido para esta
 *     acción (otra persona la cambió, o el cliente desde su correo). Trae `estadoActual`.
 *   · `sin_permiso`: la reserva sigue en un estado válido y aun así no se ha escrito: la RLS.
 *   · `sin_permiso_o_inexistente`: no se puede ver la reserva (la RLS o ya no existe), o la
 *     escritura no iba condicionada y no hay más que decir.
 *   · `no_se_sabe`: escritura condicionada y la relectura del estado no ha podido hacerse.
 */
export type MotivoSinFilas = "estado_cambiado" | "sin_permiso" | "sin_permiso_o_inexistente" | "no_se_sabe";

const MENSAJE_SIN_FILAS: Record<Exclude<MotivoSinFilas, "estado_cambiado">, string> = {
  sin_permiso: "no tienes permiso para cambiar esta reserva.",
  sin_permiso_o_inexistente: "no tienes permiso para cambiar esta reserva, o ya no existe.",
  no_se_sabe: "no tienes permiso para cambiar esta reserva, o ya no existe, o ya ha cambiado de estado.",
};

/** La frase de un fallo por estado ajeno. Sale en avisos como «No se pudo registrar la llegada: …». */
export const mensajeEstadoCambiado = (estadoActual: string) =>
  `la reserva ya ha cambiado de estado (ahora está «${etiquetaEstadoReserva(estadoActual)}»). Se ha refrescado la pantalla.`;

/**
 * Escritura sin filas afectadas: RLS la ha filtrado en silencio, la reserva ya no existe
 * o —si la escritura iba condicionada a un estado de partida— otra persona la cambió
 * antes. `motivo` dice cuál, cuando se ha podido averiguar.
 */
export class ErrorSinFilasReserva extends Error {
  constructor(
    readonly motivo: MotivoSinFilas = "sin_permiso_o_inexistente",
    /** Solo con `estado_cambiado`: el estado que tiene ahora la reserva. */
    readonly estadoActual?: string,
  ) {
    super(motivo === "estado_cambiado" ? mensajeEstadoCambiado(estadoActual ?? "") : MENSAJE_SIN_FILAS[motivo]);
    this.name = "ErrorSinFilasReserva";
  }
}

export interface OpcionesEscritura {
  /**
   * Estados en los que la reserva tiene que estar AHORA, en la BD, para que se escriba.
   * `null`, `undefined` o vacío: vale cualquiera.
   */
  desdeEstados?: readonly string[] | null;
}

/**
 * Tras una escritura condicionada que no ha tocado nada: ¿por qué? Lee el estado actual de la
 * reserva (un SELECT de una columna). Nunca lanza: si no se puede leer, `no_se_sabe`.
 */
async function explicarSinFilas(id: string, desdeEstados: readonly string[]): Promise<ErrorSinFilasReserva> {
  try {
    const { data, error } = await supabase.from("reservas").select("estado").eq("id", id).maybeSingle();
    if (error) return new ErrorSinFilasReserva("no_se_sabe");
    const estado = (data as { estado?: string | null } | null)?.estado;
    if (!estado) return new ErrorSinFilasReserva("sin_permiso_o_inexistente");
    if (!desdeEstados.includes(estado)) return new ErrorSinFilasReserva("estado_cambiado", estado);
    return new ErrorSinFilasReserva("sin_permiso");
  } catch {
    return new ErrorSinFilasReserva("no_se_sabe");
  }
}

/** Escribe `cambios` en la reserva `id`. Devuelve las filas tocadas; lanza si no toca ninguna o la BD falla. */
export async function escribirReserva(
  id: string,
  cambios: CambiosReserva,
  { desdeEstados }: OpcionesEscritura = {},
): Promise<{ id: string }[]> {
  // Antes de escribir: el cambio puede llegar por realtime antes que la respuesta.
  marcarCambioPropio(id);
  const payload: Record<string, unknown> = { ...cambios };
  if ("llegada_at" in payload && columnaLlegadaDisponible === false) {
    delete payload.llegada_at;
  }

  const condicionada = !!desdeEstados && desdeEstados.length > 0;
  // `payload as never`: `llegada_at` y otras columnas nuevas no están (todavía) en los tipos generados.
  const actualizar = () => {
    let consulta = supabase.from("reservas").update(payload as never).eq("id", id);
    if (condicionada) consulta = consulta.in("estado", [...desdeEstados!]);
    return consulta.select("id");
  };
  let { data, error } = await actualizar();

  if (error && "llegada_at" in payload && esErrorColumnaLlegadaInexistente(error)) {
    columnaLlegadaDisponible = false;
    delete payload.llegada_at;
    ({ data, error } = await actualizar());
  } else if (!error && "llegada_at" in payload) {
    columnaLlegadaDisponible = true;
  }

  if (error) throw error;
  if (!data || (data as unknown[]).length === 0) {
    throw condicionada ? await explicarSinFilas(id, desdeEstados!) : new ErrorSinFilasReserva("sin_permiso_o_inexistente");
  }
  return data as { id: string }[];
}
