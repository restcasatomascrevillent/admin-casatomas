// ============================================================================
// AVISO DE «RESERVA MODIFICADA» — decisiones puras (sin I/O), importable desde vitest
// ============================================================================
// Encargo del dueño (2026-09-30): cuando el personal cambia el DÍA, la HORA o
// los COMENSALES de una reserva desde «Editar» del panel y deja marcada
// «Avisar al cliente del cambio», el cliente recibe un correo con qué ha
// cambiado (antes → ahora, solo lo que cambió) y cómo queda.
//
// Flujo (index.ts hace el I/O; aquí solo las decisiones, como en
// recordatorios.ts / reintentos.ts / propuesta-solicitud.ts):
//   panel -> POST /emails-reserva/notificar-modificacion { reserva_id, antes }
//            (JWT del usuario + can_write_section('reservas'), igual que
//            /enviar-prueba y /enviar-propuesta-solicitud: lo llama el
//            navegador, no un cron)
//         -> lee la reserva YA GUARDADA: lo de AHORA sale siempre de la BD; del
//            panel solo se acepta el «antes» (validado, leerDiaHoraComensales)
//         -> motivoParaNoAvisar: sin email, no viva, datos de prueba, ya pasó,
//            lista negra, o no cambió nada relevante
//         -> último aviso de modificación de esa reserva -> planificarAviso
//         -> reclama fila en envios_email_reserva (tipo 'reserva_modificada',
//            clave_aviso, detalle) y envía como el resto: Resend con
//            Idempotency-Key por fila, reintentos del cron, aviso en la campana
//            si se pierde.
//   Si la reserva está 'verificada', el correo lleva los botones de la
//   contraoferta (aceptar/rechazar, tokens.ts) firmados con la huella ACTUAL
//   (`v2|verificada|HH:MM`): un enlace nuevo que vale aunque el del correo
//   anterior haya dejado de valer por el cambio de hora.
//
// IDEMPOTENCIA — por qué la clave no es solo (reserva, tipo) ni solo la huella
// ----------------------------------------------------------------------------
//   · (reserva, tipo), la del resto de correos, bloquearía el SEGUNDO aviso de
//     una reserva que se modifica dos veces.
//   · (reserva, tipo, huella de los datos nuevos) bloquearía el tercero de un
//     ida y vuelta A→B→A→B (el cliente se quedaría creyendo A).
//   Por eso `clave_aviso` = huella de los datos NUEVOS (día|HH:MM|comensales) +
//   id del aviso de modificación anterior de la misma reserva, y el índice
//   único `uq_envio_email_reserva_activo` pasa a (reserva_id, tipo_email,
//   coalesce(clave_aviso, '')) — ver la migración 20260930211000. El resto de
//   tipos tiene `clave_aviso` NULL: su idempotencia no cambia.
//   Contra el doble clic / reintento:
//     1. si el último aviso (pendiente, enviado o fallido-que-se-reintentará)
//        ya lleva estos mismos datos nuevos, no se repite;
//     2. si dos peticiones llegan A LA VEZ, las dos leen el mismo «último»,
//        calculan la MISMA clave y el índice único deja pasar solo una.
//
// «ANTES» — lo que se le enseña como dato anterior
// ----------------------------------------------------------------------------
//   Lo manda el panel (la reserva tal y como estaba al abrir el editor). Si el
//   último aviso quedó 'fallido' (no le ha llegado; el cron lo daría por viejo
//   al ver que la reserva volvió a cambiar), el nuevo cuenta desde lo que el
//   cliente sí sabía: el «antes» de ese aviso. Y si con eso resulta que la
//   reserva vuelve a estar como el cliente la conocía, no se le escribe.
// ============================================================================

import type { DiaHoraComensales, DatosModificacion } from "./plantillas.ts";
import { debeEnviarSolicitudRecibida } from "./plantillas.ts";
import { esReservaDePrueba } from "./recordatorios.ts";
import { instanteMadridAFechaUtc } from "./tiempo.ts";
import { epochSegundos } from "./propuesta-solicitud.ts";

export const TIPO_RESERVA_MODIFICADA = "reserva_modificada" as const;

/** Reservas «vivas» (las que cuentan en el aforo): las únicas que se avisan. */
export const ESTADOS_CON_AVISO: readonly string[] = ["pendiente", "verificada", "confirmada"];

/** Tope de sentido común para lo que llega del panel (no es el máximo de negocio). */
const MAX_COMENSALES = 1000;

function fechaNormalizada(valor: unknown): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valor ?? "").trim());
  if (!m) return null;
  const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function horaNormalizada(valor: unknown): string | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(valor ?? "").trim());
  if (!m) return null;
  const [h, min, seg] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  if (h > 23 || min > 59 || seg > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

/**
 * Lee (y valida) un día+hora+comensales que llega de fuera: el «antes» del
 * panel o el `detalle` guardado en la fila. `null` ante cualquier forma rara:
 * nada de lo que llega del navegador se pinta en un correo sin pasar por aquí.
 */
export function leerDiaHoraComensales(valor: unknown): DiaHoraComensales | null {
  if (!valor || typeof valor !== "object") return null;
  const v = valor as Record<string, unknown>;
  const fecha = fechaNormalizada(v.fecha);
  const hora = horaNormalizada(v.hora);
  const comensales =
    typeof v.comensales === "number"
      ? v.comensales
      : typeof v.comensales === "string" && v.comensales.trim() !== ""
        ? Number(v.comensales)
        : NaN;
  if (!fecha || !hora || !Number.isInteger(comensales) || comensales < 1 || comensales > MAX_COMENSALES) return null;
  return { fecha, hora, comensales };
}

/** Día, hora (HH:MM) y comensales de una fila de `reservas`. */
export function diaHoraComensalesDeReserva(r: { fecha: string; hora: string; numero_comensales: number }): DiaHoraComensales {
  return {
    fecha: String(r.fecha ?? "").slice(0, 10),
    hora: horaNormalizada(r.hora) ?? String(r.hora ?? "").slice(0, 5),
    comensales: Number(r.numero_comensales),
  };
}

/** `YYYY-MM-DD|HH:MM|comensales`. Pura. */
export function huellaDiaHoraComensales(d: DiaHoraComensales): string {
  return `${String(d.fecha ?? "").slice(0, 10)}|${horaNormalizada(d.hora) ?? String(d.hora ?? "").slice(0, 5)}|${Number(d.comensales)}`;
}

function cambiaDiaHoraComensales(a: DiaHoraComensales, b: DiaHoraComensales): boolean {
  return huellaDiaHoraComensales(a) !== huellaDiaHoraComensales(b);
}

/** Clave del aviso dentro de (reserva, 'reserva_modificada'): datos nuevos + aviso anterior. */
export function claveAviso(ahora: DiaHoraComensales, anteriorId: string | null): string {
  return `${huellaDiaHoraComensales(ahora)}|tras:${anteriorId ?? "ninguno"}`;
}

/**
 * ¿La reserva (día Y hora, en hora de Madrid) ya ha empezado? Una reserva de
 * hoy a las 13:00 corregida a las 16:00 (p. ej. vinieron más) no se avisa.
 * Fecha ilegible = se da por pasada (no se escribe al cliente por un dato roto).
 */
export function reservaYaPaso(r: { fecha: string; hora: string }, ahoraIso: string): boolean {
  const instante = instanteMadridAFechaUtc(String(r.fecha ?? "").slice(0, 10), String(r.hora ?? "").slice(0, 5) || "00:00").getTime();
  if (!Number.isFinite(instante)) return true;
  return instante <= new Date(ahoraIso).getTime();
}

/**
 * Defensa en profundidad del «antes» (que llega del navegador): el aviso solo
 * se acepta si la reserva se acaba de guardar. `reservas.updated_at` lo mueve
 * en CADA UPDATE el trigger `update_reservas_updated_at` (verificado en
 * producción el 2026-09-30: BEFORE UPDATE, `NEW.updated_at = NOW()`), y el
 * panel pide el aviso justo después de su UPDATE. Una petición suelta sobre
 * una reserva que nadie ha tocado en los últimos minutos no manda nada. Unos
 * segundos de reloj por delante en la BD no la rechazan; sin fecha legible, sí.
 */
export const VENTANA_MODIFICACION_RECIENTE_MS = 10 * 60 * 1000;

export function modificacionReciente(
  updatedAt: string | null | undefined,
  ahoraIso: string,
  ventanaMs = VENTANA_MODIFICACION_RECIENTE_MS,
): boolean {
  const segundos = epochSegundos(updatedAt);
  if (segundos === null) return false;
  return new Date(ahoraIso).getTime() - segundos * 1000 <= ventanaMs;
}

export type MotivoSinAviso =
  | "antes_invalido"
  | "reserva_sin_email"
  | "reserva_no_viva"
  | "pendiente_sin_correo_previo"
  | "reserva_de_prueba"
  | "reserva_pasada"
  | "en_lista_negra"
  | "sin_cambios";

export interface ReservaParaAviso {
  email: string | null;
  telefono?: string | null;
  estado: string;
  /** 'web' | 'telefono' | 'manual': una web 'pendiente' aún no ha recibido ningún correo. */
  canal?: string | null;
  /** "YYYY-MM-DD" */
  fecha: string;
  /** "HH:MM:SS" (BD) o "HH:MM" */
  hora: string;
  numero_comensales: number;
  nombre?: string | null;
  notas_cliente?: string | null;
  en_blacklist?: boolean | null;
}

/**
 * Por qué NO se avisa (null = se puede avisar). Es la misma regla que aplica el
 * panel para ofrecer la casilla, repetida aquí porque el servidor no se fía
 * del navegador: sin email, reserva que ya no está viva, pendiente de un canal
 * que no recibe «solicitud recibida» (la web: su primer correo es la
 * propuesta, y un aviso de cambio antes sería el doble correo que el dueño
 * quitó el 2026-09-28 — `debeEnviarSolicitudRecibida`), datos de prueba (igual
 * que el recordatorio: `esReservaDePrueba`), ya pasó, lista negra (la marca de
 * la reserva o la lista, que resuelve index.ts) o no cambió nada relevante.
 */
export function motivoParaNoAvisar(
  reserva: ReservaParaAviso,
  antes: DiaHoraComensales | null,
  opciones: { ahoraIso: string; enListaNegra: boolean },
): MotivoSinAviso | null {
  if (!antes) return "antes_invalido";
  if (!(reserva.email ?? "").trim()) return "reserva_sin_email";
  if (!ESTADOS_CON_AVISO.includes(reserva.estado)) return "reserva_no_viva";
  if (reserva.estado === "pendiente" && !debeEnviarSolicitudRecibida(reserva.canal)) return "pendiente_sin_correo_previo";
  if (esReservaDePrueba(reserva)) return "reserva_de_prueba";
  if (reservaYaPaso(reserva, opciones.ahoraIso)) return "reserva_pasada";
  if (opciones.enListaNegra || reserva.en_blacklist) return "en_lista_negra";
  if (!cambiaDiaHoraComensales(antes, diaHoraComensalesDeReserva(reserva))) return "sin_cambios";
  return null;
}

/**
 * Lo que se guarda en `envios_email_reserva.detalle` al reclamar el aviso: lo
 * necesario para que un reintento mande EXACTAMENTE el mismo correo (misma
 * Idempotency-Key, mismo contenido: si no, Resend responde 409) y para saber
 * si ese correo sigue siendo verdad cuando toca reintentarlo.
 */
export interface DetalleAviso {
  antes: DiaHoraComensales;
  ahora: DiaHoraComensales;
  /** Estado al avisar: decide botones y frase del correo. */
  estado: string;
}

export function leerDetalleAviso(valor: unknown): DetalleAviso | null {
  if (!valor || typeof valor !== "object") return null;
  const v = valor as Record<string, unknown>;
  const antes = leerDiaHoraComensales(v.antes);
  const ahora = leerDiaHoraComensales(v.ahora);
  if (!antes || !ahora || typeof v.estado !== "string" || !v.estado) return null;
  return { antes, ahora, estado: v.estado };
}

/** El aviso de modificación más reciente de la reserva, entre los que están
 * 'pendiente', 'enviado' o 'fallido' (un 'fallido_definitivo' ya no cuenta). */
export interface AvisoAnterior {
  id: string;
  resultado: string;
  detalle?: unknown;
}

export type PlanAviso =
  | { accion: "no_enviar"; motivo: "ya_enviado_o_en_curso" | "sin_cambios" }
  | { accion: "enviar"; clave: string; detalle: DetalleAviso };

/** Ver «IDEMPOTENCIA» y «ANTES» en la cabecera. */
export function planificarAviso(p: {
  reserva: ReservaParaAviso;
  antes: DiaHoraComensales;
  anterior: AvisoAnterior | null;
}): PlanAviso {
  const ahora = diaHoraComensalesDeReserva(p.reserva);
  const detalleAnterior = p.anterior ? leerDetalleAviso(p.anterior.detalle) : null;
  if (detalleAnterior && !cambiaDiaHoraComensales(detalleAnterior.ahora, ahora)) {
    return { accion: "no_enviar", motivo: "ya_enviado_o_en_curso" };
  }
  const antes = p.anterior?.resultado === "fallido" && detalleAnterior ? detalleAnterior.antes : p.antes;
  if (!cambiaDiaHoraComensales(antes, ahora)) return { accion: "no_enviar", motivo: "sin_cambios" };
  return {
    accion: "enviar",
    clave: claveAviso(ahora, p.anterior?.id ?? null),
    detalle: { antes, ahora, estado: p.reserva.estado },
  };
}

/**
 * En un reintento (cron /reintentar-fallidos): el aviso guardado solo sale si
 * sigue siendo verdad — la reserva sigue viva, en el MISMO estado (botones y
 * frase idénticos) y con los MISMOS datos, y aún no ha pasado. Si no, se
 * abandona sin aviso al personal: la reserva ya cambió otra vez (y el cambio
 * nuevo trae su propio aviso) o ya tiene otro correo (confirmada, cancelada…).
 */
export function avisoSigueVigente(detalle: DetalleAviso | null, reserva: ReservaParaAviso, ahoraIso: string): boolean {
  if (!detalle) return false;
  if (!ESTADOS_CON_AVISO.includes(reserva.estado) || reserva.estado !== detalle.estado) return false;
  if (cambiaDiaHoraComensales(detalle.ahora, diaHoraComensalesDeReserva(reserva))) return false;
  return !reservaYaPaso(reserva, ahoraIso);
}

/** Lo que necesita renderPlantilla (punto 9 de plantillas.ts). */
export function datosModificacionParaCorreo(detalle: DetalleAviso): DatosModificacion {
  return { antes: detalle.antes, estado: detalle.estado };
}

// ----------------------------------------------------------------------------
// Lista negra — el servidor lo vuelve a mirar (el panel ya lo mira en vivo)
// ----------------------------------------------------------------------------

/**
 * Copia deliberada de `variantesTelefono` (src/lib/reservas/telefono.ts): las
 * Edge Functions no importan de `src/` (ver la cabecera de tokens.ts). La
 * lista negra no está normalizada: el mismo número puede estar guardado como
 * "612345678", "+34612345678", "0034…" o con espacios.
 */
function variantesTelefono(telefono: string | null | undefined): string[] {
  const bruto = (telefono ?? "").trim();
  if (!bruto) return [];
  let n = bruto.replace(/[\s\-().+]/g, "");
  if (n.startsWith("0034")) n = n.slice(4);
  if (n.startsWith("34") && n.length === 11) n = n.slice(2);
  const set = new Set<string>([bruto]);
  if (n) {
    set.add(n);
    if (n.length === 9) {
      set.add(`+34${n}`);
      set.add(`34${n}`);
      set.add(`0034${n}`);
      set.add(`+34 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`);
      set.add(`${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`);
    } else if (n.length > 9) {
      set.add(`+${n}`);
    }
  }
  return [...set];
}

/** Valores a buscar en `blacklist.valor` (tipo 'email' / 'telefono'). */
export function valoresListaNegra(
  email: string | null | undefined,
  telefono: string | null | undefined,
): { emails: string[]; telefonos: string[] } {
  const e = (email ?? "").trim();
  return {
    emails: e ? [...new Set([e, e.toLowerCase()])] : [],
    telefonos: variantesTelefono(telefono),
  };
}

/** Misma regla que el panel (useVerificarBlacklist): una entrada con `caduca_el` ya vencida no cuenta. */
export function hayEntradaListaNegraVigente(entradas: ReadonlyArray<{ caduca_el?: string | null }>, hoy: string): boolean {
  return entradas.some((e) => !e.caduca_el || e.caduca_el >= hoy);
}
