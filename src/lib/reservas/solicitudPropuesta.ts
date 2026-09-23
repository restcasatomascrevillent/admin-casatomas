// ============================================================================
// PROPUESTA SOBRE UNA SOLICITUD DEL BOT — lógica pura (sin I/O)
// ----------------------------------------------------------------------------
// El personal puede cambiar día, hora y comensales de una solicitud que el bot
// no pudo cerrar (y elegir sala) antes de convertirla en reserva.
//
// DÓNDE SE GUARDA (sin migración):
//   · `solicitudes_pendientes` ya tiene `fecha_solicitada`, `hora_solicitada`
//     (text) y `numero_comensales` -> "Guardar cambios" los sobrescribe, así la
//     lista unificada ordena/filtra por lo acordado.
//   · Para NO perder lo que pidió el cliente, la primera vez que se cambia algo
//     se antepone a `notas_internas` una línea legible y estable:
//         [Petición original del cliente: 2026-10-06 14:00, 20 pax]
//     Sirve a la vez de rastro para los compañeros (se ve en la tarjeta) y de
//     fuente para el bloque "Pidió → Propuesta" (`extraerPeticionOriginal`).
//     Si alguien borra esa línea a mano, lo "original" pasa a ser lo guardado.
//   · La SALA se guarda en `espacio_propuesto_id` (migración
//     20260923210000_solicitud_propuesta_espacio.sql). Mientras la migración
//     no esté aplicada, la fila no trae esa columna y la sala sigue siendo una
//     elección local que viaja a "Convertir en reserva" (`persistirSala`).
//   · Si la propuesta ya se había ENVIADO al cliente y se cambia algo, vuelve
//     a 'borrador': el enlace del correo firma los datos y deja de valer.
// ============================================================================

import { horaCorta } from "./ocupacionSalas";

export interface PeticionSolicitud {
  /** "yyyy-MM-dd" */
  fecha: string | null;
  /** "HH:MM" */
  hora: string | null;
  comensales: number | null;
}

export interface PropuestaSolicitud extends PeticionSolicitud {
  /** Sala elegida (null = sin asignar). Se guarda en espacio_propuesto_id. */
  espacioId: string | null;
}

interface SolicitudConPeticion {
  fecha_solicitada: string | null;
  hora_solicitada: string | null;
  numero_comensales: number | null;
  notas_internas: string | null;
  espacio_propuesto_id?: string | null;
  propuesta_estado?: string | null;
}

export const PREFIJO_PETICION_ORIGINAL = "Petición original del cliente:";
const VACIO = "—";
const RE_PETICION_ORIGINAL = /\[Petición original del cliente: (\S+) (\S+), (\S+) pax\]/;

const fechaISO = (fecha: string | null | undefined) => {
  if (!fecha) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(fecha));
  return m ? m[1] : null;
};

const comensalesValidos = (n: unknown): number | null => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
};

/** Lo que hay AHORA guardado en la fila. */
export function peticionGuardada(s: SolicitudConPeticion): PeticionSolicitud {
  return {
    fecha: fechaISO(s.fecha_solicitada),
    hora: horaCorta(s.hora_solicitada),
    comensales: comensalesValidos(s.numero_comensales),
  };
}

export function lineaPeticionOriginal(p: PeticionSolicitud): string {
  return `[${PREFIJO_PETICION_ORIGINAL} ${p.fecha ?? VACIO} ${p.hora ?? VACIO}, ${p.comensales ?? VACIO} pax]`;
}

export function extraerPeticionOriginal(notas: string | null | undefined): PeticionSolicitud | null {
  if (!notas) return null;
  const m = RE_PETICION_ORIGINAL.exec(notas);
  if (!m) return null;
  const valor = (x: string) => (x === VACIO ? null : x);
  return {
    fecha: fechaISO(valor(m[1])),
    hora: horaCorta(valor(m[2])),
    comensales: comensalesValidos(valor(m[3])),
  };
}

/** Lo que pidió el cliente: la marca en notas si existe; si no, la fila. */
export function peticionOriginal(s: SolicitudConPeticion): PeticionSolicitud {
  return extraerPeticionOriginal(s.notas_internas) ?? peticionGuardada(s);
}

/** Antepone la línea de petición original salvo que ya esté. Idempotente. */
export function anotarPeticionOriginal(notas: string | null | undefined, original: PeticionSolicitud): string {
  const actuales = notas ?? "";
  if (RE_PETICION_ORIGINAL.test(actuales)) return actuales;
  const linea = lineaPeticionOriginal(original);
  return actuales.trim() ? `${linea}\n${actuales}` : linea;
}

export interface DiferenciasPeticion {
  fecha: boolean;
  hora: boolean;
  comensales: boolean;
  alguna: boolean;
}

export function diferenciasPeticion(a: PeticionSolicitud, b: PeticionSolicitud): DiferenciasPeticion {
  const fecha = (a.fecha ?? null) !== (b.fecha ?? null);
  const hora = horaCorta(a.hora) !== horaCorta(b.hora);
  const comensales = (a.comensales ?? null) !== (b.comensales ?? null);
  return { fecha, hora, comensales, alguna: fecha || hora || comensales };
}

export interface ActualizacionSolicitud {
  fecha_solicitada: string | null;
  hora_solicitada: string | null;
  numero_comensales: number | null;
  notas_internas: string;
  /** Solo si `persistirSala` y la sala cambia. */
  espacio_propuesto_id?: string | null;
  /** 'borrador' si ya se había enviado y la propuesta cambia. */
  propuesta_estado?: string;
}

/** La fila trae la columna de sala (migración 20260923210000 aplicada). */
export function puedePersistirSala(solicitud: object): boolean {
  return "espacio_propuesto_id" in solicitud;
}

/**
 * Cambios a escribir en `solicitudes_pendientes` para guardar la propuesta.
 * `null` si no hay nada que cambiar respecto a lo guardado.
 * `persistirSala`: incluir la sala (`propuesta.espacioId`) en la comparación
 * y en el UPDATE — solo si la columna existe (ver `puedePersistirSala`).
 */
export function actualizacionPropuesta(
  solicitud: SolicitudConPeticion,
  propuesta: PeticionSolicitud & { espacioId?: string | null },
  opciones?: { persistirSala?: boolean },
): ActualizacionSolicitud | null {
  const guardada = peticionGuardada(solicitud);
  const destino: PeticionSolicitud = {
    fecha: fechaISO(propuesta.fecha),
    hora: horaCorta(propuesta.hora),
    comensales: comensalesValidos(propuesta.comensales),
  };
  const cambiaPeticion = diferenciasPeticion(guardada, destino).alguna;
  const salaDestino = propuesta.espacioId ?? null;
  const cambiaSala =
    !!opciones?.persistirSala && propuesta.espacioId !== undefined && salaDestino !== (solicitud.espacio_propuesto_id ?? null);
  if (!cambiaPeticion && !cambiaSala) return null;
  const upd: ActualizacionSolicitud = {
    fecha_solicitada: destino.fecha,
    hora_solicitada: destino.hora,
    numero_comensales: destino.comensales,
    // La original es la que había ANTES del primer cambio: si ya hay marca se
    // respeta; si no, lo guardado ahora ES lo que pidió el cliente. Solo se
    // anota si cambia día/hora/pax (la sala nunca la pidió el cliente).
    notas_internas: cambiaPeticion
      ? anotarPeticionOriginal(solicitud.notas_internas, peticionOriginal(solicitud))
      : solicitud.notas_internas ?? "",
  };
  if (cambiaSala) upd.espacio_propuesto_id = salaDestino;
  if (solicitud.propuesta_estado === "enviada") upd.propuesta_estado = "borrador";
  return upd;
}

/** "6/10/2026" a partir de "2026-10-06" (sin pasar por zonas horarias). */
export function fechaLegible(fecha: string | null | undefined): string {
  const iso = fechaISO(fecha);
  if (!iso) return VACIO;
  const [y, m, d] = iso.split("-").map(Number);
  return `${d}/${m}/${y}`;
}
