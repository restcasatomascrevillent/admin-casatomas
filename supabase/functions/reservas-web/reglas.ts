// ============================================================================
// REGLAS DE SALA DEL ALTA WEB (lógica pura, sin I/O)
// ============================================================================
// reservas-sin-salas (decisión del dueño, 2026-09-29, engram
// sdd/reservas-sin-salas/decisiones):
//   · Casa Tomás: el cliente reserva una HORA. La sala es una decisión
//     interna del restaurante (se asigna desde el panel), así que la web no
//     acepta sala del cliente ni exige que el grupo quepa entero en una sala.
//     Manda el aforo del turno (suma de las salas del negocio), igual que el
//     trigger validar_capacidad_reserva.
//   · Touza: El Reservado ES lo que se reserva. Se mantiene todo como estaba,
//     incluida la regla de que el grupo quepa en un espacio.
//
// Separado de index.ts para poder testearlo con vitest (index.ts importa de
// URLs de Deno). Las reglas de sala solo las usa handleCrear:
// handleDisponibilidad nunca tuvo la regla de sala.
//
// 2026-10-01: Touza deja de admitir reservas — ver
// `rechazoTouzaSinReservas` al final (esa sí la usan las dos rutas). Las
// ramas de Touza de las reglas de sala quedan sin uso hasta que se retire
// toda la lógica de reservas de Touza (paso posterior).
// ============================================================================

import { NEGOCIOS, type Marca } from "./plantillas.ts";

/**
 * ¿Hay que rechazar el alta por falta de sitio?
 *  - Sin aforo en el turno (`disponibleGlobal` false): sí, en los dos negocios.
 *  - Touza: también si ningún espacio tiene hueco para el grupo entero.
 *  - Casa Tomás: nunca por sala.
 * `espaciosLibres` = nº de espacios con hueco para todo el grupo (ver
 * contarEspaciosQueCaben).
 */
export function rechazarPorSala(marca: Marca, disponibleGlobal: boolean, espaciosLibres: number): boolean {
  if (!disponibleGlobal) return true;
  return marca === "touza" && espaciosLibres === 0;
}

/** Nº de espacios con hueco para el grupo entero. */
export function contarEspaciosQueCaben(espacios: ReadonlyArray<{ disponible: number }>, comensales: number): number {
  return espacios.filter((e) => e.disponible >= comensales).length;
}

/**
 * Sala que se toma del cuerpo de la petición. En Casa Tomás se ignora (queda
 * sin asignar y la asigna el personal); en Touza se respeta tal cual.
 */
export function salaDelCliente(
  marca: Marca,
  entrada: { espacioId: string | null; salaNombre: string | null },
): { espacioId: string | null; salaNombre: string | null } {
  if (marca === "casa_tomas") return { espacioId: null, salaNombre: null };
  return { espacioId: entrada.espacioId, salaNombre: entrada.salaNombre };
}

// ============================================================================
// TOUZA NO ADMITE RESERVAS (decisión del dueño, 2026-10-01)
// ============================================================================
// «Toda la lógica de reservas de Touza va fuera, no se reserva.» Primer paso,
// el seguro: el servidor público rechaza cualquier petición cuya marca se
// resuelva como Touza (misma `resolverMarca` de siempre, en plantillas.ts)
// ANTES de la lista negra, de `grupo_grande`, de los límites por
// teléfono/email y del INSERT. Esas ramas registran una solicitud
// (`solicitudes_pendientes`) o mandan un correo, y la web de Touza pinta
// `grupo_grande` como «Solicitud recibida»: el cliente creería que alguien
// la va a revisar y no la atendería nadie.
//
// TRAMPA — NO quitar "touza" de MARCAS_VALIDAS ni tocar `resolverMarca` ni la
// marca por defecto: la web de Touza sigue mandando `marca: "touza"`. Si
// dejara de ser una marca válida, `resolverMarca` la mandaría a Casa Tomás y
// se crearía EN SILENCIO una reserva del restaurante. Este rechazo depende de
// que la marca se siga reconociendo.
//
// FORMA: 409 + `motivo` + `mensaje`, lo que la web de Touza ya sabe enseñar
// (touza-restaurant-website, src/lib/reservas-web.ts::
// interpretarRechazoReserva): título «No hemos podido enviar tu solicitud»,
// el `mensaje` tal cual y, para un 409 con un motivo que no conoce, la salida
// «Llámanos al …». Ni 2xx ni `grupo_grande`: son los dos únicos casos que esa
// web pinta como «Solicitud recibida» (Reservado.tsx).
// ============================================================================

export const MOTIVO_TOUZA_SIN_RESERVAS = "touza_sin_reservas";

export interface RechazoTouzaSinReservas {
  status: 409;
  cuerpo: { ok: false; motivo: typeof MOTIVO_TOUZA_SIN_RESERVAS; mensaje: string };
}

/**
 * Respuesta para una petición de Touza a `/crear` o `/disponibilidad`, o
 * `null` si la marca sí admite reservas. El teléfono sale de `NEGOCIOS.touza`
 * (misma fuente que el resto de textos de Touza de esta función).
 */
export function rechazoTouzaSinReservas(marca: Marca): RechazoTouzaSinReservas | null {
  if (marca !== "touza") return null;
  const { nombre, telefonoTexto } = NEGOCIOS.touza;
  return {
    status: 409,
    cuerpo: {
      ok: false,
      motivo: MOTIVO_TOUZA_SIN_RESERVAS,
      mensaje: `${nombre} no admite reservas por la web. Para cualquier consulta, llámanos al ${telefonoTexto}.`,
    },
  };
}
